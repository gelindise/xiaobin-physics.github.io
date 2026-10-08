import * as THREE from './assets/optics-three.min.js';

// 眼睛与眼镜 —— 立体模型。
// 世界坐标以【毫米】为单位，光轴 = x 轴（光从左向右传播），眼球中心在 x = 0。
//   角膜顶点在 x = −L/2，视网膜顶点在 x = +L/2（L = 眼球前后径）。
// 眼睛等效成【角膜顶点处的一片薄透镜】：真实眼睛约 2/3 的折射力在角膜上，
// 这样等效既符合教科书口径，也让「像距 = 眼球前后径」这句话严格成立。
//
// 会聚点的位置有【两条互不引用的路径】：
//   ① 闭式：1/f = 1/u + 1/v 逐片串起来（配镜度数也由它反解）
//   ② 数值：从物点发出的一束光线，在眼镜、角膜两处各偏折一次（s' = s − y/f），
//      出射直线求交 —— 像不是画上去的，是算出来的
// 两者对得上，才说明视网膜上那个点是真的被折出来的。
//
// 🔴 眼镜度数只用一条口径：度 = 100 / f(m)，f 单位米。近视 f 为负 ⇒ 度数为负。
//    本页所有读数（度数、远点、会聚点偏差）都由这一条派生，别处不许再写一遍。
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const canvas = $('sceneCanvas');
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  /* ================= 物理常量 =================
     都是【规格字面量】：改这里就是改规格，别处一律从这里读。 */
  const F_RELAX = 24.0;      // 睫状肌完全放松（看远）时的等效焦距 mm
  const F_TIGHT = 21.5;      // 睫状肌完全收缩（看最近）时的等效焦距 mm
  const LEN_MIN = 22.0, LEN_MAX = 26.5, LEN_NORMAL = 24.0;
  const EYE_RY = 11.0;       // 眼球横半径 mm（不随前后径变化）
  const GLASS_GAP = 12.0;    // 镜片到角膜顶点的距离 mm
  const PUPIL_R = 1.9;       // 追迹光线的最大高度（瞳孔半径）mm
  const RAY_N = 5;           // 光线条数（奇数 ⇒ 有一条沿光轴）
  const OFF_MAX = 6.0;       // 「会聚点偏差」条的量程 mm
  const SHARP_TOL = 0.5;     // 偏差小于它就算看清了 mm
  const DIOPTER_MIN = -800, DIOPTER_MAX = 400, DIOPTER_STEP = 25;
  const LENS_DIA = 9.0;      // 晶状体直径 mm
  const LENS_EDGE = 1.2;     // 晶状体边缘厚度 mm
  const LENS_THICK_RELAX = 4.0, LENS_THICK_TIGHT = 5.2;  // 放松 / 最紧张时的中央厚度
  const CORNEA_R = 7.8;      // 角膜球面半径 mm
  const CORNEA_HALF = 0.70;  // 角膜球冠半角 rad（≈40°）
  const GLASS_DIA = 30.0;    // 镜片直径 mm
  // 🔴 真实的弥散斑只有 0.1~0.5 mm（视网膜上的视锥细胞约 0.005 mm），
  //    在 22~26 mm 的眼球上不放大根本看不见 ⇒ 画面里按 BLUR_K 放大，并明写「已放大」。
  const BLUR_K = 8;
  const U_MIN = 250, U_MAX = 5000;   // 物体距离 mm（25 cm ~ 5 m）
  const EYE_TYPES = {
    normal:    { len: 24.0, name: '正常眼' },
    myopia:    { len: 26.0, name: '近视眼' },
    hyperopia: { len: 22.5, name: '远视眼' }
  };
  const VIEWS = {
    section:     [-0.02, 0.03, 1],
    perspective: [-0.58, 0.32, 1],
    top:         [0, 1.50, 0.03],
    axis:        [1.42, 0.10, 0.02]
  };
  const VIEW_ORDER = ['section', 'perspective', 'top', 'axis'];

  /* ================= 状态 ================= */
  const state = {
    eyeType: 'normal',
    len: LEN_NORMAL,          // 眼球前后径 mm
    lensPower: 0,             // 睫状肌收缩程度 0~100
    u: U_MAX,                 // 物体距离 mm（从角膜量起）
    wearGlasses: false,
    diopter: 0,               // 镜片度数（度）
    showGlasses: true,
    showRays: true,
    showRetina: true,
    showBlur: true,
    view: 'perspective',
    yaw: 0, pitch: 0, zoom: 1,
    w: 1, h: 1, dpr: 1,
    records: []
  };

  /* ================= 物理内核 ================= */
  // 眼球几何：唯一真源
  function eyeGeom(len) {
    const Rx = len / 2;
    return { len, Rx, Ry: EYE_RY, xCornea: -Rx, xRetina: Rx, xCenter: 0 };
  }
  // 睫状肌收缩程度 p（0~1）→ 晶状体等效焦距 mm。放松时最长（看远），收缩时最短（看近）
  function lensFocal(p) { return F_RELAX + (F_TIGHT - F_RELAX) * p; }
  // 度数 ⇄ 焦距：度 = 100 / f(m) ⇒ f(mm) = 100000 / 度。0 度 = 平光镜（f 无穷大）
  function diopterToFocal(d) { return Math.abs(d) < 1e-9 ? Infinity : 100000 / d; }
  function focalToDiopter(f) { return !Number.isFinite(f) ? 0 : 100000 / f; }
  // 远点：睫状肌放松时能看清的最远距离（从角膜量起，负值 = 在眼后，即远视）
  function farPoint(len) {
    const inv = 1 / F_RELAX - 1 / len;
    return Math.abs(inv) < 1e-12 ? Infinity : 1 / inv;
  }
  // 近点：睫状肌全力收缩时能看清的最近距离
  function nearPoint(len) {
    const inv = 1 / F_TIGHT - 1 / len;
    return Math.abs(inv) < 1e-12 ? Infinity : 1 / inv;
  }
  // 配镜度数：让【无穷远】的平行光正好落在视网膜上
  //   眼镜把无穷远成像在 v = f_glass（相对镜片）；这个像又是眼睛的物。
  //   要求眼睛放松时把它成像在视网膜上：1/F_RELAX = 1/u_eye + 1/L
  //   而 u_eye = GLASS_GAP − f_glass ⇒ f_glass = GLASS_GAP − u_eye
  function neededDiopter(len) {
    const inv = 1 / F_RELAX - 1 / len;
    if (Math.abs(inv) < 1e-12) return 0;
    const uEye = 1 / inv;
    const fGlass = GLASS_GAP - uEye;
    const d = focalToDiopter(fGlass);
    return Math.round(d / DIOPTER_STEP) * DIOPTER_STEP;
  }

  /* --- 薄透镜光线追迹 ---
     一条光线用 (x, y, s) 表示：位置 (x, y)、斜率 s = dy/dx。
     过一片薄透镜（焦距 f，位于 x = L.x）：y 不变，斜率变成 s − y/f。
     f = Infinity（平光镜 / 不戴眼镜）⇒ 斜率不变。 */
  function traceThin(x0, y0, s0, lenses) {
    let x = x0, y = y0, s = s0;
    const segs = [];
    for (const L of lenses) {
      if (!(L.x > x0 + 1e-6)) continue;
      const yL = y + s * (L.x - x);
      segs.push({ x0: x, y0: y, x1: L.x, y1: yL });
      x = L.x; y = yL;
      if (Number.isFinite(L.f)) s = s - y / L.f;
    }
    return { segs, x, y, s };
  }
  // 两条直线 (x, y, s) 的交点；平行（或退化）返回 null
  function meetLines(a, b) {
    const ds = a.s - b.s;
    if (!Number.isFinite(ds) || Math.abs(ds) < 1e-12) return null;
    const x = (b.y - a.y + a.s * a.x - b.s * b.x) / ds;
    const y = a.y + a.s * (x - a.x);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  }
  // 光线与眼球内表面（椭球 x²/Rx² + y²/Ry² = 1，取 x > 0 的后半侧）的交点
  function hitEyeball(x0, y0, s, Rx, Ry) {
    const A = 1 / (Rx * Rx) + (s * s) / (Ry * Ry);
    const B = 2 * (x0 / (Rx * Rx) + (y0 * s) / (Ry * Ry));
    const C = (x0 * x0) / (Rx * Rx) + (y0 * y0) / (Ry * Ry) - 1;
    const D = B * B - 4 * A * C;
    if (D < 0) return null;
    const sq = Math.sqrt(D);
    for (const t of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)].sort((p, q) => p - q)) {
      if (t > 1e-9) {
        const x = x0 + t, y = y0 + s * t;
        if (x > 0) return { x, y, t };
      }
    }
    return null;
  }

  /* --- 本页的主计算：给定当前状态，算出全部光学量 --- */
  function optics() {
    const g = eyeGeom(state.len);
    const p = clamp(state.lensPower / 100, 0, 1);
    const fLens = lensFocal(p);
    const fGlass = state.wearGlasses ? diopterToFocal(state.diopter) : Infinity;
    const xGlass = g.xCornea - GLASS_GAP;
    const u = state.u;
    const xObj = g.xCornea - u;

    const lenses = [];
    if (state.wearGlasses) lenses.push({ x: xGlass, f: fGlass });
    lenses.push({ x: g.xCornea, f: fLens });

    // 一束从物点（轴上）发出、射向角膜不同高度的光线
    const rays = [];
    for (let i = 0; i < RAY_N; i++) {
      const h = RAY_N === 1 ? 0 : PUPIL_R * ((i / (RAY_N - 1)) * 2 - 1);
      rays.push(traceThin(xObj, 0, h / u, lenses));
    }
    // 会聚点：取最外侧两条（夹角最大，交点数值最稳）
    const A = rays[0], B = rays[rays.length - 1];
    const P = meetLines({ x: A.x, y: A.y, s: A.s }, { x: B.x, y: B.y, s: B.s });
    const xFocus = P ? P.x : Infinity;
    const off = Number.isFinite(xFocus) ? xFocus - g.xRetina : NaN;

    // 每条光线打到眼球内表面的位置（真实光路的终点）
    const hits = [];
    for (const r of rays) {
      const h = hitEyeball(r.x, r.y, r.s, g.Rx, g.Ry);
      if (h) hits.push(h);
    }
    // 视网膜上的弥散斑：各条光线落点的横向展开（轴上对称 ⇒ 取最大 |y|）
    let blurR = 0;
    for (const h of hits) blurR = Math.max(blurR, Math.abs(h.y));
    if (hits.length < 2) blurR = NaN;

    return {
      g, p, fLens, fGlass, xGlass, u, xObj, rays, hits,
      xFocus, off, blurR,
      onRetina: Number.isFinite(off) && Math.abs(off) < SHARP_TOL,
      side: !Number.isFinite(off) ? 'none' : (Math.abs(off) < SHARP_TOL ? 'on' : (off < 0 ? 'front' : 'back')),
      // 与追迹无关的第二条路径：闭式解
      closed: closedForm(g, fLens, fGlass, u)
    };
  }

  /* --- 闭式路径：完全按 1/f = 1/u + 1/v 逐片串，不碰任何光线 ---
     第 k 片透镜：1/v_k = 1/f_k − 1/u_k，u_k = 前一片的像距 − 两片间距（符号保持）。
     🔴 纯函数：是否戴镜只看 fGlass 是否有限，不读全局 state。 */
  function closedForm(g, fLens, fGlass, u) {
    const out = {};
    if (Number.isFinite(fGlass)) {
      // 眼镜：物距 u（从角膜量起）⇒ 相对镜片 u_g = u − GLASS_GAP
      const uG = u - GLASS_GAP;
      const invV = 1 / fGlass - 1 / uG;
      const vG = Math.abs(invV) < 1e-12 ? Infinity : 1 / invV;
      out.vGlass = vG;
      // 眼镜成的像落在 x_g + vG ⇒ 相对角膜的物距 = GLASS_GAP − vG。
      // 🔴 符号：vG < 0 是虚像、落在镜片【前方】⇒ 物距为正（物体在眼睛前面）。
      //    写成 vG − GLASS_GAP 会把物挪到眼睛后面去，戴镜时两条路径差 3.8 mm。
      out.uEye = GLASS_GAP - vG;
    } else {
      out.vGlass = null;
      out.uEye = u;
    }
    const invV2 = 1 / fLens - 1 / out.uEye;
    out.vEye = Math.abs(invV2) < 1e-12 ? Infinity : 1 / invV2;
    out.xFocus = g.xCornea + out.vEye;          // 相对角膜的位置
    out.off = out.xFocus - g.xRetina;
    return out;
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
  scene.fog = new THREE.Fog('#08131f', 260, 520);

  // 环境贴图：玻璃质感的眼睛与镜片需要有东西可折，否则是一团黑。
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

  const camera = new THREE.PerspectiveCamera(37, 1, 0.1, 1200);
  // 取景中心略偏向镜片一侧（内容从镜片一直铺到眼球后方）
  const target = new THREE.Vector3(-16, 0, 0);
  let CAM_R = 74;
  // 🔴 竖直视场固定 37°，横向视野 ∝ aspect ⇒ 视口越窄，横向越容易把眼镜挤出画外。
  //    以设计点纵横比 1.99 为基准，窄了就按比例加大机位半径，宽了不动。
  const ASPECT_REF = 1.99;

  scene.add(new THREE.HemisphereLight('#dff1fb', '#2b3946', 1.5));
  const keyL = new THREE.DirectionalLight('#fff6e8', 2.1); keyL.position.set(-30, 42, 36); scene.add(keyL);
  const fillL = new THREE.DirectionalLight('#bcd9ee', 1.0); fillL.position.set(32, -18, -26); scene.add(fillL);
  const rimL = new THREE.DirectionalLight('#8fd8f0', 1.2); rimL.position.set(24, 12, -30); scene.add(rimL);

  const matOf = (color, metalness = 0, roughness = .6, opts = {}) =>
    new THREE.MeshStandardMaterial(Object.assign({ color, metalness, roughness }, opts));
  const matAlu = matOf('#aab3b9', .62, .32);
  const matDark = matOf('#2c3946', .45, .55);

  function mesh(geo, m, parent, x = 0, y = 0, z = 0) {
    const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); parent.add(o); return o;
  }

  /* --- 标签（canvas 贴图 Sprite） ---
     🔴 第三个参数是【字高】（世界单位 mm），不是宽度 —— 宽度由文字自己决定。
        两个坑只能一起躲：
          ① 画布固定 256 px 时，粗体 36 px 下超过 7 个汉字就装不下，
             而 fillText 是居中绘制 ⇒ 长标签【两侧各被裁掉半个字】
             （实测：「弥散斑 ×8（0.15 mm）」「凹透镜（近视用）」都被裁过）。
          ② 画布宽度一改，sprite 的宽高比就必须跟着改，否则字会被横向拉扁。
        所以：画布按 measureText 实测宽度开，scale 再按画布比例算。 */
  const LABEL_FONT = 'bold 36px Inter, "PingFang SC", "Microsoft YaHei", sans-serif';
  const LABEL_PX_H = 64;      // 画布高 px
  const LABEL_GLYPH = 36;     // 字号 px
  const labelCtx = document.createElement('canvas').getContext('2d');
  function label(text, color = '#9fd8ea', glyphH = 1.3) {
    labelCtx.font = LABEL_FONT;
    const tw = Math.max(48, Math.ceil(labelCtx.measureText(text).width) + 16);
    const c = document.createElement('canvas'); c.width = tw; c.height = LABEL_PX_H;
    const g = c.getContext('2d');
    g.font = LABEL_FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = color;
    g.fillText(text, tw / 2, LABEL_PX_H / 2 + 1);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
    const H = glyphH * LABEL_PX_H / LABEL_GLYPH;   // sprite 世界高
    sp.scale.set(H * tw / LABEL_PX_H, H, 1);
    sp.renderOrder = 20;                            // 标签永远压在最上层
    sp.userData.text = text;                        // 供 labelBoxes() 自检点名
    return sp;
  }

  /* --- 材质 --- */
  // 眼球壳：低不透明度的玻璃感 —— 必须能看见里面的晶状体与视网膜，所以不用 transmission
  const scleraMat = new THREE.MeshPhysicalMaterial({
    color: '#cfe6f5', metalness: 0, roughness: .16,
    transparent: true, opacity: envTex ? .20 : .16,
    side: THREE.DoubleSide, depthWrite: false,
    clearcoat: 1, clearcoatRoughness: .07, envMapIntensity: 1.4,
    emissive: new THREE.Color('#12384c'), emissiveIntensity: .5
  });
  const scleraEdgeMat = new THREE.LineBasicMaterial({ color: '#7fd7e8', transparent: true, opacity: .34 });
  // 视网膜：内表面，暖红，不透明
  const retinaMat = new THREE.MeshStandardMaterial({
    color: '#c2564f', roughness: .78, metalness: 0, side: THREE.DoubleSide,
    emissive: new THREE.Color('#5c1f1c'), emissiveIntensity: .45
  });
  // 角膜：更亮的玻璃
  const corneaMat = new THREE.MeshPhysicalMaterial({
    color: '#eaf7ff', metalness: 0, roughness: .05,
    transmission: envTex ? .82 : 0, thickness: 2.0, ior: 1.376,
    transparent: true, opacity: envTex ? .55 : .34,
    side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.5,
    clearcoat: 1, clearcoatRoughness: .04,
    emissive: new THREE.Color('#1a4a63'), emissiveIntensity: .5
  });
  // 晶状体：半透明胶质
  const lensMat = new THREE.MeshPhysicalMaterial({
    color: '#dff2ff', metalness: 0, roughness: .12,
    transmission: envTex ? .80 : 0, thickness: 4.0, ior: 1.42,
    transparent: true, opacity: envTex ? .58 : .36,
    side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.3,
    clearcoat: 1, clearcoatRoughness: .08,
    emissive: new THREE.Color('#155066'), emissiveIntensity: .55
  });
  // 眼镜片：青蓝玻璃（凸 / 凹都靠几何表现）
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: '#cfe9ff', metalness: 0, roughness: .07,
    transmission: envTex ? .86 : 0, thickness: 3.0, ior: 1.5,
    transparent: true, opacity: envTex ? .52 : .32,
    side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.4,
    clearcoat: 1, clearcoatRoughness: .05,
    emissive: new THREE.Color('#17495f'), emissiveIntensity: .5
  });

  /* --- 球面回转体（镜片 / 晶状体共用）---
     剖面：x(r) = (apex + R) − R·√(1 − (r/R)²)，绕 x 轴旋转。 */
  function revolve(apex, R, aperture, rings, segs) {
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
  // 由「半口径 a、矢高 s」反解球面半径：R = (a² + s²) / (2s)
  function sagRadius(a, s) { return (a * a + s * s) / (2 * s); }

  /* --- 场景容器 --- */
  const eyeGroup = new THREE.Group(); scene.add(eyeGroup);
  const glassGroup = new THREE.Group(); scene.add(glassGroup);
  const rayGroup = new THREE.Group(); scene.add(rayGroup);
  const markGroup = new THREE.Group(); scene.add(markGroup);
  const axisGroup = new THREE.Group(); scene.add(axisGroup);

  // 主光轴（细虚线，贯穿整个场景）
  (() => {
    const pts = [];
    for (let x = -260; x <= 60; x += 4) pts.push(new THREE.Vector3(x, 0, 0));
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const m = new THREE.LineDashedMaterial({ color: '#4f6b80', transparent: true, opacity: .75,
      dashSize: 4, gapSize: 3.2, depthWrite: false });
    const l = new THREE.Line(g, m); l.computeLineDistances();
    l.renderOrder = 4;                       // 主光轴穿眼而过，压在眼球壳上才看得见
    axisGroup.add(l);
  })();

  function clearGroup(g) {
    while (g.children.length) {
      const c = g.children[0];
      g.remove(c);
      // 🔴 重建时必须显式释放：拖一次滑块就 rebuildAll 一次，
      //    标签的 CanvasTexture（300×64 一张）与细管几何不释放就是纯泄漏。
      //    ⚠️ Sprite 的 geometry 是 three.js 里的【全局共享单例】，绝不能 dispose。
      if (c.isSprite) {
        if (c.material) {
          if (c.material.map) c.material.map.dispose();
          c.material.dispose();
        }
      } else if (c.geometry && c.geometry.dispose) {
        c.geometry.dispose();
      }
    }
  }
  function addSeg(group, p1, p2, material) {
    const g = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    const l = new THREE.Line(g, material); group.add(l); return l;
  }
  const rayMatA = new THREE.LineBasicMaterial({ color: '#fbbf24', transparent: true, opacity: .95 });
  const rayMatB = new THREE.LineBasicMaterial({ color: '#22d3ee', transparent: true, opacity: .95 });
  const rayMatExt = new THREE.LineDashedMaterial({ color: '#a78bfa', transparent: true, opacity: .8,
    dashSize: 2.2, gapSize: 1.8, depthWrite: false });
  // 🔴 光路是本页的【核心教学内容】，而 WebGL 的 LineBasicMaterial.linewidth 在几乎所有平台
  //    都被忽略 ⇒ 光线恒为 1 物理像素。在 Retina（DPR 2）上那就是 0.5 CSS px 的一根发丝。
  //    改用「细管」画：TubeGeometry + LineCurve3，半径给世界单位 ⇒ 任何 DPR 下都够粗。
  //    （管是实体，所以透明材质 + depthWrite:false，仍旧排在眼球壳之后。）
  const HAS_TUBE = typeof THREE.TubeGeometry === 'function' && typeof THREE.LineCurve3 === 'function';
  const RAY_R = 0.10;                                    // 光线管半径 mm
  const tubeMatA = new THREE.MeshBasicMaterial({ color: '#fbbf24', transparent: true, opacity: .98, depthWrite: false });
  const tubeMatB = new THREE.MeshBasicMaterial({ color: '#22d3ee', transparent: true, opacity: .98, depthWrite: false });
  const tubeMatExt = new THREE.MeshBasicMaterial({ color: '#a78bfa', transparent: true, opacity: .85, depthWrite: false });

  /* --- 建模：眼球（壳 + 经纬环 + 角膜 + 晶状体 + 视网膜） --- */
  function buildEye(g, o) {
    clearGroup(eyeGroup);
    const { Rx, Ry, xCornea, xRetina } = g;

    // 眼球壳（椭球）
    const shell = mesh(new THREE.SphereGeometry(1, 48, 32), scleraMat, eyeGroup, 0, 0, 0);
    shell.scale.set(Rx, Ry, Ry);
    // 🔴 眼球壳必须先于光线渲染，否则会把穿在里面的光线整片蒙住
    //    （所有 Line 的 object.position 都是 (0,0,0)，透明排序里和球心距离相同 ⇒
    //     顺序不稳定；实测症状是「眼球外面看得见光、一进眼球就没了」）。
    shell.renderOrder = 2;

    // 三个正交椭圆环，强化「球体」的立体感
    const ring = (ax, ay) => {
      const pts = [];
      for (let i = 0; i <= 72; i++) {
        const a = i / 72 * Math.PI * 2;
        pts.push(new THREE.Vector3(ax * Math.cos(a), ay * Math.sin(a), 0));
      }
      return new THREE.BufferGeometry().setFromPoints(pts);
    };
    const rXY = new THREE.LineLoop(ring(Rx, Ry), scleraEdgeMat);
    const rXZ = new THREE.LineLoop(ring(Rx, Ry), scleraEdgeMat); rXZ.rotation.x = Math.PI / 2;
    const rYZ = new THREE.LineLoop(ring(Ry, Ry), scleraEdgeMat); rYZ.rotation.y = Math.PI / 2;
    eyeGroup.add(rXY, rXZ, rYZ);

    // 视网膜：眼球内表面的后半侧
    const ret = new THREE.Mesh(
      new THREE.SphereGeometry(1, 48, 26, Math.PI / 2, Math.PI, 0, Math.PI), retinaMat);
    ret.scale.set(Rx * 0.985, Ry * 0.985, Ry * 0.985);
    eyeGroup.add(ret);

    // 角膜：以 −x 极为中心的球冠，顶点正好落在 xCornea
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(CORNEA_R, 40, 20, 0, Math.PI * 2, 0, CORNEA_HALF), corneaMat);
    cap.rotation.z = Math.PI / 2;              // +y 极 ⇒ −x 极
    cap.position.set(xCornea + CORNEA_R, 0, 0);
    eyeGroup.add(cap);

    // 晶状体：双凸回转体，中央厚度随睫状肌变化
    const t = LENS_THICK_RELAX + (LENS_THICK_TIGHT - LENS_THICK_RELAX) * o.p;
    const a = LENS_DIA / 2, sag = Math.max(.12, (t - LENS_EDGE) / 2);
    const R = sagRadius(a, sag);
    const xLens = xCornea + CORNEA_R * 0.34 + 2.2;
    eyeGroup.add(mesh(revolve(-t / 2, R, a, 14, 56), lensMat, eyeGroup, xLens, 0, 0));
    eyeGroup.add(mesh(revolve(t / 2, -R, a, 14, 56), lensMat, eyeGroup, xLens, 0, 0));

    // 标注（第三参 = 字高，世界单位 mm；z 各错开一点 ⇒ 俯视/轴向视角下不会叠成一行）
    const lbRet = label('视网膜', '#f0a8a2', 1.35);
    lbRet.position.set(xRetina + 3.2, -Ry * 0.62, 2.6); eyeGroup.add(lbRet);
    const lbLens = label('晶状体', '#a5e9ff', 1.25);
    lbLens.position.set(xLens - 3.0, a + 3.4, 0); eyeGroup.add(lbLens);
    const lbCor = label('角膜', '#cdf3ff', 1.15);
    lbCor.position.set(xCornea - 1.0, -Ry * 0.86, -2.6); eyeGroup.add(lbCor);

    // 眼球前后径的标注线（几何量必须看得见）
    const dimMat = new THREE.LineBasicMaterial({ color: '#f9a8d4', transparent: true, opacity: .8 });
    const yD = -Ry - 2.6;
    addSeg(eyeGroup, new THREE.Vector3(xCornea, yD, 0), new THREE.Vector3(xRetina, yD, 0), dimMat);
    addSeg(eyeGroup, new THREE.Vector3(xCornea, yD - 1.1, 0), new THREE.Vector3(xCornea, yD + 1.1, 0), dimMat);
    addSeg(eyeGroup, new THREE.Vector3(xRetina, yD - 1.1, 0), new THREE.Vector3(xRetina, yD + 1.1, 0), dimMat);
    const lbDim = label(g.len.toFixed(1) + ' mm', '#f9a8d4', 1.70);
    lbDim.position.set(0, yD - 2.9, -5.0); eyeGroup.add(lbDim);

    return { shell, xLens, lensThick: t, lensR: R };
  }

  /* --- 建模：眼镜 --- */
  function buildGlasses(g) {
    clearGroup(glassGroup);
    const xG = g.xCornea - GLASS_GAP;
    if (!state.showGlasses || !state.wearGlasses) return { x: xG, present: false };

    const a = GLASS_DIA / 2;
    const d = state.diopter;
    const positive = d > 0;                       // 正度数 = 凸透镜
    const centerT = positive ? 3.4 : 0.9;
    const edgeT = positive ? 0.9 : 3.4;
    const sag = (edgeT - centerT) / 2;            // 凸：负；凹：正
    const R = sagRadius(a, Math.abs(sag) < 1e-6 ? .2 : Math.abs(sag));

    // 前表面：凸透镜 R>0（中间厚）；凹透镜 R<0
    const g1 = revolve(-centerT / 2, positive ? R : -R, a, 10, 56);
    const g2 = revolve(centerT / 2, positive ? -R : R, a, 10, 56);
    glassGroup.add(mesh(g1, glassMat, glassGroup, xG, 0, 0));
    glassGroup.add(mesh(g2, glassMat, glassGroup, xG, 0, 0));
    // 边缘侧壁：把两片曲面在 r = a 处连起来。
    // 不加的话凹透镜（中央薄、边缘厚）看起来像【两片分离的弧】，中间一条缝。
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(a, a, edgeT, 56, 1, true), glassMat);
    wall.rotation.z = Math.PI / 2;             // 圆柱轴 y → x
    wall.position.set(xG, 0, 0);
    glassGroup.add(wall);

    // 🔴 这里的 a 是【镜片】半径（GLASS_DIA/2 = 15），不是晶状体半径。
    //    原来写成 a + 5.2 / a + 9.6 ⇒ 名称标签落在世界 y = 24.6，
    //    而 section 视角可见半高只有 26.34 ⇒ 标签上沿 26.56 被画布切掉（实测抓到）。
    //    改到 a + 3.2 / a + 7.2，上沿 23.96，留 2.4 的余量。
    const lb = label((d > 0 ? '+' : '') + d + ' 度', d > 0 ? '#fcd34d' : '#a5b4fc', 1.80);
    lb.position.set(xG, a + 3.2, 0); glassGroup.add(lb);
    const lbName = label(d > 0 ? '凸透镜（远视用）' : (d < 0 ? '凹透镜（近视用）' : '平光镜'), '#9fd8ea', 2.20);
    lbName.position.set(xG, a + 7.2, 0); glassGroup.add(lbName);
    return { x: xG, present: true, R, centerT, edgeT, positive };
  }

  /* --- 建模：光路 --- */
  function buildRays(o) {
    clearGroup(rayGroup);
    if (!state.showRays) return [];

    // 🔴 光线必须画在眼球壳【之后】（renderOrder > 壳的 2）。
    //    所有 Line 的 object.position 都是 (0,0,0)，透明排序里和球心距离一样，
    //    顺序不稳定 ⇒ 壳偶尔盖在光线上，症状是「光在眼球外面看得见、一进去就没了」。
    const RAY_ORDER = 6;
    const tubeOf = { a: tubeMatA, b: tubeMatB, ext: tubeMatExt };
    const lineOf = { a: rayMatA, b: rayMatB, ext: rayMatExt };

    // 画一段光线：优先细管（够粗），打包里没有 TubeGeometry 时回退到 Line
    const seg = (p1, p2, kind) => {
      if (HAS_TUBE) {
        const m = new THREE.Mesh(
          new THREE.TubeGeometry(new THREE.LineCurve3(p1, p2), 1, RAY_R, 8, false), tubeOf[kind]);
        m.renderOrder = RAY_ORDER; rayGroup.add(m); return m;
      }
      const l = addSeg(rayGroup, p1, p2, lineOf[kind]);
      if (kind === 'ext') l.computeLineDistances();
      l.renderOrder = RAY_ORDER; return l;
    };
    // 虚线延长：管没法用 dash，就一段段摆出来
    const segDash = (p1, p2, kind, dash = 2.2, gap = 1.8) => {
      const dir = new THREE.Vector3().subVectors(p2, p1);
      const len = dir.length();
      if (len < 1e-6) return;
      if (!HAS_TUBE) { seg(p1, p2, kind); return; }
      dir.normalize();
      let t = 0, guard = 0;
      while (t < len && guard++ < 80) {
        const t2 = Math.min(len, t + dash);
        seg(new THREE.Vector3().copy(p1).addScaledVector(dir, t),
            new THREE.Vector3().copy(p1).addScaledVector(dir, t2), kind);
        t = t2 + gap;
      }
    };

    const out = [];
    for (const r of o.rays) {
      // 物 → 眼镜 → 角膜：按真实分段画（第一段从场景外进来，裁掉太远的部分）
      r.segs.forEach((s, si) => {
        if (s.x1 < -300) return;
        const x0 = Math.max(s.x0, -300);
        const t = (x0 - s.x0) / Math.max(1e-9, s.x1 - s.x0);
        const y0 = s.y0 + (s.y1 - s.y0) * t;
        // 第一段 = 物体发出的光（金色）；之后各段 = 已进入镜片 / 眼球的光（青色）
        seg(new THREE.Vector3(x0, y0, 0), new THREE.Vector3(s.x1, s.y1, 0), si === 0 ? 'a' : 'b');
      });
      // 角膜 → 眼球内表面：出射光线的实际路径
      const hit = hitEyeball(r.x, r.y, r.s, o.g.Rx, o.g.Ry);
      const xEnd = hit ? hit.x : o.g.xRetina;
      const yEnd = r.y + r.s * (xEnd - r.x);
      seg(new THREE.Vector3(r.x, r.y, 0), new THREE.Vector3(xEnd, yEnd, 0), 'b');
      out.push({ x0: r.x, y0: r.y, x1: xEnd, y1: yEnd, s: r.s });

      // 会聚点在视网膜【后面】时，用虚线延长表示「延长线才相交」
      if (Number.isFinite(o.xFocus) && o.xFocus > xEnd + 1e-6) {
        const yF = r.y + r.s * (o.xFocus - r.x);
        segDash(new THREE.Vector3(xEnd, yEnd, 0), new THREE.Vector3(o.xFocus, yF, 0), 'ext');
      }
    }
    return out;
  }

  /* --- 建模：会聚点 + 视网膜上的弥散斑 --- */
  // 弥散斑的【画面半径】：物理弥散半径放大 BLUR_K，再夹到眼球半高以内。
  // 🔴 渲染与自检探针【共用这一处公式】，但探针必须用物理量 o.blurR 独立算，
  //    绝不能读渲染结果（drawn）—— 否则「把圆环改小」会把取样盒一起改小，
  //    断言退化成自指恒等式（量的是「那个小东西变没变」，不是「光斑画没画出来」）。
  function blurSpotR(blurR, Ry) { return Math.min(blurR * BLUR_K, Ry * 0.92); }

  function buildMarks(o) {
    clearGroup(markGroup);
    const { Rx, Ry, xRetina } = o.g;

    // 会聚点（在眼球内或外面都标出来）
    if (Number.isFinite(o.xFocus) && Number.isFinite(o.off) && Math.abs(o.off) < 60) {
      const col = o.side === 'on' ? '#6ee7b7' : (o.side === 'front' ? '#38bdf8' : '#f472b6');
      // 🔴 会聚点标记必须画在光线【之后】，而且必须关掉深度测试。
      //    两个坑叠在一起：① 原来它是不透明球（走 opaque pass，永远排在透明光线之前）；
      //    ② 会聚点在眼球内部时，从侧面看它落在【视网膜曲面的前表面之后】
      //    （视网膜是 DoubleSide 球壳，屏幕同一像素上前表面在 z 更靠前）⇒ 被整片挡住。
      //    实测：关掉深度测试前，「弥散斑」开关前后画面【一个像素都不变】。
      const dot = mesh(new THREE.SphereGeometry(.62, 16, 12),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: .98,
          depthWrite: false, depthTest: false }),
        markGroup, o.xFocus, 0, 0);
      dot.renderOrder = 10;
      const ringPts = [];
      for (let i = 0; i <= 48; i++) {
        const a = i / 48 * Math.PI * 2;
        ringPts.push(new THREE.Vector3(o.xFocus, 1.7 * Math.cos(a), 1.7 * Math.sin(a)));
      }
      const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ringPts),
        new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: .75, depthTest: false }));
      ring.renderOrder = 11;                   // 会聚点圈也要压在眼球壳与光线之上
      markGroup.add(ring);
      dot.name = 'focus';
    }

    // 弥散斑：视网膜上实际摊开的光斑（按 BLUR_K 放大才看得见）
    if (state.showBlur && Number.isFinite(o.blurR) && o.blurR > 0.02) {
      const rr = blurSpotR(o.blurR, Ry);
      const xB = xRetina - .3;
      // 🔴 弥散斑画在视网膜上，但视网膜是 DoubleSide 球壳 ——
      //    从侧面看，同一屏幕像素上视网膜【前表面】的 z 更靠前 ⇒ 斑被整片挡住。
      //    实测：关掉深度测试前，弥散斑开关前后画面【一个像素都不变】。
      //    这是标注不是实体，跟标签一样走 depthTest:false + 高 renderOrder。
      const disc = new THREE.Mesh(new THREE.CircleGeometry(rr, 40),
        new THREE.MeshBasicMaterial({ color: '#fde68a', transparent: true, opacity: .30,
          side: THREE.DoubleSide, depthWrite: false, depthTest: false }));
      disc.rotation.y = Math.PI / 2;           // 圆面法线转到 x 轴（正对光轴）
      disc.position.set(xB, 0, 0); disc.renderOrder = 7;
      markGroup.add(disc);

      const band = new THREE.Mesh(new THREE.RingGeometry(Math.max(1e-3, rr * 0.68), rr, 40, 1),
        new THREE.MeshBasicMaterial({ color: '#fff7ed', transparent: true, opacity: .95,
          side: THREE.DoubleSide, depthWrite: false, depthTest: false }));
      band.rotation.y = Math.PI / 2;
      band.position.set(xB - .25, 0, 0); band.renderOrder = 8;
      markGroup.add(band);

      const lb = label('弥散斑 ×' + BLUR_K + '（' + o.blurR.toFixed(2) + ' mm）', '#fde68a', 1.5);
      lb.position.set(xRetina - 1.0, Ry + 3.6, 3.2);   // 挪到眼球【上方】，不再压住视网膜
      markGroup.add(lb);
    }
    return { blurR: o.blurR, blurShown: state.showBlur && Number.isFinite(o.blurR) && o.blurR > 0.02 };
  }

  /* ================= 读数与 UI ================= */
  function sideText(side) {
    return side === 'on' ? '视网膜上' : (side === 'front' ? '视网膜前' : '视网膜后');
  }
  function eyeTypeName() {
    return EYE_TYPES[state.eyeType] ? EYE_TYPES[state.eyeType].name : '自定义';
  }
  function sharpText(o) {
    if (!Number.isFinite(o.off)) return '—';
    if (o.onRetina) return '清晰';
    return o.side === 'front' ? '看不清远处' : '看不清近处';
  }

  function updateReadouts(o) {
    const deg = state.wearGlasses ? state.diopter : null;
    $('roLen').textContent = o.g.len.toFixed(1) + ' mm';
    $('roF').textContent = o.fLens.toFixed(1) + ' mm';
    $('roOff').textContent = (Number.isFinite(o.off) ? (o.off >= 0 ? '+' : '') + o.off.toFixed(2) : '—') + ' mm';
    $('roOff').className = o.onRetina ? 'ok' : 'warn';
    $('roSharp').textContent = sharpText(o);
    $('roSharp').className = o.onRetina ? 'ok' : 'warn';
    $('roNote').textContent = '偏差 > 0 表示会聚点在视网膜【后】面（远视）；< 0 表示在前面（近视）';

    $('metricType').textContent = eyeTypeName();
    $('metricLen').textContent = o.g.len.toFixed(1) + ' mm';
    $('metricOff').textContent = (Number.isFinite(o.off) ? (o.off >= 0 ? '+' : '') + o.off.toFixed(2) : '—') + ' mm';
    $('metricOff').className = o.onRetina ? 'good' : 'warn';
    $('metricDeg').textContent = state.wearGlasses
      ? ((state.diopter > 0 ? '+' : '') + state.diopter + ' 度') : '不戴眼镜';

    $('lenValue').textContent = o.g.len.toFixed(1) + ' mm';
    $('powerValue').textContent = state.lensPower <= 2 ? '完全放松'
      : (state.lensPower >= 98 ? '全力收缩' : '收缩 ' + state.lensPower + '%');
    $('distValue').textContent = state.u >= U_MAX - 1 ? '5.0 m（近似无穷远）' : (state.u / 10).toFixed(0) + ' cm';
    $('degValue').textContent = (state.diopter > 0 ? '+' : '') + state.diopter + ' 度';

    $('focusHead').textContent = Number.isFinite(o.off)
      ? (o.onRetina ? '会聚点正好落在视网膜上'
        : '会聚点在视网膜' + (o.side === 'front' ? '前' : '后') + ' ' + Math.abs(o.off).toFixed(2) + ' mm')
      : '光线平行，不成像';
  }

  // 会聚点位置条：把 ±OFF_MAX 映射到整条，三色区按视网膜位置切分
  function layoutFocusBar(o) {
    const track = $('focusTrack');
    const W = track.clientWidth || 1;
    const off = Number.isFinite(o.off) ? clamp(o.off, -OFF_MAX, OFF_MAX) : 0;
    const markPct = (off + OFF_MAX) / (2 * OFF_MAX) * 100;
    $('focusMark').style.left = markPct + '%';
    $('focusMark').style.display = Number.isFinite(o.off) ? '' : 'none';

    // 三个色区：视网膜前 / 视网膜上（±SHARP_TOL）/ 视网膜后
    const lo = (-SHARP_TOL + OFF_MAX) / (2 * OFF_MAX) * 100;
    const hi = (SHARP_TOL + OFF_MAX) / (2 * OFF_MAX) * 100;
    $('focusFront').style.left = '0%'; $('focusFront').style.width = lo + '%';
    $('focusOn').style.left = lo + '%'; $('focusOn').style.width = (hi - lo) + '%';
    $('focusBack').style.left = hi + '%'; $('focusBack').style.width = (100 - hi) + '%';
    $('focusFront').style.display = lo > 0.5 ? '' : 'none';
    $('focusOn').style.display = (hi - lo) > 0.5 ? '' : 'none';
    $('focusBack').style.display = (100 - hi) > 0.5 ? '' : 'none';
    $('scaleNear').style.left = '0%';
    $('scaleZero').style.left = '50%';
    $('scaleFar').style.left = '100%';
    return { W, markPct, lo, hi };
  }

  function describe(o) {
    const name = eyeTypeName();
    const far = farPoint(o.g.len), near = nearPoint(o.g.len);
    let txt = '<b>' + name + '：</b>眼球前后径 ' + o.g.len.toFixed(1) + ' mm。';
    if (o.onRetina) {
      txt += '会聚点正好落在视网膜上 ⇒ <b>看得清</b>。';
    } else if (o.side === 'front') {
      txt += '会聚点落在视网膜<b>前面</b> ' + Math.abs(o.off).toFixed(2) +
        ' mm ⇒ 这是<b>近视</b>的表现，远处的东西看不清（凹透镜矫正）。';
    } else {
      txt += '会聚点落在视网膜<b>后面</b> ' + Math.abs(o.off).toFixed(2) +
        ' mm ⇒ 这是<b>远视</b>的表现，近处的东西看不清（凸透镜矫正）。';
    }
    if (Number.isFinite(far) && far > 0) txt += ' 远点约 ' + (far / 10).toFixed(0) + ' cm。';
    if (Number.isFinite(near) && near > 0) txt += ' 近点约 ' + (near / 10).toFixed(0) + ' cm。';
    return txt;
  }

  /* ================= 渲染 ================= */
  function cameraPosition() {
    const aspect = Math.max(0.2, camera.aspect);
    const k = Math.max(1, ASPECT_REF / aspect);
    const r = (CAM_R * k) / state.zoom;
    camera.position.set(
      target.x + r * Math.sin(state.yaw) * Math.cos(state.pitch),
      target.y + r * Math.sin(state.pitch),
      target.z + r * Math.cos(state.yaw) * Math.cos(state.pitch)
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

  const drawn = { eye: null, glasses: null, rays: [], marks: null, optics: null };

  function rebuildAll() {
    const o = optics();
    drawn.optics = o;
    drawn.eye = buildEye(o.g, o);
    drawn.glasses = buildGlasses(o.g);
    drawn.rays = buildRays(o);
    drawn.marks = buildMarks(o);
    axisGroup.visible = true;
    updateReadouts(o);
    layoutFocusBar(o);
    $('finding').innerHTML = describe(o);
    render();
  }

  /* ================= 像素统计（供自检） ================= */
  // 把世界坐标的一个长方体投到画布像素，取回像素后降采样成 cols×rows 的【块平均】签名。
  // 🔴 判「某物真的画出来了」必须用【差分】（开关前后签名里变化格占比），不要用颜色匹配 ——
  //    本页开着 ACES 色调映射，材质色到了画布上已经不是原色（金 #fbbf24 会变成淡黄）。
  function regionSignature(box, cols) {
    const zs = box.zs || [box.z === undefined ? 0 : box.z];
    const corners = [];
    for (const x of [box.x0, box.x1]) for (const y of [box.y0, box.y1]) for (const z of zs)
      corners.push(new THREE.Vector3(x, y, z));
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const c of corners) {
      const v = c.clone().project(camera);
      const px = (v.x * .5 + .5) * state.w, py = (-v.y * .5 + .5) * state.h;
      x0 = Math.min(x0, px); x1 = Math.max(x1, px);
      y0 = Math.min(y0, py); y1 = Math.max(y1, py);
    }
    const cw = canvas.width, ch = canvas.height;
    const sx = cw / Math.max(1, state.w), sy = ch / Math.max(1, state.h);
    const rx = clamp(Math.round(x0 * sx), 0, cw - 1), ry = clamp(Math.round(y0 * sy), 0, ch - 1);
    const rw = clamp(Math.round((x1 - x0) * sx), 1, cw - rx), rh = clamp(Math.round((y1 - y0) * sy), 1, ch - ry);
    const c2 = document.createElement('canvas');
    // 🔴 取像素必须【在 drawImage 里降采样】：缩到 ≤120 px 宽再 getImageData，
    //    像素数从 ~2 000 000 降到 ~7 000 —— 负向对照要对全量断言重跑几十次，
    //    不降采样的话单次取像素就要 1~2 s，整套跑不动。
    const dsc = Math.min(1, 120 / Math.max(1, rw));
    c2.width = Math.max(1, Math.round(rw * dsc)); c2.height = Math.max(1, Math.round(rh * dsc));
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
    const C = Math.max(2, cols || 10);
    const R = Math.max(2, Math.round(C * c2.height / Math.max(1, c2.width)));
    const blk = new Array(C * R).fill(0), cnt = new Array(C * R).fill(0);
    for (let y = 0; y < c2.height; y++) {
      const by = Math.min(R - 1, Math.floor(y * R / c2.height));
      for (let x = 0; x < c2.width; x++) {
        const bx = Math.min(C - 1, Math.floor(x * C / c2.width));
        const i = (y * c2.width + x) * 4;
        blk[by * C + bx] += (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
        cnt[by * C + bx]++;
      }
    }
    for (let k = 0; k < blk.length; k++) blk[k] = cnt[k] ? blk[k] / cnt[k] : 0;
    return { present: true, rect: { x: rx, y: ry, w: c2.width, h: c2.height },
             n: N, mean, std: Math.sqrt(Math.max(0, sum2 / N - mean * mean)),
             cols: C, rows: R, blocks: blk };
  }

  // 眼球内部（晶状体之后 → 视网膜之前）的取样盒：光线若真画得出来，这块必然有变化
  function eyeInteriorBox() {
    const g = eyeGeom(state.len);
    const xLens = g.xCornea + CORNEA_R * 0.34 + 2.2;
    return { x0: xLens + 2.2, x1: g.xRetina - 1.2, y0: -g.Ry * 0.55, y1: g.Ry * 0.55, z: 0 };
  }

  // 视网膜附近的一块区域：亮度均值与标准差（弥散斑越小 ⇒ 光越集中 ⇒ 标准差越大）
  function retinaRegionStats() {
    const o = drawn.optics; if (!o) return { present: false };
    const { Rx, Ry } = o.g;
    const s = regionSignature({ x0: Rx * -0.2 - 4, x1: Rx * 0.55 + 6, y0: -Ry * 0.4, y1: Ry * 0.4,
      zs: [-Ry * 0.4, Ry * 0.4] }, 12);
    return { present: s.present, rect: s.rect, mean: s.mean, std: s.std };
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
    state.pitch = clamp(state.pitch + (e.clientY - prev.y) * .005, -1.35, 1.35);
    prev = { x: e.clientX, y: e.clientY };
    render();
  });
  const endDrag = (e) => {
    dragging = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* 指针已释放 */ }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    state.zoom = clamp(state.zoom * (e.deltaY > 0 ? .93 : 1.075), .45, 3.4);
    render();
  }, { passive: false });
  canvas.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? .22 : .09;
    if (e.key === 'ArrowLeft') state.yaw -= step;
    else if (e.key === 'ArrowRight') state.yaw += step;
    else if (e.key === 'ArrowUp') state.pitch = clamp(state.pitch + step, -1.35, 1.35);
    else if (e.key === 'ArrowDown') state.pitch = clamp(state.pitch - step, -1.35, 1.35);
    else if (e.key === '+' || e.key === '=') state.zoom = clamp(state.zoom * 1.1, .45, 3.4);
    else if (e.key === '-') state.zoom = clamp(state.zoom / 1.1, .45, 3.4);
    else return;
    e.preventDefault(); render();
  });

  function applyView(name) {
    const v = VIEWS[name]; if (!v) return false;
    const n = new THREE.Vector3(v[0], v[1], v[2]).normalize();
    state.yaw = Math.atan2(n.x, n.z);
    state.pitch = Math.asin(clamp(n.y, -1, 1));
    state.zoom = 1;
    state.view = name;
    syncViewButtons(name);
    return true;
  }
  function syncViewButtons(name) {
    document.querySelectorAll('.toolbar button[data-view]').forEach((b) =>
      b.classList.toggle('active', b.dataset.view === name));
  }
  document.querySelectorAll('.toolbar button[data-view]').forEach((b) => {
    b.addEventListener('click', () => { applyView(b.dataset.view); render(); });
  });
  $('resetView').addEventListener('click', () => { applyView('perspective'); render(); });

  /* ================= 交互：控件 ================= */
  function syncEyeButtons() {
    document.querySelectorAll('#eyeType button').forEach((b) =>
      b.classList.toggle('active', b.dataset.eye === state.eyeType));
  }
  function setEyeType(key, keepLen) {
    state.eyeType = key;
    if (!keepLen && EYE_TYPES[key]) state.len = EYE_TYPES[key].len;
    $('eyeLength').value = state.len;
    syncEyeButtons();
    rebuildAll();
  }
  function setLen(v) {
    state.len = clamp(v, LEN_MIN, LEN_MAX);
    state.eyeType = Object.keys(EYE_TYPES).find((k) => Math.abs(EYE_TYPES[k].len - state.len) < 0.05) || 'custom';
    $('eyeLength').value = state.len;
    syncEyeButtons();
    rebuildAll();
  }
  function setPower(v) {
    state.lensPower = clamp(v, 0, 100);
    $('lensPower').value = state.lensPower;
    rebuildAll();
  }
  function setDist(v) {
    state.u = clamp(v, U_MIN, U_MAX);
    $('objectDist').value = state.u;
    rebuildAll();
  }
  function setWear(on) {
    state.wearGlasses = !!on;
    $('wearGlasses').checked = state.wearGlasses;
    $('diopter').disabled = !state.wearGlasses;
    rebuildAll();
  }
  function setDiopter(d) {
    state.diopter = clamp(Math.round(d / DIOPTER_STEP) * DIOPTER_STEP, DIOPTER_MIN, DIOPTER_MAX);
    $('diopter').value = state.diopter;
    rebuildAll();
  }
  // 自动配镜：先让眼睛回到「看远处」的状态（放松 + 物体放最远），再算度数并戴上
  function autoFit() {
    state.lensPower = 0;
    state.u = U_MAX;
    state.wearGlasses = true;
    state.diopter = neededDiopter(state.len);
    $('lensPower').value = 0;
    $('objectDist').value = U_MAX;
    $('wearGlasses').checked = true;
    $('diopter').disabled = false;
    $('diopter').value = state.diopter;
    rebuildAll();
  }
  function setToggle(id, on) {
    state[id] = !!on;
    const el = $(id); if (el) el.checked = state[id];
    rebuildAll();
  }

  document.querySelectorAll('#eyeType button').forEach((b) =>
    b.addEventListener('click', () => setEyeType(b.dataset.eye)));
  $('eyeLength').addEventListener('input', (e) => setLen(parseFloat(e.target.value)));
  $('lensPower').addEventListener('input', (e) => setPower(parseFloat(e.target.value)));
  $('objectDist').addEventListener('input', (e) => setDist(parseFloat(e.target.value)));
  $('wearGlasses').addEventListener('change', (e) => setWear(e.target.checked));
  $('diopter').addEventListener('input', (e) => setDiopter(parseFloat(e.target.value)));
  $('fitBtn').addEventListener('click', autoFit);
  $('stageFitBtn').addEventListener('click', autoFit);
  $('takeOffBtn').addEventListener('click', () => { setWear(false); });
  $('distInfBtn').addEventListener('click', () => { setDist(U_MAX); });
  $('distNearBtn').addEventListener('click', () => { setDist(U_MIN); });
  ['showGlasses', 'showRays', 'showRetina', 'showBlur'].forEach((id) => {
    $(id).addEventListener('change', (e) => setToggle(id, e.target.checked));
  });

  /* ================= 记录表 ================= */
  function pushRecord() {
    const o = optics();
    const deg = state.wearGlasses ? state.diopter : 0;
    // 「戴镜后偏差」列统一按【配镜的标准工况】算：睫状肌放松 + 看远处 + 戴上所需度数。
    // 这样一行记录回答的就是「这种眼型配上合适眼镜，看远处能矫正到什么程度」。
    const need = neededDiopter(o.g.len);
    const afterOff = closedForm(o.g, F_RELAX, diopterToFocal(need), U_MAX).off;
    const row = {
      eye: eyeTypeName(),
      len: o.g.len,
      side: sideText(o.side),
      off: o.off,
      sharp: sharpText(o),
      deg: deg,
      needDeg: neededDiopter(state.len),
      afterOff: afterOff
    };
    state.records.push(row);
    if (state.records.length > 6) state.records.shift();
    renderRecords(row);
  }
  function renderRecords(flashRow) {
    const tb = $('records');
    if (!state.records.length) {
      tb.innerHTML = '<tr><td colspan="8" class="empty">尚无记录，先选一种眼型再点「记录当前数据」</td></tr>';
      $('summary').textContent = '记录三行以上，就能看出「眼球前后径 → 会聚点位置 → 需要什么透镜」的对应关系。';
      return;
    }
    tb.innerHTML = state.records.map((r, i) => {
      const cls = (flashRow === r ? 'filled flash' : 'filled');
      const off = Number.isFinite(r.off) ? (r.off >= 0 ? '+' : '') + r.off.toFixed(2) : '—';
      const after = Number.isFinite(r.afterOff) ? (r.afterOff >= 0 ? '+' : '') + r.afterOff.toFixed(2) : '—';
      const degTxt = r.deg === 0 ? '不戴眼镜' : ((r.deg > 0 ? '+' : '') + r.deg + ' 度');
      return '<tr class="' + cls + '"><td>' + (i + 1) + '</td><td>' + r.eye + '</td><td>' + r.len.toFixed(1) +
        '</td><td>' + r.side + '</td><td>' + off + '</td><td>' + r.sharp + '</td><td>' + degTxt +
        '</td><td>' + after + '</td></tr>';
    }).join('');
    $('summary').textContent = '已记录 ' + state.records.length + ' 组。';
  }
  function recordNow() { pushRecord(); }
  function recordAll() {
    const saved = { type: state.eyeType, len: state.len, power: state.lensPower, u: state.u, wear: state.wearGlasses, d: state.diopter };
    for (const k of Object.keys(EYE_TYPES)) {
      state.eyeType = k; state.len = EYE_TYPES[k].len;
      state.lensPower = 0; state.u = U_MAX; state.wearGlasses = false; state.diopter = 0;
      pushRecord();
    }
    Object.assign(state, { eyeType: saved.type, len: saved.len, lensPower: saved.power, u: saved.u,
      wearGlasses: saved.wear, diopter: saved.d });
    $('eyeLength').value = state.len; $('lensPower').value = state.lensPower;
    $('objectDist').value = state.u; $('wearGlasses').checked = state.wearGlasses;
    $('diopter').value = state.diopter; $('diopter').disabled = !state.wearGlasses;
    syncEyeButtons();
    rebuildAll();
  }
  $('recordBtn').addEventListener('click', recordNow);
  $('recordBtn2').addEventListener('click', recordNow);
  $('stageRecordBtn').addEventListener('click', recordNow);
  $('recordAllBtn').addEventListener('click', recordAll);
  $('recordAllBtn2').addEventListener('click', recordAll);
  $('clearRecords').addEventListener('click', () => { state.records = []; renderRecords(); });

  $('resetAll').addEventListener('click', () => {
    Object.assign(state, {
      eyeType: 'normal', len: LEN_NORMAL, lensPower: 0, u: U_MAX,
      wearGlasses: false, diopter: 0,
      showGlasses: true, showRays: true, showRetina: true, showBlur: true
    });
    applyView('perspective');
    $('eyeLength').value = state.len; $('lensPower').value = 0; $('objectDist').value = state.u;
    $('wearGlasses').checked = false; $('diopter').value = 0; $('diopter').disabled = true;
    ['showGlasses', 'showRays', 'showRetina', 'showBlur'].forEach((id) => { $(id).checked = true; });
    syncEyeButtons();
    rebuildAll();
  });

  let rt = null;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { if (!dragging) { layoutFocusBar(drawn.optics || optics()); render(); } }, 120);
  });

  /* ================= 自检钩子 =================
     暴露页面【真正用到的】那份几何与判定。会变的量一律写成 get 访问器。 */
  window.__eyeLab = {
    state, EYE_TYPES, VIEWS, VIEW_ORDER, LEN_MIN, LEN_MAX, LEN_NORMAL,
    F_RELAX, F_TIGHT, EYE_RY, GLASS_GAP, PUPIL_R, RAY_N, OFF_MAX, SHARP_TOL,
    DIOPTER_MIN, DIOPTER_MAX, DIOPTER_STEP, LENS_DIA, LENS_EDGE,
    LENS_THICK_RELAX, LENS_THICK_TIGHT, CORNEA_R, CORNEA_HALF, GLASS_DIA,
    U_MIN, U_MAX, BLUR_K,
    HAS_TUBE, RAY_R,
    // 光线在画面上到底是「细管」还是退化成 1 px 细线（打包里没有 TubeGeometry 时）
    rayKind: () => (HAS_TUBE ? 'tube' : 'line'),
    get eyeGeom() { return eyeGeom(state.len); },
    get optics() { return optics(); },
    get drawn() { return drawn; },
    get records() { return state.records.slice(); },
    eyeGeomOf: (len) => eyeGeom(len),
    lensFocal: (p) => lensFocal(p),
    diopterToFocal: (d) => diopterToFocal(d),
    focalToDiopter: (f) => focalToDiopter(f),
    farPoint: (len) => farPoint(len),
    nearPoint: (len) => nearPoint(len),
    neededDiopter: (len) => neededDiopter(len),
    // 闭式路径：直接给一组参数算，不读 state
    closedForm: (len, fLens, fGlass, u) => {
      const cf = closedForm(eyeGeom(len), fLens, fGlass, u);
      return { vGlass: cf.vGlass, uEye: cf.uEye, vEye: cf.vEye, xFocus: cf.xFocus, off: cf.off };
    },
    // 数值追迹路径：直接给一组参数算
    traceRays: (len, fLens, fGlass, u, rayN) => {
      const g = eyeGeom(len);
      const n = rayN || RAY_N;
      const lenses = [];
      if (Number.isFinite(fGlass)) lenses.push({ x: g.xCornea - GLASS_GAP, f: fGlass });
      lenses.push({ x: g.xCornea, f: fLens });
      const xObj = g.xCornea - u;
      const rays = [];
      for (let i = 0; i < n; i++) {
        const h = n === 1 ? 0 : PUPIL_R * ((i / (n - 1)) * 2 - 1);
        rays.push(traceThin(xObj, 0, h / u, lenses));
      }
      const A = rays[0], B = rays[rays.length - 1];
      const P = meetLines({ x: A.x, y: A.y, s: A.s }, { x: B.x, y: B.y, s: B.s });
      const hits = rays.map((r) => hitEyeball(r.x, r.y, r.s, g.Rx, g.Ry)).filter(Boolean);
      let blurR = 0; for (const h of hits) blurR = Math.max(blurR, Math.abs(h.y));
      return {
        xFocus: P ? P.x : null, off: P ? P.x - g.xRetina : null,
        xRetina: g.xRetina, xCornea: g.xCornea, blurR, hitCount: hits.length,
        ends: rays.map((r) => ({ x: r.x, y: r.y, s: r.s }))
      };
    },
    setEyeType: (k, keepLen) => setEyeType(k, keepLen),
    setLen: (v) => setLen(v),
    setPower: (v) => setPower(v),
    setDist: (v) => setDist(v),
    setWear: (on) => setWear(on),
    setDiopter: (d) => setDiopter(d),
    autoFit: () => autoFit(),
    setToggle: (id, on) => setToggle(id, on),
    setView: (name) => { if (applyView(name)) render(); },
    recordNow, recordAll,
    clearRecords: () => { state.records = []; renderRecords(); },
    render, rebuildAll,
    size: () => ({ w: state.w, h: state.h, dpr: state.dpr }),
    get CAM_R() { return CAM_R; },
    setCamR: (v) => { CAM_R = v; render(); },
    // 取景探针：把内容包络投到 NDC（用途：调 CAM_R / 断言内容不出画）
    frameProbe: (pts) => {
      const list = pts || (() => {
        const g = eyeGeom(state.len);
        const out = [];
        for (const x of [-70, g.xRetina + 12]) for (const y of [-18, 18]) for (const z of [-14, 14])
          out.push([x, y, z]);
        return out;
      })();
      return list.map(([x, y, z]) => {
        const v = new THREE.Vector3(x, y, z).project(camera);
        return { x: +v.x.toFixed(4), y: +v.y.toFixed(4) };
      });
    },
    focusBar: () => {
      const el = (id) => {
        const e = $(id);
        return { left: parseFloat(e.style.left) || 0, width: parseFloat(e.style.width) || 0,
                 display: e.style.display };
      };
      return { front: el('focusFront'), on: el('focusOn'), back: el('focusBack'),
               mark: parseFloat($('focusMark').style.left) || 0,
               trackW: $('focusTrack').clientWidth || 0,
               offMax: OFF_MAX, sharpTol: SHARP_TOL };
    },
    retinaRegionStats,
    regionSignature: (box, cols) => regionSignature(box, cols),
    eyeInteriorBox,
    // 「眼球内部到底有没有画出光线」的差分判据：开关光线前后，内部取样盒的块平均变化格占比。
    // 🔴 这条是「眼球内部光线看不见」那个缺陷的守门人 ——
    //    当时开关光线、眼球内部一个格子都不变（光被眼球壳蒙住了）。
    eyeRayDiff: (cols) => {
      const box = eyeInteriorBox(), C = cols || 14;
      const was = state.showRays;
      state.showRays = true; rebuildAll(); const on = regionSignature(box, C);
      state.showRays = false; rebuildAll(); const off = regionSignature(box, C);
      state.showRays = was; rebuildAll();
      let changed = 0, maxAbs = 0;
      for (let i = 0; i < on.blocks.length; i++) {
        const dv = Math.abs(on.blocks[i] - off.blocks[i]);
        if (dv > 0.02) changed++;
        if (dv > maxAbs) maxAbs = dv;
      }
      return { n: on.blocks.length, changed, frac: changed / on.blocks.length, maxAbs };
    },
    // 「弥散斑到底有没有画出来」的差分判据：开关弥散斑前后，光斑附近的变化格占比。
    // 🔴 取样盒必须【紧贴光斑】：早先用 5×19.8 mm 的竖长条，弥散斑只占其中几个百分点
    //    ⇒ 开关前后「变化格占比」只有 2.8%，断言在「真画出来了」时反而判红。
    //    盒子按弥散半径 rr 定尺寸（只含光斑盘与亮环，不含上方那个 ×8 标签）。
    //    实测（近视 5 m / 正常 25 cm / 正常 5 m 反例）：
    //      旧盒 5×19.8  ⇒ 0.028 / 0.045 / 0     （判红）
    //      1.6rr c12   ⇒ 0.208 / 0.181 / 0     ← 采用
    //      3.0rr c12   ⇒ 0.069 / 0.056 / 0     （贴阈值，不用）
    blurDiff: (cols, boxOverride) => {
      const o = optics(); const { Ry, xRetina } = o.g;
      const rr = blurSpotR(o.blurR, Ry);
      const xB = xRetina - .3;
      const box = boxOverride || {
        x0: xB - 1.6 * rr, x1: xB + 1.6 * rr,
        y0: -1.6 * rr, y1: 1.6 * rr, z: 0
      };
      const C = cols || 12;
      const was = state.showBlur;
      state.showBlur = true; rebuildAll(); const on = regionSignature(box, C);
      state.showBlur = false; rebuildAll(); const off = regionSignature(box, C);
      state.showBlur = was; rebuildAll();
      let changed = 0, maxAbs = 0;
      for (let i = 0; i < on.blocks.length; i++) {
        const dv = Math.abs(on.blocks[i] - off.blocks[i]);
        if (dv > 0.02) changed++;
        if (dv > maxAbs) maxAbs = dv;
      }
      return { n: on.blocks.length, changed, frac: changed / on.blocks.length,
               maxAbs, blurR: o.blurR, rr, rect: on.rect };
    },
    // 画面上每个 sprite 标签投影到画布的包围盒。
    // 用途：断言「标签完整落在画布内」——「长标签被画布裁掉半个字」就是靠这条守住的。
    // 做法：投影标签中心求屏幕坐标，再用「该深度处 1 世界单位 = 多少像素」换算出半宽半高。
    // （sprite 是朝向相机的公告板，不能直接投影 scale 的两个角。）
    labelBoxes: () => {
      const out = [];
      const pxPerUnitAt = (p) => {
        const d = camera.position.distanceTo(p);
        return (state.h / 2) / (Math.tan(camera.fov * Math.PI / 360) * Math.max(1e-6, d));
      };
      scene.traverse((ob) => {
        if (!ob.isSprite || !ob.material || !ob.material.map) return;
        let vis = ob.visible, p = ob.parent;
        while (p) { if (p.visible === false) vis = false; p = p.parent; }
        if (!vis) return;
        const wp = ob.getWorldPosition(new THREE.Vector3());
        const v = wp.clone().project(camera);
        if (v.z > 1) return;                       // 在相机后面
        const k = pxPerUnitAt(wp);
        const cx = (v.x * .5 + .5) * state.w, cy = (-v.y * .5 + .5) * state.h;
        const hw = ob.scale.x / 2 * k, hh = ob.scale.y / 2 * k;
        out.push({
          text: ob.userData.text || '', z: +v.z.toFixed(4),
          x0: +(cx - hw).toFixed(1), x1: +(cx + hw).toFixed(1),
          y0: +(cy - hh).toFixed(1), y1: +(cy + hh).toFixed(1),
          w: +(hw * 2).toFixed(1), h: +(hh * 2).toFixed(1)
        });
      });
      return { w: state.w, h: state.h, boxes: out };
    },
    // 画面上实际画出去的光线端点（读的是基元，不是「意图」）
    rayEnds: () => drawn.rays.slice(),
    debug() {
      const o = optics();
      return {
        eyeType: state.eyeType, len: state.len, lensPower: state.lensPower,
        u: state.u, wearGlasses: state.wearGlasses, diopter: state.diopter,
        fLens: o.fLens, fGlass: o.fGlass, xCornea: o.g.xCornea, xRetina: o.g.xRetina,
        xFocus: Number.isFinite(o.xFocus) ? o.xFocus : null, off: Number.isFinite(o.off) ? o.off : null,
        side: o.side, onRetina: o.onRetina, blurR: Number.isFinite(o.blurR) ? o.blurR : null,
        blurShown: drawn.marks ? drawn.marks.blurShown : null,
        closedOff: o.closed.off, closedXFocus: o.closed.xFocus,
        farPoint: farPoint(o.g.len), nearPoint: nearPoint(o.g.len),
        neededDiopter: neededDiopter(state.len),
        lensThick: drawn.eye ? drawn.eye.lensThick : null,
        glassesPresent: drawn.glasses ? drawn.glasses.present : false,
        glassesR: drawn.glasses ? drawn.glasses.R : null,
        rayCount: drawn.rays.length,
        roOff: $('roOff').textContent, roSharp: $('roSharp').textContent,
        metricOff: $('metricOff').textContent, metricDeg: $('metricDeg').textContent,
        records: state.records.length
      };
    }
  };

  syncEyeButtons();
  setWear(false);
  renderRecords();
  rebuildAll();
  requestAnimationFrame(() => { render(); });
})();
