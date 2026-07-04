// Canonical JSON + SHA-256 (doc/backend-design.md §7.1).
// Canonical form: keys sorted, no whitespace, bigints as decimal strings,
// undefined properties dropped — so every peer hashes identical bytes.

export function canonicalJson(v: unknown): string {
  if (v === null || typeof v === "number" || typeof v === "boolean" || typeof v === "string") {
    return JSON.stringify(v);
  }
  if (typeof v === "bigint") return `"${v.toString()}"`;
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
  }
  throw new Error(`cannot canonicalize value of type ${typeof v}`);
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashOf(value: unknown): Promise<string> {
  return sha256Hex(canonicalJson(value));
}

export function shortHash(hash: string): string {
  return hash.length > 16 ? `${hash.slice(0, 8)}…${hash.slice(-8)}` : hash;
}
