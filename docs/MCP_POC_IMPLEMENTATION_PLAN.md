# Cooling Planner — MCP PoC 実装引継ぎ

更新日：2026-09-28。状態：**実装済み**（報告：[MCP_POC_IMPLEMENTATION_REPORT.md](MCP_POC_IMPLEMENTATION_REPORT.md)）。
本書は別のLLMが実装するための引継ぎとして作成された。

## 1. 作る体験

ユーザーは牛舎の画面を開き、外部のMCP対応AIクライアントで相談する。

> 「今選んでいる牛は、なぜ放熱が少ない？」
> 「このファンの位置を変えて試して」
> 「変更前を編集案Aに残して、Bで試して」
> 「水使用量と放熱不足を比べて。いまの変更は戻して」

AIの操作で、**ユーザーが見ている画面そのものの配置・選択・結果が変わる**ことがPoCの中心。
人が画面で選択・編集した内容も、次のツール呼び出しでAIに伝わる。
入力フォームを中心とする別アプリには作り替えない。

実装対象はこの独立リポジトリのみ。`daily-horizun-v3`等への変更・同期は行わない。

## 2. PoCの範囲

- ローカルPC、利用者1人、AIクライアント1つ、接続するブラウザタブ1つ。
- 外部AIクライアントがLLM・会話履歴を担当する。
- MCPはstdio接続。AIクライアントがNodeプロセスを起動する。
- ブラウザにある既存のProjectStoreとWorkerをそのまま使う。
- 設備編集、屋根・共通気象の変更、案の切替・コピー、結果取得、表示変更、Undo。
- シミュレータは配置変更後に既存経路で自動再計算する。

PoCにはアプリ内チャット、Bedrock接続、クラウド配備、ログイン、DB、課金、複数ユーザー、
遠隔接続、独自の最適化、自動探索ループ、独自の履歴・監査基盤を追加しない。
MCP Resources/Prompts、スクリーンショット、ブラウザの自動起動も必須にしない。
計算式・係数・保存スキーマを変更しない。LLMは既存の数値結果を読んで操作・説明する。

## 3. 構成を固定する

```text
外部AIクライアント（LLM・会話）
       │ MCP / stdio
       ▼
Nodeプロセス：scripts/mcp-server.mjs
  ・MCPツールを登録
  ・dist-offlineを http://127.0.0.1:4174 で配信
  ・ブラウザとのWebSocket /bridgeを中継
       │ 同じローカルサーバーへのWebSocket
       ▼
ブラウザ：http://127.0.0.1:4174/?mcp=1
  src/mcp/bridge.ts → src/mcp/commands.ts
       │
       ▼
既存のProjectStore → 既存の再描画・Worker計算
```

Node側にはProjectのコピーや計算エンジンを持たせない。状態の正本は開いているブラウザ。
別プロセスだけで計算して、画面とは異なる配置を返す実装は完了としない。

追加依存は公式MCP SDK、そのスキーマ用依存、Node側の`ws`程度に留める。
ブラウザは標準WebSocketを使う。HTTP配信はNode標準`http`でよい。
MCP SDKの世代は実装時に公式の起動例を確認して1つ選び、lockfileで固定する。
v1/v2のパッケージ名・import・起動APIを混在させない。

Node用コードは`scripts/`に置き、ブラウザ用`src/`からSDKや`ws`をimportしない。
現在のビルドは専用の簡易バンドラなので、Vite等への置換は不要。

### 起動と接続

実装後の利用手順：

1. リポジトリ内で`npm ci`、`npm run build`。
2. AIクライアントへ下記stdioサーバーを登録して接続する。
3. ユーザーが`http://127.0.0.1:4174/?mcp=1`を1タブで開く。
4. AIから`get_state`を呼ぶ。

概念上のクライアント設定例（キーの形式はクライアントに合わせる）：

```json
{
  "mcpServers": {
    "cooling-planner": {
      "command": "node",
      "args": ["/home/hddwm390/tmp/cooling-planner/scripts/mcp-server.mjs"]
    }
  }
}
```

