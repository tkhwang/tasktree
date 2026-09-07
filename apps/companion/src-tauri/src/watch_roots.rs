use std::collections::{BTreeSet, HashMap};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

use crate::CompanionError;
use crate::watch_filter::{IGNORED_COMPONENTS, event_has_relevant_change};
use crate::watch_scope::{WatchScopes, discover_watch_scopes};

#[derive(Default)]
pub(crate) struct WatcherSet {
    scopes: WatchScopes,
    _watchers: Vec<RecommendedWatcher>,
}

pub(crate) fn reconcile_watchers(
    app: AppHandle,
    roots: &[String],
    current: &mut WatcherSet,
) -> Result<Vec<String>, CompanionError> {
    let scopes = discover_watch_scopes(roots)?;
    if current.scopes == scopes {
        return Ok(Vec::new());
    }
    let changed_roots = changed_roots(&current.scopes, &scopes);
    let watchers = build_watchers(scopes.clone(), move |root| {
        let _ = app.emit("roots-changed", root);
    })?;
    *current = WatcherSet {
        scopes,
        _watchers: watchers,
    };
    Ok(changed_roots)
}

fn build_watchers(
    scopes: WatchScopes,
    emit: impl Fn(String) + Clone + Send + 'static,
) -> Result<Vec<RecommendedWatcher>, CompanionError> {
    let debounce = Arc::new(Mutex::new(HashMap::<String, Instant>::new()));
    let mut next_watchers = Vec::with_capacity(scopes.len());

    for (watch_path, scope) in scopes {
        let filter_root = watch_path.clone();
        let owners = scope.owners;
        let filter_source_noise = scope.filter_source_noise;
        let emit_change = emit.clone();
        let debounce_state = Arc::clone(&debounce);
        let mut watcher =
            notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
                let Ok(event) = event else {
                    return;
                };
                if filter_source_noise
                    && !event_has_relevant_change(&filter_root, &event.paths, IGNORED_COMPONENTS)
                {
                    return;
                }
                for root in &owners {
                    if should_emit_root_change(&debounce_state, root) {
                        emit_change(root.clone());
                    }
                }
            })?;
        watcher.watch(&watch_path, RecursiveMode::Recursive)?;
        next_watchers.push(watcher);
    }

    Ok(next_watchers)
}

fn changed_roots(previous: &WatchScopes, next: &WatchScopes) -> Vec<String> {
    let owners = next
        .values()
        .flat_map(|scope| scope.owners.iter().cloned())
        .collect::<BTreeSet<_>>();
    owners
        .into_iter()
        .filter(|owner| paths_for_owner(previous, owner) != paths_for_owner(next, owner))
        .collect()
}

fn paths_for_owner<'a>(scopes: &'a WatchScopes, owner: &str) -> BTreeSet<&'a Path> {
    scopes
        .iter()
        .filter(|(_, scope)| scope.owners.contains(owner))
        .map(|(path, _)| path.as_path())
        .collect()
}

fn should_emit_root_change(debounce: &Arc<Mutex<HashMap<String, Instant>>>, root: &str) -> bool {
    const DEBOUNCE_WINDOW: Duration = Duration::from_millis(500);
    let now = Instant::now();
    let Ok(mut last_by_root) = debounce.lock() else {
        return true;
    };
    if let Some(last) = last_by_root.get(root)
        && now.duration_since(*last) < DEBOUNCE_WINDOW
    {
        return false;
    }
    last_by_root.insert(root.to_string(), now);
    true
}

#[cfg(test)]
#[path = "watch_roots_tests.rs"]
mod tests;
