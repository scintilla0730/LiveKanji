// 语法助手：一个和 Claude 对话的小窗口。
//   提问：    针对当前卡片里的语法提问，或问任何日语问题。
//   角色扮演：在职场场景里练习商务敬语。Claude 扮演你的上司、客户或新人，
//             每次回复后给出点评，重点是谦让语和尊敬语，以及对外提到自己上司时
//             两者如何“翻转”。
// 只有在 Claude 里打开页面时才会出现（需要 window.claude）。
// 直接打开文件时，按钮保持隐藏。
(function () {
  "use strict";

  let sample = null;          // Claude 的提问函数（可用时）
  let mode = "ask";           // "ask" | "roleplay"
  let scene = null;           // 当前角色扮演场景
  let turns = [];             // 本次对话：[{role, content}]
  let cardKey = "";           // 提问对话对应的卡片
  let ctl = null;             // 正在进行的回答的 AbortController
  let blocked = false;        // 用户拒绝授权，或这里无法使用 Claude

  // 给 Claude 的指示用英文写（更稳定），但要求它用简体中文回答。
  const ASK_RULES =
    "You are a friendly Japanese teacher helping a Chinese-speaking learner who lives or works in Japan. " +
    "Answer in Simplified Chinese (简体中文). Explain WHY the grammar works the way it does, not just what it means. " +
    "You may compare with Chinese when it helps, and point out where a kanji word means something different in Chinese (false friends). " +
    "Whenever you write Japanese with kanji, add the reading in hiragana in brackets the first time, like 曲がる(まがる). " +
    "Point out when something is casual, spoken or polite, and give the more polite or more casual version when useful. " +
    "Keep answers short: about 200 Chinese characters unless the learner asks for more. " +
    "Write plain text only: no Markdown headings, bold or tables. Short lines and '-' bullets are fine.";

  const SCENES = [
    { id: "boss", title: "向上司汇报",
      you: "新员工", claude: "你的课长 鈴木課長",
      lesson: "上司的动作用尊敬语，自己的动作用谦让语。",
      setup: "The learner is a junior employee at a Japanese company. You are 鈴木課長, their section manager. The learner needs to tell you that the client meeting report is finished and ask when you would like to look at it." },
    { id: "phone", title: "客户打电话找你的上司",
      you: "接公司电话", claude: "东西商事的客户 山田さん",
      lesson: "翻转：对公司外部的人，自己的上司算“自己人”。要用谦让语，并去掉「課長」和「さん」：鈴木は外出しております。",
      setup: "The learner answers the phone at their company. You are 山田, a client from 東西商事, calling for the learner's boss 鈴木課長, who is out of the office until 3 p.m. The learner must explain this and offer a call back." },
    { id: "visit", title: "拜访客户公司",
      you: "去拜访客户", claude: "前台，然后是 佐藤部長",
      lesson: "自己的动作用谦让语（伺う、参る），客户的动作用尊敬语（いらっしゃる）。",
      setup: "The learner arrives at a client's office for a 2 p.m. meeting with 佐藤部長. You first play the receptionist, then 佐藤部長 when they arrive." },
    { id: "guest", title: "客人来找你的上司",
      you: "接待来访客人", claude: "来访的客户 田中様",
      lesson: "对客人用尊敬语，对自己的上司用谦让语：鈴木がただいま参ります。",
      setup: "A client, 田中様, arrives at the learner's office to meet the learner's boss 鈴木課長. The learner must greet the guest, show them to the meeting room and say the boss is coming right away." },
    { id: "senior", title: "你来当上司",
      you: "课长", claude: "刚入职的新人",
      lesson: "站在另一边听敬语。新人偶尔会用错敬语，你能发现吗？",
      setup: "Roles are flipped: the learner is the section manager and you are a new junior employee reporting on your work. Speak to the learner in keigo, but about once every two or three lines make one typical keigo mistake (for example using a humble verb for the boss's action). In 点评, praise the learner if they spotted a mistake, and otherwise reveal your mistake and the correct form." }
  ];

  function rpRules(s) {
    return "You are running a Japanese business role-play to help a Chinese-speaking learner practise keigo.\n" +
      "Scene: " + s.setup + "\n" +
      "Each of your replies has exactly two parts.\n" +
      "Part 1: your next line in the scene, in natural Japanese as your character would really say it (1 to 3 sentences). " +
      "On the next line, the same line in hiragana. On the next line, a Simplified Chinese translation in brackets.\n" +
      "Part 2: a line starting with '点评：' with short feedback in Simplified Chinese on the learner's LAST message. Say what was good and correct any mistake, showing the corrected Japanese. " +
      "Pay special attention to whose action it is: respectful forms (尊敬語) for the other person's or a superior's actions, humble forms (謙譲語) for your own side's actions, " +
      "and remember that when talking to someone outside the company, the learner's own boss counts as the learner's side (no さん or title after the name, humble verbs). " +
      "If the learner wrote in Chinese or romaji, show how to say it in Japanese.\n" +
      "In your very first reply, instead of 点评 write a line starting with '你的任务：' telling the learner in one Simplified Chinese sentence what to do.\n" +
      "Keep the scene moving and end it naturally after about 6 exchanges, then give a short summary in Simplified Chinese of what the learner did well and one thing to practise.\n" +
      "Plain text only: no Markdown.";
  }

  // ---------- panel ----------
  const fab = document.createElement("button");
  fab.className = "grammar-fab";
  fab.type = "button";
  fab.hidden = true;
  fab.innerHTML = '<span lang="ja">文法</span> 语法 · 角色扮演';
  fab.setAttribute("aria-label", "打开语法助手");

  const panel = document.createElement("aside");
  panel.className = "grammar";
  panel.id = "grammar";
  panel.hidden = true;
  panel.setAttribute("aria-label", "语法助手");
  panel.innerHTML =
    '<div class="g-head"><div class="g-modes" role="tablist">' +
      '<button type="button" role="tab" data-mode="ask" aria-selected="true">提问</button>' +
      '<button type="button" role="tab" data-mode="roleplay" aria-selected="false">角色扮演</button></div>' +
    '<div class="g-tools"><button type="button" class="g-size" aria-label="放大窗口" aria-pressed="false"></button>' +
    '<button type="button" class="g-close" aria-label="关闭">×</button></div></div>' +
    '<div class="g-context" hidden></div>' +
    '<div class="g-log" aria-live="polite"></div>' +
    '<div class="g-chips"></div>' +
    '<form class="g-form"><textarea id="g-input" rows="2" placeholder="在这里输入你的问题…" aria-label="你的消息"></textarea>' +
    '<div class="g-actions"><button type="button" class="g-new">新对话</button>' +
    '<button type="button" class="g-stop" hidden>停止</button>' +
    '<button type="submit" class="g-send">提问</button></div></form>';
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
      "Example: " + c.example + "\nReading: " + c.exampleReading + "\nChinese translation: " + c.translation +
      (c.tip ? "\nUsage note: " + c.tip : "") +
      (c.casual ? "\nEveryday spoken version: " + c.casual + " (" + c.casualReading + ")" + (c.casualNote ? " — " + c.casualNote : "") : "");
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
        ctxBox.append(el("div", "label", "关于这句"));
        const jp = el("p", "", cur.card.example); jp.lang = "ja"; ctxBox.append(jp);
      }
      if (cur && cur.card && turns.length === 0) {
        [
          "一步一步讲解这句的语法",
          "这里为什么用「" + cur.card.word + "」？",
          "这句话更礼貌或更随意的说法是什么？"
        ].forEach((q) => {
          const b = el("button", "", q); b.type = "button";
          b.addEventListener("click", () => send(q));
          chips.append(b);
        });
      }
      emptyNote("选一个下面的问题，或者自己输入。回答来自 Claude。");
      input.placeholder = "在这里输入你的问题…";
      sendBtn.textContent = "提问";
      newBtn.textContent = "新对话";
      form.hidden = false;
      return;
    }

    // Role-play
    if (!scene) {
      ctxBox.hidden = false;
      ctxBox.append(el("div", "label", "练习商务敬语"));
      ctxBox.append(el("p", "g-ctx-note", "选一个场景。Claude 扮演对方，你每回复一句都会给出点评。请用日语回答；卡住时也可以用中文或罗马字。"));
      SCENES.forEach((s) => {
        const b = el("button", "g-scene"); b.type = "button";
        b.append(el("strong", "", s.title), el("span", "", "你：" + s.you + " · Claude：" + s.claude), el("em", "", s.lesson));
        b.addEventListener("click", () => startScene(s));
        chips.append(b);
      });
      form.hidden = true;
      return;
    }
    ctxBox.hidden = false;
    ctxBox.append(el("div", "label", "角色扮演：" + scene.title));
    ctxBox.append(el("p", "g-ctx-note", scene.lesson));
    input.placeholder = "用日语回复…";
    sendBtn.textContent = "发送";
    newBtn.textContent = "换场景";
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
    const b = el("button", "g-play", "▶ 播放这句"); b.type = "button";
    b.addEventListener("click", () => sp.speak(line));
    bubbleEl.append(document.createElement("br"), b);
  }

  const ERRORS = {
    rate_limited: "消息发得太频繁了，请稍等再试。",
    session_expired: "请重新登录 Claude 后再试。",
    refused: "Claude 无法回答这个问题，换个说法试试。",
    empty_completion: "没有收到回答，试试更短的消息。",
    prompt_too_large: "对话太长了，请开始新对话再试。"
  };

  function startScene(s) {
    if (ctl) ctl.abort();
    scene = s;
    clearChat();
    renderPanel();
    send("开始这个场景。", { hidden: true });
  }

  async function send(text, opts) {
    text = String(text || "").trim();
    if (!text || !sample || ctl) return;
    const hidden = opts && opts.hidden;
    chips.textContent = "";
    if (!hidden) bubble("user", text);
    turns.push({ role: "user", content: text });
    const out = bubble("assistant", "思考中…");
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
      if (code === "cancelled") { out.textContent = (e.text || "") + (e.text ? "\n\n（已停止）" : "已停止。"); }
      else if (["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed"].includes(code)) {
        out.textContent = "这里暂时无法使用助手。Claude 需要你的授权才能回答，可以在页面的权限菜单里允许。";
        blocked = true;
      } else {
        out.textContent = (e && e.text ? e.text + "\n\n" : "") + (ERRORS[code] || "出了点问题，请再试一次。");
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

  // Bigger / smaller window. The choice is remembered on this device.
  const SIZE_KEY = "livekanji:helper-big";
  const sizeBtn = $(".g-size");
  const ICON_BIG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>';
  const ICON_SMALL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="M14 10l7-7"/><path d="M3 21l7-7"/></svg>';
  function setBig(big) {
    panel.classList.toggle("big", big);
    sizeBtn.innerHTML = big ? ICON_SMALL : ICON_BIG;
    sizeBtn.setAttribute("aria-pressed", String(big));
    sizeBtn.setAttribute("aria-label", big ? "缩小窗口" : "放大窗口");
    sizeBtn.title = big ? "缩小窗口" : "放大窗口";
    try { localStorage.setItem(SIZE_KEY, big ? "1" : "0"); } catch (e) { /* storage unavailable */ }
  }
  let startBig = false;
  try { startBig = localStorage.getItem(SIZE_KEY) === "1"; } catch (e) { /* storage unavailable */ }
  setBig(startBig);
  sizeBtn.addEventListener("click", () => setBig(!panel.classList.contains("big")));
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
