-- QuestStudy Supabase setup. Run in Supabase Dashboard > SQL Editor.
-- Idempotent: safe to run more than once.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null default 'Scholar', avatar text not null default '✦',
  xp integer not null default 0 check(xp >= 0), coins integer not null default 0 check(coins >= 0),
  streak integer not null default 0 check(streak >= 0), last_study_date date,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.profiles add column if not exists last_study_date date;
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, color text not null default '#a18aff', created_at timestamptz not null default now(),
  unique(user_id,name)
);
create table if not exists public.quests (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  subject text not null default 'General', subject_id uuid references public.subjects(id) on delete set null,
  title text not null check(length(trim(title)) between 1 and 160),
  difficulty text not null check(difficulty in ('Easy','Medium','Hard')), due_date date,
  completed_at timestamptz, created_at timestamptz not null default now()
);
alter table public.quests add column if not exists subject text not null default 'General';
create index if not exists quests_user_created_idx on public.quests(user_id,created_at desc);

create table if not exists public.quiz_questions (
  id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade,
  is_public boolean not null default false, subject text not null default 'General', prompt text not null,
  choices jsonb not null check(jsonb_typeof(choices)='array' and jsonb_array_length(choices)>=2),
  answer_index integer not null check(answer_index>=0 and answer_index<jsonb_array_length(choices)),
  created_at timestamptz not null default now()
);
alter table public.quiz_questions alter column user_id drop not null;
alter table public.quiz_questions add column if not exists is_public boolean not null default false;
alter table public.quiz_questions add column if not exists subject text not null default 'General';
create index if not exists quiz_questions_public_idx on public.quiz_questions(is_public,subject);

create table if not exists public.quiz_attempts (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  quiz_id uuid references public.quiz_questions(id) on delete set null,
  score integer not null check(score between 0 and 100), rewarded boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.quiz_attempts add column if not exists rewarded boolean not null default false;
create index if not exists quiz_attempts_user_idx on public.quiz_attempts(user_id,created_at desc);

create table if not exists public.xp_transactions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null check(source_type in ('quest','quiz','focus')), source_id uuid not null,
  amount integer not null check(amount>0 and amount<=100), created_at timestamptz not null default now(),
  unique(user_id,source_type,source_id)
);
create table if not exists public.achievements (
  id text primary key, name text not null, description text not null, icon text not null default '✦'
);
insert into public.achievements(id,name,description,icon) values
 ('first_quest','First Quest','Complete your first quest','⚡'),
 ('quests_5','Bookworm','Complete 5 quests','📚'),
 ('quests_10','Quest champion','Complete 10 quests','🏅'),
 ('quiz_master','Quiz master','Answer a quiz question correctly','🧠'),
 ('streak_3','Getting warmer','Keep a 3-day study streak','🔥'),
 ('streak_7','On fire','Keep a 7-day study streak','🔥'),
 ('focus_5','Focused mind','Complete 5 focus sessions','🎯'),
 ('level_10','Legendary scholar','Reach level 10','👑')
on conflict(id) do update set name=excluded.name,description=excluded.description,icon=excluded.icon;
create table if not exists public.user_achievements (
  user_id uuid not null references auth.users(id) on delete cascade,
  achievement_id text not null references public.achievements(id), unlocked_at timestamptz not null default now(),
  primary key(user_id,achievement_id)
);
create table if not exists public.focus_sessions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  duration_minutes integer not null check(duration_minutes between 25 and 180),
  started_at timestamptz not null default now(), completed_at timestamptz, cancelled_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.focus_sessions alter column completed_at drop not null;
alter table public.focus_sessions alter column completed_at drop default;
alter table public.focus_sessions add column if not exists started_at timestamptz not null default now();
alter table public.focus_sessions add column if not exists cancelled_at timestamptz;
create index if not exists focus_sessions_user_idx on public.focus_sessions(user_id,completed_at desc);
create unique index if not exists focus_one_open_session_per_user on public.focus_sessions(user_id)
  where completed_at is null and cancelled_at is null;
