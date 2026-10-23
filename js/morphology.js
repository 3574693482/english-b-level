/**
 * 英语 B 级 · 单词拆解引擎
 * 用词缀 + 词根规则把单词拆成可记忆的部件，并找出同族词。
 * 纯规则驱动，无需人工录入。
 *
 * 设计原则：
 *  1. 宁可少拆，不可乱拆 —— 拆错了比不拆更误导。
 *  2. 所有部件必须 >= 2 个字符，且剩余词干必须像个真词。
 *  3. 后缀优先识别（边界最清晰），再识别前缀，最后找词根。
 *  4. 词干必须能在「词库 / 常用词干表」中验证，否则不拆。
 */
(function () {
  "use strict";

  // ---- 前缀（按长度降序） ----
  var PREFIXES = [
    { p: "counter", cn: "反对、对抗" },
    { p: "inter", cn: "在…之间、相互" },
    { p: "trans", cn: "横过、转移" },
    { p: "under", cn: "在下、不足" },
    { p: "super", cn: "超、上" },
    { p: "semi", cn: "半" },
    { p: "anti", cn: "反对" },
    { p: "auto", cn: "自己、自动" },
    { p: "multi", cn: "多" },
    { p: "micro", cn: "微小" },
    { p: "over", cn: "过度、在上" },
    { p: "post", cn: "在后" },
    { p: "fore", cn: "在前、预先" },
    { p: "dis", cn: "否定、分开" },
    { p: "mis", cn: "错误地" },
    { p: "pre", cn: "预先、在前" },
    { p: "pro", cn: "向前、支持" },
    { p: "sub", cn: "在下、次级" },
    { p: "non", cn: "非、不" },
    { p: "out", cn: "超出、向外" },
    { p: "re", cn: "再、回、反" },
    { p: "un", cn: "不、否定" },
    { p: "de", cn: "向下、去除" },
    { p: "ex", cn: "向外、前任" },
    { p: "en", cn: "使…成为" },
    { p: "em", cn: "使…成为" },
    { p: "im", cn: "不、进入" },
    { p: "in", cn: "不、进入" },
    { p: "il", cn: "不" },
    { p: "ir", cn: "不" },
    { p: "co", cn: "共同" },
    { p: "com", cn: "共同、一起" },
    { p: "con", cn: "共同、一起" },
    { p: "col", cn: "共同" },
    { p: "cor", cn: "共同" },
    { p: "bi", cn: "二、双" },
    { p: "tri", cn: "三" },
    { p: "uni", cn: "单一" }
  ];

  // ---- 后缀（长后缀优先；base=true 可用于提取词干） ----
  var SUFFIXES = [
    { s: "ologically", cn: "…学的（副词）" },
    { s: "ability", cn: "…的能力（名词）", base: true },
    { s: "ibility", cn: "…的能力（名词）", base: true },
    { s: "ization", cn: "…化（名词）" },
    { s: "isation", cn: "…化（名词）" },
    { s: "ationally", cn: "…地（副词）" },
    { s: "ically", cn: "…地（副词）" },
    { s: "ations", cn: "…（名词复数）" },
    { s: "ation", cn: "…的行为或结果（名词）", base: true },
    { s: "ition", cn: "…的行为或结果（名词）" },
    { s: "ution", cn: "…的行为或结果（名词）" },
    { s: "ingly", cn: "…地（副词）" },
    { s: "fully", cn: "…地（副词）" },
    { s: "lessly", cn: "无…地（副词）" },
    { s: "ments", cn: "…（名词复数）" },
    { s: "ness", cn: "…的性质（名词）", base: true },
    { s: "ment", cn: "…的行为或结果（名词）", base: true },
    { s: "ance", cn: "…的状态（名词）" },
    { s: "ence", cn: "…的状态（名词）" },
    { s: "able", cn: "能…的（形容词）", base: true },
    { s: "ible", cn: "能…的（形容词）", base: true },
    { s: "ally", cn: "…地（副词）" },
    { s: "ical", cn: "…的（形容词）" },
    { s: "ship", cn: "…的身份或状态（名词）", base: true },
    { s: "hood", cn: "…的状态（名词）" },
    { s: "less", cn: "没有…的（形容词）", base: true },
    { s: "ful", cn: "充满…的（形容词）", base: true },
    { s: "ous", cn: "充满…的（形容词）" },
    { s: "ive", cn: "有…性质的（形容词）", base: true },
    { s: "ity", cn: "…的性质（名词）", base: true },
    { s: "ify", cn: "使…化（动词）" },
    { s: "ise", cn: "使…化（动词）" },
    { s: "ize", cn: "使…化（动词）" },
    { s: "ism", cn: "…主义（名词）" },
    { s: "ist", cn: "…的人（名词）" },
    { s: "ing", cn: "…的、正在…（分词）" },
    { s: "ion", cn: "…的行为或结果（名词）" },
    { s: "age", cn: "…的行为或集合（名词）" },
    { s: "ure", cn: "…的行为或结果（名词）" },
    { s: "ern", cn: "…方向的" },
    { s: "ish", cn: "略…的、…人的" },
    { s: "ent", cn: "…的、…的人" },
    { s: "ant", cn: "…的、…的人" },
    { s: "ate", cn: "使…、…的" },
    { s: "ly", cn: "…地（副词）", base: true },
    { s: "er", cn: "…的人或物", base: true },
    { s: "or", cn: "…的人或物", base: true },
    { s: "al", cn: "…的（形容词）" },
    { s: "ic", cn: "…的（形容词）" }
  ];

  // ---- 词根（长度 >= 3） ----
  var ROOTS = {
    act: "做、行动", aud: "听", bio: "生命", cap: "拿、取", ceive: "拿、取",
    cept: "拿、取", cid: "切、杀", civ: "公民", claim: "喊、叫", clar: "清楚",
    cogn: "知道", corp: "身体", cred: "相信", cur: "跑、关心", cycl: "圆、环",
    dic: "说", duct: "引导", duc: "引导", dur: "持久", equ: "相等",
    fac: "做、制造", fact: "做、制造", fect: "做、制造", fic: "做、制造",
    fer: "带来、拿", fid: "信任", fin: "结束、界限", firm: "坚固",
    flu: "流", form: "形状", fort: "强壮", gen: "产生、种类", geo: "地球",
    grad: "步、走", gress: "步、走", graph: "写、画", ject: "投、扔",
    jud: "判断", junct: "连接", lect: "选、读", leg: "读、法律",
    log: "说、学科", loc: "地方", mand: "命令", mem: "记忆",
    min: "小", mit: "送、发", miss: "送、发", mob: "移动",
    mot: "移动", mov: "移动", nat: "出生", nom: "名字、法则", nov: "新",
    oper: "工作", opt: "选择", ord: "顺序", part: "部分", pass: "通过",
    path: "感觉、疾病", pel: "推、驱", pend: "悬挂、称重", pens: "悬挂、称重",
    phon: "声音", photo: "光", plic: "折叠", port: "搬运、港口",
    pos: "放、置", press: "压", prim: "第一", priv: "私人",
    prob: "证明、试验", psych: "心理", quest: "寻求、问", rect: "直、正",
    reg: "统治、规则", rupt: "破、断", sci: "知道", scop: "看、观察",
    scrib: "写", script: "写", sect: "切", sequ: "跟随",
    serv: "服务、保持", sist: "站立", soci: "社会、同伴", sol: "单独、太阳",
    spec: "看", spir: "呼吸、精神", sta: "站立", stat: "站立",
    struct: "建造", sum: "拿、取", tact: "接触", tain: "拿、持",
    tect: "覆盖", temp: "时间", tend: "伸展", tens: "伸展",
    termin: "界限、结束", terr: "土地", test: "证明", text: "编织",
    tract: "拉、拖", tribute: "给予", urb: "城市", vac: "空",
    vail: "价值", val: "价值", ven: "来", vent: "来", ver: "真实",
    vers: "转", vert: "转", vid: "看", vis: "看", vit: "生命",
    viv: "生命", voc: "声音、呼叫", volv: "滚、转"
  };

  var PREFIX_KEYS = PREFIXES.slice().sort(function (a, b) { return b.p.length - a.p.length; });
  var SUFFIX_KEYS = SUFFIXES.slice().sort(function (a, b) { return b.s.length - a.s.length; });
  var ROOT_KEYS = Object.keys(ROOTS).sort(function (a, b) { return b.length - a.length; });

  var DERIV = ["eer", "ee", "ist", "ism", "ship", "hood", "ness", "ance", "ence", "ment"];
  var DERIV_CN = {
    eer: "从事…的人（名词）", ee: "被…的人（名词）", ist: "…的人、…家（名词）",
    ism: "…主义（名词）", ship: "…的身份或状态（名词）", hood: "…的状态（名词）",
    ness: "…的性质（名词）", ment: "…的行为或结果（名词）",
    ance: "…的状态（名词）", ence: "…的状态（名词）"
  };

  /** 词库词表（由外部注入） */
  var ALL_WORDS = {};
  function setWordList(list) {
    ALL_WORDS = {};
    (list || []).forEach(function (x) {
      var k = typeof x === "string" ? x : (x && x.w);
      if (k) ALL_WORDS[k] = 1;
    });
  }

  /** 判断片段是否为「真实英语词/词干」 */
  function isRealStem(t) {
    if (!t) return false;
    var s = String(t).toLowerCase();
    if (ALL_WORDS[s]) return true;
    if (typeof window !== "undefined" && window.WordStems && window.WordStems.has(s)) return true;
    return false;
  }

  function okStem(s) {
    if (!s || s.length < 4) return false;
    if (!/[aeiouy]/.test(s)) return false;
    return true;
  }

  function findRoot(stem) {
    for (var i = 0; i < ROOT_KEYS.length; i++) {
      var k = ROOT_KEYS[i];
      if (stem.indexOf(k) >= 0) return { root: k, cn: ROOTS[k] };
    }
    return null;
  }

  /** 剥离派生后缀（-ee/-ist/-ship 等），要求剩余是真实词干 */
  function stripDerivational(word) {
    for (var i = 0; i < DERIV.length; i++) {
      var d = DERIV[i];
      if (word.length - d.length < 4) continue;
      if (word.slice(word.length - d.length) !== d) continue;
      var stem = word.slice(0, word.length - d.length);
      if (!okStem(stem)) continue;
      if (!isRealStem(stem)) continue;
      return { suffix: { s: d, cn: DERIV_CN[d] }, stem: stem };
    }
    return null;
  }

  /** 剥离一般后缀（要求剩余是真实词干） */
  function stripSuffix(word) {
    for (var i = 0; i < SUFFIX_KEYS.length; i++) {
      var S = SUFFIX_KEYS[i];
      var sl = S.s.length;
      if (word.length - sl < 4) continue;
      if (word.slice(word.length - sl) !== S.s) continue;
      var stem = word.slice(0, word.length - sl);
      if (!/[aeiouy]/.test(stem)) continue;
      if (!isRealStem(stem)) continue;
      var restored = stem;
      if (stem.length >= 3 && stem[stem.length - 1] === stem[stem.length - 2]) {
        restored = stem.slice(0, -1);
      }
      return { suffix: S, stem: stem, restored: restored };
    }
    return null;
  }

  /** 剥离前缀（要求剩余是真实词干） */
  function stripPrefix(word) {
    for (var i = 0; i < PREFIX_KEYS.length; i++) {
      var P = PREFIX_KEYS[i];
      if (word.indexOf(P.p) !== 0) continue;
      var stem = word.slice(P.p.length);
      if (!okStem(stem)) continue;
      if (!isRealStem(stem)) continue;
      return { prefix: P, stem: stem };
    }
    return null;
  }

  /**
   * 拆解单词。
   * @param {string} word
   * @returns {{parts: Array<{text,type,cn}>, tip: string|null, posHint: string|null}}
   */
  function breakdown(word) {
    var w = String(word || "").toLowerCase().trim();
    var empty = { parts: [], tip: null, posHint: null };
    if (!w || w.indexOf(" ") >= 0 || w.indexOf("-") >= 0 || w.length < 6) return empty;

    // 本身就是短单词，不必拆
    if (isRealStem(w) && w.length <= 6) return empty;

    var sfx = stripDerivational(w) || stripSuffix(w);
    var mid = sfx ? sfx.stem : w;

    // 剥后缀后剩余是真实词（employee -> employ）就不再用前缀拆
    var pfx = (sfx && isRealStem(mid)) ? null : stripPrefix(mid);
    var core = pfx ? pfx.stem : mid;

    // 前后缀都没剥下来时，试「前缀 + 完整词」：discover = dis + cover
    if (!pfx && !sfx) {
      var alt = stripPrefix(w);
      if (alt) { pfx = alt; core = alt.stem; }
    }

    // 复合后缀（finally = final + ly）
    var sfx2 = null;
    if (sfx && !pfx && sfx.suffix.s.length <= 3) {
      var inner = stripSuffix(sfx.stem);
      if (inner && inner.stem.length >= 3) {
        sfx2 = sfx;
        sfx = inner;
        core = inner.stem;
      }
    }

    var coreIsWord = isRealStem(core);
    var rootInfo = coreIsWord ? null : findRoot(core);

    var parts = [];
    if (pfx) parts.push({ text: pfx.prefix.p, type: "prefix", cn: "前缀 · " + pfx.prefix.cn });

    if (rootInfo && rootInfo.root !== core) {
      var idx = core.indexOf(rootInfo.root);
      var head = core.slice(0, idx);
      var tail = core.slice(idx + rootInfo.root.length);
      if (head) parts.push({ text: head, type: "stem", cn: "词干" });
      parts.push({ text: rootInfo.root, type: "root", cn: "词根 · " + rootInfo.cn });
      if (tail) parts.push({ text: tail, type: "stem", cn: "词干" });
    } else if (rootInfo) {
      parts.push({ text: core, type: "root", cn: "词根 · " + rootInfo.cn });
    } else if (core) {
      parts.push({ text: core, type: "stem", cn: "词干" });
    }

    if (sfx) parts.push({ text: sfx.suffix.s, type: "suffix", cn: "后缀 · " + sfx.suffix.cn });
    if (sfx2) parts.push({ text: sfx2.suffix.s, type: "suffix", cn: "后缀 · " + sfx2.suffix.cn });

    if (parts.length < 2) return empty;
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].text.length < 2) return empty;
    }

    // 质量闸门：没有词根也没有前缀时，词干必须是真实词
    var stemParts = parts.filter(function (p) { return p.type === "stem"; });
    var hasRootP = parts.some(function (p) { return p.type === "root"; });
    var hasPfxP = parts.some(function (p) { return p.type === "prefix"; });
    if (stemParts.length && !hasRootP && !hasPfxP) {
      var allOk = stemParts.every(function (p) { return isRealStem(p.text); });
      if (!allOk) return empty;
    }

    var tips = [];
    if (pfx && sfx) {
      tips.push("前缀「" + pfx.prefix.p + "」(" + pfx.prefix.cn + ") + 后缀「" + sfx.suffix.s + "」");
    } else if (pfx) {
      tips.push("前缀「" + pfx.prefix.p + "」表示" + pfx.prefix.cn);
    } else if (sfx) {
      tips.push("后缀「" + sfx.suffix.s + "」构成" + sfx.suffix.cn);
    }
    if (rootInfo) tips.push("词根「" + rootInfo.root + "」意为「" + rootInfo.cn + "」");

    var posHint = null;
    var posSrc = sfx2 ? sfx2.suffix.cn : (sfx ? sfx.suffix.cn : null);
    if (posSrc) {
      if (/名词/.test(posSrc)) posHint = "名词";
      else if (/形容词/.test(posSrc)) posHint = "形容词";
      else if (/副词/.test(posSrc)) posHint = "副词";
      else if (/动词/.test(posSrc)) posHint = "动词";
    }

    return { parts: parts, tip: tips.join("；") + "。", posHint: posHint };
  }

  /** 提取词干核心（用于同族词） */
  function coreOf(word) {
    var w = String(word || "").toLowerCase().trim();
    if (!w || w.indexOf(" ") >= 0) return "";
    var sfx = stripSuffix(w);
    var mid = sfx ? (sfx.restored || sfx.stem) : w;
    var pfx = stripPrefix(mid);
    return pfx ? pfx.stem : mid;
  }

  /**
   * 找同族词。
   * @param {string} word
   * @param {Array<{w:string,cn:string}>} pool
   */
  function familyWords(word, pool) {
    var w = String(word || "").toLowerCase().trim();
    if (!w || w.indexOf(" ") >= 0) return [];
    var core = coreOf(w);
    if (!core || core.length < 4) return [];

    var out = [];
    var seen = {};
    var ALL = SUFFIXES.concat(PREFIXES.map(function (p) { return { s: p.p, cn: p.cn }; }));

    function isAffixal(t) {
      if (!t) return true;
      if (t.length > 8) return false;
      for (var k = 0; k < ALL.length; k++) {
        if (t === ALL[k].s) return true;
        if (t.indexOf(ALL[k].s) === 0) return true;
      }
      return false;
    }

    for (var i = 0; i < pool.length; i++) {
      var item = pool[i];
      var cand = item.w;
      if (!cand || cand === w || seen[cand]) continue;
      if (cand.indexOf(" ") >= 0 || cand.indexOf("-") >= 0) continue;

      var share = 0;
      var minLen = Math.min(cand.length, w.length);
      while (share < minLen && cand[share] === w[share]) share++;
      if (share < 4) continue;
      if (Math.abs(cand.length - w.length) > 8) continue;

      var shorter = cand.length < w.length ? cand : w;
      if (share < shorter.length - 4) continue;

      var tailA = cand.slice(share);
      var tailB = w.slice(share);
      var explained = false;
      if (!tailA || !tailB) explained = true;
      else if (tailA === tailB) explained = true;
      else if (isAffixal(tailA) && isAffixal(tailB)) explained = true;
      if (!explained) continue;

      var bothAffixal = tailA && tailB && isAffixal(tailA) && isAffixal(tailB) && tailA !== tailB;
      var ok = false;
      if (share >= 5) ok = true;
      else if (share === 4 && bothAffixal) {
        var sameFunc = false;
        for (var m = 0; m < SUFFIXES.length; m++) {
          if (SUFFIXES[m].s === tailA) {
            for (var n2 = 0; n2 < SUFFIXES.length; n2++) {
              if (SUFFIXES[n2].s === tailB) {
                var f1 = /名词|形容词|副词|动词/.exec(SUFFIXES[m].cn);
                var f2 = /名词|形容词|副词|动词/.exec(SUFFIXES[n2].cn);
                if (f1 && f2 && f1[0] === f2[0]) sameFunc = true;
              }
            }
          }
        }
        ok = sameFunc && tailA.length <= 5 && tailB.length <= 5;
      }
      if (!ok) continue;

      seen[cand] = true;
      out.push({ w: cand, cn: item.cn });
      if (out.length >= 6) break;
    }
    return out;
  }

  window.WordBreakdown = {
    breakdown: breakdown,
    familyWords: familyWords,
    setWordList: setWordList
  };
})();