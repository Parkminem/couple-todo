begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(11);

insert into auth.users (id, email) values
  ('11000000-0000-4000-8000-000000000001', 'member-a@example.test'),
  ('11000000-0000-4000-8000-000000000002', 'member-b@example.test');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}';
insert into public.profiles (display_name) values ('나');
select is(public.create_space(), true, 'First account creates the workspace');
insert into public.tasks (id, scope, title, assignee_id)
  values ('21000000-0000-4000-8000-000000000001', 'personal', 'Private', auth.uid());
update public.tasks set is_complete = true where title = 'Private';
insert into public.tasks (id, scope, title, space_id)
  select '21000000-0000-4000-8000-000000000002', 'shared', 'Shared', id from public.spaces;
select set_config('couple.test.old_code', public.issue_invite() ->> 'code', true);
select set_config('couple.test.code', public.issue_invite() ->> 'code', true);
select matches(current_setting('couple.test.code'), '^[A-F0-9]{4}(-[A-F0-9]{4}){3}$', 'Invitation is formatted');

set local request.jwt.claims = '{"sub":"11000000-0000-4000-8000-000000000002","role":"authenticated"}';
insert into public.profiles (display_name) values ('상대');
select is(public.create_space(), false, 'Second account cannot create a duplicate workspace');
select is((select count(*) from public.tasks), 0::bigint, 'Nonmember cannot read tasks');
select is(public.join_space(current_setting('couple.test.old_code')), 'invalid', 'Rotated code is rejected');
select is(public.join_space(current_setting('couple.test.code')), 'joined', 'Current code connects the second account');
select is(public.join_space(current_setting('couple.test.code')), 'already_joined', 'Code is only needed once');
select results_eq('select title from public.tasks', array['Shared'::text], 'The partner cannot see personal tasks');
select is((select count(*) from public.task_completion_events), 0::bigint, 'The partner cannot see personal completion events');
update public.tasks set is_complete = true where title = 'Shared';
select results_eq('select actor_id from public.task_completion_events',
  array['11000000-0000-4000-8000-000000000002'::uuid], 'Shared completion records the actual actor');
delete from public.tasks where title = 'Shared';
select is((select count(*) from public.task_completion_events), 0::bigint, 'Deleting a shared task also deletes its history');
select * from finish();
rollback;
