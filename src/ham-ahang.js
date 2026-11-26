// <ham-ahang> — tap-to-time lyric lines against an audio file.
//
// Attributes:
//   audio        URL of the audio file
//   lang         language of the lyrics (e.g. "fa"); also picks UI strings
//   dir          "rtl" | "ltr" | "auto" (default "auto")
//   offset       reaction-time compensation in seconds, subtracted from each tap (default 0.25)
//   storage-key  key for saving progress in localStorage (default: the audio URL)
//
// Properties / methods:
//   .lyrics = "line 1\nline 2"   set the text (restores saved progress for the same text)
//   .setAudioSource(url)         e.g. a blob: URL for a local file
//   .loadVTT(text)               apply timings from an existing WebVTT file
//   .toVTT() / .toLRC()          export
//   .cues()                      resolved [{index, text, start, end}]
//
// Events:
//   sync-change    detail { stamped, total }
//   sync-complete  detail { vtt }   fired when the last line gets a time

import { SyncModel } from "./model.js";
import { toVTT, toLRC, parseVTT, formatClock } from "./formats.js";
import { strings } from "./i18n.js";

const CSS = `
:host { display: block; font-family: var(--ls-font, system-ui, sans-serif); color: var(--ls-fg, #1d1d1f);
  --ls-accent: #2f6f4f; --ls-active: #fff4c2; --ls-next: #e6f2ec; --ls-muted: #6b6b70; --ls-border: #ddd; --ls-bg: #fff; }
@media (prefers-color-scheme: dark) {
  :host { --ls-fg: #eee; --ls-active: #5a4a12; --ls-next: #1f3a2d; --ls-muted: #a0a0a6; --ls-border: #3a3a3c; --ls-bg: #1c1c1e; }
}
* { box-sizing: border-box; }
.top { position: sticky; top: 0; z-index: 2; background: var(--ls-bg); padding: .5rem 0; border-bottom: 1px solid var(--ls-border); }
audio { width: 100%; }
.row-controls { display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; margin-top: .4rem; font-size: .9rem; }
.mode button { border: 1px solid var(--ls-border); background: transparent; color: inherit; padding: .3rem .7rem; border-radius: 999px; cursor: pointer; }
.mode button[aria-pressed="true"] { background: var(--ls-accent); color: #fff; border-color: var(--ls-accent); }
.progress { margin-inline-start: auto; color: var(--ls-muted); font-variant-numeric: tabular-nums; }
select { font: inherit; }
ol { list-style: none; margin: 0; padding: .5rem 0 9rem; }
li { display: grid; grid-template-columns: 4.5rem 1fr; gap: .5rem; align-items: baseline; padding: .55rem .5rem;
  border-radius: .5rem; cursor: pointer; border: 2px solid transparent; }
li .t { font-variant-numeric: tabular-nums; color: var(--ls-muted); font-size: .85rem; direction: ltr; text-align: start; }
li .t.unset { opacity: .5; }
li .text { font-size: 1.15rem; line-height: 1.7; }
li.next { background: var(--ls-next); border-color: var(--ls-accent); }
li.active { background: var(--ls-active); }
li .tools { grid-column: 2; display: none; gap: .4rem; }
li.next .tools { display: flex; }
li .tools button { font: inherit; font-size: .85rem; padding: .2rem .6rem; border-radius: .4rem; border: 1px solid var(--ls-border); background: var(--ls-bg); color: inherit; direction: ltr; }
.bar { position: fixed; inset-inline: 0; bottom: 0; z-index: 3; background: var(--ls-bg); border-top: 1px solid var(--ls-border);
  padding: .6rem max(.6rem, env(safe-area-inset-left)) calc(.6rem + env(safe-area-inset-bottom)); display: grid;
  grid-template-columns: 1fr 1fr 1fr; gap: .5rem; }
.bar button { font: inherit; border-radius: .7rem; border: 1px solid var(--ls-border); background: var(--ls-bg); color: inherit; padding: .7rem; min-height: 3rem; touch-action: manipulation; }
.bar .stamp { grid-column: 1 / -1; background: var(--ls-accent); color: #fff; border: none; font-size: 1.35rem; min-height: 4.2rem; font-weight: 600; }
.bar .stamp:active { filter: brightness(.85); }
:host([mode="preview"]) .bar .stamp, :host([mode="preview"]) .bar .silence { display: none; }
:host([mode="preview"]) .bar { grid-template-columns: 1fr 1fr; }
:host([started]) .hint, :host([started]) .keys { display: none; }
.hint { color: var(--ls-muted); font-size: .85rem; margin: .4rem 0 0; }
.keys { color: var(--ls-muted); font-size: .75rem; margin: .2rem 0 0; }
@media (pointer: coarse) { .keys { display: none; } }
`;

