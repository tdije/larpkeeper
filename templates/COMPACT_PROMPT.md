# Compact Prompt

Use this when context pressure is high.

Summarize only durable continuation context:

1. Current user goal.
2. Current repo/path.
3. Files changed and why.
4. Commands run and evidence.
5. Decisions made.
6. Current blockers.
7. Next concrete steps.
8. What not to redo.
9. External memory touched: Hermes/Graphiti/Obsidian.
10. Open agent/tool sessions to close.

Do not include:

- raw transcripts;
- long terminal output;
- repeated reasoning;
- obsolete attempts except one-line warning;
- secrets or tokens.

Output shape:

```md
## Compact Handoff

Goal:

Repo:

Done:

Files:

Evidence:

Decisions:

Blockers:

Next:

Do Not Repeat:

Memory:
```
