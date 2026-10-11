/*!
 * bulb-lab.js —— 「小灯泡发光的原理」3D 实验台（真 WebGL / three.js）
 * ==================================================================
 * 这一页只讲一件事：**电流到底怎么从灯泡里走过去的**。
 *
 * 学生的痛点：小灯泡是个「黑盒子」——两根导线接在灯座上，灯就亮了，
 * 中间到底发生了什么？灯泡里面有什么？为什么拧紧就亮、拧松就不亮？
 *
 * 所以这一页把灯泡**拆开**（透视 / 剖面 / 分解三种看法），把电流路径
 * 从头到尾画出来，并且**让电荷真的沿着这条路流**：
 *
 *   电源正极 → 导线 → 灯座「+」接线柱 → 灯座底板里的金属条
 *   → 灯座螺纹弹片 → 灯泡螺纹壳 → 焊点 → 引线① →（穿过玻璃芯柱）
 *   → 灯丝 → 引线② →（穿过玻璃芯柱）→ 中心触点 → 灯座中心弹片
 *   → 底板里的金属条 → 灯座「−」接线柱 → 导线 → 闸刀开关 → 电源负极
 *
 * 关键认知（页面里反复强调）：
 *   ① 螺纹壳和中心触点是灯泡的**两个电极**，它们之间只隔着**灯丝**；
 *   ② 电流**必须**从灯丝里过去，没有第二条路（短路就是把灯丝旁路掉）；
 *   ③ 灯丝是唯一「电阻大、会发热」的地方 ⇒ 发热到白炽状态就发光；
 *   ④ 灯丝电阻随温度升高而变大 ⇒ 开灯瞬间电流特别大（冷态电阻小）。
 *
 * 单值真源（几何、路径、标注、自检读同一份）：
 *   DIM  —— 全部尺寸常量（cm）
 *   PATH_SEGMENTS —— 电流路径折线（含「灯丝内部」逐点采样）
 *   thermal —— 灯丝热模型（温度 → 电阻 → 电流 → 亮度 → 颜色）
 *
 * 依赖：assets/optics-three.min.js（页面用 <script type="module"> 引本文件）
 */

import * as THREE from './assets/optics-three.min.js';

/* ==================================================================
 *  0. 尺寸常量（单位：cm。全部几何与电流路径都只认这一份）
 * ================================================================== */
export const DIM = {
  tableY: 0,

  /* 灯座（小灯座：底板 + 座体 + 两个接线柱） */
  base:    { w: 7.20, d: 4.20, h: 0.50 },          // 底板，顶面 y = 0.50
  socket:  { rOut: 1.22, y0: 0.50, y1: 2.10 },
  spring:  { r: 1.06, tube: 0.038, y0: 1.10, y1: 2.06, pitch: 0.22 },  // 螺纹弹片
  cspring: { r0: 0.50, r1: 0.30, y0: 0.50, y1: 0.92 },                 // 中心弹片
  post:    { x: 2.60, r: 0.26, y0: 0.50, y1: 1.62, capR: 0.40 },       // 接线柱
  barY:    0.34,                                   // 底板内金属条高度
  barHalf: 0.08,

  /* 小灯泡 */
  bulb: {
    shell:  { rOut: 0.95, y0: 1.42, y1: 2.95, ridgeR: 0.96, tube: 0.050, pitch: 0.22 },
    insul:  { r: 0.90, y0: 1.20, y1: 1.42 },
    center: { r: 0.42, y0: 0.78, y1: 1.20 },
    stem:   { r: 0.26, y0: 1.05, y1: 3.55 },
    glass:  { yTop: 6.35, rMax: 1.52, yC: 4.80, neckY0: 2.95 },
    weldY:  2.85,                                    // 引线焊在螺纹壳内壁的高度
    weldR:  0.90,
    leadA: [[-0.90, 2.85, 0], [-0.13, 2.85, 0], [-0.13, 3.55, 0], [-0.30, 3.78, 0], [-0.30, 5.18, 0]],
    leadB: [[0, 1.05, 0], [0, 2.52, 0], [0.13, 2.68, 0], [0.13, 3.55, 0], [0.30, 3.78, 0], [0.30, 5.18, 0]],
    coil:   { x0: -0.30, x1: 0.30, y: 5.05, r: 0.13, turns: 6, wire: 0.028, gapT: 0.035 },
    unseatLift: 0.36,                                // 完全拧松时抬起的高度
  },

  /* 电源（电池盒）与开关 —— 电池摆在左后方，不挡灯泡；开关在右后方 */
  battery: { w: 4.60, h: 1.90, d: 2.60, x: -5.60, z: -4.40, postX: 1.45, postY: 2.35, r: 0.24 },
  sw:      { x: 2.15, z: -3.40, lx: 1.55, rx: 2.75, y: 0.75, blade: 1.20, open: 0.92 },

  wireR: 0.085,
};

/* 接线柱 / 电池极性的位置（左 = 正，右 = 负）——与电流方向一致 */
export const POLARITY = { socketPlus: -1, socketMinus: 1, battPlus: -1, battMinus: 1 };

/* ==================================================================
 *  1. 灯泡规格 + 灯丝热模型
 * ================================================================== */
export const BULB_SPECS = [
  { id: '2.5V-0.3A', label: '2.5 V　0.3 A（实验室小灯泡）', U: 2.5, I: 0.30 },
  { id: '3.8V-0.3A', label: '3.8 V　0.3 A（手电筒灯泡）', U: 3.8, I: 0.30 },
  { id: '6.0V-0.5A', label: '6.0 V　0.5 A（大一点的小灯泡）', U: 6.0, I: 0.50 },
];

export const PHYS = {
  Tamb: 293,          // 室温 K
  T_rated: 2700,      // 额定电压下的灯丝温度 K（白炽状态）
  alpha: 0.0045,      // 钨的电阻温度系数 1/K
  TBURN: 3200,        // 超过这个温度灯丝就烧断
  tau: 0.08,          // 灯丝热时间常数（s）—— 决定「开灯闪一下」有多快
  fNonRad: 0.22,      // 额定工况下「非辐射散热（引线导热 + 对流）」占的比例
  Tglow: 780,         // 开始看得出红光的温度
  subSteps: 24,
};

export function specById(id) {
  for (var i = 0; i < BULB_SPECS.length; i++) if (BULB_SPECS[i].id === id) return BULB_SPECS[i];
  return BULB_SPECS[0];
}

/* 由 (额定电压, 额定电流) 反推热模型的全部常数 —— 保证额定工况严格落在 T_rated。
 * 散热 = 辐射 k4·(T⁴−Tamb⁴) + 导热/对流 k1·(T−Tamb)。
 * 只有辐射项的话，低温时散热小到几乎为零 ⇒ 灯丝「熄了还烫很久」，不真实；
 * 加上 k1 以后冷却时间常数 ≈ τ_cool = C/k1 ≈ 1 s，和真实小灯泡一个量级。 */
export function makeThermal(spec) {
  var Tamb = PHYS.Tamb, Tr = PHYS.T_rated, a = PHYS.alpha, f = PHYS.fNonRad;
  var Rrated = spec.U / spec.I;
  var Rcold = Rrated / (1 + a * (Tr - Tamb));
  var Prated = spec.U * spec.I;
  var k4 = (Prated / (1 + f)) / (Math.pow(Tr, 4) - Math.pow(Tamb, 4));
  var k1 = (Prated * f / (1 + f)) / (Tr - Tamb);
  var C = PHYS.tau * (4 * k4 * Math.pow(Tr, 3) + k1);
  return {
    spec: spec, Tamb: Tamb, Tr: Tr, alpha: a,
    Rrated: Rrated, Rcold: Rcold, k4: k4, k1: k1, C: C,
    T: Tamb, burned: false,
  };
}

export function resistanceAt(th, T) { return th.Rcold * (1 + th.alpha * (T - th.Tamb)); }
export function lossAt(th, T) {
  return th.k4 * (Math.pow(T, 4) - Math.pow(th.Tamb, 4)) + th.k1 * (T - th.Tamb);
}

/* 一步热演化：电功率 → 升温；辐射 + 导热 → 降温。显式欧拉 + 子步（稳定性由 tau 保证）。 */
export function thermalStep(th, U, dt) {
  if (!(dt > 0)) return;
  if (dt > 0.06) dt = 0.06;                       // 掉帧时别一步跳过去
  var n = PHYS.subSteps, h = dt / n, i, T = th.T;
  for (i = 0; i < n; i++) {
    if (th.burned) {
      T += (th.Tamb - T) * Math.min(1, h / 0.22);
      continue;
    }
    var R = resistanceAt(th, T);
    var P = (U * U) / R;
    T += ((P - lossAt(th, T)) / th.C) * h;
    if (!isFinite(T)) T = th.Tamb;
    if (T < th.Tamb) T = th.Tamb;
    if (T > 6000) T = 6000;
  }
  th.T = T;
  if (!th.burned && T >= PHYS.TBURN) th.burned = true;
  return T;
}

