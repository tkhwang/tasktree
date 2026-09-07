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

### 리뷰 후 확정 (2026-09-07)

구현 전 중요 결정 G1/G2는 사용자 답변으로 확정했다. G1은 repo 수준 조회 오류를 포함한 10필드 DTO, G2는 dirty + behind의 CHECK 안내로 계약·작업·완료 기준에 반영했다. 이 문서는 구현 가능한 계획이며, 결정 확정 자체가 구현 완료나 자동 구현 시작을 의미하지 않는다.

- [x] G1. base repo 조회 실패의 격리 단위
  - Impact: wire/domain 오류 계약, 다른 repo와 task의 표시 유지 여부.
  - Current evidence: `apps/cli/src/workbranch/commands/list.sh`는 status/diff 실패를 clean/0으로 숨긴다. `cmd_list_global_json`은 project 단위 `errors[]`만 제공한다. `apps/companion/src/infrastructure/workspaceMonitor.ts`는 root 단위 refresh 실패 시 기존 project를 유지하지만 전체 refresh는 성공 project만 받는다.
  - Recommended default: 실패한 base repo만 명시적인 조회 불가 상태와 `CHECK`로 표시하고 다른 repo/task는 유지한다.
  - Recommended rationale: 부가 상태 조회 하나 때문에 프로젝트의 기존 task 목록까지 사라지지 않게 한다. 대신 repo 수준 오류 표현을 DTO와 parser/domain/UI에 추가해야 한다. project 전체를 오류 처리하는 대안은 기존 오류 채널을 재사용하지만 장애 범위가 커진다.
  - Status: resolved(user, A) — 실패한 base repo만 조회 불가(`UNAVAILABLE`) + `CHECK`로 표시한다. 다른 repo/task는 유지하며 이 실패만으로 project를 `errors[]`로 이동시키거나 CLI를 실패 종료하지 않는다. 구체 wire 필드는 기존 `WorkbranchBaseRepo`에 `inspectionError`를 추가한다(D1/D2). 새 파일이나 별도 exported 타입은 만들지 않는다.
- [x] G2. dirty + behind의 다음 동작
  - Impact: 사용자에게 안내하는 행동과 CLI preflight의 일치.
  - Current evidence: 기존 D3는 dirty + behind에도 `PULL`을 반환했지만 `apps/cli/src/workbranch/commands/pull.sh:14-19`는 clean worktree를 요구한다. 반면 base push에는 dirty 자체를 차단하는 clean preflight가 없다.
  - Recommended default: pill을 다음 동작 안내로 유지하고 dirty + behind에는 먼저 `CHECK`를 표시한다.
  - Recommended rationale: 실행 전 정리가 필요한 상태를 바로 pull할 수 있는 상태와 구분한다. 대안은 pill을 단순 remote 차이 방향 표시로 재정의하는 것이다.
  - Status: resolved(user, A) — dirty + behind는 CHECK로 먼저 정리를 안내한다. dirty가 해소되고 여전히 behind이면 PULL로 바뀐다. clean + behind는 PULL, ahead-only는 dirty 여부와 무관하게 기존 PUSH, dirty-only는 pill 없음이다. 조회 오류/missing/mismatch/no remote/diverged의 CHECK 우선순위는 유지한다. pill은 마지막 조회 facts에 따른 다음 동작 안내이며 실행 가능성 전체나 원격 최신 상태를 보증하지 않는다.

질문 없이 repo 근거로 확정한 보완: 실제 worktree 식별 및 branch 경계 테스트(D1/Task 1), `DESIGN.md`의 compact/ellipsis·전체 문구 접근 계약에 맞춘 facts 폭 제한(D5/D6), 보드 내부 잘림 검사와 실행 CLI 경로 확인(Task 6). 기존 파일·타입 배치를 유지하고 신규 영구 파일/디렉터리/패키지 export는 추가하지 않는다. 사용자 실제 registry/저장소 변경 및 native 실환경 확인은 기존 별도 확인 범위를 유지한다.

