# WebMCP implementation — English Amplify site

## Purpose and behavior

The `english` branch can expose the live page's existing MCP commands as WebMCP tools. After deploying this branch, the demo URL is:

https://english.da05znjm47ziu.amplifyapp.com/

Codex calls Chrome DevTools MCP, which invokes a tool registered by the displayed page. Each tool delegates to `createCommands()` and the same ProjectStore used by manual input. The page does not connect to localhost or to a cloud command relay. The browser connected to Codex must remain open on the demo tab.

## Changes

- `src/mcp/webmcp.ts`: tool schemas, runtime input validation, JSON string results, read-only annotations, current document API / earlier navigator API detection, and registration failure reporting with best-effort cleanup.
- `src/main.ts`: automatic WebMCP initialization on ordinary URLs, shared command dependencies, and a persistent English status badge. Existing local `?mcp=1` initialization is preserved. `?webmcp=0` opts out; `?webmcp=1` adds diagnostic failure toasts.
- `src/styles.css`: status badge styling.
- `tests/integration/webmcp.test.mjs`: registration, real Store editing and undo, sheet opening, malformed-input rejection before mutation, baseline and pending-input protection, asynchronous results/errors, unsupported API behavior, and registration cleanup.
- `README.md`: deployment URL, Chrome/Codex configuration, and usage.
- Generated `cooling-planner-v0.10.html` and `dist-offline/`: updated by the normal build.

Tools: `get_state`, `edit`, `set_view`, `get_results`, `undo`, `describe_model`, `evaluate`, `compare_candidates`. Operation names and permitted fields follow the existing local MCP. Runtime schema validation runs before the existing domain checks. No formulas, coefficients, defaults, or project-save schemas were changed; no new model assumptions were added.

## Validation

- `npm run typecheck`: passed.
- `npx tsc` and `node --test tests/integration/webmcp.test.mjs tests/integration/mcpCommands.test.mjs`: 28 passed (8 WebMCP adapter tests and 20 existing command tests), including ordinary-URL registration policy.
- `npm run build`: passed; portable distribution and generated single-file HTML updated.
- `git diff --check`: passed.
- Real Chrome, Codex-to-browser, and deployed Amplify behavior require the manual acceptance check below. They have not been tested by the agent. Per `AGENTS.md`, browser/E2E checks are left to humans and CI unless explicitly requested.

## Manual acceptance after deployment

1. Deploy the updated `english` branch using the existing Amplify Git workflow. Confirm the deployment has finished before opening the URL.
2. Use a supported visible Chrome with WebMCP enabled and Chrome DevTools MCP with `--categoryExperimentalWebmcp`. The currently published MCP configuration requires Chrome 150+ and `--enable-features=WebMCP`; confirm requirements for the installed version.
3. Open `https://english.da05znjm47ziu.amplifyapp.com/` in the tab connected to Codex without query parameters. Confirm **WebMCP ready** and eight registered tools.
4. Call `get_state`. Record the active scenario, device IDs, input hash, and Undo count.
5. Call `edit` with `{"operation":"update_roof","patch":{"reflectance":0.8}}` on an editable scenario. Confirm the roof input updates, the hash changes if the value changed, and recalculation starts. Use another valid value if 0.8 was already set.
6. Call `set_view` with `{"sheet":"compare"}`. Confirm the comparison sheet opens. Call `get_results` with at least one second between attempts until the relevant calculation stage is ready; do not interpret pending/null results as zero.
7. Call `undo`. Confirm the roof setting returns to its previous value through the normal UI Undo history. View changes do not undo.
8. Verify an invalid metric or an out-of-range `timeSec` returns an error without changing the screen. Confirm edits to the baseline remain blocked.
9. On an unsupported browser, the ordinary URL should show **WebMCP unavailable** and manual operations should still work without an error toast. Open the same site with `?webmcp=0` and confirm ordinary operation without the badge. Check the original local `?mcp=1` route separately if used.

## Limits and sources

The initial release required `?webmcp=1`, so tools were not registered when opening the ordinary Amplify URL. Comparison with the working `star-view` implementation showed it registers `document.modelContext` tools on ordinary URLs. Cooling Planner now follows that initialization behavior. This was an application startup condition; moving to another hosting provider is not required. The comparison was read-only; no files in `star-view` were changed.

WebMCP is experimental and its API may change. Registration uses `document.modelContext` when available, otherwise `navigator.modelContext`; it cannot enable the browser feature itself. `WebMCP ready` confirms successful tool registration, not a verified Codex connection. Concurrent use by multiple AI clients on the same tab is outside this PoC's acceptance scope. The page's authoritative state and the remote Lambda MCP's calculation state are separate.

The thermal, water, daily-milk, and fertility models retain their existing assumptions and limits. Reproducible screen control does not establish real-barn predictive validity.

- [Chrome WebMCP imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api)
- [Chrome WebMCP debugging](https://developer.chrome.com/docs/devtools/agents/webmcp-debugging)
- [Chrome DevTools MCP configuration](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/configuration.md)
- [Codex MCP configuration](https://developers.openai.com/codex/mcp/)
