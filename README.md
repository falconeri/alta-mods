# alta-mods

My personal [Claude Code](https://claude.com/claude-code) mods, shared as one plugin marketplace. Add the marketplace once, then install only the mods you want. Each mod can be updated or removed on its own.

## Mods

| Mod | What it does |
| --- | --- |
| [`switch-mods`](mods/switch-mods) | Type `/amods` to open a panel that switches every installed plugin and mod on or off. Works in the terminal and the desktop app. |
| [`prompt-shaper`](mods/prompt-shaper) | A Shape prompt button above the prompt box. Press it to turn what you typed into a clear brief: it asks only the questions that change the outcome (each with a default), then fills the prompt box with the job, the why, the guardrails, what done means and the assumptions, plus working rules for Claude. Never automatic. |
| [`sess-handoff`](mods/sess-handoff) | Writes a detailed handoff prompt of the whole chat at 250k tokens, when the prompt cache goes cold, or when you type `sess-handoff`. Waits for subagents to finish, asks before opening a fresh chat seeded with it, and can copy it for a teammate. |
| [`vitals`](mods/vitals) | A band above your prompt, slim or detailed: usage left in the 5-hour and 7-day windows with reset times and a pace warning before you run out, how full the context is, and whether the prompt cache is warm or cold. Git branch and plain text in the terminal, ribbon-style art on desktop, light or dark. |

### What each mod does

None of the mods needs an account, key or setup beyond installing it: the defaults work. Each folder has its own README with the full details.

**[`switch-mods`](mods/switch-mods)** adds a panel for turning installed plugins on and off.
- Use it: type `/amods`, press **On** / **Off** on a row, then **Apply**.
- Settings: none.

**[`prompt-shaper`](mods/prompt-shaper)** turns a messy prompt into a clear brief when you ask it to, and never otherwise.
- Use it: type your prompt, then press the **Shape prompt** button on the right above the prompt box. Answer the few questions it asks (each has a default), then check the brief it puts in the prompt box and press Enter. Skip the button and Enter sends your prompt as it is.
- Settings (in `/config`): most questions to ask (3), add the working rules (on), model (haiku).

**[`sess-handoff`](mods/sess-handoff)** writes a handoff of the whole chat so you can continue in a fresh chat or pass the work to a teammate.
- Use it: type `sess-handoff`. It also offers itself at 250k tokens, or when you return after a pause and the prompt cache has gone cold. It waits for subagents to finish, and never opens a fresh chat until you confirm.
- Settings (in `/config`): token trigger (250000), minutes until the cache counts as cold (5), smallest chat to offer on a cold cache (50000), folder for saved handoffs (`~/.claude/handoffs`).

**[`vitals`](mods/vitals)** puts a band above the prompt with your usage, context and prompt cache.
- Use it: nothing to do; it appears after the first reply. Press **Details** / **Slim** on the band to switch looks. The terminal shows the git branch and plain text; the desktop app gets the art.
- Settings (in `/config`): start in slim or detail (slim), cache lifetime in minutes (60), warn below this % left (15).

## Requirements

- [Claude Code](https://claude.com/claude-code) (a recent version; check with `claude --version`)
- `git` on your `PATH`

## Install

Add the marketplace (once):

```sh
claude plugin marketplace add falconeri/alta-mods
```

Install a mod from it (repeat for each mod you want), for example the mods panel:

```sh
claude plugin install switch-mods@alta-mods
```

Then restart Claude Code (or run `/reload-plugins`) and type `/amods`. Other mods install the same way, for example `claude plugin install prompt-shaper@alta-mods` or `claude plugin install sess-handoff@alta-mods`.

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