export function currentOf(th, U) { return th.burned ? 0 : U / resistanceAt(th, th.T); }
export function powerOf(th, U) { var I = currentOf(th, U); return U * I; }

/* 相对亮度：以「额定工况」为 1.0，按 Stefan–Boltzmann 四次方律（低于 Tglow 视为不亮） */
export function brightnessOf(T) {
  var a = Math.pow(PHYS.Tglow, 4), b = Math.pow(PHYS.T_rated, 4);
  if (T <= PHYS.Tglow) return 0;
  var v = (Math.pow(Math.min(T, 6000), 4) - a) / (b - a);
  return Math.max(0, Math.min(2.2, v));
}

/* 黑体色温 → RGB（Tanner Helland 近似）。灯丝温度决定「什么颜色」。 */
export function blackbodyRGB(T) {
  var t = Math.max(800, Math.min(12000, T)) / 100, r, g, b;
  if (t <= 66) { r = 255; } else { r = 329.698727446 * Math.pow(t - 60, -0.1332047592); }
  if (t <= 66) { g = 99.4708025861 * Math.log(t) - 161.1195681661; }
  else { g = 288.1221695283 * Math.pow(t - 60, -0.0755148492); }
  if (t >= 66) { b = 255; } else if (t <= 19) { b = 0; }
  else { b = 138.5177312231 * Math.log(t - 10) - 305.0447927307; }
  var cl = function (v) { return Math.max(0, Math.min(255, v)) / 255; };
  return [cl(r), cl(g), cl(b)];
}

/* ==================================================================
 *  2. 电流路径（唯一真值）
 *     每段是 { pts:[[x,y,z]...], inBulb:bool, seg:'名字' }
 *     inBulb = 这一段跟着灯泡一起转/抬（拧松时灯泡会转出来）
 * ================================================================== */
function helixPts(r, y0, y1, pitch, a0, dir) {
  var out = [], turns = (y1 - y0) / pitch, n = Math.max(4, Math.round(turns * 10)), i;
  for (i = 0; i <= n; i++) {
    var t = i / n, a = a0 + (dir || 1) * turns * Math.PI * 2 * t;
    out.push([r * Math.cos(a), y0 + (y1 - y0) * t, r * Math.sin(a)]);
  }
  return out;
}

/* 灯丝：绕 X 轴的螺旋。t∈[0,1] 从 x0 走到 x1；t=0/1 两端相位相同 ⇒ 落在同一个 y 上。 */
export function coilPoint(t) {
  var c = DIM.bulb.coil;
  var x = c.x0 + (c.x1 - c.x0) * t, a = c.turns * Math.PI * 2 * t;
  return [x, c.y + c.r * Math.cos(a), c.r * Math.sin(a)];
}
function coilPts(t0, t1, n) {
  var out = [], i;
  for (i = 0; i <= n; i++) out.push(coilPoint(t0 + (t1 - t0) * (i / n)));
  return out;
}

function buildPathSegments() {
  var B = DIM.bulb, S = DIM.socket, P = DIM.post, sp = DIM.spring, bat = DIM.battery, sw = DIM.sw;
  var segs = [];
  var plus = POLARITY.socketPlus * P.x, minus = POLARITY.socketMinus * P.x;
  var bplus = bat.x + POLARITY.battPlus * bat.postX, bminus = bat.x + POLARITY.battMinus * bat.postX;

  /* ① 电源正极 → 导线 → 灯座「+」柱 */
  segs.push({ seg: '导线1', inBulb: false, pts: [
    [bplus, bat.postY, bat.z],
    [bplus + 0.60, 2.02, bat.z + 1.05],
    [bplus + 2.45, 2.48, bat.z + 2.90],
    [plus + 0.78, 2.10, -0.62],
    [plus, P.y1, 0],
  ] });
  /* ② 「+」柱 → 底板金属条 → 螺纹弹片底部 */
  segs.push({ seg: '底板金属条(正)', inBulb: false, pts: [
    [plus, P.y1, 0], [plus, DIM.barY, 0], [plus * 0.424, DIM.barY, 0], [-sp.r, DIM.barY, 0], [-sp.r, sp.y0, 0],
  ] });
  /* ③ 螺纹弹片（螺旋上行）——电流从这里交给灯泡的螺纹壳 */
  segs.push({ seg: '螺纹弹片', inBulb: false, pts: helixPts(sp.r, sp.y0, sp.y1, sp.pitch, Math.PI, 1) });
  /* ④ 灯泡螺纹壳（外壁上行 → 焊点） */
  segs.push({ seg: '螺纹壳', inBulb: true, pts: [
    [-sp.r, sp.y1, 0], [-B.shell.rOut - 0.01, sp.y1, 0], [-B.shell.rOut - 0.01, B.weldY, 0], [-B.weldR, B.weldY, 0],
  ] });
  /* ⑤ 引线①（焊在螺纹壳上）→ 灯丝左端 */
  segs.push({ seg: '引线1', inBulb: true, pts: B.leadA });
  /* ⑥ 灯丝 */
  segs.push({ seg: '灯丝', inBulb: true, pts: coilPts(0, 1, 36) });
  /* ⑦ 引线② → 中心触点 */
  segs.push({ seg: '引线2', inBulb: true, pts: B.leadB.slice().reverse() });
  /* ⑧ 中心触点 → 中心弹片 → 底板金属条 → 「−」柱 */
  segs.push({ seg: '中心触点', inBulb: true, pts: [[0, B.center.y1, 0], [0, B.center.y0, 0]] });
  segs.push({ seg: '中心弹片', inBulb: false, pts: [
    [0, B.center.y0 + 0.02, 0], [0, DIM.cspring.y1, 0], [0, DIM.cspring.y0, 0], [0, DIM.barY, 0],
    [minus * 0.424, DIM.barY, 0], [minus, DIM.barY, 0], [minus, P.y1, 0],
  ] });
  /* ⑨ 「−」柱 → 导线 → 闸刀开关 → 电源负极 */
  segs.push({ seg: '导线2', inBulb: false, pts: [
    [minus, P.y1, 0],
    [minus + 0.42, 2.28, -1.65],
    [minus + 0.30, 1.30, -2.85],
    [sw.rx, sw.y, sw.z],
    [sw.lx, sw.y, sw.z],
    [sw.lx - 1.20, 1.32, sw.z - 1.15],
    [bminus + 1.85, 2.05, bat.z - 0.32],
    [bminus, bat.postY, bat.z],
  ] });
  return segs;
}

export const PATH_SEGMENTS = buildPathSegments();

/* ==================================================================
 *  3. 场景
 * ================================================================== */
var canvas, renderer, scene, camera3, bulbGroup, parts = {}, clippable = [], flowGroup, labelGroup, halo, keyLight;

export const state = {
  specId: BULB_SPECS[0].id,
  voltage: 2.5,
  switchOn: true,
  unscrew: 0,            // 0 = 拧到底；100 = 完全拧出来
  mode: 'solid',         // solid | xray | cut | explode
  view: 'angle',
  showLabels: true,
  showFlow: true,
  flowSpeed: 0,
  glassOpacity: 0.62,
  shellOpacity: 1.0,
  socketOpacity: 1.0,
  cutAmt: 0,
  explode: 0,
  burnedFlash: 0,
};

export const thermal = makeThermal(specById(state.specId));

/* 拧松到多少就断开（中心触点脱离） */
export const UNSCREW_OPEN = 55;
export function isContactOk() { return state.unscrew < UNSCREW_OPEN; }

/* ---- 相机 ---- */
export const cam = { yaw: 0.40, pitch: 0.19, dist: 15.1, tx: 0, ty: 2.82, tz: -0.55, fov: 42 };

/* 注意 yaw 取【正】值 ⇒ 相机在 +x 侧 ⇒ 世界 +x 落在画面【右侧】。
 * 页面标注是按「左 = 接线柱+ / 右 = 接线柱−」摆的，yaw 取负会把左右镜像，
 * 学生看到的「+」柱就会跑到右边 —— 出图复看抓到的第一处。 */
const VIEWS = {
  angle:   { yaw: 0.40, pitch: 0.19, dist: 15.1, ty: 2.82, tz: -0.55 },
  front:   { yaw: 0.00, pitch: 0.06, dist: 15.4, ty: 3.15, tz: 0.00 },
  side:    { yaw: Math.PI / 2, pitch: 0.10, dist: 15.4, ty: 3.15, tz: 0.00 },
  top:     { yaw: 0.34, pitch: 0.72, dist: 15.8, ty: 2.30, tz: -0.30 },
  closeup: { yaw: 0.34, pitch: 0.10, dist: 4.7, ty: 5.05, tz: 0.00 },
};

/* ---- 材质（单独持有需要改透明度/裁剪的那些） ---- */
function mat(color, opts) { return new THREE.MeshStandardMaterial(Object.assign({ color: color, metalness: 0.4, roughness: 0.42 }, opts || {})); }

