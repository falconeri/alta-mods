import type { EngineInterface, Register } from 'claude-code'

// Sess Handoff: writes a detailed handoff prompt of the whole chat, then (only
// after the person confirms) opens a fresh chat seeded with it.
// Triggers: the context reaching tokenThreshold (checked when a turn ends), a cold
// prompt cache (checked when the person comes back and sends a prompt), and the
// words `sess-handoff` (or /sess-handoff).
//   1. Wait until Claude and every subagent are idle. A handoff never cuts a run
//      short: it queues, polls, and writes only once nothing has run for a moment.
//   2. The model writes the handoff over its own transcript ($.model.fork), so it
//      sees the whole chat, not the last 4096 messages.
//   3. It is saved as a .md file, then the person is asked: start a fresh chat with
//      it, copy it for a teammate, both, or keep this chat.
//   4. Starting fresh runs /clear and submits the handoff as the first message.
// Nothing is ever sent anywhere: "for a teammate" means the clipboard and the file.

const KEYWORD = 'sess-handoff'
const DEFAULT_TOKENS = 250_000
// A fresh chat already starts near 30k tokens; a lower trigger would fire at once, every time.
const MIN_TOKENS = 50_000
const DEFAULT_COLD_MINUTES = 5
const DEFAULT_COLD_TOKENS = 50_000
const POLL_MS = 2_000
// Quiet this long, with no new turn, before writing: a finished subagent's result
// reaches Claude as a new turn a moment after the agent reports done.
const SETTLE_MS = 3_000
const PREVIEW_CHARS = 900
// An agent in one of these states is still working or waiting on something.
const ACTIVE = new Set(['pending', 'running', 'waiting'])

const START = 'Start a fresh chat with it'
const COPY = 'Copy it for a teammate'
const BOTH = 'Both'
const KEEP = 'Keep this chat'
const WRITE_FIRST = 'Write a handoff first'

const HANDOFF_PROMPT = `Write a handoff prompt so a fresh Claude session can continue this work with no memory of this chat. Cover the whole conversation from its first message, not just the last few turns. Do not call any tools. Output only the handoff, in markdown, starting with the line "# Handoff".

Use these sections, in this order:

## Goal
What the user wants and why, in their terms.

## Rules and preferences
Instructions the user gave about how to work (style, things never to do, what to confirm first). Quote the wording exactly where it matters.

## State now
What is done, what is half done, what is not started. Exact file paths, commands, branch names, versions and settings.

## Decisions and why
Choices made, options rejected, and the reason for each.

## Subagents and orchestration
Every agent that ran: its task, what it returned, and what is still unfinished or unmerged. Say which pipeline stage was reached. Write "None." if no subagent ran.

## Open questions and risks
Unknowns, things not verified, and known failures with the exact error text.

## Next steps
Ordered. The first one must be concrete enough to start at once.

## Waiting on the user
Anything the user asked or was asked that has no answer yet. Write "None." if nothing.

Be specific rather than short, but add no padding. Never include secrets, tokens or credentials. Write for a reader who cannot see this chat.`

type Reason = 'tokens' | 'cold' | 'command'

// Module variables start over on a reload.
let running = false
let cancelled = false
let mainBusy = false
let turnSeq = 0
let lastResponseAt = 0
let offeredTokens = false
let warnedWindow = false
let declinedColdAt = 0
// Set when a handoff opened this chat: its first reply is not a reason for another.
let skipTokenCheck = false

const kilo = (n: number) => `${Math.round(n / 1000)}k`

async function activeAgents($: EngineInterface) {
  return (await $.agent.list()).filter(a => ACTIVE.has(a.status))
}

// Resolves true once Claude and every subagent have been idle for SETTLE_MS with no
// new turn in between; false if the person cancelled while it waited.
async function waitUntilQuiet($: EngineInterface) {
  for (;;) {
    if (cancelled) return false
    const seen = turnSeq
    const agents = await activeAgents($)
    if (!mainBusy && agents.length === 0) {
      $.ui.status('Handoff: settling…')
      await $.clock.sleep(SETTLE_MS)
      if (cancelled) return false
      if (seen === turnSeq && !mainBusy && (await activeAgents($)).length === 0) return true
      continue
    }
    $.ui.status(
      agents.length > 0
        ? `Handoff waiting for ${agents.length} agent${agents.length === 1 ? '' : 's'} to finish…`
        : 'Handoff waiting for Claude to finish this turn…',
    )
    await $.clock.sleep(POLL_MS)
  }
}

