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

  /* 印刷刻度：贴图尺寸、版面，以及「刻度条要正对哪个方位角」。
     刻度是贴在圆柱管壁上的（FrontSide），贴图的 u 决定它落在管子的哪一侧；
     画在背面 = 相机永远看不到（实测四个默认视角里刻度条只有 3~12 px 宽，等于没画）。
     默认视角的相机方位角在 −0.08 ~ −0.55 rad（≈ −4.6° ~ −31.5°），所以让刻度条正对 −25°。
     转多少不手估：makeThermoScale() 画完直接量出刻度条在贴图里占的水平范围再反算。

     ★ 贴图尺寸 160×1024 → 320×2048（宽高【一起】翻倍，不是只翻高）：
       刻度条贴在半径 0.248 cm 的管壁上，整圈周长 1.558 cm，而 0~100 ℃ 占 10.3 cm 高。
       物理长宽比 ≈ 1 : 6.6，贴图 160 : 1024 ≈ 1 : 6.4 —— 两者对齐，数字才不会被拉伸。
       只把高翻倍会让长宽比变成 1 : 12.8，字会被竖向拉长一倍。
       翻倍后 1 ℃ = 20 贴图像素，短刻度线才画得清（原来 2 ℃ = 10 px）。 */
  const SCALE_TEX_W = 320, SCALE_TEX_H = 2048;
  const SCALE_FACE_DEG = -25;
  const SCALE_TICK_X = 142;                          // 主刻度右端（贴图 x）
  const SCALE_NUM_X = 150;                           // 数字左端（贴图 x）
  const SCALE_NUM_FONT = 40;                         // 数字字号（贴图 px）
  const SCALE_STEP = 1;                              // 分度值 ℃ —— 1 ℃ 一条刻度
  let scaleU0 = 0, scaleU1 = 1;                      // 由 makeThermoScale() 实测填入

  const MAX_WEIGHTS_UNUSED = 0;                      // （占位，保持常量区整齐）

  /* ------------------------------ 物理参数 ------------------------------ */
  /* ★ 为什么 M_WATER 从 0.25 改成 0.12、并新增 Q_TUBE —— 这一组数不是凑出来的，
     它们由「图上两条斜率必须不一样陡」这个教学目标反推出来，推导如下：

     原来 q = K_COUPLE·(Tw − Tt) 是无上限的线性传热。水浴 250 g 比试样 20 g 大 12.5 倍，
     稳态下 Tw − Tt 收敛到一个常数，于是 dTt/dt ≈ dTw/dt —— 试样的斜率被水浴「锁住」，
     跟自己的比热容无关，固态液态自然一样陡。数值复现：液态段中斜率 0.591 K/s，
     反而是固态段 0.243 K/s 的 2.4 倍，跟课本图正好相反。

     改法：给试管热流加一个饱和上限 Q_TUBE（热量要穿过试管壁再进试样内部，热流有上限）。
     于是试样拿到近似恒定的热流，dTt/dt ≈ Q_TUBE/(M_SAMPLE·c) —— 斜率终于由 c 决定，
     斜率比 = c_固/c_液 = 1700/2400 = 0.708，正是课本的形状。

     但「恒定热流」要成立，还有一个必要条件：水浴必须始终跑在试样前面，即
         P/(M_WATER·C_WATER) > Q_TUBE/(M_SAMPLE·c_固)
         0.60 K/s            >  0.44 K/s            ✓
     水浴一旦跑不到前面，q 就够不到上限、试样又被锁回去。实测：M_WATER=0.15/Q=16 时
     比值掉到 0.83；M_WATER=0.25/Q=18 时掉到 0.80 并开始反向 —— 这就是 M_WATER 必须减半的原因。

     K_COUPLE 从 2.2 提到 4：让热流在温差 3.75 K（= Q_TUBE/K_COUPLE）时就到达上限。
     否则固态段前 25 s 都在爬升，段平均斜率被稀释到 0.386，跟液态段的 0.313 只差 1.23 倍，
     肉眼还是「差不多」。提到 4 之后段平均 0.410 vs 0.313，差 1.31 倍。

     实测（node 复现页面积分器，h=0.005 与 0.05 结果一致）：
       改前 固态 127 s(0.243) / 平台 122 s / 液态 179 s(0.591) / 总 428 s / 段中比 2.44 ✗
       改后 固态  68 s(0.441) / 平台 267 s / 液态 154 s(0.313) / 总 489 s / 段中比 0.708 ✓
     凝固方向同一行代码自动对称（q 为负时取 −Q_TUBE 下限），比值同样是 0.708。 */
  const AMB = 20;                                    // 室温 ℃
  const M_WATER = 0.12;                              // 水浴质量 kg（原 0.25 —— 保证水浴升温率 0.60 K/s）
  const C_WATER = 4200;                              // 水的比热容
  const P_LAMP = 300;                                // 酒精灯有效功率 W
  const K_LOSS = 2.0;                                // 水浴向环境散热 W/K
  const K_COUPLE = 4;                                // 水浴→试管 的传热系数 W/K（原 2.2）
  const Q_TUBE = 15;                                 // 试管壁灌进试样的最大热流 W（新增）
  const TW_MAX = 100;                                // 标准大气压下水浴上限
  const M_SAMPLE = 0.02;                             // 试样 20 g

  /* --- 凝固（冷却）方向：把同一台仪器反过来用 ---
     撤走酒精灯、把烧杯里的水换成冰水。冰没化完之前冰水浴温度钉在 0 ℃，
     试样传给它的热量全部用来化冰 —— 这样水浴一直比试样冷，热流方向才稳定。 */
  const FREEZE_T0 = 65;                              // 凝固实验的起点温度（刚熔化完的液态海波）
  const T_ICE = 0;                                   // 冰水浴温度（冰没化完时恒定）
  const M_ICE = 0.12;                                // 冰水浴里的冰 120 g
  const L_ICE = 3.34e5;                              // 冰的熔化热 J/kg
  const T_STOP_COLD = 10;                            // 降到 10 ℃ 判定凝固实验结束

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
    direction: 'melt',   // 'melt' = 熔化（水浴加热）；'freeze' = 凝固（冰水浴冷却）
    running: false,
    speed: 10,
    t: 0, Tt: AMB, Tw: AMB, phi: 0, soft: 0,
    iceLeft: 0,          // 冰水浴里剩下的冰（kg）；0 = 没在用冰水浴
    finished: false,
    step: 0,
    records: [],
    thDepth: 1,          // 温度计插入程度：0 = 提起（感温泡离开试样），1 = 插到底
    thAnim: 1,           // 动画用的平滑值（默认就是装好的状态，点「提起」才看得到动作）
    xray: true,          // 透视：试样半透明，能看见里面的玻璃泡
    /* 组装进度：已经按「自下而上」的顺序装好几件。0 = 全部散放在台面上（页面初始状态）。
       这个数只由 assembledCount() 从器材的实际位姿算出来，不手工加减 ——
       否则「点了一下但器材没动」也会让计数 +1。 */
    assembled: 0
  };
  /* plot = 「手动描点」模式：把学生自己记下的那几组 (t, T) 标到图上；
     plotLink = 学生自己把点连成折线。两个都是开关，不参与物理推进。 */
  const toggles = { bath: true, melt: true, micro: true, loupe: false, plot: false, plotLink: false };

  const VIEWS = {
    front: { yaw: -0.08, pitch: 0.10, dist: 85, ty: 22.5 },
    angle: { yaw: -0.55, pitch: 0.16, dist: 87, ty: 22.5 },
    top:   { yaw: -0.50, pitch: 0.86, dist: 82, ty: 20 },
    close: { yaw: -0.42, pitch: 0.06, dist: 30, ty: 22.5 },
    /* 组装视角 = 俯视「零件托盘」：
       散件摊在台面上要占一大片，默认 45° 斜视（dist 87）根本框不下。
       俯角取 0.82 rad（≈47°）不是随便挑的 —— 台面在画面里映射成一个【斜菱形】，
       俯角小的时候这个菱形很扁：实测 pitch 0.40 时台面只占画面中段 470 px 高的一条带，
       上下两头全是背景，而且菱形被压得又窄又长。压到 0.82 以后台面几乎铺满整个画框，
       十个零件才排得开（见 melt-asm-autolayout 的搜索结果）。

       dist 取 158：屏幕上的水平偏移只跟舞台【像素高】成正比
       （pixel_x = W/2 + H·x_cam/(2·z·tan(fov/2))），而舞台高在 1280~1920 之间
       只从 640 变到 660 —— dist 一定，散件占的像素宽度就基本不变。
       摆位是在 1440（舞台 GL 1044×658）上搜出来的，横向铺开约 840 px；
       1280 时舞台只有约 882 px 宽 ⇒ dist 必须够大才装得下。 */
    assemble: { yaw: -0.58, pitch: 0.82, dist: 158, ty: 0 }
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
     三处显示（3D 屏幕 / 侧栏卡片 / 舞台 HUD）全部从这三个函数取，不各写一遍。 */
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
    return { sleeve, screw, arm };
  }

  /* 两个 boss 头（铁圈用 / 试管夹用）的句柄要留着 —— 组装时它们各自跟着铁圈、试管夹走 */
  const bossRing = makeBoss(RING_Y, 3.6);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(5.3, 0.26, 12, 40), darkSteel);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(0, RING_Y, -0.35);
  ring.castShadow = true;
  stand.add(ring);

  const bossClamp = makeBoss(CLAMP_Y, 3.4);
  const clampArm = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 4.4), darkSteel);
  clampArm.position.set(0, CLAMP_Y, -2.6);
  clampArm.castShadow = true;
  stand.add(clampArm);
  const jaws = [];
  for (const s of [-1, 1]) {
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.36, 0.5), darkSteel);
    jaw.position.set(s * 1.55, CLAMP_Y, 0.55);
    jaw.rotation.z = s * 0.16;
    jaw.castShadow = true;
    stand.add(jaw);
    jaws.push(jaw);
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
  /* 摇曳只写在 flameWob 这一层，flameGroup 的本体位姿保持精确 ——
     否则「组装后世界坐标必须逐位等于基准」这条硬闸门会被一朵火苗的抖动顶掉。 */
  const flameWob = new THREE.Group();
  flameGroup.add(flameWob);

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
    flameWob.add(m);
    flameLayers.push({ mesh: m, base: s });
  }
  // 外圈柔和辉光：把锥体的硬轮廓“糊”开（太亮会把火焰整个冲成白色，压到 0.4）
  const flameGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeGlowMap(), transparent: true, opacity: 0.40,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false
  }));
  flameGlow.scale.set(5.4, 7.2, 1);
  flameGlow.position.set(0, FLAME_H * 0.40, 0);
  flameWob.add(flameGlow);
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

  /* --- 冰水浴的碎冰：只有「凝固」方向才显示 ---
     半透明的冰块漂在水面上，是为了让「烧杯里的水已经不是热水了」一眼可见 ——
     否则两个方向在画面上只差一盏酒精灯，学生分不清自己在做哪个实验。 */
  const iceGroup = new THREE.Group();
  beaker.add(iceGroup);
  const iceMat = new THREE.MeshPhysicalMaterial({
    color: '#eef8ff', roughness: 0.20, metalness: 0.0, transparent: true,
    opacity: 0.74, clearcoat: 1.0, clearcoatRoughness: 0.12, envMapIntensity: 1.7
  });
  const ices = [];
  (() => {
    const rndI = mulberry32(31337);
    for (let i = 0; i < 15; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), iceMat);
      const sc = 0.52 + rndI() * 0.6;
      m.scale.set(sc * (0.82 + rndI() * 0.5), sc * (0.58 + rndI() * 0.44), sc * (0.82 + rndI() * 0.5));
      const a = rndI() * 6.28, rr = (0.18 + rndI() * 0.78) * (BK_R - 0.95);
      m.position.set(Math.cos(a) * rr, WATER_TOP - 0.26 - rndI() * 0.55, Math.sin(a) * rr);
      m.rotation.set(rndI() * 0.8, rndI() * 6.28, rndI() * 0.8);
      m.userData = { ph: rndI() * 6.28, y0: m.position.y, spin: (rndI() - 0.5) * 0.4 };
      iceGroup.add(m); ices.push(m);
    }
  })();
  iceGroup.visible = false;

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
  /* 固相 vs 液相的区分靠【三级差】叠起来，不靠一个参数：
       ① 明度：固相近纯白（海波晶体本来就是很白的固体），液相是极浅的冷白；
       ② 透明：固相不透明，液相明显透光（熔融海波是澄清液体）；
       ③ 光泽：固相哑光颗粒感（强 bump），液相是强高光的镜面液面。
     原来固相 #f7ead0（暖奶油）配液相 #d5ebef（浅蓝白），两者都是浅色半透明，
     在深色背景上只差一点色温 —— 实测看不出「白色晶体」和「澄清液体」。 */
  const solidMat = new THREE.MeshStandardMaterial({
    map: solidTex, bumpMap: solidBump, bumpScale: 0.10, color: '#ffffff', roughness: 0.58, metalness: 0.02
  });
  const liquidMat = new THREE.MeshPhysicalMaterial({
    color: '#eaf6fa', transparent: true, opacity: 0.40, roughness: 0.03, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 2.2, depthWrite: false
  });
  /* 固液共存带：白晶体 + 澄清液混在一起，比固相透、比液相「有颗粒」 */
  const mushMat = new THREE.MeshStandardMaterial({ color: '#fbf8f2', roughness: 0.86, metalness: 0 });

  const solidMesh = new THREE.Mesh(unitCyl, solidMat);
  const liquidMesh = new THREE.Mesh(unitCyl, liquidMat);
  const liquidTopMesh = new THREE.Mesh(unitDisk, liquidMat);
  liquidTopMesh.rotation.x = -Math.PI / 2;
  const mushMesh = new THREE.Mesh(unitCyl, mushMat);

  /* 固相顶面：一个压扁的半球，读起来是「一堆白色晶体」而不是「切平的白圆柱」。
     高度写死 0.30 cm，只跟固相柱顶走，不参与任何物理量。 */
  const DOME_H = 0.30;
  const solidDome = new THREE.Mesh(
    new THREE.SphereGeometry(SAMPLE_R, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    solidMat
  );
  solidDome.scale.set(1, DOME_H / SAMPLE_R, 1);

  /* 液相弯月面：液面边缘那一圈微微翘起的环 —— 液体和「切平的白圆柱」最直观的区别。
     它只是给液相加一个可辨认的特征，位置永远跟着液面走。 */
  const meniscus = new THREE.Mesh(
    new THREE.TorusGeometry(SAMPLE_R - 0.05, 0.06, 10, 36),
    liquidMat
  );
  meniscus.rotation.x = -Math.PI / 2;

  for (const m of [solidMesh, liquidMesh, liquidTopMesh, mushMesh, solidDome, meniscus]) {
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

  // 温度计刻度：印刷在管壁上（透明底 + 深色刻度与数字）
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
    for (let T = 0; T <= 100; T += SCALE_STEP) {
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
    return SCALE_TEX_H - 6 - (T / 100) * (SCALE_TEX_H - 12);
  }
  /* 刻度网格的竖直跨度（下沿 = 感温泡中心，上沿 = 管顶下 0.6 cm） */
  const SCALE_Y0 = TH_BULB_Y;
  const SCALE_Y1 = TH_BULB_Y + TH_TUBE_H - 1.2;
  /* CanvasTexture 默认 flipY：贴图 v = 1 − y/H。刻度 T 的世界高度由这里唯一给出。
     曾把 STEM_Y0/STEM_Y1 另写成 TH_BULB_Y+0.55 / TH_BULB_Y+TH_TUBE_H−0.6，
     与印刷刻度差了 0.45~0.70 cm（≈4~7 ℃），液柱顶端和数字对不上。 */
  const scaleYOf = (T) => SCALE_Y0 +
    (1 - scaleCanvasY(T) / SCALE_TEX_H) * (SCALE_Y1 - SCALE_Y0);
  const STEM_Y0 = scaleYOf(0);                       // 刻度 0 ℃ 的世界高度
  const STEM_Y1 = scaleYOf(100);                     // 刻度 100 ℃ 的世界高度

  const thermometer = new THREE.Group();
  thermometer.position.set(0.52, 0, 0.28);
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

  /* --- 台面计时器（数码计时器） ---
     位置 (x = 20, z = 12)：铁架台底座只占 x∈[-13,13]、z∈[-8.5,8.5]，所以它完全不压器材。
     这个坐标不是估的 —— 用 screenRectOf() 对 5×4 个候选位置扫过一遍屏幕包围盒重叠率，
     只有 x ≥ 20 这一档能做到「与底座 / 立柱 / 烧杯 / 试管 / 四个舞台浮层全部 0 重叠」，
     且整块落在舞台内（x=14~16 那几档会掉出下边界）。

     朝向：屏幕法线（局部 +z）正对默认相机的方位角、并向后仰 20.7°。
     两个角由「计时器位置 → 默认相机位置」的连线反算，不是手估：
       相机在 (−44.9, 36.4, 73.2)，计时器在 (20, ~2.7, 12)
       ⇒ 视线方向 (−0.680, 0.354, 0.642)
       ⇒ rotation.y = atan2(−0.680, 0.642) = −0.814，rotation.x = −asin(0.354) = −0.362
     屏幕正对相机 ⇒ 数字不被透视压扁（cos α = 1），这是「很好的显示」的前提。

     ★ 读数就是 state.t（仿真时间），不是墙上时钟：
       曲线图的横轴用的也是 state.t，两处必须同源，否则一调倍速就对不上。 */
  const TIMER_POS = { x: 20, z: 12 };
  const TIMER_YAW = -0.814, TIMER_PITCH = -0.362;
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
  // 局部 (lx,ly,lz) 绕 x 转 θ 后世界 y = ly·cosθ + lz·sinθ ⇒ 半高 = (H/2)cosθ + (D/2)sinθ
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
    /* 试管热流：先按温差算，再卡饱和上限。
       上限是「图上两条斜率不一样陡」的唯一来源 —— 没有它，试样又被水浴锁住，
       固态液态一样陡（详见物理参数区的推导）。Math.max/min 对负号同样成立，
       所以凝固方向（q < 0）自动对称，不用另写一份。 */
    let q = K_COUPLE * (state.Tw - state.Tt);
    q = Math.max(-Q_TUBE, Math.min(Q_TUBE, q));
    if (state.substance === 'hypo') {
      const s = sub.hypo;
      if (state.phi > 0 && state.phi < 1) {
        /* 平台：q > 0 吸热熔化（φ 增），q < 0 放热凝固（φ 减）。
           两个方向都把试样温度钉在 s.tm —— 这是「凝固点 = 熔点」在代码里的唯一出处，
           不是两处各写一遍常量（那样两边的数就可能不一致）。 */
        state.phi = clamp(state.phi + q / (M_SAMPLE * s.L) * dt, 0, 1);
        state.Tt = s.tm;
      } else if (state.phi >= 1) {
        state.Tt += q / (M_SAMPLE * s.cl) * dt;
        if (state.Tt <= s.tm) { state.Tt = s.tm; state.phi = 1 - 1e-6; }   // 液态降到熔点 → 开始凝固
      } else {
        state.Tt += q / (M_SAMPLE * s.cs) * dt;
        if (state.Tt >= s.tm) { state.Tt = s.tm; state.phi = 1e-6; }       // 固态升到熔点 → 开始熔化
      }
    } else {
      state.Tt += q / (M_SAMPLE * cEffParaffin(state.Tt)) * dt;
      state.soft = clamp((state.Tt - 44) / 16, 0, 1);
    }

    if (state.direction === 'freeze') {
      /* 冰水浴：冰没化完 → 温度恒为 0 ℃，吸进来的热全部变成化冰的潜热。
         两项都要算：从试样吸走的热（−q，q<0 时为正）+ 从环境漏进来的热。 */
      if (state.iceLeft > 0) {
        state.Tw = T_ICE;
        const inQ = Math.max(0, -q) + Math.max(0, K_LOSS * (AMB - state.Tw));
        state.iceLeft = Math.max(0, state.iceLeft - inQ / L_ICE * dt);
      } else {
        state.Tw += (-q - K_LOSS * (state.Tw - AMB)) / (M_WATER * C_WATER) * dt;
        if (state.Tw > AMB) state.Tw = AMB;
      }
    } else if (state.Tw < TW_MAX) {
      state.Tw += (P_LAMP - q - K_LOSS * (state.Tw - AMB)) / (M_WATER * C_WATER) * dt;
      if (state.Tw > TW_MAX) state.Tw = TW_MAX;
    }

    state.t += dt;
    if (state.direction === 'freeze') { if (state.Tt <= T_STOP_COLD) state.finished = true; }
    else if (state.Tt >= 96) state.finished = true;
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
    state.t = 0; state.finished = false;
    series.length = 0;
    if (state.direction === 'freeze') {
      /* 凝固实验的起点不是室温固态，而是「刚熔化完的液态」——
         学生先在熔化方向把海波化开，再切到这里看它怎么冻回去。
         海波：φ = 1（全液态）；石蜡：soft = 1（全软化），都没有晶格。 */
      state.Tt = FREEZE_T0; state.Tw = T_ICE; state.iceLeft = M_ICE;
      state.phi = state.substance === 'hypo' ? 1 : 0;
      state.soft = state.substance === 'hypo' ? 0 : 1;
    } else {
      state.Tt = AMB; state.Tw = AMB; state.iceLeft = 0;
      state.phi = 0; state.soft = 0;
    }
    pushSample();
  }

  /* ==========================================================================
     四之二、器材组装：散放 → 自下而上装成水浴装置
     ==========================================================================
     教学点：真实实验里这套装置不是现成的，要一层层从下往上搭 ——
     底座立柱 → 酒精灯（先定火焰高度）→ 铁圈 + 石棉网 → 烧杯 + 水
     → 试管夹 + 试管 → 温度计。上面每一层的高度都由下面那一层决定。

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

  /* 唯一写器材位姿的入口。extraY 给「在基准之上再叠一点」用（温度计升降）。
     散放、组装、tween 的每一帧、animateParts 全都走它 ——
     别处再直接写 position 就会和 tween 打架（写回旧值 ⇒ 动画被吃掉）。 */
  function poseNow(o, extraY = 0) {
    const b = basePose(o), p = PART_POSE.get(o), t = p ? (PART_T.get(o) || 0) : 0;
    o.position.set(
      b.pos.x + (p ? p.dx * t : 0),
      b.pos.y + (p ? p.dy * t : 0) + extraY,
      b.pos.z + (p ? p.dz * t : 0)
    );
    if (p) o.rotation.set(b.rot.x + p.rx * t, b.rot.y + p.ry * t, b.rot.z + p.rz * t);
    else o.rotation.copy(b.rot);
  }

  /* 九件散件。steps 只管教学语义与先后，parts 只管画面 —— 两边分开写，
     所以「铁圈 + 石棉网」可以是一个步骤（两件一起装），
     「试管夹 + 试管」也是（夹子先夹住，试管才有地方待）。 */
  const ASM_PARTS = [
    { key: 'stand',  label: '铁架台底座',        objs: [base, baseTop] },
    { key: 'rod',    label: '镀铬立柱',          objs: [rod] },
    { key: 'lamp',   label: '酒精灯',            objs: [lamp, flameGroup, flameLight] },
    { key: 'ring',   label: '铁圈',              objs: [bossRing.sleeve, bossRing.screw, bossRing.arm, ring] },
    { key: 'net',    label: '石棉网',            objs: [netMesh, pad] },
    { key: 'beaker', label: '烧杯 + 水',         objs: [beaker] },
    { key: 'clamp',  label: '试管夹',            objs: [bossClamp.sleeve, bossClamp.screw, bossClamp.arm, clampArm, jaws[0], jaws[1], clampPad] },
    { key: 'tube',   label: '试管 + 试样',       objs: [tube, stir] },
    { key: 'thermo', label: '温度计',            objs: [thermometer] },
    { key: 'arm',    label: '温度计横臂',        objs: [thSupport] }
  ];
  const ASM_STEPS = [
    { key: 'base',   parts: ['stand', 'rod'],
      name: '铁架台底座 + 立柱', hint: '先把最下面的铸铁底座放稳，立柱才立得住 —— 上面所有器材都挂在它上面。' },
    { key: 'lamp',   parts: ['lamp'],
      name: '酒精灯', hint: '放酒精灯。铁圈要照它的火焰高度来定，所以先摆灯、后定圈。' },
    { key: 'ring',   parts: ['ring', 'net'],
      name: '铁圈 + 石棉网', hint: '铁圈套在立柱上，高度让外焰刚好舔到石棉网；石棉网再铺在铁圈上。' },
    { key: 'beaker', parts: ['beaker'],
      name: '烧杯 + 水', hint: '烧杯坐在石棉网上。水面要没过试管里的试样，水浴才能包住它。' },
    { key: 'clamp',  parts: ['clamp', 'tube'],
      name: '试管夹 + 试管', hint: '试管夹从上面夹住试管，让试管浸在水里 —— 不碰杯底、也不碰杯壁。' },
    { key: 'thermo', parts: ['thermo', 'arm'],
      name: '温度计', hint: '最后装温度计：横臂挂在立柱上，感温泡浸在试样里、不碰管壁。' }
  ];

  /* 散放位姿：水平位移 + 绕轴转角。dy 不手填 —— 由「整件器材最低点落到台面」
     反算（见下面 buildScatter），这样以后改了尺寸或转角也不会突然浮起来 / 插进台面。

     ★ dx / dz 是【搜出来的】，不是估的：脚本 melt-asm-autolayout 在 (x, z) 平面上
       扫 2.5 cm 网格，对每件器材挑「屏幕包围盒完整落在舞台内（留 8 px）+
       世界包围盒完整落在台面上（|x|≤96、|z|≤62）+ 与已放好的散件和四个舞台浮层、
       计时器都不重叠（< 0.005）」的落点里离目标槽位最近的那个。
       结果：横向铺开 842 px、纵向 530 px，两两重叠 0、压浮层 0。
       换尺寸 / 换相机参数后【重跑一遍脚本】，别手调这几个数。 */
  const ASM_POSE = {
    stand:  { dx: -22.5, dz: -35,   ry: 0.55 },
    rod:    { dx: 25,    dz: -20,   ry: 0.0, rz: Math.PI / 2 },
    lamp:   { dx: 12.5,  dz: 37.5,  ry: -0.28 },
    ring:   { dx: 35,    dz: 25,    ry: 0.85, rx: Math.PI / 2 },
    net:    { dx: 2.5,   dz: 2.5,   ry: -0.45 },
    beaker: { dx: -40,   dz: 0,     ry: 0.32 },
    clamp:  { dx: -5,    dz: 52.5,  ry: 1.05, rx: Math.PI / 2 },
    tube:   { dx: -37.5, dz: 30,    ry: 0.30, rz: -Math.PI / 2 },
    thermo: { dx: 0,     dz: 50,    ry: 0.22, rz: -Math.PI / 2 },
    arm:    { dx: -55,   dz: 12.5,  ry: 0.70 }
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

  /* ★ 一件器材里可能有多个物体（试管 + 搅拌棒、铁圈 + boss 头、灯 + 火焰）。
     它们必须【作为刚体一起动】：绕同一个支点转，而不是各自绕自己的原点转。
     各自转会把相对位置扯散 —— 实测「试管 + 搅拌棒」被甩开 15 cm，
     整件的投影包围盒从 18 cm 宽涨到 38 cm 宽（一眼假）。 */
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
     台面是平面 ⇒ 这个抬升量只由【转角】决定，跟水平位移无关，
     所以算一次就能缓存：摆位搜索要对同一个零件试上千个 (dx, dz)，
     每次都重量一遍最低点会慢两个数量级。 */
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
      afterAsmChange();
      if (asmQueue.length) {
        const next = asmQueue.shift();
        asmTween = { parts: ASM_STEPS[next].parts.slice(), from: 1, to: 0, k: 0, step: next };
        asmSay('一键组装中：' + ASM_STEPS[next].name, false);
      } else {
        asmSay(tw.to === 0 ? '器材装好了，可以开始加热' : '器材已散放', false);
      }
    }
    dirty = true;
  }

  /* 组装状态一变就要做三件事：灯焰要不要点着、侧栏清单要不要刷新、开始按钮能不能点 */
  function afterAsmChange() {
    state.assembled = assembledCount();
    updateDirectionVisual();
    updateAsmUI();
    updateReadouts();
    /* 装好的那一刻把镜头拉回常规 45° 斜视：组装视角（dist 132、俯角 23°）是为了
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
        : '六件都装好了。这套装置是【自下而上】搭起来的：底座→灯→圈网→烧杯→试管→温度计。');
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
  function gotoAssembleView() {
    Object.assign(view, VIEWS.assemble);
    document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === 'assemble'));
    updateCamera();
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
             写成 updateMatrixWorld(true) 会把整棵子树重算一遍，24 个物体就是 24 遍全场景遍历 ——
             自检要连着调好几轮快照，本机 swap 打满时会被拖成换页风暴。 */
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
    solidDome.visible = isHypo;
    meniscus.visible = isHypo;
    waxMesh.visible = !isHypo;
    waxTop.visible = !isHypo;
  }

  /* 实验方向决定器材形态：熔化 = 酒精灯点着、水浴加热；凝固 = 撤走酒精灯、换上冰水浴。
     画面量（灯在不在、冰在不在）一并记进 state.drawn，供自检直接读 ——
     否则「灯到底撤了没有」只能靠猜，材质和布尔值都可能是装饰。 */
  function updateDirectionVisual() {
    const freeze = state.direction === 'freeze';
    lamp.visible = !freeze;              // 酒精灯连同灯焰、灯焰光源一起撤走
    /* 灯焰只在「整套装置装好之后」才点着 —— 散放在台面上的酒精灯是没点的。
       不这样卡的话，散件状态下一朵火焰飘在半空中，一眼就假。 */
    const lit = !freeze && assemblyReady();
    flameGroup.visible = lit;
    flameLight.visible = lit;
    iceGroup.visible = freeze;
    waterMat.color.set(freeze ? '#a9dff2' : '#8ed3ea');
    state.drawn = state.drawn || {};
    state.drawn.direction = state.direction;
    state.drawn.lampVisible = lamp.visible;
    state.drawn.flameVisible = flameGroup.visible;
    state.drawn.iceVisible = iceGroup.visible;
    requestRender();
  }

  function updateSample() {
    const isHypo = state.substance === 'hypo';
    if (isHypo) {
      const solidH = SAMPLE_H * Math.pow(1 - state.phi, 0.82);
      const liquidH = Math.max(0, SAMPLE_H - solidH);
      const showSolid = solidH > 0.02;

      /* 固相 = 圆柱 + 顶上一个压扁的半球，两者合起来才是 solidH 高 ——
         顶面因此是「一堆白晶体」而不是「切平的白圆柱」，总高度不变。
         固相太薄时（快熔完）退回纯圆柱，免得出现负高度。 */
      const domeOn = showSolid && solidH > DOME_H * 1.6;
      const cylH = domeOn ? solidH - DOME_H : solidH;

      solidMesh.visible = showSolid;
      if (showSolid) {
        solidMesh.scale.set(1, cylH, 1);
        solidMesh.position.set(0, TT_Y0 + 0.12 + cylH / 2, 0);
        solidTex.repeat.set(2.2, Math.max(0.05, cylH * 1.55));
        solidBump.repeat.copy(solidTex.repeat);
      }
      solidDome.visible = domeOn;
      if (domeOn) solidDome.position.set(0, TT_Y0 + 0.12 + solidH - DOME_H, 0);

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
        // 弯月面：液面边缘那圈微微翘起的环，跟着液面一起走
        meniscus.visible = true;
        meniscus.position.set(0, liqBottom + lh - 0.01, 0);
      } else {
        meniscus.visible = false;
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

     ★ 不透明度不是「能看清泡就行」的单一取舍，它同时要满足【两个方向相反的】判据：
       (a) 固态要比液态【亮】够多（用户诉求③：一眼看出白晶体 vs 澄清液体）；
       (b) 透视打开后，泡在液相里要比关着时【更红】够多（透视这个功能本身要有效）。
     泡在 φ=0 时埋进固相、φ=0.5 时落在液相（固相只长到 3.40 cm，泡在 4.00 cm），
     所以 (a) 由 solidMat 定、(b) 由 liquidMat 定，两者可以分开调。
     实测（1440×1000，6 个 16×16 取样块的平均亮度）：
       固相 0.48→155.8  0.72→167.1  1.00→178.8
       液相 0.42→153.9  0.34→150.7  0.26→145.9  0.20→144.0
     取「固 0.72 / 液 0.20」：透视开 Δlum = −23.1（判据 |Δ| > 18）；
     关透视「固 1.0 / 液 0.42」Δlum = −24.9；φ=0.5 处泡偏红 49.2 vs 34.3（判据 > +8）。
     旧值 0.48/0.34 在透视开时 Δlum 只有 −6.6 —— 固液几乎同亮，正是「看不出区别」的来源。 */
  function applyXray() {
    const on = state.xray;
    const setMat = (mat, onOp, offOp) => {
      const op = on ? onOp : offOp;
      const tr = op < 0.999;
      if (mat.opacity !== op) mat.opacity = op;
      if (mat.transparent !== tr) { mat.transparent = tr; mat.needsUpdate = true; }
      if (mat.depthWrite === tr) mat.depthWrite = !tr;
    };
    // 固相：透视开着也要留住「白」，只降到 0.72（还能看见里面淡淡的泡），不降到 0.48
    setMat(solidMat, 0.72, 1.0);
    /* 固液共存带做成「半透的白糊」：白晶体 + 澄清液混在一起本来就是半透的，
       而且它下面压着固相的白顶，透出来才有「冰渣泡在液体里」的层次。 */
    setMat(mushMat, 0.46, 0.74);
    // 液相：熔融海波本来就是澄清液体，压到 0.20 才既像液体、又把亮度让给固相。
    // 不透视时留 0.42（比透视时更实）—— 方向与固相一致：透视开 ⇒ 整体更透。
    liquidMat.opacity = on ? 0.20 : 0.42;
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

  /* 曲线图与「手动描点」共用【同一套】坐标映射。
     两处各算一遍的话，描点层和真值曲线会各自落在不同的横轴上 ——
     看着都「画出来了」，其实错位，而单看任一层的断言都发现不了。 */
  function chartGeom() {
    const W = chartCanvas.clientWidth || 640;
    const H = chartCanvas.clientHeight || 232;
    const padL = 42, padR = 16, padT = 14, padB = 26;
    const pw = W - padL - padR, ph = H - padT - padB;
    // 凝固过程只有 60 s 左右，用 300 s 的横轴会把整条曲线挤在左边一小段里
    const tFloor = state.direction === 'freeze' ? 120 : 300;
    const tMax = Math.max(tFloor, Math.ceil((state.t + 20) / 60) * 60);
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

  /* 学生描的点 = 他自己按「记录数据」记下的那几组 (t, 试样温度)。
     ★ 只取【当前实验方向】的记录：熔化方向记的点拿去和凝固的真值曲线比，
       会凭空出现几十摄氏度的「偏差」—— 那不是误差，是拿错了曲线。
     直接取自 state.records，不另存一份，否则「表里 5 条、图上 6 个点」查不出来。 */
  function plotDots() {
    const G = chartGeom();
    return state.records
      .filter((r) => r.direction === state.direction)
      .map((r) => ({ t: r.t, T: r.Tt, x: G.X(r.t), y: G.Y(r.Tt) }));
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
    state.drawn.chartTMax = tMax;      // 供自检直接读：凝固方向的横轴不该按熔化那 300 s 走

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

    /* --- 手动描点层：学生自己记下的点、自己连的折线、与真值曲线的偏差 ---
       画在真值曲线【之后】才不会被曲线盖住；用紫红色，和橙色真值曲线一眼分得开。 */
    const PS = plotStats();
    if (toggles.plot && PS.n) {
      if (series.length > 1) {
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
      const freezing = state.direction === 'freeze';
      microText.textContent = frac <= 0.001
        ? (freezing ? '分子已全部排回晶格，凝固完成（固态）' : '分子规则排列在晶格上，只在小范围振动')
        : frac >= 0.999
          ? (freezing ? '分子在液态里自由移动，温度正在下降' : '晶格全部瓦解，分子可以自由移动（液态）')
          : (freezing
            ? `晶格正在重建（已凝固 ${((1 - frac) * 100).toFixed(0)}%）：分子排进晶格要放出热量，放出的热正好补住散失的热 → 温度不变`
            : `晶格正在瓦解（${(frac * 100).toFixed(0)}%），但温度不变 → 分子平均动能不变`);
    } else {
      microText.textContent = frac <= 0.02
        ? '分子排列不规则，靠得很紧，只能在原位振动'
        : `分子逐渐松开（${(frac * 100).toFixed(0)}%），越软越容易移动，但始终没有晶格`;
    }
  }

  /* ==========================================================================
     七之二、放大镜：把感温泡附近的刻度放大来读
     ========================================================================== */
  /* 为什么必须有它：温度计分度值是 1 ℃，而模型上 1 ℃ ≈ 1.04 mm。
     整机视角下整支温度计只有 300 来 px、11.5 cm ⇒ 约 26 px/cm ⇒ 1 ℃ 只有 2.7 px，
     相邻两条刻度在屏幕上直接糊成一条灰带 —— 3D 里本来就读不出来。

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
    const Tc = state.Tt;
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

  /* ==========================================================================
     八、界面刷新
     ========================================================================== */
  const els = {
    sample: $('metricSample'), bath: $('metricBath'), state: $('metricState'),
    time: $('metricTime'), melt: $('metricMelt'),
    bathLabel: $('metricBathLabel'), meltLabel: $('metricMeltLabel'), timeLabel: $('metricTimeLabel'),
    hudSample: $('hudSample'), hudBath: $('hudBath'), hudTimer: $('hudTimer'),
    finding: $('finding'),
    stateDot: $('stateDot'), stateChip: $('stateChip'), stateNote: $('stateNote'),
    timerCard: $('recTimerCard'), timerMMSS: $('timerMMSS'), timerState: $('timerState'), timerNext: $('timerNext'),
    recordBtn: $('recordBtn'),
    runBtn: $('runBtn'), pauseBtn: $('pauseBtn'), resetBtn: $('resetBtn')
  };

  /* 舞台左上角的状态灯：白＝固态晶体 / 橙＝固液共存 / 青＝澄清液体。
     和侧栏「状态」指标卡读同一份 state（meltFraction + direction），不另存一份 ——
     否则「画面写着固液共存、侧栏写着熔化中」这种自相矛盾查不出来。 */
  function sampleStateChip() {
    const f = meltFraction();
    const freeze = state.direction === 'freeze';
    if (state.substance === 'hypo') {
      if (f <= 0.001) return { text: '固态', note: '白色晶体', color: '#ffffff' };
      if (f >= 0.999) return { text: '液态', note: '澄清液体', color: '#7dd3fc' };
      return { text: '固液共存', note: '白晶体 + 澄清液', color: '#fdba74' };
    }
    if (f <= 0.02) return { text: '固态', note: '乳白蜡质', color: '#ffffff' };
    if (f >= 0.985) return { text: '液态', note: '澄清液体', color: '#7dd3fc' };
    return { text: freeze ? '变硬中' : '软化中', note: '没有固定熔点', color: '#fdba74' };
  }

  function statusText() {
    const s = sub[state.substance];
    const freeze = state.direction === 'freeze';
    if (state.substance === 'hypo') {
      if (state.phi <= 0.001) return freeze ? '固态 · 降温中' : (state.Tt < s.tm ? '固态 · 升温中' : '即将熔化');
      if (state.phi >= 0.999) return freeze ? '液态 · 降温中' : '液态 · 升温中';
      return freeze ? '固液共存 · 正在凝固' : '固液共存 · 正在熔化';
    }
    if (state.soft <= 0.02) return freeze ? '已凝固成固态' : '固态 · 升温中';
    if (state.soft >= 0.985) return freeze ? '液态 · 降温中' : '已熔化成液态';
    return freeze ? '逐渐变硬 · 无固定凝固点' : '逐渐变软 · 无固定熔点';
  }

  /* 右侧窄表格里的短状态，四个字以内才排得下一行。
     ★ 晶体在熔化 / 凝固过程中，课本用的词是【固液共存】——
       这里不能按方向拆成「熔化中 / 凝固中」：那两种叫法都漏掉了
       「固态和液态同时存在」这个关键事实，而它正是平台期温度不变的原因。 */
  function shortState() {
    const f = meltFraction();
    const freeze = state.direction === 'freeze';
    if (state.substance === 'hypo') {
      if (f <= 0.001) return '固态';
      if (f >= 0.999) return '液态';
      return '固液共存';
    }
    if (f <= 0.02) return '固态';
    if (f >= 0.985) return '液态';
    return freeze ? '变硬中' : '软化中';
  }

  function updateReadouts() {
    const s = sub[state.substance];
    const frac = meltFraction();
    const freeze = state.direction === 'freeze';
    els.sample.textContent = `${state.Tt.toFixed(1)} ℃`;
    els.bath.textContent = `${state.Tw.toFixed(1)} ℃`;
    els.state.textContent = statusText();
    els.time.textContent = `${state.t.toFixed(0)} s`;
    els.melt.textContent = `${(frac * 100).toFixed(0)}%`;
    els.hudSample.textContent = state.Tt.toFixed(1);
    els.hudBath.textContent = state.Tw.toFixed(1);

    const chip = sampleStateChip();
    if (els.stateDot) {
      els.stateDot.style.background = chip.color;
      els.stateDot.style.boxShadow = `0 0 0 3px ${chip.color}22`;
    }
    if (els.stateChip) els.stateChip.textContent = chip.text;
    if (els.stateNote) els.stateNote.textContent = chip.note;

    /* 计时器：三处（3D 屏幕 / 侧栏卡片 / 舞台 HUD）同源读 state.t。
       侧栏「距下次记录」与 3D 屏幕上的秒数也走同一份计算 —— 只要有一处对不上，
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

    if (els.meltLabel) els.meltLabel.textContent = freeze ? '凝固 / 变硬程度' : '熔化 / 软化程度';
    if (els.bathLabel) els.bathLabel.textContent = freeze ? '冰水浴温度' : '水浴温度';
    if (els.timeLabel) els.timeLabel.textContent = freeze ? '冷却时间' : '加热时间';

    let hint;
    if (state.substance === 'hypo') {
      if (freeze) {
        if (state.phi >= 0.999) {
          hint = `冰水浴正在把热量吸走：液态海波从 ${FREEZE_T0} ℃ 开始下降。留意它会不会一路降下去 —— 上一轮加热时它在 48 ℃ 停过一次。`;
        } else if (state.phi > 0.001) {
          hint = `固液共存：温度又一次钉在 ${s.tm} ℃ 不动了，而冰水浴还在不断吸热。这段时间放出的热量用来让分子重新排回晶格 —— 凝固过程要持续放热，温度才保持不变。`;
        } else {
          hint = `已全部凝固：变成固态后温度又开始下降。凝固时那个不变的 ${s.tm} ℃ 就是海波的凝固点 —— 和它的熔点一模一样。`;
        }
      } else if (state.phi <= 0.001) {
        hint = `加热中：海波是晶体，温度升到 ${s.tm} ℃ 之前一直是固态。留意水浴温度比试样高多少 —— 水浴法让它升得慢、受热匀。`;
      } else if (state.phi < 0.999) {
        hint = `固液共存：温度死死钉在 ${s.tm} ℃，而水浴已经升到 ${state.Tw.toFixed(1)} ℃。这段时间吸收的热量全部用来破坏晶格，温度不变 —— 这就是晶体有固定熔点的原因。`;
      } else {
        hint = `已全部熔化：变成液态后温度又开始上升，但比固态时升得慢 —— 液态海波的比热容更大。整个熔化过程中，温度 ${s.tm} ℃ 始终没变。现在把「实验方向」切到凝固，看它怎么冻回去。`;
      }
    } else if (freeze) {
      if (state.soft >= 0.985) {
        hint = '冰水浴降温中：石蜡从液态开始变凉。它同样没有固定的凝固温度，留意温度会不会像海波那样停住。';
      } else if (state.soft > 0.02) {
        hint = '正在变硬：石蜡越来越稠、越来越硬，但温度一直在下降，曲线只是拐弯，始终没有平台 —— 非晶体也没有固定的凝固点。';
      } else {
        hint = '已完全凝固：整条降温曲线从头到尾都在下降，从来没有出现过水平平台。';
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
    updateDirectionVisual();
    applySubstanceVisual();
    updateSample();
    drawChart();
    drawMicro(dt || 0.016);
    updateReadouts();
    syncPlotUI();          // 切方向 / 重置之后，描点与按钮状态跟着刷新（此刻 drawChart 已跑完）
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
    // 火焰摇曳（凝固方向酒精灯已撤走，整组不画，也就没必要再算摇曳）
    const wob = Math.sin(clock * 7.3) * 0.5 + Math.sin(clock * 11.7 + 1.3) * 0.3 + Math.sin(clock * 3.1) * 0.2;
    const wob2 = Math.sin(clock * 9.1 + 0.7);
    if (flameGroup.visible) {
      flameWob.scale.set(1 + wob * 0.055, 1 + wob2 * 0.045, 1 + wob * 0.05);
      flameWob.position.x = wob * 0.11;
      flameWob.rotation.z = wob * 0.035;
      flameLight.intensity = 3.2 + wob * 0.5;
    }

    // 碎冰随水轻轻起伏、慢慢转（凝固方向才有）
    if (iceGroup.visible) {
      for (const m of ices) {
        const u = m.userData;
        u.ph += dt * 0.9;
        m.position.y = u.y0 + Math.sin(u.ph) * 0.045;
        m.rotation.y += u.spin * dt;
      }
    }

    // 温度计插入 / 拔出：指数平滑跟随目标，动作看得见（支架横臂与细线一起上下滑）
    state.thAnim += (state.thDepth - state.thAnim) * Math.min(1, dt * 3.6);
    if (Math.abs(state.thDepth - state.thAnim) < 0.002) state.thAnim = state.thDepth;
    const thLift = (1 - state.thAnim) * TH_LIFT;
    /* ★ 不能直接写 .position.y = thLift —— 散放时温度计在台面上躺着，
       直接赋值会把它瞬间拽回原位，组装动画被吃掉。
       poseNow(o, extraY) 才是唯一入口：基准 + 散放增量 + 这一帧的抬升。 */
    poseNow(thermometer, thLift);
    poseNow(thSupport, thLift);
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

  /* --- 器材组装：清单逐条点、一键组装、重新散放 --- */
  document.querySelectorAll('[data-asm]').forEach((li) => {
    li.addEventListener('click', () => { assembleStep(Number(li.dataset.asm)); updateAsmUI(); });
  });
  const asmAutoBtn = $('asmAuto'), asmScatterBtn = $('asmScatter');
  if (asmAutoBtn) asmAutoBtn.addEventListener('click', () => { autoAssemble(); updateAsmUI(); });
  if (asmScatterBtn) asmScatterBtn.addEventListener('click', () => { scatterAll(); updateAsmUI(); });
  /* 页面初始是散放状态 ⇒ 直接用组装视角取景：默认 45° 斜视（dist 87）框不下摊开的一桌器材 */
  if (!assemblyReady()) gotoAssembleView();

  /* --- 物质 --- */
  document.querySelectorAll('[data-substance]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.substance = btn.dataset.substance;
      document.querySelectorAll('[data-substance]').forEach((b) => b.classList.toggle('active', b === btn));
      resetSim();
      refreshAll();
    });
  });

  /* --- 实验方向：熔化（水浴加热）/ 凝固（冰水浴冷却） ---
     同一台仪器、同一套热平衡方程，只是把热流方向反过来 ——
     所以两个方向的平台温度必然相同，这正是「凝固点 = 熔点」的证据。 */
  function setDirection(k) {
    state.direction = k;
    document.querySelectorAll('[data-direction]').forEach((b) => b.classList.toggle('active', b.dataset.direction === k));
    resetSim();
    setRunning(false);          // 停表 + 按钮文案跟着方向换（「开始加热」/「开始冷却」）
    refreshAll();
  }
  document.querySelectorAll('[data-direction]').forEach((btn) => {
    btn.addEventListener('click', () => setDirection(btn.dataset.direction));
  });

  /* --- 运行控制 --- */
  function setRunning(v) {
    state.running = v;
    /* 没装好就不给点「开始加热」—— 门禁与侧栏清单读同一份状态（assemblyReady），
       不另存一个布尔，免得清单说装好了、按钮还点不动。 */
    els.runBtn.disabled = v || !assemblyReady();
    els.pauseBtn.disabled = !v;
    const verb = state.direction === 'freeze' ? '冷却' : '加热';
    els.runBtn.textContent = state.t > 0 ? `继续${verb}` : `开始${verb}`;
    els.pauseBtn.textContent = '暂停';
  }
  els.runBtn.addEventListener('click', () => {
    if (!assemblyReady()) {
      asmSay('还没装好器材：按 ①→⑥ 的顺序装，或者点「一键自动组装」', true);
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
  /* --- 放大镜开关（舞台浮层 + 侧栏按钮状态一起切） --- */
  const loupeBtn = $('toggleLoupe'), loupeInset = $('loupeInset');
  function setLoupe(v) {
    toggles.loupe = !!v;
    if (loupeInset) loupeInset.hidden = !toggles.loupe;
    if (loupeBtn) {
      loupeBtn.classList.toggle('active', toggles.loupe);
      loupeBtn.setAttribute('aria-pressed', String(toggles.loupe));
    }
    if (toggles.loupe) drawLoupe();
    requestRender();
  }
  if (loupeBtn) loupeBtn.addEventListener('click', () => setLoupe(!toggles.loupe));

  /* ==========================================================================
     十一、步骤与记录
     ========================================================================== */
  const STEPS = [
    { name: '01 认识器材', text: '<strong>认识器材：</strong>铁架台的铸铁底座上立着镀铬立柱，铁圈托住<b>石棉网</b>，烧杯放在石棉网上，试管用铁夹夹住、浸在烧杯的水里，温度计插在试管中。下方是点燃的酒精灯。' },
    { name: '02 水浴加热', text: '<strong>为什么要把试管泡在水里：</strong>火焰直接加热试管，受热不均匀、温度升得太快，来不及记录。用水浴加热，试管里的物质受热<b>均匀</b>、升温<b>缓慢</b>，而且最高只会接近 100 ℃，安全又便于观察。' },
    { name: '03 海波熔化', text: '<strong>找熔点：</strong>选海波开始加热。温度升到 <b>48 ℃</b> 时注意看 —— 温度计的液柱停住了，但酒精灯还在烧，物质还在吸热。这个不变的温度就是海波的<b>熔点</b>。' },
    { name: '04 石蜡对照', text: '<strong>换石蜡：</strong>换成石蜡重新加热。石蜡没有固定熔点：它先变软、再变稀，温度<b>一直在升高</b>，曲线只有“拐弯”，没有平台。这就是晶体和非晶体最本质的区别。' },
    { name: '05 海波凝固', text: '<strong>反过来做一次：</strong>把「实验方向」切到<b>凝固</b> —— 酒精灯撤走、烧杯里的热水换成<b>冰水</b>。液态海波从 65 ℃ 开始降温，降到 <b>48 ℃</b> 时温度又停住了：这次它<b>继续放热</b>（把热量交给冰水），温度却保持不变，直到全部凝固成固态，温度才接着下降。' },
    { name: '06 凝固点=熔点', text: '<strong>把两张图叠起来看：</strong>熔化时的平台和凝固时的平台都在 <b>48 ℃</b>。同一种晶体，<b>凝固点等于熔点</b> —— 温度降下来到 48 ℃ 才开始凝固，升上去到 48 ℃ 才开始熔化，同一个温度。在右侧「③ 记录数据」里两个方向各记三组，表格会替你算出两个平台到底差多少。' },
    { name: '07 记录归纳', text: '<strong>记录归纳：</strong>把海波“开始熔化 / 熔化一半 / 刚好熔化完”三个时刻记下来，你会发现三个温度都是 48 ℃；凝固方向再记三组，凝固平台同样是 48 ℃。最后记录石蜡同一阶段的温度，结论就出来了。' },
    { name: '08 描点画图', text: '<strong>自己画一遍图：</strong>真实的实验报告里，图是自己<b>描点</b>画出来的，不是电脑替你画的。点右侧「③ 记录数据」里的<b>「描点画图」</b>，你刚才记下的每一组数据都会变成图上的一个<b>紫点</b>；再点<b>「连成折线」</b>，用直线把这些点依次连起来 —— 这就是手工描点得到的图像。把它和橙色的真值曲线叠在一起比：折线的拐弯处和曲线对得上吗？点记得太稀，就会把 <b>48 ℃ 的平台</b>连成一条斜线，看不出“温度不变”。所以实验时要在<b>温度快变化的地方多记几组</b>。' }
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
      summary.textContent = '建议记录：海波的“开始熔化 / 熔化一半 / 刚好熔化完”三个时刻，看温度是否相同。';
      recSum.textContent = '点上面的按钮开始记录。';
      return;
    }
    recordBody.innerHTML = state.records.map((r) => `
      <tr>
        <td>${r.substance}${r.direction === 'freeze' ? ' · 凝固' : ''}</td><td>${r.t.toFixed(0)} s</td><td>${r.Tt.toFixed(1)} ℃</td>
        <td>${r.Tw.toFixed(1)} ℃</td><td>${r.state}</td><td>${(r.frac * 100).toFixed(0)}%</td>
      </tr>`).join('');
    recordBodySide.innerHTML = state.records.map((r, i) => `
      <tr class="${r.crystal ? 'crystal' : 'wax'}">
        <td>${i + 1}</td><td>${r.t.toFixed(0)} s</td>
        <td>${r.Tt.toFixed(1)} ℃</td><td>${r.short}</td>
      </tr>`).join('');

    /* 平台期记录按【方向】分开统计 —— 熔化一个平台、凝固一个平台，
       两边都记够两组时直接给出「两个平台相等」的结论（凝固点 = 熔点）。 */
    const plateauOf = (dir) => state.records.filter((r) => r.crystal && r.direction === dir && r.frac > 0.01 && r.frac < 0.99);
    const meltP = plateauOf('melt'), freezP = plateauOf('freeze');
    const meanOf = (rs) => rs.reduce((a, r) => a + r.Tt, 0) / rs.length;
    const spreadOf = (rs) => Math.max(...rs.map((r) => r.Tt)) - Math.min(...rs.map((r) => r.Tt));
    let text;
    if (meltP.length >= 2 && freezP.length >= 2) {
      const a = meanOf(meltP), b = meanOf(freezP);
      text = `熔化平台 ${a.toFixed(1)} ℃、凝固平台 ${b.toFixed(1)} ℃，两者相差 ${Math.abs(a - b).toFixed(1)} ℃ —— 海波的凝固点就是它的熔点。`;
    } else if (freezP.length >= 2) {
      text = `凝固过程的 ${freezP.length} 次记录中，试样温度最大只差 ${spreadOf(freezP).toFixed(1)} ℃ —— 晶体凝固时温度同样不变。切回熔化方向再记几组，就能比较两个平台是否相等。`;
    } else if (meltP.length >= 2) {
      text = `熔化过程的 ${meltP.length} 次记录中，试样温度最大只差 ${spreadOf(meltP).toFixed(1)} ℃ —— 晶体熔化时温度确实不变。切到凝固方向再记几组，看凝固平台是不是同一个温度。`;
    } else {
      const paras = state.records.filter((r) => !r.crystal);
      if (paras.length >= 2) {
        const ts = paras.map((r) => r.Tt);
        text = `石蜡的 ${paras.length} 次记录温度从 ${Math.min(...ts).toFixed(1)} ℃ 一直变到 ${Math.max(...ts).toFixed(1)} ℃，始终没有停下来。`;
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
      direction: state.direction,
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
    drawChart();          // 记录一变，描点也要立刻跟着变（无头环境没有 rAF）
    syncPlotUI();
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
    const D = state.drawn || {};
    const n = (D.plotDots || []).length;
    if (btnOn) {
      btnOn.classList.toggle('active', !!toggles.plot);
      btnOn.setAttribute('aria-pressed', toggles.plot ? 'true' : 'false');
      btnOn.textContent = toggles.plot ? '收起描点　只看真值曲线' : '描点画图　把记录点标到图上';
    }
    if (btnLink) {
      btnLink.disabled = !toggles.plot || n < 2;
      btnLink.classList.toggle('active', !!(toggles.plotLink && toggles.plot));
      btnLink.textContent = (toggles.plotLink && toggles.plot)
        ? '取消连线'
        : `连成折线（${n} 点 → ${Math.max(0, n - 1)} 段）`;
    }
    if (hint) {
      hint.textContent = toggles.plot
        ? '紫点 = 你自己记下的（时刻，温度）；紫虚线 = 你连的折线；细虚线 = 每个描点离真值曲线差多少。'
        : '先点几下「记录数据」，再打开描点 —— 你自己记下的点会变成图上的紫点。';
    }
    if (sum) {
      const other = state.records.length - n;
      const tail = other > 0 ? `（另有 ${other} 条记录属于另一个实验方向，切回去才能看到它们的描点。）` : '';
      if (!toggles.plot) {
        sum.textContent = '点「描点画图」把表格里的记录标到图上，再自己连成折线，和真值曲线比一比。';
      } else if (n === 0) {
        sum.textContent = `当前方向还没有记录 —— 先加热（或冷却）、点「记录数据」。${tail}`;
      } else {
        const devTxt = isFinite(D.plotDevMax)
          ? `与真值曲线最大相差 ${D.plotDevMax.toFixed(2)} ℃（平均 ${D.plotDevMean.toFixed(2)} ℃）`
          : '真值曲线还没有第二个采样点，暂时算不出偏差';
        const segTxt = D.plotSegs
          ? `你连的折线共 ${D.plotSegs} 段，叠在真值曲线上 —— 折线是「点连出来的」，真值曲线是连续算出来的。`
          : '再点「连成折线」，把点连起来和真值曲线比一比。';
        sum.textContent = `当前方向描了 ${n} 个点；${devTxt}。${segTxt}${tail}`;
      }
    }
  }

  /* 两个开关都【同步】重画曲线图：requestRender 只置脏，
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
  const plotToggleBtn = $('plotToggle'), plotLinkBtn = $('plotLink');
  if (plotToggleBtn) plotToggleBtn.addEventListener('click', () => setPlotMode(!toggles.plot));
  if (plotLinkBtn) plotLinkBtn.addEventListener('click', () => setPlotLink(!toggles.plotLink));
  syncPlotUI();

  /* ==========================================================================
     十二、启动
     ========================================================================== */
  canvas.style.cursor = 'grab';
  applySubstanceVisual();
  updateDirectionVisual();
  resetSim();
  updateSample();
  updateReadouts();
  drawChart();
  drawMicro(0.016);
  updateCamera();
  resize();
  updateAsmUI();          // 初始：清单 0/6、开始按钮锁住、提示「先装器材」

  /* 单帧推进。真实 rAF 循环与验收用的驱动钩子走【同一段】代码 ——
     无头沙箱里 requestAnimationFrame 可能一帧都不触发，
     若验收自己另抄一遍推进逻辑，改坏这里照样全绿。 */
  let uiAcc = 0;
  function frameStep(dt) {
    if (asmTween) advanceAsm(dt);      // 组装动画与真实循环共用这一处推进
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
      syncPlotUI();        // 描点的偏差随仿真推进实时更新
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
  window.__meltLab = {
    state, view, VIEWS, SUBSTANCES, toggles, series,
    camera, renderer, scene,
    thermometer, thSupport, thermometerX: TH_X, thScale, mercury, updateCamera,
    thBulbY: TH_BULB_Y, thLiftMax: TH_LIFT, thTubeH: TH_TUBE_H,
    stemY0: STEM_Y0, stemY1: STEM_Y1,
    scaleU0, scaleU1, scaleYOf, scaleCanvasY, scaleTexH: SCALE_TEX_H, scaleFaceDeg: SCALE_FACE_DEG,
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
    /* 无头环境没有 rAF：按固定步长喂帧，走的是与真实循环同一个 frameStep。
       指数平滑（温度计升降等）与逐帧动画靠它才能被确定性地推到稳态。 */
    driveAnim(seconds, dt = 1 / 60) {
      const n = Math.max(1, Math.round(seconds / dt));
      for (let i = 0; i < n; i++) frameStep(dt);
      renderer.render(scene, camera);
      return {
        frames: n, thDepth: state.thDepth, thAnim: state.thAnim,
        thLift: thermometer.position.y, supportY: thSupport.position.y
      };
    },
    statusText, meltFraction, shortState, sampleStateChip, renderRecords, clearRecords, setDirection,
    /* 手动描点：映射、取点、统计、开关，全部从这几个入口走 ——
       自检不自己重抄一遍 X/Y，也不靠数画布上的紫点。 */
    chartGeom, truthAt, plotDots, plotStats, setPlotMode, setPlotLink, syncPlotUI,
    plotDrawn() {
      const D = state.drawn || {};
      return {
        mode: !!D.plotMode, linked: !!D.plotLinked, segs: D.plotSegs || 0,
        dots: (D.plotDots || []).map((d) => ({ t: d.t, T: d.T, x: d.x, y: d.y })),
        devMax: D.plotDevMax, devMean: D.plotDevMean
      };
    },
    /* 凝固方向的常量与画面量，供自检直接读（别在脚本里重抄一遍常量） */
    freezeT0: FREEZE_T0, tIce: T_ICE, mIce: M_ICE, lIce: L_ICE, tStopCold: T_STOP_COLD,
    /* 图像横轴上限：由 drawChart 每次重画时写入，切方向必须跟着变 */
    chartTMax() { return (state.drawn && state.drawn.chartTMax) || NaN; },
    lamp, flameGroup, flameLight, flameWob, iceGroup, ices,
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
      /* 世界位姿快照。useBase=true 给的是【基准】（= 升级前原样），
         另一个给的是当前实际位姿 —— 两者逐位相等才说明「组装没把摆位挪掉」。 */
      snapshot(useBase) { return poseSnapshot(!!useBase); },
      /* ★ 导出的入口必须与「点清单 / 点按钮」【同一条路径】。
         assembleStep / autoAssemble / scatterAll 内部只调 asmSay() 写两个模块变量，
         真正的刷新（提示文案、.bad 标红、清单 done/next 高亮）发生在【点击处理里】的
         updateAsmUI()。直接调导出函数就会看到【陈旧侧栏】——「拒绝乱序」的提示一个字都不显示，
         于是「画面没变」会被误读成「功能没生效」（实测：出图脚本直接调 asm.assembleStep(4)，
         前后两张截图 md5 完全相同）。
         这里补一层刷新，让探针绕过 DOM 也拿到与用户所见一致的结果。
         finishAll 不用包 —— 它内部走 afterAsmChange()，本来就会刷新。 */
      assembleStep: (i, force) => { const r = assembleStep(i, force); updateAsmUI(); return r; },
      autoAssemble: () => { const r = autoAssemble(); updateAsmUI(); return r; },
      scatterAll: () => { const r = scatterAll(); updateAsmUI(); return r; },
      finishAll,
      view: () => ({ ...VIEWS.assemble }),
      gotoView: gotoAssembleView
    },
    base, beaker, tube, netMesh, stand, stir,
    /* 温度计刻度与放大镜 —— 供自检「从贴图像素数刻度条数」「红线与真值同源」用。
       ★ 数刻度必须数【贴图像素】，不能读 SCALE_STEP 常量：
         把步长从 1 改回 2 时，常量照样写着 1，只有像素会变。
       （scaleYOf / stemY0 / stemY1 / scaleTexH 上面已经导出过，这里不重复。） */
    scaleTickCount: countScaleTicks,
    scaleTexW: SCALE_TEX_W, scaleStep: SCALE_STEP,
    loupe: {
      span: LOUPE_SPAN,
      readout: () => (loupeRead ? loupeRead.textContent : ''),
      drawn: () => ({ T: loupeDrawn.T, redY: loupeDrawn.redY, ticks: loupeDrawn.ticks.map((t) => Object.assign({}, t)) }),
      /* 把红线换算回温度：拿【实际画出去的两条相邻刻度】线性插值。
         这里【不引用 state.Tt】—— 否则「红线画错温度」就成了自指恒等式，永远查不出来。 */
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
    setLoupe,
    /* 试样外观：固相顶上的晶堆半球 + 液相弯月面（供像素/几何断言直接读，不靠数像素猜） */
    solidDome, meniscus, domeH: DOME_H,
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
