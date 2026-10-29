import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Crew, Fx, Main, Task } from '../types'
import { ALERT, CLAY, GOOD, MAX_RASTER_COLUMNS, ROLES, SEA, bandRaster, barRaster, barSvg, crewRaster, fade, spriteSvg } from './art'
import type { Pose, Who } from './art'
import {
  activityOf,
  applyTaskTool,
  createGlide,
  crewRatio,
  estimate,
  fmtTime,
  fmtTokens,
  pickName,
  ratioOf,
  roleOf,
  shortModel,
  toolRole,
} from './crew'

// Two things, drawn for the terminal and for the desktop app separately:
//
//   the band     above the prompt while Claude works: what it is doing, a pixel progress
//                bar with the Claude Code mascot walking along it, the percentage.
//                When Claude hands work to subagents it puts on a captain's coat and
//                the bar counts them. It celebrates, sleeps, waits for you and shakes.
//   the panel    beside the chat: every subagent signs on as a named character with a
//                role picked from its task, and its own bar.
//
// The terminal skin is a Raster (quadrant pixels, one line tall for the band); the
// desktop, VS Code and mobile skin is Svg. No money anywhere: on a Claude account
// there is no bill to show, so the panel counts tokens and time.
//
// Zero token cost: it listens to events that already happen and draws locally.

const PANE = 'deckhands-crew'
const TITLE = 'Deckhands'
/** The animation clock: ten frames a second, only while something moves. */
const TICK_MS = 100
const CELEBRATE_MS = 2500
const SHAKE_MS = 1200
// The fewest columns worth drawing the bar in, the title room the band keeps, the room
// the text beside a crew member needs.
const BAND_MIN = 12
const BAND_MAX = 48
const TITLE_MIN = 8
const TEXT_MIN = 14
const BAR_MIN = 4

const tasks = atom({ plugin: 'deckhands', key: 'tasks' } as const, [] as Task[])
const crew = atom({ plugin: 'deckhands', key: 'crew' } as const, [] as Crew[])
const now = atom({ plugin: 'deckhands', key: 'now' } as const, 0)
const frame = atom({ plugin: 'deckhands', key: 'frame' } as const, 0)
const showDone = atom({ plugin: 'deckhands', key: 'showDone' } as const, true)
const bandOn = atom({ plugin: 'deckhands', key: 'bandOn' } as const, true)
const IDLE: Main = { activity: '', steps: 0, tools: 0, working: false, done: false }
const main = atom({ plugin: 'deckhands', key: 'main' } as const, IDLE)
const batchStart = atom({ plugin: 'deckhands', key: 'batchStart' } as const, 0)
const CALM: Fx = { celebrateUntil: 0, errorUntil: 0, asking: null }
const fx = atom({ plugin: 'deckhands', key: 'fx' } as const, CALM)

const glide = createGlide()

type Usage = {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  model: string
}

// Whether another mod's tree came back from `next` (a Box with nothing in it is nothing drawn).
const hasDrawing = (tree: unknown) => {
  const t = tree as { type?: string; children?: unknown[] } | null | undefined
  return !!t && (t.type !== 'Box' || (t.children?.length ?? 0) > 0)
}

async function patch($: EngineInterface, id: string, fn: (a: Crew) => Crew) {
  await update($, crew, list => list.map(a => (a.id === id ? fn(a) : a)))
}

/** Signs a subagent on: gives it a name and a place in the crew, and opens the panel when a batch begins. */
async function enlist($: EngineInterface, id: string, description: string, type: string, model: string) {
  const before = await read($, crew)
  const wasIdle = !before.some(a => a.status === 'running')
  const taken = new Set(before.filter(a => a.status === 'running').map(a => a.name))
  const t = Date.now()
  const member: Crew = {
    id,
    name: pickName(id, taken),
    description: description || type,
    type,
    role: roleOf(type, description),
    model,
    status: 'running',
    startedAt: t,
    tokens: 0,
    steps: 0,
    tools: 0,
    tasks: [],
  }
  await update($, crew, list => [...list.filter(a => a.id !== id), member].slice(-40))
  await update($, now, () => t)
  if (wasIdle) {
    await update($, batchStart, () => t)
    $.ui.open({ id: PANE, title: TITLE }).catch(() => {})
  }
}

