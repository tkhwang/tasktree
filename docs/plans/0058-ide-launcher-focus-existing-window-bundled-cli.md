# 0058 IDE Launcher Focus Existing Window via Bundled CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Before each behavior change use `superpowers:test-driven-development` (red → green → refactor). Make source changes under `apps/cli/src/workbranch/**`, rebuild with `apps/cli/scripts/build-workbranch.sh`, then verify with `./apps/cli/tests/run.sh` and `git diff --check`. Do not edit `apps/cli/bin/workbranch` by hand. Steps use checkbox (`- [ ]`) syntax for tracking.

**목표:** Companion의 IDE 아이콘(그리고 `workbranch ide <task>`)을 눌렀을 때, 해당 repo가 IDE에 이미 열려 있으면 **그 창을 focus하고 IDE를 앞으로 가져오고**, 열려 있지 않으면 새 창으로 열고, IDE가 실행 중이 아니면 새로 시작한다. 사용자 요구: "실행되지 않은 경우 새로 launch, 실행이 된 경우 해당 editor가 떠 있는 화면으로 이동(focus)".

**Architecture:** 기존 흐름(Companion `workbranch_run` → CLI `cmd_ide` → repo마다 `run_tool_command`)은 유지한다. `run_tool_command`의 `ide` 정규화 뒤에 한 단계를 추가해, VS Code 계열 preset(Antigravity IDE, Cursor, Windsurf, Visual Studio Code)이면 설치된 app bundle 안의 CLI(`<App>.app/Contents/Resources/app/bin/<cli>`)를 `--new-window <repo-path>`로 실행한다. 그 IDE가 이미 실행 중이었으면(`lsappinfo find bundlepath=<bundle>`) CLI가 띄운 임시 helper 인스턴스가 종료되기를 기다린 뒤(`ps -axo command=`에서 `<bundle>/Contents/MacOS/` 프로세스가 1개로 줄 때까지 50ms 폴링 최대 15회, `ps` 비용을 포함해 약 2초 상한; main process가 하나도 보이지 않으면 0.6초 고정 대기) `open -a <bundle>`로 앱을 활성화한다. helper가 종료되면서 포커스가 호출 app으로 돌아가고, 이미 IDE의 key window인 repo 창은 CLI가 focus해도 앱이 앞으로 나오지 않기 때문이다. bundle을 찾지 못하면 기존 `open -na <App> --args --new-window <repo-path>`로 fallback한다. `.workbranch.config`의 `IDE` 값, Companion(React/Tauri), contract는 바꾸지 않는다.

**Tech Stack:** Bash CLI(단일 파일 조립: `apps/cli/scripts/build-workbranch.sh` 재빌드 필수), `apps/cli/tests/run.sh` 통합 테스트(fake `open`/fake app bundle 스크립트), macOS LaunchServices `open`, VS Code 계열 Electron CLI(`cli.js`).

---

## 승인된 사용자 문제와 흐름

1. 사용자 보고(2026-09-11): "IDE icon click 하면 매번 새로 launch 하고 있어." Companion 화면(`feature-cpq-task-a` 카드의 IDE 아이콘)에서 재현.
2. 원하는 동작: 실행되지 않은 경우 새로 launch, 실행된 경우 해당 editor 창으로 이동(focus).
3. 사용자 선택(AskUserQuestion): **번들 CLI + `--new-window`** 방식. `--new-window` 제외안과 Zed/Sublime/Xcode 확장안은 채택하지 않았다.

## 조사 결과 (2026-09-11)

### 원인

