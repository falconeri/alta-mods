# prompt-shaper

Catches a long, messy prompt before Claude reads it, asks only the questions that change the outcome (each with a default), then fills the prompt box with a clear brief:

- **The job**: what to do
- **The why**: the goal, or who it is for
- **The guardrails**: limits and things not to change
- **Done means**: how you will know it is finished
- **Assumptions**: what was assumed where you were silent
- **How to work**: rules for Claude (see below)

You read the brief in the prompt box, edit it if you want, and press Enter. Nothing reaches Claude until you do. It works the same in the terminal and in the desktop app.

## How it works

1. You type a long prompt (60 words or more) and press Enter.
2. The prompt is held back and a model finds the gaps whose answer would change what gets done. It may find three, one or none.
3. You answer each in the normal question dialog. The default is listed first and marked `(default)`: pick it, pick another option, or type your own.
4. The brief appears in the prompt box. Check it, change what you like, press Enter.

If your prompt is already clear, it comes back in the box unchanged, and the next Enter sends it as it is. If you dismiss a question or something fails, your original words come back in the box. They are never lost.

## The working rules

Unless you turn them off, every brief ends with these rules for Claude:

- Before changing anything, restate the job in one or two sentences, add any assumptions that were missed, and say exactly what a bare "go" would do. Then wait.
- Ask a question only when the answer would change what Claude does, and give each one a default it will use if you do not answer.
- When finished, end with a "Not done" list: what was skipped, could not be verified, or is left for you.
- Never post, push, send or publish anything. Stop at a draft and show it to you first.

So after you press Enter, Claude replies with its restatement and assumptions, and you answer "go" or correct it.

## Skip it

- Start the prompt with `>> ` (two arrows and a space) to send it as typed. The prefix is removed.
- Short prompts (under the word limit), slash commands, prompts with images, and prompts typed while Claude is working are never touched.
- A prompt that is already a finished brief is not shaped again.

## Settings

Open `/config` and look for the prompt-shaper rows:

| Setting | Default | What it does |
| --- | --- | --- |
| Shortest prompt to shape | 60 | Prompts with fewer words are sent as typed. |
| Most questions to ask | 3 | Only questions that change the outcome are asked, up to this many (0 to 5). 0 never asks. |
| Add the working rules | on | Adds the "How to work" block to the end of every brief. |
| Model | haiku | The model that writes the questions and the brief. Haiku is fastest and cheapest; sonnet or opus write sharper briefs. |

## Cost and limits

- Each shaped prompt makes two short model calls (the questions, then the brief) on your own plan. With the question limit at 0 it makes one. Prompts over 20,000 characters are not shaped.
- Where a surface has no prompt box to fill, the brief is shown in a dialog instead, with **Send the brief**, **Send my original** and **Cancel**.
- With **Cancel** and no prompt box, your original is copied to the clipboard.

## Install

```sh
claude plugin marketplace add falconeri/alta-mods
claude plugin install prompt-shaper@alta-mods
```

The install may mention settings that are not set yet. The defaults work, so you can ignore it and change them later in `/config`.
