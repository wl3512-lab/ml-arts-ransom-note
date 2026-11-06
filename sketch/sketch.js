// Ransom Note. p5.js + Gemini API. Lucy Liu, ML Arts Assignment 9.
// Fetch shape follows the class Gemini API + p5 examples by Yining Shi.
// The look comes from Allison Parrish, "Language models can only write ransom notes":
// each token typeset in the style of its source, with tear marks.
const R = window.RansomLogic;
const MODELS = ['gemini-2.5-flash', 'gemini-3.5-flash']; // second one is only a fallback
const KEY_STORE = 'ransom-note-gemini-key';
const FLY_MS = 520;
const MAX_FLIGHT_MS = 3000;
const SAMPLE = `Hope is the thing with feathers
That perches in the soul,
And sings the tune without the words,
And never stops at all,
And sweetest in the gale is heard;
And sore must be the storm
That could abash the little bird
That kept so many warm.

I'm nobody! Who are you?
Are you nobody, too?
Then there's a pair of us — don't tell!
They'd banish us, you know.
How dreary to be somebody!
How public, like a frog
To tell your name the livelong day
To an admiring bog!`;

// A clipping style. Every block of words looks torn from a different source.
const CLIPS = [
  { paper: '#f4ecd8', ink: '#1a1a1a', font: '"Special Elite"', scale: 0.95 },
  { paper: '#ff6fae', ink: '#fff', font: 'Anton', scale: 1.05, upper: true },
  { paper: '#fff', ink: '#c2185b', font: '"Abril Fatface"', scale: 1.1 },
  { paper: '#1a1a1a', ink: '#ffd6e8', font: 'Silkscreen', scale: 0.8 },
  { paper: '#ffe94d', ink: '#1a1a1a', font: 'italic 700 §"Playfair Display"', scale: 1.05 },
  { paper: '#cfe8ff', ink: '#16325c', font: '700 §"Courier Prime"', scale: 0.92 },
];
const DESK = '#1f1226';

const state = {
  tokens: [], used: [], blocks: [], rects: [], scraps: [], flightEnd: 0, busy: false, pageG: null,
};
let stage, ui;

function seeded(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
function fontOf(clip, size) {
  return clip.font.includes('§') ? clip.font.replace('§', `${size}px `) : `${size}px ${clip.font}`;
}
function shown(clip, word) { return clip.upper ? word.toUpperCase() : word; }

function setStatus(text, isError) {
  ui.status.textContent = text;
  ui.status.classList.toggle('error', Boolean(isError));
}
function storedKey() {
  try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; }
}
function storeKey(value) {
  try {
    if (value) localStorage.setItem(KEY_STORE, value); else localStorage.removeItem(KEY_STORE);
  } catch (e) { /* the key still works for this visit */ }
}

function setup() {
  stage = document.getElementById('stage');
  ui = Object.fromEntries(['source', 'question', 'ask', 'fresh', 'sample', 'savePng', 'status', 'smuggled',
    'apiKey', 'forget', 'keyBox', 'wordCount', 'noteText'].map((id) => [id, document.getElementById(id)]));
  const c = createCanvas(stage.clientWidth, stage.clientHeight);
  c.parent(stage);
  c.mousePressed(() => { state.flightEnd = 0; state.scraps.forEach((s) => { s.start = -1e9; }); redraw(); });
  noLoop();

  ui.apiKey.value = storedKey();
  ui.keyBox.open = !ui.apiKey.value;
  ui.source.value = SAMPLE;
  ui.ask.onclick = ask;
  ui.fresh.onclick = freshPage;
  ui.sample.onclick = () => { ui.source.value = SAMPLE; freshPage(); };
  ui.source.oninput = freshPage;
  ui.question.onkeydown = (e) => { if (e.key === 'Enter') ask(); };
  ui.apiKey.oninput = () => storeKey(ui.apiKey.value.trim());
  ui.forget.onclick = () => { ui.apiKey.value = ''; storeKey(''); ui.apiKey.focus(); };
  ui.savePng.onclick = () => saveCanvas('ransom-note', 'png');

  freshPage();
  // Lay out again once the clipping fonts arrive, without waiting on them forever.
  const fonts = ['"Special Elite"', 'Anton', '"Abril Fatface"', 'Silkscreen',
    'italic 700 16px "Playfair Display"', '700 16px "Courier Prime"']
    .map((f) => document.fonts.load(f.includes('px') ? f : `16px ${f}`));
  Promise.race([Promise.all(fonts), new Promise((r) => setTimeout(r, 2500))]).then(layoutAll);
}

