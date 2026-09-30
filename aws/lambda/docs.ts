/** Bundled model-theory/reference documents served by the `get_doc` MCP tool.
 * Markdown sources are embedded at bundle time via esbuild's text loader
 * (see aws/deploy.mjs). Keep names in sync with describe_model's `docs` list. */
import modelMd from '../../reference/thermal/MODEL.md';
import milkMd from '../../docs/MILK_HEAT_MODEL_V0_1.md';
import decisionsV08Md from '../../docs/DECISIONS_v0_8.md';
import decisionsV06Md from '../../docs/cooling_planner_decisions_v0_6.md';

export interface DocEntry{title:string;path:string;text:string}

export const DOCS={
 thermal_model:{title:'熱・散水モデル仕様 (MODEL.md)',path:'reference/thermal/MODEL.md',text:modelMd},
 milk_model:{title:'日乳量仮説モデル (MILK_HEAT_MODEL_V0_1.md)',path:'docs/MILK_HEAT_MODEL_V0_1.md',text:milkMd},
 decisions_v08:{title:'設計決定ログ v0.8 (DECISIONS_v0_8.md)',path:'docs/DECISIONS_v0_8.md',text:decisionsV08Md},
 decisions_v06:{title:'設計決定ログ v0.6 (cooling_planner_decisions_v0_6.md)',path:'docs/cooling_planner_decisions_v0_6.md',text:decisionsV06Md},
} satisfies Record<string,DocEntry>;

export const DOC_NAMES=Object.keys(DOCS) as (keyof typeof DOCS)[];
