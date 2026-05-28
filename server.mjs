/**
 * LINE グループチャット Bot サーバー
 * 受講生のメッセージを受信し、Claude API で回答を生成してグループに返信する
 * データ管理はすべてスプレッドシートで行う
 */

import express from "express";
import { messagingApi, middleware } from "@line/bot-sdk";
import dotenv from "dotenv";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { generateReply } from "./lib/ai.mjs";
import { fetchSystemPrompt, fetchKnowledge, fetchHistory, appendHistory } from "./lib/sheets.mjs";

const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(PROJECT_ROOT, ".env") });

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken,
});

const app = express();

app.get("/", (req, res) => {
  res.json({ status: "ok", bot: "line-group-bot" });
});

app.post("/webhook", middleware(config), async (req, res) => {
  res.status(200).json({ status: "ok" });

  const events = req.body.events || [];
  for (const event of events) {
    try {
      await handleEvent(event);
    } catch (err) {
      console.error("[handleEvent error]", err.message);
    }
  }
});

async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") return;
  if (event.source.type !== "group") return;

  const userId = event.source.userId;
  const groupId = event.source.groupId;
  const text = event.message.text;
  const mention = event.message.mention;

  console.log(`[message] group=${groupId} user=${userId} text="${text.slice(0, 50)}"`);

  if (userId === process.env.ADMIN_USER_ID) {
    console.log("[skip] 管理者のメッセージ");
    return;
  }

  if (mention && mention.mentionees) {
    const mentionedAdmin = mention.mentionees.some(
      (m) => m.userId === process.env.ADMIN_USER_ID
    );
    if (mentionedAdmin) {
      console.log("[skip] 管理者宛のメンション");
      return;
    }
  }

  // 「応答生成中...」をすぐに返す
  await client.replyMessage({
    replyToken: event.replyToken,
    messages: [{ type: "text", text: "応答生成中..." }],
  });

  // グループ名とユーザー名を取得
  const [groupSummary, memberProfile] = await Promise.all([
    client.getGroupSummary(groupId).catch(() => null),
    client.getGroupMemberProfile(groupId, userId).catch(() => null),
  ]);
  const groupName = groupSummary?.groupName || groupId;
  const displayName = memberProfile?.displayName || userId;

  // 受講生のメッセージをスプシに記録
  await appendHistory(groupId, groupName, userId, displayName, text);

  // スプシから3つのデータを並列取得
  const [systemPrompt, knowledge, history] = await Promise.all([
    fetchSystemPrompt(),
    fetchKnowledge(),
    fetchHistory(groupId, groupName, 10),
  ]);

  // Claude API で回答生成
  const reply = await generateReply(text, systemPrompt, knowledge, history);

  // Bot の回答をスプシに記録
  await appendHistory(groupId, groupName, "Bot", "Bot", reply);

  // 本回答を push message でグループに送信
  await client.pushMessage({
    to: groupId,
    messages: [{ type: "text", text: reply }],
  });

  console.log(`[reply] ${reply.slice(0, 80)}...`);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`line-group-bot running on port ${PORT}`);
  console.log(`SPREADSHEET_ID: ${process.env.SPREADSHEET_ID || "(未設定)"}`);
  console.log(`ADMIN_USER_ID: ${process.env.ADMIN_USER_ID || "(未設定 — 全メッセージに反応します)"}`);
});
