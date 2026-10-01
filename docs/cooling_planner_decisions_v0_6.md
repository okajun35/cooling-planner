# Cooling Planner spec supplement v0.6

> Note added 2026-09-28: This document records the existing implementation and past decisions. For milk in the current plan, the [hypothesis model v0.1](MILK_HEAT_MODEL_V0_1.md) (D09-M01) takes precedence. The limitation of "the 6 published conditions as the main output" and the time boundary for milk coupling are updated only within that spec. The prohibition on interpolating the original table itself is kept. The new model was unimplemented at the time; the conception spec is unchanged.

## Milk reference table: applicable scope, time handling and open-items management

- Decision date: 2026-09-26
- Document version: 0.6.0
- Milk reference model ID: `milk-table-cowbell178-v1`
- Inherited thermal model ID: `cooling-thermal-v0.5-assumptions-1`
- Decision status: **approved and closed (spec decision)**
- Implementation status: **app implementation and integration testing of this supplement incomplete**

> v1 returns a reference milk value only under the published conditions. No interpolation, extrapolation, or rounding to approximate conditions. The thermal calculation is a 60-minute trial under fixed weather, kept separate from milk/conception over time. The narrow applicable scope is not a reason to reopen this decision into open items.

## 1. Purpose and document precedence

The purpose is to finish a simulation that operates equipment in a model barn and compares the environment and the effect on the cow. Real-barn measurement, calibration and research-grade validation are not completion criteria for the first version.

The target is the existing single freestall template. No tie-stall barn is added.

Where documents conflict, apply them in this order:

1. **This supplement v0.6**: milk table's applicable scope, time, display/state, how decisions close.
2. **Thermal model v0.5 `MODEL.md`**: shading, insulation, roof spray, soaker, mist and cow heat loss.
3. **`dairy_cooling_simulator_spec_v0_4.md` and the existing acceptance spec**: geometry, equipment operation, state management, resources, saving/comparison, etc. not changed above.
4. Old v0.3/v0.2 specs and past screen images.

This document replaces v0.4's "do not output milk" only with the limited change that **the reference milk ratio under the conditions published in the table may be displayed**. It does not mean a comprehensive model converting every equipment effect into milk was adopted.

This is a diff to the overall spec; thermal coefficients and code are unchanged. Numbers in screen images are not used as model reference values.

## 2. Decided scope

| Decision ID | Content | Status |
|---|---|---|
| D06-01 | Milk reference covers only the 6 published conditions. Intermediate and out-of-range values are out of scope | CLOSED |
| D06-02 | No interpolation, extrapolation, nearest-neighbour selection, or application via display rounding | CLOSED |
| D06-03 | Thermal/spray time: 60 minutes fixed weather, base step 1 s | CLOSED |
| D06-04 | No time model is added to the milk reference table | CLOSED |
| D06-05 | Out-of-scope milk is null; thermal calculation and equipment operation continue | CLOSED |
| D06-06 | Keep v0.5's boundary: fan-aided feels-like and whole-measure heat-loss improvement are shown separately | CLOSED (reconfirmation of existing spec) |

CLOSED means "the spec judgment is finished". It does not mean code, unit tests, UI integration or publication are done.

## 3. Milk reference model

### 3.1 Published values

Adopt the table on page 8 of JDLA 'COWBELL No.178 autumn issue (Oct 2025)'. The table notes read "excerpted in part from Japanese Feeding Standard for Dairy Cattle 2017, Table 4.9.1.1" and "Shibata et al., 1984". This project is not treated as having re-verified the original experiment. [S1]

| Local temperature (°C) | Wind speed at cow (m/s) | Milk ratio with mild temperature as 100 (%) |
|---:|---:|---:|
| 27 | 0.18 | 85 |
| 27 | 2.24 | 95 |
| 27 | 4.02 | 95 |
| 35 | 0.18 | 63 |
| 35 | 2.24 | 79 |
| 35 | 4.02 | 79 |

