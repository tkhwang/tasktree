import { useEffect, useRef, useState } from "react";
import { type RepoNotes, repoNoteKey } from "../application/notes";
import type {
	MainBaseRow,
	MainStageGroup,
	MainTaskRow,
} from "../application/state";
import type { BaseRepoAction, MatrixColumn, Repo } from "../domain/model";
import {
	baseRepoAction,
	baseRepoHealth,
	taskProgress,
	taskStatus,
} from "../domain/model";
import { StatusToken } from "./StatusToken";
import {
	baseRepoFacts,
	currentWorkText,
	formatRelativeTime,
	repoFacts,
	type TaskActionHandler,
	type TaskActionKind,
	taskActionsFor,
} from "./TaskRow";
import { useCurrentEpochSeconds } from "./useCurrentEpochSeconds";

function TaskActionIcon({ kind }: { readonly kind: TaskActionKind }) {
	const common = {
		"aria-hidden": true,
		className: "task-action-icon",
		"data-action-icon": kind,
		fill: "none",
		stroke: "currentColor",
		strokeLinecap: "round",
		strokeLinejoin: "round",
		strokeWidth: 1.6,
		viewBox: "0 0 20 20",
	} as const;
	switch (kind) {
		case "ide":
			return (
				<svg {...common}>
					<title>IDE / Editor</title>
					<rect height="15" rx="2" width="16" x="2" y="2.5" />
					<path d="M2 6h16" />
					<path d="M6.5 6v11.5" />
					<path d="M9 9h5" />
					<path d="M9 12h4" />
					<path d="M9 15h6" />
				</svg>
			);
		case "terminal":
			return (
				<svg {...common}>
					<title>Terminal</title>
					<rect height="14" rx="2" width="16" x="2" y="3" />
					<path d="m5 7 3 3-3 3" />
					<path d="M10 13h4" />
				</svg>
			);
		case "finder":
			return (
				<svg {...common}>
					<title>Finder</title>
					<path d="M2.5 6.5h5l1.6 2h8.4v7.5h-15z" />
					<path d="M2.5 6.5V5h6l1.5 1.5" />
				</svg>
			);
	}
}

const STAGE_LABELS: Record<MatrixColumn, string> = {
	plan: "PLAN",
	execution: "EXECUTION",
	review: "REVIEW",
};

const STAGE_NUMBERS: Record<MatrixColumn, string> = {
	plan: "01",
	execution: "02",
	review: "03",
};

const ACTION_LABELS = {
	pull: "PULL",
	push: "PUSH",
	check: "CHECK",
} as const satisfies Record<BaseRepoAction, string>;

function BaseRepoRow({ row }: { readonly row: MainBaseRow }) {
	const { project, repo, showProject } = row;
	const health = baseRepoHealth(repo);
	const action = baseRepoAction(repo);
	const facts = baseRepoFacts(repo);
	const branchLabel =
		repo.inspectionError !== null
			? "branch unavailable"
			: repo.branch || "no branch";
	const guidance =
		repo.inspectionError === "invalid-worktree"
			? "Invalid base worktree"
			: repo.inspectionError === "git-read-failed"
				? "Git status could not be read"
				: repo.dirty && repo.behind > 0
					? "Clean working tree before pulling"
					: "";
	const description = `${project} ${repo.name}, ${branchLabel}, ${facts}${action === undefined ? "" : `, next ${ACTION_LABELS[action]}`}${guidance === "" ? "" : `, ${guidance}`}`;
	const factsTitle = facts + (guidance === "" ? "" : ` · ${guidance}`);

	return (
		/* biome-ignore lint/a11y/useSemanticElements: The approved contract requires a non-focusable div listitem. */
		<div
			aria-label={description}
			className="stage-base-row"
			data-health={health}
			role="listitem"
			title={description}
		>
			<span aria-hidden="true" className="stage-base-dot" />
			<span className="stage-base-name" title={`${project}/${repo.name}`}>
				{showProject ? (
					<span className="stage-base-project">{project}/</span>
				) : null}
				{repo.name}
			</span>
			<span className="stage-base-branch" title={branchLabel}>
				{repo.inspectionError !== null || repo.branch === ""
					? "—"
					: repo.branch}
			</span>
			<span className="stage-base-facts" title={factsTitle}>
				{facts}
			</span>
			{action === undefined ? null : (
				<span className="stage-base-action" data-action={action}>
					{ACTION_LABELS[action]}
				</span>
			)}
		</div>
	);
}

