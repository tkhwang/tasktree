# 사용 상세

[README](../README.ko.md) | [English](usage.md)

## Platform 지원

기본 workbranch 명령은 macOS, Linux, WSL에서 지원합니다. Tool app launcher는 macOS 전용입니다. 내장 app preset이 macOS `open`과 macOS app 이름을 사용하기 때문입니다.

공통 지원: Git/worktree 명령, `path`, `list`, `memo`, `noti`, `status`, `config`, `init`, generated CLI 검증.

macOS 전용: `finder`, `ide`, `terminal`, `config ide`, `config terminal`. Linux/WSL에서 전체 `workbranch config`와 `workbranch init`은 계속 사용할 수 있으며 tool app prompt를 건너뜁니다.

## 주요 명령어

### Workspace lifecycle

| Command                                  | 용도                                                               |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `workbranch init`                        | config 기준으로 base worktree 생성 또는 clone                      |
| `workbranch config`                      | project 설정, base branch, tool command, repo setup command 수정   |
| `workbranch config base`                 | base branch 설정만 수정하고 base worktree checkout                 |
| `workbranch config ide`                  | IDE 명령만 수정                                                    |
| `workbranch config terminal`             | terminal 명령만 수정                                               |
| `workbranch config language`             | generated task guidance 선호 언어 수정                             |
| `workbranch add [<task>] [--from <ref>]` | task workspace 생성                                                |
| `workbranch list [--json]`               | repo와 task workspace 목록 확인; `--json`은 companion용 contract 출력 |
| `workbranch remove <task>`               | task worktree와 local task branch 제거                             |
| `workbranch doctor [--fix]`              | project health 진단; `--fix`는 stale worktree registration만 prune |

### Branch workflow

| Command                    | 용도                                              |
| -------------------------- | ------------------------------------------------- |
| `workbranch status`        | base remote diff, task diff, dirty state 확인     |
| `workbranch pull`          | remote base branch를 `_base/<repo>`로 pull        |
| `workbranch update [task]` | local base 변경사항을 task worktree에 rebase (`git rebase <_base/repo HEAD>`) |
| `workbranch push`          | base branch push                                  |
| `workbranch push <task>`   | task branch push                                  |
| `workbranch land <task>`   | task 작업을 local base branch로 fast-forward 반영 |

### Combined flow

| Command                      | 용도                                                                      |
| ---------------------------- | ------------------------------------------------------------------------- |
| `workbranch refresh`         | base branch를 pull한 뒤 모든 task workspace update                        |
| `workbranch refresh <task>`  | base branch를 pull한 뒤 하나의 task workspace update                      |
| `workbranch finalize <task>` | base branch를 pull하고 하나의 task를 update한 뒤 local base branch로 반영 |
| `workbranch prune`           | local base branch에 이미 merge된 clean task workspace 정리                |

### Tool commands

| Command                      | 용도                                      |
| ---------------------------- | ----------------------------------------- |
| `workbranch path <task>`     | task workspace 또는 repo 경로 출력        |
| `workbranch finder <task>`   | Finder로 task workspace folder 열기       |
| `workbranch ide <task>`      | 설정된 IDE로 task repo worktree 열기      |
| `workbranch terminal <task>` | 설정된 terminal로 task root 열기          |

### Other

| Command         | 용도                |
| --------------- | ------------------- |
| `workbranch -v` | 설치된 version 확인 |

지원되는 Branch workflow 및 Tool 명령에 `--repo <repo>`를 붙이면 특정 repo 하나만 대상으로 실행합니다.

## CLI 표시

대화형 터미널에서는 `workbranch`가 색상, help/init 화면의 compact banner, section title을 사용해 출력이 더 잘 보이도록 합니다. 캡처되거나 pipe된 출력은 기본적으로 plain text를 유지하므로 script와 test에 ANSI escape sequence가 들어가지 않습니다.

색상 제어:

```bash
NO_COLOR=1 workbranch help              # 항상 plain
WORKBRANCH_COLOR=never workbranch help  # 항상 plain
WORKBRANCH_COLOR=always workbranch help # enhanced display 강제
```

`workbranch path <task>`와 `workbranch path <task> --repo <repo>`는 scripting을 위해 계속 plain path만 stdout에 출력합니다.

## Task brief와 notifications

