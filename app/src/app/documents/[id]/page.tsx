import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getAccess } from "@/lib/access";
import { fmt, q } from "@/lib/db";
import { leaveDocumentAction } from "../../actions";
import { ErrorBox, Sim, TypeBadge } from "../../components";

export default async function DocPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser();
  const id = Number((await params).id);
  const { error } = await searchParams;
  if (!Number.isInteger(id)) notFound();
  const acc = await getAccess(user, id);
  if (!acc.read) notFound(); // do not reveal that the document exists

  const [doc] = await q(`SELECT d.title, d.description, d.created_at, d.updated_at, u.name AS owner FROM documents d
                         JOIN users u ON u.user_id = d.owner_id WHERE d.doc_id = $1`, [id]);
  if (!doc) notFound();
  // Q4: timeline with author and change score
  const versions = await q(
    `SELECT vt.version_number, u.name AS author, vt.commit_message, vt.created_at,
            sc.change_type, sc.similarity_score, sc.change_summary, vf.version_number AS from_number,
            (SELECT count(*) FROM comments c WHERE c.version_id = vt.version_id) AS comments
       FROM document_versions vt JOIN users u ON u.user_id = vt.created_by
       LEFT JOIN semantic_changes sc ON sc.to_version_id = vt.version_id
       LEFT JOIN document_versions vf ON vf.version_id = sc.from_version_id
      WHERE vt.doc_id = $1 ORDER BY vt.version_number DESC`, [id]);
  const tags = await q(`SELECT t.tag_name FROM document_tags dt JOIN tags t ON t.tag_id = dt.tag_id WHERE dt.doc_id = $1 ORDER BY 1`, [id]);
  const latest = versions[0]?.version_number;

  return (<>
    <h1>{doc.title}</h1>
    <p className="sub">{doc.description} · owner {doc.owner} · your access: {acc.label}</p>
    <ErrorBox error={error} />
    <p className="tags">{tags.map((t: any) => <Link key={t.tag_name} href={`/documents?tag=${encodeURIComponent(t.tag_name)}`} className="badge">{t.tag_name}</Link>)}</p>
    <p className="row" style={{ justifyContent: "flex-start" }}>
      <Link className="btn" href={`/documents/${id}/versions/${latest}`} style={{ flex: "0 0 auto" }}>Read latest (v{latest})</Link>
      {acc.write && <Link className="btn alt" href={`/documents/${id}/edit`} style={{ flex: "0 0 auto" }}>New version</Link>}
      {acc.write && <Link className="btn alt" href={`/documents/${id}/settings`} style={{ flex: "0 0 auto" }}>{acc.manage ? "Settings & team" : "Settings"}</Link>}
      {(acc.label === "Editor" || acc.label === "Viewer") && (<form action={leaveDocumentAction} style={{ flex: "0 0 auto" }}><input type="hidden" name="docId" value={id} /><button className="alt" title="Remove yourself from this document">Leave document</button></form>)}
    </p>
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Version timeline</h2>
      <table><thead><tr><th>Ver</th><th>Author / message</th><th>Change vs previous</th><th>Similarity</th><th>Date</th><th></th></tr></thead><tbody>
        {versions.map((v: any) => (<tr key={v.version_number}>
          <td><Link href={`/documents/${id}/versions/${v.version_number}`}>v{v.version_number}</Link></td>
          <td>{v.author}<br /><span className="mute">{v.commit_message}</span></td>
          <td><TypeBadge t={v.change_type} /><br /><span className="mute">{v.change_summary}</span></td>
          <td><Sim score={v.similarity_score} /></td>
          <td className="mute">{fmt(v.created_at)}</td>
          <td>{v.from_number && <Link href={`/documents/${id}/compare?from=${v.from_number}&to=${v.version_number}`}>diff</Link>}
              {Number(v.comments) > 0 && <span className="badge" style={{ marginLeft: 6 }}>{v.comments} 💬</span>}</td>
        </tr>))}
      </tbody></table>
    </div>
  </>);
}
