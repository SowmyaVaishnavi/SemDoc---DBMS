import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { readable, readableArgs } from "@/lib/access";
import { fmt, q } from "@/lib/db";

export default async function Documents({ searchParams }: { searchParams: Promise<{ q?: string; tag?: string; scope?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const a = readableArgs(user);
  const kw = (sp.q ?? "").trim().slice(0, 200);
  const tag = (sp.tag ?? "").trim().slice(0, 50);
  const scope = ["mine", "shared"].includes(sp.scope ?? "") ? (sp.scope as string) : "";

  // Q13 + Q5: latest version of every readable document, optional tag filter
  const docs = await q(
    `SELECT lv.doc_id, lv.title, lv.version_number, d.description, d.updated_at, u.name AS owner, d.owner_id, da.access_role AS my_role,
            COALESCE((SELECT string_agg(t.tag_name, ',' ORDER BY t.tag_name) FROM document_tags dt
                      JOIN tags t ON t.tag_id = dt.tag_id WHERE dt.doc_id = lv.doc_id), '') AS tags
       FROM v_latest_version lv JOIN documents d ON d.doc_id = lv.doc_id JOIN users u ON u.user_id = d.owner_id
       LEFT JOIN document_access da ON da.doc_id = lv.doc_id AND da.user_id = $2
      WHERE ${readable("lv", 1)}
        AND ($4 = '' OR ($4 = 'mine' AND d.owner_id = $2) OR ($4 = 'shared' AND d.owner_id <> $2))
        AND ($3 = '' OR EXISTS (SELECT 1 FROM document_tags dt JOIN tags t ON t.tag_id = dt.tag_id
                                 WHERE dt.doc_id = lv.doc_id AND t.tag_name = $3))
      ORDER BY d.updated_at DESC`, [...a, tag, scope]);

  // Q10: keyword (full-text) search over every version, ranked
  const hits = kw ? await q(
    `SELECT d.doc_id, d.title, dv.version_number, ts_rank(dv.content_tsv, query) AS rank,
            ts_headline('english', dv.content_text, query, 'MaxFragments=1,MaxWords=25,MinWords=8') AS snippet
       FROM document_versions dv JOIN documents d ON d.doc_id = dv.doc_id,
            websearch_to_tsquery('english', $3) AS query
      WHERE dv.content_tsv @@ query AND ${readable("d", 1)}
      ORDER BY rank DESC LIMIT 20`, [...a, kw]) : [];

  const tags = await q(
    `SELECT t.tag_name, count(*) AS n FROM tags t JOIN document_tags dt ON dt.tag_id = t.tag_id
      JOIN documents d ON d.doc_id = dt.doc_id WHERE ${readable("d", 1)} GROUP BY t.tag_name ORDER BY n DESC, t.tag_name`, a);

  return (<>
    <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
      <div><h1>Documents</h1><p className="sub">Latest version of every document you can read.</p></div>
      {user.role !== "Viewer" && <Link href="/documents/new" className="btn" style={{ flex: "0 0 auto" }}>New document</Link>}
    </div>
    <form className="card row" action="/documents">
      <div><label>Keyword search (all versions)</label><input name="q" defaultValue={kw} placeholder="e.g. internet allowance" /></div>
      <div><label>Show</label><select name="scope" defaultValue={scope}><option value="">All I can read</option><option value="mine">Owned by me</option><option value="shared">Shared with me</option></select></div>
      <div><label>Tag</label><select name="tag" defaultValue={tag}><option value="">All</option>
        {tags.map((t: any) => <option key={t.tag_name} value={t.tag_name}>{t.tag_name} ({t.n})</option>)}</select></div>
      <button>Search</button>
    </form>

    {kw && (<div className="card"><h2 style={{ marginTop: 0 }}>Keyword results for “{kw}”</h2>
      {hits.length === 0 ? <p className="mute">No matches.</p> : (
        <table><tbody>{hits.map((h: any, i: number) => (
          <tr key={i}><td><Link href={`/documents/${h.doc_id}/versions/${h.version_number}`}>{h.title} · v{h.version_number}</Link>
            <br /><span className="mute" dangerouslySetInnerHTML={{ __html: escapeHeadline(h.snippet) }} /></td></tr>))}</tbody></table>)}
    </div>)}

    <div className="card">
      {docs.length === 0 ? (user.role !== "Viewer" && !kw && !tag && !scope
        ? <p>You have no documents yet. <Link href="/documents/new">Create your first document</Link>, or ask a teammate to add you to theirs.</p>
        : <p className="mute">No documents.</p>) : (
        <table><thead><tr><th>Title</th><th>Owner</th><th>Your access</th><th>Latest</th><th>Tags</th><th>Updated</th></tr></thead><tbody>
          {docs.map((d: any) => (<tr key={d.doc_id}>
            <td><Link href={`/documents/${d.doc_id}`}>{d.title}</Link><br /><span className="mute">{d.description}</span></td>
            <td>{d.owner}</td><td><span className={`badge ${d.my_role === "Owner" ? "green" : ""}`}>{d.my_role ?? (user.role === "Admin" ? "Admin" : "—")}</span></td><td>v{d.version_number}</td>
            <td className="tags">{d.tags && d.tags.split(",").map((t: string) => <Link key={t} href={`/documents?tag=${encodeURIComponent(t)}`} className="badge">{t}</Link>)}</td>
            <td className="mute">{fmt(d.updated_at)}</td></tr>))}
        </tbody></table>)}
    </div>
  </>);
}

/** ts_headline returns text with <b> tags; escape everything else before injecting. */
function escapeHeadline(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/&lt;b&gt;/g, "<b>").replace(/&lt;\/b&gt;/g, "</b>");
}
