"""Controlla l'anteprima: niente scroll orizzontale, immagini rotte, errori in console, link interni rotti.
Con --foto salva gli screenshot in ../../screenshot-sito/. Uso: ~/.openclaw/.venv/bin/python3 strumenti/controlla.py [--foto] [base]"""
import sys, urllib.request
from pathlib import Path
from patchright.sync_api import sync_playwright

args = [a for a in sys.argv[1:] if not a.startswith('--')]
BASE = (args[0] if args else 'http://100.64.65.118:8119').rstrip('/')
FOTO = '--foto' in sys.argv
DIR = Path(__file__).resolve().parents[2] / 'screenshot-sito'
PAGINE = ['/', '/#bio', '/#cv', '/#contatti', '/progetti/', '/en/', '/en/#bio', '/en/#cv', '/en/#contatti', '/en/projects/', '/blog/', '/404.html']
ko = 0
with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox'])
    visti = set()
    for w in (390, 1024, 1440):
        for pg in PAGINE:
            t = b.new_page(viewport={'width': w, 'height': 900})
            err = []
            t.on('pageerror', lambda e: err.append(str(e)[:120]))
            t.on('console', lambda m: m.type == 'error' and err.append(m.text[:120]))
            t.goto(BASE + pg, wait_until='networkidle'); t.wait_for_timeout(900)
            r = t.evaluate('''() => ({larga: document.documentElement.scrollWidth,
              rotte: [...document.images].filter(i => i.complete && !i.naturalWidth).map(i => i.src),
              link: [...document.querySelectorAll('a[href^="/"]')].map(a => a.getAttribute('href').split('#')[0]).filter(Boolean)})''')
            for l in r['link']:
                if l in visti: continue
                visti.add(l)
                try: urllib.request.urlopen(BASE + l).status
                except Exception as e: err.append(f'link {l}: {e}')
            ok = r['larga'] <= w and not r['rotte'] and not err
            ko += not ok
            print(('OK' if ok else 'KO'), f'{w:>4} {pg:<12} scrollWidth={r["larga"]}', r['rotte'] or '', err or '')
            t.close()
    if FOTO:
        DIR.mkdir(exist_ok=True)
        for tema in ('dark', 'light'):
            for nome, vp, mob in (('desk', {'width': 1440, 'height': 900}, False), ('mob', {'width': 390, 'height': 844}, True)):
                c = b.new_context(viewport=vp, is_mobile=mob, has_touch=mob, color_scheme=tema, device_scale_factor=1)
                for pg, n in (('/', 'home'), ('/#cv', 'cv'), ('/en/', 'home-en'), ('/en/#bio', 'bio-en'), ('/progetti/', 'progetti'), ('/en/projects/', 'projects-en'), ('/blog/', 'blog')):
                    t = c.new_page(); t.goto(BASE + pg, wait_until='networkidle'); t.wait_for_timeout(1500)
                    t.screenshot(path=str(DIR / f'{n}-{nome}-{tema}.png'), full_page=(n == 'home' and mob))
                    t.close()
                c.close()
        print('screenshot in', DIR)
    b.close()
sys.exit(1 if ko else 0)
