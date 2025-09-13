// ---------- helpers ----------
const qs = (s, r = document) => r.querySelector(s);
const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));
const storage = {
  get(k, fb) { try { const v = localStorage.getItem(k); return v === null ? fb : JSON.parse(v); } catch { return fb; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
const keysFor = (id) => ({
  liked: `card:${id}:liked`,
  likeCount: `card:${id}:likeCount`,
  saved: `card:${id}:saved`,
  comments: `card:${id}:comments`
});

// ---------- wire a card ----------
function wireCard(cardEl) {
  const cardId = cardEl.dataset.cardId;
  const v = qs('.fullscreen-video', cardEl);
  const likeBtn = qs('.likeBtn', cardEl);
  const likePath = qs('.likeIconPath', cardEl);
  const likeCountEl = qs('.likeCount', cardEl);
  const saveBtn = qs('.saveBtn', cardEl);
  const savePath = qs('.saveIconPath', cardEl);
  const shareBtn = qs('.shareBtn', cardEl);
  const commentBtn = qs('.commentBtn', cardEl);
  const commentCountEl = qs('.commentCount', cardEl);
  const K = keysFor(cardId);

  let liked = !!storage.get(K.liked, false);
  let likeCount = Number(storage.get(K.likeCount, 0)) || 0;
  let saved = !!storage.get(K.saved, false);
  let comments = storage.get(K.comments, []);

  function renderLike() {
    likeCountEl.textContent = String(likeCount);
    if (liked) { likePath.setAttribute('fill', '#ff3b5c'); likePath.removeAttribute('stroke'); }
    else { likePath.setAttribute('fill', 'none'); likePath.setAttribute('stroke', '#fff'); }
  }
  function renderSave() {
    if (saved) { savePath.setAttribute('fill', '#4da3ff'); savePath.removeAttribute('stroke'); }
    else { savePath.setAttribute('fill', 'none'); savePath.setAttribute('stroke', '#fff'); }
  }
  function renderCommentsCount() { commentCountEl.textContent = String(comments.length); }
  renderLike(); renderSave(); renderCommentsCount();

  likeBtn.addEventListener('click', () => {
    liked = !liked;
    likeCount = Math.max(0, likeCount + (liked ? 1 : -1));
    storage.set(K.liked, liked); storage.set(K.likeCount, likeCount);
    renderLike();
  });

  saveBtn.addEventListener('click', () => {
    saved = !saved; storage.set(K.saved, saved); renderSave();
  });

  shareBtn.addEventListener('click', async () => {
    const url = location.origin + '/?id=' + encodeURIComponent(cardId);
    const data = { title: 'Infinite Story', text: 'Check this cliffhanger…', url };
    if (navigator.share) { try { await navigator.share(data); } catch {} }
    else {
      try { await navigator.clipboard.writeText(url); alert('Link copied!'); }
      catch { prompt('Copy this link:', url); }
    }
  });

  commentBtn.addEventListener('click', () => openComments(cardId));

  return {
    cardId,
    video: v,
    getComments: () => comments,
    setComments: (arr) => { comments = arr; storage.set(K.comments, comments); renderCommentsCount(); }
  };
}

// ---------- comments sheet (shared) ----------
const sheet = qs('#commentsSheet');
const backdrop = qs('#sheetBackdrop');
const inputBar = qs('#inputBar');
const listEl = qs('#commentsList');
const titleEl = qs('#commentsTitle');
const inputEl = qs('#commentInput');
const sendBtn = qs('#sendComment');

let currentCardId = null;
let cardMap = new Map();

function openComments(cardId) {
  currentCardId = cardId;
  titleEl.textContent = `Comments — ${cardId}`;
  renderComments();
  backdrop.classList.add('show');
  sheet.classList.add('open');
  inputBar.classList.add('open');
  sheet.setAttribute('aria-hidden', 'false');
  setTimeout(() => inputEl.focus(), 40);
}
function closeComments() {
  currentCardId = null;
  backdrop.classList.remove('show');
  sheet.classList.remove('open');
  inputBar.classList.remove('open');
  sheet.setAttribute('aria-hidden', 'true');
}
qs('#closeComments').addEventListener('click', closeComments);
backdrop.addEventListener('click', closeComments);

function renderComments() {
  listEl.innerHTML = '';
  if (!currentCardId) return;
  const card = cardMap.get(currentCardId);
  const comments = card ? card.getComments() : [];
  if (!comments || comments.length === 0) {
    const empty = document.createElement('div');
    empty.style.color = 'var(--muted)';
    empty.style.padding = '14px';
    empty.textContent = 'Be the first to comment.';
    listEl.appendChild(empty);
    return;
  }
  comments.forEach(c => {
    const row = document.createElement('div');
    row.className = 'comment';
    row.innerHTML = `
      <div class="avatar"></div>
      <div class="comment-bubble">
        <div class="comment-meta">@${c.author || 'you'} • ${new Date(c.ts).toLocaleString()}</div>
        <div class="comment-text"></div>
      </div>`;
    row.querySelector('.comment-text').textContent = c.text;
    listEl.appendChild(row);
  });
}

function submitComment() {
  const text = inputEl.value.trim();
  if (!text || !currentCardId) return;
  const card = cardMap.get(currentCardId);
  if (!card) return;
  const next = [...card.getComments(), { text, ts: Date.now(), author: 'you' }];
  card.setComments(next);
  inputEl.value = '';
  renderComments();
}
sendBtn.addEventListener('click', submitComment);
inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitComment(); });

// ---------- wire cards ----------
const cards = qsa('.page').map(wireCard);
cardMap = cards.reduce((m, c) => m.set(c.cardId, c), new Map());

// ---------- lazy-load videos (assign src when near) ----------
const lazyObs = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    const v = entry.target;
    if (!v.getAttribute('src') && v.dataset.src) {
      v.src = v.dataset.src;
      v.load();
    }
    lazyObs.unobserve(v);
  });
}, { root: qs('.feed'), rootMargin: '300px 0px', threshold: 0.01 });

qsa('video[data-src]').forEach(v => lazyObs.observe(v));

// ---------- auto play/pause visible video ----------
const playObs = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    const v = entry.target;
    const mostly = entry.isIntersecting && entry.intersectionRatio >= 0.6;
    if (mostly) v.play().catch(()=>{}); else v.pause();
  });
}, { threshold: [0, 0.6, 1] });

qsa('.fullscreen-video').forEach(v => playObs.observe(v));

// ---------- Next button ----------
qs('#nextBtn')?.addEventListener('click', () => {
  const scroller = qs('.feed');
  scroller?.scrollBy({ top: window.innerHeight, behavior: 'smooth' });
});

// ---------- deep link support ?id=card-3 ----------
(function(){
  const u = new URL(location.href);
  const id = u.searchParams.get('id');
  if (!id) return;
  const el = qs(`.page[data-card-id="${id}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'instant', block: 'start' });
})();
