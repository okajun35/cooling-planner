"""Two UI smoke checks for humans/CI; model reproducibility is covered in Node tests."""
import json
from test_browser import page, ready, snap, open_sheet


def test_mcp_json_paste_and_undo(page):
    before = snap(page)
    proposed = json.loads(json.dumps(before))
    proposed['scenarios'][1]['roof']['reflectance'] = .7
    open_sheet(page, 'compare')
    page.locator('#comparison [data-action=paste-project]').click()
    page.locator('#project-import-text').fill(json.dumps({'project': proposed}))
    page.locator('#project-import-apply').click()
    ready(page)
    assert snap(page) == proposed
    page.locator('[data-action=undo]').click()
    ready(page)
    assert snap(page)['scenarios'] == before['scenarios']


def test_comparison_inspects_remaining_place(page):
    open_sheet(page, 'compare')
    card = page.locator('[data-comparison="working-soaker"]')
    assert 'mean cooling deficit' in card.inner_text()
    assert 'Worst deficit' in card.inner_text()
    assert 'L/day' in card.inner_text() and 'kWh/day' in card.inner_text()
    chosen = page.locator('#remaining-deficits [data-inspect-probe]').first
    probe_id = chosen.get_attribute('data-inspect-probe')
    chosen.click()
    assert snap(page)['view']['selectedProbeId'] == probe_id
    assert snap(page)['view']['metric'] == 'deficit'
    assert page.locator('#heat-explanation').is_visible()
