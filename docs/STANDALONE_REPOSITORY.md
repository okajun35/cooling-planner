# Cooling Plannerを単独リポジトリにする

作成日：2026-09-27。

独立版を作成済み。最新の起動・テスト手順は [README](../README.md)、
検証結果は [STANDALONE_VALIDATION.md](STANDALONE_VALIDATION.md) を参照する。
以下は元プロジェクトからの書き出し手順と初回調査の記録であり、
Xvfbの固定利用やブラウザ失敗は独立版で更新されている。

## 結論

`cooling-planner/` を新しいリポジトリのルートにできる。
アプリ、計算Worker、型、テスト、Python参照実装、ビルド・起動スクリプトはこのフォルダー内にある。
Dairy HorizonのFastAPI、ルートの `app/`、`data/`、`.env`、OpenAI APIキーは不要。

Three.js対応の変更は現在のソースに含まれる。最終的な切り出しは別エージェントの編集完了後に行う。
書き出し処理は編集中のファイルを固定する機構を持たないため、途中のコピーを最終版としない。

## 1. ソースを書き出す

元の `cooling-planner/` で次を実行する。出力先の親ディレクトリは作成済みで、
出力先そのものは存在しない必要がある。相対パスも指定できる。

```sh
node scripts/export-standalone.mjs /path/to/new/cooling-planner
```

既存の出力先には上書きせず失敗する。元ファイルの移動・削除・Git操作は行わない。
コピー中に失敗した場合は途中の出力先が残る。内容を確認し、次は新しい出力先で実行する。
シンボリックリンクは外部依存や意図しないコピーを避けるため拒否する。

含めるもの：`src/`、`tests/`、`scripts/`、`docs/`、`reference/`、`examples/`、
依存定義とロックファイル、TypeScript設定、HTML入口、README、Windows起動ファイル、テスト依存定義、`.gitignore`。

含めないもの：`node_modules/`、`.compiled/`、`.git/`、環境ファイル、Pythonキャッシュ、
過去の `evidence/`、生成済みHTML、`dist-offline/`、生成Worker、旧配布物の `MANIFEST.sha256.json`。
過去の証跡を新しい版の検証結果として持ち込まず、出力先でビルド・検証し直す。
`docs/` 内の過去報告は履歴資料として残る。記載された過去版・ログ・旧ファイルへの参照は、
現在の独立版で存在することや検証済みであることを意味しない。

## 2. 独立したフォルダーで起動する

Node.js 22.12以上とnpmを使用する。初回依存取得にはネットワーク接続が必要。

```sh
cd /path/to/new/cooling-planner
npm ci
npm run typecheck
npm test
npm run build
npm start
```

ブラウザで `http://127.0.0.1:4173/` を開く。
ローカル端末だけに配信する場合は `HOST=127.0.0.1 npm start` とする。
サーバーの既定バインド先はWSL対応のため `0.0.0.0`。

`npm run build` により `dist-offline/` と `cooling-planner-v0.8.html` を生成する。
Three.jsはビルド時に同梱するため、生成物の実行時にCDN・APIサーバーは不要。
`START_WINDOWS.bat` はビルド後の単体HTMLを開く。ソース書き出し直後にはまだ使えない。

静的ホスティングでは `dist-offline/` 全体を配信する。
単体HTMLの `file://` 動作、配信時CSP、実機ブラウザ対応はそれぞれ確認する。
インライン実行やBlob Workerを使うため、ビルド成功だけで任意の配信環境への対応を保証しない。

## 3. テスト

```sh
npm run typecheck
npm test
(cd reference/thermal && python3 -B -m unittest -v)
(cd reference/fertility && python3 -B -m unittest -v)
```

ブラウザ試験はPythonのpytest・Playwright、LinuxのXvfb・Chromiumが必要。
必要な依存は `requirements-test.txt` とREADMEを参照し、ビルド後に `npm run test:browser` を実行する。
同じ端末で別の試験が動いている場合、既存テストが固定使用するXvfbの `:94` と競合しないようにする。
ブラウザ試験はHTMLを `about:blank` へ読み込む方式で、HTTP配信確認とは別である。

## 4. Gitリポジトリにする

編集完了後のコピーで動作を確認してから、新しいフォルダー内で実行する。

```sh
git init -b main
git add .
git status --short
git commit -m "Initial standalone Cooling Planner"
```

ステージ対象にはビルド後の配布物が含まれる。配布物も管理するか、CI・リリースで生成するかは
独立リポジトリの運用方針として決める。元のDairy HorizonのGit履歴はこの方法では引き継がない。
独立版の作業規約を作る際は、Dairy Horizon専用のPhase 1制限をそのままコピーしない。

GitHub等への公開は、作成先アカウント・リポジトリ名・公開範囲が決まってから別途行う。
今回の書き出しスクリプトはリモート作成・pushを行わない。
既存コードと依存の権利・出典は [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を引き継ぐ。

## 5. 関連する未解決課題

[遮熱モデルと乳量参照表示の評価](MODEL_REVIEW_2026-09-27.md) を参照。
単独化で計算精度や乳量の適用範囲が変わるわけではない。

## 6. 今回の独立コピーでの検証（2026-09-27）

元フォルダーとは別の一時ディレクトリへ書き出し、新しく依存を取得して確認した。

| command / 確認 | result |
|---|---|
| `node --check scripts/export-standalone.mjs` | 成功 |
| 書き出し、既存宛先拒否、ソース内宛先拒否、シンボリックリンク経由のソース内宛先拒否 | 成功 |
| `npm ci --cache <一時キャッシュ> --no-audit --no-fund` | 成功。親フォルダーのnode_modulesを再利用していない |
| `npm run typecheck` | 成功 |
| `npm test` | 62件成功 |
| `npm run build` | 成功。Three.js同梱の単体HTMLと静的配信物を生成 |
| 各 `reference/thermal`・`reference/fertility` で `python3 -B -m unittest -q` | 17件・20件成功 |
| `HOST=127.0.0.1 PORT=4187 npm start` とHTTP取得 | HTML・JS・Worker・CSSの4ファイルが200 |

ブラウザ試験の制限：

- 既存の標準試験は、この環境に `/usr/bin/chromium` がなく、そのままでは起動できなかった。
- インストール済みChromiumのパスを指定しても、Xサーバーが使えず有画面試験は起動できなかった。サンドボックス外でも同じ結果だった。
- 一時コピーのテストだけを `headless=True` に変更して実行した。元のテストファイルは変更していない。
- 全件実行は表示・操作テストの失敗と待機が続いたため中断した。全件成功とは扱わない。
- `python3 -m pytest tests/e2e -q --tb=short -k 'E01 or E02'` で再確認し、1件成功・1件失敗。
  E02の遮熱・断熱変更と全地点再計算は成功。E01は `canvas[data-testid=scene3d]` が0件で失敗した。
- Three.js変更途中のコピーであり、失敗がセレクター変更・描画初期化・実行環境のどれに起因するかは今回未診断。
  表示担当の変更完了後に、最終ソースを書き出し直してブラウザ黄金経路を再確認する。

独立した依存取得・計算・ビルド・HTTP配信は確認できたが、最終表示版の受入完了ではない。
GitHub等へのリモートリポジトリ作成・公開は行っていない。
