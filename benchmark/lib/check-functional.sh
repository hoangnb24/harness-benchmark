#!/usr/bin/env bash
# benchmark/lib/check-functional.sh — API endpoint tests via curl

check_functional() {
  local task="$1"
  local outdir="$2"
  local project_dir="$3"

  local results=()
  local server_pid=""
  local port=3000
  local base_url="http://localhost:$port"

  # Pre-flight: ensure dependencies are installed
  if [ ! -d "$project_dir/node_modules" ]; then
    echo "  node_modules missing — running npm install"
    (cd "$project_dir" && npm install --ignore-scripts 2>&1) | tail -5
    if [ ! -d "$project_dir/node_modules" ]; then
      echo "  FAIL: npm install could not create node_modules"
      local diag="deps_missing: node_modules not found after npm install"
      echo "{\"checks\":[],\"server_started\":false,\"error\":\"$diag\"}" > "$outdir/functional.json"
      return 1
    fi
  fi

  # Kill any leftover process on the target port
  local existing_pid
  existing_pid=$(lsof -ti :$port 2>/dev/null || true)
  if [ -n "$existing_pid" ]; then
    echo "  Killing existing process on port $port (PID $existing_pid)"
    kill $existing_pid 2>/dev/null || true
    sleep 1
  fi

  # Start the server
  (cd "$project_dir" && npm run dev > "$outdir/server.log" 2>&1) &
  server_pid=$!
  sleep 3

  # Check if server process is alive
  if ! kill -0 $server_pid 2>/dev/null; then
    echo "  Server failed to start"
    if [ -f "$outdir/server.log" ]; then
      echo "  Server log (last 10 lines):"
      tail -10 "$outdir/server.log" | sed 's/^/    /'
    fi
    echo "{\"checks\":[],\"server_started\":false,\"error\":\"process_exited\"}" > "$outdir/functional.json"
    return 1
  fi

  # Wait for port to be ready (up to 15s)
  local ready=false
  for i in $(seq 1 15); do
    if curl -s -o /dev/null -w "%{http_code}" "$base_url/health" 2>/dev/null | grep -q "200\|404\|500"; then
      ready=true
      break
    fi
    sleep 1
  done

  if [ "$ready" = "false" ]; then
    echo "  Server not responding on port $port after 15s"
    if [ -f "$outdir/server.log" ]; then
      echo "  Server log (last 10 lines):"
      tail -10 "$outdir/server.log" | sed 's/^/    /'
    fi
    kill $server_pid 2>/dev/null || true
    echo "{\"checks\":[],\"server_started\":false,\"error\":\"port_not_ready\"}" > "$outdir/functional.json"
    return 1
  fi

  # Run task-specific checks
  case "$task" in
    T1-project-setup)
      run_check results "health_status" "GET" "$base_url/health" 200
      run_check results "health_body" "GET" "$base_url/health" 200 --body-contains '"status"'
      ;;

    T2-crud-bookmarks)
      # Create
      run_check results "create_bookmark" "POST" "$base_url/bookmarks" 201 \
        --data '{"url":"https://example.com","title":"Test Bookmark"}'
      # List
      run_check results "list_bookmarks" "GET" "$base_url/bookmarks" 200
      # Get single
      run_check results "get_bookmark" "GET" "$base_url/bookmarks/1" 200
      # Update
      run_check results "update_bookmark" "PUT" "$base_url/bookmarks/1" 200 \
        --data '{"title":"Updated Title"}'
      # Delete
      run_check results "delete_bookmark" "DELETE" "$base_url/bookmarks/1" 204
      # Validation
      run_check results "missing_title" "POST" "$base_url/bookmarks" 400 \
        --data '{"url":"https://example.com"}'
      run_check results "missing_url" "POST" "$base_url/bookmarks" 400 \
        --data '{"title":"No URL"}'
      # Regression
      run_check results "health_regression" "GET" "$base_url/health" 200
      ;;

    T3-folder-support)
      # Folder CRUD
      run_check results "create_folder" "POST" "$base_url/folders" 201 \
        --data '{"name":"Reading List"}'
      run_check results "list_folders" "GET" "$base_url/folders" 200
      run_check results "get_folder" "GET" "$base_url/folders/1" 200
      # Bookmark with folder
      run_check results "bookmark_with_folder" "POST" "$base_url/bookmarks" 201 \
        --data '{"url":"https://example.com","title":"Foldered","folder_id":1}'
      # Regression
      run_check results "bookmark_regression" "GET" "$base_url/bookmarks" 200
      ;;

    T4-authentication)
      # Register
      run_check results "register" "POST" "$base_url/auth/register" 201 \
        --data '{"email":"bench@test.com","password":"benchmark123"}'
      # Duplicate
      run_check results "duplicate_email" "POST" "$base_url/auth/register" 409 \
        --data '{"email":"bench@test.com","password":"benchmark123"}'
      # Login
      local token
      token=$(curl -s -X POST "$base_url/auth/login" \
        -H 'Content-Type: application/json' \
        -d '{"email":"bench@test.com","password":"benchmark123"}' 2>/dev/null | jq -r '.token // empty')
      run_check results "login" "POST" "$base_url/auth/login" 200 \
        --data '{"email":"bench@test.com","password":"benchmark123"}'
      # Wrong password
      run_check results "wrong_password" "POST" "$base_url/auth/login" 401 \
        --data '{"email":"bench@test.com","password":"wrongpass"}'
      # Short password
      run_check results "short_password" "POST" "$base_url/auth/register" 400 \
        --data '{"email":"short@test.com","password":"short"}'
      # Protected (no auth)
      run_check results "protected_no_auth" "GET" "$base_url/bookmarks" 401
      # Protected (with auth)
      if [ -n "$token" ]; then
        run_check results "protected_with_auth" "GET" "$base_url/bookmarks" 200 \
          --header "Authorization: Bearer $token"
        # Create with auth
        run_check results "create_with_auth" "POST" "$base_url/bookmarks" 201 \
          --header "Authorization: Bearer $token" \
          --data '{"url":"https://example.com","title":"Authed Bookmark"}'
      fi
      # User isolation
      local token_b
      local isolation_title="Isolation Bookmark 424242"
      curl -s -X POST "$base_url/auth/register" \
        -H 'Content-Type: application/json' \
        -d '{"email":"bench-b@test.com","password":"benchmark123"}' > /dev/null 2>&1
      token_b=$(curl -s -X POST "$base_url/auth/login" \
        -H 'Content-Type: application/json' \
        -d '{"email":"bench-b@test.com","password":"benchmark123"}' 2>/dev/null | jq -r '.token // empty')

      local isolation_pass=false
      if [ -n "$token" ] && [ -n "$token_b" ]; then
        curl -s -X POST "$base_url/bookmarks" \
          -H "Authorization: Bearer $token" \
          -H 'Content-Type: application/json' \
          -d "{\"url\":\"https://isolation.example.com/424242\",\"title\":\"$isolation_title\"}" > /dev/null 2>&1

        local user_b_bookmarks
        user_b_bookmarks=$(curl -s "$base_url/bookmarks" -H "Authorization: Bearer $token_b" 2>/dev/null)
        if ! printf '%s' "$user_b_bookmarks" | grep -q "$isolation_title"; then
          isolation_pass=true
        fi
      fi
      add_functional_check results "user_isolation" "$isolation_pass"
      ;;

    T5-bug-fix)
      # Login first
      local token
      token=$(curl -s -X POST "$base_url/auth/login" \
        -H 'Content-Type: application/json' \
        -d '{"email":"bench@test.com","password":"benchmark123"}' 2>/dev/null | jq -r '.token // empty')
      # If no existing user, register first
      if [ -z "$token" ]; then
        curl -s -X POST "$base_url/auth/register" \
          -H 'Content-Type: application/json' \
          -d '{"email":"bench@test.com","password":"benchmark123"}' > /dev/null 2>&1
        token=$(curl -s -X POST "$base_url/auth/login" \
          -H 'Content-Type: application/json' \
          -d '{"email":"bench@test.com","password":"benchmark123"}' 2>/dev/null | jq -r '.token // empty')
      fi

      if [ -n "$token" ]; then
        run_check results "empty_title_400" "POST" "$base_url/bookmarks" 400 \
          --header "Authorization: Bearer $token" \
          --data '{"url":"https://example.com","title":""}'
        run_check results "empty_url_400" "POST" "$base_url/bookmarks" 400 \
          --header "Authorization: Bearer $token" \
          --data '{"url":"","title":"Test"}'
        run_check results "valid_still_works" "POST" "$base_url/bookmarks" 201 \
          --header "Authorization: Bearer $token" \
          --data '{"url":"https://example.com","title":"Valid"}'
      fi
      # Folder empty name
      if [ -n "$token" ]; then
        run_check results "empty_folder_name" "POST" "$base_url/folders" 400 \
          --header "Authorization: Bearer $token" \
          --data '{"name":""}'
      fi
      ;;

    T6-pagination)
      # Login
      local token
      token=$(curl -s -X POST "$base_url/auth/login" \
        -H 'Content-Type: application/json' \
        -d '{"email":"bench@test.com","password":"benchmark123"}' 2>/dev/null | jq -r '.token // empty')
      if [ -z "$token" ]; then
        curl -s -X POST "$base_url/auth/register" \
          -H 'Content-Type: application/json' \
          -d '{"email":"bench@test.com","password":"benchmark123"}' > /dev/null 2>&1
        token=$(curl -s -X POST "$base_url/auth/login" \
          -H 'Content-Type: application/json' \
          -d '{"email":"bench@test.com","password":"benchmark123"}' 2>/dev/null | jq -r '.token // empty')
      fi

      if [ -n "$token" ]; then
        # Check paginated response shape
        local response
        response=$(curl -s "$base_url/bookmarks" -H "Authorization: Bearer $token" 2>/dev/null)

        # Has expected fields
        run_check_json results "has_data_field" "$response" '.data'
        run_check_json results "has_page_field" "$response" '.page'
        run_check_json results "has_limit_field" "$response" '.limit'
        run_check_json results "has_total_field" "$response" '.total'
        run_check_json results "data_is_array" "$response" '.data | type == "array"'

        # Custom pagination
        run_check results "custom_limit" "GET" "$base_url/bookmarks?page=1&limit=5" 200 \
          --header "Authorization: Bearer $token"

        # Invalid
        run_check results "invalid_page" "GET" "$base_url/bookmarks?page=0" 400 \
          --header "Authorization: Bearer $token"
        run_check results "invalid_limit" "GET" "$base_url/bookmarks?limit=200" 400 \
          --header "Authorization: Bearer $token"

        # Auth still required
        run_check results "still_protected" "GET" "$base_url/bookmarks" 401
      fi
      ;;
  esac

  # Stop server
  kill $server_pid 2>/dev/null || true
  wait $server_pid 2>/dev/null || true

  # Write results
  write_functional_json "$outdir/functional.json" "${results[@]}"
}

