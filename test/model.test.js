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
  assert.equal(m.lines[2].start, 30);
  assert.equal(m.cursor, 3); // all timed, so nothing is lined up to be overwritten
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

test("label lines are shown but skipped when timing and exporting", () => {
  const m = SyncModel.fromText("(مولوی)\nجانا ز تو بیزار شوم؟ نی، نی، نی\n# بخش دوم\nجز با تو کسی یار شوم؟ نی، نی، نی");
  assert.deepEqual(m.lines.map((l) => l.label), [true, false, true, false]);
  assert.equal(m.cursor, 1);
  assert.equal(m.total, 2);
  m.stamp(5);
  assert.equal(m.cursor, 3);
  m.stamp(9);
  assert.ok(m.done);
  assert.deepEqual(m.cues(20).map((c) => c.index), [1, 3]);
  m.select(2);
  assert.equal(m.cursor, 3);
});

test("old saved state without label flags still loads", () => {
  const m = SyncModel.fromJSON({ lines: [{ text: "(حافظ)", start: null, end: null }, { text: "x", start: null, end: null }], cursor: 0 });
  assert.equal(m.cursor, 1);
});

test("re-timing one line in the middle returns to the first untimed line", () => {
  const m = SyncModel.fromText("a\nb\nc\nd");
  m.stamp(1); m.stamp(2); m.stamp(3);
  m.select(1);
  m.stamp(2.4);
  assert.equal(m.lines[1].start, 2.4);
  assert.equal(m.lines[2].start, 3);
  assert.equal(m.cursor, 3);
});

test("adding a silence later and removing it", () => {
  const m = SyncModel.fromText("a\nb\nc");
  m.stamp(1); m.stamp(5); m.stamp(20);
  m.silence(8); // added afterwards, after seeking back
  assert.equal(m.lines[1].end, 8);
  assert.deepEqual(m.cues(30).map((c) => [c.start, c.end]), [[1, 5], [5, 8], [20, 30]]);
  m.clearEnd(1);
  assert.equal(m.lines[1].end, null);
});

test("Markdown separators pasted from a program file are dropped", () => {
  const m = SyncModel.fromText("(مولوی)  \nجانا ز تو بیزار شوم؟ نی، نی، نی  \n\n---\n\n(صائب تبریزی)  \nمرو بیرون ز عشرت‌خانهٔ دل  \n* * *\n");
  assert.deepEqual(m.lines.map((l) => l.text), ["(مولوی)", "جانا ز تو بیزار شوم؟ نی، نی، نی", "(صائب تبریزی)", "مرو بیرون ز عشرت‌خانهٔ دل"]);
  assert.equal(m.total, 2);
});

// Program 206: the announcer reads a quatrain, then reads its last line again
// two minutes later.
const P206 = "(اوحدی مراغه‌ای)\nبر سبزه بساط می‌پرستان چه خوش است\nبر گل نفس هزاردستان چه خوش است\nای گشته به اسم هوشیاری مغرور\nتو کِی دانی که عیش مستان چه خوش است\n(رهی معیری)\nبرق غم زد آتش به جانم";

test("again: one line read a second time", () => {
  const m = SyncModel.fromText(P206);
  m.stamp(30.8); m.stamp(35.1); m.stamp(40.3); m.stamp(44.2);
  m.silence(48.9);
  m.again(4, 179.2);
  m.silence(185.9);
  m.stamp(484.3);
  assert.deepEqual(m.lines[4].repeats, [{ start: 179.2, end: 185.9 }]);
  assert.equal(m.cursor, 7);
  assert.equal(m.total, 5); // a repeat is not another line to time
  assert.deepEqual(
    m.cues(600).map((c) => [c.index, c.start, c.end, !!c.repeat]),
    [[1, 30.8, 35.1, false], [2, 35.1, 40.3, false], [3, 40.3, 44.2, false], [4, 44.2, 48.9, false],
     [4, 179.2, 185.9, true], [6, 484.3, 600, false]]
  );
  assert.equal(m.activeAt(180, 600), 4);
  assert.equal(m.activeAt(190, 600), -1);
});