Following the table note, relative humidity **60–70% (both ends inclusive)** is the applicable range. No custom humidity correction inside that range. The table's "mild temperature" is explanatory wording defining the 100% baseline; no concrete mild-temperature range is newly created from this table. "―" is missing/unpublished, and is never treated as 0 or 100.

### 3.2 Applicability check

The input is not outdoor temperature but the **local temperature, wind speed and relative humidity at the cow position** chosen as the milk reference target. For an independent table lookup, the selected reference conditions are the input as-is.

- The published value is returned when temperature is 27°C or 35°C, wind speed is 0.18, 2.24 or 4.02 m/s, and RH is 60–70%.
- 33.7°C, 2.0 m/s etc. are out of scope.
- 33.7°C is not rounded to 35°C, and 2.0 m/s is not rounded to 2.24 m/s.
- The applicability check uses values before display rounding.
- Only when handling floating-point representation error may temperature and wind speed match on absolute difference ≤ `1e-9`. This is not a real-environment tolerance or interpolation.
- Unknown units, NaN, Infinity and missing required values are distinguished as invalid input. They are not rescued by widening the applicable range.

### 3.3 Outputs and states

| State | Milk ratio | UI display |
|---|---|---|
| `available` | published ratio | "Milk ratio (reference value for temperature/wind speed)" + conditions and source |
| `out_of_scope` | `null` | "Milk estimate: outside the published table" + reason |
| `invalid_input` | `null` | "Check the input" + the item |

Out-of-scope reasons are recorded separately for temperature, wind speed, humidity, time variation, etc. When the value is `null`, it is not replaced by 0 kg, 0%, "no effect" or the same value as before the measure. A previous valid value is not kept as the latest result.

Only when a baseline milk figure (kg/cow/day at mild temperature) has been entered may this reference conversion run:

`referenceMilkKgPerDay = baselineMilkKgPerDay * milkRatioPct / 100`

The table ratio can be displayed even without a baseline milk figure. The converted value is not called an instantaneous physiological response, that day's measurement or a future prediction. A reference difference may be shown only between two valid conditions under the same baseline milk and same model. If either side is out of scope, the difference is `null`.

### 3.4 Effects this table does not contain

This table has no independent condition axes for direct soaker cooling, radiant heat, insulation performance, body-temperature change or conception rate. These effects are not stacked onto the milk ratio with custom coefficients.

- The JDLA fan-aided feels-like temperature `Tlocal - 6*sqrt(v)` is not substituted into this table's temperature column.
- Heat-loss improvement W is not converted into milk kg or milk ratio.
- If a roof measure changes the local temperature so that it matches a published condition, only **the reference value for that temperature and wind speed** may be displayed.
- Even when the reference value does not change, an effect the table does not cover is not evaluated as "zero".
- No automatic coupling to an "overall milk-yield forecast including all equipment", "annual recovered milk" or "payback years" is provided in this table model.

### 3.5 Handling on the main screen

Normal equipment-placement simulation computes continuous temperature and wind values, so milk may be out of scope — that is allowed. The environment model is not corrected to table values just to fill the milk card.

The published temperature/wind conditions must be checkable from a reference-material card or similar. Do not confuse a reference display with selected table conditions and the current barn's computed results. Adding a new standalone app or a large screen just for this is not mandatory.

## 4. Time and aggregation

### 4.1 Thermal and equipment calculation

- Trial duration: 3,600 s.
- Base time step: 1 s.
- Outdoor temperature, outdoor vapour conditions, solar, building conditions and equipment placement are fixed during one trial.
- The spray/mist ON/OFF cycles are computed. They start ON; retained water starts at 0.
- Roof and air use the quasi-steady solution at each step; no response lag from wall/roof heat storage is added.
- Water remaining on the cow or roof is updated over time; drying after supply stops is computed.
- Main results are 60-minute time means. The mean is `sum(value * dt) / 3600`.
- The timeline can show temperature, humidity, retained water, heat loss etc. over 0–60 min. It is not displayed as a 24-hour daily forecast.
- Playback speed, pause and camera operations change neither the calculation period, the values nor the water amounts.
- After equipment changes, recompute from identical initial conditions. One scenario's residual water is not carried into the next.

