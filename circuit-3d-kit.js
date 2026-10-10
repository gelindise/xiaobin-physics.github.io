/*!
 * circuit-3d-kit.js —— 3D 电路器材库（可复用）
 * ============================================================
 * 给「电路实验沙盒 3D」用，也给后续任何 3D 电学实验用：
 * 坐标映射、共享材质、端子柱、11 类元件的 three.js 网格构建器、导线网格、
 * 文字标签、表盘贴图、polyline 曲线。
 *
 * 设计要点（与 2D 沙盒共用同一份真值）：
 *   · 场景数据模型【一字不改】沿用 2D：{ id,type,x,y,rot,params,... }
 *   · (x,y) 被重新解释为【水平工作台面】坐标：
 *        to3D(x,y,z) = ((x−W/2)·S, z·S, (y−H/2)·S)   （W/H 与 2D 逻辑尺寸一致）
 *     ⇒ 逻辑 +x → 世界 +X，逻辑 +y → 世界 +Z（朝向相机），高度在 +Y。
 *   · 端子锚点【不另立一张表】：一律 D.terminalWorld(comp,i) 派生，
 *     端子编号/极性/翻转自动跟随 2D（改顺序 = 改内核语义，这里绝不会漂移）。
 *   · 元件绕 Y 轴旋转 = −comp.rot（推导见 toWorld 与 R_y 的合成，往返断言钉死）。
 *   · 极性 flip：把局部 x 取负（和 terminalWorld 里 flipOf ? −t.x : t.x 一致）。
 *     注意用【烘焙进子物体位置】而不是 group.scale.x=−1 —— 负缩放会翻转法线、
 *     让光照和背面剔除出错。
 *
 * 依赖：window.CircuitDraw（端子几何真值）、window.CircuitCore（默认参数）。
 *      两者由页面用 classic <script> 先加载好，本模块是 ES module。
 */
import * as THREE from './assets/optics-three.min.js';

// ============================================================
//  坐标与常量
// ============================================================
export const W = 1000, H = 740;   // 与 2D 沙盒同一套逻辑尺寸
export const S = 0.02;            // 逻辑 px → 世界单位
export const GRID = 20;           // 吸附步长（与 CircuitEditor.GRID 一致）
export const TABLE_Y = 0;         // 台面顶面（世界 Y）
export const WIRE_Y = 0.06;       // 导线离台面高度（防与台面 z-fighting）

function D() { return window.CircuitDraw; }
function C() { return window.CircuitCore; }

export function to3D(x, y, z) {
  return new THREE.Vector3((x - W / 2) * S, (z || 0) * S, (y - H / 2) * S);
}
export function worldToLogical(v) {
  return { x: v.x / S + W / 2, y: v.z / S + H / 2 };
}
// 元件局部逻辑坐标 → 元件组内的局部 3D 坐标（flip 已烘焙）
function P3(fx, lx, ly, h) {
  return new THREE.Vector3(fx * lx * S, (h || 0) * S, ly * S);
}

// ============================================================
//  颜色与共享材质（色值取自 CircuitDraw 的 MAT / POST_GRAD，视觉与 2D 一致）
// ============================================================
export const COLORS = {
  steel:     0x9fadbd,
  chrome:    0xd8e2ec,
  brass:     0xd3ac52,
  zinc:      0xc3ccd6,
  plastic:   0xdbe2ea,
  porcelain: 0xf4f4ef,
  copper:    0xc07a3a,
  darkBody:  0x334155,
  postPos:   0xdc2626,   // 正极红柱
  postNeg:   0x1f2a3a,   // 负极黑柱
  postNeu:   0xa8b6c4,   // 无极性金属柱
  wire:      0x8b3a2f,   // 导线（暗红胶皮）
  wireSoft:  0x5b6b7d,
  glass:     0xbfe4ff,
  filament:  0xffb347,
  ledRed:    0xef4444, ledGreen: 0x22c55e, ledBlue: 0x3b82f6,
  dialFace:  0xf6f8fb,
  bench:     0x0b1524,
};