var M = {
  chrome:  mat(0xd8e2ec, { metalness: 0.95, roughness: 0.13 }),
  brass:   mat(0xd3ac52, { metalness: 0.9, roughness: 0.3 }),
  steel:   mat(0x9fadbd, { metalness: 0.86, roughness: 0.3 }),
  zinc:    mat(0xc3ccd6, { metalness: 0.72, roughness: 0.44 }),
  bakelite: mat(0x33425a, { metalness: 0.25, roughness: 0.62 }),
  plastic: mat(0xdbe2ea, { metalness: 0.05, roughness: 0.74 }),
  wire:    mat(0x8b3a2f, { metalness: 0.16, roughness: 0.66 }),
  postPos: mat(0xdc2626, { metalness: 0.35, roughness: 0.45 }),
  postNeg: mat(0x1f2a3a, { metalness: 0.42, roughness: 0.5 }),
  table:   mat(0x16263a, { metalness: 0.15, roughness: 0.9 }),
};

/* 会随模式改透明度的三件（各自独立材质，绝不共享） */
var glassMat, shellMat, socketMat, insulMat, stemMat;

/* ---- 小工具 ---- */
function cyl(rt, rb, h, seg, m) { return new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 24), m); }
function box(w, h, d, m) { return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); }
function put(o, x, y, z) { o.position.set(x, y, z); return o; }

class PolyCurve extends THREE.Curve {
  constructor(pts) {
    super();
    this.pts = pts.map(function (p) { return Array.isArray(p) ? new THREE.Vector3(p[0], p[1], p[2]) : p.clone(); });
    this.lens = [0];
    var L = 0, i;
    for (i = 1; i < this.pts.length; i++) { L += this.pts[i].distanceTo(this.pts[i - 1]); this.lens.push(L); }
    this.total = L || 1e-6;
  }
  getPoint(t, target) {
    target = target || new THREE.Vector3();
    var d = Math.max(0, Math.min(1, t)) * this.total, i = 1;
    while (i < this.lens.length && this.lens[i] < d) i++;
    if (i >= this.lens.length) return target.copy(this.pts[this.pts.length - 1]);
    var seg = this.lens[i] - this.lens[i - 1] || 1e-6;
    return target.copy(this.pts[i - 1]).lerp(this.pts[i], (d - this.lens[i - 1]) / seg);
  }
}
class CoilCurve extends THREE.Curve {
  constructor(t0, t1) { super(); this.t0 = t0; this.t1 = t1; }
  getPoint(t, target) {
    target = target || new THREE.Vector3();
    var p = coilPoint(this.t0 + (this.t1 - this.t0) * t);
    return target.set(p[0], p[1], p[2]);
  }
}
function tubeOf(pts, radius, mat_, seg) {
  var cur = new PolyCurve(pts);
  var g = new THREE.TubeGeometry(cur, Math.max(8, (seg || 2) * (pts.length - 1)), radius, 8, false);
  return new THREE.Mesh(g, mat_);
}

