# CLAUDE.md — ccgauge project rules

These rules apply to every Claude Code session opened in this repo. Any
later conflict with global `~/.claude/CLAUDE.md` is resolved in favor of
the global file (per Claude Code precedence); these are repo-local
additions.

## Commits

**Never auto-commit.** Even if a task feels finished, leave the changes
unstaged / unpushed unless the user has explicitly asked for a commit in
the current turn. Phrases like "make a commit", "commit and push",
"提交", "帮我 commit" count as explicit asks; anything more ambient
(e.g. "ok cool", "looks good") does **not**.

This also applies to:

- `git add -A` followed by `git commit`
- `git commit --amend`
- `git rebase` / `cherry-pick` operations that produce new commits
- `gh pr create` (only on request)
- Any tag / release operation

If a commit would normally be expected as part of a workflow, **stop and
ask** before running it.

## Identity (inherited from global, repeated for clarity)

When committing, the repo has a GitHub remote, so use:

```bash
git config user.name "chengzuopeng"
git config user.email "mrchengzp@qq.com"
```

No AI-attribution trailers in commit messages.
