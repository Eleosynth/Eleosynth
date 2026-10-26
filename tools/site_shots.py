# Screenshots for the website, taken from the built app (needs dist/ served at $URL).
import sys, os
from playwright.sync_api import sync_playwright
URL = os.environ.get('URL', 'http://localhost:8799/eleosynth.html'); OUT = sys.argv[1]
def pick(pg, name):
    pg.click('#patch-open'); pg.fill('input[type=search]', name); pg.wait_for_timeout(200)
    pg.click('.pcard >> nth=0'); pg.keyboard.press('Escape'); pg.wait_for_timeout(400)
with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width': 1600, 'height': 1000})
    pg.goto(URL); pg.wait_for_timeout(1200); pg.click('#wake-btn'); pg.wait_for_timeout(2500)
    pick(pg, 'Neon Lagoon')
    for k in 'adgj': pg.keyboard.down(k)
    pg.wait_for_timeout(1500); pg.screenshot(path=OUT + '/synth.png')
    for k in 'adgj': pg.keyboard.up(k)
    pick(pg, "Dream Tines"); pg.evaluate("window.scrollTo(0, document.querySelector('[aria-label=\"Tine piano\"]').offsetTop - 140)")
    for k in 'sgk': pg.keyboard.down(k)
    pg.wait_for_timeout(900); pg.screenshot(path=OUT + '/keys.png')
    for k in 'sgk': pg.keyboard.up(k)
    pg.evaluate('window.scrollTo(0,0)'); pg.click('.tab[data-tab=fx]'); pg.wait_for_timeout(500); pg.screenshot(path=OUT + '/fx.png')
    pg.click('.add-tile', timeout=1000) if False else None
    pg.click('.tab[data-tab=fx]'); pg.click('text=+ Add effect'); pg.wait_for_timeout(500); pg.screenshot(path=OUT + '/pool.png'); pg.keyboard.press('Escape')
    pg.click('.tab[data-tab=pedals]'); pg.wait_for_timeout(300)
    pg.click('#patch-open'); pg.keyboard.press('Escape')
    pg.click('#rig-name'); pg.click('text=Dream-Pop Wall'); pg.click('#test-btn'); pg.wait_for_timeout(1800); pg.screenshot(path=OUT + '/pedals.png')
    pg.click('#test-btn')
    pg.click('.tab[data-tab=perform]'); pg.wait_for_timeout(300)
    pg.select_option('select[aria-label="Play mode"]', '1'); pg.select_option('select[aria-label="Chord type"]', '1')
    pg.click('#drone-panel .power'); pg.keyboard.down('h'); pg.wait_for_timeout(300); pg.keyboard.press('\\'); pg.keyboard.up('h'); pg.wait_for_timeout(600)
    pg.click('.seg button[data-m=pad]'); bx = pg.locator('#pad').bounding_box()
    pg.mouse.move(bx['x'] + bx['width'] * 0.55, bx['y'] + bx['height'] * 0.35); pg.mouse.down(); pg.wait_for_timeout(500)
    pg.screenshot(path=OUT + '/perform.png'); pg.mouse.up(); pg.click('.seg button[data-m=keys]')
    pg.click('.tab[data-tab=master]'); pg.wait_for_timeout(1200); pg.screenshot(path=OUT + '/master.png')
    pg.keyboard.press('\\'); pg.click('.tab[data-tab=perform]'); pg.click('#drone-panel .power'); pg.select_option('select[aria-label="Play mode"]', '0')
    ph = b.new_page(viewport={'width': 390, 'height': 866}, device_scale_factor=1.8)
    ph.goto(URL); ph.wait_for_timeout(1200); ph.click('#wake-btn'); ph.wait_for_timeout(2000)
    pick(ph, "Suitcase '73"); ph.click('.tab[data-tab=synth]'); ph.evaluate("window.scrollTo(0, document.querySelector('[aria-label=\"Tine piano\"]').offsetTop - 10)")
    ph.wait_for_timeout(500); ph.screenshot(path=OUT + '/phone.png')
    b.close()
