-- Remove only sample quiz rows inserted by the old schema.sql.
-- Reverse rewards and attempts earned from the old bundled sample questions.
-- User-authored questions, attempts and unrelated XP transactions are preserved.
do $$
declare r record;
begin
  for r in
    select x.user_id, sum(x.amount)::integer as xp, sum(floor(x.amount/5.0))::integer as coins
    from public.xp_transactions x
    join public.quiz_questions q on q.id=x.source_id
    where x.source_type='quiz' and q.user_id is null and q.is_public=true and (
      (q.id='11111111-1111-4111-8111-111111111111' and q.prompt='Which organelle produces most ATP during cellular respiration?') or
      (q.id='22222222-2222-4222-8222-222222222222' and q.prompt='What is the derivative of x squared?') or
      (q.id='33333333-3333-4333-8333-333333333333' and q.prompt='The Renaissance began in which country?') or
      (q.id='44444444-4444-4444-8444-444444444444' and q.prompt='Who wrote Pride and Prejudice?') or
      (q.id='55555555-5555-4555-8555-555555555555' and q.prompt='Which molecule carries genetic instructions in most living organisms?')
    ) group by x.user_id
  loop
    update public.profiles set xp=greatest(0,xp-r.xp), coins=greatest(0,coins-r.coins), updated_at=now() where id=r.user_id;
  end loop;
end $$;

delete from public.xp_transactions x using public.quiz_questions q
where x.source_type='quiz' and x.source_id=q.id and q.user_id is null and q.is_public=true and (
  (q.id='11111111-1111-4111-8111-111111111111' and q.prompt='Which organelle produces most ATP during cellular respiration?') or
  (q.id='22222222-2222-4222-8222-222222222222' and q.prompt='What is the derivative of x squared?') or
  (q.id='33333333-3333-4333-8333-333333333333' and q.prompt='The Renaissance began in which country?') or
  (q.id='44444444-4444-4444-8444-444444444444' and q.prompt='Who wrote Pride and Prejudice?') or
  (q.id='55555555-5555-4555-8555-555555555555' and q.prompt='Which molecule carries genetic instructions in most living organisms?')
);

delete from public.quiz_attempts a using public.quiz_questions q
where a.quiz_id=q.id and q.user_id is null and q.is_public=true and (
  (q.id='11111111-1111-4111-8111-111111111111' and q.prompt='Which organelle produces most ATP during cellular respiration?') or
  (q.id='22222222-2222-4222-8222-222222222222' and q.prompt='What is the derivative of x squared?') or
  (q.id='33333333-3333-4333-8333-333333333333' and q.prompt='The Renaissance began in which country?') or
  (q.id='44444444-4444-4444-8444-444444444444' and q.prompt='Who wrote Pride and Prejudice?') or
  (q.id='55555555-5555-4555-8555-555555555555' and q.prompt='Which molecule carries genetic instructions in most living organisms?')
);

delete from public.user_achievements ua where ua.achievement_id='quiz_master'
  and not exists(select 1 from public.quiz_attempts a where a.user_id=ua.user_id and a.score=100);

delete from public.quiz_questions
where user_id is null and is_public=true and (
  (id='11111111-1111-4111-8111-111111111111' and prompt='Which organelle produces most ATP during cellular respiration?') or
  (id='22222222-2222-4222-8222-222222222222' and prompt='What is the derivative of x squared?') or
  (id='33333333-3333-4333-8333-333333333333' and prompt='The Renaissance began in which country?') or
  (id='44444444-4444-4444-8444-444444444444' and prompt='Who wrote Pride and Prejudice?') or
  (id='55555555-5555-4555-8555-555555555555' and prompt='Which molecule carries genetic instructions in most living organisms?')
);

