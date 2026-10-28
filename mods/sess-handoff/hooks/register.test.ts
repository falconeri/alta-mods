import { expect, mock, test } from 'claude-code/testing'

const HANDOFF = '# Handoff\n\n## Goal\nShip the thing.\n\n## Next steps\n1. Run the tests.'

const START = 'Start a fresh chat with it'
const COPY = 'Copy it for a teammate'
const KEEP = 'Keep this chat'

type Setup = {
  tokens?: number
  window?: number
  pick?: string
  coldPick?: string
  forkReason?: 'nothing-to-fork'
  clearFails?: boolean
  filled?: boolean
}

type Agent = { status: string }

async function arrange(on: never, setup: Setup = {}) {
  const log = {
    events: [] as string[],
    asked: [] as string[],
    options: [] as string[][],
    agents: [] as Agent[],
    written: [] as { path: string; text: string }[],
    copied: [] as string[],
    submitted: [] as string[],
    filled: [] as string[],
    toasts: [] as string[],
    forkPrompt: '',
    tokens: setup.tokens ?? 10_000,
  }
  const run = on as (...args: unknown[]) => void
  run('session.start', async (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  run('command.register', async () => ({ value: { command: 'sess-handoff' } }))
  run('turn.start', async (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  run('turn.complete', async () => ({ text: '' }))
  run('session.usage', async () => ({
    value: { startedAt: 0, context: { tokens: log.tokens, window: setup.window ?? 1_000_000 }, rateLimits: [], cost: { usd: 0 } },
  }))
  run('agent.list', async () => ({ value: log.agents }))
  run('session.id', async () => ({ value: 'abcdef12-3456' }))
  run('env.get', async () => ({ value: '/home/test' }))
  run('fs.write', async (_: unknown, e: { path: string; text: string }) => {
    log.events.push('write')
    log.written.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  run('model.fork', async (_: unknown, e: { prompt: string }) => {
    log.events.push('fork')
    log.forkPrompt = e.prompt
    if (setup.forkReason) return { value: { isAnswered: false, reason: setup.forkReason } }
    return { value: { isAnswered: true, text: HANDOFF, usage: { input_tokens: 1, output_tokens: 1 } } }
  })
  run('tool.call', { tool: 'AskUserQuestion' }, async (_: unknown, e: { questions: { question: string; options: { label: string }[] }[] }) => {
    const first = e.questions[0]
    const question = first?.question ?? ''
    const labels = (first?.options ?? []).map(o => o.label)
    log.events.push('ask')
    log.asked.push(question)
    log.options.push(labels)
    const isCold = question.startsWith('The prompt cache went cold')
    const answer = isCold ? (setup.coldPick ?? 'Write a handoff first') : (setup.pick ?? START)
    return { result: { questions: e.questions, answers: { [question]: answer } } }
  })
  run('command.run', async (_: unknown, e: { command: string }) => {
    if (setup.clearFails) throw new Error('clear is not available here')
    log.events.push(`run:${e.command}`)
    return { text: '' }
  })
  run('prompt.submit', async (_: unknown, e: { text: string }) => {
    log.events.push('submit')
    log.submitted.push(e.text)
    return { text: e.text }
  })
  run('prompt.fill', async (_: unknown, e: { text: string }) => {
    log.filled.push(e.text)
    return setup.filled === false ? { isFilled: false, refusal: 'no_composer' } : { isFilled: true }
  })
  run('ui.copy', async (_: unknown, e: { text: string }) => {
    log.events.push('copy')
    log.copied.push(e.text)
    return { value: { isCopied: true } }
  })
  run('ui.toast', async (_: unknown, e: { text: string }) => {
    log.toasts.push(e.text)
    return { value: undefined }
  })
  run('ui.status', async () => ({ value: undefined }))
  run('ui.log', async () => ({ value: undefined }))
  return log
}

async function start($: never) {
  const run = $ as { session: { start: (a: unknown) => Promise<unknown> } }
  await run.session.start({ source: 'startup', cwd: '/work', surface: 'terminal', isInteractive: true })
}

const turnStart = ($: never, id: string) => ($ as { turn: { start: (a: unknown) => Promise<unknown> } }).turn.start({ text: 'go', turnId: id })
const turnComplete = ($: never, id: string, agentId?: string) =>
  ($ as { turn: { complete: (a: unknown) => Promise<unknown> } }).turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: id, reason: 'answer', agentId })

const MINUTE = 60_000

test('typing sess-handoff writes the handoff, asks, and only then opens a fresh chat seeded with it', { timeoutMs: 20000 }, async ($, on) => {
  const log = await arrange(on as never)
  const clock = mock.clock(on, { now: 1_000_000 })
  await start($ as never)

  const typed = await $.prompt.submit({ text: 'sess-handoff' } as never)
  expect(typed.drop, 'the keyword is not sent to Claude').toBeDefined()
  await clock.advance(10_000)

  expect(log.events, 'fork, save, ask, then clear, then seed').toEqual(['fork', 'write', 'ask', 'run:clear', 'submit'])
  expect(log.forkPrompt, 'it asks for the whole chat').toContain('Cover the whole conversation from its first message')
  expect(log.forkPrompt, 'with a subagent section').toContain('## Subagents and orchestration')
  expect(log.options[0], 'the person chooses').toEqual([START, COPY, 'Both', KEEP])
  expect(log.written[0]?.path, 'saved as a dated .md file under the Claude config folder').toMatch(/home.test.\.claude.handoffs.handoff-.*-abcdef12\.md$/)
  expect(log.written[0]?.text).toContain('# Handoff')
  const seed = log.submitted[0] ?? ''
  expect(seed, 'the fresh chat is seeded with the handoff').toContain(HANDOFF)
  expect(seed, 'and told to restate before changing anything').toContain('wait for my reply before changing anything')
})

test('keeping this chat starts nothing new', { timeoutMs: 20000 }, async ($, on) => {
  const log = await arrange(on as never, { pick: KEEP })
  const clock = mock.clock(on, { now: 1_000_000 })
  await start($ as never)

  await $.prompt.submit({ text: '  Sess-Handoff ' } as never)
  await clock.advance(10_000)
  expect(log.events, 'no clear, no seed').toEqual(['fork', 'write', 'ask'])
  expect(log.toasts.at(-1), 'the file is still kept').toContain('Handoff kept at ')
})

test('copy for a teammate puts the handoff on the clipboard and sends nothing', { timeoutMs: 20000 }, async ($, on) => {
  const log = await arrange(on as never, { pick: COPY })
  const clock = mock.clock(on, { now: 1_000_000 })
  await start($ as never)

  await $.prompt.submit({ text: 'sess-handoff' } as never)
  await clock.advance(10_000)
  expect(log.copied, 'the handoff is on the clipboard').toEqual([HANDOFF])
  expect(log.events, 'this chat stays').toEqual(['fork', 'write', 'ask', 'copy'])
})

test('the slash command does the same', { timeoutMs: 20000 }, async ($, on) => {
  const log = await arrange(on as never, { pick: KEEP })
  const clock = mock.clock(on, { now: 1_000_000 })
  await start($ as never)

  const ran = await $.command.run({ command: 'sess-handoff' } as never)
  expect(ran.text).toContain('Writing a handoff')
  await clock.advance(10_000)
  expect(log.events).toEqual(['fork', 'write', 'ask'])
})

test('with subagents running, the handoff waits for every one and then completes', { timeoutMs: 30000 }, async ($, on) => {
  const log = await arrange(on as never, { pick: KEEP })
  const clock = mock.clock(on, { now: 1_000_000 })
  await start($ as never)
  log.agents = [{ status: 'running' }, { status: 'waiting' }]

  await $.prompt.submit({ text: 'sess-handoff' } as never)
  await clock.advance(60_000)
  expect(log.events, 'a minute later it is still waiting, nothing was cut short').toEqual([])

  log.agents = [{ status: 'completed' }, { status: 'running' }]
  await clock.advance(30_000)
  expect(log.events, 'one agent is still running').toEqual([])

  log.agents = [{ status: 'completed' }, { status: 'failed' }]
  await clock.advance(10_000)
  expect(log.events, 'all done: the handoff is written once').toEqual(['fork', 'write', 'ask'])
})

test('an idle teammate does not block the handoff', { timeoutMs: 20000 }, async ($, on) => {
  const log = await arrange(on as never, { pick: KEEP })
  const clock = mock.clock(on, { now: 1_000_000 })
  await start($ as never)
  log.agents = [{ status: 'idle' }]

  await $.prompt.submit({ text: 'sess-handoff' } as never)
  await clock.advance(10_000)
  expect(log.events).toEqual(['fork', 'write', 'ask'])
})

test('a handoff asked for in the middle of a turn waits for the turn, and a new turn restarts the wait', { timeoutMs: 30000 }, async ($, on) => {
  const log = await arrange(on as never, { pick: KEEP })
  const clock = mock.clock(on, { now: 1_000_000 })
  await start($ as never)

  await turnStart($ as never, 't1')
  await $.prompt.submit({ text: 'sess-handoff' } as never)
  await clock.advance(30_000)
  expect(log.events, 'Claude is mid-turn: nothing is written').toEqual([])

  await turnComplete($ as never, 't1')
  await clock.advance(1_500)
  // A finished subagent's result becomes a new turn a moment later.
  await turnStart($ as never, 't2')
  await clock.advance(10_000)
  expect(log.events, 'the new turn pushed the handoff back').toEqual([])

  await turnComplete($ as never, 't2')
  await clock.advance(10_000)
  expect(log.events, 'quiet for the settle time: now it writes').toEqual(['fork', 'write', 'ask'])
})

test('a subagent finishing its own turn is not the main chat finishing', { timeoutMs: 30000 }, async ($, on) => {
  const log = await arrange(on as never, { pick: KEEP })
  const clock = mock.clock(on, { now: 1_000_000 })
  await start($ as never)

  await turnStart($ as never, 't1')
  await $.prompt.submit({ text: 'sess-handoff' } as never)
  await turnComplete($ as never, 'sub1', 'agent-7')
  await clock.advance(30_000)
  expect(log.events, 'the main turn is still running').toEqual([])
})

test('sess-handoff cancel stops a queued handoff and writes nothing', { timeoutMs: 30000 }, async ($, on) => {
  const log = await arrange(on as never)
  const clock = mock.clock(on, { now: 1_000_000 })
  await start($ as never)
  log.agents = [{ status: 'running' }]

  await $.prompt.submit({ text: 'sess-handoff' } as never)
  await clock.advance(10_000)
  const cancel = await $.prompt.submit({ text: 'sess-handoff cancel' } as never)
  expect(cancel.drop).toContain('Cancelling')
  await clock.advance(10_000)
  expect(log.events, 'nothing was written').toEqual([])
  expect(log.toasts.at(-1)).toBe('Handoff cancelled.')
})

test('the token trigger fires at 250k when a turn ends, and only once', { timeoutMs: 30000 }, async ($, on) => {
  const log = await arrange(on as never, { tokens: 260_000, pick: KEEP })
  const clock = mock.clock(on, { now: 1_000_000 })
  await start($ as never)

  await turnComplete($ as never, 't1')
  await clock.advance(10_000)
  expect(log.events, 'written without being asked for').toEqual(['fork', 'write', 'ask'])
  expect(log.asked[0]).toContain('The conversation is getting long.')

  log.events.length = 0
  await turnComplete($ as never, 't2')
  await clock.advance(10_000)
  expect(log.events, 'declined once: not offered again this session').toEqual([])
})

test('below 250k nothing happens', { timeoutMs: 20000 }, async ($, on) => {
  const log = await arrange(on as never, { tokens: 249_999 })
  const clock = mock.clock(on, { now: 1_000_000 })
  await start($ as never)

  await turnComplete($ as never, 't1')
  await clock.advance(10_000)
  expect(log.events).toEqual([])
})

test('the threshold is a setting, and 0 turns the trigger off', { timeoutMs: 20000, options: { tokenThreshold: 0 } }, async ($, on) => {
  const log = await arrange(on as never, { tokens: 900_000 })
  const clock = mock.clock(on, { now: 1_000_000 })
  await start($ as never)

  await turnComplete($ as never, 't1')
  await clock.advance(10_000)
  expect(log.events).toEqual([])
})

test('a window smaller than the threshold is said once, not silently ignored', { timeoutMs: 20000 }, async ($, on) => {
  const log = await arrange(on as never, { tokens: 100_000, window: 200_000 })
  mock.clock(on, { now: 1_000_000 })
  await start($ as never)

  await turnComplete($ as never, 't1')
  await turnComplete($ as never, 't2')
  const warnings = log.toasts.filter(t => t.includes('below the 250k trigger'))
  expect(warnings.length, 'said once').toBe(1)
})

test('a cold cache is noticed when the person comes back, and their prompt returns to the box', { timeoutMs: 30000 }, async ($, on) => {
  const log = await arrange(on as never, { tokens: 120_000, pick: KEEP })
  const clock = mock.clock(on, { now: 1_000_000 })
  await start($ as never)

  await turnComplete($ as never, 't1')
  await clock.advance(6 * MINUTE)
  const back = await $.prompt.submit({ text: 'now fix the second bug' } as never)
  expect(back.drop, 'the prompt is held while they decide').toBeDefined()
  expect(log.asked[0]).toContain('went cold 6 min ago')
  expect(log.asked[0]).toContain('120k tokens')
  await clock.advance(10_000)

  expect(log.filled, 'what they typed is back in the box').toEqual(['now fix the second bug'])
  expect(log.events.includes('fork'), 'the handoff was written').toBe(true)
  expect(log.asked[1]).toContain('The prompt cache has gone cold.')
})

test('"Keep going" on a cold cache sends the prompt untouched and is not asked again for the same pause', { timeoutMs: 30000 }, async ($, on) => {
  const log = await arrange(on as never, { tokens: 120_000, coldPick: 'Keep going' })
  const clock = mock.clock(on, { now: 1_000_000 })
  await start($ as never)

  await turnComplete($ as never, 't1')
  await clock.advance(6 * MINUTE)
  const first = await $.prompt.submit({ text: 'carry on' } as never)
  expect(first.drop, 'goes through').toBeUndefined()
  expect(first.text).toBe('carry on')

  const second = await $.prompt.submit({ text: 'and again' } as never)
  expect(second.drop).toBeUndefined()
  expect(log.asked.length, 'asked once').toBe(1)
  expect(log.events.includes('fork')).toBe(false)
})

test('a warm cache or a small chat is never interrupted', { timeoutMs: 30000 }, async ($, on) => {
  const log = await arrange(on as never, { tokens: 120_000 })
  const clock = mock.clock(on, { now: 1_000_000 })
  await start($ as never)

  await turnComplete($ as never, 't1')
  await clock.advance(2 * MINUTE)
  const warm = await $.prompt.submit({ text: 'quick follow up' } as never)
  expect(warm.drop, 'two minutes: still warm').toBeUndefined()

  log.tokens = 20_000
  await turnComplete($ as never, 't2')
  await clock.advance(10 * MINUTE)
  const small = await $.prompt.submit({ text: 'another thing' } as never)
  expect(small.drop, 'a 20k chat costs little to re-read').toBeUndefined()
  expect(log.asked).toEqual([])
})

test('the cold-cache wait is a setting, and 0 turns it off', { timeoutMs: 20000, options: { coldMinutes: 0 } }, async ($, on) => {
  const log = await arrange(on as never, { tokens: 120_000 })
  const clock = mock.clock(on, { now: 1_000_000 })
  await start($ as never)

  await turnComplete($ as never, 't1')
  await clock.advance(60 * MINUTE)
  const back = await $.prompt.submit({ text: 'hello again' } as never)
  expect(back.drop).toBeUndefined()
  expect(log.asked).toEqual([])
})

test('if /clear cannot run, the handoff goes to the clipboard and the person is told how to continue', { timeoutMs: 20000 }, async ($, on) => {
  const log = await arrange(on as never, { clearFails: true })
  const clock = mock.clock(on, { now: 1_000_000 })
  await start($ as never)

  await $.prompt.submit({ text: 'sess-handoff' } as never)
  await clock.advance(10_000)
  expect(log.copied, 'nothing is lost').toEqual([HANDOFF])
  expect(log.submitted, 'no seed went to a chat that was not cleared').toEqual([])
  expect(log.toasts.at(-1)).toContain('run /clear and paste it')
})

test('nothing to hand off before the first turn finishes', { timeoutMs: 20000 }, async ($, on) => {
  const log = await arrange(on as never, { forkReason: 'nothing-to-fork' })
  const clock = mock.clock(on, { now: 1_000_000 })
  await start($ as never)

  await $.prompt.submit({ text: 'sess-handoff' } as never)
  await clock.advance(10_000)
  expect(log.events, 'no file, no question').toEqual(['fork'])
  expect(log.toasts.at(-1)).toContain('Nothing to hand off yet')
})

test('prompts the mod did not see typed, and slash commands, pass through', { timeoutMs: 20000 }, async ($, on) => {
  const log = await arrange(on as never)
  mock.clock(on, { now: 1_000_000 })
  await start($ as never)

  const other = await $.prompt.submit({ text: 'please summarise sess-handoff for me' } as never)
  expect(other.drop, 'only the bare keyword counts').toBeUndefined()
  expect(log.events).toEqual(['submit'])
})

test('the first reply in a chat a handoff opened does not trigger another handoff', { timeoutMs: 30000 }, async ($, on) => {
  const log = await arrange(on as never, { tokens: 260_000 })
  const clock = mock.clock(on, { now: 1_000_000 })
  await start($ as never)

  await turnComplete($ as never, 't1')
  await clock.advance(10_000)
  expect(log.events, 'the handoff ran and a fresh chat was opened').toEqual(['fork', 'write', 'ask', 'run:clear', 'submit'])

  log.events.length = 0
  await turnComplete($ as never, 't2')
  await clock.advance(10_000)
  expect(log.events, 'the seeded chat is not handed off again at once').toEqual([])
})

test('a trigger below 50k is raised to 50k, because a fresh chat starts near 30k', { timeoutMs: 20000, options: { tokenThreshold: 1000 } }, async ($, on) => {
  const log = await arrange(on as never, { tokens: 30_000 })
  const clock = mock.clock(on, { now: 1_000_000 })
  await start($ as never)

  await turnComplete($ as never, 't1')
  await clock.advance(10_000)
  expect(log.events).toEqual([])

  log.tokens = 50_000
  await turnComplete($ as never, 't2')
  await clock.advance(10_000)
  expect(log.events.includes('fork')).toBe(true)
})