このモードでは`npm start`を別途実行しない。MCPプロセスが静的配信も担当する。
パスは`import.meta.url`基準で解決し、AIクライアントの作業ディレクトリに依存させない。
stdioのstdoutはMCP通信用。起動URLやログはstderrへ出す。

通常の`npm start`と単体HTMLでは従来どおり利用できる。
ブラウザ側の接続処理は`http:`かつ`?mcp=1`のときだけ開始する。
単体HTMLの`file://`からMCPへ接続する機能は作らない。

### 中継は小さく実装する

WebSocket上のメッセージは次の2種類でよい。これは内部中継であり、MCPの独自transportではない。

```text
Node → browser: { id, command, args }
browser → Node: { id, ok: true, data }
              または { id, ok: false, error: "説明" }
```

ブラウザは受信した操作を実行し、その場で応答する。計算完了は待たない。
Nodeは小さなrequest IDとPromiseの対応表で応答を返す。
1操作ずつ実行し、同時呼び出しは短いbusyエラーでよい。ジョブキューは不要。

ブラウザ未接続は即時エラー、応答なしは10秒程度で打ち切る。
遅れて届いた応答は破棄する。変更操作は自動再送しない。
タイムアウト時は変更の成否が不明なため、AIに`get_state`での確認を案内する。
接続断後はページ再読込で再接続できればよく、複雑な再接続・セッション復元は不要。
2タブ目の接続は拒否し、1タブだけ開く旨を表示する。

## 4. 既存コードとの接続点

2026-09-28時点で確認した構成。作業ツリーに他作業の変更があるため、実装担当は開始時に再確認する。

| ファイル | 再利用するもの |
|---|---|
| `src/state/store.ts` | ProjectStoreの編集・検証・Undo・案コピー |
| `src/main.ts` | store、currentResult、pending/invalid/calculating等の状態、描画と再計算の購読 |
| `src/worker/protocol.ts` | ResultGateによる古いWorker応答の除外 |
| `src/domain/project.ts` | Project、Device、View、SimulationResult等の型と単位 |
| `src/template/layout.ts` | buildLayoutによる地点・座標・区画情報 |
| `src/template/faces.ts` | buildAreas、areaOfProbeによる表示区画対応 |
| `src/model/areaStats.ts` | 既存画面と同じ区画集計 |
| `scripts/serve.mjs` | 静的配信処理の参考。MCP配信は127.0.0.1に固定 |
| `scripts/build-portable.mjs` | 現行の配布物生成。通常のビルドへ小さなbridgeを同梱 |

追加ファイルの目安は`scripts/mcp-server.mjs`、`src/mcp/bridge.ts`、`src/mcp/commands.ts`の3つ。
`main.ts`からstoreと読み取り用コールバックを渡し、既存購読の登録後にbridgeを開始する。
既存の`window.__DCS__`は読取中心のテスト用フック。そこへ任意コード実行機能を追加しない。

MCPの編集は必ずStoreの公開メソッド経由で行う。DOMクリックの代行やProjectの直接書換えは不要。
Storeが発行する変更通知から、既存の描画・再計算・端末内保存が働く。

## 5. 公開するツールは5つ

各入力はSDKのスキーマで項目名・型・enumを宣言する。汎用の任意JSON実行ツールにはしない。
成功結果はJSONをtext contentで返せばよい。失敗は短い説明付きの`isError: true`。

### 5.1 `get_state()`

現在の確定済み状態を返す。最低限、次を含める。

- `appVersion`、`schemaVersion`、現在入力の`inputHash`。
- `activeScenarioId`、`baselineScenarioId`、各案のid/name/readOnly。
- 各案のroof/fans/waterSystems。設備IDは案内で共通の場合があるため、必ず案に所属させる。
- `template`、共通`environment`、`view`、`milkSimulation`（仮定を読むため）。
- buildLayoutから地点のid/label/kind/x/y/heightM、buildAreasから区画と地点IDの対応。
- 選択中の地点・設備・区画、`undoCount`、`redoCount`。
- `draft`、`pendingInput`、`invalidInput`、計算状態。
- 短い`modelNotes`：本書7節の指標の意味と適用範囲。

