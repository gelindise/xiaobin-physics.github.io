/* ============================================================================
 * 显微镜与望远镜 · 2D 光路实验台
 * ----------------------------------------------------------------------------
 * 世界坐标：毫米（mm）。光轴 = x 轴，光从左向右。
 *   物镜固定在 x = 0，目镜在 x = d（镜筒长度），眼睛在 x = d + eyeGap。
 *
 * 两台仪器的结构完全一样：两片凸透镜一前一后串在镜筒里。
 *   显微镜：f₁ < u₁ < 2f₁ ⇒ 物镜成【倒立放大】实像（相当于投影仪）
 *   望远镜：u₁ > 2f₁（物体很远）⇒ 物镜成【倒立缩小】实像（相当于照相机）
 * 目镜怎么用，只看【物镜成的那个实像落在目镜焦点的哪一侧】：
 *   u₂ < f₂ ⇒ 目镜当放大镜，成放大虚像（两台仪器正常工作时都是这种）
 *   u₂ = f₂ ⇒ 出射平行光，像在无穷远（望远镜的标准调焦）
 *   u₂ > f₂ ⇒ 目镜成实像，落在镜后，眼睛看不到
 *
 * 望远镜的物距取【无穷远】：入射光是平行光（与图一、图二一致），
 * 物镜把平行光会聚在焦平面上，像高由入射光的倾角 α 决定：h₁ = −f₁·tanα。
 * 这样放大倍数正好是 f₁/f₂，不需要任何“有限物距修正”。
 *
 * 像有两条互不引用的路径：
 *   ① 闭式：1/f = 1/u + 1/v 逐片串联
 *   ② 数值：光线在物镜、目镜各按 s′ = s − y/f 偏折一次，出射直线求交
 * 两条路径必须对得上 —— 否则画出来的像只是“贴图”。
 * ==========================================================================*/
