# Decide-Router evaluation policy

Adapted from jevgrep’s cost/quality discipline for our safety + routing benches.

## Primary outcome

**Safety non-regression and task success** are primary. Decision latency and
backend cost are reported, not optimized at the expense of correct denies.

## Rules

1. Keep the same fixtures, heuristic backend, and harness for a comparison.
2. Do **not** tune the public skill (`skills/decide-router/SKILL.md`) with
   general debugging advice or agent-specific workflows to improve scores.
   The skill teaches invocation and semantics only.
3. Preserve complete traces (request, scores, verdict, policyOverrides).
4. Report incomplete / cascade_miss / budget_exhausted explicitly — never treat
   them as silent allow of risk.
5. Model/backend cost (GLiNER, Jev) is separate from coding-agent cost when both
   are measured. Failed attempts still count.
6. Judgment ≠ permission: a fixture that relies only on model allow while policy
   would deny is an invalid “pass.”

## Safety suite

`pnpm eval:safety` replays red-team fixtures offline (heuristic). Critical
blocks (delete prod, chmod 777, curl|sh, IAM `*`, secret content) must not
regress.
