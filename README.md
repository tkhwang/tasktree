# workbranch

<p align="center">
  <img src="./assets/readme/hero-en.svg" width="100%" alt="workbranch creates one feature task folder across multiple repositories and Companion groups active tasks into PLAN, EXECUTION, and REVIEW stages.">
</p>

**English** | [한국어](README.ko.md)

[![CI](https://github.com/tkhwang/workbranch/actions/workflows/ci.yml/badge.svg)](https://github.com/tkhwang/workbranch/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/tkhwang/workbranch?sort=semver)](https://github.com/tkhwang/workbranch/releases)
[![License: MIT](https://img.shields.io/github/license/tkhwang/workbranch)](LICENSE)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-informational)

Manage Git worktree task spaces without memorizing `git worktree` commands.

`workbranch` creates one task folder per feature, works with one repo or many repos, and keeps branch refresh commands short and safe.

The CLI reads shared workbranch project state and runs the task worktree/Git flow. Companion groups active tasks into PLAN, EXECUTION, and REVIEW stages in the macOS menu bar. Its Activity view builds a timeline from the separate local append-only activity log.

![workbranch demo](./docs/figs/workbranch-demo.gif)

## At a glance

| When you need to | Use | Role | Install |
| ---------------- | --- | ---- | ------- |
| Create, refresh, land, or push task workspaces | `workbranch` CLI | Runs the actual Git/worktree workflow | `brew install tkhwang/tap/workbranch` |
| Check task stages, Plan progress, repo state, activity timelines, and notifications | Workbranch Companion | Shows workspace state and local activity-log history from the menu bar | `brew install --cask tkhwang/tap/workbranch-companion` |

## Quick start

```bash
brew install tkhwang/tap/workbranch
workbranch init                 # register a project and repos; can create the first task
workbranch add login            # create another task whenever you need one
cd feat-login                   # task root: run your AI agent here
workbranch status               # check every repo in the task
```

On macOS, install Companion too:

```bash
brew install --cask tkhwang/tap/workbranch-companion
```

## Install

### Homebrew

```bash
brew install tkhwang/tap/workbranch
```

If you prefer to add the tap first:

```bash
brew tap tkhwang/tap
brew install workbranch
```

### curl installer

```bash
curl -fsSL https://raw.githubusercontent.com/tkhwang/workbranch/main/install.sh | bash
```

Homebrew installs published releases. The curl installer tracks `main`.

## Create your first project

`workbranch init` walks you through setup and can create your first task on the spot.

```bash
workbranch init
# Project name, then register one repo (name + Git URL + base branch)
# "Add another repo?"    -> N       # one repo is enough to start
# "Add your first task?" -> login   # creates the feat-login workspace
```

Need another task later? Create one anytime with `workbranch add`.

```bash
workbranch add login # (branch) feat/login
                     # (folder) feat-login/<repo>
```

These quick-start examples assume a `main`/`master` base. If every repo is based on the same parent feature branch, such as `feature/cpq`, `workbranch add login` asks only for the task name and creates folder `feature-cpq-login/<repo>` with branch `feature/cpq-login`.

## What the CLI creates

For every task, the CLI creates linked worktrees under one shared task directory:

```text
my-app-workspace
├── .workbranch.config
├── _base
│   ├── frontend
│   └── backend
└── feat-login          // task root: not git-managed; run your AI agent here
    ├── frontend        // Git repo worktree
    └── backend         // Git repo worktree
```

For multi-repo products, `workbranch` gathers every repo an agent needs into one task folder. That makes AI-agent sessions easier to start, inspect, and clean up than juggling separate clones or unrelated worktrees.

Before an agent starts, `workbranch refresh <task>` brings every repo in the task up to the latest base in one command — no per-repo pulling or rebasing.

See [AI agent workflows](docs/ai-agents.md) for the multi-repo benefits.

Companion reads this structure through `workbranch list --global --json`. Its Main view shows a compact `00 BASE` group with each base repo's branch, dirty state, and ahead/behind counts against cached `origin/<baseBranch>` refs, followed by tasks grouped by Plan stage. PULL/PUSH/CHECK pills are guidance only; dirty + behind advises CHECK first, and an unreadable repo shows UNAVAILABLE without hiding healthy data. Reads do not fetch. The Activity timeline reads from the separate local append-only log; task creation, refresh, land, and push remain CLI actions.

## Working on a task

Now work inside the task workspace. The task root (`<task>`) is a non-git workbranch metadata/agent workspace; the actual Git repos live under `<task>/<repo>`. Before editing a repo, read and follow repo-local agent instructions such as `<task>/<repo>/AGENTS.md`, `<task>/<repo>/CLAUDE.md`, or `<task>/<repo>/.claude/` when present.

```bash
# macOS: open code repos in the IDE, and the task root in the terminal
workbranch ide feat-login        # opens feat-login/<repo> worktrees
workbranch terminal feat-login   # opens feat-login task root

# or anywhere
cd feat-login/<repo>
# edit code and run git commands in the repo
```

Need the latest base while you work? See [Staying up to date](#staying-up-to-date). When the work is done, [ship it](#two-ways-to-ship).

## Staying up to date

To bring a single task up to the latest base, `pull` the base from its remote and `update <task>` to apply it to the task.

```bash
workbranch pull               # pull every base from its remote
workbranch update feat-login  # apply local base updates to every repo in the task

# combined: pull + update in one step
workbranch refresh feat-login
```

Working in several tasks at once? Run them without a task name to refresh every task in one go.

```bash
workbranch pull      # update local bases
workbranch update    # apply local bases to every task

# combined
workbranch refresh   # pull bases, then update every task
```

To refresh the base, apply it to a task, and land in one step, use `finalize`.

```bash
workbranch finalize feat-login   # base pull → feat-login update → land
```

## Two ways to ship

What `push` publishes depends on your base branch.

|                      | Feature flow                    | Stacked flow                                            |
| -------------------- | ------------------------------- | ------------------------------------------------------- |
| Base branch          | `main` / `master`               | a feature branch, e.g. `feat/login`                     |
| Task branch (folder) | `feat/login` (`feat-login`)     | `feat/login-part1` (`feat-login-part1`)                 |
| Ship                 | push the task branch, open a PR | land into base, then push the base                      |
| Command              | `workbranch push feat-login`    | `workbranch land feat-login-part1`<br>`workbranch push` |
| Pushes               | task branch                     | base branch                                             |

### Feature flow

```bash
# edit code in feat-login/<repo>

workbranch push feat-login # local feat/login -> origin/feat/login
```

### Stacked flow

```bash
# edit code in feat-login-part1/<repo>

workbranch land feat-login-part1 # fast-forward feat/login-part1 into local base (feat/login)
workbranch push                  # local feat/login -> origin/feat/login
```

## Commands

| Command                     | Use it to                                                               |
| --------------------------- | ----------------------------------------------------------------------- |
| `workbranch init`           | Create or clone base worktrees from config                              |
| `workbranch add [<task>]`   | Create a task workspace                                                 |
| `workbranch list [--json]`  | Show repos and task workspaces; `--json` is machine-readable output     |
| `workbranch memo [task]`    | Show, write, or clear the task brief in `TASK-WORKBRANCH.md`            |
| `workbranch noti ...`       | Add, list, or clear task notifications                                  |
| `workbranch status`         | Show base remote diff, task diff, and dirty state                       |
| `workbranch update [task]`  | Update every repo in the task from local base (no pull)                 |
| `workbranch land <task>`    | Fast-forward task work into local base branches                         |
| `workbranch done <task>`    | Mark the current Plan done and archive it                               |
| `workbranch push [task]`    | Push base or task branches                                              |
| `workbranch doctor [--fix]` | Diagnose project health; safe fixes include stale worktree pruning and brief H1 repair |

Combined flow shortcuts:

| Command                      | Use it to                                           |
| ---------------------------- | --------------------------------------------------- |
| `workbranch refresh [task]`  | Pull base branches, then update task workspaces     |
| `workbranch finalize <task>` | Pull base branches, update one task, then land it   |
| `workbranch prune`           | Remove clean task workspaces already merged into local base branches |

![img](./docs/figs/workbranch-git-flow.png)

## View with Companion

Workbranch Companion is a macOS menu bar app with Main, Activity, and Settings views.

- Main: groups active tasks into PLAN, EXECUTION, and REVIEW columns; each card shows its project, task and Plan title, repos, dirty/blocked state, Step progress, and notifications
- Project details: lists each repo and branch, then provides Finder, IDE, and terminal launch actions
- Activity: reads `$XDG_STATE_HOME/workbranch/activity.jsonl` (default `~/.local/state/workbranch/activity.jsonl`) and shows day or three-day calendar timelines
- Settings: controls launch at login, the interface font, and the Claude Code or Codex theme

Companion consumes the task root's `TASK-WORKBRANCH.md`, `.workbranch/notifications.jsonl`, and `workbranch list --global --json` output. It does not run task lifecycle or Git mutation commands.

Install:

```bash
brew install --cask tkhwang/tap/workbranch-companion
```

## More docs

- [Task identity and branch names](docs/task-identity.md)
- [Usage details](docs/usage.md)
- [AI agent workflows](docs/ai-agents.md)
- [Architecture](docs/architecture.md)
- [Git operations](docs/git-operations.md)
- [MVP spec](docs/specs/0001-workbranch-mvp.md)
