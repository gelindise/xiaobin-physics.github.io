import * as THREE from './assets/optics-three.min.js';

/* ============================================================================
   探究压力的作用效果 —— 三维写实实验台
   ---------------------------------------------------------------------------
   世界坐标单位：厘米（cm），y 轴向上，实验台台面为 y = 0。
   器材：受压实心块（细沙 / 海绵 / 松木）+ 四腿小桌 + 200 g 圆柱砝码。
   物理：p = F / S；形变深度按 d = dmax·(1 − e^(−p/σ)) 随压强单调增大，
         σ 为材质“抗压软硬”参数，越小越软、形变越明显。
   ========================================================================== */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  /* ------------------------------ 器材尺寸 ------------------------------ */
  const MAT_W = 44, MAT_D = 32, MAT_H = 5.5;        // 受压材质块（长 / 宽 / 厚）
  const MAT_TOP = MAT_H;                            // 材质顶面基准高度
  const TBL_W = 16, TBL_D = 12, TBL_T = 0.8;        // 小桌桌面
  const LEG_S = 0.6, LEG_H = 6.0, LEG_INSET = 1.4;  // 桌腿截面 / 高 / 内缩
  const LEG_CX = TBL_W / 2 - LEG_INSET;             // 6.6
  const LEG_CZ = TBL_D / 2 - LEG_INSET;             // 4.6
  const WT_R = 1.5, WT_H = 3.4;                     // 砝码（200 g）
  const WT_KNOB_R = 0.42, WT_KNOB_H = 0.95;
  const SEG_X = 180, SEG_Z = 132;                   // 材质顶面网格细分

  /* ------------------------------ 物理参数 ------------------------------ */
  const G_ACC = 10;
  const M_TABLE = 0.2;                              // 小桌 200 g
  const M_WEIGHT = 0.2;                             // 每个砝码 200 g
  const A_LEG = (LEG_S / 100) ** 2;                 // 单腿 3.6e-5 m²
  const S_UPRIGHT = 4 * A_LEG;                      // 正放 1.44e-4 m²
  const S_INVERT = (TBL_W / 100) * (TBL_D / 100);   // 倒放 1.92e-2 m²
  const MAX_WEIGHTS = 6;

  const MATERIALS = {
    sponge: { name: '海绵', sigma: 1.5e4, dmax: 0.016, note: '很软，形变最明显' },
    sand:   { name: '细沙', sigma: 3.2e4, dmax: 0.012, note: '颗粒松散，留痕清晰' },
    pine:   { name: '松木', sigma: 7.0e4, dmax: 0.004, note: '较硬，形变不明显' }
  };

  /* ------------------------------ 状态 ------------------------------ */
  const state = {
    material: 'sand',
    inverted: false,
    weights: 3,
    step: 0,
    records: []
  };
  const view = { yaw: -0.52, pitch: 0.26, dist: 78 };
  const VIEWS = {
    front: { yaw: -0.09, pitch: 0.11, dist: 62 },
    angle: { yaw: -0.52, pitch: 0.26, dist: 78 },
    top:   { yaw: -0.62, pitch: 0.94, dist: 74 },
    close: { yaw: -0.70, pitch: 0.19, dist: 46 }
  };

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
  const SUP = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
  const fmtSci = (v, d = 2) => {
    if (!isFinite(v) || v === 0) return '0';
    const e = Math.floor(Math.log10(Math.abs(v)));
    const m = v / Math.pow(10, e);
    const es = String(e).split('').map((c) => SUP[c]).join('');
    return `${m.toFixed(d)}×10${es}`;
  };
  const fmtPressure = (p) => {
    if (p < 1000) return `${p.toFixed(0)} Pa`;
    if (p < 1e5) return `${(p / 1000).toFixed(1)} kPa`;
    return `${fmtSci(p, 2)} Pa`;
  };
  const newCanvas = (w, h) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  };
  const DEBUG_TEX = {};   // 供开发期导出贴图检查

  /* ==========================================================================
     一、程序化材质贴图（用代码“画”出真实质感，无外部图片依赖）
     ========================================================================== */

  /* --- 细沙：满覆盖的细密沙粒 + 低对比斑驳（贴图 1 格 ≈ 13.7 cm） --- */
  function makeSandMaps() {
    const S = 512, rnd = mulberry32(20261004);
    const c = newCanvas(S, S), g = c.getContext('2d');
    const b = newCanvas(S, S), gb = b.getContext('2d');

    g.fillStyle = '#ab7a42'; g.fillRect(0, 0, S, S);
    gb.fillStyle = '#8c8c8c'; gb.fillRect(0, 0, S, S);

    // 大尺度斑驳（干湿 / 粗细不均），幅度压得很低，只做整体明暗起伏
    for (let i = 0; i < 90; i++) {
      const x = rnd() * S, y = rnd() * S, r = 30 + rnd() * 96;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, `hsla(${26 + rnd() * 12},${34 + rnd() * 18}%,${38 + rnd() * 20}%,0.18)`);
      grd.addColorStop(1, 'hsla(0,0%,0%,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }

    // 沙粒按抖动网格铺满；颜色对比刻意压低，颗粒感主要交给凹凸贴图
    const step = 3.0;
    for (let gy = -step; gy < S + step; gy += step) {
      for (let gx = -step; gx < S + step; gx += step) {
        const x = gx + (rnd() - 0.5) * step * 1.05;
        const y = gy + (rnd() - 0.5) * step * 1.05;
        const r = 1.45 + rnd() * 1.5;
        const asp = 0.72 + rnd() * 0.52;
        const rot = rnd() * Math.PI;
        const h = 28 + rnd() * 12;
        const sat = 32 + rnd() * 22;
        let l = 50 + rnd() * 17;
        if (rnd() < 0.06) l = 38 + rnd() * 10;        // 少量深色沙粒
        else if (rnd() < 0.04) l = 74 + rnd() * 10;   // 少量反光沙粒

        g.fillStyle = `hsl(${h},${sat}%,${l}%)`;
        g.beginPath(); g.ellipse(x, y, r, r * asp, rot, 0, 7); g.fill();

        const v = Math.round(clamp(128 + (l - 58) * 3.4, 36, 230));
        gb.fillStyle = `rgb(${v},${v},${v})`;
        gb.beginPath(); gb.ellipse(x, y, r * 0.92, r * asp * 0.92, rot, 0, 7); gb.fill();
      }
    }

    // 沙面被抚过留下的浅波纹
    for (let i = 0; i < 14; i++) {
      const y0 = rnd() * S;
      g.strokeStyle = `hsla(${34 + rnd() * 10},${30 + rnd() * 18}%,${rnd() < 0.5 ? 40 : 82}%,0.055)`;
      g.lineWidth = 6 + rnd() * 18;
      g.beginPath();
      for (let x = 0; x <= S; x += 8) {
        const yy = y0 + Math.sin(x * 0.012 + i) * 9 + (rnd() - 0.5) * 2;
        x === 0 ? g.moveTo(x, yy) : g.lineTo(x, yy);
      }
      g.stroke();
    }

    const map = new THREE.CanvasTexture(c);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    const bump = new THREE.CanvasTexture(b);
    bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
    DEBUG_TEX.sandColor = c; DEBUG_TEX.sandBump = b;
    return { map, bump };
  }

  /* --- 细沙侧面：被压实后的层理 + 细颗粒 --- */
  function makeSandSideMap() {
    const W = 512, H = 256, rnd = mulberry32(7788);
    const c = newCanvas(W, H), g = c.getContext('2d');
    g.fillStyle = '#b08a56'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 46; i++) {
      const y = rnd() * H;
      g.strokeStyle = `hsla(${28 + rnd() * 12},${30 + rnd() * 20}%,${34 + rnd() * 30}%,${0.10 + rnd() * 0.26})`;
      g.lineWidth = 0.7 + rnd() * 3.4;
      g.beginPath();
      for (let x = 0; x <= W; x += 6) {
        const yy = y + Math.sin(x * 0.017 + i) * 3.2 + (rnd() - 0.5) * 1.6;
        x === 0 ? g.moveTo(x, yy) : g.lineTo(x, yy);
      }
      g.stroke();
    }
    for (let i = 0; i < 5200; i++) {
      const x = rnd() * W, y = rnd() * H, r = 0.4 + rnd() * 1.0;
      g.fillStyle = `hsla(${30 + rnd() * 12},${28 + rnd() * 26}%,${rnd() < 0.3 ? 26 + rnd() * 16 : 58 + rnd() * 26}%,0.75)`;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  /* --- 海绵：淡黄底 + 不规则气孔（孔壁受光、孔底发暗） --- */
  function makeSpongeMaps() {
    const S = 512, rnd = mulberry32(31415);
    const c = newCanvas(S, S), g = c.getContext('2d');
    const b = newCanvas(S, S), gb = b.getContext('2d');

    g.fillStyle = '#d8bd72'; g.fillRect(0, 0, S, S);
    gb.fillStyle = '#c8c8c8'; gb.fillRect(0, 0, S, S);

    // 发泡留下的纤维絮状底纹
    for (let i = 0; i < 240; i++) {
      const x = rnd() * S, y = rnd() * S, r = 10 + rnd() * 60;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, `hsla(${42 + rnd() * 10},${46 + rnd() * 22}%,${48 + rnd() * 20}%,0.22)`);
      grd.addColorStop(1, 'hsla(0,0%,0%,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }

    // 两级气孔：大气孔连成网络，小气孔填缝，更像发泡海绵而不是“撒了一把点”
    const pores = [];
    for (let i = 0; i < 760; i++) {
      pores.push([rnd() * S, rnd() * S, 5 + rnd() * 10, 0.6 + rnd() * 0.7, rnd() * Math.PI, 1]);
    }
    for (let i = 0; i < 1700; i++) {
      pores.push([rnd() * S, rnd() * S, 1.4 + rnd() * 2.8, 0.6 + rnd() * 0.8, rnd() * Math.PI, 0]);
    }
    for (const [x, y, r, asp, rot, big] of pores) {
      const grd = g.createRadialGradient(x, y, r * 0.10, x, y, r);
      grd.addColorStop(0, big ? 'rgba(38,27,8,0.95)' : 'rgba(52,38,12,0.80)');
      grd.addColorStop(0.5, big ? 'rgba(84,62,22,0.66)' : 'rgba(102,78,30,0.44)');
      grd.addColorStop(1, 'rgba(216,189,114,0)');
      g.fillStyle = grd;
      g.beginPath(); g.ellipse(x, y, r, r * asp, rot, 0, 7); g.fill();

      // 孔壁受光的高光弧
      g.strokeStyle = `rgba(255,251,226,${big ? 0.22 + rnd() * 0.30 : 0.16 + rnd() * 0.22})`;
      g.lineWidth = (big ? 1.1 : 0.7) + rnd() * 1.1;
      g.beginPath();
      g.ellipse(x, y, r * 0.95, r * asp * 0.95, rot, Math.PI * 0.12, Math.PI * 1.12);
      g.stroke();

      const v = Math.round(clamp(252 - r * (big ? 15 : 26), 30, 252));
      gb.fillStyle = `rgb(${v},${v},${v})`;
      gb.beginPath(); gb.ellipse(x, y, r * 0.95, r * asp * 0.95, rot, 0, 7); gb.fill();
    }

    const map = new THREE.CanvasTexture(c);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    const bump = new THREE.CanvasTexture(b);
    bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
    DEBUG_TEX.spongeColor = c;
    return { map, bump };
  }

  /* --- 松木：年轮纹 + 木节 + 细木纤维 --- */
  function makePineMaps(dark) {
    const W = 512, H = 512, rnd = mulberry32(dark ? 9091 : 5150);
    const c = newCanvas(W, H), g = c.getContext('2d');
    const b = newCanvas(W, H), gb = b.getContext('2d');

    const base = dark ? '#7a5231' : '#e0c18c';
    g.fillStyle = base; g.fillRect(0, 0, W, H);
    gb.fillStyle = '#9a9a9a'; gb.fillRect(0, 0, W, H);

    // 底色不均（幅度压低，避免出现糊成一片的污渍感）
    for (let i = 0; i < 60; i++) {
      const x = rnd() * W, y = rnd() * H, r = 30 + rnd() * 110;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      const l = dark ? 20 + rnd() * 12 : 60 + rnd() * 14;
      grd.addColorStop(0, `hsla(${26 + rnd() * 10},${dark ? 30 + rnd() * 14 : 40 + rnd() * 16}%,${l}%,0.16)`);
      grd.addColorStop(1, 'hsla(0,0%,0%,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }

    // 年轮 / 纹理线（沿 u 方向延伸）
    const lines = dark ? 100 : 78;
    for (let i = 0; i < lines; i++) {
      const y0 = (i * H) / lines + rnd() * 4;
      const ph = rnd() * 6.28, ph2 = rnd() * 6.28;
      const amp = 2.4 + rnd() * 5.5;
      const w = 0.9 + rnd() * 2.4;
      const alpha = 0.18 + rnd() * 0.36;
      const light = dark ? 16 + rnd() * 16 : 34 + rnd() * 22;
      const col = `hsla(${24 + rnd() * 10},${dark ? 26 + rnd() * 14 : 36 + rnd() * 18}%,${light}%,${alpha})`;

      g.strokeStyle = col; g.lineWidth = w;
      gb.strokeStyle = `rgba(70,70,70,${alpha + 0.1})`; gb.lineWidth = w;
      const p1 = [], p2 = [];
      for (let x = 0; x <= W; x += 4) {
        const yy = y0 + Math.sin(x * 0.019 + ph) * amp + Math.sin(x * 0.0061 + ph2) * amp * 1.7;
        p1.push([x, yy]); p2.push([x, yy]);
      }
      for (const target of [g, gb]) {
        target.beginPath();
        p1.forEach(([x, yy], k) => (k ? target.lineTo(x, yy) : target.moveTo(x, yy)));
        target.stroke();
      }
    }

    // 木节
    for (let k = 0; k < 2; k++) {
      const kx = 90 + rnd() * (W - 180), ky = 90 + rnd() * (H - 180);
      for (let i = 0; i < 13; i++) {
        const r = 4 + i * (2.2 + rnd() * 1.2);
        g.strokeStyle = `hsla(${22 + rnd() * 8},${dark ? 34 : 44}%,${dark ? 15 + rnd() * 10 : 30 + rnd() * 16}%,${0.45 - i * 0.022})`;
        g.lineWidth = 1 + rnd() * 1.4;
        g.beginPath();
        g.ellipse(kx, ky, r * 1.5, r, 0.3, 0, 7);
        g.stroke();
      }
    }

    // 细木纤维
    for (let i = 0; i < 2600; i++) {
      const x = rnd() * W, y = rnd() * H, len = 8 + rnd() * 42;
      g.strokeStyle = `hsla(${26 + rnd() * 10},${30 + rnd() * 20}%,${dark ? 14 + rnd() * 22 : 40 + rnd() * 34}%,${0.06 + rnd() * 0.14})`;
      g.lineWidth = 0.5 + rnd() * 0.7;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + len, y + (rnd() - 0.5) * 2.4); g.stroke();
    }

    const map = new THREE.CanvasTexture(c);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    const bump = new THREE.CanvasTexture(b);
    bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
    DEBUG_TEX[(dark ? 'darkWood' : 'pine') + 'Color'] = c;
    return { map, bump };
  }

  /* --- 实验台：深色环氧树脂台面（哑光 + 细碎颗粒） --- */
  function makeBenchMap() {
    const S = 512, rnd = mulberry32(2468);
    const c = newCanvas(S, S), g = c.getContext('2d');
    g.fillStyle = '#2b2f35'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 300; i++) {
      const x = rnd() * S, y = rnd() * S, r = 8 + rnd() * 46;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, `hsla(${205 + rnd() * 30},${4 + rnd() * 8}%,${12 + rnd() * 20}%,${0.06 + rnd() * 0.10})`);
      grd.addColorStop(1, 'hsla(0,0%,0%,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    for (let i = 0; i < 6000; i++) {
      const x = rnd() * S, y = rnd() * S, r = 0.4 + rnd() * 1.6;
      const l = rnd() < 0.55 ? 10 + rnd() * 14 : 46 + rnd() * 30;
      g.fillStyle = `hsla(${200 + rnd() * 40},${4 + rnd() * 10}%,${l}%,${0.20 + rnd() * 0.46})`;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(18, 12);
    return t;
  }

  /* --- 背景幕布：摄影棚无缝背景 + 柔光 --- */
  function makeBackdropMap() {
    const W = 512, H = 512;
    const c = newCanvas(W, H), g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#f2f4f6');
    grad.addColorStop(0.52, '#e2e6ea');
    grad.addColorStop(1, '#c3c9d0');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    const r = g.createRadialGradient(W * 0.28, H * 0.24, 10, W * 0.28, H * 0.24, W * 0.72);
    r.addColorStop(0, 'rgba(255,255,255,0.92)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, W, H);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /* --- 砝码侧面：红色烤漆 + 刻字 + 上下刻线 --- */
  function makeWeightMap() {
    const W = 512, H = 256;
    const c = newCanvas(W, H), g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#8f2018');
    grad.addColorStop(0.30, '#c8352a');
    grad.addColorStop(0.62, '#b32c22');
    grad.addColorStop(1, '#7d1a13');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);

    // 烤漆的细微色差
    const rnd = mulberry32(6161);
    for (let i = 0; i < 260; i++) {
      const x = rnd() * W, y = rnd() * H, r = 4 + rnd() * 26;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, `hsla(${6 + rnd() * 10},${58 + rnd() * 20}%,${rnd() < 0.5 ? 32 + rnd() * 12 : 52 + rnd() * 16}%,0.20)`);
      grd.addColorStop(1, 'hsla(0,0%,0%,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }

    // 上下两道刻线
    g.strokeStyle = 'rgba(0,0,0,0.42)'; g.lineWidth = 2.4;
    for (const y of [H * 0.16, H * 0.86]) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    }
    g.strokeStyle = 'rgba(255,255,255,0.20)'; g.lineWidth = 1.1;
    for (const y of [H * 0.16 + 2.6, H * 0.86 + 2.6]) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    }

    // 两处刻字（圆柱 UV 环绕，会出现在两个方向上）
    g.font = 'bold 46px "Helvetica Neue", Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const cx of [W * 0.25, W * 0.75]) {
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fillText('200 g', cx + 1.6, H * 0.52 + 1.6);
      g.fillStyle = 'rgba(255,236,226,0.88)';
      g.fillText('200 g', cx, H * 0.52);
    }

    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /* ==========================================================================
     二、场景搭建
     ========================================================================== */

  const canvas = $('sceneCanvas');
  const stage = $('stage');
  const insetCanvas = $('profileCanvas');

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
  renderer.toneMappingExposure = 0.86;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // 各向异性过滤：斜视角下沙面 / 木纹不糊成一片
  const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();
  const sharpen = (t) => { if (t && t.isTexture) t.anisotropy = MAX_ANISO; return t; };

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#d7dbe0');
  scene.fog = new THREE.Fog('#cfd4da', 210, 460);

  const camera = new THREE.PerspectiveCamera(36, 1, 1, 900);

  /* --- 用程序化“柔光箱”生成环境贴图，让金属砝码有可信的反射 --- */
  function studioEnv() {
    const W = 1024, H = 512;
    const c = newCanvas(W, H), g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.44, '#e6ebf1');
    grad.addColorStop(0.5, '#a8b2bc');
    grad.addColorStop(1, '#2f343b');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);

    const box = (x, y, w, h, r, fill) => {
      g.fillStyle = fill;
      g.beginPath();
      g.moveTo(x + r, y);
      g.arcTo(x + w, y, x + w, y + h, r);
      g.arcTo(x + w, y + h, x, y + h, r);
      g.arcTo(x, y + h, x, y, r);
      g.arcTo(x, y, x + w, y, r);
      g.fill();
    };
    box(110, 34, 300, 168, 26, 'rgba(255,255,255,0.98)');   // 主光
    box(660, 74, 232, 140, 22, 'rgba(214,232,255,0.62)');   // 辅光
    box(360, 300, 400, 96, 30, 'rgba(255,226,182,0.34)');   // 台面暖反弹

    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromEquirectangular(tex).texture;
    pmrem.dispose(); tex.dispose();
    return env;
  }
  scene.environment = studioEnv();

  /* --- 光照：主光 + 天光 + 冷补光 + 轮廓光 --- */
  scene.add(new THREE.HemisphereLight('#e9f1fa', '#4a4238', 0.42));
  scene.add(new THREE.AmbientLight('#ffffff', 0.08));

  const key = new THREE.DirectionalLight('#fff2dd', 1.95);
  key.position.set(-46, 62, 40);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -52; key.shadow.camera.right = 52;
  key.shadow.camera.top = 52; key.shadow.camera.bottom = -52;
  key.shadow.camera.near = 20; key.shadow.camera.far = 190;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.028;
  scene.add(key);
  scene.add(key.target);
  key.target.position.set(0, 4, 0);

  const fill = new THREE.DirectionalLight('#dce9f8', 0.62);
  fill.position.set(52, 30, 26);
  scene.add(fill);

  const rim = new THREE.DirectionalLight('#cfe2ff', 0.48);
  rim.position.set(14, 26, -54);
  scene.add(rim);

  /* --- 背景幕布与实验台 --- */
  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(560, 400),
    new THREE.MeshBasicMaterial({ map: makeBackdropMap(), fog: false })
  );
  backdrop.position.set(0, 140, -120);
  scene.add(backdrop);

  const benchMap = makeBenchMap();
  sharpen(benchMap);
  const bench = new THREE.Mesh(
    new THREE.BoxGeometry(320, 7, 210),
    new THREE.MeshStandardMaterial({ map: benchMap, bumpMap: benchMap, bumpScale: 0.05, roughness: 0.74, metalness: 0.02 })
  );
  bench.position.set(0, -3.5, 0);
  bench.receiveShadow = true;
  scene.add(bench);

  /* --- 试样托盘：把受压材质装在里面，场景更像真实实验台 --- */
  const TRAY_T = 1.1;                 // 壁厚
  const TRAY_H = MAT_H + 0.9;         // 盘口略高于沙面
  const trayWood = makePineMaps(true);
  trayWood.map.repeat.set(3.0, 1.0); trayWood.bump.repeat.set(3.0, 1.0);
  sharpen(trayWood.map); sharpen(trayWood.bump);
  const trayMat = new THREE.MeshStandardMaterial({
    map: trayWood.map, bumpMap: trayWood.bump, bumpScale: 0.05,
    roughness: 0.64, metalness: 0.02, color: '#dcc5a0'
  });
  const tray = new THREE.Group();
  const TRAY_HW = MAT_W / 2, TRAY_HD = MAT_D / 2;
  const addWall = (w, h, d, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), trayMat);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    tray.add(m);
  };
  addWall(TRAY_T, TRAY_H, 2 * TRAY_HD + 2 * TRAY_T, -(TRAY_HW + TRAY_T / 2), TRAY_H / 2, 0);
  addWall(TRAY_T, TRAY_H, 2 * TRAY_HD + 2 * TRAY_T, (TRAY_HW + TRAY_T / 2), TRAY_H / 2, 0);
  addWall(2 * TRAY_HW, TRAY_H, TRAY_T, 0, TRAY_H / 2, (TRAY_HD + TRAY_T / 2));
  addWall(2 * TRAY_HW, TRAY_H, TRAY_T, 0, TRAY_H / 2, -(TRAY_HD + TRAY_T / 2));
  scene.add(tray);

  /* ==========================================================================
     三、受压材质块（可形变顶面）
     ========================================================================== */

  const topGeo = new THREE.PlaneGeometry(MAT_W, MAT_D, SEG_X, SEG_Z);
  topGeo.rotateX(-Math.PI / 2);                       // 直接落到 XZ 平面，便于改 y
  topGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(topGeo.attributes.position.count * 3).fill(1), 3));
  const sideGeo = (() => {                            // 去掉顶面的开口盒，避免与形变顶面穿插
    const g = new THREE.BoxGeometry(MAT_W, MAT_H, MAT_D);
    const idx = g.getIndex();
    const keep = [];
    for (let i = 0; i < idx.count; i++) {
      if (i < 12 || i >= 18) keep.push(idx.getX(i));   // py 面为第 13~18 个索引
    }
    g.setIndex(keep);
    return g;
  })();

  const texCache = {};
  function materialMaps(kind) {
    if (texCache[kind]) return texCache[kind];
    let set;
    if (kind === 'sand') {
      const m = makeSandMaps();
      m.map.repeat.set(3.2, 2.4); m.bump.repeat.set(3.2, 2.4);
      const side = makeSandSideMap(); side.repeat.set(7, 1.1);
      set = { top: m, side };
    } else if (kind === 'sponge') {
      const m = makeSpongeMaps();
      m.map.repeat.set(3.0, 2.2); m.bump.repeat.set(3.0, 2.2);
      set = { top: m, side: null };
    } else {
      const m = makePineMaps(false);
      m.map.repeat.set(1.5, 1.1); m.bump.repeat.set(1.5, 1.1);
      const s = makePineMaps(true); s.map.repeat.set(1.5, 1.1);
      set = { top: m, side: { map: s.map, bump: s.bump } };
    }
    [set.top.map, set.top.bump, set.side && set.side.map, set.side && set.side.bump].forEach(sharpen);
    texCache[kind] = set;
    return set;
  }

  const topMat = new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0, bumpScale: 0.16, vertexColors: true });
  const sideMat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });

  const surface = new THREE.Mesh(topGeo, topMat);
  surface.position.y = MAT_TOP;
  surface.receiveShadow = true;
  surface.castShadow = false;
  scene.add(surface);

  const blockSides = new THREE.Mesh(sideGeo, sideMat);
  blockSides.position.y = MAT_H / 2;
  blockSides.receiveShadow = true;
  blockSides.castShadow = true;
  scene.add(blockSides);

  let appliedMaterial = null;
  function applyMaterial(kind) {
    if (appliedMaterial === kind) return;
    appliedMaterial = kind;
    const set = materialMaps(kind);
    topMat.map = set.top.map;
    topMat.bumpMap = set.top.bump;
    topMat.bumpScale = kind === 'pine' ? 0.07 : kind === 'sponge' ? 0.20 : 0.09;
    topMat.color.set(kind === 'pine' ? '#f2e3c8' : kind === 'sponge' ? '#e9d9a6' : '#ffffff');
    topMat.roughness = kind === 'sponge' ? 0.95 : kind === 'pine' ? 0.72 : 0.9;

    const s = set.side || set.top;
    sideMat.map = s.map;
    sideMat.bumpMap = s.bump || null;
    sideMat.bumpScale = 0.1;
    sideMat.color.set(kind === 'sand' ? '#cbb08a' : kind === 'pine' ? '#c9ab84' : '#d6c592');
    sideMat.roughness = kind === 'sponge' ? 0.96 : 0.85;
    topMat.needsUpdate = true;
    sideMat.needsUpdate = true;
  }

  /* ==========================================================================
     四、小桌与砝码
     ========================================================================== */

  const tableGroup = new THREE.Group();
  scene.add(tableGroup);

  const woodTop = makePineMaps(false);
  woodTop.map.repeat.set(2.6, 2.0); woodTop.bump.repeat.set(2.6, 2.0);
  const woodLeg = makePineMaps(true);
  woodLeg.map.repeat.set(1.2, 2.4); woodLeg.bump.repeat.set(1.2, 2.4);
  sharpen(woodTop.map); sharpen(woodTop.bump); sharpen(woodLeg.map); sharpen(woodLeg.bump);

  const deskMat = new THREE.MeshStandardMaterial({ map: woodTop.map, bumpMap: woodTop.bump, bumpScale: 0.09, roughness: 0.46, metalness: 0.02, color: '#d6c1a0' });
  const legMat = new THREE.MeshStandardMaterial({ map: woodLeg.map, bumpMap: woodLeg.bump, bumpScale: 0.06, roughness: 0.55, metalness: 0.02, color: '#e6cda6' });
  const screwMat = new THREE.MeshStandardMaterial({ color: '#6f7276', roughness: 0.34, metalness: 0.95 });

  const desktop = new THREE.Mesh(new THREE.BoxGeometry(TBL_W, TBL_T, TBL_D), deskMat);
  desktop.castShadow = true; desktop.receiveShadow = true;
  tableGroup.add(desktop);

  const legs = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(LEG_S, LEG_H, LEG_S), legMat);
      leg.castShadow = true; leg.receiveShadow = true;
      tableGroup.add(leg);
      legs.push({ mesh: leg, x: sx * LEG_CX, z: sz * LEG_CZ });

      const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.08, 14), screwMat);
      screw.position.set(sx * LEG_CX, 0, sz * LEG_CZ);
      tableGroup.add(screw);
      legs[legs.length - 1].screw = screw;
    }
  }

  /* --- 砝码 --- */
  const wtMap = makeWeightMap();
  const enamelMat = new THREE.MeshPhysicalMaterial({
    map: wtMap, roughness: 0.26, metalness: 0.0,
    clearcoat: 1.0, clearcoatRoughness: 0.08, envMapIntensity: 1.5
  });
  const enamelCapMat = new THREE.MeshPhysicalMaterial({
    color: '#9d2419', roughness: 0.30, metalness: 0.0,
    clearcoat: 1.0, clearcoatRoughness: 0.12, envMapIntensity: 1.5
  });
  const steelMat = new THREE.MeshStandardMaterial({ color: '#ccd2d8', roughness: 0.18, metalness: 1.0, envMapIntensity: 1.7 });

  const weightGeo = new THREE.CylinderGeometry(WT_R, WT_R, WT_H, 44, 1, false);
  const knobGeo = new THREE.CylinderGeometry(WT_KNOB_R, WT_KNOB_R * 1.12, WT_KNOB_H, 22);
  const knobTopGeo = new THREE.SphereGeometry(WT_KNOB_R, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2);

  const weights = [];
  for (let i = 0; i < MAX_WEIGHTS; i++) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(weightGeo, [enamelMat, enamelCapMat, enamelCapMat]);
    body.castShadow = true; body.receiveShadow = true;
    body.position.y = WT_H / 2;
    g.add(body);

    const knob = new THREE.Mesh(knobGeo, steelMat);
    knob.castShadow = true;
    knob.position.y = WT_H + WT_KNOB_H / 2 - 0.05;
    g.add(knob);

    const cap = new THREE.Mesh(knobTopGeo, steelMat);
    cap.castShadow = true;
    cap.position.y = WT_H + WT_KNOB_H - 0.05;
    g.add(cap);

    tableGroup.add(g);
    g.rotation.y = i * 1.07;      // 每个砝码朝向略不同，避免刻字排成一条线
    weights.push(g);
  }

  /* --- “原始表面”参考虚线 --- */
  const refMat = new THREE.LineDashedMaterial({ color: '#2f6fb5', dashSize: 0.9, gapSize: 0.7, transparent: true, opacity: 0.9 });
  const refGroup = new THREE.Group();
  scene.add(refGroup);

  function dashRect(w, d, y) {
    const hw = w / 2, hd = d / 2;
    const pts = [
      new THREE.Vector3(-hw, y, -hd), new THREE.Vector3(hw, y, -hd),
      new THREE.Vector3(hw, y, hd), new THREE.Vector3(-hw, y, hd),
      new THREE.Vector3(-hw, y, -hd)
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geo, refMat);
    line.computeLineDistances();
    return line;
  }
  function rebuildRefs(st) {
    for (const c of refGroup.children) c.geometry.dispose();
    refGroup.clear();
    const y = MAT_TOP + st.support + 0.03;
    if (st.inverted) {
      refGroup.add(dashRect(TBL_W, TBL_D, y));
    } else {
      for (const l of legs) refGroup.add(dashRect(LEG_S, LEG_S, y));
    }
    refGroup.visible = toggles.refs;
  }

  /* --- 压力箭头 --- */
  const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 0), 8, 0xe11d48, 3.0, 1.8);
  arrow.line.material.linewidth = 2;
  scene.add(arrow);

  /* ==========================================================================
     五、形变（高度场）
     ========================================================================== */

  function baseHeight(x, z, kind) {
    const hx = MAT_W / 2, hz = MAT_D / 2;
    const cheb = Math.max(Math.abs(x) / hx, Math.abs(z) / hz);
    const edge = 1 - smoothstep(0.70, 1.0, cheb);
    if (kind === 'sand') {
      const mound = 0.42 * Math.exp(-((x * x) / (2 * 17 * 17) + (z * z) / (2 * 12 * 12)));
      const ripple = 0.055 * Math.sin(x * 0.75) * Math.cos(z * 0.95) + 0.032 * Math.sin(x * 1.7 + 1.2) * Math.sin(z * 1.35);
      return (mound + ripple) * edge;
    }
    if (kind === 'sponge') {
      return 0.05 * Math.sin(x * 0.62) * Math.sin(z * 0.71) * edge;
    }
    return 0.018 * Math.sin(x * 0.45) * Math.cos(z * 0.55) * edge;
  }

  function deformHeight(x, z, st) {
    const d = st.depth;
    if (d <= 1e-6) return 0;
    let off = 0;
    if (st.inverted) {
      const hw = TBL_W / 2, hd = TBL_D / 2;
      const t = Math.max(Math.abs(x) / hw, Math.abs(z) / hd);
      off -= d * (1 - smoothstep(0.92, 1.30, t));
      const rim = Math.max(0, 1 - Math.abs(t - 1.48) / 0.42);
      off += d * 0.20 * rim * rim;
    } else {
      for (const l of legs) {
        const r = Math.hypot(x - l.x, z - l.z);
        off -= d * Math.exp(-(r * r) / (2 * 1.18 * 1.18));
        off += d * 0.22 * Math.exp(-((r - 2.55) ** 2) / (2 * 1.05 * 1.05));
      }
    }
    return off;
  }

  const surfaceY = (x, z, st) => MAT_TOP + baseHeight(x, z, st.material) + deformHeight(x, z, st);

  /* ==========================================================================
     六、状态计算与刷新
     ========================================================================== */

  function computeState() {
    const n = state.weights;
    const F = (M_TABLE + n * M_WEIGHT) * G_ACC;
    const S = state.inverted ? S_INVERT : S_UPRIGHT;
    const p = F / S;
    const m = MATERIALS[state.material];
    const depthM = m.dmax * (1 - Math.exp(-p / m.sigma));
    const depth = depthM * 100;                         // cm
    let support;
    if (state.inverted) {
      support = baseHeight(0, 0, state.material);
    } else {
      support = Math.max(...legs.map((l) => baseHeight(l.x, l.z, state.material)));
    }
    return { n, F, S, p, depth, depthM, support, material: state.material, inverted: state.inverted };
  }

  function deformSurface(st) {
    const pos = topGeo.attributes.position;
    const col = topGeo.attributes.color;
    const inv = st.depth > 1e-6 ? 1 / st.depth : 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const def = deformHeight(x, z, st);
      pos.setY(i, baseHeight(x, z, st.material) + def);

      // 顶点环境光遮蔽：陷得越深越暗，让压痕在斜光下也读得出来
      const dn = clamp(-def * inv, 0, 1);
      const up = clamp(def * inv, 0, 1);
      const s = clamp(1 - 0.52 * Math.pow(dn, 0.7) + 0.10 * up, 0.3, 1.2);
      col.setXYZ(i, s, s, s);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    topGeo.computeVertexNormals();
    topGeo.computeBoundingSphere();
  }

  /* --- 砝码落位（3 个一行，最多两行） --- */
  function weightSlots(n) {
    const out = [];
    const spacing = 4.4;
    const push = (count, z, list) => {
      for (let i = 0; i < count; i++) {
        list.push([(i - (count - 1) / 2) * spacing, z]);
      }
    };
    if (n <= 3) {
      push(n, 0, out);
    } else {
      push(3, 2.4, out);
      push(n - 3, -2.4, out);
    }
    return out;
  }

  function layoutTable(st) {
    const contactY = MAT_TOP + st.support - st.depth;
    tableGroup.position.set(0, contactY, 0);

    const deskY = st.inverted ? TBL_T / 2 : LEG_H + TBL_T / 2;
    desktop.position.y = deskY;

    for (const l of legs) {
      l.mesh.position.set(l.x, st.inverted ? TBL_T + LEG_H / 2 : LEG_H / 2, l.z);
      // 螺钉钉在桌面朝外的那一面
      l.screw.position.set(l.x, st.inverted ? -0.02 : LEG_H + TBL_T + 0.02, l.z);
    }

    const baseY = st.inverted ? TBL_T : LEG_H + TBL_T;
    const slots = weightSlots(st.n);
    weights.forEach((w, i) => {
      if (i < slots.length) {
        w.visible = true;
        w.position.set(slots[i][0], baseY, slots[i][1]);
      } else {
        w.visible = false;
      }
    });

    // 压力箭头：从器材上方指向桌面中心
    const topY = contactY + (st.inverted ? TBL_T + LEG_H : LEG_H + TBL_T) + (st.n ? WT_H + 1.4 : 0);
    arrow.position.set(0, topY + 9.5, 0);
    arrow.setLength(8.5, 3.0, 1.8);
    arrow.visible = toggles.arrow;
  }

  /* ==========================================================================
     七、剖面插图（2D）：固定纵轴量程，便于横向对比不同组合
     ========================================================================== */
  const PMAX = 18;             // 纵轴最大下陷 18 mm
  function drawProfile(st) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = insetCanvas.clientWidth || 300;
    const H = insetCanvas.clientHeight || 132;
    if (insetCanvas.width !== Math.round(W * dpr) || insetCanvas.height !== Math.round(H * dpr)) {
      insetCanvas.width = Math.round(W * dpr);
      insetCanvas.height = Math.round(H * dpr);
    }
    const g = insetCanvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    const padL = 34, padR = 12, padT = 16, padB = 20;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const yTop = 3, yBot = -PMAX;                    // mm
    const mmToY = (mm) => padT + (yTop - mm) / (yTop - yBot) * plotH;
    const xToPx = (x) => padL + (x + MAT_W / 2) / MAT_W * plotW;

    // 背景
    g.fillStyle = 'rgba(9,22,38,0.72)';
    g.fillRect(0, 0, W, H);

    // 刻度
    g.strokeStyle = 'rgba(148,178,205,0.22)';
    g.lineWidth = 1;
    g.font = '9px "Helvetica Neue", Arial, sans-serif';
    g.fillStyle = 'rgba(150,180,205,0.85)';
    g.textAlign = 'right'; g.textBaseline = 'middle';
    for (let mm = 0; mm >= -PMAX; mm -= 6) {
      const y = mmToY(mm);
      g.beginPath(); g.moveTo(padL, y); g.lineTo(W - padR, y); g.stroke();
      g.fillText(`${mm}`, padL - 4, y);
    }
    g.textAlign = 'left';
    g.fillText('mm', 4, padT - 6);

    // 原始表面（未形变）
    const y0 = mmToY(0);
    g.setLineDash([4, 3]);
    g.strokeStyle = 'rgba(120,200,255,0.8)';
    g.beginPath(); g.moveTo(padL, y0); g.lineTo(W - padR, y0); g.stroke();
    g.setLineDash([]);

    // 形变剖面（只画相对原始表面的下陷量，不含沙面本身的起伏）
    const zLine = st.inverted ? 0 : LEG_CZ;
    const N = 220;
    const pts = [];
    let deepest = 0;
    for (let i = 0; i <= N; i++) {
      const x = -MAT_W / 2 + (MAT_W * i) / N;
      const dy = deformHeight(x, zLine, st) * 10;   // mm
      deepest = Math.min(deepest, dy);
      pts.push([xToPx(x), mmToY(dy)]);
    }

    const accent = st.material === 'sponge' ? '#e8c766' : st.material === 'sand' ? '#e2a45c' : '#d8b483';
    const grad = g.createLinearGradient(0, padT, 0, H - padB);
    grad.addColorStop(0, accent + 'cc');
    grad.addColorStop(1, accent + '33');
    g.beginPath();
    g.moveTo(pts[0][0], y0);
    pts.forEach(([px, py]) => g.lineTo(px, py));
    g.lineTo(pts[pts.length - 1][0], y0);
    g.closePath();
    g.fillStyle = grad; g.fill();
    g.strokeStyle = accent; g.lineWidth = 1.6;
    g.beginPath();
    pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
    g.stroke();

    // 最大下陷标注
    const dm = Math.abs(deepest);
    const xMark = st.inverted ? xToPx(0) : xToPx(LEG_CX);
    g.font = 'bold 11px "Helvetica Neue", Arial, sans-serif';
    if (dm < 0.4) {
      g.fillStyle = '#ffb3ba';
      g.textAlign = 'left'; g.textBaseline = 'bottom';
      g.fillText(`${dm.toFixed(2)} mm · 几乎看不出下陷`, padL + 8, y0 - 9);
    } else {
      const yMark = mmToY(-dm);
      g.strokeStyle = '#ff5f6d'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(xMark, y0); g.lineTo(xMark, yMark); g.stroke();
      g.beginPath(); g.moveTo(xMark - 3.5, yMark + 5); g.lineTo(xMark, yMark); g.lineTo(xMark + 3.5, yMark + 5); g.stroke();
      g.fillStyle = '#ffb3ba';
      g.textAlign = 'left'; g.textBaseline = 'bottom';
      g.fillText(`${dm.toFixed(2)} mm`, Math.min(xMark + 6, W - padR - 54), yMark - 2);
    }
  }

  /* ==========================================================================
     八、界面刷新
     ========================================================================== */
  const toggles = { arrow: true, refs: true };

  const els = {
    F: $('metricF'), S: $('metricS'), P: $('metricP'), D: $('metricD'),
    weightCount: $('weightCount'),
    weightSlider: $('weightSlider'),
    minus: $('weightMinus'), plus: $('weightPlus'),
    finding: $('finding'),
    profileText: $('profileText'),
    calcLine: $('calcLine'),
    grade: $('metricGrade')
  };

  function fmtArea(S) {
    if (S >= 1e-2) return `${(S * 1e4).toFixed(1)} cm²`;
    return `${fmtSci(S, 2)} m²`;
  }

  function refresh() {
    const st = computeState();
    applyMaterial(st.material);
    deformSurface(st);
    layoutTable(st);
    rebuildRefs(st);
    drawProfile(st);

    els.F.textContent = `${st.F.toFixed(1)} N`;
    els.S.textContent = fmtArea(st.S);
    els.P.textContent = fmtPressure(st.p);
    els.D.textContent = `${(st.depthM * 1000).toFixed(2)} mm`;
    els.weightCount.textContent = `${st.n} 个`;
    if (els.weightSlider) els.weightSlider.value = String(st.n);
    els.minus.disabled = st.n === 0;
    els.plus.disabled = st.n === MAX_WEIGHTS;

    const qual = st.depthM < 0.0004 ? '几乎无形变'
      : st.depthM < 0.002 ? '轻微形变'
        : st.depthM < 0.006 ? '明显形变'
          : st.depthM < 0.012 ? '显著形变' : '深度形变';
    els.grade.textContent = qual;

    const m = MATERIALS[st.material];
    els.calcLine.innerHTML =
      `p = F / S = ${st.F.toFixed(1)} N ÷ ${fmtArea(st.S)} = <span>${fmtPressure(st.p)}</span>` +
      `　｜　${m.name}：${qual}，下陷 ${(st.depthM * 1000).toFixed(2)} mm`;

    els.profileText.textContent = st.inverted
      ? `桌面整面压入，受力面积 ${fmtArea(st.S)}，下陷 ${(st.depthM * 1000).toFixed(2)} mm`
      : `四条桌腿压入，受力面积 ${fmtArea(st.S)}，下陷 ${(st.depthM * 1000).toFixed(2)} mm`;

    // 观察提示
    let hint;
    if (st.n === 0) {
      hint = `只放小桌（${st.F.toFixed(1)} N）。先记住这个形变，再逐个加砝码，压力变大后效果如何变化？`;
    } else if (!st.inverted) {
      hint = `正放：四条桌腿着地，受力面积只有 ${fmtArea(st.S)}，压强大，${m.name}上留下清晰压痕。`;
    } else {
      hint = `倒放：桌面整面着地，受力面积增大到 ${fmtArea(st.S)}，压强骤降到 ${fmtPressure(st.p)}，${m.name}几乎不变形。`;
    }
    els.finding.textContent = hint;

    requestRender();
  }

  /* ==========================================================================
     九、交互
     ========================================================================== */
  let dirty = true;
  const requestRender = () => { dirty = true; };

  function updateCamera() {
    const t = new THREE.Vector3(0, 8.2, 0);
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

  /* --- 环绕交互 --- */
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
    view.pitch = clamp(view.pitch + dy * 2.3, -0.10, 1.36);
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
    view.dist = clamp(view.dist * (1 + Math.sign(e.deltaY) * 0.08), 26, 170);
    updateCamera();
  }, { passive: false });

  /* --- 材质 / 放置 --- */
  document.querySelectorAll('[data-material]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.material = btn.dataset.material;
      document.querySelectorAll('[data-material]').forEach((b) => b.classList.toggle('active', b === btn));
      refresh();
    });
  });
  document.querySelectorAll('[data-place]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.inverted = btn.dataset.place === 'inverted';
      document.querySelectorAll('[data-place]').forEach((b) => b.classList.toggle('active', b === btn));
      refresh();
    });
  });

  /* --- 砝码 --- */
  function setWeights(n) {
    state.weights = clamp(n, 0, MAX_WEIGHTS);
    refresh();
  }
  els.minus.addEventListener('click', () => setWeights(state.weights - 1));
  els.plus.addEventListener('click', () => setWeights(state.weights + 1));
  els.weightSlider.addEventListener('input', () => setWeights(parseInt(els.weightSlider.value, 10)));

  /* --- 视图 --- */
  document.querySelectorAll('[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = VIEWS[btn.dataset.view];
      if (!v) return;
      view.yaw = v.yaw; view.pitch = v.pitch; view.dist = v.dist;
      document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b === btn));
      updateCamera();
    });
  });

  /* --- 显示开关 --- */
  const toggleArrow = $('toggleArrow'), toggleRefs = $('toggleRefs');
  if (toggleArrow) toggleArrow.addEventListener('change', () => {
    toggles.arrow = toggleArrow.checked;
    arrow.visible = toggles.arrow;
    requestRender();
  });
  if (toggleRefs) toggleRefs.addEventListener('change', () => {
    toggles.refs = toggleRefs.checked;
    refGroup.visible = toggles.refs;
    requestRender();
  });

  /* ==========================================================================
     十、步骤引导与实验记录
     ========================================================================== */
  const STEPS = [
    { name: '01 认识器材', text: '<strong>认识器材：</strong>受压实心块（细沙 / 海绵 / 松木）、四条腿的小桌、每个 200 g 的砝码。小桌<b>正放</b>时只有四条桌腿着地，<b>倒放</b>时整个桌面着地 —— 同一张桌子，受力面积可以差一百多倍。' },
    { name: '02 改变压力', text: '<strong>控制受力面积不变：</strong>保持正放，用 − / + 逐个增减砝码。压力 F = G<sub>桌</sub> + G<sub>砝码</sub> 从 2.0 N 一路加到 14.0 N，观察细沙上压痕的深浅。' },
    { name: '03 改变受力面积', text: '<strong>控制压力不变：</strong>砝码数保持不变，把「正放」切换成「倒放」。压力一点没变，受力面积却从 1.44×10⁻⁴ m² 变成 1.92×10⁻² m²，压强骤降，压痕几乎消失。' },
    { name: '04 换材质对比', text: '<strong>换材质再看一遍：</strong>海绵最软、细沙居中、松木最硬。同样的器材、同样的压力，换成硬材料后形变明显变小 —— 所以“压力作用效果”既跟压力和受力面积有关，也跟受压材料有关，实验时要<b>控制材质一致</b>。' },
    { name: '05 记录归纳', text: '<strong>记录归纳：</strong>把每种组合的 F、S、p 和下陷深度记到表里。比较数据可以得出：<b>受力面积相同时，压力越大，压力作用效果越明显；压力相同时，受力面积越小，压力作用效果越明显。</b>' }
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

  const recordBtn = $('recordBtn'), recordBody = $('records'), summary = $('summary'), recordHint = $('recordHint');
  function renderRecords() {
    if (!state.records.length) {
      recordBody.innerHTML = '<tr><td colspan="7" class="empty">尚无记录，先调好器材再点“记录当前观察”</td></tr>';
      summary.textContent = '建议至少记录：正放 0 个 / 正放 3 个 / 倒放 3 个，三组一对比，规律就出来了。';
      return;
    }
    recordBody.innerHTML = state.records.map((r) => `
      <tr>
        <td>${r.material}</td><td>${r.place}</td><td>${r.n}</td>
        <td>${r.F.toFixed(1)}</td><td>${fmtArea(r.S)}</td>
        <td>${fmtPressure(r.p)}</td><td>${r.depth.toFixed(2)}</td>
      </tr>`).join('');
    const p = state.records.map((r) => r.p);
    const d = state.records.map((r) => r.depth);
    summary.textContent = `已记录 ${state.records.length} 组。压强范围 ${fmtPressure(Math.min(...p))} ~ ${fmtPressure(Math.max(...p))}，`
      + `下陷深度范围 ${Math.min(...d).toFixed(2)} ~ ${Math.max(...d).toFixed(2)} mm —— 压强越大，形变越明显。`;
  }
  recordBtn.addEventListener('click', () => {
    const st = computeState();
    const key = `${st.material}|${st.inverted}|${st.n}`;
    const row = {
      key, material: MATERIALS[st.material].name,
      place: st.inverted ? '倒放' : '正放', n: st.n,
      F: st.F, S: st.S, p: st.p, depth: st.depthM * 1000
    };
    const idx = state.records.findIndex((r) => r.key === key);
    if (idx >= 0) state.records[idx] = row; else state.records.push(row);
    renderRecords();
    recordHint.textContent = '已记录（同一组合重复记录会覆盖更新）';
    requestRender();
  });
  renderRecords();

  /* ==========================================================================
     十一、启动
     ========================================================================== */
  canvas.style.cursor = 'grab';
  refresh();
  updateCamera();

  const ro = new ResizeObserver(() => { resize(); drawProfile(computeState()); });
  ro.observe(stage);
  window.addEventListener('resize', () => { resize(); drawProfile(computeState()); });
  resize();

  (function loop() {
    if (dirty) {
      renderer.render(scene, camera);
      dirty = false;
    }
    requestAnimationFrame(loop);
  })();

  // 供无头验收脚本读取的内部状态
  window.__pressLab = {
    state, view, computeState, surfaceY, MATERIALS, DEBUG_TEX,
    setWeights, refresh, updateCamera, VIEWS,
    set(mut) { Object.assign(state, mut); refresh(); },
    setToggle(k, v) { toggles[k] = !!v; if (k === 'arrow') arrow.visible = toggles.arrow; if (k === 'refs') refGroup.visible = toggles.refs; requestRender(); },
    camera, renderer, scene
  };
})();
