#!/usr/bin/env python3
"""
Original product artwork for the sample catalogue (no photos copied from the web).
Writes packages/client/src/productArt.ts: PRODUCT_ART[productId] = SVG markup (400x300).
Run: python3 scripts/gen-product-art.py
"""
import math, random, json, pathlib

W, H = 400, 300
FONT = "'Plus Jakarta Sans','Segoe UI',Arial,sans-serif"
HI = "'Noto Sans Devanagari','Mangal','Nirmala UI',sans-serif"

CAT = {
    'preg':   ('#fff3f4', '#f6c9d1', '#a3122b'),
    'pooja':  ('#fff8e1', '#ffdf8a', '#8a5a00'),
    'shaadi': ('#fff1e6', '#f6c3a0', '#9a3b0c'),
    'dry':    ('#f8f0e4', '#dcc4a4', '#6b4320'),
    'home':   ('#f1f9ee', '#c4e3bb', '#2f7a35'),
}

def esc(s): return s.replace('&', '&amp;').replace('<', '&lt;')

def bg(pid, cat):
    a, b, _ = CAT[cat]
    return (f'<defs><radialGradient id="{pid}-bg" cx="50%" cy="35%" r="80%"><stop offset="0" stop-color="{a}"/>'
            f'<stop offset="1" stop-color="{b}"/></radialGradient>'
            f'<linearGradient id="{pid}-gloss" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity=".35"/>'
            f'<stop offset=".25" stop-color="#fff" stop-opacity="0"/><stop offset=".85" stop-color="#000" stop-opacity="0"/>'
            f'<stop offset="1" stop-color="#000" stop-opacity=".18"/></linearGradient></defs>'
            f'<rect width="{W}" height="{H}" fill="url(#{pid}-bg)"/>'
            # soft floor + scattered dots for texture
            f'<ellipse cx="200" cy="268" rx="170" ry="16" fill="#000" opacity=".07"/>')

def shadow(cx, cy, rx, ry=9, o=.18):
    return f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="#3b2412" opacity="{o}"/>'

def label(cx, y, w, title, hi, weight, accent, h=70):
    x = cx - w / 2
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="#fffdf8" stroke="{accent}" stroke-opacity=".35"/>'
            f'<text x="{cx}" y="{y+21}" text-anchor="middle" font-family="{FONT}" font-size="10.5" font-weight="800" letter-spacing="1.6" fill="{accent}">PANSARI</text>'
            f'<text x="{cx}" y="{y+40}" text-anchor="middle" font-family="{FONT}" font-size="{16 if len(title) < 10 else 13.5}" font-weight="800" fill="#2a1a10">{esc(title)}</text>'
            f'<text x="{cx}" y="{y+57}" text-anchor="middle" font-family="{HI}" font-size="12.5" font-weight="600" fill="#5b4636">{esc(hi)} · {esc(weight)}</text>')

# ---------------------------------------------------------------- contents motifs
def almond(x, y, r=0, s=1):
    return (f'<g transform="translate({x},{y}) rotate({r}) scale({s})"><path d="M0-15C9-12 12 2 0 15C-12 2-9-12 0-15Z" fill="#a8683a"/>'
            f'<path d="M0-12C5-8 6 3 0 11" stroke="#7d4a25" stroke-width="1.4" fill="none" opacity=".7"/>'
            f'<path d="M-4-8C-6-2-5 4-2 8" stroke="#d29a6b" stroke-width="2" fill="none" opacity=".6"/></g>')

def cashew(x, y, r=0, s=1):
    return (f'<g transform="translate({x},{y}) rotate({r}) scale({s})"><path d="M-12-6C-14 8 2 16 12 8C14 6 13 3 10 4C3 8-4 4-4-4C-4-9-11-10-12-6Z" fill="#f1d9a8" stroke="#c9a36a" stroke-width="1.2"/>'
            f'<path d="M-8-4C-8 4-2 9 6 8" stroke="#fff" stroke-opacity=".6" stroke-width="2" fill="none"/></g>')

def raisin(x, y, r=0, s=1):
    return (f'<g transform="translate({x},{y}) rotate({r}) scale({s})"><path d="M-8-5C-4-9 6-8 8-3C10 3 5 8-1 7C-7 6-11 0-8-5Z" fill="#6b2d4a"/>'
            f'<path d="M-4-3C-1-1 2-2 5 0" stroke="#3d1529" stroke-width="1.2" fill="none"/>'
            f'<circle cx="-3" cy="-3" r="1.6" fill="#b86b8e" opacity=".7"/></g>')

