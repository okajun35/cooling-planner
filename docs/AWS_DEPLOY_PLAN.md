# AWS デプロイ実装計画 v0.1

Cooling Planner を AWS に公開し、リモートから MCP で計算を呼べるようにするための実装計画。

## 構成

```
Amplify Hosting (静的サイト, dist-offline)
Lambda API Function (Function URL, POST /simulate) ─┐
                                                  ├─ Cooling Core (src/model + src/domain)
Lambda MCP Function (Function URL, /mcp)         ─┘
```

- UI は既存の静的ビルド `dist-offline/` をそのまま配信する。計算はブラウザ内 Worker が行うため、REST Lambda は UI には不要で、外部 REST 利用者向けの任意コンポーネント。
- 計算コアは `src/model`・`src/domain`・`src/state`（ProjectStore）・`src/data` を esbuild でバンドルし、API / MCP 両 Function が共有する。ロジックの複製はしない。
- IaC は `aws/infra/` の CDK(TypeScript)。デプロイ全体は `aws/deploy.mjs` が orchestrate する。

## リモート MCP の契約（ローカル版との違い）

ローカル `scripts/mcp-server.mjs` は「開いているブラウザ画面」を操作する状態ありブリッジ。Lambda 版はブラウザが存在しないため**ステートレス計算 API** とする別契約。操作語彙（`update_device` 等の operation）はローカル版と同一を再利用し、`src/mcp/commands.ts` の `createCommands` をそのまま使う。

| ツール | 内容 |
|---|---|
| `get_default_project` | 既定 Project JSON + 地点/区画ID一覧。エージェントが入力を組み立てる起点 |
| `evaluate` | `{project?, scenarioId?, operations[], includeDaily?}`。project省略時は既定。操作を複製へ適用して計算し、結果と適用後projectを返す（往復で逐次編集可能） |
| `describe_model` | `{project?}`。モデルの計算構造・仮定・限界（`describeModel` + MODEL_NOTES） |

- トランスポート: `@modelcontextprotocol/server` v2 の `createMcpHandler`（Streamable HTTP, stateless）。応答は `responseMode:'json'`（SSE 不使用）。
- `get_state` / `edit` / `undo` / `set_view` / `get_results`（画面セッション依存）はリモートでは提供しない。

## 認証

- Function URL `authType: NONE` ＋ハンドラ内で `Authorization: Bearer <token>` を検証（不一致は401 + `WWW-Authenticate`）。IAM認証は一般MCPクライアントがSigV4署名できないため使わない。
- トークンはデプロイ時に生成し `aws/deploy.local.json`（gitignore）に保持、CDK context 経由で Lambda 環境変数へ設定。Lambda の環境変数を読める人には見える前提の最小構成。OAuth 2.1 対応・API Gateway/WAF 前置は将来課題。

## 作業項目

- [ ] `src/mcp/commands.ts`: `MODEL_NOTES` を export（共有のみ、動作不変）
- [ ] `aws/lambda/core.ts`: project→ProjectStore→createCommands で `evaluate` を再現する共有部品
- [ ] `aws/lambda/mcp.ts`: Function URL event → web Request 変換 + Bearer 認証 + `createMcpHandler`
- [ ] `aws/lambda/api.ts`: `POST /simulate` / `GET /model` / `GET /health`
- [ ] `aws/infra/`: CDK（Lambda×2, FunctionUrl×2, Outputs）
- [ ] `aws/deploy.mjs`: build → esbuild → cdk deploy → URL表示
- [ ] 検証: `npm run typecheck` / `npm test` / `npm run build` / `tsc -p aws` / curl で MCP initialize・tools/call・Amplify 200

## Amplify と GitHub 連携

GitHub接続済みAmplifyアプリ（コンソールで作成）が `main` へのpushをトリガーに `amplify.yml` でビルド＆デプロイする（`okajun35/cooling-planner`、branch: main、artifacts: dist-offline）。スタック側の手動デプロイ用Amplifyリソースは削除済み。

## 既知の制限

- 公開エンドポイントは Bearer トークン共有のみの保護。スロットリング・WAF なし（API Gateway 化で対応可能）。
- `includeDaily:true` の日乳量計算は数十秒かかる → Lambda timeout 180s / memory 1024MB。
- リモート MCP でセッション永続はしない。`evaluate` が返す `project` を次回入力に使う。
