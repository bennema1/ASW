// lib/algo/storyEngine.ts
import { seededStyle, seededTopic } from "./seeds";
import type { BuildPromptArgs } from "./types";

type Mode = "initial" | "continue";
type Continuation = "aita" | "arc";

export function buildPrompt(args: BuildPromptArgs & {
  mode?: Mode;                 // "initial" | "continue"
  ctx?: string;                // prior context from client (last 1–2k chars)
  continuation?: Continuation; // "aita" => UPDATE style, "arc" => next scene
}) {
  const mode: Mode = args.mode ?? "initial";
  const styleSeed = seededStyle(args.seed);
  const topicSeed = seededTopic(args.seed);

  // ---------------- SYSTEM ----------------
  const system = [
    `You are a fast, punchy storyteller for short-form, social video. You can be slightly innapropriate.`,
    `Voice: Reddit AITA/relationships cadence; modern, self-aware, realistic.`,
    `Avoid identifiable brands and real names. No super explicit content (a little is fine)`,
    `Write clean, readable prose.`,
  ].join("\n");

  // Build the USER instruction based on mode
  let user: string;

  if (mode === "initial") {
    user = [
      args.rollingSummary ? `Context so far: ${args.rollingSummary}` : ``,
      `STYLE: ${styleSeed}.`,
      `TOPIC SEED (for inspiration, optional): ${topicSeed}`,
      `LENGTH: ~${args.maxWords} words total.`,
      `FORMAT (must match exactly with labels):`,
      `Title: <one line, vivid, no quotes>`,
      ``,
      `Hook: <1–2 lines, immediate stakes/tension, no label repetition>`,
      ``,
      `Story: <5–10 short, vivid sentences; grounded; conclude on a reflective beat or "AITA?" if relevant>`,
      ``,
      // Voice anchor per your example
      `VOICE & POV EXAMPLE: First-person narrator (28F) married 5 years to husband (28M).`,
      `Husband is the "nice guy" who can be taken advantage of; narrator often has to be the "bad guy" to advocate for them.`,
      `keep your tone and voice concise and fit for your story. Do not change your voice suddenly`,
    ]
      .filter(Boolean)
      .join("\n");
  } else {
    // CONTINUE mode: extend same narrative; Story only (no Title/Hook)
    const flavor =
      (args.continuation ?? "arc") === "aita"
        ? `Write an UPDATE entry in the same AITA thread from the same narrator.`
        : `Write the next scene/arc continuing the same characters, stakes, and tone.`;
    user = [
      args.ctx ? `PRIOR CONTEXT (verbatim excerpts):\n${args.ctx}\n` : ``,
      flavor,
      `Keep continuity (names/ages/relationships/timeline).`,
      `Do NOT recap the entire prior story—advance it.`,
      `LENGTH: ~${Math.max(80, Math.min(200, args.maxWords))} words.`,
      `FORMAT (must match exactly):`,
      `Story: <continue narrative only; no Title, no Hook>`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  const titleHint =
    mode === "initial" ? `seed:${topicSeed}` : `continuation:${args.continuation ?? "arc"}`;

  return { system, user, titleHint };
}
