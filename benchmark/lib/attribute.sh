#!/usr/bin/env bash
# benchmark/lib/attribute.sh — Component-level benchmark attribution
#
# Maps harness compliance checks and trace quality fields to the
# 11 Runtime Substrate responsibilities from HARNESS_COMPONENTS.md.
# When comparing two runs, this shows which harness component
# caused each score change.

# Map a harness compliance check name to a responsibility.
check_to_responsibility() {
  case "$1" in
    intake_recorded)   echo "Task specification" ;;
    correct_lane)      echo "Task specification" ;;
    story_created)     echo "Task state" ;;
    high_risk_docs)    echo "Task specification" ;;
    decision_recorded) echo "Intervention recording" ;;
    trace_recorded)    echo "Observability" ;;
    friction_captured) echo "Failure attribution" ;;
    *)                 echo "Unknown" ;;
  esac
}

# Map a trace quality field to a responsibility.
quality_field_to_responsibility() {
  case "$1" in
    task_summary)             echo "Observability" ;;
    outcome)                  echo "Task state" ;;
    agent)                    echo "Observability" ;;
    actions_taken)            echo "Observability" ;;
    files_read)               echo "Context selection" ;;
    files_changed)            echo "Task state" ;;
    errors_or_friction)       echo "Failure attribution" ;;
    decisions_made)           echo "Intervention recording" ;;
    errors_explicit)          echo "Failure attribution" ;;
    friction_explicit)        echo "Failure attribution" ;;
    duration_or_note)         echo "Observability" ;;
    token_estimate_or_note)   echo "Observability" ;;
    *)                        echo "Unknown" ;;
  esac
}

# Compare harness compliance checks for a single task between two runs.
# Prints lines like: "  intake_recorded: ✗→✓ (Task specification)"
compare_harness_checks() {
  local task="$1"
  local run1_dir="$2"
  local run2_dir="$3"

  local h1="$run1_dir/$task/harness.json"
  local h2="$run2_dir/$task/harness.json"

  if [ ! -f "$h1" ] || [ ! -f "$h2" ]; then
    return
  fi

  local checks1 checks2
  checks1=$(jq -r '.checks[]? | "\(.name)=\(.pass)"' "$h1" 2>/dev/null || true)
  checks2=$(jq -r '.checks[]? | "\(.name)=\(.pass)"' "$h2" 2>/dev/null || true)

  # Build associative arrays
  declare -A r1_checks r2_checks
  while IFS='=' read -r name pass; do
    [ -z "$name" ] && continue
    r1_checks["$name"]="$pass"
  done <<< "$checks1"
  while IFS='=' read -r name pass; do
    [ -z "$name" ] && continue
    r2_checks["$name"]="$pass"
  done <<< "$checks2"

  # Union of all check names
  local all_checks
  all_checks=$(echo "$checks1"$'\n'"$checks2" | sed 's/=.*//' | sort -u)

  while read -r check; do
    [ -z "$check" ] && continue
    local v1="${r1_checks[$check]:-missing}"
    local v2="${r2_checks[$check]:-missing}"
    local resp
    resp=$(check_to_responsibility "$check")

    if [ "$v1" = "$v2" ]; then
      continue
    fi

    local s1 s2
    s1=$([ "$v1" = "true" ] && echo "✓" || echo "✗")
    s2=$([ "$v2" = "true" ] && echo "✓" || echo "✗")
    echo "  $check: $s1→$s2 ($resp)"
  done <<< "$all_checks"
}

# Compare quality fields for a single task between two runs.
# Supports two quality.json formats:
#   - New format: has .fields object with per-field booleans
#   - Old format: has *_length fields only, no .fields object
# Falls back to score-level comparison when per-field data is absent.
compare_quality_fields() {
  local task="$1"
  local run1_dir="$2"
  local run2_dir="$3"

  local q1="$run1_dir/$task/quality.json"
  local q2="$run2_dir/$task/quality.json"

  if [ ! -f "$q1" ] || [ ! -f "$q2" ]; then
    return
  fi

  # Check if new format (has .fields key)
  local has_fields1 has_fields2
  has_fields1=$(jq 'has("fields")' "$q1" 2>/dev/null || echo "false")
  has_fields2=$(jq 'has("fields")' "$q2" 2>/dev/null || echo "false")

  if [ "$has_fields1" = "true" ] && [ "$has_fields2" = "true" ]; then
    # New format: compare per-field booleans
    local fields="task_summary outcome agent actions_taken files_read files_changed errors_or_friction decisions_made errors_explicit friction_explicit duration_or_note token_estimate_or_note"

    for field in $fields; do
      local v1 v2
      v1=$(jq -r ".fields.$field // false" "$q1" 2>/dev/null || echo "false")
      v2=$(jq -r ".fields.$field // false" "$q2" 2>/dev/null || echo "false")

      if [ "$v1" = "$v2" ]; then
        continue
      fi

      local resp
      resp=$(quality_field_to_responsibility "$field")
      local s1 s2
      s1=$([ "$v1" = "true" ] && echo "✓" || echo "✗")
      s2=$([ "$v2" = "true" ] && echo "✓" || echo "✗")
      echo "  $field: $s1→$s2 ($resp)"
    done
  else
    # Old format or mixed: compare trace_quality_score as a whole
    local score1 score2 tier1 tier2
    score1=$(jq '.trace_quality_score // 0' "$q1" 2>/dev/null || echo 0)
    score2=$(jq '.trace_quality_score // 0' "$q2" 2>/dev/null || echo 0)
    tier1=$(jq -r '.trace_quality // "none"' "$q1" 2>/dev/null || echo "none")
    tier2=$(jq -r '.trace_quality // "none"' "$q2" 2>/dev/null || echo "none")

    if [ "$score1" != "$score2" ]; then
      if [ "$score2" -gt "$score1" ]; then
        echo "  trace_quality: $tier1→$tier2 ($score1→$score2/3) (Observability)"
      else
        echo "  trace_quality: $tier1→$tier2 ($score1→$score2/3) (Observability)"
      fi
    fi
  fi
}

