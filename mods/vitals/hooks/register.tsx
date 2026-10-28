import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CacheFacts, ContextFacts, Look, Window } from '../types'
import { asked, bar, cacheView, dots, fmtAt, fmtSpan, nextCost, paceOf, tok, usd } from './figures'
import type { Pace } from './figures'

// A band above the prompt with two looks, switched by a button on its right:
//
//   slim    one row:  5H ●●●●●●●●·· 78% left · resets 3h 12m   7D ●●●●●···· 52% left · over pace   CTX 24%   CACHE warm 42m left
//   detail  a row each for the 5-hour window, the 7-day window, the context and
//           the prompt cache, with used and left, the reset clock time, a pace
//           check (usage against the share of the window's time gone, and when
//           it would run out if the burn holds) and what the next message costs.
//
// Drawn as text in the person's theme keys (success, warning, error, suggestion,
// dim), so it reads on light and dark themes, in the terminal and in the desktop
// app. Zero token cost: it reads the engine's own figures and draws.

const DEFAULT_CACHE_MINUTES = 60
const DEFAULT_LOW_AT = 15
const CELLS = 10
const TIGHT_CELLS = 6
const DETAIL_CELLS = 24
/** At or above this many columns the slim look fits on one row. */
const WIDE_AT = 100
/** Under this each slim usage window gets its own row, and detail drops its extras. */
const TIGHT_AT = 56
/** How often the band redraws, so countdowns and the warm-to-cold flip stay current. */
const TICK_MS = 30_000
const CTX_WARN = 70
const CTX_HOT = 90

const windows = atom({ plugin: 'vitals', key: 'windows' } as const, [] as Window[])
const cache = atom({ plugin: 'vitals', key: 'cache' } as const, null as CacheFacts | null)
const context = atom({ plugin: 'vitals', key: 'context' } as const, null as ContextFacts | null)
const look = atom({ plugin: 'vitals', key: 'look' } as const, null as Look | null)

const NAMES: Record<string, string> = { five_hour: '5H', seven_day: '7D', spend_limit: 'SPEND' }
const ORDER: Record<string, number> = { five_hour: 0, seven_day: 1 }

const clean = (list: readonly Window[]): Window[] =>
  list
    .map(w => ({ kind: w.kind, percentUsed: w.percentUsed, resetsAt: w.resetsAt }))
    .sort((a, b) => (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9))

const pull = async ($: EngineInterface): Promise<void> => {
  const u = await $.session.usage()
  await update($, windows, () => clean(u.rateLimits))
  if (u.context.tokens && u.context.tokens > 0) {
    await update($, context, () => ({ tokens: u.context.tokens as number, window: u.context.window }))
  }
}

/** Colour for a window by what is left: plain until it runs short. */
const toneOf = (left: number, lowAt: number): 'error' | 'warning' | undefined =>
  left < lowAt ? 'error' : left < 40 ? 'warning' : undefined

const paceWords = (pace: Pace | null, long: boolean): { text: string; color?: 'error' | 'warning' | 'success' } | null => {
  if (!pace) return null
  if (pace.state === 'out') return { text: long ? `at this rate it runs out in ${fmtSpan(pace.ms)}` : `out in ${fmtSpan(pace.ms)}`, color: 'error' }
  if (pace.state === 'over') return { text: long ? 'using it faster than the clock' : 'over pace', color: 'warning' }
  if (pace.state === 'under') return { text: long ? 'using it slower than the clock' : 'under pace', color: 'success' }
  return { text: long ? 'on pace' : 'on pace' }
}

