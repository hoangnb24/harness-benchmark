#!/usr/bin/env bash
# benchmark/lib/report.sh — Aggregate results into scores.json + report.md

generate_report() {
  local run_id="$1"
  local run_dir="$2"

  # Collect scores across all tasks
  local total_wall=0 total_func_pass=0 total_func_total=0
  local total_harness_pass=0 total_harness_total=0
  local total_quality_score=0 task_count=0
  local correct_lanes=0
  local total_input_tokens=0 total_output_tokens=0
  local total_cost=0

  for task_dir in "$run_dir"/T*; do
    [ -d "$task_dir" ] || continue
    task_count=$((task_count + 1))
    local task_name
    task_name=$(basename "$task_dir")

    # Time
    if [ -f "$task_dir/timing.json" ]; then
      local wall
      wall=$(jq '.wall_seconds // 0' "$task_dir/timing.json" 2>/dev/null || echo 0)
      total_wall=$((total_wall + wall))
    fi

    # Tokens
    if [ -f "$task_dir/tokens.json" ]; then
      local in_tok out_tok cost
      in_tok=$(jq '.input_tokens // 0' "$task_dir/tokens.json" 2>/dev/null || echo 0)
      out_tok=$(jq '.output_tokens // 0' "$task_dir/tokens.json" 2>/dev/null || echo 0)
      cost=$(jq '.estimated_cost_usd // 0' "$task_dir/tokens.json" 2>/dev/null || echo 0)
      total_input_tokens=$((total_input_tokens + in_tok))
      total_output_tokens=$((total_output_tokens + out_tok))
      total_cost=$(echo "$total_cost + $cost" | bc 2>/dev/null || echo "$total_cost")
    fi

    # Functional
    if [ -f "$task_dir/functional.json" ]; then
      local func_pass func_total
      func_pass=$(jq '[.checks[] | select(.pass==true)] | length' "$task_dir/functional.json" 2>/dev/null || echo 0)
      func_total=$(jq '.checks | length' "$task_dir/functional.json" 2>/dev/null || echo 0)
      total_func_pass=$((total_func_pass + func_pass))
      total_func_total=$((total_func_total + func_total))
    fi

    # Harness compliance
    if [ -f "$task_dir/harness.json" ]; then
      local h_pass h_total
      h_pass=$(jq '[.checks[] | select(.pass==true)] | length' "$task_dir/harness.json" 2>/dev/null || echo 0)
      h_total=$(jq '.checks | length' "$task_dir/harness.json" 2>/dev/null || echo 0)
      total_harness_pass=$((total_harness_pass + h_pass))
      total_harness_total=$((total_harness_total + h_total))
    fi

    # Quality
    if [ -f "$task_dir/quality.json" ]; then
      local q_score
      q_score=$(jq '.trace_quality_score // 0' "$task_dir/quality.json" 2>/dev/null || echo 0)
      total_quality_score=$((total_quality_score + q_score))
    fi

    # Lane accuracy
    if [ -f "$task_dir/lane.json" ]; then
      local expected actual
      expected=$(jq -r '.expected // ""' "$task_dir/lane.json" 2>/dev/null || echo "")
      actual=$(jq -r '.actual // ""' "$task_dir/lane.json" 2>/dev/null || echo "")
      [ "$expected" = "$actual" ] && correct_lanes=$((correct_lanes + 1))
    fi
  done

  # Calculate percentages (avoid division by zero)
  local func_pct=0 harness_pct=0 avg_quality=0
  if [ "$total_func_total" -gt 0 ]; then
    func_pct=$(echo "scale=1; $total_func_pass * 100 / $total_func_total" | bc 2>/dev/null || echo 0)
  fi
  if [ "$total_harness_total" -gt 0 ]; then
    harness_pct=$(echo "scale=1; $total_harness_pass * 100 / $total_harness_total" | bc 2>/dev/null || echo 0)
  fi
  if [ "$task_count" -gt 0 ]; then
    avg_quality=$(echo "scale=1; $total_quality_score / $task_count" | bc 2>/dev/null || echo 0)
  fi

  # Write scores.json
  cat > "$run_dir/scores.json" <<EOF
{
  "run_id": "$run_id",
  "task_count": $task_count,
  "total_wall_seconds": $total_wall,
  "total_input_tokens": $total_input_tokens,
  "total_output_tokens": $total_output_tokens,
  "total_tokens": $((total_input_tokens + total_output_tokens)),
  "estimated_total_cost_usd": $total_cost,
  "functional_pass": $total_func_pass,
  "functional_total": $total_func_total,
  "functional_pct": $func_pct,
  "harness_pass": $total_harness_pass,
  "harness_total": $total_harness_total,
  "harness_pct": $harness_pct,
  "avg_trace_quality": $avg_quality,
  "lane_accuracy": "$correct_lanes/$task_count"
}
EOF

  # Write report.md
  cat > "$run_dir/report.md" <<EOF
# Benchmark Report: $run_id

**Date**: $(date -u +%Y-%m-%dT%H:%M:%SZ)
**Harness**: $(jq -r '.harness_ref' "$run_dir/metadata.json" 2>/dev/null || echo "unknown")
**Agent**: $(jq -r '.agent' "$run_dir/metadata.json" 2>/dev/null || echo "unknown")
**Model**: $(jq -r '.model // "default"' "$run_dir/metadata.json" 2>/dev/null || echo "default")

## Summary

| Metric | Value |
|--------|-------|
| Total wall time | ${total_wall}s ($(echo "scale=1; $total_wall / 60" | bc 2>/dev/null || echo "?")m) |
| Total tokens | $((total_input_tokens + total_output_tokens)) (in: $total_input_tokens, out: $total_output_tokens) |
| Estimated cost | \$${total_cost} |
| Functional score | $total_func_pass/$total_func_total ($func_pct%) |
| Harness compliance | $total_harness_pass/$total_harness_total ($harness_pct%) |
| Avg trace quality | $avg_quality / 3.0 |
| Lane accuracy | $correct_lanes/$task_count |

## Per-Task Results

| Task | Time | Tokens | Functional | Harness | Quality |
|------|------|--------|-----------|---------|---------|
EOF

  # Add per-task rows
  for task_dir in "$run_dir"/T*; do
    [ -d "$task_dir" ] || continue
    local tname wall tokens f_pass f_total h_pass h_total q_score
    tname=$(basename "$task_dir")
    wall=$(jq '.wall_seconds // 0' "$task_dir/timing.json" 2>/dev/null || echo "?")
    tokens=$(jq '.total_tokens // 0' "$task_dir/tokens.json" 2>/dev/null || echo "?")
    f_pass=$(jq '[.checks[] | select(.pass==true)] | length' "$task_dir/functional.json" 2>/dev/null || echo 0)
    f_total=$(jq '.checks | length' "$task_dir/functional.json" 2>/dev/null || echo 0)
    h_pass=$(jq '[.checks[] | select(.pass==true)] | length' "$task_dir/harness.json" 2>/dev/null || echo 0)
    h_total=$(jq '.checks | length' "$task_dir/harness.json" 2>/dev/null || echo 0)
    q_score=$(jq '.trace_quality_score // 0' "$task_dir/quality.json" 2>/dev/null || echo 0)

    echo "| $tname | ${wall}s | $tokens | $f_pass/$f_total | $h_pass/$h_total | $q_score/3 |" >> "$run_dir/report.md"
  done

  echo "" >> "$run_dir/report.md"
  echo "---" >> "$run_dir/report.md"
  echo "*Generated by harness-benchmark runner*" >> "$run_dir/report.md"

  echo "  ✓ Report: $run_dir/report.md"
  echo "  ✓ Scores: $run_dir/scores.json"
}
