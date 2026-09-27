# Cooling Planner独立版の作成・検証

日付：2026-09-27。

## 作成したもの

Dairy Horizon配下の `cooling-planner/` から必要ファイルをコピーし、
`cooling-planner-standalone/` を独立したGitリポジトリとして初期化し、
その後 `~/tmp/cooling-planner/` へ移した。
Git履歴は新規に開始する。親プロジェクトのPythonアプリ、データ、環境ファイルは含まない。

元フォルダーは維持した。切り出し後の `src/` と元の `src/` を比較し、差分がないことを確認した。
表示担当が作成したThree.js実装を引き継ぎ、計算式・係数・モデルID・保存形式を変更していない。
モデルの課題は [評価文書](MODEL_REVIEW_2026-09-27.md) に記載したままである。

## 独立版で変更したもの

- READMEを単独プロジェクトの依存取得・ビルド・起動・検証手順に更新。
- ブラウザ試験は既定でヘッドレス実行とし、固定のXvfb番号と `/usr/bin/chromium` への依存を除去。
- `CHROMIUM_PATH` で既存ブラウザを選択可能。省略時はPlaywright管理のChromiumを使う。
- `COOLING_PLANNER_URL` を指定したHTTP操作試験を追加。WebGL利用不可試験だけは常に単体HTMLを使用する。
- Three.jsのMITライセンス本文をビルド済みJS・単体HTML・配信フォルダーへ同梱。
- 環境ファイル、仮想環境、検証出力をGit管理対象から除外。
- ソースと生成済み配布物をGit管理する構成。ソース変更時は `npm run build` で配布物も更新する。
- 独立版用の `AGENTS.md` を追加し、Dairy Horizon専用のPhase 1規則を引き継がないことを明記。
- v0.8の実装報告が参照する当時の証跡を `docs/evidence-v08/` へ保存。独立版の再検証結果とは区別する。

## 検証結果

環境：Node.js 24.13.0、TypeScript 5.8.3、Python 3.12、Linux上のChromiumヘッドレス。
この環境ではPlaywright管理の既定版が未インストールだったため、既存のChromiumを `CHROMIUM_PATH` で指定した。

| command / 確認 | result |
|---|---|
| `npm ci --cache /tmp/cooling-planner-npm-cache --no-audit --no-fund` | 成功。独立フォルダー内へ依存取得 |
| `npm run typecheck` | 成功 |
| `npm test` | 62件成功 |
| `python3 -B -m unittest discover -s reference/thermal -q` | 17件成功 |
| `python3 -B -m unittest discover -s reference/fertility -q` | 20件成功 |
| `python3 -m compileall -q tests reference` | 成功 |
| `node --check scripts/build-portable.mjs`、`node --check scripts/export-standalone.mjs` | 成功 |
| `npm run build` | 成功。Three.js同梱の単体HTML・HTTP配信物生成 |
| `HOST=127.0.0.1 PORT=4188 npm start` | 起動成功 |
| `COOLING_PLANNER_URL=http://127.0.0.1:4188/ python3 -m pytest tests/e2e -q --tb=short -x`（`CHROMIUM_PATH`指定） | 21件成功、108.24秒 |
| `python3 -m pytest tests/e2e -q --tb=short -k 'E01 or E02'`（URL指定なし、`CHROMIUM_PATH`指定） | 最終ビルドの単体HTMLで初期3D・遮熱変更の2件成功 |

ブラウザ試験は、初期3D表示、遮熱・断熱変更、全地点再計算、ドラッグ、Undo、案比較、
JSON保存・復元、390px表示、屋根散水、Worker結果の整合、2Dフォールバックを含む。
HTTP版の20件と、単体HTMLのWebGL利用不可試験1件を実行した。

## 残る制限

- 公開HTTPS、`file://`、実機Chrome/Edge/Safariの全組合せは未検証。
- 科学的な精度や実牛舎との一致は今回の検証対象外。
- 元フォルダーで今後追加される変更は自動同期しない。今後の開発先は独立版へ統一するか、変更を明示的に移す。
- リモートリポジトリの作成・送信は、作成先と公開範囲の指定に従う。

以前の [切り出し手順](STANDALONE_REPOSITORY.md) のブラウザ失敗記録は当時の一時コピーの結果であり、
今回の独立版の検証結果は本書を参照する。
