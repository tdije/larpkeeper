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
- Task completion records should enter Graphiti only as durable sourced facts: what was done, what became better, evidence/tests, deploy status, and source paths. Repo docs remain the first operational truth; never sync raw transcripts.
- Graphiti should not receive the full owner-facing worklog prose. Keep it compact and machine-readable: fact, project, source paths, confidence/currentness, tests/deploy when relevant.
- Obsidian should receive durable human memory: owner preferences, cross-project summaries, long-lived decisions, and links back to repo docs.
- Repo md should keep the complete operational worklog and current truth; chat/DM should be a concise rich Markdown report for the owner.