/* ---- 文字标注（Sprite，永远正对镜头） ---- */
export function makeLabel(text, color) {
  var c = document.createElement('canvas'), fs = 46, g = c.getContext('2d');
  var font = 'bold ' + fs + 'px -apple-system,"PingFang SC",sans-serif';
  g.font = font;
  var tw = Math.ceil(g.measureText(text).width);
  c.width = tw + 34; c.height = fs + 26;
  g = c.getContext('2d'); g.font = font;
  g.fillStyle = 'rgba(3,8,20,0.82)';
  var r = 14;
  g.beginPath();
  g.moveTo(r, 1); g.lineTo(c.width - r, 1); g.quadraticCurveTo(c.width - 1, 1, c.width - 1, r);
  g.lineTo(c.width - 1, c.height - r); g.quadraticCurveTo(c.width - 1, c.height - 1, c.width - r, c.height - 1);
  g.lineTo(r, c.height - 1); g.quadraticCurveTo(1, c.height - 1, 1, c.height - r);
  g.lineTo(1, r); g.quadraticCurveTo(1, 1, r, 1); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(125,211,252,0.55)'; g.lineWidth = 2; g.stroke();
  g.fillStyle = color || '#e6f1ff';
  g.textBaseline = 'middle'; g.textAlign = 'center';
  g.fillText(text, c.width / 2, c.height / 2 + 2);
  var tex = new THREE.CanvasTexture(c);
  if (THREE.SRGBColorSpace && 'colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
  var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
  sp.renderOrder = 20;
  var sc = 0.55;
  sp.scale.set(sc * c.width / c.height, sc, 1);
  sp.userData.text = text;
  return sp;
}

/* ---- 光晕贴图（软边圆形，radial-gradient） ---- */
function haloTexture() {
  var c = document.createElement('canvas'); c.width = c.height = 256;
  var g = c.getContext('2d');
  var gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0.00, 'rgba(255,255,255,1)');
  gr.addColorStop(0.16, 'rgba(255,240,205,0.72)');
  gr.addColorStop(0.42, 'rgba(255,200,120,0.24)');
  gr.addColorStop(1.00, 'rgba(255,180,80,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  var tex = new THREE.CanvasTexture(c);
  if (THREE.SRGBColorSpace && 'colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ==================================================================
 *  4. 建几何
 * ================================================================== */
/* 标注位置：相机在 +x 侧 ⇒ 世界 +x 在画面右侧。
 * 左列 = 接线柱「+」一侧（电流入口）；右列 = 接线柱「−」一侧。
 * 位置是出图复看后逐个错开的（相邻标注的包围盒不许重叠）。
 * eg = 这一件属于哪个「分解组」—— 分解时标注跟着零件一起走；没有 eg 的是环境件，
 *      分解时连零件带标注一起收起来（否则会指着一片空处）。 */
var LABELS = [
  { t: '玻璃泡', p: [2.70, 6.62, 0.0], a: [1.20, 6.00, 0.0], eg: 'glass' },
  { t: '灯丝', p: [3.42, 5.42, 0.0], a: [0.42, 5.10, 0.0], eg: 'inner' },
  { t: '引线', p: [3.16, 4.26, 0.0], a: [0.30, 4.15, 0.0], eg: 'inner' },
  { t: '接线柱「−」', p: [4.62, 2.88, 0.0], a: [2.60, 1.70, 0.0] },
  { t: '中心触点', p: [2.62, 1.16, 0.0], a: [0.44, 1.00, 0.0], eg: 'insul' },
  { t: '玻璃芯柱', p: [-2.96, 3.96, 0.0], a: [-0.28, 3.35, 0.0], eg: 'stem' },
  { t: '螺纹壳', p: [-3.52, 2.96, 0.0], a: [-0.97, 2.62, 0.0], eg: 'shell' },
  { t: '绝缘环', p: [-3.96, 1.96, 0.0], a: [-0.90, 1.31, 0.0], eg: 'insul' },
  { t: '灯座', p: [-4.32, 1.00, 0.0], a: [-1.35, 1.75, 0.0] },
  { t: '接线柱「+」', p: [-5.90, 1.46, 0.0], a: [-2.60, 1.70, 0.0] },
  { t: '电源', p: [-5.60, 4.02, -4.40], a: [-5.60, 2.10, -4.40] },
];

/* 分解时各组沿 Y 的位移（cm）：从下往上依次抬开，相邻留 0.24 cm 缝。
 * 数值是按「零件的实际上下端」算的，不是随手写的增量 —— 改任何一件的尺寸都要重算。 */
var EXPLODE_OFF = { insul: -0.68, shell: -0.44, stem: 1.70, inner: 4.44, glass: 6.91 };

function buildTable() {
  var g = new THREE.Group();
  g.add(put(box(30, 0.7, 26, M.table), 0, -0.35, -3));
  g.userData.role = 'table';
  return g;
}

function buildSocket() {
  var S = DIM.socket, B = DIM.base, P = DIM.post, g = new THREE.Group();
  g.userData.role = 'socket';

  /* 底板 */
  var plate = box(B.w, B.h, B.d, M.bakelite);
  g.add(put(plate, 0, B.h / 2, 0));

  /* 座体（开口圆筒，双面） */
  socketMat = new THREE.MeshStandardMaterial({
    color: 0x33425a, metalness: 0.25, roughness: 0.62, side: THREE.DoubleSide,
    transparent: true, opacity: 1.0,
  });
  var body = new THREE.Mesh(new THREE.CylinderGeometry(S.rOut, S.rOut, S.y1 - S.y0, 40, 1, true), socketMat);
  g.add(put(body, 0, (S.y0 + S.y1) / 2, 0));
  var bottom = new THREE.Mesh(new THREE.RingGeometry(0.001, S.rOut, 40), M.bakelite);
  bottom.rotation.x = -Math.PI / 2;
  g.add(put(bottom, 0, S.y0 + 0.005, 0));

  /* 螺纹弹片（内壁螺旋） */
  var sp = DIM.spring;
  g.add(tubeOf(helixPts(sp.r, sp.y0, sp.y1, sp.pitch, Math.PI, 1), sp.tube, M.brass, 3));
  /* 螺纹弹片 → 底板金属条的立柱 */
  g.add(put(cyl(0.07, 0.07, sp.y0 - DIM.barY, 10, M.brass), -sp.r, (sp.y0 + DIM.barY) / 2, 0));

  /* 中心弹片（小锥形弹簧） */
  var cs = DIM.cspring;
  g.add(put(cyl(cs.r1, cs.r0, cs.y1 - cs.y0, 22, M.brass), 0, (cs.y0 + cs.y1) / 2, 0));
  g.add(put(cyl(0.09, 0.09, cs.y0 - DIM.barY, 10, M.brass), 0, (cs.y0 + DIM.barY) / 2, 0));

  /* 底板内金属条（正 → 螺纹弹片 / 负 → 中心弹片），藏在底板里，剖面才看得见 */
  var plus = POLARITY.socketPlus * P.x, minus = POLARITY.socketMinus * P.x;
  var b1 = box(Math.abs(plus) - DIM.spring.r, DIM.barHalf * 2, DIM.barHalf * 2, M.brass);
  g.add(put(b1, (plus - DIM.spring.r) / 2, DIM.barY, 0));
  var b2 = box(Math.abs(minus), DIM.barHalf * 2, DIM.barHalf * 2, M.brass);
  g.add(put(b2, minus / 2, DIM.barY, 0));

  /* 两个接线柱 */
  [-1, 1].forEach(function (s) {
    var x = s * P.x, m = s === POLARITY.socketPlus ? M.postPos : M.postNeg;
    g.add(put(cyl(P.r, P.r, P.y1 - P.y0, 16, m), x, (P.y0 + P.y1) / 2, 0));
    g.add(put(cyl(P.capR, P.capR, 0.16, 20, m), x, P.y1 + 0.05, 0));
    g.add(put(cyl(0.09, 0.09, P.y1 - DIM.barY, 10, M.brass), x, (P.y1 + DIM.barY) / 2, 0));
  });
  return g;
}

function buildBulb() {
  var B = DIM.bulb, g = new THREE.Group();
  g.userData.role = 'bulb';
  var bp = {};
  parts.bulbParts = bp;

  /* 每个「会被分解挪走」的部件各套一个空组：组内坐标 = 绝对坐标，挪组即可 */
  var grp = function (role) { var x = new THREE.Group(); x.userData.role = role; g.add(x); return x; };
  var gShell = grp('shellGrp');
  var gInsul = grp('insulGrp');
  var gStem = grp('stemGrp');
  var gInner = grp('innerGrp');
  var gGlass = grp('glassGrp');
  parts.shellGrp = gShell; parts.insulGrp = gInsul; parts.stem = gStem; parts.innerGrp = gInner; parts.glassGrp = gGlass;

  /* ── 螺纹壳（金属，灯泡的一个电极） ── */
  shellMat = new THREE.MeshStandardMaterial({
    color: 0xd8e2ec, metalness: 0.94, roughness: 0.16, side: THREE.DoubleSide,
    transparent: true, opacity: 1.0,
  });
  var shell = new THREE.Mesh(new THREE.CylinderGeometry(B.shell.rOut, B.shell.rOut, B.shell.y1 - B.shell.y0, 36, 1, true), shellMat);
  gShell.add(put(shell, 0, (B.shell.y0 + B.shell.y1) / 2, 0));
  var shTop = new THREE.Mesh(new THREE.RingGeometry(B.shell.rOut - 0.14, B.shell.rOut, 36), shellMat);
  shTop.rotation.x = -Math.PI / 2; gShell.add(put(shTop, 0, B.shell.y1, 0));
  var shBot = new THREE.Mesh(new THREE.RingGeometry(0.44, B.shell.rOut, 36), shellMat);
  shBot.rotation.x = -Math.PI / 2; gShell.add(put(shBot, 0, B.shell.y0, 0));
  /* 螺纹牙 */
  var ridge = tubeOf(helixPts(B.shell.ridgeR, B.shell.y0 + 0.08, B.shell.y1 - 0.06, B.shell.pitch, Math.PI, 1),
    B.shell.tube, shellMat, 3);
  ridge.userData.role = 'threadRidge';
  gShell.add(ridge);
  bp.shell = shell; bp.ridge = ridge;

  /* ── 绝缘环（把螺纹壳和中心触点隔开） ── */
  insulMat = new THREE.MeshStandardMaterial({ color: 0x1d2735, metalness: 0.1, roughness: 0.75, transparent: true, opacity: 1.0 });
  gInsul.add(put(cyl(B.insul.r, B.insul.r, B.insul.y1 - B.insul.y0, 32, insulMat), 0, (B.insul.y0 + B.insul.y1) / 2, 0));

  /* ── 中心触点（灯泡的另一个电极） ── */
  var ct = cyl(B.center.r, B.center.r * 0.86, B.center.y1 - B.center.y0, 28, M.brass);
  ct.userData.role = 'centerContact';
  gInsul.add(put(ct, 0, (B.center.y0 + B.center.y1) / 2, 0));
  var dome = new THREE.Mesh(new THREE.SphereGeometry(B.center.r * 0.86, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), M.brass);
  gInsul.add(put(dome, 0, B.center.y0, 0));
  bp.centerContact = ct;

  /* ── 玻璃芯柱（两根引线封在里面） ── */
  stemMat = new THREE.MeshPhysicalMaterial({
    color: 0xbfe4ff, metalness: 0.0, roughness: 0.08, transparent: true, opacity: 0.5,
    side: THREE.DoubleSide, clearcoat: 0.4, clearcoatRoughness: 0.1,
  });
  gStem.add(put(cyl(B.stem.r, B.stem.r * 0.92, B.stem.y1 - B.stem.y0, 24, stemMat), 0, (B.stem.y0 + B.stem.y1) / 2, 0));

  /* ── 引线①、②（同一根金属丝：从焊点/触点一路到灯丝两端） ── */
  bp.leadA = tubeOf(B.leadA, 0.045, M.steel, 2);
  bp.leadB = tubeOf(B.leadB, 0.045, M.steel, 2);
  bp.leadA.userData.role = 'leadA';
  bp.leadB.userData.role = 'leadB';
  gInner.add(bp.leadA);
  gInner.add(bp.leadB);

  /* ── 灯丝：拆成左右两半（烧断时中间裂开一条缝） ── */
  var c = B.coil, half = c.gapT / 2;
  var filMat = new THREE.MeshStandardMaterial({
    color: 0xffb347, emissive: 0xff9a3c, emissiveIntensity: 0.0, roughness: 0.45, metalness: 0.3,
  });
  parts.filMat = filMat;
  var cl = new THREE.Mesh(new THREE.TubeGeometry(new CoilCurve(0, 0.5 - half), 200, c.wire, 8, false), filMat);
  var cr = new THREE.Mesh(new THREE.TubeGeometry(new CoilCurve(0.5 + half, 1), 200, c.wire, 8, false), filMat);
  cl.userData.role = 'filamentL'; cr.userData.role = 'filamentR';
  bp.coilL = cl; bp.coilR = cr;
  gInner.add(cl); gInner.add(cr);

  /* ── 玻璃泡（LatheGeometry 一次旋成：颈 → 球 → 顶） ── */
  glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xbfe4ff, metalness: 0.0, roughness: 0.05, transparent: true, opacity: 0.62,
    side: THREE.DoubleSide, clearcoat: 0.6, clearcoatRoughness: 0.08,
  });
  var prof = [
    [0.00, 6.35], [0.42, 6.31], [0.86, 6.12], [1.22, 5.72], [1.45, 5.20],
    [1.52, 4.80], [1.45, 4.40], [1.22, 3.88], [0.86, 3.48], [0.56, 3.22],
    [0.53, 3.02], [0.53, 2.95],
  ].map(function (p) { return new THREE.Vector2(p[0], p[1]); });
  var glass = new THREE.Mesh(new THREE.LatheGeometry(prof, 56), glassMat);
  glass.userData.role = 'bulbGlass';
  bp.glass = glass;
  gGlass.add(glass);

  /* ── 灯丝光晕（Sprite，加法混合，不写深度） ── */
  halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: haloTexture(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
    depthWrite: false, depthTest: false,
  }));
  halo.renderOrder = 30;
  halo.position.set(0, c.y, 0);
  halo.scale.set(4.2, 4.2, 1);
  halo.userData.role = 'halo';
  gInner.add(halo);

  /* ── 点光源：真的照亮灯座和台面 ── */
  keyLight = new THREE.PointLight(0xffd9a0, 0, 12, 1.6);
  keyLight.position.set(0, c.y, 0);
  keyLight.userData.role = 'bulbLight';
  gInner.add(keyLight);
  bp.light = keyLight;

  return g;
}