var _matCache = {};
function mat(color, opts) {
  var key = color + '|' + JSON.stringify(opts || {});
  if (_matCache[key]) return _matCache[key];
  var o = Object.assign({ color: color, metalness: 0.35, roughness: 0.45 }, opts || {});
  var m = new THREE.MeshStandardMaterial(o);
  m.userData.shared = true;
  _matCache[key] = m;
  return m;
}
export function materials() {
  return {
    steel:     mat(COLORS.steel, { metalness: 0.86, roughness: 0.28 }),
    chrome:    mat(COLORS.chrome, { metalness: 0.95, roughness: 0.12 }),
    brass:     mat(COLORS.brass, { metalness: 0.9, roughness: 0.28 }),
    zinc:      mat(COLORS.zinc, { metalness: 0.72, roughness: 0.42 }),
    plastic:   mat(COLORS.plastic, { metalness: 0.05, roughness: 0.72 }),
    porcelain: mat(COLORS.porcelain, { metalness: 0.02, roughness: 0.6 }),
    copper:    mat(COLORS.copper, { metalness: 0.85, roughness: 0.35 }),
    darkBody:  mat(COLORS.darkBody, { metalness: 0.4, roughness: 0.5 }),
    postPos:   mat(COLORS.postPos, { metalness: 0.35, roughness: 0.45 }),
    postNeg:   mat(COLORS.postNeg, { metalness: 0.4, roughness: 0.5 }),
    postNeu:   mat(COLORS.postNeu, { metalness: 0.85, roughness: 0.28 }),
    wire:      mat(COLORS.wire, { metalness: 0.15, roughness: 0.65 }),
    glass:     mat(COLORS.glass, { metalness: 0.0, roughness: 0.06, transparent: true, opacity: 0.42, side: THREE.DoubleSide }),
    dialFace:  mat(COLORS.dialFace, { metalness: 0.0, roughness: 0.9 }),
  };
}

// ============================================================
//  几何缓存（复用，避免每次 rebuild 新建 —— 那是纯泄漏）
// ============================================================
var _geoCache = {};
function geo(key, make) {
  if (_geoCache[key]) return _geoCache[key];
  var g = make();
  g.userData.shared = true;
  _geoCache[key] = g;
  return g;
}
function boxGeo(w, h, d) { return geo('b' + w + '_' + h + '_' + d, function () { return new THREE.BoxGeometry(w * S, h * S, d * S); }); }
function cylGeo(rt, rb, h, seg) { return geo('c' + rt + '_' + rb + '_' + h + '_' + (seg || 16), function () { return new THREE.CylinderGeometry(rt * S, rb * S, h * S, seg || 16); }); }
function sphGeo(r, seg) { return geo('s' + r + '_' + (seg || 18), function () { return new THREE.SphereGeometry(r * S, seg || 18, (seg || 18) - 2); }); }
function torusGeo(r, tube, seg) { return geo('t' + r + '_' + tube + '_' + (seg || 20), function () { return new THREE.TorusGeometry(r * S, tube * S, 8, seg || 20); }); }

// ============================================================
//  端子柱
// ============================================================
export const POST_H = {
  resistor: 22, battery: 30, power: 30, switch: 30, bulb: 30, led: 22, motor: 30, bell: 30,
  ammeter: 26, voltmeter: 26, rheostat: 24, junction: 5,
};
export function postHeight(type) { return POST_H[type] != null ? POST_H[type] : 24; }

// 端子的世界坐标（供射线拾取、连线吸附、自检用）。
// 【唯一真值来自 circuit-draw 的 terminalWorld】—— 端子编号/极性/翻转自动跟随 2D。
export function terminalAnchor(comp, i) {
  var w = D().terminalWorld(comp, i);
  if (!w) return null;
  return to3D(w.x, w.y, postHeight(comp.type));
}

// 端子柱的颜色：正极红 / 负极黑 / 无极性金属。语义与 2D 的 drawBindingPost 一致。
function postKind(type, i) {
  var T = C().TYPES[type];
  if (type === 'battery' || type === 'power') return i === 0 ? 'pos' : 'neg';   // 0 = 正极
  if (type === 'led' || type === 'motor') return i === 0 ? 'pos' : 'neg'; // 0 = 「+」
  if (T && T.commonTerm != null) return i === T.commonTerm ? 'neg' : 'pos'; // 表：0 = 「−」
  return 'neu';
}
function addTerminals(ctx) {
  var M = materials(), Dd = D();
  var terms = Dd.TERMINALS[ctx.comp.type] || [];
  var h = postHeight(ctx.comp.type);
  var capR = ctx.comp.type === 'junction' ? 5 : 6.5;
  for (var i = 0; i < terms.length; i++) {
    var t = terms[i];
    // 接线点两个端子重合，只画一次
    if (ctx.comp.type === 'junction' && i > 0) break;
    var kind = postKind(ctx.comp.type, i);
    var mm = kind === 'pos' ? M.postPos : (kind === 'neg' ? M.postNeg : M.postNeu);
    var p = ctx.P(t.x, t.y, h / 2);
    var body = new THREE.Mesh(cylGeo(capR * 0.55, capR * 0.62, h, 14), mm);
    body.position.copy(p);
    body.userData.role = 'post';
    body.userData.termIdx = i;
    ctx.g.add(body);
    var cap = new THREE.Mesh(cylGeo(capR, capR, capR * 0.7, 16), mm);
    cap.position.copy(ctx.P(t.x, t.y, h + capR * 0.35));
    cap.userData.role = 'post';
    cap.userData.termIdx = i;
    ctx.g.add(cap);
    // 隐形放大命中球（射线拾取用；端子很小，必须放大）
    var hit = new THREE.Mesh(sphGeo(capR * 1.7, 10), HIT_MAT());
    hit.position.copy(ctx.P(t.x, t.y, h + capR * 0.35));
    hit.userData.role = 'termHit';
    hit.userData.termIdx = i;
    hit.visible = true;
    ctx.g.add(hit);
  }
}
var _hitMat = null;
function HIT_MAT() {
  if (!_hitMat) { _hitMat = new THREE.MeshBasicMaterial({ visible: false }); _hitMat.userData.shared = true; }
  return _hitMat;
}

