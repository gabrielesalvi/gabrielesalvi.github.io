"""Rigenera src/assets/og-it.png e og-en.png (anteprime social 1200x630) e apple-touch-icon.png (180x180) con i font del sito.
Uso: ~/.openclaw/.venv/bin/python3 strumenti/immagini.py   (da rilanciare solo se cambiano nome o frase)"""
from pathlib import Path
from patchright.sync_api import sync_playwright

ASSETS = Path(__file__).resolve().parent.parent / 'src' / 'assets'
F = ASSETS.as_uri() + '/fonts/'
FONT = f"""@font-face{{font-family:G;src:url({F}geist.woff2);font-weight:300 800}}
@font-face{{font-family:S;src:url({F}instrument-serif-italic.woff2);font-style:italic}}
@font-face{{font-family:M;src:url({F}geist-mono.woff2)}}*{{margin:0;box-sizing:border-box}}"""
OG = f"""<style>{FONT}
body{{width:1200px;height:630px;background:#07070a;color:#f1f1f5;font-family:G;position:relative;overflow:hidden;padding:72px 80px;display:flex;flex-direction:column}}
.g{{position:absolute;inset:0;background:radial-gradient(40% 55% at 85% 20%,rgba(143,128,255,.55),transparent 70%),radial-gradient(35% 45% at 95% 95%,rgba(255,120,80,.35),transparent 70%),radial-gradient(30% 40% at 65% 10%,rgba(60,200,255,.25),transparent 70%)}}
.m{{font-family:M;font-size:22px;color:#9a9aab;letter-spacing:.04em;position:relative;display:flex;align-items:center;gap:14px}}
.q{{width:44px;height:44px;border-radius:13px;background:#f1f1f5;color:#07070a;display:grid;place-items:center;font-family:G;font-weight:700;font-size:19px}}
h1{{font-size:132px;line-height:.92;letter-spacing:-.05em;font-weight:600;margin-top:auto;position:relative}}
h1 em,p em{{font-family:S;font-weight:400;color:#8f80ff;letter-spacing:-.02em}}
p{{font-size:38px;margin-top:26px;font-weight:500;letter-spacing:-.02em;position:relative}}</style>
<div class=g></div><div class=m><span class=q>GS</span>gabrielesalvi.com</div>
<h1>Gabriele<br>Salvi<em>.</em></h1><p>{{frase}}</p>"""
FRASI = {'it': "Ingegnere meccanico prestato all'<em>intelligenza artificiale</em>.",
         'en': "Mechanical engineer on loan to <em>artificial intelligence</em>."}
ICONA = f"""<style>{FONT}body{{width:180px;height:180px;background:#0c0c10;display:grid;place-items:center;position:relative}}
b{{font-family:G;font-weight:700;font-size:78px;letter-spacing:-3px;color:#f1f1f5}}i{{position:absolute;right:30px;bottom:44px;width:18px;height:18px;border-radius:50%;background:#8f80ff}}</style><b>GS</b><i></i>"""

with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox', '--allow-file-access-from-files'])
    lavori = [(OG.replace('{frase}', f), f'og-{k}.png', 1200, 630) for k, f in FRASI.items()]
    for html, nome, w, h in lavori + [(ICONA, 'apple-touch-icon.png', 180, 180)]:
        pg = b.new_page(viewport={'width': w, 'height': h})
        tmp = ASSETS / f'_{nome}.html'
        tmp.write_text(html, encoding='utf-8')
        pg.goto(tmp.as_uri()); pg.wait_for_timeout(400)
        pg.screenshot(path=str(ASSETS / nome)); tmp.unlink(); pg.close()
        print('ok', nome)
    b.close()
