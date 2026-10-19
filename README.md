# Decide-Router

**Small decision models judge; deterministic policy authorizes; the LLM writes.**

Harness-agnostic layer for Cursor, Claude Code, and OpenAI-compatible proxies:

- What belongs in context vs drop/summarize
- Which tool to call next
- Whether an action serves the goal or is unsafe / wasteful / looping

## Design principles

1. **Judgment ≠ permission** — model scores never alone authorize destructive actions
2. **Closed option sets** — every decision uses explicit labels (`allow` / `ask` / `deny` / …)
3. **Confidence gates** — high → act; mid → cascade; low → escalate
4. **Harness-agnostic core, thin adapters**
5. **Local-first** — heuristic offline; optional GLiNER2.5-Decide-shaped client; Jev stub

## Architecture

```
Harness adapters (Cursor / Claude / Proxy)
        ↓
  Event normalizer → Playbook trees → Decision backend → Deterministic policy
        ↓                                                      ↓
  Session trace store ←—————————————— verdict (allow|deny|ask|rewrite)
```

### Packages

| Package | Role |
|---|---|
| `@decide-router/core` | Types, normalizer, engine pipeline, loop detector, tool routing, context regulation |
| `@decide-router/backends` | `HeuristicBackend`, `GlinerDecideBackend` (fallback), `JevBackend` stub |
| `@decide-router/policy` | YAML/JSON rules: paths, shell, network, permissions — fail-closed |
| `@decide-router/trees` | Playbooks: `safe-change`, `bugfix`, `investigate-only` + bootstrapped overlay |
| `@decide-router/bootstrap` | Ingest prefs → classify rules → materialize trees + agent checklist |
| `@decide-router/adapters-cursor` | Cursor `hooks/hooks.json` + scripts + audit log |
| `@decide-router/adapters-claude` | Claude Code / Agent Plugins hooks |
| `@decide-router/adapters-proxy` | Local OpenAI-compatible proxy (cascade/assist) |
| `@decide-router/eval` | Trace replay, threshold fitting, safety fixtures |

## Quick start

```bash
pnpm install
pnpm build
pnpm test
pnpm eval:safety
```

Config sketch: [`decide-router.config.yaml`](./decide-router.config.yaml)

> If `pnpm install` fails with `EPERM`/`ENOSYS` on a network/project store mount, copy the repo to a normal filesystem (e.g. `/tmp/decide-router`), install and test there, then sync sources back.

## Bootstrap (session / project alignment)

At session or project start, improve alignment from real preference files:

```bash
pnpm --filter @decide-router/bootstrap exec node dist/cli.js /path/to/project --write
# or after build:
decide-router-bootstrap .
```

What it does:

1. **Ingest** `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/**`, `preferences.md`, `CONTRIBUTING.md`, Decide-Router config
2. **Extract** closed labels: `hard_block`, `ask_first`, `prefer`, `avoid`, `tool_allow`, `tool_deny`, `path_protect`, `network_allow`, `style`, `goal_constraint`
3. **Materialize** typed playbook fragments into the tree overlay (not free-text prompts)
4. **Write** `.decide-router/bootstrap/AGENT_BOOTSTRAP.md` checklist for the host agent

Bootstrapped trees still pass through deterministic policy.

### Agent skill (jevgrep-style)

```bash
pnpm skill
# or: decide-router-skill [--global] [--yes]
```

Installs [`skills/decide-router/SKILL.md`](./skills/decide-router/SKILL.md) into detected Claude / Cursor / `.agents` skill dirs. Teaches **invocation and semantics only** — not general debugging (see eval policy).

## Lessons from jevgrep (adopted)

| Pattern | Where |
|---------|--------|
| Boolean questions + criteria in `state` | `@decide-router/backends` `JevBackend` / `buildJevEvaluationRequest` |
| Secret content heuristics (fail-closed) | `@decide-router/policy` `secrets.ts` |
| Honest incomplete / cascade_miss / budget | `@decide-router/core` `Verdict.completeness` + tool routing |
| Skill installer | `pnpm skill` + `skills/decide-router/` |
| Eval: don’t game the skill | `packages/eval/src/cost-quality-policy.md` |

## How to run hooks (real authorization)

Hooks are **not** markdown suggestions — they are Cursor authorization gates. They **fail open** if Decide-Router errors; deterministic policy can still `deny` when evaluation succeeds.

### Cursor

```bash
pnpm build
pnpm install-hooks          # merges ~/.cursor/hooks.json + copies hooks/*.mjs
decide-router-cursor status
```

| Event | Function | Authorizes |
|-------|----------|------------|
| `sessionStart` | `sessionStart()` | Session context + bootstrap |
| `beforeShellExecution` | `beforeShellExecution()` | Shell commands |
| `beforeMCPExecution` | `beforeMCPExecution()` | MCP calls |
| `preToolUse` | `preToolUse()` | Write/Delete/Shell/… (matcher) |
| `stop` | `stop()` | Loop / distraction interrupt |
| `preCompact` | `preCompact()` | Compaction advice |

Handlers live in `packages/adapters-cursor/src/handlers/`. Entrypoints: `packages/adapters-cursor/hooks/decide-router-*.mjs`.

Audit: `~/.cursor/decide-router/audit.jsonl` (configurable).

### Claude Code

Use `packages/adapters-claude/hooks/hooks.json` (`SessionStart`, `PreToolUse`, `PostToolUse`, `Stop`). Same core engine and policy.

### Proxy (Codex / OpenAI-compatible)

```bash
pnpm --filter @decide-router/adapters-proxy exec node dist/cli.js
# POST http://127.0.0.1:8787/v1/chat/completions
# POST http://127.0.0.1:8787/v1/bootstrap
```

Set `UPSTREAM_URL` to forward after gating. Tool routing modes: `replace`, `cascade`, `assist`, `guard`, `trigger`.

## How to run evals

```bash
pnpm eval:safety
```

Replays red-team fixtures (delete prod, chmod 777, curl\|sh, IAM `*`, loops, distraction) with the heuristic backend — no model download.

Programmatic:

```ts
import { SAFETY_FIXTURES, replaySafetyFixtures, fitThresholds } from "@decide-router/eval";
```

## Action gate (multi-head)

- `goal_relevance`: `on_goal | tangential | off_goal | harmful`
- `risk`: `safe | caution | destructive | privilege_escalation | network_lateral`
- `verdict`: `allow | ask | deny` with joint constraints (`destructive` ⇒ never bare `allow`)

Deterministic overlays always win: protected path globs, dangerous shell patterns, network allow/deny, permission-shape checks.
