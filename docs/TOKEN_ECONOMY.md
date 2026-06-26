# Token Economy

The tool must save more context than it consumes.

## Rules

- Prefer `--brief` in chat hooks.
- Prefer `--json` for machines.
- Print long tables only on explicit CLI use.
- Before broad source reading, run `larp repo-map . --task "..."` and open only the mapped files first.
- Before long logs, broad search, or multi-agent fan-out, run `larp tool-guard . --task "..."`.
- Use exact `rg -n "term"` searches before `rg --files` or whole-repo scans.
- Keep logs around `--tail 80` by default.
- Keep tool `max_output_tokens` close to the `tool-guard` recommendation; narrow the query before raising the limit.
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

`repo-map` estimates the cost of a compact code map and lists first source files/symbols to inspect for the task.

`tool-guard` returns output budgets, log tail size, and when to stop broad work and compact.

`codex-preflight` is the normal start for a Codex coding session. It combines the task pack, source map, output guard, and context budget in one short report.

`compress-output` turns noisy command output into a safe summary: error lines, top matched files, tail, line/token estimate, and redaction warnings.

`token-burn` reads only allowlisted aggregate fields from Codex sqlite logs. It must not print raw prompt, tool body, auth, token, or secret content.

`semantic-search` is semantic-lite for now: local lexical/symbol/import scoring without remote embeddings. It is meant to replace repeated broad `rg` attempts until a real vector/symbol index is installed.

`before` uses the broad context estimate: active memory/product docs, agent entry surfaces, and large active docs that agents commonly over-read when no routing exists.

`after` uses the selected profile pack: default files plus task-matched scoped files.

This means a good profile can show savings even when the selected pack is larger than the tiny active-memory set, because it prevents the agent from opening heavy handoffs, runbooks, old audits, or local skill references.

## Good Hook Output

```text
compact-soon score=61 finish current step, then compact
```

## Bad Hook Output

Long markdown reports injected into every chat turn.

## Safety Rules

- Never scan `~/.codex` with broad `rg`.
- Never read `auth.json`, `.env`, secret backups, API keys, or raw prompt/tool body logs for token accounting.
- Token reports should use safe aggregates: timestamps, estimated bytes/tokens, target/module/file, counts, and redacted summaries.
- If a source cannot provide real token fields safely, say that and show estimated local context/tool-output burn instead.
