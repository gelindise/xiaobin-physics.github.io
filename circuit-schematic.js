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
 * 规整化是自动的，总有摆不到学生心坎上的时候。所以 build 认一个可选的
 * opts.place = { 元件id: {x, y} }：拖过的那几件钉在这个坐标上，其余仍走自动布局。
 * 位置一变，导线按新位置重新绕 —— 手工微调因此**不需要**另写一套布线。
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
  var TERMDOT = 400;      // 一段从【别的节点】的接线柱正上方压过去
  var CROSS = 120;        // 一段和【别的节点】的线十字交叉（教材尽量避免交叉）
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
    warn:   '#b45309',    // 图上那行提醒（接错线之类）
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
  // 这个元件一根导线都没接。图例里的图标就是这种（画全引线，否则符号会飘着）。
  function compHasWire(wires, compId) {
    for (var i = 0; i < wires.length; i++) {
      var w = wires[i];
      if ((w.a && w.a.compId === compId) || (w.b && w.b.compId === compId)) return true;
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
  //
  // ⚠️ 只画【一节】（一长一短两根竖线），不再按 cellCount 画 n 节。
  //    用户点名要去掉的就是多出来的那一组：一盒 3V 的电池在电路图上被画成
  //    四根竖线，学生数出来是「四节」，而它其实是两节 1.5V 串成的 —— 数错了。
  //    课本上电源的符号就是一个电池符号（一长一短），几节、总电压多少写在
  //    符号旁边的「E = 3.0 V」上（见 valueOf），不靠竖线的根数去表达。
  //    cellCount() 本身留着：它是「电动势反推节数」那条规矩的唯一出处，
  //    实物那边的干电池盒（circuit-draw 的 batterySize）要用它。
  function batteryPlates(comp) {
    return [
      { x:  CELL_INNER / 2, h: LONG.h,  lw: LONG.lw },   // 右：长线 = 正极
      { x: -CELL_INNER / 2, h: SHORT.h, lw: SHORT.lw },  // 左：短线 = 负极
    ];
  }
  // 引线终点 = 极板所在处（和电阻的 lead(ctx,T,-56) 一个规矩：引线画到符号本体边上，
  // 不留缝、也不插进符号里面）。symRect 的框宽也跟着它走。
  function batteryHalf(comp) { return CELL_INNER / 2; }

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
      // A/B 是电阻丝的两端（下面那两根）。没接的那根不画引线——人教版只画接上的线，
      // 画出来是一截伸向空处的断头线。整件一根线都没接（图例图标）时照画全。
      aWired: termHasWire(wires, comp.id, 0),
      bWired: termHasWire(wires, comp.id, 1),
      anyWire: compHasWire(wires, comp.id),
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
      // 二极管的框要高一点：符号右上方还有两个表示发光的箭头，
      // 框住它们导线才不会从箭头上穿过去。
      case 'led': return { x0: -22, y0: -30, x1: 26, y1: 18 };
      case 'motor': return { x0: -24, y0: -24, x1: 24, y1: 24 };
      // 电铃：拱顶到 y=−18，底边在 0，铃舌垂到 y≈12。框要罩住铃舌，
      // 导线才不会从铃舌上穿过去。
      case 'bell': return { x0: -22, y0: -22, x1: 22, y1: 14 };
      case 'ammeter': case 'voltmeter': {
        var m = it.meta;
        // 就画到圆周为止。空着的那根量程柱**不再画虚脚**（原来往下多留 26px），
        // 那根虚脚固定在离圆心 100px 外，画出来是画面正中凭空一根小竖线。
        return { x0: m.cx - m.r, y0: m.cy - m.r, x1: m.cx + m.r, y1: m.cy + m.r };
      }
      // 电阻丝 14..38，滑片杆顶在 0（= 轴线）。墨迹框要够高才放得下上面的编号
      case 'rheostat': return { x0: -60, y0: -6, x1: 60, y1: 40 };
      default: return { x0: -58, y0: -14, x1: 58, y1: 14 };   // 定值电阻：矩形 ±56 加线宽
    }
  }

  // 走线避让用的【障碍框】。多数元件就是上面那个符号框；滑动变阻器要单独收一收。
  // ------------------------------------------------------------
  // 变阻器的墨迹一直顶到箭头杆顶端（局部 −28），可杆顶恰恰就是滑片引线的落点
  // （见 schTermWorld）。把整件圈成障碍，导线想从主回路直接落到杆顶就会被判成
  // 「压元件」，只能先爬到上方车道再折下来——平白多两个拐点，主回路上的三岔口
  // 也被推离导线、画不出结点。真正挡视线的是那块【电阻丝】；杆和引线是细线，
  // 别的线横穿过去顶多是个交叉，不是压符号。所以避让框只圈电阻丝。
  // ⚠️ 下标必须和 rects 一一对齐——excl 里存的是下标。
  function obsRect(it) {
    if (it.type === 'rheostat') return { x0: -60, y0: 8, x1: 60, y1: 40 };
    return it.rect;
  }

  // 滑动变阻器在【电路图】里的滑片接点：箭头杆的顶端，不是 C/D 那两个角。
  // ------------------------------------------------------------
  // 实物上 C(2)/D(3) 是金属杆的两端，core 里就是同一个节点（TYPES.rheostat.internalShort
  // = [2,3]），滑片在杆上任意位置都跟它们等电位。教材的变阻器符号也是这么画的：引线从
  // 箭头【正上方】出去，杆顶就是那个接点。
  //
  // 照实物坐标（±78, −26）引线的话，导线得先绕到左上角、再沿顶部横穿到滑片——那条
  // 「横贯线」加上绕行的外线，画出来正好是一个套住电阻丝的方框（用户截图里那副样子），
  // 而且框里还嵌着一个矩形，看着像电流绕了个圈。合并成杆顶一个点就干净了：
  // 导线直接落在滑片正上方，箭头照旧指向电阻丝。
  var RHEO_STEM_TOP = 0;        // 箭头杆顶端（局部 y）。取 0 = 元件的轴线，引线正好压在导线上
  // 【左右镜像】。元件在回路里朝哪一头，由 rectPlace 按回路走向定；朝向不对时
  // 不能转 180°——变阻器的滑片杆长在顶上、电表的三个柱全在下方，转过去就头朝下了。
  // 所以用一个只翻左右、竖直方向不动的镜像（comp.mir，绘制层用 ctx.scale(-1,1) 实现）。
  // 这里要跟着翻：端子在局部坐标里 x 取反，导线才落得到镜像后的柱子上。
  function schTermWorld(it, termIdx, D) {
    var mir = !!(it.comp && it.comp.mir);
    if (it.type === 'rheostat' && termIdx >= 2) {
      var sx = Math.max(-54, Math.min(54, it.meta.xl));   // 和 drawSymbol 的 sx 取同一段
      return D.toWorld(it.comp, mir ? -sx : sx, RHEO_STEM_TOP);
    }
    if (mir) {
      var t = D.TERMINALS[it.type][termIdx];
      return D.toWorld(it.comp, -t.x, t.y);
    }
    return D.terminalWorld(it.comp, termIdx);
  }

  // 元件的【轴线】局部 y：导线该落在元件哪条水平线上。
  // 一般取两个端子的平均（两端元件的端子本来就同高，等于没算）。
  // 滑动变阻器要单独说：它一个接点在电阻丝一端（A/B，+26）、一个在滑片杆顶（0），
  // 取平均会得到 13，整件被往下拽 13px——滑片引线于是落在导线上方，主回路走到
  // 变阻器跟前必须拐个台阶才下得来，顺带把 V 表引线搭上主回路那个三岔口也推歪了。
  // 取杆顶（0）当轴：滑片引线正好压在导线上，电阻丝规规矩矩骑在导线下面。
  function axisYOf(type, tA, tB) {
    if (type === 'rheostat') return RHEO_STEM_TOP;
    return (tA.y + tB.y) / 2;
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
  // 人教版版面：把回路重排成「两排长方形」
  // ------------------------------------------------------------
  // 上面 alignLayout 只微调、不重排，学生摆歪的回路出来还是歪的（实测把 MOVE_MAX 提到
  // 200px 画面纹丝不动——弯的线压根进不了那个对齐循环）。人教版要求：长方形、导线
  // 横平竖直、元件均匀分布、元件不能落在拐角。
  //
  // 一个简单回路必可拆成两条弧：一条摆下排、一条摆上排，两端各用一根竖线连起来——
  // 正是人教版那种「上下两条长边放元件、左右两条短边走线」的宽矩形，且没有一个元件
  // 落在拐角。**所有元件 rot 恒 0**：电表的 A/V 字母是在旋转过的坐标系里 fillText 的，
  // 转到竖边字母就躺倒；电池端子 0 是「+」在右，旋转会动极性显示。
  //
  // 任何一处不趁手（断路、多电源、有孤岛、复杂桥接……）就返回 false；
  // 沙盒随后尝试基于接线关系的通用网格排版，其余旧调用仍可选择小幅对齐。
  var ROW_GAP = 80;      // 同一排里相邻元件之间的净空
  var ROW_H = 260;       // 上下两排端点线之间的间距
  var ROW_X = 160;       // 回路左边界（竖线大致落在这条线附近）
  var ROW_IN = 60;       // 元件离左右边界再内缩这么多 → 拐角处必定空着
  var BRANCH_OFF = 120;  // 并联支路离被测件的垂直距离（往矩形外侧让）

  // 这个元件在回路里【真用到的两个端子】。用不到两个（没接线/悬空）→ null。
  function usedTerms(it, wires) {
    if (it.type === 'ammeter' || it.type === 'voltmeter') {
      if (!it.meta.posWired || !it.meta.tap) return null;
      return [0, it.meta.tap];
    }
    if (it.type === 'rheostat') {
      var u = [0, 1, 2, 3].filter(function (i) { return termHasWire(wires, it.id, i); });
      return u.length === 2 ? u : null;
    }
    if (termHasWire(wires, it.id, 0) && termHasWire(wires, it.id, 1)) return [0, 1];
    return null;
  }

  // 端子并查集 → 每个元件当成「两个节点之间的一条边」。不连通就返回 null。
  function netGraph(items, byId, wires) {
    var parent = {};
    function find(k) {
      if (parent[k] == null) { parent[k] = k; return k; }
      while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; }
      return k;
    }
    function key(cid, ti) { return cid + ':' + ti; }
    wires.forEach(function (w) {
      if (!w.a || !w.b) return;
      if (!byId[w.a.compId] || !byId[w.b.compId]) return;
      var x = find(key(w.a.compId, w.a.termIdx)), y = find(key(w.b.compId, w.b.termIdx));
      if (x !== y) parent[x] = y;
    });
    var ids = {}, next = 0;
    function nid(k) { var r = find(k); if (ids[r] == null) ids[r] = next++; return ids[r]; }
    var edges = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var ut = usedTerms(it, wires);
      if (!ut) return null;                       // 有元件没接满两个端子
      var a = nid(key(it.id, ut[0])), b = nid(key(it.id, ut[1]));
      if (a === b) return null;                   // 两端同节点：被短接，别重排
      edges.push({ compId: it.id, type: it.type, tA: ut[0], tB: ut[1], a: a, b: b });
    }
    // 全图必须连成一片，否则没进回路的那块会被摆到谁也够不着的地方
    var np = {};
    edges.forEach(function (e) { np[e.a] = e.a; np[e.b] = e.b; });
    function nfind(k) { while (np[k] !== k) { np[k] = np[np[k]]; k = np[k]; } return k; }
    edges.forEach(function (e) { var x = nfind(e.a), y = nfind(e.b); if (x !== y) np[x] = y; });
    var set = {};
    Object.keys(np).forEach(function (k) { set[nfind(k)] = 1; });
    if (Object.keys(set).length !== 1) return null;   // 有孤岛
    return { edges: edges };
  }

  // 电池那条边删掉，枚举两端点之间的【所有简单路径】，取【最长】的一条拼回成环。
  //
  // 为什么是"最长"而不是"最短"：并联支路（电压表之类）在图上是一条【弦】，走它会抄近路
  // ——BFS 最短路会被弦劫持（实测：主回路 E-A-L-RH-SW 被抄成 E-A-V-SW，L/RH 反倒被当成
  // 支路，整张图退回）。串联主回路才是那条把电池两端绕【一整圈】的、最长的简单路径。
  function mainCycle(graph, batteryId) {
    var bat = null;
    graph.edges.forEach(function (e) { if (e.compId === batteryId) bat = e; });
    if (!bat) return null;
    var adj = {};
    graph.edges.forEach(function (e) {
      if (e === bat) return;
      (adj[e.a] || (adj[e.a] = [])).push({ to: e.b, e: e });
      (adj[e.b] || (adj[e.b] = [])).push({ to: e.a, e: e });
    });
    var best = null, steps = 0, CAP = 60000;    // 课堂电路的元件就那几个，步数封顶防爆炸
    var start = {}; start[bat.a] = 1;
    (function dfs(node, seen, path) {
      if (steps++ > CAP) return;
      if (node === bat.b) { if (!best || path.length > best.length) best = path.slice(); return; }
      (adj[node] || []).forEach(function (nb) {
        if (seen[nb.to]) return;
        seen[nb.to] = 1; path.push(nb.e);
        dfs(nb.to, seen, path);
        path.pop(); seen[nb.to] = 0;
      });
    })(bat.a, start, []);
    if (!best) return null;                    // 断路：电池两端之间没有别的通路
    return [bat].concat(best);
  }

  // 把环上的元件摆成上下两排。返回矩形（含两条端点线的 y），失败返回 null。
  function rectPlace(cycle, byId, D, branchSpace) {
    var n = cycle.length;
    if (n < 2) return null;
    var bi = -1;
    for (var i = 0; i < n; i++) if (cycle[i].type === 'battery') { bi = i; break; }
    if (bi < 0) return null;
    var seq = cycle.slice(bi).concat(cycle.slice(0, bi));   // 电池打头 → 落在下排左端

    function T(e) { return D.TERMINALS[byId[e.compId].type]; }
    function halfW(e) {
      var r = symRect(byId[e.compId]), t = T(e);
      return Math.max(-r.x0, r.x1, Math.abs(t[e.tA].x), Math.abs(t[e.tB].x));
    }
    function axisY(e) { var t = T(e); return axisYOf(byId[e.compId].type, t[e.tA], t[e.tB]); }
    function widths(list) {
      var w = 0;
      list.forEach(function (e, i) { w += 2 * halfW(e); if (i) w += ROW_GAP; });
      return w;
    }

    // 伏安法/测功率常见的五元件主回路是 E、S、RH、R/L、A。
    // 下排只放电源和开关，其余放上排：滑变不再被挤在右下拐角，
    // 被测件与电流表也能和滑变沿同一条水平主干排列。
    var teachingLoop = n === 5 && seq.some(function (e) { return e.type === 'switch'; }) &&
      seq.some(function (e) { return e.type === 'rheostat'; }) &&
      seq.some(function (e) { return e.type === 'ammeter'; });
    var j = teachingLoop ? 2 : Math.ceil(n / 2);
    var bottom = seq.slice(0, j);            // 下排：seq[0..j-1]，左 → 右
    var top = seq.slice(j).reverse();        // 上排：seq[j] 在最右，所以反过来从左往右摆
    var wBottom = widths(bottom), wTop = widths(top);
    // 并联支路里若串了多个元件，主回路两端必须留得下整条支路；
    // 否则支路元件会被挤到矩形外，导线绕成几层套框。
    var W = Math.max(wBottom, wTop) + (branchSpace || 0) * 220;
    if (!(W > 0)) return null;

    var bottomY = 620, topY = bottomY - ROW_H;

    // ── 给主回路上的元件定向 ───────────────────────────────────────────
    // 元件在图里是一条边（a/b 是两个节点），相邻两件共用一个节点；和【前一件】
    // 共用的那个节点，就是这一件的「接进来」端子。知道了这个，再按回路走向要求
    // 它该落在哪一侧，就能定出要不要翻。
    //
    // 这一段原来是把 rot 写死成 0 的。后果：上排是【从右往左】走的，可端子的左右
    // 朝向和导线来的方向拧着，导线够不到该接的那个柱，只能绕过元件本体——绕出来
    // 正好是一圈方框（用户截图里 S2 那个套框就是这么来的）。
    var enteringOf = {};
    for (var q = 0; q < n; q++) {
      var cu = seq[q], pr = seq[(q - 1 + n) % n];
      var shared = (pr.a === cu.a || pr.a === cu.b) ? pr.a : pr.b;
      enteringOf[cu.compId] = (shared === cu.a) ? cu.tA : cu.tB;
    }
    // 能翻的只有「端子都落在轴线上」的元件。变阻器（滑片杆在顶上）和电表
    // （三个柱全在下方）翻了就头朝下，所以不翻——它们的接线柱本来就在轴线两侧
    // 或正下方，路由够得着。
    // 二极管和电动机【必须】能翻：它们是有极性的，翻面不只是为了走线好看，
    // 还是「这根管子是正着接还是反着接」在电路图上的表达。翻面是左右镜像，
    // 符号跟着一起镜像，所以三角形的朝向永远和实物一致。
    var FLIPPABLE = ['switch', 'bulb', 'resistor', 'led', 'motor'];
    function flipOf(e, dir) {
      var it = byId[e.compId], T = D.TERMINALS[it.type];
      if (FLIPPABLE.indexOf(it.type) < 0) return false;
      var en = enteringOf[e.compId], lv = (en === e.tA) ? e.tB : e.tA;
      // dir=+1：这一件从左往右走，接进来的端子该在【左】；
      // dir=-1：从右往左走，该在【右】。不满足就翻个面。
      return dir > 0 ? T[en].x > T[lv].x : T[en].x < T[lv].x;
    }
    // 两排都铺满同一个宽度 W：窄的那排把间隙撑开，于是左右两个端点各自对齐，
    // 上下两条边一样长 → 矩形是"实"的，左右两条竖边是干净的直线（不是拧着的）。
    function place(list, rowY, dir) {
      var k = list.length, sum = 0;
      list.forEach(function (e) { sum += 2 * halfW(e); });
      var gap = k > 1 ? (W - sum) / (k - 1) : 0;
      var cur = ROW_X + ROW_IN;
      list.forEach(function (e) {
        var hw = halfW(e), it = byId[e.compId];
        it.lay.x = snap(cur + hw);
        // y 不能 snap：电表的端子线在局部 y=POST_Y(72)，不是 20 的倍数，把原点吸到
        // 格点上端子就落不到端点线上了（差 8px，一整排就歪）。snap 只用在两排各自的 y。
        it.lay.y = rowY - axisY(e);             // 让用到的端子落在端点线上
        it.lay.mir = flipOf(e, dir);            // 翻面：只翻左右，竖直方向不动
        it.lay.rot = 0;
        cur += 2 * hw + gap;
      });
    }
    place(bottom, bottomY, 1);                  // 下排：左 → 右
    place(top, topY, -1);                       // 上排：右 → 左（数组按左→右摆，走向相反）
    return { x0: ROW_X, x1: ROW_X + ROW_IN * 2 + W, topY: topY, bottomY: bottomY, W: W };
  }

  // 非回路上的元件（并接的电压表之类）：贴到伙伴的【矩形外侧】。
  // ① 两脚正好落在同一个回路元件的两端（并接一个元件）→ 贴着那个伙伴、同 x 让到矩形外。
  // ② 两脚落在两个不同节点上（弦/桥，比如电压表跨串联的两个元件）→ 按两脚所在的那条边，
  //    让到矩形外侧、横向对齐两脚中点。人教版里这也是一圈规整的线，不该整张图退回。
  // 只有「分支又挂在分支上」（节点不在回路上）才 false 兜底。
  function placeBranches(cycle, graph, byId, D, rect) {
    var onCycle = {}, branches = [];
    cycle.forEach(function (e) { onCycle[e.compId] = 1; });
    graph.edges.forEach(function (e) { if (!onCycle[e.compId]) branches.push(e); });
    if (!branches.length) return true;
    // 已经摆好的回路节点 → 世界坐标，用来给弦/桥找落点
    var nodePos = {};
    cycle.forEach(function (c) {
      var it = byId[c.compId], T = D.TERMINALS[it.type];
      nodePos[c.a] = { x: it.lay.x + T[c.tA].x, y: it.lay.y + T[c.tA].y };
      nodePos[c.b] = { x: it.lay.x + T[c.tB].x, y: it.lay.y + T[c.tB].y };
    });
    // 分支可能不是一只表，而是「灯泡—电流表」等串联的一整条并联支路。
    // 沿未放置的元件边，从回路节点走到另一个回路节点；内部节点不属于主回路。
    // 把整条路径排在矩形留白带（空间不足时移到外侧），而不是遇到内部节点就退回实物图。
    var pending = branches.slice(), paths = [];
    for (var guard = 0; guard < branches.length; guard++) {
      var start = pending.filter(function (e) { return !!nodePos[e.a] !== !!nodePos[e.b]; })[0];
      if (!start) break;
      var first = nodePos[start.a] ? start.a : start.b;
      var done = null, used = {}, visited = {}; visited[first] = true;
      (function walk(node, path, nodes) {
        if (done || path.length > branches.length) return;
        if (node !== first && nodePos[node]) {
          done = { edges: path.slice(), nodes: nodes.slice() }; return;
        }
        pending.forEach(function (e) {
          if (done || used[e.compId] || (e.a !== node && e.b !== node)) return;
          var next = e.a === node ? e.b : e.a;
          if (visited[next]) return;
          used[e.compId] = true; visited[next] = true;
          path.push(e); nodes.push(next); walk(next, path, nodes);
          path.pop(); nodes.pop(); visited[next] = false; used[e.compId] = false;
        });
      })(first, [], [first]);
      if (!done || done.edges.length < 2) break;
      var aPos = nodePos[done.nodes[0]], bPos = nodePos[done.nodes[done.nodes.length - 1]];
      var atTop = Math.abs(aPos.y - rect.topY) < Math.abs(aPos.y - rect.bottomY);
      var btTop = Math.abs(bPos.y - rect.topY) < Math.abs(bPos.y - rect.bottomY);
      if (atTop !== btTop) break; // 竖向桥暂交给通用版式
      // 第一条多元件并联支路放在回路内部的留白带，主回路在上、支路在下，
      // 避免两条不同电位的长导线叠出一层“套框”。再多的支路才向外分层。
      var lineY = paths.length === 0 && rect.bottomY - rect.topY >= 2 * BRANCH_OFF
        ? (atTop ? rect.topY + BRANCH_OFF : rect.bottomY - BRANCH_OFF)
        : (atTop ? rect.topY - BRANCH_OFF * (paths.length + 1)
                 : rect.bottomY + BRANCH_OFF * (paths.length + 1));
      var dir = aPos.x <= bPos.x ? 1 : -1;
      var spacing = Math.abs(aPos.x - bPos.x) / (done.edges.length + 1);
      done.edges.forEach(function (e, k) {
        var it = byId[e.compId], T = D.TERMINALS[it.type];
        var entering = done.nodes[k] === e.a ? e.tA : e.tB;
        var leaving = entering === e.tA ? e.tB : e.tA;
        var reversed = dir < 0 ? T[entering].x < T[leaving].x
                               : T[entering].x > T[leaving].x;
        var rot = reversed && ['resistor','bulb','ammeter','voltmeter','switch'].indexOf(it.type) >= 0 ? 180 : 0;
        var axisX = (T[e.tA].x + T[e.tB].x) / 2;
        var axisY = axisYOf(it.type, T[e.tA], T[e.tB]);
        it.lay.rot = rot;
        it.lay.x = snap(aPos.x + dir * (k + 1) * spacing - (rot ? -axisX : axisX));
        it.lay.y = lineY - (rot ? -axisY : axisY);
      });
      paths.push(done);
      pending = pending.filter(function (e) { return done.edges.indexOf(e) < 0; });
    }
    branches = pending;
    var shifts = {};
    for (var i = 0; i < branches.length; i++) {
      var br = branches[i], mate = null;
      cycle.forEach(function (c) {
        if ((c.a === br.a && c.b === br.b) || (c.a === br.b && c.b === br.a)) mate = c;
      });
      var bit = byId[br.compId], bt = D.TERMINALS[bit.type];
      var midY = axisYOf(bit.type, bt[br.tA], bt[br.tB]);
      var midX = (bt[br.tA].x + bt[br.tB].x) / 2;
      if (mate) {
        var mit = byId[mate.compId], mt = D.TERMINALS[mit.type];
        var mateLine = mit.lay.y + axisYOf(mit.type, mt[mate.tA], mt[mate.tB]);
        var isTop = Math.abs(mateLine - rect.topY) < Math.abs(mateLine - rect.bottomY);
        var k = shifts[mate.compId] || 0; shifts[mate.compId] = k + 1;
        var off = BRANCH_OFF + k * BRANCH_OFF;
        var lineY = isTop ? rect.topY - off : rect.bottomY + off;
        bit.lay.x = snap(mit.lay.x);
        bit.lay.y = snap(lineY - midY);
        bit.lay.rot = 0;
      } else {
        var pa = nodePos[br.a], pb = nodePos[br.b];
        if (!pa || !pb) return false;               // 分支挂在分支上
        var topN = Math.abs(pa.y - rect.topY) < Math.abs(pa.y - rect.bottomY);
        var topM = Math.abs(pb.y - rect.topY) < Math.abs(pb.y - rect.bottomY);
        var q = shifts['__chord'] || 0; shifts['__chord'] = q + 1;
        var off2 = BRANCH_OFF + q * BRANCH_OFF;
        if (topN && topM) {                          // 两脚都在上排 → 让到上方
          bit.lay.x = snap((pa.x + pb.x) / 2 - midX);
          bit.lay.y = snap(rect.topY - off2 - midY);
        } else if (!topN && !topM) {                 // 两脚都在下排 → 让到下方
          bit.lay.x = snap((pa.x + pb.x) / 2 - midX);
          bit.lay.y = snap(rect.bottomY + off2 - midY);
        } else {                                     // 一上一下 → 让到矩形右侧
          bit.lay.x = snap(rect.x1 + off2 - midX);
          bit.lay.y = snap((pa.y + pb.y) / 2 - midY);
        }
        bit.lay.rot = 0;
      }
    }
    return true;
  }

  // 摆完之后自检：坐标有限、尺寸正常、两两不重叠。不过就整条退回。
  function layoutSane(items, D) {
    var rs = items.map(function (it) { return worldRectAt(it, it.lay.x, it.lay.y, D); });
    for (var i = 0; i < rs.length; i++) {
      var r = rs[i];
      if (!isFinite(r.x0) || !isFinite(r.y0) || !isFinite(r.x1) || !isFinite(r.y1)) return false;
      if (r.x1 - r.x0 > 3000 || r.y1 - r.y0 > 3000) return false;
    }
    for (var a = 0; a < rs.length; a++) {
      for (var b = a + 1; b < rs.length; b++) if (rectHit(rs[a], rs[b])) return false;
    }
    return true;
  }

  // 重排总入口。成功（真摆成了人教版那个长方形）返回 true；否则【原样退回】并返回 false，
  // 由 build 交给 alignLayout 兜底。**任何一条 exit 走 false 前都必须 back() 复原坐标**，
  // 否则兜底会拿着半截挪过的位置当"原始位置"用。
  function textbookRelayout(items, byId, wires, D) {
    if (items.length < 2 || !wires.length) return false;
    var g = netGraph(items, byId, wires);
    if (!g) return false;
    var bats = g.edges.filter(function (e) { return e.type === 'battery'; });
    if (bats.length !== 1) return false;
    var cycle = mainCycle(g, bats[0].compId);
    if (!cycle || cycle.length < 2) return false;

    var keep = items.map(function (it) {
      return { it: it, x: it.lay.x, y: it.lay.y, rot: it.lay.rot, mir: it.lay.mir };
    });
    function back() {
      keep.forEach(function (s) {
        s.it.lay.x = s.x; s.it.lay.y = s.y;
        s.it.lay.rot = s.rot; s.it.lay.mir = s.mir;      // mir 必须一起复原
      });
    }
    var extra = g.edges.length - cycle.length;
    var rect = rectPlace(cycle, byId, D, extra >= 2 ? extra : 0);
    if (!rect) { back(); return false; }
    if (!placeBranches(cycle, g, byId, D, rect)) { back(); return false; }
    // 两节点并联：电源在下方正极朝右；上方电阻/灯泡的同一电气节点
    // 必须也落在右侧。否则不同电位的两根母线会在图中央重叠，
    // 看起来像把电源短接了。无极性的电阻和灯泡可以翻面。
    // ⚠️ 这里设的是 mir（左右翻面），**不是 rot=180**：rectPlace 现在也按回路走向
    // 给主回路元件定向，两处都翻就成了翻两次、端子又回到错的一侧；而且 rot=180
    // 会把开关的刀片、变阻器的滑片杆一起倒过来（见 drawSymbol 里的 up / scale(-1,1)）。
    if (cycle.length === 2) {
      var source = cycle.filter(function (e) { return e.type === 'battery'; })[0];
      g.edges.forEach(function (e) {
        if (e === source || (e.type !== 'resistor' && e.type !== 'bulb')) return;
        if (e.a === source.a || e.b === source.a) {
          byId[e.compId].lay.mir = (e.a === source.a);
          byId[e.compId].lay.rot = 0;
        }
      });
    }
    if (!layoutSane(items, D)) { back(); return false; }
    return true;
  }

  // 任意接法的第二条版式通道。完整的单电源回路优先走上面的教材矩形；
  // 断路、多电源、孤岛、桥接和分支上的分支则按【真实接线的元件邻接图】排版。
  // 不用原实物坐标推断电气关系；旧的 alignLayout 只挪 40px，摆乱的自搭电路无法规整。
  // 每个连通块独立排放，线性链沿两排折返，有分支的图按 BFS 层放置。
  // 这里只改 lay 副本；每根导线仍由原 scene 的两个端子重新取点，保持电气拓扑。
  function canonicalLayout(items, byId, wires, D) {
    var adj = {}, seen = {}, groups = [], baseY = 240, stepX = 260, stepY = 240;
    items.forEach(function (it) { adj[it.id] = []; });
    wires.forEach(function (w) {
      if (!w.a || !w.b) return;
      var a = w.a.compId, b = w.b.compId;
      if (!byId[a] || !byId[b] || a === b) return;
      if (adj[a].indexOf(b) < 0) adj[a].push(b);
      if (adj[b].indexOf(a) < 0) adj[b].push(a);
    });
    items.forEach(function (it) {
      if (seen[it.id]) return;
      var group = [], queue = [it.id]; seen[it.id] = true;
      while (queue.length) {
        var id = queue.shift(); group.push(id);
        adj[id].forEach(function (next) {
          if (!seen[next]) { seen[next] = true; queue.push(next); }
        });
      }
      groups.push(group);
    });
    // 有电源的连通块在前，孤立元件在后；同级保持画布中的创建顺序。
    groups.sort(function (a, b) {
      var pa = a.some(function (id) { return byId[id].type === 'battery'; }) ? 0 : 1;
      var pb = b.some(function (id) { return byId[id].type === 'battery'; }) ? 0 : 1;
      return pa - pb;
    });
    function place(id, x, lineY) {
      var it = byId[id], u = usedTerms(it, wires), terms = D.TERMINALS[it.type];
      var axisY = u ? (terms[u[0]].y + terms[u[1]].y) / 2 : 0;
      it.lay.x = snap(x);
      it.lay.y = lineY - axisY;
      it.lay.rot = 0; // 电表字母与元件标签保持正立
      it.lay.mir = false; // 这条通道不翻面：端子左右按 TERMINALS 原样摆
    }
    groups.forEach(function (group) {
      var allSimple = group.every(function (id) { return adj[id].length <= 2; });
      if (allSimple) {
        var root = group.filter(function (id) { return adj[id].length <= 1; })[0] ||
                   group.filter(function (id) { return byId[id].type === 'battery'; })[0] || group[0];
        var order = [], visited = {}, current = root;
        while (current != null && !visited[current]) {
          order.push(current); visited[current] = true;
          current = adj[current].filter(function (id) { return !visited[id]; })[0];
        }
        var cols = Math.min(6, order.length);
        order.forEach(function (id, i) {
          var row = Math.floor(i / cols), col = i % cols;
          if (row % 2) col = cols - 1 - col;
          place(id, 280 + col * stepX, baseY + row * stepY);
        });
        baseY += Math.ceil(order.length / cols) * stepY + 120;
      } else {
        var source = group.filter(function (id) { return byId[id].type === 'battery'; })[0] || group[0];
        var levels = [[source]], visited2 = {}; visited2[source] = true;
        for (var depth = 0; depth < levels.length; depth++) {
          var nextLevel = [];
          levels[depth].forEach(function (id) {
            adj[id].forEach(function (next) {
              if (!visited2[next]) { visited2[next] = true; nextLevel.push(next); }
            });
          });
          if (nextLevel.length) levels.push(nextLevel);
        }
        var maxRows = Math.max.apply(null, levels.map(function (level) { return level.length; }));
        levels.forEach(function (level, x) {
          var offset = (maxRows - level.length) * stepY / 2;
          level.forEach(function (id, y) {
            place(id, 280 + x * stepX, baseY + offset + y * stepY);
          });
        });
        baseY += maxRows * stepY + 120;
      }
    });
    return true;
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
  // 这段线是不是从【别的节点】的接线柱正上方压过去了（端点落在柱上不算）。
  // ------------------------------------------------------------
  // 为什么要单列这一条：走线是**一根一根**排的，排前面的线不知道后面那根线要从哪儿
  // 出发。变阻器接 B-C 就是这个坑——「S1 → B」那根线为了少拐一个弯，贴着下排轴线
  // （y=620）一直走到 x=818；可滑片杆顶恰好也在 y=620 上，于是后面「滑片 → S2」那根
  // 线的头一段和它叠在同一条线上。两根线属于**不同节点**，画出来却是同一条线，
  // 图上分不出哪个是哪个——正是「图和数自相矛盾」那一类毛病。
  // 加了这条代价，前一根线会主动改走变阻器【下方】的车道再折上去接 B，滑片杆顶
  // 那条轴线就腾出来了。量级放在 FOREIGN(500) 之下、BEND(50) 之上：值得为它多拐两个
  // 弯（2×50=100 < 400），但别为了躲它去压符号（1e6）。
  // 这段线是不是和【别的节点】已经排好的线十字交叉了。
  // 交叉本身画得出来（绘制层会给竖线开一个缺口、让横线跨过去，明确「不相连」），
  // 但教材里的原则是「能不错开就不交叉」。给个不大的代价（约等于两三个拐点），
  // 让它只在「不交叉就得绕很远」的时候才认交叉。
  function segCrosses(a, b, segs, net) {
    var vert = Math.abs(a.x - b.x) < 1;
    var n = 0;
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (s.net === net) continue;
      if (s.orient === (vert ? 'v' : 'h')) continue;    // 只看正交的那一批
      var lo, hi, pos;
      if (vert) { pos = a.x; lo = Math.min(a.y, b.y); hi = Math.max(a.y, b.y); }
      else { pos = a.y; lo = Math.min(a.x, b.x); hi = Math.max(a.x, b.x); }
      if (pos > Math.min(s.a0, s.a1) + 1 && pos < Math.max(s.a0, s.a1) - 1 &&
          s.pos > lo + 1 && s.pos < hi - 1) n++;
    }
    return n;
  }
  function segThroughDots(a, b, dots, net) {
    if (!dots || !dots.length) return 0;
    var vert = Math.abs(a.x - b.x) < 1;
    var pos = vert ? a.x : a.y;
    var lo = vert ? Math.min(a.y, b.y) : Math.min(a.x, b.x);
    var hi = vert ? Math.max(a.y, b.y) : Math.max(a.x, b.x);
    var n = 0;
    for (var i = 0; i < dots.length; i++) {
      var d = dots[i];
      if (d.net === net) continue;
      var q = vert ? d.y : d.x, t = vert ? d.x : d.y;
      if (Math.abs(t - pos) > 1.5) continue;
      if (q > lo + 1.5 && q < hi - 1.5) n++;
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
        // 悬空端（元件被删、导线还在）没有端子可言，跳过 —— 否则两个悬空端
        // 会被拼成同一个 "null:0" 名字，两根互不相干的线在图上被当成同一个节点。
        if (e.compId == null) return;
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
  function scorePath(pts, rects, segs, excl, net, dots) {
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
      cost += TERMDOT * segThroughDots(a, b, dots, net);
      cost += CROSS * segCrosses(a, b, segs, net);
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

  function routeWire(p0, p1, box, rects, segs, excl, net, dots) {
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
      var r = scorePath(pts, rects, segs, excl, net, dots);
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
        // 接线由导线本身表示，图上不重复印 B-C 等调试信息；保留教学需要的滑片位置。
        return '最大 ' + num(mx) + ' Ω · 滑片 ' + num(it.meta.slide);
      }
      // 二极管的铭牌是【颜色】而不是电压 —— 真实管子就是按颜色分规格卖的，
      // 正向压降是那个颜色的属性。把两个数一起印出来，学生才知道「3V 点不亮
      // 蓝管」不是巧合，是 3.1V 的压降摆在那儿。
      case 'led': {
        var lc = core && core.ledColorOf ? core.ledColorOf(P) : { label: '红色', Vf: 1.8 };
        return lc.label + ' · 正向 ' + lc.Vf.toFixed(1) + ' V';
      }
      case 'motor': {
        var rc = (rec && rec.R != null) ? +rec.R : (P.Rcoil != null ? +P.Rcoil : 5);
        var st = rec ? !!rec.stalled : !!P.stall;
        return '线圈 ' + num(rc) + ' Ω' + (st ? ' · 堵转' : '');
      }
      case 'bell': {
        var bc = (rec && rec.R != null) ? +rec.R : (P.Rcoil != null ? +P.Rcoil : 20);
        var tn = (rec && rec.turns != null) ? +rec.turns : (P.turns != null ? +P.turns : 800);
        return '线圈 ' + num(bc) + ' Ω · ' + num(tn) + ' 匝';
      }
      default: return '';
    }
  }

  // 标注也是图形的一部分：线路不能穿过字，导出的画布也不能把字裁掉。
  // 这里按与 drawSymbol 相同的基线/字号估算保守包围盒；不依赖 DOM 或 Canvas。
  // 符号下面那行提醒（独立于铭牌值，单独一行画）。
  // 目前只有一种：变阻器接成 A-B（下面两个柱）时滑片根本不在电路里。教材管这叫
  // 「整个电阻线接入电路，滑片不起作用，相当于定值电阻」——不点出来，学生盯着一个
  // 不接线的箭头只会以为图画错了。
  function hintOf(it) {
    if (it.type === 'rheostat' && it.meta.stemDashed) return '滑片未接入 · 相当于定值电阻';
    // 二极管接反时【一条支路都没有】——求解器里它就是断路，读数全是 0。
    // 光看符号看不出「图是对的、电路不导电」，必须写一句，否则学生会以为
    // 是软件算错了（0.000A 和「管子没导通」是两件事）。
    if (it.type === 'led' && it.rec && !it.rec.on && !it.rec.isolated) return '反向截止 · 不导电';
    if (it.type === 'bell' && it.rec && !it.rec.rings && !it.rec.isolated) return '磁动势不足 · 铃不响';
    return '';
  }

  function annotationRects(it) {
    var r = it.worldRect, mid = (r.x0 + r.x1) / 2, out = [];
    function width(s, size) {
      var n = 0;
      Array.from(s).forEach(function (c) {
        n += /[\u3400-\u9fffΩ]/.test(c) ? size : /[il.· ]/.test(c) ? size * 0.36 : size * 0.65;
      });
      return n + 14;
    }
    if (it.label) {
      var a = width(it.label, 15) / 2;
      out.push({ x0: mid - a, x1: mid + a, y0: r.y0 - 25, y1: r.y0 - 4 });
    }
    if (it.value) {
      var b = width(it.value, 12) / 2;
      out.push({ x0: mid - b, x1: mid + b, y0: r.y1 + 2, y1: r.y1 + 20 });
    }
    if (it.hint) {
      var h = width(it.hint, 12) / 2;
      // soft：这行提醒只进【取景】的墨迹框，**不进走线的障碍表**。
      // 提醒是「解释」，不是电路的一部分。把它当成硬障碍，导线为了躲一行字
      // 会被挤到更远的车道，本就不宽裕的通道可能就此找不到干净路径
      // （并-S2∥L1 就是这么被挤出一句「布局需核对」的）。字和线擦肩而过可以接受，
      // 导线被迫多绕两个拐点、甚至绕不过去，才是真难看。
      out.push({ x0: mid - h, x1: mid + h, y0: r.y1 + 20, y1: r.y1 + 38, soft: true });
    }
    return out;
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
      var lay = { id: c.id, type: c.type, x: c.x, y: c.y, rot: c.rot || 0, mir: false,
                  params: c.params || {} };
      var it = { id: c.id, type: lay.type, x: lay.x, y: lay.y, rot: lay.rot,
                 comp: lay, lay: lay, src: c, core: core, meta: {}, rect: null, rec: rec };
      if (lay.type === 'ammeter' || lay.type === 'voltmeter') it.meta = meterGeom(lay, wires, D);
      else if (lay.type === 'rheostat') it.meta = rheoGeom(lay, wires, rec, D);
      else it.meta = {};
      it.rect = symRect(it);                  // 局部框：只和 params / meta 有关，与位置无关
      // 图上那个「R₁ / L₂」标注跟【显示名】走：学生在主画布上把灯泡改名成
      // 「L」，导出的电路图还印「L₁」就自相矛盾了。名字里没有数字时 subscript
      // 原样返回，所以改过名的元件不会被它动过（「灯泡」照旧印「灯泡」）。
      // it.id 仍是 c.id —— 那是内部索引（byId / 规整化都用它）。
      it.label = labels ? subscript(D.nameOf ? D.nameOf(c) : lay.id) : '';
      it.value = values ? valueOf(it, rec) : '';
      it.hint = values ? hintOf(it) : '';
      return it;
    });
    var byId = {};
    items.forEach(function (it, i) { byId[it.id] = it; it._ri = i; });

    // 规整化。**顺序不能反**：先算布局，再算世界框。反了就是拿【旧】坐标算框，
    // 路由器照着旧盒子避让，症状是「导线从刚挪过来的元件身上穿过去」。
    var layout = 'original';
    if (!(opts && opts.regularize === false)) {
      if (textbookRelayout(items, byId, wires, D)) layout = 'textbook';
      else if (opts && opts.canonical) {
        canonicalLayout(items, byId, wires, D);
        layout = 'canonical';
      } else { alignLayout(items, byId, wires, D); layout = 'aligned'; }
    }

    // 手工微调：把学生拖过的元件钉在指定位置（opts.place = { 元件id: {x, y} }）。
    // ------------------------------------------------------------
    // **必须排在规整化之后**：规整化自己会挪元件，先钉后挪等于没钉。只覆盖被拖过的
    // 那几件，其余照旧走自动布局。位置一变，下面的世界框 / 障碍框 / 走线全部按新位置
    // 重算，导线自己绕开挪过来的元件 —— 「拖完这张图更规范」就是从这条顺序里来的。
    // 传进来的坐标不再 snap：吸网格还是吸对齐由调用方定，内核只管照办（纯数据，可测）。
    var place = (opts && opts.place) || null;
    if (place) {
      items.forEach(function (it) {
        var p = place[it.id];
        if (!p) return;
        if (typeof p.x === 'number') it.lay.x = p.x;
        if (typeof p.y === 'number') it.lay.y = p.y;
      });
    }

    items.forEach(function (it) { it.x = it.lay.x; it.y = it.lay.y; it.comp = it.lay; });

    var rects = items.map(function (it) { return worldRect(it, D); });      // 墨迹框：标注 / 重叠预检 / 取景
    items.forEach(function (it, i) { it.worldRect = rects[i]; });
    var notes = [];
    items.forEach(function (it) { notes = notes.concat(annotationRects(it)); });
    // 走线避让用的是（可能更小的）障碍框；前 items.length 项仍按元件顺序排列，
    // excl 里存的下标就指着它们 —— 所以**只能往后过滤**，blocks 必须原样排在最前面。
    // soft 标注（变阻器那行提醒）不进障碍表，理由见 annotationRects。
    var blocks = items.map(function (it) {
      return worldRect({ rect: obsRect(it), comp: it.comp }, D);
    });
    var obstacles = blocks.concat(notes.filter(function (n) { return !n.soft; }));

    // 外接框：外侧兜底车道的选址要用到全图范围（标注也占位置）。
    // 这里仍用【墨迹框】——图得把整件都框进去，不能按避让框缩水。
    var rough = rects.concat(notes);
    wires.forEach(function (w) {
      if (!w.a || !w.b) return;
      var a = byId[w.a.compId], b = byId[w.b.compId];
      if (!a || !b) return;
      var p0 = schTermWorld(a, w.a.termIdx, D), p1 = schTermWorld(b, w.b.termIdx, D);
      rough.push({ x0: Math.min(p0.x, p1.x), y0: Math.min(p0.y, p1.y),
                   x1: Math.max(p0.x, p1.x), y1: Math.max(p0.y, p1.y) });
    });
    var box = unionBox(rough) || { x0: 0, y0: 0, x1: 0, y1: 0 };

    var nets = netOf(wires);
    // 所有导线端点的「接线柱点」，连着自己属于哪个节点。走线时用来躲开
    // 【别的节点】的柱子（见 segThroughDots）。同一位置同一节点只留一个。
    var dots = [], dotSeen = {};
    wires.forEach(function (w, wi) {
      if (!w.a || !w.b) return;
      var a = byId[w.a.compId], b = byId[w.b.compId];
      if (!a || !b) return;
      [schTermWorld(a, w.a.termIdx, D), schTermWorld(b, w.b.termIdx, D)].forEach(function (p) {
        var k = Math.round(p.x) + ',' + Math.round(p.y) + ',' + nets.wire[wi];
        if (dotSeen[k]) return;
        dotSeen[k] = 1; dots.push({ x: p.x, y: p.y, net: nets.wire[wi] });
      });
    });
    var segs = [];        // 已经排好的线段，后面的导线要躲开
    var outWires = [], warnings = [];
    wires.forEach(function (w, wi) {
      if (!w.a || !w.b) return;
      var a = byId[w.a.compId], b = byId[w.b.compId];
      if (!a || !b) return;
      var p0 = schTermWorld(a, w.a.termIdx, D);
      var p1 = schTermWorld(b, w.b.termIdx, D);
      var myNet = nets.wire[wi];
      var excl = [{ idx: a._ri, p: p0 }, { idx: b._ri, p: p1 }];
      var via = (w.via || []).map(function (v) { return { x: v[0], y: v[1] }; });
      var pts = [p0].concat(via, [p1]);
      // 能不动就不动：编辑器 rerouteAll 规划的正交走线、学生拖出来的直线上，原样搬进
      // 电路图，示例电路因此出来的就是那个规整的方框回路。但**得是真干净的走线才留**：
      // 横平竖直、拐点不超过 3 个、不压元件、不和别的节点的线重合，四条缺一就重排。
      var kept = layout !== 'canonical' && axisAligned(pts) && bendCount(pts) <= 3 &&
                 pathClear(pts, obstacles, segs, excl, myNet);
      if (!kept) pts = routeWire(p0, p1, box, obstacles, segs, excl, myNet, dots);
      // 极密集或互相矛盾的接线可能找不到不压符号/不混线的通道。
      // 必须显式报告，不能把有歧义的示意图冒充“标准电路图”。
      if (!axisAligned(pts) || !pathClear(pts, obstacles, segs, excl, myNet)) {
        warnings.push('第 ' + (wi + 1) + ' 根导线布局需核对');
      }
      for (var i = 1; i < pts.length; i++) {
        var A = pts[i - 1], B = pts[i];
        if (Math.abs(B.x - A.x) < 1) segs.push({ orient: 'v', pos: B.x, a0: A.y, a1: B.y, net: myNet });
        else if (Math.abs(B.y - A.y) < 1) segs.push({ orient: 'h', pos: B.y, a0: A.x, a1: B.x, net: myNet });
      }
      outWires.push({ pts: pts, kept: kept, _net: myNet });
    });

    // 导出画布要装下【所有墨迹】，所以这里用墨迹框而不是缩过水的避让框，
    // 否则变阻器的箭头杆会被裁在画布外（标注值又恰好落在下面，缺口不容易被发现）。
    var all = rects.concat(notes);
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
        // mir 要导出：它是「这一件在回路里朝哪头」的结论，测试要断它。
        // 漏掉的话，方向回归（S2 被导线套框那个 bug）就没法在纯数据层锁住。
        return { id: it.id, type: it.type, x: it.x, y: it.y, rot: it.rot,
                 mir: !!(it.lay && it.lay.mir),
                 label: it.label, value: it.value, hint: it.hint,
                 meta: it.meta, rect: it.rect, worldRect: it.worldRect };
      }),
      wires: outWires,
      layout: layout,
      warnings: warnings,
      crossings: crossingsOf(outWires),
      junctions: junctionsOf(outWires, items, wires, D),
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
  //   ① 同一个点上朝【≥3 个方向】有导体伸出去。导体 = 导线 + 元件的接线柱（只数真的
  //      接了线的柱）。电压表并到小灯泡两端就是这么个三岔口：两根线头加灯泡那个柱，
  //      教材上必点圆点。旧版只数「≥3 个线头」，于是「V 表引线搭在灯泡柱上」那两处
  //      永远缺点，图看着像并联只接了一半（用户那张图里的毛病之一）。
  //   ② 一根导线的顶点（端点**或拐点**）严格落在另一根导线的某段【内部】，
  //      且这两根导线共用同一个端子（同一个电气节点）。
  // 为什么要数【方向】而不是数【线头】：两根线常常叠在一段上走（同一个端子出来的两根线
  // 先并成一条主干再分岔），叠着的那一段画出来只有一条线，算两个方向就会在压根没有
  // 三岔口的地方点一个圆点，而在真正的分岔处反倒漏掉。
  // 第 ② 条的「共用端子」限定不能省：求解器的连通性只看端子共点、不看几何相交，
  // 在不相干的交叉处画点，图和数当场自相矛盾。
  // 两端相接的普通拐角不画点（那儿只有两个方向）。
  var RAY_TOL = 0.5;
  // 接线柱的引线朝哪个方向伸进符号本体（沿主轴取，和 lead()/hLead() 画的横线一致）。
  function leadDir(it, termIdx, D) {
    var t = D.TERMINALS[it.type][termIdx], r = it.rect;
    var cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
    var dx = cx - t.x, dy = cy - t.y;
    if (Math.abs(dx) >= Math.abs(dy)) return { x: dx >= 0 ? 1 : -1, y: 0 };
    return { x: 0, y: dy >= 0 ? 1 : -1 };
  }
  // 从点 p 出发有几个方向的导体。同一方向叠着走的线只算一个。
  // 除了「以 p 为顶点」的线，还要算【同一个节点、从 p 身上穿过去】的线——那正是
  // 「一根线搭在另一根线中间」的三岔口，两个方向都要记上。别的节点的线穿过不算：
  // 求解器的连通性只看端子共点，在交叉处画点，图和数当场自相矛盾。
  function rayCount(p, outWires, terms) {
    var dirs = {}, n = 0, pnet = null;
    function add(dx, dy) {
      if (Math.abs(dx) <= RAY_TOL && Math.abs(dy) <= RAY_TOL) return;
      var k = (dx > RAY_TOL ? 'E' : dx < -RAY_TOL ? 'W' : '') +
              (dy > RAY_TOL ? 'S' : dy < -RAY_TOL ? 'N' : '');
      if (dirs[k]) return;
      dirs[k] = 1; n++;
    }
    function at(i, q) {
      return Math.abs(q[i].x - p.x) <= RAY_TOL && Math.abs(q[i].y - p.y) <= RAY_TOL;
    }
    outWires.forEach(function (w) {
      var q = w.pts;
      for (var i = 0; i < q.length; i++) {
        if (!at(i, q)) continue;
        if (pnet == null) pnet = w._net;
        // 方向一律【从 p 指向邻点】。写成 q[i] − q[i-1] 就是把箭头指反了：
        // 从左边接过来的线会被记成「往左伸」，两个方向刚好互换。
        if (i > 0) add(q[i - 1].x - q[i].x, q[i - 1].y - q[i].y);
        if (i < q.length - 1) add(q[i + 1].x - q[i].x, q[i + 1].y - q[i].y);
      }
    });
    outWires.forEach(function (w) {
      if (w._net !== pnet) return;
      var q = w.pts;
      for (var i = 1; i < q.length; i++) {
        var a = q[i - 1], b = q[i];
        if (Math.abs(a.x - b.x) <= RAY_TOL) {
          if (Math.abs(p.x - a.x) <= RAY_TOL &&
              p.y > Math.min(a.y, b.y) + RAY_TOL && p.y < Math.max(a.y, b.y) - RAY_TOL) { add(0, 1); add(0, -1); }
        } else if (Math.abs(a.y - b.y) <= RAY_TOL) {
          if (Math.abs(p.y - a.y) <= RAY_TOL &&
              p.x > Math.min(a.x, b.x) + RAY_TOL && p.x < Math.max(a.x, b.x) - RAY_TOL) { add(1, 0); add(-1, 0); }
        }
      }
    });
    (terms || []).forEach(function (t) {
      if (Math.abs(t.p.x - p.x) > RAY_TOL || Math.abs(t.p.y - p.y) > RAY_TOL) return;
      add(t.dir.x, t.dir.y);
    });
    return n;
  }
  function junctionsOf(outWires, items, wires, D) {
    var seen = {}, cseen = {}, out = [], cands = [];
    function key(p) { return Math.round(p.x) + ',' + Math.round(p.y); }
    function push(p) {
      var k = key(p);
      if (seen[k]) return;
      seen[k] = 1; out.push({ x: p.x, y: p.y });
    }
    function cand(p) {
      var k = key(p);
      if (cseen[k]) return;
      cseen[k] = 1; cands.push(p);
    }
    outWires.forEach(function (w) { w.pts.forEach(cand); });
    // 接线柱的坐标必须和导线端点走同一个函数（schTermWorld），
    // 自己拿 D.terminalWorld 取，变阻器的滑片柱就会落在另一个点上，圆点飘到空处。
    var terms = [];
    if (items && wires && D) {
      items.forEach(function (it) {
        var ts = D.TERMINALS[it.type] || [];
        for (var t = 0; t < ts.length; t++) {
          if (!termHasWire(wires, it.id, t)) continue;   // 悬空的柱不是导体
          var p = schTermWorld(it, t, D);
          terms.push({ p: p, dir: leadDir(it, t, D) });
          cand(p);
        }
      });
    }
    cands.forEach(function (p) {
      if (rayCount(p, outWires, terms) >= 3) push(p);
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

  // 不同电气节点的线在纸面交叉时留一个明确的断口，避免被误认为相接。
  // 只处理两段内部的十字相交；端点相交由结点或走线校验处理。
  function crossingsOf(wires) {
    var out = [], seen = {};
    function segments(w) {
      var s = [];
      for (var i = 1; i < w.pts.length; i++) {
        var a = w.pts[i - 1], b = w.pts[i];
        if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) > 1)
          s.push({ v: true, x: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) });
        else if (Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) > 1)
          s.push({ v: false, y: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) });
      }
      return s;
    }
    var all = wires.map(segments);
    for (var i = 0; i < wires.length; i++) for (var j = i + 1; j < wires.length; j++) {
      if (wires[i]._net === wires[j]._net) continue;
      all[i].forEach(function (a) { all[j].forEach(function (b) {
        if (a.v === b.v) return;
        var v = a.v ? a : b, h = a.v ? b : a;
        if (v.x <= h.lo + 6 || v.x >= h.hi - 6 || h.y <= v.lo + 6 || h.y >= v.hi - 6) return;
        var key = Math.round(v.x) + ',' + Math.round(h.y);
        if (!seen[key]) { seen[key] = 1; out.push({ x: v.x, y: h.y }); }
      }); });
    }
    return out;
  }

  function draw(ctx, model, opts) {
    var D = drawOf(opts);
    var items = model._items || [];
    var values = !(opts && opts.values === false);

    ctx.save();
    ctx.fillStyle = (opts && opts.paper) || COLOR.paper;
    var b = model.bounds;
    ctx.fillRect(b ? b.x : 0, b ? b.y : 0, b ? b.w : 1, b ? b.h : 1);

    // 线宽和符号描边取同一个值（2.4）：人教版电路图所有线条一样粗，导线比符号粗
    // 会显得像另画上去的。改这里要连 drawSymbol 一起想。
    model.wires.forEach(function (w) { drawPolys(ctx, w.pts, COLOR.wire, 2.4); });
    // 纵线断开、横线跨过：让不同节点的十字交叉明确“不相连”。
    (model.crossings || []).forEach(function (p) {
      ctx.fillStyle = COLOR.paper; ctx.fillRect(p.x - 4, p.y - 6, 8, 12);
      ctx.beginPath(); ctx.moveTo(p.x - 6, p.y); ctx.lineTo(p.x + 6, p.y);
      ctx.strokeStyle = COLOR.wire; ctx.lineWidth = 2.4; ctx.stroke();
    });
    // 结点圆点画在导线之后、符号之前
    (model.junctions || []).forEach(function (j) {
      ctx.beginPath();
      ctx.arc(j.x, j.y, 3.6, 0, Math.PI * 2);
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
    // 左右镜像（见 schTermWorld）。用 scale(-1,1) 而不是 rot=180：变阻器的滑片杆
    // 长在顶上、电表的三个柱全在下方，转 180° 会头朝下；镜像只翻左右，竖直不动。
    // 编号和铭牌文字在下面单独画，不进这个变换，所以不会跟着变成反字。
    if (c.mir) ctx.scale(-1, 1);
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
        // 两个触点是固定不动的接点，刀片绕左触点转。
        dot(ctx, -22, 0, 4.0); dot(ctx, 22, 0, 4.0);
        // 断开的斜刀片是**刻意的例外**——教材的开关符号就是这么画的：导线横平竖直，
        // 只有符号内部的刀片是斜的。闭合时刀片搭在两个触点上，画得比导线明显粗，
        // 否则整把开关看上去就是「一根线加两个点」，和导线分不出来。
        var closed = it.rec ? !!it.rec.closed : !!(c.params || {}).closed;
        // 断开的斜刀片一律朝【上】翘——教材的开关符号就是这么画的。
        // 元件若被转了 180°（canonicalLayout 那条路会给 rot=180），刀片得再翻回来，
        // 否则画出来是朝下翘的，看着不像开关。
        var up = (Math.abs(c.rot) === 180) ? 1 : -1;
        ctx.lineWidth = closed ? 3.4 : 2.6;
        ctx.beginPath();
        ctx.moveTo(-22, 0);
        ctx.lineTo(closed ? 22 : 6, closed ? 0 : 20 * up);
        ctx.stroke();
        if (!closed) dot(ctx, 6, 20 * up, 3.4);
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
      // 发光二极管：教材上的二极管符号（实心三角 + 一条横线）再补两个发光箭头。
      // 三角的【尖端指向横线】，也就是阳极指向阴极 —— 电流只许这么流。
      // 这两笔的朝向不能反：反了就成了「只许反向导电」，比不画还坏。
      case 'led': {
        lead(ctx, T[0], -16); lead(ctx, T[1], 16);
        ctx.beginPath();
        ctx.moveTo(-16, -15); ctx.lineTo(-16, 15); ctx.lineTo(14, 0);
        ctx.closePath();
        ctx.fillStyle = COLOR.wire; ctx.fill();
        // 阴极横线：画得比导线粗一点，它才是「单向」的那个「单」
        ctx.lineWidth = 3.4;
        ctx.beginPath();
        ctx.moveTo(14, -17); ctx.lineTo(14, 17);
        ctx.stroke();
        ctx.lineWidth = 2.4;
        // 两个发光箭头：从左下往右上射出（离开管子的方向）
        ctx.lineWidth = 2;
        [[-2, -12], [9, -12]].forEach(function (a) {
          ctx.beginPath();
          ctx.moveTo(a[0], a[1]); ctx.lineTo(a[0] + 11, a[1] - 11);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(a[0] + 11, a[1] - 11);
          ctx.lineTo(a[0] + 11, a[1] - 4.5);
          ctx.lineTo(a[0] + 4.5, a[1] - 11);
          ctx.closePath();
          ctx.fillStyle = COLOR.wire; ctx.fill();
        });
        ctx.lineWidth = 2.4;
        break;
      }
      // 电动机：一个圆里写 M。极性和二极管一样靠翻面表达，字母本身始终正立。
      case 'motor': {
        lead(ctx, T[0], -22); lead(ctx, T[1], 22);
        ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2);
        ctx.fillStyle = COLOR.paper; ctx.fill();
        ctx.strokeStyle = COLOR.wire; ctx.lineWidth = 2.4; ctx.stroke();
        ctx.fillStyle = COLOR.wire;
        ctx.font = 'bold 24px Georgia,"Times New Roman",serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        // 支路从右往左时元件会被转 180°，字母仍须正立可读（和电表同一处理）。
        ctx.save();
        if ((c.rot || 0) % 360 === 180) {
          ctx.translate(0, 0); ctx.rotate(Math.PI);
        }
        ctx.fillText('M', 0, 1);
        ctx.restore();
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        break;
      }
      // 电铃：国标 / 人教版初中电路图里的画法 —— 半圆拱（开口向下）坐在底边上，
      // 中央垂下一小段【铃舌】，两根导线从底边两端水平引出。
      // 这里刻意【不画圆圈】：圆圈里画一只铃是「发声器件」的通用画法
      // （蜂鸣器、喇叭那一类都这么画），初中电学里那个符号是半圆这一支。
      // 它不分正负极，电流任意方向流过都响，所以符号里也没有任何方向标记。
      case 'bell': {
        var br = 18;
        lead(ctx, T[0], -br); lead(ctx, T[1], br);
        ctx.beginPath();
        ctx.arc(0, 0, br, Math.PI, 0, false);   // 上半圆 = 拱；closePath 补出底边
        ctx.closePath();
        ctx.fillStyle = COLOR.paper; ctx.fill();
        ctx.strokeStyle = COLOR.wire; ctx.lineWidth = 2.4; ctx.stroke();
        // 铃舌：底边正中垂下来的一小段（这就是「蘑菇」的那个柄）
        ctx.beginPath();
        ctx.moveTo(0, 0); ctx.lineTo(0, 9);
        ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 10.6, 1.8, 0, Math.PI * 2);
        ctx.fillStyle = COLOR.wire; ctx.fill();
        break;
      }
      case 'ammeter': case 'voltmeter': {
        var m = it.meta;
        // 引线：从柱子水平引到圆周。没接线的那两根画虚线（悬空）。
        hLead(ctx, T[0], m.cx - m.r, m.posWired);        if (m.tap) hLead(ctx, T[m.tap], m.cx + m.r, true);
        // 空着的那根量程柱**不画虚脚**：那根短脚固定在离圆心 100px 外，
        // 画出来是画面正中凭空一根小竖线，反倒像根走错路的导线。
        ctx.beginPath(); ctx.arc(m.cx, m.cy, m.r, 0, Math.PI * 2);
        ctx.fillStyle = COLOR.paper; ctx.fill();
        ctx.strokeStyle = COLOR.wire; ctx.lineWidth = 2.4; ctx.stroke();
        ctx.fillStyle = COLOR.wire;
        ctx.font = 'bold 24px Georgia,"Times New Roman",serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        // 支路从右往左时表的接线极性需转 180°，字母仍须正立可读。
        ctx.save();
        if ((c.rot || 0) % 360 === 180) {
          ctx.translate(m.cx, m.cy); ctx.rotate(Math.PI); ctx.translate(-m.cx, -m.cy);
        }
        ctx.fillText(c.type === 'ammeter' ? 'A' : 'V', m.cx, m.cy + 1);
        ctx.restore();
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        break;
      }
      case 'rheostat': {
        var g = it.meta;
        // 只画接上的那根 A/B 引线（整件没接线时两根都画）
        if (!g.anyWire || g.aWired) lead(ctx, T[0], -56);
        if (!g.anyWire || g.bWired) lead(ctx, T[1], 56);
        ctx.beginPath();
        D.roundRect(ctx, -56, 14, 112, 24, 2);
        ctx.stroke();
        // 滑片：从轴线上垂下来一根，箭头尖顶到矩形上沿。
        // 横坐标就是 sliderLocalX(slide)——和实物上滑片的位置是同一个数。
        // 杆顶（RHEO_STEM_TOP）就是引线的落点：导线沿轴线直接压上来，不用拐台阶。
        var sx = Math.max(-54, Math.min(54, g.xl));
        // 滑片杆和箭头是【变阻器符号本身的一部分】，不是接线柱：不管滑片接没接，
        // 都照常画成实线。画成灰色虚线会让人以为图没画完——用户就是这么反馈的。
        // 「滑片没接入」这件事，交给符号下面那行提示文字说清楚。
        drawPolys(ctx, [{ x: sx, y: RHEO_STEM_TOP }, { x: sx, y: 14 }],
                  COLOR.wire, 2.2, false);
        ctx.save();
        ctx.fillStyle = COLOR.wire;
        ctx.beginPath();
        ctx.moveTo(sx, 14); ctx.lineTo(sx - 5, 6); ctx.lineTo(sx + 5, 6);
        ctx.closePath(); ctx.fill();
        ctx.restore();
        // 顶部不再画「横贯到 C/D 角」的线：C/D 电气上就是滑片这一个节点，
        // 引线端点已经落在箭头杆正上方（见 schTermWorld），导线直接接在杆顶。
        // 留着那条横线，画出来就是套住电阻丝的方框。
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
    if (values && it.hint) {
      ctx.fillStyle = COLOR.warn;
      ctx.font = '12px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText(it.hint, (wr.x0 + wr.x1) / 2, wr.y1 + 31);
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
    { type: 'led',      name: '发光二极管',       from: '示教板上的彩色小管：一端半球透镜、一端带平边',
      to: '实心三角加一条横线：三角尖端指向横线，电流只许这么流（单向导电性）。右上两个小箭头表示发光' },
    { type: 'motor',    name: '电动机',           from: '示教板上的直流电动机：机身架在两个支撑上，轴端带螺旋桨',
      to: '一个圆里写 M，串在电路里；接线反了螺旋桨就反转' },
    { type: 'bell',     name: '电铃',             from: '示教板上的电磁电铃：铁芯线圈、簧片衔铁与金属铃碗',
      to: '半圆拱加一条底边、中央垂下一小段铃舌：导线由底边两端引出。它不分正负 —— 电流从哪边进都响，这是它和二极管最要紧的区别' },
  ];

  return {
    build: build, draw: draw, bounds: bounds,
    symRect: symRect, worldRect: worldRect,
    // 电路图里的端子坐标。**页面和测试都该用这个**，别用 D.terminalWorld
    // ——那返回的是【实物】接线柱的位置，变阻器的 C/D 在电路图上已经并到滑片杆顶了。
    termWorld: schTermWorld,
    LEGEND: LEGEND, subscript: subscript, COLOR: COLOR,
    valueOf: valueOf, cellCount: cellCount, batteryHalf: batteryHalf,
    // 电源符号的极板表。导出是为了让「电路图上电源只画一节」这条断言能
    // 直接读【画出去的那份数据】，而不是去数截图上的竖线 —— 谁画谁登记。
    batteryPlates: batteryPlates,
    // 规整化/走线的常量：测试要断言「位移 ≤ MOVE_MAX」，从这里取，
    // 免得内核改了上限、测试还按老数字断（那就成了自证）
    MOVE_MAX: MOVE_MAX,
    version: '3.8.0',
  };
});
