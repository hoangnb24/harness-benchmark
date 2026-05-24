#!/usr/bin/env bash
set -euo pipefail

# Compare two benchmark runs side by side
# Usage: ./benchmark/compare.sh <run-id-1> <run-id-2>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ $# -lt 2 ]; then
  echo "Usage: $0 <run-id-1> <run-id-2>"
  echo "Example: $0 baseline phase-2"
  exit 1
fi

RUN1="$1"
RUN2="$2"
SCORES1="$SCRIPT_DIR/runs/$RUN1/scores.json"
SCORES2="$SCRIPT_DIR/runs/$RUN2/scores.json"

if [ ! -f "$SCORES1" ]; then
  echo "ERROR: Scores not found for run '$RUN1': $SCORES1"
  exit 1
fi
if [ ! -f "$SCORES2" ]; then
  echo "ERROR: Scores not found for run '$RUN2': $SCORES2"
  exit 1
fi

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║  BENCHMARK COMPARISON: $RUN1 vs $RUN2"
echo "╠═══════════════════════════════════════════════════════════════╣"
echo ""

# Read values
get_val() { jq -r "$2 // \"?\"" "$1" 2>/dev/null || echo "?"; }

r1_wall=$(get_val "$SCORES1" '.total_wall_seconds')
r2_wall=$(get_val "$SCORES2" '.total_wall_seconds')
r1_tokens=$(get_val "$SCORES1" '.total_tokens')
r2_tokens=$(get_val "$SCORES2" '.total_tokens')
r1_cost=$(get_val "$SCORES1" '.estimated_total_cost_usd')
r2_cost=$(get_val "$SCORES2" '.estimated_total_cost_usd')
r1_func=$(get_val "$SCORES1" '.functional_pct')
r2_func=$(get_val "$SCORES2" '.functional_pct')
r1_harness=$(get_val "$SCORES1" '.harness_pct')
r2_harness=$(get_val "$SCORES2" '.harness_pct')
r1_quality=$(get_val "$SCORES1" '.avg_trace_quality')
r2_quality=$(get_val "$SCORES2" '.avg_trace_quality')
r1_lanes=$(get_val "$SCORES1" '.lane_accuracy')
r2_lanes=$(get_val "$SCORES2" '.lane_accuracy')

# Calculate deltas
delta() {
  local v1="$1" v2="$2"
  if [[ "$v1" =~ ^[0-9] ]] && [[ "$v2" =~ ^[0-9] ]]; then
    echo "scale=1; $v2 - $v1" | bc 2>/dev/null || echo "?"
  else
    echo "?"
  fi
}

printf "║ %-22s │ %-12s │ %-12s │ %-8s ║\n" "Metric" "$RUN1" "$RUN2" "Delta"
echo "╠════════════════════════╪══════════════╪══════════════╪══════════╣"
printf "║ %-22s │ %10ss │ %10ss │ %+6ss ║\n" "Wall time" "$r1_wall" "$r2_wall" "$(delta "$r1_wall" "$r2_wall")"
printf "║ %-22s │ %12s │ %12s │ %+8s ║\n" "Total tokens" "$r1_tokens" "$r2_tokens" "$(delta "$r1_tokens" "$r2_tokens")"
printf "║ %-22s │ %11s$ │ %11s$ │ %+7s$ ║\n" "Cost" "$r1_cost" "$r2_cost" "$(delta "$r1_cost" "$r2_cost")"
printf "║ %-22s │ %10s%% │ %10s%% │ %+6s%% ║\n" "Functional" "$r1_func" "$r2_func" "$(delta "$r1_func" "$r2_func")"
printf "║ %-22s │ %10s%% │ %10s%% │ %+6s%% ║\n" "Harness compliance" "$r1_harness" "$r2_harness" "$(delta "$r1_harness" "$r2_harness")"
printf "║ %-22s │ %12s │ %12s │ %+8s ║\n" "Avg trace quality" "$r1_quality" "$r2_quality" "$(delta "$r1_quality" "$r2_quality")"
printf "║ %-22s │ %12s │ %12s │          ║\n" "Lane accuracy" "$r1_lanes" "$r2_lanes"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Interpretation
echo "Interpretation:"
echo ""

harness_delta=$(delta "$r1_harness" "$r2_harness")
quality_delta=$(delta "$r1_quality" "$r2_quality")

if [[ "$harness_delta" != "?" ]] && (( $(echo "$harness_delta > 20" | bc 2>/dev/null || echo 0) )); then
  echo "  ✓ Harness compliance improved by ${harness_delta}% — Phase is working"
elif [[ "$harness_delta" != "?" ]] && (( $(echo "$harness_delta > 0" | bc 2>/dev/null || echo 0) )); then
  echo "  ~ Harness compliance improved slightly (+${harness_delta}%) — needs iteration"
else
  echo "  ✗ Harness compliance did not improve — Phase may not be effective"
fi

if [[ "$quality_delta" != "?" ]] && (( $(echo "$quality_delta > 0.5" | bc 2>/dev/null || echo 0) )); then
  echo "  ✓ Trace quality improved by $quality_delta — agents are writing better traces"
fi

echo ""
