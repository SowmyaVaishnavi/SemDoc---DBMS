"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { createSession, destroySession, requireAdmin, requireUser } from "@/lib/auth";
import { getAccess } from "@/lib/access";
import { AppError, q, tx } from "@/lib/db";
import { createDocument, saveVersion } from "@/lib/versions";

const str = (f: FormData, k: string) => String(f.get(k) ?? "");
const int = (f: FormData, k: string) => {
  const n = Number(f.get(k));
  if (!Number.isInteger(n) || n <= 0) throw new AppError("Invalid request.");
  return n;
};

/** Runs fn, then redirects to its returned path (or `path`). Errors go back to `path` as ?error=. */
async function run(path: string, fn: () => Promise<string | void>): Promise<never> {
  let dest = path;
  try {
    dest = (await fn()) || path;
  } catch (e) {
    let msg = "Something went wrong.";
    if (e instanceof AppError) msg = e.message;
    else {
      console.error(e);
      const code = (e as { code?: string })?.code;
      if (code === "23505") msg = "That already exists.";
      else if (code === "P0001") msg = (e as Error).message; // our trigger messages
    }
    redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(msg)}`);
  }
  redirect(dest);
}

// ---------- auth ----------
const DUMMY = "$2b$10$6MxwuVL6IufecM0T8zzDmuGyOWSmmvjTZPE/5w651fTVBmM2UC2wm";

export async function login(f: FormData) {
  const email = str(f, "email").trim().toLowerCase();
  const password = str(f, "password");
  const rows = await q<{ user_id: number; password_hash: string }>(
    "SELECT user_id, password_hash FROM users WHERE lower(email) = $1", [email]);
  const ok = await bcrypt.compare(password, rows[0]?.password_hash ?? DUMMY);
  if (!rows[0] || !ok) redirect("/login?error=Invalid+email+or+password");
  await createSession(rows[0].user_id);
  redirect("/");
}

export async function register(f: FormData) {
  await run("/register", async () => {
    const name = str(f, "name").trim();
    const email = str(f, "email").trim().toLowerCase();
    const password = str(f, "password");
    if (!name || name.length > 100) throw new AppError("Name is required (max 100 characters).");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new AppError("Enter a valid email.");
    if (password.length < 8) throw new AppError("Password must be at least 8 characters.");
    const hash = await bcrypt.hash(password, 10);
    // New accounts are Editors: they can create their own documents (and become the Owner of them),
    // share those documents with teammates, and edit documents others share with them as Editor.
    // Admin is never self-assigned; Viewer (read-only) is something an admin sets in /admin/users.
    const r = await q<{ user_id: number }>(
      "INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,'Editor') RETURNING user_id",
      [name, email, hash]);
    await createSession(r[0].user_id);
    return "/";
  });
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

// ---------- documents & versions ----------
export async function createDocumentAction(f: FormData) {
  const user = await requireUser();
  await run("/documents/new", async () => {
    if (user.role === "Viewer") throw new AppError("Your role (Viewer) cannot create documents.");
    const id = await createDocument(user.user_id, str(f, "title"), str(f, "description"), str(f, "content"));
    return `/documents/${id}`;
  });
}

export async function saveVersionAction(f: FormData) {
  const user = await requireUser();
  const docId = int(f, "docId");
  await run(`/documents/${docId}/edit`, async () => {
    if (!(await getAccess(user, docId)).write) throw new AppError("You cannot edit this document.");
    const v = await saveVersion(docId, user.user_id, str(f, "content"), str(f, "commit").trim());
    return `/documents/${docId}/versions/${v.version_number}`;
  });
}

export async function updateMetaAction(f: FormData) {
  const user = await requireUser();
  const docId = int(f, "docId");
  await run(`/documents/${docId}/settings`, async () => {
    if (!(await getAccess(user, docId)).write) throw new AppError("You cannot edit this document.");
    const title = str(f, "title").trim();
    if (!title || title.length > 255) throw new AppError("Title is required (max 255 characters).");
    await q("UPDATE documents SET title=$1, description=$2, updated_at=now() WHERE doc_id=$3",
      [title, str(f, "description").trim() || null, docId]);
  });
}

export async function deleteDocumentAction(f: FormData) {
  const user = await requireUser();
  const docId = int(f, "docId");
  await run(`/documents/${docId}/settings`, async () => {
    if (!(await getAccess(user, docId)).manage) throw new AppError("Only the owner or an admin can delete a document.");
    if (str(f, "confirm") !== "DELETE") throw new AppError("Type DELETE to confirm.");
    await q("DELETE FROM documents WHERE doc_id=$1", [docId]); // cascades to versions, embeddings, changes, comments
    return "/documents";
  });
}

// ---------- comments ----------
export async function addCommentAction(f: FormData) {
  const user = await requireUser();
  const versionId = int(f, "versionId");
  const back = str(f, "back") || "/documents";
  await run(back, async () => {
    const r = await q<{ doc_id: number }>("SELECT doc_id FROM document_versions WHERE version_id=$1", [versionId]);
    if (!r[0] || !(await getAccess(user, r[0].doc_id)).read) throw new AppError("You cannot comment here.");
    const text = str(f, "text").trim();
    if (!text || text.length > 2000) throw new AppError("Comment must be 1–2000 characters.");
    await q("INSERT INTO comments (version_id, user_id, comment_text) VALUES ($1,$2,$3)", [versionId, user.user_id, text]);
  });
}

export async function deleteCommentAction(f: FormData) {
  const user = await requireUser();
  const id = int(f, "commentId");
  const back = str(f, "back") || "/documents";
  await run(back, async () => {
    const r = await q<{ user_id: number; doc_id: number }>(
      `SELECT c.user_id, dv.doc_id FROM comments c JOIN document_versions dv ON dv.version_id=c.version_id WHERE c.comment_id=$1`, [id]);
    if (!r[0]) return;
    const acc = await getAccess(user, r[0].doc_id);
    if (r[0].user_id !== user.user_id && !acc.manage) throw new AppError("You can only delete your own comments.");
    await q("DELETE FROM comments WHERE comment_id=$1", [id]);
  });
}

// ---------- tags ----------
export async function addTagAction(f: FormData) {
  const user = await requireUser();
  const docId = int(f, "docId");
  await run(`/documents/${docId}/settings`, async () => {
    if (!(await getAccess(user, docId)).write) throw new AppError("You cannot edit this document.");
    const name = str(f, "tag").trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9 _-]{0,49}$/.test(name)) throw new AppError("Tags: letters, digits, space, - or _ (max 50).");
    await tx(async (c) => {
      const t = await c.query(
        "INSERT INTO tags (tag_name) VALUES ($1) ON CONFLICT (tag_name) DO UPDATE SET tag_name=EXCLUDED.tag_name RETURNING tag_id", [name]);
      await c.query("INSERT INTO document_tags (doc_id, tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [docId, t.rows[0].tag_id]);
    });
  });
}

export async function removeTagAction(f: FormData) {
  const user = await requireUser();
  const docId = int(f, "docId");
  await run(`/documents/${docId}/settings`, async () => {
    if (!(await getAccess(user, docId)).write) throw new AppError("You cannot edit this document.");
    await q("DELETE FROM document_tags WHERE doc_id=$1 AND tag_id=$2", [docId, int(f, "tagId")]);
  });
}

// ---------- sharing ----------
export async function grantAccessAction(f: FormData) {
  const user = await requireUser();
  const docId = int(f, "docId");
  await run(`/documents/${docId}/settings`, async () => {
    if (!(await getAccess(user, docId)).manage) throw new AppError("Only the owner or an admin can share a document.");
    const role = str(f, "role");
    if (!["Editor", "Viewer"].includes(role)) throw new AppError("Choose Editor or Viewer.");
    const u = await q<{ user_id: number; name: string; role: string }>(
      "SELECT user_id, name, role FROM users WHERE lower(email)=$1", [str(f, "email").trim().toLowerCase()]);
    if (!u[0]) throw new AppError("No user with that email. Ask them to sign up first.");
    const owner = await q<{ owner_id: number }>("SELECT owner_id FROM documents WHERE doc_id=$1", [docId]);
    if (owner[0]?.owner_id === u[0].user_id) throw new AppError("That user already owns the document.");
    // A read-only account (global role Viewer) can never write, so do not hand out an Editor role that would silently do nothing.
    if (role === "Editor" && u[0].role === "Viewer")
      throw new AppError(`${u[0].name}'s account is read-only (Viewer), so they can only be given Viewer access. An admin can change their account role.`);
    await q(`INSERT INTO document_access (doc_id, user_id, access_role) VALUES ($1,$2,$3)
             ON CONFLICT (doc_id, user_id) DO UPDATE SET access_role = EXCLUDED.access_role`, [docId, u[0].user_id, role]);
  });
}

