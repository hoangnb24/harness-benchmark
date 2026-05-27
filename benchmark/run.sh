#!/usr/bin/env bash
set -euo pipefail

# Benchmark Runner — Main Orchestrator
# Usage: ./benchmark/run.sh --agent codex --harness main --run-id baseline

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ORIGINAL_ARGS=("$@")

AGENT="codex"
AGENT_CMD=""
HARNESS_REF="main"
RUN_ID="run-$(date +%Y%m%d-%H%M%S)"
MODEL=""
TASK_TIMEOUT=600
ISOLATE=1

# Parse args
while [[ $# -gt 0 ]]; do
  case $1 in
    --agent)       AGENT="$2"; shift 2 ;;
    --agent-cmd)   AGENT_CMD="$2"; shift 2 ;;
    --harness)     HARNESS_REF="$2"; shift 2 ;;
    --run-id)      RUN_ID="$2"; shift 2 ;;
    --model)       MODEL="$2"; shift 2 ;;
    --timeout)     TASK_TIMEOUT="$2"; shift 2 ;;
    --no-isolate)  ISOLATE=0; shift ;;
    -h|--help)
      echo "Usage: $0 --agent codex --harness main --run-id baseline [--model o4-mini] [--timeout 600] [--no-isolate]"
      exit 0
      ;;
    *)             echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [ "$ISOLATE" -eq 1 ] && [ "${HARNESS_BENCHMARK_ISOLATED:-0}" != "1" ]; then
  safe_run_id="$(printf '%s' "$RUN_ID" | tr -c 'A-Za-z0-9._-' '-')"
  safe_agent="$(printf '%s' "$AGENT" | tr -c 'A-Za-z0-9._-' '-')"
  safe_harness_ref="$(printf '%s' "$HARNESS_REF" | tr -c 'A-Za-z0-9._-' '-')"
  safe_model="$(printf '%s' "${MODEL:-default}" | tr -c 'A-Za-z0-9._-' '-')"
  ISOLATED_PROJECT_DIR="/tmp/harness-benchmark-${safe_run_id}-${safe_agent}-${safe_harness_ref}-${safe_model}"
  ORIGINAL_RUN_DIR="$SCRIPT_DIR/runs/$RUN_ID"

  echo "Preparing isolated benchmark workspace: $ISOLATED_PROJECT_DIR"
  rm -rf "$ISOLATED_PROJECT_DIR"
  git clone --quiet "$PROJECT_DIR" "$ISOLATED_PROJECT_DIR"

  mkdir -p "$(dirname "$ORIGINAL_RUN_DIR")"
  set +e
  (
    cd "$ISOLATED_PROJECT_DIR"
    HARNESS_BENCHMARK_ISOLATED=1 \
    HARNESS_BENCHMARK_ORIGINAL_PROJECT_DIR="$PROJECT_DIR" \
      ./benchmark/run.sh "${ORIGINAL_ARGS[@]}"
  )
  child_exit=$?
  set -e

  copied_back=0
  if [ -d "$ISOLATED_PROJECT_DIR/benchmark/runs/$RUN_ID" ]; then
    rm -rf "$ORIGINAL_RUN_DIR"
    mkdir -p "$(dirname "$ORIGINAL_RUN_DIR")"
    cp -R "$ISOLATED_PROJECT_DIR/benchmark/runs/$RUN_ID" "$ORIGINAL_RUN_DIR"
    copied_back=1
  fi

  echo ""
  echo "╔═══════════════════════════════════════════════════╗"
  if [ "$copied_back" -eq 1 ]; then
    echo "║  ISOLATED RUN COPIED BACK                        ║"
  else
    echo "║  ISOLATED RUN HAD NO RESULT DIRECTORY            ║"
  fi
  echo "║  Workspace: $ISOLATED_PROJECT_DIR"
  echo "║  Report:    $ORIGINAL_RUN_DIR/report.md"
  echo "║  Scores:    $ORIGINAL_RUN_DIR/scores.json"
  echo "╚═══════════════════════════════════════════════════╝"
  exit "$child_exit"