// ============================================================
//  元件构建器
//  每个 builder 收到 ctx：{ comp, rec, flip, fx, g, P(lx,ly,h), add(mesh) }
//  统一在局部坐标里搭（水平面 = 逻辑 x/y 平面，+Y 向上）；端子柱由 addTerminals 统一加。
// ============================================================
var BUILDERS = {};

// ── 定值电阻：圆柱 + 色环 ─────────────────────────────────
BUILDERS.resistor = function (ctx) {
  var M = materials(), R = ctx.comp.params && ctx.comp.params.R || 10;
  var bodyLen = 92, r = 19;
  var body = new THREE.Mesh(cylGeo(r, r, bodyLen, 20), mat(0xd9c9a3, { roughness: 0.55 }));
  body.rotation.z = Math.PI / 2;                 // 圆柱轴 → 局部 X
  body.position.copy(ctx.P(0, 0, 24));
  ctx.add(body);
  // 两端引出线（到 ±HALF）
  [1, -1].forEach(function (s) {
    var lead = new THREE.Mesh(cylGeo(2.4, 2.4, 28, 8), M.postNeu);
    lead.rotation.z = Math.PI / 2;
    lead.position.copy(ctx.P(s * (bodyLen / 2 + 14), 0, 22));
    ctx.add(lead);
  });
  // 色环（用 CircuitDraw 的电阻色环真值）
  try {
    var bands = D().resistorBands(R) || [];
    bands.forEach(function (col, k) {
      var ring = new THREE.Mesh(cylGeo(r * 1.03, r * 1.03, 5, 20), mat(parseInt(String(col).replace('#', '0x'), 16), { roughness: 0.5 }));
      ring.rotation.z = Math.PI / 2;
      ring.position.copy(ctx.P(-bodyLen / 2 + 14 + k * 12, 0, 24));
      ctx.add(ring);
    });
  } catch (e) {}
};

// ── 电源：塑料托盘 + 干电池圆柱（节数 = emf/1.5 反推）────────
BUILDERS.battery = function (ctx) {
  var M = materials();
  var emf = (ctx.comp.params && ctx.comp.params.emf) || 3;
  var cells = Math.max(1, Math.min(4, Math.round(emf / 1.5)));
  var tray = new THREE.Mesh(boxGeo(132, 22, 74), M.plastic);
  tray.position.copy(ctx.P(0, 6, 11));
  ctx.add(tray);
  var gap = 132 / cells, cellR = Math.min(15, gap * 0.36), cellLen = 62;
  for (var i = 0; i < cells; i++) {
    var cx = -66 + gap * (i + 0.5);
    var cyl = new THREE.Mesh(cylGeo(cellR, cellR, cellLen, 18), M.zinc);
    cyl.rotation.z = Math.PI / 2;
    cyl.position.copy(ctx.P(cx, 6, 26));
    ctx.add(cyl);
    var cap = new THREE.Mesh(cylGeo(cellR * 0.5, cellR * 0.5, 5, 12), M.brass);
    cap.rotation.z = Math.PI / 2;
    cap.position.copy(ctx.P(cx + cellLen / 2 + 2, 6, 26));
    ctx.add(cap);
  }
  // 铭牌
  var plate = new THREE.Mesh(boxGeo(56, 2, 20), M.darkBody);
  plate.position.copy(ctx.P(0, -20, 4));
  ctx.add(plate);
};

