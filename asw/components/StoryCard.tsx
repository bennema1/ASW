export default function StoryCard({ text, loading }: { text: string; loading: boolean }) {
  const [title, ...rest] = text.split("\n").filter(Boolean);
  return (
    <article className="card">
      <div className="flair">AITA • TIFU • Relationships • MC</div>
      <h3 className="title">{title || "…"}</h3>
      <div style={{whiteSpace: "pre-wrap"}}>
        {rest.join("\n") || (loading ? <><div className="skel"/><div className="skel"/><div className="skel"/></> : "")}
      </div>
    </article>
  );
}
