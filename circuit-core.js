/*!
 * circuit-core.js — 电路求解内核（改进节点法 MNA）
 *
 * 纯逻辑，零 DOM / Canvas 依赖。Node 与浏览器双模加载。
 *   Node:    const C = require('./circuit-core.js')
 *   浏览器:  <script src="circuit-core.js"></script>  → window.CircuitCore
 *
 * ── 符号约定（全内核唯一真值处，改动前先读这里）────────────────────
 *   支路电流 Ik 定义为「从端子 p 流入支路」的电流（即流入元件的第一个端子）。
 *   KCL（节点 p 的「流出电流之和 = 0」）：  A[p][k] += 1,  A[q][k] -= 1
 *   支路行：                              A[k][p] += 1,  A[k][q] -= 1
 *                                        A[k][k] -= Rs      ← 负号！
 *                                        z[k]     = V
 *   矩阵对称。Rs = 0 时自动退化为理想电压源。
 *
 *   推论：电池的「充电电流 = Ik」，放电电流 = −Ik（符号翻转只出现在回填处）。
 *         电流表正确接线时 Ik > 0，读数就是 Ik。
 *
 * ── 三条铁律（踩过的坑）──────────────────────────────────────
 *   1. 只有【导线】做并查集合并。电流表、闭合开关、电池都不合并 ——
 *      它们走电压源支路，靠支路行约束等电位。误合并会让电表变自环、
 *      电流恒为 0（惠斯通电桥用例专抓这个 bug）。
 *   2. 自环电压源【不能丢】，它携带内阻信息，正好是「电源被短路」的正确解。
 *   3. 支路行的内阻项是 A[k][k] -= Rs，负号。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CircuitCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var EPS = 1e-12;

  // ============================================================
  // 元件类型表
  // ============================================================
  var TYPES = {
    resistor: {
      label: '定值电阻', terminals: 2, termNames: ['a', 'b'],
      defaults: { R: 10 },
    },
    rheostat: {
      label: '滑动变阻器', terminals: 4, termNames: ['A', 'B', 'C', 'D'],
      // A/B 都是滑片（金属杆两端，内部等效同一节点）；C/D 是电阻丝两端
      defaults: { Rmax: 20, slide: 0.5 },
      internalShort: [0, 1],
    },
    bulb: {
      label: '小灯泡', terminals: 2, termNames: ['a', 'b'],
      defaults: { ratedV: 2.5, ratedW: 0.75 },
    },
    battery: {
      label: '电源', terminals: 2, termNames: ['+', '-'],
      defaults: { cells: 2, emfPerCell: 1.5, rPerCell: 0.5 },
    },
    switch: {
      label: '开关', terminals: 2, termNames: ['a', 'b'],
      defaults: { closed: false },
    },
    ammeter: {
      label: '电流表', terminals: 2, termNames: ['+', '-'],
      defaults: { range: 0.6, rInternal: 0 },
    },
    voltmeter: {
      label: '电压表', terminals: 2, termNames: ['+', '-'],
      // rInternal = null 表示理想电压表（完全开路、不分流，初中标准模型）
      defaults: { range: 3, rInternal: null },
    },
  };

  function defaultParams(type) {
    var t = TYPES[type];
    if (!t) throw new Error('未知元件类型: ' + type);
    return Object.assign({}, t.defaults);
  }

  function paramsOf(comp) {
    return Object.assign({}, defaultParams(comp.type), comp.params || {});
  }

  // ============================================================
  // 并查集（Map 版，key 为字符串；同时记录加入顺序以保证结果可复现）
  // ============================================================
  function createDSU() {
    var parent = new Map();
    var keys = [];
    function add(x) {
      if (!parent.has(x)) { parent.set(x, x); keys.push(x); }
    }
    function find(x) {
      add(x);
      var r = x;
      while (parent.get(r) !== r) r = parent.get(r);
      while (parent.get(x) !== r) { var nxt = parent.get(x); parent.set(x, r); x = nxt; }
      return r;
    }
    function union(a, b) {
      var ra = find(a), rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    }
    return { add: add, find: find, union: union, keys: keys };
  }

  // ============================================================
  // 第一遍：导线 union → 电气节点
  // ============================================================
  function buildNodes(components, wires) {
    var dsu = createDSU();
    var i, c, t;

    for (i = 0; i < components.length; i++) {
      c = components[i];
      var ti = TYPES[c.type];
      if (!ti) throw new Error('未知元件类型: ' + c.type);
      for (t = 0; t < ti.terminals; t++) dsu.add(c.id + ':' + t);
      if (ti.internalShort) {
        for (t = 1; t < ti.internalShort.length; t++) {
          dsu.union(c.id + ':' + ti.internalShort[0], c.id + ':' + ti.internalShort[t]);
        }
      }
    }
    for (i = 0; i < (wires || []).length; i++) {
      var w = wires[i];
      dsu.union(w.a.compId + ':' + w.a.termIdx, w.b.compId + ':' + w.b.termIdx);
    }

    var rootId = new Map();
    var termNode = {};
    var count = 0;
    for (i = 0; i < dsu.keys.length; i++) {
      var k = dsu.keys[i];
      var r = dsu.find(k);
      if (!rootId.has(r)) rootId.set(r, 'n' + (count++));
      termNode[k] = rootId.get(r);
    }
    return { termNode: termNode, nodeCount: count };
  }

  // ============================================================
  // 灯泡模型：R(P) = Rcold · (1 + K · P^0.25)
  // ------------------------------------------------------------
  // 热辐射为主（斯特藩-玻尔兹曼 P ∝ T⁴）⇒ T−T₀ ∝ P^0.25，
  // 配合 R = R₀(1+α(T−T₀)) 得到上述单参数模型。
  // K 由额定点标定，保证 R(P_rated) === R_hot（自洽）。
  // ============================================================
  function lampParams(comp) {
    var P = paramsOf(comp);
    var Rhot = (P.ratedV * P.ratedV) / P.ratedW;
    var ratio = P.coldHotRatio != null ? P.coldHotRatio : 8;   // 实测钨丝冷/热比约 8~12
    var Rcold = P.Rcold != null ? P.Rcold : Rhot / ratio;
    var K = (Rhot / Rcold - 1) / Math.pow(P.ratedW, 0.25);
    return { Rhot: Rhot, Rcold: Rcold, K: K, Prated: P.ratedW, ratedV: P.ratedV };
  }
  function lampColdR(comp) { return lampParams(comp).Rcold; }
  function lampRAt(pp, power) {
    return pp.Rcold * (1 + pp.K * Math.pow(Math.max(power, 0), 0.25));
  }

  // ============================================================
  // 第二遍：元件 → 支路
  // ------------------------------------------------------------
  // R / LAMP 自环（p===q）→ 丢弃（电流恒 0，与不存在等效）
  // V 自环【不丢】→ 携带内阻信息，正是「电源被短路」的解
  // ============================================================
  function describeComponent(comp, termNode, lampR) {
    var out = [];
    var P = paramsOf(comp);
    var N = function (i) { return termNode[comp.id + ':' + i]; };

    function addR(p, q, R) {
      if (p === q) return;                                 // 自环电阻：丢弃
      if (!(R > EPS)) {                                    // 0Ω → 理想短路线
        out.push({ kind: 'V', comp: comp, p: p, q: q, V: 0, Rs: 0 });
        return;
      }
      out.push({ kind: 'R', comp: comp, p: p, q: q, R: R });
    }

    switch (comp.type) {
      case 'resistor':
        addR(N(0), N(1), P.R);
        break;

      case 'bulb':
        var rl = lampR != null ? lampR : lampColdR(comp);
        if (N(0) !== N(1) && rl > EPS) {
          out.push({ kind: 'LAMP', comp: comp, p: N(0), q: N(1), R: rl });
        } else if (N(0) !== N(1)) {
          out.push({ kind: 'V', comp: comp, p: N(0), q: N(1), V: 0, Rs: 0 });
        }
        break;

      case 'voltmeter':
        if (P.rInternal != null && isFinite(P.rInternal)) addR(N(0), N(1), P.rInternal);
        break;                                             // 理想电压表：不产生支路

      case 'ammeter':
        out.push({ kind: 'V', comp: comp, p: N(0), q: N(1), V: 0, Rs: P.rInternal || 0 });
        break;

      case 'switch':
        if (P.closed) out.push({ kind: 'V', comp: comp, p: N(0), q: N(1), V: 0, Rs: 0 });
        break;                                             // 断开 → 无支路，自然消失

      case 'battery':
        var cells = P.cells != null ? P.cells : 1;
        var emf = P.emf != null ? P.emf : cells * (P.emfPerCell != null ? P.emfPerCell : 1.5);
        var rInt = P.rInt != null ? P.rInt : cells * (P.rPerCell != null ? P.rPerCell : 0.5);
        out.push({ kind: 'V', comp: comp, p: N(0), q: N(1), V: emf, Rs: rInt });
        break;

      case 'rheostat':
        // A(0)/B(1) 已在 buildNodes 中合并 → 同一节点 = 滑片 S
        var S = N(0);
        addR(N(2), S, P.Rmax * clamp01(P.slide));          // C → 滑片
        addR(S, N(3), P.Rmax * (1 - clamp01(P.slide)));    // 滑片 → D
        break;

      default:
        throw new Error('未知元件类型: ' + comp.type);
    }
    return out;
  }

  function clamp01(x) { x = +x; if (!isFinite(x)) return 0; return x < 0 ? 0 : (x > 1 ? 1 : x); }

  // 矩阵奇异时用来分辨「短路」还是「接错线」。
  // 只看理想电压源支路（Rs≈0：理想电源、闭合开关、理想电流表）：
  //   · 这条支路两端落到同一个电气节点 → 它被零阻通路短接了；
  //   · 两条这样的支路压在同一对节点上却给出不同电压 → 方程组自相矛盾，
  //     物理上就是一个电源被另一条零阻支路强行摁到别的电位（典型的
  //     「理想电源两端并一个闭合开关」）。
  function isShortedByIdealLoop(branches) {
    var byPair = new Map();
    for (var i = 0; i < branches.length; i++) {
      var b = branches[i];
      if (b.kind !== 'V' || !(Math.abs(b.Rs) <= 1e-9)) continue;
      if (b.p === b.q) return true;
      var key = b.p <= b.q ? (b.p + '|' + b.q) : (b.q + '|' + b.p);
      var prev = byPair.get(key);
      if (prev === undefined) { byPair.set(key, b); continue; }
      if (Math.abs(prev.V - b.V) > 1e-9) return true;
    }
    return false;
  }

  // ============================================================
  // 第三遍：连通分量（电气孤岛）
  // ------------------------------------------------------------
  // 无源岛整岛【精确归零】—— 这一步同时消灭「孤立元件偷走电流」
  // 和「悬空节点产生 NaN」两类 bug，且结果是严格 0 而非 1e-12 噪声。
  // ============================================================
  function buildIslands(branches) {
    var dsu = createDSU();
    var i;
    for (i = 0; i < branches.length; i++) dsu.union(branches[i].p, branches[i].q);

    var byRoot = new Map();
    var islandOfBranch = new Map();
    for (i = 0; i < branches.length; i++) {
      var r = dsu.find(branches[i].p);
      if (!byRoot.has(r)) byRoot.set(r, []);
      byRoot.get(r).push(branches[i]);
      islandOfBranch.set(branches[i], byRoot.get(r));
    }
    var islands = [];
    byRoot.forEach(function (bs) {
      var hasSource = bs.some(function (b) { return b.kind === 'V' && Math.abs(b.V) > EPS; });
      islands.push({ branches: bs, hasSource: hasSource });
    });
    return { islands: islands, islandOfBranch: islandOfBranch };
  }

  // ============================================================
  // 高斯消元：列主元 + 行缩放
  // ------------------------------------------------------------
  // 行缩放对 MNA 很关键：KCL 行量纲是西门子、电压源行量纲是伏特，
  // 不缩放时主元选取会被量纲而非数值大小主导。
  // ============================================================
  function solveLinear(A, z, n) {
    var i, j, k;
    var scale = new Array(n);
    var maxAbsA = 0;
    for (i = 0; i < n; i++) {
      var m = 0;
      for (j = 0; j < n; j++) { var v = Math.abs(A[i][j]); if (v > m) m = v; }
      scale[i] = m > 0 ? m : 1;
      if (m > maxAbsA) maxAbsA = m;
      for (j = 0; j < n; j++) A[i][j] /= scale[i];
      z[i] /= scale[i];
    }
    var tol = Math.max(1e-12, 1e-12 * maxAbsA);

    for (k = 0; k < n; k++) {
      var piv = k, best = Math.abs(A[k][k]);
      for (i = k + 1; i < n; i++) {
        var av = Math.abs(A[i][k]);
        if (av > best) { best = av; piv = i; }
      }
      if (best < tol) return null;                         // 奇异
      if (piv !== k) {
        var t = A[k]; A[k] = A[piv]; A[piv] = t;
        var s = z[k]; z[k] = z[piv]; z[piv] = s;
        var sc = scale[k]; scale[k] = scale[piv]; scale[piv] = sc;
      }
      var akk = A[k][k];
      for (i = k + 1; i < n; i++) {
        var f = A[i][k] / akk;
        if (f === 0) continue;
        A[i][k] = 0;
        for (j = k + 1; j < n; j++) A[i][j] -= f * A[k][j];
        z[i] -= f * z[k];
      }
    }
    var x = new Array(n).fill(0);
    for (i = n - 1; i >= 0; i--) {
      var sum = z[i];
      for (j = i + 1; j < n; j++) sum -= A[i][j] * x[j];
      var d = A[i][i];
      if (Math.abs(d) < tol) return null;
      x[i] = sum / d;
    }
    // 注意：行缩放是对「方程」的等价变换 —— A' = D·A, z' = D·z ⇒ 解 x 完全不变。
    // 所以回代得到的 x 就是最终解，绝不能再除以 scale（曾经在这里错了 10~1500 倍）。
    return x;
  }

  // ============================================================
  // 单个岛的 MNA 装配与求解
  // ============================================================
  function solveIsland(island) {
    var Vb = island.branches.filter(function (b) { return b.kind === 'V'; });

    // 接地：优先取幅值最大电源的负极，使多数节点电压为正、读数符合直觉
    var main = Vb
      .filter(function (b) { return Math.abs(b.V) > EPS; })
      .sort(function (a, b) { return Math.abs(b.V) - Math.abs(a.V); })[0];
    var ground = main ? main.q : island.branches[0].p;

    var nodes = [];
    island.branches.forEach(function (b) {
      if (nodes.indexOf(b.p) < 0) nodes.push(b.p);
      if (nodes.indexOf(b.q) < 0) nodes.push(b.q);
    });

    var idx = new Map();
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i] !== ground) idx.set(nodes[i], idx.size);
    }
    var N = idx.size, M = Vb.length, n = N + M;
    var at = function (nd) { return nd === ground ? -1 : idx.get(nd); };

    var nodeV = new Map();
    var bI = new Map();
    nodes.forEach(function (nd) { nodeV.set(nd, 0); });
    island.branches.forEach(function (b) { bI.set(b, 0); });

    if (n === 0) return { ok: true, nodeV: nodeV, bI: bI, N: N, M: M };

    var A = [], z = new Array(n).fill(0);
    for (i = 0; i < n; i++) A.push(new Array(n).fill(0));

    var rowOf = new Map();
    Vb.forEach(function (b, k) { rowOf.set(b, N + k); });

    for (i = 0; i < island.branches.length; i++) {
      var b = island.branches[i];
      var ip = at(b.p), iq = at(b.q);

      if (b.kind === 'R' || b.kind === 'LAMP') {
        var G = 1 / b.R;
        if (ip >= 0) A[ip][ip] += G;
        if (iq >= 0) A[iq][iq] += G;
        if (ip >= 0 && iq >= 0) { A[ip][iq] -= G; A[iq][ip] -= G; }
      } else {
        var row = rowOf.get(b);
        if (ip >= 0) { A[ip][row] += 1; A[row][ip] += 1; }
        if (iq >= 0) { A[iq][row] -= 1; A[row][iq] -= 1; }
        A[row][row] -= (b.Rs || 0);                        // 负号！见文件头
        z[row] = b.V;
        // p === q 时两侧 KCL stamp 自动抵消，只剩 −Rs·Ik = V
        // ⇒ Ik = −V/Rs ⇒ 放电电流 V/Rs —— 电源被短路的正解，零特判
      }
    }

    var x = solveLinear(A, z, n);
    if (!x) return { ok: false, singular: true, nodeV: nodeV, bI: bI, N: N, M: M };

    nodes.forEach(function (nd) {
      var r = at(nd);
      nodeV.set(nd, r < 0 ? 0 : x[r]);
    });
    island.branches.forEach(function (b) {
      var r = rowOf.get(b);
      bI.set(b, r == null ? 0 : x[r]);
    });
    return { ok: true, nodeV: nodeV, bI: bI, N: N, M: M };
  }

  function solveAllIslands(islands) {
    var nodeV = new Map(), bI = new Map(), matrixSize = 0;
    for (var i = 0; i < islands.length; i++) {
      var is = islands[i];
      if (!is.hasSource) {
        // 无源岛（孤立元件、未接线备件、断开的支路）：整岛精确归零
        is.branches.forEach(function (b) {
          nodeV.set(b.p, 0); nodeV.set(b.q, 0); bI.set(b, 0);
        });
        continue;
      }
      var r = solveIsland(is);
      if (!r.ok) return { ok: false, singular: true };
      r.nodeV.forEach(function (v, k) { nodeV.set(k, v); });
      r.bI.forEach(function (v, b) { bI.set(b, v); });
      matrixSize = Math.max(matrixSize, r.N + r.M);
    }
    return { ok: true, nodeV: nodeV, bI: bI, matrixSize: matrixSize };
  }

  // ============================================================
  // 主求解入口
  // ============================================================
  function solve(components, wires, options) {
    options = options || {};
    var opts = {
      lampMaxIter: options.lampMaxIter || 200,
      lampTolR: options.lampTolR || 1e-9,
      lampOmega: options.lampOmega || 0.7,
      shortCurrent: options.shortCurrent || 10,
    };
    components = components || [];
    wires = wires || [];

    var warnings = [];
    var out = {
      ok: true, status: 'ok', degraded: false, iterations: 0,
      warnings: warnings, nodeV: {}, terminalNode: {}, components: {},
      islands: [], stats: {},
    };
    if (components.length === 0) { out.status = 'empty'; return out; }

    var t0 = now();
    var topo = buildNodes(components, wires);
    out.terminalNode = topo.termNode;

    var lamps = components.filter(function (c) { return c.type === 'bulb'; });
    var lampR = new Map();
    lamps.forEach(function (c) { lampR.set(c.id, lampColdR(c)); });

    function assemble() {
      var branches = [];
      components.forEach(function (c) {
        describeComponent(c, topo.termNode, lampR.get(c.id))
          .forEach(function (b) { branches.push(b); });
      });
      return branches;
    }

    var branches = assemble();
    var ig = buildIslands(branches);
    var islands = ig.islands;
    var islandOfBranch = ig.islandOfBranch;
    var sol = solveAllIslands(islands);
    var usedBranches = branches;

    // ---- 灯泡阻尼不动点迭代 ----
    if (sol.ok && lamps.length > 0) {
      var omega = opts.lampOmega;
      var prevMax = Infinity;
      var converged = false;
      var iter = 0;
      for (; iter < opts.lampMaxIter; iter++) {
        var maxDelta = 0;
        var targets = new Map();
        for (var li = 0; li < lamps.length; li++) {
          var lc = lamps[li];
          var lb = branches.filter(function (b) { return b.comp === lc; })[0];
          var v = lb ? (nV(sol, lb.p) - nV(sol, lb.q)) : 0;
          var R = lampR.get(lc.id);
          var P = Math.max(v * v / R, 0);
          var Rnew = lampRAt(lampParams(lc), P);
          targets.set(lc.id, Rnew);
          maxDelta = Math.max(maxDelta, Math.abs(Rnew - R) / R);
        }
        if (maxDelta < opts.lampTolR) { converged = true; usedBranches = branches; break; }

        if (maxDelta > prevMax * 1.05) omega = Math.max(omega * 0.5, 0.05);
        else omega = Math.min(omega * 1.1, 1.0);
        prevMax = maxDelta;

        lamps.forEach(function (lc) {
          lampR.set(lc.id, lampR.get(lc.id) + omega * (targets.get(lc.id) - lampR.get(lc.id)));
        });

        branches = assemble();
        ig = buildIslands(branches);
        islands = ig.islands;
        islandOfBranch = ig.islandOfBranch;
        sol = solveAllIslands(islands);
        if (!sol.ok) break;
      }
      out.iterations = iter + 1;
      if (!converged && sol.ok) {
        warnings.push({ code: 'LAMP_NOT_CONVERGED', message: '灯泡工作点未收敛，结果可能不准' });
      }
    }

    if (!sol.ok) {
      out.ok = false;
      // 矩阵奇异有两种成因，对学生的含义完全不同，必须分开报：
      //   短路 —— 理想电源被零阻通路短接，是真实会烧电源的操作；
      //   矛盾 —— 其它接线错误。混在一起报「接线矛盾」会让学生
      //   以为自己接错了线，其实是短路了。
      var shorted = isShortedByIdealLoop(branches);
      out.status = shorted ? 'shorted' : 'singular';
      warnings.push(shorted
        ? { code: 'SHORT_CIRCUIT', message: '电源被导线或闭合开关直接短接，电流会过大' }
        : { code: 'SINGULAR', message: '电路存在矛盾约束，请检查接线' });
      return out;
    }

    // ---- 回填每个元件 ----
    var comp = {};
    var anyCurrent = false;
    var shorted = false;

    // 「属于有源岛」的节点集合 —— 判断元件是否真的接进了电路。
    // 不能用「端子是否与其它元件共节点」：被自己短路的电池没有任何别的元件，
    // 但它显然在工作（这正是 T7 用例抓到的）。
    var poweredNode = new Set();
    islands.forEach(function (is) {
      if (!is.hasSource) return;
      is.branches.forEach(function (b) { poweredNode.add(b.p); poweredNode.add(b.q); });
    });

    components.forEach(function (c) {
      var P = paramsOf(c);
      var N = function (i) { return topo.termNode[c.id + ':' + i]; };
      var bs = usedBranches.filter(function (b) { return b.comp === c; });
      var rec = { type: c.type, v: 0, i: 0, p: 0, R: null, isolated: false };

      // 「未接入电路」= 该元件没有任何端子落在有源岛内。
      // 对理想电压表这类「无支路」元件同样正确（它的节点不在任何岛里）。
      rec.isolated = true;
      for (var t = 0; t < TYPES[c.type].terminals; t++) {
        if (poweredNode.has(N(t))) { rec.isolated = false; break; }
      }

      switch (c.type) {
        case 'resistor': case 'bulb': case 'voltmeter': {
          if (bs.length === 0) {
            // 理想电压表（无支路）：读数是两端节点电压差，电流为 0。
            // 注意不能在这里 break 成 v=0 —— 否则理想电压表永远读 0。
            rec.v = nV(sol, N(0)) - nV(sol, N(1));
            rec.i = 0;
            rec.p = 0;
            rec.R = null;
            if (c.type === 'voltmeter') fillVoltmeter(rec, c, P);
            break;
          }
          var br = bs[0];
          if (br.kind === 'V') {
            rec.R = 0; rec.v = 0; rec.i = bI(sol, br);
          } else {
            rec.R = br.R;
            rec.v = nV(sol, br.p) - nV(sol, br.q);
            rec.i = rec.v / br.R;
          }
          rec.p = rec.v * rec.i;
          if (c.type === 'bulb') fillLamp(rec, c, P);
          if (c.type === 'voltmeter') fillVoltmeter(rec, c, P);
          break;
        }

        case 'switch': {
          rec.closed = !!P.closed;
          if (P.closed && bs.length) {
            rec.i = bI(sol, bs[0]);
            rec.v = 0;
          } else {
            rec.v = nV(sol, N(0)) - nV(sol, N(1));
            rec.i = 0;
          }
          rec.p = rec.v * rec.i;
          break;
        }

        case 'ammeter': {
          var ab = bs[0];
          rec.i = bI(sol, ab);
          rec.R = P.rInternal || 0;
          rec.v = rec.R * rec.i;
          rec.p = rec.v * rec.i;
          rec.range = P.range;
          rec.ideal = !P.rInternal;
          rec.reading = rec.i;
          rec.overRange = Math.abs(rec.reading) > P.range + 1e-12;
          rec.reversed = rec.i < -1e-9;
          if (rec.overRange) warnings.push({ code: 'METER_OVER_RANGE', message: '电流表超量程', componentIds: [c.id] });
          if (rec.reversed) warnings.push({ code: 'METER_REVERSED', message: '电流表正负接线柱接反', componentIds: [c.id] });
          break;
        }

        case 'battery': {
          var bb = bs[0];
          rec.i = -bI(sol, bb);                            // Ik 是充电方向；放电 = −Ik
          rec.v = nV(sol, bb.p) - nV(sol, bb.q);
          rec.emf = bb.V;
          rec.rInternal = bb.Rs;
          rec.R = bb.Rs;
          rec.cells = P.cells;
          rec.iInternal = rec.i;
          rec.p = rec.v * rec.i;                           // 输出功率
          rec.pTotal = bb.V * rec.i;                       // 总功率（含内阻损耗）
          rec.pInternal = rec.i * rec.i * bb.Rs;
          rec.vDrop = rec.i * bb.Rs;                       // 内阻分压
          rec.reading = rec.v;
          rec.reversed = rec.i < -1e-9;
          if (Math.abs(rec.i) > opts.shortCurrent) {
            shorted = true;
            warnings.push({ code: 'SHORT_CIRCUIT', message: '电路短路！电流过大', componentIds: [c.id] });
          }
          break;
        }

        case 'rheostat': {
          var slide = clamp01(P.slide);
          rec.slide = slide; rec.Rmax = P.Rmax;
          // 接法识别（教学关键量）：看哪些端子真正接了外部导线
          rec.mode = detectRheostatMode(c, topo, usedBranches, components);
          var segs = [];
          bs.forEach(function (b) {
            if (b.kind === 'V') {
              segs.push({ R: 0, v: 0, i: bI(sol, b), isShort: true });
              return;
            }
            var vv = nV(sol, b.p) - nV(sol, b.q);
            segs.push({ R: b.R, v: vv, i: vv / b.R, isShort: false });
          });
          rec.segments = segs;
          var carry = segs.filter(function (s) { return Math.abs(s.i) > 1e-12; });
          if (carry.length) {
            rec.rUsed = carry.reduce(function (a, s) { return a + s.R; }, 0);
          } else {
            // 无电流段：A-B 接法 = 电流走金属杆，滑片不起作用 ⇒ 接入 0Ω
            //（初中经典错误接法，必须给出 0 而不是 null）
            rec.rUsed = (rec.mode === 'A-B') ? 0 : null;
          }
          // 对外一律用「接入部分」这一等效电阻的幅值表述，保证 v = i·R_used、p = v·i
          // 三者自洽（四端元件的段间正负号对教学毫无意义，只会让 UI 显示错）。
          rec.i = segs.reduce(function (a, s) { return Math.max(a, Math.abs(s.i)); }, 0);
          rec.v = (rec.rUsed == null) ? 0 : rec.i * rec.rUsed;
          rec.p = rec.v * rec.i;
          break;
        }
      }

      rec.v = fin(rec.v, 0); rec.i = fin(rec.i, 0); rec.p = fin(rec.p, 0);
      if (Math.abs(rec.i) > 1e-12) anyCurrent = true;
      comp[c.id] = rec;
    });

    // ---- 节点电压 ----
    var nodeVObj = {};
    sol.nodeV.forEach(function (v, k) {
      if (!Number.isFinite(v)) { out.degraded = true; v = 0; }
      nodeVObj[k] = v;
    });
    out.nodeV = nodeVObj;
    out.components = comp;

    out.islands = islands.map(function (is) {
      var nodes = [], ids = [];
      is.branches.forEach(function (b) {
        if (nodes.indexOf(b.p) < 0) nodes.push(b.p);
        if (nodes.indexOf(b.q) < 0) nodes.push(b.q);
        if (ids.indexOf(b.comp.id) < 0) ids.push(b.comp.id);
      });
      return { hasSource: is.hasSource, nodeIds: nodes, componentIds: ids };
    });

    // ---- 状态判定 ----
    if (shorted) out.status = 'shorted';
    else if (anyCurrent) out.status = 'ok';
    else if (!components.some(function (c) { return c.type === 'battery'; })) out.status = 'no-source';
    else out.status = 'open-circuit';

    out.stats = {
      nodeCount: topo.nodeCount,
      branchCount: usedBranches.length,
      matrixSize: sol.matrixSize || 0,
      solveMs: +(now() - t0).toFixed(3),
    };
    return out;
  }

  // 滑动变阻器接法识别：根据 C/D 端子是否与「滑片节点之外」相连来判定
  function detectRheostatMode(comp, topo, branches, components) {
    var S = topo.termNode[comp.id + ':0'];
    var C = topo.termNode[comp.id + ':2'];
    var D = topo.termNode[comp.id + ':3'];
    var cWired = false, dWired = false, sWired = false;
    for (var i = 0; i < components.length; i++) {
      if (components[i] === comp) continue;
      var ot = TYPES[components[i].type].terminals;
      for (var t = 0; t < ot; t++) {
        var nd = topo.termNode[components[i].id + ':' + t];
        if (nd === C) cWired = true;
        if (nd === D) dWired = true;
        if (nd === S) sWired = true;
      }
    }
    if (sWired && cWired && !dWired) return 'A-C';
    if (sWired && dWired && !cWired) return 'A-D';
    if (sWired && cWired && dWired) return 'A-C+D';
    if (!sWired && cWired && dWired) return 'C-D';
    if (sWired && !cWired && !dWired) return 'A-B';
    return 'open';
  }

  function fillLamp(rec, c, P) {
    var pp = lampParams(c);
    rec.Rcold = pp.Rcold; rec.Rhot = pp.Rhot;
    rec.ratedV = pp.ratedV; rec.ratedW = pp.Prated;
    rec.brightness = Math.max(0, Math.min(rec.p / pp.Prated, 1.3));
    rec.overload = rec.p > 1.3 * pp.Prated;
    rec.R_selfCheck = lampRAt(pp, rec.p);
  }

  // 电压表的读数/量程字段。理想电压表（无支路）和有内阻的电压表都要走这里，
  // 否则「理想电压表读数为 undefined」这种 bug 会从画布上冒出来。
  function fillVoltmeter(rec, c, P) {
    rec.range = P.range;
    rec.reading = rec.v;
    rec.ideal = !(P.rInternal > 0);
    rec.overRange = Math.abs(rec.reading) > P.range + 1e-12;
    rec.reversed = rec.v < -1e-9;
    if (rec.overRange) warnings.push({ code: 'METER_OVER_RANGE', message: '电压表超量程', componentIds: [c.id] });
    if (rec.reversed) warnings.push({ code: 'METER_REVERSED', message: '电压表正负接线柱接反', componentIds: [c.id] });
  }

  function bI(sol, branch) { var v = sol.bI.get(branch); return v == null ? 0 : v; }
  function nV(sol, node) { var v = sol.nodeV.get(node); return v == null ? 0 : v; }
  function fin(v, d) { return Number.isFinite(v) ? v : (d || 0); }
  function now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  // ============================================================
  // 导线电流分布
  // ============================================================
  // 因为并查集把每根导线的两端并成了同一个电气节点，MNA 解出来的是
  // 「节点电位 + 元件支路电流」，**没有单根导线的电流**——每根导线都是
  // 节点内部的一条边。可画面上要显示电流粒子往哪边跑，就得把它算出来。
  //
  // 办法：在一个节点内部，各元件端子注入节点的电流是已知的（解里直接有）。
  // 导线构成一张图，反复剥掉度为 1 的顶点：它只有一条边，注入多少就得
  // 全部从这条边流走，KCL 直接给出这根导线的电流；把这份电流「推」给对面
  // 顶点后，对面度数减一，可能又变成叶子，继续剥。剩下的环（罕见）按边均分。
  //
  // 返回：与 wires 等长的数组，元素是这根导线的电流（正 = 从 a 端流向 b 端）。
  // wired：有导线挂在上面的端子集合（"compId:termIdx"）。只有变阻器用得到。
  function terminalInjection(comp, rec, termIdx, wired) {
    if (!rec || !Number.isFinite(rec.i) || !comp) return 0;
    if (comp.type === 'rheostat') {
      // 变阻器不是「两端元件」，它内部是 A-B 金属杆短接成滑片节点 S，
      // 外加 C→S、S→D 两个半段电阻。整体 rec.i 在这里没有意义，
      // 必须按半段算：segs[0] 的电流从 C 流向 S，segs[1] 从 S 流向 D。
      var segs = rec.segments;
      if (!segs || segs.length < 2) return 0;
      if (termIdx === 2) return -segs[0].i;   // C：电流流进元件，注入节点为负
      if (termIdx === 3) return segs[1].i;    // D：电流从元件流出，注入节点为正
      // A(0)/B(1) 挂在同一个滑片节点上，KCL 给出两者注入之和：
      //   inj_A + inj_B = −(segs[1].i − segs[0].i)
      // 这个负号是关键。segs[1].i − segs[0].i 由滑片节点 S 的 KCL 推出来，
      // 它等于「从 A 端【流入】元件的电流」；而本函数的契约是「流出元件、
      // 注入节点」，方向正好相反，所以必须取负。
      //
      // 漏掉这个负号的后果很隐蔽：剥叶子时哪个端子先被剥，取决于导线是
      // 从哪端开始写的。接 A 的那根线若写成「E → A」（a 端是 E），先剥 E，
      // 结果是对的；写成「A → E」先剥 A，用上这个注入量，这根线的电流就
      // 整个反号——屏幕上就是【这一段和其它段的粒子反向跑】。
      // 两者各分多少，解里是定不下来的（同一节点的两根引线）。
      // 实际接线只用一个，所以按「谁真的接了线」分配：只接一个就全给它，
      // 两个都接（少见，等于把同一根杆引到两处）才平分。
      if (termIdx !== 0 && termIdx !== 1) return 0;
      var total = segs[0].i - segs[1].i;      // 从 A 端【流出】元件的电流
      var aWired = wired ? wired.has(comp.id + ':0') : false;
      var bWired = wired ? wired.has(comp.id + ':1') : false;
      if (aWired && !bWired) return (termIdx === 0) ? total : 0;
      if (bWired && !aWired) return (termIdx === 1) ? total : 0;
      return total / 2;
    }
    // 电池的记录沿用了「支路电流 Ik = 充电方向」的约定，放电是 −Ik，
    // 别的元件 rec.i 是放电方向。这里统一成「流出元件、注入节点」。
    var out = (comp.type === 'battery') ? rec.i : -rec.i;
    return (termIdx === 0) ? out : -out;
  }

  // 剥叶子剥不动了：节点内部的导线绕成了环（一个度为 1 的顶点都没有）。
  // 这时每根线各承担多少在物理上【本来就不定】——理想导线 0Ω，任何分配
  // 都同样满足 KCL。所以取最小二乘解，等价于把这组导线当成等电阻网络
  // 求各顶点电位、再取电位差（相位差为零的那部分电流不显示，符合直觉）。
  //
  // 原先这里按 (s[ka] − s[kb]) / 2 硬凑，两个毛病都会让画面出错：
  //   · 两根线并接在同一对端子上（学生常画的冗余线）时，每根都报整份电流，
  //     加起来是实际的两倍；
  //   · 那个值随导线是从哪端开始写的而变号——同一对端子上就会出现
  //     「一根朝左、一根朝右」，正是「某一段方向和其它段相反」。
  // edges: [{ u, v, wi }]，u 恒为这根导线的 a 端。s 是各顶点注入量。
  function ringFlow(verts, edges, s) {
    var out = new Array(edges.length).fill(0);
    var i;
    // 按连通分量分别解：几组互不相连的环放在一个矩阵里会奇异
    var dsu = createDSU();
    edges.forEach(function (e) { dsu.union(e.u, e.v); });
    var groups = new Map();
    edges.forEach(function (e, k) {
      var r = dsu.find(e.u);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(k);
    });
    groups.forEach(function (ks) {
      var vs = [];
      ks.forEach(function (k) {
        [edges[k].u, edges[k].v].forEach(function (v) { if (vs.indexOf(v) < 0) vs.push(v); });
      });
      var n = vs.length;
      if (n < 2) return;                     // 自环线：两端同一个端子，电流恒 0
      var m = n - 1;                          // 末位顶点接地，消掉拉普拉斯矩阵的零空间
      var li = {};
      vs.forEach(function (v, j) { li[v] = j; });
      var A = [], z = new Array(m);
      for (i = 0; i < m; i++) { A.push(new Array(m).fill(0)); z[i] = s[vs[i]]; }
      var ok = true;
      ks.forEach(function (k) {
        var a = li[edges[k].u], b = li[edges[k].v];
        if (a === b) { ok = false; return; }  // 自环
        if (a < m) { A[a][a] += 1; if (b < m) { A[a][b] -= 1; } }
        if (b < m) { A[b][b] += 1; if (a < m) { A[b][a] -= 1; } }
      });
      if (!ok) return;
      var phi = solveLinear(A, z, m);
      if (!phi) return;                       // 解不出来就留 0（宁可不动，也别反向）
      var val = {};
      vs.forEach(function (v, j) { val[v] = j < m ? phi[j] : 0; });
      ks.forEach(function (k) {
        // 沿 u→v 方向流出的电流 = 两端电位差。u 就是 a 端，
        // 所以这个值直接就是「正 = 从 a 流向 b」。
        out[k] = val[edges[k].u] - val[edges[k].v];
      });
    });
    return out;
  }

  function wireCurrents(scene, res) {
    var wires = (scene && scene.wires) || [];
    var flow = new Array(wires.length);
    for (var z = 0; z < wires.length; z++) flow[z] = 0;
    if (!res || !res.terminalNode || !res.components) return flow;

    var compById = {};
    (scene.comps || []).forEach(function (c) { compById[c.id] = c; });

    // 哪些端子上真的挂了导线。变阻器的 A/B 是同电位的一对引线，
    // 不区分「接的是哪一个」就无法把注入量分对（见 terminalInjection）。
    var wired = new Set();
    wires.forEach(function (wr) {
      if (wr && wr.a) wired.add(wr.a.compId + ':' + wr.a.termIdx);
      if (wr && wr.b) wired.add(wr.b.compId + ':' + wr.b.termIdx);
    });

    // 按电气节点分组，每组内只放「两端确实同节点」的导线
    var groups = new Map();
    wires.forEach(function (wr, i) {
      var ka = wr.a.compId + ':' + wr.a.termIdx, kb = wr.b.compId + ':' + wr.b.termIdx;
      var na = res.terminalNode[ka], nb = res.terminalNode[kb];
      if (na == null || nb == null || na !== nb) return;   // 不是节点内导线（跨节点或未接线）
      if (!groups.has(na)) groups.set(na, { s: {}, deg: {}, adj: {}, live: {} });
      var g = groups.get(na);
      [ka, kb].forEach(function (k) {
        if (!(k in g.s)) { g.s[k] = 0; g.deg[k] = 0; g.adj[k] = []; }
      });
      g.adj[ka].push({ wi: i, other: kb, isKa: true });
      g.adj[kb].push({ wi: i, other: ka, isKa: false });
      g.deg[ka]++; g.deg[kb]++; g.live[i] = true;
    });

    groups.forEach(function (g) {
      Object.keys(g.s).forEach(function (k) {
        var p = k.split(':');
        g.s[k] = terminalInjection(compById[p[0]], res.components[p[0]], +p[1], wired);
      });
    });

    groups.forEach(function (g) {
      var queue = Object.keys(g.s).filter(function (k) { return g.deg[k] === 1; });
      while (queue.length) {
        var v = queue.shift();
        if (g.deg[v] !== 1) continue;
        var e = null;
        for (var j = 0; j < g.adj[v].length; j++) {
          if (g.live[g.adj[v][j].wi]) { e = g.adj[v][j]; break; }
        }
        if (!e) { g.deg[v] = 0; continue; }
        flow[e.wi] = e.isKa ? g.s[v] : -g.s[v];
        g.live[e.wi] = false;
        g.deg[v] = 0; g.deg[e.other]--;
        g.s[e.other] += g.s[v];
        if (g.deg[e.other] === 1) queue.push(e.other);
      }
      // 剩下的成环：交给最小二乘解法
      var rest = Object.keys(g.live).filter(function (i) { return g.live[i]; }).map(Number);
      if (!rest.length) return;
      var ringEdges = rest.map(function (i) {
        var wr2 = wires[i];
        return {
          u: wr2.a.compId + ':' + wr2.a.termIdx,
          v: wr2.b.compId + ':' + wr2.b.termIdx,
          wi: i,
        };
      });
      var ringOut = ringFlow(
        Object.keys(g.deg).filter(function (k) { return g.deg[k] > 0; }),
        ringEdges, g.s);
      rest.forEach(function (i, k) { flow[i] = ringOut[k]; });
    });

    return flow;
  }

  return {
    TYPES: TYPES,
    defaultParams: defaultParams,
    lampParams: lampParams,
    lampRAt: lampRAt,
    solve: solve,
    wireCurrents: wireCurrents,
    // 「这个端子往节点里注入多少电流」。导出是为了让测试能独立验 KCL，
    // 从而钉死每根导线的电流方向（画面上电流粒子往哪边跑全靠它）。
    terminalInjection: terminalInjection,
    version: '1.0.0',
  };
});
