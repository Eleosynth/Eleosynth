#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Generates src/logo.svg: a coffee tree as a welded metal sculpture — forged steel trunk and branches,
# hammered metal leaves, red enamel coffee cherries, on a bolted base plate. Deterministic.
import math, random, os

random.seed(1953)
W, H = 512, 512
out = []
def add(s): out.append(s)

defs = '''
<defs>
  <linearGradient id="steel" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#3b3632"/><stop offset=".28" stop-color="#9c958c"/><stop offset=".45" stop-color="#ece6dc"/>
    <stop offset=".62" stop-color="#8a837a"/><stop offset="1" stop-color="#2a2622"/>
  </linearGradient>
  <linearGradient id="steelV" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#f1ebe1"/><stop offset=".35" stop-color="#a39b91"/><stop offset=".7" stop-color="#5a544d"/><stop offset="1" stop-color="#2b2723"/>
  </linearGradient>
  <linearGradient id="leafA" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#d9d1c4"/><stop offset=".3" stop-color="#8f877c"/><stop offset=".55" stop-color="#4c4640"/><stop offset=".8" stop-color="#7d756b"/><stop offset="1" stop-color="#2f2a26"/>
  </linearGradient>
  <linearGradient id="leafB" x1="1" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#c9a77a"/><stop offset=".35" stop-color="#8a6a45"/><stop offset=".6" stop-color="#4a3826"/><stop offset="1" stop-color="#a88a62"/>
  </linearGradient>
  <radialGradient id="berry" cx=".36" cy=".32" r=".75">
    <stop offset="0" stop-color="#ff8a7a"/><stop offset=".18" stop-color="#e3313a"/><stop offset=".6" stop-color="#a8121d"/><stop offset="1" stop-color="#4a050b"/>
  </radialGradient>
  <radialGradient id="berryDark" cx=".38" cy=".34" r=".75">
    <stop offset="0" stop-color="#e86a5a"/><stop offset=".25" stop-color="#b4202a"/><stop offset=".7" stop-color="#6e0a12"/><stop offset="1" stop-color="#2c0306"/>
  </radialGradient>
  <radialGradient id="plate" cx=".45" cy=".35" r=".7">
    <stop offset="0" stop-color="#d8d1c6"/><stop offset=".5" stop-color="#7c756c"/><stop offset="1" stop-color="#2d2925"/>
  </radialGradient>
  <filter id="drop" x="-20%" y="-20%" width="140%" height="140%">
    <feDropShadow dx="0" dy="6" stdDeviation="6" flood-color="#000" flood-opacity=".45"/>
  </filter>
</defs>'''
add(defs)

# base plate (an elliptical steel disc with four bolts)
cx, base_y = 256, 440
add(f'<g filter="url(#drop)">')
add(f'<ellipse cx="{cx}" cy="{base_y+14}" rx="150" ry="30" fill="#1d1a17"/>')
add(f'<ellipse cx="{cx}" cy="{base_y+6}" rx="150" ry="30" fill="url(#plate)" stroke="#1b1815" stroke-width="3"/>')
add(f'<ellipse cx="{cx}" cy="{base_y+2}" rx="132" ry="22" fill="none" stroke="#efe8dd" stroke-opacity=".35" stroke-width="2"/>')
for a in (200, 250, 290, 340):
    bx = cx + 118 * math.cos(math.radians(a)); by = base_y + 6 + 22 * math.sin(math.radians(a))
    add(f'<circle cx="{bx:.1f}" cy="{by:.1f}" r="6" fill="url(#steelV)" stroke="#1b1815" stroke-width="1.5"/>')
    add(f'<path d="M{bx-3:.1f} {by:.1f}h6M{bx:.1f} {by-3:.1f}v6" stroke="#2b2622" stroke-width="1.4"/>')

# forged trunk with tiers of lateral branches (coffee trees grow horizontal laterals; cherries cluster at the leaf nodes)
def qpt(p0, p1, p2, t):
    return ((1-t)**2*p0[0] + 2*(1-t)*t*p1[0] + t*t*p2[0], (1-t)**2*p0[1] + 2*(1-t)*t*p1[1] + t*t*p2[1])
def tube(p0, p1, p2, t):
    d = f'M{p0[0]:.1f} {p0[1]:.1f}Q{p1[0]:.1f} {p1[1]:.1f} {p2[0]:.1f} {p2[1]:.1f}'
    add(f'<path d="{d}" stroke="#16130f" stroke-width="{t+5:.1f}" stroke-linecap="round" fill="none"/>')
    add(f'<path d="{d}" stroke="url(#steelV)" stroke-width="{t:.1f}" stroke-linecap="round" fill="none"/>')
    add(f'<path d="{d}" transform="translate({-t*0.18:.1f} {-t*0.12:.1f})" stroke="#fbf6ee" stroke-opacity=".55" stroke-width="{max(1.2,t*0.14):.1f}" stroke-linecap="round" fill="none"/>')
trunk = [(cx, base_y), (cx - 18, 290), (cx + 4, 104)]
tiers = [(0.24, 168, 13), (0.42, 152, 11), (0.59, 128, 9.5), (0.74, 100, 8), (0.87, 66, 6.5)]
laterals = []
for (tt, L, th) in tiers:
    p0 = qpt(*trunk, tt)
    for side in (-1, 1):
        LL = L * random.uniform(0.92, 1.05)
        end = (p0[0] + side * LL, p0[1] - LL * 0.02 + random.uniform(10, 28))
        ctl = (p0[0] + side * LL * 0.5, p0[1] - LL * 0.3)
        laterals.append((p0, ctl, end, th, side))