-- Allow each signed-in user to author private quiz questions without exposing answer_index.
create or replace function public.create_quiz_question(p_subject text,p_prompt text,p_choices jsonb,p_answer_index integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare q public.quiz_questions;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if coalesce(length(trim(p_subject)),0) not between 1 and 80 then raise exception 'Subject must be 1 to 80 characters'; end if;
  if coalesce(length(trim(p_prompt)),0) not between 1 and 500 then raise exception 'Question must be 1 to 500 characters'; end if;
  if coalesce(jsonb_typeof(p_choices),'')<>'array' then raise exception 'Answer choices must be a JSON array'; end if;
  if jsonb_array_length(p_choices) not between 2 and 6 then raise exception 'Provide 2 to 6 answer choices'; end if;
  if exists(select 1 from jsonb_array_elements_text(p_choices) as answers(value) where coalesce(length(trim(value)),0) not between 1 and 160) then raise exception 'Each answer choice must be 1 to 160 characters'; end if;
  if p_answer_index<0 or p_answer_index>=jsonb_array_length(p_choices) then raise exception 'Select a correct answer'; end if;
  insert into public.quiz_questions(user_id,is_public,subject,prompt,choices,answer_index)
    values(auth.uid(),false,trim(p_subject),trim(p_prompt),p_choices,p_answer_index) returning * into q;
  return jsonb_build_object('id',q.id,'prompt',q.prompt,'choices',q.choices,'subject',q.subject);
end $$;

create or replace function public.get_daily_quiz()
returns jsonb language plpgsql security definer set search_path=public as $$
declare q public.quiz_questions;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into q from public.quiz_questions where (is_public=true or user_id=auth.uid()) and not exists(
    select 1 from public.quiz_attempts a where a.user_id=auth.uid() and a.quiz_id=public.quiz_questions.id
      and a.created_at>=date_trunc('day',now())) order by random() limit 1;
  if not found then select * into q from public.quiz_questions where (is_public=true or user_id=auth.uid()) order by random() limit 1; end if;
  if not found then return null; end if;
  return jsonb_build_object('id',q.id,'prompt',q.prompt,'choices',q.choices,'subject',q.subject);
end $$;

create or replace function public.submit_quiz_answer(p_question_id uuid,p_answer_index integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare q public.quiz_questions; correct boolean; reward boolean; attempt_id uuid; score_value integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into q from public.quiz_questions where id=p_question_id and (is_public=true or user_id=auth.uid()) for update;
  if not found then raise exception 'Question not found'; end if;
  if p_answer_index<0 or p_answer_index>=jsonb_array_length(q.choices) then raise exception 'Invalid answer'; end if;
  correct:=p_answer_index=q.answer_index; score_value:=case when correct then 100 else 0 end;
  reward:=correct and q.is_public and not exists(select 1 from public.xp_transactions where user_id=auth.uid() and source_type='quiz' and source_id=q.id);
  insert into public.quiz_attempts(user_id,quiz_id,score,rewarded) values(auth.uid(),q.id,score_value,reward) returning id into attempt_id;
  if reward then
    insert into public.xp_transactions(user_id,source_type,source_id,amount) values(auth.uid(),'quiz',q.id,25) on conflict do nothing;
    update public.profiles set xp=xp+25,coins=coins+5,updated_at=now() where id=auth.uid();
  end if;
  if correct then perform public.refresh_achievements(auth.uid()); end if;
  return jsonb_build_object('correct',correct,'score',score_value,'rewarded',reward,'xp',case when reward then 25 else 0 end,'attempt_id',attempt_id);
end $$;

revoke all on function public.create_quiz_question(text,text,jsonb,integer) from public,anon;
revoke all on function public.get_daily_quiz() from public,anon;
revoke all on function public.submit_quiz_answer(uuid,integer) from public,anon;
grant execute on function public.create_quiz_question(text,text,jsonb,integer) to authenticated;
grant execute on function public.get_daily_quiz() to authenticated;
grant execute on function public.submit_quiz_answer(uuid,integer) to authenticated;
