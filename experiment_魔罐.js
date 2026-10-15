import * as THREE from './assets/optics-three.min.js';

/* ============================================================================
   自动回转的"魔罐" —— 三维结构与运动仿真
   ---------------------------------------------------------------------------
   世界坐标：场景单位 = 厘米（cm），y 轴向上，地面为 y = 0。
   罐子横躺在地上，轴线沿 x，滚动方向沿 z，轴线离地 AXIS_Y = R·U。
     罐身：薄壁圆筒（半径 R、长 L）；罐底 / 盖子各开两个对称小孔（孔心离轴线 HOLE_D）。
     橡皮筋：两条（A 从罐底两孔穿出、B 从盖子两孔穿出），中部都系在同一个钩码的挂钩上。
     钩码：受重力始终停在罐子最低处，并且【不跟着罐子转】。
   物理（全部 SI 单位，渲染时乘 U 换算成 cm）：
     罐子转过 φ ⇒ 橡皮筋两端相对钩码扭过 φ ⇒ 扭转角 θ = φ = z / R。
        · 罐滚动：E_k = ½·M_CAN·v² + ½·I·ω²（薄壁圆筒 I = M_CAN·R²、ω = v/R）⇒ ½·M_CAN·v²
        · 钩码平动：E_k = ½·M_W·v²
        ⇒ 合计 E_k = ½·(2·M_CAN + M_W)·v²，记 M_EFF = 2·M_CAN + M_W
        · 橡皮筋：E_e = ½·K_T·θ²，回复力矩 τ = −K_T·θ ⇒ 等效线刚度 K_LIN = K_T / R²
     运动方程：M_EFF·z″ = −K_LIN·z − F_fric·sgn(z′)，滚动阻力 F_fric = μ·(M_CAN+M_W)·g
     库仑阻尼 ⇒ 每个【半次折返】幅度都减少同一个 ΔA = 2·F_fric / K_LIN（折返点逐次等距内缩）；
     当弹性回复力按不住静摩擦（|K_LIN·z| ≤ F_fric）时罐子停住。
   ★ 全页只有【一处】真值：accelOf() / ekOf() / eeOf()。能量条、HUD、侧栏读数、
     指标卡、图像、自检全读同一份 —— 别处不许再抄一遍公式。
   ========================================================================== */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  /* ==========================================================================
     一、物理参数
     ========================================================================== */
  const U = 100;                     // 1 m = 100 场景单位（1 场景单位 = 1 cm）
  const G = 9.8;
  const R = 0.040;                   // 罐半径 m（直径 8 cm）
  const L = 0.120;                   // 罐长 m（12 cm）
  const M_CAN = 0.060;               // 空罐质量 kg（薄壁圆筒）
  const M_W = 0.050;                 // 钩码质量 kg
  const HOLE_D = 0.022;              // 小孔中心到轴线距离 m（两孔相距 4.4 cm）
  const HANG_R = 0.018;              // 钩码挂钩到轴线距离 m
  const K_T = 0.0072;                // 橡皮筋扭转刚度 N·m/rad（教学模型值）
  const MU = 0.030;                  // 滚动阻力系数（教学模型值）

  const M_EFF = 2 * M_CAN + M_W;             // 等效质量 kg = 0.17
  const K_LIN = K_T / (R * R);               // 等效线刚度 N/m = 4.5
  const OMEGA_N = Math.sqrt(K_LIN / M_EFF);  // 固有角频率 rad/s ≈ 5.145
  const F_FRIC = MU * (M_CAN + M_W) * G;     // 滚动阻力 N ≈ 0.04312
  const V0_DEF = 1.00;                       // 默认推出初速度 m/s
  const Z_LIMIT = 0.35;                      // 观察区边界 m（侧视档画面横向约 ±34 cm）
  const TURN_V_TH = 0.02;                    // 判「已经离开折返点」的速度死区 m/s

  /* 全部物理量都从这三个函数出发 */
  const thetaOf = (z) => z / R;                                  // 扭转角 rad
  const ekOf = (v) => 0.5 * M_EFF * v * v;                       // 动能 J
  const eeOf = (z) => 0.5 * K_T * thetaOf(z) * thetaOf(z);       // 弹性势能 J
  const accelOf = (z, v) => {
    const fr = Math.abs(v) > 1e-4 ? -Math.sign(v) * F_FRIC : 0;
    return (-K_LIN * z + fr) / M_EFF;
  };
  const ampOf = (v0) => v0 / OMEGA_N;        // 一次推出能滚多远（理论幅度）
  const dAmpPerHalf = () => 2 * F_FRIC / K_LIN;   // 每半次折返内缩多少
  const stopAmp = () => F_FRIC / K_LIN;           // 静摩擦能把罐子按住的幅度

  /* ==========================================================================
     二、状态
     ========================================================================== */
  const state = {
    t: 0, z: 0, v: 0, phi: 0,
    e0: 0, eLoss: 0, lastSign: 0,
    v0: V0_DEF, speed: 1,
    running: false, finished: false, paused: false, pushed: false,
    smooth: false, skin: 'solid', step6Done: false,
    turns: [], series: [], sampleAcc: 0,
    arrow: true, ruler: true, trail: true, band: true, weight: true,
    fsLayouts: 0
  };

  /* ==========================================================================
     三、小工具
     ========================================================================== */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smoothstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const wrapPi = (x) => {
    let y = (x + Math.PI) % (2 * Math.PI);
    if (y < 0) y += 2 * Math.PI;
    return y - Math.PI;
  };
  const newCanvas = (w, h) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  };
  const roundRect = (g, x, y, w, h, r) => {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  };
  const fmt2 = (x) => (isFinite(x) ? x.toFixed(2) : '—');

  /* DOM 写入一律带缓存 —— 每帧无脑写 textContent / innerHTML 会把主线程拖住 */
  const _txt = new Map();
  function setText(el, s) {
    if (!el) return;
    const k = el.id || el;
    if (_txt.get(k) === s) return;
    _txt.set(k, s);
    el.textContent = s;
  }
  const _html = new Map();
  function setHTML(el, s) {
    if (!el) return;
    const k = el.id || el;
    if (_html.get(k) === s) return;
    _html.set(k, s);
    el.innerHTML = s;
  }
  const _cls = new Map();
  function setClass(el, name, on) {
    if (!el) return;
    const k = (el.id || el) + '|' + name;
    if (_cls.get(k) === on) return;
    _cls.set(k, on);
    el.classList.toggle(name, on);
  }
  const _wid = new Map();
  function setWidth(el, w) {
    if (!el) return;
    const k = el.id || el;
    if (_wid.get(k) === w) return;
    _wid.set(k, w);
    el.style.width = w;
  }
  function formatMMSS(sec) {
    const s = Math.max(0, Math.floor(sec + 1e-9));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  /* ==========================================================================
     四、场景常量（场景单位 = cm）
     ========================================================================== */
  const AXIS_Y = R * U + 0.10;       // 罐子轴线离地高度 = 4.1
  const HOLE_X = (L / 2) * U;        // 罐底 / 盖子所在 |x| = 6
  const HOLE_R = HOLE_D * U;         // 小孔离轴线 2.2
  const HANG_R_S = HANG_R * U;       // 钩码挂钩离轴线 1.8
  const BAND_R = 0.17;               // 橡皮筋半径
  const PLATE_T = 0.24;              // 盖子 / 罐底厚度
  /* ★ 盖子 / 罐底比罐身略大一圈（像真罐子的卷边）⇒ 罐子是【坐在卷边上】的，
     轴线因此比罐半径高 0.10。把 AXIS_Y 写成 R·U 的话，罐底会陷进地面 1 mm
     ——「罐子不穿地」那条断言就是守着这个的。 */
  const RIM_R = R * U + 0.10;        // 盖子外沿
  const HOLE_A = [Math.PI / 2, -Math.PI / 2];   // 两孔在盘面内的初始角
  const W_A = Math.PI;                          // 钩码（最低点）在盘面内的角
  const RULER_HALF = 45;             // 刻度尺从 -45 cm 到 +45 cm

  /* ==========================================================================
     五、渲染器 / 场景 / 光照
     ========================================================================== */
  const canvas = $('sceneCanvas');
  const stage = $('stage');

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  } catch (_) {
    const n = document.createElement('div');
    n.className = 'no-webgl';
    n.textContent = '当前浏览器无法启动三维渲染。请开启硬件加速，或使用新版 Chrome / Edge / Safari 后重试。';
    if (stage) stage.appendChild(n);
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  /* 剖视靠局部裁剪面：切面永远对着相机，转视角时也跟着转 */
  renderer.localClippingEnabled = true;
  const MAX_ANISO = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#26313d');
  scene.fog = new THREE.Fog('#26313d', 150, 420);

  const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 900);

  function studioEnv() {
    const W = 1024, H = 512;
    const c = newCanvas(W, H), g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.44, '#e6ebf1');
    grad.addColorStop(0.5, '#a8b2bc');
    grad.addColorStop(1, '#2f343b');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    const box = (x, y, w, h, r, fill) => { g.fillStyle = fill; roundRect(g, x, y, w, h, r); g.fill(); };
    box(96, 30, 320, 176, 26, 'rgba(255,255,255,0.98)');
    box(672, 70, 236, 144, 22, 'rgba(214,232,255,0.62)');
    box(350, 300, 420, 100, 30, 'rgba(255,226,182,0.34)');
    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromEquirectangular(tex).texture;
    pmrem.dispose(); tex.dispose();
    return env;
  }
  scene.environment = studioEnv();

  scene.add(new THREE.HemisphereLight('#eaf2fa', '#4a4238', 0.50));
  scene.add(new THREE.AmbientLight('#ffffff', 0.10));

  const key = new THREE.DirectionalLight('#fff2dd', 1.95);
  key.position.set(-46, 78, 52);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -70; key.shadow.camera.right = 70;
  key.shadow.camera.top = 70; key.shadow.camera.bottom = -70;
  key.shadow.camera.near = 20; key.shadow.camera.far = 260;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.03;
  scene.add(key);
  scene.add(key.target);
  key.target.position.set(0, 4, 0);

  const fill = new THREE.DirectionalLight('#dce9f8', 0.55);
  fill.position.set(56, 40, 34);
  scene.add(fill);
  const rim = new THREE.DirectionalLight('#cfe2ff', 0.42);
  rim.position.set(8, 34, -62);
  scene.add(rim);

  /* ---- 地面 ---- */
  function makeFloorMap() {
    const W = 1024, H = 1024;
    const c = newCanvas(W, H), g = c.getContext('2d');
    g.fillStyle = '#9aa1a9'; g.fillRect(0, 0, W, H);
    let a = 20261015;
    const rnd = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    for (let i = 0; i < 24000; i++) {
      const x = rnd() * W, y = rnd() * H, r = 0.6 + rnd() * 2.4;
      g.fillStyle = rnd() > 0.5 ? `rgba(255,255,255,${(0.03 + rnd() * 0.06).toFixed(3)})` : `rgba(40,46,54,${(0.03 + rnd() * 0.07).toFixed(3)})`;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    g.strokeStyle = 'rgba(48,56,66,0.20)'; g.lineWidth = 2;
    for (let i = 0; i <= 20; i++) {
      const p = i * (W / 20);
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, H); g.stroke();
      g.beginPath(); g.moveTo(0, p); g.lineTo(W, p); g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 2);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const floorMap = makeFloorMap();
  floorMap.anisotropy = MAX_ANISO;
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(300, 4, 300),
    new THREE.MeshStandardMaterial({ map: floorMap, bumpMap: floorMap, bumpScale: 0.03, roughness: 0.93, metalness: 0.0, envMapIntensity: 0.55 })
  );
  floor.position.set(0, -2, 0);
  floor.receiveShadow = true;
  scene.add(floor);

  function makeBackdropMap() {
    const W = 1024, H = 512;
    const c = newCanvas(W, H), g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#33465c');
    grad.addColorStop(0.55, '#22303e');
    grad.addColorStop(1, '#151d26');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    const glow = g.createRadialGradient(W * 0.36, H * 0.30, 20, W * 0.36, H * 0.30, W * 0.52);
    glow.addColorStop(0, 'rgba(150,190,235,0.28)');
    glow.addColorStop(1, 'rgba(150,190,235,0)');
    g.fillStyle = glow; g.fillRect(0, 0, W, H);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(520, 260),
    new THREE.MeshBasicMaterial({ map: makeBackdropMap(), fog: false })
  );
  backdrop.position.set(0, 120, -140);
  scene.add(backdrop);

  /* ---- 地面刻度尺：0 刻度对准罐子的出发点 ---- */
  function makeRulerMap() {
    const W = 4096, H = 128;
    const c = newCanvas(W, H), g = c.getContext('2d');
    g.fillStyle = '#f3f0e6'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#d9d3c2'; g.fillRect(0, H - 14, W, 14);
    const pxPerCm = W / (2 * RULER_HALF);
    for (let cm = -RULER_HALF; cm <= RULER_HALF; cm++) {
      const x = (cm + RULER_HALF) * pxPerCm;
      const major = cm % 10 === 0, mid = cm % 5 === 0;
      const h = major ? 54 : mid ? 36 : 22;
      g.strokeStyle = major ? '#20242b' : '#4a5058';
      g.lineWidth = major ? 5 : 3;
      g.beginPath(); g.moveTo(x, 4); g.lineTo(x, 4 + h); g.stroke();
      if (major) {
        /* ★ 数字要转一个角度才「看着是正的」：尺子平躺在地面上，贴图的 v 轴映射到世界 x
           ⇒ 不转的话数字的「上」指向画面右边，默认侧视下整排数字是躺倒的。
           转 −0.72 rad 是照着【默认侧视】的屏幕朝上方向标定的（其它视角只能将就）。 */
        g.save();
        g.translate(x, 80);
        g.rotate(-0.72);
        g.fillStyle = '#20242b';
        g.font = 'bold 34px Inter, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(String(Math.abs(cm)), 0, 0);
        g.restore();
      }
    }
    g.fillStyle = '#c2410c';
    g.fillRect(W / 2 - 4, 0, 8, H);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = MAX_ANISO;
    return tex;
  }
  const rulerGrp = new THREE.Group();
  {
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(2 * RULER_HALF, 4.2),
      new THREE.MeshStandardMaterial({ map: makeRulerMap(), roughness: 0.75, metalness: 0.0, envMapIntensity: 0.5 })
    );
    face.rotation.x = -Math.PI / 2;
    face.receiveShadow = true;
    rulerGrp.add(face);
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(2 * RULER_HALF, 0.5, 4.2),
      new THREE.MeshStandardMaterial({ color: '#cfc9b8', roughness: 0.8, metalness: 0.0 })
    );
    body.position.y = -0.27;
    rulerGrp.add(body);
    /* 尺子紧贴罐子滚过的那条线 —— 读数就是「滚了多远」，不用另外换算 */
    rulerGrp.position.set(-(R * U) - 2.7, 0.02, 0);
    rulerGrp.rotation.y = -Math.PI / 2;
    scene.add(rulerGrp);
  }

  /* ==========================================================================
     六、器材
     ========================================================================== */
  const metalMap = (() => {
    const W = 512, H = 512;
    const c = newCanvas(W, H), g = c.getContext('2d');
    g.fillStyle = '#cfd4da'; g.fillRect(0, 0, W, H);
    let a = 7;
    const rnd = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(70,78,88,0.05)';
      g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2, 1 + rnd() * 2);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  })();
  metalMap.anisotropy = MAX_ANISO;

  const shellSolid = new THREE.MeshStandardMaterial({
    map: metalMap, bumpMap: metalMap, bumpScale: 0.02,
    color: '#cdd3da', roughness: 0.34, metalness: 0.88, envMapIntensity: 1.35,
    side: THREE.DoubleSide
  });
  /* 半透明档：罐壁薄、里面还有一层罐壁，不透明度压到 0.26 才看得进内部 */
  const shellGlass = new THREE.MeshPhysicalMaterial({
    color: '#dfe9f2', transparent: true, opacity: 0.26, roughness: 0.10, metalness: 0.30,
    clearcoat: 1.0, clearcoatRoughness: 0.05, envMapIntensity: 1.8,
    side: THREE.DoubleSide, depthWrite: false
  });
  const plateMat = new THREE.MeshStandardMaterial({
    map: metalMap, bumpMap: metalMap, bumpScale: 0.02,
    color: '#b9c0c8', roughness: 0.40, metalness: 0.86, envMapIntensity: 1.25,
    side: THREE.DoubleSide
  });
  const plateGlass = new THREE.MeshPhysicalMaterial({
    color: '#dfe9f2', transparent: true, opacity: 0.30, roughness: 0.12, metalness: 0.30,
    clearcoat: 1.0, side: THREE.DoubleSide, depthWrite: false
  });
  const holeMat = new THREE.MeshStandardMaterial({ color: '#14181d', roughness: 0.95, metalness: 0.1 });
  const rimMat = new THREE.MeshStandardMaterial({ color: '#eef2f6', roughness: 0.22, metalness: 1.0, envMapIntensity: 1.6 });
  const bandMat = new THREE.MeshStandardMaterial({ color: '#e0673a', roughness: 0.62, metalness: 0.02, envMapIntensity: 0.8 });
  const knotMat = new THREE.MeshStandardMaterial({ color: '#c2542c', roughness: 0.7, metalness: 0.02 });
  const weightMat = new THREE.MeshStandardMaterial({ color: '#98a1ab', roughness: 0.30, metalness: 0.95, envMapIntensity: 1.5 });
  const weightDark = new THREE.MeshStandardMaterial({ color: '#5c646e', roughness: 0.45, metalness: 0.85 });

  /* 裁剪面：法线由相机方向现算（updateClipPlane 里更新） */
  const clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const CLIP_MATS = [shellSolid, plateMat];

  /* canRoot 的原点就在【罐子的轴线】上：所有零件都按「相对轴线」摆位，
     罐子滚动 = 各零件绕自己的 x 轴转 φ —— 绕轴转不改变轴线位置，几何天然自洽。 */
  const canRoot = new THREE.Group();
  canRoot.position.set(0, AXIS_Y, 0);
  scene.add(canRoot);

  /* ---- 罐身 ---- */
  const bodyGrp = new THREE.Group();
  const bodyWall = new THREE.Mesh(new THREE.CylinderGeometry(R * U, R * U, L * U, 56, 1, true), shellSolid);
  bodyWall.rotation.z = Math.PI / 2;
  bodyWall.castShadow = true; bodyWall.receiveShadow = true;
  bodyWall.name = 'canWall';
  bodyGrp.add(bodyWall);
  for (const sx of [-1, 1]) {
    const bead = new THREE.Mesh(new THREE.TorusGeometry(R * U, 0.09, 8, 44), rimMat);
    bead.rotation.y = Math.PI / 2;
    bead.position.x = sx * (L * U / 2 - 0.05);
    bodyGrp.add(bead);
  }
  canRoot.add(bodyGrp);

  /* ---- 罐底 / 盖子：同一套做法（钢板 + 两个通孔 + 孔边亮圈 + 外侧绳结） ---- */
  function buildPlate(sign) {
    const grp = new THREE.Group();
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(RIM_R, RIM_R, PLATE_T, 48), plateMat);
    plate.rotation.z = Math.PI / 2;
    plate.position.x = sign * (HOLE_X + PLATE_T / 2);
    plate.castShadow = true; plate.receiveShadow = true;
    grp.add(plate);
    for (let i = 0; i < 2; i++) {
      const a = HOLE_A[i];
      const y = HOLE_R * Math.cos(a), z = HOLE_R * Math.sin(a);
      const bore = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, PLATE_T + 0.06, 16), holeMat);
      bore.rotation.z = Math.PI / 2;
      bore.position.set(sign * (HOLE_X + PLATE_T / 2), y, z);
      grp.add(bore);
      for (const s2 of [1, -1]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.235, 0.045, 6, 18), rimMat);
        ring.rotation.y = Math.PI / 2;
        ring.position.set(sign * (HOLE_X + PLATE_T / 2 + s2 * (PLATE_T / 2 + 0.02)), y, z);
        grp.add(ring);
      }
      const knot = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), knotMat);
      knot.position.set(sign * (HOLE_X + PLATE_T + 0.30), y, z);
      knot.castShadow = true;
      grp.add(knot);
    }
    return { grp, plate };
  }
  const bottomBuild = buildPlate(-1);
  const lidBuild = buildPlate(1);
  const bottomGrp = bottomBuild.grp;
  const lidGrp = lidBuild.grp;
  canRoot.add(bottomGrp);
  canRoot.add(lidGrp);

  /* ---- 钩码：圆柱 + 挂钩；局部原点 = 挂钩顶（= 橡皮筋汇聚点） ---- */
  const weightGrp = new THREE.Group();
  {
    const BODY_H = 1.10, BODY_R = 0.95;
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.30, 0.075, 8, 20), weightDark);
    hook.position.set(0, -0.30, 0);
    weightGrp.add(hook);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.28, 12), weightDark);
    stem.position.set(0, -0.72, 0);
    weightGrp.add(stem);
    const bodyY = -0.86 - BODY_H / 2;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(BODY_R, BODY_R, BODY_H, 28), weightMat);
    body.position.set(0, bodyY, 0);
    body.castShadow = true; body.receiveShadow = true;
    weightGrp.add(body);
    const groove = new THREE.Mesh(new THREE.TorusGeometry(BODY_R + 0.005, 0.055, 8, 28), weightDark);
    groove.rotation.x = Math.PI / 2;
    groove.position.set(0, bodyY, 0);
    weightGrp.add(groove);
  }
  canRoot.add(weightGrp);

  /* ---- 橡皮筋：两条、各两股；每股用一串小圆柱画出来 ---- */
  const STRAND_SEG = 12;
  const SEG_GEO = new THREE.CylinderGeometry(1, 1, 1, 8);
  const JOINT_GEO = new THREE.SphereGeometry(1, 8, 6);
  const STRANDS = [
    { band: 'A', sign: -1, hole: 0, segs: [], joints: [] },
    { band: 'A', sign: -1, hole: 1, segs: [], joints: [] },
    { band: 'B', sign: 1, hole: 0, segs: [], joints: [] },
    { band: 'B', sign: 1, hole: 1, segs: [], joints: [] }
  ];
  const bandAGrp = new THREE.Group();
  const bandBGrp = new THREE.Group();
  for (const st of STRANDS) {
    const host = st.band === 'A' ? bandAGrp : bandBGrp;
    for (let i = 0; i < STRAND_SEG; i++) {
      const m = new THREE.Mesh(SEG_GEO, bandMat);
      m.castShadow = true;
      host.add(m);
      st.segs.push(m);
    }
    for (let i = 1; i < STRAND_SEG; i++) {
      const m = new THREE.Mesh(JOINT_GEO, bandMat);
      host.add(m);
      st.joints.push(m);
    }
  }
  /* ★ 橡皮筋段挂在【场景】下、而不是 canRoot 下：
     两股的两个端点分属两个坐标系（孔在罐子的局部坐标系里转、钩码在世界坐标系里不动），
     只能按世界点现算 —— 所以它们的位姿由 updateStrands 直接写 mesh.position/quaternion，
     绝不走 poseNow（走了就会二次变换）。 */
  scene.add(bandAGrp);
  scene.add(bandBGrp);

  /* ==========================================================================
     七、橡皮筋几何（唯一真值：strandPoint）
     --------------------------------------------------------------------------
     每一股从【孔心】连到【钩码挂钩】，中间按参数 u 线性过渡：
       角度：从孔的当前角（a0 + φ）扫到钩码角 π（走最短路径）
       半径：从 HOLE_R 收到 HANG_R_S
       轴向：从 ±HOLE_X 收到 0
     φ 越大两股扭得越厉害 —— 这就是"橡皮筋被扭紧"的画面证据。
     ========================================================================== */
  function strandPoint(sign, a0, u, phi, out) {
    const aHole = a0 + phi;
    const aEnd = aHole + wrapPi(W_A - aHole);
    const a = aHole + (aEnd - aHole) * u;
    const r = HOLE_R + (HANG_R_S - HOLE_R) * u;
    /* ★ z 必须带上罐子自己的位移：橡皮筋段挂在场景下、按世界点现算，
       漏掉 state.z·U 就会「罐子滚走了、橡皮筋还留在原地」—— 从侧面看是几根
       橙色管子从罐子里支棱出来。 */
    return out.set(sign * HOLE_X * (1 - u), AXIS_Y + r * Math.cos(a), state.z * U + r * Math.sin(a));
  }
  function hookWorld(out) {
    return out.set(0, AXIS_Y - HANG_R_S, state.z * U);
  }

  /* ==========================================================================
     八、散放 / 六步组装
     ========================================================================== */
  /* ★ 这三个复用缓冲必须【在 buildScatter 之前】声明：restPart 现在要走
     placeParts()（和运行时同一条摆位路径）才能把钩码那一截偏移算进去，
     而 placeParts 会调 updateStrands —— 声明留在下面（第十五节）就是 TDZ：
     初始化时直接抛「Cannot access '_hkv' before initialization」，整页不启动。 */
  const _sp = new THREE.Vector3(), _hkv = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  const _tmpA = new THREE.Vector3(), _tmpB = new THREE.Vector3(), _tmpC = new THREE.Vector3();
  const _pts = Array.from({ length: STRAND_SEG + 1 }, () => new THREE.Vector3());

  const PART_BASE = new Map();
  const PART_POSE = new Map();
  const PART_T = new Map();
  const PART_MAT = new Map();
  const PART_RAW = new Set([bandAGrp, bandBGrp]);   // 位姿由 updateStrands 现算

  const ASM_PARTS = [
    { key: 'body', label: '罐身', objs: [bodyGrp] },
    { key: 'bottom', label: '罐底（两孔）', objs: [bottomGrp] },
    { key: 'bandA', label: '橡皮筋 A', objs: [bandAGrp], raw: true, pivot: [0, AXIS_Y, 0] },
    { key: 'weight', label: '钩码', objs: [weightGrp] },
    { key: 'bandB', label: '橡皮筋 B', objs: [bandBGrp], raw: true, pivot: [0, AXIS_Y, 0] },
    { key: 'lid', label: '盖子（两孔）', objs: [lidGrp] }
  ];
  const ASM_STEPS = [
    { key: 'can', parts: ['body', 'bottom'],
      name: '罐身 + 罐底开两个小孔',
      hint: '先把金属罐立起来，在罐底沿一条直径对称地钻两个小孔（相距约 4.4 cm）。孔别开太大，橡皮筋穿过去要能卡住。' },
    { key: 'bandA', parts: ['bandA'],
      name: '橡皮筋 A 穿过罐底两个小孔',
      hint: '橡皮筋从罐底的一个孔穿进去、从另一个孔穿出来，在罐底外侧打结固定 —— 罐内就是一根绷直的样子。' },
    { key: 'weight', parts: ['weight'],
      name: '钩码系在橡皮筋中部',
      hint: '用细线把钩码牢牢系在橡皮筋的正中间。钩码要够重，才能靠重力一直待在罐子最低处。' },
    { key: 'bandB', parts: ['bandB'],
      name: '橡皮筋 B 穿过盖子两个小孔',
      hint: '盖子上也开两个孔、位置和罐底那两个对齐；橡皮筋 B 穿过去，中部同样系在钩码的挂钩上。' },
    { key: 'lid', parts: ['lid'],
      name: '盖上盖子、外侧拉紧打结',
      hint: '合上盖子，橡皮筋 B 在盖子外侧拉紧后打结。两根橡皮筋都要绷直 —— 松了扭不起来，紧了罐子转不动。' },
    { key: 'done', parts: [],
      name: '完成 —— 滚一滚试一试',
      hint: '做好了。推它一把，看它滚出去、停下来，再自己滚回来。' }
  ];
  /* 散放位姿：水平位移 + 绕轴转角；dy 由「最低点落到地面」反算（橡皮筋用显式值）。
     六个落点摊在罐子两侧约 56×46 cm 的一片地面上 —— 够散开、又不会跑出取景。 */
  const ASM_POSE = {
    body: { dx: -15, dz: -17, ry: 0.42 },
    /* 罐底 / 盖子【平放】在地面上（rz = 90° 把盘面从「立着的轮子」放倒成「盘子」）——
       立着的话从侧视看就是一条线，两个小孔根本看不见，学生认不出这是哪一件。 */
    bottom: { dx: -20, dz: 9, ry: -0.30, rz: Math.PI / 2 },
    bandA: { dx: -4, dz: 17, ry: 0.55 },
    weight: { dx: 13, dz: 15, ry: -0.40 },
    bandB: { dx: 5, dz: -18, ry: -0.55 },
    lid: { dx: 20, dz: -6, ry: 0.36, rz: Math.PI / 2 }
  };

  function partOf(key) { return ASM_PARTS.find((p) => p.key === key); }
  function basePose(o) {
    let b = PART_BASE.get(o);
    if (!b) { b = { pos: o.position.clone(), rot: o.rotation.clone() }; PART_BASE.set(o, b); }
    return b;
  }
  const _v3 = new THREE.Vector3();
  const _m4 = new THREE.Matrix4();
  const _e1 = new THREE.Euler();

  function layoutPart(p, spec) {
    const piv = p.pivot ? new THREE.Vector3(p.pivot[0], p.pivot[1], p.pivot[2]) : basePose(p.objs[0]).pos.clone();
    _m4.makeRotationFromEuler(_e1.set(spec.rx || 0, spec.ry || 0, spec.rz || 0, 'XYZ'));
    for (const o of p.objs) {
      const b = basePose(o);
      _v3.copy(b.pos).sub(piv).applyMatrix4(_m4).add(piv).sub(b.pos);
      PART_POSE.set(o, {
        dx: spec.dx + _v3.x, dy: spec.dy || 0, dz: spec.dz + _v3.z,
        rx: spec.rx || 0, ry: spec.ry || 0, rz: spec.rz || 0
      });
    }
    /* 橡皮筋这类「按点现算」的零件：直接给一个散放矩阵 S（绕 pivot 转 + 平移） */
    const S = new THREE.Matrix4()
      .makeTranslation(spec.dx, spec.dy || 0, spec.dz)
      .multiply(new THREE.Matrix4().makeTranslation(piv.x, piv.y, piv.z))
      .multiply(new THREE.Matrix4().makeRotationFromEuler(_e1.set(spec.rx || 0, spec.ry || 0, spec.rz || 0, 'XYZ')))
      .multiply(new THREE.Matrix4().makeTranslation(-piv.x, -piv.y, -piv.z));
    PART_MAT.set(p.objs[0], S);
  }

  const _box = new THREE.Box3();
  function lowestY(objs) {
    let minY = Infinity;
    for (const root of objs) {
      /* ★ 必须 updateWorldMatrix(true, …)：零件挂在 canRoot 下，而 canRoot 自己
         带一个 y = AXIS_Y 的平移。只调 updateMatrixWorld(true) 的话用的是
         【父级的旧 matrixWorld】（初始化时还是单位阵）⇒ 量出来的最低点是 −4.09 而不是
         0.1 ⇒ 反算的抬升量多出整整一个罐半径，六件散件【整体悬在半空 4 cm】。 */
      root.updateWorldMatrix(true, true);
      root.traverse((o) => {
        if (!o.isMesh) return;
        _box.setFromObject(o, true);
        if (!_box.isEmpty() && _box.min.y < minY) minY = _box.min.y;
      });
    }
    return minY;
  }
  /* 把整件抬到「最低点正好落在地面上」—— dy 不手填：改了尺寸或转角也不会浮起来 / 插进地面。
     ★ 量之前必须走【与运行时同一条摆位路径】placeParts()：刚性零件里钩码在 placeParts
     里还要再叠一个 −HANG_R_S（它挂在轴线下方）。restPart 只调 poseNow 的话量到的
     是「没叠那一截」的高度 ⇒ 反算出来的抬升量少 1.8 ⇒ 钩码整件沉到地面以下。
     ★ 橡皮筋（raw）走不了 poseNow，但它的落点也能量：把散放矩阵的平移清零、按散放姿态
     摆好、量最低点，再反算抬升量 —— 手填 dy 的话几何一改就又不贴地了。 */
  function restPart(p) {
    const spec = ASM_POSE[p.key];
    if (p.raw) {
      spec.dy = 0;
      layoutPart(p, spec);
      for (const o of p.objs) PART_T.set(o, 1);
      placeParts();
      const rest = -lowestY(p.objs);
      spec.dy = rest;
      layoutPart(p, spec);
      for (const o of p.objs) PART_T.set(o, 0);
      placeParts();
      return rest;
    }
    for (const o of p.objs) PART_T.set(o, 1);
    placeParts();
    const rest = -lowestY(p.objs) - (spec.dy || 0);
    spec.dy = rest;
    layoutPart(p, spec);
    for (const o of p.objs) PART_T.set(o, 0);
    placeParts();
    return rest;
  }
  /* 唯一写器材位姿的入口（橡皮筋除外，见 PART_RAW） */
  function poseNow(o) {
    if (PART_RAW.has(o)) return;
    const b = basePose(o), p = PART_POSE.get(o), t = p ? (PART_T.get(o) || 0) : 0;
    o.position.set(
      b.pos.x + (p ? p.dx * t : 0),
      b.pos.y + (p ? p.dy * t : 0),
      b.pos.z + (p ? p.dz * t : 0)
    );
    if (p) o.rotation.set(b.rot.x + p.rx * t, b.rot.y + p.ry * t, b.rot.z + p.rz * t);
    else o.rotation.copy(b.rot);
  }
  (function buildScatter() {
    for (const p of ASM_PARTS) {
      for (const o of p.objs) basePose(o);
      layoutPart(p, ASM_POSE[p.key]);
      restPart(p);
    }
  })();

  function partProgress(key) {
    const p = partOf(key);
    return p ? (PART_T.get(p.objs[0]) || 0) : 0;
  }
  function setPartT(key, t) {
    const p = partOf(key);
    if (!p) return;
    for (const o of p.objs) { PART_T.set(o, t); poseNow(o); }
    placeParts();
  }
  function stepDone(s) { return s.parts.length === 0 ? !!state.step6Done : s.parts.every((k) => partProgress(k) < 1e-6); }
  function assembledCount() {
    let n = 0;
    for (const s of ASM_STEPS) { if (stepDone(s)) n++; else break; }
    return n;
  }
  function assemblyReady() { return assembledCount() >= ASM_STEPS.length; }

  const ASM_DUR = 0.7;
  let asmTween = null, asmQueue = [], asmNote = '', asmNoteBad = false;
  function asmSay(text, bad) { asmNote = text || ''; asmNoteBad = !!bad; }
  function ensureIdle() { if (state.pushed) resetSim(); }

  function assembleStep(i, force) {
    if (asmTween) { asmSay('正在装…等这一步动完', true); return false; }
    const done = assembledCount();
    if (i < done) { asmSay('这一步已经装好了', false); return false; }
    if (i > done && !force) {
      asmSay('顺序不对：魔罐要按 ①→⑥ 一步一步做 —— 先完成「' + ASM_STEPS[done].name + '」', true);
      return false;
    }
    const st = ASM_STEPS[i];
    if (!st) return false;
    ensureIdle();
    /* ⑥「完成」没有零件要飞进来，但它仍然是一步 —— 必须自己点一下才算做完。
       写成「空 parts 直接算 done」的话，⑤ 一装完清单就自己跳到 6/6，
       学生会以为少点了一步。 */
    if (!st.parts.length) { state.step6Done = true; asmSay('做好了！推它一把试试', false); return true; }
    asmSay('正在装：' + st.name, false);
    asmTween = { parts: st.parts.slice(), from: 1, to: 0, k: 0, step: i };
    return true;
  }
  function nextAutoStep() {
    while (asmQueue.length) {
      const i = asmQueue.shift();
      const st = ASM_STEPS[i];
      if (!st.parts.length) { state.step6Done = true; continue; }
      asmTween = { parts: st.parts.slice(), from: 1, to: 0, k: 0, step: i };
      asmSay('一键组装中：' + st.name, false);
      return;
    }
    asmSay('做好了！推它一把试试', false);
  }
  function autoAssemble() {
    const done = assembledCount();
    if (done >= ASM_STEPS.length) { asmSay('已经做好了', false); return false; }
    ensureIdle();
    asmQueue = [];
    for (let i = done; i < ASM_STEPS.length; i++) asmQueue.push(i);
    if (!asmTween) nextAutoStep();
    return true;
  }
  function advanceAsm(dt) {
    if (!asmTween) return;
    asmTween.k = Math.min(1, asmTween.k + dt / ASM_DUR);
    const e = 1 - Math.pow(1 - asmTween.k, 3);
    const t = asmTween.from + (asmTween.to - asmTween.from) * e;
    for (const k of asmTween.parts) setPartT(k, t);
    if (asmTween.k >= 1) {
      for (const k of asmTween.parts) setPartT(k, asmTween.to);
      asmTween = null;
      if (asmQueue.length) nextAutoStep(); else afterAsmChange();
    }
  }
  function scatterAll() {
    if (assembledCount() === 0 && !asmTween) { asmSay('已经是拆开的样子了', false); return false; }
    asmTween = null; asmQueue = [];
    state.step6Done = false;
    resetSim();
    for (const p of ASM_PARTS) setPartT(p.key, 1);
    asmSay('已拆开：六件零件摊在地面上，按 ①→⑥ 重新装一遍', false);
    afterAsmChange();
    return true;
  }
  function finishAll() {
    asmTween = null; asmQueue = [];
    state.step6Done = true;
    for (const p of ASM_PARTS) setPartT(p.key, 0);
    asmSay('六步都做好了', false);
    afterAsmChange();
    return true;
  }
  function afterAsmChange() {
    updateAsmUI();
    if (assemblyReady() && currentView === 'parts') applyView('side', true);
    updateScene();
    requestRender();
  }

  function updateAsmUI() {
    const done = assembledCount(), total = ASM_STEPS.length;
    const list = $('asmList');
    if (list) {
      list.querySelectorAll('[data-asm]').forEach((li, i) => {
        li.classList.toggle('done', i < done);
        li.classList.toggle('next', i === done);
        li.classList.toggle('busy', !!asmTween && asmTween.step === i);
        li.setAttribute('aria-disabled', i === done ? 'false' : 'true');
      });
    }
    setWidth($('asmBar'), (done / total * 100).toFixed(1) + '%');
    setText($('asmCount'), done + ' / ' + total);
    const hint = $('asmHint');
    if (hint) {
      const next = ASM_STEPS[done];
      const s = asmNote || (next ? `下一步：${next.name} —— ${next.hint}`
        : '六步都做好了。关键就是：两根橡皮筋绷在罐子两端、中部系着同一个钩码 —— 罐子一转，橡皮筋就被扭紧。');
      if (hint.textContent !== s) hint.textContent = s;
      hint.classList.toggle('bad', asmNoteBad);
    }
    const auto = $('asmAuto');
    if (auto) {
      auto.disabled = done >= total || !!asmTween;
      const s = done >= total ? '✓ 已做好' : (done > 0 ? '⚡ 一键装完剩下的' : '⚡ 一键自动组装');
      if (auto.textContent !== s) auto.textContent = s;
    }
    const scat = $('asmScatter');
    if (scat) scat.disabled = done === 0 && !asmTween;
    const gate = $('runGate');
    if (gate) gate.hidden = assemblyReady();
    const canRun = assemblyReady() && !state.running;
    const run = $('runBtn');
    if (run) run.disabled = !canRun;
    const runS = $('stagePush');
    if (runS) {
      runS.disabled = !canRun;
      const s = state.pushed ? '▶ 再推一把' : '▶ 推它一把';
      if (runS.textContent !== s) runS.textContent = s;
    }
    const p1 = $('pauseBtn'), p2 = $('stagePause');
    if (p1) { p1.disabled = !state.running; const s = state.paused ? '继续' : '暂停'; if (p1.textContent !== s) p1.textContent = s; }
    if (p2) { p2.disabled = !state.running; const s = state.paused ? '继续' : '暂停'; if (p2.textContent !== s) p2.textContent = s; }
  }

  /* ==========================================================================
     九、能量账（唯一口径）
     --------------------------------------------------------------------------
     三条能量条之和恒等于初始机械能：先把 ek、ee 夹到 [0, e0]，第三段 el 由
     e0 − ek − ee 反推 —— 保证三项都非负、且和恰好是 100%。
     ========================================================================== */
  function energyNow() {
    const e0 = Math.max(1e-9, state.e0);
    const ek = Math.min(ekOf(state.v), e0);
    const ee = Math.min(eeOf(state.z), Math.max(0, e0 - ek));
    const el = Math.max(0, e0 - ek - ee);
    return { e0, ek, ee, el, theta: thetaOf(state.z), amp: Math.abs(state.z) };
  }

  /* ==========================================================================
     十、物理推进
     ========================================================================== */
  function resetSim() {
    state.t = 0; state.z = 0; state.v = 0; state.phi = 0;
    state.e0 = 0; state.eLoss = 0; state.lastSign = 0;
    state.running = false; state.finished = false; state.paused = false;
    state.pushed = false; state.sampleAcc = 0;
    state.series = [];
    trailMarks.length = 0;
    rebuildTrail();
    placeParts();
    syncAll();
  }
  function push() {
    if (!assemblyReady()) return false;
    state.t = 0; state.z = 0; state.v = state.v0; state.phi = 0;
    state.e0 = ekOf(state.v0); state.eLoss = 0;
    state.lastSign = state.v0 > 0 ? 1 : -1;
    state.running = true; state.finished = false; state.paused = false; state.pushed = true;
    state.sampleAcc = 0;
    state.series = [];
    trailMarks.length = 0;
    rebuildTrail();
    placeParts();
    updateAsmUI();
    syncAll();
    drawChart();
    return true;
  }
  function setPaused(on) {
    state.paused = !!on;
    state.running = !on && state.pushed && !state.finished;
    updateAsmUI();
    syncAll();
  }

  function stepSim(dt) {
    if (state.finished || !state.pushed) return;
    if (state.smooth) {
      /* 光滑地面：没有摩擦 ⇒ 罐子【一点也不转】，橡皮筋不会被扭紧，只能匀速滑下去 */
      state.v = state.v0;
      state.phi = 0;
      state.z += state.v * dt;
      state.t += dt;
      if (state.z >= Z_LIMIT) { state.z = Z_LIMIT; state.finished = true; state.running = false; }
      return;
    }
    const vPrev = state.v;
    state.v += accelOf(state.z, state.v) * dt;
    state.z += state.v * dt;
    state.phi = thetaOf(state.z);
    state.t += dt;
    /* 折返点：速度换向的那一刻，位置正好是最远处。
       ★ 判据不能写成「|vPrev| > 阈值 且 符号变了」—— 换向那一帧 vPrev 恰好落在
         阈值以内（实测 0.008 < 0.02），那条折返就永远抓不到。改成【记住上一次
         超过阈值的符号】：死区里的采样不动 lastSign，出了死区一比就抓到。 */
    if (Math.abs(state.v) > TURN_V_TH) {
      const sgn = state.v > 0 ? 1 : -1;
      if (state.lastSign !== 0 && sgn !== state.lastSign) onTurnAround();
      state.lastSign = sgn;
    }
    if (state.z > Z_LIMIT) { state.z = Z_LIMIT; state.v = 0; state.finished = true; state.running = false; }
    /* 静摩擦按住了：弹性回复力已经推不动它 */
    if (Math.abs(state.v) < 5e-3 && Math.abs(K_LIN * state.z) <= F_FRIC) {
      state.v = 0;
      state.finished = true; state.running = false;
    }
  }
  let turnIndex = 0;
  function onTurnAround() {
    turnIndex++;
    state.turns.push({
      n: turnIndex, t: state.t, z: state.z, theta: thetaOf(state.z),
      ee: eeOf(state.z), dir: state.z > 0 ? 1 : -1
    });
    if (state.turns.length > 60) state.turns.shift();
    trailMarks.push({ z: state.z });
    rebuildTrail();
    renderRecords();
    drawChart();
  }
  function recordTurn() {
    if (!state.pushed) return false;
    const last = state.turns[state.turns.length - 1];
    if (last && Math.abs(last.t - state.t) < 0.05) return false;
    turnIndex++;
    state.turns.push({
      n: turnIndex, t: state.t, z: state.z, theta: thetaOf(state.z),
      ee: eeOf(state.z), dir: state.z > 0 ? 1 : -1, manual: true
    });
    trailMarks.push({ z: state.z });
    rebuildTrail();
    renderRecords();
    drawChart();
    return true;
  }

  /* ==========================================================================
     十一、轨迹与箭头
     ========================================================================== */
  const trailGrp = new THREE.Group();
  scene.add(trailGrp);
  const trailMarks = [];
  const trailLine = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.06, 1),
    new THREE.MeshBasicMaterial({ color: '#38bdf8', transparent: true, opacity: 0.85 })
  );
  trailLine.position.y = 0.06;
  trailGrp.add(trailLine);
  function rebuildTrail() {
    const zc = state.z * U;
    const len = Math.abs(zc);
    trailLine.visible = state.trail && len > 0.05;
    if (trailLine.visible) {
      trailLine.scale.z = len;
      trailLine.position.z = zc / 2;
    }
    while (trailGrp.children.length - 1 < trailMarks.length) {
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.22, 2.6, 10),
        new THREE.MeshBasicMaterial({ color: '#facc15' })
      );
      m.position.y = 1.3;
      trailGrp.add(m);
    }
    for (let i = 0; i < trailGrp.children.length - 1; i++) {
      const m = trailGrp.children[i + 1];
      const mk = trailMarks[i];
      m.visible = !!mk;
      if (mk) m.position.set(0, 1.3, mk.z * U);
    }
  }

  const arrowGrp = new THREE.Group();
  scene.add(arrowGrp);
  const vArrow = new THREE.Group();
  {
    const mat = new THREE.MeshBasicMaterial({ color: '#22c55e' });
    /* ★ 箭头必须沿【滚动方向 z】—— 罐子横躺、轴线沿 x，
       把箭头画成沿 x 的话它在屏幕上正好横着指向侧面，看着「指哪不打哪」。
       （圆柱/圆锥默认轴是 y，绕 x 转 90° 才落到 z 上。） */
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 8, 10), mat);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = 4;
    vArrow.add(shaft);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.62, 1.5, 14), mat);
    head.rotation.x = Math.PI / 2;
    head.position.z = 8.6;
    vArrow.add(head);
    arrowGrp.add(vArrow);
  }
  const rArrow = new THREE.Group();
  {
    const mat = new THREE.MeshBasicMaterial({ color: '#f59e0b' });
    const arc = new THREE.Mesh(new THREE.TorusGeometry(R * U * 0.62, 0.17, 8, 32, Math.PI * 0.9), mat);
    arc.rotation.y = Math.PI / 2;
    rArrow.add(arc);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.52, 1.25, 12), mat);
    const hr = R * U * 0.62;
    head.position.set(0, hr * Math.sin(Math.PI * 0.9), hr * Math.cos(Math.PI * 0.9));
    head.rotation.set(0, 0, -Math.PI / 2);
    rArrow.add(head);
    arrowGrp.add(rArrow);
  }

  /* ==========================================================================
     十二、相机与视角
     ========================================================================== */
  const VIEWS = {
    /* 侧视 dist 取 70（不是 50）：最大初速度 1.6 m/s 时第一次折返能滚到 31 cm，
       画框横向要装得下 ±34 cm 才不会被裁 —— 实测 dist=50 时 30 cm 处罐子已经出框。 */
    side:  { yaw: -0.85, pitch: 0.19, dist: 70, ty: 4.4 },
    axis:  { yaw: 1.44, pitch: 0.13, dist: 34, ty: 4.2 },
    top:   { yaw: -0.62, pitch: 0.86, dist: 62, ty: 2 },
    close: { yaw: -0.55, pitch: 0.11, dist: 26, ty: 4.2 },
    parts: { yaw: -0.66, pitch: 0.72, dist: 150, ty: 0 }
  };
  const view = { ...VIEWS.side };
  let currentView = 'side';

  function updateCamera() {
    /* 注视点：默认 (0, ty, 0)；零件台取景会额外给出 tx / tz 把散件挪到画框正中 */
    const t = new THREE.Vector3(view.tx || 0, view.ty, view.tz || 0);
    const cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
    camera.position.set(
      t.x + view.dist * cp * Math.sin(view.yaw),
      t.y + view.dist * sp,
      t.z + view.dist * cp * Math.cos(view.yaw)
    );
    camera.lookAt(t);
    /* ★ 必须立刻刷世界矩阵：screenRectOf 走的是 matrixWorldInverse，
       three.js 只在 renderer.render() 里更新它 —— 少了这句，「设完视角马上量」量到的是上一帧相机 */
    camera.updateMatrixWorld(true);
    updateClipPlane();
    requestRender();
  }
  /* 剖视：切面永远对着相机 —— 切面法线取【相机方向里垂直于罐轴的那一分量】。
     ★ 方向别凭直觉写：three.js 的裁剪着色器里 `vClipPosition = -mvPosition.xyz`，
     丢弃条件是 `dot(vClipPosition, n) > w` ⇒ 实际【保留】的是法线指向的那一侧。
     所以要让「朝向相机的那半边被切掉」，法线必须取【背离相机】的方向（下面 negate 的那一步）。
     写反的症状：罐子看上去还是一整个实心筒，只是外表面换成内表面 —— 内部零件全被挡住。 */
  function updateClipPlane() {
    const cx = state.z * U;
    const dy = camera.position.y - AXIS_Y;
    const dz = camera.position.z - cx;
    const away = new THREE.Vector3(0, -dy, -dz);
    if (away.lengthSq() < 1e-6) away.set(0, 0, -1);
    away.normalize();
    clipPlane.normal.copy(away);
    clipPlane.constant = -(away.y * AXIS_Y + away.z * cx);   // 切面必须过罐轴
    const on = state.skin === 'cut';
    for (const m of CLIP_MATS) m.clippingPlanes = on ? [clipPlane] : null;
  }
  function applyView(name, silent) {
    const v = VIEWS[name];
    if (!v) return false;
    currentView = name;
    Object.assign(view, v);
    view.tx = v.tx || 0;                       // 零件台取景会写这三个，切视角必须清掉
    view.tz = v.tz || 0;
    document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    /* 「沿轴看内部」时罐底钢板正对着你，实体挡得严严实实 ⇒ 自动切到半透明 */
    if (name === 'axis' && state.skin === 'solid') setSkin('glass');
    if (name === 'parts') fitPartsView();
    updateCamera();
    if (!silent) updateScene();
    return true;
  }

  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    requestRender();
  }
  const relayout = () => {
    resize();
    if (currentView === 'parts') fitPartsView();
    drawChart();
    requestRender();
    if (fsPending) fsSecond();             // 全屏切过 ⇒ 舞台尺寸一变就补第二次 layout
  };
  window.addEventListener('resize', relayout);
  if (window.ResizeObserver) new ResizeObserver(relayout).observe(stage);

  let dragging = false, lastX = 0, lastY = 0;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = (e.clientX - lastX) / Math.max(canvas.clientWidth, 1);
    const dy = (e.clientY - lastY) / Math.max(canvas.clientHeight, 1);
    lastX = e.clientX; lastY = e.clientY;
    view.yaw -= dx * 2.9;
    view.pitch = clamp(view.pitch + dy * 2.2, -0.05, 1.36);
    updateCamera();
  });
  const endDrag = (e) => {
    dragging = false;
    canvas.style.cursor = 'grab';
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    view.dist = clamp(view.dist * (1 + Math.sign(e.deltaY) * 0.08), 18, 200);
    updateCamera();
  }, { passive: false });

  /* ==========================================================================
     十三、取景（零件台）
     --------------------------------------------------------------------------
     ★ 必须【逐 mesh】取 AABB 再各自投影 8 角取并集：整件丢进 Box3.expandByObject
       会先在【世界空间】合成 AABB，转过 90° 的细长件角点被甩出去 ⇒ 并集虚大、
       反推距离虚大、散件被推小。取景两条腿：① 不出框 ② 不过远。
     ========================================================================== */
  function partsRect(log) {
    updateStrands();
    const gl = renderer.getContext();
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const v = new THREE.Vector3();
    for (const p of ASM_PARTS) {
      for (const root of p.objs) {
        root.updateWorldMatrix(true, true);
        root.traverse((o) => {
          if (!o.isMesh || !o.visible) return;
          _box.setFromObject(o, true);
          if (_box.isEmpty()) return;
          let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
          for (let i = 0; i < 8; i++) {
            v.set(i & 1 ? _box.max.x : _box.min.x, i & 2 ? _box.max.y : _box.min.y, i & 4 ? _box.max.z : _box.min.z);
            v.project(camera);
            const sx = (v.x * 0.5 + 0.5) * W, sy = (v.y * 0.5 + 0.5) * H;
            if (sx < a) a = sx; if (sx > c) c = sx;
            if (sy < b) b = sy; if (sy > d) d = sy;
          }
          if (log) log.push([p.key, o.name || o.type, Math.round(a), Math.round(b), Math.round(c), Math.round(d)]);
          if (a < x0) x0 = a; if (c > x1) x1 = c;
          if (b < y0) y0 = b; if (d > y1) y1 = d;
        });
      }
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, W, H };
  }
  function fitPartsView() {
    const saved = ASM_PARTS.map((p) => partProgress(p.key));
    Object.assign(view, VIEWS.parts);
    view.tx = 0; view.tz = 0;
    for (const p of ASM_PARTS) { for (const o of p.objs) { PART_T.set(o, 1); } }
    placeParts();
    updateCamera();
    const gl = renderer.getContext();
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    if (W >= 400 && H >= 300) {
      const m = Math.max(8, Math.round(Math.min(W, H) * 0.05));
      /* 取景两件事：① 把并集缩放成「画框 − 2m」（屏幕尺寸 ∝ 1/dist）；
         ② 把并集【挪到画框正中】—— 只缩不放不对中，散件整体偏到一边照样会顶出边距。
         ② 靠改注视点实现：注视点沿屏幕右方向平移 −Δ 世界单位 ⇒ 内容在屏幕上右移 Δ 像素。
         收敛靠迭代（透视下「平移像素 ↔ 世界平移」只是近似线性）。 */
      const visH0 = () => 2 * view.dist * Math.tan(camera.fov * Math.PI / 360);
      for (let i = 0; i < 6; i++) {
        updateCamera();
        const r = partsRect();
        if (!(r.w > 1) || !(r.h > 1)) break;
        const cx = r.x + r.w / 2 - W / 2, cy = r.y + r.h / 2 - H / 2;
        const visH = visH0(), visW = visH * camera.aspect;
        const sr = { x: Math.cos(view.yaw), z: -Math.sin(view.yaw) };
        /* 注视点沿 sr 平移 Δ ⇒ 相机跟着转 ⇒ 内容在屏幕上【反向】移 Δ。所以要把内容
           从 cx 挪回 0，注视点得往 +sr 方向移 cx（像素）折算出来的世界量。
           符号写反就是正反馈：散件会被一路推到画外（实测 x ≈ −3000）。 */
        const wdx = (cx / W) * visW;
        view.tx += sr.x * wdx;
        view.tz += sr.z * wdx;
        view.ty += (cy / H) * visH;
        const k = Math.min((W - 2 * m) / r.w, (H - 2 * m) / r.h);
        if (!isFinite(k) || k <= 0) break;
        const s = 1 / k;
        if (Math.abs(s - 1) < 0.004 && Math.abs(cx) < 3 && Math.abs(cy) < 3) break;
        view.dist = clamp(view.dist * s, 60, 420);
      }
      updateCamera();
    }
    ASM_PARTS.forEach((p, i) => {
      for (const o of p.objs) { PART_T.set(o, saved[i]); poseNow(o); }
    });
    placeParts();
    updateCamera();
    return { ...view };
  }

  /* ==========================================================================
     十四、屏幕包围盒 / 探针几何
     ========================================================================== */
  const _rbox = new THREE.Box3();
  function rectFromBox(box) {
    const gl = renderer.getContext();
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const v = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
      v.project(camera);
      const sx = (v.x * 0.5 + 0.5) * W, sy = (v.y * 0.5 + 0.5) * H;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx);
      y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, W, H };
  }
  function screenRectOf(obj) {
    obj.updateWorldMatrix(true, true);
    return rectFromBox(_rbox.setFromObject(obj));
  }
  function screenRectOfMany(objs) {
    const box = new THREE.Box3();
    /* ★ precise=true：转过 90° 的细长件（罐子、橡皮筋股）用非精确 AABB 会撑大一圈，
       量出来的屏幕包围盒比真正画出去的大 —— 取景与「落在画框内」的断言会两套口径。
       ★ updateWorldMatrix(true, …)：零件挂在 canRoot 下，必须连祖先一起刷，
       否则读到的是 canRoot 的旧矩阵（少了 y = AXIS_Y 那一截平移）。 */
    for (const o of objs) { o.updateWorldMatrix(true, true); box.expandByObject(o, true); }
    return rectFromBox(box);
  }
  function screenPointOf(p) {
    const gl = renderer.getContext();
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const v = new THREE.Vector3(p.x, p.y, p.z).project(camera);
    return { x: (v.x * 0.5 + 0.5) * W, y: (v.y * 0.5 + 0.5) * H, W, H };
  }

  /* ==========================================================================
     十五、每帧刷新
     ========================================================================== */

  /* 刚性零件的位姿：散放混合 + 滚动（绕轴线转 φ）+ 沿 z 平移
     ★ canRoot 的原点就在轴线上 ⇒ 这里的偏移量全是【相对轴线】的局部量：
       钩码挂在轴线【下方】HANG_R_S 处，所以是 −HANG_R_S，不是 AXIS_Y−HANG_R_S
       （写成后者会把钩码抬到轴线以上 2 cm —— 画面里橡皮筋就汇聚在钩码下面一截）。 */
  function placeParts() {
    const zc = state.z * U, phi = state.phi;
    canRoot.position.set(0, AXIS_Y, zc);
    for (const g of [bodyGrp, bottomGrp, lidGrp]) {
      poseNow(g);
      g.rotation.x += phi;
    }
    poseNow(weightGrp);
    weightGrp.position.y += -HANG_R_S;
    /* ★ 这里【不能】再 += zc：canRoot 本身就在 (0, AXIS_Y, zc) 上，
       钩码是它的子节点，再加一次 z 位移 ⇒ 钩码的世界 z 变成 2·zc，
       罐子滚到 12 cm 时钩码已经跑到 24 cm —— 橡皮筋却还系在 12 cm 处。
       （只有「钩码网格 vs 橡皮筋末点」这条不变量守得住，看读数看不出来。） */
    updateStrands();
  }
  /* 橡皮筋：两端分属两个坐标系，只能按世界点现算 —— 这里写的就是真正落笔的那一份 */
  function updateStrands() {
    const phi = state.phi;
    hookWorld(_hkv);
    for (const st of STRANDS) {
      const p = partOf(st.band === 'A' ? 'bandA' : 'bandB');
      const S = PART_MAT.get(p.objs[0]);
      const t = PART_T.get(p.objs[0]) || 0;
      const a0 = HOLE_A[st.hole];
      for (let i = 0; i <= STRAND_SEG; i++) {
        const u = i / STRAND_SEG;
        strandPoint(st.sign, a0, u, phi, _pts[i]);
        if (i === STRAND_SEG) _pts[i].copy(_hkv);
        if (t > 1e-6 && S) {
          _tmpC.copy(_pts[i]).applyMatrix4(S);
          _pts[i].lerp(_tmpC, t);
        }
      }
      for (let i = 0; i < STRAND_SEG; i++) {
        const a = _pts[i], b = _pts[i + 1];
        const seg = st.segs[i];
        _tmpA.copy(a).add(b).multiplyScalar(0.5);
        _tmpB.copy(b).sub(a);
        const len = Math.max(1e-4, _tmpB.length());
        seg.position.copy(_tmpA);
        seg.quaternion.setFromUnitVectors(_up, _tmpB.normalize());
        seg.scale.set(BAND_R, len, BAND_R);
      }
      for (let i = 1; i < STRAND_SEG; i++) {
        st.joints[i - 1].position.copy(_pts[i]);
        st.joints[i - 1].scale.setScalar(BAND_R);
      }
    }
  }
  function updateScene() {
    placeParts();
    bandAGrp.visible = state.band;
    bandBGrp.visible = state.band;
    weightGrp.visible = state.weight;
    rebuildTrail();
    /* 零件台里尺子会横穿摊开的零件 ⇒ 那一档不画 */
    rulerGrp.visible = state.ruler && currentView !== 'parts';
    arrowGrp.visible = state.arrow && state.pushed;
    const zc = state.z * U;
    const spd = Math.abs(state.v);
    vArrow.visible = state.arrow && state.pushed && spd > 0.02;
    if (vArrow.visible) {
      vArrow.position.set(0, AXIS_Y + R * U + 1.6, zc);
      vArrow.rotation.y = state.v >= 0 ? 0 : Math.PI;
      const s = clamp(0.55 + spd / Math.max(0.2, state.v0), 0.5, 1.35);
      vArrow.scale.set(s, s, s);
    }
    rArrow.visible = state.arrow && state.pushed && !state.finished;
    rArrow.position.set(HOLE_X + PLATE_T + 1.4, AXIS_Y, zc);
    rArrow.rotation.x = phiSafe();
  }
  function phiSafe() { return state.phi; }

  /* ==========================================================================
     十六、读数 / 图像 / 记录
     ========================================================================== */
  function stateChip() {
    if (!assemblyReady()) return ['待机', '先把罐子做好', 0];
    if (!state.pushed) return ['待机', '推它一把', 0];
    if (state.smooth && !state.finished) return ['滑动中', '光滑地面 · 罐子不转', 0];
    if (state.finished) return ['已停住', '停在原地', 1];
    if (state.paused) return ['已暂停', '点「继续」接着看', 0];
    if (state.v > 0.01) return ['滚出去', '动能 → 弹性势能', 0];
    if (state.v < -0.01) return ['滚回来', '弹性势能 → 动能', 1];
    return ['换向中', '速度为零的一瞬间', 0];
  }
  function syncAll() {
    const e = energyNow();
    const chip = stateChip();
    setText($('stateChip'), chip[0]);
    setText($('stateNote'), chip[1]);
    setClass($('stateDot'), 'ok', chip[2] === 1);

    setText($('hudV'), fmt2(state.v));
    setText($('hudTheta'), (e.theta * 180 / Math.PI).toFixed(0));
    setText($('hudZ'), (state.z * U).toFixed(1));
    const p = (x) => (x / e.e0 * 100).toFixed(1) + '%';
    setWidth($('barEk'), p(e.ek));
    setWidth($('barEe'), p(e.ee));
    setWidth($('barEl'), p(e.el));

    setText($('metricV'), fmt2(state.v) + ' m/s');
    setText($('metricTheta'), (e.theta * 180 / Math.PI).toFixed(0) + '°');
    setText($('metricAmp'), (e.amp * U).toFixed(1) + ' cm');
    setText($('metricEk'), e.ek.toFixed(3) + ' J');
    setText($('metricEe'), e.ee.toFixed(3) + ' J');
    setText($('metricEl'), e.el.toFixed(3) + ' J');

    setText($('stageCaption'), state.smooth
      ? '光滑地面：罐子只滑不滚，橡皮筋始终没有被扭紧'
      : '罐底两孔 · 盖子两孔 · 橡皮筋中部系钩码　｜　扭转角 = 罐子转过的角度');
    syncFinding();
    renderRecords();
  }
  function syncFinding() {
    const el = $('finding');
    if (!el) return;
    const e = energyNow();
    let txt, ok = false;
    if (!assemblyReady()) {
      txt = '先按右侧「⓪ 六步做出一个"魔罐"」把罐子做好 —— 罐底两孔、橡皮筋 A、钩码、橡皮筋 B、盖子，一步都省不了。';
    } else if (!state.pushed) {
      txt = '做好了。点「▶ 推它一把」：罐子会滚出去，<b>钩码始终待在最低处</b>，罐壁却带着橡皮筋两端一起转 —— 罐子转多少度，橡皮筋就被扭紧多少度。';
    } else if (state.smooth) {
      ok = true;
      txt = state.finished
        ? '<b>光滑地面上它一直滑下去，永远不会自己回来。</b>没有摩擦就滚不起来：罐子一点也不转，橡皮筋两端和钩码之间没有相对转动，橡皮筋就不会被扭紧 —— 也就没有弹性势能可以释放。'
        : '<b>光滑地面：罐子只滑不滚。</b>注意它<b>一点也没有转动</b>，橡皮筋两端和钩码之间没有相对转动，所以橡皮筋没有被扭紧。';
    } else if (state.finished) {
      ok = true;
      txt = '<b>停住了。</b>弹性回复力已经小于最大静摩擦，罐子被按在原地 —— 这一来一回损失掉的机械能，都变成了内能（灰色那一段）。';
    } else if (state.v > 0.01) {
      txt = `罐子正在<b>滚出去</b>：速度 ${fmt2(state.v)} m/s 在减小、扭转角 ${(e.theta * 180 / Math.PI).toFixed(0)}° 在增大 —— <b>动能正在变成弹性势能</b>。`;
    } else {
      ok = true;
      txt = `罐子正在<b>滚回来</b>：橡皮筋在松开，扭转角 ${(e.theta * 180 / Math.PI).toFixed(0)}° 在减小、速度 ${fmt2(Math.abs(state.v))} m/s 在增大 —— <b>弹性势能正在变成动能</b>。`;
    }
    setHTML(el, txt);
    setClass(el, 'ok', ok);
  }

  const CHART_T_MIN = 6;
  function chartGeom() {
    const cv = $('chartCanvas');
    if (!cv) return null;
    const w = cv.clientWidth || 640, h = cv.clientHeight || 200;
    const lastT = state.series.length ? state.series[state.series.length - 1].t : 0;
    const maxT = Math.max(CHART_T_MIN, state.t * 1.05, lastT * 1.05);
    let maxZ = Math.max(0.08, Math.abs(ampOf(state.v0)) * 1.15);
    for (const s of state.series) maxZ = Math.max(maxZ, Math.abs(s.z) * 1.1);
    return { w, h, maxT, maxZ, padL: 42, padR: 12, padT: 10, padB: 22 };
  }
  function xOfT(g, t) { return g.padL + (t / g.maxT) * (g.w - g.padL - g.padR); }
  function yOfZ(g, z) {
    const cy = (g.h - g.padB + g.padT) / 2;
    const half = (g.h - g.padB - g.padT) / 2;
    return cy - (z / g.maxZ) * half;
  }
  function drawChart() {
    const cv = $('chartCanvas');
    if (!cv) return;
    const g = chartGeom();
    if (!g) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.round(g.w * dpr), H = Math.round(g.h * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0a1725';
    ctx.fillRect(0, 0, g.w, g.h);
    ctx.strokeStyle = '#1b2c3d'; ctx.lineWidth = 1;
    for (let i = 0; i <= 6; i++) {
      const x = g.padL + i * (g.w - g.padL - g.padR) / 6;
      ctx.beginPath(); ctx.moveTo(x, g.padT); ctx.lineTo(x, g.h - g.padB); ctx.stroke();
    }
    for (let i = 0; i <= 4; i++) {
      const y = g.padT + i * (g.h - g.padB - g.padT) / 4;
      ctx.beginPath(); ctx.moveTo(g.padL, y); ctx.lineTo(g.w - g.padR, y); ctx.stroke();
    }
    ctx.strokeStyle = '#64748b'; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(g.padL, yOfZ(g, 0)); ctx.lineTo(g.w - g.padR, yOfZ(g, 0)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2;
    ctx.beginPath();
    state.series.forEach((s, i) => {
      const x = xOfT(g, s.t), y = yOfZ(g, s.z);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    if (state.pushed) {
      ctx.fillStyle = '#e0f2fe';
      ctx.beginPath(); ctx.arc(xOfT(g, state.t), yOfZ(g, state.z), 3.2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#fbbf24';
    for (const tn of state.turns) {
      ctx.beginPath(); ctx.arc(xOfT(g, tn.t), yOfZ(g, tn.z), 4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#7f97a9';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText((g.maxZ * 100).toFixed(0), g.padL - 5, yOfZ(g, g.maxZ) + 3);
    ctx.fillText('0', g.padL - 5, yOfZ(g, 0) + 3);
    ctx.fillText('-' + (g.maxZ * 100).toFixed(0), g.padL - 5, yOfZ(g, -g.maxZ) + 3);
    ctx.textAlign = 'center';
    ctx.fillText('0', g.padL, g.h - 7);
    ctx.fillText(g.maxT.toFixed(1) + ' s', g.w - g.padR, g.h - 7);
    ctx.textAlign = 'left';
    ctx.fillText('位置/cm', 4, g.padT + 9);
  }
  function pushSample() {
    state.series.push({ t: state.t, z: state.z });
    if (state.series.length > 4000) state.series.shift();
  }
  function renderRecords() {
    const tb = $('records');
    if (!tb) return;
    setHTML(tb, state.turns.length
      ? state.turns.map((r) => `<tr><td>${r.n}</td><td>${r.t.toFixed(2)} s</td>` +
        `<td>${(r.z * U).toFixed(1)} cm</td><td>${(r.theta * 180 / Math.PI).toFixed(0)}°</td>` +
        `<td>${r.ee.toFixed(3)} J</td><td>${r.dir > 0 ? '最远（+）' : '最远（−）'}</td></tr>`).join('')
      : '<tr><td colspan="6" class="empty">还没有记录，先点「推它一把」</td></tr>');
    const sum = $('summary');
    if (!sum) return;
    if (state.turns.length < 2) {
      setText(sum, '建议记录：罐子第一次停下、第二次停下、第三次停下各记一次，比较它们离出发点多远 —— 你会发现差值几乎相等。');
      return;
    }
    const plus = state.turns.filter((r) => r.dir > 0);
    const minus = state.turns.filter((r) => r.dir < 0);
    const da = plus.length >= 2 ? Math.abs(Math.abs(plus[0].z) - Math.abs(plus[1].z)) * U : NaN;
    const db = minus.length >= 2 ? Math.abs(Math.abs(minus[0].z) - Math.abs(minus[1].z)) * U : NaN;
    const d = isFinite(da) ? da : db;
    setText(sum, isFinite(d)
      ? `相邻两次同方向的折返点相差 ${d.toFixed(1)} cm。理论值 ΔA = 2·F阻 / K = ${(dAmpPerHalf() * U).toFixed(1)} cm —— 每次来回被摩擦吃掉的能量是固定的一份。`
      : '再记一次同方向的折返点，就能看出相邻两次相差多少。');
  }

  /* ==========================================================================
     十七、UI 绑定
     ========================================================================== */
  function setSkin(mode) {
    state.skin = mode;
    document.querySelectorAll('[data-skin]').forEach((b) => b.classList.toggle('active', b.dataset.skin === mode));
    const glass = mode === 'glass';
    bodyWall.material = glass ? shellGlass : shellSolid;
    bottomBuild.plate.material = glass ? plateGlass : plateMat;
    lidBuild.plate.material = glass ? plateGlass : plateMat;
    updateClipPlane();
    syncAll();
    requestRender();
  }
  function setSmooth(on) {
    state.smooth = !!on;
    document.querySelectorAll('[data-ground]').forEach((b) => b.classList.toggle('active', (b.dataset.ground === 'smooth') === state.smooth));
    resetSim();
    requestRender();
  }
  function setV0(v) {
    state.v0 = clamp(v, 0.4, 1.6);
    const r = $('v0Range');
    if (r && Number(r.value) !== state.v0) r.value = String(state.v0);
    setText($('v0Val'), state.v0.toFixed(2) + ' m/s');
    if (!state.pushed) state.e0 = 0;
    drawChart();
    syncAll();
  }

  const asmList = $('asmList');
  if (asmList) {
    asmList.addEventListener('click', (e) => {
      const li = e.target.closest('[data-asm]');
      if (!li) return;
      assembleStep(Number(li.dataset.asm), false);
      updateAsmUI();
    });
  }
  const bind = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
  bind('asmAuto', () => { autoAssemble(); updateAsmUI(); });
  bind('asmScatter', () => { scatterAll(); updateAsmUI(); });
  const doPush = () => { push(); updateAsmUI(); requestRender(); };
  const doPause = () => { if (!state.pushed || state.finished) return; setPaused(!state.paused); requestRender(); };
  const doReset = () => { resetSim(); updateAsmUI(); requestRender(); };
  bind('runBtn', doPush);
  bind('stagePush', doPush);
  bind('pauseBtn', doPause);
  bind('stagePause', doPause);
  bind('resetBtn', doReset);
  bind('stageReset', doReset);
  bind('stageRecord', () => { recordTurn(); requestRender(); });
  bind('clearRecords', () => { state.turns = []; turnIndex = 0; renderRecords(); drawChart(); });
  document.querySelectorAll('[data-speed]').forEach((b) => {
    b.addEventListener('click', () => {
      state.speed = Number(b.dataset.speed);
      document.querySelectorAll('[data-speed]').forEach((x) => x.classList.toggle('active', x === b));
    });
  });
  document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => applyView(b.dataset.view)));
  document.querySelectorAll('[data-skin]').forEach((b) => b.addEventListener('click', () => setSkin(b.dataset.skin)));
  document.querySelectorAll('[data-ground]').forEach((b) => b.addEventListener('click', () => setSmooth(b.dataset.ground === 'smooth')));
  const v0Range = $('v0Range');
  if (v0Range) v0Range.addEventListener('input', () => setV0(Number(v0Range.value)));
  function bindToggle(id, key) {
    const el = $(id);
    if (!el) return;
    el.checked = state[key];
    el.addEventListener('change', () => { state[key] = el.checked; updateScene(); syncAll(); requestRender(); });
  }
  bindToggle('toggleBand', 'band');
  bindToggle('toggleWeight', 'weight');
  bindToggle('toggleArrow', 'arrow');
  bindToggle('toggleRuler', 'ruler');
  bindToggle('toggleTrail', 'trail');

  const STEPS = [
    { d: '<b>①</b> 罐底沿一条直径对称钻两个小孔（相距约 4.4 cm）。<br><b>②</b> 橡皮筋 A 的两端从这两个孔穿出去，在罐底外侧打结固定。<br><b>③</b> 用细线把钩码系在橡皮筋 A 的<b>正中间</b>。<br><b>④</b> 盖子上也开两个对齐的孔，橡皮筋 B 穿过去、中部同样系在钩码挂钩上。<br><b>⑤</b> 合上盖子，橡皮筋 B 在外侧拉紧打结。<br><b>⑥</b> 完成 —— 两根橡皮筋都绷在罐子里，中间吊着钩码。在右侧「⓪」里按 ①→⑥ 逐条点，或者点「⚡ 一键自动组装」。' },
    { d: '把「③ 内部结构」切到 <b>剖视</b>：朝向你的那半边罐壁被切掉了，能看见两条橡皮筋各由两股组成，从罐底两个孔、盖子两个孔汇聚到中间那个钩码上；切面会跟着视角转。想看罐子<b>正对着</b>的内部，点上面的「沿轴看内部」（会自动切成半透明）。' },
    { d: '点「▶ 推它一把」。罐子向前滚，<b>钩码始终停在最低处</b>，而罐壁带着橡皮筋的两端一起转 —— 罐子相对钩码转过多少角度，橡皮筋就被<b>扭紧</b>多少角度。盯着右上角的能量条：蓝条（动能）在缩短，黄条（弹性势能）在变长。' },
    { d: '罐子速度减到零的那一瞬间，动能全部变成了弹性势能 —— 黄条最长。速度箭头缩到最小、转动方向箭头指着反向。<b>这就是"最远处"</b>，也是折返点。' },
    { d: '橡皮筋扭紧了就要松开。它反过来给罐子一个扭矩，罐子开始<b>倒着滚回来</b>：黄条变短、蓝条变长 —— <b>弹性势能变成动能</b>。注意它会一直滚过出发点，滚到另一侧去。' },
    { d: '每一次来回，罐子与地面之间的摩擦都要吃掉一份机械能（灰色那一段只增不减）。所以折返点一次比一次近，而且<b>相邻两次的距离差几乎一样</b>（理论值 ΔA = 2·F阻 / K）。点「记录折返点」把每次停下的位置记进右表比一比。' },
    { d: '把「② 地面」切到 <b>光滑地面</b>再推一把：罐子<b>一点也不转</b>，只是平着滑出去 —— 没有摩擦就滚不起来，橡皮筋两端和钩码之间没有相对转动，橡皮筋不会被扭紧，也就没有弹性势能可以释放。<b>它不会自己滚回来。</b>' }
  ];
  function setStep(i) {
    const s = STEPS[i] || STEPS[0];
    setHTML($('stepDetail'), s.d);
    document.querySelectorAll('[data-step]').forEach((b) => b.classList.toggle('active', Number(b.dataset.step) === i));
  }
  document.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => setStep(Number(b.dataset.step))));

  /* 全屏：目标就是舞台本身（关键按钮已经放进了舞台底部那条控制带里） */
  const fsBtn = $('mo-fs');
  const fsIsOn = () => document.fullscreenElement === stage || document.webkitFullscreenElement === stage;
  /* 切换后容器尺寸要【晚一帧】才稳定 ⇒ 立刻一次 + 第二次补一次。
     ★ 第二次不能只挂 rAF：无头环境里 rAF 可能一次都不回调（实测本机 headless
     下 fullscreenchange 之后的 rAF 就没跑），于是「补一次」永远不发生。
     改成 rAF 与 setTimeout 双保险、且只认第一次到的那个。 */
  let fsSecondPass = false;
  let fsPending = false;                  // 全屏刚切过、还没补第二次 layout
  function fsSecond() {
    if (fsSecondPass) return;
    fsSecondPass = true;
    fsPending = false;
    resize(); state.fsLayouts++;
    if (currentView === 'parts') fitPartsView();
    requestRender();
  }
  if (fsBtn) {
    fsBtn.addEventListener('click', () => {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      } else if (stage.requestFullscreen) {
        stage.requestFullscreen();
      } else if (stage.webkitRequestFullscreen) {
        stage.webkitRequestFullscreen();
      }
    });
  }
  document.addEventListener('fullscreenchange', () => {
    const on = fsIsOn();
    if (fsBtn) {
      const ex = fsBtn.querySelector('.fs-expand'), cp = fsBtn.querySelector('.fs-compress');
      const lb = fsBtn.querySelector('.lbl');
      if (ex) ex.style.display = on ? 'none' : '';
      if (cp) cp.style.display = on ? '' : 'none';
      if (lb) lb.textContent = on ? '退出' : '全屏';
      fsBtn.title = on ? '退出全屏' : '全屏显示实验画面';
    }
    fsSecondPass = false;
    fsPending = true;
    resize(); state.fsLayouts++;
    /* 三条保险，谁先到算谁（fsSecond 自带 once 守卫）：
       ① 双 rAF —— 常规浏览器的「晚一帧」；
       ② setTimeout —— 本机 headless 下 rAF 可能一次都不回调；
       ③ ResizeObserver（见下）—— 全屏改变舞台尺寸时浏览器一定会派发，最可靠。 */
    requestAnimationFrame(() => requestAnimationFrame(fsSecond));
    setTimeout(fsSecond, 90);
  });

  /* ==========================================================================
     十八、渲染循环
     ========================================================================== */
  let dirty = true;
  function requestRender() { dirty = true; }
  function renderNow() { renderer.render(scene, camera); dirty = false; }
  let uiAcc = 0;
  function frameStep(dt) {
    if (asmTween) advanceAsm(dt);
    if (state.running && !state.finished && !state.paused) {
      const d = dt * state.speed;
      let rem = d;
      while (rem > 1e-6) {
        const step = Math.min(0.002, rem);
        stepSim(step);
        rem -= step;
        if (state.finished) break;
      }
      state.sampleAcc += d;
      while (state.sampleAcc >= 0.02) { state.sampleAcc -= 0.02; pushSample(); }
      /* 损耗只增不减：由「其余两项」反推，保证三条能量条之和恒等于初始机械能 */
      state.eLoss = Math.max(state.eLoss, Math.max(0, state.e0 - ekOf(state.v) - eeOf(state.z)));
      if (state.finished) {
        state.running = false;
        state.paused = false;
        updateAsmUI();
        pushSample();
      }
      updateScene();
    }
    uiAcc += dt;
    if (uiAcc >= 0.08) {
      uiAcc = 0;
      syncAll();
      drawChart();
    }
    if (dirty) renderNow();
  }
  let last = performance.now();
  (function loop(now) {
    requestAnimationFrame(loop);
    const t = now || performance.now();
    let dt = (t - last) / 1000;
    last = t;
    if (!isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, 0.1);
    frameStep(dt);
  })(last);
  /* 无头兜底：本机 headless 可能一次 rAF 都不回调 */
  setTimeout(() => { if (dirty) renderNow(); }, 1200);

  /* ==========================================================================
     十九、启动
     --------------------------------------------------------------------------
     出厂就是【拆开摊在地上】的样子 + 零件台视角：学生先按 ①→⑥ 把它装起来
     （装完 afterAsmChange 会自动切回侧视），装好之前推不动它。
     ========================================================================== */
  updateClipPlane();
  setSkin('solid');
  setV0(V0_DEF);
  for (const p of ASM_PARTS) for (const o of p.objs) PART_T.set(o, 1);
  asmSay('六件零件摊在地面上，按 ①→⑥ 把它装成一个"魔罐"', false);
  placeParts();
  updateScene();
  updateCamera();
  resize();
  applyView('parts');
  drawChart();
  setStep(0);
  renderRecords();
  updateAsmUI();
  syncAll();

  /* ==========================================================================
     二十、对外导出面（无头验收）
     --------------------------------------------------------------------------
     导出的都是【算这些量的函数本身】或【真正落笔的那一份几何】，不是另抄的快照 ——
     自检若自己重抄一遍 thetaOf / energyNow，把页面里改坏了照样全绿。
     ========================================================================== */
  window.__moLab = {
    state, view, VIEWS, camera, renderer, scene,
    P: { U, G, R, L, M_CAN, M_W, HOLE_D, HANG_R, K_T, MU, M_EFF, K_LIN, OMEGA_N, F_FRIC, V0_DEF, Z_LIMIT },
    AXIS_Y, HOLE_X, HOLE_R, HANG_R_S, HOLE_A, W_A, PLATE_T, BAND_R, STRAND_SEG,
    thetaOf, ekOf, eeOf, accelOf, ampOf, dAmpPerHalf, stopAmp, energyNow,
    updateCamera, resize, requestRender, renderNow, applyView, setSkin, setSmooth, setV0,
    step(dt) { stepSim(dt); updateScene(); syncAll(); drawChart(); requestRender(); },
    /* 无头环境没有 rAF：按固定步长喂帧，走的是与真实循环同一个 frameStep */
    driveAnim(seconds, dt = 1 / 60) {
      const n = Math.max(1, Math.round(seconds / dt));
      for (let i = 0; i < n; i++) frameStep(dt);
      renderNow();
      return {
        frames: n, t: state.t, z: state.z, v: state.v, phi: state.phi,
        running: state.running, finished: state.finished, e0: state.e0,
        eLoss: state.eLoss, turns: state.turns.length, series: state.series.length,
        fsLayouts: state.fsLayouts
      };
    },
    /* 直接推进仿真（不依赖真实时间）—— 与真实循环共用 stepSim */
    advance(seconds) {
      let left = seconds;
      while (left > 0 && !state.finished) {
        const d = Math.min(0.002, left);
        stepSim(d);
        left -= d;
      }
      state.eLoss = Math.max(state.eLoss, Math.max(0, state.e0 - ekOf(state.v) - eeOf(state.z)));
      state.sampleAcc += seconds;
      while (state.sampleAcc >= 0.02) { state.sampleAcc -= 0.02; pushSample(); }
      /* ★ 走 updateScene 而不是 placeParts：箭头朝向 / 轨迹 / 可见性都在那里刷新，
         只调 placeParts 的话「转动箭头跟着 φ 转」「速度箭头翻转」这些画面量
         会停在初始值上 —— 自检读 drawn() 就恒等于 0。 */
      updateScene(); syncAll(); drawChart();
      return { t: state.t, z: state.z, v: state.v, phi: state.phi, finished: state.finished, turns: state.turns.length };
    },
    push, setPaused, resetSim, recordTurn,
    pushSample, drawChart, chartGeom, xOfT, yOfZ, syncAll, stateChip, renderRecords,
    /* ---- 橡皮筋几何：交出的就是【真正落笔的那一份】 ---- */
    strandPoints(bandIdx, holeIdx, n) {
      const st = STRANDS.filter((s) => s.band === bandIdx)[holeIdx];
      if (!st) return null;
      const p = partOf(bandIdx === 'A' ? 'bandA' : 'bandB');
      const S = PART_MAT.get(p.objs[0]);
      const t = PART_T.get(p.objs[0]) || 0;
      const N = Math.max(2, n || STRAND_SEG + 1);
      const hook = hookWorld(new THREE.Vector3());
      const out = [];
      const tmp = new THREE.Vector3(), q = new THREE.Vector3();
      for (let i = 0; i < N; i++) {
        const u = i / (N - 1);
        strandPoint(st.sign, HOLE_A[st.hole], u, state.phi, tmp);
        if (u === 1) tmp.copy(hook);
        if (t > 1e-6 && S) { q.copy(tmp).applyMatrix4(S); tmp.lerp(q, t); }
        out.push({ x: tmp.x, y: tmp.y, z: tmp.z });
      }
      return out;
    },
    strandInfo() {
      return STRANDS.map((s) => ({ band: s.band, sign: s.sign, hole: s.hole, segs: s.segs.length, joints: s.joints.length }));
    },
    hookWorld() { const v = hookWorld(new THREE.Vector3()); return { x: v.x, y: v.y, z: v.z }; },
    /* 钩码【网格自己】的世界位置（不是算出来的挂钩点）——
       「橡皮筋汇聚点 == 钩码挂钩」这条不变量必须拿两边的【实际落笔位置】比，
       只比 hookWorld 与 strandPoint 的话，把钩码整体抬到轴线上方也照样全绿。 */
    weightWorld() {
      weightGrp.updateWorldMatrix(true, false);
      const v = new THREE.Vector3();
      weightGrp.getWorldPosition(v);
      return { x: v.x, y: v.y, z: v.z, rotX: weightGrp.rotation.x };
    },
    holeWorld(bandIdx, holeIdx) {
      const st = STRANDS.filter((s) => s.band === bandIdx)[holeIdx];
      if (!st) return null;
      const v = new THREE.Vector3();
      strandPoint(st.sign, HOLE_A[st.hole], 0, state.phi, v);
      return { x: v.x, y: v.y, z: v.z };
    },
    /* 段信息：直接读【真正写进 mesh 的那些数】（位置 / 长度 / 朝向） */
    segInfo(bandIdx, holeIdx) {
      const st = STRANDS.filter((s) => s.band === bandIdx)[holeIdx];
      if (!st) return null;
      return st.segs.map((m) => ({
        x: m.position.x, y: m.position.y, z: m.position.z,
        len: m.scale.y, qx: m.quaternion.x, qy: m.quaternion.y, qz: m.quaternion.z, qw: m.quaternion.w
      }));
    },
    rectOf(key) {
      const p = partOf(key);
      if (p) return screenRectOfMany(p.objs);
      if (key === 'can') return screenRectOfMany([bodyGrp, bottomGrp, lidGrp]);
      if (key === 'all') return screenRectOfMany([bodyGrp, bottomGrp, lidGrp, weightGrp, bandAGrp, bandBGrp]);
      if (key === 'ruler') return screenRectOf(rulerGrp);
      if (key === 'weight') return screenRectOf(weightGrp);
      if (key === 'band') return screenRectOfMany([bandAGrp, bandBGrp]);
      return null;
    },
    /* 世界包围盒（逐 mesh，精确）—— 「罐子不穿地」「散件都摊在地上」用它 */
    worldBox(key) {
      const objs = key === 'can' ? [bodyGrp, bottomGrp, lidGrp]
        : key === 'all' ? [bodyGrp, bottomGrp, lidGrp, weightGrp, bandAGrp, bandBGrp]
          : (partOf(key) ? partOf(key).objs : null);
      if (!objs) return null;
      const box = new THREE.Box3();
      for (const root of objs) {
        root.updateWorldMatrix(true, true);
        root.traverse((o) => { if (o.isMesh) box.expandByObject(o, true); });
      }
      return { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] };
    },
    /* ★ 像素腿：直接 gl.readPixels 读默认帧缓冲。
       不用 drawImage + getImageData：WebGL 画布在跨任务时会被合成器清掉
       （要稳就得开 preserveDrawingBuffer，代价更大）。readPixels 紧跟在
       renderNow() 之后的同一个任务里执行，读到的就是刚画完那一帧。 */
    pixelStats(x, y, w, h) {
      renderNow();
      const gl = renderer.getContext();
      const X = Math.max(0, Math.round(x)), Y = Math.max(0, Math.round(y));
      const W = Math.min(gl.drawingBufferWidth - X, Math.round(w));
      const H = Math.min(gl.drawingBufferHeight - Y, Math.round(h));
      if (W <= 0 || H <= 0) return null;
      const buf = new Uint8Array(W * H * 4);
      gl.readPixels(X, Y, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      let n = 0, lum = 0, orange = 0, metal = 0, bright = 0, vbright = 0, red = 0;
      for (let i = 0; i < W * H; i++) {
        const r = buf[i * 4], g = buf[i * 4 + 1], b = buf[i * 4 + 2];
        const L = (r + g + b) / 3;
        lum += L; n++;
        if (r > 140 && r - b > 55 && r - g > 25) orange++;      // 橡皮筋的橙
        if (Math.abs(r - g) < 20 && Math.abs(g - b) < 22 && L > 100 && L < 240) metal++;  // 金属灰
        if (L > 205) bright++;                                   // 刻度尺 / 地面的亮
        /* ★ 地面被棚拍光照到 ~205，刻度尺的纸面是 ~233 —— 「亮」这个阈值分不开两者，
           必须再抬一档（>228）才把「尺子在不在」变成干净的差分。 */
        if (L > 228) vbright++;
        if (r > 150 && g < 120 && b < 120) red++;
      }
      return { n, lum: lum / n, orange, metal, bright, vbright, red, w: W, h: H, x: X, y: Y };
    },
    screenPointOf(p) { return screenPointOf(p); },
    clip() {
      return {
        on: state.skin === 'cut',
        n: [clipPlane.normal.x, clipPlane.normal.y, clipPlane.normal.z],
        c: clipPlane.constant, axisY: AXIS_Y,
        planes: shellSolid.clippingPlanes ? shellSolid.clippingPlanes.length : 0
      };
    },
    fsLayouts() { return state.fsLayouts; },
    /* ---- 组装 ---- */
    asm: {
      steps: ASM_STEPS.map((s) => ({ key: s.key, name: s.name, parts: s.parts.slice(), hint: s.hint })),
      parts: ASM_PARTS.map((p) => ({ key: p.key, label: p.label, raw: !!p.raw })),
      total: ASM_STEPS.length,
      count: assembledCount,
      ready: assemblyReady,
      progress: partProgress,
      busy: () => !!asmTween,
      queued: () => asmQueue.length,
      note: () => ({ text: asmNote, bad: asmNoteBad }),
      poseOf(key) { const p = PART_POSE.get((partOf(key) || {}).objs?.[0]); return p ? Object.assign({}, p) : null; },
      specOf(key) { const s = ASM_POSE[key]; return s ? Object.assign({}, s) : null; },
      rectOf(key) { const p = partOf(key); return p ? screenRectOfMany(p.objs) : null; },
      rectAll(withLog) { const log = withLog ? [] : null; const r = partsRect(log); return log ? { rect: r, meshes: log } : r; },
      assembleStep: (i, force) => { const r = assembleStep(i, force); updateAsmUI(); return r; },
      autoAssemble: () => { const r = autoAssemble(); updateAsmUI(); return r; },
      scatterAll: () => { const r = scatterAll(); updateAsmUI(); return r; },
      finishAll,
      view: () => ({ ...view }),
      gotoView: (n) => applyView(n || 'parts'),
      fit: fitPartsView,
      updateUI: updateAsmUI
    },
    drawn() {
      return {
        trailVisible: trailLine.visible, trailLen: trailLine.scale.z, trailZ: trailLine.position.z,
        marks: trailMarks.map((m) => m.z * U),
        vArrowVisible: vArrow.visible, vArrowZ: vArrow.position.z, vArrowFlip: vArrow.rotation.y,
        /* 速度箭头【真正指向】—— 读的是子几何的尾/尖两个世界点，不是组的 rotation。
           只比 rotation.y 是 0/π 的话，把箭杆与箭头画成沿罐轴 x 也照样全绿
           （本轮就是这么漏掉一次的）。 */
        vArrowDir: (() => {
          vArrow.updateWorldMatrix(true, true);
          const shaft = vArrow.children[0], head = vArrow.children[1];
          if (!shaft || !head) return null;
          const tail = new THREE.Vector3(0, -shaft.geometry.parameters.height / 2, 0).applyMatrix4(shaft.matrixWorld);
          const tip = new THREE.Vector3(0, head.geometry.parameters.height / 2, 0).applyMatrix4(head.matrixWorld);
          const d = tip.sub(tail).normalize();
          return { x: d.x, y: d.y, z: d.z };
        })(),
        rArrowVisible: rArrow.visible, rArrowRot: rArrow.rotation.x,
        canZ: canRoot.position.z, bodyRotX: bodyGrp.rotation.x,
        weightY: weightGrp.position.y, weightRotX: weightGrp.rotation.x,
        rulerVisible: rulerGrp.visible, bandVisible: bandAGrp.visible,
        seg0: STRANDS[0].segs[0] ? { y: STRANDS[0].segs[0].position.y, z: STRANDS[0].segs[0].position.z } : null
      };
    },
    bars() {
      const e = energyNow();
      const pct = (x) => (x / e.e0 * 100);
      return { ek: pct(e.ek), ee: pct(e.ee), el: pct(e.el), sum: pct(e.ek) + pct(e.ee) + pct(e.el) };
    },
    readouts() {
      const g = (id) => { const el = $(id); return el ? el.textContent : null; };
      return {
        hudV: g('hudV'), hudTheta: g('hudTheta'), hudZ: g('hudZ'),
        metricV: g('metricV'), metricTheta: g('metricTheta'), metricAmp: g('metricAmp'),
        metricEk: g('metricEk'), metricEe: g('metricEe'), metricEl: g('metricEl'),
        chip: g('stateChip'), note: g('stateNote'),
        barEk: $('barEk') ? $('barEk').style.width : null,
        barEe: $('barEe') ? $('barEe').style.width : null,
        barEl: $('barEl') ? $('barEl').style.width : null,
        asmCount: g('asmCount'), asmHint: g('asmHint'),
        finding: $('finding') ? $('finding').innerHTML : null,
        v0Val: g('v0Val'), summary: g('summary')
      };
    },
    dom() {
      const list = $('asmList');
      return {
        asmItems: list ? Array.from(list.querySelectorAll('[data-asm]')).map((li) => ({
          done: li.classList.contains('done'), next: li.classList.contains('next'), busy: li.classList.contains('busy')
        })) : [],
        gateHidden: $('runGate') ? $('runGate').hidden : null,
        runDisabled: $('runBtn') ? $('runBtn').disabled : null,
        stagePushDisabled: $('stagePush') ? $('stagePush').disabled : null,
        pauseDisabled: $('pauseBtn') ? $('pauseBtn').disabled : null,
        skinActive: Array.from(document.querySelectorAll('[data-skin]')).map((b) => b.classList.contains('active')),
        groundActive: Array.from(document.querySelectorAll('[data-ground]')).map((b) => b.classList.contains('active')),
        viewActive: Array.from(document.querySelectorAll('[data-view]')).map((b) => b.classList.contains('active')),
        stepActive: Array.from(document.querySelectorAll('[data-step]')).findIndex((b) => b.classList.contains('active')),
        findingOk: $('finding') ? $('finding').classList.contains('ok') : null
      };
    }
  };
})();
