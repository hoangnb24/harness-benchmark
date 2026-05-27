#!/usr/bin/env bash
# benchmark/lib/check-harness.sh — Harness durable layer compliance checks

record_harness_baseline() {
  local outdir="$1"
  local project_dir="$2"
  local db="$project_dir/harness.db"
  local outfile="$outdir/harness-baseline.env"
  local marker="$outdir/harness-baseline.marker"

  : > "$marker"
  {
    echo "intake_before=$(harness_table_count "$db" intake)"
    echo "story_before=$(harness_table_count "$db" story)"
    echo "decision_before=$(harness_table_count "$db" decision)"
    echo "trace_before=$(harness_table_count "$db" trace)"
    echo "high_risk_docs_before=$(count_high_risk_doc_sets "$project_dir")"
  } > "$outfile"
}

check_harness() {
  local task="$1"
  local outdir="$2"
  local project_dir="$3"

  local db="$project_dir/harness.db"
  local results=()
  local baseline="$outdir/harness-baseline.env"
  local intake_before=0
  local story_before=0
  local decision_before=0
  local trace_before=0
  local high_risk_docs_before=0

  if [ -f "$baseline" ]; then
    . "$baseline"
  fi

  # If harness DB doesn't exist, all checks fail
  if [ ! -f "$db" ]; then
    echo "  Harness DB not found — compliance = 0"
    echo '{"checks":[],"db_exists":false}' > "$outdir/harness.json"
    return 0
  fi

  # Check: Intake recorded for this task?
  local intake_count intake_delta
  intake_count=$(harness_table_count "$db" intake)
  intake_delta=$((intake_count - intake_before))
  add_harness_check results "intake_recorded" "$((intake_delta > 0))"

  # Check: Risk lane assigned correctly?
  local expected_lane
  case "$task" in
    T1-*) expected_lane="tiny" ;;
    T4-*) expected_lane="high_risk" ;;
    *)    expected_lane="normal" ;;
  esac

  local actual_lane
  actual_lane=$(sqlite3 "$db" "SELECT risk_lane FROM intake ORDER BY id DESC LIMIT 1;" 2>/dev/null || echo "")
  local lane_match=0
  [ "$intake_delta" -gt 0 ] && [ "$actual_lane" = "$expected_lane" ] && lane_match=1
  add_harness_check results "correct_lane" "$lane_match"

  # Save lane data for reporting
  cat > "$outdir/lane.json" <<EOF
{"expected": "$expected_lane", "actual": "$actual_lane"}
EOF

  # Check: Story created (for normal+ tasks)?
  if [ "$expected_lane" != "tiny" ]; then
    local story_count story_delta
    story_count=$(harness_table_count "$db" story)
    story_delta=$((story_count - story_before))
    add_harness_check results "story_created" "$((story_delta > 0))"
  fi

  # Check: High-risk docs (T4 only)
  if [ "$expected_lane" = "high_risk" ]; then
    local has_docs=0
    local high_risk_docs_count high_risk_docs_delta
    high_risk_docs_count=$(count_high_risk_doc_sets "$project_dir")
    high_risk_docs_delta=$((high_risk_docs_count - high_risk_docs_before))
    if [ "$high_risk_docs_delta" -gt 0 ]; then
      has_docs=1
    else
      has_docs=$(has_new_high_risk_docs "$project_dir" "$outdir/harness-baseline.marker")
    fi
    add_harness_check results "high_risk_docs" "$has_docs"

    # Decision record for high-risk
    local decision_count decision_delta
    decision_count=$(harness_table_count "$db" decision)
    decision_delta=$((decision_count - decision_before))
    add_harness_check results "decision_recorded" "$((decision_delta > 0))"
  fi

  # Check: Trace recorded?
  local trace_count trace_delta
  trace_count=$(harness_table_count "$db" trace)
  trace_delta=$((trace_count - trace_before))
  add_harness_check results "trace_recorded" "$((trace_delta > 0))"

  # Check: Friction captured?
  local latest_friction
  latest_friction=$(sqlite3 "$db" "SELECT harness_friction FROM trace ORDER BY id DESC LIMIT 1;" 2>/dev/null || echo "")
  local friction_captured=0
  [ "$trace_delta" -gt 0 ] && [ -n "$latest_friction" ] && friction_captured=1
  add_harness_check results "friction_captured" "$friction_captured"

  # Write results
  write_harness_json "$outdir/harness.json" "${results[@]}"
}

harness_table_count() {
  local db="$1"
  local table="$2"

  if [ ! -f "$db" ]; then
    echo 0
    return
  fi

  sqlite3 "$db" "SELECT COUNT(*) FROM $table;" 2>/dev/null || echo 0
}

has_new_high_risk_docs() {
  local project_dir="$1"
  local marker="$2"
  local stories_dir="$project_dir/docs/stories"
  local found=0

  if [ ! -d "$stories_dir" ]; then
    echo 0
    return
  fi

  while IFS= read -r dir; do
    if [ -f "$dir/overview.md" ] &&
       [ -f "$dir/design.md" ] &&
       [ -f "$dir/execplan.md" ] &&
       [ -f "$dir/validation.md" ] &&
       find "$dir" \( -name overview.md -o -name design.md -o -name execplan.md -o -name validation.md \) -newer "$marker" 2>/dev/null | grep -q .; then
      found=1
      break
    fi
  done < <(find "$stories_dir" -type d 2>/dev/null)

  echo "$found"
}

count_high_risk_doc_sets() {
  local project_dir="$1"
  local stories_dir="$project_dir/docs/stories"
  local count=0

  if [ ! -d "$stories_dir" ]; then
    echo 0
    return
  fi

  while IFS= read -r dir; do
    if [ -f "$dir/overview.md" ] &&
       [ -f "$dir/design.md" ] &&
       [ -f "$dir/execplan.md" ] &&
       [ -f "$dir/validation.md" ]; then
      count=$((count + 1))
    fi
  done < <(find "$stories_dir" -type d 2>/dev/null)

  echo "$count"
}

# Helper: add a check result
# Uses eval+indirect rather than local -n for Bash 3 compatibility
add_harness_check() {
  local arr="$1"
  local name="$2"
  local pass_int="$3"

  local pass=false
  [ "$pass_int" -gt 0 ] && pass=true

  eval "${arr}+=(\"{\\\"name\\\":\\\"$name\\\",\\\"pass\\\":$pass}\")"
}

# Helper: write JSON
write_harness_json() {
  local outfile="$1"; shift
  local checks=("$@")

  echo -n '{"db_exists":true,"checks":[' > "$outfile"
  local first=true
  for check in "${checks[@]}"; do
    if [ "$first" = "true" ]; then
      first=false
    else
      echo -n "," >> "$outfile"
    fi
    echo -n "$check" >> "$outfile"
  done
  echo ']}' >> "$outfile"
}
