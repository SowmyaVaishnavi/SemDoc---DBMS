import Link from "next/link";
import { notFound } from "next/navigation";
import { diffArrays } from "diff";
import { toLines } from "@/lib/versions";
import { requireUser } from "@/lib/auth";
import { getAccess } from "@/lib/access";
import { q } from "@/lib/db";
import { Sim, TypeBadge } from "../../../components";

export default async function Compare({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const user = await requireUser();
  const id = Number((await params).id);
  const sp = await searchParams;
  const from = Number(sp.from), to = Number(sp.to);
  if (![id, from, to].every(Number.isInteger)) notFound();
  if (!(await getAccess(user, id)).read) notFound();

  const all = await q(`SELECT version_number FROM document_versions WHERE doc_id = $1 ORDER BY version_number`, [id]);
  const rows = await q(`SELECT dv.version_id, dv.version_number, dv.content_text, d.title FROM document_versions dv
                          JOIN documents d ON d.doc_id = dv.doc_id WHERE dv.doc_id = $1 AND dv.version_number IN ($2,$3)`, [id, from, to]);
  const a = rows.find((r: any) => r.version_number === from), b = rows.find((r: any) => r.version_number === to);
  if (!a || !b) notFound();

  // Similarity for any pair, straight from the stored vectors (works for non-adjacent versions too).
  const [sim] = await q(`SELECT round(LEAST(1, GREATEST(-1, 1 - (x.embedding_vector <=> y.embedding_vector)))::numeric, 5) AS s
                           FROM version_embeddings x, version_embeddings y
                          WHERE x.version_id = $1 AND y.version_id = $2 AND x.embedding_model = y.embedding_model`, [a.version_id, b.version_id]);
  const [stored] = await q(`SELECT change_type FROM semantic_changes WHERE from_version_id = $1 AND to_version_id = $2`, [a.version_id, b.version_id]);
  const parts = diffArrays(toLines(a.content_text), toLines(b.content_text));

  return (<>
    <p><Link href={`/documents/${id}`}>← {a.title}</Link></p>
    <h1>Compare v{from} → v{to}</h1>
    <form className="card row" action={`/documents/${id}/compare`}>
      <div><label>From</label><select name="from" defaultValue={from}>{all.map((v: any) => <option key={v.version_number} value={v.version_number}>v{v.version_number}</option>)}</select></div>
      <div><label>To</label><select name="to" defaultValue={to}>{all.map((v: any) => <option key={v.version_number} value={v.version_number}>v{v.version_number}</option>)}</select></div>
      <button>Compare</button>
    </form>
    <div className="card">Semantic similarity: <Sim score={sim?.s} /> {stored && <TypeBadge t={stored.change_type} />}
      <p className="mute" style={{ marginBottom: 0 }}>Text diff shows exactly what changed; similarity shows how much the <i>meaning</i> moved.</p></div>
    <div className="card diff" style={{ padding: 0 }}>
      {parts.flatMap((p, i) => p.value.map((line, j) => (
        <div key={`${i}-${j}`} className={p.added ? "add" : p.removed ? "del" : "same"}>{p.added ? "+ " : p.removed ? "− " : "  "}{line}</div>)))}
    </div>
  </>);
}
