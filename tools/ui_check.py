#!/usr/bin/env python3
# Headless Chromium check: console errors, audio start, notes, every tab, desktop + phone screenshots.
import sys, os
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
url = os.environ.get('URL') or 'file://' + os.path.join(ROOT, 'dist', 'eleosynth.html')
errs = []
with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'])
    for (name, vw, vh) in [('desk', 1440, 960), ('phone', 390, 844)]:
        pg = b.new_page(viewport={'width': vw, 'height': vh}, device_scale_factor=1 if name == 'desk' else 2)
        pg.on('console', lambda m: errs.append(name + ' console ' + m.type + ': ' + m.text) if m.type in ('error', 'warning') else None)
        pg.on('pageerror', lambda e: errs.append(name + ' pageerror: ' + str(e)))
        pg.goto(url); pg.wait_for_timeout(1500)
        pg.screenshot(path=f'{OUT}/{name}-0-rest.png')
        pg.click('#wake-btn'); pg.wait_for_timeout(2500)
        st = pg.evaluate("document.getElementById('wake').hidden")
        print(name, 'wake hidden after start:', st)
        # play a chord with the computer keyboard
        for k in 'adgj': pg.keyboard.down(k)
        pg.wait_for_timeout(700)
        print(name, 'voices while holding chord:', pg.inner_text('#voices'))
        pg.screenshot(path=f'{OUT}/{name}-1-synth.png', full_page=(name == 'desk'))
        for k in 'adgj': pg.keyboard.up(k)
        for tab in ['fx', 'pedals', 'takes']:
            pg.click(f'.tab[data-tab="{tab}"]'); pg.wait_for_timeout(500)
            pg.screenshot(path=f'{OUT}/{name}-2-{tab}.png', full_page=(name == 'desk'))
        # horizontal overflow check
        ow = pg.evaluate("document.documentElement.scrollWidth - innerWidth")
        print(name, 'horizontal overflow px:', ow)
        pg.close()
    b.close()
print('\n'.join(errs) if errs else 'no console errors')
