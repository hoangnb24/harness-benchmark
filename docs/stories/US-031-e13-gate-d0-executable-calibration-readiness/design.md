# US-031 E13 Gate D0 Executable Calibration Readiness — Design

## Acyclic Artifact Graph

```text
US-030 packet lock + cycle-free governance + local environment
  -> canonical plan core and semantic digest
  -> separate human authorization over that digest and exact limits
  -> final plan containing the authorization path/checksum
  -> derived ready manifest
```

The governance protocol does not hash the instantiated plan or authorization.
The derived manifest may hash every artifact because no member points back to
the manifest.

## Exact Execution Identity

- Execution commit: supplied by the cycle-free governance input after US-031 is
  committed. Plan construction proves that every packet identity and every
  execution artifact still matches that commit.
- Qualified base: `2013dd55bac4c4bbc5bd9eff950eeb6f24d999ef`, verified as an ancestor.
- Run ID: `e13-gate-d0-calibration-v1`.
- Result directory:
  `benchmark/evaluation/calibration-runs/e13-gate-d0-calibration-v1`.
- Cells: C01–C18 in the US-030 six-block schedule.
- Concurrency: one; retries: zero.

Exact validation covers cell IDs, task, treatment, block order, repetition,
global position, timeout, profile, platform, source root, artifact cache,
model, reasoning effort, sandbox, executable, policies, corpus, and paths.
The execution CLI repeats the repository, packet-member, candidate-source, and
executable checks immediately before any exact calibration command. Building a
valid plan and then editing the working tree therefore stops before admission.

## Fail-Fast State Machine

```text
admit cell
  -> execute and retain raw record
  -> validate process + rubric + required telemetry
     -> valid: admit next cell
     -> failed/invalid/unknown: retain stop receipt and admit nothing else
```

Ordinary decision execution keeps its existing behavior. The stricter state
machine activates only for the exact held-out calibration plan.

## Blinded Report Flow

Raw records are verified against the exact plan and frozen catalog. Effective
rubric checks map to correctness, proof, and safety by the catalog's declared
dimensions; treatment identity becomes an opaque label before analysis. The
analysis fits the two task-specific Latin squares with four pooled residual
degrees of freedom.

For endpoint `e`:

```text
V_upper_e = max(V_floor_e, SSE_e / chiSquareLower(df=4, alpha=.05/6))
R_precision_e = ceil(2*V_upper_e*z(1-alpha_e)^2 / (K_e*h_e^2))
R_power_e = ceil(2*V_upper_e*(z(1-alpha_e)+z(.8))^2 / (K_e*delta_e^2))
R = 6*ceil(max(6,max_e(R_precision_e,R_power_e))/6)
```

`K=2` for per-class correctness/proof non-inferiority and `K=16` for overall
input-token material benefit and wall/tool/credit guardrails. Future primary
plus cumulative calls are `57R`; projected planning credits are `40*57R`.
Ablations remain excluded and require a separate Gate D budget or E13
amendment.

## Separate Credit Authorities

- Calibration execution limit: stops admission within these 18 calls.
- Per-invocation reserve: admission guard; not a claim about the hard tail.
- Future-decision planning ceiling: decides whether the mechanically sized
  `57R` design fits the maintainer's later planning limit.

One field cannot substitute for another. The 40-credit number remains the
upper end of a published average range, not a maximum.

The packet ships two separate inert human-input templates. The Gate D0
template has exactly the authorization parser's field set, so filling its
derived identities, human limits, and approval fields produces the artifact
consumed by plan assembly. The future-decision ceiling stays in its own
non-execution template. Neither template grants authority or supplies a limit.

The report generator accepts the analysis policy only when its checksum equals
the policy identity locked by the governance-bound packet. A same-shaped policy
with a changed variance floor or threshold is rejected before analysis.
