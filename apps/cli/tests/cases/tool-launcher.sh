# shellcheck shell=bash
# Sourced by tests/run.sh; uses helpers from tests/lib/helpers.sh.
append_fake_finder_scripts() {
  fake_bin=$1
  mkdir -p "$fake_bin"
  for launcher in open; do
    cat > "$fake_bin/$launcher" <<'SCRIPT'
#!/usr/bin/env sh
set -eu
printf '%s|%s\n' "$PWD" "$*" >> "$WORKBRANCH_FAKE_TOOL_LOG"
SCRIPT
    chmod +x "$fake_bin/$launcher"
  done
}

test_ide_and_terminal_run_configured_command_for_task_repos() {
  new_fixture
  project="$FIXTURE_PROJECT"
  cd "$project" || return 1
  canonical_project=$(pwd -P)
  fake_tool="$TMP_ROOT/fake-tool.sh"
  append_fake_tool_script "$fake_tool"
  export WORKBRANCH_FAKE_TOOL_LOG="$TMP_ROOT/tool.log"

  cat >> "$project/.workbranch.config" <<CONFIG
IDE $fake_tool
TERMINAL $fake_tool
CONFIG

  run_expect_success "$WORKBRANCH" init >/dev/null
  printf '

' | run_expect_success "$WORKBRANCH" add login >/dev/null

  out=$(WORKBRANCH_TEST_PLATFORM=macos run_expect_success "$WORKBRANCH" ide login --repo frontend)
  assert_contains "$out" "[*] Opening IDE: login/frontend"
  assert_contains "$(cat "$WORKBRANCH_FAKE_TOOL_LOG")" "$canonical_project/login/frontend|$canonical_project/login/frontend"

  : > "$WORKBRANCH_FAKE_TOOL_LOG"
  out=$(WORKBRANCH_TEST_PLATFORM=macos run_expect_success "$WORKBRANCH" terminal login)
  assert_contains "$out" "[*] Opening terminal: login"
  assert_not_contains "$out" "[*] Opening terminal: login/frontend"
  assert_not_contains "$out" "[*] Opening terminal: login/backend"
  log=$(cat "$WORKBRANCH_FAKE_TOOL_LOG")
  assert_contains "$log" "$canonical_project/login|$canonical_project/login"
  assert_not_contains "$log" "$canonical_project/login/frontend|$canonical_project/login/frontend"
  assert_not_contains "$log" "$canonical_project/login/backend|$canonical_project/login/backend"
}


test_terminal_opens_task_root_without_repo_filter() {
  new_fixture
  project="$FIXTURE_PROJECT"
  cd "$project" || return 1
  canonical_project=$(pwd -P)
  fake_tool="$TMP_ROOT/fake-tool.sh"
  append_fake_tool_script "$fake_tool"
  export WORKBRANCH_FAKE_TOOL_LOG="$TMP_ROOT/terminal.log"

  cat >> "$project/.workbranch.config" <<CONFIG
TERMINAL $fake_tool
CONFIG

  run_expect_success "$WORKBRANCH" init >/dev/null
  printf '

' | run_expect_success "$WORKBRANCH" add login >/dev/null

  out=$(WORKBRANCH_TEST_PLATFORM=macos run_expect_success "$WORKBRANCH" terminal login)
  assert_contains "$out" "[*] Opening terminal: login"
  log=$(cat "$WORKBRANCH_FAKE_TOOL_LOG")
  assert_contains "$log" "$canonical_project/login|$canonical_project/login"
  assert_not_contains "$log" "$canonical_project/login/frontend"
  assert_not_contains "$log" "$canonical_project/login/backend"
}


