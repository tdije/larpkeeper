# Handoff Policy

`handoff.md` is for continuation, not history.

## Keep

- current goal;
- last meaningful done;
- current blocker;
- next concrete step;
- exact evidence: tests, deploy hashes, message IDs, paths;
- warnings that prevent mistakes.

## Move Out

- raw transcripts;
- old completed sessions;
- long terminal logs;
- old plans replaced by current state;
- facts better stored in `CURRENT_STATE.md`, `DECISIONS.md`, or `WORKLOG.md`.

## Rotation

When `handoff.md` exceeds the configured line budget:

1. Extract latest active block into a compact new handoff.
2. Move older material to `docs/archive/context-heavy/handoff-YYYY-MM-DD.md`.
3. Append a pointer to archive in `CONTEXT_INDEX.md`.
4. Append event to `CONTEXT_JOURNAL.md`.
5. If enabled, append durable note to Graphiti.

Never discard old handoff content without archiving.
