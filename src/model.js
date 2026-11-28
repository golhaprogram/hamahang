// Pure timing state for a list of lyric lines. No DOM, so it can be unit-tested.
//
// Each line: { text, start, end, repeats }
//   start:   seconds or null (not yet stamped)
//   end:     seconds or null (null = runs until the next stamped line starts)
//   repeats: more times the same line is sung or read later in the audio,
//            [{ start, end }] in time order, e.g. a line the announcer reads
//            again, or a whole poem performed a second time
// cursor: index of the next line the "stamp" action will time.
//
// A line wrapped entirely in parentheses, e.g. "(مولوی)", or starting with "#"
// is a label (a poet's name, a section heading): it is shown but never timed
// and never exported.

export function isLabel(text) {
  const t = String(text).trim();
  return /^[(（].*[)）]$/.test(t) || t.startsWith("#");
}

export function parseLines(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^([-*_])(\s*\1){2,}$/.test(l)) // drop blank rows and Markdown --- rules
    .map((text) => ({ text, start: null, end: null, repeats: [], label: isLabel(text) }));
}

export class SyncModel {
  constructor(lines = []) {
    this.lines = lines.map((l) => ({
      text: l.text,
      start: l.start ?? null,
      end: l.end ?? null,
      repeats: (l.repeats || []).map((r) => ({ start: r.start, end: r.end ?? null })),
      label: l.label ?? isLabel(l.text),
    }));
    this.cursor = this.firstUnstamped();
    this.history = [];
  }

  static fromText(text) {
    return new SyncModel(parseLines(text));
  }

  firstUnstamped() {
    const i = this.lines.findIndex((l) => !l.label && l.start == null);
    return i === -1 ? this.lines.length : i;
  }

  get timeable() {
    return this.lines.filter((l) => !l.label);
  }

  get done() {
    const t = this.timeable;
    return t.length > 0 && t.every((l) => l.start != null);
  }

  get stampedCount() {
    return this.timeable.filter((l) => l.start != null).length;
  }

  get total() {
    return this.timeable.length;
  }

  // First timeable index at or after i.
  nextTimeable(i) {
    while (i < this.lines.length && this.lines[i].label) i++;
    return i;
  }

  snapshot() {
    this.history.push(JSON.stringify({ lines: this.lines, cursor: this.cursor }));
    if (this.history.length > 200) this.history.shift();
  }

  undo() {
    const prev = this.history.pop();
    if (!prev) return false;
    const s = JSON.parse(prev);
    this.lines = s.lines;
    this.cursor = s.cursor;
    return true;
  }

  // Time the line at the cursor and advance.
  stamp(t) {
    this.cursor = this.nextTimeable(this.cursor);
    if (this.cursor >= this.lines.length) return false;
    this.snapshot();
    const t0 = Math.max(0, round(t));
    const line = this.lines[this.cursor];
    line.start = t0;
    if (line.end != null && line.end <= t0) line.end = null;
    // Whatever was showing before this start can't run past it.
    const prev = this.lastTimeBefore(t0, line);
    if (prev && prev.end != null && prev.end > t0) prev.end = t0;
    // Re-timing one line from the middle shouldn't line up the next (already
    // timed) line to be overwritten: go back to the first untimed line.
    const next = this.nextTimeable(this.cursor + 1);
    this.cursor = next < this.lines.length && this.lines[next].start != null ? this.firstUnstamped() : next;
    return true;
  }

  // Remove a line's silence mark, so it runs until the next line again.
  clearEnd(i) {
    const line = this.lines[i];
    if (!line || line.end == null) return false;
    this.snapshot();
    line.end = null;
    return true;
  }

  // Mark that singing stopped: ends the most recently started line.
  silence(t) {
    const t0 = round(t);
    const time = this.lastTimeBefore(t0);
    if (!time) return false;
    this.snapshot();
    time.end = t0;
    return true;
  }

  // Every time any line starts: the line itself (its first time) and each of
  // its repeats, as [{ index, time }] where time is the object holding
  // start/end, in time order.
  times() {
    const out = [];
    this.lines.forEach((l, index) => {
      if (l.label) return;
      if (l.start != null) out.push({ index, time: l });
      l.repeats.forEach((r) => out.push({ index, time: r }));
    });
    return out.sort((a, b) => a.time.start - b.time.start);
  }

  // The time (line or repeat) that started most recently before t, if any.
  lastTimeBefore(t, except = null) {
    let found = null;
    for (const { time } of this.times()) {
      if (time !== except && time.start < t) found = time;
    }
    return found;
  }

  // Line i is sung (or read) again at time t: add a repeat. Works for any
  // timed line, wherever the cursor is, and leaves the cursor alone.
  again(i, t) {
    const line = this.lines[i];
    if (!line || line.label || line.start == null) return false;
    const t0 = Math.max(0, round(t));
    if (t0 <= line.start || line.repeats.some((r) => r.start === t0)) return false;
    this.snapshot();
    const prev = this.lastTimeBefore(t0);
    if (prev && prev.end != null && prev.end > t0) prev.end = t0;
    line.repeats.push({ start: t0, end: null });
    line.repeats.sort((a, b) => a.start - b.start);
    this.cursor = this.firstUnstamped();
    return true;
  }