test_ide_vscode_family_preset_falls_back_to_open_when_bundled_cli_missing() {
  new_fixture
  project="$FIXTURE_PROJECT"
  cd "$project" || return 1
  canonical_project=$(pwd -P)
  fake_bin="$TMP_ROOT/bin"
  mkdir -p "$fake_bin"
  cat > "$fake_bin/open" <<'SCRIPT'
#!/usr/bin/env sh
set -eu
printf '%s|%s\n' "$PWD" "$*" >> "$WORKBRANCH_FAKE_TOOL_LOG"
SCRIPT
  chmod +x "$fake_bin/open"
  export WORKBRANCH_FAKE_TOOL_LOG="$TMP_ROOT/open.log"

  cat >> "$project/.workbranch.config" <<'CONFIG'
IDE open -a "Visual Studio Code"
CONFIG

  run_expect_success "$WORKBRANCH" init >/dev/null
  printf '\n\n' | run_expect_success "$WORKBRANCH" add login >/dev/null

  mkdir -p "$TMP_ROOT/apps"
  PATH="$fake_bin:$PATH" WORKBRANCH_TEST_APPLICATIONS_DIR="$TMP_ROOT/apps" WORKBRANCH_TEST_PLATFORM=macos run_expect_success "$WORKBRANCH" ide login >/dev/null
  log=$(cat "$WORKBRANCH_FAKE_TOOL_LOG")
  assert_contains "$log" "$canonical_project/login/frontend|-na Visual Studio Code --args --new-window $canonical_project/login/frontend"
  assert_contains "$log" "$canonical_project/login/backend|-na Visual Studio Code --args --new-window $canonical_project/login/backend"
  assert_not_contains "$log" "|-a Visual Studio Code"
  assert_not_contains "$log" "|-na Visual Studio Code $canonical_project"
}

test_tool_launcher_forced_color_highlights_tool_and_target_path() {
  new_fixture
  project="$FIXTURE_PROJECT"
  cd "$project" || return 1
  fake_tool="$TMP_ROOT/fake-tool.sh"
  append_fake_tool_script "$fake_tool"
  export WORKBRANCH_FAKE_TOOL_LOG="$TMP_ROOT/tool.log"

  cat >> "$project/.workbranch.config" <<CONFIG
IDE $fake_tool
TERMINAL $fake_tool
CONFIG

  run_expect_success "$WORKBRANCH" init >/dev/null
  printf '\n\n' | run_expect_success "$WORKBRANCH" add login >/dev/null

  out=$(env -u NO_COLOR WORKBRANCH_COLOR=always WORKBRANCH_TEST_PLATFORM=macos "$WORKBRANCH" ide login --repo frontend 2>&1)
  assert_contains "$out" $'\033[0;35mIDE\033[0m'
  assert_contains "$out" $'\033[0;36mlogin/frontend\033[0m'

  out=$(env -u NO_COLOR WORKBRANCH_COLOR=always WORKBRANCH_TEST_PLATFORM=macos "$WORKBRANCH" terminal login --repo backend 2>&1)
  assert_contains "$out" $'\033[0;35mterminal\033[0m'
  assert_contains "$out" $'\033[0;36mlogin/backend\033[0m'
}

test_tool_commands_require_configured_command() {
  new_fixture
  project="$FIXTURE_PROJECT"
  cd "$project" || return 1
  run_expect_success "$WORKBRANCH" init >/dev/null
  printf '

' | run_expect_success "$WORKBRANCH" add login >/dev/null

  out=$(WORKBRANCH_TEST_PLATFORM=macos run_expect_fail "$WORKBRANCH" ide login)
  assert_contains "$out" "ide command is not configured; run workbranch config ide"

  out=$(WORKBRANCH_TEST_PLATFORM=macos run_expect_fail "$WORKBRANCH" terminal login --repo frontend)
  assert_contains "$out" "terminal command is not configured; run workbranch config terminal"
}

