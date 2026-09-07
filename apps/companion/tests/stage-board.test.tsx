import { readFileSync } from "node:fs";
import { Children, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type RepoNotes, repoNoteKey } from "../src/application/notes";
import { buildMainViewModel } from "../src/application/state";
import type {
	BaseRepo,
	GlobalState,
	Plan,
	Repo,
	Task,
} from "../src/domain/model";
import { StageBoard, StageTaskBlock } from "../src/ui/StageBoard";
import { baseRepoFacts, currentWorkText } from "../src/ui/TaskRow";

type ButtonProps = {
	readonly "aria-label"?: string;
	readonly children?: ReactNode;
	readonly disabled?: boolean;
	readonly onClick?: (event: { readonly detail: number }) => void;
	readonly onDoubleClick?: () => void;
	readonly onKeyDown?: (event: {
		readonly key: string;
		readonly metaKey: boolean;
		readonly ctrlKey: boolean;
		readonly preventDefault: () => void;
	}) => void;
};

function collectButtonProps(node: ReactNode): readonly ButtonProps[] {
	const buttons: ButtonProps[] = [];
	const visit = (child: ReactNode): void => {
		if (!isValidElement<ButtonProps>(child)) return;
		if (child.type === "button") buttons.push(child.props);
		Children.forEach(child.props.children, visit);
	};
	visit(node);
	return buttons;
}

const dirtyRepo: Repo = {
	name: "workbranch",
	branch: "feat/update-ui-0824",
	dirty: true,
	activityAvailable: true,
	ahead: 2,
	behind: 0,
	changedFiles: 7,
	lastCommitSubject: "implement companion activity feed",
	lastCommitAt: 3_500,
};

const cleanRepo: Repo = {
	...dirtyRepo,
	name: "docs",
	dirty: false,
	ahead: 0,
	behind: 1,
	changedFiles: 0,
};

function baseRepo(overrides: Partial<BaseRepo> = {}): BaseRepo {
	return {
		name: "workbranch",
		baseBranch: "main",
		branch: "main",
		present: true,
		dirty: false,
		changedFiles: 0,
		remoteAvailable: true,
		ahead: 0,
		behind: 0,
		inspectionError: null,
		...overrides,
	};
}

function task(
	name: string,
	status: Task["plans"][number]["status"],
	updatedAt: number,
	repos: readonly Repo[] = [],
): Task {
	return {
		name,
		path: `/tmp/acme/${name}`,
		notiCount: status === "review" ? 1 : 0,
		updatedAt,
		repos,
		plans: [
			{
				title: `${name} plan`,
				index: 0,
				status,
				progressDone: status === "review" ? 3 : 1,
				progressTotal: 4,
				currentItem: `${name} current work`,
				summary: "",
				steps: [],
			},
		],
	};
}

const state: GlobalState = {
	projects: [
		{
			name: "acme",
			root: "/tmp/acme",
			tasks: [
				task("planning-task", "planning", 10, [cleanRepo]),
				task("execution-task", "in-progress", 20, [dirtyRepo]),
				task("blocked-task", "blocked", 30, [dirtyRepo]),
				task("review-task", "review", 40, [cleanRepo]),
				task("planning-no-repo", "planning", 5),
				task("clean-done", "done", 50, [cleanRepo]),
			],
			baseRepos: [],
		},
	],
	errors: [],
};

const main = buildMainViewModel(state);
const notes: RepoNotes = {
	[repoNoteKey(dirtyRepo.name, dirtyRepo.branch)]: "rebase 전에 충돌 확인",
};

const currentWorkPlan: Plan = {
	title: "Implementation plan",
	index: 0,
	status: "in-progress",
	steps: [],
	progressDone: 0,
	progressTotal: 0,
	currentItem: "",
	summary: "Brief summary",
};

const currentWorkTask: Task = {
	name: "feat-current-work",
	path: "/tmp/acme/feat-current-work",
	notiCount: 0,
	updatedAt: 10,
	repos: [],
	plans: [currentWorkPlan],
};

function renderBoard(selectedKey?: string): string {
	return renderToStaticMarkup(
		<StageBoard
			activeCount={main.activeCount}
			baseRows={main.baseRows}
			groups={main.stageGroups}
			idleCount={main.idleCount}
			idleRows={main.idleRows}
			notes={notes}
			nowSeconds={3_600}
			onAction={() => undefined}
			onSaveNote={() => undefined}
			onSelect={() => undefined}
			selectedKey={selectedKey}
		/>,
	);
}