function buildBattery() {
  var B = DIM.battery, g = new THREE.Group();
  g.userData.role = 'battery';
  var bodyM = new THREE.MeshStandardMaterial({ color: 0x2f3b4f, metalness: 0.35, roughness: 0.5 });
  g.add(put(box(B.w, B.h, B.d, bodyM), B.x, B.h / 2, B.z));
  g.add(put(box(B.w - 0.5, 0.42, B.d - 0.5, M.plastic), B.x, B.h - 0.3, B.z));
  var plate = box(B.w * 0.72, 0.42, 0.06, mat(0x0f172a, { metalness: 0.2, roughness: 0.6 }));
  g.add(put(plate, B.x, B.h * 0.55, B.z + B.d / 2 + 0.03));
  [-1, 1].forEach(function (s) {
    var x = B.x + s * B.postX, m = s === POLARITY.battPlus ? M.postPos : M.postNeg;
    g.add(put(cyl(B.r, B.r, B.postY - B.h, 16, m), x, (B.h + B.postY) / 2, B.z));
    g.add(put(cyl(B.r * 1.5, B.r * 1.5, 0.14, 20, m), x, B.postY + 0.04, B.z));
  });
  return g;
}

function buildSwitch() {
  var sw = DIM.sw, g = new THREE.Group();
  g.userData.role = 'switch';
  g.add(put(box(2.35, 0.34, 1.15, M.bakelite), sw.x, 0.17, sw.z));
  [sw.lx, sw.rx].forEach(function (x) {
    g.add(put(cyl(0.13, 0.13, 0.4, 14, M.brass), x, 0.55, sw.z));
  });
  var hinge = new THREE.Group();
  hinge.position.set(sw.lx, sw.y, sw.z);
  var blade = box(sw.blade, 0.085, 0.16, M.chrome);
  blade.position.set(sw.blade / 2, 0, 0);
  hinge.add(blade);
  hinge.userData.role = 'blade';
  g.add(hinge);
  parts.bladeHinge = hinge;
  return g;
}

function buildWires() {
  var g = new THREE.Group();
  g.userData.role = 'wires';
  PATH_SEGMENTS.forEach(function (s) {
    if (s.seg !== '导线1' && s.seg !== '导线2') return;
    var m = tubeOf(s.pts, DIM.wireR, M.wire, 4);
    m.userData.role = 'wire';
    m.userData.seg = s.seg;
    g.add(m);
  });
  return g;
}

/* ---- 标注 + 引线（引线随标注位置重建；分解时标注跟着零件走） ---- */
var labelObjs = [], leaderGeo = null;

function buildLabels() {
  var g = new THREE.Group();
  g.userData.role = 'labels';
  labelObjs = [];
  LABELS.forEach(function (L) {
    var sp = makeLabel(L.t);
    sp.userData.anchor = L.a;
    sp.userData.text = L.t;
    g.add(sp);
    labelObjs.push({ sp: sp, L: L });
  });
  leaderGeo = new THREE.BufferGeometry();
  leaderGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(LABELS.length * 6), 3));
  var line = new THREE.LineSegments(leaderGeo,
    new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.42 }));
  line.userData.role = 'labelLeaders';
  g.add(line);
  layoutLabels();
  return g;
}

/* 把标注摆到「当前 mode」该在的位置：分解时带 eg 的跟着零件一起抬，
 * 环境件（灯座 / 接线柱 / 电源）整体收起；引线端点同步重算。 */
function layoutLabels() {
  if (!labelObjs.length || !leaderGeo) return;
  var e = state.explode, pos = leaderGeo.attributes.position;
  labelObjs.forEach(function (o, i) {
    var off = o.L.eg ? (EXPLODE_OFF[o.L.eg] || 0) * e : 0;
    var isContext = (e > 0.5) && !o.L.eg;
    o.sp.visible = !isContext;
    var px = o.L.p[0], py = o.L.p[1] + off, pz = o.L.p[2];
    o.sp.position.set(px, py, pz);
    var ax = o.L.a[0], ay = o.L.a[1] + off, az = o.L.a[2];
    pos.setXYZ(i * 2, ax, ay, az);
    pos.setXYZ(i * 2 + 1, ax + (px - ax) * 0.88, ay + (py - ay) * 0.88, az + (pz - az) * 0.88);
  });
  pos.needsUpdate = true;
  leaderGeo.computeBoundingSphere();
}

/* ---- 电流粒子 + 方向箭头 ---- */
export const FLOW = { count: 54, u: [], pos: [], speed: 0, total: 0, table: null };

function buildFlow() {
  var g = new THREE.Group();
  g.userData.role = 'flow';
  var geo = new THREE.SphereGeometry(0.095, 12, 8);
  var m = new THREE.MeshBasicMaterial({ color: 0x9ff5ff, transparent: true, opacity: 0.95 });
  var i;
  for (i = 0; i < FLOW.count; i++) {
    var s = new THREE.Mesh(geo, m);
    s.userData.role = 'charge';
    g.add(s);
    FLOW.pos.push(s);
    FLOW.u.push(i / FLOW.count);
  }
  /* 方向箭头（锥体），固定挂在路径的若干等分点上 */
  var coneGeo = new THREE.ConeGeometry(0.105, 0.30, 10);
  var coneMat = new THREE.MeshBasicMaterial({ color: 0x7dd3fc });
  for (i = 0; i < 9; i++) {
    var c = new THREE.Mesh(coneGeo, coneMat);
    c.userData.role = 'arrow';
    c.userData.at = (i + 0.5) / 9;
    g.add(c);
  }
  return g;
}

/* ==================================================================
 *  5. 路径采样（等弧长表）
 * ================================================================== */
var _pathCache = { key: '', pts: [], table: null, total: 0 };

export function pathKey() {
  return state.unscrew.toFixed(2);
}

/* 灯泡整体变换（拧松时旋转 + 抬起）—— 灯内那几段跟着一起走 */
function bulbMatrix() {
  var m = new THREE.Matrix4();
  var lift = Math.pow(state.unscrew / 100, 1.5) * DIM.bulb.unseatLift;
  var ang = (state.unscrew / 100) * Math.PI * 1.05;
  m.makeRotationY(ang);
  m.setPosition(0, lift, 0);
  return m;
}

export function pathPoints() {
  var key = pathKey();
  if (_pathCache.key === key) return _pathCache.pts;
  var mtx = bulbMatrix();
  var out = [], v = new THREE.Vector3();
  PATH_SEGMENTS.forEach(function (s) {
    s.pts.forEach(function (p) {
      v.set(p[0], p[1], p[2]);
      if (s.inBulb) v.applyMatrix4(mtx);
      out.push(v.clone());
    });
  });
  /* 去重（相邻重合点会让切向退化） */
  var clean = [out[0]];
  for (var i = 1; i < out.length; i++) if (out[i].distanceTo(clean[clean.length - 1]) > 1e-5) clean.push(out[i]);
  _pathCache = { key: key, pts: clean, table: buildTable2(clean), total: 0 };
  _pathCache.total = _pathCache.table.total;
  FLOW.total = _pathCache.total;
  return clean;
}
function buildTable2(pts) {
  var lens = [0], L = 0, i;
  for (i = 1; i < pts.length; i++) { L += pts[i].distanceTo(pts[i - 1]); lens.push(L); }
  var N = 900, tbl = [], j = 1;
  for (i = 0; i <= N; i++) {
    var d = (i / N) * L;
    while (j < lens.length - 1 && lens[j] < d) j++;
    var seg = lens[j] - lens[j - 1] || 1e-6;
    var u = Math.max(0, Math.min(1, (d - lens[j - 1]) / seg));
    tbl.push(pts[j - 1].clone().lerp(pts[j], u));
  }
  return { pts: tbl, total: L };
}
export function pathAt(u) {
  var t = _pathCache.table;
  if (!t || !t.pts.length) return new THREE.Vector3();
  u = ((u % 1) + 1) % 1;
  var f = u * (t.pts.length - 1), i = Math.min(t.pts.length - 2, Math.floor(f));
  return t.pts[i].clone().lerp(t.pts[i + 1], f - i);
}
export function pathLength() { pathPoints(); return _pathCache.total; }

/* 某段路径的世界坐标（自检用：断言「路径确实穿过灯丝/螺纹壳/中心触点」） */
export function segPoints(name) {
  var mtx = bulbMatrix(), out = [];
  PATH_SEGMENTS.forEach(function (s) {
    if (s.seg !== name) return;
    s.pts.forEach(function (p) {
      var v = new THREE.Vector3(p[0], p[1], p[2]);
      if (s.inBulb) v.applyMatrix4(mtx);
      out.push(v);
    });
  });
  return out;
}
export function segNames() { return PATH_SEGMENTS.map(function (s) { return s.seg; }); }

/* ==================================================================
 *  6. 模式 / 视图
 * ================================================================== */
/* 剖面裁剪面：法线 −Z ⇒ 保留 z ≤ constant 的那一半。
 * constant = 2.0 时不裁（本页可裁剪件的最大 |z| ≈ 1.52）；constant = 0 时正好切掉靠近镜头的半侧。 */
var clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 2.0);
var clipTargets = [];

