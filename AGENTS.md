# WorkProof Repository Guardrails

These instructions apply to the entire WorkProof repository and to every Codex task performed in it.

## Scope and repository identity

- Work only inside `C:\Users\gdohy\OneDrive\바탕 화면\CJ\WorkProof`.
- The only allowed GitHub repository is `dohyeon16/WorkProof`.
- Do not inspect, read, search, or modify parent directories, sibling projects, other repositories, or any path outside this repository.
- Treat `mobile/frontend` as the frontend root and `mobile/backend` as the backend root.

## Secrets and protected files

- Never read, print, modify, copy, or commit `.env` files, API keys, OAuth tokens, credentials, or other secrets.
- In particular, never access `mobile/frontend/.env`, `mobile/frontend/.env.local`, or `mobile/backend/.env`. Files named `.env.example` are allowed.

## Git and GitHub workflow

- Never push directly to `main`.
- For every tracked change, use this workflow: create a branch, commit, push the branch, open a pull request, wait for all required CI checks to pass, and then merge.
- Never force-push. Never run `git reset --hard` or `git clean`.
- Do not use destructive commands or discard, overwrite, or rewrite user work.

## Protected archive worktree

- Do not modify, reset, delete, clean, move, or otherwise disturb `mobile/archive/worktrees/WorkProof-backend-payslip`.
- Its following three uncommitted changes must be preserved exactly:
  - `backend/app/api/v1/users.py`
  - `backend/app/services/work_data.py`
  - `backend/tests/test_work_data_reset.py`
- Preserve all other unique or uncommitted data under `mobile/archive` as well.

## Architecture

- Keep OCR and AI Summary separate in their existing frontend and backend service areas. Do not merge, reorganize, or blur these boundaries without explicit user authorization.
- Frontend work belongs under `mobile/frontend`; backend work belongs under `mobile/backend`.

## Verification and responsibility

- After frontend changes, run `npx tsc --noEmit` and `npm test` from `mobile/frontend` and require both to pass.
- After backend changes, run `pytest` from `mobile/backend` and require it to pass.
- Codex must directly perform all feasible automated work, including Git, GitHub CLI, tests, and CI monitoring. Leave only validation that genuinely requires physical-device interaction to the user.
- Follow the repository's `CLAUDE.md` safety and project rules, interpreting Claude-specific guidance appropriately for Codex.
