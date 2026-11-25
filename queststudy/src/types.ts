export type Difficulty = 'Easy' | 'Medium' | 'Hard'

export type Quest = {
  id: string
  title: string
  subject: string
  difficulty: Difficulty
  due: string
  done: boolean
}

export type UserData = {
  name: string
  xp: number
  coins: number
  streak: number
  lastStudyDate?: string | null
  quests: Quest[]
  inventory: string[]
  equipped: string
  sessions: number
  focusMinutes: number
  weeklyFocusMinutes: number[]
  monthlyFocusMinutes: number[]
  quizBest: number
  quizCount: number
  completedTotal: number
  achievementIds: string[]
  rewardedQuizIds: string[]
  subjects: Subject[]
  avatarCatalog: AvatarItem[]
}

export type Subject = { id: string; name: string; color: string }
export type AvatarItem = { itemId: string; name: string; price: number }

export type QuizQuestion = {
  id: string
  prompt: string
  choices: string[]
  subject: string
}

export type CustomQuizQuestion = QuizQuestion & { answerIndex: number }
