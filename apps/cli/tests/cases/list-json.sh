# shellcheck shell=bash
# Sourced by tests/run.sh; uses helpers from tests/lib/helpers.sh.

json_assert() {
  python3 - "$@"
}

test_list_json_shape() {
  new_fixture
  project="$FIXTURE_PROJECT"
  cd "$project" || return 1
  run_expect_success "$WORKBRANCH" init >/dev/null
  run_expect_success "$WORKBRANCH" add login >/dev/null
  cat > "$project/login/TASK-WORKBRANCH.md" <<'EOF_BRIEF'
# 견적 "API" \ 경로
status: todo
- [ ] shape check
EOF_BRIEF
  run_expect_success "$WORKBRANCH" noti add login "tests passed" >/dev/null
  run_expect_success "$WORKBRANCH" noti add login "needs input" >/dev/null

  project_real=$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$project")
  out=$(run_expect_success "$WORKBRANCH" list --json)
  printf '%s' "$out" | python3 -c 'import json, sys
expected_root = sys.argv[1]
d = json.load(sys.stdin)
assert d["schemaVersion"] == 1, d
assert d["project"] == "fullstack", d
assert d["root"] == expected_root, d
assert [t["name"] for t in d["tasks"]] == ["login"], d
login = d["tasks"][0]
assert login["path"] == f"{expected_root}/login", login
assert login["memoTitle"] == "견적 \"API\" \\ 경로", login
assert login["notiCount"] == 2, login
assert [r["name"] for r in login["repos"]] == ["frontend", "backend"], login
for repo in login["repos"]:
    assert set(repo) == {"name", "branch", "dirty", "ahead", "behind", "changedFiles", "lastCommitSubject", "lastCommitAt"}, repo
    assert repo["branch"] == "feature/login", repo
    assert repo["dirty"] is False, repo
    assert repo["ahead"] == 0, repo
    assert repo["behind"] == 0, repo
    assert repo["changedFiles"] == 0, repo
    assert isinstance(repo["lastCommitSubject"], str), repo
    assert repo["lastCommitSubject"], repo
    assert isinstance(repo["lastCommitAt"], int), repo
    assert repo["lastCommitAt"] > 0, repo' "$project_real"
}

test_list_json_repo_activity_facts() {
  new_fixture
  project="$FIXTURE_PROJECT"
  cd "$project" || return 1
  run_expect_success "$WORKBRANCH" init >/dev/null
  run_expect_success "$WORKBRANCH" add login >/dev/null

  frontend="$project/login/frontend"
  git -C "$frontend" config user.name "Workbranch Test"
  git -C "$frontend" config user.email "workbranch-test@example.com"
  printf '%s\n' committed > "$frontend/activity.txt"
  git -C "$frontend" add activity.txt
  git -C "$frontend" commit -m 'implement "activity" facts' >/dev/null
  printf '%s\n' dirty > "$frontend/dirty.txt"

  out=$(run_expect_success "$WORKBRANCH" list --json)
  printf '%s' "$out" | python3 -c 'import json, sys
task = json.load(sys.stdin)["tasks"][0]
repos = {repo["name"]: repo for repo in task["repos"]}
frontend = repos["frontend"]
assert frontend["ahead"] == 1, frontend
assert frontend["behind"] == 0, frontend
assert frontend["dirty"] is True, frontend
assert frontend["changedFiles"] == 1, frontend
assert frontend["lastCommitSubject"] == "implement \"activity\" facts", frontend
assert isinstance(frontend["lastCommitAt"], int) and frontend["lastCommitAt"] > 0, frontend
backend = repos["backend"]
assert backend["ahead"] == 0, backend
assert backend["behind"] == 0, backend
assert backend["dirty"] is False, backend
assert backend["changedFiles"] == 0, backend
assert backend["lastCommitSubject"] == "initial backend", backend
assert isinstance(backend["lastCommitAt"], int) and backend["lastCommitAt"] > 0, backend'
}

