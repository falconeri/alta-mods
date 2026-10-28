# switch-mods

A panel that switches every installed Claude Code plugin and mod on or off. Open it with:

```text
/amods
```

It works the same in the terminal and in the desktop app. It draws only buttons and text, which every surface supports.

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

## Install

```sh
claude plugin marketplace add falconeri/alta-mods
claude plugin install switch-mods@alta-mods
```
