-- Execute após setup.sql no SQL Editor ou com psql -v ON_ERROR_STOP=1.
-- Os usuários e dados de teste são removidos pelo rollback final.
begin;

insert into auth.users (id, raw_app_meta_data) values
  ('ef730a21-89cf-4866-b213-e44d98510001', '{"family_planner":true}'),
  ('ef730a21-89cf-4866-b213-e44d98510002', '{}'),
  ('ef730a21-89cf-4866-b213-e44d98510003', '{"family_planner":true}');

insert into public.family_plans (user_id, data) values
  ('ef730a21-89cf-4866-b213-e44d98510001', '{"test":"family"}'),
  ('ef730a21-89cf-4866-b213-e44d98510003', '{"test":"other-family"}');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
begin
  begin
    perform * from public.family_plans;
    raise exception 'FAIL: anon conseguiu ler';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.family_plans (user_id, data)
      values ('ef730a21-89cf-4866-b213-e44d98510002', '{}');
    raise exception 'FAIL: anon conseguiu inserir';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.family_plans set data = '{}';
    raise exception 'FAIL: anon conseguiu atualizar';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.family_plans;
    raise exception 'FAIL: anon conseguiu excluir';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
set local role authenticated;
-- user_metadata não concede acesso, mesmo que o próprio usuário o altere.
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"ef730a21-89cf-4866-b213-e44d98510002","app_metadata":{},"user_metadata":{"family_planner":true}}', true);
do $$
declare changed integer;
begin
  if exists (select 1 from public.family_plans) then
    raise exception 'FAIL: usuário externo conseguiu ler';
  end if;
  begin
    insert into public.family_plans (user_id, data)
      values ('ef730a21-89cf-4866-b213-e44d98510002', '{}');
    raise exception 'FAIL: usuário externo conseguiu inserir';
  exception when insufficient_privilege then null;
  end;
  update public.family_plans set data = '{}';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'FAIL: usuário externo conseguiu atualizar'; end if;
  begin
    delete from public.family_plans;
    raise exception 'FAIL: usuário externo conseguiu excluir';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"ef730a21-89cf-4866-b213-e44d98510001","app_metadata":{"family_planner":true}}', true);
do $$
declare changed integer;
begin
  if (select count(*) from public.family_plans) <> 1 then
    raise exception 'FAIL: conta familiar deve enxergar apenas seu planejamento';
  end if;
  if not exists (select 1 from public.family_plans where data->>'test' = 'family') then
    raise exception 'FAIL: conta familiar não conseguiu ler seus dados';
  end if;
  begin
    insert into public.family_plans (user_id, data)
      values ('ef730a21-89cf-4866-b213-e44d98510002', '{}');
    raise exception 'FAIL: família conseguiu criar dados para outro usuário';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.family_plans set user_id = 'ef730a21-89cf-4866-b213-e44d98510002';
    raise exception 'FAIL: família conseguiu transferir dados para outro usuário';
  exception when insufficient_privilege then null;
  end;
  update public.family_plans set data = '{"test":"updated"}', revision = 2
    where user_id = 'ef730a21-89cf-4866-b213-e44d98510001' and revision = 1;
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'FAIL: atualização da revisão atual falhou'; end if;
  update public.family_plans set data = '{"test":"stale"}', revision = 2
    where user_id = 'ef730a21-89cf-4866-b213-e44d98510001' and revision = 1;
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'FAIL: atualização com revisão antiga foi aceita'; end if;
  begin
    update public.family_plans set data = '[]';
    raise exception 'FAIL: conteúdo inválido foi aceito';
  exception when check_violation then null;
  end;
  begin
    delete from public.family_plans;
    raise exception 'FAIL: conta familiar conseguiu excluir a linha';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Uma segunda conta autorizada consegue criar apenas sua própria linha.
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"ef730a21-89cf-4866-b213-e44d98510002","app_metadata":{"family_planner":true}}', true);
insert into public.family_plans (user_id, data)
  values ('ef730a21-89cf-4866-b213-e44d98510002', '{"test":"created"}');
do $$
begin
  if (select count(*) from public.family_plans) <> 1 then
    raise exception 'FAIL: conta autorizada enxergou linhas de outra conta';
  end if;
end $$;

reset role;
rollback;
select 'PASS: permissões, RLS, propriedade e revisão verificadas.' as resultado;