test_list_json_repo_activity_missing_base_commit_falls_back() {
  new_fixture
  project="$FIXTURE_PROJECT"
  cd "$project" || return 1
  run_expect_success "$WORKBRANCH" init >/dev/null
  run_expect_success "$WORKBRANCH" add login >/dev/null
  git -C "$project/_base/backend" checkout --orphan no-base-commit >/dev/null 2>&1
  git -C "$project/_base/backend" rm -rf . >/dev/null 2>&1

  out=$(run_expect_success "$WORKBRANCH" list --json)
  printf '%s' "$out" | python3 -c 'import json, sys
repos = {repo["name"]: repo for repo in json.load(sys.stdin)["tasks"][0]["repos"]}
backend = repos["backend"]
assert backend["branch"] == "feature/login", backend
assert backend["dirty"] is False, backend
assert backend["ahead"] == 0, backend
assert backend["behind"] == 0, backend
assert backend["changedFiles"] == 0, backend
assert backend["lastCommitSubject"] == "initial backend", backend
assert backend["lastCommitAt"] > 0, backend'
}

test_list_json_no_color_no_log_noise() {
  new_fixture
  project="$FIXTURE_PROJECT"
  cd "$project" || return 1
  run_expect_success "$WORKBRANCH" init >/dev/null
  run_expect_success "$WORKBRANCH" add login >/dev/null

  out=$(run_expect_success env -u NO_COLOR WORKBRANCH_COLOR=always "$WORKBRANCH" list --json)
  printf '%s' "$out" | python3 -c 'import json,sys; json.load(sys.stdin)'
  assert_not_contains "$out" $'\033['
  assert_not_contains "$out" "[*]"
}

test_list_json_escapes_control_characters() {
  new_fixture
  project="$FIXTURE_PROJECT"
  cd "$project" || return 1
  run_expect_success "$WORKBRANCH" init >/dev/null
  run_expect_success "$WORKBRANCH" add login >/dev/null
  printf '# needs\aattention\nstatus: todo\n' > "$project/login/TASK-WORKBRANCH.md"

  out=$(run_expect_success "$WORKBRANCH" list --json)
  printf '%s' "$out" | python3 -c 'import json, sys
d = json.load(sys.stdin)
assert d["tasks"][0]["memoTitle"] == "needs\x07attention", d'
  assert_contains "$out" "\\u0007"
}

test_list_json_dirty_flag() {
  new_fixture
  project="$FIXTURE_PROJECT"
  cd "$project" || return 1
  run_expect_success "$WORKBRANCH" init >/dev/null
  run_expect_success "$WORKBRANCH" add login >/dev/null
  printf '%s\n' dirty > "$project/login/frontend/dirty.txt"

  out=$(run_expect_success "$WORKBRANCH" list --json)
  printf '%s' "$out" | python3 -c 'import json, sys
d = json.load(sys.stdin)
repos = {r["name"]: r for r in d["tasks"][0]["repos"]}
assert repos["frontend"]["dirty"] is True, repos
assert repos["backend"]["dirty"] is False, repos'
}

test_list_json_skips_stale_and_partial_task_dirs() {
  new_fixture
  project="$FIXTURE_PROJECT"
  cd "$project" || return 1
  run_expect_success "$WORKBRANCH" init >/dev/null
  run_expect_success "$WORKBRANCH" add login >/dev/null

  mkdir -p "$project/partial/frontend"
  mkdir -p "$project/stale/frontend" "$project/stale/backend"
  rm -f "$project/stale/frontend/.git" "$project/stale/backend/.git"

  out=$(run_expect_success "$WORKBRANCH" list --json)
  printf '%s' "$out" | python3 -c 'import json, sys
d = json.load(sys.stdin)
names = [t["name"] for t in d["tasks"]]
assert names == ["login"], names'
}


