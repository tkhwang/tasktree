# 0057 Companion Base Repo Status Group Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Before each behavior change use `superpowers:test-driven-development` (red → green → refactor). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Companion Main view의 `WORKTREE STATUS` 보드 맨 위에 `00 BASE` 그룹을 추가해, 각 프로젝트 base repo(`_base/<repo>`)의 현재 branch, remote(`origin/<baseBranch>`) 대비 ahead/behind, dirty 상태를 한 줄씩 보여주고, 조치가 필요할 때만 `PULL`/`PUSH`/`CHECK` pill로 다음 동작을 알린다. 사용자는 메뉴바를 열자마자 "base가 remote와 어긋났는지, 지저분한지"를 task 목록을 읽기 전에 확인할 수 있어야 한다.

**Architecture:** 기존 CLI `list --global --json` → contract → `parseContract` → ACL → domain → `buildMainViewModel` → `StageBoard` 흐름을 유지한다. CLI `cmd_list_json`이 project 수준 `baseRepos[]`(optional, schema v1 유지)를 wire로 내려주고, Companion은 domain `Project.baseRepos`(required, ACL이 `[]` 정규화)로 매핑한다. `MainViewModel.baseRows` projection이 프로젝트·config 순서를 유지한 행 목록을 만들고, `StageBoard`가 캡션 아래·`01 PLAN` 위에 `00 BASE` 그룹을 렌더링한다. 건강 상태/다음 동작 판정은 domain 순수 함수, facts 문구는 UI helper가 소유한다. Rust/Tauri는 JSON을 그대로 전달하므로 변경이 없다.

**Tech Stack:** Bash CLI(단일 파일 조립: `apps/cli/scripts/build-workbranch.sh` 재빌드 필수), JSON Schema 2020-12 + Ajv contract test, Tauri v2, React 18, TypeScript strict mode, plain CSS, Vitest + `renderToStaticMarkup`, Biome, pnpm.

**Approved mockup:** https://claude.ai/code/artifact/714f9c4e-c404-4d81-b7ec-0d9432029a9b (안 B "보드 안 00 BASE 그룹" 승인: "B 로 하자". 다중 프로젝트 표시는 AskUserQuestion으로 "행마다 프로젝트 접두어" 선택)

---

## 승인된 사용자 문제와 흐름

1. `workbranch status` CLI에는 base worktree의 remote 차이·dirty 상태가 있지만 Companion에는 없다 → 사용자는 Companion만 열어도 base repo 상태를 알고 싶어 한다("workbranch repo 의 status 를 간략하게 잘 보여줬으면").
2. 공간을 많이 쓰면 안 된다 → 표가 아니라 repo당 한 줄, 정상일 때는 흐린 점과 `CLEAN`만 남긴다("UI 적으로 너무 큰 공간을 차지 않지 않게").
3. 그래도 중요한 정보다 → 보드 맨 위(`00 BASE`)에 항상 보이고, 조치가 필요하면 색과 pill로 눈에 띄게 한다("맨 위 혹은 중간에든 잘 표시").
4. 프로젝트가 여러 개(현재 registry에 3개) → 그룹은 하나로 유지하고 각 행의 repo 이름 앞에 프로젝트를 흐리게 붙인다.

## Decision Gates

- [x] 표시 surface
  - Options: CLI `status` 출력 압축 vs Companion Main view.
  - Status: resolved(user) — Companion. CLI `status` 명령 출력은 이번 범위에서 바꾸지 않는다.
- [x] Companion 내 위치와 형태
  - Options: A) 헤더 아래 별도 스트립, B) 보드 안 `00 BASE` 그룹(캡션 아래·PLAN 위), C) REVIEW와 IDLE 사이.
  - Status: resolved(user) — B. mockup으로 승인. 스테이지 그룹과 같은 헤더 문법(`stage-group-head`)을 재사용한다.
