// The band's arithmetic. Pure: nothing here touches the engine.

export type Pace =
  | { state: 'out'; ms: number }
  | { state: 'over' | 'steady' | 'under' }

const HOUR = 3_600_000
const WINDOW_MS: Record<string, number> = { five_hour: 5 * HOUR, seven_day: 7 * 24 * HOUR }

/** A span the way the band writes it: 12m, 3h 5m, 2d 9h. */
export const fmtSpan = (ms: number): string => {
  if (ms < 60000) return '<1m'
  const mins = Math.round(ms / 60000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ${mins % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

/** Dot bar of `left` percent over `cells` cells. */
export const dots = (left: number, cells: number): { on: string; off: string } => {
  const n = Math.max(0, Math.min(cells, Math.round((left / 100) * cells)))
  return { on: '●'.repeat(n), off: '·'.repeat(cells - n) }
}

/**
 * Whether usage is running ahead of the clock. Compares the share of the window
 * used with the share of its time gone; if the burn so far would empty the
 * window before it resets, says when. Null when the window's length or reset
 * time is unknown, or too little of it has passed to project from.
 */
export const paceOf = (kind: string, percentUsed: number, resetsAt: string | undefined, now: number): Pace | null => {
  const length = WINDOW_MS[kind]
  if (!length || !resetsAt) return null
  const resetMs = Date.parse(resetsAt)
  if (Number.isNaN(resetMs)) return null
  const remaining = Math.min(length, Math.max(0, resetMs - now))
  const elapsed = length - remaining
  if (elapsed < length * 0.03) return null
  if (percentUsed > 0 && percentUsed < 100) {
    const toEmpty = ((100 - percentUsed) * elapsed) / percentUsed
    if (toEmpty < remaining) return { state: 'out', ms: toEmpty }
  } else if (percentUsed >= 100) {
    return { state: 'out', ms: 0 }
  }
  const delta = percentUsed - (elapsed / length) * 100
  return { state: delta > 10 ? 'over' : delta < -10 ? 'under' : 'steady' }
}

export const tok = (n: number): string => (n >= 1e6 ? `${Number((n / 1e6).toFixed(1))}M` : `${Math.round(n / 1000)}k`)
export const usd = (n: number): string => '$' + n.toFixed(2)

export type CacheView = { mode: 'warm' | 'cold'; idleMs: number; leftMs: number }

/** Null until a main-thread request has been seen. */
export const cacheView = (lastAt: number | undefined, now: number, ttlMs: number): CacheView | null => {
  if (!lastAt || lastAt <= 0) return null
  const idleMs = Math.max(0, now - lastAt)
  return { mode: idleMs >= ttlMs ? 'cold' : 'warm', idleMs, leftMs: Math.max(0, ttlMs - idleMs) }
}

/**
 * Estimated cost of the next message's context. A cold cache re-writes it (1.25x
 * input for the 5-minute cache, 2x for the 1-hour one); a warm one reads it (0.1x).
 * Null when no price was given.
 */
export const nextCost = (mode: 'warm' | 'cold', tokens: number, pricePerM: number, ttlMin: number): number | null => {
  if (!(pricePerM > 0) || tokens <= 0) return null
  const factor = mode === 'warm' ? 0.1 : ttlMin > 5 ? 2 : 1.25
  return (tokens / 1e6) * pricePerM * factor
}

/** A configured number, or the default when it is missing, not a number or negative. */
export const asked = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const two = (n: number): string => String(n).padStart(2, '0')

/** A moment in local time: 14:30 if it is today, Thu 14:30 otherwise. */
export const fmtAt = (at: number, now: number): string => {
  const d = new Date(at)
  const clock = `${two(d.getHours())}:${two(d.getMinutes())}`
  return d.toDateString() === new Date(now).toDateString() ? clock : `${DAYS[d.getDay()]} ${clock}`
}

/** A drain bar: `frac` (0 to 1) of `cells` filled. */
export const bar = (frac: number, cells: number): { on: string; off: string } => dots(frac * 100, cells)
