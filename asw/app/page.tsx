"use client";
import { useEffect, useRef, useState } from "react";

/** ---- Tuning ---- */
const BLOCK_SIZE = 35;           // words per subtitle block
const WPM = 150;                 // your requested reading speed
const MIN_MS = 2000;             // minimum time per block
const WATCHDOG_MS = 1500;        // flush tiny tails if idle this long
const SMALL_TAIL = 6;            // flush 1..5 word tails
const MAX_WORDS_PER_STORY = 600; // how much we ask the model per stream
const FALLBACK_START_LEN = 120;  // if no markers seen by then, start from 0
const NEXT_START_MS = 20000;     // time-based auto-continue (ms)
const CTX_CHARS = 3500;          // how much context to send for continuation


/** ---- Random voice pool (like your Python) ---- */
const TTS_VOICE_POOL = [
  "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse",
];
function pickVoice() {
  return TTS_VOICE_POOL[Math.floor(Math.random() * TTS_VOICE_POOL.length)];
}

export default function Page() {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [currentBlock, setCurrentBlock] = useState<string>("");
  const [currentVoice, setCurrentVoice] = useState<string>("alloy");
  // --- audio gate (user click needed for autoplay) ---
  const canAudioRef = useRef<boolean>(false);
  const [audioEnabled, setAudioEnabled] = useState(false);

  // --- TTS request queue (serialize + retry) ---
  const ttsPendingRef = useRef<{ text: string; tries: number }[]>([]);
  const ttsBusyRef = useRef<boolean>(false);


  // Streams
  const es1Ref = useRef<EventSource | null>(null);
  const es2Ref = useRef<EventSource | null>(null);

  // Raw buffers (for start marker parsing)
  const raw1Ref = useRef<string>("");
  const raw2Ref = useRef<string>("");

  // Phases + indices
  const phase1Ref = useRef<"pre" | "run">("pre");
  const phase2Ref = useRef<"pre" | "run">("pre");
  const start1Ref = useRef<number>(0);
  const start2Ref = useRef<number>(0);
  const last1Ref = useRef<number>(0);
  const last2Ref = useRef<number>(0);
  const carry1Ref = useRef<string>("");
  const carry2Ref = useRef<string>("");

  // Display buffers
  const bufferRef = useRef<string[]>([]);
  const queueRef = useRef<string[][]>([]);
  const displayingRef = useRef<boolean>(false);
  
  // Done flags
  const done1Ref = useRef<boolean>(false);
  const done2Ref = useRef<boolean>(false);
  const nextStartedRef = useRef<boolean>(false);

  // For continuation context
  const allWordsRef = useRef<string[]>([]);

  // Timers
  const lastWordAtRef = useRef<number>(Date.now());
  const firstWordAtRef = useRef<number>(0);
  const nextTimerIdRef = useRef<number | null>(null);
  const watchIntervalIdRef = useRef<number | null>(null);

  /** ---- Audio queue (TTS) ---- */
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioQueueRef = useRef<string[]>([]);
  const audioTextQueueRef = useRef<string[]>([]);
  const isPlayingRef = useRef<boolean>(false);
  const prefetchedTTSRef = useRef<Set<string>>(new Set());

  function enqueueTTS(text: string) {
    // Don’t waste API calls until user enables audio
    if (!canAudioRef.current) return;

    ttsPendingRef.current.push({ text, tries: 0 });
    if (!ttsBusyRef.current) drainTTS();
  }

  async function drainTTS() {
    if (ttsBusyRef.current) return;
    const job = ttsPendingRef.current.shift();
    if (!job) return;

    ttsBusyRef.current = true;

    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: job.text, voice: currentVoice }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error("TTS HTTP", res.status, body);

        // Retry on transient errors
        if ([429, 500, 502, 503, 504].includes(res.status) && job.tries < 2) {
          const delay = 500 * Math.pow(2, job.tries) + Math.random() * 250;
          setTimeout(() => {
            ttsPendingRef.current.unshift({ text: job.text, tries: job.tries + 1 });
            ttsBusyRef.current = false;
            drainTTS();
          }, delay);
          return;
        }

        // give up for this block
        ttsBusyRef.current = false;
        drainTTS();
        return;
      }

    const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  audioQueueRef.current.push(url);
  audioTextQueueRef.current.push(job.text); // align text with this URL
  if (!isPlayingRef.current) playNext();
  } catch (e) {
    console.error("TTS fetch failed:", e);
    // retry once on network error
    if (job.tries < 2) {
      const delay = 500 * Math.pow(2, job.tries) + Math.random() * 250;
      setTimeout(() => {
        ttsPendingRef.current.unshift({ text: job.text, tries: job.tries + 1 });
        ttsBusyRef.current = false;
        drainTTS();
      }, delay);
      return;
    }
  }

  ttsBusyRef.current = false;
  drainTTS();
}


  function playNext() {
    const audio = audioRef.current;
    const url = audioQueueRef.current.shift();
    const text = audioTextQueueRef.current.shift();

    if (!audio || !url) {
      isPlayingRef.current = false;
      return;
    }

    // We are starting THIS block’s audio — show its subtitle now
    isPlayingRef.current = true;
    displayingRef.current = true;
    if (text) setCurrentBlock(text);

    audio.src = url;

    const cleanup = () => URL.revokeObjectURL(url);

    audio.onended = () => {
      cleanup();
      // current clip finished; advance to next subtitle/audio
      displayingRef.current = false;
      driveDisplay();
      playNext();
    };

    audio.onerror = () => {
      cleanup();
      // on error, also advance to avoid getting stuck
      displayingRef.current = false;
      driveDisplay();
      playNext();
    };

    audio.play().catch(err => {
      console.warn("Audio play error:", err);
      cleanup();
      // advance anyway so UI doesn’t stall
      displayingRef.current = false;
      driveDisplay();
      playNext();
    });
  }


  function stopAudioQueue() {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.src = "";
      audio.onended = null;
      audio.onerror = null;
    }
    audioQueueRef.current.forEach(u => URL.revokeObjectURL(u));
    audioQueueRef.current = [];
    isPlayingRef.current = false;
  }

  /** ---- Subtitle block timing ---- */
  const blockDurationMs = (words: number) =>
    Math.max(MIN_MS, Math.round((words / WPM) * 60_000));

  function showBlock(words: string[]) {
    const text = words.join(" ");

    if (audioEnabled) {
      // Don’t show yet — generate/queue audio and let playNext set the subtitle
      enqueueTTS(text);

      // If nothing is playing, try to start immediately (when the first audio arrives)
      if (!isPlayingRef.current) {
        playNext();
      }
    } else {
      // No audio: fall back to reading-speed timer
      displayingRef.current = true;
      setCurrentBlock(text);
      const ms = blockDurationMs(words.length);
      setTimeout(() => {
        displayingRef.current = false;
        driveDisplay();
      }, ms);
    }
  }

  function enableAudio() {
    canAudioRef.current = true;
    setAudioEnabled(true);
    // Nudge audio on user gesture to satisfy autoplay policy
    try { audioRef.current?.play().catch(() => {}); } catch {}
  }


  function driveDisplay() {
    if (displayingRef.current) return;

    let next = queueRef.current.shift();

    // Flush tiny tails (1..5 words) so they don't get stuck
    if ((!next || next.length === 0) && bufferRef.current.length > 0 && bufferRef.current.length < SMALL_TAIL) {
      next = bufferRef.current.splice(0, bufferRef.current.length);
    }

    // If all streams done, flush leftovers
    const bothDone = done1Ref.current && (nextStartedRef.current ? done2Ref.current : true);
    if ((!next || next.length === 0) && bothDone && bufferRef.current.length) {
      next = bufferRef.current.splice(0, bufferRef.current.length);
    }

    if (!next || next.length === 0) return;
    showBlock(next);
  }

  /** ---- Helpers ---- */
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
        newCarry = token;
      }
    }
    carryRef.current = newCarry;
    return words;
  }

  function sanitize(words: string[]) {
    // strip stray markdown bold markers model may emit
    return words.filter(w => w !== "**");
  }

  function enqueueWords(words: string[], fromFirstStream: boolean) {
    if (!words.length) return;
    const filtered = sanitize(words);
    if (filtered.length === 0) return;

    // collect for continuation context
    allWordsRef.current.push(...filtered);

    // arm time-based auto-continue on first words of story #1
    if (fromFirstStream && firstWordAtRef.current === 0) {
      firstWordAtRef.current = Date.now();
      if (!nextStartedRef.current && nextTimerIdRef.current == null) {
        nextTimerIdRef.current = window.setTimeout(() => {
          if (!nextStartedRef.current) {
            nextStartedRef.current = true;
            openSecondStoryContinuation(); // true continuation
          }
        }, NEXT_START_MS);
      }
    }

    bufferRef.current.push(...filtered);
    while (bufferRef.current.length >= BLOCK_SIZE) {
      queueRef.current.push(bufferRef.current.splice(0, BLOCK_SIZE));
    }

    if (audioEnabled && queueRef.current.length > 0) {
      const nextBlock = queueRef.current[0]; // the block that will show next
      const nextText = nextBlock.join(" ");
      if (!prefetchedTTSRef.current.has(nextText)) {
        enqueueTTS(nextText);
        prefetchedTTSRef.current.add(nextText);
      }
    }


    lastWordAtRef.current = Date.now();
    driveDisplay();
  }

  // Accept Hook:, Story:, or ** ; fallback after N chars
  function findStartIndex(raw: string) {
    const rxHook = /hook\s*:/i;
    const mh = rxHook.exec(raw);
    if (mh) return mh.index + mh[0].length;

    const rxStory = /story\s*:/i;
    const ms = rxStory.exec(raw);
    if (ms) return ms.index + ms[0].length;

    const boldOpen = raw.indexOf("**");
    if (boldOpen !== -1) return boldOpen + 2;

    if (raw.length >= FALLBACK_START_LEN) return 0;
    return -1;
  }

  // Build continuation context (last CTX_CHARS)
  function buildCtx() {
    const text = allWordsRef.current.join(" ");
    return text.length <= CTX_CHARS ? text : text.slice(text.length - CTX_CHARS);
  }

  // Browser-safe base64
  function toUrlB64(s: string) {
    const b64 = btoa(unescape(encodeURIComponent(s)));
    return encodeURIComponent(b64);
  }

  type StartMode = "markers" | "immediate";
  function openStory(
    esRef: React.MutableRefObject<EventSource | null>,
    rawRef: React.MutableRefObject<string>,
    phaseRef: React.MutableRefObject<"pre" | "run">,
    startRef: React.MutableRefObject<number>,
    lastRef: React.MutableRefObject<number>,
    carryRef: React.MutableRefObject<string>,
    opts: { maxWords: number; fromFirst: boolean; mode: "initial" | "continue"; startMode: StartMode; ctx?: string }
  ) {
    const seed = Date.now().toString();
    const params = new URLSearchParams({
      seed,
      maxWords: String(opts.maxWords),
      force: "1",
      mode: opts.mode,
    });
    if (opts.mode === "continue" && opts.ctx) params.set("ctx", opts.ctx);

    const es = new EventSource(`/api/generate?${params.toString()}`);
    esRef.current = es;

    es.onmessage = (e) => {
      if (e.data === "[DONE]") {
        // include any dangling carry
        if (carryRef.current) {
          enqueueWords([carryRef.current], opts.fromFirst);
          carryRef.current = "";
        }
        if (opts.fromFirst) done1Ref.current = true;
        else done2Ref.current = true;

        const bothDone = done1Ref.current && (nextStartedRef.current ? done2Ref.current : true);
        if (bothDone && bufferRef.current.length) {
          queueRef.current.push(bufferRef.current.splice(0, bufferRef.current.length));
          driveDisplay();
        }

        es.close();
        esRef.current = null;
        setStatus((s) => (done1Ref.current && (nextStartedRef.current ? done2Ref.current : true)) ? "done" : s);
        return;
      }

      rawRef.current += e.data;

      // Choose when to start emitting
      if (phaseRef.current === "pre") {
        if (opts.startMode === "immediate") {
          phaseRef.current = "run";
          startRef.current = 0;
          lastRef.current = 0;
        } else {
          const start = findStartIndex(rawRef.current);
          if (start === -1) return;
          phaseRef.current = "run";
          startRef.current = start;
          lastRef.current = start;
        }
      }

      // Feed after start index
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
      fromFirst: true,
      mode: "initial",
      startMode: "markers", // wait for Hook/Story/** (or fallback)
    });
  }

  function openSecondStoryContinuation() {
    const ctxB64 = toUrlB64(buildCtx());
    openStory(es2Ref, raw2Ref, phase2Ref, start2Ref, last2Ref, carry2Ref, {
      maxWords: MAX_WORDS_PER_STORY,
      fromFirst: false,
      mode: "continue",
      startMode: "immediate", // no headings in continuation
      ctx: ctxB64,
    });
  }

  /** ---- lifecycle: cleanup & reset ---- */
  function cleanup() {
    stopAudioQueue();

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

    prefetchedTTSRef.current.clear();
    raw1Ref.current = ""; raw2Ref.current = "";
    phase1Ref.current = "pre"; phase2Ref.current = "pre";
    start1Ref.current = 0; start2Ref.current = 0;
    last1Ref.current = 0; last2Ref.current = 0;
    carry1Ref.current = ""; carry2Ref.current = "";

    bufferRef.current = [];
    queueRef.current = [];
    displayingRef.current = false;

    done1Ref.current = false;
    done2Ref.current = false;
    nextStartedRef.current = false;

    allWordsRef.current = [];
    lastWordAtRef.current = Date.now();
    firstWordAtRef.current = 0;

    // pick a fresh random voice each generation
    const v = pickVoice();
    setCurrentVoice(v);

    openFirstStory();

    // watchdog to flush tiny tails during idle
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
    cleanup();
    setCurrentBlock("New generation…");
    window.setTimeout(() => resetAndStart(), 800);
  }

  useEffect(() => {
    resetAndStart();
    return () => cleanup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** ---- Returned JSX ---- */
  return (
    <main style={{ minHeight: "100svh" }}>
      {/* Background video (optional) */}
      <video
        autoPlay muted loop playsInline src="/bg.mp4"
        style={{ position: "fixed", inset: 0, width: "100%", height: "100%", objectFit: "cover", zIndex: -2 }}
      />
      {/* Readability vignette */}
      <div
        style={{
          position: "fixed", inset: 0,
          background: "radial-gradient(ellipse at center, rgba(0,0,0,0.25), rgba(0,0,0,0.65))",
          zIndex: -1
        }}
      />

      {/* Centered subtitles card (what you see on screen) */}
      <div
        style={{
          position: "fixed",
          top: "50%", left: "50%", transform: "translate(-50%, -50%)",
          maxWidth: 900, width: "min(90vw, 900px)",
          padding: "14px 18px", borderRadius: 14,
          background: "rgba(0,0,0,0.55)", color: "white",
          fontSize: 24, lineHeight: 1.45, textAlign: "center",
          backdropFilter: "blur(2px)", boxShadow: "0 10px 30px rgba(0,0,0,0.35)"
        }}
      >
        {currentBlock}
      </div>

      {/* Hidden audio element that plays queued MP3s */}
      <audio ref={audioRef} preload="none" hidden />

      {/* New Generation button */}
      <button
        onClick={handleNewGeneration}
        style={{
          position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          padding: "10px 16px",
          borderRadius: 999, border: "1px solid rgba(255,255,255,0.35)",
          background: "rgba(0,0,0,0.55)", color: "white",
          fontSize: 16, cursor: "pointer",
          backdropFilter: "blur(2px)", boxShadow: "0 6px 18px rgba(0,0,0,0.3)"
        }}
        title="Start a fresh story"
      >
        New Generation
      </button>

      {!audioEnabled && (
        <button
          onClick={enableAudio}
          style={{
            position: "fixed", bottom: 24, left: 24,
            padding: "8px 12px",
            borderRadius: 999, border: "1px solid rgba(255,255,255,0.35)",
            background: "rgba(0,0,0,0.55)", color: "white",
            fontSize: 14, cursor: "pointer",
            backdropFilter: "blur(2px)"
          }}
          title="Enable sound"
        >
          Enable sound
        </button>
      )}


      {/* Tiny badge showing current voice */}
      <div
        style={{
          position: "fixed", bottom: 24, right: 24,
          padding: "6px 10px", borderRadius: 999,
          background: "rgba(0,0,0,0.55)", color: "white",
          fontSize: 12, letterSpacing: 0.4,
          border: "1px solid rgba(255,255,255,0.25)"
        }}
      >
        Voice: {currentVoice}
      </div>
    </main>
  );
}
