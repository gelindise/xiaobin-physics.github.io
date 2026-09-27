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
 *   circuit-core 里 battery 的端子 0 是「+」，而端子 0 位于局部 (-HALF,0)。
 *   所以铜帽和「+」必须画在【左边】。画反了会出现电流从负极流出的诡异画面。
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
    flow: '#f59e0b',         // 电流粒子
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
    for (var i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
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
    battery: [{ x: -HALF, y: 0 }, { x: HALF, y: 0 }],   // 0 = 正极（左）
    switch: [{ x: -HALF, y: 0 }, { x: HALF, y: 0 }],
    bulb: [{ x: -HALF, y: 0 }, { x: HALF, y: 0 }],
    ammeter: [{ x: -HALF, y: 0 }, { x: HALF, y: 0 }],
    voltmeter: [{ x: 0, y: -HALF }, { x: 0, y: HALF }],
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
  function terminalWorld(comp, i) {
    var t = TERMINALS[comp.type][i];
    return toWorld(comp, t.x, t.y);
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
  // 导线 + 电流粒子
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

  // opts: { flow: 有符号电流(A, 正=从首端流向末端), phase: 0..1, flowing: bool }
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

    // 电流粒子：方向由电压降决定，密度/速度由电流大小决定
    var I = Math.abs(opts.flow || 0);
    if (I > 1e-6 && opts.phase != null) {
      var L = polyLen(pts);
      var spacing = 42;
      var n = Math.max(1, Math.round(L / spacing));
      var dir = (opts.flow || 0) >= 0 ? 1 : -1;
      // 电流越大粒子越快，1A 以上封顶
      var spd = Math.min(1, Math.sqrt(I / 0.8)) * 0.55;
      ctx.save();
      ctx.fillStyle = PALETTE.flow;
      ctx.shadowColor = 'rgba(245,158,11,0.85)';
      ctx.shadowBlur = 7;
      for (var i = 0; i < n; i++) {
        var t = (i / n) - dir * opts.phase * spd;
        t = t - Math.floor(t);
        var p = pointAt(pts, t * L);
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
    var CWD = cells <= 2 ? 54 : 44;      // 单节电池长
    var CHD = 42;                        // 单节电池直径
    var totalW = cells * CWD;
    var PADX = 9, PADY = 15;             // 上下留厚一点，盒体上沿要印正负极记号
    var boxW = totalW + PADX * 2, boxH = CHD + PADY * 2 + 4;
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
      roundRect(ctx, cx, -CHD / 2, CWD, CHD, 6); ctx.fill();

      // 锐利高光条（圆柱反光）
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      roundRect(ctx, cx + 6, -CHD * 0.30, CWD - 12, 3.4, 1.7); ctx.fill();

      // 中部标贴环带：印 1.5V
      var bandTop = -10, bandH = 20;
      ctx.fillStyle = i % 2 ? '#b91c1c' : '#1d4ed8';
      ctx.fillRect(cx, bandTop, CWD, bandH);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(cx, bandTop, CWD, 3);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(cx, bandTop + bandH - 3, CWD, 3);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 13px -apple-system,"PingFang SC",sans-serif';
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
    // 摆在导线旁边会被误读成杂散线头。左端为正，这是不可动摇的极性。
    // 往内收 22 而不是 14：14 的话减号正好压在盒体的圆角上，被切掉一截，
    // 看上去像盒子上破了个口子而不是一个记号。
    var markY = -boxH / 2 + 10, markX = boxW / 2 - 22;
    ctx.fillStyle = PALETTE.positive;
    roundRect(ctx, -markX - 6.5, markY - 2.2, 13, 4.4, 2.2); ctx.fill();   // 加号横
    roundRect(ctx, -markX - 2.2, markY - 6.5, 4.4, 13, 2.2); ctx.fill();   // 加号竖
    // 减号：壳顶那条塑料棱是深灰的，所以记号必须用浅色。加号是红的一点就亮，
    // 减号只有靠「白条 + 深色垫底」才压得住，做成跟加号同样的视觉重量——
    // 两个记号一轻一重，学生眼睛只会看见加号，负极就形同没标。
    ctx.fillStyle = 'rgba(15,23,42,0.5)';                                  // 深色垫底，把白条从塑料棱上托起来
    roundRect(ctx, markX - 8.4, markY - 3.4, 16.8, 6.8, 3.4); ctx.fill();
    ctx.fillStyle = '#f8fafc';
    roundRect(ctx, markX - 7.5, markY - 2.5, 15, 5, 2.5); ctx.fill();      // 减号
    ctx.restore();

    posts(ctx, comp, ['pos', 'neg']);   // 端子 0 = 正极，位于左侧
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
    var mk = isVolt ? [[-19, -HALF], [-19, HALF]] : [[-HALF, -19], [HALF, -19]];
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
    var slide = rec ? rec.slide : ((comp.params && comp.params.slide) || 0.5);
    var BW = 156, BH = 58;
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
    var cylX = -BW / 2 + 18, cylW = BW - 36, cylY = 4, cylH = 26;
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
    var liveL = true, liveR = true;
    if (rec && rec.segments && rec.segments.length >= 2) {
      liveL = Math.abs(rec.segments[0].i) > 1e-12;   // seg0 = C → 滑片
      liveR = Math.abs(rec.segments[1].i) > 1e-12;   // seg1 = 滑片 → D
    }
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

    // 滑块：坐在金属杆上，不要画成一根竖着的烟囱
    var sx = cylX + 9 + (cylW - 18) * slide;
    var slidTop = -BH / 2 - 9, slidH = 26;
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
    terminalWorld: terminalWorld, toWorld: toWorld,
    drawComponent: drawComponent, drawWire: drawWire,
    drawBackground: drawBackground, drawBindingPost: drawBindingPost,
    resistorBands: resistorBands, roundRect: roundRect, softShadow: softShadow,
    version: '1.1.0',
  };
});
