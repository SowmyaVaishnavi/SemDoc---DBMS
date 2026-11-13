export function ErrorBox({ error }: { error?: string }) {
  return error ? <div className="err">{error}</div> : null;
}

/** similarity 0..1 -> bar + percentage; < 0.85 is the "major shift" threshold from the plan */
export function Sim({ score }: { score: number | string | null | undefined }) {
  if (score == null) return <span className="mute">—</span>;
  const s = Number(score);
  const low = s < 0.85;
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
      <span className={`bar ${low ? "low" : ""}`} style={{ width: 80 }}><i style={{ width: `${Math.max(0, s) * 100}%` }} /></span>
      {s.toFixed(3)} {low && <span className="badge red">major shift</span>}
    </span>
  );
}

export const TypeBadge = ({ t }: { t: string | null }) =>
  t ? <span className={`badge ${t === "addition" ? "green" : t === "deletion" ? "amber" : "red"}`}>{t}</span> : <span className="mute">—</span>;
