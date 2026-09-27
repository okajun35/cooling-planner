"""Independent SI reference fixture: Python + SciPy root, not production JS.
Inputs for the spec's missing arithmetic_examples_v0_4.json were not supplied.
This defines an explicit additional mist fixture instead of inventing its input.
"""
from math import exp, log, sqrt
from scipy.optimize import brentq
import json
from pathlib import Path

def pws(celsius):
    t = celsius + 273.15
    if celsius > .01:
        return exp(-5800.2206/t + 1.3914993 - .048640239*t + .000041764768*t*t - .000000014452093*t**3 + 6.5459673*log(t))
    return exp(-5674.5359/t + 6.3925247 - .009677843*t + .00000062215701*t*t + 2.0747825e-9*t**3 - 9.484024e-13*t**4 + 4.1635019*log(t))

def w(t, rh, p):
    pv = rh * pws(t)
    return .621945 * pv / (p-pv)

def h(t, ratio):
    return 1006*t + ratio*(2501000+1860*t)

t, rh, p, volume, water, eta = 32., .7, 101325., .06, .00006, .6
wi = w(t, rh, p)
hi = h(t,wi)
tsat = brentq(lambda T:h(T,w(T,1,p))-hi,-50,t,xtol=1e-12)
air = volume / (287.042*(t+273.15)*(1+1.607858*wi)/p)
wo = wi + min(eta*water/air,w(tsat,1,p)-wi)
tout = (hi-2501000*wo)/(1006+1860*wo)
rhout = p*wo/(.621945+wo)/pws(tout)*100
fixture = {'source':'Independent Python implementation, ASHRAE SI relations, scipy.optimize.brentq for saturation endpoint',
 'inputs':{'temperatureC':t,'rhPct':rh*100,'pressurePa':p,'ventilationM3s':volume,'waterKgs':water,'efficiency':eta},
 'expected':{'temperatureC':tout,'rhPct':rhout,'enthalpyJkg':hi,'evaporatedKgs':air*(wo-wi)},
 'note':'This is not the missing original arithmetic_examples_v0_4.json mistCell fixture.'}
Path('tests/fixtures/independent-mist.json').write_text(json.dumps(fixture,indent=2)+'\n')
print(json.dumps(fixture,indent=2))
