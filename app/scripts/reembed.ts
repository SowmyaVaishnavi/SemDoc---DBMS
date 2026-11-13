/**
 * Rebuilds every embedding and semantic change with the CURRENT model.
 * Run once after removing db/dev/07, or whenever the model changes:
 *     npm run reembed
 * Needs DATABASE_URL, EMBEDDING_PROVIDER (optional) in the environment.
 */
import { Pool } from "pg";
import { embed, MODEL_NAME, toVec } from "../src/lib/embedding";
import { changeType, lineStats } from "../src/lib/versions";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const { rows } = await pool.query(
    "SELECT version_id, doc_id, content_text FROM document_versions ORDER BY doc_id, version_number");
  console.log(`Re-embedding ${rows.length} versions with ${MODEL_NAME}…`);
  for (const r of rows) {
    await pool.query(
      `INSERT INTO version_embeddings (version_id, embedding_vector, embedding_model) VALUES ($1,$2::vector,$3)
       ON CONFLICT (version_id) DO UPDATE SET embedding_vector = EXCLUDED.embedding_vector,
         embedding_model = EXCLUDED.embedding_model, generated_at = now()`,
      [r.version_id, toVec(await embed(r.content_text)), MODEL_NAME]);
  }
  for (let i = 1; i < rows.length; i++) {
    const p = rows[i - 1], c = rows[i];
    if (p.doc_id !== c.doc_id) continue;
    const s = (await pool.query(
      `SELECT round(LEAST(1, GREATEST(-1, 1 - (a.embedding_vector <=> b.embedding_vector)))::numeric, 5) AS s
         FROM version_embeddings a, version_embeddings b WHERE a.version_id=$1 AND b.version_id=$2`,
      [p.version_id, c.version_id])).rows[0].s;
    const { added, removed } = lineStats(p.content_text, c.content_text);
    await pool.query(
      `INSERT INTO semantic_changes (from_version_id, to_version_id, similarity_score, change_type, change_summary)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (from_version_id, to_version_id) DO UPDATE SET similarity_score = EXCLUDED.similarity_score,
         change_type = EXCLUDED.change_type, change_summary = EXCLUDED.change_summary, detected_at = now()`,
      [p.version_id, c.version_id, s, changeType(added, removed), `${added} lines added, ${removed} removed, similarity ${s}`]);
  }
  console.log("Done.");
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
