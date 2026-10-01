# Cooling Planner — heat-load to milk hypothesis model v0.1

Spec decided: 2026-09-28. Status updated: 2026-10-01. Decision ID: D09-M01. Model ID: `milk-heat-deficit-v0.1`.
Status: **implemented as a hypothesis model**. See the [implementation report](MILK_MODEL_IMPLEMENTATION_REPORT.md) for arithmetic, integration and browser verification. Validity on real farms and coefficient calibration are unverified.
This compares a representative day in which fixed weather and solar repeat for 24 hours; hourly weather and night-time solar variation are not implemented.
For how the model connects to the code, operation start times, save format and implementation order, see the [implementation plan / handover](MILK_MODEL_IMPLEMENTATION_PLAN.md).

## 1. Purpose and priorities

Connect equipment → barn environment → cow heat loss → daily heat load → reference impact on daily milk.
Even if the model is incomplete, state the assumptions and compare equipment scenarios under the same weather and cow conditions.
Real-farm measurement and validity checks belong to another phase and are not completion criteria for the first version.

This document is the milk calculation spec of the current plan. v0.6's policy of "the 6 published conditions only, as the main output" and
v0.8's blanket prohibition on W→milk coupling are replaced only within the explicit hypothesis model defined here.
The thermal physics of v0.5 is inherited, but this plan extends the computation period and history handling for 24-hour aggregation.
No in-house conversions to environmental THI, fan-aided feels-like temperature, core body temperature or conception are added.

The existing milk table `milk-table-cowbell178-v1` is kept as source material.
The table itself is not interpolated or extrapolated, and this spec's coefficients are not treated as derived from it.
The current app implements this hypothesis model's daily calculation on top of the 60-minute thermal diagnosis. The table reference remains as an independent resource.

## 2. Initial values and classification

| Item | Initial value | Unit / meaning | Class |
|---|---:|---|---|
| Daily milk without heat stress Y0 | 40 | kg/cow/day. Distinct from current measured milk | demo_assumption |
| Reference heat loss Qref | 630 | W/cow. Fixed origin for counting load | demo_assumption |
| Conversion coefficient beta | 0.010 | (kg/cow/day)/(W/cow). A 100 W daily-mean deficit lowers milk by 1 kg/cow/day | demo_assumption |
| Loss cap fraction rmax | 0.25 | 25% of Y0. Not a biological maximum loss rate | demo_assumption |
| Weights for today / yesterday / day before | 0.2 / 0.5 / 0.3 | sums to 1 | demo_assumption |
| Occupancy fractions: stall / feeding / other | 14/24 / 6/24 / 4/24 | herd distribution at each time | demo_assumption |
| beta sensitivity comparison | 0.005 / 0.010 / 0.015 | spread across assumptions. Not a confidence interval | demo_assumption |

Basis for Qref: a trial on thermal v0.5 with air 25°C, RH 60%, wind 0.4 m/s, radiant environment 25°C,
zero solar, zero background sensible heat, no sprinkling and skin 35°C gives about 628.8359 W/cow.
That computed value was rounded to the initial value 630 W. Choosing 25°C etc. as the load origin is itself an assumption.
630 W is not an observation of metabolic heat, actual required heat loss, or a physiological threshold.
Qref is not recomputed per scenario; it is stored as a coefficient of the model version.

beta is not a regression coefficient estimated from experiments. It is a placeholder for first checking comparative behaviour.
Changing Y0 does not auto-adjust beta in v1. No response is added for higher-yielding cows producing more heat.

## 3. Definition of heat load

Let Q[s,i,t] be the existing net heat loss of scenario s, point i, time t. Outward heat loss is positive.
Convection, radiation, base evaporation, soaker evaporation and condensation are each counted once by the existing model.

```text
H[s,i,t] = max(0, Qref - Q[s,i,t])
```

H is a hypothetical index, "heat-loss deficit relative to the reference" — not actual body heat storage.
The formula applies even when Q is negative. Surplus heat loss at cool places/times does not offset deficits at hot ones.
Apply max per point first, then average over space and time.

### Herd-mean occupancy distribution

At all times: stalls 14/24, feeding area 6/24, other 4/24.
Evaluation points in the same area share that area's fraction equally. All point weights sum to 1.
This is not a model in which each cow moves at the specified times — it is a herd-mean occupancy distribution.
The implementation plan uses 50 stall points, 12 feeding points and 8 robot-front points to represent the other area.
That robot-front stands in for alley/milking etc. is also shown as a design assumption.
The same distribution applies to every scenario; cows are not moved automatically by the presence of equipment.

Each evaluation point must map to one of the 3 areas. A missing area is never redistributed to others without notice.
Do not replace this with the old simple all-points mean, or with the single point selected in the UI as the herd mean.
A point's retained water stays a state of an independent representative surface, as before; water carried between locations is not modelled.

