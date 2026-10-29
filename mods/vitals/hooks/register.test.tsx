import { expect, mock, test } from 'claude-code/testing'

import { branchOf, cacheView, coldMultiple, dots, fmtSpan, paceOf } from './figures'

// The engine draws nothing of its own in the band: a stand-in beneath the mod, an empty Box.
const engine = (on: (...args: any[]) => void) =>
  on('ui.render', ($: any, e: unknown) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

const MIN = 60_000
const HOUR = 60 * MIN
const NOW = Date.parse('2026-10-28T12:00:00Z')

const BAND = {
  plugin: 'vitals',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 12,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 12 },
    view: {},
  },
} as const

const usage = (fiveUsed: number, sevenUsed: number) => ({
  startedAt: 0,
  context: { tokens: 240_000, window: 1_000_000, percent: 24 },
  rateLimits: [
    { kind: 'seven_day', percentUsed: sevenUsed, resetsAt: new Date(NOW + 3 * 24 * HOUR).toISOString() },
    { kind: 'five_hour', percentUsed: fiveUsed, resetsAt: new Date(NOW + 3 * HOUR).toISOString() },
  ],
})

test('slim is one row; the button opens the detail look; both on terminal and desktop', async ($, on) => {
  engine(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: usage(22, 48) }))
  mock.clock(on, { now: NOW })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const slim = await ui.find({ type: 'Text', text: /78% left/ })
    expect(slim, `${surface}: 5-hour window, what is left`).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /52% left/ }), `${surface}: 7-day window`).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\(22% used\)/ }), `${surface}: slim does not show used`).toBeUndefined()

    await ui.press({ key: 'look-toggle' })
    expect(await ui.find({ type: 'Text', text: /\(22% used\)/ }), `${surface}: detail shows used`).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /of 1000k tokens|of 1M tokens/ }), `${surface}: detail shows the context`).toBeDefined()

    await ui.press({ key: 'look-toggle' })
    expect(await ui.find({ type: 'Text', text: /\(22% used\)/ }), `${surface}: back to slim`).toBeUndefined()
    await ui.unmount()
  }
})

test('the deckhands progress band stays above the vitals band', async ($, on) => {
  on('ui.render', ($: any, e: any) => {
    const { Box, Text } = $.ui.resolve(e)
    return <Box key="deckhands-band"><Text>progress band</Text></Box>
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: usage(22, 48) }))
  mock.clock(on, { now: NOW })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
  const above = texts.indexOf('progress band')
  const vitals = texts.findIndex(t => /78% left/.test(t))
  expect(above, 'the progress band is drawn').toBeGreaterThan(-1)
  expect(vitals, 'vitals is drawn').toBeGreaterThan(-1)
  expect(above, 'progress band first').toBeLessThan(vitals)
  await ui.unmount()
})

test('a window under the warn line says LOW; a survey gets the band to itself', async ($, on) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: usage(92, 10) }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  mock.clock(on, { now: NOW })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /LOW/ })).toBeDefined()
  await ui.unmount()

  const survey = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true }, surface: 'desktop' })
  expect((await survey.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await survey.unmount()
})

test('pace: warns when the burn would empty a window before it resets', () => {
  const resets = (ms: number) => new Date(NOW + ms).toISOString()
  // 5-hour window, 2.5 hours gone, half used: exactly on pace.
  expect(paceOf('five_hour', 50, resets(2.5 * HOUR), NOW)).toEqual({ state: 'steady' })
  // 1 hour gone and 60% used: empties in 40 more minutes, 4 hours before it resets.
  expect(paceOf('five_hour', 60, resets(4 * HOUR), NOW)).toEqual({ state: 'out', ms: 40 * MIN })
  // Barely started: too early to project.
  expect(paceOf('five_hour', 5, resets(5 * HOUR - MIN), NOW)).toBeNull()
  // Slow burn.
  expect(paceOf('five_hour', 10, resets(1 * HOUR), NOW)).toEqual({ state: 'under' })
  // A window the band doesn't know the length of.
  expect(paceOf('spend_limit', 50, resets(HOUR), NOW)).toBeNull()
})