// ── 学生电源：台式稳压电源（面板电压表 + 旋钮 + 红黑接线柱）────
BUILDERS.power = function (ctx) {
  var M = materials();
  var emf = (ctx.comp.params && ctx.comp.params.emf) || 6;
  var flip = ctx.flip;
  // 机箱（立式仪器）
  var chassis = new THREE.Mesh(boxGeo(132, 108, 74), M.plastic);
  chassis.position.copy(ctx.P(0, 6, 54));
  ctx.add(chassis);
  // 面板（+Z 面）上的指示表：一块深色小窗 + 发光读数条
  var panel = new THREE.Mesh(boxGeo(96, 40, 3), mat(0x0f172a, { metalness: 0.2, roughness: 0.6 }));
  panel.position.copy(ctx.P(-12, -22, 110));
  ctx.add(panel);
  var readout = new THREE.Mesh(boxGeo(70, 14, 2), new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x22c55e, emissiveIntensity: 0.85, roughness: 0.5 }));
  readout.position.copy(ctx.P(-12, -22, 112));
  ctx.add(readout);
  // 电压旋钮（绕 Z 轴的圆柱）
  var knob = new THREE.Mesh(cylGeo(16, 16, 10, 18), M.brass);
  knob.rotation.x = Math.PI / 2;
  knob.position.copy(ctx.P(34, -22, 110));
  ctx.add(knob);
  var mark = new THREE.Mesh(boxGeo(3, 12, 3), M.darkBody);
  mark.position.copy(ctx.P(34, -14, 116));
  ctx.add(mark);
  // 底部散热格栅（几条横线）
  for (var i = 0; i < 3; i++) {
    var slot = new THREE.Mesh(boxGeo(96, 3, 2), M.darkBody);
    slot.position.copy(ctx.P(0, 40 + i * 8, 108));
    ctx.add(slot);
  }
  ctx.powerKnob = knob;
};

// ── 开关：底板 + 两触点 + 可转闸刀 ─────────────────────────
BUILDERS.switch = function (ctx) {
  var M = materials();
  var closed = !!(ctx.comp.params && ctx.comp.params.closed);
  var plate = new THREE.Mesh(boxGeo(140, 12, 56), M.plastic);
  plate.position.copy(ctx.P(0, 12, 6));
  ctx.add(plate);
  // 两个触点柱
  [-44, 44].forEach(function (x) {
    var post = new THREE.Mesh(cylGeo(7, 7, 12, 12), M.brass);
    post.position.copy(ctx.P(x, 0, 24));
    ctx.add(post);
  });
  // 闸刀：铰接在左触点，绕 Z 轴抬起
  var hinge = new THREE.Group();
  hinge.position.copy(ctx.P(-44, 0, 28));
  var blade = new THREE.Mesh(boxGeo(96, 4, 10), M.chrome);
  blade.position.set(96 / 2 * S, 0, 0);
  hinge.add(blade);
  hinge.rotation.z = closed ? 0 : 0.85;   // 抬起角（绕局部 Z）
  hinge.userData.role = 'blade';
  ctx.g.add(hinge);
  ctx.bladeHinge = hinge;
};

// ── 小灯泡：螺口 + 玻璃泡 + 灯丝 ───────────────────────────
BUILDERS.bulb = function (ctx) {
  var M = materials();
  var base = new THREE.Mesh(cylGeo(15, 17, 20, 18), M.chrome);
  base.position.copy(ctx.P(0, 0, 22));
  ctx.add(base);
  var neck = new THREE.Mesh(cylGeo(12, 15, 12, 16), M.darkBody);
  neck.position.copy(ctx.P(0, 0, 36));
  ctx.add(neck);
  // 玻璃泡：每个灯泡一份独立材质（发光要逐个改，共享材质会互相串）
  var glassMat = new THREE.MeshPhysicalMaterial({
    color: COLORS.glass, metalness: 0.0, roughness: 0.06,
    transparent: true, opacity: 0.34, side: THREE.DoubleSide,
    emissive: 0xffd9a0, emissiveIntensity: 0.0, clearcoat: 0.5, clearcoatRoughness: 0.1,
  });
  var bulb = new THREE.Mesh(sphGeo(26, 20), glassMat);
  bulb.position.copy(ctx.P(0, 0, 60));
  bulb.userData.role = 'bulbGlass';
  ctx.add(bulb);
  var fil = new THREE.Mesh(boxGeo(5, 5, 18), new THREE.MeshStandardMaterial({ color: COLORS.filament, emissive: 0xff9a3c, emissiveIntensity: 0.0, roughness: 0.5 }));
  fil.position.copy(ctx.P(0, 0, 56));
  fil.userData.role = 'filament';
  ctx.g.add(fil);
  var light = new THREE.PointLight(0xffd9a0, 0, 4.2);
  light.position.copy(ctx.P(0, 0, 60));
  light.userData.role = 'bulbLight';
  ctx.g.add(light);
  ctx.glow = { fil: fil, light: light, bulb: bulb };
};

