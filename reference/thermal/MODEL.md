# Cooling Planner: coupled shading, insulation and sprinkling model v0.5

> Note added 2026-09-28: This document is the spec of the existing thermal model. The current plan adds the [milk hypothesis model v0.1](../../docs/MILK_HEAT_MODEL_V0_1.md), which connects the 24-hour heat-deficit aggregate to milk. Statements here that prohibit milk coupling and the 60-minute time boundary describe the scope of v0.5 on its own. For the new model's formulas, coefficients and time handling, that spec takes precedence. The thermal physics and this reference code are unchanged by it.

Model ID: `cooling-thermal-v0.5-assumptions-1`  
Created: 2026-09-26

## 1. Scope decided this time

First-version spec for changing the model barn's equipment and comparing roof-surface, roof-underside and air temperatures, the radiant environment and the representative cow's heat loss. Calibration or experiments on a real barn are not completion criteria.

This replaces the "mean radiant temperature = outdoor temperature + 2°C" rule of the previous spec `dairy_cooling_simulator_spec_v0_4.md`. Convection, soaker retained-water/evaporation and the mist moist-air calculation inherit the existing design. The original file is unchanged.

The attached Python program is an independent reference implementation of this spec. The current app connects the same thermal spec in TypeScript and integrates it into HTML and a 3D view ([README](../../README.md)). Milk and conception models, changes in cow body temperature, and new conversion into an overall feels-like temperature are not in this supplement. The existing fan-aided feels-like formula `Tair - 6*sqrt(v)` stays as a separate output. Roof radiation and soaker effects are not treated as fully expressed by that formula.

## 2. Classification of the grounds

- **Physical relations**: absorbed solar, conduction through thermal resistance, convection, radiation, latent heat of evaporation, moist-air relations.
- **Design assumptions inherited from the existing project**: barn dimensions, air exchange, fixed skin temperature and area, cow heat-transfer coefficient, retained-water capacity, etc.
- **Design assumptions made this time**: roof reflectance, roof thermal resistance and heat-transfer coefficients, insulation thickness and conductivity, roof-spray conditions, view factor, background heat release.

The coefficient set as a whole is not verified by papers or manufacturers. It is an original reduced-order model that plugs assumed values into physical formulas — not a reimplementation of EnergyPlus or the Zhou et al. model.

## 3. Shared initial conditions

| Item | Value | Basis |
|---|---:|---|
| Barn length × width | 36.4 m × 23.5 m | Inherits the existing template |
| Eave/ridge height | 4.0 m / 8.7 m | Same |
| Floor area Af | 855.4 m² | length × width |
| Actual roof area Ar | `2*L*sqrt((W/2)^2+(ridge-eave)^2)` | symmetric gable; eave overhang omitted |
| Outdoor air | 32°C, RH 70%, 101325 Pa | demo conditions |
| Solar incident on the roof I | 800 W/m² | input per actual roof area, not horizontal-plane solar |
| Air exchange | `0.015*Af` m³/s = 12.831 m³/s | existing assumption; not auto-increased by circulation-fan count |
| Background sensible heat Qbg | 10000 W | new assumption; a shared background load, not a sum over the 70 points |
| Radiant background temperature of walls/floor etc. | same as outdoor temperature Tout | approximated as a fixed boundary with infinite heat capacity |
| Cow surface temperature Ts | 35°C | fixed comparison surface; not a prediction of real body temperature |
| Cow effective area A | 4.5 m² | existing assumption |
| Area wetted by sprinkling Aw | 2.0 m² | existing assumption |
| Cow emissivity epsilon | 0.95 | existing assumption |
| View factor cow→roof F | 0.35 | new assumption; a first-version value shared by all points |
| Normal effective wetness fraction f0 | 0.06 | existing assumption |
| Cow retained-water cap | 0.30 kg | existing assumption |
| rho, cp, Rv, Lv | 1.2 kg/m³, 1006 J/(kg K), 461.5 J/(kg K), 2430000 J/kg | fixed-property approximation inherited |
| Trial time / step | 3600 s / 1 s | devices start ON; retained water starts at 0 |

