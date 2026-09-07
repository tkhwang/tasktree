export type WorkbranchChecklistItem = {
	readonly text: string;
	readonly checked: boolean;
	readonly depth: number;
};

export type WorkbranchPlan = {
	readonly title: string;
	readonly index: number;
	readonly status: string;
	readonly progressDone: number;
	readonly progressTotal: number;
	readonly currentItem: string;
	readonly summary?: string;
	readonly items: readonly WorkbranchChecklistItem[];
};

export type WorkbranchRepo = {
	readonly name: string;
	readonly branch: string;
	readonly dirty: boolean;
	readonly ahead?: number;
	readonly behind?: number;
	readonly changedFiles?: number;
	readonly lastCommitSubject?: string;
	readonly lastCommitAt?: number;
};

export type WorkbranchTask = {
	readonly name: string;
	readonly path: string;
	readonly memoTitle: string;
	readonly planTitle: string;
	readonly status: string;
	readonly progressDone: number;
	readonly progressTotal: number;
	readonly currentItem: string;
	readonly updatedAt: number;
	readonly items: readonly WorkbranchChecklistItem[];
	readonly plans: readonly WorkbranchPlan[];
	readonly notiCount: number;
	readonly repos: readonly WorkbranchRepo[];
};

export type WorkbranchBaseRepo = {
	readonly name: string;
	readonly baseBranch: string;
	readonly branch: string;
	readonly present: boolean;
	readonly dirty: boolean;
	readonly changedFiles: number;
	readonly remoteAvailable: boolean;
	readonly ahead: number;
	readonly behind: number;
	readonly inspectionError: "invalid-worktree" | "git-read-failed" | null;
};

export type WorkbranchListDocument = {
	readonly schemaVersion: 1;
	readonly project: string;
	readonly root: string;
	readonly baseRepos?: readonly WorkbranchBaseRepo[];
	readonly tasks: readonly WorkbranchTask[];
};

export type WorkbranchGlobalError = {
	readonly root: string;
	readonly message: string;
};

export type WorkbranchListGlobalDocument = {
	readonly schemaVersion: 1;
	readonly projects: readonly WorkbranchListDocument[];
	readonly errors: readonly WorkbranchGlobalError[];
};
