"use client";
import { useEffect, useRef, useState } from "react";


const BLOCK_SIZE = 35;           
const WPM = 150;                 
const MIN_MS = 2000;             
const WATCHDOG_MS = 1500;        
const SMALL_TAIL = 6;            
const MAX_WORDS_PER_STORY = 600; 
const FALLBACK_START_LEN = 120;  


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

  
  const esRef = useRef<EventSource | null>(null);
  const rawRef = useRef<string>("");              
  const phaseRef = useRef<"pre" | "run">("pre");  
  const startRef = useRef<number>(0);
  const lastRef = useRef<number>(0);
  const carryRef = useRef<string>("");            

  
  const bufferRef = useRef<string[]>([]);
  const queueRef = useRef<string[][]>([]);
  const displayingRef = useRef<boolean>(false);
  const doneRef = useRef<boolean>(false);

  
  const lastWordAtRef = useRef<number>(Date.now());
  const watchIntervalIdRef = useRef<number | null>(null);

  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioQueueRef = useRef<string[]>([]);
  const isPlayingRef = useRef<boolean>(false);

  
  async function queueTTS(text: string) {
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice: currentVoice }),
      });
      if (!res.ok) {
        console.error("TTS HTTP", res.status, await res.text().catch(() => ""));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      audioQueueRef.current.push(url);
      if (!isPlayingRef.current) playNext();
    } catch (e) {
      console.error("queueTTS failed:", e);
    }
  }

  function playNext() {
    const audio = audioRef.current;
    const url = audioQueueRef.current.shift();
    if (!audio || !url) {
      isPlayingRef.current = false;
      return;
    }
    isPlayingRef.current = true;
    audio.src = url;

    const cleanup = () => URL.revokeObjectURL(url);
    audio.onended = () => { cleanup(); playNext(); };
    audio.onerror = () => { cleanup(); playNext(); };

    audio.play().catch(err => {
      console.warn("Audio play error:", err);
      cleanup();
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

  
  const blockDurationMs = (words: number) =>
    Math.max(MIN_MS, Math.round((words / WPM) * 60_000));

  function showBlock(words: string[]) {
    displayingRef.current = true;
    const text = words.join(" ");
    setCurrentBlock(text);

    
    queueTTS(text);

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

    
    if ((!next || next.length === 0) && doneRef.current && bufferRef.current.length) {
      next = bufferRef.current.splice(0, bufferRef.current.length);
    }

    if (!next || next.length === 0) return;
    showBlock(next);
  }

  
  function splitWordsWithCarry(incoming: string) {
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
    
    return words.filter(w => w !== "**");
  }

  function enqueueWords(words: string[]) {
    if (!words.length) return;
    const filtered = sanitize(words);
    if (filtered.length === 0) return;

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

  
  function openStoryOnce() {
    const seed = Date.now().toString();
    const params = new URLSearchParams({
      seed,
      maxWords: String(MAX_WORDS_PER_STORY),
      force: "1",
      mode: "initial",
    });

    const es = new EventSource(`/api/generate?${params.toString()}`);
    esRef.current = es;

    es.onmessage = (e) => {
      if (e.data === "[DONE]") {
        if (carryRef.current) {
          enqueueWords([carryRef.current]);
          carryRef.current = "";
        }

        doneRef.current = true;
        if (bufferRef.current.length) {
          queueRef.current.push(bufferRef.current.splice(0, bufferRef.current.length));
          driveDisplay();
        }

        es.close();
        esRef.current = null;
        setStatus("done");
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
        const words = splitWordsWithCarry(delta);
        enqueueWords(words);
      }
    };

    es.onerror = () => {
      setStatus("error");
      try { es.close(); } catch {}
      esRef.current = null;
    };
  }

  function cleanup() {
    stopAudioQueue();
    try { esRef.current?.close(); } catch {}
    esRef.current = null;

    if (watchIntervalIdRef.current != null) {
      window.clearInterval(watchIntervalIdRef.current);
      watchIntervalIdRef.current = null;
    }
  }

  function resetAndStart() {
    setStatus("loading");
    setCurrentBlock("");

    rawRef.current = "";
    phaseRef.current = "pre";
    startRef.current = 0;
    lastRef.current = 0;
    carryRef.current = "";

    bufferRef.current = [];
    queueRef.current = [];
    displayingRef.current = false;

    doneRef.current = false;
    lastWordAtRef.current = Date.now();

    const v = pickVoice();
    setCurrentVoice(v);

    openStoryOnce();

    watchIntervalIdRef.current = window.setInterval(() => {
      if (displayingRef.current) return;
      if (queueRef.current.length > 0) return;

      const idle = Date.now() - lastWordAtRef.current;
      if (bufferRef.current.length > 0) {
        if (bufferRef.current.length < SMALL_TAIL && (idle >= WATCHDOG_MS || doneRef.current)) {
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
  }, []);

  return (
    <main style={{ minHeight: "100svh" }}>
      {}
      <video
        autoPlay muted loop playsInline src="/bg.mp4"
        style={{ position: "fixed", inset: 0, width: "100%", height: "100%", objectFit: "cover", zIndex: -2 }}
      />
      {}
      <div
        style={{
          position: "fixed", inset: 0,
          background: "radial-gradient(ellipse at center, rgba(0,0,0,0.25), rgba(0,0,0,0.65))",
          zIndex: -1
        }}
      />

      {}
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

      {}
      <audio ref={audioRef} preload="none" hidden />

      {}
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

      {}
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
