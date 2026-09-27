# Cooling Planner v0.8 preview

モデル牛舎で設備を操作し、環境と牛の放熱を比べるブラウザアプリです。既存v0.4の幾何・物理・編集機能を再利用し、画面と計算の接続を組み直しました。

このリポジトリはDairy Horizonから切り出した独立版です。FastAPI・APIキー・親プロジェクトは不要です。
Node.js 22.12以上で、初回は `npm ci && npm run build`、以降は `npm start` で起動します。
ソースとビルド済み配布物を管理し、変更時は配布物も再生成します。

## まず動かす

`cooling-planner-v0.8.html` は、CSS・JavaScript・計算Workerを内包した単体ファイルです。ZIPを展開し、PCのChrome/Edge等で開いてください。インターネット接続、ログイン、APIキーは不要な構成です。ブラウザの制限でローカルファイルを開けない場合は、下のローカルHTTP配信を利用してください。

検証範囲と結果は [独立版の検証記録](docs/STANDALONE_VALIDATION.md) に記載します。
公開HTTPS、`file://`、実機のChrome/Edge/Safariの全組合せを確認したものではありません。

### 最初の操作（3〜5分）

1. 初期計算の完了を待つ。初期の「編集案A」は基準案の複製なので、放熱差0Wが正常です。
2. 左の「遮熱塗装」「断熱材20mm」をONにする。採食7では局所気温36.5→33.0℃、放熱差は約+384Wになります。この値はモデル計算です。
3. ファンをクリックしてドラッグ、または左の設備選択から「採食帯 ファン1」を選び、高さ・向きを変更する。背景ドラッグは視点回転です。「戻す」で1回の移動を戻せます。
4. 「放熱量／気温／保持水」と再生・時刻スライダーで、固定気象60分間の結果を見る。カードと床の色は60分平均のままです。
5. 「掲載条件を見る」で乳量の表と受胎の代表条件を確認する。「案を保存」で配置・条件をJSONに保存し、「読込」で復元する。

**基準案は無設備ではありません。既存ファン10台＋ソーカー12個、屋根対策なしです。** 編集案Bの初期状態は、同じファンでソーカー停止・ミスト稼働です。Bの負の放熱差は、この基準との比較であり「ミストに効果がない」という意味ではありません。

## ビルドとテスト

開発条件：Node.js 22.12以上、TypeScript 5.8.3。3D描画はThree.js 0.180.0（npm依存としてビルド時に同梱）。ブラウザ実行時の外部通信・CDNは不要です。

```sh
npm ci
npm run typecheck
npm test
npm run build
npm start
```

`npm start` は `http://127.0.0.1:4173/` で `dist-offline` を配信します。`PORT` 環境変数でポートを変更できます。ビルド済み配信物だけを見る場合、`npm install` や再ビルドは不要で、Nodeがあれば `npm start` を使えます。

ビルド出力：

- `cooling-planner-v0.8.html`：単体HTML。
- `dist-offline/`：静的配信用のHTML/CSS/app.js/worker.js。フォルダー全体を配信対象にします。

ブラウザテストはPython Playwright/pytestとChromiumを使います。既定ではヘッドレス実行でXvfbは不要です。
`CHROMIUM_PATH` で既存のChromiumを指定でき、省略時はPlaywright管理のChromiumを使います。
有画面で実行する場合は、表示環境を用意したうえで `HEADLESS=0` を指定します。

```sh
python -m pip install -r requirements-test.txt
python -m playwright install chromium
npm run build
npm run test:browser
```

既定では単体HTMLのインライン実行を確認します。別ターミナルで `npm start` を起動し、
`COOLING_PLANNER_URL=http://127.0.0.1:4173/ npm run test:browser` とするとHTTP版を確認できます。
WebGL利用不可の試験は、この設定時も単体HTMLを使用します。

Python参照実装の確認：

```sh
(cd reference/thermal && python -m unittest -v)
(cd reference/fertility && python -m unittest -v)
```

`node scripts/make-examples.mjs` で、検証済みの入力例と統合計算結果を再生成できます。先に `npm run build` を実行してください。

## 保存形式

`schemaVersion: 8`。配置・屋根条件・気象・係数・参照モデルの仮定・表示設定を保存します。v0.4のJSONは自動変換せず拒否し、現在の案を保持します。既存のv0.4本体・データを別途残してください。

「結果JSON」はプロジェクトと計算結果を合わせた検証・共有用ファイルで、配置読込用JSONとは別です。配置の復元は「案を保存」で出力したファイルを使います。

端末内保存は使えるブラウザで行いますが、初回起動は必ず標準デモから始めます。「共通設定・保存」から端末内保存を復元できます。案JSONは端末内保存が使えない環境でも利用できます。

## モデルの対応範囲

- フリーストール1テンプレート・50床・70独立評価点。CFDや実農場の精度保証ではありません。
- 熱・水は固定気象60分、基本1秒刻み。再生は計算済みサンプルの表示です。
- 送風体感温度、放熱改善W、乳量、受胎は別の意味の指標です。
- 乳量は全酪連掲載6条件・RH60〜70%・静的条件のみ。未掲載値はnull、補間・外挿なし。
- 受胎は5期間のTHI区分と仮の基準受胎率から計算する参考シナリオ。初期値は独立した代表26℃・RH70%、基準受胎率40%。設備から自動的に総合受胎改善を算出するものではありません。
- 60分平均を授精前後52日の代表条件へ適用する場合は、参照条件画面のチェックで明示的に選びます。ファン・ソーカーの放熱WをTHIへ変換しません。
- 5期間別のTHIを渡す関数はありますが、初版UIは全期間共通の代表条件だけです。

## ファイル案内

`docs/IMPLEMENTATION_REPORT.md`：作り直した意図・実装内容・数値結果・検証・残件。

`docs/DECISIONS_v0_8.md`：統合時に固定した実装契約。

`docs/REUSE_MAP.json`：v0.4とのファイル別比較とSHA-256。

`evidence/`：この版で実行したテストログ・実画面・計算結果。

`reference/`：照合に使用した元のPythonモデルと仕様。

`examples/`：読込可能なschema8の配置例。

## 課題と独立リポジトリ化

- [遮熱モデルと乳量参照表示の課題](docs/MODEL_REVIEW_2026-09-27.md)：評価結果、感度確認、未実装の改善候補。
- [単独リポジトリへの切り出し](docs/STANDALONE_REPOSITORY.md)：必要ファイルの書き出し、独立したビルド・起動、Git初期化の手順。
