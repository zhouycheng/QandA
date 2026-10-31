# Agent Instructions

## Language boundary

- Write Agent-facing instruction files in English. This includes `AGENTS.md`, project-level `SKILL.md` files, CI workflow instructions, and other files primarily consumed by Agents.
- Write human-facing project documentation in Chinese, especially files under `docs/`.
- Communicate with users in Chinese. Commit plans, confirmation questions, warnings, errors, progress updates, and final reports must be in Chinese.
- Generate commit messages and pull request titles and descriptions according to `docs/git-workflow.md`; their descriptions must be in Chinese.
- Keep detailed Git rules in `docs/git-workflow.md` instead of duplicating them here.

## Where to start

Read the notes for the area you are touching before editing anything:

| Area | File |
| --- | --- |
| `apps/miniapp` (WeChat mini program) | `apps/miniapp/AGENTS.md` |

Each of those files carries the verification commands for that area and the traps that have
already cost a debugging round. Do not re-derive them.

## Admin UI density

- Use the existing breadcrumb to identify top-level management pages. Do not repeat the page name and a generic introduction above the working content.
- Add headings or explanations only when they provide useful context for the current task. Keep entity names, section headings, and actionable field guidance when they help users work.