- [x] 다중 프로젝트 구분
  - Options: A) 프로젝트 소제목 줄, B) 행마다 프로젝트 접두어, C) 프로젝트별 BASE 그룹 반복.
  - Status: resolved(user) — B. 각 행의 repo 이름 앞에 `<project>/`를 `--faint` 색으로 붙인다. 성공적으로 로드된 프로젝트가 1개뿐이면 접두어를 생략한다(기본값 채택 — 단일 프로젝트 사용자에게 중복 정보).
- [x] wire 형태와 schema 버전
  - Status: resolved(기본값 채택) — `WorkbranchListDocument.baseRepos?: WorkbranchBaseRepo[]`를 project 수준 optional 필드로 추가하고 `schemaVersion`은 1을 유지한다(구 CLI 출력 호환, 0056 `plans[].summary`와 같은 방식). `baseRepo` 객체 안의 필드는 모두 required다(신규 객체라 legacy 호환 불필요). `additionalProperties: false`이므로 JSON Schema `$defs.baseRepo`와 `properties.baseRepos`를 함께 추가하지 않으면 live CLI contract test가 실패한다.
- [x] remote 비교 기준
  - Options: A) 현재 branch의 upstream, B) 설정된 base branch의 `refs/remotes/origin/<baseBranch>`.
  - Status: resolved(기본값 채택) — B. base worktree는 설정된 base branch에 있어야 하므로 기준을 고정하고, 현재 branch가 다르면 별도로 mismatch로 표시한다. 기존 `status` 명령의 `remote_diff_label`은 그대로 둔다.
- [x] fetch 수행 여부
  - Status: resolved(기본값 채택) — `list --json`은 fetch하지 않는다. 값은 마지막 fetch 시점의 remote-tracking ref 기준이며, 이는 CLI `status`와 동일한 계약이다. Companion refresh 주기(파일 감시 + 5분 heartbeat)에서 네트워크 호출을 하지 않는다.
- [x] pill의 동작
  - Status: resolved(user, mockup 문구 승인) — `PULL`/`PUSH`/`CHECK`는 표시만 한다. 클릭 실행은 하지 않으며 Git 조작은 CLI가 소유한다. Tauri command allowlist 변경 없음.
- [x] 행 정렬
  - Status: resolved(기본값 채택) — wire 순서(프로젝트 순 → `.workbranch.config` REPO 순)를 유지한다. task repo 행의 dirty-우선 정렬(`orderedRepos`)은 적용하지 않는다. base repo는 수가 적고 위치가 고정돼야 매번 같은 자리에서 읽을 수 있다.
- [x] 그룹 표시 조건
  - Status: resolved(기본값 채택) — `baseRows`가 비어 있으면(구 CLI로 `baseRepos`가 없거나 모든 프로젝트에 repo가 0개) `00 BASE` 그룹 전체를 생략한다. 스테이지 그룹이 빈 상태에서도 헤더를 유지하는 것과 다르게, base는 데이터가 없을 때 빈 헤더가 의미가 없다.
- [x] 건강 상태 판정
  - Status: resolved(기본값 채택) — `bad`: worktree 없음(`present:false`), remote ref 없음(`remoteAvailable:false`), 현재 branch ≠ baseBranch, ahead·behind 동시 존재(diverged). `warn`: dirty 또는 ahead 또는 behind. `ok`: 나머지. 다음 동작: `bad → CHECK`, behind만 → `PULL`, ahead만 → `PUSH`, dirty만 → 없음.
- [x] activity event 영향
  - Status: resolved(repo evidence) — `activityEventsForRefresh`는 task/plan만 순회한다. base repo 변화는 activity event를 만들지 않으며 이 계약을 test로 고정한다.
- [x] `.tsx` test fixture 검증 방식
  - Status: resolved(repo evidence, 0056과 동일) — `tsconfig.json`의 `tests/**/*.ts` 범위를 넓히지 않는다. domain `Project.baseRepos`가 required가 되므로 `.ts` test의 `Project` 리터럴은 typecheck가 강제하고, `.tsx` test(`stage-board.test.tsx`, `activity-calendar.test.tsx`)의 fixture는 명시적으로 갱신한다.
