#!/usr/bin/env bash
# benchmark/lib/check-harness.sh — Harness durable layer compliance checks

check_harness() {
  local task="$1"
  local outdir="$2"
  local project_dir="$3"

  local db="$project_dir/harness.db"
  local results=()

  # If harness DB doesn't exist, all checks fail
  if [ ! -f "$db" ]; then
    echo "  Harness DB not found — compliance = 0"
    echo '{"checks":[],"db_exists":false}' > "$outdir/harness.json"
    return 0
  fi

  # Check: Intake recorded for this task?
  local intake_count
  intake_count=$(sqlite3 "$db" "SELECT COUNT(*) FROM intake;" 2>/dev/null || echo 0)
  add_harness_check results "intake_recorded" "$((intake_count > 0))"

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
  [ "$actual_lane" = "$expected_lane" ] && lane_match=1
  add_harness_check results "correct_lane" "$lane_match"

  # Save lane data for reporting
  cat > "$outdir/lane.json" <<EOF
{"expected": "$expected_lane", "actual": "$actual_lane"}
EOF

  # Check: Story created (for normal+ tasks)?
  if [ "$expected_lane" != "tiny" ]; then
    local story_count
    story_count=$(sqlite3 "$db" "SELECT COUNT(*) FROM story;" 2>/dev/null || echo 0)
    add_harness_check results "story_created" "$((story_count > 0))"
  fi

  # Check: High-risk docs (T4 only)
  if [ "$expected_lane" = "high_risk" ]; then
    local has_docs=0
    # Look for story folder with design docs
    if find "$project_dir/docs/stories" -name "*.md" 2>/dev/null | grep -q .; then
      has_docs=1
    fi
    add_harness_check results "high_risk_docs" "$has_docs"

    # Decision record for high-risk
    local decision_count
    decision_count=$(sqlite3 "$db" "SELECT COUNT(*) FROM decision;" 2>/dev/null || echo 0)
    add_harness_check results "decision_recorded" "$((decision_count > 0))"
  fi

  # Check: Trace recorded?
  local trace_count
  trace_count=$(sqlite3 "$db" "SELECT COUNT(*) FROM trace;" 2>/dev/null || echo 0)
  add_harness_check results "trace_recorded" "$((trace_count > 0))"

  # Check: Friction captured?
  local latest_friction
  latest_friction=$(sqlite3 "$db" "SELECT harness_friction FROM trace ORDER BY id DESC LIMIT 1;" 2>/dev/null || echo "")
  local friction_captured=0
  [ -n "$latest_friction" ] && friction_captured=1
  add_harness_check results "friction_captured" "$friction_captured"

  # Write results
  write_harness_json "$outdir/harness.json" "${results[@]}"
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