Each representative-cow result is an independent per-point comparison — not the balance of 50/70 cows present at once, and it is not summed or fed back into the barn's total load.

## 4. Equipment parameters

| Equipment / parameter | First-version value |
|---|---|
| Roof solar reflectance r | 0.20 normal, 0.70 with reflective coating |
| Original roof material resistance R0 | 0.02 m² K/W (surface film resistance excluded) |
| Insulation | thickness d=0.02 m, conductivity lambda=0.035 W/(m K) |
| Material resistance after insulation R | `R0+d/lambda` ≈ 0.59143 m² K/W |
| Roof outside convection coefficient ho,c | 10 W/(m² K) |
| Roof outside linearised radiation coefficient ho,r | 5 W/(m² K) |
| Roof inside convection coefficient hi,c | 3 W/(m² K) |
| Roof inside linearised radiation coefficient hi,r | 5 W/(m² K) |
| Roof sprinkling | 0.05 L/(min m²) per actual roof area, 2 min ON / 8 min OFF |
| Roof retained-water cap Mr,max | 0.05 kg/m² (model value for a thin water film) |
| Roof-spray coverage | uniform over the whole roof in v1; all supplied water assumed to reach the roof |
| Cow sprinkling | 1.3 L/min per nozzle, 2 min ON / 10 min OFF |
| Capture fraction onto the cow c | existing 256-ray geometric calculation in the UI; the standalone estimate uses 0.25 |
| Mist | evaporable cap of 0.60 of supply, with a saturation bound on top |
| Mist air cell | floor area 4 m², ventilation 0.06 m³/s, allocated flow to the cell 0.01 L/min |
| Mist cycle | 1 min ON / 4 min OFF |

"Insulation" here means a finite-thickness insulation layer, not the product performance of a thin aluminium reflective sheet. The UI label is also "Insulation 20 mm". A low-emissivity reflective sheet must not be equated with this R value.

## 5. Coupled roof–air calculation

Symbols: To = outdoor temperature, Te = roof outer surface, Ti = roof inner surface, Ta = barn air. Temperature differences in °C = K; each heat flux q in W/m²; roof evaporation rate er in kg/(m² s).

```text
q = (Te - Ti) / R
(1-r)*I = (ho,c + ho,r)*(Te-To) + q + Lv*er
q = hi,c*(Ti-Ta) + hi,r*(Ti-To)
rho*cp*Vdot*(Ta-To) = Ar*hi,c*(Ti-Ta) + Qbg
```

Solve for Te, Ti, Ta and q satisfying these four equations simultaneously. Not all roof radiant heat is added to the air temperature — only the inside-convection term enters the air balance. Roof and barn-air heat storage are not solved; a quasi-steady solution is used at each step.

The outside long-wave radiation is also approximated by a linear term referenced to outdoor temperature. Sky radiation, cloud cover and night-time radiative cooling are not solved independently. Walls and floor are fixed boundaries; this is not a closed dynamic energy model of the whole building.

### Roof sprinkling

With the water film per m² denoted M, each step does:

```text
received = M + roofSupply*dt
runoff = max(received-Mmax, 0)
Mpre = min(received, Mmax)
fwet = Mpre/Mmax
km,roof = ho,c/(rho*cp)
deltaRho = (pws(Te)-pv,out)/(Rv*((Te+To)/2+273.15))
er = min(km,roof*fwet*max(deltaRho,0), Mpre/dt)
Mnext = Mpre-er*dt
```

Since Te and er depend on each other, the roof heat-balance residual is solved by bisection. Latent heat is deducted **from the roof only**. Excess water runs off; after the spray stops, only the remaining water keeps evaporating. The film temperature is taken equal to the roof temperature; sensible heat of water inflow/outflow, and condensation or freezing on the roof, are omitted.

