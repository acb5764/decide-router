import type {
  DecisionBackend,
  DecisionRequest,
  DecisionScores,
  HeadScore,
} from "@decide-router/core";
import { HeuristicBackend } from "./heuristic.js";
import type { GlinerClient } from "./types.js";

export interface GlinerDecideOptions {
  /** HTTP or in-process client. If omitted / fails, falls back to heuristic. */
  client?: GlinerClient;
  /** Optional remote endpoint implementing POST {text, schema} → heads. */
  endpoint?: string;
  fallback?: DecisionBackend;
  fetchImpl?: typeof fetch;
}

/**
 * GLiNER2.5-Decide-style multi-head classify wrapper.
 * Gracefully falls back to HeuristicBackend when model deps / HTTP unavailable.
 */
export class GlinerDecideBackend implements DecisionBackend {
  readonly name = "gliner-decide";
  private readonly client?: GlinerClient;
  private readonly endpoint?: string;
  private readonly fallback: DecisionBackend;
  private readonly fetchImpl: typeof fetch;
  private unavailable = false;

  constructor(opts: GlinerDecideOptions = {}) {
    this.client = opts.client;
    this.endpoint = opts.endpoint;
    this.fallback = opts.fallback ?? new HeuristicBackend();
    this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
  }

  async score(request: DecisionRequest): Promise<DecisionScores> {
    if (this.unavailable && !this.client && !this.endpoint) {
      return this.fallback.score(request);
    }

    try {
      const text = buildText(request);
      const schema = request.schema.heads;
      let raw: Record<string, Record<string, number>>;

      if (this.client) {
        raw = await this.client.classify({ text, schema });
      } else if (this.endpoint) {
        raw = await this.httpClassify(text, schema);
      } else {
        // No client configured — try optional dynamic import once, else fallback.
        const dynamic = await tryLoadOptionalGliner();
        if (!dynamic) {
          this.unavailable = true;
          const fb = await this.fallback.score(request);
          return { ...fb, backend: `${this.name}->${fb.backend}` };
        }
        raw = await dynamic.classify({ text, schema });
      }

      const heads: Record<string, HeadScore> = {};
      for (const [head, dist] of Object.entries(raw)) {
        const best = Object.entries(dist).sort((a, b) => b[1] - a[1])[0];
        if (!best) continue;
        heads[head] = {
          label: best[0],
          confidence: best[1],
          distribution: dist,
        };
      }

      // Ensure schema heads exist
      for (const head of Object.keys(schema)) {
        if (!heads[head]) {
          const labels = schema[head]!;
          heads[head] = {
            label: labels[0]!,
            confidence: 0.3,
            distribution: Object.fromEntries(labels.map((l) => [l, 0.3])),
          };
        }
      }

      const confidence =
        Object.values(heads).reduce((s, h) => s + h.confidence, 0) /
        Math.max(1, Object.keys(heads).length);

      return { backend: this.name, confidence, heads };
    } catch {
      this.unavailable = true;
      const fb = await this.fallback.score(request);
      return { ...fb, backend: `${this.name}->${fb.backend}` };
    }
  }

  private async httpClassify(
    text: string,
    schema: Record<string, string[]>,
  ): Promise<Record<string, Record<string, number>>> {
    const res = await this.fetchImpl(this.endpoint!, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, schema }),
    });
    if (!res.ok) throw new Error(`GLiNER HTTP ${res.status}`);
    return (await res.json()) as Record<string, Record<string, number>>;
  }
}

function buildText(request: DecisionRequest): string {
  return [
    `goal: ${request.goal}`,
    `event: ${request.event}`,
    `tool: ${request.context.toolName ?? ""}`,
    `args: ${request.context.argsPreview ?? ""}`,
  ].join("\n");
}

async function tryLoadOptionalGliner(): Promise<GlinerClient | null> {
  // Optional dependency — resolved at runtime only; never a hard package dep.
  try {
    const spec = "@decide-router/" + "gliner-native";
    const mod = (await Function("s", "return import(s)")(spec).catch(
      () => null,
    )) as { createGlinerClient?: () => GlinerClient } | null;
    if (mod?.createGlinerClient) return mod.createGlinerClient();
    return null;
  } catch {
    return null;
  }
}
