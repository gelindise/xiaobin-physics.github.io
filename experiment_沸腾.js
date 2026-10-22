import * as THREE from './assets/optics-three.min.js';

/* ============================================================================
   探究水沸腾时温度变化的特点 —— 三维写实加热实验台
   ---------------------------------------------------------------------------
   世界坐标单位：厘米（cm），y 轴向上，实验台台面为 y = 0。
   器材：铁架台（铸铁底座 + 镀铬立柱 + 铁圈 / 铁夹）、酒精灯、石棉网、
         硼硅玻璃烧杯 + 水、硬纸盖（中央开孔穿温度计）、温度计。
   物理：单节点热平衡 —— 酒精灯给水加热，水向环境散热；到达沸点后温度不再上升，
         多出来的功率全部用于汽化（汽化潜热），水量随之缓慢减少。
         热不是从灯直接进水里的：中间的石棉网、铁圈、杯底是有热容的「余温件」，
         撤火后它们还在供热（指数衰减），所以水会再沸腾两三秒、越沸越弱才停 ——
         这正是真实实验里看到的样子（见 RESID_C / RESID_K）。
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
     转多少不手估：makeThermoScale() 画完直接量出刻度条在贴图里占的水平范围再反算。

     ★ 贴图尺寸 160×1024 → 224×2048：分度值从 2 ℃ 加密到 1 ℃（配合放大镜读数），
       刻度翻倍就必须有足够像素 —— 1 ℃ = 2048/110 ≈ 18.6 贴图像素才画得清。
       宽度同步放大到 224：刻度条贴在半径 0.248 cm 的管壁上，整圈周长 1.558 cm，
       而 0~110 ℃ 占 16.45 cm 高，物理长宽比 ≈ 1 : 10.6；贴图 224 : 2048 ≈ 1 : 9.1
       （原来是 160 : 1024 ≈ 1 : 6.4，数字被竖向拉长了 1.65 倍）—— 数字不再被拉伸。 */
  const SCALE_TEX_W = 224, SCALE_TEX_H = 2048;
  const SCALE_FACE_DEG = -25;
  const SCALE_TICK_X = 100;                          // 主刻度右端（贴图 x）
  const SCALE_NUM_X = 108;                           // 数字左端（贴图 x）
  const SCALE_NUM_FONT = 36;                         // 数字字号（贴图 px）
  const SCALE_STEP = 1;                              // 分度值 ℃ —— 1 ℃ 一条刻度
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

  /* ---- 「石棉网有余温」：撤火后水不会立刻停沸 ----------------------------------
     酒精灯并不直接烧水，中间隔着石棉网、铁圈和烧杯底。这一套「余温件」自己是有
     热容的：撤走酒精灯以后，它们还烫着，继续往水里灌热，只是功率随时间指数衰减 ——
     所以水会【再沸腾两三秒、越沸越弱】，之后才真正开始降温。
     只算水的单节点模型做不到这件事（P 一归零温度立刻往下掉），这里补一个热源节点：
       Th = 石棉网 / 铁圈 / 杯底 的温度，q = K_H·(Th − Tw) = 这一刻真正进入水的功率
     灯还烧着时，余温件在 τ ≈ 1.6 s 内就到达准稳态（Th − Tw = P_LAMP/K_H），
     所以这一段直接按 q = P_LAMP 给水 —— 【加热段与原来逐字节一致】，升温速率不变；
     撤火后 Th 只出不进，C_H·dTh/dt = −q，q 从 P_LAMP 起按 e^(−t/τ) 衰减。
     跌到散热功率（加盖 50 W / 敞口 89 W）所需时间分别约 2.9 s / 1.9 s ——
     这就是那「两三秒」。 */
  const RESID_C = 48;                                // J/K：石棉网 + 铁圈 + 杯底的有效热容
  const RESID_K = 30;                                // W/K：这套余温件向水传热的系数
  const RESID_TAU = RESID_C / RESID_K;               // ≈ 1.6 s：余温衰减的时间常数
  const RESID_MIN = P_LAMP * 0.03;                   // 9 W：余温低于它就算「真的不沸了」（气泡收住）

  /* ---- 「液化放热」的两个参数 ------------------------------------------------
     水面上跑出去的水蒸气碰到温度较低的硬纸盖与杯壁，会在上面【液化】成小水珠。
     液化是汽化的逆过程：汽化时吸走的潜热，液化时【原样放回来】—— 这些热又传回水里。
     这正是「盖上盖子水开得更快」的物理原因，也是本节要补的最后一条知识点。
       · 加盖：蒸气从盖中央的孔缝跑掉一部分，另一部分在盖底 / 杯壁上液化回流；
       · 敞口：水面直接暴露，蒸发 + 对流带走更多热（散热系数放大），且没有任何回流。 */
  const COND_BACK = 0.35;                            // 加盖时汽化的水有 35% 液化回流
  /* 敞口时散热系数放大到 1.8 倍：水面直接暴露，蒸发带走的热大约再多一倍。
     ★ 为什么不是 1.2 / 1.35：那样「加盖开得更快」在曲线上只差 3%，肉眼看不出来，
       教学上等于没说。1.8 倍对应的差别是「同一时刻水温差 3 ~ 4 ℃、到沸点差 20 多秒」，
       画在温度—时间图上是两条明显分开的曲线。这个倍数由 K_LOSS 一处派生，不另写数值。 */
  const LID_LOSS_K = 1.8;
  const DROP_FULL_G = 3.0;                           // 回流 3 g 水珠就长满（画面上「越积越多」的满标）

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
    Th: AMB,                 // 余温件（石棉网 + 铁圈 + 杯底）的温度 ℃
    lampOn: true,            // 酒精灯是否在加热
    lampAnim: 1,             // 0 = 已撤到旁边，1 = 在烧杯正下方
    flameAnim: 1,            // 火焰强度 0~1（撤去时淡出）
    boilStart: -1,           // 开始沸腾的时刻（-1 = 还没沸腾）
    boilTime: 0,             // 已沸腾的时长（模拟秒）
    lidOn: true,             // 是否盖着硬纸盖（加盖 → 蒸气在盖底 / 杯壁上液化回流放热）
    lidAnim: 1,              // 0 = 盖子已抬走（敞口），1 = 盖在杯口
    evapG: 0,                // 累计汽化的水量 g（从水面跑掉的水蒸气）
    condG: 0,                // 累计液化、又流回水里的水量 g
    heatBack: 0,             // 累计液化放热回给水的热量 J
    drawn: { lidDrops: 0, lidLift: 0 },   // 真正画出去的盖底水珠行数（记账，不记意图）
    finished: false,
    step: 0,
    records: [],
    thDepth: 1,              // 温度计插入程度：0 = 提起（离开水面），1 = 浸在水中
    thAnim: 1,               // 动画用的平滑值（默认就是装好的状态）
    /* 组装进度：已经按「自下而上」的顺序装好几件。0 = 全部散放在台面上（页面初始状态）。
       这个数只由 assembledCount() 从器材的实际位姿算出来，不手工加减 ——
       否则「点了一下但器材没动」也会让计数 +1。 */
    assembled: 0
  };
  /* loupe  = 放大镜读数窗（把 1 ℃ 分度的刻度放大来看）
     plot   = 手动描点层（学生自己记下的点）
     plotLink = 把描点连成折线（学生自己连线）
     truth  = 真值曲线 + 沸腾平台着色（★ 默认全关：图要学生自己画，电脑不替他把答案标出来） */
  const toggles = {
    bubbles: true, steam: true, boilLine: true, micro: true,
    loupe: false, plot: false, plotLink: false, truth: false
  };

  const VIEWS = {
    front: { yaw: -0.08, pitch: 0.10, dist: 74, ty: 19.5 },
    angle: { yaw: -0.55, pitch: 0.16, dist: 76, ty: 19.5 },
    top:   { yaw: -0.50, pitch: 0.86, dist: 71, ty: 17 },
    close: { yaw: -0.42, pitch: 0.06, dist: 26, ty: 20.5 },
    /* 组装视角 = 俯视「零件托盘」：散件摊在台面上要占一大片，默认 45° 斜视（dist 76）
       根本框不下。俯角取 0.82 rad（≈47°）：台面在画面里映射成一个斜菱形，
       俯角小时菱形很扁，上下两头全是背景；压到 0.82 后台面几乎铺满画框，
       九件散件才排得开。dist 取 155：散件横向铺开约 800 px，必须够大才装得下。 */
    assemble: { yaw: -0.58, pitch: 0.82, dist: 155, ty: 0 }
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

  /* ------------------------------ 计时器 ------------------------------
     读数就是 state.t（仿真时间），不是 performance.now()。
     理由：曲线图的横轴用的也是 state.t，两处必须同源 —— 否则一调倍速，
     秒表读数和图像横轴就对不上；暂停时秒表也得跟着停。
     三处显示（3D 计时器屏 / 侧栏卡片 / 舞台 HUD）全部从这三个函数取，不各写一遍。 */
  const RECORD_EVERY = 30;                 // 每 30 s 该记录一组
  function formatMMSS(sec) {
    const s = Math.max(0, Math.floor(sec + 1e-9));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }
  /* 距下一次该记录还有多少秒：t=29.9 → 0.1；t=30.1 → 29.9 */
  function nextRecordIn() {
    return Math.max(0, Math.ceil((state.t + 1e-9) / RECORD_EVERY) * RECORD_EVERY - state.t);
  }
  /* 「该记录数据了」的窗口 = 跨过节拍后的前 3 s。
     用「离最近一次节拍过了多久」判定，而不是一个布尔开关：
     布尔开关在暂停/重置时容易忘了清，而且靠 setTimeout 收尾的闪烁在无头环境里不可复现。 */
  const DUE_WINDOW = 3;
  function timerDue() {
    if (state.t < RECORD_EVERY - 1e-9) return false;
    return state.t - Math.floor(state.t / RECORD_EVERY) * RECORD_EVERY < DUE_WINDOW;
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
    return { sleeve, screw, arm };
  }

  const ringBoss = makeBoss(RING_Y, 3.6);
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
    g.lineWidth = 4;
    g.beginPath(); g.moveTo(SCALE_TICK_X, 12); g.lineTo(SCALE_TICK_X, H - 12); g.stroke();
    g.font = `bold ${SCALE_NUM_FONT}px "Helvetica Neue", Arial, sans-serif`;
    g.textAlign = 'left'; g.textBaseline = 'middle';
    /* 分度值 1 ℃：10 ℃ 长刻度 + 数字，5 ℃ 中刻度，其余 1 ℃ 短刻度。
       三级长度差要够大（32 / 22 / 10），否则在管壁上缩到亚像素时三级糊成一片。 */
    for (let T = 0; T <= 110; T += SCALE_STEP) {
      const y = scaleCanvasY(T);
      const major = T % 10 === 0;
      const mid = !major && T % 5 === 0;
      const len = major ? 32 : mid ? 22 : 10;
      g.lineWidth = major ? 5 : mid ? 3.6 : 3;
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
    scaleCanvas = c;                                 // 留给自检「从贴图像素里数刻度条数」
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /* 从【贴图像素】里数刻度线，而不是从代码常量数 ——
     把 SCALE_STEP 从 1 改回 2 时，常量还是写着「每 1 ℃」也照样被抓出来。
     在 x = SCALE_TICK_X − 6 这一列竖着扫：三级刻度（长 32 / 中 22 / 短 10）
     都覆盖这一列，而刻度之间的空白是透明的 ⇒ 有多少段连续暗像素就有多少条刻度。 */
  let scaleCanvas = null;
  function countScaleTicks() {
    if (!scaleCanvas) return -1;
    const W = scaleCanvas.width, H = scaleCanvas.height;
    const d = scaleCanvas.getContext('2d').getImageData(0, 0, W, H).data;
    const col = SCALE_TICK_X - 6;
    let n = 0, inRun = false;
    for (let y = 0; y < H; y++) {
      const on = d[(y * W + col) * 4 + 3] > 8;
      if (on && !inRun) n++;
      inRun = on;
    }
    return n;
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

  /* --- 杯壁 / 盖底的水珠：白气液化成的小水珠（「液化放热」的现场证据）------------
     水蒸气碰到温度较低的杯壁上部与盖沿，就在那里液化 —— 液化时把汽化吸走的潜热
     原样放回来，这些热又传回水里，所以加盖时水开得更快。
     ★ 为什么挂在【杯壁内侧水面上方那一段】而不是盖子的下表面：
       默认视角是从斜上方看的，盖子的下表面被盖板自己挡住，画在那里等于没画。
       杯壁上这一段隔着透明玻璃任何视角都看得见，而且真实实验里最先看到的水珠
       也正是在这里。水珠跟着水位走（水位随汽化下降，水珠始终在水面以上）。 */
  const lidDrops = [];
  for (let i = 0; i < 18; i++) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(1, 10, 8),
      new THREE.MeshPhysicalMaterial({
        color: '#e8f6ff', transparent: true, opacity: 0.80, roughness: 0.03,
        metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 2.2
      })
    );
    m.userData = {
      a: rndB() * Math.PI * 2,              // 绕杯轴的方位角
      rad: BK_R - 0.07,                     // 贴着杯壁内侧
      hFrac: rndB(),                        // 在水面 ~ 盖底之间的归一化高度
      k: 0.60 + rndB() * 0.85,              // 个体大小系数
      sp: 0.6 + rndB() * 1.6                // 轻微晃动的相位速度（水珠不是硬邦邦的球）
    };
    m.visible = false;
    beaker.add(m);                          // 挂在烧杯上：杯壁上的水珠
    lidDrops.push(m);
  }

  /* ==========================================================================
     三之二、台面计时器（数码计时器）
     --------------------------------------------------------------------------
     位置 (x = 24, z = 16)：铁架台底座只占 x∈[-13,13]、z∈[-8.5,8.5]，
     散件又都排在台面外圈，所以它完全不压器材。
     朝向：屏幕法线（局部 +z）正对默认相机的方位角、并向后仰。两个角由
     「计时器位置 → 默认相机位置（−39.2, 31.6, 64.0）」的连线反算，不是手估。
     屏幕正对相机 ⇒ 数字不被透视压扁。

     ★ 读数就是 state.t（仿真时间），不是墙上时钟：
       曲线图的横轴用的也是 state.t，两处必须同源，否则一调倍速就对不上。 */
  const TIMER_POS = { x: 24, z: 16 };
  const TIMER_YAW = -0.922, TIMER_PITCH = -0.351;
  const TIMER_W = 7.2, TIMER_H = 4.6, TIMER_D = 0.8;
  const timerUnit = new THREE.Group();
  timerUnit.position.set(TIMER_POS.x, 0, TIMER_POS.z);

  const timerShellMat = new THREE.MeshStandardMaterial({ color: '#2b3440', roughness: 0.5, metalness: 0.35 });
  const timerScreenMat = new THREE.MeshBasicMaterial({ fog: false });

  const timerStand = new THREE.Mesh(new THREE.BoxGeometry(TIMER_W + 1.2, 0.36, 3.4), timerShellMat);
  timerStand.position.set(0, 0.18, 0.5);
  timerUnit.add(timerStand);

  const timerBody = new THREE.Group();
  timerBody.rotation.order = 'YXZ';
  timerBody.rotation.y = TIMER_YAW;
  timerBody.rotation.x = TIMER_PITCH;
  timerUnit.add(timerBody);

  const timerShell = new THREE.Mesh(new THREE.BoxGeometry(TIMER_W, TIMER_H, TIMER_D), timerShellMat);
  timerBody.add(timerShell);
  // 屏幕：一块贴在壳前面的平面，用 MeshBasicMaterial（不受光照）—— 数字才不会被阴影糊掉
  const timerScreen = new THREE.Mesh(new THREE.PlaneGeometry(TIMER_W - 0.9, TIMER_H - 1.0), timerScreenMat);
  timerScreen.position.set(0, 0, TIMER_D / 2 + 0.02);
  timerBody.add(timerScreen);
  // 顶上一个小按钮，一眼看出这是「可以按的计时器」
  const timerBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.26, 16), timerShellMat);
  timerBtn.position.set(TIMER_W / 2 - 0.9, TIMER_H / 2 + 0.12, 0);
  timerBody.add(timerBtn);
  // 壳底那点高度算准：把整体抬到「最低点正好落在底座上」，别悬空也别插进台面。
  timerBody.position.y = 0.36 + (TIMER_H / 2) * Math.cos(TIMER_PITCH) + (TIMER_D / 2) * Math.abs(Math.sin(TIMER_PITCH));
  scene.add(timerUnit);

  const TIMER_TEX_W = 512, TIMER_TEX_H = 320;
  const timerCanvas = newCanvas(TIMER_TEX_W, TIMER_TEX_H);
  const timerCtx = timerCanvas.getContext('2d');
  const timerTex = new THREE.CanvasTexture(timerCanvas);
  timerTex.colorSpace = THREE.SRGBColorSpace;
  timerTex.anisotropy = MAX_ANISO;
  timerScreenMat.map = timerTex;
  let timerDrawnSec = -1, timerDrawnDue = null;
  /* 只在「显示的秒」或「该记录」状态变化时才重画贴图 —— 每帧重画会白白拖慢帧率 */
  function drawTimerFace(sec, due) {
    const s = Math.max(0, Math.floor(sec + 1e-9));
    if (s === timerDrawnSec && due === timerDrawnDue) return false;
    timerDrawnSec = s; timerDrawnDue = due;
    const g = timerCtx, W = TIMER_TEX_W, H = TIMER_TEX_H;
    g.fillStyle = '#08131f'; g.fillRect(0, 0, W, H);
    // 屏幕边框：到点变橙，和侧栏卡片、记录按钮同一个信号
    g.strokeStyle = due ? '#fb923c' : '#1f3b52';
    g.lineWidth = 12; g.strokeRect(6, 6, W - 12, H - 12);
    g.font = 'bold 34px ui-monospace, SFMono-Regular, Menlo, monospace';
    g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillStyle = '#5f7c93';
    g.fillText(due ? '该记录数据了' : '计时器 t / s', 30, 26);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 168px ui-monospace, SFMono-Regular, Menlo, monospace';
    g.fillStyle = due ? '#fdba74' : '#7dd3fc';
    g.fillText(formatMMSS(s), W / 2, H / 2 + 14);
    g.font = 'bold 30px ui-monospace, SFMono-Regular, Menlo, monospace';
    g.fillStyle = '#8ea6b7';
    g.fillText(`${s} s · 每 30 s 记一组`, W / 2, H - 34);
    timerTex.needsUpdate = true;
    return true;
  }

  /* ==========================================================================
     三之三、器材组装：散放 → 自下而上装成加热装置
     --------------------------------------------------------------------------
     教学点：真实实验里这套装置不是现成的，要一层层从下往上搭 ——
     底座立柱 → 酒精灯（先定火焰高度）→ 铁圈 + 石棉网 → 烧杯 + 水
     → 硬纸盖 → 温度计 + 铁夹。上面每一层的高度都由下面那一层决定。

     ★ 硬闸门：装好之后每件器材的世界坐标必须【逐位等于】升级前的基准位姿。
       做法不是「另写一套组装好的坐标」，而是：初始化时把基准 position / rotation
       存进 PART_BASE；散放 = 基准 + 增量；组装 = 增量归零。
       增量归零时 getWorldPosition 与基准的差恒为 0 —— 没有「抄错常量」的余地。

     ★ 动画必须走 frameStep（真实 rAF 与 driveAnim 共用同一段代码）。
       无头环境 rAF 不触发，验收只能靠 driveAnim 推；若组装自己另写一套推进逻辑，
       把这里改坏照样全绿 —— 这是本仓库反复踩过的坑。 */

  const PART_BASE = new Map();     // obj -> 基准位姿（升级前的原样，只写一次）
  const PART_POSE = new Map();     // obj -> 散放增量 { dx, dy, dz, rx, ry, rz }
  const PART_T = new Map();        // obj -> 0..1（0 = 装好、1 = 散放）
  const ASM_KEY_OF = new Map();    // obj -> 它属于哪个 part key（自检反查用）

  function basePose(o) {
    let b = PART_BASE.get(o);
    if (!b) { b = { pos: o.position.clone(), rot: o.rotation.clone() }; PART_BASE.set(o, b); }
    return b;
  }

  /* 唯一写器材位姿的入口。extra 给「在基准之上再叠一点」用：
     酒精灯左右平移（撤火）、温度计升降、硬纸盖抬起 —— 这三样都有各自的动画，
     全都通过 extra 叠进来，而不是另写 .position。
     散放、组装、tween 的每一帧、animateParts 全都走它 ——
     别处再直接写 position 就会和 tween 打架（写回旧值 ⇒ 动画被吃掉）。 */
  function poseNow(o, extra) {
    const b = basePose(o), p = PART_POSE.get(o), t = p ? (PART_T.get(o) || 0) : 0;
    const ex = extra ? (extra.x || 0) : 0;
    const ey = extra ? (extra.y || 0) : 0;
    const ez = extra ? (extra.z || 0) : 0;
    o.position.set(
      b.pos.x + (p ? p.dx * t : 0) + ex,
      b.pos.y + (p ? p.dy * t : 0) + ey,
      b.pos.z + (p ? p.dz * t : 0) + ez
    );
    if (p) o.rotation.set(b.rot.x + p.rx * t, b.rot.y + p.ry * t, b.rot.z + p.rz * t);
    else o.rotation.copy(b.rot);
  }

  /* 九件散件。steps 只管教学语义与先后，parts 只管画面 —— 两边分开写，
     所以「铁圈 + 石棉网」可以是一个步骤（两件一起装），
     「温度计 + 铁夹」也是（夹子先夹住，温度计才有地方待）。 */
  const ASM_PARTS = [
    { key: 'stand',  label: '铁架台底座', objs: [base, baseTop] },
    { key: 'rod',    label: '镀铬立柱',   objs: [rod] },
    { key: 'lamp',   label: '酒精灯',     objs: [lamp] },
    { key: 'ring',   label: '铁圈',       objs: [ringBoss.sleeve, ringBoss.screw, ringBoss.arm, ring] },
    { key: 'net',    label: '石棉网',     objs: [netMesh, pad] },
    { key: 'beaker', label: '烧杯 + 水',  objs: [beaker] },
    { key: 'lid',    label: '硬纸盖',     objs: [lid] },
    { key: 'thermo', label: '温度计',     objs: [thermometer] },
    { key: 'clamp',  label: '铁夹',       objs: [thSupport] }
  ];
  const ASM_STEPS = [
    { key: 'base',   parts: ['stand', 'rod'],
      name: '铁架台底座 + 立柱', hint: '先把最下面的铸铁底座放稳，立柱才立得住 —— 上面所有器材都挂在它上面。' },
    { key: 'lamp',   parts: ['lamp'],
      name: '酒精灯', hint: '放酒精灯。铁圈要照它的火焰高度来定，所以先摆灯、后定圈。' },
    { key: 'ring',   parts: ['ring', 'net'],
      name: '铁圈 + 石棉网', hint: '铁圈套在立柱上，高度让外焰刚好舔到石棉网；石棉网再铺在铁圈上。' },
    { key: 'beaker', parts: ['beaker'],
      name: '烧杯 + 水', hint: '烧杯坐在石棉网上，水面别超过杯口 —— 温度计还要穿过纸盖。' },
    { key: 'lid',    parts: ['lid'],
      name: '硬纸盖', hint: '硬纸盖盖住杯口、减少散热，中央开的那个小孔留给温度计。' },
    { key: 'thermo', parts: ['thermo', 'clamp'],
      name: '温度计 + 铁夹', hint: '最后装温度计：铁夹夹住管身，感温泡穿过纸盖的小孔浸在水里、不碰杯底。' }
  ];

  /* 散放位姿：水平位移 + 绕轴转角。dy 不手填 —— 由「整件器材最低点落到台面」
     反算（见 restPart），这样以后改了尺寸或转角也不会突然浮起来 / 插进台面。
     ★ 九个落点是【量出来的】，不是估的：用 screenRectOf() 逐件取屏幕包围盒，
       再做坐标下降，把「两两重叠 / 出画框 / 压到四个角的浮层或台面计时器」的代价压到 0，
       并且强制【整块居中】（并集中心贴住画框中心）。
     ★ 标定画框取【1366×900 笔记本】那一档（stage 970 × 658，aspect 1.474）——
       这是最窄的常见画框。手填的值当初就是照 1600×1200 估的，在窄屏上
       rod / stand 会被左边裁掉一截、clamp 从右边出去（实测 aspect < 1.6 就出框）。
       按最窄的档标定，宽屏上只是四周留白多些；反过来就修不回来了。 */
  const ASM_POSE = {
    stand:  { dx: -22, dz: -44, ry: 0.42 },
    rod:    { dx: -35, dz: -6,  ry: 0.0, rz: Math.PI / 2 },
    lamp:   { dx: 4,   dz: -35, ry: -0.26 },
    ring:   { dx: 35,  dz: -25, ry: 0.80, rx: Math.PI / 2 },
    net:    { dx: 17,  dz: -23, ry: -0.42 },
    beaker: { dx: -24, dz: 27,  ry: 0.30 },
    lid:    { dx: -6,  dz: 38,  ry: 0.36 },
    thermo: { dx: 44,  dz: -4,  ry: 0.0, rz: Math.PI / 2 },
    clamp:  { dx: 61,  dz: 16,  ry: 0.90 }
  };

  /* 整件器材在【当前位姿】下的最低点（世界 y）。逐 mesh 量，不用整组 AABB：
     绕轴转过以后 AABB 会把角点撑出去，算出来的台面高度会偏高。 */
  const _asmBox = new THREE.Box3();
  function lowestY(objs) {
    let minY = Infinity;
    for (const root of objs) {
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        if (!o.isMesh) return;
        _asmBox.setFromObject(o, true);
        if (!_asmBox.isEmpty() && _asmBox.min.y < minY) minY = _asmBox.min.y;
      });
    }
    return minY;
  }

  /* ★ 一件器材里可能有多个物体（烧杯 + 水 + 水珠、铁圈 + boss 头、灯 + 火焰）。
     它们必须【作为刚体一起动】：绕同一个支点转，而不是各自绕自己的原点转。
     各自转会把相对位置扯散。 */
  const _asmV = new THREE.Vector3();
  const _asmM = new THREE.Matrix4();
  const _asmE = new THREE.Euler();
  function partPivot(p) { return p.pivot || basePose(p.objs[0]).pos; }

  function layoutPart(p, spec) {
    const pivot = partPivot(p);
    _asmM.makeRotationFromEuler(_asmE.set(spec.rx || 0, spec.ry || 0, spec.rz || 0, 'XYZ'));
    for (const o of p.objs) {
      const b = basePose(o);
      // 绕支点转完该在哪：R·(p − pivot) + pivot。存进 PART_POSE 的仍是「基准 + 增量」，
      // 所以增量归零时物体【逐位回到基准】这条不变量不受影响。
      _asmV.copy(b.pos).sub(pivot).applyMatrix4(_asmM).add(pivot).sub(b.pos);
      PART_POSE.set(o, {
        dx: spec.dx + _asmV.x, dy: _asmV.y, dz: spec.dz + _asmV.z,
        rx: spec.rx || 0, ry: spec.ry || 0, rz: spec.rz || 0
      });
    }
  }

  /* 把整件抬到「最低点正好落在台面」—— dy 不手填：改了尺寸或转角也不会浮起来 / 插进台面。
     台面是平面 ⇒ 这个抬升量只由【转角】决定，跟水平位移无关，所以算一次就能缓存。 */
  const PART_REST = new Map();
  function restPart(p) {
    for (const o of p.objs) { PART_T.set(o, 1); poseNow(o); }
    const rest = -lowestY(p.objs) - PART_POSE.get(p.objs[0]).dy;
    PART_REST.set(p.key, rest);
    for (const o of p.objs) { PART_POSE.get(o).dy += rest; poseNow(o); }
    return rest;
  }

  /* 只改水平位移、复用已缓存的抬升量 —— 摆位搜索走这条快路 */
  function placePart(p, dx, dz) {
    ASM_POSE[p.key].dx = dx; ASM_POSE[p.key].dz = dz;
    layoutPart(p, ASM_POSE[p.key]);
    const rest = PART_REST.get(p.key) || 0;
    for (const o of p.objs) { PART_POSE.get(o).dy += rest; poseNow(o); }
  }

  (function buildScatter() {
    for (const p of ASM_PARTS) {
      for (const o of p.objs) { ASM_KEY_OF.set(o, p.key); basePose(o); }
      layoutPart(p, ASM_POSE[p.key]);
      restPart(p);
    }
  })();

  function partOf(key) { return ASM_PARTS.find((p) => p.key === key); }
  function partProgress(key) {
    const p = partOf(key);
    return p ? (PART_T.get(p.objs[0]) || 0) : 0;
  }
  function setPartT(key, t) {
    const p = partOf(key);
    if (!p) return;
    for (const o of p.objs) { PART_T.set(o, t); poseNow(o); }
  }

  /* 「已经装好几件」= 从第 ① 件开始连续数下去，遇到第一件没装好的就停。
     用前缀而不是计数：乱序把第 ④ 件装了不该让计数变成 1。 */
  function assembledCount() {
    let n = 0;
    for (const s of ASM_STEPS) {
      if (s.parts.every((k) => partProgress(k) < 1e-6)) n++; else break;
    }
    return n;
  }
  function assemblyReady() { return assembledCount() >= ASM_STEPS.length; }

  const ASM_DUR = 0.75;            // 单步组装动画时长（秒）
  let asmTween = null;             // { parts:[key], from, to, k }
  let asmQueue = [];               // 一键组装时排队等着的步骤下标
  let asmNote = '';                // 给侧栏的提示文案（乱序点击等）
  let asmNoteBad = false;

  function asmSay(text, bad) { asmNote = text || ''; asmNoteBad = !!bad; }

  function assembleStep(i, force) {
    if (asmTween) { asmSay('正在装…等这一步动完', true); return false; }
    const done = assembledCount();
    if (i < done) { asmSay('这一步已经装好了', false); return false; }
    if (i > done && !force) {
      asmSay('顺序不对：装置要【自下而上】搭 —— 先装好「' + ASM_STEPS[done].name + '」', true);
      return false;
    }
    const st = ASM_STEPS[i];
    if (!st) return false;
    asmSay('正在装：' + st.name, false);
    asmTween = { parts: st.parts.slice(), from: 1, to: 0, k: 0, step: i };
    return true;
  }

  function autoAssemble() {
    const done = assembledCount();
    if (done >= ASM_STEPS.length) { asmSay('已经装好了', false); return false; }
    asmQueue = [];
    for (let i = done; i < ASM_STEPS.length; i++) asmQueue.push(i);
    if (!asmTween) {
      const next = asmQueue.shift();
      asmTween = { parts: ASM_STEPS[next].parts.slice(), from: 1, to: 0, k: 0, step: next };
      asmSay('一键组装中：' + ASM_STEPS[next].name, false);
    }
    return true;
  }

  function scatterAll() {
    asmQueue = [];
    if (asmTween) {                       // 正在动就先落定，再往回散
      for (const k of asmTween.parts) setPartT(k, asmTween.to);
      asmTween = null;
    }
    const all = ASM_PARTS.map((p) => p.key);
    asmTween = { parts: all, from: 0, to: 1, k: 0, step: -1 };
    asmSay('器材已散放到台面上，重新按顺序装一次', false);
    /* ★ 散放必须把镜头切回「组装视角」：九件器材摊开要占 1128 × 642 px，
       常规 45° 斜视（dist 76）只框得下中间一小块 —— 不切的话用户点完「重新散放」，
       看到的是几件器材杵在画面边上、其余全在画外，像是点坏了。 */
    gotoAssembleView();
    return true;
  }

  /* 立刻落定（不播动画）：给验收脚本做前置状态用，也方便自检把画面推到稳态 */
  function finishAll(to) {
    asmQueue = []; asmTween = null;
    for (const p of ASM_PARTS) setPartT(p.key, to);
    asmSay(to === 0 ? '器材已装好' : '器材已散放', false);
    afterAsmChange();
    return assembledCount();
  }

  function advanceAsm(dt) {
    const tw = asmTween;
    tw.k = Math.min(1, tw.k + dt / ASM_DUR);
    const e = tw.k * tw.k * (3 - 2 * tw.k);          // smoothstep，起步/收尾都不生硬
    const t = tw.from + (tw.to - tw.from) * e;
    for (const k of tw.parts) setPartT(k, t);
    if (tw.k >= 1) {
      for (const k of tw.parts) setPartT(k, tw.to);
      asmTween = null;
      /* ★ 先写好提示文案、再 afterAsmChange()：
         afterAsmChange() 里会调 updateAsmUI() 去读 asmNote，
         顺序反了的话，最后一步装完后侧栏会一直挂着「一键组装中：温度计 + 铁夹」，
         明明已经装好了却没人再刷新它（后续没有别的帧会再碰侧栏）。 */
      if (asmQueue.length) {
        const next = asmQueue.shift();
        asmTween = { parts: ASM_STEPS[next].parts.slice(), from: 1, to: 0, k: 0, step: next };
        asmSay('一键组装中：' + ASM_STEPS[next].name, false);
      } else {
        asmSay(tw.to === 0 ? '器材装好了，可以开始加热' : '器材已散放', false);
      }
      afterAsmChange();
    }
    dirty = true;
  }

  /* 组装状态一变就要做三件事：侧栏清单要不要刷新、开始按钮能不能点、画面要不要重绘 */
  function afterAsmChange() {
    state.assembled = assembledCount();
    updateAsmUI();
    updateReadouts();
    /* 装好的那一刻把镜头拉回常规 45° 斜视：组装视角（dist 155、俯角 47°）是为了
       看清摊开的一桌散件，装置立起来以后用它取景就太远太扁了。 */
    if (assemblyReady() && viewIsAssemble()) {
      Object.assign(view, VIEWS.angle);
      document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === 'angle'));
      updateCamera();
    }
    requestRender();
  }

  function updateAsmUI() {
    const done = assembledCount(), total = ASM_STEPS.length;
    const list = $('asmList');
    if (list) {
      const items = list.querySelectorAll('[data-asm]');
      items.forEach((li, i) => {
        li.classList.toggle('done', i < done);
        li.classList.toggle('next', i === done);
        li.classList.toggle('busy', !!asmTween && asmTween.step === i);
        li.setAttribute('aria-disabled', i === done ? 'false' : 'true');
      });
    }
    const bar = $('asmBar');
    if (bar) bar.style.width = (done / total * 100).toFixed(1) + '%';
    const cnt = $('asmCount');
    if (cnt) cnt.textContent = done + ' / ' + total;
    const hint = $('asmHint');
    if (hint) {
      const nextStep = ASM_STEPS[done];
      hint.textContent = asmNote || (nextStep
        ? `下一步：${nextStep.name} —— ${nextStep.hint}`
        : '六件都装好了。这套装置是【自下而上】搭起来的：底座→灯→圈网→烧杯→纸盖→温度计。');
      hint.classList.toggle('bad', asmNoteBad);
    }
    const auto = $('asmAuto');
    if (auto) {
      auto.disabled = done >= total || !!asmTween;
      auto.textContent = done >= total ? '✓ 已装好' : (done > 0 ? '⚡ 一键装完剩下的' : '⚡ 一键自动组装');
    }
    const scat = $('asmScatter');
    if (scat) scat.disabled = done === 0 && !asmTween;
    const gate = $('runGate');
    if (gate) gate.hidden = assemblyReady();
    /* 开始按钮的门禁：没装好就不给点。用 $('runBtn') 而不是 els.runBtn ——
       本模块在源码里排在 els 之前，直接读 els 会撞上 TDZ（const 未初始化）。 */
    const run = $('runBtn');
    if (run) run.disabled = state.running || !assemblyReady();
  }

  function viewIsAssemble() {
    const b = document.querySelector('[data-view="assemble"]');
    return !!(b && b.classList.contains('active'));
  }

  /* ---- 九件散件整体在屏幕上的包围盒（GL 像素，原点左下）----
     ★ 必须【逐 mesh】量，不能整件器材一次性丢进 Box3.expandByObject：
     那一步先在【世界空间】把一件器材里所有物体并成一个 AABB，再投影它的 8 个角。
     而「转过 90° 的铁杆 / 温度计」这类细长件，世界 AABB 会把角点甩到离器材很远的地方
     （实测散放位下 rod 的 AABB 角点落在画面左下角外），投影出来就是一堆负坐标，
     把并集撑到 1232×964 —— 反推的距离虚大（155 → 260，散件被推得很小）。
     逐 mesh 取 AABB 再各自投影 8 角、最后取并集，量到的才是「真正画出来的范围」。 */
  function scatterRect(log) {
    const gl = renderer.getContext();
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const v = new THREE.Vector3();
    for (const p of ASM_PARTS) {
      for (const root of p.objs) {
        root.updateWorldMatrix(true, true);
        root.traverse((o) => {
          if (!o.isMesh) return;
          _asmBox.setFromObject(o, true);
          if (_asmBox.isEmpty()) return;
          let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
          for (let i = 0; i < 8; i++) {
            v.set(i & 1 ? _asmBox.max.x : _asmBox.min.x,
              i & 2 ? _asmBox.max.y : _asmBox.min.y,
              i & 4 ? _asmBox.max.z : _asmBox.min.z);
            v.project(camera);
            const sx = (v.x * 0.5 + 0.5) * W, sy = (v.y * 0.5 + 0.5) * H;
            if (sx < a) a = sx; if (sx > c) c = sx;
            if (sy < b) b = sy; if (sy > d) d = sy;
          }
          if (log) log.push([p.key, o.name || o.type,
            Math.round(_asmBox.min.x), Math.round(_asmBox.min.y), Math.round(_asmBox.min.z),
            Math.round(_asmBox.max.x), Math.round(_asmBox.max.y), Math.round(_asmBox.max.z),
            Math.round(a), Math.round(b), Math.round(c), Math.round(d)]);
          if (a < x0) x0 = a; if (c > x1) x1 = c;
          if (b < y0) y0 = b; if (d > y1) y1 = d;
        });
      }
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, W, H };
  }

  /* 组装视角的取景【按当前画框自动算】，不是写死 dist 155。
     理由：散件摊开的【世界】尺寸是固定的，而它在屏幕上的横向像素宽 ∝ 画布高 / dist
     （与 aspect 无关）—— 所以画框越窄（1366×900 / 1280×800 的笔记本），
     同一批散件就越挤。写死一个距离的话，窄屏上最左边那几件会被裁掉：
     实测 aspect < 1.6 时 rod / stand 从左边出去、clamp 从右边出去。
     做法：把九件器材临时摆到散放位，量出并集的屏幕包围盒，反推「刚好装下 + 留边距」
     所需的距离；量完立刻还原（中间不 render，用户看不到这一帧）。 */
  function fitAssembleView() {
    Object.assign(view, VIEWS.assemble);
    const saved = ASM_PARTS.map((p) => partProgress(p.key));
    for (const p of ASM_PARTS) setPartT(p.key, 1);
    const gl = renderer.getContext();
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    /* 页面初始化时 resize() 还没跑，画布还是 300×150 的默认尺寸 —— 那种尺寸下算出来的
       距离毫无意义。真正的一次取景放在启动段的 resize() 之后（见「十二、启动」）。 */
    if (W >= 400 && H >= 300) {
      const m = Math.max(8, Math.round(Math.min(W, H) * 0.045));
      /* dist 放大 s 倍，画面上的内容就【朝画框中心收缩】s 倍 ——
         所以每个方向只要算「要让这一侧缩进边距里，最少得缩多少」。 */
      const need = (lo, hi, span) => {
        const c = span / 2, room = c - m;
        if (room <= 0) return 1;
        let s = 1;
        if (lo < m) s = Math.max(s, (c - lo) / room);
        if (hi > span - m) s = Math.max(s, (hi - c) / room);
        return s;
      };
      for (let i = 0; i < 6; i++) {
        updateCamera();
        const r = scatterRect();
        const s = Math.max(need(r.x, r.x + r.w, W), need(r.y, r.y + r.h, H));
        if (s <= 1.004) break;
        view.dist = clamp(view.dist * s, 60, 420);
      }
    }
    ASM_PARTS.forEach((p, i) => setPartT(p.key, saved[i]));
    updateCamera();
  }
  function gotoAssembleView() {
    fitAssembleView();
    document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === 'assemble'));
  }

  /* ---- 屏幕包围盒（GL 像素，原点在左下，与 bulbRect() 同向）----
     摆位断言全靠它：「散件两两不重叠」「每件都完整落在舞台内」「计时器不压器材」
     都必须是【量出来的】，不是估的。 */
  const _rectBox = new THREE.Box3();
  function rectFromBox(box) {
    const gl = renderer.getContext();
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const v = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
      v.project(camera);
      const sx = (v.x * 0.5 + 0.5) * W, sy = (v.y * 0.5 + 0.5) * H;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx);
      y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, W, H };
  }
  function screenRectOf(obj) {
    obj.updateMatrixWorld(true);
    return rectFromBox(_rectBox.setFromObject(obj));
  }
  function screenRectOfMany(objs) {
    const box = new THREE.Box3();
    for (const o of objs) { o.updateMatrixWorld(true); box.expandByObject(o); }
    return rectFromBox(box);
  }
  /* 世界位姿快照：每件器材的每个物体 → [x,y,z, qx,qy,qz,qw]。
     useBase=true 时用的是 PART_BASE（基准 = 升级前原样），
     否则读实际 matrixWorld。两者逐位相等 ⇔ 组装没把原来的摆位挪掉。 */
  function poseSnapshot(useBase) {
    const out = {};
    const v = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    const m = new THREE.Matrix4(), r = new THREE.Matrix4();
    for (const p of ASM_PARTS) {
      out[p.key] = p.objs.map((o) => {
        if (useBase) {
          const b = basePose(o);
          /* 只更新【祖先链】：这里要的只是 o.parent.matrixWorld。
             写成 updateMatrixWorld(true) 会把整棵子树重算一遍 —— 自检要连着调好几轮快照，
             本机 swap 打满时会被拖成换页风暴。 */
          o.parent.updateWorldMatrix(true, false);
          m.compose(b.pos, q.setFromEuler(b.rot), s.set(1, 1, 1)).premultiply(o.parent.matrixWorld);
          m.decompose(v, q, s);
        } else {
          o.updateMatrixWorld(true);
          o.matrixWorld.decompose(v, q, s);
        }
        return [v.x, v.y, v.z, q.x, q.y, q.z, q.w];
      });
    }
    return out;
  }

  /* ==========================================================================
     四、物理积分
     --------------------------------------------------------------------------
     单节点热平衡：酒精灯给水加热，水同时向环境散热。
       dT/dt = (P − k·(T − T₀)) / (m·c)
     一旦 T 到达沸点 Tb，温度就锁在 Tb，多出来的净功率全部变成汽化潜热：
       dm/dt = −(P − k·(Tb − T₀)) / L_v
     ★ P 不是酒精灯的直接功率，而是「余温件」传给水的 q（见 RESID_C / RESID_K）。
       撤火后 q 从 P_LAMP 指数衰减：水还会继续沸腾两三秒、越沸越弱，
       等 q 跌到散热功率以下，温度才开始下降 —— 这才是真实实验看到的样子。
       两个条件缺一不可的那句结论仍然成立：真正不吸热了，沸腾才停。
     散热系数 k 由【加盖 / 敞口】决定；加盖时汽化的水有一部分在盖底 / 杯壁上液化，
     质量与潜热一起回流（液化放热），所以加盖时水开得更快、也更省酒精。
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

  /* 这一刻真正进入水的热功率 W。
     灯在烧：余温件处于准稳态，热就是从灯来的，按满功率算（升温速率与老模型一致）。
     撤了火：只剩它存的那点余温，按温差往水里传，随 Th 一起指数衰减。
     取 ≥ 0：余温件的温度不会低于水温（它就在水底下被烧着），热量不会倒流回网上；
     这一刀只防「外部把 state.T 直接改高」那种不自洽的状态，正常操作里恒为正值。 */
  function heatIn() {
    if (state.lampOn) return P_LAMP;
    return Math.max(0, RESID_K * (state.Th - state.T));
  }

  /* 热源强度 0~1（相对酒精灯满功率）：驱动气泡形态、白气、水面翻腾。
     撤火后它从 1 一路衰减到 0 —— 气泡越来越小、白气越来越淡，就是「越沸越弱」。 */
  function heatFrac() {
    return state.lampOn ? 1 : clamp(heatIn() / P_LAMP, 0, 1);
  }

  /* 画面上的沸腾程度：温度够了【并且】还有热进来才算沸腾。
     撤火后余温还在灌热的两三秒里 vis 从 1 平滑衰减到 0.17（越沸越弱），
     等余温跌破散热功率、温度开始下降，boilness 再把它收到 0。
     只按温度画就会自相矛盾：「沸腾需要继续吸热」正是本节要得出的结论。 */
  function boilnessVis() {
    return boilness() * heatFrac();
  }

  /* 是否在沸腾：到了沸点【并且】净吸热。
     撤火后 q 仍大于散热功率的那两三秒里它还是 true —— 那正是「余温沸腾」。 */
  function isBoiling() {
    if (state.T < state.Tb - 0.02) return false;
    return heatIn() > lossK() * (state.T - AMB);
  }

  /* 撤火后靠余温还在沸的那一段（单独一个阶段：按钮已撤火，但水还在滚） */
  function residBoiling() {
    return !state.lampOn && isBoiling();
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

  /* 散热系数：敞口时水面直接暴露，蒸发 + 对流带走的热更多。
     这是「加盖开得更快」的一半原因，另一半是盖底液化放热回流（见 integrate）。 */
  function lossK() {
    return state.lidOn ? K_LOSS : K_LOSS * LID_LOSS_K;
  }

  function integrate(dt) {
    /* ① 余温件：灯在烧就处在准稳态（比水温高 P_LAMP/K_H）；撤火后它只出不进，
       按 C_H·dTh/dt = −q 指数回落。这一句就是「石棉网有余温」的全部来源 ——
       少了它，撤火瞬间 q 归零、温度立刻掉。 */
    const q = heatIn();
    state.Th = state.lampOn
      ? state.T + P_LAMP / RESID_K
      : Math.max(AMB, state.Th - q / RESID_C * dt);

    const net = q - lossK() * (state.T - AMB);

    if (state.T >= state.Tb - 1e-9 && net > 0) {
      // 沸腾：温度锁死，净功率全部用于汽化，水量缓慢减少
      state.T = state.Tb;
      const dmEvap = net / LV_WATER * dt;            // 这一步汽化掉的水（kg）
      /* 加盖时，跑出去的水蒸气有一部分在盖底 / 杯壁上液化，质量【和潜热】一起回到水里。
         回流比例只在 COND_BACK 一处给出 —— 质量与热量不许各算一个数，否则两边会漂。 */
      const dmBack = state.lidOn ? COND_BACK * dmEvap : 0;
      state.mass = Math.max(0, state.mass - (dmEvap - dmBack));
      state.evapG += dmEvap * 1000;
      state.condG += dmBack * 1000;
      state.heatBack += dmBack * LV_WATER;           // 液化放热：潜热原样放回来
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

  /* 加盖 / 敞口：只改实验条件，【不】清掉已经积累的读数 ——
     读数记录的是「已经真实发生过的事」，跟换气压环境一样，不因为换条件而消失。 */
  function setLid(on) {
    state.lidOn = !!on;
  }

  function resetSim() {
    state.t = 0;
    state.T = AMB;
    state.Th = AMB;           // 余温件也回到室温：重置 = 一套全新的冷器材
    state.mass = M_WATER;
    state.boilStart = -1;
    state.boilTime = 0;
    state.evapG = 0;
    state.condG = 0;
    state.heatBack = 0;
    state.finished = false;
    setLamp(true);            // 「重置」= 回到初始状态：撤走的酒精灯也放回来（否则重置后永远烧不开）
    // 灯的位移与火焰强度是平滑量，重置时必须直接归位；否则重置后头 0.3 s
    // boilnessVis() 还是 0，气泡/白气会「先不出来」再慢慢浮现。
    state.lampAnim = 1;
    state.flameAnim = 1;
    // 盖子同理：重置后不该看到盖子「从旁边慢慢飘回来」。盖子盖不盖是实验条件，
    // 与气压一样【不随重置改变】—— 但动画值必须立刻对齐，免得残留一段过渡。
    state.lidAnim = state.lidOn ? 1 : 0;
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

  /* 曲线图与「手动描点」共用【同一套】坐标映射。
     两处各算一遍的话，描点层和真值曲线会各自落在不同的横轴上 ——
     看着都「画出来了」，其实错位，而单看任一层的断言都发现不了。 */
  function chartGeom() {
    const W = chartCanvas.clientWidth || 640;
    const H = chartCanvas.clientHeight || 232;
    const padL = 42, padR = 16, padT = 14, padB = 26;
    const pw = W - padL - padR, ph = H - padT - padB;
    const tMax = Math.max(240, Math.ceil((state.t + 20) / 60) * 60);
    const T0 = 10, T1 = 110;
    return {
      W, H, padL, padR, padT, padB, pw, ph, tMax, T0, T1,
      X: (t) => padL + (t / tMax) * pw,
      Y: (T) => padT + (T1 - T) / (T1 - T0) * ph
    };
  }

  /* 真值曲线在任意时刻的读数（线性插值）。描点的偏差、图上画的那段竖线、
     自检算的「描点离真值多远」都走这一个函数 —— 一处定义、三处同源。 */
  function truthAt(t) {
    if (!series.length) return NaN;
    if (series.length === 1 || t <= series[0][0]) return series[0][1];
    const lastP = series[series.length - 1];
    if (t >= lastP[0]) return lastP[1];
    for (let i = 1; i < series.length; i++) {
      const a = series[i - 1], b = series[i];
      if (t <= b[0]) {
        const span = b[0] - a[0];
        return span <= 0 ? b[1] : a[1] + (b[1] - a[1]) * (t - a[0]) / span;
      }
    }
    return lastP[1];
  }

  /* 学生描的点 = 他自己按「记录数据」记下的那几组 (t, 水温)。
     ★ 只取【当前气压环境】的记录：拿高原气压下记的点去比平原的真值曲线，
       会凭空出现十几摄氏度的「偏差」—— 那不是误差，是拿错了曲线。
     直接取自 state.records，不另存一份，否则「表里 5 条、图上 6 个点」查不出来。 */
  function plotDots() {
    const G = chartGeom();
    return state.records
      .filter((r) => r.pressure === state.pressure)
      .map((r) => ({ t: r.t, T: r.T, x: G.X(r.t), y: G.Y(r.T) }));
  }

  /* 描点层的全部可读量都从这里出 —— 画面、侧栏文案、自检读的是同一份数据。 */
  function plotStats() {
    const dots = plotDots();
    const devs = dots.map((d) => {
      const Tt = truthAt(d.t);
      return isFinite(Tt) ? d.T - Tt : NaN;
    });
    const abs = devs.filter((v) => isFinite(v)).map(Math.abs);
    return {
      dots, devs, n: dots.length,
      devMax: abs.length ? Math.max.apply(null, abs) : NaN,
      devMean: abs.length ? abs.reduce((a, v) => a + v, 0) / abs.length : NaN
    };
  }

  function drawChart() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const G = chartGeom();
    const { W, H, padL, padR, padT, padB, ph, tMax, X, Y } = G;
    if (chartCanvas.width !== Math.round(W * dpr) || chartCanvas.height !== Math.round(H * dpr)) {
      chartCanvas.width = Math.round(W * dpr);
      chartCanvas.height = Math.round(H * dpr);
    }
    const g = chartCanvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    state.drawn = state.drawn || {};
    state.drawn.chartTMax = tMax;      // 供自检直接读

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

    /* 沸腾平台着色（曲线走平的那一段）—— 它同样在「直接告诉学生哪一段是平台」，
       所以和真值曲线一起显示/隐藏，不能偷偷替学生把答案标出来。 */
    if (toggles.truth && series.length > 1) {
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

    /* 水温曲线 = 真值曲线（橙色）。★ 默认【不画】：
       真实探究里这条线是学生自己描点连线画出来的，电脑替他画好就失去了意义。
       点「对照真值曲线」才显示 —— 用来核对自己连的折线准不准。 */
    if (toggles.truth && series.length > 1) {
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

    /* --- 手动描点层：学生自己记下的点、自己连的折线、与真值曲线的偏差 ---
       画在真值曲线【之后】才不会被曲线盖住；用紫红色，和橙色真值曲线一眼分得开。 */
    const PS = plotStats();
    if (toggles.plot && PS.n) {
      /* 偏差细虚线要有一条【看得见的】参照线才有意义 —— 真值曲线没显示时不画 */
      if (toggles.truth && series.length > 1) {
        g.strokeStyle = 'rgba(232,121,249,0.55)';
        g.lineWidth = 1.2;
        g.setLineDash([3, 3]);
        for (let i = 0; i < PS.dots.length; i++) {
          const d = PS.dots[i], dev = PS.devs[i];
          if (!isFinite(dev)) continue;
          const yt = d.y - dev * (Y(0) - Y(1));       // 偏差换算成像素：每 1 ℃ 的像素高
          if (Math.abs(yt - d.y) < 0.8) continue;     // 几乎重合就不画，免得糊成一团
          g.beginPath(); g.moveTo(d.x, d.y); g.lineTo(d.x, yt); g.stroke();
        }
        g.setLineDash([]);
      }
      if (toggles.plotLink && PS.n > 1) {
        g.strokeStyle = '#e879f9';
        g.lineWidth = 2;
        g.setLineDash([7, 4]);
        g.beginPath();
        PS.dots.forEach((d, i) => (i ? g.lineTo(d.x, d.y) : g.moveTo(d.x, d.y)));
        g.stroke();
        g.setLineDash([]);
      }
      for (const d of PS.dots) {
        g.fillStyle = '#f5d0fe';
        g.strokeStyle = '#a21caf';
        g.lineWidth = 1.4;
        g.beginPath(); g.arc(d.x, d.y, 3.6, 0, 7); g.fill(); g.stroke();
      }
    }

    /* 画面量落进 state.drawn —— 自检直接读这几个数，
       而不是去数画布上有几个紫点（那要靠像素猜，且「点了按钮没重画」也照样绿）。 */
    state.drawn.plotMode = !!toggles.plot;
    state.drawn.plotLinked = !!(toggles.plot && toggles.plotLink);
    state.drawn.plotDots = PS.dots.map((d) => ({ t: d.t, T: d.T, x: d.x, y: d.y }));
    state.drawn.plotSegs = (toggles.plot && toggles.plotLink && PS.n > 1) ? PS.n - 1 : 0;
    state.drawn.plotDevMax = PS.devMax;
    state.drawn.plotDevMean = PS.devMean;
    state.drawn.truthShown = !!toggles.truth;
    state.drawn.seriesPts = series.length;
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
     七之二、放大镜：把感温泡附近的刻度放大来读
     ========================================================================== */
  /* 为什么必须有它：温度计分度值是 1 ℃，而模型上 1 ℃ ≈ 1.04 mm。
     整机视角下整支温度计只有 300 来 px、11.5 cm ⇒ 约 26 px/cm ⇒ 1 ℃ 只有 2.7 px，
     相邻两条刻度在屏幕上直接糊成一条灰带 —— 3D 里本来就读不出来。
     而沸腾实验恰恰要求「水开后温度还变不变」，差的就是这零点几摄氏度。

     ★ 同源要求：放大镜不是另画一把尺子，而是把【同一把尺子】局部放大 ——
       竖直映射唯一真源是 scaleYOf()（「温度 → 世界高度」，液柱顶端和印刷刻度也用它）。
       所以放大镜里的刻度位置和 3D 里印的刻度永远对得上，不可能各说各话。 */
  const loupeCanvas = $('loupeCanvas');
  const loupeRead = $('loupeRead');
  const LOUPE_SPAN = 12;                       // 竖直方向显示 ±6 ℃
  let loupeDrawn = { T: NaN, redY: NaN, ticks: [] };   // 记【实际画出去】的几何，供自检直接读
  function drawLoupe() {
    if (!loupeCanvas) return;
    const W = loupeCanvas.width, H = loupeCanvas.height;
    const g = loupeCanvas.getContext('2d');
    const Tc = state.T;
    const lo = Tc - LOUPE_SPAN / 2, hi = Tc + LOUPE_SPAN / 2;
    const pad = H * 0.05;
    /* 世界高度 → 画布行。canvas y 向下增大，而温度越高世界 y 越大，所以取负号。 */
    const yW0 = scaleYOf(lo), yW1 = scaleYOf(hi);
    const yOf = (T) => H - pad - (scaleYOf(T) - yW0) / (yW1 - yW0) * (H - 2 * pad);

    g.fillStyle = '#08131f'; g.fillRect(0, 0, W, H);
    const ticks = [];
    g.textBaseline = 'middle';
    for (let T = Math.ceil(lo); T <= Math.floor(hi); T++) {
      const y = yOf(T);
      const major = T % 10 === 0, mid = !major && T % 5 === 0;
      const len = major ? W * 0.30 : mid ? W * 0.20 : W * 0.10;
      g.strokeStyle = major ? '#dbeafe' : mid ? '#9fb6c9' : '#5f7c93';
      g.lineWidth = major ? 4 : mid ? 3 : 2;
      g.beginPath(); g.moveTo(24, y); g.lineTo(24 + len, y); g.stroke();
      if (major) {
        g.fillStyle = '#dbeafe';
        g.font = 'bold 34px ui-monospace, SFMono-Regular, Menlo, monospace';
        g.textAlign = 'left';
        g.fillText(`${T}`, 24 + len + 12, y);
      }
      ticks.push({ T, y: +y.toFixed(2), major, mid, len: +len.toFixed(1) });
    }
    /* 红线 = 现在的读数。位置同样由 scaleYOf(Tc) 给出 —— 和上面的刻度同一个式子。 */
    const redY = yOf(Tc);
    g.strokeStyle = '#f43f5e'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(12, redY); g.lineTo(W - 12, redY); g.stroke();
    g.fillStyle = '#f43f5e';
    g.beginPath(); g.moveTo(W - 12, redY); g.lineTo(W - 30, redY - 9); g.lineTo(W - 30, redY + 9); g.closePath(); g.fill();

    loupeDrawn = { T: Tc, redY: +redY.toFixed(2), ticks };
    if (loupeRead) loupeRead.textContent = `${Tc.toFixed(1)} ℃`;
  }

  /* ★ 什么时候才把放大镜亮出来 —— 口径是「组装好之后、加热的时候」：
       · 器材没装好：温度计还在台面上躺着，谈不上读数；
       · 装了但还没点「开始加热」：水就是室温，读不读都一样；
       · 撤去酒精灯 / 重置：加热条件没了，图标跟着收起。
     判据用 `running || t > 0` 而不是只看 running —— 暂停时温度就停在那儿，
     学生照样要读它，图标不该跟着一起消失。 */
  function loupeActive() {
    return assemblyReady() && state.lampOn && (state.running || state.t > 0);
  }

  /* 把放大镜图标贴到温度计旁边。位置是【算出来】的，不是写死的：
     投影出温度计的屏幕包围盒 → 取它的右上角 → 往右挪 GAP、往下挪 DROP。
     往下挪 26px 的原因：温度计最顶上是球帽，真正的刻度露在硬纸盖以上那一段，
     图标压在盖子稍上方最贴近「看刻度」这个动作。
     ★ 窄屏（手机）时舞台只有 350 px 宽，温度计右边被「微观 · 水分子」那块浮层占着，
       硬贴上去会盖住它 ⇒ 右侧放不下就【翻到温度计左边】，并把 y 让到左上说明框的下沿之下。
       让多少不估：直接量 .stage-top 的实际底边。
     ★ 用 transform 而不是 left/top：每帧改 left/top 会触发布局，transform 只走合成。 */
  const panelRectIn = (sel) => {
    const n = stage.querySelector(sel);
    if (!n) return null;
    const b = n.getBoundingClientRect(), s = stage.getBoundingClientRect();
    return { left: b.left - s.left, top: b.top - s.top, right: b.right - s.left, bottom: b.bottom - s.top };
  };
  function placeLoupeHotspot() {
    const el = $('toggleLoupe');
    if (!el) return;
    /* 放大镜开着的时候图标必须留着 —— 否则撤火后图标一藏，学生就再也关不掉读数窗了。 */
    const show = !!(toggles.loupe || loupeActive());
    if (el.hidden !== !show) el.hidden = !show;
    if (!show) return;
    const r = screenRectOf(thermometer);          // GL 像素，原点在左下
    const dpr = renderer.getPixelRatio();
    const cv = canvas.getBoundingClientRect();
    const st = stage.getBoundingClientRect();
    /* GL → 舞台内 CSS 像素：x 同向，y 要翻过来（GL 的 y 向上、CSS 的 y 向下） */
    const ox = cv.left - st.left, oy = cv.top - st.top;
    const thLeft = r.x / dpr + ox;
    const thRight = (r.x + r.w) / dpr + ox;
    const thTop = (r.H - (r.y + r.h)) / dpr + oy;
    const W = stage.clientWidth, H = stage.clientHeight;
    const w = el.offsetWidth || 84, h = el.offsetHeight || 28;
    const GAP = 10, DROP = 26, PAD = 8;
    /* 右边界：舞台内沿，以及右上角「微观」浮层的左沿 —— 谁更靠左听谁的 */
    const micro = panelRectIn('.micro-inset');
    const rightLimit = Math.min(W - PAD, micro ? micro.left - PAD : W - PAD);
    let x = thRight + GAP, y = thTop + DROP;
    if (x + w > rightLimit) {
      x = thLeft - GAP - w;
      const topBox = panelRectIn('.stage-top');
      if (topBox) y = Math.max(y, topBox.bottom + PAD);
    }
    x = clamp(x, PAD, Math.max(PAD, W - w - PAD));
    y = clamp(y, PAD, Math.max(PAD, H - h - PAD));
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }

  /* ==========================================================================
     八、界面刷新
     ========================================================================== */
  const els = {
    temp: $('metricTemp'), boil: $('metricBoil'), state: $('metricState'),
    time: $('metricTime'), mass: $('metricMass'), heat: $('metricHeat'),
    hudTemp: $('hudTemp'), hudBoil: $('hudBoil'), hudLamp: $('hudLamp'), hudTimer: $('hudTimer'),
    finding: $('finding'),
    stateDot: $('stateDot'), stateChip: $('stateChip'), stateNote: $('stateNote'),
    timerCard: $('recTimerCard'), timerMMSS: $('timerMMSS'), timerState: $('timerState'), timerNext: $('timerNext'),
    recordBtn: $('recordBtn'),
    runBtn: $('runBtn'), pauseBtn: $('pauseBtn'), resetBtn: $('resetBtn'), lampBtn: $('lampBtn')
  };

  /* 舞台左上角的状态灯：青＝升温中 / 黄＝即将沸腾 / 橙＝沸腾中 / 深橙＝余温沸腾 / 绿＝降温中。
     和侧栏「状态」指标卡、记录表短状态读同一份 state，而且都从 phase() 一处派生 ——
     否则「画面写着沸腾中、侧栏写着降温中」这种自相矛盾查不出来。 */
  function phase() {
    if (residBoiling()) return 'resid';
    if (isBoiling()) return 'boil';
    if (!state.lampOn) return 'cool';
    if (state.T >= state.Tb - 5) return 'near';
    return 'heat';
  }
  const PHASES = {
    boil:  { chip: '沸腾中',   note: '气泡越升越大',   color: '#fdba74', status: '沸腾中 · 温度不变',      short: '沸腾中' },
    resid: { chip: '余温沸腾', note: '石棉网还在供热', color: '#fb923c', status: '余温沸腾 · 温度仍不变',  short: '余温沸腾' },
    cool:  { chip: '降温中',   note: '撤火 · 已停沸',  color: '#86efac', status: '降温中 · 不再沸腾',      short: '降温中' },
    near:  { chip: '即将沸腾', note: '气泡越升越小',   color: '#facc15', status: '即将沸腾',              short: '快开了' },
    heat:  { chip: '升温中',   note: '杯底冒小气泡',   color: '#7dd3fc', status: '升温中',                short: '升温中' }
  };

  function sampleStateChip() {
    const ph = phase();
    const note = ph === 'heat' && state.T < 45 ? '冷水 · 还没冒泡' : PHASES[ph].note;
    return { text: PHASES[ph].chip, note, color: PHASES[ph].color };
  }

  function statusText() {
    return PHASES[phase()].status;
  }

  /* 右侧窄表格里的短状态，四个字以内才排得下一行 */
  function shortState() {
    return PHASES[phase()].short;
  }

  function updateReadouts() {
    els.temp.textContent = `${state.T.toFixed(1)} ℃`;
    els.boil.textContent = `${state.Tb.toFixed(1)} ℃`;
    els.state.textContent = statusText();
    els.time.textContent = `${state.t.toFixed(0)} s`;
    els.mass.textContent = `${(state.mass * 1000).toFixed(0)} g`;
    /* 液化放热：累计回流的水蒸气液化时放回水里的热量（读数走 state.heatBack，不另算一遍） */
    els.heat.textContent = `${(state.heatBack / 1000).toFixed(2)} kJ`;
    els.hudTemp.textContent = state.T.toFixed(1);
    els.hudBoil.textContent = state.Tb.toFixed(1);
    if (els.hudLamp) {
      els.hudLamp.textContent = state.lampOn ? '加热中'
        : (residBoiling() ? '余温中' : '已撤火');
    }

    /* 舞台左上角状态灯：与侧栏「状态」同源，读的是同一份 state */
    const chip = sampleStateChip();
    if (els.stateDot) {
      els.stateDot.style.background = chip.color;
      els.stateDot.style.boxShadow = `0 0 0 3px ${chip.color}22`;
    }
    if (els.stateChip) els.stateChip.textContent = chip.text;
    if (els.stateNote) els.stateNote.textContent = chip.note;

    /* 计时器：三处（3D 计时器屏 / 侧栏卡片 / 舞台 HUD）同源读 state.t。
       侧栏「距下次记录」与 3D 屏上的秒数也走同一份计算 —— 只要有一处对不上，
       就说明有人又另写了一遍映射。 */
    const due = timerDue();
    if (els.timerMMSS) els.timerMMSS.textContent = formatMMSS(state.t);
    if (els.hudTimer) els.hudTimer.textContent = formatMMSS(state.t);
    if (els.timerNext) els.timerNext.textContent = nextRecordIn().toFixed(1);
    if (els.timerState) {
      els.timerState.textContent = due ? '该记录数据了'
        : state.running ? '计时中' : (state.t > 0 ? '已暂停' : '未开始');
    }
    if (els.timerCard) els.timerCard.classList.toggle('due', due);
    if (els.recordBtn) els.recordBtn.classList.toggle('due', due);
    drawTimerFace(state.t, due);
    /* 放大镜只在打开时重画（关着时它是 hidden 的，画了也没人看） */
    if (toggles.loupe) drawLoupe();
    /* 温度计旁边的放大镜图标：显隐 + 落点都跟着温度计走 */
    placeLoupeHotspot();

    const lowP = state.Tb < 99.5;
    let hint;
    if (!state.lampOn) {
      /* 撤火后先有「余温沸腾」两三秒，再停沸、再降温 —— 三段话各说各的，
         不能一句「立刻停止沸腾」糊过去（那是老版本不真实的简化）。 */
      hint = residBoiling()
        ? `酒精灯已经撤走，但<b>石棉网、铁圈和杯底还是烫的</b> —— 它们存的热还在往水里灌，水<b>仍在沸腾</b>，只是越来越弱。等这点余温散尽、水不再吸热，沸腾才会停。`
        : (state.T >= state.Tb - 5
          ? `余温散尽了：水还是 ${state.T.toFixed(1)} ℃，却<b>已经不再沸腾</b> —— 说明沸腾必须<b>继续吸热</b>，光达到沸点还不够。接下来温度开始下降。`
          : `撤去酒精灯后水温正在下降（现在 ${state.T.toFixed(1)} ℃），气泡很快消失，沸腾停止。`);
    } else if (state.T < state.Tb - 8) {
      hint = `升温中：水温 ${state.T.toFixed(1)} ℃，离沸点还差 ${(state.Tb - state.T).toFixed(1)} ℃。盯住杯底 —— 有小气泡冒出来，但越往上越小。`;
    } else if (state.T < state.Tb - 0.02) {
      hint = `快开了：气泡明显变多变大，却还没到水面就消失了。因为上层水温还低于沸点，泡里的水蒸气遇冷又液化。`;
    } else {
      hint = `正在沸腾：温度死死停在 ${state.Tb.toFixed(1)} ℃，酒精灯还在烧，水还在吸热。气泡一路上升一路<b>变大</b>，到水面破裂放出水蒸气 —— 这些水蒸气遇冷液化成小水珠，就是我们看到的白气。`
        + (state.lidOn
          ? `这些水蒸气碰到温度较低的杯壁和纸盖，就在那里<b>液化</b>成小水珠 —— 液化是汽化的<b>逆过程</b>，汽化时吸走的潜热在这里<b>放热</b>还给了水：到目前为止已经有 <b>${state.condG.toFixed(1)} g</b> 水蒸气液化回流，放回 <b>${(state.heatBack / 1000).toFixed(2)} kJ</b> 热。这正是<b>加盖比敞口开得快</b>的原因。`
          : `<b>现在是敞口</b>：水蒸气一出来就散进空气，没有机会液化回流；水面还直接暴露，蒸发和对流带走更多热 —— 所以敞口比加盖开得慢。切到「盖上硬纸盖」再比一比同一段时间的水温。`)
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
    /* 视觉强度走 boilnessVis（温度够了【且】还有热进来）：
       撤火后它随石棉网余温一路衰减（约 3 s 跌到 0.17），气泡形态、白气、
       水面翻腾跟着一起变弱；余温散尽、温度开始下降时才彻底收住。 */
    const b = boilnessVis();
    const depth = waterDepth();
    /* 烧杯还没装好（散放在台面上）时，气泡 / 白气 / 杯壁水珠都不许出现 ——
       它们是按【装好后的世界坐标】摆的，散放时若照画就会浮在空台上。 */
    const beakerReady = partProgress('beaker') < 1e-6;

    /* 酒精灯：撤去时整盏灯滑到旁边，火焰同步缩小 + 淡出。
       两个平滑值（位置 / 火焰）走同一段代码，所以「熄火」和「移开」是同时发生的。
       ★ 走 poseNow（基准 + 散放增量 + 这一帧的平移），不能直接写 .position.x ——
         散放时酒精灯躺在台面上，直接赋值会把它瞬间拽回原位，组装动画被吃掉。 */
    const lampTarget = state.lampOn ? 1 : 0;
    state.lampAnim += (lampTarget - state.lampAnim) * Math.min(1, dt * 2.6);
    if (Math.abs(lampTarget - state.lampAnim) < 0.002) state.lampAnim = lampTarget;
    poseNow(lamp, { x: LAMP_X0 + (LAMP_X1 - LAMP_X0) * (1 - state.lampAnim) });

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

    /* 硬纸盖：加盖时盖在杯口，敞口时整块抬走（连挂在盖子上的东西一起）。
       ★ 抬走只动 lid.position.y，LID_Y 这个【常量】不变 ——
         「水面没有超过杯口」「温度计穿过盖孔」那类几何判据仍然按常量算，不受影响。 */
    const lidTarget = state.lidOn ? 1 : 0;
    state.lidAnim += (lidTarget - state.lidAnim) * Math.min(1, dt * 2.4);
    if (Math.abs(lidTarget - state.lidAnim) < 0.002) state.lidAnim = lidTarget;
    /* 同样走 poseNow：散放时盖子躺在台面上，直接写 .position.y 会把组装动画吃掉。 */
    poseNow(lid, { y: (1 - state.lidAnim) * 16 });
    if (Math.abs(lidTarget - state.lidAnim) > 5e-4) dirty = true;

    /* 温度计插入 / 提起：指数平滑跟随目标，铁夹带着它一起上下滑 */
    state.thAnim += (state.thDepth - state.thAnim) * Math.min(1, dt * 3.6);
    if (Math.abs(state.thDepth - state.thAnim) < 0.002) state.thAnim = state.thDepth;
    const thLift = (1 - state.thAnim) * TH_LIFT;
    /* 温度计与铁夹都是可散放的器材：走 poseNow，把这一帧的升降叠在散放增量之上。 */
    poseNow(thermometer, { y: thLift });
    poseNow(thSupport, { y: thLift });
    if (Math.abs(state.thDepth - state.thAnim) > 5e-4) dirty = true;   // 只有还在动的时候才要求重绘

    /* 气泡：出生在杯底，按 bubbleScale(u) 决定上升途中是缩还是胀。
       u ≥ 1（到水面破裂）或半径缩到看不见（半路消失）都回收，重新从杯底冒。
       出现条件 = 杯底还在产生水蒸气，也就是【还有热进来】：
       撤去酒精灯后靠石棉网余温还能冒几秒（q 越来越小 → 气泡越来越小），
       余温跌破 RESID_MIN 就收住 —— 不能一撤火就全没，也不能一直冒。
       否则「沸腾需要继续吸热」的结论在画面上就站不住。 */
    const showB = beakerReady && toggles.bubbles && state.T > 42 && (state.lampOn || heatIn() > RESID_MIN);
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

    /* 白气：加盖时从纸盖的孔里冒出来（孔被温度计占着，蒸气从孔壁那圈缝隙喷出）；
       敞口时盖子抬走了，蒸气直接从水面升起。 */
    const steamY0 = state.lidOn ? LID_Y + 0.30 : BK_Y0 + depth + 0.15;
    const steamSpan = state.lidOn ? 8.6 : 9.6;
    for (const m of steams) {
      const u = m.userData;
      m.visible = beakerReady && toggles.steam && b > 0.16;
      if (!m.visible) continue;
      u.ph += dt * u.spd;
      const cyc = u.ph % 1;
      const y = steamY0 + cyc * steamSpan;
      const spread = u.rad + cyc * 1.55;
      m.position.set(Math.cos(u.a) * spread, y, Math.sin(u.a) * spread);
      m.scale.setScalar(u.r0 + cyc * 1.5);
      m.material.opacity = 0.30 * b * Math.sin(cyc * Math.PI) * (1 - cyc * 0.55);
    }

    /* 杯壁 / 盖底的水珠：白气液化的现场证据，越积越多、越积越大。
       水珠始终待在【当前水面以上】那一段杯壁上 —— 水位随汽化下降，水珠跟着往下走。
       ★ state.drawn.lidDrops 记的是【真正 visible 的行数】，不是「打算画几个」。 */
    const sat = clamp(state.condG / DROP_FULL_G, 0, 1);   // 回流满 DROP_FULL_G 克就长满
    const wt = BK_Y0 + depth;
    const bandLo = wt + 0.15, bandHi = LID_Y - 0.14;
    let dropsDrawn = 0;
    for (const m of lidDrops) {
      const u = m.userData;
      const s = u.k * 0.055 * (0.22 + 0.78 * sat);
      m.visible = beakerReady && state.lidOn && sat > 0.02;
      if (!m.visible) continue;
      m.position.set(
        Math.cos(u.a) * u.rad,
        bandLo + u.hFrac * Math.max(0.05, bandHi - bandLo),
        Math.sin(u.a) * u.rad
      );
      m.scale.set(s, s * (0.74 + 0.26 * Math.sin(clock * u.sp + u.a)), s);
      dropsDrawn++;
    }
    state.drawn.lidDrops = dropsDrawn;
    state.drawn.lidLift = lid.position.y;

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
    /* ★ 必须立刻把相机的世界矩阵刷出来。
       screenRectOf / bulbRect 这些「量屏幕落点」的函数走的是 camera.matrixWorldInverse，
       而 three.js 只在 renderer.render() 里更新它 —— 少了这一句，凡是
       「设完视角马上量」的代码（组装视角的自动取景就是）量到的都是【上一帧的相机】：
       包围盒看着还挺合理，其实完全是错的。 */
    camera.updateMatrixWorld(true);
    /* 相机一动，贴在温度计旁边的放大镜图标就得跟着挪 —— 否则拖一下画面图标就飘在半空 */
    placeLoupeHotspot();
    requestRender();
  }

  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    placeLoupeHotspot();
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

  /* --- 器材组装：清单逐条点、一键组装、重新散放 --- */
  document.querySelectorAll('[data-asm]').forEach((li) => {
    li.addEventListener('click', () => { assembleStep(Number(li.dataset.asm)); updateAsmUI(); });
  });
  const asmAutoBtn = $('asmAuto'), asmScatterBtn = $('asmScatter');
  if (asmAutoBtn) asmAutoBtn.addEventListener('click', () => { autoAssemble(); updateAsmUI(); });
  if (asmScatterBtn) asmScatterBtn.addEventListener('click', () => { scatterAll(); updateAsmUI(); });
  /* 页面初始是散放状态 ⇒ 直接用组装视角取景：默认 45° 斜视（dist 76）框不下摊开的一桌器材 */
  if (!assemblyReady()) gotoAssembleView();

  /* --- 放大镜开关（舞台浮层 + 温度计旁边那个图标的按下态一起切） ---
     入口从侧栏搬到了【温度计旁边】的 🔍 图标上，逻辑还是同一份 setLoupe()。 */
  const loupeBtn = $('toggleLoupe'), loupeInset = $('loupeInset');
  function setLoupe(v) {
    toggles.loupe = !!v;
    if (loupeInset) loupeInset.hidden = !toggles.loupe;
    if (loupeBtn) {
      loupeBtn.classList.toggle('active', toggles.loupe);
      loupeBtn.setAttribute('aria-pressed', String(toggles.loupe));
    }
    placeLoupeHotspot();
    if (toggles.loupe) drawLoupe();
    requestRender();
  }
  if (loupeBtn) loupeBtn.addEventListener('click', () => setLoupe(!toggles.loupe));

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
      /* 描点层只取【当前气压环境】的记录 ⇒ 换了气压，图上该出现另一批点。
         同步重画 + 刷新侧栏文案，否则「切了环境图上没变」会被当成按钮坏了。 */
      drawChart();
      syncPlotUI();
    });
  });
  applyPressureUI();

  /* --- 杯口加盖 / 敞口（顺序 6：「液化放热」）---------------------------------
     加盖 → 一部分水蒸气在盖底 / 杯壁上液化回流，质量与潜热一起还给水；
     敞口 → 没有回流，且水面直接暴露、散热更多。两条一起作用，所以加盖开得更快。
     与气压环境一样：这是【实验条件】，重置时不清零已经积累的读数。 */
  function applyLidUI() {
    document.querySelectorAll('[data-lid]').forEach((b) => {
      b.classList.toggle('active', (b.dataset.lid === '1') === state.lidOn);
    });
  }
  document.querySelectorAll('[data-lid]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setLid(btn.dataset.lid === '1');
      applyLidUI();
      refreshAll();
    });
  });
  applyLidUI();

  /* --- 运行控制 --- */
  function setRunning(v) {
    state.running = v;
    /* 没装好就不给点「开始加热」—— 门禁与侧栏清单读同一份状态（assemblyReady），
       不另存一个布尔，免得清单说装好了、按钮还点不动。 */
    els.runBtn.disabled = v || !assemblyReady();
    els.pauseBtn.disabled = !v;
    els.runBtn.textContent = state.t > 0 ? '继续加热' : '开始加热';
  }
  els.runBtn.addEventListener('click', () => {
    if (!assemblyReady()) {
      asmSay('还没装好器材：按 ①→⑥ 的顺序装，或者点「⚡ 一键自动组装」', true);
      updateAsmUI();
      return;
    }
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
    { name: '05 撤去酒精灯', text: '<strong>撤去酒精灯：</strong>点右侧的“撤去酒精灯”。水温仍是 100 ℃，但热源没了 —— 靠石棉网和杯底的<b>余温</b>还能再沸腾两三秒，气泡越来越小、越来越少，余温散尽就<b>彻底停沸</b>，之后温度才开始下降。这说明沸腾必须同时满足两个条件：<b>温度达到沸点</b>、<b>继续吸热</b>，缺一不可。' },
    { name: '06 加盖还是敞口', text: '<strong>加盖还是敞口：</strong>水蒸气跑出水面后碰到温度较低的杯壁和纸盖，会<b>液化</b>成小水珠（看杯壁上越积越多的水珠）。液化是汽化的<b>逆过程</b> —— 汽化吸走多少潜热，液化就<b>放回</b>多少，这些热又传回水里；加上盖子本身挡掉了向空气的散热，所以<b>加盖时水开得更快</b>。点右侧「④ 杯口加盖」在<b>加盖</b>与<b>敞口</b>之间来回切，比一比同一段时间里水温升到多少。' },
    { name: '07 描点画图', text: '<strong>自己画一遍图：</strong>真实的实验报告里，图是自己<b>描点</b>画出来的，不是电脑替你画的 —— 所以这张图上<b>默认没有曲线</b>，要你自己把它画出来。点右侧「② 记录数据」里的<b>「描点画图」</b>，你刚才记下的每一组数据都会变成图上的一个<b>紫点</b>；再点<b>「连成折线」</b>，用直线把这些点依次连起来 —— 这就是手工描点得到的图像。画完之后再点<b>「对照真值曲线」</b>，把橙色的真值曲线叠上来比一比：折线对得上吗？如果水沸腾那一段的点记得太稀，就会把<b>温度不变的那段平台</b>连成一条斜线，看不出“沸腾时温度不变”。所以实验时要在<b>水快开和刚开的那一段多记几组</b>。' }
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
    toggles.plotLink = false;     // 点没了，折线也没有意义
    renderRecords();
    recordHint.textContent = HINT_READY;
    drawChart();
    syncPlotUI();
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
      /* 记下这条记录是在哪个气压环境下取的 —— 描点层只取【当前气压环境】的点，
         拿高原气压下记的点去比平原的真值曲线，会凭空出现十几摄氏度的「偏差」。 */
      pressure: state.pressure,
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
    /* 描点开着的时候，记一组就要立刻多出一个紫点 —— 同步重画，不等下一帧 */
    if (toggles.plot) { drawChart(); syncPlotUI(); }
    requestRender();
  });
  renderRecords();

  /* ==========================================================================
     十一之二、手动描点：把记录变成图上的点，让学生自己连线再和真值曲线比
     ========================================================================== */
  /* 描点层的「按钮状态 + 文案 + 汇总数字」全部读 state.drawn（drawChart 刚写好的那份），
     所以调用顺序必须是【先 drawChart、再 syncPlotUI】—— 反过来会读到上一帧的旧数。 */
  function syncPlotUI() {
    const btnOn = $('plotToggle'), btnLink = $('plotLink'), hint = $('plotHint'), sum = $('plotSum');
    const btnTruth = $('truthToggle');
    const D = state.drawn || {};
    const n = (D.plotDots || []).length;
    if (btnOn) {
      btnOn.classList.toggle('active', !!toggles.plot);
      btnOn.setAttribute('aria-pressed', toggles.plot ? 'true' : 'false');
      btnOn.textContent = toggles.plot ? '收起描点' : '描点画图　把记录点标到图上';
    }
    if (btnLink) {
      btnLink.disabled = !toggles.plot || n < 2;
      btnLink.classList.toggle('active', !!(toggles.plotLink && toggles.plot));
      btnLink.textContent = (toggles.plotLink && toggles.plot)
        ? '取消连线'
        : `连成折线（${n} 点 → ${Math.max(0, n - 1)} 段）`;
    }
    if (btnTruth) {
      btnTruth.classList.toggle('active', !!toggles.truth);
      btnTruth.setAttribute('aria-pressed', toggles.truth ? 'true' : 'false');
      btnTruth.textContent = toggles.truth
        ? '收起真值曲线　只看我自己画的'
        : '对照真值曲线　我连得准不准';
    }
    if (hint) {
      hint.textContent = !toggles.plot
        ? '先点几下「记录数据」，再打开描点 —— 你自己记下的点会变成图上的紫点。'
        : toggles.truth
          ? '紫点 = 你记下的（时刻，水温）；紫虚线 = 你连的折线；橙线 = 电脑算出的真值曲线；细虚线 = 每个点离真值差多少。'
          : '紫点 = 你记下的（时刻，水温）；紫虚线 = 你连的折线。想看自己画得准不准，再点「对照真值曲线」。';
    }
    if (sum) {
      const other = state.records.length - n;
      const tail = other > 0 ? `（另有 ${other} 条记录是在别的大气压环境下取的，切回去才能看到它们的描点。）` : '';
      if (!toggles.plot) {
        sum.textContent = '先「记录数据」，再点「描点画图」把记录标到图上，然后自己连成折线 —— 图是你自己画的，电脑不替你画。';
      } else if (n === 0) {
        sum.textContent = `当前气压环境下还没有记录 —— 先加热、点「记录数据」。${tail}`;
      } else {
        const segTxt = D.plotSegs
          ? `你连的折线共 ${D.plotSegs} 段。`
          : '再点「连成折线」，把点连起来。';
        if (!toggles.truth) {
          sum.textContent = `当前气压环境下描了 ${n} 个点；${segTxt}点「对照真值曲线」可以看看自己连得准不准。${tail}`;
        } else {
          const devTxt = isFinite(D.plotDevMax)
            ? `与真值曲线最大相差 ${D.plotDevMax.toFixed(2)} ℃（平均 ${D.plotDevMean.toFixed(2)} ℃）`
            : '真值曲线还没有第二个采样点，暂时算不出偏差';
          sum.textContent = `当前气压环境下描了 ${n} 个点；${devTxt}。${segTxt}${tail}`;
        }
      }
    }
  }

  /* 三个开关都【同步】重画曲线图：requestRender 只置脏，
     无头环境里没有 rAF，只置脏的话 state.drawn 会一直停在上一次的样子，
     自检读到的就是旧值 —— 点了按钮却什么都没发生，也会全绿。 */
  function setPlotMode(on) {
    toggles.plot = !!on;
    if (!toggles.plot) toggles.plotLink = false;   // 收起描点时连线一并取消，免得下次打开状态错乱
    drawChart();
    syncPlotUI();
    requestRender();
  }
  function setPlotLink(on) {
    toggles.plotLink = !!on;
    drawChart();
    syncPlotUI();
    requestRender();
  }
  /* 真值曲线开关：学生自己描完点、连完线，再点开对照。
     与另两个开关一样【同步】重画 —— 无头环境没有 rAF，只置脏会让自检读到上一帧的状态。 */
  function setTruth(on) {
    toggles.truth = !!on;
    drawChart();
    syncPlotUI();
    requestRender();
  }
  const plotToggleBtn = $('plotToggle'), plotLinkBtn = $('plotLink'), truthBtn = $('truthToggle');
  if (plotToggleBtn) plotToggleBtn.addEventListener('click', () => setPlotMode(!toggles.plot));
  if (plotLinkBtn) plotLinkBtn.addEventListener('click', () => setPlotLink(!toggles.plotLink));
  if (truthBtn) truthBtn.addEventListener('click', () => setTruth(!toggles.truth));
  syncPlotUI();

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
  updateAsmUI();          // 初始：清单 0/6、开始按钮锁住、提示「先装器材」
  /* 组装视角的取景必须在 resize() 之后重算一次：上面 gotoAssembleView() 执行时
     画布还是 300×150 的默认尺寸，那次取景被跳过了（见 fitAssembleView 里的说明）。 */
  if (viewIsAssemble()) fitAssembleView();

  /* 单帧推进。真实 rAF 循环与验收用的驱动钩子走【同一段】代码 ——
     无头沙箱里 requestAnimationFrame 一次都不触发（实测 0 帧/秒），
     若验收自己另抄一遍推进逻辑，改坏这里照样全绿。 */
  let uiAcc = 0;
  function frameStep(dt) {
    if (asmTween) advanceAsm(dt);      // 组装动画与真实循环共用这一处推进
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

  /* 画框一变（窗口缩放 / 笔记本换屏 / 手机转屏），组装视角必须重新取景 ——
     散件的屏幕大小 ∝ 画布高 / dist，画框变小了不重算就会被裁掉。
     顺序不能反：先 resize() 把画布尺寸改好，再按新尺寸算距离。 */
  const relayout = () => {
    resize(); drawChart(); drawMicro(0.016);
    if (viewIsAssemble()) fitAssembleView();
  };
  const ro = new ResizeObserver(relayout);
  ro.observe(stage);
  window.addEventListener('resize', relayout);

  /* --- 供无头验收脚本读取 --- */
  window.__boilLab = {
    state, view, VIEWS, PRESSURES, toggles, series, STEPS,
    camera, renderer, scene,
    thermometer, thSupport, lamp, flameGroup, thScale, mercury,
    bubbles, steams, waterTop, flameLayers, lid, lidDrops,
    thermometerX: TH_X, thBulbY: TH_BULB_Y, thLiftMax: TH_LIFT, thTubeH: TH_TUBE_H,
    stemY0: STEM_Y0, stemY1: STEM_Y1, updateCamera,
    scaleU0, scaleU1, scaleYOf, scaleCanvasY, scaleTexH: SCALE_TEX_H, scaleFaceDeg: SCALE_FACE_DEG,
    /* 温度计刻度与放大镜 —— 供自检「从贴图像素数刻度条数」「红线与真值同源」用。
       ★ 数刻度必须数【贴图像素】，不能读 SCALE_STEP 常量：
         把步长从 1 改回 2 时，常量照样写着 1，只有像素会变。 */
    scaleTickCount: countScaleTicks, scaleTexW: SCALE_TEX_W, scaleStep: SCALE_STEP,
    loupe: {
      span: LOUPE_SPAN,
      readout: () => (loupeRead ? loupeRead.textContent : ''),
      drawn: () => ({ T: loupeDrawn.T, redY: loupeDrawn.redY, ticks: loupeDrawn.ticks.map((t) => Object.assign({}, t)) }),
      /* 把红线换算回温度：拿【实际画出去的两条相邻刻度】线性插值。
         这里【不引用 state.T】—— 否则「红线画错温度」就成了自指恒等式，永远查不出来。 */
      redTempFromTicks() {
        const ts = loupeDrawn.ticks;
        if (ts.length < 2 || !isFinite(loupeDrawn.redY)) return NaN;
        for (let i = 1; i < ts.length; i++) {
          const a = ts[i - 1], b = ts[i];
          const lo = Math.min(a.y, b.y), hi = Math.max(a.y, b.y);
          if (loupeDrawn.redY >= lo - 1e-9 && loupeDrawn.redY <= hi + 1e-9) {
            return a.T + (loupeDrawn.redY - a.y) / (b.y - a.y) * (b.T - a.T);
          }
        }
        return NaN;
      }
    },
    /* 温度计【旁边】那个放大镜图标：显隐口径 + 落点都是算出来的，自检直接量 DOM。
       位置判据必须量 getBoundingClientRect 与温度计屏幕包围盒的关系，
       不能量 CSS 里那个写死的数值 —— 那正是这套「跟着温度计走」要防的东西。 */
    loupeHotspot: {
      active: loupeActive,
      hidden: () => { const e = $('toggleLoupe'); return e ? !!e.hidden : null; },
      place: placeLoupeHotspot,
      rect() {
        const e = $('toggleLoupe');
        if (!e || e.hidden) return null;
        const b = e.getBoundingClientRect(), s = stage.getBoundingClientRect();
        return { x: b.left - s.left, y: b.top - s.top, w: b.width, h: b.height,
                 stageW: s.width, stageH: s.height };
      }
    },
    setLoupe,
    rodTop: BASE_H + ROD_H, clampY: CLAMP_Y, sleeveHalf: 1.15,
    lidY: LID_Y, bkY0: BK_Y0, bkR: BK_R, waterH: WATER_H, bulbR: TH_BULB_R,
    /* 「液化放热」用到的常量与入口：判据一律读这里报出来的值，不自己重抄公式 */
    COND_BACK, LID_LOSS_K, DROP_FULL_G, lossK,
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
      return {
        t: state.t, T: state.T, Tb: state.Tb, mass: state.mass, boiling: isBoiling(), boil: boilness(),
        /* 余温件：Th 是石棉网/铁圈/杯底现在的温度，q 是这一刻真正进水的功率 */
        Th: state.Th, q: heatIn(), heatFrac: heatFrac(), resid: residBoiling(),
        lidOn: state.lidOn, evapG: state.evapG, condG: state.condG, heatBack: state.heatBack
      };
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
        lampX: lamp.position.x, flameVisible: flameGroup.visible,
        /* 盖子与盖底水珠：lidLift 是盖子真正被抬走的高度，lidDrops 是【真正画出去】的行数 */
        lidAnim: state.lidAnim, lidLift: lid.position.y, lidDrops: state.drawn.lidDrops
      };
    },
    statusText, shortState, renderRecords, clearRecords, microStats, sampleStateChip,
    /* 手动描点：映射、取点、统计、开关，全部从这几个入口走 ——
       自检不自己重抄一遍 X/Y，也不靠数画布上的紫点。 */
    chartGeom, truthAt, plotDots, plotStats, setPlotMode, setPlotLink, setTruth, syncPlotUI,
    plotDrawn() {
      const D = state.drawn || {};
      return {
        mode: !!D.plotMode, linked: !!D.plotLinked, segs: D.plotSegs || 0,
        dots: (D.plotDots || []).map((d) => ({ t: d.t, T: d.T, x: d.x, y: d.y })),
        devMax: D.plotDevMax, devMean: D.plotDevMean,
        truth: !!D.truthShown, seriesPts: D.seriesPts || 0
      };
    },
    /* 图像横轴上限：由 drawChart 每次重画时写入，换气压环境必须跟着变 */
    chartTMax() { return (state.drawn && state.drawn.chartTMax) || NaN; },
    /* 台面计时器：读数 = state.t，和曲线图横轴同源。
       导出的是【算读数用的那几个函数本身】，不是快照 —— 自检若自己另抄一遍
       formatMMSS/nextRecordIn，把页面里的改坏了照样全绿。 */
    timer: {
      every: RECORD_EVERY, dueWindow: DUE_WINDOW,
      formatMMSS, nextRecordIn, timerDue,
      readout: () => formatMMSS(state.t),
      faceText: () => formatMMSS(timerDrawnSec < 0 ? state.t : timerDrawnSec),
      faceDrawn: () => ({ sec: timerDrawnSec, due: timerDrawnDue }),
      nextIn: () => nextRecordIn(),
      due: () => timerDue()
    },
    timerUnit, timerBody, timerScreen,
    /* 任意场景物体的屏幕包围盒（GL 坐标，原点在左下，与 bulbRect() 同向）。
       摆位断言用它 —— 「散件不重叠」「计时器不压器材」都必须是量出来的，不是估的。 */
    screenRectOf,
    /* ---- 器材组装 ---------------------------------------------------------
       导出的都是【算这些量的函数本身】，不是快照：
       自检若自己另抄一遍 assembledCount / poseNow，把页面里改坏了照样全绿。 */
    asm: {
      steps: ASM_STEPS.map((s) => ({ key: s.key, name: s.name, parts: s.parts.slice(), hint: s.hint })),
      parts: ASM_PARTS.map((p) => ({ key: p.key, label: p.label })),
      total: ASM_STEPS.length,
      count: assembledCount,
      ready: assemblyReady,
      progress: partProgress,
      busy: () => !!asmTween,
      queued: () => asmQueue.length,
      note: () => ({ text: asmNote, bad: asmNoteBad }),
      /* 散放增量（含由「最低点落台面」反算出来的 dy），供自检核对「散件真的摊开了」 */
      poseOf(key) { const p = PART_POSE.get((partOf(key) || {}).objs?.[0]); return p ? Object.assign({}, p) : null; },
      specOf(key) { const s = ASM_POSE[key]; return s ? Object.assign({}, s) : null; },
      /* 摆位调参 / 摆位搜索用：只改水平位移，抬升量复用缓存（跟 dx/dz 无关） */
      setPose(key, dx, dz) {
        const p = partOf(key); if (!p) return null;
        placePart(p, dx, dz);
        return { dx, dz, dy: +PART_POSE.get(p.objs[0]).dy.toFixed(2) };
      },
      /* 整件器材的世界包围盒（含 y）—— 用来卡「必须落在实验台范围内」。
         precise=false 走 AABB 快路（摆位搜索要用上千次）；自检断言用 precise=true，
         否则转过 90° 的圆环会被 AABB 撑大，量出来的「最低点」是假的。 */
      worldOf(key, precise) {
        const p = partOf(key); if (!p) return null;
        const box = new THREE.Box3();
        for (const o of p.objs) { o.updateMatrixWorld(true); box.expandByObject(o, !!precise); }
        return { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] };
      },
      /* 屏幕包围盒：整件器材（多件物体取并集） */
      rectOf(key) { const p = partOf(key); return p ? screenRectOfMany(p.objs) : null; },
      /* 九件散件【整体】的屏幕包围盒 —— 取景反推距离用的就是它。
         传 true 时附带逐 mesh 明细（世界 AABB + 屏幕矩形），用于定位异常件。 */
      rectAll(withLog) {
        const log = withLog ? [] : null;
        const r = scatterRect(log);
        return log ? { rect: r, meshes: log } : r;
      },
      /* 世界位姿快照。useBase=true 给的是【基准】（= 升级前原样），
         另一个给的是当前实际位姿 —— 两者逐位相等才说明「组装没把摆位挪掉」。 */
      snapshot(useBase) { return poseSnapshot(!!useBase); },
      /* ★ 导出的入口必须与「点清单 / 点按钮」【同一条路径】。
         assembleStep / autoAssemble / scatterAll 内部只调 asmSay() 写两个模块变量，
         真正的刷新（提示文案、.bad 标红、清单 done/next 高亮）发生在【点击处理里】的
         updateAsmUI()。直接调导出函数就会看到【陈旧侧栏】——「拒绝乱序」的提示一个字都不显示，
         于是「画面没变」会被误读成「功能没生效」。
         这里补一层刷新，让探针绕过 DOM 也拿到与用户所见一致的结果。
         finishAll 不用包 —— 它内部走 afterAsmChange()，本来就会刷新。 */
      assembleStep: (i, force) => { const r = assembleStep(i, force); updateAsmUI(); return r; },
      autoAssemble: () => { const r = autoAssemble(); updateAsmUI(); return r; },
      scatterAll: () => { const r = scatterAll(); updateAsmUI(); return r; },
      finishAll,
      /* 组装视角：dist 是【按当前画框算出来的】，不是 VIEWS.assemble 里那个基准值 */
      view: () => ({ ...VIEWS.assemble, dist: view.dist }),
      gotoView: gotoAssembleView,
      fit: fitAssembleView
    },
    boilness, boilnessVis, isBoiling, residBoiling, heatIn, heatFrac, bubbleScale, waterDepth, boilingPoint,
    /* 余温件参数：自检要按这些常量算「撤火后还能沸几秒」，不许在脚本里另抄一份 */
    resid: { C: RESID_C, K: RESID_K, tau: RESID_TAU, min: RESID_MIN, P: P_LAMP },
    setPressure(key) { setPressure(key); applyPressureUI(); refreshAll(); },
    /* 加盖 / 敞口：对外只暴露这一个入口，UI 高亮与重绘一起做 */
    setLid(on) { setLid(on); applyLidUI(); refreshAll(); },
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