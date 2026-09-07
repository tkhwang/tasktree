export const PLAN_STATUSES = [
	"todo",
	"planning",
	"in-progress",
	"review",
	"blocked",
	"done",
] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export type Step = {
	readonly text: string;
	readonly checked: boolean;
	readonly depth: number;
	readonly children: readonly Step[];
};

export type Plan = {
	readonly title: string;
	readonly index: number;
	readonly status: PlanStatus;
	readonly steps: readonly Step[];
	readonly progressDone: number;
	readonly progressTotal: number;
	readonly currentItem: string;
	readonly summary: string;
};

export type Repo = {
	readonly name: string;
	readonly branch: string;
	readonly dirty: boolean;
	readonly activityAvailable: boolean;
	readonly ahead: number;
	readonly behind: number;
	readonly changedFiles: number;
	readonly lastCommitSubject: string;
	readonly lastCommitAt: number;
};

export type Task = {
	readonly name: string;
	readonly path: string;
	readonly notiCount: number;
	readonly plans: readonly Plan[];
	readonly repos: readonly Repo[];
	readonly updatedAt: number;
};

export type BaseRepo = {
	readonly name: string;
	readonly baseBranch: string;
	readonly branch: string;
	readonly present: boolean;
	readonly dirty: boolean;
	readonly changedFiles: number;
	readonly remoteAvailable: boolean;
	readonly ahead: number;
	readonly behind: number;
};

export type Project = {
	readonly name: string;
	readonly root: string;
	readonly tasks: readonly Task[];
	readonly baseRepos: readonly BaseRepo[];
};

export type GlobalError = {
	readonly root: string;
	readonly message: string;
};

export type GlobalState = {
	readonly projects: readonly Project[];
	readonly errors: readonly GlobalError[];
};

export function isPlanStatus(value: string): value is PlanStatus {
	switch (value) {
		case "todo":
		case "planning":
		case "in-progress":
		case "review":
		case "blocked":
		case "done":
			return true;
		default:
			return false;
	}
}

export function activePlan(task: Task): Plan | undefined {
	const firstIncompletePlan = task.plans.find((plan) => plan.status !== "done");
	return firstIncompletePlan ?? task.plans.at(-1);
}

export function taskStatus(task: Task): PlanStatus {
	return activePlan(task)?.status ?? "todo";
}

export function taskProgress(task: Task): {
	readonly done: number;
	readonly total: number;
} {
	const plan = activePlan(task);
	return { done: plan?.progressDone ?? 0, total: plan?.progressTotal ?? 0 };
}

export const MATRIX_COLUMNS = ["plan", "execution", "review"] as const;
export type MatrixColumn = (typeof MATRIX_COLUMNS)[number];

export type MatrixPlacement = {
	readonly column: MatrixColumn;
	readonly blocked: boolean;
	readonly derived: boolean;
};

function hasRepoActivity(task: Task): boolean {
	return task.repos.some((repo) => repo.dirty || repo.ahead > 0);
}

export function matrixPlacement(task: Task): MatrixPlacement | undefined {
	switch (taskStatus(task)) {
		case "todo":
		case "done":
			return hasRepoActivity(task)
				? { column: "execution", blocked: false, derived: true }
				: undefined;
		case "planning":
			return { column: "plan", blocked: false, derived: false };
		case "in-progress":
			return { column: "execution", blocked: false, derived: false };
		case "blocked":
			return { column: "execution", blocked: true, derived: false };
		case "review":
			return { column: "review", blocked: false, derived: false };
	}
}
