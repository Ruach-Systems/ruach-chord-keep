"""Deterministic, local SVG/native-resource exports of the approved product identity.

Run from any directory: python source/build_assets.py
No application resources, parent-brand resources, or approved references are edited.
"""
from pathlib import Path
import hashlib
import io
import json
import math
import struct
import xml.etree.ElementTree as ET
import zipfile

import numpy as np
from PIL import Image
import resvg_py
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.svgLib.path import parse_path
from fontTools.pens.reportLabPen import ReportLabPen
from reportlab.pdfgen import canvas
from reportlab.graphics.shapes import Drawing
from reportlab.graphics import renderPDF
from reportlab.lib.colors import HexColor

ROOT = Path(__file__).resolve().parent.parent
G = json.loads((ROOT / 'source/geometry.json').read_text(encoding='utf-8'))
C = {'crimson': '#B21F32', 'obsidian': '#141821', 'aubergine': '#321C3B',
     'ivory': '#F7F3ED', 'white': '#FFFFFF', 'black': '#000000'}
MW, MH = G['width'], G['height']
NS = '{http://www.w3.org/2000/svg}'
DIMENSIONS = {}
GEOMETRY = {}


def write(rel, content):
    p = ROOT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding='utf-8', newline='\n')
    return p


def jsonwrite(rel, data):
    return write(rel, json.dumps(data, indent=2, ensure_ascii=False) + '\n')


def string_path(x, top):
    r = G['stringWidth'] / 2
    bottom = G['stringBottom']
    k = .5522847498 * r
    # Filled path with a semicircular top; its bottom overlaps the bowl.
    return (f'M{x-r} {bottom} V{top+r} '
            f'C{x-r} {top+r-k} {x-k} {top} {x} {top} '
            f'C{x+k} {top} {x+r} {top+r-k} {x+r} {top+r} '
            f'V{bottom} Z')


PATH = G['body'] + ' ' + ' '.join(string_path(s['x'], s['top']) for s in G['strings'])


def svg(body, width=1024, height=1024, title='Chord Library — Sovereign Strings'):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
            f'viewBox="0 0 {width} {height}" role="img" aria-label="{title}">'
            f'<title>{title}</title>{body}</svg>\n')


def mark(color, x=0, y=0, height=1000):
    return (f'<path fill="{color}" fill-rule="nonzero" d="{PATH}" '
            f'transform="translate({x:.6f} {y:.6f}) scale({height/MH:.9f})"/>')


def centered_mark(color, width=1024, height=1024, ratio=.72):
    h = min(width, height) * ratio
    return mark(color, (width-h*MW/MH)/2, (height-h)/2, h)


def icon(bg=C['crimson'], fg=C['white'], ratio=.72, radius=0, inset=0):
    plate = '' if bg is None else (f'<rect x="{inset}" y="{inset}" '
        f'width="{1024-2*inset}" height="{1024-2*inset}" rx="{radius}" fill="{bg}"/>')
    return svg(plate + centered_mark(fg, ratio=ratio))


def render(content, width):
    data = resvg_py.svg_to_bytes(svg_string=content, width=width)
    return Image.open(io.BytesIO(data)).convert('RGBA')


def png(rel, content, width, opaque=False):
    p = ROOT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    im = render(content, width)
    if opaque:
        assert im.getchannel('A').getextrema() == (255, 255), rel
        im = im.convert('RGB')
    im.save(p, optimize=True)
    node = ET.fromstring(content)
    expected_height = math.ceil(width * float(node.attrib['height']) / float(node.attrib['width']))
    assert im.size == (width, expected_height), (rel, im.size, (width, expected_height))
    DIMENSIONS[rel] = {'size': [width, expected_height], 'opaque': opaque}
    return p


FONT = TTFont(ROOT / 'fonts/Manrope-800.ttf')
GS = FONT.getGlyphSet()
CM = FONT.getBestCmap()
UNITS = FONT['head'].unitsPerEm


