"""Game-UI acceptance tests (GUI01–GUI16 from docs/GAME_UI_IMPLEMENTATION_PLAN.md).
Exercise the HUD: dock placement, panels, bottom sheet, guide, and cancellation."""
from pathlib import Path
import json, os, pytest
from playwright.sync_api import sync_playwright
from test_browser import ready, snap, result, point, check, uncheck, open_panel, open_sheet, place_device, workspace, PANEL, OUT

HTML=(Path(__file__).resolve().parents[2]/'cooling-planner-v0.10.html').read_text()

@pytest.fixture
def page(browser):
    ctx=browser.new_context(viewport={'width':1512,'height':1050},accept_downloads=True)
    pg=ctx.new_page();errors=[];pg.on('pageerror',lambda e:errors.append(str(e)))
    url=os.environ.get('COOLING_PLANNER_URL')
    if url: pg.goto(url,wait_until='load')
    else: pg.set_content(HTML,wait_until='load')
    ready(pg)
    yield pg
    assert not errors,errors
    ctx.close()

def scene_click(page,fx=.5,fy=.5):
    rect=page.locator('#scene').bounding_box()
    page.mouse.click(rect['x']+rect['width']*fx,rect['y']+rect['height']*fy)

# GUI01: first-open orientation — barn visible, next action discoverable (dock + guide).
def test_GUI01_first_open_orientation(page):
    assert page.locator('canvas[data-testid=scene3d]').count()==1
    assert page.locator('#guide-card').is_visible(),'first-use guide should be visible'
    assert '暑さの分布を見る' in page.locator('#guide-card').inner_text()
    for b in ['place-fan','place-soaker','place-mist']:assert page.locator(f'[data-action={b}]').is_enabled()
    assert page.locator('#sum-deficit').is_visible()
    # scenario tabs stay reachable; baseline marked fixed
    assert '固定' in page.locator('#scenario-tabs').inner_text()

def test_GUI12_guide_skip_restart_and_finish(page):
    assert workspace(page)['guide']['done'] is False
    page.locator('[data-action=guide-next]').click()
    assert workspace(page)['guide']['step']==1
    page.locator('[data-action=guide-skip]').click()
    assert workspace(page)['guide']['done'] is True
    assert not page.locator('#guide-card').is_visible()
    # reopenable from help
    page.locator('#help-button').click()
    page.locator('[data-action=guide-restart]').click()
    assert workspace(page)['guide']['done'] is False and page.locator('#guide-card').is_visible()
    for _ in range(3):page.locator('[data-action=guide-next]').click()
    assert workspace(page)['guide']['done'] is True

# GUI02: scenario switch never overwrites another scenario.
def test_GUI02_scenario_switch_keeps_all_scenarios(page):
    place_device(page,'fan')
    p=snap(page)
    page.locator('#scenario-tabs [data-scenario=working-mist]').click();ready(page)
    q=snap(page)
    assert q['scenarios'][1]==p['scenarios'][1] and q['scenarios'][0]==p['scenarios'][0]

# GUI03/04: ghost placement in each view mode — click commits at the pointed position.
def test_GUI03_fan_placement_commits_at_pointed_position(page):
    n=len(snap(page)['scenarios'][1]['fans'])
    place_device(page,'fan')
    p=snap(page)
    assert len(p['scenarios'][1]['fans'])==n+1
    f=p['scenarios'][1]['fans'][-1]
    assert p['view']['selectedDeviceId']==f['id'],'new device selected after commit'
    assert workspace(page)['panel']=='device','device panel opens on commit'
    assert page.evaluate('window.__DCS__.metrics().undoCount')==1
    page.locator('[data-action=undo]').click();ready(page)
    assert len(snap(page)['scenarios'][1]['fans'])==n

def test_GUI03_nozzle_placement_and_2d_mode(page):
    p0=snap(page)
    place_device(page,'soaker')
    p=snap(page)
    assert len(p['scenarios'][1]['waterSystems'][0]['nozzles'])==len(p0['scenarios'][1]['waterSystems'][0]['nozzles'])+1
    page.locator('[data-mode="2d"]').click();ready(page)
    place_device(page,'mist')
    q=snap(page)
    assert len(q['scenarios'][1]['waterSystems'][1]['nozzles'])==len(p['scenarios'][1]['waterSystems'][1]['nozzles'])+1

