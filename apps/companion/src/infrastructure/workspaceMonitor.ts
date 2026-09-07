import type { GlobalError, GlobalState, Project } from "../domain/model";

type TimerHandle = number;

export type WorkspaceMonitor = {
	readonly stop: () => void;
	readonly settle: () => Promise<void>;
};

export type WorkspaceMonitorDeps = {
	readonly refresh: () => Promise<GlobalState>;
	readonly refreshRoot?: (root: string) => Promise<Project>;
	readonly getState?: () => GlobalState;
	readonly onState: (state: GlobalState) => void;
	readonly onError: (error: unknown) => void;
	readonly watchRoots: (roots: readonly string[]) => Promise<void>;
	readonly onRootChanged: (
		callback: (root: string) => void,
	) => Promise<() => void>;
	readonly heartbeatMs?: number;
	readonly setTimer?: (
		callback: () => void,
		milliseconds: number,
	) => TimerHandle;
	readonly clearTimer?: (handle: TimerHandle) => void;
};

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function replaceRootError(
	errors: readonly GlobalError[],
	root: string,
	message: string | undefined,
): readonly GlobalError[] {
	const retained = errors.filter((error) => error.root !== root);
	return message === undefined ? retained : [...retained, { root, message }];
}

function replaceProject(
	projects: readonly Project[],
	project: Project,
): readonly Project[] {
	const index = projects.findIndex(
		(candidate) => candidate.root === project.root,
	);
	if (index < 0) return [...projects, project];
	return projects.map((candidate, candidateIndex) =>
		candidateIndex === index ? project : candidate,
	);
}

export async function startWorkspaceMonitor(
	deps: WorkspaceMonitorDeps,
): Promise<WorkspaceMonitor> {
	let stopped = false;
	let running = false;
	let scheduled = false;
	let fullQueued = false;
	let currentState: GlobalState | undefined;
	let pendingRoots = new Set<string>();
	let pending = Promise.resolve();
	let heartbeat: TimerHandle | undefined;

	const applyState = async (
		state: GlobalState,
		reconcileWatches = true,
	): Promise<void> => {
		if (stopped) return;
		currentState = state;
		deps.onState(state);
		if (reconcileWatches) {
			await deps.watchRoots(state.projects.map((project) => project.root));
		}
	};

	const refreshAll = async (): Promise<void> => {
		try {
			await applyState(await deps.refresh());
		} catch (error) {
			deps.onError(error);
		}
	};

	const refreshOne = async (root: string): Promise<void> => {
		const latestState = (): GlobalState | undefined =>
			deps.getState?.() ?? currentState;
		if (deps.refreshRoot === undefined || latestState() === undefined) {
			await refreshAll();
			return;
		}
		try {
			const project = await deps.refreshRoot(root);
			const state = latestState();
			if (state === undefined) {
				await refreshAll();
				return;
			}
			await applyState({
				projects: replaceProject(state.projects, project),
				errors: replaceRootError(state.errors, root, undefined),
			});
		} catch (error) {
			deps.onError(error);
			const state = latestState();
			if (state === undefined) return;
			await applyState(
				{
					projects: state.projects,
					errors: replaceRootError(state.errors, root, errorMessage(error)),
				},
				false,
			);
		}
	};

	const drain = async (): Promise<void> => {
		running = true;
		try {
			while (!stopped && (fullQueued || pendingRoots.size > 0)) {
				if (fullQueued) {
					fullQueued = false;
					pendingRoots.clear();
					await refreshAll();
					continue;
				}
				const roots = [...pendingRoots];
				pendingRoots = new Set<string>();
				for (const root of roots) {
					await refreshOne(root);
				}
			}
		} finally {
			running = false;
		}
	};

	const scheduleDrain = (): void => {
		if (stopped || running || scheduled) return;
		scheduled = true;
		pending = Promise.resolve().then(async () => {
			scheduled = false;
			await drain();
		});
	};

	const scheduleFullRefresh = (): void => {
		if (stopped) return;
		fullQueued = true;
		scheduleDrain();
	};

	const scheduleRootRefresh = (root: string): void => {
		if (stopped) return;
		if (deps.refreshRoot === undefined) {
			scheduleFullRefresh();
			return;
		}
		pendingRoots.add(root);
		scheduleDrain();
	};

	const unlisten = await deps.onRootChanged(scheduleRootRefresh);
	try {
		scheduleFullRefresh();
		await pending;
	} catch (error) {
		unlisten();
		throw error;
	}
	if (deps.heartbeatMs !== undefined) {
		const setTimer = deps.setTimer ?? window.setInterval;
		heartbeat = setTimer(scheduleFullRefresh, deps.heartbeatMs);
	}

	return {
		stop: () => {
			stopped = true;
			if (heartbeat !== undefined) {
				const clearTimer = deps.clearTimer ?? window.clearInterval;
				clearTimer(heartbeat);
			}
			unlisten();
		},
		settle: () => pending,
	};
}
