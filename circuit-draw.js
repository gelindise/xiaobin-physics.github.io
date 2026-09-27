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
 *   circuit-core 里 battery / ammeter / voltmeter 的端子 0 都是「+」。
 *   端子 0 画在哪一头，由 TERMINALS 拍板，并且全站统一：
 *     · 横向元件（电源、电流表）：端子 0 在【右端】
 *     · 纵向元件（电压表）：      端子 0 在【上端】
 *   为什么电源和电流表都得是右边：一个矩形回路里，电源正极的线往右出去，
 *   电流绕一圈回来必然从右边进、左边出地穿过顶排的元件。把「+」画在右边，
 *   红柱子才是电流【流进去】的那一头；画反了红柱子就成了电流流出的一端。
 *   三处必须同时对上，任何一处画反画面都会自相矛盾：
 *     1. TERMINALS 的坐标
 *     2. 元件的正负记号（drawBattery 的加减号 / drawMeter 的 mk 圆圈+符号）
 *     3. posts() 传入的 kinds —— kinds[i] 对应【端子序号】，一律 ['pos','neg']
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
    flow: '#f59e0b',         // 自由电子小球（画布上跑的小球）
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
  // 端子坐标
  // ============================================================
  var TERMINALS = {
    resistor: [{ x: -HALF, y: 0 }, { x: HALF, y: 0 }],
    battery: [{ x: HALF, y: 0 }, { x: -HALF, y: 0 }],   // 0 = 正极（右）
    switch: [{ x: -HALF, y: 0 }, { x: HALF, y: 0 }],
    bulb: [{ x: -HALF, y: 0 }, { x: HALF, y: 0 }],
    ammeter: [{ x: HALF, y: 0 }, { x: -HALF, y: 0 }],   // 0 = 正极（右）
    voltmeter: [{ x: 0, y: -HALF }, { x: 0, y: HALF }], // 0 = 正极（上）
    rheostat: [
      { x: -78, y: -26 }, { x: 78, y: -26 },   // A 左上 / B 右上（金属杆）
      { x: -78, y: 26 }, { x: 78, y: 26 },     // C 左下 / D 右下（电阻丝）
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
    postX: 78, postY: 26,                        // C / D 接线柱的局部坐标
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

  function drawBindingPost(ctx, x, y, kind, scale) {
    if (kind === true) kind = 'pos';
    else if (kind === false) kind = 'neg';
    else if (kind !== 'pos' && kind !== 'neg') kind = 'neutral';
    var s = scale == null ? 1.25 : scale;
    ctx.save();
    ctx.translate(x, y); ctx.scale(s, s);
    ctx.fillStyle = 'rgba(15,23,42,0.22)';
    ctx.beginPath(); ctx.ellipse(1, 3, 8, 3.2, 0, 0, 6.284); ctx.fill();
    ctx.fillStyle = linGrad(ctx, -5, 0, 5, 0, POST_GRAD[kind]);
    roundRect(ctx, -5, -9, 10, 11, 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, -9, 6.2, 2.8, 0, 0, 6.284); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.ellipse(0, -9, 6.2, 2.8, 0, 0, 6.284); ctx.stroke();
    ctx.restore();
  }

  // 两端元件统一收尾：画端子引线 + 接线柱
  function posts(ctx, comp, kinds) {
    for (var i = 0; i < kinds.length; i++) {
      var p = terminalWorld(comp, i);
      drawBindingPost(ctx, p.x, p.y, kinds[i]);
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
  function pointAt(pts, d) {
    for (var i = 1; i < pts.length; i++) {
      var seg = Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y);
      if (d <= seg || i === pts.length - 1) {
        var t = seg > 0 ? Math.min(d / seg, 1) : 0;
        return { x: pts[i-1].x + (pts[i].x - pts[i-1].x) * t,
                 y: pts[i-1].y + (pts[i].y - pts[i-1].y) * t };
      }
      d -= seg;
    }
    return pts[pts.length - 1];
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

  // opts: { flow: 有符号电流(A, 正=从首端流向末端), phase: 秒, flowing: bool }
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
    var I = Math.abs(opts.flow || 0);
    if (I > 1e-6 && opts.phase != null) {
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
      case 'switch': return { hw: 59, hh: 28 };          // drawSwitch 的 BW/BH
      case 'bulb': return { hw: 38, hh: 38 };            // 玻璃泡 R=34 再放宽一点
      case 'ammeter': case 'voltmeter': return { hw: 58, hh: 58 };  // drawMeter 的 R=54
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

    // 电池盒：一个横躺的塑料盒，干电池横着码在里面。
    // 之所以不做成「竖直圆柱并列」：接线柱在左右两端，电池轴就该是水平的，
    // 竖着画的圆柱和水平引出的导线会互相打架。
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

    // 盒体投影
    ctx.save();
    ctx.shadowColor = 'rgba(15,23,42,0.26)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 5;
    ctx.fillStyle = '#2b3543';
    roundRect(ctx, -boxW / 2, -boxH / 2, boxW, boxH, 11); ctx.fill();
    ctx.restore();

    // 盒体外壳：纵向渐变，顶面受光、底面背光
    ctx.fillStyle = linGrad(ctx, 0, -boxH / 2, 0, boxH / 2, [
      [0, '#6c7d93'], [0.12, PALETTE.plastic], [0.42, '#3b4757'],
      [0.78, PALETTE.plasticLo], [1, '#1c242e'],
    ]);
    roundRect(ctx, -boxW / 2, -boxH / 2, boxW, boxH, 11); ctx.fill();
    // 壳顶高光棱（塑料反光）
    ctx.fillStyle = 'rgba(255,255,255,0.30)';
    roundRect(ctx, -boxW / 2 + 7, -boxH / 2 + 3, boxW - 14, 4, 2); ctx.fill();

    // 内腔（电池嵌进去，四周留一圈暗缝）
    var cavX = -totalW / 2 - 2, cavY = -CHD / 2 - 2;
    var cavW = totalW + 4, cavH = CHD + 4;
    ctx.fillStyle = '#161d26';
    roundRect(ctx, cavX, cavY, cavW, cavH, 7); ctx.fill();

    ctx.save();
    roundRect(ctx, cavX, cavY, cavW, cavH, 7); ctx.clip();
    for (var i = 0; i < cells; i++) {
      var cx = -totalW / 2 + i * CWD;
      // 横躺圆柱：纵向渐变（上暗-上高光-中亮-下暗）才是圆柱的光照
      ctx.fillStyle = linGrad(ctx, 0, -CHD / 2, 0, CHD / 2, [
        [0, '#141414'], [0.10, '#4c4c4c'], [0.22, '#8f8f8f'],
        [0.32, '#d8d8d8'], [0.44, '#a6a6a6'], [0.60, '#5e5e5e'],
        [0.84, '#303030'], [1, '#111111'],
      ]);
      roundRect(ctx, cx, -CHD / 2, CWD, CHD, Math.min(CWD, CHD) * 0.14); ctx.fill();

      // 锐利高光条（圆柱反光）
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      roundRect(ctx, cx + CWD * 0.111, -CHD * 0.30, CWD * 0.778, CHD * 0.081, CHD * 0.04); ctx.fill();

      // 中部标贴环带：印 1.5V。尺寸都跟着 CHD 走——节数一多整节会缩小，
      // 写死的 20/3/13 会从电池上溢出来。
      var bandTop = -CHD * 0.238, bandH = CHD * 0.476;
      ctx.fillStyle = i % 2 ? '#b91c1c' : '#1d4ed8';
      ctx.fillRect(cx, bandTop, CWD, bandH);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(cx, bandTop, CWD, CHD * 0.071);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(cx, bandTop + bandH - CHD * 0.071, CWD, CHD * 0.071);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold ' + Math.max(8, Math.round(13 * k)) + 'px -apple-system,"PingFang SC",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(perCell.toFixed(1).replace(/\.0$/, '') + 'V', cx + CWD / 2, bandTop + bandH / 2 + 0.5);

      // 节与节之间的接缝
      if (i) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(cx - 1.2, -CHD / 2, 2.4, CHD);
      }
    }
    ctx.restore();

    // 内腔口沿：一圈内阴影，让电池看起来是嵌进去的
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 2;
    roundRect(ctx, cavX, cavY, cavW, cavH, 7); ctx.stroke();

    // 盒体上沿再压一道亮边，强化塑料盒的厚度感
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1.4;
    roundRect(ctx, -boxW / 2 + 0.7, -boxH / 2 + 0.7, boxW - 1.4, boxH - 1.4, 10.5); ctx.stroke();

    // 极性记号：直接印在盒体上沿的塑料面上，和真电池盒一样。
    // 画成实心图形而不是文字字形——「−」用字形画出来是一根细线，
    // 摆在导线旁边会被误读成杂散线头。
    // 右端为正（和 TERMINALS 里端子 0 落在 +HALF 一致），这是不可动摇的极性。
    // 往内收 22 而不是 14：14 的话减号正好压在盒体的圆角上，被切掉一截，
    // 看上去像盒子上破了个口子而不是一个记号。
    var markY = -boxH / 2 + 10, markX = boxW / 2 - 22;
    ctx.fillStyle = PALETTE.positive;
    roundRect(ctx, markX - 6.5, markY - 2.2, 13, 4.4, 2.2); ctx.fill();    // 加号横
    roundRect(ctx, markX - 2.2, markY - 6.5, 4.4, 13, 2.2); ctx.fill();    // 加号竖
    // 减号：壳顶那条塑料棱是深灰的，所以记号必须用浅色。加号是红的一点就亮，
    // 减号只有靠「白条 + 深色垫底」才压得住，做成跟加号同样的视觉重量——
    // 两个记号一轻一重，学生眼睛只会看见加号，负极就形同没标。
    ctx.fillStyle = 'rgba(15,23,42,0.5)';                                  // 深色垫底，把白条从塑料棱上托起来
    roundRect(ctx, -markX - 8.4, markY - 3.4, 16.8, 6.8, 3.4); ctx.fill();
    ctx.fillStyle = '#f8fafc';
    roundRect(ctx, -markX - 7.5, markY - 2.5, 15, 5, 2.5); ctx.fill();     // 减号
    ctx.restore();

    // 端子 0 = 正极，在 TERMINALS 里落在 +HALF（右侧），所以这里仍是 ['pos','neg']：
    // kinds[i] 对应的是【端子序号】，不是左右顺序，改了 TERMINALS 就不用动这里。
    posts(ctx, comp, ['pos', 'neg']);
  }

  // ============================================================
  // 闸刀开关
  // ============================================================
  function drawSwitch(ctx, comp, rec) {
    var closed = rec ? rec.closed : !!(comp.params && comp.params.closed);
    var BW = 118, BH = 56;
    ctx.save();
    ctx.translate(comp.x, comp.y);
    ctx.rotate((comp.rot || 0) * Math.PI / 180);

    ctx.strokeStyle = PALETTE.metalLo; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-HALF, 0); ctx.lineTo(-BW / 2 + 8, 0);
    ctx.moveTo(BW / 2 - 8, 0); ctx.lineTo(HALF, 0);
    ctx.stroke();

    // 胶木底座
    softShadow(ctx, -BW / 2, -BH / 2 + 8, BW, BH - 4, 12, 9);
    ctx.fillStyle = linGrad(ctx, 0, -BH / 2 + 8, 0, BH / 2 + 4,
      [[0, PALETTE.bakeliteHi], [0.42, PALETTE.bakelite], [1, PALETTE.bakeliteLo]]);
    roundRect(ctx, -BW / 2, -BH / 2 + 8, BW, BH - 4, 9); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-BW/2 + 7, -BH/2 + 11); ctx.lineTo(BW/2 - 7, -BH/2 + 11); ctx.stroke();
    // 四角螺丝
    [[-BW/2+9, -BH/2+15], [BW/2-9, -BH/2+15], [-BW/2+9, BH/2+1], [BW/2-9, BH/2+1]].forEach(function(s){
      ctx.fillStyle = PALETTE.metalLo;
      ctx.beginPath(); ctx.arc(s[0], s[1], 3, 0, 6.284); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.moveTo(s[0]-2, s[1]); ctx.lineTo(s[0]+2, s[1]); ctx.stroke();
    });

    // 两个铜触点
    [[-40, -8], [40, -8]].forEach(function(p, idx){
      ctx.fillStyle = linGrad(ctx, p[0]-7, 0, p[0]+7, 0,
        [[0, PALETTE.copperLo], [0.35, PALETTE.copper], [0.6, PALETTE.copperHi], [1, PALETTE.copperLo]]);
      roundRect(ctx, p[0]-7, p[1]-6, 14, 15, 3); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 0.9; ctx.stroke();
      ctx.fillStyle = 'rgba(0,0,0,0.32)';
      ctx.beginPath(); ctx.arc(p[0], p[1]+2, 2.6, 0, 6.284); ctx.fill();
    });

    // 刀片（绕左触点转动）
    ctx.save();
    ctx.translate(-40, -8);
    ctx.rotate(closed ? -0.05 : -0.55);
    ctx.fillStyle = linGrad(ctx, 0, -5, 0, 6,
      [[0, '#ffffff'], [0.3, PALETTE.metalHi], [0.7, PALETTE.metal], [1, PALETTE.metalDark]]);
    roundRect(ctx, -3, -5, 88, 10, 4); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.32)'; ctx.lineWidth = 0.9; ctx.stroke();
    // 绝缘手柄
    ctx.fillStyle = linGrad(ctx, 0, -8, 0, 8,
      [[0, '#fca5a5'], [0.4, '#dc2626'], [1, '#991b1b']]);
    roundRect(ctx, 83, -8, 22, 16, 6); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    roundRect(ctx, 86, -5, 16, 4, 2); ctx.fill();
    ctx.restore();

    // 枢轴
    ctx.fillStyle = linGrad(ctx, -47, 0, -33, 0, [[0, '#5b6c7d'], [0.45, '#eef3f8'], [1, '#5b6c7d']]);
    ctx.beginPath(); ctx.arc(-40, -8, 7, 0, 6.284); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.1; ctx.stroke();

    ctx.fillStyle = closed ? '#15803d' : PALETTE.textDim;
    ctx.font = 'bold 12px -apple-system,"PingFang SC",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(closed ? '闭合' : '断开', 0, 22);
    ctx.restore();

    posts(ctx, comp, ['neutral', 'neutral']);
  }

  // ============================================================
  // 小灯泡
  // ============================================================
  function drawBulb(ctx, comp, rec) {
    var bright = rec ? Math.max(0, Math.min(rec.brightness || 0, 1.3)) : 0;
    var R = 34;
    ctx.save();
    ctx.translate(comp.x, comp.y);
    ctx.rotate((comp.rot || 0) * Math.PI / 180);

    ctx.strokeStyle = PALETTE.metalLo; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-HALF, 0); ctx.lineTo(-20, 0);
    ctx.moveTo(20, 0); ctx.lineTo(HALF, 0);
    ctx.stroke();

    // 螺纹灯座（居中于端子高度，避免斜引线）
    ctx.save();
    ctx.shadowColor = 'rgba(15,23,42,0.2)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
    ctx.fillStyle = linGrad(ctx, -20, 0, 20, 0,
      [[0, PALETTE.metalDark], [0.25, PALETTE.metal], [0.45, '#ffffff'], [0.8, PALETTE.metal], [1, PALETTE.metalDark]]);
    roundRect(ctx, -20, -10, 40, 34, 4); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = 1;
    for (var i = 0; i < 5; i++) {
      ctx.beginPath(); ctx.moveTo(-19, -4 + i * 6); ctx.lineTo(19, -4 + i * 6); ctx.stroke();
    }
    ctx.fillStyle = linGrad(ctx, 0, 24, 0, 30, [[0, '#5b6c7d'], [1, '#2b3543']]);
    roundRect(ctx, -16, 24, 32, 6, 3); ctx.fill();

    var CY = -34;   // 玻璃泡中心

    // 发光光晕
    if (bright > 0.02) {
      var glow = ctx.createRadialGradient(0, CY, 3, 0, CY, R * 3);
      glow.addColorStop(0, 'rgba(255,242,180,' + (0.9 * bright) + ')');
      glow.addColorStop(0.3, 'rgba(255,214,90,' + (0.45 * bright) + ')');
      glow.addColorStop(1, 'rgba(255,200,60,0)');
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(0, CY, R * 3, 0, 6.284); ctx.fill();
    }

    // 玻璃泡
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

    ctx.save();
    ctx.beginPath(); ctx.arc(0, CY, R, 0, 6.284); ctx.clip();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(-R * 0.7, CY + R); ctx.lineTo(-R * 0.08, CY - R * 1.2);
    ctx.lineTo(R * 0.2, CY - R * 1.2); ctx.lineTo(-R * 0.42, CY + R);
    ctx.closePath(); ctx.fill();
    ctx.restore();

    // 灯丝
    ctx.strokeStyle = bright > 0.15 ? '#fff8d0' : '#8a6a3a';
    ctx.lineWidth = 1.8;
    if (bright > 0.15) { ctx.shadowColor = '#ffd24a'; ctx.shadowBlur = 12 * bright; }
    ctx.beginPath();
    ctx.moveTo(-8, -14); ctx.lineTo(-8, CY + 6);
    for (i = 0; i < 5; i++) ctx.lineTo((i % 2 === 0 ? 6 : -6), CY + 6 - i * 3.4);
    ctx.lineTo(8, CY + 6); ctx.lineTo(8, -14);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();

    posts(ctx, comp, ['neutral', 'neutral']);
  }

  // ============================================================
  // 表头（电流表 / 电压表）
  // ============================================================
  function drawMeter(ctx, comp, rec, isVolt) {
    var R = 54, BOX = R + 8;
    var reading = rec ? (rec.reading || 0) : 0;
    var range = (rec && rec.range) || (comp.params && comp.params.range) || (isVolt ? 3 : 0.6);
    var over = rec && rec.overRange;

    ctx.save();
    ctx.translate(comp.x, comp.y);
    ctx.rotate((comp.rot || 0) * Math.PI / 180);

    softShadow(ctx, -BOX, -BOX, BOX * 2, BOX * 2, 16, 12);
    ctx.fillStyle = linGrad(ctx, -BOX, -BOX, BOX, BOX,
      [[0, PALETTE.plasticHi], [0.42, PALETTE.plastic], [1, PALETTE.plasticLo]]);
    roundRect(ctx, -BOX, -BOX, BOX * 2, BOX * 2, 12); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1.6;
    roundRect(ctx, -BOX + 3, -BOX + 3, BOX * 2 - 6, BOX * 2 - 6, 10); ctx.stroke();

    // 表盘
    ctx.fillStyle = linGrad(ctx, 0, -R, 0, R, [[0, PALETTE.dial], [1, PALETTE.dialLo]]);
    ctx.beginPath(); ctx.arc(0, 0, R, 0, 6.284); ctx.fill();
    ctx.strokeStyle = '#8b9aab'; ctx.lineWidth = 1.2; ctx.stroke();

    var A0 = Math.PI * 0.75, A1 = Math.PI * 2.25;
    var MAJOR = 6, MINOR = 5, total = MAJOR * MINOR;
    for (var i = 0; i <= total; i++) {
      var t = i / total, a = A0 + (A1 - A0) * t;
      var isMajor = i % MINOR === 0;
      var r0 = R - (isMajor ? 14 : 9);
      ctx.strokeStyle = isMajor ? '#334155' : '#a8b6c4';
      ctx.lineWidth = isMajor ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a) * (R - 3), Math.sin(a) * (R - 3));
      ctx.stroke();
    }
    ctx.fillStyle = PALETTE.text;
    ctx.font = 'bold 10px -apple-system,"PingFang SC",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (i = 0; i <= MAJOR; i++) {
      var tt = i / MAJOR, aa = A0 + (A1 - A0) * tt;
      var v = range * tt;
      var label = range <= 0.6 ? v.toFixed(1) : String(Math.round(v));
      var rr = R - 25;
      ctx.fillText(label, Math.cos(aa) * rr, Math.sin(aa) * rr);
    }

    ctx.fillStyle = PALETTE.accent;
    ctx.font = 'bold 15px -apple-system,"PingFang SC",sans-serif';
    ctx.fillText(isVolt ? 'V' : 'A', 0, R * 0.40);
    ctx.fillStyle = '#7c8b9d';
    ctx.font = 'bold 8px -apple-system,"PingFang SC",sans-serif';
    // 量程用「~」不用「-」：短横在表盘上会被误当成负号接线柱
    ctx.fillText('0~' + (range <= 0.6 ? range.toFixed(1) : range) + (isVolt ? 'V' : 'A'), 0, R * 0.60);

    // 指针
    var frac = Math.max(0, Math.min(Math.abs(reading) / range, 1.06));
    var na = A0 + (A1 - A0) * frac;
    ctx.save();
    ctx.rotate(na);
    ctx.strokeStyle = 'rgba(0,0,0,0.16)'; ctx.lineWidth = 3.2;
    ctx.beginPath(); ctx.moveTo(-11, 1.5); ctx.lineTo(R - 11, 1.5); ctx.stroke();
    ctx.strokeStyle = over ? '#b91c1c' : PALETTE.needle;
    ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(-11, 0); ctx.lineTo(R - 11, 0); ctx.stroke();
    ctx.fillStyle = over ? '#b91c1c' : PALETTE.needle;
    ctx.beginPath(); ctx.moveTo(R - 11, 0); ctx.lineTo(R - 17, -2.8); ctx.lineTo(R - 17, 2.8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#8496a8';
    ctx.beginPath(); ctx.arc(-11, 0, 3.4, 0, 6.284); ctx.fill();
    ctx.restore();
    ctx.fillStyle = linGrad(ctx, -5, 0, 5, 0, [[0, '#5b6c7d'], [0.5, '#eef3f8'], [1, '#5b6c7d']]);
    ctx.beginPath(); ctx.arc(0, 0, 5.5, 0, 6.284); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke();

    // 调零螺丝（一字槽）——画成金属小螺钉，别画成深色圆片，
    // 否则它和「−」接线柱标记长得一样，学生分不清哪个是极性。
    var scY = R * 0.84;
    ctx.fillStyle = linGrad(ctx, 0, scY - 5, 0, scY + 5,
      [[0, '#f4f7fa'], [0.45, '#b9c6d3'], [1, '#6c7a8a']]);
    ctx.beginPath(); ctx.arc(0, scY, 5, 0, 6.284); ctx.fill();
    ctx.strokeStyle = 'rgba(51,65,85,0.55)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, scY, 5, 0, 6.284); ctx.stroke();
    ctx.strokeStyle = '#475569'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(-3, scY); ctx.lineTo(3, scY); ctx.stroke();

    // 玻璃面罩
    ctx.save();
    ctx.beginPath(); ctx.arc(0, 0, R, 0, 6.284); ctx.clip();
    glassHighlight(ctx, -R, -R, R * 2, R * 2);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, 6.284); ctx.stroke();

    // 端子引线
    var pos = isVolt ? [[0, -HALF], [0, HALF]] : [[-HALF, 0], [HALF, 0]];
    ctx.strokeStyle = PALETTE.metalLo; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pos[0][0] * (BOX / HALF), pos[0][1] * (BOX / HALF));
    ctx.lineTo(pos[0][0], pos[0][1]);
    ctx.moveTo(pos[1][0] * (BOX / HALF), pos[1][1] * (BOX / HALF));
    ctx.lineTo(pos[1][0], pos[1][1]);
    ctx.stroke();

    // 接线柱的正负标记：极性接反是考点，必须写在表面上。
    // 白底圆 + 加粗符号，压在深色外壳上也看得清。
    // mk[0] 必须压在【端子 0】那一头：横向表在右端，纵向（电压表）在上端。
    var mk = isVolt ? [[-19, -HALF], [-19, HALF]] : [[HALF, -19], [-HALF, -19]];
    var sym = ['+', '−'], col = [PALETTE.positive, PALETTE.negative];
    ctx.font = 'bold 15px -apple-system,"PingFang SC",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (var mi = 0; mi < 2; mi++) {
      ctx.fillStyle = 'rgba(255,255,255,0.94)';
      ctx.beginPath(); ctx.arc(mk[mi][0], mk[mi][1], 9.5, 0, 6.284); ctx.fill();
      ctx.fillStyle = col[mi];
      ctx.fillText(sym[mi], mk[mi][0], mk[mi][1] + 0.5);
    }
    ctx.restore();

    posts(ctx, comp, ['pos', 'neg']);
  }

  // ============================================================
  // 滑动变阻器
  // ============================================================
  function drawRheostat(ctx, comp, rec) {
    var slide = slideOf(comp, rec);
    var BW = RHEO.BW, BH = RHEO.BH;
    ctx.save();
    ctx.translate(comp.x, comp.y);
    ctx.rotate((comp.rot || 0) * Math.PI / 180);

    // 两侧瓷柱
    [-BW / 2, BW / 2].forEach(function(px){
      ctx.save();
      ctx.shadowColor = 'rgba(15,23,42,0.18)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
      ctx.fillStyle = linGrad(ctx, px - 14, 0, px + 14, 0,
        [[0, '#9aa6b2'], [0.22, '#e8eef4'], [0.4, '#ffffff'], [0.68, '#cfd8e0'], [1, '#8d99a5']]);
      roundRect(ctx, px - 14, -BH / 2, 28, BH, 10); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(100,116,139,0.5)'; ctx.lineWidth = 1.1;
      roundRect(ctx, px - 14, -BH / 2, 28, BH, 10); ctx.stroke();
      ctx.fillStyle = 'rgba(100,116,139,0.5)';
      ctx.beginPath(); ctx.arc(px, 0, 3.2, 0, 6.284); ctx.fill();
    });

    // 金属杆
    ctx.fillStyle = linGrad(ctx, 0, -BH/2 + 6, 0, -BH/2 + 20,
      [[0, '#ffffff'], [0.3, '#eef3f8'], [0.7, '#c3ced9'], [1, '#94a3b1']]);
    roundRect(ctx, -BW / 2, -BH / 2 + 6, BW, 14, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(100,116,139,0.5)'; ctx.lineWidth = 1; ctx.stroke();

    // 电阻丝绕线管
    var cylX = RHEO.cylX, cylW = RHEO.cylW, cylY = RHEO.cylY, cylH = RHEO.cylH;
    // 「已接入」= 真正有电流的那一段，直接从解里读，不靠推断接法。
    // （A-C 接法接入左半，A-D 接法接入右半，C-D 接法整根都接入——画错会直接教错。）
    // 提前算出来是因为下面的引线也要跟着它区分明暗。
    var liveL = true, liveR = true;
    if (rec && rec.segments && rec.segments.length >= 2) {
      liveL = Math.abs(rec.segments[0].i) > 1e-12;   // seg0 = C → 滑片
      liveR = Math.abs(rec.segments[1].i) > 1e-12;   // seg1 = 滑片 → D
    }
    ctx.save();
    ctx.shadowColor = 'rgba(15,23,42,0.18)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
    ctx.fillStyle = linGrad(ctx, 0, cylY, 0, cylY + cylH,
      [[0, '#f5ebd4'], [0.3, '#e6d8b8'], [1, '#c2b08e']]);
    roundRect(ctx, cylX, cylY, cylW, cylH, 12); ctx.fill();
    ctx.restore();
    ctx.save();
    roundRect(ctx, cylX, cylY, cylW, cylH, 12); ctx.clip();
    // 「已接入」= 真正有电流的那一段，直接从解里读，不靠推断接法。
    // （A-C 接法接入左半，A-D 接法接入右半，C-D 接法整根都接入——画错会直接教错。）
    var segs = 44, step = cylW / segs;
    for (var i = 0; i < segs; i++) {
      var isLeft = (i / (segs - 1)) <= slide;
      ctx.fillStyle = (isLeft ? liveL : liveR)
        ? 'rgba(198,58,46,0.85)' : 'rgba(150,140,116,0.42)';
      ctx.fillRect(cylX + i * step, cylY + 1, step * 0.66, cylH - 2);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(cylX, cylY + 3, cylW, 6);
    ctx.fillStyle = 'rgba(0,0,0,0.14)';
    ctx.fillRect(cylX, cylY + cylH - 7, cylW, 6);
    ctx.restore();
    ctx.strokeStyle = 'rgba(120,104,78,0.4)'; ctx.lineWidth = 1;
    roundRect(ctx, cylX, cylY, cylW, cylH, 12); ctx.stroke();

    // 端环：箍住电阻丝两头的铜环，引线就是从这里出来的
    [[cylX, liveL], [cylX + cylW - RHEO.track - 1, liveR]].forEach(function (cap) {
      ctx.save();
      ctx.globalAlpha = cap[1] ? 1 : 0.5;
      ctx.fillStyle = linGrad(ctx, cap[0], 0, cap[0] + RHEO.track + 1, 0,
        [[0, PALETTE.copperLo], [0.35, PALETTE.copperHi], [0.7, PALETTE.copper], [1, PALETTE.copperLo]]);
      roundRect(ctx, cap[0], cylY - 3, RHEO.track + 1, cylH + 6, 3); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(140,86,36,0.55)'; ctx.lineWidth = 1;
      roundRect(ctx, cap[0], cylY - 3, RHEO.track + 1, cylH + 6, 3); ctx.stroke();
    });
    // 端环上的小螺钉：铜环靠它压住电阻丝，也是「这根丝到头了」的视觉句号
    ctx.fillStyle = 'rgba(60,40,18,0.5)';
    [cylX + (RHEO.track + 1) / 2, cylX + cylW - (RHEO.track + 1) / 2].forEach(function (cx2) {
      ctx.beginPath(); ctx.arc(cx2, cylY + cylH / 2, 1.5, 0, 6.284); ctx.fill();
    });

    // 滑块：坐在金属杆上，不要画成一根竖着的烟囱
    var sx = sliderLocalX(slide);
    var slidTop = RHEO.knobTop, slidH = RHEO.knobBottom - RHEO.knobTop;
    ctx.save();
    ctx.shadowColor = 'rgba(15,23,42,0.3)'; ctx.shadowBlur = 9; ctx.shadowOffsetY = 3;
    ctx.fillStyle = linGrad(ctx, sx - 14, 0, sx + 14, 0,
      [[0, '#0f172a'], [0.32, '#3d4a5c'], [0.55, '#6b7c90'], [1, '#0f172a']]);
    roundRect(ctx, sx - 14, slidTop, 28, slidH, 5); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.20)';
    for (i = 0; i < 4; i++) ctx.fillRect(sx - 9, slidTop + 5 + i * 5, 18, 1.8);

    // 触臂（由滑块下压到电阻丝上）
    ctx.fillStyle = linGrad(ctx, sx - 4, 0, sx + 4, 0,
      [[0, '#94a3b1'], [0.4, '#ffffff'], [1, '#7d8b99']]);
    roundRect(ctx, sx - 4.5, slidTop + slidH - 2, 9, cylY + cylH - (slidTop + slidH) + 4, 3);
    ctx.fill();
    ctx.strokeStyle = 'rgba(100,116,139,0.6)'; ctx.lineWidth = 0.9; ctx.stroke();
    ctx.restore();

    // 端子字母：滑动变阻器没有极性，只标 A/B/C/D 四位接线柱
    ctx.save();
    ctx.font = 'bold 15px -apple-system,"PingFang SC",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.lineJoin = 'round';
    // 字母落在接线柱斜外侧（接线柱在 ±78/±26，柱体半径约 17）
    [['A', -101, -44], ['B', 101, -44], ['C', -101, 44], ['D', 101, 44]].forEach(function(L){
      var p = toWorld(comp, L[1], L[2]);
      ctx.strokeText(L[0], p.x, p.y);
      ctx.fillStyle = '#334155';
      ctx.fillText(L[0], p.x, p.y);
    });
    ctx.restore();

    posts(ctx, comp, ['neutral', 'neutral', 'neutral', 'neutral']);

    // 电阻丝两端引线：左端接 C（端子 2），右端接 D（端子 3）。
    // 这两根铜片不能省——「下面两个柱出厂就接在电阻丝两头，滑片那根才要自己接」
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
        { x0: cylX + capMid,          x1: -px, live: liveL },   // 左端环 → C
        { x0: cylX + cylW - capMid,   x1:  px, live: liveR },   // 右端环 → D
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
    RHEO: RHEO, sliderLocalX: sliderLocalX, slideFromLocalX: slideFromLocalX,
    slideOf: slideOf,
    drawComponent: drawComponent, drawWire: drawWire, electronShift: electronShift,
    FLOW_PX_PER_PHASE: FLOW_PX_PER_PHASE, polyLen: polyLen, pointAt: pointAt,
    drawBackground: drawBackground, drawBindingPost: drawBindingPost,
    resistorBands: resistorBands, roundRect: roundRect, softShadow: softShadow,
    batterySize: batterySize, bodyBox: bodyBox,
    version: '1.2.0',
  };
});
