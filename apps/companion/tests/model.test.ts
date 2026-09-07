import { describe, expect, it } from "vitest";
import { buildMainViewModel } from "../src/application/state";
import type {
	BaseRepo,
	GlobalState,
	PlanStatus,
	Task,
} from "../src/domain/model";
import {
	activePlan,
	baseRepoAction,
	baseRepoHealth,
	matrixPlacement,
	taskProgress,
	taskStatus,
} from "../src/domain/model";

const completedMultiPlanTask: Task = {
	name: "completed-task",
	path: "/tmp/workbranch/completed-task",
	notiCount: 0,
	updatedAt: 10,
	repos: [],
	plans: [
		{
			title: "Old completed plan",
			index: 0,
			status: "done",
			steps: [],
			progressDone: 1,
			progressTotal: 1,
			currentItem: "",
			summary: "",
		},
		{
			title: "Latest completed plan",
			index: 1,
			status: "done",
			steps: [],
			progressDone: 3,
			progressTotal: 3,
			currentItem: "",
			summary: "",
		},
	],
};

function taskWithStatus(
	name: string,
	status: PlanStatus,
	updatedAt: number,
	notiCount = 0,
	repos: Task["repos"] = [],
): Task {
	return {
		name,
		path: `/tmp/workbranch/${name}`,
		notiCount,
		updatedAt,
		repos,
		plans: [
			{
				title: name,
				index: 0,
				status,
				steps: [],
				progressDone: status === "done" ? 1 : 0,
				progressTotal: 1,
				currentItem: "",
				summary: "",
			},
		],
	};
}

const DIRTY_REPO: Task["repos"][number] = {
	name: "backend",
	branch: "feature/task",
	dirty: true,
	activityAvailable: true,
	ahead: 0,
	behind: 0,
	changedFiles: 2,
	lastCommitSubject: "implement task",
	lastCommitAt: 20,
};

const AHEAD_REPO: Task["repos"][number] = {
	...DIRTY_REPO,
	dirty: false,
	ahead: 1,
	changedFiles: 0,
};

const CLEAN_BASE_REPO: BaseRepo = {
	name: "backend",
	baseBranch: "main",
	branch: "main",
	present: true,
	dirty: false,
	changedFiles: 0,
	remoteAvailable: true,
	ahead: 0,
	behind: 0,
	inspectionError: null,
};

describe("base repo status", () => {
	it.each([
		["ok", CLEAN_BASE_REPO, "ok", undefined],
		["dirty only", { ...CLEAN_BASE_REPO, dirty: true }, "warn", undefined],
		["clean ahead", { ...CLEAN_BASE_REPO, ahead: 1 }, "warn", "push"],
		[
			"dirty ahead",
			{ ...CLEAN_BASE_REPO, dirty: true, ahead: 1 },
			"warn",
			"push",
		],
		["clean behind", { ...CLEAN_BASE_REPO, behind: 1 }, "warn", "pull"],
		[
			"dirty behind",
			{ ...CLEAN_BASE_REPO, dirty: true, behind: 1 },
			"warn",
			"check",
		],
		["diverged", { ...CLEAN_BASE_REPO, ahead: 1, behind: 1 }, "bad", "check"],
		[
			"branch mismatch",
			{ ...CLEAN_BASE_REPO, branch: "release" },
			"bad",
			"check",
		],
		[
			"no remote",
			{ ...CLEAN_BASE_REPO, remoteAvailable: false },
			"bad",
			"check",
		],
		["missing", { ...CLEAN_BASE_REPO, present: false }, "bad", "check"],
		[
			"invalid worktree",
			{
				...CLEAN_BASE_REPO,
				present: false,
				inspectionError: "invalid-worktree",
			},
			"bad",
			"check",
		],
		[
			"git read failure",
			{
				...CLEAN_BASE_REPO,
				present: false,
				inspectionError: "git-read-failed",
			},
			"bad",
			"check",
		],
	] as const)("derives %s health and action", (_label, repo, expectedHealth, expectedAction) => {
		expect(baseRepoHealth(repo)).toBe(expectedHealth);
		expect(baseRepoAction(repo)).toBe(expectedAction);
	});

	it("changes CHECK to PULL and then no action as a dirty behind repo recovers", () => {
		const dirtyBehind = { ...CLEAN_BASE_REPO, dirty: true, behind: 1 };
		const cleanBehind = { ...dirtyBehind, dirty: false };
		const synchronized = { ...cleanBehind, behind: 0 };

		expect([
			[baseRepoHealth(dirtyBehind), baseRepoAction(dirtyBehind)],
			[baseRepoHealth(cleanBehind), baseRepoAction(cleanBehind)],
			[baseRepoHealth(synchronized), baseRepoAction(synchronized)],
		]).toEqual([
			["warn", "check"],
			["warn", "pull"],
			["ok", undefined],
		]);
	});
});

