# QuestStudy

QuestStudy is a responsive, RPG-inspired study planner built with React, TypeScript, Vite, Tailwind CSS, React Router, Lucide, and Supabase.

## Run locally

```sh
npm install
npm run dev
```

The app works immediately in offline mode. Until you configure Supabase and sign in, quest progress, avatar cosmetics, XP, and profile preferences are saved in this browser's local storage.

## Connect Supabase

1. Create a Supabase project.
2. Copy `.env.example` to `.env.local` in this `queststudy` folder and fill in the project URL and anon/publishable key. Never put a service role key in this frontend app. Vite does not load `node_modules/.env`.
3. For a new project, run [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL editor. It creates the tables and permissions without inserting sample quiz questions.
4. If you already ran an older version of the schema, run [`supabase/migrations/20261125000000_remove_sample_quiz_questions.sql`](supabase/migrations/20261125000000_remove_sample_quiz_questions.sql) in the SQL editor. It removes the old bundled quiz examples, their attempts and rewards, and enables users to save their own quiz questions. Other user-created questions and attempts are preserved.
5. Restart `npm run dev`. Open **Profile & settings** and create an account or log in with email and password. If email confirmation is enabled, confirm the message Supabase sends before logging in.

The SQL provisions user profiles, subjects, quests, quiz questions and attempts, XP transactions, achievements, focus sessions, and avatar inventory with RLS. User subjects, avatar catalog items, quests, quiz questions, and progress are read from Supabase. The quiz has no bundled demo questions; add real questions from the Quiz arena, and each new question is saved privately to the signed-in account. XP, coins, quiz answers, focus completion, and avatar purchases are processed through database functions that check ownership and prevent duplicate rewards. The browser never receives the correct answer column or a service-role key.

The complete SQL is [`supabase/schema.sql`](supabase/schema.sql). Run that whole file in the Supabase SQL editor before creating your account.

## Build

```sh
npm run build
```
