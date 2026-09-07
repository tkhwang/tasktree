use super::{build_watchers, changed_roots};
use crate::watch_scope::{WatchScope, WatchScopes, discover_watch_scopes};
use std::collections::BTreeSet;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::time::Duration;

static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(0);

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Result<Self, Box<dyn std::error::Error>> {
        let id = NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "workbranch-watch-event-{}-{id}",
            std::process::id()
        ));
        fs::create_dir_all(&path)?;
        Ok(Self(path))
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

struct WatchedFixture {
    _fixture: Fixture,
    git_dir: PathBuf,
    common_dir: PathBuf,
    root_label: String,
    receiver: mpsc::Receiver<String>,
    _watchers: Vec<notify::RecommendedWatcher>,
}

fn watched_external_metadata_fixture() -> Result<WatchedFixture, Box<dyn std::error::Error>> {
    let fixture = Fixture::new()?;
    let root = fixture.0.join("project");
    let repository = root.join("bases/frontend");
    let common_dir = fixture.0.join("target/frontend.git");
    let git_dir = common_dir.join("worktrees/frontend");
    fs::create_dir_all(&repository)?;
    fs::create_dir_all(common_dir.join("objects"))?;
    fs::create_dir_all(common_dir.join("refs/heads"))?;
    fs::create_dir_all(&git_dir)?;
    fs::write(
        root.join(".workbranch.config"),
        "PROJECT_NAME demo\nMAIN_WORKTREES_DIR bases\n",
    )?;
    fs::write(common_dir.join("HEAD"), "ref: refs/heads/main\n")?;
    fs::write(git_dir.join("HEAD"), "ref: refs/heads/task\n")?;
    fs::write(git_dir.join("commondir"), "../..\n")?;
    fs::write(
        repository.join(".git"),
        format!("gitdir: {}\n", git_dir.display()),
    )?;
    let root_label = root.to_string_lossy().into_owned();
    let scopes = discover_watch_scopes(std::slice::from_ref(&root_label))?;
    let (sender, receiver) = mpsc::channel();
    let watchers = build_watchers(scopes, move |changed_root| {
        let _ = sender.send(changed_root);
    })?;
    Ok(WatchedFixture {
        _fixture: fixture,
        git_dir,
        common_dir,
        root_label,
        receiver,
        _watchers: watchers,
    })
}

#[test]
fn external_git_dir_change_emits_owning_root() -> Result<(), Box<dyn std::error::Error>> {
    // Given
    let fixture = watched_external_metadata_fixture()?;

    // When
    fs::write(fixture.git_dir.join("HEAD"), "ref: refs/heads/next\n")?;

    // Then
    assert_eq!(
        fixture.receiver.recv_timeout(Duration::from_secs(3))?,
        fixture.root_label
    );
    Ok(())
}

#[test]
fn external_common_dir_change_emits_owning_root() -> Result<(), Box<dyn std::error::Error>> {
    // Given
    let fixture = watched_external_metadata_fixture()?;

    // When
    fs::write(
        fixture.common_dir.join("refs/heads/main"),
        "0123456789abcdef\n",
    )?;

    // Then
    assert_eq!(
        fixture.receiver.recv_timeout(Duration::from_secs(3))?,
        fixture.root_label
    );
    Ok(())
}

#[test]
fn ordinary_root_change_still_emits_owning_root() -> Result<(), Box<dyn std::error::Error>> {
    // Given
    let fixture = Fixture::new()?;
    let root = fixture.0.join("project");
    fs::create_dir_all(&root)?;
    fs::write(
        root.join(".workbranch.config"),
        "PROJECT_NAME demo\nMAIN_WORKTREES_DIR bases\n",
    )?;
    let root_label = root.to_string_lossy().into_owned();
    let scopes = discover_watch_scopes(std::slice::from_ref(&root_label))?;
    let (sender, receiver) = mpsc::channel();
    let _watchers = build_watchers(scopes, move |changed_root| {
        let _ = sender.send(changed_root);
    })?;

    // When
    fs::write(root.join("TASK-WORKBRANCH.md"), "status: review\n")?;

    // Then
    assert_eq!(receiver.recv_timeout(Duration::from_secs(3))?, root_label);
    Ok(())
}

#[test]
fn unchanged_scope_does_not_emit_initial_root_again() {
    // Given
    let owner = "/project".to_string();
    let scope = WatchScope {
        owners: BTreeSet::from([owner.clone()]),
        filter_source_noise: true,
    };
    let scopes = WatchScopes::from([(PathBuf::from(&owner), scope)]);

    // When
    let changed = changed_roots(&scopes, &scopes);

    // Then
    assert!(changed.is_empty());
}

#[test]
fn newly_discovered_metadata_scope_emits_owning_root_once() {
    // Given
    let owner = "/project".to_string();
    let root_scope = WatchScope {
        owners: BTreeSet::from([owner.clone()]),
        filter_source_noise: true,
    };
    let metadata_scope = WatchScope {
        owners: BTreeSet::from([owner.clone()]),
        filter_source_noise: false,
    };
    let previous = WatchScopes::from([(PathBuf::from(&owner), root_scope.clone())]);
    let next = WatchScopes::from([
        (PathBuf::from(&owner), root_scope),
        (PathBuf::from("/external/repo.git"), metadata_scope),
    ]);

    // When
    let changed = changed_roots(&previous, &next);

    // Then
    assert_eq!(changed, vec![owner]);
}
