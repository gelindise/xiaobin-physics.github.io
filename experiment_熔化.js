import * as THREE from './assets/optics-three.min.js';

/* ============================================================================
   探究固体熔化时温度的变化规律 —— 三维写实水浴加热实验台
   ---------------------------------------------------------------------------
   世界坐标单位：厘米（cm），y 轴向上，实验台台面为 y = 0。
   器材：铁架台（铸铁底座 + 镀铬立柱 + 铁圈 / 试管夹）、酒精灯、石棉网、
         硼硅玻璃烧杯 + 水、试管 + 试样（海波 / 石蜡）、温度计。
   物理：酒精灯 → 水浴 → 试管的两节点热平衡；晶体用“显热 + 熔化潜热”分段积分，
         非晶体用随温度变化的等效比热容（软化区急升），温度曲线由方程实时算出。
   ========================================================================== */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  /* ------------------------------ 器材尺寸 ------------------------------ */
  const BASE_W = 26, BASE_D = 17, BASE_H = 1.8;      // 铸铁底座
  const ROD_R = 0.55, ROD_H = 43, ROD_Z = -5.6;      // 镀铬立柱（够高，容温度计悬挂支架上下滑动）
  const RING_Y = 17.5;                               // 铁圈高度
  const CLAMP_Y = 30.5;                              // 试管夹高度

  const LAMP_R = 3.5, LAMP_H = 6.9;                  // 酒精灯玻璃灯体（颈口高度）
  const LAMP_SHOULDER_H = 0, LAMP_COLLAR_H = 1.4, WICK_H = 1.7;
  const FLAME_H = 5.4;
  const LAMP_TOP = BASE_H + LAMP_H + LAMP_SHOULDER_H + LAMP_COLLAR_H + WICK_H;  // 11.8
  const FLAME_TOP = LAMP_TOP + FLAME_H;                                          // 17.2

  const NET_W = 15, NET_T = 0.22;                    // 石棉网
  const BK_R = 4.3, BK_H = 10.2;                     // 烧杯
  const BK_Y0 = RING_Y + NET_T + 0.06;               // 17.78
  const WATER_H = 6.8;                               // 水量
  const WATER_TOP = BK_Y0 + WATER_H;

  const TT_R = 1.5, TT_H = 15;                       // 试管
  const TT_Y0 = BK_Y0 + 1.35;
  const SAMPLE_H = 6.0;                              // 试样高度
  const SAMPLE_R = TT_R - 0.13;

  const TH_BULB_Y = TT_Y0 + 4.0;                     // 温度计感温泡（插到底时的绝对高度）
  const TH_BULB_R = 0.42;                            // 感温泡半径（要看得见，比原来大一圈）
  // 管长只留「露出烧杯口 + 够印 0~100 刻度」的最小值：整机越矮，取景就能压得越紧，
  // 器材在画面里才够大。14 cm 的管子会把立柱顶到 53 cm，白占半屏。
  const TH_TUBE_H = 11.5;                            // 温度计管长
  const TH_TOP = TH_BULB_Y + TH_TUBE_H - 0.6 + 0.24; // 顶端球帽中心（34.57）
  const TH_LIFT = 5;                                 // 「提起」时整体抬升量（感温泡提出试样）
  const THREAD_LEN = 2.6;                            // 悬挂细线长度（横臂高度 = TH_TOP + 它）

  const MAX_WEIGHTS_UNUSED = 0;                      // （占位，保持常量区整齐）

  /* ------------------------------ 物理参数 ------------------------------ */
  const AMB = 20;                                    // 室温 ℃
  const M_WATER = 0.25;                              // 水浴质量 kg
  const C_WATER = 4200;                              // 水的比热容
  const P_LAMP = 300;                                // 酒精灯有效功率 W
  const K_LOSS = 2.0;                                // 水浴向环境散热 W/K
  const K_COUPLE = 2.2;                              // 水浴→试管 的传热系数 W/K
  const TW_MAX = 100;                                // 标准大气压下水浴上限
  const M_SAMPLE = 0.02;                             // 试样 20 g

  const SUBSTANCES = {
    hypo: {
      name: '海波', crystal: true, tm: 48,
      cs: 1700, cl: 2400, L: 2.0e5,
      note: '晶体 · 有固定熔点 48 ℃'
    },
    paraffin: {
      name: '石蜡', crystal: false, tm: null,
      cBase: 2200, cPeak: 22000, tSoft: 55, softW: 4.5,
      note: '非晶体 · 没有固定熔点'
    }
  };

  /* ------------------------------ 状态 ------------------------------ */
  const state = {
    substance: 'hypo',
    running: false,
    speed: 4,
    t: 0, Tt: AMB, Tw: AMB, phi: 0, soft: 0,
    finished: false,
    step: 0,
    records: [],
    thDepth: 1,          // 温度计插入程度：0 = 提起（感温泡离开试样），1 = 插到底
    thAnim: 1,           // 动画用的平滑值（默认就是装好的状态，点「提起」才看得到动作）
    xray: true           // 透视：试样半透明，能看见里面的玻璃泡
  };
  const toggles = { bath: true, melt: true, micro: true };

  const VIEWS = {
    front: { yaw: -0.08, pitch: 0.10, dist: 85, ty: 22.5 },
    angle: { yaw: -0.55, pitch: 0.16, dist: 87, ty: 22.5 },
    top:   { yaw: -0.50, pitch: 0.86, dist: 82, ty: 20 },
    close: { yaw: -0.42, pitch: 0.06, dist: 30, ty: 22.5 }
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

  /* 海波晶体：白色半透明结晶颗粒 */
  function makeHypoMap() {
    const S = 512, rnd = mulberry32(2468);
    const c = newCanvas(S, S), g = c.getContext('2d');
    const b = newCanvas(S, S), gb = b.getContext('2d');
    g.fillStyle = '#e9eef2'; g.fillRect(0, 0, S, S);
    gb.fillStyle = '#8a8a8a'; gb.fillRect(0, 0, S, S);

    const step = 3.6;
    for (let gy = -step; gy < S + step; gy += step) {
      for (let gx = -step; gx < S + step; gx += step) {
        const x = gx + (rnd() - 0.5) * step * 1.1;
        const y = gy + (rnd() - 0.5) * step * 1.1;
        const r = 1.5 + rnd() * 2.0;
        const asp = 0.68 + rnd() * 0.6;
        const rot = rnd() * Math.PI;
        const l = 82 + rnd() * 15;
        const s = 6 + rnd() * 12;
        g.fillStyle = `hsl(${200 + rnd() * 20},${s}%,${l}%)`;
        g.beginPath(); g.ellipse(x, y, r, r * asp, rot, 0, 7); g.fill();

        // 晶体棱面的亮边（半透明结晶的关键）
        g.strokeStyle = `hsla(0,0%,100%,${0.35 + rnd() * 0.45})`;
        g.lineWidth = 0.5 + rnd() * 0.7;
        g.beginPath();
        g.ellipse(x - r * 0.16, y - r * asp * 0.16, r * 0.72, r * asp * 0.72, rot, Math.PI * 0.9, Math.PI * 1.9);
        g.stroke();

        const v = Math.round(clamp(120 + (l - 88) * 8, 60, 250));
        gb.fillStyle = `rgb(${v},${v},${v})`;
        gb.beginPath(); gb.ellipse(x, y, r * 0.94, r * asp * 0.94, rot, 0, 7); gb.fill();
      }
    }
    for (let i = 0; i < 500; i++) {
      const x = rnd() * S, y = rnd() * S, r = 2.4 + rnd() * 4.6;
      g.fillStyle = `hsla(${195 + rnd() * 25},${8 + rnd() * 18}%,${88 + rnd() * 10}%,0.5)`;
      g.beginPath(); g.ellipse(x, y, r, r * (0.6 + rnd() * 0.5), rnd() * 3, 0, 7); g.fill();
    }
    const map = new THREE.CanvasTexture(c);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    const bump = new THREE.CanvasTexture(b);
    bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
    DEBUG_TEX.hypo = c;
    return { map, bump };
  }

  /* 石蜡：乳白蜡质，表面有细微收缩纹 */
  function makeParaffinMap() {
    const S = 512, rnd = mulberry32(777);
    const c = newCanvas(S, S), g = c.getContext('2d');
    const b = newCanvas(S, S), gb = b.getContext('2d');
    g.fillStyle = '#f7f2e6'; g.fillRect(0, 0, S, S);
    gb.fillStyle = '#a0a0a0'; gb.fillRect(0, 0, S, S);

    for (let i = 0; i < 160; i++) {
      const x = rnd() * S, y = rnd() * S, r = 20 + rnd() * 90;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, `hsla(${40 + rnd() * 16},${24 + rnd() * 22}%,${88 + rnd() * 8}%,0.30)`);
      grd.addColorStop(1, 'hsla(0,0%,0%,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    // 蜡的收缩裂纹
    for (let i = 0; i < 130; i++) {
      const x0 = rnd() * S, y0 = rnd() * S;
      let x = x0, y = y0;
      g.strokeStyle = `hsla(${36 + rnd() * 14},${20 + rnd() * 20}%,${74 + rnd() * 14}%,${0.16 + rnd() * 0.26})`;
      g.lineWidth = 0.5 + rnd() * 1.5;
      g.beginPath(); g.moveTo(x, y);
      const dir = rnd() * 6.28;
      for (let k = 0; k < 9; k++) {
        x += Math.cos(dir + (rnd() - 0.5) * 0.9) * (3 + rnd() * 8);
        y += Math.sin(dir + (rnd() - 0.5) * 0.9) * (3 + rnd() * 8);
        g.lineTo(x, y);
      }
      g.stroke();
    }
    for (let i = 0; i < 3000; i++) {
      const x = rnd() * S, y = rnd() * S, r = 0.6 + rnd() * 1.6;
      g.fillStyle = `hsla(${40 + rnd() * 12},${18 + rnd() * 20}%,${rnd() < 0.5 ? 80 + rnd() * 12 : 94 + rnd() * 6}%,0.4)`;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
      const v = Math.round(clamp(128 + (rnd() - 0.5) * 60, 60, 220));
      gb.fillStyle = `rgb(${v},${v},${v})`;
      gb.beginPath(); gb.arc(x, y, r * 0.9, 0, 7); gb.fill();
    }
    const map = new THREE.CanvasTexture(c);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    const bump = new THREE.CanvasTexture(b);
    bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
    DEBUG_TEX.paraffin = c;
    return { map, bump };
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

  makeBoss(CLAMP_Y, 3.4);
  const clampArm = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 4.4), darkSteel);
  clampArm.position.set(0, CLAMP_Y, -2.6);
  clampArm.castShadow = true;
  stand.add(clampArm);
  for (const s of [-1, 1]) {
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.36, 0.5), darkSteel);
    jaw.position.set(s * 1.55, CLAMP_Y, 0.55);
    jaw.rotation.z = s * 0.16;
    jaw.castShadow = true;
    stand.add(jaw);
  }
  const clampPad = new THREE.Mesh(new THREE.TorusGeometry(1.62, 0.16, 8, 24, Math.PI), darkSteel);
  clampPad.rotation.y = Math.PI / 2;
  clampPad.rotation.z = Math.PI;
  clampPad.position.set(0, CLAMP_Y, 0.55);
  clampPad.castShadow = true;
  stand.add(clampPad);

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
  scene.add(flameGroup);

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
  scene.add(flameLight);

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
    const labels = ['50', '100', '150', '200'];
    for (let i = 0; i < labels.length; i++) {
      const y = H - (0.14 + i * 0.225) * H;
      g.lineWidth = 5;
      g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
      g.fillText(labels[i], x1 + 9, y);
      // 中间的小格刻度
      for (let k = 1; k < 5; k++) {
        const yy = y + (k / 5) * (0.225 * H);
        if (yy > H - 8) break;
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

  /* --- 试管 --- */
  const tube = new THREE.Group();
  scene.add(tube);
  const tubeWall = new THREE.Mesh(new THREE.CylinderGeometry(TT_R, TT_R, TT_H, 36, 1, true), glassMat);
  tubeWall.position.set(0, TT_Y0 + TT_H / 2, 0);
  tube.add(tubeWall);
  // 加厚球底（内外两层，看起来才有玻璃厚度）
  const tubeBottom = new THREE.Mesh(new THREE.SphereGeometry(TT_R, 28, 14, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), glassMat);
  tubeBottom.position.set(0, TT_Y0, 0);
  tube.add(tubeBottom);
  const tubeBottomIn = new THREE.Mesh(new THREE.SphereGeometry(TT_R - 0.16, 26, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), glassMat);
  tubeBottomIn.position.set(0, TT_Y0 + 0.10, 0);
  tube.add(tubeBottomIn);
  // 卷口：一小段外翻的锥面 + 圆环，比单纯一个圆环更像真试管口
  const tubeFlare = new THREE.Mesh(new THREE.CylinderGeometry(TT_R * 1.16, TT_R, 0.42, 36, 1, true), glassMat);
  tubeFlare.position.set(0, TT_Y0 + TT_H + 0.16, 0);
  tube.add(tubeFlare);
  const tubeRim = new THREE.Mesh(new THREE.TorusGeometry(TT_R * 1.16, 0.11, 10, 36), glassMat);
  tubeRim.rotation.x = Math.PI / 2;
  tubeRim.position.set(0, TT_Y0 + TT_H + 0.36, 0);
  tube.add(tubeRim);

  /* --- 试样（固体段 + 液体段 + 糊状过渡带） --- */
  const unitCyl = new THREE.CylinderGeometry(SAMPLE_R, SAMPLE_R, 1, 36, 1);
  const unitDisk = new THREE.CircleGeometry(SAMPLE_R, 36);

  const hypo = makeHypoMap();
  hypo.map.anisotropy = MAX_ANISO;
  const solidTex = hypo.map.clone();
  solidTex.needsUpdate = true;
  const solidBump = hypo.bump.clone();
  solidBump.needsUpdate = true;

  // 固相偏暖哑光、液相偏冷高光：熔化界面靠「色调 + 光泽」两级差读出来，不靠几何缝隙
  const solidMat = new THREE.MeshStandardMaterial({
    map: solidTex, bumpMap: solidBump, bumpScale: 0.05, color: '#f7ead0', roughness: 0.62, metalness: 0.02
  });
  const liquidMat = new THREE.MeshPhysicalMaterial({
    color: '#d5ebef', transparent: true, opacity: 0.78, roughness: 0.05, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.9, depthWrite: false
  });
  const mushMat = new THREE.MeshStandardMaterial({ color: '#f0e2c8', roughness: 0.9, metalness: 0 });

  const solidMesh = new THREE.Mesh(unitCyl, solidMat);
  const liquidMesh = new THREE.Mesh(unitCyl, liquidMat);
  const liquidTopMesh = new THREE.Mesh(unitDisk, liquidMat);
  liquidTopMesh.rotation.x = -Math.PI / 2;
  const mushMesh = new THREE.Mesh(unitCyl, mushMat);
  for (const m of [solidMesh, liquidMesh, liquidTopMesh, mushMesh]) {
    m.castShadow = false; m.receiveShadow = false;
    tube.add(m);
  }

  const paraffin = makeParaffinMap();
  paraffin.map.anisotropy = MAX_ANISO;
  const waxTex = paraffin.map.clone();
  waxTex.needsUpdate = true;
  const waxBump = paraffin.bump.clone();
  waxBump.needsUpdate = true;
  const waxMat = new THREE.MeshStandardMaterial({
    map: waxTex, bumpMap: waxBump, bumpScale: 0.04, color: '#ffffff', roughness: 0.48, metalness: 0,
    transparent: true, opacity: 1.0
  });
  const waxMesh = new THREE.Mesh(unitCyl, waxMat);
  waxMesh.castShadow = false;
  tube.add(waxMesh);
  const waxTop = new THREE.Mesh(unitDisk, waxMat);
  waxTop.rotation.x = -Math.PI / 2;
  tube.add(waxTop);

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

  // 温度计刻度：印刷在管壁上（透明底 + 白色刻度与数字）
  function makeThermoScale() {
    const W = 160, H = 1024;
    const c = newCanvas(W, H), g = c.getContext('2d');
    g.clearRect(0, 0, W, H);
    const u0 = 8, u1 = 62;                 // 刻度只占管壁一小条
    g.strokeStyle = 'rgba(38,50,60,0.92)';
    g.fillStyle = 'rgba(30,42,52,0.95)';
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(u1, 6); g.lineTo(u1, H - 6); g.stroke();
    g.font = 'bold 26px "Helvetica Neue", Arial, sans-serif';
    g.textAlign = 'left'; g.textBaseline = 'middle';
    for (let T = 0; T <= 100; T += 2) {
      const y = H - 6 - (T / 100) * (H - 12);
      const major = T % 10 === 0;
      const len = major ? (u1 - u0) : (u1 - u0) * 0.45;
      g.lineWidth = major ? 3 : 2;
      g.beginPath(); g.moveTo(u1 - len, y); g.lineTo(u1, y); g.stroke();
      if (major) g.fillText(String(T), u1 + 7, y);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  const STEM_Y0 = TH_BULB_Y + 0.55;                  // 刻度 0 ℃ 的位置
  const STEM_Y1 = TH_BULB_Y + TH_TUBE_H - 0.6;       // 刻度 100 ℃ 的位置

  const thermometer = new THREE.Group();
  thermometer.position.set(0.52, 0, 0.28);
  scene.add(thermometer);

  const thGlass = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, TH_TUBE_H, 20, 1, true), thGlassMat);
  thGlass.position.set(0, TH_BULB_Y + TH_TUBE_H / 2 - 0.6, 0);
  thermometer.add(thGlass);
  const thScale = new THREE.Mesh(
    new THREE.CylinderGeometry(0.248, 0.248, TH_TUBE_H - 1.2, 20, 1, true),
    new THREE.MeshBasicMaterial({ map: makeThermoScale(), transparent: true, depthWrite: false, side: THREE.FrontSide })
  );
  thScale.position.set(0, TH_BULB_Y + TH_TUBE_H / 2 - 0.6, 0);
  thermometer.add(thScale);
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

  /* --- 温度计悬挂支架：铁架台上的横臂 + 眼环 + 细线 --- */
  // 横臂随温度计一起上下滑（真实铁架台就是松开螺丝滑 boss 头），细线长度恒定
  const TH_X = 0.52, TH_Z = 0.28;
  const ARM_Y = TH_TOP + THREAD_LEN;
  const thSupport = new THREE.Group();
  scene.add(thSupport);

  const armLen = TH_Z - ROD_Z;                        // 从立柱伸到温度计正上方
  const armBar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.62, armLen), darkSteel);
  armBar.position.set(TH_X / 2, ARM_Y + 0.5, ROD_Z + armLen / 2);
  armBar.castShadow = true;
  thSupport.add(armBar);
  const armSleeve = new THREE.Mesh(new THREE.CylinderGeometry(ROD_R + 0.46, ROD_R + 0.46, 2.2, 20), darkSteel);
  armSleeve.position.set(0, ARM_Y + 0.5, ROD_Z);
  armSleeve.castShadow = true;
  thSupport.add(armSleeve);
  const armScrew = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.4, 12), knobMat);
  armScrew.rotation.z = Math.PI / 2;
  armScrew.position.set(ROD_R + 1.0, ARM_Y + 0.5, ROD_Z);
  armScrew.castShadow = true;
  thSupport.add(armScrew);
  const eyelet = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.055, 8, 20), darkSteel);
  eyelet.rotation.x = Math.PI / 2;
  eyelet.position.set(TH_X, ARM_Y, TH_Z);
  thSupport.add(eyelet);
  const threadMat = new THREE.MeshStandardMaterial({ color: '#e8e2d4', roughness: 0.92, metalness: 0 });
  const thread = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, THREAD_LEN, 8), threadMat);
  thread.position.set(TH_X, ARM_Y - THREAD_LEN / 2, TH_Z);
  thSupport.add(thread);

  /* --- 玻璃搅拌棒 --- */
  const stir = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 18, 14), glassMat);
  stir.position.set(-0.62, TT_Y0 + 5.6, -0.2);
  stir.rotation.z = 0.045;
  scene.add(stir);

  /* --- 气泡与蒸汽 --- */
  const bubbleMat = new THREE.MeshPhysicalMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, roughness: 0.05, metalness: 0, envMapIntensity: 1.4, depthWrite: false });
  const bubbles = [];
  const rndB = mulberry32(31337);
  for (let i = 0; i < 18; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), bubbleMat);
    m.scale.setScalar(0.1 + rndB() * 0.12);
    m.userData = {
      a: rndB() * Math.PI * 2,
      rad: 0.6 + rndB() * 3.1,
      y: BK_Y0 + rndB() * WATER_H,
      spd: 0.5 + rndB() * 0.9,
      ph: rndB() * 6.28
    };
    m.visible = false;
    scene.add(m);
    bubbles.push(m);
  }
  const steamMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.0, depthWrite: false, fog: false });
  const steams = [];
  for (let i = 0; i < 7; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), steamMat.clone());
    m.userData = { ph: rndB() * 6.28, a: rndB() * 6.28, rad: 0.8 + rndB() * 2.4, spd: 0.55 + rndB() * 0.6 };
    m.visible = false;
    scene.add(m);
    steams.push(m);
  }

  /* ==========================================================================
     四、物理积分
     ========================================================================== */
  const sub = SUBSTANCES;

  function cEffParaffin(T) {
    const s = sub.paraffin;
    return s.cBase + s.cPeak * Math.exp(-Math.pow((T - s.tSoft) / s.softW, 2));
  }

  function integrate(dt) {
    const q = K_COUPLE * (state.Tw - state.Tt);
    if (state.substance === 'hypo') {
      const s = sub.hypo;
      if (state.phi > 0 && state.phi < 1) {
        state.phi = Math.min(1, state.phi + q / (M_SAMPLE * s.L) * dt);
        state.Tt = s.tm;
      } else if (state.phi >= 1) {
        state.Tt += q / (M_SAMPLE * s.cl) * dt;
      } else {
        state.Tt += q / (M_SAMPLE * s.cs) * dt;
        if (state.Tt >= s.tm) { state.Tt = s.tm; state.phi = 1e-6; }
      }
    } else {
      state.Tt += q / (M_SAMPLE * cEffParaffin(state.Tt)) * dt;
      state.soft = clamp((state.Tt - 44) / 16, 0, 1);
    }
    if (state.Tw < TW_MAX) {
      state.Tw += (P_LAMP - q - K_LOSS * (state.Tw - AMB)) / (M_WATER * C_WATER) * dt;
      if (state.Tw > TW_MAX) state.Tw = TW_MAX;
    }
    state.t += dt;
    if (state.Tt >= 96) state.finished = true;
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

  function resetSim() {
    state.t = 0; state.Tt = AMB; state.Tw = AMB;
    state.phi = 0; state.soft = 0; state.finished = false;
    series.length = 0;
    pushSample();
  }

  /* ==========================================================================
     五、随状态更新器材
     ========================================================================== */
  function meltFraction() {
    return state.substance === 'hypo' ? state.phi : state.soft;
  }

  function applySubstanceVisual() {
    const isHypo = state.substance === 'hypo';
    solidMesh.visible = isHypo;
    liquidMesh.visible = isHypo;
    liquidTopMesh.visible = isHypo;
    mushMesh.visible = isHypo;
    waxMesh.visible = !isHypo;
    waxTop.visible = !isHypo;
  }

  function updateSample() {
    const isHypo = state.substance === 'hypo';
    if (isHypo) {
      const solidH = SAMPLE_H * Math.pow(1 - state.phi, 0.82);
      const liquidH = Math.max(0, SAMPLE_H - solidH);
      const showSolid = solidH > 0.02;

      solidMesh.visible = showSolid;
      if (showSolid) {
        solidMesh.scale.set(1, solidH, 1);
        solidMesh.position.set(0, TT_Y0 + 0.12 + solidH / 2, 0);
        solidTex.repeat.set(2.2, Math.max(0.05, solidH * 1.55));
        solidBump.repeat.copy(solidTex.repeat);
      }
      mushMesh.visible = showSolid && state.phi > 0.01 && state.phi < 0.99;
      if (mushMesh.visible) {
        const mh = 0.34;
        mushMesh.scale.set(1, mh, 1);
        mushMesh.position.set(0, TT_Y0 + 0.12 + solidH + mh / 2, 0);
      }
      const liqBottom = TT_Y0 + 0.12 + solidH + (mushMesh.visible ? 0.34 : 0);
      liquidMesh.visible = liquidH > 0.06;
      if (liquidMesh.visible) {
        const lh = Math.max(0.06, TT_Y0 + 0.12 + SAMPLE_H - liqBottom);
        liquidMesh.scale.set(1, lh, 1);
        liquidMesh.position.set(0, liqBottom + lh / 2, 0);
        liquidTopMesh.position.set(0, liqBottom + lh + 0.005, 0);
      }
    } else {
      // 石蜡：先变软、再变稀；体积基本不变，顶部略有塌陷
      const s = state.soft;
      const h = SAMPLE_H * (1 - 0.10 * s);
      waxMesh.scale.set(1, h, 1);
      waxMesh.position.set(0, TT_Y0 + 0.12 + h / 2, 0);
      waxTex.repeat.set(1.9, Math.max(0.05, h * 1.25));
      waxBump.repeat.copy(waxTex.repeat);
      waxTop.position.set(0, TT_Y0 + 0.12 + h + 0.005, 0);

      // 透明度交给 applyXray() 统一处理（要兼顾「软化变透明」和「透视」两件事）
      waxMat.roughness = 0.48 - 0.36 * s;
      waxMat.bumpScale = 0.04 * (1 - 0.8 * s);
      waxMat.color.setRGB(0.97, 0.92 - 0.02 * s, 0.82 - 0.05 * s);
    }

    // 温度计液柱：顶端按刻度线性映射（0 ℃ → STEM_Y0，100 ℃ → STEM_Y1），与印刷刻度一致
    const stemLen = STEM_Y1 - STEM_Y0;
    const colTop = STEM_Y0 + clamp(state.Tt / 100, 0, 1) * stemLen;
    const colH = Math.max(0.4, colTop - TH_BULB_Y);
    mercury.scale.set(1, colH, 1);
    mercury.position.set(0, TH_BULB_Y + colH / 2, 0);

    // 透视：试样半透明，能看见插在里面的红色玻璃泡（海波晶体本来就是半透明的）
    applyXray();
  }

  /* 透视开关：试样（固 / 糊 / 蜡）变半透明，好让插在里面的感温泡看得见。
     关键：半透明时必须 depthWrite=false，否则后面那个不透明的红色玻璃泡
     会被试样写下的深度值剔除掉 —— 看上去就是「泡不见了」。
     不透明度取「能看清泡」和「试样本身还像个实物」的折中：0.34 太透，试样会化掉；
     0.62 以上玻璃泡就被吃掉了。实测 0.48 附近两边都成立。 */
  function applyXray() {
    const on = state.xray;
    const setMat = (mat, onOp, offOp) => {
      const op = on ? onOp : offOp;
      const tr = op < 0.999;
      if (mat.opacity !== op) mat.opacity = op;
      if (mat.transparent !== tr) { mat.transparent = tr; mat.needsUpdate = true; }
      if (mat.depthWrite === tr) mat.depthWrite = !tr;
    };
    setMat(solidMat, 0.48, 1.0);
    setMat(mushMat, 0.56, 1.0);
    // 液相要压得比固相还透：感温泡在熔化中后期泡在熔液里，液相若比固相实，
    // 泡反而在最需要看见的时候消失（实测 0.70 时红色信号只剩 1/6）。真实的熔融海波本来就是澄清液体。
    liquidMat.opacity = on ? 0.50 : 0.78;
    liquidMat.depthWrite = false;
    // 石蜡：既有「软化变透明」又有「透视」，两者相乘
    setMat(waxMat, 0.50 * (1 - 0.55 * smoothstep(0.05, 0.95, state.soft)), 1 - 0.62 * smoothstep(0.05, 0.95, state.soft));
  }

  /* ==========================================================================
     六、温度—时间图像
     ========================================================================== */
  const chartCanvas = $('chartCanvas');
  const series = [];
  let sampleAcc = 0;
  function pushSample() {
    series.push([state.t, state.Tt, state.Tw, meltFraction()]);
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
    const tMax = Math.max(300, Math.ceil((state.t + 20) / 60) * 60);
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
      g.fillText(`${T}`, padL - 5, y);
    }
    g.textAlign = 'center'; g.textBaseline = 'top';
    const tStep = tMax <= 300 ? 60 : tMax <= 600 ? 120 : 180;
    for (let t = 0; t <= tMax; t += tStep) {
      const x = X(t);
      g.beginPath(); g.moveTo(x, padT); g.lineTo(x, H - padB); g.stroke();
      g.fillText(`${t}`, x, H - padB + 6);
    }
    g.textAlign = 'left';
    g.fillStyle = 'rgba(160,190,215,0.9)';
    g.fillText('T/℃', padL - 32, padT - 12);
    g.textAlign = 'right';
    g.fillText('t/s', W - padR, padT - 12);
    g.textAlign = 'left';

    // 熔点参考线
    const s = sub[state.substance];
    if (toggles.melt && s.crystal) {
      const y = Y(s.tm);
      g.setLineDash([6, 4]);
      g.strokeStyle = 'rgba(250,204,21,0.9)';
      g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(padL, y); g.lineTo(W - padR, y); g.stroke();
      g.setLineDash([]);
      g.fillStyle = '#facc15';
      g.font = 'bold 11px "Helvetica Neue", Arial, sans-serif';
      g.textAlign = 'left'; g.textBaseline = 'bottom';
      g.fillText(`熔点 ${s.tm} ℃`, padL + 6, y - 3);
    }

    // 熔化区间着色
    if (series.length > 1) {
      let runStart = -1;
      const bands = [];
      for (let i = 0; i < series.length; i++) {
        const inMelt = series[i][3] > 0.001 && series[i][3] < 0.999;
        if (inMelt && runStart < 0) runStart = i;
        if ((!inMelt || i === series.length - 1) && runStart >= 0) {
          bands.push([series[runStart][0], series[i][0]]);
          runStart = -1;
        }
      }
      g.fillStyle = 'rgba(251,146,60,0.11)';
      for (const [a, b] of bands) g.fillRect(X(a), padT, Math.max(1, X(b) - X(a)), ph);
    }

    // 水浴曲线
    if (toggles.bath && series.length > 1) {
      g.setLineDash([5, 4]);
      g.strokeStyle = '#38bdf8';
      g.lineWidth = 1.7;
      g.beginPath();
      series.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[2])) : g.moveTo(X(p[0]), Y(p[2]))));
      g.stroke();
      g.setLineDash([]);
    }

    // 试样曲线
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
     ========================================================================== */
  const microCanvas = $('microCanvas');
  const microText = $('microText');
  const rndM = mulberry32(5150);
  const MP = [];
  (() => {
    const cols = 13, rows = 8;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        MP.push({
          hx: (c + 0.5 + (r % 2 ? 0.5 : 0)) / cols,
          hy: (r + 0.5) / rows,
          x: 0, y: 0, vx: (rndM() - 0.5), vy: (rndM() - 0.5),
          jp: rndM() * 6.28, row: r, col: c
        });
      }
    }
    MP.forEach((p) => { p.x = p.hx; p.y = p.hy; });
  })();

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

    const isHypo = state.substance === 'hypo';
    const frac = meltFraction();
    const energy = clamp((state.Tt - AMB) / 70, 0, 1);          // 平均动能 ∝ 温度
    const amp = 0.9 + energy * 4.2;
    const spd = 6 + energy * 42;

    g.save();
    g.beginPath(); g.rect(4, 4, W - 8, H - 8); g.clip();

    const px = (u) => 4 + u * (W - 8);
    const py = (v) => 4 + v * (H - 8);

    // 晶格连线（只连尚未脱离的分子）
    if (isHypo) {
      g.strokeStyle = 'rgba(56,189,248,0.42)';
      g.lineWidth = 1;
      const freeCount = Math.floor(MP.length * frac);
      for (let i = 0; i < MP.length; i++) {
        if (i < freeCount) continue;
        const p = MP[i];
        for (let j = i + 1; j < MP.length; j++) {
          if (j < freeCount) continue;
          const q = MP[j];
          if (Math.abs(p.row - q.row) + Math.abs(p.col - q.col) === 1) {
            g.beginPath(); g.moveTo(px(p.x), py(p.y)); g.lineTo(px(q.x), py(q.y)); g.stroke();
          }
        }
      }
    }

    const freeCount = Math.floor(MP.length * frac);
    for (let i = 0; i < MP.length; i++) {
      const p = MP[i];
      const free = i < freeCount;
      if (!free) {
        p.jp += dt * (2 + energy * 10);
        p.x = p.hx + Math.sin(p.jp) * amp * 0.0016;
        p.y = p.hy + Math.cos(p.jp * 1.3) * amp * 0.0016;
      } else {
        p.x += p.vx * spd * dt * 0.01;
        p.y += p.vy * spd * dt * 0.01;
        if (p.x < 0.03 || p.x > 0.97) { p.vx *= -1; p.x = clamp(p.x, 0.03, 0.97); }
        if (p.y < 0.06 || p.y > 0.94) { p.vy *= -1; p.y = clamp(p.y, 0.06, 0.94); }
      }
      const r = free ? 2.5 : 2.9;
      g.fillStyle = free ? `rgba(251,146,60,${0.55 + energy * 0.4})` : `rgba(125,211,252,${0.6 + energy * 0.35})`;
      g.beginPath(); g.arc(px(p.x), py(p.y), r, 0, 7); g.fill();
    }
    g.restore();

    g.font = '10px "Helvetica Neue", Arial, sans-serif';
    g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillStyle = 'rgba(150,180,205,0.8)';
    g.fillText(isHypo ? '蓝＝晶格内 · 橙＝已挣脱' : '石蜡分子本来就不规则排列', 8, 7);

    if (isHypo) {
      microText.textContent = frac <= 0.001
        ? '分子规则排列在晶格上，只在小范围振动'
        : frac >= 0.999
          ? '晶格全部瓦解，分子可以自由移动（液态）'
          : `晶格正在瓦解（${(frac * 100).toFixed(0)}%），但温度不变 → 分子平均动能不变`;
    } else {
      microText.textContent = frac <= 0.02
        ? '分子排列不规则，靠得很紧，只能在原位振动'
        : `分子逐渐松开（${(frac * 100).toFixed(0)}%），越软越容易移动，但始终没有晶格`;
    }
  }

  /* ==========================================================================
     八、界面刷新
     ========================================================================== */
  const els = {
    sample: $('metricSample'), bath: $('metricBath'), state: $('metricState'),
    time: $('metricTime'), melt: $('metricMelt'),
    hudSample: $('hudSample'), hudBath: $('hudBath'),
    finding: $('finding'),
    runBtn: $('runBtn'), pauseBtn: $('pauseBtn'), resetBtn: $('resetBtn')
  };

  function statusText() {
    const s = sub[state.substance];
    if (state.substance === 'hypo') {
      if (state.phi <= 0.001) return state.Tt < s.tm ? '固态 · 升温中' : '即将熔化';
      if (state.phi >= 0.999) return '液态 · 升温中';
      return '固液共存 · 正在熔化';
    }
    if (state.soft <= 0.02) return '固态 · 升温中';
    if (state.soft >= 0.985) return '已熔化成液态';
    return '逐渐变软 · 无固定熔点';
  }

  /* 右侧窄表格里的短状态，四个字以内才排得下一行 */
  function shortState() {
    const f = meltFraction();
    if (state.substance === 'hypo') {
      if (f <= 0.001) return '固态';
      if (f >= 0.999) return '液态';
      return '熔化中';
    }
    if (f <= 0.02) return '固态';
    if (f >= 0.985) return '液态';
    return '软化中';
  }

  function updateReadouts() {
    const s = sub[state.substance];
    const frac = meltFraction();
    els.sample.textContent = `${state.Tt.toFixed(1)} ℃`;
    els.bath.textContent = `${state.Tw.toFixed(1)} ℃`;
    els.state.textContent = statusText();
    els.time.textContent = `${state.t.toFixed(0)} s`;
    els.melt.textContent = `${(frac * 100).toFixed(0)}%`;
    els.hudSample.textContent = state.Tt.toFixed(1);
    els.hudBath.textContent = state.Tw.toFixed(1);

    let hint;
    if (state.substance === 'hypo') {
      if (state.phi <= 0.001) {
        hint = `加热中：海波是晶体，温度升到 ${s.tm} ℃ 之前一直是固态。留意水浴温度比试样高多少 —— 水浴法让它升得慢、受热匀。`;
      } else if (state.phi < 0.999) {
        hint = `熔化中：温度死死钉在 ${s.tm} ℃，而水浴已经升到 ${state.Tw.toFixed(1)} ℃。这段时间吸收的热量全部用来破坏晶格，温度不变 —— 这就是晶体有固定熔点的原因。`;
      } else {
        hint = `已全部熔化：变成液态后温度又开始上升。整个熔化过程中，温度${s.tm} ℃始终没变。`;
      }
    } else {
      if (state.soft <= 0.02) {
        hint = '加热中：石蜡是非晶体，没有固定熔点。继续观察它会不会出现平台。';
      } else if (state.soft < 0.985) {
        hint = `正在软化：石蜡变软、变稀，但温度一直在升高，只是升得慢了一些。曲线只有“拐弯”，没有平台 —— 这就是非晶体没有固定熔点的表现。`;
      } else {
        hint = '已完全熔化：整条曲线从头到尾都在上升，从来没有出现过水平的平台。';
      }
    }
    els.finding.textContent = hint;
  }

  function refreshAll(dt) {
    applySubstanceVisual();
    updateSample();
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
    // 火焰摇曳
    const wob = Math.sin(clock * 7.3) * 0.5 + Math.sin(clock * 11.7 + 1.3) * 0.3 + Math.sin(clock * 3.1) * 0.2;
    const wob2 = Math.sin(clock * 9.1 + 0.7);
    flameGroup.scale.set(1 + wob * 0.055, 1 + wob2 * 0.045, 1 + wob * 0.05);
    flameGroup.position.x = wob * 0.11;
    flameGroup.rotation.z = wob * 0.035;
    flameLight.intensity = 3.2 + wob * 0.5;

    // 温度计插入 / 拔出：指数平滑跟随目标，动作看得见（支架横臂与细线一起上下滑）
    state.thAnim += (state.thDepth - state.thAnim) * Math.min(1, dt * 3.6);
    if (Math.abs(state.thDepth - state.thAnim) < 0.002) state.thAnim = state.thDepth;
    const thLift = (1 - state.thAnim) * TH_LIFT;
    thermometer.position.y = thLift;
    thSupport.position.y = thLift;
    if (Math.abs(state.thDepth - state.thAnim) > 5e-4) dirty = true;   // 只有还在动的时候才要求重绘

    // 气泡
    const heat = clamp((state.Tw - 55) / 45, 0, 1);
    for (const b of bubbles) {
      const u = b.userData;
      b.visible = heat > 0.02;
      if (!b.visible) continue;
      u.y += u.spd * heat * dt * 6;
      if (u.y > WATER_TOP - 0.2) { u.y = BK_Y0 + 0.3; u.a = rndB() * 6.28; u.rad = 0.6 + rndB() * 3.1; }
      b.position.set(Math.cos(u.a) * u.rad, u.y, Math.sin(u.a) * u.rad);
      const sc = (0.07 + 0.07 * heat) * (0.8 + 0.4 * Math.sin(u.ph + clock * 3));
      b.scale.setScalar(sc);
    }

    // 蒸汽
    for (const m of steams) {
      const u = m.userData;
      m.visible = heat > 0.25;
      if (!m.visible) continue;
      u.ph += dt * u.spd;
      const cyc = (u.ph % 1);
      const y = WATER_TOP + cyc * 7.5;
      m.position.set(Math.cos(u.a) * u.rad + Math.sin(cyc * 5) * 0.4, y, Math.sin(u.a) * u.rad);
      m.scale.setScalar(0.5 + cyc * 1.5);
      m.material.opacity = 0.30 * heat * Math.sin(cyc * Math.PI) * (1 - cyc * 0.6);
    }

    // 水面轻微起伏
    waterTop.position.y = WATER_TOP + Math.sin(clock * 1.7) * 0.012;
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

  /* --- 物质 --- */
  document.querySelectorAll('[data-substance]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.substance = btn.dataset.substance;
      document.querySelectorAll('[data-substance]').forEach((b) => b.classList.toggle('active', b === btn));
      resetSim();
      refreshAll();
    });
  });

  /* --- 运行控制 --- */
  function setRunning(v) {
    state.running = v;
    els.runBtn.disabled = v;
    els.pauseBtn.disabled = !v;
    els.runBtn.textContent = state.t > 0 ? '继续加热' : '开始加热';
    els.pauseBtn.textContent = '暂停';
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
  document.querySelectorAll('[data-speed]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.speed = Number(btn.dataset.speed);
      document.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('active', b === btn));
    });
  });

  /* --- 温度计插入 / 提起（支架横臂与细线一起上下滑） --- */
  document.querySelectorAll('[data-thdepth]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.thDepth = Number(btn.dataset.thdepth);
      document.querySelectorAll('[data-thdepth]').forEach((b) => b.classList.toggle('active', b === btn));
      requestRender();
    });
  });

  /* --- 显示开关 --- */
  $('toggleBath').addEventListener('change', (e) => { toggles.bath = e.target.checked; requestRender(); });
  $('toggleMelt').addEventListener('change', (e) => { toggles.melt = e.target.checked; requestRender(); });
  $('toggleXray').addEventListener('change', (e) => {
    state.xray = e.target.checked;
    applyXray();
    requestRender();
  });
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
    { name: '01 认识器材', text: '<strong>认识器材：</strong>铁架台的铸铁底座上立着镀铬立柱，铁圈托住<b>石棉网</b>，烧杯放在石棉网上，试管用铁夹夹住、浸在烧杯的水里，温度计插在试管中。下方是点燃的酒精灯。' },
    { name: '02 水浴加热', text: '<strong>为什么要把试管泡在水里：</strong>火焰直接加热试管，受热不均匀、温度升得太快，来不及记录。用水浴加热，试管里的物质受热<b>均匀</b>、升温<b>缓慢</b>，而且最高只会接近 100 ℃，安全又便于观察。' },
    { name: '03 海波熔化', text: '<strong>找熔点：</strong>选海波开始加热。温度升到 <b>48 ℃</b> 时注意看 —— 温度计的液柱停住了，但酒精灯还在烧，物质还在吸热。这个不变的温度就是海波的<b>熔点</b>。' },
    { name: '04 石蜡对照', text: '<strong>换石蜡：</strong>换成石蜡重新加热。石蜡没有固定熔点：它先变软、再变稀，温度<b>一直在升高</b>，曲线只有“拐弯”，没有平台。这就是晶体和非晶体最本质的区别。' },
    { name: '05 记录归纳', text: '<strong>记录归纳：</strong>把海波“开始熔化 / 熔化一半 / 刚好熔化完”三个时刻记下来，你会发现三个温度都是 48 ℃。再记录石蜡同一阶段的温度，结论就出来了。' }
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
  const HINT_READY = '加热时随时点一下，当前时刻和试样温度就记进下面的表格（点「重置」会清空）。';
  const HINT_DONE = '已记录。换物质重新加热时旧记录会保留，正好用来对照；点「重置」则把表格一起清空。';

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
      summary.textContent = '建议记录：海波的“开始熔化 / 熔化一半 / 刚好熔化完”三个时刻，看温度是否相同。';
      recSum.textContent = '点上面的按钮开始记录。';
      return;
    }
    recordBody.innerHTML = state.records.map((r) => `
      <tr>
        <td>${r.substance}</td><td>${r.t.toFixed(0)} s</td><td>${r.Tt.toFixed(1)} ℃</td>
        <td>${r.Tw.toFixed(1)} ℃</td><td>${r.state}</td><td>${(r.frac * 100).toFixed(0)}%</td>
      </tr>`).join('');
    recordBodySide.innerHTML = state.records.map((r, i) => `
      <tr class="${r.crystal ? 'crystal' : 'wax'}">
        <td>${i + 1}</td><td>${r.t.toFixed(0)} s</td>
        <td>${r.Tt.toFixed(1)} ℃</td><td>${r.short}</td>
      </tr>`).join('');

    const hypo = state.records.filter((r) => r.crystal && r.frac > 0.01 && r.frac < 0.99);
    let text;
    if (hypo.length >= 2) {
      const ts = hypo.map((r) => r.Tt);
      const spread = Math.max(...ts) - Math.min(...ts);
      text = `熔化过程的 ${hypo.length} 次记录中，试样温度最大只差 ${spread.toFixed(1)} ℃ —— 晶体熔化时温度确实不变。`;
    } else {
      const paras = state.records.filter((r) => !r.crystal);
      if (paras.length >= 2) {
        const ts = paras.map((r) => r.Tt);
        text = `石蜡的 ${paras.length} 次记录温度从 ${Math.min(...ts).toFixed(1)} ℃ 一直升到 ${Math.max(...ts).toFixed(1)} ℃，始终没有停下来。`;
      } else {
        text = `已记录 ${state.records.length} 组。再补几组不同阶段的记录，才能比较温度是否改变。`;
      }
    }
    summary.textContent = text;
    recSum.textContent = text;
  }
  recordBtn.addEventListener('click', () => {
    const frac = meltFraction();
    state.records.push({
      substance: sub[state.substance].name,
      crystal: sub[state.substance].crystal,
      t: state.t, Tt: state.Tt, Tw: state.Tw,
      state: statusText(), short: shortState(), frac
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
  applySubstanceVisual();
  resetSim();
  updateSample();
  updateReadouts();
  drawChart();
  drawMicro(0.016);
  updateCamera();
  resize();

  let last = performance.now();
  let uiAcc = 0;
  (function loop(now) {
    requestAnimationFrame(loop);
    const t = now || performance.now();
    let dt = (t - last) / 1000;
    last = t;
    if (!isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, 0.1);

    animateParts(dt);

    if (state.running && !state.finished) {
      stepSim(dt);
      sampleAcc += dt * state.speed;
      if (sampleAcc >= 0.6) { sampleAcc = 0; pushSample(); }
      updateSample();
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
  })(last);

  const ro = new ResizeObserver(() => { resize(); drawChart(); drawMicro(0.016); });
  ro.observe(stage);
  window.addEventListener('resize', () => { resize(); drawChart(); drawMicro(0.016); });

  /* --- 供无头验收脚本读取 --- */
  window.__meltLab = {
    state, view, VIEWS, SUBSTANCES, toggles, series,
    camera, renderer, scene,
    thermometer, thSupport, thermometerX: TH_X,
    thBulbY: TH_BULB_Y, thLiftMax: TH_LIFT, thTubeH: TH_TUBE_H,
    rodTop: BASE_H + ROD_H, armY: ARM_Y, sleeveHalf: 1.1,
    mats: { solidMat, mushMat, liquidMat, waxMat, thGlassMat, thRedMat, glassMat, waterMat },
    setRunning, resetSim, refreshAll,
    step(dt) { stepSim(dt); updateSample(); pushSample(); updateReadouts(); drawChart(); drawMicro(dt); requestRender(); },
    advance(seconds) {                       // 直接推进仿真，不依赖真实时间
      let left = seconds;
      while (left > 0 && !state.finished) {
        const d = Math.min(0.2, left);
        stepSim(d); left -= d;
      }
      updateSample(); pushSample(); updateReadouts(); drawChart(); drawMicro(0.016);
      return { t: state.t, Tt: state.Tt, Tw: state.Tw, phi: state.phi, soft: state.soft };
    },
    statusText, meltFraction, shortState, renderRecords, clearRecords,
    setSubstance(k) {
      state.substance = k;
      document.querySelectorAll('[data-substance]').forEach((b) => b.classList.toggle('active', b.dataset.substance === k));
      resetSim(); refreshAll();
    },
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
    setThDepth(v) {
      state.thDepth = v;
      document.querySelectorAll('[data-thdepth]').forEach((b) => b.classList.toggle('active', Number(b.dataset.thdepth) === v));
      requestRender();
    },
    setXray(v) {
      state.xray = v;
      const cb = $('toggleXray');
      if (cb) cb.checked = v;
      applyXray(); requestRender();
    }
  };
})();