export function applyViewImmediate(reframe) {
  var m = state.mode;
  var gOp = 0.62, sOp = 1.0, kOp = 1.0, ex = 0, cut = 0;
  if (m === 'solid') { gOp = 0.62; sOp = 1.0; kOp = 1.0; ex = 0; cut = 0; }
  else if (m === 'xray') { gOp = 0.12; sOp = 0.30; kOp = 0.30; ex = 0; cut = 0; }
  else if (m === 'cut') { gOp = 0.24; sOp = 1.0; kOp = 1.0; ex = 0; cut = 1; }
  else if (m === 'explode') { gOp = 0.20; sOp = 1.0; kOp = 0.35; ex = 1; cut = 0; }
  state.glassOpacity = gOp; state.shellOpacity = sOp; state.socketOpacity = kOp;
  state.explode = ex; state.cutAmt = cut;
  if (glassMat) {
    glassMat.opacity = gOp;
    glassMat.transparent = gOp < 0.99;
    glassMat.side = (m === 'xray' || m === 'explode') ? THREE.BackSide : THREE.DoubleSide;
    glassMat.needsUpdate = true;
  }
  if (stemMat) stemMat.opacity = Math.max(0.2, gOp * 0.85);
  if (shellMat) { shellMat.opacity = sOp; shellMat.transparent = sOp < 0.99; shellMat.needsUpdate = true; }
  if (insulMat) { insulMat.opacity = kOp < 1 ? Math.max(0.25, kOp) : 1; insulMat.transparent = kOp < 1; insulMat.needsUpdate = true; }
  if (socketMat) { socketMat.opacity = kOp; socketMat.transparent = kOp < 0.99; socketMat.needsUpdate = true; }
  clipPlane.constant = 2.0 * (1 - cut);
  applyExplode();
  if (reframe) applyCamForMode();
  /* 分解视图下不显示电流（零件已经不在原位，粒子会浮在空中）；
   * 灯丝特写下不显示标注（标注是固定世界尺寸，贴到镜头上会糊满画面）。 */
  if (flowGroup) flowGroup.visible = state.showFlow && m !== 'explode';
  if (labelGroup) labelGroup.visible = state.showLabels && state.view !== 'closeup';
}

function applyCamForMode() {
  if (state.mode === 'explode') {
    cam.yaw = 0.34; cam.pitch = 0.12; cam.dist = 20.4; cam.ty = 6.86; cam.tz = 0;
  } else {
    var t = VIEWS[state.view] || VIEWS.angle;
    cam.yaw = t.yaw; cam.pitch = t.pitch; cam.dist = t.dist; cam.ty = t.ty; cam.tz = t.tz;
  }
}

function applyExplode() {
  var e = state.explode;
  if (parts.insulGrp) parts.insulGrp.position.y = EXPLODE_OFF.insul * e;
  if (parts.shellGrp) parts.shellGrp.position.y = EXPLODE_OFF.shell * e;
  if (parts.stem) parts.stem.position.y = EXPLODE_OFF.stem * e;
  if (parts.innerGrp) parts.innerGrp.position.y = EXPLODE_OFF.inner * e;
  if (parts.glassGrp) parts.glassGrp.position.y = EXPLODE_OFF.glass * e;
  /* 分解时把「环境」整体收起来：灯座 / 电源 / 导线 / 开关 —— 只留灯泡本体，
   * 这样镜头才能贴到灯泡上把每一件看清楚。 */
  var hide = e > 0.5;
  ['socketGrp', 'batteryGrp', 'wiresGrp', 'switchGrp'].forEach(function (k) {
    if (parts[k]) parts[k].visible = !hide;
  });
  layoutLabels();
}

export function setMode(m) {
  if (['solid', 'xray', 'cut', 'explode'].indexOf(m) < 0) return false;
  var prev = state.mode;
  state.mode = m;
  /* 只在「进 / 出分解」时重新取景 —— 其余模式切换保持学生自己转到的视角 */
  applyViewImmediate(m === 'explode' || prev === 'explode');
  return true;
}

export function setView(v) {
  if (!VIEWS[v]) return false;
  state.view = v;
  var t = VIEWS[v];
  cam.yaw = t.yaw; cam.pitch = t.pitch; cam.dist = t.dist;
  cam.ty = t.ty; cam.tz = t.tz;
  if (labelGroup) labelGroup.visible = state.showLabels && v !== 'closeup';
  return true;
}

/* ==================================================================
 *  7. 渲染
 * ================================================================== */
var _lastW = 0, _lastH = 0, _lastDpr = 0;
function resize() {
  if (!canvas || !renderer) return;
  var w = canvas.clientWidth || 800, h = canvas.clientHeight || 520;
  var dpr = Math.min(2, window.devicePixelRatio || 1);
  if (w === _lastW && h === _lastH && dpr === _lastDpr) return;
  _lastW = w; _lastH = h; _lastDpr = dpr;
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  camera3.aspect = w / Math.max(1, h);
  camera3.updateProjectionMatrix();
}

export function updateCamera() {
  if (!camera3) return;
  var cy = Math.cos(cam.pitch);
  camera3.position.set(
    cam.tx + cam.dist * cy * Math.sin(cam.yaw),
    cam.ty + cam.dist * Math.sin(cam.pitch),
    cam.tz + cam.dist * cy * Math.cos(cam.yaw)
  );
  camera3.lookAt(cam.tx, cam.ty, cam.tz);
}

function updateBulbTransform() {
  if (!bulbGroup) return;
  var lift = Math.pow(state.unscrew / 100, 1.5) * DIM.bulb.unseatLift;
  bulbGroup.position.set(0, lift, 0);
  bulbGroup.rotation.y = (state.unscrew / 100) * Math.PI * 1.05;
}

/* 目视亮度：辐射亮度按四次方律算，但人眼看到的「亮」要开个 0.45 次方，
 * 否则 1000 K 的暗红（辐射只有额定的 1%）会被压成完全看不见。 */
export function glowOf(T) {
  if (T <= 520) return 0;
  return Math.min(1, Math.pow(brightnessOf(T), 0.45));
}

/* 钨丝冷态是暗银灰；到 500~900 K 之间过渡成黑体色。 */
var COLD_FIL = [0.52, 0.545, 0.58];

function updateThermalVisual() {
  var T = thermal.T, br = brightnessOf(T);
  var mix = Math.max(0, Math.min(1, (T - 500) / 400));
  var rgb = blackbodyRGB(T);
  if (parts.filMat) {
    if (thermal.burned) {
      parts.filMat.color.setHex(0x6b7280);
      parts.filMat.emissive.setHex(0x000000);
      parts.filMat.emissiveIntensity = 0;
    } else {
      parts.filMat.color.setRGB(
        COLD_FIL[0] + (rgb[0] - COLD_FIL[0]) * mix,
        COLD_FIL[1] + (rgb[1] - COLD_FIL[1]) * mix,
        COLD_FIL[2] + (rgb[2] - COLD_FIL[2]) * mix);
      parts.filMat.emissive.setRGB(rgb[0] * mix, rgb[1] * mix, rgb[2] * mix);
      parts.filMat.emissiveIntensity = mix > 0.002 ? (0.16 + 2.3 * Math.pow(br, 0.45)) : 0;
    }
  }
  var glow = thermal.burned ? 0 : glowOf(T);
  if (glassMat) {
    if (glassMat.emissive) {
      glassMat.emissive.setRGB(rgb[0], rgb[1], rgb[2]);
      glassMat.emissiveIntensity = 0.28 * glow;
    }
  }
  if (halo) {
    halo.material.opacity = Math.min(0.80, 0.86 * glow);
    var sc = 0.82 + 1.30 * Math.min(1.20, glow);
    halo.scale.set(sc, sc, 1);
    halo.material.color.setRGB(rgb[0], rgb[1], rgb[2]);
  }
  if (keyLight) {
    keyLight.intensity = 13 * glow;
    keyLight.color.setRGB(rgb[0], rgb[1], rgb[2]);
  }
  /* 灯丝烧断：两半各往外挪一点，中间裂开一条缝 */
  var gap = thermal.burned ? 0.075 : 0;
  if (parts.bulbParts && parts.bulbParts.coilL) {
    parts.bulbParts.coilL.position.x = -gap;
    parts.bulbParts.coilR.position.x = gap;
  }
}

function updateFlow(dt) {
  if (!flowGroup || !flowGroup.visible) return;
  var I = currentOf(thermal, effectiveVoltage());
  var rated = thermal.spec.I;
  var laps = I > 1e-6 ? (0.11 + 0.72 * Math.min(1.6, I / rated)) : 0;
  FLOW.speed = laps;
  var i;
  for (i = 0; i < FLOW.count; i++) {
    FLOW.u[i] = (FLOW.u[i] + laps * dt) % 1;
    var p = pathAt(FLOW.u[i]);
    FLOW.pos[i].position.copy(p);
    FLOW.pos[i].material.opacity = I > 1e-6 ? 0.95 : 0.16;
  }
  /* 箭头：位置 = 路径等分点，朝向 = 切向 */
  for (i = 0; i < flowGroup.children.length; i++) {
    var o = flowGroup.children[i];
    if (o.userData.role !== 'arrow') continue;
    var a = pathAt(o.userData.at), b2 = pathAt(o.userData.at + 0.006);
    o.position.copy(a);
    var d = b2.clone().sub(a);
    if (d.lengthSq() > 1e-12) o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    o.material.opacity = I > 1e-6 ? 0.9 : 0.18;
  }
}

