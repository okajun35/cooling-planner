"""Actual Chromium UI interactions with the self-contained HTML.
By default tests load the portable HTML into about:blank. Set COOLING_PLANNER_URL
to exercise an HTTP deployment instead. Both exercise WebGL, Workers and editing.
They do not verify a mobile device GPU or scientific accuracy.
"""
from pathlib import Path
import json, os
import pytest
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[2]
HTML=(ROOT/'cooling-planner-v0.8.html').read_text()
OUT=ROOT/'evidence/browser';OUT.mkdir(parents=True,exist_ok=True)
(OUT/'test-runs').mkdir(exist_ok=True)

@pytest.fixture(scope='session')
def browser():
    with sync_playwright() as p:
        b=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH'),headless=os.environ.get('HEADLESS','1')!='0',args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'])
        try:
            yield b
        finally:
            b.close()

def ready(page):
    page.wait_for_function("window.__DCS__ && window.__DCS__.result() && document.querySelector('#status').dataset.state==='ready' && window.__DCS__.hash()===window.__DCS__.result().inputHash",timeout=45000)
def snap(page):return page.evaluate('window.__DCS__.snapshot()')
def result(page):return page.evaluate('window.__DCS__.result()')
def fan(p,index=0,s=1):return p['scenarios'][s]['fans'][index]
def point(page,d):return page.evaluate('(d)=>window.__DCS__.screenPoint(d.x,d.heightM,d.y)',d)
def number(page,selector,value):
    page.locator(selector).fill(str(value));page.locator(selector).press('Tab');ready(page)
def drag(page,d,dx=30,dy=8,cancel=False):
    pos=point(page,d);assert pos['visible']
    page.mouse.move(pos['x'],pos['y']);page.mouse.down();page.mouse.move(pos['x']+dx,pos['y']+dy,steps=8)
    if cancel:page.keyboard.press('Escape')
    page.mouse.up();ready(page)
def open_refs(page):page.locator('[data-action=references]').first.click()

@pytest.fixture
def page(browser,request):
    ctx=browser.new_context(viewport={'width':1512,'height':1050},device_scale_factor=1,accept_downloads=True)
    pg=ctx.new_page();errors=[];pg.on('pageerror',lambda e:errors.append(str(e)))
    url=os.environ.get('COOLING_PLANNER_URL')
    if url: pg.goto(url,wait_until='load')
    else: pg.set_content(HTML,wait_until='load')
    ready(pg)
    yield pg
    (OUT/'test-runs'/f'{request.node.name}.json').write_text(json.dumps({'mode':url or 'inline about:blank','errors':errors,'metrics':pg.evaluate('window.__DCS__.metrics()')},ensure_ascii=False,indent=2))
    assert not errors,errors
    ctx.close()

def test_E01_initial_three_scenarios_70_points_webgl_and_no_placeholder_values(page):
    assert page.locator('canvas[data-testid=scene3d]').count()==1
    assert page.evaluate("!!document.querySelector('canvas').getContext('webgl2')")
    r=result(page);assert len(r['scenarios'])==3
    assert all(len(s['points'])==70 for s in r['scenarios'])
    assert all(p['deltaQrefW']==0 for p in r['scenarios'][1]['points'])
    assert r['scenarios'][1]['points'][0]['milk']['kgPerDay'] is None
    assert '参照表の対象外' in page.locator('#results').inner_text()
    page.screenshot(path=str(OUT/'initial-desktop.png'),full_page=True)

def test_E02_roof_coating_insulation_integrate_into_all_points_and_comparison(page):
    old=snap(page);oldhash=page.evaluate('window.__DCS__.hash()')
    page.locator('#roof-coating').check();ready(page)
    page.locator('#roof-insulation').check();ready(page)
    r=result(page);a,b=r['scenarios'][:2]
    assert abs(b['roof']['meanAirC']-32.981384324)<1e-6
    assert b['roof']['meanUnderC']<a['roof']['meanUnderC']
    assert all(q['deltaQrefW']>300 for q in b['points'])
    assert snap(page)['scenarios'][0]==old['scenarios'][0]
    assert oldhash!=page.evaluate('window.__DCS__.hash()')
    page.screenshot(path=str(OUT/'roof-comparison-desktop.png'),full_page=True)