function StageGroupHead({
	column,
	count,
}: {
	readonly column: MatrixColumn;
	readonly count: number;
}) {
	return (
		<header className="stage-group-head" data-column={column}>
			<span className="stage-group-num">{STAGE_NUMBERS[column]}</span>
			<span className="stage-group-label">{STAGE_LABELS[column]}</span>
			<span aria-hidden="true" className="stage-group-rule" />
			<span className="stage-group-count">{count}</span>
		</header>
	);
}

function IdleGroupHead({ count }: { readonly count: number }) {
	return (
		<header className="stage-group-head" data-column="idle">
			<span className="stage-group-num">–</span>
			<span className="stage-group-label">IDLE</span>
			<span aria-hidden="true" className="stage-group-rule" />
			<span className="stage-group-count">{count}</span>
		</header>
	);
}

function StageRepoRow({
	note,
	nowSeconds,
	onSaveNote,
	repo,
}: {
	readonly note: string | undefined;
	readonly nowSeconds: number;
	readonly onSaveNote: (key: string, text: string) => void;
	readonly repo: Repo;
}) {
	const key = repoNoteKey(repo.name, repo.branch);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(note ?? "");
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const relativeTime = formatRelativeTime(repo.lastCommitAt, nowSeconds);
	const commit =
		repo.lastCommitSubject === ""
			? ""
			: repo.lastCommitSubject +
				(relativeTime === "" ? "" : " · " + relativeTime);

	const saveAndClose = (): void => {
		onSaveNote(key, draft);
		setEditing(false);
	};

	useEffect(() => {
		if (editing) textareaRef.current?.focus();
	}, [editing]);

	return (
		<div className="stage-repo-row">
			<div className="stage-repo-facts-line">
				<span
					className={
						repo.dirty
							? "stage-repo-name stage-repo-name-dirty"
							: "stage-repo-name"
					}
					title={repo.name}
				>
					{repo.name}
					{repo.dirty ? (
						<span aria-label="dirty" className="stage-repo-dot" role="img">
							●
						</span>
					) : null}
				</span>
				<span className="stage-repo-branch" title={repo.branch}>
					{repo.branch}
				</span>
				<span className="stage-repo-facts">{repoFacts(repo)}</span>
				<button
					aria-expanded={editing}
					aria-label={"edit note for " + repo.name + " " + repo.branch}
					className="stage-note-button"
					data-has-note={note === undefined ? "false" : "true"}
					onClick={() => {
						setDraft(note ?? "");
						setEditing(true);
					}}
					type="button"
				>
					✎
				</button>
			</div>
			{commit === "" ? null : (
				<div
					aria-label={"last commit: " + commit}
					className="stage-repo-commit"
					role="note"
					title={"last commit: " + repo.lastCommitSubject}
				>
					<svg
						aria-hidden="true"
						className="stage-repo-commit-icon"
						data-icon="commit"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.6"
						viewBox="0 0 20 20"
					>
						<circle cx="10" cy="10" r="3.2" />
						<path d="M1.5 10h5.3" />
						<path d="M13.2 10h5.3" />
					</svg>
					<span>{commit}</span>
				</div>
			)}
			{editing ? (
				<div className="stage-note-editor">
					<textarea
						aria-label={"note for " + repo.name + " " + repo.branch}
						onBlur={saveAndClose}
						onChange={(event) => setDraft(event.currentTarget.value)}
						onKeyDown={(event) => {
							if (event.key === "Escape") {
								event.preventDefault();
								setDraft(note ?? "");
								setEditing(false);
								return;
							}
							if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
								event.preventDefault();
								saveAndClose();
							}
						}}
						value={draft}
						ref={textareaRef}
					/>
					<span>⌘Enter 저장 · Esc 취소 · 비우고 저장하면 삭제</span>
				</div>
			) : note === undefined ? null : (
				<div className="stage-note-line" title={note}>
					✎ {note}
				</div>
			)}
		</div>
	);
}

