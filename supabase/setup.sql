-- 1. Em Authentication > Users, crie a conta com o e-mail técnico interno
--    familia@weeding-calculator.local
--    com a senha escolhida e a opção de confirmar o e-mail ativada.
-- 2. Execute este arquivo no SQL Editor do mesmo projeto.
-- 3. Entre no aplicativo com o usuário jmxxp e a senha da conta familiar.
--    O e-mail técnico não precisa ser informado na tela de acesso.
-- Alternativa: o script npm run setup:supabase cria a conta já autorizada.
-- A senha pertence ao Supabase Auth; nunca fica nesta tabela ou no frontend.
begin;

-- Autorize somente a conta familiar padrão criada no painel.
-- A mesclagem preserva os demais metadados administrados pelo Supabase.
-- Se escolher outro e-mail, ajuste-o aqui e em SUPABASE_FAMILY_EMAIL.
-- Se escolher outro usuário, ajuste family_username aqui e SUPABASE_FAMILY_USERNAME.
do $$
declare authorized_users integer;
begin
  update auth.users
    set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
      || '{"family_planner":true,"family_username":"jmxxp"}'::jsonb
    where lower(email) = 'familia@weeding-calculator.local';
  get diagnostics authorized_users = row_count;
  if authorized_users = 0 then
    raise notice 'A conta familiar ainda não existe. Crie familia@weeding-calculator.local em Authentication e execute este arquivo novamente, ou use npm run setup:supabase.';
  end if;
end $$;

create table if not exists public.family_plans (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  revision bigint not null default 1 check (revision > 0)
);

alter table public.family_plans enable row level security;

-- Permissões de tabela e políticas são necessárias, inclusive em projetos
-- que não concedem acesso ao Data API automaticamente.
revoke all on table public.family_plans from public, anon, authenticated;
grant select, insert, update on table public.family_plans to authenticated;

drop policy if exists family_plans_read on public.family_plans;
create policy family_plans_read on public.family_plans
  for select to authenticated
  using (
    (select auth.uid()) = user_id
    and (select auth.jwt())->'app_metadata'->>'family_planner' = 'true'
  );

drop policy if exists family_plans_create on public.family_plans;
create policy family_plans_create on public.family_plans
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and (select auth.jwt())->'app_metadata'->>'family_planner' = 'true'
  );

drop policy if exists family_plans_update on public.family_plans;
create policy family_plans_update on public.family_plans
  for update to authenticated
  using (
    (select auth.uid()) = user_id
    and (select auth.jwt())->'app_metadata'->>'family_planner' = 'true'
  )
  with check (
    (select auth.uid()) = user_id
    and (select auth.jwt())->'app_metadata'->>'family_planner' = 'true'
  );

comment on table public.family_plans is
  'Planejamento compartilhado pelos aparelhos da conta familiar autorizada.';

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

commit;
