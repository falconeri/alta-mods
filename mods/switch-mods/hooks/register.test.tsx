import { expect, mock, test } from 'claude-code/testing'

const props = { title: 'Mods', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as never

const CONFIG = '/home/test/.claude'

const installed = {
  version: 2,
  plugins: {
    'usage-limits@alta-mods': [{ scope: 'user', installPath: `${CONFIG}/plugins/cache/alta-mods/usage-limits/0.2.0`, version: '0.2.0' }],
    'switch-mods@alta-mods': [{ scope: 'user', installPath: `${CONFIG}/plugins/cache/alta-mods/switch-mods/0.1.0`, version: '0.1.0' }],
    'team-tool@work': [{ scope: 'project', installPath: `${CONFIG}/plugins/cache/work/team-tool/1.0.0`, version: '1.0.0' }],
  },
}

// The engine spells a path its own way on Windows (C:\home\test\...): files are
// kept under one spelling.
const spell = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
const pathOf = (e: unknown) => spell((e as { path: string }).path)

function mockFiles(on: Parameters<Parameters<typeof test>[2]>[1], files: Record<string, string>) {
  on('fs.exists', async (_, e) => ({ value: pathOf(e) in files }) as never)
  on('fs.read', async (_, e) => {
    const path = pathOf(e)
    if (!(path in files)) throw new Error(`ENOENT ${path}`)
    return { value: files[path] } as never
  })
  on('fs.write', async (_, e) => {
    files[pathOf(e)] = (e as { text: string }).text
    return { value: undefined } as never
  })
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`lists installed mods and switches one off and on (${surface})`, { timeoutMs: 20000 }, async ($, on) => {
    const files: Record<string, string> = {
      [`${CONFIG}/plugins/installed_plugins.json`]: JSON.stringify(installed),
      [`${CONFIG}/settings.json`]: JSON.stringify({ model: 'opus', enabledPlugins: { 'usage-limits@alta-mods': true, 'switch-mods@alta-mods': true } }),
      [`${CONFIG}/plugins/cache/alta-mods/usage-limits/0.2.0/.claude-plugin/plugin.json`]: JSON.stringify({ name: 'usage-limits', description: 'Usage band' }),
    }
    const opened: string[] = []
    const ran: string[] = []

    on('session.start', async (_, e) => ({ cwd: e.cwd }) as never)
    on('command.register', async () => ({ value: { command: 'amods' } }) as never)
    on('ui.open', async (_, e) => {
      opened.push((e as { id: string }).id)
      return { value: { isPlaced: true } } as never
    })
    on('settings.read', async () => ({ value: { enabledPlugins: { 'team-tool@work': true } } }) as never)
    on('command.run', async (_, e) => {
      ran.push((e as { command: string }).command)
      return { text: '' } as never
    })
    mockFiles(on, files)
    mock.clock(on, { now: new Date(2026, 9, 28, 12, 0).getTime() })
    mock.env(on, { CLAUDE_CONFIG_DIR: CONFIG })

    await $.session.start({ source: 'startup', cwd: '/work', surface, isInteractive: true } as never)
    await $.command.run({ command: 'amods', args: '' } as never)
    expect(opened, '/amods opens the pane').toContain('switch-mods')

    const v = await $.ui.mount({ plugin: 'switch-mods', surface, component: 'Pane', requestId: 'switch-mods', props })
    expect(await v.find({ text: '3 of 3 on' }), 'header counts mods that are on').toBeDefined()
    expect(await v.find({ text: 'usage-limits' }), 'a row per installed mod').toBeDefined()
    expect(await v.find({ text: 'Usage band' }), 'the mod description').toBeDefined()
    expect(await v.find({ key: 'toggle:usage-limits@alta-mods' }), 'user-scope mod has a switch').toBeDefined()
    expect(await v.find({ key: 'toggle:switch-mods@alta-mods' }), 'this panel has no switch').toBeUndefined()
    expect(await v.find({ key: 'toggle:team-tool@work' }), 'a project-scope mod has no switch').toBeUndefined()

    await v.press({ key: 'toggle:usage-limits@alta-mods' })
    const saved = JSON.parse(files[`${CONFIG}/settings.json`] ?? '{}')
    expect(saved.enabledPlugins['usage-limits@alta-mods'], 'switched off in settings.json').toBe(false)
    expect(saved.enabledPlugins['switch-mods@alta-mods'], 'other switches stay').toBe(true)
    expect(saved.model, 'other settings stay').toBe('opus')
    expect(await v.find({ text: /usage-limits is off/ }), 'note after the press').toBeDefined()
    expect(await v.find({ text: '2 of 3 on' }), 'header follows the switch').toBeDefined()

    await v.press({ key: 'toggle:usage-limits@alta-mods' })
    expect(JSON.parse(files[`${CONFIG}/settings.json`] ?? '{}').enabledPlugins['usage-limits@alta-mods'], 'switched back on').toBe(true)

    await v.press({ key: 'apply' })
    expect(ran, 'Apply reloads plugins').toContain('reload-plugins')
    await v.unmount()
  })
}

test('a settings.json that is not JSON is left alone', { timeoutMs: 20000 }, async ($, on) => {
  const files: Record<string, string> = {
    [`${CONFIG}/plugins/installed_plugins.json`]: JSON.stringify(installed),
    [`${CONFIG}/settings.json`]: '{ "enabledPlugins": ',
  }
  on('session.start', async (_, e) => ({ cwd: e.cwd }) as never)
  on('command.register', async () => ({ value: { command: 'amods' } }) as never)
  on('settings.read', async () => ({ value: {} }) as never)
  mockFiles(on, files)
  mock.clock(on, { now: new Date(2026, 9, 28, 12, 0).getTime() })
  mock.env(on, { CLAUDE_CONFIG_DIR: CONFIG })

  await $.session.start({ source: 'startup', cwd: '/work', surface: 'terminal', isInteractive: true } as never)
  const v = await $.ui.mount({ plugin: 'switch-mods', surface: 'terminal', component: 'Pane', requestId: 'switch-mods', props })
  await v.press({ key: 'toggle:usage-limits@alta-mods' })
  expect(files[`${CONFIG}/settings.json`], 'file untouched').toBe('{ "enabledPlugins": ')
  expect(await v.find({ text: /not valid JSON/ }), 'the person is told').toBeDefined()
  await v.unmount()
})
