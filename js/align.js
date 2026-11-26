// Lines up a Japanese sentence with its kana reading, piece by piece,
// so hovering a word (e.g. 内側) can highlight its reading (うちがわ).
//
// How: the sentence is split into runs. Kana and punctuation appear the same
// in both lines, so they act as anchors. Runs of kanji, numbers or Latin
// letters need a reading, and get whatever kana sits between the anchors.
(function () {
  "use strict";

  const NEEDS_READING = /[㐀-鿿豈-﫿々〆ヶA-Za-z0-9Ａ-Ｚａ-ｚ０-９]/;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  function runs(sentence) {
    const out = [];
    for (const ch of sentence) {
      const k = NEEDS_READING.test(ch);
      const last = out[out.length - 1];
      if (last && last.k === k) last.text += ch; else out.push({ text: ch, k });
    }
    return out;
  }

  // Returns [{text, reading, k}] or null when the two lines don't line up.
  function align(sentence, reading) {
    const rs = runs(sentence);
    // Work on the reading without spaces, but remember where each kept
    // character was in the original so the spaces can be put back.
    const kept = [], pos = [];
    Array.from(reading).forEach((ch, i) => { if (!/\s/.test(ch)) { kept.push(ch); pos.push(i); } });
    const flat = kept.join("");
    const chars = Array.from(reading);
    // Try matching shortest-first and longest-first, keep the more natural split.
    let best = null, bestScore = null;
    for (const q of ["(.+?)", "(.+)"]) {
      const re = new RegExp("^" + rs.map((r) => r.k ? q : "(" + reEsc(r.text) + ")").join("") + "$", "u");
      const m = flat.match(re);
      if (!m) continue;
      let at = 0;
      const parts = rs.map((r, i) => {
        const len = Array.from(m[i + 1]).length;
        const from = pos[at], to = pos[at + len - 1];
        at += len;
        return { text: r.text, k: r.k, reading: chars.slice(from, to + 1).join(""), gapAfter: at < pos.length ? chars.slice(to + 1, pos[at]).join("") : "" };
      });
      const score = scoreOf(parts);
      if (!best || score[0] < bestScore[0] || (score[0] === bestScore[0] && score[1] < bestScore[1])) { best = parts; bestScore = score; }
    }
    return best;
  }

  // Lower is better: readings that cross a word gap, then the longest
  // reading per character (one kanji rarely reads as more than 3-4 kana).
  function scoreOf(parts) {
    let gaps = 0, ratio = 0;
    parts.forEach((p) => {
      if (!p.k) return;
      if (/\s/.test(p.reading)) gaps++;
      ratio = Math.max(ratio, p.reading.replace(/\s/g, "").length / Array.from(p.text).length);
    });
    return [gaps, ratio];
  }

  // Where the highlighted card word sits in the sentence (verbs may be
  // conjugated, so fall back to the kanji stem: 温める → 温めます).
  function targetRange(sentence, word) {
    let w = word || "";
    while (w.length > 0) {
      const i = sentence.indexOf(w);
      if (i >= 0) return [i, i + w.length];
      if (!/[぀-ゟ]$/.test(w)) break;
      w = w.slice(0, -1);
    }
    return null;
  }

  // HTML for both lines. Pieces share data-seg numbers so the page can
  // highlight a word and its reading together.
  function render(sentence, reading, word, pair) {
    const parts = align(sentence, reading);
    const range = targetRange(sentence, word);
    if (!parts) {
      // Couldn't line them up: plain text, with the card word marked.
      const s = range ? esc(sentence.slice(0, range[0])) + "<mark>" + esc(sentence.slice(range[0], range[1])) + "</mark>" + esc(sentence.slice(range[1])) : esc(sentence);
      return { sentence: s, reading: esc(reading) };
    }
    let off = 0;
    const s = [], r = [];
    parts.forEach((p, i) => {
      const start = off, end = off + p.text.length;
      off = end;
      const target = range && start < range[1] && end > range[0];
      const cls = "seg" + (p.k ? " k" : "") + (target ? " target" : "");
      const attrs = ' class="' + cls + '" data-pair="' + pair + '" data-seg="' + i + '"';
      s.push("<span" + attrs + (p.k ? ' tabindex="-1"' : "") + ">" + esc(p.text) + "</span>");
      r.push("<span" + attrs + ">" + esc(p.reading) + "</span>" + esc(p.gapAfter));
    });
    return { sentence: s.join(""), reading: r.join("") };
  }

  window.LiveKanjiAlign = { align, render };
})();
