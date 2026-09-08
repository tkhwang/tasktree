use super::{configured_base_dir, discover_watch_scopes};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(0);

struct Fixture(PathBuf);

impl Fixture {
    fn new(name: &str) -> Result<Self, Box<dyn std::error::Error>> {
        let id = NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "workbranch-watch-scope-{name}-{}-{id}",
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

fn write_project_config(root: &Path, base_dir: &str) -> std::io::Result<()> {
    fs::write(
        root.join(".workbranch.config"),
        format!("PROJECT_NAME demo\nMAIN_WORKTREES_DIR {base_dir}\n"),
    )
}

fn write_git_metadata(common_dir: &Path, git_dir: &Path) -> std::io::Result<()> {
    fs::create_dir_all(common_dir.join("objects"))?;
    fs::create_dir_all(common_dir.join("refs/heads"))?;
    fs::create_dir_all(git_dir)?;
    fs::write(common_dir.join("HEAD"), "ref: refs/heads/main\n")?;
    fs::write(git_dir.join("HEAD"), "ref: refs/heads/task\n")?;
    if common_dir != git_dir {
        fs::write(git_dir.join("commondir"), "../..\n")?;
    }
    Ok(())
}

#[test]
fn discovers_external_git_dir_and_common_dir_from_custom_base_directory()
-> Result<(), Box<dyn std::error::Error>> {
    // Given
    let fixture = Fixture::new("external")?;
    let root = fixture.0.join("project");
    let repository = root.join("main-repositories/frontend");
    let common_dir = fixture.0.join("target/frontend.git");
    let git_dir = common_dir.join("worktrees/frontend");
    fs::create_dir_all(&repository)?;
    write_project_config(&root, "main-repositories")?;
    write_git_metadata(&common_dir, &git_dir)?;
    fs::write(
        repository.join(".git"),
        format!("gitdir: {}\n", git_dir.display()),
    )?;

    // When
    let scopes = discover_watch_scopes(&[root.to_string_lossy().into_owned()])?;

    // Then
    assert!(scopes.contains_key(&fs::canonicalize(&git_dir)?));
    assert!(scopes.contains_key(&fs::canonicalize(&common_dir)?));
    assert_eq!(scopes.len(), 3);
    Ok(())
}

#[test]
fn deduplicates_shared_external_metadata_and_aggregates_owners()
-> Result<(), Box<dyn std::error::Error>> {
    // Given
    let fixture = Fixture::new("shared")?;
    let common_dir = fixture.0.join("shared.git");
    write_git_metadata(&common_dir, &common_dir)?;
    let mut roots = Vec::new();
    for name in ["project-a", "project-b"] {
        let root = fixture.0.join(name);
        let repository = root.join("bases/frontend");
        fs::create_dir_all(&repository)?;
        write_project_config(&root, "bases")?;
        fs::write(
            repository.join(".git"),
            format!("gitdir: {}\n", common_dir.display()),
        )?;
        roots.push(root.to_string_lossy().into_owned());
    }

    // When
    let scopes = discover_watch_scopes(&roots)?;

    // Then
    let shared = scopes
        .get(&fs::canonicalize(&common_dir)?)
        .ok_or("shared metadata scope missing")?;
    assert_eq!(shared.owners.iter().cloned().collect::<Vec<_>>(), roots);
    assert_eq!(scopes.len(), 3);
    Ok(())
}

#[test]
fn rejects_gitfile_target_without_plausible_git_metadata() -> Result<(), Box<dyn std::error::Error>>
{
    // Given
    let fixture = Fixture::new("invalid")?;
    let root = fixture.0.join("project");
    let repository = root.join("bases/frontend");
    let arbitrary_source_tree = fixture.0.join("source-tree");
    fs::create_dir_all(&repository)?;
    fs::create_dir_all(&arbitrary_source_tree)?;
    write_project_config(&root, "bases")?;
    fs::write(
        repository.join(".git"),
        format!("gitdir: {}\n", arbitrary_source_tree.display()),
    )?;

    // When
    let scopes = discover_watch_scopes(&[root.to_string_lossy().into_owned()])?;

    // Then
    assert_eq!(scopes.len(), 1);
    assert!(!scopes.contains_key(&fs::canonicalize(arbitrary_source_tree)?));
    Ok(())
}

#[test]
fn broken_gitfile_does_not_block_healthy_root_scope() -> Result<(), Box<dyn std::error::Error>> {
    // Given
    let fixture = Fixture::new("broken")?;
    let root = fixture.0.join("project");
    let repository = root.join("bases/frontend");
    fs::create_dir_all(&repository)?;
    write_project_config(&root, "bases")?;
    fs::write(repository.join(".git"), "gitdir: /missing/external.git\n")?;

    // When
    let scopes = discover_watch_scopes(&[root.to_string_lossy().into_owned()])?;

    // Then
    assert_eq!(scopes.len(), 1);
    assert!(scopes.contains_key(&fs::canonicalize(root)?));
    Ok(())
}

#[test]
fn unsafe_base_directory_value_cannot_escape_project_root() -> Result<(), Box<dyn std::error::Error>>
{
    // Given
    let fixture = Fixture::new("unsafe-base")?;
    let root = fixture.0.join("project");
    fs::create_dir_all(&root)?;
    write_project_config(&root, "../outside")?;

    // When
    let scopes = discover_watch_scopes(&[root.to_string_lossy().into_owned()])?;

    // Then
    assert_eq!(scopes.len(), 1);
    Ok(())
}

#[test]
fn new_gitfile_is_discovered_on_next_scope_refresh() -> Result<(), Box<dyn std::error::Error>> {
    // Given
    let fixture = Fixture::new("new-gitfile")?;
    let root = fixture.0.join("project");
    let repository = root.join("bases/frontend");
    let external_git_dir = fixture.0.join("external.git");
    fs::create_dir_all(&repository)?;
    write_project_config(&root, "bases")?;
    let root_label = root.to_string_lossy().into_owned();
    let before = discover_watch_scopes(std::slice::from_ref(&root_label))?;
    write_git_metadata(&external_git_dir, &external_git_dir)?;

    // When
    fs::write(
        repository.join(".git"),
        format!("gitdir: {}\n", external_git_dir.display()),
    )?;
    let after = discover_watch_scopes(&[root_label])?;

    // Then
    assert_eq!(before.len(), 1);
    assert!(after.contains_key(&fs::canonicalize(external_git_dir)?));
    Ok(())
}

#[test]
fn legacy_configs_discover_external_base_metadata() -> Result<(), Box<dyn std::error::Error>> {
    for filename in [".tasktree.config", ".monotree.config"] {
        for directive in ["MAIN_WORKTREES_DIR", "BASE_DIR", "base_dir"] {
            let fixture = Fixture::new("legacy-config")?;
            let root = fixture.0.join("project");
            let repository = root.join("legacy-bases/frontend");
            let git_dir = fixture.0.join("external.git");
            fs::create_dir_all(&repository)?;
            fs::write(root.join(filename), format!("{directive} legacy-bases\n"))?;
            write_git_metadata(&git_dir, &git_dir)?;
            fs::write(
                repository.join(".git"),
                format!("gitdir: {}\n", git_dir.display()),
            )?;

            let scopes = discover_watch_scopes(&[root.to_string_lossy().into_owned()])?;
            assert!(
                scopes.contains_key(&fs::canonicalize(&git_dir)?),
                "{filename}: {directive}"
            );
        }
    }
    Ok(())
}

#[test]
fn config_precedence_matches_cli_project_discovery() -> Result<(), Box<dyn std::error::Error>> {
    let fixture = Fixture::new("config-precedence")?;
    fs::write(fixture.0.join(".monotree.config"), "base_dir oldest\n")?;
    fs::write(fixture.0.join(".tasktree.config"), "BASE_DIR legacy\n")?;
    write_project_config(&fixture.0, "current")?;
    assert_eq!(configured_base_dir(&fixture.0).as_deref(), Some("current"));
    fs::remove_file(fixture.0.join(".workbranch.config"))?;
    assert_eq!(configured_base_dir(&fixture.0).as_deref(), Some("legacy"));
    fs::remove_file(fixture.0.join(".tasktree.config"))?;
    assert_eq!(configured_base_dir(&fixture.0).as_deref(), Some("oldest"));
    Ok(())
}

#[test]
fn canonical_config_does_not_accept_legacy_aliases() -> Result<(), Box<dyn std::error::Error>> {
    let fixture = Fixture::new("canonical-directive")?;
    for directive in ["BASE_DIR", "base_dir"] {
        fs::write(
            fixture.0.join(".workbranch.config"),
            format!("{directive} bases\n"),
        )?;
        assert_eq!(configured_base_dir(&fixture.0), None);
    }
    Ok(())
}
