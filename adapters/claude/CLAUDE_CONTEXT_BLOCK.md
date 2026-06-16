# Larpkeeper

Use this project with the vendor-neutral `Larpkeeper` CLI when context is missing, bloated, stale, or contradictory.

Default commands:

```bash
larp audit .
larp recommend .
larp pack .
larp journal . --type session --note "..."
```

Agent workflow:
- run `larp audit .` before broad markdown reading;
- summarize health, cleanup potential, missing files, and next command for the human;
- run `larp pack . --task "..."` and read only the pack plus touched files;
- use `--apply` only when the human wants context files changed.

Do not read archives or long runbooks by default. Start from `docs/CONTEXT_INDEX.md`, `docs/CURRENT_STATE.md`, and the touched files.
