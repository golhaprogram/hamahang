import { test } from "node:test";
import assert from "node:assert/strict";
import { SyncModel, parseLines } from "../src/model.js";

const TEXT = "الا یا ایها الساقی ادر کأسا و ناولها\n\nکه عشق آسان نمود اول ولی افتاد مشکل‌ها\nبه بوی نافه‌ای کاخر صبا زان طره بگشاید\n";

test("parseLines drops blank lines and trims", () => {
  const lines = parseLines(TEXT);
  assert.equal(lines.length, 3);
  assert.equal(lines[1].text, "که عشق آسان نمود اول ولی افتاد مشکل‌ها");
});

test("stamp advances the cursor and ends at next start", () => {
  const m = SyncModel.fromText(TEXT);
  m.stamp(10);
  m.stamp(20);
  m.stamp(30);
  assert.equal(m.cursor, 3);
  assert.ok(m.done);
  assert.deepEqual(
    m.cues(40).map((c) => [c.start, c.end]),
    [[10, 20], [20, 30], [30, 40]]
  );
});

test("silence ends the current line and leaves a gap", () => {
  const m = SyncModel.fromText(TEXT);
  m.stamp(10);
  m.silence(15);
  m.stamp(25);
  const cues = m.cues(60);
  assert.deepEqual([cues[0].start, cues[0].end], [10, 15]);
  assert.deepEqual([cues[1].start, cues[1].end], [25, 60]);
});

test("undo restores the previous state", () => {
  const m = SyncModel.fromText(TEXT);
  m.stamp(10);
  m.stamp(20);
  m.undo();
  assert.equal(m.cursor, 1);
  assert.equal(m.lines[1].start, null);
});

test("re-timing a selected line", () => {
  const m = SyncModel.fromText(TEXT);
  m.stamp(10);
  m.stamp(20);
  m.stamp(30);
  m.select(1);
  m.stamp(21.5);
  assert.equal(m.lines[1].start, 21.5);
  assert.equal(m.cursor, 2);
});

test("restamping earlier truncates an explicit end that would overlap", () => {
  const m = SyncModel.fromText(TEXT);
  m.stamp(10);
  m.silence(18);
  m.stamp(16);
  assert.equal(m.lines[0].end, 16);
});

test("nudge and clear", () => {
  const m = SyncModel.fromText(TEXT);
  m.stamp(10);
  m.nudge(0, -0.25);
  assert.equal(m.lines[0].start, 9.75);
  m.clear(0);
  assert.equal(m.lines[0].start, null);
  assert.equal(m.cursor, 0);
});

test("activeAt finds the line on screen", () => {
  const m = SyncModel.fromText(TEXT);
  m.stamp(10);
  m.silence(15);
  m.stamp(25);
  assert.equal(m.activeAt(12, 60), 0);
  assert.equal(m.activeAt(20, 60), -1);
  assert.equal(m.activeAt(30, 60), 1);
});

test("JSON round trip", () => {
  const m = SyncModel.fromText(TEXT);
  m.stamp(10);
  const m2 = SyncModel.fromJSON(JSON.parse(JSON.stringify(m.toJSON())));
  assert.equal(m2.cursor, 1);
  assert.equal(m2.lines[0].start, 10);
});

test("applyCues matches text, ignoring ZWNJ and Arabic ye/kaf", () => {
  const m = SyncModel.fromText(TEXT);
  m.applyCues([
    { start: 5, end: 9, text: "الا يا ايها الساقي ادر كأسا و ناولها" },
    { start: 12, end: 14, text: "به بوی نافه ای کاخر صبا زان طره بگشاید" },
  ]);
  assert.equal(m.lines[0].start, 5);
  assert.equal(m.lines[1].start, null);
  assert.equal(m.lines[2].start, 12);
  assert.equal(m.cursor, 1);
});
