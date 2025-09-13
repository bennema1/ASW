
"use client";
import { useEffect, useRef, useState } from "react";

const BLOCK_SIZE = 35;
const WPM = 300;
const MIN_MS = 2000;
const WATCHDOG_MS = 1500;
const SMALL_TAIL = 6;
const MAX_WORDS_PER_STORY = 600;
const FALLBACK_START_LEN = 120;
const NEXT_START_MS = 20000;

// Category options for user selection
const CATEGORIES = [
  { id: "mystery", label: "Mystery & Thriller", icon: "🔍" },
  { id: "romance", label: "Romance", icon: "💕" },
  { id: "scifi", label: "Science Fiction", icon: "🚀" },
  { id: "fantasy", label: "Fantasy", icon: "🐉" },
  { id: "horror", label: "Horror", icon: "👻" },
  { id: "comedy", label: "Comedy", icon: "😂" },
  { id: "drama", label: "Drama", icon: "🎭" },
  { id: "adventure", label: "Adventure", icon: "🗺️" },
  { id: "historical", label: "Historical", icon: "📜" },
  { id: "crime", label: "True Crime", icon: "🔪" },
  { id: "slice", label: "Slice of Life", icon: "☕" },
  { id: "aita", label: "AITA Stories", icon: "⚖️" }
];

