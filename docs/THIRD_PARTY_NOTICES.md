# 参照・依存・権利について

- ユーザー提供の `dairy_cooling_simulator_v0_4_preview(1).zip` を改修元としています。元コードの権利・ライセンス・第三者に公開できる範囲を変更するものではありません。出自は `REUSE_MAP.json` で記録しています。
- この配布物に、メーカーの図面や3Dモデル、外部フォントファイル、牛の写真を含めていません。描画は簡略化した自作プリミティブです。
- ブラウザ実行時の外部依存はありません。TypeScript 5.8.3は開発・ビルド用で、コンパイラ本体、Node.js、Playwright、Chromium、Xvfbは同梱していません。
- 3D描画にThree.js 0.180.0を使用します。MIT License © three.js authors。npm依存として取得し、`node_modules/three/build/three.module.min.js`・`three.core.min.js` をビルド時にアプリへ同梱します。CDN参照・実行時ダウンロードはありません。ライセンス本文：https://github.com/mrdoob/three.js/blob/r180/LICENSE
- MCP PoCのNode側配信・中継に `@modelcontextprotocol/server` 2.1.0（MIT License © Anthropic, PBC. / Model Context Protocol project）、`zod` 4.6.5（MIT）、`ws` 8.22.0（MIT）を使用します。いずれも `scripts/mcp-server.mjs` が実行時に参照するだけで、ブラウザ配布物（app.js・単体HTML・worker.js）には同梱しません。
- 独立版はビルド時にライセンス本文をapp.js・単体HTMLと `dist-offline/THREE-LICENSE.txt` に同梱します。
- 熱の関係式・仮定の出典は `reference/thermal/MODEL.md`、乳量は `cooling_planner_decisions_v0_6.md` に記載しています。全酪連のPDF本体、メーカー資料や図表画像は再配布していません。
- 受胎の数値はBaccouri et al. (2025), *The Effect of Heat Stress During the Insemination Period on the Conception Outcomes of Dairy Cows*, Animals 15(13):2001, DOI:10.3390/ani15132001, Table 2から採用。原論文はCC BY 4.0。掲載係数を転記し、仮想基準確率・期間代表シナリオを追加した変更を `reference/fertility/FERTILITY_MODEL_PROPOSAL.md` に記録しています。https://pmc.ncbi.nlm.nih.gov/articles/PMC12249091/
- 湿り空気の関係式は元仕様にあるPsychroLib/ASHRAEのSI表現を参照したものです。PsychroLibパッケージ自体を配布していません。
- 上記の採用式やクロス言語照合は、牛舎形状・換気量・機器性能・牛体係数が現場検証済みであることを示しません。
