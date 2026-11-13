"""Costruisce gabrielesalvi.com in public/ a partire da src/.

Uso:  ~/.openclaw/.venv/bin/python3 build.py           sito da pubblicare (bozze escluse)
      ~/.openclaw/.venv/bin/python3 build.py --bozze   anteprima con gli articoli in bozza

- Home, pannelli CV e PDF del CV leggono tutti src/cv/cv.yaml.
- Articoli: src/blog/<slug>.md con intestazione YAML (titolo, data, descrizione, tag, bozza).
- Testi della home in italiano e inglese: src/testi.yaml (home inglese in /en/; blog solo in italiano).
- Foto: se esiste src/assets/foto.jpg (o .webp/.png) finisce nella tessera grande, altrimenti restano le iniziali.
"""
import argparse
import datetime as dt
import hashlib
import json
import re
import shutil
from email.utils import format_datetime
from pathlib import Path
from xml.sax.saxutils import escape

import jinja2
import pypandoc
import typst
import yaml

QUI = Path(__file__).resolve().parent
SRC = QUI / 'src'
SITO = 'https://gabrielesalvi.com'
MESI = 'gennaio febbraio marzo aprile maggio giugno luglio agosto settembre ottobre novembre dicembre'.split()
MONTHS = 'January February March April May June July August September October November December'.split()
DESCRIZIONE = "Gabriele Salvi, ingegnere meccanico prestato all'intelligenza artificiale: agenti AI per le aziende, formazione sull'AI generativa, blog."
PALETTE = [('#8f80ff', '#ff7a50', '#ffd166', '#3cc8ff'), ('#3cc8ff', '#8f80ff', '#16a34a', '#3cc8ff'),
           ('#ffd166', '#ff7a50', '#8f80ff', '#ffd166'), ('#ff7a50', '#ff4f8b', '#8f80ff', '#3cc8ff'),
           ('#16a34a', '#3cc8ff', '#ffd166', '#8f80ff')]
ICONE = {
    'linkedin': '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9.75h4V21H3zM9.5 9.75h3.8v1.6h.05c.53-1 1.83-2.05 3.77-2.05 4.03 0 4.78 2.65 4.78 6.1V21h-4v-4.95c0-1.18-.02-2.7-1.65-2.7-1.65 0-1.9 1.29-1.9 2.62V21h-4z"/></svg>',
    'github': '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.56 9.56 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2z"/></svg>',
    'microlab': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 15l6-6"/></svg>',
}


