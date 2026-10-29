import { expect, test } from 'claude-code/testing'

import { bandRaster, barSvg, crewRaster, spriteSvg } from './art'
import { activityOf, createGlide, estimate, pickName, roleOf, toolRole } from './crew'

// The engine draws nothing of its own in the band: a stand-in beneath the mod, an empty Box.
const engine = (on: (...args: any[]) => void) =>
  on('ui.render', { component: 'AbovePrompt' }, ($: any, e: unknown) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

const BAND: any = { isWorking: true, hasSurvey: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} }
const PANE: any = { title: 'Deckhands', isFocused: false, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} }
const bandAt = (surface: 'terminal' | 'desktop', props = BAND) => ({ plugin: 'deckhands', surface, component: 'AbovePrompt', props }) as any
const paneAt = (surface: 'terminal' | 'desktop') =>
  ({ plugin: 'deckhands', surface, component: 'Pane', props: PANE, requestId: 'deckhands-crew' }) as any

test('every subagent gets a role from the first keyword', async () => {
  expect(roleOf('general-purpose', 'Review the whole kit')).toBe('lookout')
  expect(roleOf('general-purpose', 'Run the tests')).toBe('lookout')
  expect(roleOf('Plan', 'Plan the architecture')).toBe('navigator')
  expect(roleOf('Explore', 'Map the project')).toBe('navigator')
  expect(roleOf('general-purpose', 'Design the launch graphics')).toBe('painter')
  expect(roleOf('general-purpose', 'Build the landing page')).toBe('shipwright')
  expect(roleOf('general-purpose', 'Fix the login bug')).toBe('shipwright')
  // the earliest keyword wins, not the strongest
  expect(roleOf('general-purpose', 'Research then build the page')).toBe('navigator')
  // no keyword in the description: the agent type decides, else a deckhand
  expect(roleOf('code-reviewer', 'the diff')).toBe('lookout')
  expect(roleOf('shipwright-coder', 'the spec')).toBe('shipwright')
  expect(roleOf('cartographer-planner', 'the feature spec')).toBe('shipwright')
  expect(roleOf('cartographer-planner', 'the spec')).toBe('navigator')
  expect(roleOf('general-purpose', 'Organize things')).toBe('deckhand')
})

test('Claude is never a crew member', async () => {
  for (const d of ['Review the whole kit', 'Coordinate the team', 'Plan the release', 'Captain of the project'])
    expect(roleOf('general-purpose', d)).not.toBe('captain')
})

test('the role of what Claude itself does', async () => {
  expect(toolRole('Read', {})).toBe('navigator')
  expect(toolRole('Edit', { file_path: 'a/b/app.ts' })).toBe('shipwright')
  expect(toolRole('Edit', { file_path: 'a/b/style.css' })).toBe('painter')
  expect(toolRole('Bash', { description: 'Run the tests' })).toBe('lookout')
  expect(toolRole('mcp__x__y', {})).toBe('deckhand')
})

test('names are stable per agent and never repeat among those at work', async () => {
  expect(pickName('agent-1', new Set())).toBe(pickName('agent-1', new Set()))
  const taken = new Set<string>()
  for (let i = 0; i < 20; i++) {
    const name = pickName(`agent-${i}`, taken)
    expect(taken.has(name)).toBe(false)
    taken.add(name)
  }
})

test('the estimate grows and stays under 90%', async () => {
  expect(estimate(0)).toBe(0)
  expect(estimate(4)).toBeGreaterThan(estimate(2))
  expect(estimate(1000)).toBeLessThanOrEqual(0.9)
})

test('the bar glides up and drops at once', async () => {
  const glide = createGlide()
  expect(glide.step(0.2, 1000)).toBe(0.2)
  const step = glide.step(0.8, 1300)
  expect(step).toBeGreaterThan(0.2)
  expect(step).toBeLessThan(0.8)
  expect(glide.settling).toBe(true)
  expect(glide.step(0.8, 1600)).toBeGreaterThan(step)
  expect(glide.step(0, 1700)).toBe(0)
})

