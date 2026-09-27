"""Literature-category fertility reference, NOT a validated farm forecast.

Python >=3.10, standard library only. Source: Baccouri et al. (2025),
DOI 10.3390/ani15132001, Methods 2.4 and Table 2.
The caller-supplied p0 is a synthetic baseline, not the source intercept.
"""
from __future__ import annotations
import json
import math
from pathlib import Path
from collections.abc import Mapping

PROFILE = json.loads(Path(__file__).with_name('reference_profile.json').read_text(encoding='utf-8'))
PERIODS = tuple(PROFILE['periods'])


def _finite(value: object, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f'{name}: finite numeric value required')
    return float(value)


def thi(temperature_c: float, relative_humidity_pct: float) -> float:
    """Paper-specific THI. Not the current application's other THI formula."""
    t = _finite(temperature_c, 'temperature_c')
    rh = _finite(relative_humidity_pct, 'relative_humidity_pct')
    if t <= -273.15 or not 0 <= rh <= 100:
        raise ValueError('temperature must exceed absolute zero; RH must be 0..100%')
    result = (1.8*t + 32) - (.55 - .55*rh/100)*(1.8*t - 26)
    return _finite(result, 'computed_thi')


def category(period_mean_thi: float) -> str:
    """Published bins, not interpolation and not additional validated ranges."""
    x = _finite(period_mean_thi, 'period_mean_thi')
    if x < 60:
        return 'none'
    if x < 68:
        return 'small'
    if x < 72:
        return 'medium'
    return 'severe'


def _empty(status: str, reason: str) -> dict:
    return {'model_id': PROFILE['model_id'], 'status': status,
            'reference_probability': None, 'relative_odds': None, 'reason': reason}


def reference_from_categories(
    categories: Mapping[str, str], baseline_probability: float = .4,
    population: str = 'holstein_ai',
) -> dict:
    """Conditional fixed-effect reference. Does not predict each cow's result.

    Missing or unrecognized categories are not filled using nearby values.
    Inapplicable population returns out_of_scope; malformed p0 is invalid_input.
    """
    try:
        p0 = _finite(baseline_probability, 'baseline_probability')
        if not 0 < p0 < 1:
            raise ValueError('baseline_probability must be strictly between 0 and 1')
    except ValueError as exc:
        return _empty('invalid_input', str(exc))
    if population != 'holstein_ai':
        return _empty('out_of_scope', 'Only the Holstein artificial-insemination reference is supported')
    if not isinstance(categories, Mapping):
        return _empty('invalid_input', 'categories must be a mapping')
    if set(categories) != set(PERIODS):
        return _empty('out_of_scope', 'Exactly P1..P5 categories are required; no missing-period imputation')
    if any(not isinstance(c, str) or c not in PROFILE['categories'] for c in categories.values()):
        return _empty('out_of_scope', 'Unknown category; no interpolation or nearest match')
    factors = {p: PROFILE['periods'][p]['odds_ratios'][categories[p]] for p in PERIODS}
    r = math.prod(factors.values())
    probability = p0*r/(1-p0+p0*r)
    return {'model_id': PROFILE['model_id'], 'status': 'available_reference',
            'reference_probability': probability, 'relative_odds': r,
            'baseline_probability': p0, 'categories': dict(categories),
            'period_odds_ratios': factors,
            'interpretation': 'Synthetic baseline plus published categorical associations; not a causal cooling forecast'}


def reference_from_period_means(means: Mapping[str, float], baseline_probability: float = .4) -> dict:
    if not isinstance(means, Mapping):
        return _empty('invalid_input', 'period means must be a mapping')
    if set(means) != set(PERIODS):
        return _empty('out_of_scope', 'All five period mean THI values are required')
    try:
        cats = {p: category(means[p]) for p in PERIODS}
    except ValueError as exc:
        return _empty('invalid_input', str(exc))
    result = reference_from_categories(cats, baseline_probability)
    result['period_mean_thi'] = dict(means)
    return result


def constant_climate_reference(
    temperature_c: float, relative_humidity_pct: float,
    baseline_probability: float = .4, *, exposure_assumed: bool = False,
) -> dict:
    """Explicit hypothetical climate throughout -21..+30 days (52 days).

    NOT an automatic extension of a 60-minute trial. Results are categorical
    references: e.g. THI 72 and THI 84 both map to the same severe category,
    not a separately validated probability at each temperature.
    """
    if exposure_assumed is not True:
        return _empty('out_of_scope', 'A one-hour climate observation does not define the five exposure periods')
    try:
        value = thi(temperature_c, relative_humidity_pct)
    except ValueError as exc:
        return _empty('invalid_input', str(exc))
    result = reference_from_period_means({p: value for p in PERIODS}, baseline_probability)
    result['scenario_assumption'] = 'same representative temperature and RH on every day -21..+30; not a forecast'
    result['temperature_c'] = temperature_c
    result['relative_humidity_pct'] = relative_humidity_pct
    return result


if __name__ == '__main__':
    examples = [constant_climate_reference(t,70,exposure_assumed=True) for t in (15,20,22,26)]
    target = Path(__file__).with_name('calculation_examples.json')
    target.write_text(json.dumps(examples,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    for ex in examples:
        print(f"{ex['temperature_c']}C / RH70%: THI={ex['period_mean_thi']['P1']:.3f}, "
              f"category={ex['categories']['P1']}, R={ex['relative_odds']:.6f}, "
              f"reference={ex['reference_probability']*100:.3f}%")
