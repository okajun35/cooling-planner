# ゲーム風UI 実装報告

実施日：2026-09-29。対象計画：[GAME_UI_IMPLEMENTATION_PLAN.md](GAME_UI_IMPLEMENTATION_PLAN.md)。
この文書は実装済みの報告であり、計画ではない。

## 1. 変更した画面と操作

左右の常設パネルを廃止し、牛舎を中央に大きく表示するHUD構成へ組み替えた。

- 上部バー：案タブ（基準案・編集案A・編集案B）、気象チップ、計算状態、根拠・設定・保存・読込。
- 要約チップ：選択地点の放熱不足、案全体の日水量・日電力量。放熱不足チップは地点結果パネルの入口。
- 左レール：風・散水・屋根・分析の表示切替（表示のみ。物理入力ハッシュに含めない）。
- 右上：標準3D／リアル3D／2Dの切替（3モードを維持）。
- 下部ドック：ファン・ソーカー・ミストの配置、屋根対策、設備一覧、Undo/Redo、サイクルを見る、結果・比較、ヘルプ。
- 右パネル（必要時のみ）：設備プロパティ、設備一覧・系統ON/OFF、屋根対策、気象、地点結果。
- 下部シート（必要時のみ）：案比較・エリア・時間変化（60分グラフと再生）・参考影響（乳量・受胎・掲載表）。
- 配置フロー：ドックの設備ボタン→候補ゴーストがポインタに追従→クリックまたは「ここに置く」で確定。Esc・中止・案切替・表示モード切替・外部編集でキャンセル。
- 初回ガイド：見る→設備を選ぶ→比較を開くの3ステップ。スキップ可、ヘルプから再表示可。完了状態はlocalStorageに保存（Projectではない）。
- 基準案は引き続き固定。編集操作で「編集案 A で試す」入口を表示。

新規モジュール：

- `src/ui/workspaceState.ts`：開いているパネル・シート・配置ゴースト・ガイドの一時状態。Project/Undo履歴とは分離。
- `src/ui/layout.ts`：HUD骨格のDOM。`src/ui/panels.ts`：各パネル/シートの描画。
- `src/template/placement.ts`：配置の既定高さ（ファン3m、ソーカー/ミスト2.5m）と有効判定（牛舎外=outside、固体ゾーン=blocked、ロボット通路は可）。

変更した操作経路：

- `Store.addFan(pose?)` / `addNozzle(kind, pose?)`：任意座標追加。`anchorPose`でアンカー計算、1回のUndo、追加設備を選択。引数なしは従来の既定位置（MCP互換）。牛舎外・固体ゾーンは変更前に拒否し、部分的な設備を残さない。
- `ViewCallbacks` に `placeMove`/`placeCommit`、`SceneView` に `setPlacement`/`screenPoint` を追加。標準3D・リアル3D・2Dで配置プレビューと確定が動く。
- `window.__DCS__.workspace()`：パネル・シート・配置・ガイド状態の検査用（テストとMCPデバッグ向け）。

## 2. 計画の完了状況

| 項目 | 状態 |
|---|---|
| P0 画面記録・モック | 完了。`docs/mockups/game-ui/` |
| P1 画面枠と既存機能の移設 | 完了。全操作が新UIから到達可能 |
| P2 配置プレビュー | 完了。任意座標・1回Undo・3モード・キャンセル |
| P3 結果・比較・時系列 | 完了。要約・地点結果・比較・エリア・時間変化・参考影響をシートへ整理 |
| P4 ガイドと見た目 | 完了。ガイド・ヘルプ・設備説明・4画面サイズ対応 |
| P5 検証・配布・報告 | 完了。本節・検証結果は下記 |

GUI01〜GUI16は `tests/e2e/test_game_ui.py`（18件）で確認し、全て合格。対応表はテスト関数名のコメント参照。

## 3. 実行した検証と結果

環境：Node.js、Chromium（`CHROMIUM_PATH` 指定のヘッドレス、SwiftShaderソフトウェア描画）。

| 検証 | 結果 |
|---|---|
| `npm run typecheck` | 合格 |
| `npm test`（単体・結合 145件） | 全件合格。新規14件：workspaceState 8件、placement 3件、結合placement 3件（任意座標追加・1回Undo・基準案拒否・範囲外拒否・MCP既定位置互換） |
| `npm run build` | 合格。`cooling-planner-v0.9.html`（1327 KiB）と `dist-offline/` 再生成 |
| `pytest tests/e2e/test_game_ui.py` | 18件全合格 |
| `pytest tests/e2e/test_browser.py` | 27件全合格（新UIへセレクタ移行済み） |
| `pytest tests/e2e/test_mcp.py` | 7件全合格（パネル開閉を経由するよう更新） |

試験上の調整（実装不具合ではなく移設に伴うもの）：

