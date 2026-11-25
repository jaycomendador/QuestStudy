import { useEffect, useState } from 'react'
import { BrowserRouter, NavLink, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { BookOpen, Check, CheckCircle2, ChevronDown, Clock3, Coins, Compass, Flame, Gamepad2, Home, LogOut, Menu, Pencil, Plus, Search, Settings, Shield, ShoppingBag, Sparkles, Swords, Target, Timer, Trash2, Trophy, UserRound, X, Zap } from 'lucide-react'
import { supabase } from './lib/supabase'
import { cancelFocus, completeFocus, completeQuest as completeQuestInDb, createQuizQuestion as createQuizQuestionInDb, createQuest as createQuestInDb, deleteQuest as deleteQuestInDb, equipAvatar, getDailyQuestion, loadUserData, purchaseAvatar, saveProfile, startFocus, submitQuizAnswer, updateQuest as updateQuestInDb } from './services/studyService'
import type { Difficulty, QuizQuestion, Quest, UserData } from './types'
import './App.css'

const emptyData: UserData = {
  name: 'Scholar', xp: 0, coins: 0, streak: 0, quests: [], inventory: ['✦'], equipped: '✦',
  sessions: 0, focusMinutes: 0, weeklyFocusMinutes: Array(7).fill(0), monthlyFocusMinutes: Array(4).fill(0),
  quizBest: 0, quizCount: 0, completedTotal: 0, achievementIds: [], rewardedQuizIds: [], lastStudyDate: null, subjects: [], avatarCatalog: [],
}
const navigation = [
  { to: '/', label: 'Dashboard', icon: Home }, { to: '/quests', label: 'Quest board', icon: Compass },
  { to: '/subjects', label: 'Subjects', icon: BookOpen }, { to: '/quiz', label: 'Quiz arena', icon: Gamepad2 },
  { to: '/achievements', label: 'Achievements', icon: Trophy }, { to: '/shop', label: 'Avatar shop', icon: ShoppingBag },
  { to: '/profile', label: 'Profile & settings', icon: UserRound },
]
const emptyQuestion: QuizQuestion = { id: '', subject: '', prompt: '', choices: [] }

function readLocalData(): UserData {
  try {
    const stored = localStorage.getItem('queststudy-data')
    if (!stored) return emptyData
    return { ...emptyData, ...JSON.parse(stored) as Partial<UserData> }
  } catch { return emptyData }
}

function refreshLocalAchievements(data: UserData): UserData {
  const unlocked = new Set(data.achievementIds)
  if (data.completedTotal >= 1) unlocked.add('first_quest')
  if (data.completedTotal >= 5) unlocked.add('quests_5')
  if (data.completedTotal >= 10) unlocked.add('quests_10')
  if (data.quizBest >= 100) unlocked.add('quiz_master')
  if (data.streak >= 3) unlocked.add('streak_3')
  if (data.streak >= 7) unlocked.add('streak_7')
  if (data.sessions >= 5) unlocked.add('focus_5')
  if (data.xp >= 4500) unlocked.add('level_10')
  return { ...data, achievementIds: [...unlocked] }
}

function recordLocalActivity(data: UserData): UserData {
  const now = new Date()
  const key = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const todayKey = key(now)
  const yesterdayKey = key(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
  const streak = data.lastStudyDate === todayKey ? data.streak : data.lastStudyDate === yesterdayKey ? data.streak + 1 : 1
  const updated = { ...data, streak, lastStudyDate: todayKey }
  return refreshLocalAchievements(updated)
}

function App() { return <BrowserRouter><StudyApp /></BrowserRouter> }

function StudyApp() {
  const [data, setData] = useState<UserData>(readLocalData)
  const [userId, setUserId] = useState<string | null>(null)
  const [session, setSession] = useState(false)
  const [loading, setLoading] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingQuest, setEditingQuest] = useState<Quest | null>(null)
  const [toast, setToast] = useState('')
  const location = useLocation()
  const navigate = useNavigate()

  const notify = (message: string) => setToast(message)
  const refreshAccount = async (id: string) => {
    if (!supabase) return
    setLoading(true)
    try { setData(await loadUserData(supabase, id)) }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not load your Supabase data.') }
    finally { setLoading(false) }
  }

  useEffect(() => {
    if (!supabase) return
    let active = true
    supabase.auth.getSession().then(({ data: auth }) => {
      if (!active) return
      setUserId(auth.session?.user.id ?? null)
      setSession(Boolean(auth.session))
    }).catch(() => notify('Could not check your Supabase session.'))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, auth) => {
      setSession(Boolean(auth))
      setUserId(auth?.user.id ?? null)
      if (!auth) setData(readLocalData())
    })
    return () => { active = false; listener.subscription.unsubscribe() }
  }, [])

  useEffect(() => { if (userId) void refreshAccount(userId) }, [userId])
  useEffect(() => { if (!userId) { try { localStorage.setItem('queststudy-data', JSON.stringify(data)) } catch { /* Storage may be disabled. */ } } }, [data, userId])
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 3200); return () => window.clearTimeout(timer) }, [toast])

  const completeQuest = async (id: string) => {
    const quest = data.quests.find((item) => item.id === id)
    if (!quest || quest.done) return
    try {
      if (supabase && userId) {
        const result = await completeQuestInDb(supabase, id)
        await refreshAccount(userId)
        notify(result.awarded ? `Quest complete! +${result.xp} XP` : 'This quest was already completed.')
      } else {
        const xp = quest.difficulty === 'Easy' ? 25 : quest.difficulty === 'Medium' ? 50 : 100
        setData((current) => recordLocalActivity({ ...current, xp: current.xp + xp, coins: current.coins + Math.floor(xp / 5), completedTotal: current.completedTotal + 1, quests: current.quests.map((item) => item.id === id ? { ...item, done: true } : item) }))
        notify(`Quest complete! +${xp} XP`)
      }
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not complete the quest.') }
  }

  const saveQuest = async (input: Omit<Quest, 'id' | 'done'>) => {
    try {
      if (supabase && userId) {
        if (editingQuest) await updateQuestInDb(supabase, editingQuest.id, input)
        else await createQuestInDb(supabase, userId, input)
        await refreshAccount(userId)
      } else if (editingQuest) {
        setData((current) => ({ ...current, quests: current.quests.map((item) => item.id === editingQuest.id ? { ...item, ...input } : item) }))
      } else {
        setData((current) => ({ ...current, quests: [{ ...input, id: crypto.randomUUID(), done: false }, ...current.quests] }))
      }
      setEditingQuest(null); setModalOpen(false); notify(editingQuest ? 'Quest updated.' : 'Quest added to your board.')
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not save the quest.') }
  }

  const removeQuest = async (id: string) => {
    try {
      if (supabase && userId) { await deleteQuestInDb(supabase, id); await refreshAccount(userId) }
      else setData((current) => ({ ...current, quests: current.quests.filter((quest) => quest.id !== id) }))
      notify('Quest deleted.')
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not delete the quest.') }
  }

  const submitAnswer = async (question: QuizQuestion, answerIndex: number) => {
    if (supabase && userId && !question.id.startsWith('offline-')) {
      const result = await submitQuizAnswer(supabase, question.id, answerIndex)
      await refreshAccount(userId)
      return { correct: Boolean((result as { correct?: boolean }).correct), rewarded: result.rewarded, xp: result.xp }
    }
    throw new Error('Sign in to submit answers to your Supabase quiz data.')
  }

  const createQuizQuestion = async (input: { subject: string; prompt: string; choices: string[]; answerIndex: number }) => {
    if (!supabase || !userId) throw new Error('Sign in to add a question to your database.')
    const question = await createQuizQuestionInDb(supabase, input)
    await refreshAccount(userId)
    return question
  }

  const buyAvatar = async (emoji: string, price: number) => {
    try {
      if (data.inventory.includes(emoji)) { notify('You already own this item.'); return }
      if ((!supabase || !userId) && data.coins < price) { notify('You need more coins for this item.'); return }
      if (supabase && userId) { await purchaseAvatar(supabase, emoji); await refreshAccount(userId) }
      else setData((current) => ({ ...current, coins: current.coins - price, inventory: [...current.inventory, emoji] }))
      notify('Avatar item unlocked.')
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not buy this item.') }
  }

  const chooseAvatar = async (emoji: string) => {
    try {
      if (!data.inventory.includes(emoji)) { notify('Unlock this item before equipping it.'); return }
      if (supabase && userId) { await equipAvatar(supabase, userId, emoji); await refreshAccount(userId) }
      else setData((current) => ({ ...current, equipped: emoji }))
      notify('Avatar equipped.')
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not equip this item.') }
  }

  const saveName = async (name: string) => {
    if (!name.trim()) { notify('Display name cannot be blank.'); return }
    try {
      if (supabase && userId) await saveProfile(supabase, userId, name)
      setData((current) => ({ ...current, name: name.trim() }))
      notify('Profile saved.')
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not save your profile.') }
  }

  const beginFocus = async (duration: number) => {
    if (!supabase || !userId) return null
    const result = await startFocus(supabase, duration)
    return result
  }
  const finishFocus = async (sessionId: string | null, duration: number) => {
    try {
      if (supabase && userId && sessionId) {
        await completeFocus(supabase, sessionId)
        await refreshAccount(userId)
      } else {
        setData((current) => recordLocalActivity({ ...current, sessions: current.sessions + 1, focusMinutes: current.focusMinutes + duration, weeklyFocusMinutes: [...current.weeklyFocusMinutes.slice(0, 6), current.weeklyFocusMinutes[6] + duration], monthlyFocusMinutes: [...current.monthlyFocusMinutes.slice(0, 3), current.monthlyFocusMinutes[3] + duration], xp: current.xp + 25, coins: current.coins + 5 }))
      }
      notify('Focus session complete! +25 XP, +5 coins.')
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not record your focus session.') }
  }
  const stopFocus = async (sessionId: string | null) => {
    if (sessionId && supabase) {
      try { await cancelFocus(supabase, sessionId) }
      catch (error) { notify(error instanceof Error ? error.message : 'Could not cancel this focus session.') }
    }
  }

  const signOut = async () => {
    if (supabase) {
      const { error } = await supabase.auth.signOut()
      if (error) { notify(error.message); return }
    }
    setUserId(null); setSession(false); setData(readLocalData()); notify('Signed out.')
  }

  const title = navigation.find((item) => item.to === location.pathname)?.label ?? 'Dashboard'
  const openQuest = (quest?: Quest) => { setEditingQuest(quest ?? null); setModalOpen(true) }
  const isCloudMode = Boolean(supabase && userId)

  return <div className="app-shell">
    <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
      <div className="brand"><span className="brand-icon"><Swords size={21}/></span><span>quest<span className="brand-accent">study</span></span></div>
      <div className="side-label">YOUR SPACE</div>
      <nav>{navigation.map((item) => <NavLink onClick={() => setMenuOpen(false)} key={item.to} to={item.to} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><item.icon size={18}/><span>{item.label}</span>{item.to === '/quests' && <b className="nav-count">{data.quests.filter((quest) => !quest.done).length}</b>}</NavLink>)}</nav>
      <div className="side-spacer"/>
      <div className="sidebar-card"><div className="mini-shield"><Shield size={16}/></div><b>Keep your streak alive!</b><p>A little progress every day goes a long way.</p><div className="streak-mini"><Flame size={15}/>{data.streak} day streak</div></div>
      <div className="sync-state"><span className={isCloudMode ? 'sync-dot online' : 'sync-dot'}/>{isCloudMode ? 'Synced to Supabase' : supabase ? 'Sign in to sync' : 'Saved on this device'}</div>
      {session && <button className="nav-link signout" onClick={() => void signOut()}><LogOut size={18}/>Sign out</button>}
      <div className="side-user"><div className="avatar">{data.equipped}</div><div><b>{data.name}</b><small>Level {Math.floor(data.xp / 500) + 1} Scholar</small></div><ChevronDown size={16}/></div>
    </aside>
    <main className="main">
      <header className="topbar"><button className="icon-button mobile-menu" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle navigation">{menuOpen ? <X/> : <Menu/>}</button><div className="crumb">My space <span>/</span> <b>{title}</b></div><div className="top-actions"><button className="icon-button" aria-label="Search quests" onClick={() => navigate('/quests?search=')}><Search size={18}/></button><button className="coin-pill" onClick={() => navigate('/shop')}><Coins size={16}/>{data.coins} <span>coins</span></button><button className="profile-button" onClick={() => navigate('/profile')}><div className="avatar small">{data.equipped}</div><span>{data.name.split(' ')[0]}</span></button></div></header>
      {loading && <div className="sync-banner"><span className="sync-dot online"/>Loading your Supabase progress…</div>}
      <Routes>
        <Route path="/" element={<Dashboard data={data} complete={completeQuest} go={navigate}/>}/>
        <Route path="/quests" element={<Quests data={data} complete={completeQuest} remove={removeQuest} edit={openQuest} open={() => openQuest()}/>}/>
        <Route path="/subjects" element={<Subjects data={data} go={navigate}/>}/>
        <Route path="/quiz" element={<Quiz data={data} connected={isCloudMode} submit={submitAnswer} createQuestion={createQuizQuestion} notify={notify}/>}/>
        <Route path="/achievements" element={<Achievements data={data}/>}/>
        <Route path="/shop" element={<Shop data={data} buy={buyAvatar} equip={chooseAvatar}/>}/>
        <Route path="/profile" element={<Profile data={data} session={session} configured={Boolean(supabase)} notify={notify} saveName={saveName} startFocus={beginFocus} finishFocus={finishFocus} cancelFocus={stopFocus} signOut={signOut} onRefresh={() => userId && refreshAccount(userId)}/>}/>
        <Route path="*" element={<Dashboard data={data} complete={completeQuest} go={navigate}/>}/>
      </Routes>
    </main>
    {modalOpen && <QuestModal key={editingQuest?.id ?? 'new'} initial={editingQuest} subjects={data.subjects} close={() => { setModalOpen(false); setEditingQuest(null) }} save={saveQuest}/>}
    {toast && <div className="toast"><CheckCircle2 size={18}/>{toast}</div>}
  </div>
}

function Heading({ eyebrow, title, subtitle, action }: { eyebrow: string; title: React.ReactNode; subtitle: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{subtitle}</p></div>{action}</div>
}

function Dashboard({ data, complete, go }: { data: UserData; complete: (id: string) => void; go: (path: string) => void }) {
  const [period, setPeriod] = useState<'week' | 'month'>('week')
  const pending = data.quests.filter((quest) => !quest.done)
  const chartValues = period === 'week' ? data.weeklyFocusMinutes : data.monthlyFocusMinutes
  const chartMax = Math.max(...chartValues, 1)
  const totalMins = period === 'week' ? chartValues.reduce((sum, value) => sum + value, 0) : data.focusMinutes
  const today = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()).toUpperCase()
  const level = Math.floor(data.xp / 500) + 1
  const levelProgress = data.xp % 500 / 5
  const achievedToday = data.quests.filter((quest) => quest.done).length
  return <div className="content">
    <Heading eyebrow={today} title={<>Ready for your next <span className="gradient-text">level up?</span></>} subtitle="Every quest you complete brings you closer to your goals." action={<button className="primary-button" onClick={() => go('/quests')}><Plus size={17}/> New quest</button>}/>
    <section className="hero-card"><div className="hero-copy"><div className="rank-tag"><Sparkles size={14}/> YOUR ADVENTURE CONTINUES</div><h2>Small steps.<br/><span>Epic progress.</span></h2><p>Show up for your goals today. Each quest brings your next level a little closer.</p><button className="hero-button" onClick={() => go('/quests')}>View your quests <span>↗</span></button></div><div className="hero-art"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="planet">✦</div><div className="spark s1">✧</div><div className="spark s2">✦</div><div className="spark s3">✧</div><div className="hero-level"><span>LVL</span><b>{level}</b><small>SCHOLAR</small></div></div><div className="hero-footer"><div><span className="tiny-label">LEVEL {level} · SCHOLAR</span><strong>{data.xp.toLocaleString()} <small>XP</small></strong></div><div className="xp-track"><i style={{ width: `${levelProgress}%` }}/></div><div className="xp-next">{500 - data.xp % 500} XP to next level</div></div></section>
    <div className="stats-grid"><Stat icon={<Zap/>} label="TOTAL XP" value={data.xp.toLocaleString()} note={`${data.xp % 500} / 500 toward next level`} color="purple"/><Stat icon={<Flame/>} label="DAY STREAK" value={`${data.streak} days`} note="Complete a quest or focus session" color="orange"/><Stat icon={<CheckCircle2/>} label="QUESTS DONE" value={`${data.completedTotal}`} note={`${pending.length} active quests`} color="green"/><Stat icon={<Clock3/>} label="FOCUS TIME" value={`${(data.focusMinutes / 60).toFixed(1)} hrs`} note={`${data.sessions} completed sessions`} color="blue"/></div>
    <div className="dashboard-grid"><section className="panel quests-panel"><div className="panel-head"><div><h3>Active quests</h3><p>Your next steps to greatness</p></div><button className="text-button" onClick={() => go('/quests')}>View all <span>→</span></button></div><div className="quest-list">{pending.slice(0, 3).map((quest) => <QuestRow key={quest.id} quest={quest} complete={complete}/>)}{pending.length === 0 && <Empty text="No active quests. Create one to get started."/>}</div><div className="daily-foot"><span><Target size={15}/> COMPLETED QUESTS</span><b>{achievedToday} done</b><div className="progress"><i style={{ width: `${Math.min(100, achievedToday * 12)}%` }}/></div></div></section>
      <section className="panel week-panel"><div className="panel-head"><div><h3>Your study rhythm</h3><p>Recorded focus sessions</p></div><button className="period" onClick={() => setPeriod(period === 'week' ? 'month' : 'week')}>{period === 'week' ? 'THIS WEEK' : 'LAST 4 WEEKS'} <ChevronDown size={13}/></button></div><div className="week-total"><b>{(totalMins / 60).toFixed(1)} <small>hrs</small></b><span className="positive">{period === 'week' ? '7 days' : '28 days'}</span></div><div className="chart">{chartValues.map((minutes, index) => <div className="chart-col" key={`${period}-${index}`}><div className="chart-value">{minutes}m</div><div className={`bar ${period === 'week' && index === 6 ? 'today' : ''}`} style={{ height: `${Math.max(5, minutes / chartMax * 100)}%` }}/><span>{period === 'week' ? ['M','T','W','T','F','S','S'][index] : `W${index + 1}`}</span></div>)}</div></section></div>
    <div className="bottom-grid"><section className="panel achievements-panel"><div className="panel-head"><div><h3>Recent achievements</h3><p>Milestones you have unlocked</p></div><button className="text-button" onClick={() => go('/achievements')}>See all →</button></div>{data.achievementIds.length ? data.achievementIds.slice(-2).reverse().map((id) => { const achievement = achievementList.find((item) => item.id === id); return achievement ? <div className="achievement-row" key={id}><AchievementIcon emoji={achievement.emoji} color={achievement.color}/><div><b>{achievement.name}</b><small>{achievement.description}</small></div><span className="unlocked">UNLOCKED</span></div> : null }) : <Empty text="Complete quests, quizzes, and focus sessions to unlock achievements."/>}</section><section className="focus-card"><div className="focus-icon"><Timer size={21}/></div><div><span className="tiny-label">FOCUS MODE</span><h3>Time to lock in?</h3><p>A focused session can make all the difference.</p><button onClick={() => go('/profile?focus=1')}>Start focus session <span>→</span></button></div><div className="focus-orb">25<small>MIN</small></div></section></div>
  </div>
}

function Stat({ icon, label, value, note, color }: { icon: React.ReactNode; label: string; value: string; note: string; color: string }) {
  return <div className="stat-card"><div className={`stat-icon ${color}`}>{icon}</div><div><span>{label}</span><b>{value}</b><small>{note}</small></div><div className={`stat-glow ${color}`}/></div>
}

function QuestRow({ quest, complete }: { quest: Quest; complete: (id: string) => void }) {
  const xp = quest.difficulty === 'Easy' ? 25 : quest.difficulty === 'Medium' ? 50 : 100
  return <div className={`quest-row ${quest.done ? 'finished' : ''}`}><button className="quest-check" onClick={() => !quest.done && complete(quest.id)} disabled={quest.done} aria-label={quest.done ? 'Quest completed' : 'Complete quest'}>{quest.done ? <Check size={15}/> : null}</button><div className="quest-mark">{quest.subject === 'Biology' ? '⚛' : quest.subject === 'Mathematics' ? '∑' : quest.subject === 'Literature' ? '✎' : '⌛'}</div><div className="quest-info"><b>{quest.title}</b><span>{quest.subject} <i>·</i> <em className={quest.difficulty.toLowerCase()}>{quest.difficulty}</em></span></div><div className="quest-reward"><b>+{xp}</b><small>XP</small></div></div>
}

function Empty({ text }: { text: string }) { return <div className="empty-state"><Sparkles size={20}/>{text}</div> }

function Quests({ data, complete, remove, edit, open }: { data: UserData; complete: (id: string) => void; remove: (id: string) => void; edit: (quest: Quest) => void; open: () => void }) {
  const [filter, setFilter] = useState('All quests')
  const [searchParams] = useSearchParams()
  const [searchText, setSearchText] = useState(searchParams.get('search') ?? '')
  const subjectFilter = searchParams.get('subject')
  const filtered = data.quests.filter((quest) => (filter === 'All quests' || (filter === 'Completed' ? quest.done : !quest.done)) && (!subjectFilter || quest.subject === subjectFilter) && quest.title.toLowerCase().includes(searchText.toLowerCase()))
  return <div className="content"><Heading eyebrow="YOUR ADVENTURE LOG" title={<>Quest <span className="gradient-text">board</span></>} subtitle="Create, edit, complete, and remove your study quests." action={<button className="primary-button" onClick={open}><Plus size={17}/> Create quest</button>}/><div className="quest-summary"><div><span>ACTIVE QUESTS</span><b>{data.quests.filter((quest) => !quest.done).length}</b></div><div><span>COMPLETED</span><b>{data.completedTotal}</b></div><div><span>XP EARNED</span><b>{data.xp.toLocaleString()}</b></div><div className="summary-medal">🏆</div></div><div className="panel quest-board"><div className="panel-head"><div><h3>{subjectFilter ? `${subjectFilter} quests` : 'Your quests'}</h3><p>Make each one count</p></div><div className="quest-tools"><input className="quest-search" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search quests" aria-label="Search quests"/><select className="filter-select" value={filter} onChange={(event) => setFilter(event.target.value)}><option>All quests</option><option>Active</option><option>Completed</option></select></div></div>{filtered.length ? <div className="board-list">{filtered.map((quest) => <div className="board-row" key={quest.id}><QuestRow quest={quest} complete={complete}/><div className="due-date"><Clock3 size={14}/>{quest.due}</div>{!quest.done && <button className="edit-button" aria-label={`Edit ${quest.title}`} onClick={() => edit(quest)}><Pencil size={15}/></button>}<button className="delete-button" aria-label={`Delete ${quest.title}`} onClick={() => remove(quest.id)}><Trash2 size={16}/></button></div>)}</div> : <Empty text="No matching quests. Add an adventure or change your search."/>}</div></div>
}

function Subjects({ data, go }: { data: UserData; go: (path: string) => void }) {
  return <div className="content"><Heading eyebrow="YOUR LEARNING PATHS" title={<>Choose your <span className="gradient-text">realm</span></>} subtitle="Subjects are loaded from your account database."/>{data.subjects.length ? <div className="subject-grid">{data.subjects.map((subject) => { const items = data.quests.filter((quest) => quest.subject === subject.name); const completed = items.filter((quest) => quest.done).length; const progress = items.length ? Math.round(completed / items.length * 100) : 0; return <div className="panel subject-card" key={subject.id}><div className="subject-top"><div className="subject-symbol" style={{ color: subject.color, background: `${subject.color}18` }}>{subjectIcon(subject.name)}</div><span className="subject-tag">{items.length} quests</span></div><h3>{subject.name}</h3><p>{completed} of {items.length} quests completed</p><div className="subject-progress"><span>SUBJECT MASTERY</span><b>{progress}%</b></div><div className="progress"><i style={{ width: `${progress}%`, background: subject.color }}/></div><button className="subject-open" onClick={() => go(`/quests?subject=${encodeURIComponent(subject.name)}`)}>View {subject.name} quests <span>→</span></button></div> })}</div> : <Empty text="No subjects are set up for this account yet."/>}</div>
}

function subjectIcon(name: string) {
  if (name.toLowerCase().includes('math')) return '∑'
  if (name.toLowerCase().includes('bio')) return '⚛'
  if (name.toLowerCase().includes('liter')) return '✎'
  if (name.toLowerCase().includes('history')) return '⌛'
  return '◈'
}

function Quiz({ data, connected, submit, createQuestion, notify }: { data: UserData; connected: boolean; submit: (question: QuizQuestion, answer: number) => Promise<{ correct: boolean; rewarded: boolean; xp: number }>; createQuestion: (input: { subject: string; prompt: string; choices: string[]; answerIndex: number }) => Promise<QuizQuestion>; notify: (message: string) => void }) {
  const [question, setQuestion] = useState<QuizQuestion>(emptyQuestion)
  const [answer, setAnswer] = useState<number | null>(null)
  const [result, setResult] = useState<{ correct: boolean; rewarded: boolean; xp: number } | null>(null)
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [creatorOpen, setCreatorOpen] = useState(false)
  const loadQuestion = async (nextIndex = index + 1) => {
    setError(''); setAnswer(null); setResult(null); setBusy(true)
    try {
      if (!connected || !supabase) throw new Error('Sign in to load quiz questions from your database.')
      setQuestion(await getDailyQuestion(supabase))
      setIndex(nextIndex)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not load a quiz question.') }
    finally { setBusy(false) }
  }
  useEffect(() => { if (connected) void loadQuestion(0); else { setQuestion(emptyQuestion); setAnswer(null); setResult(null); setIndex(0); setError('Sign in to load quiz questions from your database.') } }, [connected])
  const sendAnswer = async () => {
    if (answer === null || busy || !question.id) return
    setBusy(true)
    try {
      const submitted = await submit(question, answer)
      setResult(submitted)
      notify(submitted.correct ? (submitted.rewarded ? `Correct! +${submitted.xp} XP` : 'Correct! Your answer was saved. This question has no XP reward.') : 'Not quite. Try another question.')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not submit this answer.') }
    finally { setBusy(false) }
  }
  const saveQuestion = async (input: { subject: string; prompt: string; choices: string[]; answerIndex: number }) => {
    try {
      const created = await createQuestion(input)
      setCreatorOpen(false)
      setQuestion(created); setAnswer(null); setResult(null); setError('')
      notify('Your question is saved to the database.')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not save your question.') }
  }
  return <div className="content"><Heading eyebrow="TEST YOUR KNOWLEDGE" title={<>Quiz <span className="gradient-text">arena</span></>} subtitle="Quiz questions and answers come from your Supabase database." action={<button className="primary-button" disabled={!connected} onClick={() => setCreatorOpen(true)}><Plus size={17}/> Add question</button>}/><div className="quiz-layout"><div className="panel quiz-card"><div className="quiz-top"><span className="quiz-tag"><Gamepad2 size={14}/> DATABASE QUIZ</span><span>{data.quizCount} ATTEMPTS</span></div><div className="quiz-progress"><i style={{ width: result ? '100%' : question.id ? '25%' : '0%' }}/></div>{question.id ? <><div className="quiz-subject">{question.subject.toUpperCase()} · MULTIPLE CHOICE</div><h2>{question.prompt}</h2><div className="answers">{question.choices.map((choice, choiceIndex) => <button key={choice} disabled={Boolean(result) || busy} className={`answer ${answer === choiceIndex ? 'selected' : ''} ${result && answer === choiceIndex && result.correct ? 'correct' : ''} ${result && answer === choiceIndex && !result.correct ? 'incorrect' : ''}`} onClick={() => setAnswer(choiceIndex)}><span>{String.fromCharCode(65 + choiceIndex)}</span>{choice}{result && answer === choiceIndex && result.correct && <CheckCircle2 size={17}/>}</button>)}</div></> : <Empty text={connected ? 'No questions are available yet. Add your own study question.' : 'Sign in to load quiz questions from your database.'}/ >}{error && <div className="auth-error">{error}</div>}<div className="quiz-actions"><button className="primary-button quiz-submit" disabled={!question.id || answer === null || busy || Boolean(result)} onClick={() => void sendAnswer()}>{busy ? 'Checking…' : result ? 'Answer submitted' : 'Submit answer'} {!result && <span>→</span>}</button><button className="outline-button" disabled={busy || !connected} onClick={() => void loadQuestion()}>Next question</button></div>{result && <div className="quiz-feedback">{result.correct ? 'Correct answer. Well done!' : 'That answer was incorrect. Keep practicing.'}</div>}</div><div className="panel quiz-side"><div className="quiz-trophy">🏆</div><span className="tiny-label">YOUR BEST SCORE</span><b>{data.quizBest}%</b><p>Questions you add are saved to your account.</p><div className="divider"/><div className="quiz-side-row"><span>Quizzes completed</span><b>{data.quizCount}</b></div><div className="quiz-side-row"><span>Rewards earned</span><b>{data.rewardedQuizIds.length}</b></div></div></div>{creatorOpen && <QuizQuestionCreator subjects={data.subjects} close={() => setCreatorOpen(false)} save={saveQuestion}/>}</div>
}

function QuizQuestionCreator({ subjects, close, save }: { subjects: UserData['subjects']; close: () => void; save: (input: { subject: string; prompt: string; choices: string[]; answerIndex: number }) => Promise<void> }) {
  const [subject, setSubject] = useState(subjects[0]?.name ?? 'General')
  const [prompt, setPrompt] = useState('')
  const [choices, setChoices] = useState(['', '', '', ''])
  const [answerIndex, setAnswerIndex] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const cleanChoices = choices.map((choice) => choice.trim())
    if (!prompt.trim() || cleanChoices.some((choice) => !choice)) { setError('Enter a question and all four choices.'); return }
    setSaving(true); setError('')
    await save({ subject, prompt: prompt.trim(), choices: cleanChoices, answerIndex })
    setSaving(false)
  }
  return <div className="modal-backdrop" onClick={close}><form className="quest-modal" onSubmit={(event) => void handleSubmit(event)} onClick={(event) => event.stopPropagation()}><div className="modal-top"><div><span className="eyebrow">YOUR STUDY MATERIAL</span><h2>Add a quiz question</h2></div><button type="button" onClick={close} className="icon-button" aria-label="Close"><X/></button></div><label>Subject<select value={subject} onChange={(event) => setSubject(event.target.value)}>{subjects.map((item) => <option key={item.id}>{item.name}</option>)}{!subjects.length && <option>General</option>}</select></label><label>Question<input autoFocus maxLength={500} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Write a question from your study material"/></label><label>Answer choices</label><div className="quiz-create-choices">{choices.map((choice, index) => <div key={index}><input maxLength={160} value={choice} onChange={(event) => setChoices((items) => items.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} placeholder={`Choice ${String.fromCharCode(65 + index)}`}/><label><input type="radio" name="correct-choice" checked={answerIndex === index} onChange={() => setAnswerIndex(index)}/> Correct</label></div>)}</div>{error && <div className="auth-error">{error}</div>}<button className="primary-button modal-submit" disabled={saving} type="submit"><Check size={16}/>{saving ? 'Saving…' : 'Save question'}</button></form></div>
}

const achievementList = [
  { id: 'first_quest', emoji: '⚡', name: 'Quick starter', description: 'Complete your first quest', color: 'gold' },
  { id: 'streak_7', emoji: '🔥', name: 'On fire', description: 'Keep a 7-day study streak', color: 'pink' },
  { id: 'quests_5', emoji: '📚', name: 'Bookworm', description: 'Complete 5 quests', color: 'blue' },
  { id: 'focus_5', emoji: '🎯', name: 'Focused mind', description: 'Complete 5 focus sessions', color: 'purple' },
  { id: 'quests_10', emoji: '🏅', name: 'Quest champion', description: 'Complete 10 quests', color: 'gold' },
  { id: 'quiz_master', emoji: '🧠', name: 'Quiz master', description: 'Answer a quiz question correctly', color: 'blue' },
  { id: 'streak_3', emoji: '🌟', name: 'Getting warmer', description: 'Keep a 3-day study streak', color: 'pink' },
  { id: 'level_10', emoji: '👑', name: 'Legendary scholar', description: 'Reach level 10', color: 'purple' },
]
function Achievements({ data }: { data: UserData }) {
  const unlocked = data.achievementIds.length
  return <div className="content"><Heading eyebrow="MILESTONES & MEMORIES" title={<>Your <span className="gradient-text">achievements</span></>} subtitle="Achievements unlock from your actual quest, quiz, and focus activity."/><div className="achievement-overview"><div className="trophy-large">🏆</div><div><span>ACHIEVEMENTS UNLOCKED</span><b>{String(unlocked).padStart(2, '0')} <small>/ {achievementList.length}</small></b><p>Keep showing up. The next one is closer than you think.</p></div><div className="achievement-progress"><span>COMPLETION</span><b>{Math.round(unlocked / achievementList.length * 100)}%</b><div className="progress"><i style={{ width: `${unlocked / achievementList.length * 100}%` }}/></div></div></div><div className="achievement-grid">{achievementList.map((item) => { const isUnlocked = data.achievementIds.includes(item.id); return <div className={`panel achievement-card ${isUnlocked ? '' : 'locked'}`} key={item.id}><AchievementIcon emoji={item.emoji} color={item.color}/><div className="achievement-copy"><h3>{item.name}</h3><p>{item.description}</p>{isUnlocked ? <span className="unlocked">UNLOCKED</span> : <div className="unlock-progress"><span>Not unlocked yet</span><div className="progress"><i style={{ width: '0%' }}/></div></div>}</div>{!isUnlocked && <Shield className="lock" size={17}/>}</div> })}</div></div>
}
function AchievementIcon({ emoji, color }: { emoji: string; color: string }) { return <div className={`achievement-icon ${color}`}>{emoji}</div> }

function Shop({ data, buy, equip }: { data: UserData; buy: (emoji: string, price: number) => void; equip: (emoji: string) => void }) {
  return <div className="content"><Heading eyebrow="MAKE IT YOURS" title={<>Avatar <span className="gradient-text">atelier</span></>} subtitle="Unlock items with quest coins, then equip them here."/><div className="shop-banner"><div className="shop-avatar">{data.equipped}</div><div><span>YOUR CURRENT LOOK</span><h2>Looking legendary.</h2><p>Your inventory and coins are saved to your account.</p></div><div className="shop-wallet"><Coins size={19}/><b>{data.coins}</b><span>AVAILABLE COINS</span></div></div><div className="shop-heading"><div><h3>Cosmetics</h3><p>Items are loaded from the database catalog</p></div><span><Coins size={15}/> Prices are checked in the database</span></div>{data.avatarCatalog.length ? <div className="shop-grid">{data.avatarCatalog.map((item) => { const owned = data.inventory.includes(item.itemId); const equipped = data.equipped === item.itemId; return <div className="panel shop-item" key={item.itemId}><div className="item-art">{item.itemId}</div><h3>{item.name}</h3><p>Cosmetic · Avatar accessory</p><div className="item-buy"><span><Coins size={15}/>{item.price}</span><button disabled={!owned && data.coins < item.price || equipped} className={owned ? 'owned-button' : 'buy-button'} onClick={() => owned ? equip(item.itemId) : buy(item.itemId, item.price)}>{equipped ? 'Equipped' : owned ? 'Equip' : 'Unlock'}</button></div></div> })}</div> : <Empty text="There are no cosmetic items in the database catalog."/>}</div>
}

function Profile({ data, session, configured, notify, saveName, startFocus: startFocusAction, finishFocus, cancelFocus, signOut, onRefresh }: { data: UserData; session: boolean; configured: boolean; notify: (message: string) => void; saveName: (name: string) => Promise<void>; startFocus: (minutes: number) => Promise<{ id: string; started_at: string; duration_minutes: number } | null>; finishFocus: (id: string | null, minutes: number) => Promise<void>; cancelFocus: (id: string | null) => Promise<void>; signOut: () => Promise<void>; onRefresh: () => void }) {
  const [tab, setTab] = useState('Profile')
  const [displayName, setDisplayName] = useState(data.name)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [searchParams] = useSearchParams()
  useEffect(() => setDisplayName(data.name), [data.name])
  const authenticate = async (register: boolean) => {
    if (!supabase) { setAuthError('Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to queststudy/.env.local first.'); return }
    if (!email.trim() || password.length < 6) { setAuthError('Enter a valid email and a password with at least 6 characters.'); return }
    setAuthError('')
    const result = register ? await supabase.auth.signUp({ email: email.trim(), password, options: { data: { username: displayName.trim() || 'Scholar' } } }) : await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (result.error) setAuthError(result.error.message)
    else if (register && !result.data.session) setAuthError('Check your email to confirm your account, then log in here.')
    else { notify(register ? 'Account created and connected.' : 'Welcome back. Loading your saved progress…'); onRefresh() }
  }
  return <div className="content"><Heading eyebrow="YOUR PERSONAL SPACE" title={<>Player <span className="gradient-text">profile</span></>} subtitle="Your journey, your stats, your next chapter."/><div className="profile-layout"><div className="profile-main"><section className="panel profile-hero"><div className="profile-cover"><div className="cover-stars">✦　　✧　　 ✦</div></div><div className="profile-details"><div className="profile-avatar">{data.equipped}</div><div className="player-identity"><h2>{data.name}</h2><span>Level {Math.floor(data.xp / 500) + 1} Scholar <i>·</i> QuestStudy player</span></div><button className="outline-button" onClick={() => setTab('Settings')}><Settings size={15}/> Edit profile</button></div><div className="profile-tabs">{['Profile','Statistics','Settings'].map((item) => <button onClick={() => setTab(item)} className={tab === item ? 'selected-tab' : ''} key={item}>{item}</button>)}</div>
    {tab === 'Settings' ? <div className="settings-panel"><label>Display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={32}/></label><button className="primary-button save-profile" onClick={() => void saveName(displayName)}>Save profile</button>{session ? <div className="account-state"><CheckCircle2 size={16}/> Supabase account connected. Your progress syncs automatically.</div> : <><div className="settings-divider">{configured ? 'Connect your Supabase account' : 'Supabase is not configured yet'}</div><label>Email<input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" type="email" autoComplete="email"/></label><label>Password<input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 6 characters" type="password" autoComplete="current-password"/></label>{authError && <div className="auth-error">{authError}</div>}<div className="auth-buttons"><button className="primary-button" onClick={() => void authenticate(false)}>Log in</button><button className="outline-button" onClick={() => void authenticate(true)}>Create account</button></div></>}{session && <button className="outline-button" onClick={() => void signOut()}><LogOut size={14}/> Sign out</button>}</div>
      : tab === 'Statistics' ? <div className="profile-stats"><div><span>QUESTS COMPLETED</span><b>{data.completedTotal}</b></div><div><span>QUIZ ATTEMPTS</span><b>{data.quizCount}</b></div><div><span>FOCUS SESSIONS</span><b>{data.sessions}</b></div><div><span>FOCUS TIME</span><b>{data.focusMinutes} min</b></div></div>
      : <div className="profile-stats"><div><span>QUESTS COMPLETED</span><b>{data.completedTotal}</b></div><div><span>QUIZ BEST</span><b>{data.quizBest}%</b></div><div><span>FOCUS SESSIONS</span><b>{data.sessions}</b></div><div><span>ACHIEVEMENTS</span><b>{data.achievementIds.length} / {achievementList.length}</b></div></div>}</section>
      <FocusTimer key={searchParams.get('focus') ?? 'manual'} autoStart={searchParams.get('focus') === '1'} notify={notify} startFocus={startFocusAction} finishFocus={finishFocus} cancelFocus={cancelFocus}/></div>
    <aside className="profile-aside"><div className="panel level-card"><div className="level-card-top"><div className="level-emblem">{Math.floor(data.xp / 500) + 1}</div><div><span>YOUR RANK</span><b>Scholar</b><small>Level {Math.floor(data.xp / 500) + 1}</small></div></div><div className="progress"><i style={{ width: `${data.xp % 500 / 5}%` }}/></div><div className="level-xp"><span>{data.xp % 500} / 500 XP</span><span>{500 - data.xp % 500} to go</span></div><div className="aside-divider"/><div className="profile-badges">{data.achievementIds.slice(0, 3).map((id) => <span key={id}>{achievementList.find((item) => item.id === id)?.emoji ?? '✦'}</span>)}{data.achievementIds.length < 4 && <span>＋</span>}</div><p>{data.achievementIds.length} achievements unlocked</p></div><div className="panel streak-card"><div><Flame size={20}/><span>YOUR STREAK</span></div><b>{data.streak} <small>days</small></b><p>Complete a quest or focus session to keep it going.</p><div className="streak-days">{['M','T','W','T','F','S','S'].map((day, index) => <span key={`${day}-${index}`}>{day}<b>·</b></span>)}</div></div></aside></div></div>
}

function FocusTimer({ autoStart, notify, startFocus: startFocusAction, finishFocus, cancelFocus }: { autoStart: boolean; notify: (message: string) => void; startFocus: (minutes: number) => Promise<{ id: string; started_at: string; duration_minutes: number } | null>; finishFocus: (id: string | null, minutes: number) => Promise<void>; cancelFocus: (id: string | null) => Promise<void> }) {
  const [mode, setMode] = useState<'focus' | 'short' | 'long'>('focus')
  const [remaining, setRemaining] = useState(25 * 60)
  const [running, setRunning] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const duration = mode === 'focus' ? 25 : mode === 'short' ? 5 : 15
  const begin = async () => {
    if (running) { setRunning(false); return }
    if (mode === 'focus' && !sessionId) {
      setStarting(true)
      try {
        const focus = await startFocusAction(duration)
        if (focus) {
          setSessionId(focus.id)
          const elapsed = Math.floor((Date.now() - new Date(focus.started_at).getTime()) / 1000)
          setRemaining(Math.max(1, focus.duration_minutes * 60 - elapsed))
        }
      } catch (error) { notify(error instanceof Error ? error.message : 'Could not start a focus session.'); setStarting(false); return }
      setStarting(false)
    }
    setRunning(true)
  }
  useEffect(() => { if (autoStart && !running && !starting) void begin() }, [autoStart])
  useEffect(() => { if (!running || remaining <= 0) return; const timer = window.setTimeout(() => setRemaining((value) => Math.max(0, value - 1)), 1000); return () => window.clearTimeout(timer) }, [running, remaining])
  useEffect(() => {
    if (!running || remaining !== 0) return
    setRunning(false)
    if (mode === 'focus') { void finishFocus(sessionId, duration); setSessionId(null) }
    else notify('Break complete. Ready to focus again?')
    setRemaining(duration * 60)
  }, [remaining, running])
  const reset = async () => { setRunning(false); await cancelFocus(sessionId); setSessionId(null); setRemaining(duration * 60) }
  const changeMode = async (next: 'focus' | 'short' | 'long') => { await cancelFocus(sessionId); setSessionId(null); setRunning(false); setMode(next); setRemaining((next === 'focus' ? 25 : next === 'short' ? 5 : 15) * 60) }
  return <div className="panel timer-panel"><div className="timer-title"><div className="focus-icon"><Timer/></div><div><h3>Focus timer</h3><p>Complete a full 25-minute session to earn XP</p></div><span className="tiny-label">POMODORO</span></div><div className="timer-controls"><div className="timer-clock">{String(Math.floor(remaining / 60)).padStart(2, '0')}<small>:{String(remaining % 60).padStart(2, '0')}</small></div><div><button className="primary-button" disabled={starting} onClick={() => void begin()}>{starting ? 'Starting…' : running ? 'Pause Ⅱ' : 'Start ▶'}</button><button className="reset-button" onClick={() => void reset()}>Reset</button></div></div><div className="timer-modes"><button className={mode === 'focus' ? 'active-mode' : ''} onClick={() => void changeMode('focus')}>Focus · 25 min</button><button className={mode === 'short' ? 'active-mode' : ''} onClick={() => void changeMode('short')}>Short break · 5 min</button><button className={mode === 'long' ? 'active-mode' : ''} onClick={() => void changeMode('long')}>Long break · 15 min</button></div></div>
}

function QuestModal({ initial, subjects, close, save }: { initial: Quest | null; subjects: UserData['subjects']; close: () => void; save: (input: Omit<Quest, 'id' | 'done'>) => void }) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [subject, setSubject] = useState(initial?.subject ?? subjects[0]?.name ?? 'General')
  const [difficulty, setDifficulty] = useState<Difficulty>(initial?.difficulty ?? 'Medium')
  const [due, setDue] = useState(initial?.due ?? 'Today')
  const [error, setError] = useState('')
  const submit = (event: React.FormEvent) => { event.preventDefault(); if (!title.trim()) { setError('Give your quest a title first.'); return } save({ title: title.trim(), subject, difficulty, due }) }
  return <div className="modal-backdrop" onClick={close}><form className="quest-modal" onSubmit={submit} onClick={(event) => event.stopPropagation()}><div className="modal-top"><div><span className="eyebrow">{initial ? 'UPDATE ADVENTURE' : 'NEW ADVENTURE'}</span><h2>{initial ? 'Edit quest' : 'Create a quest'}</h2></div><button type="button" onClick={close} className="icon-button" aria-label="Close"><X/></button></div><label>Quest title<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Enter a task" maxLength={160}/></label><div className="form-row"><label>Subject<select value={subject} onChange={(event) => setSubject(event.target.value)}>{subjects.map((item) => <option key={item.id}>{item.name}</option>)}{!subjects.length && <option>General</option>}</select></label><label>Deadline<select value={due} onChange={(event) => setDue(event.target.value)}><option>Today</option><option>Tomorrow</option><option>Next week</option><option>{new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(Date.now() + 3 * 86400000))}</option></select></label></div><label>Difficulty<div className="difficulty-options">{(['Easy','Medium','Hard'] as const).map((item) => <button type="button" key={item} className={difficulty === item ? 'difficulty-active' : ''} onClick={() => setDifficulty(item)}>{item}<small>+{item === 'Easy' ? 25 : item === 'Medium' ? 50 : 100} XP</small></button>)}</div></label>{error && <div className="auth-error">{error}</div>}<button className="primary-button modal-submit" type="submit"><Check size={16}/>{initial ? 'Save changes' : 'Add quest'}</button></form></div>
}

export default App