test_list_json_schema_v1_progress_shape() {
  new_fixture
  project="$FIXTURE_PROJECT"
  cd "$project" || return 1
  run_expect_success "$WORKBRANCH" init >/dev/null
  run_expect_success "$WORKBRANCH" add login >/dev/null

  out=$(run_expect_success "$WORKBRANCH" list --json)
  printf '%s' "$out" | python3 -c 'import json,sys
d=json.load(sys.stdin)
assert d["schemaVersion"] == 1, d
login=d["tasks"][0]
for key in ["status", "progressDone", "progressTotal", "currentItem", "updatedAt"]:
    assert key in login, login
assert login["status"] == "todo", login
assert login["progressDone"] == 0, login
assert login["progressTotal"] == 0, login
assert login["currentItem"] == "", login
assert login["memoTitle"] == "login", login
assert isinstance(login["updatedAt"], int), login
assert login["updatedAt"] > 0, login'
}

test_list_json_progress_and_status() {
  new_fixture
  project="$FIXTURE_PROJECT"
  cd "$project" || return 1
  run_expect_success "$WORKBRANCH" init >/dev/null
  run_expect_success "$WORKBRANCH" add login >/dev/null
  cat > "$project/login/TASK-WORKBRANCH.md" <<'EOF_BRIEF'
# Login work

status: blocked

- [x] design
- [ ] waiting for credentials
EOF_BRIEF

  out=$(run_expect_success "$WORKBRANCH" list --json)
  printf '%s' "$out" | python3 -c 'import json,sys
login=json.load(sys.stdin)["tasks"][0]
assert login["memoTitle"] == "Login work", login
assert login["status"] == "blocked", login
assert login["progressDone"] == 1, login
assert login["progressTotal"] == 2, login
assert login["currentItem"] == "waiting for credentials", login'
}

test_list_json_plan_title() {
  new_fixture
  project="$FIXTURE_PROJECT"
  cd "$project" || return 1
  run_expect_success "$WORKBRANCH" init >/dev/null
  run_expect_success "$WORKBRANCH" add login >/dev/null
  cat > "$project/login/TASK-WORKBRANCH.md" <<'EOF_BRIEF'
# Authentication hardening slice
status: in-progress

- [x] inspect current auth flow
- [ ] implement session expiry guard
EOF_BRIEF

  out=$(run_expect_success "$WORKBRANCH" list --json)
  printf '%s' "$out" | python3 -c 'import json,sys
login=json.load(sys.stdin)["tasks"][0]
assert login["planTitle"] == "Authentication hardening slice", login
assert login["memoTitle"] == "Authentication hardening slice", login
assert login["currentItem"] == "implement session expiry guard", login'
}

test_list_json_plan_summary() {
  new_fixture
  project="$FIXTURE_PROJECT"
  cd "$project" || return 1
  run_expect_success "$WORKBRANCH" init >/dev/null
  run_expect_success "$WORKBRANCH" add login >/dev/null
  cat > "$project/login/TASK-WORKBRANCH.md" <<'EOF_BRIEF'
# Login hardening
status: in-progress

Tighten session expiry and audit logging

- [x] inspect current auth flow
- [ ] implement session expiry guard

Trailing note after checklist
EOF_BRIEF

  out=$(run_expect_success "$WORKBRANCH" list --json)
  printf '%s' "$out" | python3 -c 'import json,sys
login=json.load(sys.stdin)["tasks"][0]
plan=login["plans"][0]
assert plan["summary"] == "Tighten session expiry and audit logging", plan
assert plan["currentItem"] == "implement session expiry guard", plan'
}

test_list_json_plan_summary_absent_is_empty() {
  new_fixture
  project="$FIXTURE_PROJECT"
  cd "$project" || return 1
  run_expect_success "$WORKBRANCH" init >/dev/null
  run_expect_success "$WORKBRANCH" add login >/dev/null

  out=$(run_expect_success "$WORKBRANCH" list --json)
  printf '%s' "$out" | python3 -c 'import json,sys
login=json.load(sys.stdin)["tasks"][0]
plan=login["plans"][0]
assert plan["summary"] == "", plan'
}