`workbranch add <task>`는 repo worktree 밖 task root에 `<task>/TASK-WORKBRANCH.md`와 generated `<task>/AGENTS.md`를 생성합니다. Agent는 기본적으로 `<task>`에서 실행하고, 코드 변경과 Git 명령은 `<task>/<repo>` 안에서 수행합니다. Generated guidance는 두 위치 모두 같은 task brief를 갱신하도록 안내합니다. 이 state를 위해 repo `.gitignore`는 수정하지 않습니다. `PREFERRED_LANGUAGE en|ko`는 generated task brief와 agent guidance 언어를 제어하며, `workbranch config language`로 설정합니다.

기본 task brief 포맷은 사람, agent, `workbranch list --json`, companion app이 함께 쓰는 contract입니다.

```markdown
# <task>
status: todo
```

첫 `#` heading은 현재 Plan 이름이며, 새로 생성된 brief는 task 이름으로 시작합니다. 바로 다음 `status:` 줄이 source of truth이고 `todo`, `planning`, `in-progress`, `review`, `blocked`, `done` 중 하나를 사용합니다. 일반적인 `todo → planning → in-progress → review → done` 단계가 바뀌면 이 줄을 갱신하고, 계획을 포함한 의미 있는 작업을 시작하면 `todo`에서 `planning`으로 즉시 변경합니다. 작업 초점이 바뀌면 `status:` 바로 아래에 선택적 현재 작업 요약 한 줄을 유지하세요. `workbranch list --json`은 이를 `plans[].summary`로 내보내며, parser는 `status:` 뒤에서 checklist 이전의 첫 유효한 비어 있지 않은 줄을 읽고 없으면 빈 문자열을 냅니다. `blocked`는 Execution 전용 pause 상태로 `in-progress`에서만 진입하고, blocker가 해소되면 `in-progress`로 복원합니다. Checklist, `plan:` metadata, note는 사용자가 명시적으로 요청한 경우에만 추가합니다.

기존 brief 호환을 위해 명시적인 `status:` 줄이 없으면 parser가 Markdown checklist에서 상태와 진행도를 계속 도출합니다. 완료 항목이 없으면 `todo`, 일부 완료는 `in-progress`, 전부 완료는 `done`입니다. 완료 항목은 `progressDone`, 전체 항목은 `progressTotal`, 첫 미완료 항목은 `currentItem`이 됩니다. Schema v1의 `memoTitle`도 첫 H1의 legacy alias로 유지하지만 Companion domain model은 이 필드에 의존하지 않습니다.

`workbranch memo <task>`는 task brief를 출력하고, `workbranch memo <task> "text"`는 덮어쓰며, `workbranch memo <task> --clear`는 삭제합니다. Registered task workspace 안에서는 읽기일 때만 task를 생략할 수 있습니다. `workbranch memo`는 현재 task brief를 출력합니다. 쓰기와 삭제는 명시적인 task 인자가 필요합니다.

Notification은 `<task>/.workbranch/notifications.jsonl`의 append-only JSON Lines입니다. `workbranch noti add <task> "text"`는 event를 추가하고, `workbranch noti list <task>`는 오래된 순서대로 text를 출력하며, `workbranch noti clear <task>`는 inbox를 비웁니다. Companion app은 `workbranch list --json`의 `notiCount`, `planTitle`, `status`, `progressDone`, `progressTotal`, `currentItem`, `updatedAt`, plan-level `summary`를 읽고, 상세/확인은 `noti list` / `noti clear`를 호출할 수 있습니다. 현재 Companion은 StageBoard card에만 `+N`을 표시합니다.

`workbranch remove <task>`는 task worktree, local task branch, known generated task-root state(`TASK-WORKBRANCH.md`, generated `AGENTS.md`, `.workbranch/`, `.workbranch.task`)를 제거합니다. 그 밖에 task root에 남은 항목은 `.omx/`, `.omc/`를 포함해 git으로 관리되지 않는 잔여물입니다. Normal remove는 남은 항목 이름을 출력하고, interactive shell에서는 task root 전체를 삭제할지 한 번 묻습니다. No/EOF는 task root를 보존합니다. `workbranch remove <task> --force`는 일반 safety preflight를 그대로 실행한 뒤 묻지 않고 task root를 삭제합니다.

## Project health

`workbranch doctor`는 base worktree drift, partial task workspace, stale task directory, stale Git worktree registration을 진단합니다. 기본 동작은 read-only이고 issue가 있으면 non-zero로 종료하므로 local check나 CI에서 사용할 수 있습니다.

안전한 자동 복구만 원하면 `workbranch doctor --fix`를 사용하세요. 이 명령은 in-scope base repo에 대해 `git worktree prune`만 실행하며 task directory나 branch는 삭제하지 않습니다. 삭제가 필요한 정리는 출력되는 `workbranch remove <task>` 또는 `workbranch remove <task> --force` 안내를 사용자가 직접 실행해야 합니다. `--repo <repo>`를 붙이면 특정 repo만 진단하고 prune합니다.

