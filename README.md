# Cooling Planner v0.10 preview

English | [日本語](docs/README.ja.md)

A browser app that operates equipment in a model dairy barn and compares environment, cow heat loss, water and energy use. It reuses the v0.4 geometry, physics and editing features with a rebuilt screen–calculation connection. v0.9 added a herd-average representative-day milk estimate linked to equipment changes (hypothesis model `milk-heat-deficit-v0.1`). v0.10 added hourly weather for the representative day (24 rows), per-day point/area aggregation, and constrained candidate comparison (`compare_candidates`).

This repository is a standalone version split out of Dairy Horizon. No FastAPI, API keys or parent project required.
Requires Node.js 22.12+. First run: `npm ci && npm run build`, then `npm start`.
The repository tracks both sources and built distributions; regenerate the distributions on change.

## Live demo & branches

| Branch | UI language | Hosted demo (AWS Amplify) |
|---|---|---|
| `english` | English | https://english.da05znjm47ziu.amplifyapp.com/ |
| `main` | Japanese | https://main.da05znjm47ziu.amplifyapp.com/ |

The `english` branch was created for an overseas hackathon and carries an English-only UI (no language switcher). Model calculations, save format and the MCP vocabulary are identical on both branches; only user-facing strings differ. Each branch auto-deploys to its own Amplify URL on push. UI labels quoted below are the English ones; the Japanese walkthrough is in [docs/README.ja.md](docs/README.ja.md).

## Quick start

`cooling-planner-v0.10.html` is a single file containing CSS, JavaScript and the calculation worker. Unzip it and open it in a desktop Chrome/Edge. No internet connection, login or API key is needed. If your browser refuses local files, use the local HTTP serving below.

For the current scope, see [current plan](docs/CURRENT_PLAN.md); for how the acceptance criteria map to the current code, see [acceptance criteria](docs/ACCEPTANCE_CRITERIA.md).

The milk-yield calculation spec is [heat-load → milk hypothesis model v0.1](docs/MILK_HEAT_MODEL_V0_1.md); procedure and verification are in the [implementation plan](docs/MILK_MODEL_IMPLEMENTATION_PLAN.md) and [report](docs/MILK_MODEL_IMPLEMENTATION_REPORT.md). The published 6-condition milk table is kept as reference material on the reference screen.

Verification scope and results are recorded in [standalone validation record](docs/STANDALONE_VALIDATION.md).
Not every combination of public HTTPS, `file://`, and real Chrome/Edge/Safari has been checked.

### First steps (3–5 minutes)

The screen is a barn-centered HUD. Place equipment from the bottom dock, configure it in the right panel, and compare results in the bottom sheet. On first run a short guide appears (skippable; replay from "?" help).

1. Wait for the initial calculation. "Draft A" starts as a copy of the baseline, so a heat-loss delta of 0 W is correct.
2. From the "Roof" button in the dock, turn on "reflective coating" and "20 mm insulation". At Feeding 7 the local air temperature goes 36.5 → 33.0 °C and the heat-loss improvement is about +384 W. These are model-calculated values.
3. Press "Fan" in the dock and click inside the barn to place a new device (Esc / Cancel to abort). Click an existing fan to select it and drag to move; change height and direction in the right panel. Dragging the background rotates the view. "Undo" reverts one operation.
4. In "Results & compare" → "Timeline", watch the 60-minute fixed-weather chart and playback. The metric chips at top-left (deficit / improvement / wind speed / air temperature) switch the floor colors. Cards and floor colors stay on 60-minute means.
5. In "Results & compare" → "Reference impacts", check the herd-average representative-day milk, its delta vs baseline, and the conception reference conditions. "View published table" shows the milk reference table.
6. In "Compare", review mean/max deficit, stall/feeding/waiting deficits, and water/energy deltas vs baseline. Pressing a top-deficit location jumps to the floor deficit view and that point's heat-loss breakdown.
7. Use "Save" at the top to store the placement and conditions as JSON, and "Load" to restore. An MCP scenario JSON can also be pasted via "Compare" or "Settings & save" → "Import MCP scenario JSON".

For the UI rework plan and verification, see [game-style UI implementation plan](docs/GAME_UI_IMPLEMENTATION_PLAN.md) and [report](docs/GAME_UI_IMPLEMENTATION_REPORT.md).

