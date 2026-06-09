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

check_value_from_list() {
  local checks="$1"
  local expected_name="$2"

  printf '%s\n' "$checks" | awk -F= -v expected_name="$expected_name" '
    $1 == expected_name { print $2; found = 1; exit }
    END { if (!found) print "missing" }
  '
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

  # Bash 3-compatible lookup: avoid associative arrays for macOS /bin/bash.

  # Union of all check names
  local all_checks
  all_checks=$(echo "$checks1"$'\n'"$checks2" | sed 's/=.*//' | sort -u)

  while read -r check; do
    [ -z "$check" ] && continue
    local v1 v2
    v1=$(check_value_from_list "$checks1" "$check")
    v2=$(check_value_from_list "$checks2" "$check")
    local resp
    resp=$(check_to_responsibility "$check")

    if [ "$v1" = "$v2" ]; then
      continue
    fi

    local s1 s2
    s1=$([ "$v1" = "true" ] && echo "✓" || echo "✗")
    s2=$([ "$v2" = "true" ] && echo "✓" || echo "✗")
    echo "  $check: ${s1}→${s2} ($resp)"
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
      echo "  $field: ${s1}→${s2} ($resp)"
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
        echo "  trace_quality: ${tier1}→${tier2} (${score1}→${score2}/3) (Observability)"
      else
        echo "  trace_quality: ${tier1}→${tier2} (${score1}→${score2}/3) (Observability)"
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

  local summary_file
  summary_file=$(mktemp "${TMPDIR:-/tmp}/harness-attribute.XXXXXX")
  : > "$summary_file"

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

    # Track responsibility-level summary in a temp file for Bash 3 compatibility.
    local all_changes
    all_changes=$(echo "$harness_changes"$'\n'"$quality_changes")
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      # Extract the responsibility name from parentheses at end of line.
      local resp
      resp=$(echo "$line" | sed -n 's/.*(\([^()]*\))$/\1/p')
      [ -z "$resp" ] && continue

      if echo "$line" | grep -q '✗→✓'; then
        printf '%s|improved\n' "$resp" >> "$summary_file"
      elif echo "$line" | grep -q '✓→✗'; then
        printf '%s|regressed\n' "$resp" >> "$summary_file"
      else
        # Old-format quality: check if score improved or regressed.
        # Format: "trace_quality: tier1→tier2 (score1→score2/3) (Responsibility)"
        local scores s1 s2
        scores=$(echo "$line" | sed -n 's/.*(\([0-9][0-9]*\)→\([0-9][0-9]*\)\/3).*/\1 \2/p')
        if [ -n "$scores" ]; then
          set -- $scores
          s1="$1"
          s2="$2"
          if [ "$s2" -gt "$s1" ]; then
            printf '%s|improved\n' "$resp" >> "$summary_file"
          elif [ "$s2" -lt "$s1" ]; then
            printf '%s|regressed\n' "$resp" >> "$summary_file"
          fi
        fi
      fi
    done <<< "$all_changes"
  done

  # Summary — use awk arrays for Bash 3 compatibility.
  if [ -s "$summary_file" ]; then
    echo "  Responsibility Summary:"
    echo ""
    awk -F'|' '
      $2 == "improved" { improved[$1]++; keys[$1] = 1 }
      $2 == "regressed" { regressed[$1]++; keys[$1] = 1 }
      END {
        for (resp in keys) {
          imp = improved[resp] + 0
          reg = regressed[resp] + 0
          net = imp - reg
          if (net > 0) indicator = "↑ improved"
          else if (net < 0) indicator = "↓ regressed"
          else indicator = "~ mixed"
          printf "    %-24s  +%d/-%d checks  %s\n", resp, imp, reg, indicator
        }
      }
    ' "$summary_file" | sort
    echo ""
  else
    echo "  No per-check changes detected between runs."
    echo ""
  fi

  rm -f "$summary_file"
}