- 현재 preset은 `open -na "Antigravity IDE" --args --new-window <repo-path>`다. `open -n`은 **새 app 인스턴스를 띄우고**(Dock 아이콘이 튀어 "launch"처럼 보임), 그 인스턴스는 실행 중인 본체에 경로를 넘긴 뒤 종료한다. 이 임시 인스턴스가 활성 app이 된 뒤 종료되므로 macOS는 포커스를 **호출한 app(Companion, 터미널)으로 되돌린다**. 본체는 창을 focus했지만 app 자체가 앞으로 나오지 않는다.
- 중복 창 문제는 아니다. VS Code `WindowsMainService.doOpen`(upstream `main`)에서 "이미 열린 폴더면 기존 창 focus(`doOpenFilesInExistingWindow` → `focusMainOrChildWindow`)" 검사는 `forceNewWindow`(`--new-window`)와 무관하게 항상 실행된다. Antigravity 1.107.0 번들(`out/main.js`)에도 같은 trace 문자열이 있다.

### 재현 실험 (Antigravity IDE 1.107.0, 이미 열린 `feature-cpq-task-a/backend·frontend` 창 대상)

| 커맨드 | IDE가 앞으로 나옴 | 중복 창 |
|---|---|---|
| A. 현재 `open -na App --args --new-window <path>` | ✗ (호출 app 유지) | 없음 |
| B. A에서 `--new-window` 제거 | ✗ | 없음 |
| C. A 뒤에 `open -a App` 추가 | ✓ | **생김** |
| D. `open -a App <path>` (document open) | ✓ | **생김** |
| E. 번들 CLI `antigravity-ide <path>` | ✓ | 없음 |
| F. 번들 CLI `antigravity-ide --new-window <path>` (다른 app이 전면일 때) | ✓, 해당 창 최상단 | 없음 |

측정: `lsappinfo front`로 전면 app, System Events로 창 제목·개수, `--vscode-window-config` renderer 수. C/D의 중복 창 원인(`open -a` 경로의 URI 변형 추정)은 규명하지 않았고 채택하지 않았다.

### 구현 후 스모크에서 드러난 추가 규칙 (2026-09-11)

재빌드한 CLI로 `workbranch ide feat-move-to-repo --repo workbranch`를 두 번 실행했다. 1회차(열리지 않은 repo)는 새 창 + Antigravity 전면으로 정상이었지만, 2회차(그 창이 IDE의 key window인 상태에서 다른 app이 전면)는 중복 창은 없었으나 **IDE가 앞으로 나오지 않았다**. A~F를 다시 대조하면 앱이 전면으로 나온 경우(D, E, F, 1회차)는 모두 "대상 창이 key window가 아니었거나 새 창"이고, 나오지 않은 경우(A, B, 2회차)는 모두 "대상 창이 이미 key window"였다. 즉 번들 CLI만으로는 "방금 작업하던 repo 창으로 돌아가기"라는 가장 흔한 경우를 해결하지 못한다.

추가 실험:

| 커맨드 | IDE가 앞으로 나옴 | 중복 창 |
|---|---|---|
| G. `open -a "/Applications/Antigravity IDE.app"` 단독 (실행 중) | ✓ | 없음 |
| H. G 다음 번들 CLI `--new-window <key-window repo>` | ✓ | 없음 |

`open -a <bundle path>`(경로 없음, `-n` 없음)는 LaunchServices 활성화만 하고 창을 만들지 않았다(C의 중복 창은 `open -n` 임시 인스턴스와의 상호작용으로 판단). 실행 여부는 `lsappinfo find bundlepath=<bundle>`로 확인한다(실행 중이면 ASN 출력, 아니면 빈 문자열, 권한 불필요). IDE가 실행 중이 아닐 때는 활성화를 건너뛴다. 인자 없는 `open -a`는 이전 세션 창을 모두 복원해 버리고, CLI로 새로 시작하는 경로는 그 자체로 앞으로 나온다(1회차 확인).

### 활성화 순서 (2026-09-11, "활성화 → CLI"는 불안정)

"활성화 → CLI" 순서로 구현한 빌드를 같은 조건에서 반복하자 2회 중 1회, 별도 4회 중 1회 IDE가 전면으로 나오지 않았다. 원인 실험:

| 실험 | 결과 |
|---|---|
| X. `open -a <bundle>` 단독 4회 | 4/4 전면 |
| Y. 번들 CLI 단독(key window 대상), 100ms 간격으로 전면 app 샘플링 | `Antigravity, Antigravity, Warp, Warp, …` — 약 0.2초 전면 후 호출 app으로 복귀 |
| Z. `open -a` → 2초 대기 → CLI, 4회 | 3/4 전면 |

