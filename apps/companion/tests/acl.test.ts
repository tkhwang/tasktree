import type { WorkbranchListGlobalDocument } from "@workbranch/contract";
import { describe, expect, it } from "vitest";
import {
	type ActivityEvent,
	buildPlanReport,
} from "../src/application/activity";
import { buildMenuModel } from "../src/application/state";
import { mapGlobalDocumentToState } from "../src/infrastructure/acl";
import { parseGlobalDocument } from "../src/infrastructure/parseContract";

const document: WorkbranchListGlobalDocument = {
	schemaVersion: 1,
	projects: [
		{
			schemaVersion: 1,
			project: "fullstack",
			root: "/tmp/fullstack",
			tasks: [
				{
					name: "feat-login",
					path: "/tmp/fullstack/feat-login",
					memoTitle: "Login",
					planTitle: "Backend",
					status: "in-progress",
					progressDone: 1,
					progressTotal: 2,
					currentItem: "wire API",
					updatedAt: 10,
					items: [
						{ text: "Backend", checked: true, depth: 0 },
						{ text: "wire API", checked: false, depth: 1 },
					],
					plans: [],
					notiCount: 2,
					repos: [{ name: "backend", branch: "feature/login", dirty: true }],
				},
			],
		},
	],
	errors: [{ root: "/tmp/missing", message: "missing" }],
};