Roof vapour is assumed to escape outdoors and runoff to drain via the gutter; indoor humidity is not directly increased. Roof spraying is not modelled as "supply = all evaporated".

## 6. Radiation and convection on the cow

The roof temperature is passed to the cow side instead of the old fixed value.

```text
Tr,K^4 = F*(Ti+273.15)^4 + (1-F)*(To+273.15)^4
Qrad = epsilon*sigma*A*((Ts+273.15)^4 - Tr,K^4)
hc(v) = 3.5 + 4*sqrt(v)
Qconv = A*hc(v)*(Ts-Tlocal)
```

`hc(v)` inherits the existing in-house coefficient function. A cooler roof reduces the radiant load on the cow. If the air is above Ts, Qconv goes negative and warm air adds heat. Negative values are not rounded to zero.

## 7. Cow sprinkling (soaker)

Only the spray amount reaching the cow enters the retained water. What falls onto the floor or feed is not credited to cow cooling.

```text
mCaptured = nozzleLpm/60 * capturedFraction
km = hc/(rho*cp)
deltaRho = (pws(Ts)-pv,local)/(Rv*((Ts+Tlocal)/2+273.15))
mBase = km*A*f0*max(deltaRho,0)
mCond = km*A*max(-deltaRho,0)
mCondOnPatch = mCond*Aw/A
received = M + (mCaptured+mCondOnPatch)*dt
runoff = max(received-Mmax,0)
Mpre = min(received,Mmax)
mSoak = min(km*Aw*(1-f0)*(Mpre/Mmax)*max(deltaRho,0),Mpre/dt)
Mnext = Mpre-mSoak*dt
Qsoak = Lv*mSoak
```

No air-cooling step is applied. Evaporation is added directly to the cow's heat loss. Wind speed acts through km, humidity through deltaRho, and the spray amount and cycle through M. The effective temperature of the wet skin and water equals the fixed Ts; water sensible heat and coat interior temperature are not computed separately.

The barn-wide humidity rise from soaker evaporation is not fed back — this inherits the existing "independent evaluation points" model boundary.

## 8. Mist

Ta from the roof–air heat calculation is the inlet temperature; the outdoor vapour pressure is carried over. RH is not re-pinned to 70% just because the air warmed: absolute humidity is conserved and local RH recomputed.

Moist-air relations use the PsychroLib/ASHRAE SI forms.

```text
w = 0.621945*pv/(P-pv)
h(T,w) = 1000*(1.006*T+w*(2501+1.86*T))
```

Find the saturation endpoint at constant h, then

```text
deltaW = min(0.6*mWater/mdry, max(wSatAtH-wIn,0))
wOut = wIn+deltaW
TOut = (hIn/1000-2501*wOut)/(1.006+1.86*wOut)
mEvap = mdry*deltaW
```

RH never exceeds 100%; if the inlet is saturated, evaporation and temperature drop are both 0. When OFF, the cell returns to pre-mist conditions. The air's latent heat of evaporation is not added again to cow heat loss. The lowered local temperature and raised vapour pressure are passed to §6–7.

No step returns heat or humidity from a local mist cell to the roof or the whole barn; advection and residence between cells are omitted. Unevaporated supply water stays in the resource tally.

## 9. Display definition of cow heat-load reduction

```text
Qnet = Qconv + Qrad + Lv*(mBase + mSoak - mCond)
heatLoadReduction = mean(Qnet,edited) - mean(Qnet,baseline)
```

Positive means "the same representative surface sheds more heat than the baseline". The UI shows this as "heat-load reduction (reference)" or "heat-loss improvement". It is neither the body's actual heat storage including metabolism, nor a core-temperature prediction. The W difference is not subtracted from milk yield or THI directly.

The JDLA-published fan-aided feels-like temperature is kept separately as `Tlocal - 6*sqrt(v)`. Wetting the cow alone does not lower that formula's value on our own. Conversion to an overall feels-like temperature needs a definition under a different model ID; this file is not shown as having done that validation or conversion.

