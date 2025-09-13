"use client";
import { useEffect, useRef, useState } from "react";

const BLOCK_SIZE = 35;           // words per subtitle block
const WPM = 400;                 // reading speed (lower = slower)
const MIN_MS = 1500;             // minimum on-screen time per block
const PAUSE_BETWEEN_SECTIONS_MS = 1000; // after Hook before Story
const CTX_BYTES = 1500;          // how much prior text to send in ctx (approx)

type Phase = "idle" | "loading" | "playing_hook" | "pause" | "playing_story" | "done" | "error";
type RunState = {
  seed: string;
  cont: "aita" | "arc";
};

export default function Page() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [overlay, setOverlay] = useState(""); // "New generation…" interstitial

  // Streaming & parsing
  const esRef = useRef<EventSource | null>(null);
  const rawRef = useRef<string>("");           // full raw text from current stream
  const storyRawRef = useRef<string>("");      // cumulative story text only
  const hookQueueRef = useRef<string[][]>([]);
  const storyQueueRef = useRef<string[][]>([]);
  const carryRef = useRef<string>("");         // partial word carry for incremental story
  const displayingRef = useRef<boolean>(false);
  const stoppedRef = useRef<boolean>(false);
  const runRef = useRef<RunState | null>(null); // current run params

  // Helpers
  const blockDurationMs = (words: number) =>
    Math.max(MIN_MS, Math.round((words / WPM) * 60000));

  const toBlocks = (text: string) => {
    const words = text.split(/\s+/).filter(Boolean);
    const blocks: string[][] = [];
    for (let i = 0; i < words.length; i += BLOCK_SIZE) {
      blocks.push(words.slice(i, i + BLOCK_SIZE));
    }
    return blocks;
  };

  function feedStoryIncremental(chunk: string) {
    const incoming = carryRef.current + chunk;
    const parts = incoming.split(/(\s+)/);
    const flushed: string[] = [];
    let newCarry = "";

    for (let i = 0; i < parts.length; i += 2) {
      const token = parts[i] ?? "";
      const sep = parts[i + 1] ?? "";
      if (sep) {
        if (token) flushed.push(token);
      } else {
        newCarry = token;
      }
    }
    carryRef.current = newCarry;

    if (flushed.length) {
      if (
        storyQueueRef.current.length === 0 ||
        storyQueueRef.current.at(-1)!.length === BLOCK_SIZE
      ) {
        storyQueueRef.current.push([]);
      }
      let bucket = storyQueueRef.current.at(-1)!;
      flushed.forEach((w) => {
        bucket.push(w);
        if (bucket.length === BLOCK_SIZE) {
          bucket = [];
          storyQueueRef.current.push(bucket);
        }
      });
      if (storyQueueRef.current.at(-1) && storyQueueRef.current.at(-1)!.length === 0) {
        storyQueueRef.current.pop();
      }
    }
  }

  function driveQueue(
    queueRef: React.MutableRefObject<string[][]>,
    onEmpty?: () => void
  ) {
    if (displayingRef.current) return;
    const next = queueRef.current.shift();
    if (!next || next.length === 0) {
      onEmpty && onEmpty();
      return;
    }
    displayingRef.current = true;
    setSubtitle(next.join(" "));
    const ms = blockDurationMs(next.length);
    setTimeout(() => {
      displayingRef.current = false;
      driveQueue(queueRef, onEmpty);
    }, ms);
  }

  function closeStream() {
    esRef.current?.close();
    esRef.current = null;
  }

  function openStream(params: string) {
    closeStream();
    const es = new EventSource(`/api/generate?${params}`);
    esRef.current = es;

    es.onmessage = (e) => {
      if (e.data === "[DONE]") {
        es.close();
        esRef.current = null;
        // If we're in story phase, immediately schedule another continuation unless stopped
        if (!stoppedRef.current && phase === "playing_story") {
          scheduleContinuation();
        }
        return;
      }

      // *** ONLY parse & display the parts we want ***
      rawRef.current += e.data;

      // Extract Title once (we never display labels in subtitles)
      if (!title) {
        const tIdx = rawRef.current.indexOf("Title:");
        if (tIdx !== -1) {
          const after = rawRef.current.slice(tIdx + "Title:".length);
          const nl = after.indexOf("\n");
          if (nl !== -1) {
            const t = after.slice(0, nl).trim();
            if (t) setTitle(t);
          }
        }
      }

      const hookIdx = rawRef.current.indexOf("Hook:");
      const storyIdx = rawRef.current.indexOf("Story:");

      // Build full hook blocks once, then play them
      if (
        hookIdx !== -1 &&
        storyIdx !== -1 &&
        storyIdx > hookIdx &&
        phase === "loading"
      ) {
        const hookBody = rawRef.current
          .slice(hookIdx + "Hook:".length, storyIdx)
          .replace(/^\s+|\s+$/g, "");
        hookQueueRef.current = toBlocks(hookBody);
        setPhase("playing_hook");
        driveQueue(hookQueueRef, () => {
          // pause, then start story display
          setSubtitle("");
          setTimeout(() => {
            setPhase("playing_story");
            driveQueue(storyQueueRef);
          }, PAUSE_BETWEEN_SECTIONS_MS);
        });
      }

      // Feed story incrementally (everything after the *first* Story: marker)
      if (storyIdx !== -1) {
        const afterStory = rawRef.current.slice(storyIdx + "Story:".length);
        const delta = afterStory.slice(storyRawRef.current.length);
        if (delta) {
          storyRawRef.current += delta;
          feedStoryIncremental(delta);
          if (phase === "playing_story" && !displayingRef.current) {
            driveQueue(storyQueueRef);
          }
        }
      }
    };

    es.onerror = () => {
      setPhase("error");
      es.close();
      esRef.current = null;
    };
  }

  function startInitialRun() {
    stoppedRef.current = false;
    setOverlay("");
    setPhase("loading");
    setTitle("");
    setSubtitle("");
    rawRef.current = "";
    storyRawRef.current = "";
    hookQueueRef.current = [];
    storyQueueRef.current = [];
    carryRef.current = "";

    const seed = String(Date.now());
    // decide continuation flavor based on future Title (we also let server know later)
    runRef.current = { seed, cont: "arc" }; // default; we’ll upgrade to 'aita' once title contains "AITA"
    const params = new URLSearchParams({
      seed,
      maxWords: "180",
      mode: "initial",
      force: "1",
    }).toString();
    openStream(params);
  }

  // Called each time a stream ends in story phase to extend the narrative
  function scheduleContinuation() {
    if (!runRef.current || stoppedRef.current) return;

    // infer continuation type from title
    const cont: "aita" | "arc" = title.toUpperCase().includes("AITA") ? "aita" : "arc";
    runRef.current.cont = cont;

    // Build a compact context (last CTX_BYTES of (Title + Hook + Story))
    const ctxSrc = (title + "\n\n" + rawRef.current).slice(-CTX_BYTES);
    const ctxB64 = btoa(unescape(encodeURIComponent(ctxSrc))); // base64 for URL

    const seed = String(Date.now());
    const params = new URLSearchParams({
      seed,
      maxWords: "160",
      mode: "continue",
      cont,
      ctx: ctxB64,
      force: "1",
    }).toString();

    // Keep playing story blocks while new ones are streaming in
    if (phase !== "playing_story") setPhase("playing_story");
    openStream(params);
  }

  // New Generation button handler
  function newGeneration() {
    stoppedRef.current = true;  // stop the continuation loop
    closeStream();
    setSubtitle("");
    setOverlay("New generation…");
    setTimeout(() => {
      setOverlay("");
      startInitialRun();
    }, 1000);
  }

  // Start first run on mount
  useEffect(() => {
    startInitialRun();
    return () => closeStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main style={{ minHeight: "100svh" }}>
      {/* Background video (optional) */}
      <video
        autoPlay
        muted
        loop
        playsInline
        src="/bg.mp4"
        style={{
          position: "fixed",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          zIndex: -2
        }}
      />

      {/* Readability vignette */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background:
            "radial-gradient(ellipse at center, rgba(0,0,0,0.25), rgba(0,0,0,0.65))",
          zIndex: -1
        }}
      />

      {/* Title at top center */}
      <div
        style={{
          position: "fixed",
          top: 24,
          left: 0,
          right: 0,
          textAlign: "center",
          color: "white",
          fontSize: 28,
          fontWeight: 700,
          textShadow: "0 2px 8px rgba(0,0,0,0.6)",
          padding: "0 12px"
        }}
      >
        {title || "…"}
      </div>

      {/* Centered subtitles (Hook then Story) */}
      <div
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          maxWidth: 900,
          width: "min(90vw, 900px)",
          minHeight: 64,
          padding: "14px 18px",
          borderRadius: 14,
          background: "rgba(0,0,0,0.55)",
          color: "white",
          fontSize: 24,
          lineHeight: 1.45,
          textAlign: "center",
          backdropFilter: "blur(2px)",
          boxShadow: "0 10px 30px rgba(0,0,0,0.35)"
        }}
      >
        {overlay || subtitle}
      </div>

      {/* Bottom button: stop + new generation */}
      <div
        style={{
          position: "fixed",
          bottom: 24,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center"
        }}
      >
        <button
          onClick={newGeneration}
          style={{
            pointerEvents: "auto",
            padding: "10px 16px",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.4)",
            background: "rgba(0,0,0,0.5)",
            color: "white",
            fontSize: 16,
            backdropFilter: "blur(2px)"
          }}
        >
          New Generation
        </button>
      </div>
    </main>
  );
}