CLI가 spawn하는 임시 Electron helper 인스턴스가 잠시 활성 app이 되고, 종료되면서 macOS가 포커스를 호출 app으로 되돌린다. 활성화를 CLI **앞에** 두면 이 복귀에 덮여 쓰인다. 따라서 순서를 **CLI → helper 종료 대기 → `open -a <bundle>`**로 바꾼다. helper 종료는 `ps -axo command=`에서 `<bundle>/Contents/MacOS/`로 시작하는 main process가 1개(본체)만 남는지로 판단하고, 50ms 간격 최대 15회 기다린다(폴링 1회에 `ps` 스캔 40~90ms가 더해지므로 15회가 약 2초 상한이다). main process가 하나도 보이지 않으면(앱이 다른 경로로 실행된 경우 등) helper를 관찰할 수 없으므로 0.6초 고정 대기 후 활성화한다. renderer/GPU helper는 `Contents/Frameworks/` 아래라 세지 않는다.

측정(2026-09-11): `antigravity-ide` 스크립트는 helper를 spawn한 node 프로세스가 끝날 때까지 약 1.2초 블록하고, spawn된 GUI helper는 그 뒤로도 약 0.6초 더 살아 있다(100ms 샘플링에서 main process 수 2 → 1). 즉 대기는 실제로 필요하며 보통 0.6초 안에 끝난다.

### 활성화 재확인 (2026-09-11, "CLI → 대기 → `open -a` 1회"도 간헐적으로 실패)

"CLI → helper 종료 대기 → `open -a` 1회" 빌드로 실환경을 반복하자 4/4 성공 뒤에 2회 중 1회, 3회 중 1회가 다시 실패했다. 100ms 샘플링(전면 app / main process 수) 타임라인:

| run | 관찰 |
|---|---|
| 1 | 0.8초 IDE 전면(helper 활성화) → 1.4초 helper 종료 → `open -a` 후 IDE 유지 → **4.9초 호출 app으로 복귀**(CLI 종료 2.5초 뒤) |
| 2 | 0.8초 IDE 전면 → 유지, 정상 |
| 3 | 0.9초 IDE 전면 → 1.5초 helper 종료 → **2.0초 호출 app으로 복귀**(`open -a` 직후) |

helper가 활성 app에서 물러나며 발생하는 "이전 app으로 포커스 복귀"가 helper 프로세스 종료 시점과 느슨하게 결합돼, 종료 확인 직후의 `open -a`가 뒤늦은 복귀에 덮여 쓰일 수 있다. 따라서 활성화를 한 번으로 끝내지 않고 **전면 app을 재확인**한다: `lsappinfo front`의 ASN을 `lsappinfo info -only bundlepath <asn>`(`"LSBundlePath"="<bundle>"`)로 bundle과 비교해, 250ms 간격 4회 동안 IDE가 전면이 아닐 때만 `open -a <bundle>`을 반복한다(정상이면 첫 확인에서 1회 활성화 후 3회는 확인만, 약 0.75초). `open -a`는 창을 만들지 않으므로(G, X) 반복해도 부작용이 없다.

재확인 루프를 넣은 빌드로 3회 반복하면서 전면 app과 함께 **마지막 사용자 입력 이후 경과 시간**(`ioreg -c IOHIDSystem`의 `HIDIdleTime`)을 100ms마다 샘플링했다. 전면이 호출 app으로 돌아간 순간마다 경과 시간이 0.0~0.1초로 리셋돼 있었다. 즉 이 세션에서 관찰된 늦은 복귀는 사용자가 실제로 터미널을 클릭·입력한 것이었고, 사용자 입력이 없는 run에서는 IDE가 전면을 유지했다. 한 run에서는 루프가 사용자 클릭 직후 IDE를 한 번 다시 앞으로 가져오는 것도 확인됐다(이후 사용자가 계속 터미널에 입력해 최종 전면은 터미널). 사용자가 활발히 작업 중인 머신에서 실험했으므로 앞선 "간헐적 실패" 일부도 같은 원인일 가능성이 크지만, helper 활성화 → 복귀 메커니즘 자체(Y)는 실재하므로 대기 + 재확인은 유지한다. 실행 시간은 repo당 약 3.7~4.0초(`antigravity-ide` 1.2초 + helper 대기 약 0.6초 + 재확인 0.75초 + `lsappinfo`/`ps`/`open` 호출 비용).