function windowResized() {
  resizeCanvas(stage.clientWidth, stage.clientHeight);
  layoutAll();
}

function areas() {
  const m = 16;
  if (width >= 620) {
    const pw = (width - m * 3) * 0.48;
    return { page: { x: m, y: m, w: pw, h: height - m * 2 }, note: { x: m * 2 + pw, y: m, w: width - m * 3 - pw, h: height - m * 2 } };
  }
  const ph = (height - m * 3) * 0.55;
  return { page: { x: m, y: m, w: width - m * 2, h: ph }, note: { x: m, y: m * 2 + ph, w: width - m * 2, h: height - m * 3 - ph } };
}

function freshPage() {
  state.tokens = R.tokenize(ui.source.value);
  state.used = state.tokens.map(() => false);
  state.scraps = [];
  ui.savePng.disabled = true;
  ui.smuggled.textContent = '';
  ui.noteText.textContent = '';
  setStatus('');
  layoutAll();
}

// Group the words into clippings of 7 to 16 words, each with its own source style.
function makeBlocks() {
  const blocks = [];
  let i = 0;
  let n = 0;
  while (i < state.tokens.length) {
    const size = 7 + Math.floor(seeded(n) * 10);
    blocks.push({ from: i, to: Math.min(i + size, state.tokens.length), clip: CLIPS[n % CLIPS.length], widthShare: 0.42 + seeded(n + 50) * 0.58 });
    i += size;
    n += 1;
  }
  return blocks;
}

// Place clippings left to right, row by row, at one base size. Returns null if they overflow.
function tryLayout(ctx, blocks, area, base, allowOverflow) {
  const narrow = area.w < 500 ? 0.6 : 1; // phones fit more clippings per row
  const rects = [];
  const placed = [];
  const pad = base * 0.5;
  const gap = 8;
  let x = area.x;
  let y = area.y;
  let rowH = 0;
  for (const b of blocks) {
    const size = Math.round(base * b.clip.scale);
    const lineH = size * 1.32;
    let w = Math.max(area.w * b.widthShare * narrow, Math.min(area.w, size * 9));
    w = Math.min(w, area.w);
    if (x + w > area.x + area.w + 0.5) { x = area.x; y += rowH + gap; rowH = 0; w = Math.min(w, area.w); }
    if (area.x + area.w - (x + w) < area.w * 0.28) w = area.x + area.w - x; // no thin leftover gaps
    ctx.font = fontOf(b.clip, size);
    const space = ctx.measureText(' ').width * 1.2;
    let cx = x + pad;
    let cy = y + pad;
    for (let i = b.from; i < b.to; i += 1) {
      const text = shown(b.clip, state.tokens[i].word);
      const tw = ctx.measureText(text).width;
      if (cx + tw > x + w - pad && cx > x + pad) { cx = x + pad; cy += lineH; }
      if (tw > w - pad * 2 && !allowOverflow) return null;
      rects[i] = { x: cx - 2, y: cy, w: tw + 4, h: lineH, size, clip: b.clip, text };
      cx += tw + space;
    }
    const h = cy + lineH + pad - y;
    placed.push({ x, y, w, h, clip: b.clip });
    rowH = Math.max(rowH, h);
    x += w + gap;
  }
  return !allowOverflow && y + rowH > area.y + area.h ? null : { rects, placed };
}

