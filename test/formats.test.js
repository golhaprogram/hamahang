import { test } from "node:test";
import assert from "node:assert/strict";
import { toVTT, toLRC, parseVTT, formatVttTime, parseVttTime } from "../src/formats.js";
import { base64Utf8, openPullRequest } from "../src/github.js";

const cues = [
  { start: 42.5, end: 58.2, text: "الا یا ایها الساقی ادر کأسا و ناولها" },
  { start: 58.2, end: 81, text: "که عشق آسان نمود اول ولی افتاد مشکل‌ها" },
  { start: 95, end: 112.4, text: "a < b & c --> d" },
];

test("time formatting", () => {
  assert.equal(formatVttTime(3725.004), "01:02:05.004");
  assert.equal(parseVttTime("01:02:05.004"), 3725.004);
  assert.equal(parseVttTime("02:05.5"), 125.5);
});

test("VTT round trip keeps text, times and escapes", () => {
  const vtt = toVTT(cues, { lang: "fa", note: "test" });
  assert.match(vtt, /^WEBVTT\nLanguage: fa\n\nNOTE\ntest\n\n/);
  assert.match(vtt, /00:00:42\.500 --> 00:00:58\.200/);
  assert.ok(!vtt.includes("c --> d"));
  const back = parseVTT(vtt);
  assert.deepEqual(back, cues);
});

test("parseVTT ignores cue settings and inline tags", () => {
  const back = parseVTT("WEBVTT\n\n1\n00:01.000 --> 00:02.500 align:right\n<00:01.200>سلام <00:01.800>دنیا\n");
  assert.deepEqual(back, [{ start: 1, end: 2.5, text: "سلام دنیا" }]);
});

test("LRC marks gaps with an empty timed line", () => {
  const lrc = toLRC(cues);
  assert.equal(
    lrc,
    "[00:42.50]الا یا ایها الساقی ادر کأسا و ناولها\n[00:58.20]که عشق آسان نمود اول ولی افتاد مشکل‌ها\n[01:21.00]\n[01:35.00]a < b & c --> d\n[01:52.40]\n"
  );
});

test("base64Utf8 handles Persian", () => {
  assert.equal(Buffer.from(base64Utf8("گل‌ها"), "base64").toString("utf8"), "گل‌ها");
});

test("openPullRequest makes the expected API calls", async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push([opts.method, url.replace("https://api.github.com", ""), opts.body ? JSON.parse(opts.body) : null]);
    const path = url.replace("https://api.github.com", "");
    const json = (status, body) => ({ ok: status < 400, status, json: async () => body, statusText: "" });
    if (opts.method === "GET" && path === "/repos/o/r") return json(200, { default_branch: "main" });
    if (opts.method === "GET" && path.startsWith("/repos/o/r/git/ref/")) return json(200, { object: { sha: "abc" } });
    if (opts.method === "GET" && path.includes("/contents/")) return json(404, {});
    if (opts.method === "POST" && path.endsWith("/pulls")) return json(201, { html_url: "https://github.com/o/r/pull/7", number: 7 });
    return json(201, {});
  };
  const pr = await openPullRequest({ token: "t", repo: "o/r", path: "lyrics/a b/256.vtt", content: "WEBVTT\n", branch: "x", fetchImpl });
  assert.equal(pr.number, 7);
  assert.deepEqual(calls.map((c) => `${c[0]} ${c[1]}`), [
    "GET /repos/o/r",
    "GET /repos/o/r/git/ref/heads/main",
    "POST /repos/o/r/git/refs",
    "GET /repos/o/r/contents/lyrics/a%20b/256.vtt?ref=x",
    "PUT /repos/o/r/contents/lyrics/a%20b/256.vtt",
    "POST /repos/o/r/pulls",
  ]);
  assert.equal(calls[2][2].ref, "refs/heads/x");
  assert.equal(calls[4][2].message, "Add lyrics/a b/256.vtt");
  assert.equal(calls[5][2].base, "main");
});

test("openPullRequest rejects bad input", async () => {
  await assert.rejects(openPullRequest({ token: "", repo: "o/r", path: "a", content: "" }), /token/);
  await assert.rejects(openPullRequest({ token: "t", repo: "bad", path: "a", content: "" }), /repo/);
  await assert.rejects(openPullRequest({ token: "t", repo: "o/r", path: "../a", content: "" }), /path/);
});