def text_paths(text, size, x=0, baseline=0, color=C['obsidian']):
    cursor = x
    body = []
    for ch in text:
        glyph = CM[ord(ch)]
        pen = SVGPathPen(GS)
        GS[glyph].draw(TransformPen(pen, (size/UNITS, 0, 0, -size/UNITS, cursor, baseline)))
        body.append(f'<path fill="{color}" d="{pen.getCommands()}"/>')
        cursor += FONT['hmtx'][glyph][0] * size/UNITS
    return ''.join(body), cursor-x


def pdf_mark(rel, color):
    p = ROOT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    page = canvas.Canvas(str(p), pagesize=(600, 600), invariant=1)
    page.setTitle('Chord Library — Sovereign Strings')
    page.translate(120, 525)
    page.scale(.45, -.45)
    page.setFillColor(color)
    pen = ReportLabPen(None)
    parse_path(PATH, pen)
    pen.path.fillColor = HexColor(color)
    pen.path.strokeColor = None
    pen.path.fillMode = 1
    drawing = Drawing(MW, MH)
    drawing.add(pen.path)
    renderPDF.draw(drawing, page, 0, 0)
    page.showPage()
    page.save()


def ico(rel, sizes, content):
    # Render every frame directly from the SVG, not by resizing another PNG.
    frames = []
    for size in sizes:
        b = io.BytesIO()
        render(content, size).save(b, format='PNG')
        frames.append((size, b.getvalue()))
    offset = 6 + 16 * len(frames)
    entries = []
    for size, data in frames:
        entries.append(struct.pack('<BBBBHHII', size % 256, size % 256, 0, 0, 1, 32,
                                   len(data), offset))
        offset += len(data)
    p = ROOT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(struct.pack('<HHH', 0, 1, len(frames)) + b''.join(entries)
                  + b''.join(data for _, data in frames))


def production_assets():
    write('source/master.svg', svg(mark(C['crimson'], 200, 100), 1200, 1200))
    jsonwrite('colors.json', C)
    for name, color in C.items():
        doc = icon(None, color, ratio=.84)
        write(f'assets/symbol-{name}.svg', doc)
        for size in [256, 512, 1024, 2048]:
            png(f'assets/symbol-{name}-{size}.png', doc, size)
        pdf_mark(f'assets/symbol-{name}.pdf', color)
    for name, bg, fg in [('crimson', C['crimson'], C['white']),
                         ('obsidian', C['obsidian'], C['white']),
                         ('ivory', C['ivory'], C['crimson']),
                         ('aubergine', C['aubergine'], C['white'])]:
        doc = icon(bg, fg)
        write(f'assets/app-{name}.svg', doc)
        for size in [16, 20, 24, 32, 40, 48, 64, 96, 128, 192, 256, 512, 1024, 2048]:
            png(f'assets/app-{name}-{size}.png', doc, size, opaque=True)
        write(f'previews/app-{name}-rounded.svg', icon(bg, fg, radius=220))
        png(f'previews/app-{name}-rounded-512.png', icon(bg, fg, radius=220), 512)
    for name, mc, tc in [('primary', C['crimson'], C['obsidian']),
                         ('white', C['white'], C['white']),
                         ('obsidian', C['obsidian'], C['obsidian']),
                         ('crimson', C['crimson'], C['crimson'])]:
        word, ww = text_paths('Chord Library', 82, 160, 99, tc)
        horizontal = svg(mark(mc, 20, 20, 110) + word, math.ceil(ww+180), 150)
        word, sw = text_paths('Chord Library', 72, 0, 0, tc)
        width = math.ceil(sw + 64)
        word, _ = text_paths('Chord Library', 72, 32, 405, tc)
        stacked = svg(mark(mc, (width-224)/2, 28, 280) + word, width, 447)
        for layout, doc in [('horizontal', horizontal), ('stacked', stacked)]:
            write(f'assets/{layout}-{name}.svg', doc)
            for size in [512, 1024, 2048]:
                png(f'assets/{layout}-{name}-{size}.png', doc, size)
    word, ww = text_paths('Chord Library', 100, 12, 108)
    write('assets/wordmark-obsidian.svg', svg(word, math.ceil(ww+24), 142))


