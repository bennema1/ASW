export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { buildPrompt } from "@/lib/algo/storyEngine";
import { cheapSummarize } from "@/lib/algo/summarizer";
import { simHashSeen } from "@/lib/algo/dedup";

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const MODEL_ID = process.env.MODEL_ID || "llama3.1:8b";

const enc = (s: string) => new TextEncoder().encode(`data: ${s}\n\n`);
function sse(body: ReadableStream<Uint8Array>) {
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive"
    }
  });
}

const lastBodies: string[] = [];

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const seed = parseInt(searchParams.get("seed") || "1", 10);
  const maxWords = Math.min(220, parseInt(searchParams.get("maxWords") || "600", 10));
  const mode = (searchParams.get("mode") as "initial" | "continue") || "initial";
  const force = searchParams.get("force") === "1";

  // optional base64 ctx from client (URL-safe)
  // client sends encodeURIComponent(base64(...)), so decode it first
  let ctx = "";
  const b64 = searchParams.get("ctx");
  if (b64) {
    try {
      const raw = decodeURIComponent(b64);
      ctx = Buffer.from(raw, "base64").toString("utf8");
    } catch {}
  }


  // heuristic: if initial title contains AITA, use aita updates; else arc
  const cont = (searchParams.get("cont") as "aita" | "arc") || "arc";

  const rollingSummary = cheapSummarize(lastBodies);

  const { system, user, titleHint } = buildPrompt({
    seed,
    rollingSummary,
    maxWords,
    mode,
    ctx,
    continuation: cont,
  });

  // only dedup on initial runs unless force=1
  if (mode === "initial" && !force && simHashSeen(titleHint)) {
    const s = new ReadableStream({
      start(ctrl) {
        ctrl.enqueue(enc("[Similar to prior, skipping]\n"));
        ctrl.enqueue(enc("[DONE]\n"));
        ctrl.close();
      },
    });
    return sse(s);
  }

  const fastOpts: any = {
    num_predict: 140,          // ~140 tokens (tweak)
    temperature: 0.8,
    top_p: 0.9,

    num_thread: 8,

    num_gpu: 1,

    // Slightly smaller context is fine here
    num_ctx: 2048,
  };

  const body = JSON.stringify({
    model: MODEL_ID,
    prompt: `${system}\n\nUser:\n${user}`,
    stream: true,
    options: {
      num_predict: Math.min(4096, Math.round(maxWords * 1.4)),   // shorter = faster
      temperature: 0.7,
      top_p: 0.9,
      num_thread: 8,      // adjust to your CPU cores if you know them
      num_ctx: 4096,
      mirostat: 2,
      mirostat_tau: 5.0,
      mirostat_eta: 0.1,
      repeat_penalty: 1.1,
      repeat_last_n: 256
    },
    keep_alive: "10m"     // keep model hot between requests
  });

  const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body
  });

  if (!res.ok || !res.body) {
    const s = new ReadableStream({
      start(ctrl) { ctrl.enqueue(enc(`ERROR ${res.status}\n`)); ctrl.enqueue(enc("[DONE]\n")); ctrl.close(); }
    });
    return sse(s);
  }

  const reader = res.body.getReader();
  let buf = "";
  let fullText = ""; // <— add this
  let firstChunk = false;

  const stream = new ReadableStream({
    async pull(controller) {
      const r = await reader.read();
      if (r.done) {
        controller.enqueue(enc("[DONE]\n"));
        controller.close();
        // store the actual story text for context
        if (fullText) lastBodies.push(fullText);
        if (lastBodies.length > 20) lastBodies.shift();
        return;
      }
      buf += new TextDecoder().decode(r.value, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const j = JSON.parse(line);
            if (j.response) {
              console.log("[server] token:", j.response);
              fullText += j.response;
              controller.enqueue(enc(j.response));
            }
        } catch { /* ignore partial */ }
      }
    }
  });

  return sse(stream);
}

export async function POST(req: NextRequest) {
  return NextResponse.json({ ok: true }, { status: 200 });  
}

