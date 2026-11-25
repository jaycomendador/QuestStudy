# QuestStudy

QuestStudy is a responsive, RPG-inspired study planner built with React, TypeScript, Vite, Tailwind CSS, React Router, Lucide, and Supabase.

## Run locally

```sh
npm install
npm run dev
```

The app works immediately in local demo mode. Quest progress, avatar cosmetics, XP, and profile preferences are saved in this browser's local storage.

## Connect Supabase

1. Create a Supabase project.
2. Copy `.env.example` to `.env` and fill in the project URL and anon/publishable key. Never put a service role key in this frontend app.
3. Run [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL editor.
4. Restart the Vite server. Profile settings then offer email/password registration and login.

The SQL provisions user profiles, subjects, quests, quiz attempts, XP transactions, achievements, focus sessions, and avatar inventory with RLS. Quest XP is intended to be granted through the `complete_quest` RPC, which checks ownership and prevents duplicate completion rewards.

## Build

```sh
npm run build
```