**The baseline is not "no equipment": it has 10 existing fans + 12 soakers and no roof measures.** Draft B starts with the same fans, soakers stopped and mist running. A negative heat-loss delta for B means "worse than this baseline", not "mist has no effect".

## Build and test

Requirements: Node.js 22.12+, TypeScript 5.8.3. 3D rendering uses Three.js 0.180.0 (bundled at build time as an npm dependency). No external network or CDN is needed at runtime.

```sh
npm ci
npm run typecheck
npm test
npm run build
npm start
```

`npm start` serves `dist-offline` at `http://127.0.0.1:4173/`; change the port with `PORT`. If you only want to view the built distribution, `npm start` works with just Node — no `npm install` or rebuild needed.

Build outputs:

- `cooling-planner-v0.10.html`: standalone HTML (the older `cooling-planner-v0.9.html` is also kept).
- `dist-offline/`: HTML/CSS/app.js/worker.js for static hosting; serve the whole folder.

For the hackathon PoC, agent-side verification is typecheck, relevant unit/integration tests, and build. E2E and real-browser checks belong to humans and CI; agents run them only when explicitly asked.

The following E2E procedure is for humans/CI. Browser tests use Python Playwright/pytest and Chromium; headless is the default and Xvfb is not required.
Point `CHROMIUM_PATH` at an existing Chromium, or omit it to use the Playwright-managed one.
For headed runs, provide a display and set `HEADLESS=0`.

```sh
python -m pip install -r requirements-test.txt
python -m playwright install chromium
npm run build
npm run test:browser
```

By default the standalone HTML is exercised inline. Start `npm start` in another terminal and run
`COOLING_PLANNER_URL=http://127.0.0.1:4173/ npm run test:browser` to check the HTTP version.
WebGL-unavailable tests still use the standalone HTML under that setting.

Python reference implementations:

```sh
(cd reference/thermal && python -m unittest -v)
(cd reference/fertility && python -m unittest -v)
```

`node scripts/make-examples.mjs` regenerates the verified input examples and integrated calculation results. Run `npm run build` first.

## MCP PoC (external AI client integration)

PoC implementation from `docs/MCP_POC_IMPLEMENTATION_PLAN.md`. An external MCP-capable AI client reads and operates the actual open screen. The source of truth is the browser-side ProjectStore; the server keeps no copy of calculations or saves.

### Launch and connect

1. Inside the repository, run `npm ci && npm run build`.
2. Register the following stdio server in your AI client (adjust the path to the real repository location; equivalent to `npm run mcp`):

```json
{
  "mcpServers": {
    "cooling-planner": {
      "command": "node",
      "args": ["/absolute/path/to/cooling-planner/scripts/mcp-server.mjs"]
    }
  }
}
```

For Devin CLI, run inside the repository (registers to `.devin/mcp_config.local.json`):

```bash
devin mcp add cooling-planner -- node "$(pwd)/scripts/mcp-server.mjs"
```

3. Open `http://127.0.0.1:4174/?mcp=1` in a single tab. `npm start` is not needed in this mode; the MCP process also serves `dist-offline`.
4. Call `get_state` from the AI.

The tools are `get_state` / `edit` / `evaluate` / `compare_candidates` / `describe_model` / `set_view` / `get_results` / `undo` — 8 in total. Edits apply to the current scenario, reflect on screen immediately, and recalculate through the existing path. Human screen operations and MCP operations share the same undo history.

- `evaluate`: evaluates a hypothesis without changing the screen. Pass the same operations as `edit` as an array; they are applied in order to a clone of the committed state, and the call returns the scenario's per-area aggregation, resources, roof and (with `includeDaily`) daily milk plus comparison stats vs baseline. Since it never touches the screen scenario, devices, undo history or recalculation, use this — not `edit→undo` — to explore "what if this measure" or "how far can the deficit go down".
- `compare_candidates`: applies 1–3 candidate operation lists separately to clones of the same committed project and returns daily results (mean deficit, water, energy use, worsened points), constraint verdicts and ranks. Candidates may only use `update_device` / `update_system` / `update_roof`; coefficients, weather, scenario switching and add/remove are rejected. Ranks hold only within the call.
- `add_device` in `edit`/`evaluate` can place at arbitrary coordinates with `x` and `y` (both required). Out-of-range or solid-zone positions are errors.
- `describe_model`: returns the model's calculation structure, input/output field meanings, main assumption constants, limits and verification status. Call it before interpreting or explaining numbers (also noted in the server instructions).
- Model coefficients can also be changed via MCP: `update_model` (physics: jet diffusion/decay, convective heat transfer, radiation offsets, roof model coefficients, `profiles` sensitivity assumption sets, etc.), `update_milk` (milk hypothesis: Qref, beta, lag weights, etc.), `update_references` (baseline milk and conception references). Model formulas and version identifiers cannot change, and out-of-range values are rejected by existing validation. Combined with `evaluate`, you can compare results under different coefficients without touching the screen.