def test_E03_actual_canvas_drag_preserves_resources_recalculates_and_one_undo(page):
    p=snap(page);before=result(page);drag(page,fan(p),43,-8)
    q=snap(page);after=result(page)
    assert fan(p)['x']!=fan(q)['x'] or fan(p)['y']!=fan(q)['y']
    assert p['scenarios'][0]==q['scenarios'][0]
    assert before['scenarios'][1]['resources']==after['scenarios'][1]['resources']
    assert before['scenarios'][1]['points']!=after['scenarios'][1]['points']
    assert page.evaluate('window.__DCS__.metrics().undoCount')==1

def test_E04_drag_escape_and_undo_exact_restoration(page):
    p=snap(page);drag(page,fan(p),30,8,cancel=True)
    assert snap(page)['scenarios']==p['scenarios']
    assert page.evaluate('window.__DCS__.metrics().undoCount')==0
    drag(page,fan(p),30,8)
    page.locator('[data-action=undo]').click();ready(page)
    assert snap(page)['scenarios']==p['scenarios']

def test_E05_device_height_rotation_and_keyboard_undo(page):
    page.locator('#device-select').select_option('fan-feeding-1');number(page,'#device-height',2)
    assert fan(snap(page))['heightM']==2
    assert any(abs(q['deltaQrefW'])>1 for q in result(page)['scenarios'][1]['points'])
    page.locator('[data-action=rotate]').click();ready(page)
    assert fan(snap(page))['yawDeg']==90
    page.locator('canvas').focus();page.keyboard.press('Control+z');ready(page)
    assert fan(snap(page))['yawDeg']==0

def test_E06_colocated_mist_is_draggable_when_active(page):
    page.locator('#scenario-tabs [data-scenario=working-mist]').click();ready(page)
    p=snap(page);n=p['scenarios'][2]['waterSystems'][1]['nozzles'][0]
    drag(page,n,35,4)
    assert snap(page)['scenarios'][2]['waterSystems'][1]['nozzles'][0]['x']!=n['x']
    assert snap(page)['scenarios'][2]['waterSystems'][0]==p['scenarios'][2]['waterSystems'][0]

def test_E07_zero_cycle_is_rejected_without_losing_state_and_recovery(page):
    page.locator('#device-select').select_option('soaker-1')
    number(page,'#system-on',0)
    page.locator('#system-off').fill('0');page.locator('#system-off').press('Tab')
    assert page.locator('#status').get_attribute('data-state')=='invalid'
    assert '両方0' in page.locator('#error-message').inner_text()
    assert snap(page)['scenarios'][1]['waterSystems'][0]['offSec']==600
    number(page,'#system-off',10)
    assert result(page)['scenarios'][1]['resources']['waterLPerDay']==0

def test_E08_baseline_read_only_shared_weather_and_reset_roof(page):
    p=snap(page);number(page,'#env-temperature',34)
    assert snap(page)['environment']['temperatureC']==34
    assert snap(page)['scenarios']==p['scenarios']
    page.locator('#roof-coating').check();ready(page)
    page.locator('[data-action=reset-active]').click();ready(page)
    assert snap(page)['scenarios'][1]['roof']['reflectance']==.2
    page.locator('#scenario-tabs [data-scenario=baseline]').click()
    assert page.locator('#roof-coating').is_disabled()
    assert page.locator('#reset-active').is_disabled()

def test_E09_actual_download_and_upload_of_roof_references_and_time(page,tmp_path):
    page.locator('#roof-coating').check();ready(page)
    open_refs(page);page.locator('#fertility-linked').check();ready(page);page.locator('[data-close=reference-dialog]').click()
    page.locator('#time-slider').fill('900');page.locator('#time-slider').dispatch_event('input')
    p=snap(page)
    with page.expect_download() as ev:page.locator('[data-action=save]').click()
    path=tmp_path/'saved.json';ev.value.save_as(path)
    assert json.loads(path.read_text())==p
    page.locator('[data-action=reset-active]').click();ready(page)
    page.locator('#file-input').set_input_files(path);ready(page)
    assert snap(page)==p
    assert result(page)['inputHash']==page.evaluate('window.__DCS__.hash()')

