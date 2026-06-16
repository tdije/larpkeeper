# Chat Pressure Monitor

Goal: warn the human before the conversation becomes too full or noisy.

## Signals

Use available signals in this order:

1. actual token/context usage when the host exposes it;
2. transcript/message count;
3. tool-output volume;
4. number of files read;
5. active goal duration;
6. repeated corrections from the user;
7. larpkeeper `doctor` warnings.

Important: Larpkeeper cannot see the host chat's actual context percentage by itself.
The host/runtime must pass token usage, message count, or tool-output volume into:

```bash
larp pressure /path/to/project --tokens N --max-tokens N --messages N --tool-lines N
```

Without those hook signals, `pressure` can only use repo-side warnings and explicit numbers provided by the agent/human.

## Warning Levels

- `ok`: continue.
- `watch`: mention that context is getting heavy soon.
- `compact-soon`: ask to compact after current step.
- `compact-now`: stop broad work, write compact handoff, then continue.

## User Message Style

Short and useful:

```text
Контекст уже тяжелый: много tool output и исправлений. После этого шага сделаю compact handoff, чтобы не потерять важное и не тащить старый шум.
```

Never blame the user. The warning is operational, not emotional.

## Compact Quality Gate

A compact is good only if the next agent can continue without rereading the whole transcript.

It must include:

- goal;
- repo/path;
- actual current state;
- changed files;
- evidence;
- next step;
- stale/failed paths not to repeat.