export const register: Register = (on, options) => {
  const bandWanted = options.band !== 'off'

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'deck', description: 'Open the crew panel' })
    await $.command.register({ name: 'deck-clear', description: 'Clear the task list and the crew' })
    await $.command.register({ name: 'deck-bar', description: 'Show or hide the progress band (on, off, or nothing to switch)' })
    // the band's setting, and what /deck-bar chose last time
    await update($, bandOn, () => bandWanted)
    const saved = await $.store.get('bandOn').catch(() => undefined)
    if (typeof saved === 'boolean') await update($, bandOn, () => saved)

    // The animation clock. Idle, it writes nothing; a sleeping mascot breathes slowly.
    let ticks = 0
    let idle = 0
    let ticking = false
    $.clock.every(TICK_MS, () => {
      if (ticking) return
      ticking = true
      void (async () => {
        const list = await read($, crew)
        const busy = list.some(a => a.status === 'running')
        const todo = await read($, tasks)
        const working = (await read($, main)).working || todo.some(t => t.status === 'in_progress')
        const effects = await read($, fx)
        const t0 = Date.now()
        // celebrating, shaking and the bar sliding animate too; one frame past the end so the band can go
        const lively = glide.settling || effects.asking !== null || t0 < effects.celebrateUntil + 400 || t0 < effects.errorUntil + 400
        if (!(await read($, bandOn)) && !busy) return
        if (!busy && !working && !lively) {
          if (todo.length && ++idle % 10 === 0) await update($, frame, n => (n + 1) % 100000)
          return
        }
        await update($, frame, n => (n + 1) % 100000)
        if (!busy) return
        ticks += 1
        if (ticks % 10 === 0) await update($, now, () => Date.now())
        // every ~5s check against the engine's list: an agent can be interrupted or killed
        if (ticks % 50 !== 0) return
        const live = await $.agent.list()
        const ended = new Map(
          live.filter(a => a.status === 'completed' || a.status === 'failed' || a.status === 'killed').map(a => [a.id, a.status]),
        )
        if (ended.size === 0) return
        const t = Date.now()
        await update($, crew, all =>
          all.map(a =>
            a.status === 'running' && ended.has(a.id)
              ? { ...a, status: ended.get(a.id) === 'completed' ? ('done' as const) : ('failed' as const), endedAt: t }
              : a,
          ),
        )
      })()
        .catch(() => {})
        .finally(() => {
          ticking = false
        })
    })

    return next(e)
  })

  on('command.run', { command: 'deck' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'The crew panel is open.' }
  })

  on('command.run', { command: 'deck-bar' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const want = /^(off|no|hide)/.test(arg) ? false : /^(on|yes|show)/.test(arg) ? true : !(await read($, bandOn))
    await update($, bandOn, () => want)
    await $.store.set('bandOn', want).catch(() => {})
    return { text: want ? 'The progress band is on.' : 'The progress band is off. The crew panel still works.' }
  })

  on('command.run', { command: 'deck-clear' }, async $ => {
    await update($, tasks, () => [])
    await update($, crew, () => [])
    return { text: 'The task list and the crew are cleared.' }
  })

  // ── Subagents sign on ─────────────────────────────────────────────────
  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    try {
      if (r.agentId) await enlist($, r.agentId, e.description, e.subagentType, r.model)
    } catch {}
    return r
  }).catch(($, e, next) => next(e)) // a crew that fails to sign on never holds up the session

  // ── Claude itself: a turn starts, takes steps, ends ───────────────────
  // Reset on submit: the app says "working" before turn.start, and without this the
  // band would flash the last turn's 100%.
  on('prompt.submit', async ($, e, next) => {
    await update($, main, () => ({ activity: 'Thinking', steps: 0, tools: 0, working: true, done: false })).catch(() => {})
    await update($, fx, () => CALM).catch(() => {})
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    await update($, main, () => ({ activity: 'Thinking', steps: 0, tools: 0, working: true, done: false })).catch(() => {})
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) await update($, main, m => ({ ...m, working: true, done: false })).catch(() => {})
    const r = yield* next(e)
    if (!e.agentId) await update($, main, m => ({ ...m, steps: m.steps + 1 })).catch(() => {})
    if (e.agentId && r?.usage) {
      const u = r.usage as Usage
      await patch($, e.agentId, a => ({
        ...a,
        model: u.model || a.model,
        effort: e.effort === undefined ? a.effort : String(e.effort),
        tokens: a.tokens + u.input_tokens + u.output_tokens + u.cache_creation_input_tokens,
        steps: a.steps + 1,
      })).catch(() => {})
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) {
      const failed = e.reason === 'error' || e.reason === 'aborted' || e.reason === 'refusal'
      await patch($, e.agentId, a => ({
        ...a,
        status: failed ? 'failed' : 'done',
        endedAt: Date.now(),
        tasks: failed ? a.tasks : a.tasks.map(t => ({ ...t, status: 'completed' as const })),
      })).catch(() => {})
    } else {
      await update($, main, m => ({ ...m, activity: 'Done', working: false, done: true })).catch(() => {})
      // confetti when it ended well and nobody of the crew is still at work
      const ok = e.reason !== 'error' && e.reason !== 'aborted' && e.reason !== 'refusal'
      const busy = (await read($, crew).catch(() => [] as Crew[])).some(a => a.status === 'running')
      await update($, fx, f => ({ ...f, asking: null, celebrateUntil: ok && !busy ? Date.now() + CELEBRATE_MS : 0 })).catch(() => {})
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const input = (e as any).input
    const agentId = e.agentId
    if (agentId) {
      await patch($, agentId, a => ({ ...a, tools: a.tools + 1, phase: activityOf(tool, input) })).catch(() => {})
    } else {
      const activity = activityOf(tool, input)
      const role = toolRole(tool, input)
      await update($, main, m => ({ ...m, activity, role, tools: m.tools + 1, working: true, done: false })).catch(() => {})
    }

    if (tool === 'AskUserQuestion' || tool === 'ExitPlanMode') await update($, fx, f => ({ ...f, asking: 'question' as const })).catch(() => {})

    const r = await next(e)

    // answered or refused, the "!" goes; a failed tool of Claude's own shakes the mascot
    const failed = !agentId && (r as any).isError === true
    await update($, fx, f => (f.asking || failed ? { ...f, asking: null, errorUntil: failed ? Date.now() + SHAKE_MS : f.errorUntil } : f)).catch(() => {})
    if (!agentId) await update($, main, m => (m.working ? { ...m, activity: 'Thinking' } : m)).catch(() => {})

    try {
      if (!(r as any).deny && /^(TodoWrite|TaskCreate|TaskUpdate)$/.test(tool)) {
        const result = (r as any).result
        if (agentId) await patch($, agentId, a => ({ ...a, tasks: applyTaskTool(a.tasks, tool, input, result) ?? a.tasks }))
        else await update($, tasks, list => applyTaskTool(list, tool, input, result) ?? list)
      }
    } catch {}
    return r
  }).catch(($, e, next) => next(e))

  // a permission request: Claude, or a subagent, waits for you
  on('tool.check', async ($, e, next) => {
    const r = await next(e)
    if (r.decision === 'ask' && e.tool_use_id) await update($, fx, f => ({ ...f, asking: f.asking ?? ('permission' as const) })).catch(() => {})
    return r
  }).catch(($, e, next) => next(e))

  // ── The band above the prompt ─────────────────────────────────────────
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Another mod may draw this band too: keep its tree under ours.
    const below = await next(e)
    if (e.props.hasSurvey || !(await read($, bandOn))) return below

    const list = await read($, tasks)
    const members = await read($, crew)
    const stored = await read($, main)
    const effects = await read($, fx)
    // the app says "working" but the state is the turn that ended: this is a new turn
    const fresh = e.props.isWorking && !stored.working
    const m: Main = fresh ? { activity: 'Thinking', steps: 0, tools: 0, working: true, done: false } : stored
    const since = await read($, batchStart)
    const running = members.filter(a => a.status === 'running').length
    const isWorking = m.working || e.props.isWorking
    const t = Date.now()
    const celebrating = !fresh && !isWorking && t < effects.celebrateUntil
    const asking = effects.asking
    if (list.length === 0 && running === 0 && !isWorking && !celebrating && !asking) return below

    const f = await read($, frame)
    const batch = members.filter(a => a.startedAt >= since)
    const delegating = running > 0
    const doneTasks = list.filter(x => x.status === 'completed').length

    // progress: the task list, else the average of this batch of subagents, else an estimate
    const target = list.length
      ? doneTasks / list.length
      : delegating && batch.length
        ? batch.reduce((s, a) => s + crewRatio(a), 0) / batch.length
        : m.done || celebrating
          ? 1
          : estimate(m.steps + m.tools)
    const ratio = glide.step(target, t)
    const pct = `${Math.round(ratio * 100)}%`
    const count = delegating ? `${batch.filter(a => a.status !== 'running').length}/${batch.length}` : list.length ? `${doneTasks}/${list.length}` : ''

    // what the mascot does: wait for you > shake > celebrate > walk > sleep
    const shaking = t < effects.errorUntil
    const pose: Pose = asking ? 'alert' : shaking ? 'shake' : celebrating ? 'jump' : isWorking || delegating ? 'walk' : 'sleep'

    const active = list.find(x => x.status === 'in_progress')
    const title = asking
      ? asking === 'permission'
        ? 'Needs your permission'
        : 'Waiting for your answer'
      : celebrating
        ? 'Done'
        : isWorking
          ? m.activity && m.activity !== 'Thinking'
            ? m.activity
            : active?.activeForm || 'Thinking'
          : delegating
            ? `Waiting for ${running} ${running === 1 ? 'deckhand' : 'deckhands'}`
            : active?.activeForm || active?.subject || 'Tasks'

    const color = shaking ? ALERT : delegating ? ROLES.captain.color : SEA
    const who: Who = delegating ? 'captain' : 'clawd'
    const els: any = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const openPane = () => $.ui.open({ id: PANE, title: TITLE }).catch(() => {})
    const crewLabel = `×${members.length}`
    const withBelow = (tree: any) => (hasDrawing(below) ? <Box flexDirection="column">{tree}{below}</Box> : tree)

    // ── terminal: one line, the mascot walking inside its own bar ──
    if (e.surface === 'terminal') {
      const { Raster } = els
      if (e.props.maxRows <= 0) return below
      const width = Math.max(0, e.props.bodyColumns)
      // after the title come, in order of importance, the percentage, the count and the
      // crew button, each with a column of space; what does not fit goes
      if (width < pct.length || !Raster) return below
      let left = width - pct.length
      const showCount = count !== '' && left >= count.length + 1
      if (showCount) left -= count.length + 1
      const showCrew = members.length > 0 && left >= crewLabel.length + 1
      if (showCrew) left -= crewLabel.length + 1
      // a symbol before the bar: the kind of work in hand (the flag while delegating) and the mood
      const mood = { walk: '', jump: '✦', sleep: 'zz', alert: '!', shake: '✗', still: '' }[pose]
      const symbolOf = delegating ? 'captain' : m.role
      const icon = [symbolOf ? ROLES[symbolOf].symbol : '', mood].filter(Boolean).join(' ')
      const iconColor = shaking || !symbolOf ? color : ROLES[symbolOf].color
      const showIcon = icon !== '' && left >= icon.length + 1 + 1 + TITLE_MIN
      if (showIcon) left -= icon.length + 1
      const showTitle = left >= 1
      // the bar takes the room the title can spare, up to a limit
      const room = left - 1
      const columns = Math.min(BAND_MAX, MAX_RASTER_COLUMNS, Math.floor(room * 0.6), room - 1 - TITLE_MIN)
      const art =
        columns < BAND_MIN ? null : bandRaster({ key: 'band', columns, captain: delegating, pose, frame: f, ratio, color })
      return withBelow(
        <Box flexDirection="row" gap={1}>
          {showTitle && (
            <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
              <Text bold wrap="truncate">{title}</Text>
            </Box>
          )}
          {showIcon && <Text color={iconColor}>{icon}</Text>}
          {art && (
            <Box flexShrink={0}>
              <Raster {...art} />
            </Box>
          )}
          <Text bold>{pct}</Text>
          {showCount && <Text dimColor>{count}</Text>}
          {showCrew && <Button key="crew" plain label={crewLabel} onPress={openPane} />}
        </Box>,
      )
    }

    // ── desktop, VS Code, mobile: the mascot stands on the bar at the edge of what is done ──
    const { Svg } = els
    if (!Svg) {
      return withBelow(
        <Box flexDirection="row" gap={1} paddingX={1}>
          <Text bold wrap="truncate">{title}</Text>
          <Text bold>{pct}</Text>
          {count !== '' && <Text dimColor>{count}</Text>}
        </Box>,
      )
    }
    const sprite = spriteSvg(who, pose, f, delegating ? 3 : 2)
    return withBelow(
      <Box flexDirection="row" alignItems="center" gap={1} paddingX={1}>
        <Box width="30%" flexShrink={0} overflow="hidden">
          <Text bold wrap="truncate">{title}</Text>
        </Box>
        <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
          <Box flexDirection="row" alignItems="flex-end">
            <Box flexGrow={ratio} flexShrink={1} />
            <Box flexShrink={0}>
              <Svg source={sprite.source} alt={delegating ? 'Claude as the captain' : 'Claude mascot'} width={sprite.width} height={sprite.height} />
            </Box>
            <Box flexGrow={1 - ratio} flexShrink={1} />
          </Box>
          <Box overflow="hidden" justifyContent="center">
            <Svg source={barSvg({ ratio, color, frame: f })} alt={`Progress ${pct}`} height={12} />
          </Box>
        </Box>
        <Box flexShrink={0} flexDirection="row" gap={1} alignItems="center">
          <Text bold>{pct}</Text>
          {count !== '' && <Text dimColor>{count}</Text>}
          {members.length > 0 && <Button key="crew" plain label={crewLabel} onPress={openPane} />}
        </Box>
      </Box>,
    )
  })

  // ── The crew panel ────────────────────────────────────────────────────
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const members = await read($, crew)
    const t = await read($, now)
    const f = await read($, frame)
    const expanded = await read($, showDone)
    const todo = await read($, tasks)
    const els: any = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const isTerminal = e.surface === 'terminal'
    const clock = Math.max(t, Date.now())

    const running = members.filter(a => a.status === 'running')
    const finished = members.filter(a => a.status !== 'running')
    const tokens = members.reduce((s, a) => s + a.tokens, 0)
    const first = members.reduce((n, a) => Math.min(n, a.startedAt), Infinity)
    const last = running.length ? clock : members.reduce((n, a) => Math.max(n, a.endedAt ?? a.startedAt), 0)
    const elapsed = members.length ? last - first : 0
    const heading = todo.find(x => x.status === 'in_progress')?.subject ?? (members.length ? 'The crew' : 'No deckhands yet')

    const metric = (label: string, value: string, key: string) => (
      <Box key={key} flexDirection="column" borderStyle="round" borderDimColor paddingX={1} flexGrow={1}>
        <Text dimColor>{label}</Text>
        <Text bold>{value}</Text>
      </Box>
    )

    const row = (a: Crew) => {
      const info = ROLES[a.role]
      const over = a.status !== 'running'
      const doneN = a.tasks.filter(x => x.status === 'completed').length
      const ratio = a.status === 'failed' ? (ratioOf(a.tasks) ?? estimate(a.steps + a.tools)) : crewRatio(a)
      const progress = a.tasks.length
        ? `${doneN}/${a.tasks.length}`
        : a.status === 'running'
          ? `${a.tools} ${a.tools === 1 ? 'action' : 'actions'}`
          : a.status === 'done'
            ? 'done'
            : 'failed'
      const phase = a.status === 'running' ? (a.tasks.find(x => x.status === 'in_progress')?.activeForm ?? a.phase ?? 'Starting') : ''
      const stats = `${fmtTokens(a.tokens)} tok  ${fmtTime((a.endedAt ?? clock) - a.startedAt)}`
      const mark = a.status === 'running' ? '●' : a.status === 'done' ? '✓' : '✗'
      const markColor = a.status === 'running' ? CLAY : a.status === 'done' ? GOOD : ALERT
      const sub = `${shortModel(a.model)}${a.effort ? ` · ${a.effort}` : ''}`
      const barColor = over ? fade(info.color) : info.color

      const text = (
        <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
          <Box flexDirection="row" justifyContent="space-between" gap={1}>
            <Box flexDirection="row" gap={1} flexShrink={1} minWidth={0} overflow="hidden">
              {isTerminal && <Text color={barColor}>{info.symbol}</Text>}
              <Text bold>{a.name}</Text>
              <Text dimColor wrap="truncate">{a.description}</Text>
            </Box>
            <Text color={markColor}>{mark}</Text>
          </Box>
          <Box flexDirection="row" gap={1}>
            <Text color={info.color}>{info.label}</Text>
            <Text dimColor>{sub}</Text>
          </Box>
          <Box flexDirection="row" justifyContent="space-between" gap={1}>
            <Text dimColor wrap="truncate">{progress}{phase ? ` · ${phase}` : ''}</Text>
            <Text dimColor>{stats}</Text>
          </Box>
        </Box>
      )

      if (isTerminal) {
        const { Raster } = els
        const width = Math.max(0, e.props.bodyColumns)
        const sprite = Raster ? crewRaster(a.role, `c-${a.id}`, !over, f, over) : null
        const art = sprite && width >= sprite.columns + 1 + TEXT_MIN ? sprite : null
        const barCols = Math.min(MAX_RASTER_COLUMNS, art ? width - art.columns - 1 : width)
        return (
          <Box key={`a-${a.id}`} flexDirection="row" gap={1} marginBottom={1}>
            {art && (
              <Box flexShrink={0} alignItems="center">
                <Raster {...art} />
              </Box>
            )}
            <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
              {text}
              {Raster && barCols >= BAR_MIN && <Raster {...barRaster({ key: `b-${a.id}`, columns: barCols, ratio, color: barColor, frame: f, still: over })} />}
            </Box>
          </Box>
        )
      }

      const { Svg } = els
      if (!Svg) return <Box key={`a-${a.id}`} marginBottom={1}>{text}</Box>
      const sprite = spriteSvg(a.role, over ? 'still' : 'walk', f, 2, over ? fade : undefined)
      return (
        <Box key={`a-${a.id}`} flexDirection="row" gap={1} paddingY={1} alignItems="flex-start">
          <Box flexShrink={0} alignItems="center">
            <Svg source={sprite.source} alt={`${a.name}, ${info.label}`} width={sprite.width} height={sprite.height} />
          </Box>
          <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
            {text}
            <Box marginTop={1} overflow="hidden">
              <Svg source={barSvg({ ratio, color: barColor, frame: f, still: over })} alt={`${a.name}'s progress`} height={6} />
            </Box>
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>{heading}</Text>
        <Box flexDirection="row" gap={1}>
          {metric('Crew', String(members.length), 'm-crew')}
          {metric('Tokens', fmtTokens(tokens), 'm-tok')}
          {metric('Time', fmtTime(elapsed), 'm-time')}
        </Box>
        <Text dimColor>{`At work · ${running.length}`}</Text>
        {running.length === 0 && <Text dimColor>Nobody is at work.</Text>}
        {running.map(row)}
        {finished.length > 0 && (
          <Button
            key="toggle-done"
            plain
            label={`${expanded ? '▾' : '▸'} Off duty · ${finished.length}`}
            onPress={() => update($, showDone, v => !v)}
          />
        )}
        {expanded && finished.slice().reverse().map(row)}
      </Box>
    )
  })
}