def test_E10_bad_import_legacy_schema_xss_and_atomic_state(page):
    p=snap(page)
    page.locator('#file-input').set_input_files({'name':'old.json','mimeType':'application/json','buffer':b'{"schemaVersion":4}'})
    page.wait_for_function("document.querySelector('#error-message').textContent.includes('未対応')")
    assert snap(page)==p
    p['scenarios'][1]['fans'][0]['label']='<img src=x onerror="window.__XSS=1">'
    p['view']['selectedDeviceId']='fan-feeding-1'
    page.locator('#file-input').set_input_files({'name':'test.json','mimeType':'application/json','buffer':json.dumps(p).encode()});ready(page)
    assert page.evaluate('window.__XSS') is None
    assert page.locator('#device-properties img').count()==0
    assert '<img src=x' in page.locator('#device-properties').inner_text()

def test_E11_mobile_390_no_horizontal_overflow_and_controls_work(page):
    page.set_viewport_size({'width':390,'height':844});page.locator('[data-mode="2d"]').click();ready(page)
    assert page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth')
    page.locator('#roof-coating').check();ready(page)
    page.locator('#device-select').select_option('fan-feeding-1');number(page,'#device-height',2)
    assert fan(snap(page))['heightM']==2
    assert page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth')
    page.screenshot(path=str(OUT/'mobile-390.png'),full_page=True)

def test_E12_reference_values_and_explicit_fertility_connection(page):
    p=snap(page);assert p['references']['fertility']['mode']=='manual'
    open_refs(page)
    assert page.locator('#reference-body tbody tr').count()==6
    assert '33.25' in page.locator('#reference-body').inner_text()
    page.locator('#fertility-linked').check();ready(page)
    q=snap(page);assert q['references']['fertility']['mode']=='simulation'
    assert q['references']['fertility']['exposureAssumed'] is True
    assert page.locator('#fertility-t').is_disabled()
    number(page,'#fertility-baseline',30)
    assert snap(page)['references']['fertility']['p0']==.3
    page.locator('[data-close=reference-dialog]').click()
    assert '地点の温湿度を適用' in page.locator('#results').inner_text()

def test_E13_playback_changes_only_view_and_graph_not_physics(page):
    h=page.evaluate('window.__DCS__.hash()');before=result(page);count=page.evaluate('window.__DCS__.metrics().undoCount')
    page.locator('#time-slider').fill('900');page.locator('#time-slider').dispatch_event('input')
    assert snap(page)['view']['timeSec']==900
    assert page.locator('#time-display').inner_text()=='15:00'
    page.locator('[data-chart=filmKg]').click()
    page.locator('#play-button').click();page.wait_for_timeout(650);page.locator('#play-button').click()
    assert snap(page)['view']['timeSec']>900
    assert page.evaluate('window.__DCS__.hash()')==h
    assert result(page)==before
    assert page.evaluate('window.__DCS__.metrics().undoCount')==count

def test_E14_camera_and_metric_do_not_recalculate_physics(page):
    h=page.evaluate('window.__DCS__.hash()');r=result(page)
    rect=page.locator('canvas').bounding_box();x,y=rect['x']+15,rect['y']+90
    page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+40,y+30,steps=5);page.mouse.up();page.mouse.wheel(0,150)
    page.locator('[data-metric=temperature]').click();page.locator('#show-roof').check();page.locator('#show-particles').uncheck()
    assert page.evaluate('window.__DCS__.hash()')==h
    assert result(page)==r
    assert snap(page)['view']['camera'] is not None

def test_E15_full_scenario_copy_keeps_roof_and_devices(page):
    page.locator('#roof-coating').check();ready(page)
    page.locator('#device-select').select_option('fan-feeding-1');number(page,'#device-height',2)
    p=snap(page);page.locator('#copy-scenario').click();ready(page);q=snap(page)
    assert q['activeScenarioId']=='working-mist'
    assert q['scenarios'][2]['fans']==p['scenarios'][1]['fans']
    assert q['scenarios'][2]['roof']==p['scenarios'][1]['roof']
    assert q['scenarios'][0]==p['scenarios'][0]
    assert result(page)['scenarios'][1]['roof']==result(page)['scenarios'][2]['roof']