fi

RUN_DIR="$SCRIPT_DIR/runs/$RUN_ID"
mkdir -p "$RUN_DIR"

echo "╔═══════════════════════════════════════════════════╗"
echo "║  HARNESS BENCHMARK                               ║"
echo "╠═══════════════════════════════════════════════════╣"
echo "║  Agent:   $AGENT"
echo "║  Harness: $HARNESS_REF"
echo "║  Run ID:  $RUN_ID"
echo "║  Model:   ${MODEL:-default}"
echo "║  Timeout: ${TASK_TIMEOUT}s per task"
echo "╚═══════════════════════════════════════════════════╝"
echo ""

# Record metadata
cat > "$RUN_DIR/metadata.json" <<EOF
{
  "run_id": "$RUN_ID",
  "date": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "harness_ref": "$HARNESS_REF",
  "agent": "$AGENT",
  "model": "$MODEL",
  "task_timeout_seconds": $TASK_TIMEOUT,
  "isolated": $([ "${HARNESS_BENCHMARK_ISOLATED:-0}" = "1" ] && echo true || echo false),
  "original_project_dir": "${HARNESS_BENCHMARK_ORIGINAL_PROJECT_DIR:-$PROJECT_DIR}",
  "workspace_dir": "$PROJECT_DIR",
  "benchmark_sha": "$(git -C "$PROJECT_DIR" rev-parse HEAD 2>/dev/null || echo 'unknown')"
}
EOF

# Step 1: Install harness from the specified ref
source "$SCRIPT_DIR/lib/prepare.sh"
install_harness "$HARNESS_REF" "$PROJECT_DIR"

# Step 2: Run each task sequentially
TASKS=(T1-project-setup T2-crud-bookmarks T3-folder-support T4-authentication T5-bug-fix T6-pagination)

TASK_NUM=0
TOTAL_TASKS=${#TASKS[@]}

for task in "${TASKS[@]}"; do
  TASK_NUM=$((TASK_NUM + 1))
  echo ""
  echo "═══════════════════════════════════════"
  echo "  [$TASK_NUM/$TOTAL_TASKS] TASK: $task"
  echo "═══════════════════════════════════════"

  TASK_DIR="$RUN_DIR/$task"
  mkdir -p "$TASK_DIR"

  # Snapshot durable-layer counts before the agent runs so harness scoring is
  # per-task instead of cumulative across the full benchmark.
  source "$SCRIPT_DIR/lib/check-harness.sh"
  record_harness_baseline "$TASK_DIR" "$PROJECT_DIR"

  # Invoke agent
  source "$SCRIPT_DIR/lib/invoke.sh"
  invoke_agent "$AGENT" "$task" "$TASK_DIR" "$PROJECT_DIR" || true
  # Continue even if agent fails — failure is data

  # Run checks (only if server-dependent checks are possible)
  source "$SCRIPT_DIR/lib/check-functional.sh"
  check_functional "$task" "$TASK_DIR" "$PROJECT_DIR" || true

  check_harness "$task" "$TASK_DIR" "$PROJECT_DIR" || true

  source "$SCRIPT_DIR/lib/check-quality.sh"
  check_quality "$task" "$TASK_DIR" "$PROJECT_DIR" || true

  echo "  ✓ $task scored"
done

# Step 3: Generate report
echo ""
echo "═══════════════════════════════════════"
echo "  GENERATING REPORT"
echo "═══════════════════════════════════════"

source "$SCRIPT_DIR/lib/report.sh"
generate_report "$RUN_ID" "$RUN_DIR"

echo ""
echo "╔═══════════════════════════════════════════════════╗"
echo "║  RUN COMPLETE: $RUN_ID"
echo "║  Report: $RUN_DIR/report.md"
echo "║  Scores: $RUN_DIR/scores.json"
echo "╚═══════════════════════════════════════════════════╝"
