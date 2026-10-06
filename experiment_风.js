import * as THREE from './assets/optics-three.min.js';

/* ============================================================================
   风的形成 —— 三维写实实验台（对流箱 / 海陆风）
   ---------------------------------------------------------------------------
   世界坐标单位：厘米（cm），y 轴向上，台面为 y = 0，环流单元以 x = 0 居中。
   器材：玻璃风箱（60 × 34 × 30）、箱顶两支玻璃短管、电热板、冰块、示踪烟。
   物理：
     ① 等压气体 ρ ∝ 1/T：rhoAir(T) = ρ₀ · T₀/(T+T₀)，ρ₀ = 1.293 kg/m³（0 ℃ 干空气）。
     ② 驱动压强 Δp = Δρ · g · h（冷侧气柱底部压强更高，把空气沿箱底压向热侧）；
        环流速度 v = √(2Δp/ρ̄)。
     ③ 环流场用单胞流函数 ψ = sin(πξ)·sin(πη) 构造 —— 【数学上严格无散度】，
        所以示踪烟永远沿一条闭合流线走：既不会凭空堆积、也不会凭空消失，
        「空气走一个闭环」这句话是可以被数值证伪的，不是画上去的。
     ④ 哪一侧上升由【两侧温度谁高】推导（hotRight = 右侧更热），不是写死的方向 ——
        海陆风白天/夜晚风向相反，靠的就是这一条推导自动翻转。
   ========================================================================== */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  /* ============================ 一、世界尺寸 ============================ */
  const BOX_W = 60, BOX_D = 34, BOX_H = 30;          // 玻璃风箱
  const CH_R = 5.5, CH_H = 16;                       // 玻璃短管
  const CH_X = BOX_W / 2 - CH_R;                     // ±24.5（贴着箱的两端）
  const CH_Y0 = BOX_H, CH_Y1 = BOX_H + CH_H;         // 30 → 46
  /* ★ 环流单元比烟囱再高 10 cm：真实的环流并不止于管口 —— 空气从热管口冒出去、
     在管口上方绕回来、再被吸进冷管口。把单元高度留出这一截，烟才画得出这个「回头」，
     否则粒子会在管口上方被卡住（η→1 时竖直速度趋 0）。 */
  const CELL_H = CH_Y1 + 10;                         // 56
  const HEAT_H = 3.4, COLD_H = 4.8;

  /* 海陆风（示意尺度，与对流箱共用同一个环流模型）。
     ★ 海面与陆地都要【远远铺出取景范围】：只铺到 ±170 时，画面里能看到地的边
       —— 海平面尽头露出一条硬边，看着像一块浮在空中的板子，不是「海」。 */
  const SEA_HALF = 170, LAND_Y = 4;
  const SEA_SPAN = 460, SEA_DEPTH = 3000;      // 各自沿 x / z 铺开的长度
  const SEA_CELL_W = 200, SEA_CELL_H = 76;

  /* ============================ 二、物理 ============================ */
  const RHO0 = 1.293;        // kg/m³，0 ℃ 干空气（教材值）
  const T0K = 273.15;
  const GRAV = 9.8;
  const AMB = 20;            // 室温 ℃
  const HEAT_SPAN = 40;      // 加热满档 ⇒ 热侧 20 + 40 = 60 ℃
  const COOL_SPAN = 30;      // 冷却满档 ⇒ 冷侧 20 − 30 = −10 ℃
  const SEA_T = { day: 22, night: 20 };
  const SEA_DT_MAX = 13;     // 海陆温差满档 13 ℃
  /* 有效高度（m）：驱动压强 = Δρ·g·h 里那段「密度差起作用的气柱高度」。
     对流箱取箱高 0.30 m（密度差在箱内竖直方向上起作用）；
     海陆风取环流垂直尺度的一部分 35 m —— 这是一个【模型参数】，页面里如实标注。 */
  const COL_H_M = { box: 0.30, sea: 35 };

  const rhoAir = (tC) => RHO0 * T0K / (tC + T0K);

  /* 两侧温度：左（x<0）与右（x>0）。对流箱：左 = 冰块、右 = 电热板。
     海陆风：左 = 海面、右 = 陆地。 */
  function sideTemps() {
    if (state.scene === 'sea') {
      const base = state.seaNight ? SEA_T.night : SEA_T.day;
      const land = state.seaNight
        ? base - state.seaDT * SEA_DT_MAX
        : base + state.seaDT * SEA_DT_MAX;
      return { left: base, right: land };
    }
    return { left: AMB - state.cool * COOL_SPAN, right: AMB + state.heat * HEAT_SPAN };
  }
  /* ★ 方向是【推导】出来的，不是写死的：哪一侧更热，哪一侧就上升。
     海陆风昼夜风向相反，全靠这一行自动翻转；把它写成 true 就再也测不出夜晚。 */
  const hotRight = () => { const s = sideTemps(); return s.right > s.left; };
  const dT = () => { const s = sideTemps(); return Math.abs(s.right - s.left); };
  const dRho = () => { const s = sideTemps(); return Math.abs(rhoAir(s.left) - rhoAir(s.right)); };
  const driveDP = () => dRho() * GRAV * COL_H_M[state.scene];
  function flowSpeed() {
    const dp = driveDP();
    if (!(dp > 0)) return 0;
    const s = sideTemps();
    const rm = (rhoAir(s.left) + rhoAir(s.right)) / 2;
    return Math.sqrt(2 * dp / rm);
  }
  /* 给定「冷侧温度 + 温差」时的环流速度 —— 图表右图用（ΔT 从 0 扫到上限）。 */
  function vOfDT(dtc, tcBase) {
    const th = tcBase + dtc;
    const dp = (rhoAir(tcBase) - rhoAir(th)) * GRAV * COL_H_M[state.scene];
    if (!(dp > 0)) return 0;
    const rm = (rhoAir(tcBase) + rhoAir(th)) / 2;
    return Math.sqrt(2 * dp / rm);
  }

  /* ============================ 三、环流场 ============================ */
  const CELL = {
    box: { w: BOX_W, h: CELL_H, ty: 0 },
    sea: { w: SEA_CELL_W, h: SEA_CELL_H, ty: 0 }
  };
  const cellGeom = () => CELL[state.scene];

  /* 单胞流函数 ψ = sin(πξ)·sin(πη)，ξ=(x+w/2)/w、η=y/h。
     速度 = (∂ψ/∂y, −∂ψ/∂x)，再【整体除以 π/h】归一化（最大分量 = 1），
     于是 (u,v) 与 ψ 仍然同源 ⇒ 无散度恒成立：
       ∂u/∂x + ∂v/∂y = (π/w)cos(πξ)cos(πη) − (π/w)cos(πξ)cos(πη) ≡ 0
     hotRight=false 时把 x 镜像（u 反号、v 不变），仍然是同一个无散度场。 */
  function flowAt(x, y) {
    const c = cellGeom();
    const hr = hotRight();
    const xx = hr ? x : -x;
    const xi = (xx + c.w / 2) / c.w;
    const eta = y / c.h;
    const sgn = hr ? 1 : -1;
    const u = sgn * Math.sin(Math.PI * xi) * Math.cos(Math.PI * eta);
    const v = -(c.h / c.w) * Math.cos(Math.PI * xi) * Math.sin(Math.PI * eta);
    return { u, v };
  }
  /* 流函数值（示踪烟的不变量：粒子应当一直停在同一条流线上） */
  function psiAt(x, y) {
    const c = cellGeom();
    const xx = hotRight() ? x : -x;
    return Math.sin(Math.PI * (xx + c.w / 2) / c.w) * Math.sin(Math.PI * y / c.h);
  }
  /* 竖直方向通量 ∫v dx（沿一条水平线）—— 无散度场里它必须为 0 */
  function vertFlux(y, n) {
    const c = cellGeom();
    const N = n || 200;
    let s = 0;
    for (let i = 0; i < N; i++) {
      const x = -c.w / 2 + (i + 0.5) * c.w / N;
      s += flowAt(x, y).v * (c.w / N);
    }
    return s;
  }
  /* 水平方向通量 ∫u dy（沿一条竖直线） */
  function horizFlux(x, n) {
    const c = cellGeom();
    const N = n || 200;
    let s = 0;
    for (let i = 0; i < N; i++) {
      const y = (i + 0.5) * c.h / N;
      s += flowAt(x, y).u * (c.h / N);
    }
    return s;
  }
  /* 数值散度（中心差分）—— B01 用它直接卡「无散度」这条不变量 */
  function divAt(x, y) {
    const e = 1e-4;
    const a = flowAt(x + e, y), b = flowAt(x - e, y);
    const p = flowAt(x, y + e), q = flowAt(x, y - e);
    return (a.u - b.u) / (2 * e) + (p.v - q.v) / (2 * e);
  }

  /* 视觉速度：世界单位/秒。与物理速度成正比 ⇒「温差越大风越大」在画面上也成立。 */
  const VIS_K = { box: 32, sea: 4.8 };
  const visSpeed = () => VIS_K[state.scene] * flowSpeed();

  /* ============================ 四、状态 ============================ */
  const state = {
    scene: 'box',        // box | sea
    heat: 1,             // 0..1 加热强度
    cool: 1,             // 0..1 冷却强度
    seaNight: false,
    seaDT: 1,            // 0..1 海陆温差档
    tracer: true,
    arrows: true,
    micro: true,
    step: 0,
    records: [],
    dropped: 0,          // 「重新投放」次数（自检用）
    t: 0,
    w: 1, h: 1,
    drawn: {}
  };
  const toggles = { tracer: true, arrows: true, micro: true };

  /* ★ 每个视角都自带 ty：环流单元从 y≈1 一直到 y≈55（比烟囱还高一截），
     用同一个 ty 套所有视角的话，「近观风箱」会把箱底切掉、「45° 斜视」会把环流顶部顶出画布。 */
  const VIEWS = {
    front: { yaw: -0.06, pitch: 0.10, dist: 124, ty: 26 },
    angle: { yaw: -0.52, pitch: 0.17, dist: 128, ty: 26 },
    top: { yaw: -0.46, pitch: 0.78, dist: 120, ty: 25 },
    close: { yaw: -0.40, pitch: 0.06, dist: 88, ty: 21 }
  };
  const view = { ...VIEWS.angle };
  function setView(name) {
    const v = VIEWS[name];
    if (!v) return false;
    Object.assign(view, v);
    document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    updateCamera();
    return true;
  }
  /* ★ 取景必须【按场景】给：对流箱的主体在 y ≈ 26、世界宽 60；海陆风的世界宽 340、
     主体在 y ≈ 34。一档取景套两个场景必然有一档是废的（主体缩在画面一角）。 */
  function sceneFrame() {
    if (state.scene === 'sea') return { ty: 26, distK: 2.2, pitchK: 0.95 };
    return { ty: view.ty, distK: 1, pitchK: 1 };
  }

  /* ============================ 五、小工具 ============================ */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mulberry32 = (a) => () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rnd = mulberry32(20261006);
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

  /* ============================ 六、程序化贴图 ============================
     🔴 三张 Canvas 贴图【必须设 colorSpace = SRGBColorSpace】：
     不设的话 canvas 里 sRGB 编码的像素会被当成【线性】值直接用，线性亮度被抬高约 5 倍
     —— 实测同一套灯光下台面渲染成 lum 184（浅灰），而设了 colorSpace 的沸腾页是 67。
     下面三张与 experiment_沸腾.js / experiment_升华.js 逐行一致，保证同章观感统一。 */
  function makeBenchMap() {
    const S = 512, r = mulberry32(99);
    const c = newCanvas(S, S), g = c.getContext('2d');
    g.fillStyle = '#33312e'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 260; i++) {
      const x = r() * S, y = r() * S, rr = 8 + r() * 46;
      const grd = g.createRadialGradient(x, y, 0, x, y, rr);
      grd.addColorStop(0, `hsla(${205 + r() * 30},${4 + r() * 8}%,${9 + r() * 15}%,${0.06 + r() * 0.1})`);
      grd.addColorStop(1, 'hsla(0,0%,0%,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, rr, 0, 7); g.fill();
    }
    for (let i = 0; i < 5200; i++) {
      const x = r() * S, y = r() * S, rr = 0.4 + r() * 1.5;
      const l = r() < 0.55 ? 7 + r() * 10 : 30 + r() * 20;
      g.fillStyle = `hsla(${200 + r() * 40},${4 + r() * 10}%,${l}%,${0.2 + r() * 0.44})`;
      g.beginPath(); g.arc(x, y, rr, 0, 7); g.fill();
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
    const S = 512, r = mulberry32(1010);
    const c = newCanvas(S, S), g = c.getContext('2d');
    g.fillStyle = '#33373d'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 220; i++) {
      const x = r() * S, y = r() * S, rr = 12 + r() * 60;
      const grd = g.createRadialGradient(x, y, 0, x, y, rr);
      grd.addColorStop(0, `hsla(${210 + r() * 30},${3 + r() * 7}%,${16 + r() * 22}%,${0.07 + r() * 0.12})`);
      grd.addColorStop(1, 'hsla(0,0%,0%,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, rr, 0, 7); g.fill();
    }
    for (let i = 0; i < 4200; i++) {
      const x = r() * S, y = r() * S, rr = 0.5 + r() * 1.7;
      const l = r() < 0.6 ? 10 + r() * 14 : 44 + r() * 26;
      g.fillStyle = `hsla(${205 + r() * 30},${3 + r() * 8}%,${l}%,${0.25 + r() * 0.45})`;
      g.beginPath(); g.arc(x, y, rr, 0, 7); g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3, 2);
    return t;
  }
  /* 天空（海陆风场景用）：白天 / 夜晚两张渐变 */
  function makeSkyMap(day) {
    const W = 8, H = 512;
    const c = newCanvas(W, H), g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, H);
    if (day) {
      grad.addColorStop(0, '#174f88');
      grad.addColorStop(0.30, '#3d86bf');
      grad.addColorStop(0.62, '#8ec2de');
      grad.addColorStop(0.86, '#e2ecf2');
      grad.addColorStop(1, '#cbd6dc');
    } else {
      grad.addColorStop(0, '#04070f');
      grad.addColorStop(0.35, '#0a1a2e');
      grad.addColorStop(0.68, '#16304a');
      grad.addColorStop(0.90, '#24435e');
      grad.addColorStop(1, '#1b3244');
    }
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  /* 示踪烟的软边圆贴图。★ 不能用实心球 + 加法混合：
     ① 混合方式必须【普通混合】—— 烟是吸收型，加法混合在浅色背景上只会越加越白；
     ② 边缘必须【渐隐】—— 实心球永远是个球，用软边贴图 + 大量互相重叠的团块才叠得出「烟」。 */
  const SMOKE_TEX = (() => {
    const S = 128;
    const c = newCanvas(S, S), g = c.getContext('2d');
    const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grd.addColorStop(0.00, 'rgba(255,255,255,0.80)');
    grd.addColorStop(0.42, 'rgba(255,255,255,0.44)');
    grd.addColorStop(0.76, 'rgba(255,255,255,0.13)');
    grd.addColorStop(1.00, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, S, S);
    return new THREE.CanvasTexture(c);
  })();

  /* 海面：深蓝底 + 横向的浪花条纹（贴在 map 与 bumpMap 上） */
  function makeSeaMap() {
    const S = 512, r = mulberry32(4242);
    const c = newCanvas(S, S), g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, S);
    grad.addColorStop(0, '#16465f');
    grad.addColorStop(0.5, '#123c55');
    grad.addColorStop(1, '#0e3048');
    g.fillStyle = grad; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 900; i++) {
      const y = r() * S, x = r() * S, w = 12 + r() * 120, h = 0.8 + r() * 2.6;
      const l = 16 + r() * 30;
      g.fillStyle = `hsla(${198 + r() * 14},${28 + r() * 22}%,${l}%,${0.10 + r() * 0.26})`;
      g.beginPath(); g.ellipse(x, y, w / 2, h / 2, 0, 0, 7); g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(6, 26);
    return t;
  }
  /* 陆地：土黄底 + 斑驳的植被/砂石 */
  function makeLandMap() {
    const S = 512, r = mulberry32(777);
    const c = newCanvas(S, S), g = c.getContext('2d');
    g.fillStyle = '#6d6a45'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 700; i++) {
      const x = r() * S, y = r() * S, rr = 6 + r() * 40;
      const grd = g.createRadialGradient(x, y, 0, x, y, rr);
      const hue = r() < 0.5 ? 74 + r() * 18 : 40 + r() * 16;
      grd.addColorStop(0, `hsla(${hue},${18 + r() * 22}%,${22 + r() * 26}%,${0.16 + r() * 0.24})`);
      grd.addColorStop(1, 'hsla(0,0%,0%,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, rr, 0, 7); g.fill();
    }
    for (let i = 0; i < 3400; i++) {
      const x = r() * S, y = r() * S, rr = 0.5 + r() * 1.6;
      const l = r() < 0.6 ? 16 + r() * 16 : 46 + r() * 22;
      g.fillStyle = `hsla(${64 + r() * 26},${14 + r() * 20}%,${l}%,${0.24 + r() * 0.4})`;
      g.beginPath(); g.arc(x, y, rr, 0, 7); g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(5, 14);
    return t;
  }

  /* ============================ 七、渲染器 / 场景 / 光照 ============================ */
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
  const BG_BOX = '#2b333c', BG_SEA_DAY = '#7fb0d6', BG_SEA_NIGHT = '#0a1728';
  scene.background = new THREE.Color(BG_BOX);
  scene.fog = new THREE.Fog(BG_BOX, 180, 420);

  const camera = new THREE.PerspectiveCamera(32, 1, 1, 3000);

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

  const hemi = new THREE.HemisphereLight('#eaf2fa', '#4a4238', 0.44);
  scene.add(hemi);
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

  /* 棚拍背景（对流箱用） */
  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(420, 320),
    new THREE.MeshBasicMaterial({ map: makeBackdropMap(), fog: false })
  );
  backdrop.position.set(0, 138, -95);
  scene.add(backdrop);

  /* 天空（海陆风用）：白天 / 夜晚两张贴图，切换时换 map。
     ★ 必须铺得比取景范围大得多：第一版 1400×900 在斜视下能看见天空板的右边缘
       —— 画面上多出一条竖直的蓝色色带。 */
  const SKY_DAY = makeSkyMap(true), SKY_NIGHT = makeSkyMap(false);
  const sky = new THREE.Mesh(
    new THREE.PlaneGeometry(6400, 760),
    new THREE.MeshBasicMaterial({ map: SKY_DAY, fog: false })
  );
  sky.position.set(0, 300, -1000);
  sky.visible = false;
  scene.add(sky);

  /* ============================ 八、材质 ============================ */
  const benchMap = makeBenchMap();
  benchMap.anisotropy = MAX_ANISO;
  const ironMap = makeIronMap();
  ironMap.anisotropy = MAX_ANISO;
  /* ★ 与 experiment_沸腾.js 逐字一致：贴图底色是深的（#33373d），材质 color 用浅灰
     #b9bec6 去乘它。把贴图改成浅色、材质改成深色，是把两处都写反了。 */
  const castIron = new THREE.MeshStandardMaterial({ map: ironMap, bumpMap: ironMap, bumpScale: 0.05, color: '#b9bec6', roughness: 0.7, metalness: 0.3 });
  const chrome = new THREE.MeshStandardMaterial({ color: '#d9dfe5', roughness: 0.16, metalness: 1.0, envMapIntensity: 1.5 });
  const darkSteel = new THREE.MeshStandardMaterial({ color: '#6d737a', roughness: 0.36, metalness: 0.92, envMapIntensity: 1.1 });
  /* 玻璃：风箱与短管共用。★ 只能用【一层半透明】：cyl/box 内部 rgba 的 alpha 若写死 1，
     外层 globalAlpha 无效，箱内的烟就整个被盖住 —— 0.12 是「轮廓立得住」和「看得进内部」的折中。 */
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: '#e6f3f8', transparent: true, opacity: 0.12, roughness: 0.05, metalness: 0.0,
    clearcoat: 1.0, clearcoatRoughness: 0.03, envMapIntensity: 2.1,
    side: THREE.DoubleSide, depthWrite: false
  });
  const edgeMat = new THREE.LineBasicMaterial({ color: '#9fd6ee', transparent: true, opacity: 0.55 });
  /* 烟的不透明度分档：海陆风的背景是亮天空，同样的烟会比深色棚拍背景上淡得多，
     所以海陆风用更高的一档，否则烟直接「看不见」= 整个示踪功能白做。 */
  const SMOKE_ALPHA = { box: [0.34, 0.25, 0.17], sea: [0.38, 0.29, 0.20] };
  const smokeMats = SMOKE_ALPHA.box.map((a) => new THREE.SpriteMaterial({
    map: SMOKE_TEX, color: '#eef4f9', transparent: true, opacity: a,
    depthWrite: false, blending: THREE.NormalBlending
  }));
  const hotMat = new THREE.MeshStandardMaterial({ color: '#3b2a22', roughness: 0.62, metalness: 0.5, envMapIntensity: 0.9 });
  const coilMat = new THREE.MeshStandardMaterial({ color: '#ff6a1f', emissive: '#ff3d00', emissiveIntensity: 1.6, roughness: 0.5, metalness: 0.2 });
  const iceMat = new THREE.MeshPhysicalMaterial({
    color: '#dff0fb', transparent: true, opacity: 0.72, roughness: 0.22, metalness: 0.0,
    clearcoat: 1.0, clearcoatRoughness: 0.1, envMapIntensity: 1.8
  });
  const trayMat = new THREE.MeshStandardMaterial({ color: '#8b939c', roughness: 0.45, metalness: 0.6 });
  /* 海面：贴图带浪花条纹，envMapIntensity 压到 0.9 —— 拉到 1.7 时棚拍环境贴图
     会把整个海面反射成浅灰，和海天糊成一片（第一版就是这样，看着像一块磨砂玻璃）。 */
  const seaMat = new THREE.MeshStandardMaterial({
    map: makeSeaMap(), bumpMap: makeSeaMap(), bumpScale: 0.35,
    roughness: 0.42, metalness: 0.04, envMapIntensity: 0.9
  });
  const landMat = new THREE.MeshStandardMaterial({
    map: makeLandMap(), bumpMap: makeLandMap(), bumpScale: 0.5,
    roughness: 0.94, metalness: 0.0, envMapIntensity: 0.6
  });
  const foamMat = new THREE.MeshStandardMaterial({ color: '#e8f4fb', roughness: 0.6, metalness: 0.0, transparent: true, opacity: 0.5 });
  const buildMat = new THREE.MeshStandardMaterial({ color: '#9a9284', roughness: 0.82, metalness: 0.0 });
  const roofMat = new THREE.MeshStandardMaterial({ color: '#7d4f42', roughness: 0.78, metalness: 0.0 });
  const shoreMat = new THREE.MeshStandardMaterial({ color: '#b9ad86', roughness: 0.9, metalness: 0.0 });
  /* 昼夜的固有色：夜间光靠压灯光与 IBL 还不够 —— 陆地那张土黄贴图的反照率很高，
     环境光一照就还是亮的。乘一层冷色调把固有色本身压下去。 */
  const SEA_TINT = {
    day: { sea: '#ffffff', land: '#ffffff', build: '#9a9284', roof: '#7d4f42', shore: '#b9ad86', foam: '#e8f4fb' },
    night: { sea: '#5d7391', land: '#4d5c6e', build: '#54606e', roof: '#4a3a3a', shore: '#5a6070', foam: '#8fa3b5' }
  };
  const sunMat = new THREE.MeshBasicMaterial({ color: '#ffd24a', fog: false });
  const moonMat = new THREE.MeshBasicMaterial({ color: '#dbe6f5', fog: false });

  /* ============================ 九、对流箱场景 ============================ */
  const rig = new THREE.Group();
  scene.add(rig);

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
  rig.add(bench);

  /* 玻璃风箱：箱体 + 棱线 */
  const boxGeo = new THREE.BoxGeometry(BOX_W, BOX_H, BOX_D);
  const boxMesh = new THREE.Mesh(boxGeo, glassMat);
  boxMesh.position.set(0, BOX_H / 2, 0);
  rig.add(boxMesh);
  const boxEdges = new THREE.LineSegments(new THREE.EdgesGeometry(boxGeo), edgeMat);
  boxEdges.position.copy(boxMesh.position);
  rig.add(boxEdges);
  /* 箱底一块不透明的底板，否则「箱底气流」看起来悬在空中 */
  const boxFloor = new THREE.Mesh(
    new THREE.BoxGeometry(BOX_W, 0.8, BOX_D),
    new THREE.MeshStandardMaterial({ color: '#2f3a44', roughness: 0.5, metalness: 0.35, envMapIntensity: 0.8 })
  );
  boxFloor.position.set(0, -0.4, 0);
  boxFloor.receiveShadow = true;
  rig.add(boxFloor);

  /* 两支玻璃短管 */
  const chimGeo = new THREE.CylinderGeometry(CH_R, CH_R, CH_H, 28, 1, true);
  const chimneys = [];
  [-1, 1].forEach((sgn) => {
    const m = new THREE.Mesh(chimGeo, glassMat);
    m.position.set(sgn * CH_X, CH_Y0 + CH_H / 2, 0);
    rig.add(m);
    chimneys.push(m);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(CH_R, 0.34, 8, 28), chrome);
    lip.rotation.x = Math.PI / 2;
    lip.position.set(sgn * CH_X, CH_Y1, 0);
    rig.add(lip);
    /* 管口下沿也来一圈细环，让「管子是通的」看得出来 */
    const c1 = new THREE.Mesh(new THREE.TorusGeometry(CH_R, 0.18, 6, 28), chrome);
    c1.rotation.x = Math.PI / 2;
    c1.position.set(sgn * CH_X, CH_Y0, 0);
    rig.add(c1);
  });

  /* 电热板（右侧热源） */
  const heatGroup = new THREE.Group();
  heatGroup.position.set(CH_X, 0, 0);
  rig.add(heatGroup);
  const heatBase = new THREE.Mesh(new THREE.BoxGeometry(14, HEAT_H, 13), hotMat);
  heatBase.position.y = HEAT_H / 2;
  heatBase.castShadow = true; heatBase.receiveShadow = true;
  heatGroup.add(heatBase);
  const coils = [];
  for (let i = 0; i < 3; i++) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(4.6 - i * 1.3, 0.58, 8, 24), coilMat);
    t.rotation.x = Math.PI / 2;
    t.position.y = HEAT_H + 0.5;
    heatGroup.add(t);
    coils.push(t);
  }
  const heatGlow = new THREE.PointLight('#ff5a12', 1.6, 46, 2);
  heatGlow.position.set(0, HEAT_H + 2.4, 0);
  heatGroup.add(heatGlow);

  /* 冰块（左侧冷源） */
  const coldGroup = new THREE.Group();
  coldGroup.position.set(-CH_X, 0, 0);
  rig.add(coldGroup);
  const tray = new THREE.Mesh(new THREE.BoxGeometry(14, 1.2, 13), trayMat);
  tray.position.y = 0.6;
  tray.receiveShadow = true;
  coldGroup.add(tray);
  const ice = new THREE.Mesh(new THREE.BoxGeometry(12.2, COLD_H, 11.2), iceMat);
  ice.position.y = 1.2 + COLD_H / 2;
  ice.castShadow = true;
  coldGroup.add(ice);
  const iceEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(12.2, COLD_H, 11.2)),
    new THREE.LineBasicMaterial({ color: '#bfe6ff', transparent: true, opacity: 0.5 })
  );
  iceEdges.position.copy(ice.position);
  coldGroup.add(iceEdges);
  const coldGlow = new THREE.PointLight('#7fd4ff', 0.5, 40, 2);
  coldGlow.position.set(0, 1.2 + COLD_H + 1.6, 0);
  coldGroup.add(coldGlow);

  /* ============================ 十、海陆风场景 ============================ */
  const seaRig = new THREE.Group();
  seaRig.visible = false;
  scene.add(seaRig);

  /* 海面（左）与陆地（右），分界线在 x = 0 */
  const seaPlane = new THREE.Mesh(new THREE.PlaneGeometry(SEA_SPAN, SEA_DEPTH), seaMat);
  seaPlane.rotation.x = -Math.PI / 2;
  seaPlane.position.set(-SEA_SPAN / 2, 0, 0);
  seaRig.add(seaPlane);
  const landBox = new THREE.Mesh(new THREE.BoxGeometry(SEA_SPAN, LAND_Y, SEA_DEPTH), landMat);
  landBox.position.set(SEA_SPAN / 2, LAND_Y / 2, 0);
  landBox.receiveShadow = true;
  seaRig.add(landBox);
  /* 岸线：贴着 x = 0 的一条浅色沙带 */
  const shore = new THREE.Mesh(new THREE.BoxGeometry(16, LAND_Y + 0.12, SEA_DEPTH), shoreMat);
  shore.position.set(8, (LAND_Y + 0.12) / 2, 0);
  shore.receiveShadow = true;
  seaRig.add(shore);
  /* 浪花：只在岸边附近，而且打散成一小段一小段 —— 连成一条贯穿全场的白条会读成跑道 */
  for (let i = 0; i < 46; i++) {
    const z = (rnd() - 0.5) * 620;
    const x = -4 - rnd() * 40;
    const w = 1.4 + rnd() * 3.2;
    const len = 9 + rnd() * 26;
    const f = new THREE.Mesh(new THREE.BoxGeometry(w, 0.16, len), foamMat);
    f.position.set(x, 0.18, z);
    seaRig.add(f);
  }
  /* 岸上的几幢房子：给陆地一个「人住在这儿」的尺度参照 */
  const BUILDINGS = [
    [44, 17, 15, 96], [76, 25, 12, 74], [112, 13, 20, 120], [58, 14, 12, -104],
    [96, 20, 15, -78], [140, 16, 18, -132], [34, 12, 11, 208], [128, 22, 14, 176]
  ];
  BUILDINGS.forEach(([x, h, w, z]) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), buildMat);
    b.position.set(x, LAND_Y + h / 2, z);
    b.castShadow = true; b.receiveShadow = true;
    seaRig.add(b);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w * 1.16, 1.6, w * 1.16), roofMat);
    roof.position.set(x, LAND_Y + h + 0.8, z);
    roof.castShadow = true;
    seaRig.add(roof);
  });
  const sun = new THREE.Mesh(new THREE.SphereGeometry(13, 22, 16), sunMat);
  sun.position.set(300, 150, -480);
  seaRig.add(sun);
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: SMOKE_TEX, color: '#ffdc7a', transparent: true, opacity: 0.62, depthWrite: false, fog: false
  }));
  sunGlow.scale.set(72, 72, 1);
  sunGlow.position.copy(sun.position);
  seaRig.add(sunGlow);
  const moon = new THREE.Mesh(new THREE.SphereGeometry(10, 22, 16), moonMat);
  moon.position.set(300, 150, -480);
  moon.visible = false;
  seaRig.add(moon);
  const moonGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: SMOKE_TEX, color: '#cfe0f4', transparent: true, opacity: 0.32, depthWrite: false, fog: false
  }));
  moonGlow.scale.set(56, 56, 1);
  moonGlow.position.copy(moon.position);
  moonGlow.visible = false;
  seaRig.add(moonGlow);

  /* ============================ 十一、示踪烟 ============================ */
  const SMOKE_N = { box: 132, sea: 148 };
  const SMOKE_SIZE = { box: 5.8, sea: 15.0 };
  const SEED = {
    box: { x0: -28.6, x1: -20.6, y0: CH_Y1 - 10.5, y1: CH_Y1 - 1.5, z: 12 },
    /* 海陆风的烟必须散得开一些：z 方向只铺 ±13 的话，整个环流看起来是
       「一张薄薄的发光板子」，没有体积感。 */
    sea: { x0: 82, x1: 97, y0: 4, y1: 20, z: 72 }
  };
  const smoke = [];
  const smokeGroup = new THREE.Group();
  scene.add(smokeGroup);
  (function buildSmoke() {
    const n = Math.max(SMOKE_N.box, SMOKE_N.sea);
    for (let i = 0; i < n; i++) {
      const sp = new THREE.Sprite(smokeMats[i % smokeMats.length]);
      sp.scale.set(1, 1, 1);
      smokeGroup.add(sp);
      smoke.push({ x: 0, y: 0, z: 0, s: 0.6 + rnd() * 0.9, psi0: 0, sprite: sp, mat: i % smokeMats.length });
    }
  })();
  const activeSmoke = () => smoke.slice(0, SMOKE_N[state.scene]);
  const smokeSizeNow = () => SMOKE_SIZE[state.scene];

  /* 投放：把当前场景的粒子全放回入口。★ 入口位置由 SEED 给出，
     它是「烟从哪儿进」的唯一真源 —— 自检直接量「投放后是不是都在这个盒子里」。 */
  function dropSmoke() {
    const sd = SEED[state.scene];
    activeSmoke().forEach((p) => {
      p.x = sd.x0 + rnd() * (sd.x1 - sd.x0);
      p.y = sd.y0 + rnd() * (sd.y1 - sd.y0);
      p.z = (rnd() - 0.5) * sd.z;
      p.psi0 = psiAt(p.x, p.y);
      p.sprite.position.set(p.x, p.y, p.z);
      const s = smokeSizeNow() * p.s;
      p.sprite.scale.set(s, s, 1);
    });
    smoke.forEach((p) => { p.sprite.visible = false; });
    activeSmoke().forEach((p) => { p.sprite.visible = state.tracer; });
    state.dropped++;
    refreshFlow();
  }

  /* RK4 推进（比欧拉稳得多：闭环流场里欧拉会缓慢向外漂，几十秒后粒子就跑到墙外了） */
  function rk4(x, y, dt, S) {
    const k1 = flowAt(x, y);
    const k2 = flowAt(x + S * k1.u * dt / 2, y + S * k1.v * dt / 2);
    const k3 = flowAt(x + S * k2.u * dt / 2, y + S * k2.v * dt / 2);
    const k4 = flowAt(x + S * k3.u * dt, y + S * k3.v * dt);
    return [
      x + S * dt * (k1.u + 2 * k2.u + 2 * k3.u + k4.u) / 6,
      y + S * dt * (k1.v + 2 * k2.v + 2 * k3.v + k4.v) / 6
    ];
  }
  function advect(dt) {
    const S = visSpeed();
    if (!(S > 0)) return;
    const c = cellGeom();
    const sub = 2, h = dt / sub;
    activeSmoke().forEach((p) => {
      for (let k = 0; k < sub; k++) {
        const nx = rk4(p.x, p.y, h, S);
        p.x = nx[0]; p.y = nx[1];
      }
      /* 数值安全网：真跑出去（不应该）就夹回单元内，并回到自己的流线上 */
      p.x = clamp(p.x, -c.w / 2 + 0.05, c.w / 2 - 0.05);
      p.y = clamp(p.y, 0.05, c.h - 0.05);
      p.sprite.position.set(p.x, p.y, p.z);
    });
  }
  /* 流线上的一切（箭头、提示文字）都跟着这个函数刷新 */
  function refreshFlow() {
    updateArrows();
    syncUI();
    requestRender();
  }

  /* ============================ 十二、环流方向箭头 ============================ */
  /* 箭头的长度要按场景缩放：海陆风的世界比对流箱大 3 倍多，
     沿用对流箱那套 3~7 个单位的箭头，在画面上就是几个看不清的小点。 */
  const ARROW_K = { box: 1, sea: 2.9 };
  const ARROW_PTS = {
    box: [
      [-CH_X, 4], [-CH_X, 13], [-CH_X, 24], [-CH_X, 35], [-CH_X, 43],
      [0, 4], [0, 14], [0, 25],
      [CH_X, 4], [CH_X, 13], [CH_X, 24], [CH_X, 35], [CH_X, 43]
    ],
    sea: [
      [-75, 7], [-25, 7], [25, 7], [75, 7],
      [-75, 34], [-25, 34], [25, 34], [75, 34],
      [-75, 66], [-25, 66], [25, 66], [75, 66]
    ]
  };
  const UP = new THREE.Vector3(0, 1, 0);
  const arrows = [];
  const arrowGroup = new THREE.Group();
  scene.add(arrowGroup);
  (function buildArrows() {
    const n = Math.max(ARROW_PTS.box.length, ARROW_PTS.sea.length);
    for (let i = 0; i < n; i++) {
      const a = new THREE.ArrowHelper(UP, new THREE.Vector3(), 4, 0x5eead4, 2.2, 1.5);
      arrowGroup.add(a);
      arrows.push(a);
    }
  })();
  function updateArrows() {
    const pts = ARROW_PTS[state.scene];
    const show = toggles.arrows && flowSpeed() > 0;
    arrows.forEach((a, i) => {
      const on = show && i < pts.length;
      a.visible = on;
      if (!on) return;
      const [x, y] = pts[i];
      const f = flowAt(x, y);
      const sp = Math.hypot(f.u, f.v);
      a.position.set(x, y, 0);
      if (sp > 1e-6) a.setDirection(new THREE.Vector3(f.u / sp, f.v / sp, 0));
      const k = ARROW_K[state.scene];
      const len = (3.2 + 3.4 * sp) * k;
      a.setLength(len, Math.min(2.6 * k, len * 0.42), Math.min(1.9 * k, len * 0.30));
      a.userData.len = len;
      /* 方向配色：上升 = 暖橙、下沉 = 冷蓝、纯水平 = 青 */
      const vert = f.v / (sp || 1);
      let col;
      if (vert > 0.30) col = 0xfb923c;
      else if (vert < -0.30) col = 0x38bdf8;
      else col = 0xf8fafc;
      a.setColor(new THREE.Color(col));
    });
    state.drawn.arrowsShown = arrows.filter((a) => a.visible).length;
  }

  /* ============================ 十三、场景切换与外观 ============================ */
  function applySceneLook() {
    const sea = state.scene === 'sea';
    rig.visible = !sea;
    backdrop.visible = !sea;
    bench.visible = !sea;
    seaRig.visible = sea;
    sky.visible = sea;
    /* 烟的底色与浓淡跟着背景走：浅蓝天空下纯白烟会糊掉，压暗一档才读得出；
       夜里反过来 —— 深色背景上要更亮才看得见。 */
    const smokeCol = sea ? (state.seaNight ? '#9fb6cc' : '#a9bcc9') : '#eef4f9';
    const alpha = sea ? SMOKE_ALPHA.sea : SMOKE_ALPHA.box;
    smokeMats.forEach((m, i) => { m.color.set(smokeCol); m.opacity = alpha[i]; });
    /* ★ 夜间必须把【环境贴图的贡献】压下去：scene.environment 是那份明亮的棚拍 IBL，
       它不随昼夜变 —— 只调 DirectionalLight 的话，海面和陆地照样被 IBL 照得亮堂堂，
       夜里看起来和白天一模一样（第一版就是这样，只暗了天空）。 */
    const envK = sea ? (state.seaNight ? 0.10 : 1.0) : 1.0;
    seaMat.envMapIntensity = 0.9 * envK;
    landMat.envMapIntensity = 0.6 * envK;
    buildMat.envMapIntensity = 1.0 * envK;
    roofMat.envMapIntensity = 1.0 * envK;
    shoreMat.envMapIntensity = 1.0 * envK;
    foamMat.envMapIntensity = 1.0 * envK;
    renderer.toneMappingExposure = (sea && state.seaNight) ? 0.78 : 1.0;
    const T = (sea && state.seaNight) ? SEA_TINT.night : SEA_TINT.day;
    seaMat.color.set(T.sea); landMat.color.set(T.land);
    buildMat.color.set(T.build); roofMat.color.set(T.roof);
    shoreMat.color.set(T.shore); foamMat.color.set(T.foam);
    if (sea) {
      const day = !state.seaNight;
      scene.background = new THREE.Color(day ? BG_SEA_DAY : BG_SEA_NIGHT);
      /* ★ 雾的起点要推到 700 以外：300 起雾时整个海面被雾色冲淡，和海天糊成一片 */
      scene.fog = new THREE.Fog(day ? BG_SEA_DAY : BG_SEA_NIGHT, 700, 2600);
      sky.material.map = day ? SKY_DAY : SKY_NIGHT;
      sky.material.needsUpdate = true;
      sun.visible = day;
      sunGlow.visible = day;
      moon.visible = !day;
      moonGlow.visible = !day;
      key.color = new THREE.Color(day ? '#fff0c8' : '#b9d4ff');
      key.intensity = day ? 2.4 : 0.42;
      key.position.set(day ? 240 : -180, day ? 320 : 280, day ? -200 : 120);
      key.target.position.set(40, 10, 0);
      hemi.color = new THREE.Color(day ? '#cfe6fa' : '#2b4a6b');
      hemi.groundColor = new THREE.Color(day ? '#5d5a44' : '#101a26');
      hemi.intensity = day ? 0.55 : 0.30;
      fill.intensity = day ? 0.50 : 0.22;
      rim.intensity = day ? 0.36 : 0.30;
    } else {
      scene.background = new THREE.Color(BG_BOX);
      scene.fog = new THREE.Fog(BG_BOX, 180, 420);
      key.color = new THREE.Color('#fff2dd');
      key.intensity = 2.0;
      key.position.set(-42, 66, 44);
      key.target.position.set(0, 16, 0);
      hemi.color = new THREE.Color('#eaf2fa');
      hemi.groundColor = new THREE.Color('#4a4238');
      hemi.intensity = 0.44;
      fill.intensity = 0.58;
      rim.intensity = 0.44;
    }
    /* ★ 阴影相机要跟着场景改：对流箱只有 60 cm 宽（±46 刚好包住、2048 的图够细），
       海陆风要盖住几百个单位 —— 不扩就会「房子底下没有影子」，看着像贴纸。 */
    const sc = key.shadow.camera;
    if (sea) {
      sc.left = -260; sc.right = 260; sc.top = 260; sc.bottom = -80; sc.near = 20; sc.far = 1100;
    } else {
      sc.left = -46; sc.right = 46; sc.top = 60; sc.bottom = -14; sc.near = 20; sc.far = 200;
    }
    sc.updateProjectionMatrix();
  }
  function applyHeatLook() {
    const k = state.scene === 'sea' ? 0 : state.heat;
    coilMat.emissiveIntensity = 0.15 + 2.4 * k;
    heatGlow.intensity = 0.12 + 2.6 * k;
    const c = state.scene === 'sea' ? 0 : state.cool;
    coldGlow.intensity = 0.12 + 0.9 * c;
    iceMat.opacity = 0.5 + 0.28 * c;
    /* 冰在「不冷却」时也留着（器材不撤走），只是不再发冷光 */
    ice.visible = true;
  }

  function setScene(key) {
    if (state.scene === key) return false;
    state.scene = key;
    document.querySelectorAll('[data-scene]').forEach((b) => b.classList.toggle('active', b.dataset.scene === key));
    document.querySelectorAll('[data-for]').forEach((el) => el.classList.toggle('on', el.dataset.for === key));
    applySceneLook();
    applyHeatLook();
    dropSmoke();
    updateCamera();
    updateReadouts();
    renderRecords();
    syncUI();
    requestRender();
    return true;
  }

  /* ============================ 十四、相机 ============================ */
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

  /* ============================ 十五、指针交互 ============================ */
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
    view.pitch = clamp(view.pitch + dy * 2.2, -0.10, 1.34);
    updateCamera();
  });
  const endDrag = () => { dragging = false; canvas.style.cursor = 'grab'; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    view.dist = clamp(view.dist * (1 + Math.sign(e.deltaY) * 0.08), 26, 420);
    updateCamera();
  }, { passive: false });
  document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

  /* ============================ 十六、控件 ============================ */
  function setHeat(v) {
    state.heat = clamp(v, 0, 1);
    const r = $('heatRange');
    if (r && Math.abs(+r.value - state.heat * 100) > 0.5) r.value = String(Math.round(state.heat * 100));
    const lab = $('heatVal');
    if (lab) lab.textContent = Math.round(state.heat * 100) + '%';
    applyHeatLook(); refreshFlow();
  }
  function setCool(v) {
    state.cool = clamp(v, 0, 1);
    const r = $('coolRange');
    if (r && Math.abs(+r.value - state.cool * 100) > 0.5) r.value = String(Math.round(state.cool * 100));
    const lab = $('coolVal');
    if (lab) lab.textContent = Math.round(state.cool * 100) + '%';
    applyHeatLook(); refreshFlow();
  }
  function setSeaNight(v) {
    state.seaNight = !!v;
    document.querySelectorAll('[data-sea]').forEach((b) => b.classList.toggle('active', (b.dataset.sea === 'night') === state.seaNight));
    applySceneLook(); applyHeatLook(); refreshFlow();
  }
  function setSeaDT(v) {
    state.seaDT = clamp(v, 0, 1);
    const r = $('seaDTRange');
    if (r && Math.abs(+r.value - state.seaDT * 100) > 0.5) r.value = String(Math.round(state.seaDT * 100));
    const lab = $('seaDTVal');
    if (lab) lab.textContent = (state.seaDT * SEA_DT_MAX).toFixed(0) + ' ℃';
    refreshFlow();
  }
  function setTracer(v) {
    state.tracer = toggles.tracer = !!v;
    const cb = $('toggleTracer');
    if (cb) cb.checked = state.tracer;
    smoke.forEach((p) => { p.sprite.visible = false; });
    if (state.tracer) activeSmoke().forEach((p) => { p.sprite.visible = true; });
    syncUI(); requestRender();
  }
  function setArrows(v) {
    state.arrows = toggles.arrows = !!v;
    const cb = $('toggleArrows');
    if (cb) cb.checked = state.arrows;
    updateArrows(); syncUI(); requestRender();
  }
  function setMicro(v) {
    state.micro = toggles.micro = !!v;
    const cb = $('toggleMicro');
    if (cb) cb.checked = state.micro;
    const el = document.querySelector('.micro-inset');
    if (el) el.style.display = state.micro ? '' : 'none';
    if (state.micro) drawMicro(0.016);
    syncUI();
  }
  function resetAll() {
    state.scene = 'box';
    state.seaNight = false;
    state.heat = 1; state.cool = 1; state.seaDT = 1;
    state.step = 0;
    document.querySelectorAll('[data-scene]').forEach((b) => b.classList.toggle('active', b.dataset.scene === 'box'));
    document.querySelectorAll('[data-for]').forEach((el) => el.classList.toggle('on', el.dataset.for === 'box'));
    document.querySelectorAll('[data-sea]').forEach((b) => b.classList.toggle('active', b.dataset.sea === 'day'));
    document.querySelectorAll('[data-step]').forEach((b) => b.classList.toggle('active', b.dataset.step === '0'));
    ['heatRange', 'coolRange', 'seaDTRange'].forEach((id) => { const r = $(id); if (r) r.value = '100'; });
    const h1 = $('heatVal'); if (h1) h1.textContent = '100%';
    const c1 = $('coolVal'); if (c1) c1.textContent = '100%';
    const s1 = $('seaDTVal'); if (s1) s1.textContent = SEA_DT_MAX.toFixed(0) + ' ℃';
    applySceneLook(); applyHeatLook();
    setTracer(true); setArrows(true); setMicro(true);
    dropSmoke(); updateCamera(); updateReadouts(); renderRecords(); renderStep();
    setView('angle');
    syncUI();
    requestRender();
  }
  $('heatRange').addEventListener('input', (e) => setHeat(+e.target.value / 100));
  $('coolRange').addEventListener('input', (e) => setCool(+e.target.value / 100));
  $('seaDTRange').addEventListener('input', (e) => setSeaDT(+e.target.value / 100));
  $('zeroBtn').addEventListener('click', () => { setHeat(0); setCool(0); });
  $('fullBtn').addEventListener('click', () => { setHeat(1); setCool(1); });
  $('dropBtn').addEventListener('click', () => dropSmoke());
  $('toggleTracer').addEventListener('change', (e) => setTracer(e.target.checked));
  $('toggleArrows').addEventListener('change', (e) => setArrows(e.target.checked));
  $('toggleMicro').addEventListener('change', (e) => setMicro(e.target.checked));
  document.querySelectorAll('[data-scene]').forEach((b) => b.addEventListener('click', () => setScene(b.dataset.scene)));
  document.querySelectorAll('[data-sea]').forEach((b) => b.addEventListener('click', () => setSeaNight(b.dataset.sea === 'night')));

  /* ============================ 十七、读数 / 图表 / 微观 ============================ */
  const fmt = (v, n) => (Number.isFinite(v) ? v.toFixed(n) : '—');
  /* ★ 环流方向 / 风向的文字必须是【推导】出来的，绝不能按 state.seaNight 写死：
     把「海陆温差」拖到 0（或对流箱两边一起拖到 0）时两侧同温、环流速度正好是 0，
     写死的文案照旧宣称「陆风」/「冷侧上升」—— 而同一屏的「观察提示」明明写着
     「没有温差就没有风」，两句话当场打架。记录表「近地面风向」那一列同源，
     于是会把一条根本不存在的风记进实验记录。
     左右两侧与标签是一一对应的（左 = 海面 / 冰块，右 = 陆地 / 电热板），
     所以「热侧在右」⇔ 陆地比海面热 ⇔ 陆上空气上升 ⇔ 近地面由海洋吹向陆地。 */
  const NO_WIND = '两侧同温 ⇒ 没有温差就没有风';
  const circulationText = () => {
    if (!(dT() >= 0.05)) return NO_WIND;
    if (state.scene === 'sea') {
      return hotRight() ? '陆上空气上升 → 近地面由海洋吹向陆地（海风）'
        : '陆上空气下沉 → 近地面由陆地吹向海洋（陆风）';
    }
    return hotRight() ? '热侧上升 · 冷侧下沉' : '冷侧上升 · 热侧下沉';
  };
  const windLabel = () => {
    if (!(dT() >= 0.05)) return '无风（两侧同温）';
    if (state.scene === 'sea') return hotRight() ? '海风：海洋 → 陆地' : '陆风：陆地 → 海洋';
    return hotRight() ? '沿箱底：冷侧 → 热侧' : '沿箱底：热侧 → 冷侧';
  };
  const sceneName = () => (state.scene === 'sea' ? (state.seaNight ? '海陆风 · 夜晚' : '海陆风 · 白天') : '对流箱');
  const sideNames = () => (state.scene === 'sea'
    ? { hot: '陆地温度', cold: '海面温度', hotS: '陆地', coldS: '海面' }
    : { hot: '热区温度', cold: '冷区温度', hotS: '热区', coldS: '冷区' });

  function updateReadouts() {
    const s = sideTemps();
    const nm = sideNames();
    const setT = (id, v) => { const el = $(id); if (el) el.textContent = fmt(v, 1) + ' ℃'; };
    /* ★ 两格读数必须【按左/右两侧】给，绝不能按 hi/lo 给：
       海陆风夜里海面比陆地热 ⇒ hi 是海面，拿 hi 去填「陆地温度」那一格就把两个数对调了
       （画面照旧全绿、只有整页图上肉眼才看得出来）。左右两侧与标签是一一对应的
       —— 左 = 海面 / 冰块，右 = 陆地 / 电热板 —— 永远对得上。 */
    setT('metricHot', s.right); setT('metricCold', s.left);
    const a = $('mLabelHot'), b = $('mLabelCold');
    if (a) a.textContent = nm.hot; if (b) b.textContent = nm.cold;
    const e3 = $('metricDT'); if (e3) e3.textContent = fmt(dT(), 1) + ' ℃';
    const e4 = $('metricDRho'); if (e4) e4.textContent = fmt(dRho(), 4);
    const e5 = $('metricV'); if (e5) e5.textContent = fmt(flowSpeed(), 2) + ' m/s';
    const hd = $('hudDT'); if (hd) hd.textContent = fmt(dT(), 1);
    const hv = $('hudV'); if (hv) hv.textContent = fmt(flowSpeed(), 2) + ' m/s';

    const top = $('stageTop');
    if (top) {
      top.innerHTML = state.scene === 'sea'
        ? `<b>海陆风 · ${state.seaNight ? '夜晚' : '白天'}</b><br>${nm.hotS} ${fmt(s.right, 1)} ℃　${nm.coldS} ${fmt(s.left, 1)} ℃<br>${circulationText()}`
        : `<b>对流箱</b><br>电热板 ${fmt(s.right, 1)} ℃　冰块 ${fmt(s.left, 1)} ℃<br>${circulationText()}`;
    }
    const bot = $('stageBottom');
    if (bot) {
      bot.textContent = state.scene === 'sea'
        /* ★ 这三个数必须从常量算出来，不能写死：写死的「环流高度 96」早就和
           SEA_CELL_H = 76 对不上了 —— 学生照着文字理解尺度，而画面用的是另一个数。 */
        ? `示意尺度：海面 ${SEA_HALF} · 陆地 ${SEA_HALF} · 环流高度 ${SEA_CELL_H}（模型单位）　｜　陆地比热容小，白天升温快、夜晚降温快`
        : `玻璃风箱 ${BOX_W}×${BOX_D}×${BOX_H} cm · 两支玻璃短管 · 电热板 · 冰块 · 示踪烟`;
    }
    const find = $('finding');
    if (find) find.innerHTML = findingText();
    state.drawn.hudDT = +dT().toFixed(3);
    state.drawn.hudV = +flowSpeed().toFixed(4);
    state.drawn.hotT = +s.right.toFixed(2);
    state.drawn.coldT = +s.left.toFixed(2);
    state.drawn.dRho = +dRho().toFixed(6);
    state.drawn.v = +flowSpeed().toFixed(5);
    state.drawn.hotRight = hotRight();
    state.drawn.wind = windLabel();
    state.drawn.scene = state.scene;
    state.drawn.night = state.seaNight;
    state.drawn.metricDT = e3 ? e3.textContent : '';
    state.drawn.metricV = e5 ? e5.textContent : '';
    state.drawn.hudDText = hd ? hd.textContent : '';
    state.drawn.hudVText = hv ? hv.textContent : '';
    state.drawn.findingText = find ? find.textContent : '';
    state.drawn.smokeN = activeSmoke().length;
    state.drawn.tracerShown = activeSmoke().filter((p) => p.sprite.visible).length;
    state.drawn.arrowShown = arrows.filter((a) => a.visible).length;
    state.drawn.heat = state.heat;
    state.drawn.cool = state.cool;
    state.drawn.seaDT = state.seaDT;
    state.drawn.tracerOn = state.tracer;
    state.drawn.arrowsOn = state.arrows;
    state.drawn.microOn = state.micro;
    state.drawn.visSpeed = +visSpeed().toFixed(4);
  }

  function findingText() {
    const s = sideTemps();
    const lo = Math.min(s.left, s.right);   // 只用来算「密度差占冷侧的百分之几」
    const v = flowSpeed();
    if (dT() < 0.05) {
      return `两侧温度一样（ΔT = <i>0.0</i> ℃）⇒ 密度差 <i>0.0000</i> ⇒ 环流速度 <i>0.00</i> m/s：<b>没有温差就没有风</b>。`;
    }
    const pct = (dRho() / rhoAir(lo) * 100);
    if (state.scene === 'sea') {
      /* ★ 同样是「按左/右两侧」而不是「按 hi/lo」：夜里 hi 是海面，
         拿 hi 去填「陆地」就是把两个数对调（见 updateReadouts 里的同一条注记）。 */
      /* ★ 风名同样取自 hotRight()（与 circulationText / windLabel 同一个真源）：
         这里虽然已经被上面 dT() < 0.05 的早退挡住、按 seaNight 写死也等价，
         但「三处文字共用一个推导」才不会在以后改常量时又分家。 */
      return `${state.seaNight ? '夜晚' : '白天'}：陆地 ${fmt(s.right, 1)} ℃、海面 ${fmt(s.left, 1)} ℃，温差 <i>${fmt(dT(), 1)}</i> ℃ ⇒ 空气密度差 <i>${fmt(dRho(), 4)}</i> kg/m³（差 <i>${fmt(pct, 1)}%</i>）⇒ 环流速度 <i>${fmt(v, 2)}</i> m/s。<b>${hotRight() ? '陆地空气上升，近地面风由海洋吹向陆地 = 海风' : '陆地空气下沉，近地面风由陆地吹向海洋 = 陆风'}</b>。`;
    }
    return `热侧 ${fmt(Math.max(s.left, s.right), 1)} ℃、冷侧 ${fmt(lo, 1)} ℃，温差 <i>${fmt(dT(), 1)}</i> ℃ ⇒ 热侧空气密度比冷侧小 <i>${fmt(pct, 1)}%</i> ⇒ 热侧上升、冷侧下沉，箱底气流由冷侧流向热侧，环流速度 <i>${fmt(v, 2)}</i> m/s。`;
  }

  /* ---- 图表：左 ρ–T 曲线，右 v–ΔT 曲线 ---- */
  let chartDpr = 1;
  function resizeChart() {
    const cv = $('chartCanvas'); if (!cv) return;
    chartDpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = cv.clientWidth || 600, h = cv.clientHeight || 234;
    cv.width = Math.round(w * chartDpr);
    cv.height = Math.round(h * chartDpr);
  }
  function chartSize() {
    const cv = $('chartCanvas');
    return { w: cv ? cv.clientWidth : 0, h: cv ? cv.clientHeight : 0, dpr: chartDpr };
  }
  const CH_PAD = { l: 52, r: 12, t: 22, b: 30 };
  const RHO_LO = 0.92, RHO_HI = 1.38, T_LO = -10, T_HI = 100;
  function chartPt(tC, rho, box) {
    return {
      x: box.x0 + (tC - T_LO) / (T_HI - T_LO) * (box.x1 - box.x0),
      y: box.y1 - (rho - RHO_LO) / (RHO_HI - RHO_LO) * (box.y1 - box.y0)
    };
  }
  function drawChart() {
    const cv = $('chartCanvas'); if (!cv) return;
    const g = cv.getContext('2d');
    const S = chartSize();
    if (!S.w || !S.h) return;
    if (cv.width !== Math.round(S.w * S.dpr) || cv.height !== Math.round(S.h * S.dpr)) resizeChart();
    g.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    g.clearRect(0, 0, S.w, S.h);
    const gap = 26;
    const leftW = Math.max(180, (S.w - gap) * 0.60);
    const boxL = { x0: CH_PAD.l, x1: leftW - CH_PAD.r, y0: CH_PAD.t, y1: S.h - CH_PAD.b };
    const boxR = { x0: leftW + gap + 46, x1: S.w - CH_PAD.r, y0: CH_PAD.t, y1: S.h - CH_PAD.b };

    /* ---------- 左：ρ–T ---------- */
    g.fillStyle = '#0e2135';
    g.fillRect(0, 0, leftW, S.h);
    g.strokeStyle = '#24405c'; g.lineWidth = 1;
    g.strokeRect(0.5, 0.5, leftW - 1, S.h - 1);
    g.fillStyle = '#9db4c8'; g.font = '11px Inter, sans-serif';
    g.fillText('空气密度 ρ / (kg·m⁻³)', 8, 14);
    for (let t = T_LO; t <= T_HI; t += 20) {
      const p = chartPt(t, RHO_LO, boxL);
      g.strokeStyle = '#1c3348'; g.beginPath(); g.moveTo(p.x, boxL.y0); g.lineTo(p.x, boxL.y1); g.stroke();
      g.fillStyle = '#6f8ba3'; g.fillText(String(t), p.x - 8, S.h - CH_PAD.b + 15);
    }
    for (let r = 0.95; r <= 1.36; r += 0.05) {
      const p = chartPt(T_LO, r, boxL);
      g.strokeStyle = '#1c3348'; g.beginPath(); g.moveTo(boxL.x0, p.y); g.lineTo(boxL.x1, p.y); g.stroke();
      g.fillStyle = '#6f8ba3'; g.fillText(r.toFixed(2), 6, p.y + 4);
    }
    g.strokeStyle = '#38bdf8'; g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i <= 110; i++) {
      const t = T_LO + (T_HI - T_LO) * i / 110;
      const p = chartPt(t, rhoAir(t), boxL);
      if (i === 0) g.moveTo(p.x, p.y); else g.lineTo(p.x, p.y);
    }
    g.stroke();
    /* 当前热/冷两点 + 密度差括号 */
    const s = sideTemps();
    const hiT = Math.max(s.left, s.right), loT = Math.min(s.left, s.right);
    const pH = chartPt(hiT, rhoAir(hiT), boxL), pC = chartPt(loT, rhoAir(loT), boxL);
    g.strokeStyle = '#facc15'; g.setLineDash([4, 4]); g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(pH.x, pH.y); g.lineTo(pH.x, pC.y); g.lineTo(pC.x, pC.y); g.stroke();
    g.setLineDash([]);
    [[pH, '#fb923c', '热侧'], [pC, '#7dd3fc', '冷侧']].forEach(([p, c, lb]) => {
      g.fillStyle = c; g.beginPath(); g.arc(p.x, p.y, 5, 0, 7); g.fill();
      g.fillStyle = '#dbe9f5'; g.font = '11px Inter, sans-serif';
      g.fillText(lb, p.x + 8, p.y - 7);
    });
    g.fillStyle = '#facc15'; g.font = '11px Inter, sans-serif';
    g.fillText('Δρ = ' + dRho().toFixed(4), (pH.x + pC.x) / 2 + 8, (pH.y + pC.y) / 2);

    /* ---------- 右：v–ΔT ---------- */
    const isSea = state.scene === 'sea';
    const DT_HI = isSea ? 16 : 70;
    const V_HI = isSea ? 7.2 : 1.4;
    g.fillStyle = '#0e2135'; g.fillRect(leftW + gap, 0, S.w - leftW - gap, S.h);
    g.strokeStyle = '#24405c'; g.lineWidth = 1;
    g.strokeRect(leftW + gap + 0.5, 0.5, S.w - leftW - gap - 1, S.h - 1);
    g.fillStyle = '#9db4c8'; g.font = '11px Inter, sans-serif';
    g.fillText('环流速度 v / (m·s⁻¹)', leftW + gap + 8, 14);
    const rPt = (dtc, v) => ({
      x: boxR.x0 + dtc / DT_HI * (boxR.x1 - boxR.x0),
      y: boxR.y1 - clamp(v, 0, V_HI) / V_HI * (boxR.y1 - boxR.y0)
    });
    const stepT = isSea ? 4 : 20;
    for (let t = 0; t <= DT_HI; t += stepT) {
      const p = rPt(t, 0);
      g.strokeStyle = '#1c3348'; g.beginPath(); g.moveTo(p.x, boxR.y0); g.lineTo(p.x, boxR.y1); g.stroke();
      g.fillStyle = '#6f8ba3'; g.fillText(String(t), p.x - 5, S.h - CH_PAD.b + 15);
    }
    const stepV = isSea ? 2 : 0.4;
    for (let v = 0; v <= V_HI + 1e-9; v += stepV) {
      const p = rPt(0, v);
      g.strokeStyle = '#1c3348'; g.beginPath(); g.moveTo(boxR.x0, p.y); g.lineTo(boxR.x1, p.y); g.stroke();
      g.fillStyle = '#6f8ba3'; g.fillText(v.toFixed(isSea ? 0 : 1), leftW + gap + 6, p.y + 4);
    }
    const tcBase = loT;
    g.strokeStyle = '#5eead4'; g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i <= 90; i++) {
      const dtc = DT_HI * i / 90;
      const p = rPt(dtc, vOfDT(dtc, tcBase));
      if (i === 0) g.moveTo(p.x, p.y); else g.lineTo(p.x, p.y);
    }
    g.stroke();
    const pNow = rPt(dT(), flowSpeed());
    g.fillStyle = '#5eead4'; g.beginPath(); g.arc(pNow.x, pNow.y, 5, 0, 7); g.fill();
    g.font = '11px Inter, sans-serif';
    const lbNow = '当前 ' + flowSpeed().toFixed(2) + ' m/s';
    let lx = pNow.x + 8;
    if (lx + g.measureText(lbNow).width > S.w - 6) lx = Math.max(leftW + gap + 6, pNow.x - 10 - g.measureText(lbNow).width);
    g.fillStyle = '#dbe9f5';
    g.fillText(lbNow, lx, Math.max(boxR.y0 + 12, pNow.y - 9));
    state.drawn.chart = {
      hotT: +hiT.toFixed(2), coldT: +loT.toFixed(2),
      hotPx: +pH.x.toFixed(1), coldPx: +pC.x.toFixed(1),
      dRho: +dRho().toFixed(6), vNow: +flowSpeed().toFixed(5),
      xNow: +pNow.x.toFixed(1), yNow: +pNow.y.toFixed(1),
      dtHi: DT_HI, vHi: V_HI, tcBase: +tcBase.toFixed(2)
    };
  }

  /* ---- 微观：同体积内冷区分子多、热区分子少；热的运动快 ---- */
  let microPhase = 0;
  const MICRO_BASE_N = 34;
  const frac = (v) => v - Math.floor(v);
  function microStats() {
    const s = sideTemps();
    const hi = Math.max(s.left, s.right), lo = Math.min(s.left, s.right);
    const rhoC = rhoAir(lo), rhoH = rhoAir(hi);
    const nCold = MICRO_BASE_N;
    const nHot = Math.max(4, Math.round(MICRO_BASE_N * rhoH / rhoC));
    const spCold = Math.sqrt(lo + T0K), spHot = Math.sqrt(hi + T0K);
    return {
      tCold: +lo.toFixed(2), tHot: +hi.toFixed(2),
      nCold, nHot,
      ratio: +(rhoH / rhoC).toFixed(4),
      countRatio: +(nHot / nCold).toFixed(4),
      speedRatio: +(spHot / spCold).toFixed(4)
    };
  }
  function microSize() {
    const cv = $('microCanvas');
    return { w: cv ? cv.clientWidth : 0, h: cv ? cv.clientHeight : 0 };
  }
  function drawMicro(dt) {
    const cv = $('microCanvas'); if (!cv) return;
    if (!state.micro) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = cv.clientWidth || 220, h = cv.clientHeight || 112;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    microPhase += dt;
    const st = microStats();
    const half = w / 2;
    const panels = [
      { x: 0, n: st.nCold, col: '#7dd3fc', bg: '#0b2437', t: st.tCold, sp: 0.42, trail: false, lb: '冷' },
      /* 热的动得更快：真实只快 √(T/T') ≈ 12%，动画里按同一个比例放大 6 倍才看得出来 */
      { x: half, n: st.nHot, col: '#fb923c', bg: '#2a160c', t: st.tHot, sp: 0.42 * (1 + (st.speedRatio - 1) * 6), trail: true, lb: '热' }
    ];
    panels.forEach((P) => {
      g.fillStyle = P.bg;
      g.fillRect(P.x + 1, 1, half - 2, h - 2);
      g.strokeStyle = '#2b4b66'; g.lineWidth = 1;
      g.strokeRect(P.x + 1.5, 0.5, half - 3, h - 1);
      /* ★ 分子按【网格 + 抖动】摆，不能按 sin 哈希撒：
         哈希出来的点会成簇（画面上是「一堆一堆的珠子」而不是均匀分布的气体），
         而且「热区分子更稀」这件事会被簇的疏密盖掉、根本看不出来。 */
      const availW = half - 20, availH = h - 36;
      const cols = Math.max(2, Math.round(Math.sqrt(P.n * availW / Math.max(1, availH))));
      const rows = Math.max(2, Math.ceil(P.n / cols));
      const cw = availW / cols, chh = availH / rows;
      const rad = clamp(Math.min(cw, chh) * 0.30, 1.7, 3.4);
      for (let i = 0; i < P.n; i++) {
        const ci = i % cols, ri = Math.floor(i / cols);
        const j1 = frac(Math.sin(i * 12.9898) * 43758.5453) - 0.5;
        const j2 = frac(Math.sin(i * 78.233) * 12345.6789) - 0.5;
        const px = P.x + 10 + (ci + 0.5) * cw + j1 * cw * 0.5 + Math.cos(microPhase * 1.6 + i) * P.sp * 4;
        const py = 18 + (ri + 0.5) * chh + j2 * chh * 0.5 + Math.sin(microPhase * 2.1 + i * 1.7) * P.sp * 4;
        g.fillStyle = P.col;
        g.beginPath(); g.arc(px, py, rad, 0, 7); g.fill();
        if (P.trail) {
          g.strokeStyle = P.col; g.globalAlpha = 0.45; g.lineWidth = 1;
          g.beginPath();
          g.moveTo(px, py);
          g.lineTo(px - Math.cos(microPhase * 1.6 + i) * 8, py - Math.sin(microPhase * 2.1 + i * 1.7) * 8);
          g.stroke();
          g.globalAlpha = 1;
        }
      }
      g.fillStyle = P.col; g.font = 'bold 11px Inter, sans-serif';
      g.fillText(P.lb + ' ' + P.t.toFixed(1) + ' ℃ · ' + P.n + ' 个', P.x + 7, 12);
    });
    g.fillStyle = '#94a3b8'; g.font = '10px Inter, sans-serif';
    g.fillText('同样大的一块空间', 6, h - 5);
    g.fillText('分子数比 ' + (st.nHot / st.nCold).toFixed(2), half + 6, h - 5);
    const txt = $('microText');
    if (txt) txt.textContent = '热区分子少 ' + (100 - st.countRatio * 100).toFixed(1) + '%，所以热空气密度小';
    state.drawn.micro = st;
  }

  /* ============================ 十八、记录 / 步骤 ============================ */
  const HINT_DONE = '记录好了 —— 再调一次滑块、再记一行，两行一对比就看出来了。';
  function pushRecord() {
    const s = sideTemps();
    state.records.push({
      scene: sceneName(),
      hot: Math.max(s.left, s.right),
      cold: Math.min(s.left, s.right),
      dt: dT(),
      dRho: dRho(),
      v: flowSpeed(),
      wind: windLabel()
    });
    renderRecords();
  }
  function clearRecords() { state.records.length = 0; renderRecords(); }
  function renderRecords() {
    const tb = $('records'), ts = $('recordsSide');
    const R = state.records;
    if (tb) {
      tb.innerHTML = R.length
        ? R.map((r, i) => `<tr><td>${r.scene}</td><td>${r.hot.toFixed(1)} ℃</td><td>${r.cold.toFixed(1)} ℃</td><td>${r.dt.toFixed(1)}</td><td>${r.dRho.toFixed(4)}</td><td>${r.v.toFixed(2)}</td><td>${r.wind}</td></tr>`).join('')
        : '<tr><td colspan="7" class="empty">尚无记录，先调一次滑块再点“记录数据”</td></tr>';
    }
    if (ts) {
      ts.innerHTML = R.length
        ? R.map((r, i) => `<tr><td>${i + 1}</td><td>${r.scene.replace('海陆风 · ', '')}</td><td>${r.dt.toFixed(1)}</td><td>${r.v.toFixed(2)}</td></tr>`).join('')
        : '<tr><td colspan="4" class="empty">还没有记录</td></tr>';
    }
    const sum = $('recSum');
    if (sum) {
      if (!R.length) sum.textContent = '点上面的按钮开始记录。';
      else {
        const sorted = R.slice().sort((a, b) => a.dt - b.dt);
        let mono = true;
        for (let i = 1; i < sorted.length; i++) if (sorted[i].v < sorted[i - 1].v - 1e-9) mono = false;
        sum.innerHTML = `已记 <b>${R.length}</b> 行；按 ΔT 排序后速度${mono ? '<b>单调不减</b>' : '出现回落（不同场景的有效高度不同，跨场景比较不成立）'}。`;
      }
    }
    const sm = $('summary');
    if (sm) sm.textContent = R.length
      ? `共 ${R.length} 行。ΔT = 0 那一行的速度应当正好是 0.00 —— 那就是「没有温差就没有风」。`
      : '建议记录四组：满档、减半、接近零、零温差。对比最后两列 —— 速度一栏的变化规律，就是「风的形成」这道题的答案。';
    state.drawn.recCount = R.length;
  }
  $('recordBtn').addEventListener('click', (e) => {
    pushRecord();
    const b = e.currentTarget;
    b.classList.remove('hit');
    void b.offsetWidth;
    b.classList.add('hit');
    const hint = $('recordHint');
    if (hint) hint.textContent = HINT_DONE;
    requestRender();
  });

  const STEPS = [
    { t: '01 认识器材', h: '玻璃风箱的两支短管下面，一边是<b>电热板</b>、一边是<b>冰块</b>。空气看不见，所以先用烟当<b>示踪剂</b>：点「重新投放烟雾」，看烟往哪儿走。' },
    { t: '02 热空气上升', h: '电热板一侧的空气受热膨胀、密度变小（ρ ∝ 1/T），被周围密度大的冷空气「挤」上去 —— 这就是<b>热空气上升</b>。把「加热强度」拖到 0，上升立刻停。' },
    { t: '03 闭合的环流', h: '烟从冷管口进、沿箱底横穿到热侧、在电热板上方升起、再从管口上方绕回来 —— 走的是<b>一条闭合的回路</b>。四个方向：热侧<b>上升</b>、冷侧<b>下沉</b>、箱底<b>冷→热</b>、箱顶<b>热→冷</b>，缺一个都转不起来。' },
    { t: '04 温差越大风越大', h: '驱动压强 Δp = Δρ·g·h，环流速度 v = √(2Δp/ρ̄)。把「加热强度」「冷却强度」一起往下拖，看 Δρ 和 v 一起变小；<b>两边都拖到 0，ΔT = 0，速度正好是 0</b> —— 没有温差就没有风。' },
    { t: '05 海陆风：白天', h: '陆地比热容小，白天晒得快、比海面热 ⇒ 陆上空气上升、海面空气下沉 ⇒ 近地面风<b>由海洋吹向陆地</b>，叫<b>海风</b>。切到海陆风场景看箭头方向。' },
    { t: '05 海陆风：夜晚', h: '夜里陆地降温快、比海面凉 ⇒ 陆上空气下沉、海面空气上升 ⇒ 近地面风<b>由陆地吹向海洋</b>，叫<b>陆风</b>。风向反过来，根源只有一个：<b>哪一边的空气更热</b>。' }
  ];
  function renderStep() {
    const el = $('stepDetail');
    if (!el) return;
    const s = STEPS[state.step] || STEPS[0];
    el.innerHTML = `<strong>${s.t}</strong>　${s.h}`;
    state.drawn.step = state.step;
    state.drawn.stepText = el.textContent;
  }
  function setStep(i) {
    const n = clamp(i, 0, STEPS.length - 1);
    state.step = n;
    document.querySelectorAll('[data-step]').forEach((b) => b.classList.toggle('active', +b.dataset.step === n));
    /* 步骤 4/5 直接切到对应场景，学生不用自己去点 */
    if (n === 4) { setScene('sea'); setSeaNight(false); }
    else if (n === 5) { setScene('sea'); setSeaNight(true); }
    else if (n <= 3 && state.scene === 'sea') setScene('box');
    renderStep();
    requestRender();
  }
  document.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => setStep(+b.dataset.step)));

  /* ============================ 十九、渲染循环 ============================ */
  let dirty = true;
  const requestRender = () => { dirty = true; };
  let uiAcc = 0;

  function syncUI() {
    updateReadouts();
    drawChart();
    if (state.micro) drawMicro(0.016);
    updateArrows();
  }
  /* ★ 一帧 = 推进物理 → 需要时同步侧栏 → 需要时重画。
     真实 rAF 与自检的 driveAnim 共用这一个函数（只共用 frameStep 是不够的，
     那样自检就会漏掉「动画推进后侧栏没跟着变」这类 bug）。 */
  function frameStep(dt) {
    const before = { dT: dT(), v: flowSpeed() };
    state.t += dt;
    if (state.tracer) advect(dt);
    uiAcc += dt;
    if (uiAcc >= 0.10) { uiAcc = 0; syncUI(); }
    if (dirty) { renderer.render(scene, camera); dirty = false; }
    return before.v !== flowSpeed();
  }
  function driveAnim(sec, dt) {
    const n = Math.max(1, Math.round(sec / (dt || 1 / 60)));
    for (let k = 0; k < n; k++) frameStep(dt || 1 / 60);
    renderer.render(scene, camera);
    return { frames: n, dropped: state.dropped };
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

  /* ============================ 二十、启动 ============================ */
  canvas.style.cursor = 'grab';
  applySceneLook();
  applyHeatLook();
  setView('angle');
  updateCamera();
  resize();
  resizeChart();
  dropSmoke();
  updateReadouts();
  renderRecords();
  renderStep();
  syncUI();
  drawMicro(0.016);

  const ro = new ResizeObserver(() => { resize(); resizeChart(); drawChart(); drawMicro(0.016); });
  ro.observe(stage);
  window.addEventListener('resize', () => { resize(); resizeChart(); drawChart(); drawMicro(0.016); });

  /* ============================ 二十一、供无头验收脚本读取 ============================ */
  window.__windLab = {
    state, view, VIEWS, toggles,
    camera, renderer, scene,
    rig, seaRig, boxMesh, chimneys, heatGroup, heatBase, coils, coldGroup, ice, tray,
    smokeGroup, arrows, arrowGroup, bench, backdrop, sky, sun, moon, seaPlane, landBox,
    /* 物理 */
    RHO0, T0K, GRAV, AMB, HEAT_SPAN, COOL_SPAN, SEA_T, SEA_DT_MAX, COL_H_M,
    rhoAir, sideTemps, hotRight, dT, dRho, driveDP, flowSpeed, vOfDT,
    /* 环流几何 */
    CELL, cellGeom, flowAt, psiAt, vertFlux, horizFlux, divAt, visSpeed,
    BOX_W, BOX_D, BOX_H, CH_R, CH_H, CH_X, CH_Y0, CH_Y1, CELL_H, HEAT_H, COLD_H,
    SEA_HALF, LAND_Y, SEA_SPAN, SEA_DEPTH, SEA_CELL_W, SEA_CELL_H, SEED, SMOKE_N, SMOKE_SIZE, SMOKE_ALPHA, ARROW_PTS, ARROW_K,
    /* 控件 */
    setScene, setView, setHeat, setCool, setSeaNight, setSeaDT,
    setTracer, setArrows, setMicro, setStep, resetAll,
    updateCamera, resize, updateReadouts, syncUI, renderStep, renderRecords,
    pushRecord, clearRecords, sceneFrame, applySceneLook, applyHeatLook,
    dropSmoke, driveAnim, frameStep, updateArrows, drawChart, drawMicro,
    chartPt, chartSize, microStats, microSize, windLabel, sceneName, findingText,
    circulationText, NO_WIND,
    STEPS, CH_PAD, RHO_LO, RHO_HI, T_LO, T_HI, SEA_TINT, MICRO_BASE_N,
    /* 记录 / 读数 */
    drawn: () => state.drawn,
    metrics() {
      return {
        hotT: +Math.max(sideTemps().left, sideTemps().right).toFixed(3),
        coldT: +Math.min(sideTemps().left, sideTemps().right).toFixed(3),
        dT: +dT().toFixed(4), dRho: +dRho().toFixed(6),
        v: +flowSpeed().toFixed(5), vis: +visSpeed().toFixed(4),
        hotRight: hotRight(), scene: state.scene, night: state.seaNight,
        dTText: $('metricDT') ? $('metricDT').textContent : '',
        vText: $('metricV') ? $('metricV').textContent : '',
        hudDT: $('hudDT') ? $('hudDT').textContent : '',
        hudV: $('hudV') ? $('hudV').textContent : ''
      };
    },
    /* 示踪烟 */
    smokeCount() { return activeSmoke().length; },
    smokeVisibleCount() { return activeSmoke().filter((p) => p.sprite.visible).length; },
    smokePos(i) {
      const p = activeSmoke()[i];
      if (!p) return null;
      return { x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3), psi: +psiAt(p.x, p.y).toFixed(6), psi0: +p.psi0.toFixed(6), visible: p.sprite.visible };
    },
    smokeAll() {
      return activeSmoke().map((p) => ({ x: p.x, y: p.y, z: p.z, psi: psiAt(p.x, p.y), psi0: p.psi0, visible: p.sprite.visible }));
    },
    /* 粒子在【画布 CSS 像素】里的包围盒（原点左上）—— 像素断言靠它定位取样块，
       而不是把坐标写死（写死的坐标在换视口/换场景后就不是那块地方了）。 */
    smokeScreenBox() {
      camera.updateMatrixWorld();
      const r = renderer.domElement.getBoundingClientRect();
      const v = new THREE.Vector3();
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, n = 0;
      activeSmoke().forEach((p) => {
        if (!p.sprite.visible) return;
        v.set(p.x, p.y, p.z).project(camera);
        const sx = (v.x * 0.5 + 0.5) * r.width, sy = (-v.y * 0.5 + 0.5) * r.height;
        x0 = Math.min(x0, sx); y0 = Math.min(y0, sy);
        x1 = Math.max(x1, sx); y1 = Math.max(y1, sy);
        n++;
      });
      return n ? { x0: +x0.toFixed(1), y0: +y0.toFixed(1), x1: +x1.toFixed(1), y1: +y1.toFixed(1), n, W: r.width, H: r.height } : null;
    },
    /* ★ 烟最密的那个点的屏幕坐标 —— 像素断言必须落在【真的有烟的地方】。
       直接用上面那个包围盒的中心是错的：环流是一圈，包围盒的正中央恰恰是
       空心的涡心（实测「开烟/关烟」在涡心处的亮度差正好是 0.00，断言永远红）。
       这里取「半径 34 px 内邻居最多」的那个粒子，必然落在流线上。 */
    smokeScreenSpot() {
      camera.updateMatrixWorld();
      const r = renderer.domElement.getBoundingClientRect();
      const v = new THREE.Vector3();
      const pts = [];
      activeSmoke().forEach((p) => {
        if (!p.sprite.visible) return;
        v.set(p.x, p.y, p.z).project(camera);
        pts.push({ x: (v.x * 0.5 + 0.5) * r.width, y: (-v.y * 0.5 + 0.5) * r.height });
      });
      if (!pts.length) return null;
      let best = pts[0], bn = -1;
      pts.forEach((p) => {
        let n = 0;
        pts.forEach((q) => { if (Math.hypot(p.x - q.x, p.y - q.y) < 34) n++; });
        if (n > bn) { bn = n; best = p; }
      });
      return { x: +best.x.toFixed(1), y: +best.y.toFixed(1), near: bn, n: pts.length, W: r.width, H: r.height };
    },
    /* 箭头读数：位置 / 方向 / 颜色 —— 「方向反了」必须能被数值抓住 */
    arrowInfo(i) {
      const pts = ARROW_PTS[state.scene];
      const a = arrows[i];
      if (!a || i >= pts.length) return null;
      const [x, y] = pts[i];
      const f = flowAt(x, y);
      const d = new THREE.Vector3();
      /* ArrowHelper 的方向存在 quaternion 里，用 +Y 转过去取回来 */
      d.set(0, 1, 0).applyQuaternion(a.quaternion);
      return {
        x, y, u: +f.u.toFixed(5), v: +f.v.toFixed(5),
        dirX: +d.x.toFixed(4), dirY: +d.y.toFixed(4),
        len: +((a.userData && a.userData.len) || 0).toFixed(4), visible: a.visible,
        color: a.cone && a.cone.material ? '#' + a.cone.material.color.getHexString() : null
      };
    },
    /* 某件器材 / 天体在【画布 CSS 像素】里的落点（原点左上）——
       像素类断言靠它定位取样块，而不是把坐标写死（写死的坐标换视口就不对了）。 */
    screenOf(which) {
      camera.updateMatrixWorld();
      const r = renderer.domElement.getBoundingClientRect();
      const o = { hot: heatBase, cold: ice, tray, sun, moon, box: boxMesh, sea: seaPlane, land: landBox }[which];
      if (!o) return null;
      const v = new THREE.Vector3();
      o.getWorldPosition(v);
      v.project(camera);
      return { x: +((v.x * 0.5 + 0.5) * r.width).toFixed(1), y: +((-v.y * 0.5 + 0.5) * r.height).toFixed(1), W: r.width, H: r.height, visible: !!o.visible };
    },
    /* 场景里实际存在的网格数 —— 「运行时不新建网格」的可证伪写法 */
    meshCount() {
      let n = 0;
      scene.traverse((o) => { if (o.isMesh) n++; });
      return n;
    },
    /* ------------------------------------------------------------------
       像素级探针：取 GL 缓冲区里一块区域的平均色。
       ★ 必须在 renderer.render() 之后【同步】readPixels —— 默认帧缓冲的内容
         在下一次合成后就没了；隔一个 await 再读会拿到全黑。
       坐标是【CSS 像素、原点在左上】，内部按 devicePixelRatio 换算、并按
       readPixels 的左下原点翻转。
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
    /* 两个状态之间的整屏像素差（先把某一组物件藏起来再渲染，比较两次结果）。 */
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
    }
  };
})();