describe("activePlan", () => {
	it("falls back to the last plan when every plan is done", () => {
		expect(activePlan(completedMultiPlanTask)?.title).toBe(
			"Latest completed plan",
		);
		expect(taskStatus(completedMultiPlanTask)).toBe("done");
		expect(taskProgress(completedMultiPlanTask)).toEqual({ done: 3, total: 3 });
	});
});

describe("matrixPlacement", () => {
	it.each([
		["planning", "plan"],
		["in-progress", "execution"],
		["review", "review"],
	] as const)("places %s in the %s column", (status, column) => {
		expect(matrixPlacement(taskWithStatus(status, status, 1))).toEqual({
			column,
			blocked: false,
			derived: false,
		});
	});

	it("returns no placement for clean todo and done tasks", () => {
		expect(matrixPlacement(taskWithStatus("todo", "todo", 1))).toBeUndefined();
		expect(matrixPlacement(taskWithStatus("done", "done", 1))).toBeUndefined();
		expect(
			matrixPlacement(
				taskWithStatus("todo", "todo", 1, 0, [
					{ ...DIRTY_REPO, dirty: false, changedFiles: 0 },
				]),
			),
		).toBeUndefined();
		expect(
			matrixPlacement(
				taskWithStatus("done", "done", 1, 0, [{ ...AHEAD_REPO, ahead: 0 }]),
			),
		).toBeUndefined();
	});

	it("keeps declared review in place despite repository activity", () => {
		expect(
			matrixPlacement(taskWithStatus("review", "review", 1, 0, [DIRTY_REPO])),
		).toEqual({ column: "review", blocked: false, derived: false });
	});

	it("places blocked in execution with the blocked flag", () => {
		expect(matrixPlacement(taskWithStatus("blocked", "blocked", 1))).toEqual({
			column: "execution",
			blocked: true,
			derived: false,
		});
	});

	it("derives execution placement from repository evidence", () => {
		expect(
			matrixPlacement(taskWithStatus("todo", "todo", 1, 0, [DIRTY_REPO])),
		).toEqual({ column: "execution", blocked: false, derived: true });
		expect(
			matrixPlacement(taskWithStatus("done", "done", 1, 0, [AHEAD_REPO])),
		).toEqual({ column: "execution", blocked: false, derived: true });
	});
});

