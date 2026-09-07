import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityCalendarView } from "./activity/ActivityCalendarView";
import { createActivityRefresh } from "./application/activity";
import {
	buildMainViewModel,
	buildMenuModel,
	type MenuModel,
} from "./application/state";
import { useCompanionSettings } from "./application/useCompanionSettings";
import { useRepoNotes } from "./application/useRepoNotes";
import type { GlobalState, Task } from "./domain/model";
import {
	appendActivityEvents,
	type CompanionCommand,
	onRootChanged,
	quitCompanion,
	readActivityEvents,
	refreshRoot,
	refreshStatus,
	runAction,
	watchRoots,
} from "./infrastructure/tauriClient";
import { startWorkspaceMonitor } from "./infrastructure/workspaceMonitor";
import { AgentHeader } from "./ui/AgentHeader";
import { AgentTabs, type CompanionView } from "./ui/AgentTabs";
import { SettingsView } from "./ui/SettingsView";
import { StageBoard } from "./ui/StageBoard";
import { StatusAlert } from "./ui/StatusAlert";
import type { TaskActionKind } from "./ui/TaskRow";

const EMPTY_STATE: GlobalState = { projects: [], errors: [] };
const TAURI_RUNTIME_UNAVAILABLE = "Tauri runtime unavailable";

function currentEpochSeconds(): number {
	return Math.floor(Date.now() / 1000);
}

function commandForTaskAction(
	task: Task,
	kind: TaskActionKind,
): CompanionCommand {
	switch (kind) {
		case "ide":
			return { kind: "ide", task: task.name };
		case "terminal":
			return { kind: "terminal", task: task.name };
		case "finder":
			return { kind: "finder", task: task.name };
	}
}

export function nextActivityReloadToken(current: number): number {
	return current + 1;
}

