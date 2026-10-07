import * as THREE from './assets/optics-three.min.js';

// 透镜对光的作用 —— 立体模型。
// 世界坐标以厘米为单位，主轴 = x 轴（光从左向右传播），透镜中心在 x = 0。
// 光线不是照着焦点画上去的：镜片按两个球面建模，每条光线在前后表面各做一次
// 折射（Snell 定律），焦点位置由【近轴出射光线求交】算出 —— 与侧栏的「焦距 f」
// 是两条互不引用的独立路径，两者对得上才说明这束光真的被折到了该去的地方。
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const canvas = $('sceneCanvas');
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const RAD = Math.PI / 180;

  /* ================= 物理常量 ================= */
  const N_GLASS = 1.50;      // 玻璃折射率
  const APERTURE = 4.4;      // 镜片半口径 cm
  const THICK = 1.6;         // 透镜中心厚度 cm
  const RAY_X0 = -26;        // 入射光线起点（物侧远端）
  const RAY_X1 = 31;         // 出射光线终点（像侧远端）
  const NEAR_AXIS = 0.20;    // 「近轴」判据：径向半径 ≤ NEAR_AXIS × APERTURE

  /* ================= 透镜几何 =================
     表面参数化：顶点 apex、曲率半径 R（带符号，球心在 apex + R 一侧）。
     剖面上 x(r) = (apex + R) − R·√(1 − (r/R)²)，绕 x 轴旋转即得镜面。
     凸透镜：R₁ = +R、R₂ = −R（两个面都向中间凸 ⇒ 中间厚）
     凹透镜：R₁ = −R、R₂ = +R（两个面都向外凹 ⇒ 边缘厚） */
  function radiusForFocal(f) {
    // 由【厚透镜公式】反解等半径双凸/双凹镜片的曲率半径：
    //   1/f = (n−1)·(1/R₁ − 1/R₂) + (n−1)²·d/(n·R₁R₂)
    const n = N_GLASS, d = THICK, k = 1 / Math.abs(f);
    if (f > 0) {
      const s = Math.sqrt(Math.max(0, 1 - k * d / n));
      return (n - 1) * (1 + s) / k;
    }
    const s = Math.sqrt(1 + k * d / n);
    return (n - 1) * (1 + s) / k;
  }

  function focalFromRadius(R1, R2, d) {
    // 厚透镜公式（与光线追迹互不引用）
    const n = N_GLASS;
    const P = (n - 1) * (1 / R1 - 1 / R2 + (n - 1) * d / (n * R1 * R2));
    return 1 / P;
  }

  function lensGeom(kind, f) {
    const R = radiusForFocal(kind === 'convex' ? Math.abs(f) : -Math.abs(f));
    const R1 = kind === 'convex' ? R : -R;
    const R2 = kind === 'convex' ? -R : R;
    return {
      kind, R1, R2, R,
      apex1: -THICK / 2, apex2: THICK / 2,
      c1: -THICK / 2 + R1, c2: THICK / 2 + R2,
      d: THICK, aperture: APERTURE, n: N_GLASS,
      fTheory: focalFromRadius(R1, R2, THICK)
    };
  }

  /* ================= 光线追迹 ================= */
  function intersectSphere(P0, d, Cx, R) {
    // (x−Cx)² + y² + z² = R²，射线 P0 + t·d（d 已单位化）
    const ex = P0.x - Cx, ey = P0.y, ez = P0.z;
    const b = d.x * ex + d.y * ey + d.z * ez;
    const c = ex * ex + ey * ey + ez * ez - R * R;
    const D = b * b - c;
    if (D < 0) return null;
    const sq = Math.sqrt(D);
    // 🔴 不能一律取「最小的正根」：球面在给定高度上有两个交点，而镜面只是其中【一半】——
    //    表面参数化是 x(r) = (apex+R) − R·√(1−(r/R)²)，所以 x − 球心 的符号恒等于 −R 的符号。
    //    凸透镜 R>0 ⇒ 镜面在球心左侧；凹透镜 R<0 ⇒ 镜面在球心右侧。取错根会把光线
    //    送到球面另一侧的远处（实测凹透镜交点被算到 x = −25.2，整条光路都是错的）。
    const wantNeg = (-R) < 0;
    const cands = [-b - sq, -b + sq].filter((t) => t > 1e-7).sort((a, b2) => a - b2);
    for (const t of cands) {
      const x = P0.x + t * d.x;
      if ((x - Cx < 0) === wantNeg) return t;
    }
    return null;
  }

  function snell(d, N, eta) {
    const cosi = -N.dot(d);
    const k = 1 - eta * eta * (1 - cosi * cosi);
    if (k < 0) return null;                       // 全反射（本页不会发生）
    return d.clone().multiplyScalar(eta)
      .addScaledVector(N, eta * cosi - Math.sqrt(k)).normalize();
  }

  // 追迹一条光线：返回 { inSeg, glassSeg, outSeg, P1, P2, d2 } 或 null
  function traceRay(P0, dir, L) {
    const t1 = intersectSphere(P0, dir, L.c1, L.R1);
    if (t1 === null) return null;
    const P1 = P0.clone().addScaledVector(dir, t1);
    if (Math.hypot(P1.y, P1.z) > L.aperture + 1e-9) return { miss: true, P1 };
    let N1 = P1.clone().sub(new THREE.Vector3(L.c1, 0, 0)).normalize();
    if (N1.dot(dir) > 0) N1.negate();
    const d1 = snell(dir, N1, 1 / N_GLASS);
    if (!d1) return null;

    const t2 = intersectSphere(P1, d1, L.c2, L.R2);
    if (t2 === null) return null;
    const P2 = P1.clone().addScaledVector(d1, t2);
    let N2 = P2.clone().sub(new THREE.Vector3(L.c2, 0, 0)).normalize();
    if (N2.dot(d1) > 0) N2.negate();
    const d2 = snell(d1, N2, N_GLASS);
    if (!d2) return null;

    return { P0, dir, P1, P2, d1, d2 };
  }

  // 两条出射光线的交点（都在 xy 平面内）。
  // 🔴 这里【不能】用「全部光线的最小二乘交点」：一束平行光的出射方向彼此只差几度，
  //    法方程 Σ[I − d·dᵀ] 接近奇异，解会跑偏（实测凹透镜虚焦点被算成 +10.6 cm，
  //    真值应是 −19.5 cm）。取一对关于主轴对称的光线，2D 叉积求交既精确又稳。
  function intersectXY(A, B) {
    const den = A.d.x * B.d.y - A.d.y * B.d.x;
    if (Math.abs(den) < 1e-12) return null;
    const dx = B.p.x - A.p.x, dy = B.p.y - A.p.y;
    const s = (dx * B.d.y - dy * B.d.x) / den;
    return new THREE.Vector3(A.p.x + s * A.d.x, A.p.y + s * A.d.y, 0);
  }

  /* ================= 状态 ================= */
  const VIEWS = {
    side:        [-0.02, 0.02, 1.00],
    perspective: [-0.55, 0.30, 1.00],
    top:         [0.00, 1.44, 1.00],
    axis:        [1.42, 0.10, 1.00]
  };
  const state = {
    kind: 'convex', f: 12,
    rayCount: 12, beamRadius: 3.6, incidence: 0,
    rayMode: 'all', singleHeight: 2.4,
    showFocal: true, showAxis: true, showVirtual: true, showBeam: true,
    yaw: VIEWS.perspective[0], pitch: VIEWS.perspective[1], zoom: 1.0,
    view: 'perspective',   // 当前视角档名（applyView 维护；只此一处写初值）
    records: []
  };
  const lens = () => lensGeom(state.kind, state.f);

  /* ================= three.js 场景 ================= */
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, alpha: false, powerPreference: 'high-performance',
      // 自检要能读画布像素（drawImage / toDataURL 取回 GPU 结果）⇒ 保留绘制缓冲
      preserveDrawingBuffer: true
    });
  } catch (e) {
    $('stage').innerHTML = '<div style="padding:24px;color:#fff;line-height:1.7">' +
      '这个实验需要 WebGL 支持，当前浏览器无法创建 3D 场景。<br>请换用较新的 Chrome / Edge / Safari。</div>';
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#08131f');
  scene.fog = new THREE.Fog('#08131f', 120, 230);

  const camera = new THREE.PerspectiveCamera(37, 1, 0.1, 600);
  const target = new THREE.Vector3(1.5, 0, 0);

  scene.add(new THREE.HemisphereLight('#dff1fb', '#2b3946', 1.5));
  const key = new THREE.DirectionalLight('#fff6e8', 2.2); key.position.set(-26, 40, 34); scene.add(key);
  const fill = new THREE.DirectionalLight('#bcd9ee', 1.0); fill.position.set(30, -18, -26); scene.add(fill);
  const rim = new THREE.DirectionalLight('#8fd8f0', 1.2); rim.position.set(22, 12, -30); scene.add(rim);

  const mat = (color, metalness = 0, roughness = .6, opts = {}) =>
    new THREE.MeshStandardMaterial(Object.assign({ color, metalness, roughness }, opts));
  const matAlu = mat('#aab3b9', .62, .32);
  const matDark = mat('#2c3946', .45, .55);

  function mesh(geo, m, parent, x = 0, y = 0, z = 0) {
    const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); parent.add(o); return o;
  }

  /* --- 实验台 --- */
  const bench = new THREE.Group(); scene.add(bench);
  mesh(new THREE.BoxGeometry(74, 1.1, 20), matAlu, bench, 2.5, -6.6, 0);
  mesh(new THREE.BoxGeometry(74, .45, 20), matDark, bench, 2.5, -7.3, 0);
  // 主轴刻度尺
  const tickMat = new THREE.LineBasicMaterial({ color: '#5b6b79', transparent: true, opacity: .85 });
  const tickVerts = [];
  for (let x = -26; x <= 31; x += 2) {
    const big = (x % 10 === 0), h = big ? 1.5 : .8;
    tickVerts.push(x, -5.9, 9.6, x, -5.9 - h, 9.6);
  }
  const tickGeo = new THREE.BufferGeometry();
  tickGeo.setAttribute('position', new THREE.Float32BufferAttribute(tickVerts, 3));
  bench.add(new THREE.LineSegments(tickGeo, tickMat));

  /* --- 标签（canvas 贴图 Sprite） --- */
  function label(text, color = '#9fd8ea', w = 6.4) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.font = 'bold 36px Inter, "PingFang SC", "Microsoft YaHei", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = color;
    g.fillText(text, 128, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
    sp.scale.set(w, w / 4, 1);
    return sp;
  }

  /* --- 透镜实体（真球面回转体） --- */
  const lensGroup = new THREE.Group(); scene.add(lensGroup);
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: '#eaf7f3', metalness: 0, roughness: .05, transmission: .9, thickness: 1.2,
    ior: 1.5, transparent: true, opacity: .9, side: THREE.DoubleSide,
    depthWrite: false, envMapIntensity: 1.4, clearcoat: .6, clearcoatRoughness: .12
  });
  const rimMat = new THREE.MeshStandardMaterial({
    color: '#8fb9cc', metalness: .3, roughness: .25, transparent: true, opacity: .55
  });

  function lensSurfaceGeometry(apex, R, aperture, rings, segs) {
    const verts = [], idx = [];
    for (let j = 0; j <= rings; j++) {
      const r = aperture * j / rings;
      const u = Math.min(.9999, r / Math.abs(R));
      const x = (apex + R) - R * Math.sqrt(1 - u * u);
      for (let i = 0; i <= segs; i++) {
        const a = i * 2 * Math.PI / segs;
        verts.push(x, r * Math.cos(a), r * Math.sin(a));
      }
    }
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < segs; i++) {
        const n = j * (segs + 1) + i, m = n + segs + 1;
        idx.push(n, m, n + 1, m, m + 1, n + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }

  function buildLens(L) {
    while (lensGroup.children.length) lensGroup.remove(lensGroup.children[0]);
    const rings = 16, segs = 72;
    const surf = [
      mesh(lensSurfaceGeometry(L.apex1, L.R1, L.aperture, rings, segs), glassMat, lensGroup),
      mesh(lensSurfaceGeometry(L.apex2, L.R2, L.aperture, rings, segs), glassMat, lensGroup)
    ];
    /* 🔴 把【实际提交给渲染器的】两个表面几何记进 drawn，供自检断言「透镜实体真的画出去了」。
       原来只断言「画布非底色格占比 > 8%」——光线自己就够 8%，**把镜片整个删掉照样绿**
       （实测：M18 只删第一个表面，第二个还在画 ⇒ 仍全绿，是变异没改到位 + 断言太钝）。
       顶点/三角形从 mesh 自己的 geometry 上量，并确认它真的挂在 lensGroup 上。 */
    drawn.lensSurfaces = surf.map((m) => {
      const pos = m.geometry.getAttribute('position');
      const bb = new THREE.Box3().setFromBufferAttribute(pos);
      // 「会不会被渲染」= 沿 parent 链能走到 scene 且自身可见 —— 不能用「有没有 parent」判
      // （挂到一个没加进场景的临时 Group 上同样有 parent，画面里却什么都没有）。
      let root = m; while (root.parent) root = root.parent;
      return {
        inScene: root === scene && m.visible,
        verts: pos.count,
        tris: m.geometry.index ? m.geometry.index.count / 3 : 0,
        xMin: bb.min.x, xMax: bb.max.x,
        rMax: Math.max(bb.max.y, -bb.min.y),
        // 顶点 0 = 第 0 圈第 0 个（r=0）⇒ 就是顶点处 x；最后一个顶点落在 r = aperture 圈上。
        // 中心厚 / 边缘厚都由这两个数算 —— 别用包围盒宽度（凹透镜边缘更厚，宽度 ≠ 厚度）。
        apexX: pos.getX(0),
        edgeX: pos.getX(pos.count - 1)
      };
    });
    // 边缘带：把两个表面在 r = aperture 处的圆环连起来，让镜片看着有厚度
    const edge = [], eIdx = [];
    const xa = (L.apex1 + L.R1) - L.R1 * Math.sqrt(1 - (L.aperture / Math.abs(L.R1)) ** 2);
    const xb = (L.apex2 + L.R2) - L.R2 * Math.sqrt(1 - (L.aperture / Math.abs(L.R2)) ** 2);
    for (let i = 0; i <= segs; i++) {
      const a = i * 2 * Math.PI / segs;
      edge.push(xa, L.aperture * Math.cos(a), L.aperture * Math.sin(a));
      edge.push(xb, L.aperture * Math.cos(a), L.aperture * Math.sin(a));
    }
    for (let i = 0; i < segs; i++) {
      const n = i * 2;
      eIdx.push(n, n + 1, n + 2, n + 1, n + 3, n + 2);
    }
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.Float32BufferAttribute(edge, 3));
    eg.setIndex(eIdx); eg.computeVertexNormals();
    mesh(eg, rimMat, lensGroup);
    // 支架
    const stem = mesh(new THREE.CylinderGeometry(.32, .32, 5.4, 20), matAlu, lensGroup, 0, -L.aperture - 2.6, 0);
    stem.rotation.z = 0;
    mesh(new THREE.CylinderGeometry(1.5, 1.9, .7, 28), matDark, lensGroup, 0, -L.aperture - 5.2, 0);
    // 透镜名标签
    const tag = label(state.kind === 'convex' ? '凸透镜' : '凹透镜', '#bfe9f7', 7.2);
    tag.position.set(0, L.aperture + 2.6, 0);
    lensGroup.add(tag);
  }

  /* --- 主光轴 --- */
  const axisGroup = new THREE.Group(); scene.add(axisGroup);
  {
    const pts = [new THREE.Vector3(-27, 0, 0), new THREE.Vector3(32, 0, 0)];
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(g, new THREE.LineDashedMaterial({
      color: '#7f9aab', transparent: true, opacity: .75, dashSize: 1.1, gapSize: .8
    }));
    line.computeLineDistances();
    axisGroup.add(line);
    const t = label('主光轴', '#8fb3c6', 6.0);
    t.position.set(30.5, 1.6, 0);
    axisGroup.add(t);
  }

  /* --- 焦点 / 虚焦点 --- */
  const focalGroup = new THREE.Group(); scene.add(focalGroup);
  const dotGeo = new THREE.SphereGeometry(.42, 20, 14);
  const dotReal = new THREE.MeshBasicMaterial({ color: '#fbbf24' });
  const dotVirt = new THREE.MeshBasicMaterial({ color: '#a78bfa' });
  let dotA = null, dotB = null, labA = null, labB = null;

  /* --- 光线（每帧重建） --- */
  const rayGroup = new THREE.Group(); scene.add(rayGroup);
  const beamGroup = new THREE.Group(); scene.add(beamGroup);
  const matIn = new THREE.LineBasicMaterial({ color: '#f0b45a', transparent: true, opacity: .95 });
  const matOut = new THREE.LineBasicMaterial({ color: '#4fd1e8', transparent: true, opacity: .95 });
  const matGlass = new THREE.LineBasicMaterial({ color: '#dff7ff', transparent: true, opacity: .35 });
  const matVirt = new THREE.LineDashedMaterial({ color: '#a78bfa', transparent: true, opacity: .8, dashSize: .9, gapSize: .7 });

  /* ================= 每帧算出的几何（供自检读） ================= */
  const drawn = {
    rays: [],        // 每条光线实画的入/内/出三段端点
    axis: null,
    focus: null,     // 近轴出射光线的实测交点
    virtualFocus: null,
    edgeFocus: null, // 边缘光线交点（用于看球差）
    beam: null
  };

  // 光柱上的采样点：按同心圆排布，每圈 6 条（0°/60°/…/300° ⇒ 必有 y = ±r 两条落在 xy 平面内）
  function beamSamples() {
    const Rb = state.beamRadius;
    const ringsFor = { 6: [1], 12: [2], 18: [3] };
    const nRings = (ringsFor[state.rayCount] || [2])[0];
    const out = [];
    for (let k = 0; k < nRings; k++) {
      const r = Rb * (nRings === 1 ? .62 : (.42 + .58 * k / (nRings - 1)));
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3;
        out.push({ y: r * Math.cos(a), z: r * Math.sin(a), r });
      }
    }
    return out;
  }

  function rayFromSample(yi, zi) {
    const a = state.incidence * RAD;
    const dir = new THREE.Vector3(Math.cos(a), Math.sin(a), 0).normalize();
    // 让光线在透镜中心平面（x = 0）处的高度正好是 yi
    const P0 = new THREE.Vector3(RAY_X0, yi + RAY_X0 * Math.tan(a), zi);
    return traceRay(P0, dir, lens());
  }

  function clearGroup(g) { while (g.children.length) g.remove(g.children[0]); }

  // 用一对关于主轴对称的光线（都在 xy 平面内）定出焦点。
  // 与「画了哪几条光线」无关 ⇒ 读数不会随显示模式跳变。
  function focusPair(h) {
    const a = rayFromSample(h, 0), b = rayFromSample(-h, 0);
    if (!a || a.miss || !a.d2 || !b || b.miss || !b.d2) return null;
    return intersectXY({ p: a.P2, d: a.d2 }, { p: b.P2, d: b.d2 });
  }

  // 像方主平面：一条平行于主轴、高度 h 的入射光线，与它出射后【反向延长】的交点所在的平面。
  // 这是主平面的原始定义，几何构造出来 —— 焦距正是从主平面量到焦点的距离。
  // （本页镜片有厚度，主平面落在镜片内部，所以「从透镜中心量起的焦点距离」会比 f 略大；
  //   判据要用「实测焦点 − 主平面」，而不是「实测焦点 − 透镜中心」。）
  function principalH(h) {
    const r = rayFromSample(h, 0);
    if (!r || r.miss || !r.d2) return null;
    // 入射光线（整条直线）与出射光线的反向延长线的交点，x 即主平面位置
    const p = intersectXY({ p: r.P0, d: r.dir }, { p: r.P2, d: r.d2.clone().negate() });
    return p ? p.x : null;
  }

  function addSeg(group, p1, p2, material) {
    const g = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    const line = new THREE.Line(g, material);
    if (material.isLineDashedMaterial) line.computeLineDistances();
    group.add(line);
    return line;
  }

  function rebuildRays() {
    const L = lens();
    clearGroup(rayGroup);
    clearGroup(beamGroup);
    drawn.rays = [];
    drawn.axis = [[-27, 0, 0], [32, 0, 0]];

    // 选要追迹的光线
    let samples;
    if (state.rayMode === 'special') {
      // 三条特殊光线：平行主轴（过 +h）、过光心、过焦点入射
      const h = Math.max(1.6, state.beamRadius * .62);
      samples = [{ y: h, z: 0, r: h, tag: 'parallel' },
                 { y: 0, z: 0, r: 0, tag: 'center' },
                 { y: -h, z: 0, r: h, tag: 'focal' }];
    } else if (state.rayMode === 'single') {
      const h = state.singleHeight;
      samples = [{ y: h, z: 0, r: Math.abs(h), tag: 'single' }];
    } else {
      samples = beamSamples();
    }

    const traced = [];
    for (const s of samples) {
      let r;
      if (s.tag === 'focal') {
        // 过焦点的光线：从 F 点指向镜面 (0, y)
        const F = new THREE.Vector3(-L.fTheory, 0, 0);
        const aim = new THREE.Vector3(0, s.y, 0);
        const dir = aim.clone().sub(F).normalize();
        const t = (RAY_X0 - F.x) / dir.x;
        const P0 = F.clone().addScaledVector(dir, t);
        r = traceRay(P0, dir, L);
      } else {
        r = rayFromSample(s.y, s.z);
      }
      if (!r || r.miss || !r.d2) continue;
      traced.push({ s, r });
    }

    // 近轴 / 边缘两组，各用一对对称光线定焦点（不依赖上面画了哪几条）
    // 近轴取样高度随焦距缩放（h/f 恒定）⇒ 球差的相对量恒定，实测焦距在全焦距段同样准。
    const hNear = Math.min(APERTURE * NEAR_AXIS, state.beamRadius * 0.92, 0.055 * Math.abs(state.f));
    const hEdge = state.beamRadius;
    const fNear = focusPair(hNear);
    const fEdge = (hEdge - hNear) > 0.05 ? focusPair(hEdge) : null;
    drawn.focus = fNear ? { x: fNear.x, y: fNear.y, z: 0 } : null;
    drawn.edgeFocus = fEdge ? { x: fEdge.x, y: fEdge.y, z: 0 } : null;
    // 主平面 + 「实测焦距」（从主平面量到焦点，与侧栏的焦距 f 是同一定义的量）
    drawn.principal = principalH(hNear);
    drawn.measuredFocal = (drawn.focus && drawn.principal !== null) ? (drawn.focus.x - drawn.principal) : null;

    const isConvex = state.kind === 'convex';

    // 画光线
    for (const t of traced) {
      const { r, s } = t;
      const endX = RAY_X1;
      const k = Math.abs(r.d2.x) > 1e-9 ? (endX - r.P2.x) / r.d2.x : 24;
      const P3 = r.P2.clone().addScaledVector(r.d2, Math.max(k, 6));
      const op = state.rayMode === 'all' ? .95 : 1;
      matIn.opacity = op; matOut.opacity = op;
      addSeg(rayGroup, r.P0, r.P1, matIn);
      addSeg(rayGroup, r.P1, r.P2, matGlass);
      addSeg(rayGroup, r.P2, P3, matOut);
      drawn.rays.push({
        tag: s.tag || 'beam', r: s.r,
        in: [r.P0.toArray(), r.P1.toArray()],
        glass: [r.P1.toArray(), r.P2.toArray()],
        out: [r.P2.toArray(), P3.toArray()],
        dOut: r.d2.toArray()
      });
    }

    // 凹透镜的虚焦点：出射光的反向延长线交于入射侧，与出射光线的交点【同一点】
    // （直线求交与方向无关），所以直接取 drawn.focus。画不画由 showVirtual 决定。
    drawn.virtualFocus = null;
    if (!isConvex && drawn.focus) {
      drawn.virtualFocus = { x: drawn.focus.x, y: drawn.focus.y, z: 0 };
      if (state.showVirtual) {
        for (const t of traced) {
          const k = Math.abs(t.r.d2.x) > 1e-9 ? ((drawn.focus.x - 6) - t.r.P2.x) / (-t.r.d2.x) : 6;
          if (k > 0) {
            const Pv = t.r.P2.clone().addScaledVector(t.r.d2, -Math.min(k, 46));
            addSeg(rayGroup, t.r.P2, Pv, matVirt);
          }
        }
      }
    }

    // 光柱体积：只画个淡淡的壳，帮眼睛把「一束光」和「一条线」区分开
    if (state.showBeam && state.rayMode === 'all') {
      const Rb = state.beamRadius;
      const a = state.incidence * RAD;
      const tanA = Math.tan(a);
      // 入射圆柱：轴沿 (cos a, sin a, 0)，中心线 y = x·tan a
      const len = Math.abs(RAY_X0);
      const cyl = new THREE.CylinderGeometry(Rb, Rb, len, 32, 1, true);
      const cy = new THREE.Mesh(cyl, new THREE.MeshBasicMaterial({
        color: '#ffcf8a', transparent: true, opacity: .05, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide
      }));
      const midX = RAY_X0 / 2;
      cy.position.set(midX, midX * tanA, 0);
      cy.rotation.z = a - Math.PI / 2;      // 圆柱默认轴沿 +y，转成 (cos a, sin a, 0)
      beamGroup.add(cy);
      // 出射段
      if (isConvex && drawn.focus) {
        const dx = drawn.focus.x, dy = drawn.focus.y;
        const h = Math.hypot(dx, dy);
        if (h > 2) {
          const cone = new THREE.ConeGeometry(Rb, h, 32, 1, true);
          const cn = new THREE.Mesh(cone, new THREE.MeshBasicMaterial({
            color: '#7fe6f7', transparent: true, opacity: .055, depthWrite: false,
            blending: THREE.AdditiveBlending, side: THREE.DoubleSide
          }));
          cn.position.set(dx / 2, dy / 2, 0);
          cn.rotation.z = Math.atan2(dy, dx) - Math.PI / 2;   // 锥尖指向焦点
          beamGroup.add(cn);
          drawn.beam = { apex: [dx, dy, 0], base: [0, 0, 0], r: Rb, kind: 'converge' };
        }
      } else if (!isConvex) {
        // 凹透镜：出射光向右张开，画一个截锥
        const L = 22;
        const rEnd = Rb * (1 + L / Math.abs(lens().fTheory));
        const fr = new THREE.CylinderGeometry(rEnd, Rb, L, 32, 1, true);
        const fm = new THREE.Mesh(fr, new THREE.MeshBasicMaterial({
          color: '#c4a4ff', transparent: true, opacity: .05, depthWrite: false,
          blending: THREE.AdditiveBlending, side: THREE.DoubleSide
        }));
        fm.position.set(L / 2, L / 2 * tanA, 0);
        fm.rotation.z = a - Math.PI / 2;
        beamGroup.add(fm);
        drawn.beam = { apex: null, base: [0, 0, 0], r: Rb, rEnd, kind: 'diverge' };
      }
    }

    // 焦点标记
    clearGroup(focalGroup);
    dotA = dotB = labA = labB = null;
    if (state.showFocal) {
      const f = drawn.focus;
      if (f && Math.abs(f.x) < 60) {
        dotA = mesh(dotGeo, isConvex ? dotReal : dotVirt, focalGroup, f.x, f.y, f.z);
        const isV = !isConvex;
        labA = label(isV ? '虚焦点 F′' : '焦点 F', isV ? '#c9b2ff' : '#ffd884', 8.0);
        labA.position.set(f.x, f.y + 1.9, f.z);
        focalGroup.add(labA);
      }
      // 2F 参考点（只在正看时标，帮助理解 f 的含义）
      if (isConvex) {
        const x2 = 2 * lens().fTheory;
        const d2m = mesh(new THREE.SphereGeometry(.24, 16, 12), new THREE.MeshBasicMaterial({ color: '#7f9aab' }), focalGroup, x2, 0, 0);
        const l2 = label('2F', '#8fb3c6', 4.6);
        l2.position.set(x2, -1.7, 0);
        focalGroup.add(l2);
        void d2m;
      }
    }
    axisGroup.visible = state.showAxis;

    updateReadouts();
  }

  /* ================= 读数 ================= */
  function updateReadouts() {
    const isConvex = state.kind === 'convex';
    const f = lens().fTheory;
    const mf = drawn.measuredFocal;                    // 实测焦距（从像方主平面量到焦点）
    const txt = (v) => Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(2) + ' cm' : '—';
    $('roKind').textContent = isConvex ? '凸透镜' : '凹透镜';
    $('roF').textContent = Math.abs(f).toFixed(1) + ' cm';
    $('roFocus').textContent = txt(mf);
    $('roConv').textContent = isConvex ? '会聚' : '发散';
    $('roFocusLabel').textContent = '实测焦距';
    $('metricFocusLabel').textContent = isConvex ? '实测焦距' : '实测焦距（虚）';
    $('metricKind').textContent = isConvex ? '凸透镜' : '凹透镜';
    $('metricF').textContent = Math.abs(f).toFixed(1) + ' cm';
    $('metricFocus').textContent = txt(mf);
    $('metricEffect').textContent = isConvex ? '会聚（聚焦）' : '发散（散开）';
    $('roNote').textContent = isConvex
      ? '实测焦距由出射光求交算出，从像方主平面量起'
      : '负号表示焦点是虚焦点，落在入射侧';
  }

  /* ================= 渲染 ================= */
  function cameraPosition() {
    const r = 104 / state.zoom;
    camera.position.set(
      target.x + r * Math.sin(state.yaw) * Math.cos(state.pitch),
      target.y + r * Math.sin(state.pitch),
      r * Math.cos(state.yaw) * Math.cos(state.pitch)
    );
    camera.lookAt(target);
  }

  function resize() {
    const el = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(el.width)), h = Math.max(1, Math.round(el.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    state.w = w; state.h = h; state.dpr = dpr;
  }

  function render() {
    resize();
    cameraPosition();
    renderer.render(scene, camera);
  }

  function rebuildAll() {
    buildLens(lens());
    rebuildRays();
    render();
  }

  /* ================= 交互：相机 ================= */
  let dragging = false, prev = null;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true; prev = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    state.yaw += (e.clientX - prev.x) * .006;
    state.pitch = clamp(state.pitch + (prev.y - e.clientY) * .005, -1.5, 1.5);
    prev = { x: e.clientX, y: e.clientY };
    render();
  });
  const endDrag = (e) => { dragging = false; try { canvas.releasePointerCapture(e.pointerId); } catch (_) {} };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    state.zoom = clamp(state.zoom * (e.deltaY > 0 ? .93 : 1.07), .5, 3.2);
    render();
  }, { passive: false });
  canvas.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') state.yaw -= .1;
    else if (e.key === 'ArrowRight') state.yaw += .1;
    else if (e.key === 'ArrowUp') state.pitch = clamp(state.pitch + .1, -1.5, 1.5);
    else if (e.key === 'ArrowDown') state.pitch = clamp(state.pitch - .1, -1.5, 1.5);
    else if (e.key === '+' || e.key === '=') state.zoom = clamp(state.zoom * 1.1, .5, 3.2);
    else if (e.key === '-' || e.key === '_') state.zoom = clamp(state.zoom * .9, .5, 3.2);
    else return;
    e.preventDefault(); render();
  });

  /* 视角按钮高亮：唯一真源。点击 / 复位 / 自检钩子 setView 三处都走它 ——
     原来点击与复位各写一份、钩子那份漏了 ⇒ 程序化切视角时按钮高亮停在旧档。 */
  function syncViewButtons(name) {
    document.querySelectorAll('.toolbar button[data-view]').forEach(x => x.classList.toggle('active', x.dataset.view === name));
  }
  function applyView(name) {
    const v = VIEWS[name];
    if (!v) return false;
    state.yaw = v[0]; state.pitch = v[1]; state.zoom = v[2];
    state.view = name;
    syncViewButtons(name);
    return true;
  }

  document.querySelectorAll('.toolbar button[data-view]').forEach((b) => {
    b.addEventListener('click', () => { applyView(b.dataset.view); render(); });
  });
  $('resetView').addEventListener('click', () => { applyView('perspective'); render(); });

  /* ================= 交互：控件 ================= */
  function syncLensButtons() {
    document.querySelectorAll('#lensKind button').forEach(b => b.classList.toggle('active', b.dataset.kind === state.kind));
    document.querySelectorAll('#rayCount button').forEach(b => b.classList.toggle('active', +b.dataset.n === state.rayCount));
    document.querySelectorAll('#rayMode button').forEach(b => b.classList.toggle('active', b.dataset.mode === state.rayMode));
  }

  document.querySelectorAll('#lensKind button').forEach(b => b.addEventListener('click', () => {
    state.kind = b.dataset.kind; syncLensButtons(); rebuildAll();
  }));
  document.querySelectorAll('#rayCount button').forEach(b => b.addEventListener('click', () => {
    state.rayCount = +b.dataset.n; syncLensButtons(); rebuildAll();
  }));
  document.querySelectorAll('#rayMode button').forEach(b => b.addEventListener('click', () => {
    state.rayMode = b.dataset.mode; syncLensButtons(); rebuildAll();
  }));

  $('focalLength').addEventListener('input', (e) => {
    state.f = +e.target.value;
    $('focalValue').textContent = state.f.toFixed(1) + ' cm';
    rebuildAll();
  });
  $('beamRadius').addEventListener('input', (e) => {
    state.beamRadius = +e.target.value;
    $('beamValue').textContent = state.beamRadius.toFixed(1) + ' cm';
    rebuildAll();
  });
  $('incidence').addEventListener('input', (e) => {
    state.incidence = +e.target.value;
    $('angleValue').textContent = state.incidence.toFixed(0) + '°';
    rebuildAll();
  });
  $('singleHeight').addEventListener('input', (e) => {
    state.singleHeight = +e.target.value;
    $('singleValue').textContent = state.singleHeight.toFixed(1) + ' cm';
    if (state.rayMode === 'single') rebuildAll();
  });
  ['showFocal', 'showAxis', 'showVirtual', 'showBeam'].forEach((id) => {
    $(id).addEventListener('change', (e) => {
      const k = 'show' + id.slice(4);
      state[k] = e.target.checked;
      rebuildAll();
    });
  });

  function measure() {
    const mf = drawn.measuredFocal;
    if (!Number.isFinite(mf)) return;
    const theory = lens().fTheory;
    const err = Math.abs(mf - theory) / Math.abs(theory) * 100;
    $('finding').innerHTML = '<b>聚焦法测焦距：</b>把平行光正对透镜，量出光斑最小处到<b>主平面</b>的距离，' +
      '就得到焦距 <b>f ≈ ' + mf.toFixed(2) + ' cm</b>；侧栏设定的焦距是 ' + theory.toFixed(2) + ' cm，' +
      '两者相差 <b>' + err.toFixed(2) + '%</b>（差别来自球差：把「光束半径」调小会更接近）。' +
      (state.showBeam ? '' : '（把「光柱体积」打开更容易看到光斑收成一点。）');
    if (dotA) dotA.scale.setScalar(1.9);
    render();
  }
  $('measureBtn').addEventListener('click', measure);
  $('measureBtn2').addEventListener('click', measure);

  /* ================= 记录表 ================= */
  const ROW_KIND = () => state.kind === 'convex' ? '凸透镜' : '凹透镜';
  function renderRecords() {
    const tb = $('records');
    if (!state.records.length) {
      tb.innerHTML = '<tr><td colspan="7" class="empty">尚无记录，先调一组数据再点「记录当前数据」</td></tr>';
    } else {
      tb.innerHTML = state.records.map((r, i) =>
        '<tr class="filled"><td>' + (i + 1) + '</td><td>' + r.kind + '</td><td>' + r.f.toFixed(1) + '</td><td>' +
        (Number.isFinite(r.near) ? r.near.toFixed(2) : '—') + '</td><td>' +
        (Number.isFinite(r.edge) ? r.edge.toFixed(2) : '—') + '</td><td>' +
        (Number.isFinite(r.aberration) ? r.aberration.toFixed(2) : '—') + '</td><td>' + r.effect + '</td></tr>'
      ).join('');
    }
    $('summary').textContent = state.records.length >= 2
      ? '已记录 ' + state.records.length + ' 组：焦距变大时焦点也随之外移，两者始终相等；边缘光线焦点比近轴光线更靠近透镜，这就是球差。'
      : '记录两组以上，比较不同焦距下焦点位置与焦距的对应关系。';
  }
  function recordNow() {
    const near = drawn.measuredFocal;                                  // 近轴实测焦距（主平面起算）
    const edge = (drawn.edgeFocus && drawn.principal !== null) ? (drawn.edgeFocus.x - drawn.principal) : NaN;
    const row = {
      kind: ROW_KIND(), f: lens().fTheory,
      near: Number.isFinite(near) ? near : NaN,
      edge: Number.isFinite(edge) ? edge : NaN,
      aberration: (Number.isFinite(near) && Number.isFinite(edge)) ? (near - edge) : NaN,
      effect: state.kind === 'convex' ? '会聚' : '发散'
    };
    state.records.push(row);
    if (state.records.length > 6) state.records.shift();
    renderRecords();
    const tb = $('records');
    const last = tb.querySelector('tr:last-child');
    if (last) { last.classList.add('flash'); setTimeout(() => last.classList.remove('flash'), 1300); }
  }
  $('recordBtn').addEventListener('click', recordNow);
  $('stageRecordBtn').addEventListener('click', recordNow);
  $('clearRecords').addEventListener('click', () => { state.records = []; renderRecords(); });

  $('resetAll').addEventListener('click', () => {
    Object.assign(state, {
      kind: 'convex', f: 12, rayCount: 12, beamRadius: 3.6, incidence: 0,
      rayMode: 'all', singleHeight: 2.4,
      showFocal: true, showAxis: true, showVirtual: true, showBeam: true
    });
    applyView('perspective');   // 机位唯一真源（原来自写一遍 VIEWS.perspective）
    $('focalLength').value = 12; $('focalValue').textContent = '12.0 cm';
    $('beamRadius').value = 3.6; $('beamValue').textContent = '3.6 cm';
    $('incidence').value = 0; $('angleValue').textContent = '0°';
    $('singleHeight').value = 2.4; $('singleValue').textContent = '2.4 cm';
    ['showFocal', 'showAxis', 'showVirtual', 'showBeam'].forEach(id => { $(id).checked = true; });
    $('finding').textContent = '平行光穿过透镜后，观察光线是否交于一点。';
    syncLensButtons();
    rebuildAll();
  });

  let rt = null;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { if (!dragging) render(); }, 120);
  });

  /* ================= 自检钩子 =================
     暴露页面【真正用到的】那份几何与判定，而不是另写一份。
     会变的量一律写成 get 访问器 —— 写成快照会让断言读到死值。 */
  window.__lensLab = {
    state,
    get lens() { return lens(); },
    get focus() { return drawn.focus; },
    get edgeFocus() { return drawn.edgeFocus; },
    get virtualFocus() { return drawn.virtualFocus; },
    get rays() { return drawn.rays; },
    get lensSurfaces() { return drawn.lensSurfaces; },
    get drawn() { return drawn; },
    get records() { return state.records.slice(); },
    trace: (yi, zi, kindOverride, fOverride) => {
      const savedKind = state.kind, savedF = state.f;
      if (kindOverride) state.kind = kindOverride;
      if (fOverride != null) state.f = fOverride;
      const r = rayFromSample(yi, zi);
      state.kind = savedKind; state.f = savedF;
      return r ? {
        P0: r.P0.toArray(), P1: r.P1.toArray(), P2: r.P2.toArray(),
        dIn: r.dir.toArray(), dMid: r.d1.toArray(), dOut: r.d2.toArray()
      } : null;
    },
    // 与页面渲染同源的焦点求解：自检拿到的是画出去的那一个
    solve: (kind, f, h) => {
      const sk = state.kind, sf = state.f, si = state.incidence;
      state.kind = kind; state.f = f; state.incidence = 0;
      const pt = focusPair(h);
      state.kind = sk; state.f = sf; state.incidence = si;
      return pt ? pt.toArray() : null;
    },
    // 凹透镜虚焦点：与出射光线交点同一点（直线求交与方向无关），保留同名入口便于自检对照
    solveVirtual: (kind, f, h) => {
      const sk = state.kind, sf = state.f, si = state.incidence;
      state.kind = kind; state.f = f; state.incidence = 0;
      const pt = focusPair(h);
      state.kind = sk; state.f = sf; state.incidence = si;
      return pt ? pt.toArray() : null;
    },
    setKind: (k) => { state.kind = k; syncLensButtons(); rebuildAll(); },
    setFocal: (v) => { state.f = v; $('focalLength').value = v; $('focalValue').textContent = v.toFixed(1) + ' cm'; rebuildAll(); },
    setIncidence: (v) => { state.incidence = v; $('incidence').value = v; $('angleValue').textContent = v.toFixed(0) + '°'; rebuildAll(); },
    setBeamRadius: (v) => { state.beamRadius = v; $('beamRadius').value = v; $('beamValue').textContent = v.toFixed(1) + ' cm'; rebuildAll(); },
    setRayMode: (m) => { state.rayMode = m; syncLensButtons(); rebuildAll(); },
    setView: (name) => { if (applyView(name)) render(); },
    measure, recordNow,
    clearRecords: () => { state.records = []; renderRecords(); },
    render, rebuildAll,
    size: () => ({ w: state.w, h: state.h, dpr: state.dpr }),
    debug() {
      const L = lens(), fo = drawn.focus;
      return {
        kind: state.kind, fSetting: state.f, fTheory: L.fTheory, R: L.R,
        R1: L.R1, R2: L.R2, c1: L.c1, c2: L.c2,
        focusX: fo ? fo.x : null, focusY: fo ? fo.y : null,
        edgeFocusX: drawn.edgeFocus ? drawn.edgeFocus.x : null,
        virtualX: drawn.virtualFocus ? drawn.virtualFocus.x : null,
        principalX: drawn.principal,
        measuredFocal: drawn.measuredFocal,
        rayCount: drawn.rays.length,
        nearAxisLimit: APERTURE * NEAR_AXIS,
        aperture: APERTURE, thick: THICK, n: N_GLASS,
        incidence: state.incidence,
        metricFocus: $('metricFocus').textContent,
        roFocus: $('roFocus').textContent,
        records: state.records.length
      };
    }
  };

  syncLensButtons();
  renderRecords();
  rebuildAll();
  // 首屏尺寸可能还没稳定，补一次
  requestAnimationFrame(() => { render(); });
})();
