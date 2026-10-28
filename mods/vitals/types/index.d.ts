/** One usage window: which one, how much is used (0 to 100), when it resets. */
export type Window = { kind: string; percentUsed: number; resetsAt?: string }

/** When the main thread last sent a request, in clock milliseconds. */
export type CacheFacts = { lastAt: number }

/** The context the next request re-sends, and the model's window. */
export type ContextFacts = { tokens: number; window: number }

/** How the band is drawn: one row, or a row each. */
export type Look = 'slim' | 'detail'

declare module 'claude-code' {
  interface PluginState {
    'vitals': { windows: Window[]; cache: CacheFacts | null; context: ContextFacts | null; look: Look | null; branch: string | null }
  }
}
