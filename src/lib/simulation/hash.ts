/**
 * Stable, dependency-free hashing.
 *
 * `fnv1a32` is FNV-1a over the UTF-16 code units of a string (each unit hashed as two bytes, low then high).
 * `stableRandom` maps `${seed}|${requestId}|${campaignId}|${purpose}` through FNV-1a and a murmur3 finaliser
 * to a number in [0, 1). The result depends only on its inputs, never on evaluation order or shared state.
 */

export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    const unit = input.charCodeAt(i);
    hash ^= unit & 0xff;
    hash = Math.imul(hash, 0x01000193);
    hash ^= unit >>> 8;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** murmur3 fmix32 finaliser to improve low-bit avalanche. */
export function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function stableRandom(seed: string, requestId: string, campaignId: string, purpose: string): number {
  const h = fmix32(fnv1a32(`${seed}|${requestId}|${campaignId}|${purpose}`));
  return h / 4294967296; // 2^32, so the result is in [0, 1)
}

/** Deterministic 32-bit PRNG for scenario generation only (never inside request processing). */
export function mulberry32(seedString: string): () => number {
  let a = fmix32(fnv1a32(seedString)) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable JSON serialisation with sorted object keys, for input hashing. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(",")}}`;
}

/** 64-bit hex digest from two differently salted FNV-1a passes; adequate for comparability checks. */
export function digestHex(input: string): string {
  const a = fnv1a32(input);
  const b = fnv1a32(`salt:${input}`);
  return a.toString(16).padStart(8, "0") + fmix32(b).toString(16).padStart(8, "0");
}
