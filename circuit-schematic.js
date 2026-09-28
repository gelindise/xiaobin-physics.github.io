/* ============================================================
 * circuit-schematic.js —— 实物图 → 电路图（标准符号）
 * ------------------------------------------------------------
 * 职责：把 circuit-draw.js 画的那张半写实【器材示意图】折成一张课本意义上的
 *       【电路图】：元件留在学生摆的原地，外形换成国标符号，导线走横平竖直，
 *       旁边标上编号（R₁ / A / V / E / S）和可选的铭牌值（10Ω、0.6A 挡、滑片 0.5）。
 * 依赖：circuit-draw.js（端子几何 + 圆角矩形）。可选注入 circuit-core.js
 *       （拿量程挡位的数字；不给就少印那几个数，图照样画得出来）。
 * 不含：物理求解、交互、页面外壳。
 *
 * ⚠️ 两条不能动的地基
 *
 * 1) 符号的引脚坐标**一律取自 D.TERMINALS**，一个常数都不许自己发明。
 *    circuit-draw.js:15 的规矩是「端子 0 画在哪一头，由 TERMINALS 拍板，并且全站统一」。
 *    电路图的引线端点必须和导线端点**逐点相同**，自己写死一个 ±70 出来，哪天
 *    TERMINALS 改了，导线就接不到引脚上，看着像断的。所以下面每一处引线都写
 *    `T[i]` / `t.x` / `t.y`，绝不出现裸数字。
 *
 * 2) 导线避让用**符号**的包围盒（本文件 symRect），**不是** D.bodyBox()。
 *    bodyBox 返的是【实物】外形：电表 100×70、变阻器 78×29、开关 70×62。
 *    换成符号之后元件小了一圈，按实物避让会让导线绕开一片空白——
 *    这是「就地换符号」最容易踩的坑。
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CircuitSchematic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // UMD 的 root 只是外层 IIFE 的形参，工厂函数体内看不见它，得自己取一次全局。
  var G = (typeof self !== 'undefined') ? self
        : (typeof global !== 'undefined') ? global : this;

  var GRID = 20;          // 车道吸附步长（和 circuit-editor.js 的 GRID 同值，走线落在同一张网上）
  var LANE_OUT = 60;      // 外侧车道离端点再往外让这么多
  var PAD = 40;           // 取景时四周留白
  var AXIS_TOL = 0.5;     // 判定「这一段是横平竖直的」的容差

  var COLOR = {
    wire:   '#1e293b',    // 导线与符号本体
    lead:   '#1e293b',
    dim:    '#94a3b8',    // 悬空端子的虚线短脚
    ink:    '#334155',    // 编号
    value:  '#64748b',    // 铭牌值
    paper:  '#ffffff',
  };

  // ── 编号：把 id 里的数字变成真下标（R1 → R₁），教材上就是这么写的 ──
  var SUB = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
              '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉' };
  function subscript(id) {
    return String(id).replace(/[0-9]/g, function (d) { return SUB[d]; });
  }

  function snap(v) { return Math.round(v / GRID) * GRID; }
  function drawOf(opts) { return (opts && opts.draw) || G.CircuitDraw; }
  function coreOf(opts) { return (opts && opts.core) || G.CircuitCore || null; }
  // 阻值之类的印刷：10 →「10」，5.114 →「5.1」。整数不带小数点，和铭牌一样。
  function num(v) { return (Math.round(v * 10) / 10).toString(); }

  // ============================================================
  // 端子几何的小工具
  // ============================================================

  // 某根柱子上有没有接线。**故意只看接线，不看求解结果**——build() 必须能在
  // 电路没接通（results 为 null / status 非 ok）时照样画出一张图，
  // 那恰恰是学生最想看「我哪根线接错了」的时候。
  function termHasWire(wires, compId, termIdx) {
    for (var i = 0; i < wires.length; i++) {
      var w = wires[i];
      if (w.a && w.a.compId === compId && w.a.termIdx === termIdx) return true;
      if (w.b && w.b.compId === compId && w.b.termIdx === termIdx) return true;
    }
    return false;
  }

  // 干电池只有 1.5V 一种规格，所以【节数由电动势反推】。和 circuit-draw.js:566
  // 同一条规矩：不能反过来信 params.cells，两者对不上时图和数就自相矛盾了。
  function cellCount(comp) {
    var P = comp.params || {};
    var per = P.emfPerCell != null ? +P.emfPerCell : 1.5;
    var emf = P.emf != null ? +P.emf : (P.cells != null ? +P.cells * per : 3);
    return Math.max(1, Math.min(6, Math.round(emf / per)));
  }
  function emfOf(comp, rec) {
    if (rec && rec.emf != null) return +rec.emf;
    var P = comp.params || {};
    if (P.emf != null) return +P.emf;
    if (P.cells != null) return +P.cells * (P.emfPerCell != null ? +P.emfPerCell : 1.5);
    return 3;
  }

  // ============================================================
  // 符号本体几何（局部坐标）
  // ============================================================

  var LONG = { h: 12, lw: 2.2 };    // 长线：细而长 = 正极
  var SHORT = { h: 5, lw: 4.6 };    // 短线：粗而短 = 负极
  var CELL_PITCH = 14;              // 一节占的横向宽度
  var CELL_INNER = 6;               // 一节里长线到短线的距离

  // 电池符号的极板。**最右边那根必须是长线**：端子 0 = 正极 = 落在 TERMINALS
  // 的 +HALF（右侧），这是全站不可动摇的极性（circuit-draw.js:770）。
  // 于是从右往左数，一根长、一根短、一根长……画出来自左向右就是「短长 短长」，
  // 正是两节干电池串联该有的样子（每节负极朝左、正极朝右）。
  function batteryPlates(comp) {
    var n = cellCount(comp);
    var x = 0, out = [];
    for (var k = 0; k < n; k++) {
      out.push({ x: x, h: LONG.h, lw: LONG.lw });
      x -= CELL_INNER;
      out.push({ x: x, h: SHORT.h, lw: SHORT.lw });
      x -= (CELL_PITCH - CELL_INNER);
    }
    // 整组居中：先量出实际的左右边界再挪，别拿循环末尾的 x 反推
    // （末尾的 x 比最左那根极板还多让了一格，按它居中会整体偏左）。
    var xs = out.map(function (p) { return p.x; });
    var mid = (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2;
    out.forEach(function (p) { p.x -= mid; });
    return out;
  }
  function batteryHalf(comp) {
    var n = cellCount(comp);
    return ((n - 1) * CELL_PITCH + CELL_INNER) / 2;
  }

  // 电表：圆骑在「−」柱和被接的那个量程柱【中间】。
  // 只接了一个量程柱是常态（内核的规矩就是「量程由接线决定」），这时候圆心
  // 落在两柱中点上，两根引线水平地引到圆周——串在回路里的一只表，教材就这么画。
  function meterGeom(comp, wires, D) {
    var T = D.TERMINALS[comp.type];              // 0=「−」柱，1/2=量程柱
    var tap = null;
    if (termHasWire(wires, comp.id, 1)) tap = 1;
    else if (termHasWire(wires, comp.id, 2)) tap = 2;
    var right = tap ? T[tap] : T[2];             // 没接量程柱时按最右那根摆，位置别再跳
    return {
      // 不把 TERMINALS 本身放进模型：那是内核的共享对象，外面一改就全站遭殃
      tap: tap,
      posWired: termHasWire(wires, comp.id, 0),
      cx: (T[0].x + right.x) / 2, cy: T[0].y, r: 26,
      // 悬空的柱子：没接的量程柱，以及没接线的「−」柱
      dangling: [1, 2].filter(function (i) { return i !== tap; })
                .concat(termHasWire(wires, comp.id, 0) ? [] : [0]),
    };
  }
  function meterRangeText(type, tap, core) {
    if (!core || !tap) return '';
    var ti = core.TYPES[type];
    if (!ti || !ti.rangeValues) return '';
    var v = ti.rangeValues[tap - 1];
    return v != null ? (num(v) + (type === 'ammeter' ? 'A' : 'V')) : '';
  }

  function rheoGeom(comp, wires, rec, D) {
    var slide = D.slideOf(comp, rec);
    return {
      slide: slide, xl: D.sliderLocalX(slide),   // 箭头落在【真实滑片位置】上
      cWired: termHasWire(wires, comp.id, 2),
      dWired: termHasWire(wires, comp.id, 3),
      // C/D 都没接线 → 滑片悬空：竖线画虚线、顶部不接。
      // 教材上变阻器另一头悬空就是这么处理的（和 电路分析_点击查看电压电流.html 一致）。
      stemDashed: !(termHasWire(wires, comp.id, 2) || termHasWire(wires, comp.id, 3)),
    };
  }

  // 符号本体的局部外接框（含悬空虚线脚，不含引线）。
  // 导线避让和标注定位都用它——**不是** D.bodyBox()，理由见文件头。
  function symRect(it) {
    switch (it.type) {
      case 'battery': {
        var hw = batteryHalf(it.comp) + 4;
        return { x0: -hw, y0: -LONG.h - 2, x1: hw, y1: LONG.h + 2 };
      }
      case 'switch':
        // 断开的刀片抬到 y ≈ −20，梢上还有个实心圆，盒子得够高
        return { x0: -26, y0: -26, x1: 26, y1: 6 };
      case 'bulb': return { x0: -24, y0: -24, x1: 24, y1: 24 };
      case 'ammeter': case 'voltmeter': {
        var m = it.meta;
        return { x0: m.cx - m.r, y0: m.cy - m.r, x1: m.cx + m.r, y1: m.cy + m.r + 26 };
      }
      case 'rheostat': return { x0: -60, y0: -28, x1: 60, y1: 40 };
      default: return { x0: -58, y0: -14, x1: 58, y1: 14 };   // 定值电阻：矩形 ±56 加线宽
    }
  }

  // 局部框 → 世界外接框（rot 只可能是 0/90/180/270，取四个角的外接就够）
  function worldRect(it, D) {
    var r = it.rect, c = it.comp;
    var pts = [[r.x0, r.y0], [r.x1, r.y0], [r.x0, r.y1], [r.x1, r.y1]]
      .map(function (p) { return D.toWorld(c, p[0], p[1]); });
    var xs = pts.map(function (p) { return p.x; }), ys = pts.map(function (p) { return p.y; });
    return { x0: Math.min.apply(null, xs), y0: Math.min.apply(null, ys),
             x1: Math.max.apply(null, xs), y1: Math.max.apply(null, ys) };
  }

  // ============================================================
  // 导线
  // ============================================================

  function axisAligned(pts) {
    for (var i = 1; i < pts.length; i++) {
      if (Math.abs(pts[i].x - pts[i - 1].x) > AXIS_TOL &&
          Math.abs(pts[i].y - pts[i - 1].y) > AXIS_TOL) return false;
    }
    return true;
  }

  // 车道是否空着：会不会压在别的符号身上、会不会和已有的同向线段重合。
  // 骨架照抄 circuit-editor.js:259-281 的 laneFree，两处不同：
  //   1) 「元件外形」换成【符号】外形（rects 来自 symRect，不是 D.bodyBox()）；
  //   2) 竖车道、横车道共用一份——见 orthoRoute 为什么两种都要有。
  // orient 'v'：竖车道，pos 是 x，扫的是 y 区间 [a0,a1]；'h' 反过来。
  function laneFree(orient, pos, a0, a1, rects, segs) {
    var i, k;
    for (i = 0; i < rects.length; i++) {
      var r = rects[i];
      var lo = orient === 'v' ? r.x0 : r.y0, hi = orient === 'v' ? r.x1 : r.y1;
      var s0 = orient === 'v' ? r.y0 : r.x0, s1 = orient === 'v' ? r.y1 : r.x1;
      if (pos > lo - 6 && pos < hi + 6 && a1 > s0 - 6 && a0 < s1 + 6) return false;
    }
    for (k = 0; k < segs.length; k++) {
      var s = segs[k];
      if (s.orient !== orient || Math.abs(s.pos - pos) > 4) continue;
      if (Math.max(s.a0, s.a1) > a0 - 4 && Math.min(s.a0, s.a1) < a1 + 4) return false;
    }
    return true;
  }

  // 斜线的正交化。**只处理本来就是斜的导线**——横平竖直的原走线一根都不动
  // （见 build 里 routeOf 那段）。所以这里不必去还原学生的笔迹，直接给一条干净的外侧车道。
  //
  // 两个坑，都实测过：
  //
  // 1) **车道要和「拉开得多的那个方向」垂直。** 一律用竖车道的话，两点只差
  //    26px 高、却差了 150px 宽的时候（电源正极 → 变阻器 A 柱就是这么接的），
  //    竖车道会逼出一次绕远：先横到画面最左边、再折回来。横向拉开得多就该走横车道。
  //
  // 2) **绕到电路外侧，不走中线。** circuit-editor.js 的 routeTo 取两端横向中点，
  //    在实物尺寸下够用；换成符号之后元件小了一圈，中点离两个端子只有 30px，
  //    画出来是个「Z」字，看着像画歪了。绕到外接框外侧，才是教材上那种方框回路。
  function orthoRoute(p0, p1, box, rects, segs) {
    var dx = Math.abs(p0.x - p1.x), dy = Math.abs(p0.y - p1.y);
    if (dx < 8 || dy < 8) return [p0, p1];
    var vert = dy > dx;                       // 竖着拉开得多 → 走竖车道
    var a0 = vert ? p0.x : p0.y, a1 = vert ? p1.x : p1.y;   // 沿车道法线（决定走哪条车道）
    var b0 = vert ? p0.y : p0.x, b1 = vert ? p1.y : p1.x;   // 沿车道（决定车道要多长）
    var blo = Math.min(b0, b1), bhi = Math.max(b0, b1);
    var clo = vert ? box.x0 : box.y0, chi = vert ? box.x1 : box.y1;
    var side = ((a0 + a1) / 2 >= (clo + chi) / 2) ? 1 : -1;
    var base = snap(side > 0 ? Math.max(a0, a1) + LANE_OUT : Math.min(a0, a1) - LANE_OUT);
    var lane = base;
    for (var k = 0; k < 9; k++) {
      // 只往【外侧】推，不往电路里挤——往里挤就又变回那个「Z」字了
      var L = snap(base + side * k * GRID);
      if (laneFree(vert ? 'v' : 'h', L, blo, bhi, rects, segs)) { lane = L; break; }
    }
    return vert
      ? [p0, { x: lane, y: p0.y }, { x: lane, y: p1.y }, p1]
      : [p0, { x: p0.x, y: lane }, { x: p1.x, y: lane }, p1];
  }

  // ============================================================
  // 铭牌值
  // ============================================================
  function valueOf(it, rec) {
    var c = it.comp, P = c.params || {};
    var core = it.core;
    switch (c.type) {
      case 'battery':
        // 端压和电动势是两个数，电路图上标的是铭牌（电动势）
        return 'E = ' + emfOf(c, rec).toFixed(1) + ' V';
      case 'resistor': {
        var R = (rec && rec.R != null) ? +rec.R : (P.R != null ? +P.R : 10);
        return 'R = ' + num(R) + ' Ω';
      }
      case 'bulb': {
        var v = (P.ratedV != null ? +P.ratedV : (core ? core.lampParams(c).ratedV : 2.5));
        var w = (P.ratedW != null ? +P.ratedW : (core ? core.lampParams(c).Prated : 0.75));
        return num(v) + ' V ' + num(w) + ' W';
      }
      case 'switch':
        return (rec ? rec.closed : !!P.closed) ? '闭合' : '断开';
      case 'ammeter': case 'voltmeter': {
        var t = meterRangeText(c.type, it.meta.tap, core);
        return t ? t + ' 挡' : '';
      }
      case 'rheostat': {
        var mx = (rec && rec.Rmax != null) ? +rec.Rmax : (P.Rmax != null ? +P.Rmax : 20);
        var parts = ['最大 ' + num(mx) + ' Ω', '滑片 ' + num(it.meta.slide)];
        if (rec && rec.mode && rec.mode !== 'open') parts.push('接法 ' + rec.mode);
        return parts.join(' · ');
      }
      default: return '';
    }
  }

  // ============================================================
  // build：场景 → 电路图模型（纯数据，测试全部断在它上面）
  // ============================================================
  function build(scene, results, opts) {
    var D = drawOf(opts);
    var core = coreOf(opts);
    if (!D || !D.TERMINALS) throw new Error('circuit-schematic 需要 circuit-draw.js');
    var comps = (scene && scene.comps) || [];
    var wires = (scene && scene.wires) || [];
    var recs = (results && results.components) || {};
    var values = !(opts && opts.values === false);
    // 图例里那一个个小图标要关掉编号：icon 才 80px 宽，塞一个「R₁」进去
    // 正好压在矩形上，反倒看不清符号长什么样。图例旁边那行字已经点名了。
    var labels = !(opts && opts.labels === false);

    var items = comps.map(function (c) {
      var rec = recs[c.id] || null;
      var it = { id: c.id, type: c.type, x: c.x, y: c.y, rot: c.rot || 0,
                 comp: c, core: core, meta: {}, rect: null, rec: rec };
      if (c.type === 'ammeter' || c.type === 'voltmeter') it.meta = meterGeom(c, wires, D);
      else if (c.type === 'rheostat') it.meta = rheoGeom(c, wires, rec, D);
      else it.meta = {};
      it.rect = symRect(it);
      it.worldRect = worldRect(it, D);
      it.label = labels ? subscript(c.id) : '';
      it.value = values ? valueOf(it, rec) : '';
      return it;
    });
    var byId = {};
    items.forEach(function (it) { byId[it.id] = it; });

    var rects = items.map(function (it) { return worldRect(it, D); });

    // 先算导线，再算外接框——外侧车道的选址要用到全图范围，而全图范围又要
    // 包含导线。先用「元件框 + 端子」估一个初版，够用了：车道只看在左还是在右。
    var rough = rects.slice();
    wires.forEach(function (w) {
      var a = byId[w.a.compId], b = byId[w.b.compId];
      if (!a || !b) return;
      var p0 = D.terminalWorld(a.comp, w.a.termIdx), p1 = D.terminalWorld(b.comp, w.b.termIdx);
      rough.push({ x0: Math.min(p0.x, p1.x), y0: Math.min(p0.y, p1.y),
                   x1: Math.max(p0.x, p1.x), y1: Math.max(p0.y, p1.y) });
    });
    var box = unionBox(rough) || { x0: 0, y0: 0, x1: 0, y1: 0 };

    var segs = [];        // 已经排好的竖段，后面的导线要躲开
    var outWires = [];
    wires.forEach(function (w) {
      var a = byId[w.a.compId], b = byId[w.b.compId];
      if (!a || !b) return;
      var p0 = D.terminalWorld(a.comp, w.a.termIdx);
      var p1 = D.terminalWorld(b.comp, w.b.termIdx);
      var via = (w.via || []).map(function (v) { return { x: v[0], y: v[1] }; });
      var pts = [p0].concat(via, [p1]);
      // 能不动就不动：编辑器 rerouteAll 规划的正交走线、学生拖出来的直线上，
      // 原样搬进电路图。示例电路因此出来的就是那个规整的方框回路，和原来一模一样。
      var kept = axisAligned(pts);
      if (!kept) pts = orthoRoute(p0, p1, box, rects, segs);
      // 记下已经排好的线段，后面的导线要躲开（和 circuit-editor 一样只记同向重合）
      for (var i = 1; i < pts.length; i++) {
        var A = pts[i - 1], B = pts[i];
        if (Math.abs(B.x - A.x) < 1) segs.push({ orient: 'v', pos: B.x, a0: A.y, a1: B.y });
        else if (Math.abs(B.y - A.y) < 1) segs.push({ orient: 'h', pos: B.y, a0: A.x, a1: B.x });
      }
      outWires.push({ pts: pts, kept: kept });
    });

    var all = rects.slice();
    outWires.forEach(function (w) {
      w.pts.forEach(function (p) {
        all.push({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      });
    });
    var full = all.length ? unionBox(all) : null;
    // pad 默认 40（整幅图四周留白）；图例里那一个个小图标要贴边，传个位数进来。
    var pad = (opts && opts.pad != null) ? +opts.pad : PAD;
    return {
      comps: items.map(function (it) {
        return { id: it.id, type: it.type, x: it.x, y: it.y, rot: it.rot,
                 label: it.label, value: it.value,
                 meta: it.meta, rect: it.rect, worldRect: worldRect(it, D) };
      }),
      wires: outWires,
      bounds: full ? { x: full.x0 - pad, y: full.y0 - pad,
                       w: (full.x1 - full.x0) + pad * 2,
                       h: (full.y1 - full.y0) + pad * 2 } : null,
      // 给绘制用的元件顺序：先画导线，符号按原顺序
      _items: items,
    };
  }

  function unionBox(rs) {
    if (!rs.length) return null;
    var o = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    rs.forEach(function (r) {
      o.x0 = Math.min(o.x0, r.x0); o.y0 = Math.min(o.y0, r.y0);
      o.x1 = Math.max(o.x1, r.x1); o.y1 = Math.max(o.y1, r.y1);
    });
    return o;
  }
  function bounds(model) { return model ? model.bounds : null; }

  // ============================================================
  // 绘制
  // ============================================================
  function drawPolys(ctx, pts, color, width, dash) {
    if (pts.length < 2) return;
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (dash) ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.restore();
  }

  function draw(ctx, model, opts) {
    var D = drawOf(opts);
    var items = model._items || [];
    var values = !(opts && opts.values === false);

    ctx.save();
    ctx.fillStyle = (opts && opts.paper) || COLOR.paper;
    var b = model.bounds;
    ctx.fillRect(b ? b.x : 0, b ? b.y : 0, b ? b.w : 1, b ? b.h : 1);

    model.wires.forEach(function (w) { drawPolys(ctx, w.pts, COLOR.wire, 3); });
    items.forEach(function (it) { drawSymbol(ctx, it, D, values); });
    ctx.restore();
  }

  function drawSymbol(ctx, it, D, values) {
    var c = it.comp, T = D.TERMINALS[c.type];
    ctx.save();
    ctx.translate(c.x, c.y);
    if (c.rot) ctx.rotate(c.rot * Math.PI / 180);
    ctx.strokeStyle = COLOR.wire; ctx.lineWidth = 2.4;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.fillStyle = COLOR.wire;

    switch (c.type) {
      case 'resistor': {
        lead(ctx, T[0], -56); lead(ctx, T[1], 56);
        ctx.beginPath();
        D.roundRect(ctx, -56, -13, 112, 26, 2);
        ctx.stroke();
        break;
      }
      case 'battery': {
        var half = batteryHalf(it.comp);
        lead(ctx, T[0], half); lead(ctx, T[1], -half);
        batteryPlates(it.comp).forEach(function (p) {
          ctx.lineWidth = p.lw;
          ctx.beginPath();
          ctx.moveTo(p.x, -p.h); ctx.lineTo(p.x, p.h);
          ctx.stroke();
        });
        break;
      }
      case 'switch': {
        lead(ctx, T[0], -22); lead(ctx, T[1], 22);
        dot(ctx, -22, 0, 3.6); dot(ctx, 22, 0, 3.6);
        ctx.lineWidth = 2.6;
        // 断开时抬起的斜刀片是**刻意的例外**——教材的开关符号就是这么画的。
        // 规矩是「导线横平竖直；只有符号内部的刀片是斜的」。
        var closed = it.rec ? !!it.rec.closed : !!(c.params || {}).closed;
        ctx.beginPath();
        ctx.moveTo(-22, 0);
        ctx.lineTo(closed ? 22 : 6, closed ? 0 : -20);
        ctx.stroke();
        if (!closed) dot(ctx, 6, -20, 3.2);
        break;
      }
      case 'bulb': {
        lead(ctx, T[0], -22); lead(ctx, T[1], 22);
        ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2);
        ctx.fillStyle = COLOR.paper; ctx.fill();
        ctx.strokeStyle = COLOR.wire; ctx.stroke();
        var d = 15;
        ctx.beginPath();
        ctx.moveTo(-d, -d); ctx.lineTo(d, d);
        ctx.moveTo(d, -d); ctx.lineTo(-d, d);
        ctx.stroke();
        break;
      }
      case 'ammeter': case 'voltmeter': {
        var m = it.meta;
        // 引线：从柱子水平引到圆周。没接线的那两根画虚线（悬空）。
        hLead(ctx, T[0], m.cx - m.r, m.posWired);
        if (m.tap) hLead(ctx, T[m.tap], m.cx + m.r, true);
        // 悬空的柱子：一段往下的虚线短脚，让人看出「这儿还有一根柱，没接」
        m.dangling.forEach(function (i) {
          drawPolys(ctx, [{ x: T[i].x, y: T[i].y }, { x: T[i].x, y: T[i].y + 24 }],
                    COLOR.dim, 1.6, true);
        });
        ctx.beginPath(); ctx.arc(m.cx, m.cy, m.r, 0, Math.PI * 2);
        ctx.fillStyle = COLOR.paper; ctx.fill();
        ctx.strokeStyle = COLOR.wire; ctx.lineWidth = 2.4; ctx.stroke();
        ctx.fillStyle = COLOR.wire;
        ctx.font = 'bold 24px Georgia,"Times New Roman",serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(c.type === 'ammeter' ? 'A' : 'V', m.cx, m.cy + 1);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        break;
      }
      case 'rheostat': {
        var g = it.meta;
        lead(ctx, T[0], -56); lead(ctx, T[1], 56);
        ctx.beginPath();
        D.roundRect(ctx, -56, 14, 112, 24, 2);
        ctx.stroke();
        // 滑片：从上面垂下来一根，箭头尖顶到矩形上沿。
        // 横坐标就是 sliderLocalX(slide)——和实物上滑片的位置是同一个数。
        var sx = Math.max(-54, Math.min(54, g.xl));
        drawPolys(ctx, [{ x: sx, y: T[2].y }, { x: sx, y: 14 }],
                  g.stemDashed ? COLOR.dim : COLOR.wire, 2.2, g.stemDashed);
        ctx.save();
        ctx.fillStyle = g.stemDashed ? COLOR.dim : COLOR.wire;
        ctx.beginPath();
        ctx.moveTo(sx, 14); ctx.lineTo(sx - 5, 5); ctx.lineTo(sx + 5, 5);
        ctx.closePath(); ctx.fill();
        ctx.restore();
        // 顶部横线接到用到的 C / D 柱（没接就不画）
        if (g.cWired) drawPolys(ctx, [{ x: sx, y: T[2].y }, { x: T[2].x, y: T[2].y }], COLOR.wire, 2.4);
        if (g.dWired) drawPolys(ctx, [{ x: sx, y: T[3].y }, { x: T[3].x, y: T[3].y }], COLOR.wire, 2.4);
        break;
      }
    }
    ctx.restore();

    // 标注：编号在上、铭牌值在下。**文字不进 rotate**——转 90° 的电阻，
    // 编号不该跟着躺下（电路图上没有躺着的字）。
    var wr = it.worldRect || worldRect(it, D);
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = COLOR.ink;
    ctx.font = 'bold 15px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    if (it.label) ctx.fillText(it.label, (wr.x0 + wr.x1) / 2, wr.y0 - 8);
    if (values && it.value) {
      ctx.fillStyle = COLOR.value;
      ctx.font = '12px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText(it.value, (wr.x0 + wr.x1) / 2, wr.y1 + 15);
    }
    ctx.restore();
  }

  // 从端子画一根引线到符号边缘（沿两端连线方向，端子必定在 x 轴上，所以是水平的）
  function lead(ctx, t, toX) {
    ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.lineTo(toX, t.y); ctx.stroke();
  }
  function hLead(ctx, t, toX, solid) {
    drawPolys(ctx, [{ x: t.x, y: t.y }, { x: toX, y: t.y }],
              solid ? COLOR.wire : COLOR.dim, solid ? 2.4 : 1.6, !solid);
  }
  function dot(ctx, x, y, r) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  // ============================================================
  // 图例：「实物 ↔ 符号」对照。两边都用真渲染器画，所以永远不会和真图漂移。
  // ============================================================
  var LEGEND = [
    { type: 'battery',  name: '电源（干电池盒）', from: '一盒干电池，标着总电压',
      to: '一长一短两条线：长线是正极；几节电池就画几组' },
    { type: 'switch',   name: '开关（闸刀）',     from: '底板上抬起来的那把刀',
      to: '两个圆点加一根刀片：合上时刀片落下接通，断开时斜抬起来' },
    { type: 'resistor', name: '定值电阻',         from: '带四道色环的圆柱',
      to: '一个空心矩形，两端各引一根线' },
    { type: 'rheostat', name: '滑动变阻器',       from: '绕线瓷管加一个滑片',
      to: '矩形加一根朝下的箭头：箭头的位置就是滑片的位置。用到的两个接头画实线，空着的画虚线' },
    { type: 'bulb',     name: '小灯泡',           from: '带灯座的玻璃泡',
      to: '一个圆，里面打一个叉' },
    { type: 'ammeter',  name: '电流表',           from: '三个接线柱的指针表',
      to: '一个圆里写 A，串在电路里；只用到的两根柱接线，另一根画虚线' },
    { type: 'voltmeter', name: '电压表',          from: '三个接线柱的指针表',
      to: '一个圆里写 V，并接在被测元件的两端' },
  ];

  return {
    build: build, draw: draw, bounds: bounds,
    symRect: symRect, worldRect: worldRect,
    LEGEND: LEGEND, subscript: subscript, COLOR: COLOR,
    valueOf: valueOf, cellCount: cellCount, batteryHalf: batteryHalf,
    version: '1.0.0',
  };
});
