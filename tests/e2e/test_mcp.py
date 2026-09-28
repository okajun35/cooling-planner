"""MCP PoC golden path: a real MCP stdio client drives the actual open page.

Spawns scripts/mcp-server.mjs (static + /bridge + stdio MCP) and loads
http://127.0.0.1:PORT/?mcp=1 in headless Chromium, then calls the 5 tools
over raw JSON-RPC and asserts the screen's own state (__DCS__) changed.
"""
from pathlib import Path
import json, os, subprocess, time, urllib.request
import pytest

ROOT=Path(__file__).resolve().parents[2]
PORT=int(os.environ.get('MCP_TEST_PORT','4180'))
BASE=f'http://127.0.0.1:{PORT}'
OUT=ROOT/'evidence'/'browser';OUT.mkdir(parents=True,exist_ok=True)

class McpClient:
    """Minimal stdio JSON-RPC client for the PoC server."""
    def __init__(self):
        env=dict(os.environ,COOLING_PLANNER_PORT=str(PORT))
        self.p=subprocess.Popen(['node',str(ROOT/'scripts'/'mcp-server.mjs')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,bufsize=1,env=env)
        self._id=0
        for _ in range(100):
            try:
                urllib.request.urlopen(BASE+'/',timeout=.3);return
            except Exception:time.sleep(.1)
        raise RuntimeError('mcp-server did not start listening')
    def call(self,method,params=None):
        self._id+=1
        self.p.stdin.write(json.dumps({'jsonrpc':'2.0','id':self._id,'method':method,'params':params or {}})+'\n')
        self.p.stdin.flush()
        while True:
            line=self.p.stdout.readline()
            if not line:raise RuntimeError('mcp-server closed stdout')
            m=json.loads(line)
            if m.get('id')==self._id:return m
    def tool(self,name,args=None):
        r=self.call('tools/call',{'name':name,'arguments':args or {}})['result']
        text=r['content'][0]['text']
        return r.get('isError',False),(text if r.get('isError') else json.loads(text))
    def close(self):self.p.terminate();self.p.wait(timeout=5)

def ready(page):
    page.wait_for_function("window.__DCS__ && window.__DCS__.result() && document.querySelector('#status').dataset.state==='ready' && window.__DCS__.hash()===window.__DCS__.result().inputHash",timeout=60000)
def snap(page):return page.evaluate('window.__DCS__.snapshot()')

@pytest.fixture(scope='module')
def client():
    c=McpClient()
    yield c
    c.close()

@pytest.fixture
def page(browser):
    ctx=browser.new_context(viewport={'width':1512,'height':1050})
    pg=ctx.new_page()
    pg.goto(BASE+'/?mcp=1',wait_until='load')
    ready(pg)
    yield pg
    ctx.close()

def active_fan(page,fid='fan-feeding-1'):
    p=snap(page)
    s=[x for x in p['scenarios'] if x['id']==p['activeScenarioId']][0]
    return [f for f in s['fans'] if f['id']==fid][0]

def test_mcp_01_handshake_tools_and_state_reflects_open_page(client,page):
    init=client.call('initialize',{'protocolVersion':'2025-06-18','capabilities':{},'clientInfo':{'name':'pytest','version':'0'}})
    assert init['result']['serverInfo']['name']=='cooling-planner'
    tools=client.call('tools/list')['result']['tools']
    assert {t['name'] for t in tools}=={'get_state','edit','set_view','get_results','undo'}
    err,st=client.tool('get_state')
    assert not err
    p=snap(page)
    assert st['activeScenarioId']==p['activeScenarioId']
    assert st['inputHash']==page.evaluate('window.__DCS__.hash()')
    assert len(st['scenarios'])==3 and len(st['probes'])==70
    # a person changing the selection on screen is visible to the next tool call
    page.locator('#probe-select').select_option('stall-A-01')
    err,st2=client.tool('get_state')
    assert st2['view']['selectedProbeId']=='stall-A-01'

def test_mcp_02_edit_moves_fan_and_results_match_screen(client,page):
    orig=active_fan(page)['x']
    err,r=client.tool('edit',{'operation':'update_device','deviceId':'fan-feeding-1','patch':{'x':orig+3,'yawDeg':45}})
    assert not err,r
    assert r['applied']['x']==orig+3
    ready(page)
    assert active_fan(page)['x']==orig+3 and active_fan(page)['yawDeg']==45
    err,res=client.tool('get_results')
    assert not err
    assert res['status']=='ready'
    assert res['result']['inputHash']==page.evaluate('window.__DCS__.hash()')
    pt=res['result']['probe']['points'][page.evaluate('window.__DCS__.snapshot().activeScenarioId')]
    screen=page.evaluate('window.__DCS__.result()')
    probe=res['result']['probe']['id']
    sp=[q for q in screen['scenarios'] if q['id']==page.evaluate('window.__DCS__.snapshot().activeScenarioId')][0]
    sp_pt=[q for q in sp['points'] if q['probeId']==probe][0]
    assert pt['meanQrefW']==sp_pt['meanQrefW']

def test_mcp_03_set_view_changes_screen_selection_and_metric(client,page):
    err,v=client.tool('set_view',{'metric':'temperature','selectedProbeId':'feed-01','mode':'2d'})
    assert not err
    p=snap(page)
    assert p['view']['metric']=='temperature'
    assert p['view']['selectedProbeId']=='feed-01'
    assert p['view']['selectedAreaId']=='feeding'
    assert p['view']['mode']=='2d'
    assert page.evaluate('window.__DCS__.metrics().undoCount')==0

def test_mcp_04_copy_compare_and_undo_restores_screen(client,page):
    err,r=client.tool('edit',{'operation':'update_roof','patch':{'reflectance':0.7,'insulationM':0.02}})
    assert not err
    err,cp=client.tool('edit',{'operation':'copy_to_other'})
    assert cp['activeScenarioId']=='working-mist'
    err,r2=client.tool('edit',{'operation':'update_roof','patch':{'sprayEnabled':True}})
    ready(page)
    p=snap(page)
    assert p['activeScenarioId']=='working-mist'
    assert p['scenarios'][2]['roof']['sprayEnabled'] is True
    assert p['scenarios'][1]['roof']['sprayEnabled'] is False
    err,res=client.tool('get_results',{'probeId':'feed-01'})
    assert res['status']=='ready'
    ids=[s['id'] for s in res['result']['scenarios']]
    assert 'working-soaker' in ids and 'working-mist' in ids
    err,u=client.tool('undo')
    assert u['changed'] is True
    ready(page)
    assert snap(page)['scenarios'][2]['roof']['sprayEnabled'] is False

def test_mcp_05_minimal_errors(client,page):
    err,_=client.tool('edit',{'operation':'switch_scenario','scenarioId':'baseline'})
    err,msg=client.tool('edit',{'operation':'update_roof','patch':{'reflectance':0.9}})
    assert err is True and '基準案' in msg
    err,msg=client.tool('edit',{'operation':'update_device','deviceId':'fan-feeding-1','patch':{'x':1,'id':'x'}})
    assert err is True

def test_mcp_06_second_tab_is_rejected_and_shows_message(client,page,browser):
    ctx=browser.new_context()
    pg2=ctx.new_page()
    pg2.goto(BASE+'/?mcp=1',wait_until='load')
    pg2.wait_for_selector('#toast:not([hidden])',timeout=10000)
    assert '別のタブ' in pg2.locator('#toast').inner_text()
    ctx.close()
    # the first tab still serves commands
    err,st=client.tool('get_state')
    assert not err and st['activeScenarioId']

def test_mcp_07_normal_http_page_has_no_bridge(client,browser):
    ctx=browser.new_context()
    pg=ctx.new_page()
    pg.goto(BASE+'/',wait_until='load')
    ready(pg)
    assert pg.evaluate("window.__DCS__.hash()").strip()!=''
    # same page without ?mcp=1 still edits locally
    pg.locator('#roof-coating').check()
    ready(pg)
    assert snap(pg)['scenarios'][1]['roof']['reflectance']==.7
    ctx.close()
