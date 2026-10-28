import type { EngineInterface, Register } from 'claude-code'

// Switch Mods: /amods opens a pane with one row per installed plugin and an
// On/Off button on each. A button writes enabledPlugins in the user's own
// settings.json, the key `claude plugin enable|disable` and /plugin write, so it
// works for every plugin with nothing asked of it. Claude Code reads the change
// when plugins reload: Apply runs /reload-plugins.
// Only Box, Text and Button are drawn, the three every surface carries
// (terminal, desktop, vscode, mobile).

const PANE = 'switch-mods'
const TITLE = 'Mods'
const SELF = 'switch-mods'
const SCAN_MS = 5000
const CACHE_MS = 3000
const BUTTON_COLS = 8
const GOOD = '#16a34a'

type Row = {
  id: string
  name: string
  market: string
  version: string
  what: string
  enabled: boolean
  // Installed at the user scope, so the user's settings.json owns its switch.
  canToggle: boolean
  isSelf: boolean
}

// Module variables start over on a reload; the switches live in settings.json.
let note = ''
let pending = 0
let cache: { at: number; rows: Row[] } | null = null
let configDir = ''

function cut(s: string, n: number) {
  if (n <= 0) return ''
  return s.length <= n ? s : `${s.slice(0, Math.max(0, n - 1))}…`
}

const slashes = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '')

async function attempt(get: Promise<string | undefined>) {
  try {
    return ((await get) ?? '').trim()
  } catch {
    return ''
  }
}

// Claude Code's config folder: CLAUDE_CONFIG_DIR, else the .claude this plugin
// is installed under, else the home folder's.
async function configDirOf($: EngineInterface) {
  if (configDir) return configDir
  let dir = await attempt($.env.get('CLAUDE_CONFIG_DIR'))
  if (!dir) {
    const under = /^(.*?)[\\/]\.claude[\\/]/.exec(`${$.plugin.root}/`)
    if (under?.[1]) dir = `${under[1]}/.claude`
  }
  if (!dir) {
    const home = (await attempt($.env.get('HOME'))) || (await attempt($.env.get('USERPROFILE')))
    if (home) dir = `${home}/.claude`
  }
  configDir = slashes(dir)
  return configDir
}