// ── 发光二极管：半球罩 + 两引脚 ────────────────────────────
BUILDERS.led = function (ctx) {
  var M = materials();
  var color = (ctx.comp.params && ctx.comp.params.color) || 'red';
  var base = new THREE.Mesh(cylGeo(11, 12, 10, 16), M.plastic);
  base.position.copy(ctx.P(0, 0, 16));
  ctx.add(base);
  var domeCol = color === 'red' ? COLORS.ledRed : color === 'green' ? COLORS.ledGreen : COLORS.ledBlue;
  var dome = new THREE.Mesh(sphGeo(14, 18), new THREE.MeshStandardMaterial({
    color: domeCol, emissive: domeCol, emissiveIntensity: 0.0,
    transparent: true, opacity: 0.85, roughness: 0.25, metalness: 0.1,
  }));
  dome.position.copy(ctx.P(0, 0, 30));
  dome.userData.role = 'dome';
  ctx.g.add(dome);
  ctx.glow = { fil: dome, light: null, dome: dome };
};

// ── 电动机：机身 + 转轴 + 螺旋桨 ───────────────────────────
BUILDERS.motor = function (ctx) {
  var M = materials();
  var body = new THREE.Mesh(cylGeo(22, 22, 56, 20), M.steel);
  body.rotation.z = Math.PI / 2;
  body.position.copy(ctx.P(0, 0, 30));
  ctx.add(body);
  var shaft = new THREE.Mesh(cylGeo(3, 3, 40, 10), M.chrome);
  shaft.rotation.z = Math.PI / 2;
  shaft.position.copy(ctx.P(0, 0, 30));
  ctx.add(shaft);
  var prop = new THREE.Group();
  prop.position.copy(ctx.P(0, 0, 30));
  for (var i = 0; i < 3; i++) {
    var holder = new THREE.Group();
    holder.rotation.x = i * Math.PI * 2 / 3;
    var b = new THREE.Mesh(boxGeo(26, 2, 6), M.darkBody);
    b.position.set(13 * S, 0, 0);
    holder.add(b);
    prop.add(holder);
  }
  prop.userData.role = 'prop';
  ctx.g.add(prop);
  ctx.spin = prop;
};

// ── 电铃：铃碗 + 衔铁锤 + 线圈 ─────────────────────────────
BUILDERS.bell = function (ctx) {
  var M = materials();
  var coil = new THREE.Mesh(cylGeo(13, 13, 26, 16), mat(COLORS.copper, { metalness: 0.85, roughness: 0.35 }));
  coil.position.copy(ctx.P(-34, 0, 20));
  ctx.add(coil);
  var gong = new THREE.Mesh(new THREE.SphereGeometry(24 * S, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), M.chrome);
  gong.position.copy(ctx.P(34, 0, 30));
  ctx.add(gong);
  var hammer = new THREE.Group();
  hammer.position.copy(ctx.P(-34, 0, 34));
  var arm = new THREE.Mesh(boxGeo(60, 4, 6), M.steel);
  arm.position.set(30 * S, 0, 0);
  hammer.add(arm);
  var head = new THREE.Mesh(sphGeo(7, 12), M.darkBody);
  head.position.set(60 * S, 0, 0);
  hammer.add(head);
  hammer.userData.role = 'hammer';
  ctx.g.add(hammer);
  ctx.hammer = hammer;
};

// ── 表头（电流表 / 电压表）：表壳 + 表盘 + 指针 + 三柱 ──────
BUILDERS.ammeter = meterBuilder(false);
BUILDERS.voltmeter = meterBuilder(true);
function meterBuilder(isVolt) {
  return function (ctx) {
    var M = materials(), MET = D().MET;
    var caseHW = MET.CASE_HW, top = MET.CASE_TOP, bot = MET.CASE_BOT;
    var caseMesh = new THREE.Mesh(boxGeo(caseHW * 2, bot - top, 60), M.plastic);
    caseMesh.position.copy(ctx.P(0, (top + bot) / 2, (bot - top) / 2 + 2));
    ctx.add(caseMesh);
    // 表盘：贴在表壳【正面】（+Z 面）上的平面
    var dial = new THREE.Mesh(new THREE.PlaneGeometry(caseHW * 1.75 * S, (bot - top) * 0.82 * S),
      new THREE.MeshBasicMaterial({ map: makeDialTexture(isVolt), transparent: false }));
    dial.position.copy(ctx.P(0, (top + bot) / 2, (bot - top) + 3));
    ctx.add(dial);
    // 指针：细长盒，绕表盘法线（局部 Z）转
    var piv = MET.PIVOT;
    var pivotG = new THREE.Group();
    pivotG.position.copy(ctx.P(piv.x, piv.y, (bot - top) + 4));
    var needle = new THREE.Mesh(boxGeo(2, 52, 1.5), mat(0xdc2626, { metalness: 0.2, roughness: 0.5 }));
    needle.position.set(0, 52 / 2 * S, 0);   // 从转轴向上伸出
    pivotG.add(needle);
    pivotG.userData.role = 'needle';
    ctx.g.add(pivotG);
    ctx.needle = pivotG;
  };
}