def web_assets():
    folder = 'platforms/web'
    write(f'{folder}/favicon.svg', icon(radius=210, ratio=.80))
    ico(f'{folder}/favicon.ico', [16, 32, 48, 64], icon(radius=210, ratio=.80))
    for size in [16, 32, 48, 64]:
        png(f'{folder}/favicon-{size}.png', icon(radius=210, ratio=.80), size)
    entries = []
    for size in [192, 512, 1024]:
        for suffix, ratio, purpose in [('', .72, 'any'), ('-maskable', .70, 'maskable')]:
            name = f'icon{suffix}-{size}.png'
            png(f'{folder}/{name}', icon(ratio=ratio), size, opaque=True)
            entries.append({'src': name, 'sizes': f'{size}x{size}', 'type': 'image/png', 'purpose': purpose})
    png(f'{folder}/apple-touch-icon.png', icon(), 180, opaque=True)
    write(f'{folder}/safari-pinned-tab.svg', icon(None, C['black'], ratio=.84))
    jsonwrite(f'{folder}/manifest.webmanifest', {
        'name': 'Chord Library', 'short_name': 'Chord Library', 'start_url': './',
        'display': 'standalone', 'background_color': '#16213E',
        'theme_color': C['crimson'], 'icons': entries})
    write(f'{folder}/head-snippet.html', '''<!-- Adjust /branding/ paths and merge with the existing manifest. -->
<link rel="icon" href="/branding/favicon.ico" sizes="any">
<link rel="icon" href="/branding/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/branding/apple-touch-icon.png">
<link rel="mask-icon" href="/branding/safari-pinned-tab.svg" color="#B21F32">
<link rel="manifest" href="/branding/manifest.webmanifest">
<meta name="theme-color" content="#B21F32">
''')


def android_assets():
    folder = 'platforms/android'
    h = 60
    scale = h/MH
    x, y = (108-MW*scale)/2, (108-h)/2
    vector = (f'<?xml version="1.0" encoding="utf-8"?>\n'
        f'<vector xmlns:android="http://schemas.android.com/apk/res/android" '
        f'android:width="108dp" android:height="108dp" '
        f'android:viewportWidth="108" android:viewportHeight="108">'
        f'<group android:scaleX="{scale}" android:scaleY="{scale}" '
        f'android:translateX="{x}" android:translateY="{y}">'
        f'<path android:fillColor="#FFFFFF" android:fillType="nonZero" android:pathData="{PATH}"/>'
        '</group></vector>\n')
    for name in ['chord_library_foreground', 'chord_library_monochrome']:
        write(f'{folder}/res/drawable/{name}.xml', vector)
    write(f'{folder}/res/drawable/chord_library_background.xml', '''<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
  <solid android:color="#B21F32"/>
</shape>
''')
    for api in [26, 33]:
        mono = '\n  <monochrome android:drawable="@drawable/chord_library_monochrome"/>' if api == 33 else ''
        doc = (f'<?xml version="1.0" encoding="utf-8"?>\n'
            f'<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
            '  <background android:drawable="@drawable/chord_library_background"/>\n'
            f'  <foreground android:drawable="@drawable/chord_library_foreground"/>{mono}\n'
            '</adaptive-icon>\n')
        for name in ['ic_launcher', 'ic_launcher_round']:
            write(f'{folder}/res/mipmap-anydpi-v{api}/{name}.xml', doc)
    for density, size in [('ldpi', 36), ('mdpi', 48), ('hdpi', 72), ('xhdpi', 96),
                          ('xxhdpi', 144), ('xxxhdpi', 192)]:
        png(f'{folder}/res/mipmap-{density}/ic_launcher.png', icon(radius=190), size)
        doc = svg('<circle cx="512" cy="512" r="512" fill="#B21F32"/>'
                  + centered_mark(C['white'], ratio=.70))
        png(f'{folder}/res/mipmap-{density}/ic_launcher_round.png', doc, size)
    foreground = svg(mark(C['white'], x, y, h), 108, 108)
    write(f'{folder}/adaptive-foreground.svg', foreground)
    write(f'{folder}/adaptive-background.svg', svg('<rect width="108" height="108" fill="#B21F32"/>', 108, 108))
    for density, size in [('mdpi', 108), ('hdpi', 162), ('xhdpi', 216), ('xxhdpi', 324), ('xxxhdpi', 432)]:
        png(f'{folder}/layers/{density}-foreground.png', foreground, size)
    png(f'{folder}/google-play-icon-512.png', icon(), 512, opaque=True)
    write(f'{folder}/manifest-snippet.xml', '<application xmlns:android="http://schemas.android.com/apk/res/android" android:icon="@mipmap/ic_launcher" android:roundIcon="@mipmap/ic_launcher_round"/>\n')
    GEOMETRY['android'] = {'svg': foreground, 'canvas': 108, 'safeRadius': 33}


