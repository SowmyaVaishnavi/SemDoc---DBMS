import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { embed, MODEL_NAME, toVec } from "@/lib/embedding";

export default async function Search({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  const text = ((await searchParams).q ?? "").trim().slice(0, 1000);
  // fn_search_versions only returns versions the user may read (Admin: all; others: Document_Access rows)
  const results = text
    ? await q(`SELECT s.* FROM fn_search_versions($1::vector, $2, 10) s
                 JOIN version_embeddings ve ON ve.version_id = s.version_id AND ve.embedding_model = $3`,
        [toVec(await embed(text)), user.user_id, MODEL_NAME])
    : [];
  return (<>
    <h1>Semantic search</h1>
    <p className="sub">Finds versions by meaning, not just matching words. Model: {MODEL_NAME}.</p>
    <form className="card row" action="/search"><div><input name="q" defaultValue={text} placeholder="e.g. money for staff working remotely" required /></div><button>Search</button></form>
    {text && <div className="card">{results.length === 0 ? <p className="mute">No results.</p> : (
      <table><thead><tr><th>Document</th><th>Similarity</th></tr></thead><tbody>
        {results.map((r: any) => (<tr key={r.version_id}><td><Link href={`/documents/${r.doc_id}/versions/${r.version_number}`}>{r.title} · v{r.version_number}</Link></td>
          <td>{Number(r.similarity).toFixed(3)}</td></tr>))}</tbody></table>)}</div>}
  </>);
}
