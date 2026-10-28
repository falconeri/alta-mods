import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CacheFacts, ContextFacts, Look, Window } from '../types'
import { BG, EMPTY, HUE, MUTED, ORANGE, ROBO_SIZE, TEXT, WORD, YELLOW, bandPx, cardSvg, chipSvg, kindOf, roboSvg } from './cache-art'
import type { CacheView } from './cache-art'
import { asked, bar, branchOf, cacheView, coldMultiple, dots, fmtAt, fmtSpan, fmtTimes, paceOf, tok } from './figures'
import type { Pace } from './figures'

// A band above the prompt with two looks, switched by a button on the band:
//
//   slim    one row:  5H ●●●●●●●●·· 78% left · resets 3h 12m   7D ●●●●●···· 52% left · over pace   CTX 24%   CACHE warm 42m left
//   detail  a row each for the 5-hour window, the 7-day window, the context and
//           the prompt cache, with used and left, the reset clock time, a pace
//           check (usage against the share of the window's time gone, and when
//           it would run out if the burn holds) and what the next message uses.
//
// Two skins of the same band:
//   terminal   text in the person's theme keys (success, warning, error, dim), so it
//              reads on light and dark themes. The git branch stands where a title
//              would, because the terminal has no sidebar that shows it.
//   desktop    (and VS Code, mobile) a warm dark card with the ribbon-style art: Robo
//              bobbing when the cache is warm and frozen in ice when cold, a WARM or
//              COLD chip, and in the detail look the cache card. The app's own sidebar
//              already shows the branch, so there is none here.
//
// No prices: a cold cache is shown as tokens re-sent and a multiple of a warm read,
// which holds on a subscription as on the API. Zero token cost: it reads the
// engine's own figures and draws.

const DEFAULT_CACHE_MINUTES = 60
const DEFAULT_LOW_AT = 15
const CELLS = 10
const TIGHT_CELLS = 6
const DETAIL_CELLS = 24
/** Under this each slim usage window gets its own row, and detail drops its extras. */
const TIGHT_AT = 56
/** How often the band redraws, so countdowns, the warm-to-cold flip and the branch stay current. */
const TICK_MS = 30_000
const CTX_WARN = 70
const CTX_HOT = 90
const BRANCH_MAX = 28
/** What stands before the branch name, by the "branch icon" setting. */
const ICONS: Record<string, string> = { symbol: '⎇', 'nerd font': '', text: 'git:' }
/** Folders to climb looking for .git. */
const CLIMB = 12

const windows = atom({ plugin: 'vitals', key: 'windows' } as const, [] as Window[])
const cache = atom({ plugin: 'vitals', key: 'cache' } as const, null as CacheFacts | null)
const context = atom({ plugin: 'vitals', key: 'context' } as const, null as ContextFacts | null)
const look = atom({ plugin: 'vitals', key: 'look' } as const, null as Look | null)
const branch = atom({ plugin: 'vitals', key: 'branch' } as const, null as string | null)

const NAMES: Record<string, string> = { five_hour: '5H', seven_day: '7D', spend_limit: 'SPEND' }
const ORDER: Record<string, number> = { five_hour: 0, seven_day: 1 }

const clean = (list: readonly Window[]): Window[] =>
  list
    .map(w => ({ kind: w.kind, percentUsed: w.percentUsed, resetsAt: w.resetsAt }))
    .sort((a, b) => (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9))

const parentOf = (dir: string): string | null => {
  const i = Math.max(dir.lastIndexOf('/'), dir.lastIndexOf('\\'))
  return i > 0 ? dir.slice(0, i) : null
}

/** The branch of the repository the session runs in, or null outside one. Never throws. */
const findBranch = async ($: EngineInterface): Promise<string | null> => {
  try {
    let dir: string | null = await $.session.cwd()
    for (let i = 0; dir && i < CLIMB; i++) {
      try {
        return branchOf(await $.fs.read(`${dir}/.git/HEAD`))
      } catch {
        // A worktree or submodule keeps a file there that names the real git folder.
        try {
          const link = /^gitdir:\s*(.+)$/m.exec(await $.fs.read(`${dir}/.git`))
          if (link?.[1]) return branchOf(await $.fs.read(`${link[1].trim()}/HEAD`))
        } catch {
          // no .git here: look one folder up
        }
      }
      dir = parentOf(dir)
    }
  } catch {
    // the band shows no branch rather than failing
  }
  return null
}

const refreshBranch = async ($: EngineInterface): Promise<void> => {
  const found = await findBranch($)
  await update($, branch, () => found)
}

