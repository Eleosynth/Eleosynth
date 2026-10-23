# Boots the packaged Linux desktop app under Xvfb and drives it over the DevTools protocol.
import subprocess, time, sys, os
from playwright.sync_api import sync_playwright
exe = os.path.join(os.path.dirname(__file__), '..', 'linux', 'out', 'Eleosynth-linux-x64', 'eleosynth')
p = subprocess.Popen(['xvfb-run', '-a', '-s', '-screen 0 1480x940x24', exe, '--no-sandbox', '--remote-debugging-port=9333', '--pedals'], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
time.sleep(6)
try:
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        pg = b.contexts[0].pages[0]
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        print('title:', pg.title(), '| native bridge:', pg.evaluate('typeof window.eleoNative'), '| tab from --pedals:', pg.evaluate("document.querySelector('.tab[aria-selected=true]').dataset.tab"))
        pg.click('#wake-btn'); time.sleep(3)
        pg.click('#test-btn'); time.sleep(2.5)
        print('input meter moving:', pg.evaluate("document.querySelector('#m-in i').style.height"))
        pg.screenshot(path=sys.argv[1])
        print('errors:', errs or 'none')
finally:
    p.terminate()