def windows_assets():
    folder = 'platforms/windows'
    ico(f'{folder}/ChordLibrary.ico', [16, 20, 24, 32, 40, 48, 64, 96, 128, 256], icon(radius=195))
    for size in [16, 20, 24, 30, 32, 36, 40, 44, 48, 60, 64, 72, 80, 96, 128, 256]:
        for suffix in ['', '_altform-unplated', '_altform-lightunplated']:
            png(f'{folder}/Square44x44Logo.targetsize-{size}{suffix}.png', icon(radius=195), size)
    for name, w, h in [('Square44x44Logo', 44, 44), ('Square71x71Logo', 71, 71),
                        ('Square150x150Logo', 150, 150), ('Square310x310Logo', 310, 310),
                        ('StoreLogo', 50, 50), ('Wide310x150Logo', 310, 150), ('SplashScreen', 620, 300)]:
        for scale in [100, 125, 150, 200, 400]:
            width, height = math.ceil(w*scale/100), math.ceil(h*scale/100)
            doc = svg(f'<rect width="{width}" height="{height}" fill="#B21F32"/>'
                      + centered_mark(C['white'], width, height, .72 if name != 'SplashScreen' else .5), width, height)
            png(f'{folder}/{name}.scale-{scale}.png', doc, width, opaque=True)
    write(f'{folder}/manifest-snippet.xml', r'''<!-- Merge paths into existing package manifest; do not replace the manifest. -->
<uap:VisualElements xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  DisplayName="Chord Library" Description="Songs, chords and setlists"
  BackgroundColor="#B21F32"
  Square44x44Logo="Assets\Square44x44Logo.png"
  Square150x150Logo="Assets\Square150x150Logo.png">
  <uap:DefaultTile Square71x71Logo="Assets\Square71x71Logo.png"
    Wide310x150Logo="Assets\Wide310x150Logo.png" Square310x310Logo="Assets\Square310x310Logo.png"/>
  <uap:SplashScreen Image="Assets\SplashScreen.png" BackgroundColor="#B21F32"/>
</uap:VisualElements>
''')