test_list_json_plan_summary_requires_status_before_capture() {
  new_fixture
  project="$FIXTURE_PROJECT"
  cd "$project" || return 1
  run_expect_success "$WORKBRANCH" init >/dev/null
  run_expect_success "$WORKBRANCH" add login >/dev/null
  cat > "$project/login/TASK-WORKBRANCH.md" <<'EOF_BRIEF'
# Login hardening
Introductory context is not the current-work summary.

status: in-progress

Tighten session expiry and audit logging

- [ ] implement session expiry guard
EOF_BRIEF

  out=$(run_expect_success "$WORKBRANCH" list --json)
  printf '%s' "$out" | python3 -c 'import json,sys
plan=json.load(sys.stdin)["tasks"][0]["plans"][0]
assert plan["summary"] == "Tighten session expiry and audit logging", plan'
}

test_list_json_currentItem_escaped() {
  new_fixture
  project="$FIXTURE_PROJECT"
  cd "$project" || return 1
  run_expect_success "$WORKBRANCH" init >/dev/null
  run_expect_success "$WORKBRANCH" add login >/dev/null
  printf '# Login\n\n- [ ] quote " slash \\ bell \a\n' > "$project/login/TASK-WORKBRANCH.md"

  out=$(run_expect_success "$WORKBRANCH" list --json)
  printf '%s' "$out" | python3 -c 'import json,sys
login=json.load(sys.stdin)["tasks"][0]
expected = "quote \" slash \\ bell " + chr(7)
assert login["currentItem"] == expected, login' || return 1
  assert_contains "$out" "\\u0007"
}
test_list_json_legacy_memo_no_checkboxes() {
  new_fixture
  project="$FIXTURE_PROJECT"
  cd "$project" || return 1
  run_expect_success "$WORKBRANCH" init >/dev/null
  run_expect_success "$WORKBRANCH" add login >/dev/null
  cat > "$project/login/TASK-WORKBRANCH.md" <<'EOF_BRIEF'
# Legacy memo

## Current work
- plain bullet only
EOF_BRIEF

  out=$(run_expect_success "$WORKBRANCH" list --json)
  printf '%s' "$out" | python3 -c 'import json,sys
login=json.load(sys.stdin)["tasks"][0]
assert login["status"] == "todo", login
assert login["progressDone"] == 0, login
assert login["progressTotal"] == 0, login
assert login["currentItem"] == "", login'
}


test_list_json_includes_checklist_items_depth() {
  new_fixture
  project="$FIXTURE_PROJECT"
  cd "$project" || return 1
  run_expect_success "$WORKBRANCH" init >/dev/null
  run_expect_success "$WORKBRANCH" add login >/dev/null
  cat > "$project/login/TASK-WORKBRANCH.md" <<'EOF_BRIEF'
# Login work

status: in-progress

- [x] Major: design
  - [ ] API
    - [ ] edge case
EOF_BRIEF

  out=$(run_expect_success "$WORKBRANCH" list --json)
  printf '%s' "$out" | python3 -c 'import json,sys
d=json.load(sys.stdin)
assert d["schemaVersion"] == 1, d
login=d["tasks"][0]
assert login["items"] == [
  {"text":"Major: design","checked":True,"depth":0},
  {"text":"API","checked":False,"depth":1},
  {"text":"edge case","checked":False,"depth":2},
], login'
}

