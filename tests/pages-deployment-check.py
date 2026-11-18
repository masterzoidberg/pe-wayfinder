"""Exercise the allowlisted site at a GitHub Pages-style repository prefix."""
from functools import partial
from hashlib import sha256
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import shutil
import tempfile
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
EXPECTED_CORPUS_SHA256='5075bc789ae4ac6854f85ddf1b80cf33aef583f0d0fb57892ee29c2fb056020d'
EXPECTED_FILES={'index.html','styles.css','core.js','app.js','data/training-items.js'}

def main():
    import argparse
    parser=argparse.ArgumentParser()
    parser.add_argument('--site',type=Path,default=ROOT/'_site')
    site=parser.parse_args().site.resolve()
    actual={p.relative_to(site).as_posix() for p in site.rglob('*') if p.is_file()}
    assert actual==EXPECTED_FILES,(actual,EXPECTED_FILES)
    corpus=site/'data/training-items.js'
    assert sha256(corpus.read_bytes()).hexdigest()==EXPECTED_CORPUS_SHA256

    with tempfile.TemporaryDirectory(prefix='pe-wayfinder-pages-') as temporary:
        document_root=Path(temporary)
        subpath=document_root/'pe-wayfinder'
        shutil.copytree(site,subpath)
        handler=partial(SimpleHTTPRequestHandler,directory=str(document_root))
        server=ThreadingHTTPServer(('127.0.0.1',0),handler)
        thread=Thread(target=server.serve_forever,daemon=True)
        thread.start()
        base=f'http://127.0.0.1:{server.server_port}/pe-wayfinder/'
        try:
            with sync_playwright() as playwright:
                browser=playwright.chromium.launch(headless=True)
                page=browser.new_page(viewport={'width':1280,'height':900})
                page_errors=[]
                failed_requests=[]
                page.on('pageerror',lambda error:page_errors.append(str(error)))
                page.on('requestfailed',lambda request:failed_requests.append(request.url))
                response=page.goto(base,wait_until='networkidle')
                assert response and response.status==200
                assert page.get_by_role('heading',name='Find the path before you find the formula.').is_visible()
                assert page.evaluate('window.PEWayfinderItems.length')==189
                assert page.evaluate('window.PEWayfinderCore.CONTENT_VERSION')=='2026.10.08-r2'
                assert page.evaluate('location.pathname')=='/pe-wayfinder/'

                page.locator('.nav-link[data-view="home"]').focus()
                page.keyboard.press('Shift+Tab')
                focus_after_tab=page.evaluate("({tag:document.activeElement.tagName,id:document.activeElement.id,className:document.activeElement.className})")
                assert page.evaluate("document.activeElement.classList.contains('skip-link')"),focus_after_tab
                page.keyboard.press('Enter')
                assert page.evaluate("document.activeElement.id==='app-main'")

                start=page.get_by_role('button',name='Start training').first
                start.focus()
                page.keyboard.press('Enter')
                page.locator('#concept-response').fill('Column buckling')
                page.locator('#concept-response').press('Enter')
                page.locator('#search-phrase').fill('slenderness ratio')
                page.locator('#search-phrase').press('Enter')
                page.keyboard.press('f')
                page.get_by_role('button',name='Continue to diagnosis').click()
                page.locator('label.diagnosis-option',has_text='No problem').click()
                page.get_by_role('button',name='Record diagnosis').click()
                page.get_by_role('button',name='Progress',exact=True).click()
                assert page.locator('.stat-card').first.locator('strong').inner_text()=='1'
                assert page.evaluate('localStorage.getItem(window.PEWayfinderCore.STORAGE_KEY)!==null')
                page.reload(wait_until='networkidle')
                assert page.evaluate('location.pathname')=='/pe-wayfinder/'
                page.get_by_role('button',name='Progress',exact=True).click()
                assert page.locator('.stat-card').first.locator('strong').inner_text()=='1'

                map_button=page.get_by_role('button',name='Reference map',exact=True)
                map_button.focus()
                page.keyboard.press('Enter')
                assert page.get_by_role('heading',name='Know the terrain. Keep the book external.').is_visible()
                assert page.locator('[data-map-item]').count()==189

                drill=page.locator('[data-map-item="MDM-COM-SPR-001-C"] [data-train-item]')
                for depth in [2,1]:
                    group=drill.locator(f'xpath=ancestor::details[{depth}]')
                    if not group.evaluate('(el)=>el.open'):
                        group.locator(':scope > summary').click()
                drill.click()
                assert page.locator('#concept-response').is_visible()
                assert page.evaluate('JSON.parse(localStorage.getItem(window.PEWayfinderCore.STORAGE_KEY)).incompleteSession.itemId')=='MDM-COM-SPR-001-C'
                page.get_by_role('button',name='Exit drill',exact=True).click()
                assert page.get_by_role('heading',name='Know the terrain. Keep the book external.').is_visible()
                assert drill.is_visible() and drill.evaluate('(el)=>el===document.activeElement')

                for width in [320,390,768]:
                    page.set_viewport_size({'width':width,'height':844})
                    assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth')
                page.reload(wait_until='networkidle')
                assert page.get_by_role('heading',name='Find the path before you find the formula.').is_visible()
                direct=page.goto(base+'index.html',wait_until='networkidle')
                assert direct and direct.status==200
                assert page.get_by_role('heading',name='Find the path before you find the formula.').is_visible()
                assert not page_errors,page_errors
                assert not failed_requests,failed_requests
                browser.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)
    print('Pages-prefix smoke check passed: assets, 189-item final-r3 corpus, keyboard, drill completion, Reference Map, storage persistence, refresh, and mobile width.')

if __name__=='__main__':
    main()
