// PDF del CV, stessa impaginazione del sorgente LaTeX (docs/cv_*.tex). Dati da cv.yaml.
// build.py lo compila due volte: sys.inputs.lang = "it" | "en", sys.inputs.oggi = data di aggiornamento.
#let lang = sys.inputs.at("lang", default: "it")
#let oggi = sys.inputs.at("oggi", default: "")
#let d = yaml("cv.yaml")
#let L = d.at(lang)
#let blu = rgb(0, 51, 153)

#set document(title: d.nome + " – CV", author: d.nome)
#set page(paper: "a4", margin: (x: 1.5cm, top: 1.4cm, bottom: 1.2cm))
#set text(font: "New Computer Modern", size: 11.5pt, lang: lang)
#set par(leading: 0.55em, spacing: 0.9em)
#show link: set text(fill: blu)

#let ico(path) = box(baseline: 12%, image(bytes(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill='#003399' d='" + path + "'/></svg>"
), format: "svg", height: 0.95em))
#let gh = "M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.56 9.56 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2z"
#let li = "M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9.75h4V21H3zM9.5 9.75h3.8v1.6h.05c.53-1 1.83-2.05 3.77-2.05 4.03 0 4.78 2.65 4.78 6.1V21h-4v-4.95c0-1.18-.02-2.7-1.65-2.7-1.65 0-1.9 1.29-1.9 2.62V21h-4z"
#let ml = "M2 5h20v14H2zm2 2v.5l8 5 8-5V7l-8 5z"

#let sezione(t) = block(above: 1.3em, below: 0.75em)[
  #text(size: 15pt, smallcaps(t))
  #v(-0.7em)
  #line(length: 100%, stroke: 0.5pt)
]
#let riga(sx, dx, corpo: none) = block(below: 0.85em)[
  #grid(columns: (1fr, auto), column-gutter: 1em, sx, dx)
  #if corpo != none { v(-0.35em); corpo }
]

#align(center)[
  #text(size: 26pt, d.nome)
  #v(-0.2em)
  #link("https://github.com/" + d.github)[#ico(gh) #d.github] #h(0.4em) | #h(0.4em)
  #link("https://linkedin.com/in/" + d.linkedin)[#ico(li) #d.linkedin] #h(0.4em) | #h(0.4em)
  #link("mailto:" + d.email)[#ico(ml) #d.email]
]

#sezione(L.titoli.esperienza)
#let presso = if lang == "it" [presso] else [at]
#for e in L.esperienze {
  let titolo = if e.ente in ("Autonomo", "Freelance") [*#e.ruolo* – #e.ente] else [*#e.ruolo* #presso *#e.ente*]
  riga(titolo, e.date, corpo: e.testo)
}

#sezione(L.titoli.istruzione)
#for s in L.istruzione {
  block(below: 0.6em, grid(columns: (auto, 1fr, auto), column-gutter: 1em, strong(s.titolo), s.dove, s.date))
}

#sezione(L.titoli.progetti)
#for p in L.progetti { riga(strong(p.titolo), [], corpo: p.testo) }

#sezione(L.titoli.riconoscimenti)
#for r in L.riconoscimenti { riga(strong(r.titolo), link(r.link, r.etichetta), corpo: r.testo) }

#sezione(L.titoli.certificazioni)
#for c in L.certificazioni { block(below: 0.6em, strong(c.replace(" · ", " – "))) }

#sezione(L.titoli.competenze)
#grid(columns: (auto, 1fr), column-gutter: 1.2em, row-gutter: 0.8em,
  // la prima riga (strumenti) resta com'è, la seconda diventa una frase: minuscole dopo la prima voce e punto finale
  ..L.competenze.enumerate().map(((g, c)) => (c.nome,
    if g == 0 { c.voci.join(", ") }
    else { c.voci.enumerate().map(((i, v)) => if i == 0 { v } else { lower(v.first()) + v.slice(v.first().len()) }).join(", ") + "." }
  )).flatten()
)

#v(1fr)
#align(center, text(size: 8.5pt)[#L.titoli.aggiornato: #oggi])
