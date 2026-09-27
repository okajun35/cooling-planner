"""Cooling Planner: explicit v0.5 thermal assumptions, NOT a validated cow model.

Python 3.10+, standard library only. Run: python thermal_model.py
The runner compares ONE representative location for 3,600 s. No UI integration.
Physical psychrometric relations: ASHRAE 2017 / PsychroLib documentation.
Model coefficients and simplifications are documented in MODEL.md.
"""
from __future__ import annotations
from dataclasses import dataclass, asdict, replace
import csv
import json
import math
from pathlib import Path
from typing import Callable

SIGMA = 5.670374419e-8
RHO = 1.2
CP = 1006.0
RV = 461.5
LV = 2_430_000.0
PRESSURE = 101325.0
VERSION = 'cooling-thermal-v0.5-assumptions-1'


def bisect(f: Callable[[float], float], lo: float, hi: float) -> float:
    flo, fhi = f(lo), f(hi)
    if flo == 0: return lo
    if fhi == 0: return hi
    if not (math.isfinite(flo) and math.isfinite(fhi)) or flo * fhi > 0:
        raise ValueError('Root not bracketed')
    for _ in range(60):
        mid = (lo + hi) / 2
        fm = f(mid)
        if not math.isfinite(fm): raise ValueError('Nonfinite residual')
        if abs(fm) < 1e-9 or hi - lo < 1e-9: return mid
        if flo * fm <= 0:
            hi = mid
        else:
            lo, flo = mid, fm
    return (lo + hi) / 2


def pws(t: float) -> float:
    """Saturation vapor pressure [Pa], ASHRAE SI equations 5/6."""
    if not math.isfinite(t) or not -100 <= t <= 200:
        raise ValueError('Temperature outside psychrometric range')
    k = t + 273.15
    if t <= 0.01:
        ln = (-5674.5359/k + 6.3925247 - .009677843*k
              + 6.2215701e-7*k*k + 2.0747825e-9*k**3
              - 9.484024e-13*k**4 + 4.1635019*math.log(k))
    else:
        ln = (-5800.2206/k + 1.3914993 - .048640239*k
              + 4.1764768e-5*k*k - 1.4452093e-8*k**3
              + 6.5459673*math.log(k))
    return math.exp(ln)


def humidity_ratio(pv: float) -> float:
    if not 0 <= pv < PRESSURE: raise ValueError('Invalid vapor pressure')
    return .621945 * pv / (PRESSURE - pv)


def enthalpy(t: float, w: float) -> float:
    return 1000 * (1.006*t + w*(2501 + 1.86*t))


def mist(t: float, pv: float, volume_m3s: float, water_kgs: float,
         efficiency: float = .6) -> tuple[float, float, float]:
    """Local, constant-enthalpy evaporation. Returns T, pv, evaporated kg/s.
    Water sensible heat and feedback to the roof/whole barn are omitted.
    """
    if volume_m3s <= 0 or water_kgs < 0 or not 0 <= efficiency <= 1:
        raise ValueError('Invalid mist input')
    if pv > pws(t) + 1e-6: raise ValueError('Supersaturated inlet')
    if water_kgs == 0 or pv >= pws(t) * (1 - 1e-12): return t, pv, 0.0
    wi = humidity_ratio(pv)
    h = enthalpy(t, wi)
    tsat = bisect(lambda x: enthalpy(x, humidity_ratio(pws(x))) - h,
                  -30.0, t)
    wsat = humidity_ratio(pws(tsat))
    specific_volume = 287.042*(t + 273.15)*(1 + 1.607858*wi)/PRESSURE
    mdry = volume_m3s / specific_volume
    dw = min(efficiency*water_kgs/mdry, max(wsat-wi, 0.0))
    wo = wi + dw
    tout = (h/1000 - 2501*wo)/(1.006 + 1.86*wo)
    pout = PRESSURE*wo/(.621945 + wo)
    return tout, pout, mdry*dw


