"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { streamStory } from "@/lib/api";
import StoryCard from "./StoryCard";

type Item = { id:number; text:string; loading:boolean };

export default function InfiniteList() {
  const [items, setItems] = useState<Item[]>([]);
  const [nextId, setNextId] = useState(1);
  const inflight = useRef(false);

  const loadNext = useCallback(() => {
    if (inflight.current) return;
    inflight.current = true;
    const id = nextId; setNextId(id+1);
    setItems(p => [...p, { id, text:"", loading:true }]);
    const stop = streamStory({ seed: String(id), maxWords: "180" }, (chunk) => {
      setItems(p => p.map(x => x.id===id ? ({...x, text: x.text + chunk }) : x));
    }, () => {
      setItems(p => p.map(x => x.id===id ? ({...x, loading:false }) : x));
      inflight.current = false; stop();
    });
  }, [nextId]);

  useEffect(() => { if (items.length === 0) loadNext(); }, [items.length, loadNext]);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!sentinelRef.current) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => e.isIntersecting && loadNext());
    }, { rootMargin: "600px" });
    io.observe(sentinelRef.current);
    return () => io.disconnect();
  }, [loadNext]);

  return (
    <div className="feed">
      {items.map(i => <StoryCard key={i.id} text={i.text} loading={i.loading} />)}
      <div ref={sentinelRef} style={{ height: 1 }} />
    </div>
  );
}