- [x] 최종 QA surface
  - Status: resolved(기본값 채택) — Vitest/typecheck/lint/Vite build/CLI suite/contract test를 필수로 통과시키고, production `StageBoard` + CSS를 `renderToStaticMarkup`으로 뽑아 headless Chrome에서 Claude/Codex × 520/460 capture로 overflow와 색을 확인한다. Tauri release build는 background로 돌려 성공만 확인한다. 실제 Tauri 앱 QA는 사용자 환경에서 base repo를 실제로 어긋나게 만들어야 해 이번 plan에서는 사용자 확인 항목으로 남긴다.

## 결정 사항

### D1. CLI `list --json`이 project 수준 `baseRepos[]`를 내려준다

`cmd_list_json`에서 `"root"` 뒤, `"tasks"` 앞에 출력한다. repo마다:

```json
{
  "name": "backend",
  "baseBranch": "develop",
  "branch": "develop",
  "present": true,
  "dirty": false,
  "changedFiles": 0,
  "remoteAvailable": true,
  "ahead": 0,
  "behind": 0
}
```

- `name`: `repo_name_at`, `baseBranch`: `repo_base_branch_at`.
- `present`: `base_repo_path`가 디렉터리이고 `git rev-parse --git-dir`가 성공. false면 나머지는 `branch:""`, `dirty:false`, `changedFiles:0`, `remoteAvailable:false`, `ahead:0`, `behind:0`.
- `branch`: `git branch --show-current`(detached면 `""`).
- `dirty`/`changedFiles`: task repo와 같은 `git status --porcelain` 줄 수 규칙.
- `remoteAvailable`: `git rev-parse --verify --quiet "refs/remotes/origin/<baseBranch>^{commit}"` 성공 여부.
- `ahead`/`behind`: `commit_diff_counts "$path" "$remote_commit"`의 `right`/`left`. remote가 없으면 둘 다 0.
- `list --global --json`은 project 문서를 그대로 이어붙이므로 추가 변경이 없다. 사람용 `list`/`status` 출력은 바꾸지 않는다.

### D2. contract는 optional `baseRepos`, domain은 required `Project.baseRepos`

- `packages/contract/src/index.ts`: `WorkbranchBaseRepo` 타입 추가, `WorkbranchListDocument.baseRepos?: readonly WorkbranchBaseRepo[]`.
- `workbranch-list.schema.json`: `properties.baseRepos`(array of `$defs/baseRepo`)를 `required`에 넣지 않고 추가. `$defs.baseRepo`는 `additionalProperties:false`, 9개 필드 모두 required, 정수 필드 `minimum: 0`.
- fixtures: `list-with-plans.json`에 `baseRepos` 2건(정상 1, behind+dirty 1) 추가. `list-empty.json`은 `baseRepos` 없이 두어 legacy 호환을 검증한다.
- `parseContract.ts`: `isBaseRepo` 검증 + `isListDocument`에서 `baseRepos === undefined || (Array.isArray && every(isBaseRepo))`.
- domain `model.ts`: `BaseRepo` 타입(wire와 동일 9필드), `Project.baseRepos: readonly BaseRepo[]`(required). ACL `mapListDocumentToProject`가 `dto.baseRepos ?? []`로 정규화.
- 모든 `Project` fixture(`.ts` test는 typecheck 강제, `.tsx` test는 수동)에 `baseRepos: []`를 추가한다.

### D3. 건강 상태·다음 동작은 domain 순수 함수다

