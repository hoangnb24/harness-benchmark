#!/usr/bin/env bash
# benchmark/lib/prepare.sh — Harness installation from git ref

checkout_harness_ref() {
  local harness_ref="$1"
  local harness_dir="$2"

  git -C "$harness_dir" fetch --all --prune --quiet

  if git -C "$harness_dir" show-ref --verify --quiet "refs/remotes/origin/$harness_ref"; then
    git -C "$harness_dir" checkout --detach "origin/$harness_ref" --quiet
  else
    git -C "$harness_dir" checkout "$harness_ref" --quiet 2>/dev/null || \
      git -C "$harness_dir" checkout --detach "$harness_ref" --quiet
  fi
}

build_and_install_harness_cli() {
  local harness_dir="$1"
  local project_dir="$2"
  local binary_name="harness-cli"
  local built_binary="$harness_dir/target/release/$binary_name"
  local target_binary="$project_dir/scripts/bin/harness-cli"

  command -v cargo >/dev/null 2>&1 || {
    echo "  ERROR: cargo is required to build the Harness Rust CLI from the requested ref" >&2
    return 1
  }

  echo "  Building Harness Rust CLI from checked-out ref..."
  (cd "$harness_dir" && cargo build --quiet --package harness-cli --release)

  if [ ! -f "$built_binary" ]; then
    echo "  ERROR: Expected Harness CLI binary missing: $built_binary" >&2
    return 1
  fi

  mkdir -p "$(dirname "$target_binary")"
  cp "$built_binary" "$target_binary"
  chmod 755 "$target_binary"
  echo "  Installed locally built Harness CLI: $target_binary"
}

install_harness() {
  local harness_ref="$1"
  local project_dir="$2"

  echo "  Installing harness from ref: $harness_ref"

  # Clone or fetch repository-harness. The benchmark must use the Rust CLI built
  # from the requested ref, not the latest prebuilt release downloaded by the
  # installer.
  local harness_repo_url="${HARNESS_REPO_URL:-https://github.com/hoangnb24/repository-harness.git}"
  local harness_dir="${HARNESS_REPO_DIR:-/tmp/repository-harness}"

  if [ -d "$harness_dir" ]; then
    git -C "$harness_dir" remote set-url origin "$harness_repo_url"
  else
    git clone --quiet "$harness_repo_url" "$harness_dir"
  fi

  checkout_harness_ref "$harness_ref" "$harness_dir"
  build_and_install_harness_cli "$harness_dir" "$project_dir"

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

  # Initialize harness database if the Rust CLI is available.
  if [ -x "$project_dir/scripts/bin/harness-cli" ]; then
    (cd "$project_dir" && ./scripts/bin/harness-cli init 2>/dev/null || true)
  fi

  echo "  ✓ Harness installed from '$harness_ref'"
}