- E09：読込後の再計算開始を待ってからready待ちに修正（レース）。
- E23：新レイアウトで同一ワールド座標の投影先が変わるため、「待機ゾーンの面クリックが待機系地点を選ぶ」ことは維持し、地点番号の固定を外した。
- E11/E13：ガイドカードが小画面のモード切替・再生ボタンと重なるため、表示位置を調整（シート表示中は上方へ回避）。

未実行：実機GPU・実機モバイル・有画面での見た目確認（ヘッドレス/SwiftShaderのみ）。`file://` とHTTP配信の全組合せではない。

## 4. スクリーンショットと起動方法

証跡：`evidence/game-ui/`（`evidence/` は `.gitignore` 対象のためコミットに含まない）。

- PC：`pc-01-guide.png`（初回ガイド）、`pc-02-normal.png`（通常）、`pc-03-device-selected.png`（設備選択）、`pc-04-placement-ghost.png`（配置候補）、`pc-05-probe-result.png`（地点結果）、`pc-06-compare.png`（案比較）、`pc-07-timeline.png`（時間変化）、`pc-08-mode-2d.png`、`pc-09-mode-realistic.png`
- 小画面（390px）：`mobile-01-devices.png`、`mobile-02-compare.png`

撮影スクリプト：`scripts/capture_game_ui.py`（`CHROMIUM_PATH=... python3 scripts/capture_game_ui.py`）。

起動：`npm start`（`http://127.0.0.1:4173/`）、または単体HTML `cooling-planner-v0.9.html` をブラウザで開く。

## 5. 計算・保存形式への変更

- 熱・水・乳量・受胎の計算式、係数、入力ハッシュ対象は変更なし。`npm test` の全計算テスト（Python parity含む）が変更前と同じ結果で合格。
- 表示切替・パネル開閉・ガイド・配置ゴーストは物理入力ハッシュとUndo履歴に影響しないことをテストで確認（GUI15・workspaceState・UT10系）。
- 保存形式はschema 9のまま。workspaceの一時状態はシリアライズに混入しない。
- W→THI・深部体温への換算なし、受胎は参考シナリオのまま。モデルの仮定表示は維持。

## 6. 既知の制限と後続項目

- 配置プレビューの床投影は設備種別の既定高さ平面上で行う。斜め視点での奥行き感は補助表示に依存する。
- ロボット走行ゾーンは配置可能扱い（計画の判定基準どおり）。配置可否は物理的適性ではなく占有判定のみ。
- タッチ操作は「ここに置く」ボタンで確定可能だが、タッチ端末での実機確認は未実施。
- ガイド完了フラグはlocalStorage。ブラウザデータ消去で再表示される。
- 後続候補：既存設備のドラッグ移動へのゴースト表示流用、キーボードによる配置確定、小画面でのシート全画面化の検討。

## 追記：レビュー指摘への対応（2026-10）

コードレビューのP2指摘5件に対応。計算モデル・保存形式は無変更。

1. **worker完了時の未確定入力喪失**（main.ts）：`render()`は`pending`中のフォーカス入力を値・bad-input・フォーカスごと復元する。さらに切り分けで、`innerHTML`再構築がフォーカス中フィールドのblur+`change`を（接続状態のまま）発火させ、未確定値を**誤コミット**する副作用も確認し、render中は`suppressChange`で`change`を抑制（再入は復元式で対応、切離ノードは`isConnected`で除外）。
2. **選択済みオブジェクト再クリックでinspectorが再開しない**（main.ts）：`setView`は同一値でも'view'をemitするためID差分では開けなかった。シーンの`selectDevice/selectProbe`コールバックと`select-first-fan`で、明示的選択時はID変化の有無に関わらずパネルを開く。
3. **2D配置で外側クリックが内部へクランプ**（svg2d.ts）：pointerdown/pointermoveの配置経路で生座標を`placeMove`へ渡すよう変更。`checkPlacement`が'outside'を返し、コミットは拒否される（3D・MCPと一致）。
4. **blur時の配置キャンセルでシーン未同期**（main.ts）：blurハンドラを他キャンセル経路と同一の`cancelPlacement→updateGhost→render`に統一。シーンの`placement`フラグとヒント表示も正しく解除され、以後のクリックは通常選択へ戻る。
5. **describe_modelが既定値を報告し続ける**（modelInfo.ts）：係数・環境・乳量仮定・プロファイルを全て実プロジェクト値から生成し、既定値との差分を`modifiedFromDefaults`（感度実験値の一覧）と`modifiedNote`で明示。

- **テスト**：結合テストに`describe_model`の変更値報告を追加（154件）。e2eにGUI17（未確定入力の保持・誤コミット防止）・GUI18（再クリックでinspector再開）・GUI19（2D外側クリック拒否）・GUI20（blurで配置完全取消）を追加し22件、test_browser/test_mcp含め全57件合格。
