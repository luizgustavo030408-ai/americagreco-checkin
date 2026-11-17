-- =====================================================================
-- Check-in Spinning · América Greco  (v2)
-- A gestora cadastra cada aula (dia, horário, vagas p/ alunos e externos,
-- valor da diária). Alunos e externos fazem check-in pelo site.
-- Tabelas fechadas (RLS sem policies): tudo passa pelas funções abaixo.
-- =====================================================================
create extension if not exists pgcrypto with schema extensions;

-- remove a versão 1 e qualquer rascunho anterior
do $$ declare f record; begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like 'spin\_%' or p.proname like '\_spin\_%') loop
    execute format('drop function if exists %s cascade', f.sig);
  end loop;
end $$;
drop table if exists public.spin_checkins, public.spin_horarios, public.spin_config, public.spin_turmas,
  public.spin_sessoes, public.spin_admins, public.spin_aulas cascade;

-- ---------- tabelas ----------
create table public.spin_admins (
  id bigint generated always as identity primary key,
  nome text not null,
  usuario text not null unique,
  senha_hash text not null,
  ativo boolean not null default true,
  criado timestamptz not null default now()
);

create table public.spin_sessoes (
  token_hash text primary key,
  admin_id bigint not null references public.spin_admins(id) on delete cascade,
  expira timestamptz not null,
  criado timestamptz not null default now()
);

create table public.spin_aulas (
  id bigint generated always as identity primary key,
  data date not null,
  hora time not null,
  titulo text not null default 'Aula Spinning',
  vagas_aluno int not null default 12 check (vagas_aluno >= 0),
  vagas_externo int not null default 10 check (vagas_externo >= 0),
  valor_diaria numeric(10,2) not null default 0 check (valor_diaria >= 0),
  instrutor text,
  obs text,
  status text not null default 'aberta' check (status in ('aberta','cancelada')),
  criado timestamptz not null default now(),
  atualizado timestamptz not null default now(),
  unique (data, hora)
);

create table public.spin_checkins (
  id bigint generated always as identity primary key,
  aula_id bigint not null references public.spin_aulas(id) on delete cascade,
  tipo text not null check (tipo in ('aluno','externo')),
  nome text not null,
  cpf text not null,
  telefone text,
  valor numeric(10,2) not null default 0,
  pago boolean not null default false,
  forma_pagamento text,
  status text not null default 'confirmado' check (status in ('confirmado','presente','falta','cancelado')),
  origem text not null default 'site' check (origem in ('site','painel')),
  criado timestamptz not null default now(),
  atualizado timestamptz not null default now()
);
create unique index spin_checkins_cpf_aula on public.spin_checkins(aula_id, cpf) where status <> 'cancelado';
create index spin_checkins_aula on public.spin_checkins(aula_id);
create index spin_checkins_atualizado on public.spin_checkins(atualizado);
create index spin_aulas_data on public.spin_aulas(data);

alter table public.spin_admins   enable row level security;
alter table public.spin_sessoes  enable row level security;
alter table public.spin_aulas    enable row level security;
alter table public.spin_checkins enable row level security;

create or replace function public._spin_touch() returns trigger language plpgsql set search_path = public as $$
begin new.atualizado := now(); return new; end $$;
create trigger spin_aulas_touch before update on public.spin_aulas for each row execute function public._spin_touch();
create trigger spin_checkins_touch before update on public.spin_checkins for each row execute function public._spin_touch();

-- ---------- helpers ----------
create or replace function public._spin_agora() returns timestamp
language sql stable set search_path = public as $$ select (now() at time zone 'America/Boa_Vista') $$;

create or replace function public._spin_cpf_valido(c text) returns boolean
language plpgsql immutable set search_path = public as $$
declare s int; d int; i int;
begin
  if c is null or c !~ '^\d{11}$' or c ~ '^(\d)\1{10}$' then return false; end if;
  s := 0; for i in 1..9 loop s := s + substr(c,i,1)::int * (11 - i); end loop;
  d := (s * 10) % 11; if d = 10 then d := 0; end if;
  if d <> substr(c,10,1)::int then return false; end if;
  s := 0; for i in 1..10 loop s := s + substr(c,i,1)::int * (12 - i); end loop;
  d := (s * 10) % 11; if d = 10 then d := 0; end if;
  return d = substr(c,11,1)::int;
