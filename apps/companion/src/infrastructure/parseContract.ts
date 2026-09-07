import type {
	WorkbranchBaseRepo,
	WorkbranchChecklistItem,
	WorkbranchListDocument,
	WorkbranchListGlobalDocument,
	WorkbranchPlan,
	WorkbranchRepo,
	WorkbranchTask,
} from "@workbranch/contract";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
	return typeof value === "string";
}

function isNonNegativeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isOptionalNonNegativeInteger(value: unknown): boolean {
	return value === undefined || isNonNegativeInteger(value);
}

function isOptionalString(value: unknown): boolean {
	return value === undefined || isString(value);
}

function isInspectionError(
	value: unknown,
): value is WorkbranchBaseRepo["inspectionError"] {
	return (
		value === null ||
		value === "invalid-worktree" ||
		value === "git-read-failed"
	);
}

function isChecklistItem(value: unknown): value is WorkbranchChecklistItem {
	if (!isRecord(value)) {
		return false;
	}
	return (
		isString(value["text"]) &&
		typeof value["checked"] === "boolean" &&
		isNonNegativeInteger(value["depth"])
	);
}

function isRepo(value: unknown): value is WorkbranchRepo {
	if (!isRecord(value)) {
		return false;
	}
	return (
		isString(value["name"]) &&
		isString(value["branch"]) &&
		typeof value["dirty"] === "boolean" &&
		isOptionalNonNegativeInteger(value["ahead"]) &&
		isOptionalNonNegativeInteger(value["behind"]) &&
		isOptionalNonNegativeInteger(value["changedFiles"]) &&
		isOptionalString(value["lastCommitSubject"]) &&
		isOptionalNonNegativeInteger(value["lastCommitAt"])
	);
}

function isPlan(value: unknown): value is WorkbranchPlan {
	if (!isRecord(value)) {
		return false;
	}
	return (
		isString(value["title"]) &&
		isNonNegativeInteger(value["index"]) &&
		isString(value["status"]) &&
		isNonNegativeInteger(value["progressDone"]) &&
		isNonNegativeInteger(value["progressTotal"]) &&
		isString(value["currentItem"]) &&
		isOptionalString(value["summary"]) &&
		Array.isArray(value["items"]) &&
		value["items"].every(isChecklistItem)
	);
}

function isTask(value: unknown): value is WorkbranchTask {
	if (!isRecord(value)) {
		return false;
	}
	return (
		isString(value["name"]) &&
		isString(value["path"]) &&
		isString(value["memoTitle"]) &&
		isString(value["planTitle"]) &&
		isString(value["status"]) &&
		isNonNegativeInteger(value["progressDone"]) &&
		isNonNegativeInteger(value["progressTotal"]) &&
		isString(value["currentItem"]) &&
		isNonNegativeInteger(value["updatedAt"]) &&
		Array.isArray(value["items"]) &&
		value["items"].every(isChecklistItem) &&
		Array.isArray(value["plans"]) &&
		value["plans"].every(isPlan) &&
		isNonNegativeInteger(value["notiCount"]) &&
		Array.isArray(value["repos"]) &&
		value["repos"].every(isRepo)
	);
}

function isBaseRepo(value: unknown): value is WorkbranchBaseRepo {
	if (!isRecord(value)) {
		return false;
	}
	return (
		isString(value["name"]) &&
		isString(value["baseBranch"]) &&
		isString(value["branch"]) &&
		typeof value["present"] === "boolean" &&
		typeof value["dirty"] === "boolean" &&
		isNonNegativeInteger(value["changedFiles"]) &&
		typeof value["remoteAvailable"] === "boolean" &&
		isNonNegativeInteger(value["ahead"]) &&
		isNonNegativeInteger(value["behind"]) &&
		isInspectionError(value["inspectionError"])
	);
}

function isListDocument(value: unknown): value is WorkbranchListDocument {
	if (!isRecord(value)) {
		return false;
	}
	return (
		value["schemaVersion"] === 1 &&
		isString(value["project"]) &&
		isString(value["root"]) &&
		(value["baseRepos"] === undefined ||
			(Array.isArray(value["baseRepos"]) &&
				value["baseRepos"].every(isBaseRepo))) &&
		Array.isArray(value["tasks"]) &&
		value["tasks"].every(isTask)
	);
}

function isGlobalError(
	value: unknown,
): value is WorkbranchListGlobalDocument["errors"][number] {
	if (!isRecord(value)) {
		return false;
	}
	return isString(value["root"]) && isString(value["message"]);
}

function isGlobalDocument(
	value: unknown,
): value is WorkbranchListGlobalDocument {
	if (!isRecord(value)) {
		return false;
	}
	return (
		value["schemaVersion"] === 1 &&
		Array.isArray(value["projects"]) &&
		value["projects"].every(isListDocument) &&
		Array.isArray(value["errors"]) &&
		value["errors"].every(isGlobalError)
	);
}

export function parseGlobalDocument(raw: string): WorkbranchListGlobalDocument {
	const parsed: unknown = JSON.parse(raw);
	if (!isGlobalDocument(parsed)) {
		throw new Error("invalid workbranch global list document");
	}
	return parsed;
}

export function parseListDocument(raw: string): WorkbranchListDocument {
	const parsed: unknown = JSON.parse(raw);
	if (!isListDocument(parsed)) {
		throw new Error("invalid workbranch list document");
	}
	return parsed;
}