def test_E16_add_delete_duplicate_keep_unique_ids_and_undo(page):
    page.locator('[data-action=add-fan]').click();ready(page)
    p=snap(page);assert len(p['scenarios'][1]['fans'])==11
    assert p['view']['selectedDeviceId'] is not None
    page.locator('[data-action=duplicate]').click();ready(page)
    ids=[f['id'] for f in snap(page)['scenarios'][1]['fans']];assert len(ids)==12 and len(set(ids))==12
    page.locator('[data-action=remove]').click();ready(page)
    assert len(snap(page)['scenarios'][1]['fans'])==11
    page.locator('[data-action=undo]').click();ready(page)
    assert len(snap(page)['scenarios'][1]['fans'])==12

def test_E17_common_dimensions_and_old_new_result_gate(page):
    page.locator('[data-action=settings]').click()
    number(page,'#barn-length',40);assert snap(page)['template']['lengthM']==40
    page.locator('[data-close=settings-dialog]').click()
    page.locator('#roof-coating').check();page.locator('#roof-insulation').check();ready(page)
    assert result(page)['inputHash']==page.evaluate('window.__DCS__.hash()')
    assert snap(page)['scenarios'][1]['roof']['reflectance']==.7
    assert snap(page)['scenarios'][1]['roof']['insulationM']==.02

def test_E18_roof_spray_changes_environment_and_has_actual_water_balance(page):
    page.locator('#roof-spray').check();ready(page)
    r=result(page);a,b=r['scenarios'][:2]
    assert b['roof']['meanUnderC']<a['roof']['meanUnderC']
    assert b['roof']['suppliedL']>0 and abs(b['roof']['waterResidualKg'])<1e-6
    assert b['resources']['waterLPerDay']>a['resources']['waterLPerDay']
    assert b['trialWaterL']<b['resources']['waterLPerDay']

def test_E19_result_export_is_current_and_includes_provenance_and_series(page,tmp_path):
    page.locator('#roof-insulation').check();ready(page)
    with page.expect_download() as ev:page.locator('[data-action=export-results]').click()
    path=tmp_path/'results.json';ev.value.save_as(path);data=json.loads(path.read_text())
    assert data['result']['inputHash']==page.evaluate('window.__DCS__.hash()')
    assert data['project']['schemaVersion']==8
    assert data['project']['provenance']
    assert len(data['result']['scenarios'][1]['points'][0]['series'])==61

def test_E20_evidence_lists_versions_assumptions_and_non_confidence_envelope(page):
    page.locator('[data-action=evidence]').click()
    text=page.locator('#evidence-body').inner_text()
    assert '95%信頼区間ではありません' in text
    assert 'design-assumption' in text
    assert 'cooling-integrated-v0.8' in text
    assert '熱v0.5、乳量v0.6、受胎v0.7' in text

def test_E21_webgl_unavailable_fallback_still_drags_calculates_and_saves(browser):
    ctx=browser.new_context(viewport={'width':1280,'height':900},accept_downloads=True);pg=ctx.new_page()
    pg.evaluate("""() => {const orig=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type.startsWith('webgl')?null:orig.call(this,type,...args)}}""")
    pg.set_content(HTML,wait_until='load');ready(pg)
    assert pg.locator('svg[data-testid=scene2d]').count()==1
    pg.locator('#device-select').select_option('fan-feeding-1');number(pg,'#device-height',2)
    before=snap(pg);rect=pg.locator('[data-device=fan-feeding-1]').bounding_box()
    pg.mouse.move(rect['x']+rect['width']/3,rect['y']+rect['height']/2);pg.mouse.down();pg.mouse.move(rect['x']+rect['width']/3+30,rect['y']+rect['height']/2+8,steps=5);pg.mouse.up();ready(pg)
    assert fan(snap(pg))['x']!=fan(before)['x']
    with pg.expect_download() as ev:pg.locator('[data-action=save]').click()
    assert ev.value.suggested_filename=='cooling-planner-v8.json'
    ctx.close()