def apple_assets():
    folder = 'platforms/apple'
    entries = []
    for name, appearance, bg, fg in [('Light', None, C['crimson'], C['white']),
                                    ('Dark', 'dark', C['obsidian'], C['white']),
                                    ('Tinted', 'tinted', '#FFFFFF', '#000000')]:
        filename = f'ChordLibrary-{name}-1024.png'
        png(f'{folder}/AppIcon.appiconset/{filename}', icon(bg, fg), 1024, opaque=True)
        entry = {'filename': filename, 'idiom': 'universal', 'platform': 'ios', 'size': '1024x1024'}
        if appearance:
            entry['appearances'] = [{'appearance': 'luminosity', 'value': appearance}]
        entries.append(entry)
    jsonwrite(f'{folder}/AppIcon.appiconset/Contents.json', {'images': entries, 'info': {'author': 'xcode', 'version': 1}})
    # Alternative classic catalog for existing Xamarin/older Xcode projects.
    classic = []
    for idiom, point, scales in [('iphone', 20, [2, 3]), ('iphone', 29, [2, 3]),
        ('iphone', 40, [2, 3]), ('iphone', 60, [2, 3]), ('ipad', 20, [1, 2]),
        ('ipad', 29, [1, 2]), ('ipad', 40, [1, 2]), ('ipad', 76, [1, 2]),
        ('ipad', 83.5, [2]), ('ios-marketing', 1024, [1])]:
        for scale in scales:
            size = round(point*scale)
            filename = f'icon-{size}.png'
            png(f'{folder}/legacy/AppIcon.appiconset/{filename}', icon(), size, opaque=True)
            classic.append({'filename': filename, 'idiom': idiom, 'size': f'{point}x{point}', 'scale': f'{scale}x'})
    jsonwrite(f'{folder}/legacy/AppIcon.appiconset/Contents.json', {'images': classic, 'info': {'author': 'xcode', 'version': 1}})
    write(f'{folder}/composer-source/foreground.svg', icon(None))
    png(f'{folder}/composer-source/foreground.png', icon(None), 1024)
    write(f'{folder}/composer-source/background.svg', svg('<rect width="1024" height="1024" fill="#B21F32"/>'))
    png(f'{folder}/composer-source/background.png', icon(ratio=0), 1024, opaque=True)
    write(f'{folder}/composer-source/README.txt', 'Editable foreground/background sources for Apple Icon Composer. No compiled .icon bundle is supplied. Import and validate in Xcode on macOS.\n')
    folder = 'platforms/macos'
    doc = icon(ratio=.62, radius=185, inset=85)
    entries = []
    for base in [16, 32, 128, 256, 512]:
        for scale in [1, 2]:
            filename = f'icon_{base}x{base}' + ('@2x' if scale == 2 else '') + '.png'
            png(f'{folder}/ChordLibrary.iconset/{filename}', doc, base*scale)
            png(f'{folder}/AppIcon.appiconset/{filename}', doc, base*scale)
            entries.append({'filename': filename, 'idiom': 'mac', 'size': f'{base}x{base}', 'scale': f'{scale}x'})
    jsonwrite(f'{folder}/AppIcon.appiconset/Contents.json', {'images': entries, 'info': {'author': 'xcode', 'version': 1}})
    chunks = []
    for code, size in [('icp4', 16), ('icp5', 32), ('icp6', 64), ('ic07', 128),
                       ('ic08', 256), ('ic09', 512), ('ic10', 1024), ('ic11', 32),
                       ('ic12', 64), ('ic13', 256), ('ic14', 512)]:
        b = io.BytesIO()
        render(doc, size).save(b, format='PNG')
        data = b.getvalue()
        chunks.append(code.encode() + struct.pack('>I', len(data)+8) + data)
    data = b''.join(chunks)
    (ROOT / folder / 'ChordLibrary.icns').write_bytes(b'icns' + struct.pack('>I', len(data)+8) + data)


def other_assets():
    folder = 'platforms/dotnet-maui'
    write(f'{folder}/appicon.svg', svg('<rect width="1024" height="1024" fill="#B21F32"/>'))
    write(f'{folder}/appiconfg.svg', icon(None))
    write(f'{folder}/splash.svg', icon(None))
    # Android foreground is smaller in its full 108dp viewport than regular square masters.
    write(f'{folder}/project-snippet.xml', '''<!-- Merge these ItemGroups into the existing project; replace existing icon/splash entries. -->
<Project>
<ItemGroup>
  <MauiIcon Include="Resources/AppIcon/appicon.svg" ForegroundFile="Resources/AppIcon/appiconfg.svg" Color="#B21F32" />
  <MauiSplashScreen Include="Resources/Splash/splash.svg" Color="#B21F32" BaseSize="256,256" />
</ItemGroup>
<ItemGroup Condition="$([MSBuild]::GetTargetPlatformIdentifier('$(TargetFramework)')) == 'android'">
  <MauiIcon Update="Resources/AppIcon/appicon.svg" ForegroundScale="0.77160494" />
</ItemGroup>
</Project>
''')
    for size in [16, 24, 32, 48, 64, 128, 256, 512]:
        png(f'platforms/linux/hicolor/{size}x{size}/apps/chord-library.png', icon(radius=195), size)
    write('platforms/linux/hicolor/scalable/apps/chord-library.svg', icon(radius=195))
    write('platforms/linux/chord-library.desktop.example', '''[Desktop Entry]
Type=Application
Name=Chord Library
Comment=Songs, chords and setlists
Exec=/path/to/chord-library
Icon=chord-library
Terminal=false
Categories=AudioVideo;Music;
''')


