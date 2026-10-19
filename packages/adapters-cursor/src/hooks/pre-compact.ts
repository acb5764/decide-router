#!/usr/bin/env node
import { handleHook } from "../runtime.js";
import { readStdinJson, writeResult } from "./read-stdin.js";

const input = await readStdinJson<{
  sessionId?: string;
  chunks?: Array<{ id: string; source: string; preview: string; kind?: string }>;
  cwd?: string;
}>();

const result = await handleHook({
  hook: "preCompact",
  sessionId: input.sessionId,
  contextChunks: (input.chunks ?? []).map((c) => ({
    id: c.id,
    source: c.source,
    preview: c.preview,
    kind: (c.kind as "user_goal" | "error" | "action" | "file" | "other") ?? "other",
  })),
  cwd: input.cwd,
});

writeResult({
  permission: "allow",
  compact: result.verdict.rewrite?.payload,
  reasons: result.verdict.reasons,
});
