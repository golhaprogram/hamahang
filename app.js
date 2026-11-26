import "./src/ham-ahang.js";
import { openPullRequest } from "./src/github.js";

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const form = $("#setup");
const workspace = $("#workspace");
const sync = document.querySelector("ham-ahang");
const dialog = $("#export");
const TOKEN_KEY = "hamahang:github-token";

// ---- prefill from URL parameters ----
// ?audio=&lyrics=<url to a text file>&vtt=<url>&lang=&dir=&offset=&name=&repo=&path=&base=&title=
for (const k of ["audio", "lang", "dir", "offset"]) if (params.has(k)) form.elements[k].value = params.get(k);
if (params.has("name")) $("#file-name").value = params.get("name");
if (params.has("repo")) $("#gh-repo").value = params.get("repo");
if (params.has("path")) {
  $("#gh-path").value = params.get("path");
  if (!params.has("name")) $("#file-name").value = params.get("path").split("/").pop();
}
if (params.has("base")) $("#gh-base").value = params.get("base");
if (params.has("title")) $("#gh-title").value = params.get("title");
$("#gh-token").value = localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || "";
$("#gh-remember").checked = !!localStorage.getItem(TOKEN_KEY);

let remoteVtt = null;
(async () => {
  try {
    if (params.has("lyrics")) form.elements.lyrics.value = await fetchText(params.get("lyrics"));
    if (params.has("vtt")) remoteVtt = await fetchText(params.get("vtt"), true);
    if (form.elements.audio.value && form.elements.lyrics.value.trim()) start();
  } catch (e) {
    showError(e.message);
  }
})();

async function fetchText(url, optional = false) {
  const res = await fetch(url);
  if (!res.ok) {
    if (optional && res.status === 404) return null;
    throw new Error(`Couldn't load ${url} (${res.status}). The server must allow cross-origin requests.`);
  }
  return res.text();
}

// ---- setup ----
form.addEventListener("submit", (e) => {
  e.preventDefault();
  start();
});

async function start() {
  showError(null);
  const f = form.elements;
  const file = f.audioFile.files[0];
  const audioUrl = file ? URL.createObjectURL(file) : f.audio.value.trim();
  if (!audioUrl) return showError("Choose an audio file or enter its URL.");
  if (!f.lyrics.value.trim()) return showError("Paste the lyrics first.");

  const key = file ? `file:${file.name}:${file.size}` : audioUrl;
  sync.setAttribute("storage-key", key);
  sync.setAttribute("lang", f.lang.value.trim());
  sync.setAttribute("dir", f.dir.value);
  sync.setAttribute("offset", f.offset.value || "0.25");
  sync.setAttribute("audio", audioUrl);
  sync.setAudioSource(audioUrl);
  sync.lyrics = f.lyrics.value;

  const vttFile = f.vttFile.files[0];
  if (vttFile) sync.loadVTT(await vttFile.text());
  else if (remoteVtt && sync.model.stampedCount === 0) sync.loadVTT(remoteVtt);

  if (!params.has("name") && !params.has("path")) {
    const base = (file ? file.name : audioUrl.split("/").pop().split("?")[0]).replace(/\.[^.]+$/, "");
    if (base) $("#file-name").value = `${decodeURIComponent(base)}.vtt`;
  }

  form.hidden = true;
  workspace.hidden = false;
  $("#show-setup").hidden = false;
  $("#show-export").hidden = false;
}

$("#show-setup").addEventListener("click", () => {
  form.hidden = !form.hidden;
  if (!form.hidden) form.scrollIntoView();
});

function showError(msg) {
  const el = $("#setup-error");
  el.hidden = !msg;
  el.textContent = msg || "";
}

// ---- export ----
$("#show-export").addEventListener("click", () => {
  $("#vtt-preview").textContent = sync.toVTT();
  $("#gh-status").textContent = "";
  dialog.showModal();
});

// Don't pop the dialog on the last line: you may still want to tap "Silence".
sync.addEventListener("sync-complete", () => $("#show-export").classList.add("primary"));

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const fileName = () => $("#file-name").value.trim() || "lyrics.vtt";
$("#dl-vtt").addEventListener("click", () => download(fileName().replace(/\.\w+$/, "") + ".vtt", sync.toVTT(), "text/vtt"));
$("#dl-lrc").addEventListener("click", () => download(fileName().replace(/\.\w+$/, "") + ".lrc", sync.toLRC(), "text/plain"));
$("#copy-vtt").addEventListener("click", async (e) => {
  await navigator.clipboard.writeText(sync.toVTT());
  e.target.textContent = "Copied ✓";
  setTimeout(() => (e.target.textContent = "Copy VTT"), 1500);
});

$("#gh-open").addEventListener("click", async () => {
  const status = $("#gh-status");
  const btn = $("#gh-open");
  const token = $("#gh-token").value.trim();
  const remember = $("#gh-remember").checked;
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  if (token) (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, token);

  const { stampedCount: stamped, total } = sync.model;
  btn.disabled = true;
  status.textContent = "Opening pull request…";
  try {
    const pr = await openPullRequest({
      token,
      repo: $("#gh-repo").value.trim(),
      path: $("#gh-path").value.trim(),
      base: $("#gh-base").value.trim() || null,
      title: $("#gh-title").value.trim() || null,
      content: sync.toVTT(),
      body: `Timed with [Hamahang](https://github.com/golhaprogram/hamahang): ${stamped} of ${total} lines.`,
    });
    status.innerHTML = "";
    const a = Object.assign(document.createElement("a"), { href: pr.url, target: "_blank", rel: "noopener" });
    a.textContent = `Pull request #${pr.number} opened ↗`;
    status.append(a);
  } catch (e) {
    status.textContent = e.message;
  } finally {
    btn.disabled = false;
  }
});