test("again leaves the cursor on the first untimed line and can be undone", () => {
  const m = SyncModel.fromText("a\nb\nc");
  m.stamp(1); m.stamp(2);
  m.select(0); // tapping a line to pick it
  m.again(0, 9);
  assert.equal(m.cursor, 2);
  m.undo();
  assert.deepEqual(m.lines[0].repeats, []);
  assert.equal(m.again(0, 0.5), false); // not before the line's first time
});

test("repeatFrom copies a whole poem's timing to its reprise", () => {
  const m = SyncModel.fromText("(رهی)\na\nb\nc\n(شمس)\nd");
  m.stamp(10); m.stamp(14); m.stamp(20);
  m.silence(25);
  m.stamp(40);
  m.repeatFrom(1, 100);
  assert.deepEqual(m.lines.map((l) => l.repeats), [[], [{ start: 100, end: 104 }], [{ start: 104, end: 110 }], [{ start: 110, end: 115 }], [], []]);
  assert.equal(m.activeAt(116, 200), -1); // clears when the reprise ends
});

test("repeatFrom can start mid-poem and keeps a repeat inside the first run", () => {
  const m = SyncModel.fromText("a\nb\nc");
  m.stamp(10); m.stamp(14);
  m.again(1, 18); // b sung twice in a row
  m.stamp(22);
  m.silence(26);
  m.repeatFrom(1, 50);
  assert.deepEqual(
    m.cues(100).filter((c) => c.start >= 50).map((c) => [c.index, c.start, c.end]),
    [[1, 50, 54], [1, 54, 58], [2, 58, 62]]
  );
});

test("silence ends a repeat, and stamping after a repeat trims it", () => {
  const m = SyncModel.fromText("a\nb\nc");
  m.stamp(1); m.stamp(5);
  m.again(0, 9);
  m.silence(12);
  assert.equal(m.lines[0].repeats[0].end, 12);
  m.stamp(11);
  assert.equal(m.lines[0].repeats[0].end, 11);
});

test("clear and removeRepeat", () => {
  const m = SyncModel.fromText("a\nb");
  m.stamp(1);
  m.again(0, 5); m.again(0, 9);
  m.removeRepeat(0, 0);
  assert.deepEqual(m.lines[0].repeats.map((r) => r.start), [9]);
  m.clear(0);
  assert.deepEqual(m.lines[0].repeats, []);
});

test("applyCues: a text sung more often than written becomes repeats of its last copy", () => {
  const m = SyncModel.fromText("a\nb\nc\na");
  const unmatched = m.applyCues([
    { start: 1, end: 2, text: "a" },
    { start: 2, end: 3, text: "b" },
    { start: 3, end: 4, text: "c" },
    { start: 4, end: 5, text: "a" },
    { start: 6, end: 7, text: "b" },
    { start: 8, end: 9, text: "a" },
    { start: 9, end: 10, text: "z" },
  ]);
  assert.deepEqual(m.lines.map((l) => [l.start, l.repeats.map((r) => r.start)]), [[1, []], [2, [6]], [3, []], [4, [8]]]);
  assert.deepEqual(unmatched.map((c) => c.text), ["z"]);
});

test("VTT with repeats survives a round trip through the model", async () => {
  const { toVTT, parseVTT } = await import("../src/formats.js");
  const m = SyncModel.fromText(P206);
  m.stamp(30.8); m.stamp(35.1); m.stamp(40.3); m.stamp(44.2);
  m.silence(48.9);
  m.again(4, 179.2);
  m.silence(185.9);
  m.stamp(484.3);
  const vtt = toVTT(m.cues(600));
  const m2 = SyncModel.fromText(P206);
  m2.applyCues(parseVTT(vtt));
  assert.deepEqual(m2.cues(600), m.cues(600));
});

test("saved state with repeats round-trips through JSON", () => {
  const m = SyncModel.fromText("a\nb");
  m.stamp(1); m.again(0, 5);
  const m2 = SyncModel.fromJSON(JSON.parse(JSON.stringify(m.toJSON())));
  assert.deepEqual(m2.lines[0].repeats, [{ start: 5, end: null }]);
});