// ── 滑动变阻器：瓷管 + 绕线 + 金属杆 + 滑片 + 四柱 ─────────
BUILDERS.rheostat = function (ctx) {
  var M = materials(), R = D().RHEO;
  var slide = D().slideOf(ctx.comp, ctx.rec);
  // 底座
  var base = new THREE.Mesh(boxGeo(R.BW, 10, R.BH), M.plastic);
  base.position.copy(ctx.P(0, 0, 5));
  ctx.add(base);
  // 瓷管
  var tube = new THREE.Mesh(cylGeo(R.cylH / 2, R.cylH / 2, R.cylW, 20), M.porcelain);
  tube.rotation.z = Math.PI / 2;
  tube.position.copy(ctx.P((R.cylX + R.cylX + R.cylW) / 2, R.cylY, R.cylH / 2 + 8));
  ctx.add(tube);
  // 绕线（几圈细环示意）
  for (var i = 0; i <= 12; i++) {
    var rx = R.cylX + i * (R.cylW / 12);
    var ring = new THREE.Mesh(torusGeo(R.cylH / 2 + 1, 1.1, 14), M.copper);
    ring.rotation.y = Math.PI / 2;
    ring.position.copy(ctx.P(rx, R.cylY, R.cylH / 2 + 8));
    ctx.add(ring);
  }
  // 金属杆
  var rod = new THREE.Mesh(cylGeo(3, 3, R.cylW + 40, 12), M.chrome);
  rod.rotation.z = Math.PI / 2;
  rod.position.copy(ctx.P((R.cylX + R.cylX + R.cylW) / 2, R.cylY - R.cylH / 2 - 10, R.cylH + 16));
  ctx.add(rod);
  // 滑片
  var knobX = D().sliderLocalX(slide);
  var knob = new THREE.Mesh(boxGeo(R.knobHalf * 2, 14, R.knobBottom - R.knobTop), M.brass);
  knob.position.copy(ctx.P(knobX, (R.knobTop + R.knobBottom) / 2, R.cylH + 20));
  knob.userData.role = 'knob';
  ctx.g.add(knob);
  ctx.knob = knob;
};

// ── 接线点：小球 ───────────────────────────────────────────
BUILDERS.junction = function (ctx) {
  var M = materials();
  var ball = new THREE.Mesh(sphGeo(7, 12), M.postNeu);
  ball.position.copy(ctx.P(0, 0, 6));
  ctx.add(ball);
};

// ============================================================
//  对外：构建一个元件
// ============================================================
export function hasBuilder(type) { return !!BUILDERS[type]; }
export function builderTypes() { return Object.keys(BUILDERS); }

export function buildComponent(comp, rec) {
  var flip = D().flipOf(comp);
  var g = new THREE.Group();
  g.userData.compId = comp.id;
  g.userData.compType = comp.type;
  var fx = flip ? -1 : 1;
  var ctx = {
    comp: comp, rec: rec, flip: flip, fx: fx, g: g,
    P: function (lx, ly, h) { return P3(fx, lx, ly, h); },
    add: function (m) { g.add(m); return m; },
  };
  var fn = BUILDERS[comp.type];
  if (fn) fn(ctx);
  addTerminals(ctx);
  g.position.copy(to3D(comp.x, comp.y, 0));
  g.rotation.y = -(comp.rot || 0) * Math.PI / 180;
  return g;
}

// ============================================================
//  导线：polyline 曲线 + 管
// ============================================================
class PolyCurve extends THREE.Curve {
  constructor(pts) {
    super();
    this.pts = pts;
    this.lens = [0];
    var L = 0;
    for (var i = 1; i < pts.length; i++) { L += pts[i].distanceTo(pts[i - 1]); this.lens.push(L); }
    this.total = L || 1e-6;
  }
  getPoint(t, target) {
    target = target || new THREE.Vector3();
    var d = Math.max(0, Math.min(1, t)) * this.total;
    var i = 1;
    while (i < this.lens.length && this.lens[i] < d) i++;
    if (i >= this.lens.length) return target.copy(this.pts[this.pts.length - 1]);
    var seg = this.lens[i] - this.lens[i - 1] || 1e-6;
    var u = (d - this.lens[i - 1]) / seg;
    return target.copy(this.pts[i - 1]).lerp(this.pts[i], u);
  }
}