test_list_json_plan_sections_shape_and_aggregate() {
  new_fixture
  project="$FIXTURE_PROJECT"
  cd "$project" || return 1
  run_expect_success "$WORKBRANCH" init >/dev/null
  run_expect_success "$WORKBRANCH" add login >/dev/null
  cat > "$project/login/TASK-WORKBRANCH.md" <<'EOF_BRIEF'
# Backend
status: done
- [x] API contract
- [x] Mapper

# Frontend
- [x] Package sync
  - [x] Generated types
- [ ] Smoke test

## Notes
- [ ] this checkbox is a note, not a step
EOF_BRIEF

  out=$(run_expect_success "$WORKBRANCH" list --json)
  printf '%s' "$out" | python3 -c 'import json,sys
login=json.load(sys.stdin)["tasks"][0]
assert login["memoTitle"] == "Frontend", login
assert login["planTitle"] == "Frontend", login
assert login["status"] == "in-progress", login
assert login["progressDone"] == 2, login
assert login["progressTotal"] == 3, login
assert login["currentItem"] == "Smoke test", login
assert [item["text"] for item in login["items"]] == ["Package sync", "Generated types", "Smoke test"], login
assert len(login["plans"]) == 2, login
assert [(p["title"], p["index"], p["status"], p["progressDone"], p["progressTotal"], p["currentItem"]) for p in login["plans"]] == [
    ("Backend", 0, "done", 2, 2, ""),
    ("Frontend", 1, "in-progress", 2, 3, "Smoke test"),
], login
assert [item["text"] for item in login["plans"][1]["items"]] == ["Package sync", "Generated types", "Smoke test"], login'
}

test_list_json_implicit_and_empty_plans() {
  new_fixture
  project="$FIXTURE_PROJECT"
  cd "$project" || return 1
  run_expect_success "$WORKBRANCH" init >/dev/null
  run_expect_success "$WORKBRANCH" add login >/dev/null
  cat > "$project/login/TASK-WORKBRANCH.md" <<'EOF_BRIEF'
plan: Auth hardening

- [x] inspect
- [ ] implement
EOF_BRIEF

  out=$(run_expect_success "$WORKBRANCH" list --json)
  printf '%s' "$out" | python3 -c 'import json,sys
login=json.load(sys.stdin)["tasks"][0]
assert login["memoTitle"] == "", login
assert login["planTitle"] == "", login
assert login["plans"] == [], login
assert login["progressDone"] == 0 and login["progressTotal"] == 0, login
assert login["currentItem"] == "", login'

  cat > "$project/login/TASK-WORKBRANCH.md" <<'EOF_EMPTY'
# Empty work
status: review

## Notes
-
EOF_EMPTY
  out=$(run_expect_success "$WORKBRANCH" list --json)
  printf '%s' "$out" | python3 -c 'import json,sys
login=json.load(sys.stdin)["tasks"][0]
assert login["plans"] == [{"title":"Empty work","index":0,"status":"review","progressDone":0,"progressTotal":0,"currentItem":"","summary":"","items":[]}], login
assert login["progressDone"] == 0 and login["progressTotal"] == 0, login
assert login["status"] == "review", login
assert login["currentItem"] == "", login'
}

test_list_json_duplicate_plan_titles_keep_distinct_indexes() {
  new_fixture
  project="$FIXTURE_PROJECT"
  cd "$project" || return 1
  run_expect_success "$WORKBRANCH" init >/dev/null
  run_expect_success "$WORKBRANCH" add login >/dev/null
  cat > "$project/login/TASK-WORKBRANCH.md" <<'EOF_BRIEF'
# Review
status: done
- [x] first review

# Review
- [ ] second review
EOF_BRIEF

  out=$(run_expect_success "$WORKBRANCH" list --json)
  printf '%s' "$out" | python3 -c 'import json,sys
login=json.load(sys.stdin)["tasks"][0]
assert login["planTitle"] == "Review", login
assert [(p["title"], p["index"], p["status"], p["currentItem"]) for p in login["plans"]] == [("Review", 0, "done", ""), ("Review", 1, "todo", "second review")], login'
}

