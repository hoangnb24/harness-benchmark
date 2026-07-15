# US-029 E13 Decision Runner Prelock

## Status and Boundary

Implemented and verified with local stubs only. No installed Codex executable,
provider model, API billing, ChatGPT-plan quota, or purchased credit was used.
This story prepares the runner; it does not approve Gate D0 or Gate D.

## Cause and Effect

Gate C had two blockers for a real decision run:

1. The plan could select only a fake command. Therefore it could not bind a
   future run to one reviewed Codex executable, login mode, model request,
   policy, and price card.
2. A "cumulative" sequence used ordinary atomic cells. Every cell recreated
   the fixture and reapplied the treatment. Therefore S02 could not inspect
   S01's changes, and S03 could not inspect the combined S01/S02 state.

US-029 adds an authorization-gated Codex adapter and a distinct cumulative
journey executor. Fake plans remain supported.

## Exact Authorization Contract

A Codex plan identifies an absolute, canonical, regular executable by path,
SHA-256, and exact `codex-cli <version>` output. It also identifies:

- calibration or decision scope;
- protocol, pricing-policy, and tool-policy files by SHA-256;
- declared model, reasoning effort, runtime, sandbox, corpus, cells, and
  cumulative journeys;
- the exact new/empty canonical run directory; and
- the SHA-256 of the complete execution plan excluding only the authorization
  file identity, which avoids a circular hash.

The authorization is a separate, checksum-pinned JSON file with an exact field
set. Calibration scope requires Gate D0, `authorizesCalibration: true`, and
`authorizesUS110: false`. Decision scope requires Gate D and
`authorizesUS110: true`. Both require ChatGPT authentication and explicitly
reject API billing, purchased credits, and overage.

The CLI requires two deliberate operator inputs before any Codex launch:

```text
--allow-live-codex
--approved-authorization-sha <exact lowercase SHA-256>
```

Cause and effect: changing a cell, treatment, run ID, model, policy, executable,
scope, or run directory changes or contradicts the approved identity, so the
runner fails before a model process. A missing literal flag or mismatched
external approval hash also fails before launch. The named approver fields are
procedural evidence; the external exact-hash input is the independent operator
confirmation, not a cryptographic signature.

Before version/login checks, all atomic and cumulative fixtures, corpus locks,
rubrics, manifests, start commits, and treatment applications are validated in
temporary workspaces. Thus a bad later plan item cannot consume quota after an
earlier item passes.

## Codex Process Contract

The executable must pass, in order:

1. canonical-path and SHA-256 validation;
2. exact `--version` output;
3. exact `login status` output of `Logged in using ChatGPT` on either its sole
   stdout or sole stderr channel (Codex 0.144.3 emits the status on stderr); and
4. a second executable identity check.

The identity is checked again immediately before every model subprocess. The
adapter spawns an argv array with `shell: false`:

```text
exec --json --ephemeral --ignore-user-config --strict-config
  --model <declared-model>
  -c model_reasoning_effort="<declared-effort>"
  -c approval_policy="never"
  -c features.apps=false
  -c features.auth_elicitation=false
  -c features.browser_use=false
  -c features.browser_use_external=false
  -c features.browser_use_full_cdp_access=false
  -c features.computer_use=false
  -c features.enable_fanout=false
  -c features.enable_mcp_apps=false
  -c features.goals=false
  -c features.image_generation=false
  -c features.in_app_browser=false
  -c features.multi_agent=false
  -c features.plugins=false
  -c features.remote_plugin=false
  -c features.skill_mcp_dependency_install=false
  -c features.tool_call_mcp_elicitation=false
  -c sandbox_workspace_write.network_access=false
  -c web_search="disabled"
  --sandbox workspace-write
  -C <isolated-workspace>
  --add-dir <isolated-submission>
```

The prompt is sent on stdin. The environment is an allowlist and omits
`OPENAI_API_KEY` and `CODEX_HOME`. The policy permits shell and `apply_patch`
work inside the isolated directories; connectors, MCP, subagents, browser,
computer, image, web search, and network are disabled by the pinned feature
overrides. If retained JSONL nevertheless reports an unexpected completed item
type, the cell is marked with exit 126. This is a layered enforcement contract,
not a claim that Codex exposes a separate formal tool-allowlist flag.

