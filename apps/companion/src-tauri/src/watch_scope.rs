use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use crate::CompanionError;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct WatchScope {
    pub(crate) owners: BTreeSet<String>,
    pub(crate) filter_source_noise: bool,
}

pub(crate) type WatchScopes = BTreeMap<PathBuf, WatchScope>;

pub(crate) fn discover_watch_scopes(roots: &[String]) -> Result<WatchScopes, CompanionError> {
    let mut scopes = WatchScopes::new();
    for root in roots {
        let root_path = fs::canonicalize(root)?;
        insert_scope(&mut scopes, root_path.clone(), root, true);
        for git_entry in repository_git_entries(&root_path)? {
            for metadata_path in resolve_external_metadata_paths(&root_path, &git_entry) {
                insert_scope(&mut scopes, metadata_path, root, false);
            }
        }
    }
    Ok(scopes)
}

fn insert_scope(scopes: &mut WatchScopes, path: PathBuf, owner: &str, filter_source_noise: bool) {
    let scope = scopes.entry(path).or_insert_with(|| WatchScope {
        owners: BTreeSet::new(),
        filter_source_noise,
    });
    scope.owners.insert(owner.to_string());
    scope.filter_source_noise &= filter_source_noise;
}

fn repository_git_entries(root: &Path) -> Result<Vec<PathBuf>, CompanionError> {
    let mut workspaces = Vec::new();
    if let Some(base_dir) = configured_base_dir(root) {
        workspaces.push(root.join(base_dir));
    }
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() && path.join("TASK-WORKBRANCH.md").is_file() {
            workspaces.push(path);
        }
    }

    let mut git_entries = Vec::new();
    for workspace in workspaces {
        let Ok(repositories) = fs::read_dir(workspace) else {
            continue;
        };
        for repository in repositories {
            let repository = repository?;
            let git_entry = repository.path().join(".git");
            if git_entry.is_file() || git_entry.is_dir() {
                git_entries.push(git_entry);
            }
        }
    }
    Ok(git_entries)
}

fn configured_base_dir(root: &Path) -> Option<String> {
    let config = fs::read_to_string(root.join(".workbranch.config")).ok()?;
    config.lines().find_map(|line| {
        let mut fields = line.split_whitespace();
        match (fields.next(), fields.next(), fields.next()) {
            (Some("MAIN_WORKTREES_DIR"), Some(value), None) if is_single_component(value) => {
                Some(value.to_string())
            }
            _ => None,
        }
    })
}

fn is_single_component(value: &str) -> bool {
    let mut components = Path::new(value).components();
    matches!(components.next(), Some(std::path::Component::Normal(_)))
        && components.next().is_none()
}

fn resolve_external_metadata_paths(root: &Path, git_entry: &Path) -> Vec<PathBuf> {
    if git_entry.is_dir() {
        return Vec::new();
    }
    let Some(git_dir) = parse_path_file(git_entry, "gitdir:", git_entry.parent()) else {
        return Vec::new();
    };
    let Ok(git_dir) = fs::canonicalize(git_dir) else {
        return Vec::new();
    };
    if !valid_git_dir(&git_dir) {
        return Vec::new();
    }

    let common_dir = parse_path_file(&git_dir.join("commondir"), "", Some(&git_dir))
        .unwrap_or_else(|| git_dir.clone());
    let Ok(common_dir) = fs::canonicalize(common_dir) else {
        return Vec::new();
    };
    if !valid_common_dir(&common_dir) {
        return Vec::new();
    }

    let mut paths = Vec::new();
    if !git_dir.starts_with(root) {
        paths.push(git_dir);
    }
    if !common_dir.starts_with(root) && !paths.contains(&common_dir) {
        paths.push(common_dir);
    }
    paths
}

fn parse_path_file(path: &Path, prefix: &str, relative_to: Option<&Path>) -> Option<PathBuf> {
    let contents = fs::read_to_string(path).ok()?;
    let line = contents.lines().next()?;
    let value = line
        .strip_prefix(prefix)
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    let value = PathBuf::from(value);
    Some(if value.is_absolute() {
        value
    } else {
        relative_to.map_or(value.clone(), |base| base.join(value))
    })
}

fn valid_git_dir(path: &Path) -> bool {
    path.is_dir() && path.join("HEAD").is_file()
}

fn valid_common_dir(path: &Path) -> bool {
    valid_git_dir(path) && path.join("objects").is_dir() && path.join("refs").is_dir()
}

#[cfg(test)]
#[path = "watch_scope_tests.rs"]
mod tests;
