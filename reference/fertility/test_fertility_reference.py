import unittest
import math
from fertility_reference import (PERIODS, PROFILE, thi, category, reference_from_categories,
                                 reference_from_period_means, constant_climate_reference)

class FertilityReferenceTests(unittest.TestCase):
    def test_thi_formula(self):
        self.assertAlmostEqual(thi(26,70),75.368)
    def test_thi_boundaries(self):
        for value, want in ((59.999,'none'),(60,'small'),(67.999,'small'),(68,'medium'),(71.999,'medium'),(72,'severe')):
            with self.subTest(value=value): self.assertEqual(category(value),want)
    def test_no_interpolation_within_category(self):
        self.assertEqual(category(72),category(84))
    def test_baseline(self):
        self.assertAlmostEqual(reference_from_categories(dict.fromkeys(PERIODS,'none'))['reference_probability'],.4)
    def test_severe_all(self):
        r=reference_from_categories(dict.fromkeys(PERIODS,'severe'))
        self.assertAlmostEqual(r['relative_odds'],.4239040657836599)
        self.assertAlmostEqual(r['reference_probability'],.22033534484527012)
    def test_medium_all(self):
        self.assertAlmostEqual(reference_from_categories(dict.fromkeys(PERIODS,'medium'))['reference_probability'],.24873216323314762)
    def test_small_all(self):
        self.assertAlmostEqual(reference_from_categories(dict.fromkeys(PERIODS,'small'))['reference_probability'],.3298312837763398)
    def test_odds_not_risk_multiplier(self):
        cats=dict.fromkeys(PERIODS,'none'); cats['P3']='severe'
        p=reference_from_categories(cats)['reference_probability']
        self.assertAlmostEqual(p,.4*.693/(.6+.4*.693))
        self.assertNotAlmostEqual(p,.4*.693)
    def test_missing_period(self):
        r=reference_from_categories({'P1':'none'})
        self.assertEqual(r['status'],'out_of_scope'); self.assertIsNone(r['reference_probability'])
    def test_unknown_category(self):
        cats=dict.fromkeys(PERIODS,'none'); cats['P3']='very_hot'
        self.assertEqual(reference_from_categories(cats)['status'],'out_of_scope')
    def test_invalid_baseline(self):
        for x in (0,1,-.1,math.nan,math.inf,True,'0.4'):
            self.assertEqual(reference_from_categories(dict.fromkeys(PERIODS,'none'),x)['status'],'invalid_input')
    def test_unsupported_population(self):
        self.assertEqual(reference_from_categories(dict.fromkeys(PERIODS,'none'),population='embryo_transfer')['status'],'out_of_scope')
    def test_period_means(self):
        self.assertAlmostEqual(reference_from_period_means(dict.fromkeys(PERIODS,70))['reference_probability'],.24873216323314762)
    def test_invalid_period_means(self):
        means=dict.fromkeys(PERIODS,70); means['P1']=float('nan')
        self.assertEqual(reference_from_period_means(means)['status'],'invalid_input')
    def test_no_implicit_exposure_extension(self):
        self.assertEqual(constant_climate_reference(26,70)['status'],'out_of_scope')
    def test_constant_scenario(self):
        self.assertAlmostEqual(constant_climate_reference(26,70,exposure_assumed=True)['reference_probability'],.22033534484527012)
    def test_rh_invalid(self):
        self.assertEqual(constant_climate_reference(26,101,exposure_assumed=True)['status'],'invalid_input')
    def test_periods_cover_52_days_without_overlap(self):
        days=[d for p in PROFILE['periods'].values() for d in range(p['start_day'],p['end_day']+1)]
        self.assertEqual(days,list(range(-21,31)))
    def test_coefficients_not_smoothed(self):
        p=PROFILE['periods']
        self.assertLess(p['P1']['odds_ratios']['medium'],p['P1']['odds_ratios']['severe'])
        self.assertGreater(p['P5']['odds_ratios']['small'],1)
    def test_deterministic(self):
        cats=dict.fromkeys(PERIODS,'severe')
        self.assertEqual(reference_from_categories(cats),reference_from_categories(cats))

if __name__ == '__main__': unittest.main(verbosity=2)
