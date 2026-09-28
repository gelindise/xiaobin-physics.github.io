/* ============================================================
 * circuit-schematic.js —— 实物图 → 电路图（标准符号）
 * ------------------------------------------------------------
 * 职责：把 circuit-draw.js 画的那张半写实【器材示意图】折成一张课本意义上的
 *       【电路图】：外形换成国标符号，导线走横平竖直，元件按连线摆正，
 *       旁边标上编号（R₁ / A / V / E / S）和可选的铭牌值（10Ω、0.6A 挡、滑片 0.5）。
 * 依赖：circuit-draw.js（端子几何 + 圆角矩形）。可选注入 circuit-core.js
 *       （拿量程挡位的数字；不给就少印那几个数，图照样画得出来）。
 * 不含：物理求解、交互、页面外壳。
 *
 * 电路图要「统一规范」，只要**相对位置**正确即可（用户原话）。所以元件的位置是
 * 【规整化】出来的：按导线连的关系把该在一行/一列的元件摆到严格对齐，位移上限
 * MOVE_MAX。挪的是一份 lay 布局副本，**scene 里的坐标一个都不动**——沙盒主画布上
 * 那台器材是学生亲手摆的。
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

  // ── 规整化（把学生摆得七扭八歪的元件按连线摆正）──
  var MOVE_MAX = 40;      // 一个元件最多挪这么多。【硬契约】，对齐时逐条查
  var ALIGN_RATIO = 4;    // 导线要「够直」才值得为它挪元件
  var ALIGN_GAP = 6;      // 判「两个元件框撞上了」时往外胀的值

  // ── 走线打分 ──
  var BEND = 50;          // 一个拐点
  var BLOCK = 1e6;        // 一段压在元件符号上：一票否决
  var FOREIGN = 500;      // 一段和【别的节点】的导线重合
  var SHORT_LEN = 24;     // 短于这么长的一段算「贴着引脚的台阶」
  var SHORTSEG = 30;      // 台阶罚
  var ESCAPE = 18;        // 端子附近的逃逸走廊：自家符号框在这一小圈里不算障碍
  var PAD_SEG = 6;        // 线段避让时元件框往外胀的值
  var LANE_SPAN = 160;    // 车道枚举范围：两端坐标各往外这么远，**不截断**
  var LANE_OUT_K = 4;     // 外框兜底车道往外留几条（1 条的话兜底的线全重合）

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
        // 就画到圆周为止。空着的那根量程柱**不再画虚脚**（原来往下多留 26px），
        // 那根虚脚固定在离圆心 100px 外，画出来是画面正中凭空一根小竖线。
        return { x0: m.cx - m.r, y0: m.cy - m.r, x1: m.cx + m.r, y1: m.cy + m.r };
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
  // 同一个局部框、换一个（试探性的）位置，算出来的世界框。
  // 对齐的重叠预检要「落地前先试」，靠的就是它。
  function worldRectAt(it, x, y, D) {
    return worldRect({ rect: it.rect, comp: { x: x, y: y, rot: it.lay.rot } }, D);
  }
  function rectHit(p, q) {
    return p.x0 - ALIGN_GAP < q.x1 && p.x1 + ALIGN_GAP > q.x0 &&
           p.y0 - ALIGN_GAP < q.y1 && p.y1 + ALIGN_GAP > q.y0;
  }

  // ============================================================
  // 规整化：按【导线】连的关系把元件摆正
  // ------------------------------------------------------------
  // 学生摆的是「差不多一行」，出来就是「差 30px 的一行」，导线跟着拐，整张图就散。
  // 用户授权：「只要相对位置正确即可」。所以这里挪元件——**挪的是 lay 副本，scene 不动**。
  //
  // 三个不能再犯的错（都是设计评审抓出来的）：
  //
  // 1) 位移必须在【约束落地的那一刻】封顶。并查集式地「一个定了一个没定 → 没定的去凑」
  //    会沿链传播：R1—R2—R3—R4 各差 80px 串起来，最后一个能被拖 200px。
  // 2) 「定没定」要【分轴】。拿整体位置判定，会把「x 已被锁死、y 其实自由」的约束
  //    误判成冲突而跳过。
  // 3) 【本来就相等】的约束不许并进组。变阻器的 C/D 次轴偏移恒等，这种
  //    「永远触发、永远无事」的约束会把两个元件并到一起，让另一个轴向的无关约束串过来。
  //
  // 锚点取的是【端子】而不是元件中心：电表的圆画在 local (−35,+72)，圆心 y 和它三个
  // 柱子的 y 相同，所以对齐柱子 = 圆心正好落在导线上；对齐中心反而会把圆挪到离导线
  // 72px 的地方，导线还多一个折角。变阻器 A/B 在 +26、C/D 在 −26 也是同理——
  // 对齐端子导线才是直的，而「直」正是这个功能要的东西。
  function alignLayout(items, byId, wires, D) {
    items.forEach(function (it) {
      it._off = D.TERMINALS[it.type].map(function (t) {
        var w = D.toWorld(it.lay, t.x, t.y);
        return { x: w.x - it.lay.x, y: w.y - it.lay.y };
      });
      it._fix = { x: null, y: null };
      it._orig = { x: it.lay.x, y: it.lay.y };
    });

    var cand = [];
    wires.forEach(function (w, wi) {
      if (!w.a || !w.b) return;
      var a = byId[w.a.compId], b = byId[w.b.compId];
      if (!a || !b || a === b) return;
      var oa = a._off[w.a.termIdx], ob = b._off[w.b.termIdx];
      if (!oa || !ob) return;
      var ax = a.lay.x + oa.x, bx = b.lay.x + ob.x;
      var ay = a.lay.y + oa.y, by = b.lay.y + ob.y;
      var dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
      var minor = Math.min(dx, dy), major = Math.max(dx, dy);
      if (minor < 1) return;                     // 本来就直，别建立连接
      if (minor > 2 * MOVE_MAX) return;          // 差太远，不是「本来该在一行」的
      if (major < ALIGN_RATIO * minor) return;   // 不够直，不值得动元件
      var horiz = dx >= dy;
      cand.push({ wi: wi, a: a, b: b, oa: oa, ob: ob, len: major + minor,
                  axis: horiz ? 'y' : 'x',
                  av: horiz ? ay : ax, bv: horiz ? by : bx });
    });
    // 长线是更强的「本该是直的」证据，先满足它；同长按场景顺序，结果才确定
    cand.sort(function (p, q) { return (q.len - p.len) || (p.wi - q.wi); });

    cand.forEach(function (cd) {
      var ax = cd.axis;
      var V = snap((cd.av + cd.bv) / 2);
      var na = V - cd.oa[ax], nb = V - cd.ob[ax];
      if (Math.abs(na - cd.a._orig[ax]) > MOVE_MAX) return;   // ← 位移封顶（契约）
      if (Math.abs(nb - cd.b._orig[ax]) > MOVE_MAX) return;
      // 冲突就跳过，**不许取平均**——平均会把两边都挪成谁也不想要的数
      if (cd.a._fix[ax] != null && Math.abs(cd.a._fix[ax] - na) > 0.5) return;
      if (cd.b._fix[ax] != null && Math.abs(cd.b._fix[ax] - nb) > 0.5) return;
      // 落地前先试一遍：撞上别的元件就整条放弃。
      // 放在「落地前」而不是「事后回退」——事后回退会出现一边挪了、一边退回，
      // 线还是斜的、元件白挪，比什么都不做更差。
      var oa0 = cd.a.lay[ax], ob0 = cd.b.lay[ax];
      cd.a.lay[ax] = na; cd.b.lay[ax] = nb;
      if (layoutHits(items, D, cd.a.id, cd.b.id)) {
        cd.a.lay[ax] = oa0; cd.b.lay[ax] = ob0; return;
      }
      cd.a._fix[ax] = na; cd.b._fix[ax] = nb;
    });
  }

  // 按当前 lay 位置铺一遍世界框，看有没有哪一对撞上（只看涉及这两个元件的对）
  function layoutHits(items, D, idA, idB) {
    var rs = items.map(function (it) { return { id: it.id, r: worldRectAt(it, it.lay.x, it.lay.y, D) }; });
    for (var i = 0; i < rs.length; i++) {
      for (var j = i + 1; j < rs.length; j++) {
        if (rs[i].id !== idA && rs[i].id !== idB &&
            rs[j].id !== idA && rs[j].id !== idB) continue;
        if (rectHit(rs[i].r, rs[j].r)) return true;
      }
    }
    return false;
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
  // 拐几个弯。**不只看「横平竖直」**：TRAIL_TOL=6 的手划曲线能留下几十个拐点，
  // 一条单调楼梯的长度恰等于曼哈顿距离、形状却很怪——只看长度比是拦不住的。
  function bendCount(pts) {
    var n = 0, dir = null;
    for (var i = 1; i < pts.length; i++) {
      var dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y;
      if (Math.abs(dx) < AXIS_TOL && Math.abs(dy) < AXIS_TOL) continue;
      var d = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : (dy > 0 ? 'S' : 'N');
      if (dir && dir !== d) n++;
      dir = d;
    }
    return n;
  }

  // ── 障碍判定 ──
  // **线段 × 外接盒的真实求交**，不是「只看两端点」。一条 L 的横段两端都在盒外、
  // 中段正中穿过电阻——端点检查抓不到，那正是旧实现里「导线压在元件身上」的来源。
  // 返回相交区间；不相交返回 null。pad 是把盒子往外胀的值。
  function segHitsRect(a, b, r, pad) {
    var lo, hi;
    if (Math.abs(a.x - b.x) < 1) {                       // 竖段
      if (a.x <= r.x0 - pad || a.x >= r.x1 + pad) return null;
      lo = Math.max(Math.min(a.y, b.y), r.y0 - pad);
      hi = Math.min(Math.max(a.y, b.y), r.y1 + pad);
      return hi > lo ? { x0: a.x, y0: lo, x1: a.x, y1: hi } : null;
    }
    if (a.y <= r.y0 - pad || a.y >= r.y1 + pad) return null;
    lo = Math.max(Math.min(a.x, b.x), r.x0 - pad);
    hi = Math.min(Math.max(a.x, b.x), r.x1 + pad);
    return hi > lo ? { x0: lo, y0: a.y, x1: hi, y1: a.y } : null;
  }
  // 这段相交是不是整个落在端子 p 的逃逸走廊里（自家符号框在端子那一小圈不算障碍）
  function nearEnd(h, p) {
    return Math.abs(h.x0 - p.x) <= ESCAPE && Math.abs(h.x1 - p.x) <= ESCAPE &&
           Math.abs(h.y0 - p.y) <= ESCAPE && Math.abs(h.y1 - p.y) <= ESCAPE;
  }
  // excl: [{idx, p}] —— 本线两端各自的元件框下标 + 自己的端子坐标
  function segBlocks(a, b, rects, excl) {
    var hit = 0;
    for (var i = 0; i < rects.length; i++) {
      var h = segHitsRect(a, b, rects[i], PAD_SEG);
      if (!h) continue;
      var skip = false;
      for (var k = 0; k < excl.length; k++) {
        if (excl[k].idx === i && nearEnd(h, excl[k].p)) { skip = true; break; }
      }
      if (!skip) hit++;
    }
    return hit;
  }
  function segOverlaps(a, b, segs, net) {
    var vert = Math.abs(a.x - b.x) < 1;
    var pos = vert ? a.x : a.y;
    var lo = vert ? Math.min(a.y, b.y) : Math.min(a.x, b.x);
    var hi = vert ? Math.max(a.y, b.y) : Math.max(a.x, b.x);
    var n = 0;
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (s.net === net) continue;                    // 同一节点：教材上本来就允许共用一段
      if (s.orient !== (vert ? 'v' : 'h')) continue;
      if (Math.abs(s.pos - pos) > 4) continue;
      if (Math.max(s.a0, s.a1) > lo - 4 && Math.min(s.a0, s.a1) < hi + 4) n++;
    }
    return n;
  }

  // 电气「节点」。两根导线只要共用同一个 {compId, termIdx} 就算同一节点。
  // 只用来做两件事：① 同节点的线允许共用一段；② 判该不该画结点圆点。
  // **不是**求解器的连通性——那个看电路通不通，是另一回事。
  function netOf(wires) {
    var parent = wires.map(function (_, i) { return i; });
    function find(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
    var term = {};
    wires.forEach(function (w, i) {
      [w.a, w.b].forEach(function (e) {
        if (!e) return;
        var k = e.compId + ':' + e.termIdx;
        if (term[k] != null) { var x = find(i), y = find(term[k]); if (x !== y) parent[x] = y; }
        else term[k] = i;
      });
    });
    return { wire: wires.map(function (_, i) { return find(i); }), term: term };
  }

  // ============================================================
  // 走线：候选 + 打分
  // ------------------------------------------------------------
  // 旧实现（orthoRoute）有两个病，都实测过：
  //   1) 一律甩到【整幅图外接框的外侧车道】，多根线叠成一圈同心框——用户抱怨的「乱」；
  //   2) 只检查中间那条车道，**两端各一段「短脚」根本不检查**，导线横着穿过电阻。
  // 现在改成：把所有像样的走法都摆出来，按代价挑最优的那个。
  //
  // 两个关键的量纲判断：
  //   · 候选车道**不按「离中点近」截断**。离中点最近的那几条恰好最可能穿电路内部，
  //     学生那条干净的绕行车道反而排在最外面，一截断就永远进不了候选。
  //   · 压元件（1e6）远大于拐点（50）远大于台阶（30），量级拉开但不是单调的「长度最小」——
  //     否则 1px 擦边就会换来 600px 的绕路。
  function scorePath(pts, rects, segs, excl, net) {
    var cost = 0, n = 0;
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i];
      var len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      if (len < 0.5) continue;
      n++;
      cost += len;
      if (len < SHORT_LEN) cost += SHORTSEG;
      cost += BLOCK * segBlocks(a, b, rects, excl);
      cost += FOREIGN * segOverlaps(a, b, segs, net);
    }
    var bends = Math.max(0, n - 1);
    return { cost: cost + BEND * bends, bends: bends };
  }
  function firstLegH(pts) {
    for (var i = 1; i < pts.length; i++) {
      if (Math.abs(pts[i].x - pts[0].x) > AXIS_TOL) return true;
      if (Math.abs(pts[i].y - pts[0].y) > AXIS_TOL) return false;
    }
    return true;
  }
  function keySum(pts) {
    var s = 0;
    pts.forEach(function (p) { s += Math.abs(p.x) + Math.abs(p.y); });
    return s;
  }

  function routeWire(p0, p1, box, rects, segs, excl, net) {
    var cands = [], seen = {};
    function add(raw) {
      var out = [raw[0]];
      for (var i = 1; i < raw.length; i++) {
        var p = raw[i], q = out[out.length - 1];
        if (Math.abs(p.x - q.x) > AXIS_TOL || Math.abs(p.y - q.y) > AXIS_TOL) out.push(p);
      }
      if (out.length < 2) return;
      var k = out.map(function (p) { return p.x + ',' + p.y; }).join('|');
      if (seen[k]) return;
      seen[k] = 1; cands.push(out);
    }
    var adx = Math.abs(p1.x - p0.x), ady = Math.abs(p1.y - p0.y);
    var i, x, y;

    if (adx < 1 || ady < 1) add([p0, p1]);
    // 两个 L。端子坐标恒是 ±70 加在 20 的倍数上 → ≡10 (mod 20)，不是 GRID 的倍数，
    // 所以这两个 L 和下面的「GRID 车道」是两批不同的候选，都得有。
    add([p0, { x: p1.x, y: p0.y }, p1]);
    add([p0, { x: p0.x, y: p1.y }, p1]);
    // 全部 GRID 竖车道
    for (x = snap(Math.min(p0.x, p1.x) - LANE_SPAN); x <= Math.max(p0.x, p1.x) + LANE_SPAN; x += GRID) {
      add([p0, { x: x, y: p0.y }, { x: x, y: p1.y }, p1]);
    }
    // 全部 GRID 横车道
    for (y = snap(Math.min(p0.y, p1.y) - LANE_SPAN); y <= Math.max(p0.y, p1.y) + LANE_SPAN; y += GRID) {
      add([p0, { x: p0.x, y: y }, { x: p1.x, y: y }, p1]);
    }
    // 外框兜底：往里挤没戏了，只能一圈圈往外让。**留 4 条**——只留 1 条的话
    // 所有兜底的线都落在同一条车道上，又变回那圈同心框。
    for (i = 0; i < LANE_OUT_K; i++) {
      var L = LANE_OUT + i * GRID;
      add([p0, { x: snap(box.x0 - L), y: p0.y }, { x: snap(box.x0 - L), y: p1.y }, p1]);
      add([p0, { x: snap(box.x1 + L), y: p0.y }, { x: snap(box.x1 + L), y: p1.y }, p1]);
      add([p0, { x: p0.x, y: snap(box.y0 - L) }, { x: p1.x, y: snap(box.y0 - L) }, p1]);
      add([p0, { x: p0.x, y: snap(box.y1 + L) }, { x: p1.x, y: snap(box.y1 + L) }, p1]);
    }

    var wantH = adx >= ady;      // 主轴优先：L_h 和 L_v 长度、拐点数完全相同，必须给个确定的规矩
    var best = null, bestS = null, bestPref = 0;
    cands.forEach(function (pts) {
      var r = scorePath(pts, rects, segs, excl, net);
      var pref = (firstLegH(pts) === wantH) ? 0 : 1;
      if (!best) { best = pts; bestS = r; bestPref = pref; return; }
      if (r.cost < bestS.cost - 0.5) { best = pts; bestS = r; bestPref = pref; return; }
      if (r.cost > bestS.cost + 0.5) return;
      if (pref !== bestPref) { if (pref < bestPref) { best = pts; bestS = r; bestPref = pref; } return; }
      if (r.bends !== bestS.bends) { if (r.bends < bestS.bends) { best = pts; bestS = r; bestPref = pref; } return; }
      if (keySum(pts) < keySum(best)) { best = pts; bestS = r; bestPref = pref; }
    });
    return best || [p0, p1];
  }

  // 「能不动就不动」的判据：横平竖直 + 拐点不超过 3 个 + 不压元件 + 不和别的节点的线重合。
  // （旧实现只看第一条，于是手划的曲线和压着元件的线都被原样搬了进来。）
  function pathClear(pts, rects, segs, excl, net) {
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i];
      if (Math.abs(b.x - a.x) + Math.abs(b.y - a.y) < 0.5) continue;
      if (segBlocks(a, b, rects, excl) > 0) return false;
      if (segOverlaps(a, b, segs, net) > 0) return false;
    }
    return true;
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
      // 布局副本：规整化要挪元件，**绝不能碰 scene**——沙盒主画布上那台器材是学生
      // 摆的，一个像素都不能动。params 仍共享引用（读数要用同一份）。
      var lay = { id: c.id, type: c.type, x: c.x, y: c.y, rot: c.rot || 0,
                  params: c.params || {} };
      var it = { id: c.id, type: lay.type, x: lay.x, y: lay.y, rot: lay.rot,
                 comp: lay, lay: lay, src: c, core: core, meta: {}, rect: null, rec: rec };
      if (lay.type === 'ammeter' || lay.type === 'voltmeter') it.meta = meterGeom(lay, wires, D);
      else if (lay.type === 'rheostat') it.meta = rheoGeom(lay, wires, rec, D);
      else it.meta = {};
      it.rect = symRect(it);                  // 局部框：只和 params / meta 有关，与位置无关
      it.label = labels ? subscript(lay.id) : '';
      it.value = values ? valueOf(it, rec) : '';
      return it;
    });
    var byId = {};
    items.forEach(function (it, i) { byId[it.id] = it; it._ri = i; });

    // 规整化。**顺序不能反**：先算布局，再算世界框。反了就是拿【旧】坐标算框，
    // 路由器照着旧盒子避让，症状是「导线从刚挪过来的元件身上穿过去」。
    if (!(opts && opts.regularize === false)) alignLayout(items, byId, wires, D);
    items.forEach(function (it) { it.x = it.lay.x; it.y = it.lay.y; it.comp = it.lay; });

    var rects = items.map(function (it) { return worldRect(it, D); });
    items.forEach(function (it, i) { it.worldRect = rects[i]; });

    // 外接框：外侧兜底车道的选址要用到全图范围
    var rough = rects.slice();
    wires.forEach(function (w) {
      if (!w.a || !w.b) return;
      var a = byId[w.a.compId], b = byId[w.b.compId];
      if (!a || !b) return;
      var p0 = D.terminalWorld(a.comp, w.a.termIdx), p1 = D.terminalWorld(b.comp, w.b.termIdx);
      rough.push({ x0: Math.min(p0.x, p1.x), y0: Math.min(p0.y, p1.y),
                   x1: Math.max(p0.x, p1.x), y1: Math.max(p0.y, p1.y) });
    });
    var box = unionBox(rough) || { x0: 0, y0: 0, x1: 0, y1: 0 };

    var nets = netOf(wires);
    var segs = [];        // 已经排好的线段，后面的导线要躲开
    var outWires = [];
    wires.forEach(function (w, wi) {
      if (!w.a || !w.b) return;
      var a = byId[w.a.compId], b = byId[w.b.compId];
      if (!a || !b) return;
      var p0 = D.terminalWorld(a.comp, w.a.termIdx);
      var p1 = D.terminalWorld(b.comp, w.b.termIdx);
      var myNet = nets.wire[wi];
      var excl = [{ idx: a._ri, p: p0 }, { idx: b._ri, p: p1 }];
      var via = (w.via || []).map(function (v) { return { x: v[0], y: v[1] }; });
      var pts = [p0].concat(via, [p1]);
      // 能不动就不动：编辑器 rerouteAll 规划的正交走线、学生拖出来的直线上，原样搬进
      // 电路图，示例电路因此出来的就是那个规整的方框回路。但**得是真干净的走线才留**：
      // 横平竖直、拐点不超过 3 个、不压元件、不和别的节点的线重合，四条缺一就重排。
      var kept = axisAligned(pts) && bendCount(pts) <= 3 &&
                 pathClear(pts, rects, segs, excl, myNet);
      if (!kept) pts = routeWire(p0, p1, box, rects, segs, excl, myNet);
      for (var i = 1; i < pts.length; i++) {
        var A = pts[i - 1], B = pts[i];
        if (Math.abs(B.x - A.x) < 1) segs.push({ orient: 'v', pos: B.x, a0: A.y, a1: B.y, net: myNet });
        else if (Math.abs(B.y - A.y) < 1) segs.push({ orient: 'h', pos: B.y, a0: A.x, a1: B.x, net: myNet });
      }
      outWires.push({ pts: pts, kept: kept, _net: myNet });
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
                 meta: it.meta, rect: it.rect, worldRect: it.worldRect };
      }),
      wires: outWires,
      junctions: junctionsOf(outWires),
      bounds: full ? { x: full.x0 - pad, y: full.y0 - pad,
                       w: (full.x1 - full.x0) + pad * 2,
                       h: (full.y1 - full.y0) + pad * 2 } : null,
      // 给绘制用的元件顺序：先画导线，符号按原顺序
      _items: items,
    };
  }

  // ============================================================
  // 结点圆点
  // ------------------------------------------------------------
  // 判据**两条**，都只认「电气上真的连在一起」：
  //   ① ≥3 根导线的端点落在同一点（三线交汇，教材上必画点）；
  //   ② 一根导线的顶点（端点**或拐点**）严格落在另一根导线的某段【内部】，
  //      且这两根导线共用同一个端子。
  // 第 ② 条的「共用端子」限定不能省：求解器的连通性只看端子共点、不看几何相交，
  // 在不相干的交叉处画点，图和数当场自相矛盾；元件自己柱子上挂两根线也会被误判成结点。
  // 两端相接的普通拐角不画点。
  function junctionsOf(outWires) {
    var seen = {}, out = [];
    function key(p) { return Math.round(p.x) + ',' + Math.round(p.y); }
    function push(p) {
      var k = key(p);
      if (seen[k]) return;
      seen[k] = 1; out.push({ x: p.x, y: p.y });
    }
    var ends = {};
    outWires.forEach(function (w) {
      [w.pts[0], w.pts[w.pts.length - 1]].forEach(function (p) {
        var k = key(p); ends[k] = (ends[k] || 0) + 1;
      });
    });
    Object.keys(ends).forEach(function (k) {
      if (ends[k] < 3) return;
      var xy = k.split(',');
      push({ x: +xy[0], y: +xy[1] });
    });

    outWires.forEach(function (w, i) {
      w.pts.forEach(function (v) {
        outWires.forEach(function (u, j) {
          if (i === j || w._net !== u._net) return;
          for (var k = 1; k < u.pts.length; k++) {
            var A = u.pts[k - 1], B = u.pts[k];
            if (Math.abs(A.x - B.x) < 1 && Math.abs(v.x - A.x) < 1) {
              if (v.y > Math.min(A.y, B.y) + 1 && v.y < Math.max(A.y, B.y) - 1) push(v);
            } else if (Math.abs(A.y - B.y) < 1 && Math.abs(v.y - A.y) < 1) {
              if (v.x > Math.min(A.x, B.x) + 1 && v.x < Math.max(A.x, B.x) - 1) push(v);
            }
          }
        });
      });
    });
    return out;
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
    // 结点圆点画在导线之后、符号之前
    (model.junctions || []).forEach(function (j) {
      ctx.beginPath();
      ctx.arc(j.x, j.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = COLOR.wire;
      ctx.fill();
    });
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
        // 空着的那根量程柱**不画虚脚**：那根短脚固定在离圆心 100px 外，
        // 画出来是画面正中凭空一根小竖线，反倒像根走错路的导线。
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
      to: '一个圆里写 A，串在电路里；用到的两根柱各引一根线，空着那根不画' },
    { type: 'voltmeter', name: '电压表',          from: '三个接线柱的指针表',
      to: '一个圆里写 V，并接在被测元件的两端' },
  ];

  return {
    build: build, draw: draw, bounds: bounds,
    symRect: symRect, worldRect: worldRect,
    LEGEND: LEGEND, subscript: subscript, COLOR: COLOR,
    valueOf: valueOf, cellCount: cellCount, batteryHalf: batteryHalf,
    // 规整化/走线的常量：测试要断言「位移 ≤ MOVE_MAX」，从这里取，
    // 免得内核改了上限、测试还按老数字断（那就成了自证）
    MOVE_MAX: MOVE_MAX,
    version: '2.0.0',
  };
});