def previews():
    def label(text, size, x, y, color=C['obsidian']):
        return text_paths(text, size, x, y, color)[0]
    body = '<rect width="1600" height="1200" fill="#F7F3ED"/>'
    body += label('Chord Library', 24, 64, 55, C['crimson'])
    body += label('Sovereign Strings', 60, 64, 130)
    body += label('Production vector and platform assets', 24, 64, 173)
    body += mark(C['crimson'], 130, 220, 450)
    body += label('Single vector master', 23, 108, 719)
    for i, (name, bg, fg) in enumerate([('Crimson', C['crimson'], C['white']),
                                      ('Obsidian', C['obsidian'], C['white']),
                                      ('Ivory', C['ivory'], C['crimson'])]):
        x = 680+i*280
        body += f'<rect x="{x}" y="240" width="230" height="230" rx="48" fill="{bg}"/>'
        body += mark(fg, x+(230-230*.72*.8)/2, 240+230*.14, 230*.72)
        body += label(name, 21, x+18, 510)
    body += label('Actual small-size exports (view at 100%)', 23, 680, 568)
    for i, size in enumerate([16, 24, 32, 48, 64]):
        x = 695+i*140
        body += f'<rect x="{x}" y="600" width="{size}" height="{size}" rx="{size*.19}" fill="#B21F32"/>'
        body += mark(C['white'], x+size*.212, 600+size*.14, size*.72)
        body += label(f'{size} px', 18, x-5, 706)
    body += '<rect x="64" y="786" width="1472" height="290" rx="20" fill="#FFFFFF"/>'
    body += label('Android mask previews', 23, 90, 832)
    for i, radius in enumerate([112, 48, 12]):
        x = 102+i*256
        body += f'<rect x="{x}" y="862" width="168" height="168" rx="{min(radius,84)}" fill="#B21F32"/>'
        body += mark(C['white'], x+(168-168*(60/72)*.8)/2, 862+168*(1-60/72)/2, 168*(60/72))
    body += label('Included formats', 23, 940, 846)
    for i, line in enumerate(['SVG / PNG / PDF', 'ICO / ICNS / native XML', 'Apple catalogs / MAUI sources', 'Web / PWA / Linux resources']):
        body += label(line, 20, 940, 895+i*40)
    body += label('Flat color. Outlined wordmarks. One geometry for every platform.', 20, 64, 1142)
    doc = svg(body, 1600, 1200, 'Sovereign Strings — actual production asset preview')
    write('previews/asset-preview.svg', doc)
    png('previews/asset-preview.png', doc, 1600, opaque=True)
    cards = []
    for name in ['crimson', 'obsidian', 'ivory', 'aubergine']:
        cards.append(f'<figure><img src="../assets/app-{name}-512.png" alt="{name} icon"><figcaption>{name}</figcaption></figure>')
    write('previews/index.html', '''<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Sovereign Strings asset kit</title>
<style>body{margin:0;background:#F7F3ED;color:#141821;font:16px system-ui}main{max-width:1100px;margin:auto;padding:32px}
h1{font-size:clamp(32px,5vw,56px)}.hero{width:100%}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:24px}
figure{margin:0;padding:20px;background:white;border-radius:16px}img{max-width:100%}figcaption{margin-top:12px;text-transform:capitalize}
.sizes{display:flex;gap:24px;align-items:end;flex-wrap:wrap}.sizes img{image-rendering:auto}a{color:#B21F32}code{overflow-wrap:anywhere}</style>
<main><h1>Chord Library · Sovereign Strings</h1><p>Approved concept rebuilt as one scalable vector master. These are actual exports, not AI mockups.</p>
<img class="hero" src="asset-preview.png" alt="Production asset preview"><h2>Color treatments</h2><div class="grid">'''
        + ''.join(cards) + '</div><h2>Native pixel sizes</h2><p>Keep browser zoom at 100% to inspect these without enlargement.</p><div class="sizes">'
        + ''.join(f'<figure><img width="{s}" height="{s}" src="../assets/app-crimson-{s}.png" alt="{s} pixel icon"><figcaption>{s} px</figcaption></figure>' for s in [16, 20, 24, 32, 48, 64, 96])
        + '</div><h2>Logo treatments</h2><figure><img src="../assets/horizontal-primary.svg" alt="Horizontal logo"></figure>'
        + '<p><a href="../README.md">Usage and platform instructions</a> · <a href="../validation.json">Validation results</a> · <a href="../inventory.json">Asset inventory</a></p></main></html>\n')


