import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getAccess } from "@/lib/access";
import { q } from "@/lib/db";
import { saveVersionAction } from "../../../actions";
import { ErrorBox } from "../../../components";
import { SubmitButton } from "../../../submit-button";

export default async function Edit({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser();
  const id = Number((await params).id);
  const { error } = await searchParams;
  if (!Number.isInteger(id)) notFound();
  const acc = await getAccess(user, id);
  if (!acc.read) notFound();
  if (!acc.write) redirect(`/documents/${id}`);
  const rows = await q(`SELECT d.title, dv.version_number, dv.content_text FROM documents d
      JOIN document_versions dv ON dv.doc_id = d.doc_id WHERE d.doc_id = $1 ORDER BY dv.version_number DESC LIMIT 1`, [id]);
  if (!rows[0]) notFound();
  return (<>
    <h1>New version of “{rows[0].title}”</h1>
    <p className="sub">Based on v{rows[0].version_number}. Saving adds v{rows[0].version_number + 1}; older versions never change.</p>
    <ErrorBox error={error} />
    <form action={saveVersionAction} className="card">
      <input type="hidden" name="docId" value={id} />
      <label>Commit message</label><input name="commit" maxLength={500} placeholder="What changed and why?" />
      <label>Content</label><textarea name="content" required defaultValue={rows[0].content_text} />
      <p><SubmitButton pending="Saving… (generating embedding)">Save version</SubmitButton></p>
    </form>
  </>);
}