describe("ACL", () => {
	it("maps global CLI DTOs into companion domain tasks", () => {
		const state = mapGlobalDocumentToState(document);
		expect(
			state.projects[0]?.tasks[0]?.plans[0]?.steps[0]?.children[0]?.text,
		).toBe("wire API");
		expect(state.projects[0]?.tasks[0]?.repos[0]?.dirty).toBe(true);
		expect(state.projects[0]?.tasks[0]?.repos[0]).toMatchObject({
			activityAvailable: false,
			ahead: 0,
			behind: 0,
			changedFiles: 0,
			lastCommitSubject: "",
			lastCommitAt: 0,
		});
		expect(state.projects[0]?.tasks[0]).not.toHaveProperty("memoTitle");
		expect(state.errors[0]?.root).toBe("/tmp/missing");
	});

	it("preserves optional repository activity facts at the parser boundary", () => {
		const project = document.projects.at(0);
		const task = project?.tasks.at(0);
		if (project === undefined || task === undefined) {
			throw new Error("test fixture requires one project task");
		}
		const activityDocument: WorkbranchListGlobalDocument = {
			...document,
			projects: [
				{
					...project,
					tasks: [
						{
							...task,
							repos: [
								{
									name: "backend",
									branch: "feature/login",
									dirty: true,
									ahead: 2,
									behind: 1,
									changedFiles: 7,
									lastCommitSubject: "wire login API",
									lastCommitAt: 20,
								},
							],
						},
					],
				},
			],
		};

		const parsed = parseGlobalDocument(JSON.stringify(activityDocument));
		const repo =
			mapGlobalDocumentToState(parsed).projects[0]?.tasks[0]?.repos[0];

		expect(repo).toMatchObject({
			activityAvailable: true,
			ahead: 2,
			behind: 1,
			changedFiles: 7,
			lastCommitSubject: "wire login API",
			lastCommitAt: 20,
		});
	});

	it("maps base repo status entries into the project domain data", () => {
		const project = document.projects.at(0);
		if (project === undefined) {
			throw new Error("test fixture requires one project");
		}
		const baseRepoDocument: WorkbranchListGlobalDocument = {
			...document,
			projects: [
				{
					...project,
					baseRepos: [
						{
							name: "backend",
							baseBranch: "main",
							branch: "feature/login",
							present: true,
							dirty: true,
							changedFiles: 3,
							remoteAvailable: true,
							ahead: 2,
							behind: 1,
							inspectionError: null,
						},
					],
				},
			],
		};

		const parsed = parseGlobalDocument(JSON.stringify(baseRepoDocument));
		const baseRepo = mapGlobalDocumentToState(parsed).projects[0]?.baseRepos[0];

		expect(baseRepo).toEqual({
			name: "backend",
			baseBranch: "main",
			branch: "feature/login",
			present: true,
			dirty: true,
			changedFiles: 3,
			remoteAvailable: true,
			ahead: 2,
			behind: 1,
			inspectionError: null,
		});
	});

	it("preserves an errored base repo with its sibling and project tasks", () => {
		const project = document.projects.at(0);
		if (project === undefined) {
			throw new Error("test fixture requires one project");
		}
		const inspectionErrorDocument: WorkbranchListGlobalDocument = {
			...document,
			projects: [
				{
					...project,
					baseRepos: [
						{
							name: "frontend",
							baseBranch: "main",
							branch: "main",
							present: true,
							dirty: false,
							changedFiles: 0,
							remoteAvailable: true,
							ahead: 0,
							behind: 0,
							inspectionError: null,
						},
						{
							name: "backend",
							baseBranch: "main",
							branch: "",
							present: false,
							dirty: false,
							changedFiles: 0,
							remoteAvailable: false,
							ahead: 0,
							behind: 0,
							inspectionError: "git-read-failed",
						},
					],
				},
			],
		};

		const parsed = parseGlobalDocument(JSON.stringify(inspectionErrorDocument));
		const mappedProject = mapGlobalDocumentToState(parsed).projects[0];

		expect(mappedProject?.baseRepos).toEqual(
			inspectionErrorDocument.projects[0]?.baseRepos,
		);
		expect(mappedProject?.tasks[0]?.name).toBe("feat-login");
	});

	it("defaults baseRepos to an empty array when the CLI omits it", () => {
		const parsed = parseGlobalDocument(JSON.stringify(document));
		expect(mapGlobalDocumentToState(parsed).projects[0]?.baseRepos).toEqual([]);
	});

	it("rejects a base repo entry that is missing a required field", () => {
		const project = document.projects.at(0);
		if (project === undefined) {
			throw new Error("test fixture requires one project");
		}
		const invalidBaseRepoDocument = {
			...document,
			projects: [
				{
					...project,
					baseRepos: [
						{
							name: "backend",
							baseBranch: "main",
							branch: "feature/login",
							present: true,
							dirty: true,
							changedFiles: 3,
							remoteAvailable: true,
							ahead: 2,
							behind: 1,
						},
					],
				},
			],
		};

		expect(() =>
			parseGlobalDocument(JSON.stringify(invalidBaseRepoDocument)),
		).toThrow("invalid workbranch global list document");
	});

	it("rejects a base repo entry with an unknown inspection error", () => {
		const project = document.projects.at(0);
		if (project === undefined) {
			throw new Error("test fixture requires one project");
		}
		const invalidBaseRepoDocument = {
			...document,
			projects: [
				{
					...project,
					baseRepos: [
						{
							name: "backend",
							baseBranch: "main",
							branch: "",
							present: false,
							dirty: false,
							changedFiles: 0,
							remoteAvailable: false,
							ahead: 0,
							behind: 0,
							inspectionError: "permission-denied",
						},
					],
				},
			],
		};

		expect(() =>
			parseGlobalDocument(JSON.stringify(invalidBaseRepoDocument)),
		).toThrow("invalid workbranch global list document");
	});

	it("carries the plan summary and defaults it to empty when the CLI omits it", () => {
		const project = document.projects.at(0);
		const task = project?.tasks.at(0);
		if (project === undefined || task === undefined) {
			throw new Error("test fixture requires one project task");
		}
		const summaryDocument: WorkbranchListGlobalDocument = {
			...document,
			projects: [
				{
					...project,
					tasks: [
						{
							...task,
							plans: [
								{
									title: "Backend",
									index: 0,
									status: "in-progress",
									progressDone: 0,
									progressTotal: 0,
									currentItem: "",
									summary: "Tighten session expiry and audit logging",
									items: [],
								},
								{
									title: "Frontend",
									index: 1,
									status: "todo",
									progressDone: 0,
									progressTotal: 0,
									currentItem: "",
									items: [],
								},
							],
						},
					],
				},
			],
		};

		const parsed = parseGlobalDocument(JSON.stringify(summaryDocument));
		const plans = mapGlobalDocumentToState(parsed).projects[0]?.tasks[0]?.plans;

		expect(plans?.[0]?.summary).toBe(
			"Tighten session expiry and audit logging",
		);
		expect(plans?.[1]?.summary).toBe("");
	});

	it("builds a compact menu rollup", () => {
		const model = buildMenuModel(mapGlobalDocumentToState(document));
		expect(model.summary.projectCount).toBe(1);
		expect(model.summary.taskCount).toBe(1);
		expect(model.summary.active).toBe(1);
		expect(model.summary.notifications).toBe(2);
	});

	it.each([
		null,
		"git-read-failed",
	] as const)("counts a taskless project with visible base rows (%s)", (inspectionError) => {
		const baseOnly = {
			name: "base-only",
			root: "/tmp/base-only",
			tasks: [],
			baseRepos: [
				{
					name: "backend",
					baseBranch: "main",
					branch: inspectionError === null ? "main" : "",
					present: true,
					dirty: false,
					changedFiles: 0,
					remoteAvailable: inspectionError === null,
					ahead: 0,
					behind: 0,
					inspectionError,
				},
			],
		};
		expect(
			buildMenuModel({ projects: [baseOnly], errors: [] }).summary,
		).toMatchObject({
			projectCount: 1,
			taskCount: 0,
			active: 0,
			notifications: 0,
		});
		const state = mapGlobalDocumentToState(document);
		const mixed = buildMenuModel({
			...state,
			projects: [
				...state.projects,
				baseOnly,
				{ name: "empty", root: "/tmp/empty", tasks: [], baseRepos: [] },
			],
		});
		expect(mixed.summary).toMatchObject({
			projectCount: 2,
			taskCount: 1,
			active: 1,
			notifications: 2,
		});
	});

	it("rolls up non-empty projects without retaining presentation groups", () => {
		const multiProjectDocument: WorkbranchListGlobalDocument = {
			schemaVersion: 1,
			projects: [
				{
					schemaVersion: 1,
					project: "alpha",
					root: "/tmp/alpha",
					tasks: [
						{
							name: "alpha-old",
							path: "/tmp/alpha/alpha-old",
							memoTitle: "",
							planTitle: "Plan",
							status: "todo",
							progressDone: 0,
							progressTotal: 1,
							currentItem: "",
							updatedAt: 10,
							items: [],
							plans: [],
							notiCount: 0,
							repos: [],
						},
						{
							name: "alpha-new",
							path: "/tmp/alpha/alpha-new",
							memoTitle: "",
							planTitle: "Plan",
							status: "blocked",
							progressDone: 0,
							progressTotal: 1,
							currentItem: "",
							updatedAt: 40,
							items: [],
							plans: [],
							notiCount: 0,
							repos: [],
						},
					],
				},
				{
					schemaVersion: 1,
					project: "empty",
					root: "/tmp/empty",
					tasks: [],
				},
				{
					schemaVersion: 1,
					project: "beta",
					root: "/tmp/beta",
					tasks: [
						{
							name: "beta-task",
							path: "/tmp/beta/beta-task",
							memoTitle: "",
							planTitle: "Plan",
							status: "in-progress",
							progressDone: 0,
							progressTotal: 1,
							currentItem: "",
							updatedAt: 80,
							items: [],
							plans: [],
							notiCount: 3,
							repos: [],
						},
					],
				},
			],
			errors: [],
		};

		const model = buildMenuModel(
			mapGlobalDocumentToState(multiProjectDocument),
		);

		expect(model.summary.projectCount).toBe(2);
		expect(model.summary.taskCount).toBe(3);
		expect(model.summary.active).toBe(1);
		expect(model.summary.blocked).toBe(1);
		expect(model.summary.notifications).toBe(3);
		expect(model).not.toHaveProperty("groups");
	});
});

describe("activity reports", () => {
	it("uses the latest empty item snapshot to clear older step rows", () => {
		const base: Omit<ActivityEvent, "observedAt" | "items"> = {
			v: 1,
			editedAt: 1,
			root: "/tmp/fullstack",
			project: "fullstack",
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
		};
		const report = buildPlanReport([
			{
				...base,
				observedAt: 10,
				items: [{ text: "wire API", checked: false, depth: 0 }],
			},
			{ ...base, observedAt: 70, items: [] },
		]);
		expect(report[0]?.seconds).toBe(60);
		expect(report[0]?.latestItems).toEqual([]);
	});
});
