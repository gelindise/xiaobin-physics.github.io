import * as THREE from './assets/optics-three.min.js';

/* ============================================================================
   电子流动与电阻 —— 电流、电压、电阻的微观立体模型
   ---------------------------------------------------------------------------
   需求来源：B 站《直观理解 | 电流、电压、电阻》(BV1AX4y187qS) 的电子流动模型。
   视频里的三个视觉要素，本页逐条复刻并做成可交互的三维场景：
     · 红色小球 = 自由电子（沿导线定向移动）
     · 金黄扁带 = 导线；锯齿段 = 电阻
     · 绿色箭头 = 电源对电子的作用力；紫色双箭头 = 电压
   三句话讲清"怎么让电流变大"：
     ① 增大电压 U  → 电子跑得更快；
     ② 减小电阻 R  → 锯齿变小变平缓，电子跑得更快；
     ③ 两个电阻并联 → 电子多出一条路，干路电流变成原来的 2 倍；
       两个电阻串联 → 相当于一个阻值是 2R 的电阻，锯齿更密、电子更慢。

   ★★ 物理只有一个出处（本文件"一、物理模型"那一节）：
        resistorTotal / totalCurrent / branchCurrent / visualSpeed / powerOf。
        读数、HUD、指标卡、图像、自检全部调它们 —— 别处不许再抄一遍公式。
   ★★ 电子速度用的是【电流的宏观图像】：导线里自由电子的【线密度】处处相同，
        电流大 ⇔ 电子跑得快（I ∝ v）。并联时每条支路的电流是干路的一半 ⇒
        支路电子速度是干路的一半，而两条支路合起来正好是干路的流量。
        自检里"密度不变、速度∝局部电流"这条不变量就是守着它的。

   世界坐标：x 向右、y 向上、z 朝向观察者；单位≈厘米。
   回路是一个立在 xOy 平面里的梯形：左竖边是电源、右上斜边是电阻、上下是导线。
   ========================================================================== */