# Generate the full attribution report comparing two runs.
# Output: per-task deltas attributed to harness responsibilities,
# plus a summary of which responsibilities improved/regressed.
generate_attribution() {
  local run1="$1"
  local run2="$2"
  local runs_dir="$3"
  local run1_dir="$runs_dir/$run1"
  local run2_dir="$runs_dir/$run2"

  echo ""
  echo "Component Attribution:"
  echo ""

  declare -A improved regressed

  for task_dir in "$run1_dir"/T*; do
    [ -d "$task_dir" ] || continue
    local task
    task=$(basename "$task_dir")

    # Skip if the task dir doesn't exist in run2
    [ -d "$run2_dir/$task" ] || continue

    local harness_changes quality_changes
    harness_changes=$(compare_harness_checks "$task" "$run1_dir" "$run2_dir")
    quality_changes=$(compare_quality_fields "$task" "$run1_dir" "$run2_dir")

    if [ -z "$harness_changes" ] && [ -z "$quality_changes" ]; then
      continue
    fi

    # Get quality scores for header
    local q1_score q2_score
    q1_score=$(jq '.trace_quality_score // 0' "$run1_dir/$task/quality.json" 2>/dev/null || echo 0)
    q2_score=$(jq '.trace_quality_score // 0' "$run2_dir/$task/quality.json" 2>/dev/null || echo 0)

    # Get harness pass counts for header
    local h1_pass h1_total h2_pass h2_total
    h1_pass=$(jq '[.checks[]? | select(.pass==true)] | length' "$run1_dir/$task/harness.json" 2>/dev/null || echo 0)
    h1_total=$(jq '.checks | length' "$run1_dir/$task/harness.json" 2>/dev/null || echo 0)
    h2_pass=$(jq '[.checks[]? | select(.pass==true)] | length' "$run2_dir/$task/harness.json" 2>/dev/null || echo 0)
    h2_total=$(jq '.checks | length' "$run2_dir/$task/harness.json" 2>/dev/null || echo 0)

    echo "  $task  (harness: $h1_pass/$h1_total → $h2_pass/$h2_total, quality: $q1_score/3 → $q2_score/3)"

    if [ -n "$harness_changes" ]; then
      echo "$harness_changes"
    fi
    if [ -n "$quality_changes" ]; then
      echo "$quality_changes"
    fi
    echo ""

    # Track responsibility-level summary
    local all_changes
    all_changes=$(echo "$harness_changes"$'\n'"$quality_changes")
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      # Extract the responsibility name from parentheses at end of line
      local resp
      resp=$(echo "$line" | grep -oP '\(([^)]+)\)$' | tr -d '()')
      [ -z "$resp" ] && continue

      if echo "$line" | grep -q '✗→✓'; then
        improved["$resp"]=$(( ${improved["$resp"]:-0} + 1 ))
      elif echo "$line" | grep -q '✓→✗'; then
        regressed["$resp"]=$(( ${regressed["$resp"]:-0} + 1 ))
      else
        # Old-format quality: check if score improved or regressed
        # Format: "trace_quality: tier1→tier2 (score1→score2/3) (Responsibility)"
        local scores
        scores=$(echo "$line" | grep -oP '\((\d+)→(\d+)/3\)' || true)
        if [ -n "$scores" ]; then
          local s1 s2
          s1=$(echo "$scores" | grep -oP '^\(\K\d+')
          s2=$(echo "$scores" | grep -oP '→\K\d+')
          if [ -n "$s1" ] && [ -n "$s2" ]; then
            if [ "$s2" -gt "$s1" ]; then
              improved["$resp"]=$(( ${improved["$resp"]:-0} + 1 ))
            elif [ "$s2" -lt "$s1" ]; then
              regressed["$resp"]=$(( ${regressed["$resp"]:-0} + 1 ))
            fi
          fi
        fi
      fi
    done <<< "$all_changes"
  done

  # Summary — use a delimiter that won't appear in responsibility names
  if [ ${#improved[@]} -gt 0 ] || [ ${#regressed[@]} -gt 0 ]; then
    echo "  Responsibility Summary:"
    echo ""

    # Collect unique responsibility names via a temp associative array
    declare -A all_resps_set
    for key in "${!improved[@]}"; do
      all_resps_set["$key"]=1
    done
    for key in "${!regressed[@]}"; do
      all_resps_set["$key"]=1
    done

    for resp in "${!all_resps_set[@]}"; do
      [ -z "$resp" ] && continue
      local imp_count reg_count
      imp_count=${improved["$resp"]:-0}
      reg_count=${regressed["$resp"]:-0}
      local net=$((imp_count - reg_count))
      local indicator
      if [ "$net" -gt 0 ]; then
        indicator="↑ improved"
      elif [ "$net" -lt 0 ]; then
        indicator="↓ regressed"
      else
        indicator="~ mixed"
      fi
      printf "    %-24s  +%d/-%d checks  %s\n" "$resp" "$imp_count" "$reg_count" "$indicator"
    done | sort
    echo ""
  else
    echo "  No per-check changes detected between runs."
    echo ""
  fi
}