test_list_json_nested_headings_stay_inside_current_plan() {
  new_fixture
  project="$FIXTURE_PROJECT"
  cd "$project" || return 1
  run_expect_success "$WORKBRANCH" init >/dev/null
  run_expect_success "$WORKBRANCH" add login >/dev/null
  cat > "$project/login/TASK-WORKBRANCH.md" <<'EOF_BRIEF'
# Backend
- [x] contract

### Notes end plan
- [ ] not a step
EOF_BRIEF

  out=$(run_expect_success "$WORKBRANCH" list --json)
  printf '%s' "$out" | python3 -c 'import json,sys
login=json.load(sys.stdin)["tasks"][0]
assert login["progressDone"] == 1, login
assert login["progressTotal"] == 1, login
assert login["currentItem"] == "", login
assert len(login["plans"]) == 1, login
plan=login["plans"][0]
assert (plan["title"], plan["index"], plan["status"], plan["progressDone"], plan["progressTotal"], plan["currentItem"]) == ("Backend", 0, "done", 1, 1, ""), login
assert [item["text"] for item in plan["items"]] == ["contract"], login'
}


test_list_json_base_repos_shape() {
  new_fixture
  project="$FIXTURE_PROJECT"
  cd "$project" || return 1
  run_expect_success "$WORKBRANCH" init >/dev/null

  out=$(run_expect_success "$WORKBRANCH" list --json)
  printf '%s' "$out" | python3 -c 'import json, sys
d = json.load(sys.stdin)
assert [r["name"] for r in d["baseRepos"]] == ["frontend", "backend"], d
for repo in d["baseRepos"]:
    assert set(repo) == {"name", "baseBranch", "branch", "present", "dirty", "changedFiles", "remoteAvailable", "ahead", "behind"}, repo
    assert repo["baseBranch"] == "master", repo
    assert repo["branch"] == "master", repo
    assert repo["present"] is True, repo
    assert repo["dirty"] is False, repo
    assert repo["changedFiles"] == 0, repo
    assert repo["remoteAvailable"] is True, repo
    assert repo["ahead"] == 0, repo
    assert repo["behind"] == 0, repo'
}

test_list_json_base_repos_remote_diff_and_dirty() {
  new_fixture
  project="$FIXTURE_PROJECT"
  cd "$project" || return 1
  run_expect_success "$WORKBRANCH" init >/dev/null

  commit_to_remote_master frontend remote-frontend
  git -C "$project/_base/frontend" fetch origin >/dev/null 2>&1

  git -C "$project/_base/backend" config user.name "Workbranch Test"
  git -C "$project/_base/backend" config user.email "workbranch-test@example.com"
  printf '%s\n' "local backend" > "$project/_base/backend/local-backend.txt"
  git -C "$project/_base/backend" add local-backend.txt
  git -C "$project/_base/backend" commit -m "local backend" >/dev/null
  printf '%s\n' untracked > "$project/_base/backend/untracked.txt"

  out=$(run_expect_success "$WORKBRANCH" list --json)
  printf '%s' "$out" | python3 -c 'import json, sys
repos = {r["name"]: r for r in json.load(sys.stdin)["baseRepos"]}
frontend = repos["frontend"]
assert frontend["present"] is True, frontend
assert frontend["dirty"] is False, frontend
assert frontend["changedFiles"] == 0, frontend
assert frontend["remoteAvailable"] is True, frontend
assert frontend["behind"] == 1, frontend
assert frontend["ahead"] == 0, frontend
backend = repos["backend"]
assert backend["present"] is True, backend
assert backend["dirty"] is True, backend
assert backend["changedFiles"] == 1, backend
assert backend["remoteAvailable"] is True, backend
assert backend["ahead"] == 1, backend
assert backend["behind"] == 0, backend'
}

