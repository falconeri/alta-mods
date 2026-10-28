# alta-mods

My personal [Claude Code](https://claude.com/claude-code) mods, shared as one plugin marketplace. Add the marketplace once, then install only the mods you want. Each mod can be updated or removed on its own.

## Mods

| Mod | What it does |
| --- | --- |
| _None yet._ | Mods will be listed here as they are added. |

## Requirements

- [Claude Code](https://claude.com/claude-code) (a recent version; check with `claude --version`)
- `git` on your `PATH`

## Install

Add the marketplace (once):

```sh
claude plugin marketplace add falconeri/alta-mods
```

Install a mod from it (repeat for each mod you want):

```sh
claude plugin install <mod>@alta-mods
```

Prefer to stay inside a Claude Code session? The same thing, typed at the prompt:

```text
/plugin marketplace add falconeri/alta-mods
/plugin install <mod>@alta-mods
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `falconeri/alta-mods`, then **Add plugin**.

Installing at the default user scope turns the mod on in every session you start afterwards. Check what you have with `claude plugin list`.

## Update

Updates are **off by default** for third-party marketplaces. Pick one:

**Automatic (recommended).** In a session run `/plugin`, open **Marketplaces**, select **alta-mods**, then **Enable auto-update**. Claude Code then refreshes the marketplace and your installed mods in the background after a session starts; restart Claude Code to use the new version.

**Manual.**

```sh
claude plugin marketplace update alta-mods     # refresh the catalog
claude plugin update <mod>@alta-mods           # update one mod (restart to apply)
```

A mod only updates when its version changes, so you get new releases rather than every commit.

## Uninstall

Remove one mod:

```sh
claude plugin uninstall <mod>@alta-mods
```

Remove the whole marketplace (this also uninstalls every mod you installed from it):

```sh
claude plugin marketplace remove alta-mods
```

Add `--keep-data` to `uninstall` if you want to keep a mod's saved data. To turn a mod off without removing it, use `claude plugin disable <mod>@alta-mods` and `claude plugin enable <mod>@alta-mods`.

## Troubleshooting

- **`Plugin "<mod>" not found in marketplace "alta-mods"`**: the name is wrong, or your copy of the catalog is stale. Run `claude plugin marketplace update alta-mods`, and check the table above.
- **Install fails over SSH on a machine with no GitHub SSH key**: set `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` and try again.
- **A new version doesn't show up**: update the marketplace first (see Update), then the mod, then restart Claude Code.

## Adding a mod (maintainer notes)

Each mod is a folder under `mods/`:

```text
mods/<mod-name>/
├── .claude-plugin/plugin.json     # { "name": "<mod-name>", "version": "0.1.0", "description": "..." }
├── hooks/hooks.json               # { "modules": ["./register.ts"] }
├── hooks/register.ts
└── README.md
```

1. Build the mod in `mods/<mod-name>/` and try it with `claude --plugin-dir ./mods/<mod-name>`.
2. List it in `.claude-plugin/marketplace.json`. The entry `name` must match the `name` in its `plugin.json`:

   ```json
   { "name": "<mod-name>", "source": "./mods/<mod-name>", "description": "One line shown in /plugin" }
   ```

3. Add it to the **Mods** table above.
4. Validate everything, then commit and push:

   ```sh
   claude plugin validate .
   claude plugin validate ./mods/<mod-name>
   ```

**Releasing an update:** bump `version` in the mod's `plugin.json` (and only there) in the same commit as the change. Users stay on their cached copy until that string changes. Never rename a mod; if you must, add a `renames` map to `marketplace.json` so existing installs migrate.

Keep secrets, tokens and personal paths out of the repo; everything here is public.
