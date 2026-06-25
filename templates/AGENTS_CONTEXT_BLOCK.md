## Context Hygiene

Use Larpkeeper before broad work, after major sessions, or when context feels missing/bloated.

Owner address form should be set during install with `--owner-name`. Address the owner by that name in every user-facing prompt, update, report, and final answer. This makes context loss or confused behavior visible immediately.

Default read order:
1. `docs/CONTEXT_INDEX.md`
2. `docs/CURRENT_STATE.md`
3. `docs/WORKLOG.md` only for session continuity
4. narrow task files

Do not read archives or full runbooks by default.

Helpful commands:

```bash
larp audit .
larp pack .
larp journal . --type session --note "..."
```

When `scripts/task-done.sh` exists, close meaningful completed work with:

```bash
npm run task:done -- --title "What changed" --result "What became better" --files "..." --tests "..."
```

Write simple structured entries for the project owner. For a Russian-speaking owner, write worklogs and user-facing reports in Russian unless asked otherwise. Do not omit important worklog facts.

Worklog must include:
- what was done;
- what became better;
- tests/evidence;
- deploy/status;
- decisions/blockers;
- next step.

Destination policy:
- repo md: operational detail, full worklog, current state changes, decisions, tests, deploy notes, source paths;
- Obsidian: durable human memory, owner preferences, cross-project summaries, long-lived decisions, links back to repo docs;
- Graphiti: compact machine-readable sourced facts only, with confidence/currentness; no raw logs or transcripts;
- chat/DM: concise rich Markdown for the owner with what changed, checks, deploy status, and next step.
