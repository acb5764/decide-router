import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  DecideEngine,
  MemorySessionTraceStore,
  normalizeEvent,
  type ToolRoutingMode,
  type Verdict,
} from "@decide-router/core";
import {
  FallbackBackend,
  GlinerDecideBackend,
  HeuristicBackend,
} from "@decide-router/backends";
import {
  DeterministicPolicyEngine,
  DEFAULT_POLICY,
} from "@decide-router/policy";
import { runBootstrap } from "@decide-router/bootstrap";
import { TreeRegistry } from "@decide-router/trees";

export interface ProxyOptions {
  port?: number;
  upstreamUrl?: string;
  goal?: string;
  routingMode?: ToolRoutingMode;
  cwd?: string;
  /** When true, run bootstrap once at listen. */
  bootstrapOnStart?: boolean;
}

export interface ChatMessage {
  role: string;
  content?: string | null;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
}

export interface ChatCompletionRequest {
  model?: string;
  messages: ChatMessage[];
  tools?: Array<{ type: string; function: { name: string; description?: string } }>;
  stream?: boolean;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export class DecideProxy {
  private engine: DecideEngine;
  private registry = new TreeRegistry();
  private agentInstruction?: string;

  constructor(private readonly opts: ProxyOptions = {}) {
    this.engine = new DecideEngine({
      backend: new FallbackBackend(
        new GlinerDecideBackend(),
        new HeuristicBackend(),
      ),
      policy: new DeterministicPolicyEngine(DEFAULT_POLICY),
      store: new MemorySessionTraceStore(),
      config: {
        failClosed: true,
        toolRouting: {
          mode: opts.routingMode ?? "cascade",
          top_k: 3,
          min_confidence: 0.65,
        },
      },
    });
  }

  async init(): Promise<void> {
    if (!this.opts.bootstrapOnStart) return;
    const artifact = await runBootstrap({
      root: this.opts.cwd ?? process.cwd(),
      writeArtifacts: true,
    });
    this.agentInstruction = artifact.agentInstruction;
    this.registry.overlay.load(artifact.trees);
  }

  /** Gate tool calls in a chat completion request before forwarding. */
  async gateTools(body: ChatCompletionRequest): Promise<{
    body: ChatCompletionRequest;
    verdicts: Verdict[];
    blocked: boolean;
  }> {
    const verdicts: Verdict[] = [];
    const last = [...body.messages].reverse().find((m) => m.tool_calls?.length);
    if (!last?.tool_calls?.length) {
      // Assist/cascade: score available tools against goal
      if (body.tools?.length) {
        const candidates = body.tools.map((t) => t.function.name);
        const goal =
          this.opts.goal ??
          body.messages.find((m) => m.role === "user")?.content ??
          "Complete the task";
        const req = normalizeEvent({
          harness: "proxy",
          hook: "tool_route",
          sessionId: "proxy",
          goal: String(goal),
          candidateTools: candidates,
        });
        const verdict = await this.engine.decide(req);
        verdicts.push(verdict);
      }
      return { body, verdicts, blocked: false };
    }

    const kept = [];
    for (const tc of last.tool_calls) {
      const args = tc.function.arguments;
      const isShell = /shell|bash|exec/i.test(tc.function.name);
      const verdict = await this.engine.decide(
        normalizeEvent({
          harness: "proxy",
          hook: isShell ? "beforeShellExecution" : "preToolUse",
          sessionId: "proxy",
          goal: this.opts.goal ?? "Complete the task safely",
          toolName: tc.function.name,
          command: isShell ? args : undefined,
          args,
        }),
      );
      verdicts.push(verdict);
      if (verdict.action !== "deny") kept.push(tc);
    }

    if (kept.length !== last.tool_calls.length) {
      last.tool_calls = kept;
    }

    return {
      body,
      verdicts,
      blocked: kept.length === 0 && (last.tool_calls?.length ?? 0) === 0,
    };
  }

  listen(): Promise<{ port: number; close: () => Promise<void> }> {
    const port = this.opts.port ?? 8787;
    const upstream = this.opts.upstreamUrl;

    const server = createServer(async (req, res) => {
      try {
        await this.handle(req, res, upstream);
      } catch (err) {
        res.statusCode = 500;
        res.end(
          JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    });

    return new Promise((resolve) => {
      server.listen(port, () => {
        resolve({
          port,
          close: () =>
            new Promise((r, j) =>
              server.close((e) => (e ? j(e) : r())),
            ),
        });
      });
    });
  }

  private async handle(
    req: IncomingMessage,
    res: ServerResponse,
    upstream?: string,
  ): Promise<void> {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          bootstrap: Boolean(this.agentInstruction),
        }),
      );
      return;
    }

    if (req.method === "POST" && req.url === "/v1/bootstrap") {
      await this.init();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          agentInstruction: this.agentInstruction,
        }),
      );
      return;
    }

    if (req.method === "POST" && req.url?.startsWith("/v1/chat/completions")) {
      const raw = await readBody(req);
      const body = JSON.parse(raw || "{}") as ChatCompletionRequest;
      const gated = await this.gateTools(body);

      if (gated.blocked) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "decide-blocked",
            object: "chat.completion",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content:
                    gated.verdicts.map((v) => v.hint ?? v.reasons.join("; ")).join("\n") ||
                    "Blocked by Decide-Router policy.",
                },
                finish_reason: "stop",
              },
            ],
            decide_router: { verdicts: gated.verdicts },
          }),
        );
        return;
      }

      if (!upstream) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "decide-local",
            object: "chat.completion",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: "Decide-Router proxy: no upstream configured; tools gated only.",
                  tool_calls: gated.body.messages.at(-1)?.tool_calls,
                },
                finish_reason: "stop",
              },
            ],
            decide_router: { verdicts: gated.verdicts },
          }),
        );
        return;
      }

      const up = await fetch(new URL("/v1/chat/completions", upstream), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(gated.body),
      });
      const text = await up.text();
      res.writeHead(up.status, { "content-type": "application/json" });
      res.end(text);
      return;
    }

    res.writeHead(404);
    res.end("not found");
  }
}
