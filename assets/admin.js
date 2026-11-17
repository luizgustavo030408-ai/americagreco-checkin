(() => {
  const $ = s => document.querySelector(s);
  const st = { token: null, aulas: [], passadas: [], abertos: new Set(), pessoas: {}, editId: null, versao: null, vistos: null, timer: null };
  const LS = {
    get: k => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
    del: k => { try { localStorage.removeItem(k); } catch {} }
  };

  // ---------- básicos ----------
  async function call(fn, args = {}) {
    try { return await API.rpc(fn, { p_token: st.token, ...args }); }
    catch (e) { if (e.code === '28000') { sair(true); avisar('Entre novamente.'); } throw e; }
  }
  function avisar(t, verde) {
    const a = $('#aviso'); a.textContent = t; a.className = 'aviso mostrar' + (verde ? ' verde' : '');
    clearTimeout(a._t); a._t = setTimeout(() => a.className = 'aviso', verde ? 5000 : 3000);
  }
  const ativos = id => (st.pessoas[id] || []).filter(p => p.status !== 'cancelado');

  // ---------- login ----------
  async function entrar(token) {
    st.token = token;
    let me; try { me = await call('spin_admin_me'); } catch { return; }
    $('#login').hidden = true; $('#app').hidden = false;
    $('#ola').textContent = `Olá, ${me.nome.split(' ')[0]}! Cadastre as aulas abaixo — elas aparecem na hora no site de check-in.`;
    limparForm();
    await carregar();
    clearInterval(st.timer); st.timer = setInterval(vigiar, 8000); vigiar();
  }
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault(); $('#loginErro').textContent = '';
    const b = e.target.querySelector('button'); b.disabled = true; b.textContent = 'Entrando…';
    try {
      const r = await API.rpc('spin_login', { p_usuario: $('#lUser').value, p_senha: $('#lPass').value });
      if (!r.ok) { $('#loginErro').textContent = r.erro; return; }
      LS.set('gc_tk', r.token); $('#lPass').value = '';
      await entrar(r.token);
    } catch (err) { $('#loginErro').textContent = 'Sem conexão. Tente de novo.'; }
    finally { b.disabled = false; b.textContent = 'Entrar'; }
  });
  function sair(silencioso) {
    if (!silencioso && st.token) API.rpc('spin_logout', { p_token: st.token }).catch(() => {});
    st.token = null; LS.del('gc_tk'); clearInterval(st.timer);
    $('#app').hidden = true; $('#login').hidden = false;
  }
  $('#sair').addEventListener('click', () => { if (confirm('Sair do painel?')) sair(); });

  // ---------- formulário (cadastrar / editar) ----------
  function limparForm() {
    st.editId = null;
    const ult = JSON.parse(LS.get('gc_ult') || '{"hora":"19:00","alunos":2,"externos":10}');
    $('#fData').value = ''; $('#fData').min = U.hoje();
    $('#fHora').value = ult.hora; $('#fAlunos').value = ult.alunos; $('#fExternos').value = ult.externos;
    $('#formTitulo').textContent = 'Cadastrar aula'; $('#fBotao').textContent = 'Cadastrar aula';
    $('#fCancelar').hidden = true; $('#fErro').textContent = ''; mostrarTotal();
  }
  const MAX = 12;
  function mostrarTotal() {
    const t = (parseInt($('#fAlunos').value, 10) || 0) + (parseInt($('#fExternos').value, 10) || 0);
    const el = $('#fTotal');
    el.className = 'total' + (t > MAX ? ' erro-total' : '');
    el.innerHTML = t > MAX ? `<b>${t} bikes</b> — passa do limite de ${MAX}. Diminua as vagas.` : `Total: <b>${t} de ${MAX} bikes</b>`;
    $('#fBotao').disabled = t > MAX || t === 0;
  }
  ['#fAlunos', '#fExternos'].forEach(i => $(i).addEventListener('input', mostrarTotal));
  $('#fCancelar').addEventListener('click', limparForm);

  $('#form').addEventListener('submit', async e => {
    e.preventDefault(); $('#fErro').textContent = '';
    const d = { data: $('#fData').value, hora: $('#fHora').value, alunos: parseInt($('#fAlunos').value, 10), externos: parseInt($('#fExternos').value, 10) };
    if (!d.data) return $('#fErro').textContent = 'Escolha o dia da aula.';
    if (!d.hora) return $('#fErro').textContent = 'Escolha o horário.';
    if (!st.editId && d.data < U.hoje()) return $('#fErro').textContent = 'Esse dia já passou.';
    if (isNaN(d.alunos) || isNaN(d.externos) || d.alunos < 0 || d.externos < 0) return $('#fErro').textContent = 'Preencha as vagas (pode ser 0).';
    if (d.alunos + d.externos === 0) return $('#fErro').textContent = 'A aula precisa ter pelo menos 1 vaga.';
    if (d.alunos + d.externos > MAX) return $('#fErro').textContent = `São no máximo ${MAX} bikes por aula (alunos + externos).`;
    const b = $('#fBotao'); b.disabled = true;
    try {
      const r = await call('spin_admin_aula_salvar', { p_id: st.editId, p_data: d.data, p_hora: d.hora,
        p_vagas_total: d.alunos + d.externos, p_vagas_aluno: d.alunos, p_vagas_externo: d.externos });
      if (!r.ok) return $('#fErro').textContent = r.erro;
      LS.set('gc_ult', JSON.stringify({ hora: d.hora, alunos: d.alunos, externos: d.externos }));
      avisar(st.editId ? 'Aula atualizada.' : 'Aula cadastrada! Já está no site.', true);
      limparForm(); await carregar();
    } catch (err) { $('#fErro').textContent = err.message; }
    finally { mostrarTotal(); }
  });

  // ---------- lista de aulas ----------
  async function carregar() {
    const h = U.hoje();
    try { st.aulas = await call('spin_admin_aulas', { p_inicio: h, p_fim: U.addDias(h, 365) }); }
    catch { return; }
    await Promise.all([...st.abertos].map(carregarPessoas));
    desenhar('#lista', st.aulas, false);
    if ($('#passadas').open) carregarPassadas();
  }
  async function carregarPassadas() {
    const h = U.hoje();
    try { st.passadas = (await call('spin_admin_aulas', { p_inicio: U.addDias(h, -180), p_fim: U.addDias(h, -1) })).reverse(); } catch { return; }
    await Promise.all([...st.abertos].filter(id => st.passadas.some(a => a.id === id)).map(carregarPessoas));
    desenhar('#listaPassadas', st.passadas, true);
  }
  $('#passadas').addEventListener('toggle', () => { if ($('#passadas').open) carregarPassadas(); });

  async function carregarPessoas(id) {
    try { const r = await call('spin_admin_aula', { p_id: id }); if (r.ok) st.pessoas[id] = r.pessoas; } catch {}
  }

  function desenhar(alvo, lista, passou) {
    const el = $(alvo);
    if (!lista.length) {
      el.innerHTML = `<p class="vazio">${passou ? 'Nenhuma aula anterior.' : 'Nenhuma aula cadastrada ainda.<br>Use o formulário acima para cadastrar.'}</p>`;
      return;
    }
    el.innerHTML = lista.map(a => {
      const aberto = st.abertos.has(a.id), inscritos = a.ocup_aluno + a.ocup_externo, lotada = inscritos >= a.vagas_total;
      const caixa = (rot, o, v) => `<div class="${v > 0 && o >= v ? 'cheio' : ''}"><small>${rot}</small><b>${o}/${v}</b> <em>${v > 0 && o >= v ? 'lotado' : (v - o) + ' livres'}</em></div>`;
      return `<div class="aula ${passou || a.encerrada ? 'passou' : ''}">
        <div class="a-topo">
          <div class="a-data"><small>${U.semana[U.dow(a.data)]}</small><b>${U.dataBR(a.data)}</b></div>
          <div class="a-info"><b>${a.hora}</b><span>${U.dataLonga(a.data)}${a.encerrada && !passou ? ' · já começou' : ''}</span></div>
          <div class="a-bikes ${lotada ? 'cheio' : ''}"><b>${inscritos}/${a.vagas_total}</b><small>${lotada ? 'lotada' : 'bikes'}</small></div>
        </div>
        <div class="contagem">${caixa('Alunos', a.ocup_aluno, a.vagas_aluno)}${caixa('Externos', a.ocup_externo, a.vagas_externo)}</div>
        <div class="a-botoes">
          <button data-ver="${a.id}">${aberto ? 'Esconder' : 'Ver inscritos'} (${inscritos})</button>
          ${passou ? '' : `<button data-editar="${a.id}">Editar</button>`}
          <button class="apagar" data-apagar="${a.id}">Apagar</button>
        </div>
        ${aberto ? listaInscritos(a) : ''}
      </div>`;
    }).join('');
  }

  function listaInscritos(a) {
    const l = ativos(a.id);
    const bloco = (tipo, rot) => {
      const g = l.filter(p => p.tipo === tipo);
      return `<h3>${rot} (${g.length})</h3>` + (g.length ? g.map(p => `<div class="pessoa"><div><b>${U.esc(p.nome)}</b>
        <span>CPF ${U.maskCPF(p.cpf)}${p.telefone ? ` · <a href="https://wa.me/55${p.telefone}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</span></div>
        <button data-remover="${p.id}" data-aula="${a.id}">Remover</button></div>`).join('') : '<p class="ninguem">Ninguém ainda.</p>');
    };
    return `<div class="inscritos">${bloco('aluno', 'Alunos da academia')}${bloco('externo', 'Externos')}
      ${l.length ? `<button class="btn claro copiar" data-copiar="${a.id}">Copiar lista para o WhatsApp</button>` : ''}</div>`;
  }

  const acharAula = id => st.aulas.find(a => a.id === id) || st.passadas.find(a => a.id === id);
  const redesenhar = () => { desenhar('#lista', st.aulas, false); if ($('#passadas').open) desenhar('#listaPassadas', st.passadas, true); };

  document.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b || !$('#app').contains(b)) return;

    if (b.dataset.ver) {
      const id = +b.dataset.ver;
      if (st.abertos.has(id)) st.abertos.delete(id);
      else { b.textContent = 'Carregando…'; await carregarPessoas(id); st.abertos.add(id); }
      redesenhar();
    }

    if (b.dataset.editar) {
      const a = acharAula(+b.dataset.editar); if (!a) return;
      st.editId = a.id;
      $('#fData').value = a.data; $('#fData').min = ''; $('#fHora').value = a.hora;
      $('#fAlunos').value = a.vagas_aluno; $('#fExternos').value = a.vagas_externo;
      $('#formTitulo').textContent = `Editar aula de ${U.dataBR(a.data)}`; $('#fBotao').textContent = 'Salvar alterações';
      $('#fCancelar').hidden = false; $('#fErro').textContent = ''; mostrarTotal();
      $('#form').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    if (b.dataset.apagar) {
      const a = acharAula(+b.dataset.apagar); if (!a) return;
      const n = a.ocup_aluno + a.ocup_externo;
      if (!confirm(`Apagar a aula de ${U.dataLonga(a.data)} às ${a.hora}?${n ? `\n\nAtenção: ${n} pessoa(s) já fizeram check-in e a inscrição delas será apagada.` : ''}`)) return;
      try { await call('spin_admin_aula_excluir', { p_id: a.id }); st.abertos.delete(a.id); if (st.editId === a.id) limparForm(); avisar('Aula apagada.'); await carregar(); }
      catch (err) { avisar(err.message); }
    }

    if (b.dataset.remover) {
      const aid = +b.dataset.aula, p = (st.pessoas[aid] || []).find(x => x.id === +b.dataset.remover); if (!p) return;
      if (!confirm(`Remover ${p.nome} desta aula? A vaga fica livre de novo.`)) return;
      try { await call('spin_admin_status', { p_id: p.id, p_status: 'cancelado' }); avisar('Removido.'); await carregar(); }
      catch (err) { avisar(err.message); }
    }

    if (b.dataset.copiar) {
      const a = acharAula(+b.dataset.copiar), l = ativos(a.id);
      const nomes = t => l.filter(p => p.tipo === t).map((p, i) => `${i + 1}. ${p.nome}`).join('\n') || '—';
      const txt = `🚴 Spinning — ${U.dataLonga(a.data)} às ${a.hora} (${l.length}/${a.vagas_total} bikes)\n\nAlunos (${a.ocup_aluno}/${a.vagas_aluno}):\n${nomes('aluno')}\n\nExternos (${a.ocup_externo}/${a.vagas_externo}):\n${nomes('externo')}`;
      try { await navigator.clipboard.writeText(txt); avisar('Lista copiada! Cole no WhatsApp.', true); } catch { prompt('Copie a lista:', txt); }
    }
  });

  // ---------- atualização automática ----------
  async function vigiar() {
    if (document.hidden || !st.token) return;
    try {
      const r = await call('spin_admin_versao');
      $('.ao-vivo').className = 'ao-vivo'; $('.ao-vivo').innerHTML = '<i></i>atualiza sozinho';
      const novos = r.novos || [];
      if (st.vistos === null) st.vistos = new Set(novos.map(x => x.id));
      else novos.filter(x => !st.vistos.has(x.id)).forEach(x => { st.vistos.add(x.id); avisar(`Novo check-in: ${x.nome.split(' ')[0]} (${x.tipo}) · ${U.dataBR(x.data)} ${x.hora}`, true); });
      const chave = r.v + '|' + r.n;
      if (st.versao && st.versao !== chave) carregar();
      st.versao = chave;
    } catch (e) { if (e.code !== '28000') { $('.ao-vivo').className = 'ao-vivo off'; $('.ao-vivo').innerHTML = '<i></i>sem internet'; } }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && st.token) carregar(); });

  // ---------- início ----------
  const tk = LS.get('gc_tk');
  if (tk) entrar(tk);
})();