// 取导线端点的世界坐标（含「元件被删后的悬空端」——必须走 endWorld）
function endPoint3D(scene, e) {
  if (!e) return null;
  var comp = null;
  if (e.compId) comp = findComp(scene, e.compId);
  var w = D().endWorld(comp, e);
  if (!w) return null;
  var h = (comp && e.compId) ? postHeight(comp.type) : 0;
  return to3D(w.x, w.y, h);
}
function findComp(scene, id) {
  for (var i = 0; i < scene.comps.length; i++) if (scene.comps[i].id === id) return scene.comps[i];
  return null;
}

export function buildWire(scene, wire) {
  var p0 = endPoint3D(scene, wire.a), p1 = endPoint3D(scene, wire.b);
  if (!p0 || !p1) return null;
  var via = wire.via || [];
  var hMax = Math.max(p0.y, p1.y, WIRE_Y);
  var pts = [];
  pts.push(p0.clone());
  if (Math.abs(p0.y - hMax) > 1e-6) pts.push(new THREE.Vector3(p0.x, hMax, p0.z));
  for (var i = 0; i < via.length; i++) {
    var v = to3D(via[i][0], via[i][1], 0);
    pts.push(new THREE.Vector3(v.x, hMax, v.z));
  }
  if (Math.abs(p1.y - hMax) > 1e-6) pts.push(new THREE.Vector3(p1.x, hMax, p1.z));
  pts.push(p1.clone());
  // 去重
  var clean = [pts[0]];
  for (var k = 1; k < pts.length; k++) if (pts[k].distanceTo(clean[clean.length - 1]) > 1e-5) clean.push(pts[k]);
  if (clean.length < 2) return null;
  var curve = new PolyCurve(clean);
  var radius = wire.broken ? 0.035 : 0.055;
  var tube = new THREE.TubeGeometry(curve, Math.max(8, clean.length * 4), radius, 8, false);
  var m = new THREE.Mesh(tube, materials().wire);
  m.userData.role = 'wire';
  m.userData.curve = curve;
  return m;
}

