# 乳量仮説モデル v0.1 実装報告

作成：2026-09-28。対象：`docs/MILK_MODEL_IMPLEMENTATION_PLAN.md`（計画ID `milk-implementation-plan-v1`）のP0〜P6。
対象リポジトリ：`/home/hddwm390/tmp/cooling-planner`（独立版。親プロジェクトへは触れていない）。

## 1. 実装したもの

- 式・モデルID：`milk-heat-deficit-v0.1`。`H=max(0,Qref−Q)`（1秒・地点ごと）、区域別滞在重みで加重した日負荷 `D`、同日反復モードで `E=D`、`Y=Y0−min(Y0×rmax, beta×E)`、beta 3条件感度。Y0=40、Qref=630 W、beta=0.010、rmax=0.25、遅れ重み 0.2/0.5/0.3、滞在 14/6/4 時間相当は初期値として固定値を変更していない。
- 代表日：準備24時間＋評価24時間の48時間、固定気象を反復、1秒刻み。屋根水・体表水・ON/OFF位相は日付をまたいで継続。各日の運転開始時刻で水周期をONから再開（ポリシー `daily-window-reset-v1`）。
- 保存形式：`schemaVersion: 9`、`model.version: cooling-integrated-v0.9`、アプリ版 `0.9.0-preview.1`。ローカル保存キー `cooling-planner-project-v9`。v8/v4/未知版は理由を表示して現在案を保持（自動変換なし）。
- Worker：`thermal-result` → `daily-result` の段階応答。全メッセージに jobId+inputHash。UIは日計算着までreadyにしない（「乳量を計算中…」）。日計算だけが失敗しても60分結果を保持する。再編集時はWorkerをterminateして旧結果を遮断する。
- UI：「乳量への参考影響」カード（Y・基準差・上限表示・状態理由）。「仮定と計算を見る」で Y0/beta を編集可（他は表示のみ）。設備の「日運転の開始」入力（0.25h刻み）をファン・水系統・屋根に追加。日資源カードは日計算の resources を使用。掲載6条件表は参照条件ダイアログへ資料として残置。

主な変更ファイル：

- 追加：`src/model/milk.ts`、`src/model/dailySchedule.ts`、`src/model/dailySimulation.ts`、`tests/unit/milk.test.mjs`、`tests/unit/dailySchedule.test.mjs`、`tests/integration/dailyMilk.test.mjs`
- 変更：`src/domain/project.ts`（schema 9・MilkSimulation・DailyMilkResult）、`src/data/defaults.ts`（初期値・provenanceの`milk-daily`）、`src/domain/validation.ts`、`src/state/store.ts`（updateMilk/resetMilk）、`src/model/simulation.ts`（mistDistributionの公開・dailyMilkプレースホルダ・ハッシュへmilkSimulationを含める）、`src/worker/protocol.ts`、`src/worker/simulation.worker.ts`、`src/main.ts`、`src/ui/panels.ts`、`src/ui/layout.ts`、`scripts/build-portable.mjs`（v0.9出力）、`scripts/make-examples.mjs`（日結果を含む）、`package.json`、`tests/e2e/test_browser.py`

## 2. MH01〜MH15の対応

`tests/unit/milk.test.mjs`・`tests/unit/dailySchedule.test.mjs`・`tests/integration/dailyMilk.test.mjs` に対応付けて実装・検証した。

| ID | 内容 | 対応試験 | 結果 |
|---|---|---|---|
| MH01 | 同一案の差は0 | dailyMilk `MH01: baseline and identical initial A give delta 0` | pass |
| MH02 | 欠損0でY=Y0 | milk `MH02: zero deficit` | pass |
| MH03 | Q>Qrefで増産しない | milk `MH03: Q above Qref gives H=0` | pass |
| MH04 | E=1200で上限、Y=30、上限到達を表示 | milk `MH04`＋`MH04 boundary`（E=999.9/1000/1000.1の固定期待値。境界値は上限到達） | pass |
| MH05 | 12時間200W欠損→D=100 | milk `MH05`＋統合 `clamp order discriminates`（実日集計の時間加重を秒系列から独立検証） | pass |
| MH06 | Q=430/830等重み→D=100、Q平均→不足の順序禁止 | milk `MH06`＋統合 `clamp order discriminates`（地点・時刻で閾値をまたぐ入力で、平均→クランプの誤式と1 W以上の差を確認） | pass |
| MH07 | D 300→100でY=37.4→38.4→39.0 | milk `MH07` | pass |
| MH08 | 再基準化は差だけ | milk `MH01/MH08/MH09`（deltaYieldの純粋関数試験、基準選択UIは追加しない） | pass |
| MH09 | 負の差を保持 | milk `MH01/MH08/MH09`＋統合 `negative delta is kept` | pass |
| MH10 | 日境界で残水・周期を引継ぎ、再初期化しない | 統合 `warmup water state carries across the day boundary`（評価開始水>0、引継ぎ分割計算が連続計算と一致、乾燥再開とDが異なる）＋dailySchedule `water cycle … across midnight`（7200を割り切れない周期で0:00直前後を独立期待値で確認） | pass |
| MH11 | 不正係数はnull/理由、無言で丸めない | milk `MH11`＋統合 `invalid milk settings … produce status+reasons` | pass |
| MH12 | beta 3条件は全案で共通 | milk `MH12`＋統合 `formula fields are internally consistent`（3条件・同一D） | pass |
| MH13 | 表示地点・カメラ・再生で牛群平均乳量不変 | 統合 `save/restore … hash`（view変更でinputHash不変）＋E2E `E13/E14/E22`（地点選択・時刻・計量でdailyMilk不変） | pass |
| MH14 | 保存・復元でモデルID・係数・気象・運転・結果が一致 | 統合 `save/restore keeps milk settings`（往復で日結果一致）＋E2E `E09`（保存/読込でhash一致） | pass |
| MH15 | 複合設備は同時計算したQを使い、設備別乳量を加算しない | 日計算はファン・水系統・屋根の統合マスクを同時に使用（単独寄与の加算なし）。統合 `timing interaction` でファンと湿潤時間の相互作用を確認 | pass |
| 参考 | 60分経路との数値一致（計画P3の要求） | 統合 `MH15: daily path reproduces the legacy 60-minute Q exactly`（全地点・全案で meanQrefW と日経路の時刻0–3600秒の平均が1e-6以内） | pass |