def crystal(x, y, r=0, s=1, c='#e7a23a'):
    return (f'<g transform="translate({x},{y}) rotate({r}) scale({s})"><path d="M-8 2L-3-9L7-6L9 4L1 9Z" fill="{c}" opacity=".92"/>'
            f'<path d="M-3-9L1 0L9 4M1 0L-8 2M1 0L1 9" stroke="#fff" stroke-opacity=".45" stroke-width="1" fill="none"/></g>')

def flake(x, y, r=0, s=1):
    return (f'<g transform="translate({x},{y}) rotate({r}) scale({s})"><path d="M-11-3C-6-8 7-7 11-2C8 4-6 6-11-3Z" fill="#8b3a2a"/>'
            f'<path d="M-8-2C-2-4 4-4 9-2" stroke="#c46b4f" stroke-width="1.2" fill="none"/></g>')

def tablet(x, y, s=1):
    return (f'<g transform="translate({x},{y}) scale({s})"><ellipse cx="0" cy="3" rx="11" ry="5" fill="#d9dee8"/>'
            f'<ellipse cx="0" cy="0" rx="11" ry="5" fill="#fbfcff" stroke="#c9d2e3"/></g>')

def salt(x, y, s=1):
    return f'<rect x="{x-4*s}" y="{y-4*s}" width="{8*s}" height="{8*s}" rx="1.5" fill="#fff" stroke="#c7d7ee" transform="rotate({random.randint(-30,30)} {x} {y})"/>'

def leaf_bit(x, y, r=0):
    return f'<path d="M{x-4} {y}C{x-2} {y-4} {x+3} {y-4} {x+5} {y}C{x+2} {y+3} {x-2} {y+3} {x-4} {y}Z" fill="#3d2a14" transform="rotate({r} {x} {y})"/>'

def pile(fn, cx, cy, n, spread=(60, 18), **kw):
    out = []
    for i in range(n):
        a = random.random() * math.pi
        rx = (random.random() - .5) * spread[0] * 2
        ry = (random.random() - .2) * spread[1]
        out.append(fn(cx + rx, cy + ry, r=random.randint(-60, 60), **kw) if 'r' in fn.__code__.co_varnames else fn(cx + rx, cy + ry, **kw))
    return ''.join(out)

# ---------------------------------------------------------------- packs
def pouch(pid, cx, top, w, h, color, accent, title, hi, weight, window=None):
    x0, x1, y1 = cx - w / 2, cx + w / 2, top + h
    body = (f'M{x0+6} {top+18}L{x1-6} {top+18}Q{x1} {top+18} {x1} {top+28}L{x1-4} {y1-14}Q{x1-5} {y1} {x1-20} {y1}'
            f'L{x0+20} {y1}Q{x0+5} {y1} {x0+4} {y1-14}L{x0} {top+28}Q{x0} {top+18} {x0+6} {top+18}Z')
    zig = ''.join(f'L{x0+4+i*8+4} {top+(0 if i%2 else 5)}' for i in range(int((w-8)/8)))
    crimp = f'<path d="M{x0+4} {top+18}L{x0+4} {top+3}{zig}L{x1-4} {top+3}L{x1-4} {top+18}Z" fill="{color}"/>'
    s = shadow(cx, y1 + 2, w * .55)
    s += f'<path d="{body}" fill="{color}"/>{crimp}'
    s += f'<rect x="{x0+4}" y="{top+14}" width="{w-8}" height="5" fill="#000" opacity=".12"/>'
    if window:
        wy, wh = top + h * .62, h * .26
        s += (f'<clipPath id="{pid}-win"><rect x="{cx-w*.3}" y="{wy}" width="{w*.6}" height="{wh}" rx="12"/></clipPath>'
              f'<rect x="{cx-w*.3}" y="{wy}" width="{w*.6}" height="{wh}" rx="12" fill="#fff8ee" opacity=".9"/>'
              f'<g clip-path="url(#{pid}-win)">{window(cx, wy + wh/2)}</g>'
              f'<rect x="{cx-w*.3}" y="{wy}" width="{w*.6}" height="{wh}" rx="12" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="2"/>')
    s += label(cx, top + 34, w * .78, title, hi, weight, accent)
    s += f'<path d="{body}" fill="url(#{pid}-gloss)"/>'
    return s