### 기존 결정

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
  - Status: resolved(G1/G2 반영) — `bad`: 조회 불가(`inspectionError !== null`), worktree 없음(`present:false`), remote ref 없음(`remoteAvailable:false`), 현재 branch ≠ baseBranch, ahead·behind 동시 존재(diverged). `warn`: dirty 또는 ahead 또는 behind. `ok`: 나머지. 다음 동작 우선순위: `bad → CHECK`, dirty + behind → CHECK, clean + behind → PULL, ahead-only → PUSH, dirty-only/ok → 없음. dirty + behind의 health는 warn을 유지한다. CHECK가 항상 bad를 뜻하지는 않는다.
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
  "behind": 0,
  "inspectionError": null
}
```

- `name`: `repo_name_at`, `baseBranch`: `repo_base_branch_at`.
- `present`: 해당 경로가 실제 worktree인지 검사한다. `git rev-parse --is-inside-work-tree`가 `true`이고 canonical `--show-toplevel`이 canonical `base_repo_path`와 같아야 한다. bare repo나 상위 저장소를 발견한 일반 디렉터리를 정상 base worktree로 인정하지 않는다. 경로 부재가 확인되면 `present:false`, `inspectionError:null`로 `MISSING`을 표시한다. 경로가 있으나 worktree가 아님이 확인되면 `present:false`, `inspectionError:"invalid-worktree"`다. 권한 등으로 존재/유효성을 판단할 수 없으면 부재로 단정하지 않고 `inspectionError:"git-read-failed"`로 처리한다. 오류 시 `present`는 정상 worktree 확인에 성공한 경우에만 true이며, UI는 error를 먼저 판정한다.
- `branch`: `git branch --show-current`(detached면 `""`).
- `dirty`/`changedFiles`: task repo와 같은 `git status --porcelain` 줄 수 규칙.
- `remoteAvailable`: `git rev-parse --verify --quiet "refs/remotes/origin/<baseBranch>^{commit}"` 성공 여부.
- `ahead`/`behind`: `commit_diff_counts "$path" "$remote_commit"`의 `right`/`left`. remote가 없으면 둘 다 0.
- `inspectionError`: required, `null | "invalid-worktree" | "git-read-failed"`. 정상 조회와 확인된 경로/remote ref 부재는 null이다. worktree 식별, branch/status/commit 비교 등의 예상치 못한 조회 실패는 해당 repo에서 격리한다. ref 부재와 Git 실행/읽기 오류를 구분하며 detached HEAD의 정상 빈 branch는 오류가 아니다. 기존 helper가 실패를 0으로 숨기는 경우 호출 경계에서 실제 성공 여부를 보장해야 한다.
- 조회 오류가 있으면 부분적으로 얻은 Git facts를 정상 snapshot으로 섞어 쓰지 않는다. `branch:""`, `dirty:false`, `changedFiles:0`, `remoteAvailable:false`, `ahead:0`, `behind:0`으로 정규화하되, 이는 오류 payload의 자리 채움 값일 뿐 건강 상태 판정·`CLEAN`·차이 수치 표시에 사용하지 않는다. 확인된 missing도 같은 sentinel을 사용한다. `name`/`baseBranch`와 config 행 순서는 유지한다.
- base repo 하나의 조회 실패는 `list --json`/`list --global --json`의 프로젝트 성공 여부를 바꾸지 않는다. 해당 행을 포함해 다른 base repo와 기존 tasks를 계속 출력하고, 이 실패만으로 global `errors[]` 항목을 추가하지 않는다. config/root 자체의 기존 프로젝트 오류 처리는 유지한다. raw Git stderr를 JSON stdout에 섞거나 UI에 노출하지 않는다.
- `list --global --json`은 project 문서를 그대로 이어붙이므로 추가 변경이 없다. 사람용 `list`/`status` 출력은 바꾸지 않는다.

### D2. contract는 optional `baseRepos`, domain은 required `Project.baseRepos`

- `packages/contract/src/index.ts`: 기존 `WorkbranchBaseRepo` export에 `readonly inspectionError: "invalid-worktree" | "git-read-failed" | null`을 추가한다. `WorkbranchListDocument.baseRepos?: readonly WorkbranchBaseRepo[]`는 유지한다. 오류 코드는 이 필드의 inline union으로 두며 별도 package export를 추가하지 않는다.
- `workbranch-list.schema.json`: `properties.baseRepos`(array of `$defs/baseRepo`)는 optional이다. `$defs.baseRepo`는 `additionalProperties:false`, 10개 필드 모두 required, 정수 필드 `minimum: 0`, `inspectionError`는 D1의 enum(null 포함)으로 검증한다.
- fixtures: 기존 `list-with-plans.json`에 정상, behind+dirty, 조회 실패 base repo를 포함한다. 정상 행에도 `inspectionError:null`을 넣는다. `list-empty.json`은 `baseRepos` 없이 두어 legacy 호환을 검증한다. 새 fixture 파일은 만들지 않는다.
- `parseContract.ts`: `isBaseRepo`에서 10개 필드와 error enum을 검증하고 `isListDocument`에서 `baseRepos === undefined || (Array.isArray && every(isBaseRepo))`를 검사한다. 오류 상태 자체는 유효 payload이며 project 전체 파싱 실패 사유가 아니다. 알 수 없는 오류 코드/필드 누락은 거부한다.
- domain `model.ts`: `BaseRepo` 타입(wire와 동일 10필드), `Project.baseRepos: readonly BaseRepo[]`(required). ACL은 `inspectionError`를 보존하고 `dto.baseRepos ?? []`로 정규화한다. `baseRepos`가 없는 구 CLI만 기존 legacy 계약으로 지원하며, 구현 중간의 9필드 payload를 정상값으로 묵시 변환하지 않는다.
- 모든 `Project` fixture(`.ts` test는 typecheck 강제, `.tsx` test는 수동)에 `baseRepos: []`를 추가한다.

### D3. 건강 상태·다음 동작은 domain 순수 함수다

```ts
export type BaseRepoHealth = "ok" | "warn" | "bad";
export type BaseRepoAction = "pull" | "push" | "check";

