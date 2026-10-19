/**
 * Content-level secret detection (jevgrep secrets.ts–inspired, simplified).
 * Fail-closed: whole payload is treated as sensitive when a match fires.
 * Best-effort — not a guarantee all secrets are found.
 */

const KNOWN_PREFIXES = [
  "sk-live-",
  "sk_test_",
  "sk_live_",
  "sk-ant-",
  "npm_",
  "pypi-",
  "hf_",
  "ghp_",
  "gho_",
  "ghs_",
  "github_pat_",
  "glpat-",
  "xoxb-",
  "xoxp-",
  "AKIA",
  "ASIA",
  "AIza",
  "whsec_",
] as const;

const KEY_NAME_PATTERN =
  /(?:api[_-]?key|secret|passwd|password|token|access[_-]?key|private[_-]?key|auth[_-]?token|credential)/i;

const PLACEHOLDER_PATTERN =
  /^(?:\*+|x+|your[_-]?|changeme|placeholder|redacted|example|xxx|TODO|null|undefined|none)$/i;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SLACK_WEBHOOK =
  /https:\/\/hooks\.slack\.com\/services\/[A-Z0-9]+\/[A-Z0-9]+\/[A-Za-z0-9]+/i;

const MIN_SECRET_LENGTH = 16;
const MIN_ENTROPY = 3.5;

const PREFIX_PATTERNS = [...KNOWN_PREFIXES]
  .sort((a, b) => b.length - a.length)
  .map(
    (p) =>
      new RegExp(
        `(?<![A-Za-z0-9_])${escapeRegExp(p)}([A-Za-z0-9_\\-]{16,})`,
        "g",
      ),
  );

export interface SecretScanHit {
  kind: "prefix" | "assignment" | "webhook";
  preview: string;
}

export function containsLikelySecret(source: string): boolean {
  return scanSecrets(source).length > 0;
}

export function scanSecrets(source: string): SecretScanHit[] {
  const hits: SecretScanHit[] = [];
  if (!source) return hits;

  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;

    if (SLACK_WEBHOOK.test(trimmed)) {
      hits.push({ kind: "webhook", preview: "slack_webhook" });
    }

    for (const pattern of PREFIX_PATTERNS) {
      pattern.lastIndex = 0;
      const m = pattern.exec(trimmed);
      if (m?.[1] && !isPlaceholder(m[1]) && !m[0].toLowerCase().startsWith("npm_package_")) {
        hits.push({ kind: "prefix", preview: m[0].slice(0, 12) + "…" });
        break;
      }
    }

    const assign = trimmed.match(
      /(?:["']?)([A-Za-z_][\w-]*)(?:["']?)\s*[:=]\s*(.+)$/,
    );
    if (assign?.[1] && assign[2] && KEY_NAME_PATTERN.test(assign[1])) {
      const value = cleanValue(assign[2]);
      if (looksLikeSecretValue(value)) {
        hits.push({
          kind: "assignment",
          preview: `${assign[1]}=…`,
        });
      }
    }
  }

  return hits;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanValue(raw: string): string {
  let value = raw.trim().replace(/[,;\s]+$/, "").trim();
  const quote = value[0];
  if (
    value.length >= 2 &&
    (quote === '"' || quote === "'" || quote === "`") &&
    value.endsWith(quote)
  ) {
    return value.slice(1, -1).trim();
  }
  return value;
}

function isPlaceholder(value: string): boolean {
  return value.length === 0 || PLACEHOLDER_PATTERN.test(value);
}

function shannonEntropy(value: string): number {
  const freq = new Map<string, number>();
  for (const c of value) freq.set(c, (freq.get(c) ?? 0) + 1);
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function looksLikeSecretValue(value: string): boolean {
  if (value.length < MIN_SECRET_LENGTH || isPlaceholder(value)) return false;
  if (UUID_PATTERN.test(value)) return false;
  if (/^(?:process|import\.meta|env|config)\./.test(value)) return false;
  if (/[A-Za-z0-9_\-+=/]{32,}/.test(value)) return true;
  return shannonEntropy(value) >= MIN_ENTROPY;
}