def box(pid, cx, top, w, h, color, accent, title, hi, weight, extra_top=''):
    x0 = cx - w / 2
    d = 16
    s = shadow(cx + 6, top + h + 2, w * .62)
    s += extra_top
    s += (f'<path d="M{x0} {top+d}L{x0+d} {top}L{x0+w+d} {top}L{x0+w} {top+d}Z" fill="{color}" opacity=".75"/>'
          f'<path d="M{x0+w} {top+d}L{x0+w+d} {top}L{x0+w+d} {top+h-d}L{x0+w} {top+h}Z" fill="#000" opacity=".25"/>'
          f'<path d="M{x0+w} {top+d}L{x0+w+d} {top}L{x0+w+d} {top+h-d}L{x0+w} {top+h}Z" fill="{color}" opacity=".7"/>'
          f'<rect x="{x0}" y="{top+d}" width="{w}" height="{h-d}" rx="3" fill="{color}"/>'
          f'<rect x="{x0}" y="{top+d}" width="{w}" height="{h-d}" rx="3" fill="url(#{pid}-gloss)"/>')
    s += label(cx, top + d + (h - d - 70) / 2, w * .84, title, hi, weight, accent)
    return s

def bottle(pid, cx, top, w, h, oil, accent, title, hi, weight):
    x0 = cx - w / 2
    neck = w * .34
    s = shadow(cx, top + h + 2, w * .7)
    s += (f'<linearGradient id="{pid}-oil" x1="0" x2="1"><stop offset="0" stop-color="{oil}"/><stop offset=".5" stop-color="#f4c94a"/><stop offset="1" stop-color="{oil}"/></linearGradient>'
          f'<rect x="{cx-neck/2-2}" y="{top-8}" width="{neck+4}" height="16" rx="4" fill="#2f7a35"/>'
          f'<path d="M{cx-neck/2} {top+8}L{cx+neck/2} {top+8}L{cx+neck/2} {top+34}Q{x0+w} {top+52} {x0+w} {top+84}L{x0+w} {top+h-10}'
          f'Q{x0+w} {top+h} {x0+w-12} {top+h}L{x0+12} {top+h}Q{x0} {top+h} {x0} {top+h-10}L{x0} {top+84}Q{x0} {top+52} {cx-neck/2} {top+34}Z" fill="url(#{pid}-oil)" stroke="#b8860b" stroke-opacity=".5"/>'
          f'<rect x="{x0+6}" y="{top+92}" width="{w-12}" height="76" rx="8" fill="#2f7a35"/>')
    s += label(cx, top + 95, w - 20, title, hi, weight, accent)
    s += f'<rect x="{x0+8}" y="{top+40}" width="10" height="{h-56}" rx="5" fill="#fff" opacity=".35"/>'
    return s

def sack(pid, cx, top, w, h, accent, title, hi, weight):
    x0, x1, y1 = cx - w / 2, cx + w / 2, top + h
    s = shadow(cx, y1 + 2, w * .6)
    s += (f'<path d="M{x0+10} {top+18}Q{cx} {top-4} {x1-10} {top+18}L{x1+4} {y1-20}Q{x1+2} {y1} {x1-24} {y1}L{x0+24} {y1}Q{x0-2} {y1} {x0-4} {y1-20}Z" fill="#e8d8b0"/>'
          f'<path d="M{x0+10} {top+18}Q{cx} {top-4} {x1-10} {top+18}L{x1+4} {y1-20}Q{x1+2} {y1} {x1-24} {y1}L{x0+24} {y1}Q{x0-2} {y1} {x0-4} {y1-20}Z" fill="url(#{pid}-gloss)"/>'
          f'<path d="M{x0+14} {top+16}Q{cx} {top+30} {x1-14} {top+16}" stroke="#b49a63" stroke-width="3" fill="none"/>'
          + ''.join(f'<path d="M{x0+8} {top+40+i*14}L{x1-6} {top+40+i*14}" stroke="#cdb98a" stroke-width="1" opacity=".6"/>' for i in range(int((h-50)/14))))
    s += label(cx, top + 48, w * .74, title, hi, weight, accent)
    s += f'<rect x="{cx-w*.3}" y="{top+h-46}" width="{w*.6}" height="22" rx="11" fill="{accent}"/><text x="{cx}" y="{top+h-31}" text-anchor="middle" font-family="{FONT}" font-size="11" font-weight="800" fill="#fff">100% CHAKKI</text>'
    return s