describe("StageBoard", () => {
	it("formats base repository facts from highest-priority availability through branch drift", () => {
		expect(
			baseRepoFacts(
				baseRepo({
					inspectionError: "git-read-failed",
					dirty: true,
					changedFiles: 2,
					remoteAvailable: false,
					branch: "release",
					ahead: 3,
					behind: 4,
				}),
			),
		).toBe("UNAVAILABLE");
		expect(baseRepoFacts(baseRepo({ present: false }))).toBe("MISSING");
		expect(baseRepoFacts(baseRepo({ remoteAvailable: false }))).toBe(
			"CLEAN · NO REMOTE",
		);
		expect(baseRepoFacts(baseRepo({ branch: "release" }))).toBe(
			"CLEAN · EXPECTED main",
		);
		expect(
			baseRepoFacts(
				baseRepo({ dirty: true, changedFiles: 1, ahead: 1, behind: 1 }),
			),
		).toBe("DIRTY 1 FILE · AHEAD 1 · BEHIND 1");
	});

	it("renders BASE after the caption and before PLAN with health and next-action guidance", () => {
		const baseMain = buildMainViewModel({
			projects: [
				{
					name: "acme",
					root: "/tmp/acme",
					tasks: [task("sibling-task", "planning", 10)],
					baseRepos: [
						baseRepo({ name: "clean" }),
						baseRepo({ name: "ahead", ahead: 1 }),
						baseRepo({
							name: "dirty-ahead",
							dirty: true,
							changedFiles: 2,
							ahead: 1,
						}),
						baseRepo({
							name: "dirty-behind",
							dirty: true,
							changedFiles: 1,
							behind: 1,
						}),
						baseRepo({ name: "clean-behind", behind: 1 }),
						baseRepo({ name: "missing", present: false }),
						baseRepo({ name: "wrong-branch", branch: "release" }),
					],
				},
			],
			errors: [],
		});
		const html = renderToStaticMarkup(
			<StageBoard
				activeCount={baseMain.activeCount}
				baseRows={baseMain.baseRows}
				groups={baseMain.stageGroups}
				idleCount={baseMain.idleCount}
				idleRows={baseMain.idleRows}
				notes={{}}
				nowSeconds={3_600}
				onAction={() => undefined}
				onSaveNote={() => undefined}
				onSelect={() => undefined}
				selectedKey={undefined}
			/>,
		);

		const caption = html.indexOf("WORKTREE STATUS");
		const base = html.indexOf(">BASE<");
		const plan = html.indexOf(">PLAN<");
		expect(html).toContain('aria-label="Base repositories"');
		expect(html).toContain('data-column="base"');
		expect(html).toContain(">00<");
		expect(html).toContain('class="stage-group-count">7');
		expect(base).toBeGreaterThan(caption);
		expect(plan).toBeGreaterThan(base);
		expect(html).toContain('data-health="ok"');
		expect(html).toContain('data-health="warn"');
		expect(html).toContain('data-health="bad"');
		expect(html).toContain("CLEAN · AHEAD 1");
		expect(html).toContain("DIRTY 2 FILES · AHEAD 1");
		expect(html).toContain("DIRTY 1 FILE · BEHIND 1");
		expect(html).toContain("MISSING");
		expect(html).toContain("EXPECTED main");
		expect(html).toContain('data-action="push">PUSH');
		expect(html).toContain('data-action="pull">PULL');
		expect(html).toContain('data-action="check">CHECK');
		expect(html).toContain("Clean working tree before pulling");
		expect(html).toContain("sibling-task");
		expect(html).not.toMatch(/stage-base-row[^>]*(?:tabindex|role="button")/);
		expect(html).not.toMatch(
			/stage-base-action[^>]*(?:tabindex|role="button")/,
		);
		expect(html).not.toMatch(/<button[^>]*stage-base-action/);
		const cleanRow = html.match(
			/<div aria-label="acme clean, [^"]*"[^>]*>[\s\S]*?<\/div>/,
		)?.[0];
		expect(cleanRow).toBeDefined();
		expect(cleanRow).not.toContain("stage-base-action");
	});

	it("keeps unavailable base rows safe while retaining normal siblings and tasks", () => {
		const errorMain = buildMainViewModel({
			projects: [
				{
					name: "acme",
					root: "/tmp/acme",
					tasks: [task("visible-task", "review", 10)],
					baseRepos: [
						baseRepo({
							name: "broken",
							branch: "release",
							dirty: true,
							changedFiles: 9,
							remoteAvailable: false,
							ahead: 2,
							behind: 3,
							inspectionError: "git-read-failed",
						}),
						baseRepo({
							name: "invalid",
							inspectionError: "invalid-worktree",
						}),
						baseRepo({ name: "healthy" }),
					],
				},
			],
			errors: [],
		});
		const html = renderToStaticMarkup(
			<StageBoard
				activeCount={errorMain.activeCount}
				baseRows={errorMain.baseRows}
				groups={errorMain.stageGroups}
				idleCount={errorMain.idleCount}
				idleRows={errorMain.idleRows}
				notes={{}}
				nowSeconds={3_600}
				onAction={() => undefined}
				onSaveNote={() => undefined}
				onSelect={() => undefined}
				selectedKey={undefined}
			/>,
		);
		const brokenRow = html.match(
			/<div aria-label="[^"]*broken[^"]*"[^>]*>[\s\S]*?<\/div>/,
		)?.[0];
		const invalidRow = html.match(
			/<div aria-label="[^"]*invalid[^"]*"[^>]*>[\s\S]*?<\/div>/,
		)?.[0];

		expect(brokenRow).toBeDefined();
		expect(brokenRow).toContain("branch unavailable");
		expect(brokenRow).toContain("UNAVAILABLE");
		expect(brokenRow).toContain("Git status could not be read");
		expect(brokenRow).toContain('title="branch unavailable"');
		expect(brokenRow).toContain('data-action="check">CHECK');
		expect(brokenRow).not.toContain("CLEAN");
		expect(brokenRow).not.toContain("NO REMOTE");
		expect(brokenRow).not.toContain("EXPECTED");
		expect(brokenRow).not.toContain("AHEAD");
		expect(brokenRow).not.toContain("BEHIND");
		expect(invalidRow).toBeDefined();
		expect(invalidRow).toContain("Invalid base worktree");
		expect(html).toContain("healthy");
		expect(html).toContain("visible-task");
	});

	it("shows project prefixes only when multiple projects contribute base rows", () => {
		const single = buildMainViewModel({
			projects: [
				{
					name: "acme",
					root: "/tmp/acme",
					tasks: [],
					baseRepos: [baseRepo({ name: "backend" })],
				},
			],
			errors: [],
		});
		const multiple = buildMainViewModel({
			projects: [
				{
					name: "acme",
					root: "/tmp/acme",
					tasks: [],
					baseRepos: [baseRepo({ name: "backend" })],
				},
				{
					name: "docs",
					root: "/tmp/docs",
					tasks: [],
					baseRepos: [baseRepo({ name: "site" })],
				},
			],
			errors: [],
		});
		const renderBase = (view: ReturnType<typeof buildMainViewModel>) =>
			renderToStaticMarkup(
				<StageBoard
					activeCount={view.activeCount}
					baseRows={view.baseRows}
					groups={view.stageGroups}
					idleCount={view.idleCount}
					idleRows={view.idleRows}
					notes={{}}
					nowSeconds={3_600}
					onAction={() => undefined}
					onSaveNote={() => undefined}
					onSelect={() => undefined}
					selectedKey={undefined}
				/>,
			);

		expect(renderBase(single)).not.toContain("stage-base-project");
		expect(renderBase(multiple)).toContain(
			'<span class="stage-base-project">acme/</span>backend',
		);
		expect(renderBase(multiple)).toContain(
			'<span class="stage-base-project">docs/</span>site',
		);
	});

	it("uses current item, summary, and distinct plan title in precedence order", () => {
		expect(
			currentWorkText({
				...currentWorkTask,
				plans: [
					{
						...currentWorkPlan,
						currentItem: "Current checklist item",
					},
				],
			}),
		).toBe("Current checklist item");
		expect(currentWorkText(currentWorkTask)).toBe("Brief summary");
		expect(
			currentWorkText({
				...currentWorkTask,
				plans: [{ ...currentWorkPlan, summary: "" }],
			}),
		).toBe("Implementation plan");
		expect(
			currentWorkText({
				...currentWorkTask,
				plans: [
					{
						...currentWorkPlan,
						title: currentWorkTask.name,
						summary: "",
					},
				],
			}),
		).toBe("");
	});

	it("renders one vertical lifecycle-grouped worktree surface", () => {
		const html = renderBoard();
		const plan = html.indexOf(">PLAN<");
		const execution = html.indexOf(">EXECUTION<");
		const review = html.indexOf(">REVIEW<");
		const idle = html.indexOf(">IDLE<");

		expect(html).toContain('aria-label="Worktree status"');
		expect(html).toContain("WORKTREE STATUS");
		expect(html).toContain(">01<");
		expect(plan).toBeGreaterThan(0);
		expect(execution).toBeGreaterThan(plan);
		expect(review).toBeGreaterThan(execution);
		expect(idle).toBeGreaterThan(review);
		expect(html.indexOf("blocked-task")).toBeLessThan(
			html.indexOf("execution-task"),
		);
		expect(html).toContain('data-column="idle"');
		expect(html).toContain(">–<");
		expect(html).toContain("clean-done");
		expect(html).toContain("docs @ feat/update-ui-0824");
		expect(html).toContain('aria-label="open clean-done in terminal"');
		expect(html).not.toContain("IDLE 1 · inactive");
		expect(html).not.toContain("ALL REPOSITORIES");
	});

	it("renders every stage header when only one stage has tasks", () => {
		const planOnly = buildMainViewModel({
			projects: [
				{
					name: "acme",
					root: "/tmp/acme",
					tasks: [task("planning-task", "planning", 10, [cleanRepo])],
					baseRepos: [],
				},
			],
			errors: [],
		});
		const html = renderToStaticMarkup(
			<StageBoard
				activeCount={planOnly.activeCount}
				baseRows={planOnly.baseRows}
				groups={planOnly.stageGroups}
				idleCount={planOnly.idleCount}
				idleRows={planOnly.idleRows}
				notes={{}}
				nowSeconds={3_600}
				onAction={() => undefined}
				onSaveNote={() => undefined}
				onSelect={() => undefined}
				selectedKey={undefined}
			/>,
		);

		expect(html.match(/class="stage-group-head"/g)).toHaveLength(3);
		expect(html).toContain('data-column="plan"');
		expect(html).toContain('data-column="execution"');
		expect(html).toContain('data-column="review"');
		expect(html).not.toContain('data-column="idle"');
		expect(html.match(/class="stage-group-count">0/g)).toHaveLength(2);
	});

	it("shows current work, full repo facts, actions, and persistent notes", () => {
		const html = renderBoard();

		expect(html).toContain("execution-task current work");
		expect(html).toContain("DIRTY 7 FILES · AHEAD 2");
		expect(html).not.toMatch(/>last commit: /);
		expect(html).toContain('data-icon="commit"');
		expect(html).toContain(
			'title="last commit: implement companion activity feed"',
		);
		expect(html).toContain("implement companion activity feed · 1m");
		expect(html).toContain("rebase 전에 충돌 확인");
		expect(html).toContain(
			'aria-label="edit note for workbranch feat/update-ui-0824"',
		);
		expect(html).toContain('aria-label="open review-task in IDE"');
		expect(html).toContain('data-action-icon="ide"');
		expect(html).toContain('title="IDE / Editor"');
		expect(html).toContain('data-action-icon="terminal"');
		expect(html).toContain('data-action-icon="finder"');
		expect(html).not.toContain(">IDE</button>");
		expect(html).not.toContain(">Terminal</button>");
		expect(html).not.toContain(">Finder</button>");
		expect(html).toContain("NO REPOSITORIES");
	});

	it("selects a task in place and opens IDE only for repo-bearing tasks", () => {
		const row = main.matrixRows.find(
			(candidate) => candidate.task.name === "execution-task",
		);
		if (row === undefined) throw new Error("execution fixture missing");
		const selected: string[] = [];
		const opened: string[] = [];
		const element = StageTaskBlock({
			notes,
			nowSeconds: 3_600,
			onAction: (root, selectedTask, kind) => {
				if (kind === "ide") opened.push(`${root}:${selectedTask.name}`);
			},
			onSaveNote: () => undefined,
			onSelect: () => selected.push(row.key),
			row,
			selected: false,
		});
		const select = collectButtonProps(element).find((button) =>
			button["aria-label"]?.includes("execution-task, EXECUTION"),
		);

		select?.onClick?.({ detail: 1 });
		select?.onClick?.({ detail: 3 });
		select?.onDoubleClick?.();
		select?.onKeyDown?.({
			key: "Enter",
			metaKey: true,
			ctrlKey: false,
			preventDefault: () => undefined,
		});

		expect(selected).toEqual([row.key]);
		expect(opened).toEqual([
			"/tmp/acme:execution-task",
			"/tmp/acme:execution-task",
		]);
	});

	it("removes the legacy matrix slider CSS contract", () => {
		const css = readFileSync("src/styles/stage-board.css", "utf8");

		expect(css).not.toContain("--stage-grid");
		expect(css).not.toContain(".stage-node");
		expect(css).not.toContain(".stage-cell");
		expect(css).toMatch(
			/\.stage-group-head\[data-column="plan"\][\s\S]*var\(--plan\)/,
		);
	});

	it("preserves the blocked rail when a blocked task is selected", () => {
		const css = readFileSync("src/styles/stage-board.css", "utf8");

		expect(css).toMatch(
			/\.stage-task-block\[data-blocked="true"\]\s*\{[^}]*box-shadow:\s*inset 3px 0 0 var\(--blocked\)/s,
		);
		expect(css).toMatch(
			/\.stage-task-block\[data-selected="true"\]\s*\{[^}]*outline:\s*1px solid var\(--accent\)/s,
		);
		expect(css).not.toMatch(
			/\.stage-task-block\[data-selected="true"\]\s*\{[^}]*box-shadow:/s,
		);
	});
});