end $$;

create or replace function public._spin_sessao(p_token text) returns public.spin_admins
language plpgsql security definer set search_path = public, extensions as $$
declare a spin_admins;
begin
  select ad.* into a from spin_sessoes s join spin_admins ad on ad.id = s.admin_id
  where s.token_hash = encode(extensions.digest(coalesce(p_token,''), 'sha256'), 'hex')
    and s.expira > now() and ad.ativo;
  if not found then raise exception 'Sessão expirada. Entre novamente.' using errcode = '28000'; end if;
  return a;
end $$;

create or replace function public._spin_aula_json(a public.spin_aulas) returns json
language sql stable set search_path = public as $$
  select json_build_object(
    'id', a.id, 'data', a.data, 'hora', to_char(a.hora,'HH24:MI'), 'titulo', a.titulo,
    'vagas_aluno', a.vagas_aluno, 'vagas_externo', a.vagas_externo, 'valor_diaria', a.valor_diaria,
    'instrutor', a.instrutor, 'obs', a.obs, 'status', a.status,
    'encerrada', (a.data + a.hora) <= _spin_agora(),
    'ocup_aluno',   (select count(*) from spin_checkins c where c.aula_id = a.id and c.tipo = 'aluno'   and c.status <> 'cancelado'),
    'ocup_externo', (select count(*) from spin_checkins c where c.aula_id = a.id and c.tipo = 'externo' and c.status <> 'cancelado'),
    'presentes',    (select count(*) from spin_checkins c where c.aula_id = a.id and c.status = 'presente'),
    'previsto',     (select coalesce(sum(valor),0) from spin_checkins c where c.aula_id = a.id and c.status <> 'cancelado'),
    'recebido',     (select coalesce(sum(valor),0) from spin_checkins c where c.aula_id = a.id and c.status <> 'cancelado' and c.pago)
  )
$$;

-- =====================================================================
-- PÚBLICO (site de check-in)
-- =====================================================================
create or replace function public.spin_aulas_abertas()
returns table(aula_id bigint, data date, hora text, titulo text, instrutor text,
              vagas_aluno int, ocup_aluno int, vagas_externo int, ocup_externo int,
              valor_diaria numeric, encerrada boolean)
language sql stable security definer set search_path = public as $$
  select a.id, a.data, to_char(a.hora,'HH24:MI'), a.titulo, a.instrutor,
    a.vagas_aluno,   (select count(*)::int from spin_checkins c where c.aula_id = a.id and c.tipo = 'aluno'   and c.status <> 'cancelado'),
    a.vagas_externo, (select count(*)::int from spin_checkins c where c.aula_id = a.id and c.tipo = 'externo' and c.status <> 'cancelado'),
    a.valor_diaria, (a.data + a.hora) <= _spin_agora()
  from spin_aulas a
  where a.status = 'aberta' and a.data >= _spin_agora()::date and a.data <= _spin_agora()::date + 60
  order by a.data, a.hora;
$$;

create or replace function public.spin_checkin(p_aula_id bigint, p_tipo text, p_nome text, p_cpf text, p_telefone text)
returns json language plpgsql security definer set search_path = public as $$
declare
  a spin_aulas;
  v_cpf text := regexp_replace(coalesce(p_cpf,''), '\D', '', 'g');
  v_tel text := nullif(regexp_replace(coalesce(p_telefone,''), '\D', '', 'g'), '');
  v_nome text := left(btrim(regexp_replace(coalesce(p_nome,''), '\s+', ' ', 'g')), 120);
  v_ocup int; v_vagas int; v_id bigint; v_valor numeric := 0;
