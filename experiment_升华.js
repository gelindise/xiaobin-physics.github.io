import * as THREE from './assets/optics-three.min.js';

/* ============================================================================
   升华和凝华 —— 三维写实实验台（碘玻璃管 / 干冰 / 霜 / 生活现象）
   ---------------------------------------------------------------------------
   世界坐标单位：厘米（cm），y 轴向上，实验台台面为 y = 0。
   器材：铁架台（铸铁底座 + 镀铬立柱 + 铁夹）、两端封闭的硼硅玻璃管、
         管底固态碘、碘蒸气、管壁凝华出的晶体、接水盘、浇水用的烧杯。
   操作（课本图 3.4-1）：浇热水 → 升华；浇冷水 → 凝华；取出放凉 → 慢速凝华。
   物理：① 升华速率走 Clausius-Clapeyron 形式（相对速率，60 ℃ 定为 1），
            「升华开始温度」由速率阈值【解】出来，不是写死的常数；
         ② 三份质量守恒 —— m固态 + m蒸气 + m晶体 ≡ 2 g，恒成立；
         ③ 全程【不出现液态碘】：liquidMass 恒为 0，画面上也不存在任何液滴网格。
   ========================================================================== */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  /* ------------------------------ 器材尺寸 ------------------------------ */
  const BASE_W = 26, BASE_D = 17, BASE_H = 1.8;      // 铸铁底座
  const ROD_R = 0.55, ROD_H = 30, ROD_Z = -5.6;      // 镀铬立柱
  const RING_Y = 16.5;                               // 铁圈高度（只给干冰场景的烧杯用）
  const NET_W = 13, NET_T = 0.22;                    // 石棉网（方形金属网 + 圆石棉片）
  const BK_R = 4.6, BK_H = 10.5;                     // 烧杯
  const BK_Y0 = RING_Y + NET_T + 0.06;               // 16.78
  const WATER_H = 7.0;
  const WATER_TOP = BK_Y0 + WATER_H;                 // 23.78

  /* ★ 碘的容器按课本图 3.4-1 重做：不再是「球泡 + 细颈」的碘锤，而是一支
     【两端封闭的细玻璃管】，少量碘颗粒沉在圆底里。课本上的做法是往管外
     【浇热水】看它升华、再【浇冷水】看它凝华 —— 没有水浴、也没有酒精灯。 */
  const TUBE_R = 1.15;                               // 玻璃管外半径
  const TUBE_BODY = 11.0;                            // 直筒段长度
  const TUBE_Y0 = 9.4;                               // 管底（圆底最低点）
  const TUBE_Y1 = TUBE_Y0 + TUBE_BODY;               // 直筒顶端（再往上接半球封口）
  const TUBE_TOP = TUBE_Y1 + TUBE_R;                 // 封口最高点 ≈ 23.05
  const CLAMP_Y = 15.0;                              // 铁夹夹住的高度
  const IODINE_Y = TUBE_Y0 + 0.30;                   // 碘堆坐在圆底里

  const TRAY_R = 4.5, TRAY_H = 1.15;                 // 接水盘（浇水时接住流下来的水）
  const POUR_HOT = 78, POUR_COLD = 8;                // 浇热水 / 浇冷水 时管壁的目标温度
  const POUR_DUR = 6.0;                              // 一次浇水持续【仿真秒】
  const M_TOTAL = 2.0;                               // 碘的总质量 g

  /* ------------------------------ 物理参数 ------------------------------ */
  const AMB = 20;                                    // 室温 ℃
  /* ★ 三条一阶热响应：浇热水 / 浇冷水 / 取出放凉。τ 就是「温度追上目标值的时间常数」。
     浇水时 τ 很小（玻璃管壁薄，水直接冲在外壁上）；在空气里自然冷却的 τ 大一个量级
     —— 这正是「浇冷水凝华得快、取出来放凉凝华得慢」这两种情形的区别所在。 */
  const TAU_HOT = 1.5, TAU_COLD = 1.5, TAU_AIR = 30;

  /* 碘的升华：Clausius-Clapeyron 形式。L/R = 8500 K 由「碘在 60 ℃ 的升华速率」标定。
     ★ 不要另写一个「升华开始温度 = 45 ℃」的常数 —— 那个温度是从速率阈值【解】出来的
       （sublimStartT()），这样它和速率曲线永远自洽，改速率参数不用手工同步两处。 */
  const L_OVER_R = 8500;
  const T_REF = 60;                                  // 参考温度 ℃（此处相对速率 = 1）
  const SUB_RATE_ON = 0.30;                          // 「明显升华」的速率阈值

  function sublimRate(T) {
    const a = 1 / (T + 273.15), b = 1 / (T_REF + 273.15);
    return Math.exp(-L_OVER_R * (a - b));
  }
  /* 解出 sublimRate(T) = SUB_RATE_ON 的温度（速率随 T 单调增 ⇒ 二分法稳） */
  function sublimStartT() {
    let lo = -60, hi = 200;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (sublimRate(mid) < SUB_RATE_ON) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }
  const T_SUB_START = sublimStartT();                // ≈ 45 ℃

  const K_SUB = 0.022;                               // 升华速率系数 g/s（60 ℃ 满量时）
  const K_DEP = 0.115;                               // 凝华（沉积到管壁）系数 /s
  const K_SAT = 1.2;                                 // 饱和曲线的半值参数（见 fSat）

  const DRY_ICE_M0 = 20;                             // 干冰 20 g
  const K_DRY = 0.22;                                // 干冰升华 g/s
  const FROST_M0 = 0.9;                              // 霜的满量 g（对应枝晶最长）

  /* ------------------------------ 状态 ------------------------------ */
  const state = {
    scene: 'iodine',            // iodine | dryice | frost | life
    running: false,
    speed: 2,
    t: 0,
    T: AMB,                     // 玻璃管内温度 ℃
    /* 浇水状态机：mode = none | hot | cold；left = 这一壶水还剩多少【仿真秒】；
       k = 烧杯倾倒动画的进度 0~1（0 = 放在台面上，1 = 倾倒到位） */
    pour: { mode: 'none', left: 0, k: 0 },
    wet: 0,                     // 管壁上的水膜 0~1（浇水时涨、之后慢慢干）
    poured: 0,                  // 累计浇了多久（仿真秒）—— 决定接水盘里的水位
    mSolid: M_TOTAL,            // 固态碘 g
    mGas: 0,                    // 碘蒸气 g
    mCrystal: 0,                // 凝华到管壁上的晶体 g
    liquidMass: 0,              // ★ 恒为 0 —— 「不经过液态」的可断言不变量
    dryIce: DRY_ICE_M0,         // 干冰剩余 g
    fogAmt: 0,                  // 白雾量 0~1
    frost: 0,                   // 霜的累积量 0~1
    lifePick: -1,               // 生活现象里被点中的物件
    step: 0,
    finished: false,
    drawn: {}                   // ★ 只放【画出来的量】，不放输入
  };
  const toggles = { vapor: true, crystal: true, micro: true };

  /* ★ 取景要按【这一套器材的实际包络】给：倾倒时烧杯顶到 y≈31.8、接水盘底在 y≈1.8，
     竖直方向要装下 30 cm；而玻璃管只有 2.3 cm 粗 —— 机位给远了，整页就是「一根牙签」。
     dist 48 / ty 15.2 是「管子在画面里占四成高」和「烧杯倾倒时不出框」的折中。 */
  const VIEWS = {
    front: { yaw: -0.05, pitch: 0.05, dist: 46, ty: 15.2 },
    angle: { yaw: -0.48, pitch: 0.09, dist: 48, ty: 15.2 },
    top:   { yaw: -0.50, pitch: 0.80, dist: 44, ty: 13 },
    close: { yaw: -0.32, pitch: 0.02, dist: 34, ty: 15.2 }
  };
  const view = { ...VIEWS.angle };
  /* ★ 视角切换的唯一入口：四个视角按钮和自检/出图都调它，
     否则「点按钮切视角」和「直接改 view」是两条路，测出来的东西不是按钮走的那条。 */
  function setView(name) {
    const v = VIEWS[name];
    if (!v) return false;
    Object.assign(view, v);
    document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    updateCamera();
    return true;
  }

  /* ------------------------------ 小工具 ------------------------------ */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smoothstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const mulberry32 = (a) => () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
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

  /* ==========================================================================
     一、程序化贴图
     ========================================================================== */

  /* 实验台面
     🔴 这三张 Canvas 贴图【必须设 colorSpace = SRGBColorSpace】：
     不设的话 canvas 里 sRGB 编码的像素会被当成【线性】值直接用，线性亮度被抬高约 5 倍
     —— 实测同一套灯光下台面渲染成 lum 184（浅灰），而设了 colorSpace 的沸腾页是 67。
     这就是「白色器材、白雾、白霜全落在浅灰底上分不出来」的根因，不是审美问题。
     下面三张与 experiment_沸腾.js 逐行一致，保证同章旗舰页观感统一。 */
  function makeBenchMap() {
    const S = 512, rnd = mulberry32(99);
    const c = newCanvas(S, S), g = c.getContext('2d');
    g.fillStyle = '#33312e'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 260; i++) {
      const x = rnd() * S, y = rnd() * S, r = 8 + rnd() * 46;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, `hsla(${205 + rnd() * 30},${4 + rnd() * 8}%,${9 + rnd() * 15}%,${0.06 + rnd() * 0.1})`);
      grd.addColorStop(1, 'hsla(0,0%,0%,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    for (let i = 0; i < 5200; i++) {
      const x = rnd() * S, y = rnd() * S, r = 0.4 + rnd() * 1.5;
      const l = rnd() < 0.55 ? 7 + rnd() * 10 : 30 + rnd() * 20;
      g.fillStyle = `hsla(${200 + rnd() * 40},${4 + rnd() * 10}%,${l}%,${0.2 + rnd() * 0.44})`;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(14, 9);
    return t;
  }

  function makeBackdropMap() {
    const W = 512, H = 512;
    const c = newCanvas(W, H), g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#4a5666');
    grad.addColorStop(0.45, '#333e4a');
    grad.addColorStop(1, '#1e252d');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    const r = g.createRadialGradient(W * 0.34, H * 0.30, 10, W * 0.34, H * 0.30, W * 0.72);
    r.addColorStop(0, 'rgba(210,228,244,0.20)');
    r.addColorStop(1, 'rgba(210,228,244,0)');
    g.fillStyle = r; g.fillRect(0, 0, W, H);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  function makeIronMap() {
    const S = 512, rnd = mulberry32(1010);
    const c = newCanvas(S, S), g = c.getContext('2d');
    g.fillStyle = '#33373d'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 220; i++) {
      const x = rnd() * S, y = rnd() * S, r = 12 + rnd() * 60;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, `hsla(${210 + rnd() * 30},${3 + rnd() * 7}%,${16 + rnd() * 22}%,${0.07 + rnd() * 0.12})`);
      grd.addColorStop(1, 'hsla(0,0%,0%,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    for (let i = 0; i < 4200; i++) {
      const x = rnd() * S, y = rnd() * S, r = 0.5 + rnd() * 1.7;
      const l = rnd() < 0.6 ? 10 + rnd() * 14 : 44 + rnd() * 26;
      g.fillStyle = `hsla(${205 + rnd() * 30},${3 + rnd() * 8}%,${l}%,${0.25 + rnd() * 0.45})`;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3, 2);
    return t;
  }

  /* 石棉网：金属丝编织网（透明孔，靠 alphaTest 镂空）—— 与 experiment_沸腾.js 同一份实现。
     第一版我拿一个米色实心圆盘当石棉网，画面上就是一块「木板」，不是器材。 */
  function makeNetMap() {
    const S = 512;
    const c = newCanvas(S, S), g = c.getContext('2d');
    g.clearRect(0, 0, S, S);
    const step = S / 26;
    g.strokeStyle = 'rgba(168,176,186,0.96)';
    g.lineWidth = step * 0.30;
    for (let i = 0; i <= 26; i++) {
      g.beginPath(); g.moveTo(i * step, 0); g.lineTo(i * step, S); g.stroke();
      g.beginPath(); g.moveTo(0, i * step); g.lineTo(S, i * step); g.stroke();
    }
    g.strokeStyle = 'rgba(228,234,240,0.42)';
    g.lineWidth = step * 0.10;
    for (let i = 0; i <= 26; i++) {
      g.beginPath(); g.moveTo(i * step - step * 0.09, 0); g.lineTo(i * step - step * 0.09, S); g.stroke();
      g.beginPath(); g.moveTo(0, i * step - step * 0.09); g.lineTo(S, i * step - step * 0.09); g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3, 3);
    return t;
  }

  /* 石棉圆片：压制的纤维，短而不规则的划痕 */
  function makeAsbestosMap() {
    const S = 256, rnd = mulberry32(9753);
    const c = newCanvas(S, S), g = c.getContext('2d');
    g.fillStyle = '#cfc8ba'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 3200; i++) {
      const x = rnd() * S, y = rnd() * S, a = rnd() * Math.PI, len = 2.5 + rnd() * 9;
      const v = 0.74 + rnd() * 0.46;
      g.strokeStyle = `rgba(${Math.round(214 * v)},${Math.round(208 * v)},${Math.round(194 * v)},0.55)`;
      g.lineWidth = 0.8 + rnd() * 1.2;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(2, 2);
    return t;
  }

  /* ==========================================================================
     二、渲染器 / 场景 / 光照
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
    stage.appendChild(n);
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const MAX_ANISO = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#2b333c');
  scene.fog = new THREE.Fog('#2b333c', 180, 420);

  const camera = new THREE.PerspectiveCamera(32, 1, 1, 900);

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
    box(110, 34, 300, 168, 26, 'rgba(255,255,255,0.98)');
    box(660, 74, 232, 140, 22, 'rgba(214,232,255,0.62)');
    box(360, 300, 400, 96, 30, 'rgba(255,226,182,0.34)');
    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromEquirectangular(tex).texture;
    pmrem.dispose(); tex.dispose();
    return env;
  }
  scene.environment = studioEnv();

  scene.add(new THREE.HemisphereLight('#eaf2fa', '#4a4238', 0.44));
  scene.add(new THREE.AmbientLight('#ffffff', 0.09));

  const key = new THREE.DirectionalLight('#fff2dd', 2.0);
  key.position.set(-42, 66, 44);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -46; key.shadow.camera.right = 46;
  key.shadow.camera.top = 60; key.shadow.camera.bottom = -14;
  key.shadow.camera.near = 20; key.shadow.camera.far = 200;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.026;
  scene.add(key); scene.add(key.target);
  key.target.position.set(0, 16, 0);

  const fill = new THREE.DirectionalLight('#dce9f8', 0.58);
  fill.position.set(50, 34, 30);
  scene.add(fill);
  const rim = new THREE.DirectionalLight('#cfe2ff', 0.44);
  rim.position.set(10, 30, -56);
  scene.add(rim);

  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(420, 320),
    new THREE.MeshBasicMaterial({ map: makeBackdropMap(), fog: false })
  );
  backdrop.position.set(0, 138, -95);
  scene.add(backdrop);

  const benchMap = makeBenchMap();
  benchMap.anisotropy = MAX_ANISO;
  const bench = new THREE.Mesh(
    new THREE.BoxGeometry(220, 7, 140),
    new THREE.MeshStandardMaterial({
      map: benchMap, bumpMap: benchMap, bumpScale: 0.04,
      /* envMapIntensity 压到 0.5：棚拍环境贴图对水平台面的贡献极大，不压的话
         深灰台面会被 IBL 拉成中亮灰，白玻璃器皿又和它糊在一起。 */
      roughness: 0.9, metalness: 0.0, envMapIntensity: 0.5
    })
  );
  bench.position.set(0, -3.5, 0);
  bench.receiveShadow = true;
  scene.add(bench);

  /* ==========================================================================
     三、器材
     ========================================================================== */
  const ironMap = makeIronMap();
  ironMap.anisotropy = MAX_ANISO;
  /* ★ 与 experiment_沸腾.js 逐字一致：贴图底色是深的（#33373d），材质 color 用浅灰
     #b9bec6 去乘它。之前我把贴图改成浅色、材质改成深色，是把两处都写反了。 */
  const castIron = new THREE.MeshStandardMaterial({ map: ironMap, bumpMap: ironMap, bumpScale: 0.05, color: '#b9bec6', roughness: 0.7, metalness: 0.3 });
  const chrome = new THREE.MeshStandardMaterial({ color: '#d9dfe5', roughness: 0.16, metalness: 1.0, envMapIntensity: 1.5 });
  const darkSteel = new THREE.MeshStandardMaterial({ color: '#6d737a', roughness: 0.36, metalness: 0.92, envMapIntensity: 1.1 });
  /* 石棉网的两份材质建在器材段（netMesh / netPad），这里不再留占位材质 */

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: '#e6f3f8', transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0.0,
    clearcoat: 1.0, clearcoatRoughness: 0.03, envMapIntensity: 2.1,
    side: THREE.DoubleSide, depthWrite: false
  });
  /* ★ 玻璃管单独一份玻璃，比烧杯亮一档（opacity 0.16 → 0.22）。
     管壁薄、里面还要看得见紫色蒸气和管底的碘颗粒，太暗就只剩一根灰棍。 */
  const tubeGlassMat = new THREE.MeshPhysicalMaterial({
    color: '#cfe6f2', transparent: true, opacity: 0.07, roughness: 0.05, metalness: 0.0,
    clearcoat: 0.35, clearcoatRoughness: 0.04, envMapIntensity: 0.55,
    side: THREE.DoubleSide, depthWrite: false
  });
  /* 水比玻璃深一档、蓝一点：否则「玻璃上的水」和「玻璃」糊成一片。 */
  const waterMat = new THREE.MeshPhysicalMaterial({
    color: '#79bcd8', transparent: true, opacity: 0.34, roughness: 0.06, metalness: 0.0,
    clearcoat: 1.0, clearcoatRoughness: 0.04, envMapIntensity: 1.5,
    side: THREE.DoubleSide, depthWrite: false
  });
  /* 管壁上的水膜：比水再亮一点、更薄，才读得出「水顺着管壁淌下来」 */
  const filmMat = new THREE.MeshPhysicalMaterial({
    color: '#7fc4e0', transparent: true, opacity: 0.0, roughness: 0.04, metalness: 0.0,
    clearcoat: 1.0, clearcoatRoughness: 0.02, envMapIntensity: 2.0,
    side: THREE.DoubleSide, depthWrite: false
  });
  /* 水流：半透明白蓝，比水膜亮一档 —— 它要在暗背景上「看得见在流」 */
  const streamMat = new THREE.MeshPhysicalMaterial({
    color: '#cfeaf8', transparent: true, opacity: 0.55, roughness: 0.10, metalness: 0.0,
    clearcoat: 1.0, envMapIntensity: 1.6, depthWrite: false
  });
  /* ★ 霜场景的冷板单独一份【不透明白底】的冷灰金属板：
     半透明冷片的话，暗台面会透过板子，白霜落在深底上毫无层次。 */
  const frostPlateMat = new THREE.MeshStandardMaterial({ color: '#5d6874', roughness: 0.42, metalness: 0.55, envMapIntensity: 1.1 });
  /* 固态碘：紫黑色、带金属光泽的晶体（不是无光泽的黑块）。
     ★ 提亮 + 提高金属度/环境反射：它是「固态碘少下去了」这个核心观察量的唯一载体，
       第一版太暗，透过 0.30 的玻璃 + 0.44 的水之后在画面上直接消失了。 */
  const iodineSolidMat = new THREE.MeshStandardMaterial({ color: '#4a1553', roughness: 0.28, metalness: 0.38, envMapIntensity: 2.2 });
  /* 碘蒸气：紫色半透明。opacity 随蒸气量实时改。
     ★ 两个关键选择（第一版两个都选错，出来是「悬在水里的一串白珠子」）：
       ① 混合方式必须【普通混合】，不能用 AdditiveBlending —— 加法混合在浅色背景
          （水 + 玻璃，本身就接近白）上只会越加越白，紫色根本显不出来；
          碘蒸气是【吸收型着色气体】，普通混合的紫色才立得住。
       ② 边缘必须【渐隐】：实心球永远是个球，用软边圆贴图 + 大量互相重叠的团块，
          才叠得出「雾」的连续感。 */
  const VAP_TEX = (() => {
    const S = 128;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    /* 衰减要【平缓】：核心收得太紧，每个团块都会留下一个明显的亮心，
       几十个叠起来就是「一颗颗珠子」而不是连续的雾。 */
    grd.addColorStop(0.00, 'rgba(255,255,255,0.80)');
    grd.addColorStop(0.42, 'rgba(255,255,255,0.44)');
    grd.addColorStop(0.76, 'rgba(255,255,255,0.13)');
    grd.addColorStop(1.00, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
    return new THREE.CanvasTexture(c);
  })();
  const vaporMat = new THREE.SpriteMaterial({
    map: VAP_TEX, color: '#7a1fc8', transparent: true, opacity: 0.0,
    depthWrite: false, blending: THREE.NormalBlending, toneMapped: false
  });
  /* 凝华出的碘晶体：有金属光泽的紫黑色晶体。
     ★ 比纯黑亮一档：太暗时它落在半透明冷片上完全读不出来（实测 #2a0b33 就是这样）。 */
  const crystalMat = new THREE.MeshStandardMaterial({ color: '#3a0a45', roughness: 0.14, metalness: 0.82, envMapIntensity: 2.6 });
  /* 干冰：白色微蓝、粗糙（不是纯白 —— 纯白和白雾糊在一起，块就读不出来了） */
  const dryIceMat = new THREE.MeshStandardMaterial({ color: '#dbe7f2', roughness: 0.94, metalness: 0.0, envMapIntensity: 0.9 });
  const frostMat = new THREE.MeshStandardMaterial({ color: '#eaf6ff', roughness: 0.55, metalness: 0.0, envMapIntensity: 1.4, transparent: true, opacity: 0.95 });
  /* 生活现象场景用的两份：樟脑丸（半透明白蜡）与灯泡玻璃 */
  const camphorMat = new THREE.MeshStandardMaterial({ color: '#f2f6fa', roughness: 0.35, metalness: 0.0, envMapIntensity: 1.3 });
  const bulbGlassMat = new THREE.MeshPhysicalMaterial({ color: '#e8f2f8', transparent: true, opacity: 0.30, roughness: 0.06, metalness: 0.0, clearcoat: 1.0, depthWrite: false });
  const fogMat = new THREE.SpriteMaterial({
    map: VAP_TEX, color: '#eaf3fa', transparent: true, opacity: 0.0,
    depthWrite: false, blending: THREE.NormalBlending
  });

  const rig = new THREE.Group();
  scene.add(rig);

  /* --- 铁架台 --- */
  const base = new THREE.Mesh(new THREE.BoxGeometry(BASE_W, BASE_H, BASE_D), castIron);
  base.position.set(0, BASE_H / 2, 0);
  base.castShadow = true; base.receiveShadow = true;
  rig.add(base);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(ROD_R, ROD_R, ROD_H, 20), chrome);
  rod.position.set(-(BASE_W / 2 - 3.4), BASE_H + ROD_H / 2, ROD_Z);
  rod.castShadow = true;
  rig.add(rod);
  const ROD_X = rod.position.x;

  const ring = new THREE.Mesh(new THREE.TorusGeometry(NET_W / 2 - 0.5, 0.24, 10, 40), chrome);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(0, RING_Y, 0);
  ring.castShadow = true;
  rig.add(ring);
  const ringArm = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, Math.abs(ROD_X), 10), chrome);
  ringArm.rotation.z = Math.PI / 2;
  ringArm.position.set(ROD_X / 2, RING_Y, ROD_Z);
  rig.add(ringArm);

  const net = new THREE.Group();
  rig.add(net);
  const netMap = makeNetMap();
  netMap.anisotropy = MAX_ANISO;
  const netMesh = new THREE.Mesh(
    new THREE.BoxGeometry(NET_W, NET_T, NET_W),
    new THREE.MeshStandardMaterial({ map: netMap, alphaMap: netMap, transparent: true, alphaTest: 0.35, roughness: 0.55, metalness: 0.65, color: '#cfd6dd', side: THREE.DoubleSide })
  );
  netMesh.position.set(0, RING_Y + NET_T / 2, 0);
  netMesh.castShadow = true; netMesh.receiveShadow = true;
  net.add(netMesh);
  const asbestosMap = makeAsbestosMap();
  asbestosMap.anisotropy = MAX_ANISO;
  const netPad = new THREE.Mesh(
    new THREE.CylinderGeometry(4.9, 4.9, 0.2, 40),
    new THREE.MeshStandardMaterial({
      map: asbestosMap, bumpMap: asbestosMap, bumpScale: 0.03,
      /* 石棉片不能是纯白：它正对着主光，纯白会变成全画面最亮的一块，把烧杯压下去 */
      color: '#a49d8f', roughness: 0.97, metalness: 0, envMapIntensity: 0.6
    })
  );
  netPad.position.set(0, BK_Y0 - 0.1, 0);          // 石棉片顶面正好托住杯底（BK_Y0）
  netPad.receiveShadow = true;
  net.add(netPad);

  /* --- 烧杯 + 水浴 --- */
  const beaker = new THREE.Group();
  beaker.position.set(0, BK_Y0, 0);
  rig.add(beaker);
  const bkWall = new THREE.Mesh(new THREE.CylinderGeometry(BK_R, BK_R, BK_H, 44, 1, true), glassMat);
  bkWall.position.y = BK_H / 2;
  beaker.add(bkWall);
  const bkBottom = new THREE.Mesh(new THREE.CylinderGeometry(BK_R, BK_R, 0.22, 44), glassMat);
  bkBottom.position.y = 0.11;
  beaker.add(bkBottom);
  const bkRim = new THREE.Mesh(new THREE.TorusGeometry(BK_R, 0.13, 8, 44), glassMat);
  bkRim.rotation.x = Math.PI / 2;
  bkRim.position.y = BK_H;
  beaker.add(bkRim);

  const water = new THREE.Mesh(new THREE.CylinderGeometry(BK_R - 0.09, BK_R - 0.09, WATER_H, 44), waterMat);
  water.position.set(0, BK_Y0 + WATER_H / 2, 0);
  scene.add(water);

  /* --- 铁夹：把玻璃管夹在立柱上（课本图里那支管子就是被夹住的） --- */
  const clampGroup = new THREE.Group();
  rig.add(clampGroup);
  const clampArm = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.22, Math.abs(ROD_X) - TUBE_R, 10), chrome);
  clampArm.rotation.z = Math.PI / 2;
  clampArm.position.set((ROD_X + TUBE_R) / 2, CLAMP_Y, 0);
  clampGroup.add(clampArm);
  /* ★ 夹口半径必须跟着管径走（TUBE_R + 0.12）：写死一个大圈就变成「管子上套了个呼啦圈」 */
  const clampRing = new THREE.Mesh(new THREE.TorusGeometry(TUBE_R + 0.12, 0.13, 10, 36), chrome);
  clampRing.rotation.x = Math.PI / 2;
  clampRing.position.set(0, CLAMP_Y, 0);
  clampGroup.add(clampRing);
  const clampBoss = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.44), darkSteel);
  clampBoss.position.set(TUBE_R + 0.28, CLAMP_Y, 0);
  clampGroup.add(clampBoss);
  const clampScrew = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 1.0, 10), chrome);
  clampScrew.rotation.z = Math.PI / 2;
  clampScrew.position.set(TUBE_R + 0.82, CLAMP_Y, 0);
  clampGroup.add(clampScrew);
  const clampWing = new THREE.Mesh(new THREE.TorusGeometry(0.30, 0.05, 6, 16), chrome);
  clampWing.rotation.y = Math.PI / 2;
  clampWing.position.set(TUBE_R + 1.30, CLAMP_Y, 0);
  clampGroup.add(clampWing);

  /* --- 封闭玻璃管：直筒 + 圆底 + 半球封口 --- */
  const tubeRig = new THREE.Group();
  rig.add(tubeRig);
  const tubeWall = new THREE.Mesh(
    new THREE.CylinderGeometry(TUBE_R, TUBE_R, TUBE_Y1 - TUBE_Y0 - TUBE_R, 40, 1, true), tubeGlassMat);
  tubeWall.position.y = (TUBE_Y1 + TUBE_Y0 + TUBE_R) / 2;
  tubeRig.add(tubeWall);
  const tubeBottomCap = new THREE.Mesh(
    new THREE.SphereGeometry(TUBE_R, 32, 18, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), tubeGlassMat);
  tubeBottomCap.position.y = TUBE_Y0 + TUBE_R;
  tubeRig.add(tubeBottomCap);
  const tubeTopCap = new THREE.Mesh(
    new THREE.SphereGeometry(TUBE_R, 32, 18, 0, Math.PI * 2, 0, Math.PI / 2), tubeGlassMat);
  tubeTopCap.position.y = TUBE_Y1;
  tubeRig.add(tubeTopCap);

  /* --- 管底的固态碘：一小堆 + 几颗碎晶。
     ★ 整堆挂在一个【以堆底为原点】的组上（iodineHeap 的 y 就是管底）：
       直接缩 mesh 的话，缩放中心在世界原点，碘堆会往上飘而不是「少下去」。 --- */
  const iodineHeap = new THREE.Group();
  iodineHeap.position.y = TUBE_Y0 + 0.16;
  tubeRig.add(iodineHeap);
  const solidIodine = new THREE.Mesh(
    new THREE.SphereGeometry(0.92, 26, 16, 0, Math.PI * 2, 0, Math.PI / 2), iodineSolidMat);
  solidIodine.scale.set(1, 0.74, 1);
  solidIodine.castShadow = true;
  iodineHeap.add(solidIodine);
  {
    const rnd = mulberry32(7711);
    for (let i = 0; i < 8; i++) {
      const g = new THREE.Mesh(new THREE.OctahedronGeometry(0.075 + rnd() * 0.055, 0), iodineSolidMat);
      const a = rnd() * Math.PI * 2, rr = rnd() * 0.62;
      g.position.set(Math.cos(a) * rr, 0.52 + rnd() * 0.12, Math.sin(a) * rr);
      g.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      iodineHeap.add(g);
    }
  }

  /* --- 碘蒸气：管内一层互相重叠的软边团块（Sprite，永远正对镜头）。
     数量/不透明度随蒸气量变。团块小而多才像「雾」；大实心球会读成一颗颗珠子。 --- */
  /* ★ 先铺一层【体积色】：管子内腔一个紫色半透明的柱面。
     只用几十个 Sprite 是撑不出「满管紫气」的 —— 20% 蒸气时画面上是几团灰斑，
     而学生要看的恰恰是「整根管子变紫了」。Sprite 退到只负责翻滚的质感。 */
  const vaporVolumeMat = new THREE.MeshBasicMaterial({
    color: '#6a12bb', transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false,
    /* ★ 不吃 ACES：碘蒸气是【吸收型着色】，过一遍影调曲线会被抬成淡紫灰，
       而学生要认的正是「深紫」—— 关掉 toneMapping 才是它本来的颜色 */
    toneMapped: false
  });
  const vaporVolume = new THREE.Mesh(
    new THREE.CylinderGeometry(TUBE_R - 0.26, TUBE_R - 0.26, TUBE_Y1 - TUBE_Y0 - 0.6, 32, 1, true),
    vaporVolumeMat);
  vaporVolume.position.y = TUBE_Y0 + 0.3 + (TUBE_Y1 - TUBE_Y0 - 0.6) / 2;
  tubeRig.add(vaporVolume);

  const vaporGroup = new THREE.Group();
  tubeRig.add(vaporGroup);
  const vapors = [];
  {
    const rnd = mulberry32(5150);
    for (let i = 0; i < 104; i++) {
      const sp = new THREE.Sprite(vaporMat.clone());
      const sz = 0.36 + rnd() * 0.42;                       // 世界单位（cm）边长
      sp.scale.set(sz, sz, 1);
      /* 幂分布：团块更靠外一圈，贴着管内壁也有气，不至于挤成中心一坨 */
      const u = rnd() * Math.PI * 2;
      const r = Math.pow(rnd(), 0.45) * (TUBE_R - 0.32);
      const yy = TUBE_Y0 + 0.75 + rnd() * (TUBE_Y1 - TUBE_Y0 - 1.1);
      sp.position.set(Math.cos(u) * r, yy, Math.sin(u) * r);
      sp.userData = { ph: rnd() * 6.28, sp: 0.25 + rnd() * 0.4, y0: yy, sz };
      vaporGroup.add(sp);
      vapors.push(sp);
    }
  }

  /* --- 凝华出的碘晶体：一层【镀在管内壁上的膜】+ 一层小晶体颗粒。
     课本上浇完冷水看到的就是管内壁那层紫黑色、有金属光泽的晶体，
     所以载体是【内壁】而不是某一块插进去的冷片 —— 整个管壁都是「最冷的面」。 --- */
  const CRYSTAL_FILM_H = TUBE_Y1 - TUBE_Y0 - 1.5;
  const crystalFilmMat = new THREE.MeshStandardMaterial({
    color: '#2c0a3a', roughness: 0.14, metalness: 0.80, envMapIntensity: 2.2,
    transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false
  });
  const crystalFilm = new THREE.Mesh(
    new THREE.CylinderGeometry(TUBE_R - 0.16, TUBE_R - 0.16, CRYSTAL_FILM_H, 36, 1, true), crystalFilmMat);
  crystalFilm.position.y = TUBE_Y0 + 0.75 + CRYSTAL_FILM_H / 2;
  tubeRig.add(crystalFilm);

  const crystalGroup = new THREE.Group();
  tubeRig.add(crystalGroup);
  const crystals = [];
  {
    const rnd = mulberry32(9090);
    for (let i = 0; i < 64; i++) {
      const r0 = 0.085 + rnd() * 0.065;
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(r0, 0), crystalMat);
      const a = rnd() * Math.PI * 2;
      const yy = TUBE_Y0 + 0.8 + Math.pow(rnd(), 0.85) * (TUBE_Y1 - TUBE_Y0 - 1.3);
      const rr = TUBE_R - 0.075;
      m.position.set(Math.cos(a) * rr, yy, Math.sin(a) * rr);
      m.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      m.userData = { k: 0.4 + rnd() * 0.6, r0 };
      m.visible = false;
      crystalGroup.add(m);
      crystals.push(m);
    }
  }

  /* --- 接水盘：浇水时接住顺着管壁流下来的水，盘里水位随浇水时长上升 --- */
  const trayGroup = new THREE.Group();
  trayGroup.position.y = BASE_H;
  rig.add(trayGroup);
  const trayWall = new THREE.Mesh(new THREE.CylinderGeometry(TRAY_R, TRAY_R, TRAY_H, 44, 1, true), glassMat);
  trayWall.position.y = TRAY_H / 2;
  trayGroup.add(trayWall);
  const trayBottom = new THREE.Mesh(new THREE.CylinderGeometry(TRAY_R, TRAY_R, 0.2, 44), glassMat);
  trayBottom.position.y = 0.1;
  trayGroup.add(trayBottom);
  const trayRim = new THREE.Mesh(new THREE.TorusGeometry(TRAY_R, 0.10, 8, 44), glassMat);
  trayRim.rotation.x = Math.PI / 2;
  trayRim.position.y = TRAY_H;
  trayGroup.add(trayRim);
  const trayWater = new THREE.Mesh(new THREE.CylinderGeometry(TRAY_R - 0.1, TRAY_R - 0.1, 1, 44), waterMat);
  trayWater.visible = false;
  trayGroup.add(trayWater);

  /* --- 浇水用的烧杯：浇热水 / 浇冷水都是它，只是杯里水的颜色不同 --- */
  const POUR_R = 2.2, POUR_H = 4.4;
  const pourBeaker = new THREE.Group();
  rig.add(pourBeaker);
  const pbWall = new THREE.Mesh(new THREE.CylinderGeometry(POUR_R, POUR_R, POUR_H, 36, 1, true), glassMat);
  pbWall.position.y = POUR_H / 2;
  pourBeaker.add(pbWall);
  const pbBottom = new THREE.Mesh(new THREE.CylinderGeometry(POUR_R, POUR_R, 0.18, 36), glassMat);
  pbBottom.position.y = 0.09;
  pourBeaker.add(pbBottom);
  const pbRim = new THREE.Mesh(new THREE.TorusGeometry(POUR_R, 0.10, 8, 36), glassMat);
  pbRim.rotation.x = Math.PI / 2;
  pbRim.position.y = POUR_H;
  pourBeaker.add(pbRim);
  const pourWaterMat = new THREE.MeshPhysicalMaterial({
    color: '#f0b49a', transparent: true, opacity: 0.5, roughness: 0.06, metalness: 0.0,
    clearcoat: 1.0, envMapIntensity: 1.6, depthWrite: false
  });
  const pbWater = new THREE.Mesh(new THREE.CylinderGeometry(POUR_R - 0.1, POUR_R - 0.1, 2.9, 36), pourWaterMat);
  pbWater.position.y = 0.18 + 1.45;
  pourBeaker.add(pbWater);
  /* 倒水时水从杯口这个点出去（每帧取它的世界坐标，杯子怎么摆都对得上） */
  const pbLip = new THREE.Object3D();
  pbLip.position.set(POUR_R * 0.95, POUR_H * 0.99, 0);
  pourBeaker.add(pbLip);

  /* 杯上那块「热水 / 冷水」标签：一眼分清现在浇的是哪一壶 */
  function makeTagTex(text, bg, fg) {
    const W = 256, H = 96;
    const c = newCanvas(W, H), g = c.getContext('2d');
    g.clearRect(0, 0, W, H);
    g.fillStyle = bg;
    roundRect(g, 8, 14, W - 16, H - 28, 22); g.fill();
    g.strokeStyle = fg; g.lineWidth = 3; roundRect(g, 8, 14, W - 16, H - 28, 22); g.stroke();
    g.fillStyle = fg; g.font = 'bold 46px "PingFang SC", "Microsoft YaHei", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, W / 2, H / 2 + 2);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const tagHot = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeTagTex('热水 78℃', 'rgba(67,20,7,0.86)', '#fdba74'), transparent: true, depthWrite: false
  }));
  tagHot.scale.set(3.4, 1.28, 1);
  tagHot.position.set(0, POUR_H + 1.5, 0);
  tagHot.visible = false;
  pourBeaker.add(tagHot);
  const tagCold = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeTagTex('冷水 8℃', 'rgba(8,47,73,0.86)', '#7dd3fc'), transparent: true, depthWrite: false
  }));
  tagCold.scale.set(3.4, 1.28, 1);
  tagCold.position.set(0, POUR_H + 1.5, 0);
  tagCold.visible = false;
  pourBeaker.add(tagCold);

  /* 烧杯的两个姿态：放在台面上（静置）/ 举到管口上方倾倒 */
  const PB_REST = { x: 15.5, y: 0, z: 6.5, rot: 0 };
  /* 倾倒位：杯口（pbLip）落在 (≈0, ≈23.8)，正好在管口正上方 2.3 cm 处 ——
     这个数是【算出来的】：lip 的局部坐标 (POUR_R*0.95, POUR_H*0.99) 绕 z 转 -0.92 rad
     后是 (4.83, 0.92)，所以原点要放在 (-5.0, 27.4)。改倾角就要重算，否则水流会歪到管外。 */
  const PB_POUR = { x: -4.83, y: 22.9, z: 0.6, rot: -0.92 };
  pourBeaker.position.set(PB_REST.x, PB_REST.y, PB_REST.z);

  /* --- 水流 + 管壁水膜 + 滴落的水珠 --- */
  const stream = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.185, 1, 12, 1, true), streamMat);
  stream.visible = false;
  rig.add(stream);
  const wetFilm = new THREE.Mesh(
    new THREE.CylinderGeometry(TUBE_R + 0.09, TUBE_R + 0.09, 1, 36, 1, true), filmMat);
  wetFilm.visible = false;
  rig.add(wetFilm);
  const drops = [];
  {
    const rnd = mulberry32(6161);
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), streamMat);
      m.userData = { l0: rnd(), sp: 0.65 + rnd() * 0.5, a: rnd() * Math.PI * 2 };
      m.visible = false;
      rig.add(m);
      drops.push(m);
    }
  }
  /* 水流方向/长度每帧现算，这里只留一个可复用的向量 */
  const _vLip = new THREE.Vector3();
  const _vTop = new THREE.Vector3(0, TUBE_TOP - 0.08, 0);
  const _vDir = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0);

  /* ==========================================================================
     四、干冰场景（烧杯 + 水 + 干冰块 + 白雾）
     ========================================================================== */
  const dryGroup = new THREE.Group();
  dryGroup.visible = false;
  rig.add(dryGroup);
  /* ★ 干冰块要比水面【高出小半截】：水位降到 2.1 cm 后水面在 18.88，
     块顶必须越过它，否则「干冰在变小」在画面上依然看不见。 */
  const dryBlock = new THREE.Mesh(new THREE.BoxGeometry(3.6, 3.0, 2.8), dryIceMat);
  dryBlock.position.set(0, BK_Y0 + 1.15, 0);
  dryBlock.rotation.y = 0.28;
  dryBlock.castShadow = true;
  dryGroup.add(dryBlock);
  const dryCrumb = [];
  {
    const rnd = mulberry32(4242);
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26 + rnd() * 0.24, 0), dryIceMat);
      m.position.set((rnd() - 0.5) * 3.6, BK_Y0 + 1.9 + rnd() * 0.5, (rnd() - 0.5) * 2.6);
      m.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      dryGroup.add(m);
      dryCrumb.push(m);
    }
  }
  /* 白雾：从杯口溢出后向下沉、贴着台面铺开 —— 这是「CO₂ 比空气重」的视觉证据。
     ★ 用软边 Sprite（和碘蒸气同一张衰减贴图）而不是实心球：
       实心球 + 硬边缘在画面上是一串肥皂泡，不是雾；软边 + 大量重叠才连成一片。 */
  const fogs = [];
  {
    const rnd = mulberry32(8181);
    for (let i = 0; i < 84; i++) {
      const m = new THREE.Sprite(fogMat.clone());
      m.visible = false;
      m.userData = { life: rnd(), sp: 0.55 + rnd() * 0.8, ph: rnd() * 6.28, seed: rnd() };
      dryGroup.add(m);
      fogs.push(m);
    }
  }

  /* ==========================================================================
     五、霜场景（冷玻璃片 + 从边缘长出的枝晶）
     ========================================================================== */
  const frostGroup = new THREE.Group();
  frostGroup.visible = false;
  rig.add(frostGroup);
  const frostStand = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.2, 5.6, 16), castIron);
  frostStand.position.set(0, 2.8, 0);
  frostStand.castShadow = true;
  frostGroup.add(frostStand);
  const frostPlate = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.34, 4.6), frostPlateMat);
  frostPlate.position.set(0, 5.75, 0);
  frostPlate.castShadow = true;
  frostGroup.add(frostPlate);
  const FROST_PW = 6.4, FROST_PD = 4.6, FROST_PY = 5.75 + 0.17;
  const branches = [];
  {
    const rnd = mulberry32(31337);
    const geo = new THREE.CylinderGeometry(0.042, 0.078, 1, 6);
    geo.translate(0, 0.5, 0);                       // 把原点挪到枝的【根部】，方便从边缘往外量长度
    const up = new THREE.Vector3(0, 1, 0);
    const N = 26;
    for (let i = 0; i < N; i++) {
      const edge = i % 4;                            // 0 左 1 右 2 前 3 后
      let x, z;
      if (edge === 0) { x = -FROST_PW / 2; z = (rnd() - 0.5) * FROST_PD; }
      else if (edge === 1) { x = FROST_PW / 2; z = (rnd() - 0.5) * FROST_PD; }
      else if (edge === 2) { x = (rnd() - 0.5) * FROST_PW; z = -FROST_PD / 2; }
      else { x = (rnd() - 0.5) * FROST_PW; z = FROST_PD / 2; }
      /* 枝【朝内】长：方向由边缘指向板心，再抬一点仰角（霜是立起来的枝晶） */
      const dir = new THREE.Vector3(-x, 0, -z).normalize();
      dir.y = 0.55 + rnd() * 0.5;
      dir.normalize();
      const m = new THREE.Mesh(geo, frostMat);
      m.position.set(x, FROST_PY, z);
      m.quaternion.setFromUnitVectors(up, dir);
      m.scale.set(1, 0.001, 1);
      m.userData = { maxLen: 1.0 + rnd() * 1.5, ph: rnd() * 6.28 };
      m.visible = false;
      frostGroup.add(m);
      branches.push(m);
    }
  }

  /* ==========================================================================
     六、生活现象场景（六个可点选的小物件）

     ★ 这一排是「现象判读」的题库，不是布景。前四个考升华/凝华，
       第五个（雾凇）把凝华从玻璃片搬到树枝上 —— 同一个机制、不同的面；
       第六个（冰棍冒白气）是【故意放进去的反例】：白气是水蒸气遇冷【液化】，
       中间出现了液态，与升华/凝华「不经过液态」正好相反。
       只放正例的话，学生容易把「冒白气」一律当成升华 —— 那正是本页要打掉的错误前概念。
     ========================================================================== */
  const LIFE = [
    { key: 'dryice', name: '干冰', ans: '升华（固→气）· 吸热。注意它周围的白雾不是二氧化碳，而是空气中的水蒸气遇冷液化',
      q: '干冰本身发生了什么物态变化？', kind: 'sub', heat: 'absorb',
      hot: { dy: 1.0, sx: 3.0, sy: 2.4, sz: 2.6 },
      why: '干冰是固态二氧化碳，直接变成二氧化碳气体 —— <b>升华</b>（固→气），吸热。'
        + '注意它周围的白雾<b>不是</b>二氧化碳，而是空气中的水蒸气遇冷<b>液化</b>成的小水珠。' },
    { key: 'camphor', name: '樟脑丸', ans: '升华（固→气）· 吸热。衣柜里的樟脑丸越来越小，全程没有液体',
      q: '樟脑丸越来越小，发生了什么物态变化？', kind: 'sub', heat: 'absorb',
      hot: { dy: 1.2, sx: 3.0, sy: 2.6, sz: 3.0 },
      why: '樟脑丸由固态直接变成气体，衣柜里闻到的气味就是它 —— <b>升华</b>（固→气），吸热。'
        + '整件东西<b>始终没有出现液体</b>。' },
    { key: 'bulb', name: '白炽灯泡', ans: '钨丝升华（固→气）+ 在玻璃泡内壁凝华（气→固）· 先吸热后放热',
      q: '用久的灯泡：钨丝变细、玻璃泡内壁发黑，钨丝发生了什么物态变化？', kind: 'sub', heat: 'absorb',
      hot: { dy: 3.2, sx: 3.0, sy: 3.0, sz: 3.0 },
      why: '钨丝先<b>升华</b>（固→气，吸热）变成钨蒸气，钨蒸气碰到较冷的玻璃泡内壁又<b>凝华</b>'
        + '（气→固，放热）成固态钨 —— 所以钨丝变细、内壁发黑。这一件里两种变化都发生了。' },
    { key: 'frost', name: '结霜的玻璃片', ans: '凝华（气→固）· 放热。水蒸气直接变成霜，不经过液态',
      q: '玻璃片上结出霜，发生了什么物态变化？', kind: 'depo', heat: 'release',
      hot: { dy: 1.86, sx: 2.8, sy: 0.7, sz: 2.2 },
      why: '空气中的水蒸气直接变成固态的霜，<b>不经过液态</b> —— <b>凝华</b>（气→固），放热。' },
    { key: 'rime', name: '雾凇', ans: '凝华（气→固）· 放热。空气中的水蒸气直接在树枝上结成冰晶，和霜是同一个机制',
      q: '树枝上挂满雾凇，发生了什么物态变化？', kind: 'depo', heat: 'release',
      hot: { dy: 2.2, sx: 2.9, sy: 3.3, sz: 1.7 },
      why: '雾凇和霜是同一个机制：空气中的水蒸气直接在树枝上<b>凝华</b>（气→固）成冰晶，放热。' },
    { key: 'popsicle', name: '冰棍冒白气', ans: '【液化】（气→液）· 放热。白气是空气中的水蒸气遇冷【变成了小水珠】—— 这里出现了液态，和升华、凝华【不是一回事】',
      q: '冰棍周围的白气是什么？发生了什么物态变化？', kind: 'liq', heat: 'release',
      hot: { dy: 2.8, sx: 2.4, sy: 3.0, sz: 2.4 },
      why: '白气是空气中的水蒸气遇冷<b>液化</b>（气→液）成的小水珠 —— 这里<b>出现了液态</b>，'
        + '和升华、凝华<b>不是一回事</b>。这一件是本页唯一的反例，它<b>放热</b>。' }
  ];

  /* 判读题的作答状态。键与 LIFE 一一对应（用 LIFE.length 建，不写死 6）：
       kind[i] / heat[i] —— 这一题选中的选项（没选 = null，不是 ''）；
       graded[i]          —— 是否已提交判分；
       ok[i]              —— 两问是否都对。 */
  state.quiz = {
    kind: LIFE.map(() => null),
    heat: LIFE.map(() => null),
    graded: LIFE.map(() => false),
    ok: LIFE.map(() => false)
  };
  const lifeGroup = new THREE.Group();
  lifeGroup.visible = false;
  rig.add(lifeGroup);
  const lifeObjects = [];
  const lifeSlots = [];         // 第 i 件对应的 Group（见下面「不按下标取」的注释）
  const lifeMist = [];          // 冰棍白气的 Sprite（唯一需要逐帧动的生活物件）
  {
    const rnd = mulberry32(6060);
    LIFE.forEach((item, i) => {
      const g = new THREE.Group();
      /* 6 件东西排一行：间距 4.2 是「最宽的那件（结霜玻璃片 2.6）不挨着」的下限，
         再密就分不清哪件是哪件；整行宽 21，life 档取景的 distK 跟着放宽到 0.44。 */
      const x = -10.5 + i * 4.2;
      g.position.set(x, 0, 2.2);
      /* hit = 射线命中的代理。多数物件本体就够大，只有雾凇（一堆细枝）
         和冰棍（细长条）本体太小、点不中，需要另给一个透明的大靶子。 */
      let head, hit = null;
      if (item.key === 'dryice') {
        head = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.0, 2.2), dryIceMat);
        head.position.y = 1.0;
      } else if (item.key === 'camphor') {
        /* 樟脑丸是一小堆，不是一颗光球 */
        head = new THREE.Mesh(new THREE.SphereGeometry(1.25, 22, 16), camphorMat);
        head.position.y = 1.3;
        [[1.15, 0.62, 0.5], [-1.05, 0.5, -0.35], [0.15, 0.44, 1.15]].forEach(([dx, r, dz]) => {
          const b = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), camphorMat);
          b.position.set(dx, r, dz);
          b.castShadow = true;
          g.add(b);
        });
      } else if (item.key === 'bulb') {
        head = new THREE.Mesh(new THREE.SphereGeometry(1.35, 24, 18), bulbGlassMat);
        head.position.y = 3.2;
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.52, 1.5, 16), chrome);
        stem.position.y = 1.7;
        g.add(stem);
        /* ★ 灯丝：白炽灯泡「钨丝升华、在玻璃泡内壁凝华」这个答案全靠它认出来。
           一颗空玻璃球和一个灯泡在画面上没有区别。 */
        const fil = new THREE.Mesh(
          new THREE.TorusGeometry(0.42, 0.045, 6, 20, Math.PI * 1.55),
          new THREE.MeshStandardMaterial({ color: '#c9a06a', roughness: 0.35, metalness: 0.85, emissive: '#3a2a12', emissiveIntensity: 0.5 })
        );
        fil.position.y = 3.15;
        fil.rotation.set(Math.PI / 2, 0, 0.6);
        g.add(fil);
        [-0.3, 0, 0.3].forEach((dy) => {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.06, 6, 18), chrome);
          ring.rotation.x = Math.PI / 2;
          ring.position.y = 2.5 + dy;
          g.add(ring);
        });
      } else if (item.key === 'rime') {
        /* 雾凇：细枝 + 迎风面上挂满霜晶。和结霜玻璃片是同一个机制（凝华），
           换的只是「载体」—— 这一项考的是「换个面还认不认得」。 */
        const woodMat = new THREE.MeshStandardMaterial({ color: '#6d5741', roughness: 0.92, metalness: 0.0 });
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.30, 3.4, 12), woodMat);
        trunk.position.y = 1.7;
        trunk.castShadow = true;
        g.add(trunk);
        const fr = mulberry32(7717);
        /* 四条斜枝。★ 霜晶必须【沿枝的轴线】取点：twig 是绕 z 转了 rot 的圆柱，
           轴上参数 s∈[-1,1] 处的点 = (dx - s·len·sin(rot), y + s·len·cos(rot))。
           符号写反的话晶体整片飘在枝外面 —— 而这在整页缩略图里几乎看不出来。
           所以把「枝的轴线」和「晶体位置」都记进 userData，供 G05 逐颗量距离。 */
        const rimeTwigs = [], rimeCrystals = [];
        [[0.95, 1.75, 0.62], [-0.90, 2.35, -0.58], [0.78, 2.95, 0.52], [-0.62, 3.28, -0.44]].forEach(([dx, y, rot]) => {
          const len = 0.95;
          const tw = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.10, len * 2, 8), woodMat);
          tw.position.set(dx, y, 0);
          tw.rotation.z = rot;
          g.add(tw);
          rimeTwigs.push({ dx, y, rot, len });
          for (let k = 0; k < 8; k++) {
            const s = -1 + (2 * k + 1) / 8;
            const c2 = new THREE.Mesh(new THREE.OctahedronGeometry(0.11 + fr() * 0.09, 0), frostMat);
            c2.position.set(
              dx - s * len * Math.sin(rot) + (fr() - 0.5) * 0.14,
              y + s * len * Math.cos(rot) + 0.12,
              (fr() - 0.5) * 0.26
            );
            c2.rotation.set(fr() * 3, fr() * 3, fr() * 3);
            g.add(c2);
            rimeCrystals.push(c2);
          }
        });
        g.userData.rimeTwigs = rimeTwigs;
        g.userData.rimeCrystals = rimeCrystals;
        head = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.20, 0.7, 10), woodMat);
        head.position.y = 3.35;
        /* 细枝点不中：另给一个透明的大靶子（opacity 0 仍参与 raycast） */
        hit = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3.9, 1.5),
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
        hit.position.y = 1.95;
        g.add(hit);
      } else if (item.key === 'popsicle') {
        /* 冰棍冒白气 —— 本排唯一的【反例】：白气是水蒸气遇冷【液化】。
           冰棍本体做小、白气做明显，学生第一眼多半答「升华」，正好用来纠错。 */
        const iceMat = new THREE.MeshStandardMaterial({ color: '#bfe0f5', roughness: 0.28, metalness: 0.0, envMapIntensity: 1.4 });
        head = new THREE.Mesh(new THREE.BoxGeometry(0.95, 2.1, 0.42), iceMat);
        head.position.y = 2.45;
        const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.1, 8),
          new THREE.MeshStandardMaterial({ color: '#c9a06a', roughness: 0.8, metalness: 0.0 }));
        stick.position.y = 0.9;
        g.add(stick);
        hit = new THREE.Mesh(new THREE.BoxGeometry(2.4, 3.6, 1.4),
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
        hit.position.y = 1.8;
        g.add(hit);
        /* 白气：软边 Sprite + 普通混合（与碘蒸气、干冰白雾共用同一张贴图），
           环绕冰棍往下飘 —— 冷空气下沉，白气跟着往下走。 */
        const mr = mulberry32(3377 + i * 41);
        for (let k = 0; k < 14; k++) {
          const mat = new THREE.SpriteMaterial({
            map: VAP_TEX, color: '#eef6fc', transparent: true,
            opacity: 0.30, depthWrite: false, blending: THREE.NormalBlending
          });
          const m = new THREE.Sprite(mat);
          /* ★ l0 必须一起写进来：updateLifeMist 里 l = (clock*0.34 + u.l0) % 1，
             漏了它 → clock*0.34 + undefined = NaN → 整团白气位置全 NaN
             （画面上表现为「白气根本不在」，而 14 个 Sprite 一个不少 —— 靠数数看不出来）。 */
          m.userData = { ph: mr() * Math.PI * 2, seed: mr(), l0: mr(), baseY: 3.4 };
          lifeMist.push(m);
          g.add(m);
        }
      } else {
        /* 结霜的玻璃片。
           ★ 这里【不能】沿用霜场景那块不透明冷灰板（#5d6874）：在霜场景里它是主体、
             深底才能衬出白霜；可搬到生活现象这一排，它被读成「一张深色小桌」——
             判读题库里认不出是哪一件，就是缺陷。所以：浅一档的板 + 一层白霜面 + 更多霜晶。 */
        const lifePlateMat = new THREE.MeshStandardMaterial({ color: '#96a3b0', roughness: 0.44, metalness: 0.32, envMapIntensity: 1.2 });
        head = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.3, 2.0), lifePlateMat);
        head.position.y = 1.5;
        /* 白霜面：贴在板的上表面，四边各内缩 0.09，免得从侧面看见一圈白边 */
        const frostTop = new THREE.Mesh(new THREE.BoxGeometry(2.42, 0.08, 1.82), frostMat);
        frostTop.position.y = 1.69;
        g.add(frostTop);
        const st = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 1.4, 14), castIron);
        st.position.y = 0.7;
        g.add(st);
        const fr = mulberry32(2402 + i * 13);
        for (let k = 0; k < 24; k++) {
          const c2 = new THREE.Mesh(new THREE.OctahedronGeometry(0.12 + fr() * 0.10, 0), frostMat);
          c2.position.set((fr() - 0.5) * 2.3, 1.80 + fr() * 0.15, (fr() - 0.5) * 1.7);
          c2.rotation.set(fr() * 3, fr() * 3, fr() * 3);
          g.add(c2);
        }
      }
      head.castShadow = true;
      g.add(head);
      const target = hit || head;
      target.userData.lifeIndex = i;
      g.userData.lifeIndex = i;
      lifeGroup.add(g);
      /* ★ 另存一份「第 i 件是哪个 Group」。原来靠 lifeGroup.children[lifePick] 取，
         那是【按下标假设】的：往 lifeGroup 里再加任何一个东西（高亮盒、坐标轴…），
         只要加在前面，全部错位 —— 而画面上完全看不出来。 */
      lifeSlots.push(g);
      lifeObjects.push(target);
    });
  }
  const lifeRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.9, 0.07, 8, 36),
    new THREE.MeshBasicMaterial({ color: '#22d3ee', transparent: true, opacity: 0.9 })
  );
  lifeRing.rotation.x = Math.PI / 2;
  lifeRing.visible = false;
  lifeGroup.add(lifeRing);

  /* 判完之后高亮的那个【部位】—— 不是整件东西。
     「变化发生在哪里」正是这几件东西的分歧点：灯泡的升华在钨丝、凝华在内壁；
     冰棍的白气在冰棍【外面】。整件一起亮等于什么都没说。 */
  const lifeHot = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: '#facc15', transparent: true, opacity: 0.2,
      depthWrite: false, side: THREE.DoubleSide })
  );
  lifeHot.visible = false;
  lifeGroup.add(lifeHot);

  /* ==========================================================================
     六点五、生活现象判读：可作答 + 判分 + 高亮（顺序 7）
     --------------------------------------------------------------------------
     这一排 6 件东西原本是「点一下就念答案」。升级成一道【两问】的判读题：
       ① 这一件里发生了哪种物态变化？② 吸热还是放热？
     两问都选了才能提交；提交后判分、给出解释，并在 3D 场景里高亮【发生变化的那个部位】。
     ★ 选项表 CHANGES / HEATS 是【独立写死】的，不从 LIFE 里推：从 LIFE 推的话，
       「某一件的正确答案根本不在选项里」这种错会被自动掩盖（选项跟着答案一起长）。
       六种物态变化全在选项里，第 2/3/4 节的应用层就是靠「在六个里挑对那一个」串起来的。
     ========================================================================== */
  const CHANGES = [
    { key: 'melt',   name: '熔化', sub: '固→液' },
    { key: 'freeze', name: '凝固', sub: '液→固' },
    { key: 'vap',    name: '汽化', sub: '液→气' },
    { key: 'liq',    name: '液化', sub: '气→液' },
    { key: 'sub',    name: '升华', sub: '固→气' },
    { key: 'depo',   name: '凝华', sub: '气→固' }
  ];
  const HEATS = [
    { key: 'absorb',  name: '吸热' },
    { key: 'release', name: '放热' }
  ];
  const QUIZ_EL = {
    group: $('quizGroup'), q: $('quizQ'), kinds: $('quizKinds'), heats: $('quizHeats'),
    submit: $('quizSubmit'), clear: $('quizClear'), result: $('quizResult'),
    score: $('quizScore'), total: $('quizTotal')
  };
  const nameOfChange = (k) => { const c = CHANGES.find((x) => x.key === k); return c ? c.name : String(k); };
  const nameOfHeat = (k) => { const h = HEATS.find((x) => x.key === k); return h ? h.name : String(k); };

  /* 选项按钮由 CHANGES / HEATS 现建 —— 页面里不写死，改选项表就自动同步。
     ★ 只在【空】的时候建：重复调用会越建越多，而画面上只是「多了一排一样的按钮」。 */
  function buildQuizChoices() {
    if (QUIZ_EL.kinds && !QUIZ_EL.kinds.children.length) {
      CHANGES.forEach((c) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.change = c.key;
        b.innerHTML = c.name + '<small>' + c.sub + '</small>';
        b.addEventListener('click', () => pickChange(c.key));
        QUIZ_EL.kinds.appendChild(b);
      });
    }
    if (QUIZ_EL.heats && !QUIZ_EL.heats.children.length) {
      HEATS.forEach((h) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.heat = h.key;
        b.textContent = h.name;
        b.addEventListener('click', () => pickHeat(h.key));
        QUIZ_EL.heats.appendChild(b);
      });
    }
  }

  const quizScore = () => state.quiz.ok.filter(Boolean).length;
  const quizAnswered = () => state.quiz.graded.filter(Boolean).length;

  function pickChange(k) {
    const i = state.lifePick;
    if (i < 0 || state.quiz.graded[i]) return false;   /* 判过分的题不许再改答案 */
    state.quiz.kind[i] = k;
    syncQuizUI(); requestRender();
    return true;
  }
  function pickHeat(k) {
    const i = state.lifePick;
    if (i < 0 || state.quiz.graded[i]) return false;
    state.quiz.heat[i] = k;
    syncQuizUI(); requestRender();
    return true;
  }
  /* 两问都选了才判。返回判分结果（true / false），没交上去返回 null ——
     三种结果分得清楚，自检才分得清「没提交」和「提交了但答错」。 */
  function submitQuiz() {
    const i = state.lifePick;
    if (i < 0) return null;
    const q = state.quiz;
    if (q.graded[i]) return q.ok[i];
    if (!q.kind[i] || !q.heat[i]) return null;
    q.graded[i] = true;
    q.ok[i] = (q.kind[i] === LIFE[i].kind && q.heat[i] === LIFE[i].heat);
    syncQuizUI(); updateVisibility(); updateReadouts(); requestRender();
    return q.ok[i];
  }
  /* 重做本题：只清当前这一件，其余几件的成绩保留 */
  function clearQuiz() {
    const i = state.lifePick;
    if (i < 0) return false;
    const q = state.quiz;
    q.kind[i] = null; q.heat[i] = null; q.graded[i] = false; q.ok[i] = false;
    syncQuizUI(); updateVisibility(); updateReadouts(); requestRender();
    return true;
  }
  function resetQuiz() {
    state.quiz.kind = LIFE.map(() => null);
    state.quiz.heat = LIFE.map(() => null);
    state.quiz.graded = LIFE.map(() => false);
    state.quiz.ok = LIFE.map(() => false);
  }

  /* 面板显隐 / 按钮态 / 文案 / 记分 —— 一律从 state.quiz 现算，不另存一份「能不能点」 */
  function syncQuizUI() {
    if (!QUIZ_EL.group) return;
    QUIZ_EL.group.hidden = state.scene !== 'life';
    const i = state.lifePick;
    const graded = i >= 0 && state.quiz.graded[i];
    if (QUIZ_EL.total) QUIZ_EL.total.textContent = String(LIFE.length);
    if (QUIZ_EL.score) QUIZ_EL.score.textContent = String(quizScore());
    if (QUIZ_EL.kinds) {
      Array.from(QUIZ_EL.kinds.children).forEach((b) => {
        const k = b.dataset.change;
        b.classList.toggle('active', i >= 0 && state.quiz.kind[i] === k);
        b.classList.remove('ok', 'bad');
        if (graded) {
          /* 判完之后：正确答案标绿，学生选错的那一个标红 —— 两个方向都标出来，
             只标对的那个的话，学生看不出自己错在哪一项。 */
          if (k === LIFE[i].kind) b.classList.add('ok');
          else if (k === state.quiz.kind[i]) b.classList.add('bad');
        }
        b.disabled = i < 0 || graded;
      });
    }
    if (QUIZ_EL.heats) {
      Array.from(QUIZ_EL.heats.children).forEach((b) => {
        const k = b.dataset.heat;
        b.classList.toggle('active', i >= 0 && state.quiz.heat[i] === k);
        b.classList.remove('ok', 'bad');
        if (graded) {
          if (k === LIFE[i].heat) b.classList.add('ok');
          else if (k === state.quiz.heat[i]) b.classList.add('bad');
        }
        b.disabled = i < 0 || graded;
      });
    }
    if (QUIZ_EL.submit) {
      QUIZ_EL.submit.disabled = i < 0 || graded
        || !state.quiz.kind[i] || !state.quiz.heat[i];
    }
    if (QUIZ_EL.q) {
      QUIZ_EL.q.innerHTML = i < 0
        ? '点击台面上的任意一个物件，开始判读。<b>其中有一个不是升华也不是凝华</b> —— 找出来。'
        : '<b>' + LIFE[i].name + '</b>：' + LIFE[i].q;
    }
    if (QUIZ_EL.result) {
      QUIZ_EL.result.innerHTML = i < 0
        ? '两问都选了才能提交。'
        : !state.quiz.graded[i]
          ? (state.quiz.kind[i] && state.quiz.heat[i]
            ? '两问都选好了，点「提交判读」。'
            : '两问都选了才能提交。')
          : (state.quiz.ok[i]
            ? '✓ 答对了。' + LIFE[i].why
            : '✗ 再想想：你选的是「' + nameOfChange(state.quiz.kind[i]) + ' · '
              + nameOfHeat(state.quiz.heat[i]) + '」，正确是「' + nameOfChange(LIFE[i].kind)
              + ' · ' + nameOfHeat(LIFE[i].heat) + '」。' + LIFE[i].why);
    }
  }

  /* 判完之后高亮的那个部位 —— 位置/尺寸全部来自 LIFE[i].hot（每件单独给，
     不按「整件东西的包围盒」算：灯泡要亮的是钨丝、冰棍要亮的是它外面的白气）。 */
  function syncLifeHot() {
    const i = state.lifePick;
    const on = state.scene === 'life' && i >= 0 && state.quiz.graded[i];
    const hot = on ? LIFE[i].hot : null;
    const g = i >= 0 ? lifeSlots[i] : null;
    lifeHot.visible = !!hot && !!g;
    if (lifeHot.visible) {
      lifeHot.position.set(g.position.x, hot.dy, g.position.z);
      lifeHot.scale.set(hot.sx, hot.sy, hot.sz);
    }
    state.drawn.hotOn = lifeHot.visible;
    state.drawn.hotIndex = lifeHot.visible ? i : -1;
    state.drawn.hotDy = hot ? hot.dy : 0;
  }

  /* ==========================================================================
     七、物理
     ========================================================================== */
  function sublimMassRate() { return K_SUB * sublimRate(state.T); }

  /* 管内在温度 T 下【能容纳】的蒸气占比。温度越高容纳越多 —— 与 sublimRate 同源，
     所以「浇热水时蒸气积得起来」和「一浇冷水就过饱和」是同一个参数决定的，不会互相打架。 */
  function fSat(T) {
    const r = sublimRate(T);
    return clamp(0.05 + 0.95 * (r / (r + K_SAT)), 0, 0.97);
  }
  /* 过饱和度：超过饱和线的那部分才凝华。冷却时 fSat 掉下来 ⇒ 立刻过饱和 ⇒ 晶体猛长 */
  function supersat() { return Math.max(0, state.mGas / M_TOTAL - fSat(state.T)); }
  function depositRate() {
    if (state.mGas <= 1e-6) return 0;
    const ss = supersat();
    if (ss <= 0) return 0;
    /* 整个管壁都是「最冷的面」，冷得越狠（过饱和越大）沉积越快 */
    return K_DEP * Math.pow(ss, 0.7);
  }
  function massSum() { return state.mSolid + state.mGas + state.mCrystal; }

  /* ★ 物理推进一律以【仿真秒】为入参（stepXxxDt），倍速只在 stepXxx 这一层乘一次。
     这样验收用的 advance(seconds) 就能精确推进 seconds 的仿真时间，与 state.speed 无关 ——
     否则「推进 30 秒」的结果会随倍速档位变化，断言就不可复现了。 */
  function stepIodineDt(dt) {
    state.t += dt;

    /* --- 管壁温度：三种情境，全是一阶响应 ---
       ① 浇热水：冲向 POUR_HOT，碘明显升华；
       ② 浇冷水：冲向 POUR_COLD，蒸气立刻过饱和、在管壁上凝华；
       ③ 取出放凉（不浇了）：慢慢回到室温，凝华得慢得多。
       ★ 「浇多久」由 pour.left 管：一壶水浇完（POUR_DUR 仿真秒）就自动转成 ③，
         不需要学生再点一次 —— 否则杯子会一直举着，和「浇完了」这个事实不符。 */
    const p = state.pour;
    if (p.left > 0) {
      p.left = Math.max(0, p.left - dt);
      const target = p.mode === 'hot' ? POUR_HOT : POUR_COLD;
      const tau = p.mode === 'hot' ? TAU_HOT : TAU_COLD;
      state.T += (target - state.T) * (1 - Math.exp(-dt / tau));
      state.poured += dt;
      if (p.left <= 0) p.mode = 'none';
    } else {
      state.T += (AMB - state.T) * (1 - Math.exp(-dt / TAU_AIR));
    }
    /* 管壁的水膜：浇水时很快湿透，之后慢慢干掉（τ ≈ 15 s） */
    const wetWant = p.left > 0 ? 1 : 0;
    state.wet += (wetWant - state.wet) * (1 - Math.exp(-dt / (wetWant ? 1.2 : 2.5)));

    /* --- 升华：固态碘 → 蒸气（不经过液态） --- */
    /* ★ 底数必须 Math.max(0, …)：守恒式写完后 mSolid 可能是 -4e-16（浮点残差），
       而 (-4e-16) ** 0.6 = NaN —— 一个负零头就能把整条曲线变成 NaN，
       在 JSON 里表现为 null，断言会「永远红」却看不出是哪儿坏了。实测踩过。 */
    const dmSub = sublimMassRate() * dt * Math.max(0, state.mSolid / M_TOTAL) ** 0.6;
    const sub = Math.min(state.mSolid, dmSub);
    state.mSolid -= sub;
    state.mGas += sub;

    /* --- 凝华：蒸气 → 管壁上的晶体 --- */
    const dep = Math.min(state.mGas, depositRate() * M_TOTAL * dt);
    state.mGas -= dep;
    state.mCrystal += dep;

    /* ★ 三份质量守恒：把浮点残差一次性补回固态碘，保证恒等式【构造性】成立 */
    state.mSolid = clamp(M_TOTAL - state.mGas - state.mCrystal, 0, M_TOTAL);

    /* ★ 全程不出现液态：这一行不是装饰 —— 它是「不经过液态」的记账入口。
       任何改法若让液态碘出现，必须改到这里，负向对照就能把它抓红。 */
    state.liquidMass = 0;

    if (state.mSolid <= 1e-4 && state.mGas >= M_TOTAL - 1e-3) state.finished = true;
  }
  const stepSim = (dtReal) => stepIodineDt(dtReal * state.speed);

  /* 开始浇一壶水。mode = 'hot' | 'cold'。重复点同一壶 = 续上（left 直接回满）。 */
  function startPour(mode) {
    if (mode !== 'hot' && mode !== 'cold') return false;
    state.pour.mode = mode;
    state.pour.left = POUR_DUR;
    state.running = true;
    /* 水色 / 标签跟着这一壶走 */
    pourWaterMat.color.set(mode === 'hot' ? '#f0b49a' : '#8fc8e8');
    tagHot.visible = mode === 'hot';
    tagCold.visible = mode === 'cold';
    updateReadouts();
    requestRender();
    return true;
  }
  /* 取出放凉：停止浇水，让它在空气里自己凉下来 */
  function takeOut() {
    state.pour.mode = 'none';
    state.pour.left = 0;
    tagHot.visible = tagCold.visible = false;
    updateReadouts();
    requestRender();
  }

  function stepDryIceDt(dt) {
    state.t += dt;
    const rate = K_DRY * (0.35 + 0.65 * (state.dryIce / DRY_ICE_M0));
    const sub = Math.min(state.dryIce, rate * dt);
    state.dryIce -= sub;
    state.fogAmt = clamp(state.fogAmt + sub / DRY_ICE_M0 * 3.4, 0, 1);
    if (state.dryIce <= 1e-3) state.finished = true;
  }
  const stepDryIce = (dtReal) => stepDryIceDt(dtReal * state.speed);

  function stepFrostDt(dt) {
    state.t += dt;
    /* 冷片一直比空气冷；空气里的水蒸气不断凝华到它上面 —— 凝华【放热】。
       速率取 logistic 形状：先慢（要等晶核长出来）、后快、再自动收住。
       ★ 第一版系数大了约 4 倍，12 s 就长满 —— 学生还没看清「从边缘开始」就结束了。 */
    const grow = (0.045 + 0.135 * state.frost) * (1 - state.frost) * dt;
    state.frost = clamp(state.frost + grow, 0, 1);
    if (state.frost >= 0.999) state.finished = true;
  }
  const stepFrost = (dtReal) => stepFrostDt(dtReal * state.speed);

  function resetSim() {
    state.running = false;
    state.t = 0;
    state.T = AMB;
    state.pour.mode = 'none'; state.pour.left = 0; state.pour.k = 0;
    state.wet = 0; state.poured = 0;
    state.mSolid = M_TOTAL; state.mGas = 0; state.mCrystal = 0; state.liquidMass = 0;
    state.dryIce = DRY_ICE_M0; state.fogAmt = 0; state.frost = 0;
    state.finished = false;
    state.lifePick = -1;
    resetQuiz();
    updateAll();
    setRunning(false);
  }

  /* ==========================================================================
     八、把状态搬到画面上
     ========================================================================== */
  function updateSolid() {
    const f = clamp(state.mSolid / M_TOTAL, 0, 1);
    iodineHeap.visible = f > 0.012;
    /* 碘堆挂在【以堆底为原点】的组上，所以这里整体缩放 = 「越少越矮越窄」，
       而不是整堆往上飘。cbrt 让「少一点点」在画面上就看得出来。 */
    const k = Math.cbrt(f);
    iodineHeap.scale.set(Math.max(0.30, k * 1.04), Math.max(0.18, k), Math.max(0.30, k * 1.04));
    state.drawn.solidFrac = +f.toFixed(4);
  }

  function updateVapor(dt) {
    const f = clamp(state.mGas / M_TOTAL, 0, 1);
    const vis = toggles.vapor && f > 0.004;
    vaporGroup.visible = vis;
    /* 普通混合是【叠】上去的：78 个团块互相覆盖，单个的不透明度必须压得低，
       否则中心立刻糊成一块实心紫色。0.04 → 0.16 是让「淡紫 → 浓紫」有层次的范围。 */
    const op = 0.07 + 0.16 * Math.pow(f, 0.5);
    /* 体积色：f = 0.2 时已经明显发紫（0.55 × 0.2^0.55 ≈ 0.23），f = 0.6 时浓到看不清管壁 */
    vaporVolume.visible = vis;
    vaporVolumeMat.opacity = clamp(2.20 * Math.pow(f, 1.30), 0, 0.90);
    /* ★ 显示比例不能直接取 f：f = 0.35（碘已经明显冒紫气了）时只画 27 个团块，
       看上去是一颗颗分开的珠子。给一个基线 0.30，让「少量蒸气」就已经是连续的一层雾，
       再多出来的量靠不透明度区分浓淡。 */
    const show = vis ? Math.max(8, Math.round((0.30 + 0.70 * f) * vapors.length)) : 0;
    vapors.forEach((m, i) => {
      m.visible = i < show;
      if (!m.visible) return;
      m.material.opacity = clamp(op * (0.55 + 0.45 * ((i % 5) / 4)), 0, 0.26);
      m.position.y = m.userData.y0 + Math.sin(clock * m.userData.sp + m.userData.ph) * 0.26
        + smoothstep(0, 0.5, f) * 0.3;
    });
    /* 蒸气浓到一定程度才「看得见紫色」—— 这个阈值也是自检的判据之一 */
    state.drawn.vaporFrac = +f.toFixed(4);
    state.drawn.vaporOpacity = +op.toFixed(4);
    state.drawn.vaporVisible = !!vis;
    state.drawn.vaporShown = show;
  }

  function updateCrystal() {
    const f = clamp(state.mCrystal / M_TOTAL, 0, 1);
    const vis = toggles.crystal && f > 0.002;
    crystalGroup.visible = vis;
    /* 管壁上那层「膜」的浓淡：f = 0.25 时已经明显能看出管壁发紫黑 */
    crystalFilm.visible = toggles.crystal && f > 0.001;
    crystalFilmMat.opacity = clamp(1.15 * Math.pow(f, 0.34), 0, 0.88);
    const show = vis ? Math.max(10, Math.round(Math.pow(f, 0.42) * crystals.length)) : 0;
    crystals.forEach((m, i) => {
      m.visible = i < show;
      if (!m.visible) return;
      const k = m.userData.k;
      const s = 1.0 + 3.6 * Math.pow(f, 0.42) * k;
      m.scale.setScalar(s);
      /* ★ 晶体是从【管内壁】往轴心方向长的：半径按 f 往里收，
         写死成常数时晶体一多就糊成一根实心柱，「长在壁上」就读不出来了。 */
      const rr = TUBE_R - 0.075 - m.userData.r0 * s * 0.3;
      const ang = Math.atan2(m.position.z, m.position.x);
      m.position.x = Math.cos(ang) * rr;
      m.position.z = Math.sin(ang) * rr;
    });
    state.drawn.crystalFrac = +f.toFixed(4);
    state.drawn.crystalVisible = !!vis;
    state.drawn.crystalShown = show;
    state.drawn.crystalFilmOpacity = +crystalFilmMat.opacity.toFixed(4);
  }

  function updateDryIce(dt) {
    const f = clamp(state.dryIce / DRY_ICE_M0, 0, 1);
    dryBlock.visible = f > 0.02;
    dryBlock.scale.setScalar(0.35 + 0.65 * Math.cbrt(f));
    dryCrumb.forEach((m, i) => { m.visible = f > 0.06 + i * 0.06; });
    const amt = state.fogAmt;
    fogs.forEach((m) => {
      m.visible = amt > 0.02;
      if (!m.visible) return;
      const u = m.userData;
      u.life += dt * u.sp * (0.35 + amt);
      if (u.life > 1) u.life -= 1;
      /* ★ 白雾【向下沉】：从杯口溢出后一路往下，最后贴着台面铺开。
         起点取杯口上方（干冰在水里翻滚，白雾从杯口涌出），终点贴台面 ——
         这条从 28 掉到 1.4 的轨迹就是「CO₂ 比空气重」的视觉证据。 */
      const l = u.life;
      const yStart = BK_Y0 + BK_H + 0.3;
      const y = yStart - l * (yStart - 1.4);
      /* ★ 白雾必须【环绕杯壁】下落，不能从杯心直上直下：
         从中心落会穿过石棉网和铁架台，看着像一根白柱子。
         起点半径就取杯口（0.85~1.2 倍杯半径），落到底再向外扩 —— 这才是
         「白雾溢出杯口、沿杯壁淌下、在台面上铺开」的样子。 */
      const ang = u.ph + l * 1.2;
      const rr = BK_R * (0.85 + 0.35 * u.seed) + l * 3.2;
      m.position.set(Math.cos(ang) * rr,
        y + Math.sin(clock * 0.9 + u.ph) * 0.16,
        Math.sin(ang) * rr);
      /* ★ 浓度曲线必须【沿下落方向保持】，不能写成以 l = 0.42 为峰的钟形：
         钟形会让雾在石棉网高度最浓、快到台面时反而快透明了 —— 正好把
         「越往下越浓」这条要教的东西讲反了。这里改成快速淡入 + 末端才淡出。 */
      const fadeIn = Math.min(1, l * 5);
      const fadeOut = 1 - smoothstep(0.82, 1.0, l);
      /* ★ 上限 0.42：台面本身就亮（实测 lum 184），雾要在它上面读出来就得够白够密。
         0.22 时实测只把台面从 184 抬到 194（+10），等于白画。 */
      m.material.opacity = clamp(0.40 * amt * fadeIn * fadeOut, 0, 0.44);
      const sz = (1.7 + l * 2.4) * (0.65 + amt * 0.5);
      m.scale.set(sz, sz, 1);
    });
    /* 白雾质心的 y（自检要卡「它确实在下沉」） */
    let sy = 0, n = 0;
    fogs.forEach((m) => { if (m.visible) { sy += m.position.y; n++; } });
    state.drawn.fogCount = n;
    state.drawn.fogMeanY = n ? +(sy / n).toFixed(3) : null;
    state.drawn.fogTopY = n ? +Math.max(...fogs.filter((m) => m.visible).map((m) => m.position.y)).toFixed(3) : null;
    state.drawn.fogAmt = +amt.toFixed(4);
    state.drawn.dryIceLeft = +state.dryIce.toFixed(4);
  }

  function updateFrost() {
    const f = state.frost;
    branches.forEach((m) => {
      m.visible = f > 0.015;
      if (!m.visible) return;
      m.scale.y = Math.max(0.001, m.userData.maxLen * Math.pow(f, 0.75));
    });
    state.drawn.frostFrac = +f.toFixed(4);
    state.drawn.frostShown = branches.filter((m) => m.visible).length;
    state.drawn.frostMaxLen = f > 0.015 ? +(Math.max(...branches.map((m) => m.scale.y))).toFixed(3) : 0;
  }

  /* --- 浇水：烧杯姿态、水流、管壁水膜、水珠、接水盘水位 ---
     ★ 全部由 state.pour / state.wet / state.poured 现算，不另存一份「动画时间」：
       暂停、改倍速、直接改状态，三种情形下画面都和物理一致。 */
  function updatePour(dt) {
    const p = state.pour;
    const want = p.left > 0 ? 1 : 0;
    p.k += (want - p.k) * clamp(dt * 4.2, 0, 1);
    if (p.k < 0.0015) p.k = 0;
    const k = p.k * p.k * (3 - 2 * p.k);          // smoothstep：起落都不生硬
    pourBeaker.position.set(
      PB_REST.x + (PB_POUR.x - PB_REST.x) * k,
      PB_REST.y + (PB_POUR.y - PB_REST.y) * k,
      PB_REST.z + (PB_POUR.z - PB_REST.z) * k
    );
    pourBeaker.rotation.z = PB_REST.rot + (PB_POUR.rot - PB_REST.rot) * k;
    /* 杯子举起来倾倒时，杯里的水画成「水位下降」比画一坨倾斜的水面干净得多 */
    pbWater.visible = k < 0.3;
    const lv = 1 - 0.45 * k;
    pbWater.scale.y = lv;
    pbWater.position.y = 0.18 + 1.45 * lv;

    /* 水流：从杯口（pbLip 的世界坐标）连到管顶 —— 杯子摆到哪儿都对得上 */
    const pouring = p.left > 0 && k > 0.72;
    stream.visible = state.scene === 'iodine' && pouring;
    if (pouring) {
      pbLip.getWorldPosition(_vLip);
      _vDir.subVectors(_vTop, _vLip);
      const len = Math.max(0.2, _vDir.length());
      stream.position.copy(_vLip).addScaledVector(_vDir, 0.5);
      stream.scale.set(1, len, 1);
      stream.quaternion.setFromUnitVectors(_up, _vDir.normalize());
      streamMat.opacity = 0.42 + 0.10 * Math.sin(clock * 22);
    }

    /* 管壁水膜：从管顶往下淌，高度跟着 wet 长 */
    const h = state.wet * (TUBE_Y1 - TUBE_Y0);
    wetFilm.visible = state.scene === 'iodine' && state.wet > 0.02;
    wetFilm.scale.set(1, Math.max(0.001, h), 1);
    wetFilm.position.y = TUBE_Y1 - h / 2;
    filmMat.opacity = clamp(0.16 * Math.min(1, state.wet * 2.4), 0, 0.16);

    /* 从管底滴进接水盘的水珠 */
    const falling = state.wet > 0.25 && state.scene === 'iodine';
    drops.forEach((m) => {
      m.visible = falling;
      if (!m.visible) return;
      const u = m.userData;
      const l = (clock * u.sp + u.l0) % 1;
      m.position.set(
        Math.cos(u.a) * (TUBE_R + 0.06),
        TUBE_Y0 - 0.1 - l * (TUBE_Y0 - 0.1 - (BASE_H + TRAY_H)),
        Math.sin(u.a) * (TUBE_R + 0.06)
      );
      m.scale.setScalar(0.7 + l * 0.6);
    });

    /* 接水盘里的水位：浇得越久越高 */
    const wh = clamp(0.05 + state.poured * 0.028, 0, TRAY_H * 0.78);
    trayWater.visible = state.poured > 0.4 && state.scene === 'iodine';
    trayWater.scale.set(1, wh, 1);
    trayWater.position.y = 0.2 + wh / 2;

    state.drawn.pourMode = p.mode;
    state.drawn.pourK = +p.k.toFixed(4);
    state.drawn.streamVisible = !!stream.visible;
    state.drawn.wet = +state.wet.toFixed(4);
    state.drawn.wetH = +h.toFixed(3);
    state.drawn.beaker = [+pourBeaker.position.x.toFixed(2), +pourBeaker.position.y.toFixed(2)];
    state.drawn.trayWater = +wh.toFixed(3);
  }

  function updateAll() {
    updateSolid();
    updateVapor(0.016);
    updateCrystal();
    updatePour(0.016);
    updateDryIce(0.016);
    updateFrost();
    updateVisibility();
    requestRender();
  }

  function updateVisibility() {
    const sc = state.scene;
    const iod = sc === 'iodine';
    /* 碘这一套器材（玻璃管 / 铁夹 / 接水盘 / 浇水烧杯）只在碘场景里出现 */
    tubeRig.visible = iod;
    clampGroup.visible = iod;
    trayGroup.visible = iod;
    pourBeaker.visible = iod;
    dryGroup.visible = sc === 'dryice';
    frostGroup.visible = sc === 'frost';
    lifeGroup.visible = sc === 'life';
    /* ★ 烧杯 + 水浴现在只剩干冰场景在用（干冰泡在水里冒白雾），
       碘场景已经改成「往管子上浇水」，不再需要水浴 —— 两套器材绝不能同时出现。 */
    beaker.visible = sc === 'dryice';
    water.visible = sc === 'dryice';
    /* ★ 干冰场景把水位降到 2.1 cm：7 cm 深的水里干冰块整个没在水下，又被白雾罩住，
       学生看不见「干冰在变小」这个核心观察量。水位是【画面量】，不影响干冰的升华速率。 */
    const wk = sc === 'dryice' ? 0.30 : 1;
    water.scale.y = wk;
    water.position.y = BK_Y0 + WATER_H * wk / 2;
    net.visible = sc === 'dryice';
    ring.visible = ringArm.visible = sc === 'dryice';
    /* 铁架台在碘/干冰两个场景里都要（碘是夹玻璃管、干冰是托烧杯） */
    rod.visible = base.visible = (iod || sc === 'dryice');
    lifeRing.visible = state.scene === 'life' && state.lifePick >= 0;
    /* ★ 取第 i 件的 Group 走 lifeSlots，不走 lifeGroup.children[i]：
       后者是「按下标假设」的写法，往 lifeGroup 里再加任何东西都可能让它错位。 */
    const slot = lifeSlots[state.lifePick];
    if (slot) lifeRing.position.set(slot.position.x, 0.12, slot.position.z);
    syncLifeHot();
    syncQuizUI();
    state.drawn.scene = sc;
  }

  /* ==========================================================================
     九、2D 插图：微观分子（数据曲线与记录表已按用户要求移除，本页只观察现象）
     ========================================================================== */
  function fitCanvas2D(cv, ctx) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return null;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h };
  }

  const microCanvas = $('microCanvas');
  const microCtx = microCanvas.getContext('2d');
  let microEscape = 0;

  function microStats() {
    return {
      escape: +microEscape.toFixed(3),
      gasFrac: +(state.mGas / M_TOTAL).toFixed(4),
      rate: +sublimRate(state.T).toFixed(4),
      liquidMass: state.liquidMass
    };
  }

  function drawMicro(dt) {
    const s = fitCanvas2D(microCanvas, microCtx);
    if (!s) return;
    const g = microCtx, W = s.w, H = s.h;
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#0a1a2b'; g.fillRect(0, 0, W, H);

    const gasFrac = clamp(state.mGas / M_TOTAL, 0, 1);
    const rate = clamp(sublimRate(state.T) / sublimRate(90), 0, 1);
    microEscape += ((state.running ? rate : 0) - microEscape) * clamp(dt * 3, 0, 1);
    microEscape = clamp(microEscape, 0, 1);

    /* 固态碘的晶格（规则排列）。已升华掉的那部分晶格位置【留一个空位】，
       一眼就能看出「分子是从晶格里少掉的」，而不是「整块整体缩小」。 */
    const cols = 9, rows = 4;
    const gx = W / (cols + 1), gy = 13;
    const baseY = H - 12;
    const goneFrac = clamp(1 - state.mSolid / M_TOTAL, 0, 1) * 0.85;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = gx * (c + 1);
        const y = baseY - r * gy;
        const gone = (r * cols + c) / (rows * cols) < goneFrac;
        g.fillStyle = gone ? 'rgba(139,92,246,0.10)' : 'rgba(139,92,246,0.92)';
        g.beginPath(); g.arc(x, y, 4.4, 0, Math.PI * 2); g.fill();
        if (!gone) {
          g.strokeStyle = 'rgba(196,181,253,0.55)'; g.lineWidth = 0.8;
          g.beginPath(); g.arc(x, y, 4.4, 0, Math.PI * 2); g.stroke();
        }
      }
    }
    /* 已经逃逸到空中的分子（气态）—— 它们是【直接从晶格飞出去的】，没有经过液态 */
    const n = Math.round(microEscape * 16);
    for (let i = 0; i < n; i++) {
      const u = ((i * 97) % 100) / 100;
      const v = ((i * 53) % 100) / 100;
      const x = 12 + u * (W - 24);
      const y = 8 + v * (H * 0.52) + Math.sin(clock * 1.4 + i) * 2.2;
      g.fillStyle = `rgba(196,181,253,${0.5 + 0.4 * (1 - v)})`;
      g.beginPath(); g.arc(x, y, 3.4, 0, Math.PI * 2); g.fill();
    }
    /* 没有液态层 —— 底部【不画任何液面】，这本身就是「不经过液态」的视觉证据 */
    g.strokeStyle = 'rgba(56,189,248,0.30)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(6, baseY + 9); g.lineTo(W - 6, baseY + 9); g.stroke();

    const mt = $('microText');
    if (mt) {
      mt.textContent = state.scene !== 'iodine'
        ? '这一场景的微观过程与碘管相同：分子在固态与气态之间直接转换，没有液态。'
        : (state.mGas / M_TOTAL < 0.01
          ? '固态碘的分子规则地排在晶格里，只在原位振动。'
          : `受热后个别分子动能够大，直接从晶格【飞出去】变成气态 —— 中间没有液态这一步。现在有 ${(state.mGas / M_TOTAL * 100).toFixed(0)}% 的碘在气态。`);
    }
  }

  /* ==========================================================================
     十、读数
     ========================================================================== */
  /* 读数只留「观察要用的那两个」：管内温度和当前阶段。
     记录表、质量占比、曲线全部按用户要求删掉了 —— 这一页只看现象。 */
  const els = {
    hudTemp: $('hudTemp'), phase: $('stagePhase'), finding: $('finding')
  };

  function sceneName() {
    return { iodine: '碘的升华与凝华', dryice: '干冰', frost: '霜', life: '生活现象' }[state.scene];
  }
  function statusText() {
    if (state.scene === 'dryice') {
      if (state.dryIce <= 1e-3) return '干冰已全部升华';
      return state.fogAmt > 0.05 ? '干冰升华中 · 白雾下沉' : '干冰待升华';
    }
    if (state.scene === 'frost') {
      if (state.frost >= 0.999) return '霜已长满';
      return state.frost > 0.02 ? '水蒸气凝华成霜' : '等待凝华';
    }
    if (state.scene === 'life') return state.lifePick < 0 ? '请点击一个物件' : LIFE[state.lifePick].name;
    /* 碘：先把「正在干什么」说清楚，再说现象 */
    if (state.pour.left > 0) {
      return state.pour.mode === 'hot' ? '正在浇热水 · 碘升华' : '正在浇冷水 · 碘凝华';
    }
    if (state.mCrystal / M_TOTAL > 0.03) {
      return state.mGas / M_TOTAL > 0.08 ? '管壁凝华中（气→固）' : '管内壁已凝华出晶体';
    }
    if (state.mSolid <= 1e-4) return '固态碘已全部升华';
    if (state.mGas / M_TOTAL > 0.02) return '管内充满紫色碘蒸气';
    return '固态碘 · 等待浇热水';
  }
  function shortState() {
    if (state.scene === 'dryice') return state.fogAmt > 0.05 ? '白雾下沉' : '升华中';
    if (state.scene === 'frost') return state.frost > 0.02 ? '凝华成霜' : '待凝华';
    if (state.scene === 'life') return state.lifePick < 0 ? '未选择' : LIFE[state.lifePick].name;
    if (state.pour.left > 0) return state.pour.mode === 'hot' ? '浇热水中' : '浇冷水中';
    if (state.mSolid <= 1e-4) return '升华完';
    if (state.mCrystal / M_TOTAL > 0.02) return '已凝华';
    if (state.mGas / M_TOTAL > 0.02) return '有碘蒸气';
    return '未升华';
  }

  function updateReadouts() {
    els.hudTemp.textContent = state.T.toFixed(1);
    state.drawn.hudTemp = +state.T.toFixed(2);
    state.drawn.phase = statusText();
    if (els.phase) els.phase.textContent = statusText();

    let hint;
    if (state.scene === 'life') {
      const i = state.lifePick;
      hint = i < 0
        ? '点击台面上的任意一个物件，判断它属于哪种物态变化、是吸热还是放热。<b>其中有一个不是升华也不是凝华</b> —— 找出来，说说为什么。'
        : `<b>${LIFE[i].name}</b>：${LIFE[i].q} 在左边「现象判读」里选答案，两问都选了才能提交。`
          + (state.quiz.graded[i] ? `<br>${LIFE[i].ans}。` : '');
    } else if (state.scene === 'dryice') {
      hint = state.dryIce <= 1e-3
        ? '干冰已经全部升华完。注意白雾一直<b>贴着台面往下沉</b> —— 因为二氧化碳比空气重，而且它升华时吸走了周围的热，让空气中的水蒸气液化成小水珠，所以白雾不是二氧化碳本身。'
        : `干冰升华吸热，把周围空气里的水蒸气夺走热量、液化成小水珠，就是我们看到的<b>白雾</b>。白雾之所以往下沉，是因为二氧化碳比空气重 —— 盯住它，看它是不是一直往下走。`;
    } else if (state.scene === 'frost') {
      hint = `水蒸气直接凝华成<b>霜</b>，<b>不经过液态</b>。注意霜是<b>从玻璃片的边缘和划痕开始长</b>的 —— 那些地方最先冷下来，枝晶从那里朝里伸。凝华会<b>放热</b>。`;
    } else if (state.pour.left > 0 && state.pour.mode === 'hot') {
      hint = `热水顺着管壁流下来，管内温度升到 ${state.T.toFixed(0)} ℃。盯住管底那堆碘：它在<b>一点点变小</b>，而管里腾起<b>紫色蒸气</b> —— 中间<b>没有一滴液体</b>。这就是<b>升华</b>：固态直接变成气态。`;
    } else if (state.pour.left > 0 && state.pour.mode === 'cold') {
      hint = `冷水一浇，管壁温度掉到 ${state.T.toFixed(0)} ℃，紫色蒸气迅速<b>变淡</b>，管内壁上出现一层<b>紫黑色、有金属光泽的晶体</b> —— 蒸气<b>直接</b>变回固态，这就是<b>凝华</b>，同样不经过液态。`;
    } else if (state.mCrystal / M_TOTAL > 0.03) {
      hint = `管壁上已经结了 ${(state.mCrystal / M_TOTAL * 100).toFixed(0)}% 的碘晶体。<b>浇冷水</b>凝华得快，<b>取出来放凉</b>凝华得慢 —— 但两条路都是<b>气 → 固</b>，中间<b>一滴液体都没有</b>。想再看一次升华，就再浇一壶热水。`;
    } else if (state.mGas / M_TOTAL > 0.02) {
      hint = `管内是<b>紫色碘蒸气</b>（已升华 ${(state.mGas / M_TOTAL * 100).toFixed(0)}%）。现在点<b>「浇冷水」</b>看它凝华，或者点<b>「取出放凉」</b>让它在空气里慢慢凉下来 —— 两种情形都会凝华，只是快慢不同。`;
    } else {
      hint = `管底是<b>紫黑色固态碘</b>，温度 ${state.T.toFixed(1)} ℃，还没明显升华。点<b>「浇热水」</b>：热水顺着管壁流下去，管内温度升高，碘就会直接变成紫色蒸气。`;
    }
    els.finding.innerHTML = hint;
    state.drawn.hintScene = state.scene;
  }

  /* ==========================================================================
     十一、动画
     ========================================================================== */
  let dirty = true;
  const requestRender = () => { dirty = true; };
  let clock = 0;

  /* 冰棍白气：环绕冰棍往下飘。只在生活场景里跑 —— 别的场景白白算 14 个 Sprite 没意义，
     而且「只在那一档动」本身也是可断言的（见 G02）。 */
  function updateLifeMist() {
    if (state.scene !== 'life') return;
    lifeMist.forEach((m) => {
      const u = m.userData;
      const l = (clock * 0.34 + u.l0) % 1;
      const rr = 0.62 + 0.42 * u.seed + l * 1.7;
      const ang = u.ph + l * 0.9;
      m.position.set(
        Math.cos(ang) * rr,
        u.baseY - l * 3.1 + Math.sin(clock * 1.1 + u.ph) * 0.10,
        Math.sin(ang) * rr
      );
      const fadeIn = Math.min(1, l * 5);
      const fadeOut = 1 - smoothstep(0.80, 1.0, l);
      m.material.opacity = clamp(0.42 * fadeIn * fadeOut, 0, 0.46);
      const sz = 0.62 + l * 1.45;
      m.scale.set(sz, sz, 1);
    });
  }

  function animateParts(dt) {
    clock += dt;
    /* 判读高亮盒：缓慢呼吸。不呼吸的话，一个半透明的黄盒子贴在深色器材上
       很容易被当成「材质渲染错了」；呼吸起来才一眼看出是「这里在闪」。
       ★ 记进 state.drawn —— 自检读的是【真正画出去的那个透明度】，不是意图值。 */
    if (lifeHot.visible) {
      lifeHot.material.opacity = 0.16 + 0.14 * (0.5 + 0.5 * Math.sin(clock * 3.4));
      state.drawn.hotOpacity = +lifeHot.material.opacity.toFixed(4);
      /* 生活场景里没有别的东西会把画面标脏 ⇒ 呼吸就看不见了。自己标脏，保证每帧都重画。 */
      dirty = true;
    } else {
      state.drawn.hotOpacity = 0;
    }

    updateVapor(dt);
    updatePour(dt);
    updateDryIce(dt);
    updateLifeMist();
    state.drawn.clock = +clock.toFixed(3);
  }

  /* ==========================================================================
     十二、相机与交互
     ========================================================================== */
  /* ★ 取景必须【按场景】给：霜场景的主体在台面上（板面 y ≈ 5.9）、生活场景是一排小物件，
     沿用碘管那套取景，主体会缩在画面一角、大片空白。
     这是「取景包络要覆盖所有模式」那条坑的同一形态 —— 一档取景套所有场景必然有一档是废的。 */
  function sceneFrame() {
    const sc = state.scene;
    if (sc === 'frost') return { ty: FROST_PY + 1.4, distK: 0.30, pitchK: 0.85 };
    /* 生活现象：6 件排一行、总宽 21（原 4 件是 16.8）⇒ distK 0.36 → 0.44，
       不然换行后两头的雾凇和冰棍会顶出画布 —— 「加宽了排面却没跟着放宽取景」是同一条坑。 */
    if (sc === 'life') return { ty: 2.5, distK: 0.44, pitchK: 0.75 };
    return { ty: view.ty, distK: 1, pitchK: 1 };
  }

  function updateCamera() {
    const F = sceneFrame();
    const t = new THREE.Vector3(0, F.ty, 0);
    const pitch = view.pitch * F.pitchK;
    const dist = view.dist * F.distK;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    camera.position.set(
      t.x + dist * cp * Math.sin(view.yaw),
      t.y + dist * sp,
      t.z + dist * cp * Math.cos(view.yaw)
    );
    camera.lookAt(t);
    requestRender();
  }

  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    requestRender();
  }

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  function pickLife(clientX, clientY) {
    if (state.scene !== 'life') return false;
    const r = canvas.getBoundingClientRect();
    ndc.x = ((clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(lifeObjects, false);
    if (!hits.length) return false;
    state.lifePick = hits[0].object.userData.lifeIndex;
    updateVisibility();
    updateReadouts();
    /* 点了物件就把左侧判读面板自动展开 —— 学生不用再去找那个小按钮 */
    setQuizOpen(true);
    requestRender();
    return true;
  }

  let dragging = false, lastX = 0, lastY = 0, downX = 0, downY = 0;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    downX = e.clientX; downY = e.clientY;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = (e.clientX - lastX) / Math.max(canvas.clientWidth, 1);
    const dy = (e.clientY - lastY) / Math.max(canvas.clientHeight, 1);
    lastX = e.clientX; lastY = e.clientY;
    view.yaw -= dx * 2.9;
    view.pitch = clamp(view.pitch + dy * 2.2, -0.10, 1.36);
    updateCamera();
  });
  const endDrag = (e) => {
    const moved = Math.hypot((e.clientX || 0) - downX, (e.clientY || 0) - downY);
    dragging = false;
    canvas.style.cursor = 'grab';
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    /* 位移很小才算「点击」—— 免得拖动环绕时误触发点选 */
    if (moved < 6) pickLife(e.clientX, e.clientY);
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', () => { dragging = false; canvas.style.cursor = 'grab'; });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    view.dist = clamp(view.dist * (1 + Math.sign(e.deltaY) * 0.08), 20, 180);
    updateCamera();
  }, { passive: false });

  document.querySelectorAll('[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => { setView(btn.dataset.view); });
  });

  /* ==========================================================================
     十三、控件
     ========================================================================== */
  /* ★ 碘场景没有「开始 / 暂停」：浇一壶水就是操作，其余时间它自己慢慢凉。
     只有干冰 / 霜两个场景需要「开始」按钮。 */
  function setRunning(v) {
    state.running = !!v;
    if (state.running) state.finished = false;
    syncDock();
    updateVisibility();
    updateReadouts();
    requestRender();
  }

  /* 底部操作条：碘场景是三个浇水按钮，干冰/霜是一个「开始」按钮，生活现象是一行提示 */
  function syncDock() {
    const sc = state.scene;
    const iod = sc === 'iodine';
    const runnable = sc === 'dryice' || sc === 'frost';
    const dIod = $('dockIodine'), dRun = $('runBtn'), dLife = $('dockLife');
    if (dIod) dIod.hidden = !iod;
    if (dRun) {
      dRun.hidden = !runnable;
      dRun.textContent = state.running ? '⏸ 暂停' : (sc === 'dryice' ? '▶ 开始升华' : '▶ 开始结霜');
    }
    if (dLife) dLife.hidden = sc !== 'life';
    const nm = $('stageScene');
    if (nm) nm.textContent = sceneName();
    const hot = $('pourHotBtn'), cold = $('pourColdBtn');
    const pouring = state.pour.left > 0;
    if (hot) hot.classList.toggle('active', pouring && state.pour.mode === 'hot');
    if (cold) cold.classList.toggle('active', pouring && state.pour.mode === 'cold');
  }

  function applySceneUI() {
    document.querySelectorAll('[data-scene]').forEach((b) => b.classList.toggle('active', b.dataset.scene === state.scene));
    syncDock();
  }
  function setScene(key) {
    if (state.scene === key) return;
    state.scene = key;
    state.lifePick = -1;
    state.finished = false;
    /* 换场景 = 换一套器材，上一场景的「正在浇水」不能带过来 */
    state.pour.mode = 'none'; state.pour.left = 0;
    tagHot.visible = tagCold.visible = false;
    if (key === 'iodine') state.running = true; else state.running = false;
    applySceneUI();
    updateVisibility();
    updateAll();
    /* ★ 换场景必须【重新取景】：各场景的主体高度差了一个量级（玻璃管在 y≈19，
       霜的冷板在 y≈5.9，生活小物件在 y≈2.4），不重取景主体就缩在画面一角。 */
    updateCamera();
    updateReadouts();
  }
  document.querySelectorAll('[data-scene]').forEach((b) => b.addEventListener('click', () => setScene(b.dataset.scene)));

  const pHot = $('pourHotBtn'), pCold = $('pourColdBtn'), tOut = $('takeOutBtn');
  if (pHot) pHot.addEventListener('click', () => { startPour('hot'); syncDock(); });
  if (pCold) pCold.addEventListener('click', () => { startPour('cold'); syncDock(); });
  if (tOut) tOut.addEventListener('click', () => { takeOut(); syncDock(); });
  const resetBtn = $('resetBtn');
  if (resetBtn) resetBtn.addEventListener('click', () => { resetSim(); syncDock(); updateReadouts(); });
  const runBtnEl = $('runBtn');
  if (runBtnEl) runBtnEl.addEventListener('click', () => setRunning(!state.running));

  document.querySelectorAll('[data-speed]').forEach((b) => {
    b.addEventListener('click', () => {
      state.speed = Number(b.dataset.speed) || 1;
      document.querySelectorAll('[data-speed]').forEach((x) => x.classList.toggle('active', x === b));
    });
  });
  const tgl = (id, key) => {
    const el = $(id);
    if (!el) return;
    el.checked = toggles[key];
    el.addEventListener('change', () => {
      toggles[key] = el.checked;
      updateAll();
    });
  };
  tgl('toggleVapor', 'vapor');
  tgl('toggleCrystal', 'crystal');
  tgl('toggleMicro', 'micro');

  /* 现象判读：选项按钮由 CHANGES / HEATS 现建；提交 / 重做两个动作走函数，不走按钮文案 */
  buildQuizChoices();
  if (QUIZ_EL.submit) QUIZ_EL.submit.addEventListener('click', () => { submitQuiz(); });
  if (QUIZ_EL.clear) QUIZ_EL.clear.addEventListener('click', () => { clearQuiz(); });
  syncQuizUI();

  /* ==========================================================================
     十四、步骤（本页不记录数据，只按真实操作顺序把现象串起来）
     ========================================================================== */
  const STEPS = [
    { name: '01 认识器材', text: '<strong>认识器材：</strong>铁架台的<b>铁夹</b>夹着一支<b>两端封闭的玻璃管</b>，管底沉着少量<b>紫黑色碘颗粒</b>，管下摆一个<b>接水盘</b>，旁边是一只烧杯 —— 往管子上浇水用。管里<b>没有水、也没有别的液体</b>，只有碘。' },
    { name: '02 浇热水：升华', text: '<strong>浇热水：</strong>点「浇热水」，热水顺着管壁流下去，管内温度升到约 45 ℃ 以上，碘颗粒<b>一点点变小</b>，管里腾起<b>紫色蒸气</b>。盯住管里 —— <b>始终没有一滴液体</b>。这就是<b>升华</b>：固态<b>直接</b>变成气态，<b>不经过液态</b>。' },
    { name: '03 浇冷水：凝华', text: '<strong>浇冷水：</strong>点「浇冷水」，管壁一下子冷下来，紫色蒸气迅速变淡，管内壁上出现一层<b>紫黑色、有金属光泽的晶体</b> —— 蒸气<b>直接</b>变回固态，这是<b>凝华</b>（气→固），同样<b>不经过液态</b>。晶体长在<b>最冷的管壁</b>上。' },
    { name: '04 取出来放凉：也会凝华', text: '<strong>取出放凉：</strong>不浇冷水，改点「取出放凉」，让管子泡在空气里自己慢慢凉。<b>照样会凝华</b> —— 只是慢得多，晶体是<b>一点点</b>长出来的。所以「凝华」不一定要用冰水逼：<b>只要蒸气冷到饱和以下，就会直接变回固态</b>。' },
    { name: '05 干冰与白雾', text: '<strong>干冰：</strong>切到「干冰」场景。干冰是固态二氧化碳，常温下直接升华成气体。<b>白雾往下沉</b>，不是往上飘 —— 因为二氧化碳比空气重；而且白雾是干冰<b>吸热</b>把空气中水蒸气液化出来的小水珠，<b>不是二氧化碳本身</b>。' },
    { name: '06 霜与凝华放热', text: '<strong>霜：</strong>切到「霜」场景。空气中的水蒸气直接在冷玻璃片上<b>凝华</b>成霜，<b>从边缘和划痕开始长</b>（那里最先冷下来），枝晶朝里伸。霜、雾凇、雪都是这样形成的；凝华和升华相反，是<b>放热</b>的。' },
    { name: '07 生活现象判读', text: '<strong>判读（要作答）：</strong>切到「生活现象」场景，六件东西一件件点过去，在左边「现象判读」里各选<b>两问</b>：这一件属于<b>六种物态变化里的哪一种</b>、是<b>吸热还是放热</b>。两问都选了才能提交，提交后会在 3D 场景里<b>高亮发生变化的那个部位</b>（灯泡亮的是钨丝，冰棍亮的是它外面的白气）。<br>干冰、樟脑丸、白炽灯泡是<b>升华</b>（固→气，吸热），结霜的玻璃片、雾凇是<b>凝华</b>（气→固，放热）。<b>但「冰棍冒白气」不是</b> —— 那是空气中的水蒸气遇到冰棍<b>液化</b>成的小水珠，中间<b>出现了液态</b>。把「冒白气」一律当成升华，是最常见的前概念错误。' }
  ];
  const stepButtons = Array.from(document.querySelectorAll('[data-step]'));
  const stepDetail = $('stepDetail');
  function showStep(i) {
    state.step = i;
    stepButtons.forEach((b, k) => b.classList.toggle('active', k === i));
    if (stepDetail) stepDetail.innerHTML = STEPS[i].text;
  }
  stepButtons.forEach((b, i) => b.addEventListener('click', () => showStep(i)));
  showStep(0);

  /* ==========================================================================
     十四点五、实验画面全屏 + 舞台内的两个折叠面板
     --------------------------------------------------------------------------
     全屏目标取【整个舞台】：操作条、观察提示、微观示意、设置面板全是 .stage 的后代，
     所以进了全屏照样能浇水、能换场景，不用退出来再按。
     ★ 面板必须是 .stage 的子元素 —— 全屏只渲染全屏元素及其子树，挂在 body 下的浮层
       进全屏就【根本不存在】。z-index：面板 8、全屏按钮 9，按钮永远压在上面点得到。
     ========================================================================== */
  const stageBox = $('stage');
  const fsBtn = $('fsBtn');
  const fsIsOn = () => document.fullscreenElement === stageBox
    || document.webkitFullscreenElement === stageBox;
  let fsLayouts = 0;                       // 每次切换实际重排了几次（自检要它 ≥ 2）
  function fsLayout() {
    resize();
    drawMicro(0.016);
    renderer.render(scene, camera);
    dirty = false;
    fsLayouts++;
  }
  if (fsBtn) {
    fsBtn.addEventListener('click', () => {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      } else if (stageBox.requestFullscreen) {
        stageBox.requestFullscreen();
      } else if (stageBox.webkitRequestFullscreen) {
        stageBox.webkitRequestFullscreen();
      }
    });
  }
  function onFsChange() {
    const on = fsIsOn();
    if (fsBtn) {
      const ex = fsBtn.querySelector('.fs-expand'), cp = fsBtn.querySelector('.fs-compress'),
            lb = fsBtn.querySelector('.lbl');
      if (ex) ex.style.display = on ? 'none' : '';
      if (cp) cp.style.display = on ? '' : 'none';
      if (lb) lb.textContent = on ? '退出' : '全屏';
      fsBtn.title = on ? '退出全屏' : '全屏显示实验画面';
      fsBtn.setAttribute('aria-label', fsBtn.title);
    }
    /* ★ 立刻 + 晚一帧 + setTimeout 兜底各重排一次：UA 的 :fullscreen 样式在个别浏览器里
       要下一帧才落到布局上，只重排一次会拿到切换过程中的中间尺寸（画布被拉变形）；
       headless 里 rAF 还可能一次都不回调。 */
    fsLayout();
    requestAnimationFrame(() => requestAnimationFrame(fsLayout));
    setTimeout(fsLayout, 90);
  }
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);

  /* --- 设置面板：默认收起，收起时只占舞台不到 2% 的面积 --- */
  const paramsBox = $('params'), paramsHead = $('paramsHead'),
        paramsToggle = $('paramsToggle'), paramsBody = $('paramsBody');
  const paramsIsOpen = () => !!paramsBox && !paramsBox.classList.contains('collapsed');
  function setParamsOpen(on) {
    if (!paramsBox) return;
    paramsBox.classList.toggle('collapsed', !on);
    if (paramsToggle) {
      paramsToggle.setAttribute('aria-expanded', on ? 'true' : 'false');
      paramsToggle.textContent = on ? '▾ 收起' : '▸ 展开';
      paramsToggle.title = on ? '收起设置面板' : '展开设置面板';
    }
    dirty = true;
  }
  if (paramsBox) {
    if (paramsToggle) {
      paramsToggle.addEventListener('click', (e) => { e.stopPropagation(); setParamsOpen(!paramsIsOpen()); });
    }
    if (paramsHead) {
      paramsHead.addEventListener('click', (e) => {
        if (e.target.closest && e.target.closest('#paramsToggle')) return;
        setParamsOpen(!paramsIsOpen());
      });
    }
    /* 面板压在画布上方：把指针事件拦住，免得点面板被当成「开始拖动场景」 */
    paramsBox.addEventListener('pointerdown', (e) => e.stopPropagation());
    paramsBox.addEventListener('pointerup', (e) => e.stopPropagation());
    paramsBox.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    setParamsOpen(false);
  }

  /* --- 现象判读面板：只在「生活现象」场景出现，点中物件时自动展开 --- */
  const quizBox = $('quizGroup'), quizHead = $('quizHead'), quizToggle = $('quizToggle');
  const quizIsOpen = () => !!quizBox && !quizBox.classList.contains('collapsed');
  function setQuizOpen(on) {
    if (!quizBox) return;
    quizBox.classList.toggle('collapsed', !on);
    if (quizToggle) {
      quizToggle.setAttribute('aria-expanded', on ? 'true' : 'false');
      quizToggle.textContent = on ? '▾ 收起' : '▸ 展开';
    }
    dirty = true;
  }
  if (quizBox) {
    if (quizToggle) quizToggle.addEventListener('click', (e) => { e.stopPropagation(); setQuizOpen(!quizIsOpen()); });
    if (quizHead) {
      quizHead.addEventListener('click', (e) => {
        if (e.target.closest && e.target.closest('#quizToggle')) return;
        setQuizOpen(!quizIsOpen());
      });
    }
    quizBox.addEventListener('pointerdown', (e) => e.stopPropagation());
    quizBox.addEventListener('pointerup', (e) => e.stopPropagation());
    quizBox.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    setQuizOpen(false);
  }

  /* ==========================================================================
     十五、启动
     ========================================================================== */
  canvas.style.cursor = 'grab';
  resetSim();
  /* ★ 碘场景常开：温度、水膜、自然冷却都是随时间走的，没有「开始」按钮 */
  state.running = true;
  applySceneUI();
  updateCamera();
  resize();
  updateReadouts();

  let uiAcc = 0;
  function frameStep(dt) {
    animateParts(dt);

    if (state.scene === 'iodine') {
      stepSim(dt);
      updateSolid();
      updateCrystal();
    } else if (state.running && !state.finished) {
      if (state.scene === 'dryice') stepDryIce(dt);
      else if (state.scene === 'frost') stepFrost(dt);
      updateSolid();
      updateCrystal();
      updateFrost();
      if (state.finished) setRunning(false);
    }

    uiAcc += dt;
    if (uiAcc >= 0.1) {
      uiAcc = 0;
      drawMicro(Math.max(dt, 0.016));
      updateReadouts();
      syncDock();
      dirty = true;
    }
    if (dirty) { renderer.render(scene, camera); dirty = false; }
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

  const ro = new ResizeObserver(() => { resize(); drawMicro(0.016); });
  ro.observe(stage);
  window.addEventListener('resize', () => { resize(); drawMicro(0.016); });

  /* ==========================================================================
     十六、供无头验收脚本读取
     ========================================================================== */
  window.__subLab = {
    state, view, VIEWS, toggles, LIFE,
    camera, renderer, scene,
    /* 碘这一套（玻璃管 / 铁夹 / 接水盘 / 浇水烧杯 / 蒸气 / 晶体） */
    tubeRig, clampGroup, trayGroup, trayWater, pourBeaker, pbWater, pbLip,
    iodineHeap, solidIodine, vaporGroup, vapors, vaporVolume, vaporVolumeMat, crystalGroup, crystals, crystalFilm, crystalFilmMat, tubeGlassMat,
    stream, wetFilm, drops, tagHot, tagCold,
    dryGroup, dryBlock, fogs, frostGroup, frostPlate, branches, lifeGroup, lifeObjects, lifeMist,
    water,
    M_TOTAL, T_SUB_START, SUB_RATE_ON, T_REF, L_OVER_R, K_SAT, WATER_TOP,
    TUBE_R, TUBE_Y0, TUBE_Y1, TUBE_TOP, CLAMP_Y, IODINE_Y, TRAY_R, TRAY_H,
    POUR_HOT, POUR_COLD, POUR_DUR, TAU_HOT, TAU_COLD, TAU_AIR, PB_REST, PB_POUR,
    BK_Y0, BK_H, FROST_PY,
    sublimRate, sublimStartT, fSat, supersat, depositRate, sublimMassRate, massSum,
    setRunning, setScene, resetSim, updateAll, updateVisibility, updateCamera, setView,
    startPour, takeOut, syncDock, updatePour,
    drawMicro, microStats, updateReadouts,
    statusText, shortState, pickLife,
    /* 全屏 / 折叠面板：自检要能直接问到「按钮在不在、点了进不进全屏、面板是不是舞台的后代」 */
    stageBox, fsBtn, fsIsOn, fsLayouts: () => fsLayouts,
    paramsBox, paramsBody, paramsIsOpen, setParamsOpen,
    quizBox, quizIsOpen, setQuizOpen,
    /* 现象判读（顺序 7）：选项表、判分、高亮盒 —— 全部原样交出去，
       自检不自己重抄一份选项表或正确答案（自抄一份就变成「两边各写一遍」的盲点）。 */
    CHANGES, HEATS, lifeSlots, lifeHot,
    pickChange, pickHeat, submitQuiz, clearQuiz, resetQuiz, syncQuizUI, syncLifeHot,
    quizScore, quizAnswered, buildQuizChoices, QUIZ_EL,
    quizInfo() {
      const i = state.lifePick;
      const kids = QUIZ_EL.kinds ? Array.from(QUIZ_EL.kinds.children) : [];
      const hts = QUIZ_EL.heats ? Array.from(QUIZ_EL.heats.children) : [];
      const keysOf = (arr, cls) => arr.filter((b) => b.classList.contains(cls))
        .map((b) => b.dataset.change || b.dataset.heat);
      return {
        n: LIFE.length,
        changes: CHANGES.map((c) => c.key),
        heats: HEATS.map((h) => h.key),
        /* 每件的正确答案 —— 从 LIFE 现取，自检那边另抄一份就抓不住「答案被改错」 */
        correct: LIFE.map((x) => ({ kind: x.kind, heat: x.heat, hot: !!x.hot })),
        picked: state.lifePick,
        kind: i >= 0 ? state.quiz.kind[i] : null,
        heat: i >= 0 ? state.quiz.heat[i] : null,
        graded: i >= 0 ? state.quiz.graded[i] : false,
        ok: i >= 0 ? state.quiz.ok[i] : false,
        score: quizScore(),
        answered: quizAnswered(),
        gradedAll: state.quiz.graded.slice(),
        okAll: state.quiz.ok.slice(),
        /* 高亮盒读的是【画出去的那个量】：位置 / 尺寸 / 透明度 / 开关 */
        hotOn: state.drawn.hotOn === true,
        hotIndex: state.drawn.hotIndex,
        hotDy: state.drawn.hotDy,
        hotOpacity: state.drawn.hotOpacity || 0,
        hotPos: [+lifeHot.position.x.toFixed(3), +lifeHot.position.y.toFixed(3), +lifeHot.position.z.toFixed(3)],
        hotScale: [+lifeHot.scale.x.toFixed(3), +lifeHot.scale.y.toFixed(3), +lifeHot.scale.z.toFixed(3)],
        optionButtons: { kinds: kids.length, heats: hts.length },
        panelHidden: QUIZ_EL.group ? QUIZ_EL.group.hidden : null,
        submitDisabled: QUIZ_EL.submit ? QUIZ_EL.submit.disabled : null,
        disabledKinds: kids.filter((b) => b.disabled).length,
        disabledHeats: hts.filter((b) => b.disabled).length,
        okKinds: keysOf(kids, 'ok'), badKinds: keysOf(kids, 'bad'),
        okHeats: keysOf(hts, 'ok'), badHeats: keysOf(hts, 'bad'),
        qText: QUIZ_EL.q ? QUIZ_EL.q.textContent : '',
        resultText: QUIZ_EL.result ? QUIZ_EL.result.textContent : '',
        hintText: els.finding ? els.finding.textContent : ''
      };
    },
    /* 生活现象判读：把「有几件、分别叫什么、答案是什么」原样交出来。
       冰棍那一项是本页唯一【故意放进来的反例】，答案必须是液化 —— 写错的话
       整排就从「纠错题库」变成「错误示范」，而画面上完全看不出来。 */
    lifeInfo() {
      const m0 = lifeMist[0];
      return {
        n: LIFE.length,
        names: LIFE.map((x) => x.name),
        answers: LIFE.map((x) => x.ans),
        mist: lifeMist.length,
        mistY: m0 ? +m0.position.y.toFixed(3) : 0,
        mistX: m0 ? +m0.position.x.toFixed(3) : 0,
        mistOpacity: m0 ? +m0.material.opacity.toFixed(3) : 0,
        mistScale: m0 ? +m0.scale.x.toFixed(3) : 0,
        targets: lifeObjects.length
      };
    },
    /* 第 i 件在【画布 CSS 像素】里的中心（原点在画布左上，和 sampleRegion 同一口径）。
       用途：像素类断言 —— 「这一件在画面里到底看不看得见 / 是不是一块深色小板」。 */
    lifeScreen(i) {
      const o = lifeObjects[i];
      if (!o) return null;
      const r = renderer.domElement.getBoundingClientRect();
      const p = o.position.clone();
      o.getWorldPosition(p);
      p.project(camera);
      return {
        x: (p.x * 0.5 + 0.5) * r.width,
        y: (-p.y * 0.5 + 0.5) * r.height,
        w: r.width, h: r.height
      };
    },
    /* 雾凇的霜晶必须真的挂在枝上：逐颗量「晶体中心 → 最近那条枝轴线段」的距离。
       枝轴的取点公式与建模时同源（都在 z=0 平面内）；晶体只带 ±0.14/±0.26 的抖动，
       所以正常应 < 0.25。公式符号写反时晶体整片飘到枝外（距离可到 ~1.1），
       而这一页缩略图上完全看不出来 —— 必须靠量。 */
    rimeInfo() {
      const gi = LIFE.findIndex((x) => x.key === 'rime');
      const g = gi < 0 ? null : lifeGroup.children[gi];
      if (!g || !g.userData.rimeTwigs) return { n: 0, twigs: 0, maxGap: -1 };
      const segs = g.userData.rimeTwigs.map((t) => {
        const sx = Math.sin(t.rot) * t.len, cy = Math.cos(t.rot) * t.len;
        return { ax: t.dx + sx, ay: t.y - cy, bx: t.dx - sx, by: t.y + cy };
      });
      const segDist = (p, s) => {
        const vx = s.bx - s.ax, vy = s.by - s.ay;
        const L2 = vx * vx + vy * vy || 1;
        let t = ((p.x - s.ax) * vx + (p.y - s.ay) * vy) / L2;
        t = Math.max(0, Math.min(1, t));
        const dx = p.x - (s.ax + t * vx), dy = p.y - (s.ay + t * vy);
        return Math.hypot(dx, dy, p.z);
      };
      let maxGap = 0;
      g.userData.rimeCrystals.forEach((c) => {
        maxGap = Math.max(maxGap, Math.min.apply(null, segs.map((s) => segDist(c.position, s))));
      });
      return { n: g.userData.rimeCrystals.length, twigs: segs.length, maxGap: +maxGap.toFixed(3) };
    },
    step(dt) {
      if (state.scene === 'dryice') stepDryIce(dt);
      else if (state.scene === 'frost') stepFrost(dt);
      else stepSim(dt);
      updateSolid(); updateCrystal(); updateFrost(); updateDryIce(dt); updatePour(dt);
      updateReadouts(); drawMicro(dt); requestRender();
    },
    /* 无头沙箱里 requestAnimationFrame 一次都不触发 —— 按固定步长喂帧，
       走的是与真实循环同一个 frameStep，所以指数平滑（烧杯倾倒、水膜、冷却）也推得动。 */
    driveAnim(seconds, dt = 1 / 60) {
      const n = Math.max(1, Math.round(seconds / dt));
      for (let i = 0; i < n; i++) frameStep(dt);
      renderer.render(scene, camera);
      return {
        frames: n,
        pourK: +state.pour.k.toFixed(4),
        beaker: [+pourBeaker.position.x.toFixed(2), +pourBeaker.position.y.toFixed(2)],
        streamVisible: !!stream.visible,
        wet: +state.wet.toFixed(4),
        fogCount: state.drawn.fogCount,
        fogMeanY: state.drawn.fogMeanY
      };
    },
    /* 推进【仿真秒】—— 走的是 stepXxxDt（不含倍速），所以结果与倍速档位无关，可复现 */
    advance(seconds) {
      let left = seconds;
      while (left > 0 && !state.finished) {
        const d = Math.min(0.2, left);
        if (state.scene === 'dryice') stepDryIceDt(d);
        else if (state.scene === 'frost') stepFrostDt(d);
        else stepIodineDt(d);
        left -= d;
      }
      /* ★ 必须走 updateAll()：advance() 只推进物理，若不重画一遍，
         state.drawn.* 还停在【上一次重画】时的值（通常是 reset 后的全零），
         于是「蒸气到底画出来了没有」这类断言会读到 0 而误报。实测踩过。 */
      updateAll();
      updateReadouts(); drawMicro(0.016);
      return {
        t: state.t, T: state.T, pourMode: state.pour.mode, pourLeft: state.pour.left,
        mSolid: state.mSolid, mGas: state.mGas, mCrystal: state.mCrystal,
        sum: massSum(), liquid: state.liquidMass,
        dryIce: state.dryIce, fogAmt: state.fogAmt, frost: state.frost
      };
    },
    /* 某个碘蒸气团在 GL 缓冲区里的落点（断言「蒸气真的画出来了」） */
    vaporRect(i) {
      const m = vapors[i % vapors.length];
      const v = m.position.clone(); m.getWorldPosition(v);
      v.project(camera);
      const gl = renderer.getContext();
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
      return { x: (v.x * 0.5 + 0.5) * W, y: (v.y * 0.5 + 0.5) * H, W, H, visible: m.visible, opacity: m.material.opacity };
    },
    /* 晶体团在 GL 缓冲区里的落点 */
    crystalRect(i) {
      const m = crystals[i % crystals.length];
      const v = new THREE.Vector3(); m.getWorldPosition(v);
      v.project(camera);
      const gl = renderer.getContext();
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
      return { x: (v.x * 0.5 + 0.5) * W, y: (v.y * 0.5 + 0.5) * H, W, H, visible: m.visible, y3d: v.y };
    },
    /* 白雾里最低与最高的粒子世界 y（断言「白雾在下沉」） */
    fogSpan() {
      const vis = fogs.filter((m) => m.visible);
      if (!vis.length) return null;
      const ys = vis.map((m) => m.position.y);
      return { min: Math.min(...ys), max: Math.max(...ys), n: vis.length };
    },
    sceneFrame,
    /* ------------------------------------------------------------------
       像素级探针：取 GL 缓冲区里一块区域的平均色。
       ★ 必须在 renderer.render() 之后【同步】readPixels —— 默认帧缓冲的内容
         在下一次合成后就没了；隔一个 await 再读会拿到全黑。
       坐标是【CSS 像素、原点在左上】，内部按 devicePixelRatio 换算、并按
       readPixels 的左下原点翻转。
       用途：直接量「白雾/蒸气在画面上到底看不看得见」，而不是靠几何位置间接推断。
       ------------------------------------------------------------------ */
    sampleRegion(x0, y0, x1, y1) {
      renderer.render(scene, camera);
      const gl = renderer.getContext();
      const dpr = renderer.getPixelRatio();
      const bufH = gl.drawingBufferHeight;
      const w = Math.max(1, Math.round((x1 - x0) * dpr));
      const h = Math.max(1, Math.round((y1 - y0) * dpr));
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(Math.round(x0 * dpr), Math.round(bufH - y1 * dpr), w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < buf.length; i += 4) { r += buf[i]; g += buf[i + 1]; b += buf[i + 2]; }
      const n = buf.length / 4;
      r /= n; g /= n; b /= n;
      return { r: +r.toFixed(2), g: +g.toFixed(2), b: +b.toFixed(2), lum: +(0.2126 * r + 0.7152 * g + 0.0722 * b).toFixed(2), n };
    },
    /* 两个状态之间的整屏像素差（先把某一组物件藏起来再渲染，比较两次结果）。
       比几何位置更硬：它直接回答「这组东西到底占没占墨水」。 */
    pixelDiff(hideFn) {
      const gl = renderer.getContext();
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
      const buf = new Uint8Array(W * H * 4);
      const grab = () => { renderer.render(scene, camera); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf); return Uint8Array.from(buf); };
      const a = grab();
      const restore = hideFn();
      const b = grab();
      if (typeof restore === 'function') restore();
      let n = 0;
      for (let i = 0; i < a.length; i += 4) {
        if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) n++;
      }
      return { changed: n, total: W * H, W, H };
    },
    /* 场景里的网格总数 —— 「全程不出现液态碘」的可证伪写法之一：
       若有任何一条路径在运行时新建了液滴网格，这个数就会变。 */
    meshCount() {
      let n = 0;
      scene.traverse((o) => { if (o.isMesh) n++; });
      return n;
    },
    /* 霜枝的几何：根部离板心的距离 / 当前长度 / 朝向 —— 用来卡「霜从边缘往内、朝上长」
       ★ 板尺寸必须读【冷板网格的实际几何】，不能读放枝子用的那个 FROST_PW/PD 常数 ——
         读同一个常数就成了自指恒等式：把 FROST_PW 改小（枝子挤到板心）时，
         判据里的「板半宽」也跟着变小，怎么改都绿。实测差点踩这个坑。 */
    branchInfo(i) {
      const m = branches[i % branches.length];
      const rootDist = Math.hypot(m.position.x, m.position.z);
      const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(m.quaternion);
      const gp = frostPlate.geometry.parameters;
      return {
        rootDist: +rootDist.toFixed(3), len: +m.scale.y.toFixed(4),
        x: +m.position.x.toFixed(3), z: +m.position.z.toFixed(3),
        dirX: +dir.x.toFixed(4), dirY: +dir.y.toFixed(4), dirZ: +dir.z.toFixed(4),
        visible: m.visible,
        plateHW: gp.width / 2, plateHD: gp.depth / 2, FROST_PY
      };
    },
    DRY_ICE_M0
  };
})();
