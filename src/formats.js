// WebVTT and LRC serialization, plus a small WebVTT parser.

export function formatVttTime(sec) {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(r, 3)}`;
}

export function formatLrcTime(sec) {
  const cs = Math.round(sec * 100);
  const m = Math.floor(cs / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const r = cs % 100;
  return `${pad(m)}:${pad(s)}.${pad(r)}`;
}

export function formatClock(sec) {
  if (sec == null || !isFinite(sec)) return "--:--";
  const t = Math.max(0, sec);
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const d = Math.floor((t * 10) % 10);
  return `${m}:${pad(s)}.${d}`;
}

// cues: [{ start, end, text }]
export function toVTT(cues, { lang = null, note = null } = {}) {
  let out = "WEBVTT\n";
  if (lang) out += `Language: ${lang}\n`;
  out += "\n";
  if (note) out += `NOTE\n${String(note).replace(/-->/g, "→")}\n\n`;
  cues.forEach((c, i) => {
    out += `l${i + 1}\n${formatVttTime(c.start)} --> ${formatVttTime(c.end)}\n${escapeVtt(c.text)}\n\n`;
  });
  return out;
}

// LRC has no end times; a blank timed line marks a gap.
export function toLRC(cues, { title = null } = {}) {
  let out = "";
  if (title) out += `[ti:${title}]\n`;
  cues.forEach((c, i) => {
    out += `[${formatLrcTime(c.start)}]${c.text}\n`;
    const next = cues[i + 1];
    if (!next || next.start - c.end > 0.05) out += `[${formatLrcTime(c.end)}]\n`;
  });
  return out;
}

export function parseVttTime(s) {
  const m = String(s).trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
  if (!m) return null;
  const [, h = "0", mi, se, ms] = m;
  return +h * 3600 + +mi * 60 + +se + +ms.padEnd(3, "0") / 1000;
}

export function parseVTT(text) {
  const blocks = String(text).replace(/\r\n?/g, "\n").split(/\n{2,}/);
  const cues = [];
  for (const block of blocks) {
    const rows = block.split("\n");
    const ti = rows.findIndex((r) => r.includes("-->"));
    if (ti === -1) continue;
    const [a, b] = rows[ti].split("-->");
    const start = parseVttTime(a);
    const end = parseVttTime(b.trim().split(/\s+/)[0]);
    if (start == null || end == null) continue;
    const body = rows.slice(ti + 1).join("\n").trim();
    cues.push({ start, end, text: unescapeVtt(body) });
  }
  return cues;
}

function escapeVtt(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/-->/g, "--&gt;");
}

function unescapeVtt(s) {
  return String(s)
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function pad(n, w = 2) {
  return String(n).padStart(w, "0");
}
