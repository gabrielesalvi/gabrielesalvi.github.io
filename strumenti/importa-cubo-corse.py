"""Copia nel sito la versione giocabile di Cubo Corse (servita poi su /cubo-corse/).

Uso: ~/.openclaw/.venv/bin/python3 strumenti/importa-cubo-corse.py
Da rilanciare ogni volta che il gioco cambia nel suo progetto (workspace/projects/cubo-corse), poi build + pubblica.

Si porta solo quello che serve per giocare: index.html, style.css, src/, vendor/three, data/monza.json.
Restano fuori test, strumenti, documenti e le tessere satellitari (data/raw). I font Google diventano locali.
"""
import shutil
import urllib.request
from pathlib import Path

ORIGINE = Path.home() / '.openclaw/workspace/projects/cubo-corse'
DEST = Path(__file__).resolve().parent.parent / 'src' / 'cubo-corse'
GF = 'https://fonts.gstatic.com/s/'
FONT = [  # (file, famiglia, stile, peso, url): sottoinsieme latin, come li dà Google Fonts
    ('barlow-condensed-500.woff2', 'Barlow Condensed', 'normal', '500', GF + 'barlowcondensed/v13/HTxwL3I-JCGChYJ8VI-L6OO_au7B4-Lwz3bWuQ.woff2'),
    ('barlow-condensed-600.woff2', 'Barlow Condensed', 'normal', '600', GF + 'barlowcondensed/v13/HTxwL3I-JCGChYJ8VI-L6OO_au7B4873z3bWuQ.woff2'),
    ('barlow-condensed-800.woff2', 'Barlow Condensed', 'normal', '800', GF + 'barlowcondensed/v13/HTxwL3I-JCGChYJ8VI-L6OO_au7B47b1z3bWuQ.woff2'),
    ('barlow-condensed-700i.woff2', 'Barlow Condensed', 'italic', '700', GF + 'barlowcondensed/v13/HTxyL3I-JCGChYJ8VI-L6OO_au7B6xTrY3Tmu4kG.woff2'),
    ('barlow-condensed-800i.woff2', 'Barlow Condensed', 'italic', '800', GF + 'barlowcondensed/v13/HTxyL3I-JCGChYJ8VI-L6OO_au7B6xTrf3fmu4kG.woff2'),
    ('inter.woff2', 'Inter', 'normal', '400 600', GF + 'inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7.woff2'),
]
GOOGLE = '''  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,500;0,600;0,800;1,700;1,800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
'''
TESTA = '''  <meta name="description" content="Cubo Corse: gioco di corse GT in voxel nel browser, con Monza 1:1. Un progetto di Gabriele Salvi." />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="stylesheet" href="fonts/fonts.css" />
'''

# i font scaricati restano tra un'importazione e l'altra
fonts_vecchi = {}
if (DEST / 'fonts').is_dir():
    fonts_vecchi = {p.name: p.read_bytes() for p in (DEST / 'fonts').glob('*.woff2')}
if DEST.exists():
    shutil.rmtree(DEST)
DEST.mkdir(parents=True)

for nome in ('index.html', 'style.css'):
    shutil.copy(ORIGINE / nome, DEST / nome)
for cartella in ('src', 'vendor'):
    shutil.copytree(ORIGINE / cartella, DEST / cartella, ignore=shutil.ignore_patterns('__pycache__', '*.map'))
(DEST / 'data').mkdir()
shutil.copy(ORIGINE / 'data' / 'monza.json', DEST / 'data' / 'monza.json')

(DEST / 'fonts').mkdir()
css = []
for file, fam, stile, peso, url in FONT:
    dati = fonts_vecchi.get(file) or urllib.request.urlopen(url, timeout=30).read()
    (DEST / 'fonts' / file).write_bytes(dati)
    css.append(f"@font-face{{font-family:'{fam}';font-style:{stile};font-weight:{peso};font-display:swap;src:url({file}) format('woff2')}}")
(DEST / 'fonts' / 'fonts.css').write_text('\n'.join(css) + '\n')

html = (DEST / 'index.html').read_text(encoding='utf-8')
if GOOGLE not in html:
    raise SystemExit('index.html del gioco è cambiato: aggiorna il blocco GOOGLE in questo script')
(DEST / 'index.html').write_text(html.replace(GOOGLE, TESTA), encoding='utf-8')

n = sum(1 for p in DEST.rglob('*') if p.is_file())
mb = sum(p.stat().st_size for p in DEST.rglob('*') if p.is_file()) / 1e6
print(f'ok → {DEST}  ·  {n} file, {mb:.1f} MB')
