export function buildPrompt({
  seed,
  rollingSummary,
  maxWords,
  mode,
  ctx,
  continuation,
}: {
  seed: number;
  rollingSummary: string;
  maxWords: number;
  mode: "initial" | "continue";
  ctx: string;
  continuation: "aita" | "arc";
}) {
  let categories: string[] = [];
  let categoryPrompt = "";
  
  if (ctx) {
    try {
      categories = JSON.parse(ctx);
      if (categories.length > 0) {
        const genreMap: Record<string, string> = {
          mystery: "mystery and suspenseful thriller",
          romance: "romantic and heartfelt",
          scifi: "science fiction with futuristic elements",
          fantasy: "fantasy with magical elements",
          horror: "horror and scary",
          comedy: "humorous and funny",
          drama: "dramatic and emotional",
          adventure: "adventurous and action-packed",
          historical: "historical fiction",
          crime: "true crime style",
          slice: "slice of life and everyday situations",
          aita: "AITA (Am I The Asshole) reddit-style"
        };
        
        const genreDescriptions = categories
          .map(cat => genreMap[cat])
          .filter(Boolean)
          .join(", ");
        
        categoryPrompt = `Generate a ${genreDescriptions} story. `;
        if (categories.includes("aita")) {
          continuation = "aita";
        }
      }
    } catch (e) {
      console.error("Failed to parse categories:", e);
    }
  }
  const system = `You are a creative storyteller. ${categoryPrompt}Create an engaging ${maxWords}-word story with a compelling hook. ${rollingSummary ? `Previous context: ${rollingSummary}` : ''}`;
  const user = mode === "initial" 
    ? `Write a ${maxWords}-word story beginning with "Hook:" or "Story:"`
    : `Continue the story...`;
    
  const titleHint = `story-${seed}-${categories.join('-')}`;

  return { system, user, titleHint };
}