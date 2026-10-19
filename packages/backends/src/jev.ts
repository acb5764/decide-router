import type {
  DecisionBackend,
  DecisionRequest,
  DecisionScores,
} from "@decide-router/core";
import type { JevClient, JevEvaluateClient } from "./types.js";
import {
  buildJevEvaluationRequest,
  probabilitiesToHeads,
  type JevEvaluationRequest,
} from "./jev-criteria.js";

export type { JevEvaluationRequest };
export {
  buildJevEvaluationRequest,
  probabilitiesToHeads,
  ACTION_GATE_CRITERIA,
  GUIDANCE,
} from "./jev-criteria.js";

/**
 * Jev backend — boolean-question + criteria/state protocol (jevgrep-shaped).
 * Prefer injecting `JevEvaluateClient`. Legacy `JevClient.decide` still works.
 * Throws if neither is configured; wrap with FallbackBackend for offline use.
 */
export class JevBackend implements DecisionBackend {
  readonly name = "jev";

  constructor(
    private readonly client?: JevClient | JevEvaluateClient,
    private readonly opts: { timeoutMs?: number } = {},
  ) {}

  async score(request: DecisionRequest): Promise<DecisionScores> {
    if (!this.client) {
      throw new Error(
        "JevBackend has no client; inject JevEvaluateClient/JevClient or use HeuristicBackend behind FallbackBackend",
      );
    }

    if (isEvaluateClient(this.client)) {
      const evalReq = buildJevEvaluationRequest({
        goal: request.goal,
        event: request.event,
        toolName: request.context.toolName,
        argsPreview: request.context.argsPreview,
        heads: request.schema.heads,
        candidates: request.candidates,
      });
      const probs = await this.client.evaluate(evalReq);
      validateProbabilities(probs, Object.keys(evalReq.questions));
      const mapped = probabilitiesToHeads(probs, request.schema.heads);
      return {
        backend: this.name,
        confidence: mapped.confidence,
        heads: mapped.heads,
      };
    }

    // Legacy path
    const text = [
      request.goal,
      request.context.toolName ?? "",
      request.context.argsPreview ?? "",
    ].join("\n");
    const result = await this.client.decide({
      goal: request.goal,
      text,
      schema: request.schema.heads,
    });
    const heads: DecisionScores["heads"] = {};
    for (const [head, scored] of Object.entries(result)) {
      heads[head] = {
        label: scored.label,
        confidence: scored.confidence,
        distribution: { [scored.label]: scored.confidence },
      };
    }
    const confidence =
      Object.values(heads).reduce((s, h) => s + h.confidence, 0) /
      Math.max(1, Object.keys(heads).length);
    return { backend: this.name, confidence, heads };
  }
}

function isEvaluateClient(
  c: JevClient | JevEvaluateClient,
): c is JevEvaluateClient {
  return typeof (c as JevEvaluateClient).evaluate === "function";
}

function validateProbabilities(
  probs: Record<string, number>,
  expectedKeys: string[],
): void {
  for (const key of expectedKeys) {
    const v = probs[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) {
      throw new Error(`Jev answer invalid for ${key}: ${String(v)}`);
    }
  }
}

/** HTTP client for TypeSafe-compatible Jev evaluate endpoints. */
export class HttpJevEvaluateClient implements JevEvaluateClient {
  constructor(
    private readonly opts: {
      apiUrl: string;
      apiKey?: string;
      model?: string;
      timeoutMs?: number;
      fetchImpl?: typeof fetch;
    },
  ) {}

  async evaluate(
    request: JevEvaluationRequest,
  ): Promise<Record<string, number>> {
    const fetchImpl = this.opts.fetchImpl ?? fetch.bind(globalThis);
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.opts.timeoutMs ?? 15_000,
    );
    try {
      const res = await fetchImpl(this.opts.apiUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.opts.apiKey
            ? { authorization: `Bearer ${this.opts.apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          model: this.opts.model ?? "jev",
          state: request.state,
          questions: request.questions,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Jev HTTP ${res.status}`);
      }
      const body = (await res.json()) as {
        answers?: Record<string, { type?: string; probability?: number }>;
        probabilities?: Record<string, number>;
      };
      if (body.probabilities) return body.probabilities;
      if (body.answers) {
        const out: Record<string, number> = {};
        for (const [id, ans] of Object.entries(body.answers)) {
          if (
            typeof ans.probability !== "number" ||
            ans.probability < 0 ||
            ans.probability > 1
          ) {
            throw new Error(`Invalid answer for ${id}`);
          }
          out[id] = ans.probability;
        }
        return out;
      }
      throw new Error("Jev response missing answers/probabilities");
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Type-only contract for future drop-in. */
export interface JevBackendConfig {
  apiUrl: string;
  apiKey?: string;
  timeoutMs?: number;
  model?: string;
}