function layoutAll() {
  if (!ui) return;
  const { page } = areas();
  state.blocks = makeBlocks();
  const ctx = drawingContext;
  let fit = null;
  for (let base = 34; base >= 4 && !fit; base -= 1) fit = tryLayout(ctx, state.blocks, page, base);
  if (!fit) fit = tryLayout(ctx, state.blocks, page, 4, true); // a page at the length cap still has to work
  state.rects = fit ? fit.rects : [];
  state.placed = fit ? fit.placed : [];

  if (state.pageG) state.pageG.remove();
  const g = createGraphics(width, height);
  g.pixelDensity(pixelDensity());
  g.background(DESK);
  const c = g.drawingContext;
  c.textBaseline = 'middle';
  state.placed.forEach((p, n) => {
    c.save();
    c.translate(p.x + p.w / 2, p.y + p.h / 2);
    c.rotate((seeded(n + 9) - 0.5) * 0.012);
    c.fillStyle = p.clip.paper;
    c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    c.restore();
  });
  state.rects.forEach((r) => {
    c.font = fontOf(r.clip, r.size);
    c.fillStyle = r.clip.ink;
    c.fillText(r.text, r.x + 2, r.y + r.h / 2);
  });
  state.pageG = g;
  state.scraps.forEach((s, i) => { Object.assign(s, { rect: state.rects[s.index] }); });
  layoutNote();
  updateCount();
  redraw();
}

function layoutNote() {
  const { note } = areas();
  const ctx = drawingContext;
  for (let size = 42; size >= 9; size -= 1) {
    const gap = size * 0.34;
    const lines = [[]];
    let x = 0;
    const lineW = [0];
    for (const s of state.scraps) {
      ctx.font = fontOf(s.rect.clip, Math.round(size * s.rect.clip.scale));
      s.w = ctx.measureText(s.rect.text).width + size * 0.6;
      if (x + s.w > note.w - 28 && lines[lines.length - 1].length) { lines.push([]); lineW.push(0); x = 0; }
      lines[lines.length - 1].push(s);
      x += s.w + gap;
      lineW[lineW.length - 1] = x - gap;
    }
    const lineH = size * 1.75;
    if (lines.length * lineH > note.h - 28 || Math.max(...lineW) > note.w - 20) { if (size > 9) continue; }
    let y = note.y + (note.h - lines.length * lineH) / 2;
    lines.forEach((line, n) => {
      let cx = note.x + (note.w - lineW[n]) / 2;
      line.forEach((s) => {
        s.size = Math.round(size * s.rect.clip.scale);
        s.h = size * 1.45;
        s.tx = cx + s.w / 2;
        s.ty = y + lineH / 2 + (seeded(s.index + 3) - 0.5) * size * 0.3;
        s.rot = (seeded(s.index + 7) - 0.5) * 0.2;
        cx += s.w + gap;
      });
      y += lineH;
    });
    return;
  }
}

function tornPath(c, w, h, seed) {
  const step = Math.max(6, h / 3);
  const edge = (n) => (seeded(seed + n) - 0.5) * Math.max(1.6, h * 0.06);
  let n = 0;
  c.beginPath();
  c.moveTo(-w / 2, -h / 2);
  for (let x = -w / 2 + step; x < w / 2; x += step) c.lineTo(x, -h / 2 + edge((n += 1)));
  c.lineTo(w / 2, -h / 2);
  for (let y = -h / 2 + step; y < h / 2; y += step) c.lineTo(w / 2 + edge((n += 1)), y);
  c.lineTo(w / 2, h / 2);
  for (let x = w / 2 - step; x > -w / 2; x -= step) c.lineTo(x, h / 2 + edge((n += 1)));
  c.lineTo(-w / 2, h / 2);
  for (let y = h / 2 - step; y > -h / 2; y -= step) c.lineTo(-w / 2 + edge((n += 1)), y);
  c.closePath();
}

function drawScrap(s, cx, cy, rot, size, w, h) {
  const c = drawingContext;
  c.save();
  c.translate(cx, cy);
  c.rotate(rot);
  c.shadowColor = '#00000080';
  c.shadowBlur = 6;
  c.shadowOffsetY = 2;
  tornPath(c, w, h, s.index);
  c.fillStyle = s.rect.clip.paper;
  c.fill();
  c.shadowColor = 'transparent';
  c.font = fontOf(s.rect.clip, size);
  c.fillStyle = s.rect.clip.ink;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(s.rect.text, 0, 0);
  c.restore();
}