test_list_json_base_repos_missing_worktree_and_remote() {
  new_fixture
  project="$FIXTURE_PROJECT"
  cd "$project" || return 1
  run_expect_success "$WORKBRANCH" init >/dev/null

  rm -rf "$project/_base/frontend"
  git -C "$project/_base/backend" update-ref -d refs/remotes/origin/master

  out=$(run_expect_success "$WORKBRANCH" list --json)
  printf '%s' "$out" | python3 -c 'import json, sys
repos = {r["name"]: r for r in json.load(sys.stdin)["baseRepos"]}
frontend = repos["frontend"]
assert frontend["present"] is False, frontend
assert frontend["branch"] == "", frontend
assert frontend["dirty"] is False, frontend
assert frontend["changedFiles"] == 0, frontend
assert frontend["remoteAvailable"] is False, frontend
assert frontend["ahead"] == 0, frontend
assert frontend["behind"] == 0, frontend
backend = repos["backend"]
assert backend["present"] is True, backend
assert backend["remoteAvailable"] is False, backend
assert backend["ahead"] == 0, backend
assert backend["behind"] == 0, backend'
}


test_list_global_json_projects_and_errors() {
  new_fixture
  project="$FIXTURE_PROJECT"
  xdg="$TMP_ROOT/xdg"
  mkdir -p "$xdg/workbranch-companion"
  cd "$project" || return 1
  run_expect_success env XDG_CONFIG_HOME="$xdg" "$WORKBRANCH" init >/dev/null
  run_expect_success "$WORKBRANCH" add login >/dev/null
  printf '\n# manual note\n- /tmp/workbranch-missing-root\n' >> "$xdg/workbranch-companion/projects.md"

  out=$(cd "$TMP_ROOT" && run_expect_success env XDG_CONFIG_HOME="$xdg" "$WORKBRANCH" list --global --json)
  printf '%s' "$out" | python3 -c 'import json,sys,os
expected=os.path.realpath(sys.argv[1])
d=json.load(sys.stdin)
assert d["schemaVersion"] == 1, d
assert [p["root"] for p in d["projects"]] == [expected], d
assert d["projects"][0]["tasks"][0]["name"] == "login", d
assert d["errors"] and d["errors"][0]["root"] == "/tmp/workbranch-missing-root", d
assert "message" in d["errors"][0], d' "$project"
}


test_list_global_uses_stable_launcher_after_changing_directory() {
  new_fixture
  project="$FIXTURE_PROJECT"
  xdg="$TMP_ROOT/xdg"
  cd "$project" || return 1
  run_expect_success env XDG_CONFIG_HOME="$xdg" "$WORKBRANCH" init >/dev/null
  run_expect_success "$WORKBRANCH" add login >/dev/null

  out=$(cd "$REPO_ROOT" && run_expect_success env XDG_CONFIG_HOME="$xdg" "$WORKBRANCH" list --global --json)
  printf '%s' "$out" | python3 -c 'import json,sys,os
expected=os.path.realpath(sys.argv[1])
d=json.load(sys.stdin)
assert [p["root"] for p in d["projects"]] == [expected], d
assert d["projects"][0]["tasks"][0]["name"] == "login", d
assert d["errors"] == [], d' "$project"

  human=$(cd "$REPO_ROOT" && run_expect_success env XDG_CONFIG_HOME="$xdg" "$WORKBRANCH" list --global)
  assert_contains "$human" "Project: fullstack"
  assert_contains "$human" "login"
}


test_list_global_json_all_roots_failure_is_nonzero() {
  TMP_ROOT=$(mktemp -d 2>/dev/null || mktemp -d -t workbranch-test)
  xdg="$TMP_ROOT/xdg"
  mkdir -p "$xdg/workbranch-companion"
  cat > "$xdg/workbranch-companion/projects.md" <<'EOF_REGISTRY'
# workbranch companion projects

## projects
- /tmp/workbranch-missing-a
- /tmp/workbranch-missing-b
EOF_REGISTRY

  out=$(cd "$TMP_ROOT" && run_expect_fail env XDG_CONFIG_HOME="$xdg" "$WORKBRANCH" list --global --json)
  printf '%s' "$out" | python3 -c 'import json,sys
d=json.load(sys.stdin)
assert d["schemaVersion"] == 1, d
assert d["projects"] == [], d
assert len(d["errors"]) == 2, d'
}
