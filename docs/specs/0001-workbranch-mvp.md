# 0001 Workbranch MVP Spec

## Goal

Workbranch creates AI-friendly task workspaces for one repo or many independent Git repositories.

It keeps every repo as a normal Git repo, then uses `git worktree` so one task folder can contain linked worktrees for all configured repos.

```text
fullstack
├── .workbranch.config
├── _base
│   ├── frontend
│   └── backend
└── login
    ├── frontend
    └── backend
```

Run the AI agent from the task folder:

```bash
cd fullstack/login
codex
```

## Config

The config file is `.workbranch.config` in the project root.

```text
PROJECT_NAME fullstack
MAIN_WORKTREES_DIR _base
BRANCH_PREFIX feature
PREFERRED_LANGUAGE en
IDE open -na Cursor --args --new-window
TERMINAL open -a Warp
TASK_SETUP sh scripts/workbranch-setup.sh

REPO frontend git@github.com:example/frontend.git master
REPO backend git@github.com:example/backend.git feature/cpq

REPO_SETUP frontend pnpm install
REPO_SETUP backend ./gradlew dependencies
```

Format:

```text
PREFERRED_LANGUAGE en|ko
IDE <command>
TERMINAL <command>
TASK_SETUP <command>
REPO <name> <git-url> <base-repo-branch>
REPO_SETUP <repo> <command>
```

Rules:

- `PROJECT_NAME` must be a safe directory name.
- `MAIN_WORKTREES_DIR` must be a safe directory name.
- `BRANCH_PREFIX` is retained for compatibility with explicit task keys that do not use the conventional `type-detail` form. New interactive setup does not ask for it; config writing keeps `BRANCH_PREFIX feature` as an internal compatibility default.
- `PREFERRED_LANGUAGE` is optional in older configs and defaults to `en`. Current config writing emits `PREFERRED_LANGUAGE en|ko`; it controls generated task briefs and generated agent guidance, not full CLI localization.
- `IDE` is optional. It stores one project-level IDE launch command text after the directive.
- `TERMINAL` is optional. It stores one project-level terminal launch command text after the directive.
- `TASK_SETUP` is optional. It stores one project-level command text after the directive.
- `REPO` requires name, URL, and base repo branch.
- `REPO_SETUP` is optional. It references an existing repo name and stores one repo-level command text after the repo name.
- Repo names must be unique safe names.
- Git URLs and branch names must be non-empty and contain no whitespace.
- Config values are split on whitespace except `IDE`, `TERMINAL`, `TASK_SETUP`, and `REPO_SETUP`, which preserve command text.
- The file is not a shell script.
- Safety: `.workbranch.config` is trusted project configuration. Running `workbranch add <task>` executes configured setup commands with `sh -c`; running `workbranch ide <task>` or `workbranch terminal <task>` executes configured tool commands with the resolved path appended. Review configs from untrusted projects before running those commands.

## Branch names

Task folder names and Git branch names are separate values.

The recommended task identity is `type-detail` for the task folder. Each repo derives its default task branch from that task identity and the repo's configured base branch.

```text
task type feat / detail login + base master      -> task folder feat-login -> default branch feat/login
interactive task name task1 + shared base feature/cpq -> task folder feature-cpq-task1 -> default branch feature/cpq-task1
interactive add login         + base master      -> task folder feat-login -> default branch feat/login
non-interactive task login    -> task folder login      -> legacy default branch feature/login
base repo branch feature/cpq  + non-interactive task1   -> legacy default branch feature/cpq-task1
task folder feat-login        + override tk/login       -> chosen branch tk/login
```

Rule:

- `workbranch add` with no positional task asks for task type and detail name on `main`/`master`-style bases, then derives task folder `<type>-<detail>`. When every repo shares the same parent feature base, it asks only for task name and derives the folder by replacing `/` in the resulting branch with `-`.
- Interactive `workbranch add <detail>` enters the same base-aware task identity flow, using `<detail>` as the editable default: Task detail name on `main`/`master`-style bases, or Task name on a shared parent feature base.
- `workbranch add <task>` that starts with a known type followed by `-` is accepted as a direct conventional task key; the detail is everything after the first `-`.
- For conventional task keys, repos on `main`/`master`-style bases default to `<type>/<detail>`. Repos on parent feature bases such as `feature/cpq` or `feat/cpq` default to `<base-branch>-<detail>`.
- Non-interactive `workbranch add <task>` values without the conventional `type-` prefix keep the legacy default rule for script compatibility: parent feature base branches become `<base-branch>-<task>`, otherwise the default is `<BRANCH_PREFIX>/<task>` with `feature` as the compatibility fallback.
- Task command arguments may include a completion-added trailing `/`; commands normalize that trailing slash before validation. Embedded slashes and path-like task arguments are still invalid.
- Chosen branches are validated with `git check-ref-format --branch`; whitespace is not supported.
- Chosen branches are persisted in `<task>/.workbranch.task` as `REPO_BRANCH <repo> <branch>` lines so later commands use the real branch.
- Existing task workspaces without metadata keep working by falling back to the current task worktree branch, then the default rule.

Git operation internals are defined in [`docs/git-operations.md`](../git-operations.md).

## Commands

### `workbranch config`

Create or update config without cloning repos.

If `.workbranch.config` or legacy `.tasktree.config` / `.monotree.config` already exists in the current project, load it, then prompt for the project name, main worktrees directory, preferred language for generated task guidance, IDE command, terminal command, each repo's base branch, and each repo-level setup command. Press Enter to keep the current value. Type `--clear` at a tool or repo setup prompt to remove that command.

Changing a repo base branch in the full `workbranch config` flow updates config and, for existing `_base/<repo>` worktrees, fetches `origin`, checks out the selected base branch, and pulls it with `--ff-only`. `workbranch config` does not clone, move, or rename existing worktrees. Existing `BRANCH_PREFIX` values are preserved silently; it is no longer an interactive setting. Changing `MAIN_WORKTREES_DIR` is allowed only before base worktrees exist. Once matching base worktrees exist, `workbranch config` rejects that change.

Existing project-level `TASK_SETUP` values remain supported for `workbranch add` and are preserved by `workbranch config` unless another explicit flow clears or migrates them. `workbranch config ide` and `workbranch config terminal` update only the matching tool command. `workbranch config language` updates only `PREFERRED_LANGUAGE`.

When a base branch changes after repos are cloned, `workbranch config` preflights each existing base worktree for a clean state and no rebase in progress before changing checkout state. Missing base worktrees are still handled by later `workbranch init`.

### `workbranch config base`

Update only repo base branch settings. For existing `_base/<repo>` worktrees, this uses the same fetch, checkout, and `--ff-only` pull behavior as full `workbranch config`, so subsequent `workbranch add` uses the selected base branch without a preflight mismatch.

### `workbranch config --rewrite`

Rewrite `.workbranch.config` or legacy `.tasktree.config` / `.monotree.config` to the current `.workbranch.config` format without prompts and without cloning repos.

If no config exists, run interactive config setup:

1. Ask for target directory, default `.`.
2. Ask for project name, default `fullstack`.
3. Ask for main worktrees directory, default `_base`.
4. Explain that new tasks are created with `workbranch add`, which asks for task type and detail name, derives folder `type-detail`, then suggests each repo's task branch from that repo's configured base branch.
5. Ask for one or more repos: name, Git URL, base branch for this repo, and optional repo-level setup command.
6. For config-only setup, ask for optional IDE and terminal commands from presets or custom input.
7. Write `.workbranch.config` with `BRANCH_PREFIX feature` retained as a compatibility default and `PREFERRED_LANGUAGE en` by default.

### `workbranch init`

Initialize main worktrees from config.

- If `.workbranch.config` exists in the current directory, read it and clone each repo into `_base/<repo>` on its base repo branch. Legacy `.tasktree.config` / `.monotree.config` are also accepted by `workbranch init` and can be rewritten with `workbranch config`.
- If `.workbranch.config` does not exist, run interactive setup, then clone repos. After successful cloning from this interactive setup, ask whether to add the first task. Accepting enters the same task creation flow as `workbranch add`; EOF or a declined answer leaves the initialized project without creating a task. After the first-task prompt or task creation finishes, ask for preferred language for generated task guidance, then ask for optional IDE and terminal commands from presets or custom input and rewrite `.workbranch.config` with those settings.
- If cloning fails, remove paths created by the failed command.

