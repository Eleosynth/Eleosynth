# Drives the 0.2 features in headless Chromium: chord mode + namer, drone lock, touch pad, drone, tuner, master.
import sys, os
from playwright.sync_api import sync_playwright
OUT = sys.argv[1]; URL = os.environ.get('URL', 'http://localhost:8799/eleosynth.html')
errs = []
def tab(pg, t): pg.click(f'.tab[data-tab="{t}"]'); pg.wait_for_timeout(300)
with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width': 1440, 'height': 940}); pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_timeout(1200); pg.click('#wake-btn'); pg.wait_for_timeout(2200)
    pg.screenshot(path=OUT + '/v2-header.png', clip={'x': 0, 'y': 0, 'width': 1440, 'height': 130})
    # chord namer in normal mode
    for k in 'adg': pg.keyboard.down(k)
    pg.wait_for_timeout(300); print('namer C-E-G:', pg.inner_text('#chord-name'))
    for k in 'adg': pg.keyboard.up(k)
    # chord mode: one key -> chord
    tab(pg, 'perform')
    pg.select_option('select[aria-label="Play mode"]', '1'); pg.select_option('select[aria-label="Chord type"]', '1')
    pg.keyboard.down('h'); pg.wait_for_timeout(300)  # A in C major -> Am7
    print('chord mode A key ->', pg.inner_text('#chord-big'), '| voices', pg.inner_text('#voices')); 
    # lock it
    pg.keyboard.press('\\'); pg.keyboard.up('h'); pg.wait_for_timeout(500)
    print('locked:', pg.inner_text('#lock-status'), '| voices', pg.inner_text('#voices'))
    pg.screenshot(path=OUT + '/v2-perform.png', full_page=True)
    pg.keyboard.press('\\'); pg.wait_for_timeout(300); pg.select_option('select[aria-label="Play mode"]', '0')
    # drone
    pg.click('#drone-panel .power'); pg.wait_for_timeout(1500); print('drone on, voices', pg.inner_text('#voices'), 'out meter', pg.evaluate("document.querySelector('#m-out i').style.height"))
    pg.click('#drone-panel .power')
    # pad
    pg.click('text=Show the pad'); pg.wait_for_timeout(400)
    box = pg.locator('#pad').bounding_box(); pg.mouse.move(box['x'] + box['width'] * 0.3, box['y'] + box['height'] * 0.5); pg.mouse.down(); pg.wait_for_timeout(200)
    pg.mouse.move(box['x'] + box['width'] * 0.6, box['y'] + box['height'] * 0.2, steps=6); pg.wait_for_timeout(300)
    print('pad note:', pg.inner_text('#chord-name'), '| voices', pg.inner_text('#voices'))
    pg.screenshot(path=OUT + '/v2-pad.png', clip={'x': 0, 'y': 940 - 150, 'width': 1440, 'height': 150}); pg.mouse.up(); pg.click('.seg button[data-m=keys]')
    # master
    tab(pg, 'master'); pg.keyboard.down('a'); pg.keyboard.down('g'); pg.wait_for_timeout(900); pg.screenshot(path=OUT + '/v2-master.png'); pg.keyboard.up('a'); pg.keyboard.up('g')
    # tuner with the test guitar (single-note melody)
    tab(pg, 'pedals'); pg.select_option('select[aria-label="Test guitar riff"]', '1'); pg.click('#test-btn')
    pg.click('.panel[aria-label="TN Tuner"] .phead .toggle'); pg.wait_for_timeout(1500)
    print('tuner:', pg.inner_text('#tn-read'))
    pg.screenshot(path=OUT + '/v2-tuner.png')
    # phone dock
    ph = b.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2); ph.on('pageerror', lambda e: errs.append(str(e)))
    ph.goto(URL); ph.wait_for_timeout(1200); ph.click('#wake-btn'); ph.wait_for_timeout(1500)
    ph.screenshot(path=OUT + '/v2-phone.png'); ph.click('.seg button[data-m=pad]'); ph.wait_for_timeout(300); ph.screenshot(path=OUT + '/v2-phone-pad.png')
    print('phone overflow', ph.evaluate('document.documentElement.scrollWidth-innerWidth'))
    b.close()
print(errs or 'no page errors')
