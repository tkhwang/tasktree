import type {
	WorkbranchListDocument,
	WorkbranchListGlobalDocument,
} from "@workbranch/contract";
import type {
	BaseRepo,
	GlobalState,
	Plan,
	Project,
	Task,
} from "../domain/model";
import { isPlanStatus } from "../domain/model";
import { buildStepTree } from "../domain/steps";

function normalizeStatus(status: string): Plan["status"] {
	return isPlanStatus(status) ? status : "todo";
}

function mapPlan(
	dto: WorkbranchListDocument["tasks"][number]["plans"][number],
): Plan {
	return {
		title: dto.title,
		index: dto.index,
		status: normalizeStatus(dto.status),
		steps: buildStepTree(dto.items),
		progressDone: dto.progressDone,
		progressTotal: dto.progressTotal,
		currentItem: dto.currentItem,
		summary: dto.summary ?? "",
	};
}

function legacyPlan(
	task: WorkbranchListDocument["tasks"][number],
): Plan | undefined {
	if (
		task.progressTotal === 0 &&
		task.currentItem === "" &&
		task.planTitle === ""
	) {
		return undefined;
	}
	return {
		title: task.planTitle,
		index: 0,
		status: normalizeStatus(task.status),
		steps: buildStepTree(task.items),
		progressDone: task.progressDone,
		progressTotal: task.progressTotal,
		currentItem: task.currentItem,
		summary: "",
	};
}

function mapTask(dto: WorkbranchListDocument["tasks"][number]): Task {
	const fallback = legacyPlan(dto);
	const plans =
		dto.plans.length > 0 ? dto.plans.map(mapPlan) : fallback ? [fallback] : [];
	return {
		name: dto.name,
		path: dto.path,
		notiCount: dto.notiCount,
		plans,
		repos: dto.repos.map((repo) => ({
			name: repo.name,
			branch: repo.branch,
			dirty: repo.dirty,
			activityAvailable: repo.changedFiles !== undefined,
			ahead: repo.ahead ?? 0,
			behind: repo.behind ?? 0,
			changedFiles: repo.changedFiles ?? 0,
			lastCommitSubject: repo.lastCommitSubject ?? "",
			lastCommitAt: repo.lastCommitAt ?? 0,
		})),
		updatedAt: dto.updatedAt,
	};
}

function mapBaseRepo(
	dto: NonNullable<WorkbranchListDocument["baseRepos"]>[number],
): BaseRepo {
	return {
		name: dto.name,
		baseBranch: dto.baseBranch,
		branch: dto.branch,
		present: dto.present,
		dirty: dto.dirty,
		changedFiles: dto.changedFiles,
		remoteAvailable: dto.remoteAvailable,
		ahead: dto.ahead,
		behind: dto.behind,
	};
}

export function mapListDocumentToProject(dto: WorkbranchListDocument): Project {
	return {
		name: dto.project,
		root: dto.root,
		tasks: dto.tasks.map(mapTask),
		baseRepos: (dto.baseRepos ?? []).map(mapBaseRepo),
	};
}

export function mapGlobalDocumentToState(
	dto: WorkbranchListGlobalDocument,
): GlobalState {
	return {
		projects: dto.projects.map(mapListDocumentToProject),
		errors: dto.errors.map((error) => ({
			root: error.root,
			message: error.message,
		})),
	};
}
