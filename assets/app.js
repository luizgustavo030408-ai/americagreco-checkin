(() => {
  const $ = s => document.querySelector(s);
  const state = { grade: [], dia: null, slot: null, enviando: false };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasGsap = !!window.gsap;
  if (hasGsap) gsap.registerPlugin(ScrollTrigger, ScrollToPlugin, SplitText);
  $('#yr').textContent = new Date().getFullYear();

  // ---------- dados ----------
  async function carregar(manterSelecao) {
    try {
      state.grade = await API.rpc('spin_grade');
    } catch (e) {
      $('#slots').innerHTML = `<div class="empty">Não foi possível carregar as turmas agora. Atualize a página.</div>`;
      return;
    }
    const dias = [...new Set(state.grade.map(g => g.data))];
    if (!manterSelecao || !dias.includes(state.dia)) {
      state.dia = dias.find(d => state.grade.some(g => g.data === d && !g.encerrado && g.ocupadas < g.vagas)) || dias[0] || null;
      state.slot = null;
    }
    if (state.slot) {
      const s = state.grade.find(g => g.data === state.dia && g.horario_id === state.slot.horario_id);
      state.slot = s && !s.encerrado && s.ocupadas < s.vagas ? s : null;
    }
    renderDias(dias); renderSlots(!manterSelecao); renderResumo(); renderMeta();
  }

  function renderMeta() {
    const h = U.hoje();
    const hoje = state.grade.filter(g => g.data === h && !g.encerrado);
    $('#mTurmas').textContent = hoje.length;
    $('#mLivres').textContent = hoje.reduce((a, g) => a + Math.max(0, g.vagas - g.ocupadas), 0);
  }

  function renderDias(dias) {
    const el = $('#days');
    if (!dias.length) { el.innerHTML = ''; return; }
    el.innerHTML = dias.map(d => `<button type="button" class="day ${d === state.dia ? 'on' : ''}" data-d="${d}">
      <small>${U.rotulo(d)}</small><strong>${U.dataBR(d)}</strong></button>`).join('');
  }

  function renderSlots(animar) {
    const el = $('#slots');
    const lista = state.grade.filter(g => g.data === state.dia);
    if (!lista.length) { el.innerHTML = `<div class="empty">Nenhuma turma de spinning disponível no momento.</div>`; return; }
    el.innerHTML = lista.map(g => {
      const livres = Math.max(0, g.vagas - g.ocupadas);
      const full = livres === 0, closed = g.encerrado;
      const low = !full && livres <= Math.max(2, Math.round(g.vagas * 0.2));
      const on = state.slot && state.slot.horario_id === g.horario_id;
      const cls = ['slot', on && 'on', full && 'full', closed && 'closed', low && 'low'].filter(Boolean).join(' ');
      const txt = closed ? 'Encerrada' : full ? 'Lotada' : `${livres} de ${g.vagas} bikes livres`;
      const pct = Math.min(1, g.ocupadas / g.vagas);
      return `<button type="button" class="${cls}" data-id="${g.horario_id}" ${full || closed ? 'disabled' : ''} aria-pressed="${!!on}">
        ${full && !closed ? '<span class="badge">Lotada</span>' : ''}
        <div class="h">${g.hora}</div>
        <div class="who">${g.instrutor ? 'com ' + U.esc(g.instrutor) : 'Greco Cycle'}</div>
        <div class="meter"><i style="transform:scaleX(${pct})" data-p="${pct}"></i></div>
        <div class="left">${txt}</div></button>`;
    }).join('');
    if (hasGsap && !reduced && animar) {
      gsap.from('#slots .slot', { y: 18, opacity: 0, duration: .55, stagger: .05, ease: 'power3.out' });
      gsap.from('#slots .meter i', { scaleX: 0, duration: 1, stagger: .05, ease: 'power2.out', delay: .15 });
    }
  }

  function renderResumo() {
    const s = state.slot;
    $('#sel').innerHTML = s ? `<b>${s.hora}</b> · ${U.dataLonga(s.data)}` : 'Escolha um horário para continuar';
    $('#go').disabled = !s;
  }

  function msg(t, tipo = 'err') {
    const m = $('#msg'); m.className = `msg ${tipo} show`; m.textContent = t;
    if (hasGsap && !reduced) gsap.fromTo(m, { y: -6, opacity: 0 }, { y: 0, opacity: 1, duration: .35 });
  }
  function limparMsg() { $('#msg').className = 'msg'; }

  // ---------- eventos ----------
  $('#days').addEventListener('click', e => {
    const b = e.target.closest('.day'); if (!b) return;
    state.dia = b.dataset.d; state.slot = null; limparMsg();
    renderDias([...new Set(state.grade.map(g => g.data))]); renderSlots(true); renderResumo();
  });
  $('#slots').addEventListener('click', e => {
    const b = e.target.closest('.slot'); if (!b || b.disabled) return;
    state.slot = state.grade.find(g => g.data === state.dia && g.horario_id === +b.dataset.id);
    document.querySelectorAll('#slots .slot').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
    if (hasGsap && !reduced) gsap.fromTo(b, { scale: .96 }, { scale: 1, duration: .5, ease: 'back.out(3)' });
    limparMsg(); renderResumo();
    if (innerWidth < 920 && !$('#nome').value) $('#nome').focus({ preventScroll: false });
  });

  ['#cpf', '#cpf2'].forEach(id => $(id).addEventListener('input', e => { e.target.value = U.maskCPF(e.target.value); e.target.parentElement.classList.remove('err'); }));
  $('#nome').addEventListener('input', e => e.target.parentElement.classList.remove('err'));

  try { // facilita a próxima visita (só neste aparelho)
    const salvo = JSON.parse(localStorage.getItem('gc_aluno') || 'null');
    if (salvo) { $('#nome').value = salvo.nome || ''; $('#cpf').value = U.maskCPF(salvo.cpf || ''); $('#cpf2').value = U.maskCPF(salvo.cpf || ''); }
  } catch {}

  $('#form').addEventListener('submit', async e => {
    e.preventDefault();
    if (state.enviando) return;
    const nome = $('#nome').value.trim().replace(/\s+/g, ' ');
    const cpf = U.so($('#cpf').value);
    if (!state.slot) return msg('Escolha um horário.');
    if (nome.length < 5 || !nome.includes(' ')) { $('#nome').parentElement.classList.add('err'); return msg('Informe seu nome completo.'); }
    if (!U.cpfOk(cpf)) { $('#cpf').parentElement.classList.add('err'); return msg('CPF inválido. Confira os números.'); }
    state.enviando = true; const btn = $('#go'); btn.disabled = true; const label = btn.innerHTML; btn.textContent = 'Confirmando…';
    try {
      const r = await API.rpc('spin_checkin', { p_nome: nome, p_cpf: cpf, p_horario_id: state.slot.horario_id, p_data: state.slot.data });
      if (!r.ok) { msg(r.erro); await carregar(true); return; }
      try { localStorage.setItem('gc_aluno', JSON.stringify({ nome, cpf })); } catch {}
      limparMsg(); abrirTicket(r); state.slot = null; await carregar(true);
    } catch (err) { msg(err.message); }
    finally { state.enviando = false; btn.innerHTML = label; renderResumo(); }
  });

  // ---------- ticket ----------
  function abrirTicket(r) {
    $('#tkNome').textContent = r.nome;
    $('#tkDia').textContent = r.data === U.hoje() ? 'Hoje' : U.dataBR(r.data);
    $('#tkHora').textContent = r.hora;
    $('#tkCode').textContent = r.codigo;
    $('#tkNote').textContent = `Você é o ${r.posicao}º de ${r.vagas} na turma${r.instrutor ? ' com ' + r.instrutor : ''}. Mostre este código na recepção ao chegar — e chegue 5 minutos antes para ajustar a bike.`;
    const o = $('#overlay'); o.classList.add('show'); $('#tkClose').focus();
    if (hasGsap && !reduced) {
      gsap.timeline()
        .fromTo(o, { opacity: 0 }, { opacity: 1, duration: .3 })
        .fromTo('#ticket', { y: 60, rotate: -4, scale: .92, opacity: 0 }, { y: 0, rotate: 0, scale: 1, opacity: 1, duration: .8, ease: 'expo.out' }, '<.05')
        .from('#tkCode', { scale: .6, opacity: 0, duration: .6, ease: 'back.out(2.2)' }, '-=.45');
    }
  }
  function fecharTicket() { $('#overlay').classList.remove('show'); }
  $('#tkClose').addEventListener('click', fecharTicket);
  $('#overlay').addEventListener('click', e => { if (e.target.id === 'overlay') fecharTicket(); });
  addEventListener('keydown', e => { if (e.key === 'Escape') fecharTicket(); });

  // ---------- meus check-ins ----------
  async function consultar() {
    const cpf = U.so($('#cpf2').value), box = $('#mine');
    if (!U.cpfOk(cpf)) { box.innerHTML = `<p class="none">Digite um CPF válido.</p>`; return; }
    box.innerHTML = `<p class="none">Buscando…</p>`;
    try {
      const l = await API.rpc('spin_meus_checkins', { p_cpf: cpf });
      if (!l.length) { box.innerHTML = `<p class="none">Nenhum check-in ativo para este CPF.</p>`; return; }
      box.innerHTML = l.map(c => `<div class="mine-item"><div><strong>${c.hora} · ${c.data === U.hoje() ? 'Hoje' : U.dataBR(c.data)}</strong>
        <small>${c.codigo} · ${c.status === 'presente' ? 'presença confirmada' : 'confirmado'}</small></div>
        ${c.cancelavel ? `<button data-id="${c.id}">Cancelar</button>` : ''}</div>`).join('');
      if (hasGsap && !reduced) gsap.from('#mine .mine-item', { y: 12, opacity: 0, stagger: .06, duration: .4 });
    } catch (e) { box.innerHTML = `<p class="none">${U.esc(e.message)}</p>`; }
  }
  $('#lookup').addEventListener('submit', e => { e.preventDefault(); consultar(); });
  $('#mine').addEventListener('click', async e => {
    const b = e.target.closest('button[data-id]'); if (!b) return;
    if (!confirm('Cancelar este check-in e liberar a bike?')) return;
    b.disabled = true; b.textContent = '…';
    try {
      const r = await API.rpc('spin_cancelar', { p_cpf: U.so($('#cpf2').value), p_id: +b.dataset.id });
      if (!r.ok) alert(r.erro);
      await consultar(); await carregar(true);
    } catch (err) { alert(err.message); }
  });

  // ---------- movimento ----------
  document.querySelectorAll('[data-scroll]').forEach(a => a.addEventListener('click', e => {
    if (!hasGsap) return; e.preventDefault();
    gsap.to(window, { duration: reduced ? 0 : 1.1, scrollTo: { y: a.getAttribute('href'), offsetY: 16 }, ease: 'power3.inOut' });
  }));

  if (hasGsap) {
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      document.fonts.ready.then(() => {
        const split = SplitText.create('#heroTitle', { type: 'lines,words', mask: 'lines' });
        gsap.timeline({ defaults: { ease: 'expo.out' } })
          .from('.top img, .top .tag', { y: -20, opacity: 0, duration: 1, stagger: .1 })
          .from('.hero-bg', { scale: 1.15, duration: 2.2, ease: 'power2.out' }, 0)
          .from(split.words, { yPercent: 110, duration: 1.1, stagger: .06 }, .2)
          .from('.hero-el', { y: 24, opacity: 0, duration: 1, stagger: .12 }, .5);
      });
      gsap.to('.hero-bg', { yPercent: 12, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
      ScrollTrigger.batch('.reveal', {
        start: 'top 88%', once: true,
        onEnter: els => gsap.fromTo(els, { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 1, stagger: .12, ease: 'power3.out' })
      });
      ScrollTrigger.create({ start: 0, end: 'max', onUpdate: self => { window.__wheelBoost = Math.min(12, Math.abs(self.getVelocity()) / 300); } });
    });
    mm.add('(prefers-reduced-motion: reduce)', () => { gsap.set('.reveal', { opacity: 1 }); });
  } else document.querySelectorAll('.reveal').forEach(el => el.style.opacity = 1);

  carregar(false);
  setInterval(() => { if (!document.hidden && !state.enviando) carregar(true); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) carregar(true); });
})();
