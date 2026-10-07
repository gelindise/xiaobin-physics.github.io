import * as THREE from './assets/optics-three.min.js';

// 生活中的透镜 —— 立体模型。
// 世界坐标以厘米为单位，主轴 = x 轴（光从左向右传播），透镜中心在 x = 0。
// 照相机 / 投影仪 / 放大镜 用的是【同一片凸透镜】，唯一的区别是物体放在哪一段物距上。
//
// 像的位置有两条互不引用的路径：
//   ① 公式 1/f = 1/u + 1/v（u、v 都从【主平面】量起）
//   ② 从物体顶端发出的两条光线，在球面透镜的前后表面各折射一次（Snell 定律），
//      出射光线（或其反向延长线）的真实交点
// 两者对得上，才说明屏上那个像是真的被折出来的。
//
// 🔴 镜片参数是【算出来的，不是随手定的】（见 /tmp/lenscalc2.js 的扫描）：
//    单片球面透镜的球差按 Δ/f ≈ 3.87%·(h/1cm)²·(6cm/f)^1.9 增长。要让追迹与公式
//    差在 1~2% 以内，必须同时满足 ① 镜片够厚（d=2.4 ⇒ 两球面不会自交，口径 2.8 安全）
//    ② 焦距够长（f ≥ 12）③ 追迹用的两条光线【关于主轴对称、且贴近主轴】（±0.036f），
//    不能用「边缘光线 + 主光线」—— 那个组合的交点落在边缘焦点上，实测差 30%。
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const canvas = $('sceneCanvas');
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const RAD = Math.PI / 180;

  /* ================= 物理常量 ================= */
  const N_GLASS = 1.50;      // 玻璃折射率
  const THICK = 2.4;         // 透镜中心厚度 cm（加厚：短焦时两球面才不会自交）
  const APERTURE = 2.8;      // 镜片半口径 cm
  const X_LEFT = -38;        // 光具座左端
  const X_RIGHT = 34;        // 光具座右端
  const X_LIMIT = 33;        // 像超出这个位置就算「超出导轨」
  const U_MIN = 3, U_MAX = 36;
  const F_MIN = 12, F_MAX = 15;
  const EPS_NATURE = 0.22;   // 「u = f」「u = 2f」的判定半宽（只用于文案，不用于物理）
  const TRACE_K = 0.036;     // 追迹求交点用的光线高度 = TRACE_K × f（贴近主轴 ⇒ 球差小）
  const SCREEN_W = 7.5, SCREEN_H = 6.5; // 光屏尺寸 cm（比像略大 ⇒ 像占屏面积够大）
  const SCREEN_PPM = 48;                // 光屏贴图分辨率 px/cm

  /* ================= 透镜几何 =================
     表面参数化：顶点 apex、曲率半径 R（带符号，球心在 apex + R 一侧）。
     剖面上 x(r) = (apex + R) − R·√(1 − (r/R)²)，绕 x 轴旋转即得镜面。
     本页只用凸透镜：R₁ = +R、R₂ = −R（两面都向中间凸 ⇒ 中间厚、边缘薄）。 */
  function radiusForFocal(f) {
    const n = N_GLASS, d = THICK, k = 1 / Math.abs(f);
    const s = Math.sqrt(Math.max(0, 1 - k * d / n));
    return (n - 1) * (1 + s) / k;
  }
  function focalFromRadius(R1, R2, d) {
    const n = N_GLASS;
    const P = (n - 1) * (1 / R1 - 1 / R2 + (n - 1) * d / (n * R1 * R2));
    return 1 / P;
  }
  function lensGeom(f) {
    const R = radiusForFocal(Math.abs(f));
    const R1 = R, R2 = -R;
    return {
      R1, R2, R,
      apex1: -THICK / 2, apex2: THICK / 2,
      c1: -THICK / 2 + R1, c2: THICK / 2 + R2,
      d: THICK, aperture: APERTURE, n: N_GLASS,
      fTheory: focalFromRadius(R1, R2, THICK)
    };
  }
  // 两球面相交的半径：超过它镜片就「内外翻转」了（本页参数下恒 > 口径）
  function crossRadius(f) {
    const R = radiusForFocal(f);
    const s = 1 - THICK / (2 * R);
    return s <= 0 ? Infinity : R * Math.sqrt(Math.max(0, 1 - s * s));
  }
  // 主平面：厚透镜的物距 / 像距必须【从主平面量起】。等半径双凸镜的两个主平面
  // 左右对称地落在镜片内部（f=14 时离中心 0.379 cm —— 对 u = 7.7 的放大镜就是 5% 的差）。
  //   H  ：从前顶点沿 +x 偏移 h1 = −f·(n−1)·d / (n·R₂)
  //   H′ ：从后顶点沿 +x 偏移 h2 = −f·(n−1)·d / (n·R₁)
  function principalPlanes(L) {
    const f = L.fTheory, n = L.n, d = L.d;
    return {
      H: L.apex1 + (-f * (n - 1) * d / (n * L.R2)),
      Hp: L.apex2 + (-f * (n - 1) * d / (n * L.R1))
    };
  }

  /* ================= 光线追迹 ================= */
  function intersectSphere(P0, d, Cx, R) {
    const ex = P0.x - Cx, ey = P0.y, ez = P0.z;
    const b = d.x * ex + d.y * ey + d.z * ez;
    const c = ex * ex + ey * ey + ez * ez - R * R;
    const D = b * b - c;
    if (D < 0) return null;
    const sq = Math.sqrt(D);
    // 🔴 不能一律取「最小的正根」：球面在给定高度上有两个交点，而镜面只是其中【一半】——
    //    表面参数化是 x(r) = (apex+R) − R·√(1−(r/R)²)，所以 x − 球心 的符号恒等于 −R 的符号。
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
  // 追迹一条光线：前后表面各折射一次
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
  // 两条出射光线的交点（取【直线】交点 ⇒ 虚像也能求）
  function intersectXY(A, B) {
    const den = A.d.x * B.d.y - A.d.y * B.d.x;
    if (Math.abs(den) < 1e-14) return null;
    const dx = B.p.x - A.p.x, dy = B.p.y - A.p.y;
    const s = (dx * B.d.y - dy * B.d.x) / den;
    return new THREE.Vector3(A.p.x + s * A.d.x, A.p.y + s * A.d.y, 0);
  }

  /* ================= 状态 ================= */
  const VIEWS = {
    side:        [-0.02, 0.02, 1.00],
    perspective: [-0.62, 0.26, 1.00],
    top:         [0.00, 1.40, 1.00],
    axis:        [1.42, 0.10, 1.00]
  };

  // 三种应用：用的是同一片凸透镜，只是物距倍数不同（相对 f）
  const MODES = {
    camera:    { key: 'camera',    name: '照相机', uRatio: 2.40, objH: 2.6, objW: 4.4,
                 flip: false, art: 'scene', screen: true,  holder: '胶片',
                 sub: '远处的风景：u > 2f' },
    projector: { key: 'projector', name: '投影仪', uRatio: 1.90, objH: 2.6, objW: 3.6,
                 flip: true,  art: 'slide', screen: true,  holder: '银幕',
                 sub: '幻灯片（倒插）：f < u < 2f' },
    magnifier: { key: 'magnifier', name: '放大镜', uRatio: 0.55, objH: 1.8, objW: 2.4,
                 flip: false, art: 'text',  screen: false, holder: '（无）',
                 sub: '书上的字：u < f' }
  };
  const APP_ORDER = ['camera', 'projector', 'magnifier'];

  const state = {
    app: 'projector',
    u: 26.6, f: 14,
    rayMode: 'special',      // 'special' 三条特殊光线 / 'bundle' 光线束
    showRays: true, showScreen: true, showVirtual: true,
    showFocal: true, showAxis: true,
    yaw: VIEWS.perspective[0], pitch: VIEWS.perspective[1], zoom: 1.0,
    view: 'perspective',     // 当前视角档名（applyView 维护；只此一处写初值）
    records: []
  };
  const mode = () => MODES[state.app];
  const lens = () => lensGeom(state.f);

  /* ================= 成像（解析路径） ================= */
  // 🔴 u 的定义：**物到【前主平面】的距离**。这样物理上恰好是教科书的 1/f = 1/u + 1/v，
  //    u = f 与 u = 2f 两个跳变点也正好落在刻度上。若改成「物到透镜中心」，
  //    两个跳变点会整体偏 0.376 cm（= 主平面偏移），刻度、文案、物理三处就对不上了。
  function optics() {
    const L = lens();
    const pp = principalPlanes(L);
    const uH = state.u;
    const f = L.fTheory;
    const none = Math.abs(uH - f) < 1e-6;
    const vH = none ? Infinity : (uH * f) / (uH - f);
    const xImg = none ? Infinity : (pp.Hp + vH);
    const m = none ? Infinity : (-vH / uH);
    const offBench = !none && Math.abs(xImg) > X_LIMIT;
    return { f, pp, uH, vH, xImg, m, none, offBench, H: pp.H, Hp: pp.Hp, objX: pp.H - uH };
  }
  function solveAt(u, f) {
    const L = lensGeom(f);
    const pp = principalPlanes(L);
    const uH = u;
    const none = Math.abs(uH - L.fTheory) < 1e-6;
    const vH = none ? Infinity : (uH * L.fTheory) / (uH - L.fTheory);
    return { f: L.fTheory, uH, vH, xImg: none ? Infinity : pp.Hp + vH,
             m: none ? Infinity : -vH / uH, none, H: pp.H, Hp: pp.Hp, objX: pp.H - uH };
  }

  // 像的性质。物理判据（供断言用）：
  //   sign(m) 只在 u = f 处变号；|m| 与 1 的大小关系只在 u = 2f 处翻转。
  function natureOf(u, f) {
    const L = lensGeom(f);
    const uH = u;
    const none = Math.abs(uH - L.fTheory) < EPS_NATURE;
    if (none) {
      return { key: 'none', text: '不成像', inverted: false, size: '—', real: false,
               catchable: false, none: true };
    }
    const vH = (uH * L.fTheory) / (uH - L.fTheory);
    const m = -vH / uH;
    const real = m < 0;
    const am = Math.abs(m);
    const size = Math.abs(am - 1) < 0.02 ? '等大' : (am > 1 ? '放大' : '缩小');
    return {
      key: real ? (am > 1 ? 'bigReal' : (size === '等大' ? 'equalReal' : 'smallReal')) : 'virtual',
      text: (real ? '倒立' : '正立') + size + (real ? '实像' : '虚像'),
      inverted: real, size, real, catchable: real, none: false, m
    };
  }

  /* ================= 成像（真实折射路径） ================= */
  // 物面的世界坐标：从【前主平面】往回量 u ⇒ x = H − u（H 是负的）
  const objXFor = (u, f) => principalPlanes(lensGeom(f)).H - u;

  // 从物体顶端 T 发出的两条光线，射向镜面上【关于主轴对称】的两个高度 ±hh。
  // 🔴 不要用「平行主轴光线 + 过光心光线」：那个组合的交点落在【边缘焦点】上，
  //    实测与公式差 30%（见 /tmp/lenscalc2.js）。对称的近轴光线对才是良态的。
  function traceImage(xObj, f, yT) {
    const L = lensGeom(f);
    const hh = TRACE_K * f;
    const T = new THREE.Vector3(xObj, yT, 0);
    const mk = (yAim) => traceRay(T.clone(), new THREE.Vector3(-xObj, yAim - yT, 0).normalize(), L);
    const r1 = mk(+hh), r2 = mk(-hh);
    if (!r1 || r1.miss || !r1.d2 || !r2 || r2.miss || !r2.d2) return null;
    const P = intersectXY({ p: r1.P2, d: r1.d2 }, { p: r2.P2, d: r2.d2 });
    return P ? { P, r1, r2, T, hh } : null;
  }
  // 从 T 出发、射向镜面高度 yAim 的一条光线
  function traceToHeight(xObj, f, yT, yAim) {
    const L = lensGeom(f);
    const T = new THREE.Vector3(xObj, yT, 0);
    return traceRay(T, new THREE.Vector3(-xObj, yAim - yT, 0).normalize(), L);
  }

  /* ================= three.js 场景 ================= */
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, alpha: false, powerPreference: 'high-performance',
      // 自检要能读画布像素（drawImage 取回 GPU 结果）⇒ 保留绘制缓冲
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
  scene.fog = new THREE.Fog('#08131f', 150, 260);

  // 环境贴图：玻璃的 transmission 需要有东西可折，否则镜片是一团黑。
  // 用一张 canvas 渐变当等距柱状环境图（不引外部 HDR），失败就退回纯半透明材质。
  let envTex = null;
  try {
    const ec = document.createElement('canvas'); ec.width = 256; ec.height = 128;
    const eg = ec.getContext('2d');
    const grd = eg.createLinearGradient(0, 0, 0, 128);
    grd.addColorStop(0, '#cfe8f7'); grd.addColorStop(.42, '#6d90ab');
    grd.addColorStop(.64, '#2b3d4d'); grd.addColorStop(1, '#101922');
    eg.fillStyle = grd; eg.fillRect(0, 0, 256, 128);
    eg.fillStyle = 'rgba(255,255,255,.95)';
    eg.beginPath(); eg.ellipse(64, 26, 38, 16, 0, 0, 7); eg.fill();
    eg.beginPath(); eg.ellipse(190, 42, 26, 11, 0, 0, 7); eg.fill();
    const etex = new THREE.CanvasTexture(ec);
    etex.mapping = THREE.EquirectangularReflectionMapping;
    etex.colorSpace = THREE.SRGBColorSpace;
    const pm = new THREE.PMREMGenerator(renderer);
    envTex = pm.fromEquirectangular(etex).texture;
    pm.dispose(); etex.dispose();
    scene.environment = envTex;
  } catch (err) { envTex = null; scene.environment = null; }

  const camera = new THREE.PerspectiveCamera(37, 1, 0.1, 800);
  // 取景中心对准内容质量中心（光具座沉在下半部 ⇒ 目标点略低于主轴），
  // CAM_R 由 dev-imaging-frame.js 的 frameProbe 量出：76 ⇒ 立体视角下内容填满约 84%×90%，仍全在画面内。
  const target = new THREE.Vector3(-2, -1.0, 0);
  let CAM_R = 76;
  // 🔴 竖直视场固定 37°，横向视野 ∝ aspect ⇒ 视口越窄，横向越容易把光具座两端挤出画外。
  //    光具座横跨 72 cm（最远物距 u=36 时物体在 x=−36.4），窄视口必须【后退】。
  //    以设计点纵横比 1.99 为基准，窄了就按比例加大机位半径，宽了不动（别把画面拉小）。
  const ASPECT_REF = 1.99;

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

  // 面片细边框：正视视角下「一片贴图」几乎没有轮廓（贴图与背景同色就整个消失），
  // 加一圈亮线才看得出这里有一块物面 / 像面。挂在面片【子节点】上 ⇒ 跟着它一起转、一起缩放。
  // 沿法线微偏 0.03 cm 躲开共面 z-fighting。
  function addOutline(parent, w, h, color, opacity = .62, dashed = false) {
    const geo = new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, h));
    const m = dashed
      ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: .55, gapSize: .38, depthWrite: false })
      : new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    const line = new THREE.LineSegments(geo, m);
    line.position.z = 0.03;
    if (dashed) line.computeLineDistances();
    parent.add(line);
    return line;
  }

  const BENCH_TOP = -7.2;
  /* --- 光具座 --- */
  const bench = new THREE.Group(); scene.add(bench);
  const benchW = X_RIGHT - X_LEFT + 4, benchCx = (X_LEFT + X_RIGHT) / 2;
  mesh(new THREE.BoxGeometry(benchW, 1.1, 20), matAlu, bench, benchCx, BENCH_TOP - 0.55, 0);
  mesh(new THREE.BoxGeometry(benchW, .45, 20), matDark, bench, benchCx, BENCH_TOP - 1.25, 0);
  // 刻度尺（每 2 cm 一小格、每 10 cm 一大格）
  const tickMat = new THREE.LineBasicMaterial({ color: '#5b6b79', transparent: true, opacity: .85 });
  const tickVerts = [];
  for (let x = X_LEFT; x <= X_RIGHT; x += 2) {
    const big = (x % 10 === 0), h = big ? 1.5 : .8;
    tickVerts.push(x, BENCH_TOP + 0.9, 9.6, x, BENCH_TOP + 0.9 - h, 9.6);
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
    color: '#d8f0fb', metalness: 0, roughness: .10,
    transmission: envTex ? .88 : 0, thickness: THICK * 1.1, ior: 1.5,
    transparent: true, opacity: envTex ? .62 : .40,
    side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.3,
    clearcoat: 1, clearcoatRoughness: .06,
    emissive: new THREE.Color('#0f3346'), emissiveIntensity: .55
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
    // 把【实际提交给渲染器的】几何记进 drawn：自检断的是真正画出去的顶点
    drawn.lensSurfaces = surf.map((m) => {
      const pos = m.geometry.getAttribute('position');
      const bb = new THREE.Box3().setFromBufferAttribute(pos);
      let root = m; while (root.parent) root = root.parent;
      return {
        inScene: root === scene && m.visible,
        verts: pos.count,
        tris: m.geometry.index ? m.geometry.index.count / 3 : 0,
        xMin: bb.min.x, xMax: bb.max.x,
        rMax: Math.max(bb.max.y, -bb.min.y),
        apexX: pos.getX(0),                    // 顶点 0 = r=0 那个 ⇒ 中心厚度用它算
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
    mesh(new THREE.CylinderGeometry(.30, .30, 4.4, 20), matAlu, lensGroup, 0, -L.aperture - 2.2, 0);
    mesh(new THREE.CylinderGeometry(1.3, 1.6, .7, 28), matDark, lensGroup, 0, -L.aperture - 4.6, 0);
    const tag = label('凸透镜', '#bfe9f7', 7.2);
    tag.position.set(0, L.aperture + 2.4, 0);
    lensGroup.add(tag);
  }

  /* --- 主光轴 --- */
  const axisGroup = new THREE.Group(); scene.add(axisGroup);
  {
    const pts = [new THREE.Vector3(X_LEFT - 1, 0, 0), new THREE.Vector3(X_RIGHT + 1, 0, 0)];
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(g, new THREE.LineDashedMaterial({
      color: '#7f9aab', transparent: true, opacity: .75, dashSize: 1.1, gapSize: .8
    }));
    line.computeLineDistances();
    axisGroup.add(line);
    const t = label('主光轴', '#8fb3c6', 6.0);
    t.position.set(X_RIGHT - 1.5, 1.5, 0);
    axisGroup.add(t);
  }

  /* --- 焦点 / 2F 标记 --- */
  const focalGroup = new THREE.Group(); scene.add(focalGroup);
  const dotGeo = new THREE.SphereGeometry(.34, 20, 14);
  const matFReal = new THREE.MeshBasicMaterial({ color: '#fbbf24' });
  const matF2 = new THREE.MeshBasicMaterial({ color: '#7f9aab' });

  /* --- 物体、光屏、虚像 --- */
  const objGroup = new THREE.Group(); scene.add(objGroup);
  const screenGroup = new THREE.Group(); scene.add(screenGroup);
  const ghostGroup = new THREE.Group(); scene.add(ghostGroup);

  /* --- 光线 --- */
  const rayGroup = new THREE.Group(); scene.add(rayGroup);
  const matIn = new THREE.LineBasicMaterial({ color: '#f0b45a', transparent: true, opacity: .95 });
  const matOut = new THREE.LineBasicMaterial({ color: '#4fd1e8', transparent: true, opacity: .95 });
  const matGlass = new THREE.LineBasicMaterial({ color: '#dff7ff', transparent: true, opacity: .32 });
  const matVirt = new THREE.LineDashedMaterial({ color: '#a78bfa', transparent: true, opacity: .85, dashSize: .9, gapSize: .7 });

  /* ================= 物体 / 像的贴图 ================= */
  // 三种「物」各有形状与朝向，倒立 / 正立才看得出来：
  //   照相机 → 风景（太阳在左上、房子在左下）；投影仪 → 幻灯片上一个 F；放大镜 → 一个字。
  function artScene(g, W, H) {
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#5fb4ea'); sky.addColorStop(.6, '#c9e9f8'); sky.addColorStop(1, '#eaf7dd');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    g.fillStyle = '#ffd85e'; g.beginPath(); g.arc(W * .21, H * .19, H * .10, 0, 7); g.fill();
    g.fillStyle = '#8cc46a'; g.fillRect(0, H * .70, W, H * .30);
    g.fillStyle = '#6b4a2f'; g.fillRect(W * .70, H * .58, W * .045, H * .24);
    g.fillStyle = '#3f8f47'; g.beginPath(); g.arc(W * .7225, H * .50, H * .155, 0, 7); g.fill();
    g.fillStyle = '#e8ddc9'; g.fillRect(W * .13, H * .52, W * .20, H * .20);
    g.fillStyle = '#b4552f'; g.beginPath();
    g.moveTo(W * .10, H * .52); g.lineTo(W * .23, H * .40); g.lineTo(W * .36, H * .52); g.closePath(); g.fill();
    g.fillStyle = '#4a6b8a'; g.fillRect(W * .19, H * .62, W * .07, H * .10);
  }
  function artSlide(g, W, H) {
    g.fillStyle = '#0d1b2a'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#f8fafc';
    g.fillRect(W * .30, H * .16, W * .10, H * .68);
    g.fillRect(W * .30, H * .16, W * .40, H * .12);
    g.fillRect(W * .30, H * .46, W * .28, H * .11);
    g.strokeStyle = '#38bdf8'; g.lineWidth = Math.max(2, W * .022);
    g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, W - g.lineWidth, H - g.lineWidth);
    g.fillStyle = '#7dd3fc'; g.font = 'bold ' + Math.round(H * .12) + 'px Inter, sans-serif';
    g.textAlign = 'left'; g.textBaseline = 'bottom';
    g.fillText('SLIDE', W * .08, H * .96);
  }
  function artText(g, W, H) {
    g.fillStyle = '#fdf6e3'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#c9bda0'; g.lineWidth = Math.max(2, W * .018);
    g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, W - g.lineWidth, H - g.lineWidth);
    g.fillStyle = '#1e293b';
    g.font = 'bold ' + Math.round(H * .52) + 'px "PingFang SC", "Microsoft YaHei", serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('光', W * .5, H * .40);
    g.fillStyle = '#64748b'; g.font = Math.round(H * .10) + 'px Inter, sans-serif';
    g.fillText('放 大 镜', W * .5, H * .80);
  }
  const ART = { scene: artScene, slide: artSlide, text: artText };

  // 物面贴图（投影仪的幻灯片要【倒插】⇒ 贴图整体转 180°）
  function objectCanvas() {
    const m = mode();
    const W = 300, H = Math.max(60, Math.round(300 * m.objH / m.objW));
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    ART[m.art](g, W, H);
    if (!m.flip) return c;
    const c2 = document.createElement('canvas'); c2.width = W; c2.height = H;
    const g2 = c2.getContext('2d');
    g2.translate(W / 2, H / 2); g2.rotate(Math.PI); g2.drawImage(c, -W / 2, -H / 2);
    return c2;
  }

  // 空间中的实像（光屏被拿开时的样子）：物面贴图【转 180°】，没有屏的亮底。
  function realImageCanvas() {
    const src = objectCanvas();
    const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
    const g = c.getContext('2d');
    g.translate(src.width / 2, src.height / 2); g.rotate(Math.PI);
    g.drawImage(src, -src.width / 2, -src.height / 2);
    return c;
  }

  // 光屏贴图：实像时把物面贴图【转 180°】并按 |m| 缩放画上去（倒立！）；
  // 虚像时只有一团漫射光斑 —— 光屏接不住虚像，屏上没有任何像的结构。
  function screenCanvas(sharp) {
    const W = Math.round(SCREEN_W * SCREEN_PPM), H = Math.round(SCREEN_H * SCREEN_PPM);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    if (!sharp) {
      g.fillStyle = '#0f172a'; g.fillRect(0, 0, W, H);
      const blob = g.createRadialGradient(W / 2, H * 0.72, 4, W / 2, H * 0.72, W * .46);
      blob.addColorStop(0, 'rgba(226,240,255,.38)');
      blob.addColorStop(.55, 'rgba(147,197,253,.12)');
      blob.addColorStop(1, 'rgba(15,23,42,0)');
      g.fillStyle = blob; g.fillRect(0, 0, W, H);
      return c;
    }
    g.fillStyle = '#f1f5f9'; g.fillRect(0, 0, W, H);
    const m = mode();
    const o = optics();
    const am = Math.abs(o.m);
    const iw = m.objW * am * SCREEN_PPM, ih = m.objH * am * SCREEN_PPM;
    const src = objectCanvas();
    g.save();
    // 物站在主光轴上（底边在 y=0），像倒立后底边仍在轴上、朝下长 ⇒ 贴图里把像心放在轴下方
    g.translate(W / 2, H / 2 + ih / 2);
    g.rotate(Math.PI);
    g.drawImage(src, -iw / 2, -ih / 2, iw, ih);
    g.restore();
    return c;
  }

  function canvasTexture(c) {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }
  // 贴图的结构度：亮度的归一化标准差。清晰像高、漫射光斑低。
  function textureSharpness(c) {
    const g = c.getContext('2d');
    const W = c.width, H = c.height;
    const d = g.getImageData(0, 0, W, H).data;
    const N = W * H;
    let s = 0, s2 = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
      s += l; s2 += l * l;
    }
    const mean = s / N;
    return Math.sqrt(Math.max(0, s2 / N - mean * mean));
  }

  // 贴图上「深色区域包围盒 + 区域内亮墨迹的水平重心（相对包围盒归一化）」。
  // 🔴 用途：断言【屏上的像相对物面真的转了 180°】。判据必须落在**实际画出去的贴图像素**上 ——
  //    读 drawn.image.inverted 只是读「意图」，把 screenCanvas 里的 rotate(Math.PI) 删掉它照样是 true。
  //    投影仪档：物面 = 深底 + 白 F + 左下角 SLIDE ⇒ 墨迹重心偏左；屏上若真转了 180°，重心必偏右。
  function blobStats(c) {
    const g = c.getContext('2d'), W = c.width, H = c.height;
    const d = g.getImageData(0, 0, W, H).data;
    const lum = (i) => (d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114) / 255;
    let x0 = W, x1 = -1, y0 = H, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (lum((y * W + x) * 4) < .35) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return { box: null, cx: null, n: 0 };
    let sx = 0, n = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (lum((y * W + x) * 4) > .55) { sx += x; n++; }
    }
    return { box: { x0: x0 / W, x1: x1 / W, y0: y0 / H, y1: y1 / H },
             cx: n ? ((sx / n) - x0) / Math.max(1, x1 - x0) : null, n };
  }

  /* ================= 每帧算出的几何（供自检读） ================= */
  const drawn = {
    lensSurfaces: [], rays: [], focusMarks: [],
    object: null, image: null, screen: null, ghost: null,
    traced: null, crossRadius: null
  };

  function clearGroup(g) { while (g.children.length) g.remove(g.children[0]); }
  function extend(P, d, xEnd) {
    if (Math.abs(d.x) < 1e-9) return P.clone().addScaledVector(d, 12);
    return P.clone().addScaledVector(d, (xEnd - P.x) / d.x);
  }
  function addSeg(group, p1, p2, material) {
    const g = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    const line = new THREE.Line(g, material);
    if (material.isLineDashedMaterial) line.computeLineDistances();
    group.add(line);
    return line;
  }
  const inScene = (o) => { let r = o; while (r.parent) r = r.parent; return r === scene && o.visible; };

  /* ================= 重建物体 ================= */
  function buildObject(u, pp) {
    clearGroup(objGroup);
    const m = mode();
    const xo = pp.H - u;                            // 物面世界坐标（u 从前主平面量起）
    const tex = canvasTexture(objectCanvas());
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(m.objW, m.objH),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })
    );
    plane.rotation.y = Math.PI / 2;                 // 面朝 +x（朝着透镜）
    plane.position.set(xo, m.objH / 2, 0);          // 底边坐在主光轴上
    addOutline(plane, m.objW, m.objH, '#e6f4ff', .70);
    objGroup.add(plane);
    // 支架：从物面底部垂直落到光具座
    const stemH = m.objH / 2 + Math.abs(BENCH_TOP);
    mesh(new THREE.CylinderGeometry(.20, .20, stemH, 14), matAlu, objGroup, xo, m.objH / 2 - stemH / 2, 0);
    const tag = label(m.name, '#ffe9b8', 6.6);
    tag.position.set(xo, m.objH + 1.6, 0);
    objGroup.add(tag);

    const bb = new THREE.Box3().setFromObject(plane);
    drawn.object = {
      app: m.key, x: xo, u, w: m.objW, h: m.objH,
      yMin: bb.min.y, yMax: bb.max.y,
      inScene: inScene(plane), verts: plane.geometry.getAttribute('position').count,
      flip: m.flip
    };
  }

  /* ================= 重建像 / 光屏 ================= */
  function buildImage(o) {
    clearGroup(screenGroup);
    clearGroup(ghostGroup);
    drawn.image = null; drawn.screen = null; drawn.ghost = null;
    if (o.none) return;

    const m = mode();
    const am = Math.abs(o.m);
    const real = o.m < 0;
    const xAt = o.offBench ? Math.sign(o.xImg) * X_LIMIT : o.xImg;

    if (real) {
      drawn.image = { real: true, x: xAt, y: 0, z: 0, m: o.m, am,
                      w: m.objW * am, h: m.objH * am, inverted: true, onScreen: state.showScreen };
      if (state.showScreen) {
        const sc = screenCanvas(true);
        const tex = canvasTexture(sc);
        const panel = new THREE.Mesh(
          new THREE.PlaneGeometry(SCREEN_W, SCREEN_H),
          new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })
        );
        panel.rotation.y = -Math.PI / 2;               // 面朝 −x（朝着透镜这侧）
        panel.position.set(xAt, 0, 0);
        screenGroup.add(panel);
        const frameMat = mat('#8ea3b5', .4, .4);
        const fw = .32;
        mesh(new THREE.BoxGeometry(fw, SCREEN_H + fw, fw), frameMat, screenGroup, xAt, 0, SCREEN_W / 2);
        mesh(new THREE.BoxGeometry(fw, SCREEN_H + fw, fw), frameMat, screenGroup, xAt, 0, -SCREEN_W / 2);
        mesh(new THREE.BoxGeometry(fw, fw, SCREEN_W), frameMat, screenGroup, xAt, SCREEN_H / 2, 0);
        mesh(new THREE.BoxGeometry(fw, fw, SCREEN_W), frameMat, screenGroup, xAt, -SCREEN_H / 2, 0);
        mesh(new THREE.CylinderGeometry(.26, .26, 1.4, 14), matAlu, screenGroup, xAt, -SCREEN_H / 2 - 0.7, 0);
        const tag = label(m.holder + '（实像）', '#bfe9f7', 8.4);
        tag.position.set(xAt, SCREEN_H / 2 + 1.7, 0);
        screenGroup.add(tag);

        drawn.screen = { inScene: inScene(panel), x: xAt, w: SCREEN_W, h: SCREEN_H,
                         sharp: true, sharpness: textureSharpness(sc), offBench: o.offBench };
      } else {
        // 🔴 拿掉光屏：实像**仍然在空间中那个位置**（光屏只是把它显出来，不是像的成因）。
        //    所以关掉「光屏 / 胶片」不该让像凭空消失 —— 改画一块半透明浮动像面，
        //    像在主轴【下方】（倒立），这才是「实像」二字的物理内容。
        const panel = new THREE.Mesh(
          new THREE.PlaneGeometry(m.objW * am, m.objH * am),
          new THREE.MeshBasicMaterial({ map: canvasTexture(realImageCanvas()), side: THREE.DoubleSide,
                                        transparent: true, opacity: .78 })
        );
        panel.rotation.y = -Math.PI / 2;
        panel.position.set(xAt, -m.objH * am / 2, 0);
        addOutline(panel, m.objW * am, m.objH * am, '#8fe3ff', .85, true);
        ghostGroup.add(panel);
        const tag = label('实像（倒立，屏已拿开）', '#bfe9f7', 11.4);
        tag.position.set(xAt, -m.objH * am - 1.8, 0);
        ghostGroup.add(tag);
        drawn.ghost = { real: true, x: xAt, w: m.objW * am, h: m.objH * am,
                        scaleX: 1, scaleY: 1, inScene: inScene(panel) };
      }
    } else {
      // 虚像：光屏接不住。屏留在导轨近端，上面只有一团漫射光斑；
      // 虚像本身画在物体【同侧】更远的地方，透过透镜才看得见（正立、放大）。
      if (state.showScreen) {
        const xs = 12;
        const sc = screenCanvas(false);
        const panel = new THREE.Mesh(
          new THREE.PlaneGeometry(SCREEN_W, SCREEN_H),
          new THREE.MeshBasicMaterial({ map: canvasTexture(sc), side: THREE.DoubleSide })
        );
        panel.rotation.y = -Math.PI / 2;
        panel.position.set(xs, 0, 0);
        screenGroup.add(panel);
        mesh(new THREE.CylinderGeometry(.26, .26, 1.4, 14), matAlu, screenGroup, xs, -SCREEN_H / 2 - 0.7, 0);
        const tag = label('光屏（接不住虚像）', '#c9b2ff', 10.6);
        tag.position.set(xs, SCREEN_H / 2 + 1.7, 0);
        screenGroup.add(tag);
        drawn.screen = { inScene: inScene(panel), x: xs, w: SCREEN_W, h: SCREEN_H,
                         sharp: false, sharpness: textureSharpness(sc), offBench: false };
      }
      if (state.showVirtual) {
        const gx = o.offBench ? -X_LIMIT : o.xImg;
        const panel = new THREE.Mesh(
          new THREE.PlaneGeometry(m.objW, m.objH),
          new THREE.MeshBasicMaterial({ map: canvasTexture(objectCanvas()), side: THREE.DoubleSide,
                                        transparent: true, opacity: .74 })
        );
        panel.rotation.y = Math.PI / 2;              // 与物体同向 ⇒ 正立
        panel.scale.set(am, am, 1);
        panel.position.set(gx, m.objH * am / 2, 0);
        addOutline(panel, m.objW, m.objH, '#c9b2ff', .85, true);   // 虚线框 ⇒ 一眼看出是虚像
        ghostGroup.add(panel);
        const tag = label('虚像（正立放大）', '#c9b2ff', 9.8);
        tag.position.set(gx, m.objH * am + 1.8, 0);
        ghostGroup.add(tag);
        drawn.ghost = { real: false, x: gx, w: m.objW * am, h: m.objH * am,
                        scaleX: panel.scale.x, scaleY: panel.scale.y, inScene: inScene(panel) };
        drawn.image = { real: false, x: gx, y: 0, z: 0, m: o.m, am,
                        w: m.objW * am, h: m.objH * am, inverted: false, onScreen: false };
      }
    }
  }

  /* ================= 重建光路 ================= */
  function rebuildRays(o) {
    clearGroup(rayGroup);
    clearGroup(focalGroup);
    drawn.rays = [];
    drawn.focusMarks = [];

    const L = lens();
    const m = mode();
    const yT = m.objH / 2;                          // 物体顶端
    const xo = o.objX;

    // 焦点标记：F、2F（物侧）与 F′、2F′（像侧）
    if (state.showFocal) {
      const f = L.fTheory;
      [[-f, 'F'], [f, 'F′'], [-2 * f, '2F'], [2 * f, '2F′']].forEach(([x, txt]) => {
        const isF = Math.abs(x) === f;
        mesh(dotGeo, isF ? matFReal : matF2, focalGroup, x, 0, 0);
        const t = label(txt, isF ? '#ffd884' : '#8fb3c6', 4.4);
        t.position.set(x, -1.7, 0);
        focalGroup.add(t);
        drawn.focusMarks.push({ x, text: txt });
      });
    }

    // 真实折射路径（与公式互不引用）：两条对称近轴光线从物顶端出发的交点
    const ti = traceImage(xo, state.f, yT);
    drawn.traced = ti ? { x: ti.P.x, y: ti.P.y, z: ti.P.z, hh: ti.hh } : null;
    drawn.crossRadius = crossRadius(state.f);

    if (!state.showRays || o.none) { updateReadouts(); return; }

    const aims = [];
    if (state.rayMode === 'special') {
      // ① 平行主轴 → 折射后过 F′；② 过光心 → 方向不变；③ 过 F → 折射后平行主轴
      aims.push({ y: yT, kind: 'parallel' });
      aims.push({ y: 0, kind: 'center' });
      if (state.u > L.fTheory) {
        const yAtLens = -yT * L.fTheory / (state.u - L.fTheory);
        if (Math.abs(yAtLens) < L.aperture) aims.push({ y: yAtLens, kind: 'focal' });
      }
    } else {
      const n = 7;
      for (let i = 0; i < n; i++) {
        aims.push({ y: -L.aperture * .8 + (2 * L.aperture * .8) * i / (n - 1), kind: 'bundle' });
      }
    }

    const traced = [];
    for (const a of aims) {
      const r = traceToHeight(xo, state.f, yT, a.y);
      if (!r || r.miss || !r.d2) continue;
      traced.push({ a, r });
    }

    const op = state.rayMode === 'special' ? 1 : .72;
    matIn.opacity = op; matOut.opacity = op;

    for (const t of traced) {
      const { r, a } = t;
      const P3 = extend(r.P2, r.d2, X_RIGHT + 1);
      addSeg(rayGroup, r.P0, r.P1, matIn);
      addSeg(rayGroup, r.P1, r.P2, matGlass);
      addSeg(rayGroup, r.P2, P3, matOut);
      drawn.rays.push({
        kind: a.kind, aimY: a.y,
        in: [r.P0.toArray(), r.P1.toArray()],
        glass: [r.P1.toArray(), r.P2.toArray()],
        out: [r.P2.toArray(), P3.toArray()],
        dOut: r.d2.toArray()
      });
    }

    // 虚像：把出射光线【反向延长】（紫虚线）到虚像处
    if (!o.none && o.m > 0 && state.showVirtual && drawn.image && drawn.image.x < 0) {
      for (const t of traced) {
        const r = t.r;
        const k = Math.abs(r.d2.x) > 1e-9 ? ((drawn.image.x - 5) - r.P2.x) / (-r.d2.x) : 6;
        if (k > 0) addSeg(rayGroup, r.P2, r.P2.clone().addScaledVector(r.d2, -Math.min(k, 90)), matVirt);
      }
    }

    updateReadouts();
  }

  /* ================= 读数 ================= */
  function updateReadouts() {
    const o = optics();
    const n = natureOf(state.u, state.f);
    const m = mode();
    const cm = (v, d = 1) => Number.isFinite(v) ? v.toFixed(d) + ' cm' : '—';

    $('roU').textContent = cm(state.u);
    $('roV').textContent = o.none ? '∞' : cm(o.vH, 1);
    $('roM').textContent = o.none ? '—' : Math.abs(o.m).toFixed(2) + '×';
    $('roNature').textContent = n.text;
    $('roNature').className = n.real ? 'ok' : 'warn';
    $('roNote').textContent = o.none
      ? 'u = f：出射光平行，不成像'
      : (o.offBench ? '像距过大，像已超出导轨（屏已推到末端）' : 'u 与 v 都从透镜的【主平面】量起');

    $('metricApp').textContent = m.name;
    $('metricU').textContent = cm(state.u);
    $('metricV').textContent = o.none ? '∞' : cm(o.vH, 1);
    $('metricNature').textContent = n.text;
    $('metricNature').className = n.real ? 'good' : 'warn';

    $('zoneHead').textContent = 'u = ' + state.u.toFixed(1) + ' cm　f = ' +
      lens().fTheory.toFixed(1) + ' cm　2f = ' + (2 * lens().fTheory).toFixed(1) + ' cm';
    $('uValue').textContent = state.u.toFixed(1) + ' cm';
    $('focalValue').textContent = state.f.toFixed(1) + ' cm';
    layoutZoneBar();
  }

  // 区间条：三段的左右边界与游标都从【同一个 u 映射】算出（单一真源）
  const uPct = (v) => clamp((v - U_MIN) / (U_MAX - U_MIN), 0, 1) * 100;
  function layoutZoneBar() {
    const f = lens().fTheory;
    const b1 = clamp(f, U_MIN, U_MAX), b2 = clamp(2 * f, U_MIN, U_MAX);
    const mag = $('zoneMag'), proj = $('zoneProj'), cam = $('zoneCam');
    mag.style.left = uPct(U_MIN) + '%';
    mag.style.width = Math.max(0, uPct(b1) - uPct(U_MIN)) + '%';
    proj.style.left = uPct(b1) + '%';
    proj.style.width = Math.max(0, uPct(b2) - uPct(b1)) + '%';
    cam.style.left = uPct(b2) + '%';
    cam.style.width = Math.max(0, uPct(U_MAX) - uPct(b2)) + '%';
    $('zoneMark').style.left = uPct(state.u) + '%';
    $('scaleMin').style.left = uPct(U_MIN) + '%';
    $('scaleF').style.left = uPct(b1) + '%';
    $('scaleF').textContent = 'f=' + f.toFixed(1);
    $('scale2F').style.left = uPct(b2) + '%';
    $('scale2F').textContent = '2f=' + (2 * f).toFixed(1);
    $('scaleMax').style.left = uPct(U_MAX) + '%';
  }

  function describe() {
    const n = natureOf(state.u, state.f);
    const o = optics();
    const m = mode();
    if (n.none) {
      return '<b>' + m.name + '：</b>物体正好在焦点上（u = f），折射光线彼此平行，<b>不成像</b>。' +
        '把物体往左或往右挪一点点，像立刻出现 —— 但性质是相反的两种。';
    }
    const zone = n.real ? (Math.abs(o.m) > 1 ? 'f &lt; u &lt; 2f' : 'u &gt; 2f') : 'u &lt; f';
    let txt = '<b>' + m.name + '：</b>u = ' + state.u.toFixed(1) + ' cm 落在 <b>' + zone + '</b>，' +
      'v = ' + o.vH.toFixed(1) + ' cm（|m| = ' + Math.abs(o.m).toFixed(2) + '）⇒ <b>' + n.text + '</b>。';
    if (n.real) {
      txt += '折射光线真实会聚，' + m.holder + '上接得住 —— 屏上是<b>倒立</b>的。';
      if (m.flip) txt += '幻灯片要<b>倒插</b>，屏上的画面才是正立的。';
    } else {
      txt += '折射光线是发散的，光屏<b>接不住</b>，只能透过透镜看 —— 所以放大镜没有屏。';
    }
    if (drawn.traced && Number.isFinite(o.xImg)) {
      const d = Math.abs(drawn.traced.x - o.xImg) / Math.abs(o.xImg) * 100;
      txt += '（真实折射光线交于 x = ' + drawn.traced.x.toFixed(2) + ' cm，与公式相差 ' +
        d.toFixed(2) + '% —— 这就是球差。）';
    }
    if (o.offBench) txt += '⚠️ 像距太大，像已经跑到导轨外面了。';
    return txt;
  }

  /* ================= 渲染 ================= */
  function cameraPosition() {
    const aspect = Math.max(0.2, camera.aspect);
    const k = Math.max(1, ASPECT_REF / aspect);   // 窄画面 ⇒ 后退，保证横向不出画
    const r = (CAM_R * k) / state.zoom;
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
    const L = lens();
    const pp = principalPlanes(L);
    buildLens(L);
    buildObject(state.u, pp);
    const o = optics();
    buildImage(o);
    rebuildRays(o);
    axisGroup.visible = state.showAxis;
    $('finding').innerHTML = describe();
    render();
  }

  /* ================= 像素统计（供自检） ================= */
  // 把光屏四角投到画布像素坐标，取该矩形内的亮度均值与标准差。
  // 清晰像 ⇒ 标准差大；虚像时的漫射光斑 ⇒ 标准差小。
  function screenRegionStats() {
    if (!drawn.screen || !drawn.screen.inScene) return { present: false };
    const s = drawn.screen;
    const corners = [
      new THREE.Vector3(s.x, s.h / 2, s.w / 2), new THREE.Vector3(s.x, s.h / 2, -s.w / 2),
      new THREE.Vector3(s.x, -s.h / 2, s.w / 2), new THREE.Vector3(s.x, -s.h / 2, -s.w / 2)
    ];
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const c of corners) {
      const v = c.clone().project(camera);
      const px = (v.x * .5 + .5) * state.w, py = (-v.y * .5 + .5) * state.h;
      x0 = Math.min(x0, px); x1 = Math.max(x1, px);
      y0 = Math.min(y0, py); y1 = Math.max(y1, py);
    }
    const pad = 0.16;
    x0 = Math.round(x0 + (x1 - x0) * pad); x1 = Math.round(x1 - (x1 - x0) * pad);
    y0 = Math.round(y0 + (y1 - y0) * pad); y1 = Math.round(y1 - (y1 - y0) * pad);
    const cw = canvas.width, ch = canvas.height;
    const sx = cw / state.w, sy = ch / state.h;
    const rx = clamp(x0 * sx, 0, cw - 1), ry = clamp(y0 * sy, 0, ch - 1);
    const rw = clamp((x1 - x0) * sx, 1, cw - rx), rh = clamp((y1 - y0) * sy, 1, ch - ry);
    const c2 = document.createElement('canvas');
    c2.width = Math.max(1, Math.round(rw)); c2.height = Math.max(1, Math.round(rh));
    const g2 = c2.getContext('2d');
    g2.drawImage(canvas, rx, ry, rw, rh, 0, 0, c2.width, c2.height);
    const d = g2.getImageData(0, 0, c2.width, c2.height).data;
    const N = c2.width * c2.height;
    let sum = 0, sum2 = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
      sum += l; sum2 += l * l;
    }
    const mean = sum / N;
    return { present: true, rect: { x: rx, y: ry, w: c2.width, h: c2.height },
             mean, std: Math.sqrt(Math.max(0, sum2 / N - mean * mean)) };
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

  /* 视角按钮高亮：唯一真源。点击 / 复位 / 自检钩子 setView 三处都走它 */
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
  function syncAppButtons() {
    document.querySelectorAll('#appMode button').forEach(b => b.classList.toggle('active', b.dataset.app === state.app));
    document.querySelectorAll('#rayMode button').forEach(b => b.classList.toggle('active', b.dataset.mode === state.rayMode));
  }
  // 切应用：把物体挪到该应用的物距（相对 f 的倍数），其余器材不动
  function setApp(key, keepU) {
    if (!MODES[key]) return false;
    state.app = key;
    if (!keepU) state.u = clamp(MODES[key].uRatio * lens().fTheory, U_MIN, U_MAX);
    state.showScreen = MODES[key].screen;
    $('showScreen').checked = MODES[key].screen;
    syncAppButtons();
    $('objectU').value = state.u;
    rebuildAll();
    return true;
  }
  document.querySelectorAll('#appMode button').forEach(b => b.addEventListener('click', () => setApp(b.dataset.app)));
  document.querySelectorAll('#rayMode button').forEach(b => b.addEventListener('click', () => {
    state.rayMode = b.dataset.mode; syncAppButtons(); rebuildAll();
  }));
  $('objectU').addEventListener('input', (e) => { state.u = +e.target.value; rebuildAll(); });
  $('focalLength').addEventListener('input', (e) => {
    state.f = +e.target.value;
    // 焦距变了，物体跟着挪到该应用对应的区间（保持「三种应用」的教学含义）
    state.u = clamp(mode().uRatio * lens().fTheory, U_MIN, U_MAX);
    $('objectU').value = state.u;
    rebuildAll();
  });
  ['showRays', 'showScreen', 'showVirtual', 'showFocal', 'showAxis'].forEach((id) => {
    $(id).addEventListener('change', (e) => { state[id] = e.target.checked; rebuildAll(); });
  });

  /* ================= 记录表 ================= */
  function natureCells(n) {
    if (n.none) return { inv: '—', size: '—', real: '—', catch_: '—' };
    return { inv: n.inverted ? '倒立' : '正立', size: n.size,
             real: n.real ? '实像' : '虚像', catch_: n.catchable ? '能' : '不能' };
  }
  function pushRecord(appKey, u, f) {
    const n = natureOf(u, f);
    const o = solveAt(u, f);
    const c = natureCells(n);
    state.records.push({ app: MODES[appKey].name, u, v: o.vH,
                         inv: c.inv, size: c.size, real: c.real, catch_: c.catch_ });
    if (state.records.length > 6) state.records.shift();
  }
  function renderRecords() {
    const tb = $('records');
    if (!state.records.length) {
      tb.innerHTML = '<tr><td colspan="8" class="empty">尚无记录，先选一种应用再点「记录当前数据」</td></tr>';
    } else {
      tb.innerHTML = state.records.map((r, i) =>
        '<tr class="filled"><td>' + (i + 1) + '</td><td>' + r.app + '</td><td>' + r.u.toFixed(1) + '</td><td>' +
        (Number.isFinite(r.v) ? r.v.toFixed(1) : '∞') + '</td><td>' + r.inv + '</td><td>' + r.size +
        '</td><td>' + r.real + '</td><td>' + r.catch_ + '</td></tr>'
      ).join('');
    }
    $('summary').textContent = state.records.length >= 3
      ? '已记录 ' + state.records.length + ' 组：物距落在 u &gt; 2f、f &lt; u &lt; 2f、u &lt; f 三段时，' +
        '像分别是「倒立缩小实像」「倒立放大实像」「正立放大虚像」—— 前两种光屏接得住，第三种接不住。'
      : '记录三行以上，就能看出「物距落在哪个区间 → 成什么样的像」。';
  }
  function recordNow() {
    pushRecord(state.app, state.u, state.f);
    renderRecords();
    const last = $('records').querySelector('tr:last-child');
    if (last) { last.classList.add('flash'); setTimeout(() => last.classList.remove('flash'), 1300); }
  }
  // 三种应用各记一行：不改当前状态（用各自的 uRatio 临时算）
  function recordAll() {
    for (const k of APP_ORDER) pushRecord(k, clamp(MODES[k].uRatio * lens().fTheory, U_MIN, U_MAX), state.f);
    renderRecords();
  }
  $('recordBtn').addEventListener('click', recordNow);
  $('recordBtn2').addEventListener('click', recordNow);
  $('stageRecordBtn').addEventListener('click', recordNow);
  $('recordAllBtn').addEventListener('click', recordAll);
  $('recordAllBtn2').addEventListener('click', recordAll);
  $('clearRecords').addEventListener('click', () => { state.records = []; renderRecords(); });
  $('stageCycleBtn').addEventListener('click', () => {
    const i = APP_ORDER.indexOf(state.app);
    setApp(APP_ORDER[(i + 1) % APP_ORDER.length]);
  });

  $('resetAll').addEventListener('click', () => {
    Object.assign(state, {
      app: 'projector', f: 14, rayMode: 'special',
      showRays: true, showScreen: true, showVirtual: true, showFocal: true, showAxis: true
    });
    applyView('perspective');   // 机位唯一真源
    state.u = clamp(MODES.projector.uRatio * lens().fTheory, U_MIN, U_MAX);
    $('objectU').value = state.u;
    $('focalLength').value = 14; $('focalValue').textContent = '14.0 cm';
    $('showScreen').checked = MODES.projector.screen;
    ['showRays', 'showVirtual', 'showFocal', 'showAxis'].forEach(id => { $(id).checked = true; });
    $('finding').textContent = '把物体放在离透镜不同距离的地方，看像的正倒、大小、虚实怎么变。';
    syncAppButtons();
    rebuildAll();
  });

  let rt = null;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { if (!dragging) render(); }, 120);
  });

  /* ================= 自检钩子 =================
     暴露页面【真正用到的】那份几何与判定。会变的量一律写成 get 访问器。 */
  window.__imagingLab = {
    state, MODES, U_MIN, U_MAX, F_MIN, F_MAX, X_LIMIT, APERTURE, THICK, N_GLASS, TRACE_K,
    get mode() { return mode(); },
    get lens() { return lens(); },
    get optics() { return optics(); },
    get nature() { return natureOf(state.u, state.f); },
    get rays() { return drawn.rays; },
    get lensSurfaces() { return drawn.lensSurfaces; },
    get drawn() { return drawn; },
    get objectMesh() { return drawn.object; },
    get imageMesh() { return drawn.image; },
    get screenMesh() { return drawn.screen; },
    get ghostMesh() { return drawn.ghost; },
    get tracedImage() { return drawn.traced; },
    get crossRadius() { return drawn.crossRadius; },
    get records() { return state.records.slice(); },
    solve: (u, f) => { const o = solveAt(u, f); return o; },
    natureOf: (u, f) => natureOf(u, f),
    principalPlanes: (f) => { const p = principalPlanes(lensGeom(f)); return { H: p.H, Hp: p.Hp }; },
    crossRadius: (f) => crossRadius(f),
    // 真实折射路径：从物顶端两条【对称近轴】光线的交点
    traceImage: (u, f, yT) => {
      const r = traceImage(objXFor(u, f), f, yT);
      return r ? { x: r.P.x, y: r.P.y, z: r.P.z, hh: r.hh } : null;
    },
    traceToHeight: (u, f, yT, yAim) => {
      const r = traceToHeight(objXFor(u, f), f, yT, yAim);
      return r ? { P1: r.P1.toArray(), P2: r.P2.toArray(), dOut: r.d2.toArray() } : null;
    },
    objXFor: (u, f) => objXFor(u, f),
    zonePct: (v) => uPct(v),
    zoneBar: () => {
      const f = lens().fTheory;
      const g = (el) => ({ left: parseFloat(el.style.left) || 0, width: parseFloat(el.style.width) || 0 });
      return { mag: g($('zoneMag')), proj: g($('zoneProj')), cam: g($('zoneCam')),
               mark: parseFloat($('zoneMark').style.left) || 0,
               scaleMin: g($('scaleMin')), scaleF: g($('scaleF')),
               scale2F: g($('scale2F')), scaleMax: g($('scaleMax')),
               f, twoF: 2 * f, uMin: U_MIN, uMax: U_MAX };
    },
    setApp: (k, keepU) => setApp(k, keepU),
    setU: (v) => { state.u = v; $('objectU').value = v; rebuildAll(); },
    setF: (v) => { state.f = v; $('focalLength').value = v; $('focalValue').textContent = v.toFixed(1) + ' cm'; rebuildAll(); },
    setRayMode: (m) => { state.rayMode = m; syncAppButtons(); rebuildAll(); },
    setToggle: (id, on) => { state[id] = on; const el = $(id); if (el) el.checked = on; rebuildAll(); },
    setView: (name) => { if (applyView(name)) render(); },
    recordNow, recordAll,
    clearRecords: () => { state.records = []; renderRecords(); },
    render, rebuildAll,
    size: () => ({ w: state.w, h: state.h, dpr: state.dpr }),
    // 取景探针：把内容包络（光具座 + 镜片 + 两端裕量）投到 NDC。
    // 用途一：调 CAM_R；用途二：断言「任何视角、任何物距下内容都不出画」。
    get CAM_R() { return CAM_R; },
    setCamR: (v) => { CAM_R = v; render(); },
    frameProbe: (pts) => {
      const list = pts || (() => {
        const out = [];
        for (const x of [X_LEFT, X_RIGHT])
          for (const y of [BENCH_TOP - 1.8, 7.5])
            for (const z of [-10, 10]) out.push([x, y, z]);
        return out;
      })();
      return list.map(([x, y, z]) => {
        const v = new THREE.Vector3(x, y, z).project(camera);
        return { x: +v.x.toFixed(4), y: +v.y.toFixed(4) };
      });
    },
    screenTextureSharpness: () => drawn.screen ? drawn.screen.sharpness : null,
    screenRegionStats,
    // 屏上的像是否真的相对物面转了 180°（从实际贴图像素量，不看「意图」）
    artAsymmetry: () => {
      const o = blobStats(objectCanvas());
      const s = blobStats(screenCanvas(true));
      return { objCx: o.cx, objN: o.n, objBox: o.box, scrCx: s.cx, scrN: s.n, scrBox: s.box };
    },
    debug() {
      const o = optics(), n = natureOf(state.u, state.f), m = mode();
      return {
        app: state.app, appName: m.name, u: state.u, fSetting: state.f,
        fTheory: o.f, H: o.H, Hp: o.Hp, uH: o.uH, vH: o.vH, xImg: o.xImg, m: o.m,
        nature: n.text, real: n.real, none: o.none, offBench: o.offBench,
        objH: m.objH, objW: m.objW, objFlip: m.flip,
        objX: drawn.object ? drawn.object.x : null,
        imgX: drawn.image ? drawn.image.x : null,
        imgH: drawn.image ? drawn.image.h : null,
        imgInverted: drawn.image ? drawn.image.inverted : null,
        tracedX: drawn.traced ? drawn.traced.x : null,
        tracedY: drawn.traced ? drawn.traced.y : null,
        crossRadius: drawn.crossRadius,
        screen: drawn.screen, ghost: drawn.ghost,
        rayCount: drawn.rays.length,
        aperture: APERTURE, thick: THICK, n: N_GLASS,
        metricNature: $('metricNature').textContent, roNature: $('roNature').textContent,
        records: state.records.length
      };
    }
  };

  syncAppButtons();
  renderRecords();
  rebuildAll();
  requestAnimationFrame(() => { render(); });
})();