```ts
export type BaseRepoHealth = "ok" | "warn" | "bad";
export type BaseRepoAction = "pull" | "push" | "check";

export function baseRepoHealth(repo: BaseRepo): BaseRepoHealth {
	if (!repo.present || !repo.remoteAvailable) return "bad";
	if (repo.branch !== repo.baseBranch) return "bad";
	if (repo.ahead > 0 && repo.behind > 0) return "bad";
	if (repo.dirty || repo.ahead > 0 || repo.behind > 0) return "warn";
	return "ok";
}

export function baseRepoAction(repo: BaseRepo): BaseRepoAction | undefined {
	if (baseRepoHealth(repo) === "bad") return "check";
	if (repo.behind > 0) return "pull";
	if (repo.ahead > 0) return "push";
	return undefined;
}
```

facts 문구(`ui/TaskRow.tsx`의 `repoFacts` 옆 `baseRepoFacts`):

- `present:false` → `MISSING`
- 그 외 `[dirty ? "DIRTY N FILE(S)" : "CLEAN", ahead>0 ? "AHEAD N", behind>0 ? "BEHIND N", !remoteAvailable ? "NO REMOTE", branch≠baseBranch ? "EXPECTED <baseBranch>"]`를 ` · `로 연결.

### D4. `MainViewModel.baseRows`는 wire 순서를 유지한다

```ts
export type MainBaseRow = {
	readonly key: string;        // `${root}:${repo.name}`
	readonly project: string;
	readonly root: string;
	readonly repo: BaseRepo;
	readonly showProject: boolean; // 성공 로드된 project 수 > 1
};
```

- `state.projects.flatMap(project => project.baseRepos.map(...))`. 정렬 없음.
- `showProject`는 `state.projects.length > 1`로 모든 행이 같은 값을 가진다. `errors[]`의 unavailable root는 프로젝트 수에 세지 않는다(추정 금지, 0056 partial-success 규칙).
- `activeCount`/`idleCount`/`stageGroups`는 변하지 않는다. base repo는 task placement에 영향을 주지 않는다.

### D5. `StageBoard`가 `00 BASE` 그룹을 캡션 아래·PLAN 위에 렌더링한다

- 새 prop `baseRows: readonly MainBaseRow[]`. `baseRows.length === 0`이면 그룹 생략.
- 마크업:

```tsx
<section aria-label="Base repositories" className="stage-group stage-base-group" data-column="base">
	<header className="stage-group-head" data-column="base">
		<span className="stage-group-num">00</span>
		<span className="stage-group-label">BASE</span>
		<span aria-hidden="true" className="stage-group-rule" />
		<span className="stage-group-count">{baseRows.length}</span>
	</header>
	<div className="stage-group-list" role="list">
		{baseRows.map((row) => <BaseRepoRow key={row.key} row={row} />)}
	</div>
</section>
```

- `BaseRepoRow`(`StageBoard.tsx` 내부 컴포넌트):

```tsx
<div aria-label={`${project} ${name}, ${branch || "no branch"}, ${facts}${action ? `, next ${action}` : ""}`}
     className="stage-base-row" data-health={health} role="listitem">
	<span aria-hidden="true" className="stage-base-dot" />
	<span className="stage-base-name" title={`${project}/${name}`}>
		{showProject ? <span className="stage-base-project">{project}/</span> : null}{name}
	</span>
	<span className="stage-base-branch" title={branch}>{branch === "" ? "—" : branch}</span>
	<span className="stage-base-facts">{facts}</span>
	{action ? <span className="stage-base-action" data-action={action}>{ACTION_LABELS[action]}</span> : null}
</div>
```

- `ACTION_LABELS = { pull: "PULL", push: "PUSH", check: "CHECK" }`.
- 첫 `.stage-group`이 되므로 기존 `.stage-group + .stage-group { border-top }` 규칙이 `01 PLAN` 위에 구분선을 자동으로 만든다. 기존 "renders every stage header when only one stage has tasks" test의 `stage-group-head` 개수(3)는 `baseRows`가 비어 있을 때 유지된다.
- `App.tsx`는 `baseRows={main.baseRows}`를 전달한다. `app-shell.test.tsx` source contract에 추가.

### D6. CSS는 기존 token만 사용한다

`apps/companion/src/styles/stage-board.css`에 추가(신규 색상 token 없음):