test('cache: warm for the configured minutes, then cold; a cold re-cache is a multiple of a warm read', () => {
  expect(cacheView(NOW - 10 * MIN, NOW, 60 * MIN)).toEqual({ mode: 'warm', idleMs: 10 * MIN, leftMs: 50 * MIN })
  expect(cacheView(NOW - 61 * MIN, NOW, 60 * MIN)?.mode).toBe('cold')
  expect(cacheView(undefined, NOW, 60 * MIN)).toBeNull()
  expect(coldMultiple(60)).toBe(20)
  expect(coldMultiple(5)).toBe(12.5)
})

test('the branch is read from .git/HEAD: a branch, a detached commit, or nothing', () => {
  expect(branchOf('ref: refs/heads/main\n')).toBe('main')
  expect(branchOf('ref: refs/heads/feature/vitals-band')).toBe('feature/vitals-band')
  expect(branchOf('3174ed2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n')).toBe('3174ed2')
  expect(branchOf('garbage')).toBeNull()
})

test('formatting', () => {
  expect(fmtSpan(30_000)).toBe('<1m')
  expect(fmtSpan(125 * MIN)).toBe('2h 5m')
  expect(fmtSpan(57 * HOUR)).toBe('2d 9h')
  expect(dots(78, 10)).toEqual({ on: '●●●●●●●●', off: '··' })
})

test('the button is on the band at every width, never pushed off the edge', async ($, on) => {
  engine(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: usage(60, 80) }))
  mock.clock(on, { now: NOW })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  for (const bodyColumns of [200, 120, 90, 70, 50, 40]) {
    const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns }, surface: 'terminal' })
    expect(await ui.findAll({ type: 'Button' }), `${bodyColumns} columns: exactly one button`).toHaveLength(1)
    await ui.unmount()
  }
})

test('the band has the round dim border prompt-shaper has, in both looks on both surfaces', async ($, on) => {
  engine(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: usage(60, 80) }))
  mock.clock(on, { now: NOW })

  const isFramed = async (ui: { findAll: (m: unknown) => Promise<{ props?: Record<string, unknown> }[]> }) =>
    (await ui.findAll({ type: 'Box' })).some(b => b.props?.borderStyle === 'round' && b.props?.borderDimColor === true)

  for (const surface of ['terminal', 'desktop'] as const) {
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await isFramed(ui), `${surface}: slim is framed`).toBe(true)
    await ui.press({ key: 'look-toggle' })
    expect(await isFramed(ui), `${surface}: detail is framed`).toBe(true)
    await ui.unmount()
  }
})

test('another mod strip under the band is drawn once, in both looks and at every width', async ($, on) => {
  on('ui.render', ($: any, e: unknown) => {
    const { Box, Text } = $.ui.resolve(e)
    return <Box><Text>OTHER-MOD-STRIP</Text></Box>
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: usage(22, 48) }))
  mock.clock(on, { now: NOW })

  for (const surface of ['terminal', 'desktop'] as const) {
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    for (const bodyColumns of [120, 50]) {
      const ui = await $.ui.mount({ ...BAND, surface, props: { ...BAND.props, bodyColumns } })
      for (const look of ['slim', 'detail']) {
        expect((await ui.findAll({ type: 'Text', text: /OTHER-MOD-STRIP/ })).length, `${surface} ${bodyColumns} ${look}`).toBe(1)
        await ui.press({ key: 'look-toggle' })
      }
      await ui.unmount()
    }
  }
})

const gitRepo = (on: never) => {
  const run = on as (...args: unknown[]) => void
  run('session.cwd', () => ({ value: '/work/app' }))
  run('fs.read', (_: unknown, e: { path: string }) => {
    // the harness resolves paths for the host: D:\work\app\.git\HEAD on Windows
    const path = e.path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
    if (path === '/work/app/.git/HEAD') return { value: 'ref: refs/heads/feature/bands\n' }
    throw new Error('no such file')
  })
}

