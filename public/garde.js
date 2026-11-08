// Rosée — page de la personne qui arrose pendant une absence. Sans compte : le jeton est dans l'adresse.
(() => {
  const token = decodeURIComponent(location.pathname.split('/').pop() || '');
  const app = document.getElementById('app');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (n) => `<svg aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const fmtLong = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const fmtDay = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });
  const keyDate = (k) => new Date(`${k}T12:00:00`);
  let toastTimer;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.innerHTML = `<span>${esc(msg)}</span>`;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
  }
  async function call(body) {
    const r = await fetch('/garde-api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, ...body }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error || 'Erreur'), { status: r.status });
    return data;
  }
  const lastText = (p) => {
    if (!p.last_watered_at) return 'Jamais arrosée dans Rosée';
    const days = Math.round((Date.now() - new Date(p.last_watered_at)) / 86400000);
    return days <= 0 ? 'Arrosée aujourd’hui' : days === 1 ? 'Arrosée hier' : `Arrosée il y a ${days} jours`;
  };
  const whenText = (p) => (p.watered_today ? 'Arrosée aujourd’hui' : p.days_left < 0 ? `À arroser (${-p.days_left} j de retard)` : p.days_left === 0 ? 'À arroser aujourd’hui' : p.days_left === 1 ? 'Demain' : `Dans ${p.days_left} jours`);

  function card(p) {
    const due = !p.watered_today && p.days_left <= 0;
    return `<li class="g-plant ${p.watered_today ? 'done' : ''}" data-id="${p.id}">
      ${p.photo ? `<img class="g-ph" src="${esc(p.photo)}" alt="" loading="lazy">` : `<span class="g-ph">${icon('plants')}</span>`}
      <div>
        <h2>${esc(p.name)}</h2>
        ${p.room ? `<div class="g-room">${esc(p.room)}</div>` : ''}
        ${p.water ? `<p class="g-how"><b>${esc(p.water.short)}.</b> ${esc(p.water.text)}</p>` : ''}
        ${p.dry || p.notes ? `<details class="g-more"><summary>Plus de détails</summary>${p.dry ? `<p>${esc(p.dry)}</p>` : ''}${p.notes ? `<p>${esc(p.notes)}</p>` : ''}<p>${esc(lastText(p))}</p></details>` : ''}
      </div>
      <div class="g-act">
        <span class="g-when ${p.watered_today ? 'ok' : due ? 'due' : ''}">${esc(whenText(p))}</span>
        ${p.watered_today ? `<span class="g-when ok">${icon('check')}</span>`
          : `<button class="btn ${due ? '' : 'secondary'} sm" type="button" data-water="${p.id}">${icon('drop')}Arrosée</button>`}
      </div>
    </li>`;
  }

  function render(d) {
    const due = d.plants.filter((p) => !p.watered_today && p.days_left <= 0);
    const done = d.plants.filter((p) => p.watered_today);
    const later = d.plants.filter((p) => !p.watered_today && p.days_left > 0);
    const back = keyDate(d.to);
    app.innerHTML = `
      <header class="g-head"><img src="/icons/icon.svg" alt="">
        <div><h1>${d.name ? `Merci ${esc(d.name)} !` : 'Merci de garder les plantes !'}</h1>
        <p>Retour prévu le ${esc(fmtDay.format(back))}. Aujourd’hui : ${esc(fmtLong.format(keyDate(d.today)))}.</p></div></header>
      ${d.note ? `<div class="g-note">${esc(d.note)}</div>` : ''}
      <div class="g-sum"><div><b>${due.length}</b><span>à arroser aujourd’hui</span></div><div><b>${done.length}</b><span>déjà arrosée${done.length > 1 ? 's' : ''}</span></div></div>
      ${due.length ? `<h2 class="g-sec">À arroser</h2><ul class="g-list">${due.map(card).join('')}</ul>` : `<p class="g-empty">${icon('check')} Rien à arroser aujourd’hui. Revenez sur cette page lors de votre prochain passage.</p>`}
      ${done.length ? `<h2 class="g-sec">Fait aujourd’hui</h2><ul class="g-list">${done.map(card).join('')}</ul>` : ''}
      ${later.length ? `<h2 class="g-sec">Plus tard</h2><ul class="g-list">${later.map(card).join('')}</ul>` : ''}
      <p class="g-foot">Rosée · cette page est privée, ne la partagez pas.</p>`;
    app.querySelectorAll('[data-water]').forEach((b) => (b.onclick = async () => {
      b.disabled = true;
      try {
        const id = Number(b.dataset.water);
        const name = d.plants.find((p) => p.id === id)?.name;
        render(await call({ action: 'water', id }));
        toast(`${name} arrosée, merci !`);
      } catch (e) { b.disabled = false; toast(e.message); }
    }));
  }

  async function load() {
    try { render(await call({ action: 'info' })); }
    catch (e) {
      app.innerHTML = `<div class="g-empty"><img src="/icons/icon.svg" alt="" width="64" height="64"><h1 style="font-size:20px">Lien non valable</h1><p>${esc(e.status === 403 ? 'Cette absence est terminée ou le lien a été remplacé.' : e.message)}</p></div>`;
    }
  }
  load();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
})();