### Daily aggregation

```text
D[s,d] = sum_t(sum_i(weight[i,t] * H[s,i,t]) * dt_seconds) / 86400
```

D is in W/cow (daily mean). The aggregation period is 24 hours; weights sum to 1 at each time.
A 200 W deficit over 24 h gives D=200 W; over 12 h with no deficit for the rest gives D=100 W.
A 1-hour result is never scaled to 24 hours without explanation. Values are integrated at the computation step, not re-aggregated from display samples.

## 4. Lag, daily milk and cap

```text
E[s,d] = 0.2*D[s,d] + 0.5*D[s,d-1] + 0.3*D[s,d-2]
L[s,d] = min(Y0*rmax, beta*E[s,d])
Y[s,d] = Y0 - L[s,d]
deltaY[d] = Y[improved,d] - Y[baseline,d]
```

E is the lagged load, L the milk reduction, Y the daily milk. L and Y are in kg/cow/day.
Even without heat stress today, residual load from the past two days means Y does not return to Y0 immediately.
The formula contains no body heat storage, no independent night-time recovery mechanism, and no effects beyond 3 days.

With the initial values Y is 30–40 kg/cow/day. When the cap is reached, show "loss cap reached" and
explain that further load differences no longer appear in milk. The cap is not treated as a physiological safe zone.
If the improved scenario is worse, deltaY can be negative. Improvement differences are not clamped to ≥0.
Re-picking the baseline changes only the difference; each scenario's Y itself does not change.

Fans, shading, insulation, roof spray, soakers and mist are computed together on the thermal-model side.
"X kg from fans, Y kg from sprinkling" are not added together, and literature milk gains are not stacked on top.

## 5. Time, operation and initialisation

The thermal calculation keeps its 1-second step. A day is 86400 s; roof and air use the quasi-steady solution at each step.
Retained water and cycle phase are carried across time and day boundaries. Equipment is not restarted from dry every hour.
Under the implementation plan's daily-operation policy, each day's cycle restarts ON at the configured start hour.
This is distinct from an unconditional reset at midnight or evaluation-day start, and also applies to 24-hour operation.
After equipment changes, each scenario is recomputed from the same shared conditions; results do not depend on edit order.

### v1: when the same representative day repeats

1. Make weather, placement, 24-hour operation conditions and occupancy distribution correspond across all scenarios.
2. Compute each scenario for a 24-hour preparation run from a dry initial state.
3. Carry the state over and evaluate the next 24 hours.
4. Set the evaluation day's D on the two preceding days as well. Hence E=D.

Display as "reference estimate for a repeated representative day". Do not present it as milk gained on the day equipment is installed.
The 24-hour preparation is a v1 assumption, not a guarantee of convergence to an exact periodic steady state.
When no hourly weather exists, state explicitly that current temperature, humidity and solar are treated as constant for a virtual 24-hour day.
Do not treat constant night-time solar as an actual diurnal variation or daily-mean weather.

Because daily operating hours alone do not fix when ON occurs, connecting to daily milk needs a 24-hour
operation mask. The [implementation plan](MILK_MODEL_IMPLEMENTATION_PLAN.md) sets 08:00 as the default start and defines midnight-crossing and cycle-restart rules.
Do not silently replace daily operating hours with all-day operation. An all-day example must say "24 h ON" explicitly.
Resource amounts compared against daily milk are computed from the same operation mask.

### Future extension: time series after switching equipment

The formula is shared, but this is not a required v1 view. D for the two days before the switch is shared by both scenarios,
and residual water and cycle phase at the switch are taken from the shared history. Missing history is not filled with 0.
When no actual history is used, record the assumption that the baseline scenario's representative day fills the two pre-switch days.

## 6. Inputs, outputs, display and saving

Inputs include the model ID, Y0, Qref, beta, rmax, lag weights, areas and occupancy fractions,
24-hour weather and operation conditions, the time mode and initialisation conditions. Cow, coefficient and weather conditions are aligned across scenarios.

Outputs are D, E, L, Y, the difference from baseline, the cap-reached flag, the assumptions used and the model ID.
When required inputs are missing, values are null — the previous value or 0 is not kept as the latest milk figure.
Y0 is a finite positive value, beta and Qref finite non-negative, rmax in 0–1, each weight non-negative summing to 1.
Weather, wind speed etc. inherit the thermal model's input ranges; out-of-range values are not rounded in.
Missing times or points, missing area mapping, and non-finite values are returned as not calculable with reasons.