export function baseRepoHealth(repo: BaseRepo): BaseRepoHealth {
	if (repo.inspectionError !== null) return "bad";
	if (!repo.present || !repo.remoteAvailable) return "bad";
	if (repo.branch !== repo.baseBranch) return "bad";
	if (repo.ahead > 0 && repo.behind > 0) return "bad";
	if (repo.dirty || repo.ahead > 0 || repo.behind > 0) return "warn";
	return "ok";
}

export function baseRepoAction(repo: BaseRepo): BaseRepoAction | undefined {
	if (baseRepoHealth(repo) === "bad") return "check";
	if (repo.dirty && repo.behind > 0) return "check";
	if (repo.behind > 0) return "pull";
	if (repo.ahead > 0) return "push";
	return undefined;
}
```

facts 문구(`ui/TaskRow.tsx`의 `repoFacts` 옆 `baseRepoFacts`):

- dirty + behind의 facts(`DIRTY N FILE(S) · BEHIND N`)는 유지하고 pill만 CHECK로 바꾼다. 접근성/tooltip에는 "Clean working tree before pulling"을 포함한다. 정리 후에도 behind이면 `CLEAN · BEHIND N` + PULL을 표시한다. 행/dot은 health에 따라 notify(warn), CHECK pill은 기존 blocked 색 token을 사용한다. pill은 비대화형 안내이며 fetch·rebase 상태·권한 등 전체 preflight를 대신하지 않는다.

- `inspectionError !== null` → `UNAVAILABLE`을 최우선 표시하고 `CHECK`를 유지한다. `invalid-worktree`는 "Invalid base worktree", `git-read-failed`는 "Git status could not be read"를 title/접근성 문구로 제공한다. sentinel에서 파생한 `CLEAN`, `NO REMOTE`, `EXPECTED`, ahead/behind는 함께 표시하지 않는다. branch 칸은 `—`, 접근성 문구는 "branch unavailable"로 표시해 detached/no branch와 구분한다.
- 오류 없이 `present:false` → `MISSING`
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
<div aria-label={`${project} ${name}, ${repo.inspectionError !== null ? "branch unavailable" : branch || "no branch"}, ${facts}${action ? `, next ${action}` : ""}`}
     className="stage-base-row" data-health={health} role="listitem">
	<span aria-hidden="true" className="stage-base-dot" />
	<span className="stage-base-name" title={`${project}/${name}`}>
		{showProject ? <span className="stage-base-project">{project}/</span> : null}{name}
	</span>
	<span className="stage-base-branch" title={branch}>{branch === "" ? "—" : branch}</span>
	<span className="stage-base-facts" title={facts}>{facts}</span>
	{action ? <span className="stage-base-action" data-action={action}>{ACTION_LABELS[action]}</span> : null}
</div>
```

