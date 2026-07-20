"use client";

/** Speak a short phrase aloud via the browser's SpeechSynthesis API. Silently
 * no-ops if unsupported — never lets a voice-alert feature break the page. */
export function speak(text: string, opts?: { volume?: number; rate?: number; pitch?: number }) {
  try {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const msg = new SpeechSynthesisUtterance(text);
    msg.volume = opts?.volume ?? 0.85;
    msg.rate = opts?.rate ?? 1.0;
    msg.pitch = opts?.pitch ?? 1.1;
    window.speechSynthesis.speak(msg);
  } catch {
    // speechSynthesis not available — ignore
  }
}