### `workbranch path <task>`

Print the absolute task workspace path. With `--repo <repo>`, print the absolute path for one task repo worktree. This command writes only the path to stdout so it can be used in scripts. It never emits the banner, section titles, or ANSI color controls.

### CLI display and color

Interactive terminal output may use ANSI color, a compact help/init banner, and section markers for readability. Non-TTY output is plain by default. `NO_COLOR` disables ANSI/color/banner enhancement and takes precedence over `WORKBRANCH_COLOR=always`. `WORKBRANCH_COLOR` accepts `auto`, `always`, or `never`.

Examples in this spec show the plain output shape. Enhanced terminal output may render section headings with `➤` and color status labels, but command semantics and machine-sensitive outputs such as `workbranch path` remain unchanged.

### Platform support

Core commands support macOS, Linux, and WSL. Operational commands fail on unsupported platforms before project parsing with `unsupported platform: <platform>; workbranch supports macOS, Linux, and WSL`. `help` and `version` remain available on unsupported platforms.

Tool app launcher commands are macOS-only: `finder`, `ide`, and `terminal`. Tool-specific config commands are also macOS-only: `config ide` and `config terminal`. Full `config` and `init` remain available on Linux/WSL and skip tool app prompts.

### `workbranch finder <task>` / `workbranch ide <task>` / `workbranch terminal <task>`

`finder` opens the task root folder by default and one repo folder with `--repo <repo>`. `ide` runs the configured command once per matching task repo worktree by default. `terminal` opens the task root once by default so agent sessions can see `AGENTS.md`, `TASK-WORKBRANCH.md`, and every repo. With `--repo <repo>`, both `ide` and `terminal` run only for that repo and append the resolved repo path as the final argument. Tool launchers do not modify repositories.

Built-in macOS IDE app presets use `open -n` plus `--args --new-window` for VS Code-like apps so each matching repo path opens in a separate IDE window instead of being folded into an existing workspace. `IDE open -a Cursor`, `IDE open -a "Antigravity IDE"`, `IDE open -a "Visual Studio Code"`, and `IDE open -a Windsurf` are normalized to the matching `open -na ... --args --new-window` command at launch time. Zed remains `open -na Zed` until its CLI contract is verified.

### `workbranch list` / `workbranch list --json`

Show configured repos, base branches, current branches, and task workspaces. `--json` emits a single machine-readable document with `schemaVersion`, `project`, `root`, an optional project-level `baseRepos` array, and a `tasks` array containing registered task workspaces only. Schema version 1 includes additive task progress fields for companion apps: `planTitle`, `status`, `progressDone`, `progressTotal`, `currentItem`, and `updatedAt`, alongside `notiCount` and `repos`. The required `memoTitle` field remains a legacy wire-compatibility alias for the first H1; new Companion semantic models must not depend on it. `updatedAt` is the task brief mtime as epoch seconds. Stale or partial task-shaped directories are excluded from `tasks` and remain diagnostic concerns for `doctor`/status-style flows.

`baseRepos` reports every configured base repository in configuration order, including missing or unreadable repositories. Older CLI documents may omit the array; Companion normalizes omission to `[]`. Every emitted base row has these ten required fields, as defined in `packages/contract/schema/workbranch-list.schema.json`:

| Field | Meaning |
| --- | --- |
| `name` | Configured repository name. |
| `baseBranch` | Configured base branch. |
| `branch` | Current branch; empty when detached, missing, or unavailable. |
| `present` | Whether the configured path was confirmed as the actual Git worktree root, not a bare repository or an ancestor repository. |
| `dirty` | Whether porcelain status contains changes. |
| `changedFiles` | Non-negative porcelain status line count, using the same rule as task repositories. |
| `remoteAvailable` | Whether `refs/remotes/origin/<baseBranch>` resolves to a commit. |
| `ahead` / `behind` | Non-negative commit counts comparing HEAD with that cached remote-tracking commit, not the current branch's upstream. |
| `inspectionError` | `null`, `"invalid-worktree"`, or `"git-read-failed"`. |