@dataclass(frozen=True)
class Model:
    length_m: float = 36.4
    width_m: float = 23.5
    eave_m: float = 4.0
    ridge_m: float = 8.7
    outdoor_c: float = 32.0
    outdoor_rh: float = .7
    solar_roof_wm2: float = 800.0  # incident solar per ACTUAL roof area
    ventilation_m3s_per_floor_m2: float = .015
    background_sensible_w: float = 10000.0
    bare_resistance_m2kw: float = .02
    insulation_conductivity_wmk: float = .035
    h_out_conv: float = 10.0
    h_out_rad: float = 5.0
    h_in_conv: float = 3.0
    h_in_rad: float = 5.0
    cow_surface_c: float = 35.0
    cow_area_m2: float = 4.5
    cow_wetted_area_m2: float = 2.0
    cow_emissivity: float = .95
    cow_roof_view_factor: float = .35
    base_wetness: float = .06
    cow_water_capacity_kg: float = .30
    roof_water_capacity_kgm2: float = .05
    roof_spray_lpm_m2: float = .05
    roof_on_s: int = 120
    roof_off_s: int = 480
    soaker_lpm: float = 1.3
    soaker_captured_fraction: float = .25  # one-location demonstration only
    soaker_on_s: int = 120
    soaker_off_s: int = 600
    mist_cell_m2: float = 4.0
    mist_allocated_lpm: float = .01  # supply already allocated to this cell
    mist_on_s: int = 60
    mist_off_s: int = 240
    mist_efficiency: float = .6

    @property
    def floor_area(self) -> float: return self.length_m*self.width_m
    @property
    def roof_area(self) -> float:
        return 2*self.length_m*math.hypot(self.width_m/2, self.ridge_m-self.eave_m)
    @property
    def ventilation(self) -> float:
        return self.floor_area*self.ventilation_m3s_per_floor_m2

    def validate(self) -> None:
        if not all(math.isfinite(v) for v in asdict(self).values()):
            raise ValueError('All parameters must be finite')
        if not (20 <= self.outdoor_c <= 40 and .1 <= self.outdoor_rh <= 1
                and 0 <= self.solar_roof_wm2 <= 1200):
            raise ValueError('Outside the chosen summer input range')
        positives = (self.length_m, self.width_m, self.eave_m, self.ventilation,
                     self.bare_resistance_m2kw, self.insulation_conductivity_wmk,
                     self.h_out_conv, self.h_out_rad, self.h_in_conv, self.h_in_rad,
                     self.cow_area_m2, self.cow_water_capacity_kg,
                     self.roof_water_capacity_kgm2, self.mist_cell_m2)
        if min(positives) <= 0 or self.ridge_m < self.eave_m:
            raise ValueError('Invalid geometry or transfer parameters')
        if not 0 <= self.cow_wetted_area_m2 <= self.cow_area_m2:
            raise ValueError('Invalid wetted area')
        for v in (self.cow_emissivity, self.cow_roof_view_factor, self.base_wetness,
                  self.soaker_captured_fraction, self.mist_efficiency):
            if not 0 <= v <= 1: raise ValueError('Invalid dimensionless parameter')
        for on, off in ((self.roof_on_s,self.roof_off_s),
                        (self.soaker_on_s,self.soaker_off_s),
                        (self.mist_on_s,self.mist_off_s)):
            if on < 0 or off < 0 or on+off == 0: raise ValueError('Invalid schedule')
        if min(self.background_sensible_w, self.roof_spray_lpm_m2,
               self.soaker_lpm, self.mist_allocated_lpm) < 0:
            raise ValueError('Negative source')


@dataclass(frozen=True)
class Scenario:
    name: str
    reflectance: float = .2
    insulation_m: float = 0.0
    roof_spray: bool = False
    soaker: bool = False
    mist: bool = False
    cow_speed_mps: float = 2.0  # all comparisons use the SAME existing airflow


def is_on(t: float, on: int, off: int) -> bool:
    return t % (on+off) < on