## 10. Combination rules

- Shading changes r, insulation R, roof spray er; all are evaluated in the same simultaneous solve.
- Individual "-N°C" figures are not added together. Combined effects can be smaller than the plain sum.
- Circulation fans change v at the cow position. They do not auto-increase the building ventilation rate.
- Roof-spray latent heat is counted once at the roof, mist latent heat once in the air, soaker latent heat once on the skin.
- 3D particles, camera and heat-map interpolation never affect the computed values.

## 11. How to run / verification status

Python 3.10+, no extra libraries.

```sh
python thermal_model.py
python -m unittest -v
```

Running it emits a settings JSON and comparison JSON/CSV. Results use the same outdoor air, solar and a 2 m/s wind at the cow position for every scenario: the mean of a 60-minute run from a dry initial state. Water use is the amount over those 60 minutes, not a daily figure.

Verified items (17): geometry, shading direction, insulation inside/outside temperature difference, zero coating effect at zero solar, uniform equilibrium, the three roof balances, roof and skin water balances, soaker not changing air temperature directly, drying after OFF, mist saturation/enthalpy, no double counting of latent heat, reproducibility, negative convection from warm air, 1 s/0.5 s time steps, abnormal inputs.

This confirms the program follows this spec — not agreement with a real barn. Integrated tests of 3D, save/restore and all-point computation were not done this time.

## 12. References

S1. Existing project `dairy_cooling_simulator_spec_v0_4.md`, chapters 3, 4, 6 and 7. Dimensions, convection, retained water, mist and trial boundaries inherited. The source's coefficients were also inherited as design assumptions.

S2. EnergyPlus 24.1 Engineering Reference, Outside Surface Heat Balance. The distinction of solar/convection/radiation/conduction and the idea of solving them together. Not the source of this supplement's coefficients or reduced calculation itself.  
https://bigladdersoftware.com/epx/docs/24-1/engineering-reference/outside-surface-heat-balance.html

S3. PsychroLib API Documentation / source. ASHRAE 2017 moist-air and saturation vapour-pressure relations in SI units.  
https://psychrometrics.github.io/psychrolib/api_docs.html  
https://psychrometrics.github.io/psychrolib/_modules/psychrolib.html

S4. Chiba Prefecture, "Dairy cattle: recommendations for heat countermeasures" (2025). Basis for separating the actions of roof radiation, shading/insulation/roof spray, fine mist and cow sprinkling. Case-study temperature drops are not used as coefficients applicable to all conditions.  
https://www.pref.chiba.lg.jp/ninaite/network/field-chiku/chiku-2025-06.html

S5. Zhou et al. (2024), Effectiveness of cooling interventions on heat-stressed dairy cows based on a mechanistic thermoregulatory model. Biosystems Engineering 244:114–121. The university's public abstract was used to check the classification of action paths. This supplement is not that paper's 3-node thermoregulation model.  
https://research.wur.nl/en/publications/effectiveness-of-cooling-interventions-on-heat-stressed-dairy-cow/  
DOI: 10.1016/j.biosystemseng.2024.06.003

## 13. Bundled-code results

| Scenario | Roof underside °C | Barn/local air °C | Mean radiant °C | Heat-loss improvement W |
|---|---:|---:|---:|---:|
| Fans, no roof measures | 57.9 | 36.5 | 41.8 | 0 |
| Reflective coating | 41.8 | 34.0 | 35.5 | 285 |
| Insulation 20 mm | 39.3 | 33.7 | 34.6 | 326 |
| Roof sprinkling | 46.4 | 34.7 | 37.3 | 204 |
| Cow sprinkling | 57.9 | 36.5 | 41.8 | 459 |
| Coating + insulation | 34.9 | 33.0 | 33.0 | 399 |
| Coating + insulation + cow sprinkling | 34.9 | 33.0 | 33.0 | 861 |
| Mist | 57.9 | 35.7 | 41.8 | 29 |