入力は`store.committed`から読む。ドラッグ中の一時状態は`draft: true`で示す。
LLMがIDを推測しなくてよい出力にする。計算結果の時系列はここには含めない。

### 5.2 `edit({ operation, ... })`

一呼び出しにつき下表の一操作。各操作に必要な引数のみ許可する。
設備・屋根・水系統の編集先は**現在の案**。返却時に実際の`activeScenarioId`を付ける。

| operation | 引数 | Storeメソッド |
|---|---|---|
| `switch_scenario` | `scenarioId` | switchScenario |
| `copy_to_other` | なし | copyActiveToOther |
| `update_device` | `deviceId`, `patch` | updateDevice |
| `update_roof` | `patch` | updateRoof |
| `update_system` | `systemId`, `patch` | updateSystem |
| `update_environment` | `patch` | updateEnvironment |
| `add_device` | `kind`: fan/soaker/mist | addFan / addNozzle |
| `duplicate_device` | `deviceId` | duplicateDevice |
| `remove_device` | `deviceId` | removeDevice |

patchの初版対象：

- 設備共通：`x`, `y`, `heightM`, `yawDeg`, `pitchDownDeg`, `enabled`。
- ファン：`diameterM`, `outletSpeedMps`, `powerKw`, `hoursPerDay`, `dailyStartHour`。
- ノズル：`flowLpm`, `halfAngleDeg`。
- 屋根：RoofSettingsの既存フィールド。
- 水系統：`enabled`, `onSec`, `offSec`, `hoursPerDay`, `dailyStartHour`, `pumpPowerKw`。
- 共通気象：Environmentの既存フィールド。

SDKのスキーマで明示的に宣言し、id/kind/anchor/nozzlesや任意の内部フィールドはpatch対象にしない。
設備の種類に合わないフィールドだけはadapterで拒否する。座標のanchor更新はStoreに任せる。
数値範囲や基準案の編集禁止は既存検証を使い、二重の検証エンジンを作らない。

`copy_to_other`は現在の編集案からもう一方の編集案へ**上書きコピーし、その案に切り替える**。
対象は設備と屋根。共通気象は全案で共有され、コピー・案切替で以前の気象は保存されない。
この挙動をツール説明に明記する。新規の案管理や名前変更は初版対象外。

成功時は操作名、適用後のinputHash、案ID、変更した対象の適用後データ、undoCountを返す。
追加・複製では新しい設備IDも返す。計算の成功を意味する応答にはしない。
Storeが入力不変と判断して再計算しない場合もあるため、計算状態は実際の状態を返す。

### 5.3 `set_view({ ... })`

`mode`, `metric`, `selectedProbeId`, `selectedDeviceId`, `selectedAreaId`, `analysis`, `roof`,
`flow`, `particles`, `timeSec`の部分更新。値の選択肢・単位は既存View型に従う。
地点・設備・区画IDの存在を簡単に確認して`store.setView`へ渡す。
地点指定時は`areaOfProbe`で区画の選択も合わせ、設備指定時は現在の案のIDとして解釈する。
タイムライン変更時は既存再生を止める。
初版はカメラ座標の直接操作・アニメーションを追加しない。

表示操作はUndoに積まず、物理計算を再実行しない。結果は適用後のview。

### 5.4 `get_results({ scenarioId?, probeId? })`

省略時は全案の要約と、現在選択中の地点の詳細を返す。
scenarioId指定時はその案に絞る。probeId指定時はその地点を詳細対象にする。
存在しないIDは短いエラーにする。

要約：

