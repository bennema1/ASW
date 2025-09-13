export function streamStory(
  params: Record<string, string>,
  onChunk: (t: string) => void,
  onDone: () => void
) {
  const q = new URLSearchParams(params).toString();
  const es = new EventSource(`/api/generate?${q}`);
  es.onmessage = (e) => {
    if (e.data === "[DONE]") { es.close(); onDone(); return; }
    onChunk(e.data);
  };
  es.onerror = () => es.close();
  return () => es.close();
}
