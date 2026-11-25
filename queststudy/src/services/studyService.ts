import type { SupabaseClient } from '@supabase/supabase-js'
import type { Difficulty, QuizQuestion, Quest, UserData } from '../types'

type DbQuest = {
  id: string
  title: string
  subject: string
  difficulty: Difficulty
  due_date: string | null
  completed_at: string | null
}

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const addDays = (amount: number) => {
  const d = new Date(`${today()}T12:00:00`)
  d.setDate(d.getDate() + amount)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function dueDateFromLabel(label: string): string {
  if (label === 'Today') return today()
  if (label === 'Tomorrow') return addDays(1)
  if (label === 'Next week') return addDays(7)
  const parsed = new Date(`${label} ${new Date().getFullYear()} 12:00:00`)
  return Number.isNaN(parsed.getTime()) ? addDays(1) : `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`
}

function dueLabel(value: string | null): string {
  if (!value) return 'No deadline'
  const date = new Date(`${value}T12:00:00`)
  if (value === today()) return 'Today'
  if (value === addDays(1)) return 'Tomorrow'
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)
}

function mapQuest(q: DbQuest): Quest {
  return { id: q.id, title: q.title, subject: q.subject, difficulty: q.difficulty, due: dueLabel(q.due_date), done: Boolean(q.completed_at) }
}

export async function loadUserData(client: SupabaseClient, userId: string): Promise<UserData> {
  const [profile, quests, inventory, achievements, sessions, attempts, quizRewards, subjects, avatarCatalog] = await Promise.all([
    client.from('profiles').select('username,avatar,xp,coins,streak,last_study_date').eq('id', userId).single(),
    client.from('quests').select('id,title,subject,difficulty,due_date,completed_at').eq('user_id', userId).order('created_at', { ascending: false }),
    client.from('avatar_inventory').select('item_id').eq('user_id', userId),
    client.from('user_achievements').select('achievement_id').eq('user_id', userId),
    client.from('focus_sessions').select('id,duration_minutes,completed_at').eq('user_id', userId).not('completed_at', 'is', null),
    client.from('quiz_attempts').select('id,score').eq('user_id', userId),
    client.from('xp_transactions').select('source_id').eq('user_id', userId).eq('source_type', 'quiz'),
    client.from('subjects').select('id,name,color').eq('user_id', userId).order('name'),
    client.from('avatar_items').select('item_id,name,price').order('price'),
  ])
  for (const result of [profile, quests, inventory, achievements, sessions, attempts, quizRewards, subjects, avatarCatalog]) {
    if (result.error) throw result.error
  }
  const profileRow = profile.data
  if (!profileRow) throw new Error('Your Supabase profile is missing. Run supabase/schema.sql and create your account again.')
  const questRows = (quests.data ?? []) as DbQuest[]
  const quizScores = (attempts.data ?? []).map((attempt) => attempt.score as number)
  const focusRows = (sessions.data ?? []) as { duration_minutes: number; completed_at: string }[]
  const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const now = new Date()
  const recentDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6 + index, 12)
    return localDate(date)
  })
  const weeklyFocusMinutes = recentDays.map((day) => focusRows.filter((row) => localDate(new Date(row.completed_at)) === day).reduce((sum, row) => sum + row.duration_minutes, 0))
  const monthlyFocusMinutes = Array.from({ length: 4 }, (_, bucket) => {
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (3 - bucket) * 7, 23, 59, 59)
    const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 6, 0, 0, 0)
    return focusRows.filter((row) => { const completed = new Date(row.completed_at); return completed >= start && completed <= end }).reduce((sum, row) => sum + row.duration_minutes, 0)
  })
  return {
    name: profileRow.username,
    xp: profileRow.xp,
    coins: profileRow.coins,
    streak: profileRow.streak,
    lastStudyDate: profileRow.last_study_date,
    quests: questRows.map(mapQuest),
    inventory: (inventory.data ?? []).map((item) => item.item_id as string),
    equipped: profileRow.avatar,
    sessions: focusRows.length,
    focusMinutes: focusRows.reduce((sum, row) => sum + row.duration_minutes, 0),
    weeklyFocusMinutes,
    monthlyFocusMinutes,
    quizBest: quizScores.length ? Math.max(...quizScores) : 0,
    quizCount: quizScores.length,
    completedTotal: questRows.filter((q) => q.completed_at).length,
    achievementIds: (achievements.data ?? []).map((item) => item.achievement_id as string),
    rewardedQuizIds: (quizRewards.data ?? []).map((item) => item.source_id as string),
    subjects: (subjects.data ?? []).map((row) => ({ id: row.id as string, name: row.name as string, color: row.color as string })),
    avatarCatalog: (avatarCatalog.data ?? []).map((row) => ({ itemId: row.item_id as string, name: row.name as string, price: row.price as number })),
  }
}

