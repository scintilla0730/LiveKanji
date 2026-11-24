// Grammar helper: a small chat window that talks to Claude.
//   Ask:       questions about the grammar in the current card, or anything else.
//   Role-play: practise business keigo in a scene. Claude plays your boss, a
//              client or a junior colleague and gives feedback on each reply,
//              especially on humble vs. respectful forms and on how they flip
//              when you talk about your own boss to someone outside the company.
// It only appears when the page runs inside Claude, which provides
// window.claude. Opened as a plain file, the button stays hidden.
(function () {
  "use strict";

  let sample = null;          // Claude's ask function, once available
  let mode = "ask";           // "ask" | "roleplay"
  let scene = null;           // the active role-play scene
  let turns = [];             // this conversation: [{role, content}]
  let cardKey = "";           // which card an Ask conversation is about
  let ctl = null;             // AbortController for the running answer
  let blocked = false;        // the viewer declined, or Claude is unavailable here

  const ASK_RULES =
    "You are a friendly Japanese teacher helping a foreigner who lives or works in Japan. " +
    "Answer in simple, clear English. Explain WHY the grammar works the way it does, not just what it means. " +
    "Whenever you write kanji, add the reading in hiragana in brackets the first time, like 曲がる(まがる). " +
    "Point out when something is casual, spoken or polite, and give the more polite or more casual version when useful. " +
    "Keep answers short: about 120 words unless the learner asks for more. " +
    "Write plain text only: no Markdown headings, bold or tables. Short lines and '-' bullets are fine.";

  const SCENES = [
    { id: "boss", title: "Report to your boss",
      you: "a junior employee", claude: "your section manager, 鈴木課長",
      lesson: "Respectful words for what your boss does, humble words for what you do.",
      setup: "The learner is a junior employee at a Japanese company. You are 鈴木課長, their section manager. The learner needs to tell you that the client meeting report is finished and ask when you would like to look at it." },
    { id: "phone", title: "A client calls for your boss",
      you: "answering the office phone", claude: "山田さん, a client from 東西商事",
      lesson: "The flip: to outsiders, your own boss is on your side. Use humble words and drop 課長 and さん: 鈴木は外出しております.",
      setup: "The learner answers the phone at their company. You are 山田, a client from 東西商事, calling for the learner's boss 鈴木課長, who is out of the office until 3 p.m. The learner must explain this and offer a call back." },
    { id: "visit", title: "Visit a client's office",
      you: "visiting a client", claude: "the receptionist, then 佐藤部長",
      lesson: "Humble words for your own actions (伺う, 参る), respectful words for the client (いらっしゃる).",
      setup: "The learner arrives at a client's office for a 2 p.m. meeting with 佐藤部長. You first play the receptionist, then 佐藤部長 when they arrive." },
    { id: "guest", title: "A guest arrives for your boss",
      you: "greeting a visitor", claude: "a visiting client, 田中様",
      lesson: "Respectful words for the guest, humble words for your own boss: 鈴木がただいま参ります.",
      setup: "A client, 田中様, arrives at the learner's office to meet the learner's boss 鈴木課長. The learner must greet the guest, show them to the meeting room and say the boss is coming right away." },
    { id: "senior", title: "You are the boss",
      you: "the section manager", claude: "a new junior employee",
      lesson: "Hear keigo from the other side. The junior sometimes makes a keigo mistake: can you spot it?",
      setup: "Roles are flipped: the learner is the section manager and you are a new junior employee reporting on your work. Speak to the learner in keigo, but about once every two or three lines make one typical keigo mistake (for example using a humble verb for the boss's action). In Feedback, praise the learner if they spotted a mistake, and otherwise reveal your mistake and the correct form." }
  ];

  function rpRules(s) {
    return "You are running a Japanese business role-play to help a foreign learner practise keigo.\n" +
      "Scene: " + s.setup + "\n" +
      "Each of your replies has exactly two parts.\n" +
      "Part 1: your next line in the scene, in natural Japanese as your character would really say it (1 to 3 sentences). " +
      "On the next line, the same line in hiragana. On the next line, an English translation in brackets.\n" +
      "Part 2: a line starting with 'Feedback:' with short feedback in English on the learner's LAST message. Say what was good and correct any mistake, showing the corrected Japanese. " +
      "Pay special attention to whose action it is: respectful forms (尊敬語) for the other person's or a superior's actions, humble forms (謙譲語) for your own side's actions, " +
      "and remember that when talking to someone outside the company, the learner's own boss counts as the learner's side (no さん or title after the name, humble verbs). " +
      "If the learner wrote in English or romaji, show how to say it in Japanese.\n" +
      "In your very first reply, instead of Feedback write a line starting with 'Your goal:' telling the learner in one English sentence what to do.\n" +
      "Keep the scene moving and end it naturally after about 6 exchanges, then give a short summary of what the learner did well and one thing to practise.\n" +
      "Plain text only: no Markdown.";
  }

  // ---------- panel ----------
  const fab = document.createElement("button");
  fab.className = "grammar-fab";
  fab.type = "button";
  fab.hidden = true;
  fab.innerHTML = '<span lang="ja">文法</span> Grammar &amp; role-play';
  fab.setAttribute("aria-label", "Open the grammar helper");

  const panel = document.createElement("aside");
  panel.className = "grammar";
  panel.id = "grammar";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Grammar helper");
  panel.innerHTML =
    '<div class="g-head"><div class="g-modes" role="tablist">' +
      '<button type="button" role="tab" data-mode="ask" aria-selected="true">Ask</button>' +
      '<button type="button" role="tab" data-mode="roleplay" aria-selected="false">Role-play</button></div>' +
    '<button type="button" class="g-close" aria-label="Close">×</button></div>' +
    '<div class="g-context" hidden></div>' +
    '<div class="g-log" aria-live="polite"></div>' +
    '<div class="g-chips"></div>' +
    '<form class="g-form"><textarea id="g-input" rows="2" placeholder="Type your question here…" aria-label="Your message"></textarea>' +
    '<div class="g-actions"><button type="button" class="g-new">New chat</button>' +
    '<button type="button" class="g-stop" hidden>Stop</button>' +
    '<button type="submit" class="g-send">Ask</button></div></form>';
  document.body.append(fab, panel);

  const $ = (sel) => panel.querySelector(sel);
  const log = $(".g-log"), input = $("#g-input"), form = $(".g-form");
  const sendBtn = $(".g-send");
  sendBtn.disabled = true;
  const stopBtn = $(".g-stop"), chips = $(".g-chips"), ctxBox = $(".g-context"), newBtn = $(".g-new");

  function current() {
    return window.LiveKanji && window.LiveKanji.currentCard();
  }

  function contextText(cur) {
    if (!cur || !cur.card) return "";
    const c = cur.card;
    return "The learner is looking at this flash card from the \"" + cur.deck + "\" deck:\n" +
      "Word: " + c.word + " (" + c.reading + ") = " + c.meaning + "\n" +
      "Example: " + c.example + "\nReading: " + c.exampleReading + "\nTranslation: " + c.exampleEn +
      (c.tip ? "\nUsage note: " + c.tip : "") +
      (c.casual ? "\nEveryday spoken version: " + c.casual + " (" + c.casualReading + ")" : "");
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function clearChat() { turns = []; log.textContent = ""; }

  function emptyNote(text) {
    if (!log.childElementCount) log.append(el("p", "g-empty", text));
  }

  // Draw everything except the chat messages for the current mode.
  function renderPanel() {
    panel.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.mode === mode)));
    chips.textContent = "";
    ctxBox.textContent = "";
    const picking = mode === "roleplay" && !scene;   // choosing a scene: the list fills the panel
    log.hidden = picking;
    chips.classList.toggle("fill", picking);

    if (mode === "ask") {
      const cur = current();
      const key = cur && cur.card ? cur.deck + ":" + cur.card.word : "";
      if (key !== cardKey) { cardKey = key; clearChat(); }
      ctxBox.hidden = !(cur && cur.card);
      if (cur && cur.card) {
        ctxBox.append(el("div", "label", "About this sentence"));
        const jp = el("p", "", cur.card.example); jp.lang = "ja"; ctxBox.append(jp);
      }
      if (cur && cur.card && turns.length === 0) {
        [
          "Explain the grammar of this sentence step by step",
          "Why is " + cur.card.word + " used this way here?",
          "How would I say this more politely, or more casually?"
        ].forEach((q) => {
          const b = el("button", "", q); b.type = "button";
          b.addEventListener("click", () => send(q));
          chips.append(b);
        });
      }
      emptyNote("Pick a question below or type your own. Answers come from Claude.");
      input.placeholder = "Type your question here…";
      sendBtn.textContent = "Ask";
      newBtn.textContent = "New chat";
      form.hidden = false;
      return;
    }

    // Role-play
    if (!scene) {
      ctxBox.hidden = false;
      ctxBox.append(el("div", "label", "Practise business keigo"));
      ctxBox.append(el("p", "g-ctx-note", "Pick a scene. Claude plays the other person and gives feedback after each of your replies. Answer in Japanese; romaji or English is fine if you get stuck."));
      SCENES.forEach((s) => {
        const b = el("button", "g-scene"); b.type = "button";
        b.append(el("strong", "", s.title), el("span", "", "You: " + s.you + " · Claude: " + s.claude), el("em", "", s.lesson));
        b.addEventListener("click", () => startScene(s));
        chips.append(b);
      });
      form.hidden = true;
      return;
    }
    ctxBox.hidden = false;
    ctxBox.append(el("div", "label", "Role-play: " + scene.title));
    ctxBox.append(el("p", "g-ctx-note", scene.lesson));
    input.placeholder = "Reply in Japanese…";
    sendBtn.textContent = "Send";
    newBtn.textContent = "Change scene";
    form.hidden = false;
  }

  function bubble(role, text) {
    const empty = log.querySelector(".g-empty"); if (empty) empty.remove();
    const b = el("div", "g-msg " + role, text);
    log.append(b);
    log.scrollTop = log.scrollHeight;
    return b;
  }

  // In role-play, add a play button that reads the character's Japanese line.
  function addVoice(bubbleEl, text) {
    const sp = window.LiveKanjiSpeech;
    if (!sp || !sp.available()) return;
    const line = (text.split("\n").find((l) => /[぀-ヿ一-龯]/.test(l)) || "").trim();
    if (!line) return;
    const b = el("button", "g-play", "▶ Play line"); b.type = "button";
    b.addEventListener("click", () => sp.speak(line));
    bubbleEl.append(document.createElement("br"), b);
  }

  const ERRORS = {
    rate_limited: "Too many messages at once. Wait a moment, then try again.",
    session_expired: "Please sign in to Claude again, then try again.",
    refused: "Claude couldn't answer that one. Try saying it a different way.",
    empty_completion: "No answer came back. Try a shorter message.",
    prompt_too_large: "This chat got too long. Start a new one and try again."
  };

  function startScene(s) {
    if (ctl) ctl.abort();
    scene = s;
    clearChat();
    renderPanel();
    send("Start the scene.", { hidden: true });
  }

  async function send(text, opts) {
    text = String(text || "").trim();
    if (!text || !sample || ctl) return;
    const hidden = opts && opts.hidden;
    chips.textContent = "";
    if (!hidden) bubble("user", text);
    turns.push({ role: "user", content: text });
    const out = bubble("assistant", "Thinking…");
    out.classList.add("pending");
    ctl = new AbortController();
    sendBtn.hidden = true; stopBtn.hidden = false;
    const recent = turns.slice(-12);
    while (recent.length && recent[0].role !== "user") recent.shift();
    const rules = mode === "roleplay" && scene ? rpRules(scene) : ASK_RULES + "\n\n" + contextText(current());
    try {
      const { text: answer } = await sample(
        [{ role: "user", content: rules }].concat(recent),
        { signal: ctl.signal, cache: false, onText: ({ text: t }) => { out.classList.remove("pending"); out.textContent = t; log.scrollTop = log.scrollHeight; } }
      );
      out.classList.remove("pending");
      out.textContent = answer;
      if (mode === "roleplay") addVoice(out, answer);
      turns.push({ role: "assistant", content: answer });
    } catch (e) {
      out.classList.remove("pending");
      const code = e && e.code;
      if (code === "cancelled") { out.textContent = (e.text || "") + (e.text ? "\n\n(stopped)" : "Stopped."); }
      else if (["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed"].includes(code)) {
        out.textContent = "The helper isn't available here. Claude needs your permission to answer; you can allow it from this page's permissions menu.";
        blocked = true;
      } else {
        out.textContent = (e && e.text ? e.text + "\n\n" : "") + (ERRORS[code] || "Something went wrong. Try again.");
        out.classList.add("error");
      }
      turns.pop(); // forget the unanswered message
    } finally {
      ctl = null;
      sendBtn.hidden = false; stopBtn.hidden = true;
      updateSend();
    }
  }

  function open(which) {
    if (!sample) return;
    if (which && which !== mode) setMode(which);
    renderPanel();
    panel.hidden = false;
    fab.hidden = true;
    if (!form.hidden) input.focus({ preventScroll: true });
  }
  function close() {
    panel.hidden = true;
    fab.hidden = !sample;
  }
  function setMode(m) {
    if (ctl) ctl.abort();
    mode = m;
    scene = null;
    cardKey = "";
    clearChat();
    renderPanel();
  }

  // Send is only clickable once something is typed.
  function updateSend() { sendBtn.disabled = blocked || !!ctl || !input.value.trim(); }
  input.addEventListener("input", updateSend);

  fab.addEventListener("click", () => open());
  $(".g-close").addEventListener("click", close);
  panel.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
  stopBtn.addEventListener("click", () => ctl && ctl.abort());
  newBtn.addEventListener("click", () => {
    if (ctl) ctl.abort();
    if (mode === "roleplay") scene = null;
    cardKey = "";
    clearChat();
    renderPanel();
  });
  form.addEventListener("submit", (e) => { e.preventDefault(); const q = input.value; input.value = ""; updateSend(); send(q); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });

  function showButtons() {
    document.querySelectorAll(".ask-btn").forEach((b) => { b.hidden = !sample; });
    if (panel.hidden) fab.hidden = !sample;
    else if (mode === "ask") renderPanel();
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