# Helper: run a single endpoint check
run_check() {
  local arr="$1"; shift
  local name="$1"; shift
  local method="$1"; shift
  local url="$1"; shift
  local expected_status="$1"; shift

  local extra_args=()
  local body_contains=""
  while [[ $# -gt 0 ]]; do
    case $1 in
      --data) extra_args+=(-H 'Content-Type: application/json' -d "$2"); shift 2 ;;
      --header) extra_args+=(-H "$2"); shift 2 ;;
      --body-contains) body_contains="$2"; shift 2 ;;
      *) shift ;;
    esac
  done

  local response_code response_body
  response_body=$(curl -s -w "\n%{http_code}" -X "$method" "${extra_args[@]}" "$url" 2>/dev/null)
  response_code=$(echo "$response_body" | tail -1)
  response_body=$(echo "$response_body" | sed '$d')

  local pass=false
  if [ "$response_code" = "$expected_status" ]; then
    pass=true
  fi

  # Optional body check
  if [ -n "$body_contains" ] && [ "$pass" = "true" ]; then
    if ! echo "$response_body" | grep -q "$body_contains"; then
      pass=false
    fi
  fi

  eval "${arr}+=(\"{\\\"name\\\":\\\"$name\\\",\\\"pass\\\":$pass,\\\"expected\\\":$expected_status,\\\"actual\\\":\\\"$response_code\\\"}\")"
}

add_functional_check() {
  local arr="$1"
  local name="$2"
  local pass="$3"

  eval "${arr}+=(\"{\\\"name\\\":\\\"$name\\\",\\\"pass\\\":$pass}\")"
}

# Helper: check JSON response field
run_check_json() {
  local arr="$1"; shift
  local name="$1"; shift
  local json="$1"; shift
  local jq_expr="$1"; shift

  local pass=false
  if echo "$json" | jq -e "$jq_expr" > /dev/null 2>&1; then
    pass=true
  fi

  eval "${arr}+=(\"{\\\"name\\\":\\\"$name\\\",\\\"pass\\\":$pass}\")"
}

# Helper: write results JSON
write_functional_json() {
  local outfile="$1"; shift
  local checks=("$@")

  echo -n '{"server_started":true,"checks":[' > "$outfile"
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
