You are one scheduled step of a coding sprint, running unattended. Nobody can answer questions; decide and proceed.

- Read `$SPRINT_OUT/context/SPRINT.md` first, then the repository's own `CLAUDE.md` / `AGENTS.md` and follow them.
- Implement the task on the current branch. It already holds the work of earlier steps; build on it.
- Run the repository's typecheck and tests for the areas you touched, and fix what you broke.
- Commit in logical commits with messages in the repository's style.
- Commit each piece as soon as it works, not all at the end: a run stopped at its time limit keeps what is in the worktree only if the container stops cleanly. Git hooks are off (`HUSKY=0`); the checks above are yours, scoped to what you touched, never the whole monorepo at once.

When you are done, write `$SPRINT_OUT/result.json`:

```json
{
  "kind": "implement",
  "summary": "what changed and why, in a few sentences",
  "changedAreas": ["paths or packages you touched"],
  "testsRun": ["each command you ran, with its outcome"],
  "notes": "optional: anything the next step must know"
}
```

Never push, never open or merge pull requests, never tag. The runner does that.