### 번들 CLI 경로 (이 머신에서 확인)

- Antigravity IDE: `Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide` (`product.json applicationName: antigravity-ide`)
- Cursor: `Cursor.app/Contents/Resources/app/bin/cursor` — `agent`/`editor` 인자만 특별 처리하고 그 외는 표준 Electron CLI(`use_cursor_cli`)로 라우팅하므로 `--new-window <path>`가 그대로 통한다.
- Visual Studio Code: `Visual Studio Code.app/Contents/Resources/app/bin/code` (미설치, upstream 표준 경로)
- Windsurf: `Windsurf.app/Contents/Resources/app/bin/windsurf` (미설치, 표준 fork 규약 기준; fallback이 보호한다)

## Decision Gates

- [x] 활성화 방법 (`--new-window` 제거 vs `open -a` 활성화 추가 vs 번들 CLI)
  - Impact: focus 정확성, 중복 창 여부, 설정/문서 변경 범위.
  - Evidence: 위 실험 A–F. 번들 CLI만 "앞으로 나옴 + 중복 없음"을 만족.
  - Status: resolved(user) — 번들 CLI. `open -a` 계열은 중복 창을 만들어 기각.
- [x] `--new-window` 유지 여부
  - Impact: 열리지 않은 repo를 열 때 빈 Welcome 창 재사용/`window.openFoldersInNewWindow: off` 사용자의 창 교체 여부.
  - Evidence: F에서 `--new-window`가 있어도 이미 열린 폴더는 focus만 된다(VS Code 소스와 일치). 유지하면 0008의 "repo마다 별도 창" 계약이 그대로 보존된다.
  - Status: resolved(user) — 유지.
- [x] app bundle 탐색 방법
  - Options: A) `/Applications`, `~/Applications` 고정 탐색 + 테스트 env 오버라이드, B) `mdfind`/`osascript path to application`.
  - Status: resolved(기본값 채택) — A. 결정적이고 네트워크/Spotlight 의존이 없으며 `WORKBRANCH_TEST_PLATFORM`과 같은 test-only env 패턴(`WORKBRANCH_TEST_APPLICATIONS_DIR`)으로 검증 가능하다. 못 찾으면 기존 `open -na` fallback.
- [x] 설정 마이그레이션
  - Status: resolved(기본값 채택) — 없음. `IDE open -na "Antigravity IDE" --args --new-window` 등 기존 값을 그대로 두고 실행 시점에만 CLI로 치환한다. legacy `open -a <App>` 형태도 기존 정규화를 거친 뒤 같은 규칙을 탄다.
- [x] 실행 중인 IDE의 명시적 활성화
  - Impact: key window인 repo로 돌아갈 때 IDE가 전면으로 나오는지, TCC 권한 프롬프트 여부, 중복 창 여부.
  - Options: A) `open -a <bundle>` (LaunchServices, 권한 불필요), B) `osascript ... activate` (Apple Event → Companion에 Automation 권한·`NSAppleEventsUsageDescription` 필요), C) 활성화 없음.
  - Evidence: G/H. C는 2회차 스모크에서 실패.
  - Status: resolved(repo evidence) — A. 실행 중일 때만 수행하고 실패는 무시한다(`|| :`).
