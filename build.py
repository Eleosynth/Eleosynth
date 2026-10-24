#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Builds Eleosynth into single self-contained HTML files (no network requests at run time).
#   dist/eleosynth.html        standalone page (open in Chrome/Edge, or via the web launcher for guitar input)
#   dist/eleosynth-page.html   the same page without the document skeleton, for publishing as a Claude page
import base64, os, zipfile, re
ROOT = os.path.dirname(os.path.abspath(__file__)); SRC = os.path.join(ROOT, 'src'); DIST = os.path.join(ROOT, 'dist')
os.makedirs(DIST, exist_ok=True)
read = lambda p: open(os.path.join(SRC, p), encoding='utf-8').read()

FONTS = [('Big Shoulders Display', 700, 'big-shoulders-display-latin-700-normal'), ('Big Shoulders Display', 800, 'big-shoulders-display-latin-800-normal'), ('Big Shoulders Display', 900, 'big-shoulders-display-latin-900-normal'),
         ('Archivo', 400, 'archivo-latin-400-normal'), ('Archivo', 500, 'archivo-latin-500-normal'), ('Archivo', 600, 'archivo-latin-600-normal'), ('Archivo', 700, 'archivo-latin-700-normal'),
         ('Martian Mono', 400, 'martian-mono-latin-400-normal'), ('Martian Mono', 600, 'martian-mono-latin-600-normal')]
faces = ''.join("@font-face{font-family:'%s';font-weight:%d;font-style:normal;font-display:swap;src:url(data:font/woff2;base64,%s) format('woff2')}" % (f, w, base64.b64encode(open(os.path.join(SRC, 'fonts', n + '.woff2'), 'rb').read()).decode()) for f, w, n in FONTS)
css = '<style>' + faces + read('style.css') + '</style>'

def safe(js): return js.replace('</script', '<\\/script')
scripts = ''.join('<script>' + safe(read(f)) + '</script>' for f in ['params.js', 'tables.js', 'sources.js', 'presets.js', 'kit.js', 'app.js'])
scripts = '<script type="text/plain" id="worklet-src">' + safe(read('worklet.js')) + '</script>' + '<script type="text/plain" id="logo-src">' + read('logo.svg') + '</script>' + scripts

page = read('index.html').replace('<!--STYLE-->', css).replace('<!--SCRIPTS-->', scripts)
open(os.path.join(DIST, 'eleosynth-page.html'), 'w', encoding='utf-8').write(page)
full = ('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        '<link rel="icon" href="data:image/svg+xml;base64,' + base64.b64encode(read('logo.svg').encode()).decode() + '">'
        '</head><body>' + page + '</body></html>')
open(os.path.join(DIST, 'eleosynth.html'), 'w', encoding='utf-8').write(full)

print('dist/eleosynth.html', round(len(full) / 1024), 'KB')