- `inputHash`, `modelVersion`, `durationSec`, `dailyMilkStatus`。
- 各案のid、基準案ID、既存areaStatsによる区画別集計。
- 各案のresources、trialWaterL/trialKwh、roofの平均値（seriesは除外）。
- 各案のdailyMilk（準備・評価時間、仮定、resources、status/reasonsを含む）。
- warningsと、選択地点のPointResult（series/qSeriesは除外）。

時系列一式や全地点の詳細を毎回送らない。指定地点を変えれば他地点も調べられる。
不足の大きい地点はareaStatsのtopDeficitで見つけられる。
AIはA/Bの同名指標の差を説明できる。`deltaQrefW`自体の比較先は常に基準案である。

#### 計算待ちと現在入力の対応

`get_results`は待機を内部でループせず、その時点の状態を返す。

- 確定入力に合う熱結果なし：`status: "calculating"`、`result: null`。
- 熱結果あり・日乳量待ち：`status: "thermal_ready"`、熱結果と`dailyMilkStatus: "pending"`。
- 日乳量段階まで終了：`status: "ready"`。日乳量の成功・失敗はdailyMilkStatus等で示す。
- Worker失敗：`status: "error"`と理由。古い結果で代用しない。
- ドラッグ中・未確定入力・入力エラー：`status: "editing"`と理由。現在結果としての数値は返さない。

`main.ts`の`currentResult()`とResultGateを再利用し、さらに返す結果のinputHashが
`inputHash(store.committed)`と一致することを確認する。
熱結果が出た時点で日乳量も完了したとは扱わない。変更後の古い乳量を混ぜない。
呼出側は必要なら1秒以上空けて再取得する。PoCで自動待機を作る場合も60秒程度で区切り、
未完了と伝えて後から再取得できればよい。

### 5.5 `undo()`

既存`store.undo()`を1回呼ぶ。操作後の案ID・inputHash・undoCountを返す。
履歴なしなら`changed: false`でよい。
人の画面操作とMCP操作は同じ履歴を共有する。AI専用Undoは作らない。
Undoは現行Storeどおり案選択・viewを維持するため、選択の巻き戻しとは説明しない。
複数ツール操作をまとめたトランザクションや「会話1回を全部戻す」は対象外。

## 6. 最小限の例外対応

PoCのため、独自エラー分類・リトライ基盤・監査ログ・分散ロックは追加しない。
既存Storeの例外をcatchして、そのメッセージを返すだけでよい。
ドラッグ中や数値入力が未確定のときの編集・Undoは拒否し、「画面の入力を確定してください」と返す。
画面とAIを同時編集しない前提でよく、競合解決機構は不要。

ローカル配信は`127.0.0.1`固定。WebSocketのOriginはこの画面のoriginだけを許可する。
静的配信のパス逸脱防止は既存serve相当を維持する。認証機能は追加しない。
任意JavaScript・シェル実行・任意ファイル読書きをMCPに公開しない。

## 7. AIに渡す説明

server instructionsと各ツールdescriptionに短く組み込み、get_stateでもmodelNotesとして読めるようにする。
文書全文を毎回返す必要はない。

- 最初にget_stateで現状・ID・選択対象を確認する。「この牛」は選択地点として解釈する。
- 座標はx=牛舎の長さ方向、y=幅方向、heightM=高さ。長さはm、向きはdeg。
- 編集は現在の案へ適用する。基準案は読取専用。update_environmentは全案に効く。
- 変更前を残す依頼はcopy_to_otherを使う。コピー先は既存の別案を上書きする。
- 数値説明はget_resultsの計算結果を使う。未計算・null・invalidをゼロと説明しない。
- meanQrefWは地点の正味放熱量。referenceCoolingWPerCowは不足計算に用いる仮定値。
- deltaQrefWは基準案からの放熱差。meanDeficitWは秒ごとの不足を積算した60分平均。
- 区画平均は代表地点の単純平均。乳量の牛群平均・滞在時間加重とは異なる。
- resourcesの単位はL/day、kWh/day。trialWaterL/trialKwhは60分試行分。
  日乳量計算の資源量はdailyMilk.resourcesで、60分結果からの日換算と区別する。
