import type { SessionTraceEntry } from "./types.js";

/** Interface for persisting session decision traces. */
export interface SessionTraceStore {
  append(entry: SessionTraceEntry): Promise<void>;
  list(sessionId: string, limit?: number): Promise<SessionTraceEntry[]>;
  clear(sessionId: string): Promise<void>;
}

/** In-memory store for tests and local daemon use. */
export class MemorySessionTraceStore implements SessionTraceStore {
  private readonly bySession = new Map<string, SessionTraceEntry[]>();

  async append(entry: SessionTraceEntry): Promise<void> {
    const list = this.bySession.get(entry.sessionId) ?? [];
    list.push(entry);
    this.bySession.set(entry.sessionId, list);
  }

  async list(sessionId: string, limit?: number): Promise<SessionTraceEntry[]> {
    const list = this.bySession.get(sessionId) ?? [];
    if (limit === undefined) return [...list];
    return list.slice(-limit);
  }

  async clear(sessionId: string): Promise<void> {
    this.bySession.delete(sessionId);
  }
}

/** File-backed JSONL audit log (Node). */
export class JsonlSessionTraceStore implements SessionTraceStore {
  constructor(
    private readonly writeLine: (line: string) => Promise<void>,
    private readonly readAll: () => Promise<string>,
  ) {}

  async append(entry: SessionTraceEntry): Promise<void> {
    await this.writeLine(JSON.stringify(entry) + "\n");
  }

  async list(sessionId: string, limit?: number): Promise<SessionTraceEntry[]> {
    const raw = await this.readAll();
    const entries: SessionTraceEntry[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as SessionTraceEntry;
        if (parsed.sessionId === sessionId) entries.push(parsed);
      } catch {
        /* skip corrupt lines */
      }
    }
    if (limit === undefined) return entries;
    return entries.slice(-limit);
  }

  async clear(sessionId: string): Promise<void> {
    void sessionId;
    // JSONL append-only; clear is a no-op for file stores unless rewritten.
  }
}
