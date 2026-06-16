## Larpkeeper

This project can be maintained with the vendor-neutral `Larpkeeper` CLI.

Use it when context is missing, duplicated, stale, or too large:

```bash
larp audit .
larp pitch .
larp recommend .
larp pack .
larp journal . --type session --note "..."
```

Agent workflow:
1. Start with `larp audit .` before broad markdown reading.
2. Use `larp pitch .` or equivalent wording to show the human why it matters: savings, risks, impact, missing files, and suggested next command.
3. Use `larp pack . --task "..."` to choose the smallest read set for the task.
4. Read archives, long runbooks, and old handoffs only when the pack or task requires them.
5. Use `--apply` commands only when the human wants context files changed.

Default read order:
1. `docs/CONTEXT_INDEX.md`
2. `docs/CURRENT_STATE.md`
3. task-specific source files
4. `docs/WORKLOG.md` only when session continuity matters

Do not read `docs/archive/context-heavy/` unless the task explicitly needs old history or contradiction resolution.
