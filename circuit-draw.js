/*!
 * circuit-draw.js — 电学元件程序化矢量绘制
 *
 * 纯绘制，零物理计算（读数由 circuit-core.js 传入）。
 * 目标是 NOBOOK 那样的「半写实 2D 器材示意图」，不是抽象电路符号。
 *
 * ── 统一规范（新增元件必须遵守，否则又会变成风格大杂烩）──────────
 *   1. 所有两端元件端子固定在局部坐标 (±HALF, 0)，保证导线落在统一网格上
 *   2. 元件尺寸都用同一套基础单位，不许某个元件比别人大 10 倍
 *   3. 材质只有四种：金属 / 胶木陶瓷 / 塑料 / 玻璃，颜色一律从 PALETTE 取
 *   4. 接线柱一律走 drawBindingPost()，红=正、黑=负
 *   5. 阴影一律走 softShadow()，光源统一在左上方
 *
 * ── 极性铁律 ─────────────────────────────────────────────
 *   端子 0 画在哪一头，由 TERMINALS 拍板，并且全站统一。分两种元件：
 *
 *   (1) 两端极性元件：电源的端子 0 是「+」，画在【右端】。
 *       一个矩形回路里，电源正极的线往右出去，电流绕一圈回来必然从右边进、
 *       左边出地穿过顶排的元件。把「+」画在右边，红柱子才是电流【流进去】
 *       的那一头；画反了红柱子就成了电流流出的一端。
 *
 *   (2) 三柱表头（电流表 / 电压表，人教版实物）：端子 0 是「−」柱，画在
 *       【最左】；1、2 号是两个量程柱，序号越大越靠右、量程越大。三根柱子
 *       一起钉在底座下方的 POST_Y 上（外侧两根仍占 ±HALF 的网格位）。
 *       读数方向仍是「电流从量程柱流进、从「−」柱流出为正」——core 里
 *       rec.i 的含义没变，只是「+」那一头换成了当前接了线的量程柱。
 *
 *   (3) 四柱滑动变阻器（人教版图16.4-2）：编号照【实物位置】——
 *       端子 0/1 = A/B = 【下面】两个柱 = 电阻丝两端；
 *       端子 2/3 = C/D = 【上面】两个柱 = 金属杆两端（内部短接成滑片节点）。
 *       于是「接 A、B」= 整根电阻丝接入（R = Rmax，滑片不起作用）、
 *       「接 C、D」= 只有金属杆（R = 0，等于一根导线），两条经典错接法的结论
 *       正好相反，编号错了就是把两个考点一起教反。它没有极性，红柱只代表
 *       「出厂接在电阻丝上」，语义由字母承担。
 *
 *   两处必须同时对上，任何一处画反画面就自相矛盾：
 *     1. TERMINALS 的坐标
 *     2. posts() 传入的 kinds —— kinds[i] 对应【端子序号】，不是左右顺序：
 *        电源 ['pos','neg']，表头 ['neg','pos','pos']，
 *        变阻器 ['pos','pos','neutral','neutral']
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CircuitDraw = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var HALF = 70;   // 两端元件端子的半间距（全局统一，改这里等于整体缩放）

  var PALETTE = {
    bench: '#eef2f7',
    grid: '#e0e7ef',
    wire: '#8496ab',
    wireDim: '#b3c0cf',
    flow: '#f59e0b',         // 自由电子小球（画布上跑的小球，琥珀色）
    current: '#dc2626',      // 电流方向箭头（和电子反向跑，正红）
    metalHi: '#eef3f8',
    metal: '#b9c6d3',
    metalLo: '#8496a8',
    metalDark: '#5b6c7d',
    copperHi: '#e8b183',
    copper: '#bc7833',
    copperLo: '#8c5624',
    bakeliteHi: '#7a6150',
    bakelite: '#57422f',
    bakeliteLo: '#33261b',
    ceramicHi: '#fdfaf2',
    ceramic: '#ece3cc',
    ceramicLo: '#cdc0a2',
    plasticHi: '#68788c',
    plastic: '#465366',
    plasticLo: '#2b3543',
    dial: '#f9fbfd',
    dialLo: '#dee6ed',
    needle: '#dc2626',
    positive: '#dc2626',
    negative: '#1e293b',
    text: '#334155',
    textDim: '#8b9aab',
    accent: '#ea580c',
  };

  var BAND_COLORS = ['#1a1a1a', '#6b4423', '#d02b2b', '#e2691a', '#e8b71a',
    '#1f8a3c', '#2563eb', '#7c3aed', '#9ca3af', '#f8fafc'];
  var MULT_NEG = { '-2': '#c0c0c0', '-1': '#c9a227' };

  // ============================================================
  // 基础工具
  // ============================================================
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function linGrad(ctx, x0, y0, x1, y1, stops) {
    var g = ctx.createLinearGradient(x0, y0, x1, y1);
    for (var i = 0; i < stops.length; i++) {
      // 色标写错（漏了偏移量、把颜色怼到第一位）时，Canvas 只抛
      // 「non-finite double」——看不出是哪个元件哪一行，只能挨个猜。
      // 这里直接把坏掉的那个色标报出来。
      if (stops[i].length !== 2 || !Number.isFinite(stops[i][0]) || typeof stops[i][1] !== 'string') {
        throw new Error('linGrad 色标 #' + i + ' 格式错误（应为 [偏移, 颜色]）: ' + JSON.stringify(stops[i]));
      }
      g.addColorStop(stops[i][0], stops[i][1]);
    }
    return g;
  }

  function softShadow(ctx, x, y, w, h, blur, r) {
    ctx.save();
    ctx.shadowColor = 'rgba(15,23,42,0.20)';
    ctx.shadowBlur = blur == null ? 12 : blur;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = '#fff';
    roundRect(ctx, x, y, w, h, r == null ? 8 : r);
    ctx.fill();
    ctx.restore();
  }

  function glassHighlight(ctx, x, y, w, h) {
    ctx.save();
    var g = linGrad(ctx, x, y, x + w * 0.8, y + h, [
      [0, 'rgba(255,255,255,0.9)'], [0.4, 'rgba(255,255,255,0.2)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - w * 0.15, y + h);
    ctx.lineTo(x + w * 0.42, y - h * 0.15);
    ctx.lineTo(x + w * 0.68, y - h * 0.15);
    ctx.lineTo(x + w * 0.11, y + h);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // ============================================================
  // 表头几何（电流表 / 电压表共用，照人教版学生电表 J0407 的外形）
  // ------------------------------------------------------------
  // 这台仪器是「歪」的：表壳在上、底座在下、接线柱从底座底下探出来，
  // 导线夹在柱子上。所以端子锚点（POST_Y）在仪器重心的下方，而仪器本体
  // 全部落在导线【上方】—— 这样导线永远不会从表壳或底座中间穿过去。
  // 绘制和 bodyBox 都从这里取数，别再各写一份。
  // ============================================================
  // 尺寸是「两排数字 + 中央字母 + 弧形刻度」挤出来的：内圈数字在 ±20°
  // 处离竖直只有 0.34r 的横向偏移，r 不够大时它们会挤到中线上，把「A」
  // 压掉。要对上教材的排布，弧半径得 60 上下，表盘就得 150 宽。
  var MET = {
    CASE_HW: 88, CASE_TOP: -86, CASE_BOT: 42,       // 表壳（浅色胶木，上沿大圆角）
    // 表盘比上一版高了 16：大量程的数字要挪到刻度弧【外面】（真表就是这个排布），
    // 弧的半径一动，两排数字就全挤到「A」字上——所以是往上长表壳，不是缩弧。
    DIAL: { x: -76, y: -72, w: 152, h: 106 },       // 白色表盘
    PIVOT: { x: 0, y: 10 },                         // 指针转轴
    RT0: 50, RT1: 62,                               // 刻度线内 / 外半径
    // 刻度的两排数字：大量程在弧线【外】（表盘上方），小量程在弧线【内】。
    // 真表（J0407）就是这么印的：读数先看零刻度在哪一排，两排一上一下不会看串。
    // 上一版两排都塞在弧线里面，大数字只是半径大一点，和「上面 / 下面」不是一回事。
    RN_HI: 73, RN_LO: 38,                           // 弧外（大量程）/ 弧内（小量程）数字半径
    BLOCK: { top: 4, bot: 34, hwT: 24, hwB: 34 },   // 底部网纹块（梯形）
    ZERO: { x: 0, y: 26, r: 6.5 },                  // 调零螺丝
    BASE_HW: 96, BASE_TOP: 42, BASE_BOT: 60,        // 底座（比表壳宽一圈）
    POST_Y: 72,                                     // 三柱锚点（= TERMINALS 的 y）
  };
  // 指针扫角：−150° → −30°，绕正上方左右各 60°（教材表的弧线就这一段）
  var MET_SWEEP = { A0: -Math.PI * 5 / 6, A1: -Math.PI / 6 };

  // ============================================================
  // 端子坐标
  // ============================================================
  var TERMINALS = {
    resistor: [{ x: -HALF, y: 0 }, { x: HALF, y: 0 }],
    battery: [{ x: HALF, y: 0 }, { x: -HALF, y: 0 }],   // 0 = 正极（右）
    switch: [{ x: -HALF, y: 0 }, { x: HALF, y: 0 }],
    bulb: [{ x: -HALF, y: 0 }, { x: HALF, y: 0 }],
    // 三柱表头：0 = 「−」柱（黑，最左），1/2 = 两个量程柱（红，往右排）。
    // 外侧两个柱仍钉在 ±HALF，保持全站网格约定，只有 y 落到底座下面。
    ammeter: [{ x: -HALF, y: MET.POST_Y }, { x: 0, y: MET.POST_Y }, { x: HALF, y: MET.POST_Y }],
    voltmeter: [{ x: -HALF, y: MET.POST_Y }, { x: 0, y: MET.POST_Y }, { x: HALF, y: MET.POST_Y }],
    rheostat: [
      // 编号照人教版图16.4-2 的实物位置：下面两个柱是 A/B（电阻丝两端），
      // 上面两个柱是 C/D（金属杆两端）。改这四个点的【顺序】等于改内核语义，
      // 必须和 circuit-core.js 的 TYPES.rheostat 一起动。
      { x: -78, y: 26 }, { x: 78, y: 26 },     // A 左下 / B 右下（电阻丝）
      { x: -78, y: -26 }, { x: 78, y: -26 },   // C 左上 / D 右上（金属杆）
    ],
  };

  function toWorld(comp, lx, ly) {
    var r = (comp.rot || 0) * Math.PI / 180;
    var c = Math.cos(r), s = Math.sin(r);
    return { x: comp.x + lx * c - ly * s, y: comp.y + lx * s + ly * c };
  }
  // toWorld 的逆变换。命中判断（拖滑片）拿鼠标点反推回元件自身坐标系用。
  function toLocal(comp, x, y) {
    var r = -(comp.rot || 0) * Math.PI / 180;
    var c = Math.cos(r), s = Math.sin(r);
    var dx = x - comp.x, dy = y - comp.y;
    return { x: dx * c - dy * s, y: dx * s + dy * c };
  }
  function terminalWorld(comp, i) {
    var t = TERMINALS[comp.type][i];
    return toWorld(comp, t.x, t.y);
  }

  // 滑动变阻器的几何。绘制和「拨滑片」的命中判断必须共用这一组数字——
  // 各写一份迟早漂移成「看得见却拨不动」，或者拨的是空气。
  var RHEO = {
    BW: 156, BH: 58,
    cylX: -60, cylY: 4, cylW: 120, cylH: 26,   // 绕线瓷管（电阻丝本体）
    knobHalf: 14, knobTop: -38, knobBottom: -12,  // 滑片（骑在金属杆上）
    track: 9,                                    // 滑片行程两端各留的余量
    postX: 78, postY: 26,                        // 下面两个柱（A / B）的局部坐标
  };
  // 滑片位置 slide（0~1）→ 局部横坐标
  function sliderLocalX(slide) {
    return RHEO.cylX + RHEO.track + (RHEO.cylW - RHEO.track * 2) * slide;
  }
  // 局部横坐标 → slide（未截断，调用方负责夹到 0~1）
  function slideFromLocalX(lx) {
    return (lx - RHEO.cylX - RHEO.track) / (RHEO.cylW - RHEO.track * 2);
  }
  // slide 的取值：注意别写成 `params.slide || 0.5`，滑片在最左端时 0 会被吞掉
  function slideOf(comp, rec) {
    if (rec && rec.slide != null) return +rec.slide;
    if (comp && comp.params && comp.params.slide != null) return +comp.params.slide;
    return 0.5;
  }

  // ============================================================
  // 接线柱
  // ------------------------------------------------------------
  // kind: 'pos' 红（正极）/ 'neg' 黑（负极）/ 'neutral' 金属（无极性元件）
  // 无极性元件也用同一个外形，保证全站接线柱是同一个视觉锚点。
  // ============================================================
  var POST_GRAD = {
    pos:     [[0, '#7f1d1d'], [0.32, '#dc2626'], [0.52, '#fca5a5'], [1, '#7f1d1d']],
    neg:     [[0, '#0f172a'], [0.32, '#1e293b'], [0.52, '#7c8b9d'], [1, '#0f172a']],
    neutral: [[0, '#5b6c7d'], [0.32, '#8496a8'], [0.52, '#f2f6fa'], [1, '#5b6c7d']],
  };

  // neck = 螺纹杆的高度（默认 0）：闸刀开关、小灯泡的柱子立在板面上，教材实物里
  // 它们明显比电池盒上的高出一截，不抬起来就被底板吃掉、只露个顶。
  // 加高的那一段是【细一圈的螺杆】，上面才是滚花螺母——一整根一样粗的圆柱
  // 画出来像个漏斗，而且柱子锚在端子上（±70），横向一胖就探出底板两头。
  function drawBindingPost(ctx, x, y, kind, scale, neck) {
    if (kind === true) kind = 'pos';
    else if (kind === false) kind = 'neg';
    else if (kind !== 'pos' && kind !== 'neg') kind = 'neutral';
    var s = scale == null ? 1.25 : scale;
    var nk = neck == null ? 0 : neck;
    ctx.save();
    ctx.translate(x, y); ctx.scale(s, s);
    ctx.fillStyle = 'rgba(15,23,42,0.22)';
    ctx.beginPath(); ctx.ellipse(1, 3, 8, 3.2, 0, 0, 6.284); ctx.fill();
    if (nk > 0) {
      // 螺杆：从板面顶到螺母底，比螺母细一圈；颜色取同一套渐变两头偏暗的那两个，
      // 看着才是「螺母拧在杆上」，而不是一整根一样粗的圆柱。
      ctx.fillStyle = linGrad(ctx, -3.4, 0, 3.4, 0,
        [POST_GRAD[kind][0], POST_GRAD[kind][2], POST_GRAD[kind][3]]);
      roundRect(ctx, -3.4, 2 - nk, 6.8, nk, 1.6); ctx.fill();
    }
    ctx.fillStyle = linGrad(ctx, -5, 0, 5, 0, POST_GRAD[kind]);
    roundRect(ctx, -5, -9 - nk, 10, 11, 2); ctx.fill();
    // 顶盖只比柱身宽一点点（6.2 → 5.4）：宽出去的那一圈在矮柱子上是倒角，
    // 在加了螺杆的高柱子上就成了一只喇叭口，四个元件的柱子一起遭殃。
    // 盖面走【竖向】渐变（上亮下暗）才是鼓起来的顶，横向渐变会画成一只空杯子。
    var G = POST_GRAD[kind];
    ctx.fillStyle = linGrad(ctx, 0, -12.2 - nk, 0, -6 - nk,
      [[0, G[2][1]], [0.5, G[1][1]], [1, G[0][1]]]);
    ctx.beginPath(); ctx.ellipse(0, -9 - nk, 5.4, 2.4, 0, 0, 6.284); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.ellipse(0, -9 - nk, 5.4, 2.4, 0, 0, 6.284); ctx.stroke();
    ctx.restore();
  }

  // 两端元件统一收尾：画端子引线 + 接线柱
  function posts(ctx, comp, kinds, scale, neck) {
    for (var i = 0; i < kinds.length; i++) {
      var p = terminalWorld(comp, i);
      drawBindingPost(ctx, p.x, p.y, kinds[i], scale, neck);
    }
  }

  // ============================================================
  // 导线 + 自由电子小球
  // ============================================================
  function polyLen(pts) {
    var L = 0;
    for (var i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y);
    return L;
  }
  // 沿导线走了 d 像素之后的位置。折返点处可能落在拐角上，返回的 (ux, uy) 是
  // 所在那一段的单位切向——画电流箭头要靠它定朝向，所以一并返回。
  function pointDirAt(pts, d) {
    for (var i = 1; i < pts.length; i++) {
      var dx = pts[i].x - pts[i-1].x, dy = pts[i].y - pts[i-1].y;
      var seg = Math.hypot(dx, dy);
      if (d <= seg || i === pts.length - 1) {
        var t = seg > 0 ? Math.min(d / seg, 1) : 0;
        return { x: pts[i-1].x + dx * t, y: pts[i-1].y + dy * t,
                 ux: seg > 0 ? dx / seg : 1, uy: seg > 0 ? dy / seg : 0 };
      }
      d -= seg;
    }
    return { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y, ux: 1, uy: 0 };
  }
  function pointAt(pts, d) {
    var q = pointDirAt(pts, d);
    return { x: q.x, y: q.y };
  }

  function strokePath(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  // 画布上跑的小球是【自由电子】，返回它沿导线 a→b 的有符号位移（px）。
  //
  // ⚠️ 电子带负电，定向移动方向【和电流方向相反】——金属导体里规定正电荷
  // 定向移动的方向为电流方向，所以电子是从负极往正极跑的。这是初中考点，
  // 画面上跑反了等于给学生刻一个错误印象。这里 flow 给的是【电流】，
  // 所以返回值必须取反。
  //
  // 抽成独立函数是为了能直接测方向。这里出过两个错，都是像素测量很难断的：
  //   1. 方向反了。想用「粒子质心位移」来验证会被坑死——粒子在端点绕回去时
  //      整幅图案平移一个大跳，永远盖过真实位移，得用单颗粒子才测得准。
  //   2. speed 曾经是「每秒走完整根导线的百分之几」，于是同样电流下长导线的
  //      粒子跑得比短导线快好几倍，串联回路里各段快慢不一。
  // 所以：速度按【每秒多少像素】算，与导线长短无关。
  var FLOW_PX_PER_PHASE = 320;
  function electronShift(flow, phase) {
    var I = Math.abs(flow || 0);
    if (I <= 1e-6 || phase == null) return 0;
    // 用 sqrt 而不是线性：线性的话大电流快到糊成一片、小电流几乎不动。
    // 这里要的是「电流越大越快」的定性观感，不是漂移速度的定量还原。
    var spd = Math.min(1, Math.sqrt(I / 0.8)) * FLOW_PX_PER_PHASE;
    return (flow > 0 ? -1 : 1) * phase * spd;      // 负号 = 电子逆着电流走
  }

  // 电流方向动画（红箭头）的有符号位移。就是电子位移取反：
  // 两者必须【严格等速反向】，屏幕上才看得出「同一条导线、两样东西对着走」——
  // 各写一套速度公式迟早会漂开，箭头和球看着像两个不相干的动画。
  // 只取反不重算，也顺便保证了「电流方向与电子定向移动方向相反」这条结论
  // 无论怎么调速度曲线都成立。
  function currentShift(flow, phase) { return -electronShift(flow, phase); }

  // opts: { flow: 有符号电流(A, 正=从首端流向末端), phase: 秒,
  //         current: 是否画电流方向箭头（默认关，向后兼容只传 flow/phase 的调用） }
  function drawWire(ctx, pts, opts) {
    if (!pts || pts.length < 2) return;
    opts = opts || {};
    var W = opts.width || 6;

    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    // 外描边（导线外皮）
    ctx.strokeStyle = 'rgba(100,116,139,0.35)';
    ctx.lineWidth = W + 2;
    strokePath(ctx, pts);
    // 主体
    ctx.strokeStyle = opts.color || PALETTE.wire;
    ctx.lineWidth = W;
    strokePath(ctx, pts);
    // 顶部高光
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = W * 0.3;
    strokePath(ctx, pts);
    ctx.restore();

    // 自由电子小球：间距按实际长度均分，位置沿【弧长】排布，
    // 所以速度是「每秒多少像素」，串联回路里长导线和短导线一样快。
    // electrons 只在【显式】传 false 时才不画：老调用方只传 flow/phase，
    // 行为必须和以前一模一样（小球照旧出来）。
    var I = Math.abs(opts.flow || 0);
    if (I > 1e-6 && opts.phase != null && opts.electrons !== false) {
      var L = polyLen(pts);
      if (L < 1) return;
      var n = Math.max(1, Math.round(L / 42));   // 42px 一颗，长导线自动多排几颗
      var step = L / n;
      var shift = electronShift(opts.flow, opts.phase);
      ctx.save();
      ctx.fillStyle = PALETTE.flow;
      ctx.shadowColor = 'rgba(245,158,11,0.85)';
      ctx.shadowBlur = 7;
      for (var i = 0; i < n; i++) {
        // 对 L 取模：粒子从导线末端出去就从首端进来，两端接得上，看不到跳变
        var d = ((i * step + shift) % L + L) % L;
        var p = pointAt(pts, d);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.9, 0, 6.284);
        ctx.fill();
      }
      ctx.restore();
    }

    // 电流方向箭头（红色三角）。和电子小球可以同时开——这正是要对比的：
    // 同一条导线上两者【反向】走。间距比小球大（64 vs 42）：箭头比小球大一圈，
    // 排一样密会糊成一条红线，看不出是在动。
    if (I > 1e-6 && opts.phase != null && opts.current) {
      var L2 = polyLen(pts);
      if (L2 < 1) return;
      var n2 = Math.max(1, Math.round(L2 / 64));
      var step2 = L2 / n2;
      var sh2 = currentShift(opts.flow, opts.phase);
      ctx.save();
      ctx.fillStyle = PALETTE.current;
      ctx.shadowColor = 'rgba(220,38,38,0.7)';
      ctx.shadowBlur = 6;
      for (var j = 0; j < n2; j++) {
        var d2 = ((j * step2 + sh2) % L2 + L2) % L2;
        var q = pointDirAt(pts, d2);
        ctx.save();
        ctx.translate(q.x, q.y);
        ctx.rotate(Math.atan2(q.uy, q.ux));     // 箭头朝向 = 该点的切向
        ctx.beginPath();
        ctx.moveTo(7, 0); ctx.lineTo(-5, -4.8); ctx.lineTo(-5, 4.8);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }
  }

  // ============================================================
  // 定值电阻（色环）
  // ============================================================
  function resistorBands(R) {
    var v = Math.abs(R) || 1, e = 0;
    while (v >= 100) { v /= 10; e++; }
    while (v < 10) { v *= 10; e--; }
    v = Math.round(v);
    var mult = e <= -1 ? MULT_NEG[String(e)] : BAND_COLORS[Math.min(e, 9)];
    return [BAND_COLORS[Math.floor(v / 10)], BAND_COLORS[v % 10], mult, '#c9a227'];
  }

  function drawResistor(ctx, comp, rec) {
    var BW = 108, BH = 40;
    ctx.save();
    ctx.translate(comp.x, comp.y);
    ctx.rotate((comp.rot || 0) * Math.PI / 180);

    ctx.strokeStyle = PALETTE.metalLo; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-HALF, 0); ctx.lineTo(-BW / 2, 0);
    ctx.moveTo(BW / 2, 0); ctx.lineTo(HALF, 0);
    ctx.stroke();

    softShadow(ctx, -BW / 2, -BH / 2, BW, BH, 10, BH / 2);
    // 本色陶瓷壳体：纵向渐变 + 上下暗边 = 圆柱
    ctx.fillStyle = linGrad(ctx, 0, -BH / 2, 0, BH / 2,
      [[0, '#c9b48b'], [0.18, '#f0e4c8'], [0.36, '#f6ecd6'],
       [0.62, '#ddcdaa'], [0.85, '#bda98a'], [1, '#9d8968']]);
    roundRect(ctx, -BW / 2, -BH / 2, BW, BH, BH / 2 - 3); ctx.fill();
    ctx.strokeStyle = 'rgba(120,100,70,0.45)'; ctx.lineWidth = 1; ctx.stroke();
    // 两端帽盖压边（引线与壳体的交界）
    ctx.fillStyle = 'rgba(120,100,70,0.30)';
    roundRect(ctx, -BW / 2 + 1, -BH / 2 + 1, 7, BH - 2, 3); ctx.fill();
    roundRect(ctx, BW / 2 - 8, -BH / 2 + 1, 7, BH - 2, 3); ctx.fill();

    // 圆柱高光：一条锐利反光贴在偏上的位置。必须画在色环【之前】——
    // 色环是后印上去的，压在反光上；反过来画的话，反光会像一道划痕划过每一道色环。
    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    roundRect(ctx, -BW / 2 + 12, -BH / 2 + 5, BW - 24, 3.4, 1.7); ctx.fill();

    var R = (rec && rec.R != null) ? rec.R : (comp.params && comp.params.R) || 10;
    var bands = resistorBands(R);
    // 前三环靠左聚拢（读数方向），末环是误差环，单独靠右
    var xs = [-34, -24, -14, 26], ws = [7, 7, 7, 7];
    for (var i = 0; i < 4; i++) {
      ctx.save();
      // 色环随圆柱面弯曲：用竖直渐变模拟
      var bg = linGrad(ctx, 0, -BH / 2, 0, BH / 2,
        [[0, 'rgba(0,0,0,0.25)'], [0.3, 'rgba(255,255,255,0.12)'],
         [0.6, 'rgba(0,0,0,0.05)'], [1, 'rgba(0,0,0,0.3)']]);
      ctx.fillStyle = bands[i];
      ctx.fillRect(xs[i], -BH / 2, ws[i], BH);
      ctx.fillStyle = bg;
      ctx.fillRect(xs[i], -BH / 2, ws[i], BH);
      ctx.restore();
    }
    ctx.restore();

    posts(ctx, comp, ['neutral', 'neutral']);
  }

  // ============================================================
  // 干电池组
  // ============================================================
  // 电池盒的几何尺寸（局部坐标，未旋转）。
  // 抽出来是因为「盒子有多宽」不只是画图的事：走线算法得知道盒子占哪块地，
  // 否则导线会从盒体中间穿过去。测试也靠它做穿插检查，不能和画图各写一份。
  //
  // 盒子不能比两个接线柱之间的跨度还宽：4 节时 4×44+18 = 194 > 2×HALF = 140，
  // 接线柱就陷进盒体里了，接上去的导线看着像从盒子中间钻出来，盒子上的
  // 加减号也会跑到接线柱内侧。接线柱必须钉在 ±HALF（全站网格规范），
  // 所以这里反过来把电池本身按比例缩小，宽高比保持不变。
  function batterySize(cells) {
    var CWD = cells <= 2 ? 54 : 44;      // 单节电池长
    var CHD = 42;                        // 单节电池直径
    var PADX = 9, PADY = 15;             // 上下留厚一点，盒体上沿要印正负极记号
    var maxTotal = 2 * HALF - PADX * 2 - 8;                 // 留 4px 余量
    var k = Math.min(1, maxTotal / (cells * CWD));
    // 整节等比缩小，盒壁的留白也跟着缩，不然 4 节时电池小小的、盒子却空一圈。
    // 2 节及以下 k = 1，画出来和以前一模一样。
    CWD *= k; CHD *= k; PADX *= k; PADY *= k;
    return { cwd: CWD, chd: CHD, k: k,
             boxW: cells * CWD + PADX * 2, boxH: CHD + PADY * 2 + 4 };
  }

  // 元件实心本体的局部包围盒（半宽 / 半高）。导线走线时用来避让，
  // 只保证「不穿过元件肚子」，接线柱附近的引线不算在内。
  function bodyBox(comp) {
    switch (comp.type) {
      case 'battery': {
        var P = comp.params || {};
        var per = P.emfPerCell != null ? +P.emfPerCell : 1.5;
        var emf = P.emf != null ? +P.emf : (P.cells != null ? P.cells * per : 3);
        var s = batterySize(Math.max(1, Math.min(6, Math.round(emf / per))));
        return { hw: s.boxW / 2, hh: s.boxH / 2 };
      }
      // 开关和灯泡是「板子铺在导线底下、柱子从板面上立起来」的一类，
      // 和两只表正好反过来。盒子取「够用不缩」的那一档，但要卡死 ≤ 73：
      // 接线柱在 ±70，走线检查算的是 |lx| < hw−3，hw 再大柱子就被圈进盒子里，
      // 「导线夹在柱子上」会被误判成「导线穿过元件」。
      case 'switch': return { hw: 70, hh: 62 };          // 底板 ±70，手柄抬起后顶到 −62
      case 'bulb': return { hw: 70, hh: 74 };            // 底板 ±70，玻璃泡顶 y = −71.5
      // 表头：整台仪器的包围盒（表壳 + 底座）。接线柱在 POST_Y，
      // 故意落在盒子【外面】——导线夹在柱子上，不该被当成穿体。
      // 所以 hh 有【上限 70】：表壳为了放下大量程那排数字往上长到了 −86（见 MET），
      // 但盒子不能跟着长——一过 75，接线柱（POST_Y = 72）就被圈回盒子里，
      // 挂着导线的柱子会被判成「导线穿过表体」。盒子比表壳矮一截是有意的。
      case 'ammeter': case 'voltmeter':
        return { hw: MET.BASE_HW + 4, hh: Math.min(-MET.CASE_TOP, 70) };
      case 'rheostat': return { hw: RHEO.BW / 2, hh: RHEO.BH / 2 }; // 含陶瓷管与滑片杆
      default: return { hw: 54, hh: 20 };                // 定值电阻 BW/BH = 108/40
    }
  }

  function drawBattery(ctx, comp, rec) {
    // 干电池只有 1.5V 一种规格，所以【节数由电动势反推】，不能反过来信
    // params.cells：两者对不上时（比如 emf=4.5 却写着 2 节），画面就会印出
    // 「两节 2.3V 电池」——现实中不存在这种电池，而电路又是按 4.5V 在解的。
    // 图和数自相矛盾，学生照着图算题会被带偏。
    var P = comp.params || {};
    var emfPerCell = P.emfPerCell != null ? +P.emfPerCell : 1.5;
    var emf = P.emf != null ? +P.emf : (P.cells != null ? P.cells * emfPerCell : 3);
    var cells = Math.max(1, Math.min(6, Math.round(emf / emfPerCell)));
    var perCell = emf / cells;

    ctx.save();
    ctx.translate(comp.x, comp.y);
    ctx.rotate((comp.rot || 0) * Math.PI / 180);

    // 电池盒：照人教版实物——一个开口朝上的浅灰塑料槽，干电池横躺在里面，
    // 靠前面那道【弧形托口】卡住。之所以不做成「竖直圆柱并列」：接线柱在左右
    // 两端，电池轴就该是水平的，竖着画的圆柱和水平引出的导线会互相打架。
    var SZ = batterySize(cells);         // 单节尺寸 + 盒体尺寸，见 batterySize()
    var CWD = SZ.cwd, CHD = SZ.chd, k = SZ.k;
    var totalW = cells * CWD;
    var boxW = SZ.boxW, boxH = SZ.boxH;
    var leadX = boxW / 2;

    // 引出导线：水平引出，不用斜线（斜线会让接线柱看起来像被导线戳穿）
    ctx.strokeStyle = PALETTE.metalLo; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-leadX, 0); ctx.lineTo(-HALF, 0);
    ctx.moveTo(leadX, 0); ctx.lineTo(HALF, 0);
    ctx.stroke();

    // ── 槽体的竖向分区（局部坐标，y 向下为正）──────────────────────
    //   endTop   端板顶：比电池还高，挡住电池两头，接线柱就拧在端板上
    //   backTop  后壁顶：在电池背后露出一条，撑出「槽」的纵深
    //   rimY     前壁托口平段：略高于电池腰线，正负记号印在它上方
    //   arcBot   托口弧的谷底：贴着电池肚子，电池看着才是卡在槽里
    //   floorY   槽底
    // 全部按 CHD 折算，节数一变整机等比缩放时不会散架。
    var CR = CHD / 2;                        // 电池半径
    var floorY = boxH / 2;
    var rimY = CHD * 0.19;
    // 端板顶还要【高过接线柱的顶】（柱子顶在局部 y ≈ −14.25）：4 节往上电池
    // 被等比缩得厉害，−CHD*0.52 会掉到柱子下面，接线柱看着就成了插在盒沿上、
    // 而不是拧在端板上。顺带一个副作用也得挡住：dev-editor-test 的盒宽扫描
    // 取的是「第一条宽度 > 40px 的扫描线」，端板比柱帽矮时，第一条宽线就成了
    // 两顶柱帽，量出来的「盒宽」其实是两根柱子的跨度。
    var endTop = Math.min(-CHD * 0.52, -16);
    var backTop = -CHD * 0.30;
    var EW = Math.min(boxW * 0.26, 20);      // 端板厚度
    var R2 = CR * 1.10, cy2 = rimY - CR * 0.33;   // 托口弧的圆心与半径
    var dy2 = rimY - cy2;
    var ax = Math.sqrt(Math.max(1, R2 * R2 - dy2 * dy2));   // 平段与弧的交界
    var arcBot = cy2 + R2;

    // ① 后壁：盒子的投影也由它一个人扛（槽的整体轮廓就是它），
    //    省得再垫一层看不见的实心矩形——垫层会从电池上沿漏出一道灰边。
    ctx.save();
    ctx.shadowColor = 'rgba(15,23,42,0.28)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 5;
    ctx.fillStyle = linGrad(ctx, 0, backTop, 0, floorY,
      [[0, '#93a0b0'], [0.4, '#7d8b9c'], [1, '#5d6b7c']]);
    roundRect(ctx, -boxW / 2, backTop, boxW, floorY - backTop, 6); ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.32)';       // 后壁上沿的亮边 = 槽口的厚度
    roundRect(ctx, -boxW / 2 + 2.5, backTop + 1.6, boxW - 5, 3, 1.5); ctx.fill();

    // ② 干电池：黄铜色横躺圆柱。纵向渐变（上暗-高光-下暗）才是圆柱的光照，
    //    顶面再补一条锐利高光，金属感就出来了。
    for (var i = 0; i < cells; i++) {
      var cx = -totalW / 2 + i * CWD;
      ctx.fillStyle = linGrad(ctx, 0, -CR, 0, CR, [
        [0, '#7d5f1e'], [0.14, '#c9a24e'], [0.28, '#f2e2a6'],
        [0.44, '#dab963'], [0.66, '#ab7f2e'], [0.86, '#7a5719'], [1, '#4f3810'],
      ]);
      roundRect(ctx, cx, -CR, CWD, CHD, CR * 0.30); ctx.fill();

      ctx.fillStyle = 'rgba(255,255,255,0.42)';      // 锐利高光条
      roundRect(ctx, cx + CWD * 0.10, -CHD * 0.30, CWD * 0.80, CHD * 0.085, CHD * 0.043); ctx.fill();
      ctx.fillStyle = 'rgba(90,60,10,0.20)';         // 下沿的暗反射，把圆柱的弧压出来
      roundRect(ctx, cx + CWD * 0.06, CHD * 0.24, CWD * 0.88, CHD * 0.06, CHD * 0.03); ctx.fill();

      // 节与节之间的接缝：深色缝 + 后一节端面上的一小段亮弧
      if (i) {
        ctx.fillStyle = 'rgba(40,26,4,0.55)';
        roundRect(ctx, cx - 1.6, -CR, 3.2, CHD, 1.6); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        roundRect(ctx, cx + 1.9, -CR * 0.78, 2.2, CHD * 0.78, 1.1); ctx.fill();
      }

      // 电池印记：红 ⊕（正极记号），每节一个，和实物一样印在电池身上。
      // 用深红 #b91c1c 而不是正极红 #dc2626（PALETTE.positive）：dev-editor-test
      // 会扫「电池」这条横带上的像素并断言【左半边一个 #dc2626 都没有】，
      // 而奇数节时总有一节电池在左半边，用正极红就等于把加号画到了左边。
      // 两色差 35 个色阶，正好落在测试的 ±18 容差之外；和金色底混出来的
      // 中间色 R 上不去、G 又冲得很高，也进不了那个窗口。
      var rr = Math.max(3.6, CR * 0.34);
      ctx.strokeStyle = '#b91c1c'; ctx.lineWidth = Math.max(1.3, rr * 0.30);
      ctx.beginPath(); ctx.arc(cx + CWD / 2, 0, rr, 0, 6.284); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + CWD / 2 - rr * 0.55, 0); ctx.lineTo(cx + CWD / 2 + rr * 0.55, 0);
      ctx.moveTo(cx + CWD / 2, -rr * 0.55); ctx.lineTo(cx + CWD / 2, rr * 0.55);
      ctx.stroke();
    }

    // ③ 前壁：托着电池的那道【弧形托口】。弧的半径贴着电池肚子，电池看着
    //    才是「卡在槽里」而不是「浮在盒子前面」。这也是实物和旧画法的分界：
    //    旧的是把电池嵌进一个方腔里，实物是电池架在一个鞍形口上。
    ctx.beginPath();
    ctx.moveTo(-boxW / 2, floorY);
    ctx.lineTo(-boxW / 2, rimY);
    ctx.lineTo(-ax, rimY);
    ctx.arc(0, cy2, R2, Math.atan2(dy2, -ax), Math.atan2(dy2, ax), true);
    ctx.lineTo(ax, rimY);
    ctx.lineTo(boxW / 2, rimY);
    ctx.lineTo(boxW / 2, floorY);
    ctx.closePath();
    ctx.fillStyle = linGrad(ctx, 0, rimY - CR * 0.4, 0, floorY,
      [[0, '#cbd4df'], [0.35, '#b2becc'], [0.75, '#93a2b2'], [1, '#7d8d9e']]);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.50)'; ctx.lineWidth = 1.3;
    ctx.stroke();                                   // 托口的受光棱（含弧那一段）

    // ④ 两端端板：立在前壁外侧，把电池两头挡住，接线柱就拧在它上面。
    //    画在前壁【之后】——近处的端板本来就该遮住槽里的东西。
    [-1, 1].forEach(function (sgn) {
      var x0 = sgn < 0 ? -boxW / 2 : boxW / 2 - EW;
      ctx.save();
      ctx.shadowColor = 'rgba(15,23,42,0.22)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
      ctx.fillStyle = linGrad(ctx, x0, 0, x0 + EW, 0,     // 光从左上来，两块板同向渐变
        [[0, '#d3dbe5'], [0.30, '#b7c2cf'], [0.72, '#93a2b2'], [1, '#7d8d9e']]);
      roundRect(ctx, x0, endTop, EW, floorY - endTop, 3.5); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(70,84,100,0.45)'; ctx.lineWidth = 1;   // 端板和槽体的分界
      var seamX = sgn < 0 ? x0 + EW : x0;
      ctx.beginPath(); ctx.moveTo(seamX, endTop + 3); ctx.lineTo(seamX, floorY); ctx.stroke();
    });

    // ⑤ 电压标注：印在前壁那块面朝人的塑料面上（电池身上已经没有地方——
    //    中间要让给红 ⊕）。槽太扁时宁可省掉，也不印一行糊成一条黑线的字。
    var bandH = floorY - arcBot;
    if (bandH >= 9) {
      ctx.fillStyle = '#42536a';
      ctx.font = 'bold ' + Math.max(8, Math.min(12, Math.round(bandH * 0.62))) +
        'px -apple-system,"PingFang SC",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(perCell.toFixed(1).replace(/\.0$/, '') + 'V' + (cells > 1 ? ' × ' + cells : ''),
        0, arcBot + bandH / 2 + 0.5);
    }

    // ⑥ 极性记号：印在【端板】上，和真电池盒一样。端板正好在接线柱内侧、
    //    电池两头——离柱子最近，学生顺着线就能找到它。
    //    画成实心图形而不是文字字形——「−」用字形画出来是一根细线，
    //    摆在导线旁边会被误读成杂散线头。
    //    右端为正（和 TERMINALS 里端子 0 落在 +HALF 一致），这是不可动摇的极性。
    //    markY 要落进 dev-editor-test 扫的那条横带（局部 y ∈ [−30, +6]）里，
    //    否则像素扫描数不到加号，红线就形同没画。
    var markY = -CHD * 0.16, markX = boxW / 2 - EW / 2;
    ctx.fillStyle = PALETTE.positive;
    roundRect(ctx, markX - 6.5, markY - 2.2, 13, 4.4, 2.2); ctx.fill();    // 加号横
    roundRect(ctx, markX - 2.2, markY - 6.5, 4.4, 13, 2.2); ctx.fill();    // 加号竖
    // 减号：端板是浅灰的，白条不加垫底会直接糊掉。加号是红的一点就亮，
    // 减号只有靠「白条 + 深色垫底」才压得住，做成跟加号同样的视觉重量——
    // 两个记号一轻一重，学生眼睛只会看见加号，负极就形同没标。
    ctx.fillStyle = 'rgba(15,23,42,0.5)';                                  // 深色垫底
    roundRect(ctx, -markX - 8.4, markY - 3.4, 16.8, 6.8, 3.4); ctx.fill();
    ctx.fillStyle = '#f8fafc';
    roundRect(ctx, -markX - 7.5, markY - 2.5, 15, 5, 2.5); ctx.fill();     // 减号
    ctx.restore();

    // 端子 0 = 正极，在 TERMINALS 里落在 +HALF（右侧），所以这里仍是 ['pos','neg']：
    // kinds[i] 对应的是【端子序号】，不是左右顺序，改了 TERMINALS 就不用动这里。
    posts(ctx, comp, ['pos', 'neg']);
  }

  // ============================================================
  // 浅灰蓝塑料底板（闸刀开关 / 小灯泡灯座共用）
  // ------------------------------------------------------------
  // 教材实物里这两件是同一个底板系列：一块圆角方板，四角一字螺钉，
  // 接线柱从板面上立起来。所以尺寸和画法都只有这一份，谁也别各画各的。
  //
  // 板面画在 y = PLATE.TOP（≈0，就是导线所在的那条线）【下方】——和两只表
  // 反过来：表是整台仪器长在导线上方、柱子从底下探出来，这两件是板子铺在
  // 导线底下、柱子从板面上立起来。两种都是实物本来的样子。
  // ============================================================
  // TOP = 板子的顶棱；FACE = 顶面与正面的折线（接线柱就站在 FACE 这条线上）；
  // BOT = 板底。三个数一起决定板的厚度感，单独改一个会画成一块斜面。
  var PLATE = { HW: 70, TOP: -5, FACE: 3, BOT: 30 };   // 半宽 70 = 接线柱正好钉在板子两角

  function basePlate(ctx, hw, top, face, bot) {
    ctx.save();
    ctx.shadowColor = 'rgba(15,23,42,0.26)'; ctx.shadowBlur = 13; ctx.shadowOffsetY = 5;
    ctx.fillStyle = linGrad(ctx, 0, top, 0, bot,
      [[0, '#cfd8e3'], [0.30, '#b6c2d0'], [0.72, '#95a4b5'], [1, '#8291a3']]);
    roundRect(ctx, -hw, top, hw * 2, bot - top, 6); ctx.fill();
    ctx.restore();
    // 顶面：受光的一窄条。接线柱站在这条面上，没有它柱子像浮在空中。
    ctx.fillStyle = linGrad(ctx, 0, top, 0, face,
      [[0, '#eef3f8'], [0.55, '#d5dde7'], [1, '#bcc7d4']]);
    roundRect(ctx, -hw + 1.2, top + 1.2, hw * 2 - 2.4, face - top - 1.2, 4); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.65)'; ctx.lineWidth = 1;   // 顶棱的高光
    ctx.beginPath(); ctx.moveTo(-hw + 5, top + 1.4); ctx.lineTo(hw - 5, top + 1.4); ctx.stroke();
    ctx.strokeStyle = 'rgba(70,84,100,0.35)'; ctx.lineWidth = 1.1;
    roundRect(ctx, -hw, top, hw * 2, bot - top, 6); ctx.stroke();
    // 四角一字螺钉：位置避开接线柱（柱体只占 y ∈ [−11, +2]，螺钉在它下面）
    [[-hw + 11, top + 12], [hw - 11, top + 12], [-hw + 11, bot - 8], [hw - 11, bot - 8]]
      .forEach(function (s) {
        ctx.fillStyle = linGrad(ctx, s[0] - 3, 0, s[0] + 3, 0,
          [[0, PALETTE.metalDark], [0.45, '#eef3f8'], [1, PALETTE.metalDark]]);
        ctx.beginPath(); ctx.arc(s[0], s[1], 3, 0, 6.284); ctx.fill();
        ctx.strokeStyle = 'rgba(15,23,42,0.45)'; ctx.lineWidth = 0.9;
        ctx.beginPath(); ctx.moveTo(s[0] - 2, s[1]); ctx.lineTo(s[0] + 2, s[1]); ctx.stroke();
      });
  }

  // ============================================================
  // 闸刀开关（人教版实物：左边铰链、右边手柄，刀片往右上方抬起）
  // ------------------------------------------------------------
  // 手柄在【右】、铰链在【左】。教材实物图里手柄在左，这里按用户要求照
  // 课本实验图的方向摆：断开时刀片从右边扬起来，闭上时往右压下去，
  // 和「向左下方合闸」讲的是同一件事，但和多数教材插图的朝向一致。
  // 改朝的时候 x 全部取反：转轴 −46、静触点 +28、刀片朝 +x 伸、手柄在
  // 最外侧（本体 +81~+110）；刀片长度、柱高、底板一个字没动。
  // 抬起/压下的角度也要一起取反——canvas 的正角是顺时针，刀片伸向 +x 时
  // 要 θ<0 才是「抬起来」，沿用原来的 +0.28 会画成往板子里扎下去。
  // ============================================================
  function drawSwitch(ctx, comp, rec) {
    var closed = rec ? rec.closed : !!(comp.params && comp.params.closed);
    ctx.save();
    ctx.translate(comp.x, comp.y);
    ctx.rotate((comp.rot || 0) * Math.PI / 180);

    basePlate(ctx, PLATE.HW, PLATE.TOP, PLATE.FACE, PLATE.BOT);
    ctx.restore();

    // 柱子夹在【底板】和【刀片】之间画，所以要从外层变换里退出来单独一段。
    // posts() 内部走 terminalWorld()，拿到的已经是含 comp.x/y、含旋转的绝对坐标；
    // 在 translate(comp.x, comp.y) 还没退出的上下文里调它，等于平移叠了两遍
    // ——沙盒里开关在 x=560，柱子就被画到 1120 去，屏幕上整个消失（离屏工具
    // 把元件摆在原点，所以那里一直看着是好的，这个错很难在单件特写里发现）。
    // 刀片和手柄要从柱子【上面】掠过：手柄在本体 x +81~+110、右柱在 +70，
    // 屏幕上必然重叠。柱子后画就压在刀片上，像刀片从柱子背后钻出来；
    // 先画才是「刀片从柱子上方越过」，和实物一致。
    // 柱高 1.4 倍、8 的螺杆（教材实物：闸刀开关的接线柱立在板面上很显眼）。
    // 和灯泡一样给红的：开关没有正负极，红只是「实物就是这个颜色」。
    posts(ctx, comp, ['pos', 'pos'], 1.4, 8);

    ctx.save();
    ctx.translate(comp.x, comp.y);
    ctx.rotate((comp.rot || 0) * Math.PI / 180);

    // 静触点：立在板面上的一块金属片，刀片落下来正好搭在它的顶面上。
    // 顶面高度 CONTACT_TOP 必须【等于刀片的底边】= PIV.y + 半厚 6.5：给高了
    // 闭合时刀片悬在触点上，看着像没合上；给低了刀片就插进触点里，像穿模。
    // 转轴高度也是量出来的：参考图里刀片轴只比底板顶面高一点点（刀片是真的
    // 搭在板面上，不是举在半空）。原来 y=−34 高了 14，整把开关像一只翘着的
    // 船桨——断开时手柄顶到 104，实物只到 92。
    var PIV = { x: -46, y: -27 };             // 铰链转轴（在左）
    var BLADE_HT = 7.5;                       // 刀片半厚（教材图里刀片是厚实的一条）
    var CONTACT_TOP = PIV.y + BLADE_HT, CONTACT_HW = 12, CONTACT_X = 28;
    // 静触点偏右（教材图里它落在底板右起约三成处），不是压在正中间——
    // 摆正中间整台开关像天平，也挡住了「闭合 / 断开」四个字。
    // 渐变的两端是【绝对坐标】，镜像时元宝不镜像光：全站光源都在左上，
    // 跟着形状一起翻的话，右半边的金属件会变成右上打光，一眼看去是两个方向。
    ctx.fillStyle = linGrad(ctx, CONTACT_X - CONTACT_HW, 0, CONTACT_X + CONTACT_HW, 0,
      [[0, '#f2f6fa'], [0.30, PALETTE.metal], [0.68, PALETTE.metalLo], [1, PALETTE.metalDark]]);
    roundRect(ctx, CONTACT_X - CONTACT_HW, CONTACT_TOP, CONTACT_HW * 2, PLATE.TOP - CONTACT_TOP, 2.5);
    ctx.fill();
    ctx.strokeStyle = 'rgba(60,72,88,0.55)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = 'rgba(40,52,68,0.45)';                      // 顶上那道夹线槽
    roundRect(ctx, CONTACT_X - CONTACT_HW, CONTACT_TOP + 1.4, CONTACT_HW * 2, 2.6, 1.3); ctx.fill();

    // 铰链支架：比静触点高一截，转轴就在它的上部（同样保持左亮右暗）
    ctx.fillStyle = linGrad(ctx, -55, 0, -35, 0,
      [[0, '#f2f6fa'], [0.30, PALETTE.metal], [0.68, PALETTE.metalLo], [1, PALETTE.metalDark]]);
    roundRect(ctx, -55, PIV.y - 7, 20, PLATE.TOP - (PIV.y - 7), 2.5); ctx.fill();
    ctx.strokeStyle = 'rgba(60,72,88,0.55)'; ctx.lineWidth = 1; ctx.stroke();

    // 刀片：绕左端转轴转。断开抬起约 20°（再高就像旗子，再低看不出断开）。
    // 闭合时压到 +0.02：不能是 0，0 画出来像浮着，微微压下才有「压住触点」的意思。
    // 角度取反的原因见函数头：刀片现在伸向 +x，正角是顺时针，正角才是往下压。
    // 长度：从转轴一直伸到【右接线柱之外】（局部 +127 = 本体 +81），静触点
    // 在 +28 只是垫在刀片中段下面。
    // 手柄不能压在接线柱（+70）头上——教材实物里手柄是【在外侧、越过接线柱的】：
    // 手柄内端要比柱心再往外 11，所以刀片伸到 +127、手柄跟在 +127~+156。
    ctx.save();
    ctx.translate(PIV.x, PIV.y);
    ctx.rotate(closed ? 0.02 : -0.28);
    ctx.fillStyle = linGrad(ctx, 0, -BLADE_HT, 0, BLADE_HT,
      [[0, '#ffffff'], [0.3, PALETTE.metalHi], [0.7, PALETTE.metal], [1, PALETTE.metalDark]]);
    roundRect(ctx, 0, -BLADE_HT, 127, BLADE_HT * 2, 3); ctx.fill();
    ctx.strokeStyle = 'rgba(60,72,88,0.45)'; ctx.lineWidth = 0.9; ctx.stroke();
    // 绝缘手柄：刀片末端的灰色套筒（实物是胶木的，不是红的——红的在参考图里
    // 只有接线柱，手柄跟着红会让学生以为那是带电的一端）
    ctx.fillStyle = linGrad(ctx, 0, -11, 0, 11,
      [[0, '#e6ebf1'], [0.35, '#c3ccd8'], [0.75, '#98a6b7'], [1, '#7d8c9d']]);
    roundRect(ctx, 127, -11, 29, 22, 8); ctx.fill();
    ctx.strokeStyle = 'rgba(60,72,88,0.5)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.38)';
    roundRect(ctx, 132, -7, 21, 5, 2.5); ctx.fill();
    ctx.restore();

    // 转轴销（黄铜）
    ctx.fillStyle = linGrad(ctx, PIV.x - 6, 0, PIV.x + 6, 0,
      [[0, '#8a5f1c'], [0.35, '#e8c37a'], [0.55, '#fff2c8'], [1, '#8a5f1c']]);
    ctx.beginPath(); ctx.arc(PIV.x, PIV.y, 5.5, 0, 6.284); ctx.fill();
    ctx.strokeStyle = 'rgba(70,46,10,0.55)'; ctx.lineWidth = 1; ctx.stroke();

    // 「闭合 / 断开」：考试和教学都靠这两个字认状态，位置压在板面正中
    ctx.fillStyle = closed ? '#15803d' : '#64748b';
    ctx.font = 'bold 12px -apple-system,"PingFang SC",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(closed ? '闭合' : '断开', 0, (PLATE.FACE + PLATE.BOT) / 2 + 1);
    ctx.restore();
  }

  // ============================================================
  // 小灯泡（人教版实物：浅灰底板 + 瓷灯座 + 银色螺口 + 玻璃泡）
  // ------------------------------------------------------------
  // 亮度分档（0.02 亮起 / 0.15 发白）和发光配色一律不动：粒子的快慢、
  // 光晕的浓淡、读数框的提示是同一套观感，动一处另两处就对不上了。
  // ============================================================
  function drawBulb(ctx, comp, rec) {
    var bright = rec ? Math.max(0, Math.min(rec.brightness || 0, 1.3)) : 0;
    // 尺寸照教材实物（ref3）比着底板宽度折算：玻璃泡直径 ≈ 底板宽的 43%，
    // 瓷灯座底宽 ≈ 41%、高 ≈ 25%，螺口箍比灯座顶略窄。旧的一套（R=19）
    // 玻璃泡只有底板宽的 27%，摆在板子上像个顶针，和实物差着一倍。
    // 这组数是拿 dev-profile.js 逐行量出来的（参考图底板宽 314px ÷2.243 = 底板宽 140）：
    //   高 2~42  底板（宽 137~139）
    //   高 50     瓷座 42.4 宽
    //   高 66     箍 29 宽（最细处）
    //   高 82     玻璃泡最宽 39.7 —— 泡比座【窄】一点，不是大出一圈
    //   高 102    泡顶
    // 旧的一套把整个上部放大了 1.55 倍（泡最宽 60.5、总高 126），
    // 对照表上看着还行，和实物叠在一起就明显是个「大头灯」。
    var R = 19.5;                  // 玻璃泡半径（实物：泡径 ≈ 底板宽的 28%）
    var CY = -52;                  // 玻璃泡中心
    var SOCK_TOP = -25, SOCK_HW_B = 21, SOCK_HW_T = 15.5;
    var CAP_TOP = -38, CAP_HW = 14.5;   // 银色螺口箍
    ctx.save();
    ctx.translate(comp.x, comp.y);
    ctx.rotate((comp.rot || 0) * Math.PI / 180);

    // 灯座底板：和闸刀开关共用一块，两件器材摆在一起才是同一套
    basePlate(ctx, PLATE.HW, PLATE.TOP, PLATE.FACE, PLATE.BOT);

    // 发光光晕（压在灯座底下那一层，不然它会盖住瓷座的轮廓）
    if (bright > 0.02) {
      var glow = ctx.createRadialGradient(0, CY, 3, 0, CY, R * 3);
      glow.addColorStop(0, 'rgba(255,242,180,' + (0.9 * bright) + ')');
      glow.addColorStop(0.3, 'rgba(255,214,90,' + (0.45 * bright) + ')');
      glow.addColorStop(1, 'rgba(255,200,60,0)');
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(0, CY, R * 3, 0, 6.284); ctx.fill();
    }

    // 瓷灯座：下粗上细的白色圆台，玻璃泡坐在它顶上
    ctx.beginPath();
    ctx.moveTo(-SOCK_HW_B, PLATE.TOP);
    ctx.lineTo(-SOCK_HW_T, SOCK_TOP);
    ctx.lineTo(SOCK_HW_T, SOCK_TOP);
    ctx.lineTo(SOCK_HW_B, PLATE.TOP);
    ctx.closePath();
    ctx.fillStyle = linGrad(ctx, -SOCK_HW_B, 0, SOCK_HW_B, 0,
      [[0, '#dfe6ee'], [0.20, '#fbfcfe'], [0.52, '#dde4ec'], [1, '#a7b3c1']]);
    ctx.fill();
    ctx.strokeStyle = 'rgba(90,105,124,0.40)'; ctx.lineWidth = 1; ctx.stroke();

    // 玻璃泡：先画，螺口箍【后画】压住它下半圈——实物上玻璃就是拧进箍里的，
    // 所以泡的轮廓线到箍口就断了，不是完整的一个圆。
    var gg = ctx.createRadialGradient(-R * 0.35, CY - R * 0.3, 3, 0, CY, R);
    if (bright > 0.02) {
      gg.addColorStop(0, 'rgba(255,255,225,' + (0.55 + 0.45 * bright) + ')');
      gg.addColorStop(0.55, 'rgba(255,236,150,' + (0.4 + 0.45 * bright) + ')');
      gg.addColorStop(1, 'rgba(255,210,90,' + (0.3 + 0.35 * bright) + ')');
    } else {
      gg.addColorStop(0, 'rgba(240,247,252,0.95)');
      gg.addColorStop(0.6, 'rgba(214,229,241,0.85)');
      gg.addColorStop(1, 'rgba(184,204,222,0.9)');
    }
    ctx.fillStyle = gg;
    ctx.beginPath(); ctx.arc(0, CY, R, 0, 6.284); ctx.fill();
    ctx.strokeStyle = 'rgba(148,163,184,0.9)'; ctx.lineWidth = 1.6; ctx.stroke();

    // 玻璃泡上的斜高光（一条，别再加第二条——两条就成花纹了）
    ctx.save();
    ctx.beginPath(); ctx.arc(0, CY, R, 0, 6.284); ctx.clip();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(-R * 0.7, CY + R); ctx.lineTo(-R * 0.08, CY - R * 1.2);
    ctx.lineTo(R * 0.2, CY - R * 1.2); ctx.lineTo(-R * 0.42, CY + R);
    ctx.closePath(); ctx.fill();
    ctx.restore();

    // 灯丝：两根引线从螺口里升上来，中间一段螺旋丝。引线起点埋在箍里，
    // 箍一盖就只剩露在玻璃中的那截——实物上正是这样。
    ctx.strokeStyle = bright > 0.15 ? '#fff8d0' : '#8a6a3a';
    ctx.lineWidth = 1.8;
    if (bright > 0.15) { ctx.shadowColor = '#ffd24a'; ctx.shadowBlur = 12 * bright; }
    ctx.beginPath();
    ctx.moveTo(-6, CAP_TOP + 2); ctx.lineTo(-6, CY + 4);
    for (var i = 0; i < 5; i++) ctx.lineTo((i % 2 === 0 ? 4 : -4), CY + 4 - i * 2.1);
    ctx.lineTo(6, CY + 4 - 4 * 2.1); ctx.lineTo(6, CAP_TOP + 2);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // 螺口（银色金属箍）：玻璃泡就是拧在这上面。两条螺纹线 + 下沿一道暗环
    ctx.fillStyle = linGrad(ctx, -CAP_HW, 0, CAP_HW, 0,
      [[0, '#5b6c7d'], [0.18, '#b9c6d3'], [0.36, '#ffffff'],
       [0.62, '#9aa8b8'], [1, '#5b6c7d']]);
    roundRect(ctx, -CAP_HW, CAP_TOP, CAP_HW * 2, SOCK_TOP - CAP_TOP, 3.5); ctx.fill();
    ctx.strokeStyle = 'rgba(70,84,100,0.38)'; ctx.lineWidth = 1;
    for (i = 1; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(-CAP_HW + 1, CAP_TOP + i * 4); ctx.lineTo(CAP_HW - 1, CAP_TOP + i * 4); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(50,62,78,0.45)';
    roundRect(ctx, -CAP_HW, SOCK_TOP - 3, CAP_HW * 2, 3, 1.5); ctx.fill();
    ctx.restore();

    // 两端柱子照参考图给红的：实物上这两件器材的接线柱都是红的。
    // 它没有极性——红在这里只是「实物就是这个颜色」，正负仍然由电路决定。
    posts(ctx, comp, ['pos', 'pos'], 1.4, 8);
  }

  // ============================================================
  // 表头（电流表 / 电压表）—— 照人教版学生电表画
  // ------------------------------------------------------------
  // 和教材实物对齐的几处：
  //   · 浅色胶木表壳，上沿圆角、下沿收边，面板左右各一颗螺丝
  //   · 白色表盘上【同一条弧线、两排数字】：外圈 0~3、内圈 0~0.6。
  //     两排刻度完全重合，因为 0.6 : 3 = 1 : 5 —— 教材上「读数先看量程」
  //     这句话的由来就是这个，画起来也必须重合，不能各画各的弧。
  //   · 指针从底部深色网纹块里伸出来，块里嵌着调零螺丝
  //   · 比表壳宽的底座 + 绿色面板，面板上三个接线柱：
  //       −（黑，最左）、两个量程柱（红，按量程从小到大往右排）
  // 端子坐标见 TERMINALS：锚点落在柱子顶帽下方，导线夹在柱子上，
  // 整台仪器都在导线【上方】，导线不会从表壳或底座中间穿过去。
  // ============================================================

  // 表壳：上沿大圆角、下沿小圆角。全站唯一一处两个圆角不一样的壳子，
  // 所以不走通用的 roundRect。
  function meterCasePath(ctx, hw, top, bot, rt, rb) {
    ctx.beginPath();
    ctx.moveTo(-hw, bot - rb);
    ctx.lineTo(-hw, top + rt);
    ctx.quadraticCurveTo(-hw, top, -hw + rt, top);
    ctx.lineTo(hw - rt, top);
    ctx.quadraticCurveTo(hw, top, hw, top + rt);
    ctx.lineTo(hw, bot - rb);
    ctx.quadraticCurveTo(hw, bot, hw - rb, bot);
    ctx.lineTo(-hw + rb, bot);
    ctx.quadraticCurveTo(-hw, bot, -hw, bot - rb);
    ctx.closePath();
  }

  // 一字槽小螺丝。面板螺丝和调零螺丝共用 —— 调零螺丝必须是「金属螺钉」
  // 的样子：画成深色圆片会和「−」接线柱标记混起来，学生分不清哪个是极性。
  function meterScrew(ctx, x, y, r) {
    ctx.fillStyle = linGrad(ctx, x - r, y - r, x + r, y + r,
      [[0, '#fbfdff'], [0.45, '#b9c6d3'], [1, '#68788c']]);
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.284); ctx.fill();
    ctx.strokeStyle = 'rgba(51,65,85,0.6)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.284); ctx.stroke();
    ctx.strokeStyle = 'rgba(71,85,105,0.85)'; ctx.lineWidth = Math.max(1.2, r * 0.3);
    ctx.beginPath();
    ctx.moveTo(x - r * 0.62, y + r * 0.18);
    ctx.lineTo(x + r * 0.62, y - r * 0.18);
    ctx.stroke();
  }

  function drawMeter(ctx, comp, rec, isVolt) {
    var M = MET, SW = MET_SWEEP;
    var reading = rec ? (rec.reading || 0) : 0;
    var range = (rec && rec.range) || (comp.params && comp.params.range) || (isVolt ? 3 : 0.6);
    // 反接：接线柱正负接反，电流从「−」柱流进，指针往【左】打。取 rec.reading 的
    // 符号而不是 rec.reversed——离屏工具（dev-crop 之类）手搓的 rec 里没有那个字段。
    var rev = reading < -1e-9;
    var over = !!(rec && rec.overRange);
    var POSTX = [TERMINALS[comp.type][0].x, TERMINALS[comp.type][1].x, TERMINALS[comp.type][2].x];
    // 两排刻度各自的满量程：外圈大、内圈小，比值恒为 5
    var HI_V = isVolt ? 15 : 3, LO_V = isVolt ? 3 : 0.6;
    var HI_TX = isVolt ? ['0', '5', '10', '15'] : ['0', '1', '2', '3'];
    var LO_TX = isVolt ? ['0', '1', '2', '3'] : ['0', '0.2', '0.4', '0.6'];
    var POST_TX = isVolt ? ['3', '15'] : ['0.6', '3'];
    // 当前量程是哪一排：真表上两排数字都印着，看错排就读错数，
    // 所以把【当前有效】的那排画深、另一排画浅，指针读数才对得上号。
    var hiActive = range >= HI_V - 1e-9;

    ctx.save();
    ctx.translate(comp.x, comp.y);
    ctx.rotate((comp.rot || 0) * Math.PI / 180);

    // ── 表壳 ────────────────────────────────────────────────
    softShadow(ctx, -M.CASE_HW, M.CASE_TOP, M.CASE_HW * 2, M.CASE_BOT - M.CASE_TOP, 18, 16);
    ctx.fillStyle = linGrad(ctx, -M.CASE_HW, M.CASE_TOP, M.CASE_HW * 0.5, M.CASE_BOT,
      [[0, '#fdfefe'], [0.40, '#e9eff6'], [1, '#c4d0de']]);
    meterCasePath(ctx, M.CASE_HW, M.CASE_TOP, M.CASE_BOT, 24, 7);
    ctx.fill();
    ctx.strokeStyle = 'rgba(51,65,85,0.55)'; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.1;
    meterCasePath(ctx, M.CASE_HW - 3.5, M.CASE_TOP + 3.5, M.CASE_BOT - 3.5, 21, 5);
    ctx.stroke();

    // 面板螺丝（左右各一颗，压在表壳圆角内侧、表盘上方）
    meterScrew(ctx, -M.CASE_HW + 14, M.CASE_TOP + 8, 5.5);
    meterScrew(ctx, M.CASE_HW - 14, M.CASE_TOP + 8, 5.5);

    // ── 白色表盘 ────────────────────────────────────────────
    ctx.fillStyle = linGrad(ctx, 0, M.DIAL.y, 0, M.DIAL.y + M.DIAL.h,
      [[0, '#ffffff'], [0.72, '#f8fbfd'], [1, '#eaf0f6']]);
    roundRect(ctx, M.DIAL.x, M.DIAL.y, M.DIAL.w, M.DIAL.h, 14);
    ctx.fill();
    ctx.strokeStyle = 'rgba(100,116,139,0.45)'; ctx.lineWidth = 1; ctx.stroke();

    // ── 刻度弧 ──────────────────────────────────────────────
    // 三档线长，和真表一致：
    //   大格（带数字）3 段 × 每段 10 小格 —— 0.6A 量程一大格 0.2A、小格 0.02A；
    //   3A 量程共用同一条弧，一大格 1A、小格 0.1A（两排数字正好落在同一批长线上）。
    //   大格【中点】的线短一截（8/12），其余小格再短（5/12）——
    //   上一版把中点也画成大格那么长，一条弧上就多出三根没有数字的长线，
    //   看着像刻度印漏了，读数时也分不清哪根才是大格。
    var MAJOR = 3, MINOR = 10, total = MAJOR * MINOR, i;
    for (i = 0; i <= total; i++) {
      var a = SW.A0 + (SW.A1 - SW.A0) * (i / total);
      var step = i % MINOR;                       // 0 = 带数字的大格
      var isMajor = (step === 0), isHalf = (step === MINOR / 2);
      var r1 = M.RT1, r0 = M.RT1 - (isMajor ? 12 : (isHalf ? 8 : 5));
      ctx.strokeStyle = isMajor ? '#1f2937' : '#94a3b8';
      ctx.lineWidth = isMajor ? 1.8 : (isHalf ? 1.2 : 0.9);
      ctx.beginPath();
      ctx.moveTo(M.PIVOT.x + Math.cos(a) * r0, M.PIVOT.y + Math.sin(a) * r0);
      ctx.lineTo(M.PIVOT.x + Math.cos(a) * r1, M.PIVOT.y + Math.sin(a) * r1);
      ctx.stroke();
    }

    // ── 两排数字 ────────────────────────────────────────────
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    [['hi', M.RN_HI, HI_TX, 12, 3],
     ['lo', M.RN_LO, LO_TX, 10.5, 2]].forEach(function (row) {
      var on = (row[0] === 'hi') ? hiActive : !hiActive;
      ctx.fillStyle = on ? '#1f2937' : '#b9c3cf';
      ctx.font = (on ? 'bold ' : '') + row[3] + 'px -apple-system,"PingFang SC",sans-serif';
      for (var k = 0; k < row[2].length; k++) {
        var ang = SW.A0 + (SW.A1 - SW.A0) * (k / (row[2].length - 1));
        ctx.fillText(row[2][k],
          M.PIVOT.x + Math.cos(ang) * row[1],
          M.PIVOT.y + Math.sin(ang) * row[1]);
      }
    });

    // 表盘正中的大字母
    ctx.fillStyle = '#1f2937';
    ctx.font = 'bold 19px -apple-system,"PingFang SC",sans-serif';
    ctx.fillText(isVolt ? 'V' : 'A', 0, M.PIVOT.y - 16);

    // ── 底部网纹块 + 调零螺丝 ───────────────────────────────
    // 教材上指针的转轴就藏在这块深色网纹里。块先画，指针后画压在上面。
    var B = M.BLOCK;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(-B.hwT, B.top); ctx.lineTo(B.hwT, B.top);
    ctx.lineTo(B.hwB, B.bot); ctx.lineTo(-B.hwB, B.bot);
    ctx.closePath();
    ctx.fillStyle = linGrad(ctx, 0, B.top, 0, B.bot, [[0, '#4b5563'], [1, '#1f2937']]);
    ctx.fill();
    ctx.clip();
    ctx.strokeStyle = 'rgba(226,232,240,0.30)'; ctx.lineWidth = 1;
    for (var hx = -70; hx < 70; hx += 5) {
      ctx.beginPath();
      ctx.moveTo(hx, B.bot + 2);
      ctx.lineTo(hx + (B.bot - B.top) + 4, B.top - 2);
      ctx.stroke();
    }
    ctx.restore();
    meterScrew(ctx, M.ZERO.x, M.ZERO.y, M.ZERO.r);

    // ── 指针 ────────────────────────────────────────────────
    // 偏转量按【当前量程】算：同一个 0.3A，接 0.6 柱指半偏、接 3 柱指 10% 处。
    var mag = Math.min(Math.abs(reading) / (range || 1), 1.06);
    // 反接时**不按比例往左画**：真表的指针这时候会一直顶到左边的限位钉上，
    // 电流再大也停在零刻度左边那一点点——那个位置根本没有刻度，所以「读不出数」。
    // 按比例镜像（−0.3A 画成 0.3A 的镜像）会落在弧上、指着 0.3 那条线，
    // 看着像是能读的，正好把这个知识点教反了。
    var frac = rev ? -0.085 : mag;
    var na = SW.A0 + (SW.A1 - SW.A0) * frac;
    var alert = over || rev;                       // 超量程 / 反接都用红针
    ctx.save();
    ctx.translate(M.PIVOT.x, M.PIVOT.y);
    ctx.rotate(na);
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(15,23,42,0.18)'; ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.moveTo(-8, 1.6); ctx.lineTo(M.RT1 - 14, 1.6); ctx.stroke();
    ctx.strokeStyle = alert ? '#b91c1c' : '#111827'; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(M.RT1 - 14, 0); ctx.stroke();
    ctx.fillStyle = alert ? '#b91c1c' : '#111827';
    ctx.beginPath();
    ctx.moveTo(M.RT0 + 2, 0);
    ctx.lineTo(M.RT0 - 6, -2.8);
    ctx.lineTo(M.RT0 - 6, 2.8);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    // 转轴轴心
    ctx.fillStyle = linGrad(ctx, -5, M.PIVOT.y, 5, M.PIVOT.y,
      [[0, '#5b6c7d'], [0.5, '#eef3f8'], [1, '#5b6c7d']]);
    ctx.beginPath(); ctx.arc(M.PIVOT.x, M.PIVOT.y, 4.6, 0, 6.284); ctx.fill();
    ctx.strokeStyle = 'rgba(15,23,42,0.45)'; ctx.lineWidth = 1; ctx.stroke();

    // ── 玻璃面罩（画在指针之上，才有「隔着玻璃看」的感觉）────
    ctx.save();
    roundRect(ctx, M.DIAL.x, M.DIAL.y, M.DIAL.w, M.DIAL.h, 14);
    ctx.clip();
    glassHighlight(ctx, M.DIAL.x, M.DIAL.y, M.DIAL.w, M.DIAL.h);
    ctx.restore();

    // ── 底座 + 绿色面板 ─────────────────────────────────────
    var BT = M.BASE_TOP, BB = M.BASE_BOT;
    softShadow(ctx, -M.BASE_HW, BT - 3, M.BASE_HW * 2, BB - BT + 8, 12, 8);
    ctx.fillStyle = linGrad(ctx, 0, BT, 0, BB, [[0, '#d9e2ec'], [0.55, '#c2cedb'], [1, '#98a8b9']]);
    roundRect(ctx, -M.BASE_HW, BT, M.BASE_HW * 2, BB - BT, 6); ctx.fill();
    ctx.strokeStyle = 'rgba(51,65,85,0.45)'; ctx.lineWidth = 1.2; ctx.stroke();
    // 上表面（画成梯形，近大远小），白色字印在上面
    ctx.beginPath();
    ctx.moveTo(-M.BASE_HW + 4, BT + 3);
    ctx.lineTo(M.BASE_HW - 4, BT + 3);
    ctx.lineTo(M.BASE_HW - 13, BT + 15);
    ctx.lineTo(-M.BASE_HW + 13, BT + 15);
    ctx.closePath();
    ctx.fillStyle = linGrad(ctx, 0, BT + 3, 0, BT + 15, [[0, '#2f8f5b'], [1, '#196240']]);
    ctx.fill();
    ctx.strokeStyle = 'rgba(6,78,59,0.75)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px -apple-system,"PingFang SC",sans-serif';
    ctx.fillText('−', POSTX[0], BT + 9);
    ctx.fillText(POST_TX[0], POSTX[1], BT + 9);
    ctx.fillText(POST_TX[1], POSTX[2], BT + 9);

    // ── 三个接线柱 ──────────────────────────────────────────
    // 必须先把表壳那一套 translate/rotate 还回去：posts() 按【世界坐标】
    // 落柱子，漏掉这个 restore 会把三根柱子整体平移一个元件的位置
    // （画面上就是右下角凭空多出三根柱子，而本体上没有）。
    ctx.restore();
    // kind 按【端子序号】给：0 号是「−」柱（黑），1/2 号是两个量程柱（红）。
    posts(ctx, comp, ['neg', 'pos', 'pos']);
  }


  // ============================================================
  // 滑动变阻器（人教版图16.4-2）
  // ------------------------------------------------------------
  // 和教材图对齐的几处：
  //   · 两侧是两块灰色 A 形金属立板（不是白瓷柱），上端夹住金属杆、下端带脚
  //   · 白瓷管长度按立板间距给满，电阻丝只绕在【中间那一段】——两头留白的
  //     白瓷上拧着 A / B 两个接线柱，这正是「下面两柱接在电阻丝两头」的样子
  //   · 一根细金属杆横跨两板，鞍形滑片骑在杆上，触臂下探到绕线上
  //   · C / D 是金属杆两端的柱子（银），A / B 是瓷管两端的柱子（红）
  // 几何全部走 RHEO：滑片行程、命中框都靠它，一个数字都不能自作主张。
  // ============================================================
  function drawRheostat(ctx, comp, rec) {
    var slide = slideOf(comp, rec);
    var BW = RHEO.BW, BH = RHEO.BH;
    ctx.save();
    ctx.translate(comp.x, comp.y);
    ctx.rotate((comp.rot || 0) * Math.PI / 180);

    var cylX = RHEO.cylX, cylW = RHEO.cylW, cylY = RHEO.cylY, cylH = RHEO.cylH;
    var TUBE_HW = BW / 2 - 1;                  // 瓷管半长：正好顶到两块立板
    var cylMid = cylY + cylH / 2;              // 瓷管中心线
    // 「已接入」= 真正有电流的那一段，直接从解里读，不靠推断接法。
    // （A-C/A-D 接入左半，B-C/B-D 接入右半，A-B 整根都接入，C-D 两根都不接入
    //   ——画错会直接教错。）提前算出来是因为下面的引线也要跟着它区分明暗。
    var liveL = true, liveR = true;
    if (rec && rec.segments && rec.segments.length >= 2) {
      liveL = Math.abs(rec.segments[0].i) > 1e-12;   // seg0 = A → 滑片（左半段）
      liveR = Math.abs(rec.segments[1].i) > 1e-12;   // seg1 = 滑片 → B（右半段）
    }

    // ── ① 两侧 A 形立板 ────────────────────────────────────
    // 立板是【一块薄板】不是一根柱子：图16.4-2 里这两块板上下几乎一样宽，
    // 只在底部往外撇出一小块脚。早先画成上窄下宽的三角形（顶 11 宽、脚 30 宽），
    // 配上白亮的渐变就成了两棵白色圣诞树，把中间那根瓷管压得看不见。
    // 颜色也压深一档（浅蓝灰而不是白），好和白瓷管分开——两者同为「白」的话，
    // 一眼看不出哪一截是瓷管、哪一块是板。
    var BRK_TOP = -26, LEG = 37;
    [-BW / 2, BW / 2].forEach(function (cx) {
      ctx.save();
      ctx.shadowColor = 'rgba(15,23,42,0.22)'; ctx.shadowBlur = 11; ctx.shadowOffsetY = 4;
      // 宽度照实物按瓷管长折算：图16.4-2 里立板只占瓷管的 6% 宽，一窄条。
      // 早先给到 30 宽（19%），两块板把瓷管两头挡掉一大截，「管子」就不成形了。
      ctx.beginPath();
      ctx.moveTo(cx - 7.5, BRK_TOP - 4);
      ctx.quadraticCurveTo(cx, BRK_TOP - 12, cx + 7.5, BRK_TOP - 4);   // 圆顶
      ctx.lineTo(cx + 10, LEG);
      ctx.lineTo(cx - 10, LEG);
      ctx.closePath();
      ctx.fillStyle = linGrad(ctx, cx - 10, 0, cx + 10, 0,
        [[0, '#8d9cae'], [0.22, '#c2cfe0'], [0.46, '#e9eff7'],
         [0.72, '#a9b8ca'], [1, '#8493a6']]);
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(100,116,139,0.55)'; ctx.lineWidth = 1; ctx.stroke();
      // 腿脚：落地的那一小块。没有它，立板看着是插在空气里的
      ctx.fillStyle = linGrad(ctx, cx - 14, 0, cx + 14, 0,
        [[0, '#78879a'], [0.35, '#b9c6d4'], [0.72, '#9dabbc'], [1, '#78879a']]);
      roundRect(ctx, cx - 14, LEG, 28, 7, 3); ctx.fill();
      ctx.strokeStyle = 'rgba(90,105,124,0.5)'; ctx.lineWidth = 1; ctx.stroke();
      // 顶部夹口：金属杆就卡在这个小槽里
      ctx.fillStyle = 'rgba(70,84,100,0.5)';
      roundRect(ctx, cx - 5, BRK_TOP - 2, 10, 4.5, 2.2); ctx.fill();
    });

    // ── ② 金属杆：细长的一根，横跨两块立板的夹口。高度取 −26 是为了和
    //    C/D 两个柱子（锚在 ±78/−26）对齐——「上面两个柱接的是金属杆」这句话
    //    在图上是靠这条线看出来的。滑片骑在它上面，中间被滑片挡住，两头露出来。
    ctx.fillStyle = linGrad(ctx, 0, -29, 0, -23,
      [[0, '#ffffff'], [0.35, '#eef3f8'], [0.75, '#b9c6d3'], [1, '#8b98a7']]);
    roundRect(ctx, -BW / 2 + 4, -29, BW - 8, 6, 3); ctx.fill();
    ctx.strokeStyle = 'rgba(100,116,139,0.45)'; ctx.lineWidth = 0.9; ctx.stroke();

    // ── ③ 白瓷管：整根画满两板之间，两头留白
    ctx.save();
    ctx.shadowColor = 'rgba(15,23,42,0.18)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
    ctx.fillStyle = linGrad(ctx, 0, cylY, 0, cylY + cylH,
      [[0, '#ffffff'], [0.20, '#f2f6fa'], [0.55, '#dde5ee'], [1, '#aab6c4']]);
    roundRect(ctx, -TUBE_HW, cylY, TUBE_HW * 2, cylH, cylH / 2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';          // 白瓷上的那一道高光
    roundRect(ctx, -TUBE_HW + 2, cylY + 2.5, TUBE_HW * 2 - 4, 4, 2); ctx.fill();
    ctx.strokeStyle = 'rgba(120,134,150,0.45)'; ctx.lineWidth = 1;
    roundRect(ctx, -TUBE_HW, cylY, TUBE_HW * 2, cylH, cylH / 2); ctx.stroke();

    // ── ④ 电阻丝：密绕在中间那一段上，两端各留一截白瓷
    ctx.save();
    roundRect(ctx, -TUBE_HW, cylY, TUBE_HW * 2, cylH, cylH / 2); ctx.clip();
    var segs = 60, step = cylW / segs;
    for (var i = 0; i < segs; i++) {
      var isLeft = (i / (segs - 1)) <= slide;
      // 有电流的那半根是亮的铜色，没电流的压成灰——「滑片把电阻丝分成两段，
      // 只有接进回路的那一段起作用」这句话就是靠这一明一暗讲清楚的。
      ctx.fillStyle = (isLeft ? liveL : liveR) ? '#b8722f' : 'rgba(150,144,134,0.42)';
      ctx.fillRect(cylX + i * step + step * 0.16, cylY + 0.5, step * 0.68, cylH - 1);
    }
    ctx.fillStyle = 'rgba(255,236,196,0.30)';          // 铜丝整体的受光
    ctx.fillRect(cylX, cylY + 2.5, cylW, 5);
    ctx.fillStyle = 'rgba(74,44,14,0.20)';             // 下沿背光，把圆管压出来
    ctx.fillRect(cylX, cylY + cylH - 6, cylW, 5);
    ctx.restore();
    // 绕线两端的收口细线：电阻丝到这里就没了（后面是白瓷，A/B 柱拧在这儿）
    ctx.strokeStyle = 'rgba(74,44,14,0.55)'; ctx.lineWidth = 1.2;
    [cylX, cylX + cylW].forEach(function (x2) {
      ctx.beginPath(); ctx.moveTo(x2, cylY + 1); ctx.lineTo(x2, cylY + cylH - 1); ctx.stroke();
    });

    // ── ⑤ 滑片：鞍形金属块骑在金属杆上，触臂下探到绕线上
    var sx = sliderLocalX(slide);
    var slidTop = RHEO.knobTop, slidH = RHEO.knobBottom - RHEO.knobTop;
    var tipY = cylY + cylH * 0.62;             // 触臂端头落在绕线中间偏上
    var KH = RHEO.knobHalf;
    // 触臂：上宽下窄的一片，先画（被滑片本体压住上缘）
    ctx.save();
    ctx.shadowColor = 'rgba(15,23,42,0.28)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
    ctx.beginPath();
    ctx.moveTo(sx - KH * 0.62, RHEO.knobBottom - 4);
    ctx.lineTo(sx + KH * 0.62, RHEO.knobBottom - 4);
    ctx.lineTo(sx + 5.5, tipY);
    ctx.lineTo(sx - 5.5, tipY);
    ctx.closePath();
    ctx.fillStyle = linGrad(ctx, sx - 9, 0, sx + 9, 0,
      [[0, '#7d8b99'], [0.32, '#dbe3eb'], [0.55, '#ffffff'], [1, '#8b98a7']]);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(100,116,139,0.5)'; ctx.lineWidth = 0.9; ctx.stroke();
    ctx.fillStyle = '#6b7c90';                 // 压在绕线上的那一小块端头
    roundRect(ctx, sx - 6, tipY - 3, 12, 5.5, 2.5); ctx.fill();

    // 滑片本体：鞍形（顶面微凹）+ 两侧竖槽，照图16.4-2 的 P 字块
    ctx.save();
    ctx.shadowColor = 'rgba(15,23,42,0.30)'; ctx.shadowBlur = 9; ctx.shadowOffsetY = 3;
    ctx.beginPath();
    ctx.moveTo(sx - KH, slidTop + 8);
    ctx.quadraticCurveTo(sx, slidTop + 1, sx + KH, slidTop + 8);
    ctx.lineTo(sx + KH, slidTop + slidH - 6);
    ctx.quadraticCurveTo(sx + KH, slidTop + slidH, sx + KH - 6, slidTop + slidH);
    ctx.lineTo(sx - KH + 6, slidTop + slidH);
    ctx.quadraticCurveTo(sx - KH, slidTop + slidH, sx - KH, slidTop + slidH - 6);
    ctx.closePath();
    ctx.fillStyle = linGrad(ctx, sx - KH, 0, sx + KH, 0,
      [[0, '#7f8d9c'], [0.24, '#ccd6e0'], [0.48, '#f6f9fc'],
       [0.76, '#aab6c4'], [1, '#7f8d9c']]);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(70,84,100,0.5)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.strokeStyle = 'rgba(70,84,100,0.30)'; ctx.lineWidth = 1;   // 两道竖槽
    [-6.5, 6.5].forEach(function (dx) {
      ctx.beginPath();
      ctx.moveTo(sx + dx, slidTop + 10); ctx.lineTo(sx + dx, slidTop + slidH - 7); ctx.stroke();
    });
    ctx.restore();

    // 端子字母：滑动变阻器没有极性，只标 A/B/C/D 四位接线柱
    ctx.save();
    ctx.font = 'bold 15px -apple-system,"PingFang SC",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.lineJoin = 'round';
    // 字母落在接线柱斜外侧（接线柱在 ±78/±26，柱体半径约 17）。
    // 上下不能画反：A/B 是【下面】两个柱（电阻丝两端）、C/D 是【上面】两个柱
    // （金属杆两端）——这是人教版图16.4-2 的编号，也是学生数接线柱的参照系。
    [['A', -101, 44], ['B', 101, 44], ['C', -101, -44], ['D', 101, -44]].forEach(function(L){
      var p = toWorld(comp, L[1], L[2]);
      ctx.strokeText(L[0], p.x, p.y);
      ctx.fillStyle = '#334155';
      ctx.fillText(L[0], p.x, p.y);
    });
    ctx.restore();

    // 柱色按图16.4-2：下面两个（A/B，电阻丝两端）是红的，上面两个（C/D，金属杆）
    // 是银的。变阻器本身没有极性，红在这里只表示「出厂就接在电阻丝上」，
    // 真正的语义靠 A/B/C/D 四个字母，不要把红当成正极。
    // C/D 只有这两个，所以单独画，不走 posts()——原因见下面那段。
    // A/B 给 1.4 倍、8 高的螺纹杆（和开关、灯泡同一档）：图16.4-2 里这两个柱子
    // 是【立在白瓷端头上】的，柱顶要高过瓷管，一眼能看见；按默认的矮柱子画，
    // 它整根都埋在那条红铜引线的粗细里，看着只剩一根横着的铜片。
    posts(ctx, comp, ['pos', 'pos'], 1.4, 8);

    // C / D：金属杆两端的柱子是【横着朝外伸】的圆柱头（图16.4-2 里就是两个
    // 从立板上探出来的银色圆柱）。立着画有两个毛病：一是柱子顶在立板上沿，
    // 看着像板子上又长了一颗蘑菇；二是「它接的是那根细杆」这句话在图上没了着落
    // ——横着从杆的端头伸出去，才一眼看出它和杆是一条线。
    // 顺带一个好处：导线本来就是水平走过来的，横柱让线接头看着更顺。
    [2, 3].forEach(function (ti) {
      var p = terminalWorld(comp, ti);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(ti === 2 ? -1 : 1, 1);        // 镜像成「朝外」，左右各一份
      ctx.fillStyle = 'rgba(15,23,42,0.22)';
      ctx.beginPath(); ctx.ellipse(1, 4, 9, 3, 0, 0, 6.284); ctx.fill();
      // 柱身走【竖向】渐变（上亮下暗）才是根圆管，横向渐变会画成一根扁铁片
      ctx.fillStyle = linGrad(ctx, 0, -6, 0, 6,
        [[0, '#5b6c7d'], [0.32, '#8496a8'], [0.54, '#f2f6fa'], [1, '#5b6c7d']]);
      roundRect(ctx, -9, -6, 18, 12, 3); ctx.fill();
      ctx.strokeStyle = 'rgba(40,52,68,0.45)'; ctx.lineWidth = 0.9; ctx.stroke();
      // 外端那圈滚花螺母（比柱身粗一圈，和别的元件的柱帽是同一套长相）
      ctx.fillStyle = linGrad(ctx, 0, -7.5, 0, 7.5,
        [[0, '#4b5b6c'], [0.32, '#7c8ea1'], [0.54, '#eef3f9'], [1, '#4b5b6c']]);
      roundRect(ctx, 7, -7.5, 8, 15, 2.5); ctx.fill();
      ctx.strokeStyle = 'rgba(40,52,68,0.5)'; ctx.lineWidth = 0.9; ctx.stroke();
      ctx.restore();
    });

    // 电阻丝两端引线：左端接 A（端子 0），右端接 B（端子 1）——就是下面那两个柱。
    // 这两根铜片不能省——「下面两个柱出厂就接在电阻丝两头，上面两个柱才是滑片线」
    // 正是学生最容易搞混的地方，不画出来等于让他自己猜哪根是滑片线。
    //
    // 画在接线柱【之后】：铜片压在柱面上，读起来就是「铜片用螺钉拧在柱子上」。
    // 早先画在柱体之前，18px 的横段被柱子盖掉只剩 12px，加上和背后瓷柱同为银色，
    // 整根引线基本看不见。所以这里三件事一起做：铜色、加暗色描边、盖在柱子上。
    (function () {
      var my = cylY + cylH / 2, py = RHEO.postY, px = RHEO.postX;
      var capMid = (RHEO.track + 1) / 2;
      // 起点写成绝对局部坐标，不要用 sgn 去乘 cylX 那一项：
      // cylX 是 -60，sgn*(-60+5) 会得到 +55，左引线就从右端环出发了——
      // 两根铜片于是连成一根横贯整机的铜条，正好压在电阻丝上。
      var ENDS = [
        { x0: cylX + capMid,          x1: -px, live: liveL },   // 左端环 → A
        { x0: cylX + cylW - capMid,   x1:  px, live: liveR },   // 右端环 → B
      ];
      // 上面那一大段 save/restore 已经结束了，这里回到了画布坐标系，
      // 而下面的坐标全是元件局部坐标——必须自己把变换重新架上，
      // 否则引线会画到画布左上角去（接线柱走的是 terminalWorld，不受影响）。
      ctx.save();
      ctx.translate(comp.x, comp.y);
      ctx.rotate((comp.rot || 0) * Math.PI / 180);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ENDS.forEach(function (e) {
        ctx.globalAlpha = e.live ? 1 : 0.5;   // 没电流的那半根压暗，和电阻丝上的灰段呼应
        var path = function () {
          ctx.beginPath();
          ctx.moveTo(e.x0, my);              // 从端环螺钉出发
          ctx.lineTo(e.x1, my);
          ctx.lineTo(e.x1, py);              // 落到接线柱中心
        };
        // 先描一圈暗铜色当轮廓。没有它的话，铜片压在柱面上会糊成一片高光。
        ctx.strokeStyle = 'rgba(74,44,14,0.85)'; ctx.lineWidth = 7.6;
        path(); ctx.stroke();
        ctx.strokeStyle = linGrad(ctx, 0, my - 6, 0, py + 6,
          [[0, PALETTE.copperHi], [0.5, PALETTE.copper], [1, PALETTE.copperLo]]);
        ctx.lineWidth = 4.6;
        path(); ctx.stroke();
        // 末端的压接螺钉：拧在接线柱上的那一下
        ctx.fillStyle = PALETTE.copperLo;
        ctx.beginPath(); ctx.arc(e.x1, py, 2.6, 0, 6.284); ctx.fill();
        ctx.fillStyle = 'rgba(255,235,205,0.75)';
        ctx.beginPath(); ctx.arc(e.x1 - 0.7, py - 0.7, 1.1, 0, 6.284); ctx.fill();
      });
      ctx.globalAlpha = 1;
      ctx.restore();
    })();
  }

  // ============================================================
  // 统一入口
  // ============================================================
  function drawComponent(ctx, comp, rec) {
    switch (comp.type) {
      case 'resistor': drawResistor(ctx, comp, rec); break;
      case 'battery': drawBattery(ctx, comp, rec); break;
      case 'switch': drawSwitch(ctx, comp, rec); break;
      case 'bulb': drawBulb(ctx, comp, rec); break;
      case 'ammeter': drawMeter(ctx, comp, rec, false); break;
      case 'voltmeter': drawMeter(ctx, comp, rec, true); break;
      case 'rheostat': drawRheostat(ctx, comp, rec); break;
      default: throw new Error('未知元件类型: ' + comp.type);
    }
  }

  function drawBackground(ctx, W, H) {
    ctx.fillStyle = PALETTE.bench;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = PALETTE.grid; ctx.lineWidth = 1;
    var G = 40;
    ctx.beginPath();
    for (var x = G; x < W; x += G) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); }
    for (var y = G; y < H; y += G) { ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); }
    ctx.stroke();
  }

  return {
    PALETTE: PALETTE, HALF: HALF, TERMINALS: TERMINALS,
    terminalWorld: terminalWorld, toWorld: toWorld, toLocal: toLocal,
    RHEO: RHEO, PLATE: PLATE,
    sliderLocalX: sliderLocalX, slideFromLocalX: slideFromLocalX,
    slideOf: slideOf,
    drawComponent: drawComponent, drawWire: drawWire, electronShift: electronShift,
    currentShift: currentShift,
    FLOW_PX_PER_PHASE: FLOW_PX_PER_PHASE, polyLen: polyLen, pointAt: pointAt, pointDirAt: pointDirAt,
    drawBackground: drawBackground, drawBindingPost: drawBindingPost,
    resistorBands: resistorBands, roundRect: roundRect, softShadow: softShadow,
    batterySize: batterySize, bodyBox: bodyBox,
    version: '1.2.0',
  };
});
