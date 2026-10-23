/**
 * 英语 B 级学习工作台 · 核心逻辑
 * 进度存储：localStorage；导入/导出：JSON 文件。
 */
(function () {
  "use strict";

  var QUESTIONS = window.ENGLISH_B_QUESTIONS || [];
  var WORDS = window.ENGLISH_B_WORDS || [];
  var MORPH = window.WordBreakdown || null;
  var PRESETS = window.ENGLISH_B_PRESETS || {};
  var STORAGE_KEY = "english-b-level-progress-v1";

  // 把词库注入拆解引擎，让它能判断「某个片段是不是真实单词」
  if (MORPH && typeof MORPH.setWordList === "function") {
    MORPH.setWordList(WORDS);
  }

  var MODULES = [
    { key: "vocabulary",  name: "词汇",           emoji: "🔤" },
    { key: "grammar",     name: "语法",           emoji: "📐" },
    { key: "reading",     name: "阅读理解",       emoji: "📖" },
    { key: "translation", name: "翻译（英译汉）", emoji: "🈶" },
    { key: "writing",     name: "写作（汉译英）", emoji: "✍️" },
    { key: "listening",   name: "听力理解",       emoji: "🎧" }
  ];

  var TIERS = [
    { key: "core",  name: "高频核心词", emoji: "🔥" },
    { key: "basic", name: "基础必备词", emoji: "📗" }
  ];

  // ---- 进度数据结构 ----
  // progress = {
  //   modules: { [key]: { attempted, correct, lastScore, lastAt } },
  //   wrongBook: [ { qid, wrongAt, timesWrong } ],
  //   words: { [word]: { status: "known"|"unknown", seen, lastAt } }
  //   notes: { [word]: { text, links: [word], updatedAt } }
  // }

  function defaultProgress() {
    var modules = {};
    MODULES.forEach(function (m) {
      modules[m.key] = { attempted: 0, correct: 0, lastScore: 0, lastAt: null };
    });
    return { modules: modules, wrongBook: [], words: {}, notes: {} };
  }

  function loadProgress() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultProgress();
      var p = JSON.parse(raw);
      // 兼容合并：保证每个模块字段存在
      if (!p.modules) p.modules = {};
      MODULES.forEach(function (m) {
        if (!p.modules[m.key]) p.modules[m.key] = { attempted: 0, correct: 0, lastScore: 0, lastAt: null };
      });
      if (!p.wrongBook) p.wrongBook = [];
      // 旧版本存档没有 words 字段，补齐以兼容导入
      if (!p.words || typeof p.words !== "object") p.words = {};
      if (!p.notes || typeof p.notes !== "object") p.notes = {};
      return p;
    } catch (e) {
      return defaultProgress();
    }
  }

  function saveProgress(p) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  }

  // ---- 状态 ----
  var state = {
    progress: loadProgress(),
    mode: "practice",        // practice | words | review | stats
    activeModule: "vocabulary",
    // 当前练习会话（一轮的题目集合）
    session: [],             // 当前一轮的题目（已打乱，取前 N 题）
    sessionIndex: 0,
    sessionCorrect: 0,
    // 错题批
    reviewQueue: [],
    reviewIndex: 0,
    reviewCorrect: 0,
    // 记录本轮作答（用于错题本，写作/翻译不自动批量）
    completedIds: {},
    // 背单词
    wordTier: "core",
    wordQueue: [],
    wordIndex: 0,
    wordFlipped: false,
    wordKnownCount: 0,
    wordUnknownCount: 0,
    autoSpeak: true            // 进入单词卡自动朗读
  };

  // ---- DOM 引用 ----
  var el = {
    moduleNav: document.getElementById("module-nav"),
    overview: document.getElementById("overview"),
    modeBtns: Array.prototype.slice.call(document.querySelectorAll(".mode-btn")),
    practiceView: document.getElementById("practice-view"),
    wordsView: document.getElementById("words-view"),
    reviewView: document.getElementById("review-view"),
    statsView: document.getElementById("stats-view"),
    exportBtn: document.getElementById("export-btn"),
    importBtn: document.getElementById("import-btn"),
    importFile: document.getElementById("import-file"),
    resetBtn: document.getElementById("reset-btn"),
    toast: document.getElementById("toast"),
    sidebar: document.getElementById("sidebar"),
    sidebarToggle: document.getElementById("sidebar-toggle")
  };

  // ---- 工具 ----
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function byId(id) { return QUESTIONS.filter(function (q) { return q.id === id; })[0]; }
  function moduleQuestions(key) { return QUESTIONS.filter(function (q) { return q.type === key; }); }
  function nowStr() { return new Date().toISOString(); }

  var toastTimer;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.hidden = true; }, 2200);
  }

  // ---- 渲染：侧边栏与概览 ----
  function renderSidebar() {
    el.moduleNav.innerHTML = "";
    MODULES.forEach(function (m) {
      var qs = moduleQuestions(m.key);
      var item = document.createElement("div");
      item.className = "module-item" + (m.key === state.activeModule ? " active" : "");
      item.innerHTML =
        '<span class="module-emoji">' + m.emoji + '</span>' +
        '<span class="module-name">' + escapeHtml(m.name) + '</span>' +
        '<span class="module-count">' + qs.length + '题</span>';
      item.addEventListener("click", function () {
        state.activeModule = m.key;
        renderSidebar();
        renderOverview();
        if (state.mode === "practice") renderPractice();
        collapseSidebarOnMobile(); // 手机端选完自动收起
      });
      el.moduleNav.appendChild(item);
    });
  }

  function renderOverview() {
    var p = state.progress;
    var totalAttempted = 0, totalCorrect = 0;
    var html = "";
    MODULES.forEach(function (m) {
      var mod = p.modules[m.key];
      totalAttempted += mod.attempted;
      totalCorrect += mod.correct;
      var acc = mod.attempted ? Math.round(mod.correct / mod.attempted * 100) : 0;
      html += '<div class="overview-row"><span>' + m.emoji + ' ' + escapeHtml(m.name) + '</span><b>' + acc + '%</b></div>';
    });
    // 背单词概览
    var known = 0, seen = 0;
    WORDS.forEach(function (w) {
      var rec = p.words[w.w];
      if (rec) { seen++; if (rec.status === "known") known++; }
    });
    html = '<div class="overview-row"><span>总作答</span><b>' + totalAttempted + ' 题</b></div>' +
           '<div class="overview-row"><span>错题本</span><b>' + p.wrongBook.length + ' 题</b></div>' +
           '<div class="overview-row"><span>已背单词</span><b>' + known + ' / ' + WORDS.length + '</b></div>' +
           html;
    el.overview.innerHTML = html;
  }

  // ---- 模式切换 ----
  function switchMode(mode) {
    state.mode = mode;
    el.modeBtns.forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-mode") === mode);
    });
    el.practiceView.hidden = mode !== "practice";
    el.wordsView.hidden = mode !== "words";
    el.reviewView.hidden = mode !== "review";
    el.statsView.hidden = mode !== "stats";
    if (mode === "practice") { renderPractice(); }
    else if (mode === "words") { renderWordsSetup(); }
    else if (mode === "review") { startReview(); }
    else { renderStats(); }
  }

  // ===================== 专项练习 =====================
  function renderPractice() {
    var m = MODULES.filter(function (x) { return x.key === state.activeModule; })[0];
    var qs = moduleQuestions(state.activeModule);
    state.session = shuffle(qs);
    state.sessionIndex = 0;
    state.sessionCorrect = 0;
    state.completedIds = {};

    var head =
      '<div class="module-head">' +
        '<div><h2>' + m.emoji + ' ' + escapeHtml(m.name) + '</h2>' +
        '<p class="desc">' + bankHint(state.activeModule) + ' 共 ' + qs.length + ' 题</p></div>' +
        '<div class="settings-bar" style="margin:0;padding:8px 12px;">' +
          '<label>本轮题数</label>' +
          '<select id="batch-size">' +
            '<option value="' + qs.length + '" selected>全部（' + qs.length + '）</option>' +
            (qs.length > 5 ? '<option value="5">5 题</option>' : '') +
            (qs.length > 10 ? '<option value="10">10 题</option>' : '') +
          '</select>' +
        '</div></div>';

    el.practiceView.innerHTML = head + '<div id="quiz-body"></div>';
    document.getElementById("batch-size").addEventListener("change", renderPractice);
    var batchSize = parseInt(document.getElementById("batch-size").value, 10);
    state.session = state.session.slice(0, batchSize);
    renderQuestion();
  }

  function bankHint(key) {
    var map = {
      vocabulary: "B级词汇 2500 词范围，选词填空与词义辨析。",
      grammar: "B级语法结构表：时态、非谓语、从句、情态动词等。",
      reading: "一般性阅读 + 应用文，总阅读量约 800 词。",
      translation: "句子与段落英译汉，一般性约 60%、实用性约 40%。",
      writing: "套写应用性短文、填表、翻译简短实用文字。",
      listening: "语速约 100 词/分钟，日常与简单业务交际。"
    };
    return map[key] || "";
  }

  function renderQuestion() {
    if (!state.session.length) {
      el.practiceView.querySelector("#quiz-body").innerHTML =
        '<div class="review-empty"><div class="big">📭</div>该模块暂无题目。</div>';
      return;
    }
    if (state.sessionIndex >= state.session.length) {
      renderSessionResult();
      return;
    }
    var q = state.session[state.sessionIndex];
    var body = document.getElementById("quiz-body");
    body.innerHTML = "";

    // 进度条
    var idx = state.sessionIndex + 1;
    var total = state.session.length;
    body.appendChild(progressBar(idx, total));

    var card = document.createElement("div");
    card.className = "question-card";
    card.appendChild(questionMeta(q));
    if (q.stem) {
      var stem = document.createElement("div");
      stem.className = "q-stem";
      stem.textContent = q.stem;
      card.appendChild(stem);
    }
    if (q.passage) {
      var pg = document.createElement("div");
      pg.className = "q-passage";
      pg.textContent = q.passage;
      card.appendChild(pg);
    }

    if (q.kind === "single") {
      renderSingleOptions(card, q);
    } else if (q.kind === "translate") {
      renderTranslate(card, q);
    } else if (q.kind === "writing") {
      renderWriting(card, q);
    }

    body.appendChild(card);
  }

  function progressBar(idx, total) {
    var bar = document.createElement("div");
    var pct = Math.round(idx / total * 100);
    bar.innerHTML =
      '<div style="margin-bottom:14px;">' +
        '<div style="display:flex;justify-content:space-between;font-size:13px;color:var(--muted);margin-bottom:6px;">' +
          '<span>第 ' + idx + ' / ' + total + ' 题</span><span>本轮答对 ' + state.sessionCorrect + ' 题</span>' +
        '</div>' +
        '<div class="progress-track"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
      '</div>';
    return bar;
  }

  function questionMeta(q) {
    var meta = document.createElement("div");
    meta.className = "q-meta";
    meta.innerHTML = '<span class="q-tag">' + escapeHtml(q.bank || q.type) + '</span>' +
                     '<span>' + q.score + ' 分</span>';
    return meta;
  }

  function renderSingleOptions(card, q) {
    var opts = document.createElement("div");
    opts.className = "options";
    (q.options || []).forEach(function (o) {
      var div = document.createElement("div");
      div.className = "option";
      div.dataset.key = o.key;
      div.innerHTML = '<span class="opt-key">' + escapeHtml(o.key) + '</span>' +
                      '<span>' + escapeHtml(o.text) + '</span>';
      div.addEventListener("click", function () { answerSingle(q, o.key, opts); });
      opts.appendChild(div);
    });
    card.appendChild(opts);
  }

  function answerSingle(q, chosen, optsWrap) {
    var opts = Array.prototype.slice.call(optsWrap.children);
    var correct = chosen === q.answer;
    var chosenEl = null;
    opts.forEach(function (o) {
      o.classList.add("disabled");
      if (o.dataset.key === q.answer) o.classList.add("correct");
      if (o.dataset.key === chosen && !correct) o.classList.add("wrong");
      if (o.dataset.key === chosen) chosenEl = o;
    });

    // 记录进度
    recordAttempt(q, correct);

    // 展示解析
    var exp = document.createElement("div");
    exp.className = "explanation show";
    exp.innerHTML = '<b>' + (correct ? '✔ 回答正确' : '✘ 回答错误（正确答案：' + escapeHtml(q.answerLabel(q)) + '）') + '</b><br>' +
                    escapeHtml(q.explanation || "");
    optsWrap.parentNode.appendChild(exp);

    // 按钮
    var row = document.createElement("div");
    row.className = "action-row";
    var next = document.createElement("button");
    next.className = "btn btn-primary";
    next.textContent = state.sessionIndex + 1 >= state.session.length ? "查看本轮结果" : "下一题";
    next.addEventListener("click", function () {
      state.sessionIndex++;
      renderQuestion();
    });
    row.appendChild(next);
    optsWrap.parentNode.appendChild(row);
  }

  function renderTranslate(card, q) {
    var ta = document.createElement("textarea");
    ta.className = "input-area";
    ta.placeholder = "请输入你的译文…";
    card.appendChild(ta);

    var row = document.createElement("div");
    row.className = "action-row";
    var submit = document.createElement("button");
    submit.className = "btn btn-primary";
    submit.textContent = "提交翻译";
    row.appendChild(submit);
    card.appendChild(row);

    var resultWrap = document.createElement("div");
    card.appendChild(resultWrap);

    submit.addEventListener("click", function () {
      var val = (ta.value || "").trim();
      if (!val) { toast("请先输入译文"); return; }
      var correct = judgeText(val, q.answer);
      recordAttempt(q, correct);
      resultWrap.innerHTML =
        '<div class="result-banner ' + (correct ? 'ok' : 'bad') + '">' +
          (correct ? '✔ 判定：正确' : '✘ 判定：待改进（可对照参考译文）') + '</div>' +
        '<div class="explanation show" style="display:block;margin-top:14px;">' +
          '<b>参考译文：</b>' + escapeHtml(q.answer[0]) + '<br><b>解析：</b>' + escapeHtml(q.explanation || "") +
        '</div>';
      submit.disabled = true;
      ta.disabled = true;
      var next = document.createElement("button");
      next.className = "btn btn-primary";
      next.style.marginTop = "14px";
      next.textContent = "下一题";
      next.addEventListener("click", function () {
        state.sessionIndex++;
        renderQuestion();
      });
      resultWrap.appendChild(next);
    });
  }

  function renderWriting(card, q) {
    if (q.options && q.options.length) {
      // 仍然用选项时走单选
      renderSingleOptions(card, q);
      return;
    }
    var ta = document.createElement("textarea");
    ta.className = "input-area";
    ta.style.minHeight = "160px";
    ta.placeholder = "请根据题目要求，写出你的英语短文/答案…";
    card.appendChild(ta);

    var row = document.createElement("div");
    row.className = "action-row";
    var showRef = document.createElement("button");
    showRef.className = "btn";
    showRef.textContent = "查看参考范文";
    row.appendChild(showRef);
    var mark = document.createElement("button");
    mark.className = "btn btn-primary";
    mark.textContent = "我写完了（标记已练习）";
    row.appendChild(mark);
    card.appendChild(row);

    var refWrap = document.createElement("div");
    card.appendChild(refWrap);

    showRef.addEventListener("click", function () {
      refWrap.innerHTML =
        '<div class="explanation show" style="display:block;margin-top:14px;">' +
          '<b>参考范文：</b><pre style="white-space:pre-wrap;margin:8px 0 0;">' + escapeHtml(q.reference || "") + '</pre>' +
          '<div style="margin-top:8px;"><b>评分要点：</b>' + escapeHtml(q.explanation || "") + '</div>' +
        '</div>';
    });
    mark.addEventListener("click", function () {
      recordAttempt(q, true); // 写作主观题：写完视为完成一次练习，不计入正确率分母（或视为正确）
      toast("已完成本次练习，进度已记录");
      mark.disabled = true;
      var next = document.createElement("button");
      next.className = "btn btn-primary";
      next.textContent = "下一题";
      next.addEventListener("click", function () {
        state.sessionIndex++;
        renderQuestion();
      });
      card.appendChild(next);
    });
  }

  function renderSessionResult() {
    var total = state.session.length;
    var correct = state.sessionCorrect;
    var acc = total ? Math.round(correct / total * 100) : 0;
    var body = document.getElementById("quiz-body");
    body.innerHTML =
      '<div class="question-card" style="text-align:center;padding:40px;">' +
        '<div style="font-size:52px;margin-bottom:10px;">' + (acc >= 80 ? "🎉" : acc >= 60 ? "👍" : "💪") + '</div>' +
        '<h2 style="margin:0 0 8px;">本轮完成</h2>' +
        '<p style="color:var(--muted);">答对 <b style="color:var(--brand-dark);">' + correct + '</b> / ' + total + ' 题，正确率 <b style="color:var(--brand-dark);">' + acc + '%</b></p>' +
        '<div class="action-row" style="justify-content:center;">' +
          '<button class="btn btn-primary" id="again-btn">再来一轮</button>' +
        '</div>' +
      '</div>';
    document.getElementById("again-btn").addEventListener("click", renderPractice);
    renderOverview();
  }

  // ---- 判断文本类（翻译） ----
  function judgeText(val, answers) {
    if (!answers || !answers.length) return false;
    var v = normalize(val);
    for (var i = 0; i < answers.length; i++) {
      if (v === normalize(answers[i])) return true;
    }
    // 宽松匹配：参考答案被包含
    for (var j = 0; j < answers.length; j++) {
      if (v.indexOf(normalize(answers[j])) >= 0) return true;
    }
    return false;
  }
  function normalize(s) {
    return String(s).replace(/[\s，。,.!！?？:：;；"'“”‘’（）()]/g, "").toLowerCase();
  }

  // ---- 记录进度 ----
  function recordAttempt(q, correct) {
    if (state.completedIds[q.id]) return; // 同一轮避免重复计数
    state.completedIds[q.id] = true;
    if (correct) state.sessionCorrect++;

    var mod = state.progress.modules[q.type];
    if (mod) {
      mod.attempted += 1;
      if (correct) mod.correct += 1;
      mod.lastAt = nowStr();
    }
    if (!correct) {
      // 加入错题本（若已存在则增加错误次数）
      var entry = state.progress.wrongBook.filter(function (e) { return e.qid === q.id; })[0];
      if (!entry) {
        state.progress.wrongBook.push({ qid: q.id, wrongAt: nowStr(), timesWrong: 1 });
      } else {
        entry.timesWrong += 1;
        entry.wrongAt = nowStr();
      }
    }
    saveProgress(state.progress);
  }

  // ===================== 英式发音（Speech Synthesis） =====================
  var speech = {
    supported: typeof window !== "undefined" && "speechSynthesis" in window,
    voice: null,
    enabled: true,
    voiceName: ""
  };

  var PREF_VOICE_KEY = "english-b-level-voice-pref";

  /** 从可用语音中挑选英式英语语音（en-GB 优先，其次 en-*） */
  function pickBritishVoice(voices) {
    if (!voices || !voices.length) return null;
    // 1) 明确标为 en-GB 的
    var gb = voices.filter(function (v) { return /^en[-_]GB$/i.test(v.lang); });
    // 2) 名字里含 British / UK / England 的
    var named = voices.filter(function (v) {
      return /british|united kingdom|\buk\b|england|daniel|kate|serena|arthur|sonia|libby|ryan/i.test(v.name || "");
    });
    // 3) 任意英语语音兜底
    var anyEn = voices.filter(function (v) { return /^en/i.test(v.lang); });
    return gb[0] || named[0] || anyEn[0] || voices[0] || null;
  }

  function loadVoices() {
    if (!speech.supported) return;
    var voices = window.speechSynthesis.getVoices() || [];
    if (!voices.length) return;

    // 用户之前手动选过的优先
    var saved = null;
    try { saved = localStorage.getItem(PREF_VOICE_KEY); } catch (e) { saved = null; }
    if (saved) {
      var match = voices.filter(function (v) { return v.name === saved; })[0];
      if (match) { speech.voice = match; speech.voiceName = match.name; return; }
    }
    var picked = pickBritishVoice(voices);
    if (picked) { speech.voice = picked; speech.voiceName = picked.name; }
  }

  /** 朗读一个词或句子（英式口音、稍慢语速，便于跟读） */
  function speak(text, opts) {
    if (!speech.supported || !speech.enabled || !text) return;
    try {
      window.speechSynthesis.cancel(); // 避免排队叠音
      var u = new SpeechSynthesisUtterance(text);
      u.lang = "en-GB";
      u.rate = (opts && opts.rate) || 0.9;   // 略慢，适合学习
      u.pitch = 1;
      u.volume = 1;
      if (speech.voice) u.voice = speech.voice;
      window.speechSynthesis.speak(u);
    } catch (e) { /* 忽略语音失败，不影响学习 */ }
  }

  /** 语音名太长时截断显示，如 "Google UK English Female" -> "UK English Female" */
  function shortVoiceName(name) {
    if (!name) return "";
    var n = name.replace(/^Microsoft\s+/i, "").replace(/^Google\s+/i, "");
    return n.length > 22 ? n.slice(0, 22) + "…" : n;
  }

  function initSpeech() {
    if (!speech.supported) return;
    loadVoices();
    // 部分浏览器语音列表异步加载
    if (typeof window.speechSynthesis.onvoiceschanged !== "undefined") {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
    // 多次重试，兼容不同浏览器时序
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      loadVoices();
      if (speech.voice || tries > 10) clearInterval(timer);
    }, 250);
  }
  // ===================== 背单词 =====================
  function wordsOfTier(tier) {
    return WORDS.filter(function (w) { return w.tier === tier; });
  }

  function wordRecord(word) {
    return state.progress.words[word];
  }

  function tierProgress(tier) {
    var list = wordsOfTier(tier);
    var known = 0, learning = 0;
    list.forEach(function (w) {
      var rec = wordRecord(w.w);
      if (!rec) return;
      if (rec.status === "known") known++;
      else learning++;
    });
    return { total: list.length, known: known, learning: learning, untouched: list.length - known - learning };
  }

  function renderWordsSetup() {
    var tier = state.wordTier;
    var stat = tierProgress(tier);

    var opts = TIERS.map(function (t) {
      var s = tierProgress(t.key);
      return '<option value="' + t.key + '"' + (t.key === tier ? " selected" : "") + '>' +
             t.emoji + ' ' + t.name + '（' + s.total + ' 词，已掌握 ' + s.known + '）</option>';
    }).join("");

    el.wordsView.innerHTML =
      '<div class="module-head">' +
        '<div><h2>📚 背单词</h2>' +
        '<p class="desc">B 级 2500 词范围内的考试高频词 · 先看单词自测，再翻卡核对释义</p></div>' +
      '</div>' +

      '<div class="word-toolbar">' +
        '<label>选择词库</label>' +
        '<select id="tier-select">' + opts + '</select>' +
        '<label>本轮词数</label>' +
        '<select id="word-count">' +
          '<option value="10">10 词</option>' +
          '<option value="20" selected>20 词</option>' +
          '<option value="30">30 词</option>' +
          '<option value="50">50 词</option>' +
          '<option value="100">100 词</option>' +
          '<option value="0">全部（不限）</option>' +
        '</select>' +
        '<label>范围</label>' +
        '<select id="word-scope">' +
          '<option value="all" selected>全部单词</option>' +
          '<option value="new">只背未掌握的</option>' +
          '<option value="learning">只复习没记住的</option>' +
        '</select>' +
        '<button class="btn btn-primary" id="start-words">开始背</button>' +
        '<button class="btn" id="browse-words">词表速览</button>' +
      '</div>' +
      buildSpeechBar() +

      '<div class="word-stats-row">' +
        '<span class="word-stat-pill">本词库 <b>' + stat.total + '</b> 词</span>' +
        '<span class="word-stat-pill">已掌握 <b>' + stat.known + '</b></span>' +
        '<span class="word-stat-pill">待巩固 <b>' + stat.learning + '</b></span>' +
        '<span class="word-stat-pill">未学习 <b>' + stat.untouched + '</b></span>' +
      '</div>' +

      '<div id="word-stage"></div>';

    document.getElementById("tier-select").addEventListener("change", function () {
      state.wordTier = this.value;
      renderWordsSetup();
    });
    document.getElementById("start-words").addEventListener("click", startWordSession);
    document.getElementById("browse-words").addEventListener("click", function () { renderWordList("", 1); });
    bindSpeechBar();
  }

  /** 发音设置条：自动朗读开关 + 口音选择 + 试听 */
  function buildSpeechBar() {
    if (!speech.supported) {
      return '<div class="speech-bar unsupported">此浏览器不支持语音朗读，可换 Chrome / Edge / Safari 使用英式发音。</div>';
    }
    var voices = (window.speechSynthesis.getVoices() || []).filter(function (v) {
      return /^en/i.test(v.lang);
    });
    // 英式优先排序
    voices.sort(function (a, b) {
      var ga = /^en[-_]GB$/i.test(a.lang) ? 0 : 1;
      var gb = /^en[-_]GB$/i.test(b.lang) ? 0 : 1;
      return ga - gb;
    });
    var opts = voices.map(function (v) {
      var label = v.name + " (" + v.lang + ")";
      var sel = (speech.voice && speech.voice.name === v.name) ? " selected" : "";
      return '<option value="' + escapeHtml(v.name) + '"' + sel + '>' + escapeHtml(label) + '</option>';
    }).join("");

    return '<div class="speech-bar">' +
      '<label class="speech-toggle">' +
        '<input type="checkbox" id="autospeak"' + (state.autoSpeak ? " checked" : "") + ' />' +
        '<span>进入卡片自动朗读</span>' +
      '</label>' +
      (voices.length
        ? '<label class="speech-pick">口音' +
            '<select id="voice-select">' +
              (opts || '<option>默认英语语音</option>') +
            '</select>' +
          '</label>'
        : '<span class="speech-note">未检测到英语语音，将使用系统默认</span>') +
      '<button class="btn" id="test-voice" type="button">🔊 试听</button>' +
      '</div>';
  }

  function bindSpeechBar() {
    if (!speech.supported) return;
    var auto = document.getElementById("autospeak");
    if (auto) {
      auto.addEventListener("change", function () {
        state.autoSpeak = this.checked;
      });
    }
    var sel = document.getElementById("voice-select");
    if (sel) {
      sel.addEventListener("change", function () {
        var name = this.value;
        var vs = window.speechSynthesis.getVoices() || [];
        var v = vs.filter(function (x) { return x.name === name; })[0];
        if (v) {
          speech.voice = v;
          speech.voiceName = v.name;
          try { localStorage.setItem(PREF_VOICE_KEY, v.name); } catch (e) { /* 忽略 */ }
          renderWordsSetup(); // 刷新口音标签
        }
      });
    }
    var test = document.getElementById("test-voice");
    if (test) {
      test.addEventListener("click", function () {
        speak("Hello, this is a British English voice.", { rate: 0.9 });
      });
    }
  }

  function startWordSession() {
    var tier = state.wordTier;
    var scope = document.getElementById("word-scope").value;
    var count = parseInt(document.getElementById("word-count").value, 10);

    var pool = wordsOfTier(tier).filter(function (w) {
      var rec = wordRecord(w.w);
      if (scope === "new") return !rec;
      if (scope === "learning") return rec && rec.status !== "known";
      return true;
    });

    if (!pool.length) {
      document.getElementById("word-stage").innerHTML =
        '<div class="word-done"><div class="big">🎉</div>' +
        '<h2>这个词库已全部掌握</h2>' +
        '<p style="color:var(--muted);">换个范围，或去「进度统计」看看成果。</p></div>';
      return;
    }

    state.wordQueue = shuffle(pool);
    if (count > 0) state.wordQueue = state.wordQueue.slice(0, count);
    state.wordIndex = 0;
    state.wordKnownCount = 0;
    state.wordUnknownCount = 0;
    renderWordCard();
  }

  function renderWordCard() {
    var stage = document.getElementById("word-stage");
    if (!stage) return;
    if (state.wordIndex >= state.wordQueue.length) { renderWordDone(); return; }

    var w = state.wordQueue[state.wordIndex];

    stage.innerHTML =
      '<div style="margin-bottom:14px;">' +
        '<div style="display:flex;justify-content:space-between;font-size:13px;color:var(--muted);margin-bottom:6px;">' +
          '<span>第 ' + (state.wordIndex + 1) + ' / ' + state.wordQueue.length + ' 词</span>' +
          '<span>认识 ' + state.wordKnownCount + ' · 不认识 ' + state.wordUnknownCount + '</span>' +
        '</div>' +
        '<div class="progress-track"><div class="progress-fill" style="width:' +
          Math.round((state.wordIndex + 1) / state.wordQueue.length * 100) + '%"></div></div>' +
      '</div>' +
      '<div class="flashcard" id="flashcard"></div>';

    var card = document.getElementById("flashcard");
    card.innerHTML =
      '<div class="fc-word">' + escapeHtml(w.w) + '</div>' +
      '<button class="fc-audio" id="fc-audio" title="播放英式发音" aria-label="播放英式发音">🔊</button>' +
      '<div class="fc-phonetic">' + escapeHtml(w.ph || "") +
        (speech.voiceName ? '<span class="fc-accent">英式 · ' + escapeHtml(shortVoiceName(speech.voiceName)) + '</span>' : "") +
      '</div>' +
      '<span class="fc-tag ' + (w.tier === "core" ? "core" : "") + '">' +
        (w.tier === "core" ? "🔥 高频核心" : "📗 基础必备") +
        (w.tag ? " · " + escapeHtml(w.tag) : "") + '</span>' +
      '<div id="fc-reveal"></div>';

    state.wordFlipped = false;
    showWordFront(card);

    // 发音按钮
    var audioBtn = card.querySelector("#fc-audio");
    if (audioBtn) {
      if (!speech.supported) {
        audioBtn.style.display = "none";
      } else {
        audioBtn.addEventListener("click", function (e) {
          e.stopPropagation(); // 不要触发翻卡
          speak(w.w, { rate: 0.85 });
          audioBtn.classList.add("playing");
          setTimeout(function () { audioBtn.classList.remove("playing"); }, 600);
        });
      }
    }

    // 进入卡片自动读一次
    if (speech.supported && state.autoSpeak) {
      setTimeout(function () { speak(w.w, { rate: 0.85 }); }, 180);
    }

    card.addEventListener("click", function (e) {
      if (e.target.closest("button")) return; // 点按钮不翻卡
      if (!state.wordFlipped) flipWordCard(card, w);
    });
  }

  function showWordFront(card) {
    var box = card.querySelector("#fc-reveal");
    box.innerHTML =
      '<div class="fc-hint">👆 点击卡片翻面查看释义</div>' +
      '<div class="fc-actions">' +
        '<button class="btn btn-know" id="btn-know">✓ 认识</button>' +
        '<button class="btn btn-unknown" id="btn-unknown">✗ 不认识</button>' +
      '</div>';
    card.querySelector("#btn-know").addEventListener("click", function () { markWord("known"); });
    card.querySelector("#btn-unknown").addEventListener("click", function () { markWord("unknown"); });
  }

  function flipWordCard(card, w) {
    state.wordFlipped = true;
    var box = card.querySelector("#fc-reveal");

    // 拆解
    var morph = MORPH ? MORPH.breakdown(w.w) : { parts: [], tip: null, posHint: null };
    var breakdownHtml = "";
    if (morph.parts.length >= 2) {
      var chips = morph.parts.map(function (p) {
        return '<span class="mb-part mb-' + p.type + '" title="' + escapeHtml(p.cn) + '">' +
                 escapeHtml(p.text) +
                 '<i class="mb-type">' + (p.type === "prefix" ? "前缀" : p.type === "suffix" ? "后缀" : p.type === "root" ? "词根" : "词干") + '</i>' +
               '</span>';
      }).join('<span class="mb-plus">+</span>');
      breakdownHtml =
        '<div class="morph-box">' +
          '<div class="morph-title">🧩 构词拆解</div>' +
          '<div class="morph-parts">' + chips + '</div>' +
          (morph.tip ? '<div class="morph-tip">' + escapeHtml(morph.tip) + '</div>' : "") +
        '</div>';
    }

    // 同族词
    var famHtml = "";
    if (MORPH) {
      var fam = MORPH.familyWords(w.w, WORDS);
      if (fam.length) {
        famHtml =
          '<div class="morph-box">' +
            '<div class="morph-title">👪 同族词（一起记）</div>' +
            '<div class="chip-row">' +
              fam.map(function (f) {
                return '<button class="word-chip" data-goto="' + escapeHtml(f.w) + '" title="' + escapeHtml(f.cn) + '">' +
                         escapeHtml(f.w) + '</button>';
              }).join("") +
            '</div>' +
          '</div>';
      }
    }

    box.innerHTML =
      '<div class="fc-answer">' +
        '<div class="fc-meaning">' + escapeHtml(w.cn) + '</div>' +
        '<div class="fc-pos">' + escapeHtml(w.pos || "") + '</div>' +
        (w.ex
          ? '<div class="fc-example">' +
              '<div class="en">' + escapeHtml(w.ex) +
                (speech.supported ? '<button class="fc-audio-sm" id="fc-audio-ex" title="朗读例句">🔊</button>' : "") +
              '</div>' +
              '<div class="cn">' + escapeHtml(w.exCn || "") + '</div>' +
            '</div>'
          : "") +
        breakdownHtml +
        famHtml +
        buildNoteBox(w.w) +
        '<div class="fc-actions">' +
          '<button class="btn btn-know" id="btn-know">✓ 认识</button>' +
          '<button class="btn btn-unknown" id="btn-unknown">✗ 不认识</button>' +
        '</div>' +
      '</div>';

    box.querySelector("#btn-know").addEventListener("click", function () { markWord("known"); });
    box.querySelector("#btn-unknown").addEventListener("click", function () { markWord("unknown"); });

    // 例句朗读
    var exBtn = box.querySelector("#fc-audio-ex");
    if (exBtn && w.ex) {
      exBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        speak(w.ex, { rate: 0.85 });
      });
    }
    // 同族词跳转
    Array.prototype.slice.call(box.querySelectorAll("[data-goto]")).forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        jumpToWord(b.getAttribute("data-goto"));
      });
    });
    bindNoteBox(box);
  }

  // ---- 笔记与联想词 ----
  function presetOf(word) {
    return PRESETS[word] || null;
  }

  /** 返回展示用的笔记：用户写过就用用户的，否则用预置 */
  function noteOf(word) {
    var n = state.progress.notes[word];
    var pre = presetOf(word);
    if (!n) {
      return {
        text: pre ? pre.n : "",
        links: pre ? pre.l.slice() : [],
        fromPreset: !!pre,
        userText: "",
        userLinks: null
      };
    }
    var userLinks = n.links || null;
    return {
      text: (n.text && n.text.trim()) ? n.text : (pre ? pre.n : ""),
      links: userLinks !== null && userLinks.length ? userLinks : (pre ? pre.l.slice() : []),
      fromPreset: false,
      userText: n.text || "",
      userLinks: userLinks
    };
  }

  /** 用户是否改过这个词（改过就不再回落到预置） */
  function hasUserNote(word) {
    var n = state.progress.notes[word];
    if (!n) return false;
    return (n.text && n.text.trim()) || (n.links && n.links.length);
  }

  function buildNoteBox(word) {
    var info = noteOf(word);
    var pre = presetOf(word);

    var linksHtml = info.links.length
      ? info.links.map(function (lw) {
          return '<span class="link-chip">' +
                   '<button class="word-chip" data-goto="' + escapeHtml(lw) + '">' + escapeHtml(lw) + '</button>' +
                   '<button class="link-del" data-unlink="' + escapeHtml(lw) + '" title="移除">×</button>' +
                 '</span>';
        }).join("")
      : '<span class="note-empty">还没有联想词，在下面输入框里添加</span>';

    var badge = pre
      ? '<span class="preset-badge">' + (hasUserNote(word) ? "已改成我的版本" : "预置助记 · 可直接编辑") + '</span>'
      : '';

    return '<div class="note-box">' +
      '<div class="morph-title">📝 记忆笔记' + badge + '</div>' +
      '<textarea class="note-input" id="note-input" placeholder="写下你的记忆法，例如：re(回) + mind(心) → 把心拉回来 → 提醒">' +
        escapeHtml(info.text || "") +
      '</textarea>' +
      (hasUserNote(word)
        ? '<div class="note-actions"><button class="btn btn-mini" id="note-restore" type="button">' +
            (pre ? "恢复预置助记" : "清空笔记") + '</button></div>'
        : '') +
      '<div class="morph-title" style="margin-top:12px;">🔗 联想词</div>' +
      '<div class="chip-row" id="link-row">' + linksHtml + '</div>' +
      '<div class="link-add">' +
        '<input type="text" id="link-input" placeholder="输入词库里的单词，回车添加" autocomplete="off" />' +
        '<button class="btn" id="link-add-btn" type="button">添加</button>' +
      '</div>' +
      '<div class="link-hint" id="link-hint"></div>' +
    '</div>';
  }

  function bindNoteBox(box) {
    var ta = box.querySelector("#note-input");
    if (ta) {
      var t;
      ta.addEventListener("input", function () {
        var v = this.value;
        clearTimeout(t);
        t = setTimeout(function () { saveNote(state.wordQueue[state.wordIndex].w, v); }, 500);
      });
      ta.addEventListener("click", function (e) { e.stopPropagation(); });
      // 避免打字时触发翻卡
      ta.addEventListener("keydown", function (e) { e.stopPropagation(); });
    }

    var input = box.querySelector("#link-input");
    var hint = box.querySelector("#link-hint");
    var addBtn = box.querySelector("#link-add-btn");

    function doAdd() {
      var v = (input.value || "").trim().toLowerCase();
      if (!v) return;
      var exists = WORDS.some(function (x) { return x.w === v; });
      if (!exists) {
        hint.textContent = "词库里没有「" + v + "」，请换一个";
        hint.className = "link-hint bad";
        return;
      }
      addLink(state.wordQueue[state.wordIndex].w, v);
      input.value = "";
      hint.textContent = "已添加：" + v;
      hint.className = "link-hint ok";
      // 局部刷新联想词区
      var row = box.querySelector("#link-row");
      var links = currentLinks(state.wordQueue[state.wordIndex].w);
      row.innerHTML = links.map(function (lw) {
        return '<span class="link-chip">' +
                 '<button class="word-chip" data-goto="' + escapeHtml(lw) + '">' + escapeHtml(lw) + '</button>' +
                 '<button class="link-del" data-unlink="' + escapeHtml(lw) + '" title="移除">×</button>' +
               '</span>';
      }).join("");
      bindLinkChips(box);
    }

    if (addBtn) addBtn.addEventListener("click", function (e) { e.stopPropagation(); doAdd(); });

    // 恢复预置按钮
    var restoreBtn = box.querySelector("#note-restore");
    if (restoreBtn) {
      restoreBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        restorePreset(state.wordQueue[state.wordIndex].w);
        renderWordCard();
      });
    }
    if (input) {
      input.addEventListener("keydown", function (e) {
        e.stopPropagation();
        if (e.key === "Enter") { e.preventDefault(); doAdd(); }
      });
      input.addEventListener("click", function (e) { e.stopPropagation(); });
      // 输入时给提示
      input.addEventListener("input", function () {
        var v = (this.value || "").trim().toLowerCase();
        if (!v) { hint.textContent = ""; return; }
        var matches = WORDS.filter(function (x) { return x.w.indexOf(v) === 0; }).slice(0, 4);
        if (matches.length) {
          hint.textContent = "匹配：" + matches.map(function (m) { return m.w; }).join(", ");
          hint.className = "link-hint";
        } else {
          hint.textContent = "无匹配";
          hint.className = "link-hint bad";
        }
      });
    }
    bindLinkChips(box);
  }

  function bindLinkChips(box) {
    Array.prototype.slice.call(box.querySelectorAll("[data-unlink]")).forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        removeLink(state.wordQueue[state.wordIndex].w, b.getAttribute("data-unlink"));
        b.parentNode.remove();
      });
    });
    Array.prototype.slice.call(box.querySelectorAll("[data-goto]")).forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        jumpToWord(b.getAttribute("data-goto"));
      });
    });
  }

  function saveNote(word, text) {
    if (!word) return;
    var n = state.progress.notes[word] || { text: "", links: [], updatedAt: null };
    n.text = text;
    n.updatedAt = nowStr();
    state.progress.notes[word] = n;
    saveProgress(state.progress);
  }

  /** 取用户当前的联想词（若用户没改过，以预置为起点） */
  function currentLinks(word) {
    var n = state.progress.notes[word];
    if (n && n.links && n.links.length) return n.links.slice();
    var pre = presetOf(word);
    return pre ? pre.l.slice() : [];
  }

  function addLink(word, link) {
    if (!word || !link || word === link) return;
    var links = currentLinks(word);
    if (links.indexOf(link) >= 0) return;
    links.push(link);
    var n = state.progress.notes[word] || { text: "", links: [], updatedAt: null };
    n.links = links;
    n.updatedAt = nowStr();
    state.progress.notes[word] = n;
    saveProgress(state.progress);
  }

  function removeLink(word, link) {
    var links = currentLinks(word).filter(function (x) { return x !== link; });
    var n = state.progress.notes[word] || { text: "", links: [], updatedAt: null };
    n.links = links;
    n.updatedAt = nowStr();
    state.progress.notes[word] = n;
    saveProgress(state.progress);
  }

  /** 恢复预置（清空用户的覆盖） */
  function restorePreset(word) {
    if (!word) return;
    var n = state.progress.notes[word];
    if (!n) return;
    n.text = "";
    n.links = [];
    n.updatedAt = nowStr();
    state.progress.notes[word] = n;
    saveProgress(state.progress);
  }

  /** 跳到某个词（若在当前队列中则跳过去，否则临时插入） */
  function jumpToWord(word) {
    var idx = -1;
    for (var i = 0; i < state.wordQueue.length; i++) {
      if (state.wordQueue[i].w === word) { idx = i; break; }
    }
    if (idx < 0) {
      var item = WORDS.filter(function (x) { return x.w === word; })[0];
      if (!item) return;
      // 插到当前词后面，看完可以继续
      state.wordQueue.splice(state.wordIndex + 1, 0, item);
      idx = state.wordIndex + 1;
    }
    state.wordIndex = idx;
    renderWordCard();
  }

  function markWord(status) {
    var w = state.wordQueue[state.wordIndex];
    if (!w) return;
    var rec = state.progress.words[w.w];
    if (!rec) rec = { status: status, seen: 0, lastAt: null };
    rec.status = status;
    rec.seen = (rec.seen || 0) + 1;
    rec.lastAt = nowStr();
    state.progress.words[w.w] = rec;
    saveProgress(state.progress);

    if (status === "known") state.wordKnownCount++;
    else state.wordUnknownCount++;

    state.wordIndex++;
    renderWordCard();
    renderOverview();
  }

  function renderWordDone() {
    var total = state.wordQueue.length;
    var known = state.wordKnownCount;
    var unknown = state.wordUnknownCount;
    var acc = total ? Math.round(known / total * 100) : 0;

    var stage = document.getElementById("word-stage");
    stage.innerHTML =
      '<div class="word-done">' +
        '<div class="big">' + (acc >= 80 ? "🏆" : acc >= 50 ? "👍" : "💪") + '</div>' +
        '<h2 style="margin:0 0 8px;">本轮背完啦</h2>' +
        '<p style="color:var(--muted);">认识 <b style="color:var(--ok);">' + known + '</b> 词 · ' +
          '不认识 <b style="color:var(--accent);">' + unknown + '</b> 词 · 掌握率 ' +
          '<b style="color:var(--brand-dark);">' + acc + '%</b></p>' +
        '<div class="fc-actions" style="justify-content:center;">' +
          (unknown > 0 ? '<button class="btn btn-primary" id="redo-unknown">只重背不认识的 ' + unknown + ' 词</button>' : '') +
          '<button class="btn" id="again-words">再来一轮</button>' +
          '<button class="btn" id="back-setup">返回词库</button>' +
        '</div>' +
      '</div>';

    var redo = document.getElementById("redo-unknown");
    if (redo) redo.addEventListener("click", function () {
      // 把答错的词重新组队
      var wrongWords = state.wordQueue.filter(function (w) {
        var rec = wordRecord(w.w);
        return rec && rec.status !== "known";
      });
      state.wordQueue = shuffle(wrongWords);
      state.wordIndex = 0;
      state.wordKnownCount = 0;
      state.wordUnknownCount = 0;
      renderWordCard();
    });
    document.getElementById("again-words").addEventListener("click", startWordSession);
    document.getElementById("back-setup").addEventListener("click", renderWordsSetup);
  }

  var WORDLIST_PAGE = 60; // 词表分页大小，避免一次渲染上千条卡顿

  function renderWordList(keyword, page) {
    var tier = state.wordTier;
    var t = TIERS.filter(function (x) { return x.key === tier; })[0];
    var list = wordsOfTier(tier);
    var kw = (keyword || "").trim().toLowerCase();
    var stage = document.getElementById("word-stage");

    if (kw) {
      list = list.filter(function (w) {
        return w.w.toLowerCase().indexOf(kw) >= 0 || w.cn.indexOf(kw) >= 0;
      });
    }

    var total = list.length;
    var pages = Math.max(1, Math.ceil(total / WORDLIST_PAGE));
    var p = Math.min(Math.max(1, page || 1), pages);
    var slice = list.slice((p - 1) * WORDLIST_PAGE, p * WORDLIST_PAGE);

    var items = slice.map(function (w) {
      var rec = wordRecord(w.w);
      var cls = "";
      if (rec && rec.status === "known") cls = " mastered";
      else if (rec) cls = " learning";
      return '<div class="word-list-item' + cls + '">' +
               '<span class="wl-w">' + escapeHtml(w.w) +
                 (speech.supported ? '<button class="wl-audio" data-say="' + escapeHtml(w.w) + '" title="朗读">🔊</button>' : "") +
               '</span>' +
               '<span class="wl-cn">' + escapeHtml(w.cn) + '</span>' +
             '</div>';
    }).join("");

    var pager = "";
    if (pages > 1) {
      pager = '<div class="word-pager">' +
        '<button class="btn" data-page="' + (p - 1) + '"' + (p <= 1 ? " disabled" : "") + '>← 上一页</button>' +
        '<span class="word-pager-info">第 ' + p + ' / ' + pages + ' 页</span>' +
        '<button class="btn" data-page="' + (p + 1) + '"' + (p >= pages ? " disabled" : "") + '>下一页 →</button>' +
      '</div>';
    }

    stage.innerHTML =
      '<div class="module-head" style="margin-top:8px;">' +
        '<div><h3 style="margin:0;">' + t.emoji + ' ' + escapeHtml(t.name) + ' · 词表速览</h3>' +
        '<p class="desc">绿底=已掌握，橙底=待巩固，白底=未学习 · 共 ' + total + ' 词</p></div>' +
      '</div>' +
      '<div class="word-search">' +
        '<input type="search" id="word-search-input" placeholder="搜索单词或中文释义…" value="' + escapeHtml(keyword || "") + '" />' +
      '</div>' +
      (total ? '<div class="word-list-grid">' + items + '</div>' : '<div class="review-empty" style="padding:30px 0;">没有匹配的单词</div>') +
      pager;

    var input = document.getElementById("word-search-input");
    if (input) {
      var timer;
      input.addEventListener("input", function () {
        clearTimeout(timer);
        var v = this.value;
        timer = setTimeout(function () { renderWordList(v, 1); }, 220);
      });
    }
    Array.prototype.slice.call(stage.querySelectorAll("[data-page]")).forEach(function (b) {
      b.addEventListener("click", function () {
        if (b.disabled) return;
        renderWordList(keyword, parseInt(b.getAttribute("data-page"), 10));
        stage.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    // 词表内朗读按钮
    Array.prototype.slice.call(stage.querySelectorAll("[data-say]")).forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        speak(b.getAttribute("data-say"), { rate: 0.85 });
      });
    });
  }

  // ===================== 错题本重练 =====================
  function startReview() {
    state.reviewQueue = state.progress.wrongBook.map(function (e) { return byId(e.qid); }).filter(Boolean);
    state.reviewIndex = 0;
    state.reviewCorrect = 0;

    if (!state.reviewQueue.length) {
      el.reviewView.innerHTML = '<div class="review-empty"><div class="big">🎯</div>错题本是空的，先去做几道题吧！</div>';
      return;
    }
    el.reviewView.innerHTML = '<div id="review-body"></div>';
    renderReviewQuestion();
  }

  function renderReviewQuestion() {
    if (state.reviewIndex >= state.reviewQueue.length) {
      var total = state.reviewQueue.length;
      var correct = state.reviewCorrect;
      el.reviewView.innerHTML =
        '<div class="question-card" style="text-align:center;padding:40px;">' +
          '<div style="font-size:52px;margin-bottom:10px;">✅</div>' +
          '<h2 style="margin:0 0 8px;">错题重练完成</h2>' +
          '<p style="color:var(--muted);">本次答对 <b>' + correct + '</b> / ' + total + ' 题</p>' +
          '<div class="action-row" style="justify-content:center;"><button class="btn btn-primary" id="review-again">重新开始</button></div>' +
        '</div>';
      document.getElementById("review-again").addEventListener("click", startReview);
      return;
    }
    var q = state.reviewQueue[state.reviewIndex];
    var body = document.getElementById("review-body");
    body.innerHTML = "";
    body.appendChild(progressBar(state.reviewIndex + 1, state.reviewQueue.length));

    var card = document.createElement("div");
    card.className = "question-card";
    card.appendChild(questionMeta(q));
    if (q.stem) {
      var stem = document.createElement("div");
      stem.className = "q-stem";
      stem.textContent = q.stem;
      card.appendChild(stem);
    }
    if (q.passage) {
      var pg = document.createElement("div");
      pg.className = "q-passage";
      pg.textContent = q.passage;
      card.appendChild(pg);
    }

    if (q.kind === "single") {
      var opts = document.createElement("div");
      opts.className = "options";
      (q.options || []).forEach(function (o) {
        var div = document.createElement("div");
        div.className = "option";
        div.dataset.key = o.key;
        div.innerHTML = '<span class="opt-key">' + escapeHtml(o.key) + '</span><span>' + escapeHtml(o.text) + '</span>';
        div.addEventListener("click", function () {
          var correct = o.key === q.answer;
          if (correct) state.reviewCorrect++;
          // 复习答对从错题本移除
          if (correct) removeFromWrongBook(q.id);
          answerReview(q, o.key, opts, correct);
        });
        opts.appendChild(div);
      });
      card.appendChild(opts);
    } else {
      // 翻译/写作类错题：展示参考即可
      var info = document.createElement("div");
      info.innerHTML =
        '<div class="explanation show" style="display:block;">' +
          '<b>参考答案：</b>' + escapeHtml((q.answer && q.answer[0]) || q.reference || "（主观题，无固定答案）") +
          '<br><b>解析：</b>' + escapeHtml(q.explanation || "") +
        '</div>' +
        '<div class="action-row"><button class="btn btn-primary" id="rev-next">已掌握，下一题</button></div>';
      card.appendChild(info);
      body.appendChild(card);
      document.getElementById("rev-next").addEventListener("click", function () {
        removeFromWrongBook(q.id);
        state.reviewCorrect++;
        state.reviewIndex++;
        renderReviewQuestion();
      });
    }
    body.appendChild(card);
  }

  function answerReview(q, chosen, optsWrap, correct) {
    Array.prototype.slice.call(optsWrap.children).forEach(function (o) {
      o.classList.add("disabled");
      if (o.dataset.key === q.answer) o.classList.add("correct");
      if (o.dataset.key === chosen && !correct) o.classList.add("wrong");
    });
    var exp = document.createElement("div");
    exp.className = "explanation show";
    exp.innerHTML = '<b>' + (correct ? '✔ 回答正确，已移出错题本' : '✘ 回答错误，仍需练习') + '</b><br>' + escapeHtml(q.explanation || "");
    optsWrap.parentNode.appendChild(exp);
    var row = document.createElement("div");
    row.className = "action-row";
    var next = document.createElement("button");
    next.className = "btn btn-primary";
    next.textContent = "下一题";
    next.addEventListener("click", function () {
      state.reviewIndex++;
      renderReviewQuestion();
    });
    row.appendChild(next);
    optsWrap.parentNode.appendChild(row);
  }

  function removeFromWrongBook(qid) {
    state.progress.wrongBook = state.progress.wrongBook.filter(function (e) { return e.qid !== qid; });
    saveProgress(state.progress);
    renderOverview();
  }

  // ===================== 进度统计 =====================
  function renderStats() {
    var p = state.progress;
    var totalAttempted = 0, totalCorrect = 0;
    MODULES.forEach(function (m) { totalAttempted += p.modules[m.key].attempted; totalCorrect += p.modules[m.key].correct; });
    var overallAcc = totalAttempted ? Math.round(totalCorrect / totalAttempted * 100) : 0;

    var html =
      '<div class="module-head"><div><h2>📊 进度统计</h2><p class="desc">按模块查看你的作答与正确率</p></div></div>' +
      '<div class="stats-grid">';

    html += '<div class="stat-card">' +
      '<h3>总体</h3>' +
      '<div class="big-num">' + overallAcc + '%</div>' +
      '<div class="muted">答对 ' + totalCorrect + ' / 已答 ' + totalAttempted + ' 题</div>' +
      '<div class="progress-track"><div class="progress-fill" style="width:' + overallAcc + '%"></div></div>' +
      '<div class="muted">错题本 ' + p.wrongBook.length + ' 题</div>' +
    '</div>';

    MODULES.forEach(function (m) {
      var mod = p.modules[m.key];
      var qs = moduleQuestions(m.key);
      var acc = mod.attempted ? Math.round(mod.correct / mod.attempted * 100) : 0;
      html += '<div class="stat-card">' +
        '<h3>' + m.emoji + ' ' + escapeHtml(m.name) + '</h3>' +
        '<table>' +
          '<tr><td>总题数</td><td>' + qs.length + '</td></tr>' +
          '<tr><td>已答题数</td><td>' + mod.attempted + '</td></tr>' +
          '<tr><td>答对题数</td><td>' + mod.correct + '</td></tr>' +
          '<tr><td>正确率</td><td>' + acc + '%</td></tr>' +
        '</table>' +
        '<div class="progress-track"><div class="progress-fill" style="width:' + acc + '%"></div></div>' +
      '</div>';
    });

    // 背单词统计
    TIERS.forEach(function (t) {
      var s = tierProgress(t.key);
      var pct = s.total ? Math.round(s.known / s.total * 100) : 0;
      html += '<div class="stat-card">' +
        '<h3>' + t.emoji + ' ' + escapeHtml(t.name) + '</h3>' +
        '<table>' +
          '<tr><td>词库总量</td><td>' + s.total + ' 词</td></tr>' +
          '<tr><td>已掌握</td><td>' + s.known + '</td></tr>' +
          '<tr><td>待巩固</td><td>' + s.learning + '</td></tr>' +
          '<tr><td>未学习</td><td>' + s.untouched + '</td></tr>' +
          '<tr><td>掌握率</td><td>' + pct + '%</td></tr>' +
        '</table>' +
        '<div class="progress-track"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
      '</div>';
    });

    html += '</div>';
    el.statsView.innerHTML = html;
  }

  // ===================== 导入 / 导出 / 重置 =====================
  function exportProgress() {
    var data = {
      app: "english-b-level-workbench",
      version: 2,
      exportedAt: nowStr(),
      progress: state.progress
    };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "english-b-level-progress.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast("进度已导出");
  }

  function importProgress(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var data = JSON.parse(e.target.result);
        var prog = data.progress || data;
        if (!prog || !prog.modules) throw new Error("格式无效");
        // 校验补齐
        MODULES.forEach(function (m) {
          if (!prog.modules[m.key]) prog.modules[m.key] = { attempted: 0, correct: 0, lastScore: 0, lastAt: null };
        });
        if (!prog.wrongBook) prog.wrongBook = [];
        // 兼容 version 1 存档：补齐背单词记录
        if (!prog.words || typeof prog.words !== "object") prog.words = {};
        state.progress = prog;
        saveProgress(state.progress);
        renderOverview();
        toast("进度导入成功");
        switchMode("stats");
      } catch (err) {
        toast("导入失败：文件格式不正确");
      }
    };
    reader.readAsText(file);
  }

  function resetProgress() {
    if (confirm("确定要清空所有学习进度和错题本吗？此操作不可撤销。")) {
      state.progress = defaultProgress();
      saveProgress(state.progress);
      renderOverview();
      renderSidebar();
      switchMode(state.mode);
      toast("进度已重置");
    }
  }

  // ---- 扩展：单选题答案标签（阅读理解/听力共用）----
  function attachAnswerLabel() {
    // 为单选题补充 answerLabel（title 用）
    QUESTIONS.forEach(function (q) {
      if (q.kind === "single") {
        q.answerLabel = function (self) {
          if (self._answerText) return self._answerText;
          var o = self.options.filter(function (x) { return x.key === self.answer; })[0];
          self._answerText = o ? self.answer + ". " + o.text : self.answer;
          return self._answerText;
        };
      }
    });
  }

  // ---- 初始化 ----
  function init() {
    attachAnswerLabel();
    renderSidebar();
    renderOverview();
    switchMode("practice");
    initMobileSidebar();
    initBackTop();
    initSpeech();

    el.modeBtns.forEach(function (b) {
      b.addEventListener("click", function () { switchMode(b.getAttribute("data-mode")); });
    });
    el.exportBtn.addEventListener("click", exportProgress);
    el.importBtn.addEventListener("click", function () { el.importFile.click(); });
    el.importFile.addEventListener("change", function () {
      if (el.importFile.files.length) importProgress(el.importFile.files[0]);
      el.importFile.value = "";
    });
    el.resetBtn.addEventListener("click", resetProgress);
  }

  // ---- 移动端：侧边栏折叠 ----
  var MOBILE_MAX = 820;
  function isMobile() {
    return window.innerWidth <= MOBILE_MAX;
  }

  function setSidebarCollapsed(collapsed) {
    if (!el.sidebar) return;
    el.sidebar.classList.toggle("collapsed", collapsed);
    if (el.sidebarToggle) el.sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
  }

  function initMobileSidebar() {
    if (!el.sidebarToggle) return;
    // 手机端默认折叠，桌面端始终展开
    if (isMobile()) setSidebarCollapsed(true);

    el.sidebarToggle.addEventListener("click", function () {
      if (!isMobile()) return; // 桌面端不折叠
      setSidebarCollapsed(!el.sidebar.classList.contains("collapsed"));
    });

    // 旋转屏幕 / 调整窗口时同步状态
    var resizeTimer;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        if (isMobile()) {
          if (!el.sidebar.classList.contains("collapsed")) {
            // 保持用户当前选择
          } else {
            setSidebarCollapsed(true);
          }
        } else {
          setSidebarCollapsed(false); // 桌面端强制展开
        }
      }, 150);
    });
  }

  // 手机端选中模块后自动收起抽屉，让内容可见
  function collapseSidebarOnMobile() {
    if (isMobile()) setSidebarCollapsed(true);
  }

  // ---- 回到顶部 ----
  function initBackTop() {
    var btn = document.getElementById("back-top");
    if (!btn) return;
    btn.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    window.addEventListener("scroll", function () {
      btn.hidden = window.scrollY < 400;
    }, { passive: true });
  }

  document.addEventListener("DOMContentLoaded", init);
})();