// The JSON object in a file: {} when there is no file, null when it is not an object.
async function readObject($: EngineInterface, path: string): Promise<Record<string, unknown> | null> {
  try {
    if (!(await $.fs.exists(path))) return {}
    const json = JSON.parse(String(await $.fs.read(path))) as unknown
    return json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function flags(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

async function describe($: EngineInterface, installPath: unknown) {
  if (typeof installPath !== 'string' || !installPath) return ''
  const manifest = await readObject($, `${slashes(installPath)}/.claude-plugin/plugin.json`)
  return typeof manifest?.description === 'string' ? manifest.description : ''
}

async function scan($: EngineInterface): Promise<Row[]> {
  const dir = await configDirOf($)
  const installed = flags((await readObject($, `${dir}/plugins/installed_plugins.json`))?.plugins)
  const user = flags((await readObject($, `${dir}/settings.json`))?.enabledPlugins)
  let merged: Record<string, unknown> = {}
  try {
    merged = flags(await $.settings.read({ key: 'enabledPlugins' }))
  } catch {
    merged = {}
  }
  const rows: Row[] = []
  for (const [id, value] of Object.entries(installed)) {
    const entries = (Array.isArray(value) ? value : [value]).map(flags)
    const canToggle = entries.some(x => x.scope === 'user')
    const source = canToggle && id in user ? user : merged
    const first = entries.find(x => typeof x.installPath === 'string') ?? {}
    const at = id.lastIndexOf('@')
    const name = at > 0 ? id.slice(0, at) : id
    rows.push({
      id,
      name,
      market: at > 0 ? id.slice(at + 1) : '',
      version: typeof first.version === 'string' ? first.version : '',
      what: await describe($, first.installPath),
      enabled: source[id] === true,
      canToggle,
      isSelf: name === SELF,
    })
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

// The scan is kept for a few seconds, so drawing stays quick.
async function getRows($: EngineInterface, force = false) {
  const now = await $.clock.now()
  if (!force && cache && now - cache.at < CACHE_MS) return cache.rows
  const rows = await scan($)
  cache = { at: now, rows }
  return rows
}

const sigOf = (rows: readonly Row[]) => rows.map(r => `${r.id}|${r.version}|${r.enabled}|${r.canToggle}|${r.what}`).join('\n')

// While the pane is open, look again and redraw when something changed outside it
// (a plugin installed or removed, a switch flipped from /plugin or another chat).
async function poll($: EngineInterface) {
  let open = false
  try {
    open = (await $.ui.panes()).some(p => p.id === PANE)
  } catch {
    open = false
  }
  if (!open) return
  const before = sigOf(cache?.rows ?? [])
  const rows = await getRows($, true)
  if (sigOf(rows) !== before) $.ui.invalidate('ui.render')
}

// Read, change one key, write the whole file back; every other setting stays.
async function setEnabled($: EngineInterface, id: string, enabled: boolean) {
  const path = `${await configDirOf($)}/settings.json`
  const settings = await readObject($, path)
  if (!settings) throw new Error('settings.json is not valid JSON, left untouched')
  const next = { ...settings, enabledPlugins: { ...flags(settings.enabledPlugins), [id]: enabled } }
  await $.fs.write(path, `${JSON.stringify(next, null, 2)}\n`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      cache = null
      await $.command.register({
        name: 'amods',
        description: 'Open the Mods panel: switch each installed plugin on or off',
        immediate: true,
      })
      $.clock.every(SCAN_MS, () => {
        void poll($).catch(() => undefined)
      })
    } catch (err) {
      // A name another command already holds is refused: say so, don't fail silently.
      const why = err instanceof Error ? err.message : String(err)
      $.ui.log(`switch-mods: could not register /amods: ${why}`)
      $.ui.toast('switch-mods: /amods is taken by another command, so the panel cannot open.')
    }
    return next(e)
  })

  on('command.run', { command: 'amods' }, async $ => {
    cache = null
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    return { text: opened.isPlaced ? 'Opened the Mods panel.' : 'The Mods panel is waiting for room. Widen the window.' }
  })

  // Presses are handled here, by the button's key, not in a closure that lives
  // for one drawing only.
  on('ui.press', { plugin: 'switch-mods', element: /^toggle:.+$/ }, async ($, e) => {
    const id = e.element.slice('toggle:'.length)
    const row = (await getRows($)).find(r => r.id === id)
    if (!row || !row.canToggle || row.isSelf) return { element: e.element }
    try {
      await setEnabled($, row.id, !row.enabled)
      pending += 1
      note = `${row.name} is ${row.enabled ? 'off' : 'on'}. Apply to use it in this chat.`
    } catch (err) {
      note = `Could not change ${row.name}: ${err instanceof Error ? err.message : String(err)}`
    }
    cache = null
    $.ui.invalidate('ui.render')
    return { element: e.element }
  })

  on('ui.press', { plugin: 'switch-mods', element: 'apply' }, async ($, e) => {
    try {
      await $.command.run({ command: 'reload-plugins' })
      pending = 0
      note = 'Applied.'
    } catch {
      note = 'Could not reload here. Type /reload-plugins.'
    }
    cache = null
    $.ui.invalidate('ui.render')
    return { element: e.element }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const noop = () => undefined
    const cols = Math.max(24, e.props.bodyColumns)
    const left = Math.max(10, cols - BUTTON_COLS)

    let list: Row[] = []
    try {
      list = await getRows($)
    } catch {
      list = []
    }
    const onCount = list.filter(r => r.enabled).length

    const rows = list.map(r => {
      const locked = !r.canToggle || r.isSelf
      const why = r.isSelf ? 'This panel stays on.' : !r.canToggle ? 'Installed for a project. Use /plugin.' : ''
      return (
        <Box key={`row-${r.id}`} flexDirection="row" justifyContent="space-between" gap={1} marginTop={1}>
          <Box flexDirection="column" width={left}>
            <Text bold dimColor={!r.enabled} wrap="truncate-end">
              {cut(r.name, left)}
            </Text>
            <Text dimColor wrap="truncate-end">
              {cut(`${r.market}${r.version ? ` · ${r.version}` : ''}`, left)}
            </Text>
            {r.what ? (
              <Text dimColor wrap="truncate-end">
                {cut(r.what, left)}
              </Text>
            ) : null}
            {why ? (
              <Text dimColor italic wrap="truncate-end">
                {cut(why, left)}
              </Text>
            ) : null}
          </Box>
          {locked ? (
            <Text dimColor>{r.enabled ? 'On' : 'Off'}</Text>
          ) : (
            <Button key={`toggle:${r.id}`} onPress={noop}>
              {r.enabled ? <Text color={GOOD}>On</Text> : <Text dimColor>Off</Text>}
            </Button>
          )}
        </Box>
      )
    })

    return (
      <Box flexDirection="column" width={cols}>
        <Text bold>
          {list.length === 0 ? 'No installed mods found.' : `${onCount} of ${list.length} on`}
        </Text>
        {rows}
        <Box marginTop={1} flexDirection="column">
          {note ? (
            <Text color={GOOD} wrap="wrap">
              {note}
            </Text>
          ) : null}
          <Box marginTop={1}>
            <Button key="apply" variant={pending > 0 ? 'primary' : 'secondary'} onPress={noop}>
              {pending > 0 ? `Apply ${pending} change${pending === 1 ? '' : 's'}` : 'Reload mods'}
            </Button>
          </Box>
          <Text dimColor wrap="wrap">
            Switches are saved at once. Apply reloads mods in this chat; other chats pick them up when they reload.
          </Text>
        </Box>
      </Box>
    )
  })
}