test_tool_launcher_reports_missing_task_repo_before_running_command() {
  new_fixture
  project="$FIXTURE_PROJECT"
  cd "$project" || return 1
  fake_tool="$TMP_ROOT/fake-tool.sh"
  append_fake_tool_script "$fake_tool"
  export WORKBRANCH_FAKE_TOOL_LOG="$TMP_ROOT/tool.log"

  cat >> "$project/.workbranch.config" <<CONFIG
IDE $fake_tool
CONFIG

  run_expect_success "$WORKBRANCH" init >/dev/null
  printf '

' | run_expect_success "$WORKBRANCH" add login >/dev/null
  rm -rf "$project/login/frontend"

  out=$(WORKBRANCH_TEST_PLATFORM=macos run_expect_fail "$WORKBRANCH" ide login --repo frontend)
  assert_contains "$out" "task repo not found: login/frontend"
  assert_not_exists "$WORKBRANCH_FAKE_TOOL_LOG"
}



test_finder_opens_task_root_without_repo_filter() {
  new_fixture
  project="$FIXTURE_PROJECT"
  cd "$project" || return 1
  canonical_project=$(pwd -P)
  fake_bin="$TMP_ROOT/bin"
  append_fake_finder_scripts "$fake_bin"
  export WORKBRANCH_FAKE_TOOL_LOG="$TMP_ROOT/finder.log"

  run_expect_success "$WORKBRANCH" init >/dev/null
  printf '\n\n' | run_expect_success "$WORKBRANCH" add login >/dev/null

  out=$(PATH="$fake_bin:$PATH" WORKBRANCH_TEST_PLATFORM=macos run_expect_success "$WORKBRANCH" finder login)
  assert_contains "$out" "[*] Opening Finder: login"
  assert_contains "$(cat "$WORKBRANCH_FAKE_TOOL_LOG")" "$canonical_project/login|$canonical_project/login"
  assert_not_contains "$(cat "$WORKBRANCH_FAKE_TOOL_LOG")" "$canonical_project/login/frontend"
  assert_not_contains "$(cat "$WORKBRANCH_FAKE_TOOL_LOG")" "$canonical_project/login/backend"
}

test_finder_repo_filter_opens_one_repo_path() {
  new_fixture
  project="$FIXTURE_PROJECT"
  cd "$project" || return 1
  canonical_project=$(pwd -P)
  fake_bin="$TMP_ROOT/bin"
  append_fake_finder_scripts "$fake_bin"
  export WORKBRANCH_FAKE_TOOL_LOG="$TMP_ROOT/finder.log"

  run_expect_success "$WORKBRANCH" init >/dev/null
  printf '\n\n' | run_expect_success "$WORKBRANCH" add login >/dev/null

  out=$(PATH="$fake_bin:$PATH" WORKBRANCH_TEST_PLATFORM=macos run_expect_success "$WORKBRANCH" finder login --repo frontend)
  assert_contains "$out" "[*] Opening Finder: login/frontend"
  assert_contains "$(cat "$WORKBRANCH_FAKE_TOOL_LOG")" "$canonical_project/login/frontend|$canonical_project/login/frontend"
  assert_not_contains "$(cat "$WORKBRANCH_FAKE_TOOL_LOG")" "$canonical_project/login/backend"
}


test_tool_app_commands_are_macos_only() {
  out=$(WORKBRANCH_TEST_PLATFORM=linux run_expect_fail "$WORKBRANCH" finder login)
  assert_contains "$out" "workbranch finder is only supported on macOS; core workbranch commands support macOS, Linux, and WSL"
  assert_not_contains "$out" "no enclosing workbranch project found"

  out=$(WORKBRANCH_TEST_PLATFORM=other run_expect_fail "$WORKBRANCH" finder login)
  assert_contains "$out" "workbranch finder is only supported on macOS; core workbranch commands support macOS, Linux, and WSL"
  assert_not_contains "$out" "unsupported platform: other"

  out=$(WORKBRANCH_TEST_PLATFORM=wsl run_expect_fail "$WORKBRANCH" ide login)
  assert_contains "$out" "workbranch ide is only supported on macOS; core workbranch commands support macOS, Linux, and WSL"
  assert_not_contains "$out" "no enclosing workbranch project found"

  out=$(WORKBRANCH_TEST_PLATFORM=linux run_expect_fail "$WORKBRANCH" terminal login)
  assert_contains "$out" "workbranch terminal is only supported on macOS; core workbranch commands support macOS, Linux, and WSL"
  assert_not_contains "$out" "no enclosing workbranch project found"
}