def jar(pid, cx, top, w, h, accent, title, hi, weight):
    x0 = cx - w / 2
    s = shadow(cx, top + h + 2, w * .62)
    s += (f'<rect x="{x0+6}" y="{top}" width="{w-12}" height="24" rx="6" fill="#5a3a1c"/>'
          f'<rect x="{x0}" y="{top+20}" width="{w}" height="{h-20}" rx="16" fill="#b9772f" opacity=".92"/>'
          f'<rect x="{x0}" y="{top+20}" width="{w}" height="{h-20}" rx="16" fill="url(#{pid}-gloss)"/>')
    s += label(cx, top + 48, w - 18, title, hi, weight, accent)
    return s

# ---------------------------------------------------------------- side props
def bowl(cx, cy, w, fill, rim='#8a5a2b'):
    return (shadow(cx, cy + 16, w * .55, 6, .15) +
            f'<path d="M{cx-w/2} {cy}Q{cx} {cy+38} {cx+w/2} {cy}Z" fill="{rim}"/>'
            f'<ellipse cx="{cx}" cy="{cy}" rx="{w/2}" ry="{w*.14}" fill="{fill}"/>'
            f'<ellipse cx="{cx}" cy="{cy-3}" rx="{w*.36}" ry="{w*.09}" fill="{fill}" opacity=".7"/>')

def wheat(x, y, r=0):
    grains = ''.join(f'<ellipse cx="{(-5 if i%2 else 5)}" cy="{-i*8}" rx="4.5" ry="8" fill="#d9a441" transform="rotate({-25 if i%2 else 25} {(-5 if i%2 else 5)} {-i*8})"/>' for i in range(7))
    return f'<g transform="translate({x},{y}) rotate({r})"><path d="M0 40L0-55" stroke="#b9862f" stroke-width="2.5"/>{grains}</g>'

def flower(x, y, c='#f2c200', s=1):
    petals = ''.join(f'<ellipse cx="0" cy="-7" rx="4.5" ry="7" fill="{c}" transform="rotate({a})"/>' for a in range(0, 360, 72))
    return f'<g transform="translate({x},{y}) scale({s})">{petals}<circle r="3.5" fill="#c46a00"/></g>'

def stick(x, y, r=0):
    return (f'<g transform="translate({x},{y}) rotate({r})"><rect x="-2" y="-60" width="4" height="70" rx="2" fill="#5a3a2a"/>'
            f'<rect x="-2" y="2" width="4" height="12" fill="#c9a36a"/></g>')

def smoke(x, y):
    return f'<path d="M{x} {y}C{x-10} {y-14} {x+10} {y-24} {x} {y-38}C{x-8} {y-50} {x+8} {y-58} {x+2} {y-70}" stroke="#8a8a8a" stroke-width="2.5" fill="none" opacity=".5" stroke-linecap="round"/>'

def diya(x, y):
    return (f'<path d="M{x-22} {y}Q{x} {y+20} {x+22} {y}Q{x} {y+6} {x-22} {y}Z" fill="#b5522a"/>'
            f'<path d="M{x} {y-2}C{x-6} {y-12} {x-2} {y-22} {x} {y-26}C{x+3} {y-20} {x+6} {y-12} {x} {y-2}Z" fill="#ffb300"/>'
            f'<path d="M{x} {y-4}C{x-2} {y-10} {x} {y-15} {x} {y-17}C{x+2} {y-12} {x+2} {y-8} {x} {y-4}Z" fill="#fff3b0"/>')

def cone(x, y, r=0):
    return (f'<g transform="translate({x},{y}) rotate({r})"><path d="M-11-40L11-40L0 32Z" fill="#3f7d3a"/>'
            f'<path d="M-11-40L11-40L0 32Z" fill="url(#g-shine)" opacity=".5"/>'
            f'<rect x="-12" y="-46" width="24" height="9" rx="2" fill="#2b5c28"/><path d="M-5-30L2 20" stroke="#fff" stroke-opacity=".35" stroke-width="2"/></g>')