These fix the boundary of thermal model v0.5 and the existing spec; they do not newly require a weather API, a cow behaviour model or a building heat-storage model. [S2][S3]

### 4.2 Milk table model

The milk table has no time-dependent formula, so no time response is introduced. [S1]

- Return it as a static reference value corresponding to the published conditions.
- For a 60-minute trial in which temperature, wind or humidity varies, the table is not applied merely because the mean matches a published condition.
- Do not display a day's milk on the grounds that a published value was instantaneously passed through.
- When the reference input varies under cyclic operation such as mist, the whole-trial milk conversion is `out_of_scope`.
- A static-condition reference display and the time-varying thermal calculation are kept as separate results.
- No "milk gain 10 minutes after spraying", "recovery the next day", or "integrate daily milk from 60-minute heat loss".
- No averaging of time-series milk values, no 24-hour scaling, no extrapolation to seasons or a year.

This does not prohibit cyclic operation such as soakers. Heat and water time series are computed as usual.

### 4.3 Resource amounts

The 60-minute water figure is displayed as "amount used during the trial". If daily water/power are shown alongside, compute them separately by the existing arithmetic of operating hours and ON/OFF cycles — daily milk is never extrapolated from the 60-minute heat effect. State both units and periods. [S2][S3]

## 5. Boundaries of result display

| Display item | Adopted definition | Not added in v1 |
|---|---|---|
| Barn/local air, roof and radiant temperatures | thermal model v0.5 | real-barn accuracy guarantee |
| Fan-aided feels-like (°C) | JDLA-published formula `Tlocal - 6*sqrt(v)` | custom °C additions for soaker/radiant heat |
| Heat-loss improvement (W, reference) | v0.5 difference from baseline | cow core temperature, actual required cooling |
| Milk ratio / reference kg | only this document's published conditions | overall effect of all measures, time prediction |
| Impact on conception | **open item R01: undecided** | cosmetic numbers using undecided coefficients |

"Convert all measures into one feels-like temperature" inherits the boundary that v0.5 did not adopt. This is not a new open item this time. Proceed with the spec that displays the two existing indicators. [S2]

The first version therefore narrows the output range compared with the original vision of "always producing a number all the way to milk and conception for every equipment". Unsupported items are not treated as supported.

## 6. Acceptance test spec (not yet run)

This table is the acceptance condition for future implementation, not a record that tests passed at the time of writing.

| ID | Input / operation | Expected |
|---|---|---|
| M01 | the 6 published conditions, RH 65% | returns 85/95/95/63/79/79 per row |
| M02 | published temperature/wind, RH 60% or 70% | applicable |
| M03 | published temperature/wind, RH 59% or 71% | out of scope; milk null |
| M04 | 33.7°C, 2.24 m/s, RH 65% | out of scope; not rounded to 35°C |
| M05 | 27°C, 2.0 m/s, RH 65% | out of scope; not rounded to 2.24 m/s |
| M06 | conditions matching the table's "―" | out of scope; not filled with 0 or 100 |
| M07 | valid conditions changed to out of scope | the old milk figure is not kept as the latest value |
| M08 | baseline milk 35 kg, 27°C, 2.24 m/s, RH 65% | reference milk 33.25 kg/cow/day. Not displayed as a measured prediction |
| M09 | no baseline milk, conditions valid | ratio 95% shown; kg is null |
| M10 | only one side of a comparison is out of scope | milk difference also null, not 0 |
| M11 | time-mean alone is 27°C with other temperatures mid-trial | whole-trial milk is out of scope |
| M12 | NaN, Infinity, unknown units, etc. | invalid input. Distinguished from out-of-scope and zero |
| M13 | move equipment under conditions not in the table | heat/wind/water calculations continue; out-of-scope milk does not stop operation |
| T01 | recompute with the same inputs | same 3,600 s result |
| T02 | change playback speed, pause or camera only | numeric results and trial water unchanged |
| T03 | spray OFF with water on the skin | evaporation within the residual water; no instant milk recovery shown |
| T04 | graph / resource card | thermal axis 0–60 min; 60-min resources and daily resources keep distinct periods |

