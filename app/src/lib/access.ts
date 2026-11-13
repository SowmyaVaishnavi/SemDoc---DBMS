import { q } from "./db";
import type { User } from "./auth";

export type DocAccess = { read: boolean; write: boolean; manage: boolean; label: string };
const NONE: DocAccess = { read: false, write: false, manage: false, label: "none" };

/**
 * Permission rules (checked on the server for every request):
 *  - Admin: everything.
 *  - document_access Owner : read, write, manage (settings, sharing, delete).
 *  - document_access Editor: read, write (new versions, tags).
 *  - document_access Viewer: read, comment.
 *  - A user whose global role is Viewer can never write, whatever the document says.
 */
export async function getAccess(user: User, docId: number): Promise<DocAccess> {
  if (user.role === "Admin") return { read: true, write: true, manage: true, label: "Admin" };
  const rows = await q<{ access_role: string }>(
    "SELECT access_role FROM document_access WHERE doc_id = $1 AND user_id = $2",
    [docId, user.user_id],
  );
  const r = rows[0]?.access_role;
  if (!r) return NONE;
  const canWrite = user.role !== "Viewer" && (r === "Owner" || r === "Editor");
  return { read: true, write: canWrite, manage: r === "Owner", label: r };
}

/** SQL fragment: rows of <alias>.doc_id the user may read. Uses $n and $n+1 as (isAdmin, userId). */
export const readable = (alias: string, n: number) =>
  `($${n}::boolean OR EXISTS (SELECT 1 FROM document_access da WHERE da.doc_id = ${alias}.doc_id AND da.user_id = $${n + 1}))`;
export const readableArgs = (u: User) => [u.role === "Admin", u.user_id];