export default function Page() {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [currentBlock, setCurrentBlock] = useState<string>("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [hasSelectedCategories, setHasSelectedCategories] = useState(false);

  // All the existing refs
  const es1Ref = useRef<EventSource | null>(null);
  const raw1Ref = useRef<string>("");
  const phase1Ref = useRef<"pre" | "run">("pre");
  const start1Ref = useRef<number>(0);
  const last1Ref = useRef<number>(0);
  const carry1Ref = useRef<string>("");

  const es2Ref = useRef<EventSource | null>(null);
  const raw2Ref = useRef<string>("");
  const phase2Ref = useRef<"pre" | "run">("pre");
  const start2Ref = useRef<number>(0);
  const last2Ref = useRef<number>(0);
  const carry2Ref = useRef<string>("");
  const nextStartedRef = useRef<boolean>(false);

  const bufferRef = useRef<string[]>([]);
  const queueRef = useRef<string[][]>([]);
  const displayingRef = useRef<boolean>(false);

  const done1Ref = useRef<boolean>(false);
  const done2Ref = useRef<boolean>(false);

  const lastWordAtRef = useRef<number>(Date.now());
  const firstWordAtRef = useRef<number>(0);
  const nextTimerIdRef = useRef<number | null>(null);
  const watchIntervalIdRef = useRef<number | null>(null);

  // Check for saved preferences on mount
  useEffect(() => {
    const saved = localStorage.getItem("storyCategories");
    if (saved) {
      const categories = JSON.parse(saved);
      setSelectedCategories(categories);
      setHasSelectedCategories(true);
    }
  }, []);

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

    if ((!next || next.length === 0) && bufferRef.current.length > 0 && bufferRef.current.length < SMALL_TAIL) {
      next = bufferRef.current.splice(0, bufferRef.current.length);
    }

    const bothDone = done1Ref.current && (nextStartedRef.current ? done2Ref.current : true);
    if ((!next || next.length === 0) && bothDone && bufferRef.current.length) {
      next = bufferRef.current.splice(0, bufferRef.current.length);
    }

    if (!next || next.length === 0) return;
    showBlock(next);
  }

  function splitWordsWithCarry(incoming: string, carryRef: React.MutableRefObject<string>) {
    const parts = (carryRef.current + incoming).split(/(\s+)/);
    const words: string[] = [];
    let newCarry = "";
    for (let i = 0; i < parts.length; i += 2) {
      const token = parts[i] ?? "";
      const sep = parts[i + 1] ?? "";
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
    return words.filter(w => w !== "**");
  }

  function enqueueWords(words: string[], fromFirstStream: boolean) {
    if (!words.length) return;
    const filtered = sanitize(words);
    if (filtered.length === 0) return;

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
    // Pass categories as base64 encoded context
    const categoriesCtx = btoa(JSON.stringify(selectedCategories));
    const es = new EventSource(
      `/api/generate?seed=${seed}&maxWords=${opts.maxWords}&force=1&mode=initial&ctx=${categoriesCtx}`
    );
    esRef.current = es;

    es.onmessage = (e) => {
      if (e.data === "[DONE]") {
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
        setStatus((s) =>
          done1Ref.current && (nextStartedRef.current ? done2Ref.current : true) ? "done" : s
        );
        return;
      }

      rawRef.current += e.data;

      if (phaseRef.current === "pre") {
        const start = findStartIndex(rawRef.current);
        if (start === -1) return;
        phaseRef.current = "run";
        startRef.current = start;
        lastRef.current = start;
      }

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
    if (nextTimerIdRef.current != null) {
      window.clearTimeout(nextTimerIdRef.current);
      nextTimerIdRef.current = null;
    }
    openStory(es2Ref, raw2Ref, phase2Ref, start2Ref, last2Ref, carry2Ref, {
      maxWords: MAX_WORDS_PER_STORY,
      fromFirst: false
    });
  }

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
    window.setTimeout(() => {
      resetAndStart();
    }, 800);
  }

  function handleCategoryToggle(categoryId: string) {
    setSelectedCategories(prev => {
      if (prev.includes(categoryId)) {
        return prev.filter(id => id !== categoryId);
      } else {
        return [...prev, categoryId];
      }
    });
  }

  function handleStartStories() {
    if (selectedCategories.length === 0) return;
    localStorage.setItem("storyCategories", JSON.stringify(selectedCategories));
    setHasSelectedCategories(true);
    resetAndStart();
  }

  function handleChangeCategories() {
    cleanup();
    setHasSelectedCategories(false);
    localStorage.removeItem("storyCategories");
  }

  // Category selection screen
  if (!hasSelectedCategories) {
    return (
      <main style={{ 
        minHeight: "100svh",
        background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px"
      }}>
        <div style={{
          maxWidth: "600px",
          width: "100%",
          background: "rgba(255, 255, 255, 0.95)",
          borderRadius: "20px",
          padding: "40px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)"
        }}>
          <h1 style={{
            fontSize: "32px",
            fontWeight: "bold",
            textAlign: "center",
            marginBottom: "10px",
            color: "#333"
          }}>
            Welcome to Infinite Stories
          </h1>
          <p style={{
            textAlign: "center",
            color: "#666",
            marginBottom: "30px",
            fontSize: "16px"
          }}>
            Select your favorite genres to personalize your story feed
          </p>
          
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
            gap: "12px",
            marginBottom: "30px"
          }}>
            {CATEGORIES.map(category => (
              <button
                key={category.id}
                onClick={() => handleCategoryToggle(category.id)}
                style={{
                  padding: "12px",
                  borderRadius: "12px",
                  border: selectedCategories.includes(category.id) 
                    ? "2px solid #667eea" 
                    : "2px solid #e0e0e0",
                  background: selectedCategories.includes(category.id)
                    ? "linear-gradient(135deg, #667eea 0%, #764ba2 100%)"
                    : "white",
                  color: selectedCategories.includes(category.id) ? "white" : "#333",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "14px",
                  fontWeight: selectedCategories.includes(category.id) ? "600" : "400"
                }}
              >
                <span style={{ fontSize: "24px" }}>{category.icon}</span>
                <span>{category.label}</span>
              </button>
            ))}
          </div>

          <div style={{
            display: "flex",
            justifyContent: "center",
            gap: "10px"
          }}>
            <button
              onClick={handleStartStories}
              disabled={selectedCategories.length === 0}
              style={{
                padding: "14px 32px",
                borderRadius: "999px",
                border: "none",
                background: selectedCategories.length > 0
                  ? "linear-gradient(135deg, #667eea 0%, #764ba2 100%)"
                  : "#ccc",
                color: "white",
                fontSize: "18px",
                fontWeight: "600",
                cursor: selectedCategories.length > 0 ? "pointer" : "not-allowed",
                boxShadow: selectedCategories.length > 0 
                  ? "0 10px 30px rgba(102, 126, 234, 0.4)"
                  : "none",
                transition: "all 0.3s ease"
              }}
            >
              Start Reading ({selectedCategories.length} selected)
            </button>
          </div>
        </div>
      </main>
    );
  }

  // Main story viewer (existing UI)
  return (
    <main style={{ minHeight: "100svh" }}>
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
      <div
        style={{
          position: "fixed",
          inset: 0,
          background:
            "radial-gradient(ellipse at center, rgba(0,0,0,0.25), rgba(0,0,0,0.65))",
          zIndex: -1
        }}
      />
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

      <button
        onClick={handleChangeCategories}
        style={{
          position: "fixed",
          top: 24,
          right: 24,
          padding: "10px 16px",
          borderRadius: 999,
          border: "1px solid rgba(255,255,255,0.35)",
          background: "rgba(0,0,0,0.55)",
          color: "white",
          fontSize: 14,
          cursor: "pointer",
          backdropFilter: "blur(2px)",
          boxShadow: "0 6px 18px rgba(0,0,0,0.3)"
        }}
        title="Change category preferences"
      >
        Change Categories
      </button>
    </main>
  );
}