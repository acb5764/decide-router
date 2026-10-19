export async function readStdinJson<T = Record<string, unknown>>(): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {} as T;
  return JSON.parse(raw) as T;
}

export function writeResult(result: unknown): void {
  process.stdout.write(JSON.stringify(result) + "\n");
}
