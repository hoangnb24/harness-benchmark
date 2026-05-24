#!/usr/bin/env bash
# benchmark/lib/check-quality.sh — Trace quality and documentation assessment

check_quality() {
  local task="$1"
  local outdir="$2"
  local project_dir="$3"

  local db="$project_dir/harness.db"

  # If no harness DB, quality is minimal
  if [ ! -f "$db" ]; then
    cat > "$outdir/quality.json" <<EOF
{
  "trace_quality": "none",
  "trace_quality_score": 0,
  "summary_length": 0,
  "actions_length": 0,
  "files_changed_length": 0,
  "errors_length": 0,
  "friction_length": 0
}
EOF
    return 0
  fi

  # Get trace field lengths
  local trace_summary trace_actions trace_files trace_errors trace_friction
  trace_summary=$(sqlite3 "$db" "SELECT length(coalesce(task_summary,'')) FROM trace ORDER BY id DESC LIMIT 1;" 2>/dev/null || echo 0)
  trace_actions=$(sqlite3 "$db" "SELECT length(coalesce(actions_taken,'')) FROM trace ORDER BY id DESC LIMIT 1;" 2>/dev/null || echo 0)
  trace_files=$(sqlite3 "$db" "SELECT length(coalesce(files_changed,'')) FROM trace ORDER BY id DESC LIMIT 1;" 2>/dev/null || echo 0)
  trace_errors=$(sqlite3 "$db" "SELECT length(coalesce(errors,'')) FROM trace ORDER BY id DESC LIMIT 1;" 2>/dev/null || echo 0)
  trace_friction=$(sqlite3 "$db" "SELECT length(coalesce(harness_friction,'')) FROM trace ORDER BY id DESC LIMIT 1;" 2>/dev/null || echo 0)

  # Default to 0 if empty
  trace_summary=${trace_summary:-0}
  trace_actions=${trace_actions:-0}
  trace_files=${trace_files:-0}
  trace_errors=${trace_errors:-0}
  trace_friction=${trace_friction:-0}

  # Classify trace quality
  local quality="minimal"
  local quality_score=1

  if [ "$trace_actions" -gt 5 ] && [ "$trace_files" -gt 2 ]; then
    quality="standard"
    quality_score=2
  fi

  if [ "$trace_actions" -gt 20 ] && [ "$trace_files" -gt 5 ] && [ "$trace_friction" -gt 5 ]; then
    quality="detailed"
    quality_score=3
  fi

  # Check if no trace at all
  local trace_count
  trace_count=$(sqlite3 "$db" "SELECT COUNT(*) FROM trace;" 2>/dev/null || echo 0)
  if [ "$trace_count" -eq 0 ]; then
    quality="none"
    quality_score=0
  fi

  cat > "$outdir/quality.json" <<EOF
{
  "trace_quality": "$quality",
  "trace_quality_score": $quality_score,
  "summary_length": $trace_summary,
  "actions_length": $trace_actions,
  "files_changed_length": $trace_files,
  "errors_length": $trace_errors,
  "friction_length": $trace_friction
}
EOF
}
