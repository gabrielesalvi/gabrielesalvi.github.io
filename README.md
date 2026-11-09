# gabrielesalvi.com

Sito statico personale. Sorgenti in `src/`, sito costruito in `public/` (pubblicato da GitHub Pages).

- **Scrivere un articolo**: copia `src/blog/esempio-articolo.md`, cambia l'intestazione, togli `bozza: true`.
- **Testi della home (IT/EN)**: `src/testi.yaml`. La home inglese è in `/en/`, il blog è solo in italiano.
- **Aggiornare il CV**: `src/cv/cv.yaml` (alimenta il pannello CV e i due PDF).
- **Foto**: `src/assets/foto.webp` (verticale, sfondo trasparente).
- **Anteprima con le bozze**: `~/.openclaw/.venv/bin/python3 build.py --bozze`
- **Pubblicare**: `./pubblica.sh "messaggio"` (build, controllo, commit, push = online in ~1 minuto).