- The MCP SDK is `@modelcontextprotocol/server` 2.1.0 (v2 line), pinned by the lockfile.
- Plain `npm start` (port 4173) and the standalone HTML work as before; without `?mcp=1` no MCP connection is started.
- Serving and WebSocket are fixed to `127.0.0.1`; a second tab connection is refused. Authentication, remote access, multi-user and in-app chat are out of PoC scope.
- If port 4174 is busy, the server prints a startup message and exits. Do not run a manual `npm run mcp` and an AI-client-launched server at the same time. `COOLING_PLANNER_PORT` changes the port (the browser auto-connects to the port of the opened page). The server exits automatically when the stdio client disconnects.
- Formulas, coefficients and the save schema are unchanged.

Browser integration check: `CHROMIUM_PATH` set + `python3 -m pytest tests/e2e/test_mcp.py` (drives a real MCP stdio session and verifies the screen changes).

## WebMCP on the deployed English site

After deploying the updated `english` branch, open:

https://english.da05znjm47ziu.amplifyapp.com/?webmcp=1

The page registers eight WebMCP tools against its live ProjectStore: `get_state`, `edit`, `set_view`, `get_results`, `undo`, `describe_model`, `evaluate`, and `compare_candidates`. The screen shows **WebMCP ready** after registration. This works on the HTTPS-hosted page without a local Cooling Planner server or a WebSocket relay. The AI controls the tab connected to its browser MCP; the remote Lambda MCP remains a separate, stateless calculation service.

WebMCP is experimental. Use a Chrome version supported by the installed Chrome DevTools MCP (its current configuration documentation requires Chrome 150+) and enable `--enable-features=WebMCP`. Enable the MCP's `--categoryExperimentalWebmcp` category. See the [Chrome DevTools MCP configuration](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/configuration.md) and [WebMCP debugging guide](https://developer.chrome.com/docs/devtools/agents/webmcp-debugging).

For Codex, add a distinct entry to your MCP configuration, or update your existing Chrome DevTools entry rather than launching two MCPs against the same browser:

```toml
[mcp_servers.cooling_webmcp_browser]
command = "npx"
args = ["-y", "chrome-devtools-mcp@latest", "--categoryExperimentalWebmcp", "--chromeArg=--enable-features=WebMCP"]
```

This configuration launches a visible Chrome. If connecting to an existing Chrome instead, use the MCP's `--browserUrl` option and enable WebMCP when launching that browser; `--chromeArg` only applies to a browser launched by the MCP. The Codex process and visible browser must have a working connection, including when using WSL. See [Codex MCP configuration](https://developers.openai.com/codex/mcp/).

Restart the Codex session after updating its MCP configuration. Ask it to open the deployed URL above, list the page's WebMCP tools, and execute `get_state` first. Then execute `edit` using IDs from that response and `set_view` with `{"sheet":"compare"}`. Inspect `get_results` after calculation; `calculating` or null is not zero. `describe_model` explains the model assumptions. `evaluate` and `compare_candidates` run on clones and do not change the screen.

Without `?webmcp=1` no WebMCP tools are registered. Unsupported browsers show **WebMCP unavailable** in this mode and continue to support normal manual interaction. Registration supports the current `document.modelContext` API and the earlier `navigator.modelContext` API. The generated offline distribution and standalone HTML include the adapter, but the intended browser setup is the HTTPS deployed site.

Implementation details, validation results, and the manual acceptance checklist: [WebMCP implementation report](docs/WEBMCP_IMPLEMENTATION_REPORT.md).

## Deploying to AWS

