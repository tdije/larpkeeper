# Source Roles

Use these roles when cleaning a project.

## Always / Default

Short files that define the current path.

- `AGENTS.md` / `CLAUDE.md`: runtime-specific entrypoint, should route not duplicate.
- `docs/CONTEXT_INDEX.md`: map of sources and read order.
- `docs/CURRENT_STATE.md`: current truth.
- touched source files.

## Task-Conditional

Read only when the task touches the domain.

- `PRODUCT.md`: product purpose and user promise.
- `DESIGN.md`: UI direction and design rules.
- `docs/*MIGRATION*.md`: migration/runtime contract.
- `docs/*PARITY*.md`: legacy parity checklist.
- `docs/*RUNBOOK*.md`: operational procedure.
- `docs/*DECISIONS*.md`: adopted decisions.

## Foundation-Change Only

Read before changing stack, SDKs, architecture, memory systems, deploy rules, or data contracts.

- dependency research;
- SDK comparisons;
- architecture audits;
- old migration notes;
- long design explorations.

## Archive

Never default-read.

- old audits;
- raw transcripts;
- historical reports;
- superseded plans;
- one-off spike notes.

## Obsolete

Do not delete automatically. Mark in index or archive with replacement pointer.
