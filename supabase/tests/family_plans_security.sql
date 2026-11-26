-- Execute após setup.sql no SQL Editor ou com psql -v ON_ERROR_STOP=1.
-- As mudanças e os dados de teste são removidos pelo rollback final.
begin;

-- Use a identidade definida pelo próprio setup, inclusive em instalações
-- que adotam outro e-mail técnico. Nenhuma senha é necessária.
do $$
declare default_expression text; family_user_id uuid;
begin
  select pg_get_expr(d.adbin, d.adrelid) into default_expression
    from pg_attrdef d
    join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
    where d.adrelid = 'public.family_plans'::regclass and a.attname = 'user_id';
  if default_expression is null then
    raise exception 'Execute primeiro a versão pública de supabase/setup.sql.';
  end if;
  execute 'select ' || default_expression into family_user_id;
  perform set_config('weeding_test.family_user_id', family_user_id::text, true);
end $$;

insert into auth.users (id, raw_app_meta_data) values
  ('ef730a21-89cf-4866-b213-e44d98510002', '{}'),
  ('ef730a21-89cf-4866-b213-e44d98510003', '{"family_planner":true}');

-- A linha real é substituída apenas dentro desta transação com rollback.
delete from public.family_plans
  where user_id = current_setting('weeding_test.family_user_id')::uuid;
insert into public.family_plans (data) values ('{"test":"public-family"}');
insert into public.family_plans (user_id, data) values
  ('ef730a21-89cf-4866-b213-e44d98510003', '{"test":"other-family"}');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$
declare changed integer;
begin
  if (select count(*) from public.family_plans) <> 1 then
    raise exception 'FAIL: anon deve enxergar somente o planejamento público';
  end if;
  if not exists (select 1 from public.family_plans
      where user_id = current_setting('weeding_test.family_user_id')::uuid
      and data->>'test' = 'public-family') then
    raise exception 'FAIL: anon não conseguiu ler o planejamento público';
  end if;
  if exists (select 1 from public.family_plans
      where user_id = 'ef730a21-89cf-4866-b213-e44d98510003') then
    raise exception 'FAIL: anon conseguiu ler outra conta';
  end if;
  begin
    insert into public.family_plans (user_id, data)
      values ('ef730a21-89cf-4866-b213-e44d98510002', '{}');
    raise exception 'FAIL: anon conseguiu inserir dados para outra conta';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.family_plans
      set user_id = 'ef730a21-89cf-4866-b213-e44d98510002';
    raise exception 'FAIL: anon conseguiu transferir a linha pública';
  exception when insufficient_privilege then null;
  end;
  update public.family_plans set data = '{"test":"updated"}', revision = 2
    where user_id = current_setting('weeding_test.family_user_id')::uuid
      and revision = 1;
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'FAIL: atualização pública falhou'; end if;
  update public.family_plans set data = '{"test":"stale"}', revision = 2
    where user_id = current_setting('weeding_test.family_user_id')::uuid
      and revision = 1;
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'FAIL: revisão antiga foi aceita'; end if;
  update public.family_plans set data = '{"test":"changed-other"}'
    where user_id = 'ef730a21-89cf-4866-b213-e44d98510003';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'FAIL: anon atualizou outra conta'; end if;
  begin
    update public.family_plans set data = '[]';
    raise exception 'FAIL: conteúdo inválido foi aceito';
  exception when check_violation then null;
  end;
  begin
    update public.family_plans set revision = 0;
    raise exception 'FAIL: revisão inválida foi aceita';
  exception when check_violation then null;
  end;
  begin
    delete from public.family_plans;
    raise exception 'FAIL: anon conseguiu excluir a linha';
  exception when insufficient_privilege then null;
  end;
end $$;

-- A criação inicial também funciona sem usuário: usa o DEFAULT e a mesma RLS.
reset role;
delete from public.family_plans
  where user_id = current_setting('weeding_test.family_user_id')::uuid;
set local role anon;
insert into public.family_plans (data, revision) values ('{"test":"created"}', 1);
do $$
begin
  if not exists (select 1 from public.family_plans
      where user_id = current_setting('weeding_test.family_user_id')::uuid
      and data->>'test' = 'created' and revision = 1) then
    raise exception 'FAIL: criação pública não usou a conta técnica';
  end if;
end $$;

-- Sessões antigas também acessam somente a linha pública. Metadados de
-- usuário não concedem permissão para expor ou criar linhas de outras contas.
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"ef730a21-89cf-4866-b213-e44d98510002","app_metadata":{},"user_metadata":{"family_planner":true}}', true);
do $$
begin
  if (select count(*) from public.family_plans) <> 1 then
    raise exception 'FAIL: authenticated deve enxergar somente a linha pública';
  end if;
  begin
    insert into public.family_plans (user_id, data)
      values ('ef730a21-89cf-4866-b213-e44d98510002', '{}');
    raise exception 'FAIL: metadados de usuário autorizaram outra linha';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.family_plans;
    raise exception 'FAIL: authenticated conseguiu excluir a linha';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
do $$
begin
  if not exists (select 1 from public.family_plans
      where user_id = 'ef730a21-89cf-4866-b213-e44d98510003'
      and data->>'test' = 'other-family' and revision = 1) then
    raise exception 'FAIL: o planejamento de outra conta foi alterado';
  end if;
end $$;
rollback;
select 'PASS: acesso público, isolamento, criação, revisão e exclusão verificados.' as resultado;
