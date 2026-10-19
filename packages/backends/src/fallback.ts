import type {
  DecisionBackend,
  DecisionRequest,
  DecisionScores,
} from "@decide-router/core";

/** Try primary backend; on failure use fallback (e.g. gliner → heuristic). */
export class FallbackBackend implements DecisionBackend {
  readonly name: string;

  constructor(
    private readonly primary: DecisionBackend,
    private readonly fallback: DecisionBackend,
  ) {
    this.name = `${primary.name}|${fallback.name}`;
  }

  async score(request: DecisionRequest): Promise<DecisionScores> {
    try {
      return await this.primary.score(request);
    } catch {
      const fb = await this.fallback.score(request);
      return { ...fb, backend: `${this.primary.name}->${fb.backend}` };
    }
  }
}
