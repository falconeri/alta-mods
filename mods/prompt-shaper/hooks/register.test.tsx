import { expect, mock, test } from 'claude-code/testing'

const MESSY = 'ok so the signup page feels old, make it nicer but keep the form fields'

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

type Setup = { other?: boolean; typed?: string; gaps?: string; brief?: string; filled?: boolean; refusal?: 'no_composer'; answer?: string; dismiss?: boolean }

async function arrange($: never, on: never, setup: Setup = {}) {
  const log = {
    calls: [] as string[],
    asked: [] as string[],
    options: [] as string[][],
    briefInput: '',
    filled: [] as string[],
    submitted: [] as string[],
    toasts: [] as string[],
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
  // Nothing beneath the mod stands for the engine: an empty band, or another mod's.
  run('ui.render', ($: { ui: { resolve: (e: unknown) => any } }, e: unknown) => {
    const { Box, Text } = $.ui.resolve(e)
    return setup.other ? <Text>vitals band</Text> : <Box />
  })
  run('prompt.read', async () => ({ value: { text: setup.typed ?? MESSY, cursor: 0 } }))
  run('prompt.fill', async (_: unknown, e: { text: string }) => {
    log.filled.push(e.text)
    return setup.filled === false ? { isFilled: false, refusal: setup.refusal } : { isFilled: true }
  })
  run('prompt.submit', async (_: unknown, e: { text: string }) => {
    log.submitted.push(e.text)
    return { text: e.text }
  })
  run('ui.toast', async (_: unknown, e: { text: string }) => {
    log.toasts.push(e.text)
    return { value: undefined }
  })
  run('ui.status', async () => ({ value: undefined }))
  run('ui.log', async () => ({ value: undefined }))
  run('ui.copy', async () => ({ value: { isCopied: true } }))
  return log
}

async function start($: never, surface: 'terminal' | 'desktop') {
  const run = $ as { session: { start: (a: unknown) => Promise<unknown> } }
  await run.session.start({ source: 'startup', cwd: '/work', surface, isInteractive: true })
}

const BAND = {
  plugin: 'prompt-shaper',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 120, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const

const BUTTON = { type: 'Button', props: { label: 'Shape prompt' } } as const

// Mounts the band and presses the button, then lets every pending step finish.
async function press($: never, on: never, surface: 'terminal' | 'desktop' = 'terminal') {
  const clock = mock.clock(on, { now: 1 })
  await start($, surface)
  const ui = await ($ as { ui: { mount: (a: unknown) => Promise<any> } }).ui.mount({ ...BAND, surface })
  await ui.press({ key: 'shape' })
  await clock.settle()
  return ui
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`the button shapes what is in the box into a brief with working rules (${surface})`, { timeoutMs: 20000 }, async ($, on) => {
    const log = await arrange($ as never, on as never)
    const ui = await press($ as never, on as never, surface)

    expect(await ui.find(BUTTON), 'the button is there').toBeDefined()
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
    await ui.unmount()
  })
}

test('the question limit and the working rules are settings', { timeoutMs: 20000, options: { maxQuestions: 1, workingRules: false } }, async ($, on) => {
  const log = await arrange($ as never, on as never)
  const ui = await press($ as never, on as never)
  expect(log.asked, 'only one question').toEqual(['Who is the page for?'])
  expect(log.filled, 'no working rules, the brief alone').toEqual([BRIEF])
  await ui.unmount()
})

test('a limit of 0 never asks and skips the gap call', { timeoutMs: 20000, options: { maxQuestions: 0 } }, async ($, on) => {
  const log = await arrange($ as never, on as never)
  const ui = await press($ as never, on as never)
  expect(log.asked).toEqual([])
  expect(log.calls, 'only the brief is written').toEqual(['brief'])
  expect((log.filled[0] ?? '').startsWith(BRIEF)).toBe(true)
  await ui.unmount()
})

test('nothing is shaped until the button is pressed; Enter sends the prompt as typed', { timeoutMs: 20000 }, async ($, on) => {
  const log = await arrange($ as never, on as never)
  mock.clock(on, { now: 1 })
  await start($ as never, 'terminal')

  const long = `${Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ')} make the signup page nicer`
  const result = await $.prompt.submit({ text: long } as never)
  expect(result.drop, 'a long prompt is not held').toBeUndefined()
  expect(log.calls, 'the model was never called').toEqual([])
})

test('an empty box gets a hint instead of a shaping', { timeoutMs: 20000 }, async ($, on) => {
  const log = await arrange($ as never, on as never, { typed: '   ' })
  const ui = await press($ as never, on as never)
  expect(log.calls, 'no model call').toEqual([])
  expect(log.toasts.at(-1), 'says what to do').toContain('Type your prompt first')
  await ui.unmount()
})

test('a finished brief is not shaped again', { timeoutMs: 20000 }, async ($, on) => {
  const log = await arrange($ as never, on as never, { typed: BRIEF })
  const ui = await press($ as never, on as never)
  expect(log.calls).toEqual([])
  expect(log.toasts.at(-1)).toContain('already a brief')
  await ui.unmount()
})

test('dismissing a question leaves the prompt in the box untouched', { timeoutMs: 20000 }, async ($, on) => {
  const log = await arrange($ as never, on as never, { dismiss: true })
  const ui = await press($ as never, on as never)
  expect(log.filled, 'the box is never rewritten').toEqual([])
  expect(log.calls, 'no brief was written').toEqual(['gaps'])
  await ui.unmount()
})

test('a prompt that is already clear says so and leaves the box alone', { timeoutMs: 20000 }, async ($, on) => {
  const log = await arrange($ as never, on as never, { gaps: '{"clear": true, "questions": []}' })
  const ui = await press($ as never, on as never)
  expect(log.filled).toEqual([])
  expect(log.toasts.at(-1)).toContain('already clear')
  await ui.unmount()
})

test('a reply that is not in parts leaves the box alone', { timeoutMs: 20000 }, async ($, on) => {
  const log = await arrange($ as never, on as never, { brief: 'Sure! Here you go.' })
  const ui = await press($ as never, on as never)
  expect(log.filled).toEqual([])
  expect(log.toasts.at(-1)).toContain('Could not shape it')
  await ui.unmount()
})

test('with the box held by a dialog the brief goes to the clipboard', { timeoutMs: 20000 }, async ($, on) => {
  const log = await arrange($ as never, on as never, { filled: false, refusal: 'no_composer' })
  const ui = await press($ as never, on as never, 'desktop')
  expect(log.toasts.at(-1)).toContain('clipboard')
  await ui.unmount()
})

test('another mod band stays and the button stacks under it', { timeoutMs: 20000 }, async ($, on) => {
  await arrange($ as never, on as never, { other: true })
  mock.clock(on, { now: 1 })
  await start($ as never, 'terminal')

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /vitals band/ }), 'the other band is kept').toBeDefined()
  expect(await ui.find(BUTTON), 'the button is added').toBeDefined()
  await ui.unmount()
})