(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const isNum = (v) => typeof v === 'number' && isFinite(v);

  /* ==========================================================================
     一、物理模型（全页唯一真值源）
     --------------------------------------------------------------------------
     U 是电源电压（V），R 是【每一只】电阻的阻值（Ω）。
     接法决定总电阻：单个 = R；串联 = 2R；并联 = R/2。
     ========================================================================== */
  const U_MIN = 1.5, U_MAX = 9.0, U_DEF = 6.0, U_STEP = 0.5;
  const R_MIN = 5, R_MAX = 20, R_DEF = 10;
  const MODES = ['single', 'series', 'parallel'];
  const MODE_LABEL = { single: '一个电阻', series: '两个串联', parallel: '两个并联' };

  /** 该接法下的总电阻（Ω） */
  function resistorTotal(mode, R) {
    if (mode === 'series') return 2 * R;
    if (mode === 'parallel') return R / 2;
    return R;
  }
  /** 干路电流（A）—— 欧姆定律 I = U / R总 */
  function totalCurrent(U, mode, R) { return U / resistorTotal(mode, R); }
  /** 电阻段里的支路电流（A）：并联时每条支路只分到干路的一半 */
  function branchCurrent(U, mode, R) {
    return mode === 'parallel' ? U / R : U / resistorTotal(mode, R);
  }
  /** 电功率 P = UI（W） */
  function powerOf(U, mode, R) { return U * totalCurrent(U, mode, R); }
  /** 电功 W = UIt（J），t 由调用方给（秒） */
  function workOf(U, mode, R, t) { return powerOf(U, mode, R) * t; }

  /* 视觉速度：电子沿线速度 ∝ 电流。线性映射是【教学本体】——
     "电流变成 2 倍，电子就跑快 2 倍"必须肉眼可辨，所以不许用对数/开方压缩。
     只有极端档（并联 + 最大电压 + 最小电阻）会顶到上限，那时电子已糊成一条流。 */
  const SPEED_K = 60;
  const V_VIS_MIN = 1.5, V_VIS_MAX = 220;
  function visualSpeed(I) { return clamp(SPEED_K * I, V_VIS_MIN, V_VIS_MAX); }

  /* ==========================================================================
     二、DOM 小工具（带缓存，避免每帧重复写）
     ========================================================================== */
  const _last = new WeakMap();
  function setText(el, s) {
    if (!el) return;
    const v = String(s);
    if (_last.get(el) === v) return;
    _last.set(el, v);
    el.textContent = v;
  }
  function setClass(el, name, on) {
    if (!el) return;
    const key = 'c:' + name;
    if (_last.get(el) === key + on) return;
    _last.set(el, key + on);
    el.classList.toggle(name, !!on);
  }
  function setWidth(el, w) {
    if (!el) return;
    const v = w.toFixed(2) + '%';
    if (_last.get(el) === v) return;
    _last.set(el, v);
    el.style.width = v;
  }
  function setDisabled(el, on) {
    if (!el) return;
    if (_last.get(el) === 'd' + on) return;
    _last.set(el, 'd' + on);
    el.disabled = !!on;
  }
  const fmt = (x, n) => (isNum(x) ? x.toFixed(n) : '—');

  /* ==========================================================================
     三、世界常量与布局
     --------------------------------------------------------------------------
     ★★ 两条空间约定（照参考视频）：
     ① 【高度 = 电势】。低轨 y=0 是低电势（0 V），高台 y=H 是高电势（U），H 由电压 U 决定。
     ② 【回路是有纵深的立体跑道】。低轨在前（z=+ZF），高台在后（z=−ZB）：
        电子在前方低轨上走 → 左端被【电源整体抬升 H】（电池本身就有 H 那么高）
        → 到一个【平台】上、并顺着平台【往里走】（z 从 +ZF 到 −ZB）
        → 沿后方高台向右 → 从右侧【锯齿坡】滑下来、一路冲回前方低轨。

     于是整条回路是一个斜着立起来的矩形：前低后高。相机从右前上方看，
     高台在后、锯齿坡正对着观众往下冲 —— 这就是参考图里的那个立体感。

     ★ 电阻是【锯齿状的路面】，小球【坐在面上一路滑下去】，不是钻在管道里：
       路面（带宽 ROAD_W）画在小球中心线【下方】ROAD_OFF 处，小球正好压在面上。
     ========================================================================== */
  const XL = -44;                  // 左（电源）
  const XR = 40;                   // 右（电阻坡）
  const ZF = 15;                   // 前（低轨所在 z）
  const ZB = -15;                  // 后（高台 / 平台所在 z）
  const H_MIN = 40, H_MAX = 72;    // 落差的世界单位范围（对应 U_MIN … U_MAX）
  const BAT_R = 6.2;               // 电池半径（电池高度 = 落差 H，见 layout）
  const ROAD_W = 9.2;              // 路面宽（宽扁的跑道，不是细导线）
  const ROAD_T = 1.2;              // 路面厚
  const E_R = 1.55;                // 电子半径
  const ROAD_OFF = -(E_R + ROAD_T / 2);   // 路面画在小球中心线下方 ⇒ 小球「坐」在面上

  /** 电压 → 落差（世界单位）。全页唯一换算点。 */
  function loopHeight(U) {
    const u = clamp(U === undefined ? state.U : U, U_MIN, U_MAX);
    return H_MIN + (u - U_MIN) / (U_MAX - U_MIN) * (H_MAX - H_MIN);
  }

  /* 节点是【可变数组】：layout() 就地改值，外部拿到的引用永远有效 */
  const NODE = {
    A: [XL, 0, ZF],        // 电池底（+），也是低轨左端
    B: [XL, H_MAX, ZF],    // 电池顶（−）= 平台前端
    C: [XL, H_MAX, ZB],    // 平台后端 = 高台左端
    D: [XR, H_MAX, ZB],    // 高台右端 = 电阻起点
    E: [XR, 0, ZF],        // 电阻终点 = 低轨右端
    S0: [-8, 0, ZF],       // 开关左触点（低轨上，靠前，看得清）
    S1: [8, 0, ZF]         // 开关右触点
  };
  /* 电池：从低轨一直顶到高台 —— 「电源把电子抬升了整整一个落差」 */
  const BAT = { x: XL, z: ZF, r: BAT_R, y0: 0, nubR: 2.4, nubH: 1.6 };
  const SPACING = 4.2;           // 电子沿线间距 —— 恒定线密度
  const E_MAX = 900;             // 电子实例上限
  const TEETH_ONE = 4;           // 单个电阻的锯齿齿数
  const TEETH_SER = 3;           // 串联时【每一段】的齿数
  const AMP_K = 0.70;            // 锯齿幅度 = AMP_K × R（R=5 → 3.5；R=20 → 14）
  const ROAD_W_RES = 6.6;        // 电阻坡的路面窄一点，锯齿才看得出尖
  const PAR_X = 18;              // 并联两条支路在【左右】上的分离
  const ampOf = (R) => AMP_K * R;   // 锯齿幅度 ∝ 电阻：R=5 → 2.75，R=20 → 11

  /** 就地更新全部节点坐标（落差跟着 U 走；电池高度 = 落差） */
  function layout() {
    const H = loopHeight();
    NODE.A[0] = XL; NODE.A[1] = 0; NODE.A[2] = ZF;
    NODE.B[0] = XL; NODE.B[1] = H; NODE.B[2] = ZF;
    NODE.C[0] = XL; NODE.C[1] = H; NODE.C[2] = ZB;
    NODE.D[0] = XR; NODE.D[1] = H; NODE.D[2] = ZB;
    NODE.E[0] = XR; NODE.E[1] = 0; NODE.E[2] = ZF;
    NODE.S0[0] = -8; NODE.S0[1] = 0; NODE.S0[2] = ZF;
    NODE.S1[0] = 8; NODE.S1[1] = 0; NODE.S1[2] = ZF;
    return H;
  }

  const state = {
    U: U_DEF, R: R_DEF, mode: 'single', closed: true,
    t: 0, W: 0,                       // 通电时间 s / 电功 J
    showElectrons: true, showCurrent: true, showVoltage: true, showLabels: true,
    fsLayouts: 0
  };
  /* ★ 真正落笔的那一份几何，自检读它 —— 不许另抄一份期望值 */
  const DRAWN = {
    amp: 0, teeth: 0, branches: 1, resPoints: 0, H: H_MAX,
    voltLen: 0, voltTop: 0, voltBottom: 0, leverAngle: 0,
    resTopY: H_MAX, resMidY: H_MAX / 2, resBotY: 0,
    branchTopY: [], branchBotY: [],
    electrons: [], arrowDirs: [], totalParticles: 0, spacing: SPACING
  };

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
    if (stage) stage.appendChild(n);
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const MAX_ANISO = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#243040');
  scene.fog = new THREE.Fog('#243040', 320, 760);

  const camera = new THREE.PerspectiveCamera(32, 1.6, 0.5, 2000);

  function newCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  /* 棚拍环境贴图：给金属导线和红球提供高光 */
  function studioEnv() {
    const W = 1024, H = 512;
    const c = newCanvas(W, H), g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.44, '#e6ebf1');
    grad.addColorStop(0.5, '#98a3ae');
    grad.addColorStop(1, '#262b32');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    const box = (x, y, w, h, r, fill) => { g.fillStyle = fill; roundRect(g, x, y, w, h, r); g.fill(); };
    box(90, 26, 330, 170, 26, 'rgba(255,255,255,0.98)');
    box(680, 66, 240, 140, 22, 'rgba(206,228,255,0.60)');
    box(340, 300, 430, 96, 30, 'rgba(255,222,170,0.30)');
    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromEquirectangular(tex).texture;
    pmrem.dispose(); tex.dispose();
    return env;
  }
  scene.environment = studioEnv();

  scene.add(new THREE.HemisphereLight('#eaf2fa', '#39414c', 0.52));
  scene.add(new THREE.AmbientLight('#ffffff', 0.12));

  const keyLight = new THREE.DirectionalLight('#fff4e2', 1.85);
  keyLight.position.set(-70, 120, 150);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.left = -110; keyLight.shadow.camera.right = 110;
  keyLight.shadow.camera.top = 110; keyLight.shadow.camera.bottom = -110;
  keyLight.shadow.camera.near = 40; keyLight.shadow.camera.far = 520;
  keyLight.shadow.bias = -0.0007;
  keyLight.shadow.normalBias = 0.05;
  scene.add(keyLight);
  scene.add(keyLight.target);
  keyLight.target.position.set(10, 28, 0);

  const fillLight = new THREE.DirectionalLight('#dce9f8', 0.50);
  fillLight.position.set(130, 60, 90);
  scene.add(fillLight);
  const rimLight = new THREE.DirectionalLight('#cfe2ff', 0.44);
  rimLight.position.set(0, 50, -150);
  scene.add(rimLight);

  /* ---- 地面（只为空间参照，不抢主体） ---- */
  function makeFloorMap() {
    const W = 1024, H = 1024;
    const c = newCanvas(W, H), g = c.getContext('2d');
    g.fillStyle = '#2c343f'; g.fillRect(0, 0, W, H);
    let a = 20261016;
    const rnd = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    for (let i = 0; i < 16000; i++) {
      const x = rnd() * W, y = rnd() * H, r = 0.6 + rnd() * 2.2;
      g.fillStyle = rnd() > 0.5 ? `rgba(255,255,255,${(0.015 + rnd() * 0.04).toFixed(3)})` : `rgba(10,14,20,${(0.03 + rnd() * 0.06).toFixed(3)})`;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    g.strokeStyle = 'rgba(150,180,210,0.07)'; g.lineWidth = 2;
    for (let i = 0; i <= 16; i++) {
      const p = i * (W / 16);
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, H); g.stroke();
      g.beginPath(); g.moveTo(0, p); g.lineTo(W, p); g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2.4, 2.4);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const floorMap = makeFloorMap();
  floorMap.anisotropy = MAX_ANISO;
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(520, 4, 520),
    new THREE.MeshStandardMaterial({ map: floorMap, roughness: 0.95, metalness: 0.0, envMapIntensity: 0.35 })
  );
  floor.position.set(12, -6, 0);
  floor.receiveShadow = true;
  scene.add(floor);

  /* ==========================================================================
     五、材质
     ========================================================================== */
  const MAT = {
    wire: new THREE.MeshStandardMaterial({ color: '#f5c518', metalness: 0.55, roughness: 0.42, envMapIntensity: 0.9, side: THREE.DoubleSide }),
    /* 电阻：蓝白相间（照视频），一个齿一条带 */
    resA: new THREE.MeshStandardMaterial({
      color: '#2563eb', metalness: 0.30, roughness: 0.32, envMapIntensity: 0.9,
      emissive: new THREE.Color('#f97316'), emissiveIntensity: 0.0, side: THREE.DoubleSide
    }),
    resB: new THREE.MeshStandardMaterial({
      color: '#ffffff', metalness: 0.18, roughness: 0.28, envMapIntensity: 1.0,
      emissive: new THREE.Color('#f97316'), emissiveIntensity: 0.0, side: THREE.DoubleSide
    }),
    electron: new THREE.MeshStandardMaterial({ color: '#e11d1d', metalness: 0.10, roughness: 0.20, envMapIntensity: 1.6, emissive: new THREE.Color('#7f1010'), emissiveIntensity: 0.55 }),
    batteryPos: new THREE.MeshStandardMaterial({ color: '#f4c02a', metalness: 0.72, roughness: 0.28, envMapIntensity: 1.05 }),
    batteryNeg: new THREE.MeshStandardMaterial({ color: '#26303c', metalness: 0.70, roughness: 0.34, envMapIntensity: 0.95 }),
    forceArrow: new THREE.MeshStandardMaterial({ color: '#22c55e', metalness: 0.30, roughness: 0.42, emissive: new THREE.Color('#14532d'), emissiveIntensity: 0.45 }),
    voltArrow: new THREE.MeshStandardMaterial({ color: '#c084fc', metalness: 0.25, roughness: 0.40, emissive: new THREE.Color('#6b21a8'), emissiveIntensity: 0.50 }),
    voltGuide: new THREE.MeshBasicMaterial({ color: '#c084fc', transparent: true, opacity: 0.32, depthWrite: false }),
    currentArrow: new THREE.MeshStandardMaterial({ color: '#fde047', metalness: 0.20, roughness: 0.35, emissive: new THREE.Color('#a16207'), emissiveIntensity: 0.60 }),
    metal: new THREE.MeshStandardMaterial({ color: '#c3ccd8', metalness: 0.86, roughness: 0.30, envMapIntensity: 1.1 }),
    post: new THREE.MeshStandardMaterial({ color: '#b45a2a', metalness: 0.62, roughness: 0.40, envMapIntensity: 1.0 }),
    nodeDot: new THREE.MeshStandardMaterial({ color: '#facc15', metalness: 0.6, roughness: 0.3, emissive: new THREE.Color('#78350f'), emissiveIntensity: 0.4 })
  };

  /* ==========================================================================
     六、路径与几何
     ========================================================================== */
  const root = new THREE.Group();
  scene.add(root);

  /** 三角波（周期 1、峰在整数处、在 k+0.25 处过零）—— 让锯齿两端正好落在中线上 */
  function triWave(x) {
    const f = x - Math.floor(x);
    return 4 * Math.abs(f - 0.5) - 1;
  }
  function segLengths(pts) {
    const out = [];
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const d = Math.hypot(b[0] - a[0], b[1] - a[1], (b[2] || 0) - (a[2] || 0));
      out.push(d); total += d;
    }
    return { segs: out, len: total };
  }
  function mkStage(name, pts, kind) {
    const g = segLengths(pts);
    return { name, pts, segs: g.segs, len: g.len, kind };
  }

  /** 把 p0→p1 画成 teeth 个齿、幅度 amp 的锯齿（两端恰好落在中线上）。
      zBase = 整段在深度上的固定偏移（并联支路用）。 */
  /** 在 p0→p1 之间做 teeth 个齿、幅度 amp 的锯齿。
      ★ 锯齿在【左右方向（x）】上摆 —— 这样从正前方看就是一条明显的锯齿坡；
        沿线方向用真实的 3D 方向（电阻是从后上方一路冲到前下方的）。 */
  function zigzagPts(p0, p1, teeth, amp, xBase) {
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = (p1[2] || 0) - (p0[2] || 0);
    const L = Math.hypot(dx, dy, dz) || 1;
    const M = teeth * 8;
    const x0 = xBase || 0;
    const out = [];
    for (let i = 0; i <= M; i++) {
      const t = i / M;
      const off = amp * triWave(teeth * t + 0.25);
      out.push([
        x0 + p0[0] + dx * t + off,
        p0[1] + dy * t,
        (p0[2] || 0) + dz * t
      ]);
    }
    return out;
  }
  /** 并联的一条支路：整条下坡锯齿 + 左右分开（两端收拢回节点） */
  function parallelBranchPts(sign, amp) {
    const p0 = NODE.D, p1 = NODE.E;
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = (p1[2] || 0) - (p0[2] || 0);
    const M = TEETH_ONE * 8;
    const out = [];
    for (let i = 0; i <= M; i++) {
      const t = i / M;
      const ramp = Math.min(1, t / 0.14) * Math.min(1, (1 - t) / 0.14);
      const off = amp * triWave(TEETH_ONE * t + 0.25) * ramp + sign * PAR_X * ramp;
      out.push([
        p0[0] + dx * t + off,
        p0[1] + dy * t,
        (p0[2] || 0) + dz * t
      ]);
    }
    return out;
  }

  let route = null, particles = [], forkCounter = 0, electronMesh = null;

  /**
   * 电阻段几何。返回 { branches: [折线…], amp, teeth, strips: [{pts,kind}] }
   *   single   ：一整条下坡锯齿，齿数 4
   *   series   ：落差被分成两段（各一半）+ 中间一段【金色平台】，每段 3 齿 ⇒ 分压
   *   parallel ：两条支路各自跨满整个落差（⇒ 同压），左右分开
   */
  function buildResistorPts() {
    const amp = ampOf(state.R);
    const H = NODE.D[1];
    const strips = [];
    const toothStrips = (pts, teeth) => {
      const per = 8;
      for (let k = 0; k < teeth; k++) strips.push({ pts: pts.slice(k * per, (k + 1) * per + 1), kind: 'res' });
    };
    if (state.mode === 'parallel') {
      const a = parallelBranchPts(+1, amp), b = parallelBranchPts(-1, amp);
      toothStrips(a, TEETH_ONE); toothStrips(b, TEETH_ONE);
      return { branches: [a, b], amp, teeth: TEETH_ONE * 2, strips };
    }
    if (state.mode === 'series') {
      /* 落差被两段平分：中点按 y 与 z 一起插值；中间留出一段【金色平台】 */
      const midY = H / 2;
      const midZ = ((NODE.D[2] || 0) + (NODE.E[2] || 0)) / 2;
      const midX = (NODE.D[0] + NODE.E[0]) / 2;
      const midL = [midX - 8, midY, midZ];
      const midR = [midX + 8, midY, midZ];
      const a = zigzagPts(NODE.D, midL, TEETH_SER, amp);
      const b = zigzagPts(midR, NODE.E, TEETH_SER, amp);
      toothStrips(a, TEETH_SER);
      /* 中间那截【金色】平台：两段电阻之间的连接段（分压的分界点） */
      strips.push({ pts: [midL, midR], kind: 'landing' });
      toothStrips(b, TEETH_SER);
      /* ★ 必须 a.concat(b)（不是 b.slice(1)）：两段之间要留出那段【水平平台】，
         否则电子路径会从第一段末端直接斜跳到第二段第二个采样点，把平台抄近路抄掉。 */
      return { branches: [a.concat(b)], amp, teeth: TEETH_SER * 2, strips, landMidY: midY };
    }
    const one = zigzagPts(NODE.D, NODE.E, TEETH_ONE, amp);
    toothStrips(one, TEETH_ONE);
    return { branches: [one], amp, teeth: TEETH_ONE, strips };
  }

  /* ---- 路面：沿折线扫掠一个【水平放置】的矩形截面（宽沿水平法向、厚沿竖直） ----
     ★ 路面整体下移 ROAD_OFF ⇒ 小球坐在面上，而不是埋进带子里。 */
  function ribbonGeometry(pts, w, t, yOff) {
    const n = pts.length;
    if (n < 2) return null;
    const off = yOff || 0;
    const pos = new Float32Array(n * 4 * 3);
    const idx = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1], tz = (b[2] || 0) - (a[2] || 0);
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
      /* 宽度方向 = 切线 × 竖直 ⇒ 恒在水平面内；厚度方向恒为竖直 */
      let sx = -tz, sz = tx;
      let sl = Math.hypot(sx, sz);
      if (sl < 1e-6) { sx = 1; sz = 0; sl = 1; }
      sx /= sl; sz /= sl;
      const y = p[1] + off;
      const hw = w / 2, ht = t / 2;
      const z = p[2] || 0;
      const o = i * 12;
      pos[o + 0] = p[0] + sx * hw; pos[o + 1] = y + ht; pos[o + 2] = z + sz * hw;
      pos[o + 3] = p[0] - sx * hw; pos[o + 4] = y + ht; pos[o + 5] = z - sz * hw;
      pos[o + 6] = p[0] - sx * hw; pos[o + 7] = y - ht; pos[o + 8] = z - sz * hw;
      pos[o + 9] = p[0] + sx * hw; pos[o + 10] = y - ht; pos[o + 11] = z + sz * hw;
    }
    for (let i = 0; i < n - 1; i++) {
      const a = i * 4, b = (i + 1) * 4;
      for (let k = 0; k < 4; k++) {
        const k2 = (k + 1) % 4;
        idx.push(a + k, b + k, b + k2, a + k, b + k2, a + k2);
      }
    }
    const L = (n - 1) * 4;
    idx.push(0, 1, 2, 0, 2, 3);
    idx.push(L + 0, L + 2, L + 1, L + 0, L + 3, L + 2);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  /* ---- 场景构件 ---- */
  const wireGroup = new THREE.Group();   // 每次重建都清空重画
  const compGroup = new THREE.Group();
  root.add(wireGroup, compGroup);

  /* 电池：★ 高度 = 落差 H —— 电源把电子整整抬升一个落差。
     下半段黄色（+，电子从这里进），上半段深灰（−，电子从这里出）。 */
  const batteryGroup = new THREE.Group();
  let batLow = null, batHigh = null, batBand = null;
  {
    batLow = new THREE.Mesh(new THREE.CylinderGeometry(BAT.r, BAT.r, 1, 40, 1, false), MAT.batteryPos);
    batHigh = new THREE.Mesh(new THREE.CylinderGeometry(BAT.r + 0.02, BAT.r + 0.02, 1, 40, 1, false), MAT.batteryNeg);
    batBand = new THREE.Mesh(new THREE.TorusGeometry(BAT.r + 0.1, 0.24, 10, 40), MAT.metal);
    batBand.rotation.x = Math.PI / 2;
    for (const m of [batLow, batHigh]) { m.castShadow = true; m.receiveShadow = true; batteryGroup.add(m); }
    batteryGroup.add(batBand);
  }
  root.add(batteryGroup);

  /* 绿色「力」箭头：电源内部把电子从「+」推向「−」（三支，沿电池均匀分布） */
  const forceArrows = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 7.0, 16), MAT.forceArrow);
    const head = new THREE.Mesh(new THREE.ConeGeometry(1.7, 3.4, 20), MAT.forceArrow);
    shaft.userData.k = 0.16 + i * 0.30;      // 沿电池高度的比例位置
    head.userData.k = 0.16 + i * 0.30;
    forceArrows.add(shaft, head);
  }
  root.add(forceArrows);

  /* 开关：两个触点柱 + 一根绕左触点转动的闸刀（放在【前方低轨】上，最显眼） */
  const switchGroup = new THREE.Group();
  const lever = new THREE.Group();
  {
    for (const x of [NODE.S0[0], NODE.S1[0]]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 3.4, 18), MAT.post);
      post.position.set(x, 0, 0);
      post.castShadow = true;
      switchGroup.add(post);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(1.3, 18, 12), MAT.metal);
      cap.position.set(x, 1.7, 0);
      switchGroup.add(cap);
    }
    const barLen = NODE.S1[0] - NODE.S0[0];
    const bar = new THREE.Mesh(new THREE.BoxGeometry(barLen, 1.2, 1.6), MAT.metal);
    bar.position.set(barLen / 2, 0, 0);
    bar.castShadow = true;
    lever.add(bar);
    lever.position.set(NODE.S0[0], 1.7, 0);
    switchGroup.add(lever);
    switchGroup.position.set(0, 0, ZF);
  }
  root.add(switchGroup);

  /* 电压双箭头（紫）：★ 正好跨满低轨到高台 —— 长度就是落差，就是电压 */
  const voltGroup = new THREE.Group();
  let voltShaft = null, voltHeadUp = null, voltHeadDown = null, voltGuide = null, voltGuide2 = null;
  {
    voltShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 14), MAT.voltArrow);
    voltHeadUp = new THREE.Mesh(new THREE.ConeGeometry(1.5, 3.2, 18), MAT.voltArrow);
    voltHeadDown = new THREE.Mesh(new THREE.ConeGeometry(1.5, 3.2, 18), MAT.voltArrow);
    voltHeadDown.rotation.z = Math.PI;
    /* 两条「等势线」：横着拉开，标出「这两层之间就是电压」 */
    voltGuide = new THREE.Mesh(new THREE.BoxGeometry(46, 0.34, 0.34), MAT.voltGuide);
    voltGuide2 = new THREE.Mesh(new THREE.BoxGeometry(46, 0.34, 0.34), MAT.voltGuide);
    voltGroup.add(voltShaft, voltHeadUp, voltHeadDown, voltGuide, voltGuide2);
    voltGroup.position.set(2, 0, 0);
  }
  root.add(voltGroup);

  /** 落差一变，把跟着走的那几件搬过去 / 拉长 */
  function placeComponents() {
    const H = NODE.B[1];
    batLow.scale.y = H / 2; batLow.position.set(BAT.x, H / 4, BAT.z);
    batHigh.scale.y = H / 2; batHigh.position.set(BAT.x, H * 0.75, BAT.z);
    batBand.position.set(BAT.x, H / 2, BAT.z);
    for (const m of forceArrows.children) {
      const k = m.userData.k;
      if (m.geometry.type === 'CylinderGeometry') m.position.set(BAT.x - 11.5, H * k + 3.5, BAT.z);
      else m.position.set(BAT.x - 11.5, H * k + 8.6, BAT.z);
    }
    voltGroup.position.set(2, 0, 0);
  }

  /* 电流方向箭头（黄，与电子反向）：沿路径均匀摆几枚锥体 */
  const currentArrowGroup = new THREE.Group();
  const CUR_ARROWS = 8;
  for (let i = 0; i < CUR_ARROWS; i++) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1.4, 3.8, 16), MAT.currentArrow);
    currentArrowGroup.add(cone);
  }
  root.add(currentArrowGroup);

  /* 电子：一个 InstancedMesh 装下全部 */
  electronMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(E_R, 18, 12), MAT.electron, E_MAX);
  electronMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  electronMesh.frustumCulled = false;
  root.add(electronMesh);

  /* ---- 文字标签（Sprite，永远面向相机） ---- */
  /** 把 text 画进 sp 自己的 canvas 并换贴图（尺寸跟着文字变） */
  function paintLabel(sp, text) {
    const o = sp.userData.opt;
    const c = sp.userData.canvas;
    const fontStr = '700 ' + o.font + 'px Inter, "PingFang SC", "Microsoft YaHei", sans-serif';
    let g = c.getContext('2d');
    g.font = fontStr;
    const tw = Math.ceil(g.measureText(text).width);
    c.width = tw + o.pad * 2;
    c.height = o.font + o.pad * 2;
    g = c.getContext('2d');
    g.font = fontStr;
    g.fillStyle = o.bg;
    roundRect(g, 1.5, 1.5, c.width - 3, c.height - 3, 16); g.fill();
    g.strokeStyle = o.border; g.lineWidth = 3; g.stroke();
    g.fillStyle = o.color;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, c.width / 2, c.height / 2 + 2);
    sp.userData.text = text;
    const tex = sp.material.map;
    if (tex) {
      tex.image = c;
      tex.needsUpdate = true;
    }
    sp.scale.set(c.width * o.scale, c.height * o.scale, 1);
  }
  function makeLabel(text, opts) {
    const o = Object.assign({ font: 44, pad: 16, color: '#f8fafc', bg: 'rgba(9,20,33,0.78)', border: 'rgba(125,211,252,0.55)', scale: 0.052 }, opts || {});
    const c = newCanvas(8, 8);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
    const sp = new THREE.Sprite(mat);
    sp.userData = { opt: o, canvas: c, text: null };
    paintLabel(sp, text);
    return sp;
  }
  /** 只在文字真的变了才重画（每帧调也不心疼） */
  function setSpriteText(sp, text) {
    if (!sp || !sp.userData || sp.userData.text === text) return;
    paintLabel(sp, text);
  }

  const labelGroup = new THREE.Group();
  const LBL = {
    battery: makeLabel('电源', { color: '#fde68a', border: 'rgba(250,204,21,0.6)' }),
    plus: makeLabel('+', { color: '#fde68a', border: 'rgba(250,204,21,0.6)', font: 54 }),
    minus: makeLabel('−', { color: '#cbd5e1', border: 'rgba(148,163,184,0.6)', font: 54 }),
    force: makeLabel('把电子搬上去', { color: '#86efac', border: 'rgba(34,197,94,0.6)' }),
    resistor: makeLabel('电阻 R', { color: '#bfdbfe', border: 'rgba(59,130,246,0.6)' }),
    voltage: makeLabel('电压 U', { color: '#e9d5ff', border: 'rgba(168,85,247,0.65)' }),
    switchL: makeLabel('开关', { color: '#e2e8f0', border: 'rgba(148,163,184,0.6)' }),
    electron: makeLabel('自由电子', { color: '#fecaca', border: 'rgba(239,68,68,0.65)' }),
    current: makeLabel('电流方向', { color: '#fde047', border: 'rgba(234,179,8,0.7)' }),
    r1: makeLabel('R₁ 分到 U/2', { color: '#bfdbfe', border: 'rgba(59,130,246,0.6)', font: 38, pad: 12 }),
    r2: makeLabel('R₂ 分到 U/2', { color: '#bfdbfe', border: 'rgba(59,130,246,0.6)', font: 38, pad: 12 }),
    highPot: makeLabel('高电势', { color: '#fcd34d', border: 'rgba(250,204,21,0.55)', font: 38, pad: 12 }),
    lowPot: makeLabel('低电势 0', { color: '#94a3b8', border: 'rgba(148,163,184,0.55)', font: 38, pad: 12 }),
    drop: makeLabel('落差 = 电压', { color: '#e9d5ff', border: 'rgba(168,85,247,0.6)', font: 38, pad: 12 })
  };
  Object.values(LBL).forEach((s) => labelGroup.add(s));
  root.add(labelGroup);

  /* 标签的世界位置（跟着落差 H 走） */
  function placeLabels() {
    const H = NODE.D[1];
    LBL.battery.position.set(XL + 13, H * 0.82, ZF);
    LBL.force.position.set(XL + 13, H * 0.26, ZF);
    LBL.plus.position.set(BAT.x + 7.6, H * 0.08, ZF);
    LBL.minus.position.set(BAT.x + 7.6, H * 0.92, ZF);
    LBL.switchL.position.set(0, 8.5, ZF);
    LBL.electron.position.set(-22, 7, ZF);
    LBL.highPot.position.set(-20, H + 6, ZB);
    LBL.lowPot.position.set(24, 6.5, ZF);
    LBL.voltage.position.set(2 - 17, H * 0.55, 0);
    LBL.resistor.position.set(XR + 17, H * 0.55, 0);
    LBL.r1.position.set(XR + 24, H * 0.80, ZB * 0.4);
    LBL.r2.position.set(XR + 26, H * 0.22, ZF * 0.4);
    const a = currentArrowGroup.children[2];
    LBL.current.position.set(a.position.x, a.position.y + 11, a.position.z);
  }

  /* ==========================================================================
     七、路径装配
     ========================================================================== */
  function rebuildRoute(modeChanged) {
    const oldLens = route ? {
      pre: route.pre.map((s) => s.len),
      res: route.res.map((s) => s.len),
      post: route.post.map((s) => s.len)
    } : null;

    layout();                       // ★ 落差跟着 U 走：节点先就位
    const rp = buildResistorPts();
    /* 电子绕行顺序：电池抬升 → 平台往里走 → 后方高台 → 右侧锯齿坡冲下来 → 前方低轨回到电池 */
    const pre = [
      mkStage('lift', [NODE.A.slice(), NODE.B.slice()], 'trunk'),   // 电池内部（被电池挡住）
      mkStage('plat', [NODE.B.slice(), NODE.C.slice()], 'trunk'),   // 平台：往里走
      mkStage('top', [NODE.C.slice(), NODE.D.slice()], 'trunk')     // 后方高台
    ];
    const res = rp.branches.map((pts, i) => mkStage('res' + i, pts, 'branch'));
    const post = [
      mkStage('botR', [NODE.E.slice(), NODE.S1.slice()], 'trunk'),
      mkStage('sw', [NODE.S1.slice(), NODE.S0.slice()], 'trunk'),
      mkStage('botL', [NODE.S0.slice(), NODE.A.slice()], 'trunk')
    ];
    route = { pre, res, post, amp: rp.amp, teeth: rp.teeth };

    DRAWN.amp = rp.amp;
    DRAWN.teeth = rp.teeth;
    DRAWN.branches = res.length;
    DRAWN.resPoints = rp.branches[0].length;
    DRAWN.H = NODE.D[1];
    DRAWN.resTopY = NODE.D[1];
    DRAWN.resBotY = NODE.E[1];
    DRAWN.resMidY = rp.landMidY === undefined ? (NODE.D[1] + NODE.E[1]) / 2 : rp.landMidY;
    DRAWN.branchTopY = rp.branches.map((p) => p[0][1]);
    DRAWN.branchBotY = rp.branches.map((p) => p[p.length - 1][1]);

    rebuildWire(rp);
    placeComponents();
    if (modeChanged || !oldLens) initParticles();
    else rescaleParticles(oldLens);
  }

  /** 落差 / 电阻值变了：把每个电子的弧长按【段长变化比例】缩放，不瞬移 */
  function rescaleParticles(oldLens) {
    for (const p of particles) {
      const list = p.phase === 0 ? route.pre : p.phase === 2 ? route.post : route.res;
      const oldList = p.phase === 0 ? oldLens.pre : p.phase === 2 ? oldLens.post : oldLens.res;
      const i = p.phase === 1 ? p.b : p.idx;
      const st = list[i], old = oldList[i];
      if (!st || !old || old <= 0) continue;
      p.s = p.s * (st.len / old);
      if (p.s >= st.len) p.s = st.len * 0.98;
    }
  }

  /** 重建全部路面（含电阻锯齿段） */
  function rebuildWire(rp) {
    while (wireGroup.children.length) {
      const o = wireGroup.children.pop();
      if (o.geometry) o.geometry.dispose();
    }
    const addRibbon = (pts, mat, w, t) => {
      const g = ribbonGeometry(pts, w, t, ROAD_OFF);
      if (!g) return;
      const m = new THREE.Mesh(g, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      wireGroup.add(m);
    };
    /* 平台（电池顶 → 往里走）与后方高台 —— 都是金色跑道 */
    addRibbon([NODE.B.slice(), NODE.C.slice()], MAT.wire, ROAD_W, ROAD_T);
    addRibbon([NODE.C.slice(), NODE.D.slice()], MAT.wire, ROAD_W, ROAD_T);
    /* 前方低轨：电阻落点 → 开关右柱，开关左柱 → 电池底部 */
    addRibbon([NODE.E.slice(), [NODE.S1[0] + 1.2, NODE.S1[1], NODE.S1[2]]], MAT.wire, ROAD_W, ROAD_T);
    addRibbon([[NODE.S0[0] - 1.2, NODE.S0[1], NODE.S0[2]], NODE.A.slice()], MAT.wire, ROAD_W, ROAD_T);

    /* 电阻：一个齿一条带，蓝白相间（照视频的配色）；串联的中间平台用金色跑道 */
    let resIdx = 0;
    for (const s of (rp && rp.strips) || []) {
      if (s.kind === 'landing') {
        addRibbon(s.pts, MAT.wire, ROAD_W, ROAD_T);
        resIdx = 0;
        continue;
      }
      addRibbon(s.pts, (resIdx++ % 2 === 0) ? MAT.resA : MAT.resB, ROAD_W_RES, ROAD_T);
    }

    /* 并联：高台右端 / 低轨右端各加一块「分流 / 汇合」宽板 */
    if (state.mode === 'parallel') {
      for (const p of [NODE.D, NODE.E]) {
        const plate = new THREE.Mesh(new THREE.BoxGeometry(2 * PAR_X + ROAD_W + 4, ROAD_T, ROAD_W), MAT.wire);
        plate.position.set(p[0], p[1] + ROAD_OFF, p[2]);
        plate.castShadow = true; plate.receiveShadow = true;
        wireGroup.add(plate);
      }
    }
  }

  /* ---- 电子沿路径的推进 ---- */
  function curStage(p) {
    if (!route) return null;
    if (p.phase === 0) return route.pre[p.idx];
    if (p.phase === 2) return route.post[p.idx];
    return route.res[p.b];
  }
  function advance(p, ds) {
    if (!(ds > 0)) return;
    p.s += ds;
    let guard = 0;
    while (guard++ < 128) {
      const st = curStage(p);
      if (!st || p.s < st.len) break;
      p.s -= st.len;
      if (p.phase === 0) {
        p.idx++;
        if (p.idx >= route.pre.length) { p.phase = 1; p.b = (forkCounter++) % route.res.length; }
      } else if (p.phase === 1) {
        p.phase = 2; p.idx = 0;
      } else {
        p.idx++;
        if (p.idx >= route.post.length) { p.phase = 0; p.idx = 0; }
      }
    }
  }
  /** 沿折线按弧长取点（含切线），返回的是【真正落笔】的那一份 */
  function pointAt(st, s) {
    let acc = 0;
    const last = st.pts.length - 2;
    for (let i = 0; i <= last; i++) {
      const seg = st.segs[i];
      if (acc + seg >= s || i === last) {
        const a = st.pts[i], b = st.pts[i + 1];
        const u = seg > 1e-9 ? clamp((s - acc) / seg, 0, 1) : 0;
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const dl = Math.hypot(dx, dy) || 1;
        return {
          x: a[0] + dx * u, y: a[1] + dy * u, z: (a[2] || 0) + ((b[2] || 0) - (a[2] || 0)) * u,
          tx: dx / dl, ty: dy / dl
        };
      }
      acc += seg;
    }
    const a = st.pts[0];
    return { x: a[0], y: a[1], z: a[2] || 0, tx: 1, ty: 0 };
  }
  function electronPoint(p) {
    const st = curStage(p);
    if (!st || st.len <= 1e-9) return null;
    return pointAt(st, clamp(p.s, 0, st.len * 0.9999));
  }

  function initParticles() {
    particles.length = 0;
    forkCounter = 0;
    const push = (phase, idx, b, s) => {
      if (particles.length < E_MAX) particles.push({ phase, idx, b, s });
    };
    for (let i = 0; i < route.pre.length; i++) {
      const L = route.pre[i].len;
      for (let s = SPACING * 0.5; s < L; s += SPACING) push(0, i, 0, s);
    }
    for (let b = 0; b < route.res.length; b++) {
      const L = route.res[b].len;
      for (let s = SPACING * 0.5; s < L; s += SPACING) push(1, 0, b, s);
    }
    for (let i = 0; i < route.post.length; i++) {
      const L = route.post[i].len;
      for (let s = SPACING * 0.5; s < L; s += SPACING) push(2, i, 0, s);
    }
    DRAWN.totalParticles = particles.length;
  }
  /** R 变了、几何长度跟着变：把已有的 s 按比例缩放（见 rescaleParticles） */

  /* ==========================================================================
     八、每帧刷新场景
     ========================================================================== */
  const _m4 = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _v3 = new THREE.Vector3();
  const _sc = new THREE.Vector3(1, 1, 1);
  const _col = new THREE.Color();

  function updateElectrons() {
    const on = state.showElectrons;
    electronMesh.visible = on;
    if (!on) { DRAWN.electrons.length = 0; electronMesh.count = 0; return; }
    let n = 0;
    DRAWN.electrons.length = 0;
    for (const p of particles) {
      const q = electronPoint(p);
      if (!q || n >= E_MAX) continue;
      _v3.set(q.x, q.y, q.z);
      _m4.compose(_v3, _q.identity(), _sc);
      electronMesh.setMatrixAt(n, _m4);
      DRAWN.electrons.push({ x: q.x, y: q.y, z: q.z, phase: p.phase, branch: p.b, idx: p.idx, s: p.s });
      n++;
    }
    electronMesh.count = n;
    electronMesh.instanceMatrix.needsUpdate = true;
  }

  function updateVoltageArrow() {
    const on = state.showVoltage;
    voltGroup.visible = on;
    if (!on) { DRAWN.voltLen = 0; return; }
    /* ★★ 电压箭头【正好跨满下轨到上轨】：箭头有多长，落差就有多高 ——
       「电压就是落差」这件事必须由几何本身说出来，不能靠一个长度随便给的装饰箭头。 */
    const H = NODE.C[1];
    const y0 = 0, y1 = H;
    const len = y1 - y0;
    voltShaft.scale.set(1, Math.max(0.01, len - 6.4), 1);
    voltShaft.position.set(0, y0 + len / 2, 0);
    voltHeadUp.position.set(0, y1 - 1.6, 0);
    voltHeadDown.position.set(0, y0 + 1.6, 0);
    /* 两条等势横线：贴在两条轨的外侧一点点，避免和轨道本身 z-fighting */
    voltGuide.scale.y = 1;
    voltGuide.position.set(-14, y1 + 1.0, 0);
    voltGuide2.position.set(-14, y0 - 1.0, 0);
    DRAWN.voltLen = len;
    DRAWN.voltBottom = y0;
    DRAWN.voltTop = y1;
  }

  function updateCurrentArrows() {
    const on = state.showCurrent;
    currentArrowGroup.visible = on;
    DRAWN.arrowDirs.length = 0;
    if (!on || !route) return;
    /* 沿整条回路均匀取 CUR_ARROWS 个点，箭头指向【电流方向】（与电子反向）。
       ★ 必须把【每一条】电阻支路都算进路径：只取 route.res[0] 的话，
         并联时另一条支路上一枚箭头都没有，学生会以为那条路没有电流。 */
    const segs = [];
    for (const st of route.pre) segs.push(st);
    for (const st of route.res) segs.push(st);
    for (const st of route.post) segs.push(st);
    let total = 0;
    for (const st of segs) total += st.len;
    for (let i = 0; i < CUR_ARROWS; i++) {
      let s = ((i + 0.5) / CUR_ARROWS) * total;
      let st = segs[segs.length - 1];
      for (const cand of segs) { if (s < cand.len) { st = cand; break; } s -= cand.len; }
      const q = pointAt(st, clamp(s, 0, st.len * 0.9999));
      const cone = currentArrowGroup.children[i];
      /* 电子沿 +切向 前进 ⇒ 电流方向取 −切向。
         ★ 往 +z 挪一点：不挪的话黄锥体整根埋在大红球堆里，一枚都看不见。 */
      const ang = Math.atan2(-q.tx, q.ty);
      cone.position.set(q.x, q.y, (q.z || 0) + 3.6);
      cone.rotation.set(0, 0, -ang);
      DRAWN.arrowDirs.push({ x: q.x, y: q.y, z: q.z, dx: -q.tx, dy: -q.ty });
    }
    const a0 = currentArrowGroup.children[2];
    LBL.current.position.set(a0.position.x, a0.position.y + 11, a0.position.z);
  }

  const RES_A_COOL = new THREE.Color('#2563eb');   // 冷：蓝（照视频里电阻的蓝面）
  const RES_A_HOT = new THREE.Color('#b45309');
  const RES_B_COOL = new THREE.Color('#ffffff');   // 冷：白（电阻的白面）
  const RES_B_HOT = new THREE.Color('#fed7aa');
  function updateHeat() {
    const P = state.closed ? powerOf(state.U, state.mode, state.R) : 0;
    const Pmax = powerOf(U_MAX, 'parallel', R_MIN);
    const k = clamp(P / Pmax, 0, 1);
    const on = state.closed ? k * 0.85 : 0;
    MAT.resA.emissiveIntensity = on;
    MAT.resB.emissiveIntensity = on * 0.6;
    MAT.resA.color.copy(RES_A_COOL).lerp(RES_A_HOT, k);
    MAT.resB.color.copy(RES_B_COOL).lerp(RES_B_HOT, k);
  }

  function updateScene() {
    const I = totalCurrent(state.U, state.mode, state.R);
    MAT.electron.color.setRGB(0.88, 0.11, 0.11);
    if (!state.closed) MAT.electron.emissiveIntensity = 0.22;
    else MAT.electron.emissiveIntensity = 0.35 + clamp(I / 3.0, 0, 1) * 0.5;
    LBL.resistor.visible = state.showLabels;
    LBL.electron.visible = state.showLabels;
    LBL.current.visible = state.showLabels && state.showCurrent;
    LBL.r1.visible = state.showLabels && state.mode === 'series';
    LBL.r2.visible = state.showLabels && state.mode === 'series';
    for (const k of ['battery', 'plus', 'minus', 'force', 'switchL', 'highPot', 'lowPot']) LBL[k].visible = state.showLabels;
    LBL.drop.visible = false;      // 「落差 = 电压」这条与箭头标签重复，留字面不给画面添乱
    setSpriteText(LBL.voltage, '电压 U = ' + fmt(state.U, 1) + ' V');
    lever.rotation.z = state.closed ? 0 : 0.82;
    DRAWN.leverAngle = lever.rotation.z;
    placeLabels();
    updateVoltageArrow();
    updateCurrentArrows();
    updateElectrons();
    updateHeat();
  }

  /* ==========================================================================
     九、相机 / 视角 / 全屏
     ========================================================================== */
  /* tyF = 注视点在落差上的【比例】—— 落差随电压变，注视点必须跟着走 */
  const VIEWS = {
    iso: { yaw: -0.46, pitch: 0.30, dist: 188, tx: 0, tyF: 0.53 },
    front: { yaw: 0.00, pitch: 0.16, dist: 180, tx: 0, tyF: 0.52 },
    top: { yaw: -0.40, pitch: 0.95, dist: 192, tx: 0, tyF: 0.46 },
    resistor: { yaw: 0.24, pitch: 0.16, dist: 72, tx: 34, tyF: 0.50 },
    battery: { yaw: -0.62, pitch: 0.14, dist: 78, tx: -34, tyF: 0.42 }
  };
  const view = Object.assign({}, VIEWS.iso);
  let currentView = 'iso';

  /* ★ 窄屏（手机竖屏）必须把相机往后拉：电路横向跨度 ~130 世界单位，
     画布 aspect 一旦小于参考值，横向就装不下（实测 390px 下内容占画框宽 133%）。
     做法 = 距离乘一个只跟 aspect 有关的系数，参考宽高比以上一律不放大（默认视口零变化）。 */
  const REF_ASPECT = 1.72;
  function fitFactor() {
    const a = camera.aspect || REF_ASPECT;
    return clamp(REF_ASPECT / Math.max(a, 0.2), 1, 2.8);
  }

  function updateCamera() {
    const H = NODE.C[1];
    const ty = (view.tyF === undefined ? 0.5 : view.tyF) * H;
    view.ty = ty;
    const t = new THREE.Vector3(view.tx || 0, ty, view.tz || 0);
    const cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
    const dist = view.dist * fitFactor();
    camera.position.set(
      t.x + dist * cp * Math.sin(view.yaw),
      t.y + dist * sp,
      t.z + dist * cp * Math.cos(view.yaw)
    );
    camera.lookAt(t);
    /* ★ 必须立刻刷世界矩阵：three.js 只在 renderer.render() 里更新 matrixWorldInverse，
       少了这句「设完视角马上量屏幕落点」量到的是上一帧的相机 */
    camera.updateMatrixWorld(true);
    requestRender();
  }
  function applyView(name, silent) {
    const v = VIEWS[name];
    if (!v) return false;
    currentView = name;
    Object.assign(view, v);
    document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    updateCamera();
    if (!silent) updateScene();
    return true;
  }

  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    updateCamera();          // ★ aspect 变了 ⇒ 取景系数跟着变，必须重算相机
    requestRender();
  }
  const relayout = () => {
    resize();
    drawChart();
    requestRender();
    if (fsPending) fsSecond();
  };
  window.addEventListener('resize', relayout);
  if (window.ResizeObserver) new ResizeObserver(relayout).observe(stage);

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
    view.yaw -= dx * 3.0;
    view.pitch = clamp(view.pitch + dy * 2.3, -0.10, 1.38);
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
    view.dist = clamp(view.dist * (1 + Math.sign(e.deltaY) * 0.08), 26, 420);
    updateCamera();
  }, { passive: false });

  /* ---- 全屏 ---- */
  const fsBtn = $('el-fs');
  const fsIsOn = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  let fsPending = false, fsSecondPass = false;
  function fsSecond() {
    if (fsSecondPass) return;
    fsSecondPass = true;
    fsPending = false;
    resize();
    state.fsLayouts++;
    requestRender();
  }
  if (fsBtn) {
    fsBtn.addEventListener('click', () => {
      if (fsIsOn()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else if (stage.requestFullscreen) {
        /* 合成点击（自检/自动化）没有用户手势，requestFullscreen 会 reject ——
           不 catch 就是一条未捕获的 Promise 拒绝，会被记成「页面 console 错误」。 */
        const pr = stage.requestFullscreen();
        if (pr && pr.catch) pr.catch(() => {});
      }
      else if (stage.webkitRequestFullscreen) stage.webkitRequestFullscreen();
    });
  }
  document.addEventListener('fullscreenchange', () => {
    const on = fsIsOn();
    if (fsBtn) {
      const ex = fsBtn.querySelector('.fs-expand'), cp = fsBtn.querySelector('.fs-compress'), lb = fsBtn.querySelector('.lbl');
      if (ex) ex.style.display = on ? 'none' : '';
      if (cp) cp.style.display = on ? '' : 'none';
      if (lb) lb.textContent = on ? '退出' : '全屏';
      fsBtn.title = on ? '退出全屏' : '全屏显示实验画面';
    }
    fsSecondPass = false;
    fsPending = true;
    resize(); state.fsLayouts++;
    requestAnimationFrame(() => requestAnimationFrame(fsSecond));
    setTimeout(fsSecond, 90);
  });

  /* ==========================================================================
     十、读数 / 图像 / 记录表
     ========================================================================== */
  function stateChip() {
    if (!state.closed) return { text: '电路断开', note: '电子停在原地不动', ok: false };
    const I = totalCurrent(state.U, state.mode, state.R);
    if (state.mode === 'parallel') return { text: '并联通电中', note: '两条支路各分到一半电流', ok: true };
    if (state.mode === 'series') return { text: '串联通电中', note: '总电阻 2R，电流只有一半', ok: true };
    return { text: '通电中', note: '电流 I = U / R = ' + fmt(I, 2) + ' A', ok: true };
  }

  function syncAll() {
    /* ★ 开关断开 ⇒ 电流为 0（电压还在）。读数一律走这里算出来的 I / Ib / P，
       不许别处再拿 U/R 直接显示 —— 否则断开了还写着 0.60 A。 */
    const Rtot = resistorTotal(state.mode, state.R);
    const I = state.closed ? totalCurrent(state.U, state.mode, state.R) : 0;
    const Ib = state.closed ? branchCurrent(state.U, state.mode, state.R) : 0;
    const P = state.closed ? powerOf(state.U, state.mode, state.R) : 0;
    const v = state.closed ? visualSpeed(totalCurrent(state.U, state.mode, state.R)) : 0;
    const chip = stateChip();

    setText($('hudI'), fmt(I, 2));
    setText($('hudU'), fmt(state.U, 1));
    setText($('hudR'), fmt(Rtot, 1));
    setText($('hudP'), fmt(P, 2));
    setText($('hudW'), fmt(state.W, 1));
    setText($('hudT'), fmt(state.t, 1));
    setText($('stateChip'), chip.text);
    setText($('stateNote'), chip.note);
    setClass($('stateDot'), 'ok', chip.ok);
    setText($('uVal'), fmt(state.U, 1) + ' V');
    setText($('rVal'), fmt(state.R, 0) + ' Ω');
    setText($('barUval'), fmt(state.U, 1) + ' V');
    setText($('barRval'), fmt(state.R, 0) + ' Ω');
    setDisabled($('powerBtn'), false);
    setClass($('powerBtn'), 'on', state.closed);
    setText($('powerBtn'), state.closed ? '🔌 断开开关' : '🔌 闭合开关');
    setClass($('barPower'), 'on', state.closed);
    setText($('barPower'), state.closed ? '🔌 通电中' : '🔌 已断开');
    setText($('modeNow'), MODE_LABEL[state.mode]);

    setText($('metricV'), fmt(v, 1) + ' /s');
    setText($('metricI'), fmt(I, 2) + ' A');
    setText($('metricU'), fmt(state.U, 1) + ' V');
    setText($('metricR'), fmt(Rtot, 1) + ' Ω');
    setText($('metricP'), fmt(P, 2) + ' W');
    setText($('metricW'), fmt(state.W, 1) + ' J');
    setText($('metricIb'), fmt(Ib, 2) + ' A');

    document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === state.mode));
    document.querySelectorAll('[data-bar-mode]').forEach((b) => b.classList.toggle('active', b.dataset.barMode === state.mode));
    const uR = $('uRange'); if (uR && +uR.value !== state.U) uR.value = String(state.U);
    const rR = $('rRange'); if (rR && +rR.value !== state.R) rR.value = String(state.R);
    setDisabled($('uMinus'), state.U <= U_MIN + 1e-6);
    setDisabled($('uPlus'), state.U >= U_MAX - 1e-6);
    setDisabled($('rMinus'), state.R <= R_MIN + 1e-6);
    setDisabled($('rPlus'), state.R >= R_MAX - 1e-6);
    setDisabled($('barUMinus'), state.U <= U_MIN + 1e-6);
    setDisabled($('barUPlus'), state.U >= U_MAX - 1e-6);
    setDisabled($('barRMinus'), state.R <= R_MIN + 1e-6);
    setDisabled($('barRPlus'), state.R >= R_MAX - 1e-6);

    /* 三条对比条：把"电流是原来的几倍"画出来 */
    const Imax = totalCurrent(U_MAX, 'parallel', R_MIN);
    setWidth($('barI'), clamp(I / Imax, 0, 1) * 100);
    setWidth($('barU'), ((state.U - U_MIN) / (U_MAX - U_MIN)) * 100);
    setWidth($('barR'), ((state.R - R_MIN) / (R_MAX - R_MIN)) * 100);

    syncFinding(I, Rtot, P);
    drawChart();
  }

  function syncFinding(I, Rtot, P) {
    const el = $('finding');
    if (!el) return;
    let s;
    if (!state.closed) {
      s = '开关断开了：<b>落差还在（电压没变），电流却没了</b>。红色电子全部停在坡上 —— 它们还在导线里，只是不再往下走。';
    } else if (state.mode === 'parallel') {
      s = '两个电阻<b>并联</b>：<b>两条锯齿坡各自跨满整个落差</b>（所以电压相同），电子在右上角分成两路各走一条，下端再汇合。' +
        '干路电流 <b>' + fmt(I, 2) + ' A</b> 是单个电阻时的 <b>2 倍</b>，总电阻只剩 <b>' + fmt(Rtot, 1) + ' Ω</b>（= R/2）。';
    } else if (state.mode === 'series') {
      s = '两个电阻<b>串联</b>：整个落差被两段锯齿<b>分掉</b>（中间是金色平台，每段各分到 U/2），路更长、磕碰更多 —— ' +
        '相当于一个 <b>' + fmt(Rtot, 1) + ' Ω</b> 的大电阻，电流只剩单个电阻时的 <b>一半</b>（' + fmt(I, 2) + ' A）。';
    } else {
      s = '一个电阻：落差 <b>' + fmt(state.U, 1) + ' V</b>，锯齿 <b>' + fmt(state.R, 0) + ' Ω</b> ⇒ I = U / R = <b>' +
        fmt(I, 2) + ' A</b>，电功率 P = UI = <b>' + fmt(P, 2) + ' W</b>。想让电流更大？把落差拉大，或者把锯齿削平。';
    }
    el.innerHTML = s;
  }

  /* ---- 图像：I 随 R 变化 ---- */
  function chartGeom() {
    const cv = $('chartCanvas');
    if (!cv) return null;
    const w = cv.clientWidth || 640, h = cv.clientHeight || 190;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(2, Math.round(w * dpr)), H = Math.max(2, Math.round(h * dpr));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    return { W, H, dpr, padL: 54 * dpr, padR: 18 * dpr, padT: 20 * dpr, padB: 34 * dpr, rMax: 44, iMax: 4 };
  }
  function xOfR(g, R) { return g.padL + (R / g.rMax) * (g.W - g.padL - g.padR); }
  function yOfI(g, I) { return g.H - g.padB - (I / g.iMax) * (g.H - g.padT - g.padB); }

  function drawChart() {
    const cv = $('chartCanvas');
    if (!cv) return;
    const g = chartGeom();
    if (!g) return;
    const ctx = cv.getContext('2d');
    const d = g.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, g.W, g.H);
    ctx.fillStyle = '#0a1727';
    ctx.fillRect(0, 0, g.W, g.H);

    /* 网格 */
    ctx.strokeStyle = 'rgba(148,163,184,0.16)';
    ctx.lineWidth = 1 * d;
    for (let R = 0; R <= g.rMax; R += 10) {
      const x = xOfR(g, R);
      ctx.beginPath(); ctx.moveTo(x, g.padT); ctx.lineTo(x, g.H - g.padB); ctx.stroke();
    }
    for (let I = 0; I <= g.iMax; I += 1) {
      const y = yOfI(g, I);
      ctx.beginPath(); ctx.moveTo(g.padL, y); ctx.lineTo(g.W - g.padR, y); ctx.stroke();
    }
    /* 坐标轴 */
    ctx.strokeStyle = 'rgba(203,213,225,0.85)';
    ctx.lineWidth = 1.6 * d;
    ctx.beginPath();
    ctx.moveTo(g.padL, g.padT); ctx.lineTo(g.padL, g.H - g.padB); ctx.lineTo(g.W - g.padR, g.H - g.padB);
    ctx.stroke();
    ctx.fillStyle = '#94a3b8';
    ctx.font = (11 * d) + 'px Inter, "PingFang SC", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let R = 0; R <= g.rMax; R += 10) ctx.fillText(String(R), xOfR(g, R), g.H - g.padB + 6 * d);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let I = 0; I <= g.iMax; I += 1) ctx.fillText(String(I), g.padL - 6 * d, yOfI(g, I));
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillStyle = '#7dd3fc';
    ctx.fillText('I / A', 6 * d, 4 * d);
    ctx.textAlign = 'right';
    ctx.fillText('R / Ω', g.W - g.padR, g.H - g.padB + 6 * d);

    /* 曲线 I = U / R（按当前 U 画，电压一变整条曲线上下平移） */
    const U = state.U;
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.4 * d;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i <= 300; i++) {
      const R = 1.2 + (g.rMax - 1.2) * (i / 300);
      const I = U / R;
      if (I > g.iMax) continue;
      const x = xOfR(g, R), y = yOfI(g, I);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();

    /* 当前工作点（开关断开 ⇒ 电流掉到 0，工作点落到横轴上） */
    const Rtot = resistorTotal(state.mode, state.R);
    const I = state.closed ? totalCurrent(U, state.mode, state.R) : 0;
    const px = xOfR(g, clamp(Rtot, 0, g.rMax)), py = yOfI(g, clamp(I, 0, g.iMax));
    ctx.strokeStyle = 'rgba(253,186,116,0.65)';
    ctx.lineWidth = 1.4 * d;
    ctx.setLineDash([5 * d, 4 * d]);
    ctx.beginPath();
    ctx.moveTo(px, g.H - g.padB); ctx.lineTo(px, py); ctx.lineTo(g.padL, py);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#fdba74';
    ctx.beginPath(); ctx.arc(px, py, 5 * d, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#0a1727'; ctx.lineWidth = 1.6 * d; ctx.stroke();

    ctx.fillStyle = '#fdba74';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.font = 'bold ' + (11.5 * d) + 'px Inter, "PingFang SC", sans-serif';
    const tx = clamp(px + 9 * d, g.padL, g.W - g.padR - 150 * d);
    ctx.fillText('当前 ' + fmt(Rtot, 1) + ' Ω → ' + fmt(I, 2) + ' A', tx, py - 7 * d);
  }

  /* ---- 记录表 ---- */
  const records = [];
  function renderRecords() {
    const tb = $('records');
    if (!tb) return;
    if (!records.length) {
      tb.innerHTML = '<tr><td colspan="7" class="empty">还没有记录。调好电压和电阻，点「📌 记录当前数据」</td></tr>';
      setText($('summary'), '建议这样做：先只改电压（电阻不动）记三次；再只改电阻（电压不动）记三次；最后把接法换成串联、并联各记一次 —— 三组数据摆在一起，欧姆定律一眼就看出来了。');
      return;
    }
    let html = '';
    records.forEach((r, i) => {
      html += '<tr><td>' + (i + 1) + '</td><td>' + MODE_LABEL[r.mode] + '</td><td>' + fmt(r.U, 1) + '</td><td>' +
        fmt(r.R, 0) + '</td><td>' + fmt(r.Rtot, 1) + '</td><td>' + fmt(r.I, 2) + '</td><td>' + fmt(r.P, 2) + '</td><td>' +
        fmt(r.W, 1) + '</td></tr>';
    });
    tb.innerHTML = html;
    const last = records[records.length - 1];
    setText($('summary'), '最后一条：U = ' + fmt(last.U, 1) + ' V，R总 = ' + fmt(last.Rtot, 1) + ' Ω ⇒ I = ' + fmt(last.I, 2) +
      ' A。把相邻两条比一比：只改电压时 I/U 是不是同一个数？只改电阻时 I×R 是不是同一个数？');
  }
  function recordCurrent() {
    const Rtot = resistorTotal(state.mode, state.R);
    records.push({
      mode: state.mode, U: state.U, R: state.R, Rtot,
      I: totalCurrent(state.U, state.mode, state.R),
      P: powerOf(state.U, state.mode, state.R),
      W: state.W
    });
    renderRecords();
  }

  /* ==========================================================================
     十一、控制
     ========================================================================== */
  function setU(v) {
    const nv = clamp(Math.round(v / U_STEP) * U_STEP, U_MIN, U_MAX);
    if (Math.abs(nv - state.U) < 1e-9) return;
    state.U = +nv.toFixed(2);
    /* ★ 电压 = 落差 ⇒ 改电压必须重建几何（轨道高低、电阻坡长、电压箭头全都跟着变） */
    rebuildRoute(false);
    updateScene(); syncAll(); requestRender();
  }
  function setR(v) {
    const nv = clamp(Math.round(v), R_MIN, R_MAX);
    if (nv === state.R) return;
    state.R = nv;
    rebuildRoute(false);
    updateScene(); syncAll(); requestRender();
  }
  function setMode(m) {
    if (MODES.indexOf(m) < 0 || m === state.mode) return;
    state.mode = m;
    rebuildRoute(true);
    updateScene(); syncAll(); requestRender();
  }
  function setClosed(on) {
    state.closed = !!on;
    updateScene(); syncAll(); requestRender();
  }
  function resetWork() {
    state.t = 0; state.W = 0;
    syncAll(); requestRender();
  }

  function bind(id, fn) { const el = $(id); if (el) el.addEventListener('click', fn); }

  bind('powerBtn', () => setClosed(!state.closed));
  bind('barPower', () => setClosed(!state.closed));
  bind('uMinus', () => setU(state.U - U_STEP));
  bind('uPlus', () => setU(state.U + U_STEP));
  bind('rMinus', () => setR(state.R - 1));
  bind('rPlus', () => setR(state.R + 1));
  bind('barUMinus', () => setU(state.U - U_STEP));
  bind('barUPlus', () => setU(state.U + U_STEP));
  bind('barRMinus', () => setR(state.R - 1));
  bind('barRPlus', () => setR(state.R + 1));
  bind('resetWork', resetWork);
  bind('barResetWork', resetWork);
  bind('recBtn', recordCurrent);
  bind('clearRecords', () => { records.length = 0; renderRecords(); });
  bind('presetU3', () => setU(3));
  bind('presetU6', () => setU(6));
  bind('presetU9', () => setU(9));
  bind('presetR5', () => setR(5));
  bind('presetR10', () => setR(10));
  bind('presetR20', () => setR(20));

  document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  document.querySelectorAll('[data-bar-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.barMode)));
  document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => applyView(b.dataset.view)));

  const uRange = $('uRange');
  if (uRange) uRange.addEventListener('input', () => setU(+uRange.value));
  const rRange = $('rRange');
  if (rRange) rRange.addEventListener('input', () => setR(+rRange.value));

  const toggles = { chkElectrons: 'showElectrons', chkCurrent: 'showCurrent', chkVoltage: 'showVoltage', chkLabels: 'showLabels' };
  Object.keys(toggles).forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.checked = !!state[toggles[id]];
    el.addEventListener('change', () => {
      state[toggles[id]] = el.checked;
      updateScene(); syncAll(); requestRender();
    });
  });

  /* ---- 步骤卡 ---- */
  const STEPS = [
    { t: '01 认识电路：一条立体的坡道', d: '整条电路其实是一条<b>坡道</b>：下面那条轨是<b>低电势</b>，上面那条轨是<b>高电势</b>，<b>两条轨之间的高度差就是电压</b>。红色小球是导线里的<b>自由电子</b>；电源像一台<b>升降机</b>，把它们从低处搬到高处（绿色箭头）；电子再从高处沿着右边那条<b>锯齿电阻</b>滑下来，回到低处 —— 绕一圈，就是电流。' },
    { t: '02 增大电压：把落差拉大', d: '把电压从 1.5 V 调到 6 V、再到 9 V：<b>上下两条轨之间的落差明显变大</b>（紫色双箭头跟着变长），电子被抬得更高、冲下来更猛，电流表的读数跟着变大。这就是第一条路：<b>U 越大 ⇒ I 越大</b>（电阻不变时成正比）。' },
    { t: '03 减小电阻：把锯齿削平', d: '把电阻从 20 Ω 调到 10 Ω、再到 5 Ω：<b>锯齿越来越小、越来越平缓</b>，电子滑下来时磕碰变少，于是跑得更快、电流更大。第二条路：<b>R 越小 ⇒ I 越大</b>。' },
    { t: '04 两个电阻串联：落差被分掉', d: '换成<b>串联</b>：整个落差被<b>两段锯齿分掉</b>（中间是一段金色平台），每段只分到 <b>U/2</b>；路更长、磕碰更多 —— 相当于一个阻值是 <b>2R</b> 的大电阻。电子滑得更慢，电流只有原来的一半。' },
    { t: '05 两个电阻并联：两条坡各走一条', d: '换成<b>并联</b>：<b>两条锯齿坡各自跨满整个落差</b>（所以两条支路两端的电压相同），电子在右上角<b>分成两路</b>各走一条，到下端再汇合。总电阻变成 <b>R/2</b>，干路电流是原来的 <b>2 倍</b> —— 注意干路上的电子比每条支路上的<b>跑得快一倍</b>。' },
    { t: '06 电流做功', d: '电子从高处滑到低处，一路把<b>电势能</b>交给电阻，电能变成了内能：电阻会发热发亮（功率越大越亮）。<b>电功 W = UIt</b> —— 落差越大、电流越大、通电时间越长，电功越多。舞台右侧的「电功」读数一直在累加，点「⟲ 电功清零」重新开始。' }
  ];
  function setStep(i) {
    const s = STEPS[i];
    if (!s) return;
    document.querySelectorAll('#steps [data-step]').forEach((b) => b.classList.toggle('active', +b.dataset.step === i));
    const d = $('stepDetail');
    if (d) d.innerHTML = '<strong>' + s.t + '</strong><br>' + s.d;
  }
  document.querySelectorAll('#steps [data-step]').forEach((b) => b.addEventListener('click', () => setStep(+b.dataset.step)));

  /* ==========================================================================
     十二、主循环
     ========================================================================== */
  let dirty = true;
  function requestRender() { dirty = true; }
  /* ★ 重绘计数：自检用它判「画面到底动没动」——
     截图判不出来（截图会触发 ResizeObserver → requestRender，把冻死的画布"救活"一次）。 */
  let renderCount = 0, frameCount = 0;
  function renderNow() { renderer.render(scene, camera); dirty = false; renderCount++; }

  /* ==========================================================================
     十三、启动
     --------------------------------------------------------------------------
     ★ 必须排在【渲染循环之前】：循环的第一帧是同步跑的，route 还没装配的话
       stepFlow / updateCurrentArrows 会读到 null（症状 = 每帧一条 TypeError）。
     ========================================================================== */
  rebuildRoute(true);
  updateScene();
  updateCamera();
  resize();
  applyView('iso', true);
  renderRecords();
  setStep(0);
  syncAll();
  renderNow();

  function flowSpeeds() {
    if (!state.closed) return { vT: 0, vB: 0 };
    return {
      vT: visualSpeed(totalCurrent(state.U, state.mode, state.R)),
      vB: visualSpeed(branchCurrent(state.U, state.mode, state.R))
    };
  }
  /** 推进电子。返回 true 表示这一帧真的有电子在动（= 必须重绘） */
  function stepFlow(dt) {
    if (!route) return false;
    const { vT, vB } = flowSpeeds();
    if (vT <= 0 && vB <= 0) return false;
    for (const p of particles) {
      const v = (p.phase === 1) ? vB : vT;
      const ds = v * dt;
      if (ds <= 0) continue;
      const n = ds > 4 ? Math.ceil(ds / 4) : 1;
      for (let i = 0; i < n; i++) advance(p, ds / n);
    }
    return true;
  }
  let uiAcc = 0;
  function frameStep(dt) {
    frameCount++;
    /* ★★ 「几何在动」≠「画面在动」：这一句 requestRender() 曾经漏掉 ⇒
       电子在数据里跑得好好的（两秒能从 x=5 走到 x=52），画布却一直是第一帧，
       学生看到的是【完全静止的电路】。自检里 E12 就是守着这条的。 */
    const flowing = stepFlow(dt);
    if (state.closed) { state.t += dt; state.W += state.U * totalCurrent(state.U, state.mode, state.R) * dt; }
    if (flowing) {
      updateElectrons();      // 只刷电子实例矩阵，几何/箭头这些静态件不必每帧重算
      requestRender();
    }
    uiAcc += dt;
    if (uiAcc >= 0.1) { uiAcc = 0; syncAll(); }
    if (dirty) renderNow();
  }
  let last = performance.now();
  (function loop(now) {
    requestAnimationFrame(loop);
    const t = now || performance.now();
    let dt = (t - last) / 1000;
    last = t;
    if (!isNum(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, 0.1);
    frameStep(dt);
  })(last);
  /* 无头兜底：本机 headless 可能一次 rAF 都不回调 */
  setTimeout(() => { if (dirty) renderNow(); }, 1200);

  /* ==========================================================================
     十四、对外导出面（无头验收）
     --------------------------------------------------------------------------
     导出的都是【算这些量的函数本身】或【真正落笔的那一份几何】，
     不是另抄的快照 —— 自检若自己重抄一遍公式，把页面里改坏了照样全绿。
     ========================================================================== */
  window.__elab = {
    state, view, VIEWS, camera, renderer, scene, DRAWN,
    P: { U_MIN, U_MAX, U_DEF, U_STEP, R_MIN, R_MAX, R_DEF, SPEED_K, V_VIS_MIN, V_VIS_MAX, SPACING, E_R, AMP_K, PAR_X, ROAD_W, ROAD_T, ROAD_OFF, E_MAX, MODES, H_MIN, H_MAX, TEETH_ONE, TEETH_SER, XL, XR, ZF, ZB, BAT_R },
    loopHeight, layout,
    NODE, BAT,
    resistorTotal, totalCurrent, branchCurrent, powerOf, workOf, visualSpeed,
    ampOf, triWave, zigzagPts, parallelBranchPts,
    setU, setR, setMode, setClosed, resetWork, recordCurrent, records,
    applyView, updateCamera, resize, requestRender, renderNow, updateScene, syncAll, drawChart, chartGeom, xOfR, yOfI,
    get renderCount() { return renderCount; },
    get frameCount() { return frameCount; },
    stateChip, setStep, STEPS, MODE_LABEL,
    /* 路线信息：真正装配出来的那一条 */
    routeInfo() {
      return {
        mode: state.mode,
        branches: route.res.length,
        amp: DRAWN.amp,
        teeth: DRAWN.teeth,
        resLen: route.res.map((s) => s.len),
        resPoints: route.res.map((s) => s.pts.length),
        preLen: route.pre.map((s) => s.len),
        postLen: route.post.map((s) => s.len),
        totalParticles: particles.length,
        forkCounter
      };
    },
    /** 交出去的电子坐标就是【真正落笔的那一份】（updateElectrons 写进 InstancedMesh 的同一批） */
    electronPositions() { return DRAWN.electrons.map((e) => ({ x: e.x, y: e.y, z: e.z, phase: e.phase, branch: e.branch, idx: e.idx })); },
    /** 每一段的长度与名字（自检按段分组用） */
    stageLens() {
      const out = [];
      route.pre.forEach((s, i) => out.push({ phase: 0, idx: i, b: 0, name: s.name, len: s.len }));
      route.res.forEach((s, i) => out.push({ phase: 1, idx: 0, b: i, name: s.name, len: s.len }));
      route.post.forEach((s, i) => out.push({ phase: 2, idx: i, b: 0, name: s.name, len: s.len }));
      return out;
    },
    /** 某一段的折线点（真正装配出来的那一条） */
    stagePoints(phase, idx, b) {
      const st = phase === 0 ? route.pre[idx] : phase === 2 ? route.post[idx] : route.res[b || 0];
      return st ? st.pts.map((p) => ({ x: p[0], y: p[1], z: p[2] || 0 })) : null;
    },
    /** 点到最近路径点的距离（判「电子确实在导线上」） */
    distToPath(x, y, z) {
      let best = Infinity;
      const walk = (st) => {
        for (let i = 0; i < st.pts.length - 1; i++) {
          const a = st.pts[i], b2 = st.pts[i + 1];
          const ax = a[0], ay = a[1], az = a[2] || 0;
          const bx = b2[0], by = b2[1], bz = b2[2] || 0;
          const dx = bx - ax, dy = by - ay, dz = bz - az;
          const L2 = dx * dx + dy * dy + dz * dz;
          let t = L2 > 1e-12 ? ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / L2 : 0;
          t = clamp(t, 0, 1);
          const px = ax + dx * t, py = ay + dy * t, pz = az + dz * t;
          const d = Math.hypot(x - px, y - py, z - pz);
          if (d < best) best = d;
        }
      };
      for (const st of route.pre) walk(st);
      for (const st of route.res) walk(st);
      for (const st of route.post) walk(st);
      return best;
    },
    /** 直接读 InstancedMesh 的实例矩阵（与 DRAWN.electrons 对撞用） */
    instancePositions() {
      const out = [];
      for (let i = 0; i < electronMesh.count; i++) {
        electronMesh.getMatrixAt(i, _m4);
        const p = new THREE.Vector3().setFromMatrixPosition(_m4);
        out.push({ x: p.x, y: p.y, z: p.z });
      }
      return out;
    },
    particleInfo() {
      return particles.map((p) => ({ phase: p.phase, idx: p.idx, b: p.b, s: p.s }));
    },
    /** 按固定步长喂帧，走的是与真实循环同一个 frameStep */
    driveAnim(seconds, dt = 1 / 60) {
      const n = Math.max(1, Math.round(seconds / dt));
      for (let i = 0; i < n; i++) frameStep(dt);
      /* ★ 收尾必须把读数刷到位：frameStep 里的 syncAll 每 0.1 s 才跑一次，
         跑完立刻读 DOM 会拿到【上一拍】的旧值（实测电功差 0.2 J）。 */
      syncAll();
      renderNow();
      return { frames: n, t: state.t, W: state.W, closed: state.closed, fsLayouts: state.fsLayouts };
    },
    /** 只推电子、不推进时间/电功（量几何用） */
    advanceFlow(seconds, dt = 1 / 120) {
      const n = Math.max(1, Math.round(seconds / dt));
      for (let i = 0; i < n; i++) stepFlow(dt);
      updateScene();
      syncAll();
      return { particles: particles.length, forkCounter };
    },
    /** 屏幕坐标（CSS 像素，原点左上）—— 用于像素腿定位 */
    screenOf(x, y, z) {
      const v = new THREE.Vector3(x, y, z).project(camera);
      const gl = renderer.getContext();
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const pr = renderer.getPixelRatio();
      return { x: (v.x * 0.5 + 0.5) * w / pr, y: (1 - (v.y * 0.5 + 0.5)) * h / pr, ndcZ: v.z };
    },
    /** 取景两条腿：内容在画框里的占比 */
    contentRect() {
      const gl = renderer.getContext();
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const v = new THREE.Vector3();
      const box = new THREE.Box3();
      root.updateWorldMatrix(true, true);
      root.traverse((o) => {
        if (!o.isMesh || !o.visible) return;
        box.setFromObject(o, true);
        if (box.isEmpty()) return;
        for (let i = 0; i < 8; i++) {
          v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
          v.project(camera);
          const sx = (v.x * 0.5 + 0.5) * W, sy = (v.y * 0.5 + 0.5) * H;
          if (sx < x0) x0 = sx; if (sx > x1) x1 = sx;
          if (sy < y0) y0 = sy; if (sy > y1) y1 = sy;
        }
      });
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, W, H };
    },
    /** 画布像素采样（renderer.render 之后同步 readPixels） */
    sampleRegion(x0, y0, x1, y1) {
      renderNow();
      const gl = renderer.getContext();
      const pr = renderer.getPixelRatio();
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
      const px0 = clamp(Math.round(x0 * pr), 0, W - 1);
      const px1 = clamp(Math.round(x1 * pr), 0, W);
      const py0 = clamp(Math.round((H / pr - y1) * pr), 0, H - 1);
      const py1 = clamp(Math.round((H / pr - y0) * pr), 0, H);
      const w = Math.max(1, px1 - px0), h = Math.max(1, py1 - py0);
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(px0, py0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      let r = 0, g = 0, b = 0, n = w * h;
      for (let i = 0; i < n; i++) { r += buf[i * 4]; g += buf[i * 4 + 1]; b += buf[i * 4 + 2]; }
      return { r: r / n, g: g / n, b: b / n, lum: (0.2126 * r + 0.7152 * g + 0.0722 * b) / n, w, h };
    },
    /** 藏掉一组对象再渲染，返回整屏差分像素数 */
    pixelDiff(hideFn) {
      const snap = () => {
        renderNow();
        const gl = renderer.getContext();
        const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
        const buf = new Uint8Array(W * H * 4);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        return buf;
      };
      const a = snap();
      hideFn();
      const b = snap();
      hideFn();
      let diff = 0;
      for (let i = 0; i < a.length; i += 4) {
        if (Math.abs(a[i] - b[i]) > 8 || Math.abs(a[i + 1] - b[i + 1]) > 8 || Math.abs(a[i + 2] - b[i + 2]) > 8) diff++;
      }
      return diff;
    },
    electronMesh, root, lever, voltGroup, currentArrowGroup, labelGroup, forceArrows, switchGroup, wireGroup, MAT
  };
})();