  // The poem starting at line i is performed again from time t, exactly as
  // the first time: copy the first run's timing, shifted to start at t. The
  // poem runs to the next label (poet name or heading) or the end. Every
  // copied time gets an explicit end, so the last line clears when the
  // reprise ends instead of hanging over whatever follows.
  repeatFrom(i, t, duration = null) {
    const first = this.lines[i];
    if (!first || first.label || first.start == null) return false;
    const t0 = Math.max(0, round(t));
    const base = first.start;
    if (t0 <= base) return false;
    let last = i;
    while (last + 1 < this.lines.length && !this.lines[last + 1].label) last++;
    // The first run: cues of this poem's lines from base until the poem's
    // last first-time line ends (repeats inside it, like a refrain, count too).
    const cues = this.cues(duration).filter((c) => c.index >= i && c.index <= last);
    const runEnd = Math.max(...cues.filter((c) => !c.repeat).map((c) => c.end));
    const run = cues.filter((c) => c.start >= base && c.start < runEnd);
    if (!run.length) return false;
    this.snapshot();
    const prev = this.lastTimeBefore(t0);
    if (prev && prev.end != null && prev.end > t0) prev.end = t0;
    for (const c of run) {
      const start = round(t0 + c.start - base);
      const end = round(t0 + c.end - base);
      const reps = this.lines[c.index].repeats;
      if (reps.some((r) => r.start === start)) continue;
      reps.push({ start, end });
      reps.sort((a, b) => a.start - b.start);
    }
    this.cursor = this.firstUnstamped();
    return true;
  }

  removeRepeat(i, k) {
    const line = this.lines[i];
    if (!line || !line.repeats[k]) return false;
    this.snapshot();
    line.repeats.splice(k, 1);
    return true;
  }

  // Make line i the next one to stamp (to re-time it).
  select(i) {
    if (i < 0 || i >= this.lines.length) return;
    this.cursor = this.nextTimeable(i);
  }

  nudge(i, delta) {
    const line = this.lines[i];
    if (!line || line.start == null) return false;
    this.snapshot();
    line.start = Math.max(0, round(line.start + delta));
    if (line.end != null && line.end <= line.start) line.end = null;
    return true;
  }

  clear(i) {
    const line = this.lines[i];
    if (!line || line.label) return;
    this.snapshot();
    line.start = null;
    line.end = null;
    line.repeats = [];
    this.cursor = Math.min(this.cursor, i);
  }

  prevStamped(i) {
    for (let j = i - 1; j >= 0; j--) if (this.lines[j].start != null) return this.lines[j];
    return null;
  }

  // Resolved cues, in time order, with every end filled in.
  // A repeat has repeat: true.
  cues(duration = null) {
    const stamped = this.times();
    return stamped.map(({ index, time }, k) => {
      const next = stamped[k + 1]?.time;
      let end = time.end;
      if (end == null || (next && end > next.start)) {
        end = next ? next.start : duration ?? time.start + 6;
      }
      if (end <= time.start) end = round(time.start + 0.5);
      const cue = { index, text: this.lines[index].text, start: time.start, end: round(end) };
      if (time !== this.lines[index]) cue.repeat = true;
      return cue;
    });
  }

  // Index of the line showing at time t (for preview), or -1.
  activeAt(t, duration = null) {
    const c = this.cues(duration).find((c) => t >= c.start && t < c.end);
    return c ? c.index : -1;
  }

  // Apply timings from parsed cues (e.g. an existing VTT), matched by text.
  // The k-th cue with a given text times the k-th line with that text; if
  // the text is sung more often than it's written, the extra cues become
  // repeats of its last copy. Lines a cue matches lose their old times.
  // Returns the cues that match no line.
  applyCues(cues) {
    const byText = new Map();
    this.lines.forEach((l, i) => {
      if (l.label) return;
      const k = normalize(l.text);
      if (!byText.has(k)) byText.set(k, []);
      byText.get(k).push(i);
    });
    const seen = new Map();
    const touched = new Set();
    const unmatched = [];
    for (const cue of [...cues].sort((a, b) => a.start - b.start)) {
      const k = normalize(cue.text);
      const copies = byText.get(k);
      if (!copies) {
        unmatched.push(cue);
        continue;
      }
      const n = seen.get(k) || 0;
      seen.set(k, n + 1);
      const line = this.lines[copies[Math.min(n, copies.length - 1)]];
      if (!touched.has(line)) {
        touched.add(line);
        line.start = null;
        line.end = null;
        line.repeats = [];
      }
      if (n < copies.length) {
        line.start = cue.start;
        line.end = cue.end;
      } else {
        line.repeats.push({ start: cue.start, end: cue.end });
      }
    }
    this.cursor = this.firstUnstamped();
    return unmatched;
  }

  toJSON() {
    return { lines: this.lines, cursor: this.cursor };
  }

  static fromJSON(obj) {
    const m = new SyncModel(obj.lines || []);
    if (Number.isInteger(obj.cursor)) m.cursor = m.nextTimeable(obj.cursor);
    return m;
  }
}

function round(t) {
  return Math.round(t * 1000) / 1000;
}

function normalize(s) {
  return String(s)
    .replace(/<[^>]*>/g, "")
    .replace(/[‌‍\s]+/g, " ")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .trim();
}
