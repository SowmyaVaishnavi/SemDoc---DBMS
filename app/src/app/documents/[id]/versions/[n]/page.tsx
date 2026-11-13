import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getAccess, readable, readableArgs } from "@/lib/access";
import { fmt, q } from "@/lib/db";
import { addCommentAction, deleteCommentAction } from "../../../../actions";
import { ErrorBox, Sim, TypeBadge } from "../../../../components";

export default async function VersionPage({ params, searchParams }: { params: Promise<{ id: string; n: string }>; searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser();
  const p = await params;
  const id = Number(p.id), n = Number(p.n);
  const { error } = await searchParams;
  if (!Number.isInteger(id) || !Number.isInteger(n)) notFound();
  const acc = await getAccess(user, id);
  if (!acc.read) notFound();

  const [v] = await q(`SELECT dv.version_id, dv.version_number, dv.content_text, dv.content_hash, dv.commit_message, dv.created_at,
                              u.name AS author, d.title
                         FROM document_versions dv JOIN users u ON u.user_id = dv.created_by JOIN documents d ON d.doc_id = dv.doc_id
                        WHERE dv.doc_id = $1 AND dv.version_number = $2`, [id, n]);
  if (!v) notFound();
  const [change] = await q(`SELECT sc.*, vf.version_number AS from_number FROM semantic_changes sc
                             JOIN document_versions vf ON vf.version_id = sc.from_version_id WHERE sc.to_version_id = $1`, [v.version_id]);
  const comments = await q(`SELECT c.comment_id, c.comment_text, c.created_at, c.user_id, u.name FROM comments c
                             JOIN users u ON u.user_id = c.user_id WHERE c.version_id = $1 ORDER BY c.created_at`, [v.version_id]);
  // Q12: related versions in other documents the user may read
  const related = await q(
    `SELECT d2.doc_id, d2.title, v2.version_number,
            round((1 - (e2.embedding_vector <=> e1.embedding_vector))::numeric, 3) AS similarity
       FROM version_embeddings e1
       JOIN version_embeddings e2 ON e2.version_id <> e1.version_id AND e2.embedding_model = e1.embedding_model
       JOIN document_versions v2 ON v2.version_id = e2.version_id
       JOIN documents d2 ON d2.doc_id = v2.doc_id
      WHERE e1.version_id = $1 AND v2.doc_id <> $2 AND ${readable("d2", 3)}
      ORDER BY e2.embedding_vector <=> e1.embedding_vector LIMIT 3`, [v.version_id, id, ...readableArgs(user)]);
  const back = `/documents/${id}/versions/${n}`;

  return (<>
    <p><Link href={`/documents/${id}`}>← {v.title}</Link></p>
    <h1>{v.title} · v{v.version_number}</h1>
    <p className="sub">{v.author} · {fmt(v.created_at)} · {v.commit_message}</p>
    <ErrorBox error={error} />
    {change && <div className="card"><b>Change from v{change.from_number}:</b> <TypeBadge t={change.change_type} /> <Sim score={change.similarity_score} />
      {" "}<Link href={`/documents/${id}/compare?from=${change.from_number}&to=${v.version_number}`}>view diff</Link>
      <br /><span className="mute">{change.change_summary}</span></div>}
    <div className="card"><pre className="content">{v.content_text}</pre>
      <p className="mute" style={{ marginBottom: 0, fontSize: ".8rem" }}>SHA-256 {v.content_hash}</p></div>

    {related.length > 0 && <div className="card"><h2 style={{ marginTop: 0 }}>Related versions in other documents</h2>
      <table><tbody>{related.map((r: any) => (<tr key={`${r.doc_id}-${r.version_number}`}>
        <td><Link href={`/documents/${r.doc_id}/versions/${r.version_number}`}>{r.title} · v{r.version_number}</Link></td><td>{r.similarity}</td></tr>))}</tbody></table></div>}

    <div className="card"><h2 style={{ marginTop: 0 }}>Comments</h2>
      {comments.length === 0 && <p className="mute">No comments yet.</p>}
      {comments.map((c: any) => (<div key={c.comment_id} style={{ borderBottom: "1px solid var(--line)", padding: "8px 0" }}>
        <b>{c.name}</b> <span className="mute">{fmt(c.created_at)}</span>
        {(c.user_id === user.user_id || acc.manage) && (
          <form action={deleteCommentAction} className="inline"><input type="hidden" name="commentId" value={c.comment_id} />
            <input type="hidden" name="back" value={back} /><button className="alt">delete</button></form>)}
        <div style={{ whiteSpace: "pre-wrap" }}>{c.comment_text}</div></div>))}
      <form action={addCommentAction} style={{ marginTop: 12 }}>
        <input type="hidden" name="versionId" value={v.version_id} /><input type="hidden" name="back" value={back} />
        <textarea name="text" required maxLength={2000} style={{ minHeight: 70, fontFamily: "inherit" }} placeholder="Add a comment…" />
        <p><button>Comment</button></p></form>
    </div>
  </>);
}
