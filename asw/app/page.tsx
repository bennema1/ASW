"use client";
import { useEffect, useRef, useState } from "react";

const BLOCK_SIZE = 35;            // words per subtitle block
const WPM = 300;                  // words per minute
const MIN_MS = 2000;              // minimum on-screen time per block (ms)
const WATCHDOG_MS = 1500;         // if no new words for this long, flush a partial block
const SMALL_TAIL = 6;             // if < SMALL_TAIL words left, show them as a block
const MAX_WORDS_PER_STORY = 600;  // per-request story size (client hint)
const FALLBACK_START_LEN = 120;   // if no markers by this many chars, start from 0
const NEXT_START_MS = 20000;      // time-based auto-continue for story #2 (ms)

export default function Page() {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [currentBlock, setCurrentBlock] = useState<string>("");

  // --- Stream #1 (first story) ---
  const es1Ref   = useRef<EventSource | null>(null);
  const raw1Ref  = useRef<string>("");
  const phase1Ref= useRef<"pre" | "run">("pre");
  const start1Ref= useRef<number>(0);
  const last1Ref = useRef<number>(0);
  const carry1Ref= useRef<string>("");

  // --- Stream #2 (second story) ---
  const es2Ref   = useRef<EventSource | null>(null);
  const raw2Ref  = useRef<string>("");
  const phase2Ref= useRef<"pre" | "run">("pre");
  const start2Ref= useRef<number>(0);
  const last2Ref = useRef<number>(0);
  const carry2Ref= useRef<string>("");
  const nextStartedRef = useRef<boolean>(false);

  // Shared display queues
  const bufferRef = useRef<string[]>([]);
  const queueRef  = useRef<string[][]>([]);
  const displayingRef = useRef<boolean>(false);

  // Completion flags
  const done1Ref = useRef<boolean>(false);
  const done2Ref = useRef<boolean>(false);

  // Watchdog timing + time-based trigger
  const lastWordAtRef   = useRef<number>(Date.now());
  const firstWordAtRef  = useRef<number>(0);
  const nextTimerIdRef  = useRef<number | null>(null);
  const watchIntervalIdRef = useRef<number | null>(null);

  const blockDurationMs = (words: number) =>
    Math.max(MIN_MS, Math.round((words / WPM) * 60_000));

  function showBlock(words: string[]) {
    displayingRef.current = true;
    setCurrentBlock(words.join(" "));
    const ms = blockDurationMs(words.length);
    setTimeout(() => {
      displayingRef.current = false;
      driveDisplay();
    }, ms);
  }

  function driveDisplay() {
    if (displayingRef.current) return;

    let next = queueRef.current.shift();

    // Flush tiny tail (1–5 words)
    if ((!next || next.length === 0) && bufferRef.current.length > 0 && bufferRef.current.length < SMALL_TAIL) {
      next = bufferRef.current.splice(0, bufferRef.current.length);
    }

    // If both streams done, flush leftovers
    const bothDone = done1Ref.current && (nextStartedRef.current ? done2Ref.current : true);
    if ((!next || next.length === 0) && bothDone && bufferRef.current.length) {
      next = bufferRef.current.splice(0, bufferRef.current.length);
    }

    if (!next || next.length === 0) return;
    showBlock(next);
  }

  // Split text into words while preserving a trailing partial word
  function splitWordsWithCarry(incoming: string, carryRef: React.MutableRefObject<string>) {
    const parts = (carryRef.current + incoming).split(/(\s+)/);
    const words: string[] = [];
    let newCarry = "";
    for (let i = 0; i < parts.length; i += 2) {
      const token = parts[i] ?? "";
      const sep   = parts[i + 1] ?? "";
      if (sep) {
        if (token) words.push(token);
      } else {
        newCarry = token; // partial
      }
    }
    carryRef.current = newCarry;
    return words;
  }

  // Strip markdown bold markers that the model may use as delimiters
  function sanitize(words: string[]) {
    return words.filter(w => w !== "**");
  }

  // Push words into buffer and carve into BLOCK_SIZE chunks
  function enqueueWords(words: string[], fromFirstStream: boolean) {
    if (!words.length) return;
    const filtered = sanitize(words);
    if (filtered.length === 0) return;

    // Arm time-based auto-continue once first words from story #1 arrive
    if (fromFirstStream && firstWordAtRef.current === 0) {
      firstWordAtRef.current = Date.now();
      if (!nextStartedRef.current && nextTimerIdRef.current == null) {
        nextTimerIdRef.current = window.setTimeout(() => {
          if (!nextStartedRef.current) {
            nextStartedRef.current = true;
            openSecondStory();
          }
        }, NEXT_START_MS);
      }
    }

    bufferRef.current.push(...filtered);
    while (bufferRef.current.length >= BLOCK_SIZE) {
      queueRef.current.push(bufferRef.current.splice(0, BLOCK_SIZE));
    }

    lastWordAtRef.current = Date.now();
    driveDisplay();
  }

  // Start markers: Hook:, Story:, or markdown **; fallback if nothing soon
  function findStartIndex(raw: string) {
    const rxHook  = /hook\s*:/i;
    const mh = rxHook.exec(raw);
    if (mh) return mh.index + mh[0].length;

    const rxStory = /story\s*:/i;
    const ms = rxStory.exec(raw);
    if (ms) return ms.index + ms[0].length;

    const boldOpen = raw.indexOf("**");
    if (boldOpen !== -1) return boldOpen + 2;

    if (raw.length >= FALLBACK_START_LEN) return 0; // start from beginning
    return -1;
  }

  function openStory(
    esRef: React.MutableRefObject<EventSource | null>,
    rawRef: React.MutableRefObject<string>,
    phaseRef: React.MutableRefObject<"pre" | "run">,
    startRef: React.MutableRefObject<number>,
    lastRef: React.MutableRefObject<number>,
    carryRef: React.MutableRefObject<string>,
    opts: { maxWords: number; fromFirst: boolean }
  ) {
    const seed = Date.now().toString();
    const es = new EventSource(`/api/generate?seed=${seed}&maxWords=${opts.maxWords}&force=1&mode=initial`);
    esRef.current = es;

    es.onmessage = (e) => {
      if (e.data === "[DONE]") {
        // Emit a dangling carry if present
        if (carryRef.current) {
          enqueueWords([carryRef.current], opts.fromFirst);
          carryRef.current = "";
        }
        if (opts.fromFirst) done1Ref.current = true;
        else done2Ref.current = true;

        // Final flush if everything’s done
        const bothDone = done1Ref.current && (nextStartedRef.current ? done2Ref.current : true);
        if (bothDone && bufferRef.current.length) {
          queueRef.current.push(bufferRef.current.splice(0, bufferRef.current.length));
          driveDisplay();
        }

        es.close();
        esRef.current = null;
        setStatus((s) =>
          done1Ref.current && (nextStartedRef.current ? done2Ref.current : true) ? "done" : s
        );
        return;
      }

      rawRef.current += e.data;

      // Determine start once
      if (phaseRef.current === "pre") {
        const start = findStartIndex(rawRef.current);
        if (start === -1) return; // wait for markers/fallback
        phaseRef.current = "run";
        startRef.current = start;
        lastRef.current = start;
      }

      // Feed only the content after the start marker
      const raw = rawRef.current;
      if (raw.length > lastRef.current) {
        const delta = raw.slice(lastRef.current);
        lastRef.current = raw.length;
        const words = splitWordsWithCarry(delta, carryRef);
        enqueueWords(words, opts.fromFirst);
      }
    };

    es.onerror = () => {
      setStatus("error");
      try { es.close(); } catch {}
      esRef.current = null;
    };
  }

  function openFirstStory() {
    openStory(es1Ref, raw1Ref, phase1Ref, start1Ref, last1Ref, carry1Ref, {
      maxWords: MAX_WORDS_PER_STORY,
      fromFirst: true
    });
  }
  function openSecondStory() {
    // Cancel auto-continue timer if still pending
    if (nextTimerIdRef.current != null) {
      window.clearTimeout(nextTimerIdRef.current);
      nextTimerIdRef.current = null;
    }
    openStory(es2Ref, raw2Ref, phase2Ref, start2Ref, last2Ref, carry2Ref, {
      maxWords: MAX_WORDS_PER_STORY,
      fromFirst: false
    });
  }

  // --- lifecycle helpers: cleanup + reset/start ---
  function cleanup() {
    try { es1Ref.current?.close(); } catch {}
    try { es2Ref.current?.close(); } catch {}
    es1Ref.current = null;
    es2Ref.current = null;

    if (nextTimerIdRef.current != null) {
      window.clearTimeout(nextTimerIdRef.current);
      nextTimerIdRef.current = null;
    }
    if (watchIntervalIdRef.current != null) {
      window.clearInterval(watchIntervalIdRef.current);
      watchIntervalIdRef.current = null;
    }
  }

  function resetAndStart() {
    setStatus("loading");
    setCurrentBlock("");

    raw1Ref.current = "";
    phase1Ref.current = "pre";
    start1Ref.current = 0;
    last1Ref.current = 0;
    carry1Ref.current = "";

    raw2Ref.current = "";
    phase2Ref.current = "pre";
    start2Ref.current = 0;
    last2Ref.current = 0;
    carry2Ref.current = "";

    bufferRef.current = [];
    queueRef.current = [];
    displayingRef.current = false;

    done1Ref.current = false;
    done2Ref.current = false;
    nextStartedRef.current = false;

    lastWordAtRef.current = Date.now();
    firstWordAtRef.current = 0;

    openFirstStory();

    // watchdog: flush tiny tails when nothing new arrives
    watchIntervalIdRef.current = window.setInterval(() => {
      if (displayingRef.current) return;
      if (queueRef.current.length > 0) return;

      const idle = Date.now() - lastWordAtRef.current;
      const bothDone = done1Ref.current && (nextStartedRef.current ? done2Ref.current : true);

      if (bufferRef.current.length > 0) {
        if (bufferRef.current.length < SMALL_TAIL && (idle >= WATCHDOG_MS || bothDone)) {
          queueRef.current.push(bufferRef.current.splice(0, bufferRef.current.length));
          driveDisplay();
        }
      }
    }, 300);
  }

  function handleNewGeneration() {
    // Stop everything and start fresh after a brief splash
    cleanup();
    setCurrentBlock("New generation…");
    window.setTimeout(() => {
      resetAndStart();
    }, 800);
  }

  useEffect(() => {
    resetAndStart();
    return () => cleanup();
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
      {/* Centered subtitles */}
      <div
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          maxWidth: 900,
          width: "min(90vw, 900px)",
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
        {currentBlock}
      </div>

      {/* New Generation button (bottom-center) */}
      <button
        onClick={handleNewGeneration}
        style={{
          position: "fixed",
          bottom: 24,
          left: "50%",
          transform: "translateX(-50%)",
          padding: "10px 16px",
          borderRadius: 999,
          border: "1px solid rgba(255,255,255,0.35)",
          background: "rgba(0,0,0,0.55)",
          color: "white",
          fontSize: 16,
          cursor: "pointer",
          backdropFilter: "blur(2px)",
          boxShadow: "0 6px 18px rgba(0,0,0,0.3)"
        }}
        title="Start a fresh story"
      >
        New Generation
      </button>
    </main>
  );
}
