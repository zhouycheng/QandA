---
name: git-workflow
description: Review the current Git workspace, verify branch synchronization, propose logically separated commits, obtain explicit user approval, create the approved commits, push the current branch, and prepare a pull request message. Use this skill whenever the user asks to inspect, organize, commit, push, or prepare a PR for current Git changes.
---

# Git Workflow

Follow this workflow for all current-workspace commit and pull-request tasks.

## Language

This file is written for Agents and must remain in English. Communicate with the user in Chinese at every point, including status updates, commit plans, questions, errors, and the final result. Generated commit messages and pull-request content must follow the Chinese output rules in `docs/git-workflow.md`.

## Source of truth

Read `docs/git-workflow.md` before planning or committing. Treat it as the detailed project Git policy. Do not invent a conflicting branch, commit, or pull-request rule.

## Preflight checks

Run the following checks before proposing any commit:

1. Inspect the current branch with `git branch --show-current`.
2. Inspect the working tree with `git status --short`.
3. Identify the upstream with `git rev-parse --abbrev-ref --symbolic-full-name '@{u}'`.
4. Check unresolved merge or rebase conflicts with `git ls-files --unmerged` and the Git metadata state.
5. Run `git fetch origin --prune`.
6. Compare `HEAD` with the upstream using `git rev-list --left-right --count HEAD...@{u}`.

Interpret the synchronization result as follows:

- `behind > 0` means the branch is not current. Stop and report this in Chinese.
- `behind > 0` and `ahead > 0` means the branch has diverged. Stop and report this in Chinese.
- `behind == 0` and `ahead >= 0` allows the workflow to continue.
- A missing upstream is a blocking condition. Stop and report it in Chinese.
- Any unresolved conflict is a blocking condition. Stop and report it in Chinese.

Do not automatically pull, merge, rebase, reset, stash, or rewrite history to resolve a blocking condition.

## Branch validation

Validate the current branch against:

```text
gitname/type/description
```

Use the GitHub username for `gitname`. Allow only these values for `type`:

```text
feat fix chore docs test refactor build ci
```

Require `description` to contain lowercase English letters, digits, and hyphens only. Do not rename an invalid branch automatically. Report the violation in Chinese and stop before planning commits.

Do not perform daily development commits on `main` or `develop`.

## Change analysis and commit plan

Inspect the complete current change set, including staged changes, unstaged changes, and relevant untracked files. Do not use a broad staging command that would silently include unrelated files.

Group changes by logical responsibility. Separate independent documentation, tests, features, fixes, refactors, build changes, and CI changes when they can be reviewed independently. Do not split a single inseparable change only to increase the commit count.

Before changing the worktree, present the plan in Chinese using this structure:

```text
Commit plan (write all explanatory text in Chinese):

1. Message: type(scope): <Chinese description>
   Content: <Chinese description of the changes>
   Reason: <Chinese explanation of why this commit is independent>

2. Message: type(scope): <Chinese description>
   Content: <Chinese description of the changes>
   Reason: <Chinese explanation of why this commit is independent>
```

Ask the user in Chinese whether the plan is approved. Do not stage, edit, commit, or push anything before explicit approval.

## Approved execution

After explicit approval:

1. Repeat the preflight checks. If the workspace or upstream changed, update the plan and ask for approval again when the change affects commit boundaries.
2. Stage only the files assigned to the first approved commit.
3. Run `git diff --cached --check`.
4. Create the commit with the exact approved message.
5. Repeat the staging, validation, and commit steps for each approved segment.
6. Do not create empty commits.
7. Do not force-push, merge, rebase, reset, stash, or rewrite history.
8. After all commits succeed, push with:

   ```bash
   git push -u origin <current-branch>
   ```

If staging, commit, or push fails, stop, preserve the worktree, and explain the failure in Chinese. Do not retry with a destructive or history-rewriting alternative.

## Pull request message

After a successful push, provide a PR title and body in Chinese. Do not create the PR automatically.

Use this title format:

```text
type(scope): <Chinese description>
```

Use this body format:

```markdown
## Summary

- <Chinese summary of what changed and why it was needed>
- <Chinese issue or design-document link when relevant>

## Notes

- <Chinese notes about migration, compatibility, risk, screenshots, or special decisions when relevant>
```

Keep the `Summary` and `Notes` headings because they are part of the project convention, but write their content in Chinese. Omit `Notes` when it has no useful content.

Do not add `Verification`, routine test commands, complete file lists, commit lists, document lists, or generic rollback language to the PR body.

## Safety rules

- Treat existing workspace changes as user-owned.
- Do not overwrite, delete, or silently exclude existing changes.
- Include untracked files in a commit only when the approved plan assigns them to that commit.
- Keep user-facing communication in Chinese even though these instructions are in English.