function draw() {
  if (!state.pageG) return;
  image(state.pageG, 0, 0, width, height);
  const { note } = areas();
  const c = drawingContext;
  c.fillStyle = '#0b0710';
  c.fillRect(note.x, note.y, note.w, note.h);
  // A hole in the page for every word that has been cut.
  c.fillStyle = DESK;
  state.rects.forEach((r, i) => {
    if (!state.used[i]) return;
    c.save();
    c.translate(r.x + r.w / 2, r.y + r.h / 2);
    tornPath(c, r.w, r.h * 0.92, i);
    c.fill();
    c.restore();
  });
  if (!state.scraps.length) {
    c.fillStyle = '#ffffff55';
    c.font = '13px Silkscreen';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(state.busy ? 'cutting...' : 'the note goes here', note.x + note.w / 2, note.y + note.h / 2);
    c.textAlign = 'start';
  }
  const now = millis();
  let moving = false;
  state.scraps.forEach((s) => {
    if (!s.rect) return;
    const t = constrain((now - s.start) / FLY_MS, 0, 1);
    if (now < s.start) { moving = true; return; }
    if (t < 1) moving = true;
    const e = 1 - (1 - t) ** 3;
    const from = { x: s.rect.x + s.rect.w / 2, y: s.rect.y + s.rect.h / 2 };
    const size = lerp(s.rect.size, s.size, e);
    drawScrap(s, lerp(from.x, s.tx, e), lerp(from.y, s.ty, e) - sin(t * PI) * 26, s.rot * e,
      size, lerp(s.rect.w, s.w, e), lerp(s.rect.h, s.h, e));
  });
  if (!moving) noLoop();
}

function updateCount() {
  ui.wordCount.textContent = state.used.filter((u) => !u).length;
}

async function callGemini(prompt, key) {
  let lastError;
  for (const model of MODELS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(R.requestBody(prompt)),
        signal: ctrl.signal,
      });
      if (res.ok) return R.parseReply(await res.json());
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        throw Object.assign(new Error('Google rejected that API key.'), { fatal: true });
      }
      lastError = new Error(res.status === 429
        ? 'Out of free Gemini requests for now. Wait a minute and try again.'
        : 'Gemini is overloaded right now. Try again in a moment.');
    } catch (e) {
      if (e.fatal) throw e;
      lastError = e.name === 'AbortError' ? new Error('Gemini took too long. Try again.') : e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

async function ask() {
  if (state.busy) return;
  const question = ui.question.value.trim();
  const key = ui.apiKey.value.trim();
  if (!key) { ui.keyBox.open = true; ui.apiKey.focus(); return setStatus('Paste your Gemini API key first.', true); }
  if (!question) { ui.question.focus(); return setStatus('Ask it something first.', true); }
  if (state.used.every(Boolean)) return setStatus(state.tokens.length ? 'The page is out of words. Press Fresh page.' : 'Paste some text first.', true);

  state.busy = true;
  state.scraps = [];
  ui.ask.disabled = true;
  ui.savePng.disabled = true;
  ui.smuggled.textContent = '';
  ui.noteText.textContent = '';
  setStatus('Gemini is reading your page...');
  redraw();
  try {
    // Two tries. Whatever still breaks the rule on the last one gets refused and shown.
    let result = { picks: [], smuggled: [] };
    let refused = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const words = await callGemini(R.buildPrompt(question, state.tokens, state.used, refused), key);
      const round = R.matchReply(words, state.tokens, state.used);
      refused = [...refused, ...round.smuggled];
      if (round.picks.length >= result.picks.length) result = round;
      if (!round.smuggled.length && round.picks.length) break;
    }
    if (!result.picks.length) throw new Error('None of its words were on your page. Try a longer page.');
    land(result.picks);
    const unique = [...new Set(refused.map(R.normalize))];
    ui.smuggled.textContent = unique.length
      ? `Refused ${unique.length} word${unique.length > 1 ? 's' : ''} that weren't yours: ${unique.join(', ')}`
      : '';
    setStatus('');
    ui.noteText.textContent = result.picks.map((i) => state.tokens[i].word).join(' ');
    ui.savePng.disabled = false;
  } catch (e) {
    setStatus(e.message || 'Something went wrong. Try again.', true);
  } finally {
    state.busy = false;
    ui.ask.disabled = false;
    redraw();
  }
}

function land(picks) {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stagger = Math.min(110, (MAX_FLIGHT_MS - FLY_MS) / picks.length);
  const now = millis();
  state.scraps = picks.map((index, i) => ({ index, rect: state.rects[index], start: still ? -1e9 : now + i * stagger }));
  picks.forEach((i) => { state.used[i] = true; });
  layoutNote();
  updateCount();
  loop();
}
