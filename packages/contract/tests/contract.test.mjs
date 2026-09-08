import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = resolve(packageRoot, "../..");
const workbranchBin = join(repoRoot, "apps/cli/bin/workbranch");

function readJson(relativePath) {
	return JSON.parse(readFileSync(join(packageRoot, relativePath), "utf8"));
}

function validator() {
	const ajv = new Ajv2020({ allErrors: true });
	ajv.addSchema(
		readJson("schema/workbranch-list.schema.json"),
		"workbranch-list.schema.json",
	);
	ajv.addSchema(
		readJson("schema/workbranch-list-global.schema.json"),
		"workbranch-list-global.schema.json",
	);
	return ajv;
}

function validateOrThrow(validate, value) {
	if (!validate(value)) {
		throw new Error(JSON.stringify(validate.errors, null, 2));
	}
}

function run(command, args, options = {}) {
	return execFileSync(command, args, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		...options,
	});
}

function initRemote(tmpRoot, name) {
	const remote = join(tmpRoot, "remotes", `${name}.git`);
	const work = join(tmpRoot, "seed", name);
	mkdirSync(dirname(remote), { recursive: true });
	mkdirSync(dirname(work), { recursive: true });
	run("git", ["init", "--bare", remote]);
	mkdirSync(work, { recursive: true });
	run("git", ["init"], { cwd: work });
	run("git", ["config", "user.email", "tests@example.com"], { cwd: work });
	run("git", ["config", "user.name", "Workbranch Tests"], { cwd: work });
	writeFileSync(join(work, "README.md"), `# ${name}\n`);
	run("git", ["add", "README.md"], { cwd: work });
	run("git", ["commit", "-m", "initial"], { cwd: work });
	run("git", ["branch", "-M", "master"], { cwd: work });
	run("git", ["remote", "add", "origin", remote], { cwd: work });
	run("git", ["push", "-u", "origin", "master"], { cwd: work });
	return remote;
}

function createProject() {
	const tmpRoot = mkdtempSync(join(tmpdir(), "workbranch-contract-"));
	const frontend = initRemote(tmpRoot, "frontend");
	const backend = initRemote(tmpRoot, "backend");
	const project = join(tmpRoot, "fullstack");
	mkdirSync(project, { recursive: true });
	writeFileSync(
		join(project, ".workbranch.config"),
		`PROJECT_NAME fullstack\nMAIN_WORKTREES_DIR _base\nBRANCH_PREFIX feature\nREPO frontend ${frontend} master\nREPO backend ${backend} master\n`,
	);
	run(workbranchBin, ["init", "--no-companion"], { cwd: project });
	run(workbranchBin, ["add", "feat-login"], { cwd: project });
	return { project, tmpRoot };
}

test("fixtures satisfy published list schemas", () => {
	const ajv = validator();
	const validateList = ajv.getSchema("workbranch-list.schema.json");
	const validateGlobal = ajv.getSchema("workbranch-list-global.schema.json");
	assert.ok(validateList);
	assert.ok(validateGlobal);
	validateOrThrow(validateList, readJson("fixtures/list-empty.json"));
	validateOrThrow(validateList, readJson("fixtures/list-with-plans.json"));
	validateOrThrow(
		validateGlobal,
		readJson("fixtures/list-global-with-error.json"),
	);
});

test("base repository rows reject a missing inspection error field", () => {
	const ajv = validator();
	const validateList = ajv.getSchema("workbranch-list.schema.json");
	assert.ok(validateList);
	const document = structuredClone(readJson("fixtures/list-with-plans.json"));
	delete document.baseRepos[0].inspectionError;
	assert.equal(validateList(document), false);
});

test("base repository rows reject an unknown inspection error code", () => {
	const ajv = validator();
	const validateList = ajv.getSchema("workbranch-list.schema.json");
	assert.ok(validateList);
	const document = structuredClone(readJson("fixtures/list-with-plans.json"));
	document.baseRepos[0].inspectionError = "unknown";
	assert.equal(validateList(document), false);
});

test("base repository rows accept valid inspection errors", () => {
	const ajv = validator();
	const validateList = ajv.getSchema("workbranch-list.schema.json");
	assert.ok(validateList);
	const document = structuredClone(readJson("fixtures/list-with-plans.json"));
	document.baseRepos[0] = {
		name: "backend",
		baseBranch: "master",
		branch: "",
		present: false,
		dirty: false,
		changedFiles: 0,
		remoteAvailable: false,
		ahead: 0,
		behind: 0,
		inspectionError: "git-read-failed",
	};
	document.baseRepos[1] = {
		name: "frontend",
		baseBranch: "master",
		branch: "",
		present: false,
		dirty: false,
		changedFiles: 0,
		remoteAvailable: false,
		ahead: 0,
		behind: 0,
		inspectionError: "invalid-worktree",
	};
	validateOrThrow(validateList, document);
});

test("list documents accept legacy payloads without base repositories", () => {
	const ajv = validator();
	const validateList = ajv.getSchema("workbranch-list.schema.json");
	assert.ok(validateList);
	validateOrThrow(validateList, readJson("fixtures/list-empty.json"));
});

test("live CLI list output satisfies contract schema", () => {
	const { project, tmpRoot } = createProject();
	try {
		const ajv = validator();
		const validateList = ajv.getSchema("workbranch-list.schema.json");
		assert.ok(validateList);
		const document = JSON.parse(
			run(workbranchBin, ["list", "--json"], { cwd: project }),
		);
		validateOrThrow(validateList, document);
		assert.equal(document.schemaVersion, 1);
		assert.equal(document.tasks[0].name, "feat-login");
	} finally {
		rmSync(tmpRoot, { recursive: true, force: true });
	}
});

test("live CLI global list output satisfies wrapper schema", () => {
	const { project, tmpRoot } = createProject();
	try {
		const xdg = join(tmpRoot, "xdg");
		mkdirSync(join(xdg, "workbranch-companion"), { recursive: true });
		writeFileSync(
			join(xdg, "workbranch-companion", "projects.md"),
			`# workbranch companion projects\n\n## projects\n- ${project}\n- ${join(tmpRoot, "missing")}\n`,
		);
		const ajv = validator();
		const validateGlobal = ajv.getSchema("workbranch-list-global.schema.json");
		assert.ok(validateGlobal);
		const document = JSON.parse(
			run(workbranchBin, ["list", "--global", "--json"], {
				cwd: tmpRoot,
				env: { ...process.env, XDG_CONFIG_HOME: xdg },
			}),
		);
		validateOrThrow(validateGlobal, document);
		assert.equal(document.schemaVersion, 1);
		assert.equal(document.projects.length, 1);
		assert.equal(document.errors.length, 1);
	} finally {
		rmSync(tmpRoot, { recursive: true, force: true });
	}
});