# Launcher fakes log "$PWD|$#|$*": the argument count exposes word splitting that
# a joined "$*" would hide (e.g. an unquoted "Visual Studio Code.app" path).
append_fake_launcher_open_script() {
  fake_bin=$1
  mkdir -p "$fake_bin"
  cat > "$fake_bin/open" <<'SCRIPT'
#!/usr/bin/env sh
set -eu
printf '%s|%s|%s\n' "$PWD" "$#" "$*" >> "$WORKBRANCH_FAKE_TOOL_LOG"
SCRIPT
  chmod +x "$fake_bin/open"
}

# Creates a fake VS Code-family app bundle whose CLI script logs "$PWD|$#|$*".
append_fake_ide_bundle_cli() {
  apps_root=$1
  bundle_cli_relative=$2
  mkdir -p "$(dirname "$apps_root/$bundle_cli_relative")"
  cat > "$apps_root/$bundle_cli_relative" <<'SCRIPT'
#!/usr/bin/env sh
set -eu
printf '%s|%s|%s\n' "$PWD" "$#" "$*" >> "$WORKBRANCH_FAKE_TOOL_LOG"
SCRIPT
  chmod +x "$apps_root/$bundle_cli_relative"
}

# Fake `lsappinfo`: records its arguments in WORKBRANCH_FAKE_LSAPPINFO_LOG when set.
# - `find bundlepath=...` reports a running app only when WORKBRANCH_FAKE_IDE_RUNNING=1.
# - `front` / `info -only bundlepath <asn>` report the IDE bundle (WORKBRANCH_FAKE_IDE_BUNDLE) as
#   frontmost except for the first WORKBRANCH_FAKE_IDE_NOT_FRONT_CALLS (default 1) `front` calls,
#   which report an unrelated caller app; `front` calls are counted in WORKBRANCH_FAKE_LSAPPINFO_STATE.
append_fake_lsappinfo_script() {
  fake_bin=$1
  mkdir -p "$fake_bin"
  cat > "$fake_bin/lsappinfo" <<'SCRIPT'
#!/usr/bin/env sh
set -eu
[ -z "${WORKBRANCH_FAKE_LSAPPINFO_LOG:-}" ] || printf '%s\n' "$*" >> "$WORKBRANCH_FAKE_LSAPPINFO_LOG"
case "$1" in
  find)
    if [ "${WORKBRANCH_FAKE_IDE_RUNNING:-0}" = "1" ]; then
      printf 'ASN:0x0-0x1-"Fake_IDE":\n'
    fi
    ;;
  front)
    front_calls=0
    [ ! -f "${WORKBRANCH_FAKE_LSAPPINFO_STATE:?}" ] || front_calls=$(cat "$WORKBRANCH_FAKE_LSAPPINFO_STATE")
    front_calls=$((front_calls + 1))
    printf '%s' "$front_calls" > "$WORKBRANCH_FAKE_LSAPPINFO_STATE"
    if [ "$front_calls" -le "${WORKBRANCH_FAKE_IDE_NOT_FRONT_CALLS:-1}" ]; then
      printf 'ASN:0x0-0xca11e7:\n'
    else
      printf 'ASN:0x0-0x1:\n'
    fi
    ;;
  info)
    # Invoked as `lsappinfo info -only bundlepath <asn>`; the ASN is the fourth argument.
    case "$4" in
      ASN:0x0-0x1:) printf '"LSBundlePath"="%s"\n' "${WORKBRANCH_FAKE_IDE_BUNDLE:?}" ;;
      *) printf '"LSBundlePath"="/Applications/Caller.app"\n' ;;
    esac
    ;;