begin
  if p_tipo is null or p_tipo not in ('aluno','externo') then return json_build_object('ok', false, 'erro', 'Escolha se você é aluno da academia ou externo.'); end if;
  if length(v_nome) < 5 or position(' ' in v_nome) = 0 then return json_build_object('ok', false, 'erro', 'Informe seu nome completo.'); end if;
  if not _spin_cpf_valido(v_cpf) then return json_build_object('ok', false, 'erro', 'CPF inválido. Confira os números.'); end if;
  if v_tel is not null and length(v_tel) not between 10 and 11 then return json_build_object('ok', false, 'erro', 'WhatsApp inválido. Use DDD + número.'); end if;

  select * into a from spin_aulas where id = p_aula_id for update;
  if not found or a.status <> 'aberta' then return json_build_object('ok', false, 'erro', 'Essa aula não está disponível.'); end if;
  if (a.data + a.hora) <= _spin_agora() then return json_build_object('ok', false, 'erro', 'Essa aula já começou.'); end if;

  if exists (select 1 from spin_checkins where aula_id = a.id and cpf = v_cpf and status <> 'cancelado') then
    return json_build_object('ok', false, 'erro', 'Este CPF já tem check-in nessa aula.');
  end if;

  v_vagas := case p_tipo when 'aluno' then a.vagas_aluno else a.vagas_externo end;
  select count(*) into v_ocup from spin_checkins where aula_id = a.id and tipo = p_tipo and status <> 'cancelado';
  if v_ocup >= v_vagas then
    return json_build_object('ok', false, 'erro', case p_tipo when 'aluno' then 'As vagas para alunos dessa aula esgotaram.' else 'As vagas para externos dessa aula esgotaram.' end);
  end if;

  if p_tipo = 'externo' then v_valor := a.valor_diaria; end if;
  insert into spin_checkins(aula_id, tipo, nome, cpf, telefone, valor) values (a.id, p_tipo, v_nome, v_cpf, v_tel, v_valor) returning id into v_id;

  return json_build_object('ok', true, 'id', v_id, 'codigo', 'GC-' || lpad(v_id::text, 4, '0'),
    'nome', split_part(v_nome, ' ', 1), 'data', a.data, 'hora', to_char(a.hora,'HH24:MI'), 'titulo', a.titulo,
    'tipo', p_tipo, 'valor', v_valor, 'posicao', v_ocup + 1, 'vagas', v_vagas);
end $$;

create or replace function public.spin_meus_checkins(p_cpf text)
returns table(id bigint, codigo text, data date, hora text, titulo text, tipo text, valor numeric, status text, cancelavel boolean)
language sql stable security definer set search_path = public as $$
  select c.id, 'GC-' || lpad(c.id::text, 4, '0'), a.data, to_char(a.hora,'HH24:MI'), a.titulo, c.tipo, c.valor, c.status,
         c.status = 'confirmado' and (a.data + a.hora) > _spin_agora()
  from spin_checkins c join spin_aulas a on a.id = c.aula_id
  where _spin_cpf_valido(regexp_replace(coalesce(p_cpf,''), '\D', '', 'g'))
    and c.cpf = regexp_replace(coalesce(p_cpf,''), '\D', '', 'g')
    and a.data >= _spin_agora()::date and c.status <> 'cancelado' and a.status = 'aberta'
  order by a.data, a.hora;
$$;

create or replace function public.spin_cancelar(p_cpf text, p_id bigint)
returns json language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update spin_checkins c set status = 'cancelado'
  from spin_aulas a
  where a.id = c.aula_id and c.id = p_id
    and c.cpf = regexp_replace(coalesce(p_cpf,''), '\D', '', 'g')
    and c.status = 'confirmado' and (a.data + a.hora) > _spin_agora();
  get diagnostics n = row_count;
  if n = 0 then return json_build_object('ok', false, 'erro', 'Não foi possível cancelar esse check-in.'); end if;
  return json_build_object('ok', true);
end $$;

