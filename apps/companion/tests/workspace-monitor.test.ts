import { describe, expect, it } from "vitest";
import type { GlobalState } from "../src/domain/model";
import { startWorkspaceMonitor } from "../src/infrastructure/workspaceMonitor";

const FIRST_STATE: GlobalState = {
	projects: [
		{ name: "workbranch", root: "/tmp/workbranch", tasks: [], baseRepos: [] },
	],
	errors: [],
};

const SECOND_STATE: GlobalState = {
	projects: [
		{
			name: "workbranch",
			root: "/tmp/workbranch",
			tasks: [
				{
					name: "feat-login",
					path: "/tmp/workbranch/feat-login",
					notiCount: 0,
					updatedAt: 20,
					repos: [],
					plans: [],
				},
			],
			baseRepos: [],
		},
	],
	errors: [],
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

function firstProject(state: GlobalState): GlobalState["projects"][number] {
	const project = state.projects.at(0);
	if (project === undefined) {
		throw new Error("test state requires one project");
	}
	return project;
}

describe("startWorkspaceMonitor", () => {
	it("refreshes again when a watched root changes", async () => {
		const rendered: GlobalState[] = [];
		const watchedRoots: string[][] = [];
		let rootChanged: ((root: string) => void) | undefined;
		const states = [FIRST_STATE, SECOND_STATE];

		const monitor = await startWorkspaceMonitor({
			refresh: () => {
				const state = states.shift();
				if (state === undefined) {
					throw new Error("unexpected refresh");
				}
				return Promise.resolve(state);
			},
			onState: (state) => {
				rendered.push(state);
			},
			onError: (error) => {
				throw error;
			},
			watchRoots: (roots) => {
				watchedRoots.push([...roots]);
				return Promise.resolve();
			},
			onRootChanged: (callback) => {
				rootChanged = callback;
				return Promise.resolve(() => {
					rootChanged = undefined;
				});
			},
		});

		rootChanged?.("/tmp/workbranch");
		await monitor.settle();
		monitor.stop();

		expect(watchedRoots).toEqual([["/tmp/workbranch"]]);
		expect(rendered).toEqual([FIRST_STATE, SECOND_STATE]);
	});

	it("coalesces root changes while refresh is in flight", async () => {
		let rootChanged: ((root: string) => void) | undefined;
		let refreshCalls = 0;
		const inFlight = deferred<GlobalState>();

		const monitor = await startWorkspaceMonitor({
			refresh: () => {
				refreshCalls += 1;
				return refreshCalls === 1
					? Promise.resolve(FIRST_STATE)
					: inFlight.promise;
			},
			onState: () => {},
			onError: (error) => {
				throw error;
			},
			watchRoots: () => Promise.resolve(),
			onRootChanged: (callback) => {
				rootChanged = callback;
				return Promise.resolve(() => {
					rootChanged = undefined;
				});
			},
		});

		rootChanged?.("/tmp/workbranch");
		rootChanged?.("/tmp/workbranch");
		rootChanged?.("/tmp/workbranch");
		await nextMicrotask();

		expect(refreshCalls).toBe(2);
		inFlight.resolve(SECOND_STATE);
		await monitor.settle();
		monitor.stop();
	});

	it("runs another trailing refresh when a root changes during the queued refresh", async () => {
		let rootChanged: ((root: string) => void) | undefined;
		let refreshCalls = 0;
		const firstManualRefresh = deferred<GlobalState>();
		const queuedRefresh = deferred<GlobalState>();

		const monitor = await startWorkspaceMonitor({
			refresh: () => {
				refreshCalls += 1;
				if (refreshCalls === 1) {
					return Promise.resolve(FIRST_STATE);
				}
				if (refreshCalls === 2) {
					return firstManualRefresh.promise;
				}
				if (refreshCalls === 3) {
					return queuedRefresh.promise;
				}
				return Promise.resolve(SECOND_STATE);
			},
			onState: () => {},
			onError: (error) => {
				throw error;
			},
			watchRoots: () => Promise.resolve(),
			onRootChanged: (callback) => {
				rootChanged = callback;
				return Promise.resolve(() => {
					rootChanged = undefined;
				});
			},
		});

		rootChanged?.("/tmp/workbranch");
		await nextMicrotask();
		expect(refreshCalls).toBe(2);
		rootChanged?.("/tmp/workbranch");

		firstManualRefresh.resolve(SECOND_STATE);
		await nextMicrotask();
		await nextMicrotask();
		await nextMicrotask();
		await nextMicrotask();
		expect(refreshCalls).toBe(3);

		rootChanged?.("/tmp/workbranch");
		await nextMicrotask();
		await nextMicrotask();
		expect(refreshCalls).toBe(3);

		queuedRefresh.resolve(SECOND_STATE);
		await monitor.settle();
		expect(refreshCalls).toBe(4);
		monitor.stop();
	});

	it("ignores late root change callbacks after stop", async () => {
		let rootChanged: ((root: string) => void) | undefined;
		let refreshCalls = 0;

		const monitor = await startWorkspaceMonitor({
			refresh: () => {
				refreshCalls += 1;
				return Promise.resolve(FIRST_STATE);
			},
			onState: () => {},
			onError: (error) => {
				throw error;
			},
			watchRoots: () => Promise.resolve(),
			onRootChanged: (callback) => {
				rootChanged = callback;
				return Promise.resolve(() => {});
			},
		});

		expect(refreshCalls).toBe(1);
		monitor.stop();
		rootChanged?.("/tmp/workbranch");
		await monitor.settle();

		expect(refreshCalls).toBe(1);
	});

	it("starts heartbeat refreshes and clears the heartbeat on stop", async () => {
		let heartbeatCallback: (() => void) | undefined;
		let clearedHandle = 0;
		let refreshCalls = 0;
		const monitor = await startWorkspaceMonitor({
			refresh: () => {
				refreshCalls += 1;
				return Promise.resolve(FIRST_STATE);
			},
			onState: () => {},
			onError: (error) => {
				throw error;
			},
			watchRoots: () => Promise.resolve(),
			onRootChanged: () => Promise.resolve(() => {}),
			heartbeatMs: 300_000,
			setTimer: (callback, milliseconds) => {
				expect(milliseconds).toBe(300_000);
				heartbeatCallback = callback;
				return 7;
			},
			clearTimer: (handle) => {
				clearedHandle = handle;
			},
		});

		expect(refreshCalls).toBe(1);
		heartbeatCallback?.();
		await monitor.settle();
		expect(refreshCalls).toBe(2);

		monitor.stop();
		expect(clearedHandle).toBe(7);
	});

	it("refreshes and merges only the changed root", async () => {
		const betaProject = {
			name: "beta",
			root: "/tmp/beta",
			tasks: [],
			baseRepos: [],
		};
		const initial: GlobalState = {
			projects: [firstProject(FIRST_STATE), betaProject],
			errors: [],
		};
		const updatedAlpha = {
			name: "workbranch",
			root: "/tmp/workbranch",
			tasks: firstProject(SECOND_STATE).tasks,
			baseRepos: [],
		};
		const rendered: GlobalState[] = [];
		const rootCalls: string[] = [];
		let rootChanged: ((root: string) => void) | undefined;

		const monitor = await startWorkspaceMonitor({
			refresh: () => Promise.resolve(initial),
			refreshRoot: (root) => {
				rootCalls.push(root);
				return Promise.resolve(updatedAlpha);
			},
			onState: (state) => rendered.push(state),
			onError: (error) => {
				throw error;
			},
			watchRoots: () => Promise.resolve(),
			onRootChanged: (callback) => {
				rootChanged = callback;
				return Promise.resolve(() => undefined);
			},
		});

		rootChanged?.("/tmp/workbranch");
		await monitor.settle();
		monitor.stop();

		expect(rootCalls).toEqual(["/tmp/workbranch"]);
		expect(rendered.at(-1)?.projects[0]).toBe(updatedAlpha);
		expect(rendered.at(-1)?.projects[1]).toBe(betaProject);
	});

	it("coalesces roots independently and keeps heartbeat as a full refresh", async () => {
		const rootCalls: string[] = [];
		let fullCalls = 0;
		let heartbeatCallback: (() => void) | undefined;
		let rootChanged: ((root: string) => void) | undefined;
		const monitor = await startWorkspaceMonitor({
			refresh: () => {
				fullCalls += 1;
				return Promise.resolve(FIRST_STATE);
			},
			refreshRoot: (root) => {
				rootCalls.push(root);
				return Promise.resolve({ name: root, root, tasks: [], baseRepos: [] });
			},
			onState: () => undefined,
			onError: (error) => {
				throw error;
			},
			watchRoots: () => Promise.resolve(),
			onRootChanged: (callback) => {
				rootChanged = callback;
				return Promise.resolve(() => undefined);
			},
			heartbeatMs: 300_000,
			setTimer: (callback) => {
				heartbeatCallback = callback;
				return 1;
			},
			clearTimer: () => undefined,
		});

		rootChanged?.("/tmp/a");
		rootChanged?.("/tmp/a");
		rootChanged?.("/tmp/b");
		await monitor.settle();
		heartbeatCallback?.();
		await monitor.settle();
		monitor.stop();

		expect(rootCalls).toEqual(["/tmp/a", "/tmp/b"]);
		expect(fullCalls).toBe(2);
	});

	it("preserves stale project data while upserting and clearing root errors", async () => {
		const failures = [new Error("root failed"), undefined];
		let rootChanged: ((root: string) => void) | undefined;
		const rendered: GlobalState[] = [];
		const monitor = await startWorkspaceMonitor({
			refresh: () => Promise.resolve(FIRST_STATE),
			refreshRoot: () => {
				const failure = failures.shift();
				return failure === undefined
					? Promise.resolve(firstProject(SECOND_STATE))
					: Promise.reject(failure);
			},
			onState: (state) => rendered.push(state),
			onError: () => undefined,
			watchRoots: () => Promise.resolve(),
			onRootChanged: (callback) => {
				rootChanged = callback;
				return Promise.resolve(() => undefined);
			},
		});

		rootChanged?.("/tmp/workbranch");
		await monitor.settle();
		expect(rendered.at(-1)?.projects[0]).toBe(FIRST_STATE.projects[0]);
		expect(rendered.at(-1)?.errors).toEqual([
			{ root: "/tmp/workbranch", message: "root failed" },
		]);

		rootChanged?.("/tmp/workbranch");
		await monitor.settle();
		monitor.stop();

		expect(rendered.at(-1)?.projects[0]).toBe(SECOND_STATE.projects[0]);
		expect(rendered.at(-1)?.errors).toEqual([]);
	});

	it("merges a root refresh into the latest externally applied state", async () => {
		const betaBefore = {
			name: "beta",
			root: "/tmp/beta",
			tasks: [],
			baseRepos: [],
		};
		const betaAfter = {
			name: "beta",
			root: "/tmp/beta",
			tasks: firstProject(SECOND_STATE).tasks,
			baseRepos: [],
		};
		const initial: GlobalState = {
			projects: [firstProject(FIRST_STATE), betaBefore],
			errors: [],
		};
		let latestState = initial;
		let rootChanged: ((root: string) => void) | undefined;
		const rendered: GlobalState[] = [];
		const monitor = await startWorkspaceMonitor({
			refresh: () => Promise.resolve(initial),
			refreshRoot: () => Promise.resolve(firstProject(SECOND_STATE)),
			getState: () => latestState,
			onState: (state) => {
				latestState = state;
				rendered.push(state);
			},
			onError: (error) => {
				throw error;
			},
			watchRoots: () => Promise.resolve(),
			onRootChanged: (callback) => {
				rootChanged = callback;
				return Promise.resolve(() => undefined);
			},
		});

		latestState = {
			projects: [firstProject(FIRST_STATE), betaAfter],
			errors: [],
		};
		rootChanged?.("/tmp/workbranch");
		await monitor.settle();
		monitor.stop();

		expect(rendered.at(-1)?.projects[1]).toBe(betaAfter);
	});
});