- 地点のseriesを省いて返す平均値は、timeSecを変えても変化しない。
- 各面は代表地点の値。CFDや面内全域の計算ではない。
- 日乳量は仮説モデルの参考値。係数は明示的な仮定で、実牛舎での効果保証ではない。
- 「なぜ」の説明は風速・放射・放熱内訳・設備作用等を根拠にする。
  原因の断定が難しいときは仮説と伝え、1条件だけ変えて比較する。
- 「正解」「冷却十分」の自動判定や実農場向け推奨閾値は作らない。

## 8. 実装順序

1. 最新のAGENTS.md、Store、main、型、関連テストを読む。未コミット変更を消さない。
2. `commands.ts`で5ツール相当の処理を実装する。Storeと結果取得関数を注入する小さな関数でよい。
3. browser bridgeをmainへ接続する。通常起動では通信を開始しない。
4. Nodeのstdio MCP、静的配信、WebSocket中継を実装する。
5. クライアント設定例と起動手順をREADMEへ追加する。
6. 下記の動作を確認し、配布物を更新して短い実装報告を残す。

完了前に認証・抽象フレームワーク・汎用プラグイン基盤へ範囲を広げない。
この文書を読んだだけで乳量・面表示の計算仕様変更に着手しない。
過去計画の「未実装」表記と現行コードが異なる箇所がある。現行コードを確認して接続する。

## 9. 確認と完了条件

必要な確認に絞る。網羅的なMCP適合試験、負荷試験、全入力の異常系試験はPoCの完成条件にしない。

| 確認 | 完了の目安 |
|---|---|
| 接続 | 実際のMCPクライアントから5ツールが見え、get_stateが開いている画面の案を返す |
| 選択共有 | 画面で別の地点をクリック後、get_stateがその地点を返す |
| 設備編集 | MCPで編集案のファン位置を変更すると、同じ画面のファンが移動する |
| 表示編集 | MCPで地点とmetricを変えると、画面の選択・色表示が変わる |
| 計算結果 | 編集後のinputHashとget_resultsが一致し、地点の数値が画面と一致する |
| 計算途中 | 熱結果のみの段階では日乳量をpendingとして返せる |
| 比較 | AをBへコピーしBの屋根だけ変更、A/Bの結果を読み取れる |
| Undo | MCPのundoで最後の編集が戻り、画面と結果も戻る |
| 最小例外 | 基準案編集とブラウザ未接続が、短いエラーで終了する |
| 通常起動 | MCPなしのHTTP版・単体HTMLでも既存操作ができる |

自動テストを足すなら、adapterで実Storeへ変更が届きUndoできることと、
古いhashの結果を返さないことを優先する。スキーマの全項目をなぞるだけのテストは不要。

リポジトリの規約に従い`npm run typecheck`、`npm test`、`npm run build`と関連ブラウザ操作を確認する。
READMEのブラウザ黄金経路を参照し、MCP経由で同じ画面が変わる確認を追加する。
計算式を変えないため、新しい科学的検証をMCPの完成条件に追加しない。
実装上モデル計算を変える必要が生じた場合は、先に範囲を見直し、AGENTS.mdのモデル変更規則に従う。

生成済みHTML、dist-offline、その他ビルドで更新された管理対象も実装に合わせる。
実装報告には使用クライアント・SDK版・接続手順・確認結果・未確認事項を書く。
「MCPから操作できたこと」と「モデルの実牛舎での妥当性」は別に扱う。

## 10. 参照

- [現在の目的と対象範囲](CURRENT_PLAN.md)
- [起動・操作・検証](../README.md)
- [区画別可視化](AREA_COOLING_VISUALIZATION_V0_1.md)
- [乳量モデル仕様](MILK_HEAT_MODEL_V0_1.md)
- [MCP TypeScript SDK v1](https://ts.sdk.modelcontextprotocol.io/)
- [MCP TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/)

公式SDK資料は2026-09-28に確認。実装時は採用する世代の資料とパッケージを合わせる。
