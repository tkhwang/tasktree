cmd_list_json() {
  local first_task first_repo path task name repo_path branch title plan_title dirty status counts progress_done progress_total current_item updated_at
  local i base_commit status_output changed_files ahead behind last_commit last_commit_at last_commit_subject record_separator
  local -a base_commits
  local first_base_repo base_branch present remote_available remote_commit remote_ref inspection_error
  local canonical_repo_path canonical_top_level inside_work_tree top_level git_status
  local parent_path parent_parent_path
  base_commits=()
  i=0
  while [ $i -lt ${#REPO_NAMES[@]} ]; do
    name=$(repo_name_at "$i")
    base_commits[$i]=$(head_commit_full "$(base_repo_path "$name")")
    i=$((i + 1))
  done
  record_separator=$(printf '\037')
  printf '{'
  printf '"schemaVersion":1,'
  printf '"project":'
  json_string "$PROJECT_NAME"
  printf ',"root":'
  json_string "$PROJECT_ROOT"
  printf ',"baseRepos":['
  first_base_repo=1
  i=0
  while [ $i -lt ${#REPO_NAMES[@]} ]; do
    name=$(repo_name_at "$i")
    base_branch=$(repo_base_branch_at "$i")
    repo_path=$(base_repo_path "$name")
    present=false
    branch=""
    dirty=false
    changed_files=0
    remote_available=false
    ahead=0
    behind=0
    inspection_error=""
    if [ ! -e "$repo_path" ] && [ ! -L "$repo_path" ]; then
      parent_path=${repo_path%/*}
      parent_parent_path=${parent_path%/*}
      if { [ -d "$parent_path" ] && [ -x "$parent_path" ]; } || {
        [ ! -e "$parent_path" ] && [ ! -L "$parent_path" ] && [ -d "$parent_parent_path" ] && [ -x "$parent_parent_path" ]
      }; then
        :
      else
        inspection_error="git-read-failed"
      fi
    elif [ ! -d "$repo_path" ]; then
      inspection_error="invalid-worktree"
    elif ! canonical_repo_path=$(cd "$repo_path" 2>/dev/null && pwd -P); then
      inspection_error="git-read-failed"
    else
      inside_work_tree=$(git -C "$repo_path" rev-parse --is-inside-work-tree 2>/dev/null)
      git_status=$?
      if [ $git_status -ne 0 ]; then
        if [ -e "$repo_path/.git" ] || [ -L "$repo_path/.git" ]; then
          inspection_error="git-read-failed"
        else
          inspection_error="invalid-worktree"
        fi
      elif [ "$inside_work_tree" != "true" ]; then
        inspection_error="invalid-worktree"
      elif ! top_level=$(git -C "$repo_path" rev-parse --show-toplevel 2>/dev/null); then
        inspection_error="git-read-failed"
      elif ! canonical_top_level=$(cd "$top_level" 2>/dev/null && pwd -P); then
        inspection_error="git-read-failed"
      elif [ "$canonical_top_level" != "$canonical_repo_path" ]; then
        inspection_error="invalid-worktree"
      else
        present=true
        if ! branch=$(git -C "$repo_path" branch --show-current 2>/dev/null); then
          inspection_error="git-read-failed"
        elif ! status_output=$(git -C "$repo_path" status --porcelain 2>/dev/null); then
          inspection_error="git-read-failed"
        else
          if [ -n "$status_output" ]; then
            dirty=true
            changed_files=$(printf '%s\n' "$status_output" | awk 'END { print NR }')
          fi
          remote_ref="refs/remotes/origin/$base_branch"
          remote_commit=$(git -C "$repo_path" rev-parse --verify --quiet "$remote_ref^{commit}" 2>/dev/null)
          git_status=$?
          if [ $git_status -eq 0 ]; then
            remote_available=true
            if counts=$(commit_diff_counts "$repo_path" "$remote_commit"); then
              set -- $counts
              behind=${1:-0}
              ahead=${2:-0}
            else
              inspection_error="git-read-failed"
            fi
          elif [ $git_status -eq 1 ]; then
            git -C "$repo_path" show-ref --verify --quiet "$remote_ref" 2>/dev/null
            git_status=$?
            if [ $git_status -eq 1 ]; then
              git -C "$repo_path" symbolic-ref -q "$remote_ref" >/dev/null 2>&1
              git_status=$?
            fi
            if [ $git_status -ne 1 ]; then
              inspection_error="git-read-failed"
            fi
          else
            inspection_error="git-read-failed"
          fi
        fi
      fi
    fi
    if [ -n "$inspection_error" ]; then
      branch=""
      dirty=false
      changed_files=0
      remote_available=false
      ahead=0
      behind=0
    fi
    if [ $first_base_repo -eq 1 ]; then
      first_base_repo=0
    else
      printf ','
    fi
    printf '{"name":'
    json_string "$name"
    printf ',"baseBranch":'
    json_string "$base_branch"
    printf ',"branch":'
    json_string "$branch"
    printf ',"present":%s' "$present"
    printf ',"dirty":%s' "$dirty"
    printf ',"changedFiles":%s' "$changed_files"
    printf ',"remoteAvailable":%s' "$remote_available"
    printf ',"ahead":%s' "$ahead"
    printf ',"behind":%s' "$behind"
    printf ',"inspectionError":'
    if [ -n "$inspection_error" ]; then
      json_string "$inspection_error"
    else
      printf 'null'
    fi
    printf '}'
    i=$((i + 1))
  done
  printf '],"tasks":['
  first_task=1
  for path in "$PROJECT_ROOT"/*; do
    is_task_workspace_path "$path" || continue
    task=${path##*/}
    if [ $first_task -eq 1 ]; then
      first_task=0
    else
      printf ','
    fi
    title=$(task_brief_title "$task")
    printf '{"name":'
    json_string "$task"
    printf ',"path":'
    json_string "$path"
    printf ',"memoTitle":'
    json_string "$title"
    plan_title=$(task_active_plan_title "$task")
    printf ',"planTitle":'
    json_string "$plan_title"
    status=$(task_status "$task")
    counts=$(task_checklist_counts "$task")
    progress_done=${counts%% *}
    progress_total=${counts##* }
    current_item=$(task_current_item "$task")
    updated_at=$(task_updated_at "$task")
    printf ',"status":'
    json_string "$status"
    printf ',"progressDone":%s' "$progress_done"
    printf ',"progressTotal":%s' "$progress_total"
    printf ',"currentItem":'
    json_string "$current_item"
    printf ',"updatedAt":%s' "$updated_at"
    printf ',"items":'
    task_checklist_items_json "$task"
    printf ',"plans":'
    task_plans_json "$task"
    printf ',"notiCount":%s' "$(noti_count "$task")"
    printf ',"repos":['
    first_repo=1
    i=0
    while [ $i -lt ${#REPO_NAMES[@]} ]; do
      name=$(repo_name_at "$i")
      repo_path="$path/$name"
      branch=$(branch_or_unknown "$repo_path")
      status_output=$(git -C "$repo_path" status --porcelain 2>/dev/null) || status_output=""
      if [ -n "$status_output" ]; then
        dirty=true
        changed_files=$(printf '%s\n' "$status_output" | awk 'END { print NR }')
      else
        dirty=false
        changed_files=0
      fi
      base_commit=${base_commits[$i]:-?}
      if counts=$(commit_diff_counts "$repo_path" "$base_commit"); then
        set -- $counts
        behind=${1:-0}
        ahead=${2:-0}
      else
        ahead=0
        behind=0
      fi
      if last_commit=$(last_commit_record "$repo_path"); then
        last_commit_at=${last_commit%%"$record_separator"*}
        last_commit_subject=${last_commit#*"$record_separator"}
      else
        last_commit_at=0
        last_commit_subject=""
      fi
      if [ $first_repo -eq 1 ]; then
        first_repo=0
      else
        printf ','
      fi
      printf '{"name":'
      json_string "$name"
      printf ',"branch":'
      json_string "$branch"
      printf ',"dirty":%s' "$dirty"
      printf ',"ahead":%s' "$ahead"
      printf ',"behind":%s' "$behind"
      printf ',"changedFiles":%s' "$changed_files"
      printf ',"lastCommitSubject":'
      json_string "$last_commit_subject"
      printf ',"lastCommitAt":%s}' "$last_commit_at"
      i=$((i + 1))
    done
    printf ']}'
  done
  printf ']}'
  printf '\n'
}

cmd_list_local() {
  require_project
  info "Project: $PROJECT_NAME"
  info "Base: $BASE_DIR"
  section "IDE"
  if [ -n "$IDE_COMMAND" ]; then
    printf '    %s\n' "$IDE_COMMAND"
  else
    printf '    (none)\n'
  fi
  section "Terminal"
  if [ -n "$TERMINAL_COMMAND" ]; then
    printf '    %s\n' "$TERMINAL_COMMAND"
  else
    printf '    (none)\n'
  fi
  if has_repo_setups; then
    section "Repo setup"
    i=0
    while [ $i -lt ${#REPO_NAMES[@]} ]; do
      command=$(repo_setup_at "$i")
      if [ -n "$command" ]; then
        printf '    %s: %s\n' "$(repo_name_at "$i")" "$command"
      fi
      i=$((i + 1))
    done
  fi
  section "Repos"
  printf '    %s %s %s\n' "$(table_header 11 repo)" "$(table_header 16 base)" "$(color_text "$WB_GRAY" current)"
  i=0
  while [ $i -lt ${#REPO_NAMES[@]} ]; do
    name=$(repo_name_at "$i")
    branch=$(repo_base_branch_at "$i")
    current=$(branch_or_unknown "$(base_repo_path "$name")")
    printf '    %s %s %s\n' "$(color_repo_cell 11 "$name")" "$(color_branch_cell 16 "$branch")" "$(color_branch_name "$current")"
    i=$((i + 1))
  done
  section "Tasks"
  found=0
  for path in "$PROJECT_ROOT"/*; do
    [ -d "$path" ] || continue
    dir_name=${path##*/}
    [ "$dir_name" = "$BASE_DIR" ] && continue
    case "$dir_name" in .*) continue ;; esac
    task_has_repo=0
    i=0
    while [ $i -lt ${#REPO_NAMES[@]} ]; do
      name=$(repo_name_at "$i")
      [ -d "$path/$name" ] && task_has_repo=1
      i=$((i + 1))
    done
    [ $task_has_repo -eq 1 ] || continue
    found=1
    section "$dir_name"
    printf '    %s %s\n' "$(table_header 11 repo)" "$(color_text "$WB_GRAY" branch)"
    i=0
    while [ $i -lt ${#REPO_NAMES[@]} ]; do
      name=$(repo_name_at "$i")
      current=$(branch_or_unknown "$path/$name")
      printf '    %s %s\n' "$(color_repo_cell 11 "$name")" "$(color_branch_name "$current")"
      i=$((i + 1))
    done
  done
  [ $found -eq 1 ] || info "  (none)"
}


workbranch_self_path() {
  local self self_dir self_base resolved
  self=$0
  if resolved=$(command -v -- "$0" 2>/dev/null) && [ -n "$resolved" ]; then
    self=$resolved
  fi
  case "$self" in
    /*) printf '%s' "$self" ;;
    */*)
      self_dir=${self%/*}
      self_base=${self##*/}
      if [ -d "$self_dir" ]; then
        (cd "$self_dir" 2>/dev/null && printf '%s/%s' "$(pwd -P)" "$self_base") || printf '%s' "$self"
      else
        printf '%s' "$self"
      fi
      ;;
    *) printf '%s' "$self" ;;
  esac
}

cmd_list_global_json() {
  local root first_project first_error successes errors out status message self
  printf '{"schemaVersion":1,"projects":['
  first_project=1
  first_error=1
  successes=0
  errors=0
  error_items=""
  self=$(workbranch_self_path)
  while IFS= read -r root || [ -n "$root" ]; do
    [ -n "$root" ] || continue
    out=$(cd "$root" 2>/dev/null && "$self" list --json 2>&1)
    status=$?
    if [ $status -eq 0 ]; then
      if [ $first_project -eq 1 ]; then first_project=0; else printf ','; fi
      printf '%s' "$out"
      successes=$((successes + 1))
    else
      message=$out
      if [ $first_error -eq 1 ]; then first_error=0; else error_items="$error_items,"; fi
      error_items="$error_items{\"root\":"
      error_items="$error_items$(json_string_value "$root")"
      error_items="$error_items,\"message\":"
      error_items="$error_items$(json_string_value "$message")"
      error_items="$error_items}"
      errors=$((errors + 1))
    fi
  done <<EOF_REGISTRY_ROOTS
$(registry_list_roots)
EOF_REGISTRY_ROOTS
  printf '],"errors":['
  printf '%s' "$error_items"
  printf ']}\n'
  if [ $successes -eq 0 ] && [ $errors -gt 0 ]; then
    return 1
  fi
  return 0
}

json_string_value() {
  printf '"'
  printf '%s' "$1" | json_escape
  printf '"'
}

cmd_list_global_human() {
  local root out status successes errors self
  successes=0
  errors=0
  self=$(workbranch_self_path)
  while IFS= read -r root || [ -n "$root" ]; do
    [ -n "$root" ] || continue
    out=$(cd "$root" 2>/dev/null && "$self" list 2>&1)
    status=$?
    if [ $status -eq 0 ]; then
      [ $successes -eq 0 ] || printf '\n'
      printf '%s\n' "$out"
      successes=$((successes + 1))
    else
      printf '[-] Error: %s: %s\n' "$root" "$out" >&2
      errors=$((errors + 1))
    fi
  done <<EOF_REGISTRY_ROOTS
$(registry_list_roots)
EOF_REGISTRY_ROOTS
  if [ $successes -eq 0 ] && [ $errors -gt 0 ]; then
    return 1
  fi
}

cmd_list() {
  global=0
  json=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --global) global=1; shift ;;
      --json) json=1; shift ;;
      *) die "usage: workbranch list [--global] [--json]" ;;
    esac
  done
  if [ $global -eq 1 ]; then
    if [ $json -eq 1 ]; then
      cmd_list_global_json
    else
      cmd_list_global_human
    fi
    return $?
  fi
  if [ $json -eq 1 ]; then
    require_project
    cmd_list_json
    return 0
  fi
  cmd_list_local
}
