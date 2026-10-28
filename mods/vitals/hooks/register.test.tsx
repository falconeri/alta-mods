import { expect, mock, test } from 'claude-code/testing'

import { cacheView, dots, fmtSpan, nextCost, paceOf } from './figures'

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

test('cache: warm for the configured minutes, then cold; cost needs a price', () => {
  expect(cacheView(NOW - 10 * MIN, NOW, 60 * MIN)).toEqual({ mode: 'warm', idleMs: 10 * MIN, leftMs: 50 * MIN })
  expect(cacheView(NOW - 61 * MIN, NOW, 60 * MIN)?.mode).toBe('cold')
  expect(cacheView(undefined, NOW, 60 * MIN)).toBeNull()
  expect(nextCost('cold', 1_000_000, 0, 60)).toBeNull()
  expect(nextCost('cold', 1_000_000, 4, 60)).toBe(8)
  expect(nextCost('cold', 1_000_000, 4, 5)).toBe(5)
  expect(nextCost('warm', 1_000_000, 4, 60)).toBe(0.4)
})

test('formatting', () => {
  expect(fmtSpan(30_000)).toBe('<1m')
  expect(fmtSpan(125 * MIN)).toBe('2h 5m')
  expect(fmtSpan(57 * HOUR)).toBe('2d 9h')
  expect(dots(78, 10)).toEqual({ on: '●●●●●●●●', off: '··' })
})