/** A shared member can remove themselves from a document (the owner cannot; they delete the document instead). */
export async function leaveDocumentAction(f: FormData) {
  const user = await requireUser();
  const docId = int(f, "docId");
  await run(`/documents/${docId}`, async () => {
    const owner = await q<{ owner_id: number }>("SELECT owner_id FROM documents WHERE doc_id=$1", [docId]);
    if (!owner[0]) throw new AppError("Document not found.");
    if (owner[0].owner_id === user.user_id) throw new AppError("The owner cannot leave their own document. Delete it from Settings instead.");
    await q("DELETE FROM document_access WHERE doc_id=$1 AND user_id=$2", [docId, user.user_id]);
    return "/documents";
  });
}

export async function revokeAccessAction(f: FormData) {
  const user = await requireUser();
  const docId = int(f, "docId");
  await run(`/documents/${docId}/settings`, async () => {
    if (!(await getAccess(user, docId)).manage) throw new AppError("Only the owner or an admin can change sharing.");
    const target = int(f, "userId");
    const owner = await q<{ owner_id: number }>("SELECT owner_id FROM documents WHERE doc_id=$1", [docId]);
    if (owner[0]?.owner_id === target) throw new AppError("The owner's access cannot be removed.");
    await q("DELETE FROM document_access WHERE doc_id=$1 AND user_id=$2", [docId, target]);
  });
}

// ---------- admin ----------
export async function setUserRoleAction(f: FormData) {
  const admin = await requireAdmin();
  await run("/admin/users", async () => {
    const id = int(f, "userId");
    const role = str(f, "role");
    if (!["Admin", "Editor", "Viewer"].includes(role)) throw new AppError("Invalid role.");
    if (id === admin.user_id) throw new AppError("You cannot change your own role.");
    await q("UPDATE users SET role=$1 WHERE user_id=$2", [role, id]);
  });
}
