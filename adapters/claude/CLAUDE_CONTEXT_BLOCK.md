# Larpkeeper

Use this project with the vendor-neutral `Larpkeeper` CLI when context is missing, bloated, stale, or contradictory.

Owner address form should be set during install with `--owner-name`. Address the owner by that name in every user-facing prompt, update, report, and final answer. This makes context loss or confused behavior visible immediately.

Default commands:

```bash
larp audit .
larp recommend .
larp pack .
larp journal . --type session --note "..."
larp finish . --done "..." --next "..." --evidence "..."
```

Agent workflow:
- run `larp audit .` before broad markdown reading;
- summarize health, cleanup potential, missing files, and next command for the human;
- run `larp pack . --task "..."` and read only the pack plus touched files;
- use `--apply` only when the human wants context files changed.
- after meaningful completed work, offer or write a compact worklog-style completion: what was done, what became better, evidence/tests, deploy status, decisions/blockers, and next step. If `scripts/task-done.sh` exists, prefer `npm run task:done -- --title "..." --result "..."`;
- for a Russian-speaking owner, write worklogs and user-facing reports in Russian unless asked otherwise. Do not omit important completed work, failures, verification gaps, deploy status, or next steps.

Do not read archives or long runbooks by default. Start from `docs/CONTEXT_INDEX.md`, `docs/CURRENT_STATE.md`, and the touched files.
Do not paste raw logs or transcripts into worklogs, Graphiti, Hermes, or Obsidian; record durable sourced facts.

Destination policy: repo md gets operational detail; Obsidian gets durable human memory/preferences/cross-project summaries; Graphiti gets compact sourced facts only; chat/DM gets concise rich Markdown for the owner.