export function effectiveVoltage() {
  if (!state.switchOn) return 0;
  if (!isContactOk()) return 0;
  return state.voltage;
}

function draw() {
  if (!renderer) return;
  resize();
  updateCamera();
  updateBulbTransform();
  updateThermalVisual();
  renderer.render(scene, camera3);
}

var _rafId = 0, _last = 0, _uiTick = 0;
function loop(ts) {
  _rafId = requestAnimationFrame(loop);
  var dt = _last ? Math.min(0.05, (ts - _last) / 1000) : 0.016;
  _last = ts;
  step(dt);
  /* 读数必须跟着灯丝一起变：灯丝升温只要零点几秒，不刷新就看不到
   * 「刚合闸电流冲一下、然后回落」这一段。每 5 帧刷一次，够跟手又不卡。 */
  if ((++_uiTick % 5) === 0) refreshReadouts();
  draw();
}
var _toastTimer = 0;
function toast(msg, kind) {
  var el = document.getElementById('bulb-toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'stage-toast show' + (kind ? ' ' + kind : '');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function () { el.className = 'stage-toast'; }, 2800);
}

export function step(dt) {
  var wasBurned = thermal.burned;
  thermalStep(thermal, effectiveVoltage(), dt);
  if (!wasBurned && thermal.burned) {
    toast('⚡ 灯丝烧断了！电压超过额定值太多 —— 点「重置」换一只新灯泡', 'bad');
  }
  updateFlow(dt);
}
export function renderNow() { draw(); return true; }

/* ==================================================================
 *  8. 读数 / 状态
 * ================================================================== */
export function readouts() {
  var U = effectiveVoltage();
  var I = currentOf(thermal, U);
  var R = resistanceAt(thermal, thermal.T);
  return {
    U: U, I: I, R: R, P: U * I,
    T: thermal.T, T_C: thermal.T - 273.15,
    brightness: brightnessOf(thermal.T),
    ratedU: thermal.spec.U, ratedI: thermal.spec.I,
    burned: thermal.burned,
    contact: isContactOk(),
    switchOn: state.switchOn,
  };
}

export function statusOf() {
  if (thermal.burned) return { k: 'bad', t: '灯丝烧断' };
  if (!state.switchOn) return { k: 'warn', t: '断路（开关断开）' };
  if (!isContactOk()) return { k: 'warn', t: '断路（灯泡没拧紧）' };
  if (state.voltage < 0.05) return { k: '', t: '未通电' };
  var r = readouts();
  if (r.brightness <= 0.02) return { k: '', t: '微热，还没发光' };
  if (r.U > r.ratedU * 1.12) return { k: 'bad', t: '过亮 · 超过额定电压' };
  if (r.U < r.ratedU * 0.82) return { k: 'warn', t: '偏暗 · 低于额定电压' };
  return { k: 'ok', t: '正常发光' };
}

/* ==================================================================
 *  9. 像素取样（自检用：读渲染结果，不重算物理）
 * ================================================================== */
export function sampleRegion(x0, y0, x1, y1) {
  renderNow();
  var gl = renderer.getContext();
  var dpr = renderer.getPixelRatio();
  var W = renderer.domElement.width, H = renderer.domElement.height;
  var px0 = Math.max(0, Math.min(W - 1, Math.round(x0 * dpr)));
  var py1 = Math.max(0, Math.min(H, Math.round(y1 * dpr)));
  var px1 = Math.max(px0 + 1, Math.min(W, Math.round(x1 * dpr)));
  var py0 = Math.max(0, Math.min(py1 - 1, Math.round(y0 * dpr)));
  var w = px1 - px0, h = py1 - py0;
  var buf = new Uint8Array(w * h * 4);
  gl.readPixels(px0, H - py1, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  var sum = 0, n = 0, mx = 0, i, L;
  for (i = 0; i < buf.length; i += 4) {
    L = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
    sum += L; n++; if (L > mx) mx = L;
  }
  return { lum: n ? sum / n : 0, max: mx, n: n, w: w, h: h };
}

/* 某世界点在屏幕上的 CSS 像素坐标（自检定位探针框用） */
export function project(v) {
  var p = new THREE.Vector3(v[0], v[1], v[2]).project(camera3);
  var w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
  return { x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h };
}

/* ---- 指针：拖空白转视角 / 滚轮缩放 ---- */
function wirePointer() {
  if (!canvas) return;
  var down = false, lx = 0, ly = 0, pid = null;
  canvas.addEventListener('pointerdown', function (e) {
    down = true; pid = e.pointerId; lx = e.clientX; ly = e.clientY;
    canvas.classList.add('grabbing');
    try { canvas.setPointerCapture(pid); } catch (err) {}
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!down) return;
    var dx = e.clientX - lx, dy = e.clientY - ly;
    lx = e.clientX; ly = e.clientY;
    cam.yaw -= dx * 0.0065;
    cam.pitch = Math.max(-0.35, Math.min(1.25, cam.pitch + dy * 0.0055));
  });
  var up = function () {
    if (!down) return;
    down = false;
    canvas.classList.remove('grabbing');
    try { if (pid !== null) canvas.releasePointerCapture(pid); } catch (err) {}
    pid = null;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', up);
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    cam.dist = Math.max(3.2, Math.min(42, cam.dist * Math.exp(e.deltaY * 0.0011)));
  }, { passive: false });
}

/* ==================================================================
 *  10. 初始化
 * ================================================================== */
var MODE_TIP = {
  solid: '外观：平时看到的样子（金属壳挡住里面）。点「透视」看内部。',
  xray: '透视：把玻璃泡和金属壳变半透明，灯丝、引线、芯柱全都露出来了。',
  cut: '剖面：把靠近镜头的一半切掉 —— 灯座里面的螺纹弹片、中心弹片也看得见。',
  explode: '分解：各零件按从下到上分开摆好（灯座 / 电源先收起来），一件一件认。分解时电流粒子先收起来。',
};

function wireUI() {
  var q = function (id) { return document.getElementById(id); };

  /* 模式（左栏 + 舞台条两处按钮，同一份状态） */
  var mBtns = document.querySelectorAll('[data-mode]');
  Array.prototype.forEach.call(mBtns, function (b) {
    b.addEventListener('click', function () {
      setMode(b.getAttribute('data-mode'));
      refreshUI();
    });
  });
  /* 视角 */
  var vBtns = document.querySelectorAll('[data-view]');
  Array.prototype.forEach.call(vBtns, function (b) {
    b.addEventListener('click', function () {
      setView(b.getAttribute('data-view'));
      syncButtons();
    });
  });
  /* 电压 */
  var vs = q('bulb-voltage'), vv = q('bulb-voltage-val');
  if (vs) vs.addEventListener('input', function () {
    state.voltage = parseFloat(vs.value);
    if (vv) vv.textContent = state.voltage.toFixed(1) + ' V';
    refreshUI();
  });
  /* 拧松 */
  var us = q('bulb-unscrew'), uv = q('bulb-unscrew-val');
  if (us) us.addEventListener('input', function () {
    state.unscrew = parseFloat(us.value);
    if (uv) uv.textContent = state.unscrew < 1 ? '拧到底' : (isContactOk() ? '松了 ' + Math.round(state.unscrew) + '%' : '已拧出');
    refreshUI();
  });
  /* 开关 */
  var swb = q('bulb-switch');
  if (swb) swb.addEventListener('click', function () {
    state.switchOn = !state.switchOn;
    swb.classList.toggle('on', state.switchOn);
    swb.textContent = state.switchOn ? '🔌 开关：闭合' : '⭕ 开关：断开';
    refreshUI();
  });
  /* 规格 */
  var sp = q('bulb-spec');
  if (sp) sp.addEventListener('change', function () {
    var s = specById(sp.value);
    state.specId = s.id;
    var t = makeThermal(s);
    thermal.spec = t.spec; thermal.Rrated = t.Rrated; thermal.Rcold = t.Rcold;
    thermal.k4 = t.k4; thermal.k1 = t.k1; thermal.C = t.C; thermal.T = t.Tamb; thermal.burned = false;
    var maxU = Math.ceil(s.U * 1.5 * 2) / 2;
    if (vs) { vs.max = maxU; }
    if (state.voltage > maxU) { state.voltage = maxU; if (vs) vs.value = maxU; }
    if (vv) vv.textContent = state.voltage.toFixed(1) + ' V';
    if (uv) uv.textContent = '拧到底';
    refreshUI();
  });
  /* 标注 / 电流 */
  var lb = q('bulb-labels');
  if (lb) lb.addEventListener('click', function () {
    state.showLabels = !state.showLabels;
    lb.classList.toggle('on', state.showLabels);
    if (labelGroup) labelGroup.visible = state.showLabels;
  });
  var fb = q('bulb-flow');
  if (fb) fb.addEventListener('click', function () {
    state.showFlow = !state.showFlow;
    fb.classList.toggle('on', state.showFlow);
    if (flowGroup) flowGroup.visible = state.showFlow && state.mode !== 'explode';
  });
  /* 重置 */
  var rb = q('bulb-reset');
  if (rb) rb.addEventListener('click', function () {
    resetAll();
    refreshUI();
  });
}

