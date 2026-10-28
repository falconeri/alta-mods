# vitals

A band above your Claude Code prompt that shows how much usage you have left, when it resets, whether you are on pace to run out, how full the context is, and whether the prompt cache is warm or cold. It has two looks: **slim** (one row) and **detail** (a row each).

It works the same in the terminal and in the desktop app, on light and dark themes. It draws only text and one button, in your theme's own colors.

## What it does

**Slim** is one row:

```text
VITALS  5H ●●●●●●●●·· 78% left · 3h 12m   7D ●●●●●···· 52% left · 3d 9h · over pace   CTX 24% · 240k   CACHE warm 42m left   [Details]
```

**Detail** is a row each, with the numbers behind them:

```text
VITALS  details                                                             [Slim]
5H    ●●●●●●●●●●●●●●●●●●●····· 78% left (22% used) · resets in 3h 12m (15:12) · on pace
7D    ●●●●●●●●●●●●········ 52% left (48% used) · resets in 3d 9h (Sat 21:00) · at this rate it runs out in 2d 4h
CTX   ●●●●●●·················· 24% full · 240k of 1M tokens
CACHE ●●●●●●●●●●●●●●●●······· warm · 42m left of 60m
      next message reads 240k tokens from cache · ~$0.10 · ~$1.92 if it goes cold
```

- **Usage left** in the 5-hour (`5H`) and 7-day (`7D`) windows. The bar shows what is **left**, not what is used. A window turns yellow under 40% left and red with **LOW** under 15%.
- **Pace** compares how much of a window you have used with how much of its time has passed, and says when it would run out if you keep going at this rate. Slim shows a note only when it matters (`over pace`, `out in 2h 10m`); detail always says.
- **Context** (`CTX`) is how full the conversation is. It turns yellow at 70% and red at 90%, a good moment for a handoff or `/compact`.
- **Cache** is warm for a set time after Claude's last request, then cold. Cold means your next message re-sends the whole chat at the higher write price. With a price set it shows an estimate in dollars; without one it shows the tokens.

## Setup

1. Install it (see [Install](#install)) and restart Claude Code, or run `/reload-plugins`.
2. Send a first message. The band appears once the first reply brings usage figures.

The defaults work. Optional settings, in `/config`:

| Setting | Default | What it does |
| --- | --- | --- |
| Start each session in | `slim` | `slim` or `detail`. |
| Prompt cache lasts (minutes) | `60` | Set `5` if your plan has the 5-minute cache. |
| Your model's input price ($ per million tokens) | `0` | Set it to see dollar estimates. `0` shows tokens only. |
| Warn when a window has less than this % left | `15` | Where a window turns red and shows **LOW**. |

## Using it

- Press the **Details** / **Slim** button on the band to switch looks for the rest of the session. In the terminal, `Tab` to the band and press `d`, or click the button.
- Nothing else to learn. The band redraws by itself every 30 seconds so the countdowns stay current.

## Good to know

- **It costs nothing to run.** It reads the app's own numbers and draws them. It never calls a model.
- **Prices are estimates.** There is no built-in price table, so nothing goes stale: you give the input price once. A cold cache is estimated at 2x that price for the 1-hour cache or 1.25x for the 5-minute one, a warm read at 0.1x.
- **Usage figures need a subscription.** On an API key there are no 5-hour or 7-day windows, so the band shows context and cache only.
- **Subagents don't count.** Only your main chat resets the cache clock.
- **Pace needs a little history.** It stays quiet until about 3% of a window has passed, and only warns when the burn so far would empty the window before it resets.
- **Narrow windows.** Under 100 columns the slim look wraps to two rows; under 56 each window gets its own row.
- **Clear and compact** reset the cache and context readings.
- Unlike a drawing, the band is plain text, so it follows your theme and needs no fonts or images.

## Troubleshooting

- **No band**: the first reply has not arrived yet, or a survey is showing. The band yields to surveys.
- **No `5H` / `7D`**: you are not on a subscription plan, or the first response has not reported them yet.
- **Cache says cold when it isn't (or the reverse)**: change *Prompt cache lasts* to match your plan.
- **No dollar figure**: set *Your model's input price*.

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