test('describes what a tool call is doing', async () => {
  expect(activityOf('Read', { file_path: 'C:/x/hooks/art.ts' })).toBe('Reading art.ts')
  expect(activityOf('Edit', { file_path: '/a/b/register.tsx' })).toBe('Editing register.tsx')
  expect(activityOf('Bash', { description: 'Run the tests' })).toBe('Run the tests')
  expect(activityOf('Agent', { description: 'Build the page' })).toBe('Delegating: Build the page')
  expect(activityOf('mcp__github__create_issue', {})).toBe('Using create_issue')
})

test('the terminal art has the cells it says it has', async () => {
  // cells: a u32 triplet each, base64 (4 chars per 3 bytes)
  const size = (r: { columns: number; rows: number; cells: string }) => (r.cells.length / 4) * 3 === r.columns * r.rows * 12
  const bar = bandRaster({ key: 'b', columns: 30, captain: false, pose: 'walk', frame: 3, ratio: 0.5, color: '#D97757' })
  expect([bar.columns, bar.rows, size(bar)]).toEqual([30, 1, true])
  for (const role of ['captain', 'shipwright', 'navigator', 'painter', 'lookout', 'deckhand'] as const) {
    const sprite = crewRaster(role, `c-${role}`, true, 2, false)
    expect([sprite.columns, sprite.rows, size(sprite)]).toEqual([5, 2, true])
  }
  // a mascot too wide for its bar is left out rather than cut
  expect(bandRaster({ key: 'n', columns: 3, captain: false, pose: 'walk', frame: 0, ratio: 1, color: '#D97757' }).columns).toBe(3)
})

test('the desktop art is a fixed frame whatever the pose', async () => {
  const sizes = new Set(
    (['walk', 'jump', 'sleep', 'alert', 'shake', 'still'] as const).map(p => {
      const s = spriteSvg('clawd', p, 5, 2)
      return `${s.width}x${s.height}`
    }),
  )
  expect(sizes.size).toBe(1)
  expect(barSvg({ ratio: 0.5, color: '#D97757', frame: 4 })).toContain('<rect')
})