Implementation plan: `docs/AWS_DEPLOY_PLAN.md`. Amplify Hosting (static site; GitHub-connected, auto-deploys on push to `main`/`english`) + Lambda Function URL (REST and remote MCP). The remote MCP is a stateless, browserless variant; its tools are `get_default_project` / `evaluate` / `compare_candidates` / `describe_model` / `get_doc` (same operation vocabulary as the local version).

### Connecting to the remote MCP

Register the following in Kiro, Claude, or another MCP client. The public demo token `demo-581fKusGqNgk7YrycFNw6M_5` is open to anyone (rotated if abused). The private admin token is `mcpBearerToken` in `aws/deploy.local.json` (not committed):

```json
{"cooling-planner-remote":{"type":"http","url":"https://puzxplbkg2qglia72tkhs2z7km0jrusa.lambda-url.us-east-1.on.aws/","headers":{"Authorization":"Bearer demo-581fKusGqNgk7YrycFNw6M_5"}}}
```

```sh
cd aws && npm ci && cd ..
npm run deploy:aws   # site build → Lambda bundle → cdk deploy (Lambda backend only)
```

Deployment state (Bearer token, URLs) is stored in `aws/deploy.local.json` (not committed). CDK bootstrap runs automatically on first deploy if needed. Site publishing is done by the GitHub-connected Amplify app building via `amplify.yml` on push.

## Save format

`schemaVersion: 10`. Saves placements, roof conditions, weather (fixed + representative-day hourly), coefficients, reference-model assumptions, per-device daily start times, milk model settings and view settings. v8/v4 JSON are rejected without conversion, keeping the current scenario. Keep existing v8 bodies and data separately.

Besides placement JSON, an MCP `evaluate` response JSON with a top-level `project` can also be loaded or pasted. It validates the `project`'s placement, weather, coefficients and baseline, restores them and recalculates on screen. Received results and hashes are not trusted for display. Max 2 MiB; supported version is schema 10 (v9 converts automatically).

"Results JSON" is a verification file combining the project and calculation results. Under 2 MiB its `project` can be extracted and restored, but because it contains results, use a placement JSON or the `project` of an MCP response for normal interchange.

On-device storage is used where available, but the first launch always starts from the standard demo. Restore the on-device save from "Settings & save". Scenario JSON works even where on-device storage is unavailable.

## Per-area visualization

### Standard 3D / Realistic 3D / 2D

Switch with the tabs above the barn. The classic rendering remains as "Standard 3D" and shares placements, selected points and results.
"Realistic 3D" adds steel members, stalls, floor material, cow/device geometry, lighting and shadows. No extra download needed.
Holstein-like proportions and large spots are drawn in standing and resting postures; 3 of the 50 cows are placed in the feeding band with soakers. Cow positions and postures are cosmetic and do not change evaluation points or occupancy settings.

- Drag the background to rotate, wheel to zoom, Shift+drag or right-drag to pan.
- Select and drag a fan/nozzle to edit the same device as in Standard 3D. Undo is shared.
- "Wind" shows flow streaks; "Spray" shows soaker droplets / mist particles. Check ON/OFF operation with the time slider.
- "Map" overlays existing results on the floor. "Analysis" hides the cows and shows the heat map.
- "Roof" shows one roof side. Columns and trusses stay visible so the interior structure can be inspected.

Wind is a schematic representation based on fan direction, model spread/decay and obstacles. Particle trajectories are not CFD.
The particle animation is display-only; it does not advance time or rewrite model results.
Materials and shapes are generated in code — this is not photogrammetry or a photo-quality cow model.
For implementation and verification details see [realistic 3D implementation record](docs/REALISTIC_3D_IMPLEMENTATION.md).

Implements [per-area heat/cooling visualization spec v0.1](docs/AREA_COOLING_VISUALIZATION_V0_1.md). 50 stalls, 12 feeding and 8 waiting area faces are colored by cooling deficit (per-second integrated mean against Qref), heat-loss improvement, wind speed and air temperature. Clicking a face or table row selects its representative point and shows wetting, heat-loss breakdown and device-action diagnostics. Each face shows its point's representative value, not a spatial calculation over the whole face. schemaVersion is 10.

## Model coverage

