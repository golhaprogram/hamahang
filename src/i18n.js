const STRINGS = {
  en: {
    stamp: "This line",
    silence: "Silence",
    undo: "Undo",
    sync: "Sync",
    preview: "Preview",
    speed: "Speed",
    done: "All lines timed",
    next: "Next",
    clear: "Clear",
    hint: "Play, then tap “This line” as each line starts. Tap “Silence” when the singing stops before an instrumental part. Tap a line to re-time it.",
    keys: "Keys: Space = this line · S = silence · Z = undo · ←/→ = 3s (Shift: 10s) · P = play/pause",
  },
  fa: {
    stamp: "این خط",
    silence: "سکوت",
    undo: "برگرد",
    sync: "زمان‌بندی",
    preview: "پیش‌نمایش",
    speed: "سرعت",
    done: "همهٔ خط‌ها زمان‌بندی شدند",
    next: "بعدی",
    clear: "پاک کن",
    hint: "پخش را بزنید و با شروع هر خط «این خط» را بزنید. وقتی آواز پیش از ساز تمام شد «سکوت» را بزنید. برای زمان‌بندی دوباره، روی خط بزنید.",
    keys: "کلیدها: فاصله = این خط · S = سکوت · Z = برگرد · ←/→ = ۳ ثانیه (با Shift: ۱۰) · P = پخش/مکث",
  },
};

export function strings(lang) {
  const key = String(lang || "").toLowerCase().startsWith("fa") ? "fa" : "en";
  return STRINGS[key];
}
