import type {
  DecisionBackend,
  DecisionRequest,
  DecisionScores,
  HeadScore,
} from "@decide-router/core";
import type { JevClient } from "./types.js";

/**
 * Stub Jev backend interface for later API drop-in.
 * Throws a clear error unless a client is injected — use Heuristic/Gliner for local.
 */
export class JevBackend implements DecisionBackend {
  readonly name = "jev";

  constructor(private readonly client?: JevClient) {}

  async score(request: DecisionRequest): Promise<DecisionScores> {
    if (!this.client) {
      throw new Error(
        "JevBackend has no client configured; inject JevClient or use HeuristicBackend/GlinerDecideBackend",
      );
    }

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

    const heads: Record<string, HeadScore> = {};
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

/** Type-only contract documentation for future HTTP Jev adapters. */
export interface JevBackendConfig {
  apiUrl: string;
  apiKey?: string;
  timeoutMs?: number;
}
