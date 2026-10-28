import { expect, mock, test } from 'claude-code/testing'

const MESSY = `${Array.from({ length: 70 }, (_, i) => `word${i}`).join(' ')} make the signup page nicer`

const GAPS = JSON.stringify({
  clear: false,
  questions: [
    { question: 'Who is the page for?', options: ['New customers', 'Admins'], default: 'Admins' },
    { question: 'What must not change?', options: ['The logo', 'The form fields', 'Nothing'], default: 'The logo' },
    { question: 'Which browsers count?', options: ['Chrome only', 'All of them'], default: 'All of them' },
  ],
})

const BRIEF = `## The job
Improve the signup page.

## The why
New customers should finish signing up.

## The guardrails
- Keep the form fields.

## Done means
- The page looks cleaner on a phone.

## Assumptions
- The current design system stays.`

type Setup = { gaps?: string; brief?: string; filled?: boolean; refusal?: 'no_composer'; answer?: string; dismiss?: boolean }

async function arrange($: never, on: never, setup: Setup = {}) {
  const log = {
    calls: [] as string[],
    asked: [] as string[],
    options: [] as string[][],
    briefInput: '',
    filled: [] as string[],
    submitted: [] as string[],
  }
  const run = on as (...args: unknown[]) => void
  run('session.start', async (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  run('model.complete', async (_: unknown, e: { system?: string; prompt?: string }) => {
    const isGaps = String(e.system).includes('prepare a messy request')
    log.calls.push(isGaps ? 'gaps' : 'brief')
    if (!isGaps) log.briefInput = String(e.prompt)
    const text = isGaps ? (setup.gaps ?? GAPS) : (setup.brief ?? BRIEF)
    return { value: { isAnswered: true, text, usage: { input_tokens: 1, output_tokens: 1 } } }
  })
  run(
    'tool.call',
    { tool: 'AskUserQuestion' },
    async (_: unknown, e: { questions: { question: string; options: { label: string }[] }[] }) => {
      const first = e.questions[0]
      const question = first?.question ?? ''
      const labels = (first?.options ?? []).map(o => o.label)
      log.asked.push(question)
      log.options.push(labels)
      if (setup.dismiss) return { deny: 'dismissed' }
      const isConfirm = question.startsWith('Send this brief?')
      const answer = setup.answer ?? (isConfirm ? 'Send the brief' : (labels[0] ?? ''))
      return { result: { questions: e.questions, answers: { [question]: answer } } }
    },
  )
  run('prompt.fill', async (_: unknown, e: { text: string }) => {
    log.filled.push(e.text)
    return setup.filled === false ? { isFilled: false, refusal: setup.refusal } : { isFilled: true }
  })
  run('prompt.submit', async (_: unknown, e: { text: string }) => {
    log.submitted.push(e.text)
    return { text: e.text }
  })
  run('ui.toast', async () => ({ value: undefined }))
  run('ui.status', async () => ({ value: undefined }))
  run('ui.log', async () => ({ value: undefined }))
  run('ui.copy', async () => ({ value: { isCopied: true } }))
  return log
}

async function start($: never, surface: 'terminal' | 'desktop') {
  const run = $ as { session: { start: (a: unknown) => Promise<unknown> } }
  await run.session.start({ source: 'startup', cwd: '/work', surface, isInteractive: true })
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`a long messy prompt is held, questioned and filled in as a brief with working rules (${surface})`, { timeoutMs: 20000 }, async ($, on) => {
    const log = await arrange($ as never, on as never)
    const clock = mock.clock(on, { now: 1 })
    await start($ as never, surface)

    const result = await $.prompt.submit({ text: MESSY } as never)
    expect(result.drop, 'the messy prompt is held back').toBeDefined()
    await clock.settle()

    expect(log.calls, 'one call for the gaps, one for the brief').toEqual(['gaps', 'brief'])
    expect(log.asked, 'each gap is asked, three at most by default').toEqual(['Who is the page for?', 'What must not change?', 'Which browsers count?'])
    expect(log.options[0], 'the default comes first and is marked').toEqual(['Admins (default)', 'New customers'])
    expect(log.briefInput, 'an accepted default is passed on as one').toContain('A: Admins (default)')

    const box = log.filled[0] ?? ''
    expect(log.filled.length, 'the box is filled once').toBe(1)
    expect(box.startsWith(BRIEF), 'the brief leads').toBe(true)
    expect(box, 'then the working rules').toContain('## How to work')
    expect(box, 'restate and say what a bare go does').toContain('say exactly what you will do if I reply with just "go"')
    expect(box, 'questions only when they change the outcome, with a default').toContain('give each one a default')
    expect(box, 'ends with what was not done').toContain('"Not done" list')
    expect(box, 'outward actions stop at a draft').toContain('Stop at a draft and show it to me first')
    expect(log.submitted, 'nothing reached Claude').toEqual([])
  })
}

test('the question limit and the working rules are settings', { timeoutMs: 20000, options: { maxQuestions: 1, workingRules: false } }, async ($, on) => {
  const log = await arrange($ as never, on as never)
  const clock = mock.clock(on, { now: 1 })
  await start($ as never, 'terminal')

  await $.prompt.submit({ text: MESSY } as never)
  await clock.settle()
  expect(log.asked, 'only one question').toEqual(['Who is the page for?'])
  expect(log.filled, 'no working rules, the brief alone').toEqual([BRIEF])
})

test('a limit of 0 never asks and skips the gap call', { timeoutMs: 20000, options: { maxQuestions: 0 } }, async ($, on) => {
  const log = await arrange($ as never, on as never)
  const clock = mock.clock(on, { now: 1 })
  await start($ as never, 'terminal')

  await $.prompt.submit({ text: MESSY } as never)
  await clock.settle()
  expect(log.asked).toEqual([])
  expect(log.calls, 'only the brief is written').toEqual(['brief'])
  expect((log.filled[0] ?? '').startsWith(BRIEF)).toBe(true)
})

test('short prompts, commands and the >> prefix are sent as typed', { timeoutMs: 20000 }, async ($, on) => {
  const log = await arrange($ as never, on as never)
  mock.clock(on, { now: 1 })
  await start($ as never, 'terminal')

  const short = await $.prompt.submit({ text: 'fix the typo in the readme' } as never)
  expect(short.drop, 'a short prompt passes').toBeUndefined()

  const bypass = await $.prompt.submit({ text: `>> ${MESSY}` } as never)
  expect(bypass.drop, 'the prefix lets a long prompt through').toBeUndefined()
  expect(bypass.text, 'the prefix is removed').toBe(MESSY)

  const shaped = await $.prompt.submit({ text: BRIEF } as never)
  expect(shaped.drop, 'a finished brief is not shaped again').toBeUndefined()
  expect(log.calls, 'the model was never called').toEqual([])
})

test('dismissing a question gives the prompt back in the box', { timeoutMs: 20000 }, async ($, on) => {
  const log = await arrange($ as never, on as never, { dismiss: true })
  const clock = mock.clock(on, { now: 1 })
  await start($ as never, 'terminal')

  const result = await $.prompt.submit({ text: MESSY } as never)
  expect(result.drop).toBeDefined()
  await clock.settle()
  expect(log.filled, 'the original is back').toEqual([MESSY])
  expect(log.calls, 'no brief was written').toEqual(['gaps'])
})

test('a prompt that is already clear comes back and then goes through once', { timeoutMs: 20000 }, async ($, on) => {
  const log = await arrange($ as never, on as never, { gaps: '{"clear": true, "questions": []}' })
  const clock = mock.clock(on, { now: 1 })
  await start($ as never, 'terminal')

  const first = await $.prompt.submit({ text: MESSY } as never)
  expect(first.drop).toBeDefined()
  await clock.settle()
  expect(log.filled, 'the original is back').toEqual([MESSY])

  const again = await $.prompt.submit({ text: MESSY } as never)
  expect(again.drop, 'the same text goes through on the second Enter').toBeUndefined()
})

test('a reply that is not in parts gives the prompt back', { timeoutMs: 20000 }, async ($, on) => {
  const log = await arrange($ as never, on as never, { brief: 'Sure! Here you go.' })
  const clock = mock.clock(on, { now: 1 })
  await start($ as never, 'terminal')

  await $.prompt.submit({ text: MESSY } as never)
  await clock.settle()
  expect(log.filled, 'only the original is put back').toEqual([MESSY])
})

test('with no prompt box the brief is confirmed in a dialog', { timeoutMs: 20000 }, async ($, on) => {
  const log = await arrange($ as never, on as never, { filled: false, refusal: 'no_composer' })
  const clock = mock.clock(on, { now: 1 })
  await start($ as never, 'desktop')

  await $.prompt.submit({ text: MESSY } as never)
  await clock.settle()
  expect(log.asked.at(-1), 'a confirm dialog shows the brief').toContain('Send this brief?')
  const sent = log.submitted.at(-1) ?? ''
  expect(sent.startsWith(BRIEF), 'the confirmed brief is sent').toBe(true)
  expect(sent, 'with its working rules').toContain('## How to work')
})
