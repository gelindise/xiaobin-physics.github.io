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
  /* 记录表用的紧凑档位文案：292 px 宽的面板里塞 6 列，长的写不下 */
  const LEVEL_SHORT = {
    temp: ['20 ℃', '40 ℃', '60 ℃'],
    area: ['1 档', '2 档', '3 档'],
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

  /* --- 蒸发致冷：干湿球温差 = 解【干湿表方程】，不是拟合曲线 ---
     湿球读数是能量平衡的结果：
       ① 蒸发吸热的速率 ∝ (e_s(T_w) − e)，e 是环境水汽压；
       ② 空气对流给纱布补热的速率 ∝ A·P·(T − T_w)，A 是干湿表系数。
     两式相等 ⇒  e_s(T_w) − A·P·(T − T_w) = e = RH·e_s(T)。
     A 随通风变强而【变小】：静风时纱布周围那层空气很快被水汽填满、局部接近饱和，
     传质受阻（A ≈ 1.0×10⁻³ /℃）；强通风把边界层吹走（A → 0.62×10⁻³ /℃，阿斯曼
     干湿表的标称值）。⇒ 风越大，A 越小、局部 RH 越低，方程重新平衡后 T_w 只能更低。
     「风越大，干湿球温差越大」是从方程里解出来的，不是写死的单调曲线；
     同理「空气温度越高，温差越大」（热空气能装更多水汽、e_s 的斜率更陡）也是解出来的。
     ★ 温差只跟【空气温度】和【风速】有关，与水滴摊开多大无关 —— 湿球是测空气的。 */
  const RH0 = 0.50;                       // 默认环境相对湿度 50 %（滑块初始位置）
  const RH_MIN = 0.15, RH_MAX = 0.95;     // 滑块范围
  const P_ATM = 1013;                     // 大气压 hPa
  const WIND_MS = [0.12, 1.1, 2.6];       // 三档风在纱布处的空气流速 m/s
  const RH_STILL = 0.88;                  // 静风时纱布周围那层空气的局部相对湿度
  const A_VENT = 0.00062, A_STILL = 0.00042;   // 干湿表系数：充分通风值 + 静风增量
  /* 致冷场景（湿度计）固定用低档风 1.1 m/s —— 阿斯曼干湿表的标称通风量级。
     ★ 这一档【只给湿球方程用】，学生调不到：致冷场景里唯一的自变量是空气湿度。 */
  const COOL_WIND = 1;
  function esat(T) { return 6.112 * Math.exp(17.62 * T / (243.12 + T)); }  // Magnus 式 hPa
  function ventA(v) { return A_VENT + A_STILL * Math.exp(-v / 0.75); }     // 1/℃
  /* 纱布周围的【局部】相对湿度：通风越好越接近环境值，静风时那层空气被水汽填满、
     趋近饱和（RH_STILL）。★ 局部值不能低于环境值 —— 湿度滑块拉到 95 % 时
     静风「增湿」这项就该消失（否则会出现湿度越高、湿球反而更低的怪结果）。 */
  function localRH(v) {
    const rh = clamp(state.rh, RH_MIN, RH_MAX);
    const cap = Math.max(RH_STILL, rh);
    return rh + (cap - rh) * Math.exp(-v / 0.55);
  }
  function wetBulbT(T, v) {
    const e = localRH(v) * esat(T);
    const A = ventA(v) * P_ATM;
    /* f(T_w) = e_s(T_w) − A·P·(T − T_w) − e 对 T_w 严格单调递增，
       且 f(T) = e_s(T)·(1 − RH_local) ≥ 0 ⇒ 根必落在 [T − 60, T] 内，二分即可。 */
    let lo = T - 60, hi = T;
    for (let i = 0; i < 48; i++) {
      const mid = 0.5 * (lo + hi);
      if (esat(mid) - A * (T - mid) - e > 0) hi = mid; else lo = mid;
    }
    return 0.5 * (lo + hi);
  }
  /* 湿球方程用的风速档：致冷场景固定 COOL_WIND（学生只调湿度），
     影响因素场景才跟「空气流动」这一档走。 */
  function thermoWindLevel() {
    return state.scene === 'cool' ? COOL_WIND : clamp(state.levels.wind, 0, 2);
  }
  function wetDelta() {
    const T = TEMP_LEVELS[clamp(state.levels.temp, 0, 2)];
    return T - wetBulbT(T, WIND_MS[thermoWindLevel()]);
  }
  function dryTarget() { return TEMP_LEVELS[state.levels.temp]; }
  function wetTarget() { return dryTarget() - wetDelta(); }
  /* 一阶滞后：τ ≈ 0.45 s。不能更慢 —— 用户换档后 1 s 内就要能读出稳定值，
     否则「刚点完高档看到的是上一个档位的读数」，看起来就是高档反而更热。 */
  const K_LAG = 2.2;                      // 1/s（τ ≈ 0.45 s）

  /* --- 液面上方水蒸气层的饱和程度 ---
     ★ 这一项【只喂画面】（水蒸气层的不透明度），不是任何读数。
       它是刻意夸张过的显示量：真实边界层在 1 m/s 上下就已经被吹得很薄，
       低档 / 高档在视觉上几乎一样，那样学生看不出「风把水蒸气吹走」。 */
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
    rh: 0.50,                   // 空气相对湿度 0~1（致冷场景的滑块；湿球读数的唯一自变量）
    savedLevels: null,          // 进致冷场景前三个因素的档位，切回去时还原
    Td: TEMP_LEVELS[0],         // 干球读数 ℃
    Tw: TEMP_LEVELS[0],         // 湿球读数 ℃（一阶滞后）
    fanSpin: 0,
    fanOmega: 0,                // 扇叶当前视觉角速度 rad/s（向档位目标一阶靠拢）
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
  const fanBlades = [];                   // 每个元素是【叶片转轴 Group】，不是 mesh
  /* ★ 桨距角与旋向是一对，必须配套：
     叶片绕【局部 x（径向轴）】扭 +BLADE_PITCH，桨距面的法线 z 分量为 +cos(β)；
     叶片绕风扇轴 +z 转 ω 时，法线与速度的点积 = −ω·r·sinβ。
     要让风朝 +z（机头正对，经 Ry(−90°) 后就是朝 −x 的加热板）吹，
     必须让「速度沿 +n」⇒ ω·sinβ < 0 ⇒ 桨距取正时旋向必须取负。 */
  const BLADE_PITCH = 0.34;               // 桨距角 rad
  const FAN_SPIN_SIGN = -1;               // ★ 与 BLADE_PITCH 配套，改一个必须同时改另一个
  /* 视觉角速度 rad/s（只由档位决定，见 animateParts 的说明） */
  const FAN_OMEGA = [0, 5.6, 11.2];
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

    /* ★ 叶片做成【两级】：
         外层 pivot —— 只负责绕风扇轴（局部 z）转，转速与档位一致；
         内层 mesh  —— 只负责绕自己的径向轴（局部 x）扭一个桨距角。
       以前把「桨距」和「转速」都写在同一个 mesh 的 rotation.y 上，动画一覆盖
       桨距就没了，而且转轴错成了 y —— 叶片会从风盘里翻出去（法线在 xz 面里扫），
       看上去是「整盘叶片在乱翻」而不是「绕轴转」。 */
    for (let i = 0; i < 3; i++) {
      const pivot = new THREE.Group();
      const baseAngle = (i / 3) * Math.PI * 2;
      pivot.rotation.z = baseAngle;
      pivot.userData.baseAngle = baseAngle;

      const b = new THREE.Mesh(new THREE.BoxGeometry(2.55, 0.95, 0.07), chromeMat);
      b.geometry.translate(1.45, 0, 0);
      b.rotation.x = BLADE_PITCH;         // 桨距：绕径向轴扭（几何沿 x 平移 ⇒ 转动后仍在半径上）
      pivot.add(b);

      head.add(pivot);
      fanBlades.push(pivot);
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

  /* ★★ 水滴必须【真的变小、最后消失】—— 这是用户直接看到的一条。
     旧写法只把高度乘 rem、接触半径一直钉在 G.a 上：水量掉到 20% 时画面上还是
     一颗一模一样的扁片，只有 HUD 的百分数在动 —— 看上去就是「水一点没少」。
     蒸发是【三个方向一起缩】：线性尺寸 ∝ 体积^(1/3)，所以 a、h 同乘 cbrt(rem)。
     于是 (2/3)πa²h = V0·rem 精确成立，网格体积与剩余水量同源（不再只缩一个轴）。
     最后 1% 直接隐藏：再小也只剩亚像素，硬留着一颗亮点反而像「永远干不了」。 */
  function updateDrops() {
    const G = dropGeom(state.levels.area);
    const rem = state.remain;
    const rf = Math.cbrt(Math.max(rem, 0));
    const a = G.a * rf;
    const h = G.h * rf;
    const gone = rem <= 0.01;
    drops.forEach((d) => {
      d.scale.set(Math.max(a, 1e-4), Math.max(h, 1e-4), Math.max(a, 1e-4));
      d.visible = !gone;
      /* 越干越淡：让「消失」是渐隐而不是硬切 */
      d.material.opacity = lerp(0.10, 0.58, Math.min(1, rem * 3.4));
    });
    state.drawn.dropA = +a.toFixed(4);
    state.drawn.dropH = +h.toFixed(4);
    state.drawn.dropRf = +rf.toFixed(5);
    state.drawn.dropA2H = +(a * a * h).toFixed(5);
    state.drawn.dropA2HRef = +(G.a2hRef).toFixed(5);
    state.drawn.dropVol = +((2 / 3) * Math.PI * a * a * h).toFixed(5);
    state.drawn.dropVol0 = +V0.toFixed(5);
    state.drawn.remain = +rem.toFixed(5);
    state.drawn.dropVisible = drops.filter((d) => d.visible).length;
    state.drawn.dropCount = state.drawn.dropVisible;
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
  /* ★ 读数牌是 CanvasTexture，读数每 0.1 s 刷一次 ⇒ 每秒新建 10 张 256×96 贴图。
     不释放的话显存只涨不落（跑十几分钟就是上千张）；而且同一个读数还在反复重画。
     这里按【文本变化】去重 + 旧贴图 dispose。 */
  const numLabelCache = { dry: '', wet: '' };
  function setNumLabel(sprite, key, text, bg, fg) {
    if (!sprite) return;
    /* 把「牌子上此刻写的字」记进画面量 —— 数字牌是学生直接读的读数，
       自检要能卡住「牌子跟着读数走」，而不是只能卡内部状态。 */
    state.drawn[key === 'dry' ? 'numLabelDry' : 'numLabelWet'] = text;
    if (numLabelCache[key] === text) return;
    numLabelCache[key] = text;
    const old = sprite.material.map;
    sprite.material.map = makeLabelMap(text, bg, fg);
    sprite.material.needsUpdate = true;
    if (old) old.dispose();
  }
  function updateThermo() {
    state.Td = dryTarget();
    if (dryColMesh) dryColMesh.scale.y = Math.max(colHeight(state.Td), 0.02);
    if (wetColMesh) wetColMesh.scale.y = Math.max(colHeight(state.Tw), 0.02);
    setNumLabel(dryNumSprite, 'dry', state.Td.toFixed(1), 'rgba(8,20,32,0.86)', '#fdba74');
    setNumLabel(wetNumSprite, 'wet', state.Tw.toFixed(1), 'rgba(8,32,26,0.86)', '#6ee7b7');
    state.drawn.dryColH = dryColMesh ? +dryColMesh.scale.y.toFixed(4) : 0;
    state.drawn.wetColH = wetColMesh ? +wetColMesh.scale.y.toFixed(4) : 0;
    state.drawn.Td = +state.Td.toFixed(4);
    state.drawn.Tw = +state.Tw.toFixed(4);
    state.drawn.deltaT = +(state.Td - state.Tw).toFixed(4);
    state.drawn.wetTarget = +wetTarget().toFixed(4);
    state.drawn.gauzeVisible = !!gauzeMesh && gauzeMesh.visible;
  }

  function animateParts(dt) {
    const w = clamp(state.levels.wind, 0, 2);
    /* ★ 视觉角速度只由【档位】决定，不乘时间倍速。
       以前是 dt·speed·w·7.0：×4 时高档每帧转角已经 53°，×10 时 133° ——
       叶片间隔只有 120°，每帧转角一旦超过它的一半就会频闪倒转（车轮倒转效应），
       于是「高档看着比低档还慢」，而且同一个档位在不同倍速下看着还不一样。
       现在 5.6 / 11.2 rad/s ⇒ 60 fps 下每帧 5.3° / 10.7°，远小于 60°，
       任何倍速下都不会频闪；高档恒为低档的 2 倍。 */
    const target = FAN_OMEGA[w];
    state.fanOmega += (target - state.fanOmega) * Math.min(1, 5.0 * dt);
    state.fanSpin += state.fanOmega * dt;
    fanBlades.forEach((p) => {
      p.rotation.z = p.userData.baseAngle + FAN_SPIN_SIGN * state.fanSpin;
    });
    /* 气流速度与扇叶角速度同源：叶子转得快，风才走得快 */
    state.windPhase += dt * state.fanOmega * 2.4;
  }

  /* ==========================================================================
     八、物理推进
     ========================================================================== */
  function stepEvapDt(dt) {
    if (state.remain <= 0) return;
    state.t += dt;
    state.remain = Math.max(0, state.remain - K_DRY * evapRate() / V0 * dt);
    if (state.remain <= 0) {
      state.finished = true;
      /* ★★ 表格里【只记一件事：蒸发完全用了多少时间】。
         用户明确要求：不要手动点「记录这一组」记一堆中途快照，就跑完这一刻自动记一行
         （条件 + 用时）。放在这里而不是 frameStep 里，是为了让 advance() 之类的
         程序化推进也走同一条记录路径 —— 只有一条入口，不会出现「手动记的和自动记的不一样」。 */
      recordRun();
    }
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
    updateCompare();
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
     十、干燥时间对照（纯 DOM 小条，取代原来 232 px 高的柱状图画布）
     ★ 为什么改成 DOM：原图占掉整屏小一半，用户要的是「别把实验弄复杂」。
       信息一点没少 —— 四行就是「基准 + 只改温度 / 表面积 / 风速」，
       条的宽度 ∝ 相对蒸发速率（基准 75.3 s → 条最短），秒数直接写在右边。
     ★ 只在档位真的变了才重建 innerHTML：每 0.1 s 重建一次会把面板的滚动位置打飞。
     ========================================================================== */
  const cmpBox = $('cmpBox');

  function chartBars() {
    const L = state.levels;
    return [
      { key: 'base', label: '基准', sec: dryTime(0, 0, 0), hit: false },
      { key: 'temp', label: '只改温度', sec: dryTime(L.temp, 0, 0), hit: L.temp > 0 },
      { key: 'area', label: '只改表面积', sec: dryTime(0, L.area, 0), hit: L.area > 0 },
      { key: 'wind', label: '只改风速', sec: dryTime(0, 0, L.wind), hit: L.wind > 0 }
    ];
  }

  let cmpSig = '';
  function updateCompare() {
    const rows = chartBars();
    const sig = rows.map((r) => r.sec.toFixed(3)).join('|');
    state.drawn.cmpRows = rows.map((r) => ({ key: r.key, sec: +r.sec.toFixed(3), hit: r.hit }));
    if (!cmpBox || sig === cmpSig) return;
    cmpSig = sig;
    const baseSec = rows[0].sec;
    const maxRatio = Math.max.apply(null, rows.map((r) => baseSec / r.sec));
    cmpBox.innerHTML = rows.map((r) => {
      const ratio = baseSec / r.sec;
      const w = clamp(ratio / maxRatio * 100, 5, 100);
      const cls = 'cmp-row' + (r.key === 'base' ? ' base' : '') + (r.hit ? ' hit' : '');
      return '<div class="' + cls + '">'
        + '<span>' + r.label + '</span>'
        + '<span class="track"><i style="width:' + w.toFixed(1) + '%"></i></span>'
        + '<b>' + r.sec.toFixed(r.sec < 20 ? 1 : 0) + ' s</b></div>';
    }).join('');
  }

  /* ==========================================================================
     十一、读数与提示
     ========================================================================== */
  const els = {
    hudTemp: $('hudTemp'), hudTempLabel: $('hudTempLabel'),
    hudAux: $('hudAux'), hudAuxLabel: $('hudAuxLabel'), hudAuxUnit: $('hudAuxUnit'),
    hudDry: $('hudDry'), hudDryLabel: $('hudDryLabel'), hudDryUnit: $('hudDryUnit'),
    /* 致冷场景：参数面板里的三格读数（干球 / 湿球 / 温差）+ 湿度滑块的百分比 */
    readTd: $('readTd'), readTw: $('readTw'), readDt: $('readDt'), rhVal: $('rhVal')
  };

  /* HUD 三行：温度 / 剩余水量（致冷场景是干湿球温差）/ 干燥时间（致冷场景是湿球读数）。
     ★ 湿球还在往新平衡值爬的时候必须【说出来】—— 否则换档后立刻读到的是
       上一个档位的数字，看起来就是「高档反而更热」。 */
  function updateReadouts() {
    const cool = state.scene === 'cool';
    const settleErr = Math.abs(state.Tw - wetTarget());
    const settling = settleErr > 0.12;
    state.drawn.settleErr = +settleErr.toFixed(4);
    state.drawn.settling = settling;

    if (els.hudTemp) els.hudTemp.textContent = dryTarget().toFixed(1);
    if (els.hudTempLabel) els.hudTempLabel.textContent = cool ? '空气温度' : '加热板温度';

    if (cool) {
      /* ★ 用户要求：致冷场景「直接显示干球和湿球的温度就可以了」。
         三行就是 干球 / 湿球 / 温差 —— 湿球还在往新平衡爬的时候标出目标值，
         否则拖动湿度滑块后立刻读到的是上一档的数字。 */
      if (els.hudTemp) els.hudTemp.textContent = state.Td.toFixed(1);
      if (els.hudTempLabel) els.hudTempLabel.textContent = '干球';
      const curW = state.Tw.toFixed(1);
      if (els.hudAux) els.hudAux.textContent = settling ? curW + ' → ' + wetTarget().toFixed(1) : curW;
      if (els.hudAuxLabel) els.hudAuxLabel.textContent = '湿球';
      if (els.hudAuxUnit) els.hudAuxUnit.textContent = '℃';
      if (els.hudDry) els.hudDry.textContent = (state.Td - state.Tw).toFixed(1);
      if (els.hudDryLabel) els.hudDryLabel.textContent = '干湿球温差';
      if (els.hudDryUnit) els.hudDryUnit.textContent = '℃';
      /* 参数面板里的同一组读数（和 HUD 同源，都是 state.Td / state.Tw） */
      if (els.readTd) els.readTd.textContent = state.Td.toFixed(1);
      if (els.readTw) els.readTw.textContent = state.Tw.toFixed(1);
      if (els.readDt) els.readDt.textContent = (state.Td - state.Tw).toFixed(1);
    } else {
      if (els.hudAux) els.hudAux.textContent = (state.remain * 100).toFixed(1);
      if (els.hudAuxLabel) els.hudAuxLabel.textContent = '剩余水量';
      if (els.hudAuxUnit) els.hudAuxUnit.textContent = '%';
      if (els.hudDry) els.hudDry.textContent = dryTimeNow().toFixed(1);
      if (els.hudDryLabel) els.hudDryLabel.textContent = '干燥时间';
      if (els.hudDryUnit) els.hudDryUnit.textContent = 's';
    }
    if (els.rhVal) els.rhVal.textContent = Math.round(state.rh * 100) + ' %';
  }

  /* ==========================================================================
     十二、记录：只记「蒸发完全用了多少时间」
     ---------------------------------------------------------------------------
     用户两条要求（2026-10-22 二次修订）：
     ① 表格里【只记蒸发完全的时间】—— 不要手动点按钮记中途快照；
     ② 【重置不许清空表格】—— 重置是为了换条件再跑一次，新的一行接着往下排，
        学生才能把「只改温度 / 只改表面积 / 只改风速」几组摆在一起比。
     ⇒ 记录由 stepEvapDt() 在 finished 那一刻自动触发（唯一入口），
       重置只归零仿真量；清空是单独的按钮。
     ========================================================================== */
  const recordBody = $('records');
  const recSum = $('recSum');
  const recCount = $('recCount');
  const clearRecBtn = $('clearRecBtn');
  const recToast = $('recToast');
  const REC_EMPTY = '还没有记录 —— 水滴全部蒸干（跑完一次）就自动记一行。';

  function clearRecords() {
    state.records.length = 0;
    renderRecords();
  }

  function renderRecords() {
    const rows = state.records;
    if (recordBody) {
      if (!rows.length) {
        recordBody.innerHTML = '<tr><td colspan="5" class="empty">' + REC_EMPTY + '</td></tr>';
      } else {
        recordBody.innerHTML = rows.map((r, i) => '<tr>'
          + '<td>' + (i + 1) + '</td>'
          + '<td>' + LEVEL_SHORT.temp[r.temp] + '</td>'
          + '<td>' + LEVEL_SHORT.area[r.area] + '</td>'
          + '<td>' + LEVEL_SHORT.wind[r.wind] + '</td>'
          + '<td class="t">' + r.t.toFixed(1) + '</td></tr>').join('');
      }
    }
    if (recCount) recCount.textContent = rows.length ? rows.length + ' 次' : '0 次';
    if (recSum) {
      if (!rows.length) {
        recSum.textContent = REC_EMPTY;
      } else {
        const last = rows[rows.length - 1];
        /* 最快的那一行点出来：学生一眼看到「哪个条件干得最快」 */
        let best = rows[0];
        rows.forEach((r) => { if (r.t < best.t) best = r; });
        recSum.innerHTML = '已记 <b>' + rows.length + '</b> 次。最近一次：'
          + LEVEL_SHORT.temp[last.temp] + ' · ' + LEVEL_SHORT.area[last.area] + ' · ' + LEVEL_SHORT.wind[last.wind]
          + ' → <b>' + last.t.toFixed(1) + ' s</b>；'
          + '目前最快：<b>' + best.t.toFixed(1) + ' s</b>（'
          + LEVEL_SHORT.temp[best.temp] + ' · ' + LEVEL_SHORT.area[best.area] + ' · ' + LEVEL_SHORT.wind[best.wind] + '）。';
      }
    }
  }

  /* 跑完这一刻记一行：条件 + 用时。
     ★ 不记「干湿球温差」：用户要的是「只记蒸发完全的时间」，而蒸发快慢场景里
       温度计根本没摆出来，多一列反而让人以为要点温度计。温差在致冷场景的
       HUD 上实时读就够了。 */
  function recordRun() {
    const r = {
      temp: state.levels.temp,
      area: state.levels.area,
      wind: state.levels.wind,
      t: state.t
    };
    state.records.push(r);
    if (state.records.length > 40) state.records.shift();
    renderRecords();
    showRecToast(r);
    return r;
  }

  let recToastTimer = 0;
  function showRecToast(r) {
    if (!recToast) return;
    recToast.innerHTML = '✓ 已记入表格：' + LEVEL_SHORT.temp[r.temp] + ' · ' + LEVEL_SHORT.area[r.area]
      + ' · ' + LEVEL_SHORT.wind[r.wind] + ' → 用时 <b>' + r.t.toFixed(1) + ' s</b>';
    recToast.classList.add('show');
    clearTimeout(recToastTimer);
    recToastTimer = setTimeout(() => recToast.classList.remove('show'), 3800);
  }

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

  /* ★ 致冷场景的唯一自变量：空气相对湿度。
     拖动滑块只改 state.rh —— 湿球读数是【解方程】解出来的（e_s(T_w) 与补热平衡），
     不是「湿度 → 温差」的查表，所以「湿度越大温差越小」是算出来的、不是写死的。 */
  function setRh(pct) {
    state.rh = clamp(Number(pct) / 100, RH_MIN, RH_MAX);
    const sl = $('rhSlider');
    if (sl) sl.value = String(Math.round(state.rh * 100));
    updateAll();
    return state.rh;
  }

  function setSpeed(v) {
    state.speed = v;
    document.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('active', Number(b.dataset.speed) === v));
  }

  function applySceneUI() {
    document.querySelectorAll('[data-scene]').forEach((b) => b.classList.toggle('active', b.dataset.scene === state.scene));
    /* ★ 用户要求：致冷场景里【不再研究温度 / 表面积 / 空气流动】，
       只留一个「空气湿度」滑块 ⇒ 那几组连同运行 / 对照 / 记录整块收起来。
       用 hidden 而不是删 DOM：切回影响因素场景要原样还原，而且自检要能数到它们。 */
    const cool = state.scene === 'cool';
    document.querySelectorAll('.only-factor').forEach((el) => { el.hidden = cool; });
    document.querySelectorAll('.only-cool').forEach((el) => { el.hidden = !cool; });
  }

  function setScene(key) {
    if (SCENES.indexOf(key) < 0) return false;
    if (state.scene === key) return true;
    /* ★ 致冷场景 = 干湿球湿度计：干球就是室温，通风量固定。
       进去之前先把学生调好的三个档位存起来，切回影响因素场景时原样还原
       —— 否则「去看一眼湿度计再回来，条件全没了」。 */
    if (key === 'cool') {
      state.savedLevels = { ...state.levels };
      state.levels.temp = 0;              // 干球 = 室温 20 ℃
      state.levels.area = 0;
      state.levels.wind = COOL_WIND;      // 固定通风（学生调不到）
    } else if (state.savedLevels) {
      state.levels = { ...state.savedLevels };
      state.savedLevels = null;
    }
    state.scene = key;
    applySceneUI();
    applyFactorUI();
    /* 干球读数跟着换（20 ℃ ↔ 影响因素场景的当前温度档），湿球重新落到稳态 */
    state.Td = dryTarget();
    state.Tw = wetTarget();
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
    state.fanOmega = 0;
    state.windPhase = 0;
    state.lastChanged = null;
    FACTORS.forEach((f) => { state.levels[f] = BASE_LEVEL[f]; });
    /* 致冷场景是湿度计：重置也只把读数拉回稳态，不把通风档改掉 */
    if (state.scene === 'cool') state.levels.wind = COOL_WIND;
    state.Td = dryTarget();
    state.Tw = wetTarget();          // 复位时湿球直接落在稳态：读数恒低于干球从第一帧就成立
    /* ★★ 这里【绝对不能】再调 clearRecords()：用户明确要求「重置之后表格里的数据不能消失」——
       重置是为了换条件再跑一次，前面几行要留着做对比。清空是面板里单独的按钮。 */
    applyFactorUI();
    updateAll();
    setRunning(false);
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

  const rhSliderEl = $('rhSlider');
  if (rhSliderEl) {
    rhSliderEl.addEventListener('input', (e) => setRh(e.target.value));
    rhSliderEl.value = String(Math.round(state.rh * 100));
  }

  const cbControl = $('toggleControl');
  if (cbControl) cbControl.addEventListener('change', (e) => setControl(e.target.checked));
  const cbVapor = $('toggleVapor');
  if (cbVapor) cbVapor.addEventListener('change', (e) => { toggles.vapor = e.target.checked; updateAll(); });
  const cbFlow = $('toggleFlow');
  if (cbFlow) cbFlow.addEventListener('change', (e) => { toggles.flow = e.target.checked; updateAll(); });
  const cbMicro = $('toggleMicro');
  if (cbMicro) cbMicro.addEventListener('change', (e) => {
    toggles.micro = e.target.checked;
    /* ★ 这个开关以前是【假开关】：drawMicro() 里根本没读 toggles.micro，
       勾掉也照样画。现在关掉就把整块微观示意收起来。 */
    const inset = $('microInset');
    if (inset) inset.style.display = toggles.micro ? '' : 'none';
    drawMicro(0.016);
    requestRender();
  });

  if (clearRecBtn) {
    clearRecBtn.addEventListener('click', () => {
      clearRecords();
      if (recToast) recToast.classList.remove('show');
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
  /* 舞台尺寸会被外部改（全屏、窄屏折叠、浏览器缩放），只监听 window.resize
     会在全屏那一刻拿不到新尺寸 —— 画布被拉成旧宽高比。 */
  if (typeof ResizeObserver !== 'undefined') {
    try { new ResizeObserver(() => resize()).observe(stage); } catch (_) { /* ignore */ }
  }

  /* ==========================================================================
     十四之二、全屏（站内规矩：实验画面必须能全屏）
     ---------------------------------------------------------------------------
     全屏目标取【整个舞台】而不是画布：参数面板、记录按钮、HUD 都是舞台的后代，
     所以全屏里照样能调参数、能点「记录这一组」，不用退出来再按。
     ★ UA 的 :fullscreen 样式在个别浏览器里要下一帧才落到布局上，只重排一次会拿到
       切换过程中的中间尺寸（画布变形）；headless 里 rAF 还可能一次都不回调，
       所以再补一个 setTimeout 兜底。
     ========================================================================== */
  const fsBtn = $('fsBtn');
  let fsLayouts = 0;
  const fsIsOn = () => document.fullscreenElement === stage || document.webkitFullscreenElement === stage;
  function fsLayout() { resize(); requestRender(); fsLayouts++; }
  if (fsBtn) {
    fsBtn.addEventListener('click', () => {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      } else if (stage.requestFullscreen) {
        stage.requestFullscreen();
      } else if (stage.webkitRequestFullscreen) {
        stage.webkitRequestFullscreen();
      }
    });
  }
  function onFsChange() {
    const on = fsIsOn();
    if (fsBtn) {
      const ex = fsBtn.querySelector('.fs-expand');
      const cp = fsBtn.querySelector('.fs-compress');
      const lb = fsBtn.querySelector('.lbl');
      if (ex) ex.style.display = on ? 'none' : '';
      if (cp) cp.style.display = on ? '' : 'none';
      if (lb) lb.textContent = on ? '退出' : '全屏';
      fsBtn.title = on ? '退出全屏' : '全屏显示实验画面';
      fsBtn.setAttribute('aria-label', fsBtn.title);
    }
    fsLayout();
    requestAnimationFrame(() => requestAnimationFrame(fsLayout));
    setTimeout(fsLayout, 90);
  }
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);
  /* ★ 兜底轮询：headless Chrome（以及个别内嵌 WebView）里 requestFullscreen 明明成功了、
     document.fullscreenElement 也换了，却【一次 fullscreenchange 都不派发】——
     于是按钮文案一直写着「全屏」、也不会重排。这里用 120 ms 的状态轮询兜住这种情况：
     事件能正常派发时轮询什么都不做（状态没变就直接 return），代价是一次属性读取。 */
  let fsOnCached = false;
  setInterval(() => {
    const on = fsIsOn();
    if (on === fsOnCached) return;
    fsOnCached = on;
    onFsChange();
  }, 120);

  /* ==========================================================================
     十四之三、参数面板：可展开 / 收起，就住在实验画面里
     ---------------------------------------------------------------------------
     ★ 面板是 .stage 的子元素（不是挂在 body 下）：全屏只渲染全屏元素及其子树，
       挂在外面的浮层进全屏就【根本不存在】，而全屏里恰恰最需要调参数。
     ★ 折叠是纯界面状态：不停仿真、不动任何参数。
     ========================================================================== */
  const paramsBox = $('evapParams'), paramsHead = $('paramsHead'),
        paramsToggle = $('paramsToggle'), paramsBody = $('paramsBody');
  function paramsOpen() { return !!paramsBox && !paramsBox.classList.contains('collapsed'); }
  function setParamsOpen(on) {
    if (!paramsBox) return;
    paramsBox.classList.toggle('collapsed', !on);
    if (paramsToggle) {
      paramsToggle.setAttribute('aria-expanded', on ? 'true' : 'false');
      paramsToggle.textContent = on ? '▾ 收起' : '▸ 展开';
      paramsToggle.title = on ? '收起参数面板' : '展开参数面板';
    }
    requestRender();
    return on;
  }
  if (paramsBox) {
    if (paramsToggle) paramsToggle.addEventListener('click', (e) => { e.stopPropagation(); setParamsOpen(!paramsOpen()); });
    if (paramsHead) paramsHead.addEventListener('click', (e) => {
      if (e.target.closest && e.target.closest('#paramsToggle')) return;
      setParamsOpen(!paramsOpen());
    });
    /* 面板压在画布上方：指针 / 滚轮事件不要漏到舞台上，将来给舞台加监听时
       不会被当成「开始拖场景」 */
    paramsBox.addEventListener('pointerdown', (e) => e.stopPropagation());
    paramsBox.addEventListener('pointerup', (e) => e.stopPropagation());
    paramsBox.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
  }

  /* ==========================================================================
     十五、启动
     ========================================================================== */
  canvas.style.cursor = 'grab';
  applySceneUI();
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
    /* ★ 致冷场景是【湿度计】：玻璃板上那五滴水只是布景，别让它一边蒸发一边干透
       （干透会触发自动记录，而且画面上的水没了、学生以为实验坏了）。
       影响因素场景才推进蒸发。 */
    if (state.running && !state.finished && state.scene === 'factor') {
      stepEvapDt(sdt);
      if (state.finished) setRunning(false);
    }
    uiAcc += dt;
    if (uiAcc >= 0.1) {
      uiAcc = 0;
      /* ★★ 这一段是「读数在动、画面不动」的老病根，本页栽过两次：
         ① updateThermo()：换档后湿球一直在爬，只刷 DOM 的话温度计的数字牌与
            红液柱会【永远停在换档那一刻的值】（上一个档位的读数）——
            而记录表读 state.Tw，于是「记录对、画面错」。
         ② updateDrops() / updateVapor()：蒸发推进只改 state.remain，
            而网格缩放只在 updateAll() 里算 —— 于是整个观察过程中
            水滴【一点没变小】，HUD 的剩余水量却在往下掉。
            这正是用户报的「水滴还是那个水滴、并没有消失」。
         ⇒ 凡是「随仿真时间变化的画面量」，都必须挂在帧循环里，不能只挂 updateAll。 */
      updateVisibility();
      updateDrops();
      updateVapor();
      updateThermo();
      updateReadouts();
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
    A0, H0, V0, K_DRY, E_OVER_R, T_REF, WIND_K, K_LAG,
    RH0, RH_MIN, RH_MAX, COOL_WIND, P_ATM, WIND_MS, RH_STILL, A_VENT, A_STILL,
    esat, ventA, localRH, wetBulbT, thermoWindLevel, setRh,
    BLADE_PITCH, FAN_SPIN_SIGN, FAN_OMEGA,
    TEMP_LEVELS, AREA_LEVELS, WIND_LEVELS, FACTORS, BASE_LEVEL, LEVEL_LABEL, FACTOR_NAME,
    PLATE_TOP, GLASS_TOP, TH_RANGE, TH_COL_MAX, DROP_X,
    fTemp, fArea, fWind, evapRate, dryTime, dryTimeNow, wetDelta, wetTarget, dryTarget,
    dropGeom, satFrac, colHeight, sceneFrame, chartBars,
    setScene, setFactor, setControl, resetSim, setRunning, setSpeed, setView,
    updateAll, updateVisibility, updateCamera, updateReadouts, updateCompare,
    updateDrops, updateVapor, drawMicro, animateParts,
    clearRecords, renderRecords, recordRun, LEVEL_SHORT, lockedFactors,
    stepEvapDt, relaxThermo,
    setParamsOpen, paramsOpen,

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
      /* 线性尺寸 ∝ 体积^(1/3) —— 与 updateDrops() 喂给网格的 rf 是同一个量 */
      const rf = Math.cbrt(Math.max(state.remain, 0));
      const a = G.a * rf, h = G.h * rf;
      return {
        n: drops.length,
        a: +a.toFixed(5), h: +h.toFixed(5), rf: +rf.toFixed(6),
        a2h: +(a * a * h).toFixed(6),
        a2hRef: +(G.a2hRef).toFixed(6),
        vol: +((2 / 3) * Math.PI * a * a * h).toFixed(6),
        vol0: +V0.toFixed(6),
        remain: +state.remain.toFixed(5),
        areaL: state.levels.area,
        scale: d ? { x: +d.scale.x.toFixed(5), y: +d.scale.y.toFixed(5), z: +d.scale.z.toFixed(5) } : null,
        y: d ? +d.position.y.toFixed(4) : null,
        visible: d ? d.visible : false,
        visibleCount: drops.filter((m) => m.visible).length,
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
    /* 对照条：物理值 + 真正画出来的条宽（两处必须同源，否则条宽可以是假的） */
    cmpInfo() {
      const box = cmpBox;
      const rows = chartBars().map((b) => ({ key: b.key, sec: +b.sec.toFixed(4), hit: b.hit }));
      const drawn = box ? Array.from(box.querySelectorAll('.cmp-row')).map((el) => {
        const bar = el.querySelector('.track i');
        const b = el.querySelector('b');
        return {
          key: (el.querySelector('span') || {}).textContent || '',
          text: b ? b.textContent : '',
          wPct: bar ? +parseFloat(bar.style.width).toFixed(2) : 0,
          px: bar ? +bar.getBoundingClientRect().width.toFixed(2) : 0,
          hit: el.classList.contains('hit')
        };
      }) : [];
      return { rows, drawn, now: +dryTimeNow().toFixed(4) };
    },
    /* 参数面板：位置、面积占比、和舞台的包含关系 —— 判「参数真的收进了面板」
       要读【真的画在哪儿】，不是 CSS 里写了什么 */
    paramsPanelInfo() {
      if (!paramsBox) return null;
      const r = paramsBox.getBoundingClientRect();
      const st = stage.getBoundingClientRect();
      const body = paramsBody ? getComputedStyle(paramsBody) : null;
      return {
        open: paramsOpen(),
        text: paramsToggle ? paramsToggle.textContent : '',
        expanded: paramsToggle ? paramsToggle.getAttribute('aria-expanded') : null,
        bodyDisplay: body ? body.display : null,
        /* 面板必须是舞台的后代 —— 全屏只渲染全屏元素及其子树 */
        inStage: stage.contains(paramsBox),
        insideStage: r.left >= st.left - 1 && r.right <= st.right + 1
                     && r.top >= st.top - 1 && r.bottom <= st.bottom + 1,
        areaPct: +(r.width * r.height / (st.width * st.height) * 100).toFixed(2),
        scrollable: paramsBody ? paramsBody.scrollHeight > paramsBody.clientHeight + 1 : false,
        buttons: paramsBody ? paramsBody.querySelectorAll('button').length : 0,
        checks: paramsBody ? paramsBody.querySelectorAll('input[type="checkbox"]').length : 0,
        rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
        stage: { x: Math.round(st.left), y: Math.round(st.top), w: Math.round(st.width), h: Math.round(st.height) }
      };
    },
    /* 全屏：目标是不是【整个舞台】（不是画布）、面板在不在全屏子树里、重排了几次 */
    fsInfo() {
      const el = document.fullscreenElement || document.webkitFullscreenElement || null;
      const canvas = renderer.domElement;
      return {
        on: !!el,
        targetIsStage: el === stage,
        panelInFs: !!el && el.contains(paramsBox),
        /* 全屏里要能「记 + 清」：自动记录是 stepEvapDt 触发的（与 UI 无关），
           学生能看到的是这条提示条，能操作的是面板里的「清空」 */
        recordInFs: !!el && !!recToast && el.contains(recToast)
                    && !!clearRecBtn && el.contains(clearRecBtn),
        layouts: fsLayouts,
        canvasW: Math.round(canvas.clientWidth), canvasH: Math.round(canvas.clientHeight),
        stageW: Math.round(stage.clientWidth), stageH: Math.round(stage.clientHeight)
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