Reads do not fetch. Confirmed missing worktrees use `present:false` and `inspectionError:null`; a confirmed absent remote ref uses `remoteAvailable:false` and zero difference counts. Invalid worktree paths and unexpected Git inspection failures remain local to their base row. They preserve `name`/`baseBranch`, reset unavailable Git facts to empty/false/zero sentinels, and set `inspectionError`; consumers must show an unavailable state rather than interpreting those sentinels as CLEAN or synchronized. `present` stays true on later inspection failure only if worktree-root validation succeeded. A base-row inspection error alone does not fail the project document, suppress otherwise registered tasks or healthy sibling rows, or add a project error to the `list --global --json` wrapper's `errors` array. Malformed project configuration/root failures retain existing project-level error handling.

Companion counts successfully loaded projects that contribute either task rows or base repository rows; task totals remain task-only. Its PULL/PUSH/CHECK labels are non-interactive guidance based on the cached facts, not execution guarantees. Dirty + behind advises CHECK before PULL; inspection failures advise CHECK.

### `workbranch memo` / `workbranch noti`

`workbranch add <task>` creates workbranch-managed task-root state outside repo worktrees: `<task>/TASK-WORKBRANCH.md`, generated `<task>/AGENTS.md`, and `<task>/.workbranch/` as needed. The task root is a non-git workbranch metadata/agent workspace; actual Git repositories live under `<task>/<repo>`. Workbranch does not create repo-local task-state files and does not edit repo `.gitignore`.

The generated task brief contains exactly a task-name H1 and `status: todo` on the next line. The H1 may later be renamed to the current Plan title. Generated guidance requires updating only the `status:` line on stage transitions through `todo → planning → in-progress → review → done`, with meaningful work including planning moving `todo` to `planning` immediately. `blocked` is an execution-only pause entered from `in-progress`; unblocking restores `in-progress`, so schema v1 does not need a second prior-stage field. Checklists, a separated `plan:` line, and notes are optional and are added only when the user explicitly requests them. For older briefs without explicit status, progress may still be derived from checklist items (`todo` for no completed checklist work or no checklist, `in-progress` for partial progress, `done` for all items complete); the first unchecked item is the current item. When `PREFERRED_LANGUAGE ko` is configured, generated AGENTS guidance text uses Korean while preserving machine-readable `status:` values.

`workbranch memo <task>` prints the task brief, `workbranch memo <task> "text"` overwrites it, and `workbranch memo <task> --clear` removes it. From inside a registered task workspace, the task may be omitted only for reading; `workbranch memo` reads the current task. Writes and clears require an explicit task argument.

`workbranch noti add <task> "text"` appends a JSON Lines event with UTC `ts` and `text`; `workbranch noti list <task>` prints notification text oldest-first; `workbranch noti clear <task>` clears the inbox. Missing notification files behave as empty inboxes.

`workbranch remove <task>` deletes workbranch-managed task state after successful worktree/branch removal: `TASK-WORKBRANCH.md`, generated `AGENTS.md`, `.workbranch/`, `.omx/`, and `.omc/`. If unrelated files remain, normal remove reports them and prompts the user to delete the remaining task root in the same command flow. `--force` deletes the task root without prompting after the normal safety preflights pass.

### `workbranch status`

Show base commit position versus its cached remote-tracking branch, task commit position versus local base, clean/dirty state, and the next suggested action.

```text
[*] Base worktrees
    repo        branch           commit     remote  status    next
    frontend    master           a1b2c3d4e  -1      clean     pull
    backend     master           f6e7d8c9a  0       untracked -

[*] Task workspaces
[*] login
    repo        base       task       diff  status    next
    frontend    a1b2c3d4e  f6e7d8c9a  +3    clean     land
    backend     a1b2c3d4e  a1b2c3d4e  0     modified  -

[*] Next
    pull    base is behind remote: workbranch pull
    push    base has commits not in remote: workbranch push
    land    task has commits not in base: workbranch land <task>
    update  task is behind base: workbranch update <task>
```

When a task and its base have both moved (the `diff` column shows `±<base>/<task>`), `next` shows the combined sequence `update -> land`: update the task from base first, then land it.

### `workbranch add [<task>] [--from <ref>]`

Create one task workspace with one linked worktree per repo. Without `<task>`, prompt for task type and detail name and derive the recommended `type-detail` task key.

For each repo:

1. Ensure `_base/<repo>` exists and is clean.
2. Show the repo's configured base branch, then prompt for the task branch name, defaulting from the branch naming rule above.
3. Fail if the chosen local or remote task branch already exists. Local task branches can be deleted with `workbranch remove <task>` before adding again; remote-only task branches must be deleted or renamed outside workbranch.
4. Create the task directory and write `<task>/.workbranch.task`.
5. Create a new local task branch from the base branch, or from the resolved `--from` source ref when provided. Bare `--from feat/x` prefers `origin/feat/x`; explicit `origin/feat/x`, `refs/...`, `HEAD`, and existing local refs are also accepted.
6. Create a linked worktree at `<task>/<repo>`.
7. Run configured repo-level setup commands. If no repo setup ran and the operation is not repo-filtered, run project-level `TASK_SETUP` when configured.

If any repo fails, roll back paths and branches created by the command.
If any setup command fails, keep created worktrees and tell the user the exact failed setup context, setup directory, and setup command. The user can fix setup with `workbranch config`, then rerun the command shown in the failure output or remove and add the task again.

The project-level setup command runs from the project root with these environment variables:

```text
WORKBRANCH_PROJECT_ROOT
WORKBRANCH_TASK
WORKBRANCH_TASK_DIR
WORKBRANCH_BASE_DIR
WORKBRANCH_REPOS
```

Repo-level setup commands run from `<task>/<repo>` with the same variables plus:

```text
WORKBRANCH_REPO
WORKBRANCH_REPO_DIR
WORKBRANCH_BASE_REPO_DIR
```

Safety: `.workbranch.config` is trusted project configuration. Setup commands are executed with `sh -c`.

### `workbranch pull`

Update base worktrees from remote base branches.

For each repo:

```bash
cd _base/<repo>
git pull --ff-only origin <base-branch>
```

Fails if any base worktree is dirty.

### `workbranch update`

Update every task worktree from its local base worktree.

For each task and repo:

```bash
cd <task>/<repo>
git rebase <_base/repo HEAD>
```

Fails if any target task worktree is dirty.
Fails if any matching base worktree is not checked out to the configured base branch.
Fails if any matching base worktree has a rebase in progress.

### `workbranch update <task>`

Same as `workbranch update`, but only for one task workspace.

### `workbranch refresh [<task>]`

Pull remote base branches into local base worktrees, then update task workspaces from those refreshed local bases.

Without `<task>`, `refresh` updates every task workspace. With `<task>`, it updates only that task workspace. Before pulling, `refresh` preflights the target task worktrees the same way `workbranch update` does. If any target task worktree is dirty, missing, on the wrong branch, or has a rebase in progress, no base branch is pulled.

For the pull phase:

```bash
cd _base/<repo>
git pull --ff-only origin <base-branch>
```

For the update phase:

```bash
cd <task>/<repo>
git rebase <_base/repo HEAD>
```

### `workbranch push`

Push base branches to origin.

For each repo:

```bash
cd _base/<repo>
git push origin <base-branch>
```

### `workbranch push <task>`

Push task branches to origin.

For each repo in the task:

```bash
cd <task>/<repo>
git push -u origin <task-branch>
```

### `workbranch land <task>`

Land task branches into base branches. This must not create merge commits.

For each repo:

```bash
cd _base/<repo>
git checkout <base-branch>
git pull --ff-only origin <base-branch>
git merge --ff-only <task-branch>
```

This is useful when the base repo branch is already a parent feature branch, such as `feature/cpq`. Run `workbranch push` afterward to push the updated base repo branch.

### `workbranch finalize <task>`

Finalize one task into local base branches by running the safe local closeout flow:

1. Pull selected base branches from origin.
2. Update the selected task workspace from refreshed local base worktrees.
3. Land the selected task branches into local base branches.

`finalize` does not push base branches and does not remove the task workspace. Run `workbranch push` and `workbranch remove <task>` explicitly after reviewing the local result.

Before pulling, `finalize` preflights both the base pull path and the task update path: selected base worktrees must exist, be on the configured branch, be clean, have no rebase in progress, be fetchable, and be fast-forwardable; selected task worktrees must exist, be on their task branches, be clean, and have no rebase in progress. If any preflight fails, no base branch is pulled. After update succeeds, `finalize` runs land preflight before any land operation so one blocked repo does not partially land another repo.

