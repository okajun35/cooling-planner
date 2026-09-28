# MCP PoC 実装報告

実装日：2026-09-28。対象：`docs/MCP_POC_IMPLEMENTATION_PLAN.md`（計画は文書のみ、本書が実装側の記録）。

## 構成

計画どおりの3要素。

- `scripts/mcp-server.mjs`：stdioのMCPサーバー。`dist-offline` を `http://127.0.0.1:4174` で配信し、`/bridge` のWebSocketで開いているブラウザへ `{id,command,args}` を中継する。Projectのコピーや計算エンジンは持たない。
- `src/mcp/commands.ts`：5ツール相当の処理を実Storeと注入された状態取得関数で実行するアダプタ。`createCommands(deps)` が `{get_state, edit, set_view, get_results, undo}` のディスパッチ表を返す。
- `src/mcp/bridge.ts`：`location.protocol==='http:'` かつ `?mcp=1` のときだけ `ws://<host>/bridge` へ接続し、受信した操作を実行して `{id,ok,data|error}` を返す。`main.ts` 末尾でstore・`currentResult`・pending/invalid/calculating・workerError・stopPlaybackを注入して開始する。接続断はページ再読込で再接続（閉イベントのreasonをトースト表示）。

## 使用SDKと依存

- `@modelcontextprotocol/server` **2.1.0**（v2系・2026-07-28 specのstable line。パッケージ名・import・`serveStdio`/`McpServer`/`registerTool` APIはv2で統一、v1の `@modelcontextprotocol/sdk` は未使用）
- `zod` 4.6.5（ツール入力スキーマ用、`zod/v4` import）
- `ws` 8.22.0（Node側WebSocketサーバー。ブラウザ側は標準WebSocket）
- すべて `package.json`・`package-lock.json` で固定。ブラウザ配布物へは同梱しない（`dist-offline` のapp.js/worker.jsにSDK・zod・wsは含まれない）。

## クライアント設定と接続手順

README「MCP PoC」節に記載。要約：

```json
{ "mcpServers": { "cooling-planner": { "command": "node", "args": ["<repo>/scripts/mcp-server.mjs"] } } }
```

`npm ci && npm run build` 後、AIクライアントからstdio接続し、`http://127.0.0.1:4174/?mcp=1` を1タブで開いて `get_state` を呼ぶ。`npm run mcp` は同じサーバーの手動起動用。

## 確認結果

`tests/integration/mcpCommands.test.mjs`（11件、node:test、実Store使用）：patch対象外・種別不適合・内部フィールドの拒否、基準案編集の拒否伝播、編集→Undoの往復、copy_to_otherの切替、地点→区画の選択連動、stale inputHashの結果を返さないこと、editing/pending/worker-errorで数値を返さないこと。

`tests/e2e/test_mcp.py`（7件、Playwright+実Chromium、生のJSON-RPC stdio会話）：計画9節の完了条件を実ブラウザで確認。

- 接続：initialize→tools/listで5ツール、get_stateが開いている画面の案・inputHash・70地点・7区画を返す。
- 選択共有：画面で `#probe-select` をstall-A-01へ変更後、get_stateが同地点を返す。
- 設備編集：edit(update_device)で画面のファン位置・向きが変わり、再計算される。
- 表示編集：set_viewでmetric/mode/地点が画面の選択・色表示に反映され、Undoに積まれない。
- 計算結果：編集後のinputHashとget_resultsが一致し、地点のmeanQrefWが画面の結果と一致。
- 計算途中：熱のみの段階はstatus `thermal_ready`・dailyMilkStatus `pending`（アダプタの単体確認）。
- 比較：AをBへcopy_to_other後にBの屋根だけ変更し、A/Bの結果を読める。
- Undo：MCPのundoで最後の編集が画面・結果ともに戻る。
- 最小例外：基準案編集・未知patchキー・未知operation・ブラウザ未接続・2タブ目接続（close 4409+トースト表示）・不正Originが短いエラーで終了する。
- 通常起動：`?mcp=1`なしのHTTP版・単体HTMLで既存操作が動く（test_browser.py 25件も同時に全通過）。

実行：`npm run typecheck`、`npm test`（131件）、`npm run build`、e2e 32件、`reference/thermal`・`reference/fertility` のPythonテスト（17+20件）を全て確認済み。生成済みHTMLと `dist-offline` は最新ビルド済み。

### 実在クライアント（Devin CLI）での確認

devin 3000.11.3 で `devin mcp add cooling-planner -- node <repo>/scripts/mcp-server.mjs` を実行し、`.devin/mcp_config.local.json` へ登録。Devinセッションからtools/listで5ツールを取得し、`get_state`（実画面の案・inputHash・70地点）、`get_results`（status ready・日別乳量complete・区画統計）、`edit`（fan-feeding-1のx=10へ移動→inputHash変更・undoCount=1）、`undo`（inputHashが元の ea92ad34e0ca6bd7 へ復帰）を実ブラウザタブ経由で確認した。

登録時に判明し修正した点：

- stdioクライアント切断後もHTTPリスナーがイベントループを保持し、サーバーが孤児プロセスとして残りポート4174を占有していた。`stdin` の `end`/`close` でブラウザWS切断→HTTP close→終了するよう修正（残留時の二重起動はEADDRINUSEの明示メッセージ付きで終了）。
- ポートを `COOLING_PLANNER_PORT` 環境変数で変更可能にした（既定4174。ブラウザは開いたページのポートへ自動接続）。e2eは4180を使用し、常駐サーバーと競合しない。

## 既知の制限・未確認事項

- Devin CLI（3000.11.3）で動作確認済み。他クライアント（Claude Code/Cursor等）は未確認だが、同じstdio JSON-RPC 2025-06-18系でserveStdioを共有するため想定どおり動くはず。クライアント固有の要求（プロンプト・リソース一覧等）はこのサーバーが提供しない。
- AIクライアントと手動起動（`npm run mcp`）の同時実行はポート競合で後から起動した側が終了する。1プロセス1ブラウザタブ前提のPoC仕様。
- WebSocketは `Origin: http://127.0.0.1:<PORT>` のみ許可（既定4174）。`localhost` や別ホスト名で開いたページは中継しない。
- 同時呼び出しはbusyエラーで打ち切り。タイムアウト10秒。応答遅延の自動再送なし。
- PoC対象外（計画どおり）：アプリ内チャット、Bedrock・クラウド接続、ログイン、DB、複数ユーザー・複数タブ、MCP Resources/Prompts、スクリーンショット、ブラウザ自動起動、独自の履歴・監査・最適化。
- 「MCPから操作できたこと」と「モデルの実牛舎での妥当性」は別。計算式・係数・保存スキーマは変更していない。

## 変更したファイル

- 追加：`scripts/mcp-server.mjs`、`src/mcp/commands.ts`、`src/mcp/bridge.ts`、`tests/integration/mcpCommands.test.mjs`、`tests/e2e/test_mcp.py`、`tests/e2e/conftest.py`
- 変更：`src/main.ts`（workerErrorの保持とbridge起動）、`package.json`（依存と `npm run mcp`）、`package-lock.json`、`README.md`、`docs/THIRD_PARTY_NOTICES.md`、`tests/e2e/test_browser.py`（session fixtureをconftestへ移動）、生成物 `cooling-planner-v0.9.html`・`dist-offline/`