create table if not exists public.avatar_items (
  item_id text primary key, name text not null, price integer not null check(price>=0), created_at timestamptz not null default now()
);
insert into public.avatar_items(item_id,name,price) values
 ('✦','Scholar star',0),('🌙','Moonlight aura',200),('👑','Golden crown',450),('🐉','Little dragon',300),('💫','Star trail',150)
on conflict(item_id) do update set name=excluded.name,price=excluded.price;
create table if not exists public.avatar_inventory (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null references public.avatar_items(item_id), purchased_at timestamptz not null default now(),
  primary key(user_id,item_id)
);

create or replace function public.create_profile_for_user()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id,username) values(new.id,coalesce(nullif(trim(new.raw_user_meta_data->>'username'),''),'Scholar')) on conflict(id) do nothing;
  insert into public.avatar_inventory(user_id,item_id) values(new.id,'✦') on conflict do nothing;
  insert into public.subjects(user_id,name,color) values
    (new.id,'Mathematics','#a18aff'),(new.id,'Biology','#65d8a7'),
    (new.id,'Literature','#ffbc70'),(new.id,'History','#79adff') on conflict(user_id,name) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created_queststudy on auth.users;
create trigger on_auth_user_created_queststudy after insert on auth.users for each row execute function public.create_profile_for_user();