def validate():
    checks = []
    def check(name, passed, details=None):
        checks.append({'check': name, 'passed': bool(passed), 'details': details})
        if not passed:
            raise AssertionError(name + ': ' + str(details))
    check('Five symmetrically spaced strings', len(G['strings']) == 5
          and [s['x'] for s in G['strings']] == [MW-s['x'] for s in G['strings']][::-1])
    alpha = np.array(render(icon(None, C['white'], ratio=.84), 1200).getchannel('A'))
    delta = np.abs(alpha.astype(int)-alpha[:, ::-1].astype(int))
    mismatch = np.count_nonzero((alpha > 127) != (alpha[:, ::-1] > 127))
    fraction = mismatch / np.count_nonzero(alpha > 127)
    # resvg antialiases opposing path edges differently by a fraction of a pixel.
    check('Bilateral symmetry within raster antialiasing tolerance',
          fraction < .0005 and float(delta.mean()) < .02,
          {'binaryMismatchFraction': float(fraction), 'meanAlphaDifferenceOf255': float(delta.mean())})
    from scipy.ndimage import label as components
    _, count = components(alpha > 127)
    check('One connected crown, lyre and strings', count == 1, {'components': count})
    band = alpha[round(1200*(.08+.84*.65))] > 127
    runs = np.count_nonzero(band & ~np.concatenate(([False], band[:-1])))
    check('Five distinct strings between two outer arms', runs == 7, {'solidRunsAcrossBody': int(runs)})
    for name, color in C.items():
        im = np.array(render(icon(None, color, ratio=.84), 1024))
        inside = im[:, :, 3] == 255
        expected = tuple(int(color[i:i+2], 16) for i in [1, 3, 5])
        check(f'Flat {name} fill', np.all(im[:, :, :3][inside] == expected))
    for rel, expected in DIMENSIONS.items():
        with Image.open(ROOT / rel) as im:
            im.load()
            alpha_ok = (im.mode == 'RGB') if expected['opaque'] else (
                im.mode == 'RGBA' and im.getchannel('A').getextrema() == (0, 255))
            check('PNG ' + rel, list(im.size) == expected['size'] and alpha_ok)
    svg_count = 0
    for p in ROOT.rglob('*.svg'):
        root = ET.parse(p).getroot()
        check('No raster/font dependency ' + str(p.relative_to(ROOT)), not list(root.iter(NS+'image')) and not list(root.iter(NS+'text')))
        svg_count += 1
    for p in ROOT.rglob('*.xml'):
        ET.parse(p)
    check('Native XML parses', True)
    for p in ROOT.rglob('Contents.json'):
        data = json.loads(p.read_text())
        for item in data['images']:
            with Image.open(p.parent / item['filename']) as im:
                point = float(item['size'].split('x')[0])
                scale = float(item.get('scale', '1x').rstrip('x'))
                check('Catalog ' + str(p.parent.relative_to(ROOT)) + '/' + item['filename'], im.size == (round(point*scale),)*2)
    with Image.open(ROOT / 'platforms/windows/ChordLibrary.ico') as im:
        sizes = {s[0] for s in im.ico.sizes()}
        check('ICO frame sizes', sizes == {16, 20, 24, 32, 40, 48, 64, 96, 128, 256}, sorted(sizes))
        for size in sizes:
            check(f'ICO frame {size} decodes', im.ico.getimage((size, size)).size == (size, size))
    data = (ROOT / 'platforms/macos/ChordLibrary.icns').read_bytes()
    check('ICNS header and byte length', data[:4] == b'icns' and struct.unpack('>I', data[4:8])[0] == len(data))
    offset, chunks = 8, []
    while offset < len(data):
        code = data[offset:offset+4].decode()
        length = struct.unpack('>I', data[offset+4:offset+8])[0]
        with Image.open(io.BytesIO(data[offset+8:offset+length])) as im:
            im.load()
            chunks.append({'type': code, 'size': list(im.size)})
        offset += length
    check('ICNS PNG chunks decode', offset == len(data) and len(chunks) == 11, chunks)
    with Image.open(ROOT / 'platforms/macos/ChordLibrary.icns') as im:
        im.load()
        check('ICNS opens in Pillow', im.width == 1024 and im.height == 1024)
    for name, doc, canvas_size, radius in [('Android 66dp circle', GEOMETRY['android']['svg'], 108, 33),
                                         ('PWA 80% diameter circle', icon(None, ratio=.70), 1024, 409.6)]:
        a = np.array(render(doc, canvas_size*4).getchannel('A'))
        yy, xx = np.nonzero(a > 0)
        distance = np.sqrt((xx+.5-a.shape[1]/2)**2 + (yy+.5-a.shape[0]/2)**2)/4
        check(name, float(distance.max()) < radius, {'maximumRadius': round(float(distance.max()), 3), 'safeRadius': radius})
    manifest = json.loads((ROOT / 'platforms/web/manifest.webmanifest').read_text())
    for entry in manifest['icons']:
        check('Web manifest ' + entry['src'], (ROOT/'platforms/web'/entry['src']).exists())
    result = {'kit': 'Chord Library — Sovereign Strings', 'version': '1.0', 'passed': True,
              'checksPassed': len(checks), 'pngCount': len(DIMENSIONS), 'svgCount': svg_count,
              'checks': checks, 'scope': 'Local export, structure, dimensions, color and geometry validation. Not native device, Xcode, store submission or app integration validation.'}
    jsonwrite('validation.json', result)
    return result


