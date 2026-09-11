print_tool_preset() {
  number=$1
  name=$2
  command=$3
  if color_stderr_enabled; then
    printf '    %s) %s%s%s (%s)\n' "$number" "$WB_ERR_CYAN" "$name" "$WB_ERR_RESET" "$command" >&2
  else
    printf '    %s) %s (%s)\n' "$number" "$name" "$command" >&2
  fi
}

print_ide_presets() {
  info "IDE command:"
  print_tool_preset 1 "Cursor" 'open -na Cursor --args --new-window'
  print_tool_preset 2 "Antigravity" 'open -na "Antigravity IDE" --args --new-window'
  print_tool_preset 3 "Windsurf" 'open -na Windsurf --args --new-window'
  print_tool_preset 4 "Zed" 'open -na Zed'
  print_tool_preset 5 "Sublime Text" 'open -na "Sublime Text"'
  print_tool_preset 6 "Xcode" 'open -na Xcode'
  print_tool_preset 7 "VS Code" 'open -na "Visual Studio Code" --args --new-window'
  printf '    8) Custom command\n' >&2
  printf '    9) Clear\n' >&2
}

ide_preset_command() {
  case "$1" in
    1) printf '%s' 'open -na Cursor --args --new-window' ;;
    2) printf '%s' 'open -na "Antigravity IDE" --args --new-window' ;;
    3) printf '%s' 'open -na Windsurf --args --new-window' ;;
    4) printf '%s' 'open -na Zed' ;;
    5) printf '%s' 'open -na "Sublime Text"' ;;
    6) printf '%s' 'open -na Xcode' ;;
    7) printf '%s' 'open -na "Visual Studio Code" --args --new-window' ;;
    *) return 1 ;;
  esac
}

print_terminal_presets() {
  info "Terminal command:"
  print_tool_preset 1 "iTerm" 'open -a iTerm'
  print_tool_preset 2 "Warp" 'open -a Warp'
  print_tool_preset 3 "Terminal.app" 'open -a Terminal'
  print_tool_preset 4 "Ghostty" 'open -a Ghostty'
  printf '    5) Custom command\n' >&2
  printf '    6) Clear\n' >&2
}

terminal_preset_command() {
  case "$1" in
    1) printf '%s' 'open -a iTerm' ;;
    2) printf '%s' 'open -a Warp' ;;
    3) printf '%s' 'open -a Terminal' ;;
    4) printf '%s' 'open -a Ghostty' ;;
    *) return 1 ;;
  esac
}

canonical_path() {
  path=$1
  (cd "$path" 2>/dev/null && pwd -P) || return 1
}

resolve_task_path() {
  task=$1
  task_dir="$PROJECT_ROOT/$task"
  is_task_workspace_path "$task_dir" || die "task workspace not found: $task"
  RESOLVED_PATH=$(canonical_path "$task_dir") || die "task workspace not found: $task"
}

resolve_task_repo_path() {
  task=$1
  repo=$2
  task_dir="$PROJECT_ROOT/$task"
  [ -d "$task_dir" ] || die "task workspace not found: $task"
  repo_path=$(task_repo_path "$task" "$repo")
  [ -d "$repo_path" ] || die "task repo not found: $task/$repo"
  is_registered_worktree_path "$repo_path" "$(base_repo_path "$repo")" \
    || die "task repo not found or not a registered worktree: $task/$repo"
  is_task_workspace_path "$task_dir" || die "task workspace not found: $task"
  RESOLVED_PATH=$(canonical_path "$repo_path") || die "task repo not found: $task/$repo"
}

ide_application_roots() {
  if [ -n "${WORKBRANCH_TEST_APPLICATIONS_DIR:-}" ]; then
    printf '%s\n' "$WORKBRANCH_TEST_APPLICATIONS_DIR"
    return 0
  fi
  printf '%s\n' "/Applications"
  [ -z "${HOME:-}" ] || printf '%s\n' "$HOME/Applications"
}

# Bundled CLI path (relative to an Applications directory) for VS Code-family IDE
# presets. `open -na <App> --args ...` launches a throwaway instance that hands the
# path to the running IDE and quits, which leaves macOS focus on the caller; the
# bundled CLI hands the path over directly, so an already-open repo window is
# focused, and run_ide_bundled_cli then brings the IDE to the front.
ide_bundled_cli_relative_path() {
  case "$1" in
    'open -na "Visual Studio Code" --args --new-window') printf '%s' 'Visual Studio Code.app/Contents/Resources/app/bin/code' ;;
    'open -na Cursor --args --new-window'|'open -na "Cursor" --args --new-window') printf '%s' 'Cursor.app/Contents/Resources/app/bin/cursor' ;;
    'open -na "Antigravity IDE" --args --new-window') printf '%s' 'Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide' ;;
    'open -na Windsurf --args --new-window'|'open -na "Windsurf" --args --new-window') printf '%s' 'Windsurf.app/Contents/Resources/app/bin/windsurf' ;;
    *) return 1 ;;
  esac
}

resolve_ide_bundled_cli() {
  bundled_cli_relative=$(ide_bundled_cli_relative_path "$1") || return 1
  while IFS= read -r applications_root; do
    [ -n "$applications_root" ] || continue
    bundled_cli="$applications_root/$bundled_cli_relative"
    if [ -x "$bundled_cli" ]; then
      printf '%s' "$bundled_cli"
      return 0
    fi
  done <<EOF
$(ide_application_roots)
EOF
  return 1
}

