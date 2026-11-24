// Voice: reads Japanese aloud.
// Uses the browser's built-in Japanese voice (works on phones and computers,
// no download). If the device has no Japanese voice and the page runs inside
// Claude, it falls back to Claude's voice.
(function () {
  "use strict";

  const SLOW_KEY = "livekanji:slow";
  const synth = window.speechSynthesis || null;
  let jaVoice = null;
  let voicesLoaded = false;
  let claudeTts = null;
  let slow = false;
  try { slow = localStorage.getItem(SLOW_KEY) === "1"; } catch (e) { /* storage unavailable */ }

  function pickVoice() {
    if (!synth) return;
    const voices = synth.getVoices();
    if (voices.length) voicesLoaded = true;
    const ja = voices.filter((v) => /^ja(-|_|$)/i.test(v.lang));
    // Prefer higher-quality voices when the device offers several.
    jaVoice = ja.find((v) => /google|kyoko|o-ren|siri|natural|premium|enhanced/i.test(v.name)) || ja[0] || null;
  }
  if (synth) {
    pickVoice();
    if (typeof synth.addEventListener === "function") synth.addEventListener("voiceschanged", pickVoice);
    else synth.onvoiceschanged = pickVoice;
  }

  function useBrowser() {
    // Use the built-in voice unless we know for sure it has no Japanese.
    return !!synth && (jaVoice || !voicesLoaded || !claudeTts);
  }

  function speak(text) {
    text = String(text || "").trim();
    if (!text) return;
    if (useBrowser()) {
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "ja-JP";
      if (jaVoice) u.voice = jaVoice;
      u.rate = slow ? 0.6 : 0.95;
      synth.speak(u);
    } else if (claudeTts) {
      claudeTts.speak(text, { language: "ja", rate: slow ? 0.7 : 1 }).catch(() => {});
    }
  }

  function setSlow(v) {
    slow = !!v;
    try { localStorage.setItem(SLOW_KEY, slow ? "1" : "0"); } catch (e) { /* storage unavailable */ }
  }

  window.LiveKanjiSpeech = {
    available: () => !!synth || !!claudeTts,
    speak,
    isSlow: () => slow,
    setSlow
  };

  if (window.claude && typeof window.claude.use === "function") {
    window.claude.use("tts").then((t) => {
      if (t && typeof t.speak === "function") {
        claudeTts = t;
        document.dispatchEvent(new CustomEvent("livekanji:speech-ready"));
      }
    }).catch(() => {});
  }
})();
