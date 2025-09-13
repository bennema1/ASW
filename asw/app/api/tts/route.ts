export const runtime = "nodejs";
import OpenAI from "openai";

export async function POST(req: Request) {
  try {
    const { text, voice = "alloy" } = await req.json();

    if (!process.env.OPENAI_API_KEY) {
      return new Response("Missing OPENAI_API_KEY (check .env.local and restart dev)", { status: 500 });
    }
    if (!text || typeof text !== "string") {
      return new Response("Missing 'text'", { status: 400 });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const speech = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice,          // alloy | ash | ballad | coral | echo | sage | shimmer | verse
      input: text,
    });

    const arrayBuffer = await speech.arrayBuffer();
    return new Response(Buffer.from(arrayBuffer), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    // Print the *actual* failure reason to your dev console
    try {
      const msg = err?.response ? await err.response.text() : (err?.message ?? String(err));
      console.error("TTS error:", msg);
      return new Response(msg, { status: 500 });
    } catch {
      console.error("TTS error:", err);
      return new Response("TTS failed", { status: 500 });
    }
  }
}