## Shell completion

`workbranch completion <shell>`로 shell completion script를 생성합니다. 이 script는 shell을 통해 command, task key, repo, option completion을 제공합니다. 후보 표시 색상이나 흐린 preview 스타일은 shell, completion framework, terminal theme이 담당합니다.

```bash
# bash
workbranch completion bash > ~/.local/share/bash-completion/completions/workbranch

# zsh: fpath에 포함된 directory에 저장
workbranch completion zsh > "${fpath[1]}/_workbranch"

# fish
workbranch completion fish > ~/.config/fish/completions/workbranch.fish
```

## 작업 workspace 열기

프로젝트에서 공통으로 사용할 IDE/terminal 명령과 generated task guidance 언어를 설정합니다.

```bash
workbranch config ide
workbranch config terminal
workbranch config language
```

Task surface를 엽니다.

```bash
workbranch finder login      # Finder로 task root 열기
workbranch ide login         # IDE로 repo worktree 열기
workbranch terminal login    # terminal로 task root 열기
```

내장 macOS IDE preset은 VS Code 계열 app에서 repo path마다 별도 IDE window를 엽니다. config directive는 `IDE <command>`입니다. preset 순서는 Cursor, Antigravity, Windsurf, Zed, Sublime Text, Xcode, VS Code입니다. VS Code 계열 preset(Cursor, Antigravity, Windsurf, VS Code)은 `workbranch ide` 실행 시 설치된 app 안의 CLI(`<App>.app/Contents/Resources/app/bin/<cli>`, `/Applications` 다음 `~/Applications` 순으로 탐색)를 `<cli> --new-window <repo-path>`로 실행합니다. 해당 IDE가 이미 실행 중이면 CLI가 띄운 임시 helper 인스턴스가 종료된 뒤 `open -a <App>.app`으로 앱을 앞으로 가져옵니다. 그 helper가 종료되면서 macOS 포커스가 호출한 쪽으로 돌아가고, 이미 IDE의 key window인 repo 창만 focus해서는 앱이 앞으로 나오지 않기 때문입니다. 이미 열린 repo는 기존 window가 focus되면서 IDE가 앞으로 나오고, 열리지 않은 repo는 새 window로 열리며, IDE가 실행 중이 아니면 새로 시작합니다. 이 경로는 번들 CLI가 끝나기를 기다린 뒤 활성화까지 확인하므로 `workbranch ide`가 repo당 약 3~4초 뒤에 반환됩니다. repo 창 자체는 약 1초 안에 나타납니다. 번들 CLI를 찾지 못하거나 실행 권한이 없으면 설정된 `open -na ... --args --new-window` 명령을 그대로 실행합니다. `IDE open -a Cursor`, `IDE open -a "Antigravity IDE"`, `IDE open -a "Visual Studio Code"`, `IDE open -a Windsurf` 형태도 같은 방식으로 보정됩니다. Zed는 검증 전까지 `open -na Zed`로 유지합니다.

필요하면 repo 하나로 제한합니다.

```bash
workbranch ide login --repo frontend
workbranch terminal login --repo backend
```

스크립트에서 사용할 전체 경로를 출력합니다.

```bash
workbranch path login
workbranch path login --repo frontend
```

`workbranch ide <task>`는 repo별로 실행됩니다. `workbranch terminal <task>`는 agent가 `AGENTS.md`, `TASK-WORKBRANCH.md`, 모든 repo를 볼 수 있도록 task root를 한 번 엽니다. 의도적으로 repo 하나만 열 때는 `--repo`를 사용하세요.

## Setup command

`workbranch config`는 repo별 setup command를 저장할 수 있습니다. `workbranch add <task>`를 실행하면 각 setup command가 `<task>/<repo>` 안에서 실행됩니다.

config format과 setup 환경변수는 [MVP spec](specs/0001-workbranch-mvp.md)을 참고하세요.

## Safety

`workbranch`는 worktree를 변경하기 전에 dirty worktree, 잘못된 branch, rebase 상태, 누락된 repo, fast-forward가 아닌 Git 경로를 확인합니다.

preflight에서 rebase conflict나 diverged pull 경로를 감지하면 대상 worktree를 변경하기 전에 중단하고, 해당 repo에서 확인하거나 해결할 수 있는 수동 Git command를 출력합니다. conflict를 `workbranch` 밖에서 해결한 뒤 원래 `workbranch` command를 다시 실행하세요.