# leaves: pairs along the outer branches (coffee leaves are opposite, glossy, elongated with a drip tip)
def leaf(x, y, ang, L, grad):
    w = L * 0.36
    c, s = math.cos(ang), math.sin(ang)
    def p(u, v): return (x + u * c - v * s, y - (u * s + v * c))
    tip = p(L, 0); a1 = p(L * 0.35, w); a2 = p(L * 0.8, w * 0.7); b1 = p(L * 0.35, -w); b2 = p(L * 0.8, -w * 0.7)
    d = f'M{x:.1f} {y:.1f}C{a1[0]:.1f} {a1[1]:.1f} {a2[0]:.1f} {a2[1]:.1f} {tip[0]:.1f} {tip[1]:.1f}C{b2[0]:.1f} {b2[1]:.1f} {b1[0]:.1f} {b1[1]:.1f} {x:.1f} {y:.1f}Z'
    add(f'<path d="{d}" fill="url(#{grad})" stroke="#15120f" stroke-width="2.2" stroke-linejoin="round"/>')
    m1 = p(L * 0.92, 0)
    add(f'<path d="M{x:.1f} {y:.1f}L{m1[0]:.1f} {m1[1]:.1f}" stroke="#15120f" stroke-width="1.6" stroke-opacity=".8"/>')
    for k in range(1, 5):  # hammered veins
        u = L * (0.18 + k * 0.17); q0 = p(u, 0); q1 = p(u + L * 0.1, w * 0.55); q2 = p(u + L * 0.1, -w * 0.55)
        add(f'<path d="M{q0[0]:.1f} {q0[1]:.1f}L{q1[0]:.1f} {q1[1]:.1f}M{q0[0]:.1f} {q0[1]:.1f}L{q2[0]:.1f} {q2[1]:.1f}" stroke="#15120f" stroke-width="1" stroke-opacity=".55"/>')
    hl = p(L * 0.3, w * 0.45); hl2 = p(L * 0.75, w * 0.35)
    add(f'<path d="M{hl[0]:.1f} {hl[1]:.1f}L{hl2[0]:.1f} {hl2[1]:.1f}" stroke="#fffaf2" stroke-opacity=".5" stroke-width="1.6" stroke-linecap="round"/>')


leaves, berries = [], []
for (p0, ctl, end, th, side) in laterals:
    nodes = 4 if abs(end[0]-p0[0]) > 120 else 3
    for k in range(nodes):
        t = 0.32 + 0.66 * k / (nodes - 1)
        x, y = qpt(p0, ctl, end, t)
        x2, y2 = qpt(p0, ctl, end, min(1, t + 0.02))
        ang = math.atan2(-(y2 - y), x2 - x)
        Ls = random.uniform(40, 52) * (1.15 - 0.3 * t)
        leaves.append((x, y, ang + 0.95 + random.uniform(-0.12, 0.12), Ls, 'leafA' if k % 2 else 'leafB'))
        leaves.append((x, y, ang - 0.95 + random.uniform(-0.12, 0.12), Ls * 0.92, 'leafB' if k % 2 else 'leafA'))
        if k < nodes - 1 and th > 7 and random.random() < 0.8:
            berries.append((x, y + th * 0.55))
    ang = math.atan2(-(end[1] - ctl[1]), end[0] - ctl[0])
    leaves.append((end[0], end[1], ang, random.uniform(40, 48), "leafA"))
tip = trunk[2]
for a_ in (1.2, 1.94, 1.57):
    leaves.append((tip[0], tip[1] + 4, a_ + random.uniform(-0.08, 0.08), 40, 'leafA' if a_ != 1.57 else 'leafB'))

tube(*trunk, 30)
for (p0, ctl, end, th, side) in laterals:
    tube(p0, ctl, end, th)
for l in leaves:
    leaf(*l)
for (p0, ctl, end, th, side) in laterals:  # weld beads where laterals meet the trunk
    add(f'<circle cx="{p0[0]:.1f}" cy="{p0[1]:.1f}" r="{th*0.8:.1f}" fill="url(#steelV)" stroke="#16130f" stroke-width="1.6"/>')
for (bx, by) in berries:
    n = random.choice((3, 3, 4, 5))
    for j in range(n):
        r = random.uniform(8.5, 11)
        a_ = math.pi * (0.12 + 0.76 * j / max(1, n - 1))
        ox = bx + math.cos(a_) * 13 + random.uniform(-2, 2); oy = by + math.sin(a_) * 6 + random.uniform(0, 4)
        g = 'berry' if random.random() > 0.3 else 'berryDark'
        add(f'<circle cx="{ox:.1f}" cy="{oy:.1f}" r="{r:.1f}" fill="url(#{g})" stroke="#2a0306" stroke-width="1.6"/>')
        add(f'<ellipse cx="{ox - r*0.32:.1f}" cy="{oy - r*0.38:.1f}" rx="{r*0.28:.1f}" ry="{r*0.18:.1f}" fill="#fff" fill-opacity=".85" transform="rotate(-30 {ox - r*0.32:.1f} {oy - r*0.38:.1f})"/>')
add('</g>')

svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" role="img" aria-label="Eleosynth: a metal sculpture of a coffee tree with red cherries">' + ''.join(out) + '</svg>'
p = os.path.join(os.path.dirname(__file__), '..', 'src', 'logo.svg')
open(p, 'w').write(svg)
print('wrote', p, len(svg), 'bytes')
