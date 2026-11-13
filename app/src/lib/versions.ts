import { createHash } from "crypto";
import { diffArrays } from "diff";
import type { PoolClient } from "pg";
import { AppError, tx } from "./db";
import { embed, MODEL_NAME, toVec } from "./embedding";

export const MAX_CONTENT = 200_000;

/** Split into lines the same way everywhere (so a missing final newline is not a change). */
export const toLines = (t: string) => t.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");

export function lineStats(oldText: string, newText: string) {
  let added = 0, removed = 0;
  for (const p of diffArrays(toLines(oldText), toLines(newText))) {
    if (p.added) added += p.value.length;
    else if (p.removed) removed += p.value.length;
  }
  return { added, removed };
}

/** Label rule from the project plan: only additions -> addition, only removals -> deletion, else rewrite. */
export function changeType(added: number, removed: number) {
  if (added > 0 && removed === 0) return "addition";
  if (removed > 0 && added === 0) return "deletion";
  return "rewrite";
}

function validate(content: string, commit: string) {
  if (!content.trim()) throw new AppError("Content cannot be empty.");
  if (content.length > MAX_CONTENT) throw new AppError(`Content is limited to ${MAX_CONTENT} characters.`);
  if (commit.length > 500) throw new AppError("Commit message is limited to 500 characters.");
}

/**
 * Inserts the next version of a document, its embedding and the semantic change against the
 * previous version. Must run inside a transaction that already holds  SELECT ... FOR UPDATE
 * on the document row (so two editors cannot get the same version number).
 */
async function insertVersion(c: PoolClient, docId: number, userId: number, content: string, commit: string, vec: number[]) {
  const hash = createHash("sha256").update(content, "utf8").digest("hex");
  const prev = (
    await c.query(
      `SELECT dv.version_id, dv.content_text, dv.content_hash, ve.embedding_model
         FROM document_versions dv
         LEFT JOIN version_embeddings ve ON ve.version_id = dv.version_id
        WHERE dv.doc_id = $1 ORDER BY dv.version_number DESC LIMIT 1`,
      [docId],
    )
  ).rows[0];
  if (prev && prev.content_hash === hash) throw new AppError("No changes since the latest version, so nothing was saved.");

  const v = (
    await c.query(
      `INSERT INTO document_versions (doc_id, version_number, content_text, content_hash, commit_message, created_by)
       VALUES ($1, fn_next_version_number($1), $2, $3, $4, $5)
       RETURNING version_id, version_number`,
      [docId, content, hash, commit || null, userId],
    )
  ).rows[0];

  await c.query(
    `INSERT INTO version_embeddings (version_id, embedding_vector, embedding_model) VALUES ($1, $2::vector, $3)`,
    [v.version_id, toVec(vec), MODEL_NAME],
  );

  if (prev && prev.embedding_model === MODEL_NAME) {
    const sim = (
      await c.query(
        `SELECT round(LEAST(1, GREATEST(-1, 1 - (a.embedding_vector <=> b.embedding_vector)))::numeric, 5) AS s
           FROM version_embeddings a, version_embeddings b
          WHERE a.version_id = $1 AND b.version_id = $2`,
        [prev.version_id, v.version_id],
      )
    ).rows[0].s;
    const { added, removed } = lineStats(prev.content_text, content);
    await c.query(
      `INSERT INTO semantic_changes (from_version_id, to_version_id, similarity_score, change_type, change_summary)
       VALUES ($1, $2, $3, $4, $5)`,
      [prev.version_id, v.version_id, sim, changeType(added, removed),
       `${added} lines added, ${removed} removed, similarity ${sim}`],
    );
  }
  return v as { version_id: number; version_number: number };
}

export async function saveVersion(docId: number, userId: number, content: string, commit: string) {
  validate(content, commit);
  const vec = await embed(content); // slow part, done before the lock is taken
  return tx(async (c) => {
    await c.query("SELECT 1 FROM documents WHERE doc_id = $1 FOR UPDATE", [docId]);
    return insertVersion(c, docId, userId, content, commit, vec);
  });
}

export async function createDocument(userId: number, title: string, description: string, content: string) {
  if (!title.trim() || title.length > 255) throw new AppError("Title is required (max 255 characters).");
  validate(content, "Initial version");
  const vec = await embed(content);
  return tx(async (c) => {
    const d = (
      await c.query(`INSERT INTO documents (title, description, owner_id) VALUES ($1, $2, $3) RETURNING doc_id`,
        [title.trim(), description.trim() || null, userId])
    ).rows[0];
    await c.query("SELECT 1 FROM documents WHERE doc_id = $1 FOR UPDATE", [d.doc_id]);
    await insertVersion(c, d.doc_id, userId, content, "Initial version", vec);
    return d.doc_id as number;
  });
}
