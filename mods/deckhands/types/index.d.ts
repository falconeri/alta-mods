/** Who a crew member is. The captain is Claude itself while it delegates; never a subagent. */
export type Role = 'captain' | 'shipwright' | 'navigator' | 'painter' | 'lookout' | 'deckhand'

export type Status = 'pending' | 'in_progress' | 'completed'

export type Task = {
  id: string
  subject: string
  status: Status
  activeForm?: string
}

/** One subagent, drawn as a character. */
export type Crew = {
  id: string
  /** The character's name, picked when it signs on. */
  name: string
  description: string
  type: string
  role: Exclude<Role, 'captain'>
  model: string
  effort?: string
  status: 'running' | 'done' | 'failed'
  startedAt: number
  endedAt?: number
  /** Tokens the agent has sent and written (cache reads left out). */
  tokens: number
  steps: number
  tools: number
  /** What it is doing right now, from its last tool call. */
  phase?: string
  tasks: Task[]
}

/** What Claude itself is doing in the current turn. */
export type Main = {
  activity: string
  /** The kind of work its last tool did, for the symbol on the band. */
  role?: Exclude<Role, 'captain'>
  steps: number
  tools: number
  working: boolean
  done: boolean
}

/** Passing moods of the mascot (times in ms since the epoch). */
export type Fx = {
  /** Celebrate the end of a turn until then. */
  celebrateUntil: number
  /** Shake after a failed tool until then. */
  errorUntil: number
  /** A question or a permission request waits for the person. */
  asking: 'question' | 'permission' | null
}

declare module 'claude-code' {
  interface PluginState {
    'deckhands': {
      tasks: Task[]
      crew: Crew[]
      now: number
      frame: number
      showDone: boolean
      /** The band above the prompt shows (/deck-bar switches it; kept across sessions). */
      bandOn: boolean
      main: Main
      /** When the current batch of subagents began: those started since none was running. */
      batchStart: number
      fx: Fx
    }
  }
}