## 3. 段階（P0〜P6）の結果

- P0：`git status --short` で未コミット文書変更（AGENTS.md、README.md、docs/*、reference/thermal/MODEL.md、新規MILK_*2件）を確認し保持。ベースライン：typecheck成功、npm test 62件、Python thermal 17件・fertility 20件、すべて合格。
- P1：`milk.ts` を算術試験先行で実装。試験期待値の誤記（0.5を1.5と記載）を1件修正した以外は式どおり。
- P2：schema 9、`dailyStartHour`（[0,24)・0.25刻み）検証、milkSimulation検証、物理ハッシュへの混入、Undo/コピー取引に含まれることを確認（`updateDevice`/`updateSystem`/`updateRoof`/`updateMilk`は同一のsnapshotトランザクション）。
- P3：`dailySimulation.ts`。60分経路（`simulate()`、isOn・3600秒固定）は変更せず維持。日経路は `dailySchedule.ts` のマスクで駆動し、60分側へ二重に時間停止判定を適用しない（`windAt` へは `seconds=0` を渡し、`enabled`マスクで制御）。区域重みはProbe.kindから再構成し、欠損・未知kind・合計≠1は invalid_input（再正規化しない）。評価日の水量収支は評価開始水を含む式で検証し、開始水量自体も `waterCheck.roofStartKg`/`filmStartKg` として出力する（残差は <1e-6）。
- P4：Worker段階応答とResultGateを実装。日計算は同一設備案をキー `stableStringify(scenarioInput)` で再利用（基準と初期Aの重複計算を回避）。beta感度のため熱を再実行しない（Dは共通）。48時間×70点のPointSample配列は保存せず和・状態・収支のみ保持。時刻数に比例して増えるairCache/termsCacheは使わず、固定少数のメモ化（マスク変化時のみ）に留めた。
- P5：日乳量カード・詳細・開始時刻入力・保存復元を実装。E2E E22でカード表示・地点選択不変・beta編集・開始時刻編集を確認。
- P6：検証と配布物を更新。README・例・証跡JSONを生成。実装報告は本書。

## 4. 実行コマンドと結果

計画書のコマンドをそのまま実行（`python` はこの環境では `python3`）。

| コマンド | 結果 |
|---|---|
| `npm run typecheck` | 成功 |
| `npm test` | 99件合格（単体86＋統合13。ベースライン62件から+37） |
| `python3 -m unittest discover -s reference/thermal -v` | 17件合格 |
| `python3 -m unittest discover -s reference/fertility -v` | 20件合格 |
| `npm run build` | 成功。`cooling-planner-v0.9.html`（約1.2 MiB）と `dist-offline/` を生成 |
| `node scripts/make-examples.mjs` | 成功。examples 4件（schema 9）と `evidence/integrated-example-results.json`（dailyMilk込み）を生成 |
| `npm run test:browser`（単体HTML） | 22件合格（約134秒） |
| `COOLING_PLANNER_URL=http://127.0.0.1:4173/ npm run test:browser`（HTTP版） | 22件合格（約131秒） |
| `git diff --check` | クリーン |

## 5. 性能測定

環境：Node v24.13.0、x86_64、16コア。計測は同一プロセス内3回（`performance.now()`）、メモリは `process.memoryUsage().heapUsed`。

| 条件 | 60分結果（3案・3プロファイル込み） | 日計算（3案） | ヒープ最大 |
|---|---|---|---|
| 標準配置 | 1370/1297/1295 ms | 161/136/82 ms | 約20 MB |
| 40ファン・100ノズル・屋根散水ON（案Aのみ編集） | 2895/2928/2747 ms | 4577/4573/4644 ms | 約54 MB |

ブラウザ（headless Chromium、SwiftShader）の標準初回計算は `lastCalculationMs` 約1.0秒（60分＋日計算の合計、HTTP版E01計測）。初期目標「標準日計算10秒以内」を両条件で満たす。重量条件では屋根散水が濡れている間は1秒ごとの屋根・体表更新が残るため、日計算が60分計算より遅い点は既知の挙動。

日計算の高速化は「マスク・屋根状態が変わらない区間を1ストレッチとして処理」「風速は案別のファンマスクでメモ化」「収支は評価区間のみ加算」に限定し、時間刻み・レイ数・地点数は削っていない。

## 6. 計画からの差分

- `npm run test:browser` の呼び出しを `python` → `python3` に変更（この環境に `python` コマンドが存在しないため）。pytestの挙動は同一。
- ブラウザテストは `CHROMIUM_PATH` で既存キャッシュの headless shell（chromium_headless_shell-1234）を指定して実行。インストール済みPlaywrightが期待する1223が無かったため。テスト本体の変更ではない。
- `dailyResources` は熱ループ内の逐次加算ではなく、同じ `fanOn`/`waterOn`/`roofSprayOn` を評価日範囲で独立に積算する関数として分離。熱側と同一の純粋関数を共有するため運転判定は一致（統合試験で `onTotalSeconds` 解析値・屋根23:00開始4時間の秒数を確認）。
- `SimulationResult.dailyMilkStatus` は `pending` のまま60分結果を返し、`daily-result` で `complete|error` に確定する。日結果は `ScenarioResult.dailyMilk` にマージする。
- `waterCheck` は計画の残差に加えて評価開始時の水量（`roofStartKg`・`filmStartKg`）を含める。残水引継ぎを残差だけでなく入口値で直接確認するための拡張（レビュー指摘1の対応）。
- 日経路のテスト用フックとして `simulateDaily` の引数に `warmupSec`/`evalSec` 上書き、`collectQ`（地点別平均Q）、`collectQSeries`（地点別の秒系列）、`initialState`/`returnState`（暖機終了状態の注入・取得）を残した。UI・Worker経路では使わず、MH15パリティ・集計順序・残水引継ぎ（MH10）の検証にのみ使用。
- レビューで発見した実装不具合を修正：`lossCapped` を `raw>cap` から `raw>=cap` に変更（E=1000 Wで低下10 kg・上限到達なのに表示されなかった）。
- 比較カードに日乳量行（Yと基準差）を追加（計画の主表示に準拠する範囲）。
- 掲載乳量表のカードは結果列から削除し、参照条件ダイアログに資料として残置（計画どおり）。

## 7. 追加した仮定・既知の制限

- `demo_assumption` の係数は文献回帰値ではなく、信頼区間でもない。実農場検証は未実施。
- 同日反復モードでは `E=D`。`lagWeights` は将来の複数日拡張用で、初版では検証のみ。
- 「その他」区域はロボット前8地点を代理とする設計仮定。
- 日運転の周期は各日の運転開始時刻でONから再開（`daily-window-reset-v1`）。午前0時でのリセットは行わない。
- 準備期間の資源量は日使用量に含めない。
- 受胎・掲載乳量表・60分結果は従来経路のまま。日乳量の気象・放熱は受胎に接続していない。
- 日計算中にWorkerへcancelメッセージを割り込ませない実装のまま（再編集時はterminate）。計画の想定どおり。
- 温度・放熱カードは機器ONから60分の平均を維持し、日乳量は別モデルとして表示。

## 8. 未達の受入条件

- 現時点で未達は確認していない。公開HTTPS・`file://`・実機ブラウザ全組合せの確認は従来どおり対象外。
- 時間別気象入力・個体移動・体温/代謝・自動最適化・旧JSON自動移行・設備切替後の乳量時系列UIは計画どおり後続へ分離。

## 9. 配布物と対応

- `cooling-planner-v0.9.html`：`src/` → `.compiled` → `scripts/build-portable.mjs` の出力。Workerソースは `__DCS_WORKER_SOURCE__` として内包。
- `dist-offline/`：`index.html`/`styles.css`/`app.js`/`worker.js`。`npm start` で配信（`http://127.0.0.1:4173/`）。
- `public/worker.js`：HTTP版のWorkerバンドル。
- `examples/01〜04*.json`：schema 9の読込可能例。
- `evidence/integrated-example-results.json`：`simulate()`＋`simulateDaily()`の統合結果（dailyMilkを含む）。
- `evidence/browser/`：E2E実行の画面・メトリクス（Git管理外）。
- 旧 `cooling-planner-v0.8.html` は計画どおり残置。E2Eの読込先は `cooling-planner-v0.9.html` に更新済み。

コミット・push・公開は依頼範囲外のため未実施。
