// Emergency siren generated in the browser (Web Audio), plus tab-title flash and optional notification.
// Browsers block sound until the user clicks something, so the app asks staff to press "Enable alarm sound" once.
let ctx = null, timer = null, titleTimer = null;
const BASE_TITLE = "EWS Engine";

export function enableSound() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
  playBurst(false);                             // one burst so staff can hear what the alarm sounds like
  return ctx.state === "running";
}
export const soundReady = () => !!ctx && ctx.state === "running";

// One very short, sharp beep (pager-like): sine + a quieter octave, near-instant attack and release.
function pulse(at, freq, len) {
  const g = ctx.createGain(), o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), g2 = ctx.createGain();
  o1.type = "sine"; o1.frequency.value = freq;
  o2.type = "sine"; o2.frequency.value = freq * 2; g2.gain.value = 0.18;
  const rel = Math.min(0.02, len * 0.3);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(0.42, at + 0.004);
  g.gain.setValueAtTime(0.42, at + len - rel);
  g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  o1.connect(g); o2.connect(g2); g2.connect(g); g.connect(ctx.destination);
  o1.start(at); o2.start(at); o1.stop(at + len + 0.02); o2.stop(at + len + 0.02);
}

// Hospital-pager style: a rapid run of short, high beeps, then a pause, repeating until acknowledged.
// (Original synthesised sound in the style of a pager; not a recording from any show.)
function playBurst(escalated) {
  if (!ctx) return 0;
  const t0 = ctx.currentTime + 0.05;
  const n = escalated ? 7 : 4, step = escalated ? 0.1 : 0.14, len = escalated ? 0.06 : 0.08, f = escalated ? 3000 : 2600;
  for (let i = 0; i < n; i++) pulse(t0 + i * step, f, len);
  return n * step;
}

// Escalated = more beeps, higher pitch, shorter pause.
export function startSiren(escalated) {
  stopSiren(true);
  const gap = escalated ? 0.45 : 1.3;
  const run = () => { const len = playBurst(escalated); timer = setTimeout(run, (len + gap) * 1000); };
  run();
}
export function stopSiren(keepTitle) {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!keepTitle) stopTitleFlash();
}

export function startTitleFlash(text) {
  if (titleTimer) return;
  let on = false;
  titleTimer = setInterval(() => { document.title = (on = !on) ? `🚨 ${text}` : BASE_TITLE; }, 700);
}
export function stopTitleFlash() {
  if (titleTimer) clearInterval(titleTimer);
  titleTimer = null;
  document.title = BASE_TITLE;
}

const notified = new Set();
export function notify(key, title, body) {
  if (notified.has(key) || !("Notification" in window) || Notification.permission !== "granted") return;
  notified.add(key);
  try { new Notification(title, { body, requireInteraction: true }); } catch { /* ignore */ }
}
