## Larpkeeper

This project can be maintained with the vendor-neutral `Larpkeeper` CLI.

Owner address form should be set during install with `--owner-name`. Address the owner by that name in every user-facing prompt, update, report, and final answer. This makes context loss or confused behavior visible immediately.

Use it when context is missing, duplicated, stale, or too large:

```bash
larp audit .
larp pitch .
larp recommend .
larp pack .
larp repo-map . --task "..."
larp tool-guard . --task "..."
larp journal . --type session --note "..."
larp finish . --done "..." --next "..." --evidence "..."
```

Agent workflow:
1. Start with `larp audit .` before broad markdown reading.
2. Use `larp pitch .` or equivalent wording to show the human why it matters: savings, risks, impact, missing files, and suggested next command.
3. Use `larp pack . --task "..."` to choose the smallest read set for the task.
4. Use `larp repo-map . --task "..."` before broad source reading, then expand only through exact searches.
5. Use `larp tool-guard . --task "..."` before long logs, broad searches, or multi-agent work and obey its output limits.
6. Read archives, long runbooks, and old handoffs only when the pack or task requires them.
7. Use `--apply` commands only when the human wants context files changed.
8. After meaningful completed work, offer or write a compact worklog-style completion: what was done, what became better, evidence/tests, deploy status, decisions/blockers, and next step. If `scripts/task-done.sh` exists, prefer `npm run task:done -- --title "..." --result "..."`.
9. For a Russian-speaking owner, write worklogs and user-facing reports in Russian unless asked otherwise. Do not omit important completed work, failures, verification gaps, deploy status, or next steps.

Default read order:
1. `docs/CONTEXT_INDEX.md`
2. `docs/CURRENT_STATE.md`
3. task-specific source files
4. `docs/WORKLOG.md` only when session continuity matters

Do not read `docs/archive/context-heavy/` unless the task explicitly needs old history or contradiction resolution.
Do not run broad `rg --files`, broad `rg`, container logs over about 80 lines, or more than one subagent before `pack` and `repo-map`.
Do not paste raw logs or transcripts into worklogs, Graphiti, Hermes, or Obsidian; record durable sourced facts.

Destination policy: repo md gets operational detail; Obsidian gets durable human memory/preferences/cross-project summaries; Graphiti gets compact sourced facts only; chat/DM gets concise rich Markdown for the owner.
