# File Taxonomy

Core files are useful in most agent-heavy projects:

- `CONTEXT_INDEX.md`: where to look and what not to read.
- `CURRENT_STATE.md`: what is true now.
- `DECISIONS.md`: adopted decisions.
- `WORKLOG.md`: compact progress history.
- `CONTEXT_JOURNAL.md`: context maintenance events.
- `handoff.md`: how to continue from the current stopping point.

Situational files:

## Product / App

- `PRODUCT.md`: user, promise, primary flows, anti-goals.
- `DESIGN.md`: visual/UX direction, tokens, rules.
- `PARITY.md`: legacy parity checklist.
- `ROADMAP.md`: future sequencing, not current truth.
- `RELEASE_CHECKLIST.md`: launch/smoke gate.

## Library / SDK / API

- `PUBLIC_API.md`: external contract.
- `INTEGRATION.md`: how consumers wire it.
- `COMPATIBILITY.md`: supported versions/platforms.
- `MIGRATION.md`: upgrade path and breaking changes.

## Backend / Infra

- `ARCHITECTURE.md`: module boundaries and data flow.
- `RUNBOOK.md`: deploy/ops procedures.
- `ENVIRONMENT.md`: env var names without secrets.
- `DATA_MODEL.md`: schema/domain model.
- `SECURITY.md`: threat model and access rules.

## Research / ML / Agents

- `EVALS.md`: evaluation protocol and datasets.
- `PROMPTS.md`: prompt registry and prompt contracts.
- `MEMORY.md`: memory model and retention rules.
- `RETRIEVAL.md`: source priority and retrieval behavior.
- `AGENT_ROLES.md`: agent routing and responsibilities.

## Creative / Media

- `STYLE_GUIDE.md`: voice/visual/audio taste.
- `ASSET_PIPELINE.md`: generation/export/render rules.
- `CONTENT_CALENDAR.md`: publishing plan.
- `REFERENCE_BOARD.md`: curated references, not raw dumps.

## Regulated / Client Work

- `COMPLIANCE.md`: legal/regulatory boundaries.
- `CLIENT_CONTEXT.md`: stakeholder/project-specific context.
- `RISK_REGISTER.md`: known risks and mitigations.
- `CHANGE_CONTROL.md`: approval and release process.

Rule: add situational files only when they remove pressure from core files or prevent repeated confusion.
