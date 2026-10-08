import * as THREE from './assets/optics-three.min.js';

/* 光学实验沙盒 · 3D 光路搭建
 *
 * 物理内核与 2D 版【逐行一致】（纯平面光线追迹：所有元件位于 z = 0 平面内，
 * 光线在该平面内传播、反射、折射、全反射）—— 只有渲染层换成了 three.js：
 * 镜片/棱镜做成有厚度的实体，光线做成细管，相机可绕场景转动，于是
 * 「透镜是个有厚度的片」这件事看得出来了。
 *
 * 2D 沙盒坐标 (x, y)（原点左上、y 向下）→ 3D 世界：
 *   X = (x − W/2)·S，Y = (H/2 − y)·S，Z = z·S
 * 元件网格：先按局部坐标 (px, py) 建 2D 轮廓 → 映射成 (px·S, −py·S) →
 * 挤出厚度 → 放到 to3D(comp.x, comp.y) → 绕 Z 轴旋转 −comp.angle
 * （推导：先旋转后映射 == 先映射后绕 Z 轴转 −a，见 MEMORY 推导）。
 */
(function () {
  'use strict';

  // ============ 逻辑尺寸（固定，与窗口无关） ============
  var W = 700, H = 520;              // 2D 沙盒坐标范围
  var S = 0.02;                      // 2D px → 3D 单位
  var HALF_W = W * S / 2, HALF_H = H * S / 2;

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

  // ============ 元件类型 ============
  var COMP_DEFS = {
    laser_single: { name: '单束激光', isSource: true },
    laser_triple: { name: '三束激光', isSource: true },
    convex_lens: { name: '凸透镜', isSource: false },
    concave_lens: { name: '凹透镜', isSource: false },
    flat_mirror: { name: '平面镜', isSource: false },
    concave_mirror: { name: '凹面镜', isSource: false },
    convex_mirror: { name: '凸面镜', isSource: false },
    glass_block: { name: '玻璃块', isSource: false },
    prism: { name: '三棱镜', isSource: false }
  };
  var SOURCE_TYPES = { laser_single: 1, laser_triple: 1 };

  // ============ 状态 ============
  var state = {
    components: [],
    selectedId: null,
    n: 1.50,
    showNormals: false,
    view: 'front'
  };
  var cam = { yaw: -0.42, pitch: 0.36, dist: 20, zoom: 1 };

  var VIEWS = {
    front: { yaw: 0, pitch: 0.02 },
    angle: { yaw: -0.42, pitch: 0.36 },
    top: { yaw: 0, pitch: 1.18 }
  };

  // ================================================================
  //  物理内核 —— 与 2D 版逐行一致
  // ================================================================
  function getSurfaces(comp) {
    var cx = comp.x, cy = comp.y, a = comp.angle;
    var cos = Math.cos(a), sin = Math.sin(a);
    var surfaces = [];
    function rotatePoint(px, py) {
      return { x: cx + px * cos - py * sin, y: cy + px * sin + py * cos };
    }
    var n_in = comp.n || state.n;
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

  // 返回 { segments:[{x1,y1,x2,y2,normal?}], hits:[{x,y,nx,ny}] }
  function traceRay(ox, oy, dx, dy, components, depth, colorIdx, currentN, acc) {
    if (!acc) acc = { segments: [], hits: [] };
    if (depth > 12) return acc;
    if (currentN === undefined) currentN = 1.0;

    var bestT = Infinity, bestSurf = null, bestPoint = null, bestNormal = null;
    for (var ci = 0; ci < components.length; ci++) {
      var comp = components[ci];
      if (SOURCE_TYPES[comp.type]) continue;
      var surfaces = getSurfaces(comp);
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

    if (bestSurf.isMirror) {
      var r = reflect(dx, dy, bestNormal.nx, bestNormal.ny);
      return traceRay(bestPoint.x, bestPoint.y, r.dx, r.dy, components, depth + 1, colorIdx, currentN, acc);
    }
    var n1 = bestSurf.n1, n2 = bestSurf.n2, fromN, toN;
    if (Math.abs(currentN - n1) < 0.01) { fromN = n1; toN = n2; }
    else { fromN = n2; toN = n1; }
    var n = flipNormalTowardRay(bestNormal.nx, bestNormal.ny, dx, dy);
    var ref = refractSimple(dx, dy, n.nx, n.ny, fromN, toN);
    if (ref) {
      return traceRay(bestPoint.x, bestPoint.y, ref.dx, ref.dy, components, depth + 1, colorIdx, toN, acc);
    }
    var rr = reflect(dx, dy, bestNormal.nx, bestNormal.ny);
    return traceRay(bestPoint.x, bestPoint.y, rr.dx, rr.dy, components, depth + 1, colorIdx, currentN, acc);
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

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);

  scene.add(new THREE.AmbientLight(0xffffff, 0.72));
  var keyLight = new THREE.DirectionalLight(0xffffff, 1.05); keyLight.position.set(6, 11, 14); scene.add(keyLight);
  var rimLight = new THREE.DirectionalLight(0x7cc6ff, 0.6); rimLight.position.set(-9, -5, -12); scene.add(rimLight);

  // 环境贴图（给玻璃反光用）—— 用一张渐变 canvas 过 PMREM
  (function makeEnv() {
    try {
      var c = document.createElement('canvas'); c.width = 32; c.height = 64;
      var g = c.getContext('2d');
      var grd = g.createLinearGradient(0, 0, 0, 64);
      grd.addColorStop(0, '#9ec9ff'); grd.addColorStop(0.45, '#1e2b45'); grd.addColorStop(1, '#070c16');
      g.fillStyle = grd; g.fillRect(0, 0, 32, 64);
      var tex = new THREE.CanvasTexture(c);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      var pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromEquirectangular(tex).texture;
      pmrem.dispose(); tex.dispose();
    } catch (e) { /* 环境贴图失败不影响主流程 */ }
  })();

  var compGroup = new THREE.Group(); scene.add(compGroup);
  var rayGroup = new THREE.Group(); scene.add(rayGroup);
  var normalGroup = new THREE.Group(); scene.add(normalGroup);
  var gridGroup = new THREE.Group(); scene.add(gridGroup);

  // ---- 材质 ----
  function glassMat() {
    return new THREE.MeshPhysicalMaterial({
      color: 0xbfe4ff, metalness: 0.0, roughness: 0.06,
      transmission: 0.86, thickness: 1.2, ior: Math.max(1.0, state.n),
      transparent: true, opacity: 0.62, side: THREE.DoubleSide,
      envMapIntensity: 1.15, clearcoat: 0.5
    });
  }
  var mirrorMat = new THREE.MeshStandardMaterial({ color: 0xd7e6f5, metalness: 0.92, roughness: 0.14, side: THREE.DoubleSide });
  var laserMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.6, roughness: 0.35 });
  var emissiveMat = new THREE.MeshBasicMaterial({ color: 0xff4d4d });
  var selectMat = new THREE.MeshBasicMaterial({ color: SELECT_COLOR, transparent: true, opacity: 0.28, side: THREE.DoubleSide });

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
    }
    return pts;
  }

  function depthOf(comp) {
    switch (comp.type) {
      case 'flat_mirror': return 7;
      case 'concave_mirror': case 'convex_mirror': return 10;
      case 'glass_block': return 46;
      case 'prism': return 46;
      case 'convex_lens': case 'concave_lens': return (comp.lensW || 12) * 1.9;
      default: return 16;
    }
  }

  function makeCompMesh(comp) {
    var group = new THREE.Group();
    var pts = outlineOf(comp);
    var depth = depthOf(comp);
    var isGlass = (comp.type === 'convex_lens' || comp.type === 'concave_lens' || comp.type === 'glass_block' || comp.type === 'prism');
    var isMirror = /mirror/.test(comp.type);
    var mat = isMirror ? mirrorMat : (isGlass ? glassMat() : laserMat);

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
    }

    if (SOURCE_TYPES[comp.type]) {
      var tip = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), emissiveMat);
      tip.position.set(34 / 2 * S, 0, 0);
      group.add(tip);
      var halo = new THREE.PointLight(0xff5555, 0.6, 3.2);
      halo.position.copy(tip.position);
      group.add(halo);
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
    return group;
  }

  // ---- 网格底板（帮助建立 3D 感） ----
  function buildGrid() {
    while (gridGroup.children.length) { var g = gridGroup.children.pop(); g.geometry && g.geometry.dispose(); }
    var step = 40;
    var lineMat = new THREE.LineBasicMaterial({ color: 0x1e3a5f, transparent: true, opacity: 0.75 });
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

    var frameMat = new THREE.LineBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.55 });
    var c0 = to3D(0, 0), c1 = to3D(W, 0), c2 = to3D(W, H), c3 = to3D(0, H);
    var fv = [c0.x, c0.y, 0, c1.x, c1.y, 0, c1.x, c1.y, 0, c2.x, c2.y, 0,
      c2.x, c2.y, 0, c3.x, c3.y, 0, c3.x, c3.y, 0, c0.x, c0.y, 0];
    var fgeo = new THREE.BufferGeometry();
    fgeo.setAttribute('position', new THREE.Float32BufferAttribute(fv, 3));
    gridGroup.add(new THREE.LineSegments(fgeo, frameMat));
  }

  // ---- 光线 ----
  var lastRayStats = { segments: 0, hits: 0, sources: 0 };

  function clearGroup(grp) {
    while (grp.children.length) {
      var o = grp.children.pop();
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    }
  }

  function buildRays() {
    clearGroup(rayGroup);
    clearGroup(normalGroup);
    var segs = 0, hits = 0, sources = 0;
    var sources_ = state.components.filter(function (c) { return SOURCE_TYPES[c.type]; });
    for (var i = 0; i < sources_.length; i++) {
      var src = sources_[i];
      var rays = getSourceRays(src);
      for (var r = 0; r < rays.length; r++) {
        sources++;
        var ray = rays[r];
        var acc = traceRay(ray.ox, ray.oy, ray.dx, ray.dy, state.components, 0, ray.color, 1.0);
        var col = RAY_COLORS[ray.color % RAY_COLORS.length];
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
      }
    }
    lastRayStats = { segments: segs, hits: hits, sources: sources };
  }

  function addRaySegment(seg, colorHex) {
    var p1 = to3D(seg.x1, seg.y1, 0), p2 = to3D(seg.x2, seg.y2, 0);
    var dir = new THREE.Vector3().subVectors(p2, p1);
    var len = dir.length();
    if (len < 1e-5) return;
    var geo = new THREE.CylinderGeometry(RAY_RADIUS, RAY_RADIUS, len, 6, 1, false);
    var mat = new THREE.MeshBasicMaterial({ color: colorHex });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(p1).addScaledVector(dir, 0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    rayGroup.add(mesh);
  }

  function addNormal(h) {
    var len = 26;
    var p1 = to3D(h.x, h.y, 0);
    var p2 = to3D(h.x + h.nx * len, h.y + h.ny * len, 0);
    var geo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    normalGroup.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: NORMAL_COLOR })));
  }

  // ---- 重建场景 ----
  function rebuildScene() {
    clearGroup(compGroup);
    for (var i = 0; i < state.components.length; i++) {
      compGroup.add(makeCompMesh(state.components[i]));
    }
    buildRays();
    updatePropPanel();
  }

  // ---- 相机 ----
  function baseDist() {
    var fovY = camera.fov * Math.PI / 180;
    var halfH = HALF_H * 1.22, halfW = HALF_W * 1.22;
    var dV = halfH / Math.tan(fovY / 2);
    var dH = halfW / Math.tan(fovY / 2) / Math.max(camera.aspect, 0.2);
    return Math.max(dV, dH);
  }

  function updateCamera() {
    var d = baseDist() / cam.zoom;
    var cy = Math.sin(cam.pitch), cr = Math.cos(cam.pitch);
    camera.position.set(d * cr * Math.sin(cam.yaw), d * cy, d * cr * Math.cos(cam.yaw));
    camera.lookAt(0, 0, 0);
    cam.dist = d;
  }

  function setView(name) {
    var v = VIEWS[name] || VIEWS.front;
    cam.yaw = v.yaw; cam.pitch = v.pitch;
    state.view = name;
    var btns = document.querySelectorAll('.view-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active-view', btns[i].getAttribute('data-view') === name);
    }
    updateCamera();
    render();
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
    renderer.render(scene, camera);
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
    var hits = raycaster.intersectObjects(compGroup.children, true);
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
        dragComp.y = Math.max(10, Math.min(H - 10, pp.y + dragOffset.dy));
        rebuildScene();
        render();
      }
      return;
    }
    if (orbiting && lastPointer) {
      var dx = ev.clientX - lastPointer.x, dy = ev.clientY - lastPointer.y;
      lastPointer = { x: ev.clientX, y: ev.clientY };
      cam.yaw -= dx * 0.006;
      cam.pitch = Math.max(-1.45, Math.min(1.45, cam.pitch + dy * 0.005));
      state.view = 'custom';
      updateCamera();
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
      type: type, x: W / 2, y: H / 2, angle: 0, n: state.n
    };
    switch (type) {
      case 'laser_single': case 'laser_triple': comp.angle = 0; break;
      case 'convex_lens': comp.lensH = 120; comp.lensR = 160; comp.lensW = 12; break;
      case 'concave_lens': comp.lensH = 120; comp.lensR = 400; comp.lensW = 12; break;
      case 'flat_mirror': comp.mirrorLen = 120; break;
      case 'concave_mirror': comp.mirrorR = 150; comp.mirrorSpan = Math.PI / 3; break;
      case 'convex_mirror': comp.mirrorR = 150; comp.mirrorSpan = Math.PI / 3; break;
      case 'glass_block': comp.blockW = 100; comp.blockH = 60; break;
      case 'prism': comp.prismSide = 80; break;
    }
    // 落在画布内、避开已有元件：按螺旋找一个空位
    var placed = false;
    for (var ring = 0; ring < 6 && !placed; ring++) {
      for (var k = 0; k < 8; k++) {
        var ang = k * Math.PI / 4;
        var cx = W / 2 + Math.cos(ang) * ring * 70;
        var cy = H / 2 + Math.sin(ang) * ring * 55;
        if (cx < 60 || cx > W - 60 || cy < 50 || cy > H - 50) continue;
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

  function toggleNormals() {
    state.showNormals = !state.showNormals;
    var b = document.getElementById('btnNormals');
    if (b) b.classList.toggle('active-type', state.showNormals);
    buildRays(); render();
  }

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
    if (!comp) { box.className = 'empty-hint'; box.innerHTML = '点击画布上的元件以查看属性'; return; }
    box.className = '';
    var html = '<div class="prop-row"><span>类型</span><span>' + COMP_DEFS[comp.type].name + '</span></div>';
    html += '<div class="prop-row"><span>位置</span><span>x ' + comp.x.toFixed(0) + ' · y ' + comp.y.toFixed(0) + '</span></div>';
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
    }
    if (comp.type !== 'flat_mirror' && !SOURCE_TYPES[comp.type] && comp.type !== 'concave_mirror' && comp.type !== 'convex_mirror') {
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
    window.addEventListener('resize', function () { resize(); });
  })();

  // ================================================================
  //  初始演示
  // ================================================================
  function initDemo() {
    state.components = [];
    function push(o) { state.components.push(o); }
    push({ id: 'd1', type: 'laser_triple', x: 90, y: H / 2, angle: 0, n: state.n });
    push({ id: 'd2', type: 'convex_lens', x: 330, y: H / 2, angle: 0, n: state.n, lensH: 130, lensR: 150, lensW: 14 });
    push({ id: 'd3', type: 'prism', x: 560, y: H / 2 - 30, angle: 0, n: state.n, prismSide: 90 });
    state.selectedId = null;
    rebuildScene(); render();
  }

  // ================================================================
  //  启动
  // ================================================================
  buildGrid();
  resize();
  initDemo();
  setView('angle');
  render();

  // ================================================================
  //  测试钩子
  // ================================================================
  window.__optics3d = {
    S: S,
    get W() { return W; },
    get H() { return H; },
    get state() { return state; },
    get cam() { return cam; },
    get rayStats() { return lastRayStats; },
    get components() { return state.components; },
    get selectedId() { return state.selectedId; },
    get showNormals() { return state.showNormals; },
    get n() { return state.n; },
    get scene() { return scene; },
    get compGroup() { return compGroup; },
    get rayGroup() { return rayGroup; },
    get normalGroup() { return normalGroup; },
    get gridGroup() { return gridGroup; },
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
    // 操作
    addComponent: addComponent,
    clearAll: clearAll,
    deleteSelected: deleteSelected,
    removeCompById: removeCompById,
    toggleNormals: toggleNormals,
    setGlobalN: setGlobalN,
    setView: setView,
    setSelected: function (id) { state.selectedId = id; rebuildScene(); render(); },
    moveComp: function (id, x, y) {
      for (var i = 0; i < state.components.length; i++) {
        if (state.components[i].id === id) { state.components[i].x = x; state.components[i].y = y; }
      }
      rebuildScene(); render();
    },
    render: render,
    resize: resize,
    debug: function () {
      return {
        compCount: state.components.length,
        types: state.components.map(function (c) { return c.type; }),
        raySegments: lastRayStats.segments,
        rayHits: lastRayStats.hits,
        sources: lastRayStats.sources,
        showNormals: state.showNormals,
        n: state.n,
        view: state.view,
        yaw: cam.yaw, pitch: cam.pitch, zoom: cam.zoom, dist: cam.dist,
        selectedId: state.selectedId,
        compMeshes: compGroup.children.length,
        rayMeshes: rayGroup.children.length,
        normalMeshes: normalGroup.children.length,
        gridChildren: gridGroup.children.length,
        canvas: { w: canvas.width, h: canvas.height, cssW: canvas.clientWidth, cssH: canvas.clientHeight },
        renderCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        nValText: (document.getElementById('nVal') || {}).textContent
      };
    }
  };
  // 供 HTML 里 onclick 使用
  window.clearAll = clearAll;
  window.deleteSelected = deleteSelected;
  window.toggleNormals = toggleNormals;
  window.setGlobalN = setGlobalN;
})();