esac
SCRIPT
  chmod +x "$fake_bin/lsappinfo"
}

# Fake `ps -axo command=`: counts calls in WORKBRANCH_FAKE_PS_COUNTER and shows the bundle's
# (WORKBRANCH_FAKE_IDE_BUNDLE) main process plus a CLI helper instance for the first two calls,
# then only the main process.
append_fake_ps_script() {
  fake_bin=$1
  mkdir -p "$fake_bin"
  cat > "$fake_bin/ps" <<'SCRIPT'
#!/usr/bin/env sh
set -eu
calls=0
[ ! -f "$WORKBRANCH_FAKE_PS_COUNTER" ] || calls=$(cat "$WORKBRANCH_FAKE_PS_COUNTER")
calls=$((calls + 1))
printf '%s' "$calls" > "$WORKBRANCH_FAKE_PS_COUNTER"
printf '%s\n' "$WORKBRANCH_FAKE_IDE_BUNDLE/Contents/MacOS/Electron --new-window /somewhere/else"
if [ "$calls" -le 2 ]; then
  printf '%s\n' "$WORKBRANCH_FAKE_IDE_BUNDLE/Contents/MacOS/Electron /handoff/helper"
fi
printf '%s\n' "$WORKBRANCH_FAKE_IDE_BUNDLE/Contents/Frameworks/Helper.app/Contents/MacOS/Helper --type=renderer"
SCRIPT
  chmod +x "$fake_bin/ps"
}

test_ide_vscode_family_preset_prefers_bundled_cli_when_installed() {
  new_fixture
  project="$FIXTURE_PROJECT"
  cd "$project" || return 1
  canonical_project=$(pwd -P)
  fake_bin="$TMP_ROOT/bin"
  append_fake_launcher_open_script "$fake_bin"
  append_fake_lsappinfo_script "$fake_bin"
  apps_root="$TMP_ROOT/apps"
  append_fake_ide_bundle_cli "$apps_root" "Visual Studio Code.app/Contents/Resources/app/bin/code"
  export WORKBRANCH_FAKE_TOOL_LOG="$TMP_ROOT/ide.log"

  cat >> "$project/.workbranch.config" <<'CONFIG'
IDE open -na "Visual Studio Code" --args --new-window
CONFIG

  run_expect_success "$WORKBRANCH" init >/dev/null
  printf '\n\n' | run_expect_success "$WORKBRANCH" add login >/dev/null

  out=$(PATH="$fake_bin:$PATH" WORKBRANCH_TEST_APPLICATIONS_DIR="$apps_root" WORKBRANCH_TEST_PLATFORM=macos run_expect_success "$WORKBRANCH" ide login)
  assert_contains "$out" "[*] Opening IDE: login/frontend"
  assert_contains "$out" "[*] Opening IDE: login/backend"
  log=$(cat "$WORKBRANCH_FAKE_TOOL_LOG")
  assert_contains "$log" "$canonical_project/login/frontend|2|--new-window $canonical_project/login/frontend"
  assert_contains "$log" "$canonical_project/login/backend|2|--new-window $canonical_project/login/backend"
  assert_not_contains "$log" "-na Visual Studio Code"
}

