import * as THREE from './assets/optics-three.min.js';

/* ============================================================================
   液化的两种方法 —— 三维写实实验台
   ---------------------------------------------------------------------------
   世界坐标单位：厘米（cm），y 轴向上，实验台台面为 y = 0。

   两个场景（同一张实验台、两种器材，切换时整组器材换掉）：
     ① press（压缩体积）：大号玻璃注射器 + 可推活塞 + 压力表。筒内封着乙醚蒸气，
        推活塞 ⇒ 体积变小 ⇒ 压强上升 ⇒ 到达饱和蒸气压后筒壁上出现液滴；
        拉回来 ⇒ 液滴完全消失（可逆）。
     ② cool （降低温度）：烧杯装热水冒白气 + 支架夹住一块可调温的玻璃片。
        玻璃片温度低于露点 ⇒ 表面结出水珠；越低结得越多；空气越潮露点越高。

   物理内核（三条，都是「唯一入口」，画面与读数同源）：
     ① 乙醚饱和蒸气压走 Clausius–Clapeyron，以【沸点 34.6 ℃ / 1 atm】为锚点：
        p_sat(T) = p_atm · exp[ −ΔH_vap/R · (1/T − 1/T_boil) ]
        —— 不写「档位 → 压强」的查表：那样温度档和饱和压强可以互相矛盾。
     ② 等温压缩：p = nRT/V。液化判据不是「压了就有」，而是 p > p_sat；
        液化量 n_liq = n − p_sat·V/(RT)（此时筒内压强钉在 p_sat，不再上升）。
        ⇒ 阈值体积 V_thr = nRT/p_sat 随温度升高而【变小】（越热越难压液）。
     ③ 露点走 Magnus 公式：T_dew = 243.12·γ/(17.62 − γ)，γ = ln(RH) + 17.62T/(243.12+T)。
        结露判据 T_glass < T_dew；结露量随温差单调增、在 0 处连续为 0。
     ④ 两条路径都【放热】：Q = n_liq · ΔH_vap。这不是装饰 ——
        压缩体积时筒壁会热、降温液化时玻璃片会回暖，都是它在起作用。

   活塞位置与玻璃片温度都走【一阶滞后】：推/调之后不是瞬间跳到位，
   否则「读数是一个真物理量」这条就退化成设定值的另一个写法。
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
    g.arcTo(x + w, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  };

  /* ==========================================================================
     一、物理内核
     ========================================================================== */

  /* ---- 乙醚的物性（教学量级，但都是真值） ---- */
  const R_GAS = 8.314;              // J/(mol·K)
  const P_ATM = 101.325;            // kPa
  const T_BOIL_ETHER = 34.6;        // ℃，乙醚在 1 atm 下的沸点
  const DH_VAP_ETHER = 26500;       // J/mol，乙醚汽化热
  const M_ETHER = 74.12;            // g/mol
  const RHO_ETHER = 0.7134;         // g/cm³（液态乙醚）

  /* 饱和蒸气压：Clausius–Clapeyron，以沸点为锚点。
     ⇒ T = 34.6 ℃ 时恒等于 101.325 kPa（这是「沸点」的定义，可以直接断言）。 */
  function pSatEther(T) {
    const a = 1 / (T + 273.15), b = 1 / (T_BOIL_ETHER + 273.15);
    return P_ATM * Math.exp(-(DH_VAP_ETHER / R_GAS) * (a - b));
  }

  /* ---- 注射器几何 ---- */
  /* 温度档取 20 / 30 / 40 ℃：三档都必须能压出可观的液化量。
     若取到 60 ℃，饱和蒸气压涨到 223 kPa，阈值体积只剩 46 cm³ ——
     活塞几乎要推到底才刚见液滴，气腔被压成一条缝、被法兰挡住，教学上就废了。 */
  const TEMP_LEVELS = [20, 30, 40];         // ℃ 环境/筒内温度档
  const TEMP_LABEL = ['20 ℃ · 室温', '30 ℃ · 温水', '40 ℃ · 温热'];

  const BAR_R = 2.4;                        // 筒内半径 cm
  const BAR_X0 = -9.0, BAR_X1 = 13.0;       // 筒内两端 x（轴长 22 cm）
  /* ★ 活塞行程的下限不能太小：气腔就是「液滴长在哪儿」的地方，
     只剩 1.5 cm 时液滴会被法兰和活塞头夹在中间、根本看不见。取 4 cm。 */
  const PIST_MIN = -5.0, PIST_MAX = 13.0;   // 气体长度 4 ~ 22 cm
  const ROD_LEN = 12.0;                     // 推杆长度（随活塞整体平移）

  const gasVolCm3 = (xp) => Math.PI * BAR_R * BAR_R * (xp - BAR_X0);
  const GAS_V_MAX = gasVolCm3(PIST_MAX);    // ≈ 398 cm³
  const GAS_V_MIN = gasVolCm3(PIST_MIN);    // ≈ 72 cm³

  /* n 由「20 ℃、活塞在最大体积处时筒内压强 = 35 kPa」定标 ——
     ★ 不写死摩尔数：几何一改（筒变粗、行程变长）模型就跟着走，不会脱钩。 */
  const P_FILL = 35;                        // kPa
  const T_REF = 20;                         // ℃
  const N_MOL = (P_FILL * 1000) * (GAS_V_MAX * 1e-6) / (R_GAS * (T_REF + 273.15));

  /* 等温理想气体压强（假设全部还是气态） */
  function pIdeal(xp, T) {
    const V = gasVolCm3(xp) * 1e-6;         // m³
    return N_MOL * R_GAS * (T + 273.15) / V / 1000;   // kPa
  }
  /* 筒内【实际】压强：一旦开始液化就钉在饱和蒸气压上，不再随体积上升 */
  function pActualAt(xp, T) { return Math.min(pIdeal(xp, T), pSatEther(T)); }
  /* 已液化的物质的量（mol）：p ≤ p_sat 时恒为 0 */
  function nLiqAt(xp, T) {
    const ps = pSatEther(T);
    if (pIdeal(xp, T) <= ps) return 0;
    const V = gasVolCm3(xp) * 1e-6;
    return Math.max(0, N_MOL - ps * 1000 * V / (R_GAS * (T + 273.15)));
  }
  function liqFracAt(xp, T) { return clamp(nLiqAt(xp, T) / N_MOL, 0, 1); }
  function liqVolAt(xp, T) { return nLiqAt(xp, T) * M_ETHER / RHO_ETHER; }   // cm³
  function heatAt(xp, T) { return nLiqAt(xp, T) * DH_VAP_ETHER; }            // J
  /* 阈值体积：p = p_sat 的那一刻。温度越高 ⇒ p_sat 越大 ⇒ V_thr 越小。 */
  function thrVol(T) { return N_MOL * R_GAS * (T + 273.15) / (pSatEther(T) * 1000) * 1e6; }
  function thrX(T) { return BAR_X0 + thrVol(T) / (Math.PI * BAR_R * BAR_R); }

  /* ---- 露点与结露（场景 ②） ---- */
  const AIR_LEVELS = [20, 30, 40];          // ℃ 空气温度档
  const AIR_LABEL = ['20 ℃', '30 ℃', '40 ℃'];
  const RH_LEVELS = [0.35, 0.60, 0.85];     // 相对湿度档
  const RH_LABEL = ['干燥 35%', '适中 60%', '潮湿 85%'];
  const TG_MIN = -5, TG_MAX = 45;           // 玻璃片温度可调范围 ℃
  const K_COND = 6;                         // 结露量的半值参数（℃）
  const M_COND_MAX = 0.12;                  // g，玻璃片上最多凝住的水
  const DH_VAP_W = 2260;                    // J/g，水的汽化热

  /* Magnus 公式：给定气温与相对湿度算露点 */
  function dewPoint(T, rh) {
    const g = Math.log(rh) + 17.62 * T / (243.12 + T);
    return 243.12 * g / (17.62 - g);
  }
  /* ★ 结露量的【唯一入口】：d ≤ 0 时严格为 0，之后随温差单调增、有上界。
     写成 exp/分段查表都行，但必须是 d 的严格单调函数 —— 否则「越冷结得越多」
     这条断言抓不住东西。 */
  function condAmountAt(tg) {
    const d = dewNow() - tg;
    return d <= 0 ? 0 : d / (d + K_COND);
  }
  function condMassAt(tg) { return condAmountAt(tg) * M_COND_MAX; }
  function condHeatAt(tg) { return condMassAt(tg) * DH_VAP_W; }

  /* ==========================================================================
     二、程序化贴图
     🔴 CanvasTexture 必须设 colorSpace = SRGBColorSpace，否则 canvas 里 sRGB
        编码的像素会被当成【线性】值用，线性亮度被抬高约 5 倍 —— 白器材、白雾
        全落在浅灰底上分不出来。
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

  /* 软边光斑 —— 气体/雾必须用这张贴图 + NormalBlending。
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

  /* 筒身刻度：透明底 + 白色刻度线 + 数字。贴在玻璃筒外壁上。
     UV：v=0 ↔ 筒的 −x 端（BAR_X0），v=1 ↔ +x 端（BAR_X1）；three 默认 flipY，
     所以 canvas 里 y = (1 − v) · H。
     环绕方向 u 与世界的对应（rotateZ(π/2) 之后）：u=0 → +Z、0.25 → −Y、
     0.5 → −Z、0.75 → +Y。默认 45° 机位在 −x / +y / +z 一侧，能看到的是
     u ∈ (0.75, 1) —— 所以刻度印在 u ≈ 0.875，另在对面 0.375 也印一条，
     这样从任意水平角度都能看到一组。 */
  function makeBarrelMap() {
    const W = 1024, H = 256;
    const c = newCanvas(W, H), g = c.getContext('2d');
    g.clearRect(0, 0, W, H);
    const vToY = (v) => (1 - v) * H;
    const xToV = (x) => (x - BAR_X0) / (BAR_X1 - BAR_X0);
    const U_SETS = [0.875, 0.375];
    const HALF = 0.040;                 // 每侧刻度横向半宽（占圆周的比例）
    for (let x = Math.ceil(BAR_X0); x <= BAR_X1; x++) {
      const v = xToV(x), y = vToY(v);
      const major = (x % 5 === 0);
      g.strokeStyle = major ? 'rgba(255,255,255,0.95)' : 'rgba(226,240,252,0.62)';
      g.lineWidth = major ? 5 : 3;
      U_SETS.forEach((uc) => {
        g.beginPath();
        g.moveTo((uc - HALF) * W, y);
        g.lineTo((uc + HALF) * W, y);
        g.stroke();
      });
      if (major && x > BAR_X0) {
        g.fillStyle = 'rgba(255,255,255,0.92)';
        g.font = 'bold 26px system-ui, sans-serif';
        g.textAlign = 'center'; g.textBaseline = 'bottom';
        U_SETS.forEach((uc) => g.fillText(String(Math.round(x - BAR_X0)), uc * W, y - 6));
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = MAX_ANISO;
    return t;
  }

  /* 压力表表盘：半圆刻度 0 ~ 250 kPa，指针由单独的网格画 */
  const DIAL_MAX = 250;                     // kPa
  function makeDialMap() {
    const S = 512;
    const c = newCanvas(S, S), g = c.getContext('2d');
    g.clearRect(0, 0, S, S);
    const cx = S / 2, cy = S / 2, R = S / 2 - 6;
    const bg = g.createRadialGradient(cx, cy * 0.7, 10, cx, cy, R);
    bg.addColorStop(0, '#f7fafc'); bg.addColorStop(1, '#c7d2dc');
    g.fillStyle = bg;
    g.beginPath(); g.arc(cx, cy, R, 0, 7); g.fill();
    g.strokeStyle = '#8b98a6'; g.lineWidth = 9;
    g.beginPath(); g.arc(cx, cy, R - 4, 0, 7); g.stroke();
    /* 刻度：0 在 −140°，满量程在 +140°（钟表式） */
    const A0 = -140 * Math.PI / 180, A1 = 140 * Math.PI / 180;
    const pt = (a, r) => [cx + Math.sin(a) * r, cy - Math.cos(a) * r];
    for (let i = 0; i <= 50; i++) {
      const f = i / 50, a = A0 + (A1 - A0) * f;
      const major = i % 5 === 0;
      const [x1, y1] = pt(a, R - 26), [x2, y2] = pt(a, R - (major ? 62 : 42));
      g.strokeStyle = major ? '#1f2937' : '#6b7683';
      g.lineWidth = major ? 6 : 3;
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      if (major) {
        const [tx, ty] = pt(a, R - 96);
        g.fillStyle = '#111827';
        g.font = 'bold 30px system-ui, sans-serif';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(String(Math.round(DIAL_MAX * f)), tx, ty);
      }
    }
    g.fillStyle = '#0f172a';
    g.font = 'bold 27px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('kPa', cx, cy + R * 0.52);
    g.font = 'bold 24px system-ui, sans-serif';
    g.fillStyle = '#334155';
    g.fillText('筒内压强', cx, cy - R * 0.42);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  function makeLabelMap(text, bg, fg) {
    const W = 256, H = 96;
    const c = newCanvas(W, H), g = c.getContext('2d');
    g.clearRect(0, 0, W, H);
    g.fillStyle = bg; roundRect(g, 4, 4, W - 8, H - 8, 18); g.fill();
    g.strokeStyle = fg; g.lineWidth = 3; roundRect(g, 4, 4, W - 8, H - 8, 18); g.stroke();
    g.fillStyle = fg; g.font = 'bold 52px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, W / 2, H / 2 + 2);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  function makeLabelSprite(text, bg, fg, w) {
    const m = new THREE.SpriteMaterial({ map: makeLabelMap(text, bg, fg), transparent: true, depthTest: false });
    const s = new THREE.Sprite(m);
    const k = w || 5.2;
    s.scale.set(k, k * 0.375, 1);
    return s;
  }

  /* ==========================================================================
     三、状态
     ========================================================================== */
  const state = {
    scene: 'press',             // press（压缩体积） | cool（降低温度）
    running: false,
    speed: 4,
    t: 0,                       // 仿真时刻 s
    /* 场景 ① */
    levels: { temp: 0, air: 1, rh: 1 },   // 温度档 / 空气温度档 / 相对湿度档
    pistX: PIST_MAX,            // 活塞头的【当前】位置（一阶滞后）
    pistTarget: PIST_MAX,       // 目标位置
    /* 场景 ② */
    tg: 20,                     // 玻璃片【当前】温度（一阶滞后）
    tgTarget: 20,
    /* 动画量 */
    vaporPhase: 0,
    steamPhase: 0,
    step: 0,
    records: [],
    drawn: {}                   // ★ 只放【画出来的量】，不放输入
  };
  const toggles = { vapor: true, drops: true, heat: true };

  const SCENES = ['press', 'cool'];

  const VIEWS = {
    front: { yaw: -0.06, pitch: 0.13, dist: 56, ty: 9.0 },
    angle: { yaw: -0.52, pitch: 0.22, dist: 58, ty: 9.0 },
    top:   { yaw: -0.46, pitch: 0.86, dist: 54, ty: 8.0 },
    close: { yaw: -0.40, pitch: 0.10, dist: 30, ty: 9.0 }
  };
  const view = { ...VIEWS.angle };

  /* ★ 取景必须【按场景给】，而且 setScene() 里必须重新 updateCamera()。
     两个场景的器材完全不同：① 横着 40 cm 长的注射器（扁、低）；
     ② 烧杯 + 支架 + 悬在高处的玻璃片（高、偏左）。沿用上一档的机位会顶出画布。 */
  function sceneFrame() {
    if (state.scene === 'cool') return { tx: -1.0, ty: 11.0, distK: 1.08, pitchK: 0.96 };
    return { tx: 2.4, ty: 9.6, distK: 0.95, pitchK: 1.0 };
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
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(320, 190), new THREE.MeshBasicMaterial({ map: makeBackdropMap() }));
  backdrop.position.set(0, 62, -150);
  scene.add(backdrop);

  const bench = new THREE.Mesh(new THREE.BoxGeometry(120, 3.4, 74),
    new THREE.MeshStandardMaterial({ map: makeBenchMap(), roughness: 0.82, metalness: 0.05 }));
  bench.position.set(0, -1.7, 0);
  bench.receiveShadow = true;
  scene.add(bench);

  const steelMap = makeSteelMap();
  const STEEL = new THREE.MeshStandardMaterial({ map: steelMap, color: '#dfe5ea', roughness: 0.32, metalness: 0.86 });
  const DARKRUBBER = new THREE.MeshStandardMaterial({ color: '#2f3742', roughness: 0.78, metalness: 0.05 });
  const GLASS = new THREE.MeshPhysicalMaterial({
    color: '#cfe3f5', roughness: 0.06, metalness: 0, transparent: true, opacity: 0.20,
    side: THREE.DoubleSide, depthWrite: false, clearcoat: 0.9, clearcoatRoughness: 0.05
  });

  /* -------------------------------------------------------------------------
     场景 ①：注射器 + 压力表
     ---------------------------------------------------------------------- */
  const SYR_Y = 9.0;
  const pressGroup = new THREE.Group();
  scene.add(pressGroup);

  /* 支架：立柱 + 横臂（夹住喷嘴端） */
  const standRod = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 20, 22), STEEL);
  standRod.position.set(-16.0, 10.0, 0);
  standRod.castShadow = true;
  pressGroup.add(standRod);
  const standBase = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.0, 0.7, 28), STEEL);
  standBase.position.set(-16.0, 0.35, 0);
  standBase.castShadow = true;
  pressGroup.add(standBase);
  const standArm = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.62, 0.62), STEEL);
  standArm.position.set(-13.9, SYR_Y, 0);
  standArm.castShadow = true;
  pressGroup.add(standArm);
  const clampRing = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.24, 12, 30), STEEL);
  clampRing.position.set(-11.5, SYR_Y, 0);
  clampRing.rotation.y = Math.PI / 2;
  pressGroup.add(clampRing);

  /* 玻璃筒：筒身（清玻璃）与刻度层（只画刻度、不透明底）分成两个网格。
     🔴 合成一个网格时，刻度会被材质 opacity 一起压暗 —— 深色背景下刻度基本看不见。
     分成两层后刻度走 MeshBasicMaterial 全不透明，玻璃只是它下面的一层壳。 */
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(BAR_R, BAR_R, BAR_X1 - BAR_X0, 48, 1, true),
    new THREE.MeshPhysicalMaterial({
      color: '#cfe3f5', roughness: 0.06, metalness: 0, transparent: true, opacity: 0.16,
      side: THREE.DoubleSide, depthWrite: false, clearcoat: 1.0, clearcoatRoughness: 0.04
    }));
  barrel.geometry.rotateZ(Math.PI / 2);      // 轴向 +Y → +X（v=1 ↔ +x 端）
  barrel.position.set((BAR_X0 + BAR_X1) / 2, SYR_Y, 0);
  pressGroup.add(barrel);

  const barrelScale = new THREE.Mesh(new THREE.CylinderGeometry(BAR_R + 0.012, BAR_R + 0.012, BAR_X1 - BAR_X0, 48, 1, true),
    new THREE.MeshBasicMaterial({ map: makeBarrelMap(), transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  barrelScale.geometry.rotateZ(Math.PI / 2);
  barrelScale.position.set((BAR_X0 + BAR_X1) / 2, SYR_Y, 0);
  pressGroup.add(barrelScale);

  /* 两端的亮环：把「这是一根管子」勾出来（深色背景上只靠透明度读不出圆柱） */
  [BAR_X0, BAR_X1].forEach((x) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(BAR_R, 0.075, 10, 40),
      new THREE.MeshStandardMaterial({ color: '#e8f4ff', roughness: 0.25, metalness: 0.1, emissive: '#1d4f6e', emissiveIntensity: 0.6 }));
    ring.position.set(x, SYR_Y, 0);
    ring.rotation.y = Math.PI / 2;
    pressGroup.add(ring);
  });

  /* 前端法兰 / 喷嘴 / 橡胶帽 */
  const flange = new THREE.Mesh(new THREE.CylinderGeometry(2.62, 2.62, 0.7, 36), STEEL);
  flange.geometry.rotateZ(Math.PI / 2);
  flange.position.set(BAR_X0 - 0.35, SYR_Y, 0);
  pressGroup.add(flange);
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.95, 2.1, 26), STEEL);
  nozzle.geometry.rotateZ(Math.PI / 2);
  nozzle.position.set(BAR_X0 - 1.75, SYR_Y, 0);
  pressGroup.add(nozzle);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.78, 1.1, 26), DARKRUBBER);
  cap.geometry.rotateZ(Math.PI / 2);
  cap.position.set(BAR_X0 - 3.35, SYR_Y, 0);
  cap.castShadow = true;
  pressGroup.add(cap);

  /* 活塞：活塞头 + 推杆 + 拇指托（三者随位置整体平移） */
  const pistHead = new THREE.Mesh(new THREE.CylinderGeometry(BAR_R - 0.06, BAR_R - 0.06, 0.72, 36), DARKRUBBER);
  pistHead.geometry.rotateZ(Math.PI / 2);
  pistHead.position.set(PIST_MAX, SYR_Y, 0);
  pressGroup.add(pistHead);

  const pistRod = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 1, 20), STEEL);
  pistRod.geometry.rotateZ(Math.PI / 2);
  pistRod.position.set(PIST_MAX + ROD_LEN / 2, SYR_Y, 0);
  pistRod.scale.x = ROD_LEN;
  pressGroup.add(pistRod);

  const pistPad = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.35, 0.42, 30), STEEL);
  pistPad.geometry.rotateZ(Math.PI / 2);
  pistPad.position.set(PIST_MAX + ROD_LEN, SYR_Y, 0);
  pressGroup.add(pistPad);

  /* 筒内乙醚蒸气：软边光斑，密度随压强上升、液化开始后不再变浓 */
  const puffMap = makePuffMap();
  const VAPOR_N = 34;
  const vaporGroup = new THREE.Group();
  pressGroup.add(vaporGroup);
  const vaporPuffs = [];
  {
    const rnd = mulberry32(31337);
    for (let i = 0; i < VAPOR_N; i++) {
      const m = new THREE.SpriteMaterial({ map: puffMap, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.NormalBlending });
      const s = new THREE.Sprite(m);
      s.userData = {
        u: 0.05 + rnd() * 0.90,                       // 沿轴的归一化位置
        r: 0.15 + rnd() * 0.66,                       // 归一化半径
        th: rnd() * Math.PI * 2,
        ph: rnd() * 6.28,
        sz: 0.72 + rnd() * 0.62
      };
      vaporPuffs.push(s);
      vaporGroup.add(s);
    }
  }

  /* 筒壁液滴 + 筒底积液（液化程度的【画面量】） */
  const DROP_N_MAX = 30;
  const wallDrops = [];
  const dropGroup = new THREE.Group();
  pressGroup.add(dropGroup);
  {
    const rnd = mulberry32(6060);
    for (let i = 0; i < DROP_N_MAX; i++) {
      const m = new THREE.MeshStandardMaterial({ color: '#bfe6ff', roughness: 0.14, metalness: 0.0, transparent: true, opacity: 0.94, emissive: '#0e2f47', emissiveIntensity: 0.35 });
      const s = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), m);
      const th = Math.PI * (1.5 + (rnd() - 0.5) * 0.95);   // 落在【下半个】筒壁上
      s.userData = { u: 0.06 + rnd() * 0.88, th, sz: 0.16 + rnd() * 0.17 };
      s.scale.set(s.userData.sz, s.userData.sz * 0.8, s.userData.sz);
      s.visible = false;
      wallDrops.push(s);
      dropGroup.add(s);
    }
  }
  const filmMat = new THREE.MeshStandardMaterial({ color: '#bfe6ff', roughness: 0.16, metalness: 0, transparent: true, opacity: 0.72, emissive: '#0e2f47', emissiveIntensity: 0.30 });
  const film = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), filmMat);
  film.visible = false;
  dropGroup.add(film);

  /* 压力表：立柱 + 表体 + 表盘 + 指针（立在实验台后侧中部，不挡筒身） */
  const DIAL_X = -13.5, DIAL_Z = -8.0, DIAL_Y = 16.4;
  const dialPost = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 13.8, 20), STEEL);
  dialPost.position.set(DIAL_X, 6.9, DIAL_Z);
  pressGroup.add(dialPost);
  const dialBase = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.4, 0.7, 30), STEEL);
  dialBase.position.set(DIAL_X, 14.1, DIAL_Z);
  pressGroup.add(dialBase);
  const dialBody = new THREE.Mesh(new THREE.CylinderGeometry(3.3, 3.3, 0.62, 44), STEEL);
  dialBody.geometry.rotateX(Math.PI / 2);
  dialBody.position.set(DIAL_X, DIAL_Y, DIAL_Z);
  pressGroup.add(dialBody);
  const dialFace = new THREE.Mesh(new THREE.CircleGeometry(3.16, 48),
    new THREE.MeshStandardMaterial({ map: makeDialMap(), roughness: 0.5, metalness: 0.05, emissive: '#ffffff', emissiveIntensity: 0.16 }));
  dialFace.position.set(DIAL_X, DIAL_Y, DIAL_Z + 0.32);
  pressGroup.add(dialFace);
  const dialNeedle = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.5, 0.08),
    new THREE.MeshStandardMaterial({ color: '#dc2626', roughness: 0.4, metalness: 0.1 }));
  /* ★ 把几何平移半个长度，转轴才落在轴心 —— 否则指针绕自己的中点转，两头乱摆 */
  dialNeedle.geometry.translate(0, 1.25, 0);
  dialNeedle.position.set(DIAL_X, DIAL_Y, DIAL_Z + 0.36);
  pressGroup.add(dialNeedle);
  const dialHub = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.34, 20), DARKRUBBER);
  dialHub.geometry.rotateX(Math.PI / 2);
  dialHub.position.set(DIAL_X, DIAL_Y, DIAL_Z + 0.40);
  pressGroup.add(dialHub);
  const dialGroup = new THREE.Group();
  dialGroup.add(dialBody, dialFace, dialNeedle, dialHub, dialBase, dialPost);
  /* 🔴 dialGroup.add(...) 会把这几件从 pressGroup 里【摘出来】再挂到 dialGroup 上。
     如果这里忘了 pressGroup.add(dialGroup)，整只压力表就是孤儿 —— 不在场景里、
     也不报错，只是画面上凭空少一件器材。 */
  pressGroup.add(dialGroup);

  /* -------------------------------------------------------------------------
     场景 ②：烧杯热水 + 支架 + 可调温玻璃片
     ---------------------------------------------------------------------- */
  const coolGroup = new THREE.Group();
  scene.add(coolGroup);

  const BEAKER_X = -5.0, BEAKER_R = 4.6, BEAKER_H = 9.6;
  const beakerGlass = new THREE.Mesh(new THREE.CylinderGeometry(BEAKER_R, BEAKER_R, BEAKER_H, 44, 1, true), GLASS);
  beakerGlass.position.set(BEAKER_X, BEAKER_H / 2, 0);
  coolGroup.add(beakerGlass);
  const beakerBottom = new THREE.Mesh(new THREE.CylinderGeometry(BEAKER_R, BEAKER_R, 0.42, 44), GLASS);
  beakerBottom.position.set(BEAKER_X, 0.21, 0);
  coolGroup.add(beakerBottom);
  const waterMat = new THREE.MeshPhysicalMaterial({
    color: '#7fc7e8', roughness: 0.10, metalness: 0, transparent: true, opacity: 0.72,
    transmission: 0.0, clearcoat: 0.8
  });
  const hotWater = new THREE.Mesh(new THREE.CylinderGeometry(BEAKER_R - 0.14, BEAKER_R - 0.14, 6.4, 40), waterMat);
  hotWater.position.set(BEAKER_X, 3.6, 0);
  coolGroup.add(hotWater);

  /* 上升的白气（水蒸气遇冷液化成的小水珠） */
  const STEAM_Y0 = BEAKER_H, STEAM_Y1 = 17.2;
  const STEAM_N = 30;
  const steamGroup = new THREE.Group();
  coolGroup.add(steamGroup);
  const steamPuffs = [];
  {
    const rnd = mulberry32(80808);
    for (let i = 0; i < STEAM_N; i++) {
      const m = new THREE.SpriteMaterial({ map: puffMap, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.NormalBlending });
      const s = new THREE.Sprite(m);
      s.userData = {
        u: rnd(),                                    // 沿高度的相位
        r: 0.30 + rnd() * 0.62,
        th: rnd() * Math.PI * 2,
        ph: rnd() * 6.28,
        sz: 1.5 + rnd() * 1.3
      };
      steamPuffs.push(s);
      steamGroup.add(s);
    }
  }

  /* 支架 + 玻璃片 */
  const coolStandRod = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 24, 22), STEEL);
  coolStandRod.position.set(8.6, 12.0, 0);
  coolStandRod.castShadow = true;
  coolGroup.add(coolStandRod);
  const coolStandBase = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.0, 0.7, 28), STEEL);
  coolStandBase.position.set(8.6, 0.35, 0);
  coolGroup.add(coolStandBase);
  const coolArm = new THREE.Mesh(new THREE.BoxGeometry(14.4, 0.62, 0.62), STEEL);
  coolArm.position.set(1.4, 20.6, 0);
  coolGroup.add(coolArm);
  const coolClamp = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.7, 1.5), STEEL);
  coolClamp.position.set(BEAKER_X, 19.9, 0);
  coolGroup.add(coolClamp);

  const PLATE_Y = 17.6;
  const PLATE_W = 12.0, PLATE_D = 9.0, PLATE_T = 0.42;
  /* ★ 玻璃片绕 x 轴倾斜：远边翘起、近边下压。
     水蒸气在【下表面】结露，而默认机位在片子上方 —— 水平放的话水珠全被片子挡住。
     斜 0.5 rad 之后下表面正对镜头，水珠才看得见（老师实际演示时也是斜着拿的）。 */
  const PLATE_TILT = -0.5;
  const plateMat = new THREE.MeshPhysicalMaterial({
    color: '#bfe6ff', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.58,
    clearcoat: 1.0, clearcoatRoughness: 0.03
  });
  const coolPlate = new THREE.Mesh(new THREE.BoxGeometry(PLATE_W, PLATE_T, PLATE_D), plateMat);
  coolPlate.position.set(BEAKER_X, PLATE_Y, 0);
  coolPlate.rotation.x = PLATE_TILT;
  coolPlate.castShadow = true;
  coolGroup.add(coolPlate);

  /* 玻璃片下表面的水珠（结露量的【画面量】） */
  const COND_N_MAX = 34;
  const condDrops = [];
  /* ★ 水珠挂在【与玻璃片同一个倾斜坐标系】里：condGroup 复制片子的位置与旋转，
     水珠只用局部坐标。直接写世界坐标会让水珠浮在片子上方、或者悬空。 */
  const condGroup = new THREE.Group();
  condGroup.position.set(BEAKER_X, PLATE_Y, 0);
  condGroup.rotation.x = PLATE_TILT;
  coolGroup.add(condGroup);
  {
    const rnd = mulberry32(1717);
    const cols = 7, rows = 5;
    for (let i = 0; i < COND_N_MAX; i++) {
      const cx = i % cols, cy = Math.floor(i / cols);
      const m = new THREE.MeshStandardMaterial({ color: '#d7f0ff', roughness: 0.12, metalness: 0, transparent: true, opacity: 0.95, emissive: '#12374d', emissiveIntensity: 0.4 });
      const s = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), m);
      const sz = 0.15 + rnd() * 0.15;
      s.userData = {
        x: (cx / (cols - 1) - 0.5) * (PLATE_W - 2.0) + (rnd() - 0.5) * 0.7,
        z: (cy / (rows - 1) - 0.5) * (PLATE_D - 1.6) + (rnd() - 0.5) * 0.6,
        sz
      };
      s.scale.set(sz, sz * 0.72, sz);
      s.position.set(s.userData.x, -PLATE_T / 2 - sz * 0.5, s.userData.z);
      s.visible = false;
      condDrops.push(s);
      condGroup.add(s);
    }
  }
  /* 液化放热：玻璃片下方的暖色辉光，强度随结露量上升 */
  const heatGlowMat = new THREE.MeshBasicMaterial({ color: '#fb923c', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const heatGlow = new THREE.Mesh(new THREE.PlaneGeometry(PLATE_W - 0.6, PLATE_D - 0.6), heatGlowMat);
  heatGlow.rotation.x = -Math.PI / 2;
  heatGlow.position.set(0, -PLATE_T / 2 - 0.28, 0);
  condGroup.add(heatGlow);

  /* 玻璃片旁边的温度读数牌 */
  const plateNum = makeLabelSprite('20.0', 'rgba(8,20,32,0.86)', '#7dd3fc', 5.6);
  plateNum.position.set(BEAKER_X, PLATE_Y + 4.2, 0);
  coolGroup.add(plateNum);

  /* 场景整体可见性由 setScene 控制 */
  pressGroup.visible = true;
  coolGroup.visible = false;

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
    const press = state.scene === 'press';
    pressGroup.visible = press;
    coolGroup.visible = !press;
    vaporGroup.visible = !!toggles.vapor;
    steamGroup.visible = !!toggles.vapor;
    dropGroup.visible = !!toggles.drops;
    condGroup.visible = !!toggles.drops;
    heatGlow.visible = !!toggles.heat && (press ? liqFracNow() > 0.01 : condAmountNow() > 0.01);
    state.drawn.scene = state.scene;
    state.drawn.pressVisible = pressGroup.visible;
    state.drawn.coolVisible = coolGroup.visible;
    state.drawn.vaporVisible = press ? vaporGroup.visible : steamGroup.visible;
    state.drawn.dropVisible = press ? dropGroup.visible : condGroup.visible;
    state.drawn.glowVisible = heatGlow.visible;
  }

  /* ---- 场景 ① 的更新 ---- */
  function updatePiston() {
    const xp = state.pistX;
    pistHead.position.x = xp;
    pistRod.position.x = xp + ROD_LEN / 2;
    pistPad.position.x = xp + ROD_LEN;
    state.drawn.pistX = +xp.toFixed(4);
    state.drawn.gasLen = +(xp - BAR_X0).toFixed(4);
  }

  function updateVapor() {
    const xp = state.pistX;
    const ps = pSatEther(TEMP_LEVELS[state.levels.temp]);
    const pr = clamp(pIdeal(xp, TEMP_LEVELS[state.levels.temp]) / ps, 0, 1);
    /* 密度：气态越挤越浓；一旦液化开始，压强钉在 p_sat ⇒ 浓度也不再上升
       —— 画面自己把「继续推活塞压强不再变大」演出来了。 */
    const base = 0.10 + 0.60 * pr;
    vaporPuffs.forEach((p, i) => {
      const u = p.userData;
      const wob = Math.sin(state.t * 1.4 + u.ph) * 0.10;
      const x = BAR_X0 + (u.u + wob * 0.02) * (xp - BAR_X0);
      const r = u.r * BAR_R * 0.80;
      p.position.set(x, SYR_Y + Math.sin(u.th) * r + wob * 0.12, Math.cos(u.th) * r);
      p.material.opacity = base * (i % 3 === 0 ? 1 : 0.74);
      const k = u.sz * (0.72 + 0.40 * pr);
      p.scale.set(k, k, 1);
    });
    state.drawn.vaporOpacity = +base.toFixed(4);
    state.drawn.pressRatio = +pr.toFixed(4);
    state.drawn.vaporPuffs = vaporGroup.visible ? vaporPuffs.length : 0;
  }

  function updateLiquid() {
    const xp = state.pistX;
    const T = TEMP_LEVELS[state.levels.temp];
    const f = liqFracAt(xp, T);
    const nOn = Math.round(f * DROP_N_MAX);
    wallDrops.forEach((d, i) => {
      const u = d.userData;
      const on = i < nOn;
      d.visible = on;
      if (!on) return;
      const x = BAR_X0 + u.u * (xp - BAR_X0);
      const r = (BAR_R - 0.14);
      d.position.set(x, SYR_Y + Math.sin(u.th) * r, Math.cos(u.th) * r);
      const g = u.sz * (0.7 + 0.6 * f);
      d.scale.set(g, g * 0.8, g);
    });
    /* 筒底积液：长度铺满气腔、高度随液化量长 */
    const h = 0.10 + 0.66 * f;
    film.visible = f > 0.004;
    if (film.visible) {
      const L = Math.max(0.2, xp - BAR_X0);
      film.scale.set(L, h, 2 * BAR_R * 0.84);
      film.position.set(BAR_X0 + L / 2, SYR_Y - BAR_R + h / 2, 0);
    }
    /* 压力表指针：表盘上 0 在【左下】（a = −140°）、满量程在右下（a = +140°），
       沿逆时针增大。canvas 里角度 a 对应世界方向 (sin a, cos a)；
       把 +y 绕 z 转 θ 得到 (−sin θ, cos θ) ⇒ θ = −a。
       🔴 写成 θ = a 会让指针左右镜像（0 跑到右下），而「指针在转」这件事本身照样成立。 */
    const p = pActualNow();
    const fr = clamp(p / DIAL_MAX, 0, 1);
    dialNeedle.rotation.z = (140 - 280 * fr) * Math.PI / 180;
    state.drawn.liqFrac = +f.toFixed(5);
    state.drawn.dropsOn = nOn;
    state.drawn.filmH = +h.toFixed(4);
    state.drawn.pressKPa = +p.toFixed(3);
    state.drawn.needleFrac = +fr.toFixed(4);
  }

  /* ---- 场景 ② 的更新 ---- */
  function updateSteam() {
    const yTop = STEAM_Y1;
    steamPuffs.forEach((p, i) => {
      const u = p.userData;
      const y = STEAM_Y0 + ((u.u + state.steamPhase * 0.16) % 1) * (yTop - STEAM_Y0);
      const r = u.r * 3.3;
      const x = BEAKER_X + Math.cos(u.th + state.steamPhase * 0.30) * r;
      const z = Math.sin(u.th + state.steamPhase * 0.30) * r;
      p.position.set(x, y, z);
      /* 越靠上越稀（真实白气也是「刚出口最浓」） */
      const hk = 1 - (y - STEAM_Y0) / (yTop - STEAM_Y0);
      p.material.opacity = (0.14 + 0.34 * hk) * (i % 3 === 0 ? 1 : 0.72);
      const k = u.sz * (1.0 - 0.30 * (1 - hk));
      p.scale.set(k, k, 1);
    });
    state.drawn.steamPuffs = steamGroup.visible ? steamPuffs.length : 0;
  }

  function updateCond() {
    const tg = state.tg;
    const a = condAmountAt(tg);
    const nOn = Math.round(a * COND_N_MAX);
    condDrops.forEach((d, i) => {
      const on = i < nOn;
      d.visible = on;
      if (!on) return;
      const u = d.userData;
      const g = u.sz * (0.55 + 0.72 * a);
      d.scale.set(g, g * 0.72, g);
      d.position.set(u.x, -PLATE_T / 2 - g * 0.5, u.z);
    });
    /* 玻璃片颜色随温度：冷偏蓝、热偏橙 */
    const k = clamp((tg - TG_MIN) / (TG_MAX - TG_MIN), 0, 1);
    plateMat.color.setRGB(lerp(0.62, 1.0, k), lerp(0.86, 0.82, k), lerp(1.0, 0.66, k));
    heatGlowMat.opacity = (toggles.heat ? 0.46 : 0) * a;
    plateNum.material.map = makeLabelMap(tg.toFixed(1), 'rgba(8,20,32,0.86)', a > 0.01 ? '#fdba74' : '#7dd3fc');
    state.drawn.tg = +tg.toFixed(4);
    state.drawn.condFrac = +a.toFixed(5);
    state.drawn.condDropsOn = nOn;
    state.drawn.dew = +dewNow().toFixed(4);
    state.drawn.heatGlow = +heatGlowMat.opacity.toFixed(4);
    state.drawn.plateRGB = [+plateMat.color.r.toFixed(4), +plateMat.color.g.toFixed(4), +plateMat.color.b.toFixed(4)];
  }

  function animateParts(dt) {
    state.vaporPhase += dt * state.speed * 0.6;
    state.steamPhase += dt * state.speed * 1.0;
  }

  /* ==========================================================================
     八、物理推进
     ========================================================================== */
  /* 活塞位置 / 玻璃片温度都走一阶滞后：推一下不是瞬间到位，
     「读数是一个真物理量」这条才立得住（否则读数只是设定值的另一个写法）。 */
  const K_PIST = 2.2;         // /s（τ ≈ 0.45 s）
  const K_GLASS = 1.6;        // /s（τ ≈ 0.63 s）

  function stepLiqDt(dt) {
    state.t += dt;
    if (state.scene === 'press') {
      state.pistX += (state.pistTarget - state.pistX) * (1 - Math.exp(-K_PIST * dt));
      if (Math.abs(state.pistTarget - state.pistX) < 1e-4) state.pistX = state.pistTarget;
      state.pistX = clamp(state.pistX, PIST_MIN, PIST_MAX);
    } else {
      state.tg += (state.tgTarget - state.tg) * (1 - Math.exp(-K_GLASS * dt));
      if (Math.abs(state.tgTarget - state.tg) < 1e-4) state.tg = state.tgTarget;
      state.tg = clamp(state.tg, TG_MIN, TG_MAX);
    }
  }

  function updateAll() {
    updateVisibility();
    updatePiston();
    updateVapor();
    updateLiquid();
    updateSteam();
    updateCond();
    updateReadouts();
    drawChart();
    drawInset(0.016);
    requestRender();
  }

  /* ==========================================================================
     九、2D 插图（随场景切换：微观挤密 / 露点标尺）
     ========================================================================== */
  const insetCanvas = $('insetCanvas');
  const insetTitle = $('insetTitle');
  const insetText = $('insetText');
  const insCtx = insetCanvas.getContext('2d');
  const chartCanvas = $('chartCanvas');
  const chartCtx = chartCanvas.getContext('2d');

  /* ★ 2D 画布必须按【CSS 尺寸 × dpr】定内部分辨率，再把上下文缩放回去。
     只用 CSS 拉伸一个 300×150 的默认画布，文字和线条会被放大成一团糊 ——
     读数还照样对，所以断言完全看不出来。 */
  function fitCanvas(cv, ctx, defW, defH) {
    const W = cv.clientWidth || defW, H = cv.clientHeight || defH;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { W, H };
  }

  const microDots = [];
  {
    const rnd = mulberry32(202020);
    for (let i = 0; i < 64; i++) {
      microDots.push({
        x: rnd(), y: rnd(), vx: (rnd() - 0.5) * 0.5, vy: (rnd() - 0.5) * 0.5,
        bound: i >= 48
      });
    }
  }

  function drawMicro(dt) {
    const { W, H } = fitCanvas(insetCanvas, insCtx, 232, 112);
    insCtx.clearRect(0, 0, W, H);
    insCtx.fillStyle = '#0a1a2b'; insCtx.fillRect(0, 0, W, H);
    const f = liqFracNow();
    const pr = clamp(pIdealNow() / pSatNow(), 0, 1);
    /* 活塞随压缩往右收 —— 气体可活动区变窄 */
    const padL = 8, padR = 8;
    const zoneW = (W - padL - padR) * (0.28 + 0.72 * (1 - pr));
    const x0 = padL, x1 = padL + zoneW;
    insCtx.strokeStyle = '#2b4a68'; insCtx.lineWidth = 2;
    insCtx.strokeRect(x0, 6, zoneW, H - 12);
    /* 活塞 */
    insCtx.fillStyle = '#3b4450';
    insCtx.fillRect(x1, 4, 5, H - 8);
    microDots.forEach((d, i) => {
      if (!d.bound) {
        d.x += d.vx * dt * 0.6; d.y += d.vy * dt * 0.6;
        if (d.x < 0.04 || d.x > 0.96) d.vx *= -1;
        if (d.y < 0.04 || d.y > 0.96) d.vy *= -1;
        d.x = clamp(d.x, 0.04, 0.96); d.y = clamp(d.y, 0.04, 0.96);
      }
      const x = x0 + d.x * zoneW;
      const y = 8 + d.y * (H - 16);
      if (d.bound) {
        if (i >= 48 + Math.round((64 - 48) * (1 - f))) return;
        insCtx.fillStyle = '#7dd3fc';
        insCtx.beginPath(); insCtx.arc(x, y, 3.4, 0, 7); insCtx.fill();
      } else {
        insCtx.fillStyle = `rgba(226,240,252,${0.30 + 0.62 * pr})`;
        insCtx.beginPath(); insCtx.arc(x, y, 2.0, 0, 7); insCtx.fill();
      }
    });
    if (f > 0.004) {
      insCtx.fillStyle = 'rgba(125,211,252,0.85)';
      insCtx.fillRect(x0, H - 9, zoneW, 5);
    }
    state.drawn.microZoneW = +zoneW.toFixed(2);
  }

  function drawDewRuler() {
    const { W, H } = fitCanvas(insetCanvas, insCtx, 232, 112);
    insCtx.clearRect(0, 0, W, H);
    insCtx.fillStyle = '#0a1a2b'; insCtx.fillRect(0, 0, W, H);
    const T0 = -10, T1 = 50;
    const xOf = (T) => 16 + (clamp(T, T0, T1) - T0) / (T1 - T0) * (W - 32);
    const y = H - 26;
    /* 液化区（露点以下）阴影 */
    const xd = xOf(dewNow());
    const grd = insCtx.createLinearGradient(xd, 0, xOf(T0), 0);
    grd.addColorStop(0, 'rgba(56,189,248,0.05)');
    grd.addColorStop(1, 'rgba(56,189,248,0.34)');
    insCtx.fillStyle = grd;
    insCtx.fillRect(xOf(T0), 10, xd - xOf(T0), y - 10);
    /* 轴 */
    insCtx.strokeStyle = '#3d5f80'; insCtx.lineWidth = 2;
    insCtx.beginPath(); insCtx.moveTo(12, y); insCtx.lineTo(W - 12, y); insCtx.stroke();
    insCtx.fillStyle = '#8ba3b8'; insCtx.font = '9px system-ui, sans-serif';
    insCtx.textAlign = 'center'; insCtx.textBaseline = 'top';
    for (let T = T0; T <= T1; T += 10) {
      const x = xOf(T);
      insCtx.strokeStyle = '#3d5f80';
      insCtx.beginPath(); insCtx.moveTo(x, y); insCtx.lineTo(x, y + 4); insCtx.stroke();
      insCtx.fillText(String(T), x, y + 5);
    }
    const mark = (T, color, label, dy) => {
      const x = xOf(T);
      insCtx.strokeStyle = color; insCtx.lineWidth = 2.4;
      insCtx.beginPath(); insCtx.moveTo(x, y - 4); insCtx.lineTo(x, 12); insCtx.stroke();
      insCtx.fillStyle = color;
      insCtx.beginPath(); insCtx.arc(x, y - 6, 3.2, 0, 7); insCtx.fill();
      insCtx.font = 'bold 9.5px system-ui, sans-serif';
      insCtx.textAlign = 'center'; insCtx.textBaseline = 'middle';
      insCtx.fillText(label, x, 14 + dy);
    };
    mark(AIR_LEVELS[state.levels.air], '#fbbf24', '气温', 0);
    mark(dewNow(), '#38bdf8', '露点', 14);
    mark(state.tg, state.tg < dewNow() ? '#f472b6' : '#94a3b8', '玻璃', 28);
    state.drawn.rulerDewX = +xOf(dewNow()).toFixed(2);
    state.drawn.rulerGlassX = +xOf(state.tg).toFixed(2);
  }

  function drawInset(dt) {
    if (state.scene === 'press') {
      insetTitle.textContent = '微观 · 分子被挤密了';
      insetText.textContent = '分子在筒内乱撞、撞壁就是压强。活塞往里推 ⇒ 同样的分子挤在更小的空间里 ⇒ 撞壁更频繁、压强上升。压到饱和线后，多出来的分子只能挤成液滴。';
      drawMicro(dt);
    } else {
      insetTitle.textContent = '露点标尺';
      insetText.textContent = '玻璃片温度只要落在露点左边（蓝色阴影区），水蒸气就会在它表面液化成水珠。空气越潮，露点越靠右，越容易结露。';
      drawDewRuler();
    }
  }

  /* ==========================================================================
     十、图表（p–V 图 / 结露量–温度图）
     ========================================================================== */
  function drawChart() {
    const { W, H } = fitCanvas(chartCanvas, chartCtx, 640, 232);
    const g = chartCtx;
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#0b1a2c'; g.fillRect(0, 0, W, H);
    const padL = 54, padR = 16, padT = 16, padB = 34;
    const pw = W - padL - padR, ph = H - padT - padB;
    g.strokeStyle = '#2b4a68'; g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(padL, padT); g.lineTo(padL, padT + ph); g.lineTo(padL + pw, padT + ph); g.stroke();

    if (state.scene === 'press') {
      const T = TEMP_LEVELS[state.levels.temp];
      const VMAX = GAS_V_MAX * 1.06;
      const PMAX = Math.max(pIdeal(PIST_MIN, TEMP_LEVELS[2]), pSatEther(TEMP_LEVELS[2])) * 1.08;
      const xOf = (v) => padL + clamp(v / VMAX, 0, 1) * pw;
      const yOf = (p) => padT + ph - clamp(p / PMAX, 0, 1) * ph;
      /* 网格 + 刻度 */
      g.font = '10px system-ui, sans-serif'; g.fillStyle = '#8ba3b8';
      g.textAlign = 'right'; g.textBaseline = 'middle';
      for (let i = 0; i <= 4; i++) {
        const p = PMAX * i / 4, y = yOf(p);
        g.strokeStyle = '#1b3348'; g.beginPath(); g.moveTo(padL, y); g.lineTo(padL + pw, y); g.stroke();
        g.fillText(String(Math.round(p)), padL - 6, y);
      }
      g.textAlign = 'center'; g.textBaseline = 'top';
      for (let i = 0; i <= 4; i++) {
        const v = VMAX * i / 4, x = xOf(v);
        g.strokeStyle = '#1b3348'; g.beginPath(); g.moveTo(x, padT); g.lineTo(x, padT + ph); g.stroke();
        g.fillText(String(Math.round(v)), x, padT + ph + 6);
      }
      g.fillStyle = '#9db4c8'; g.textAlign = 'right';
      g.fillText('V / cm³', padL + pw, padT + ph + 19);
      g.save(); g.translate(13, padT + 8); g.rotate(-Math.PI / 2);
      g.textAlign = 'right'; g.fillText('p / kPa', 0, 0); g.restore();
      /* 等温双曲线（细线，全部按气态算） */
      g.strokeStyle = '#38bdf8'; g.lineWidth = 1.8; g.beginPath();
      for (let i = 0; i <= 160; i++) {
        const v = GAS_V_MIN + (VMAX - GAS_V_MIN) * i / 160;
        const xp = BAR_X0 + v / (Math.PI * BAR_R * BAR_R);
        /* ★ 不能写 continue 跳过：跳过会让折线在缺口处连成一条斜线。
           直接钳到顶部即可（这一段本来也超出量程）。 */
        const p = Math.min(pIdeal(xp, T), PMAX * 1.25);
        const x = xOf(v), y = yOf(p);
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
      /* 饱和蒸气压水平线（虚线） */
      const ps = pSatEther(T);
      g.strokeStyle = '#f472b6'; g.lineWidth = 1.6; g.setLineDash([7, 5]);
      g.beginPath(); g.moveTo(padL, yOf(ps)); g.lineTo(padL + pw, yOf(ps)); g.stroke();
      g.setLineDash([]);
      g.fillStyle = '#f472b6'; g.textAlign = 'left'; g.textBaseline = 'bottom';
      g.font = 'bold 10px system-ui, sans-serif';
      g.fillText('饱和蒸气压 ' + ps.toFixed(1) + ' kPa', padL + 8, yOf(ps) - 3);
      /* 阈值点 */
      const vthr = thrVol(T);
      if (vthr <= VMAX) {
        g.strokeStyle = '#a3e635'; g.lineWidth = 1.4; g.setLineDash([3, 4]);
        g.beginPath(); g.moveTo(xOf(vthr), padT + ph); g.lineTo(xOf(vthr), yOf(ps)); g.stroke();
        g.setLineDash([]);
        g.fillStyle = '#a3e635';
        g.beginPath(); g.arc(xOf(vthr), yOf(ps), 4.6, 0, 7); g.fill();
        g.font = 'bold 10px system-ui, sans-serif';
        /* ★ 靠右时改右对齐：写死左对齐会让标签冲出绘图区（x 轴那一格本来就在边界上） */
        const nearRight = xOf(vthr) > padL + pw * 0.60;
        g.textAlign = nearRight ? 'right' : 'left';
        g.textBaseline = 'top';
        g.fillText('开始液化 V=' + vthr.toFixed(0), xOf(vthr) + (nearRight ? -6 : 6), yOf(ps) + 5);
      }
      /* 当前点（画在【实际】压强上：液化后贴着饱和线走） */
      const x = xOf(gasVolCm3(state.pistX)), y = yOf(pActualNow());
      g.fillStyle = '#fdba74';
      g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill();
      g.strokeStyle = '#0b1a2c'; g.lineWidth = 2; g.stroke();
      state.drawn.chart = {
        kind: 'pv', x: +x.toFixed(2), y: +y.toFixed(2),
        vthr: +vthr.toFixed(3), ps: +ps.toFixed(3), vmax: +VMAX.toFixed(3), pmax: +PMAX.toFixed(3),
        xThr: +xOf(vthr).toFixed(2), ySat: +yOf(ps).toFixed(2),
        /* ★ x0 / xMax 是横轴【与阈值无关】的两个锚点（体积 0 与量程上限）。
           自检要验证「阈值点的像素位置确实由阈值体积算出来」，就必须有一组
           不经过 xThr 的基准 —— 否则它只能拿两组不同温度的 xThr 互推：
           把 xThr 整个写死时两组基准一起塌掉，反解出的比例变成 0，
           判据退化成「padL === padL」的恒等式，怎么写都绿。 */
        x0: +xOf(0).toFixed(2), xMax: +xOf(VMAX).toFixed(2)
      };
    } else {
      const dew = dewNow();
      const xOf = (t) => padL + clamp((t - TG_MIN) / (TG_MAX - TG_MIN), 0, 1) * pw;
      const yOf = (a) => padT + ph - clamp(a, 0, 1) * ph;
      g.font = '10px system-ui, sans-serif'; g.fillStyle = '#8ba3b8';
      g.textAlign = 'right'; g.textBaseline = 'middle';
      for (let i = 0; i <= 4; i++) {
        const a = i / 4, y = yOf(a);
        g.strokeStyle = '#1b3348'; g.beginPath(); g.moveTo(padL, y); g.lineTo(padL + pw, y); g.stroke();
        g.fillText((a * 100).toFixed(0) + '%', padL - 6, y);
      }
      g.textAlign = 'center'; g.textBaseline = 'top';
      for (let t = TG_MIN; t <= TG_MAX; t += 10) {
        const x = xOf(t);
        g.strokeStyle = '#1b3348'; g.beginPath(); g.moveTo(x, padT); g.lineTo(x, padT + ph); g.stroke();
        g.fillText(String(t), x, padT + ph + 6);
      }
      g.fillStyle = '#9db4c8'; g.textAlign = 'right';
      g.fillText('玻璃片温度 / ℃', padL + pw, padT + ph + 19);
      g.save(); g.translate(13, padT + 8); g.rotate(-Math.PI / 2);
      g.textAlign = 'right'; g.fillText('结露量', 0, 0); g.restore();
      /* 结露量曲线 */
      g.strokeStyle = '#38bdf8'; g.lineWidth = 2.2; g.beginPath();
      for (let i = 0; i <= 160; i++) {
        const t = TG_MIN + (TG_MAX - TG_MIN) * i / 160;
        const x = xOf(t), y = yOf(condAmountAt(t));
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
      /* 露点竖线 */
      g.strokeStyle = '#f472b6'; g.lineWidth = 1.8; g.setLineDash([7, 5]);
      g.beginPath(); g.moveTo(xOf(dew), padT + ph); g.lineTo(xOf(dew), padT); g.stroke();
      g.setLineDash([]);
      g.fillStyle = '#f472b6'; g.textAlign = 'center'; g.textBaseline = 'bottom';
      g.font = 'bold 10px system-ui, sans-serif';
      g.fillText('露点 ' + dew.toFixed(1) + ' ℃', xOf(dew), padT + 11);
      /* 当前点 */
      const x = xOf(state.tg), y = yOf(condAmountNow());
      g.fillStyle = '#fdba74';
      g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill();
      g.strokeStyle = '#0b1a2c'; g.lineWidth = 2; g.stroke();
      state.drawn.chart = {
        kind: 'cond', x: +x.toFixed(2), y: +y.toFixed(2),
        dew: +dew.toFixed(3), xDew: +xOf(dew).toFixed(2),
        xLeft: +xOf(TG_MIN).toFixed(2), xRight: +xOf(TG_MAX).toFixed(2),
        yTop: +padT.toFixed(2), yBottom: +(padT + ph).toFixed(2)
      };
    }
  }

  /* ==========================================================================
     十一、读数
     ========================================================================== */
  const els = {
    hudTempLabel: $('hudTempLabel'), hudTemp: $('hudTemp'), hudUnit1: $('hudUnit1'),
    hudAuxLabel: $('hudAuxLabel'), hudAux: $('hudAux'), hudUnit2: $('hudUnit2'),
    m1: $('metric1'), m2: $('metric2'), m3: $('metric3'), m4: $('metric4'), m5: $('metric5'),
    l1: $('metricL1'), l2: $('metricL2'), l3: $('metricL3'), l4: $('metricL4'), l5: $('metricL5'),
    finding: $('finding')
  };

  function statusText() {
    if (state.scene === 'press') {
      const f = liqFracNow();
      if (f <= 0.004) return pIdealNow() > pSatNow() * 0.88 ? '接近饱和 · 还没液化' : '全部是气态';
      if (f >= 0.995) return '几乎全部液化';
      return '正在液化 · 压强已钉在饱和线';
    }
    const a = condAmountNow();
    if (a <= 0.004) return '玻璃片太暖 · 不结露';
    if (a >= 0.9) return '结满水珠';
    return '正在结露 · 液化放热';
  }

  function updateReadouts() {
    if (state.scene === 'press') {
      const p = pActualNow(), ps = pSatNow(), f = liqFracNow();
      els.hudTempLabel.textContent = '筒内压强';
      els.hudTemp.textContent = p.toFixed(1);
      els.hudUnit1.textContent = 'kPa';
      els.hudAuxLabel.textContent = '已液化';
      els.hudAux.textContent = (f * 100).toFixed(1);
      els.hudUnit2.textContent = '%';
      els.l1.textContent = '筒内压强'; els.m1.textContent = p.toFixed(1) + ' kPa';
      els.l2.textContent = '饱和蒸气压'; els.m2.textContent = ps.toFixed(1) + ' kPa';
      els.l3.textContent = '气体体积'; els.m3.textContent = gasVolCm3(state.pistX).toFixed(1) + ' cm³';
      els.l4.textContent = '液化量'; els.m4.textContent = (f * 100).toFixed(1) + ' %';
      els.l5.textContent = '放出的热'; els.m5.textContent = heatNow().toFixed(1) + ' J';
      els.finding.textContent = f <= 0.004
        ? '现在 p = ' + p.toFixed(1) + ' kPa，还不到饱和蒸气压 ' + ps.toFixed(1) + ' kPa —— 筒里全是气，没有一滴液体。继续往里推活塞。'
        : '筒壁上出现液滴了。注意压强停在 ' + ps.toFixed(1) + ' kPa 不再上升 —— 多出来的分子都变成液体了，同时放出 ' + heatNow().toFixed(1) + ' J 的热。';
    } else {
      const dew = dewNow(), a = condAmountNow();
      els.hudTempLabel.textContent = '玻璃片温度';
      els.hudTemp.textContent = state.tg.toFixed(1);
      els.hudUnit1.textContent = '℃';
      els.hudAuxLabel.textContent = '露点';
      els.hudAux.textContent = dew.toFixed(1);
      els.hudUnit2.textContent = '℃';
      els.l1.textContent = '空气温度'; els.m1.textContent = AIR_LEVELS[state.levels.air] + ' ℃';
      els.l2.textContent = '相对湿度'; els.m2.textContent = (RH_LEVELS[state.levels.rh] * 100).toFixed(0) + ' %';
      els.l3.textContent = '露点'; els.m3.textContent = dew.toFixed(1) + ' ℃';
      els.l4.textContent = '结露量'; els.m4.textContent = (a * 100).toFixed(1) + ' %';
      els.l5.textContent = '放出的热'; els.m5.textContent = condHeatNow().toFixed(1) + ' J';
      els.finding.textContent = a <= 0.004
        ? '玻璃片 ' + state.tg.toFixed(1) + ' ℃，还在露点 ' + dew.toFixed(1) + ' ℃ 之上 —— 水蒸气碰到它也不会液化。把玻璃片调冷一点。'
        : '玻璃片已经冷到露点以下（' + state.tg.toFixed(1) + ' ℃ < ' + dew.toFixed(1) + ' ℃），水蒸气在它表面液化成水珠，同时放出 ' + condHeatNow().toFixed(1) + ' J 的热。';
    }
  }

  /* ==========================================================================
     十二、记录表
     ========================================================================== */
  const recordBody = $('records');
  const recordBodySide = $('recordsSide');
  const recordBtn = $('recordBtn');
  const recordHint = $('recordHint');
  const recSum = $('recSum');
  const HINT_DONE = '继续记录：换一个温度档 / 湿度档再记一组，表格就能替你比较。';
  const HINT_IDLE = '观察时随时点一下，当前时刻与读数就记进下面的表格（点「重置」会清空）。';

  function sceneName() { return state.scene === 'press' ? '压缩体积' : '降低温度'; }

  function rowOf() {
    if (state.scene === 'press') {
      return {
        mode: '压缩体积',
        t: state.t.toFixed(1) + ' s',
        a: gasVolCm3(state.pistX).toFixed(1) + ' cm³',
        b: pActualNow().toFixed(1) + ' kPa',
        liq: (liqFracNow() * 100).toFixed(1) + ' %',
        q: heatNow().toFixed(1) + ' J',
        st: statusText()
      };
    }
    return {
      mode: '降低温度',
      t: state.t.toFixed(1) + ' s',
      a: state.tg.toFixed(1) + ' ℃',
      b: dewNow().toFixed(1) + ' ℃',
      liq: (condAmountNow() * 100).toFixed(1) + ' %',
      q: condHeatNow().toFixed(1) + ' J',
      st: statusText()
    };
  }

  function clearRecords() {
    state.records = [];
    renderRecords();
  }

  function renderRecords() {
    const n = state.records.length;
    if (!n) {
      const ph = '<tr><td colspan="6" class="empty">尚无记录，先点「开始观察」再记录</td></tr>';
      recordBody.innerHTML = ph;
      recordBodySide.innerHTML = '<tr><td colspan="4" class="empty">还没有记录</td></tr>';
      recSum.textContent = '点上面的按钮开始记录。';
      recordHint.textContent = HINT_IDLE;
      return;
    }
    recordBody.innerHTML = state.records.map((r) =>
      `<tr><td>${r.mode}</td><td>${r.t}</td><td>${r.a}</td><td>${r.b}</td><td>${r.liq}</td><td>${r.q}</td></tr>`
    ).join('');
    recordBodySide.innerHTML = state.records.map((r, i) =>
      `<tr><td>${i + 1}</td><td>${r.t}</td><td>${r.liq}</td><td>${r.st}</td></tr>`
    ).join('');
    recordHint.textContent = HINT_DONE;
    const press = state.scene === 'press';
    const vals = state.records.map((r) => parseFloat(r.liq));
    const mx = Math.max(...vals), mn = Math.min(...vals);
    recSum.textContent = press
      ? `已记录 ${n} 组：液化量从 ${mn.toFixed(1)}% 到 ${mx.toFixed(1)}%。液化量第一次从 0 变正的那一组，就是「刚好压到饱和线」的时刻。`
      : `已记录 ${n} 组：结露量从 ${mn.toFixed(1)}% 到 ${mx.toFixed(1)}%。结露量为 0 的那几组，玻璃片都在露点以上。`;
  }

  /* ==========================================================================
     十三、步骤条
     ========================================================================== */
  const STEPS = {
    press: [
      { name: '01 认识器材', text: '<strong>大号玻璃注射器</strong>里封着一点<b>乙醚</b>（常温下极易汽化，筒里绝大部分是乙醚蒸气），喷嘴用橡胶帽堵死 —— 气体跑不掉。右边（左后方）的<b>压力表</b>随时读筒内压强。' },
      { name: '02 拉到最松', text: '活塞在最右端，筒内气体体积最大（约 <b>398 cm³</b>）。此时压强只有 <b>35 kPa 左右</b>，远低于该温度下的<b>饱和蒸气压</b> —— 筒里<b>全是气</b>，一滴液体都没有。' },
      { name: '03 慢慢往里推', text: '<strong>压缩体积：</strong>温度不变，分子数不变，体积变小 ⇒ 单位体积里的分子变多 ⇒ <b>压强上升</b>。这一段压强一直涨，但<b>还没出现液滴</b>。' },
      { name: '04 压到饱和线', text: '<strong>关键一步：</strong>压强涨到<b>饱和蒸气压</b>的那一刻，筒壁上出现<b>第一滴</b>液体。对应的气体体积叫<b>阈值体积</b> —— 所以「不是一压就液化」，必须压够。' },
      { name: '05 继续推', text: '再往里推，液滴<b>越来越多</b>，但压力表的指针<b>不再上升</b> —— 多出来的分子全都跑去当液体了。这就是<b>液化石油气</b>能装进钢瓶的道理：压强到顶以后，继续加压只是把气变成液。' },
      { name: '06 再拉回来', text: '把活塞拉回原处：压强掉回饱和线以下，筒壁上的液滴<b>重新汽化、完全消失</b>。整个过程<b>可逆</b>，说明乙醚只是换了物态，没有变成别的东西。' },
      { name: '07 换个温度', text: '把温度档换成 30 ℃ 或 40 ℃ 再压一遍：<b>温度越高，饱和蒸气压越大</b>，阈值体积就越小 —— 越热越<b>难</b>压成液体，得压得更狠才行。反过来，<b>降温最容易液化</b>。' },
      { name: '08 记录归纳', text: '记下每一组的<b>体积、压强、液化量</b>。你会发现液化量第一次从 0 变正的那一组，压强正好卡在饱和蒸气压上 —— 这就是<b>「压缩体积可以使气体液化」</b>的定量证据。' }
    ],
    cool: [
      { name: '01 认识器材', text: '烧杯里装着<b>热水</b>，杯口不断冒出<b>白气</b> —— 那白气本身就是水蒸气遇冷液化成的小水珠。支架上夹着一块<b>可调温的玻璃片</b>，悬在白气上方。' },
      { name: '02 白气是什么', text: '水蒸气本身<b>无色透明</b>、看不见。我们看到的白气，是它跑出杯口后遇到较冷的空气，<b>液化</b>成的小水珠。液化有两个办法：<b>降低温度</b>、<b>压缩体积</b>。这一档专门看第一个。' },
      { name: '03 玻璃片不冷', text: '玻璃片温度高于<b>露点</b>时，水蒸气碰到它<b>也不会液化</b> —— 表面干干净净。露点由「空气温度」和「相对湿度」一起决定。' },
      { name: '04 把玻璃片调冷', text: '<strong>降低温度：</strong>把玻璃片调到露点<b>以下</b>，它表面立刻出现<b>细密的水珠</b>。水蒸气一碰到比自己冷的表面，就交出热量、聚成液滴。' },
      { name: '05 越冷结得越多', text: '继续调冷：玻璃片温度与露点的<b>差值越大</b>，结出来的水珠<b>越多越密</b>。结露量随温差单调增大 —— 曲线图上就是那条从露点开始往下翘的线。' },
      { name: '06 湿度的影响', text: '把空气换成<b>潮湿 85%</b>：露点明显升高、往右移，同样一块玻璃片就更容易结露。这就是为什么<b>梅雨天</b>墙上、地上都是水，而干燥的北方很少见。' },
      { name: '07 液化放热', text: '<strong>液化要放热。</strong>水蒸气变成水珠时把汽化热交了出来（读数里那个「放出的热」）。所以你摸到结露的玻璃片会觉得<b>它是温的</b> —— 这也是「水蒸气烫伤比开水更严重」的原因。' },
      { name: '08 记录归纳', text: '记下每一组的<b>玻璃片温度、露点、结露量</b>。结露量为 0 的那几组玻璃片都在露点以上；一旦调到露点以下，结露量立刻变正。' }
    ]
  };
  const stepButtons = Array.from(document.querySelectorAll('[data-step]'));
  const stepDetail = $('stepDetail');

  function applyStepUI() {
    const list = STEPS[state.scene];
    stepButtons.forEach((b, i) => {
      b.textContent = list[i].name;
      b.classList.toggle('active', i === state.step);
    });
    stepDetail.innerHTML = list[state.step].text;
    state.drawn.stepCount = list.length;
    state.drawn.stepText = list[state.step].text;
  }

  /* ==========================================================================
     十四、交互
     ========================================================================== */
  const els2 = {
    run: $('runBtn'), pause: $('pauseBtn'), reset: $('resetBtn'),
    pist: $('pistRange'), pistRead: $('pistRead'), pushIn: $('btnPushIn'), pullOut: $('btnPullOut'),
    glass: $('glassRange'), glassRead: $('glassRead'),
    tempBtns: Array.from(document.querySelectorAll('[data-temp]')),
    airBtns: Array.from(document.querySelectorAll('[data-air]')),
    rhBtns: Array.from(document.querySelectorAll('[data-rh]')),
    speedBtns: Array.from(document.querySelectorAll('[data-speed]')),
    sceneBtns: Array.from(document.querySelectorAll('[data-scene]')),
    cbVapor: $('toggleVapor'), cbDrops: $('toggleDrops'), cbHeat: $('toggleHeat'),
    pressCtl: $('pressCtl'), coolCtl: $('coolCtl')
  };

  /* ---- 随场景切换的文案（图表标题 / 表头 / 图例 / 提示） ---- */
  const chrome = {
    chartTitle: $('chartTitle'), th3: $('th3'), th4: $('th4'),
    sceneHint: $('sceneHint'),
    keys: Array.from(document.querySelectorAll('.chart-head .key')),
    stageBottom: document.querySelector('.stage-bottom')
  };
  function applySceneChrome() {
    const press = state.scene === 'press';
    chrome.chartTitle.textContent = press
      ? 'p–V 图：等温压缩线 与 饱和蒸气压'
      : '结露量 – 玻璃片温度 图（露点分界）';
    chrome.th3.textContent = press ? '气体体积' : '玻璃片温度';
    chrome.th4.textContent = press ? '筒内压强' : '露点';
    chrome.sceneHint.textContent = press
      ? '筒内封着乙醚蒸气。把活塞往里推，压强升到饱和蒸气压时筒壁上出现液滴。'
      : '烧杯热水冒出白气，支架上夹着一块可调温的玻璃片。玻璃片比露点冷时表面结出水珠。';
    chrome.stageBottom.textContent = press
      ? '乙醚蒸气 · 沸点 34.6 ℃ · 饱和蒸气压由 Clausius–Clapeyron 实时算出'
      : '热水杯口白气 · 玻璃片温度可调 −5 ~ 45 ℃ · 露点由 Magnus 公式算出';
    const labels = press
      ? ['等温线 p = nRT/V', '饱和蒸气压', '当前状态']
      : ['结露量曲线', '露点', '当前状态'];
    chrome.keys.forEach((k, i) => {
      Array.from(k.childNodes).forEach((n) => { if (n.nodeType === 3) k.removeChild(n); });
      k.appendChild(document.createTextNode(labels[i] || ''));
    });
  }

  function setRunning(v) {
    state.running = !!v;
    els2.run.disabled = state.running;
    els2.pause.disabled = !state.running;
    els2.run.textContent = state.running ? '观察中…' : (state.scene === 'press' ? '开始观察' : '开始观察');
    state.drawn.running = state.running;
  }
  function setSpeed(v) {
    state.speed = v;
    els2.speedBtns.forEach((b) => b.classList.toggle('active', +b.dataset.speed === v));
  }
  function setScene(key) {
    if (SCENES.indexOf(key) < 0) return false;
    state.scene = key;
    state.step = 0;
    state.t = 0;
    setRunning(false);
    els2.sceneBtns.forEach((b) => b.classList.toggle('active', b.dataset.scene === key));
    els2.pressCtl.style.display = key === 'press' ? '' : 'none';
    els2.coolCtl.style.display = key === 'cool' ? '' : 'none';
    document.querySelectorAll('[data-view]').forEach((b) => {
      b.textContent = key === 'press' ? ({ front: '正视', angle: '45° 斜视', top: '俯视', close: '近观活塞' })[b.dataset.view]
        : ({ front: '正视', angle: '45° 斜视', top: '俯视', close: '近观玻璃片' })[b.dataset.view];
    });
    applyStepUI();
    applySceneChrome();
    syncControls();
    updateAll();
    updateCamera();          /* ★ 换场景必须重新取景 —— 两组器材的尺寸差一个量级 */
    return true;
  }

  function setTemp(lv) {
    state.levels.temp = clamp(lv, 0, 2);
    syncControls();
    updateAll();
  }
  function setAir(lv) { state.levels.air = clamp(lv, 0, 2); syncControls(); updateAll(); }
  function setRh(lv) { state.levels.rh = clamp(lv, 0, 2); syncControls(); updateAll(); }
  function setPiston(v) {
    state.pistTarget = clamp(v, PIST_MIN, PIST_MAX);
    syncControls();
    updateAll();
  }
  function setGlass(v) {
    state.tgTarget = clamp(v, TG_MIN, TG_MAX);
    syncControls();
    updateAll();
  }
  function setToggle(name, on) {
    toggles[name] = !!on;
    updateAll();
  }

  function syncControls() {
    const press = state.scene === 'press';
    /* ★ 滑块的量程必须由这里的常量【单一真源】决定。
       HTML 里写死的 min/max 一旦和 PIST_MIN/PIST_MAX 脱钩，浏览器会把 value 静默钳到旧量程：
       初始 pistTarget = PIST_MAX 时滑块停在半路、读数却按 PIST_MAX 算，用户一拖活塞就跳变 ——
       而「读数正确」这件事照样成立，任何只看数字的断言都发现不了。 */
    els2.pist.min = String(PIST_MIN); els2.pist.max = String(PIST_MAX);
    els2.glass.min = String(TG_MIN); els2.glass.max = String(TG_MAX);
    els2.pist.value = String(state.pistTarget);
    els2.pistRead.textContent = gasVolCm3(state.pistTarget).toFixed(1) + ' cm³';
    els2.glass.value = String(state.tgTarget);
    els2.glassRead.textContent = state.tgTarget.toFixed(1) + ' ℃';
    els2.tempBtns.forEach((b) => b.classList.toggle('active', +b.dataset.temp === state.levels.temp));
    els2.airBtns.forEach((b) => b.classList.toggle('active', +b.dataset.air === state.levels.air));
    els2.rhBtns.forEach((b) => b.classList.toggle('active', +b.dataset.rh === state.levels.rh));
    els2.run.textContent = state.running ? '观察中…' : '开始观察';
    state.drawn.pistTarget = +state.pistTarget.toFixed(4);
    state.drawn.tgTarget = +state.tgTarget.toFixed(4);
    state.drawn.pressCtlShown = press;
  }

  function resetSim() {
    state.t = 0;
    state.pistX = PIST_MAX;
    state.pistTarget = PIST_MAX;
    state.tg = 20;
    state.tgTarget = 20;
    state.levels.temp = 0;
    state.levels.air = 1;
    state.levels.rh = 1;
    setRunning(false);
    syncControls();
    clearRecords();
    updateAll();
  }

  /* ---- 事件绑定 ---- */
  els2.run.addEventListener('click', () => setRunning(true));
  els2.pause.addEventListener('click', () => setRunning(false));
  els2.reset.addEventListener('click', () => resetSim());
  els2.pist.addEventListener('input', () => setPiston(+els2.pist.value));
  els2.pushIn.addEventListener('click', () => setPiston(PIST_MIN));
  els2.pullOut.addEventListener('click', () => setPiston(PIST_MAX));
  els2.glass.addEventListener('input', () => setGlass(+els2.glass.value));
  els2.tempBtns.forEach((b) => b.addEventListener('click', () => setTemp(+b.dataset.temp)));
  els2.airBtns.forEach((b) => b.addEventListener('click', () => setAir(+b.dataset.air)));
  els2.rhBtns.forEach((b) => b.addEventListener('click', () => setRh(+b.dataset.rh)));
  els2.speedBtns.forEach((b) => b.addEventListener('click', () => setSpeed(+b.dataset.speed)));
  els2.sceneBtns.forEach((b) => b.addEventListener('click', () => setScene(b.dataset.scene)));
  els2.cbVapor.addEventListener('change', () => setToggle('vapor', els2.cbVapor.checked));
  els2.cbDrops.addEventListener('change', () => setToggle('drops', els2.cbDrops.checked));
  els2.cbHeat.addEventListener('change', () => setToggle('heat', els2.cbHeat.checked));
  stepButtons.forEach((b) => b.addEventListener('click', () => {
    state.step = clamp(+b.dataset.step, 0, STEPS[state.scene].length - 1);
    applyStepUI();
  }));
  recordBtn.addEventListener('click', () => {
    state.records.push(rowOf());
    renderRecords();
    recordBtn.classList.remove('hit');
    void recordBtn.offsetWidth;
    recordBtn.classList.add('hit');
    state.drawn.records = state.records.length;
  });
  document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

  /* 画布：拖动环绕 / 滚轮缩放；场景 ① 里按住【筒身所在的那条横带】拖动 = 推拉活塞 */
  const projV = new THREE.Vector3();
  function screenOf(obj) {
    if (!obj) return null;
    const r = renderer.domElement.getBoundingClientRect();
    obj.getWorldPosition(projV);
    projV.project(camera);
    return {
      x: (projV.x * 0.5 + 0.5) * r.width,
      y: (-projV.y * 0.5 + 0.5) * r.height,
      w: r.width, h: r.height
    };
  }

  let dragging = false, lastX = 0, lastY = 0, dragPiston = false;
  /* 活塞热区：以筒身投影高度为中心的一条横带。
     ★ 不能写成「离画布中心多近」—— 那样点画面任何地方都会去推活塞，环绕就废了。 */
  function pistonHit(ev) {
    if (state.scene !== 'press') return false;
    const r = renderer.domElement.getBoundingClientRect();
    const c = screenOf(barrel);
    if (!c) return false;
    const py = ev.clientY - r.top, px = ev.clientX - r.left;
    return Math.abs(py - c.y) < r.height * 0.16 && px > r.width * 0.04 && px < r.width * 0.96;
  }
  canvas.addEventListener('pointerdown', (ev) => {
    dragging = true; lastX = ev.clientX; lastY = ev.clientY;
    dragPiston = pistonHit(ev);
    canvas.setPointerCapture(ev.pointerId);
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    const dx = ev.clientX - lastX, dy = ev.clientY - lastY;
    lastX = ev.clientX; lastY = ev.clientY;
    if (dragPiston) {
      setPiston(state.pistTarget - dx * 0.055);
    } else {
      view.yaw -= dx * 0.006;
      view.pitch = clamp(view.pitch + dy * 0.005, -0.10, 1.42);
      updateCamera();
    }
  });
  const endDrag = () => { dragging = false; dragPiston = false; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    view.dist = clamp(view.dist * (1 + Math.sign(ev.deltaY) * 0.07), 18, 130);
    updateCamera();
  }, { passive: false });

  /* ==========================================================================
     十五、启动
     ========================================================================== */
  canvas.style.cursor = 'grab';
  setScene('press');
  setSpeed(4);
  resetSim();
  resize();

  let uiAcc = 0;
  function frameStep(dt) {
    animateParts(dt);
    if (state.running) {
      stepLiqDt(dt * state.speed);
      uiAcc += dt;
      if (uiAcc >= 0.1) { uiAcc = 0; updateAll(); }
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
  window.__liqLab = {
    state, view, VIEWS, SCENES, toggles, camera, renderer, scene,
    pressGroup, coolGroup, barrel, barrelScale, pistHead, pistRod, pistPad, vaporGroup, vaporPuffs,
    dropGroup, wallDrops, film, dialGroup, dialNeedle, dialFace,
    beakerGlass, hotWater, steamGroup, steamPuffs, coolPlate, condGroup, condDrops,
    heatGlow, plateNum, bench, backdrop,
    R_GAS, P_ATM, T_BOIL_ETHER, DH_VAP_ETHER, M_ETHER, RHO_ETHER,
    TEMP_LEVELS, TEMP_LABEL, AIR_LEVELS, AIR_LABEL, RH_LEVELS, RH_LABEL,
    BAR_R, BAR_X0, BAR_X1, PIST_MIN, PIST_MAX, ROD_LEN, GAS_V_MAX, GAS_V_MIN,
    N_MOL, P_FILL, T_REF, DIAL_MAX, K_PIST, K_GLASS, K_COND, M_COND_MAX, DH_VAP_W,
    TG_MIN, TG_MAX, DROP_N_MAX, COND_N_MAX, PLATE_Y, PLATE_W, PLATE_D, PLATE_T,
    SYR_Y, BEAKER_X, STEAM_Y0, STEAM_Y1,
    pSatEther, pIdeal, pActualAt, nLiqAt, liqFracAt, liqVolAt, heatAt, thrVol, thrX,
    dewPoint, condAmountAt, condMassAt, condHeatAt, gasVolCm3,
    sceneFrame, setScene, setTemp, setAir, setRh, setPiston, setGlass, setToggle,
    resetSim, setRunning, setSpeed, setView, syncControls,
    updateAll, updateVisibility, updatePiston, updateVapor, updateLiquid, updateSteam, updateCond,
    updateReadouts, drawChart, drawInset, drawMicro, drawDewRuler,
    clearRecords, renderRecords, statusText, applyStepUI, applySceneChrome, rowOf,

    /* 当前场景下的物理量（画面与读数读的同一批函数） */
    pIdealNow() { return pIdeal(state.pistX, TEMP_LEVELS[state.levels.temp]); },
    pSatNow() { return pSatEther(TEMP_LEVELS[state.levels.temp]); },
    pActualNow() { return pActualAt(state.pistX, TEMP_LEVELS[state.levels.temp]); },
    liqFracNow() { return liqFracAt(state.pistX, TEMP_LEVELS[state.levels.temp]); },
    liqVolNow() { return liqVolAt(state.pistX, TEMP_LEVELS[state.levels.temp]); },
    heatNow() { return heatAt(state.pistX, TEMP_LEVELS[state.levels.temp]); },
    gasVolNow() { return gasVolCm3(state.pistX); },
    dewNow() { return dewPoint(AIR_LEVELS[state.levels.air], RH_LEVELS[state.levels.rh]); },
    condAmountNow() { return condAmountAt(state.tg); },
    condHeatNow() { return condHeatAt(state.tg); },

    /* 喂帧：无头沙箱里 requestAnimationFrame 一次都不触发，必须显式推进 */
    driveAnim(seconds, dt = 1 / 60) {
      const n = Math.max(1, Math.round(seconds / dt));
      for (let i = 0; i < n; i++) frameStep(dt);
      renderer.render(scene, camera);
      return {
        frames: n, t: +state.t.toFixed(3),
        pistX: +state.pistX.toFixed(4), tg: +state.tg.toFixed(4),
        liq: +liqFracNow().toFixed(5), cond: +condAmountNow().toFixed(5)
      };
    },
    /* 推进【仿真秒】—— 不含倍速，所以结果与倍速档位无关、可复现 */
    advance(simSeconds, dt = 0.5) {
      const n = Math.max(1, Math.round(simSeconds / dt));
      for (let i = 0; i < n; i++) stepLiqDt(dt);
      updateAll();
      renderer.render(scene, camera);
      return {
        t: +state.t.toFixed(3), pistX: +state.pistX.toFixed(4), tg: +state.tg.toFixed(4),
        liq: +liqFracNow().toFixed(5), cond: +condAmountNow().toFixed(5)
      };
    },

    /* 场景 ①：把【物理量】与【画出来的量】一起交出来，两处必须同源 */
    pressInfo() {
      const xp = state.pistX, T = TEMP_LEVELS[state.levels.temp];
      return {
        temp: T,
        pistX: +xp.toFixed(4),
        pistTarget: +state.pistTarget.toFixed(4),
        gasVol: +gasVolCm3(xp).toFixed(4),
        pIdeal: +pIdeal(xp, T).toFixed(4),
        pSat: +pSatEther(T).toFixed(4),
        pActual: +pActualAt(xp, T).toFixed(4),
        nLiq: +nLiqAt(xp, T).toExponential(6),
        liqFrac: +liqFracAt(xp, T).toFixed(6),
        liqVol: +liqVolAt(xp, T).toFixed(6),
        heat: +heatAt(xp, T).toFixed(4),
        thrVol: +thrVol(T).toFixed(4),
        thrX: +thrX(T).toFixed(4),
        /* 画出来的量 */
        dropsOn: state.drawn.dropsOn,
        dropsTotal: wallDrops.length,
        filmH: state.drawn.filmH,
        filmVisible: film.visible,
        needleFrac: state.drawn.needleFrac,
        vaporOpacity: state.drawn.vaporOpacity,
        pressRatio: state.drawn.pressRatio
      };
    },
    /* 场景 ②：露点 / 结露量与画出来的水珠数 */
    coolInfo() {
      const tg = state.tg;
      return {
        air: AIR_LEVELS[state.levels.air],
        rh: RH_LEVELS[state.levels.rh],
        dew: +dewNow().toFixed(4),
        tg: +tg.toFixed(4),
        tgTarget: +state.tgTarget.toFixed(4),
        condFrac: +condAmountAt(tg).toFixed(6),
        condMass: +condMassAt(tg).toFixed(6),
        heat: +condHeatAt(tg).toFixed(4),
        plateColor: state.drawn.plateRGB,
        condDropsOn: state.drawn.condDropsOn,
        condDropsTotal: condDrops.length,
        glowOpacity: state.drawn.heatGlow,
        plateY: PLATE_Y
      };
    },
    /* 图表：物理值 + 画出来的像素位置（两处必须同源） */
    chartInfo() {
      const c = state.drawn.chart || null;
      return {
        kind: c ? c.kind : null,
        drawn: c,
        now: state.scene === 'press' ? +pActualNow().toFixed(4) : +condAmountNow().toFixed(6),
        thrVol: state.scene === 'press' ? +thrVol(TEMP_LEVELS[state.levels.temp]).toFixed(4) : null,
        dew: state.scene === 'cool' ? +dewNow().toFixed(4) : null
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
    /* 任意【世界点】→ 画布 CSS 像素。自检用它把「液滴所在的那段气腔」或
       「杯口白气」精确圈出来再量像素 —— 用整幅画面平均亮度的话，
       液滴只占千分之几的面积，差值和噪声一个量级，判据会变成掷骰子。 */
    screenOfPoint(x, y, z) {
      const r = renderer.domElement.getBoundingClientRect();
      const p = new THREE.Vector3(x, y, z);
      p.project(camera);
      return {
        x: (p.x * 0.5 + 0.5) * r.width,
        y: (-p.y * 0.5 + 0.5) * r.height,
        w: r.width, h: r.height
      };
    },
    /* 读像素：renderer.render() 之后【同步】readPixels —— 判「液滴/白气看不看得见」只能量像素 */
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
    /* 画布中央区域的亮度/色彩 —— 判「场景真的画出了东西」用它 */
    centerSample() {
      const r = renderer.domElement.getBoundingClientRect();
      return this.sampleRegion(r.width * 0.25, r.height * 0.25, r.width * 0.75, r.height * 0.75);
    }
  };

  /* 内部同名函数的对外别名（保持 window.__liqLab 里可调用） */
  function pIdealNow() { return pIdeal(state.pistX, TEMP_LEVELS[state.levels.temp]); }
  function pSatNow() { return pSatEther(TEMP_LEVELS[state.levels.temp]); }
  function pActualNow() { return pActualAt(state.pistX, TEMP_LEVELS[state.levels.temp]); }
  function liqFracNow() { return liqFracAt(state.pistX, TEMP_LEVELS[state.levels.temp]); }
  function heatNow() { return heatAt(state.pistX, TEMP_LEVELS[state.levels.temp]); }
  function dewNow() { return dewPoint(AIR_LEVELS[state.levels.air], RH_LEVELS[state.levels.rh]); }
  function condAmountNow() { return condAmountAt(state.tg); }
  function condHeatNow() { return condHeatAt(state.tg); }
})();
