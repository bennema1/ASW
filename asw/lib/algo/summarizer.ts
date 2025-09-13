export function cheapSummarize(texts: string[], k=3, maxLen=400): string {
  const heads = texts.slice(-k).map(t => t.split("\n")[0]).join(" | ");
  return heads.slice(0, maxLen);
}
