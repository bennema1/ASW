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
    `Write clean, readable prose. Here's an example of the style you need:`,
    `I'm (38m) a wrestler, i used to compete at a high level, obviously i don't compete anymore but i still lift weights and wrestle for fun. My wife (36f) and i have three kids (15f,11m,9f), i enrolled all our kids in wrestling at the age of 7, the older 2 have been training and competing since then and the youngest didn't like the sport so she quit and now she is doing gymnastics, my wife has never wrestled but she goes to the gym regularly and she has decent strength.

Yesterday i was chatting with my wife and the topic of our daughter's wrestling tournament came up and she asked me what do i think will happen if her and our daughter wrestled and i told her that she has no chance, she answered "she is not beating me, i'm much stronger", and i told her "you can try if you want to, but i'm telling you will get ragdolled", and she said "okay let's do it then", so i called our daughter into the backyard and told her that her mom wants to wrestle, they wrestled while me and the other kids were watching, and just like i told her, my wife got handled with ease.

When they were done (it didn't last long) my wife laughed it off and acted fine, but as soon as it was only me and her she said to me "so you knew how that wrestling match was going to go?" i answred yes and she said "and you still let it happen? I got embarrased by my own child in front of my other children and now they are not going to look at me the same way", i told her she is the one who asked for it, and the idea that our kids will not look at her the same way is completly false because i taught our kids to be gracful and respectful in victory and defeat, and i'm pretty sure they have respect for their mother regardless of what happens in a wrestling match, even after i said she wasn't not convinced and still upset which is not justified in my opinion.

AITA?`,
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