export function StageTaskBlock({
	notes,
	nowSeconds,
	onAction,
	onSaveNote,
	onSelect,
	row,
	selected,
}: {
	readonly notes: RepoNotes;
	readonly nowSeconds: number;
	readonly onAction: TaskActionHandler;
	readonly onSaveNote: (key: string, text: string) => void;
	readonly onSelect: () => void;
	readonly row: MainTaskRow;
	readonly selected: boolean;
}) {
	const canOpenIde = row.repos.length > 0;
	const progress = taskProgress(row.task);
	const status = taskStatus(row.task);
	const currentWork = currentWorkText(row.task);
	const stage = row.role === "idle" ? "plan" : row.role;
	const stateLabel = STAGE_LABELS[stage] + (row.blocked ? ", blocked" : "");

	const openIde = (): void => {
		if (canOpenIde) onAction(row.root, row.task, "ide");
	};

	return (
		<article
			className="stage-task-block"
			data-blocked={row.blocked ? "true" : "false"}
			data-derived={row.derived ? "true" : "false"}
			data-selected={selected ? "true" : "false"}
		>
			<div className="stage-task-line">
				<button
					aria-label={
						row.project +
						", " +
						row.task.name +
						", " +
						stateLabel +
						", select" +
						(canOpenIde
							? "; double-click or command-enter to open in IDE"
							: "; no repositories available for IDE")
					}
					aria-pressed={selected}
					className="stage-task-select"
					onClick={(event) => {
						if (event.detail > 2) return;
						onSelect();
					}}
					onDoubleClick={openIde}
					onKeyDown={(event) => {
						if (!canOpenIde || event.key !== "Enter") return;
						if (!event.metaKey && !event.ctrlKey) return;
						event.preventDefault();
						openIde();
					}}
					type="button"
				>
					<span aria-hidden="true" className="stage-task-prompt">
						›
					</span>
					<span className="stage-task-name" title={row.task.name}>
						{row.task.name}
					</span>
					<StatusToken status={status} />
					{row.blocked ? (
						<span className="stage-task-blocked">BLOCKED</span>
					) : null}
					{row.derived ? (
						<span className="stage-task-derived">DERIVED</span>
					) : null}
					{progress.total > 0 ? (
						<span className="stage-task-progress">
							{progress.done}/{progress.total}
						</span>
					) : null}
					{row.task.notiCount > 0 ? (
						<span className="stage-task-notification">
							+{row.task.notiCount}
						</span>
					) : null}
				</button>
				<div className="stage-actions">
					{taskActionsFor(row.task).map((action) => (
						<button
							aria-label={action.ariaLabel}
							className="task-action"
							disabled={action.disabled}
							key={action.kind}
							onClick={() => onAction(row.root, row.task, action.kind)}
							title={action.kind === "ide" ? "IDE / Editor" : action.label}
							type="button"
						>
							<TaskActionIcon kind={action.kind} />
						</button>
					))}
				</div>
			</div>
			{currentWork === "" ? null : (
				<div className="stage-current-line">
					<span aria-hidden="true">└</span>
					<span title={currentWork}>{currentWork}</span>
				</div>
			)}
			{row.repos.length === 0 ? (
				<div className="stage-repo-empty">NO REPOSITORIES</div>
			) : (
				<div className="stage-repo-list">
					{row.repos.map((repo) => {
						const key = repoNoteKey(repo.name, repo.branch);
						return (
							<StageRepoRow
								key={key}
								note={notes[key]}
								nowSeconds={nowSeconds}
								onSaveNote={onSaveNote}
								repo={repo}
							/>
						);
					})}
				</div>
			)}
		</article>
	);
}