- [x] 활성화 시점 (CLI 앞 vs CLI 뒤)
  - Impact: 반복 실행 시 전면 전환의 일관성.
  - Evidence: X/Y/Z. CLI 앞에 두면 helper 종료 시 포커스 복귀에 덮여 쓰여 간헐적으로 실패한다.
  - Status: resolved(repo evidence) — CLI 뒤. helper 인스턴스 종료를 `ps`로 확인한 뒤 `open -a <bundle>`.
- [x] 범위
  - Status: resolved(user) — VS Code 계열 4개 preset만. Zed, Sublime Text, Xcode는 후속.

## 결정 사항

### D1. `run_tool_command`가 VS Code 계열 IDE를 번들 CLI로 실행한다

`apps/cli/src/workbranch/lib/tool-launcher.sh`:

- `ide_bundled_cli_relative_path <normalized-command>`: 정규화된 4개 preset 문자열(Cursor/Windsurf는 `open -na "Cursor" --args --new-window`처럼 따옴표가 붙은 변형 포함)을 bundle 내부 CLI 상대 경로로 매핑한다. 그 외는 실패(1)를 반환한다.
- `ide_application_roots`: `WORKBRANCH_TEST_APPLICATIONS_DIR`가 있으면 그 하나만, 없으면 `/Applications`, `$HOME/Applications` 순서로 출력한다.
- `resolve_ide_bundled_cli <normalized-command>`: roots를 순회해 첫 실행 가능 CLI 절대 경로를 출력한다.
- `ide_app_is_running <bundle-path>`: `lsappinfo`가 없으면 실패, 있으면 `lsappinfo find bundlepath=<bundle-path>` 출력이 비어 있지 않을 때 성공.
- `ide_bundle_main_process_count <bundle-path>`: `ps -axo command=` 출력 중 `<bundle-path>/Contents/MacOS/`로 시작하는 줄 수.
- `wait_for_ide_bundled_cli_handoff <bundle-path>`: 첫 조회가 0이면 0.6초 고정 대기, 아니면 위 개수가 1 이하가 될 때까지 50ms × 최대 15회 대기.
- `ide_app_is_frontmost <bundle-path>`: `lsappinfo front`의 ASN을 `lsappinfo info -only bundlepath <asn>`로 조회해 `"LSBundlePath"="<bundle-path>"`와 완전 일치하면 성공.
- `activate_running_ide_bundle <bundle-path>`: 250ms 간격 4회 동안 `ide_app_is_frontmost`가 실패할 때만 `open -a <bundle-path> || :`.
- `run_ide_bundled_cli <cli> <path>`: CLI 경로에서 bundle 경로를 잘라내고(`${ide_cli%/Contents/Resources/app/bin/*}`), 실행 여부를 먼저 기록한 뒤 `cd "$path"` → `"$ide_cli" --new-window "$path"` → 실행 중이었으면 `wait_for_ide_bundled_cli_handoff` 후 `activate_running_ide_bundle`.
- `run_tool_command ide ...`: 기존 legacy 정규화 → `resolve_ide_bundled_cli` 성공 시 `run_ide_bundled_cli` 실행 후 return. 실패 시 기존 `sh -c "$command \"$WORKBRANCH_TOOL_PATH\""` 경로.

`info_tool_opening` 출력(`[*] Opening IDE: <task>/<repo>`)은 바꾸지 않는다.

### D2. 테스트 계약

`apps/cli/tests/cases/tool-launcher.sh`:

- `append_fake_launcher_open_script <fake-bin>` / `append_fake_ide_bundle_cli <apps-root> <bundle-relative-cli>`: fake `open`과 fake bundle CLI가 `"$PWD|$#|$*"`를 `WORKBRANCH_FAKE_TOOL_LOG`에 남긴다. 인자 개수(`$#`)를 함께 기록해야 `"Visual Studio Code.app"`처럼 공백이 있는 경로의 따옴표 누락(word splitting)이 로그에 드러난다(리뷰의 mutation test에서 `$*`만 기록하면 검출되지 않음을 확인).
- `append_fake_ps_script <fake-bin>`: `WORKBRANCH_FAKE_PS_COUNTER`에 호출 수를 기록하고, 처음 2회는 main process 2개(본체 + helper), 이후 1개를 출력한다. 대기 루프가 실제로 폴링했는지 검증한다.
- `test_ide_vscode_family_preset_prefers_bundled_cli_when_installed`: VS Code preset + fake bundle → repo 2개 모두 `<repo>|2|--new-window <repo>` 로그, fake `open` 미호출.
- `test_ide_legacy_app_shape_uses_bundled_cli_after_normalization`: `IDE open -a "Antigravity IDE"` + fake Antigravity bundle + `--repo frontend` → frontend만 CLI 호출.
- `append_fake_lsappinfo_script <fake-bin>`: fake `lsappinfo`. `find`는 `WORKBRANCH_FAKE_IDE_RUNNING=1`일 때만 ASN을 출력하고, `front`/`info -only bundlepath`는 처음 `WORKBRANCH_FAKE_IDE_NOT_FRONT_CALLS`(기본 1)회의 `front` 호출까지는 호출 app(`/Applications/Caller.app`)을, 그 뒤로는 `WORKBRANCH_FAKE_IDE_BUNDLE`을 전면으로 보고한다(`front` 호출 수는 `WORKBRANCH_FAKE_LSAPPINFO_STATE`에 기록). 인자는 `WORKBRANCH_FAKE_LSAPPINFO_LOG`에 남긴다. CI(ubuntu)에는 실제 `lsappinfo`가 없으므로 번들 CLI 테스트는 모두 이 fake를 PATH에 둔다.
- `test_ide_bundled_cli_activates_running_app_after_focusing_repo`: 실행 중(fake) → 로그가 정확히 2행이고 1행 `<repo>|2|--new-window <repo>`, 2행 `<repo>|2|-a <apps-root>/Visual Studio Code.app`(완전 일치 비교), fake `lsappinfo`가 `find bundlepath=<apps-root>/Visual Studio Code.app`와 `info -only bundlepath <caller-asn>`을 받았고 `front`를 4회 호출했으며(첫 확인 뒤 IDE가 전면이라 재활성화 없음), fake `ps`가 3회 호출됐다(helper가 보이는 2회 + 사라진 1회).
- `test_ide_bundled_cli_reactivates_when_focus_returns_to_caller`: 실행 중 + `WORKBRANCH_FAKE_IDE_NOT_FRONT_CALLS=2` → 로그 3행(CLI, `-a`, `-a`). 포커스가 호출 app으로 되돌아간 경우 재활성화하는 계약을 고정한다.
- `test_ide_bundled_cli_skips_activation_when_app_not_running`: 미실행(fake) → 로그는 CLI 호출 1행과 완전 일치, `ps` 카운터 파일이 생성되지 않는다(대기 없음).
- `test_ide_non_vscode_family_preset_keeps_configured_open_command`: `IDE open -na Zed` + fake Zed bundle + 실행 중(fake) → 로그는 `<repo>|3|-na Zed <repo>` 1행. Zed/Sublime Text/Xcode는 규칙 밖임을 고정한다.
- `test_ide_vscode_family_preset_falls_back_to_open_when_bundled_cli_missing`(기존 `test_ide_legacy_macos_app_preset_opens_new_instance_per_repo` 개명): 빈 `WORKBRANCH_TEST_APPLICATIONS_DIR`에서 기존 `open -na ... --args --new-window` 동작 유지.

### D3. 문서

`docs/usage.md`/`docs/usage.ko.md`의 IDE 단락과 `docs/architecture.md`의 tool-launcher 문장에 번들 CLI 우선·fallback·테스트 env를 반영한다.

## public contract (변경 / 비변경)

### 변경하는 것
- `workbranch ide` 실행 방식: VS Code 계열 preset이 설치돼 있으면 `open -na` 대신 번들 CLI를 호출한다. 사용자 관점 결과는 "이미 열린 repo 창 focus + IDE 전면"이다.
- test-only env `WORKBRANCH_TEST_APPLICATIONS_DIR` 추가.