test('the band follows the task list, in the terminal and on the desktop', async ($, on) => {
  engine(on)
  ;(on as any)('tool.call', { tool: 'TodoWrite' }, async () => ({ result: { oldTodos: [], newTodos: [] } }))
  await ($.tool.call as any)({
    tool: 'TodoWrite',
    input: {
      todos: [
        { content: 'First', status: 'completed', activeForm: 'Doing the first' },
        { content: 'Second', status: 'in_progress', activeForm: 'Doing the second' },
      ],
    },
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(bandAt(surface))
    expect(await ui.find({ text: /Doing the second/ }), `${surface}: what is in progress`).toBeDefined()
    expect(await ui.find({ text: /50%/ }), `${surface}: the share done`).toBeDefined()
    await ui.unmount()
  }
})

test('a subagent signs on with a name and a role; the panel shows it on both surfaces', async ($, on) => {
  engine(on)
  on('agent.spawn', async () => ({ model: 'claude-opus-5-5', agentId: 'agent-1' }))
  on('turn.complete', async () => ({ text: '' }))
  await $.agent.spawn({ prompt: 'go', description: 'Build the landing page', subagentType: 'general-purpose' } as any)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(paneAt(surface))
    expect(await ui.find({ text: /Build the landing page/ }), `${surface}: its task`).toBeDefined()
    expect(await ui.find({ text: /shipwright/ }), `${surface}: its role`).toBeDefined()
    expect(await ui.find({ text: /At work · 1/ }), `${surface}: the count`).toBeDefined()
    await ui.unmount()
  }

  await $.turn.complete({ agentId: 'agent-1', answer: 'ok', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' } as any)
  const ui = await $.ui.mount(paneAt('desktop'))
  expect(await ui.find({ text: /Off duty · 1/ })).toBeDefined()
  expect(await ui.find({ text: /At work · 0/ })).toBeDefined()
  // no money on a Claude account
  expect(await ui.find({ text: /Cost|\$/ })).toBeUndefined()
  await ui.unmount()
})

test('Claude becomes the captain and counts finished subagents', async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', async () => ({ model: 'claude-haiku-5-5', agentId: 'ag-' + ++n }))
  on('turn.complete', async () => ({ text: '' }))
  await $.agent.spawn({ prompt: 'a', description: 'Build the page', subagentType: 'general-purpose' } as any)
  await $.agent.spawn({ prompt: 'b', description: 'Design the logo', subagentType: 'general-purpose' } as any)
  await $.turn.complete({ agentId: 'ag-1', answer: 'ok', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' } as any)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(bandAt(surface, { ...BAND, isWorking: false }))
    expect(await ui.find({ text: /1\/2/ }), `${surface}: finished of the batch`).toBeDefined()
    expect(await ui.find({ text: /Waiting for 1 deckhand/ }), `${surface}: who is left`).toBeDefined()
    if (surface === 'desktop') expect((await ui.find({ type: 'Svg' }))?.props.alt).toBe('Claude as the captain')
    await ui.unmount()
  }
})

test('a new prompt does not inherit the last turn’s 100%', async ($, on) => {
  engine(on)
  on('turn.complete', async () => ({ text: '' }))
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 't0', reason: 'answer' } as any)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(bandAt(surface))
    expect(await ui.find({ text: /100%/ })).toBeUndefined()
    expect(await ui.find({ text: /^0%$/ })).toBeDefined()
    expect(await ui.find({ text: /Thinking/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a finished turn says Done; an aborted one does not', async ($, on) => {
  engine(on)
  on('turn.complete', async () => ({ text: '' }))
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 't0', reason: 'answer' } as any)
  const done = await $.ui.mount(bandAt('desktop', { ...BAND, isWorking: false }))
  expect(await done.find({ text: /^Done$/ })).toBeDefined()
  await done.unmount()

  await $.turn.complete({ answer: '', durationMs: 10, isAborted: true, turnId: 't1', reason: 'aborted' } as any)
  const aborted = await $.ui.mount(bandAt('desktop', { ...BAND, isWorking: false }))
  expect(await aborted.find({ text: /^Done$/ })).toBeUndefined()
  await aborted.unmount()
})

test('the band waits for the person while a question is open', async ($, on) => {
  engine(on)
  let seen: unknown
  ;(on as any)('tool.call', { tool: 'AskUserQuestion' }, async () => {
    const ui = await $.ui.mount(bandAt('terminal'))
    seen = await ui.find({ text: /Waiting for your answer/ })
    await ui.unmount()
    return { result: { questions: [], answers: {} } }
  })
  await ($.tool.call as any)({ tool: 'AskUserQuestion', input: { questions: [] } })
  expect(seen).toBeDefined()

  const ui = await $.ui.mount(bandAt('terminal'))
  expect(await ui.find({ text: /Waiting for your answer/ })).toBeUndefined()
  await ui.unmount()
})

test('the band stands above whatever another mod draws beneath it', async ($, on) => {
  on('ui.render', { component: 'AbovePrompt' }, ($: any, e: any) => {
    const { Box, Text } = $.ui.resolve(e)
    return <Box><Text>other band</Text></Box>
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(bandAt(surface))
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    expect(texts.indexOf('other band'), `${surface}: the other band is drawn`).toBeGreaterThan(-1)
    expect(texts.findIndex(t => /Thinking/.test(t ?? '')), `${surface}: ours first`).toBeLessThan(texts.indexOf('other band'))
    await ui.unmount()
  }
})

test('the band leaves a survey, and a narrow terminal, to whoever is beneath it', async ($, on) => {
  on('ui.render', { component: 'AbovePrompt' }, ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const survey = await $.ui.mount(bandAt('desktop', { ...BAND, hasSurvey: true }))
  expect((await survey.find({ text: /engine/ }))?.text).toBe('engine')
  await survey.unmount()

  const narrow = await $.ui.mount(bandAt('terminal', { ...BAND, bodyColumns: 1 }))
  expect((await narrow.find({ text: /engine/ }))?.text).toBe('engine')
  await narrow.unmount()
})