def roof_state(m: Model, s: Scenario, available_kgm2: float, dt: float
               ) -> tuple[float, float, float, float, float]:
    """Outer roof, underside, barn air, evaporation [kg/m2/s], residual.
    Radiation sink other than the roof is fixed at outdoor temperature.
    The roof and air have zero heat capacity in this reduced model.
    """
    r = m.bare_resistance_m2kw+s.insulation_m/m.insulation_conductivity_wmk
    ca = RHO*CP*m.ventilation
    ah = m.roof_area*m.h_in_conv
    beta = ah/(ca+ah)
    b = m.background_sensible_w/(ca+ah)
    c = m.h_in_conv*(1-beta)+m.h_in_rad
    wet = available_kgm2/m.roof_water_capacity_kgm2
    pv = m.outdoor_rh*pws(m.outdoor_c)
    km = m.h_out_conv/(RHO*CP)

    def at(tout: float) -> tuple[float, float, float, float, float]:
        underside = m.outdoor_c+(tout-m.outdoor_c+r*m.h_in_conv*b)/(1+r*c)
        tair = m.outdoor_c+b+beta*(underside-m.outdoor_c)
        conduction = (tout-underside)/r
        drho = (pws(tout)-pv)/(RV*((tout+m.outdoor_c)/2+273.15))
        evap = min(km*wet*max(drho, 0.0), available_kgm2/dt)
        residual = ((1-s.reflectance)*m.solar_roof_wm2
                    -(m.h_out_conv+m.h_out_rad)*(tout-m.outdoor_c)
                    -conduction-LV*evap)
        return tout, underside, tair, evap, residual
    tout = bisect(lambda t: at(t)[-1], 0.0, 130.0)
    return at(tout)


def simulate(m: Model, s: Scenario, duration_s: int = 3600, dt: float = 1.0) -> dict:
    m.validate()
    if not 0 <= s.reflectance <= 1 or s.insulation_m < 0 or not 0 <= s.cow_speed_mps <= 8:
        raise ValueError('Invalid scenario')
    if not math.isfinite(dt) or dt <= 0 or duration_s <= 0:
        raise ValueError('Invalid duration or time step')
    if not all(math.isfinite(v) for v in (s.reflectance,s.insulation_m,s.cow_speed_mps)):
        raise ValueError('Nonfinite scenario parameter')
    n = round(duration_s/dt)
    if n <= 0 or abs(n*dt-duration_s) > 1e-8:
        raise ValueError('Time step must divide duration')
    mr = mc = 0.0
    keys = ['roof_out_c','roof_under_c','barn_air_c','local_air_c','local_rh_pct',
            'mean_radiant_c','q_conv_w','q_rad_w','q_evap_base_w','q_soaker_w',
            'q_condensation_w','q_net_cooling_w','fan_formula_feels_like_c']
    sums = dict.fromkeys(keys, 0.0)
    roof_sup = roof_evap = roof_run = 0.0
    cow_captured = cow_evap = cow_run = cow_cond_onpatch = 0.0
    nozzle_sup = mist_sup = mist_evap = 0.0
    max_residual = 0.0
    hc = 3.5+4*math.sqrt(s.cow_speed_mps)
    km = hc/(RHO*CP)
    pv_out = m.outdoor_rh*pws(m.outdoor_c)
    # Dry roof is steady across this one-weather demonstration.
    dry_state = roof_state(m, s, 0.0, dt)
    for i in range(n):
        t = i*dt
        supply_r = (m.roof_spray_lpm_m2/60 if s.roof_spray and
                    is_on(t,m.roof_on_s,m.roof_off_s) else 0.0)
        received_r = mr+supply_r*dt
        runoff_r = max(received_r-m.roof_water_capacity_kgm2,0)
        available_r = min(received_r,m.roof_water_capacity_kgm2)
        ro, ri, ta, er, resid = (roof_state(m,s,available_r,dt)
                               if available_r > 0 else dry_state)
        mr = max(available_r-er*dt,0)
        roof_sup += supply_r*dt
        roof_evap += er*dt
        roof_run += runoff_r
        max_residual = max(max_residual,abs(resid))
        mist_rate = (m.mist_allocated_lpm/60 if s.mist and
                     is_on(t,m.mist_on_s,m.mist_off_s) else 0.0)
        tl, pv, em = mist(ta,pv_out,m.mist_cell_m2*m.ventilation_m3s_per_floor_m2,
                          mist_rate,m.mist_efficiency)
        mist_sup += mist_rate*dt
        mist_evap += em*dt
        rh = pv/pws(tl)
        drho = (pws(m.cow_surface_c)-pv)/(RV*((m.cow_surface_c+tl)/2+273.15))
        eb = km*m.cow_area_m2*m.base_wetness*max(drho,0)
        cond = km*m.cow_area_m2*max(-drho,0)
        cond_patch = cond*m.cow_wetted_area_m2/m.cow_area_m2
        spray = m.soaker_lpm/60 if s.soaker and is_on(t,m.soaker_on_s,m.soaker_off_s) else 0.0
        captured = spray*m.soaker_captured_fraction
        received = mc+(captured+cond_patch)*dt
        runoff = max(received-m.cow_water_capacity_kg,0)
        available = min(received,m.cow_water_capacity_kg)
        es = min(km*m.cow_wetted_area_m2*(1-m.base_wetness)
                 *(available/m.cow_water_capacity_kg)*max(drho,0),available/dt)
        mc = max(available-es*dt,0)
        cow_captured += captured*dt
        cow_evap += es*dt
        cow_cond_onpatch += cond_patch*dt
        cow_run += runoff
        nozzle_sup += spray*dt
        f = m.cow_roof_view_factor
        tr4 = f*(ri+273.15)**4+(1-f)*(m.outdoor_c+273.15)**4
        qr = m.cow_emissivity*SIGMA*m.cow_area_m2*((m.cow_surface_c+273.15)**4-tr4)
        qc = m.cow_area_m2*hc*(m.cow_surface_c-tl)
        net = qc+qr+LV*(eb+es-cond)
        vals = [ro,ri,ta,tl,rh*100,tr4**.25-273.15,qc,qr,LV*eb,LV*es,
                -LV*cond,net,tl-6*math.sqrt(s.cow_speed_mps)]
        for k,v in zip(keys,vals): sums[k] += v
    result = {k:v/n for k,v in sums.items()}
    result.update(model_version=VERSION,scenario=s.name,averaging_s=duration_s,
                  roof_water_supply_l=roof_sup*m.roof_area,
                  roof_water_evaporated_kg=roof_evap*m.roof_area,
                  roof_water_runoff_l=roof_run*m.roof_area,
                  roof_water_final_kg=mr*m.roof_area,
                  roof_water_balance_error_kg=(roof_sup-roof_evap-roof_run-mr)*m.roof_area,
                  soaker_nozzle_supply_l=nozzle_sup,
                  cow_water_captured_kg=cow_captured,cow_water_evaporated_kg=cow_evap,
                  cow_water_runoff_kg=cow_run,cow_water_final_kg=mc,
                  cow_water_balance_error_kg=cow_captured+cow_cond_onpatch-cow_evap-cow_run-mc,
                  mist_cell_water_supply_l=mist_sup,mist_cell_evaporated_kg=mist_evap,
                  roof_energy_residual_max_wm2=max_residual)
    if not all(math.isfinite(v) for v in result.values() if isinstance(v,(int,float))):
        raise ArithmeticError('Nonfinite result')
    return result


