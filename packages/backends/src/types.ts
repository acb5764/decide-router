import type { DecisionBackend } from "@decide-router/core";
import type { JevEvaluationRequest } from "./jev-criteria.js";

export type { DecisionBackend };

export interface GlinerClient {
  /** Multi-head classify. Returns label→score maps per head. */
  classify(input: {
    text: string;
    schema: Record<string, string[]>;
  }): Promise<Record<string, Record<string, number>>>;
}

/** Legacy simplified client. */
export interface JevClient {
  decide(input: {
    goal: string;
    text: string;
    schema: Record<string, string[]>;
  }): Promise<Record<string, { label: string; confidence: number }>>;
}

/** Preferred jevgrep-shaped client: criteria in state, boolean probs out. */
export interface JevEvaluateClient {
  evaluate(request: JevEvaluationRequest): Promise<Record<string, number>>;
}
