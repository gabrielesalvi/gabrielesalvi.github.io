// gabrielesalvi.com: tema su tutte le pagine, tessere e pannelli solo in home.
(() => {
  const root = document.documentElement;
  const calmo = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(pointer: fine)').matches;

  // tema chiaro/scuro (la scelta resta solo in questo browser)
  const tema = document.getElementById('tema');
  if (tema) tema.onclick = () => {
    const scuro = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = scuro ? 'light' : 'dark';
    try { localStorage.setItem('gs-tema', root.dataset.theme); } catch (e) {}
  };

  const bento = document.getElementById('bento');
  if (!bento) return;

  const vt = !!document.startViewTransition && !calmo;
  if (!vt) root.classList.add('no-vt');
  requestAnimationFrame(() => requestAnimationFrame(() => bento.classList.add('su')));

  // ora di Brescia + avanzamento della giornata
  const fmt = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Europe/Rome' });
  const cifre = document.getElementById('cifre'), arco = document.getElementById('arco'), fascia = document.getElementById('fascia');
  const tic = () => {
    const [h, m, s] = fmt.format(new Date()).split(':');
    cifre.innerHTML = `${h}:${m}<span class="sec">${s}</span>`;
    arco.style.width = ((+h * 3600 + +m * 60 + +s) / 864) + '%';
    fascia.textContent = (+h >= 7 && +h < 19) ? fascia.dataset.giorno : fascia.dataset.sera;
  };
  tic(); setInterval(tic, 1000);

  // bagliore + inclinazione delle tessere
  const tessere = [...document.querySelectorAll('.t')];
  if (fine) {
    addEventListener('pointermove', e => {
      for (const t of tessere) { const q = t.getBoundingClientRect(); t.style.setProperty('--x', e.clientX - q.left + 'px'); t.style.setProperty('--y', e.clientY - q.top + 'px'); }
    }, { passive: true });
    if (!calmo) tessere.forEach(t => {
      t.addEventListener('pointermove', e => {
        const q = t.getBoundingClientRect(); const px = (e.clientX - q.left) / q.width - .5, py = (e.clientY - q.top) / q.height - .5;
        const k = 5 / Math.max(1, Math.sqrt(q.width * q.height) / 260);
        t.style.setProperty('--ry', (px * k).toFixed(2) + 'deg'); t.style.setProperty('--rx', (-py * k).toFixed(2) + 'deg');
      });
      t.addEventListener('pointerleave', () => { t.style.setProperty('--rx', '0deg'); t.style.setProperty('--ry', '0deg'); });
    });
  }

  // copia indirizzo email
  const copia = document.getElementById('copia');
  if (copia) copia.onclick = async e => {
    e.preventDefault(); e.stopPropagation();
    const ind = copia.dataset.ind, testo = copia.dataset.testo || (copia.dataset.testo = copia.textContent);
    try { await navigator.clipboard.writeText(ind); copia.textContent = copia.dataset.ok; } catch (_) { copia.textContent = ind; }
    setTimeout(() => copia.textContent = testo, 1800);
  };

  // pannelli (bio, cv, contatti) con View Transitions, raggiungibili anche da /#bio ecc.
  const PANNELLI = ['bio', 'cv', 'contatti'];
  const velo = document.getElementById('velo');
  let aperto = null, origine = null, prima = null;
  const nomina = (el, n) => { if (el) el.style.viewTransitionName = n || ''; };
  const apri = (id, da) => {
    const p = document.getElementById('p-' + id);
    if (!p || aperto === p) return;
    if (!aperto) prima = document.activeElement;
    const fai = () => { nomina(da, ''); if (aperto) { aperto.classList.remove('on'); nomina(aperto, ''); } p.classList.add('on'); nomina(p, 'pannello'); velo.classList.add('on'); document.body.style.overflow = 'hidden'; p.scrollTop = 0; };
    origine = da;
    if (vt && da && !aperto) { nomina(da, 'pannello'); document.startViewTransition(fai); } else fai();
    aperto = p;
    if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
    setTimeout(() => p.querySelector('.chiudi').focus({ preventScroll: true }), 50);
  };
  const chiudi = () => {
    if (!aperto) return;
    const p = aperto, da = origine && document.contains(origine) ? origine : null;
    const fai = () => { p.classList.remove('on'); nomina(p, ''); nomina(da, 'pannello'); velo.classList.remove('on'); document.body.style.overflow = ''; };
    if (vt && da) document.startViewTransition(fai).finished.then(() => nomina(da, '')); else { fai(); nomina(da, ''); }
    aperto = null;
    history.replaceState(null, '', location.pathname + location.search);
    if (prima && prima.focus) prima.focus({ preventScroll: true });
  };
  document.querySelectorAll('[data-apri]').forEach(el => el.addEventListener('click', e => {
    if (e.target.closest('#copia')) return;
    e.preventDefault(); e.stopPropagation();
    apri(el.dataset.apri, el.classList.contains('t') ? el : el.closest('.t'));
  }));
  document.querySelectorAll('.top nav a').forEach(a => {
    const id = (a.getAttribute('href').split('#')[1] || '');
    if (!PANNELLI.includes(id)) return;
    a.addEventListener('click', e => { e.preventDefault(); apri(id, document.querySelector(`.t[data-apri="${id}"]`)); });
  });
  document.querySelectorAll('.chiudi').forEach(b => b.onclick = chiudi);
  velo.onclick = chiudi;
  addEventListener('keydown', e => { if (e.key === 'Escape') chiudi(); });
  const daHash = () => { const id = location.hash.slice(1); if (PANNELLI.includes(id)) apri(id, null); };
  daHash();
  addEventListener('hashchange', () => location.hash ? daHash() : chiudi());
})();