export class HamAhang extends HTMLElement {
  static get observedAttributes() {
    return ["audio", "lang", "dir", "offset"];
  }

  constructor() {
    super();
    this.model = new SyncModel([]);
    this._text = "";
    this._mode = "sync";
    this._activeIndex = -1;
    this._wakeLock = null;
    this.attachShadow({ mode: "open" });
    this._onKey = this._onKey.bind(this);
  }

  connectedCallback() {
    this._render();
    document.addEventListener("keydown", this._onKey);
  }

  disconnectedCallback() {
    document.removeEventListener("keydown", this._onKey);
    this._releaseWakeLock();
  }

  attributeChangedCallback(name) {
    if (!this.shadowRoot.firstChild) return;
    if (name === "audio") this.setAudioSource(this.getAttribute("audio"));
    else this._render();
  }

  get offset() {
    const v = parseFloat(this.getAttribute("offset"));
    return isFinite(v) ? v : 0.25;
  }

  get storageKey() {
    return this.getAttribute("storage-key") || this.getAttribute("audio") || null;
  }

  get lyrics() {
    return this._text;
  }

  set lyrics(text) {
    this._text = String(text ?? "");
    const saved = this._loadSaved();
    this.model = saved || SyncModel.fromText(this._text);
    this._renderList();
    this._emitChange();
  }

  setAudioSource(url) {
    const a = this._audio;
    if (a && url && a.getAttribute("src") !== url) a.src = url;
  }

  loadVTT(text) {
    this.model.snapshot();
    this.model.applyCues(parseVTT(text));
    this._afterChange();
  }

  cues() {
    return this.model.cues(this._duration());
  }

  toVTT(opts = {}) {
    return toVTT(this.cues(), { lang: this.getAttribute("lang") || null, ...opts });
  }

  toLRC(opts = {}) {
    return toLRC(this.cues(), opts);
  }

  reset() {
    this.model = SyncModel.fromText(this._text);
    this._afterChange();
  }

  // ---- actions ----

  stamp() {
    if (this._mode !== "sync") return;
    const wasLast = this.model.cursor === this.model.lines.length - 1;
    if (this.model.stamp(this._audio.currentTime - this.offset)) {
      this._afterChange();
      if (wasLast && this.model.done) {
        this.dispatchEvent(new CustomEvent("sync-complete", { detail: { vtt: this.toVTT() }, bubbles: true }));
      }
    }
  }

  silence() {
    if (this._mode !== "sync") return;
    if (this.model.silence(this._audio.currentTime - this.offset)) this._afterChange();
  }

  undo() {
    if (this.model.undo()) this._afterChange();
  }

  seekBy(d) {
    const a = this._audio;
    a.currentTime = Math.max(0, Math.min(this._duration() ?? Infinity, a.currentTime + d));
  }

