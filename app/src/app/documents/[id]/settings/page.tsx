import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getAccess } from "@/lib/access";
import { q } from "@/lib/db";
import { addTagAction, deleteDocumentAction, grantAccessAction, removeTagAction, revokeAccessAction, updateMetaAction } from "../../../actions";
import { ErrorBox } from "../../../components";

export default async function Settings({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser();
  const id = Number((await params).id);
  const { error } = await searchParams;
  if (!Number.isInteger(id)) notFound();
  const acc = await getAccess(user, id);
  if (!acc.read) notFound();
  if (!acc.write) redirect(`/documents/${id}`);

  const [doc] = await q("SELECT title, description, owner_id FROM documents WHERE doc_id = $1", [id]);
  const tags = await q(`SELECT t.tag_id, t.tag_name FROM document_tags dt JOIN tags t ON t.tag_id = dt.tag_id WHERE dt.doc_id = $1 ORDER BY 2`, [id]);
  const access = await q(`SELECT da.user_id, da.access_role, u.name, u.email FROM document_access da JOIN users u ON u.user_id = da.user_id
                           WHERE da.doc_id = $1 ORDER BY da.access_role, u.name`, [id]);
  return (<>
    <p><Link href={`/documents/${id}`}>← {doc.title}</Link></p>
    <h1>Settings & sharing</h1>
    <ErrorBox error={error} />
    <form action={updateMetaAction} className="card"><input type="hidden" name="docId" value={id} />
      <label>Title</label><input name="title" defaultValue={doc.title} required maxLength={255} />
      <label>Description</label><input name="description" defaultValue={doc.description ?? ""} />
      <p><button>Save</button></p></form>

    <div className="card"><h2 style={{ marginTop: 0 }}>Tags</h2>
      <p>{tags.length === 0 && <span className="mute">No tags.</span>}
        {tags.map((t: any) => (<form key={t.tag_id} action={removeTagAction} className="inline"><input type="hidden" name="docId" value={id} /><input type="hidden" name="tagId" value={t.tag_id} />
          <span className="badge">{t.tag_name} <button className="alt" title="remove">×</button></span></form>))}</p>
      <form action={addTagAction} className="row"><input type="hidden" name="docId" value={id} /><div><input name="tag" placeholder="new tag" maxLength={50} required /></div><button>Add tag</button></form></div>

    <div className="card"><h2 style={{ marginTop: 0 }}>Team members</h2>
      <p className="mute">Viewers can read versions and comment. Editors can also save new versions and manage tags. Only the owner (or an admin) can add or remove people.</p>
      <table><thead><tr><th>Member</th><th>Access</th><th></th></tr></thead><tbody>{access.map((a: any) => (<tr key={a.user_id}>
        <td>{a.name}<br /><span className="mute">{a.email}</span></td>
        <td>{acc.manage && a.user_id !== doc.owner_id ? (
          <form action={grantAccessAction} className="row"><input type="hidden" name="docId" value={id} /><input type="hidden" name="email" value={a.email} />
            <select name="role" defaultValue={a.access_role}><option>Viewer</option><option>Editor</option></select><button className="alt">Change</button></form>
        ) : <span className={`badge ${a.access_role === "Owner" ? "green" : ""}`}>{a.access_role}</span>}</td>
        <td>{acc.manage && a.user_id !== doc.owner_id && (<form action={revokeAccessAction}><input type="hidden" name="docId" value={id} /><input type="hidden" name="userId" value={a.user_id} /><button className="alt">Remove</button></form>)}</td></tr>))}</tbody></table>
      {acc.manage ? (<form action={grantAccessAction} className="row" style={{ marginTop: 12 }}><input type="hidden" name="docId" value={id} />
        <div><label>Add a team member by email</label><input name="email" type="email" placeholder="teammate@gmail.com" required /></div>
        <div><label>Access</label><select name="role" defaultValue="Viewer"><option>Viewer</option><option>Editor</option></select></div><button>Add member</button></form>)
        : <p className="mute">Only the owner or an admin can change sharing.</p>}
      {acc.manage && <p className="mute" style={{ marginTop: 8 }}>The person must already have a SemDoc account. Adding someone who is already a member updates their access.</p>}
    </div>

    {acc.manage && <div className="card"><h2 style={{ marginTop: 0, color: "var(--red)" }}>Delete document</h2>
      <p className="mute">Removes the document and all its versions, embeddings, changes and comments. This cannot be undone.</p>
      <form action={deleteDocumentAction} className="row"><input type="hidden" name="docId" value={id} />
        <div><input name="confirm" placeholder="Type DELETE" required /></div><button className="danger">Delete</button></form></div>}
  </>);
}
