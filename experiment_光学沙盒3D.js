import * as THREE from './assets/optics-three.min.js';

/* 光学实验沙盒 · 3D 光路搭建【光学实验台版】
 *
 * ────────────────────────────────────────────────────────────────
 *  一句话：把「悬在网格上的二维光路」搬到一张【真实的光学实验台】上。
 *
 *  物理内核与 2D 版【逐行一致】（纯平面光线追迹：所有元件位于 z = 0 平面内，
 *  光线在该平面内传播、反射、折射、全反射），只是：
 *    ① 平面 z = 0 现在是一块【光学平台的竖直工作平面】——
 *       台面板在它下方、元件全部装在立柱上、光轴高度一眼可见；
 *    ② 加了标定（1 cm = 20 个 2D 像素 ⇒ 台面有效长度 35 cm），
 *       于是「透镜离光源多少厘米」是可以读出来的；
 *    ③ 加了三条真实实验里才有的东西：白光色散、光屏亮斑、入射/反射/折射角标注。
 *
 *  2D 沙盒坐标 (x, y)（原点左上、y 向下）→ 3D 世界：
 *    X = (x − W/2)·S，Y = (H/2 − y)·S，Z = z·S
 *  ⇒ 光轴（2D 的 y = H/2 那一行）落在世界 Y = 0；
 *    台面顶面 BENCH_TOP = −HALF_H − 0.10（正好在光学平面下沿之下）。
 *
 *  元件网格：先按局部坐标 (px, py) 建 2D 轮廓 → 映射成 (px·S, −py·S) →
 *  挤出厚度 → 放到 to3D(comp.x, comp.y) → 绕 Z 轴旋转 −comp.angle
 *  （推导：先旋转后映射 == 先映射后绕 Z 轴转 −a，见 MEMORY 推导）。
 *  🔴 支架（立柱/底座）【不能】放进被旋转的元件组里 —— 绕 Z 旋转会把立柱
 *     掰斜。支架单独一个 mountGroup，只随 x 平移。
 * ────────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  // ============ 逻辑尺寸（固定，与窗口无关） ============
  var W = 700, H = 520;              // 2D 沙盒坐标范围
  var S = 0.02;                      // 2D px → 3D 单位
  var HALF_W = W * S / 2, HALF_H = H * S / 2;

  // ---- 现实标定：1 cm = 20 个 2D 像素 ⇒ 1 cm = 0.4 世界单位 ----
  var PX_PER_CM = 20;
  var CM = PX_PER_CM * S;                    // 1 cm 的世界长度
  var BENCH_CM = Math.round(W / PX_PER_CM);  // 台面有效长度 35 cm
  var AXIS_2D_Y = H / 2;                     // 光轴所在的 2D 行

  // ---- 光学实验台（光学平台）几何 ----
  var BENCH_TOP = -HALF_H - 0.10;    // 台面顶面（世界 Y）
  var BENCH_T = 0.34;                // 台面板厚
  var BENCH_HALF_Z = 1.45;           // 台面半深
  var BENCH_PAD = 0.55;              // 台面比光学平面每侧外扩
  var LEG_H = 2.2;                   // 支腿高
  var BENCH_BOT = BENCH_TOP - BENCH_T;
  var FLOOR_Y = BENCH_BOT - LEG_H;

  var MIN_2D_Y = 12, MAX_2D_Y = 492; // 元件纵向范围（保证支架装得下）

  function to3D(x, y, z) {
    return new THREE.Vector3((x - W / 2) * S, (H / 2 - y) * S, (z || 0) * S);
  }
  // 局部 2D 点 → 3D 平面上的点（相对元件中心）
  function local3D(px, py) { return new THREE.Vector2(px * S, -py * S); }

  // ============ 颜色 ============
  var RAY_COLORS = [0xef4444, 0xf59e0b, 0x3b82f6];
  var SELECT_COLOR = 0x06b6d4;
  var NORMAL_COLOR = 0xfbbf24;
  var RAY_RADIUS = 0.055;            // 光线细管半径（3D 单位）
  var GLOW_RADIUS = 0.135;           // 辉光外套半径
  var GLOW_OPACITY = 0.20;

  // 可见光谱（白光色散用）：波长 nm → 显示色
  var WAVELENGTHS = [420, 460, 490, 530, 580, 610, 650];
  var LAMBDA_COLORS = [0x7c3aed, 0x2563eb, 0x06b6d4, 0x22c55e, 0xeab308, 0xf97316, 0xef4444];
  function lambdaColor(nm) {
    var best = 0, bestD = 1e9;
    for (var i = 0; i < WAVELENGTHS.length; i++) {
      var d = Math.abs(WAVELENGTHS[i] - nm);
      if (d < bestD) { bestD = d; best = i; }
    }
    return LAMBDA_COLORS[best];
  }

  // ============ 元件类型 ============
  var COMP_DEFS = {
    laser_single: { name: '单束激光', isSource: true },
    laser_triple: { name: '三束激光', isSource: true },
    white_light: { name: '白光光源', isSource: true },
    convex_lens: { name: '凸透镜', isSource: false },
    concave_lens: { name: '凹透镜', isSource: false },
    flat_mirror: { name: '平面镜', isSource: false },
    concave_mirror: { name: '凹面镜', isSource: false },
    convex_mirror: { name: '凸面镜', isSource: false },
    glass_block: { name: '玻璃块', isSource: false },
    prism: { name: '三棱镜', isSource: false },
    screen: { name: '光屏', isSource: false }
  };
  var SOURCE_TYPES = { laser_single: 1, laser_triple: 1, white_light: 1 };
  var GLASS_TYPES = { convex_lens: 1, concave_lens: 1, glass_block: 1, prism: 1 };

  // ============ 状态 ============
  var state = {
    components: [],
    selectedId: null,
    n: 1.50,
    showNormals: false,
    showAngles: false,
    orbit: false,
    view: 'front'
  };
  var cam = { yaw: -0.42, pitch: 0.36, dist: 20, zoom: 1 };

  var VIEWS = {
    front: { yaw: 0, pitch: 0.02 },
    angle: { yaw: -0.42, pitch: 0.36 },
    top: { yaw: 0, pitch: 1.18 },
    side: { yaw: -1.32, pitch: 0.10 }
  };
  var ORBIT_SPEED = 0.42;            // rad/s，环绕模式角速度

  // ================================================================
  //  物理内核 —— 与 2D 版逐行一致（只加了「可选的波长」与「光屏终止」）
  // ================================================================

  // Cauchy 色散：n(λ) = A + B/λ²，用 λ = 530 nm（可见光中段）处的 comp.n 标定。
  // B 取 0.0151 ⇒ n(420nm) − n(650nm) ≈ 0.050。
  // 🔴 这是【教学放大】：真实冕牌玻璃 Δn ≈ 0.018，色散角只有 1° 上下，
  //    在一屏之内根本看不出彩虹。放大到 ≈ 0.05（≈ 3×）后，7 条波长在光屏上
  //    能分开成一条可辨认的彩色光带 —— 这是「看得见规律」与「数值完全写实」
  //    之间必须做的取舍，页面提示里也照实写明。
  var LAMBDA_REF_UM = 0.530;
  var CAUCHY_B = 0.0151;
  function nFor(comp, lambdaNm) {
    var base = comp.n || state.n;
    if (!lambdaNm) return base;
    var um = lambdaNm / 1000;
    var A = base - CAUCHY_B / (LAMBDA_REF_UM * LAMBDA_REF_UM);
    return A + CAUCHY_B / (um * um);
  }

  function getSurfaces(comp, lambdaNm) {
    var cx = comp.x, cy = comp.y, a = comp.angle;
    var cos = Math.cos(a), sin = Math.sin(a);
    var surfaces = [];
    function rotatePoint(px, py) {
      return { x: cx + px * cos - py * sin, y: cy + px * sin + py * cos };
    }
    var n_in = lambdaNm ? nFor(comp, lambdaNm) : (comp.n || state.n);
    var n_out = 1.0;

    switch (comp.type) {
      case 'flat_mirror': {
        var L = (comp.mirrorLen || 120) / 2;
        var p1 = rotatePoint(0, -L), p2 = rotatePoint(0, L);
        surfaces.push({ kind: 'line', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, isMirror: true, n1: n_out, n2: n_out });
        break;
      }
      case 'concave_mirror': {
        var R = comp.mirrorR || 150, span = comp.mirrorSpan || Math.PI / 3;
        var ac = rotatePoint(-R, 0);
        surfaces.push({ kind: 'arc', cx: ac.x, cy: ac.y, r: R, startAngle: a - span / 2, endAngle: a + span / 2, isMirror: true, n1: n_out, n2: n_out });
        break;
      }
      case 'convex_mirror': {
        var R2 = comp.mirrorR || 150, span2 = comp.mirrorSpan || Math.PI / 3;
        var ac2 = rotatePoint(R2, 0);
        surfaces.push({ kind: 'arc', cx: ac2.x, cy: ac2.y, r: R2, startAngle: a + Math.PI - span2 / 2, endAngle: a + Math.PI + span2 / 2, isMirror: true, n1: n_out, n2: n_out });
        break;
      }
      case 'glass_block': {
        var hw = (comp.blockW || 100) / 2, hh = (comp.blockH || 60) / 2;
        var c = [rotatePoint(-hw, -hh), rotatePoint(hw, -hh), rotatePoint(hw, hh), rotatePoint(-hw, hh)];
        for (var i = 0; i < 4; i++) {
          var j = (i + 1) % 4;
          surfaces.push({ kind: 'line', x1: c[i].x, y1: c[i].y, x2: c[j].x, y2: c[j].y, isMirror: false, n1: n_out, n2: n_in });
        }
        break;
      }
      case 'prism': {
        var s = comp.prismSide || 80;
        var ph = s * Math.sqrt(3) / 2;
        var pc = [rotatePoint(0, -ph * 2 / 3), rotatePoint(-s / 2, ph / 3), rotatePoint(s / 2, ph / 3)];
        for (var k = 0; k < 3; k++) {
          var m = (k + 1) % 3;
          surfaces.push({ kind: 'line', x1: pc[k].x, y1: pc[k].y, x2: pc[m].x, y2: pc[m].y, isMirror: false, n1: n_out, n2: n_in });
        }
        break;
      }
      case 'screen': {
        // 光屏：一块【吸收】面 —— 光线到此终止，留下一个亮斑。
        var sw = (comp.screenW || 60) / 2, sh = (comp.screenH || 240) / 2;
        var sp1 = rotatePoint(0, -sh), sp2 = rotatePoint(0, sh);
        surfaces.push({ kind: 'line', x1: sp1.x, y1: sp1.y, x2: sp2.x, y2: sp2.y, isMirror: false, isScreen: true, n1: n_out, n2: n_out, w: sw });
        break;
      }
      case 'convex_lens': {
        var lhh = (comp.lensH || 120) / 2, lR = comp.lensR || 160, lhw = (comp.lensW || 12) / 2;
        var d = Math.sqrt(Math.max(lR * lR - lhh * lhh, 0));
        var lc = rotatePoint(-lhw + d, 0);
        var tp = rotatePoint(-lhw, -lhh), bp = rotatePoint(-lhw, lhh);
        var ls = Math.atan2(tp.y - lc.y, tp.x - lc.x), le = Math.atan2(bp.y - lc.y, bp.x - lc.x);
        surfaces.push({ kind: 'arc', cx: lc.x, cy: lc.y, r: lR, startAngle: Math.min(ls, le), endAngle: Math.max(ls, le), isMirror: false, n1: n_out, n2: n_in });
        var rc = rotatePoint(lhw - d, 0);
        var rtp = rotatePoint(lhw, -lhh), rbp = rotatePoint(lhw, lhh);
        var rs = Math.atan2(rbp.y - rc.y, rbp.x - rc.x), re = Math.atan2(rtp.y - rc.y, rtp.x - rc.x);
        surfaces.push({ kind: 'arc', cx: rc.x, cy: rc.y, r: lR, startAngle: Math.min(rs, re), endAngle: Math.max(rs, re), isMirror: false, n1: n_out, n2: n_in });
        break;
      }
      case 'concave_lens': {
        var chh = (comp.lensH || 120) / 2, cR = comp.lensR || 400, chw = (comp.lensW || 12) / 2;
        var cd = Math.sqrt(Math.max(cR * cR - chh * chh, 0));
        var clc = rotatePoint(-chw - cd, 0);
        var ctp = rotatePoint(-chw, -chh), cbp = rotatePoint(-chw, chh);
        var cls = Math.atan2(ctp.y - clc.y, ctp.x - clc.x), cle = Math.atan2(cbp.y - clc.y, cbp.x - clc.x);
        surfaces.push({ kind: 'arc', cx: clc.x, cy: clc.y, r: cR, startAngle: Math.min(cls, cle), endAngle: Math.max(cls, cle), isMirror: false, n1: n_out, n2: n_in });
        var crc = rotatePoint(chw + cd, 0);
        var crtp = rotatePoint(chw, -chh), crbp = rotatePoint(chw, chh);
        var crs = Math.atan2(crbp.y - crc.y, crbp.x - crc.x), cre = Math.atan2(crtp.y - crc.y, crtp.x - crc.x);
        surfaces.push({ kind: 'arc', cx: crc.x, cy: crc.y, r: cR, startAngle: Math.min(crs, cre), endAngle: Math.max(crs, cre), isMirror: false, n1: n_out, n2: n_in });
        break;
      }
    }
    return surfaces;
  }

  function getSourceRays(comp) {
    var cx = comp.x, cy = comp.y, a = comp.angle;
    var cos = Math.cos(a), sin = Math.sin(a);
    var rays = [];
    if (comp.type === 'laser_single') {
      rays.push({ ox: cx, oy: cy, dx: cos, dy: sin, color: 0 });
    } else if (comp.type === 'laser_triple') {
      var perpX = -sin, perpY = cos;
      for (var i = -1; i <= 1; i++) {
        rays.push({ ox: cx + perpX * i * 8, oy: cy + perpY * i * 8, dx: cos, dy: sin, color: i + 1 });
      }
    } else if (comp.type === 'white_light') {
      // 白光 = 7 条共线（进入棱镜前完全重合 ⇒ 看起来就是一束白光）
      for (var w = 0; w < WAVELENGTHS.length; w++) {
        rays.push({ ox: cx, oy: cy, dx: cos, dy: sin, color: 0, lambda: WAVELENGTHS[w] });
      }
    }
    return rays;
  }

  function intersectLineRay(x1, y1, x2, y2, ox, oy, dx, dy) {
    var sx = x2 - x1, sy = y2 - y1;
    var denom = dx * sy - dy * sx;
    if (Math.abs(denom) < 1e-8) return null;
    var t = ((x1 - ox) * sy - (y1 - oy) * sx) / denom;
    var s = ((x1 - ox) * dy - (y1 - oy) * dx) / denom;
    if (t <= 1e-6 || s < 0 || s > 1) return null;
    return { t: t, point: { x: ox + t * dx, y: oy + t * dy }, s: s };
  }

  function intersectArcRay(cx, cy, r, startAngle, endAngle, ox, oy, dx, dy) {
    var fx = ox - cx, fy = oy - cy;
    var a = dx * dx + dy * dy;
    var b = 2 * (fx * dx + fy * dy);
    var c = fx * fx + fy * fy - r * r;
    var disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    disc = Math.sqrt(disc);
    var t1 = (-b - disc) / (2 * a), t2 = (-b + disc) / (2 * a);
    var ax = cx + r * Math.cos(startAngle), ay = cy + r * Math.sin(startAngle);
    var bx = cx + r * Math.cos(endAngle), by = cy + r * Math.sin(endAngle);
    var cdx = bx - ax, cdy = by - ay;
    var crossCenter = cdx * (cy - ay) - cdy * (cx - ax);
    var bestHit = null;
    var ts = [t1, t2];
    for (var i = 0; i < ts.length; i++) {
      var t = ts[i];
      if (t <= 1e-6) continue;
      var px = ox + t * dx, py = oy + t * dy;
      var crossP = cdx * (py - ay) - cdy * (px - ax);
      if (crossP * crossCenter <= 0) {
        if (!bestHit || t < bestHit.t) bestHit = { t: t, point: { x: px, y: py } };
      }
    }
    return bestHit;
  }

  function normalAtLine(x1, y1, x2, y2) {
    var lx = x2 - x1, ly = y2 - y1;
    var len = Math.sqrt(lx * lx + ly * ly);
    return { nx: -ly / len, ny: lx / len };
  }

  function normalAtArc(cx, cy, px, py) {
    var dx = px - cx, dy = py - cy;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-8) return { nx: 0, ny: 1 };
    return { nx: dx / len, ny: dy / len };
  }

  function reflect(dx, dy, nx, ny) {
    var dot = dx * nx + dy * ny;
    return { dx: dx - 2 * dot * nx, dy: dy - 2 * dot * ny };
  }

  function refractSimple(dx, dy, nx, ny, n1, n2) {
    var cos1 = -(dx * nx + dy * ny);
    var ratio = n1 / n2;
    var sin2Sq = ratio * ratio * (1 - cos1 * cos1);
    if (sin2Sq > 1) return null;
    var cos2 = Math.sqrt(1 - sin2Sq);
    var factor = ratio * cos1 - cos2;
    return { dx: ratio * dx + factor * nx, dy: ratio * dy + factor * ny };
  }

  function flipNormalTowardRay(nx, ny, dx, dy) {
    if (dx * nx + dy * ny > 0) return { nx: -nx, ny: -ny };
    return { nx: nx, ny: ny };
  }

  function extendRay(ox, oy, dx, dy, maxLen) {
    var t = maxLen || 2000;
    var bounds = [
      { x: 0, y: 0, nx: -1, ny: 0 }, { x: W, y: 0, nx: 1, ny: 0 },
      { x: 0, y: 0, nx: 0, ny: -1 }, { x: 0, y: H, nx: 0, ny: 1 }
    ];
    for (var i = 0; i < bounds.length; i++) {
      var b = bounds[i];
      var denom = dx * b.nx + dy * b.ny;
      if (Math.abs(denom) < 1e-8) continue;
      var tb = ((b.x - ox) * b.nx + (b.y - oy) * b.ny) / denom;
      if (tb > 1e-6 && tb < t) t = tb;
    }
    return { x: ox + dx * t, y: oy + dy * t };
  }

  // 返回 { segments:[{x1,y1,x2,y2}], hits:[{x,y,nx,ny,din,dout,kind}], spots:[…] }
  // opt = { lambda } —— 传了波长就走色散折射率；不传则与 2D 版完全一致。
  function traceRay(ox, oy, dx, dy, components, depth, colorIdx, currentN, acc, opt) {
    if (!acc) acc = { segments: [], hits: [], spots: [] };
    if (!acc.spots) acc.spots = [];
    if (depth > 12) return acc;
    if (currentN === undefined) currentN = 1.0;
    var lambdaNm = opt && opt.lambda;

    var bestT = Infinity, bestSurf = null, bestPoint = null, bestNormal = null;
    for (var ci = 0; ci < components.length; ci++) {
      var comp = components[ci];
      if (SOURCE_TYPES[comp.type]) continue;
      var surfaces = getSurfaces(comp, lambdaNm);
      for (var si = 0; si < surfaces.length; si++) {
        var surf = surfaces[si];
        var hit = null, nrm = null;
        if (surf.kind === 'line') {
          hit = intersectLineRay(surf.x1, surf.y1, surf.x2, surf.y2, ox, oy, dx, dy);
          if (hit) nrm = normalAtLine(surf.x1, surf.y1, surf.x2, surf.y2);
        } else if (surf.kind === 'arc') {
          hit = intersectArcRay(surf.cx, surf.cy, surf.r, surf.startAngle, surf.endAngle, ox, oy, dx, dy);
          if (hit) nrm = normalAtArc(surf.cx, surf.cy, hit.point.x, hit.point.y);
        }
        if (hit && hit.t < bestT - 1e-6) {
          bestT = hit.t; bestSurf = surf; bestPoint = hit.point; bestNormal = nrm;
        }
      }
    }

    if (!bestSurf) {
      var end = extendRay(ox, oy, dx, dy, 2000);
      acc.segments.push({ x1: ox, y1: oy, x2: end.x, y2: end.y });
      return acc;
    }

    acc.segments.push({ x1: ox, y1: oy, x2: bestPoint.x, y2: bestPoint.y });
    acc.hits.push({ x: bestPoint.x, y: bestPoint.y, nx: bestNormal.nx, ny: bestNormal.ny });
    var rec = acc.hits[acc.hits.length - 1];
    rec.din = { dx: dx, dy: dy };
    rec.lambda = lambdaNm || null;

    if (bestSurf.isScreen) {
      // 光屏吸收：光线到此为止（不反射、不折射），只留一个亮斑
      rec.kind = 'screen'; rec.dout = null;
      acc.spots.push({ x: bestPoint.x, y: bestPoint.y, color: lambdaNm ? lambdaColor(lambdaNm) : RAY_COLORS[colorIdx % RAY_COLORS.length] });
      return acc;
    }

    if (bestSurf.isMirror) {
      var r = reflect(dx, dy, bestNormal.nx, bestNormal.ny);
      rec.kind = 'mirror'; rec.dout = { dx: r.dx, dy: r.dy };
      return traceRay(bestPoint.x, bestPoint.y, r.dx, r.dy, components, depth + 1, colorIdx, currentN, acc, opt);
    }
    var n1 = bestSurf.n1, n2 = bestSurf.n2, fromN, toN;
    if (Math.abs(currentN - n1) < 0.01) { fromN = n1; toN = n2; }
    else { fromN = n2; toN = n1; }
    var n = flipNormalTowardRay(bestNormal.nx, bestNormal.ny, dx, dy);
    var ref = refractSimple(dx, dy, n.nx, n.ny, fromN, toN);
    if (ref) {
      rec.kind = 'refract'; rec.dout = { dx: ref.dx, dy: ref.dy };
      return traceRay(bestPoint.x, bestPoint.y, ref.dx, ref.dy, components, depth + 1, colorIdx, toN, acc, opt);
    }
    var rr = reflect(dx, dy, bestNormal.nx, bestNormal.ny);
    rec.kind = 'tir'; rec.dout = { dx: rr.dx, dy: rr.dy };
    return traceRay(bestPoint.x, bestPoint.y, rr.dx, rr.dy, components, depth + 1, colorIdx, currentN, acc, opt);
  }

  // ================================================================
  //  three.js 渲染层
  // ================================================================
  var canvas = document.getElementById('simCanvas');
  var wrapEl = canvas.parentElement;

  // preserveDrawingBuffer: 自检/出图要在 render 之后把画布读回来（否则缓冲区已被合成清空，
  // toDataURL 只能拿到一张白图）。教学页对这点性能开销不敏感。
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x020617, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.shadowMap.enabled = false;   // 用「假接触阴影」代替实时阴影（快、且 swiftshader 下稳定）

  var scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x050b16, 34, 96);
  var camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
  var LOOK_AT = new THREE.Vector3(0, -1.55, 0);   // 注视点：略低于光轴，让台面进画面

  scene.add(new THREE.HemisphereLight(0xdff1fb, 0x1b2a3a, 1.35));
  var keyLight = new THREE.DirectionalLight(0xfff4e4, 1.9); keyLight.position.set(9, 15, 13); scene.add(keyLight);
  var rimLight = new THREE.DirectionalLight(0x7cc6ff, 1.0); rimLight.position.set(-11, -6, -12); scene.add(rimLight);
  var topLight = new THREE.DirectionalLight(0xcfe8ff, 0.75); topLight.position.set(0, 20, -4); scene.add(topLight);

  // 环境贴图（给玻璃/金属反光用）—— 一张渐变 canvas 过 PMREM，失败就退回无环境
  var envTex = null;
  (function makeEnv() {
    try {
      var c = document.createElement('canvas'); c.width = 256; c.height = 128;
      var g = c.getContext('2d');
      var grd = g.createLinearGradient(0, 0, 0, 128);
      grd.addColorStop(0, '#d8ecff'); grd.addColorStop(0.42, '#4f7392');
      grd.addColorStop(0.66, '#22303f'); grd.addColorStop(1, '#0a1018');
      g.fillStyle = grd; g.fillRect(0, 0, 256, 128);
      // 两盏「摄影灯」高光，让金属立柱有明确的高光条
      g.fillStyle = 'rgba(255,255,255,0.95)';
      g.beginPath(); g.ellipse(66, 26, 40, 15, 0, 0, 7); g.fill();
      g.beginPath(); g.ellipse(196, 44, 26, 10, 0, 0, 7); g.fill();
      var tex = new THREE.CanvasTexture(c);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      var pmrem = new THREE.PMREMGenerator(renderer);
      envTex = pmrem.fromEquirectangular(tex).texture;
      pmrem.dispose(); tex.dispose();
      scene.environment = envTex;
    } catch (e) { envTex = null; scene.environment = null; }
  })();

  var compGroup = new THREE.Group(); scene.add(compGroup);     // 元件本体（随角度旋转）
  var mountGroup = new THREE.Group(); scene.add(mountGroup);   // 支架（只随 x 平移，绝不旋转）
  var rayGroup = new THREE.Group(); scene.add(rayGroup);       // 光线内芯
  var glowGroup = new THREE.Group(); scene.add(glowGroup);     // 光线辉光外套
  var normalGroup = new THREE.Group(); scene.add(normalGroup);
  var annotGroup = new THREE.Group(); scene.add(annotGroup);   // 角度标注（弧 + 数字）
  var spotGroup = new THREE.Group(); scene.add(spotGroup);     // 光屏亮斑
  var gridGroup = new THREE.Group(); scene.add(gridGroup);     // 工作平面框 + 光轴
  var benchGroup = new THREE.Group(); scene.add(benchGroup);   // 光学实验台

  // ---- 材质 ----
  function markShared(m) { m.userData.shared = true; return m; }

  function glassMat() {
    return new THREE.MeshPhysicalMaterial({
      color: 0xbfe4ff, metalness: 0.0, roughness: 0.06,
      transmission: envTex ? 0.86 : 0, thickness: 1.2, ior: Math.max(1.0, state.n),
      transparent: true, opacity: 0.62, side: THREE.DoubleSide,
      envMapIntensity: 1.35, clearcoat: 0.6, clearcoatRoughness: 0.06
    });
  }
  var mirrorMat = markShared(new THREE.MeshStandardMaterial({ color: 0xd7e6f5, metalness: 0.94, roughness: 0.10, side: THREE.DoubleSide, envMapIntensity: 1.2 }));
  var laserMat = markShared(new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.72, roughness: 0.30, envMapIntensity: 1.0 }));
  var screenMat = markShared(new THREE.MeshStandardMaterial({ color: 0xe6edf5, metalness: 0.0, roughness: 0.94 }));
  var emissiveMat = markShared(new THREE.MeshBasicMaterial({ color: 0xff4d4d }));
  var selectMat = markShared(new THREE.MeshBasicMaterial({ color: SELECT_COLOR, transparent: true, opacity: 0.28, side: THREE.DoubleSide }));

  // 支架材质（缓存复用 —— 每次 rebuild 都新建材质是纯泄漏）
  var mountMats = null;
  function mountMaterials() {
    if (mountMats) return mountMats;
    mountMats = {
      base: markShared(new THREE.MeshStandardMaterial({ color: 0x2b3a4d, metalness: 0.86, roughness: 0.36, envMapIntensity: 0.95 })),
      post: markShared(new THREE.MeshStandardMaterial({ color: 0x9aabbf, metalness: 0.92, roughness: 0.24, envMapIntensity: 1.15 })),
      holder: markShared(new THREE.MeshStandardMaterial({ color: 0x3c4a5c, metalness: 0.80, roughness: 0.42 })),
      sel: markShared(new THREE.MeshStandardMaterial({ color: 0x0e7490, emissive: 0x06b6d4, emissiveIntensity: 0.85, metalness: 0.55, roughness: 0.35 }))
    };
    return mountMats;
  }

  // ---- 元件 2D 轮廓（局部坐标，px）→ 闭合点列 ----
  function sampleArc(cx, cy, r, a0, a1, n) {
    var pts = [];
    for (var i = 0; i <= n; i++) {
      var t = a0 + (a1 - a0) * i / n;
      pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
    }
    return pts;
  }
  // 🔴 角度必须归一化到 [0, 2π)：否则「从 -2.74 递增到 +2.74」会经过 0（右半圆）
  //    而不是经过 π（左半圆）—— 凸透镜会被画成一个球（实测踩过）。
  function norm2pi(a) {
    while (a < 0) a += Math.PI * 2;
    while (a >= Math.PI * 2) a -= Math.PI * 2;
    return a;
  }

  function outlineOf(comp) {
    var pts = [];
    switch (comp.type) {
      case 'flat_mirror': {
        var L = (comp.mirrorLen || 120) / 2, th = 3.5;
        return [[-th, -L], [th, -L], [th, L], [-th, L]];
      }
      case 'concave_mirror': {
        var R = comp.mirrorR || 150, span = comp.mirrorSpan || Math.PI / 3, th2 = 5;
        var outer = sampleArc(-R, 0, R, -span / 2, span / 2, 24);
        var inner = sampleArc(-R, 0, R - th2, span / 2, -span / 2, 24);
        return outer.concat(inner);
      }
      case 'convex_mirror': {
        var R2 = comp.mirrorR || 150, sp2 = comp.mirrorSpan || Math.PI / 3, th3 = 5;
        var o2 = sampleArc(R2, 0, R2, Math.PI - sp2 / 2, Math.PI + sp2 / 2, 24);
        var i2 = sampleArc(R2, 0, R2 - th3, Math.PI + sp2 / 2, Math.PI - sp2 / 2, 24);
        return o2.concat(i2);
      }
      case 'glass_block': {
        var hw = (comp.blockW || 100) / 2, hh = (comp.blockH || 60) / 2;
        return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
      }
      case 'prism': {
        var s = comp.prismSide || 80, ph = s * Math.sqrt(3) / 2;
        return [[0, -ph * 2 / 3], [-s / 2, ph / 3], [s / 2, ph / 3]];
      }
      case 'screen': {
        var sw = (comp.screenW || 60) / 2, sh = (comp.screenH || 240) / 2;
        return [[-sw, -sh], [sw, -sh], [sw, sh], [-sw, sh]];
      }
      case 'convex_lens': {
        var lh = (comp.lensH || 120) / 2, lR = comp.lensR || 160, lw = (comp.lensW || 12) / 2;
        var d = Math.sqrt(Math.max(lR * lR - lh * lh, 0));
        // 左弧：圆心在镜片内部右侧 ⇒ 弧经过最左点（norm2pi 把下端点抬到 3.5 rad，再递减到 2.7 rad）
        var left = sampleArc(-lw + d, 0, lR, norm2pi(Math.atan2(-lh, -d)), Math.atan2(lh, -d), 20);
        // 右弧：圆心在镜片内部左侧 ⇒ 弧经过最右点（-0.4 → +0.4 本来就经过 0）
        var right = sampleArc(lw - d, 0, lR, Math.atan2(-lh, d), Math.atan2(lh, d), 20).reverse();
        return left.concat(right);
      }
      case 'concave_lens': {
        var ch = (comp.lensH || 120) / 2, cR = comp.lensR || 400, cw = (comp.lensW || 12) / 2;
        var cd = Math.sqrt(Math.max(cR * cR - ch * ch, 0));
        // 左弧：圆心在镜片左侧外面 ⇒ 弧经过最右点（-0.15 → +0.15 经过 0）
        var cl = sampleArc(-cw - cd, 0, cR, Math.atan2(-ch, cd), Math.atan2(ch, cd), 20);
        // 右弧：圆心在镜片右侧外面 ⇒ 弧经过最左点（需归一化：2.99 → 3.29）
        var cr = sampleArc(cw + cd, 0, cR, Math.atan2(ch, -cd), norm2pi(Math.atan2(-ch, -cd)), 20);
        return cl.concat(cr);
      }
      case 'laser_single':
      case 'laser_triple': {
        var bw = 34, bh = 15;
        return [[-bw / 2, -bh / 2], [bw / 2, -bh / 2], [bw / 2, bh / 2], [-bw / 2, bh / 2]];
      }
      case 'white_light': {
        var ww = 46, wh = 19;
        return [[-ww / 2, -wh / 2], [ww / 2, -wh / 2], [ww / 2, wh / 2], [-ww / 2, wh / 2]];
      }
    }
    return pts;
  }

  function depthOf(comp) {
    switch (comp.type) {
      case 'flat_mirror': return 7;
      case 'concave_mirror': case 'convex_mirror': return 10;
      case 'glass_block': return 46;
      case 'prism': return 46;
      case 'screen': return 6;
      case 'convex_lens': case 'concave_lens': return (comp.lensW || 12) * 1.9;
      case 'white_light': return 20;
      default: return 16;
    }
  }

  // 元件在世界里的半高（支架要用它算立柱顶到哪）
  function elemHalfH(comp) {
    switch (comp.type) {
      case 'flat_mirror': return (comp.mirrorLen || 120) / 2 * S;
      case 'glass_block': return (comp.blockH || 60) / 2 * S;
      case 'prism': return (comp.prismSide || 80) * Math.sqrt(3) / 3 * S;
      case 'convex_lens': case 'concave_lens': return (comp.lensH || 120) / 2 * S;
      case 'concave_mirror': case 'convex_mirror': return (comp.mirrorR || 150) * Math.sin((comp.mirrorSpan || Math.PI / 3) / 2) * S;
      case 'screen': return (comp.screenH || 240) / 2 * S;
      case 'white_light': return 19 / 2 * S;
      default: return 15 / 2 * S;
    }
  }

  function makeCompMesh(comp) {
    var group = new THREE.Group();
    var pts = outlineOf(comp);
    var depth = depthOf(comp);
    var isGlass = !!GLASS_TYPES[comp.type];
    var isMirror = /mirror/.test(comp.type);
    var mat = isMirror ? mirrorMat : (isGlass ? glassMat() : (comp.type === 'screen' ? screenMat : laserMat));

    if (pts.length >= 3) {
      var shape = new THREE.Shape();
      for (var i = 0; i < pts.length; i++) {
        var v = local3D(pts[i][0], pts[i][1]);
        if (i === 0) shape.moveTo(v.x, v.y); else shape.lineTo(v.x, v.y);
      }
      shape.closePath();
      var geo = new THREE.ExtrudeGeometry(shape, { depth: depth * S, bevelEnabled: false, curveSegments: 1 });
      geo.translate(0, 0, -depth * S / 2);
      var mesh = new THREE.Mesh(geo, mat);
      mesh.userData.compId = comp.id;
      group.add(mesh);

      // 光屏：加一圈金属边框，看起来才像一块真的屏
      if (comp.type === 'screen') {
        var frame = new THREE.LineSegments(
          new THREE.EdgesGeometry(geo, 30),
          new THREE.LineBasicMaterial({ color: 0x8fa6b8 })
        );
        group.add(frame);
      }
    }

    if (SOURCE_TYPES[comp.type]) {
      var isWhite = (comp.type === 'white_light');
      var bodyLen = (isWhite ? 46 : 34) * S;
      // 激光器外壳（圆柱管）—— 让它像一支真的激光笔/激光管
      var shell = new THREE.Mesh(
        new THREE.CylinderGeometry(0.135, 0.155, bodyLen * 0.92, 20),
        laserMat
      );
      shell.rotation.z = Math.PI / 2;
      shell.position.set(-0.04, 0, 0);
      shell.userData.compId = comp.id;
      group.add(shell);

      var tipMat = isWhite ? markShared(new THREE.MeshBasicMaterial({ color: 0xffffff })) : emissiveMat;
      var tip = new THREE.Mesh(new THREE.SphereGeometry(isWhite ? 0.13 : 0.12, 14, 12), tipMat);
      tip.position.set(bodyLen * 0.5, 0, 0);
      group.add(tip);

      // 出光口的光晕（Sprite，不参与拾取）
      var halo = makeGlowSprite(isWhite ? 0xfff6e0 : 0xff6b6b, isWhite ? 0.9 : 0.72);
      halo.position.set(bodyLen * 0.5 + 0.05, 0, 0);
      group.add(halo);

      var pl = new THREE.PointLight(isWhite ? 0xfff0d0 : 0xff5555, isWhite ? 1.0 : 0.7, 3.6);
      pl.position.copy(tip.position);
      group.add(pl);
    }

    if (comp.id === state.selectedId) {
      var outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(group.children[0].geometry, 22),
        new THREE.LineBasicMaterial({ color: SELECT_COLOR })
      );
      outline.userData.isSelectionOutline = true;
      group.add(outline);
    }

    var p = to3D(comp.x, comp.y, 0);
    group.position.set(p.x, p.y, 0);
    group.rotation.z = -comp.angle;
    group.userData.compId = comp.id;
    return group;
  }

  // ---- 元件支架：底座 + 支柱夹 + 立柱 + 元件夹（不随元件旋转） ----
  function makeMount(comp) {
    var g = new THREE.Group();
    var m = mountMaterials();
    var selected = (comp.id === state.selectedId);
    var w = to3D(comp.x, comp.y, 0);
    g.position.set(w.x, 0, 0);

    function tag(o, part) { o.userData.compId = comp.id; o.userData.part = part; return o; }

    var base = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.16, 0.78), selected ? m.sel : m.base);
    base.position.set(0, BENCH_TOP + 0.08, 0);
    g.add(tag(base, 'base'));

    var holder = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.155, 0.34, 18), selected ? m.sel : m.holder);
    holder.position.set(0, BENCH_TOP + 0.16 + 0.17, 0);
    g.add(tag(holder, 'holder'));

    var eh = elemHalfH(comp);
    var postBot = BENCH_TOP + 0.50;
    var postTop = w.y - eh - 0.12;
    var len = postTop - postBot;
    if (len > 0.18) {
      var post = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, len, 12), selected ? m.sel : m.post);
      post.position.set(0, postBot + len / 2, 0);
      post.userData.len = len;
      g.add(tag(post, 'post'));
    }

    var clampY = Math.max(BENCH_TOP + 0.26, w.y - eh - 0.06);
    var clamp = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.16, 0.60), selected ? m.sel : m.holder);
    clamp.position.set(0, clampY, 0);
    g.add(tag(clamp, 'clamp'));

    g.userData.compId = comp.id;
    return g;
  }

  // ---- 辉光 Sprite（加性）----
  var glowSpriteTex = null;
  function glowTexture() {
    if (glowSpriteTex) return glowSpriteTex;
    var c = document.createElement('canvas'); c.width = c.height = 64;
    var g = c.getContext('2d');
    var grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.28, 'rgba(255,255,255,0.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    glowSpriteTex = new THREE.CanvasTexture(c);
    glowSpriteTex.colorSpace = THREE.SRGBColorSpace;
    return glowSpriteTex;
  }
  function makeGlowSprite(colorHex, size) {
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: colorHex, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    sp.scale.set(size, size, 1);
    sp.userData.baseW = size; sp.userData.baseH = size;
    sp.renderOrder = 18;
    return sp;
  }

  // ---- 光学实验台 ----
  function makeHoleTexture() {
    var c = document.createElement('canvas'); c.width = c.height = 128;
    var g = c.getContext('2d');
    g.fillStyle = '#1d2a3a'; g.fillRect(0, 0, 128, 128);
    // 轻微的拉丝质感
    for (var i = 0; i < 128; i += 2) {
      g.fillStyle = 'rgba(255,255,255,' + (0.012 + 0.012 * ((i * 37) % 7) / 7) + ')';
      g.fillRect(0, i, 128, 1);
    }
    // M6 螺纹孔阵列（每个贴图块 4×4 个孔）
    for (var gy = 0; gy < 4; gy++) {
      for (var gx = 0; gx < 4; gx++) {
        var px = 16 + gx * 32, py = 16 + gy * 32;
        var grd = g.createRadialGradient(px - 2, py - 2, 0.5, px, py, 9);
        grd.addColorStop(0, '#060a11');
        grd.addColorStop(0.62, '#0b121c');
        grd.addColorStop(0.86, '#3d5266');
        grd.addColorStop(1, '#22303f');
        g.fillStyle = grd;
        g.beginPath(); g.arc(px, py, 9, 0, 7); g.fill();
      }
    }
    var tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  function makeRulerTexture() {
    var pxPerCm = 40;
    var c = document.createElement('canvas');
    c.width = BENCH_CM * pxPerCm; c.height = 128;
    var g = c.getContext('2d');
    g.fillStyle = '#0a1320'; g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = 'rgba(159,216,234,0.85)';
    g.fillStyle = '#cfe8f7';
    g.font = 'bold 30px Inter, "PingFang SC", "Microsoft YaHei", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'top';
    g.lineWidth = 2;
    for (var cm = 0; cm <= BENCH_CM; cm++) {
      var x = cm * pxPerCm + 0.5;
      var h = (cm % 5 === 0) ? 30 : 16;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
      if (cm % 5 === 0) g.fillText(String(cm), x, 36);
    }
    // 每 5 cm 一条半高线，方便对位
    g.strokeStyle = 'rgba(159,216,234,0.45)';
    for (var cm2 = 0; cm2 <= BENCH_CM; cm2 += 5) {
      g.beginPath(); g.moveTo(cm2 * pxPerCm + 0.5, 0); g.lineTo(cm2 * pxPerCm + 0.5, 46); g.stroke();
    }
    var tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function makeFloorTexture() {
    var c = document.createElement('canvas'); c.width = c.height = 256;
    var g = c.getContext('2d');
    g.fillStyle = '#070d17'; g.fillRect(0, 0, 256, 256);
    var grd = g.createRadialGradient(128, 128, 4, 128, 128, 128);
    grd.addColorStop(0, 'rgba(56,110,160,0.34)');
    grd.addColorStop(0.45, 'rgba(28,58,90,0.16)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
    var tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function makeBackdropTexture() {
    var c = document.createElement('canvas'); c.width = 64; c.height = 256;
    var g = c.getContext('2d');
    var grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, '#060d1a');
    grd.addColorStop(0.34, '#0d1b2e');
    grd.addColorStop(0.52, '#16324c');
    grd.addColorStop(0.72, '#0a1524');
    grd.addColorStop(1, '#03070d');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 256);
    var tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function buildBench() {
    clearGroup(benchGroup);
    var bw = HALF_W * 2 + BENCH_PAD * 2;      // 台面宽
    var bd = BENCH_HALF_Z * 2;                // 台面深
    var holeTex = makeHoleTexture();
    var cellWorld = 0.5;                      // 25 mm 孔距（每个贴图块 4×4 孔）
    holeTex.repeat.set(bw / (cellWorld * 4), bd / (cellWorld * 4));

    var topMat = new THREE.MeshStandardMaterial({ color: 0x8ea2b8, metalness: 0.74, roughness: 0.42, map: holeTex, envMapIntensity: 0.95 });
    var sideMat = new THREE.MeshStandardMaterial({ color: 0x141f2c, metalness: 0.86, roughness: 0.32, envMapIntensity: 0.9 });
    var plate = new THREE.Mesh(new THREE.BoxGeometry(bw, BENCH_T, bd),
      [sideMat, sideMat, topMat, sideMat, sideMat, sideMat]);
    plate.position.set(0, BENCH_TOP - BENCH_T / 2, 0);
    plate.userData.part = 'plate';
    benchGroup.add(plate);

    // 台面金属边框（沿四周一圈细梁，让板看起来是厚实的阳极氧化铝）
    var railMat = markShared(new THREE.MeshStandardMaterial({ color: 0x2f4152, metalness: 0.9, roughness: 0.26, envMapIntensity: 1.1 }));
    function rail(w, h, d, x, y, z) {
      var r = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), railMat);
      r.position.set(x, y, z);
      benchGroup.add(r);
    }
    var railY = BENCH_TOP + 0.035;
    rail(bw, 0.07, 0.09, 0, railY, bd / 2 - 0.045);
    rail(bw, 0.07, 0.09, 0, railY, -bd / 2 + 0.045);
    rail(0.09, 0.07, bd, bw / 2 - 0.045, railY, 0);
    rail(0.09, 0.07, bd, -bw / 2 + 0.045, railY, 0);

    // 前沿刻度尺（0 ~ 35 cm，与光学平面严格对齐：x=0px ⇒ 0 cm）
    var rulerTex = makeRulerTexture();
    var ruler = new THREE.Mesh(
      new THREE.BoxGeometry(HALF_W * 2, 0.40, 0.05),
      [sideMat, sideMat, sideMat, sideMat,
        new THREE.MeshBasicMaterial({ map: rulerTex }), sideMat]
    );
    ruler.position.set(0, BENCH_TOP - 0.20, BENCH_HALF_Z + 0.035);
    ruler.userData.part = 'ruler';
    benchGroup.add(ruler);

    // 支腿（4 根）+ 横撑 + 调节脚
    var legMat = markShared(new THREE.MeshStandardMaterial({ color: 0x1c2a38, metalness: 0.82, roughness: 0.4 }));
    var footMat = markShared(new THREE.MeshStandardMaterial({ color: 0x0e1721, metalness: 0.5, roughness: 0.65 }));
    var lx = bw / 2 - 0.55, lz = bd / 2 - 0.42;
    var corners = [[lx, lz], [-lx, lz], [lx, -lz], [-lx, -lz]];
    for (var i = 0; i < corners.length; i++) {
      var leg = new THREE.Mesh(new THREE.BoxGeometry(0.26, LEG_H, 0.26), legMat);
      leg.position.set(corners[i][0], BENCH_BOT - LEG_H / 2, corners[i][1]);
      benchGroup.add(leg);
      var foot = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.13, 0.10, 14), footMat);
      foot.position.set(corners[i][0], FLOOR_Y + 0.05, corners[i][1]);
      benchGroup.add(foot);
    }
    // 前后两根长横撑
    rail(bw - 1.2, 0.14, 0.14, 0, BENCH_BOT - LEG_H * 0.34, lz);
    rail(bw - 1.2, 0.14, 0.14, 0, BENCH_BOT - LEG_H * 0.34, -lz);
    // 左右两根短横撑
    rail(0.14, 0.14, bd - 0.9, lx, BENCH_BOT - LEG_H * 0.72, 0);
    rail(0.14, 0.14, bd - 0.9, -lx, BENCH_BOT - LEG_H * 0.72, 0);

    // 假接触阴影：台面正下方一块径向渐变暗斑（比实时阴影便宜且稳定）
    var shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(bw * 1.5, bd * 3.2),
      new THREE.MeshBasicMaterial({ map: makeFloorTexture(), transparent: true, opacity: 0.55, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0, FLOOR_Y + 0.012, 0);
    shadow.userData.part = 'shadow';
    benchGroup.add(shadow);

    // 地面
    var floor = new THREE.Mesh(
      new THREE.PlaneGeometry(90, 90),
      new THREE.MeshStandardMaterial({ color: 0x0b1420, metalness: 0.42, roughness: 0.55, map: makeFloorTexture(), envMapIntensity: 0.55 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, FLOOR_Y, 0);
    floor.userData.part = 'floor';
    benchGroup.add(floor);

    // 背景穹顶（BackSide 渐变球；fog:false 免得被雾吃掉）
    var dome = new THREE.Mesh(
      new THREE.SphereGeometry(110, 32, 20),
      new THREE.MeshBasicMaterial({ map: makeBackdropTexture(), side: THREE.BackSide, fog: false })
    );
    dome.userData.part = 'dome';
    benchGroup.add(dome);
  }

  // ---- 工作平面框 + 光轴 ----
  function buildGrid() {
    clearGroup(gridGroup);
    var step = 40;
    var lineMat = markShared(new THREE.LineBasicMaterial({ color: 0x24557f, transparent: true, opacity: 0.42 }));
    var verts = [];
    for (var x = 0; x <= W; x += step) {
      var a = to3D(x, 0), b = to3D(x, H);
      verts.push(a.x, a.y, 0, b.x, b.y, 0);
    }
    for (var y = 0; y <= H; y += step) {
      var c = to3D(0, y), d = to3D(W, y);
      verts.push(c.x, c.y, 0, d.x, d.y, 0);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    gridGroup.add(new THREE.LineSegments(geo, lineMat));

    var frameMat = markShared(new THREE.LineBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.5 }));
    var c0 = to3D(0, 0), c1 = to3D(W, 0), c2 = to3D(W, H), c3 = to3D(0, H);
    var fv = [c0.x, c0.y, 0, c1.x, c1.y, 0, c1.x, c1.y, 0, c2.x, c2.y, 0,
      c2.x, c2.y, 0, c3.x, c3.y, 0, c3.x, c3.y, 0, c0.x, c0.y, 0];
    var fgeo = new THREE.BufferGeometry();
    fgeo.setAttribute('position', new THREE.Float32BufferAttribute(fv, 3));
    gridGroup.add(new THREE.LineSegments(fgeo, frameMat));

    // 光轴（2D y = H/2 那一行）—— 虚线感：分段画
    var axisMat = markShared(new THREE.LineBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.75 }));
    var av = [];
    for (var ax = 0; ax < W; ax += 24) {
      var p1 = to3D(ax, AXIS_2D_Y), p2 = to3D(Math.min(ax + 13, W), AXIS_2D_Y);
      av.push(p1.x, p1.y, 0, p2.x, p2.y, 0);
    }
    var ageo = new THREE.BufferGeometry();
    ageo.setAttribute('position', new THREE.Float32BufferAttribute(av, 3));
    gridGroup.add(new THREE.LineSegments(ageo, axisMat));
  }

  // ---- 文字标签（Sprite，每帧按相机距离归一化） ----
  var LABEL_PX_H = 48;
  var LABEL_GLYPH_PX = 34;
  var LABEL_FONT = 'bold ' + LABEL_GLYPH_PX + 'px Inter, "PingFang SC", "Microsoft YaHei", sans-serif';
  var labelSprites = [];
  var measureCtx = document.createElement('canvas').getContext('2d');

  function makeTextSprite(text, color, glyphH) {
    measureCtx.font = LABEL_FONT;
    var tw = Math.max(46, Math.ceil(measureCtx.measureText(text).width) + 18);
    var c = document.createElement('canvas'); c.width = tw; c.height = LABEL_PX_H;
    var g = c.getContext('2d');
    g.font = LABEL_FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = color || '#cfe8f7';
    g.fillText(text, tw / 2, LABEL_PX_H / 2 + 1);
    var tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
    var Hw = (glyphH || 0.34) * LABEL_PX_H / LABEL_GLYPH_PX;
    sp.scale.set(Hw * tw / LABEL_PX_H, Hw, 1);
    sp.userData.baseW = sp.scale.x;
    sp.userData.baseH = Hw;
    sp.userData.text = text;
    sp.renderOrder = 30;
    labelSprites.push(sp);
    return sp;
  }

  // 🔴 世界锚定的 Sprite 标签必须【每帧按相机距离归一化】—— 否则相机一远，
  //    标签在屏幕上就缩成几个像素（俯视时尤其明显，实测踩过）。
  function updateLabelScales() {
    if (!labelSprites.length) return;
    camera.updateMatrixWorld();
    var ref = cam.dist || 20;
    for (var i = 0; i < labelSprites.length; i++) {
      var sp = labelSprites[i];
      if (!sp.parent) continue;
      var p = new THREE.Vector3();
      sp.getWorldPosition(p);
      var k = p.distanceTo(camera.position) / ref;
      sp.scale.set(sp.userData.baseW * k, sp.userData.baseH * k, 1);
    }
  }

  // 标签在屏幕上的高度（px）—— 供自检「视角不变性」用
  function labelScreenHeights() {
    camera.updateMatrixWorld();
    var rect = canvas.getBoundingClientRect();
    var out = [];
    for (var i = 0; i < labelSprites.length; i++) {
      var sp = labelSprites[i];
      if (!sp.parent) continue;
      var p = new THREE.Vector3();
      sp.getWorldPosition(p);
      var d = p.distanceTo(camera.position);
      var pxPerWorld = (rect.height / 2) / (Math.tan(camera.fov * Math.PI / 360) * d);
      out.push({ text: sp.userData.text, px: sp.scale.y * pxPerWorld });
    }
    return out;
  }

  // ---- 光线 ----
  var lastRayStats = { segments: 0, hits: 0, sources: 0, spots: 0, disp: 0 };

  function disposeObj(o) {
    if (o.isSprite) {
      // 🔴 Sprite 的 geometry 是 three.js 里的【全局共享单例】⇒ 绝不能 dispose
      if (o.material) { if (o.material.map && !o.material.map.userData.shared) o.material.map.dispose(); o.material.dispose(); }
      return;
    }
    if (o.children && o.children.length) {
      for (var i = 0; i < o.children.length; i++) disposeObj(o.children[i]);
    }
    if (o.geometry) o.geometry.dispose();
    var m = o.material;
    if (!m) return;
    if (Array.isArray(m)) {
      for (var k = 0; k < m.length; k++) if (m[k] && !(m[k].userData && m[k].userData.shared)) m[k].dispose();
    } else if (!(m.userData && m.userData.shared)) {
      m.dispose();
    }
  }

  function clearGroup(grp) {
    while (grp.children.length) {
      disposeObj(grp.children.pop());
    }
  }

  function addRaySegment(seg, colorHex) {
    var p1 = to3D(seg.x1, seg.y1, 0), p2 = to3D(seg.x2, seg.y2, 0);
    var dir = new THREE.Vector3().subVectors(p2, p1);
    var len = dir.length();
    if (len < 1e-5) return;
    var q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    var mid = p1.clone().addScaledVector(dir, 0.5);

    var geo = new THREE.CylinderGeometry(RAY_RADIUS, RAY_RADIUS, len, 6, 1, false);
    var mat = new THREE.MeshBasicMaterial({ color: colorHex });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(mid);
    mesh.quaternion.copy(q);
    rayGroup.add(mesh);

    // 辉光外套：真正的激光在空气里是「有光晕的」，只有一根细管会显得像塑料棍
    var ggeo = new THREE.CylinderGeometry(GLOW_RADIUS, GLOW_RADIUS, len, 6, 1, true);
    var gmat = new THREE.MeshBasicMaterial({
      color: colorHex, transparent: true, opacity: GLOW_OPACITY,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    });
    var gm = new THREE.Mesh(ggeo, gmat);
    gm.position.copy(mid);
    gm.quaternion.copy(q);
    gm.renderOrder = 12;
    glowGroup.add(gm);
  }

  // 🔴 法线与角度弧都画在光学平面 z = 0 上 —— 也就是【元件内部】。
  //    玻璃/棱镜的前表面在 z = +厚度/2，不关深度测试就会被整个挡住（实测踩过）。
  //    教学标注属于「叠加层」，一律 depthTest:false + 高 renderOrder。
  var normalLineMat = markShared(new THREE.LineBasicMaterial({ color: NORMAL_COLOR, depthTest: false, transparent: true }));

  function addNormal(h) {
    var len = 26;
    var p1 = to3D(h.x, h.y, 0);
    var p2 = to3D(h.x + h.nx * len, h.y + h.ny * len, 0);
    var geo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    normalGroup.add(new THREE.Line(geo, normalLineMat));
  }

  // 最短弧：把 [a0 → a1] 收敛到 ±π 之内
  function shortArc(a0, a1) {
    var d = a1 - a0;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  // 🔴 弧线【不能】用 THREE.Line —— WebGL 里 linewidth 恒为 1px（各家实现都忽略
  //    更大的值），在高分屏上细到看不见（实测出图确认过）。改用细管（TubeGeometry）。
  var ARC_RADIUS = 0.085;
  function addAngleArc(hx, hy, aFrom, aTo, radius, colorHex) {
    var d = shortArc(aFrom, aTo);
    var pts = [];
    var n = 16;
    for (var i = 0; i <= n; i++) {
      var t = aFrom + d * i / n;
      pts.push(to3D(hx + radius * Math.cos(t), hy + radius * Math.sin(t), 0));
    }
    var curve = new THREE.CatmullRomCurve3(pts);
    var geo = new THREE.TubeGeometry(curve, 18, ARC_RADIUS, 6, false);
    var mat = new THREE.MeshBasicMaterial({ color: colorHex, depthTest: false, transparent: true, opacity: 0.95 });
    var tube = new THREE.Mesh(geo, mat);
    tube.renderOrder = 25;
    annotGroup.add(tube);
    return aFrom + d / 2;
  }

  function buildRays() {
    clearGroup(rayGroup);
    clearGroup(glowGroup);
    clearGroup(normalGroup);
    clearGroup(annotGroup);
    clearGroup(spotGroup);
    labelSprites = [];
    var segs = 0, hits = 0, sources = 0, spots = 0, disp = 0;
    var annotHits = [];

    var sources_ = state.components.filter(function (c) { return SOURCE_TYPES[c.type]; });
    for (var i = 0; i < sources_.length; i++) {
      var src = sources_[i];
      var rays = getSourceRays(src);
      for (var r = 0; r < rays.length; r++) {
        sources++;
        var ray = rays[r];
        var opt = ray.lambda ? { lambda: ray.lambda } : null;
        if (ray.lambda) disp++;
        var acc = traceRay(ray.ox, ray.oy, ray.dx, ray.dy, state.components, 0, ray.color, 1.0, null, opt);
        var col = ray.lambda ? lambdaColor(ray.lambda) : RAY_COLORS[ray.color % RAY_COLORS.length];
        for (var s = 0; s < acc.segments.length; s++) {
          addRaySegment(acc.segments[s], col);
          segs++;
        }
        if (state.showNormals) {
          for (var h = 0; h < acc.hits.length; h++) {
            addNormal(acc.hits[h]);
            hits++;
          }
        } else {
          hits += acc.hits.length;
        }
        // 光屏亮斑
        for (var sp2 = 0; sp2 < acc.spots.length; sp2++) {
          addSpot(acc.spots[sp2]);
          spots++;
        }
        for (var ah = 0; ah < acc.hits.length; ah++) annotHits.push(acc.hits[ah]);
      }
    }
    if (state.showAngles) buildAnnotations(annotHits);
    lastRayStats = { segments: segs, hits: hits, sources: sources, spots: spots, disp: disp };
  }

  function addSpot(spot) {
    var p = to3D(spot.x, spot.y, 0);
    var m = new THREE.Mesh(
      new THREE.CircleGeometry(0.26, 18),
      new THREE.MeshBasicMaterial({ color: spot.color, transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    m.position.set(p.x, p.y, 0.10);
    m.renderOrder = 16;
    spotGroup.add(m);
    var halo = makeGlowSprite(spot.color, 1.0);
    halo.position.set(p.x, p.y, 0.16);
    spotGroup.add(halo);
  }

  // 在每个命中点画【入射角 / 出射角】圆弧 + 数字
  function buildAnnotations(hitList) {
    for (var i = 0; i < hitList.length; i++) {
      var h = hitList[i];
      if (!h.din) continue;
      // 光屏是【吸收面】，没有反射/折射定律可讲 ⇒ 不标注（否则会画出一条 0° 的弧）
      if (h.kind === 'screen') continue;
      // 🔴 normalAtLine 给出的法线方向取决于线段端点顺序（可朝内可朝外），
      //    必须先用入射方向把它翻到「迎着光线」那一侧，角度才是物理入射角。
      //    （不翻的话：光屏那条会显示 90° 而不是 0°，实测踩过。）
      var nUse = flipNormalTowardRay(h.nx, h.ny, h.din.dx, h.din.dy);
      var thetaN = Math.atan2(nUse.ny, nUse.nx);
      var thetaIn = Math.atan2(-h.din.dy, -h.din.dx);
      var dIn = shortArc(thetaN, thetaIn);
      var aIn = Math.abs(dIn);
      var rad1 = 1.05;
      if (aIn > 1e-3) addAngleArc(h.x, h.y, thetaN, thetaIn, rad1, 0xffd166);
      var midIn = thetaN + dIn / 2;
      var lp = to3D(h.x + (rad1 + 0.42) * Math.cos(midIn), h.y + (rad1 + 0.42) * Math.sin(midIn), 0);
      var l1 = makeTextSprite((aIn * 180 / Math.PI).toFixed(0) + '°', '#ffe9a8', 0.46);
      l1.position.copy(lp);
      annotGroup.add(l1);          // 🔴 建了必须挂上去 —— 忘了 add 就是「数得到、看不见」

      if (h.dout) {
        var thetaOut = Math.atan2(h.dout.dy, h.dout.dx);
        // 🔴 出射角的量法与入射角【不同】：入射角量的是「入射反向」与法线的夹角，法线
        //    已被翻到迎着光线那一侧；但【折射光穿过界面、落在法线的另一侧】⇒ 若仍以
        //    thetaN 为起点，得到的是 180°−θ（实测：入射 30° 被标成 150°、19.5° 标成
        //    161°），而且弧会横跨大半个平面。超过 90° 就改以「法线反向」为起点 ——
        //    角度值与弧线位置同时正确。（反射/全反射的出射光与入射光同侧，本来就
        //    ≤90°，不受影响。）
        var fromOut = thetaN;
        var dOut = shortArc(thetaN, thetaOut);
        if (Math.abs(dOut) > Math.PI / 2) { fromOut = thetaN + Math.PI; dOut = shortArc(fromOut, thetaOut); }
        var rad2 = 1.55;
        var col = (h.kind === 'mirror') ? 0x86efac : (h.kind === 'tir' ? 0xfca5a5 : 0x7dd3fc);
        if (Math.abs(dOut) > 1e-3) addAngleArc(h.x, h.y, fromOut, thetaOut, rad2, col);
        var midOut = fromOut + dOut / 2;
        var lp2 = to3D(h.x + (rad2 + 0.42) * Math.cos(midOut), h.y + (rad2 + 0.42) * Math.sin(midOut), 0);
        var l2 = makeTextSprite((Math.abs(dOut) * 180 / Math.PI).toFixed(0) + '°', (h.kind === 'mirror') ? '#bbf7d0' : '#bfe8ff', 0.46);
        l2.position.copy(lp2);
        annotGroup.add(l2);
      }
    }
  }

  // ---- 重建场景 ----
  function rebuildScene() {
    clearGroup(compGroup);
    clearGroup(mountGroup);
    for (var i = 0; i < state.components.length; i++) {
      compGroup.add(makeCompMesh(state.components[i]));
    }
    for (var k = 0; k < state.components.length; k++) {
      mountGroup.add(makeMount(state.components[k]));
    }
    buildRays();
    updatePropPanel();
    updateHUD();
  }

  // ---- 相机 ----
  function sceneEnvelope() {
    // 取景包络用【真实内容点云】：台面（含外扩）与光学平面的并集
    var top = HALF_H;
    var bot = FLOOR_Y;
    var halfW = HALF_W + BENCH_PAD;
    return { top: top, bot: bot, halfW: halfW, cy: (top + bot) / 2 };
  }

  function baseDist() {
    var env = sceneEnvelope();
    var fovY = camera.fov * Math.PI / 180;
    var halfH = (env.top - env.bot) / 2 * 1.16;
    var halfW = env.halfW * 1.10;
    var dV = halfH / Math.tan(fovY / 2);
    var dH = halfW / Math.tan(fovY / 2) / Math.max(camera.aspect, 0.2);
    return Math.max(dV, dH);
  }

  function updateCamera() {
    var d = baseDist() / cam.zoom;
    var cy = Math.sin(cam.pitch), cr = Math.cos(cam.pitch);
    camera.position.set(d * cr * Math.sin(cam.yaw), d * cy, d * cr * Math.cos(cam.yaw));
    camera.lookAt(LOOK_AT);
    cam.dist = d;
  }

  function setView(name) {
    var v = VIEWS[name] || VIEWS.front;
    cam.yaw = v.yaw; cam.pitch = v.pitch;
    state.view = name;
    if (name !== 'orbit') setOrbit(false, true);
    var btns = document.querySelectorAll('.view-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active-view', btns[i].getAttribute('data-view') === name);
    }
    updateCamera();
    updateHUD();
    render();
  }

  // ---- 环绕（360° 自动旋转）----
  var orbitRAF = null, orbitLast = 0;
  function tickOrbit(dt) {
    cam.yaw += ORBIT_SPEED * dt;
    state.view = 'orbit';
    updateCamera();
    render();
    return cam.yaw;
  }
  function orbitLoop(t) {
    if (!state.orbit) { orbitRAF = null; return; }
    if (!orbitLast) orbitLast = t;
    var dt = Math.min(0.05, (t - orbitLast) / 1000);
    orbitLast = t;
    tickOrbit(dt);
    orbitRAF = requestAnimationFrame(orbitLoop);
  }
  function setOrbit(on, silent) {
    state.orbit = !!on;
    orbitLast = 0;
    if (state.orbit) {
      if (orbitRAF === null && typeof requestAnimationFrame === 'function') orbitRAF = requestAnimationFrame(orbitLoop);
    } else if (orbitRAF !== null) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(orbitRAF);
      orbitRAF = null;
    }
    if (!silent) {
      var b = document.getElementById('btnOrbit');
      if (b) b.classList.toggle('active-type', state.orbit);
      updateHUD();
    }
  }

  // ---- 尺寸 ----
  function resize() {
    var cw = Math.max(320, wrapEl.clientWidth - 16);
    var ch = Math.max(260, Math.min(560, Math.round(cw * 0.74)));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(cw, ch, false);
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    camera.aspect = cw / ch;
    camera.updateProjectionMatrix();
    updateCamera();
    render();
  }

  function render() {
    updateLabelScales();
    renderer.render(scene, camera);
  }

  // ---- HUD ----
  function updateHUD() {
    var el = document.getElementById('stageHud');
    if (!el) return;
    var sel = null;
    for (var i = 0; i < state.components.length; i++) {
      if (state.components[i].id === state.selectedId) { sel = state.components[i]; break; }
    }
    var viewName = { front: '正视', angle: '斜视', top: '俯视', side: '侧视', orbit: '环绕', custom: '自由' }[state.view] || state.view;
    var lines = [
      ['元件', String(state.components.length)],
      ['光线', String(lastRayStats.sources)],
      ['光段', String(lastRayStats.segments)],
      ['命中', String(lastRayStats.hits)],
      ['视角', viewName]
    ];
    if (lastRayStats.disp) lines.push(['色散', lastRayStats.disp + ' 波长']);
    if (lastRayStats.spots) lines.push(['亮斑', String(lastRayStats.spots)]);
    var html = lines.map(function (kv) {
      return '<div class="hud-row" data-k="' + kv[0] + '"><span>' + kv[0] + '</span><b>' + kv[1] + '</b></div>';
    }).join('');
    if (sel) {
      html += '<div class="hud-sep"></div>' +
        '<div class="hud-row" data-k="选中"><span>选中</span><b>' + COMP_DEFS[sel.type].name + '</b></div>' +
        '<div class="hud-row" data-k="距左端"><span>距左端</span><b>' + (sel.x / PX_PER_CM).toFixed(1) + ' cm</b></div>' +
        '<div class="hud-row" data-k="离光轴"><span>离光轴</span><b>' + ((AXIS_2D_Y - sel.y) / PX_PER_CM).toFixed(1) + ' cm</b></div>' +
        '<div class="hud-row" data-k="转角"><span>转角</span><b>' + (sel.angle * 180 / Math.PI).toFixed(0) + '°</b></div>';
    }
    el.innerHTML = html;
  }

  // ================================================================
  //  交互
  // ================================================================
  var raycaster = new THREE.Raycaster();
  var ndc = new THREE.Vector2();
  var planeZ0 = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  var dragComp = null, dragOffset = null;
  var orbiting = false, lastPointer = null;

  function pointerNDC(ev) {
    var rect = canvas.getBoundingClientRect();
    ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    return ndc;
  }

  function pickComp(ev) {
    raycaster.setFromCamera(pointerNDC(ev), camera);
    var targets = compGroup.children.concat(mountGroup.children);
    var hits = raycaster.intersectObjects(targets, true);
    for (var i = 0; i < hits.length; i++) {
      var o = hits[i].object;
      while (o && o.userData.compId === undefined) o = o.parent;
      if (o && o.userData.compId !== undefined) {
        var id = o.userData.compId;
        for (var k = 0; k < state.components.length; k++) {
          if (state.components[k].id === id) return state.components[k];
        }
      }
    }
    return null;
  }

  function planePoint(ev) {
    raycaster.setFromCamera(pointerNDC(ev), camera);
    var p = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(planeZ0, p)) return null;
    return { x: p.x / S + W / 2, y: H / 2 - p.y / S };
  }

  function onPointerDown(ev) {
    if (ev.button !== 0) { orbiting = true; lastPointer = { x: ev.clientX, y: ev.clientY }; canvas.setPointerCapture(ev.pointerId); return; }
    var comp = pickComp(ev);
    if (comp) {
      state.selectedId = comp.id;
      var pp = planePoint(ev);
      if (pp) { dragComp = comp; dragOffset = { dx: comp.x - pp.x, dy: comp.y - pp.y }; }
      rebuildScene();
      render();
    } else {
      state.selectedId = null;
      rebuildScene();
      render();
      orbiting = true;
      lastPointer = { x: ev.clientX, y: ev.clientY };
    }
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) { }
  }

  function onPointerMove(ev) {
    if (dragComp) {
      var pp = planePoint(ev);
      if (pp) {
        dragComp.x = Math.max(10, Math.min(W - 10, pp.x + dragOffset.dx));
        dragComp.y = Math.max(MIN_2D_Y, Math.min(MAX_2D_Y, pp.y + dragOffset.dy));
        rebuildScene();
        render();
      }
      return;
    }
    if (orbiting && lastPointer) {
      var dx = ev.clientX - lastPointer.x, dy = ev.clientY - lastPointer.y;
      lastPointer = { x: ev.clientX, y: ev.clientY };
      if (state.orbit) setOrbit(false);
      cam.yaw -= dx * 0.006;
      cam.pitch = Math.max(-1.45, Math.min(1.45, cam.pitch + dy * 0.005));
      state.view = 'custom';
      updateCamera();
      updateHUD();
      render();
    }
  }

  function onPointerUp(ev) {
    dragComp = null; orbiting = false; lastPointer = null;
    try { canvas.releasePointerCapture(ev.pointerId); } catch (e) { }
  }

  function onDoubleClick(ev) {
    var comp = pickComp(ev);
    if (comp) removeCompById(comp.id);
  }

  function onWheel(ev) {
    ev.preventDefault();
    cam.zoom = Math.max(0.45, Math.min(3.2, cam.zoom * (ev.deltaY > 0 ? 0.92 : 1.08)));
    updateCamera(); render();
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('dblclick', onDoubleClick);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  // 键盘：Delete/Backspace 删除选中元件，Esc 取消选中
  // （2D 原版就有这两条，3D 版不能丢）
  window.addEventListener('keydown', function (ev) {
    var t = ev.target;
    var tag = (t && t.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
    if (ev.key === 'Delete' || ev.key === 'Backspace') {
      if (state.selectedId) { ev.preventDefault(); deleteSelected(); }
    } else if (ev.key === 'Escape') {
      if (state.selectedId) { state.selectedId = null; rebuildScene(); render(); }
    }
  });

  // ================================================================
  //  面板
  // ================================================================
  function addComponent(type) {
    if (!COMP_DEFS[type]) return;
    var comp = {
      id: 'c' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      type: type, x: W / 2, y: AXIS_2D_Y, angle: 0, n: state.n
    };
    switch (type) {
      case 'laser_single': case 'laser_triple': case 'white_light': comp.angle = 0; break;
      case 'convex_lens': comp.lensH = 120; comp.lensR = 160; comp.lensW = 12; break;
      case 'concave_lens': comp.lensH = 120; comp.lensR = 400; comp.lensW = 12; break;
      case 'flat_mirror': comp.mirrorLen = 120; break;
      case 'concave_mirror': comp.mirrorR = 150; comp.mirrorSpan = Math.PI / 3; break;
      case 'convex_mirror': comp.mirrorR = 150; comp.mirrorSpan = Math.PI / 3; break;
      case 'glass_block': comp.blockW = 100; comp.blockH = 60; break;
      case 'prism': comp.prismSide = 80; break;
      case 'screen': comp.screenW = 60; comp.screenH = 240; break;
    }
    // 落在台面内、避开已有元件：按螺旋找一个空位
    var placed = false;
    for (var ring = 0; ring < 6 && !placed; ring++) {
      for (var k = 0; k < 8; k++) {
        var ang = k * Math.PI / 4;
        var cx = W / 2 + Math.cos(ang) * ring * 70;
        var cy = AXIS_2D_Y + Math.sin(ang) * ring * 55;
        if (cx < 60 || cx > W - 60 || cy < 50 || cy > MAX_2D_Y - 20) continue;
        var ok = true;
        for (var i = 0; i < state.components.length; i++) {
          var o = state.components[i];
          if (Math.abs(o.x - cx) < 70 && Math.abs(o.y - cy) < 55) { ok = false; break; }
        }
        if (ok) { comp.x = cx; comp.y = cy; placed = true; break; }
      }
    }
    state.components.push(comp);
    state.selectedId = comp.id;
    rebuildScene(); render();
    return comp;
  }

  function clearAll() {
    state.components = [];
    state.selectedId = null;
    rebuildScene(); render();
  }

  // 删掉一个元件（双击 / 🗑 按钮 / Delete 键三条路径共用同一个真源）
  function removeCompById(id) {
    var before = state.components.length;
    state.components = state.components.filter(function (c) { return c.id !== id; });
    if (state.components.length === before) return false;
    if (state.selectedId === id) state.selectedId = null;
    rebuildScene(); render();
    return true;
  }

  function deleteSelected() {
    if (!state.selectedId) return false;
    return removeCompById(state.selectedId);
  }

  // 把所有元件对到光轴上（真实实验室里最基本的一步）
  function alignToAxis() {
    var n = 0;
    for (var i = 0; i < state.components.length; i++) {
      if (Math.abs(state.components[i].y - AXIS_2D_Y) > 1e-9) n++;
      state.components[i].y = AXIS_2D_Y;
    }
    rebuildScene(); render();
    return n;
  }

  function toggleNormals() {
    state.showNormals = !state.showNormals;
    var b = document.getElementById('btnNormals');
    if (b) b.classList.toggle('active-type', state.showNormals);
    buildRays(); render();
    updateHUD();
  }

  function setShowAngles(v) {
    state.showAngles = !!v;
    var b = document.getElementById('btnAngles');
    if (b) b.classList.toggle('active-type', state.showAngles);
    buildRays(); render();
  }

  function toggleAngles() { setShowAngles(!state.showAngles); }

  function setGlobalN(v) {
    state.n = parseFloat(v) || 1.5;
    var el = document.getElementById('nVal');
    if (el) el.textContent = state.n.toFixed(2);
    // 未单独改过折射率的元件跟随全局
    for (var i = 0; i < state.components.length; i++) {
      if (state.components[i].nFollowsGlobal !== false) state.components[i].n = state.n;
    }
    rebuildScene(); render();
  }

  function numRow(label, val, key, min, max, step, unit) {
    return '<div class="prop-row"><span>' + label + '</span><span>' + val + (unit || '') + '</span></div>' +
      '<input type="range" data-key="' + key + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '">';
  }

  function updatePropPanel() {
    var box = document.getElementById('propContent');
    if (!box) return;
    var comp = null;
    for (var i = 0; i < state.components.length; i++) {
      if (state.components[i].id === state.selectedId) { comp = state.components[i]; break; }
    }
    if (!comp) { box.className = 'empty-hint'; box.innerHTML = '点击实验台上的元件以查看属性'; return; }
    box.className = '';
    var html = '<div class="prop-row"><span>类型</span><span>' + COMP_DEFS[comp.type].name + '</span></div>';
    html += '<div class="prop-row"><span>距左端</span><span>' + (comp.x / PX_PER_CM).toFixed(1) + ' cm</span></div>';
    html += '<div class="prop-row"><span>离光轴</span><span>' + ((AXIS_2D_Y - comp.y) / PX_PER_CM).toFixed(1) + ' cm</span></div>';
    html += numRow('旋转角', (comp.angle * 180 / Math.PI).toFixed(0), 'angleDeg', 0, 360, 1, '°');
    if (comp.type === 'convex_lens' || comp.type === 'concave_lens') {
      html += numRow('镜片高度', comp.lensH.toFixed(0), 'lensH', 40, 300, 5, ' px');
      html += numRow('曲率半径', comp.lensR.toFixed(0), 'lensR', 60, 600, 5, ' px');
    } else if (comp.type === 'flat_mirror') {
      html += numRow('镜面长度', comp.mirrorLen.toFixed(0), 'mirrorLen', 40, 320, 5, ' px');
    } else if (comp.type === 'concave_mirror' || comp.type === 'convex_mirror') {
      html += numRow('曲率半径', comp.mirrorR.toFixed(0), 'mirrorR', 60, 500, 5, ' px');
      html += numRow('张角', (comp.mirrorSpan * 180 / Math.PI).toFixed(0), 'mirrorSpanDeg', 20, 160, 2, '°');
    } else if (comp.type === 'glass_block') {
      html += numRow('宽度', comp.blockW.toFixed(0), 'blockW', 30, 400, 5, ' px');
      html += numRow('高度', comp.blockH.toFixed(0), 'blockH', 20, 300, 5, ' px');
    } else if (comp.type === 'prism') {
      html += numRow('边长', comp.prismSide.toFixed(0), 'prismSide', 30, 260, 5, ' px');
    } else if (comp.type === 'screen') {
      html += numRow('屏宽', comp.screenW.toFixed(0), 'screenW', 20, 300, 5, ' px');
      html += numRow('屏高', comp.screenH.toFixed(0), 'screenH', 40, 460, 5, ' px');
    }
    if (comp.type !== 'flat_mirror' && !SOURCE_TYPES[comp.type] && comp.type !== 'concave_mirror' && comp.type !== 'convex_mirror' && comp.type !== 'screen') {
      html += numRow('折射率', comp.n.toFixed(2), 'n', 1.0, 2.5, 0.01, '');
    }
    html += '<div style="margin-top:0.5rem;"><button class="btn danger" style="width:100%;" id="btnDeleteComp">🗑 删除此元件</button></div>';
    box.innerHTML = html;
    var delBtn = box.querySelector('#btnDeleteComp');
    if (delBtn) delBtn.addEventListener('click', function () { deleteSelected(); });
    var inputs = box.querySelectorAll('input[type=range]');
    for (var k = 0; k < inputs.length; k++) {
      inputs[k].addEventListener('input', onPropInput);
    }
  }

  function onPropInput(ev) {
    var key = ev.target.getAttribute('data-key');
    var v = parseFloat(ev.target.value);
    var comp = null;
    for (var i = 0; i < state.components.length; i++) {
      if (state.components[i].id === state.selectedId) { comp = state.components[i]; break; }
    }
    if (!comp) return;
    if (key === 'angleDeg') comp.angle = v * Math.PI / 180;
    else if (key === 'mirrorSpanDeg') comp.mirrorSpan = v * Math.PI / 180;
    else if (key === 'n') { comp.n = v; comp.nFollowsGlobal = false; }
    else comp[key] = v;
    rebuildScene(); render();
  }

  // ================================================================
  //  一键演示场景（教学用：点一下就出现一条完整的规律）
  // ================================================================
  function C(o) { o.n = o.n || state.n; return o; }
  var DEMOS = {
    // 白光水平射到「顶角朝上」的三棱镜左面 ⇒ 折射进棱镜、从右面折射出。
    // 🔴 棱镜转了 8°：把入射角从 30° 抬到 38°。
    //    30° 入射时棱镜内第二次入射角 θ' = 60° − asin(sin30°/n) ≈ 40.5°，
    //    而临界角 asin(1/n) ≈ 41.8° —— 只剩 1.3° 余量，n 稍大（紫端 1.53）
    //    就会在出射面上【全反射】。抬到 38° 后余量 ≈ 4.8°，7 条波长才都能出射。
    // 偏折约 36°~42°（随波长），光屏必须放在【下方】接住 —— 这正是真实课堂里
    // 棱镜演示要把光屏放低/斜放的原因。
    dispersion: {
      name: '三棱镜色散',
      build: function () {
        return [
          C({ id: 'w1', type: 'white_light', x: 70, y: 200, angle: 0 }),
          C({ id: 'p1', type: 'prism', x: 280, y: 200, angle: 0.14, prismSide: 110 }),
          C({ id: 's1', type: 'screen', x: 560, y: 410, angle: 0, screenW: 36, screenH: 200 })
        ];
      }
    },
    // 三束平行光 → 凸透镜 → 会聚到焦点的光屏（f ≈ 150 px ⇒ 屏放在 430）
    converge: {
      name: '凸透镜会聚',
      build: function () {
        return [
          C({ id: 'w1', type: 'laser_triple', x: 70, y: AXIS_2D_Y, angle: 0 }),
          C({ id: 'l1', type: 'convex_lens', x: 280, y: AXIS_2D_Y, angle: 0, lensH: 170, lensR: 150, lensW: 14 }),
          C({ id: 's1', type: 'screen', x: 430, y: AXIS_2D_Y, angle: 0, screenW: 26, screenH: 300 })
        ];
      }
    },
    // 全反射：激光斜 30° 射入【不旋转】的玻璃块左面 ⇒ 块内折射光线与水平成 19.5°，
    // 打到下表面时入射角 70.5° ≫ 临界角 41.8° ⇒ 全反射 ⇒ 转 19.5° 上行，
    // 从右面折射出去（出射角 30°）。整条链路把「折射 + 全反射 + 折射」一次演完。
    // 🔴 用不旋转的长方块而不是 45° 方块：45° 方块里折射光线几乎正对右下顶点，
    //    命中点落在棱角上（实测 1.1 px 偏差），数值上极不稳定。
    tir: {
      name: '全反射',
      build: function () {
        return [
          C({ id: 'w1', type: 'laser_single', x: 80, y: 160, angle: Math.PI / 6 }),
          C({ id: 'g1', type: 'glass_block', x: 380, y: AXIS_2D_Y, angle: 0, blockW: 160, blockH: 90 }),
          C({ id: 's1', type: 'screen', x: 660, y: 150, angle: 0, screenW: 30, screenH: 240 })
        ];
      }
    },
    // 45° 平面镜把水平光转 90° 竖直向上 ⇒ 光屏（横放）接住
    reflect: {
      name: '平面镜反射',
      build: function () {
        return [
          C({ id: 'w1', type: 'laser_single', x: 70, y: 420, angle: 0 }),
          C({ id: 'm1', type: 'flat_mirror', x: 360, y: 420, angle: Math.PI / 4, mirrorLen: 170 }),
          C({ id: 's1', type: 'screen', x: 360, y: 130, angle: Math.PI / 2, screenW: 34, screenH: 220 })
        ];
      }
    },
    // 凹面镜：平行光 → 反射后过焦点（R/2 = 85 px，焦点在 x ≈ 385）
    concave: {
      name: '凹面镜会聚',
      build: function () {
        return [
          C({ id: 'w1', type: 'laser_triple', x: 70, y: AXIS_2D_Y, angle: 0 }),
          C({ id: 'm1', type: 'concave_mirror', x: 470, y: AXIS_2D_Y, angle: 0, mirrorR: 170, mirrorSpan: Math.PI / 2.6 })
        ];
      }
    }
  };

  function loadDemo(name) {
    var d = DEMOS[name];
    if (!d) return false;
    state.components = d.build();
    state.selectedId = null;
    rebuildScene(); render();
    var btns = document.querySelectorAll('.demo-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active-type', btns[i].getAttribute('data-demo') === name);
    }
    return true;
  }

  // 按钮绑定
  (function bindUI() {
    var btns = document.querySelectorAll('.comp-btn');
    for (var i = 0; i < btns.length; i++) {
      (function (b) {
        b.addEventListener('click', function () { addComponent(b.getAttribute('data-type')); });
      })(btns[i]);
    }
    var vb = document.querySelectorAll('.view-btn');
    for (var k = 0; k < vb.length; k++) {
      (function (b) { b.addEventListener('click', function () { setView(b.getAttribute('data-view')); }); })(vb[k]);
    }
    var db = document.querySelectorAll('.demo-btn');
    for (var j = 0; j < db.length; j++) {
      (function (b) { b.addEventListener('click', function () { loadDemo(b.getAttribute('data-demo')); }); })(db[j]);
    }
    window.addEventListener('resize', function () { resize(); });
  })();

  // ================================================================
  //  启动
  // ================================================================
  buildBench();
  buildGrid();
  resize();
  loadDemo('dispersion');
  setView('angle');
  render();

  // ================================================================
  //  测试钩子
  // ================================================================
  window.__optics3d = {
    S: S,
    get W() { return W; },
    get H() { return H; },
    get cm() { return CM; },
    get pxPerCm() { return PX_PER_CM; },
    get benchTop() { return BENCH_TOP; },
    get benchBot() { return BENCH_BOT; },
    get floorY() { return FLOOR_Y; },
    get axis2DY() { return AXIS_2D_Y; },
    get orbitSpeed() { return ORBIT_SPEED; },
    get state() { return state; },
    get cam() { return cam; },
    get rayStats() { return lastRayStats; },
    get components() { return state.components; },
    get selectedId() { return state.selectedId; },
    get showNormals() { return state.showNormals; },
    get showAngles() { return state.showAngles; },
    get orbit() { return state.orbit; },
    get n() { return state.n; },
    get scene() { return scene; },
    get compGroup() { return compGroup; },
    get mountGroup() { return mountGroup; },
    get rayGroup() { return rayGroup; },
    get glowGroup() { return glowGroup; },
    get normalGroup() { return normalGroup; },
    get annotGroup() { return annotGroup; },
    get spotGroup() { return spotGroup; },
    get gridGroup() { return gridGroup; },
    get benchGroup() { return benchGroup; },
    get camera() { return camera; },
    get renderer() { return renderer; },
    // 内核
    getSurfaces: getSurfaces,
    getSourceRays: getSourceRays,
    traceRay: traceRay,
    reflect: reflect,
    refractSimple: refractSimple,
    intersectLineRay: intersectLineRay,
    intersectArcRay: intersectArcRay,
    extendRay: extendRay,
    to3D: to3D,
    nFor: nFor,
    wavelengths: WAVELENGTHS.slice(),
    // 操作
    addComponent: addComponent,
    clearAll: clearAll,
    deleteSelected: deleteSelected,
    removeCompById: removeCompById,
    toggleNormals: toggleNormals,
    toggleAngles: toggleAngles,
    setShowAngles: setShowAngles,
    setGlobalN: setGlobalN,
    setView: setView,
    setOrbit: setOrbit,
    tickOrbit: tickOrbit,
    alignToAxis: alignToAxis,
    loadDemo: loadDemo,
    demoNames: Object.keys(DEMOS),
    setSelected: function (id) { state.selectedId = id; rebuildScene(); render(); },
    moveComp: function (id, x, y) {
      for (var i = 0; i < state.components.length; i++) {
        if (state.components[i].id === id) { state.components[i].x = x; state.components[i].y = y; }
      }
      rebuildScene(); render();
    },
    render: render,
    resize: resize,
    // 自检专用读数
    mountAnchors: function () {
      return state.components.map(function (c) {
        var w = to3D(c.x, c.y, 0);
        var g = null;
        for (var i = 0; i < mountGroup.children.length; i++) {
          if (mountGroup.children[i].userData.compId === c.id) { g = mountGroup.children[i]; break; }
        }
        var baseY = null, postTopY = null, postBotY = null, postLen = 0;
        if (g) {
          for (var k = 0; k < g.children.length; k++) {
            var ch = g.children[k];
            if (ch.userData.part === 'base') baseY = ch.position.y;
            if (ch.userData.part === 'post') {
              postLen = ch.userData.len;
              postTopY = ch.position.y + postLen / 2;
              postBotY = ch.position.y - postLen / 2;
            }
          }
        }
        return {
          id: c.id, type: c.type, parts: g ? g.children.length : 0,
          centerY: w.y, halfH: elemHalfH(c), baseY: baseY,
          postTopY: postTopY, postBotY: postBotY, postLen: postLen,
          groupX: g ? g.position.x : null
        };
      });
    },
    // 每个波长的出射方向（色散自检用）
    exitDirections: function (lambdaList) {
      var src = null;
      for (var i = 0; i < state.components.length; i++) {
        if (SOURCE_TYPES[state.components[i].type]) { src = state.components[i]; break; }
      }
      if (!src) return [];
      var base = getSourceRays(src)[0];
      var out = [];
      for (var k = 0; k < lambdaList.length; k++) {
        var acc = traceRay(base.ox, base.oy, base.dx, base.dy, state.components, 0, 0, 1.0, null, { lambda: lambdaList[k] });
        var s = acc.segments[acc.segments.length - 1];
        var L = Math.hypot(s.x2 - s.x1, s.y2 - s.y1) || 1;
        out.push({
          lambda: lambdaList[k], dx: (s.x2 - s.x1) / L, dy: (s.y2 - s.y1) / L,
          segs: acc.segments.length, spots: acc.spots.length
        });
      }
      return out;
    },
    labelScreenHeights: labelScreenHeights,
    labelTexts: function () {
      return labelSprites.filter(function (s) { return !!s.parent; })
        .map(function (s) { return s.userData.text; });
    },
    // 实验台各部件的真实包围盒（自检读「实际画出去的几何」，不读声明常量）
    benchParts: function () {
      var out = [];
      benchGroup.traverse(function (o) {
        if (!o.userData || !o.userData.part) return;
        var bb = new THREE.Box3().setFromObject(o);
        out.push({
          part: o.userData.part,
          size: [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z],
          min: bb.min.toArray(), max: bb.max.toArray(), pos: o.position.toArray()
        });
      });
      return out;
    },
    hudText: function () {
      var el = document.getElementById('stageHud');
      return el ? el.textContent : '';
    },
    hudValues: function () {
      var el = document.getElementById('stageHud');
      if (!el) return {};
      var out = {};
      var rows = el.querySelectorAll('[data-k]');
      for (var i = 0; i < rows.length; i++) {
        var b = rows[i].querySelector('b');
        out[rows[i].getAttribute('data-k')] = b ? b.textContent : null;
      }
      return out;
    },
    debug: function () {
      return {
        compCount: state.components.length,
        types: state.components.map(function (c) { return c.type; }),
        raySegments: lastRayStats.segments,
        rayHits: lastRayStats.hits,
        sources: lastRayStats.sources,
        spots: lastRayStats.spots,
        dispRays: lastRayStats.disp,
        showNormals: state.showNormals,
        showAngles: state.showAngles,
        orbit: state.orbit,
        n: state.n,
        view: state.view,
        yaw: cam.yaw, pitch: cam.pitch, zoom: cam.zoom, dist: cam.dist,
        selectedId: state.selectedId,
        compMeshes: compGroup.children.length,
        mountMeshes: mountGroup.children.length,
        rayMeshes: rayGroup.children.length,
        glowMeshes: glowGroup.children.length,
        normalMeshes: normalGroup.children.length,
        annotMeshes: annotGroup.children.length,
        spotMeshes: spotGroup.children.length,
        gridChildren: gridGroup.children.length,
        benchChildren: benchGroup.children.length,
        benchTop: BENCH_TOP,
        axis2DY: AXIS_2D_Y,
        cm: CM,
        labelCount: labelSprites.filter(function (s) { return !!s.parent; }).length,
        canvas: { w: canvas.width, h: canvas.height, cssW: canvas.clientWidth, cssH: canvas.clientHeight },
        renderCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        nValText: (document.getElementById('nVal') || {}).textContent,
        hud: (document.getElementById('stageHud') || {}).textContent || ''
      };
    }
  };
  // 供 HTML 里 onclick 使用
  window.clearAll = clearAll;
  window.deleteSelected = deleteSelected;
  window.toggleNormals = toggleNormals;
  window.toggleAngles = toggleAngles;
  window.setGlobalN = setGlobalN;
  window.alignToAxis = alignToAxis;
  window.loadDemo = loadDemo;
})();