// ============================================================
//  文字标签（Sprite）
// ============================================================
export function makeLabel(text, opts) {
  opts = opts || {};
  var c = document.createElement('canvas');
  var fs = 44;
  var g = c.getContext('2d');
  g.font = 'bold ' + fs + 'px -apple-system,"PingFang SC",sans-serif';
  var tw = Math.ceil(g.measureText(text).width);
  c.width = tw + 28; c.height = fs + 22;
  g = c.getContext('2d');
  g.font = 'bold ' + fs + 'px -apple-system,"PingFang SC",sans-serif';
  g.fillStyle = opts.bg || 'rgba(2,6,23,0.72)';
  var r = 12;
  g.beginPath();
  g.moveTo(r, 0); g.lineTo(c.width - r, 0); g.quadraticCurveTo(c.width, 0, c.width, r);
  g.lineTo(c.width, c.height - r); g.quadraticCurveTo(c.width, c.height, c.width - r, c.height);
  g.lineTo(r, c.height); g.quadraticCurveTo(0, c.height, 0, c.height - r);
  g.lineTo(0, r); g.quadraticCurveTo(0, 0, r, 0); g.closePath(); g.fill();
  g.fillStyle = opts.color || '#e2e8f0';
  g.textBaseline = 'middle'; g.textAlign = 'center';
  g.fillText(text, c.width / 2, c.height / 2 + 2);
  var tex = new THREE.CanvasTexture(c);
  if (THREE.SRGBColorSpace && 'colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
  var mat_ = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  var sp = new THREE.Sprite(mat_);
  var scale = (opts.scale || 1) * 0.9;
  sp.scale.set(scale * c.width / c.height, scale, 1);
  sp.userData.role = 'label';
  return sp;
}

// ============================================================
//  表盘贴图
// ============================================================
export function makeDialTexture(isVolt) {
  var MET = D().MET, SW = D().MET_SWEEP;
  var c = document.createElement('canvas');
  c.width = 320; c.height = 224;
  var g = c.getContext('2d');
  // 白色表盘底
  g.fillStyle = '#f6f8fb'; g.fillRect(0, 0, c.width, c.height);
  var PX = c.width / (MET.CASE_HW * 2), // 逻辑 → 画布
      pivX = c.width / 2, pivY = c.height * 0.62;
  var R = 96;
  // 弧线
  g.strokeStyle = '#1f2937'; g.lineWidth = 2;
  g.beginPath();
  g.arc(pivX, pivY, R, SW.A0, SW.A1); g.stroke();
  // 刻度
  var total = 30;
  for (var i = 0; i <= total; i++) {
    var a = SW.A0 + (SW.A1 - SW.A0) * (i / total);
    var major = (i % 10 === 0);
    g.strokeStyle = major ? '#1f2937' : '#94a3b8';
    g.lineWidth = major ? 2.4 : 1;
    var r1 = R, r0 = R - (major ? 16 : 8);
    g.beginPath();
    g.moveTo(pivX + Math.cos(a) * r0, pivY + Math.sin(a) * r0);
    g.lineTo(pivX + Math.cos(a) * r1, pivY + Math.sin(a) * r1);
    g.stroke();
  }
  // 数字
  var hi = isVolt ? ['0', '5', '10', '15'] : ['0', '1', '2', '3'];
  g.fillStyle = '#1f2937'; g.font = 'bold 20px -apple-system,"PingFang SC",sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (var k = 0; k < hi.length; k++) {
    var ang = SW.A0 + (SW.A1 - SW.A0) * (k / (hi.length - 1));
    g.fillText(hi[k], pivX + Math.cos(ang) * (R + 22), pivY + Math.sin(ang) * (R + 22));
  }
  // 中央字母
  g.fillStyle = '#1f2937'; g.font = 'bold 34px -apple-system,"PingFang SC",sans-serif';
  g.fillText(isVolt ? 'V' : 'A', pivX, pivY - 34);
  var tex = new THREE.CanvasTexture(c);
  if (THREE.SRGBColorSpace && 'colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ============================================================
//  指针角度（与 circuit-draw 的 drawMeter 同一公式；自检断言与它同源）
// ============================================================
export function meterNeedleAngle(comp, rec) {
  var MET = D().MET, SW = D().MET_SWEEP;
  var reading = rec ? (rec.reading || 0) : 0;
  var range = (rec && rec.range) || (comp.params && comp.params.range) || (comp.type === 'voltmeter' ? 3 : 0.6);
  var rev = reading < -1e-9;
  var zeroed = !!(comp.params && comp.params.zeroed);
  var mag = Math.min(Math.abs(reading) / (range || 1), 1.06);
  var frac = rev ? -0.085 : Math.min(mag + (zeroed ? 0 : MET.ZERO_OFF), 1.06);
  return SW.A0 + (SW.A1 - SW.A0) * frac;
}

// ============================================================
//  台面 / 网格
// ============================================================
export function makeBench() {
  var g = new THREE.Group();
  var bench = new THREE.Mesh(boxGeo(W, 26, H), mat(COLORS.bench, { metalness: 0.1, roughness: 0.9 }));
  bench.position.set(0, -13 * S, 0);
  g.add(bench);
  // 网格线
  var pts = [];
  var step = 50;
  for (var x = 0; x <= W; x += step) {
    var a = to3D(x, 0, 4), b = to3D(x, H, 4);
    pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  for (var y = 0; y <= H; y += step) {
    var c1 = to3D(0, y, 4), c2 = to3D(W, y, 4);
    pts.push(c1.x, c1.y, c1.z, c2.x, c2.y, c2.z);
  }
  var gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  var lines = new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: 0x1e3a5f, transparent: true, opacity: 0.55 }));
  g.add(lines);
  g.userData.role = 'bench';
  return g;
}

// ============================================================
//  释放
// ============================================================
export function disposeGroup(g) {
  if (!g) return;
  g.traverse(function (o) {
    // 🔴 Sprite 的 geometry 是 three.js 的【全局单例】，绝不能 dispose
    //    （dispose 掉以后再画 Sprite 会报错/反复重传）。只释放它的贴图与材质。
    if (o.isSprite) {
      if (o.material) {
        if (o.material.map && !(o.material.map.userData && o.material.map.userData.shared)) { try { o.material.map.dispose(); } catch (e) {} }
        if (!(o.material.userData && o.material.userData.shared)) o.material.dispose();
      }
      return;
    }
    if (o.geometry && !(o.geometry.userData && o.geometry.userData.shared)) o.geometry.dispose();
    if (o.material) {
      var ms = Array.isArray(o.material) ? o.material : [o.material];
      ms.forEach(function (m) {
        if (m.userData && m.userData.shared) return;
        if (m.map && !(m.map.userData && m.map.userData.shared)) { try { m.map.dispose(); } catch (e) {} }
        m.dispose();
      });
    }
  });
}

export default {
  THREE, W, H, S, GRID, TABLE_Y, WIRE_Y, COLORS,
  to3D, worldToLogical, materials, postHeight, terminalAnchor,
  buildComponent, buildWire, makeLabel, makeDialTexture, meterNeedleAngle,
  hasBuilder, builderTypes, disposeGroup, makeBench,
};
