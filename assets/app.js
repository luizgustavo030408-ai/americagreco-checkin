(() => {
  const $ = s => document.querySelector(s);
  const state = { grade: [], dia: null, slot: null, enviando: false };

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
    renderDias(dias); renderSlots(); renderResumo();
  }

  function renderDias(dias) {
    $('#days').innerHTML = dias.map(d => `<button type="button" class="day ${d === state.dia ? 'on' : ''}" data-d="${d}">
      <small>${U.rotulo(d)}</small><strong>${U.dataBR(d)}</strong></button>`).join('');
  }

  function renderSlots() {
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
        <div class="h">${g.hora}</div>
        <div class="who">${g.instrutor ? 'com ' + U.esc(g.instrutor) : 'Greco Cycle'}</div>
        <div class="meter"><i style="transform:scaleX(${pct})"></i></div>
        <div class="left">${txt}</div></button>`;
    }).join('');
  }

  function renderResumo() {
    const s = state.slot;
    $('#sel').innerHTML = s ? `<b>${s.hora}</b> · ${U.dataLonga(s.data)}` : 'Escolha um horário para continuar';
    $('#go').disabled = !s;
  }

  function msg(t, tipo = 'err') { const m = $('#msg'); m.className = `msg ${tipo} show`; m.textContent = t; }
  function limparMsg() { $('#msg').className = 'msg'; }

  // ---------- eventos ----------
  $('#days').addEventListener('click', e => {
    const b = e.target.closest('.day'); if (!b) return;
    state.dia = b.dataset.d; state.slot = null; limparMsg();
    renderDias([...new Set(state.grade.map(g => g.data))]); renderSlots(); renderResumo();
  });
  $('#slots').addEventListener('click', e => {
    const b = e.target.closest('.slot'); if (!b || b.disabled) return;
    state.slot = state.grade.find(g => g.data === state.dia && g.horario_id === +b.dataset.id);
    document.querySelectorAll('#slots .slot').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
    limparMsg(); renderResumo();
    if (!$('#nome').value) $('#nome').focus();
  });

  ['#cpf', '#cpf2'].forEach(id => $(id).addEventListener('input', e => { e.target.value = U.maskCPF(e.target.value); e.target.parentElement.classList.remove('err'); }));
  $('#nome').addEventListener('input', e => e.target.parentElement.classList.remove('err'));

  try { // preenche nome/CPF na próxima visita (só neste aparelho)
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
    state.enviando = true; const btn = $('#go'); btn.disabled = true; btn.textContent = 'Confirmando…';
    try {
      const r = await API.rpc('spin_checkin', { p_nome: nome, p_cpf: cpf, p_horario_id: state.slot.horario_id, p_data: state.slot.data });
      if (!r.ok) { msg(r.erro); await carregar(true); return; }
      try { localStorage.setItem('gc_aluno', JSON.stringify({ nome, cpf })); } catch {}
      limparMsg(); abrirTicket(r); state.slot = null; await carregar(true);
    } catch (err) { msg(err.message); }
    finally { state.enviando = false; btn.textContent = 'Confirmar check-in'; renderResumo(); }
  });

  // ---------- comprovante ----------
  function abrirTicket(r) {
    $('#tkNome').textContent = r.nome;
    $('#tkDia').textContent = r.data === U.hoje() ? 'Hoje' : U.dataBR(r.data);
    $('#tkHora').textContent = r.hora;
    $('#tkCode').textContent = r.codigo;
    $('#tkNote').textContent = `Você é o ${r.posicao}º de ${r.vagas} na turma${r.instrutor ? ' com ' + r.instrutor : ''}. Mostre este código na recepção ao chegar.`;
    $('#overlay').classList.add('show'); $('#tkClose').focus();
  }
  function fecharTicket() { $('#overlay').classList.remove('show'); }
  $('#tkClose').addEventListener('click', fecharTicket);
  $('#overlay').addEventListener('click', e => { if (e.target.id === 'overlay') fecharTicket(); });
  addEventListener('keydown', e => { if (e.key === 'Escape') fecharTicket(); });

  // ---------- consultar / cancelar ----------
  async function consultar() {
    const cpf = U.so($('#cpf2').value), box = $('#mine');
    if (!U.cpfOk(cpf)) { box.innerHTML = `<p class="none">Digite um CPF válido.</p>`; return; }
    box.innerHTML = `<p class="none">Buscando…</p>`;
    try {
      const l = await API.rpc('spin_meus_checkins', { p_cpf: cpf });
      if (!l.length) { box.innerHTML = `<p class="none">Nenhum check-in ativo para este CPF.</p>`; return; }
      box.innerHTML = l.map(c => `<div class="mine-item"><div><strong>${c.hora} · ${c.data === U.hoje() ? 'Hoje' : U.dataBR(c.data)}</strong>
        <small>${c.codigo} · ${c.status === 'presente' ? 'presença confirmada' : 'confirmado'}</small></div>
        ${c.cancelavel ? `<button type="button" data-id="${c.id}">Cancelar</button>` : ''}</div>`).join('');
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

  carregar(false);
  setInterval(() => { if (!document.hidden && !state.enviando) carregar(true); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) carregar(true); });
})();