- One freestall template, 50 stalls, 70 independent evaluation points. Not CFD, and not an accuracy guarantee for real barns.
- Heat and water use fixed weather for 60 minutes at a base step of 1 s. Playback shows precomputed samples.
- Daily milk is a separate representative-day calculation: the fixed weather repeats for 24 h, and after a 24 h warm-up a 24 h evaluation window is aggregated. Includes per-device daily start times, run times, ON/OFF cycles, and water film carried past midnight.
- Felt air temperature, heat-loss improvement W, milk and conception are metrics with different meanings.
- Daily milk is a herd-average reference value under `milk-heat-deficit-v0.1` (demo_assumption). H=max(0,Qref−Q) is weighted across 70 points, per-area occupancy shares (14/6/4 h equivalent) and time, then Y=Y0−min(Y0×25%, beta×E) is computed from the lagged E. Coefficients are not literature regression values and accuracy on real farms is unverified.
- The published milk table covers only the 6 Zen-raku-ren published conditions at RH 60–70% under static conditions. Unlisted values are null — no interpolation or extrapolation. Kept as reference material.
- Conception is a reference scenario computed from 5-period THI bands and a hypothetical baseline conception rate. Initial values use an independent representative 26 °C / RH 70% and a 40% baseline rate. It does not automatically derive an overall conception improvement from equipment.
- Applying the 60-minute mean to the 52-day peri-insemination representative conditions is an explicit opt-in checkbox on the reference screen. Fan/soaker heat loss W is never converted to THI.
- A function accepting per-period THI exists, but the first UI exposes only a shared representative condition for all periods.

## File guide

`docs/IMPLEMENTATION_REPORT.md`: intent of the rebuild, implementation, numerical results, verification and remaining items.

`docs/DECISIONS_v0_8.md`: implementation contracts fixed during integration.

`docs/REUSE_MAP.json`: per-file comparison with v0.4 plus SHA-256.

`docs/evidence-v08/`: logs, screens and calculation results from the pre-split v0.8 implementation.

`evidence/`: output destination at test time. Not tracked by Git.

`reference/`: original Python models and specs used for cross-checking.

`examples/`: loadable schema-9 placement examples.

## Issues and standalone repo

- [Reflective-coating model and milk reference issues](docs/MODEL_REVIEW_2026-09-27.md): evaluation results, sensitivity checks, unimplemented improvement candidates.
- [Standalone repository split](docs/STANDALONE_REPOSITORY.md): file extraction, independent build/launch, Git init procedure.
- [AGENTS.md](AGENTS.md): scope and verification rules for agents working on this standalone version.

## Checking an MCP-built scenario on screen

1. Have the AI calculate a scenario with the existing MCP `evaluate`; specify `includeDaily: true` for daily-resource reconciliation.
2. Ask for "the `project` from the evaluate response as a JSON file". If the client cannot create attachments, take the JSON body.
3. Open the file via "Load" at the top, or paste the body into "Import MCP scenario JSON" under "Compare" / "Settings & save". A whole response JSON also works.
4. After recalculation, check the selected scenario, placement, weather, per-area deficit and water/energy. Loading restores all scenarios and shared conditions, and "Undo" returns to the pre-load state. Invalid JSON keeps the current scenario.

Comparison means are simple averages over the 70 representative points, not weighted by herd size or occupancy. Max deficit is the largest per-point 60-min mean deficit. "Deficit not reduced" means points that still have a deficit no smaller than baseline; "no local action" is a diagnosis of local device action (roof measures excluded). Differences in a point's heat-loss breakdown come from simultaneous multi-device calculation, not per-device independent contributions.

[MCP scenario restore and comparison implementation report](docs/MCP_COMPARISON_IMPLEMENTATION_REPORT.md) records this round's verification scope. Updating sources/distributions and reflecting them to the public AWS deployment are separate tasks.

### Manual checks for this round (humans/CI)

1. Paste an MCP scenario JSON into "Import MCP scenario JSON" and confirm placement and roof conditions are reflected; confirm "Undo" restores the prior state.
2. In "Compare", look at mean/max deficit, stall/feeding/waiting, water and energy; press a top-deficit location and confirm the selected point and its heat-loss breakdown switch.

Dedicated E2E is limited to 2 tests in `python3 -m pytest tests/e2e/test_mcp_comparison.py -v`. Agent-side execution is omitted.
