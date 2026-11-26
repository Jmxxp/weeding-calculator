-- Execute no SQL Editor do projeto para abrir o planejamento a todos,
-- sem login ou senha. A linha e os dados já existentes são preservados.
-- A conta técnica familia@weeding-calculator.local identifica a linha pública.
-- Se ela ainda não existir, crie-a antes com npm run setup:supabase.
-- Para outro e-mail técnico, ajuste somente a busca indicada abaixo.
begin;

create table if not exists public.family_plans (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  revision bigint not null default 1 check (revision > 0)
);

alter table public.family_plans enable row level security;

-- O acesso público continua limitado a uma única linha por RLS.
-- DELETE e operações administrativas não são concedidos ao navegador.
revoke all on table public.family_plans from public, anon, authenticated;
grant select, insert, update on table public.family_plans to anon, authenticated;

drop policy if exists family_plans_read on public.family_plans;
drop policy if exists family_plans_create on public.family_plans;
drop policy if exists family_plans_update on public.family_plans;

do $$
declare family_user_id uuid;
begin
  -- Ajuste este e-mail se a instalação usa outra conta técnica.
  select id into family_user_id from auth.users
    where lower(email) = 'familia@weeding-calculator.local';
  if family_user_id is null then
    raise exception 'A conta técnica familia@weeding-calculator.local não existe. Crie-a com npm run setup:supabase e execute este arquivo novamente.';
  end if;

  -- Preserve os metadados e a identidade da conta existente.
  update auth.users
    set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
      || '{"family_planner":true}'::jsonb
    where id = family_user_id;

  -- O frontend pode criar a primeira linha sem informar usuário ou senha.
  -- Os UUIDs ficam constantes nas políticas; o navegador não consulta auth.users.
  execute format(
    'alter table public.family_plans alter column user_id set default %L::uuid',
    family_user_id
  );
  execute format(
    'create policy family_plans_read on public.family_plans for select to anon, authenticated using (user_id = %L::uuid)',
    family_user_id
  );
  execute format(
    'create policy family_plans_create on public.family_plans for insert to anon, authenticated with check (user_id = %L::uuid)',
    family_user_id
  );
  execute format(
    'create policy family_plans_update on public.family_plans for update to anon, authenticated using (user_id = %L::uuid) with check (user_id = %L::uuid)',
    family_user_id, family_user_id
  );
end $$;

comment on table public.family_plans is
  'Planejamento público compartilhado, sem login, limitado à linha da conta técnica.';

-- Inclua a tabela na publicação usada pelo Supabase Realtime.
-- O mesmo bloco está em realtime.sql para instalações já existentes.
do $$
begin
  if to_regclass('public.family_plans') is null then
    raise exception 'Crie primeiro a tabela family_plans executando supabase/setup.sql.';
  end if;

  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1 from pg_publication
    where pubname = 'supabase_realtime' and puballtables
  ) and not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'family_plans'
  ) then
    alter publication supabase_realtime add table public.family_plans;
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