export function App() {
	const [state, setState] = useState<GlobalState>(EMPTY_STATE);
	const stateRef = useRef<GlobalState>(EMPTY_STATE);
	const [activityReloadToken, setActivityReloadToken] = useState(0);
	const [status, setStatus] = useState("Ready");
	const [visibleError, setVisibleError] = useState<string>();
	const [currentView, setCurrentView] = useState<CompanionView>("main");
	const [selectedStageTask, setSelectedStageTask] = useState<
		string | undefined
	>(undefined);
	const model: MenuModel = buildMenuModel(state);
	const main = buildMainViewModel(state);
	const tauriRuntimeAvailable = isTauri();
	const refreshWithActivity = useMemo(
		() =>
			createActivityRefresh({
				refresh: refreshStatus,
				refreshRoot,
				append: appendActivityEvents,
				now: currentEpochSeconds,
			}),
		[],
	);

	const showStatus = useCallback((message: string) => {
		setStatus(message);
		setVisibleError(
			message === TAURI_RUNTIME_UNAVAILABLE
				? TAURI_RUNTIME_UNAVAILABLE
				: undefined,
		);
	}, []);

	const showError = useCallback((error: unknown) => {
		const message = error instanceof Error ? error.message : String(error);
		setStatus(message);
		setVisibleError(message);
	}, []);

	const {
		preferences,
		launchAtLogin,
		launchAtLoginLoading,
		updateLaunchAtLogin,
		updatePreferences,
	} = useCompanionSettings({ onError: showError, onStatus: showStatus });
	const { notes, saveNote } = useRepoNotes({
		onError: showError,
		onStatus: showStatus,
	});
	const activeTheme = preferences.theme;

	const applyState = useCallback(
		(next: GlobalState) => {
			stateRef.current = next;
			setState(next);
			setActivityReloadToken(nextActivityReloadToken);
			showStatus("Updated");
		},
		[showStatus],
	);

	const refresh = useCallback(async () => {
		if (!tauriRuntimeAvailable) {
			showStatus(TAURI_RUNTIME_UNAVAILABLE);
			return;
		}
		try {
			applyState(await refreshWithActivity.all());
		} catch (error) {
			showError(error);
		}
	}, [
		applyState,
		refreshWithActivity,
		showError,
		showStatus,
		tauriRuntimeAvailable,
	]);

	const handleQuit = useCallback(() => {
		if (!tauriRuntimeAvailable) {
			showStatus(TAURI_RUNTIME_UNAVAILABLE);
			return;
		}
		void quitCompanion().catch(showError);
	}, [showError, showStatus, tauriRuntimeAvailable]);

	const handleTaskAction = useCallback(
		async (root: string, task: Task, kind: TaskActionKind) => {
			if (!tauriRuntimeAvailable) {
				showStatus(TAURI_RUNTIME_UNAVAILABLE);
				return;
			}
			const command = commandForTaskAction(task, kind);
			try {
				await runAction(command, root);
				applyState(await refreshWithActivity.all());
				showStatus("Action complete");
			} catch (error) {
				showError(error);
			}
		},
		[
			applyState,
			refreshWithActivity,
			showError,
			showStatus,
			tauriRuntimeAvailable,
		],
	);

	useEffect(() => {
		if (!tauriRuntimeAvailable) {
			return;
		}
		let stop: (() => void) | undefined;
		let cancelled = false;
		void startWorkspaceMonitor({
			refresh: refreshWithActivity.all,
			refreshRoot: refreshWithActivity.root,
			getState: () => stateRef.current,
			onState: applyState,
			onError: showError,
			watchRoots,
			onRootChanged,
			heartbeatMs: 5 * 60 * 1000,
			setTimer: (callback, milliseconds) =>
				window.setInterval(callback, milliseconds),
			clearTimer: (handle) => {
				window.clearInterval(handle);
			},
		})
			.then((monitor) => {
				if (cancelled) {
					monitor.stop();
				} else {
					stop = monitor.stop;
				}
			})
			.catch(showError);
		return () => {
			cancelled = true;
			stop?.();
		};
	}, [applyState, refreshWithActivity, showError, tauriRuntimeAvailable]);

	return (
		<main
			data-font={preferences.font}
			data-font-size={preferences.fontSize}
			data-theme={activeTheme}
		>
			<AgentHeader
				theme={activeTheme}
				summary={model.summary}
				status={status}
				onRefresh={() => void refresh()}
				onQuit={handleQuit}
			/>
			<StatusAlert message={visibleError} />
			{currentView === "main" ? (
				<section className="view-panel" aria-label="Main View">
					<StageBoard
						activeCount={main.activeCount}
						baseRows={main.baseRows}
						groups={main.stageGroups}
						idleCount={main.idleCount}
						idleRows={main.idleRows}
						notes={notes}
						onAction={(root, task, kind) =>
							void handleTaskAction(root, task, kind)
						}
						onSaveNote={(key, text) => void saveNote(key, text)}
						onSelect={setSelectedStageTask}
						selectedKey={selectedStageTask}
					/>
					{model.summary.taskCount === 0 ? (
						<p className="empty">No workbranch tasks registered.</p>
					) : null}
					{model.summary.taskCount > 0 && main.activeCount === 0 ? (
						<p className="empty">No active worktrees.</p>
					) : null}
				</section>
			) : null}
			{currentView === "activity" ? (
				<section
					className="activity-view view-panel"
					aria-label="Activity calendar"
				>
					<ActivityCalendarView
						loadEvents={readActivityEvents}
						reloadToken={activityReloadToken}
						today={() => new Date()}
					/>
				</section>
			) : null}
			{currentView === "settings" ? (
				<SettingsView
					preferences={preferences}
					launchAtLogin={launchAtLogin}
					launchAtLoginLoading={launchAtLoginLoading}
					onLaunchAtLoginChange={(enabled) => void updateLaunchAtLogin(enabled)}
					onPreferencesChange={(next) => void updatePreferences(next)}
				/>
			) : null}
			{model.errors.map((error) => (
				<p className="error" key={error.root}>
					{error.root}: {error.message}
				</p>
			))}
			<AgentTabs currentView={currentView} onViewChange={setCurrentView} />
		</main>
	);
}
