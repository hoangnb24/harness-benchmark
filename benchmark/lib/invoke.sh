#!/usr/bin/env bash
# benchmark/lib/invoke.sh — Agent invocation with full telemetry capture

invoke_agent() {
  local agent="$1"
  local task="$2"
  local outdir="$3"
  local project_dir="$4"

  local task_file="$SCRIPT_DIR/tasks/${task}.md"
  local start_time end_time wall_seconds exit_code

  if [ ! -f "$task_file" ]; then
    echo "  ERROR: Task file not found: $task_file" >&2
    echo '{"error":"task_file_not_found"}' > "$outdir/timing.json"
    return 1
  fi

  start_time=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)

  case "$agent" in
    codex)
      invoke_codex "$task_file" "$outdir" "$project_dir"
      exit_code=$?
      ;;
    claude)
      invoke_claude "$task_file" "$outdir" "$project_dir"
      exit_code=$?
      ;;
    custom)
      invoke_custom "$AGENT_CMD" "$task_file" "$outdir" "$project_dir"
      exit_code=$?
      ;;
    *)
      echo "  ERROR: Unknown agent '$agent'" >&2
      exit_code=1
      ;;
  esac

  end_time=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)

  # Calculate wall time
  local start_epoch end_epoch
  start_epoch=$(date -d "$start_time" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%S" "${start_time%%.*}" +%s 2>/dev/null || echo 0)
  end_epoch=$(date -d "$end_time" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%S" "${end_time%%.*}" +%s 2>/dev/null || echo 0)
  wall_seconds=$((end_epoch - start_epoch))

  # Write timing
  cat > "$outdir/timing.json" <<EOF
{
  "start": "$start_time",
  "end": "$end_time",
  "wall_seconds": $wall_seconds,
  "exit_code": $exit_code,
  "timed_out": $([ "$exit_code" -eq 124 ] && echo true || echo false)
}
EOF

  echo "  Time: ${wall_seconds}s | Exit: $exit_code"
  return $exit_code
}

invoke_codex() {
  local task_file="$1"
  local outdir="$2"
  local project_dir="$3"
  local codex_exit

  # Build the command
  local cmd=(timeout "$TASK_TIMEOUT" codex exec
    --sandbox danger-full-access
    --json
    --color never
  )

  # Codex CLI 0.133.0 removed --ask-for-approval. Keep older CLI support
  # without passing an unknown option to newer versions.
  if codex exec --help 2>/dev/null | grep -q -- '--ask-for-approval'; then
    cmd+=(--ask-for-approval never)
  fi

  # Optional model override
  if [ -n "${MODEL:-}" ]; then
    cmd+=(--model "$MODEL")
  fi

  # Set working directory to the benchmark project
  cmd+=(-C "$project_dir")

  echo "  Running: codex exec -C $project_dir < $task_file"

  # Execute: prompt from file, JSONL to stdout, progress to stderr
  "${cmd[@]}" < "$task_file" \
    > "$outdir/events.jsonl" \
    2> "$outdir/stderr.log"
  codex_exit=$?

  # Parse JSONL to extract structured data
  parse_codex_events "$outdir"

  return $codex_exit
}

invoke_claude() {
  local task_file="$1"
  local outdir="$2"
  local project_dir="$3"

  local prompt
  prompt=$(cat "$task_file")

  echo "  Running: claude -p (task from file)"

  timeout "$TASK_TIMEOUT" claude -p "$prompt" \
    --allowedTools "Edit,Write,Bash" \
    --output-format json \
    2> "$outdir/stderr.log" \
    | tee "$outdir/events.jsonl" > /dev/null

  local claude_exit=$?

  # Basic token extraction for Claude (format differs)
  echo '{"input_tokens":0,"output_tokens":0,"cached_input_tokens":0,"total_tokens":0,"estimated_cost_usd":0}' \
    > "$outdir/tokens.json"

  return $claude_exit
}

invoke_custom() {
  local agent_cmd="$1"
  local task_file="$2"
  local outdir="$3"
  local project_dir="$4"

  local prompt
  prompt=$(cat "$task_file")

  echo "  Running: $agent_cmd (custom)"

  (cd "$project_dir" && timeout "$TASK_TIMEOUT" $agent_cmd "$prompt") \
    > "$outdir/agent-output.log" \
    2> "$outdir/stderr.log"

  local custom_exit=$?

  echo '{"input_tokens":0,"output_tokens":0,"cached_input_tokens":0,"total_tokens":0,"estimated_cost_usd":0}' \
    > "$outdir/tokens.json"

  return $custom_exit
}

parse_codex_events() {
  local outdir="$1"
  local events_file="$outdir/events.jsonl"

  # If events file is empty or doesn't exist, write zeros
  if [ ! -s "$events_file" ]; then
    echo '{"input_tokens":0,"output_tokens":0,"cached_input_tokens":0,"total_tokens":0,"estimated_cost_usd":0}' \
      > "$outdir/tokens.json"
    echo "" > "$outdir/agent-output.log"
    echo "" > "$outdir/thread_id.txt"
    echo '{"thread_id":"","turn_count":0,"item_count":0,"error_count":0,"file_changes":0,"commands_run":0}' \
      > "$outdir/session-meta.json"
    return
  fi

  # Extract token usage (sum all turn.completed events)
  local input_tokens cached_tokens output_tokens
  input_tokens=$(jq -s '[.[] | select(.type=="turn.completed") | .usage.input_tokens // 0] | add // 0' "$events_file" 2>/dev/null || echo 0)
  cached_tokens=$(jq -s '[.[] | select(.type=="turn.completed") | .usage.cached_input_tokens // 0] | add // 0' "$events_file" 2>/dev/null || echo 0)
  output_tokens=$(jq -s '[.[] | select(.type=="turn.completed") | .usage.output_tokens // 0] | add // 0' "$events_file" 2>/dev/null || echo 0)

  local total_tokens=$((input_tokens + output_tokens))
  # Cost estimate: ~$3/M input, ~$12/M output (o4-mini approximate)
  local cost
  cost=$(echo "scale=4; ($input_tokens * 0.000003) + ($output_tokens * 0.000012)" | bc 2>/dev/null || echo "0")
  case "$cost" in
    .*) cost="0$cost" ;;
    -.*) cost="-0${cost#-}" ;;
  esac

  cat > "$outdir/tokens.json" <<EOF
{
  "input_tokens": $input_tokens,
  "cached_input_tokens": $cached_tokens,
  "output_tokens": $output_tokens,
  "total_tokens": $total_tokens,
  "estimated_cost_usd": $cost
}
EOF

  # Extract the final agent message
  jq -r 'select(.type=="item.completed") | select(.item.item_type=="assistant_message" or .item.type=="assistant_message" or .item.type=="agent_message") | .item.text // empty' \
    "$events_file" 2>/dev/null | tail -1 > "$outdir/agent-output.log"

  # Extract thread ID
  jq -r 'select(.type=="thread.started") | .thread_id // empty' "$events_file" 2>/dev/null \
    > "$outdir/thread_id.txt"

  # Session metadata
  local turn_count item_count error_count file_changes commands_run thread_id
  turn_count=$(jq -s '[.[] | select(.type=="turn.completed")] | length' "$events_file" 2>/dev/null || echo 0)
  item_count=$(jq -s '[.[] | select(.type=="item.completed")] | length' "$events_file" 2>/dev/null || echo 0)
  error_count=$(jq -s '[.[] | select(.type=="turn.failed" or .type=="error")] | length' "$events_file" 2>/dev/null || echo 0)
  file_changes=$(jq -s '[.[] | select(.type=="item.completed") | select(.item.item_type=="file_change" or .item.type=="file_change")] | length' "$events_file" 2>/dev/null || echo 0)
  commands_run=$(jq -s '[.[] | select(.type=="item.completed") | select(.item.item_type=="command_execution" or .item.type=="command_execution")] | length' "$events_file" 2>/dev/null || echo 0)
  thread_id=$(cat "$outdir/thread_id.txt" 2>/dev/null || echo "")

  cat > "$outdir/session-meta.json" <<EOF
{
  "thread_id": "$thread_id",
  "turn_count": $turn_count,
  "item_count": $item_count,
  "error_count": $error_count,
  "file_changes": $file_changes,
  "commands_run": $commands_run
}
EOF
}