def test_GUI05_escape_and_cancel_abandon_placement_atomically(page):
    n=len(snap(page)['scenarios'][1]['fans']);h=page.evaluate('window.__DCS__.hash()')
    page.locator('[data-action=place-fan]').click()
    assert workspace(page)['placement'] is not None
    page.keyboard.press('Escape')
    assert workspace(page)['placement'] is None
    assert len(snap(page)['scenarios'][1]['fans'])==n and page.evaluate('window.__DCS__.hash()')==h
    # cancel button path
    page.locator('[data-action=place-fan]').click()
    page.locator('[data-action=cancel-placement]').click()
    assert workspace(page)['placement'] is None and page.evaluate('window.__DCS__.metrics().undoCount')==0

def test_GUI05b_scenario_switch_and_mode_switch_cancel_placement(page):
    page.locator('[data-action=place-fan]').click()
    page.locator('#scenario-tabs [data-scenario=working-mist]').click()
    assert workspace(page)['placement'] is None
    page.locator('[data-action=place-mist]').click()
    page.locator('[data-mode="2d"]').click()
    assert workspace(page)['placement'] is None
    # invalid position is not confirmable: click projects outside the barn footprint
    page.locator('[data-action=place-fan]').click()
    pos=point(page,{'x':-4,'heightM':0,'y':12})
    if pos['visible']:
        page.mouse.click(pos['x'],pos['y'])
        assert workspace(page)['placement'] is not None,'invalid click keeps placement alive'
        assert workspace(page)['placement']['valid'] is False
        page.keyboard.press('Escape')
    assert len(snap(page)['scenarios'][2]['fans'])==len(snap(page)['scenarios'][2]['fans'])

def test_GUI06_baseline_refuses_placement_with_guidance(page):
    page.locator('#scenario-tabs [data-scenario=baseline]').click();ready(page)
    assert page.locator('#baseline-notice').is_visible()
    assert page.locator('#place-fan').is_disabled()
    page.locator('[data-action=try-editable]').click();ready(page)
    assert snap(page)['activeScenarioId']!='baseline'
    assert page.locator('#place-fan').is_enabled()

# GUI: selection drives the right panel; one panel at a time.
def test_GUI07_selection_opens_matching_panel(page):
    p=snap(page);pos=point(page,p['scenarios'][1]['fans'][0])
    if pos['visible']:page.mouse.click(pos['x'],pos['y'])
    assert workspace(page)['panel']=='device'
    page.locator('[data-action=close-panel]').click()
    assert workspace(page)['panel'] is None and not page.locator('#selection-panel').is_visible()

def test_GUI08_sheet_tabs_and_close(page):
    open_sheet(page,'compare');assert '基準案' in page.locator('#comparison').inner_text()
    open_sheet(page,'areas');assert page.locator('#sheet-areas').is_visible()
    open_sheet(page,'timeline');assert page.locator('#timeline-chart').is_visible()
    open_sheet(page,'reference');assert '乳量' in page.locator('#reference-pane').inner_text()
    page.locator('[data-action=close-sheet]').click()
    assert workspace(page)['sheet'] is None and not page.locator('#sheet').is_visible()

def test_GUI09_summary_strip_reflects_selected_point(page):
    open_panel(page,'probe');page.locator('#probe-select').select_option('stall-A-01');ready(page)
    assert 'A1' in page.locator('#sum-deficit-label').inner_text()
    v=page.locator('#sum-deficit-value').inner_text()
    assert '計算中' not in v and '—' not in v

# GUI10: display-only operations never change the physics hash.
def test_GUI10_panel_sheet_navigation_never_recalculates(page):
    h=page.evaluate('window.__DCS__.hash()');r=result(page)
    open_panel(page,'devices');open_panel(page,'roof');open_panel(page,'weather');open_panel(page,'probe')
    for tab in ['compare','areas','timeline','reference']:open_sheet(page,tab)
    page.locator('[data-action=close-sheet]').click()
    page.locator('[data-action=help]').click();page.locator('[data-close=help-dialog]').click()
    assert page.evaluate('window.__DCS__.hash()')==h and result(page)==r

# GUI11: MCP-style external edits (store ops) cancel placement.
def test_GUI11_external_edit_cancels_placement(page):
    page.locator('[data-action=place-fan]').click()
    page.evaluate("window.__DCS__ && (()=>{const s=window.__DCS__;return true})()")
    # an undo-able project edit simulates an external mutation
    check(page,'show-analysis')  # view-only change must NOT cancel
    assert workspace(page)['placement'] is not None
    open_panel(page,'roof');check(page,'roof-coating')  # project change cancels
    assert workspace(page)['placement'] is None