def thali(pid, cx, cy):
    s = shadow(cx, cy + 46, 120, 12, .2)
    s += (f'<radialGradient id="{pid}-cu" cx="45%" cy="40%" r="65%"><stop offset="0" stop-color="#f6b183"/><stop offset=".6" stop-color="#d0743d"/><stop offset="1" stop-color="#9a4a1f"/></radialGradient>'
          f'<ellipse cx="{cx}" cy="{cy}" rx="130" ry="48" fill="url(#{pid}-cu)"/>'
          f'<ellipse cx="{cx}" cy="{cy-3}" rx="112" ry="39" fill="none" stroke="#fbd0ae" stroke-width="2" opacity=".7"/>'
          + bowl(cx - 62, cy - 10, 40, '#d81b3a', '#a8642e') + bowl(cx + 62, cy - 10, 40, '#f2b705', '#a8642e')
          + bowl(cx + 4, cy + 12, 36, '#fff', '#a8642e')
          + diya(cx - 6, cy - 16)
          + ''.join(flower(cx + dx, cy + dy, '#ff8f00', .8) for dx, dy in [(-96, 6), (92, 10), (-30, 22), (40, 24)]))
    return s

def gift(pid, cx, top, w, h, accent, title, hi, weight):
    s = box(pid, cx, top, w, h, '#f2b705', accent, title, hi, weight)
    x0 = cx - w / 2
    s += (f'<rect x="{x0+w*.12}" y="{top+16}" width="10" height="{h-16}" fill="#c4161c" opacity=".9"/>'
          f'<path d="M{cx} {top+4}C{cx-30} {top-24} {cx-40} {top+6} {cx} {top+12}C{cx+40} {top+6} {cx+30} {top-24} {cx} {top+4}Z" fill="#c4161c"/>')
    return s

# ---------------------------------------------------------------- products
random.seed(7)
P = {}

def make(pid, cat, inner):
    P[pid] = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" role="img">{bg(pid, cat)}{inner}</svg>'

A = lambda cat: CAT[cat][2]

make('gond-250', 'preg', pouch('gond-250', 175, 40, 150, 210, '#d08a2e', A('preg'), 'Gond', 'गोंद', '250 g', window=lambda x, y: pile(crystal, x, y, 14, (40, 14)))
     + pile(crystal, 300, 248, 9, (34, 8)))
make('kamarkas-100', 'preg', pouch('kamarkas-100', 175, 40, 150, 210, '#8b3a2a', A('preg'), 'Kamarkas', 'कमरकस', '100 g', window=lambda x, y: pile(flake, x, y, 14, (40, 14)))
     + pile(flake, 300, 250, 8, (34, 8)))
make('panjiri-500', 'preg', pouch('panjiri-500', 165, 40, 150, 210, '#d9a441', A('preg'), 'Panjiri', 'पंजीरी', '500 g')
     + bowl(305, 236, 92, '#e9cf96') + pile(almond, 305, 232, 4, (26, 4), s=.6))
make('kapur-50', 'pooja', box('kapur-50', 165, 70, 150, 175, '#2f64b0', A('pooja'), 'Kapur', 'कपूर', '50 g')
     + ''.join(tablet(290 + dx, 250 + dy, .95) for dx, dy in [(0, 0), (26, 4), (12, -12), (44, -6)]))
make('dhoop-20', 'pooja', ''.join(stick(150 + i * 14, 92, -6 + i * 4) for i in range(5)) + smoke(178, 34) + smoke(206, 40)
     + box('dhoop-20', 175, 88, 170, 160, '#6a2c70', A('pooja'), 'Dhoop', 'धूप', '20 sticks'))
make('thali-set', 'pooja', thali('thali-set', 200, 175)
     + f'<text x="200" y="62" text-anchor="middle" font-family="{FONT}" font-size="22" font-weight="800" fill="{A("pooja")}">Pooja thali set</text>'
     + f'<text x="200" y="84" text-anchor="middle" font-family="{HI}" font-size="15" fill="#6b4a12">पूजा थाली · copper</text>')
make('haldi-kit', 'shaadi', gift('haldi-kit', 160, 78, 160, 170, A('shaadi'), 'Haldi rasam', 'हल्दी किट', '1 kit')
     + bowl(310, 236, 80, '#f2b705', '#b5652a') + flower(282, 262, '#ff8f00', .9) + flower(340, 262, '#ff8f00', .9))
make('mehndi-12', 'shaadi', '<defs><linearGradient id="g-shine" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset=".4" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>'
     + shadow(200, 262, 120) + ''.join(cone(120 + i * 32, 190 + (i % 2) * 8, -14 + i * 5) for i in range(6))
     + f'<rect x="96" y="66" width="208" height="62" rx="12" fill="#fffdf8" stroke="{A("shaadi")}" stroke-opacity=".35"/>'
     + f'<text x="200" y="92" text-anchor="middle" font-family="{FONT}" font-size="18" font-weight="800" fill="#2a1a10">Mehndi cones</text>'
     + f'<text x="200" y="114" text-anchor="middle" font-family="{HI}" font-size="13" fill="#5b4636">मेहंदी · 12 cones</text>')