-- =====================================================================
-- PAINEL (login por usuário/senha → token de sessão de 30 dias)
-- =====================================================================
create or replace function public.spin_login(p_usuario text, p_senha text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare a spin_admins; v_token text;
begin
  select * into a from spin_admins where usuario = lower(btrim(coalesce(p_usuario,''))) and ativo;
  if not found or a.senha_hash <> extensions.crypt(coalesce(p_senha,''), a.senha_hash) then
    perform pg_sleep(0.7);
    return json_build_object('ok', false, 'erro', 'Usuário ou senha incorretos.');
  end if;
  delete from spin_sessoes where expira < now();
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into spin_sessoes(token_hash, admin_id, expira)
  values (encode(extensions.digest(v_token, 'sha256'), 'hex'), a.id, now() + interval '30 days');
  return json_build_object('ok', true, 'token', v_token, 'nome', a.nome, 'usuario', a.usuario);
end $$;

create or replace function public.spin_logout(p_token text) returns json
language plpgsql security definer set search_path = public, extensions as $$
begin
  delete from spin_sessoes where token_hash = encode(extensions.digest(coalesce(p_token,''), 'sha256'), 'hex');
  return json_build_object('ok', true);
end $$;

create or replace function public.spin_admin_me(p_token text) returns json
language plpgsql security definer set search_path = public as $$
declare a spin_admins;
begin
  a := _spin_sessao(p_token);
  return json_build_object('nome', a.nome, 'usuario', a.usuario, 'hoje', _spin_agora()::date);
end $$;

create or replace function public.spin_admin_aulas(p_token text, p_inicio date, p_fim date) returns json
language plpgsql security definer set search_path = public as $$
begin
  perform _spin_sessao(p_token);
  return coalesce((select json_agg(_spin_aula_json(a) order by a.data, a.hora)
                   from spin_aulas a where a.data between p_inicio and p_fim), '[]'::json);
end $$;

create or replace function public.spin_admin_aula(p_token text, p_id bigint) returns json
language plpgsql security definer set search_path = public as $$
declare a spin_aulas;
begin
  perform _spin_sessao(p_token);
  select * into a from spin_aulas where id = p_id;
  if not found then return json_build_object('ok', false, 'erro', 'Aula não encontrada.'); end if;
  return json_build_object('ok', true, 'aula', _spin_aula_json(a),
    'pessoas', coalesce((select json_agg(json_build_object(
        'id', c.id, 'codigo', 'GC-' || lpad(c.id::text, 4, '0'), 'tipo', c.tipo, 'nome', c.nome, 'cpf', c.cpf,
        'telefone', c.telefone, 'valor', c.valor, 'pago', c.pago, 'forma', c.forma_pagamento,
        'status', c.status, 'origem', c.origem, 'criado', c.criado) order by c.criado)
      from spin_checkins c where c.aula_id = a.id), '[]'::json));
end $$;

create or replace function public.spin_admin_aula_salvar(p_token text, p_id bigint, p_data date, p_hora text, p_titulo text,
  p_vagas_aluno int, p_vagas_externo int, p_valor numeric, p_instrutor text, p_obs text, p_repetir_semanas int)
returns json language plpgsql security definer set search_path = public as $$
declare i int; d date; criadas int := 0; puladas text[] := '{}'; v_titulo text := coalesce(nullif(btrim(p_titulo),''), 'Aula Spinning');
begin
  perform _spin_sessao(p_token);
  if p_data is null or coalesce(p_hora,'') = '' then return json_build_object('ok', false, 'erro', 'Informe o dia e o horário.'); end if;
  if coalesce(p_vagas_aluno,0) < 0 or coalesce(p_vagas_externo,0) < 0 or coalesce(p_vagas_aluno,0) + coalesce(p_vagas_externo,0) = 0 then
    return json_build_object('ok', false, 'erro', 'Informe quantas vagas a aula tem.');
  end if;

  if p_id is not null then
    begin
      update spin_aulas set data = p_data, hora = p_hora::time, titulo = v_titulo, vagas_aluno = coalesce(p_vagas_aluno,0),
        vagas_externo = coalesce(p_vagas_externo,0), valor_diaria = coalesce(p_valor,0),
        instrutor = nullif(btrim(p_instrutor),''), obs = nullif(btrim(p_obs),'') where id = p_id;
    exception when unique_violation then
      return json_build_object('ok', false, 'erro', 'Já existe uma aula nesse dia e horário.');
    end;
    update spin_checkins set valor = coalesce(p_valor,0) where aula_id = p_id and tipo = 'externo' and not pago and status <> 'cancelado';
    return json_build_object('ok', true, 'id', p_id, 'criadas', 0);
  end if;

  for i in 0 .. greatest(0, least(coalesce(p_repetir_semanas, 1), 52) - 1) loop
    d := p_data + (i * 7);
    if exists (select 1 from spin_aulas where data = d and hora = p_hora::time) then
      puladas := puladas || to_char(d, 'DD/MM');
    else
      insert into spin_aulas(data, hora, titulo, vagas_aluno, vagas_externo, valor_diaria, instrutor, obs)
      values (d, p_hora::time, v_titulo, coalesce(p_vagas_aluno,0), coalesce(p_vagas_externo,0), coalesce(p_valor,0),
              nullif(btrim(p_instrutor),''), nullif(btrim(p_obs),''));
      criadas := criadas + 1;
    end if;
  end loop;
  return json_build_object('ok', true, 'criadas', criadas, 'ja_existiam', puladas);
end $$;

create or replace function public.spin_admin_aula_status(p_token text, p_id bigint, p_status text) returns json
language plpgsql security definer set search_path = public as $$
begin
  perform _spin_sessao(p_token);
  if p_status not in ('aberta','cancelada') then return json_build_object('ok', false, 'erro', 'Status inválido.'); end if;
  update spin_aulas set status = p_status where id = p_id;
  return json_build_object('ok', true);
end $$;

create or replace function public.spin_admin_aula_excluir(p_token text, p_id bigint) returns json
language plpgsql security definer set search_path = public as $$
begin
  perform _spin_sessao(p_token);
  delete from spin_aulas where id = p_id;
  return json_build_object('ok', true);
end $$;

create or replace function public.spin_admin_status(p_token text, p_id bigint, p_status text) returns json
language plpgsql security definer set search_path = public as $$
begin
  perform _spin_sessao(p_token);
  if p_status not in ('confirmado','presente','falta','cancelado') then return json_build_object('ok', false, 'erro', 'Status inválido.'); end if;
  update spin_checkins set status = p_status where id = p_id;
  return json_build_object('ok', true);
exception when unique_violation then
  return json_build_object('ok', false, 'erro', 'Esse CPF já tem outro check-in ativo nessa aula.');
end $$;

create or replace function public.spin_admin_pagamento(p_token text, p_id bigint, p_pago boolean, p_forma text) returns json
language plpgsql security definer set search_path = public as $$
begin
  perform _spin_sessao(p_token);
  update spin_checkins set pago = coalesce(p_pago,false), forma_pagamento = case when p_pago then nullif(btrim(p_forma),'') end where id = p_id;
  return json_build_object('ok', true);
end $$;

create or replace function public.spin_admin_add(p_token text, p_aula_id bigint, p_tipo text, p_nome text, p_cpf text, p_telefone text, p_pago boolean, p_forma text)
returns json language plpgsql security definer set search_path = public as $$
declare a spin_aulas; v_cpf text := regexp_replace(coalesce(p_cpf,''), '\D', '', 'g'); v_id bigint; v_ocup int; v_vagas int;
begin
  perform _spin_sessao(p_token);
  select * into a from spin_aulas where id = p_aula_id;
  if not found then return json_build_object('ok', false, 'erro', 'Aula não encontrada.'); end if;
  if p_tipo is null or p_tipo not in ('aluno','externo') then return json_build_object('ok', false, 'erro', 'Escolha aluno ou externo.'); end if;
  if length(btrim(coalesce(p_nome,''))) < 2 then return json_build_object('ok', false, 'erro', 'Informe o nome.'); end if;
  if length(v_cpf) <> 11 then return json_build_object('ok', false, 'erro', 'CPF precisa ter 11 números.'); end if;
  select count(*) into v_ocup from spin_checkins where aula_id = a.id and tipo = p_tipo and status <> 'cancelado';
  v_vagas := case p_tipo when 'aluno' then a.vagas_aluno else a.vagas_externo end;
  insert into spin_checkins(aula_id, tipo, nome, cpf, telefone, valor, pago, forma_pagamento, origem)
  values (a.id, p_tipo, left(btrim(p_nome),120), v_cpf, nullif(regexp_replace(coalesce(p_telefone,''), '\D', '', 'g'),''),
          case p_tipo when 'externo' then a.valor_diaria else 0 end, coalesce(p_pago,false) and p_tipo = 'externo',
          case when coalesce(p_pago,false) and p_tipo = 'externo' then nullif(btrim(p_forma),'') end, 'painel')
  returning id into v_id;
  return json_build_object('ok', true, 'id', v_id, 'acima_do_limite', v_ocup >= v_vagas);
exception when unique_violation then
  return json_build_object('ok', false, 'erro', 'Esse CPF já tem check-in nessa aula.');
end $$;

-- "ao vivo": o painel consulta a cada poucos segundos e só recarrega quando algo mudou
create or replace function public.spin_admin_versao(p_token text) returns json
language plpgsql security definer set search_path = public as $$
begin
  perform _spin_sessao(p_token);
  return json_build_object(
    'v', greatest((select max(atualizado) from spin_checkins), (select max(atualizado) from spin_aulas)),
    'n', (select count(*) from spin_checkins) + (select count(*) from spin_aulas),
    'novos', coalesce((select json_agg(x order by x.id) from (
       select c.id, c.nome, c.tipo, to_char(a.hora,'HH24:MI') hora, a.data
       from spin_checkins c join spin_aulas a on a.id = c.aula_id
       where c.origem = 'site' and c.criado > now() - interval '3 minutes') x), '[]'::json));
end $$;

create or replace function public.spin_admin_relatorio(p_token text, p_inicio date, p_fim date) returns json
language plpgsql security definer set search_path = public as $$
begin
  perform _spin_sessao(p_token);
  return coalesce((select json_agg(json_build_object('data', a.data, 'hora', to_char(a.hora,'HH24:MI'), 'aula', a.titulo,
      'aula_status', a.status, 'tipo', c.tipo, 'nome', c.nome, 'cpf', c.cpf, 'telefone', c.telefone, 'valor', c.valor,
      'pago', c.pago, 'forma', c.forma_pagamento, 'status', c.status, 'codigo', 'GC-' || lpad(c.id::text, 4, '0'), 'criado', c.criado)
      order by a.data, a.hora, c.tipo, c.criado)
    from spin_checkins c join spin_aulas a on a.id = c.aula_id
    where a.data between p_inicio and p_fim), '[]'::json);
end $$;

create or replace function public.spin_admin_senha(p_token text, p_atual text, p_nova text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare a spin_admins;
begin
  a := _spin_sessao(p_token);
  if a.senha_hash <> extensions.crypt(coalesce(p_atual,''), a.senha_hash) then return json_build_object('ok', false, 'erro', 'Senha atual incorreta.'); end if;
  if length(coalesce(p_nova,'')) < 6 then return json_build_object('ok', false, 'erro', 'A nova senha precisa de pelo menos 6 caracteres.'); end if;
  update spin_admins set senha_hash = extensions.crypt(p_nova, extensions.gen_salt('bf')) where id = a.id;
  return json_build_object('ok', true);
end $$;

-- ---------- permissões ----------
do $$ declare f record; begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like 'spin\_%' or p.proname like '\_spin\_%') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'spin\_%' loop
    execute format('grant execute on function %s to anon, authenticated', f.sig);
  end loop;
end $$;