def main() -> None:
    m = Model()
    cases = [Scenario('送風あり・屋根対策なし'),
             Scenario('遮熱塗装',reflectance=.7),
             Scenario('断熱材20mm',insulation_m=.02),
             Scenario('屋根散水',roof_spray=True),
             Scenario('牛体散水',soaker=True),
             Scenario('遮熱塗装＋断熱',reflectance=.7,insulation_m=.02),
             Scenario('遮熱塗装＋断熱＋牛体散水',reflectance=.7,insulation_m=.02,soaker=True),
             Scenario('ミスト',mist=True)]
    results = [simulate(m,s) for s in cases]
    for r in results:
        r['heat_load_reduction_w'] = r['q_net_cooling_w']-results[0]['q_net_cooling_w']
    folder = Path(__file__).resolve().parent
    (folder/'parameters.json').write_text(json.dumps({'model_version':VERSION,
       'note':'Initial simulation assumptions; not field measurements.',
       'model':asdict(m),'scenarios':[asdict(s) for s in cases]},ensure_ascii=False,indent=2),encoding='utf-8')
    (folder/'example_results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
    with (folder/'example_results.csv').open('w',encoding='utf-8-sig',newline='') as f:
        w=csv.DictWriter(f,fieldnames=results[0].keys()); w.writeheader();w.writerows(results)
    for r in results:
        print(f"{r['scenario']}: underside={r['roof_under_c']:.2f}, air={r['local_air_c']:.2f}, "
              f"MRT={r['mean_radiant_c']:.2f}, cooling_delta={r['heat_load_reduction_w']:.1f} W")

if __name__ == '__main__': main()
