import * as THREE from './assets/optics-three.min.js';

/* ============================================================================
   温度计的使用 —— 三维写实测温实验台（人教版八上 第三章 第1节 温度）
   ---------------------------------------------------------------------------
   世界坐标单位：厘米（cm），y 轴向上，实验台台面为 y = 0。
   器材：铁架台（铸铁底座 + 镀铬立柱 + 十字夹）、酒精灯、石棉网、铁圈、
         硼硅玻璃烧杯 + 水（可放冰块）、两支可换的温度计（实验室温度计 / 体温计）。
   物理：
     ① 示数滞后 —— 玻璃泡与被测液体之间是有限速率的换热，示数按一阶滞后趋近
        「玻璃泡感受到的温度」，所以刚插进去读不准，要等示数稳定。
     ② 玻璃泡位置偏差 —— 玻璃泡测的是【它接触到的物质】的温度。按「接触面积 ×
        换热系数」加权：水 500、空气 18、被火焰加热的玻璃杯底 900 W/(m²·K)。
        碰杯底：约 45% 泡面贴住杯底，杯底内表面比水体平均温度高 15 ℃ → 明显偏大。
        碰杯壁：杯壁外侧和空气换热，内表面温度偏向室温 → 偏差方向随水温和室温的关系变号。
        只浸入一半：一半泡面在空气里 → 偏向室温，同样会变号。
     ③ 视线视差 —— 刻度印在玻璃管前表面（半径 r），红色液柱在管中心，两者相隔 r。
        眼睛在距管 D、比液柱高（低）Δy 处，视线与刻度面相交的高度
        y_read = h + (r/D)·Δy，换算成温度 ΔT = (r/D)·Δy ÷ (每 ℃ 的刻度高度)。
        俯视 Δy > 0 → 读数偏大；仰视 Δy < 0 → 读数偏小。这不是写死的数。
     ④ 量程与分度值 —— 读数按分度值取整；超出量程时液柱顶到管口并报警。
     ⑤ 缩口 —— 体温计玻璃泡上方有缩口，离开液体后示数冻结；实验室温度计会回落。
   ========================================================================== */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  /* ------------------------------ 器材尺寸 ------------------------------ */
  const BASE_W = 24, BASE_D = 16, BASE_H = 1.8;      // 铸铁底座
  const ROD_R = 0.55, ROD_H = 37, ROD_Z = -5.2;      // 镀铬立柱
  const RING_Y = 15.6;                               // 铁圈高度

  const NET_W = 11.6, NET_T = 0.22;                  // 石棉网
  const LAMP_R = 3.5, LAMP_H = 6.9;
  const LAMP_COLLAR_H = 1.4, WICK_H = 1.7;
  const LAMP_TOP = BASE_H + LAMP_H + LAMP_COLLAR_H + WICK_H;   // 11.8
  const FLAME_H = 5.0;
  const LAMP_X = 0;                                  // 酒精灯一直在杯下加热

  // 低型烧杯（250 mL 量级）：直径 8.4 cm、高 6.6 cm
  const BK_R = 4.2, BK_H = 6.6;
  const BK_Y0 = RING_Y + NET_T + 0.06;               // 15.88
  const WATER_H = 3.8;
  const WATER_TOP = BK_Y0 + WATER_H;                 // 19.68
  const BK_INNER_R = BK_R - 0.1;                     // 4.1
  const BK_INNER_BOTTOM = BK_Y0 + 0.55;              // 16.43（加厚杯底的顶面）

  /* 温度计：管长足够让铁夹在管身中段夹住它 */
  const TH_BULB_R = 0.42;
  const TH_TUBE_R = 0.24;
  const TH_TUBE_H = 18.6;
  const CLAMP_Y = 29.5;                              // 铁夹横梁高度
  const LIFT_DY = 5.6;                               // 「提起温度计」抬升量（玻璃泡离开水面）

  /* 玻璃泡的四种放法（玻璃泡中心的世界坐标）。
     base 那一档（全部浸入）就是温度计组的原点，其余都是相对它的偏移。 */
  const TH_BULB_Y_BASE = BK_INNER_BOTTOM + 1.35;     // 17.78
  const PLACE_POS = {
    right:  { x: 0,                     y: TH_BULB_Y_BASE },
    bottom: { x: 0,                     y: BK_INNER_BOTTOM + TH_BULB_R },
    wall:   { x: BK_INNER_R - TH_BULB_R, y: TH_BULB_Y_BASE },
    half:   { x: 0,                     y: WATER_TOP }
  };

  /* 印刷刻度：贴图尺寸与版面。刻度条要正对哪个方位角，由 makeScale() 量出墨迹后反算。 */
  const SCALE_TEX_W = 160, SCALE_TEX_H = 1024;
  const SCALE_FACE_DEG = -25;
  const SCALE_TICK_X = 71;
  const SCALE_NUM_X = 75;
  const SCALE_NUM_FONT = 20;
  const SCALE_Y0 = 0;                                // 刻度下限（贴图最下一行）在管身的局部高度
  const SCALE_Y1 = TH_TUBE_H - 1.2;                  // 刻度上限

  /* ------------------------------ 物理参数 ------------------------------ */
  const AMB = 20;                                    // 室温 ℃
  const TAU_TH = 9;                                  // 温度计的时间常数 s（示数滞后）
  const TAU_VIS = 1.1;                               // 水温的视觉过渡（只影响颜色 / 白气 / 冰块）

  /* 玻璃泡「感受到」的温度 = 它接触到的各部分的加权平均。
     —— 水的自然对流换热系数约 500 W/(m²·K)，空气（对流 + 辐射）约 18。
     碰杯底：热量从杯底进入水里，最下面那一层水最热（真实实验要不断搅拌就是这个原因），
             压在水底上的玻璃泡读到的是这一层 —— 比水体平均温度高 BOTTOM_DT ℃。
     碰杯壁：杯壁内表面由「水侧」和「空气侧」两个串联热阻定温：
             T_wall = (h_水·Tw + h_空·Ta)/(h_水 + h_空) = Tw − (Tw − Ta)·WALL_K，
             所以壁温其实很接近水温（WALL_K ≈ 0.035），偏差只有 1 ℃ 上下 ——
             但它的方向随「水温比室温高还是低」变号，方向不可控才是规则要禁它的原因。
     只浸入一半：一半泡面在空气里，按 h·A 加权，同样偏向室温、同样会变号。 */
  const H_WATER = 500, H_AIR = 18;
  const WALL_K = H_AIR / (H_WATER + H_AIR);          // ≈ 0.0348
  const BOTTOM_DT = 6.0;                             // 杯底那一层水比水体平均温度高多少 ℃
  const CONTACT_WALL = 0.45;                         // 碰杯壁时贴住杯壁的泡面比例
  const HALF_F = 0.5;                                // 「只浸入一半」时在空气中的泡面比例

  /* 视线视差：眼睛到温度计的距离、俯视 / 仰视时眼睛比液柱高（低）多少。
     20 cm 是「把温度计拿到眼前看」的距离；距离越近视差越大 —— 这也是读数时要正对着看的原因。 */
  const EYE_DIST = 20;                               // cm
  const EYE_DY = 12;                                 // cm
  /* 眼球只是「观察者」的符号，不是实验器材。半径按「站在 20 cm 外读数的人眼」取，
     再大就会在近距离视角（read）里挡住温度计本身。 */
  const EYE_R = 0.75;                                // 眼球半径 cm
  /* 相机离眼球比这更近时干脆不画它：那时相机基本就站在观察者的位置上，
     再画一颗大白球只会糊住温度计。30 cm 落在「read 视角 ≈ 20 cm」与
     「其余三个视角 ≈ 80 cm 以上」之间的空档里，两边都不贴边。 */
  const EYE_MIN_DIST = 30;                           // cm

  /* ------------------------------ 可选项 ------------------------------ */
  const WATERS = {
    '0':   { T: 0,   name: '冰水混合物', note: '冰正在融化' },
    '25':  { T: 25,  name: '常温水',     note: '室温附近' },
    '37':  { T: 37,  name: '温水',       note: '模拟人体温度' },
    '65':  { T: 65,  name: '热水',       note: '烫手' },
    '95':  { T: 95,  name: '接近沸点的水', note: '冒热气' },
    '100': { T: 100, name: '沸水',       note: '正在沸腾' }
  };
  const PLACES = {
    right:  { name: '全部浸入水中（正确）', short: '全部浸入' },
    bottom: { name: '碰到杯底',             short: '碰杯底' },
    wall:   { name: '碰到杯壁',             short: '碰杯壁' },
    half:   { name: '只浸入一半',           short: '浸一半' }
  };
  const SIGHTS = {
    level: { name: '平视（正确）', short: '平视', dy: 0 },
    down:  { name: '俯视',         short: '俯视', dy: EYE_DY },
    up:    { name: '仰视',         short: '仰视', dy: -EYE_DY }
  };
  /* 两支温度计：量程、分度值、长刻度间隔、数字间隔、缩口 */
  const KINDS = {
    lab:  { name: '实验室温度计', TMin: -20, TMax: 110, div: 1,   longStep: 5,   numStep: 10, dec: 0, neck: false },
    body: { name: '体温计',       TMin: 35,  TMax: 42,  div: 0.1, longStep: 0.5, numStep: 1,  dec: 1, neck: true }
  };

  /* ------------------------------ 状态 ------------------------------ */
  const state = {
    water: '25', place: 'right', sight: 'level', kind: 'lab',
    lifted: false, liftAnim: 0,
    Tw: 25,          // 水的真实温度 ℃（直接切换）
    TwVis: 25,       // 视觉用（颜色 / 白气 / 冰块）的平滑值
    Td: AMB,         // 温度计示数（连续量）
    t: 0,
    records: [],
    step: 0
  };
  const toggles = { sight: true, eye: true, trueLine: true, steam: true };

  const VIEWS = {
    front: { yaw: -0.06, pitch: 0.10, dist: 88, ty: 19 },
    angle: { yaw: -0.52, pitch: 0.15, dist: 92, ty: 19 },
    top:   { yaw: -0.50, pitch: 0.80, dist: 86, ty: 17 },
    read:  { yaw: -0.44, pitch: 0.04, dist: 40, ty: 25 }
  };
  const view = { ...VIEWS.angle };

  /* ------------------------------ 小工具 ------------------------------ */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mulberry32 = (a) => () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const newCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const roundRect = (g, x, y, w, h, r) => {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  };
  /* 把单位圆柱（半径 1、高 1、沿 +y）摆到 a→b 上，用于画视线 */
  const UP = new THREE.Vector3(0, 1, 0);
  function orientSegment(mesh, a, b) {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length() || 1e-6;
    mesh.position.copy(a).addScaledVector(d, 0.5);
    mesh.quaternion.setFromUnitVectors(UP, d.clone().normalize());
    mesh.scale.set(1, len, 1);
  }

  /* ==========================================================================
     一、程序化贴图
     ========================================================================== */

  /* 铸铁底座：深灰 + 铸造砂眼 */
  function makeCastIronMap() {
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

  /* 石棉网：金属丝编织网 + 中间石棉圆片 */
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

  function makeAsbestosMap() {
    const S = 256, rnd = mulberry32(4242);
    const c = newCanvas(S, S), g = c.getContext('2d');
    g.fillStyle = '#b9b2a4'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 2600; i++) {
      const x = rnd() * S, y = rnd() * S, a = rnd() * Math.PI, len = 1 + rnd() * 4;
      const v = 0.82 + rnd() * 0.3;
      g.strokeStyle = `rgba(${Math.round(186 * v)},${Math.round(178 * v)},${Math.round(162 * v)},0.55)`;
      g.lineWidth = 0.6 + rnd() * 0.9;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(2, 2);
    return t;
  }

  /* 实验台面 */
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
  renderer.toneMappingExposure = 0.98;
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

  const key = new THREE.DirectionalLight('#fff2dd', 2.05);
  key.position.set(-42, 66, 44);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -46; key.shadow.camera.right = 46;
  key.shadow.camera.top = 60; key.shadow.camera.bottom = -14;
  key.shadow.camera.near = 20; key.shadow.camera.far = 200;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.026;
  scene.add(key);
  scene.add(key.target);
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
      roughness: 0.9, metalness: 0.0, envMapIntensity: 0.5
    })
  );
  bench.position.set(0, -3.5, 0);
  bench.receiveShadow = true;
  scene.add(bench);

  /* ==========================================================================
     三、器材
     ========================================================================== */
  const ironMap = makeCastIronMap();
  ironMap.anisotropy = MAX_ANISO;
  const castIron = new THREE.MeshStandardMaterial({ map: ironMap, bumpMap: ironMap, bumpScale: 0.05, color: '#b9bec6', roughness: 0.7, metalness: 0.3 });
  const chrome = new THREE.MeshStandardMaterial({ color: '#d9dfe5', roughness: 0.16, metalness: 1.0, envMapIntensity: 1.5 });
  const darkSteel = new THREE.MeshStandardMaterial({ color: '#6d737a', roughness: 0.36, metalness: 0.92, envMapIntensity: 1.1 });
  const knobMat = new THREE.MeshStandardMaterial({ color: '#3d434a', roughness: 0.42, metalness: 0.75 });

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: '#eef7ff', transparent: true, opacity: 0.24, roughness: 0.045, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 2.3,
    side: THREE.DoubleSide, depthWrite: false
  });
  const waterMat = new THREE.MeshPhysicalMaterial({
    color: '#bfe6f5', transparent: true, opacity: 0.40, roughness: 0.05, metalness: 0,
    clearcoat: 0.9, envMapIntensity: 1.5, side: THREE.DoubleSide, depthWrite: false
  });

  /* --- 铁架台 --- */
  const stand = new THREE.Group();
  scene.add(stand);
  const base = new THREE.Mesh(new THREE.BoxGeometry(BASE_W, BASE_H, BASE_D), castIron);
  base.position.set(0, BASE_H / 2, 0);
  base.castShadow = true; base.receiveShadow = true;
  stand.add(base);
  const baseTop = new THREE.Mesh(new THREE.BoxGeometry(BASE_W - 1.6, 0.5, BASE_D - 1.6), castIron);
  baseTop.position.set(0, BASE_H + 0.2, 0);
  baseTop.castShadow = true;
  stand.add(baseTop);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(ROD_R, ROD_R, ROD_H, 24), chrome);
  rod.position.set(0, BASE_H + ROD_H / 2, ROD_Z);
  rod.castShadow = true;
  stand.add(rod);

  /* 铁圈（架石棉网用） */
  function makeBoss(y, armLen) {
    const g = new THREE.Group();
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(ROD_R + 0.42, ROD_R + 0.42, 2.0, 20), darkSteel);
    sleeve.position.set(0, y, ROD_Z);
    sleeve.castShadow = true;
    g.add(sleeve);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, armLen), darkSteel);
    arm.position.set(0, y, ROD_Z + 0.9 + armLen / 2);
    arm.castShadow = true;
    g.add(arm);
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 1.3, 12), knobMat);
    screw.rotation.z = Math.PI / 2;
    screw.position.set(ROD_R + 0.95, y, ROD_Z);
    screw.castShadow = true;
    g.add(screw);
    return g;
  }
  stand.add(makeBoss(RING_Y, 4.6));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(5.3, 0.26, 12, 40), darkSteel);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(0, RING_Y, 0);
  ring.castShadow = true;
  stand.add(ring);

  const netMap = makeNetMap();
  const netMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(NET_W, NET_W),
    new THREE.MeshStandardMaterial({ map: netMap, transparent: true, alphaTest: 0.36, roughness: 0.55, metalness: 0.85, side: THREE.DoubleSide })
  );
  netMesh.rotation.x = -Math.PI / 2;
  netMesh.position.set(0, RING_Y + NET_T, 0);
  netMesh.castShadow = true;
  scene.add(netMesh);
  const asbestosMap = makeAsbestosMap();
  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(NET_W * 0.30, NET_W * 0.30, NET_T, 32),
    new THREE.MeshStandardMaterial({ map: asbestosMap, bumpMap: asbestosMap, bumpScale: 0.02, color: '#d9d3c6', roughness: 0.95, metalness: 0 })
  );
  pad.position.set(0, RING_Y + NET_T + 0.01, 0);
  pad.receiveShadow = true; pad.castShadow = true;
  scene.add(pad);

  /* --- 酒精灯（一直在杯下加热，这是「杯底更热」的原因） --- */
  const lamp = new THREE.Group();
  lamp.position.set(LAMP_X, BASE_H, 0);
  scene.add(lamp);
  const lampGlassMat = new THREE.MeshPhysicalMaterial({
    color: '#f6fbff', transparent: true, opacity: 0.30, roughness: 0.05, metalness: 0,
    clearcoat: 1, envMapIntensity: 2.2, side: THREE.DoubleSide, depthWrite: false
  });
  const lampProfile = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16, r = LAMP_R * Math.sin(Math.PI * (0.14 + t * 0.72));
    lampProfile.push(new THREE.Vector2(Math.max(0.6, r), t * LAMP_H));
  }
  const lampBody = new THREE.Mesh(new THREE.LatheGeometry(lampProfile, 44), lampGlassMat);
  lampBody.castShadow = true;
  lamp.add(lampBody);
  const lampFoot = new THREE.Mesh(new THREE.CylinderGeometry(LAMP_R * 0.80, LAMP_R * 0.76, 0.5, 40), lampGlassMat);
  lampFoot.position.y = 0.25;
  lamp.add(lampFoot);
  const alcohol = new THREE.Mesh(
    new THREE.CylinderGeometry(LAMP_R * 0.80, LAMP_R * 0.86, LAMP_H * 0.62, 40),
    new THREE.MeshPhysicalMaterial({ color: '#dff0fa', transparent: true, opacity: 0.42, roughness: 0.06, metalness: 0, envMapIntensity: 2.4, depthWrite: false })
  );
  alcohol.position.y = LAMP_H * 0.31 + 0.2;
  lamp.add(alcohol);
  const alcoholTop = new THREE.Mesh(new THREE.CircleGeometry(LAMP_R * 0.80, 40),
    new THREE.MeshPhysicalMaterial({ color: '#eaf7ff', transparent: true, opacity: 0.5, roughness: 0.03, metalness: 0, envMapIntensity: 2.6, side: THREE.DoubleSide, depthWrite: false }));
  alcoholTop.rotation.x = -Math.PI / 2;
  alcoholTop.position.y = LAMP_H * 0.62 + 0.2;
  lamp.add(alcoholTop);
  const capMat = new THREE.MeshStandardMaterial({ color: '#b9b2a2', roughness: 0.34, metalness: 0.95, envMapIntensity: 1.3 });
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(LAMP_R * 0.44, LAMP_R * 0.46, LAMP_COLLAR_H, 32), capMat);
  cap.position.y = LAMP_H + LAMP_COLLAR_H / 2;
  cap.castShadow = true;
  lamp.add(cap);
  const knurl = new THREE.Mesh(new THREE.CylinderGeometry(LAMP_R * 0.45, LAMP_R * 0.45, 0.24, 32), capMat);
  knurl.position.y = LAMP_H + LAMP_COLLAR_H * 0.55;
  lamp.add(knurl);
  const wickTube = new THREE.Mesh(new THREE.CylinderGeometry(LAMP_R * 0.24, LAMP_R * 0.24, WICK_H * 0.7, 18), capMat);
  wickTube.position.y = LAMP_H + LAMP_COLLAR_H + WICK_H * 0.35;
  lamp.add(wickTube);
  const wick = new THREE.Mesh(new THREE.CylinderGeometry(LAMP_R * 0.19, LAMP_R * 0.21, WICK_H * 0.85, 16),
    new THREE.MeshStandardMaterial({ color: '#c9bda6', roughness: 0.9, metalness: 0 }));
  wick.position.y = LAMP_H + LAMP_COLLAR_H + WICK_H * 0.5;
  lamp.add(wick);

  /* 火焰：两层锥体 + 光晕 + 点光源 */
  function makeFlameAlpha() {
    const W = 128, H = 256;
    const c = newCanvas(W, H), g = c.getContext('2d');
    const grd = g.createRadialGradient(W / 2, H * 0.74, 4, W / 2, H * 0.62, W * 0.52);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.28, 'rgba(255,236,170,0.92)');
    grd.addColorStop(0.6, 'rgba(255,164,54,0.34)');
    grd.addColorStop(1, 'rgba(255,120,20,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(W / 2, 6);
    g.bezierCurveTo(W * 0.94, H * 0.44, W * 0.86, H * 0.96, W / 2, H - 4);
    g.bezierCurveTo(W * 0.14, H * 0.96, W * 0.06, H * 0.44, W / 2, 6);
    g.fill();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  function makeGlowMap() {
    const S = 256;
    const c = newCanvas(S, S), g = c.getContext('2d');
    const grd = g.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
    grd.addColorStop(0, 'rgba(255,214,150,0.9)');
    grd.addColorStop(0.4, 'rgba(255,150,60,0.34)');
    grd.addColorStop(1, 'rgba(255,120,20,0)');
    g.fillStyle = grd; g.fillRect(0, 0, S, S);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const flameGroup = new THREE.Group();
  flameGroup.position.y = LAMP_TOP;
  lamp.add(flameGroup);
  const flameAlpha = makeFlameAlpha();
  const flameLayers = [];
  const flameSpecs = [
    { h: FLAME_H, r: 1.05, color: '#ff9b28', op: 0.62 },
    { h: FLAME_H * 0.72, r: 0.66, color: '#ffd36a', op: 0.72 },
    { h: FLAME_H * 0.40, r: 0.34, color: '#fff3c9', op: 0.86 }
  ];
  for (const s of flameSpecs) {
    const m = new THREE.Mesh(
      new THREE.ConeGeometry(s.r, s.h, 20, 1, true),
      new THREE.MeshBasicMaterial({ map: flameAlpha, color: s.color, transparent: true, opacity: s.op, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    m.position.y = s.h / 2;
    flameLayers.push({ mesh: m, base: { opacity: s.op, scale: 1 } });
    flameGroup.add(m);
  }
  const flameGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowMap(), color: '#ffb066', transparent: true, opacity: 0.40, blending: THREE.AdditiveBlending, depthWrite: false }));
  flameGlow.scale.set(11, 11, 1);
  flameGlow.position.y = FLAME_H * 0.45;
  flameGroup.add(flameGlow);
  const flameLight = new THREE.PointLight('#ff9a3c', 3.2, 60, 2);
  flameLight.position.set(0, FLAME_H * 0.4, 0);
  flameGroup.add(flameLight);

  /* --- 烧杯 --- */
  function makeBeakerMarks() {
    const W = 1024, H = 512;
    const c = newCanvas(W, H), g = c.getContext('2d');
    g.clearRect(0, 0, W, H);
    const x0 = Math.round(W * 0.055), x1 = Math.round(W * 0.30);
    g.strokeStyle = 'rgba(255,255,255,0.94)';
    g.fillStyle = 'rgba(255,255,255,0.96)';
    g.font = 'bold 34px "Helvetica Neue", Arial, sans-serif';
    g.textAlign = 'left'; g.textBaseline = 'middle';
    const area = Math.PI * BK_INNER_R * BK_INNER_R;
    const vOf = (mL) => (mL / area) / BK_H;
    for (const mL of [50, 100, 150, 200]) {
      const y = H - vOf(mL) * H;
      g.lineWidth = 5;
      g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
      g.fillText(String(mL), x1 + 9, y);
      for (let k = 1; k < 5; k++) {
        const yy = H - vOf(mL - 50 + k * 10) * H;
        if (yy > H - 8) continue;
        g.lineWidth = 3;
        g.beginPath(); g.moveTo(x0 + (x1 - x0) * 0.42, yy); g.lineTo(x1, yy); g.stroke();
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const beaker = new THREE.Group();
  scene.add(beaker);
  const bkWall = new THREE.Mesh(new THREE.CylinderGeometry(BK_R, BK_R, BK_H, 48, 1, true), glassMat);
  bkWall.position.set(0, BK_Y0 + BK_H / 2, 0);
  beaker.add(bkWall);
  const bkMarks = new THREE.Mesh(
    new THREE.CylinderGeometry(BK_R + 0.012, BK_R + 0.012, BK_H - 0.5, 48, 1, true),
    new THREE.MeshBasicMaterial({ map: makeBeakerMarks(), transparent: true, depthWrite: false, side: THREE.FrontSide })
  );
  bkMarks.position.set(0, BK_Y0 + BK_H / 2 - 0.1, 0);
  beaker.add(bkMarks);
  const bkFoot = new THREE.Mesh(new THREE.CylinderGeometry(BK_R * 0.985, BK_R * 0.965, 0.55, 48), glassMat);
  bkFoot.position.set(0, BK_Y0 + 0.27, 0);
  beaker.add(bkFoot);
  const bkBottom = new THREE.Mesh(new THREE.CircleGeometry(BK_R, 48), glassMat);
  bkBottom.rotation.x = -Math.PI / 2;
  bkBottom.position.set(0, BK_Y0 + 0.02, 0);
  beaker.add(bkBottom);
  const bkRim = new THREE.Mesh(new THREE.TorusGeometry(BK_R, 0.14, 10, 48), glassMat);
  bkRim.rotation.x = Math.PI / 2;
  bkRim.position.set(0, BK_Y0 + BK_H, 0);
  beaker.add(bkRim);
  const bkSpout = new THREE.Mesh(new THREE.SphereGeometry(0.44, 18, 12), glassMat);
  bkSpout.scale.set(2.0, 0.82, 1.0);
  bkSpout.position.set(BK_R * 0.93, BK_Y0 + BK_H + 0.06, 0);
  beaker.add(bkSpout);

  const water = new THREE.Mesh(new THREE.CylinderGeometry(BK_INNER_R, BK_INNER_R, WATER_H, 48), waterMat);
  water.position.set(0, BK_Y0 + WATER_H / 2, 0);
  beaker.add(water);
  const waterTop = new THREE.Mesh(
    new THREE.CircleGeometry(BK_INNER_R, 48),
    new THREE.MeshPhysicalMaterial({ color: '#bfe6f5', transparent: true, opacity: 0.44, roughness: 0.03, metalness: 0, clearcoat: 1, envMapIntensity: 1.6, side: THREE.DoubleSide, depthWrite: false })
  );
  waterTop.rotation.x = -Math.PI / 2;
  waterTop.position.set(0, WATER_TOP, 0);
  beaker.add(waterTop);

  /* 冰块：只在冰水混合物那一档出现 */
  const ices = new THREE.Group();
  beaker.add(ices);
  {
    const rnd = mulberry32(31337);
    const iceMat = new THREE.MeshPhysicalMaterial({
      color: '#dff3ff', transparent: true, opacity: 0.62, roughness: 0.14, metalness: 0,
      clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 2.0, depthWrite: false
    });
    for (let i = 0; i < 9; i++) {
      const s = 0.62 + rnd() * 0.42;
      const m = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.72, s * 0.9), iceMat);
      const a = rnd() * 6.283, rr = 0.6 + rnd() * (BK_INNER_R - 1.5);
      m.position.set(Math.cos(a) * rr, BK_Y0 + 0.7 + rnd() * (WATER_H - 1.2), Math.sin(a) * rr);
      m.rotation.set(rnd() * 0.6 - 0.3, rnd() * 3.14, rnd() * 0.6 - 0.3);
      m.castShadow = true;
      ices.add(m);
    }
  }

  /* 水面白气：水温高的时候才看得见 */
  const steams = [];
  {
    const rnd = mulberry32(8642);
    const steamMat = new THREE.MeshBasicMaterial({ color: '#eaf6ff', transparent: true, opacity: 0.22, depthWrite: false });
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 9), steamMat.clone());
      m.userData = { a: rnd() * 6.283, rad: rnd() * (BK_INNER_R - 1.0), ph: rnd(), spd: 0.16 + rnd() * 0.14, r0: 0.34 + rnd() * 0.3 };
      m.visible = false;
      steams.push(m);
      scene.add(m);
    }
  }

  /* ==========================================================================
     四、温度计（两支：实验室温度计 / 体温计）
     ========================================================================== */
  const thGlassMat = new THREE.MeshPhysicalMaterial({
    color: '#f2fbff', transparent: true, opacity: 0.30, roughness: 0.04, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 2.6,
    side: THREE.DoubleSide, depthWrite: false
  });
  const thRedMat = new THREE.MeshStandardMaterial({
    color: '#e0212c', emissive: '#a5121d', emissiveIntensity: 1.15, roughness: 0.26, metalness: 0.05
  });

  /* 刻度 T 画在贴图的哪一行 —— 印刷刻度与液柱映射共用这一个式子，两边不可能再对不上 */
  function scaleCanvasY(T, k) {
    return SCALE_TEX_H - 6 - ((T - k.TMin) / (k.TMax - k.TMin)) * (SCALE_TEX_H - 12);
  }
  /* CanvasTexture 默认 flipY：贴图 v = 1 − y/H。刻度 T 在管身局部坐标系里的高度由这里唯一给出。 */
  function scaleYOf(T, k) {
    return SCALE_Y0 + (1 - scaleCanvasY(T, k) / SCALE_TEX_H) * (SCALE_Y1 - SCALE_Y0);
  }
  /* 每 1 ℃ 对应多少 cm —— 视差从「cm」换算成「℃」就靠它 */
  function cmPerDeg(k) { return (SCALE_Y1 - SCALE_Y0) / (k.TMax - k.TMin); }

  /* 画一支温度计的印刷刻度，并量出刻度条真正占的水平范围（含数字），供旋转角使用 */
  function makeScale(key) {
    const k = KINDS[key];
    const W = SCALE_TEX_W, H = SCALE_TEX_H;
    const c = newCanvas(W, H), g = c.getContext('2d');
    g.clearRect(0, 0, W, H);
    g.strokeStyle = 'rgba(38,50,60,0.95)';
    g.fillStyle = 'rgba(28,40,50,0.98)';
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(SCALE_TICK_X, 6); g.lineTo(SCALE_TICK_X, H - 6); g.stroke();
    g.font = `bold ${SCALE_NUM_FONT}px "Helvetica Neue", Arial, sans-serif`;
    g.textAlign = 'left'; g.textBaseline = 'middle';
    const n = Math.round((k.TMax - k.TMin) / k.div);
    for (let i = 0; i <= n; i++) {
      const T = k.TMin + i * k.div;
      const y = scaleCanvasY(T, k);
      const isNum = Math.abs(T / k.numStep - Math.round(T / k.numStep)) < 1e-6;
      const isLong = Math.abs(T / k.longStep - Math.round(T / k.longStep)) < 1e-6;
      const len = isNum ? 16 : isLong ? 11 : 6;
      g.lineWidth = isNum ? 2.4 : isLong ? 2.0 : 1.4;
      g.beginPath(); g.moveTo(SCALE_TICK_X - len, y); g.lineTo(SCALE_TICK_X, y); g.stroke();
      if (isNum) g.fillText(T.toFixed(k.dec), SCALE_NUM_X, y);
    }
    const d = g.getImageData(0, 0, W, H).data;
    let x0 = W, x1 = -1;
    for (let y = 0; y < H; y++) {
      const row = y * W * 4;
      for (let x = 0; x < W; x++) {
        if (d[row + x * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return { tex, u0: x0 / W, u1: (x1 + 1) / W };
  }
  const scaleTex = { lab: makeScale('lab'), body: makeScale('body') };

  const thermometer = new THREE.Group();
  scene.add(thermometer);

  const thGlass = new THREE.Mesh(new THREE.CylinderGeometry(TH_TUBE_R, TH_TUBE_R, TH_TUBE_H, 20, 1, true), thGlassMat);
  thGlass.position.set(0, TH_TUBE_H / 2 - 0.4, 0);
  thermometer.add(thGlass);
  const thScale = new THREE.Mesh(
    new THREE.CylinderGeometry(TH_TUBE_R + 0.008, TH_TUBE_R + 0.008, SCALE_Y1 - SCALE_Y0, 20, 1, true),
    new THREE.MeshBasicMaterial({ map: scaleTex.lab.tex, transparent: true, depthWrite: false, side: THREE.FrontSide })
  );
  thScale.position.set(0, (SCALE_Y0 + SCALE_Y1) / 2, 0);
  thermometer.add(thScale);
  /* 背面再印一条：拖动视角绕到后面也能读。两条都是 FrontSide，正面不会透出背面的镜像数字。 */
  const thScaleBack = thScale.clone();
  thermometer.add(thScaleBack);
  const thBulb = new THREE.Mesh(new THREE.SphereGeometry(TH_BULB_R, 22, 14), thGlassMat);
  thermometer.add(thBulb);
  const thCap = new THREE.Mesh(new THREE.SphereGeometry(TH_TUBE_R, 16, 10), thGlassMat);
  thCap.position.set(0, TH_TUBE_H - 0.4, 0);
  thermometer.add(thCap);

  /* 缩口：体温计玻璃泡上方那段细颈（也是「离开液体后示数不回落」的原因） */
  const thNeck = new THREE.Mesh(new THREE.SphereGeometry(TH_BULB_R * 0.42, 14, 10), thGlassMat);
  thNeck.position.set(0, TH_BULB_R + 0.34, 0);
  thermometer.add(thNeck);

  const mercury = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 1, 12), thRedMat);
  const mercuryBulb = new THREE.Mesh(new THREE.SphereGeometry(TH_BULB_R - 0.07, 18, 12), thRedMat);
  thermometer.add(mercury);
  thermometer.add(mercuryBulb);

  /* 把刻度条转到正对相机的那半边管壁。
     贴图里刻度条中心在 u = (u0+u1)/2（CylinderGeometry 的 u=0 在 +z，θ = 360°·u），
     绕 y 转 φ 后 θ → θ+φ，所以 φ = 目标方位角 − 360°·u_center。不转的话它贴在背面，等于没画。 */
  function applyScale(key) {
    const s = scaleTex[key];
    thScale.material.map = s.tex;
    thScale.material.needsUpdate = true;
    const rot = (SCALE_FACE_DEG - 360 * (s.u0 + s.u1) / 2) * Math.PI / 180;
    thScale.rotation.y = rot;
    thScaleBack.rotation.y = rot + Math.PI;
  }
  applyScale('lab');

  /* --- 十字夹：把温度计固定住。竖直方向随温度计一起升降，水平方向靠横梁伸缩。 --- */
  const thSupport = new THREE.Group();
  scene.add(thSupport);
  const clampSleeve = new THREE.Mesh(new THREE.CylinderGeometry(ROD_R + 0.5, ROD_R + 0.5, 2.3, 20), darkSteel);
  clampSleeve.position.set(0, CLAMP_Y, ROD_Z);
  clampSleeve.castShadow = true;
  thSupport.add(clampSleeve);
  const clampScrew = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.5, 12), knobMat);
  clampScrew.rotation.z = Math.PI / 2;
  clampScrew.position.set(ROD_R + 1.05, CLAMP_Y, ROD_Z);
  clampScrew.castShadow = true;
  thSupport.add(clampScrew);
  /* 横梁：单位长度立方体，靠 scale.x 伸缩（覆盖立柱与温度计之间的水平距离） */
  const clampBar = new THREE.Mesh(new THREE.BoxGeometry(1, 0.66, 0.78), darkSteel);
  clampBar.position.set(0, CLAMP_Y, ROD_Z);
  clampBar.castShadow = true;
  thSupport.add(clampBar);
  const clampArm = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.72, 4.5), darkSteel);
  clampArm.position.set(0, CLAMP_Y, ROD_Z + 0.9 + 2.25);
  clampArm.castShadow = true;
  thSupport.add(clampArm);
  const jaws = new THREE.Group();
  jaws.position.set(0, CLAMP_Y, 0);
  thSupport.add(jaws);
  for (const s of [-1, 1]) {
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 0.5), darkSteel);
    jaw.position.set(0, 0, s * (TH_TUBE_R + 0.34));
    jaw.castShadow = true;
    jaws.add(jaw);
    const padm = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.34, 0.22),
      new THREE.MeshStandardMaterial({ color: '#2f3338', roughness: 0.95, metalness: 0.05 }));
    padm.position.set(0, 0, s * (TH_TUBE_R + 0.12));
    jaws.add(padm);
  }

  /* --- 观察者的眼睛 + 视线 --- */
  const eyeGroup = new THREE.Group();
  scene.add(eyeGroup);
  const eyeWhiteMat = new THREE.MeshStandardMaterial({ color: '#eef2f7', roughness: 0.72, metalness: 0.02 });
  const eyeBall = new THREE.Mesh(new THREE.SphereGeometry(EYE_R, 24, 18), eyeWhiteMat);
  eyeGroup.add(eyeBall);
  /* 虹膜 / 瞳孔的半径与前后位置都按 EYE_R 的比例推 —— 改眼球半径时三者一起缩，
     不会各跑各的（原来 1.5 / 0.86 / 0.40 就是这三个比例）。 */
  const iris = new THREE.Mesh(new THREE.SphereGeometry(EYE_R * 0.573, 20, 16),
    new THREE.MeshStandardMaterial({ color: '#2f6fb5', roughness: 0.42, metalness: 0.05, emissive: '#0d2740', emissiveIntensity: 0.22 }));
  iris.position.set(0, 0, EYE_R * 0.68);
  iris.scale.set(1, 1, 0.62);
  eyeGroup.add(iris);
  const pupil = new THREE.Mesh(new THREE.SphereGeometry(EYE_R * 0.267, 16, 12),
    new THREE.MeshStandardMaterial({ color: '#0b1520', roughness: 0.55, metalness: 0 }));
  pupil.position.set(0, 0, EYE_R * 0.947);
  pupil.scale.set(1, 1, 0.5);
  eyeGroup.add(pupil);
  /* 相机到眼球的距离，每帧在 animateParts 里更新；自检靠它证明「藏眼球」这条真的生效。 */
  let eyeCamDist = Infinity;

  const sightLine = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.055, 1, 8),
    new THREE.MeshBasicMaterial({ color: '#38e0ff', transparent: true, opacity: 0.85, depthWrite: false })
  );
  scene.add(sightLine);
  const sightDot = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 14, 10),
    new THREE.MeshBasicMaterial({ color: '#38e0ff', transparent: true, opacity: 0.95, depthWrite: false })
  );
  scene.add(sightDot);

  /* ==========================================================================
     五、物理
     ========================================================================== */

  /* 玻璃泡「感受到」的温度：按接触面积 × 换热系数加权 */
  function envTemp() {
    const Tw = state.Tw, Ta = AMB;
    if (state.lifted) return Ta;                       // 玻璃泡离开液面，只和空气打交道
    switch (state.place) {
      case 'bottom':
        return Tw + BOTTOM_DT;
      case 'wall': {
        const Twall = Tw - (Tw - Ta) * WALL_K;         // 串联热阻定出的壁温，其实很接近水温
        return CONTACT_WALL * Twall + (1 - CONTACT_WALL) * Tw;
      }
      case 'half': {
        const f = HALF_F;
        return (f * H_WATER * Tw + (1 - f) * H_AIR * Ta) / (f * H_WATER + (1 - f) * H_AIR);
      }
      default: return Tw;
    }
  }

  /* 视线视差（℃）：眼睛比液柱高 Δy 时，视线与刻度面相交的高度比液柱实际高度多 (r/D)·Δy。
     r 取刻度面的半径 —— 刻度印在玻璃管外表面，比管壁略大一点。 */
  const SCALE_R = TH_TUBE_R + 0.008;
  function sightBias() {
    const s = SIGHTS[state.sight];
    if (!s.dy) return 0;
    return (SCALE_R / EYE_DIST) * s.dy / cmPerDeg(KINDS[state.kind]);
  }

  function inRange() {
    const k = KINDS[state.kind];
    return state.Td > k.TMin + 0.05 && state.Td < k.TMax - 0.05;
  }
  /* 未经分度值取整的读数 —— 误差用它算，才不会被 1 ℃ 的分度值把偏差抹平 */
  function rawReading() {
    const k = KINDS[state.kind];
    return clamp(state.Td + sightBias(), k.TMin, k.TMax);
  }
  /* 读数：示数 + 视差，再按分度值取整 —— 分度值 1 ℃ 的温度计读不出 0.1 ℃ */
  function reading() {
    const k = KINDS[state.kind];
    return Math.round(rawReading() / k.div) * k.div;
  }
  function readingText() {
    const k = KINDS[state.kind];
    if (state.Td >= k.TMax - 0.05) return `> ${k.TMax.toFixed(k.dec)} ℃`;
    if (state.Td <= k.TMin + 0.05) return `< ${k.TMin.toFixed(k.dec)} ℃`;
    return `${reading().toFixed(k.dec)} ℃`;
  }
  /* 这一次读数可不可信：位置对、视线对、而且没超出量程 */
  function trustworthy() {
    return !state.lifted && state.place === 'right' && state.sight === 'level' && inRange();
  }

  function stepSim(dt) {
    const k = KINDS[state.kind];
    const env = envTemp();
    /* 缩口：水银只能往上走。示数一旦升进量程（水银已经越过细颈），就不会再自己
       退回来 —— 换到更冷的液体里也一样，必须甩一甩才能降下去。
       水银还在缩口以下时它没进入细颈，示数才能随环境自由上下。
       早先的写法是「提起时冻结」，那是把「离开液体」当成了原因；真正的判据是
       「水银有没有越过缩口」。按旧写法，把体温计从 65 ℃ 的水挪到 37 ℃ 的水里，
       示数会跟着掉到 37 —— 与「用前必须甩一甩」直接矛盾。 */
    const past = k.neck && state.Td >= k.TMin - 0.05;
    const relaxed = state.Td + (env - state.Td) * (1 - Math.exp(-dt / TAU_TH));
    state.Td = past ? Math.max(state.Td, relaxed) : relaxed;
    state.Td = clamp(state.Td, k.TMin - 2, k.TMax + 2);
    state.TwVis += (state.Tw - state.TwVis) * (1 - Math.exp(-dt / TAU_VIS));
    state.t += dt;
  }

  /* 甩一甩：把水银甩回玻璃泡，示数落到量程以下，然后重新开始测。
     只有带缩口的体温计才需要（也才有效）—— 实验室温度计的水银本来就会自己
     跟着环境走，甩不甩一个样，所以返回 false 让界面说明原因。 */
  function shake() {
    const k = KINDS[state.kind];
    if (!k.neck) return false;
    state.Td = k.TMin - 1.2;
    resetRun();
    refreshAll();
    return true;
  }

  function resetRun() {                                // 换条件：曲线重新开始画，但示数不跳
    state.t = 0;
    series.length = 0;
    sampleAcc = 0;
    pushSample();
  }
  function resetSim() {
    state.water = '25'; state.place = 'right'; state.sight = 'level'; state.kind = 'lab';
    state.lifted = false; state.liftAnim = 0;
    state.Tw = WATERS[state.water].T; state.TwVis = state.Tw;
    state.Td = AMB;
    applyScale('lab');
    resetRun();
    syncButtons();
  }

  /* ==========================================================================
     六、随状态更新器材
     ========================================================================== */
  function targetThermoPos() {
    const p = PLACE_POS[state.place];
    const base = PLACE_POS.right;
    let dx = p.x, dy = p.y - base.y;
    if (state.lifted) { dx = 0; dy = LIFT_DY; }
    return { dx, dy };
  }

  function updateThermo() {
    const t = targetThermoPos();
    state.thX = state.thX === undefined ? t.dx : state.thX;
    state.thY = state.thY === undefined ? t.dy : state.thY;
    thermometer.position.set(state.thX, TH_BULB_Y_BASE + state.thY, 0);

    /* 铁夹跟着温度计走：竖直方向整组升降，水平方向横梁伸缩 */
    thSupport.position.set(0, state.thY, 0);
    const barLen = Math.abs(state.thX) + 1.7;
    clampBar.scale.x = barLen;
    clampBar.position.set(state.thX / 2, CLAMP_Y, ROD_Z);
    clampArm.position.set(state.thX, CLAMP_Y, ROD_Z + 0.9 + 2.25);
    jaws.position.set(state.thX, CLAMP_Y, 0);

    /* 缩口只在体温计上出现 */
    thNeck.visible = KINDS[state.kind].neck;

    /* 液柱：顶端按刻度线性映射（TMin → 刻度下限，TMax → 刻度上限），与印刷刻度同源 */
    const k = KINDS[state.kind];
    const bulbLocalY = 0;
    const Tshow = clamp(state.Td, k.TMin, k.TMax);
    const colTop = scaleYOf(Tshow, k);
    const colH = Math.max(0.5, colTop - bulbLocalY);
    mercury.scale.set(1, colH, 1);
    mercury.position.set(0, bulbLocalY + colH / 2, 0);
    mercuryBulb.position.set(0, bulbLocalY, 0);
  }

  /* 水色 / 冰块 / 白气：让「水温」在画面上也看得见 */
  const COLD = new THREE.Color('#9fd4ea');
  const HOT = new THREE.Color('#e2eef2');
  const _tmpCol = new THREE.Color();
  function updateWater() {
    const v = clamp((state.TwVis - 10) / 90, 0, 1);
    _tmpCol.copy(COLD).lerp(HOT, v);
    waterMat.color.copy(_tmpCol);
    waterTop.material.color.copy(_tmpCol);
    ices.visible = state.TwVis < 3;
    for (const m of steams) m.visible = toggles.steam && state.TwVis > 68;
  }

  /* ==========================================================================
     七、示数—时间图像
     ========================================================================== */
  const chartCanvas = $('chartCanvas');
  const series = [];
  let sampleAcc = 0;
  function pushSample() {
    series.push([state.t, reading()]);
    if (series.length > 2400) series.splice(0, 800);
  }
  function drawChart() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = chartCanvas.clientWidth || 640;
    const H = chartCanvas.clientHeight || 232;
    if (chartCanvas.width !== Math.round(W * dpr) || chartCanvas.height !== Math.round(H * dpr)) {
      chartCanvas.width = Math.round(W * dpr);
      chartCanvas.height = Math.round(H * dpr);
    }
    const g = chartCanvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    const padL = 44, padR = 16, padT = 14, padB = 26;
    const pw = W - padL - padR, ph = H - padT - padB;
    const tMax = Math.max(45, Math.ceil((state.t + 6) / 15) * 15);
    const k = KINDS[state.kind];
    let lo = Math.min(state.Td, state.Tw, reading()) - 4;
    let hi = Math.max(state.Td, state.Tw, reading()) + 4;
    if (hi - lo < 10) { const c = (lo + hi) / 2; lo = c - 5; hi = c + 5; }
    lo = Math.max(lo, k.TMin - 2); hi = Math.min(hi, k.TMax + 2);
    const X = (t) => padL + (t / tMax) * pw;
    const Y = (T) => padT + (hi - T) / (hi - lo) * ph;

    g.fillStyle = '#0a1a2b'; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(120,150,180,0.16)';
    g.lineWidth = 1;
    g.font = '10px "Helvetica Neue", Arial, sans-serif';
    g.fillStyle = 'rgba(150,180,205,0.85)';
    g.textAlign = 'right'; g.textBaseline = 'middle';
    const stepT = (hi - lo) / 5;
    for (let i = 0; i <= 5; i++) {
      const T = lo + i * stepT, y = Y(T);
      g.beginPath(); g.moveTo(padL, y); g.lineTo(W - padR, y); g.stroke();
      g.fillText(T.toFixed(hi - lo < 12 ? 1 : 0), padL - 6, y);
    }
    g.textAlign = 'center'; g.textBaseline = 'top';
    for (let i = 0; i <= 4; i++) {
      const t = tMax * i / 4;
      g.fillText(t.toFixed(0), X(t), H - padB + 6);
    }
    g.fillText('时间 / s', W - padR - 26, H - padB + 6);

    /* 真实水温参考线 */
    if (toggles.trueLine) {
      g.save();
      g.strokeStyle = 'rgba(134,239,172,0.85)';
      g.lineWidth = 1.6;
      g.setLineDash([6, 5]);
      g.beginPath(); g.moveTo(padL, Y(state.Tw)); g.lineTo(W - padR, Y(state.Tw)); g.stroke();
      g.restore();
    }
    /* 示数曲线 */
    if (series.length > 1) {
      g.strokeStyle = '#7dd3fc';
      g.lineWidth = 2.4;
      g.beginPath();
      series.forEach(([t, T], i) => {
        const x = X(t), y = Y(clamp(T, lo, hi));
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      });
      g.stroke();
      const last = series[series.length - 1];
      g.fillStyle = '#7dd3fc';
      g.beginPath(); g.arc(X(last[0]), Y(clamp(last[1], lo, hi)), 3.4, 0, 7); g.fill();
    }
    g.fillStyle = 'rgba(125,211,252,0.9)';
    g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillText(`${k.name} · 分度值 ${k.div} ℃ · 量程 ${k.TMin} ~ ${k.TMax} ℃`, padL + 4, padT + 2);
  }

  /* ==========================================================================
     八、读数放大镜（把「视差」画出来）
     ========================================================================== */
  const magCanvas = $('magCanvas');
  const magText = $('magText');
  /* 示意图（管径已放大）：右边是眼睛，左边是玻璃管的侧视剖面。
     刻度面在靠近眼睛的一侧，红色液柱在管中心 —— 视线斜着穿过去，
     与刻度面相交的位置就和液柱的真实高度错开了。 */
  const MAG_TUBE_L = 26, MAG_TUBE_R = 52, MAG_AXIS = 39, MAG_EYE_X = 112;
  function drawMag() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = magCanvas.clientWidth || 220;
    const H = magCanvas.clientHeight || 112;
    if (magCanvas.width !== Math.round(W * dpr) || magCanvas.height !== Math.round(H * dpr)) {
      magCanvas.width = Math.round(W * dpr);
      magCanvas.height = Math.round(H * dpr);
    }
    const g = magCanvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#0a1a2b'; g.fillRect(0, 0, W, H);

    const cy = H / 2;
    const s = SIGHTS[state.sight];
    const dir = s.dy > 0 ? 1 : s.dy < 0 ? -1 : 0;
    const eyeDy = dir * Math.min(H * 0.38, 40);
    const eyeX = Math.min(MAG_EYE_X, W - 22);

    /* 玻璃管剖面 */
    g.fillStyle = 'rgba(150,200,225,0.14)';
    g.fillRect(MAG_TUBE_L, 8, MAG_TUBE_R - MAG_TUBE_L, H - 16);
    g.strokeStyle = 'rgba(180,220,240,0.55)';
    g.lineWidth = 1;
    g.strokeRect(MAG_TUBE_L + 0.5, 8.5, MAG_TUBE_R - MAG_TUBE_L - 1, H - 17);
    /* 刻度面（朝眼睛的那一侧） */
    g.strokeStyle = 'rgba(226,240,250,0.9)';
    g.lineWidth = 2.4;
    g.beginPath(); g.moveTo(MAG_TUBE_R, 8); g.lineTo(MAG_TUBE_R, H - 8); g.stroke();
    g.lineWidth = 1;
    for (let y = 12; y < H - 10; y += 7) {
      g.beginPath(); g.moveTo(MAG_TUBE_R - 6, y); g.lineTo(MAG_TUBE_R, y); g.stroke();
    }
    /* 液柱（在管中心） */
    g.fillStyle = '#e0212c';
    g.fillRect(MAG_AXIS - 3.5, cy, 7, H - 10 - cy);
    g.fillStyle = '#ff5a63';
    g.fillRect(MAG_AXIS - 4.5, cy - 2.4, 9, 2.4);

    /* 视线：从眼睛穿过液柱顶端，延长到刻度面 */
    const eyeY = cy - eyeDy;
    const t = (MAG_TUBE_R - eyeX) / (MAG_AXIS - eyeX);
    const crossY = eyeY + t * (cy - eyeY);
    g.strokeStyle = 'rgba(56,224,255,0.95)';
    g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(eyeX, eyeY); g.lineTo(MAG_TUBE_R, crossY); g.stroke();
    /* 液柱真实高度 */
    g.save();
    g.strokeStyle = 'rgba(255,150,150,0.95)';
    g.setLineDash([4, 3]);
    g.beginPath(); g.moveTo(MAG_TUBE_L - 5, cy); g.lineTo(MAG_TUBE_R + 6, cy); g.stroke();
    g.restore();
    /* 眼睛以为的高度 */
    if (dir) {
      g.strokeStyle = 'rgba(56,224,255,0.95)';
      g.beginPath(); g.moveTo(MAG_TUBE_R, crossY); g.lineTo(MAG_TUBE_R + 8, crossY); g.stroke();
      g.fillStyle = '#38e0ff';
      g.beginPath(); g.arc(MAG_TUBE_R, crossY, 2.6, 0, 7); g.fill();
    }
    /* 眼睛 */
    g.fillStyle = '#f4f7fa';
    g.beginPath(); g.arc(eyeX, eyeY, 8, 0, 7); g.fill();
    g.fillStyle = '#2f6fb5';
    g.beginPath(); g.arc(eyeX, eyeY, 4.4, 0, 7); g.fill();
    g.fillStyle = '#0b1520';
    g.beginPath(); g.arc(eyeX, eyeY, 2, 0, 7); g.fill();
    /* 标注 */
    g.font = '9px "Helvetica Neue", Arial, sans-serif';
    g.fillStyle = 'rgba(190,215,235,0.95)';
    g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillText('刻度面', MAG_TUBE_R + 6, 10);
    g.textAlign = 'right'; g.textBaseline = 'bottom';
    g.fillStyle = 'rgba(255,170,170,0.95)';
    g.fillText('液柱真实高度', MAG_TUBE_L - 6, cy - 3);
    g.textAlign = 'right'; g.textBaseline = 'top';
    g.fillStyle = 'rgba(56,224,255,0.95)';
    g.fillText('眼睛以为的高度', MAG_TUBE_L - 6, Math.max(12, crossY + 3));

    /* 文案 */
    const dT = sightBias();
    if (state.sight === 'level') {
      magText.textContent = '平视：视线与液柱上表面相平，读到的是液柱的真实高度。';
    } else if (!inRange()) {
      magText.textContent = '液柱已经顶到量程尽头，读数不可用。';
    } else {
      const sgn = dT > 0 ? '偏大' : '偏小';
      magText.textContent = `${SIGHTS[state.sight].short}：视线与刻度面相交的位置比液柱${dT > 0 ? '高' : '低'} `
        + `${Math.abs(dT).toFixed(2)} ℃ 的刻度，所以读数${sgn}。`;
    }
  }

  /* ==========================================================================
     九、界面刷新
     ========================================================================== */
  const els = {
    hudRead: $('hudRead'), hudTrue: $('hudTrue'), hudKind: $('hudKind'), hudErr: $('hudErr'),
    metricRead: $('metricRead'), metricTrue: $('metricTrue'), metricErr: $('metricErr'),
    metricPlace: $('metricPlace'), metricRange: $('metricRange'), finding: $('finding')
  };
  function errText() {
    if (!inRange()) return '超出量程';
    const d = rawReading() - state.Tw;
    if (Math.abs(d) < 0.05) return '0.0 ℃';
    return `${d >= 0 ? '+' : ''}${d.toFixed(1)} ℃`;
  }
  function statusText() {
    if (!inRange()) {
      return state.Td >= KINDS[state.kind].TMax - 0.05 ? '超出量程' : '低于量程';
    }
    if (state.lifted) return KINDS[state.kind].neck ? '示数被缩口锁住' : '示数正在回落';
    if (state.place !== 'right') return '玻璃泡位置不对';
    if (state.sight !== 'level') return '视线不对';
    return '读数可信';
  }
  function updateReadouts() {
    const k = KINDS[state.kind];
    els.hudRead.textContent = readingText();
    els.hudTrue.textContent = `${state.Tw.toFixed(1)} ℃`;
    els.hudKind.textContent = k.name;
    els.hudErr.textContent = errText();
    els.metricRead.textContent = readingText();
    els.metricTrue.textContent = `${state.Tw.toFixed(1)} ℃`;
    els.metricErr.textContent = errText();
    els.metricPlace.textContent = state.lifted ? '已提起' : PLACES[state.place].short;
    els.metricRange.textContent = `${k.TMin} ~ ${k.TMax} ℃ / ${k.div} ℃`;

    let hint, warn = false;
    if (state.Td >= k.TMax - 0.05) {
      warn = true;
      hint = `液柱已经顶到管口！${k.name}的量程只有 ${k.TMin} ~ ${k.TMax} ℃，被测温度远高于它的量程 —— `
        + `温度计里的液体膨胀过度，会把玻璃管胀破。测液体温度前<b>先估一估温度、看清量程</b>。`;
    } else if (state.Td <= k.TMin + 0.05) {
      warn = true;
      hint = `液柱已经降到最低端。这个温度低于${k.name}的量程下限 ${k.TMin} ℃，读不出数值 —— 换一支量程合适的温度计。`;
    } else if (state.lifted) {
      hint = k.neck
        ? `体温计的玻璃泡上方有一段很细的<b>缩口</b>：水银通过时被挤过去，离开液体后却退不回来，所以示数<b>冻结</b>在 ${readingText()} —— 这就是体温计能离开人体读数、用前要甩一甩的原因。`
        : `实验室温度计没有缩口，玻璃泡一离开液体，示数立刻向室温回落（现在 ${readingText()}）—— 所以读数时玻璃泡必须<b>留在液体中</b>。`;
    } else if (state.place === 'bottom') {
      warn = true;
      hint = `玻璃泡碰到了<b>杯底</b>。热量是从杯底进入水里的，最下面那一层水最热（比水体平均温度高约 ${BOTTOM_DT} ℃）——`
        + `真实实验里要不断搅拌，就是为了让整杯水温度均匀。压在水底上的玻璃泡读到的是这一层，`
        + `读数比真实水温高 ${errText()}。`;
    } else if (state.place === 'wall') {
      warn = true;
      hint = `玻璃泡碰到了<b>杯壁</b>。杯壁内表面的温度由「水侧」和「空气侧」两个热阻一起定：`
        + `水的对流强得多，所以壁温其实很接近水温，偏差只有 ${errText()} 这么小 —— 但它的<b>方向会变</b>：`
        + `水温比室温（${AMB} ℃）高时读数偏低，比室温低时读数偏高。`
        + `偏差小、方向又不可控，这才是规则必须禁它的原因。`;
    } else if (state.place === 'half') {
      warn = true;
      hint = `玻璃泡只浸入一半，另一半露在 ${AMB} ℃ 的空气里。空气的对流换热比水弱得多，`
        + `但露出的那一半仍在往外散热 —— 读数被拉偏 ${errText()}（方向同样随水温与室温的关系变号）。`
        + `规则要求玻璃泡<b>全部浸入</b>，就是为了让它只和被测液体换热。`;
    } else if (state.sight !== 'level') {
      hint = `${SIGHTS[state.sight].name}：刻度印在玻璃管前表面、红色液柱在管中心，两者相隔 ${TH_TUBE_R.toFixed(2)} cm。`
        + `视线斜着穿过时，与刻度相交的位置比液柱的真实高度${sightBias() > 0 ? '高' : '低'} `
        + `${Math.abs(sightBias()).toFixed(2)} ℃ 的刻度 —— 读数${sightBias() > 0 ? '偏<b>大</b>' : '偏<b>小</b>'}。`;
    } else if (state.Td < state.Tw - 0.4) {
      hint = `示数还在往上爬（现在 ${readingText()}，真实水温 ${state.Tw.toFixed(1)} ℃）。玻璃泡和水之间换热需要时间，`
        + `要等示数<b>稳定</b>了再读 —— 刚放进去就读，读到的一定是偏低的数。`;
    } else {
      hint = `玻璃泡全部浸入、不碰杯底杯壁，平视读数，示数已经稳定：读数 ${readingText()}，真实水温 ${state.Tw.toFixed(1)} ℃，`
        + `误差只有 ${errText()}。这就是「会认、会放、会读、会记」四条都做到的样子。`;
    }
    els.finding.className = warn ? 'callout warn' : 'callout';
    els.finding.innerHTML = hint;
  }

  function refreshAll(dt) {
    updateThermo();
    updateWater();
    drawChart();
    drawMag();
    updateReadouts();
    requestRender();
  }

  /* ==========================================================================
     十、动画
     ========================================================================== */
  let dirty = true;
  const requestRender = () => { dirty = true; };
  let clock = 0;

  function animateParts(dt) {
    clock += dt;
    /* 温度计在几种放法之间平滑滑动（松开铁夹螺丝 → 移动 → 再夹紧） */
    const tg = targetThermoPos();
    if (state.thX === undefined) { state.thX = tg.dx; state.thY = tg.dy; }
    state.thX += (tg.dx - state.thX) * (1 - Math.exp(-dt * 4.5));
    state.thY += (tg.dy - state.thY) * (1 - Math.exp(-dt * 4.5));
    if (Math.abs(tg.dx - state.thX) < 0.004) state.thX = tg.dx;
    if (Math.abs(tg.dy - state.thY) < 0.004) state.thY = tg.dy;
    updateThermo();

    /* 火焰跳动 */
    const wob = Math.sin(clock * 7.3) * 0.5 + Math.sin(clock * 11.7 + 1.3) * 0.3 + Math.sin(clock * 3.1) * 0.2;
    flameGroup.scale.set(1 + wob * 0.055, 1 + Math.sin(clock * 9.1 + 0.7) * 0.045, 1 + wob * 0.05);
    flameGroup.position.x = wob * 0.10;
    flameLight.intensity = 3.2 + wob * 0.5;

    /* 白气：从水面往上飘 */
    for (const m of steams) {
      if (!m.visible) continue;
      const u = m.userData;
      u.ph += dt * u.spd;
      const cyc = u.ph % 1;
      m.position.set(Math.cos(u.a) * (u.rad + cyc * 1.5), WATER_TOP + 0.3 + cyc * 6.2, Math.sin(u.a) * (u.rad + cyc * 1.5));
      m.scale.setScalar(u.r0 + cyc * 1.35);
      m.material.opacity = 0.20 * Math.sin(cyc * Math.PI) * (1 - cyc * 0.5);
    }

    /* 眼睛与视线 */
    const k = KINDS[state.kind];
    const readY = TH_BULB_Y_BASE + state.thY + scaleYOf(clamp(state.Td, k.TMin, k.TMax), k);
    const faceRad = SCALE_FACE_DEG * Math.PI / 180;
    const fx = Math.sin(faceRad), fz = Math.cos(faceRad);
    const tubeX = state.thX, tubeZ = 0;
    const eyeY = readY + SIGHTS[state.sight].dy;
    const eyePos = new THREE.Vector3(tubeX + fx * EYE_DIST, eyeY, tubeZ + fz * EYE_DIST);
    eyeGroup.position.copy(eyePos);
    /* 让虹膜朝着相机，而不是朝着温度计。
       眼球要传达的是「观察者站在哪一侧、比液柱高还是低」，这个信息全在【位置】上；
       朝向则只影响它看起来像不像一只眼睛 —— 朝温度计的话，相机多半从背后看过去，
       只能看到一个没有虹膜的白球，在场景里像一颗莫名其妙浮着的乒乓球。
       视线的方向由那根青色 sightLine 表达，不靠眼球朝向。 */
    eyeGroup.lookAt(camera.position);
    /* 相机离眼球太近就不画（read 视角下相机 ≈ 观察者本人）。
       先量距离再判可见性，自检读的就是这个数。 */
    eyeCamDist = camera.position.distanceTo(eyePos);
    eyeGroup.visible = toggles.eye && eyeCamDist > EYE_MIN_DIST;

    sightLine.visible = toggles.sight;
    sightDot.visible = toggles.sight;
    if (toggles.sight) {
      /* 视线：眼睛 → 液柱顶端。与刻度面（半径 SCALE_R 的圆柱面）的交点由
         s = 1 − r/D 给出，其高度正好是 readY + (r/D)·Δy —— 与 sightBias() 同源，
         所以画出来的交点位置和算出来的读数偏差不可能对不上。 */
      const merTop = new THREE.Vector3(tubeX, readY, tubeZ);
      const sCross = 1 - SCALE_R / EYE_DIST;
      const cross = eyePos.clone().lerp(merTop, sCross);
      orientSegment(sightLine, eyePos, merTop);
      sightDot.position.copy(cross);
    }
  }

  /* ==========================================================================
     十一、相机与交互
     ========================================================================== */
  function updateCamera() {
    const t = new THREE.Vector3(0, view.ty, 0);
    const cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
    camera.position.set(
      t.x + view.dist * cp * Math.sin(view.yaw),
      t.y + view.dist * sp,
      t.z + view.dist * cp * Math.cos(view.yaw)
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
    view.pitch = clamp(view.pitch + dy * 2.2, -0.10, 1.36);
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
    view.dist = clamp(view.dist * (1 + Math.sign(e.deltaY) * 0.08), 24, 200);
    updateCamera();
  }, { passive: false });

  document.querySelectorAll('[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      Object.assign(view, VIEWS[btn.dataset.view]);
      document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b === btn));
      updateCamera();
    });
  });

  /* --- 条件按钮 --- */
  function syncButtons() {
    const mark = (sel, attr, val) => {
      document.querySelectorAll(sel).forEach((b) => b.classList.toggle('active', b.dataset[attr] === val));
    };
    mark('[data-water]', 'water', state.water);
    mark('[data-place]', 'place', state.place);
    mark('[data-sight]', 'sight', state.sight);
    mark('[data-kind]', 'kind', state.kind);
    const lb = $('liftBtn');
    lb.classList.toggle('active', state.lifted);
    lb.textContent = state.lifted ? '把温度计放回水中' : '提起温度计';
    /* 甩一甩只对带缩口的体温计有意义：实验室温度计的水银本来就会自己跟着环境走。
       没有缩口时直接禁用（并说明原因），比让它点了没反应好。 */
    const sb = $('shakeBtn');
    if (sb) {
      const need = !!KINDS[state.kind].neck;
      sb.disabled = !need;
      sb.title = need ? '把水银甩回玻璃泡（示数落到 35 ℃ 以下）'
                      : '实验室温度计没有缩口，示数本来就会跟着水温走，不需要甩';
    }
  }
  document.querySelectorAll('[data-water]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.water = btn.dataset.water;
      state.Tw = WATERS[state.water].T;
      resetRun();
      syncButtons(); refreshAll();
    });
  });
  document.querySelectorAll('[data-place]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.place = btn.dataset.place;
      state.lifted = false;
      resetRun();
      syncButtons(); refreshAll();
    });
  });
  document.querySelectorAll('[data-sight]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.sight = btn.dataset.sight;
      resetRun();
      syncButtons(); refreshAll();
    });
  });
  document.querySelectorAll('[data-kind]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.kind = btn.dataset.kind;
      applyScale(state.kind);
      resetRun();
      syncButtons(); refreshAll();
    });
  });
  $('liftBtn').addEventListener('click', () => {
    state.lifted = !state.lifted;
    resetRun();
    syncButtons(); refreshAll();
  });
    $('resetBtn').addEventListener('click', () => {
      resetSim();
      clearRecords();
      refreshAll();
    });
    $('shakeBtn').addEventListener('click', () => {
      shake();
      syncButtons();
    });

  const toggleMap = {
    toggleSight: 'sight', toggleEye: 'eye', toggleTrue: 'trueLine', toggleSteam: 'steam'
  };
  Object.keys(toggleMap).forEach((id) => {
    const el = $(id);
    el.addEventListener('change', () => { toggles[toggleMap[id]] = el.checked; refreshAll(); });
  });

  /* ==========================================================================
     十二、步骤与记录
     ========================================================================== */
  const STEPS = [
    { name: '01 认识温度计',
      text: '<strong>先看清这支温度计能不能测。</strong>温度计的原理是液体的<b>热胀冷缩</b>。读数前先认三样东西：'
        + '<b>量程</b>（能测的温度范围）、<b>分度值</b>（一个小格代表多少 ℃）、<b>零刻度</b>在哪。'
        + '实验室温度计 −20 ~ 110 ℃、分度值 1 ℃；体温计只有 35 ~ 42 ℃，分度值 0.1 ℃。'
        + '拿一支体温计去测 65 ℃ 的热水，液柱会一直冲到管口 —— 超出量程是会把温度计胀破的。' },
    { name: '02 会放',
      text: '<strong>玻璃泡要全部浸入被测液体中，不碰容器底，不碰容器壁。</strong>'
        + '试试点「碰到杯底」：杯底正被酒精灯加热，比水体更热，读数立刻偏大好几度。'
        + '再试「碰到杯壁」和「只浸入一半」：偏差小一些，但<b>方向会随水温变化</b> —— '
        + '水温比室温高时读数偏低，水温比室温低时读数偏高。方向不可控的误差，才是必须避开的。' },
    { name: '03 会读',
      text: '<strong>玻璃泡留在液体中，等示数稳定后再读，视线与液柱上表面相平。</strong>'
        + '刚把温度计插进去，示数会慢慢往上爬 —— 玻璃泡和水之间换热要时间，这时读到的数一定偏低。'
        + '再看视线：刻度印在玻璃管前表面、红色液柱在管中心，两者相隔一个管半径。'
        + '俯视时视线斜向下，与刻度相交在液柱<b>上方</b>，读数偏大；仰视则相反。看右上角的放大镜，'
        + '偏差的由来一目了然。' },
    { name: '04 会记',
      text: '<strong>记录要写数值 + 单位。</strong>只写「65」是错的，必须写「65 ℃」。'
        + '点右侧「记录数据」，表格会同时记下读数、真实水温和这一次的误差 —— '
        + '把几种错误放法各记一次，你会看到哪些读数是可信的、哪些完全不能用。' },
    { name: '05 体温计',
      text: '<strong>体温计是特殊设计的温度计。</strong>量程只有 35 ~ 42 ℃、分度值 0.1 ℃（比实验室温度计精确得多）；'
        + '玻璃泡上方有一段很细的<b>缩口</b>，水银通过时被挤上去，离开人体后却退不回来，所以可以'
        + '<b>离开人体读数</b>。把水温调到 37 ℃ 再点「提起温度计」，你会看到示数<b>冻结不动</b>；'
        + '换回实验室温度计做同样的动作，示数立刻往室温回落。用前要拿着体温计<b>甩一甩</b>，把水银甩回玻璃泡。' }
  ];
  const stepButtons = [...document.querySelectorAll('[data-step]')];
  const stepDetail = $('stepDetail');
  function showStep(i) {
    state.step = i;
    stepButtons.forEach((b, j) => b.classList.toggle('active', j === i));
    stepDetail.innerHTML = STEPS[i].text;
  }
  stepButtons.forEach((b, i) => b.addEventListener('click', () => showStep(i)));
  showStep(0);

  const recordBtn = $('recordBtn'), recordBody = $('records'), recordBodySide = $('recordsSide'),
        summary = $('summary'), recSum = $('recSum'), recordHint = $('recordHint');

  const EMPTY_MAIN = '<tr><td colspan="8" class="empty">尚无记录，先调好条件再点“记录数据”</td></tr>';
  const EMPTY_SIDE = '<tr><td colspan="4" class="empty">还没有记录</td></tr>';
  const HINT_READY = '换一种放法或视线，等示数稳定后点一下 —— 表格会替你算出这次读数差了多少。';
  const HINT_DONE = '已记录。继续换条件再记，最后对照哪几次的读数可信；点「重置」会把表格一起清空。';

  function clearRecords() {
    state.records.length = 0;
    renderRecords();
    recordHint.textContent = HINT_READY;
  }
  function renderRecords() {
    if (!state.records.length) {
      recordBody.innerHTML = EMPTY_MAIN;
      recordBodySide.innerHTML = EMPTY_SIDE;
      summary.textContent = '建议记录：先记一次「全部浸入 + 平视」的正确读数，再逐个改坏条件（碰底 / 碰壁 / 浸一半 / 俯视 / 仰视）各记一次，比较误差的方向和大小。';
      recSum.textContent = '点上面的按钮开始记录。';
      return;
    }
    recordBody.innerHTML = state.records.map((r, i) => `
      <tr class="${r.ok ? 'good' : 'bad'}">
        <td>${i + 1}</td><td>${r.readText}</td><td>${r.Tw.toFixed(1)} ℃</td><td>${r.errText}</td>
        <td>${r.place}</td><td>${r.sight}</td><td>${r.kind}</td><td>${r.ok ? '可信' : '不可信'}</td>
      </tr>`).join('');
    recordBodySide.innerHTML = state.records.map((r, i) => `
      <tr class="${r.ok ? 'good' : 'bad'}">
        <td>${i + 1}</td><td>${r.readText}</td>
        <td>${r.Tw.toFixed(1)}</td><td>${r.errText}</td>
      </tr>`).join('');

    const good = state.records.filter((r) => r.ok);
    const bad = state.records.filter((r) => !r.ok);
    let text;
    if (good.length && bad.length) {
      const worst = bad.reduce((a, b) => (Math.abs(b.err) > Math.abs(a.err) ? b : a));
      text = `${good.length} 次读数可信（全部浸入 + 平视，误差 ${good[0].errText}），`
        + `${bad.length} 次不可信 —— 其中偏差最大的一次是「${worst.place} + ${worst.sight}」，误差 ${worst.errText}。`
        + `同一个水温能读出这么多不同的数，说明温度计的读数完全取决于怎么用。`;
    } else if (bad.length) {
      text = `已记 ${bad.length} 次，但还没有一次是「全部浸入 + 平视」的正确读数 —— 先把条件调对，记一次基准值。`;
    } else if (good.length) {
      text = `已记 ${good.length} 次可信读数，误差都在 ${good[0].errText} 附近。再改坏一个条件（碰底 / 碰壁 / 浸一半 / 俯视 / 仰视）记一次，才有对比。`;
    } else {
      text = `已记录 ${state.records.length} 次。`;
    }
    summary.textContent = text;
    recSum.textContent = text;
  }
  recordBtn.addEventListener('click', () => {
    const k = KINDS[state.kind];
    state.records.push({
      t: state.t, Tw: state.Tw,
      read: reading(), readText: readingText(),
      err: inRange() ? rawReading() - state.Tw : NaN,
      errText: errText(),
      place: state.lifted ? '已提起' : PLACES[state.place].short,
      sight: SIGHTS[state.sight].short,
      kind: k.name,
      ok: trustworthy()
    });
    if (state.records.length > 24) state.records.shift();
    renderRecords();
    const wrap = recordBodySide.closest('.rec-wrap');
    if (wrap) wrap.scrollTop = wrap.scrollHeight;
    recordBtn.classList.remove('hit');
    void recordBtn.offsetWidth;
    recordBtn.classList.add('hit');
    recordHint.textContent = HINT_DONE;
    requestRender();
  });
  renderRecords();

  /* ==========================================================================
     十三、启动
     ========================================================================== */
  canvas.style.cursor = 'grab';
  syncButtons();
  updateThermo();
  updateWater();
  updateReadouts();
  drawChart();
  drawMag();
  updateCamera();
  resize();

  /* 单帧推进。真实 rAF 循环与验收用的驱动钩子走【同一段】代码 ——
     无头沙箱里 requestAnimationFrame 一次都不触发（实测 0 帧/秒），
     若验收自己另抄一遍推进逻辑，改坏这里照样全绿。 */
  let uiAcc = 0;
  function frameStep(dt) {
    stepSim(dt);
    animateParts(dt);

    sampleAcc += dt;
    if (sampleAcc >= 0.35) { sampleAcc = 0; pushSample(); }

    uiAcc += dt;
    if (uiAcc >= 0.1) {
      uiAcc = 0;
      updateWater();
      drawChart();
      drawMag();
      updateReadouts();
      dirty = true;
    }
    if (dirty) {
      renderer.render(scene, camera);
      dirty = false;
    }
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

  const ro = new ResizeObserver(() => { resize(); drawChart(); drawMag(); });
  ro.observe(stage);
  window.addEventListener('resize', () => { resize(); drawChart(); drawMag(); });

  /* --- 供无头验收脚本读取 --- */
  window.__thLab = {
    state, view, VIEWS, WATERS, PLACES, SIGHTS, KINDS, toggles, series,
    camera, renderer, scene,
    thermometer, thSupport, thScale, thScaleBack, mercury, mercuryBulb, thNeck,
    eyeGroup, sightLine, sightDot, ices, steams, waterTop, flameGroup, lamp, jaws, clampBar,
    scaleTex, scaleYOf, scaleCanvasY, cmPerDeg, applyScale,
    thBulbYBase: TH_BULB_Y_BASE, placePos: PLACE_POS, tubeR: TH_TUBE_R, scaleR: SCALE_R, bulbR: TH_BULB_R,
    eyeDist: EYE_DIST, eyeDy: EYE_DY, eyeR: EYE_R, eyeMinDist: EYE_MIN_DIST,
    liftDy: LIFT_DY, clampY: CLAMP_Y,
    bkY0: BK_Y0, bkR: BK_R, waterH: WATER_H, waterTopY: WATER_TOP, innerBottom: BK_INNER_BOTTOM,
    consts: { AMB, TAU_TH, TAU_VIS, H_WATER, H_AIR, BOTTOM_DT, WALL_K, CONTACT_WALL, HALF_F, SCALE_Y0, SCALE_Y1 },
    mats: { glassMat, waterMat, thGlassMat, thRedMat },
    envTemp, sightBias, rawReading, reading, readingText, inRange, trustworthy, statusText, errText,
    shake,
    resetSim, resetRun, refreshAll, syncButtons, updateThermo, drawMag, drawChart,
    /* 直接推进仿真（不依赖真实时间）。走的是与真实循环同一个 stepSim。 */
    advance(seconds) {
      let left = seconds;
      while (left > 0) { const d = Math.min(0.2, left); stepSim(d); left -= d; }
      updateThermo(); updateWater(); pushSample(); updateReadouts(); drawChart(); drawMag();
      return { t: state.t, Td: state.Td, Tw: state.Tw, read: reading(), readText: readingText(), err: reading() - state.Tw };
    },
    /* 无头环境没有 rAF：按固定步长喂帧，走的是与真实循环同一个 frameStep。
       指数平滑（温度计滑动、示数滞后、白气）靠它才能推进。 */
    driveAnim(seconds, dt = 1 / 60) {
      const n = Math.max(1, Math.round(seconds / dt));
      for (let i = 0; i < n; i++) frameStep(dt);
      renderer.render(scene, camera);
      return {
        frames: n, thX: state.thX, thY: state.thY,
        posX: thermometer.position.x, posY: thermometer.position.y,
        Td: state.Td, read: reading(), lifted: state.lifted,
        eyeVisible: eyeGroup.visible, lineVisible: sightLine.visible,
        eyeCamDist: +eyeCamDist.toFixed(3),
        eyeY: eyeGroup.position.y, eyeX: eyeGroup.position.x, eyeZ: eyeGroup.position.z
      };
    },
    /* 视线与液柱顶端在世界坐标里的落点（供像素 / 几何断言使用）。
       cross 就是视线与刻度面的交点，与 sightBias() 用同一份几何算出来。 */
    sightGeom() {
      const k = KINDS[state.kind];
      const readY = TH_BULB_Y_BASE + state.thY + scaleYOf(clamp(state.Td, k.TMin, k.TMax), k);
      const faceRad = SCALE_FACE_DEG * Math.PI / 180;
      const fx = Math.sin(faceRad), fz = Math.cos(faceRad);
      const eye = { x: state.thX + fx * EYE_DIST, y: readY + SIGHTS[state.sight].dy, z: fz * EYE_DIST };
      const merTop = { x: state.thX, y: readY, z: 0 };
      const sCross = 1 - SCALE_R / EYE_DIST;
      const cross = {
        x: eye.x + (merTop.x - eye.x) * sCross,
        y: eye.y + (merTop.y - eye.y) * sCross,
        z: eye.z + (merTop.z - eye.z) * sCross
      };
      return { readY, tubeX: state.thX, tubeZ: 0, eye, merTop, cross, sCross };
    }
  };
})();