create or replace function public.record_study_day(p_user_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.profiles set
    streak=case when last_study_date=current_date then streak when last_study_date=current_date-1 then streak+1 else 1 end,
    last_study_date=current_date,updated_at=now() where id=p_user_id;
end $$;
create or replace function public.refresh_achievements(p_user_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare quest_count integer; focus_count integer; current_xp integer; current_streak integer;
begin
  select count(*) into quest_count from public.quests where user_id=p_user_id and completed_at is not null;
  select count(*) into focus_count from public.focus_sessions where user_id=p_user_id and completed_at is not null;
  select xp,streak into current_xp,current_streak from public.profiles where id=p_user_id;
  insert into public.user_achievements(user_id,achievement_id)
  select p_user_id,a.id from public.achievements a where
    (a.id='first_quest' and quest_count>=1) or (a.id='quests_5' and quest_count>=5) or
    (a.id='quests_10' and quest_count>=10) or
    (a.id='quiz_master' and exists(select 1 from public.quiz_attempts where user_id=p_user_id and score=100)) or
    (a.id='streak_3' and current_streak>=3) or (a.id='streak_7' and current_streak>=7) or
    (a.id='focus_5' and focus_count>=5) or (a.id='level_10' and current_xp>=4500)
  on conflict(user_id,achievement_id) do nothing;
end $$;

create or replace function public.complete_quest(p_quest_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare q public.quests; reward integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into q from public.quests where id=p_quest_id and user_id=auth.uid() for update;
  if not found then raise exception 'Quest not found'; end if;
  if q.completed_at is not null then return jsonb_build_object('awarded',false,'xp',0); end if;
  reward:=case q.difficulty when 'Easy' then 25 when 'Medium' then 50 else 100 end;
  update public.quests set completed_at=now() where id=q.id;
  insert into public.xp_transactions(user_id,source_type,source_id,amount) values(auth.uid(),'quest',q.id,reward) on conflict do nothing;
  update public.profiles set xp=xp+reward,coins=coins+floor(reward/5.0)::integer,updated_at=now() where id=auth.uid();
  perform public.record_study_day(auth.uid());
  perform public.refresh_achievements(auth.uid());
  return jsonb_build_object('awarded',true,'xp',reward);
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

create or replace function public.start_focus_session(p_duration_minutes integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare existing public.focus_sessions; created public.focus_sessions;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_duration_minutes<25 or p_duration_minutes>180 then raise exception 'Focus session must be 25 to 180 minutes'; end if;
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text)::bigint);
  select * into existing from public.focus_sessions where user_id=auth.uid() and completed_at is null and cancelled_at is null
    and started_at>now()-interval '4 hours' order by started_at desc limit 1 for update;
  if found then return jsonb_build_object('id',existing.id,'started_at',existing.started_at,'duration_minutes',existing.duration_minutes); end if;
  update public.focus_sessions set cancelled_at=now() where user_id=auth.uid() and completed_at is null and cancelled_at is null and started_at<=now()-interval '4 hours';
  insert into public.focus_sessions(user_id,duration_minutes) values(auth.uid(),p_duration_minutes) returning * into created;
  return jsonb_build_object('id',created.id,'started_at',created.started_at,'duration_minutes',created.duration_minutes);
end $$;
create or replace function public.complete_focus_session(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare f public.focus_sessions;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into f from public.focus_sessions where id=p_session_id and user_id=auth.uid() for update;
  if not found then raise exception 'Focus session not found'; end if;
  if f.completed_at is not null or f.cancelled_at is not null then return jsonb_build_object('awarded',false,'xp',0); end if;
  if now()<f.started_at+make_interval(mins=>f.duration_minutes) then raise exception 'Focus session is not complete yet'; end if;
  update public.focus_sessions set completed_at=now() where id=f.id;
  insert into public.xp_transactions(user_id,source_type,source_id,amount) values(auth.uid(),'focus',f.id,25) on conflict do nothing;
  update public.profiles set xp=xp+25,coins=coins+5,updated_at=now() where id=auth.uid();
  perform public.record_study_day(auth.uid());
  perform public.refresh_achievements(auth.uid());
  return jsonb_build_object('awarded',true,'xp',25);
end $$;

create or replace function public.cancel_focus_session(p_session_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.focus_sessions set cancelled_at=now()
  where id=p_session_id and user_id=auth.uid() and completed_at is null and cancelled_at is null;
end $$;

create or replace function public.purchase_avatar(p_item_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare item public.avatar_items; current_coins integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into item from public.avatar_items where item_id=p_item_id;
  if not found then raise exception 'Avatar item is not for sale'; end if;
  select coins into current_coins from public.profiles where id=auth.uid() for update;
  if exists(select 1 from public.avatar_inventory where user_id=auth.uid() and item_id=p_item_id) then
    return jsonb_build_object('purchased',false,'coins',current_coins);
  end if;
  if current_coins<item.price then raise exception 'Not enough coins'; end if;
  update public.profiles set coins=coins-item.price,updated_at=now() where id=auth.uid() returning coins into current_coins;
  insert into public.avatar_inventory(user_id,item_id) values(auth.uid(),p_item_id);
  return jsonb_build_object('purchased',true,'coins',current_coins);
end $$;
create or replace function public.equip_avatar(p_item_id text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.avatar_inventory where user_id=auth.uid() and item_id=p_item_id) then raise exception 'Unlock this avatar item first'; end if;
  update public.profiles set avatar=p_item_id,updated_at=now() where id=auth.uid();
end $$;

-- RLS policies and table privileges
alter table public.profiles enable row level security;
alter table public.subjects enable row level security;
alter table public.quests enable row level security;
alter table public.quiz_questions enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.xp_transactions enable row level security;
alter table public.achievements enable row level security;
alter table public.user_achievements enable row level security;
alter table public.focus_sessions enable row level security;
alter table public.avatar_items enable row level security;
alter table public.avatar_inventory enable row level security;

drop policy if exists "profiles read own" on public.profiles;
drop policy if exists "profiles update own safe fields" on public.profiles;
drop policy if exists "subjects own all" on public.subjects;
drop policy if exists "quests own all" on public.quests;
drop policy if exists "quests read own" on public.quests;
drop policy if exists "quests insert own" on public.quests;
drop policy if exists "quests update own fields" on public.quests;
drop policy if exists "quests delete own" on public.quests;
drop policy if exists "quiz public read safe fields" on public.quiz_questions;
drop policy if exists "quiz questions own all" on public.quiz_questions;
drop policy if exists "attempts read own" on public.quiz_attempts;
drop policy if exists "attempts insert own" on public.quiz_attempts;
drop policy if exists "quiz attempts read own" on public.quiz_attempts;
drop policy if exists "transactions read own" on public.xp_transactions;
drop policy if exists "achievement catalog readable" on public.achievements;
drop policy if exists "user achievements read own" on public.user_achievements;
drop policy if exists "focus sessions read own" on public.focus_sessions;
drop policy if exists "focus sessions own all" on public.focus_sessions;
drop policy if exists "avatar items readable" on public.avatar_items;
drop policy if exists "inventory read own" on public.avatar_inventory;
create policy "profiles read own" on public.profiles for select to authenticated using(id=auth.uid());
create policy "profiles update own safe fields" on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
create policy "subjects own all" on public.subjects for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "quests read own" on public.quests for select to authenticated using(user_id=auth.uid());
create policy "quests insert own" on public.quests for insert to authenticated with check(user_id=auth.uid() and completed_at is null);
create policy "quests update own fields" on public.quests for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "quests delete own" on public.quests for delete to authenticated using(user_id=auth.uid());
create policy "quiz public read safe fields" on public.quiz_questions for select to authenticated using(is_public=true);
create policy "quiz attempts read own" on public.quiz_attempts for select to authenticated using(user_id=auth.uid());
create policy "transactions read own" on public.xp_transactions for select to authenticated using(user_id=auth.uid());
create policy "achievement catalog readable" on public.achievements for select to authenticated using(true);
create policy "user achievements read own" on public.user_achievements for select to authenticated using(user_id=auth.uid());
create policy "focus sessions read own" on public.focus_sessions for select to authenticated using(user_id=auth.uid());
create policy "avatar items readable" on public.avatar_items for select to authenticated using(true);
create policy "inventory read own" on public.avatar_inventory for select to authenticated using(user_id=auth.uid());

revoke all on public.profiles,public.subjects,public.quests,public.quiz_questions,public.quiz_attempts,
  public.xp_transactions,public.achievements,public.user_achievements,public.focus_sessions,
  public.avatar_items,public.avatar_inventory from anon,authenticated;
grant select on public.profiles to authenticated;
grant update(username) on public.profiles to authenticated;
grant select,insert,delete on public.subjects to authenticated;
grant update(name,color) on public.subjects to authenticated;
grant select,insert,delete on public.quests to authenticated;
grant update(title,subject,difficulty,due_date) on public.quests to authenticated;
grant select(id,prompt,choices,subject) on public.quiz_questions to authenticated;
grant select on public.quiz_attempts,public.xp_transactions,public.achievements,public.user_achievements,
  public.focus_sessions,public.avatar_items,public.avatar_inventory to authenticated;

revoke all on function public.create_profile_for_user() from public,anon,authenticated;
revoke all on function public.record_study_day(uuid) from public,anon,authenticated;
revoke all on function public.refresh_achievements(uuid) from public,anon,authenticated;
revoke all on function public.complete_quest(uuid) from public,anon;
revoke all on function public.get_daily_quiz() from public,anon;
revoke all on function public.submit_quiz_answer(uuid,integer) from public,anon;
revoke all on function public.create_quiz_question(text,text,jsonb,integer) from public,anon;
revoke all on function public.start_focus_session(integer) from public,anon;
revoke all on function public.complete_focus_session(uuid) from public,anon;
revoke all on function public.cancel_focus_session(uuid) from public,anon;
revoke all on function public.purchase_avatar(text) from public,anon;
revoke all on function public.equip_avatar(text) from public,anon;
grant execute on function public.complete_quest(uuid) to authenticated;
grant execute on function public.get_daily_quiz() to authenticated;
grant execute on function public.submit_quiz_answer(uuid,integer) to authenticated;
grant execute on function public.create_quiz_question(text,text,jsonb,integer) to authenticated;
grant execute on function public.start_focus_session(integer) to authenticated;
grant execute on function public.complete_focus_session(uuid) to authenticated;
grant execute on function public.cancel_focus_session(uuid) to authenticated;
grant execute on function public.purchase_avatar(text) to authenticated;
grant execute on function public.equip_avatar(text) to authenticated;

-- Give existing accounts the default avatar and starter subjects too.
insert into public.avatar_inventory(user_id,item_id) select id,'✦' from public.profiles on conflict do nothing;
insert into public.subjects(user_id,name,color)
select p.id,s.name,s.color from public.profiles p cross join (values
  ('Mathematics','#a18aff'),('Biology','#65d8a7'),('Literature','#ffbc70'),('History','#79adff')
) as s(name,color) on conflict(user_id,name) do nothing;