| selector | 스펙 |
|---|---|
| `.stage-group-head[data-column="base"] .stage-group-num` | 배경 `--surface-3`, 색 `--muted` |
| `.stage-group-head[data-column="base"] .stage-group-label` | 색 `--muted` |
| `.stage-base-row` | grid `10px minmax(68px, 0.8fr) minmax(0, 1fr) auto auto`, gap 7px, `align-items: center`, padding `5px 2px`, 위쪽 옅은 rule(`color-mix(in srgb, var(--line) 55%, transparent)`), `min-width: 0`, `font-size: var(--fs-body)` |
| `.stage-base-dot` | 7px 원, 배경 `--faint`; `[data-health="warn"]`이면 `--notify`, `[data-health="bad"]`이면 `--blocked` |
| `.stage-base-name` | `--muted` 600, ellipsis + `title`; warn → `--notify`, bad → `--blocked` |
| `.stage-base-project` | `--faint` 400 (접두어) |
| `.stage-base-branch` | `--faint`, ellipsis |
| `.stage-base-facts` | `--fs-meta`, `--muted`, 우측 정렬, `tabular-nums`, `white-space: nowrap`; warn → `--notify`, bad → `--blocked` |
| `.stage-base-action` | pill: `border-radius 999px`, `--fs-label` 700, padding `0 6px`, `letter-spacing 0.04em`; `pull` → `--notify-soft`/`--notify`, `push` → `--done-soft`/`--done`, `check` → `--blocked-soft`/`--blocked` |
| `@media (max-width: 480px)` | `.stage-base-row` grid `10px minmax(64px, 0.8fr) minmax(0, 1fr) auto`; facts는 `grid-column: 2 / 4; grid-row: 2; text-align: left`; pill은 `grid-column: 4; grid-row: 1` |

## UI 가이드

```text
┌ .stage-board ────────────────────────────────────────────┐
│ WORKTREE STATUS 2                                        │
│ 00 BASE ──────────────────────────────────────────────5  │  ← 신규 그룹 (baseRows > 0)
│  ● workbranch/workbranch  main     CLEAN                 │  ← ok: 흐린 점, muted
│  ● monask/backend         develop  CLEAN · AHEAD 1  PUSH │  ← warn: notify 색 + pill
│  ● monask/frontend        develop  DIRTY 1 FILE · BEHIND 1  PULL │
│  ● tasteful-todo/web      main     CLEAN                 │
│  ● tasteful-todo/api      main     CLEAN                 │
│ 01 PLAN ──────────────────────────────────────────────0  │
│ 02 EXECUTION ─────────────────────────────────────────1  │
│  › feature-cpq-task-b  ● RUN  2/5               [actions]│
│  ...                                                     │
└──────────────────────────────────────────────────────────┘
```

- 프로젝트가 1개면 접두어 없이 `● backend  develop  CLEAN`.
- 10px 미만 글자 금지 규칙 유지. 행 본문 `--fs-body`, facts `--fs-meta`, pill `--fs-label`.
- 새 focusable 요소 없음(pill·행은 비대화형). 스크린리더는 행 `aria-label`로 project/repo/branch/facts/next를 읽는다.
- 가로 overflow 금지: name/branch `min-width: 0` + ellipsis + `title`, facts는 460px에서 둘째 줄로 내려간다.

## 범위 밖

