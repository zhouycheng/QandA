---
name: git-workflow
description: Inspect Git changes, prepare coherent commits, and perform explicitly authorized commits, task-branch pushes, and pull-request actions using QandA's single-main workflow.
---

# Git Workflow

Read `docs/git-workflow.md` before planning changes. It is the project policy. Keep this file in English and communicate with the user in Chinese.

## Current workflow

Use `main` as the only integration branch. Start short-lived task branches from the latest `origin/main` and target pull requests at `main`.

Human approval is not a required merge gate during the initial project stage. A collaborator with write access may merge their own PR. This does not authorize an Agent to merge or delete anything without the user's permission.

Do not push directly to `main`, force-push, delete `main`, bypass branch protection, require a personal username prefix, or require a `develop` promotion PR. Branch names should describe the task; naming style is advisory, not a blocking validation rule.

## Preflight

Inspect the current branch, working tree, staged and unstaged changes, relevant untracked files, unresolved conflicts, and any in-progress merge or rebase. Run `git fetch origin --prune` before assessing remote state. If the network operation fails, report that remote synchronization could not be verified.

Compare with the same-named remote task branch when it exists. Separately compare with `origin/main` to understand integration drift. Do not treat `origin/main` or an unrelated upstream as the publication target of a task branch.

A newly created task branch may have no upstream. This is normal and does not block local commits. Before its first push, check whether a same-named remote branch already exists; inspect its history instead of overwriting it.

Remote task-branch commits absent locally block a push, not an otherwise conflict-free local commit. Being behind `main` alone does not block local commits; check integration conflicts before merging the PR.

Unresolved conflicts, detached HEAD, or an ambiguous in-progress history operation require inspection before writing. Never resolve these conditions by automatically running pull, merge, rebase, reset, stash, a force push, or history rewriting.

## New task branches

After checking and preserving existing work, use an explicitly authorized task branch:

```bash
git fetch origin --prune
git switch --no-track -c <task-branch> origin/main
```

Do not switch branches in a way that silently carries, discards, or overwrites unrelated user changes.

## Plan and authorization

Explain the proposed scope and coherent commit boundaries in Chinese. Keep inseparable functionality and its tests together. Do not mechanically split a change to increase the commit count.

Without explicit authorization, propose changes and ask before committing or publishing. When the user has already authorized the exact current operation and scope, carry it out without a redundant confirmation. Authorization to commit does not imply authorization to merge, delete branches, or change repository settings.

Treat all existing workspace changes as user-owned. Stage only files and hunks within the authorized scope. Do not mix unrelated edits, secrets, generated output, or temporary files into the commit.

## Execution

Recheck relevant state before writing, inspect the staged diff, run `git diff --cached --check`, and perform checks appropriate to the change. Do not claim a build or test passed if no corresponding runnable check exists.

Use informative commit messages, preferably `type(scope): Chinese description`. Do not create empty commits. After authorized commits succeed, publish only the task branch:

```bash
git push -u origin HEAD
```

Check the destination before pushing. This command is for a task branch, never `main`.

Stop on failure, preserve the worktree, and report the actual outcome. Do not bypass access controls or use destructive retries.

## Pull requests

Target `main`. Follow `.github/pull_request_template.md`, keeping its headings and writing the content in Chinese. Omit empty optional sections and repetitive boilerplate.

Creating, updating, merging, or deleting after a PR requires authorization for that action. Before an authorized merge, verify the current PR head, diff, mergeability, outstanding discussions, and any actual required checks. Use an expected head SHA when supported. Normal short-lived task PRs use squash merge unless the user requests another method.

Delete a task branch only after verifying its PR merged and no unmerged work remains. For the specifically requested retirement of `develop`, verify its latest commit is contained in `main` and no other open PR depends on it; respect deletion protection and report any missing administration capability.

In the final report, separate completed operations, unperformed operations, and blockers. Link or cite the actual PRs and commits. Do not describe planned settings as verified server-side configuration.
