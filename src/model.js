// Pure timing state for a list of lyric lines. No DOM, so it can be unit-tested.
//
// Each line: { text, start, end }
//   start: seconds or null (not yet stamped)
//   end:   seconds or null (null = runs until the next stamped line starts)
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
    .filter((l) => l.length > 0)
    .map((text) => ({ text, start: null, end: null, label: isLabel(text) }));
}

export class SyncModel {
  constructor(lines = []) {
    this.lines = lines.map((l) => ({
      text: l.text,
      start: l.start ?? null,
      end: l.end ?? null,
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
    // An earlier line's explicit end can't run past this start.
    const prev = this.prevStamped(this.cursor);
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
    let idx = -1;
    for (let i = 0; i < this.lines.length; i++) {
      const s = this.lines[i].start;
      if (s != null && s < t0) idx = i;
    }
    if (idx === -1) return false;
    this.snapshot();
    this.lines[idx].end = t0;
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
    this.cursor = Math.min(this.cursor, i);
  }

  prevStamped(i) {
    for (let j = i - 1; j >= 0; j--) if (this.lines[j].start != null) return this.lines[j];
    return null;
  }

  // Resolved cues, in time order, with every end filled in.
  cues(duration = null) {
    const stamped = this.lines
      .map((l, index) => ({ ...l, index }))
      .filter((l) => !l.label && l.start != null)
      .sort((a, b) => a.start - b.start);
    return stamped.map((l, k) => {
      const next = stamped[k + 1];
      let end = l.end;
      if (end == null || (next && end > next.start)) {
        end = next ? next.start : duration ?? l.start + 6;
      }
      if (end <= l.start) end = round(l.start + 0.5);
      return { index: l.index, text: l.text, start: l.start, end: round(end) };
    });
  }

  // Index of the line showing at time t (for preview), or -1.
  activeAt(t, duration = null) {
    const c = this.cues(duration).find((c) => t >= c.start && t < c.end);
    return c ? c.index : -1;
  }

  // Apply timings from parsed cues (e.g. an existing VTT), matched by text in order.
  applyCues(cues) {
    let from = 0;
    for (const cue of cues) {
      const norm = normalize(cue.text);
      for (let i = from; i < this.lines.length; i++) {
        if (!this.lines[i].label && normalize(this.lines[i].text) === norm) {
          this.lines[i].start = cue.start;
          this.lines[i].end = cue.end;
          from = i + 1;
          break;
        }
      }
    }
    this.cursor = this.firstUnstamped();
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