def inventory_and_zip():
    files = []
    for p in sorted(ROOT.rglob('*')):
        if p.is_file() and p.name != 'inventory.json' and '__pycache__' not in p.parts:
            data = p.read_bytes()
            files.append({'path': p.relative_to(ROOT).as_posix(), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    jsonwrite('inventory.json', {'version': '1.0', 'files': files})
    # ZIP remains in ignored build output; source kit and exact assets remain in Git.
    base = ROOT.parent.parent if ROOT.parent.name == 'branding' else ROOT.parent
    archive = base / 'artifacts/branding/Chord-Library-Sovereign-Strings-v1.zip'
    archive.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
        for p in sorted(ROOT.rglob('*')):
            if p.is_file() and '__pycache__' not in p.parts:
                info = zipfile.ZipInfo('Chord-Library-Sovereign-Strings/' + p.relative_to(ROOT).as_posix(), date_time=(2026, 10, 7, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                z.writestr(info, p.read_bytes())
    with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None
        assert len(z.namelist()) == len(files)+1
    return archive, len(files)+1


if __name__ == '__main__':
    production_assets()
    web_assets()
    android_assets()
    windows_assets()
    apple_assets()
    other_assets()
    previews()
    result = validate()
    archive, count = inventory_and_zip()
    print(json.dumps({'files': count, 'validationChecks': result['checksPassed'], 'pngs': result['pngCount'],
                      'svgs': result['svgCount'], 'archive': str(archive), 'preview': str(ROOT/'previews/asset-preview.png')}, indent=2))