async function writeHandoff($: EngineInterface) {
  const reply = await $.model.fork({ prompt: HANDOFF_PROMPT })
  if (!reply.isAnswered) {
    $.ui.toast(reply.reason === 'nothing-to-fork' ? 'Nothing to hand off yet: no turn has finished.' : `Could not write the handoff (${reply.reason}).`)
    return ''
  }
  const text = reply.text.trim()
  if (!text) $.ui.toast('The model returned an empty handoff.')
  return text
}

// Saves the handoff as a .md file; '' when it cannot be saved (the text still goes on).
async function save($: EngineInterface, text: string, folderSetting: unknown) {
  try {
    let folder = typeof folderSetting === 'string' ? folderSetting.trim() : ''
    if (!folder) {
      const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
      if (!home) return ''
      folder = `${home}/.claude/handoffs`
    }
    const stamp = new Date(await $.clock.now()).toISOString().slice(0, 16).replace(/[:T]/g, '-')
    const path = `${folder.replace(/[\\/]+$/, '')}/handoff-${stamp}-${(await $.session.id()).slice(0, 8)}.md`
    await $.fs.write(path, `${text}\n`)
    return path
  } catch (err) {
    $.ui.log(`sess-handoff: could not save the handoff (${err instanceof Error ? err.message : String(err)})`, { to: 'debug' })
    return ''
  }
}

async function copyOut($: EngineInterface, text: string, path: string) {
  const copy = await $.ui.copy({ text })
  const where = path ? ` Also saved at ${path}.` : ''
  $.ui.toast(copy.isCopied ? `Handoff copied. Paste it to your teammate.${where}` : `Could not reach the clipboard.${path ? ` The handoff is saved at ${path}.` : ''}`, { timeoutMs: 10_000 })
}

async function startFresh($: EngineInterface, text: string, path: string) {
  try {
    await $.command.run({ command: 'clear' })
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err)
    const copy = await $.ui.copy({ text })
    $.ui.toast(`Could not open a fresh chat (${why}). The handoff is ${copy.isCopied ? 'on your clipboard' : path ? `saved at ${path}` : 'lost'}: run /clear and paste it.`, { timeoutMs: 12_000 })
    return
  }
  skipTokenCheck = true
  const saved = path ? ` (also saved at ${path})` : ''
  const seed = `This chat continues earlier work. The handoff below was written by the previous session${saved}. Read it, then say in a few lines what you understand the state to be and what you will do next, and wait for my reply before changing anything.\n\n${text}`
  await $.prompt.submit({ text: seed, asUser: true })
}

async function offer($: EngineInterface, reason: Reason, text: string, path: string) {
  const preview = text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text
  const why = reason === 'tokens' ? 'The conversation is getting long.' : reason === 'cold' ? 'The prompt cache has gone cold.' : 'You asked for a handoff.'
  const question = `${why} Handoff written (${text.length} characters${path ? `, saved at ${path}` : ''}).\n\n${preview}\n\nStart a fresh chat with it?`
  let pick = KEEP
  try {
    pick = await $.ui.ask(question, { options: [START, COPY, BOTH, KEEP], header: 'Handoff' })
  } catch {
    pick = KEEP
  }
  if (pick === COPY || pick === BOTH) await copyOut($, text, path)
  if (pick === START || pick === BOTH) {
    await startFresh($, text, path)
  } else if (pick !== COPY) {
    $.ui.toast(path ? `Handoff kept at ${path}.` : 'Handoff not kept: it could not be saved.', { timeoutMs: 8_000 })
  }
}

// Gives the person back the prompt they typed, which a cold-cache handoff held.
async function giveBack($: EngineInterface, held: string) {
  const box = await $.prompt.fill({ text: held })
  if (box.isFilled) return
  await $.ui.copy({ text: held })
  $.ui.toast('Your prompt is on the clipboard. Paste it when you are ready.')
}

async function runHandoff($: EngineInterface, reason: Reason, folderSetting: unknown, held = '') {
  if (running) return
  running = true
  cancelled = false
  try {
    if (!(await waitUntilQuiet($))) {
      if (held) await giveBack($, held)
      $.ui.toast('Handoff cancelled.')
      return
    }
    $.ui.status('Writing the handoff…')
    const text = await writeHandoff($)
    if (held) await giveBack($, held)
    if (!text) return
    const path = await save($, text, folderSetting)
    $.ui.status(undefined)
    await offer($, reason, text, path)
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err)
    $.ui.log(`sess-handoff: ${why}`, { to: 'debug' })
    if (held) await giveBack($, held).catch(() => undefined)
    $.ui.toast(`Handoff failed (${why}).`)
  } finally {
    running = false
    $.ui.status(undefined)
  }
}

// Starts a handoff in the background; the caller answers at once.
function begin($: EngineInterface, reason: Reason, folderSetting: unknown, held = '') {
  void runHandoff($, reason, folderSetting, held).catch(() => undefined)
}

