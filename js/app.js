// LiveKanji — first version.
// Plain JavaScript, no build step. Decks come from data/*.js.
(function () {
  "use strict";

  const DECKS = window.LIVEKANJI_DECKS || {};
  const SECTIONS = [
    { id: "everyday", label: "Everyday", jp: "日常" },
    { id: "business", label: "Business", jp: "ビジネス" },
    { id: "videos", label: "Videos", jp: "動画", soon: true }
  ];
  const STORE_KEY = "livekanji:v1";

  // ---------- saved progress (only in this browser) ----------
  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(saved)); } catch (e) { /* storage unavailable */ }
  }
  const saved = load();
  saved.marks = saved.marks || {};      // { "everyday:駅": "known" | "learning" }
  saved.pos = saved.pos || {};          // { everyday: 3 }

  const state = {
    section: "everyday",
    index: 0,
    revealed: false,
    spokenOpen: false,
    filter: "all"                       // all | learning | new
  };

  // ---------- helpers ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const markKey = (deckId, card) => deckId + ":" + card.word;
  const markOf = (deckId, card) => saved.marks[markKey(deckId, card)] || "";

  // Highlight the word inside its example sentence. For verbs and phrases
  // that change form (温める → 温めます), fall back to the kanji stem.
  function highlight(sentence, word) {
    let w = word;
    while (w.length > 0) {
      const i = sentence.indexOf(w);
      if (i >= 0) return esc(sentence.slice(0, i)) + "<mark>" + esc(w) + "</mark>" + esc(sentence.slice(i + w.length));
      if (!/[぀-ゟ]$/.test(w)) break; // only trim trailing hiragana
      w = w.slice(0, -1);
    }
    return esc(sentence);
  }

  const icon = {
    prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>',
    redo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/></svg>',
    ask: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M9.5 9.5a2.5 2.5 0 0 1 4.8 1c0 1.5-2.3 2-2.3 3.2"/><path d="M12 16.5h.01"/></svg>',
    speaker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>'
  };

  // ---------- rendering ----------
  const app = document.getElementById("app");

  function render() {
    app.innerHTML = header() + '<main><div class="wrap">' +
      (state.section === "videos" ? videosView() : deckView(DECKS[state.section])) +
      "</div></main>";
    document.dispatchEvent(new CustomEvent("livekanji:render"));
  }

  function header() {
    return '<header class="top"><div class="wrap">' +
      '<div class="brand"><span class="brand-name">Live<span>Kanji</span></span><span class="brand-jp">生きた日本語</span></div>' +
      '<nav class="tabs" role="tablist" aria-label="Sections">' +
      SECTIONS.map((s) =>
        '<button class="tab" role="tab" data-section="' + s.id + '" aria-selected="' + (state.section === s.id) + '">' +
        esc(s.label) + ' <span class="jp">' + esc(s.jp) + "</span>" + (s.soon ? '<span class="soon">soon</span>' : "") +
        "</button>").join("") +
      "</nav></div></header>";
  }

  function visibleIndexes(deck) {
    return deck.cards.map((c, i) => i).filter((i) => {
      const m = markOf(deck.id, deck.cards[i]);
      if (state.filter === "learning") return m === "learning";
      if (state.filter === "new") return !m;
      return true;
    });
  }

  function deckView(deck) {
    const total = deck.cards.length;
    const card = deck.cards[state.index];
    const known = deck.cards.filter((c) => markOf(deck.id, c) === "known").length;
    const learning = deck.cards.filter((c) => markOf(deck.id, c) === "learning").length;
    const mark = markOf(deck.id, card);
    const isLong = card.word.length > 5;

    let back = "";
    if (state.revealed) {
      back = '<div class="card-back" id="back">' +
        (card.casual ? formalBlock(card) : "<div>" + exampleLines(card) + "</div>") +
        '<button class="ask-btn" data-action="ask" hidden>' + icon.ask + "Ask about this grammar</button>" +
      "</div>";
    }

    return '<div class="deck-head" aria-label="Your progress">' +
        '<div class="progress-text"><strong>' + known + " of " + total + " known</strong>" +
        (learning ? '<span class="learning-count">' + learning + " still learning</span>" : "") + "</div>" +
        '<div class="progress" aria-hidden="true">' +
          '<div class="known" style="width:' + (known / total * 100) + '%"></div>' +
          '<div class="learning" style="width:' + (learning / total * 100) + '%"></div>' +
        "</div></div>" +
      '<div class="layout"><section aria-label="Flash card">' +
        '<div class="counter"><span>Card ' + (state.index + 1) + " of " + total + "</span><span>" + esc(card.where) + "</span></div>" +
        '<article class="card" id="card">' +
          (speech() ? '<span class="say-word">' + sayBtn(card.word, "Play the word") + "</span>" : "") +
          '<button class="card-front" data-action="flip" aria-expanded="' + state.revealed + '" aria-controls="back">' +
            '<span class="word' + (isLong ? " long" : "") + '" lang="ja">' + esc(card.word) + "</span>" +
            (state.revealed
              ? '<span class="reading" lang="ja">' + esc(card.reading) + '</span><span class="meaning">' + esc(card.meaning) + "</span>"
              : '<span class="hint">Tap to see the reading and meaning</span>') +
          "</button>" + back +
        "</article>" +
        '<div class="controls">' +
          '<button class="btn" data-action="prev" aria-label="Previous card">' + icon.prev + "</button>" +
          '<button class="btn warn" data-action="learning" aria-pressed="' + (mark === "learning") + '">' + icon.redo + "Still learning</button>" +
          '<button class="btn good" data-action="known" aria-pressed="' + (mark === "known") + '">' + icon.check + "I know it</button>" +
          '<button class="btn" data-action="next" aria-label="Next card">' + icon.next + "</button>" +
        "</div>" +
      "</section>" + listView(deck) + "</div>";
  }

  const speech = () => window.LiveKanjiSpeech && window.LiveKanjiSpeech.available() ? window.LiveKanjiSpeech : null;
  function sayBtn(text, label) {
    if (!speech()) return "";
    return '<button class="say" type="button" data-say="' + esc(text) + '" aria-label="' + esc(label || "Play audio") + '">' + icon.speaker + "</button>";
  }
  function speedBtn() {
    if (!speech()) return "";
    const slow = speech().isSlow();
    return '<button class="speed" type="button" data-action="speed" aria-pressed="' + slow + '">' + "Slow" + "</button>";
  }

  function exampleLines(card) {
    return '<div class="ex-head"><span class="label">Example</span>' + sayBtn(card.example, "Play the example sentence") + speedBtn() + "</div>" +
      '<p class="ex-jp" lang="ja">' + highlight(card.example, card.word) + "</p>" +
      '<p class="ex-kana" lang="ja">' + esc(card.exampleReading) + "</p>" +
      '<p class="ex-en">' + esc(card.exampleEn) + "</p>";
  }

  // Business cards: hover (computer) or tap (phone) the sentence
  // to see how you'd say the same thing in everyday spoken Japanese.
  function formalBlock(card) {
    return '<div class="formal' + (state.spokenOpen ? " open" : "") + '" tabindex="0" role="button" aria-expanded="' + state.spokenOpen + '" data-action="spoken">' +
      exampleLines(card) +
      '<span class="spoken-hint"><span class="on-hover">Hover over the sentence to see the everyday spoken version</span>' +
      '<span class="on-touch">' + (state.spokenOpen ? "Tap to hide the spoken version" : "Tap the sentence to see the everyday spoken version") + "</span></span>" +
      '<div class="spoken"><div class="ex-head"><span class="label">Everyday spoken version · <span lang="ja">話し言葉</span></span>' + sayBtn(card.casual, "Play the spoken version") + "</div>" +
        '<p class="ex-jp" lang="ja">' + esc(card.casual) + "</p>" +
        '<p class="ex-kana" lang="ja">' + esc(card.casualReading) + "</p>" +
        (card.casualNote ? '<p class="spoken-note">' + esc(card.casualNote) + "</p>" : "") +
      "</div></div>";
  }

  function listView(deck) {
    const idx = visibleIndexes(deck);
    const filters = [["all", "All"], ["learning", "Learning"], ["new", "New"]];
    return '<aside class="list" aria-label="All words">' +
      '<div class="list-head"><h2>Words</h2><div class="filter">' +
      filters.map(([id, label]) => '<button data-filter="' + id + '" aria-pressed="' + (state.filter === id) + '">' + label + "</button>").join("") +
      "</div></div>" +
      (idx.length === 0
        ? '<div class="empty">' + (state.filter === "learning" ? "Nothing marked “Still learning” yet." : "You've marked every word. Nice work.") + "</div>"
        : "<ul>" + idx.map((i) => {
            const c = deck.cards[i];
            const m = markOf(deck.id, c);
            return '<li><button data-goto="' + i + '" aria-current="' + (i === state.index) + '">' +
              '<span class="dot ' + m + '"></span>' +
              '<span class="li-word" lang="ja">' + esc(c.word) + "</span>" +
              '<span class="li-mean">' + esc(c.meaning) + "</span></button></li>";
          }).join("") + "</ul>") +
      "</aside>";
  }

  function videosView() {
    return '<section class="soon-panel">' +
      "<div><h1>Learn from Videos</h1>" +
      "<p>Paste a link to a short video by a Japanese creator. LiveKanji will pull out the words, show how to read them, and explain the grammar in plain English, including casual spoken forms.</p></div>" +
      '<div class="url-row"><input id="video-url" type="url" placeholder="Paste a YouTube, TikTok or Instagram link" disabled aria-label="Video link (coming soon)">' +
      '<button class="btn" disabled>Make a lesson</button></div>' +
      '<div class="sources"><span class="pill plain">YouTube</span><span class="pill plain">TikTok</span><span class="pill plain">Instagram</span><span class="pill warn">Coming soon</span></div>' +
      '<ol class="steps">' +
        "<li><strong>Get the words</strong><span>Use the video's subtitles, or listen to the audio if there are none.</span></li>" +
        "<li><strong>Show readings</strong><span>Hiragana above every kanji, with katakana words marked.</span></li>" +
        "<li><strong>Explain grammar</strong><span>Each sentence broken down in English, including slang.</span></li>" +
        "<li><strong>Save to cards</strong><span>Add new words to your own flash card deck.</span></li>" +
      "</ol>" +
      '<div class="demo"><div class="label">Example of a lesson line</div>' +
        '<p class="ex-jp" lang="ja">これめっちゃ<ruby>美味<rt>おい</rt></ruby>しいじゃん！</p>' +
        '<p class="ex-en">This is so good!</p>' +
        '<div class="tip"><div class="label">Grammar</div><strong lang="ja">めっちゃ</strong> means “really / super”. It is casual and started in Kansai. ' +
        '<strong lang="ja">〜じゃん</strong> at the end is a casual “isn’t it!”, used to share surprise or agreement with friends.</div>' +
      "</div></section>";
  }

  // ---------- actions ----------
  function setSection(id) {
    if (!SECTIONS.some((s) => s.id === id)) id = "everyday";
    state.section = id;
    state.revealed = false;
    state.spokenOpen = false;
    state.filter = "all";
    if (DECKS[id]) state.index = Math.min(saved.pos[id] || 0, DECKS[id].cards.length - 1);
    render();
  }

  function go(i) {
    const deck = DECKS[state.section];
    if (!deck) return;
    const n = deck.cards.length;
    state.index = (i + n) % n;
    state.revealed = false;
    state.spokenOpen = false;
    saved.pos[deck.id] = state.index;
    save();
    render();
  }

  function step(dir) {
    // Move within the filtered list when a filter is on.
    const deck = DECKS[state.section];
    const idx = visibleIndexes(deck);
    if (state.filter === "all" || idx.length === 0) return go(state.index + dir);
    const pos = idx.indexOf(state.index);
    const nextPos = pos === -1 ? (dir > 0 ? 0 : idx.length - 1) : (pos + dir + idx.length) % idx.length;
    go(idx[nextPos]);
  }

  function setMark(kind) {
    const deck = DECKS[state.section];
    const key = markKey(deck.id, deck.cards[state.index]);
    if (saved.marks[key] === kind) delete saved.marks[key]; else saved.marks[key] = kind;
    save();
    if (saved.marks[key]) step(1); else render();
  }

  app.addEventListener("click", (e) => {
    const sayEl = e.target.closest("[data-say]");
    if (sayEl) { speech() && speech().speak(sayEl.dataset.say); return; }
    if (e.target.closest("[data-action=speed]")) { speech() && speech().setSlow(!speech().isSlow()); render(); return; }
    if (e.target.closest(".formal")) { state.spokenOpen = !state.spokenOpen; render(); return; }
    const t = e.target.closest("button");
    if (!t) return;
    if (t.dataset.section) { location.hash = t.dataset.section; setSection(t.dataset.section); return; }
    if (t.dataset.goto) return go(Number(t.dataset.goto));
    if (t.dataset.filter) { state.filter = t.dataset.filter; render(); return; }
    switch (t.dataset.action) {
      case "flip": state.revealed = !state.revealed; state.spokenOpen = false; render(); break;
      case "prev": step(-1); break;
      case "next": step(1); break;
      case "known": setMark("known"); break;
      case "learning": setMark("learning"); break;
      case "ask": if (window.LiveKanjiGrammar) window.LiveKanjiGrammar.open("ask"); break;
    }
  });

  // Keyboard users can open the spoken version with Enter or Space.
  app.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.classList && e.target.classList.contains("formal")) {
      e.preventDefault(); state.spokenOpen = !state.spokenOpen; render();
      const el = app.querySelector(".formal"); if (el) el.focus();
    }
  });

  // Swipe left / right on the card (phones).
  let touchX = null, touchY = null;
  app.addEventListener("touchstart", (e) => {
    if (!e.target.closest("#card")) return;
    touchX = e.touches[0].clientX; touchY = e.touches[0].clientY;
  }, { passive: true });
  app.addEventListener("touchend", (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    const dy = e.changedTouches[0].clientY - touchY;
    touchX = touchY = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
  });

  // Lets the grammar helper know which card is on screen.
  window.LiveKanji = {
    currentCard() {
      const deck = DECKS[state.section];
      return deck ? { deck: deck.title, card: deck.cards[state.index] } : null;
    }
  };

  document.addEventListener("livekanji:speech-ready", render);

  window.addEventListener("hashchange", () => setSection(location.hash.slice(1)));
  setSection(location.hash.slice(1) || "everyday");
})();
