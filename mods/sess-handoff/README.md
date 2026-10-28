# sess-handoff

Keep working in a long session without losing context, and hand work to a teammate. `sess-handoff` writes a detailed handoff prompt of the whole chat, asks you, and only then opens a fresh chat seeded with it.

It writes the handoff when any of these happens:

- **The chat reaches 250k tokens.** Checked each time Claude finishes a reply.
- **The prompt cache has gone cold.** You come back after a pause (5 minutes by default) and send a prompt in a big chat. Before it re-reads everything at full price, you are asked whether to write a handoff first.
- **You type `sess-handoff`** (or `/sess-handoff`).

## Setup

1. Install it (see [Install](#install)) and restart Claude Code, or run `/reload-plugins`.
2. That is all. The defaults work; there is nothing you have to fill in.
3. To change a trigger, open `/config` and find the rows starting with the mod's name (see [Settings](#settings)). Changing one reloads the mod.

You do not need an account, key or channel for sharing. The handoff is written with your own plan and the model you are already using.

## Quick start

- Long chat or orchestration run, and you want a clean slate: type `sess-handoff`, wait for it to finish, choose **Start a fresh chat with it**.
- Passing work to someone else: type `sess-handoff`, choose **Copy it for a teammate**, paste it into your channel, or send them the saved `.md` file.
- Changed your mind while it is queued: type `sess-handoff cancel`.

## What happens

1. The handoff waits until Claude and every subagent are idle (see below).
2. The model writes it over its own transcript, so it sees the whole chat. Sections: Goal, Rules and preferences, State now, Decisions and why, Subagents and orchestration, Open questions and risks, Next steps, Waiting on the user.
3. It is saved as a `.md` file (by default in `~/.claude/handoffs/`) and you are asked:
   - **Start a fresh chat with it**: runs `/clear` and sends the handoff as the first message, with a note asking Claude to say what it understands and wait for your reply before changing anything.
   - **Copy it for a teammate**: puts it on your clipboard. Paste it into any channel, or share the saved file.
   - **Both**, or **Keep this chat**.

A fresh chat is never started without your answer. Nothing is sent to anyone: sharing means the clipboard and the file.

If you trigger a cold-cache handoff while typing a prompt, that prompt is put back in the box when the handoff is written.

## Does it work with subagents?

Yes. A handoff never runs while Claude or a subagent is working:

- It queues instead. Subagents that are `pending`, `running` or `waiting` hold it back; it checks every 2 seconds.
- Once everything is idle it waits 3 more seconds, and starts over if a new turn begins. A finished subagent's result reaches Claude as a new turn a moment after the agent reports done, so the handoff includes it.
- It only acts between turns, so it cannot stop an orchestration partway. A trigger that fires mid-run simply waits.
- Idle teammates (agents waiting for a message) do not block it.
- Type `sess-handoff cancel` to drop a queued handoff.

Checked against a real background subagent: a handoff requested while it ran waited about 40 seconds, through the agent's waiting stage and three of Claude's turns, then wrote the handoff after the agent finished and Claude had its result. The handoff recorded the agent and its outcome.

## Settings

Open `/config` and look for the sess-handoff rows:

| Setting | Default | What it does |
| --- | --- | --- |
| Hand off at this many context tokens | 250000 | 0 turns the trigger off. Values under 50000 are raised to 50000, because a fresh chat already starts near 30k. |
| Cache counts as cold after (minutes) | 5 | Minutes since Claude's last reply. Claude's cache lasts 5 minutes, or 1 hour on some plans: set this to match. 0 turns the trigger off. |
| Only offer on a cold cache above this size | 50000 | A cold cache on a small chat costs little, so it is ignored below this. |
| Folder for saved handoffs | `~/.claude/handoffs` | Where each handoff is saved. |

## Limits

- **Cold cache is an estimate.** Claude Code does not tell mods whether the cache is warm, so the mod compares the time since Claude's last reply with your setting.
- **The token check runs when a reply ends.** One very long reply can pass the limit before it is checked.
- **Offered once per chat.** If you decline the 250k offer it is not repeated in that chat; type `sess-handoff` any time. After `/clear` a new chat starts fresh, and the first reply after a handoff never triggers another.
- **It costs one extra request.** Writing the handoff reads the whole chat once: cheap while the cache is warm, full price once it is cold (which is why a cold cache asks first).
- **The saved file holds your conversation.** The model is told to leave out secrets, but check the file before sharing it.
- **Nothing before the first reply.** With no finished turn there is nothing to hand off.
- **Needs `/clear`.** If `/clear` cannot run from the mod, the handoff goes to your clipboard and you are told to run `/clear` and paste it.
- **Tested in the terminal CLI (headless).** The desktop app has not been tried. Where a surface has no clipboard, the file path is shown instead.

## Troubleshooting

- **Typing `sess-handoff` just sends it as a message**: the mod is not loaded. Run `claude plugin list`, then `/reload-plugins`. The word must be the whole prompt; `/sess-handoff` works too.
- **The status line says "Handoff waiting for N agents"**: that is the queue working. It continues when they finish; `sess-handoff cancel` stops it.
- **"Nothing to hand off yet"**: no reply has finished in this chat. Send a prompt first.
- **"Could not open a fresh chat"**: `/clear` could not run from the mod. The handoff is on your clipboard and saved as a file: run `/clear` yourself and paste it.
- **It never fires at 250k**: your model's window may be smaller than 250k (the mod says so once), or the trigger is off in `/config`. Type `sess-handoff` any time.
- **It asks about a cold cache too often or never**: change **Cache counts as cold after** to match your plan's cache length (5 minutes or 1 hour).

## Install

```sh
claude plugin marketplace add falconeri/alta-mods
claude plugin install sess-handoff@alta-mods
```

Then restart Claude Code (or run `/reload-plugins`). In the desktop app, use **+** next to the prompt box, then **Plugins**.