- `ACTION_LABELS = { pull: "PULL", push: "PUSH", check: "CHECK" }`.
- 행의 title과 aria-label에는 D3의 오류/정리 안내를 추가한다. `facts` 문자열은 생략하지 않은 전체 값을 사용하고 시각적 ellipsis만 CSS로 적용한다. CHECK pill과 상태 점은 잘림 대상에서 제외한다.
- 첫 `.stage-group`이 되므로 기존 `.stage-group + .stage-group { border-top }` 규칙이 `01 PLAN` 위에 구분선을 자동으로 만든다. 기존 "renders every stage header when only one stage has tasks" test의 `stage-group-head` 개수(3)는 `baseRows`가 비어 있을 때 유지된다.
- `App.tsx`는 `baseRows={main.baseRows}`를 전달한다. `app-shell.test.tsx` source contract에 추가.

### D6. CSS는 기존 token만 사용한다

`apps/companion/src/styles/stage-board.css`에 추가(신규 색상 token 없음):

| selector | 스펙 |
|---|---|
| `.stage-group-head[data-column="base"] .stage-group-num` | 배경 `--surface-3`, 색 `--muted` |
| `.stage-group-head[data-column="base"] .stage-group-label` | 색 `--muted` |
| `.stage-base-row` | grid `10px minmax(68px, 0.8fr) minmax(0, 1fr) minmax(0, 1.5fr) auto`, gap 7px, `align-items: center`, padding `5px 2px`, 위쪽 옅은 rule(`color-mix(in srgb, var(--line) 55%, transparent)`), `min-width: 0`, `font-size: var(--fs-body)`. facts는 무제한 auto track을 사용하지 않고 남은 폭 안에서 축소한다. |
| `.stage-base-dot` | 7px 원, 배경 `--faint`; `[data-health="warn"]`이면 `--notify`, `[data-health="bad"]`이면 `--blocked` |
| `.stage-base-name` | `--muted` 600, ellipsis + `title`; warn → `--notify`, bad → `--blocked` |
| `.stage-base-project` | `--faint` 400 (접두어) |
| `.stage-base-branch` | `--faint`, ellipsis |
| `.stage-base-facts` | `--fs-meta`, `--muted`, 우측 정렬, `tabular-nums`, `white-space: nowrap`, `min-width: 0`, `overflow: hidden`, `text-overflow: ellipsis`; 전체 facts는 title/행 aria-label로 보존. warn → `--notify`, bad → `--blocked` |
| `.stage-base-action` | pill: `border-radius 999px`, `--fs-label` 700, padding `0 6px`, `letter-spacing 0.04em`; `pull` → `--notify-soft`/`--notify`, `push` → `--done-soft`/`--done`, `check` → `--blocked-soft`/`--blocked` |
| `@media (max-width: 480px)` | `.stage-base-row` grid `10px minmax(64px, 0.8fr) minmax(0, 1fr) auto`; facts는 `grid-column: 2 / 4; grid-row: 2; text-align: left`; pill은 `grid-column: 4; grid-row: 1` |

## UI 가이드