- CLI `status` 사람용 출력 변경(별도 시안 https://claude.ai/code/artifact/5623b7eb-4825-47d6-8b85-537120b67a74 은 보류)
- pill 클릭으로 `workbranch pull/push` 실행, Tauri command 추가
- `list --json` 실행 시 `git fetch`
- base repo 변화의 activity event 반영, Activity/Settings 뷰 변경
- Rust/Tauri command·state 변경, 새 dependency
- 사용자 registry의 실제 3개 프로젝트에 대한 native Tauri QA(사용자 확인 항목)

## 변경 파일 구조

```text
apps/cli/src/workbranch/commands/list.sh              # cmd_list_json baseRepos 출력
apps/cli/tests/cases/list-json.sh                     # baseRepos wire 계약 tests
apps/cli/tests/run.sh                                 # 신규 test 등록
apps/cli/bin/workbranch                               # 재빌드 산출물
packages/contract/src/index.ts                        # WorkbranchBaseRepo, baseRepos?
packages/contract/schema/workbranch-list.schema.json  # baseRepos optional + $defs.baseRepo
packages/contract/fixtures/list-with-plans.json       # baseRepos 포함 fixture
apps/companion/src/infrastructure/parseContract.ts    # isBaseRepo 검증
apps/companion/src/infrastructure/acl.ts              # Project.baseRepos 정규화
apps/companion/src/domain/model.ts                    # BaseRepo, baseRepoHealth, baseRepoAction
apps/companion/src/application/state.ts               # MainViewModel.baseRows, MainBaseRow
apps/companion/src/ui/TaskRow.tsx                     # baseRepoFacts
apps/companion/src/ui/StageBoard.tsx                  # 00 BASE 그룹 + BaseRepoRow, baseRows prop
apps/companion/src/App.tsx                            # baseRows 배선
apps/companion/src/styles/stage-board.css             # base 그룹/행/pill 스타일
apps/companion/tests/acl.test.ts                      # parse/map 계약 + fixture baseRepos
apps/companion/tests/model.test.ts                    # health/action/baseRows 계약 + fixture
apps/companion/tests/activity-refresh.test.ts         # base 변화 무시 계약 + fixture
apps/companion/tests/stage-board.test.tsx             # 00 BASE rendering 계약 + fixture
apps/companion/tests/app-shell.test.tsx               # baseRows 배선 + CSS 계약
apps/companion/tests/*.ts(x)                          # Project fixture에 baseRepos: [] 추가
DESIGN.md                                             # IA 항목 + Direction history
README.md, README.ko.md                               # Companion Main view 설명에 base repo 상태 추가
```

---

### Task 1: CLI `list --json` baseRepos (red → green)

**Files:**
- Modify: `apps/cli/tests/cases/list-json.sh`, `apps/cli/tests/run.sh`
- Modify: `apps/cli/src/workbranch/commands/list.sh`

- [ ] **Step 1: failing test 작성** — `test_list_json_base_repos_shape`(frontend/backend 모두 `present:true`, `branch == baseBranch == "master"`, `dirty:false`, `changedFiles:0`, `remoteAvailable:true`, `ahead:0`, `behind:0`, key set 정확히 9개), `test_list_json_base_repos_remote_diff_and_dirty`(`commit_to_remote_master frontend` + fetch → frontend `behind:1`; backend 로컬 commit → `ahead:1`; backend untracked 파일 → `dirty:true`, `changedFiles:1`), `test_list_json_base_repos_missing_worktree_and_remote`(`rm -rf _base/frontend` → `present:false`와 0/""/false; backend `git update-ref -d refs/remotes/origin/master` → `remoteAvailable:false`, `ahead:0`, `behind:0`)를 추가하고 `run.sh`의 list_json 블록에 등록한다.
- [ ] **Step 2: red 확인** — `apps/cli/tests/run.sh`가 `KeyError: 'baseRepos'`로 FAIL.
- [ ] **Step 3: 구현** — D1대로 `cmd_list_json`에 `"baseRepos":[...]` 출력 루프를 추가한다. 기존 `base_commits[]` 계산 루프와 합치지 말고 별도 루프로 두어 가독성을 유지한다.
- [ ] **Step 4: green 확인** — `apps/cli/scripts/build-workbranch.sh` 재빌드 후 신규 3건 + `test_list_json_shape`, `test_list_global_json_projects_and_errors` PASS. `bash -n apps/cli/bin/workbranch`.

### Task 2: contract 타입·schema·fixture (red → green)

**Files:**
- Modify: `packages/contract/src/index.ts`, `packages/contract/schema/workbranch-list.schema.json`, `packages/contract/fixtures/list-with-plans.json`

- [ ] **Step 1: red 확인** — Task 1 이후 `pnpm --filter @workbranch/contract test`의 live CLI test 2건이 `additionalProperty: "baseRepos"`로 FAIL.
- [ ] **Step 2: 구현** — D2대로 TypeScript DTO, JSON Schema(`properties.baseRepos`, `$defs.baseRepo`), fixture를 갱신한다.
- [ ] **Step 3: green 확인** — contract test 3건, `typecheck`, `lint` PASS. `list-empty.json`은 변경하지 않아 optional 계약을 증명한다.

### Task 3: Companion parse → ACL → domain (red → green)

**Files:**
- Modify: `apps/companion/tests/acl.test.ts`
- Modify: `apps/companion/src/infrastructure/parseContract.ts`, `apps/companion/src/infrastructure/acl.ts`, `apps/companion/src/domain/model.ts`
- Modify: `Project` 리터럴을 가진 모든 test(`acl`, `model`, `activity-refresh`, `activity-display-sessions`, `workspace-monitor`, `tauri-client`, `release-markers`, `activity-calendar`, `stage-board`)에 `baseRepos: []` 추가

- [ ] **Step 1: failing test 작성** — parse→map 경유로 `projects[0].baseRepos[0]`가 9필드를 그대로 갖는지, wire에 `baseRepos`가 없으면 `[]`인지, 잘못된 `baseRepos`(필드 누락)는 `parseGlobalDocument`가 throw하는지 검증.
- [ ] **Step 2: red 확인** — `baseRepos` undefined / typecheck 오류 FAIL.
- [ ] **Step 3: 구현 + green** — D2 구현, fixture 일괄 갱신. `pnpm --filter @workbranch/companion test tests/acl.test.ts`와 `typecheck` PASS.

### Task 4: health/action/facts 순수 함수 + `baseRows` projection (red → green)

**Files:**
- Modify: `apps/companion/tests/model.test.ts`, `apps/companion/tests/activity-refresh.test.ts`
- Modify: `apps/companion/src/domain/model.ts`, `apps/companion/src/application/state.ts`, `apps/companion/src/ui/TaskRow.tsx`

- [ ] **Step 1: failing test 작성** — `baseRepoHealth`/`baseRepoAction` 표(ok·dirty만·ahead·behind·diverged·mismatch·no remote·missing), `buildMainViewModel().baseRows`가 프로젝트·config 순서를 유지하고 `showProject`가 프로젝트 1개면 false, 2개면 true이며 `errors[]`는 세지 않는지, `activeCount`/`idleCount`가 변하지 않는지. `activity-refresh.test.ts`에 base repo만 바뀐 refresh가 event 0건인지 추가.
- [ ] **Step 2: red 확인** — export 부재로 FAIL.
- [ ] **Step 3: 구현 + green** — D3/D4 구현. `baseRepoFacts`는 `TaskRow.tsx`에 두고 unit test는 `stage-board.test.tsx`(Task 5)에서 함께 검증한다. model/activity-refresh tests + typecheck PASS.

### Task 5: `StageBoard` 00 BASE 그룹 + CSS + App 배선 (red → green)

**Files:**
- Modify: `apps/companion/tests/stage-board.test.tsx`, `apps/companion/tests/app-shell.test.tsx`
- Modify: `apps/companion/src/ui/StageBoard.tsx`, `apps/companion/src/styles/stage-board.css`, `apps/companion/src/App.tsx`

- [ ] **Step 1: failing test 작성** — (a) `baseRows`가 있으면 `aria-label="Base repositories"`, `data-column="base"`, `>00<`, `>BASE<`, count가 캡션 뒤·`>PLAN<` 앞에 렌더링; (b) 행에 `data-health`, facts 문구(`CLEAN · AHEAD 1`, `DIRTY 1 FILE · BEHIND 1`, `MISSING`, `EXPECTED master`), pill(`PUSH`/`PULL`/`CHECK`), ok 행에는 pill 없음; (c) 프로젝트 2개면 `stage-base-project` 접두어, 1개면 없음; (d) `baseRows`가 비면 `data-column="base"` 부재 + 기존 header 개수 3 유지; (e) `baseRepoFacts` unit 표; (f) `app-shell`: `baseRows={main.baseRows}` source contract, `stage-board.css`에 `.stage-base-row`·`.stage-base-action[data-action="pull"]` 존재.
- [ ] **Step 2: red 확인** — prop/selector 부재 FAIL.
- [ ] **Step 3: 구현 + green** — D5/D6 구현. `renderBoard` helper와 기존 test들의 `<StageBoard>` 호출에 `baseRows` prop을 추가한다. stage-board/app-shell tests + typecheck + lint PASS.

### Task 6: 문서 동기화와 전체 검증

**Files:**
- Modify: `DESIGN.md`, `README.md`, `README.ko.md`

- [ ] **Step 1: DESIGN.md** — Information architecture 3번에 `00 BASE` 그룹을 추가하고 Direction history에 `2026-09-07 (base repo status group)` 항목을 기록한다.
- [ ] **Step 2: README** — 109행 Companion 설명에 base repo remote/dirty 상태를 한 구절 추가(EN/KO).
- [ ] **Step 3: quality gates** — 아래를 모두 통과시킨다. Tauri build는 background로 실행한다.

```bash
apps/cli/scripts/build-workbranch.sh
/bin/bash -n apps/cli/bin/workbranch
apps/cli/tests/run.sh
pnpm --filter @workbranch/contract test
pnpm --filter @workbranch/contract typecheck
pnpm --filter @workbranch/contract lint
pnpm --filter @workbranch/companion test
pnpm --filter @workbranch/companion typecheck
pnpm --filter @workbranch/companion lint
pnpm --filter @workbranch/companion build
pnpm companion:build
git diff --check
```

- [ ] **Step 4: deterministic Chrome visual QA** — production `StageBoard`를 `renderToStaticMarkup`으로 뽑아 `style.css` 전체를 인라인한 harness HTML을 만들고 Claude/Codex × 520/460 capture를 저장한다. 확인 항목: `00 BASE`가 캡션 아래 첫 그룹, ok/warn/bad 색, pill 3종, 접두어, 460px에서 facts 둘째 줄 + 가로 overflow 없음(`document.documentElement.scrollWidth <= clientWidth`).
- [ ] **Step 5: 실제 앱 확인(사용자)** — 사용자가 Companion을 재빌드·실행해 registry의 3개 프로젝트 base repo가 `00 BASE`에 보이는지, `_base` repo를 remote와 어긋나게 했을 때 pill이 뜨는지 확인한다.

## 완료 기준

- [ ] `workbranch list --json`이 project 수준 `baseRepos[]`(9필드)를 내려주고, JSON Schema v1과 live CLI contract test가 통과한다. 구 CLI 출력(`baseRepos` 없음)도 Companion이 파싱한다.
- [ ] Companion Main 보드가 `WORKTREE STATUS` 캡션 아래·`01 PLAN` 위에 `00 BASE` 그룹을 표시한다. 행은 wire 순서, 프로젝트가 2개 이상이면 `project/` 접두어, 정상은 흐린 점 + `CLEAN`, 주의는 notify 색 + `PULL`/`PUSH`, 문제는 blocked 색 + `CHECK`. base 데이터가 없으면 그룹이 없다.
- [ ] base repo 변화는 activity event를 만들지 않고, task placement/idle 집계에 영향을 주지 않는다.
- [ ] 520px/460px, Claude/Codex 모두에서 가로 overflow가 없다.
- [ ] CLI 전체 suite, contract test/typecheck/lint, Companion full tests/typecheck/lint/Vite build/Tauri build, `git diff --check`가 전부 통과한다.
