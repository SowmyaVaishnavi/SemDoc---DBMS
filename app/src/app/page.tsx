import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { readable, readableArgs } from "@/lib/access";
import { fmt, q } from "@/lib/db";
import { ErrorBox, Sim, TypeBadge } from "./components";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser();
  const { error } = await searchParams;
  const a = readableArgs(user);

  const [totals, shifts, stale, avg, activity] = await Promise.all([
    q(`SELECT (SELECT count(*) FROM documents d WHERE ${readable("d", 1)}) AS docs,
              (SELECT count(*) FROM document_versions v WHERE ${readable("v", 1)}) AS versions`, a),
    // Q7: latest change below the 0.85 threshold
    q(`SELECT lv.doc_id, lv.title, lv.version_number, sc.similarity_score, sc.change_type
         FROM v_latest_version lv JOIN semantic_changes sc ON sc.to_version_id = lv.version_id
        WHERE sc.similarity_score < 0.85 AND ${readable("lv", 1)} ORDER BY sc.similarity_score`, a),
    // Q8: not edited in 30 days
    q(`SELECT d.doc_id, d.title, d.updated_at FROM documents d
        WHERE ${readable("d", 1)} AND NOT EXISTS (SELECT 1 FROM document_versions v
              WHERE v.doc_id = d.doc_id AND v.created_at > now() - INTERVAL '30 days')
        ORDER BY d.updated_at`, a),
    // Q9: average similarity per document
    q(`SELECT d.doc_id, d.title, count(sc.change_id) AS changes, round(avg(sc.similarity_score),3) AS avg_sim,
              min(sc.similarity_score) AS lowest
         FROM documents d JOIN document_versions vt ON vt.doc_id = d.doc_id
         JOIN semantic_changes sc ON sc.to_version_id = vt.version_id
        WHERE ${readable("d", 1)} GROUP BY d.doc_id, d.title ORDER BY avg_sim`, a),
    // Q6: most active editors (view)
    q(`SELECT name, role, versions_created, comments_written, last_active FROM v_user_activity
        ORDER BY versions_created DESC, comments_written DESC LIMIT 5`),
  ]);

  return (<>
    <h1>Dashboard</h1>
    <p className="sub">Welcome, {user.name}. You can see {totals[0].docs} documents and {totals[0].versions} versions.</p>
    <ErrorBox error={error} />
    {Number(totals[0].docs) === 0 && (<div className="card"><h2 style={{ marginTop: 0 }}>Get started</h2>
      {user.role !== "Viewer"
        ? <p>You do not have any documents yet. <Link href="/documents/new">Create your first document</Link> to start tracking versions, then add teammates from its <b>Settings &amp; team</b> page.</p>
        : <p className="mute">Your account is read-only. Documents shared with you will appear here.</p>}
    </div>)}
    <div className="grid">
      <div className="card"><h2 style={{marginTop:0}}>Major semantic shifts</h2>
        <p className="mute">Latest change scored below 0.85.</p>
        {shifts.length === 0 ? <p className="mute">None.</p> : (
          <table><tbody>{shifts.map((r: any) => (
            <tr key={r.doc_id}><td><Link href={`/documents/${r.doc_id}`}>{r.title}</Link><br/><span className="mute">v{r.version_number}</span> <TypeBadge t={r.change_type}/></td>
              <td><Sim score={r.similarity_score}/></td></tr>))}</tbody></table>)}
      </div>
      <div className="card"><h2 style={{marginTop:0}}>Stale documents</h2>
        <p className="mute">No new version in 30 days.</p>
        {stale.length === 0 ? <p className="mute">None.</p> : (
          <table><tbody>{stale.map((r: any) => (
            <tr key={r.doc_id}><td><Link href={`/documents/${r.doc_id}`}>{r.title}</Link></td><td className="mute">{fmt(r.updated_at)}</td></tr>))}</tbody></table>)}
      </div>
    </div>
    <div className="card"><h2 style={{marginTop:0}}>Average similarity per document</h2>
      <table><thead><tr><th>Document</th><th>Changes</th><th>Average</th><th>Lowest</th></tr></thead><tbody>
        {avg.map((r: any) => (<tr key={r.doc_id}><td><Link href={`/documents/${r.doc_id}`}>{r.title}</Link></td><td>{r.changes}</td><td><Sim score={r.avg_sim}/></td><td>{Number(r.lowest).toFixed(3)}</td></tr>))}
      </tbody></table>
    </div>
    <div className="card"><h2 style={{marginTop:0}}>Most active users</h2>
      <table><thead><tr><th>Name</th><th>Role</th><th>Versions</th><th>Comments</th><th>Last active</th></tr></thead><tbody>
        {activity.map((r: any) => (<tr key={r.name}><td>{r.name}</td><td>{r.role}</td><td>{r.versions_created}</td><td>{r.comments_written}</td><td>{fmt(r.last_active)}</td></tr>))}
      </tbody></table>
    </div>
  </>);
}
