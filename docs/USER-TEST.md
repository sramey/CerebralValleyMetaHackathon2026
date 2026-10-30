# Family test: facilitator script (one page)

For whoever sits next to the tester. You do not need to know how Metabuild works. Your job is to watch, say very little and let the numbers do the talking. The game records them by itself.

## Before each person (2 min)
1. Open `http://127.0.0.1:5182/?tester=N&coach`, with `N` the next number (1, 2, 3…). The number is the only thing recorded about them. **Never write a name anywhere, not in the address, not on the notes.**
2. Check that the speaker button (top right of the game) shows sound on and the volume is comfortable.
3. Start a screen recording only after you have their yes (see "Clips").
4. Sit beside them, not behind them. Put the keyboard and mouse in front of the tester.

## What to say (read it out, then be quiet)
> "This is a game that builds itself while you play. You can tell it what you want, by typing or by holding Shift and talking, and it makes it. I'm testing the game, not you, so nothing you do can be wrong. I can't help while you try it, but I'll be right here. Please think out loud: say what you expect and what surprises you. Ready?"

## The three tasks (give them one at a time, on paper or out loud)
1. **"Make something appear in the game."** Anything they like. (Done when they see it in the world.)
2. **"Change how the whole world looks or feels."** Hint they may use if they ask what is possible: "you could ask for a mood, like spooky or Christmas." (Done when the world changes.)
3. **"Now play it. Make your character move, jump and use what you built."** (Done after about a minute of playing.)

If they finish early, say: "Ask for anything else you would want in a game."

## What to note this round (feel and UI)
Jot one line for each, in their words. Do not prompt for them: just watch.
- **Aiming.** When they use an aimed thing (a grappling hook, a gun, anything that points), is a crosshair visible where they point? Did they look for a mouse pointer at all?
- **Getting hurt.** When something hits them, do they notice? Do they say it hurt, flinch, or sit through it? Note whether they spot the red flash and the knockback.
- **Knobs.** If they open a mod's sliders, do they try to drag the handle? Did the handle follow the mouse all the way, or did it jump and stop?
- **Ground width.** If they drag "Ground width" on the Ground card, does the ground visibly change? Which way did they drag first (wider or narrower), and did they go looking for the edge of the level?

## What NOT to help with
- Do **not** tell them what to type or say, point at buttons, or read the on-screen text to them. The on-screen guide is part of what we are testing.
- Do **not** say "try this" or "no, like this". If they ask "what do I do?", answer: "What do you think you should do?"
- Do **not** explain errors or rejections. If the game turns something down, let them react. Write down what they said and did.
- Do not apologise for the game or defend it.

You **may** step in only for: a crash or frozen screen (reload the same address, same `N`), a safety problem, or if they ask to stop.

## Stuck rule
If they have made no progress for **3 minutes** on a task, say once: "Want to skip to the next one?" and move on. Mark the task in your notes as "skipped". Do not hint.

## When to stop
- All three tasks done, **or** 15 minutes have passed, whichever comes first.
- Right away if they are upset, bored or ask to stop. Thank them. That is also a result.

## Two questions at the end (jot the answers as short phrases, no names)
1. "On a scale of 1 to 5, how easy was it to get something to appear?"
2. "What was the best moment, and what was the most confusing one?"

## Clips (only with consent)
- Ask **before** recording: "May I record the screen and your voice so I can show a short clip of how it went? I won't use your name, and you can say no, or ask me to delete it afterwards."
- Get a clear yes out loud (on the recording) or in writing. For anyone under 18, get a yes from a parent or guardian too.
- Record the screen and microphone only: **no face**, no names on screen, close other windows first.
- Keep the files on the owner's computer in a private folder. Do not put them in the project and never upload them without the person's yes to that.
- If they say "delete it", delete it in front of them.
- Pick clips that show a moment, for example the first build appearing or a reaction. Ten to twenty seconds is enough.

## After the last person
Run `npm run testers` in the project folder. It prints a table and writes `docs/evidence/user-test.md` with totals only (how many got a first build, how long it took, how many builds landed, how many problems were recovered, spoken versus typed, session length). Nothing in it says who anyone is or what they asked for.