make('kaju-500', 'dry', pouch('kaju-500', 170, 40, 150, 210, '#b5651d', A('dry'), 'Kaju W320', 'काजू', '500 g', window=lambda x, y: pile(cashew, x, y, 10, (40, 10), s=.9))
     + pile(cashew, 305, 248, 8, (36, 8)))
make('badam-500', 'dry', pouch('badam-500', 170, 40, 150, 210, '#7a4a2a', A('dry'), 'Badam', 'बादाम', '500 g', window=lambda x, y: pile(almond, x, y, 12, (40, 10), s=.85))
     + pile(almond, 305, 248, 9, (36, 8)))
make('kishmish-250', 'dry', pouch('kishmish-250', 170, 40, 150, 210, '#7d2f5c', A('dry'), 'Kishmish', 'किशमिश', '250 g', window=lambda x, y: pile(raisin, x, y, 16, (42, 12)))
     + pile(raisin, 305, 250, 10, (34, 8)))
make('atta-5kg', 'home', sack('atta-5kg', 170, 46, 170, 206, A('home'), 'Chakki atta', 'चक्की आटा', '5 kg')
     + wheat(312, 236, 12) + wheat(334, 240, 24) + wheat(296, 244, -4))
make('sarson-1l', 'home', bottle('sarson-1l', 170, 42, 112, 212, '#d4a017', A('home'), 'Sarson tel', 'सरसों तेल', '1 L')
     + ''.join(flower(300 + dx, 236 + dy, '#f2c200', 1.1) for dx, dy in [(0, 0), (28, 10), (14, -22), (46, -12)])
     + '<path d="M300 236L300 270M328 246L330 272M314 214L316 270" stroke="#4f8a3c" stroke-width="2.5"/>')
make('chai-250', 'home', pouch('chai-250', 170, 40, 150, 210, '#1f6b4a', A('home'), 'Chai patti', 'चाय पत्ती', '250 g', window=lambda x, y: ''.join(leaf_bit(x + (random.random()-.5)*90, y + (random.random()-.5)*30, random.randint(0, 180)) for _ in range(60)))
     + bowl(308, 236, 78, '#3d2a14', '#7a4a2a'))
make('namak-1kg', 'home', pouch('namak-1kg', 170, 40, 150, 210, '#2b6cb0', A('home'), 'Namak', 'नमक', '1 kg', window=lambda x, y: ''.join(salt(x + (random.random()-.5)*90, y + (random.random()-.5)*30) for _ in range(40)))
     + bowl(308, 236, 78, '#ffffff', '#7a8aa0'))
make('shatavari-100', 'preg', jar('shatavari-100', 170, 66, 130, 182, A('preg'), 'Shatavari', 'शतावरी', '100 g')
     + bowl(305, 238, 80, '#e6d3a8') + '<path d="M286 262C300 250 318 266 336 256" stroke="#8a6a3a" stroke-width="5" fill="none" stroke-linecap="round"/>')

ts = ['/**',
      ' * Original illustrations for the sample catalogue (generated by scripts/gen-product-art.py — edit there).',
      ' * Not photos: drawn from scratch so the shop owns them. Real product photos uploaded later go in',
      ' * ProductInfo.images and take priority.',
      ' */',
      'export const PRODUCT_ART: Record<string, string> = {']
for k, v in P.items():
    ts.append(f'  {json.dumps(k)}: {json.dumps(v, ensure_ascii=False)},')
ts += ['};', '',
       '/** SVG markup for a product, or null when there is no drawing for it. */',
       'export function productArt(productId: string): string | null {',
       '  return PRODUCT_ART[productId] ?? null;',
       '}', '',
       '/** Same, as a data: URL for <img src>. */',
       'export function productArtUrl(productId: string): string | null {',
       '  const s = PRODUCT_ART[productId];',
       "  return s ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}` : null;",
       '}', '']
pathlib.Path('packages/client/src/productArt.ts').write_text('\n'.join(ts), encoding='utf-8')
out = pathlib.Path('/tmp/art'); out.mkdir(exist_ok=True)
for k, v in P.items(): (out / f'{k}.svg').write_text(v, encoding='utf-8')
print(len(P), 'products drawn')
