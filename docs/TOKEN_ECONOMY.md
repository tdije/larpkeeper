# Token Economy

The tool must save more context than it consumes.

## Rules

- Prefer `--brief` in chat hooks.
- Prefer `--json` for machines.
- Print long tables only on explicit CLI use.
- Do not write markdown reports unless `--apply`.
- Skills/adapters stay short and route to CLI.
- References load only for the relevant operation.

## Metrics

`budget` and `savings` estimate:

- before lines/tokens;
- after lines/tokens;
- saved tokens;
- saved percent;
- approximate recurring savings.

The token estimate is intentionally rough. It is for prioritization, not billing.

`before` uses the broad context estimate: active memory/product docs, agent entry surfaces, and large active docs that agents commonly over-read when no routing exists.

`after` uses the selected profile pack: default files plus task-matched scoped files.

This means a good profile can show savings even when the selected pack is larger than the tiny active-memory set, because it prevents the agent from opening heavy handoffs, runbooks, old audits, or local skill references.

## Good Hook Output

```text
compact-soon score=61 finish current step, then compact
```

## Bad Hook Output

Long markdown reports injected into every chat turn.