### 변경하지 않는 것
- `.workbranch.config`의 `IDE <command>` 값과 `workbranch config ide` preset 목록/번호.
- Companion(React/Tauri) 코드, `workbranch_run` command 계약, `CompanionCommand` 3종.
- Finder/Terminal launcher, Zed/Sublime Text/Xcode preset.
- `[*] Opening IDE: ...` 출력.

## 파일 구조 (touched)

```text
apps/cli/src/workbranch/lib/tool-launcher.sh      # ide_application_roots / ide_bundled_cli_relative_path / resolve_ide_bundled_cli, run_tool_command 분기
apps/cli/tests/cases/tool-launcher.sh             # fake bundle helper + 신규 2 테스트 + fallback 테스트 개명
apps/cli/tests/run.sh                             # run_test 등록
apps/cli/bin/workbranch, bin/workbranch           # 재빌드 산출물
docs/usage.md, docs/usage.ko.md                   # IDE 단락
docs/architecture.md                              # tool-launcher 문장
docs/plans/0058-ide-launcher-focus-existing-window-bundled-cli.md
```

---

### Task 1: 번들 CLI 우선 실행 (TDD)

- [x] Red: 신규 테스트 2개가 fake `open` 호출 로그(`|-na Visual Studio Code --args --new-window`, `|-na Antigravity IDE --args --new-window`)를 남기며 실패하는 것 확인.
- [x] Green: D1 구현 후 `apps/cli/scripts/build-workbranch.sh` 재빌드, tool launcher 테스트 13개(`test_generated_workbranch_is_up_to_date` 포함) 통과.
- [x] Refactor: 헬퍼 3개로 분리, 기존 legacy 정규화 표는 그대로 재사용.
- [x] Red(활성화): `test_ide_bundled_cli_activates_running_app_after_focusing_repo`가 "로그 1행이 CLI 호출"로 실패하는 것 확인(`..._skips_activation_...`은 기존 동작 고정용으로 즉시 통과).
- [x] Green(활성화): `ide_app_is_running` + `run_ide_bundled_cli` 구현, 재빌드 후 IDE launcher 테스트 8개(`test_generated_workbranch_is_up_to_date` 포함) 통과.
- [x] Red(순서): 활성화 테스트의 기대 순서를 "CLI → `open -a`"로 바꿔 기존 구현("`open -a` → CLI")에서 실패하는 것 확인.
- [x] Green(순서): `ide_bundle_main_process_count` + `wait_for_ide_bundled_cli_handoff` 추가, `run_ide_bundled_cli` 순서 변경, 재빌드 후 IDE launcher 테스트 7개(`test_generated_workbranch_is_up_to_date` 포함) 통과.
- [x] Red(재확인): `test_ide_bundled_cli_reactivates_when_focus_returns_to_caller`가 "`-a` 호출 1회만"으로 실패하는 것 확인.
- [x] Green(재확인): `ide_app_is_frontmost` + `activate_running_ide_bundle` 추가, 재빌드 후 IDE launcher 테스트 9개(`test_generated_workbranch_is_up_to_date` 포함) 통과. 리뷰가 지적한 변이 4종(`open -a` 따옴표 누락, bundle 경로 파생 오류, 대기 제거, `lsappinfo` 인자 오류)과 재활성화 루프 제거 변이가 모두 테스트 실패로 검출됨을 확인.

### Task 2: 문서 동기화

- [x] `docs/usage.md`, `docs/usage.ko.md` IDE 단락 갱신.
- [x] `docs/architecture.md` tool-launcher 문장 갱신.

### Task 3: 검증

