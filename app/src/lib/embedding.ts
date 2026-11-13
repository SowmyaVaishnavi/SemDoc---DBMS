/**
 * Text -> 384-d unit vector.
 *  Default : all-MiniLM-L6-v2 (the model named in the schema), run locally with
 *            @huggingface/transformers. Long text is split into ~200-word chunks
 *            and the chunk vectors are averaged, because MiniLM only reads the
 *            first ~256 tokens of its input.
 *  Offline : EMBEDDING_PROVIDER=dev uses a hashed bag-of-words stand-in
 *            (same idea as db/dev/07). It does NOT capture meaning.
 */
const DEV = process.env.EMBEDDING_PROVIDER === "dev";
export const MODEL_NAME = DEV ? "dev-hashed-bow" : "all-MiniLM-L6-v2";
export const DIM = 384;

function normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

function devEmbed(text: string): number[] {
  const v = new Array(DIM).fill(0);
  for (const w of text.toLowerCase().split(/[^a-z]+/)) {
    if (w.length <= 3) continue;
    let h = 2166136261;
    for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w.charCodeAt(i), 16777619);
    v[(h >>> 0) % DIM] += 1;
  }
  return normalize(v);
}

let extractor: Promise<any> | null = null;
async function miniLM(): Promise<any> {
  if (!extractor) {
    extractor = import("@huggingface/transformers").then(({ pipeline }) =>
      pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2"),
    );
  }
  return extractor;
}

function chunks(text: string, words = 200): string[] {
  const w = text.split(/\s+/).filter(Boolean);
  if (w.length <= words) return [text];
  const out: string[] = [];
  for (let i = 0; i < w.length; i += words) out.push(w.slice(i, i + words).join(" "));
  return out.slice(0, 50); // cap work per save
}

export async function embed(text: string): Promise<number[]> {
  if (DEV) return devEmbed(text);
  const ex = await miniLM();
  const sum = new Array(DIM).fill(0);
  const parts = chunks(text);
  for (const p of parts) {
    const out = await ex(p, { pooling: "mean", normalize: true });
    const data = out.data as Float32Array;
    for (let i = 0; i < DIM; i++) sum[i] += data[i];
  }
  return normalize(sum.map((x) => x / parts.length));
}

/** pgvector text literal, usable as  $1::vector */
export const toVec = (v: number[]) => "[" + v.map((x) => x.toFixed(7)).join(",") + "]";
