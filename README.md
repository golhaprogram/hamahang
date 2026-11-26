# هماهنگ · Hamahang

*Hamahang* (هماهنگ: ham + āhang, "together" + "melody", meaning "in sync") times lyrics to audio by tapping along, in any browser, including on a phone. Built for Persian poetry sung on the [Golha](https://golhaprogram.com) radio programs, so right-to-left text is a first-class case, but nothing in it is specific to Golha.

- **Tap to time:** press play, tap **This line** as each line starts and **Silence** when the singing stops.
- **Fix as you go:** tap any line to jump back and re-time it, nudge ±0.25 s, skip ±3/5/10 s, undo, play at 0.5–0.9× speed.
- **Never lose work:** progress is saved in the browser for each audio file and restored when you come back.
- **Preview:** plays the audio with the current line highlighted, so you can check the timing.
- **Export:** WebVTT (`.vtt`) or LRC, as a download, copied to the clipboard, or **as a pull request** to a GitHub repo.
- No build step, no dependencies, no server. Plain ES modules.

## Use it

Open the page, give it an audio file (a URL or a file on your device), paste the lyrics one line per row, and press **Start**.

A row wrapped in parentheses, like `(مولوی)`, or starting with `#` is a label: it's shown as a heading but never timed or exported. Use it for poet names or section titles.

**Silence** is for the end of a block. Each line normally stays on screen until the next one starts, which is right for lines sung back to back. Before an instrumental passage, an announcer, or a long gap, tap **Silence** when the voice stops so the text clears instead of hanging over the music.

Everything can also be set with URL parameters, so another site can link straight into a ready-to-time session:

| Parameter | Meaning |
|---|---|
| `audio` | URL of the audio file. Playback needs no CORS. |
| `lyrics` | URL of a plain-text lyrics file, one line per row. The server must allow CORS. |
| `vtt` | URL of an existing `.vtt` to continue from (optional; a 404 is ignored). |
| `lang` | Language of the lyrics, e.g. `fa`. Also picks the button language (Persian or English). |
| `dir` | `rtl`, `ltr` or `auto`. |
| `offset` | Tap delay in seconds, subtracted from every tap to make up for reaction time. Default `0.25`. |
| `name` | File name for downloads. |
| `repo`, `path`, `base`, `title` | Defaults for the pull request form. |

If both `audio` and `lyrics` are given, the session starts right away.

Example:

```
index.html?audio=https://example.com/256.mp3&lyrics=https://example.com/256.txt&lang=fa&dir=rtl&repo=owner/site&path=static/lyrics/256.vtt
```

### Keyboard

Space or Enter = this line · S = silence · Z or Backspace = undo · ← / → = 3 s (with Shift: 10 s) · P = play/pause

## Pull requests

**Save / Export → Open a pull request** creates a branch, commits the VTT to the given path, and opens a PR against the base branch (the repo's default if left blank). It talks to `api.github.com` directly from the browser.

It needs a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new):

1. **Resource owner:** the account or organization that owns the repo.
2. **Repository access:** *Only select repositories* → the target repo.
3. **Permissions:** *Contents* → Read and write, *Pull requests* → Read and write.

The token is kept for the browser session, or in `localStorage` on this device if you tick *Remember*. It is only ever sent to `api.github.com`. Anyone using it needs write access to the target repo; there is no fork-based flow yet.

## Embed it

The timing UI is a web component with no dependencies:

```html
<script type="module" src="https://golhaprogram.github.io/hamahang/src/ham-ahang.js"></script>

<ham-ahang audio="/audio/256.mp3" lang="fa" dir="rtl"></ham-ahang>
<script type="module">
  const el = document.querySelector("ham-ahang");
  el.lyrics = "line one\nline two";
  el.addEventListener("sync-complete", (e) => console.log(e.detail.vtt));
</script>
```

| | |
|---|---|
| Attributes | `audio`, `lang`, `dir`, `offset`, `storage-key` (defaults to `audio`) |
| Properties and methods | `lyrics`, `setAudioSource(url)`, `loadVTT(text)`, `toVTT()`, `toLRC()`, `cues()`, `setMode("sync" \| "preview")`, `reset()` |
| Events | `sync-change` → `{ stamped, total }`, `sync-complete` → `{ vtt }` |

The pieces are also usable on their own: `src/model.js` (timing state, no DOM), `src/formats.js` (WebVTT/LRC), `src/github.js` (`openPullRequest`).

## Output

```
WEBVTT
Language: fa

l1
00:00:42.500 --> 00:00:58.200
الا یا ایها الساقی ادر کأسا و ناولها

l2
00:00:58.200 --> 00:01:21.000
که عشق آسان نمود اول ولی افتاد مشکل‌ها
```

A line ends where the next one starts, unless you tapped **Silence**, which leaves a gap with no text on screen. LRC has no end times, so gaps are written as an empty timed line.

## Develop

```sh
npm test          # node --test, no dependencies
npm run serve     # http://localhost:8000
```

`demo-tone.mp3` and `demo-lyrics.txt` are for trying it locally: `http://localhost:8000/?audio=demo-tone.mp3&lyrics=demo-lyrics.txt&lang=fa&dir=rtl`. The demo text is from a ghazal by Hafez.

To publish the page, turn on GitHub Pages for the repo (Settings → Pages → Deploy from branch → `main`, `/ (root)`).

## License

MIT