test_ide_legacy_app_shape_uses_bundled_cli_after_normalization() {
  new_fixture
  project="$FIXTURE_PROJECT"
  cd "$project" || return 1
  canonical_project=$(pwd -P)
  fake_bin="$TMP_ROOT/bin"
  append_fake_launcher_open_script "$fake_bin"
  append_fake_lsappinfo_script "$fake_bin"
  apps_root="$TMP_ROOT/apps"
  append_fake_ide_bundle_cli "$apps_root" "Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide"
  export WORKBRANCH_FAKE_TOOL_LOG="$TMP_ROOT/ide.log"

  cat >> "$project/.workbranch.config" <<'CONFIG'
IDE open -a "Antigravity IDE"
CONFIG

  run_expect_success "$WORKBRANCH" init >/dev/null
  printf '\n\n' | run_expect_success "$WORKBRANCH" add login >/dev/null

  PATH="$fake_bin:$PATH" WORKBRANCH_TEST_APPLICATIONS_DIR="$apps_root" WORKBRANCH_TEST_PLATFORM=macos run_expect_success "$WORKBRANCH" ide login --repo frontend >/dev/null
  log=$(cat "$WORKBRANCH_FAKE_TOOL_LOG")
  assert_contains "$log" "$canonical_project/login/frontend|2|--new-window $canonical_project/login/frontend"
  assert_not_contains "$log" "$canonical_project/login/backend"
  assert_not_contains "$log" "-na Antigravity IDE"
}

test_ide_bundled_cli_activates_running_app_after_focusing_repo() {
  new_fixture
  project="$FIXTURE_PROJECT"
  cd "$project" || return 1
  canonical_project=$(pwd -P)
  fake_bin="$TMP_ROOT/bin"
  append_fake_launcher_open_script "$fake_bin"
  append_fake_lsappinfo_script "$fake_bin"
  apps_root="$TMP_ROOT/apps"
  append_fake_ide_bundle_cli "$apps_root" "Visual Studio Code.app/Contents/Resources/app/bin/code"
  export WORKBRANCH_FAKE_TOOL_LOG="$TMP_ROOT/ide.log"

  cat >> "$project/.workbranch.config" <<'CONFIG'
IDE open -na "Visual Studio Code" --args --new-window
CONFIG

  run_expect_success "$WORKBRANCH" init >/dev/null
  printf '\n\n' | run_expect_success "$WORKBRANCH" add login >/dev/null

  append_fake_ps_script "$fake_bin"
  PATH="$fake_bin:$PATH" WORKBRANCH_FAKE_IDE_RUNNING=1 WORKBRANCH_FAKE_LSAPPINFO_LOG="$TMP_ROOT/lsappinfo.log" \
    WORKBRANCH_FAKE_LSAPPINFO_STATE="$TMP_ROOT/lsappinfo.front" WORKBRANCH_FAKE_IDE_BUNDLE="$apps_root/Visual Studio Code.app" \
    WORKBRANCH_FAKE_PS_COUNTER="$TMP_ROOT/ps.calls" \
    WORKBRANCH_TEST_APPLICATIONS_DIR="$apps_root" WORKBRANCH_TEST_PLATFORM=macos run_expect_success "$WORKBRANCH" ide login --repo frontend >/dev/null
  first_call=$(sed -n 1p "$WORKBRANCH_FAKE_TOOL_LOG")
  second_call=$(sed -n 2p "$WORKBRANCH_FAKE_TOOL_LOG")
  # The bundled CLI focuses the repo window through a short-lived helper instance whose exit hands
  # macOS focus back to the caller, so the running app is activated through LaunchServices afterwards.
  expected_cli_call="$canonical_project/login/frontend|2|--new-window $canonical_project/login/frontend"
  expected_open_call="$canonical_project/login/frontend|2|-a $apps_root/Visual Studio Code.app"
  [ "$first_call" = "$expected_cli_call" ] || fail "expected first launcher call '$expected_cli_call'; got: $first_call"
  [ "$second_call" = "$expected_open_call" ] || fail "expected second launcher call '$expected_open_call'; got: $second_call"
  # The fake reports the IDE frontmost after the first activation, so the follow-up checks must not re-activate.
  [ "$(wc -l < "$WORKBRANCH_FAKE_TOOL_LOG" | tr -d ' ')" = "2" ] || fail "expected exactly two launcher calls; got: $(cat "$WORKBRANCH_FAKE_TOOL_LOG")"
  lsappinfo_log=$(cat "$TMP_ROOT/lsappinfo.log")
  assert_contains "$lsappinfo_log" "find bundlepath=$apps_root/Visual Studio Code.app"
  assert_contains "$lsappinfo_log" "info -only bundlepath ASN:0x0-0xca11e7:"
  [ "$(cat "$TMP_ROOT/lsappinfo.front")" = "4" ] || fail "expected 4 frontmost checks; got: $(cat "$TMP_ROOT/lsappinfo.front" 2>/dev/null)"
  # The fake ps shows the helper for two polls, so the wait must have polled a third time before activating.
  [ "$(cat "$TMP_ROOT/ps.calls")" = "3" ] || fail "expected the handoff wait to poll ps 3 times; got: $(cat "$TMP_ROOT/ps.calls" 2>/dev/null)"
}

