import { describe, expect, it } from "vitest";
import { buildMainViewModel } from "../src/application/state";
import type { GlobalState, PlanStatus, Task } from "../src/domain/model";
import {
	activePlan,
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