describe("buildMainViewModel", () => {
	it("keeps base repository project and config wire order", () => {
		const state: GlobalState = {
			projects: [
				{
					name: "alpha",
					root: "/tmp/alpha",
					tasks: [],
					baseRepos: [
						{ ...CLEAN_BASE_REPO, name: "frontend" },
						{ ...CLEAN_BASE_REPO, name: "backend" },
					],
				},
				{
					name: "beta",
					root: "/tmp/beta",
					tasks: [],
					baseRepos: [{ ...CLEAN_BASE_REPO, name: "web" }],
				},
			],
			errors: [{ root: "/tmp/unavailable", message: "refresh failed" }],
		};

		const main = buildMainViewModel(state);

		expect(main.baseRows.map((row) => row.key)).toEqual([
			"/tmp/alpha:frontend",
			"/tmp/alpha:backend",
			"/tmp/beta:web",
		]);
		expect(main.baseRows.map((row) => row.project)).toEqual([
			"alpha",
			"alpha",
			"beta",
		]);
		expect(main.baseRows.every((row) => row.showProject)).toBe(true);
		expect(main.baseRows.some((row) => row.root === "/tmp/unavailable")).toBe(
			false,
		);
	});

	it("hides the project prefix when only one project loaded successfully", () => {
		const main = buildMainViewModel({
			projects: [
				{
					name: "alpha",
					root: "/tmp/alpha",
					tasks: [],
					baseRepos: [CLEAN_BASE_REPO],
				},
			],
			errors: [{ root: "/tmp/unavailable", message: "refresh failed" }],
		});

		expect(main.baseRows[0]?.showProject).toBe(false);
	});

	it("does not include base repositories in active or idle task counts", () => {
		const main = buildMainViewModel({
			projects: [
				{
					name: "alpha",
					root: "/tmp/alpha",
					tasks: [
						taskWithStatus("active", "in-progress", 20),
						taskWithStatus("idle", "todo", 10),
					],
					baseRepos: [CLEAN_BASE_REPO],
				},
			],
			errors: [],
		});

		expect(main.activeCount).toBe(1);
		expect(main.idleCount).toBe(1);
	});

	it("orders active tasks by attention and excludes clean inactive tasks", () => {
		const reviewRepos: Task["repos"] = [
			{
				...DIRTY_REPO,
				name: "old-clean-repo",
				dirty: false,
				changedFiles: 0,
				lastCommitAt: 10,
			},
			{
				...DIRTY_REPO,
				name: "ahead-repo",
				dirty: false,
				ahead: 2,
				changedFiles: 0,
				lastCommitAt: 40,
			},
			{
				...DIRTY_REPO,
				name: "dirty-repo",
				lastCommitAt: 30,
			},
			{
				...DIRTY_REPO,
				name: "recent-clean-repo",
				dirty: false,
				changedFiles: 0,
				lastCommitAt: 90,
			},
		];
		const state: GlobalState = {
			projects: [
				{
					name: "alpha",
					root: "/tmp/alpha",
					tasks: [
						taskWithStatus("execution-task", "in-progress", 80, 0, [
							DIRTY_REPO,
						]),
						taskWithStatus("clean-todo", "todo", 200, 0, [
							{ ...DIRTY_REPO, dirty: false, changedFiles: 0 },
						]),
						taskWithStatus("review-task", "review", 70, 0, reviewRepos),
						taskWithStatus("planning-task", "planning", 40, 0, [
							{ ...DIRTY_REPO, dirty: false, changedFiles: 0 },
						]),
						taskWithStatus("planning-no-repo", "planning", 35),
					],
					baseRepos: [],
				},
				{
					name: "beta",
					root: "/tmp/beta",
					tasks: [
						taskWithStatus("blocked-task", "blocked", 300, 0, [DIRTY_REPO]),
						taskWithStatus("dirty-done-task", "done", 120, 0, [DIRTY_REPO]),
						taskWithStatus("clean-done", "done", 400, 0, [
							{ ...DIRTY_REPO, dirty: false, changedFiles: 0 },
						]),
					],
					baseRepos: [],
				},
			],
			errors: [],
		};

		const main = buildMainViewModel(state);

		expect(main.matrixRows.map((row) => row.task.name)).toEqual([
			"review-task",
			"blocked-task",
			"dirty-done-task",
			"execution-task",
			"planning-task",
			"planning-no-repo",
		]);
		expect(main.stageGroups.map((group) => group.column)).toEqual([
			"plan",
			"execution",
			"review",
		]);
		expect(
			main.stageGroups
				.find((group) => group.column === "execution")
				?.rows.map((row) => row.task.name),
		).toEqual(["blocked-task", "dirty-done-task", "execution-task"]);
		expect(main.matrixRows[0]?.repos.map((repo) => repo.name)).toEqual([
			"dirty-repo",
			"ahead-repo",
			"recent-clean-repo",
			"old-clean-repo",
		]);
		expect(main.activeCount).toBe(6);
		expect(main.idleCount).toBe(2);
		expect(main.idleRows.map((row) => row.task.name)).toEqual([
			"clean-done",
			"clean-todo",
		]);
		expect("repositoryRows" in main).toBe(false);
		expect("repositoryCount" in main).toBe(false);
		expect("unavailableRootCount" in main).toBe(false);
	});

	it("keeps empty stage groups in lifecycle order", () => {
		const state: GlobalState = {
			projects: [
				{
					name: "alpha",
					root: "/tmp/alpha",
					tasks: [taskWithStatus("planning-task", "planning", 10)],
					baseRepos: [],
				},
			],
			errors: [],
		};

		const groups = buildMainViewModel(state).stageGroups;

		expect(groups.map((group) => group.column)).toEqual([
			"plan",
			"execution",
			"review",
		]);
		expect(groups.map((group) => group.rows.length)).toEqual([1, 0, 0]);
	});

	it("keeps stable wire order when task and repository evidence tie", () => {
		const tiedRepos: Task["repos"] = [
			{ ...DIRTY_REPO, name: "first", lastCommitAt: 50 },
			{ ...DIRTY_REPO, name: "second", lastCommitAt: 50 },
		];
		const state: GlobalState = {
			projects: [
				{
					name: "alpha",
					root: "/tmp/alpha",
					tasks: [
						taskWithStatus("first-task", "in-progress", 50, 0, tiedRepos),
						taskWithStatus("second-task", "in-progress", 50, 0, [DIRTY_REPO]),
					],
					baseRepos: [],
				},
			],
			errors: [],
		};

		const main = buildMainViewModel(state);

		expect(main.matrixRows.map((row) => row.task.name)).toEqual([
			"first-task",
			"second-task",
		]);
		expect(main.matrixRows[0]?.repos.map((repo) => repo.name)).toEqual([
			"first",
			"second",
		]);
	});

	it("keeps stable project and task wire order when idle activity ties", () => {
		const state: GlobalState = {
			projects: [
				{
					name: "alpha",
					root: "/tmp/alpha",
					tasks: [
						taskWithStatus("alpha-first", "todo", 50),
						taskWithStatus("alpha-second", "done", 50),
					],
					baseRepos: [],
				},
				{
					name: "beta",
					root: "/tmp/beta",
					tasks: [taskWithStatus("beta-first", "todo", 50)],
					baseRepos: [],
				},
			],
			errors: [],
		};

		const main = buildMainViewModel(state);

		expect(main.idleRows.map((row) => row.task.name)).toEqual([
			"alpha-first",
			"alpha-second",
			"beta-first",
		]);
	});

	it("counts unavailable roots without dropping successful task rows", () => {
		const state: GlobalState = {
			projects: [
				{
					name: "alpha",
					root: "/tmp/alpha",
					tasks: [
						taskWithStatus("planning-task", "planning", 10, 0, [DIRTY_REPO]),
						taskWithStatus("idle-task", "todo", 20),
					],
					baseRepos: [],
				},
			],
			errors: [
				{ root: "/tmp/missing-a", message: "project unavailable" },
				{ root: "/tmp/missing-b", message: "task root unavailable" },
			],
		};

		const main = buildMainViewModel(state);

		expect(main.matrixRows.map((row) => row.task.name)).toEqual([
			"planning-task",
		]);
		expect(main.idleRows.map((row) => row.task.name)).toEqual(["idle-task"]);
		expect(main.idleCount).toBe(1);
	});
});
