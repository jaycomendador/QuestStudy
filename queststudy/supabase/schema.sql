-- QuestStudy schema. Apply in the Supabase SQL editor as a project owner.
create extension if not exists pgcrypto;
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null default 'Scholar', avatar text not null default '✦',
  xp integer not null default 0 check (xp >= 0), coins integer not null default 0 check (coins >= 0),
  streak integer not null default 0 check (streak >= 0), last_study_date date,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, color text not null default '#a18aff', created_at timestamptz not null default now(),
  unique(user_id,name)
);
create table if not exists public.quests (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete set null, title text not null check(length(title) between 1 and 160),
  difficulty text not null check(difficulty in ('Easy','Medium','Hard')), due_date date, completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists quests_user_created_idx on public.quests(user_id,created_at desc);
create table if not exists public.quiz_questions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete set null, prompt text not null,
  choices jsonb not null check(jsonb_typeof(choices)='array' and jsonb_array_length(choices)>=2),
  answer_index integer not null check(answer_index>=0), created_at timestamptz not null default now()
);
create table if not exists public.quiz_attempts (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  quiz_id uuid references public.quiz_questions(id) on delete set null, score integer not null check(score between 0 and 100),
  rewarded boolean not null default false, created_at timestamptz not null default now()
);
create table if not exists public.xp_transactions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null check(source_type in ('quest','quiz','focus')), source_id uuid not null,
  amount integer not null check(amount>0 and amount<=100), created_at timestamptz not null default now(), unique(user_id,source_type,source_id)
);
create table if not exists public.achievements (
  id text primary key, name text not null, description text not null, icon text not null default '✦'
);
insert into public.achievements(id,name,description,icon) values
 ('first_quest','First Quest','Complete your first quest','⚡'),('quests_5','Bookworm','Complete 5 quests','📚'),
 ('quests_10','Quest champion','Complete 10 quests','🏅'),('quiz_master','Quiz master','Score 100% on a quiz','🧠'),
 ('streak_3','Getting warmer','Keep a 3-day study streak','🔥'),('streak_7','On fire','Keep a 7-day study streak','🔥') on conflict(id) do nothing;
create table if not exists public.user_achievements (
  user_id uuid not null references auth.users(id) on delete cascade, achievement_id text not null references public.achievements(id),
  unlocked_at timestamptz not null default now(), primary key(user_id,achievement_id)
);
create table if not exists public.focus_sessions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  duration_minutes integer not null check(duration_minutes between 1 and 180), completed_at timestamptz not null default now()
);
create table if not exists public.avatar_inventory (
  user_id uuid not null references auth.users(id) on delete cascade, item_id text not null,
  purchased_at timestamptz not null default now(), primary key(user_id,item_id)
);

-- A new profile is provisioned automatically at signup.
create or replace function public.create_profile_for_user() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into public.profiles(id,username) values(new.id,coalesce(new.raw_user_meta_data->>'username','Scholar')) on conflict(id) do nothing; return new; end $$;
drop trigger if exists on_auth_user_created_queststudy on auth.users;
create trigger on_auth_user_created_queststudy after insert on auth.users for each row execute function public.create_profile_for_user();

-- Rewards are granted only by this function, once per completed quest. Client writes cannot alter XP or coins directly.
create or replace function public.complete_quest(p_quest_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare q public.quests; reward integer;
begin
 select * into q from public.quests where id=p_quest_id and user_id=auth.uid() for update;
 if not found then raise exception 'Quest not found'; end if;
 reward := case q.difficulty when 'Easy' then 25 when 'Medium' then 50 else 100 end;
 if q.completed_at is not null then return jsonb_build_object('awarded',false,'xp',0); end if;
 update public.quests set completed_at=now() where id=q.id;
 insert into public.xp_transactions(user_id,source_type,source_id,amount) values(auth.uid(),'quest',q.id,reward) on conflict do nothing;
 update public.profiles set xp=xp+reward,coins=coins+floor(reward/5.0)::int,updated_at=now() where id=auth.uid();
 return jsonb_build_object('awarded',true,'xp',reward);
end $$;
revoke all on function public.complete_quest(uuid) from public;
grant execute on function public.complete_quest(uuid) to authenticated;

alter table public.profiles enable row level security; alter table public.subjects enable row level security;
alter table public.quests enable row level security; alter table public.quiz_questions enable row level security;
alter table public.quiz_attempts enable row level security; alter table public.xp_transactions enable row level security;
alter table public.achievements enable row level security; alter table public.user_achievements enable row level security;
alter table public.focus_sessions enable row level security; alter table public.avatar_inventory enable row level security;
create policy "profiles read own" on public.profiles for select to authenticated using(id=auth.uid());
create policy "profiles update own safe fields" on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
revoke update(xp,coins,streak) on public.profiles from authenticated;
create policy "subjects own all" on public.subjects for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "quests own all" on public.quests for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "quiz questions own all" on public.quiz_questions for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "attempts read own" on public.quiz_attempts for select to authenticated using(user_id=auth.uid());
create policy "attempts insert own" on public.quiz_attempts for insert to authenticated with check(user_id=auth.uid() and rewarded=false);
create policy "transactions read own" on public.xp_transactions for select to authenticated using(user_id=auth.uid());
create policy "achievement catalog readable" on public.achievements for select to authenticated using(true);
create policy "user achievements read own" on public.user_achievements for select to authenticated using(user_id=auth.uid());
create policy "focus sessions own all" on public.focus_sessions for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "inventory read own" on public.avatar_inventory for select to authenticated using(user_id=auth.uid());

-- Keep private tables inaccessible to anonymous visitors.
revoke all on public.profiles,public.subjects,public.quests,public.quiz_questions,public.quiz_attempts,public.xp_transactions,public.user_achievements,public.focus_sessions,public.avatar_inventory from anon;
grant select,update on public.profiles to authenticated;
grant select,insert,update,delete on public.subjects,public.quests,public.quiz_questions to authenticated;
grant select,insert on public.quiz_attempts,public.focus_sessions to authenticated;
grant select on public.xp_transactions,public.achievements,public.user_achievements,public.avatar_inventory to authenticated;
