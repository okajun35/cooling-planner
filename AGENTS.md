# AGENTS.md — Cooling Planner

このリポジトリだけを作業対象とする。Dairy HorizonのPhase 1計画や、その親フォルダーの`AGENTS.md`は、この独立版の要件ではない。

## 目的と範囲

モデル牛舎で設備配置と屋根条件を変え、環境・水資源・代表牛の放熱の差を比較する。実農場の温度、乳量、受胎率を確定予測する製品ではない。

- 現在計画：`docs/CURRENT_PLAN.md`。乳量の新仕様は `docs/MILK_HEAT_MODEL_V0_1.md`（実装済み。検証・制限は `docs/MILK_MODEL_IMPLEMENTATION_REPORT.md`）。
- 実装引継ぎ：`docs/MILK_MODEL_IMPLEMENTATION_PLAN.md`。P0〜P6の実装は完了。後続変更は計算仕様と実装報告を確認する。
- 既存計算仕様：`reference/thermal/MODEL.md`、`docs/cooling_planner_decisions_v0_6.md`、`docs/DECISIONS_v0_8.md`
- 現在の制限と次の検討事項：`docs/MODEL_REVIEW_2026-09-27.md`
- 起動と検証：`README.md`、`docs/STANDALONE_VALIDATION.md`
- 元コードの権利と依存：`docs/THIRD_PARTY_NOTICES.md`

## 変更するとき

1. 関連するモデル仕様、実装、テストを読む。既存の動く経路を維持する。
2. 熱・水・乳量・受胎の計算を変える場合は、先に失敗するテストを追加し、仮定・出典・適用範囲を明記する。
3. 乳量の現在計画は `docs/MILK_HEAT_MODEL_V0_1.md` の仮説モデルを優先する。放熱不足の日集計・遅れ・上限・明示係数に従い、掲載6条件表の補間とは区別する。WからTHI・深部体温への換算は行わない。ユーザーが実装を依頼するまでは文書・計画のみ変更する。
4. 屋根・空気のモデルは代表条件の縮約モデル。実測や外部資料と比較するときは、モデルの仮定値と観測値を分ける。
5. ハッカソンPOCとして素朴な実装と必要最小限の検証を優先する。エージェントは `npm run typecheck`、変更に関連する単体・統合テスト、`npm run build` を確認し、生成済みHTMLと `dist-offline/` を更新する。全テストの繰り返しや、実装をなぞるだけのテスト追加は避ける。
6. E2E・Playwright・実ブラウザの操作確認は人間とCIが担当する。エージェントはユーザーから明示的に依頼された場合だけ実行する。必要な手動確認手順を報告に残す。熱・水・乳量・受胎のモデル計算を変える場合は、関連するPython参照テストも実行する。
7. ユーザーが依頼した変更範囲を優先する。独立したGitリポジトリとして扱い、元のDairy Horizon配下のコピーへ無断で同期しない。

## 報告

変更したもの、検証結果、追加・変更した仮定、既知の制限を簡潔に報告する。モデル計算の再現性と、実牛舎での妥当性は別に評価する。