function IdleTaskRow({
	nowSeconds,
	onAction,
	row,
}: {
	readonly nowSeconds: number;
	readonly onAction: TaskActionHandler;
	readonly row: MainTaskRow;
}) {
	const firstRepo = row.repos.at(0);
	const additionalRepoCount = Math.max(0, row.repos.length - 1);
	const repoText =
		firstRepo === undefined
			? ""
			: firstRepo.name +
				" @ " +
				firstRepo.branch +
				(additionalRepoCount === 0 ? "" : " +" + additionalRepoCount);
	const relativeTime = formatRelativeTime(row.latestActivityAt, nowSeconds);

	return (
		<div className="stage-idle-row">
			<span aria-hidden="true" className="stage-idle-prompt">
				›
			</span>
			<span className="stage-idle-task" title={row.task.name}>
				{row.task.name}
			</span>
			<StatusToken status={taskStatus(row.task)} />
			<span className="stage-idle-repo" title={repoText}>
				{repoText}
			</span>
			<span className="stage-idle-time">{relativeTime}</span>
			<div className="stage-actions stage-idle-actions">
				{taskActionsFor(row.task).map((action) => (
					<button
						aria-label={action.ariaLabel}
						className="task-action"
						disabled={action.disabled}
						key={action.kind}
						onClick={() => onAction(row.root, row.task, action.kind)}
						title={action.kind === "ide" ? "IDE / Editor" : action.label}
						type="button"
					>
						<TaskActionIcon kind={action.kind} />
					</button>
				))}
			</div>
		</div>
	);
}

export type StageBoardProps = {
	readonly activeCount: number;
	readonly baseRows: readonly MainBaseRow[];
	readonly groups: readonly MainStageGroup[];
	readonly idleCount: number;
	readonly idleRows: readonly MainTaskRow[];
	readonly notes: RepoNotes;
	readonly nowSeconds?: number;
	readonly onAction: TaskActionHandler;
	readonly onSaveNote: (key: string, text: string) => void;
	readonly onSelect: (key: string) => void;
	readonly selectedKey: string | undefined;
};

export function StageBoard({
	activeCount,
	baseRows,
	groups,
	idleCount,
	idleRows,
	notes,
	nowSeconds,
	onAction,
	onSaveNote,
	onSelect,
	selectedKey,
}: StageBoardProps) {
	const currentNowSeconds = useCurrentEpochSeconds(nowSeconds);
	return (
		<section aria-label="Worktree status" className="stage-board">
			<h2 className="stage-matrix-caption">
				WORKTREE STATUS{" "}
				<span className="stage-matrix-count">{activeCount}</span>
			</h2>
			{baseRows.length === 0 ? null : (
				<section
					aria-label="Base repositories"
					className="stage-group stage-base-group"
					data-column="base"
				>
					<header className="stage-group-head" data-column="base">
						<span className="stage-group-num">00</span>
						<span className="stage-group-label">BASE</span>
						<span aria-hidden="true" className="stage-group-rule" />
						<span className="stage-group-count">{baseRows.length}</span>
					</header>
					{/* biome-ignore lint/a11y/useSemanticElements: The approved contract requires the existing div list container. */}
					<div className="stage-group-list" role="list">
						{baseRows.map((row) => (
							<BaseRepoRow key={row.key} row={row} />
						))}
					</div>
				</section>
			)}
			{groups.map((group) => (
				<section
					className="stage-group"
					data-column={group.column}
					key={group.column}
				>
					<StageGroupHead column={group.column} count={group.rows.length} />
					<div className="stage-group-list">
						{group.rows.map((row) => (
							<StageTaskBlock
								key={row.key}
								notes={notes}
								nowSeconds={currentNowSeconds}
								onAction={onAction}
								onSaveNote={onSaveNote}
								onSelect={() => onSelect(row.key)}
								row={row}
								selected={row.key === selectedKey}
							/>
						))}
					</div>
				</section>
			))}
			{idleRows.length > 0 ? (
				<section className="stage-group stage-idle-group" data-column="idle">
					<IdleGroupHead count={idleCount} />
					<div className="stage-group-list">
						{idleRows.map((row) => (
							<IdleTaskRow
								key={row.key}
								nowSeconds={currentNowSeconds}
								onAction={onAction}
								row={row}
							/>
						))}
					</div>
				</section>
			) : null}
		</section>
	);
}