(function () {
  'use strict';

  var cv = document.getElementById('opticsCanvas');
  if (!cv) return;
  var ctx = cv.getContext('2d');
  var viewCanvas = document.getElementById('viewCanvas');
  var vctx = viewCanvas ? viewCanvas.getContext('2d') : null;

  /* ---------------------------------------------------------------- 常量 */
  var COL = {
    axis: '#7c94a8',
    object: '#fbbf24',
    rayObj: '#fbbf24',
    rayTube: '#38bdf8',
    rayOut: '#c084fc',
    ext: '#c084fc',
    lensObj: '#38bdf8',
    lensEye: '#a78bfa',
    focus: '#5eead4',
    mid: '#fbbf24',
    final: '#c084fc',
    eye: '#e2e8f0',
    text: '#dbeafe',
    dim: '#8fa9bb'
  };
  var D_NEAR = 250;   // 明视距离 250 mm（目镜倍数的教材口径）

  var MODES = {
    micro: {
      key: 'micro', name: '显微镜', icon: '🔬',
      // hObj 取 2.5 mm：仍属“微小标本”，但箭头的屏幕高度够看清；
      // 视角比 Mview 与物体高度无关（分子分母同乘），只影响画面，不影响倍数。
      f1: 8, f2: 25, uRatio: 1.25, hObj: 2.5, eyeGap: 30,
      f1Range: [4, 14, 0.5], f2Range: [12, 40, 1],
      eyeScale: 0.9, sub: '物镜 = 投影仪　目镜 = 放大镜'
    },
    tele: {
      key: 'tele', name: '望远镜', icon: '🔭',
      f1: 120, f2: 30, alphaDeg: 3.0, eyeGap: 46,
      f1Range: [80, 200, 10], f2Range: [15, 40, 1],
      eyeScale: 0.6, sub: '物镜 = 照相机　目镜 = 放大镜'
    }
  };

  var state = {
    mode: 'micro',
    step: 1,
    showFoci: true,
    showExt: true,
    anim: 1,            // 光线绘制进度 0→1
    drag: null,
    hover: null
  };

  var P = {
    micro: { f1: 8, f2: 25, u1: 10, d: 53.75 },
    tele:  { f1: 120, f2: 30, d: 150 }
  };

  /* -------------------------------------------------------------- 物理内核 */
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

  function imgDist(u, f) {
    var den = u - f;
    if (Math.abs(den) < 1e-9) return Infinity;
    return u * f / den;
  }

  function solve() {
    var M = MODES[state.mode], p = P[state.mode];
    var f1 = p.f1, f2 = p.f2, d = p.d;
    var v1, m1, hMid, hObj, xObj, tanIn, alpha = 0;

    if (state.mode === 'micro') {
      var u1 = p.u1;
      hObj = M.hObj;
      xObj = -u1;
      v1 = imgDist(u1, f1);
      m1 = v1 / u1;
      hMid = -m1 * hObj;
      tanIn = hObj / D_NEAR;                 // 直接看：把物体放在明视距离
    } else {
      alpha = M.alphaDeg * Math.PI / 180;
      tanIn = Math.tan(alpha);
      hObj = 2.2 * f1 * tanIn;               // 只用来画左侧“远处物体”示意图
      xObj = null;
      v1 = f1;                               // 平行光会聚在焦平面
      m1 = NaN;
      hMid = -f1 * tanIn;
    }

    var u2 = d - v1;
    var v2 = imgDist(u2, f2);
    var m2 = Number.isFinite(v2) ? v2 / u2 : Infinity;
    var hFinal = Number.isFinite(v2) ? -m2 * hMid : NaN;
    var xFinal = Number.isFinite(v2) ? d + v2 : null;
    var eyeX = d + M.eyeGap;

    var tanOut = Number.isFinite(v2)
      ? Math.abs(hFinal) / Math.max(1, Math.abs(eyeX - xFinal))
      : Math.abs(hMid) / f2;
    var Mview = tanOut / tanIn;
    var Mprod = state.mode === 'micro' ? Math.abs(m1) * (D_NEAR / f2) : f1 / f2;

    var midToFocus = u2 - f2;
    var tol = Math.max(0.35, 0.012 * f2);
    var midSide = Math.abs(midToFocus) < tol ? 'on' : (midToFocus < 0 ? 'inner' : 'outer');
    var outSide = !Number.isFinite(v2) ? 'parallel' : (v2 < 0 ? 'virtual' : 'real');

    return {
      mode: state.mode, f1: f1, f2: f2, d: d, u1: state.mode === 'micro' ? p.u1 : Infinity,
      xObj: xObj, hObj: hObj, v1: v1, m1: m1, xMid: v1, hMid: hMid,
      u2: u2, v2: v2, m2: m2, hFinal: hFinal, xFinal: xFinal, eyeX: eyeX,
      tanIn: tanIn, tanOut: tanOut, Mview: Mview, Mprod: Mprod,
      midToFocus: midToFocus, midSide: midSide, outSide: outSide, alpha: alpha
    };
  }

  /* ------------------------------------------------------------ 场景取景 */
  var W = 0, H = 0, DPR = 1;
  var map = { s: 1, ox: 0, oy: 0 };
  function SX(x) { return map.ox + x * map.s; }
  function SY(y) { return map.oy - y * map.s; }
  // 窄屏（手机）只保留最关键的几个标签：全画上去必然互压，字号又不能小到看不清
  function isNarrow() { return W < 620; }

  function computeMap(o) {
    var M = MODES[state.mode], p = P[state.mode];
    var xL, xR = o.eyeX + (state.mode === 'micro' ? 26 : 40);

    if (state.mode === 'micro') {
      xL = o.xObj;
      if (Number.isFinite(o.v2)) {
        // 虚像非常远时不给无限左边界，否则整幅图会被压扁
        var limit = o.xObj - 2.4 * (p.d + 30);
        xL = Math.max(Math.min(o.xObj, o.xFinal), limit);
      }
    } else {
      xL = -0.55 * (p.d + M.eyeGap);
    }

    var yTop = 0, yBot = 0;
    function addY(y) { if (Number.isFinite(y)) { yTop = Math.max(yTop, y); yBot = Math.min(yBot, y); } }
    addY(o.hObj); addY(o.hMid); addY(o.hFinal);
    if (state.mode === 'tele') { yTop = Math.max(yTop, Math.abs(o.hMid) * 2.3); yBot = Math.min(yBot, -Math.abs(o.hMid) * 2.3); }
    addY(o.hMid * 1.25);
    var minY = Math.max(3, (xR - xL) * 0.055);
    yTop = Math.max(yTop, minY); yBot = Math.min(yBot, -minY);
    var padY = 0.16 * (yTop - yBot);
    yTop += padY; yBot -= padY;

    // 手机画布只有 ~350 px 宽，左右留 62/104 会把有效绘图区压到一半
    var pad = isNarrow() ? { l: 34, r: 58, t: 36, b: 66 } : { l: 62, r: 104, t: 44, b: 82 };
    var sx = (W - pad.l - pad.r) / Math.max(1, xR - xL);
    var sy = (H - pad.t - pad.b) / Math.max(1, yTop - yBot);
    var s = Math.min(sx, sy);
    var extraX = Math.max(0, (W - pad.l - pad.r) - (xR - xL) * s);
    var extraY = Math.max(0, (H - pad.t - pad.b) - (yTop - yBot) * s);
    map = { s: s, ox: pad.l + extraX / 2 - xL * s, oy: pad.t + extraY / 2 + yTop * s, xL: xL, xR: xR };
  }

  /* -------------------------------------------------------------- 绘制工具 */
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function txt(text, x, y, opt) {
    opt = opt || {};
    var size = opt.size || 12;
    var weight = opt.weight || 700;
    ctx.font = weight + ' ' + size + 'px Inter, "Microsoft YaHei", "Noto Sans SC", sans-serif';
    var w = ctx.measureText(text).width;
    var align = opt.align || 'center';
    var tx = align === 'center' ? x - w / 2 : (align === 'right' ? x - w : x);
    if (opt.bg !== false) {
      ctx.save();
      ctx.globalAlpha = (opt.alpha == null ? 1 : opt.alpha) * 0.82;
      ctx.fillStyle = '#04121e';
      roundRect(tx - 6, y - size * 0.78, w + 12, size * 1.56, 5);
      ctx.fill();
      ctx.restore();
    }
    ctx.save();
    ctx.globalAlpha = opt.alpha == null ? 1 : opt.alpha;
    ctx.fillStyle = opt.color || COL.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, tx, y);
    ctx.restore();
    return w;
  }

  function line(x1, y1, x2, y2, color, width, dash) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width || 1;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  function arrowHead(x, y, dirX, dirY, size, color) {
    var len = Math.hypot(dirX, dirY) || 1;
    var ux = dirX / len, uy = dirY / len;
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - ux * size - uy * size * 0.45, y - uy * size + ux * size * 0.45);
    ctx.lineTo(x - ux * size + uy * size * 0.45, y - uy * size - ux * size * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawVerticalArrow(x, yFrom, yTo, color, width, dashed, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width || 3;
    if (dashed) ctx.setLineDash([7, 6]);
    ctx.beginPath();
    ctx.moveTo(x, yFrom);
    ctx.lineTo(x, yTo);
    ctx.stroke();
    ctx.setLineDash([]);
    arrowHead(x, yTo, 0, yTo - yFrom, Math.max(8, Math.abs(yTo - yFrom) * 0.16), color);
    ctx.restore();
  }

  /* ------------------------------------------------------------- 主绘制 */
  function render() {
    resizeIfNeeded();
    if (!W || !H) return;
    var o = solve();
    computeMap(o);
    var M = MODES[state.mode], p = P[state.mode];

    ctx.clearRect(0, 0, W, H);

    // 背景
    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0a1c2d');
    bg.addColorStop(1, '#061320');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    drawGrid(o);
    drawTube(o);

    var ax = SY(0);
    // 光轴
    line(26, ax, W - 26, ax, 'rgba(124,148,168,.75)', 1, [6, 6]);
    arrowHead(W - 26, ax, 1, 0, 8, 'rgba(124,148,168,.9)');
    txt('光轴', W - 30, ax - 12, { size: 10, color: COL.dim, align: 'right', bg: false });

    if (state.showFoci) drawFoci(o);
    if (state.mode === 'micro') drawObject(o);
    else drawDistantObject(o);

    drawRays(o);
    drawLenses(o);

    // 中间像 / 最终像
    if (state.anim > 0.55 && Math.abs(o.hMid) > 1e-6) {
      var a1 = clamp((state.anim - 0.55) / 0.35, 0, 1);
      drawRealImage(o, a1);
    }
    if (state.anim > 0.9) drawFinalImage(o, clamp((state.anim - 0.9) / 0.1, 0, 1));

    drawEye(o);
    drawBrackets(o);
    drawStepGlow(o);

    drawNote(o);

    drawViews(o);
    updateReadouts(o);
  }

  function drawGrid(o) {
    ctx.save();
    ctx.strokeStyle = 'rgba(56,189,248,.045)';
    ctx.lineWidth = 1;
    for (var x = 0; x < W; x += 56) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (var y = 0; y < H; y += 56) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.restore();
  }

  function drawTube(o) {
    var p = P[state.mode];
    var hl1 = 0.3 * H, hl2 = hl1 * MODES[state.mode].eyeScale;
    var half = Math.min(hl1, hl2) * 0.92;
    var x1 = SX(0), x2 = SX(p.d);
    ctx.save();
    ctx.fillStyle = 'rgba(28,64,92,.32)';
    ctx.strokeStyle = 'rgba(94,234,212,.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(x1, SY(0) - half, x2 - x1, half * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    txt('镜筒', (x1 + x2) / 2, SY(0) - half - 12, { size: 10, color: 'rgba(148,203,220,.75)', bg: false });
  }

  function drawFoci(o) {
    var p = P[state.mode];
    var ax = SY(0);
    var items = [
      { x: -p.f1, label: 'F₁', color: COL.focus, up: false },
      { x: p.f1, label: "F₁′", color: COL.focus, up: true },
      { x: p.d - p.f2, label: 'F₂', color: COL.focus, up: false },
      { x: p.d + p.f2, label: "F₂′", color: COL.focus, up: true }
    ];
    // F₁′ 与 F₂ 在屏幕上挤在一起时只能合并成一个标签（两个字各约 14 px 宽，
    // 相距 6 px 必然压字）。但【合并 ≠ 重合】：旧代码按屏幕距离 < 30 px 就合并，
    // 并直接写“重合（共焦）”—— d=146.8 时 F₁′ 与 F₂ 实际差 3.2 mm，这是在说假话。
    // 是否共焦一律以 solve() 的物理判据 midSide === 'on' 为准。
    var merged = Math.abs(SX(p.f1) - SX(p.d - p.f2)) < 30;
    var cofocal = o.midSide === 'on';
    var gapMm = Math.abs(p.d - p.f2 - p.f1);
    items.forEach(function (it) {
      var px = SX(it.x);
      // 🔴 判据必须是【屏幕坐标】：F₁ 在世界坐标里是负数（物镜左侧），
      //    用 it.x < 0 判断会把它无条件砍掉（实测显微镜图里 F₁ 消失）。
      //    同时不能只看屏幕边界：望远镜的 F₁ 落在取景范围之外，会被画到贴边处，
      //    看起来像“焦点就在画布边缘”，那是错的。
      if (it.x < map.xL + 1e-6 || it.x > map.xR - 1e-6) return;
      if (px < 30 || px > W - 14) return;
      // 窄屏一个焦点文字都不放：画布只有 350 px，F₂ 会压到虚像箭头上；
      // 判据由上面的焦点条和读数卡承担，刻度线保留。
      if (isNarrow()) return;
      if (merged && (it.label === "F₁′" || it.label === 'F₂')) {
        if (it.label !== "F₁′") return;
        line(px, ax - 7, px, ax + 7, COL.focus, 1.6);
        // 合并标签一律放轴上方。望远镜非共焦时这块区域很挤：
        // A₁B₁（ax−42）、F₁′/F₂（ax−20）、A₂B₂（挂在箭头尖端外侧）三层错开，见另两处注释。
        txt(cofocal
          ? 'F₁′ 与 F₂ 重合（共焦）'
          : 'F₁′、F₂（相距 ' + gapMm.toFixed(1) + ' mm）',
          px, ax - 20, { size: 9.5, color: COL.focus });
        return;
      }
      line(px, ax - 7, px, ax + 7, COL.focus, 1.6);
      // 前焦点标在轴下、后焦点标在轴上，错开以免和像标签挤在一条水平线上。
      // F₁ 与标本几乎重合（显微镜只差 2 mm），标签右对齐才能避开物体箭头。
      var fy = isNarrow() ? ax + 34 : ax + 20;
      if (it.label === 'F₁') txt(it.label, px - 4, fy, { size: 10, color: COL.focus, align: 'right', bg: false });
      else txt(it.label, px, it.up ? ax - 20 : fy, { size: 10, color: COL.focus, bg: false });
    });
  }

  function drawObject(o) {
    var x = SX(o.xObj), y0 = SY(0), y1 = SY(o.hObj);
    // 箭头必须画在【真实物高】上：光线从 (x, hObj) 发出，
    // 若把箭头拔高而光线不动，看起来就像“光不是从这个物体发出的”。
    if (Math.abs(y1 - y0) < 10) y1 = y0 - 10;

    // 标本台
    ctx.save();
    ctx.strokeStyle = 'rgba(251,191,36,.35)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x - 26, y0 + 12); ctx.lineTo(x + 26, y0 + 12); ctx.stroke();
    ctx.restore();
    line(x - 26, y0 + 12, x + 26, y0 + 12, 'rgba(251,191,36,.35)', 2);

    drawVerticalArrow(x, y0, y1, COL.object, 3.5, false, 1);
    if (isNarrow()) {
      txt('标本', x, y1 - 14, { size: 10.5, color: COL.object });
      return;
    }
    txt('A', x - 12, y1, { size: 10, color: COL.object, bg: false });
    txt('B', x - 12, y0 + 4, { size: 10, color: COL.object, bg: false });
    // 标签不能写太长：标本离物镜很近，长标签会横穿到透镜上（实测“（标本）”压镜片）
    txt('标本 AB', x, y1 - 16, { size: 11.5, color: COL.object });
  }

  function drawDistantObject(o) {
    // 望远镜：远处物体只作示意（不在真实比例内），重量是“视角 α”
    var x = SX(o.xObj == null ? -0.52 * (P.tele.d + MODES.tele.eyeGap) : o.xObj);
    var ax = SY(0);
    var h = Math.abs(SY(o.hMid) - ax) * 2.3;
    h = Math.max(26, Math.min(h, H * 0.2));
    var top = ax - h;
    // 小山 + 树 + 月亮？用“远处的树与山”剪影，倒立才容易被看出来
    ctx.save();
    ctx.fillStyle = 'rgba(251,191,36,.85)';
    ctx.beginPath();
    ctx.moveTo(x - 22, ax); ctx.lineTo(x, top); ctx.lineTo(x + 22, ax); ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(251,191,36,.55)';
    ctx.fillRect(x - 3, top + h * 0.22, 6, h * 0.5);
    ctx.beginPath(); ctx.arc(x, top + h * 0.16, 7, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    txt('远处物体', x, top - 18, { size: 11, color: COL.object });
    txt('（视角 α = ' + MODES.tele.alphaDeg.toFixed(1) + '°）', x, top - 4, { size: 9, color: 'rgba(251,191,36,.7)', bg: false });
    // 不再画“图标→透镜”的虚线：它跟入射光平行、颜色相同，会被误看成一条光线。
  }

  /* ---------------------------------------------------------------- 光线 */
  function buildRays(o) {
    var p = P[state.mode];
    var f1 = p.f1, f2 = p.f2, d = p.d;
    var xEnd = o.eyeX;
    var rays = [];

    function trace(x0, y0, s0) {
      var y1 = y0 + s0 * (0 - x0);
      var s1 = s0 - y1 / f1;
      var y2 = y1 + s1 * d;
      var s2 = s1 - y2 / f2;
      var yE = y2 + s2 * (xEnd - d);
      return { pts: [{ x: x0, y: y0 }, { x: 0, y: y1 }, { x: d, y: y2 }, { x: xEnd, y: yE }], s2: s2, y2: y2 };
    }

    if (state.mode === 'micro') {
      var A = { x: o.xObj, y: o.hObj };
      // 三条特殊光线：平行主轴 / 过光心 / 过物镜前焦点
      rays.push(trace(A.x, A.y, 0));
      rays.push(trace(A.x, A.y, (0 - A.y) / (0 - A.x)));
      rays.push(trace(A.x, A.y, (0 - A.y) / (-f1 - A.x)));
    } else {
      var s0 = -Math.tan(o.alpha);
      var x0 = -0.55 * (d + MODES.tele.eyeGap);
      var R = Math.abs(o.hMid) * 1.1;
      [-R, 0, R].forEach(function (y1) {
        rays.push(trace(x0, y1 - s0 * (0 - x0), s0));
      });
    }
    return rays;
  }

  function drawRays(o) {
    var rays = buildRays(o);
    var prog = state.anim;
    rays.forEach(function (r, idx) {
      var pts = r.pts.map(function (q) { return { x: SX(q.x), y: SY(q.y) }; });
      var segs = [
        { a: pts[0], b: pts[1], color: COL.rayObj },
        { a: pts[1], b: pts[2], color: COL.rayTube },
        { a: pts[2], b: pts[3], color: COL.rayOut }
      ];
      drawRaySegs(segs, prog, idx);

      // 反射（其实是折射）后方向不变的那条“过光心”辅助线：不用额外画

      // 虚像的反向延长线
      if (Number.isFinite(o.v2) && o.xFinal != null) {
        var e1 = { x: SX(P[state.mode].d), y: SY(r.y2) };
        var e2 = { x: SX(o.xFinal), y: SY(r.y2 + r.s2 * (o.xFinal - P[state.mode].d)) };
        if (e2.x > 8 && e2.x < W - 8 && prog > 0.85) {
          ctx.save();
          ctx.globalAlpha = 0.75 * clamp((prog - 0.85) / 0.15, 0, 1);
          ctx.strokeStyle = COL.ext;
          ctx.lineWidth = 1.3;
          ctx.setLineDash([5, 5]);
          ctx.beginPath(); ctx.moveTo(e1.x, e1.y); ctx.lineTo(e2.x, e2.y); ctx.stroke();
          ctx.restore();
        }
      }
    });
  }

  function drawRaySegs(segs, prog, idx) {
    var total = 0;
    segs.forEach(function (s) { total += Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y); });
    if (!total) return;
    var acc = 0;
    var tip = null;
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      var len = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
      var start = acc / total, end = (acc + len) / total;
      acc += len;
      if (prog <= start) break;
      var f = Math.min(1, (prog - start) / Math.max(1e-6, end - start));
      ctx.save();
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.9;
      ctx.shadowColor = s.color;
      ctx.shadowBlur = 7;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(s.a.x, s.a.y);
      ctx.lineTo(s.a.x + (s.b.x - s.a.x) * f, s.a.y + (s.b.y - s.a.y) * f);
      ctx.stroke();
      ctx.restore();
      tip = { x: s.a.x + (s.b.x - s.a.x) * f, y: s.a.y + (s.b.y - s.a.y) * f };
      if (prog < end) break;
    }
    if (prog < 1 && tip) {
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      ctx.beginPath(); ctx.arc(tip.x, tip.y, 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  /* ---------------------------------------------------------------- 透镜 */
  function lensHalfHeightPx(o) {
    var p = P[state.mode];
    var rays = buildRays(o);
    var maxY = 0;
    rays.forEach(function (r) {
      maxY = Math.max(maxY, Math.abs(r.pts[1].y), Math.abs(r.pts[2].y));
    });
    maxY = Math.max(maxY, Math.abs(o.hMid) * 1.2);
    // 上限还要受光轴位置约束：轴本身靠近画布顶部时，过高的透镜会被裁掉
    return clamp(maxY * map.s * 1.3 + 20, 64, Math.min(H * 0.33, SY(0) - 10));
  }

  function drawLenses(o) {
    var p = P[state.mode];
    var hl1 = lensHalfHeightPx(o);
    var hl2 = hl1 * MODES[state.mode].eyeScale;
    drawLensGlyph(SX(0), SY(0), hl1, COL.lensObj, '物镜', 'f₁ = ' + p.f1.toFixed(1) + ' mm');
    drawLensGlyph(SX(p.d), SY(0), hl2, COL.lensEye, '目镜', 'f₂ = ' + p.f2.toFixed(0) + ' mm');
  }

  function drawLensGlyph(cx, cy, halfH, color, name, sub) {
    var w = Math.min(20, halfH * 0.26);
    ctx.save();
    var g = ctx.createLinearGradient(cx - w, cy, cx + w, cy);
    g.addColorStop(0, 'rgba(56,189,248,.05)');
    g.addColorStop(.5, 'rgba(56,189,248,.22)');
    g.addColorStop(1, 'rgba(56,189,248,.05)');
    ctx.fillStyle = g;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.moveTo(cx, cy - halfH);
    ctx.quadraticCurveTo(cx + w * 1.7, cy, cx, cy + halfH);
    ctx.quadraticCurveTo(cx - w * 1.7, cy, cx, cy - halfH);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // 中心细线
    ctx.globalAlpha = .35;
    ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(cx, cy - halfH); ctx.lineTo(cx, cy + halfH); ctx.stroke();
    ctx.restore();

    txt(name, cx, cy - halfH - 30, { size: 12, color: color });
    txt(sub, cx, cy - halfH - 15, { size: 9.5, color: 'rgba(190,220,235,.8)', bg: false });
  }

  /* -------------------------------------------------------------- 像与眼睛 */
  // 标签放在像箭头的【中段】而不是尖端：尖端是虚线延长线汇聚的地方，压线最严重。
  // 右边放不下就翻到左边 —— 否则中间像贴近目镜时，文字会压到目镜上。
  function sideLabel(text, x, y, color, size, rightLimit, alpha, forceLeft) {
    ctx.font = '700 ' + size + 'px Inter, "Microsoft YaHei", sans-serif';
    var w = ctx.measureText(text).width;
    if (!forceLeft && x + 9 + w <= rightLimit) {
      txt(text, x + 9, y, { size: size, color: color, align: 'left', alpha: alpha });
    } else {
      txt(text, x - 9, y, { size: size, color: color, align: 'right', alpha: alpha });
    }
  }

  function drawRealImage(o, alpha) {
    var x = SX(o.xMid), y0 = SY(0), y1 = SY(o.hMid);
    // 阈值 4 px 而不是 6 px：望远镜的中间像只有 6.3 mm，窄屏（s≈0.95）下正好 6 px，
    // 卡在 6 就会被整段跳过 —— 手机上「中间像 A₁B₁」这条主线就消失了。
    if (Math.abs(y1 - y0) < 4) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    drawVerticalArrow(x, y0, y1, COL.mid, 3, false, alpha);
    ctx.restore();
    // 显微镜：中间像的标签放到轴【上方】（下方留给虚像箭头和尺寸标注）；
    // 望远镜：共焦提示已经在轴上方，中间像标签挂到箭头尖端外侧。
    if (isNarrow()) {
      // 窄屏：右对齐到箭头左边，否则文字会横穿到目镜上
      txt('A₁B₁ 实像', x - 7, y0 - 14, { size: 10, color: COL.mid, align: 'right', alpha: alpha });
      return;
    }
    // 望远镜：只有“出射平行光”时轴上方被共焦提示占用，中间像标签才挂到尖端外侧；
    // 其他状态改用 ax−42 这个固定槽位 —— 此时 F₁′/F₂ 合并标签在 ax−20、
    // 虚像标签在箭头外侧，三层各占一行，7 px 的错开量根本不够（实测两行字叠死）。
    var ly = state.mode === 'micro' ? y0 - 15
      : (o.outSide === 'parallel' ? y1 + (o.hMid < 0 ? 18 : -18) : y0 - 42);
    // 望远镜非平行光时，目镜右侧紧挨着 F₂′ 标签 —— 中间像标签一律放左边
    sideLabel('A₁B₁ 实像（' + Math.abs(o.hMid).toFixed(1) + ' mm）', x,
      ly, COL.mid, 11, SX(P[state.mode].d) - 8, alpha,
      state.mode === 'tele' && o.outSide !== 'parallel');
  }

  function drawFinalImage(o, alpha) {
    if (!Number.isFinite(o.v2)) {
      // 说明文字统一挂右上角：贴在目镜上方会和“目镜 / f₂”标签撞车
      txt('出射光互相平行 ⇒ 像在无穷远', W - 16, 42,
        { size: 11, color: COL.final, align: 'right', bg: false });
      return;
    }
    if (o.xFinal == null) return;
    var x = SX(o.xFinal);
    var y0 = SY(0), y1 = SY(o.hFinal);
    if (x < 10 || x > W - 10 || Math.abs(y1 - y0) < 4) {
      txt('虚像在画面外（|v₂| 太大）', W - 118, SY(0) + 58, { size: 10, color: COL.final, align: 'right' });
      return;
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    drawVerticalArrow(x, y0, y1, COL.final, 2.4, true, alpha);
    ctx.restore();
    var label = o.outSide === 'virtual' ? 'A₂B₂ 虚像（' + Math.abs(o.hFinal).toFixed(1) + ' mm）' : 'A₂B₂ 实像（镜后）';
    if (isNarrow()) {
      // 窄屏：挂到箭头尖端外侧，和轴上的“A₁B₁ 实像”拉开，否则两行字叠在一起
      txt(o.outSide === 'virtual' ? 'A₂B₂ 虚像' : 'A₂B₂ 实像', clamp(x, 42, W - 42),
        y1 + (o.hFinal < 0 ? 15 : -15), { size: 10, color: COL.final, alpha: alpha });
      return;
    }
    var ly = (y0 + y1) / 2;
    // 望远镜非共焦：轴上方 ax−42 是 A₁B₁、ax−20 是 F₁′/F₂，都被占了，
    // 虚像标签只能挂到箭头尖端外侧（近轴的小虚像正好在尖端附近，不会被裁）。
    if (state.mode === 'tele' && o.outSide !== 'parallel') {
      ly = y1 + (o.hFinal < 0 ? 16 : -16);
    }
    // 与中间像靠得很近时（望远镜“进焦点”档常见）再错开一行，避免两个标签叠字。
    // 必须用【中间像标签的实际基线】比较，不能用箭头中点 —— 两者相差十几像素，判定会失效。
    var midLabelY = state.mode === 'micro'
      ? SY(0) - 15
      : (o.outSide === 'parallel' ? SY(o.hMid) + (o.hMid < 0 ? 18 : -18) : SY(0) - 42);
    if (Math.abs(x - SX(o.xMid)) < 170 && Math.abs(ly - midLabelY) < 26) {
      ly = midLabelY + (o.hFinal < 0 ? 26 : -26);
    }
    sideLabel(label, x, ly, COL.final, 11, W - 12, alpha);
  }

  function drawEye(o) {
    var x = SX(o.eyeX), y = SY(0);
    ctx.save();
    ctx.strokeStyle = COL.eye;
    ctx.fillStyle = 'rgba(226,232,240,.10)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(x - 22, y);
    ctx.quadraticCurveTo(x, y - 17, x + 22, y);
    ctx.quadraticCurveTo(x, y + 17, x - 22, y);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#0b1b29';
    ctx.beginPath(); ctx.arc(x - 2, y, 4.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = COL.eye;
    ctx.beginPath(); ctx.arc(x - 2, y, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    if (!isNarrow()) txt('眼睛', x, y + 34, { size: 10.5, color: COL.eye });

    // 眼睛到目镜的出射光已经画过，这里补一个“观察方向”小箭头
    line(x - 34, y, x - 24, y, 'rgba(226,232,240,.35)', 1.2, [3, 4]);
  }

  /* -------------------------------------------------------------- 标注 */
  function drawBrackets(o) {
    var p = P[state.mode];
    // 尺寸线固定在画布底部：贴在光轴附近会被虚像箭头（显微镜）和中间像标签穿过，
    // 实测虚像箭头会正好压在「d = …」文字上。
    var yD = H - 30;
    var yU = H - 58;

    function bracket(x1, x2, y, label, color) {
      line(x1, y, x2, y, color, 1.2);
      line(x1, y - 5, x1, y + 5, color, 1.2);
      line(x2, y - 5, x2, y + 5, color, 1.2);
      // 端点小三角
      ctx.save();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x1 + 5, y - 4); ctx.lineTo(x1 + 5, y + 4); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x2, y); ctx.lineTo(x2 - 5, y - 4); ctx.lineTo(x2 - 5, y + 4); ctx.closePath(); ctx.fill();
      ctx.restore();
      txt(label, (x1 + x2) / 2, y - 11, { size: 10, color: color });
    }

    if (state.mode === 'micro') {
      bracket(SX(o.xObj), SX(0), yU, 'u₁ = ' + o.u1.toFixed(1) + ' mm', 'rgba(251,191,36,.85)');
    }
    bracket(SX(0), SX(p.d), yD, 'd = ' + p.d.toFixed(1) + ' mm', 'rgba(125,211,252,.8)');
  }

  function drawStepGlow(o) {
    var step = state.step;
    var spots = [];
    if (step === 1) {
      spots.push([SX(0), SY(0), 46, 'rgba(56,189,248,.22)']);
      spots.push([SX(o.xMid), SY(o.hMid * 0.5), 40, 'rgba(251,191,36,.18)']);
    } else if (step === 2) {
      spots.push([SX(o.xMid), SY(o.hMid * 0.5), 40, 'rgba(251,191,36,.18)']);
      spots.push([SX(P[state.mode].d), SY(0), 46, 'rgba(167,139,250,.22)']);
    } else {
      if (o.xFinal != null) spots.push([SX(o.xFinal), SY(o.hFinal * 0.5), 42, 'rgba(192,132,252,.20)']);
      spots.push([SX(o.eyeX), SY(0), 34, 'rgba(226,232,240,.14)']);
    }
    spots.forEach(function (s) {
      var g = ctx.createRadialGradient(s[0], s[1], 2, s[0], s[1], s[2]);
      g.addColorStop(0, s[3]);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(s[0], s[1], s[2], 0, Math.PI * 2); ctx.fill();
    });
  }

  function drawNote(o) {
    if (state.mode === 'tele') {
      txt('入射光来自很远处的物体，可视为平行光', W - 16, 22,
        { size: 10, color: 'rgba(251,191,36,.75)', align: 'right', bg: false });
    }
  }

  /* ------------------------------------------------------------ 视角对比图 */
  function drawViews(o) {
    if (!vctx) return;
    var rect = viewCanvas.getBoundingClientRect();
    var w = Math.max(80, rect.width), h = Math.max(80, rect.height);
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    if (viewCanvas.width !== Math.round(w * dpr)) {
      viewCanvas.width = Math.round(w * dpr);
      viewCanvas.height = Math.round(h * dpr);
    }
    vctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    vctx.clearRect(0, 0, w, h);

    var tanRaw = o.tanIn, tanView = o.tanOut;
    var maxTan = Math.max(tanRaw, tanView, 1e-6);
    // R 留出底部文字的位置；F 的最大高度取 1.1R（直径是 2R），否则会被圆裁掉
    var R = Math.min(w * 0.22, h * 0.36);
    var cy = h * 0.46;

    function view(cx, tan, inverted, caption) {
      vctx.save();
      vctx.beginPath(); vctx.arc(cx, cy, R, 0, Math.PI * 2);
      vctx.fillStyle = '#06121e'; vctx.fill();
      vctx.strokeStyle = 'rgba(120,170,200,.35)'; vctx.lineWidth = 1; vctx.stroke();
      vctx.clip();

      var px = R * 1.1 / maxTan * tan;      // 最大视角也只占 1.1R，留边
      // 直接看的 F 按真实比例只有 2~3 px，会被看成噪点；给一个 7 px 的可辨认下限
      var hh = Math.max(7, px);
      drawGlyphF(cx, cy, hh, inverted);

      vctx.restore();
      vctx.fillStyle = 'rgba(190,215,230,.8)';
      vctx.font = '600 10px Inter, "Microsoft YaHei", sans-serif';
      vctx.textAlign = 'center';
      vctx.fillText(caption, cx, cy + R + 14);
    }

    view(w * 0.27, tanRaw, false, '直接看');
    view(w * 0.73, tanView, true, '仪器中');
  }

  function drawGlyphF(cx, cy, h, inverted) {
    var u = h / 10;
    vctx.save();
    vctx.translate(cx, cy);
    if (inverted) vctx.rotate(Math.PI);
    vctx.strokeStyle = '#fbbf24';
    vctx.lineWidth = Math.max(1.3, u * 1.1);
    vctx.lineCap = 'square';
    vctx.beginPath();
    vctx.moveTo(-3 * u, 5 * u);
    vctx.lineTo(-3 * u, -5 * u);
    vctx.lineTo(3 * u, -5 * u);
    vctx.moveTo(-3 * u, 0);
    vctx.lineTo(1.8 * u, 0);
    vctx.stroke();
    vctx.restore();
  }

  /* -------------------------------------------------------------- 读数更新 */
  function updateReadouts(o) {
    var M = MODES[state.mode];

    document.getElementById('metricMode').textContent = M.name;

    var midEl = document.getElementById('metricMid');
    if (o.midSide === 'inner') {
      midEl.textContent = '在目镜焦点以内 ' + Math.abs(o.midToFocus).toFixed(1) + ' mm';
      midEl.className = 'good';
    } else if (o.midSide === 'on') {
      midEl.textContent = '恰在目镜焦点上';
      midEl.className = 'good';
    } else {
      midEl.textContent = '在目镜焦点以外 ' + Math.abs(o.midToFocus).toFixed(1) + ' mm';
      midEl.className = 'warn';
    }

    document.getElementById('metricTotal').textContent =
      (o.Mprod >= 10 ? o.Mprod.toFixed(0) : o.Mprod.toFixed(1)) + ' ×';

    var finEl = document.getElementById('metricFinal');
    if (o.outSide === 'virtual') {
      finEl.textContent = state.mode === 'micro' ? '倒立、放大的虚像' : '倒立、缩小的虚像（视角变大）';
      finEl.className = 'good';
    } else if (o.outSide === 'parallel') {
      finEl.textContent = '像在无穷远（平行光）';
      finEl.className = 'good';
    } else {
      finEl.textContent = '镜后实像，眼睛看不到';
      finEl.className = 'bad';
    }

    // 焦点条
    var ratio = clamp(o.u2 / o.f2, 0, 2);
    document.getElementById('focusMark').style.left = (ratio / 2 * 100) + '%';
    // 三区不能等分：中间“恰在焦点”区只占 12%，再窄文字就被挤没了
    document.getElementById('focusIn').style.left = '0';
    document.getElementById('focusIn').style.width = '44%';
    document.getElementById('focusOn').style.left = '44%';
    document.getElementById('focusOn').style.width = '12%';
    document.getElementById('focusOut').style.left = '56%';
    document.getElementById('focusOut').style.width = '44%';
    document.getElementById('focusHead').textContent =
      o.midSide === 'inner' ? '中间像落在目镜焦点以内'
        : (o.midSide === 'on' ? '中间像恰在目镜焦点上' : '中间像落在目镜焦点以外');

    // 侧栏结论
    var finding = document.getElementById('finding');
    var html;
    if (state.mode === 'micro') {
      if (o.midSide === 'inner') {
        html = '中间像在目镜焦点以内 <b>' + Math.abs(o.midToFocus).toFixed(1) +
          ' mm</b> ⇒ 目镜当放大镜，成<b>倒立、放大的虚像</b>。总倍数 = 物镜 ' +
          Math.abs(o.m1).toFixed(1) + '× × 目镜 ' + (D_NEAR / o.f2).toFixed(0) + '× = <b>' + o.Mprod.toFixed(0) + '×</b>。';
      } else if (o.midSide === 'on') {
        html = '中间像恰在目镜焦点上 ⇒ 出射<b>平行光</b>，眼睛放松看无穷远。这是显微镜的“标准调焦”，视角放大正好等于教材倍数（含 250 mm 明视距离口径）。';
      } else {
        html = '中间像跑到目镜焦点以外 ⇒ 目镜把它成<b>实像</b>（落在目镜右后方），眼睛看不到清晰像。显微镜<b>不能</b>这样调。';
      }
    } else {
      if (o.midSide === 'inner') {
        html = '物镜先成<b>倒立、缩小</b>的实像，目镜再把它放大 ⇒ 看到倒立、缩小的虚像，但<b>视角放大了 ' +
          o.Mview.toFixed(1) + ' 倍</b>，所以感觉“拉近”了。';
      } else if (o.midSide === 'on') {
        html = '中间像恰在目镜焦点 ⇒ 出射<b>平行光</b>，像在无穷远，眼睛最放松。放大倍数 = f₁ ÷ f₂ = ' +
          (o.f1 / o.f2).toFixed(1) + '×。';
      } else {
        html = '中间像在目镜焦点以外 ⇒ 目镜成实像，眼睛看不到清晰像。把目镜往左挪一点（缩短镜筒）就能重新看到。';
      }
    }
    finding.innerHTML = html;

    // 视角面板
    var rawDeg = Math.atan(o.tanIn) * 180 / Math.PI;
    var viewDeg = Math.atan(o.tanOut) * 180 / Math.PI;
    document.getElementById('rawAngle').textContent = rawDeg.toFixed(2) + '°';
    document.getElementById('viewAngle').textContent = viewDeg.toFixed(2) + '°';
    var vn = document.getElementById('viewNote');
    var diff = o.Mview / o.Mprod;
    var diffTxt = (diff > 0.92 && diff < 1.08)
      ? '此时实际视角放大与教材倍数基本一致。'
      : '注意：虚像不在明视距离/无穷远时，实际视角放大（' + o.Mview.toFixed(1) +
        '×）和教材口径（' + o.Mprod.toFixed(1) + '×）会有差别，这是正常的。';
    vn.innerHTML = '视角从 <b>' + rawDeg.toFixed(2) + '°</b> 变成 <b>' + viewDeg.toFixed(2) +
      '°</b>，放大了 <b>' + o.Mview.toFixed(1) + ' 倍</b>。' + diffTxt;

    // 分步文案
    document.getElementById('step1Text').textContent = state.mode === 'micro'
      ? '标本在 f₁ 与 2f₁ 之间，物镜成倒立、放大的实像 A₁B₁（相当于投影仪的镜头）。'
      : '远处物体在 2f₁ 以外，物镜成倒立、缩小的实像 A₁B₁，位置就在焦点附近（相当于照相机的镜头）。';
    document.getElementById('step2Text').textContent = state.mode === 'micro'
      ? 'A₁B₁ 落在目镜焦点以内，目镜相当于放大镜，成正立、放大的虚像 A₂B₂。'
      : 'A₁B₁ 落在目镜焦点以内，目镜当放大镜，把它放大成虚像 A₂B₂。';
    document.getElementById('step3Text').textContent = state.mode === 'micro'
      ? '最终看到倒立、放大的虚像；像在目镜左侧，不能用光屏承接。'
      : '最终相对于物体是倒立、缩小的虚像，但视角被放大，所以“看起来更近、更大”。';
    document.getElementById('stepLaw').textContent = state.mode === 'micro'
      ? '物镜倍数 = v₁ ÷ u₁ = ' + Math.abs(o.m1).toFixed(1) + '；目镜倍数 = 250 mm ÷ f₂ = ' +
        (D_NEAR / o.f2).toFixed(0) + '；总放大倍数 = ' + o.Mprod.toFixed(0) + ' ×。'
      : '望远镜的放大倍数 = f₁ ÷ f₂ = ' + o.f1.toFixed(0) + ' ÷ ' + o.f2.toFixed(0) + ' = ' +
        (o.f1 / o.f2).toFixed(1) + ' ×。物镜成的像虽然小，但视角被放大。';
  }

  /* -------------------------------------------------------------- 控件同步 */
  function $(id) { return document.getElementById(id); }

  function tubeRange(o) {
    var p = P[state.mode];
    var v1 = o ? o.v1 : (state.mode === 'micro' ? imgDist(p.u1, p.f1) : p.f1);
    if (state.mode === 'micro') return [v1 + 0.12 * p.f2, v1 + 1.85 * p.f2];
    return [p.f1 + 0.12 * p.f2, p.f1 + 1.8 * p.f2];
  }

  function syncUI() {
    var M = MODES[state.mode], p = P[state.mode];
    var o = solve();

    $('f1').min = M.f1Range[0]; $('f1').max = M.f1Range[1]; $('f1').step = M.f1Range[2];
    $('f1').value = p.f1;
    $('f1Value').textContent = p.f1.toFixed(1) + ' mm';

    $('f2').min = M.f2Range[0]; $('f2').max = M.f2Range[1]; $('f2').step = M.f2Range[2];
    $('f2').value = p.f2;
    $('f2Value').textContent = p.f2.toFixed(0) + ' mm';

    var tr = tubeRange(o);
    p.d = clamp(p.d, tr[0], tr[1]);
    $('tube').min = tr[0].toFixed(1); $('tube').max = tr[1].toFixed(1); $('tube').step = 0.5;
    $('tube').value = p.d;
    $('tubeValue').textContent = p.d.toFixed(1) + ' mm';

    var objGroup = $('objGroup');
    if (state.mode === 'micro') {
      objGroup.style.display = '';
      p.u1 = clamp(p.u1, 1.06 * p.f1, 1.94 * p.f1);
      $('objU').min = (1.06 * p.f1).toFixed(1);
      $('objU').max = (1.94 * p.f1).toFixed(1);
      $('objU').step = 0.1;
      $('objU').value = p.u1;
      $('objUValue').textContent = p.u1.toFixed(1) + ' mm';
    } else {
      objGroup.style.display = 'none';
    }

    $('f1Hint').textContent = state.mode === 'micro'
      ? '物镜焦距越短，成的实像越大（物镜倍数 = v₁/u₁）。'
      : '望远镜的物镜焦距要长，倍数 = f₁ ÷ f₂。';
    $('f2Hint').textContent = state.mode === 'micro'
      ? '目镜相当于放大镜：焦距越短，目镜倍数 250/f₂ 越大。'
      : '望远镜的目镜焦距要短，倍数才大。';
    document.querySelectorAll('#modeSeg button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.mode === state.mode);
    });
  }

  function applyChange(repaint) {
    syncUI();
    if (repaint !== false) render();
  }

  /* -------------------------------------------------------------- 动画 */
  var raf = 0, animStart = 0;
  function play() {
    state.anim = 0;
    animStart = performance.now();
    cancelAnimationFrame(raf);
    (function tick() {
      var t = (performance.now() - animStart) / 1150;
      state.anim = Math.min(1, Math.max(0, t));
      render();
      if (state.anim < 1) raf = requestAnimationFrame(tick);
    })();
  }

  /* -------------------------------------------------------------- 尺寸 */
  function resizeIfNeeded() {
    var rect = cv.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width)), h = Math.max(1, Math.round(rect.height));
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    if (w !== W || h !== H || cv.width !== Math.round(w * dpr)) {
      W = w; H = h; DPR = dpr;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  /* -------------------------------------------------------------- 交互 */
  function canvasPos(e) {
    var r = cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function hitTest(x, y) {
    var o = solve();
    var p = P[state.mode];
    var eyeX = SX(p.d);
    if (Math.abs(x - eyeX) < 22 && Math.abs(y - SY(0)) < H * 0.34) return 'lens2';
    if (state.mode === 'micro') {
      var ox = SX(o.xObj);
      if (Math.abs(x - ox) < 26 && y > SY(o.hObj) - 30 && y < SY(0) + 24) return 'object';
    }
    return null;
  }

  cv.addEventListener('pointerdown', function (e) {
    var q = canvasPos(e);
    var hit = hitTest(q.x, q.y);
    if (!hit) return;
    state.drag = { what: hit, x0: q.x, d0: P[state.mode].d, u0: P[state.mode].u1, o: solve() };
    cv.setPointerCapture(e.pointerId);
    cv.style.cursor = 'grabbing';
    e.preventDefault();
  });

  cv.addEventListener('pointermove', function (e) {
    var q = canvasPos(e);
    if (!state.drag) {
      var hit = hitTest(q.x, q.y);
      cv.style.cursor = hit ? 'grab' : 'default';
      // hover 提示
      if (hit !== state.hover) {
        state.hover = hit;
        $('stageTip').innerHTML = hit === 'object'
          ? '<b>拖我</b>：改变标本到物镜的距离 u₁'
          : (hit === 'lens2' ? '<b>拖我</b>：改变镜筒长度 d（调焦）' : '<b>①</b> 物镜成像　<b>②</b> 目镜成像　<b>③</b> 眼睛看到');
      }
      return;
    }
    var dx = (q.x - state.drag.x0) / map.s;
    var p = P[state.mode];
    if (state.drag.what === 'lens2') {
      var tr = tubeRange(state.drag.o);
      p.d = clamp(state.drag.d0 + dx, tr[0], tr[1]);
    } else {
      // 物距：往右拖（靠近透镜）应当变小，这是直接的“拖动标本台”
      p.u1 = clamp(state.drag.u0 + dx, 1.06 * p.f1, 1.94 * p.f1);
    }
    applyChange(true);
  });

  function endDrag(e) {
    if (!state.drag) return;
    state.drag = null;
    cv.style.cursor = 'default';
    try { cv.releasePointerCapture(e.pointerId); } catch (err) {}
    play();
  }
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);

  cv.addEventListener('keydown', function (e) {
    var stepD = e.shiftKey ? 5 : 0.5;
    var p = P[state.mode];
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      var tr = tubeRange(solve());
      p.d = clamp(p.d + (e.key === 'ArrowRight' ? stepD : -stepD), tr[0], tr[1]);
      applyChange(true); e.preventDefault();
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && state.mode === 'micro') {
      p.u1 = clamp(p.u1 + (e.key === 'ArrowUp' ? -0.2 : 0.2), 1.06 * p.f1, 1.94 * p.f1);
      applyChange(true); e.preventDefault();
    }
  });

  /* -------------------------------------------------------------- 预设 */
  function setMode(mode) {
    if (!MODES[mode]) return;
    state.mode = mode;
    state.step = 1;
    syncUI();
    play();
  }

  function preset(kind) {
    var p = P[state.mode];
    var o = solve();
    if (kind === 'inside') p.d = o.v1 + 0.55 * p.f2;
    else if (kind === 'parallel') p.d = o.v1 + p.f2;
    else if (kind === 'near') p.d = o.v1 + (D_NEAR * p.f2) / (D_NEAR + p.f2);
    var tr = tubeRange(o);
    p.d = clamp(p.d, tr[0], tr[1]);
    applyChange(true);
    play();
  }

  function resetAll() {
    P.micro = { f1: 8, f2: 25, u1: 10, d: 53.75 };
    P.tele = { f1: 120, f2: 30, d: 150 };
    state.mode = 'micro';
    state.step = 1;
    document.querySelectorAll('#steps .step').forEach(function (b, i) {
      b.classList.toggle('on', i === 0);
    });
    applyChange(true);
    play();
  }

  /* -------------------------------------------------------------- 事件绑定 */
  function bind() {
    document.querySelectorAll('#modeSeg button').forEach(function (b) {
      b.addEventListener('click', function () { setMode(b.dataset.mode); });
    });
    $('playBtn').addEventListener('click', play);
    $('toggleFoci').addEventListener('change', function (e) { state.showFoci = e.target.checked; render(); });
    $('toggleExt').addEventListener('change', function (e) { state.showExt = e.target.checked; render(); });

    $('f1').addEventListener('input', function (e) {
      var p = P[state.mode];
      var ratio = p.f1 / p.u1;
      p.f1 = parseFloat(e.target.value);
      if (state.mode === 'micro') p.u1 = clamp(p.f1 / ratio, 1.06 * p.f1, 1.94 * p.f1);
      var o = solve(), tr = tubeRange(o);
      p.d = clamp(p.d, tr[0], tr[1]);
      applyChange(true);
    });
    $('f2').addEventListener('input', function (e) {
      P[state.mode].f2 = parseFloat(e.target.value);
      var o = solve(), tr = tubeRange(o);
      P[state.mode].d = clamp(P[state.mode].d, tr[0], tr[1]);
      applyChange(true);
    });
    $('tube').addEventListener('input', function (e) {
      P[state.mode].d = parseFloat(e.target.value);
      applyChange(true);
    });
    $('objU').addEventListener('input', function (e) {
      P.micro.u1 = parseFloat(e.target.value);
      applyChange(true);
    });

    $('presetInside').addEventListener('click', function () { preset('inside'); });
    $('presetParallel').addEventListener('click', function () { preset('parallel'); });
    $('presetNear').addEventListener('click', function () { preset('near'); });
    $('resetBtn').addEventListener('click', resetAll);

    document.querySelectorAll('#steps .step').forEach(function (b) {
      b.addEventListener('click', function () {
        state.step = parseInt(b.dataset.step, 10);
        document.querySelectorAll('#steps .step').forEach(function (x) { x.classList.toggle('on', x === b); });
        render();
      });
    });

    window.addEventListener('resize', function () { render(); });
    if (window.ResizeObserver) {
      try { new ResizeObserver(function () { render(); }).observe(cv); } catch (e) {}
    }
  }

  /* -------------------------------------------------------------- 调试钩子 */
  window.__micro2d = {
    state: state,
    params: P,
    solve: solve,
    setMode: setMode,
    preset: preset,
    setD: function (v) { P[state.mode].d = v; applyChange(true); },
    setF1: function (v) { P[state.mode].f1 = v; applyChange(true); },
    setF2: function (v) { P[state.mode].f2 = v; applyChange(true); },
    setU1: function (v) { P.micro.u1 = v; applyChange(true); },
    setStep: function (n) { state.step = n; render(); },
    play: play,
    render: render,
    tubeRange: function () { return tubeRange(solve()); },
    // 屏幕坐标换算（自检用：拖拽命中测试必须点在真实的目镜/物体上）
    screen: function (x, y) { return { x: SX(x), y: SY(y), s: map.s }; },
    debug: function () {
      var o = solve();
      return {
        mode: o.mode, f1: o.f1, f2: o.f2, d: o.d, u1: o.u1,
        v1: o.v1, m1: o.m1, hMid: o.hMid, u2: o.u2, v2: o.v2, hFinal: o.hFinal,
        xFinal: o.xFinal, Mprod: o.Mprod, Mview: o.Mview, midSide: o.midSide, outSide: o.outSide
      };
    }
  };

  /* -------------------------------------------------------------- 启动 */
  bind();
  syncUI();
  render();
  play();
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { render(); }).catch(function () {});
  }
})();