export function resetAll() {
  state.voltage = thermal.spec.U;
  state.switchOn = true;
  state.unscrew = 0;
  state.mode = 'solid';
  state.showLabels = true;
  state.showFlow = true;
  thermal.T = PHYS.Tamb; thermal.burned = false;
  var vs = document.getElementById('bulb-voltage');
  if (vs) vs.value = state.voltage;
  var us = document.getElementById('bulb-unscrew');
  if (us) us.value = 0;
  applyViewImmediate(true);
  syncButtons();
  refreshUI();
}

function syncButtons() {
  Array.prototype.forEach.call(document.querySelectorAll('[data-mode]'), function (o) {
    o.classList.toggle('on', o.getAttribute('data-mode') === state.mode);
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-view]'), function (o) {
    o.classList.toggle('on', o.getAttribute('data-view') === state.view);
  });
  var tip = document.getElementById('bulb-modetip');
  if (tip) tip.textContent = MODE_TIP[state.mode] || '';
  var lb = document.getElementById('bulb-labels');
  if (lb) lb.classList.toggle('on', state.showLabels);
  var fb = document.getElementById('bulb-flow');
  if (fb) fb.classList.toggle('on', state.showFlow);
  var swb = document.getElementById('bulb-switch');
  if (swb) { swb.classList.toggle('on', state.switchOn); swb.textContent = state.switchOn ? '🔌 开关：闭合' : '⭕ 开关：断开'; }
}

export function refreshUI() {
  refreshReadouts();
  syncButtons();
}

/* 只刷「会跟着物理量变」的那几处（渲染循环每 5 帧调一次，别去碰按钮的 DOM 查询） */
export function refreshReadouts() {
  var q = function (id) { return document.getElementById(id); };
  var r = readouts(), st = statusOf();
  var pill = q('bulb-status');
  if (pill) { pill.textContent = st.t; pill.className = 'pill ' + st.k; }
  var setT = function (id, v) { var e = q(id); if (e) e.textContent = v; };
  setT('ro-U', r.U.toFixed(2) + ' V');
  setT('ro-I', r.I.toFixed(3) + ' A');
  setT('ro-R', r.R.toFixed(2) + ' Ω');
  setT('ro-P', r.P.toFixed(3) + ' W');
  setT('ro-T', Math.round(r.T) + ' K');
  setT('ro-TC', Math.round(r.T_C) + ' °C');
  setT('ro-br', (r.brightness * 100).toFixed(0) + ' %');
  var rr = q('ro-ratio');
  if (rr) rr.textContent = (r.R / thermal.Rcold).toFixed(1) + ' ×';
  var note = q('bulb-note');
  if (note) {
    if (thermal.burned) note.textContent = '灯丝已经烧断 —— 电路里再没有能导电的灯丝，电流为 0。点「重置」换一只新灯泡。';
    else if (!state.switchOn) note.textContent = '开关断开了：电路不闭合，电荷无处可流，灯泡不亮。';
    else if (!isContactOk()) note.textContent = '灯泡拧松了：中心触点离开了灯座的中心弹片，电流走不过去 —— 这就是「灯泡没拧紧不亮」的原因。';
    else note.textContent = '电流从「+」接线柱进、从「−」接线柱出，中间唯一的路就是灯丝。';
  }
  var vs = q('bulb-voltage-val'); if (vs) vs.textContent = state.voltage.toFixed(1) + ' V';
}

function boot() {
  canvas = document.getElementById('bulb-canvas');
  if (!canvas) return;

  renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.localClippingEnabled = true;
  renderer.setClearColor(0x050b18, 1);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050b18);
  scene.fog = new THREE.Fog(0x050b18, 26, 52);

  camera3 = new THREE.PerspectiveCamera(cam.fov, 1.6, 0.1, 200);

  scene.add(new THREE.AmbientLight(0x93a7c4, 1.35));
  scene.add(new THREE.HemisphereLight(0x9dc0ff, 0x0b1220, 0.95));
  var d1 = new THREE.DirectionalLight(0xffffff, 2.3); d1.position.set(7, 13, 9); scene.add(d1);
  var d2 = new THREE.DirectionalLight(0x88aaff, 0.85); d2.position.set(-9, 6, -7); scene.add(d2);

  scene.add(buildTable());
  parts.socketGrp = buildSocket();
  scene.add(parts.socketGrp);
  bulbGroup = buildBulb();
  scene.add(bulbGroup);
  parts.batteryGrp = buildBattery();
  scene.add(parts.batteryGrp);
  parts.switchGrp = buildSwitch();
  scene.add(parts.switchGrp);
  parts.wiresGrp = buildWires();
  scene.add(parts.wiresGrp);

  flowGroup = buildFlow();
  scene.add(flowGroup);
  labelGroup = buildLabels();
  scene.add(labelGroup);

  /* 可裁剪材质：剖面模式切掉靠近镜头的那一半 */
  clippable = [glassMat, shellMat, socketMat, insulMat, stemMat];
  clippable.forEach(function (m) { if (m) m.clippingPlanes = [clipPlane]; });

  pathPoints();
  applyViewImmediate(true);
  setView('angle');
  syncButtons();
  refreshUI();
  wireUI();
  wirePointer();

  window.addEventListener('resize', function () { resize(); });

  resize();
  renderNow();
  _rafId = requestAnimationFrame(loop);
}

/* ==================================================================
 *  11. 测试钩子
 * ================================================================== */
export const api = {
  THREE: THREE, DIM: DIM, PHYS: PHYS, SPECS: BULB_SPECS, POLARITY: POLARITY,
  state: state, thermal: thermal, cam: cam, FLOW: FLOW,
  get scene() { return scene; }, get renderer() { return renderer; }, get camera3() { return camera3; },
  pathPoints: pathPoints, pathAt: pathAt, pathLength: pathLength,
  segPoints: segPoints, segNames: segNames,
  setMode: setMode, setView: setView, setVoltage: function (v) { state.voltage = v; refreshUI(); },
  setSwitch: function (b) { state.switchOn = !!b; refreshUI(); },
  setUnscrew: function (v) { state.unscrew = v; refreshUI(); },
  setSpec: function (id) { state.specId = specById(id).id; },
  effectiveVoltage: effectiveVoltage, isContactOk: isContactOk,
  readouts: readouts, statusOf: statusOf, refreshUI: refreshUI, refreshReadouts: refreshReadouts, resetAll: resetAll,
  step: step, renderNow: renderNow, sampleRegion: sampleRegion, project: project,
  brightnessOf: brightnessOf, glowOf: glowOf, blackbodyRGB: blackbodyRGB,
  resistanceAt: resistanceAt, currentOf: currentOf, thermalStep: thermalStep, lossAt: lossAt,
  coilPoint: coilPoint, makeThermal: makeThermal,
  bulbTransform: function () { return bulbMatrix().elements.slice(); },
  partRoles: function () {
    var out = [];
    if (!scene) return out;
    scene.traverse(function (o) { if (o.userData && o.userData.role) out.push(o.userData.role); });
    return out;
  },
  meshCount: function () { var n = 0; if (scene) scene.traverse(function (o) { if (o.isMesh) n++; }); return n; },
  labelTexts: function () {
    var out = [];
    if (!labelGroup) return out;
    labelGroup.children.forEach(function (o) { if (o.userData && o.userData.text) out.push(o.userData.text); });
    return out;
  },
  glassOpacity: function () { return glassMat ? glassMat.opacity : -1; },
  clipConstant: function () { return clipPlane.constant; },
  flowVisible: function () { return !!(flowGroup && flowGroup.visible); },
  flowPositions: function () { return FLOW.pos.map(function (m) { return [m.position.x, m.position.y, m.position.z]; }); },
  flowU: function () { return FLOW.u.slice(); },
  flowSpeed: function () { return FLOW.speed; },
  filamentWorld: function () {
    var c = DIM.bulb.coil, v = new THREE.Vector3(0, c.y, 0);
    v.applyMatrix4(bulbMatrix());
    return [v.x, v.y, v.z];
  },
  labelWorld: function (text) {
    if (!labelGroup) return null;
    for (var i = 0; i < labelGroup.children.length; i++) {
      var o = labelGroup.children[i];
      if (o.userData && o.userData.text === text) return [o.position.x, o.position.y, o.position.z];
    }
    return null;
  },
  toggleLabels: function () { if (labelGroup) labelGroup.visible = !labelGroup.visible; return labelGroup && labelGroup.visible; },
  arrowCount: function () {
    var n = 0;
    if (flowGroup) flowGroup.children.forEach(function (o) { if (o.userData.role === 'arrow') n++; });
    return n;
  },
  chargeCount: function () {
    var n = 0;
    if (flowGroup) flowGroup.children.forEach(function (o) { if (o.userData.role === 'charge') n++; });
    return n;
  },
  burnedGap: function () { return parts.bulbParts ? Math.abs(parts.bulbParts.coilL.position.x) : -1; },
  ready: true,
};

if (typeof window !== 'undefined') {
  window.__bulbLab = api;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}

export default api;
