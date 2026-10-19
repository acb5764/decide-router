import type { DecisionBackend } from "@decide-router/core";

export type { DecisionBackend };

export interface GlinerClient {
  /** Multi-head classify. Returns label→score maps per head. */
  classify(input: {
    text: string;
    schema: Record<string, string[]>;
  }): Promise<Record<string, Record<string, number>>>;
}

export interface JevClient {
  decide(input: {
    goal: string;
    text: string;
    schema: Record<string, string[]>;
  }): Promise<Record<string, { label: string; confidence: number }>>;
}