export const register: Register = (on, options) => {
  const ttlMin = asked(options.cacheMinutes, DEFAULT_CACHE_MINUTES) || DEFAULT_CACHE_MINUTES
  const ttlMs = ttlMin * 60_000
  const price = asked(options.inputPrice, 0)
  const lowAt = asked(options.lowAt, DEFAULT_LOW_AT)
  const startLook: Look = options.startIn === 'detail' ? 'detail' : 'slim'

  on('session.start', async ($, e, next) => {
    await pull($)
    $.clock.every(TICK_MS, () => $.ui.invalidate('ui.render'))
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      await update($, windows, () => clean(e.rateLimits))
    }
    if (e.changed.includes('context') && e.context.tokens && e.context.tokens > 0) {
      const tokens = e.context.tokens
      await update($, context, () => ({ tokens, window: e.context.window }))
    }
    return next(e)
  })

  // A cleared or compacted chat starts over; a resumed one knows how long it was away.
  on('classic.SessionStart', async ($, e, next) => {
    const r = await next(e)
    if (e.source === 'clear' || e.source === 'compact') {
      await update($, cache, () => null)
      await update($, context, () => null)
    } else if ((e.source === 'resume' || e.source === 'fork') && typeof e.seconds_since_last_response === 'number') {
      const now = await $.clock.now()
      await update($, cache, () => ({ lastAt: now - (e.seconds_since_last_response as number) * 1000 }))
      if (typeof e.context_tokens === 'number' && e.context_tokens > 0) {
        const tokens = e.context_tokens
        const window = (await $.session.usage()).context.window
        await update($, context, () => ({ tokens, window }))
      }
    }
    return r
  }).catch(($, e, next) => next(e)) // a band that fails to seed never holds up the session

  // Each main-thread request reads or writes the cache, so its start resets the clock.
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) {
      const now = await $.clock.now()
      await update($, cache, () => ({ lastAt: now }))
    }
    yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) return r
    const now = await $.clock.now()
    const c = await read($, cache)
    // turn.step stamps the exact request time; when no step of this turn did, the turn's end is the floor.
    if (!c || now - c.lastAt > e.durationMs) await update($, cache, () => ({ lastAt: now }))
    await pull($)
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, windows)
    const ctx = await read($, context)
    const now = await $.clock.now()
    const view = cacheView((await read($, cache))?.lastAt, now, ttlMs)
    if (list.length === 0 && !view && !ctx) return next(e)

    const columns = e.props.bodyColumns ?? e.viewport?.columns ?? 100
    const isTight = columns < TIGHT_AT
    const current: Look = (await read($, look)) ?? startLook
    const isDetail = current === 'detail'
    const toggle = () => update($, look, () => (isDetail ? 'slim' : 'detail'))
    const button = (
      <Box key="look" flexShrink={0}>
        <Button key="look-toggle" label={isDetail ? 'Slim' : 'Details'} hotkey="d" onPress={toggle} />
      </Box>
    )
    const grow = <Box key="grow" flexGrow={1} />

    const share = ctx && ctx.window > 0 ? Math.min(100, Math.round((ctx.tokens / ctx.window) * 100)) : null
    const ctxTone = share === null ? undefined : share >= CTX_HOT ? 'error' : share >= CTX_WARN ? 'warning' : undefined
    const cold = view?.mode === 'cold'
    const cacheTone = cold ? 'suggestion' : 'success'
    const cost = view && ctx ? nextCost(view.mode, ctx.tokens, price, ttlMin) : null

    // ---------- detail: a row each ----------
    if (isDetail) {
      const cells = isTight ? TIGHT_CELLS : DETAIL_CELLS
      const tag = (s: string) => <Text dimColor bold>{s.padEnd(6)}</Text>
      const rows = list.map(w => {
        const left = Math.max(0, Math.round((100 - w.percentUsed) * 10) / 10)
        const tone = toneOf(left, lowAt)
        const d = dots(left, cells)
        const reset = w.resetsAt ? Date.parse(w.resetsAt) : NaN
        const pace = paceWords(paceOf(w.kind, w.percentUsed, w.resetsAt, now), !isTight)
        return (
          <Box key={w.kind} flexDirection="row">
            {tag(NAMES[w.kind] ?? w.kind.toUpperCase())}
            <Text color={tone}>{d.on}</Text>
            <Text dimColor>{d.off}</Text>
            <Text color={tone} bold> {left}% left</Text>
            <Text dimColor> ({w.percentUsed}% used)</Text>
            {left < lowAt ? <Text color="error" bold> LOW</Text> : null}
            {Number.isNaN(reset) ? null : (
              <Text dimColor>
                {reset <= now ? ' · resetting' : ` · resets in ${fmtSpan(reset - now)}${isTight ? '' : ` (${fmtAt(reset, now)})`}`}
              </Text>
            )}
            {pace ? <Text color={pace.color} dimColor={!pace.color}> · {pace.text}</Text> : null}
          </Box>
        )
      })

      const ctxRow =
        share === null || !ctx ? null : (
          <Box key="ctx" flexDirection="row">
            {tag('CTX')}
            <Text color={ctxTone}>{dots(share, cells).on}</Text>
            <Text dimColor>{dots(share, cells).off}</Text>
            <Text color={ctxTone} bold> {share}% full</Text>
            <Text dimColor> · {tok(ctx.tokens)} of {tok(ctx.window)} tokens</Text>
          </Box>
        )

      let cacheRows = null
      if (view) {
        const b = bar(view.leftMs / ttlMs, cells)
        cacheRows = (
          <Box key="cache" flexDirection="column">
            <Box flexDirection="row">
              {tag('CACHE')}
              <Text color={cacheTone}>{b.on}</Text>
              <Text dimColor>{b.off}</Text>
              <Text color={cacheTone} bold>{cold ? ' cold' : ' warm'}</Text>
              <Text color={cacheTone}>{cold ? ` · idle ${fmtSpan(view.idleMs)}` : ` · ${fmtSpan(view.leftMs)} left of ${ttlMin}m`}</Text>
            </Box>
            {ctx ? (
              <Box flexDirection="row">
                {tag('')}
                <Text dimColor>
                  {cold ? `next message re-sends ${tok(ctx.tokens)} tokens` : `next message reads ${tok(ctx.tokens)} tokens from cache`}
                </Text>
                {cost !== null ? <Text dimColor> · ~<Text bold>{usd(cost)}</Text></Text> : null}
                {!cold && price > 0 && !isTight ? (
                  <Text dimColor> · ~{usd(nextCost('cold', ctx.tokens, price, ttlMin) ?? 0)} if it goes cold</Text>
                ) : null}
              </Box>
            ) : null}
          </Box>
        )
      }

      return (
        <Box flexDirection="column" paddingX={1}>
          <Box flexDirection="row">
            <Text bold>VITALS</Text>
            <Text dimColor>  details</Text>
            {grow}
            {button}
          </Box>
          {rows}
          {ctxRow}
          {cacheRows}
        </Box>
      )
    }

    // ---------- slim: one row where it fits ----------
    const cells = isTight ? TIGHT_CELLS : CELLS
    const usage = list.map(w => {
      const left = Math.max(0, Math.round((100 - w.percentUsed) * 10) / 10)
      const tone = toneOf(left, lowAt)
      const d = dots(left, cells)
      const reset = w.resetsAt ? Date.parse(w.resetsAt) - now : NaN
      const pace = paceWords(paceOf(w.kind, w.percentUsed, w.resetsAt, now), false)
      // On pace is the unremarkable case: the slim look says nothing.
      const note = pace && pace.text !== 'on pace' ? pace : null
      return (
        <Box key={w.kind} flexDirection="row" flexShrink={0} marginRight={3}>
          <Text dimColor bold>{NAMES[w.kind] ?? w.kind.toUpperCase()} </Text>
          <Text color={tone}>{d.on}</Text>
          <Text dimColor>{d.off}</Text>
          <Text color={tone} bold> {left}% left</Text>
          {left < lowAt ? <Text color="error" bold> LOW</Text> : null}
          {Number.isNaN(reset) ? null : <Text dimColor> · {reset <= 0 ? 'resetting' : fmtSpan(reset)}</Text>}
          {note ? <Text color={note.color}> · {note.text}</Text> : null}
        </Box>
      )
    })

    const fill =
      share === null || !ctx ? null : (
        <Box key="ctx" flexDirection="row" flexShrink={0} marginRight={3}>
          <Text dimColor bold>CTX </Text>
          <Text color={ctxTone} bold>{share}%</Text>
          <Text dimColor> · {tok(ctx.tokens)}</Text>
        </Box>
      )

    const cacheBlock = view ? (
      <Box key="cache" flexDirection="row" flexShrink={0} marginRight={2}>
        <Text dimColor bold>CACHE </Text>
        <Text color={cacheTone} bold>{cold ? 'cold' : 'warm'}</Text>
        <Text color={cacheTone}>{cold ? ` ${fmtSpan(view.idleMs)}` : ` ${fmtSpan(view.leftMs)} left`}</Text>
        {cost !== null ? <Text dimColor> · next ~<Text bold>{usd(cost)}</Text></Text> : null}
        {cost === null && cold && ctx ? <Text dimColor> · re-sends {tok(ctx.tokens)}</Text> : null}
      </Box>
    ) : null

    if (columns >= WIDE_AT) {
      return (
        <Box flexDirection="row" paddingX={1}>
          <Text bold>VITALS  </Text>
          {usage}
          {fill}
          {cacheBlock}
          {grow}
          {button}
        </Box>
      )
    }
    // Narrower: usage on top (one per row when tight), context, cache and the button beneath.
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box flexDirection={isTight ? 'column' : 'row'}>
          {isTight ? null : <Text bold>VITALS  </Text>}
          {usage}
        </Box>
        <Box flexDirection="row">
          {fill}
          {cacheBlock}
          {grow}
          {button}
        </Box>
      </Box>
    )
  })
}
