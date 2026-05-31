#!/usr/bin/env bash
# benchmark/lib/check-quality.sh — Trace quality assessment via TRACE_SPEC.md
#
# Scores the latest trace in harness.db using field-presence rules aligned
# with docs/TRACE_SPEC.md quality tiers (minimal / standard / detailed).
# Previous versions used character-length heuristics; this version checks
# whether each required field is present and non-empty per the spec.

check_quality() {
  local task="$1"
  local outdir="$2"
  local project_dir="$3"

  local db="$project_dir/harness.db"

  # No harness DB → score 0
  if [ ! -f "$db" ]; then
    write_quality_json "$outdir" "none" 0 0 0 0 0 0 0 0 0 0 0 0
    return 0
  fi

  # No traces at all → score 0
  local trace_count
  trace_count=$(sqlite3 "$db" "SELECT COUNT(*) FROM trace;" 2>/dev/null || echo 0)
  if [ "$trace_count" -eq 0 ]; then
    write_quality_json "$outdir" "none" 0 0 0 0 0 0 0 0 0 0 0 0
    return 0
  fi

  # Query field-presence flags from the latest trace (single query).
  # Each column returns 1 (present) or 0 (missing) per TRACE_SPEC.md rules.
  local flags
  flags=$(sqlite3 "$db" "
    SELECT
      -- Minimal tier
      CASE WHEN length(coalesce(trim(task_summary),'')) >= 10
           THEN 1 ELSE 0 END,
      CASE WHEN outcome IS NOT NULL AND trim(outcome) != ''
           THEN 1 ELSE 0 END,
      -- Standard tier
      CASE WHEN agent IS NOT NULL AND trim(agent) != ''
           THEN 1 ELSE 0 END,
      CASE WHEN actions_taken IS NOT NULL AND length(trim(actions_taken)) > 2
           THEN 1 ELSE 0 END,
      CASE WHEN files_read IS NOT NULL AND length(trim(files_read)) > 2
           THEN 1 ELSE 0 END,
      CASE WHEN files_changed IS NOT NULL
           THEN 1 ELSE 0 END,
      CASE WHEN errors IS NOT NULL OR harness_friction IS NOT NULL
           THEN 1 ELSE 0 END,
      -- Detailed tier
      CASE WHEN decisions_made IS NOT NULL AND length(trim(decisions_made)) > 2
           THEN 1 ELSE 0 END,
      CASE WHEN errors IS NOT NULL
           THEN 1 ELSE 0 END,
      CASE WHEN harness_friction IS NOT NULL
           THEN 1 ELSE 0 END,
      CASE WHEN duration_seconds IS NOT NULL
           OR (notes IS NOT NULL
               AND lower(notes) LIKE '%duration%'
               AND (lower(notes) LIKE '%unavailable%'
                    OR lower(notes) LIKE '%not available%'
                    OR lower(notes) LIKE '%unknown%'))
           THEN 1 ELSE 0 END,
      CASE WHEN token_estimate IS NOT NULL
           OR (notes IS NOT NULL
               AND lower(notes) LIKE '%token%'
               AND (lower(notes) LIKE '%unavailable%'
                    OR lower(notes) LIKE '%not available%'
                    OR lower(notes) LIKE '%unknown%'))
           THEN 1 ELSE 0 END
    FROM trace ORDER BY id DESC LIMIT 1;
  " 2>/dev/null)

  if [ -z "$flags" ]; then
    write_quality_json "$outdir" "none" 0 0 0 0 0 0 0 0 0 0 0 0
    return 0
  fi

  # Parse pipe-separated values
  IFS='|' read -r \
    has_summary has_outcome \
    has_agent has_actions has_files_read has_files_changed has_errors_or_friction \
    has_decisions has_errors_explicit has_friction_explicit has_duration has_tokens \
    <<< "$flags"

  # Classify tier per TRACE_SPEC.md
  local quality="incomplete"
  local quality_score=0

  # Minimal: task_summary ≥ 10 chars + outcome set
  local minimal_ok=1
  [ "$has_summary" -eq 0 ] && minimal_ok=0
  [ "$has_outcome" -eq 0 ] && minimal_ok=0

  if [ "$minimal_ok" -eq 1 ]; then
    quality="minimal"
    quality_score=1

    # Standard: minimal + agent + actions + files_read + files_changed
    #           + at least one of errors/friction
    local standard_ok=1
    [ "$has_agent" -eq 0 ] && standard_ok=0
    [ "$has_actions" -eq 0 ] && standard_ok=0
    [ "$has_files_read" -eq 0 ] && standard_ok=0
    [ "$has_files_changed" -eq 0 ] && standard_ok=0
    [ "$has_errors_or_friction" -eq 0 ] && standard_ok=0

    if [ "$standard_ok" -eq 1 ]; then
      quality="standard"
      quality_score=2

      # Detailed: standard + decisions + errors (explicit) + friction (explicit)
      #           + duration (or note) + tokens (or note)
      local detailed_ok=1
      [ "$has_decisions" -eq 0 ] && detailed_ok=0
      [ "$has_errors_explicit" -eq 0 ] && detailed_ok=0
      [ "$has_friction_explicit" -eq 0 ] && detailed_ok=0
      [ "$has_duration" -eq 0 ] && detailed_ok=0
      [ "$has_tokens" -eq 0 ] && detailed_ok=0

      if [ "$detailed_ok" -eq 1 ]; then
        quality="detailed"
        quality_score=3
      fi
    fi
  fi

  write_quality_json "$outdir" "$quality" "$quality_score" \
    "$has_summary" "$has_outcome" \
    "$has_agent" "$has_actions" "$has_files_read" "$has_files_changed" \
    "$has_errors_or_friction" \
    "$has_decisions" "$has_errors_explicit" "$has_friction_explicit" \
    "$has_duration" "$has_tokens"
}

# Write quality.json with field-presence flags
write_quality_json() {
  local outdir="$1" quality="$2" score="$3"
  local s_summary="${4:-0}" s_outcome="${5:-0}"
  local s_agent="${6:-0}" s_actions="${7:-0}" s_files_read="${8:-0}"
  local s_files_changed="${9:-0}" s_errors_or_friction="${10:-0}"
  local s_decisions="${11:-0}" s_errors="${12:-0}" s_friction="${13:-0}"
  local s_duration="${14:-0}" s_tokens="${15:-0}"

  to_bool() { if [ "$1" -eq 1 ] 2>/dev/null; then echo "true"; else echo "false"; fi; }

  cat > "$outdir/quality.json" <<EOF
{
  "trace_quality": "$quality",
  "trace_quality_score": $score,
  "fields": {
    "task_summary": $(to_bool "$s_summary"),
    "outcome": $(to_bool "$s_outcome"),
    "agent": $(to_bool "$s_agent"),
    "actions_taken": $(to_bool "$s_actions"),
    "files_read": $(to_bool "$s_files_read"),
    "files_changed": $(to_bool "$s_files_changed"),
    "errors_or_friction": $(to_bool "$s_errors_or_friction"),
    "decisions_made": $(to_bool "$s_decisions"),
    "errors_explicit": $(to_bool "$s_errors"),
    "friction_explicit": $(to_bool "$s_friction"),
    "duration_or_note": $(to_bool "$s_duration"),
    "token_estimate_or_note": $(to_bool "$s_tokens")
  }
}
EOF
}
