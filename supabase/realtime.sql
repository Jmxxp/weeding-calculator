-- Execute no SQL Editor para ativar atualizações imediatas entre os aparelhos.
-- Pode ser executado novamente; mantém as permissões e políticas existentes.
begin;

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