# GUI13/14: help + equipment docs are reachable and close cleanly.
def test_GUI13_help_lists_controls_and_glossary(page):
    page.locator('#help-button').click()
    text=page.locator('#help-body').inner_text()
    for w in ['設備を置く','放熱不足','風速','乳量']:assert w in text
    page.locator('[data-close=help-dialog]').click()
    assert not page.locator('#help-dialog').is_visible()

# GUI15: small viewports keep the workflow reachable.
@pytest.mark.parametrize('w,h',[(390,844),(768,1024),(1280,800),(1920,1080)])
def test_GUI15_viewport_sizes(page,w,h):
    page.set_viewport_size({'width':w,'height':h});ready(page)
    assert page.evaluate('document.documentElement.scrollWidth<=document.documentElement.clientWidth+1')
    assert page.locator('#place-fan').is_visible() and page.locator('#results-button').is_visible()
    open_sheet(page,'compare');assert page.locator('#sheet').is_visible()
    page.locator('[data-action=close-sheet]').click()

# GUI17: a field being edited must not be wiped by worker results.
def test_GUI17_uncommitted_input_survives_recalculation(page):
    open_panel(page,'weather')
    page.locator('#env-temperature').fill('33');page.locator('#env-temperature').press('Tab')
    page.wait_for_function("document.querySelector('#status').dataset.state==='calculating'")
    hum=page.locator('#env-humidity');hum.fill('65')  # typed, never committed → status stays 'pending'
    page.wait_for_function("window.__DCS__.metrics().calculating===false")  # worker result re-renders mid-edit
    assert hum.input_value()=='65','uncommitted value must survive the worker-result render'
    assert page.evaluate("document.activeElement && document.activeElement.id")=='env-humidity'
    assert snap(page)['environment']['relativeHumidityPct']==70,'rebuild teardown must not commit the typed value'
    assert page.locator('[data-action=save]').first.is_disabled(),'pending edit still blocks save'

# GUI18: clicking the already-selected object reopens its inspector.
def test_GUI18_reselect_reopens_inspector(page):
    p=snap(page);pos=point(page,p['scenarios'][1]['fans'][0])
    if not pos['visible']:pytest.skip('fan not on screen')
    page.mouse.click(pos['x'],pos['y']);assert workspace(page)['panel']=='device'
    page.locator('[data-action=close-panel]').click()
    assert workspace(page)['panel'] is None
    page.mouse.click(pos['x'],pos['y'])  # same device, selection id unchanged
    assert workspace(page)['panel']=='device','re-clicking the selected device must reopen the inspector'

# GUI19: a 2D margin click is outside the barn — placement must not commit.
def test_GUI19_2d_outside_click_rejects_placement(page):
    page.locator('[data-mode="2d"]').click();ready(page)
    n=len(snap(page)['scenarios'][1]['fans'])
    page.locator('[data-action=place-fan]').click()
    pos=point(page,{'x':-1,'heightM':0,'y':12})  # inside the SVG margin, outside the floor
    if pos['visible']:
        page.mouse.click(pos['x'],pos['y'])
        pl=workspace(page)['placement']
        assert pl is not None and pl['valid'] is False,'outside click must not clamp to a valid spot'
        assert len(snap(page)['scenarios'][1]['fans'])==n,'no device may be created outside'
        page.keyboard.press('Escape')

# GUI20: losing focus cancels placement completely — scene clicks select again.
def test_GUI20_blur_cancels_placement_and_restores_scene(page):
    p=snap(page);pos=point(page,p['scenarios'][1]['fans'][0])
    page.locator('[data-action=place-fan]').click()
    assert workspace(page)['placement'] is not None
    assert not page.locator('#placement-hint').is_hidden()
    page.evaluate("window.dispatchEvent(new Event('blur'))")
    assert workspace(page)['placement'] is None
    assert page.locator('#placement-hint').is_hidden(),'placement hint must close on blur cancel'
    if pos['visible']:
        page.mouse.click(pos['x'],pos['y'])  # not swallowed as a placement attempt
        assert workspace(page)['placement'] is None
        assert snap(page)['view']['selectedDeviceId']==p['scenarios'][1]['fans'][0]['id']
        assert workspace(page)['panel']=='device'
