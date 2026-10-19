/** Cursor hook I/O shapes — authorization responses, fail-open safe. */

export type HookPermission = "allow" | "deny" | "ask";

export interface CursorHookInput {
  conversation_id?: string;
  session_id?: string;
  sessionId?: string;
  cwd?: string;
  workspace_roots?: string[];
  tool_name?: string;
  toolName?: string;
  tool_input?: Record<string, unknown>;
  args?: unknown;
  command?: string;
  agent_message?: string;
  prompt?: string;
  trigger?: string;
  context_usage_percent?: number;
  chunks?: Array<{
    id: string;
    source: string;
    preview: string;
    kind?: string;
  }>;
  generation_id?: string;
  status?: string;
}

export interface AuthHookResult {
  permission: HookPermission;
  user_message?: string;
  agent_message?: string;
  updated_input?: Record<string, unknown>;
  reasons?: string[];
  /** Present when authorization ran successfully (not fail-open). */
  verdict?: unknown;
}

export interface SessionStartResult {
  additional_context?: string;
  env?: Record<string, string>;
}

export interface PreCompactResult {
  user_message?: string;
  compact?: unknown;
}

export interface StopResult {
  status?: "continue" | "block";
  agent_message?: string;
}

export async function readStdinJson<T = CursorHookInput>(): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return {} as T;
  }
}

export function writeHookResult(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj ?? {}));
}

/** Fail-open wrapper: any throw → allow / empty / continue. */
export async function failOpen<T>(
  run: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await run();
  } catch {
    return fallback;
  }
}

export function sessionIdOf(input: CursorHookInput): string {
  return (
    input.session_id ??
    input.sessionId ??
    input.conversation_id ??
    "cursor-session"
  );
}

export function cwdOf(input: CursorHookInput): string {
  return (
    input.cwd ??
    input.workspace_roots?.[0] ??
    process.env.CURSOR_PROJECT_DIR ??
    process.cwd()
  );
}

export function toolNameOf(input: CursorHookInput): string {
  return input.tool_name ?? input.toolName ?? "";
}

export function commandOf(input: CursorHookInput): string | undefined {
  if (input.command) return input.command;
  const ti = input.tool_input;
  if (ti && typeof ti.command === "string") return ti.command;
  return undefined;
}
