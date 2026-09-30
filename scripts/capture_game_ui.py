"""Capture evidence screenshots of the game-UI layout for the implementation report.

Loads the standalone cooling-planner-v0.9.html in headless Chromium and saves
PNG files under evidence/game-ui/. Run:

    CHROMIUM_PATH=... python3 scripts/capture_game_ui.py
"""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / 'cooling-planner-v0.9.html').read_text()
OUT = ROOT / 'evidence/game-ui'
OUT.mkdir(parents=True, exist_ok=True)

CHROMIUM = os.environ.get('CHROMIUM_PATH')


def ready(page):
    page.wait_for_function(
        "window.__DCS__ && window.__DCS__.result() && "
        "document.querySelector('#status').dataset.state==='ready' && "
        "window.__DCS__.hash()===window.__DCS__.result().inputHash",
        timeout=45000)


def open_sheet(page, tab):
    ws = page.evaluate('window.__DCS__.workspace()')
    if ws['sheet'] == tab:
        return
    if not page.locator('#sheet').is_visible():
        page.locator('#results-button').click()
    page.locator(f'[data-sheet={tab}]').click()


def shot(page, name):
    page.screenshot(path=str(OUT / name))
    print('saved', name)


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=CHROMIUM, headless=True,
            args=['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
                  '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'])

        # ---------- PC viewport ----------
        ctx = browser.new_context(viewport={'width': 1512, 'height': 1050})
        page = ctx.new_page()
        page.set_content(HTML, wait_until='load')
        ready(page)

        # guide is active on first load (fresh context has no GUIDE_KEY)
        shot(page, 'pc-01-guide.png')
        page.locator('[data-action=guide-skip]').click()
        page.wait_for_timeout(300)
        shot(page, 'pc-02-normal.png')

        # device selection panel
        p = page.evaluate('window.__DCS__.snapshot()')
        fan0 = p['scenarios'][1]['fans'][0]
        pos = page.evaluate(
            '(d)=>window.__DCS__.screenPoint(d.x,d.heightM,d.y)', fan0)
        if pos['visible']:
            page.mouse.click(pos['x'], pos['y'])
        else:
            page.locator('#devices-button').click()
            page.locator('#device-selector [data-device]').first.click()
        page.wait_for_timeout(300)
        shot(page, 'pc-03-device-selected.png')
        page.locator('[data-action=close-panel]').click()

        # placement candidate ghost
        page.locator('[data-action=place-fan]').click()
        rect = page.locator('#scene').bounding_box()
        page.mouse.move(rect['x'] + rect['width'] * .45,
                        rect['y'] + rect['height'] * .4)
        page.wait_for_timeout(300)
        shot(page, 'pc-04-placement-ghost.png')
        page.keyboard.press('Escape')

        # probe result panel
        page.locator('#sum-deficit').click()
        page.wait_for_timeout(300)
        shot(page, 'pc-05-probe-result.png')
        page.locator('[data-action=close-panel]').click()

        # comparison sheet
        open_sheet(page, 'compare')
        page.wait_for_timeout(300)
        shot(page, 'pc-06-compare.png')
        page.locator('[data-action=close-sheet]').click()

        # timeline sheet
        open_sheet(page, 'timeline')
        page.wait_for_timeout(300)
        shot(page, 'pc-07-timeline.png')
        page.locator('[data-action=close-sheet]').click()

        # 2D and realistic modes
        page.locator('[data-mode="2d"]').click()
        page.wait_for_timeout(400)
        shot(page, 'pc-08-mode-2d.png')
        page.locator('[data-render="realistic"]').click()
        page.wait_for_timeout(800)
        shot(page, 'pc-09-mode-realistic.png')
        page.locator('[data-mode="3d"]').click()
        page.wait_for_timeout(300)
        ctx.close()

        # ---------- small (mobile) viewport ----------
        ctx = browser.new_context(viewport={'width': 390, 'height': 844})
        page = ctx.new_page()
        page.set_content(HTML, wait_until='load')
        ready(page)
        if page.locator('#guide-card').is_visible():
            page.locator('[data-action=guide-skip]').click()

        page.locator('#devices-button').click()
        page.wait_for_timeout(300)
        shot(page, 'mobile-01-devices.png')
        page.locator('[data-action=close-panel]').click()

        open_sheet(page, 'compare')
        page.wait_for_timeout(300)
        shot(page, 'mobile-02-compare.png')
        ctx.close()

        browser.close()


if __name__ == '__main__':
    main()
