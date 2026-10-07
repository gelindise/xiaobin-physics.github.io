import * as THREE from './assets/optics-three.min.js';

/* ============================================================================
   蒸发快慢与蒸发致冷 —— 三维写实实验台
   ---------------------------------------------------------------------------
   世界坐标单位：厘米（cm），y 轴向上，实验台台面为 y = 0。
   器材：深灰石质实验台、金属加热板（可通电加热）、硼硅玻璃板、五滴等体积的水滴、
         可调速的小台扇、两支温度计（干球 / 玻璃泡裹湿纱布）。
   物理：① 蒸发速率的【唯一入口】evapRate() = f(T) · A · (1 + k·v)，
            f(T) 走 Arrhenius 形式（20 ℃ 定为 1），不是「档位 → 倍数」的查表
            —— 查表的话「温度档」和「速率」之间可以随便对不上；
         ② 水滴体积守恒：半球扁椭球 V = (2/3)π a²h ⇒ a²h 恒为常数。
            「摊开」只改接触半径 a 与高度 h，不改 V —— 这正是「表面积」这一
            因素要让学生看到的东西，也是本页最硬的一条可断言不变量；
         ③ 蒸发吸热 ⇒ 湿球读数恒低于干球；风速越大、蒸发越快、差值越大。
            湿球读数走【一阶滞后】而不是瞬间跳到目标值 —— 否则「读数差」
            就退化成 evapRate 的另一个写法，读数不再是一个真的物理量。
   ========================================================================== */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  function newCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
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
     一、物理内核
     ========================================================================== */

  /* --- 三个因素的档位（都是「物理量」，不是「倍数」） --- */
  const TEMP_LEVELS = [20, 40, 60];       // ℃ —— 因素场景里是加热板温度，致冷场景里是空气温度
  const AREA_LEVELS = [1, 2, 3];          // 相对接触面积（摊开的程度）
  const WIND_LEVELS = [0, 1, 2];          // 风扇档位
  const FACTORS = ['temp', 'area', 'wind'];
  const BASE_LEVEL = { temp: 0, area: 0, wind: 0 };
  const LEVEL_LABEL = {
    temp: ['室温 20 ℃', '温热 40 ℃', '高温 60 ℃'],
    area: ['1 档 · 水珠', '2 档 · 摊开', '3 档 · 铺平'],
    wind: ['无风', '低档', '高档']
  };
  const FACTOR_NAME = { temp: '温度', area: '表面积', wind: '空气流动' };

  /* 温度因子：Arrhenius（蒸发是分子挣脱液面，本质是热激活过程）。
     ★ 不写「档位 → 倍数」的查表 —— 那样温度档和速率可以互相矛盾，
       而且改一个档位要手工同步两个地方。 */
  const E_OVER_R = 5200;                  // K，量级取水的汽化热/气体常数的一半（教学量级）
  const T_REF = TEMP_LEVELS[0];           // 参考温度 ℃（此处相对速率 = 1）
  function fTemp(T) {
    const a = 1 / (T + 273.15), b = 1 / (T_REF + 273.15);
    return Math.exp(-E_OVER_R * (a - b));
  }
  function fArea(l) { return AREA_LEVELS[clamp(l, 0, 2)]; }
  const WIND_K = 0.85;                    // 每一档风速的增益
  function fWind(l) { return 1 + WIND_K * WIND_LEVELS[clamp(l, 0, 2)]; }

  /* ★ 相对蒸发速率的【唯一入口】。
     画面（水滴变扁、水蒸气层被吹散）与读数（剩余水量、干燥时间、湿球温差）
     全部读它 —— 两处各算一遍的话，读数会和画面对不上，而断言全绿。 */
  function evapRate() {
    return fTemp(TEMP_LEVELS[state.levels.temp]) * fArea(state.levels.area) * fWind(state.levels.wind);
  }

  /* --- 水滴：半球扁椭球，体积守恒 --- */
  const A0 = 1.00;                        // 1 档的接触半径 cm
  const H0 = 0.50;                        // 1 档的高度 cm
  const V0 = (2 / 3) * Math.PI * A0 * A0 * H0;   // ≈ 1.047 cm³
  /* a = A0·√k，h = H0/k  ⇒  a²h = A0²H0 恒为常数（体积守恒） */
  function dropGeom(areaL) {
    const k = AREA_LEVELS[clamp(areaL, 0, 2)];
    const a = A0 * Math.sqrt(k);
    const h = H0 / k;
    return { a, h, a2h: a * a * h, a2hRef: A0 * A0 * H0, vol: (2 / 3) * Math.PI * a * a * h };
  }

  /* --- 干燥时间：与速率成反比（同一初始水量） --- */
  /* K_DRY 由「基准档 75 s 干完」定标：V0 / K_DRY = 1.047 / 0.0139 ≈ 75.3 s。
     不要写「75 s」这个数本身 —— 那样 V0 一改（比如把水滴调大）读数就和模型脱钩了。 */
  const K_DRY = 0.0139;                   // cm³/s
  function dryTime(tempL, areaL, windL) {
    const r = fTemp(TEMP_LEVELS[clamp(tempL, 0, 2)]) * fArea(areaL) * fWind(windL);
    return V0 / (K_DRY * r);
  }
  function dryTimeNow() { return dryTime(state.levels.temp, state.levels.area, state.levels.wind); }

  /* --- 蒸发致冷：湿球温差 --- */
  const DMAX = 7.0;                       // 温差上限 ℃
  const K_SAT = 2.2;                      // 半值参数
  function wetDelta() { const r = evapRate(); return DMAX * r / (r + K_SAT); }
  function dryTarget() { return TEMP_LEVELS[state.levels.temp]; }
  function wetTarget() { return dryTarget() - wetDelta(); }
  const K_LAG = 0.9;                      // 湿球读数的一阶滞后系数 /s（τ ≈ 1.1 s）

  /* --- 液面上方水蒸气层的饱和程度 --- */
  function satFrac() { return 1 / (1 + 0.95 * WIND_LEVELS[state.levels.wind]); }

  /* ==========================================================================
     二、程序化贴图
     🔴 CanvasTexture 必须设 colorSpace = SRGBColorSpace，否则 canvas 里 sRGB
        编码的像素会被当成【线性】值用，线性亮度被抬高约 5 倍 —— 白器材、白雾
        全落在浅灰底上分不出来。本页三张与本章其它旗舰页保持同一写法。
     ========================================================================== */
  function makeBenchMap() {
    const S = 512, rnd = mulberry32(99);
    const c = newCanvas(S, S), g = c.getContext('2d');
    g.fillStyle = '#2c3138'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 2600; i++) {
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
    grad.addColorStop(0.45, '#39434f');
    grad.addColorStop(1, '#232a32');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    const r = g.createRadialGradient(W * 0.34, H * 0.30, 10, W * 0.34, H * 0.30, W * 0.72);
    r.addColorStop(0, 'rgba(210,228,244,0.20)');
    r.addColorStop(1, 'rgba(210,228,244,0)');
    g.fillStyle = r; g.fillRect(0, 0, W, H);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /* 金属加热板：拉丝不锈钢 + 一圈发热槽 */
  function makeSteelMap() {
    const S = 512, rnd = mulberry32(2024);
    const c = newCanvas(S, S), g = c.getContext('2d');
    g.fillStyle = '#b9c1c9'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 4200; i++) {
      const y = rnd() * S, x = rnd() * S, w = 12 + rnd() * 120;
      const l = rnd() < 0.5 ? 62 + rnd() * 12 : 84 + rnd() * 12;
      g.strokeStyle = `rgba(${l * 2.2 | 0},${l * 2.3 | 0},${l * 2.4 | 0},${0.05 + rnd() * 0.12})`;
      g.lineWidth = 0.6 + rnd() * 1.4;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y); g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(2, 2);
    return t;
  }

  /* 软边光斑 —— 水蒸气团块必须用这张贴图 + NormalBlending。
     🔴 不要用实心球 + 加法混合：那样会烧成一坨白斑，看不出「薄薄一层」。 */
  function makePuffMap() {
    const S = 128;
    const c = newCanvas(S, S), g = c.getContext('2d');
    const r = g.createRadialGradient(S / 2, S / 2, 1, S / 2, S / 2, S / 2);
    r.addColorStop(0, 'rgba(255,255,255,0.95)');
    r.addColorStop(0.40, 'rgba(230,243,255,0.40)');
    r.addColorStop(1, 'rgba(230,243,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, S, S);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /* 湿纱布：织纹 */
  function makeGauzeMap() {
    const S = 256, rnd = mulberry32(77);
    const c = newCanvas(S, S), g = c.getContext('2d');
    g.fillStyle = '#f2f5f7'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < S; i += 5) {
      g.fillStyle = 'rgba(190,200,208,0.55)';
      g.fillRect(i, 0, 2, S); g.fillRect(0, i, S, 2);
    }
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(${180 + rnd() * 50 | 0},${190 + rnd() * 50 | 0},${200 + rnd() * 50 | 0},0.3)`;
      g.beginPath(); g.arc(rnd() * S, rnd() * S, 0.6 + rnd() * 1.2, 0, 7); g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(2, 2);
    return t;
  }

  /* 文字牌：干球 / 湿球 / 风扇档位 等 */
  function makeLabelMap(text, bg, fg) {
    const W = 256, H = 96;
    const c = newCanvas(W, H), g = c.getContext('2d');
    g.clearRect(0, 0, W, H);
    g.fillStyle = bg; roundRect(g, 6, 10, W - 12, H - 20, 22); g.fill();
    g.strokeStyle = fg; g.lineWidth = 3; roundRect(g, 6, 10, W - 12, H - 20, 22); g.stroke();
    g.fillStyle = fg;
    g.font = '700 46px "PingFang SC", "Microsoft YaHei", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, W / 2, H / 2 + 2);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  function makeLabelSprite(text, bg, fg, w) {
    const m = new THREE.SpriteMaterial({
      map: makeLabelMap(text, bg, fg), transparent: true, depthWrite: false,
      blending: THREE.NormalBlending
    });
    const s = new THREE.Sprite(m);
    s.scale.set(w, w * 96 / 256, 1);
    return s;
  }

  /* ==========================================================================
     三、状态
     ========================================================================== */
  const state = {
    scene: 'factor',            // factor（影响蒸发快慢的因素） | cool（蒸发致冷）
    running: false,
    speed: 4,
    t: 0,                       // 仿真时刻 s
    levels: { temp: 0, area: 0, wind: 0 },
    lastChanged: null,          // 控制变量：最近被改动的那一个因素
    remain: 1,                  // 剩余水量（相对初始）0~1
    finished: false,
    Td: TEMP_LEVELS[0],         // 干球读数 ℃
    Tw: TEMP_LEVELS[0],         // 湿球读数 ℃（一阶滞后）
    fanSpin: 0,
    windPhase: 0,
    step: 0,
    records: [],
    drawn: {}                   // ★ 只放【画出来的量】，不放输入
  };
  const toggles = { control: true, vapor: true, flow: true, micro: true };

  const SCENES = ['factor', 'cool'];

  const VIEWS = {
    front: { yaw: -0.06, pitch: 0.13, dist: 48, ty: 3.4 },
    angle: { yaw: -0.52, pitch: 0.22, dist: 50, ty: 3.4 },
    top:   { yaw: -0.46, pitch: 0.88, dist: 46, ty: 3.0 },
    close: { yaw: -0.38, pitch: 0.09, dist: 24, ty: 3.0 }
  };
  const view = { ...VIEWS.angle };

  /* ★ 取景必须【按场景给】。致冷场景多了两支 20 cm 高的温度计，
     主体高度差一个数量级；不重新取景的话，换场景后温度计会顶出画布。
     tx 也要跟着走 —— 场景整体不是以 x=0 为中心的（左边是加热板、右边是风扇）。 */
  function sceneFrame() {
    if (state.scene === 'cool') return { tx: 1.6, ty: 9.4, distK: 1.34, pitchK: 0.94 };
    return { tx: 1.6, ty: 3.4, distK: 1.0, pitchK: 1.0 };
  }

  /* ==========================================================================
     四、渲染器 / 场景 / 光照
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
  scene.fog = new THREE.Fog('#2b333c', 190, 430);

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
  key.shadow.camera.top = 46; key.shadow.camera.bottom = -46;
  key.shadow.camera.near = 1; key.shadow.camera.far = 220;
  key.shadow.bias = -0.0016;
  scene.add(key);

  const fill = new THREE.DirectionalLight('#cfe4ff', 0.72);
  fill.position.set(48, 34, -30);
  scene.add(fill);

  const rim = new THREE.DirectionalLight('#ffd9a8', 0.5);
  rim.position.set(6, 22, -52);
  scene.add(rim);

  /* ==========================================================================
     五、器材建模
     ========================================================================== */

  /* ---- 背景幕布 + 实验台 ---- */
  const backdropMap = makeBackdropMap();
  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(420, 240),
    new THREE.MeshBasicMaterial({ map: backdropMap, depthWrite: false, fog: false })
  );
  backdrop.position.set(0, 118, -92);
  scene.add(backdrop);

  const benchMap = makeBenchMap();
  benchMap.anisotropy = MAX_ANISO;
  const bench = new THREE.Mesh(
    new THREE.BoxGeometry(220, 7, 140),
    new THREE.MeshStandardMaterial({
      map: benchMap, bumpMap: benchMap, bumpScale: 0.04,
      color: 0xffffff, roughness: 0.78, metalness: 0.06, envMapIntensity: 0.5
    })
  );
  bench.position.set(0, -3.5, 0);
  bench.receiveShadow = true;
  scene.add(bench);

  /* ---- 金属加热板（可通电加热） ---- */
  const PLATE_W = 24, PLATE_T = 1.0, PLATE_D = 15;
  const PLATE_TOP = PLATE_T;                     // y = 1.0
  const steelMap = makeSteelMap();
  steelMap.anisotropy = MAX_ANISO;
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(PLATE_W, PLATE_T, PLATE_D),
    new THREE.MeshStandardMaterial({
      map: steelMap, bumpMap: steelMap, bumpScale: 0.012,
      color: 0xdfe6ec, roughness: 0.28, metalness: 0.86, envMapIntensity: 1.1
    })
  );
  plate.position.set(0, PLATE_T / 2, 0);
  plate.castShadow = true; plate.receiveShadow = true;
  scene.add(plate);

  /* 发热槽：板面上刻的一圈槽，通电时发红光（发光强度 ∝ 温度档） */
  const grooveMat = new THREE.MeshStandardMaterial({
    color: 0x50312a, roughness: 0.5, metalness: 0.3,
    emissive: new THREE.Color('#ff4d1a'), emissiveIntensity: 0
  });
  const plateGlow = new THREE.Group();
  {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(7.4, 0.16, 8, 64), grooveMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, PLATE_TOP + 0.01, 0);
    plateGlow.add(ring);
    for (let i = -1; i <= 1; i++) {
      const seg = new THREE.Mesh(new THREE.BoxGeometry(13.6, 0.22, 0.30), grooveMat);
      seg.position.set(0, PLATE_TOP + 0.005, i * 3.0);
      plateGlow.add(seg);
    }
  }
  scene.add(plateGlow);

  /* ---- 硼硅玻璃板 ---- */
  const GLASS_T = 0.5;
  const GLASS_TOP = PLATE_TOP + GLASS_T;         // y = 1.5
  const glassPlate = new THREE.Mesh(
    new THREE.BoxGeometry(22, GLASS_T, 13),
    new THREE.MeshPhysicalMaterial({
      color: 0xdff1ff, transparent: true, opacity: 0.24,
      roughness: 0.04, metalness: 0, ior: 1.5, envMapIntensity: 1.6,
      clearcoat: 1, clearcoatRoughness: 0.04, depthWrite: false
    })
  );
  glassPlate.position.set(0, PLATE_TOP + GLASS_T / 2, 0);
  scene.add(glassPlate);

  /* ---- 五滴等体积的水滴 ---- */
  const DROP_X = [-8.4, -4.2, 0, 4.2, 8.4];
  const DROP_Z = 0;
  const dropGroup = new THREE.Group();
  const drops = [];
  {
    /* 半球（上半球）—— 再按 (a, h, a) 缩放即得半椭球，体积 = (2/3)π a²h */
    const geo = new THREE.SphereGeometry(1, 28, 18, 0, Math.PI * 2, 0, Math.PI / 2);
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xbfe9ff, transparent: true, opacity: 0.58,
      roughness: 0.05, metalness: 0, ior: 1.33, envMapIntensity: 1.7,
      clearcoat: 1, clearcoatRoughness: 0.03, depthWrite: false
    });
    DROP_X.forEach((x) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, GLASS_TOP, DROP_Z);
      m.userData.baseX = x;
      m.castShadow = false;
      dropGroup.add(m);
      drops.push(m);
    });
  }
  scene.add(dropGroup);

  /* ---- 小台扇（可调速） ---- */
  const FAN_X = 17.5, FAN_Z = 2.0;
  const fanGroup = new THREE.Group();
  const fanBlades = [];
  {
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x2f3742, roughness: 0.5, metalness: 0.35, envMapIntensity: 0.8 });
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xcfd8e0, roughness: 0.22, metalness: 0.9, envMapIntensity: 1.3 });

    const base = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.0, 0.7, 32), darkMat);
    base.position.set(0, 0.35, 0);
    base.castShadow = true; base.receiveShadow = true;
    fanGroup.add(base);

    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 6.0, 18), chromeMat);
    col.position.set(0, 3.7, 0);
    col.castShadow = true;
    fanGroup.add(col);

    /* 机头：先在原点建「朝 +z」的风扇，再整体转成「朝 −x」 */
    const head = new THREE.Group();
    head.position.set(0, 7.2, 0);

    const motor = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 1.7, 24), darkMat);
    motor.rotation.x = Math.PI / 2;
    motor.position.set(0, 0, -0.55);
    head.add(motor);

    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 0.9, 20), chromeMat);
    hub.rotation.x = Math.PI / 2;
    head.add(hub);

    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(2.55, 0.95, 0.07), chromeMat);
      b.geometry.translate(1.45, 0, 0);
      b.rotation.z = (i / 3) * Math.PI * 2;
      b.rotation.y = 0.34;
      head.add(b);
      fanBlades.push(b);
    }

    const cage = new THREE.Group();
    const ringMat = chromeMat;
    [3.35, 2.45, 1.55].forEach((r) => {
      const t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.055, 6, 48), ringMat);
      cage.add(t);
    });
    for (let i = 0; i < 8; i++) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.07, 3.35, 0.07), ringMat);
      sp.geometry.translate(0, 1.675, 0);
      sp.rotation.z = (i / 8) * Math.PI * 2;
      cage.add(sp);
    }
    cage.position.set(0, 0, 0.62);
    head.add(cage);

    fanGroup.add(head);
    /* Ry(−90°) 把 +z 送到 −x：风扇正对左边的加热板 */
    fanGroup.rotation.y = -Math.PI / 2;
    fanGroup.position.set(FAN_X, 0, FAN_Z);
    fanGroup.userData.head = head;
  }
  scene.add(fanGroup);

  /* ---- 气流（粒子流）---- */
  const WIND_N = 14;
  const WIND_SPAN = 32, WIND_X0 = 16.0, WIND_Y = 2.7;
  const windGroup = new THREE.Group();
  const windParticles = [];
  {
    const mat = new THREE.MeshBasicMaterial({ color: 0xd7ecff, transparent: true, opacity: 0.34, depthWrite: false });
    for (let i = 0; i < WIND_N; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.075, 0.075), mat.clone());
      p.userData.z = (i % 2 === 0) ? -1.7 : 1.7;
      p.userData.off = (i / WIND_N) * WIND_SPAN;
      windGroup.add(p);
      windParticles.push(p);
    }
  }
  scene.add(windGroup);

  /* ---- 液面上方的水蒸气层 ---- */
  const puffMap = makePuffMap();
  const PUFF_PER_DROP = 3;
  const vaporGroup = new THREE.Group();
  const vaporPuffs = [];
  {
    DROP_X.forEach((x) => {
      for (let k = 0; k < PUFF_PER_DROP; k++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({
          map: puffMap, transparent: true, opacity: 0.2,
          depthWrite: false, blending: THREE.NormalBlending, color: 0xffffff
        }));
        s.userData.baseX = x + (k - 1) * 0.55;
        s.userData.baseY = GLASS_TOP + 0.45 + k * 0.24;
        s.userData.baseZ = (k % 2 === 0 ? -0.35 : 0.35);
        s.userData.ph = (x * 0.7 + k * 1.3);
        s.scale.set(1.5, 1.0, 1);
        vaporGroup.add(s);
        vaporPuffs.push(s);
      }
    });
  }
  scene.add(vaporGroup);

  /* ---- 两支温度计（干球 / 湿球）---- */
  const THERMO_Y0 = 0;
  const TH_BULB_R = 0.58, TH_BULB_Y = THERMO_Y0 + TH_BULB_R + 0.35;
  const TH_TUBE_H = 18.0, TH_TUBE_R = 0.30;
  const TH_COL_Y0 = TH_BULB_Y + TH_BULB_R - 0.1;
  const TH_COL_MAX = TH_TUBE_H - 1.2;
  const TH_RANGE = 80;                     // 刻度 0 ~ 80 ℃
  const thermoGroup = new THREE.Group();
  const thermos = [];
  let dryColMesh = null, wetColMesh = null, gauzeMesh = null;
  let dryNumSprite = null, wetNumSprite = null;
  {
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xe8f4ff, transparent: true, opacity: 0.30, roughness: 0.05,
      metalness: 0, ior: 1.5, envMapIntensity: 1.6, depthWrite: false
    });
    const redMat = new THREE.MeshStandardMaterial({ color: 0xd8232a, roughness: 0.4, metalness: 0.05, emissive: new THREE.Color('#5a0b0e'), emissiveIntensity: 0.5 });
    const tickMat = new THREE.MeshBasicMaterial({ color: 0x4b5563 });

    [-4.6, 4.6].forEach((dx, idx) => {
      const g = new THREE.Group();
      g.position.set(dx, THERMO_Y0, 8.2);

      const bulb = new THREE.Mesh(new THREE.SphereGeometry(TH_BULB_R, 22, 16), glassMat);
      bulb.position.y = TH_BULB_Y;
      g.add(bulb);
      const bulbRed = new THREE.Mesh(new THREE.SphereGeometry(TH_BULB_R * 0.72, 18, 14), redMat);
      bulbRed.position.y = TH_BULB_Y;
      g.add(bulbRed);

      const tube = new THREE.Mesh(new THREE.CylinderGeometry(TH_TUBE_R, TH_TUBE_R, TH_TUBE_H, 20, 1, true), glassMat);
      tube.position.y = TH_BULB_Y + TH_TUBE_H / 2 + 0.3;
      g.add(tube);

      /* 红色液柱：几何底在 y=0，scale.y 就是柱高 —— 读数高低直接落在几何量上 */
      const colGeo = new THREE.CylinderGeometry(0.115, 0.115, 1, 12);
      colGeo.translate(0, 0.5, 0);
      const col = new THREE.Mesh(colGeo, redMat);
      col.position.y = TH_COL_Y0;
      g.add(col);

      for (let i = 0; i <= 16; i++) {
        const big = i % 4 === 0;
        const t = new THREE.Mesh(new THREE.BoxGeometry(big ? 0.42 : 0.24, 0.05, 0.05), tickMat);
        t.position.set(TH_TUBE_R + (big ? 0.24 : 0.14), TH_COL_Y0 + (i / 16) * TH_COL_MAX, 0);
        g.add(t);
      }

      /* 支架底座 */
      const stand = new THREE.Mesh(
        new THREE.BoxGeometry(2.6, 0.5, 2.0),
        new THREE.MeshStandardMaterial({ color: 0x39424d, roughness: 0.6, metalness: 0.4 })
      );
      stand.position.y = 0.25;
      stand.receiveShadow = true;
      g.add(stand);

      const label = makeLabelSprite(idx === 0 ? '干球' : '湿球',
        idx === 0 ? 'rgba(12,32,48,0.86)' : 'rgba(16,46,40,0.86)',
        idx === 0 ? '#7dd3fc' : '#6ee7b7', 4.2);
      label.position.set(0, TH_BULB_Y + TH_TUBE_H + 2.2, 0);
      g.add(label);

      const num = new THREE.Sprite(new THREE.SpriteMaterial({
        map: makeLabelMap('20.0', 'rgba(8,20,32,0.86)', '#fdba74'), transparent: true, depthWrite: false
      }));
      num.scale.set(4.6, 4.6 * 96 / 256, 1);
      num.position.set(1.5, TH_BULB_Y + TH_TUBE_H + 0.6, 0);
      g.add(num);

      thermoGroup.add(g);
      thermos.push(g);
      if (idx === 0) { dryColMesh = col; dryNumSprite = num; }
      else { wetColMesh = col; wetNumSprite = num; }
    });

    /* 湿球：玻璃泡上裹的湿纱布 */
    const gauzeMap = makeGauzeMap();
    gauzeMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(TH_BULB_R + 0.16, TH_BULB_R + 0.24, 1.75, 22, 1, true),
      new THREE.MeshStandardMaterial({
        map: gauzeMap, bumpMap: gauzeMap, bumpScale: 0.03,
        color: 0xffffff, roughness: 0.92, metalness: 0, side: THREE.DoubleSide,
        transparent: true, opacity: 0.94
      })
    );
    gauzeMesh.position.set(4.6, TH_BULB_Y - 0.15, 8.2);
    thermoGroup.add(gauzeMesh);

    /* 纱布下方的接水小杯（说明「纱布是湿的、水从哪来」） */
    const cup = new THREE.Mesh(
      new THREE.CylinderGeometry(1.0, 0.85, 1.1, 20, 1, true),
      new THREE.MeshPhysicalMaterial({
        color: 0xdff1ff, transparent: true, opacity: 0.3, roughness: 0.05,
        metalness: 0, side: THREE.DoubleSide, depthWrite: false
      })
    );
    cup.position.set(4.6, 0.85, 8.2);
    thermoGroup.add(cup);
    const cupWater = new THREE.Mesh(
      new THREE.CylinderGeometry(0.86, 0.76, 0.62, 20),
      new THREE.MeshPhysicalMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.6, roughness: 0.08, depthWrite: false })
    );
    cupWater.position.set(4.6, 0.66, 8.2);
    thermoGroup.add(cupWater);

    thermoGroup.visible = false;
    scene.add(thermoGroup);
  }

  /* ==========================================================================
     六、取景
     ========================================================================== */
  /* ★ dirty 必须在 requestRender 之前声明：ESM 是严格模式，赋值给未声明的
     标识符会直接抛 ReferenceError，而报错发生在第一次 requestRender() 里 ——
     页面看上去「加载好了」，其实整个模块在中途就断了（钩子都不存在）。 */
  let dirty = true;
  function requestRender() { dirty = true; }

  function updateCamera() {
    const F = sceneFrame();
    const t = new THREE.Vector3(F.tx, F.ty, 0);
    const pitch = clamp(view.pitch * F.pitchK, -0.10, 1.42);
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

  function setView(name) {
    const v = VIEWS[name];
    if (!v) return false;
    Object.assign(view, v);
    document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    updateCamera();
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

  /* ==========================================================================
     七、画面更新（只写【画出来的量】）
     ========================================================================== */
  function updateVisibility() {
    const cool = state.scene === 'cool';
    thermoGroup.visible = cool;
    vaporGroup.visible = !!toggles.vapor && state.remain > 0.02;
    windGroup.visible = !!toggles.flow && state.levels.wind > 0;
    plateGlow.visible = state.levels.temp > 0;
    state.drawn.scene = state.scene;
    state.drawn.thermoVisible = thermoGroup.visible;
    state.drawn.vaporVisible = vaporGroup.visible;
    state.drawn.flowVisible = windGroup.visible;
    state.drawn.glowVisible = plateGlow.visible;
  }

  function updatePlate() {
    const lv = state.levels.temp;
    const g = lv === 0 ? 0 : (lv === 1 ? 0.55 : 1.25);
    grooveMat.emissiveIntensity = g;
    state.drawn.plateT = TEMP_LEVELS[lv];
    state.drawn.glowIntensity = +g.toFixed(3);
  }

  function updateDrops() {
    const G = dropGeom(state.levels.area);
    const rem = state.remain;
    const h = G.h * rem;
    drops.forEach((d) => {
      d.scale.set(G.a, Math.max(h, 1e-4), G.a);
      d.visible = rem > 0.004;
      d.material.opacity = lerp(0.30, 0.58, Math.min(1, rem * 1.6));
    });
    state.drawn.dropA = +G.a.toFixed(4);
    state.drawn.dropH = +h.toFixed(4);
    state.drawn.dropA2H = +(G.a * G.a * h).toFixed(5);
    state.drawn.dropA2HRef = +(G.a2hRef).toFixed(5);
    state.drawn.dropVol = +((2 / 3) * Math.PI * G.a * G.a * h).toFixed(5);
    state.drawn.dropVol0 = +V0.toFixed(5);
    state.drawn.remain = +rem.toFixed(5);
    state.drawn.dropCount = drops.filter((d) => d.visible).length;
  }

  function updateVapor() {
    const s = satFrac();
    const drift = 0.9 * WIND_LEVELS[state.levels.wind];
    const base = 0.42 * (0.34 + 0.66 * s) * (state.remain > 0.02 ? 1 : 0);
    vaporPuffs.forEach((p, i) => {
      const u = p.userData;
      const wob = Math.sin(state.t * 1.6 + u.ph) * 0.09;
      p.position.set(u.baseX + drift + wob, u.baseY + wob * 0.5, u.baseZ);
      p.material.opacity = base * (i % PUFF_PER_DROP === 0 ? 1 : 0.78);
      const k = 1 + 0.55 * WIND_LEVELS[state.levels.wind];
      p.scale.set(1.5 * k, 1.0 * (2 - k * 0.55), 1);
    });
    state.drawn.vaporOpacity = +base.toFixed(4);
    state.drawn.satFrac = +s.toFixed(4);
    state.drawn.vaporDrift = +drift.toFixed(4);
    state.drawn.vaporPuffs = vaporPuffs.length;
  }

  function updateFlow() {
    const w = WIND_LEVELS[state.levels.wind];
    windParticles.forEach((p) => {
      const u = p.userData;
      let x = WIND_X0 - ((state.windPhase + u.off) % WIND_SPAN);
      p.position.set(x, WIND_Y, u.z);
      p.material.opacity = 0.10 + 0.22 * (w / 2);
      p.scale.set(0.7 + 0.5 * w, 1, 1);
    });
    state.drawn.windParticles = windGroup.visible ? windParticles.length : 0;
    state.drawn.fanSpin = +state.fanSpin.toFixed(4);
  }

  function colHeight(T) { return clamp(T / TH_RANGE, 0, 1) * TH_COL_MAX; }
  function updateThermo() {
    state.Td = dryTarget();
    if (dryColMesh) dryColMesh.scale.y = Math.max(colHeight(state.Td), 0.02);
    if (wetColMesh) wetColMesh.scale.y = Math.max(colHeight(state.Tw), 0.02);
    if (dryNumSprite) dryNumSprite.material.map = makeLabelMap(state.Td.toFixed(1), 'rgba(8,20,32,0.86)', '#fdba74');
    if (wetNumSprite) wetNumSprite.material.map = makeLabelMap(state.Tw.toFixed(1), 'rgba(8,32,26,0.86)', '#6ee7b7');
    state.drawn.dryColH = dryColMesh ? +dryColMesh.scale.y.toFixed(4) : 0;
    state.drawn.wetColH = wetColMesh ? +wetColMesh.scale.y.toFixed(4) : 0;
    state.drawn.Td = +state.Td.toFixed(4);
    state.drawn.Tw = +state.Tw.toFixed(4);
    state.drawn.deltaT = +(state.Td - state.Tw).toFixed(4);
    state.drawn.wetTarget = +wetTarget().toFixed(4);
    state.drawn.gauzeVisible = !!gauzeMesh && gauzeMesh.visible;
  }

  function animateParts(dt) {
    const w = WIND_LEVELS[state.levels.wind];
    state.fanSpin += dt * state.speed * w * 7.0;
    fanBlades.forEach((b) => { b.rotation.y = state.fanSpin; });
    state.windPhase += dt * state.speed * (1.4 + 5.2 * w);
  }

  /* ==========================================================================
     八、物理推进
     ========================================================================== */
  function stepEvapDt(dt) {
    if (state.remain <= 0) return;
    state.t += dt;
    state.remain = Math.max(0, state.remain - K_DRY * evapRate() / V0 * dt);
    if (state.remain <= 0) state.finished = true;
  }

  /* 湿球读数的一阶滞后：目标值由 wetTarget() 给，读数自己慢慢爬过去。
     ★ 这一条是「读数是一个真物理量」的关键 —— 直接等于目标值的话，
       「读数差」就只是 evapRate() 的另一个写法。 */
  function relaxThermo(dt) {
    const k = Math.min(1, K_LAG * dt);
    state.Tw += (wetTarget() - state.Tw) * k;
  }

  function updateAll() {
    updateVisibility();
    updatePlate();
    updateDrops();
    updateVapor();
    updateFlow();
    updateThermo();
    updateReadouts();
    drawChart();
    drawMicro(0.016);
    requestRender();
  }

  /* ==========================================================================
     九、2D 插图：微观示意
     ========================================================================== */
  const microCanvas = $('microCanvas');
  const microText = $('microText');
  const microParticles = [];
  for (let i = 0; i < 26; i++) {
    microParticles.push({ x: 0.06 + (i / 26) * 0.88, y: 0.62 + (i % 3) * 0.055, vx: 0, vy: 0, out: false, life: 0 });
  }
  let microAcc = 0;
  const microRnd = mulberry32(4242);

  function drawMicro(dt) {
    if (!microCanvas) return;
    const W = microCanvas.clientWidth || 220, H = microCanvas.clientHeight || 108;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (microCanvas.width !== Math.round(W * dpr) || microCanvas.height !== Math.round(H * dpr)) {
      microCanvas.width = Math.round(W * dpr); microCanvas.height = Math.round(H * dpr);
    }
    const g = microCanvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#0a1a2b'; g.fillRect(0, 0, W, H);

    const surf = H * 0.60;
    const grad = g.createLinearGradient(0, surf, 0, H);
    grad.addColorStop(0, 'rgba(56,189,248,0.34)');
    grad.addColorStop(1, 'rgba(56,189,248,0.06)');
    g.fillStyle = grad; g.fillRect(0, surf, W, H - surf);
    g.strokeStyle = 'rgba(125,211,252,0.55)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, surf); g.lineTo(W, surf); g.stroke();

    const rate = evapRate();
    const wl = WIND_LEVELS[state.levels.wind];
    const speedK = 0.4 + 0.6 * Math.min(1, rate / 9);

    microAcc += dt;
    if (microAcc >= 0.06) {
      microAcc = 0;
      microParticles.forEach((p) => {
        if (!p.out && microRnd() < 0.055 * Math.min(rate, 22) * (state.remain > 0.02 ? 1 : 0)) {
          p.out = true; p.life = 0;
          p.x = 0.05 + microRnd() * 0.9;
          p.y = surf / H;
        }
        if (p.out) {
          p.life += 1;
          p.y -= (0.022 + 0.05 * speedK);
          p.x += 0.004 * wl * (1 + speedK) + (microRnd() - 0.5) * 0.006;
          if (p.life > 34 || p.y < 0.06) { p.out = false; p.x = 0.05 + microRnd() * 0.9; p.y = 0.62 + microRnd() * 0.1; }
        }
      });
    }

    /* 液体内分子 */
    g.fillStyle = 'rgba(125,211,252,0.85)';
    microParticles.forEach((p) => {
      if (p.out) return;
      const jx = Math.sin(state.t * (2 + speedK * 6) + p.x * 40) * 1.6 * speedK;
      const jy = Math.cos(state.t * (2.4 + speedK * 7) + p.y * 40) * 1.4 * speedK;
      g.beginPath(); g.arc(p.x * W + jx, p.y * H + jy, 2.0, 0, 7); g.fill();
    });
    /* 逃逸出去的分子 */
    g.fillStyle = 'rgba(186,230,253,0.95)';
    microParticles.forEach((p) => {
      if (!p.out) return;
      g.beginPath(); g.arc(p.x * W, p.y * H, 2.2, 0, 7); g.fill();
    });

    /* 气流箭头 */
    if (wl > 0) {
      g.strokeStyle = 'rgba(167,243,208,0.75)';
      g.lineWidth = 1.2;
      for (let i = 0; i < 3; i++) {
        const y = 10 + i * 11;
        const off = (state.windPhase * 22 + i * 26) % 60;
        const x0 = W - off;
        g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 - 26, y); g.stroke();
        g.beginPath(); g.moveTo(x0 - 26, y); g.lineTo(x0 - 20, y - 3.4); g.lineTo(x0 - 20, y + 3.4); g.closePath(); g.fill();
      }
    }

    g.fillStyle = '#bae6fd';
    g.font = '600 10px "PingFang SC","Microsoft YaHei",sans-serif';
    g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillText('速率 ' + rate.toFixed(2) + '×', 6, 5);
    g.fillStyle = '#6ee7b7';
    g.fillText(wl > 0 ? '风把跑出来的分子吹走' : '跑出来的分子又落回去', 6, H - 15);

    if (microText) {
      microText.textContent = state.scene === 'cool'
        ? '逃出去的是「跑得最快的分子」，它们带走热量 → 剩下的水温度下降，湿球读数就比干球低。'
        : '温度越高、表面越大、风越急，单位时间逃出去的分子越多 —— 水就干得越快。';
    }
    state.drawn.microRate = +rate.toFixed(4);
    state.drawn.microWind = wl;
  }

  /* ==========================================================================
     十、2D 插图：干燥时间对照柱状图
     ★ 开关类新功能的画面量必须【同步】重画（requestRender 只置脏，无头没有 rAF）。
     ========================================================================== */
  const chartCanvas = $('chartCanvas');

  function chartBars() {
    const L = state.levels;
    return [
      { key: 'base', label: '基准', sub: '20 ℃ · 1 档 · 无风', sec: dryTime(0, 0, 0), hit: false },
      { key: 'temp', label: '只改温度', sub: LEVEL_LABEL.temp[L.temp], sec: dryTime(L.temp, 0, 0), hit: L.temp > 0 },
      { key: 'area', label: '只改表面积', sub: LEVEL_LABEL.area[L.area], sec: dryTime(0, L.area, 0), hit: L.area > 0 },
      { key: 'wind', label: '只改风速', sub: LEVEL_LABEL.wind[L.wind], sec: dryTime(0, 0, L.wind), hit: L.wind > 0 }
    ];
  }
  /* 纵轴用【对数轴】：四个因素档位的干燥时间从 1 s 到 75 s 跨了近两个数量级，
     线性轴上「高温档」那根柱子只有 1 px，什么都看不出来。
     ★ 量程要盖住【所有可达组合】：最快 = 75.34/(8.41·3·2.7) ≈ 1.1 s，
       最慢 = 基准 75.34 s（任何因素只要离开基准都只会更快）。 */
  const SEC_MIN = 1.2, SEC_MAX = 150;
  const logY = (sec, padT, ph) => {
    const a = Math.log10(SEC_MAX), b = Math.log10(SEC_MIN);
    const v = clamp(Math.log10(clamp(sec, SEC_MIN, SEC_MAX)), b, a);
    return padT + (a - v) / (a - b) * ph;
  };

  function drawChart() {
    if (!chartCanvas) return;
    const W = chartCanvas.clientWidth || 640;
    const H = chartCanvas.clientHeight || 232;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (chartCanvas.width !== Math.round(W * dpr) || chartCanvas.height !== Math.round(H * dpr)) {
      chartCanvas.width = Math.round(W * dpr); chartCanvas.height = Math.round(H * dpr);
    }
    const g = chartCanvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#0b1a2c'; g.fillRect(0, 0, W, H);

    const padL = 44, padR = 16, padT = 18, padB = 34;
    const pw = W - padL - padR, ph = H - padT - padB;

    g.strokeStyle = '#1e3a55'; g.lineWidth = 1;
    g.fillStyle = '#7f96ab'; g.font = '10px "PingFang SC",sans-serif';
    g.textAlign = 'right'; g.textBaseline = 'middle';
    [2, 5, 10, 30, 100].forEach((s) => {
      const y = logY(s, padT, ph);
      g.beginPath(); g.moveTo(padL, y); g.lineTo(padL + pw, y); g.stroke();
      g.fillText(s + ' s', padL - 6, y);
    });
    g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillText('干燥时间（对数轴 · 柱越矮干得越快）', padL, 3);

    const bars = chartBars();
    const n = bars.length;
    const slot = pw / n;
    const bw = Math.min(56, slot * 0.5);
    const drawnBars = [];
    bars.forEach((b, i) => {
      const cx = padL + slot * (i + 0.5);
      const y = logY(b.sec, padT, ph);
      const h = padT + ph - y;
      const grad = g.createLinearGradient(0, y, 0, padT + ph);
      if (b.hit) { grad.addColorStop(0, '#34d399'); grad.addColorStop(1, '#0f766e'); }
      else { grad.addColorStop(0, '#64748b'); grad.addColorStop(1, '#334155'); }
      g.fillStyle = grad;
      roundRect(g, cx - bw / 2, y, bw, Math.max(h, 2), 5); g.fill();
      g.strokeStyle = b.hit ? '#a7f3d0' : '#94a3b8'; g.lineWidth = 1;
      roundRect(g, cx - bw / 2, y, bw, Math.max(h, 2), 5); g.stroke();

      g.fillStyle = b.hit ? '#ecfdf5' : '#cbd5e1';
      g.font = '700 11px "PingFang SC",sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'bottom';
      g.fillText(b.sec.toFixed(b.sec < 20 ? 1 : 0) + ' s', cx, y - 4);

      g.fillStyle = '#9fb6c9'; g.font = '11px "PingFang SC",sans-serif';
      g.textBaseline = 'top';
      g.fillText(b.label, cx, padT + ph + 6);
      g.fillStyle = b.hit ? '#6ee7b7' : '#64748b'; g.font = '9.5px "PingFang SC",sans-serif';
      g.fillText(b.sub, cx, padT + ph + 20);

      drawnBars.push({ key: b.key, sec: +b.sec.toFixed(3), hit: b.hit, px: +h.toFixed(2), x: +cx.toFixed(2), w: +bw.toFixed(2) });
    });

    /* 当前设置：一条虚线横跨图面（把柱状图与正在跑的实验连起来） */
    const now = dryTimeNow();
    const yNow = logY(now, padT, ph);
    g.save();
    g.setLineDash([5, 4]);
    g.strokeStyle = '#fdba74'; g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(padL, yNow); g.lineTo(padL + pw, yNow); g.stroke();
    g.restore();
    g.fillStyle = '#fdba74'; g.font = '700 10.5px "PingFang SC",sans-serif';
    g.textAlign = 'right'; g.textBaseline = 'bottom';
    g.fillText('当前设置 ' + now.toFixed(1) + ' s', padL + pw, yNow - 3);

    state.drawn.chartBars = drawnBars;
    state.drawn.chartNowSec = +now.toFixed(3);
    state.drawn.chartNowY = +yNow.toFixed(2);
  }

  /* ==========================================================================
     十一、读数与提示
     ========================================================================== */
  const els = {
    hudTemp: $('hudTemp'), hudTempLabel: $('hudTempLabel'),
    hudAux: $('hudAux'), hudAuxLabel: $('hudAuxLabel'),
    metricTemp: $('metricTemp'), metricRemain: $('metricRemain'),
    metricDry: $('metricDry'), metricDelta: $('metricDelta'), metricState: $('metricState'),
    finding: $('finding'), sceneHint: $('sceneHint')
  };

  function statusText() {
    if (state.remain <= 0) return '已完全蒸发';
    if (state.remain > 0.97) return '刚滴上，还没开始变';
    if (state.remain > 0.5) return '正在蒸发';
    return '快干了';
  }

  function updateReadouts() {
    const cool = state.scene === 'cool';
    if (els.hudTemp) els.hudTemp.textContent = dryTarget().toFixed(1);
    if (els.hudTempLabel) els.hudTempLabel.textContent = cool ? '空气温度' : '加热板温度';
    if (els.hudAux) {
      els.hudAux.textContent = cool ? (state.Td - state.Tw).toFixed(2) : (state.remain * 100).toFixed(1);
    }
    if (els.hudAuxLabel) els.hudAuxLabel.textContent = cool ? '干湿球温差 ℃' : '剩余水量 %';

    if (els.metricTemp) els.metricTemp.textContent = dryTarget().toFixed(0) + ' ℃';
    if (els.metricRemain) els.metricRemain.textContent = (state.remain * 100).toFixed(1) + ' %';
    if (els.metricDry) els.metricDry.textContent = dryTimeNow().toFixed(1) + ' s';
    if (els.metricDelta) els.metricDelta.textContent = (state.Td - state.Tw).toFixed(2) + ' ℃';
    if (els.metricState) els.metricState.textContent = statusText();

    if (els.finding) {
      const L = state.levels;
      const parts = [];
      parts.push('温度 <b>' + LEVEL_LABEL.temp[L.temp] + '</b>');
      parts.push('表面积 <b>' + LEVEL_LABEL.area[L.area] + '</b>');
      parts.push('空气流动 <b>' + LEVEL_LABEL.wind[L.wind] + '</b>');
      let s = '当前：' + parts.join(' · ') + '。<br>蒸发速率 <b>' + evapRate().toFixed(2) + '×</b>，预计 <b>' + dryTimeNow().toFixed(1) + ' s</b> 干完。';
      if (state.scene === 'cool') {
        s += '<br>干球 <b>' + state.Td.toFixed(1) + ' ℃</b>、湿球 <b>' + state.Tw.toFixed(1) + ' ℃</b>，'
          + '差值 <b>' + (state.Td - state.Tw).toFixed(2) + ' ℃</b> —— 湿球永远更低，因为纱布上的水蒸发时把热带走了。';
      } else {
        s += '<br>五滴水<b>体积一样</b>：摊得越平，接触面越大、越薄，蒸得越快。';
      }
      if (toggles.control) s += '<br><span style="color:#6ee7b7">控制变量已打开：改一个因素，另外两个自动回到基准档。</span>';
      els.finding.innerHTML = s;
    }
    if (els.sceneHint) {
      els.sceneHint.textContent = state.scene === 'cool'
        ? '并排两支温度计：右边那支的玻璃泡裹着湿纱布。'
        : '五滴等体积的水滴摆在玻璃板上，右边是能调速的小台扇。';
    }
  }

  /* ==========================================================================
     十二、记录
     ========================================================================== */
  const recordBody = $('records');
  const recordBodySide = $('recordsSide');
  const recordBtn = $('recordBtn');
  const recordHint = $('recordHint');
  const recSum = $('recSum');
  const HINT_DONE = '继续记录：改一个因素后再记一组，表格就能替你比较。';

  function sceneName() { return state.scene === 'cool' ? '蒸发致冷' : '蒸发快慢' ; }

  function clearRecords() {
    state.records.length = 0;
    renderRecords();
  }

  function renderRecords() {
    const rows = state.records;
    if (recordBody) {
      if (!rows.length) {
        recordBody.innerHTML = '<tr><td colspan="7" class="empty">尚无记录，先点「开始观察」再记录</td></tr>';
      } else {
        recordBody.innerHTML = rows.map((r) => '<tr class="' + (r.cool ? 'cool' : 'warm') + '">'
          + '<td>' + r.scene + '</td><td>' + r.t.toFixed(1) + ' s</td>'
          + '<td>' + r.Td.toFixed(1) + ' ℃</td><td>' + (r.remain * 100).toFixed(1) + ' %</td>'
          + '<td>' + r.Td.toFixed(1) + '</td><td>' + r.Tw.toFixed(1) + '</td>'
          + '<td>' + (r.Td - r.Tw).toFixed(2) + '</td></tr>').join('');
      }
    }
    if (recordBodySide) {
      if (!rows.length) {
        recordBodySide.innerHTML = '<tr><td colspan="4" class="empty">还没有记录</td></tr>';
      } else {
        const cool = state.scene === 'cool';
        recordBodySide.innerHTML = rows.slice(-14).map((r, i) => '<tr class="' + (r.cool ? 'cool' : 'warm') + '">'
          + '<td>' + (rows.length - Math.min(rows.length, 14) + i + 1) + '</td>'
          + '<td>' + r.t.toFixed(1) + ' s</td>'
          + '<td>' + (cool ? r.Tw.toFixed(1) + ' ℃' : (r.remain * 100).toFixed(1) + ' %') + '</td>'
          + '<td>' + r.short + '</td></tr>').join('');
      }
    }
    if (recSum) {
      const cool = state.scene === 'cool';
      if (!rows.length) {
        recSum.textContent = cool ? '点上面的按钮记录干球与湿球的读数，比较它们差多少。' : '点上面的按钮记录时刻和剩余水量。';
      } else {
        const last = rows[rows.length - 1];
        recSum.innerHTML = '已记 <b>' + rows.length + '</b> 组。最后一组：'
          + last.t.toFixed(1) + ' s，' + (cool
            ? '干球 ' + last.Td.toFixed(1) + ' ℃ / 湿球 ' + last.Tw.toFixed(1) + ' ℃，差 <b>' + (last.Td - last.Tw).toFixed(2) + ' ℃</b>'
            : '剩余 <b>' + (last.remain * 100).toFixed(1) + '%</b>');
      }
    }
  }

  /* ==========================================================================
     十三、步骤条
     ========================================================================== */
  const STEPS = [
    { name: '01 认识器材', text: '<strong>认识器材：</strong>实验台上是一块<b>金属加热板</b>（可以通电加热），上面盖一块<b>硼硅玻璃板</b>；玻璃板上摆着<b>五滴一样多的水</b>。右边是一台<b>能调速的小台扇</b>，正对着水滴吹。切到「蒸发致冷」，台上会多出<b>两支温度计</b> —— 一支是干球，另一支的玻璃泡裹着<b>湿纱布</b>。' },
    { name: '02 五滴一样多', text: '<strong>先记住一件事：五滴水的体积完全一样。</strong>把「表面积」档位从 1 档调到 3 档，水滴会<b>摊平</b>：接触半径变大、高度变小，但<b>体积一点没变</b>（半球扁椭球的 V = ⅔πa²h 恒为常数）。所以后面比快慢时，水量这个变量已经被消掉了。' },
    { name: '03 只改温度', text: '<strong>只改温度：</strong>打开「控制变量」，只把温度从 20 ℃ 调到 60 ℃，另两个因素会自动回到基准档。温度升高 → 分子的平均动能变大 → 单位时间能挣脱液面的分子更多 → 蒸发更快。看左边的柱子：干燥时间从 75 s 掉到 9 s 左右。' },
    { name: '04 只改表面积', text: '<strong>只改表面积：</strong>温度回到 20 ℃、风速回 0，只把水滴摊开 —— 注意<b>水量（体积）不变</b>，变的只是它摊开的形状。接触面越大，<b>液面上同时能跑出去的分子就越多</b> —— 干燥时间从 75 s 降到 25 s 左右。这就是「晾衣服要摊开、不要揉成一团」的原因。' },
    { name: '05 只改风速', text: '<strong>只改风速：</strong>温度和表面积都回基准，只把风扇开到高档。风把液面上方<b>快要饱和的那层水蒸气吹走</b>，液面上方一直是「空」的，蒸发更快 —— 干燥时间从 75 s 压到 <b>28 s 左右</b>。三根柱子都在基准左边：<b>温度、表面积、风速，哪一个变大，柱子都变矮（干得更快）</b>。' },
    { name: '06 湿球为什么更低', text: '<strong>切到「蒸发致冷」：</strong>两支温度计并排立在同一个空间里。湿球的玻璃泡裹着湿纱布，纱布上的水不断蒸发、不断<b>吸热</b>，热量只能从玻璃泡本身来 —— 于是湿球读数<b>恒低于</b>干球。把风速调大，纱布上的水蒸得更快、吸热更多，两支的差值跟着变大。' },
    { name: '07 风越大差越大', text: '<strong>把风速从「无风」调到「高档」：</strong>注意湿球读数是<b>慢慢降下去</b>的，不是一下子跳过去 —— 温度计有热惯性。等它稳住再看差值：无风时约 2.2 ℃，低档约 3.2 ℃，高档约 3.9 ℃，<b>严格变大</b>。' },
    { name: '08 记录归纳', text: '<strong>记录归纳：</strong>每改一个因素就记一组，最后在下面的表格里横向比一比。结论是：<b>液体的温度越高、表面积越大、液面上方空气流动越快，蒸发就越快</b>；而蒸发要<b>吸热</b>，所以蒸发快的地方温度就低 —— 出汗后吹风扇觉得更凉，道理就在这里。' }
  ];

  const stepButtons = Array.from(document.querySelectorAll('[data-step]'));
  const stepDetail = $('stepDetail');
  function applyStepUI() {
    stepButtons.forEach((b) => b.classList.toggle('active', Number(b.dataset.step) === state.step));
    if (stepDetail) stepDetail.innerHTML = STEPS[state.step] ? STEPS[state.step].text : '';
  }
  stepButtons.forEach((b) => b.addEventListener('click', () => { state.step = Number(b.dataset.step); applyStepUI(); }));

  /* ==========================================================================
     十四、控件
     ========================================================================== */
  function setRunning(v) {
    state.running = !!v;
    const runBtn = $('runBtn'), pauseBtn = $('pauseBtn');
    if (runBtn) {
      runBtn.textContent = state.running ? '观察中…' : (state.t > 0 ? '继续观察' : '开始观察');
      runBtn.disabled = state.running;
    }
    if (pauseBtn) pauseBtn.disabled = !state.running;
    updateVisibility();
    requestRender();
  }

  function setSpeed(v) {
    state.speed = v;
    document.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('active', Number(b.dataset.speed) === v));
  }

  function applySceneUI() {
    document.querySelectorAll('[data-scene]').forEach((b) => b.classList.toggle('active', b.dataset.scene === state.scene));
  }

  function setScene(key) {
    if (SCENES.indexOf(key) < 0) return false;
    if (state.scene === key) return true;
    state.scene = key;
    applySceneUI();
    updateAll();
    /* ★ 换场景必须【重新取景】：致冷场景多了两支 20 cm 高的温度计，
       主体高度差一个数量级，不重取景会沿用上一档的机位 —— 温度计顶出画布。 */
    updateCamera();
    renderRecords();
    return true;
  }

  function lockedFactors() {
    if (!toggles.control || !state.lastChanged) return [];
    return FACTORS.filter((f) => f !== state.lastChanged);
  }

  function applyFactorUI() {
    const locked = lockedFactors();
    FACTORS.forEach((f) => {
      document.querySelectorAll('[data-factor="' + f + '"]').forEach((b) => {
        b.classList.toggle('active', Number(b.dataset.level) === state.levels[f]);
        b.classList.toggle('locked', locked.indexOf(f) >= 0);
      });
      const badge = $('lock_' + f);
      if (badge) {
        badge.textContent = locked.indexOf(f) >= 0 ? '已锁定' : (toggles.control ? '本次改动' : '自由调节');
        badge.className = 'lock-badge' + (locked.indexOf(f) >= 0 ? ' on' : (toggles.control ? ' me' : ''));
      }
    });
    const cb = $('toggleControl');
    if (cb) cb.checked = !!toggles.control;
  }

  /* ★ 三个因素的唯一入口：控制变量打开时，改一个 → 另外两个【自动回到基准档】。
     这就是「一次只允许改一个」这条判分点的可断言实现。 */
  function setFactor(name, level) {
    if (FACTORS.indexOf(name) < 0) return false;
    const L = clamp(Math.round(level), 0, 2);
    if (toggles.control) {
      FACTORS.forEach((f) => { state.levels[f] = (f === name) ? L : BASE_LEVEL[f]; });
    } else {
      state.levels[name] = L;
    }
    state.lastChanged = name;
    applyFactorUI();
    updateAll();
    return true;
  }

  function setControl(on) {
    toggles.control = !!on;
    if (toggles.control && state.lastChanged) {
      FACTORS.forEach((f) => { if (f !== state.lastChanged) state.levels[f] = BASE_LEVEL[f]; });
    }
    applyFactorUI();
    updateAll();
    return true;
  }

  function resetSim() {
    state.running = false;
    state.t = 0;
    state.remain = 1;
    state.finished = false;
    state.fanSpin = 0;
    state.windPhase = 0;
    state.lastChanged = null;
    FACTORS.forEach((f) => { state.levels[f] = BASE_LEVEL[f]; });
    state.Td = dryTarget();
    state.Tw = wetTarget();          // 复位时湿球直接落在稳态：读数恒低于干球从第一帧就成立
    clearRecords();
    applyFactorUI();
    updateAll();
    setRunning(false);
    if (recordHint) recordHint.textContent = '观察时随时点一下，当前时刻与读数就记进下面的表格（点「重置」会清空）。';
    if (recSum) recSum.textContent = '点上面的按钮开始记录。';
  }

  /* ---- 绑定 ---- */
  document.querySelectorAll('[data-scene]').forEach((b) => b.addEventListener('click', () => setScene(b.dataset.scene)));
  document.querySelectorAll('[data-factor]').forEach((b) => b.addEventListener('click', () => setFactor(b.dataset.factor, Number(b.dataset.level))));
  document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  document.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => setSpeed(Number(b.dataset.speed))));

  const runBtnEl = $('runBtn'), pauseBtnEl = $('pauseBtn'), resetBtnEl = $('resetBtn');
  if (runBtnEl) runBtnEl.addEventListener('click', () => { if (!state.finished) setRunning(true); });
  if (pauseBtnEl) pauseBtnEl.addEventListener('click', () => setRunning(false));
  if (resetBtnEl) resetBtnEl.addEventListener('click', () => { resetSim(); requestRender(); });

  const cbControl = $('toggleControl');
  if (cbControl) cbControl.addEventListener('change', (e) => setControl(e.target.checked));
  const cbVapor = $('toggleVapor');
  if (cbVapor) cbVapor.addEventListener('change', (e) => { toggles.vapor = e.target.checked; updateAll(); });
  const cbFlow = $('toggleFlow');
  if (cbFlow) cbFlow.addEventListener('change', (e) => { toggles.flow = e.target.checked; updateAll(); });
  const cbMicro = $('toggleMicro');
  if (cbMicro) cbMicro.addEventListener('change', (e) => { toggles.micro = e.target.checked; drawMicro(0.016); requestRender(); });

  if (recordBtn) {
    recordBtn.addEventListener('click', () => {
      const cool = state.scene === 'cool';
      state.records.push({
        scene: sceneName(), cool, t: state.t, Td: state.Td, Tw: state.Tw,
        remain: state.remain, state: statusText(),
        short: cool ? ('干湿差 ' + (state.Td - state.Tw).toFixed(2) + ' ℃') : statusText()
      });
      if (state.records.length > 30) state.records.shift();
      renderRecords();
      const wrap = recordBodySide ? recordBodySide.closest('.rec-wrap') : null;
      if (wrap) wrap.scrollTop = wrap.scrollHeight;
      recordBtn.classList.remove('hit');
      void recordBtn.offsetWidth;
      recordBtn.classList.add('hit');
      if (recordHint) recordHint.textContent = HINT_DONE;
      requestRender();
    });
  }

  /* ---- 指针交互 ---- */
  let dragging = false, lastX = 0, lastY = 0;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    canvas.style.cursor = 'grabbing';
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
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
  canvas.addEventListener('pointerup', () => { dragging = false; canvas.style.cursor = 'grab'; });
  canvas.addEventListener('pointercancel', () => { dragging = false; canvas.style.cursor = 'grab'; });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    view.dist = clamp(view.dist * (1 + Math.sign(e.deltaY) * 0.08), 16, 180);
    updateCamera();
  }, { passive: false });
  window.addEventListener('resize', resize);

  /* ==========================================================================
     十五、启动
     ========================================================================== */
  canvas.style.cursor = 'grab';
  applySceneUI();
  applyStepUI();
  applyFactorUI();
  updateCamera();
  resize();
  resetSim();

  let uiAcc = 0;
  function frameStep(dt) {
    animateParts(dt);
    const sdt = dt * state.speed;
    /* 湿球读数是【被动】过程：不管有没有在「观察」，它都在往目标值爬 */
    relaxThermo(sdt);
    if (state.running && !state.finished) {
      stepEvapDt(sdt);
      if (state.finished) setRunning(false);
    }
    uiAcc += dt;
    if (uiAcc >= 0.1) {
      uiAcc = 0;
      updateReadouts();
      drawChart();
      drawMicro(Math.max(dt, 0.016));
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

  /* ==========================================================================
     十六、对外接口（自检 / 出图 / 负向对照共用同一批入口）
     ========================================================================== */
  window.__evapLab = {
    state, view, VIEWS, SCENES, toggles, camera, renderer, scene,
    bench, plate, plateGlow, glassPlate, dropGroup, drops, fanGroup, fanBlades,
    windGroup, windParticles, vaporGroup, vaporPuffs, thermoGroup, thermos, gauzeMesh,
    dryColMesh, wetColMesh,
    A0, H0, V0, K_DRY, E_OVER_R, T_REF, WIND_K, DMAX, K_SAT, K_LAG,
    TEMP_LEVELS, AREA_LEVELS, WIND_LEVELS, FACTORS, BASE_LEVEL, LEVEL_LABEL, FACTOR_NAME,
    PLATE_TOP, GLASS_TOP, TH_RANGE, TH_COL_MAX, DROP_X,
    fTemp, fArea, fWind, evapRate, dryTime, dryTimeNow, wetDelta, wetTarget, dryTarget,
    dropGeom, satFrac, colHeight, sceneFrame, chartBars,
    setScene, setFactor, setControl, resetSim, setRunning, setSpeed, setView,
    updateAll, updateVisibility, updateCamera, updateReadouts, drawChart, drawMicro,
    clearRecords, renderRecords, statusText, lockedFactors,
    stepEvapDt, relaxThermo, applyStepUI,

    /* 喂帧：无头沙箱里 requestAnimationFrame 一次都不触发，必须显式推进 */
    driveAnim(seconds, dt = 1 / 60) {
      const n = Math.max(1, Math.round(seconds / dt));
      for (let i = 0; i < n; i++) frameStep(dt);
      renderer.render(scene, camera);
      return {
        frames: n, t: +state.t.toFixed(3), remain: +state.remain.toFixed(4),
        Td: +state.Td.toFixed(3), Tw: +state.Tw.toFixed(3),
        fanSpin: +state.fanSpin.toFixed(4), windPhase: +state.windPhase.toFixed(3)
      };
    },
    /* 推进【仿真秒】—— 不含倍速，所以结果与倍速档位无关、可复现 */
    advance(simSeconds, dt = 0.5) {
      const n = Math.max(1, Math.round(simSeconds / dt));
      for (let i = 0; i < n; i++) { stepEvapDt(dt); relaxThermo(dt); }
      updateAll();
      renderer.render(scene, camera);
      return {
        t: +state.t.toFixed(3), remain: +state.remain.toFixed(4),
        Td: +state.Td.toFixed(3), Tw: +state.Tw.toFixed(4), finished: state.finished
      };
    },

    /* 三因素的档位与锁定态（读数与画面同源） */
    factorInfo() {
      return {
        levels: { ...state.levels },
        lastChanged: state.lastChanged,
        locked: lockedFactors(),
        control: !!toggles.control,
        rate: +evapRate().toFixed(5),
        dryTime: +dryTimeNow().toFixed(4),
        temp: TEMP_LEVELS[state.levels.temp],
        windL: WIND_LEVELS[state.levels.wind],
        areaL: AREA_LEVELS[state.levels.area]
      };
    },
    /* 水滴：几何量（接触半径 / 高度 / 体积）与【真实网格 scale】一起交出来 */
    dropInfo() {
      const G = dropGeom(state.levels.area);
      const d = drops[0];
      return {
        n: drops.length,
        a: +G.a.toFixed(5), h: +(G.h * state.remain).toFixed(5),
        a2h: +(G.a * G.a * G.h * state.remain).toFixed(6),
        a2hRef: +(G.a2hRef).toFixed(6),
        vol: +((2 / 3) * Math.PI * G.a * G.a * G.h * state.remain).toFixed(6),
        vol0: +V0.toFixed(6),
        remain: +state.remain.toFixed(5),
        areaL: state.levels.area,
        scale: d ? { x: +d.scale.x.toFixed(5), y: +d.scale.y.toFixed(5), z: +d.scale.z.toFixed(5) } : null,
        y: d ? +d.position.y.toFixed(4) : null,
        visible: d ? d.visible : false,
        xs: drops.map((m) => +m.position.x.toFixed(3))
      };
    },
    /* 温度计：读数、目标值、以及【红色液柱的真实几何高度】 */
    thermoInfo() {
      return {
        visible: thermoGroup.visible,
        n: thermos.length,
        Td: +state.Td.toFixed(4), Tw: +state.Tw.toFixed(4),
        delta: +(state.Td - state.Tw).toFixed(4),
        target: +wetTarget().toFixed(4),
        dryColH: dryColMesh ? +dryColMesh.scale.y.toFixed(5) : 0,
        wetColH: wetColMesh ? +wetColMesh.scale.y.toFixed(5) : 0,
        colY0: +TH_COL_Y0.toFixed(4),
        range: TH_RANGE,
        gauze: !!gauzeMesh && gauzeMesh.visible,
        ys: thermos.map((g) => +g.position.y.toFixed(3)),
        xs: thermos.map((g) => +g.position.x.toFixed(3)),
        zs: thermos.map((g) => +g.position.z.toFixed(3))
      };
    },
    /* 柱状图：物理值 + 画出来的像素高度（两处必须同源） */
    chartInfo() {
      return {
        bars: chartBars().map((b) => ({ key: b.key, sec: +b.sec.toFixed(4), hit: b.hit })),
        now: +dryTimeNow().toFixed(4),
        drawn: state.drawn.chartBars || [],
        nowY: state.drawn.chartNowY
      };
    },
    drawn() { return { ...state.drawn }; },
    /* 画布 CSS 像素坐标（原点在画布左上）——像素类断言与 sampleRegion 同一口径 */
    screenOf(obj) {
      if (!obj) return null;
      const r = renderer.domElement.getBoundingClientRect();
      const p = new THREE.Vector3();
      obj.getWorldPosition(p);
      p.project(camera);
      return {
        x: (p.x * 0.5 + 0.5) * r.width,
        y: (-p.y * 0.5 + 0.5) * r.height,
        w: r.width, h: r.height
      };
    },
    /* 读像素：renderer.render() 之后【同步】readPixels —— 判「水蒸气看不看得见」只能量像素 */
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
      return { r: +(r / n).toFixed(2), g: +(g / n).toFixed(2), b: +(b / n).toFixed(2), n };
    },
    /* 画面里「白色水蒸气」到底占了多少 —— 判「雾看不看得见」只能量像素 */
    vaporPixels() {
      const r = renderer.domElement.getBoundingClientRect();
      const x0 = Math.max(0, r.width * 0.18), x1 = Math.min(r.width, r.width * 0.82);
      const y0 = Math.max(0, r.height * 0.18), y1 = Math.min(r.height, r.height * 0.72);
      return this.sampleRegion(x0, y0, x1, y1);
    }
  };
})();
