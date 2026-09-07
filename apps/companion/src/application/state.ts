import type {
	BaseRepo,
	GlobalState,
	MatrixColumn,
	Repo,
	Task,
} from "../domain/model";
import { MATRIX_COLUMNS, matrixPlacement, taskStatus } from "../domain/model";

export type MenuSummary = {
	readonly projectCount: number;
	readonly taskCount: number;
	readonly active: number;
	readonly blocked: number;
	readonly notifications: number;
};

export type MenuModel = {
	readonly summary: MenuSummary;
	readonly errors: GlobalState["errors"];
};

export type MainRole = "plan" | "execution" | "review" | "idle";

export type MainTaskRow = {
	readonly key: string;
	readonly project: string;
	readonly root: string;
	readonly task: Task;
	readonly repos: readonly Repo[];
	readonly role: MainRole;
	readonly blocked: boolean;
	readonly derived: boolean;
	readonly latestActivityAt: number;
};

export type MainBaseRow = {
	readonly key: string;
	readonly project: string;
	readonly root: string;
	readonly repo: BaseRepo;
	readonly showProject: boolean;
};

export type MainViewModel = {
	readonly baseRows: readonly MainBaseRow[];
	readonly matrixRows: readonly MainTaskRow[];
	readonly stageGroups: readonly MainStageGroup[];
	readonly idleRows: readonly MainTaskRow[];
	readonly activeCount: number;
	readonly idleCount: number;
};

export type MainStageGroup = {
	readonly column: MatrixColumn;
	readonly rows: readonly MainTaskRow[];
};

function latestTaskActivity(task: Task): number {
	return task.repos.reduce(
		(latest, repo) => Math.max(latest, repo.lastCommitAt),
		task.updatedAt,
	);
}

export function mainTaskKey(root: string, taskName: string): string {
	return `${root}:${taskName}`;
}

function roleForTask(task: Task): {
	readonly role: MainRole;
	readonly blocked: boolean;
	readonly derived: boolean;
} {
	const placement = matrixPlacement(task);
	if (placement === undefined) {
		return { role: "idle", blocked: false, derived: false };
	}
	return {
		role: placement.column,
		blocked: placement.blocked,
		derived: placement.derived,
	};
}

function mainPriority(role: MainRole, blocked: boolean): number {
	if (role === "review") return 0;
	if (blocked) return 1;
	if (role === "execution") return 2;
	if (role === "plan") return 3;
	return 4;
}

function orderedRepos(repos: readonly Repo[]): readonly Repo[] {
	return repos
		.map((repo, index) => ({ index, repo }))
		.sort(
			(left, right) =>
				Number(right.repo.dirty) - Number(left.repo.dirty) ||
				Number(right.repo.ahead > 0) - Number(left.repo.ahead > 0) ||
				right.repo.lastCommitAt - left.repo.lastCommitAt ||
				left.index - right.index,
		)
		.map(({ repo }) => repo);
}

export function buildMainViewModel(state: GlobalState): MainViewModel {
	const showProject = state.projects.length > 1;
	const baseRows = state.projects.flatMap((project) =>
		project.baseRepos.map(
			(repo) =>
				({
					key: `${project.root}:${repo.name}`,
					project: project.name,
					root: project.root,
					repo,
					showProject,
				}) satisfies MainBaseRow,
		),
	);
	const rows = state.projects.flatMap((project, projectIndex) =>
		project.tasks.map((task, taskIndex) => {
			const placement = roleForTask(task);
			return {
				index: taskIndex,
				projectIndex,
				row: {
					key: mainTaskKey(project.root, task.name),
					project: project.name,
					root: project.root,
					task,
					repos: orderedRepos(task.repos),
					...placement,
					latestActivityAt: latestTaskActivity(task),
				} satisfies MainTaskRow,
			};
		}),
	);
	const matrixRows = rows
		.filter(({ row }) => row.role !== "idle")
		.sort(
			(left, right) =>
				mainPriority(left.row.role, left.row.blocked) -
					mainPriority(right.row.role, right.row.blocked) ||
				right.row.latestActivityAt - left.row.latestActivityAt ||
				left.projectIndex - right.projectIndex ||
				left.index - right.index,
		)
		.map(({ row }) => row);
	const stageGroups = MATRIX_COLUMNS.map((column) => ({
		column,
		rows: matrixRows.filter((row) => row.role === column),
	}));
	const idleRows = rows
		.filter(({ row }) => row.role === "idle")
		.sort(
			(left, right) =>
				right.row.latestActivityAt - left.row.latestActivityAt ||
				left.projectIndex - right.projectIndex ||
				left.index - right.index,
		)
		.map(({ row }) => row);

	return {
		baseRows,
		matrixRows,
		stageGroups,
		idleRows,
		activeCount: matrixRows.length,
		idleCount: idleRows.length,
	};
}

export function buildMenuModel(state: GlobalState): MenuModel {
	const projects = state.projects.filter(
		(project) => project.tasks.length > 0 || project.baseRepos.length > 0,
	);
	const tasks = projects.flatMap((project) => project.tasks);
	return {
		summary: {
			projectCount: projects.length,
			taskCount: tasks.length,
			active: tasks.filter((task) => taskStatus(task) === "in-progress").length,
			blocked: tasks.filter((task) => taskStatus(task) === "blocked").length,
			notifications: tasks.reduce((count, task) => count + task.notiCount, 0),
		},
		errors: state.errors,
	};
}
