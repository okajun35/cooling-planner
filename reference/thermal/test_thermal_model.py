"""Tests of implementation and stated assumptions, not farm validation."""
import math
import unittest
from dataclasses import replace
from thermal_model import Model,Scenario,simulate,roof_state,mist,pws,humidity_ratio,enthalpy,RHO,CP,LV

class Tests(unittest.TestCase):
    def setUp(self): self.m=Model(); self.s=Scenario('reference')
    def test_01_geometry(self):
        self.assertAlmostEqual(self.m.floor_area,855.4)
        self.assertGreater(self.m.roof_area,self.m.floor_area)
    def test_02_raising_reflectance_reduces_roof_and_air(self):
        a=roof_state(self.m,self.s,0,1); b=roof_state(self.m,replace(self.s,reflectance=.7),0,1)
        self.assertLess(b[1],a[1]); self.assertLess(b[2],a[2])
    def test_03_insulation_reduces_underside_but_not_external_roof(self):
        a=roof_state(self.m,self.s,0,1); b=roof_state(self.m,replace(self.s,insulation_m=.02),0,1)
        self.assertLess(b[1],a[1]); self.assertGreater(b[0],a[0])
    def test_04_paint_has_no_solar_effect_at_night(self):
        m=replace(self.m,solar_roof_wm2=0)
        self.assertEqual(roof_state(m,self.s,0,1),roof_state(m,replace(self.s,reflectance=.7),0,1))
    def test_05_uniform_equilibrium(self):
        m=replace(self.m,solar_roof_wm2=0,background_sensible_w=0)
        self.assertTrue(all(abs(x-m.outdoor_c)<1e-7 for x in roof_state(m,self.s,0,1)[:3]))
    def test_06_roof_balances(self):
        ro,ri,ta,e,res=roof_state(self.m,self.s,.03,1)
        q=(ro-ri)/self.m.bare_resistance_m2kw
        self.assertLess(abs(res),1e-6)
        self.assertAlmostEqual(q,self.m.h_in_conv*(ri-ta)+self.m.h_in_rad*(ri-self.m.outdoor_c),places=6)
        self.assertAlmostEqual(RHO*CP*self.m.ventilation*(ta-self.m.outdoor_c),
            self.m.roof_area*self.m.h_in_conv*(ri-ta)+self.m.background_sensible_w,places=5)
    def test_07_roof_spray_mass_conservation(self):
        r=simulate(self.m,replace(self.s,roof_spray=True),600)
        self.assertLess(abs(r['roof_water_balance_error_kg']),1e-8)
        self.assertLessEqual(r['roof_water_evaporated_kg'],r['roof_water_supply_l'])
    def test_08_soaker_mass_conservation(self):
        r=simulate(self.m,replace(self.s,soaker=True),720)
        self.assertLess(abs(r['cow_water_balance_error_kg']),1e-10)
        self.assertLessEqual(r['cow_water_evaporated_kg'],r['cow_water_captured_kg']+1e-9)
    def test_09_soaker_does_not_directly_change_air(self):
        a=simulate(self.m,self.s,120);b=simulate(self.m,replace(self.s,soaker=True),120)
        self.assertEqual(a['local_air_c'],b['local_air_c'])
        self.assertGreater(b['q_net_cooling_w'],a['q_net_cooling_w'])
    def test_10_soaker_drying_continues_when_supply_off(self):
        m=replace(self.m,soaker_on_s=60,soaker_off_s=10000)
        a=simulate(m,replace(self.s,soaker=True),60);b=simulate(m,replace(self.s,soaker=True),300)
        self.assertEqual(a['soaker_nozzle_supply_l'],b['soaker_nozzle_supply_l'])
        self.assertGreater(b['cow_water_evaporated_kg'],a['cow_water_evaporated_kg'])
    def test_11_mist_saturation(self):
        self.assertEqual(mist(32,pws(32),.06,.0001),(32,pws(32),0.0))
    def test_12_mist_energy_and_supply_limits(self):
        pv=.7*pws(32);t,p,e=mist(32,pv,.06,.0001)
        self.assertLess(t,32);self.assertLessEqual(p/pws(t),1+1e-8)
        self.assertLessEqual(e,.6*.0001+1e-12)
        self.assertAlmostEqual(enthalpy(32,humidity_ratio(pv)),enthalpy(t,humidity_ratio(p)),places=6)
    def test_13_components_no_duplicate_latent_cooling(self):
        r=simulate(self.m,replace(self.s,soaker=True,mist=True),120)
        self.assertAlmostEqual(r['q_net_cooling_w'],sum(r[k] for k in
           ['q_conv_w','q_rad_w','q_evap_base_w','q_soaker_w','q_condensation_w']),places=7)
    def test_14_identical_scenarios(self):
        self.assertEqual(simulate(self.m,self.s,60),simulate(self.m,self.s,60))
    def test_15_hot_air_convection_is_negative(self):
        r=simulate(self.m,self.s,60)
        self.assertGreater(r['local_air_c'],self.m.cow_surface_c)
        self.assertLess(r['q_conv_w'],0)
    def test_16_timestep_refinement(self):
        s=replace(self.s,roof_spray=True,soaker=True)
        a=simulate(self.m,s,720,1);b=simulate(self.m,s,720,.5)
        self.assertLess(abs(a['q_net_cooling_w']-b['q_net_cooling_w']),5)
    def test_17_invalid_inputs(self):
        for dt in (0,-1,float('nan')):
            with self.assertRaises(ValueError):simulate(self.m,self.s,60,dt)
        with self.assertRaises(ValueError):simulate(replace(self.m,outdoor_rh=1.1),self.s,60)
        with self.assertRaises(ValueError):simulate(self.m,replace(self.s,reflectance=1.1),60)
        with self.assertRaises(ValueError):simulate(self.m,replace(self.s,insulation_m=float('nan')),60)

if __name__=='__main__':unittest.main(verbosity=2)