- [x] `./apps/cli/tests/run.sh` 전체(최종 빌드, repo root에서 실행): 300 통과, 1 실패. 실패한 `test_add_bare_tty_name_prefills_task_name_on_shared_parent_feature_base`는 TTY가 없는 agent 실행 환경 때문이며 `origin/main` 바이너리로도 같은 환경에서 동일하게 실패함을 확인했다(이 변경과 무관). repo root 밖에서 실행하면 `test_release_please_*`/`test_companion_release_*` 3개가 cwd 상대 경로 때문에 추가로 실패하므로 repo root에서 실행한다.
- [x] `git diff --check` 통과.
- [x] 실환경 스모크: 재빌드한 `apps/cli/bin/workbranch ide feat-move-to-repo --repo workbranch`로 1회차 새 창 + Antigravity 전면 확인. 이어서 그 창이 key window이고 Warp가 전면인 상태에서 반복 → 대기 1회 활성화 빌드에서 4/4, 재확인 루프 최종 빌드에서 사용자 입력이 없던 run은 모두 IDE 전면 유지(위 "활성화 재확인" 절), 이 CLI가 만든 중복 창 없음(창 수 변화는 사용자가 직접 연 backend 창). 1회 실행 시간 약 3.7~4.0초.
- [ ] 사용자 확인 항목: IDE가 완전히 종료된 상태에서 Companion IDE 아이콘 클릭 → 새로 시작되며 해당 repo 창만 열리는지(이전 세션 창 복원 없음). 이번 세션에서는 사용 중인 IDE를 종료하지 않아 검증하지 않았다.
- [x] 독립 코드 리뷰(oh-my-claudecode `code-reviewer`, 읽기 전용): CRITICAL/HIGH 0, MEDIUM 4, LOW 8. 반영: 대기 상한을 폴링 15회로 축소하고 `ps` 비용을 문서에 명시, main process 0개일 때 0.6초 고정 대기, fake 로그에 `$#` 기록·`lsappinfo` 인자 로그·fake `ps`로 대기 루프 검증·완전 일치 비교, `docs/specs/0001-workbranch-mvp.md` IDE 단락 갱신, 따옴표 붙은 Cursor/Windsurf preset 변형 매핑, Zed fallback 고정 테스트, usage 문서의 지연 시간·"CLI가 없거나 실행 불가" 문구. 나머지는 아래 후속으로 남긴다.

## 후속 / 범위 외

- **repo별 반복 호출 지연.** `cmd_tool_launcher`가 repo마다 `run_tool_command`를 호출하므로 repo 수 × 약 4초가 걸리고 활성화 확인도 repo마다 반복된다(2-repo task 약 8초, Companion의 "Action complete"도 그만큼 늦어짐; 창 자체는 각 호출 약 1초 안에 나타난다). VS Code 계열 CLI는 폴더 여러 개를 한 번에 받아 각각 창으로 열 수 있으므로, ide 경로에서 repo 경로를 모아 CLI를 한 번만 호출하고 활성화도 한 번만 하는 리팩터가 후속 후보다.
- **split install.** 같은 app이 `/Applications`와 `~/Applications`에 모두 있고 실행 중인 쪽이 `~/Applications`이면 `/Applications`가 먼저 선택돼 `lsappinfo` 실행 확인이 빗나간다(활성화 생략). 실행 중인 bundle을 우선하는 탐색이 후속 후보다.
- **main process 2개 이상이 정상인 환경**(과거 `open -na`가 남긴 두 번째 인스턴스 등)에서는 대기가 상한까지 돈다. 상한이 약 2초라 동작에는 영향이 없다.
- 테스트 공백: `ide_application_roots`의 다중 root 우선순위(`WORKBRANCH_TEST_APPLICATIONS_DIR`가 root 하나만 받는다), 번들 CLI가 있지만 실행 권한이 없는 경우.
- Zed(`open -na Zed`), Sublime Text, Xcode preset도 같은 `open -n` 활성화 문제가 있을 수 있다. Zed는 `Zed.app/Contents/MacOS/cli`로 같은 접근이 가능하다.
- Companion은 `resolve_workbranch_bin`이 찾는 CLI(`/opt/homebrew/bin/workbranch` 우선)를 실행하므로, Companion에서 효과를 보려면 릴리스된 CLI로 업그레이드하거나 `~/.config/workbranch-companion/projects.md`의 `workbranchBin:`을 재빌드한 `apps/cli/bin/workbranch`로 가리켜야 한다.
