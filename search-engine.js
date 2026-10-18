/* 知识点相关度搜索引擎
 * 输入一个可能很模糊的中文查询，输出按「与知识点相关程度」排序的实验。
 * 思路：查询 → 概念词典最长匹配（含口语/别名）→ 沿知识点图谱扩散一跳/两跳
 *      → 每个实验按命中概念的权重 × 该概念在实验中的位置（标题/节/章）累加
 *      → 再叠加标题直配与领域加成 → 归一化成相关度百分比。
 * 依赖：search-index.js（window.PHYS_SEARCH_INDEX）
 */
(function () {
  'use strict';
  var IDX = window.PHYS_SEARCH_INDEX;
  if (!IDX) return;

  var CONCEPTS = IDX.concepts;
  var EXPS = IDX.experiments;
  var byId = {};
  CONCEPTS.forEach(function (c) { byId[c.id] = c; });

  function wordsOf(c) {
    return [c.n].concat(c.a || []).map(function (w) { return String(w || '').replace(/^~/, ''); }).filter(function (w) { return w.length >= 2; });
  }

  // ---- 预处理：每个实验的知识点是否出现在标题 / 节 / 章 ----
  var titleHas = [], secHas = [], chapHas = [];
  EXPS.forEach(function (e, i) {
    var t = e.t || '', s = e.s || '', ch = e.c || '';
    titleHas[i] = {}; secHas[i] = {}; chapHas[i] = {};
    (e.k || []).forEach(function (id) {
      var c = byId[id]; if (!c) return;
      var ws = wordsOf(c);
      titleHas[i][id] = ws.some(function (w) { return t.indexOf(w) !== -1; });
      secHas[i][id] = ws.some(function (w) { return s.indexOf(w) !== -1; });
      chapHas[i][id] = ws.some(function (w) { return ch.indexOf(w) !== -1; });
    });
  });

  // ---- 查询归一化 / 停用词 ----
  function normalize(s) {
    s = String(s || '');
    s = s.replace(/[\uFF01-\uFF5E]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
    });
    s = s.replace(/[\s\u3000]+/g, '');
    s = s.replace(/[，。、；：？！,.;:?!"'“”‘’（）()【】\[\]《》<>…·~`@#$%^&*+=|\\\/_-]/g, '');
    return s.toLowerCase();
  }

  var STOP = ['为什么', '怎么样', '怎么', '怎样', '如何', '什么', '哪些', '哪个', '哪里', '是不是',
    '能不能', '可不可以', '我想', '想找', '帮我', '请问', '一下', '有关', '相关', '关于', '物理', '初中',
    '实验', '演示', '探究', '原理', '现象', '规律', '形成', '产生', '发生', '工作', '原因', '特点', '区别', '关系', '计算', '判断', '表示', '叫做', '称为', '制作', '观察', '分析', '比较', '利用', '应用', '设计', '却', '视频', '动画', '模型', '模拟', '仿真', '一个', '这个',
    '那个', '我们', '他们', '可以', '需要', '有没有', '是什么', '什么样', '的', '了', '是', '和', '与', '在',
    '有', '能', '会', '吗', '呢', '啊', '吧', '我', '你', '它', '请', '找', '看', '想', '要', '做', '用',
    '把', '被', '让', '给', '对', '从', '到', '也', '都', '就', '还', '很',
    '太', '更', '最', '不', '没', '无', '这', '那', '些', '个', '种', '张', '只', '次', '些'];
  STOP.sort(function (a, b) { return b.length - a.length; });

  function stripStop(s) {
    var out = s;
    for (var i = 0; i < STOP.length; i++) {
      if (out.indexOf(STOP[i]) !== -1) out = out.split(STOP[i]).join('|');
    }
    return out;
  }

  // ---- 概念词典（词 -> 概念 id 列表），长词优先 ----
  var DICT_MAP = {};
  CONCEPTS.forEach(function (c) {
    if (c.dom) return;
    [c.n].concat(c.a || []).forEach(function (w) {
      if (!w) return;
      w = w.replace(/^~/, '');
      if (w.length < 2) return;
      (DICT_MAP[w] = DICT_MAP[w] || []).push(c.id);
    });
  });
  var DICT_WORDS = Object.keys(DICT_MAP).sort(function (a, b) { return b.length - a.length; });

  // 单字口语（"为什么浮起来"里的"浮"、"铁块沉"里的"沉"）
  var SHORT = { '浮': 'fuli', '沉': 'fuchen', '力': 'li' };

  function addSeed(map, id, w) {
    if (!id) return;
    if ((map[id] || 0) < w) map[id] = w;
  }

  // ---- 编辑距离（只用于纠错，长度差 > 1 直接返回大数） ----
  function editDist(a, b) {
    if (Math.abs(a.length - b.length) > 1) return 9;
    var m = a.length, n = b.length;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur[0] = i;
      for (j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur.slice();
    }
    return prev[n];
  }

  function bigrams(s) {
    var out = [];
    for (var i = 0; i + 1 < s.length; i++) out.push(s.substr(i, 2));
    return out;
  }

  // ---- 查询分析 ----
  function analyze(q) {
    var raw = normalize(q);
    var result = { raw: raw, seeds: {}, texts: [], domain: '', fuzzy: false, hitWords: {} };
    if (!raw) return result;

    var segs = stripStop(raw).split('|').filter(Boolean);

    segs.forEach(function (seg) {
      if (seg.length === 1 && SHORT[seg]) { addSeed(result.seeds, SHORT[seg], 1); result.hitWords[seg] = 1; return; }
      var i = 0, buf = '';
      while (i < seg.length) {
        var hit = null;
        for (var k = 0; k < DICT_WORDS.length; k++) {
          var w = DICT_WORDS[k];
          if (w.length <= seg.length - i && seg.substr(i, w.length) === w) { hit = w; break; }
        }
        if (hit) {
          if (buf) { result.texts.push(buf); buf = ''; }
          DICT_MAP[hit].forEach(function (id) { addSeed(result.seeds, id, 1); });
          result.hitWords[hit] = 1;
          i += hit.length;
        } else if (SHORT[seg.charAt(i)] && seg.length <= 12) {
          if (buf) { result.texts.push(buf); buf = ''; }
          addSeed(result.seeds, SHORT[seg.charAt(i)], 0.9);
          i += 1;
        } else {
          buf += seg.charAt(i); i++;
        }
      }
      if (buf) result.texts.push(buf);
    });

    // 领域入口（"光学""电学""力学"…）
    var domLen = 0;
    CONCEPTS.forEach(function (c) {
      if (!c.dom) return;
      [c.n].concat(c.a || []).forEach(function (w) {
        if (!w) return;
        if (w.length === 1 && raw.length > 2) return;
        if (raw.indexOf(w) !== -1 && w.length > domLen) {
          domLen = w.length;
          result.domain = c.d;
        }
      });
    });

    // 单字泛查询（"电""光""热"）：把名字里带这个字的概念都当作弱命中
    if (!Object.keys(result.seeds).length && raw.length === 1) {
      CONCEPTS.forEach(function (c) {
        if (!c.dom && c.n.charAt(0) === raw) addSeed(result.seeds, c.id, 0.45);
      });
    }

    // 没有命中任何概念：纠错 + 2-gram 模糊匹配
    if (!Object.keys(result.seeds).length) {
      var probe = segs.join('') || raw;
      var cand = [];
      CONCEPTS.forEach(function (c) {
        if (c.dom) return;
        var ws = wordsOf(c);
        ws.forEach(function (w) {
          // 查询词本身就是概念词的一部分（如「电磁」→ 电磁铁 / 电磁感应）
          if (probe.length >= 2 && w.indexOf(probe) !== -1) cand.push({ id: c.id, w: 0.8 });
          else if (Math.abs(w.length - probe.length) <= 1 && editDist(probe, w) <= 1) {
            cand.push({ id: c.id, w: 0.45 });
          }
        });
        var hay = c.n + (c.a || []).join('');
        var gs = bigrams(probe);
        if (gs.length) {
          var hit = 0;
          gs.forEach(function (g) { if (hay.indexOf(g) !== -1) hit++; });
          var cov = hit / gs.length;
          if (cov >= 0.34) cand.push({ id: c.id, w: 0.5 * cov });
        }
      });
      cand.sort(function (a, b) { return b.w - a.w; });
      var seen = {};
      cand.forEach(function (x) {
        if (seen[x.id] || Object.keys(result.seeds).length >= 3) return;
        seen[x.id] = 1;
        addSeed(result.seeds, x.id, x.w);
        if (byId[x.id]) result.hitWords[byId[x.id].n] = 1;
        result.fuzzy = true;
      });
    }

    return result;
  }

  // ---- 知识点图谱扩散：一跳 0.6、两跳 0.45 ----
  function expand(seeds) {
    var W = {};
    Object.keys(seeds).forEach(function (id) { W[id] = seeds[id]; });
    var lvl1 = Object.keys(seeds).sort(function (a, b) { return seeds[b] - seeds[a]; }).slice(0, 5);
    lvl1.forEach(function (id) {
      var c = byId[id]; if (!c) return;
      (c.r || []).forEach(function (pair) {
        var nw = seeds[id] * pair[1] * 0.6;
        if (nw > (W[pair[0]] || 0)) W[pair[0]] = nw;
      });
    });
    var lvl2 = Object.keys(W).filter(function (id) { return !seeds[id]; })
      .sort(function (a, b) { return W[b] - W[a]; }).slice(0, 5);
    lvl2.forEach(function (id) {
      var c = byId[id]; if (!c) return;
      (c.r || []).forEach(function (pair) {
        var nw = W[id] * pair[1] * 0.45;
        if (nw > (W[pair[0]] || 0)) W[pair[0]] = nw;
      });
    });
    return W;
  }

  function reasonText(r) {
    if (r.t === 'title') return '标题含「' + r.n + '」';
    if (r.t === 'kp') return '知识点：' + r.n;
    return '相关：' + r.n;
  }

  function search(q, opts) {
    opts = opts || {};
    var limit = opts.limit || 12;
    var A = analyze(q);
    var seedIds = Object.keys(A.seeds);
    if (!seedIds.length && !A.domain && !A.texts.length) {
      return { items: [], total: 0, seeds: [], domain: '', fuzzy: false, query: q };
    }
    var W = expand(A.seeds);
    var items = [];

    for (var i = 0; i < EXPS.length; i++) {
      var e = EXPS[i], s = 0, rs = [], cs = [];
      var kp = e.k || [];
      for (var j = 0; j < kp.length; j++) {
        var id = kp[j], w = W[id];
        if (!w) continue;
        var imp = titleHas[i][id] ? 1.35 : (secHas[i][id] ? 1.1 : (chapHas[i][id] ? 1.0 : 0.8));
        cs.push(w * imp);
        if (w >= 0.4) rs.push({ t: A.seeds[id] ? 'kp' : 'rel', n: byId[id].n, w: w });
      }
      // 主命中决定量级，副命中只做小幅加成，避免「标签多的实验」堆分
      cs.sort(function (a, b) { return b - a; });
      if (cs.length) {
        s = cs[0];
        for (var q2 = 1; q2 < cs.length; q2++) s += cs[q2] * 0.35;
      }
      // 用户原词直接出现在标题里：强信号
      var hitW = Object.keys(A.hitWords), added = 0;
      for (var hw = 0; hw < hitW.length && added < 2; hw++) {
        var word = hitW[hw];
        if ((e.t || '').indexOf(word) !== -1) {
          s += word.length >= 2 ? 0.85 : 0.4; added++;
          rs.unshift({ t: 'title', n: word, w: word.length });
        }
      }
      for (var k = 0; k < A.texts.length; k++) {
        var tx = A.texts[k];
        if (tx.length < 2) continue;
        if ((e.t || '').indexOf(tx) !== -1) { s += 0.9; rs.unshift({ t: 'title', n: tx, w: 2 }); }
        else if ((e.s || '').indexOf(tx) !== -1) s += 0.5;
        else if ((e.c || '').indexOf(tx) !== -1) s += 0.3;
        else if ((e.d || '').indexOf(tx) !== -1) s += 0.15;
      }
      if (A.domain && e.dm === A.domain) s += 0.9;
      if (s > 0) items.push({ e: e, score: s, reasons: rs, idx: i });
    }

    items.sort(function (a, b) { return b.score - a.score || a.idx - b.idx; });
    var top = items.length ? items[0].score : 0;
    if (top > 0) items = items.filter(function (x) { return x.score >= top * 0.14; });
    items = items.slice(0, limit);

    items.forEach(function (x) {
      x.pct = top > 0 ? Math.max(12, Math.round(100 * x.score / top)) : 0;
      x.level = x.pct >= 80 ? '高度相关' : x.pct >= 60 ? '相关' : x.pct >= 40 ? '延伸' : '弱相关';
      var seen = {}, out = [], bestTitle = null;
      x.reasons.forEach(function (r) {
        if (r.t === 'title') {
          if (!bestTitle || r.n.length > bestTitle.length) bestTitle = r.n;
          return;
        }
        var txt = reasonText(r);
        if (seen[txt] || out.length >= 2) return;
        seen[txt] = 1; out.push(txt);
      });
      if (bestTitle) out.unshift('标题含「' + bestTitle + '」');
      x.reasonText = out.slice(0, 3);
    });

    return {
      items: items,
      total: items.length,
      seeds: seedIds.map(function (id) { return byId[id] ? byId[id].n : id; }),
      domain: A.domain,
      fuzzy: A.fuzzy,
      query: q,
    };
  }

  var HOT = ['浮力', '欧姆定律', '凸透镜成像', '物态变化', '电磁感应', '压强', '机械能', '近视', '电路', '声音的特性'];

  window.PhysSearch = {
    search: search,
    hot: HOT,
    concepts: CONCEPTS,
    version: IDX.version,
  };
})();
