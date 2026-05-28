# セットアップ詰まりポイント まとめ

実際のセットアップで詰まった箇所と解決策の記録。

---

## 1. LINE Developers で Messaging API チャンネルが見つからない

**症状**
LINE Developers Console → サポートBot プロバイダーを開いてもチャンネルが表示されない。

**原因**
LINE Official Account Manager で公式アカウントを作成しただけでは、Messaging API チャンネルは自動作成されない。別途「Messaging APIを利用する」操作が必要。

**解決策**
LINE Official Account Manager の設定画面は通常のメニューナビゲーションでは見つかりにくい。直接URLで開く：

```
https://manager.line.biz/account/@アカウントID/setting/messaging-api
```

→「Messaging APIを利用する」ボタンをクリック → プロバイダーを選択して連携

---

## 2. Windows でパスエラーが出る（init-spreadsheet.mjs / server.mjs）

**症状**
```
GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET が .env に設定されていません
```
.env に値が入っているのにエラーになる。

**原因**
`import.meta.url.replace("file://", "")` は Windows で正しく動かない。
Windows の URL は `file:///C:/...` 形式なので、`file://` を消すと `/C:/...` になりパスが壊れる。

**解決策**
```js
// NG（Windows で壊れる）
const PROJECT_ROOT = dirname(import.meta.url.replace("file://", ""));

// OK（クロスプラットフォーム対応）
import { fileURLToPath } from "url";
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));
```

`init-spreadsheet.mjs` と `server.mjs` の両方を修正済み。

---

## 3. Render.com で環境変数が保存されない

**症状**
「Import from .env」で変数を追加して「Add variables」を押しても、Environment Variables のリストに何も表示されない。
→ デプロイしても `Error: no channel secret` が出続ける。

**原因**
`GOOGLE_TOKENS_JSON` の値が JSON 形式（`{...}`）で、空白や特殊文字を含むため、.env パーサーが途中でクラッシュして全変数の保存が失敗していた。

**解決策**
1. まず `GOOGLE_TOKENS_JSON` を**除いた**変数だけを「Import from .env」で追加
2. `GOOGLE_TOKENS_JSON` は KEY/VALUE フィールドに**個別で手入力**して追加

```
# これだけ別途手動追加
KEY: GOOGLE_TOKENS_JSON
VALUE: {"access_token":"...","refresh_token":"..."}
```

---

## 4. node_modules が壊れていた

**症状**
```
Error: Cannot find module './abusiveexperiencereport'
```

**原因**
`googleapis` パッケージのディレクトリが空になっていた（不完全なインストール）。

**解決策**
```bash
rm -rf node_modules package-lock.json
npm install
```

---

## 5. GitHub プッシュに認証が必要

**症状**
`git push` が止まる or 失敗する。

**原因**
GitHub は現在パスワード認証を廃止。Personal Access Token (PAT) が必要。

**解決策**
1. https://github.com/settings/tokens/new でトークン生成
   - スコープ：「リポジトリ」にチェック
2. リモートURLにトークンを含める：
```bash
git remote set-url origin https://ユーザー名:トークン@github.com/ユーザー名/line-group-bot.git
git push origin main
```

---

## 6. ボットがグループに招待すると即退会する

**症状**
LINEグループにボットを追加すると、参加通知の直後に退会通知が出る。
Render.com のログには何も出ない。

**原因**
Render.com の無料プランはアクセスがない状態が15分続くとスリープに入る（起動まで50秒以上かかる）。
ボットをグループに追加した瞬間にLINEがjoin webhookを送るが、サーバーがスリープ中で応答できず、LINEがBotを自動退会させる。

**確認したが原因でなかったもの（ループ注意）**
- LINE OA Manager「グループ・複数人トークへの参加を許可する」→ 有効になっていた
- LINE Developers Console「ボットがグループチャットに参加することを許可する」→ 有効になっていた
- コードに leaveGroup の呼び出し → なし

⚠️ **サポート時の注意**：上記の設定確認は1回やれば十分。同じ設定を2回以上確認させるのはNG。設定が問題ない場合はすぐにサーバー側の原因（スリープ等）に切り替えること。

**解決策**
1. `https://line-group-bot-u08l.onrender.com` を開いてサーバーを起こす
2. ブラウザに `{"status":"ok"}` が表示されたのを確認してから30秒以内にボットをグループに追加する

**恒久対策**
UptimeRobot（無料）で14分ごとにpingを設定 → スリープしなくなる
設定URL: https://uptimerobot.com

---

## 7. ログに何も出ない（join イベントが無視されて見える）

**症状**
ボットをグループに追加してもRender.comのログに何も出ない。

**原因**
`handleEvent` 関数が `join` イベントをログ出力なしでスキップする設計になっていた。

```js
// この条件で join イベントは return → ログなし
if (event.type !== "message" || event.message.type !== "text") return;
```

ログが出ないことが「webhookが届いていない証拠」ではなく、単に「ログ出力の設計上の問題」だった。

**解決策**
デバッグ用ログを追加してすべてのイベントを記録するようにした：

```js
const events = req.body.events || [];
console.log(`[webhook] イベント数: ${events.length}`);

for (const event of events) {
  console.log(`[event] type=${event.type} source=${event.source?.type} groupId=${event.source?.groupId || "-"}`);
```

---

## 8. 返信が来ない（「応答生成中...」で止まる）

**症状**
ボットが「応答生成中...」を送信した後、実際の返信が来ない。
ログに `[handleEvent error] 404 not_found_error model: モデル名` が出る。

**原因**
`lib/ai.mjs` に指定されたClaudeのモデル名がAPIキーで使用できないもの、または廃止済みのものだった。

試してダメだったモデル名：
- `claude-sonnet-4-20250514` → 404
- `claude-3-5-sonnet-20241022` → 404（廃止済みの可能性）

**解決策**
`claude-sonnet-4-5` に変更して解決。

```js
// lib/ai.mjs
model: "claude-sonnet-4-5",
```

**サポート時の注意**
モデル名の404エラーが出たら、同じモデルに対して何度も試さず、別のモデル名を試すこと。
APIキーのプランによって使用できるモデルが異なる場合がある。
Anthropic の console（`console.anthropic.com` = `platform.claude.com` にリダイレクト）では
モデル一覧が直接確認できないため、実際に試して確認するしかない。

---

## ループしやすい落とし穴（サポート担当者向け）

以下は「同じ確認を繰り返してしまいがちなパターン」の記録。次回のサポート時に注意すること。

### パターン1: LINE設定の確認ループ
「ボットが即退会する」問題に対して、LINE OA Manager と LINE Developers Console の設定を
交互に確認させてしまいがち。どちらも有効になっていた場合は設定確認を打ち切り、
**すぐにサーバーのスリープ問題に切り替える**こと。

### パターン2: モデル名の試行錯誤でページ誘導ループ
「モデルが見つからない」エラーに対して、Anthropic Console でモデル一覧を確認させようとするが、
`console.anthropic.com` と `platform.claude.com` が同じページにリダイレクトされる。
モデル一覧を UI で確認する方法は現状存在しない。**コードを変えてデプロイして試すのが最速。**

### パターン3: ログが出ないことへの過剰反応
「ログに何も出ない」という情報だけで「webhookが届いていない」と判断しがち。
実際は join イベントがログ出力なしで無視されていただけだった。
**ログが出ない = webhookが来ていない、ではない。**
デバッグログを追加してから判断すること。
