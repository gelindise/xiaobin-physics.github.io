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

  /* 形变深度模型 —— 主实验与「生活实例」共用同一个函数（同源，不许各写一份）。
     σ 是受压物的“抗压软硬”参数：p 远大于 σ 时形变饱和，表示材料已被压到极限。 */
  function dentDepth(p, sigma, dmax) { return dmax * (1 - Math.exp(-p / sigma)); }

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
  const supNum = (n) => String(n).split('').map((c) => SUP[c] || c).join('');
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

  /* --- 用程序化“柔光箱”生成环境贴图，让金属砝码有可信的反射 ---
     🔴 必须传 renderer：PMREM 贴图是【某个 WebGL 上下文】里的 GPU 资源，
        两个上下文不能共用同一张 environment（共用 ⇒ 第二个场景里的金属件全黑）。 */
  function studioEnv(rend) {
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
    const pmrem = new THREE.PMREMGenerator(rend);
    const env = pmrem.fromEquirectangular(tex).texture;
    pmrem.dispose(); tex.dispose();
    return env;
  }
  scene.environment = studioEnv(renderer);

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
    const depthM = dentDepth(p, m.sigma, m.dmax);
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
    { name: '05 记录归纳', text: '<strong>记录归纳：</strong>把每种组合的 F、S、p 和下陷深度记到表里。比较数据可以得出：<b>受力面积相同时，压力越大，压力作用效果越明显；压力相同时，受力面积越小，压力作用效果越明显。</b>' },
    { name: '06 增大/减小压强', text: '<strong>用到生活里：</strong>同一压力下，受力面积越小压强越大 —— 图钉的尖、磨薄的刀刃、高跟鞋的细跟都在<b>增大压强</b>；受力面积越大压强越小 —— 宽书包带、履带、滑雪板、铁轨下的枕木都在<b>减小压强</b>。下面这一节把四种生活实例摆成左右对照，红色的“压力箭头”两边一样长，看看接触面大小和压痕深浅差多少。' }
  ];

  const stepButtons = Array.from(document.querySelectorAll('[data-step]'));
  const stepDetail = $('stepDetail');
  function showStep(i) {
    state.step = i;
    stepButtons.forEach((b, k) => b.classList.toggle('active', k === i));
    stepDetail.innerHTML = STEPS[i].text;
    if (i === 5) {
      const panel = $('instPanel');
      if (panel && panel.scrollIntoView) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
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
     十一、生活实例：增大压强 / 减小压强（第二套 3D 场景）
     --------------------------------------------------------------------------
     教学点：同一个压力 F，作用在不同大小的受力面积 S 上，压强 p = F/S 相差很多倍。
     三条硬约束：
       ① 深度模型与主实验共用 dentDepth()（画面与读数同源，不许各写一份）；
       ② 3D 里接触面按【真实线性尺寸比】k = √(S大/S小) 绘制，只做整体缩放，
          所以画面里的相对大小是真实的；缩放关系写在页面上；
       ③ 受力面积一律由几何尺寸算出（S_circ / S_rect），不许手填数字。
     ========================================================================== */

  /* --- 受力面积：直径 mm / 长宽 mm → m² --- */
  const S_circ = (dmm) => Math.PI * (dmm / 2000) ** 2;
  const S_rect = (wmm, lmm) => (wmm / 1000) * (lmm / 1000);

  /* --- 3D 接触面示意宽度：大的一侧固定 INST_BIG_W，小的一侧按真实线性比缩小 --- */
  const INST_BIG_W = 9.0, INST_SMALL_MIN = 0.38, INST_DMAX = 3.0;
  function instWidths(Ssmall, Sbig) {
    const k = Math.sqrt(Sbig / Ssmall);
    return { k, wSmall: Math.max(INST_SMALL_MIN, INST_BIG_W / k), wBig: INST_BIG_W };
  }

  const INSTANCES = [
    {
      id: 'pin', icon: '📌', name: '图钉', F: 20, sigma: 2.0e6, round: true,
      low: { label: '钉尖朝下', S: S_circ(0.5), desc: '尖端直径 0.5 mm', footD: 0 },
      high: { label: '钉帽朝下', S: S_circ(10), desc: '钉帽直径 10 mm', footD: 0 },
      q: '同一枚图钉、同样的按压力，为什么钉尖能扎进木板，手指顶住钉帽却不疼？',
      a: '钉尖的受力面积只有钉帽的 1/400，压强却是钉帽的 400 倍 —— 一端足以压穿木板，另一端手指却毫无痛感。'
    },
    {
      id: 'knife', icon: '🔪', name: '刀', F: 100, sigma: 1.5e6, round: false,
      low: { label: '刀刃朝下', S: S_rect(0.05, 100), desc: '刃口宽 0.05 mm × 刃长 100 mm', footD: 10 },
      high: { label: '刀背朝下', S: S_rect(3, 100), desc: '刀背厚 3 mm × 刃长 100 mm', footD: 10 },
      q: '切菜时为什么要把刀刃磨得很薄，而不能拿刀背去切？',
      a: '刀刃的受力面积只有刀背的 1/60，压强却是刀背的 60 倍 —— 所以刀刃能轻松切开蔬菜，刀背按下去只会把菜压扁。'
    },
    {
      id: 'bag', icon: '🎒', name: '书包带', F: 60, sigma: 8.0e4, round: false,
      low: { label: '细书包带', S: S_rect(15, 60), desc: '带宽 15 mm × 肩接触长 60 mm', footD: 11 },
      high: { label: '宽书包带', S: S_rect(50, 60), desc: '带宽 50 mm × 肩接触长 60 mm', footD: 11 },
      q: '同样重的书包，为什么换一副宽带子就不那么勒肩了？',
      a: '压力一点没变，宽带的受力面积是细带的 3.3 倍，压强就降到 1/3.3 —— 宽书包带、宽提手做的都是同一件事：增大受力面积。'
    },
    {
      id: 'snow', icon: '🎿', name: '雪地行走', F: 500, sigma: 2.0e5, round: true,
      low: { label: '高跟鞋', S: S_rect(10, 10), desc: '跟底 10 mm × 10 mm', footD: 0 },
      high: { label: '滑雪板', S: S_rect(100, 1600), desc: '板宽 100 mm × 板长 1600 mm', footD: 14 },
      q: '同一个人在雪地上，穿高跟鞋会陷下去，踩上滑雪板却站得住，为什么？',
      a: '体重完全相同，滑雪板的受力面积是高跟的 1600 倍，压强只有 1/1600 —— 坦克用履带、骆驼有宽脚掌、铁轨下垫枕木，都是这个道理。'
    }
  ];

  /* --- 派生量：S / p / 下陷深度 / 3D 宽度，全部由上面那张表算出来 --- */
  function instDerive(ins) {
    const { k, wSmall, wBig } = instWidths(ins.low.S, ins.high.S);
    const pSmall = ins.F / ins.low.S, pBig = ins.F / ins.high.S;
    return {
      k, wSmall, wBig, pSmall, pBig,
      SSmall: ins.low.S, SBig: ins.high.S,
      footDSmall: ins.low.footD || wSmall,
      footDBig: ins.high.footD || wBig,
      dSmall: dentDepth(pSmall, ins.sigma, INST_DMAX),
      dBig: dentDepth(pBig, ins.sigma, INST_DMAX),
      ratio: ins.high.S / ins.low.S
    };
  }
  const INST_DERIVED = {};
  INSTANCES.forEach((i) => { INST_DERIVED[i.id] = instDerive(i); });

  /* --- 对数刻度范围（跨实例固定，切换实例时坐标轴不跳） --- */
  const ALL_S = INSTANCES.flatMap((i) => [i.low.S, i.high.S]);
  const ALL_P = INSTANCES.flatMap((i) => [i.F / i.low.S, i.F / i.high.S]);
  const LOG_S0 = Math.floor(Math.log10(Math.min(...ALL_S)));
  const LOG_S1 = Math.ceil(Math.log10(Math.max(...ALL_S)));
  const LOG_P0 = Math.floor(Math.log10(Math.min(...ALL_P)));
  const LOG_P1 = Math.ceil(Math.log10(Math.max(...ALL_P)));

  /* --- 松软地面贴图（中性浅灰米色 + 斑驳 + 细颗粒，四个实例共用） --- */
  function makeGroundMap() {
    const S = 512, rnd = mulberry32(70707);
    const c = newCanvas(S, S), g = c.getContext('2d');
    const b = newCanvas(S, S), gb = b.getContext('2d');
    g.fillStyle = '#b8b1a4'; g.fillRect(0, 0, S, S);
    gb.fillStyle = '#8e8e8e'; gb.fillRect(0, 0, S, S);
    for (let i = 0; i < 150; i++) {
      const x = rnd() * S, y = rnd() * S, r = 16 + rnd() * 92;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, `hsla(${34 + rnd() * 16},${6 + rnd() * 12}%,${rnd() < 0.5 ? 58 + rnd() * 16 : 40 + rnd() * 12}%,0.14)`);
      grd.addColorStop(1, 'hsla(0,0%,0%,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    for (let i = 0; i < 5200; i++) {
      const x = rnd() * S, y = rnd() * S, r = 0.6 + rnd() * 1.9;
      const v = Math.round(clamp(128 + (rnd() - 0.5) * 190, 40, 235));
      g.fillStyle = `rgba(${v},${v - 4},${v - 14},${0.16 + rnd() * 0.34})`;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
      const bv = Math.round(clamp(128 + (rnd() - 0.5) * 200, 30, 240));
      gb.fillStyle = `rgb(${bv},${bv},${bv})`;
      gb.beginPath(); gb.arc(x, y, r * 0.9, 0, 7); gb.fill();
    }
    const map = new THREE.CanvasTexture(c);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    const bump = new THREE.CanvasTexture(b);
    bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
    return { map, bump };
  }

  /* --- 实例专用材质（steel / 烤漆砝码材质与主场景共用） --- */
  const instMats = {
    blade: new THREE.MeshStandardMaterial({ color: '#eef3f8', roughness: 0.30, metalness: 0.82, envMapIntensity: 1.5 }),
    handle: new THREE.MeshStandardMaterial({ color: '#4a3627', roughness: 0.56, metalness: 0.04 }),
    strap: new THREE.MeshStandardMaterial({ color: '#2f4f7a', roughness: 0.74, metalness: 0.02 }),
    board: new THREE.MeshStandardMaterial({ color: '#e8b93a', roughness: 0.42, metalness: 0.06 }),
    sole: new THREE.MeshStandardMaterial({ color: '#22262d', roughness: 0.46, metalness: 0.08 }),
    boot: new THREE.MeshStandardMaterial({ color: '#7c2d3a', roughness: 0.62, metalness: 0.02 })
  };
  const CONTACT_COLOR = { small: 0xf87171, big: 0x38bdf8 };
  /* 接触面高亮片的厚度：压头「坐在」这片薄片上，所以压头整体比凹陷底部高 CONTACT_T */
  const CONTACT_T = 0.22;

  /* --- 梯形棱柱：截面在 xy（下宽 wb、上宽 wt、高 h），沿 z 挤出 L --- */
  function trapPrism(wb, wt, h, L) {
    const s = new THREE.Shape();
    s.moveTo(-wb / 2, 0); s.lineTo(wb / 2, 0); s.lineTo(wt / 2, h); s.lineTo(-wt / 2, h); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: L, bevelEnabled: false });
    g.translate(0, 0, -L / 2);
    return g;
  }

  /* --- 四种压头造型。约定：压头局部 y = 0 就是它的接触平面。 --- */
  function buildPin(tip, w) {
    const g = new THREE.Group();
    if (tip) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(w / 2, w * 2.8, 26), steelMat);
      cone.rotation.x = Math.PI;                       // 尖端朝下，落在 y = 0
      cone.position.y = w * 1.4;
      g.add(cone);
      const rs = clamp(w * 0.5, 0.11, 0.6);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(rs, rs, 6.2, 22), steelMat);
      shaft.position.y = w * 2.8 + 3.1;
      g.add(shaft);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.85, 1.85, 0.65, 30), enamelCapMat);
      cap.position.y = w * 2.8 + 6.5;
      g.add(cap);
    } else {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, 0.65, 44), enamelCapMat);
      cap.position.y = 0.325;
      g.add(cap);
      const rs = clamp(w * 0.09, 0.3, 0.7);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(rs, rs, 6.4, 22), steelMat);
      shaft.position.y = 3.85;
      g.add(shaft);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(rs, 1.5, 22), steelMat);
      cone.position.y = 7.8;
      g.add(cone);
    }
    return g;
  }

  function buildKnife(edge, w) {
    const g = new THREE.Group();
    const L = 10, H = edge ? 5.0 : 3.4;
    const wb = w;                                       // 下缘 = 接触面
    const wt = edge ? Math.max(2.3, w * 0.9) : w * 0.86;  // 刃口薄、刀背厚，都按 w 缩放
    g.add(new THREE.Mesh(trapPrism(wb, wt, H, L), instMats.blade));
    const hd = new THREE.Mesh(new THREE.BoxGeometry(2.7, 1.5, 6.2), instMats.handle);
    hd.position.set(0, H * 0.62, L / 2 + 2.6);
    g.add(hd);
    return g;
  }

  function buildStrap(wide, w) {
    const g = new THREE.Group();
    const L = 11;
    const band = new THREE.Mesh(new THREE.BoxGeometry(w, 0.45, L), instMats.strap);
    band.position.y = 0.225;
    g.add(band);
    const arc = new THREE.Mesh(
      new THREE.TorusGeometry(3.4, Math.max(0.3, Math.min(w, 4) * 0.11), 10, 26, Math.PI),
      instMats.strap);
    arc.rotation.y = Math.PI / 2;
    arc.position.set(0, 0.225, -L / 2 + 0.4);
    g.add(arc);
    const sh = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 6.4, 20), instMats.boot);
    sh.rotation.z = Math.PI / 2;
    sh.position.set(0, 4.5, -L / 2 + 3.0);
    g.add(sh);
    return g;
  }

  function buildBoot(heel, w) {
    const g = new THREE.Group();
    if (heel) {
      const h = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w * 0.44, 4.2, 26), instMats.sole);
      h.position.y = 2.1;
      g.add(h);
      const sole = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.7, 7.6), instMats.sole);
      sole.position.set(0, 4.55, 1.1);
      g.add(sole);
      const upper = new THREE.Mesh(new THREE.BoxGeometry(3.1, 2.7, 5.2), instMats.boot);
      upper.position.set(0, 6.25, 1.5);
      g.add(upper);
    } else {
      const L = 14;
      const bd = new THREE.Mesh(new THREE.BoxGeometry(w, 0.55, L), instMats.board);
      bd.position.y = 0.275;
      g.add(bd);
      const tip = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, 3.2), instMats.board);
      tip.position.set(0, 1.05, -L / 2 - 0.9);
      tip.rotation.x = -0.52;
      g.add(tip);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(3.7, 3.0, 4.8), instMats.boot);
      boot.position.set(0, 2.05, 1.0);
      g.add(boot);
    }
    return g;
  }

  /* --- 第二套渲染器：独立画布。已在本机无头环境验证两上下文可共存。 --- */
  const instCanvas = $('instCanvas');
  const instStage = $('instStage');
  const instBars = $('instBars');
  const instState = { id: 'pin' };
  let instRenderer = null, instScene = null, instCamera = null;
  let instReady = false, instDirty = true, instFrames = 0;
  const requestInstRender = () => { instDirty = true; };
  const instPads = {}, instPressers = {}, instArrows = {};

  const PAD_W = 20, PAD_D = 16, PAD_H = 4.4, PAD_X = 11.5;
  const PAD_SEG_X = 68, PAD_SEG_Z = 54;
  /* 第二套场景的内存预算刻意压得很低：本机常年 swap 打满，
     两个 WebGL 上下文 + 2048² 阴影贴图会把进程直接 OOM 掉（exit 137）。
     这里用 1024² 阴影 + 粗网格，观感几乎不变、峰值内存降一个档。 */
  const INST_SHADOWS = true, INST_SHADOW_SIZE = 1024;

  function buildInstScene() {
    if (!instCanvas || !instStage) return false;
    try {
      instRenderer = new THREE.WebGLRenderer({ canvas: instCanvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch (_) {
      const n = document.createElement('div');
      n.className = 'no-webgl';
      n.textContent = '当前浏览器无法启动三维渲染，生活实例场景不可用。请开启硬件加速后重试。';
      instStage.appendChild(n);
      return false;
    }
    instRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    instRenderer.outputColorSpace = THREE.SRGBColorSpace;
    instRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    instRenderer.toneMappingExposure = 0.9;
    instRenderer.shadowMap.enabled = INST_SHADOWS;
    instRenderer.shadowMap.type = THREE.PCFSoftShadowMap;

    instScene = new THREE.Scene();
    instScene.background = new THREE.Color('#d7dbe0');
    instScene.fog = new THREE.Fog('#cfd4da', 190, 420);
    instScene.environment = studioEnv(instRenderer);   // 每个上下文各一份，不能共用

    instCamera = new THREE.PerspectiveCamera(30, 1, 1, 900);

    instScene.add(new THREE.HemisphereLight('#e9f1fa', '#4a4238', 0.44));
    instScene.add(new THREE.AmbientLight('#ffffff', 0.10));
    const k2 = new THREE.DirectionalLight('#fff2dd', 1.9);
    k2.position.set(-38, 58, 36);
    k2.castShadow = INST_SHADOWS;
    k2.shadow.mapSize.set(INST_SHADOW_SIZE, INST_SHADOW_SIZE);
    k2.shadow.camera.left = -34; k2.shadow.camera.right = 34;
    k2.shadow.camera.top = 30; k2.shadow.camera.bottom = -30;
    k2.shadow.camera.near = 20; k2.shadow.camera.far = 200;
    k2.shadow.bias = -0.0006; k2.shadow.normalBias = 0.03;
    instScene.add(k2); instScene.add(k2.target);
    k2.target.position.set(0, 2, 0);
    const f2 = new THREE.DirectionalLight('#dce9f8', 0.6);
    f2.position.set(46, 28, 22);
    instScene.add(f2);

    const bd = new THREE.Mesh(
      new THREE.PlaneGeometry(560, 400),
      new THREE.MeshBasicMaterial({ map: makeBackdropMap(), fog: false })
    );
    bd.position.set(0, 130, -120);
    instScene.add(bd);

    const benchMap2 = makeBenchMap();
    sharpen(benchMap2);
    const bench2 = new THREE.Mesh(
      new THREE.BoxGeometry(300, 7, 200),
      new THREE.MeshStandardMaterial({ map: benchMap2, bumpMap: benchMap2, bumpScale: 0.05, roughness: 0.74, metalness: 0.02 })
    );
    bench2.position.set(0, -PAD_H - 3.5, 0);
    bench2.receiveShadow = true;
    instScene.add(bench2);

    const gm = makeGroundMap();
    gm.map.repeat.set(3.0, 2.4); gm.bump.repeat.set(3.0, 2.4);
    sharpen(gm.map); sharpen(gm.bump);
    const groundSideMat = new THREE.MeshStandardMaterial({ map: gm.map, bumpMap: gm.bump, bumpScale: 0.14, roughness: 0.94, metalness: 0 });
    /* 顶面单独一份材质：开 vertexColors，用来做「陷得越深越暗」的顶点遮蔽，
       否则斜光下压痕几乎读不出来（与主实验 deformSurface 同一套做法）。 */
    const groundTopMat = new THREE.MeshStandardMaterial({ map: gm.map, bumpMap: gm.bump, bumpScale: 0.14, roughness: 0.94, metalness: 0, vertexColors: true });
    const sideGeo2 = (() => {
      const g = new THREE.BoxGeometry(PAD_W, PAD_H, PAD_D);
      const idx = g.getIndex(), keep = [];
      for (let i = 0; i < idx.count; i++) if (i < 12 || i >= 18) keep.push(idx.getX(i));
      g.setIndex(keep);
      return g;
    })();

    for (const side of ['small', 'big']) {
      const sx = side === 'small' ? -PAD_X : PAD_X;
      const box = new THREE.Mesh(sideGeo2, groundSideMat);
      box.position.set(sx, -PAD_H / 2, 0);
      box.castShadow = true; box.receiveShadow = true;
      instScene.add(box);

      const geo = new THREE.PlaneGeometry(PAD_W, PAD_D, PAD_SEG_X, PAD_SEG_Z);
      geo.rotateX(-Math.PI / 2);
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3).fill(1), 3));
      const mesh = new THREE.Mesh(geo, groundTopMat);
      mesh.position.set(sx, 0, 0);
      mesh.receiveShadow = true;
      instScene.add(mesh);
      instPads[side] = { geo, mesh, x: sx };
    }

    /* 压头：8 个一次建好，切换实例只改 visible 与接触面尺寸 */
    const CONTACT_MAT = {
      small: new THREE.MeshStandardMaterial({ color: CONTACT_COLOR.small, roughness: 0.5, metalness: 0.05, transparent: true, opacity: 0.55 }),
      big: new THREE.MeshStandardMaterial({ color: CONTACT_COLOR.big, roughness: 0.5, metalness: 0.05, transparent: true, opacity: 0.55 })
    };
    for (const ins of INSTANCES) {
      const dv = INST_DERIVED[ins.id];
      for (const side of ['small', 'big']) {
        const w = side === 'small' ? dv.wSmall : dv.wBig;
        let g;
        if (ins.id === 'pin') g = buildPin(side === 'small', w);
        else if (ins.id === 'knife') g = buildKnife(side === 'small', w);
        else if (ins.id === 'bag') g = buildStrap(side === 'big', w);
        else g = buildBoot(side === 'small', w);
        g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

        // 接触面高亮块：尺寸就是 w × footD（细带 / 刀刃 / 滑雪板沿 z 更长），
        // 既标出“受力面积”落在哪儿，也是自检唯一可量的真实几何（不是意图值）
        const footD = (side === 'small' ? ins.low.footD : ins.high.footD) || w;
        const patch = new THREE.Mesh(new THREE.BoxGeometry(w, CONTACT_T, footD), CONTACT_MAT[side]);
        patch.position.y = -CONTACT_T / 2;
        patch.userData.contact = true;
        patch.castShadow = false; patch.receiveShadow = false;
        g.add(patch);

        g.position.set(side === 'small' ? -PAD_X : PAD_X, 0, 0);
        g.visible = false;
        instScene.add(g);
        instPressers[side + ':' + ins.id] = g;
      }
    }

    /* 压力箭头：两侧等长（同一个压力 F），长度不随实例变 */
    for (const side of ['small', 'big']) {
      const sx = side === 'small' ? -PAD_X : PAD_X;
      const a = new THREE.ArrowHelper(new THREE.Vector3(0, -1, 0), new THREE.Vector3(sx, 0, 0), 7.0, 0xe11d48, 2.3, 1.35);
      instScene.add(a);
      instArrows[side] = a;
    }

    instReady = true;
    return true;
  }

  /* --- 软垫顶面下陷：与主实验 deformHeight 同族（平底 + 边缘堆料） --- */
  function padDent(x, z, w, d, round) {
    if (d <= 1e-6) return 0;
    const r = Math.max(w / 2, 1e-3);
    const t = round ? Math.hypot(x, z) / r : Math.max(Math.abs(x), Math.abs(z)) / r;
    let off = -d * (1 - smoothstep(0.86, 1.62, t));
    const rim = Math.max(0, 1 - Math.abs(t - 1.95) / 0.95);
    off += d * 0.17 * rim * rim;
    return off;
  }
  const padBase = (x, z) => 0.045 * Math.sin(x * 0.42) * Math.cos(z * 0.5);

  function deformInstPad(side, w, d, round) {
    const p = instPads[side];
    if (!p) return;
    const pos = p.geo.attributes.position;
    const col = p.geo.attributes.color;
    const inv = d > 1e-6 ? 1 / d : 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const off = padDent(x, z, w, d, round);
      pos.setY(i, padBase(x, z) + off);
      // 顶点环境光遮蔽：陷得越深越暗、边缘堆料略亮，让压痕在斜光下也读得出来
      const dn = clamp(-off * inv, 0, 1);
      const s = clamp(1 - 0.55 * Math.pow(dn, 0.65), 0.34, 1.06);
      col.setXYZ(i, s, s, s);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    p.geo.computeVertexNormals();
    p.geo.computeBoundingSphere();
  }

  /* --- 数值格式 --- */
  const fmtAreaI = (S) => {
    const mm2 = S * 1e6;
    if (mm2 < 100) return `${mm2.toFixed(2)} mm²`;
    if (S < 1e-2) return `${(S * 1e4).toFixed(2)} cm²`;
    return `${(S * 1e4).toFixed(0)} cm²`;
  };
  const fmtPressI = (p) => {
    if (p < 1e4) return `${(p / 1000).toFixed(2)} kPa`;
    if (p < 1e6) return `${(p / 1000).toFixed(0)} kPa`;
    if (p < 1e9) return `${(p / 1e6).toFixed(1)} MPa`;
    return `${fmtSci(p, 2)} Pa`;
  };

  /* --- 对数条形图（横轴 log10，跨实例固定量程，两行互为镜像） --- */
  function drawInstBars(ins, dv) {
    if (!instBars) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = instBars.clientWidth || 300, H = instBars.clientHeight || 116;
    if (instBars.width !== Math.round(W * dpr) || instBars.height !== Math.round(H * dpr)) {
      instBars.width = Math.round(W * dpr); instBars.height = Math.round(H * dpr);
    }
    const g = instBars.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(9,22,38,0.72)';
    g.fillRect(0, 0, W, H);

    const padL = 40, padR = 8, padT = 8, rowH = (H - padT - 8) / 2;
    const trackW = W - padL - padR;
    const rows = [
      { key: 'S', label: '受力面积', lo: LOG_S0, hi: LOG_S1, a: ins.low.S, b: ins.high.S, unit: fmtAreaI },
      { key: 'p', label: '压强', lo: LOG_P0, hi: LOG_P1, a: dv.pSmall, b: dv.pBig, unit: fmtPressI }
    ];
    g.font = '9px "Helvetica Neue", Arial, sans-serif';
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const yTop = padT + r * rowH;
      g.fillStyle = 'rgba(150,180,205,0.9)';
      g.textAlign = 'left'; g.textBaseline = 'top';
      g.fillText(row.label, 4, yTop + 2);
      const span = row.hi - row.lo;
      const len = (v) => clamp((Math.log10(v) - row.lo) / span, 0, 1) * trackW;
      const barH = rowH * 0.30;
      for (const [k, v, col, name] of [[0, row.a, '#f87171', '左'], [1, row.b, '#38bdf8', '右']]) {
        const y = yTop + 4 + k * (barH + 3);
        g.fillStyle = 'rgba(148,178,205,0.16)';
        g.fillRect(padL, y, trackW, barH);
        g.fillStyle = col;
        g.fillRect(padL, y, Math.max(1.5, len(v)), barH);
        g.fillStyle = 'rgba(226,240,250,0.95)';
        g.textBaseline = 'middle';
        g.fillText(row.unit(v), padL + len(v) + 4 > W - padR - 46 ? padL + 4 : padL + len(v) + 4, y + barH / 2);
        g.textBaseline = 'top';
      }
      g.fillStyle = 'rgba(140,170,195,0.75)';
      g.textAlign = 'right'; g.textBaseline = 'bottom';
      g.fillText(`10${supNum(row.lo)} ~ 10${supNum(row.hi)}`, W - padR, yTop + rowH - 1);
      g.textAlign = 'left';
    }
  }

  /* --- 刷新实例面板 --- */
  const instEls = {
    tagL: $('instTagL'), tagR: $('instTagR'),
    labL: $('iLabL'), labR: $('iLabR'),
    fL: $('iFL'), fR: $('iFR'),
    sL: $('iSL'), sR: $('iSR'),
    pL: $('iPL'), pR: $('iPR'),
    dL: $('iDL'), dR: $('iDR'),
    q: $('instQ'), a: $('instA'), verdict: $('instVerdict'),
    scale: $('instScale'), cards: $('instCards')
  };

  function refreshInst() {
    const ins = INSTANCES.find((i) => i.id === instState.id) || INSTANCES[0];
    const dv = INST_DERIVED[ins.id];

    for (const side of ['small', 'big']) {
      const d = side === 'small' ? dv.dSmall : dv.dBig;
      const w = side === 'small' ? dv.wSmall : dv.wBig;
      deformInstPad(side, w, d, ins.round);
    }
    for (const ins2 of INSTANCES) {
      for (const side of ['small', 'big']) {
        instPressers[side + ':' + ins2.id].visible = ins2.id === ins.id;
      }
    }
    for (const side of ['small', 'big']) {
      const d = side === 'small' ? dv.dSmall : dv.dBig;
      const g = instPressers[side + ':' + ins.id];
      g.position.y = -d + CONTACT_T;                   // 压头坐在接触面薄片上
      // 箭头从压头顶上方向下指；长度两侧恒定（同一个压力），位置随压头高度走但有上限
      const box = new THREE.Box3().setFromObject(g);
      const topY = Math.max(box.max.y, 6);
      const a = instArrows[side];
      a.position.set(g.position.x, Math.min(topY + 4.2, 12.2), 0);
      a.setLength(3.8, 1.6, 1.0);
    }

    if (instEls.tagL) instEls.tagL.textContent = ins.low.label;
    if (instEls.tagR) instEls.tagR.textContent = ins.high.label;
    instEls.labL.textContent = ins.low.label;
    instEls.labR.textContent = ins.high.label;
    instEls.fL.textContent = `${ins.F} N`;
    instEls.fR.textContent = `${ins.F} N`;
    instEls.sL.textContent = fmtAreaI(dv.SSmall);
    instEls.sR.textContent = fmtAreaI(dv.SBig);
    instEls.pL.textContent = fmtPressI(dv.pSmall);
    instEls.pR.textContent = fmtPressI(dv.pBig);
    instEls.dL.textContent = `${(dv.dSmall * 10).toFixed(2)} mm`;
    instEls.dR.textContent = `${(dv.dBig * 10).toFixed(2)} mm`;
    instEls.q.textContent = ins.q;
    instEls.a.textContent = ins.a;
    instEls.verdict.innerHTML =
      `同一个压力 <b>${ins.F} N</b>：右边受力面积是左边的 <b>${dv.ratio.toFixed(dv.ratio < 10 ? 2 : 0)} 倍</b>，` +
      `压强就只有左边的 <b>1/${dv.ratio.toFixed(dv.ratio < 10 ? 2 : 0)}</b>，下陷深度从 ` +
      `<b>${(dv.dSmall * 10).toFixed(2)} mm</b> 变成 <b>${(dv.dBig * 10).toFixed(2)} mm</b>。`;
    if (instEls.scale) {
      instEls.scale.textContent =
        `3D 中接触面按真实线性尺寸比 √${dv.ratio.toFixed(dv.ratio < 10 ? 2 : 0)} ≈ ${dv.k.toFixed(1)} 倍绘制` +
        (dv.wSmall <= INST_SMALL_MIN + 1e-9 ? `（左边已缩到显示下限 ${INST_SMALL_MIN} cm）` : '') +
        `，左侧接触面 ${dv.wSmall.toFixed(2)} cm、右侧 ${dv.wBig.toFixed(2)} cm。`;
    }

    // 卡片高亮
    if (instEls.cards) {
      Array.from(instEls.cards.querySelectorAll('[data-inst]')).forEach((b) => {
        b.classList.toggle('active', b.dataset.inst === ins.id);
      });
    }
    drawInstBars(ins, dv);
    requestInstRender();
  }

  function setInstance(id) {
    if (!INSTANCES.some((i) => i.id === id)) return;
    instState.id = id;
    refreshInst();
  }

  /* --- 实例面板交互 --- */
  if (instEls.cards) {
    instEls.cards.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-inst]');
      if (btn) setInstance(btn.dataset.inst);
    });
  }

  /* --- 实例场景相机与尺寸 --- */
  const instView = { yaw: -0.14, pitch: 0.37, zoom: 1 };
  /* 相机距离按画布宽高比自动求：竖屏 / 窄屏时自动退远，保证左右两块软垫都在画面内
     （不写死距离 —— 写死会让窄屏把两侧裁掉，那正是本页最要紧的对比）。 */
  const SCENE_HALF_W = PAD_X + PAD_W / 2 + 2.5;
  const SCENE_HALF_H = 10.5;
  function fitInstDist() {
    if (!instCamera) return 46;
    const vHalf = Math.tan(instCamera.fov * Math.PI / 360);
    const aspect = Math.max(instCamera.aspect || 1, 0.30);
    return Math.min(150, Math.max(SCENE_HALF_W / (vHalf * aspect), SCENE_HALF_H / vHalf));
  }
  function updateInstCamera() {
    if (!instCamera) return;
    const t = new THREE.Vector3(0, 3.0, 0);
    const d = fitInstDist() * instView.zoom;
    const cp = Math.cos(instView.pitch), sp = Math.sin(instView.pitch);
    instCamera.position.set(
      t.x + d * cp * Math.sin(instView.yaw),
      t.y + d * sp,
      t.z + d * cp * Math.cos(instView.yaw)
    );
    instCamera.lookAt(t);
    requestInstRender();
  }

  function resizeInst() {
    if (!instReady || !instStage) return;
    const w = instStage.clientWidth, h = instStage.clientHeight;
    if (!w || !h) return;
    instRenderer.setSize(w, h, false);
    instCamera.aspect = w / h;
    instCamera.updateProjectionMatrix();
    updateInstCamera();                                 // 距离随宽高比重算
    requestInstRender();
  }

  /* --- 实例场景环绕交互 --- */
  if (instCanvas) {
    let idrag = false, ilx = 0, ily = 0;
    instCanvas.style.cursor = 'grab';
    instCanvas.addEventListener('pointerdown', (e) => {
      idrag = true; ilx = e.clientX; ily = e.clientY;
      try { instCanvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      instCanvas.style.cursor = 'grabbing';
    });
    instCanvas.addEventListener('pointermove', (e) => {
      if (!idrag) return;
      const dx = (e.clientX - ilx) / Math.max(instCanvas.clientWidth, 1);
      const dy = (e.clientY - ily) / Math.max(instCanvas.clientHeight, 1);
      ilx = e.clientX; ily = e.clientY;
      instView.yaw -= dx * 2.6;
      instView.pitch = clamp(instView.pitch + dy * 2.0, 0.02, 1.20);
      updateInstCamera();
    });
    const iend = (e) => {
      idrag = false;
      instCanvas.style.cursor = 'grab';
      try { instCanvas.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    };
    instCanvas.addEventListener('pointerup', iend);
    instCanvas.addEventListener('pointercancel', iend);
    instCanvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      instView.zoom = clamp(instView.zoom * (1 + Math.sign(e.deltaY) * 0.08), 0.45, 3.0);
      updateInstCamera();
    }, { passive: false });
  }

  /* --- 实例场景自检取样：一律读【真实画出去的几何】，不重算意图值 --- */
  function instPadSample(side, x, z) {
    const p = instPads[side];
    if (!p) return NaN;
    const pos = p.geo.attributes.position;
    let best = Infinity, by = NaN;
    for (let i = 0; i < pos.count; i++) {
      const dx = pos.getX(i) - x, dz = pos.getZ(i) - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < best) { best = d2; by = pos.getY(i); }
    }
    return by;
  }
  function instContactBox(side) {
    const g = instPressers[side + ':' + instState.id];
    if (!g) return null;
    let mesh = null;
    g.traverse((o) => { if (o.isMesh && o.userData && o.userData.contact) mesh = o; });
    if (!mesh) return null;
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    return { w: bb.max.x - bb.min.x, d: bb.max.z - bb.min.z, y: g.position.y };
  }

  /* --- 画面快照（自检用）：WebGL 画布在合成后会被清空，所以必须在【render 的同一个 rAF】
     里把画面搬到一张 2D 画布上，之后再读像素才可靠。 --- */
  const instShots = {};
  let instShotReq = null;
  const SHOT_MAX_W = 420;                 // 快照降采样上限：整张读 ImageData 在本机太贵
  function takeInstShot(key) {
    const cv = instCanvas;
    const sc = Math.min(1, SHOT_MAX_W / Math.max(cv.clientWidth, 1));
    const w = Math.max(2, Math.round(cv.clientWidth * sc));
    const h = Math.max(2, Math.round(cv.clientHeight * sc));
    let c2 = instShots[key];
    if (!c2 || c2.width !== w || c2.height !== h) { c2 = newCanvas(w, h); instShots[key] = c2; }
    const g = c2.getContext('2d');
    g.clearRect(0, 0, w, h);
    g.drawImage(cv, 0, 0, w, h);
    return true;
  }
  function shotStats(key, x0, y0, x1, y1, thr) {
    const c2 = instShots[key];
    if (!c2) return { dark: -1, nonBg: -1, mean: -1, n: 0 };
    const cv = instCanvas;
    const sc = c2.width / Math.max(cv.clientWidth, 1);
    const X0 = Math.max(0, Math.round(x0 * sc)), X1 = Math.min(c2.width, Math.round(x1 * sc));
    const Y0 = Math.max(0, Math.round(y0 * sc)), Y1 = Math.min(c2.height, Math.round(y1 * sc));
    if (X1 - X0 < 2 || Y1 - Y0 < 2) return { dark: -1, nonBg: -1, mean: -1, n: 0 };
    const d = c2.getContext('2d').getImageData(X0, Y0, X1 - X0, Y1 - Y0).data;
    let dark = 0, nonBg = 0, tot = 0, sum = 0;
    for (let i = 0; i < d.length; i += 4) {
      tot++;
      const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      const sat = Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
      sum += lum;
      if (lum < thr) dark++;
      if (lum * 255 < 178 || sat > 22) nonBg++;
    }
    return { dark: dark / tot, nonBg: nonBg / tot, mean: sum / tot, n: tot };
  }
  function shotDiff(a, b) {
    const A = instShots[a], B = instShots[b];
    if (!A || !B || A.width !== B.width || A.height !== B.height) return -1;
    const da = A.getContext('2d').getImageData(0, 0, A.width, A.height).data;
    const db = B.getContext('2d').getImageData(0, 0, B.width, B.height).data;
    let n = 0;
    const tot = da.length / 4;
    for (let i = 0; i < da.length; i += 4) {
      if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 30) n++;
    }
    return n / tot;
  }

  /* ==========================================================================
     十二、启动
     ========================================================================== */
  canvas.style.cursor = 'grab';
  refresh();
  updateCamera();

  const ro = new ResizeObserver(() => { resize(); drawProfile(computeState()); });
  ro.observe(stage);
  window.addEventListener('resize', () => { resize(); drawProfile(computeState()); });
  resize();

  /* --- 生活实例场景启动（失败不拖累主实验） --- */
  if (buildInstScene()) {
    refreshInst();
    updateInstCamera();
    resizeInst();
    const ro2 = new ResizeObserver(() => { resizeInst(); });
    ro2.observe(instStage);
    window.addEventListener('resize', () => { resizeInst(); });
  } else {
    instReady = false;
  }

  (function loop() {
    if (dirty) {
      renderer.render(scene, camera);
      dirty = false;
    }
    if (instReady && instDirty) {
      instRenderer.render(instScene, instCamera);
      instDirty = false;
      instFrames++;
      if (instShotReq) { takeInstShot(instShotReq); instShotReq = null; }
    }
    requestAnimationFrame(loop);
  })();

  // 供无头验收脚本读取的内部状态
  window.__pressLab = {
    state, view, computeState, surfaceY, MATERIALS, DEBUG_TEX,
    setWeights, refresh, updateCamera, VIEWS,
    set(mut) { Object.assign(state, mut); refresh(); },
    setToggle(k, v) { toggles[k] = !!v; if (k === 'arrow') arrow.visible = toggles.arrow; if (k === 'refs') refGroup.visible = toggles.refs; requestRender(); },
    camera, renderer, scene,
    inst: {
      ready: () => instReady,
      list: () => INSTANCES.map((i) => {
        const d = INST_DERIVED[i.id];
        return {
          id: i.id, name: i.name, F: i.F, round: !!i.round,
          lowLabel: i.low.label, highLabel: i.high.label,
          lowDesc: i.low.desc, highDesc: i.high.desc,
          SSmall: d.SSmall, SBig: d.SBig,
          pSmall: d.pSmall, pBig: d.pBig,
          dSmall: d.dSmall, dBig: d.dBig,
          wSmall: d.wSmall, wBig: d.wBig, k: d.k, ratio: d.ratio,
          footDSmall: d.footDSmall, footDBig: d.footDBig,
          sigma: i.sigma
        };
      }),
      current: () => instState.id,
      set: (id) => setInstance(id),
      refresh: () => refreshInst(),
      frames: () => instFrames,
      dirty: () => instDirty,
      capture: (key) => { instShotReq = key; requestInstRender(); return true; },
      shotStats: (key, x0, y0, x1, y1, thr) => shotStats(key, x0, y0, x1, y1, thr),
      shotDiff: (a, b) => shotDiff(a, b),
      shotSize: (key) => (instShots[key] ? { w: instShots[key].width, h: instShots[key].height } : null),
      contact: (side) => instContactBox(side),
      pressers: () => {
        const out = {};
        for (const k in instPressers) out[k] = instPressers[k].visible;
        return out;
      },
      padSample: (side, x, z) => instPadSample(side, x, z),
      padDent: (x, z, w, d, round) => padDent(x, z, w, d, round),
      dentDepth: (p, sigma, dmax) => dentDepth(p, sigma, dmax),
      widths: (Ss, Sb) => instWidths(Ss, Sb),
      constants: () => ({ INST_BIG_W, INST_SMALL_MIN, INST_DMAX, CONTACT_T, PAD_W, PAD_D, PAD_H, PAD_X, PAD_SEG_X, PAD_SEG_Z }),
      padBox: (side) => {
        const p = instPads[side];
        if (!p) return null;
        p.geo.computeBoundingBox();
        const bb = p.geo.boundingBox;
        return { w: bb.max.x - bb.min.x, d: bb.max.z - bb.min.z, x: p.x };
      },
      presserTop: (side) => {
        const g = instPressers[side + ':' + instState.id];
        if (!g) return NaN;
        return new THREE.Box3().setFromObject(g).max.y;
      },
      arrowLen: (side) => (instArrows[side] ? instArrows[side].position.y : NaN),
      // 箭头【实际画出去】的尖端 y（读真实几何，不是「打算用的长度」）
      arrowTip: (side) => {
        const a = instArrows[side];
        if (!a) return NaN;
        return new THREE.Box3().setFromObject(a).min.y;
      },
      camera: () => instCamera,
      view: instView,
      setView: (v) => { Object.assign(instView, v); updateInstCamera(); },
      resize: () => resizeInst(),
      scene: () => instScene,
      renderer: () => instRenderer,
      // 两个上下文各自的 environment —— 用来钉住「没有退化成共用同一个对象」
      envMaps: () => ({ main: scene.environment, inst: instScene.environment }),
      /* 顶点遮蔽 AO 的【实际取值】—— 读真正上传给 GPU 的 color 属性，
         不是「打算用的系数」（拿像素猜会把几何/光照的差异误当成 AO）。 */
      aoStats: (side) => {
        const p = instPads[side];
        if (!p || !p.geo.attributes.color) return null;
        const pos = p.geo.attributes.position, col = p.geo.attributes.color;
        let mn = Infinity, mx = -Infinity, mnI = -1, nDark = 0;
        for (let i = 0; i < col.count; i++) {
          const v = col.getX(i);
          if (v < mn) { mn = v; mnI = i; }
          if (v > mx) mx = v;
          if (v <= 0.9) nDark++;
        }
        return {
          min: mn, max: mx, n: col.count, darkFrac: nDark / col.count,
          atMin: { x: pos.getX(mnI), z: pos.getZ(mnI) }
        };
      }
    }
  };
})();
