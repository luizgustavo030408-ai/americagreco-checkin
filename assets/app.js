(() => {
  const $ = s => document.querySelector(s);
  const st = { aulas: [], aula: null, tipo: null, enviando: false };

  // ---------- dados ----------
  async function carregar() {
    try { st.aulas = await API.rpc('spin_aulas_abertas'); }
    catch { $('#aulas').innerHTML = `<div class="empty">Não foi possível carregar as aulas agora. Atualize a página.</div>`; return; }
    if (st.aula) st.aula = st.aulas.find(a => a.aula_id === st.aula.aula_id) || null;
    if (!st.aula) st.aula = st.aulas.find(a => !a.encerrada && livres(a, 'aluno') + livres(a, 'externo') > 0) || null;
    if (st.aula && st.tipo && livres(st.aula, st.tipo) === 0) st.tipo = null;
    render();
  }
  const livres = (a, t) => Math.max(0, t === 'aluno' ? a.vagas_aluno - a.ocup_aluno : a.vagas_externo - a.ocup_externo);

  function render() {
    const el = $('#aulas');
    if (!st.aulas.length) {
      el.innerHTML = `<div class="empty">Nenhuma aula de spinning aberta no momento.<br>Fique de olho no Instagram <a href="https://www.instagram.com/americagreco_/" target="_blank" rel="noopener">@americagreco_</a>.</div>`;
    } else {
      el.innerHTML = st.aulas.map(a => {
        const tot = livres(a, 'aluno') + livres(a, 'externo');
        const off = a.encerrada || tot === 0;
        const on = st.aula && st.aula.aula_id === a.aula_id;
        return `<button type="button" class="aula ${on ? 'on' : ''} ${off ? 'off' : ''}" data-id="${a.aula_id}" ${off ? 'disabled' : ''}>
          <span class="a-dia"><small>${U.rotulo(a.data)}</small><strong>${U.dataBR(a.data)}</strong></span>
          <span class="a-info"><strong>${a.hora} · ${U.esc(a.titulo)}</strong>
            <small>${a.encerrada ? 'Encerrada' : tot === 0 ? 'Esgotada' : `${tot} ${tot === 1 ? 'bike livre' : 'bikes livres'}`}${a.instrutor ? ' · com ' + U.esc(a.instrutor) : ''}</small></span>
          <span class="a-check" aria-hidden="true"></span></button>`;
      }).join('');
    }
    // tipos
    const a = st.aula;
    ['aluno', 'externo'].forEach(t => {
      const b = document.querySelector(`.tipo[data-t="${t}"]`);
      const l = a ? livres(a, t) : 0, total = a ? (t === 'aluno' ? a.vagas_aluno : a.vagas_externo) : 0;
      b.disabled = !a || l === 0;
      b.classList.toggle('on', st.tipo === t);
      b.classList.toggle('low', !!a && l > 0 && l <= 3);
      $(t === 'aluno' ? '#vAluno' : '#vExterno').textContent = !a ? '—' : total === 0 ? 'Sem vagas nesta aula' : l === 0 ? 'Esgotado' : `${l} de ${total} vagas livres`;
    });
    resumo();
  }

  function resumo() {
    const a = st.aula;
    if (!a) { $('#sel').textContent = 'Escolha a aula para continuar'; $('#go').disabled = true; return; }
    $('#sel').innerHTML = `<b>${a.hora}</b> · ${U.dataLonga(a.data)}${st.tipo ? `<br><span class="t-sel">${st.tipo === 'aluno' ? 'Aluno da academia' : 'Externo'}</span>` : ''}`;
    $('#go').disabled = !st.tipo;
  }

  function msg(t, tipo = 'err') { const m = $('#msg'); m.className = `msg ${tipo} show`; m.textContent = t; }
  function limparMsg() { $('#msg').className = 'msg'; }

  // ---------- eventos ----------
  $('#aulas').addEventListener('click', e => {
    const b = e.target.closest('.aula'); if (!b || b.disabled) return;
    st.aula = st.aulas.find(a => a.aula_id === +b.dataset.id);
    if (st.tipo && livres(st.aula, st.tipo) === 0) st.tipo = null;
    limparMsg(); render();
  });
  $('#tipos').addEventListener('click', e => {
    const b = e.target.closest('.tipo'); if (!b || b.disabled) return;
    st.tipo = b.dataset.t; limparMsg(); render();
    if (!$('#nome').value) $('#nome').focus();
  });

  ['#cpf', '#cpf2'].forEach(id => $(id).addEventListener('input', e => { e.target.value = U.maskCPF(e.target.value); e.target.parentElement.classList.remove('err'); }));
  $('#tel').addEventListener('input', e => { e.target.value = U.maskTel(e.target.value); e.target.parentElement.classList.remove('err'); });
  $('#nome').addEventListener('input', e => e.target.parentElement.classList.remove('err'));

  try { // preenche os dados na próxima visita (só neste aparelho)
    const s = JSON.parse(localStorage.getItem('gc_aluno') || 'null');
    if (s) {
      $('#nome').value = s.nome || ''; $('#cpf').value = U.maskCPF(s.cpf || ''); $('#cpf2').value = U.maskCPF(s.cpf || '');
      $('#tel').value = U.maskTel(s.tel || ''); if (s.tipo) st.tipo = s.tipo;
    }
  } catch {}

  $('#form').addEventListener('submit', async e => {
    e.preventDefault();
    if (st.enviando) return;
    const nome = $('#nome').value.trim().replace(/\s+/g, ' '), cpf = U.so($('#cpf').value), tel = U.so($('#tel').value);
    if (!st.aula) return msg('Escolha a aula.');
    if (!st.tipo) return msg('Diga se você é aluno da academia ou externo.');
    if (nome.length < 5 || !nome.includes(' ')) { $('#nome').parentElement.classList.add('err'); return msg('Informe seu nome completo.'); }
    if (!U.cpfOk(cpf)) { $('#cpf').parentElement.classList.add('err'); return msg('CPF inválido. Confira os números.'); }
    if (tel && (tel.length < 10 || tel.length > 11)) { $('#tel').parentElement.classList.add('err'); return msg('WhatsApp inválido. Use DDD + número.'); }
    st.enviando = true; const btn = $('#go'); btn.disabled = true; btn.textContent = 'Confirmando…';
    try {
      const r = await API.rpc('spin_checkin', { p_aula_id: st.aula.aula_id, p_tipo: st.tipo, p_nome: nome, p_cpf: cpf, p_telefone: tel });
      if (!r.ok) { msg(r.erro); await carregar(); return; }
      try { localStorage.setItem('gc_aluno', JSON.stringify({ nome, cpf, tel, tipo: st.tipo })); } catch {}
      limparMsg(); ticket(r); await carregar();
    } catch (err) { msg(err.message); }
    finally { st.enviando = false; btn.textContent = 'Confirmar check-in'; resumo(); }
  });

  // ---------- comprovante ----------
  function ticket(r) {
    $('#tkNome').textContent = r.nome;
    $('#tkDia').textContent = r.data === U.hoje() ? 'Hoje' : U.dataBR(r.data);
    $('#tkHora').textContent = r.hora;
    $('#tkCode').textContent = r.codigo;
    $('#tkNote').textContent = `${r.tipo === 'aluno' ? 'Vaga de aluno' : 'Vaga externa'} · ${r.posicao}º de ${r.vagas}. Mostre este código na recepção e chegue 5 min antes para ajustar a bike.`;
    $('#overlay').classList.add('show'); $('#tkClose').focus();
  }
  const fechar = () => $('#overlay').classList.remove('show');
  $('#tkClose').addEventListener('click', fechar);
  $('#overlay').addEventListener('click', e => { if (e.target.id === 'overlay') fechar(); });
  addEventListener('keydown', e => { if (e.key === 'Escape') fechar(); });

  // ---------- consultar / cancelar ----------
  async function consultar() {
    const cpf = U.so($('#cpf2').value), box = $('#mine');
    if (!U.cpfOk(cpf)) { box.innerHTML = `<p class="none">Digite um CPF válido.</p>`; return; }
    box.innerHTML = `<p class="none">Buscando…</p>`;
    try {
      const l = await API.rpc('spin_meus_checkins', { p_cpf: cpf });
      if (!l.length) { box.innerHTML = `<p class="none">Nenhum check-in ativo para este CPF.</p>`; return; }
      box.innerHTML = l.map(c => `<div class="mine-item"><div><strong>${c.hora} · ${c.data === U.hoje() ? 'Hoje' : U.dataBR(c.data)}</strong>
        <small>${c.codigo} · ${c.tipo === 'aluno' ? 'aluno' : 'externo'}${c.status === 'presente' ? ' · presença confirmada' : ''}</small></div>
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
      await consultar(); await carregar();
    } catch (err) { alert(err.message); }
  });

  carregar();
  setInterval(() => { if (!document.hidden && !st.enviando) carregar(); }, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) carregar(); });
})();
