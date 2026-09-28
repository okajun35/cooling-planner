import os, pytest
from playwright.sync_api import sync_playwright

@pytest.fixture(scope='session')
def browser():
    """One shared Chromium for the whole e2e session — a second sync_playwright()
    in the same thread would find the first instance's loop still running."""
    with sync_playwright() as p:
        b=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH'),headless=os.environ.get('HEADLESS','1')!='0',args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'])
        try:
            yield b
        finally:
            b.close()