### `--repo <repo>`

Git and tool operations default to every configured repo. Add `--repo <repo>` to limit the operation to one repo.

Examples:

```bash
workbranch pull --repo frontend
workbranch update --repo frontend
workbranch update login --repo frontend
workbranch push --repo frontend
workbranch push login --repo frontend
workbranch land login --repo frontend
workbranch finalize login --repo frontend
```

### `workbranch remove <task>`

Remove linked worktrees and local task branches for a task.
Remote task branches are not deleted.

If the task worktree directory was removed manually, `workbranch remove <task>` still deletes the local task branch when workbranch can identify it from metadata, an existing task worktree, stale Git worktree registration, or the default branch rule.

After repo worktrees and known task state are removed, any remaining task-root entries are non-git leftovers. Normal remove lists them and asks once before deleting the entire task root; `--force` removes the task root without that prompt after safety preflights pass. Agent runtime folders such as `.omx/` and `.omc/` are treated like other non-git leftovers and are not silently deleted by the known-state cleanup step.

Fails if any task worktree is dirty.
Use `workbranch remove <task> --force` to discard dirty local task worktrees and local task branches.

### `workbranch prune`

Remove task workspaces that are already fully merged into the configured local base branches.

For each healthy task workspace, `prune` checks every configured repo:

- the base worktree exists and is checked out to its configured base branch;
- the task worktree exists, is checked out to its task branch, is clean, and has no rebase in progress;
- the task branch exists locally; and
- the task branch is an ancestor of the configured local base branch.

Only tasks that pass for every repo are removed. Unmerged, dirty, partial, stale, or branch-drifted tasks are skipped with a reason. `prune` removes local task worktrees and local task branches only; it does not push and does not delete remote task branches.

### `workbranch version`

Print the installed CLI version as `workbranch <version>`. `workbranch -v` and `workbranch --version` are aliases. The generated single-file executable embeds the version from `.release-please-manifest.json` at build time and falls back to `0.0.0-dev` when no manifest version is available.

## Safety

- Do not overwrite existing worktrees or branches.
- `workbranch config --rewrite` may rewrite an existing `.workbranch.config` to the current format without cloning repos.
- Fail before destructive operations if a target worktree is dirty.
- Use `--ff-only` for pull and merge operations.
- On command-local creation failure, roll back paths and branches created by that command.
- Leave conflict resolution to Git and the user. When preflight detects a rebase conflict, diverged pull path, or non-fast-forward land path, fail before mutating the target worktree and print the manual command sequence for that repo.

## Installer

`install.sh` copies `bin/workbranch` to a target directory. The default is `~/.local/bin`. Standalone installs default to the `main` raw GitHub URL, so the common pasteable install command is `curl -fsSL https://raw.githubusercontent.com/tkhwang/workbranch/main/install.sh | bash`. Pinned tag or SHA installs may pass `WORKBRANCH_RAW_BASE_URL` so the downloaded executable uses the same ref as the installer script.

If the target directory is not on `PATH`, the installer asks whether to add it to the user's shell profile.

- zsh: `~/.zshrc`
- bash: `~/.bash_profile`

If the user declines, print direct-run and manual PATH guidance.

## Acceptance checks

- `config` writes config without cloning base worktrees.
- `init` clones base worktrees from config, or writes config then clones when no config exists.
- `add` creates task worktrees with expected branch names.
- `status` shows base/task commits, diff, and dirty state.
- `pull` fast-forwards base worktrees.
- `update` updates all task worktrees.
- `update <task>` updates one task workspace.
- `push` pushes base branches.
- `push <task>` pushes task branches.
- `land <task>` lands task branches into local base branches without merge commits.
- `finalize <task>` pulls base branches, updates one task, and lands it locally without pushing or removing the task workspace.
- `--repo <repo>` limits supported Git commands to one repo.
- `remove <task>` removes linked worktrees and local task branches.
- `prune` removes clean task workspaces already merged into local base branches.
- `-v`, `--version`, and `version` print the manifest-backed installed CLI version.
- Dirty worktree checks prevent unsafe operations.
- Integration tests use temporary local bare remotes.