The requested model is pinned. The provider-resolved model may remain typed
`unknown` when the CLI does not emit a trustworthy resolved-model snapshot; the
runner never invents one.

Each invocation owns a process group. A timeout kills the group and reports
exit 124, while an ordinary signal remains separately observable. This prevents
a background child from writing into later evaluation state.

## Telemetry and Stops

Raw stdout JSONL and stderr bytes are retained. The final complete Codex usage
event supplies input, cached-input, and output tokens. Tool-loop count uses
unique completed command/file-change item IDs. Plan credits are recomputed from
the checksum-pinned, model-specific ChatGPT credit-rate policy. USD cost stays
typed `unknown` because the approved adapter is not an API-billing path.

Missing or malformed required telemetry stays typed `unknown`; it is never
converted to zero. Unknown credit telemetry stops later invocations.

One shared elapsed deadline starts before local plan preflight. Local fixture
and treatment preflight is not forcibly terminated by that deadline, but if it
runs past the limit the runner refuses to launch Codex afterward. Version,
login, and model subprocess timeouts are each clipped to the remaining shared
time. The invocation ceiling is a hard admission limit.

Credits differ because token usage is observable only after a call completes.
`perInvocationCreditReserve` is an admission reserve, and `maxPlanCredits` is a
post-observation stop threshold. If an admitted call crosses that threshold,
its result is marked exit 125 and every later invocation is blocked. It is not
described as a hard per-call maximum because the CLI provides no pre-call upper
bound. Gate D0 must approve a conservative reserve and the possible one-call
overshoot explicitly.

## Cumulative Journey Contract

`cumulativeJourneys` is separate from atomic cells. For each journey the runner:

1. verifies the corpus lock, cumulative catalog, fixture, prompts, rubrics, and
   frozen start commit;
2. creates a fresh temporary root and initializes the exact fixture commit;
3. materializes and applies the treatment exactly once;
4. records the workspace hash at that treatment boundary;
5. runs S01, S02, and S03 in the same treated workspace, with a fresh
   submission directory per step;
6. requires each executed step's `beforeSha256` to equal the treatment-boundary
   hash or the preceding executed step's `afterSha256`;
7. emits a deterministic blocked record instead of invoking a step whose
   dependencies failed; and
8. removes the temporary root in `finally` and records disposal.

Concrete example: S01 writes `RUNBOOK.md`; S02 starts from S01's exact after
hash and repairs `attempt <= limit`; S03 then sees both changes. If S01 fails,
S02 and S03 have null exit/signal, `timedOut: false`, empty stdout/stderr hashes,
no evidence or workspace hashes, exact blocked rubric results, and all metrics
unknown.

Cumulative records and evidence live under `cumulative/`; their aggregate is
separate and explicitly excluded from the atomic primary aggregate.

## Offline Proof

The tests create checksum-pinned executable stubs in temporary directories.
They cover:

- exact argv, cwd, sanitized environment, login mode, raw JSONL, usage, and
  policy identities;
- missing usage, malformed JSONL, API authentication rejection, and unexpected
  tool-item rejection;
- missing flags/hashes/files, altered approval/protocol/tool policy/executable,
  plan tampering, unsafe IDs, a nonempty run directory, and a symlinked parent,
  all rejected before model launch;
- invocation, elapsed-time, admission-reserve, unknown-credit, and observed
  credit-threshold stops;
- signal reporting and process-group timeout cleanup;
- S01 -> S02 -> S03 state preservation, one treatment application, exact
  workspace chaining, dependency blocking, evidence validation, cleanup, and
  isolation between two journey runs; and
- separate cumulative aggregation with no atomic-output contamination.

## Validation Commands

```text
npm run build
npm run typecheck:orchestrator
npm test -- --run benchmark/orchestrator/test/decision-runner-prelock.test.ts
npm test -- --run benchmark/orchestrator/test/evaluation-qualification.test.ts
npm run lint:orchestrator
npm test -- --run
git diff --check
```

## Remaining Gate Boundary

US-029 supplies only offline machinery. A later checksum-pinned Gate D0 packet
must name the held-out calibration tasks, exact executable/plan/policies/run
directory, call schedule, elapsed limit, admission reserve, observed-credit
stop, and independent approval. Only that exact D0 authorization may permit
calibration calls, and it cannot authorize US-110. A separate final Gate D lock
is required before decision execution.
