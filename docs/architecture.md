# Workbranch architecture

`workbranch` is a pnpm-workspace monorepo. Deployable apps live under `apps/*`: the Bash CLI supplier app is authored under `apps/cli/src/workbranch/**`, the Tauri/React companion consumer app lives under `apps/companion/**`, and the shared JSON contract snapshot lives under `packages/contract/**`. The CLI is still distributed as one generated executable at root `bin/workbranch` for raw install compatibility, with the canonical generated app artifact at `apps/cli/bin/workbranch`.

## Edit/build rule

- Edit `apps/cli/src/workbranch/**`.
- Run `apps/cli/scripts/build-workbranch.sh`.
- Commit source changes plus both generated artifacts: `apps/cli/bin/workbranch` and root compatibility `bin/workbranch`.
- Do not hand-edit `bin/workbranch`.

## Command boundary

Each user command should have one `apps/cli/src/workbranch/commands/<command>.sh` file.

A command file owns orchestration:

1. parse command-specific args
2. validate project/config/task names
3. run preflight checks before mutation
4. call `workbranch_git_*` functions for documented Git operations
5. print concise user-facing status

`apps/cli/src/workbranch/git-ops.sh` owns the exact mutating Git commands mirrored by `docs/git-operations.md`.

`apps/cli/src/workbranch/lib/preflight.sh` owns safety checks and aggregate preflight failure reporting.

`apps/cli/src/workbranch/lib/tool-launcher.sh` owns editor/terminal presets, task path resolution, and configured tool execution. It also owns the VS Code-family rule that prefers the app's bundled CLI (`<App>.app/Contents/Resources/app/bin/<cli> --new-window <repo-path>`) over `open -na ... --args`, so an already-open repo window is focused instead of leaving the IDE behind the caller. When the IDE was already running (`lsappinfo find bundlepath=...`), the launcher waits for the CLI's helper instance to exit (polling `ps -axo command=`, about two seconds at most) and then activates the IDE with `open -a <App>.app`, because the helper's exit hands focus back to the caller and focusing the IDE's current key window alone does not bring the app forward. That focus hand-back can land a moment after the helper is gone, so the launcher re-checks the frontmost app (`lsappinfo front`) four times over about three quarters of a second and repeats `open -a` only while the IDE is not in front. `WORKBRANCH_TEST_APPLICATIONS_DIR` overrides the `/Applications` and `~/Applications` lookup roots for tests. `apps/cli/src/workbranch/commands/path.sh` owns the stdout-only path command. `apps/cli/src/workbranch/commands/tool-launcher.sh` owns `editor` and `terminal` orchestration. These commands are not Git operations and do not modify repositories.


## Task root boundary

A task root (`<task>`) is a workbranch metadata/agent workspace outside Git. The actual Git repositories live under `<task>/<repo>`. Workbranch-owned task-root state is limited to the current-Plan `TASK-WORKBRANCH.md`, generated `AGENTS.md`, `.workbranch/` (including Plan archives under `.workbranch/plans/done/`), and `.workbranch.task`; other task-root entries are non-git leftovers. Remove flows first remove repo worktrees and task branches, then known metadata, then list any non-git leftovers and ask once before deleting the remaining task root unless `--force` is used.

`workbranch terminal <task>` opens the task root by default, while `workbranch ide <task>` opens repo worktrees. `PREFERRED_LANGUAGE en|ko` only affects generated task briefs and generated agent guidance; it is not full CLI localization.


## Companion activity boundary

Workbranch Companion owns activity-time tracking as local presentation state. The CLI continues to expose task state through `workbranch list --json` and `workbranch list --global --json`; there is no `workbranch report` command. The Tauri/React companion observes second-resolution `updatedAt` increases from `TASK-WORKBRANCH.md`, appends activity events to `~/.local/state/workbranch/activity.jsonl`, and computes today/week/month rollups in TypeScript application logic. Task briefs use `# <plan>` H1 sections with Plan-local `status:` lines. The brief is intended to contain the current Plan; completed Plans are archived by `workbranch done <task>` or confirmed land/finalize/pull prompts into `.workbranch/plans/done/<timestamp>-<slug>.md`. `workbranch list --json` keeps flat task fields for compatibility and exposes `plans[]` with 0-based Plan indexes; the Companion Home view renders only the active Plan while activity events still carry optional `plan` and `planIndex` fields for per-Plan time rows.

The activity log is append-only history. It is not removed by `workbranch prune`, `workbranch remove`, or Companion root self-heal, because deleted repo/task workspaces may still matter for later retrospectives. v1 does not provide activity-log deletion, compression, or rotation; if long-term size becomes a real issue, add an archive/rotation plan that preserves history by default.

## Distribution boundary

All install channels use the generated CLI artifact. `apps/cli/bin/workbranch` is canonical for the CLI app and root `bin/workbranch` is kept as the raw-install compatibility artifact:

- direct curl/wget downloads via root `install.sh`
- root `install.sh` checkout installs
- Homebrew formula installation from a release tarball

Homebrew can support multi-file runtime payloads through private install directories, but this project intentionally keeps the runtime as one file so all install channels behave the same.

## Optional packaging checks

Run these only when Homebrew is available locally:

```bash
brew audit --strict --online packaging/homebrew/workbranch.rb
brew test packaging/homebrew/workbranch.rb
```
