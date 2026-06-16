# Graphiti / Hermes Bridge

Repo docs should beat Graphiti for current runtime truth.

Use Graphiti/Hermes for:

- durable decisions;
- cross-project memory;
- compact project cards;
- stale-warning discovery;
- source provenance.

Do not use Graphiti/Hermes for:

- raw session dumps;
- current code truth without source verification;
- replacing `CURRENT_STATE.md`;
- hiding important repo decisions outside the repo.

Recommended sync:

- `CONTEXT_JOURNAL.md` gets every applied context maintenance event.
- Graphiti `context_notes.jsonl` gets durable maintenance facts only.
- Hermes project cards get compact recent progress, blockers, and source pointers.
