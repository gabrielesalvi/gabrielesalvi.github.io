---
titolo: Come si scrive un articolo per questo sito
data: 2026-11-09
descrizione: Il modello da copiare per ogni nuovo articolo del blog.
tag: [Sito]
bozza: true
---

Questo file è un **esempio** e resta in bozza: non finisce sul sito pubblicato. Per scrivere un articolo nuovo copialo in `src/blog/`, dagli un nome come `agenti-ai-in-azienda.md` (diventa l'indirizzo `/blog/agenti-ai-in-azienda/`) e cambia l'intestazione in alto.

## L'intestazione

Tra le due righe `---` ci sono i dati dell'articolo:

- `titolo`: il titolo, così come appare in pagina;
- `data`: nel formato `AAAA-MM-GG`, serve anche a ordinare gli articoli;
- `descrizione`: una frase, compare nell'elenco del blog e nelle anteprime sui social;
- `tag`: facoltativi, tra parentesi quadre;
- `bozza: true`: tiene l'articolo fuori dal sito finché non lo togli.

## Il testo

Si scrive in Markdown: **grassetto**, *corsivo*, [link](https://gabrielesalvi.com), elenchi, citazioni e codice.

> Una citazione diventa così.

```python
print("e il codice così")
```

Le immagini vanno in `src/blog/img/` e si richiamano con `![descrizione](/blog/img/nome.jpg)`.
