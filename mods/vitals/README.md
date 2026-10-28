# vitals

A band above your Claude Code prompt that shows how much usage you have left, when it resets, whether you are on pace to run out, how full the context is, and whether the prompt cache is warm or cold. It has two looks, **slim** (one row) and **detail** (a row each), and two skins: plain text in the terminal, art in the desktop app. It works on light and dark themes.

## What it does

**Slim** is one row. There is no title. In the terminal the git branch stands first (the desktop app hides it, as its sidebar shows the branch):

```text
⎇ main   5H ●●●●●●●●·· 78% left · 3h 12m   7D ●●●●●···· 52% left · 3d 9h · over pace   CTX 24% · 240k   CACHE warm 42m left   [Details]
```

**Detail** is a row each, with the numbers behind them:

```text
⎇ main  details                                                                       [Slim]
5H    ●●●●●●●●●●●●●●●●●●●····· 78% left (22% used) · resets in 3h 12m (15:12) · on pace
7D    ●●●●●●●●●●●●········ 52% left (48% used) · resets in 3d 9h (Sat 21:00) · at this rate it runs out in 2d 4h
CTX   ●●●●●●·················· 24% full · 240k of 1M tokens
CACHE ●●●●●●●●●●●●●●●●······· warm · 42m left of 60m
      next message reads 240k tokens from cache; cold it would be about 20×
```

- **Usage left** in the 5-hour (`5H`) and 7-day (`7D`) windows. The bar shows what is **left**, not what is used. A window turns yellow under 40% left and red with **LOW** under 15%.
- **Pace** compares how much of a window you have used with how much of its time has passed, and says when it would run out if you keep going at this rate. Slim shows a note only when it matters (`over pace`, `out in 2h 10m`); detail always says.
- **Context** (`CTX`) is how full the conversation is. It turns yellow at 70% and red at 90%, a good moment for a handoff or `/compact`.
- **Cache** is warm for a set time after Claude's last request, then cold. Cold means your next message re-sends the whole chat at a write price instead of a read price. There are no dollars in it, because on a Claude account you pay in usage, not per token: the band shows the tokens re-sent and how many times a warm read that is (about 20×; 12.5× on the 5-minute cache). That is a ratio of list prices, a guide to how much more usage a cold message takes, not an exact count.

### Two skins

| | Terminal | Desktop app (and VS Code, mobile) |
| --- | --- | --- |
| Look | Text in your theme's own colors, so it reads on light and dark | A warm dark card with the art from the [ribbon](https://github.com/robonuggets/ribbon) mod |
| Cache | The word `CACHE`, `warm` or `cold` | Robo bobbing when warm, frozen in ice when cold, and a WARM or COLD chip |
| Detail look | Text rows, including a draining cache bar | The usage rows plus the cache card: idle time, tokens in cache as a dot grid of the context window, and the next message as a warm read against a cold re-cache, yours marked **NOW** |
| Git branch | Shown first on the band, with an icon, because the terminal has no sidebar for it | Hidden: the app's sidebar already shows it |

The terminal can't draw pictures, so it keeps the text form; the desktop gets the art.

## Setup

1. Install it (see [Install](#install)) and restart Claude Code, or run `/reload-plugins`.
2. Send a first message. Until then the band shows a short line; the usage figures arrive with the first reply.

The defaults work. Optional settings, in `/config`:

| Setting | Default | What it does |
| --- | --- | --- |
| Start each session in | `slim` | `slim` or `detail`. |
| Prompt cache lasts (minutes) | `60` | Set `5` if your plan has the 5-minute cache. |
| Branch icon (terminal) | `symbol` | What stands before the branch: `symbol` (⎇), `nerd font` (the git glyph, needs a Nerd Font) or `text` (`git:`). |
| Warn when a window has less than this % left | `15` | Where a window turns red and shows **LOW**. |

## Using it

- Press the **Details** / **Slim** button on the band to switch looks for the rest of the session. In the terminal, `Tab` to the band and press `d`, or click the button.
- Nothing else to learn. The band redraws by itself every 30 seconds so the countdowns and the branch stay current.

## Good to know

- **It costs nothing to run.** It reads the app's own numbers and draws them. It never calls a model.
- **The branch** is read from the `.git` folder above your session's folder (worktrees too). A detached HEAD shows the short commit; a folder outside a repository shows no branch.
- **Usage figures need a subscription.** On an API key there are no 5-hour or 7-day windows, so the band shows context and cache only.
- **Subagents don't count.** Only your main chat resets the cache clock.
- **Pace needs a little history.** It stays quiet until about 3% of a window has passed, and only warns when the burn so far would empty the window before it resets.
- **Narrow windows.** The slim look takes two rows when one row would not fit, and each window gets its own row under 56 columns. The Details button stays on screen at every width.
- **Clear and compact** reset the cache and context readings.
- **The desktop card is dark in both themes.** It is a self-contained card with its own colors, so it stays readable on a light theme too.

## Troubleshooting

- **Only a short line before your first message**: that is expected. Claude Code reports your usage with the first reply and there is no cache until a request is sent, so the band says so and fills in after your first message. A resumed chat fills in at once.
- **No band at all**: a survey is showing (the band yields to surveys), or the mod is not installed or loaded in this app.
- **No `5H` / `7D`**: you are not on a subscription plan, or the first response has not reported them yet.
- **Cache says cold when it isn't (or the reverse)**: change *Prompt cache lasts* to match your plan.
- **No branch**: it is shown in the terminal only, and only inside a git repository.

## Install

```sh
claude plugin marketplace add falconeri/alta-mods
claude plugin install vitals@alta-mods
```

Then restart Claude Code (or run `/reload-plugins`). In the desktop app, use **+** next to the prompt box, then **Plugins**.

## Develop it

```sh
claude --plugin-dir ./mods/vitals
claude plugin test ./mods/vitals
```

## Credits

The art (Robo, the ice block, the chips, the cache card) and the idea of a cache card are adapted from [ribbon](https://github.com/robonuggets/ribbon) by Jay E, MIT licensed. The embedded font is [Outfit](https://github.com/Outfitio/Outfit-Fonts), under the SIL Open Font License 1.1.