const pull = async ($: EngineInterface): Promise<void> => {
  const u = await $.session.usage()
  await update($, windows, () => clean(u.rateLimits))
  if (u.context.tokens && u.context.tokens > 0) {
    await update($, context, () => ({ tokens: u.context.tokens as number, window: u.context.window }))
  }
  await refreshBranch($)
}

/** How a note is coloured: not at all, or by how bad it is. */
type Tone = 'low' | 'mid' | 'ok'

const paceWords = (pace: Pace | null, long: boolean): { text: string; tone?: Tone } | null => {
  if (!pace) return null
  if (pace.state === 'out') return { text: long ? `at this rate it runs out in ${fmtSpan(pace.ms)}` : `out in ${fmtSpan(pace.ms)}`, tone: 'low' }
  if (pace.state === 'over') return { text: long ? 'using it faster than the clock' : 'over pace', tone: 'mid' }
  if (pace.state === 'under') return { text: long ? 'using it slower than the clock' : 'under pace', tone: 'ok' }
  return { text: 'on pace' }
}

export const register: Register = (on, options) => {
  const ttlMin = asked(options.cacheMinutes, DEFAULT_CACHE_MINUTES) || DEFAULT_CACHE_MINUTES
  const ttlMs = ttlMin * 60_000
  const lowAt = asked(options.lowAt, DEFAULT_LOW_AT)
  const startLook: Look = options.startIn === 'detail' ? 'detail' : 'slim'
  const icon = typeof options.branchIcon === 'string' ? (ICONS[options.branchIcon] ?? ICONS.symbol!) : ICONS.symbol!
  const times = fmtTimes(coldMultiple(ttlMin))

  on('session.start', async ($, e, next) => {
    await pull($)
    $.clock.every(TICK_MS, async () => {
      await refreshBranch($)
      $.ui.invalidate('ui.render')
    })
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

    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    // Svg draws on desktop, mobile and VS Code; the terminal gets the text skin.
    // Ask the surface, not the table: the terminal's table still lists Svg.
    const Svg = e.surface !== 'terminal' && 'Svg' in ui ? ui.Svg : null
    const art = Svg !== null

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

    // In the terminal the git branch stands first, because the terminal has no sidebar
    // that shows it. The desktop app does, so there it is hidden. There is no title.
    const name = e.surface === 'terminal' ? await read($, branch) : null
    const branchText = name ? (name.length > BRANCH_MAX ? name.slice(0, BRANCH_MAX - 1) + '…' : name) : null
    const labelWidth = branchText ? icon.length + 1 + branchText.length + 3 : 0
    // The icon says what the name is; a bare word would read as a title.
    // The icon says what the name is; a bare word would read as a title. With no branch
    // (the desktop, or outside a repository) nothing stands first: the band has no title.
    const branchNode = (key: string, gap: number) =>
      branchText ? (
        <Box key={key} flexDirection="row" flexShrink={0} marginRight={gap}>
          <Text color="claude" bold>{icon} </Text>
          <Text bold>{branchText}</Text>
        </Box>
      ) : null

    // ---------- skin ----------
    const dim = art ? { color: MUTED } : { dimColor: true }
    const faint = art ? { color: EMPTY } : { dimColor: true }
    const ink = art ? TEXT : undefined
    const hue = art
      ? { low: '#e5484d', mid: YELLOW, ok: '#7bc47f', warm: HUE.warm, cold: HUE.cold }
      : { low: 'error', mid: 'warning', ok: 'success', warm: 'success', cold: 'suggestion' }
    const frame = art ? { backgroundColor: BG } : {}
    const own = (kind: string) => (art ? (kind === 'seven_day' ? ORANGE : YELLOW) : undefined)
    const toneOf = (kind: string, left: number): string | undefined => (left < lowAt ? hue.low : left < 40 ? hue.mid : own(kind))

    const button = (
      <Box key="look" flexShrink={0}>
        <Button key="look-toggle" label={isDetail ? 'Slim' : 'Details'} hotkey="d" onPress={toggle} />
      </Box>
    )
    const grow = <Box key="grow" flexGrow={1} />

    const share = ctx && ctx.window > 0 ? Math.min(100, Math.round((ctx.tokens / ctx.window) * 100)) : null
    const ctxTone = share === null ? ink : share >= CTX_HOT ? hue.low : share >= CTX_WARN ? hue.mid : ink
    const cold = view?.mode === 'cold'
    const cacheTone = cold ? hue.cold : hue.warm

    // What the cache drawings read; they need the context size too.
    const cardView: CacheView | null =
      view && ctx
        ? {
            mode: view.mode,
            idle: fmtSpan(view.idleMs),
            idleMin: Math.floor(view.idleMs / 60000),
            tokens: ctx.tokens,
            window: ctx.window,
            ttlMin,
          }
        : null

    // Robo and the chip, the art skin's stand-in for the word CACHE and its state.
    const badge =
      Svg && view
        ? [
            <Svg key="robo" source={roboSvg(view.mode)} alt={cold ? 'Robo, frozen' : 'Robo, bobbing'} width={ROBO_SIZE} height={ROBO_SIZE} isInteractive />,
            <Text key="gap"> </Text>,
            (() => {
              const c = chipSvg(view.mode)
              return <Svg key="chip" source={c.source} alt={WORD[view.mode]} width={c.w} height={c.h} />
            })(),
          ]
        : null

    // ---------- detail: a row each ----------
    if (isDetail) {
      const cells = isTight ? TIGHT_CELLS : DETAIL_CELLS
      const tag = (s: string) => <Text {...dim} bold>{s.padEnd(6)}</Text>
      const rows = list.map(w => {
        const left = Math.max(0, Math.round((100 - w.percentUsed) * 10) / 10)
        const tone = toneOf(w.kind, left)
        const d = dots(left, cells)
        const reset = w.resetsAt ? Date.parse(w.resetsAt) : NaN
        const pace = paceWords(paceOf(w.kind, w.percentUsed, w.resetsAt, now), !isTight)
        return (
          <Box key={w.kind} flexDirection="row">
            {tag(NAMES[w.kind] ?? w.kind.toUpperCase())}
            <Text color={tone}>{d.on}</Text>
            <Text {...faint}>{d.off}</Text>
            <Text color={tone ?? ink} bold> {left}% left</Text>
            <Text {...dim}> ({w.percentUsed}% used)</Text>
            {left < lowAt ? <Text color={hue.low} bold> LOW</Text> : null}
            {Number.isNaN(reset) ? null : (
              <Text {...dim}>
                {reset <= now ? ' · resetting' : ` · resets in ${fmtSpan(reset - now)}${isTight ? '' : ` (${fmtAt(reset, now)})`}`}
              </Text>
            )}
            {pace ? <Text {...(pace.tone ? { color: hue[pace.tone] } : dim)}> · {pace.text}</Text> : null}
          </Box>
        )
      })

      // The card draws the context and the cache; the text rows do where there is no card.
      const useCard = Svg !== null && cardView !== null
      const ctxRow =
        useCard || share === null || !ctx ? null : (
          <Box key="ctx" flexDirection="row">
            {tag('CTX')}
            <Text color={ctxTone}>{dots(share, cells).on}</Text>
            <Text {...faint}>{dots(share, cells).off}</Text>
            <Text color={ctxTone} bold> {share}% full</Text>
            <Text {...dim}> · {tok(ctx.tokens)} of {tok(ctx.window)} tokens</Text>
          </Box>
        )

      let cacheRows = null
      if (view && !useCard) {
        const b = bar(view.leftMs / ttlMs, cells)
        cacheRows = (
          <Box key="cache" flexDirection="column">
            <Box flexDirection="row">
              {tag('CACHE')}
              <Text color={cacheTone}>{b.on}</Text>
              <Text {...faint}>{b.off}</Text>
              <Text color={cacheTone} bold>{cold ? ' cold' : ' warm'}</Text>
              <Text color={cacheTone}>{cold ? ` · idle ${fmtSpan(view.idleMs)}` : ` · ${fmtSpan(view.leftMs)} left of ${ttlMin}m`}</Text>
            </Box>
            {ctx ? (
              <Box flexDirection="row">
                {tag('')}
                <Text {...dim}>
                  {cold
                    ? `next message re-sends ${tok(ctx.tokens)} tokens, about ${times} a warm read`
                    : `next message reads ${tok(ctx.tokens)} tokens from cache; cold it would be about ${times}`}
                </Text>
              </Box>
            ) : null}
          </Box>
        )
      }

      let card = null
      if (Svg && cardView) {
        const c = cardSvg(cardView, kindOf(columns), bandPx(columns))
        card = (
          <Box key="card" flexDirection="row">
            <Svg source={c.source} alt={c.alt} width={c.w} height={c.h} isInteractive={kindOf(columns) !== 'tight'} />
          </Box>
        )
      }

      return (
        <Box flexDirection="column" {...frame}>
          <Box flexDirection="row" paddingX={1}>
            {branchNode('branch', 2)}
            <Text {...dim}>details</Text>
            {grow}
            {button}
          </Box>
          <Box flexDirection="column" paddingX={1}>
            {rows}
            {ctxRow}
            {cacheRows}
          </Box>
          {card}
        </Box>
      )
    }

    // ---------- slim: one row where it fits ----------
    const cells = isTight ? TIGHT_CELLS : CELLS
    // Terminal cells each segment takes, so the row is chosen by what it needs, not a guess.
    const widths: number[] = []
    const usage = list.map(w => {
      const left = Math.max(0, Math.round((100 - w.percentUsed) * 10) / 10)
      const tone = toneOf(w.kind, left)
      const d = dots(left, cells)
      const reset = w.resetsAt ? Date.parse(w.resetsAt) - now : NaN
      const pace = paceWords(paceOf(w.kind, w.percentUsed, w.resetsAt, now), false)
      // On pace is the unremarkable case: the slim look says nothing.
      const note = pace && pace.text !== 'on pace' ? pace : null
      widths.push(
        (NAMES[w.kind] ?? w.kind).length + 1 + cells + ` ${left}% left`.length + (left < lowAt ? 4 : 0) +
          (Number.isNaN(reset) ? 0 : 3 + (reset <= 0 ? 9 : fmtSpan(reset).length)) + (note ? 3 + note.text.length : 0) + 3,
      )
      return (
        <Box key={w.kind} flexDirection="row" flexShrink={0} marginRight={3}>
          <Text {...dim} bold>{NAMES[w.kind] ?? w.kind.toUpperCase()} </Text>
          <Text color={tone}>{d.on}</Text>
          <Text {...faint}>{d.off}</Text>
          <Text color={tone ?? ink} bold> {left}% left</Text>
          {left < lowAt ? <Text color={hue.low} bold> LOW</Text> : null}
          {Number.isNaN(reset) ? null : <Text {...dim}> · {reset <= 0 ? 'resetting' : fmtSpan(reset)}</Text>}
          {note ? <Text {...(note.tone ? { color: hue[note.tone] } : dim)}> · {note.text}</Text> : null}
        </Box>
      )
    })

    const fill =
      share === null || !ctx ? null : (
        <Box key="ctx" flexDirection="row" flexShrink={0} marginRight={3}>
          <Text {...dim} bold>CTX </Text>
          <Text color={ctxTone} bold>{share}%</Text>
          <Text {...dim}> · {tok(ctx.tokens)}</Text>
        </Box>
      )

    // Art skin: Robo and the chip; terminal skin: the word CACHE and the state. Both are about 10 cells wide.
    const resend = cold && ctx ? ` · re-sends ${tok(ctx.tokens)} (~${times})` : ''
    const cacheBlock = view ? (
      <Box key="cache" flexDirection="row" flexShrink={0} marginRight={2} alignItems="center">
        {badge ?? [
          <Text key="label" {...dim} bold>CACHE </Text>,
          <Text key="state" color={cacheTone} bold>{cold ? 'cold' : 'warm'}</Text>,
        ]}
        <Text color={cacheTone} bold={art}>{cold ? ` ${fmtSpan(view.idleMs)}` : ` ${fmtSpan(view.leftMs)} left`}</Text>
        {resend ? <Text {...dim}>{resend}</Text> : null}
      </Box>
    ) : null

    const usageWidth = widths.reduce((a, b) => a + b, 0)
    const fillWidth = share === null || !ctx ? 0 : 4 + `${share}%`.length + 3 + tok(ctx.tokens).length + 3
    const cacheWidth = !view ? 0 : 6 + 4 + (cold ? 1 + fmtSpan(view.idleMs).length : 6 + fmtSpan(view.leftMs).length) + resend.length + 2
    const buttonWidth = 10
    // paddingX takes 2; one cell spare keeps the last glyph off the edge.
    const fitsOneRow = labelWidth + usageWidth + fillWidth + cacheWidth + buttonWidth + 3 <= columns
    const label = branchNode('branch', 3)

    if (fitsOneRow) {
      return (
        <Box flexDirection="row" paddingX={1} alignItems="center" {...frame}>
          {label}
          {usage}
          {fill}
          {cacheBlock}
          {grow}
          {button}
        </Box>
      )
    }
    // Narrower: usage on top (one per row when they don't fit side by side), then the
    // button first, so it is never the thing pushed off the edge, with context and cache.
    const stackUsage = isTight || labelWidth + usageWidth + 3 > columns
    return (
      <Box flexDirection="column" paddingX={1} {...frame}>
        <Box flexDirection={stackUsage ? 'column' : 'row'}>
          {stackUsage ? branchNode('branch', 0) : label}
          {usage}
        </Box>
        <Box flexDirection="row" alignItems="center">
          <Box key="look" flexShrink={0} marginRight={2}>
            <Button key="look-toggle" label={isDetail ? 'Slim' : 'Details'} hotkey="d" onPress={toggle} />
          </Box>
          {fill}
          {cacheBlock}
        </Box>
      </Box>
    )
  })
}