test('the terminal shows the git branch and no title; the desktop shows neither', async ($, on) => {
  engine(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: usage(22, 48) }))
  gitRepo(on as never)
  mock.clock(on, { now: NOW })
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })

  const terminal = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await terminal.find({ type: 'Text', text: /feature\/bands/ }), 'terminal: the branch').toBeDefined()
  expect(await terminal.find({ type: 'Text', text: /⎇/ }), 'terminal: an icon says it is a branch').toBeDefined()
  expect(await terminal.find({ type: 'Text', text: /VITALS/ }), 'terminal: no title').toBeUndefined()
  await terminal.unmount()

  const desktop = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await desktop.find({ type: 'Text', text: /feature\/bands/ }), 'desktop: no branch').toBeUndefined()
  expect(await desktop.find({ type: 'Text', text: /VITALS/ }), 'desktop: no title').toBeUndefined()
  await desktop.unmount()
})

test('a folder with no repository shows no branch', async ($, on) => {
  engine(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: usage(22, 48) }))
  on('session.cwd', () => ({ value: '/tmp/nowhere' }))
  on('fs.read', () => {
    throw new Error('no such file')
  })
  mock.clock(on, { now: NOW })
  await $.session.start({ cwd: '/tmp/nowhere', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /78% left/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /VITALS/ }), 'no branch, and still no title').toBeUndefined()
  await ui.unmount()
})

test('desktop draws Robo and the cache card in the detail look; the terminal draws text rows', async ($, on) => {
  engine(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: usage(22, 48) }))
  on('classic.SessionStart', () => ({}))
  mock.clock(on, { now: NOW })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // A resumed chat that was away ten minutes, holding 240k tokens: the cache is warm.
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 600, context_tokens: 240_000 } as never)

  const desktop = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await desktop.findAll({ type: 'Svg' }), 'desktop slim: Robo and the chip are drawings').toHaveLength(2)
  await desktop.press({ key: 'look-toggle' })
  expect(await desktop.find({ type: 'Text', text: /\(22% used\)/ }), 'desktop detail keeps the usage rows').toBeDefined()
  expect(await desktop.findAll({ type: 'Svg' }), 'and swaps them for the cache card').toHaveLength(1)
  await desktop.unmount()

  const terminal = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await terminal.find({ type: 'Svg' }), 'terminal: no drawings').toBeUndefined()
  // The look is the session's, so the terminal band is already in the detail look the desktop opened.
  expect(await terminal.find({ type: 'Text', text: /warm/ }), 'terminal: the cache in words').toBeDefined()
  expect(await terminal.find({ type: 'Text', text: /about 20×/ }), 'terminal detail: a cold cache as a multiple').toBeDefined()
  await terminal.unmount()
})

test('before the first reply the band says what it is waiting for, on both skins', async ($, on) => {
  engine(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  // A fresh session: no rate-limit reading yet, no context size, no request sent.
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } }))
  mock.clock(on, { now: NOW })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /after your first reply/ }), `${surface}: a placeholder, not an empty band`).toBeDefined()
    await ui.unmount()
  }
})

test('the desktop drawings are inked for the app theme, light or dark', async ($, on) => {
  engine(on)
  let theme = 'light'
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: usage(22, 48) }))
  on('classic.SessionStart', () => ({}))
  on('config.list', () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: theme, isLocked: false }] }))
  mock.clock(on, { now: NOW })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 600, context_tokens: 240_000 } as never)

  const light = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await light.press({ key: 'look-toggle' })
  const lightCard = JSON.stringify(await light.findAll({ type: 'Svg' }))
  expect(lightCard, 'light theme: dark ink').toContain('#2b2824')
  expect(lightCard, 'light theme: no fixed dark card').not.toContain('#24221c')
  await light.unmount()
})


test('another mod band under this one is kept, not replaced', async ($, on) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: usage(22, 48) }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>shape button</Text>
  })
  mock.clock(on, { now: NOW })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /78% left/ }), 'vitals still draws').toBeDefined()
  expect(await ui.find({ type: 'Text', text: /shape button/ }), 'the other band is kept').toBeDefined()
  await ui.unmount()
})
