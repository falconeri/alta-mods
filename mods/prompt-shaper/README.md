# prompt-shaper

A **Shape prompt** button on the right, just above the prompt box. Press it when you want the prompt you typed turned into a clear brief. Leave it alone and Enter sends your prompt exactly as typed: nothing is shaped automatically, whatever the length.

The brief it fills the box with has:

- **The job**: what to do
- **The why**: the goal, or who it is for
- **The guardrails**: limits and things not to change
- **Done means**: how you will know it is finished
- **Assumptions**: what was assumed where you were silent
- **How to work**: rules for Claude (see below)

You read the brief in the prompt box, edit it if you want, and press Enter. Nothing reaches Claude until you do. It works the same in the terminal and in the desktop app.

## How it works

1. Type your prompt in the box, any length.
2. Press **Shape prompt** (or its hotkey `s` after you click the band or press `ctrl+x tab` to focus it). Your words stay in the box while it works.
3. A model finds the gaps whose answer would change what gets done. It may find three, one or none.
4. You answer each in the normal question dialog. The default is listed first and marked `(default)`: pick it, pick another option, or type your own.
5. The brief replaces the text in the prompt box. Check it, change what you like, press Enter.

If your prompt is already clear, you get a short notice and the box is left alone. If you dismiss a question or something fails, your original words are still in the box, untouched.

The button sits on the band above the prompt box, not inside it: mods cannot draw inside the box itself.

## The working rules

Unless you turn them off, every brief ends with these rules for Claude:

- Before changing anything, restate the job in one or two sentences, add any assumptions that were missed, and say exactly what a bare "go" would do. Then wait.
- Ask a question only when the answer would change what Claude does, and give each one a default it will use if you do not answer.
- When finished, end with a "Not done" list: what was skipped, could not be verified, or is left for you.
- Never post, push, send or publish anything. Stop at a draft and show it to you first.

So after you press Enter, Claude replies with its restatement and assumptions, and you answer "go" or correct it.

## Example

You type this and press **Shape prompt** (shortened here):

```text
ok so we need the signup page to look better, people say it feels old, also maybe
the form is too long?? marketing wants it done before the launch, dont break the
existing validation, I think the logo should stay, and it must work on phones...
```

You are asked, one at a time, only what would change the outcome, each with a default:

```text
Q 1 of 2   Who is the page for?
           > New customers (default)   Returning users   Admins
```

Then the prompt box fills with the brief. You can edit it before pressing Enter:

```text
## The job
Redesign the signup page so it feels modern and the form is shorter.

## The why
Customers say the page feels old; marketing needs it before launch.

## The guardrails
- Keep the existing validation and the logo.

## Done means
- The page works on phones.

## Assumptions
- New customers are the audience (default).

## How to work
- Before you change anything, restate the job ...
```

## Setup

1. Install it (see [Install](#install)) and restart Claude Code, or run `/reload-plugins`.
2. That is all. The defaults work; there is nothing you have to fill in.
3. To change a setting, open `/config` and find the rows starting with the mod's name (see [Settings](#settings)). Changing one reloads the mod.

Nothing needs an API key or account beyond your normal Claude Code login. The questions and the brief are written with your own plan, using the model set in **Model**.

## Skip it

Just don't press the button. There is no word limit, no `>> ` prefix and no command: a prompt goes as typed unless you press **Shape prompt**. The button does nothing on an empty box or on a prompt that is already a finished brief.

## Settings

Open `/config` and look for the prompt-shaper rows:

| Setting | Default | What it does |
| --- | --- | --- |
| Most questions to ask | 3 | Only questions that change the outcome are asked, up to this many (0 to 5). 0 never asks. |
| Add the working rules | on | Adds the "How to work" block to the end of every brief. |
| Model | haiku | The model that writes the questions and the brief. Haiku is fastest and cheapest; sonnet or opus write sharper briefs. |

## Cost and limits

- Each shaped prompt makes two short model calls (the questions, then the brief) on your own plan. With the question limit at 0 it makes one. Prompts over 20,000 characters are not shaped.
- If a dialog is holding the prompt box when the brief is ready, the brief is copied to the clipboard instead.

## Troubleshooting

- **I do not see the button**: check that the mod is on in `/amods` or `claude plugin list`. It is drawn in the band above the prompt box, on the terminal and the desktop app, and it hides while a survey is showing.
- **Nothing happens when I press it**: the box is empty, already holds a finished brief, or is over 20,000 characters. A short notice says which.
- **My prompt disappeared**: it should not. Your words stay in the box until the brief is ready, and after a cancel or a failure they are untouched.
- **The questions are not useful**: set **Most questions to ask** to `0` to skip them, or to a lower number. Switch **Model** to `sonnet` or `opus` for sharper questions.
- **I do not want the "How to work" block**: turn off **Add the working rules**.

## Install

```sh
claude plugin marketplace add falconeri/alta-mods
claude plugin install prompt-shaper@alta-mods
```

The install may mention settings that are not set yet. The defaults work, so you can ignore it and change them later in `/config`.
