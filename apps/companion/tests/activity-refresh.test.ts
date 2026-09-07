import { describe, expect, it } from "vitest";
import type { ActivityEvent } from "../src/application/activity";
import { createActivityRefresh } from "../src/application/activity";
import type {
	BaseRepo,
	GlobalState,
	Plan,
	Project,
	Task,
} from "../src/domain/model";

const BASELINE_PLAN: Plan = {
	title: "Backend",
	index: 0,
	status: "in-progress",
	progressDone: 0,
	progressTotal: 2,
	currentItem: "Implement API",
	summary: "",
	steps: [
		{
			text: "Backend",
			checked: false,
			depth: 0,
			children: [],
		},
	],
};

const UPDATED_PLAN: Plan = {
	...BASELINE_PLAN,
	progressDone: 1,
	currentItem: "Run verification",
	steps: [
		{
			text: "Backend",
			checked: true,
			depth: 0,
			children: [
				{
					text: "Run verification",
					checked: false,
					depth: 1,
					children: [],
				},
			],
		},
	],
};

const BASELINE_TASK: Task = {
	name: "feat-login",
	path: "/tmp/workbranch/feat-login",
	notiCount: 0,
	updatedAt: 10,
	repos: [],
	plans: [BASELINE_PLAN],
};

const UPDATED_TASK: Task = {
	...BASELINE_TASK,
	updatedAt: 20,
	plans: [UPDATED_PLAN],
};

const BASELINE_PROJECT: Project = {
	name: "workbranch",
	root: "/tmp/workbranch",
	tasks: [BASELINE_TASK],
	baseRepos: [],
};

const UPDATED_PROJECT: Project = {
	...BASELINE_PROJECT,
	tasks: [UPDATED_TASK],
};

const BASELINE_STATE: GlobalState = {
	projects: [BASELINE_PROJECT],
	errors: [],
};

const UPDATED_STATE: GlobalState = {
	projects: [UPDATED_PROJECT],
	errors: [],
};

const CLEAN_BASE_REPO: BaseRepo = {
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
};

type Deferred<T> = {
	readonly promise: Promise<T>;
	readonly resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
	let resolveValue: ((value: T) => void) | undefined;
	const promise = new Promise<T>((resolve) => {
		resolveValue = resolve;
	});
	if (resolveValue === undefined) {
		throw new Error("deferred resolver was not initialized");
	}
	return { promise, resolve: resolveValue };
}

function nextMicrotask(): Promise<void> {
	return Promise.resolve();
}

