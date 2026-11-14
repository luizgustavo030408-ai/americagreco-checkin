-- Check-in Greco Cycle (spinning) — América Greco
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.spin_config (
  id int primary key default 1 check (id = 1),
  senha_hash text not null,
  dias_antecedencia int not null default 2 check (dias_antecedencia between 0 and 14)
);

create table if not exists public.spin_horarios (
  id bigint generated always as identity primary key,
  hora time not null,
  dias smallint[] not null default '{1,2,3,4,5}',
  vagas int not null default 15 check (vagas > 0),
  instrutor text,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.spin_checkins (
  id bigint generated always as identity primary key,
  horario_id bigint not null references public.spin_horarios(id) on delete cascade,
  data date not null,
  nome text not null,
  cpf text not null,
  status text not null default 'confirmado' check (status in ('confirmado','presente','falta','cancelado')),
  created_at timestamptz not null default now()
);
create unique index if not exists spin_checkins_cpf_dia on public.spin_checkins(cpf, data) where status <> 'cancelado';
create index if not exists spin_checkins_turma on public.spin_checkins(horario_id, data);

alter table public.spin_config   enable row level security;
alter table public.spin_horarios enable row level security;
alter table public.spin_checkins enable row level security;
-- Sem policies: nada é acessível direto pela API. Tudo passa pelas funções abaixo.

-- ---------- helpers ----------
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

create or replace function public._spin_agora() returns timestamp
language sql stable as $$ select (now() at time zone 'America/Boa_Vista') $$;

create or replace function public._spin_auth(p_senha text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from spin_config where id = 1 and senha_hash = extensions.crypt(coalesce(p_senha,''), senha_hash)) then
    perform pg_sleep(0.6);
    raise exception 'Senha incorreta' using errcode = '28000';
  end if;
end $$;

-- ---------- público ----------
create or replace function public.spin_grade()
returns table(data date, horario_id bigint, hora text, vagas int, ocupadas int, instrutor text, encerrado boolean)
language sql stable security definer set search_path = public as $$
  with a as (select _spin_agora() t),
       dias as (select (select t from a)::date + g as d
                from generate_series(0, (select dias_antecedencia from spin_config where id = 1)) g)
  select d.d, h.id, to_char(h.hora,'HH24:MI'), h.vagas,
         (select count(*)::int from spin_checkins c where c.horario_id = h.id and c.data = d.d and c.status <> 'cancelado'),
         h.instrutor,
         (d.d + h.hora) <= (select t from a)
  from dias d
  join spin_horarios h on h.ativo and extract(dow from d.d)::int = any(h.dias)
  order by 1, 3;
$$;

create or replace function public.spin_checkin(p_nome text, p_cpf text, p_horario_id bigint, p_data date)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_h spin_horarios;
  v_cpf text := regexp_replace(coalesce(p_cpf,''), '\D', '', 'g');
  v_nome text := btrim(regexp_replace(coalesce(p_nome,''), '\s+', ' ', 'g'));
  v_agora timestamp := _spin_agora();
  v_ant int; v_ocup int; v_hora_exist text; v_id bigint;
begin
  if length(v_nome) < 5 or position(' ' in v_nome) = 0 then
    return json_build_object('ok', false, 'erro', 'Informe seu nome completo.');
  end if;
  if length(v_nome) > 120 then v_nome := left(v_nome, 120); end if;
  if not _spin_cpf_valido(v_cpf) then
    return json_build_object('ok', false, 'erro', 'CPF inválido. Confira os números.');
  end if;
  select dias_antecedencia into v_ant from spin_config where id = 1;
  if p_data is null or p_data < v_agora::date or p_data > v_agora::date + v_ant then
    return json_build_object('ok', false, 'erro', 'Data fora do período de check-in.');
  end if;

  select * into v_h from spin_horarios where id = p_horario_id and ativo for update;
  if not found then return json_build_object('ok', false, 'erro', 'Horário não encontrado.'); end if;
  if not (extract(dow from p_data)::int = any(v_h.dias)) then
    return json_build_object('ok', false, 'erro', 'Não há aula nesse horário nesse dia.');
  end if;
  if (p_data + v_h.hora) <= v_agora then
    return json_build_object('ok', false, 'erro', 'Essa aula já começou. Escolha outro horário.');
  end if;

  select to_char(h.hora,'HH24:MI') into v_hora_exist
  from spin_checkins c join spin_horarios h on h.id = c.horario_id
  where c.cpf = v_cpf and c.data = p_data and c.status <> 'cancelado' limit 1;
  if found then
    return json_build_object('ok', false, 'erro', 'Você já tem check-in nesse dia às ' || v_hora_exist || '. Cancele o atual para trocar de horário.');
  end if;

  select count(*) into v_ocup from spin_checkins
  where horario_id = v_h.id and data = p_data and status <> 'cancelado';
  if v_ocup >= v_h.vagas then
    return json_build_object('ok', false, 'erro', 'Turma lotada. Escolha outro horário.');
  end if;

  insert into spin_checkins(horario_id, data, nome, cpf) values (v_h.id, p_data, v_nome, v_cpf) returning id into v_id;
  return json_build_object('ok', true, 'id', v_id, 'codigo', 'GC-' || lpad(v_id::text, 4, '0'),
    'nome', split_part(v_nome, ' ', 1), 'data', p_data, 'hora', to_char(v_h.hora,'HH24:MI'),
    'posicao', v_ocup + 1, 'vagas', v_h.vagas, 'instrutor', v_h.instrutor);
end $$;

create or replace function public.spin_meus_checkins(p_cpf text)
returns table(id bigint, codigo text, data date, hora text, status text, cancelavel boolean)
language sql stable security definer set search_path = public as $$
  select c.id, 'GC-' || lpad(c.id::text, 4, '0'), c.data, to_char(h.hora,'HH24:MI'), c.status,
         c.status = 'confirmado' and (c.data + h.hora) > _spin_agora()
  from spin_checkins c join spin_horarios h on h.id = c.horario_id
  where c.cpf = regexp_replace(coalesce(p_cpf,''), '\D', '', 'g')
    and _spin_cpf_valido(regexp_replace(coalesce(p_cpf,''), '\D', '', 'g'))
    and c.data >= _spin_agora()::date and c.status <> 'cancelado'
  order by c.data, h.hora;
$$;

create or replace function public.spin_cancelar(p_cpf text, p_id bigint)
returns json language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update spin_checkins c set status = 'cancelado'
  from spin_horarios h
  where h.id = c.horario_id and c.id = p_id
    and c.cpf = regexp_replace(coalesce(p_cpf,''), '\D', '', 'g')
    and c.status = 'confirmado' and (c.data + h.hora) > _spin_agora();
  get diagnostics n = row_count;
  if n = 0 then return json_build_object('ok', false, 'erro', 'Não foi possível cancelar esse check-in.'); end if;
  return json_build_object('ok', true);
end $$;

-- ---------- gestão (protegido por senha) ----------
create or replace function public.spin_admin_login(p_senha text) returns json
language plpgsql security definer set search_path = public as $$
begin
  perform _spin_auth(p_senha);
  return (select json_build_object('ok', true, 'dias_antecedencia', dias_antecedencia, 'hoje', _spin_agora()::date) from spin_config where id = 1);
end $$;

create or replace function public.spin_admin_dia(p_senha text, p_data date) returns json
language plpgsql security definer set search_path = public as $$
begin
  perform _spin_auth(p_senha);
  return coalesce((
    select json_agg(t order by t.hora) from (
      select h.id, to_char(h.hora,'HH24:MI') hora, h.vagas, h.instrutor, h.ativo,
        coalesce((select json_agg(json_build_object('id', c.id, 'nome', c.nome, 'cpf', c.cpf, 'status', c.status,
                   'criado', c.created_at, 'codigo', 'GC-' || lpad(c.id::text, 4, '0')) order by c.created_at)
                  from spin_checkins c where c.horario_id = h.id and c.data = p_data), '[]'::json) checkins
      from spin_horarios h
      where (h.ativo and extract(dow from p_data)::int = any(h.dias))
         or exists (select 1 from spin_checkins c where c.horario_id = h.id and c.data = p_data)
    ) t), '[]'::json);
end $$;

create or replace function public.spin_admin_status(p_senha text, p_id bigint, p_status text) returns json
language plpgsql security definer set search_path = public as $$
begin
  perform _spin_auth(p_senha);
  if p_status not in ('confirmado','presente','falta','cancelado') then
    return json_build_object('ok', false, 'erro', 'Status inválido');
  end if;
  update spin_checkins set status = p_status where id = p_id;
  return json_build_object('ok', true);
exception when unique_violation then
  return json_build_object('ok', false, 'erro', 'Esse CPF já tem outro check-in ativo nesse dia.');
end $$;

create or replace function public.spin_admin_add(p_senha text, p_nome text, p_cpf text, p_horario_id bigint, p_data date) returns json
language plpgsql security definer set search_path = public as $$
declare v_cpf text := regexp_replace(coalesce(p_cpf,''), '\D', '', 'g'); v_id bigint;
begin
  perform _spin_auth(p_senha);
  if length(btrim(coalesce(p_nome,''))) < 2 then return json_build_object('ok', false, 'erro', 'Informe o nome.'); end if;
  if length(v_cpf) <> 11 then return json_build_object('ok', false, 'erro', 'CPF deve ter 11 números.'); end if;
  insert into spin_checkins(horario_id, data, nome, cpf) values (p_horario_id, p_data, btrim(p_nome), v_cpf) returning id into v_id;
  return json_build_object('ok', true, 'id', v_id);
exception when unique_violation then
  return json_build_object('ok', false, 'erro', 'Esse CPF já tem check-in nesse dia.');
end $$;

create or replace function public.spin_admin_horarios(p_senha text) returns json
language plpgsql security definer set search_path = public as $$
begin
  perform _spin_auth(p_senha);
  return coalesce((select json_agg(json_build_object('id', id, 'hora', to_char(hora,'HH24:MI'), 'dias', dias,
          'vagas', vagas, 'instrutor', instrutor, 'ativo', ativo) order by hora) from spin_horarios), '[]'::json);
end $$;

create or replace function public.spin_admin_salvar_horario(p_senha text, p_id bigint, p_hora text, p_dias smallint[],
  p_vagas int, p_instrutor text, p_ativo boolean) returns json
language plpgsql security definer set search_path = public as $$
begin
  perform _spin_auth(p_senha);
  if p_vagas is null or p_vagas < 1 then return json_build_object('ok', false, 'erro', 'Informe a quantidade de bikes.'); end if;
  if p_dias is null or array_length(p_dias, 1) is null then return json_build_object('ok', false, 'erro', 'Escolha ao menos um dia.'); end if;
  if p_id is null then
    insert into spin_horarios(hora, dias, vagas, instrutor, ativo)
    values (p_hora::time, p_dias, p_vagas, nullif(btrim(p_instrutor),''), coalesce(p_ativo, true));
  else
    update spin_horarios set hora = p_hora::time, dias = p_dias, vagas = p_vagas,
      instrutor = nullif(btrim(p_instrutor),''), ativo = coalesce(p_ativo, true) where id = p_id;
  end if;
  return json_build_object('ok', true);
end $$;

create or replace function public.spin_admin_excluir_horario(p_senha text, p_id bigint) returns json
language plpgsql security definer set search_path = public as $$
begin
  perform _spin_auth(p_senha);
  if exists (select 1 from spin_checkins where horario_id = p_id) then
    update spin_horarios set ativo = false where id = p_id;
    return json_build_object('ok', true, 'desativado', true);
  end if;
  delete from spin_horarios where id = p_id;
  return json_build_object('ok', true);
end $$;

create or replace function public.spin_admin_config(p_senha text, p_dias_antecedencia int, p_nova_senha text) returns json
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _spin_auth(p_senha);
  if p_dias_antecedencia is not null then
    update spin_config set dias_antecedencia = greatest(0, least(14, p_dias_antecedencia)) where id = 1;
  end if;
  if p_nova_senha is not null then
    if length(p_nova_senha) < 6 then return json_build_object('ok', false, 'erro', 'A nova senha precisa de 6+ caracteres.'); end if;
    update spin_config set senha_hash = extensions.crypt(p_nova_senha, extensions.gen_salt('bf')) where id = 1;
  end if;
  return json_build_object('ok', true);
end $$;

create or replace function public.spin_admin_relatorio(p_senha text, p_inicio date, p_fim date) returns json
language plpgsql security definer set search_path = public as $$
begin
  perform _spin_auth(p_senha);
  return coalesce((select json_agg(json_build_object('data', c.data, 'hora', to_char(h.hora,'HH24:MI'), 'nome', c.nome,
      'cpf', c.cpf, 'status', c.status, 'codigo', 'GC-' || lpad(c.id::text, 4, '0'), 'criado', c.created_at)
      order by c.data, h.hora, c.created_at)
    from spin_checkins c join spin_horarios h on h.id = c.horario_id
    where c.data between p_inicio and p_fim), '[]'::json);
end $$;

-- ---------- permissões ----------
do $$ declare f record; begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like 'spin\_%' or p.proname like '\_spin\_%') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
grant execute on function public.spin_grade() to anon, authenticated;
grant execute on function public.spin_checkin(text, text, bigint, date) to anon, authenticated;
grant execute on function public.spin_meus_checkins(text) to anon, authenticated;
grant execute on function public.spin_cancelar(text, bigint) to anon, authenticated;
grant execute on function public.spin_admin_login(text) to anon, authenticated;
grant execute on function public.spin_admin_dia(text, date) to anon, authenticated;
grant execute on function public.spin_admin_status(text, bigint, text) to anon, authenticated;
grant execute on function public.spin_admin_add(text, text, text, bigint, date) to anon, authenticated;
grant execute on function public.spin_admin_horarios(text) to anon, authenticated;
grant execute on function public.spin_admin_salvar_horario(text, bigint, text, smallint[], int, text, boolean) to anon, authenticated;
grant execute on function public.spin_admin_excluir_horario(text, bigint) to anon, authenticated;
grant execute on function public.spin_admin_config(text, int, text) to anon, authenticated;
grant execute on function public.spin_admin_relatorio(text, date, date) to anon, authenticated;