ide_app_is_running() {
  bundle_path=$1
  command -v lsappinfo >/dev/null 2>&1 || return 1
  [ -n "$(lsappinfo find "bundlepath=$bundle_path" 2>/dev/null)" ]
}

ide_app_is_frontmost() {
  bundle_path=$1
  command -v lsappinfo >/dev/null 2>&1 || return 1
  frontmost_asn=$(lsappinfo front 2>/dev/null)
  [ -n "$frontmost_asn" ] || return 1
  [ "$(lsappinfo info -only bundlepath "$frontmost_asn" 2>/dev/null)" = "\"LSBundlePath\"=\"$bundle_path\"" ]
}

# Brings the running IDE forward and holds it there briefly. macOS can still hand
# focus back to the caller a moment after the helper instance exits, which would
# undo a single activation, so the frontmost app is re-checked a few times and
# `open -a` is repeated only while the IDE is not in front.
activate_running_ide_bundle() {
  bundle_path=$1
  activation_checks=0
  while [ $activation_checks -lt 4 ]; do
    ide_app_is_frontmost "$bundle_path" || open -a "$bundle_path" || :
    activation_checks=$((activation_checks + 1))
    [ $activation_checks -ge 4 ] || sleep 0.25
  done
}

# Counts main-process instances of the app bundle: the running IDE plus any
# short-lived helper instance the bundled CLI spawned to hand the path over.
# Renderer/GPU helpers live under Contents/Frameworks and do not match.
ide_bundle_main_process_count() {
  bundle_path=$1
  main_process_count=0
  while IFS= read -r process_command; do
    case "$process_command" in
      "$bundle_path/Contents/MacOS/"*) main_process_count=$((main_process_count + 1)) ;;
    esac
  done <<EOF
$(ps -axo command= 2>/dev/null)
EOF
  printf '%s' "$main_process_count"
}

# Polls until only the running IDE's main process remains. Each poll costs the
# 50ms sleep plus one `ps` scan (tens of ms), so 15 polls bound the wait at
# roughly two seconds; the helper normally exits within about half a second.
# When `ps` shows no main process at all, the helper cannot be observed (for
# example the app was launched through a different path), so wait a fixed
# interval instead of activating while the helper may still be alive.
wait_for_ide_bundled_cli_handoff() {
  bundle_path=$1
  if [ "$(ide_bundle_main_process_count "$bundle_path")" -eq 0 ]; then
    sleep 0.6
    return 0
  fi
  handoff_attempts=0
  while [ "$(ide_bundle_main_process_count "$bundle_path")" -gt 1 ] && [ $handoff_attempts -lt 15 ]; do
    sleep 0.05
    handoff_attempts=$((handoff_attempts + 1))
  done
}

# The bundled CLI focuses the repo window through a short-lived helper instance;
# that helper briefly becomes the active app and its exit hands macOS focus back
# to the caller, so an already-running IDE is activated through LaunchServices
# after the helper is gone. A fresh launch already comes forward, and a bare
# `open -a` around it could restore the previous session's windows instead.
run_ide_bundled_cli() {
  ide_cli=$1
  path=$2
  ide_bundle=${ide_cli%/Contents/Resources/app/bin/*}
  ide_was_running=0
  ! ide_app_is_running "$ide_bundle" || ide_was_running=1
  (
    cd "$path" || exit 1
    "$ide_cli" --new-window "$path" || exit 1
    if [ "$ide_was_running" = "1" ]; then
      wait_for_ide_bundled_cli_handoff "$ide_bundle"
      activate_running_ide_bundle "$ide_bundle"
    fi
  )
}

run_tool_command() {
  tool_label=$1
  command=$2
  path=$3
  [ -n "$command" ] || die "$tool_label command is not configured; run workbranch config $tool_label"
  case "$tool_label" in
    ide)
      case "$command" in
        'open -a "Visual Studio Code"'|'open -na "Visual Studio Code"') command='open -na "Visual Studio Code" --args --new-window' ;;
        'open -a Cursor'|'open -na Cursor'|'open -a "Cursor"'|'open -na "Cursor"') command='open -na Cursor --args --new-window' ;;
        'open -a "Antigravity IDE"'|'open -na "Antigravity IDE"') command='open -na "Antigravity IDE" --args --new-window' ;;
        'open -a Windsurf'|'open -na Windsurf'|'open -a "Windsurf"'|'open -na "Windsurf"') command='open -na Windsurf --args --new-window' ;;
      esac
      if bundled_cli_path=$(resolve_ide_bundled_cli "$command"); then
        run_ide_bundled_cli "$bundled_cli_path" "$path"
        return $?
      fi
      ;;
  esac
  (
    cd "$path" || exit 1
    WORKBRANCH_TOOL_PATH=$path
    export WORKBRANCH_TOOL_PATH
    sh -c "$command \"\$WORKBRANCH_TOOL_PATH\""
  )
}

run_finder_command() {
  path=$1
  (
    # Keep cwd aligned with the opened absolute path so tests can observe it via fake open.
    cd "$path" || exit 1
    open "$path"
  )
}
