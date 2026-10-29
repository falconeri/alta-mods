import type { Crew, Role, Task } from '../types'

// Everything here is plain logic with no engine in it, so the tests can reach it.

type Hand = Exclude<Role, 'captain'>

// The first keyword in a description decides (it is usually the main verb); on a
// tie the order of this list does.
const WORDS: Array<[Hand, RegExp]> = [
  ['lookout', /\b(?:test|verif|qa\b|debug|bug|valid|review|audit|check|lint|inspect)/],
  ['painter', /\b(?:design|draw|art\b|graphic|image|icon|logo|visual|ui\b|ux\b|style|css|illustrat|anim|mockup|color)/],
  ['navigator', /\b(?:research|explor|search|investigat|find|docs?\b|analy[sz]|read|plan|coordinat|architect|survey|map|locate|trace|compare|summari[sz])/],
  ['shipwright', /\b(?:build|implement|code|fix|refactor|feature|api\b|endpoint|component|page|script|develop|creat|writ|construct|migrat|add|wire|set ?up|port)/],
]

function earliest(text: string): Hand | undefined {
  let best: Hand | undefined
  let at = Infinity
  for (const [role, re] of WORDS) {
    const i = text.search(re)
    if (i >= 0 && i < at) {
      at = i
      best = role
    }
  }
  return best
}

/** An agent type names its job by its last word (`code-reviewer`, `drydock-tester`), so that is read first. */
function byType(type: string): Hand | undefined {
  const words = type.toLowerCase().split(/[^a-z]+/).filter(Boolean)
  for (let i = words.length - 1; i >= 0; i--) {
    const role = earliest(words[i]!)
    if (role) return role
  }
  return undefined
}

/**
 * The role a subagent signs on as: the earliest keyword in its description, then
 * its agent type, else a deckhand. Claude itself is the captain and never comes
 * out of here.
 */
export function roleOf(type: string, description: string): Hand {
  return earliest(description.toLowerCase()) ?? byType(type) ?? 'deckhand'
}

/** The role of what one of Claude's own tools does, for the symbol on the band. */
export function toolRole(tool: string, input: any): Hand {
  switch (tool) {
    case 'Read':
    case 'Grep':
    case 'Glob':
    case 'WebSearch':
    case 'WebFetch':
      return 'navigator'
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      return /\.(css|scss|sass|less|svg|png|jpe?g|gif|webp|ico)$/i.test(String(input?.file_path ?? input?.notebook_path ?? ''))
        ? 'painter'
        : 'shipwright'
    case 'Bash':
    case 'PowerShell':
      return roleOf('', `${input?.description ?? ''} ${input?.command ?? ''}`)
    default:
      return 'deckhand'
  }
}

const NAMES = ['Pip', 'Moss', 'Biscuit', 'Nori', 'Tansy', 'Juno', 'Wick', 'Marlo', 'Fig', 'Otto', 'Ziggy', 'Penny', 'Cobb', 'Dot', 'Rue', 'Kip']

/** A crew member's name: from its id, so the same agent is always the same character, skipping names in use. */
export function pickName(id: string, taken: ReadonlySet<string>): string {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  for (let i = 0; i < NAMES.length; i++) {
    const name = NAMES[(h + i) % NAMES.length]!
    if (!taken.has(name)) return name
  }
  return `${NAMES[h % NAMES.length]!} ${taken.size + 1}`
}

export function shortModel(model: string): string {
  const m = model.replace(/^claude-/, '').replace(/\[.*\]$/, '')
  const match = /^(opus|sonnet|haiku|fable)-(\d+)-(\d+)/i.exec(m)
  if (match) return `${match[1]![0]!.toUpperCase()}${match[1]!.slice(1)} ${match[2]}.${match[3]}`
  return m
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

export function fmtTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function ratioOf(list: readonly Task[]): number | null {
  if (list.length === 0) return null
  return list.filter(t => t.status === 'completed').length / list.length
}

/**
 * Progress when there is no task list: quick at first, slower with every step or
 * action, and never past 90% until the work really ends.
 */
export function estimate(work: number): number {
  return 0.9 * (1 - Math.exp(-work / 8))
}

export function crewRatio(a: Crew): number {
  if (a.status === 'done') return 1
  return ratioOf(a.tasks) ?? estimate(a.steps + a.tools)
}

/**
 * A bar that slides to its new value instead of jumping: each draw covers a share
 * of what is left, by the time passed (not by the number of draws). Going back, as
 * a new turn does, is at once.
 */
export function createGlide() {
  let shown = -1
  let shownAt = 0
  let settling = false
  return {
    step(target: number, t = Date.now()): number {
      if (shown < 0 || target < shown) shown = target
      else {
        const dt = Math.min(300, Math.max(0, t - shownAt))
        shown += (target - shown) * (1 - Math.exp(-dt / 450))
        if (target - shown < 0.005) shown = target
      }
      shownAt = t
      settling = shown !== target
      return shown
    },
    reset() {
      shown = -1
      settling = false
    },
    get settling() {
      return settling
    },
  }
}

const base = (path: unknown): string => String(path ?? '').split(/[\\/]/).pop() || 'a file'

/** A short phrase for what a tool call is doing. */
export function activityOf(tool: string, input: any): string {
  switch (tool) {
    case 'Read':
      return `Reading ${base(input?.file_path)}`
    case 'Edit':
    case 'MultiEdit':
      return `Editing ${base(input?.file_path)}`
    case 'Write':
      return `Writing ${base(input?.file_path)}`
    case 'Bash':
    case 'PowerShell':
      return String(input?.description || 'Running a command')
    case 'Grep':
    case 'Glob':
      return 'Searching the code'
    case 'Agent':
    case 'Task':
      return `Delegating: ${String(input?.description || 'a subagent')}`
    case 'WebSearch':
    case 'WebFetch':
      return 'Searching the web'
    case 'Skill':
      return `Using ${String(input?.skill || 'a skill')}`.trim()
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
      return 'Organizing tasks'
    case 'AskUserQuestion':
      return 'Waiting for your answer'
    default:
      return `Using ${tool.startsWith('mcp__') ? String(tool.split('__').pop()) : tool}`
  }
}

/** The task list after a TodoWrite, TaskCreate or TaskUpdate call; null when the call changes nothing. */
export function applyTaskTool(list: readonly Task[], tool: string, input: any, result: any): Task[] | null {
  if (tool === 'TodoWrite' && Array.isArray(input?.todos)) {
    return input.todos.map((t: any, i: number) => ({
      id: String(i),
      subject: String(t.content ?? ''),
      status: t.status,
      activeForm: t.activeForm,
    }))
  }
  if (tool === 'TaskCreate') {
    const id = result?.task?.id
    if (!id) return null
    return [...list, { id: String(id), subject: String(input?.subject ?? ''), status: 'pending', activeForm: input?.activeForm }]
  }
  if (tool === 'TaskUpdate' && input?.taskId) {
    const id = String(input.taskId)
    if (input.status === 'deleted') return list.filter(t => t.id !== id)
    return list.map(t =>
      t.id === id
        ? {
            ...t,
            status: input.status ?? t.status,
            subject: input.subject ?? t.subject,
            activeForm: input.activeForm ?? t.activeForm,
          }
        : t,
    )
  }
  return null
}
