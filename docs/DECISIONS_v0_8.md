# Cooling Planner integration decisions v0.8

> Note added 2026-09-28: This document records the existing implementation and past decisions. For milk in the current plan, the [hypothesis model v0.1](MILK_HEAT_MODEL_V0_1.md) (D09-M01) takes precedence. The limitation of "the 6 published conditions as the main output" and the time boundary for milk coupling are updated only within that spec. The prohibition on interpolating the original table itself is kept. The new model was unimplemented at the time; the conception spec is unchanged.


Date: 2026-09-26 / App version: 0.8.0-preview.1

## D08-01: Implement option C

Following the user's implementation request, reuse v0.4's geometry, physics, placement and state management, and rebuild the view and integration handling. Do not discard the entire existing codebase or add another barn format.

## D08-02: Keep the physics/reference models within their existing scope

Connect thermal v0.5, milk v0.6, and conception v0.7 which was adopted in the earlier discussion. The conception implementation model ID is `fertility-thi-period-or-baccouri2025-v1`. `reference/fertility/FERTILITY_MODEL_PROPOSAL.md` is kept as-is as the source record of the adopted option. The source's "unapproved" wording must not be read as meaning the integrated version has no conception implementation.

Parameters and coefficients are unchanged; the target is artificial insemination. No interpolation/extrapolation of milk, and no in-house conversions from W to milk/THI/overall feels-like temperature. Field measurement is not added to the completion criteria.

## D08-03: New save format

schemaVersion 8, integrated model ID `cooling-integrated-v0.8`. Each scenario gains roof; shared conditions gain solar and reference settings. Roof settings are included in the hash, identical-scenario cache, input validation, Undo and JSON save.

No automatic migration from old v4. Failed loads are rejected atomically and the current scenario is kept. The original code and old data are not updated.

## D08-04: Separate view time from calculation time

The thermal calculation is 3600 s at 1 s steps; every scenario shares the same initial conditions. As a time series it returns 61 points: the first second and every 60 s. The display cursor only shows a nearby sample and does not round inputs. Curves join samples with lines for display. Unrelated to milk-table interpolation.

Floor colors and result cards are 60-minute means. Playback moves the wind/spray display and the time cursor; it does not change the calculation. Water uses cycle, flow and operating hours; daily electricity is computed separately from operating hours.

## D08-05: Do not silently turn conception into a period representative

The initial conception input is an independent manual representative environment of 26°C, RH 70%. The same for all periods; baseline probability 40% is assumed. It is not displayed as "the conception rate under the current equipment".

Only when "adopt the selected point's 60-min mean as the 52-day representative conditions" is checked does it become `mode=simulation`, saving `exposureAssumed=true`. The difference from baseline is compared under the same model and p0. Within the same THI band it does not change. It is a per-point reference, not a herd-wide conception forecast.

## D08-06: Consolidate distribution into one line

This working build is TypeScript → a single-file HTML / static file set, reusing the existing native WebGL rendering. The old Three.js adapter and the unverified Vite delivery path are excluded from the new package. Do not change the look merely by introducing a library — prioritise operation and heat visualisation.

If WebGL initialisation fails, fall back to the existing SVG 2D. The worker runs inside the browser, not an external API. The single-file HTML embeds a Blob Worker, so when CSP is configured in the delivery environment, consistency with inline script/style and `worker-src blob:` etc. must be checked separately. CSP restrictions are not bypassed automatically.

## D08-07: Resource-quantity implementation parameters

Inherit operating hours and pump power of the existing fans, soaker and mist. For the daily roof-spray figure, add initial operation 8 h/day and pump 0.25 kW as extra resource-estimation assumptions. The thermal side keeps v0.5's 2 min ON / 8 min OFF and 0.05 L/min/m². This does not represent actual roof-pump performance.

## D08-08: Completion criteria

Model definitions are not re-investigated. Test the path of placement and roof conditions → recompute all points → results → comparison → save/restore, and the applicable scope of milk and conception. In-browser operation checks and delivery checks over HTTP/public hosting are recorded separately.