test_ide_bundled_cli_reactivates_when_focus_returns_to_caller() {
  new_fixture
  project="$FIXTURE_PROJECT"
  cd "$project" || return 1
  canonical_project=$(pwd -P)
  fake_bin="$TMP_ROOT/bin"
  append_fake_launcher_open_script "$fake_bin"
  append_fake_lsappinfo_script "$fake_bin"
  append_fake_ps_script "$fake_bin"
  apps_root="$TMP_ROOT/apps"
  append_fake_ide_bundle_cli "$apps_root" "Visual Studio Code.app/Contents/Resources/app/bin/code"
  export WORKBRANCH_FAKE_TOOL_LOG="$TMP_ROOT/ide.log"

  cat >> "$project/.workbranch.config" <<'CONFIG'
IDE open -na "Visual Studio Code" --args --new-window
CONFIG

  run_expect_success "$WORKBRANCH" init >/dev/null
  printf '\n\n' | run_expect_success "$WORKBRANCH" add login >/dev/null

  # macOS can hand focus back to the caller shortly after the helper exits; the fake reports the
  # caller frontmost for the first two checks, so the launcher must activate the IDE twice.
  PATH="$fake_bin:$PATH" WORKBRANCH_FAKE_IDE_RUNNING=1 WORKBRANCH_FAKE_IDE_NOT_FRONT_CALLS=2 \
    WORKBRANCH_FAKE_LSAPPINFO_STATE="$TMP_ROOT/lsappinfo.front" WORKBRANCH_FAKE_IDE_BUNDLE="$apps_root/Visual Studio Code.app" \
    WORKBRANCH_FAKE_PS_COUNTER="$TMP_ROOT/ps.calls" \
    WORKBRANCH_TEST_APPLICATIONS_DIR="$apps_root" WORKBRANCH_TEST_PLATFORM=macos run_expect_success "$WORKBRANCH" ide login --repo frontend >/dev/null
  expected_open_call="$canonical_project/login/frontend|2|-a $apps_root/Visual Studio Code.app"
  [ "$(sed -n 2p "$WORKBRANCH_FAKE_TOOL_LOG")" = "$expected_open_call" ] || fail "expected second launcher call '$expected_open_call'; got: $(sed -n 2p "$WORKBRANCH_FAKE_TOOL_LOG")"
  [ "$(sed -n 3p "$WORKBRANCH_FAKE_TOOL_LOG")" = "$expected_open_call" ] || fail "expected a repeated activation '$expected_open_call'; got: $(sed -n 3p "$WORKBRANCH_FAKE_TOOL_LOG")"
  [ "$(wc -l < "$WORKBRANCH_FAKE_TOOL_LOG" | tr -d ' ')" = "3" ] || fail "expected exactly three launcher calls; got: $(cat "$WORKBRANCH_FAKE_TOOL_LOG")"
}

