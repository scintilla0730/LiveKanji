// Grammar helper: a small chat window where learners ask Claude about
// the grammar in the current card (or anything else about Japanese).
// It only appears when the page runs inside Claude, which provides
// window.claude. Opened as a plain file, the button stays hidden.
(function () {
  "use strict";

  let sample = null;          // Claude's ask function, once available
  let turns = [];             // this conversation: [{role, content}]
  let cardKey = "";           // which card the conversation is about
  let ctl = null;             // AbortController for the running answer
  let blocked = false;        // the viewer declined, or Claude is unavailable here

  const RULES =
    "You are a friendly Japanese teacher helping a foreigner who lives or works in Japan. " +
    "Answer in simple, clear English. Explain WHY the grammar works the way it does, not just what it means. " +
    "Whenever you write kanji, add the reading in hiragana in brackets the first time, like 曲がる(まがる). " +
    "Point out when something is casual, spoken or polite, and give the more polite or more casual version when useful. " +
    "Keep answers short: about 120 words unless the learner asks for more. " +
    "Write plain text only: no Markdown headings, bold or tables. Short lines and '-' bullets are fine.";

  // ---------- panel ----------
  const fab = document.createElement("button");
  fab.className = "grammar-fab";
  fab.type = "button";
  fab.hidden = true;
  fab.innerHTML = '<span lang="ja">文法</span> Ask grammar';
  fab.setAttribute("aria-label", "Open the grammar helper");

  const panel = document.createElement("aside");
  panel.className = "grammar";
  panel.id = "grammar";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Grammar helper");
  panel.innerHTML =
    '<div class="g-head"><div><strong>Grammar helper</strong><span>Ask anything about Japanese</span></div>' +
    '<button type="button" class="g-close" aria-label="Close">×</button></div>' +
    '<div class="g-context" hidden></div>' +
    '<div class="g-log" aria-live="polite"></div>' +
    '<div class="g-chips"></div>' +
    '<form class="g-form"><textarea id="g-input" rows="2" placeholder="Why is it 曲がって and not 曲がります?" aria-label="Your question"></textarea>' +
    '<div class="g-actions"><button type="button" class="g-new">New chat</button>' +
    '<button type="button" class="g-stop" hidden>Stop</button>' +
    '<button type="submit" class="g-send">Ask</button></div></form>';
  document.body.append(fab, panel);

  const $ = (sel) => panel.querySelector(sel);
  const log = $(".g-log"), input = $("#g-input"), form = $(".g-form");
  const sendBtn = $(".g-send"), stopBtn = $(".g-stop"), chips = $(".g-chips"), ctxBox = $(".g-context");

  function current() {
    return window.LiveKanji && window.LiveKanji.currentCard();
  }

  function contextText(cur) {
    if (!cur || !cur.card) return "";
    const c = cur.card;
    return "The learner is looking at this flash card from the \"" + cur.deck + "\" deck:\n" +
      "Word: " + c.word + " (" + c.reading + ") = " + c.meaning + "\n" +
      "Example: " + c.example + "\nReading: " + c.exampleReading + "\nTranslation: " + c.exampleEn +
      (c.tip ? "\nUsage note: " + c.tip : "");
  }

  function renderContext() {
    const cur = current();
    const key = cur && cur.card ? cur.deck + ":" + cur.card.word : "";
    if (key !== cardKey) { cardKey = key; turns = []; log.textContent = ""; }
    ctxBox.hidden = !(cur && cur.card);
    if (cur && cur.card) {
      ctxBox.textContent = "";
      const lab = document.createElement("div"); lab.className = "label"; lab.textContent = "About this sentence";
      const jp = document.createElement("p"); jp.lang = "ja"; jp.textContent = cur.card.example;
      ctxBox.append(lab, jp);
    }
    chips.textContent = "";
    if (cur && cur.card && turns.length === 0) {
      [
        "Explain the grammar of this sentence step by step",
        "Why is " + cur.card.word + " used this way here?",
        "How would I say this more politely, or more casually?"
      ].forEach((q) => {
        const b = document.createElement("button");
        b.type = "button"; b.textContent = q;
        b.addEventListener("click", () => ask(q));
        chips.append(b);
      });
    }
    if (!log.childElementCount) {
      const empty = document.createElement("p");
      empty.className = "g-empty";
      empty.textContent = "Pick a question below or type your own. Answers come from Claude.";
      log.append(empty);
    }
  }

  function bubble(role, text) {
    const empty = log.querySelector(".g-empty"); if (empty) empty.remove();
    const el = document.createElement("div");
    el.className = "g-msg " + role;
    el.textContent = text;
    log.append(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  const ERRORS = {
    rate_limited: "Too many questions at once. Wait a moment, then ask again.",
    session_expired: "Please sign in to Claude again, then ask again.",
    refused: "Claude couldn't answer that one. Try asking it a different way.",
    empty_completion: "No answer came back. Try a shorter or simpler question.",
    prompt_too_large: "This chat got too long. Tap New chat and ask again."
  };

  async function ask(question) {
    question = question.trim();
    if (!question || !sample || ctl) return;
    chips.textContent = "";
    bubble("user", question);
    turns.push({ role: "user", content: question });
    const out = bubble("assistant", "Thinking…");
    out.classList.add("pending");
    ctl = new AbortController();
    sendBtn.hidden = true; stopBtn.hidden = false;
    const recent = turns.slice(-10);
    if (recent[0].role !== "user") recent.shift();
    try {
      const { text } = await sample(
        [{ role: "user", content: RULES + "\n\n" + contextText(current()) }].concat(recent),
        { signal: ctl.signal, cache: false, onText: ({ text }) => { out.classList.remove("pending"); out.textContent = text; log.scrollTop = log.scrollHeight; } }
      );
      out.classList.remove("pending");
      out.textContent = text;
      turns.push({ role: "assistant", content: text });
    } catch (e) {
      out.classList.remove("pending");
      const code = e && e.code;
      if (code === "cancelled") { out.textContent = (e.text || "") + (e.text ? "\n\n(stopped)" : "Stopped."); }
      else if (["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed"].includes(code)) {
        out.textContent = "The grammar helper isn't available here. Claude needs your permission to answer; you can allow it from this page's permissions menu.";
        blocked = true;
      } else {
        out.textContent = (e && e.text ? e.text + "\n\n" : "") + (ERRORS[code] || "Something went wrong. Try asking again.");
        out.classList.add("error");
      }
      turns.pop(); // forget the unanswered question
    } finally {
      ctl = null;
      sendBtn.hidden = false; stopBtn.hidden = true;
      sendBtn.disabled = blocked;
    }
  }

  function open() {
    if (!sample) return;
    renderContext();
    panel.hidden = false;
    fab.hidden = true;
    input.focus({ preventScroll: true });
  }
  function close() {
    panel.hidden = true;
    fab.hidden = !sample;
  }

  fab.addEventListener("click", open);
  $(".g-close").addEventListener("click", close);
  stopBtn.addEventListener("click", () => ctl && ctl.abort());
  $(".g-new").addEventListener("click", () => { if (ctl) ctl.abort(); turns = []; log.textContent = ""; cardKey = ""; renderContext(); });
  form.addEventListener("submit", (e) => { e.preventDefault(); const q = input.value; input.value = ""; ask(q); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });

  function showButtons() {
    document.querySelectorAll(".ask-btn").forEach((b) => { b.hidden = !sample; });
    if (panel.hidden) fab.hidden = !sample;
    else renderContext();
  }
  document.addEventListener("livekanji:render", showButtons);

  window.LiveKanjiGrammar = { open };

  // Light up only when running inside Claude.
  if (window.claude && typeof window.claude.use === "function") {
    window.claude.use("sample").then((s) => {
      if (typeof s === "function") { sample = s; showButtons(); }
    }).catch(() => {});
  }
})();