def leggi_articolo(f: Path, bozze: bool):
    testo = f.read_text(encoding='utf-8')
    m = re.match(r'^---\n(.*?)\n---\n(.*)$', testo, re.S)
    if not m:
        raise SystemExit(f'{f.name}: manca l\'intestazione tra le righe ---')
    meta, corpo = yaml.safe_load(m.group(1)) or {}, m.group(2)
    for campo in ('titolo', 'data'):
        if campo not in meta:
            raise SystemExit(f'{f.name}: manca il campo "{campo}" nell\'intestazione')
    if meta.get('bozza') and not bozze:
        return None
    data = meta['data'] if isinstance(meta['data'], dt.date) else dt.date.fromisoformat(str(meta['data']))
    slug = f.stem
    h = int(hashlib.md5(slug.encode()).hexdigest(), 16)
    c = PALETTE[h % len(PALETTE)]
    arte = (f'--c1:{c[0]};--c2:{c[1]};--c3:{c[2]};--c4:{c[3]};--a1:{h % 360}deg;'
            f'--ax:{25 + h // 7 % 50}%;--ay:{30 + h // 11 % 45}%')
    html = pypandoc.convert_text(corpo, 'html5', format='markdown', extra_args=['--syntax-highlighting=none', '--wrap=none'])
    parole = len(re.findall(r'\w+', re.sub(r'<[^>]+>', ' ', html)))
    url = f'/blog/{slug}/'
    tag = meta.get('tag') or []
    ld = {'@context': 'https://schema.org', '@type': 'BlogPosting', 'headline': meta['titolo'],
          'datePublished': data.isoformat(), 'author': {'@type': 'Person', 'name': 'Gabriele Salvi', 'url': SITO},
          'url': SITO + url, 'description': meta.get('descrizione', '')}
    return {'slug': slug, 'titolo': meta['titolo'], 'descrizione': meta.get('descrizione', ''), 'tag': tag,
            'bozza': bool(meta.get('bozza')), 'data': data, 'data_iso': data.isoformat(),
            'data_lunga': f'{data.day} {MESI[data.month - 1]} {data.year}',
            'data_breve': f'{data.day} {MESI[data.month - 1][:3]} {data.year}',
            'data_punti': f'{data.day:02d}.{data.month:02d}', 'url': url, 'arte': arte,
            'minuti': max(1, round(parole / 200)), 'html': html,
            'ld': json.dumps(ld, ensure_ascii=False).replace('</', '<\\/')}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--bozze', action='store_true', help='includi gli articoli in bozza (solo anteprima)')
    ap.add_argument('--out', default=str(QUI / 'public'))
    a = ap.parse_args()
    out = Path(a.out).resolve()
    if out.exists():
        if not (out / 'CNAME').exists() and any(out.iterdir()):
            raise SystemExit(f'{out} non sembra una cartella di build (manca CNAME): non la svuoto')
        shutil.rmtree(out)
    out.mkdir(parents=True)

    cv = yaml.safe_load((SRC / 'cv' / 'cv.yaml').read_text(encoding='utf-8'))
    articoli = [x for f in sorted((SRC / 'blog').glob('*.md')) if (x := leggi_articolo(f, a.bozze))]
    articoli.sort(key=lambda x: x['data'], reverse=True)
    oggi = dt.date.today()

    # file statici
    shutil.copytree(SRC / 'assets', out / 'assets')
    shutil.copy(SRC / 'favicon.svg', out / 'favicon.svg')
    if (SRC / 'cubo-corse').is_dir():  # il gioco, copiato da strumenti/importa-cubo-corse.py
        shutil.copytree(SRC / 'cubo-corse', out / 'cubo-corse')
    if (SRC / '3as').is_dir():  # vetrina hackathon 3AS senza cognomi (hackathon-ai-stem/vetrina/build.py --condivisione), noindex, fuori sitemap
        shutil.copytree(SRC / '3as', out / '3as')
    if (SRC / 'blog' / 'img').is_dir():
        shutil.copytree(SRC / 'blog' / 'img', out / 'blog' / 'img')
    (out / 'CNAME').write_text('gabrielesalvi.com\n')
    (out / '.nojekyll').write_text('')
    (out / 'robots.txt').write_text(f'User-agent: *\nAllow: /\nSitemap: {SITO}/sitemap.xml\n')
    foto = next((p for p in sorted((SRC / 'assets').glob('foto.*')) if p.suffix in ('.jpg', '.jpeg', '.webp', '.png')), None)
    if foto:
        from PIL import Image
        with Image.open(foto) as im:
            foto = {'nome': foto.name, 'w': im.width, 'h': im.height}

    # CV in PDF (typst)
    (out / 'cv').mkdir()
    date_cv = {'it': f'{oggi.day} {MESI[oggi.month - 1]} {oggi.year}', 'en': f'{oggi.day} {MONTHS[oggi.month - 1]} {oggi.year}'}
    for lang in ('it', 'en'):
        typst.compile(str(SRC / 'cv' / 'cv.typ'), output=str(out / 'cv' / f'gabriele-salvi-cv-{lang}.pdf'),
                      sys_inputs={'lang': lang, 'oggi': date_cv[lang]})

    # pagine
    versione = hashlib.md5(b''.join((SRC / 'assets' / n).read_bytes() for n in ('sito.css', 'sito.js'))).hexdigest()[:8]
    env = jinja2.Environment(loader=jinja2.FileSystemLoader(SRC / 'modelli'), autoescape=True,
                             undefined=jinja2.StrictUndefined, trim_blocks=True, lstrip_blocks=True)
    testi = yaml.safe_load((SRC / 'testi.yaml').read_text(encoding='utf-8'))
    progetti = yaml.safe_load((SRC / 'progetti.yaml').read_text(encoding='utf-8'))
    comuni = {'sito': SITO, 'anno': oggi.year, 'versione': versione, 'cv': cv, 'icone': ICONE, 'sezione': '', 'foto': foto,
              'lang': 'it', 't': testi['it'], 'c': cv['it'], 'alterna': False}

    def scrivi(rel, modello, **kw):
        dest = out / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(env.get_template(modello).render(**{**comuni, **kw}), encoding='utf-8')

    for lang in ('it', 'en'):
        t = testi[lang]
        scrivi(t['radice'].lstrip('/') + 'index.html', 'home.html', titolo=t['titolo_home'], descrizione=t['descrizione'],
               percorso=t['radice'], articoli=articoli, lang=lang, t=t, c=cv[lang], p=progetti[lang],
               alterna={'it': '/', 'en': '/en/'})
        scrivi(t['progetti_url'].lstrip('/') + 'index.html', 'progetti.html', titolo=progetti[lang]['titolo'],
               descrizione=progetti[lang]['descrizione'], percorso=t['progetti_url'], lang=lang, t=t, p=progetti[lang],
               sezione='progetti', alterna={k: testi[k]['progetti_url'] for k in ('it', 'en')})
    scrivi('blog/index.html', 'blog.html', titolo='Blog · Gabriele Salvi', sezione='blog',
           descrizione='Articoli di Gabriele Salvi su intelligenza artificiale, agenti AI, formazione e ingegneria.',
           percorso='/blog/', articoli=articoli)
    for x in articoli:
        scrivi(f'blog/{x["slug"]}/index.html', 'articolo.html', titolo=f'{x["titolo"]} · Gabriele Salvi',
               descrizione=x['descrizione'] or DESCRIZIONE, percorso=x['url'], og_tipo='article', sezione='blog', a=x)
    scrivi('404.html', '404.html', titolo='Pagina non trovata · Gabriele Salvi', descrizione=DESCRIZIONE, percorso='/404.html')

    # feed RSS e sitemap (le bozze non ci vanno mai)
    pubblici = [x for x in articoli if not x['bozza']]
    def rfc(d): return format_datetime(dt.datetime(d.year, d.month, d.day, 8, 0, tzinfo=dt.timezone.utc))
    voci = ''.join(f'<item><title>{escape(x["titolo"])}</title><link>{SITO}{x["url"]}</link><guid>{SITO}{x["url"]}</guid>'
                   f'<pubDate>{rfc(x["data"])}</pubDate><description>{escape(x["descrizione"])}</description></item>'
                   for x in pubblici)
    (out / 'blog' / 'feed.xml').write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>'
        f'<title>Gabriele Salvi · Blog</title><link>{SITO}/blog/</link><description>{escape(DESCRIZIONE)}</description>'
        f'<language>it</language><atom:link href="{SITO}/blog/feed.xml" rel="self" type="application/rss+xml"/>'
        f'{voci}</channel></rss>\n', encoding='utf-8')
    urls = ['/', '/en/', '/progetti/', '/en/projects/', '/cubo-corse/', '/blog/'] + [x['url'] for x in pubblici]
    (out / 'sitemap.xml').write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
        + ''.join(f'<url><loc>{SITO}{u}</loc></url>' for u in urls) + '</urlset>\n', encoding='utf-8')

    n_bozze = sum(x['bozza'] for x in articoli)
    print(f'ok → {out}  ·  {len(pubblici)} articoli' + (f' + {n_bozze} bozze (anteprima)' if n_bozze else '')
          + f'  ·  foto: {foto["nome"] if foto else "no (iniziali)"}  ·  css/js v={versione}')


if __name__ == '__main__':
    main()