test_ide_bundled_cli_skips_activation_when_app_not_running() {
  new_fixture
  project="$FIXTURE_PROJECT"
  cd "$project" || return 1
  canonical_project=$(pwd -P)
  fake_bin="$TMP_ROOT/bin"
  append_fake_launcher_open_script "$fake_bin"
  append_fake_lsappinfo_script "$fake_bin"
  apps_root="$TMP_ROOT/apps"
  append_fake_ide_bundle_cli "$apps_root" "Visual Studio Code.app/Contents/Resources/app/bin/code"
  export WORKBRANCH_FAKE_TOOL_LOG="$TMP_ROOT/ide.log"

  cat >> "$project/.workbranch.config" <<'CONFIG'
IDE open -na "Visual Studio Code" --args --new-window
CONFIG

  run_expect_success "$WORKBRANCH" init >/dev/null
  printf '\n\n' | run_expect_success "$WORKBRANCH" add login >/dev/null

  append_fake_ps_script "$fake_bin"
  PATH="$fake_bin:$PATH" WORKBRANCH_FAKE_IDE_RUNNING=0 WORKBRANCH_FAKE_LSAPPINFO_LOG="$TMP_ROOT/lsappinfo.log" \
    WORKBRANCH_FAKE_LSAPPINFO_STATE="$TMP_ROOT/lsappinfo.front" WORKBRANCH_FAKE_IDE_BUNDLE="$apps_root/Visual Studio Code.app" \
    WORKBRANCH_FAKE_PS_COUNTER="$TMP_ROOT/ps.calls" \
    WORKBRANCH_TEST_APPLICATIONS_DIR="$apps_root" WORKBRANCH_TEST_PLATFORM=macos run_expect_success "$WORKBRANCH" ide login --repo frontend >/dev/null
  log=$(cat "$WORKBRANCH_FAKE_TOOL_LOG")
  # A fresh launch through the bundled CLI already brings the IDE forward; a bare `open -a` around it
  # could restore the previous session's windows instead of opening only the requested repo.
  expected_cli_call="$canonical_project/login/frontend|2|--new-window $canonical_project/login/frontend"
  [ "$log" = "$expected_cli_call" ] || fail "expected only the launcher call '$expected_cli_call'; got: $log"
  assert_not_exists "$TMP_ROOT/ps.calls"
  assert_not_exists "$TMP_ROOT/lsappinfo.front"
}

test_ide_non_vscode_family_preset_keeps_configured_open_command() {
  new_fixture
  project="$FIXTURE_PROJECT"
  cd "$project" || return 1
  canonical_project=$(pwd -P)
  fake_bin="$TMP_ROOT/bin"
  append_fake_launcher_open_script "$fake_bin"
  append_fake_lsappinfo_script "$fake_bin"
  apps_root="$TMP_ROOT/apps"
  append_fake_ide_bundle_cli "$apps_root" "Zed.app/Contents/Resources/app/bin/zed"
  export WORKBRANCH_FAKE_TOOL_LOG="$TMP_ROOT/ide.log"

  cat >> "$project/.workbranch.config" <<'CONFIG'
IDE open -na Zed
CONFIG

  run_expect_success "$WORKBRANCH" init >/dev/null
  printf '\n\n' | run_expect_success "$WORKBRANCH" add login >/dev/null

  PATH="$fake_bin:$PATH" WORKBRANCH_FAKE_IDE_RUNNING=1 WORKBRANCH_TEST_APPLICATIONS_DIR="$apps_root" WORKBRANCH_TEST_PLATFORM=macos run_expect_success "$WORKBRANCH" ide login --repo frontend >/dev/null
  log=$(cat "$WORKBRANCH_FAKE_TOOL_LOG")
  # Zed, Sublime Text, and Xcode presets are outside the VS Code-family rule and keep the configured command.
  expected_open_call="$canonical_project/login/frontend|3|-na Zed $canonical_project/login/frontend"
  [ "$log" = "$expected_open_call" ] || fail "expected only the configured open command '$expected_open_call'; got: $log"
}