export async function createQuest(client: SupabaseClient, userId: string, input: Omit<Quest, 'id' | 'done'>): Promise<Quest> {
  const { data, error } = await client.from('quests').insert({
    user_id: userId,
    title: input.title,
    subject: input.subject,
    difficulty: input.difficulty,
    due_date: dueDateFromLabel(input.due),
  }).select('id,title,subject,difficulty,due_date,completed_at').single()
  if (error) throw error
  return mapQuest(data as DbQuest)
}

export async function updateQuest(client: SupabaseClient, id: string, input: Omit<Quest, 'id' | 'done'>): Promise<Quest> {
  const { data, error } = await client.from('quests').update({
    title: input.title,
    subject: input.subject,
    difficulty: input.difficulty,
    due_date: dueDateFromLabel(input.due),
  }).eq('id', id).select('id,title,subject,difficulty,due_date,completed_at').single()
  if (error) throw error
  return mapQuest(data as DbQuest)
}

export async function deleteQuest(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from('quests').delete().eq('id', id)
  if (error) throw error
}

export async function completeQuest(client: SupabaseClient, id: string): Promise<{ awarded: boolean; xp: number }> {
  const { data, error } = await client.rpc('complete_quest', { p_quest_id: id })
  if (error) throw error
  return data as { awarded: boolean; xp: number }
}

export async function saveProfile(client: SupabaseClient, userId: string, name: string): Promise<void> {
  const { error } = await client.from('profiles').update({ username: name.trim() }).eq('id', userId)
  if (error) throw error
}

export async function purchaseAvatar(client: SupabaseClient, itemId: string): Promise<void> {
  const { error } = await client.rpc('purchase_avatar', { p_item_id: itemId })
  if (error) throw error
}

export async function equipAvatar(client: SupabaseClient, userId: string, itemId: string): Promise<void> {
  const { error } = await client.from('profiles').update({ avatar: itemId }).eq('id', userId)
  if (error) throw error
}

export async function getDailyQuestion(client: SupabaseClient): Promise<QuizQuestion> {
  const { data, error } = await client.rpc('get_daily_quiz')
  if (error) throw error
  if (!data) throw new Error('No quiz questions are available yet. Add a question in the Quiz arena.')
  return data as QuizQuestion
}

export async function createQuizQuestion(client: SupabaseClient, input: { subject: string; prompt: string; choices: string[]; answerIndex: number }): Promise<QuizQuestion> {
  const { data, error } = await client.rpc('create_quiz_question', {
    p_subject: input.subject, p_prompt: input.prompt, p_choices: input.choices, p_answer_index: input.answerIndex,
  })
  if (error) throw error
  return data as QuizQuestion
}

export async function submitQuizAnswer(client: SupabaseClient, questionId: string, answerIndex: number): Promise<{ score: number; rewarded: boolean; xp: number }> {
  const { data, error } = await client.rpc('submit_quiz_answer', { p_question_id: questionId, p_answer_index: answerIndex })
  if (error) throw error
  return data as { score: number; rewarded: boolean; xp: number }
}

export async function startFocus(client: SupabaseClient, durationMinutes: number): Promise<{ id: string; started_at: string; duration_minutes: number }> {
  const { data, error } = await client.rpc('start_focus_session', { p_duration_minutes: durationMinutes })
  if (error) throw error
  return data as { id: string; started_at: string; duration_minutes: number }
}

export async function completeFocus(client: SupabaseClient, sessionId: string): Promise<{ xp: number }> {
  const { data, error } = await client.rpc('complete_focus_session', { p_session_id: sessionId })
  if (error) throw error
  return data as { xp: number }
}

export async function cancelFocus(client: SupabaseClient, sessionId: string): Promise<void> {
  const { error } = await client.rpc('cancel_focus_session', { p_session_id: sessionId })
  if (error) throw error
}