export const register: Register = (on, options) => {
  const asked = (value: unknown, fallback: number) => {
    const n = Number(value)
    return Number.isFinite(n) && n >= 0 ? n : fallback
  }
  const wanted = asked(options.tokenThreshold, DEFAULT_TOKENS)
  const tokenThreshold = wanted === 0 ? 0 : Math.max(wanted, MIN_TOKENS)
  const coldMs = asked(options.coldMinutes, DEFAULT_COLD_MINUTES) * 60_000
  const coldMinTokens = asked(options.coldMinTokens, DEFAULT_COLD_TOKENS)
  const folderSetting = options.folder

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: KEYWORD, description: 'Write a handoff of this chat; ask before opening a fresh chat with it. Add "cancel" to stop a queued one.' })
    return next(e)
  })

  // A new conversation (a /clear): the old one's clock and offers do not carry over.
  on('session.end', ($, e, next) => {
    lastResponseAt = 0
    offeredTokens = false
    warnedWindow = false
    declinedColdAt = 0
    mainBusy = false
    return next(e)
  })

  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined) {
      mainBusy = true
      turnSeq++
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    mainBusy = false
    lastResponseAt = await $.clock.now()
    const justOpened = skipTokenCheck
    skipTokenCheck = false
    if (tokenThreshold > 0 && !running && !justOpened) {
      try {
        const { context } = await $.session.usage()
        if (context.window < tokenThreshold && !warnedWindow) {
          warnedWindow = true
          $.ui.toast(`sess-handoff: this model's window (${kilo(context.window)}) is below the ${kilo(tokenThreshold)} trigger, so it fires only on a cold cache or when you type ${KEYWORD}.`, { timeoutMs: 10_000 })
        }
        if (!offeredTokens && (context.tokens ?? 0) >= tokenThreshold) {
          offeredTokens = true
          $.ui.toast(`Context reached ${kilo(context.tokens ?? 0)} tokens. Writing a handoff once every agent is done.`, { timeoutMs: 6_000 })
          begin($, 'tokens', folderSetting)
        }
      } catch (err) {
        $.ui.log(`sess-handoff: could not read the context size (${err instanceof Error ? err.message : String(err)})`, { to: 'debug' })
      }
    }
    return result
  })

  on('command.run', { command: KEYWORD }, ($, e) => {
    if ((e.args ?? '').trim().toLowerCase() === 'cancel') {
      cancelled = true
      return { text: running ? 'Cancelling the queued handoff.' : 'No handoff is queued.' }
    }
    if (running) return { text: 'A handoff is already in progress.' }
    begin($, 'command', folderSetting)
    return { text: 'Writing a handoff. It starts once every agent is done, then asks before opening a fresh chat.' }
  })

  on('prompt.submit', async ($, e, next) => {
    // Only what the person typed at the prompt box, as plain text.
    const from = e.origin?.kind
    if ((from && from !== 'composer') || e.command || e.isMeta || e.attachments?.length) return next(e)

    const typed = e.text.trim().toLowerCase()
    if (typed === KEYWORD) {
      if (running) return { drop: 'A handoff is already in progress.' }
      begin($, 'command', folderSetting)
      return { drop: 'Writing a handoff. It starts once every agent is done, then asks before opening a fresh chat.' }
    }
    if (typed === `${KEYWORD} cancel`) {
      cancelled = true
      return { drop: running ? 'Cancelling the queued handoff.' : 'No handoff is queued.' }
    }

    // The person is back after a pause: their next message would re-read the whole
    // conversation uncached. A prompt typed over a running turn found the cache warm.
    if (coldMs <= 0 || e.turnId || running || !typed || lastResponseAt === 0 || lastResponseAt === declinedColdAt) return next(e)
    const idle = (await $.clock.now()) - lastResponseAt
    if (idle < coldMs) return next(e)
    let tokens = 0
    try {
      tokens = (await $.session.usage()).context.tokens ?? 0
    } catch {
      return next(e)
    }
    if (tokens < coldMinTokens) return next(e)
    let pick = ''
    try {
      pick = await $.ui.ask(`The prompt cache went cold ${Math.round(idle / 60_000)} min ago. Sending this re-reads ${kilo(tokens)} tokens at full price. Write a handoff first, so you can continue in a fresh chat instead?`, {
        options: [WRITE_FIRST, 'Keep going'],
        header: 'Cache cold',
      })
    } catch {
      pick = ''
    }
    if (pick !== WRITE_FIRST) {
      declinedColdAt = lastResponseAt
      return next(e)
    }
    begin($, 'cold', folderSetting, e.text)
    return { drop: 'Writing a handoff first. Your prompt comes back in the box.' }
  })
}