The existing tests for heat/water balances, no latent-heat double counting, save/restore, non-finite values and scenario comparison are kept. Completing this supplement's spec decision and passing those implementation tests are managed separately.

## 7. Open items

### 7.1 Open items needing a new model spec

**R01: model estimating the impact on conception.**

Undecided: the formula or table to adopt, the outcome to describe (e.g. conception rate per insemination), applicable conditions and the referenced heat-exposure period. This JDLA article does not include fertility effects in the balance calculation, so it is not derived from this milk table. [S1]

Completion condition: fix in a single spec the model name, source or explicit assumption, inputs, outputs, out-of-scope conditions, time handling and a calculation example. A prospective real-farm trial is not a completion condition. Even without a conception model, integrating the thermal calculation, placement and comparison proceeds.

### 7.2 Implementation/verification open items where a spec exists

| ID | Work | Status and completion condition |
|---|---|---|
| R02 | milk reference function and out-of-scope display | this supplement is spec only. Pass unit/view tests for the 6 conditions, null, state transitions and comparison |
| R03 | connect thermal model v0.5 to the existing 2D/3D app | v0.5 is standalone calculation code. Placement → local wind/water → roof/heat → results must reference the same state, so a before/after measure can be compared end to end |
| R04 | integration and browser operation checks | verify equipment selection/move/direction, recalculation, Undo, save/restore, comparison, real 3D rendering, error and out-of-scope states |
| R05 | pre-release/submission checks | confirm main operations and comparison work at the published URL; organise the demo and the display of grounds/assumptions. The latest published state was not checked this time |

"Real 3D rendering verification incomplete" in the v0.3 implementation report is not to be reread as "the whole latest code is unimplemented". Verify what the latest app completes at integration time and reuse the existing implementation. [S4]

**General follow-up research about model incompleteness, real-barn measurement, CFD, filling gaps in the table and a new overall feels-like temperature are NOT added to this open-items list.**

## 8. What was not changed this time, and handover

This supplement records the spec. Existing HTML, TypeScript, Python calculation code, saved data and the delivery environment are unchanged. The source library's old specs are not overwritten or deleted.

The bundled v0.5 set is kept without modifying the original ZIP contents. v0.5's test records are past execution records, not results rerun this time. They do not mean the v0.6 app is finished.

Implementation order: proceed with R02 and R03 to complete one operation/comparison loop, fix the remaining model decision R01, then move to R04→R05. The closed D06-01–06 are not returned to investigation tasks over generic accuracy anxiety. A change must be an explicit spec change under a new decision ID.

## 9. References

- **[S1]** JDLA 'COWBELL No.178 autumn issue (2025.10)', saved as `No178HP(2).pdf`. p.6: fan-aided feels-like formula. p.8: temperature/wind vs milk-ratio table, the RH 60–70% note, and the statement that fertility effects are excluded from the balance. The reference table is an excerpt of the original — it is not described as JDLA's own replication for this project.
- **[S2]** `cooling_planner_thermal_v05/MODEL.md`, 2026-09-26, §1, 3, 9, 11. Confirms the standalone calculation implementation, the not-yet-integrated scope, 3,600 s / 1 s, the boundary excluding an overall feels-like temperature, and the verification scope.
- **[S3]** `dairy_cooling_simulator_spec_v0_4.md`, §6, 7, 8, 9. Equipment and local environment, 60-min trial, daily resources, state management, comparison/saving, separation of calculation and rendering.
- **[S4]** `dairy_cooling_planner_implementation_report.md`, v0.3.0-preview.1, 2026-09-25. Past implementation report that distinguished the verification status of the 2D/shared model from real 3D rendering.

The applicable scope, no-interpolation rule and time boundary in this document are product spec agreed with the user on 2026-09-26 — the listed materials did not themselves set this app's spec.