```text
┌ .stage-board ────────────────────────────────────────────┐
│ WORKTREE STATUS 2                                        │
│ 00 BASE ──────────────────────────────────────────────5  │  ← 신규 그룹 (baseRows > 0)
│  ● workbranch/workbranch  main     CLEAN                 │  ← ok: 흐린 점, muted
│  ● monask/backend         develop  CLEAN · AHEAD 1  PUSH │  ← warn: notify 색 + pill
│  ● monask/frontend        develop  DIRTY 1 FILE · BEHIND 1 CHECK │
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
- 가로 overflow 금지: name/branch/facts 모두 `min-width: 0` + ellipsis + 전체 값 `title`/접근성 문구. facts는 460px에서 둘째 줄로 내려가지만 그 줄에서도 폭 제한을 유지한다. 핵심 상태 점과 pill은 항상 보이며, 보드의 overflow hidden으로 행 잘림을 숨기는 방식은 허용하지 않는다.

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
packages/contract/tests/contract.test.mjs             # 오류 필드 schema 경계 및 live CLI 검증
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

- [x] **Step 1: failing test 작성** — `test_list_json_base_repos_shape`(frontend/backend 모두 `present:true`, `branch == baseBranch == "master"`, `dirty:false`, `changedFiles:0`, `remoteAvailable:true`, `ahead:0`, `behind:0`, inspectionError:null, key set 정확히 10개), `test_list_json_base_repos_remote_diff_and_dirty`(`commit_to_remote_master frontend` + fetch → frontend `behind:1`; backend 로컬 commit → `ahead:1`; backend untracked 파일 → `dirty:true`, `changedFiles:1`), `test_list_json_base_repos_missing_worktree_and_remote`(`rm -rf _base/frontend` → `present:false`와 0/""/false; backend `git update-ref -d refs/remotes/origin/master` → `remoteAvailable:false`, `ahead:0`, `behind:0`)를 추가하고 `run.sh`의 list_json 블록에 등록한다.
- [x] **Step 2: red 확인** — 현재 작업 트리에는 baseRepos producer가 이미 있으므로 `KeyError`를 전제하지 않는다. 기존 테스트에 bare repo·상위 저장소 오인·다른 branch·detached HEAD 사례를 추가한다. 실제 branch 출력과 `origin/<baseBranch>` 비교 기준을 검증하고 새 경계 테스트의 실패를 확인한다. bare/상위 저장소 오인은 inspectionError:"invalid-worktree", 예상치 못한 Git 조회 실패는 "git-read-failed"를 기대한다. 기존 테스트 harness 안에서 status/commit 비교 실패를 결정적으로 주입하고, 실패 행은 UNAVAILABLE용 sentinel이지만 정상 sibling repo/tasks가 보존되며 project/global JSON은 성공 종료하고 errors[]가 증가하지 않는지 확인한다. 신규 파일은 만들지 않는다.
- [x] **Step 3: 구현** — D1대로 `cmd_list_json`에 `"baseRepos":[...]` 출력 루프를 추가한다. 기존 `base_commits[]` 계산 루프와 합치지 말고 별도 루프로 두어 가독성을 유지한다.
- [x] **Step 4: green 확인** — `apps/cli/scripts/build-workbranch.sh` 재빌드 후 기존 baseRepos 3건과 추가 경계 테스트, `test_list_json_shape`, `test_list_global_json_projects_and_errors` PASS. `bash -n apps/cli/bin/workbranch`.

검증: `/tmp/0057-task1-red.log`(초기 red), `/tmp/0057-task1-edge-red.log`(권한/invalid ref red), `/tmp/0057-task1-targeted-final.log`(12/12 PASS), 생성 파일 재빌드·bash 문법 PASS. 전체 CLI suite는 Task 6에서 최종 확인한다.

리뷰 보완 완료: dangling symbolic remote ref red 재현 후 git-read-failed로 격리. `/tmp/0057-task1-targeted-final.log` 13/13 PASS, syntax/generated parity PASS.

### Task 2: contract 타입·schema·fixture (red → green)

**Files:**
- Modify: `packages/contract/src/index.ts`, `packages/contract/schema/workbranch-list.schema.json`, `packages/contract/fixtures/list-with-plans.json`
- Modify: `packages/contract/tests/contract.test.mjs` (기존 파일)

- [x] **Step 1: red 확인** — 현재 producer/schema 구현 상태를 먼저 확인한다. `inspectionError`가 없는 payload 및 알 수 없는 오류 코드를 거부하는 검사, 유효 오류 행을 허용하는 검사를 기존 contract test에 추가하고 실패를 확인한다. 특정 additionalProperty 오류나 실패 건수를 전제하지 않는다.
- [x] **Step 2: 구현** — D2대로 TypeScript DTO, JSON Schema(`properties.baseRepos`, `$defs.baseRepo`), fixture를 갱신한다.
- [x] **Step 3: green 확인** — 기존 및 추가 contract test 전체, `typecheck`, `lint` PASS. `list-empty.json`은 변경하지 않아 optional 계약을 증명한다.

검증: `/tmp/workbranch-0057-task2-red.log`의 예상 실패 확인 후 `/tmp/workbranch-0057-task2-verified.log`에서 contract 7/7, typecheck/lint/build PASS.

### Task 3: Companion parse → ACL → domain (red → green)

**Files:**
- Modify: `apps/companion/tests/acl.test.ts`
- Modify: `apps/companion/src/infrastructure/parseContract.ts`, `apps/companion/src/infrastructure/acl.ts`, `apps/companion/src/domain/model.ts`
- Modify: `Project` 리터럴을 가진 모든 test(`acl`, `model`, `activity-refresh`, `activity-display-sessions`, `workspace-monitor`, `tauri-client`, `release-markers`, `activity-calendar`, `stage-board`)에 `baseRepos: []` 추가

- [x] **Step 1: failing test 작성** — parse→map 경유로 `projects[0].baseRepos[0]`가 inspectionError를 포함한 10필드를 그대로 갖는지, wire에 `baseRepos`가 없으면 `[]`인지, 유효한 조회 오류 행은 프로젝트 파싱을 실패시키지 않고 정상 sibling/task와 함께 보존되는지, 잘못된 `baseRepos`(필드 누락/알 수 없는 오류 코드)는 `parseGlobalDocument`가 throw하는지 검증.
- [x] **Step 2: red 확인** — `baseRepos` undefined / typecheck 오류 FAIL.
- [x] **Step 3: 구현 + green** — D2 구현, fixture 일괄 갱신. `pnpm --filter @workbranch/companion test tests/acl.test.ts`와 `typecheck` PASS.

검증: `/tmp/workbranch-0057-task3-red-test.log` 4건 예상 실패 → `task3-green-acl.log` 11/11, `task3-full-test.log` 162/162. typecheck/lint/build PASS.

### Task 4: health/action/facts 순수 함수 + `baseRows` projection (red → green)

**Files:**
- Modify: `apps/companion/tests/model.test.ts`, `apps/companion/tests/activity-refresh.test.ts`
- Modify: `apps/companion/src/domain/model.ts`, `apps/companion/src/application/state.ts`, `apps/companion/src/ui/TaskRow.tsx`

- [x] **Step 1: failing test 작성** — `baseRepoHealth`/`baseRepoAction` 표(ok·dirty-only·clean+ahead·dirty+ahead·clean+behind·dirty+behind·diverged·mismatch·no remote·missing·invalid-worktree·git-read-failed)와 dirty+behind(warn/CHECK) → clean+behind(warn/PULL) → clean+동기화(ok/pill 없음) 전환, `buildMainViewModel().baseRows`가 프로젝트·config 순서를 유지하고 `showProject`가 프로젝트 1개면 false, 2개면 true이며 `errors[]`는 세지 않는지, `activeCount`/`idleCount`가 변하지 않는지. `activity-refresh.test.ts`에 base repo 상태만 바뀐 refresh(조회 오류 발생/회복 포함)가 event 0건인지 추가.
- [x] **Step 2: red 확인** — export 부재로 FAIL.
- [x] **Step 3: 구현 + green** — D3/D4 구현. `baseRepoFacts`는 `TaskRow.tsx`에 두고 unit test는 `stage-board.test.tsx`(Task 5)에서 함께 검증한다. model/activity-refresh tests + typecheck PASS.

검증: export/projection 부재로 15건 red 확인. `/tmp/workbranch-0057-task4-verified.log` model/activity PASS, 전체 Companion 179건 및 typecheck/lint/Vite build PASS. CLI 최종 전체 suite `/tmp/0057-task1-cli-full-final.log` 295건 PASS.

### Task 5: `StageBoard` 00 BASE 그룹 + CSS + App 배선 (red → green)

**Files:**
- Modify: `apps/companion/tests/stage-board.test.tsx`, `apps/companion/tests/app-shell.test.tsx`
- Modify: `apps/companion/src/ui/StageBoard.tsx`, `apps/companion/src/styles/stage-board.css`, `apps/companion/src/App.tsx`

- [x] **Step 1: failing test 작성** — (a) `baseRows`가 있으면 `aria-label="Base repositories"`, `data-column="base"`, `>00<`, `>BASE<`, count가 캡션 뒤·`>PLAN<` 앞에 렌더링; (b) 행에 `data-health`, facts 문구(`CLEAN · AHEAD 1`, `DIRTY 1 FILE · BEHIND 1`, `MISSING`, `EXPECTED master`), pill(`PUSH`/`PULL`/`CHECK`), dirty+behind는 warn 행 + CHECK pill + 정리 안내이고 clean+behind는 PULL이며 dirty+ahead는 PUSH임; 조회 오류 행에는 UNAVAILABLE + CHECK와 안전한 오류 설명이 있고 CLEAN/NO REMOTE/EXPECTED/차이 수치가 없으며, 정상 sibling/task는 유지됨; ok 행에는 pill 없음; (c) 프로젝트 2개면 `stage-base-project` 접두어, 1개면 없음; (d) `baseRows`가 비면 `data-column="base"` 부재 + 기존 header 개수 3 유지; (e) `baseRepoFacts` unit 표; (f) `app-shell`: `baseRows={main.baseRows}` source contract, `stage-board.css`에 `.stage-base-row`·`.stage-base-action[data-action="pull"]` 존재.
- [x] **Step 2: red 확인** — prop/selector 부재 FAIL.
- [x] **Step 3: 구현 + green** — D5/D6 구현. `renderBoard` helper와 기존 test들의 `<StageBoard>` 호출에 `baseRows` prop을 추가한다. stage-board/app-shell tests + typecheck + lint PASS.

검증: `/tmp/workbranch-0057-task5-red.log` 5건 red → `/tmp/workbranch-0057-task5-verified.log` UI 43/43, typecheck/lint/Vite build PASS. 실제 화면 검증은 Task 6에서 수행한다.

### Task 6: 문서 동기화와 전체 검증

**Files:**
- Modify: `DESIGN.md`, `README.md`, `README.ko.md`

- [x] **Step 1: DESIGN.md** — Information architecture 3번에 `00 BASE` 그룹을 추가하고 Direction history에 `2026-09-07 (base repo status group)` 항목을 기록한다.
- [x] **Step 2: README** — 109행 Companion 설명에 base repo remote/dirty 상태를 한 구절 추가(EN/KO).
- [x] **Step 3: quality gates** — 아래를 모두 통과시킨다. Tauri build는 background로 실행한다.

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

- [x] **Step 4: deterministic Chrome visual QA** — production `StageBoard`를 `renderToStaticMarkup`으로 뽑아 `style.css` 전체를 인라인한 harness HTML을 만들고 Claude/Codex × 520/460 capture를 저장한다. 확인 항목: `00 BASE`가 캡션 아래 첫 그룹, ok/warn/bad 색, pill 3종, 접두어, 460px에서 facts 둘째 줄 + 가로 overflow 없음(`document.documentElement.scrollWidth <= clientWidth`).
  - 문서 폭 검사만으로 통과시키지 않는다. 기존 `.stage-board { overflow: hidden }`이 자식 overflow를 가릴 수 있으므로 각 행의 내부 폭, facts의 잘림 처리와 전체 문구 접근, pill이 보드 안에 온전히 보이는지를 함께 검증한다. 긴 repo/branch, 긴 `EXPECTED <baseBranch>`, dirty + diverged 복합 상태 및 최대 글자 크기를 포함한다. `DESIGN.md`의 compact/ellipsis와 title·접근성 전체 값 계약을 유지한다.
- [ ] **Step 5: 실제 앱 확인(사용자)** — 사용자가 Companion을 재빌드·실행해 registry의 3개 프로젝트 base repo가 `00 BASE`에 보이는지, `_base` repo를 remote와 어긋나게 했을 때 pill이 뜨는지 확인한다.
  - 실행 전 실제 Companion이 선택하는 CLI 경로를 확인한다. `workbranch_bin.rs`는 registry의 `workbranchBin`과 설치된 CLI를 로컬 빌드보다 먼저 선택하므로 앱 재빌드만으로 새 producer 연결을 가정하지 않는다. 검증 대상 바이너리의 `list --global --json`에 `baseRepos`가 있는지 확인하고, 구 CLI 호환에 따른 그룹 생략과 신 CLI 연결 성공을 별도로 판정한다. 사용자 registry/저장소는 확인 없이 변경하지 않는다.

## 완료 기준

- [x] `workbranch list --json`이 project 수준 `baseRepos[]`(inspectionError 포함 10필드)를 내려주고, JSON Schema v1과 live CLI contract test가 통과한다. 구 CLI 출력(`baseRepos` 없음)도 Companion이 파싱한다.
- [x] Companion Main 보드가 `WORKTREE STATUS` 캡션 아래·`01 PLAN` 위에 `00 BASE` 그룹을 표시한다. 행은 wire 순서, 프로젝트가 2개 이상이면 `project/` 접두어, 정상은 흐린 점 + `CLEAN`, 주의 행은 notify 색이며 clean+behind는 PULL, dirty+behind는 CHECK, ahead-only는 PUSH, dirty-only는 pill 없음이다. 문제 행은 blocked 색 + CHECK이며 CHECK pill은 기존 blocked token을 사용한다. base 데이터가 없으면 그룹이 없다.
- [x] base repo 하나의 조회 실패는 해당 행만 UNAVAILABLE + CHECK로 표시하고 다른 repo/task를 유지한다. 이 실패만으로 project/global 조회가 실패하거나 errors[]에 project 오류가 생기지 않으며, 성공값으로 가장한 CLEAN/0을 노출하지 않는다. 오류 회복 시 정상 facts로 돌아온다.
- [x] base repo 변화는 activity event를 만들지 않고, task placement/idle 집계에 영향을 주지 않는다.
- [x] 520px/460px, Claude/Codex 모두에서 가로 overflow가 없고 최대 글자 크기·긴 복합 facts에서도 상태 점/pill이 잘리지 않는다. facts는 정해진 폭 안에서 ellipsis 처리하며 전체 문구에 접근할 수 있다. 문서 폭 검사만으로 완료 판정하지 않는다.
- [x] CLI 전체 suite, contract test/typecheck/lint, Companion full tests/typecheck/lint/Vite build/Tauri build, `git diff --check`가 전부 통과한다.

## 실행 결과 (2026-09-07)

- Task 1–5 및 Task 6의 agent 검증 완료. Task 6 Step 5는 계획대로 사용자 native 실환경 확인 항목으로 남긴다. 커밋·푸시·설치된 CLI·사용자 registry 변경 없음.
- CLI: 최종 targeted 13/13, 전체 295/295 (`/tmp/0057-task1-cli-full-final.log`). Contract 7/7, Companion 184/184, 양쪽 typecheck/lint/build PASS. lint는 정보성 진단 75건, 오류 없음. Tauri release bundle PASS (`/tmp/workbranch-0057-tauri-build.log`). bash 문법·ShellCheck error severity·생성 binary parity·git diff --check PASS.
- 실제 임시 Git 프로젝트의 JSON을 production parser → ACL → view model → StageBoard에 연결해 dirty CHECK → clean PULL, 오류 repo·정상 sibling/task 유지, help/잘못된 명령을 검증했다.
- 시각 QA: Claude/Codex × 520/460 × medium/extra-large × live/clean/edge/long/legacy = 40개 capture와 geometry 검사 PASS. 136개 base 행에서 보드/행 overflow, dot/pill 잘림, 불필요한 focusable 요소 없음. 두 독립 시각 리뷰 PASS; 코드 spec/quality/security 경계 리뷰 PASS.
- 재현 자료: `/tmp/workbranch-0057-qa.B0CuMs/render.mjs`, `live-before.json`, `live-clean.json`, `visual-metrics.json`, `review-summary.md`, PNG 40개. 실제 Chrome에서 초기 BASE 화면과 접근성 문구도 확인했다. 접근 불가한 원본 mockup과의 pixel 동일성은 주장하지 않는다.
- 실환경 연결 확인: `/tmp/workbranch-0057-runtime-cli-check.json`. 실제 resolver는 `/opt/homebrew/bin/workbranch`를 선택하며 현재 3개 project 모두 baseRepos가 없다. 새 CLI를 설치/명시 연결한 뒤 native 앱의 BASE 표시를 확인해야 한다. 이 적용/사용자 확인은 아직 수행하지 않았다.
