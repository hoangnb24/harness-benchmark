#!/usr/bin/env bash
# benchmark/lib/prepare.sh — Harness installation from git ref

install_harness() {
  local harness_ref="$1"
  local project_dir="$2"

  echo "  Installing harness from ref: $harness_ref"

  # Clone or fetch harness-experimental
  local harness_dir="/tmp/harness-experimental"

  if [ -d "$harness_dir" ]; then
    git -C "$harness_dir" fetch --all --quiet
  else
    git clone --quiet https://github.com/hoangnb24/harness-experimental.git "$harness_dir"
  fi

  # Checkout the specified ref
  git -C "$harness_dir" checkout "$harness_ref" --quiet 2>/dev/null || \
    git -C "$harness_dir" checkout "origin/$harness_ref" --quiet

  # Run the harness installer into the benchmark project
  if [ -f "$harness_dir/scripts/install-harness.sh" ]; then
    (cd "$project_dir" && bash "$harness_dir/scripts/install-harness.sh" --yes --merge)
  else
    echo "  WARNING: No install-harness.sh found at ref '$harness_ref'"
    echo "  Copying harness files manually..."

    # Manual fallback: copy key harness files
    mkdir -p "$project_dir/docs"
    cp -f "$harness_dir/docs/HARNESS.md" "$project_dir/docs/" 2>/dev/null || true
    cp -f "$harness_dir/docs/FEATURE_INTAKE.md" "$project_dir/docs/" 2>/dev/null || true
    cp -f "$harness_dir/docs/ARCHITECTURE.md" "$project_dir/docs/" 2>/dev/null || true
    cp -f "$harness_dir/AGENTS.md" "$project_dir/" 2>/dev/null || true

    # Copy scripts
    mkdir -p "$project_dir/scripts"
    cp -f "$harness_dir/scripts/harness" "$project_dir/scripts/" 2>/dev/null || true
    cp -rf "$harness_dir/scripts/schema" "$project_dir/scripts/" 2>/dev/null || true
  fi

  # Initialize harness database if the CLI is available
  if [ -x "$project_dir/scripts/harness" ]; then
    (cd "$project_dir" && ./scripts/harness init 2>/dev/null || true)
  fi

  echo "  ✓ Harness installed from '$harness_ref'"
}
