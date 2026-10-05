import * as THREE from './assets/optics-three.min.js';

/* ============================================================================
   探究水沸腾时温度变化的特点 —— 三维写实加热实验台
   ---------------------------------------------------------------------------
   世界坐标单位：厘米（cm），y 轴向上，实验台台面为 y = 0。
   器材：铁架台（铸铁底座 + 镀铬立柱 + 铁圈 / 铁夹）、酒精灯、石棉网、
         硼硅玻璃烧杯 + 水、硬纸盖（中央开孔穿温度计）、温度计。
   物理：单节点热平衡 —— 酒精灯给水加热，水向环境散热；到达沸点后温度不再上升，
         多出来的功率全部用于汽化（汽化潜热），水量随之缓慢减少。
         沸点由当前气压用 Antoine 方程算出（101 kPa → 100 ℃，70 kPa → 90 ℃），
         温度曲线由方程实时算出，不是预先画好的折线。
   ========================================================================== */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  /* ------------------------------ 器材尺寸 ------------------------------ */
  const BASE_W = 26, BASE_D = 17, BASE_H = 1.8;      // 铸铁底座
  const ROD_R = 0.55, ROD_H = 37, ROD_Z = -5.6;      // 镀铬立柱（够高，容铁夹夹住温度计）
  const RING_Y = 17.5;                               // 铁圈高度
  const CLAMP_Y = 31.5;                              // 铁夹高度（夹住温度计管身，在纸盖上方）

  const LAMP_R = 3.5, LAMP_H = 6.9;                  // 酒精灯玻璃灯体（颈口高度）
  const LAMP_SHOULDER_H = 0, LAMP_COLLAR_H = 1.4, WICK_H = 1.7;
  const FLAME_H = 5.4;
  const LAMP_TOP = BASE_H + LAMP_H + LAMP_SHOULDER_H + LAMP_COLLAR_H + WICK_H;  // 11.8
  const FLAME_TOP = LAMP_TOP + FLAME_H;                                          // 17.2
  const LAMP_X0 = 0, LAMP_X1 = -8.6;                 // 灯在杯下 / 撤到旁边（两个 x 位置）

  const NET_W = 12, NET_T = 0.22;                    // 石棉网（铁圈外径 11.1 cm，网只比它大一点）
  // 低型烧杯（250 mL 量级：直径 8.4 cm、高 6.6 cm）。烧杯越矮，纸盖离水面越近，
  // 温度计上「露出盖子的刻度」就越多 —— 这是本实验能不能读到全程温度的关键。
  const BK_R = 4.2, BK_H = 6.6;
  const BK_Y0 = RING_Y + NET_T + 0.06;               // 17.78
  const WATER_H = 3.8;                               // 初始水深（0.20 kg 水 ÷ π·3.9²）
  const WATER_TOP = BK_Y0 + WATER_H;                 // 21.58
  const BK_INNER_BOTTOM = BK_Y0 + 0.55;              // 加厚杯底的顶面

  /* 硬纸盖：中央开一个孔穿温度计（温度计就装在烧杯轴线上，孔正好对得上） */
  const LID_Y = BK_Y0 + BK_H;                        // 24.38
  const LID_R = BK_R + 0.18;
  const LID_T = 0.12;
  const LID_HOLE = 0.34;

  // 感温泡浸在水的中上部：全部浸入（离水面 0.9 cm、离杯内底 2.4 cm），既满足
  // 「玻璃泡全部浸入水中、不碰容器底」，又让纸盖上方露出的刻度尽量多。
  const TH_BULB_Y = 20.70;
  const TH_BULB_R = 0.42;
  const TH_TUBE_H = 17.65;                           // 温度计管长
  const TH_TOP = TH_BULB_Y + TH_TUBE_H - 0.6 + 0.24; // 顶端球帽中心（37.99）
  const TH_LIFT = 4.4;                               // 「提起」时整体抬升量（感温泡提出水面）
  const TH_X = 0, TH_Z = 0;                          // 温度计装在烧杯轴线上

  /* 印刷刻度：贴图尺寸、版面，以及「刻度条要正对哪个方位角」。
     刻度是贴在圆柱管壁上的（FrontSide），贴图的 u 决定它落在管子的哪一侧；
     画在背面 = 相机永远看不到（实测四个默认视角里刻度条只有 2~7 px 宽，等于没画）。
     默认视角的相机方位角在 −0.08 ~ −0.55 rad（≈ −4.6° ~ −31.5°），所以让刻度条正对 −25°。
     转多少不手估：makeThermoScale() 画完直接量出刻度条在贴图里占的水平范围再反算。 */
  const SCALE_TEX_W = 160, SCALE_TEX_H = 1024;
  const SCALE_FACE_DEG = -25;
  const SCALE_TICK_X = 71;                           // 主刻度右端（贴图 x）
  const SCALE_NUM_X = 75;                            // 数字左端（贴图 x）
  const SCALE_NUM_FONT = 20;                         // 数字字号（贴图 px）
  let scaleU0 = 0, scaleU1 = 1;                      // 由 makeThermoScale() 实测填入

  /* ------------------------------ 物理参数 ------------------------------ */
  const AMB = 20;                                    // 室温 ℃
  const M_WATER = 0.20;                              // 水的质量 kg（200 g）
  const C_WATER = 4200;                              // 水的比热容 J/(kg·K)
  const P_LAMP = 300;                                // 酒精灯传给水的有效功率 W
  const K_LOSS = 0.62;                               // 水向环境散热 W/K
  const LV_WATER = 2.26e6;                           // 水的汽化潜热 J/kg
  const BOIL_HOLD = 180;                             // 沸腾平台维持这么久（模拟秒）才算做完
  const MASS_MIN = 0.55;                             // 水量降到初始值的这个比例就收工（别把水烧干）

  /* 气压环境：沸点不写死，用 Antoine 方程从气压算出来 —— 面板上标多少就真算多少 */
  const PRESSURES = {
    std:   { name: '标准大气压', p: 101.3, place: '平原地区' },
    plain: { name: '高原',       p: 70.0,  place: '海拔约 3000 m' },
    high:  { name: '高山',       p: 54.0,  place: '海拔约 5000 m' }
  };

  /* ------------------------------ 状态 ------------------------------ */
  const state = {
    pressure: 'std',
    running: false,
    speed: 4,
    t: 0, T: AMB, Tb: 100,
    mass: M_WATER,           // 剩余水量 kg（沸腾时缓慢汽化）
    lampOn: true,            // 酒精灯是否在加热
    lampAnim: 1,             // 0 = 已撤到旁边，1 = 在烧杯正下方
    flameAnim: 1,            // 火焰强度 0~1（撤去时淡出）
    boilStart: -1,           // 开始沸腾的时刻（-1 = 还没沸腾）
    boilTime: 0,             // 已沸腾的时长（模拟秒）
    finished: false,
    step: 0,
    records: [],
    thDepth: 1,              // 温度计插入程度：0 = 提起（离开水面），1 = 浸在水中
    thAnim: 1                // 动画用的平滑值（默认就是装好的状态）
  };
  const toggles = { bubbles: true, steam: true, boilLine: true, micro: true };

  const VIEWS = {
    front: { yaw: -0.08, pitch: 0.10, dist: 74, ty: 19.5 },
    angle: { yaw: -0.55, pitch: 0.16, dist: 76, ty: 19.5 },
    top:   { yaw: -0.50, pitch: 0.86, dist: 71, ty: 17 },
    close: { yaw: -0.42, pitch: 0.06, dist: 26, ty: 20.5 }
  };
  const view = { ...VIEWS.angle };

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
  const DEBUG_TEX = {};
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

  /* 石棉网：金属丝编织网（透明孔） + 中间石棉圆片 */
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

  /* 硬纸盖：纤维纸浆的米黄卡纸，中央开孔穿温度计 */
  function makeCardboardMap() {
    const S = 512, rnd = mulberry32(7788);
    const c = newCanvas(S, S), g = c.getContext('2d');
    g.fillStyle = '#cbb894'; g.fillRect(0, 0, S, S);
    // 纸浆纤维：短而不规则的深浅短线。压得太规则就变成「布」了。
    for (let i = 0; i < 5200; i++) {
      const x = rnd() * S, y = rnd() * S, a = rnd() * Math.PI, len = 1.5 + rnd() * 6.5;
      const v = 0.78 + rnd() * 0.34;
      g.strokeStyle = 'rgba(' + Math.round(206 * v) + ',' + Math.round(186 * v) + ',' + Math.round(148 * v) + ',0.5)';
      g.lineWidth = 0.7 + rnd() * 1.1;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
    }
    // 几处淡淡的水渍，让纸面不至于太干净
    for (let i = 0; i < 26; i++) {
      const x = rnd() * S, y = rnd() * S, r = 14 + rnd() * 46;
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, 'rgba(176,154,116,0.16)');
      rg.addColorStop(1, 'rgba(176,154,116,0)');
      g.fillStyle = rg;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1.6, 1.6);
    DEBUG_TEX.cardboard = c;
    return t;
  }

  /* 实验台面 */
  function makeBenchMap() {
    const S = 512, rnd = mulberry32(99);
    const c = newCanvas(S, S), g = c.getContext('2d');
    // 台面压到深灰：比背景再暗一档，白玻璃器皿才有「亮—中—暗」三层可读的层次。
    // （原来 #4c4a46 被 2.05 强度的主光一照就泛白，整屏糊成一片灰。）
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
    // 背景墙压成深石板蓝：白色玻璃器皿才和背景分得开（原来近白，白上白分不出器材轮廓）
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
    // envMapIntensity 压到 0.5：棚拍环境贴图对水平台面的贡献极大，不压的话
    // 深灰台面会被 IBL 拉成中亮灰，白玻璃器皿又和它糊在一起。
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

  // 玻璃/水都叠在试样前面（烧杯壁 + 水 + 试管壁 三层），不透明度必须压得很低，
  // 否则白色试样会被三层半透明白彻底洗掉 —— 实测 0.24/0.40/0.24 时试样几乎看不见。
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: '#e6f3f8', transparent: true, opacity: 0.15, roughness: 0.05, metalness: 0.0,
    clearcoat: 1.0, clearcoatRoughness: 0.03, envMapIntensity: 2.1,
    side: THREE.DoubleSide, depthWrite: false
  });
  // 酒精灯单独一份玻璃：它前面没有别的半透明层挡着，太薄就只剩里面那柱酒精，
  // 看上去像个敞口杯子 —— 提亮一档、加环境反射，瓶壁的高光轮廓才立得住。
  const lampGlassMat = new THREE.MeshPhysicalMaterial({
    color: '#eef6fa', transparent: true, opacity: 0.24, roughness: 0.04, metalness: 0.0,
    clearcoat: 1.0, clearcoatRoughness: 0.02, envMapIntensity: 2.9,
    side: THREE.DoubleSide, depthWrite: false
  });
  const waterMat = new THREE.MeshPhysicalMaterial({
    color: '#8ed3ea', transparent: true, opacity: 0.20, roughness: 0.06, metalness: 0.0,
    clearcoat: 1.0, clearcoatRoughness: 0.04, envMapIntensity: 1.1, depthWrite: false
  });

  const stand = new THREE.Group();
  scene.add(stand);

  // 铸铁底座（带倒角）
  const base = new THREE.Mesh(new THREE.BoxGeometry(BASE_W, BASE_H, BASE_D), castIron);
  base.position.set(0, BASE_H / 2, 0);
  base.castShadow = true; base.receiveShadow = true;
  stand.add(base);
  const baseTop = new THREE.Mesh(new THREE.BoxGeometry(BASE_W - 1.6, 0.5, BASE_D - 1.6), castIron);
  baseTop.position.set(0, BASE_H + 0.25, 0);
  baseTop.castShadow = true; baseTop.receiveShadow = true;
  stand.add(baseTop);

  // 立柱
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(ROD_R, ROD_R, ROD_H, 24), chrome);
  rod.position.set(0, BASE_H + ROD_H / 2, ROD_Z);
  rod.castShadow = true;
  stand.add(rod);

  // 铁圈（托石棉网）
  function makeBoss(y, armLen) {
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(ROD_R + 0.5, ROD_R + 0.5, 2.3, 20), darkSteel);
    sleeve.position.set(0, y, ROD_Z);
    sleeve.castShadow = true;
    stand.add(sleeve);
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.5, 12), knobMat);
    screw.rotation.z = Math.PI / 2;
    screw.position.set(ROD_R + 1.05, y, ROD_Z);
    screw.castShadow = true;
    stand.add(screw);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.9, armLen), darkSteel);
    arm.position.set(0, y, ROD_Z + armLen / 2 + 0.9);
    arm.castShadow = true;
    stand.add(arm);
    return { sleeve, arm };
  }

  makeBoss(RING_Y, 3.6);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(5.3, 0.26, 12, 40), darkSteel);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(0, RING_Y, -0.35);
  ring.castShadow = true;
  stand.add(ring);

  /* 石棉圆片：短纤维随机铺满，别用纯白平面（会读成陶瓷盘） */
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

  // 石棉网
  const netMap = makeNetMap();
  const netMesh = new THREE.Mesh(
    new THREE.BoxGeometry(NET_W, NET_T, NET_W),
    new THREE.MeshStandardMaterial({ map: netMap, alphaMap: netMap, transparent: true, alphaTest: 0.35, roughness: 0.55, metalness: 0.65, color: '#cfd6dd', side: THREE.DoubleSide })
  );
  netMesh.position.set(0, RING_Y + 0.15, -0.35);
  netMesh.castShadow = true; netMesh.receiveShadow = true;
  scene.add(netMesh);

  const asbestosMap = makeAsbestosMap();
  asbestosMap.anisotropy = MAX_ANISO;
  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(5.0, 5.0, 0.2, 40),
    new THREE.MeshStandardMaterial({
      map: asbestosMap, bumpMap: asbestosMap, bumpScale: 0.03,
      // 石棉片不能是纯白：它正对着主光，纯白会变成全画面最亮的一块，把烧杯和试管压下去
      color: '#a49d8f', roughness: 0.97, metalness: 0, envMapIntensity: 0.6
    })
  );
  pad.position.set(0, RING_Y + 0.3, -0.35);
  pad.receiveShadow = true;
  scene.add(pad);

  /* --- 酒精灯（按实物重塑：鼓腹玻璃瓶 + 肩部收颈 + 金属螺旋灯盖 + 瓷灯芯管 + 棉灯芯） --- */
  const lamp = new THREE.Group();
  scene.add(lamp);
  const lampY0 = BASE_H;                                 // 灯体底面

  // 玻璃灯体：用回转体做出「鼓腹 → 收肩 → 短颈」的真实瓶形，而不是一根直筒
  const lampProfile = [
    [0.00, 0.00], [LAMP_R * 0.82, 0.00], [LAMP_R, 0.42], [LAMP_R, 3.60],
    [LAMP_R * 0.985, 4.30], [LAMP_R * 0.90, 5.05], [LAMP_R * 0.72, 5.70],
    [LAMP_R * 0.50, 6.15], [LAMP_R * 0.40, 6.45], [LAMP_R * 0.39, 6.90]
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const lampBody = new THREE.Mesh(new THREE.LatheGeometry(lampProfile, 44), lampGlassMat);
  lampBody.position.set(0, lampY0, 0);
  lamp.add(lampBody);
  // 瓶底加厚一圈（真实玻璃瓶底都有厚墩）
  const lampFoot = new THREE.Mesh(new THREE.CylinderGeometry(LAMP_R * 0.80, LAMP_R * 0.76, 0.5, 40), lampGlassMat);
  lampFoot.position.set(0, lampY0 + 0.25, 0);
  lamp.add(lampFoot);

  // 酒精液面（约半瓶）
  const ALCOHOL_H = 3.7;
  const alcohol = new THREE.Mesh(
    new THREE.CylinderGeometry(LAMP_R * 0.955, LAMP_R * 0.93, ALCOHOL_H, 40),
    new THREE.MeshPhysicalMaterial({
      color: '#e8dfae', transparent: true, opacity: 0.62, roughness: 0.06, metalness: 0,
      clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.2, depthWrite: false
    })
  );
  alcohol.position.set(0, lampY0 + 0.45 + ALCOHOL_H / 2, 0);
  lamp.add(alcohol);
  const alcoholTop = new THREE.Mesh(
    new THREE.CircleGeometry(LAMP_R * 0.955, 40),
    new THREE.MeshPhysicalMaterial({ color: '#f2ecc6', transparent: true, opacity: 0.5, roughness: 0.03, metalness: 0, clearcoat: 1, envMapIntensity: 1.5, depthWrite: false })
  );
  alcoholTop.rotation.x = -Math.PI / 2;
  alcoholTop.position.set(0, lampY0 + 0.45 + ALCOHOL_H, 0);
  lamp.add(alcoholTop);

  // 金属螺旋灯盖（镍黄铜，带滚花）
  const capMat = new THREE.MeshStandardMaterial({ color: '#b9b2a2', roughness: 0.34, metalness: 0.95, envMapIntensity: 1.3 });
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(LAMP_R * 0.44, LAMP_R * 0.46, LAMP_COLLAR_H, 30), capMat);
  cap.position.set(0, lampY0 + LAMP_H + LAMP_COLLAR_H / 2, 0);
  cap.castShadow = true;
  lamp.add(cap);
  const knurl = new THREE.Mesh(
    new THREE.CylinderGeometry(LAMP_R * 0.47, LAMP_R * 0.47, LAMP_COLLAR_H * 0.62, 40, 1, true),
    new THREE.MeshStandardMaterial({ color: '#8f8878', roughness: 0.5, metalness: 0.9, side: THREE.DoubleSide })
  );
  knurl.position.set(0, lampY0 + LAMP_H + LAMP_COLLAR_H * 0.5, 0);
  lamp.add(knurl);

  // 瓷质灯芯管（白色小套管，真实酒精灯都有）
  const wickTube = new THREE.Mesh(
    new THREE.CylinderGeometry(0.72, 0.78, WICK_H * 0.72, 24),
    new THREE.MeshStandardMaterial({ color: '#f2efe6', roughness: 0.42, metalness: 0.03 })
  );
  wickTube.position.set(0, lampY0 + LAMP_H + LAMP_COLLAR_H + WICK_H * 0.30, 0);
  wickTube.castShadow = true;
  lamp.add(wickTube);

  // 棉灯芯：下端米白、上端烧焦发黑
  const wick = new THREE.Mesh(
    new THREE.CylinderGeometry(0.46, 0.52, WICK_H, 16),
    new THREE.MeshStandardMaterial({ color: '#e0d6bd', roughness: 0.98, metalness: 0 })
  );
  wick.position.set(0, LAMP_TOP - WICK_H / 2 + 0.05, 0);
  lamp.add(wick);
  const wickChar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.44, 0.47, WICK_H * 0.34, 16),
    new THREE.MeshStandardMaterial({ color: '#2b2622', roughness: 0.95, metalness: 0 })
  );
  wickChar.position.set(0, LAMP_TOP - WICK_H * 0.13, 0);
  lamp.add(wickChar);

  /* --- 火焰（三层叠加 + 暖光） --- */
  /* --- 酒精灯火焰 --- */
  // 锥面的硬边是「卡通感」的根源。用一张竖直灰度渐变当 alphaMap 让火苗尖端淡出；
  // 注意 alphaMap 取的是 .g 通道，所以渐变要画成灰阶（不是靠 alpha 通道）。
  function makeFlameAlpha() {
    const W = 32, H = 128;
    const c = newCanvas(W, H), g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, H);   // 图像顶行 → v=1（锥尖）
    grad.addColorStop(0.00, '#000000');
    grad.addColorStop(0.18, '#3d3d3d');
    grad.addColorStop(0.48, '#d9d9d9');
    grad.addColorStop(0.82, '#ffffff');
    grad.addColorStop(1.00, '#7a7a7a');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    return new THREE.CanvasTexture(c);
  }
  function makeGlowMap() {
    const S = 128;
    const c = newCanvas(S, S), g = c.getContext('2d');
    const r = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    r.addColorStop(0, 'rgba(255,222,158,0.80)');
    r.addColorStop(0.32, 'rgba(255,166,64,0.36)');
    r.addColorStop(0.68, 'rgba(255,124,32,0.10)');
    r.addColorStop(1, 'rgba(255,110,20,0)');
    g.fillStyle = r; g.fillRect(0, 0, S, S);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  const flameGroup = new THREE.Group();
  flameGroup.position.set(0, LAMP_TOP, 0);
  // 挂在 lamp 组里（而不是 scene）：撤去酒精灯时整盏灯平移，火焰和灯光要跟着走
  lamp.add(flameGroup);

  const flameAlpha = makeFlameAlpha();
  const flameLayers = [];
  // 真实酒精灯火焰：底部一小段淡蓝焰心，外面包橙黄外焰
  // 全部用 AdditiveBlending 叠加，四层都拉满就会叠成一柱纯白 —— 逐层压低不透明度，
  // 让焰心只比外焰亮一点，才是「酒精灯」而不是「蜡烛」。
  const FLAME_SPEC = [
    { r: 1.16, h: FLAME_H, color: '#ff6a10', opacity: 0.20, blend: THREE.AdditiveBlending },
    { r: 0.74, h: FLAME_H * 0.72, color: '#ffb02e', opacity: 0.26, blend: THREE.AdditiveBlending },
    { r: 0.40, h: FLAME_H * 0.30, color: '#7cb8ff', opacity: 0.26, blend: THREE.AdditiveBlending },
    { r: 0.52, h: FLAME_H * 0.16, color: '#4f9bf5', opacity: 0.22, blend: THREE.AdditiveBlending }
  ];
  for (const s of FLAME_SPEC) {
    const geo = new THREE.ConeGeometry(s.r, s.h, 20, 1, true);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: s.color, transparent: true, opacity: s.opacity, alphaMap: flameAlpha,
      blending: s.blend, depthWrite: false, side: THREE.DoubleSide, fog: false
    }));
    m.position.y = s.h / 2;
    flameGroup.add(m);
    flameLayers.push({ mesh: m, base: s });
  }
  // 外圈柔和辉光：把锥体的硬轮廓“糊”开（太亮会把火焰整个冲成白色，压到 0.4）
  const flameGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeGlowMap(), transparent: true, opacity: 0.40,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false
  }));
  flameGlow.scale.set(5.4, 7.2, 1);
  flameGlow.position.set(0, FLAME_H * 0.40, 0);
  flameGroup.add(flameGlow);
  const flameLight = new THREE.PointLight('#ff9a3c', 3.4, 60, 2);
  flameLight.position.set(0, LAMP_TOP + FLAME_H * 0.45, 0);
  lamp.add(flameLight);

  /* --- 烧杯 + 水 --- */
  // 烧杯刻度：真实烧杯的白色印刷刻度（透明底），单独一层贴在杯壁外侧
  function makeBeakerMarks() {
    const W = 1024, H = 512;
    const c = newCanvas(W, H), g = c.getContext('2d');
    g.clearRect(0, 0, W, H);
    const x0 = Math.round(W * 0.055), x1 = Math.round(W * 0.30);   // 刻度只占杯壁一段
    g.strokeStyle = 'rgba(255,255,255,0.94)';
    g.fillStyle = 'rgba(255,255,255,0.96)';
    g.font = 'bold 34px "Helvetica Neue", Arial, sans-serif';
    g.textAlign = 'left'; g.textBaseline = 'middle';
    const labels = [50, 100, 150, 200];
    // 刻度按真实几何算，不写死比例：内半径 4.1 cm 的烧杯底面积 52.8 cm²，
    // 于是 1 mL 就是 1 cm³，每 50 mL 对应的高度 = 50 / 底面积 cm，再换算成杯高的比例。
    // 200 mL 正好落在 0.574 杯高处 —— 与初始水位 3.8 cm 对得上。
    const area = Math.PI * (BK_R - 0.1) * (BK_R - 0.1);
    const vOf = (mL) => (mL / area) / BK_H;
    for (const mL of labels) {
      const y = H - vOf(mL) * H;
      g.lineWidth = 5;
      g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
      g.fillText(String(mL), x1 + 9, y);
      // 每 50 mL 之间再分 5 小格（每格 10 mL）
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
  // 杯壁刻度层（只画外侧，避免字被镜像）
  const bkMarks = new THREE.Mesh(
    new THREE.CylinderGeometry(BK_R + 0.012, BK_R + 0.012, BK_H - 0.5, 48, 1, true),
    new THREE.MeshBasicMaterial({ map: makeBeakerMarks(), transparent: true, depthWrite: false, side: THREE.FrontSide })
  );
  bkMarks.position.set(0, BK_Y0 + BK_H / 2 - 0.1, 0);
  beaker.add(bkMarks);
  // 加厚杯底（真实烧杯底是一块厚玻璃）
  const bkFoot = new THREE.Mesh(new THREE.CylinderGeometry(BK_R * 0.985, BK_R * 0.965, 0.55, 48), glassMat);
  bkFoot.position.set(0, BK_Y0 + 0.27, 0);
  beaker.add(bkFoot);
  const bkBottom = new THREE.Mesh(new THREE.CircleGeometry(BK_R, 48), glassMat);
  bkBottom.rotation.x = -Math.PI / 2;
  bkBottom.position.set(0, BK_Y0 + 0.02, 0);
  beaker.add(bkBottom);
  // 卷边杯口 + 倒液嘴
  const bkRim = new THREE.Mesh(new THREE.TorusGeometry(BK_R, 0.14, 10, 48), glassMat);
  bkRim.rotation.x = Math.PI / 2;
  bkRim.position.set(0, BK_Y0 + BK_H, 0);
  beaker.add(bkRim);
  const bkSpout = new THREE.Mesh(new THREE.SphereGeometry(0.44, 18, 12), glassMat);
  bkSpout.scale.set(2.0, 0.82, 1.0);
  bkSpout.position.set(BK_R * 0.93, BK_Y0 + BK_H + 0.06, 0);
  beaker.add(bkSpout);

  const water = new THREE.Mesh(
    new THREE.CylinderGeometry(BK_R - 0.1, BK_R - 0.1, WATER_H, 48),
    waterMat
  );
  water.position.set(0, BK_Y0 + WATER_H / 2, 0);
  beaker.add(water);
  const waterTop = new THREE.Mesh(
    new THREE.CircleGeometry(BK_R - 0.1, 48),
    new THREE.MeshPhysicalMaterial({ color: '#bfe6f5', transparent: true, opacity: 0.44, roughness: 0.03, metalness: 0, clearcoat: 1, envMapIntensity: 1.6, side: THREE.DoubleSide, depthWrite: false })
  );
  waterTop.rotation.x = -Math.PI / 2;
  waterTop.position.set(0, WATER_TOP, 0);
  beaker.add(waterTop);

  /* --- 硬纸盖：盖住杯口、减少散热，中央开孔让温度计穿过去 --- */
  const lid = new THREE.Group();
  scene.add(lid);
  const cardMap = makeCardboardMap();
  cardMap.anisotropy = MAX_ANISO;
  const cardMat = new THREE.MeshStandardMaterial({
    map: cardMap, bumpMap: cardMap, bumpScale: 0.012,
    color: '#ffffff', roughness: 0.94, metalness: 0, envMapIntensity: 0.7, side: THREE.DoubleSide
  });
  // 用「上环 + 下环 + 外圈 + 内圈」拼出一块真有厚度的圆环板。
  // 只放一个 RingGeometry 的话孔壁没有厚度，侧看就是一张贴纸。
  const lidTop = new THREE.Mesh(new THREE.RingGeometry(LID_HOLE, LID_R, 56, 1), cardMat);
  lidTop.rotation.x = -Math.PI / 2;
  lidTop.position.set(0, LID_Y + LID_T / 2, 0);
  lidTop.castShadow = true; lidTop.receiveShadow = true;
  lid.add(lidTop);
  const lidBot = new THREE.Mesh(new THREE.RingGeometry(LID_HOLE, LID_R, 56, 1), cardMat);
  lidBot.rotation.x = -Math.PI / 2;
  lidBot.position.set(0, LID_Y - LID_T / 2, 0);
  lidBot.receiveShadow = true;
  lid.add(lidBot);
  const lidOuter = new THREE.Mesh(new THREE.CylinderGeometry(LID_R, LID_R, LID_T, 56, 1, true), cardMat);
  lidOuter.position.set(0, LID_Y, 0);
  lidOuter.castShadow = true;
  lid.add(lidOuter);
  const lidInner = new THREE.Mesh(new THREE.CylinderGeometry(LID_HOLE, LID_HOLE, LID_T, 28, 1, true), cardMat);
  lidInner.position.set(0, LID_Y, 0);
  lid.add(lidInner);

  /* --- 温度计 --- */
  // 温度计管壁比烧杯玻璃略实一点，否则整支温度计在背景里会化掉
  const thGlassMat = new THREE.MeshPhysicalMaterial({
    color: '#f2fbff', transparent: true, opacity: 0.30, roughness: 0.04, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 2.6,
    side: THREE.DoubleSide, depthWrite: false
  });
  // 感温泡 = 玻璃外囊 + 红色工作液内芯：内芯是不透明的，才能在试样里被看见
  // （玻璃泡隔着「杯壁 + 水 + 管壁 + 试样」四层，不加自发光会在透射里被稀释掉）
  const thRedMat = new THREE.MeshStandardMaterial({
    color: '#e0212c', emissive: '#a5121d', emissiveIntensity: 1.15, roughness: 0.26, metalness: 0.05
  });

  // 温度计刻度：印刷在管壁上（透明底 + 深色刻度与数字）
  /* 温度计刻度：0~110 ℃。留 10 ℃ 余量，100 ℃ 时液柱不会顶到管顶（真实温度计也这样）。 */
  function makeThermoScale() {
    const W = SCALE_TEX_W, H = SCALE_TEX_H;
    const c = newCanvas(W, H), g = c.getContext('2d');
    g.clearRect(0, 0, W, H);
    g.strokeStyle = 'rgba(38,50,60,0.95)';
    g.fillStyle = 'rgba(28,40,50,0.98)';
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(SCALE_TICK_X, 6); g.lineTo(SCALE_TICK_X, H - 6); g.stroke();
    g.font = `bold ${SCALE_NUM_FONT}px "Helvetica Neue", Arial, sans-serif`;
    g.textAlign = 'left'; g.textBaseline = 'middle';
    for (let T = 0; T <= 110; T += 2) {
      const y = scaleCanvasY(T);
      const major = T % 10 === 0;
      const len = major ? 16 : 7;
      g.lineWidth = major ? 2.4 : 1.6;
      g.beginPath(); g.moveTo(SCALE_TICK_X - len, y); g.lineTo(SCALE_TICK_X, y); g.stroke();
      if (major) g.fillText(String(T), SCALE_NUM_X, y);
    }
    // 量出刻度条真正占的水平范围（含数字），供旋转角使用 —— 改字号/刻度长度后自动跟上
    const d = g.getImageData(0, 0, W, H).data;
    let x0 = W, x1 = -1;
    for (let y = 0; y < H; y++) {
      const row = y * W * 4;
      for (let x = 0; x < W; x++) {
        if (d[row + x * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
      }
    }
    scaleU0 = x0 / W; scaleU1 = (x1 + 1) / W;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /* 刻度 T 画在贴图的哪一行 —— 印刷刻度与液柱映射共用这一个式子，两边不可能再对不上 */
  function scaleCanvasY(T) {
    return SCALE_TEX_H - 6 - (T / 110) * (SCALE_TEX_H - 12);
  }
  /* 刻度网格的竖直跨度（下沿 = 玻璃泡中心，上沿 = 管顶下 0.6 cm） */
  const SCALE_Y0 = TH_BULB_Y;
  const SCALE_Y1 = TH_BULB_Y + TH_TUBE_H - 1.2;
  /* CanvasTexture 默认 flipY：贴图 v = 1 − y/H。刻度 T 的世界高度由这里唯一给出。
     曾把 STEM_Y0/STEM_Y1 另写成 TH_BULB_Y+0.55 / TH_BULB_Y+TH_TUBE_H−0.6，
     与印刷刻度差了 0.45~0.70 cm（≈3~5 ℃），液柱顶端和数字对不上。 */
  const scaleYOf = (T) => SCALE_Y0 +
    (1 - scaleCanvasY(T) / SCALE_TEX_H) * (SCALE_Y1 - SCALE_Y0);
  const STEM_Y0 = scaleYOf(0);                       // 刻度 0 ℃ 的世界高度
  const STEM_Y1 = scaleYOf(110);                     // 刻度 110 ℃ 的世界高度

  const thermometer = new THREE.Group();
  thermometer.position.set(TH_X, 0, TH_Z);
  scene.add(thermometer);

  const thGlass = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, TH_TUBE_H, 20, 1, true), thGlassMat);
  thGlass.position.set(0, TH_BULB_Y + TH_TUBE_H / 2 - 0.6, 0);
  thermometer.add(thGlass);
  const thScale = new THREE.Mesh(
    new THREE.CylinderGeometry(0.248, 0.248, SCALE_Y1 - SCALE_Y0, 20, 1, true),
    new THREE.MeshBasicMaterial({ map: makeThermoScale(), transparent: true, depthWrite: false, side: THREE.FrontSide })
  );
  thScale.position.set(0, (SCALE_Y0 + SCALE_Y1) / 2, 0);
  /* 把刻度条转到正对相机的那半边管壁。贴图里刻度条中心在 u = (scaleU0+scaleU1)/2
     （CylinderGeometry 的 u=0 在 +z，θ = 360°·u），绕 y 转 φ 后 θ → θ+φ，
     所以 φ = 目标方位角 − 360°·u_center。不转的话它贴在背面，等于没画。 */
  thScale.rotation.y = (SCALE_FACE_DEG - 360 * (scaleU0 + scaleU1) / 2) * Math.PI / 180;
  thermometer.add(thScale);
  /* 背面再印一条：用户可以拖动视角绕到后面，真实温度计从哪一面看都有刻度。
     两条都是 FrontSide，所以正面不会透出背面那条的镜像数字。 */
  const thScaleBack = thScale.clone();
  thScaleBack.rotation.y += Math.PI;
  thermometer.add(thScaleBack);
  const thBulb = new THREE.Mesh(new THREE.SphereGeometry(TH_BULB_R, 22, 14), thGlassMat);
  thBulb.position.set(0, TH_BULB_Y, 0);
  thermometer.add(thBulb);
  const thCap = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 10), thGlassMat);
  thCap.position.set(0, TH_BULB_Y + TH_TUBE_H - 0.6, 0);
  thermometer.add(thCap);

  const mercury = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 1, 12), thRedMat);
  const mercuryBulb = new THREE.Mesh(new THREE.SphereGeometry(TH_BULB_R - 0.07, 18, 12), thRedMat);
  mercuryBulb.position.set(0, TH_BULB_Y, 0);
  thermometer.add(mercury);
  thermometer.add(mercuryBulb);

  /* --- 铁夹：把温度计固定在铁架台的横臂上（松开螺丝可整体上下滑动） --- */
  // 整组跟着温度计一起升降 —— 真实操作就是「松开螺丝 → 夹子带着温度计一起滑」，
  // 所以它属于 thSupport 而不是 stand。
  const thSupport = new THREE.Group();
  scene.add(thSupport);

  const clampArm = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.86, 4.7), darkSteel);
  clampArm.position.set(0, CLAMP_Y, ROD_Z + 0.9 + 4.7 / 2);
  clampArm.castShadow = true;
  thSupport.add(clampArm);

  const clampSleeve = new THREE.Mesh(new THREE.CylinderGeometry(ROD_R + 0.5, ROD_R + 0.5, 2.3, 20), darkSteel);
  clampSleeve.position.set(0, CLAMP_Y, ROD_Z);
  clampSleeve.castShadow = true;
  thSupport.add(clampSleeve);

  const clampScrew = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.5, 12), knobMat);
  clampScrew.rotation.z = Math.PI / 2;
  clampScrew.position.set(ROD_R + 1.05, CLAMP_Y, ROD_Z);
  clampScrew.castShadow = true;
  thSupport.add(clampScrew);

  // 夹口：两片夹爪 + 一圈软垫。软垫是真实铁夹必有的，不然夹碎玻璃管。
  for (const s of [-1, 1]) {
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.6, 0.4), darkSteel);
    jaw.position.set(s * 0.52, CLAMP_Y, 0);
    jaw.rotation.z = s * 0.08;
    jaw.castShadow = true;
    thSupport.add(jaw);
  }
  const clampPad = new THREE.Mesh(new THREE.TorusGeometry(0.30, 0.11, 8, 24), knobMat);
  clampPad.rotation.x = Math.PI / 2;
  clampPad.position.set(0, CLAMP_Y, 0);
  thSupport.add(clampPad);

  /* --- 气泡：沸腾前「上升变小」，沸腾时「上升变大、到水面破裂」 --- */
  // 这是本实验最核心的观察点，所以气泡不是装饰：每个泡自己记着出生位置与半径，
  // 由物理量 boilness 决定它一路上是缩还是胀（形态函数 bubbleScale() 在物理段里）。
  const bubbleMat = new THREE.MeshPhysicalMaterial({
    color: '#ffffff', transparent: true, opacity: 0.42, roughness: 0.04, metalness: 0,
    clearcoat: 1, envMapIntensity: 1.5, depthWrite: false
  });
  const BUBBLE_N = 34;
  const bubbles = [];
  const rndB = mulberry32(31337);
  for (let i = 0; i < BUBBLE_N; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), bubbleMat);
    m.userData = {
      a: rndB() * Math.PI * 2,          // 绕杯轴的方位角
      rad: rndB() * (BK_R - 1.0),       // 离轴距离
      u: rndB(),                        // 归一化高度：0 = 杯内底，1 = 水面
      spd: 0.26 + rndB() * 0.40,        // 上升速度（u / 秒）
      r0: 0.055 + rndB() * 0.05,        // 出生半径
      wob: rndB() * 6.28
    };
    m.visible = false;
    scene.add(m);
    bubbles.push(m);
  }

  /* --- 白气：从纸盖的孔里冒出来的水蒸气，遇冷液化成的小水珠 --- */
  // 注意：白气是「小水珠」不是水蒸气，水蒸气本身无色透明 —— 这一点在结论里要讲清楚。
  const steams = [];
  for (let i = 0; i < 12; i++) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(1, 10, 8),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, fog: false })
    );
    m.userData = {
      ph: rndB(), a: rndB() * 6.28, rad: 0.30 + rndB() * 0.62,
      spd: 0.30 + rndB() * 0.34, r0: 0.20 + rndB() * 0.16
    };
    m.visible = false;
    scene.add(m);
    steams.push(m);
  }

  /* ==========================================================================
     四、物理积分
     --------------------------------------------------------------------------
     单节点热平衡：酒精灯给水加热，水同时向环境散热。
       dT/dt = (P − k·(T − T₀)) / (m·c)
     一旦 T 到达沸点 Tb，温度就锁在 Tb，多出来的净功率全部变成汽化潜热：
       dm/dt = −(P − k·(Tb − T₀)) / L_v
     撤去酒精灯（P = 0）后水开始降温，沸腾立刻停止 —— 这正是「沸腾需要继续吸热」。
     ========================================================================== */

  /* 沸点由气压决定：Antoine 方程（水的常用参数，1~100 ℃ 内误差 < 0.1 ℃）。
     面板上标出的沸点必须由这里算出来，不许在文案里另写一个数。 */
  function boilingPoint(pKPa) {
    const mmHg = pKPa * 7.500617;
    return 1730.63 / (8.07131 - Math.log10(mmHg)) - 233.426;
  }

  /* 沸腾程度：0 = 远未沸腾，1 = 正在剧烈沸腾。
     统一驱动气泡形态、白气浓度、水面翻腾与结论文案 —— 只留一个真值来源。 */
  function boilness() {
    return smoothstep(state.Tb - 8, state.Tb - 0.3, state.T);
  }

  /* 画面上的沸腾程度：温度够了【并且】还在继续吸热才算沸腾。
     撤去酒精灯后水仍是 100 ℃，但气泡、白气、水面翻腾必须立刻收住 ——
     「沸腾需要继续吸热」正是本节要得出的结论，只按温度画就会自相矛盾。
     乘 flameAnim（火焰本来就在 0.3 s 内淡出）是为了让「立刻停」在视觉上平滑收尾。 */
  function boilnessVis() {
    return boilness() * state.flameAnim;
  }

  function isBoiling() {
    return state.lampOn && state.T >= state.Tb - 0.02;
  }

  /* 气泡半径随高度 u（0 = 杯内底，1 = 水面）的变化 —— 本实验要看的核心现象：
     沸腾前：上层水温低，泡里的水蒸气遇冷又液化，越升越小，还没到水面就没了；
     沸腾时：整杯水都在沸点，泡里不断有水蒸气补充，越升越大，到水面破裂。
     两者按 boilnessVis 线性混合，过渡是连续的，不会突然跳变。
     ⚠ 这里必须用 boilnessVis 而不是 boilness：撤去酒精灯后水仍是 100 ℃，
     boilness 还是 1，气泡就会继续「越升越大」地翻腾，与本节结论自相矛盾。 */
  function bubbleScale(u) {
    const b = boilnessVis();
    const shrink = Math.max(0, 0.55 * (1 - 1.15 * u));  // 沸腾前：越升越小，到 u≈0.87 就缩没了
    const grow = 0.75 + 1.65 * u;                       // 沸腾时：越升越大
    return shrink * (1 - b) + grow * b;
  }

  /* 水深随汽化缓慢变浅（沸腾时一直在失水） */
  function waterDepth() {
    return WATER_H * (state.mass / M_WATER);
  }

  function integrate(dt) {
    const P = state.lampOn ? P_LAMP : 0;
    const net = P - K_LOSS * (state.T - AMB);

    if (state.T >= state.Tb - 1e-9 && net > 0) {
      // 沸腾：温度锁死，净功率全部用于汽化，水量缓慢减少
      state.T = state.Tb;
      state.mass = Math.max(0, state.mass - net / LV_WATER * dt);
      if (state.boilStart < 0) state.boilStart = state.t;
      state.boilTime += dt;
    } else {
      state.T += net / (state.mass * C_WATER) * dt;
      if (state.T > state.Tb) state.T = state.Tb;   // 不会冲过沸点
      if (state.boilStart >= 0 && !isBoiling()) state.boilStart = -1;
    }

    state.t += dt;
    if (state.boilTime >= BOIL_HOLD || state.mass <= M_WATER * MASS_MIN) state.finished = true;
  }

  function stepSim(dtReal) {
    const simDt = Math.min(dtReal * state.speed, 1.2);
    const n = Math.max(1, Math.ceil(simDt / 0.05));
    const h = simDt / n;
    for (let i = 0; i < n; i++) {
      if (state.finished) break;
      integrate(h);
    }
  }

  /* 换气压环境：沸点重算，已经越过新沸点的水立刻被拉回沸点（换到低气压时马上开锅） */
  function setPressure(key) {
    state.pressure = Object.prototype.hasOwnProperty.call(PRESSURES, key) ? key : 'std';
    state.Tb = boilingPoint(PRESSURES[state.pressure].p);
    if (state.T > state.Tb) state.T = state.Tb;
  }

  function resetSim() {
    state.t = 0;
    state.T = AMB;
    state.mass = M_WATER;
    state.boilStart = -1;
    state.boilTime = 0;
    state.finished = false;
    setLamp(true);            // 「重置」= 回到初始状态：撤走的酒精灯也放回来（否则重置后永远烧不开）
    // 灯的位移与火焰强度是平滑量，重置时必须直接归位；否则重置后头 0.3 s
    // boilnessVis() 还是 0，气泡/白气会「先不出来」再慢慢浮现。
    state.lampAnim = 1;
    state.flameAnim = 1;
    setPressure(state.pressure);
    series.length = 0;
    pushSample();
  }

  /* ==========================================================================
     五、随状态更新器材
     ========================================================================== */
  function updateWater() {
    const depth = waterDepth();
    // 水位随汽化下降：整根水柱按比例压扁，再重新摆到底面上
    water.scale.set(1, depth / WATER_H, 1);
    water.position.set(0, BK_Y0 + depth / 2, 0);
    waterTop.position.set(0, BK_Y0 + depth, 0);

    // 温度计液柱：顶端按刻度线性映射（0 ℃ → STEM_Y0，110 ℃ → STEM_Y1），与印刷刻度一致
    const stemLen = STEM_Y1 - STEM_Y0;
    const colTop = STEM_Y0 + clamp(state.T / 110, 0, 1) * stemLen;
    const colH = Math.max(0.4, colTop - TH_BULB_Y);
    mercury.scale.set(1, colH, 1);
    mercury.position.set(0, TH_BULB_Y + colH / 2, 0);
  }

  /* ==========================================================================
     六、温度—时间图像
     ========================================================================== */
  const chartCanvas = $('chartCanvas');
  const series = [];
  let sampleAcc = 0;
  function pushSample() {
    series.push([state.t, state.T, boilness()]);
    if (series.length > 3000) series.splice(0, 1000);
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

    const padL = 42, padR = 16, padT = 14, padB = 26;
    const pw = W - padL - padR, ph = H - padT - padB;
    const tMax = Math.max(240, Math.ceil((state.t + 20) / 60) * 60);
    const T0 = 10, T1 = 110;
    const X = (t) => padL + (t / tMax) * pw;
    const Y = (T) => padT + (T1 - T) / (T1 - T0) * ph;

    g.fillStyle = '#0a1a2b';
    g.fillRect(0, 0, W, H);

    // 网格
    g.strokeStyle = 'rgba(120,150,180,0.16)';
    g.lineWidth = 1;
    g.font = '10px "Helvetica Neue", Arial, sans-serif';
    g.fillStyle = 'rgba(150,180,205,0.85)';
    g.textAlign = 'right'; g.textBaseline = 'middle';
    for (let T = 20; T <= 100; T += 20) {
      const y = Y(T);
      g.beginPath(); g.moveTo(padL, y); g.lineTo(W - padR, y); g.stroke();
      g.fillText(String(T), padL - 5, y);
    }
    g.textAlign = 'center'; g.textBaseline = 'top';
    const tStep = tMax <= 300 ? 60 : tMax <= 600 ? 120 : 180;
    for (let t = 0; t <= tMax; t += tStep) {
      const x = X(t);
      g.beginPath(); g.moveTo(x, padT); g.lineTo(x, H - padB); g.stroke();
      g.fillText(String(t), x, H - padB + 6);
    }
    // 两个轴单位分左右锚，写在同一坐标会完全重叠
    g.textAlign = 'left';
    g.fillStyle = 'rgba(160,190,215,0.9)';
    g.fillText('T/℃', padL - 32, padT - 12);
    g.textAlign = 'right';
    g.fillText('t/s', W - padR, padT - 12);
    g.textAlign = 'left';

    // 沸点参考线：低气压时额外画一条 100 ℃ 的标准大气压对照线
    if (toggles.boilLine) {
      if (state.Tb < 99.5) {
        const y100 = Y(100);
        g.setLineDash([3, 4]);
        g.strokeStyle = 'rgba(148,163,184,0.75)';
        g.lineWidth = 1.3;
        g.beginPath(); g.moveTo(padL, y100); g.lineTo(W - padR, y100); g.stroke();
        g.setLineDash([]);
        g.fillStyle = 'rgba(148,163,184,0.95)';
        g.font = '10px "Helvetica Neue", Arial, sans-serif';
        g.textAlign = 'right'; g.textBaseline = 'bottom';
        g.fillText('标准大气压 100 ℃', W - padR - 4, y100 - 3);
      }
      const y = Y(state.Tb);
      g.setLineDash([6, 4]);
      g.strokeStyle = 'rgba(250,204,21,0.92)';
      g.lineWidth = 1.7;
      g.beginPath(); g.moveTo(padL, y); g.lineTo(W - padR, y); g.stroke();
      g.setLineDash([]);
      g.fillStyle = '#facc15';
      g.font = 'bold 11px "Helvetica Neue", Arial, sans-serif';
      g.textAlign = 'left'; g.textBaseline = 'bottom';
      g.fillText(`沸点 ${state.Tb.toFixed(1)} ℃`, padL + 6, y - 3);
    }

    // 沸腾平台着色（曲线走平的那一段）
    if (series.length > 1) {
      let runStart = -1;
      const bands = [];
      for (let i = 0; i < series.length; i++) {
        const inBoil = series[i][2] > 0.9;
        if (inBoil && runStart < 0) runStart = i;
        if ((!inBoil || i === series.length - 1) && runStart >= 0) {
          bands.push([series[runStart][0], series[i][0]]);
          runStart = -1;
        }
      }
      g.fillStyle = 'rgba(251,146,60,0.13)';
      for (const [a, b] of bands) g.fillRect(X(a), padT, Math.max(1, X(b) - X(a)), ph);
    }

    // 水温曲线
    if (series.length > 1) {
      const grad = g.createLinearGradient(0, padT, 0, H - padB);
      grad.addColorStop(0, 'rgba(251,146,60,0.22)');
      grad.addColorStop(1, 'rgba(251,146,60,0.02)');
      g.beginPath();
      g.moveTo(X(series[0][0]), H - padB);
      series.forEach((p) => g.lineTo(X(p[0]), Y(p[1])));
      g.lineTo(X(series[series.length - 1][0]), H - padB);
      g.closePath();
      g.fillStyle = grad; g.fill();

      g.strokeStyle = '#fb923c';
      g.lineWidth = 2.4;
      g.beginPath();
      series.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))));
      g.stroke();

      const last = series[series.length - 1];
      g.fillStyle = '#fdba74';
      g.beginPath(); g.arc(X(last[0]), Y(last[1]), 4, 0, 7); g.fill();
      g.strokeStyle = 'rgba(253,186,116,0.45)';
      g.lineWidth = 2;
      g.beginPath(); g.arc(X(last[0]), Y(last[1]), 8, 0, 7); g.stroke();
    }
  }

  /* ==========================================================================
     七、微观分子示意
     --------------------------------------------------------------------------
     要讲清两件事：① 温度越高，分子平均动能越大，能挣脱水面的分子越多（蒸发）；
     ② 沸腾时分子是在液体【内部】也大量汽化 —— 所以液体里会冒气泡，
        而蒸发只发生在表面。这也是「蒸发和沸腾」最本质的区别。
     ========================================================================== */
  const microCanvas = $('microCanvas');
  const microText = $('microText');
  const rndM = mulberry32(5150);
  const SURF = 0.46;                 // 水面在画面里的位置（v：0 在上、1 在下）
  const MM = [];                     // 液态分子
  const MV = [];                     // 已汽化、跑到水面上方的分子
  (() => {
    const cols = 12, rows = 6;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        MM.push({
          hx: (c + 0.5 + (r % 2 ? 0.5 : 0)) / cols,
          hy: SURF + 0.08 + (r + 0.5) / rows * 0.42,
          x: 0, y: 0, jp: rndM() * 6.28, escaped: false
        });
      }
    }
    MM.forEach((p) => { p.x = p.hx; p.y = p.hy; });
  })();

  /* 供自检读取：三种粒子的实时数量 */
  function microStats() {
    return {
      liquid: MM.filter((p) => !p.escaped).length,
      vapour: MV.length,
      boilness: +boilness().toFixed(3)
    };
  }

  function drawMicro(dt) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = microCanvas.clientWidth || 210;
    const H = microCanvas.clientHeight || 108;
    if (microCanvas.width !== Math.round(W * dpr) || microCanvas.height !== Math.round(H * dpr)) {
      microCanvas.width = Math.round(W * dpr);
      microCanvas.height = Math.round(H * dpr);
    }
    const g = microCanvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#0a1a2b';
    g.fillRect(0, 0, W, H);

    const b = boilness();
    const energy = clamp((state.T - AMB) / Math.max(1, state.Tb - AMB), 0, 1);
    const amp = 0.0016 + energy * 0.0075;      // 热运动幅度 ∝ 温度
    const px = (u) => 4 + u * (W - 8);
    const py = (v) => 4 + v * (H - 8);

    g.save();
    g.beginPath(); g.rect(4, 4, W - 8, H - 8); g.clip();

    // 水体与水面的位置随水量一起下降（沸腾时水在变少）
    const surf = SURF + (1 - state.mass / M_WATER) * 0.5;
    g.fillStyle = 'rgba(56,189,248,0.10)';
    g.fillRect(px(0), py(surf), W - 8, H - 4 - py(surf));
    g.strokeStyle = 'rgba(125,211,252,0.5)';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(px(0), py(surf)); g.lineTo(px(1), py(surf)); g.stroke();

    // 沸腾时液体【内部】大量汽化 —— 画成从底部升起、越升越大的气泡
    if (b > 0.05) {
      g.strokeStyle = 'rgba(186,230,253,' + (0.25 + 0.5 * b).toFixed(2) + ')';
      g.lineWidth = 1.1;
      for (let i = 0; i < 7; i++) {
        const ph = ((clock * 0.30 * (0.7 + i * 0.09) + i * 0.37) % 1);
        const bx = px(0.08 + ((i * 0.137) % 0.84));
        const by = py(surf + (1 - ph) * (1 - surf) * 0.92);
        const r = 1.1 + ph * 3.4 * b;
        g.beginPath(); g.arc(bx, by, r, 0, 7); g.stroke();
      }
    }

    // 液态分子：在原位小幅振动；够能量又靠近水面的会挣脱（蒸发）
    const escapeRate = (0.10 + 2.6 * b) * dt;      // 沸腾时大幅提高，且不再限制在表面
    for (const p of MM) {
      if (p.escaped) {
        // 逃出去的分子往上飘，飘出画面后在底部重生
        p.y -= dt * 0.55;
        p.x += Math.sin(clock * 3 + p.jp) * dt * 0.10;
        if (p.y < 0.02) { p.escaped = false; p.x = p.hx; p.y = surf + 0.10 + rndM() * 0.28; }
        continue;
      }
      p.jp += dt * (2 + energy * 14);
      p.x = p.hx + Math.sin(p.jp) * amp;
      p.y = p.hy + Math.cos(p.jp * 1.3) * amp;
      const nearSurface = p.y < surf + 0.14;
      if (Math.random() < escapeRate && (nearSurface || b > 0.5)) {
        p.escaped = true;
        MV.push(p);
      }
    }

    // 上方的水蒸气分子
    for (let i = MV.length - 1; i >= 0; i--) {
      const p = MV[i];
      if (!p.escaped) { MV.splice(i, 1); continue; }
      g.fillStyle = 'rgba(226,240,255,0.75)';
      g.beginPath(); g.arc(px(p.x), py(p.y), 2.1, 0, 7); g.fill();
    }
    // 逃逸分子数封顶，避免长时间跑下去把画面塞满
    if (MV.length > 26) MV.splice(0, MV.length - 26);

    // 液态分子
    for (const p of MM) {
      if (p.escaped) continue;
      g.fillStyle = 'rgba(125,211,252,' + (0.62 + energy * 0.34).toFixed(2) + ')';
      g.beginPath(); g.arc(px(p.x), py(p.y), 2.6, 0, 7); g.fill();
    }
    g.restore();

    g.font = '10px "Helvetica Neue", Arial, sans-serif';
    g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillStyle = 'rgba(150,180,205,0.8)';
    g.fillText(b > 0.5 ? '液体内部也在汽化 → 冒气泡' : '只有水面上的分子能挣脱', 8, 7);

    microText.textContent = b <= 0.02
      ? '分子挨在一起振动，只有少数跑得快的能从水面挣脱 —— 这是蒸发，比较缓慢'
      : b < 0.5
        ? '温度升高，分子平均动能变大，能挣脱水面的分子越来越多'
        : '到了沸点：液体【内部】也大量汽化，水里冒出气泡，到水面破裂 —— 这就是沸腾';
  }

  /* ==========================================================================
     八、界面刷新
     ========================================================================== */
  const els = {
    temp: $('metricTemp'), boil: $('metricBoil'), state: $('metricState'),
    time: $('metricTime'), mass: $('metricMass'),
    hudTemp: $('hudTemp'), hudBoil: $('hudBoil'), hudLamp: $('hudLamp'),
    finding: $('finding'),
    runBtn: $('runBtn'), pauseBtn: $('pauseBtn'), resetBtn: $('resetBtn'), lampBtn: $('lampBtn')
  };

  function statusText() {
    if (!state.lampOn) return state.T >= state.Tb - 0.05 ? '已撤火 · 停止沸腾' : '降温中 · 不再沸腾';
    if (state.T >= state.Tb - 0.02) return '沸腾中 · 温度不变';
    if (state.T >= state.Tb - 5) return '即将沸腾';
    return '升温中';
  }

  /* 右侧窄表格里的短状态，四个字以内才排得下一行 */
  function shortState() {
    if (!state.lampOn) return '降温中';
    if (state.T >= state.Tb - 0.02) return '沸腾中';
    if (state.T >= state.Tb - 5) return '快开了';
    return '升温中';
  }

  function updateReadouts() {
    els.temp.textContent = `${state.T.toFixed(1)} ℃`;
    els.boil.textContent = `${state.Tb.toFixed(1)} ℃`;
    els.state.textContent = statusText();
    els.time.textContent = `${state.t.toFixed(0)} s`;
    els.mass.textContent = `${(state.mass * 1000).toFixed(0)} g`;
    els.hudTemp.textContent = state.T.toFixed(1);
    els.hudBoil.textContent = state.Tb.toFixed(1);
    if (els.hudLamp) els.hudLamp.textContent = state.lampOn ? '加热中' : '已撤去';

    const lowP = state.Tb < 99.5;
    let hint;
    if (!state.lampOn) {
      hint = state.T >= state.Tb - 0.05
        ? `酒精灯已经撤走：水还是 ${state.T.toFixed(1)} ℃，却立刻不再沸腾 —— 说明沸腾必须<b>继续吸热</b>，光达到沸点还不够。`
        : `撤去酒精灯后水温正在下降（现在 ${state.T.toFixed(1)} ℃），气泡很快消失，沸腾停止。`;
    } else if (state.T < state.Tb - 8) {
      hint = `升温中：水温 ${state.T.toFixed(1)} ℃，离沸点还差 ${(state.Tb - state.T).toFixed(1)} ℃。盯住杯底 —— 有小气泡冒出来，但越往上越小。`;
    } else if (state.T < state.Tb - 0.02) {
      hint = `快开了：气泡明显变多变大，却还没到水面就消失了。因为上层水温还低于沸点，泡里的水蒸气遇冷又液化。`;
    } else {
      hint = `正在沸腾：温度死死停在 ${state.Tb.toFixed(1)} ℃，酒精灯还在烧，水还在吸热。气泡一路上升一路<b>变大</b>，到水面破裂放出水蒸气 —— 这些水蒸气遇冷液化成小水珠，就是我们看到的白气。`
        + (lowP ? `注意：这里的气压只有 ${PRESSURES[state.pressure].p.toFixed(1)} kPa，所以沸点不是 100 ℃ 而是 ${state.Tb.toFixed(1)} ℃ —— 气压越低，沸点越低。` : '');
    }
    els.finding.innerHTML = hint;
  }

  function refreshAll(dt) {
    updateWater();
    drawChart();
    drawMicro(dt || 0.016);
    updateReadouts();
    requestRender();
  }

  /* ==========================================================================
     九、动画
     ========================================================================== */
  let dirty = true;
  const requestRender = () => { dirty = true; };
  let clock = 0;

  function animateParts(dt) {
    clock += dt;
    /* 视觉强度走 boilnessVis（温度够了【且】还在吸热）：
       撤火后它 0.3 s 内归零，气泡形态、白气、水面翻腾一起收住。 */
    const b = boilnessVis();
    const depth = waterDepth();

    /* 酒精灯：撤去时整盏灯滑到旁边，火焰同步缩小 + 淡出。
       两个平滑值（位置 / 火焰）走同一段代码，所以「熄火」和「移开」是同时发生的。 */
    const lampTarget = state.lampOn ? 1 : 0;
    state.lampAnim += (lampTarget - state.lampAnim) * Math.min(1, dt * 2.6);
    if (Math.abs(lampTarget - state.lampAnim) < 0.002) state.lampAnim = lampTarget;
    lamp.position.x = LAMP_X0 + (LAMP_X1 - LAMP_X0) * (1 - state.lampAnim);

    state.flameAnim += (lampTarget - state.flameAnim) * Math.min(1, dt * 3.4);
    if (Math.abs(lampTarget - state.flameAnim) < 0.004) state.flameAnim = lampTarget;
    const fa = state.flameAnim;

    const wob = Math.sin(clock * 7.3) * 0.5 + Math.sin(clock * 11.7 + 1.3) * 0.3 + Math.sin(clock * 3.1) * 0.2;
    const wob2 = Math.sin(clock * 9.1 + 0.7);
    flameGroup.visible = fa > 0.012;
    if (flameGroup.visible) {
      flameGroup.scale.set((1 + wob * 0.055) * fa, (1 + wob2 * 0.045) * fa, (1 + wob * 0.05) * fa);
      flameGroup.position.x = wob * 0.11;
      flameGroup.rotation.z = wob * 0.035;
      for (const L of flameLayers) L.mesh.material.opacity = L.base.opacity * fa;
      flameGlow.material.opacity = 0.40 * fa;
    }
    flameLight.intensity = (3.2 + wob * 0.5) * fa;

    /* 温度计插入 / 提起：指数平滑跟随目标，铁夹带着它一起上下滑 */
    state.thAnim += (state.thDepth - state.thAnim) * Math.min(1, dt * 3.6);
    if (Math.abs(state.thDepth - state.thAnim) < 0.002) state.thAnim = state.thDepth;
    const thLift = (1 - state.thAnim) * TH_LIFT;
    thermometer.position.y = thLift;
    thSupport.position.y = thLift;
    if (Math.abs(state.thDepth - state.thAnim) > 5e-4) dirty = true;   // 只有还在动的时候才要求重绘

    /* 气泡：出生在杯底，按 bubbleScale(u) 决定上升途中是缩还是胀。
       u ≥ 1（到水面破裂）或半径缩到看不见（半路消失）都回收，重新从杯底冒。
       出现条件还要加一条「还在吸热，或水还没烧到沸点附近」：
       撤去酒精灯后水温仍是 100 ℃（> Tb−8），此时杯底不再产生水蒸气，
       气泡必须收住 —— 否则「沸腾需要继续吸热」的结论在画面上就站不住。
       阈值 Tb−8 与 boilness() 的斜坡下沿取同一个值，两边不会各写一个数。 */
    const showB = toggles.bubbles && state.T > 42 && (state.lampOn || state.T < state.Tb - 8);
    for (const m of bubbles) {
      const u = m.userData;
      m.visible = showB;
      if (!m.visible) continue;
      u.u += u.spd * (0.30 + 1.7 * b) * dt;
      const sc = bubbleScale(u.u) * u.r0;
      if (u.u >= 1 || sc < 0.012) {
        u.u = 0.015 + rndB() * 0.10;
        u.a = rndB() * 6.28;
        u.rad = rndB() * (BK_R - 1.0);
        u.r0 = 0.085 + rndB() * 0.07;
        continue;
      }
      const jitter = Math.sin(clock * 2.4 + u.wob) * (0.08 + 0.16 * b);
      m.position.set(
        Math.cos(u.a) * u.rad + jitter,
        BK_Y0 + 0.35 + u.u * (depth - 0.5),
        Math.sin(u.a) * u.rad + jitter
      );
      m.scale.setScalar(sc);
    }

    /* 白气：从纸盖的孔里冒出来。孔被温度计占着，所以水蒸气是从孔壁那一圈缝隙喷出的。 */
    for (const m of steams) {
      const u = m.userData;
      m.visible = toggles.steam && b > 0.16;
      if (!m.visible) continue;
      u.ph += dt * u.spd;
      const cyc = u.ph % 1;
      const y = LID_Y + 0.30 + cyc * 8.6;
      const spread = u.rad + cyc * 1.55;
      m.position.set(Math.cos(u.a) * spread, y, Math.sin(u.a) * spread);
      m.scale.setScalar(u.r0 + cyc * 1.5);
      m.material.opacity = 0.30 * b * Math.sin(cyc * Math.PI) * (1 - cyc * 0.55);
    }

    /* 水面：沸腾时明显翻腾，平时只有极轻微的起伏 */
    waterTop.position.y = BK_Y0 + depth + Math.sin(clock * (1.6 + 3.4 * b)) * (0.010 + 0.052 * b);
  }

  /* ==========================================================================
     十、相机与交互
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
    view.dist = clamp(view.dist * (1 + Math.sign(e.deltaY) * 0.08), 22, 190);
    updateCamera();
  }, { passive: false });

  document.querySelectorAll('[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = VIEWS[btn.dataset.view];
      if (!v) return;
      Object.assign(view, v);
      document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b === btn));
      updateCamera();
    });
  });

  /* --- 气压环境 --- */
  // 按钮上的沸点必须由 boilingPoint() 现算，不许在 HTML 里写死一个数 ——
  // 否则改公式的时候文案会和曲线打架。
  function applyPressureUI() {
    document.querySelectorAll('[data-pressure]').forEach((b) => {
      b.classList.toggle('active', b.dataset.pressure === state.pressure);
      const pr = PRESSURES[b.dataset.pressure];
      const small = b.querySelector('small');
      if (pr && small) small.textContent = `${pr.place} · 沸点 ${boilingPoint(pr.p).toFixed(1)} ℃`;
    });
  }
  document.querySelectorAll('[data-pressure]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setPressure(btn.dataset.pressure);
      applyPressureUI();
      refreshAll();
    });
  });
  applyPressureUI();

  /* --- 运行控制 --- */
  function setRunning(v) {
    state.running = v;
    els.runBtn.disabled = v;
    els.pauseBtn.disabled = !v;
    els.runBtn.textContent = state.t > 0 ? '继续加热' : '开始加热';
  }
  els.runBtn.addEventListener('click', () => {
    if (state.finished) resetSim();
    setRunning(true);
  });
  els.pauseBtn.addEventListener('click', () => setRunning(false));
  els.resetBtn.addEventListener('click', () => {
    setRunning(false);
    resetSim();
    clearRecords();            // 「重置」= 从头再来，记录表一起清空
    refreshAll();
  });

  /* --- 撤去 / 放回酒精灯：这是「沸腾需要继续吸热」的关键操作 --- */
  function setLamp(on) {
    state.lampOn = on;
    els.lampBtn.textContent = on ? '撤去酒精灯' : '放回酒精灯';
    els.lampBtn.classList.toggle('active', !on);
    requestRender();
  }
  els.lampBtn.addEventListener('click', () => setLamp(!state.lampOn));

  document.querySelectorAll('[data-speed]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.speed = Number(btn.dataset.speed);
      document.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('active', b === btn));
    });
  });

  /* --- 温度计插入 / 提起（铁夹带着温度计一起上下滑） --- */
  document.querySelectorAll('[data-thdepth]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.thDepth = Number(btn.dataset.thdepth);
      document.querySelectorAll('[data-thdepth]').forEach((b) => b.classList.toggle('active', b === btn));
      requestRender();
    });
  });

  /* --- 显示开关 --- */
  $('toggleBubbles').addEventListener('change', (e) => { toggles.bubbles = e.target.checked; requestRender(); });
  $('toggleSteam').addEventListener('change', (e) => { toggles.steam = e.target.checked; requestRender(); });
  $('toggleBoil').addEventListener('change', (e) => { toggles.boilLine = e.target.checked; drawChart(); requestRender(); });
  $('toggleMicro').addEventListener('change', (e) => {
    toggles.micro = e.target.checked;
    const box = document.querySelector('.micro-inset');
    if (box) box.style.display = toggles.micro ? '' : 'none';
    requestRender();
  });

  /* ==========================================================================
     十一、步骤与记录
     ========================================================================== */
  const STEPS = [
    { name: '01 认识器材', text: '<strong>认识器材：</strong>铁架台的铸铁底座上立着镀铬立柱，铁圈托住<b>石棉网</b>，<b>烧杯</b>放在石棉网上，杯口盖一块<b>硬纸板</b>、中间开孔让<b>温度计</b>穿过去，感温泡浸在水里但<b>不碰杯底</b>。杯下是点燃的酒精灯。' },
    { name: '02 加热升温', text: '<strong>开始加热：</strong>点“开始加热”，看着温度计的液柱一路上升，同时记下几个时刻的水温。这一步先不着急下结论，只把“升温”这段曲线画出来。' },
    { name: '03 观察气泡', text: '<strong>水开之前先看气泡：</strong>杯底冒出小气泡，可它<b>越往上升越小</b>，还没到水面就没了。原因是上层水温还低于沸点，泡里的水蒸气遇冷又液化成水。' },
    { name: '04 水沸腾了', text: '<strong>到沸点：</strong>温度升到 <b>100 ℃</b>（标准大气压）就不再上升了，但酒精灯还在烧。这时气泡<b>越往上升越大</b>，到水面破裂，放出大量水蒸气。水面上方的“白气”是水蒸气遇冷液化成的<b>小水珠</b>，不是水蒸气本身。' },
    { name: '05 撤去酒精灯', text: '<strong>撤去酒精灯：</strong>点右侧的“撤去酒精灯”。水明明还是 100 ℃，却<b>立刻停止沸腾</b> —— 说明沸腾必须同时满足两个条件：<b>温度达到沸点</b>、<b>继续吸热</b>，缺一不可。' }
  ];
  const stepButtons = Array.from(document.querySelectorAll('[data-step]'));
  const stepDetail = $('stepDetail');
  function showStep(i) {
    state.step = i;
    stepButtons.forEach((b, k) => b.classList.toggle('active', k === i));
    stepDetail.innerHTML = STEPS[i].text;
  }
  stepButtons.forEach((b, i) => b.addEventListener('click', () => showStep(i)));
  showStep(0);

  const recordBtn = $('recordBtn'), recordBody = $('records'), recordBodySide = $('recordsSide'),
        summary = $('summary'), recSum = $('recSum'), recordHint = $('recordHint');

  const EMPTY_MAIN = '<tr><td colspan="6" class="empty">尚无记录，先点“开始加热”再记录</td></tr>';
  const EMPTY_SIDE = '<tr><td colspan="4" class="empty">还没有记录</td></tr>';
  const HINT_READY = '加热时随时点一下，当前时刻和水温就记进下面的表格（点「重置」会清空）。';
  const HINT_DONE = '已记录。换气压环境重新加热时旧记录会保留，正好用来对照；点「重置」则把表格一起清空。';

  /* 清空记录（「重置」按钮和调试钩子共用同一个入口） */
  function clearRecords() {
    state.records.length = 0;
    renderRecords();
    recordHint.textContent = HINT_READY;
  }

  function renderRecords() {
    if (!state.records.length) {
      recordBody.innerHTML = EMPTY_MAIN;
      recordBodySide.innerHTML = EMPTY_SIDE;
      summary.textContent = '建议记录：水沸腾前后各记几个时刻，尤其是“开始沸腾 / 沸腾中 / 沸腾一会儿之后”这三组，看温度是否相同。';
      recSum.textContent = '点上面的按钮开始记录。';
      return;
    }
    recordBody.innerHTML = state.records.map((r) => `
      <tr class="${r.boiling ? 'boil' : ''}">
        <td>${r.t.toFixed(0)} s</td><td>${r.T.toFixed(1)} ℃</td><td>${r.Tb.toFixed(1)} ℃</td>
        <td>${r.state}</td><td>${r.boiling ? '是' : '否'}</td><td>${(r.mass * 1000).toFixed(0)} g</td>
      </tr>`).join('');
    recordBodySide.innerHTML = state.records.map((r, i) => `
      <tr class="${r.boiling ? 'boil' : ''}">
        <td>${i + 1}</td><td>${r.t.toFixed(0)} s</td>
        <td>${r.T.toFixed(1)} ℃</td><td>${r.short}</td>
      </tr>`).join('');

    const bo = state.records.filter((r) => r.boiling);
    let text;
    if (bo.length >= 2) {
      const ts = bo.map((r) => r.T);
      const spread = Math.max(...ts) - Math.min(...ts);
      text = `沸腾过程的 ${bo.length} 次记录中，水温最大只差 ${spread.toFixed(1)} ℃ —— 水沸腾时温度确实不变。`;
    } else if (state.records.length >= 2) {
      text = `已记录 ${state.records.length} 组，但还没有一组是在沸腾时记的。等水真的沸腾了（气泡一路上升变大、到水面破裂）再记，才看得出温度变不变。`;
    } else {
      text = `已记录 ${state.records.length} 组。再补几组不同阶段的记录，才能比较温度是否改变。`;
    }
    summary.textContent = text;
    recSum.textContent = text;
  }
  recordBtn.addEventListener('click', () => {
    state.records.push({
      t: state.t, T: state.T, Tb: state.Tb,
      boiling: isBoiling(), boil: boilness(),
      lampOn: state.lampOn, mass: state.mass,
      state: statusText(), short: shortState()
    });
    if (state.records.length > 24) state.records.shift();
    renderRecords();
    const wrap = recordBodySide.closest('.rec-wrap');
    if (wrap) wrap.scrollTop = wrap.scrollHeight;
    recordBtn.classList.remove('hit');
    void recordBtn.offsetWidth;                    // 强制重排，动画才能连点连放
    recordBtn.classList.add('hit');
    recordHint.textContent = HINT_DONE;
    requestRender();
  });
  renderRecords();

  /* ==========================================================================
     十二、启动
     ========================================================================== */
  canvas.style.cursor = 'grab';
  setPressure(state.pressure);
  resetSim();
  updateWater();
  updateReadouts();
  drawChart();
  drawMicro(0.016);
  updateCamera();
  resize();

  /* 单帧推进。真实 rAF 循环与验收用的驱动钩子走【同一段】代码 ——
     无头沙箱里 requestAnimationFrame 一次都不触发（实测 0 帧/秒），
     若验收自己另抄一遍推进逻辑，改坏这里照样全绿。 */
  let uiAcc = 0;
  function frameStep(dt) {
    animateParts(dt);

    if (state.running && !state.finished) {
      stepSim(dt);
      sampleAcc += dt * state.speed;
      if (sampleAcc >= 0.6) { sampleAcc = 0; pushSample(); }
      updateWater();
      if (state.finished) { setRunning(false); pushSample(); }
    }

    uiAcc += dt;
    if (uiAcc >= 0.1) {
      uiAcc = 0;
      drawChart();
      drawMicro(Math.max(dt, 0.016));
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

  const ro = new ResizeObserver(() => { resize(); drawChart(); drawMicro(0.016); });
  ro.observe(stage);
  window.addEventListener('resize', () => { resize(); drawChart(); drawMicro(0.016); });

  /* --- 供无头验收脚本读取 --- */
  window.__boilLab = {
    state, view, VIEWS, PRESSURES, toggles, series,
    camera, renderer, scene,
    thermometer, thSupport, lamp, flameGroup, thScale, mercury,
    bubbles, steams, waterTop, flameLayers,
    thermometerX: TH_X, thBulbY: TH_BULB_Y, thLiftMax: TH_LIFT, thTubeH: TH_TUBE_H,
    stemY0: STEM_Y0, stemY1: STEM_Y1, updateCamera,
    scaleU0, scaleU1, scaleYOf, scaleCanvasY, scaleTexH: SCALE_TEX_H, scaleFaceDeg: SCALE_FACE_DEG,
    rodTop: BASE_H + ROD_H, clampY: CLAMP_Y, sleeveHalf: 1.15,
    lidY: LID_Y, bkY0: BK_Y0, bkR: BK_R, waterH: WATER_H, bulbR: TH_BULB_R,
    mats: { glassMat, waterMat, thGlassMat, thRedMat, cardMat },
    setRunning, resetSim, refreshAll, setLamp, applyPressureUI,
    step(dt) { stepSim(dt); updateWater(); pushSample(); updateReadouts(); drawChart(); drawMicro(dt); requestRender(); },
    advance(seconds) {                       // 直接推进仿真，不依赖真实时间
      let left = seconds;
      while (left > 0 && !state.finished) {
        const d = Math.min(0.2, left);
        stepSim(d); left -= d;
      }
      updateWater(); pushSample(); updateReadouts(); drawChart(); drawMicro(0.016);
      return { t: state.t, T: state.T, Tb: state.Tb, mass: state.mass, boiling: isBoiling(), boil: boilness() };
    },
    /* 无头环境没有 rAF：按固定步长喂帧，走的是与真实循环同一个 frameStep。
       指数平滑（温度计升降、酒精灯移动、火焰淡出）与气泡/白气的逐帧运动靠它才能推进。 */
    driveAnim(seconds, dt = 1 / 60) {
      const n = Math.max(1, Math.round(seconds / dt));
      for (let i = 0; i < n; i++) frameStep(dt);
      renderer.render(scene, camera);
      return {
        frames: n,
        thDepth: state.thDepth, thAnim: state.thAnim, thLift: thermometer.position.y,
        lampAnim: state.lampAnim, flameAnim: state.flameAnim,
        lampX: lamp.position.x, flameVisible: flameGroup.visible
      };
    },
    statusText, shortState, renderRecords, clearRecords, microStats,
    boilness, boilnessVis, isBoiling, bubbleScale, waterDepth, boilingPoint,
    setPressure(key) { setPressure(key); applyPressureUI(); refreshAll(); },
    /* 温度计当前实际抬升量（世界单位 cm），走的是渲染用的同一份位置 */
    thLift() { return thermometer.position.y; },
    /* 感温泡在 GL 缓冲区里的落点，供像素探针采样（GL 原点在左下，与 NDC 同向） */
    bulbRect() {
      const v = new THREE.Vector3(TH_X, TH_BULB_Y + thermometer.position.y, TH_Z);
      v.project(camera);
      const gl = renderer.getContext();
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
      return { x: (v.x * 0.5 + 0.5) * W, y: (v.y * 0.5 + 0.5) * H, W, H };
    },
    /* 某个气泡在 GL 缓冲区里的落点（用来断言「气泡真的画出来了」） */
    bubbleRect(i) {
      const m = bubbles[i % bubbles.length];
      const v = m.position.clone();
      v.project(camera);
      const gl = renderer.getContext();
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
      return { x: (v.x * 0.5 + 0.5) * W, y: (v.y * 0.5 + 0.5) * H, W, H, visible: m.visible, r: m.scale.x };
    },
    setThDepth(v) {
      state.thDepth = v;
      document.querySelectorAll('[data-thdepth]').forEach((b) => b.classList.toggle('active', Number(b.dataset.thdepth) === v));
      requestRender();
    }
  };
})();