The main display is "reference impact on milk yield (hypothesis model)", showing daily milk and the difference from baseline to one decimal place.
No rounding during computation. The detail view must expose Y0, load, coefficients, cap and the representative-day assumptions with sources.
The three beta conditions are applied to all scenarios equally. A favourable coefficient is never picked per scenario.
That spread is "the spread when the conversion assumption is changed" — not shown as a confidence interval or real-farm prediction range.
The milk table's out-of-scope reason card is not placed on the new model's main path. The original table stays browsable as source material.

Save/restore keeps the coefficients and assumptions; existing v8 data is not silently reinterpreted under the new model.
The implementation plan adopts save format 9, does not auto-convert v8, keeps the current scenario and rejects the load.
The current code and save format are unchanged.

## 7. Calculation examples and acceptance criteria

### Numeric examples

Let Y0=40, beta=0.010, rmax=0.25.

| E (W/cow) | L (kg/cow/day) | Y (kg/cow/day) |
|---:|---:|---:|
| 0 | 0 | 40 |
| 100 | 1 | 39 |
| 300 | 3 | 37 |
| 1200 | 10 (cap) | 30 |

If baseline D=300 and the improved D=100 persist, milk goes 37→39 kg/cow/day, difference +2.
With D=300 for the two pre-switch days and D=100 from the switch day, E goes 260→160→100 and Y 37.4→38.4→39.0.
These are arithmetic examples of the formulas, not reproductions of papers or real farms.

### Acceptance criteria (see the implementation report for how MH01–MH15 were exercised)

| ID | Check | Expected |
|---|---|---|
| MH01 | compare identical scenarios | D, E, Y equal; milk difference 0 |
| MH02 | no deficit today or the past 2 days | Y=Y0 |
| MH03 | Q exceeds Qref | H=0; milk never rises above Y0 |
| MH04 | E=1200, initial coefficients | Y=30, cap-reached shown |
| MH05 | 200 W deficit for 12 h, then 0 | D=100 W |
| MH06 | two equal-weight points, Q=430/830 | mean deficit 100 W — Q is not averaged first to 0 |
| MH07 | 300 before switch, 100 after | Y=37.4→38.4→39.0 |
| MH08 | re-pick the baseline | each scenario's Y unchanged; only the difference changes |
| MH09 | improved scenario has larger load | keep the negative milk difference |
| MH10 | spray stops at an hour or day boundary with residual water | water and cycle carried over; no re-initialisation |
| MH11 | missing times, areas or invalid coefficients | milk is null with reasons; feasible thermal comparison continues |
| MH12 | 3 beta sensitivity conditions | each applied to all scenarios; shown as assumption spread |
| MH13 | change displayed point, camera, playback speed | herd-mean milk and aggregation period unchanged |
| MH14 | save and restore | model ID, coefficients, weather/operation/history assumptions and results match |
| MH15 | combined equipment | use the jointly computed Q; do not add per-equipment milk figures |

MH07's time series is accepted at formula level; adding a time-series screen is not a v1 requirement.

## 8. Grounds, limits and change log

- [Thermal model v0.5](../reference/thermal/MODEL.md): definition of Q. Inherits the boundary that fixes skin temperature and does not solve metabolism, respiration or body heat storage.
- [Reuscher et al. (2023)](https://pubmed.ncbi.nlm.nih.gov/37678773/): fan experiments in a freestall barn. Wind 0.4→1.7/2.4 m/s gave milk 41.0→42.6/43.0 kg/day. Their milk analysis also handled the previous day's THI. Grounds for considering fan action and lag — not the source of this spec's 630 W, beta or weights.
- [Chen et al. (2016)](https://www.sciencedirect.com/science/article/pii/S0022030216301503): 3 min ON / 9 min OFF spray experiment. Difference vs no spray: 3.3–3.7 kg/day. No significant milk difference between 1.3/4.9 L/min. Material confirming a saturating effect — not used as a milk bonus added under all conditions.

Scope: standard herds of lactating Holsteins. No correction for lactation stage, feed, disease or individual differences.
It is not treated as reproducing the literature conditions or as having completed calibration of the initial coefficients. Differences can also vanish when the milk cap is reached.
That different equipment improving Q by the same amount is treated as the same action in this milk formula is also an assumption.

2026-09-28: this spec added as D09-M01. The independent estimate of the reference heat loss and the arithmetic examples were checked in the preceding review.
The document update at that time did not change the app, the reference Python, tests or distributions.
Same-day addendum: the [implementation plan / handover](MILK_MODEL_IMPLEMENTATION_PLAN.md) made area mapping, daily-operation start time, computation structure, save format, display and verification procedure concrete. Implementation of the new model and performance measurement were not yet done.

2026-10-01: the document was aligned with the implemented state. The "not yet implemented" record under 2026-09-28 above is the update history of that time. This update changed no formulas, coefficients or scope.
