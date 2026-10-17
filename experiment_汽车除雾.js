import * as THREE from './assets/optics-three.min.js';

/* ============================================================================
   汽车车窗起雾与除雾 —— 三维物态变化实验
   ---------------------------------------------------------------------------
   需求：模拟冬天开车时前挡风玻璃内表面起雾，用仪表盘上的档位（温度 / 风量 /
         吹风方向 / A/C / 内外循环）把雾除掉；并讲清夏天雾为什么在玻璃外面。

   ★★ 物理只有一个出处（本文件「一、物理模型」）：
        pSat / dewPointOf / dOf / pvOfD / dewOfD / blowTemp / jetCoeff /
        fogTargetOf / stepPhysics。
        读数、HUD、指标卡、微观示意、自检全部调它们 —— 别处不许再抄一遍公式。

   ★★ 三句话讲清这个实验：
        ① 雾 = 水蒸气【液化】成的小水珠，水蒸气本身看不见；
        ② 起雾条件 = 玻璃温度低于该侧空气的【露点】；
        ③ 除雾只有两条路 —— 把玻璃【加热】到露点以上（雾滴汽化），
           或者把空气【弄干】让露点降下来（A/C 除湿 / 外循环 / 开窗）。

   世界坐标：x 向右（车宽）、y 向上、z 向车尾（车头在 −z 方向）；单位 cm。
   ========================================================================== */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const isNum = (v) => typeof v === 'number' && isFinite(v);

  /* ==========================================================================
     一、物理模型（全页唯一真值源）
     --------------------------------------------------------------------------
     饱和汽压用 Magnus 公式（水面），在 −10…60 ℃ 内与实测值差 < 0.3%：
         p_sat(T) = 610.94 · exp( 17.625 T / (T + 243.04) )   [Pa]
     露点由「p_sat(T_d) = p_v」反解：
         γ = ln(p_v / 610.94) ,  T_d = 243.04 γ / (17.625 − γ)
     含湿量 d [g 水 / kg 干空气] 与分压的关系（p 取 101325 Pa）：
         d = 622 p_v / (p − p_v)
     ========================================================================== */
  const P_ATM = 101325;

  function pSat(T) {
    return 610.94 * Math.exp(17.625 * T / (T + 243.04));
  }
  function dewPointOf(T, RH) {
    const pv = Math.max(1, RH / 100 * pSat(T));
    const g = Math.log(pv / 610.94);
    return 243.04 * g / (17.625 - g);
  }
  function dOf(T, RH) {
    const pv = RH / 100 * pSat(T);
    return 622 * pv / (P_ATM - pv);
  }
  function pvOfD(d) {
    return P_ATM * d / (622 + d);
  }
  function dewOfD(d) {
    const pv = Math.max(1, pvOfD(d));
    const g = Math.log(pv / 610.94);
    return 243.04 * g / (17.625 - g);
  }

  /* ---- 两个工况（车外环境 + 车内初始状态） ---- */
  const CASES = {
    winter: {
      key: 'winter', label: '冬季',
      outT: -3, outRH: 55,          // 车外 −3 ℃、55%
      inT: 20, inRH: 65,            // 车内 20 ℃、65%（坐了人）
      glassT0: 2,                   // 冷车：玻璃刚开始只有 2 ℃
      fogIn0: 0.86, fogOut0: 0,
      note: '车内暖湿空气遇到被车外冷空气泡冷的玻璃'
    },
    summer: {
      key: 'summer', label: '夏季雨天',
      outT: 31, outRH: 88,          // 车外 31 ℃、88%（露点约 29 ℃）
      inT: 24, inRH: 58,            // 车内开空调 24 ℃
      glassT0: 25.5,
      fogIn0: 0.04, fogOut0: 0.72,  // 雾结在【外表面】
      note: '车外湿热空气遇到被空调冷风吹冷的玻璃'
    }
  };

  /* ---- 空调 / 送风 ---- */
  /* 送风温度：旋钮 0 = 最冷，1 = 最热。
     A/C 开 ⇒ 空气先过蒸发器降到 ~5 ℃（同时被除湿），再按旋钮加热；
     A/C 关 ⇒ 冬天吹的是车外冷风混一点车内空气，夏天吹的是车内/外混合风。 */
  function blowTemp(s) {
    const c = CASES[s.caseKey];
    const base = s.ac ? 5 : (s.caseKey === 'winter' ? c.outT : c.outT * 0.7);
    return base + s.knob * (52 - base);
  }
  /* 送风射流对玻璃的换热权重：只有「除霜」档才正对前挡；风量为 0 时没有射流。 */
  const MODE_JET = { defrost: 3.4, mix: 1.0, face: 0.42, feet: 0.14 };
  function jetCoeff(s) {
    if (s.fan <= 0) return 0;
    return (MODE_JET[s.mode] || 0.2) * s.fan;
  }
  /* 玻璃集总热容（s·W/m²K 的量级，调成「无风 90 s、强除霜 15 s」的时间常数） */
  const GLASS_C = 180;
  const K_IN = 1.0;     // 车内自然对流
  const K_OUT = 1.35;   // 车外对流（行驶 + 冷风）

  /* 结雾目标：用【相对过饱和度】驱动，30% 过饱和就到满雾。
     p_v / p_sat(T_g) − 1 > 0 ⇒ 水蒸气在玻璃上液化；< 0 ⇒ 雾滴汽化。 */
  function fogTargetOf(pv, Tg) {
    const ps = pSat(Tg);
    return clamp((pv / ps - 1) / 0.30, 0, 1);
  }

  const state = {
    caseKey: 'winter',
    knob: 0.26,          // 温度旋钮 0…1
    fan: 2,              // 风量 0…4
    mode: 'defrost',     // face / feet / defrost / mix
    ac: false,           // A/C 压缩机（除湿）
    recirc: true,        // 内循环
    windowOpen: false,   // 开一条窗缝
    wiperAuto: false,    // 雨刮自动

    paused: false,
    speed: 3,            // 时间倍速
    t: 0,                // 模拟时间 s

    glassT: 2,           // 玻璃温度 ℃
    dIn: 9.0,            // 车内含湿量 g/kg
    fogIn: 0.86,         // 内表面雾 0…1
    fogOut: 0,           // 外表面雾 0…1
    wiperPhase: 0,       // 雨刮相位 0…1（0 = 停在下方）
    wiperSweeps: 0,
    wiperTimer: 0,

    showFlow: true, showFog: true, showLabels: false, showInside: true,
    fsLayouts: 0,
    progress: { coldTried: false, warmed: false, dried: false, summerTried: false, wiped: false }
  };

  /* ★ 真正落笔的那一份量，自检读它 —— 不许另抄一份期望值 */
  const DRAWN = {
    glassT: 0, fogIn: 0, fogOut: 0,
    fogOpacityIn: 0, fogOpacityOut: 0,
    blowT: 0, jet: 0, flowCount: 0, wiperAngle: 0, wiperSweeps: 0,
    glassW: 0, glassLen: 0, glassTilt: 0,
    glassCenter: { x: 0, y: 0, z: 0 }, glassNormal: { x: 0, y: 0, z: 0 },
    dewIn: 0, dewOut: 0, rhIn: 0, pvIn: 0, pvOut: 0
  };

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
    if (stage) stage.appendChild(n);
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.shadowMap.enabled = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#7d9cb0');
  scene.fog = new THREE.Fog('#8aa6b8', 320, 1100);

  const camera = new THREE.PerspectiveCamera(42, 1.6, 0.6, 3000);

  function newCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  function mulberry(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* 棚拍环境贴图：给仪表台饰条、方向盘、玻璃提供高光 */
  function studioEnv() {
    const W = 1024, H = 512;
    const c = newCanvas(W, H), g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.42, '#e8eef5');
    grad.addColorStop(0.52, '#93a2b1');
    grad.addColorStop(1, '#22282f');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    const box = (x, y, w, h, r, fill) => { g.fillStyle = fill; roundRect(g, x, y, w, h, r); g.fill(); };
    box(80, 30, 300, 160, 24, 'rgba(255,255,255,0.98)');
    box(660, 70, 250, 130, 22, 'rgba(200,226,255,0.55)');
    box(330, 310, 420, 90, 28, 'rgba(255,214,160,0.26)');
    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromEquirectangular(tex).texture;
    pmrem.dispose(); tex.dispose();
    return env;
  }
  scene.environment = studioEnv();

  scene.add(new THREE.HemisphereLight('#eaf2fa', '#3b444f', 0.78));
  scene.add(new THREE.AmbientLight('#ffffff', 0.26));

  const keyLight = new THREE.DirectionalLight('#fff2dd', 1.5);
  keyLight.position.set(-120, 180, 220);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight('#d7e6f7', 0.55);
  fillLight.position.set(160, 90, -120);
  scene.add(fillLight);

  const cabinLight = new THREE.PointLight('#ffd9a8', 0.5, 260, 2);
  cabinLight.position.set(0, 58, -6);
  scene.add(cabinLight);

  /* ==========================================================================
     三、车外环境（让「雾挡住视线」看得出来）
     ========================================================================== */
  const world = new THREE.Group();
  scene.add(world);

  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(2400, 2400),
    new THREE.MeshStandardMaterial({ color: '#3b4249', roughness: 0.96, metalness: 0 })
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, -2, -400);
  world.add(road);

  /* 车道线 */
  const laneMat = new THREE.MeshBasicMaterial({ color: '#cfd8de' });
  for (let i = 0; i < 16; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(16, 90), laneMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(0, -1.7, -80 - i * 130);
    world.add(m);
  }
  const edgeMat = new THREE.MeshBasicMaterial({ color: '#b8c4cc' });
  for (const sx of [-260, 260]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(10, 2400), edgeMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(sx, -1.7, -400);
    world.add(m);
  }

  /* 远处景物：一排冷杉 + 几栋楼，雾厚时被遮住 */
  const treeMat = new THREE.MeshStandardMaterial({ color: '#2f4b3d', roughness: 0.9 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#3a2f28', roughness: 0.95 });
  const rndWorld = mulberry(20261017);
  for (let i = 0; i < 26; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const z = -120 - Math.floor(i / 2) * 95 - rndWorld() * 30;
    const x = side * (150 + rndWorld() * 90);
    const h = 90 + rndWorld() * 90;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3.4, h * 0.34, 8), trunkMat);
    trunk.position.set(x, h * 0.17, z);
    world.add(trunk);
    for (let k = 0; k < 3; k++) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(20 - k * 5, h * 0.42, 9), treeMat);
      cone.position.set(x, h * (0.28 + k * 0.22), z);
      world.add(cone);
    }
  }
  const bldMat = new THREE.MeshStandardMaterial({ color: '#5a6773', roughness: 0.92 });
  for (let i = 0; i < 7; i++) {
    const w = 90 + rndWorld() * 80, h = 130 + rndWorld() * 150;
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 80), bldMat);
    b.position.set((i - 3) * 190 + rndWorld() * 40, h / 2 - 2, -620 - rndWorld() * 180);
    world.add(b);
  }

  /* 路边的杆子（近处参照物，雾一厚就发灰） */
  const poleMat = new THREE.MeshStandardMaterial({ color: '#8b949c', roughness: 0.6, metalness: 0.4 });
  for (let i = 0; i < 6; i++) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.9, 130, 10), poleMat);
    p.position.set(-190, 64, -110 - i * 150);
    world.add(p);
  }

  /* ==========================================================================
     四、车厢
     ========================================================================== */
  const car = new THREE.Group();
  scene.add(car);

  const MAT = {
    dash: new THREE.MeshStandardMaterial({ color: '#2b333c', roughness: 0.82, metalness: 0.05, envMapIntensity: 0.5 }),
    dashTop: new THREE.MeshStandardMaterial({ color: '#1a2026', roughness: 0.9, metalness: 0.03 }),
    trim: new THREE.MeshStandardMaterial({ color: '#9aa7b2', roughness: 0.28, metalness: 0.85, envMapIntensity: 1.2 }),
    seat: new THREE.MeshStandardMaterial({ color: '#2b333c', roughness: 0.88, metalness: 0.02 }),
    seatAccent: new THREE.MeshStandardMaterial({ color: '#3b4652', roughness: 0.8 }),
    pillar: new THREE.MeshStandardMaterial({ color: '#39424c', roughness: 0.85 }),
    headliner: new THREE.MeshStandardMaterial({ color: '#5b646d', roughness: 0.95 }),
    floor: new THREE.MeshStandardMaterial({ color: '#161b20', roughness: 0.98 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: '#b6d4e6', transparent: true, opacity: 0.14, roughness: 0.04,
      metalness: 0.0, envMapIntensity: 1.6, side: THREE.DoubleSide, depthWrite: false
    }),
    dark: new THREE.MeshStandardMaterial({ color: '#0e1216', roughness: 0.7 }),
    screen: new THREE.MeshBasicMaterial({ color: '#123c4d' })
  };

  const CAR = { w: 124, h: 72, zBack: 42, zFront: -76 };

  /* 地板 / 车顶 / 后墙 / 门板 */
  function box(w, h, d, mat, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    car.add(m);
    return m;
  }
  box(CAR.w, 2.4, 118, MAT.floor, 0, -1.2, -16);
  box(CAR.w, 2, 118, MAT.headliner, 0, 72, -16);
  box(CAR.w, 74, 2, MAT.pillar, 0, 36, CAR.zBack);
  box(2.4, 66, 108, MAT.pillar, -62, 33, -14);
  box(2.4, 66, 108, MAT.pillar, 62, 33, -14);

  /* 门内衬 + 扶手 */
  for (const sx of [-1, 1]) {
    box(3, 34, 86, MAT.dash, sx * 60.4, 20, -12);
    box(4.4, 3.4, 60, MAT.trim, sx * 58.4, 30, -14);
  }

  /* A 柱：从门板前端斜到车顶前缘 */
  const pillarGeo = new THREE.BoxGeometry(5.2, 5.2, 62);
  for (const sx of [-1, 1]) {
    const p = new THREE.Mesh(pillarGeo, MAT.pillar);
    p.position.set(sx * 57, 41, -55);
    p.rotation.x = -0.55;
    car.add(p);
  }
  /* B 柱 */
  for (const sx of [-1, 1]) box(4, 52, 5, MAT.pillar, sx * 60, 40, 6);

  /* ---- 仪表台 ---- */
  const dashMain = box(116, 12, 20, MAT.dash, 0, 22, -31);
  const dashTop = box(118, 2.6, 22, MAT.dashTop, 0, 29.2, -31);
  /* 仪表台上的银色饰条（贯穿左右），让深色台面有层次 */
  box(112, 0.9, 1.6, MAT.trim, 0, 24.6, -21.2);
  box(112, 0.7, 1.2, MAT.trim, 0, 19.6, -21.0);

  /* 前挡下沿的除霜出风口（一条长格栅） */
  box(86, 1.6, 3.0, MAT.dark, 0, 30.4, -41.2);
  const grilleMat = new THREE.MeshStandardMaterial({ color: '#4a555f', roughness: 0.6, metalness: 0.3 });
  for (let i = 0; i < 22; i++) {
    box(2.0, 0.7, 2.2, grilleMat, -40 + i * 3.8, 31.0, -41.2);
  }
  /* 除霜口的「吹出口」标记线（朝上的窄条） */
  box(86, 0.5, 0.5, MAT.trim, 0, 31.3, -42.0);

  /* ---- 中控台 ----
     🔴 屏幕和空调面板必须【上下分开】：第一版两者都摆在 (0,30,−22)，
        屏幕把面板整个盖住、面板的文字标签浮在屏幕上，看着像一块乱码。 */
  box(20, 16, 20, MAT.dash, 0, 24, -30);
  box(17, 1.2, 17, MAT.dashTop, 0, 32.2, -30);
  /* 悬浮中控屏（点亮，纯装饰；放在中控台上方、比面板更靠前） */
  /* 屏幕平放在中控台顶面上 —— 立着会正好挡住玻璃中部（雾最明显的那一块），
     而且下半截会被中控台顶面切掉，只剩一条蓝边。 */
  const screenMesh = box(12, 0.5, 7, MAT.screen, 0, 32.9, -27);
  for (let i = 0; i < 2; i++) {
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(10, 0.9), new THREE.MeshBasicMaterial({ color: i ? '#67e8f9' : '#fdba74' }));
    bar.rotation.x = -Math.PI / 2;
    bar.position.set(0, 33.2, -25.4 - i * 2.6);
    car.add(bar);
  }

  /* ---- 仪表盘（驾驶员正前方两块圆表） ---- */
  function makeGauge(radius, ticks) {
    const S = 256;
    const c = newCanvas(S, S), g = c.getContext('2d');
    g.fillStyle = '#0b1015'; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#2c3a46'; g.lineWidth = 4; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 6, 0, Math.PI * 2); g.stroke();
    for (let i = 0; i <= ticks; i++) {
      const a = Math.PI * 0.75 + (i / ticks) * Math.PI * 1.5;
      const r1 = S / 2 - 14, r2 = S / 2 - (i % 2 ? 24 : 30);
      g.strokeStyle = i % 2 ? '#4a6070' : '#9fd0e6';
      g.lineWidth = i % 2 ? 2 : 3.4;
      g.beginPath();
      g.moveTo(S / 2 + Math.cos(a) * r1, S / 2 + Math.sin(a) * r1);
      g.lineTo(S / 2 + Math.cos(a) * r2, S / 2 + Math.sin(a) * r2);
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Mesh(new THREE.CircleGeometry(radius, 32),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  }
  for (const sx of [-1, 1]) {
    const gauge = makeGauge(5.2, 10);
    gauge.position.set(-22 + sx * 8.2, 29.4, -30.4);
    gauge.rotation.x = -0.30;
    car.add(gauge);
    const needle = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 4.2), new THREE.MeshBasicMaterial({ color: '#f97316' }));
    needle.position.set(-22 + sx * 8.2, 30.2, -30.1);
    needle.rotation.x = -0.30;
    needle.rotation.z = sx > 0 ? 0.7 : -0.5;
    car.add(needle);
  }

  /* ---- 方向盘 ---- */
  const wheelGroup = new THREE.Group();
  wheelGroup.position.set(-22, 34, -21);
  wheelGroup.rotation.x = -0.62;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(9.6, 1.05, 12, 40), new THREE.MeshStandardMaterial({ color: '#15191d', roughness: 0.6, metalness: 0.1 }));
  wheelGroup.add(rim);
  const spokeMat = new THREE.MeshStandardMaterial({ color: '#2a323a', roughness: 0.55, metalness: 0.25 });
  for (const a of [Math.PI * 0.5, Math.PI * 1.15, Math.PI * 1.85]) {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(8.4, 1.5, 0.9), spokeMat);
    sp.position.set(Math.cos(a) * 4.6, Math.sin(a) * 4.6, 0);
    sp.rotation.z = a;
    wheelGroup.add(sp);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(3.0, 3.0, 1.4, 20), new THREE.MeshStandardMaterial({ color: '#313a43', roughness: 0.4, metalness: 0.4 }));
  hub.rotation.x = Math.PI / 2;
  wheelGroup.add(hub);
  car.add(wheelGroup);
  /* 转向柱 */
  const col = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.4, 16, 12), MAT.dark);
  col.position.set(-22, 30.5, -26.5);
  col.rotation.x = Math.PI / 2 - 0.62;
  car.add(col);

  /* ---- 座椅（主驾 / 副驾） ---- */
  function seat(x, z) {
    const g = new THREE.Group();
    const cushion = new THREE.Mesh(new THREE.BoxGeometry(25, 5, 27), MAT.seat);
    cushion.position.set(0, 13, 0);
    g.add(cushion);
    const back = new THREE.Mesh(new THREE.BoxGeometry(25, 32, 5.5), MAT.seat);
    back.position.set(0, 30, 12.5);
    back.rotation.x = 0.16;
    g.add(back);
    const head = new THREE.Mesh(new THREE.BoxGeometry(14, 10, 4.4), MAT.seatAccent);
    head.position.set(0, 47, 15.6);
    head.rotation.x = 0.16;
    g.add(head);
    const side = new THREE.Mesh(new THREE.BoxGeometry(2.4, 6, 24), MAT.seatAccent);
    side.position.set(-12.6, 17, 0);
    g.add(side);
    g.position.set(x, 0, z);
    car.add(g);
    return g;
  }
  seat(-24, 8);
  seat(24, 8);

  /* ---- 后视镜 ---- */
  const mirrorArm = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 9, 8), MAT.dark);
  mirrorArm.position.set(0, 66, -60);
  mirrorArm.rotation.x = 0.5;
  car.add(mirrorArm);
  const mirrorBody = new THREE.Mesh(new THREE.BoxGeometry(20, 6, 2.4), MAT.dash);
  mirrorBody.position.set(0, 61.5, -64);
  car.add(mirrorBody);

  /* ==========================================================================
     五、前挡风玻璃（倾斜面）+ 内外两层雾
     --------------------------------------------------------------------------
     玻璃下沿 (0,16,−40)、上沿 (0,66,−74)。
     法线取【朝车内 +z】：n = (0, 0.520, 0.854)；绕 x 轴的倾角 −0.546 rad。
     雾层是同一朝向的 plane，沿法线各偏移 0.55 —— 内雾朝 +n、外雾朝 −n。
     ========================================================================== */
  const G = {
    w: 112,
    y0: 16, z0: -40,
    y1: 66, z1: -74
  };
  G.len = Math.hypot(G.y1 - G.y0, G.z1 - G.z0);
  G.tilt = Math.atan2(G.z1 - G.z0, G.y1 - G.y0);      // −0.546
  const gUp = new THREE.Vector3(0, (G.y1 - G.y0) / G.len, (G.z1 - G.z0) / G.len);
  const gN = new THREE.Vector3(0, -gUp.z, gUp.y);      // 朝车内
  const gC = new THREE.Vector3(0, (G.y0 + G.y1) / 2, (G.z0 + G.z1) / 2);

  DRAWN.glassW = G.w; DRAWN.glassLen = G.len; DRAWN.glassTilt = G.tilt;
  DRAWN.glassCenter = { x: gC.x, y: gC.y, z: gC.z };
  DRAWN.glassNormal = { x: gN.x, y: gN.y, z: gN.z };

  /* 窗框：只做【四条边框】，绝不能做成整块挡板 ——
     整块 plane 会从车外把整个车厢挡死（实测「车外看前挡」视角一片黑）。 */
  const frameMat = new THREE.MeshStandardMaterial({ color: '#1b2228', roughness: 0.9 });
  {
    /* 上下两条横框 + 左右两条竖框；位置用「沿玻璃的 up 方向偏移」表达 */
    const sideDir = new THREE.Vector3(1, 0, 0);
    for (const sgn of [-1, 1]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(G.w + 7, 4.2, 2.4), frameMat);
      bar.position.copy(gC).addScaledVector(gUp, sgn * (G.len / 2 + 1.4));
      bar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), gN);
      car.add(bar);
    }
    for (const sgn of [-1, 1]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(4.2, G.len + 6, 2.4), frameMat);
      bar.position.copy(gC).addScaledVector(sideDir, sgn * (G.w / 2 + 1.4));
      bar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), gN);
      car.add(bar);
    }
  }

  const glassMesh = new THREE.Mesh(new THREE.PlaneGeometry(G.w, G.len), MAT.glass);
  glassMesh.position.copy(gC);
  glassMesh.rotation.x = G.tilt;
  glassMesh.renderOrder = 10;
  car.add(glassMesh);

  /* ---- 雾纹理：柔和白雾团 + 细密水珠 ---- */
  function makeFogTexture(seed) {
    const S = 512;
    const c = newCanvas(S, S), g = c.getContext('2d');
    const rnd = mulberry(seed);
    /* 🔴 纹理必须是【白底 + 挖洞】，不能是「透明底 + 堆白点」：
       后者叠加出来的 alpha 只有 0.3~0.4，再乘 material.opacity，浓雾也只剩 0.25，
       看上去只是「玻璃有点脏」。白底挖洞 ⇒ 纹理 alpha 0.5~0.95，浓雾才是真的白。 */
    g.fillStyle = 'rgba(255,255,255,0.96)';
    g.fillRect(0, 0, S, S);
    g.globalCompositeOperation = 'destination-out';
    /* 🔴 挖洞的「总量」必须算：每个像素平均被 60·π·85²/512² ≈ 4.9 个团盖住，
       单团 alpha 0.10 ⇒ 残留 (1−0.10)^4.9 ≈ 0.60。给到 240 个团、alpha 0.18 时
       残留只剩 0.02 —— 纹理几乎全透明，浓雾也只是一层灰（实测像素差仅 5.8 灰度）。 */
    for (let i = 0; i < 60; i++) {
      const x = rnd() * S, y = rnd() * S, r = 40 + rnd() * 110;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(0,0,0,' + (0.05 + rnd() * 0.08).toFixed(3) + ')');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    for (let i = 0; i < 200; i++) {
      const x = rnd() * S, y = rnd() * S, r = 6 + rnd() * 22;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(0,0,0,' + (0.03 + rnd() * 0.05).toFixed(3) + ')');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    /* 细密水珠：亮一点的小点，给雾一点颗粒感 */
    for (let i = 0; i < 6000; i++) {
      const x = rnd() * S, y = rnd() * S, r = 0.35 + rnd() * 0.8;
      g.fillStyle = 'rgba(255,255,255,' + (0.18 + rnd() * 0.35).toFixed(3) + ')';
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1;
    return tex;
  }

  const fogTexIn = makeFogTexture(7717);
  const fogMatIn = new THREE.MeshBasicMaterial({ map: fogTexIn, color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const fogInMesh = new THREE.Mesh(new THREE.PlaneGeometry(G.w, G.len), fogMatIn);
  fogInMesh.position.copy(gC).addScaledVector(gN, 0.55);
  fogInMesh.rotation.x = G.tilt;
  fogInMesh.renderOrder = 12;
  car.add(fogInMesh);

  const fogTexOut = makeFogTexture(3313);
  const fogMatOut = new THREE.MeshBasicMaterial({ map: fogTexOut, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, color: '#ffffff' });
  const fogOutMesh = new THREE.Mesh(new THREE.PlaneGeometry(G.w, G.len), fogMatOut);
  fogOutMesh.position.copy(gC).addScaledVector(gN, -0.6);
  fogOutMesh.rotation.x = G.tilt;
  fogOutMesh.renderOrder = 11;
  car.add(fogOutMesh);

  /* ---- 左右前侧窗（也起一点雾，让「整圈玻璃都糊」有感觉） ---- */
  const sideGlassGeo = new THREE.PlaneGeometry(52, 40);
  const sideFogMat = [];
  for (const sx of [-1, 1]) {
    const sg = new THREE.Mesh(sideGlassGeo, MAT.glass);
    sg.position.set(sx * 60.2, 40, -30);
    sg.rotation.y = sx * Math.PI / 2;
    sg.renderOrder = 10;
    car.add(sg);
    const fm = new THREE.MeshBasicMaterial({ map: fogTexIn, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    const fmMesh = new THREE.Mesh(sideGlassGeo, fm);
    fmMesh.position.set(sx * 59.6, 40, -30);
    fmMesh.rotation.y = sx * Math.PI / 2;
    fmMesh.renderOrder = 12;
    car.add(fmMesh);
    sideFogMat.push(fm);
  }

  /* ==========================================================================
     六、出风口 + 气流粒子 + 雨刮
     ========================================================================== */
  /* 中央圆形出风口（两个） */
  const ventMat = new THREE.MeshStandardMaterial({ color: '#1a2026', roughness: 0.65, metalness: 0.3 });
  const ventRings = [];
  for (const sx of [-1, 1]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.55, 8, 22), MAT.trim);
    ring.position.set(sx * 13, 24.6, -21.4);
    car.add(ring);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(3.2, 22), ventMat);
    hole.position.set(sx * 13, 24.6, -21.6);
    car.add(hole);
    ventRings.push({ x: sx * 13, y: 24.6, z: -21.6 });
  }
  /* 脚部出风口 */
  for (const sx of [-1, 1]) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(7, 2.4, 3), ventMat);
    f.position.set(sx * 22, 8.5, -24);
    car.add(f);
  }

  /* ---- 气流粒子：沿「出风口 → 玻璃 → 沿玻璃上升」的曲线走 ---- */
  const FLOW_N = 132;
  const flowGeo = new THREE.BufferGeometry();
  const flowPos = new Float32Array(FLOW_N * 3);
  const flowCol = new Float32Array(FLOW_N * 3);
  flowGeo.setAttribute('position', new THREE.BufferAttribute(flowPos, 3));
  flowGeo.setAttribute('color', new THREE.BufferAttribute(flowCol, 3));
  const flowMat = new THREE.PointsMaterial({
    size: 5.6, vertexColors: true, transparent: true, opacity: 1.0,
    depthWrite: false, sizeAttenuation: false
  });
  const flowPoints = new THREE.Points(flowGeo, flowMat);
  flowPoints.frustumCulled = false;
  /* 🔴 renderOrder 必须大于雾层（12）：透明物体按 renderOrder 排，
     粒子先画就会被后画的雾层混合覆盖 —— 实测「粒子数 63、画面上一颗也看不见」。 */
  flowPoints.renderOrder = 20;
  car.add(flowPoints);

  /* 每条流线的控制点（沿 x 均布，从除霜口出发，贴着玻璃往上走） */
  const FLOW_LINES = 9;
  const flowPaths = [];
  const flowParts = [];
  for (let i = 0; i < FLOW_LINES; i++) {
    const fx = (i / (FLOW_LINES - 1) - 0.5) * 78;
    const pts = [
      new THREE.Vector3(fx, 30.8, -41.0),
      new THREE.Vector3(fx, 33.0, -43.0),
      new THREE.Vector3(fx, 36.5, -45.2),
      new THREE.Vector3(fx, 40.5, -47.6),
      new THREE.Vector3(fx, 44.5, -50.0)
    ];
    const curve = new THREE.CatmullRomCurve3(pts);
    flowPaths.push(curve);
  }
  const rndFlow = mulberry(4242);
  for (let i = 0; i < FLOW_N; i++) {
    flowParts.push({
      line: i % FLOW_LINES,
      t: rndFlow(),
      v: 0.34 + rndFlow() * 0.22,
      jitter: (rndFlow() - 0.5) * 2.4,
      jitter2: (rndFlow() - 0.5) * 2.0
    });
  }

  /* ---- 雨刮（两根，绕玻璃下沿的铰点摆动；轴 = 玻璃法线） ---- */
  const wiperGroup = new THREE.Group();
  car.add(wiperGroup);
  const wiperPivots = [];
  const qAlign = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), gN);
  function makeWiper(hx, dir) {
    const align = new THREE.Group();
    align.quaternion.copy(qAlign);
    align.position.set(hx, 16.4, -40.9).addScaledVector(gN, -0.9);
    const spin = new THREE.Group();
    align.add(spin);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(42, 1.5, 0.9), new THREE.MeshStandardMaterial({ color: '#11151a', roughness: 0.55 }));
    arm.position.x = dir * 21;
    spin.add(arm);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(40, 1.1, 2.0), new THREE.MeshStandardMaterial({ color: '#0a0d10', roughness: 0.85 }));
    blade.position.set(dir * 21, -1.5, 0);
    spin.add(blade);
    wiperGroup.add(align);
    wiperPivots.push({ spin, dir });
  }
  makeWiper(-34, 1);
  makeWiper(34, -1);

  /* ==========================================================================
     七、仪表盘上的空调控制面板（可点击拾取）
     --------------------------------------------------------------------------
     面板长在【中控台上、朝驾驶员一面】。三个旋钮 + 三个按钮，
     每个可点对象都挂 userData.pick，点一下循环换档 —— 学生不必去侧栏找。
     ========================================================================== */
  const panel = new THREE.Group();
  panel.position.set(0, 25.4, -19.6);
  panel.rotation.x = -0.10;
  car.add(panel);

  const panelBase = new THREE.Mesh(new THREE.BoxGeometry(17.5, 9.6, 0.9),
    new THREE.MeshStandardMaterial({ color: '#141a20', roughness: 0.55, metalness: 0.35 }));
  panel.add(panelBase);

  const pickables = [];
  function markPick(obj, kind) {
    obj.userData.pick = kind;
    pickables.push(obj);
    return obj;
  }

  /* 三个旋钮：温度 / 风量 / 模式 */
  const knobGeo = new THREE.CylinderGeometry(2.0, 2.1, 1.5, 22);
  const knobMat = new THREE.MeshStandardMaterial({ color: '#2b343d', roughness: 0.42, metalness: 0.55 });
  const pointerMat = new THREE.MeshBasicMaterial({ color: '#67e8f9' });
  const knobs = {};
  function makeKnob(kind, x, y) {
    const g = new THREE.Group();
    g.position.set(x, y, 0.75);
    const body = new THREE.Mesh(knobGeo, knobMat);
    body.rotation.x = Math.PI / 2;
    g.add(body);
    const ptr = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.35, 0.35), pointerMat);
    ptr.position.set(0, 1.1, 0.85);
    g.add(ptr);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.25, 0.16, 6, 26), new THREE.MeshBasicMaterial({ color: '#3f5a6b' }));
    ring.position.z = 0.72;
    g.add(ring);
    markPick(g, kind);
    /* 拾取用一个小圆柱当碰撞体，比细长的指针稳 */
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.7, 2.2, 12), new THREE.MeshBasicMaterial({ visible: false }));
    hit.rotation.x = Math.PI / 2;
    hit.userData.pick = kind;
    g.add(hit);
    pickables.push(hit);
    panel.add(g);
    knobs[kind] = { group: g, ptr };
    return g;
  }
  makeKnob('knob', -5.6, 1.6);
  makeKnob('fan', 0, 1.6);
  makeKnob('mode', 5.6, 1.6);

  /* 三个按钮：A/C / 循环 / 雨刮 */
  const buttons = {};
  function makeButton(kind, x, label) {
    const g = new THREE.Group();
    g.position.set(x, -3.2, 0.55);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.2, 0.7),
      new THREE.MeshStandardMaterial({ color: '#232c35', roughness: 0.5, metalness: 0.3 }));
    g.add(cap);
    const led = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.42), new THREE.MeshBasicMaterial({ color: '#33414d' }));
    led.position.set(0, 0.55, 0.38);
    g.add(led);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(5.2, 3.0, 2.0), new THREE.MeshBasicMaterial({ visible: false }));
    hit.userData.pick = kind;
    g.add(hit);
    pickables.push(hit);
    g.userData.pick = kind;
    panel.add(g);
    buttons[kind] = { group: g, led, cap };
    return g;
  }
  makeButton('ac', -5.4, 'A/C');
  makeButton('recirc', 0, '循环');
  makeButton('wiper', 5.4, '雨刮');

  /* 面板上的文字（CanvasTexture 贴片） */
  function makeTextPlane(text, w, h, color, bg) {
    const c = newCanvas(256, 128), g = c.getContext('2d');
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, 256, 128); }
    g.fillStyle = color || '#9fb6c8';
    g.font = '700 62px Inter, "PingFang SC", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 128, 66);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    return m;
  }
  const lblTemp = makeTextPlane('温度', 3.8, 1.9, '#8fb3c6');
  lblTemp.position.set(-5.6, 4.0, 0.6);
  panel.add(lblTemp);
  const lblFan = makeTextPlane('风量', 3.8, 1.9, '#8fb3c6');
  lblFan.position.set(0, 4.0, 0.6);
  panel.add(lblFan);
  const lblMode = makeTextPlane('风向', 3.8, 1.9, '#8fb3c6');
  lblMode.position.set(5.6, 4.0, 0.6);
  panel.add(lblMode);
  const lblAC = makeTextPlane('A/C', 3.4, 1.7, '#7dd3fc');
  lblAC.position.set(-5.4, -4.7, 0.6);
  panel.add(lblAC);
  const lblRec = makeTextPlane('内外循环', 5.2, 1.7, '#7dd3fc');
  lblRec.position.set(0, -4.7, 0.6);
  panel.add(lblRec);
  const lblWip = makeTextPlane('雨刮', 3.6, 1.7, '#7dd3fc');
  lblWip.position.set(5.4, -4.7, 0.6);
  panel.add(lblWip);

  /* ---- 出风口文字标注（Sprite，可关） ---- */
  function makeSprite(text, color) {
    const c = newCanvas(512, 128), g = c.getContext('2d');
    g.clearRect(0, 0, 512, 128);
    g.font = '700 46px Inter, "PingFang SC", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(2,6,23,0.72)';
    roundRect(g, 16, 26, 480, 76, 20); g.fill();
    g.strokeStyle = color; g.lineWidth = 3;
    roundRect(g, 16, 26, 480, 76, 20); g.stroke();
    g.fillStyle = color;
    g.fillText(text, 256, 66);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
    sp.scale.set(16, 4, 1);
    return sp;
  }
  const labelDefrost = makeSprite('除霜出风口（正对前挡）', '#7dd3fc');
  labelDefrost.position.set(-30, 36, -44);
  car.add(labelDefrost);
  const labelCenter = makeSprite('中央出风口', '#fdba74');
  labelCenter.position.set(24, 32, -20);
  car.add(labelCenter);
  const labelPanel = makeSprite('空调面板（可点）', '#a5f3fc');
  labelPanel.position.set(0, 19, -18);
  car.add(labelPanel);

  /* ==========================================================================
     八、相机 / 视角 / 全屏
     ========================================================================== */
  /* ★ 相机必须待在【车厢里、且在前排座椅前方】：默认 dist 一给大，相机就跑到
     主驾座椅靠背后面（靠背 z≈20.5、顶到 y=52）⇒ 画面被一片深色靠背糊死；
     反过来贴太近，方向盘与中控屏又会占满画面。实测这组参数刚好能同时看到
     仪表台、方向盘一角、除霜出风口和整块前挡玻璃。 */
  const VIEWS = {
    driver: { yaw: 0.12, pitch: 0.24, dist: 54, tx: 0, ty: 26, tz: -38 },
    center: { yaw: 0.0, pitch: 0.25, dist: 56, tx: 0, ty: 26, tz: -36 },
    glass: { yaw: 0.0, pitch: 0.05, dist: 46, tx: 0, ty: 40, tz: -54 },
    dash: { yaw: -0.02, pitch: 0.56, dist: 52, tx: 0, ty: 22, tz: -27 },
    outside: { yaw: Math.PI, pitch: 0.07, dist: 64, tx: 0, ty: 38, tz: -58 }
  };
  const view = Object.assign({}, VIEWS.driver);
  let currentView = 'driver';

  /* ★ 窄屏（手机竖屏）不能靠「把相机往后拉」——拉远就退到主驾靠背后面/车厢外，
     画面被一片深色糊死（实测 390px 下整屏全黑）。正确做法是【加大垂直 FOV】，
     相机留在原位（两座椅之间、靠背之前），视野自己变宽。 */
  const REF_ASPECT = 1.62;
  function fitFactor() {
    const a = camera.aspect || REF_ASPECT;
    return clamp(Math.pow(REF_ASPECT / Math.max(a, 0.2), 0.22), 1, 1.3);
  }
  function applyProjection() {
    const a = camera.aspect || REF_ASPECT;
    const narrow = clamp(REF_ASPECT / Math.max(a, 0.2), 1, 2.4);
    const fov = clamp(42 + (narrow - 1) * 30, 42, 72);
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  function updateCamera() {
    const t = new THREE.Vector3(view.tx || 0, view.ty || 0, view.tz || 0);
    const cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
    const dist = view.dist * fitFactor();
    camera.position.set(
      t.x + dist * cp * Math.sin(view.yaw),
      t.y + dist * sp,
      t.z + dist * cp * Math.cos(view.yaw)
    );
    camera.lookAt(t);
    /* ★ 必须立刻刷世界矩阵：否则「设完视角马上量屏幕落点」量到的是上一帧的相机 */
    camera.updateMatrixWorld(true);
    requestRender();
  }
  function applyView(name, silent) {
    const v = VIEWS[name];
    if (!v) return false;
    currentView = name;
    Object.assign(view, v);
    document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    updateCamera();
    if (!silent) updateScene(0);
    return true;
  }

  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    applyProjection();
    updateCamera();
    requestRender();
  }
  let fsPending = false, fsSecondPass = false;
  const relayout = () => {
    resize();
    drawMicro(0);
    requestRender();
    if (fsPending) fsSecond();
  };
  window.addEventListener('resize', relayout);
  if (window.ResizeObserver) new ResizeObserver(relayout).observe(stage);

  /* ---- 拖动旋转 + 滚轮缩放 + 点击拾取 ---- */
  let dragging = false, moved = 0, lastX = 0, lastY = 0, downPick = null, downX = 0, downY = 0;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  function pickAt(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(pickables, true);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.pick) o = o.parent;
      if (o && o.userData.pick) return o;
    }
    return null;
  }

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true; moved = 0;
    lastX = e.clientX; lastY = e.clientY;
    downX = e.clientX; downY = e.clientY;
    downPick = pickAt(e.clientX, e.clientY);
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) {
      const over = pickAt(e.clientX, e.clientY);
      canvas.classList.toggle('pick', !!over);
      return;
    }
    const dx = (e.clientX - lastX) / Math.max(canvas.clientWidth, 1);
    const dy = (e.clientY - lastY) / Math.max(canvas.clientHeight, 1);
    lastX = e.clientX; lastY = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    view.yaw -= dx * 3.0;
    view.pitch = clamp(view.pitch + dy * 2.2, -0.55, 1.15);
    updateCamera();
  });
  const endDrag = (e) => {
    if (dragging && moved < 0.012 && downPick) activate(downPick.userData.pick);
    dragging = false;
    downPick = null;
    canvas.style.cursor = 'grab';
    canvas.classList.remove('pick');
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    view.dist = clamp(view.dist * (1 + Math.sign(e.deltaY) * 0.08), 22, 320);
    updateCamera();
  }, { passive: false });

  /* ---- 全屏 ---- */
  const fsBtn = $('car-fs');
  const fsIsOn = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  function fsSecond() {
    if (fsSecondPass) return;
    fsSecondPass = true;
    fsPending = false;
    resize();
    state.fsLayouts++;
    requestRender();
  }
  if (fsBtn) {
    fsBtn.addEventListener('click', () => {
      if (fsIsOn()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else if (stage.requestFullscreen) stage.requestFullscreen();
      else if (stage.webkitRequestFullscreen) stage.webkitRequestFullscreen();
    });
  }
  document.addEventListener('fullscreenchange', () => {
    const on = fsIsOn();
    if (fsBtn) {
      const ex = fsBtn.querySelector('.fs-expand'), cp = fsBtn.querySelector('.fs-compress'), lb = fsBtn.querySelector('.lbl');
      if (ex) ex.style.display = on ? 'none' : '';
      if (cp) cp.style.display = on ? '' : 'none';
      if (lb) lb.textContent = on ? '退出' : '全屏';
      fsBtn.title = on ? '退出全屏' : '全屏显示实验画面';
    }
    fsSecondPass = false;
    fsPending = true;
    resize(); state.fsLayouts++;
    requestAnimationFrame(() => requestAnimationFrame(fsSecond));
    setTimeout(fsSecond, 90);
  });

  /* ==========================================================================
     九、参数面板（可折叠，住在舞台里）
     ========================================================================== */
  const paramsBox = $('car-params');
  const paramsToggle = $('car-params-toggle');
  const paramsBody = $('car-params-body');
  function paramsIsOpen() { return !!paramsBox && !paramsBox.classList.contains('collapsed'); }
  function setParamsOpen(on) {
    if (!paramsBox) return false;
    paramsBox.classList.toggle('collapsed', !on);
    if (paramsToggle) {
      paramsToggle.textContent = on ? '▾ 收起' : '▸ 展开';
      paramsToggle.setAttribute('aria-expanded', on ? 'true' : 'false');
    }
    requestRender();
    return true;
  }
  if (paramsToggle) paramsToggle.addEventListener('click', (e) => { e.stopPropagation(); setParamsOpen(!paramsIsOpen()); });
  if (paramsBox) {
    const head = paramsBox.querySelector('.params-head');
    if (head) head.addEventListener('click', (e) => { if (e.target === paramsToggle) return; setParamsOpen(!paramsIsOpen()); });
  }

  /* ==========================================================================
     十、交互动作（面板按钮 / 3D 拾取共用同一套入口）
     ========================================================================== */
  const KNOB_STOPS = [0.08, 0.3, 0.5, 0.7, 0.92];
  const MODE_ORDER = ['defrost', 'face', 'feet', 'mix'];

  function setKnob(v) {
    state.knob = clamp(v, 0, 1);
    state.progress.warmed = state.progress.warmed || (state.mode === 'defrost' && state.knob > 0.6 && state.fan >= 2);
    syncAll(); requestRender();
  }
  function setFan(v) {
    state.fan = clamp(Math.round(v), 0, 4);
    syncAll(); requestRender();
  }
  function setMode(m) {
    if (!MODE_JET[m]) return;
    state.mode = m;
    syncAll(); requestRender();
  }
  function setAC(on) { state.ac = !!on; syncAll(); requestRender(); }
  function setRecirc(on) { state.recirc = !!on; syncAll(); requestRender(); }
  function setWindow(on) { state.windowOpen = !!on; syncAll(); requestRender(); }
  function setWiperAuto(on) { state.wiperAuto = !!on; if (on) triggerWipe(); syncAll(); requestRender(); }
  function triggerWipe() {
    state.wiperPhase = 0.0001;
    state.wiperTimer = 0;
    state.progress.wiped = true;
    /* 刮一下：外表面雾立刻掉到 15%（剩下的是刮不干净的边角） */
    state.fogOut = Math.min(state.fogOut, 0.15);
    state.wiperSweeps++;
    DRAWN.wiperSweeps = state.wiperSweeps;
    syncAll(); requestRender();
  }
  function activate(kind) {
    if (kind === 'knob') {
      const i = KNOB_STOPS.findIndex((v) => v > state.knob + 0.01);
      setKnob(i < 0 ? KNOB_STOPS[0] : KNOB_STOPS[i]);
    } else if (kind === 'fan') {
      setFan((state.fan + 1) % 5);
    } else if (kind === 'mode') {
      setMode(MODE_ORDER[(MODE_ORDER.indexOf(state.mode) + 1) % MODE_ORDER.length]);
    } else if (kind === 'ac') {
      setAC(!state.ac);
    } else if (kind === 'recirc') {
      setRecirc(!state.recirc);
    } else if (kind === 'wiper') {
      triggerWipe();
    }
  }

  /* ==========================================================================
     十一、物理步进（唯一的状态演化入口）
     ========================================================================== */
  function resetCase(key, keepControls) {
    const c = CASES[key] || CASES.winter;
    state.caseKey = c.key;
    state.t = 0;
    state.glassT = c.glassT0;
    state.dIn = dOf(c.inT, c.inRH);
    state.fogIn = c.fogIn0;
    state.fogOut = c.fogOut0;
    state.wiperPhase = 0;
    state.wiperTimer = 0;
    state.wiperSweeps = 0;
    if (!keepControls) {
      if (c.key === 'summer') {
        /* 夏季的真实场景：空调开着、出风口对着前挡吹冷风 ⇒ 玻璃被吹冷 ⇒ 外表面起雾。
           若默认关 A/C，吹的是车外 31 ℃ 的热风，玻璃反而被加热、雾自己就消了。 */
        state.knob = 0.14; state.fan = 2; state.mode = 'face';
        state.ac = true; state.recirc = false;
      } else {
        state.knob = 0.26; state.fan = 2; state.mode = 'defrost';
        state.ac = false; state.recirc = true;
      }
      state.windowOpen = false;
      state.wiperAuto = false;
    }
    if (c.key === 'summer') state.progress.summerTried = true;
    syncAll(); updateScene(0); requestRender();
  }

  function stepPhysics(dt) {
    if (!isNum(dt) || dt <= 0) return false;
    const c = CASES[state.caseKey];
    const s = state;

    /* ---- ① 送风与射流 ---- */
    const Tb = blowTemp(s);
    const kJet = jetCoeff(s);

    /* ---- ② 玻璃温度：车内自然对流 + 车外对流 + 送风射流 ---- */
    const dTg = (K_IN * (c.inT - s.glassT) + K_OUT * (c.outT - s.glassT) + kJet * (Tb - s.glassT)) / GLASS_C;
    s.glassT += dTg * dt;

    /* ---- ③ 车内湿度：换气 / A/C 除湿 / 乘员加湿 / 玻璃凝结失水 ---- */
    const dOut = dOf(c.outT, c.outRH);
    const pvIn = pvOfD(s.dIn);
    const supIn = pvIn / pSat(s.glassT) - 1;

    /* 换气：外循环或开窗时，车内空气被车外空气替换 */
    if (s.windowOpen) {
      s.dIn += (dOut - s.dIn) * (1 - Math.exp(-dt / 18));
    } else if (!s.recirc) {
      s.dIn += (dOut - s.dIn) * (1 - Math.exp(-dt / 85));
    }

    /* A/C 除湿：送风含湿量被压到 5.2 g/kg，除湿能力随风量 */
    if (s.ac && s.fan > 0) {
      const k = 0.016 * s.fan;
      s.dIn += (5.2 - s.dIn) * (1 - Math.exp(-k * dt));
    }

    /* 乘员呼吸 / 湿衣物：内循环时积得最快 */
    s.dIn += (s.recirc ? 0.0040 : 0.0028) * dt;

    /* 玻璃表面凝结 / 蒸发：过饱和析水（dIn 降），不饱和时雾滴汽化（dIn 升） */
    s.dIn -= clamp(supIn, -0.8, 0.8) * 0.009 * dt;
    s.dIn = clamp(s.dIn, 1.0, 26);

    /* ---- ④ 结雾 / 消雾：相对过饱和度驱动的一阶过程 ---- */
    const pvIn2 = pvOfD(s.dIn);
    const fInT = fogTargetOf(pvIn2, s.glassT);
    const tauIn = fInT > s.fogIn ? 4.2 : 3.0;
    s.fogIn += (fInT - s.fogIn) * (1 - Math.exp(-dt / tauIn));

    /* 外表面：车外空气的湿度是环境值，玻璃温度决定它饱不饱和。
       外表面比内表面略高一点点（车外对流换热）。 */
    const TgOut = s.glassT + 0.4;
    const fOutT = fogTargetOf(pvOfD(dOut), TgOut);
    const tauOut = fOutT > s.fogOut ? 4.0 : 2.6;
    s.fogOut += (fOutT - s.fogOut) * (1 - Math.exp(-dt / tauOut));

    /* ---- ⑤ 雨刮 ---- */
    if (s.wiperPhase > 0) {
      s.wiperPhase += dt / 1.35;
      if (s.wiperPhase >= 1) { s.wiperPhase = 0; }
    }
    if (s.wiperAuto) {
      s.wiperTimer += dt;
      if (s.wiperTimer > 2.8) { s.wiperTimer = 0; triggerWipe(); }
    }

    /* ---- ⑥ 进度判定（侧栏步骤逐条点亮） ---- */
    const pr = s.progress;
    if (s.knob < 0.3 && s.recirc && !s.ac && s.fan > 0) pr.coldTried = true;
    if (s.mode === 'defrost' && s.knob > 0.6 && s.fan >= 2 && s.fogIn < 0.45) pr.warmed = true;
    if (s.ac && !s.recirc && s.fogIn < 0.12) pr.dried = true;

    s.t += dt;
    return true;
  }

  /* ==========================================================================
     十二、场景更新（把状态写进真正落笔的那一份量）
     ========================================================================== */
  function setOpacityMat(mat, v) {
    const nv = Math.round(clamp(v, 0, 1) * 1000) / 1000;
    if (mat.opacity !== nv) mat.opacity = nv;
  }
  function setColor(hexStr) { return new THREE.Color(hexStr); }

  function flowColorFor(Tb) {
    if (Tb >= 34) return [1.0, 0.36, 0.02];
    if (Tb >= 24) return [1.0, 0.62, 0.10];
    if (Tb >= 15) return [0.10, 0.72, 0.98];
    return [0.02, 0.28, 0.95];
  }

  let lastSceneSig = '';
  function updateScene(dt) {
    const s = state;
    const Tb = blowTemp(s);
    const kJet = jetCoeff(s);

    DRAWN.glassT = s.glassT;
    DRAWN.fogIn = s.fogIn;
    DRAWN.fogOut = s.fogOut;
    DRAWN.blowT = Tb;
    DRAWN.jet = kJet;

    /* 雾层透明度 —— 这就是「真正落笔」的那一份 */
    const opIn = s.showFog ? Math.pow(clamp(s.fogIn, 0, 1), 0.78) * 0.99 : 0;
    const opOut = s.showFog ? Math.pow(clamp(s.fogOut, 0, 1), 0.78) * 0.98 : 0;
    setOpacityMat(fogMatIn, opIn);
    setOpacityMat(fogMatOut, opOut);
    for (const m of sideFogMat) setOpacityMat(m, opIn * 0.75);
    DRAWN.fogOpacityIn = fogMatIn.opacity;
    DRAWN.fogOpacityOut = fogMatOut.opacity;

    /* 气流 */
    const active = s.showFlow && s.fan > 0;
    flowPoints.visible = active;
    const PER = Math.ceil(FLOW_N / FLOW_LINES);
    const perLine = s.fan <= 0 ? 0 : Math.max(1, Math.round((s.fan / 4) * PER));
    const col = flowColorFor(Tb);
    let written = 0;
    for (let i = 0; i < FLOW_N; i++) {
      const p = flowParts[i];
      const inThisFan = (i % PER) < perLine;
      if (!active || !inThisFan) {
        flowPos[i * 3] = 0; flowPos[i * 3 + 1] = -999; flowPos[i * 3 + 2] = 0;
        continue;
      }
      if (dt > 0) {
        p.t += p.v * dt * (0.55 + s.fan * 0.16);
        if (p.t > 1) p.t -= 1;
      }
      const pt = flowPaths[p.line].getPoint(p.t);
      flowPos[i * 3] = pt.x + p.jitter * (0.4 + p.t);
      flowPos[i * 3 + 1] = pt.y + p.jitter2 * 0.5;
      flowPos[i * 3 + 2] = pt.z + p.jitter2 * (0.3 + p.t * 0.5);
      const fade = 0.30 + 0.70 * (1 - Math.pow(p.t, 2.2));
      flowCol[i * 3] = col[0] * fade;
      flowCol[i * 3 + 1] = col[1] * fade;
      flowCol[i * 3 + 2] = col[2] * fade;
      written++;
    }
    flowGeo.attributes.position.needsUpdate = true;
    flowGeo.attributes.color.needsUpdate = true;
    DRAWN.flowCount = written;

    /* 雨刮：扫过去再扫回来（sin 半周），角度绕玻璃法线 */
    let ang = 0;
    if (s.wiperPhase > 0) ang = Math.sin(Math.PI * clamp(s.wiperPhase, 0, 1)) * 0.62;
    for (const w of wiperPivots) w.spin.rotation.z = -w.dir * ang;
    DRAWN.wiperAngle = ang;

    /* 旋钮指针 / 按钮 LED */
    if (knobs.knob) knobs.knob.ptr.rotation.z = -(-2.2 + s.knob * 4.4);
    if (knobs.fan) knobs.fan.ptr.rotation.z = -(-2.2 + (s.fan / 4) * 4.4);
    if (knobs.mode) knobs.mode.ptr.rotation.z = -(-2.2 + (MODE_ORDER.indexOf(s.mode) / 3) * 4.4);
    const ledOn = '#4ade80', ledOff = '#33414d';
    if (buttons.ac) buttons.ac.led.material.color.set(s.ac ? ledOn : ledOff);
    if (buttons.recirc) buttons.recirc.led.material.color.set(s.recirc ? '#fbbf24' : ledOff);
    if (buttons.wiper) buttons.wiper.led.material.color.set(s.wiperAuto ? ledOn : ledOff);

    /* 标注 / 外壳开关 */
    labelDefrost.visible = s.showLabels;
    labelCenter.visible = s.showLabels;
    labelPanel.visible = s.showLabels;

    /* 读数派生的量 */
    DRAWN.pvIn = pvOfD(s.dIn);
    DRAWN.pvOut = pvOfD(dOf(CASES[s.caseKey].outT, CASES[s.caseKey].outRH));
    DRAWN.dewIn = dewOfD(s.dIn);
    DRAWN.dewOut = dewOfD(dOf(CASES[s.caseKey].outT, CASES[s.caseKey].outRH));
    DRAWN.rhIn = clamp(DRAWN.pvIn / pSat(CASES[s.caseKey].inT) * 100, 0, 100);

    return true;
  }

  /* ==========================================================================
     十三、微观示意（玻璃剖面：水蒸气 ⇄ 小水珠）
     ========================================================================== */
  const microCv = $('microCanvas');
  const microCtx = microCv ? microCv.getContext('2d') : null;
  const microParts = [];
  {
    const r = mulberry(90210);
    for (let i = 0; i < 44; i++) {
      microParts.push({
        x: 0.1 + r() * 0.8, y: 0.1 + r() * 0.8,
        vx: (r() - 0.5) * 0.5, vy: (r() - 0.5) * 0.5,
        stuck: false, sx: 0, sy: 0, r: 1.2 + r() * 1.6
      });
    }
  }
  function drawMicro(dt) {
    if (!microCtx) return;
    const W = microCv.width, H = microCv.height;
    const g = microCtx;
    g.clearRect(0, 0, W, H);

    /* 左：车外；中：玻璃；右：车内 */
    const gx = W * 0.46, gw = W * 0.11;
    const grd = g.createLinearGradient(gx, 0, gx + gw, 0);
    grd.addColorStop(0, '#7fb6d6');
    grd.addColorStop(0.5, '#d8eef8');
    grd.addColorStop(1, '#9fd0e6');
    g.fillStyle = grd; g.fillRect(gx, 0, gw, H);

    /* 玻璃温度色条（冷=蓝，热=橙） */
    const hot = clamp((state.glassT - 6) / 34, 0, 1);
    g.fillStyle = 'rgba(' + Math.round(90 + hot * 165) + ',' + Math.round(180 - hot * 70) + ',' + Math.round(230 - hot * 150) + ',0.55)';
    g.fillRect(gx, 0, gw, H);

    g.font = '600 17px Inter, "PingFang SC", sans-serif';
    g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillStyle = 'rgba(190,220,238,0.75)';
    g.fillText('车外 ' + CASES[state.caseKey].outT.toFixed(0) + ' ℃', 6, 6);
    g.textAlign = 'right';
    g.fillText('车内 ' + state.glassT.toFixed(1) + ' ℃ 玻璃', W - 6, 6);

    /* 水分子：右侧（车内）自由飞，撞到玻璃若过饱和就粘住 */
    const sat = state.fogIn;
    for (const p of microParts) {
      if (p.stuck) {
        /* 水珠：贴在玻璃右壁上 */
        g.fillStyle = 'rgba(236,248,255,0.92)';
        g.beginPath(); g.arc(p.sx, p.sy, p.r * (0.7 + sat * 0.7), 0, Math.PI * 2); g.fill();
        if (dt > 0 && sat < 0.12 && Math.random() < dt * 1.6) { p.stuck = false; p.x = 0.9; p.y = Math.random(); }
        continue;
      }
      if (dt > 0) {
        p.x += p.vx * dt * 0.55;
        p.y += p.vy * dt * 0.55;
        if (p.y < 0.06 || p.y > 0.94) p.vy = -p.vy;
        if (p.x < 0.06) { p.x = 0.06; p.vx = Math.abs(p.vx); }
        if (p.x > 0.94) { p.x = 0.94; p.vx = -Math.abs(p.vx); }
      }
      /* 撞到玻璃右壁 */
      const wall = (gx + gw) / W;
      if (p.x < wall + 0.02 && p.x > wall - 0.01 && Math.random() < 0.55) {
        if (sat > 0.25 && Math.random() < sat) {
          p.stuck = true;
          p.sx = gx + gw + 2 + Math.random() * 4;
          p.sy = clamp(p.y * H, 12, H - 8);
        } else {
          p.x = wall + 0.05; p.vx = Math.abs(p.vx);
        }
      }
      g.fillStyle = 'rgba(120,205,245,0.85)';
      g.beginPath(); g.arc(p.x * W, p.y * H, 2.0, 0, Math.PI * 2); g.fill();
    }

    /* 暖风箭头：玻璃被吹热时，水珠汽化飞走 */
    if (state.jet > 0.4 && state.glassT > state.glassT - 1) {
      const hotBlow = blowTemp(state) > 30;
      if (hotBlow) {
        g.strokeStyle = 'rgba(251,146,60,0.85)';
        g.lineWidth = 2.4;
        g.beginPath();
        g.moveTo(W - 6, H - 16);
        g.lineTo(gx + gw + 26, H * 0.62);
        g.stroke();
        g.beginPath();
        g.moveTo(gx + gw + 26, H * 0.62);
        g.lineTo(gx + gw + 34, H * 0.62 + 7);
        g.lineTo(gx + gw + 34, H * 0.62 - 5);
        g.closePath();
        g.fillStyle = 'rgba(251,146,60,0.9)'; g.fill();
      }
    }
  }

  /* ==========================================================================
     十四、读数 / 状态 / 步骤 / 结论
     ========================================================================== */
  function setText(el, s) { if (el && el.textContent !== s) el.textContent = s; }
  function setClass(el, name, on) { if (el) el.classList.toggle(name, !!on); }

  function stateInfo() {
    const dew = DRAWN.dewIn;
    if (state.fogIn > 0.5) {
      return { text: '内表面起雾严重', note: '车内水蒸气在冷玻璃上液化', cls: 'bad', metric: 'bad' };
    }
    if (state.fogIn > 0.12) {
      return { text: '内表面轻微起雾', note: '玻璃温度仍低于露点 ' + dew.toFixed(1) + ' ℃', cls: 'warn', metric: 'warn' };
    }
    if (state.fogOut > 0.5) {
      return { text: '外表面起雾（雾在玻璃外面）', note: '车外湿热空气被冷玻璃冷却', cls: 'bad', metric: 'bad' };
    }
    if (state.fogOut > 0.12) {
      return { text: '外表面轻微起雾', note: '雨刮或提高玻璃温度可除', cls: 'warn', metric: 'warn' };
    }
    return { text: '玻璃清晰', note: '玻璃温度高于露点，水蒸气不再饱和', cls: 'ok', metric: 'ok' };
  }

  let uiAcc = 0;
  const cache = {};
  function syncAll() {
    const info = stateInfo();
    const dew = DRAWN.dewIn || dewOfD(state.dIn);
    const c = CASES[state.caseKey];

    /* 舞台左上状态 */
    const chip = $('stateChip');
    if (chip) {
      const html = '玻璃 ' + state.glassT.toFixed(1) + ' ℃　车内 ' + c.inT.toFixed(0) + ' ℃ / ' +
        Math.round(DRAWN.rhIn || 0) + '%　→ ' + info.text +
        '<em>（' + info.note + '）</em>';
      if (cache.chip !== html) { chip.innerHTML = html; cache.chip = html; }
    }
    /* HUD */
    setText($('hudGlass'), state.glassT.toFixed(1));
    setText($('hudDew'), dew.toFixed(1));
    setText($('hudRH'), String(Math.round(DRAWN.rhIn || 0)));
    setText($('hudFogIn'), String(Math.round(state.fogIn * 100)));
    setText($('hudFogOut'), String(Math.round(state.fogOut * 100)));

    /* 指标卡 */
    setText($('metricGlass'), state.glassT.toFixed(1) + ' ℃');
    setText($('metricDew'), dew.toFixed(1) + ' ℃');
    setText($('metricFogIn'), Math.round(state.fogIn * 100) + ' %');
    setText($('metricFogOut'), Math.round(state.fogOut * 100) + ' %');
    setClass($('mGlass'), 'ok', state.glassT > dew + 0.5);
    setClass($('mGlass'), 'bad', state.glassT < dew - 3);
    setClass($('mIn'), 'ok', state.fogIn < 0.12);
    setClass($('mIn'), 'bad', state.fogIn > 0.5);
    setClass($('mIn'), 'warn', state.fogIn >= 0.12 && state.fogIn <= 0.5);
    setClass($('mOut'), 'ok', state.fogOut < 0.12);
    setClass($('mOut'), 'bad', state.fogOut > 0.5);
    setClass($('mOut'), 'warn', state.fogOut >= 0.12 && state.fogOut <= 0.5);

    /* 参数面板控件 */
    document.querySelectorAll('[data-case]').forEach((b) => setClass(b, 'active', b.dataset.case === state.caseKey));
    document.querySelectorAll('[data-fan]').forEach((b) => setClass(b, 'active', Number(b.dataset.fan) === state.fan));
    document.querySelectorAll('[data-mode]').forEach((b) => setClass(b, 'active', b.dataset.mode === state.mode));
    const knobEl = $('knob');
    if (knobEl && Number(knobEl.value) !== Math.round(state.knob * 100)) knobEl.value = String(Math.round(state.knob * 100));
    const knobOut = $('knobOut');
    if (knobOut) {
      const Tb = blowTemp(state);
      const tag = state.knob < 0.25 ? '最冷' : state.knob < 0.45 ? '偏冷' : state.knob < 0.6 ? '中间' : state.knob < 0.8 ? '偏热' : '最热';
      setText(knobOut, tag + ' · 送风 ' + Tb.toFixed(0) + ' ℃');
    }
    const acEl = $('acOn'); if (acEl) acEl.checked = state.ac;
    const recEl = $('recirc'); if (recEl) recEl.checked = state.recirc;
    const winEl = $('windowOpen'); if (winEl) winEl.checked = state.windowOpen;
    const wipEl = $('wiperAuto'); if (wipEl) wipEl.checked = state.wiperAuto;

    /* 步骤 */
    const pr = state.progress;
    const done = [state.t > 8 || state.fogIn > 0.5, pr.coldTried, pr.warmed, pr.dried, pr.summerTried];
    document.querySelectorAll('#stepList li').forEach((li, i) => {
      setClass(li, 'on', !!done[i]);
      setClass(li, 'cur', !done[i] && done.slice(0, i).every(Boolean));
    });
    /* 结论 */
    const laws = [state.fogIn > 0.05 || state.fogOut > 0.05, true, pr.warmed, pr.dried];
    document.querySelectorAll('#lawList li').forEach((li, i) => setClass(li, 'on', !!laws[i]));

    /* 底部提示 */
    const hint = $('barHint');
    if (hint) {
      let t;
      if (state.fogOut > 0.3) t = '雾在玻璃外面 —— 暖风没用，先刮一下雨刮；根治要把冷风调离前挡、或提高送风温度。';
      else if (state.fogIn > 0.45 && state.mode !== 'defrost') t = '雾还在。先把吹风方向切到「除霜」，风量开到 3 档以上。';
      else if (state.fogIn > 0.45 && state.knob < 0.5) t = '风量够了，但送风还是凉的 —— 把温度旋钮往「热」那边拧。';
      else if (state.fogIn > 0.2) t = '雾在退。玻璃温度已经 ' + state.glassT.toFixed(1) + ' ℃，再等几秒。';
      else if (state.fogIn <= 0.2 && state.mode === 'defrost') t = '玻璃清晰了。想让雾不再回来，按 A/C 除湿、切外循环。';
      else t = '玻璃清晰。切到「夏季」看看雾跑到外面去的情况。';
      setText(hint, t);
    }

    /* 微观文字 */
    const mt = $('microText');
    if (mt) {
      let t;
      if (state.fogIn > 0.4) t = '水蒸气分子撞到冷玻璃，液化粘住 → 起雾';
      else if (state.fogIn > 0.12) t = '雾在变薄：一部分水珠正在汽化';
      else if (state.glassT > dew) t = '玻璃比露点热，水珠汽化飞走 → 玻璃清晰';
      else t = '玻璃表面干净：水蒸气还饱和不了';
      setText(mt, t);
    }
  }

  /* ==========================================================================
     十五、主循环
     --------------------------------------------------------------------------
     🔴 这里是本站踩过的最狠的坑：几何在动、画面却冻死。所以【必须显式】
        requestRender() —— 不能指望改数据的函数顺手刷。
     ========================================================================== */
  let dirty = true;
  let renderCount = 0;
  function requestRender() { dirty = true; }
  function renderNow() { renderer.render(scene, camera); dirty = false; renderCount++; }

  function frameStep(dtReal) {
    let moved = false;
    const dt = Math.min(dtReal * state.speed, 0.22);
    if (!state.paused) {
      if (stepPhysics(dt)) moved = true;
    }
    updateScene(state.paused ? 0 : dt);
    drawMicro(state.paused ? 0 : dt);
    uiAcc += dtReal;
    if (uiAcc >= 0.1) { uiAcc = 0; syncAll(); }
    if (moved) requestRender();
    if (dirty) renderNow();
  }

  /* ==========================================================================
     十六、启动
     ========================================================================== */
  function bindClick(id, fn) { const el = $(id); if (el) el.addEventListener('click', fn); }

  document.querySelectorAll('[data-case]').forEach((b) => b.addEventListener('click', () => resetCase(b.dataset.case)));
  document.querySelectorAll('[data-fan]').forEach((b) => b.addEventListener('click', () => setFan(Number(b.dataset.fan))));
  document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  const knobEl = $('knob');
  if (knobEl) knobEl.addEventListener('input', () => setKnob(Number(knobEl.value) / 100));
  const acEl = $('acOn'); if (acEl) acEl.addEventListener('change', () => setAC(acEl.checked));
  const recEl = $('recirc'); if (recEl) recEl.addEventListener('change', () => setRecirc(recEl.checked));
  const winEl = $('windowOpen'); if (winEl) winEl.addEventListener('change', () => setWindow(winEl.checked));
  const wipEl = $('wiperAuto'); if (wipEl) wipEl.addEventListener('change', () => setWiperAuto(wipEl.checked));
  const showFlowEl = $('showFlow'); if (showFlowEl) showFlowEl.addEventListener('change', () => { state.showFlow = showFlowEl.checked; updateScene(0); requestRender(); });
  const showFogEl = $('showFog'); if (showFogEl) showFogEl.addEventListener('change', () => { state.showFog = showFogEl.checked; updateScene(0); requestRender(); });
  const showLblEl = $('showLabels'); if (showLblEl) showLblEl.addEventListener('change', () => { state.showLabels = showLblEl.checked; updateScene(0); requestRender(); });
  const footFlow = $('footFlow'); if (footFlow) footFlow.addEventListener('change', () => { state.showFlow = footFlow.checked; if (showFlowEl) showFlowEl.checked = footFlow.checked; updateScene(0); requestRender(); });
  const footFog = $('footFog'); if (footFog) footFog.addEventListener('change', () => { state.showFog = footFog.checked; if (showFogEl) showFogEl.checked = footFog.checked; updateScene(0); requestRender(); });

  document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => applyView(b.dataset.view)));
  bindClick('car-reset-view', () => applyView('driver'));

  bindClick('demoWinter', () => {
    resetCase('winter', true);
    setKnob(0.86); setFan(3); setMode('defrost'); setAC(true); setRecirc(false); setWindow(false); setWiperAuto(false);
    state.speed = 4; state.paused = false;
    syncAll(); requestRender();
  });
  bindClick('demoSummer', () => {
    resetCase('summer', true);
    setKnob(0.14); setFan(2); setMode('face'); setAC(true); setRecirc(false); setWindow(false); setWiperAuto(false);
    state.speed = 4; state.paused = false;
    syncAll(); requestRender();
  });
  bindClick('wipeBtn', () => triggerWipe());
  bindClick('pauseBtn', () => {
    state.paused = !state.paused;
    const b = $('pauseBtn');
    if (b) { b.textContent = state.paused ? '继续' : '暂停'; b.classList.toggle('on', state.paused); }
    requestRender();
  });
  bindClick('resetBtn', () => {
    resetCase(state.caseKey, false);
    state.speed = 3; state.paused = false;
    const b = $('pauseBtn'); if (b) { b.textContent = '暂停'; b.classList.remove('on'); }
    state.progress = { coldTried: false, warmed: false, dried: false, summerTried: state.caseKey === 'summer', wiped: false };
    syncAll(); requestRender();
  });

  /* ---- 初始化 ---- */
  resetCase('winter', false);
  state.progress = { coldTried: false, warmed: false, dried: false, summerTried: false, wiped: false };
  updateScene(0);
  updateCamera();
  resize();
  applyView('driver', true);
  syncAll();
  drawMicro(0);
  renderNow();

  /* 🔴 必须限帧：软件渲染（无头 / 无独显）下每帧都真画一次，不节流会把主线程占满，
     CDP 连截图都超时（本轮实测）。22 fps 对这套热湿过程完全够用。 */
  const FRAME_MS = 45;
  let last = performance.now(), lastFrameAt = 0;
  (function loop(now) {
    requestAnimationFrame(loop);
    const t = now || performance.now();
    let dt = (t - last) / 1000;
    if (t - lastFrameAt < FRAME_MS) return;
    lastFrameAt = t;
    last = t;
    if (!isNum(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, 0.12);
    frameStep(dt);
  })(last);
  /* 无头兜底：本机 headless 可能一次 rAF 都不回调 */
  setTimeout(() => { if (dirty) renderNow(); }, 1200);

  /* ==========================================================================
     十七、对外导出面（无头验收）
     --------------------------------------------------------------------------
     导出的都是【算这些量的函数本身】或【真正落笔的那一份几何】，
     不是另抄的快照 —— 自检若自己重抄一遍公式，把页面里改坏了照样全绿。
     ========================================================================== */
  window.__car = {
    state, view, CASES, DRAWN, KNOB_STOPS, MODE_ORDER,
    pSat, dewPointOf, dOf, pvOfD, dewOfD,
    blowTemp, jetCoeff, fogTargetOf, stepPhysics,
    setCase: (k) => resetCase(k),
    setKnob, setFan, setMode, setAC, setRecirc, setWindow, setWiperAuto,
    activate, applyView, setParamsOpen, paramsIsOpen, triggerWipe, updateScene,
    get renderCount() { return renderCount; },
    get rendererInfo() { return renderer.info.render; },
    requestRender, renderNow,
    pickAt,
    screenOf(x, y, z) {
      const v = new THREE.Vector3(x, y, z).project(camera);
      const r = canvas.getBoundingClientRect();
      return { x: (v.x * 0.5 + 0.5) * r.width, y: (-v.y * 0.5 + 0.5) * r.height, z: v.z };
    },
    glass: { w: G.w, len: G.len, tilt: G.tilt, y0: G.y0, z0: G.z0, y1: G.y1, z1: G.z1 },
    fogMeshes: { in: fogInMesh, out: fogOutMesh, glass: glassMesh },
    pickables: pickables.map((p) => p.userData.pick),
    frameStep
  };
})();
