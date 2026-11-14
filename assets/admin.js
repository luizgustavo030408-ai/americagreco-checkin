(() => {
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const g = window.gsap; if (g && window.Flip) g.registerPlugin(Flip);
  const st = { senha: null, data: U.hoje(), turmas: [], horarios: [], rel: [], timer: null, hEdit: null };
  const DIAS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'], DIAS_N = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

  const call = async (fn, args = {}) => {
    try { return await API.rpc(fn, { p_senha: st.senha, ...args }); }
    catch (e) { if (e.code === '28000') { sair(); toast('Sessão expirada. Entre novamente.'); } throw e; }
  };
  function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 2600); }
  function msg(id, t, tipo = 'err') { const m = $(id); m.className = `msg ${tipo} show`; m.textContent = t; }
  const cpfFmt = c => U.maskCPF(c);

  // ---------- login ----------
  async function entrar(senha, silencioso) {
    try {
      const r = await API.rpc('spin_admin_login', { p_senha: senha });
      st.senha = senha; $('#ant').value = r.dias_antecedencia;
      try { sessionStorage.setItem('gc_adm', senha); } catch {}
      $('#login').hidden = true; $('#app').hidden = false;
      if (g) g.from('.bar, .pane-head, .kpi', { y: 20, opacity: 0, duration: .7, stagger: .06, ease: 'power3.out' });
      carregarDia(true);
      st.timer = setInterval(() => { if (!document.hidden && !$('#pane-dia').hidden) carregarDia(false); }, 20000);
    } catch (e) {
      if (!silencioso) msg('#loginMsg', e.code === '28000' ? 'Senha incorreta.' : e.message);
      try { sessionStorage.removeItem('gc_adm'); } catch {}
    }
  }
  function sair() {
    st.senha = null; clearInterval(st.timer);
    try { sessionStorage.removeItem('gc_adm'); } catch {}
    $('#app').hidden = true; $('#login').hidden = false; $('#senha').value = '';
  }
  $('#loginForm').addEventListener('submit', e => { e.preventDefault(); entrar($('#senha').value); });
  $('#sair').addEventListener('click', sair);
  try { const s = sessionStorage.getItem('gc_adm'); if (s) entrar(s, true); } catch {}
  if (g) g.from('.login-card', { y: 40, opacity: 0, duration: 1, ease: 'expo.out' });

  // ---------- abas ----------
  $('#tabs').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#tabs button').forEach(x => x.classList.toggle('on', x === b));
    $$('.pane').forEach(p => p.hidden = p.id !== 'pane-' + b.dataset.tab);
    if (b.dataset.tab === 'dia') carregarDia(true);
    if (b.dataset.tab === 'horarios') carregarHorarios();
    if (b.dataset.tab === 'relatorio' && !$('#rIni').value) { $('#rFim').value = U.hoje(); $('#rIni').value = U.addDias(U.hoje(), -6); gerarRel(); }
    if (b.dataset.tab === 'config') $('#pubLink').textContent = location.origin + '/';
    if (g) g.from(`#pane-${b.dataset.tab} > *`, { y: 16, opacity: 0, duration: .5, stagger: .05, ease: 'power2.out' });
  });

  // ---------- turmas do dia ----------
  function setData(d) { st.data = d; carregarDia(true); }
  $('#prev').addEventListener('click', () => setData(U.addDias(st.data, -1)));
  $('#next').addEventListener('click', () => setData(U.addDias(st.data, 1)));
  $('#hoje').addEventListener('click', () => setData(U.hoje()));
  $('#data').addEventListener('change', e => e.target.value && setData(e.target.value));

  async function carregarDia(animar) {
    $('#data').value = st.data;
    const h = U.hoje();
    $('#diaRot').textContent = st.data === h ? 'Hoje' : st.data === U.addDias(h, 1) ? 'Amanhã' : st.data < h ? 'Dia anterior' : 'Próximo';
    $('#diaTitulo').textContent = U.dataLonga(st.data);
    try { st.turmas = await call('spin_admin_dia', { p_data: st.data }); } catch (e) { return toast(e.message); }
    renderDia(animar);
    $('#upd').textContent = 'atualizado ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function renderDia(animar) {
    const q = $('#busca').value.trim().toLowerCase(), qd = U.so(q);
    let tot = 0, pres = 0, falta = 0, vagas = 0;
    st.turmas.forEach(t => { vagas += t.vagas; t.checkins.forEach(c => { if (c.status !== 'cancelado') tot++; if (c.status === 'presente') pres++; if (c.status === 'falta') falta++; }); });
    $('#kTotal').textContent = tot; $('#kPres').textContent = pres; $('#kFalta').textContent = falta;
    $('#kOcup').textContent = vagas ? Math.round(tot / vagas * 100) + '%' : '—';

    if (!st.turmas.length) { $('#turmas').innerHTML = `<div class="empty" style="grid-column:1/-1">Não há turmas de spinning neste dia.</div>`; return; }
    $('#turmas').innerHTML = st.turmas.map(t => {
      const ativos = t.checkins.filter(c => c.status !== 'cancelado');
      const lista = t.checkins.filter(c => !q || c.nome.toLowerCase().includes(q) || (qd && c.cpf.includes(qd)));
      const bikes = Array.from({ length: t.vagas }, (_, i) => { const c = ativos[i]; return `<i class="${!c ? '' : c.status === 'presente' ? 'p' : c.status === 'falta' ? 'x' : 'f'}"></i>`; }).join('');
      return `<article class="turma" data-id="${t.id}">
        <div class="t-head"><div><div class="h">${t.hora}</div><small>${t.instrutor ? 'com ' + U.esc(t.instrutor) : 'Greco Cycle'}${t.ativo ? '' : ' · inativa'}</small></div>
          <div class="t-cap"><strong>${ativos.length}/${t.vagas}</strong><span>${Math.max(0, t.vagas - ativos.length)} bikes livres</span></div></div>
        <div class="bikes" title="Amarelo: confirmado · Verde: presente · Vermelho: falta">${bikes}${ativos.length > t.vagas ? `<i class="x"></i>`.repeat(ativos.length - t.vagas) : ''}</div>
        <div class="alunos">${lista.length ? lista.map(c => `
          <div class="aluno ${c.status}" data-c="${c.id}">
            <div><div class="nm">${U.esc(c.nome)}${c.status !== 'confirmado' ? `<span class="pill ${c.status}">${c.status}</span>` : ''}</div>
              <div class="cp">${cpfFmt(c.cpf)} · ${c.codigo} · ${new Date(c.criado).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div></div>
            <div class="acts">
              <button title="Presente" data-s="presente" class="${c.status === 'presente' ? 'on-p' : ''}">✓</button>
              <button title="Faltou" data-s="falta" class="${c.status === 'falta' ? 'on-f' : ''}">✕</button>
              <button title="Cancelar check-in" data-s="cancelado" class="${c.status === 'cancelado' ? 'on-c' : ''}">⊘</button>
            </div></div>`).join('') : `<p class="none">${q ? 'Nenhum aluno encontrado.' : 'Nenhum check-in ainda.'}</p>`}</div>
        <form class="add" data-h="${t.id}"><input name="n" placeholder="Nome do aluno" aria-label="Nome"><input name="c" placeholder="CPF" inputmode="numeric" maxlength="14" aria-label="CPF" style="max-width:140px"><button aria-label="Adicionar">+</button></form>
      </article>`;
    }).join('');
    if (g && animar) {
      g.from('.turma', { y: 26, opacity: 0, duration: .6, stagger: .06, ease: 'power3.out' });
      g.from('.bikes i', { scale: 0, duration: .35, stagger: { each: .006, from: 'start' }, ease: 'back.out(2)', delay: .2 });
    }
  }

  $('#busca').addEventListener('input', () => {
    if (g && window.Flip) { const s = Flip.getState('.aluno'); renderDia(false); Flip.from(s, { duration: .4, ease: 'power2.inOut', onEnter: els => g.fromTo(els, { opacity: 0 }, { opacity: 1 }), onLeave: els => g.to(els, { opacity: 0 }) }); }
    else renderDia(false);
  });

  $('#turmas').addEventListener('click', async e => {
    const b = e.target.closest('.acts button'); if (!b) return;
    const row = b.closest('.aluno'), id = +row.dataset.c;
    const atual = st.turmas.flatMap(t => t.checkins).find(c => c.id === id);
    let novo = b.dataset.s; if (atual && atual.status === novo) novo = 'confirmado';
    if (novo === 'cancelado' && !confirm(`Cancelar o check-in de ${atual.nome}? A bike volta a ficar livre.`)) return;
    b.disabled = true;
    try { const r = await call('spin_admin_status', { p_id: id, p_status: novo }); if (!r.ok) toast(r.erro); else if (atual) atual.status = novo; renderDia(false); }
    catch (err) { toast(err.message); }
  });
  $('#turmas').addEventListener('input', e => { if (e.target.name === 'c') e.target.value = U.maskCPF(e.target.value); });
  $('#turmas').addEventListener('submit', async e => {
    e.preventDefault(); const f = e.target;
    const nome = f.n.value.trim(), cpf = U.so(f.c.value);
    if (nome.length < 2) return toast('Digite o nome do aluno.');
    if (cpf.length !== 11) return toast('CPF precisa ter 11 números.');
    try {
      const r = await call('spin_admin_add', { p_nome: nome, p_cpf: cpf, p_horario_id: +f.dataset.h, p_data: st.data });
      if (!r.ok) return toast(r.erro);
      toast('Aluno adicionado à turma.'); carregarDia(false);
    } catch (err) { toast(err.message); }
  });

  // ---------- horários ----------
  async function carregarHorarios() {
    try { st.horarios = await call('spin_admin_horarios'); } catch (e) { return toast(e.message); }
    $('#hlist').innerHTML = st.horarios.length ? st.horarios.map(h => `<button class="hcard ${h.ativo ? '' : 'off'}" data-id="${h.id}">
      <div class="h">${h.hora}</div>
      <div class="d">${DIAS.map((d, i) => `<span class="${h.dias.includes(i) ? 'on' : ''}">${d}</span>`).join('')}</div>
      <div class="m">${h.vagas} bikes${h.instrutor ? ' · ' + U.esc(h.instrutor) : ''}${h.ativo ? '' : ' · inativa'}</div></button>`).join('')
      : `<div class="empty">Nenhum horário cadastrado.</div>`;
    if (g) g.from('.hcard', { y: 20, opacity: 0, stagger: .04, duration: .5 });
  }
  function abrirH(h) {
    st.hEdit = h ? h.id : null;
    $('#hTitulo').textContent = h ? 'Editar horário' : 'Novo horário';
    $('#hHora').value = h ? h.hora : '18:00'; $('#hVagas').value = h ? h.vagas : 15;
    $('#hInstr').value = h ? (h.instrutor || '') : ''; $('#hAtivo').checked = h ? h.ativo : true;
    const dias = h ? h.dias : [1, 2, 3, 4, 5];
    $('#hDias').innerHTML = DIAS_N.map((d, i) => `<button type="button" data-d="${i}" class="${dias.includes(i) ? 'on' : ''}">${d}</button>`).join('');
    $('#hExcluir').style.display = h ? '' : 'none'; $('#hMsg').className = 'msg';
    $('#hModal').classList.add('show');
    if (g) g.fromTo('#hForm', { y: 30, opacity: 0, scale: .96 }, { y: 0, opacity: 1, scale: 1, duration: .5, ease: 'expo.out' });
  }
  const fecharH = () => $('#hModal').classList.remove('show');
  $('#novoHorario').addEventListener('click', () => abrirH(null));
  $('#hlist').addEventListener('click', e => { const b = e.target.closest('.hcard'); if (b) abrirH(st.horarios.find(h => h.id === +b.dataset.id)); });
  $('#hDias').addEventListener('click', e => { const b = e.target.closest('button'); if (b) b.classList.toggle('on'); });
  $('#hCancel').addEventListener('click', fecharH);
  $('#hModal').addEventListener('click', e => { if (e.target.id === 'hModal') fecharH(); });
  $('#hForm').addEventListener('submit', async e => {
    e.preventDefault();
    const dias = $$('#hDias button.on').map(b => +b.dataset.d);
    try {
      const r = await call('spin_admin_salvar_horario', { p_id: st.hEdit, p_hora: $('#hHora').value, p_dias: dias, p_vagas: +$('#hVagas').value, p_instrutor: $('#hInstr').value, p_ativo: $('#hAtivo').checked });
      if (!r.ok) return msg('#hMsg', r.erro);
      fecharH(); toast('Horário salvo.'); carregarHorarios();
    } catch (err) { msg('#hMsg', err.message); }
  });
  $('#hExcluir').addEventListener('click', async () => {
    if (!confirm('Excluir este horário? Se já tiver check-ins, ele só será desativado para manter o histórico.')) return;
    try { const r = await call('spin_admin_excluir_horario', { p_id: st.hEdit }); fecharH(); toast(r.desativado ? 'Horário desativado (tinha histórico).' : 'Horário excluído.'); carregarHorarios(); }
    catch (err) { msg('#hMsg', err.message); }
  });

  // ---------- relatório ----------
  async function gerarRel() {
    const ini = $('#rIni').value, fim = $('#rFim').value;
    if (!ini || !fim || ini > fim) return toast('Escolha um período válido.');
    try { st.rel = await call('spin_admin_relatorio', { p_inicio: ini, p_fim: fim }); } catch (e) { return toast(e.message); }
    const ativos = st.rel.filter(r => r.status !== 'cancelado');
    const cont = s => st.rel.filter(r => r.status === s).length;
    const alunos = new Set(ativos.map(r => r.cpf)).size;
    $('#rKpis').innerHTML = [['Check-ins', ativos.length], ['Presenças', cont('presente')], ['Faltas', cont('falta')], ['Alunos únicos', alunos]]
      .map(([k, v], i) => `<div class="kpi ${i === 3 ? 'dark' : ''}"><small>${k}</small><strong>${v}</strong></div>`).join('');
    $('#rTbl').innerHTML = `<thead><tr><th>Data</th><th>Hora</th><th>Aluno</th><th>CPF</th><th>Status</th><th>Código</th></tr></thead><tbody>${
      st.rel.length ? st.rel.map(r => `<tr><td>${U.dataBR(r.data)}</td><td>${r.hora}</td><td>${U.esc(r.nome)}</td><td>${cpfFmt(r.cpf)}</td><td><span class="pill ${r.status}" style="margin:0">${r.status}</span></td><td>${r.codigo}</td></tr>`).join('')
      : '<tr><td colspan="6" class="none">Sem check-ins no período.</td></tr>'}</tbody>`;
    $('#rCsv').disabled = !st.rel.length;
  }
  $('#rGo').addEventListener('click', gerarRel);
  $('#rCsv').addEventListener('click', () => {
    const linhas = [['Data', 'Hora', 'Aluno', 'CPF', 'Status', 'Codigo', 'Feito em']].concat(
      st.rel.map(r => [U.dataBR(r.data) + '/' + r.data.slice(0, 4), r.hora, r.nome, cpfFmt(r.cpf), r.status, r.codigo, new Date(r.criado).toLocaleString('pt-BR')]));
    const csv = '﻿' + linhas.map(l => l.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `checkins-greco-cycle_${$('#rIni').value}_a_${$('#rFim').value}.csv`; a.click(); URL.revokeObjectURL(a.href);
  });

  // ---------- ajustes ----------
  $('#cfgAnt').addEventListener('submit', async e => {
    e.preventDefault();
    try { const r = await call('spin_admin_config', { p_dias_antecedencia: +$('#ant').value, p_nova_senha: null }); r.ok ? msg('#antMsg', 'Salvo!', 'ok') : msg('#antMsg', r.erro); }
    catch (err) { msg('#antMsg', err.message); }
  });
  $('#cfgSenha').addEventListener('submit', async e => {
    e.preventDefault();
    const n = $('#nova').value; if (n !== $('#nova2').value) return msg('#senhaMsg', 'As senhas não conferem.');
    try {
      const r = await call('spin_admin_config', { p_dias_antecedencia: null, p_nova_senha: n });
      if (!r.ok) return msg('#senhaMsg', r.erro);
      st.senha = n; try { sessionStorage.setItem('gc_adm', n); } catch {}
      $('#nova').value = $('#nova2').value = ''; msg('#senhaMsg', 'Senha alterada!', 'ok');
    } catch (err) { msg('#senhaMsg', err.message); }
  });
  $('#copiar').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('#pubLink').textContent); toast('Link copiado!'); } catch { toast($('#pubLink').textContent); } });
})();
