# deckhands

A pixel-art progress band above the prompt, with the Claude Code mascot walking along it, and a side panel that turns every subagent into a named crew member. For [Claude Code](https://claude.com/claude-code), in the terminal and in the desktop app.

There is no cost anywhere: on a Claude account there is no bill to show, so the panel counts tokens and time instead.

## What it does

**The band.** While Claude works, one line above the prompt shows what it is doing right now ("Editing register.tsx", "Running the tests"), a pixel bar with a wave running along it, and the percentage. The Claude Code mascot (orange on a sea-coloured bar) stands at the edge of what is done and walks as the bar fills.

When Claude hands work to subagents it puts on a **captain's coat** with gold epaulettes, the bar turns blue and a counter shows how many are finished (`1/3`).

The mascot reacts to the session:

| Mood | When | Looks like |
| --- | --- | --- |
| Walking | Claude is working | Feet shuffle; a symbol in front of the bar says what kind of work (`⌕` reading, `⚒` editing code, `✎` styles and images, `✓` tests, `⚑` captain) |
| Celebrating | A turn ended well | Confetti on the bar, `✦` |
| Waiting for you | A question or a permission request is open | `!` |
| Shaken | One of Claude's tools failed | `✗`, the bar turns red for a moment |
| Asleep | Nothing runs but the task list still has work | `zz` |

**The crew.** Every subagent signs on by itself: it gets a name and a role from the first keyword in its task (or from its agent type, so `code-reviewer` is a lookout), and a character wearing that role's gear.

| Character | Role | Picked for |
| --- | --- | --- |
| Hard hat and hammer | `shipwright` | build, implement, fix, refactor, create, write |
| Explorer hat and spyglass | `navigator` | research, explore, search, read, analyze, plan |
| Beret, brush and palette | `painter` | design, draw, icons, logo, UI, CSS |
| White cap and binoculars | `lookout` | test, verify, debug, review, audit |
| Knit cap and rope | `deckhand` | anything else |
| Tricorn and gold epaulettes | `captain` | Claude itself while it delegates (never a subagent) |

Each row of the panel shows the character, its name, task, role, model and effort, what it is doing now, its tokens and time, and its own progress bar. A character at work shuffles its feet; one that is finished greys out and stands still. The panel opens by itself when the first subagent starts, or type `/deck`.

**Progress.** If Claude or a subagent keeps a task list, the bar follows it exactly. Without one it is an estimate that moves with every step and stays under 90% until the work really ends.

## Terminal and desktop

Each surface has its own drawing of the same cast:

- **Terminal:** everything is a `Raster` of quadrant blocks (four pixels to a character cell). The band is one line tall; each crew member is five cells wide and two tall.
- **Desktop app, VS Code, mobile:** larger pixel art in `Svg`, with the gear drawn in, and the mascot walking on top of the bar.

If a surface can draw neither, the band falls back to plain text.

## Commands

| Command | What it does |
| --- | --- |
| `/deck` | Opens the crew panel |
| `/deck-clear` | Clears the task list and the crew |
| `/deck-bar` | Shows or hides the progress band (`/deck-bar off`, `/deck-bar on`, or nothing to switch). Kept across sessions; the panel keeps working |

## Settings (in `/config`)

- **Progress band** (`on`): `off` hides the band from the start. `/deck-bar` overrides it.

## Good to know

- **It costs no tokens.** It only listens to events that already happen and draws locally: no prompt changes, no model calls.
- **Sits beside other bands.** If another mod draws above the prompt (`vitals`, `prompt-shaper`), the band keeps their drawing underneath it.
- The animation ticks ten times a second, and only while something is working or a mood is showing.

## Development

```text
hooks/art.ts          palette, the characters and bars (Raster and Svg)
hooks/crew.ts         roles, names, progress, activity text (no engine in it)
hooks/register.tsx    the hooks: state, band and panel
types/index.d.ts      the state contract
```

```sh
claude plugin validate ./mods/deckhands
claude plugin test ./mods/deckhands
claude --plugin-dir ./mods/deckhands
```
