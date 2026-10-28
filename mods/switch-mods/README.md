# switch-mods

A panel that switches every installed Claude Code plugin and mod on or off. Open it with:

```text
/amods
```

It works the same in the terminal and in the desktop app. It draws only buttons and text, which every surface supports.

## What it does

Claude Code has no single screen that shows every plugin and mod with a switch beside it. `switch-mods` adds one. Instead of running `claude plugin disable <name>@<marketplace>` for each plugin, you open `/amods`, press a button, and reload.

Use it to:

- turn a mod off for a while without uninstalling it (and lose none of its saved data),
- see what is installed, from which marketplace, and at which version,
- check what a plugin does, from its description, before you decide to keep it.

## Setup

1. Install it (see [Install](#install)) and restart Claude Code, or run `/reload-plugins`.
2. Type `/amods`.

There is nothing to configure: **this mod has no settings.** It reads the plugins you have installed and writes only the on/off switches.

## Using it

- Each installed plugin is a row: name, marketplace, version and description.
- Press **On** / **Off** to flip it. The change is saved to your Claude Code settings right away.
- Press **Apply** (it reads **Reload mods** when nothing has changed) to reload plugins in the current chat. You can also type `/reload-plugins`. Other chats pick the change up when they reload.
- The list refreshes by itself while the panel is open, so a mod you install or remove elsewhere shows up.

Keyboard: in the terminal, press `Tab` to move between buttons and `Enter` to press one.

## What it changes

A switch writes `enabledPlugins["<plugin>@<marketplace>"]` in `~/.claude/settings.json` (or in `$CLAUDE_CONFIG_DIR/settings.json` if you set that). This is the same setting `claude plugin enable`, `claude plugin disable` and `/plugin` use. Every other setting is kept. If `settings.json` is not valid JSON the mod leaves it alone and says so.

It does not need the `claude` command on your `PATH`, which is why it also works in the desktop app.

## Limits

- Plugins installed for one project or locally (not at the user scope) are shown, but have no switch. Manage those with `/plugin`.
- This panel has no switch for itself, so you cannot switch off the way back in.
- Mods loaded only for one session (`--plugin-dir`) are not listed.
- The file is rewritten as standard 2-space JSON, so hand-made formatting in `settings.json` may change.

## Troubleshooting

- **`/amods` is not found**: the mod is not installed or not loaded yet. Run `claude plugin list`, then `/reload-plugins` or restart Claude Code.
- **The panel does not open in a narrow terminal**: a pane opened unasked needs a wide window (about 110 to 144 columns). Widen the window and run `/amods` again.
- **A plugin has no On/Off button**: it was installed for one project or locally. Manage it with `/plugin`.
- **I pressed Off and the plugin still runs**: the switch is saved at once, but Claude Code reads it when plugins reload. Press **Apply** or run `/reload-plugins`.
- **"settings.json is not valid JSON"**: fix the file by hand. The mod will not overwrite a file it cannot read.

## Install

```sh
claude plugin marketplace add falconeri/alta-mods
claude plugin install switch-mods@alta-mods
```

Then restart Claude Code (or run `/reload-plugins`) and type `/amods`. In the desktop app, use **+** next to the prompt box, then **Plugins**.
