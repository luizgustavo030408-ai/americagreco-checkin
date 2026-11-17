(() => {
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const st = {
    token: null, me: null, tab: 'aulas', filtro: 'proximas', aulas: [],
    aula: null, pessoas: [], fPessoas: 'todos', busca: '',
    ver: null, vistos: null, editId: null, addTipo: 'aluno', addForma: 'Pix', payId: null,
    rel: { p: 'mes', ini: null, fim: null, aulas: [] }
  };
  const LS = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} }, del(k) { try { localStorage.removeItem(k); } catch {} } };

  // ---------- utilitários ----------
  async function call(fn, args = {}) {
    try { return await API.rpc(fn, { p_token: st.token, ...args }); }
    catch (e) { if (e.code === '28000') { sair(true); toast('Sua sessão expirou. Entre novamente.'); } throw e; }
  }
  function toast(t, cls = '') {
    const el = $('#toast'); el.textContent = t; el.className = `toast show ${cls}`;
    clearTimeout(el._t); el._t = setTimeout(() => el.className = 'toast', cls ? 5000 : 2800);
  }
  const msg = (id, t, tipo = 'err') => { const m = $(id); m.className = `msg ${tipo} show`; m.textContent = t; };
  const clearMsg = id => $(id).className = 'msg';
  const hoje = () => U.hoje();
  const pct = (a, b) => b ? Math.min(100, Math.round(a / b * 100)) : 0;
  const statusAula = a => a.status === 'cancelada' ? 'cancelada' : a.encerrada ? 'encerrada' : 'aberta';
  const rotStatus = { aberta: 'Aberta', cancelada: 'Cancelada', encerrada: 'Realizada' };
  const waLink = t => t ? `https://wa.me/55${t}` : null;
  const telFmt = t => t ? U.maskTel(t) : '';
  function download(nome, linhas) {
    const csv = '﻿' + linhas.map(l => l.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = nome; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- login ----------
  async function iniciar(token) {
    st.token = token;
    try { st.me = await call('spin_admin_me'); }
    catch { return; }
    $('#login').hidden = true; $('#app').hidden = false;
    $('#ola').textContent = 'Olá, ' + st.me.nome.split(' ')[0];
    $('#cNome').textContent = st.me.nome;
    const link = location.origin + '/';
    $('#pubLink').textContent = link.replace(/^https?:\/\//, '');
    $('#wa').href = 'https://wa.me/?text=' + encodeURIComponent(`🚴 Aula de Spinning na América Greco!\nGaranta sua bike pelo check-in: ${link}`);
    abrirTab('aulas');
    vigiar();
  }
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault(); clearMsg('#loginMsg');
    const b = e.target.querySelector('button'); b.disabled = true; b.textContent = 'Entrando…';
    try {
      const r = await API.rpc('spin_login', { p_usuario: $('#lUser').value, p_senha: $('#lPass').value });
      if (!r.ok) return msg('#loginMsg', r.erro);
      LS.set('gc_tk', r.token); $('#lPass').value = '';
      await iniciar(r.token);
    } catch (err) { msg('#loginMsg', err.message); }
    finally { b.disabled = false; b.textContent = 'Entrar'; }
  });
  function sair(silencioso) {
    if (!silencioso && st.token) API.rpc('spin_logout', { p_token: st.token }).catch(() => {});
    st.token = null; LS.del('gc_tk'); clearInterval(st.timer);
    $('#app').hidden = true; $('#login').hidden = false;
  }
  $('#sair').addEventListener('click', () => { if (confirm('Sair do painel?')) sair(); });

  // ---------- navegação ----------
  function abrirTab(tab) {
    st.tab = tab;
    $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    $$('.pane').forEach(p => p.hidden = p.id !== 'pane-' + tab);
    scrollTo({ top: 0 });
    if (tab === 'aulas') carregarAulas();
    if (tab === 'relatorio') carregarRel();
  }
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) abrirTab(b.dataset.tab); });

  // ---------- "ao vivo" ----------
  function vigiar() {
    clearInterval(st.timer);
    const tick = async () => {
      if (document.hidden || !st.token) return;
      try {
        const r = await call('spin_admin_versao');
        $('#live').className = 'live'; $('#live').innerHTML = '<i></i>Ao vivo';
        const chave = r.v + '|' + r.n;
        const novos = r.novos || [];
        if (st.vistos === null) st.vistos = new Set(novos.map(x => x.id));
        else novos.filter(x => !st.vistos.has(x.id)).forEach(x => {
          st.vistos.add(x.id);
          toast(`Novo check-in: ${x.nome.split(' ')[0]} · ${x.tipo === 'aluno' ? 'aluno' : 'externo'} · ${U.dataBR(x.data)} ${x.hora}`, 'novo');
        });
        if (st.ver !== null && st.ver !== chave) atualizarTela();
        st.ver = chave;
      } catch (e) { if (e.code !== '28000') { $('#live').className = 'live off'; $('#live').innerHTML = '<i></i>Sem conexão'; } }
    };
    tick(); st.timer = setInterval(tick, 5000);
  }
  function atualizarTela() {
    if (st.tab === 'aulas') carregarAulas(true);
    else if (st.tab === 'aula' && st.aula) abrirAula(st.aula.id, true);
    else if (st.tab === 'relatorio') carregarRel(true);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && st.token) atualizarTela(); });

  // =====================================================================
  // AULAS
  // =====================================================================
  $('#segAulas').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    st.filtro = b.dataset.f; $$('#segAulas button').forEach(x => x.classList.toggle('on', x === b)); carregarAulas();
  });

  async function carregarAulas(silencioso) {
    const h = hoje();
    const [ini, fim] = st.filtro === 'proximas' ? [h, U.addDias(h, 400)] : [U.addDias(h, -400), U.addDias(h, -1)];
    if (!silencioso) $('#alist').innerHTML = '<div class="empty">Carregando…</div>';
    try { st.aulas = await call('spin_admin_aulas', { p_inicio: ini, p_fim: fim }); } catch (e) { return toast(e.message); }
    if (st.filtro === 'anteriores') st.aulas.reverse();
    renderAulas();
  }

  function cardAula(a) {
    const s = statusAula(a);
    const row = (rot, o, v, cls) => `<div class="bar-row"><span>${rot}</span><div class="meter2 ${cls} ${v && o >= v ? 'full' : ''}"><i style="width:${pct(o, v)}%"></i></div><b>${o}/${v}</b></div>`;
    return `<button class="acard ${s}" data-id="${a.id}">
      <div class="ac-top">
        <div class="ac-dia"><small>${U.rotulo(a.data)}</small><strong>${U.dataBR(a.data)}</strong></div>
        <div class="ac-info"><strong>${a.hora} · ${U.esc(a.titulo)}</strong><small>${U.dataLonga(a.data)}${a.instrutor ? ' · ' + U.esc(a.instrutor) : ''}</small></div>
        <span class="badge ${s}">${rotStatus[s]}</span>
      </div>
      <div class="bars">${row('Alunos', a.ocup_aluno, a.vagas_aluno, '')}${row('Externos', a.ocup_externo, a.vagas_externo, 'ext')}</div>
      <div class="ac-foot"><span>Diárias: <b>${U.brl(a.recebido)}</b> recebido</span><span>${Number(a.previsto) > Number(a.recebido) ? U.brl(a.previsto - a.recebido) + ' a receber' : a.presentes ? a.presentes + ' presentes' : ''}</span></div>
    </button>`;
  }
  function renderAulas() {
    const el = $('#alist');
    if (!st.aulas.length) {
      el.innerHTML = st.filtro === 'proximas'
        ? `<div class="empty">Nenhuma aula agendada.<br><button class="btn btn-dark" data-nova>+ Criar primeira aula</button></div>`
        : `<div class="empty">Nenhuma aula anterior.</div>`;
      return;
    }
    el.innerHTML = st.aulas.map(cardAula).join('');
  }
  $('#alist').addEventListener('click', e => {
    if (e.target.closest('[data-nova]')) return abrirFormAula(null);
    const c = e.target.closest('.acard'); if (c) abrirAula(+c.dataset.id);
  });

  // ---------- detalhe ----------
  async function abrirAula(id, silencioso) {
    let r; try { r = await call('spin_admin_aula', { p_id: id }); } catch (e) { return toast(e.message); }
    if (!r.ok) return toast(r.erro);
    st.aula = r.aula; st.pessoas = r.pessoas;
    if (st.tab !== 'aula') {
      st.tab = 'aula'; st.fPessoas = 'todos'; st.busca = ''; $('#busca').value = '';
      $$('#segPessoas button').forEach(b => b.classList.toggle('on', b.dataset.f === 'todos'));
      $$('.pane').forEach(p => p.hidden = p.id !== 'pane-aula');
      $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === 'aulas'));
      if (!silencioso) scrollTo({ top: 0 });
    }
    renderAula();
  }
  $('#voltar').addEventListener('click', () => abrirTab('aulas'));

  function renderAula() {
    const a = st.aula, s = statusAula(a);
    $('#dEyebrow').innerHTML = `<span class="badge ${s}">${rotStatus[s]}</span>`;
    $('#dTitulo').textContent = U.dataLonga(a.data) + ' · ' + a.hora;
    $('#dSub').textContent = [a.titulo, a.instrutor && 'com ' + a.instrutor, Number(a.valor_diaria) > 0 && 'diária ' + U.brl(a.valor_diaria), a.obs].filter(Boolean).join(' · ');
    $('#mStatus').textContent = a.status === 'cancelada' ? 'Reabrir aula' : 'Cancelar aula';
    $('#dKpis').innerHTML = `
      <div class="kpi"><small>Alunos</small><strong>${a.ocup_aluno}<span>/${a.vagas_aluno}</span></strong><span>${Math.max(0, a.vagas_aluno - a.ocup_aluno)} vagas livres</span></div>
      <div class="kpi"><small>Externos</small><strong>${a.ocup_externo}<span>/${a.vagas_externo}</span></strong><span>${Math.max(0, a.vagas_externo - a.ocup_externo)} vagas livres</span></div>
      <div class="kpi"><small>Presentes</small><strong>${a.presentes}</strong><span>de ${a.ocup_aluno + a.ocup_externo} check-ins</span></div>
      <div class="kpi dark"><small>Diárias recebidas</small><strong>${U.brl(a.recebido)}</strong><span>de ${U.brl(a.previsto)} previsto</span></div>`;
    renderPessoas();
  }

  function linhaPessoa(p) {
    const st_ = p.status;
    const pay = p.tipo === 'externo' && Number(p.valor) > 0 && st_ !== 'cancelado'
      ? `<button class="paybtn ${p.pago ? 'pago' : ''}" data-pay="${p.id}">${p.pago ? '✓ Pago' + (p.forma ? ' · ' + p.forma : '') : 'A pagar ' + U.brl(p.valor)}</button>` : '';
    const hora = new Date(p.criado).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return `<div class="pessoa ${st_}">
      <div>
        <div class="p-nome">${U.esc(p.nome)}<span class="tag ${p.tipo}">${p.tipo}</span>${st_ !== 'confirmado' ? `<span class="tag ${st_}">${st_}</span>` : ''}</div>
        <div class="p-meta"><span>${U.maskCPF(p.cpf)}</span>${p.telefone ? `<a href="${waLink(p.telefone)}" target="_blank" rel="noopener">WhatsApp ${telFmt(p.telefone)}</a>` : ''}<span>${p.codigo}</span><span>${p.origem === 'painel' ? 'adicionado no painel' : 'check-in ' + hora}</span></div>
      </div>
      <div class="p-acts">${pay}
        <button class="ic ${st_ === 'presente' ? 'on-p' : ''}" data-s="presente" data-id="${p.id}" title="Presente" aria-label="Marcar presente">✓</button>
        <button class="ic ${st_ === 'falta' ? 'on-f' : ''}" data-s="falta" data-id="${p.id}" title="Faltou" aria-label="Marcar falta">✕</button>
        <button class="ic ${st_ === 'cancelado' ? 'on-c' : ''}" data-s="cancelado" data-id="${p.id}" title="Cancelar check-in" aria-label="Cancelar check-in">⊘</button>
      </div></div>`;
  }
  function renderPessoas() {
    const q = st.busca.toLowerCase(), qd = U.so(st.busca);
    const filtra = l => l.filter(p => (st.fPessoas === 'todos' || p.tipo === st.fPessoas) && (!q || p.nome.toLowerCase().includes(q) || (qd && p.cpf.includes(qd))));
    const a = st.aula;
    const grupo = (tipo, rot, vagas) => {
      const l = filtra(st.pessoas.filter(p => p.tipo === tipo));
      const ativos = st.pessoas.filter(p => p.tipo === tipo && p.status !== 'cancelado').length;
      if (st.fPessoas !== 'todos' && st.fPessoas !== tipo) return '';
      return `<div class="grupo"><span>${rot}</span><span>${ativos}/${vagas}</span></div>` +
        (l.length ? l.map(linhaPessoa).join('') : `<div class="empty">${q ? 'Ninguém encontrado.' : 'Nenhum check-in ainda.'}</div>`);
    };
    $('#plist').innerHTML = grupo('aluno', 'Alunos da academia', a.vagas_aluno) + grupo('externo', 'Externos (diária)', a.vagas_externo);
  }
  $('#segPessoas').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    st.fPessoas = b.dataset.f; $$('#segPessoas button').forEach(x => x.classList.toggle('on', x === b)); renderPessoas();
  });
  $('#busca').addEventListener('input', e => { st.busca = e.target.value.trim(); renderPessoas(); });

  $('#plist').addEventListener('click', async e => {
    const pb = e.target.closest('[data-pay]');
    if (pb) return abrirPayMenu(pb, +pb.dataset.pay);
    const b = e.target.closest('.ic[data-s]'); if (!b) return;
    const p = st.pessoas.find(x => x.id === +b.dataset.id); if (!p) return;
    let novo = b.dataset.s; if (p.status === novo) novo = 'confirmado';
    if (novo === 'cancelado' && !confirm(`Cancelar o check-in de ${p.nome}? A vaga volta a ficar livre no site.`)) return;
    b.disabled = true;
    try {
      const r = await call('spin_admin_status', { p_id: p.id, p_status: novo });
      if (!r.ok) toast(r.erro);
      await abrirAula(st.aula.id, true);
    } catch (err) { toast(err.message); b.disabled = false; }
  });

  // pagamento
  function abrirPayMenu(btn, id) {
    const m = $('#payMenu'), r = btn.getBoundingClientRect(), p = st.pessoas.find(x => x.id === id);
    st.payId = id; m.hidden = false;
    m.querySelector('.undo').hidden = !p.pago;
    const w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left)) + 'px';
    m.style.top = (r.bottom + h + 8 > innerHeight ? r.top - h - 8 : r.bottom + 8) + 'px';
  }
  document.addEventListener('click', e => {
    if (!e.target.closest('#payMenu') && !e.target.closest('[data-pay]')) $('#payMenu').hidden = true;
    if (!e.target.closest('#dMenu') && !e.target.closest('#dMais')) $('#dMenu').hidden = true;
  });
  $('#payMenu').addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    const desfazer = b.dataset.f === '__desfazer';
    $('#payMenu').hidden = true;
    try {
      await call('spin_admin_pagamento', { p_id: st.payId, p_pago: !desfazer, p_forma: desfazer ? null : b.dataset.f });
      toast(desfazer ? 'Pagamento desmarcado.' : `Diária paga (${b.dataset.f}).`);
      await abrirAula(st.aula.id, true);
    } catch (err) { toast(err.message); }
  });

  // menu "Mais"
  $('#dMais').addEventListener('click', () => $('#dMenu').hidden = !$('#dMenu').hidden);
  $('#dEditar').addEventListener('click', () => abrirFormAula(st.aula));
  $('#dMenu').addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return; $('#dMenu').hidden = true;
    const a = st.aula, ativos = st.pessoas.filter(p => p.status !== 'cancelado');
    const titulo = `${U.dataLonga(a.data)} · ${a.hora} · ${a.titulo}`;
    if (b.dataset.a === 'whats') {
      const lista = t => ativos.filter(p => p.tipo === t).map((p, i) => `${i + 1}. ${p.nome}${t === 'externo' ? (p.pago ? ' ✅' : ' (a pagar)') : ''}`).join('\n') || '—';
      const txt = `🚴 *${a.titulo}* — ${U.dataLonga(a.data)} às ${a.hora}\n\n*Alunos (${a.ocup_aluno}/${a.vagas_aluno})*\n${lista('aluno')}\n\n*Externos (${a.ocup_externo}/${a.vagas_externo})*\n${lista('externo')}`;
      try { await navigator.clipboard.writeText(txt); toast('Lista copiada! É só colar no WhatsApp.'); } catch { prompt('Copie a lista:', txt); }
    }
    if (b.dataset.a === 'csv') {
      download(`spinning_${a.data}_${a.hora.replace(':', 'h')}.csv`, [['Tipo', 'Nome', 'CPF', 'WhatsApp', 'Status', 'Diária', 'Pago', 'Forma', 'Código', 'Check-in em']]
        .concat(st.pessoas.map(p => [p.tipo, p.nome, U.maskCPF(p.cpf), telFmt(p.telefone), p.status, p.tipo === 'externo' ? U.brl(p.valor) : '', p.tipo === 'externo' ? (p.pago ? 'sim' : 'não') : '', p.forma || '', p.codigo, new Date(p.criado).toLocaleString('pt-BR')])));
    }
    if (b.dataset.a === 'print') {
      const linhas = ativos.map((p, i) => `<tr><td>${i + 1}</td><td>${U.esc(p.nome)}</td><td>${p.tipo}</td><td>${U.maskCPF(p.cpf)}</td><td>${p.tipo === 'externo' ? (p.pago ? 'Pago' : U.brl(p.valor)) : '—'}</td><td class="box">☐</td></tr>`).join('');
      $('#printArea').innerHTML = `<h1>${U.esc(titulo)}</h1><p>Alunos ${a.ocup_aluno}/${a.vagas_aluno} · Externos ${a.ocup_externo}/${a.vagas_externo}</p><br>
        <table><thead><tr><th>#</th><th>Nome</th><th>Tipo</th><th>CPF</th><th>Diária</th><th>Presença</th></tr></thead><tbody>${linhas || '<tr><td colspan="6">Sem check-ins.</td></tr>'}</tbody></table>`;
      print();
    }
    if (b.dataset.a === 'status') {
      const cancelar = a.status !== 'cancelada';
      if (cancelar && !confirm(`Cancelar a aula de ${titulo}?\n\nEla some do site.${ativos.length ? `\n${ativos.length} pessoa(s) já fizeram check-in — avise pelo WhatsApp.` : ''}`)) return;
      try { await call('spin_admin_aula_status', { p_id: a.id, p_status: cancelar ? 'cancelada' : 'aberta' }); toast(cancelar ? 'Aula cancelada.' : 'Aula reaberta.'); abrirAula(a.id, true); }
      catch (err) { toast(err.message); }
    }
    if (b.dataset.a === 'excluir') {
      if (!confirm(`Excluir de vez a aula de ${titulo}?`)) return;
      try { const r = await call('spin_admin_aula_excluir', { p_id: a.id }); if (!r.ok) return alert(r.erro); toast('Aula excluída.'); abrirTab('aulas'); }
      catch (err) { toast(err.message); }
    }
  });

  // ---------- adicionar pessoa ----------
  const abrirModal = id => { $(id).classList.add('show'); };
  const fecharModal = id => $(id).classList.remove('show');
  $$('[data-close]').forEach(b => b.addEventListener('click', () => fecharModal('#' + b.closest('.overlay').id)));
  $$('.overlay').forEach(o => o.addEventListener('click', e => { if (e.target === o) fecharModal('#' + o.id); }));
  addEventListener('keydown', e => { if (e.key === 'Escape') $$('.overlay.show').forEach(o => fecharModal('#' + o.id)); });

  $('#btnAdd').addEventListener('click', () => {
    st.addTipo = 'aluno'; ['#pNome', '#pCpf', '#pTel'].forEach(i => $(i).value = ''); $('#pPago').checked = false;
    syncAdd(); clearMsg('#pMsg'); abrirModal('#mPessoa'); setTimeout(() => $('#pNome').focus(), 50);
  });
  function syncAdd() {
    $$('#pTipo button').forEach(b => b.classList.toggle('on', b.dataset.t === st.addTipo));
    $('#pPagWrap').hidden = st.addTipo !== 'externo' || !(Number(st.aula?.valor_diaria) > 0);
    $('#pForma').hidden = !$('#pPago').checked;
    $$('#pForma button').forEach(b => b.classList.toggle('on', b.dataset.f === st.addForma));
  }
  $('#pTipo').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { st.addTipo = b.dataset.t; syncAdd(); } });
  $('#pPago').addEventListener('change', syncAdd);
  $('#pForma').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { st.addForma = b.dataset.f; syncAdd(); } });
  $('#pCpf').addEventListener('input', e => e.target.value = U.maskCPF(e.target.value));
  $('#pTel').addEventListener('input', e => e.target.value = U.maskTel(e.target.value));
  $('#fPessoa').addEventListener('submit', async e => {
    e.preventDefault(); clearMsg('#pMsg');
    try {
      const r = await call('spin_admin_add', { p_aula_id: st.aula.id, p_tipo: st.addTipo, p_nome: $('#pNome').value, p_cpf: U.so($('#pCpf').value),
        p_telefone: U.so($('#pTel').value), p_pago: $('#pPago').checked, p_forma: st.addForma });
      if (!r.ok) return msg('#pMsg', r.erro);
      fecharModal('#mPessoa'); toast(r.acima_do_limite ? 'Adicionado (acima do limite de vagas).' : 'Pessoa adicionada.');
      abrirAula(st.aula.id, true);
    } catch (err) { msg('#pMsg', err.message); }
  });

  // ---------- criar / editar aula ----------
  $('#btnNova').addEventListener('click', () => abrirFormAula(null));
  function proximaTerca() { let d = hoje(); for (let i = 0; i < 7; i++) { if (U.dow(d) === 2) return d; d = U.addDias(d, 1); } return hoje(); }
  function abrirFormAula(a) {
    st.editId = a ? a.id : null; clearMsg('#aMsg');
    let base = a;
    if (!a) { try { base = JSON.parse(LS.get('gc_ult_aula') || 'null'); } catch {} }
    base = base || { hora: '19:00', titulo: 'Aula Spinning', vagas_aluno: 12, vagas_externo: 10, valor_diaria: 50 };
    $('#fAulaTit').textContent = a ? 'Editar aula' : 'Nova aula';
    $('#aSalvar').textContent = a ? 'Salvar alterações' : 'Criar aula';
    $('#aData').value = a ? a.data : (base.data && base.data >= hoje() ? U.addDias(base.data, 7) : proximaTerca());
    $('#aHora').value = base.hora; $('#aTitulo').value = base.titulo || 'Aula Spinning';
    $('#aVA').value = base.vagas_aluno; $('#aVE').value = base.vagas_externo; $('#aValor').value = Number(base.valor_diaria);
    $('#aInstr').value = a ? (a.instrutor || '') : (base.instrutor || ''); $('#aObs').value = a ? (a.obs || '') : '';
    $('#aRepWrap').hidden = !!a; $('#aRep').checked = false; $('#aRepN').hidden = true;
    syncFormAula(); abrirModal('#mAula');
  }
  function syncFormAula() {
    const va = +$('#aVA').value || 0, ve = +$('#aVE').value || 0;
    $('#aTotal').innerHTML = `<b>${va + ve}</b> bikes no total · ${va} para alunos + ${ve} para externos`;
    $('#aRepN').hidden = !$('#aRep').checked;
    if ($('#aRep').checked && $('#aData').value) {
      const n = Math.max(2, Math.min(52, +$('#aSem').value || 2));
      const ds = Array.from({ length: n }, (_, i) => U.dataBR(U.addDias($('#aData').value, i * 7)));
      $('#aRepTxt').textContent = `Cria ${n} aulas: ${ds.slice(0, 6).join(', ')}${n > 6 ? '…' : ''}`;
    }
  }
  ['#aVA', '#aVE', '#aRep', '#aSem', '#aData'].forEach(i => $(i).addEventListener('input', syncFormAula));
  $('#aRep').addEventListener('change', syncFormAula);
  $('#fAula').addEventListener('submit', async e => {
    e.preventDefault(); clearMsg('#aMsg');
    const d = { data: $('#aData').value, hora: $('#aHora').value, titulo: $('#aTitulo').value.trim() || 'Aula Spinning',
      vagas_aluno: +$('#aVA').value || 0, vagas_externo: +$('#aVE').value || 0, valor_diaria: +$('#aValor').value || 0, instrutor: $('#aInstr').value.trim() };
    if (!d.data || !d.hora) return msg('#aMsg', 'Informe o dia e o horário.');
    if (!st.editId && d.data < hoje()) return msg('#aMsg', 'Essa data já passou.');
    const sem = !st.editId && $('#aRep').checked ? Math.max(2, Math.min(52, +$('#aSem').value || 2)) : 1;
    try {
      const r = await call('spin_admin_aula_salvar', { p_id: st.editId, p_data: d.data, p_hora: d.hora, p_titulo: d.titulo,
        p_vagas_aluno: d.vagas_aluno, p_vagas_externo: d.vagas_externo, p_valor: d.valor_diaria, p_instrutor: d.instrutor, p_obs: $('#aObs').value, p_repetir_semanas: sem });
      if (!r.ok) return msg('#aMsg', r.erro);
      LS.set('gc_ult_aula', JSON.stringify(d));
      fecharModal('#mAula');
      if (st.editId) { toast('Aula atualizada.'); abrirAula(st.editId, true); }
      else {
        const ja = (r.ja_existiam || []).length ? ` (já existia em ${r.ja_existiam.join(', ')})` : '';
        toast(r.criadas ? `${r.criadas} ${r.criadas === 1 ? 'aula criada' : 'aulas criadas'}${ja}. Já estão no site!` : 'Essa aula já existia' + ja);
        abrirTab('aulas');
      }
    } catch (err) { msg('#aMsg', err.message); }
  });

  // =====================================================================
  // RELATÓRIO
  // =====================================================================
  function periodo(p) {
    const h = hoje(), [y, m] = h.split('-').map(Number);
    const ultimo = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10);
    if (p === 'mes') return [`${y}-${String(m).padStart(2, '0')}-01`, ultimo(y, m)];
    if (p === 'passado') { const yy = m === 1 ? y - 1 : y, mm = m === 1 ? 12 : m - 1; return [`${yy}-${String(mm).padStart(2, '0')}-01`, ultimo(yy, mm)]; }
    if (p === '30') return [U.addDias(h, -30), h];
    return [$('#rIni').value || U.addDias(h, -30), $('#rFim').value || h];
  }
  $('#segPer').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    st.rel.p = b.dataset.p; $$('#segPer button').forEach(x => x.classList.toggle('on', x === b));
    $('#perCustom').hidden = st.rel.p !== 'custom';
    if (st.rel.p === 'custom') { const [i, f] = periodo('30'); $('#rIni').value ||= i; $('#rFim').value ||= f; }
    carregarRel();
  });
  $('#rGo').addEventListener('click', () => carregarRel());

  async function carregarRel() {
    const [ini, fim] = periodo(st.rel.p); st.rel.ini = ini; st.rel.fim = fim;
    try { st.rel.aulas = await call('spin_admin_aulas', { p_inicio: ini, p_fim: fim }); } catch (e) { return toast(e.message); }
    const L = st.rel.aulas, val = L.filter(a => a.status !== 'cancelada');
    const soma = k => val.reduce((s, a) => s + Number(a[k] || 0), 0);
    const alunos = soma('ocup_aluno'), ext = soma('ocup_externo'), tot = alunos + ext;
    const realizadas = val.filter(a => a.encerrada);
    const ckReal = realizadas.reduce((s, a) => s + a.ocup_aluno + a.ocup_externo, 0), presReal = realizadas.reduce((s, a) => s + a.presentes, 0);
    const vagas = val.reduce((s, a) => s + a.vagas_aluno + a.vagas_externo, 0);
    $('#rKpis').innerHTML = `
      <div class="kpi"><small>Aulas</small><strong>${val.length}</strong><span>${realizadas.length} realizadas</span></div>
      <div class="kpi"><small>Check-ins</small><strong>${tot}</strong><span>${alunos} alunos · ${ext} externos</span></div>
      <div class="kpi"><small>Ocupação</small><strong>${pct(tot, vagas)}%</strong><span>${ckReal ? pct(presReal, ckReal) + '% de presença' : 'presença: —'}</span></div>
      <div class="kpi dark"><small>Diárias recebidas</small><strong>${U.brl(soma('recebido'))}</strong><span>${U.brl(soma('previsto') - soma('recebido'))} a receber</span></div>`;
    $('#rAulas').innerHTML = L.length ? L.map(a => `<button class="rrow" data-id="${a.id}">
        <span class="d">${U.dataBR(a.data)} ${a.hora}</span>
        <span class="m">${a.status === 'cancelada' ? 'Cancelada' : `${a.ocup_aluno}/${a.vagas_aluno} alunos · ${a.ocup_externo}/${a.vagas_externo} externos${a.encerrada ? ` · ${a.presentes} presentes` : ''}`}</span>
        <span class="v">${U.brl(a.recebido)}<small>de ${U.brl(a.previsto)}</small></span></button>`).join('')
      : '<div class="empty">Nenhuma aula nesse período.</div>';
  }
  $('#rAulas').addEventListener('click', e => { const r = e.target.closest('.rrow'); if (r) abrirAula(+r.dataset.id); });
  $('#rCsv').addEventListener('click', async () => {
    try {
      const l = await call('spin_admin_relatorio', { p_inicio: st.rel.ini, p_fim: st.rel.fim });
      if (!l.length) return toast('Nenhum check-in nesse período.');
      download(`spinning_${st.rel.ini}_a_${st.rel.fim}.csv`, [['Data', 'Hora', 'Aula', 'Tipo', 'Nome', 'CPF', 'WhatsApp', 'Status', 'Diária', 'Pago', 'Forma', 'Código', 'Check-in em']]
        .concat(l.map(r => [U.dataBR(r.data) + '/' + r.data.slice(0, 4), r.hora, r.aula + (r.aula_status === 'cancelada' ? ' (cancelada)' : ''), r.tipo, r.nome, U.maskCPF(r.cpf), telFmt(r.telefone), r.status,
          r.tipo === 'externo' ? U.brl(r.valor) : '', r.tipo === 'externo' ? (r.pago ? 'sim' : 'não') : '', r.forma || '', r.codigo, new Date(r.criado).toLocaleString('pt-BR')])));
    } catch (e) { toast(e.message); }
  });

  // =====================================================================
  // DIVULGAR + CONTA
  // =====================================================================
  $('#copiar').addEventListener('click', async () => {
    const l = location.origin + '/';
    try { await navigator.clipboard.writeText(l); toast('Link copiado!'); } catch { prompt('Copie o link:', l); }
  });
  $('#fSenha').addEventListener('submit', async e => {
    e.preventDefault(); clearMsg('#sMsg');
    if ($('#sNova').value !== $('#sNova2').value) return msg('#sMsg', 'As senhas novas não conferem.');
    try {
      const r = await call('spin_admin_senha', { p_atual: $('#sAtual').value, p_nova: $('#sNova').value });
      if (!r.ok) return msg('#sMsg', r.erro);
      ['#sAtual', '#sNova', '#sNova2'].forEach(i => $(i).value = ''); msg('#sMsg', 'Senha alterada!', 'ok');
    } catch (err) { msg('#sMsg', err.message); }
  });

  // ---------- início ----------
  const tk = LS.get('gc_tk');
  if (tk) iniciar(tk);
})();