  setMode(mode) {
    this._mode = mode === "preview" ? "preview" : "sync";
    this.setAttribute("mode", this._mode);
    // Don't re-render: that would recreate the <audio> element and stop playback.
    this.shadowRoot.querySelectorAll(".mode button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === this._mode)));
    this._activeIndex = -1;
    this._tick();
    this._updateHighlights();
  }

  // ---- internals ----

  get _audio() {
    return this.shadowRoot.querySelector("audio");
  }

  _duration() {
    const d = this._audio?.duration;
    return isFinite(d) ? d : null;
  }

  _t() {
    return strings(this.getAttribute("lang"));
  }

  _render() {
    const t = this._t();
    const dir = this.getAttribute("dir") || "auto";
    const prevAudio = this._audio;
    const src = prevAudio?.getAttribute("src") || this.getAttribute("audio") || "";
    const time = prevAudio?.currentTime || 0;
    const rate = prevAudio?.playbackRate || 1;

    this.shadowRoot.innerHTML = `
      <style>${CSS}</style>
      <div class="top">
        <audio controls preload="metadata"></audio>
        <div class="row-controls">
          <span class="mode" role="group">
            <button type="button" data-mode="sync" aria-pressed="${this._mode === "sync"}">${t.sync}</button>
            <button type="button" data-mode="preview" aria-pressed="${this._mode === "preview"}">${t.preview}</button>
          </span>
          <label>${t.speed}
            <select class="rate">
              ${[0.5, 0.75, 0.9, 1].map((r) => `<option value="${r}" ${r === rate ? "selected" : ""}>${r}×</option>`).join("")}
            </select>
          </label>
          <span class="progress" aria-live="polite"></span>
        </div>
        <p class="hint" dir="auto">${t.hint}</p>
        <p class="keys" dir="auto">${t.keys}</p>
      </div>
      <ol dir="${dir}" lang="${this.getAttribute("lang") || ""}"></ol>
      <div class="bar">
        <button type="button" class="stamp">${t.stamp}</button>
        <button type="button" class="silence">${t.silence}</button>
        <button type="button" class="undo">${t.undo}</button>
        <button type="button" class="back">${t.back}</button>
      </div>`;

    const a = this._audio;
    if (src) a.src = src;
    a.playbackRate = rate;
    if (time) a.addEventListener("loadedmetadata", () => (a.currentTime = time), { once: true });
    a.addEventListener("timeupdate", () => this._tick());
    a.addEventListener("play", () => {
      this._acquireWakeLock();
      this._loop();
    });
    a.addEventListener("pause", () => this._releaseWakeLock());

    const root = this.shadowRoot;
    root.querySelector(".rate").addEventListener("change", (e) => (a.playbackRate = +e.target.value));
    root.querySelectorAll(".mode button").forEach((b) => b.addEventListener("click", () => this.setMode(b.dataset.mode)));
    // pointerdown fires before click, so taps land closer to the moment you hit the button.
    root.querySelector(".stamp").addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.stamp();
    });
    root.querySelector(".silence").addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.silence();
    });
    root.querySelector(".undo").addEventListener("click", () => this.undo());
    root.querySelector(".back").addEventListener("click", () => this.seekBy(-3));
    root.querySelector("ol").addEventListener("click", (e) => this._onListClick(e));

    this._renderList();
  }

  _renderList() {
    const ol = this.shadowRoot.querySelector("ol");
    if (!ol) return;
    const t = this._t();
    ol.innerHTML = "";
    this.model.lines.forEach((line, i) => {
      const li = document.createElement("li");
      li.dataset.index = i;
      const time = document.createElement("span");
      time.className = "t" + (line.start == null ? " unset" : "");
      time.textContent = line.start == null ? "--:--" : formatClock(line.start);
      const text = document.createElement("span");
      text.className = "text";
      text.dir = "auto";
      text.textContent = line.text;
      const tools = document.createElement("span");
      tools.className = "tools";
      tools.innerHTML = `
        <button type="button" data-act="nudge" data-d="-0.25">−0.25s</button>
        <button type="button" data-act="nudge" data-d="0.25">+0.25s</button>
        <button type="button" data-act="clear">${t.clear}</button>`;
      li.append(time, text, tools);
      ol.append(li);
    });
    this._updateHighlights();
    this._updateProgress();
  }

  _updateHighlights() {
    const items = this.shadowRoot.querySelectorAll("li");
    items.forEach((li, i) => {
      li.classList.toggle("next", this._mode === "sync" && i === this.model.cursor);
      li.classList.toggle("active", i === this._activeIndex);
    });
  }

  _updateProgress() {
    const el = this.shadowRoot.querySelector(".progress");
    if (!el) return;
    const t = this._t();
    const { stampedCount } = this.model;
    const total = this.model.lines.length;
    el.textContent = this.model.done ? `✓ ${t.done}` : `${stampedCount} / ${total}`;
    this.toggleAttribute("started", stampedCount > 0);
  }

  _afterChange() {
    this._save();
    this._renderList();
    this._scrollTo(this._mode === "sync" ? this.model.cursor : this._activeIndex);
    this._emitChange();
  }

  _emitChange() {
    this.dispatchEvent(
      new CustomEvent("sync-change", {
        detail: { stamped: this.model.stampedCount, total: this.model.lines.length },
        bubbles: true,
      })
    );
  }

  _scrollTo(i) {
    const li = this.shadowRoot.querySelector(`li[data-index="${i}"]`);
    if (!li) return;
    const r = li.getBoundingClientRect();
    if (r.top < window.innerHeight * 0.25 || r.bottom > window.innerHeight * 0.6) {
      li.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  _onListClick(e) {
    const li = e.target.closest("li");
    if (!li) return;
    const i = +li.dataset.index;
    const btn = e.target.closest("button");
    if (btn) {
      if (btn.dataset.act === "nudge") {
        this.model.nudge(i, +btn.dataset.d);
        const s = this.model.lines[i].start;
        if (s != null) this._audio.currentTime = Math.max(0, s - 0.5);
      } else if (btn.dataset.act === "clear") {
        this.model.clear(i);
      }
      this._afterChange();
      return;
    }
    const line = this.model.lines[i];
    if (this._mode === "preview") {
      if (line.start != null) this._audio.currentTime = line.start;
      return;
    }
    this.model.select(i);
    const ref = line.start ?? this.model.prevStamped(i)?.start ?? 0;
    this._audio.currentTime = Math.max(0, ref - 2);
    this._updateHighlights();
  }

  _onKey(e) {
    if (!this.isConnected || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.composedPath()[0]?.tagName || "").toLowerCase();
    if (["input", "textarea", "select"].includes(tag) || e.composedPath()[0]?.isContentEditable) return;
    const k = e.key.toLowerCase();
    if (k === " " || k === "enter") this.stamp();
    else if (k === "s") this.silence();
    else if (k === "z" || k === "backspace") this.undo();
    else if (k === "arrowleft") this.seekBy(-3);
    else if (k === "arrowright") this.seekBy(3);
    else if (k === "p") this._audio.paused ? this._audio.play() : this._audio.pause();
    else return;
    e.preventDefault();
  }

  _tick() {
    if (this._mode !== "preview") {
      if (this._activeIndex !== -1) {
        this._activeIndex = -1;
        this._updateHighlights();
      }
      return;
    }
    const i = this.model.activeAt(this._audio.currentTime, this._duration());
    if (i !== this._activeIndex) {
      this._activeIndex = i;
      this._updateHighlights();
      if (i !== -1) this._scrollTo(i);
    }
  }

  _loop() {
    if (this._audio.paused) return;
    this._tick();
    requestAnimationFrame(() => this._loop());
  }

  // ---- persistence ----

  _key() {
    return this.storageKey ? `hamahang:${this.storageKey}` : null;
  }

  _save() {
    const key = this._key();
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify({ text: this._text, model: this.model.toJSON(), savedAt: Date.now() }));
    } catch {}
  }

  _loadSaved() {
    const key = this._key();
    if (!key) return null;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (data.text !== this._text) return null;
      return SyncModel.fromJSON(data.model);
    } catch {
      return null;
    }
  }

  async _acquireWakeLock() {
    try {
      if ("wakeLock" in navigator && !this._wakeLock) {
        this._wakeLock = await navigator.wakeLock.request("screen");
        this._wakeLock.addEventListener("release", () => (this._wakeLock = null));
      }
    } catch {}
  }

  _releaseWakeLock() {
    this._wakeLock?.release().catch(() => {});
    this._wakeLock = null;
  }
}

if (!customElements.get("ham-ahang")) customElements.define("ham-ahang", HamAhang);