describe("createActivityRefresh", () => {
	it("does not append activity for base repo changes, errors, or recovery", async () => {
		const states: GlobalState[] = [
			{
				projects: [{ ...BASELINE_PROJECT, baseRepos: [CLEAN_BASE_REPO] }],
				errors: [],
			},
			{
				projects: [
					{
						...BASELINE_PROJECT,
						baseRepos: [
							{
								...CLEAN_BASE_REPO,
								dirty: true,
								changedFiles: 1,
							},
						],
					},
				],
				errors: [],
			},
			{
				projects: [
					{
						...BASELINE_PROJECT,
						baseRepos: [
							{
								...CLEAN_BASE_REPO,
								branch: "",
								present: false,
								remoteAvailable: false,
								inspectionError: "git-read-failed",
							},
						],
					},
				],
				errors: [],
			},
			{
				projects: [{ ...BASELINE_PROJECT, baseRepos: [CLEAN_BASE_REPO] }],
				errors: [],
			},
		];
		const appended: ActivityEvent[][] = [];
		const refresh = createActivityRefresh({
			refresh: () => {
				const state = states.shift();
				if (state === undefined) {
					throw new Error("unexpected refresh");
				}
				return Promise.resolve(state);
			},
			refreshRoot: () => Promise.resolve(BASELINE_PROJECT),
			append: (events) => {
				appended.push([...events]);
				return Promise.resolve();
			},
			now: () => 100,
		});

		await refresh.all();
		await refresh.all();
		await refresh.all();
		await refresh.all();

		expect(appended).toEqual([]);
	});

	it("serializes overlapping refresh callers", async () => {
		const firstRefresh = deferred<GlobalState>();
		const appended: ActivityEvent[][] = [];
		let refreshCalls = 0;
		const refresh = createActivityRefresh({
			refresh: () => {
				refreshCalls += 1;
				return refreshCalls === 1
					? firstRefresh.promise
					: Promise.resolve(UPDATED_STATE);
			},
			refreshRoot: () => Promise.resolve(UPDATED_PROJECT),
			append: (events) => {
				appended.push([...events]);
				return Promise.resolve();
			},
			now: () => 100,
		});

		const firstResult = refresh.all();
		const secondResult = refresh.all();
		await nextMicrotask();

		expect(refreshCalls).toBe(1);
		firstRefresh.resolve(BASELINE_STATE);
		await expect(firstResult).resolves.toBe(BASELINE_STATE);
		await expect(secondResult).resolves.toBe(UPDATED_STATE);

		expect(refreshCalls).toBe(2);
		expect(appended).toHaveLength(1);
	});

	it("appends plan activity after the per-root baseline refresh", async () => {
		const states = [BASELINE_STATE, UPDATED_STATE];
		const appended: ActivityEvent[][] = [];
		const refresh = createActivityRefresh({
			refresh: () => {
				const state = states.shift();
				if (state === undefined) {
					throw new Error("unexpected refresh");
				}
				return Promise.resolve(state);
			},
			refreshRoot: () => Promise.resolve(UPDATED_PROJECT),
			append: (events) => {
				appended.push([...events]);
				return Promise.resolve();
			},
			now: () => 100,
		});

		await refresh.all();
		await refresh.all();

		expect(appended).toEqual([
			[
				{
					v: 1,
					editedAt: 20,
					observedAt: 100,
					root: "/tmp/workbranch",
					project: "workbranch",
					task: "feat-login",
					plan: "Backend",
					planIndex: 0,
					planTitle: "Backend",
					planStatus: "in-progress",
					status: "in-progress",
					taskProgressDone: 1,
					taskProgressTotal: 2,
					progressDone: 1,
					progressTotal: 2,
					items: [
						{ text: "Backend", checked: true, depth: 0 },
						{ text: "Run verification", checked: false, depth: 1 },
					],
				},
			],
		]);
	});

	it("appends activity for a root refresh against the shared baseline", async () => {
		const appended: ActivityEvent[][] = [];
		const refresh = createActivityRefresh({
			refresh: () => Promise.resolve(BASELINE_STATE),
			refreshRoot: () => Promise.resolve(UPDATED_PROJECT),
			append: (events) => {
				appended.push([...events]);
				return Promise.resolve();
			},
			now: () => 100,
		});

		await refresh.all();
		await expect(refresh.root("/tmp/workbranch")).resolves.toBe(
			UPDATED_PROJECT,
		);

		expect(appended).toHaveLength(1);
		expect(appended[0]?.[0]).toMatchObject({
			root: "/tmp/workbranch",
			task: "feat-login",
			progressDone: 1,
		});
	});

	it("retains an errored root baseline until the project recovers", async () => {
		const partialFailure: GlobalState = {
			projects: [],
			errors: [{ root: "/tmp/workbranch", message: "refresh failed" }],
		};
		const states = [BASELINE_STATE, partialFailure, UPDATED_STATE];
		const appended: ActivityEvent[][] = [];
		const refresh = createActivityRefresh({
			refresh: () => {
				const state = states.shift();
				if (state === undefined) {
					throw new Error("unexpected refresh");
				}
				return Promise.resolve(state);
			},
			refreshRoot: () => Promise.resolve(UPDATED_PROJECT),
			append: (events) => {
				appended.push([...events]);
				return Promise.resolve();
			},
			now: () => 100,
		});

		await refresh.all();
		await refresh.all();
		await refresh.all();

		expect(appended).toHaveLength(1);
		expect(appended[0]?.[0]).toMatchObject({
			root: "/tmp/workbranch",
			task: "feat-login",
			progressDone: 1,
		});
	});
});
