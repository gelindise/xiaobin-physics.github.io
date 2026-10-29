/* ============================================================
 * 电阻的微观解释 · 2D 微观粒子模拟
 * ------------------------------------------------------------
 * 设计要点（与全站实验页基线一致）：
 *   ① 舞台（.lab3d-stage）本身可全屏，参数面板 / 控制带都是它的后代
 *   ② 参数全部住在舞台里的可折叠面板 #params
 *
 * 物理模型（初中学段，但内部自洽）：
 *   · 自由电子 = 热运动（速率 v_th，方向随机）+ 叠加的定向漂移 v_d
 *   · 正离子在晶格点上做热振动，振幅 ∝ 温度
 *   · 电子与离子的碰撞判定半径 = ION_R + E_R + 振动振幅
 *     ⇒ 温度越高，离子扫过的区域越大，电子被撞得越频繁
 *   · R = R20·(1 + α(T−20))；I = U/R；P = I²R
 *   · 碰撞次数只由温度决定、与电压无关 —— 这正是「电压不改变电阻」
 * ============================================================ */
(function () {
'use strict';

var W = 1320, H = 820;
var TAU = Math.PI * 2;

/* ============================================================
 * 几何
 * ============================================================ */
var COND = { x: 110, y: 320, w: 1100, h: 440 };   // 微观导体内部
var COLS = 14, ROWS = 6;
var CELL_W = COND.w / COLS;
var GRID_TOP = 46, GRID_BOT = 12;                 // 晶格上下留白（顶部给「电场 / 电子」两个方向标）
var CELL_H = (COND.h - GRID_TOP - GRID_BOT) / ROWS;
var ION_R = 13, E_R = 5;
var SLICE_X = COND.x + CELL_W * 8;                // 「通过截面」那条竖线

var BAR = { x: 460, y: 206, w: 440, h: 26 };      // 电路里的那根导体
var BAT = { x: 330, y: 76, w: 66 };
var SWT = { x: 560, y: 76, w: 58 };
var AMM = { x: 930, y: 80, r: 40 };

/* 电流路径（逆时针：电池正极 → 左 → 下 → 右穿过导体 → 上 → 左穿过电流表/开关 → 电池负极） */
var PATH = [
  [298, 76], [200, 76], [200, 206], [BAR.x, 206],
  [BAR.x + BAR.w, 206], [1120, 206], [1120, 76],
  [AMM.x + AMM.r + 6, 76], [AMM.x - AMM.r - 6, 76],
  [SWT.x + 29, 76], [SWT.x - 29, 76], [362, 76]
];

/* ============================================================
 * 导体 / 载流子
 * ------------------------------------------------------------
 * carrier 决定三件事：能自由移动的是什么电荷、微观画面怎么画、R(T) 怎么变。
 *   metal       —— 自由电子（带负电，逆电场方向漂移）
 *   insulator   —— 没有自由电荷，电子被原子束缚在原地绕转
 *   electrolyte —— 正、负离子同时存在，向相反方向漂移
 * ============================================================ */
var MATS = {
  cu: {
    key: 'cu', name: '铜丝', carrier: 'metal',
    R20: 1.2, alpha: 0.0039,
    spec: '铜丝：长 1 m，横截面积 0.1 mm²',
    note: '金属 · 铜的电阻小，温度影响很明显。'
  },
  nicr: {
    key: 'nicr', name: '镍铬合金丝', carrier: 'metal',
    R20: 12.0, alpha: 0.0004,
    spec: '镍铬合金丝：长 1 m，横截面积 0.1 mm²',
    note: '金属 · 镍铬合金电阻大，但几乎不随温度变化。'
  },
  glass: {
    key: 'glass', name: '玻璃棒', carrier: 'insulator',
    R20: 1e14, alpha: 0,
    spec: '玻璃棒：长 10 cm，横截面积 1 cm²',
    note: '绝缘体 · 电子被原子牢牢束缚，几乎没有能自由移动的电荷。'
  },
  salt: {
    key: 'salt', name: '食盐水', carrier: 'electrolyte',
    R20: 5, beta: 0.02,
    spec: '食盐水：两片电极相距 1 cm，浸没面积 4 cm²',
    note: '电解质溶液 · 正负离子都能移动，温度升高反而更容易导电。'
  }
};

/* ============================================================
 * 状态
 * ============================================================ */
var state = {
  T: 20, U: 2.0, mat: 'cu', running: true,
  trail: true, spark: true, field: true, label: true,
  t: 0
};

var lattice = [];   // 晶格原子（金属：正离子 / 玻璃：原子实），两种共用同一套格点
var movers = [];    // 能自由移动的载流子（金属：电子 / 溶液：正负离子）
var bound = [];     // 玻璃：被束缚在原子上的电子
var sparks = [];
var hitAcc = 0, hitRate = 0, hitTimer = 0;
/* 各类载流子的 x 方向平均速度（EMA）：热运动相互抵消后只剩定向漂移，
   单次采样噪声太大，必须平滑才看得出「正离子向右、负离子向左」。 */
var vxAvg = { na: 0, cl: 0, e: 0 };
var sliceFlash = 0, flowPhase = 0;
var dpr = 1, renderCount = 0, isFull = false;

var stageEl = document.getElementById('stage');
var canvas = document.getElementById('simCanvas');
var ctx = canvas.getContext('2d');
var paramsEl = document.getElementById('params');

/* ============================================================
 * 物理
 * ============================================================ */
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function curMat() { return MATS[state.mat]; }
function carrier() { return curMat().carrier; }

/* 盐水只能到 95 ℃（再高就沸腾了），金属 / 玻璃给到 300 ℃ */
function tempRange() {
  return carrier() === 'electrolyte' ? { lo: 0, hi: 95 } : { lo: -20, hi: 300 };
}
function normT() {
  var r = tempRange();
  return clamp((state.T - r.lo) / (r.hi - r.lo), 0, 1);
}

function resistance() {
  var m = curMat();
  /* 绝缘体：电阻大到电流根本测不出来，且与温度几乎无关（教学简化） */
  if (m.carrier === 'insulator') return m.R20;
  /* 电解质溶液：温度升高黏度下降、离子跑得更快 ⇒ 电阻变小（与金属相反） */
  if (m.carrier === 'electrolyte') return m.R20 / (1 + m.beta * (state.T - 20));
  return m.R20 * (1 + m.alpha * (state.T - 20));
}
function current() { return state.U / resistance(); }
function power() { var i = current(); return i * i * resistance(); }

/* 热运动速率（px/s）：温度越高电荷也跑得越快，但幅度远小于原子振幅的变化。
   溶液里的离子质量比电子大得多，同样温度下热运动明显更慢 ——
   画面上不压一压，离子的定向移动就会被乱窜完全盖住。 */
function vThermal() {
  var base = 150 + 78 * normT();
  return carrier() === 'electrolyte' ? base * 0.55 : base;
}
/* 定向漂移速率（px/s）：只由电流决定 ⇒ 电压↑ 或 电阻↓ 时变快。
   溶液里离子的真实漂移比金属电子慢几个数量级，画面上放大 1.5 倍才看得出方向。 */
function vDrift() {
  var s = carrier() === 'electrolyte' ? 1.5 : 1;
  return 152 * s * (current() / 2.2);
}
/* 原子振动振幅 / 角频率 */
function ionAmp() { return 1.0 + 11.0 * normT(); }
function ionOmega() { return 4.2 + 7.5 * normT(); }
/* 碰撞判定半径：原子晃得越远，越容易被电子撞上 */
function collideR() { return ION_R + E_R + ionAmp() * 0.85; }
/* 每秒通过截面的载流子数 = 线密度 × 定向移动速率（与电流严格成正比）。
   🔴 不能靠「数穿越次数」：热运动是双向的，往返次数远大于净流量，
      按次数统计会得出「温度越高通过越多」的反向结论。 */
function fluxNow() { return (movers.length / COND.w) * vDrift(); }

/* ============================================================
 * 粒子
 * ============================================================ */
var ION_POS = (function () {
  var out = [];
  for (var j = 0; j < ROWS; j++) {
    for (var i = 0; i < COLS; i++) {
      out.push({
        bx: COND.x + (i + 0.5) * CELL_W,
        by: COND.y + GRID_TOP + (j + 0.5) * CELL_H
      });
    }
  }
  return out;
})();

function initLattice() {
  lattice.length = 0;
  for (var i = 0; i < ION_POS.length; i++) {
    var p = ION_POS[i];
    lattice.push({
      bx: p.bx, by: p.by, x: p.bx, y: p.by,
      ph: Math.random() * TAU, ph2: Math.random() * TAU,
      flash: 0
    });
  }
}

/* 玻璃：每个原子外面挂一个被束缚的电子，只在原地绕转、不参与导电 */
function initBound() {
  bound.length = 0;
  if (carrier() !== 'insulator') return;
  for (var i = 0; i < lattice.length; i++) {
    bound.push({
      atom: lattice[i],
      ang: Math.random() * TAU,
      spin: 1.3 + Math.random() * 0.9,
      r: 22 + Math.random() * 5
    });
  }
}

function initMovers() {
  movers.length = 0;
  var c = carrier(), k, th, v;

  if (c === 'metal') {
    for (k = 0; k < 64; k++) {
      th = Math.random() * TAU; v = vThermal() * (0.7 + Math.random() * 0.6);
      movers.push({
        kind: 'e', dir: -1, r: E_R,
        x: COND.x + 24 + Math.random() * (COND.w - 48),
        y: COND.y + 34 + Math.random() * (COND.h - 48),
        px: 0,
        vx: Math.cos(th) * v, vy: Math.sin(th) * v,
        cool: 0, trail: []
      });
    }
  } else if (c === 'electrolyte') {
    /* 一半正离子（Na⁺，向负极 = 向右漂），一半负离子（Cl⁻，向正极 = 向左漂） */
    for (k = 0; k < 56; k++) {
      var pos = k % 2 === 0;
      th = Math.random() * TAU; v = vThermal() * (0.7 + Math.random() * 0.6);
      movers.push({
        kind: pos ? 'na' : 'cl',
        dir: pos ? 1 : -1,
        r: pos ? 12 : 11,
        x: COND.x + 26 + Math.random() * (COND.w - 52),
        y: COND.y + 34 + Math.random() * (COND.h - 48),
        px: 0,
        vx: Math.cos(th) * v, vy: Math.sin(th) * v,
        cool: 0, trail: []
      });
    }
  }
}

/* 换导体：整套粒子重建 */
function rebuild() {
  sparks.length = 0;
  lattice.length = 0; movers.length = 0; bound.length = 0;
  if (carrier() !== 'electrolyte') initLattice();
  initBound();
  initMovers();
  hitRate = 0; hitAcc = 0; hitTimer = 0;
  vxAvg.na = 0; vxAvg.cl = 0; vxAvg.e = 0;
}

/* ============================================================
 * 步进
 * ============================================================ */
function scatter(e, amt) {
  var sp = Math.sqrt(e.vx * e.vx + e.vy * e.vy) || vThermal();
  var a = Math.atan2(e.vy, e.vx) + (Math.random() - 0.5) * amt * 2;
  e.vx = Math.cos(a) * sp;
  e.vy = Math.sin(a) * sp;
}

function step(dt) {
  dt = Math.min(dt, 0.05);
  if (!state.running) return;

  state.t += dt;

  var c = carrier();
  var amp = ionAmp(), om = ionOmega();
  var vth = vThermal(), vd = vDrift(), rCol = collideR();
  var r2 = rCol * rCol;

  /* ---- 晶格振动（金属 / 玻璃） ---- */
  for (var i = 0; i < lattice.length; i++) {
    var at = lattice[i];
    at.x = at.bx + Math.sin(state.t * om + at.ph) * amp;
    at.y = at.by + Math.cos(state.t * om * 0.82 + at.ph2) * amp * 0.82;
    if (at.flash > 0) at.flash = Math.max(0, at.flash - dt / 0.30);
  }

  /* ---- 玻璃：束缚电子只在原地绕原子转，不整体移动 ---- */
  for (var b = 0; b < bound.length; b++) bound[b].ang += bound[b].spin * dt;

  /* ---- 可移动载流子 ---- */
  for (var k = 0; k < movers.length; k++) {
    var e = movers[k];
    e.px = e.x;
    e.x += (e.vx + e.dir * vd) * dt;
    e.y += e.vy * dt;

    var top = COND.y + e.r + 4, bot = COND.y + COND.h - e.r - 4;
    if (e.y < top) { e.y = top; e.vy = Math.abs(e.vy); }
    if (e.y > bot) { e.y = bot; e.vy = -Math.abs(e.vy); }

    /* 溶液两端有电极板（各 16 px），离子要躲开它 */
    var pad = c === 'electrolyte' ? 24 : 6;
    var lx = COND.x + e.r + pad, rx = COND.x + COND.w - e.r - pad;
    if (e.x < lx) { e.x = rx; e.px = rx; }
    if (e.x > rx) { e.x = lx; e.px = lx; }

    /* 穿过截面：只让「沿定向移动方向」的那次闪一下
       （🔴 流量读数不靠数穿越次数，见 fluxNow 的注释） */
    if (e.dir > 0 ? (e.px < SLICE_X && e.x >= SLICE_X)
                  : (e.px > SLICE_X && e.x <= SLICE_X)) sliceFlash = 1;

    if (e.cool > 0) e.cool -= dt;

    /* 金属：电子撞晶格上的正离子 ⇒ 散射 + 闪光 */
    if (c === 'metal' && e.cool <= 0) {
      for (var m = 0; m < lattice.length; m++) {
        var io = lattice[m];
        var dx = e.x - io.x, dy = e.y - io.y;
        var d2 = dx * dx + dy * dy;
        if (d2 < r2 && d2 > 1e-4) {
          var d = Math.sqrt(d2);
          var th = Math.random() * TAU;
          var nv = vth * (0.7 + Math.random() * 0.6);
          e.vx = Math.cos(th) * nv;
          e.vy = Math.sin(th) * nv;
          e.x = io.x + dx / d * (rCol + 0.6);
          e.y = io.y + dy / d * (rCol + 0.6);
          e.cool = 0.10;
          io.flash = 1;
          hitAcc++;
          if (sparks.length < 80) {
            sparks.push({ x: io.x + dx * 0.35, y: io.y + dy * 0.35, t: 0, life: 0.30 });
          }
          break;
        }
      }
    }

    /* 拖尾只给金属的自由电子（溶液里 56 个离子都拖尾会糊成一片） */
    if (e.kind === 'e') {
      e.trail.push(e.x, e.y);
      if (e.trail.length > 18) e.trail.splice(0, 2);
    }
  }

  /* ---- 溶液：离子之间互相碰撞（只轻微偏转，不打断定向移动） ---- */
  if (c === 'electrolyte') {
    for (var p = 0; p < movers.length; p++) {
      var a1 = movers[p];
      if (a1.cool > 0) continue;
      for (var q = p + 1; q < movers.length; q++) {
        var a2 = movers[q];
        if (a2.cool > 0) continue;
        var ddx = a1.x - a2.x, ddy = a1.y - a2.y;
        var rr = a1.r + a2.r;
        if (ddx * ddx + ddy * ddy < rr * rr) {
          var dd = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
          var push = (rr - dd) / 2 + 0.5;
          a1.x += ddx / dd * push; a1.y += ddy / dd * push;
          a2.x -= ddx / dd * push; a2.y -= ddy / dd * push;
          scatter(a1, 0.45); scatter(a2, 0.45);
          a1.cool = a2.cool = 0.12;
          hitAcc++;
          if (sparks.length < 80) {
            sparks.push({ x: (a1.x + a2.x) / 2, y: (a1.y + a2.y) / 2, t: 0, life: 0.26 });
          }
          break;
        }
      }
    }
  }

  /* ---- 闪光衰减 ---- */
  for (var s = sparks.length - 1; s >= 0; s--) {
    sparks[s].t += dt;
    if (sparks[s].t > sparks[s].life) sparks.splice(s, 1);
  }
  sliceFlash = Math.max(0, sliceFlash - dt * 2.6);

  /* ---- 碰撞率统计（1 s 窗口） ---- */
  hitTimer += dt;
  if (hitTimer >= 1.0) { hitRate = hitAcc / hitTimer; hitAcc = 0; hitTimer = 0; }

  /* ---- 各类载流子的平均 x 速度（EMA） ---- */
  var vs = { na: 0, cl: 0, e: 0 }, vn = { na: 0, cl: 0, e: 0 };
  for (var vi = 0; vi < movers.length; vi++) {
    var mv = movers[vi];
    vs[mv.kind] += mv.vx + mv.dir * vd;
    vn[mv.kind]++;
  }
  var vk = Math.min(0.5, dt * 2.0);
  vxAvg.na = vn.na ? vxAvg.na * (1 - vk) + (vs.na / vn.na) * vk : 0;
  vxAvg.cl = vn.cl ? vxAvg.cl * (1 - vk) + (vs.cl / vn.cl) * vk : 0;
  vxAvg.e = vn.e ? vxAvg.e * (1 - vk) + (vs.e / vn.e) * vk : 0;

  /* ---- 导线上的电流粒子 ---- */
  flowPhase += (96 * (current() / 2.0)) * dt;
}

/* ============================================================
 * 绘制工具
 * ============================================================ */
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function mix(a, b, t) {
  return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * t) + ',' +
                  Math.round(a[1] + (b[1] - a[1]) * t) + ',' +
                  Math.round(a[2] + (b[2] - a[2]) * t) + ')';
}

/* 电流路径分段（预计算） */
var segs = [], totalLen = 0;
(function () {
  for (var i = 0; i < PATH.length - 1; i++) {
    var a = PATH[i], b = PATH[i + 1];
    var len = Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1]));
    segs.push({ a: a, b: b, len: len, start: totalLen });
    totalLen += len;
  }
})();
function pathPoint(s) {
  s = ((s % totalLen) + totalLen) % totalLen;
  for (var i = 0; i < segs.length; i++) {
    if (s <= segs[i].start + segs[i].len) {
      var t = (s - segs[i].start) / segs[i].len;
      return [segs[i].a[0] + (segs[i].b[0] - segs[i].a[0]) * t,
              segs[i].a[1] + (segs[i].b[1] - segs[i].a[1]) * t];
    }
  }
  return PATH[PATH.length - 1];
}

/* 电子 sprite（预渲染，避免每帧建渐变） */
var eSprite = null;
function buildElectronSprite() {
  var s = 26;
  eSprite = document.createElement('canvas');
  eSprite.width = s; eSprite.height = s;
  var c = eSprite.getContext('2d');
  var g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(240,249,255,1)');
  g.addColorStop(0.30, 'rgba(147,197,253,1)');
  g.addColorStop(0.52, 'rgba(59,130,246,0.85)');
  g.addColorStop(1, 'rgba(37,99,235,0)');
  c.fillStyle = g;
  c.beginPath(); c.arc(s / 2, s / 2, s / 2, 0, TAU); c.fill();
}

/* ============================================================
 * 宏观电路
 * ============================================================ */
function drawCircuit() {
  /* 导线 */
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(PATH[0][0], PATH[0][1]);
  for (var i = 1; i < PATH.length; i++) ctx.lineTo(PATH[i][0], PATH[i][1]);
  ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 9; ctx.stroke();
  ctx.strokeStyle = '#64748b'; ctx.lineWidth = 4; ctx.stroke();
  ctx.restore();

  drawFlow();
  drawBattery();
  drawSwitch();
  drawAmmeter();
  drawBar();
}

function drawFlow() {
  var I = current();
  var on = I > 1e-6;
  var alpha = on ? clamp(0.45 + I * 0.28, 0.45, 1) : 0.28;
  ctx.save();
  for (var k = 0; k < 34; k++) {
    var p = pathPoint(flowPhase + k * totalLen / 34);
    ctx.beginPath();
    ctx.arc(p[0], p[1], 2.6, 0, TAU);
    ctx.fillStyle = 'rgba(248,113,113,' + alpha + ')';
    ctx.fill();
  }
  ctx.restore();
}

function drawBattery() {
  var cx = BAT.x, y = BAT.y;
  ctx.save();
  ctx.lineCap = 'round';
  /* 第 1 节：长线（正极）在左 */
  ctx.strokeStyle = '#f1f5f9';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(cx - 20, y - 19); ctx.lineTo(cx - 20, y + 19); ctx.stroke();
  ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(cx - 8, y - 10); ctx.lineTo(cx - 8, y + 10); ctx.stroke();
  /* 第 2 节 */
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(cx + 8, y - 19); ctx.lineTo(cx + 8, y + 19); ctx.stroke();
  ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(cx + 20, y - 10); ctx.lineTo(cx + 20, y + 10); ctx.stroke();
  ctx.restore();

  ctx.fillStyle = '#cbd5e1';
  ctx.font = 'bold 12px Inter, "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('3 V', cx, y - 32);
  ctx.fillStyle = 'rgba(148,163,184,.75)';
  ctx.font = '10.5px Inter, "Microsoft YaHei", sans-serif';
  ctx.fillText('电源', cx, y + 32);
}

function drawSwitch() {
  var y = SWT.y;
  ctx.save();
  /* 接线柱 */
  [[SWT.x - 29, y], [SWT.x + 29, y]].forEach(function (p) {
    ctx.beginPath(); ctx.arc(p[0], p[1], 4.5, 0, TAU);
    ctx.fillStyle = '#cbd5e1'; ctx.fill();
  });
  /* 刀片（闭合） */
  ctx.beginPath();
  ctx.moveTo(SWT.x - 29, y);
  ctx.lineTo(SWT.x + 26, y - 2);
  ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.stroke();
  /* 把手 */
  ctx.beginPath();
  ctx.moveTo(SWT.x + 12, y - 1);
  ctx.lineTo(SWT.x + 30, y - 9);
  ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 3; ctx.stroke();
  ctx.restore();
}

function drawAmmeter() {
  var cx = AMM.x, cy = AMM.y, r = AMM.r;
  var I = current();
  var range = I <= 0.6 ? 0.6 : 3;

  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU);
  ctx.fillStyle = '#0b1220'; ctx.fill();
  ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 2.5; ctx.stroke();

  /* 刻度弧 */
  ctx.beginPath();
  ctx.arc(cx, cy, r - 7, -150 * Math.PI / 180, -30 * Math.PI / 180);
  ctx.strokeStyle = '#64748b'; ctx.lineWidth = 2; ctx.stroke();

  /* 刻度线 */
  for (var i = 0; i <= 5; i++) {
    var a = (-150 + 120 * i / 5) * Math.PI / 180;
    var r1 = r - 7, r2 = r - (i % 5 === 0 ? 15 : 11);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
    ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1.5; ctx.stroke();
  }

  /* 指针 */
  var frac = clamp(I / range, 0, 1);
  var ang = (-150 + 120 * frac) * Math.PI / 180;
  ctx.beginPath();
  ctx.moveTo(cx - Math.cos(ang) * 5, cy - Math.sin(ang) * 5);
  ctx.lineTo(cx + Math.cos(ang) * (r - 9), cy + Math.sin(ang) * (r - 9));
  ctx.strokeStyle = '#f87171'; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
  ctx.stroke();

  ctx.beginPath(); ctx.arc(cx, cy, 3.4, 0, TAU);
  ctx.fillStyle = '#f87171'; ctx.fill();

  ctx.fillStyle = '#94a3b8';
  ctx.font = 'bold 13px Inter, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('A', cx, cy + 20);
  ctx.restore();
}

function drawBar() {
  var c = carrier();
  var heat = clamp(power() / 8, 0, 1);
  var x = BAR.x, y = BAR.y, w = BAR.w, h = BAR.h;

  if (c === 'insulator') {
    /* 玻璃棒：半透明，几乎不发热 */
    roundRect(x, y - h / 2, w, h, 6);
    ctx.fillStyle = 'rgba(186,230,253,.14)'; ctx.fill();
    ctx.strokeStyle = 'rgba(186,230,253,.55)'; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.13)';
    ctx.fillRect(x + 8, y - h / 2 + 3, w - 16, 3.5);
  } else if (c === 'electrolyte') {
    /* 盐水柱：淡青的液体 */
    var gl = ctx.createLinearGradient(0, y - h / 2, 0, y + h / 2);
    gl.addColorStop(0, 'rgba(34,211,238,.42)');
    gl.addColorStop(1, 'rgba(14,116,144,.62)');
    roundRect(x, y - h / 2, w, h, 6);
    ctx.fillStyle = gl; ctx.fill();
    ctx.strokeStyle = 'rgba(103,232,249,.5)'; ctx.lineWidth = 1.4; ctx.stroke();
  } else {
    /* 金属：铜色，电流越大越热 */
    if (heat > 0.02) {
      ctx.save();
      ctx.shadowColor = 'rgba(251,146,60,' + (0.55 * heat) + ')';
      ctx.shadowBlur = 26 * heat;
      roundRect(x, y - h / 2, w, h, 6);
      ctx.fillStyle = 'rgba(180,83,9,.9)'; ctx.fill();
      ctx.restore();
    }
    var g = ctx.createLinearGradient(0, y - h / 2, 0, y + h / 2);
    g.addColorStop(0, mix([120, 53, 15], [253, 186, 116], heat));
    g.addColorStop(0.45, mix([180, 83, 9], [251, 146, 60], heat));
    g.addColorStop(1, mix([120, 53, 15], [194, 65, 12], heat));
    roundRect(x, y - h / 2, w, h, 6);
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(253,230,138,.45)'; ctx.lineWidth = 1.4; ctx.stroke();
  }

  /* 棒里的「电流 I →」：玻璃 / 盐水的棒身是浅色的，白字会糊掉 ⇒ 换深色字 + 浅描边 */
  ctx.save();
  var lightBar = (c === 'insulator');
  ctx.font = 'bold 13px Inter, "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  var barTxt = c === 'insulator' ? '几乎没有电流' : '电流 I  →';
  ctx.lineWidth = 3.2; ctx.lineJoin = 'round';
  ctx.strokeStyle = lightBar ? 'rgba(248,250,252,.55)' : 'rgba(2,6,23,.55)';
  ctx.strokeText(barTxt, x + w / 2, y + 1);
  ctx.fillStyle = lightBar ? 'rgba(8,47,73,.95)' : 'rgba(255,255,255,.94)';
  ctx.fillText(barTxt, x + w / 2, y + 1);
  ctx.restore();

  /* 导体标注（规格随材料变） */
  if (state.label) {
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '12.5px Inter, "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(curMat().spec, x + w / 2, y - h / 2 - 12);
  }
}

function drawZoom() {
  ctx.save();
  ctx.setLineDash([7, 7]);
  ctx.strokeStyle = 'rgba(56,189,248,.30)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(BAR.x + 6, BAR.y + BAR.h / 2);
  ctx.lineTo(COND.x + 30, COND.y);
  ctx.moveTo(BAR.x + BAR.w - 6, BAR.y + BAR.h / 2);
  ctx.lineTo(COND.x + COND.w - 30, COND.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  ctx.fillStyle = 'rgba(125,211,252,.8)';
  ctx.font = 'bold 12px Inter, "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('微观放大', (COND.x + COND.w) / 2, (BAR.y + BAR.h / 2 + COND.y) / 2);
}

/* ============================================================
 * 微观视图
 * ============================================================ */
function drawMicro() {
  var c = carrier();

  /* 背景 */
  roundRect(COND.x, COND.y, COND.w, COND.h, 14);
  var bg = ctx.createLinearGradient(0, COND.y, 0, COND.y + COND.h);
  if (c === 'electrolyte') {
    bg.addColorStop(0, 'rgba(10,44,62,.97)');
    bg.addColorStop(1, 'rgba(6,26,40,.97)');
  } else {
    bg.addColorStop(0, 'rgba(13,28,46,.97)');
    bg.addColorStop(1, 'rgba(5,12,22,.97)');
  }
  ctx.fillStyle = bg; ctx.fill();
  ctx.strokeStyle = c === 'insulator' ? 'rgba(148,163,184,.42)' : 'rgba(56,189,248,.38)';
  ctx.lineWidth = 2; ctx.stroke();

  ctx.save();
  roundRect(COND.x, COND.y, COND.w, COND.h, 14);
  ctx.clip();

  /* 管壁高光：让它看起来是一段被放大的导体内部，而不是一块黑板 */
  var wall = ctx.createLinearGradient(0, COND.y, 0, COND.y + 46);
  wall.addColorStop(0, 'rgba(56,189,248,.13)');
  wall.addColorStop(1, 'rgba(56,189,248,0)');
  ctx.fillStyle = wall;
  ctx.fillRect(COND.x, COND.y, COND.w, 46);
  var wall2 = ctx.createLinearGradient(0, COND.y + COND.h - 46, 0, COND.y + COND.h);
  wall2.addColorStop(0, 'rgba(56,189,248,0)');
  wall2.addColorStop(1, 'rgba(56,189,248,.10)');
  ctx.fillStyle = wall2;
  ctx.fillRect(COND.x, COND.y + COND.h - 46, COND.w, 46);

  if (c === 'electrolyte') drawElectrodes();
  if (state.field) drawField();
  if (lattice.length) drawLattice();
  if (bound.length) drawBound();
  drawMovers();
  if (state.spark) drawSparks();
  drawSlice();

  ctx.restore();
}

/* 溶液两端的两块电极：左正右负 ⇒ 电场向右、正离子向右跑 */
function drawElectrodes() {
  var top = COND.y + 30, bot = COND.y + COND.h - 30;
  var plates = [
    { x: COND.x + 4, c: '#f87171', sign: '+' },
    { x: COND.x + COND.w - 16, c: '#60a5fa', sign: '−' }
  ];
  for (var i = 0; i < plates.length; i++) {
    var p = plates[i];
    var g = ctx.createLinearGradient(p.x, 0, p.x + 12, 0);
    g.addColorStop(0, 'rgba(148,163,184,.15)');
    g.addColorStop(0.5, p.c);
    g.addColorStop(1, 'rgba(148,163,184,.15)');
    ctx.fillStyle = g;
    ctx.fillRect(p.x, top, 12, bot - top);
    ctx.fillStyle = p.c;
    ctx.font = 'bold 14px Inter, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(p.sign, p.x + 6, top - 16);
  }
}

function drawField() {
  var c = carrier();
  var y = COND.y + 28;

  ctx.save();

  /* 绝缘体：没有能跑的电荷，只标一句话 */
  if (c === 'insulator') {
    ctx.fillStyle = 'rgba(203,213,225,.55)';
    ctx.font = '12.5px Inter, "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('电子被原子牢牢束缚 —— 没有能自由移动的电荷', (COND.x + COND.w) / 2, y);
    ctx.restore();
    return;
  }

  /* 左半：电场方向（向右） */
  ctx.setLineDash([9, 8]);
  ctx.strokeStyle = 'rgba(125,211,252,.22)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(COND.x + 24, y);
  ctx.lineTo(COND.x + COND.w * 0.44, y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(COND.x + COND.w * 0.44 - 13, y - 5);
  ctx.lineTo(COND.x + COND.w * 0.44, y);
  ctx.lineTo(COND.x + COND.w * 0.44 - 13, y + 5);
  ctx.strokeStyle = 'rgba(125,211,252,.5)';
  ctx.lineWidth = 1.8; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.fillStyle = 'rgba(125,211,252,.6)';
  ctx.font = '11px Inter, "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  if (state.label) ctx.fillText('电场 E', COND.x + 26, y - 13);

  if (c === 'metal') {
    /* 右半：电子逆电场方向移动（向左） */
    var x1 = COND.x + COND.w * 0.56, x2 = COND.x + COND.w - 26;
    ctx.beginPath();
    ctx.moveTo(x2, y); ctx.lineTo(x1, y);
    ctx.strokeStyle = 'rgba(147,197,253,.42)';
    ctx.lineWidth = 1.6; ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x1 + 13, y - 5); ctx.lineTo(x1, y); ctx.lineTo(x1 + 13, y + 5);
    ctx.strokeStyle = 'rgba(147,197,253,.72)'; ctx.lineWidth = 1.8; ctx.stroke();
    ctx.fillStyle = 'rgba(147,197,253,.72)';
    ctx.textAlign = 'right';
    if (state.label) ctx.fillText('电子定向移动', x2, y - 13);
  } else {
    /* 溶液：正离子顺电场向右、负离子逆电场向左 —— 两条箭头反向 */
    var lx = COND.x + COND.w * 0.55, rx = COND.x + COND.w - 26;
    arrow(lx, rx, y, 'rgba(251,146,60,.85)', 1);      // 向右
    arrow(lx, rx, y + 22, 'rgba(34,211,238,.85)', -1); // 向左
    ctx.font = '11px Inter, "Microsoft YaHei", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(251,146,60,.9)';
    ctx.textAlign = 'left';
    if (state.label) ctx.fillText('Na⁺ 向负极', lx, y - 13);
    ctx.fillStyle = 'rgba(34,211,238,.9)';
    ctx.textAlign = 'right';
    if (state.label) ctx.fillText('Cl⁻ 向正极', rx, y + 35);
  }

  ctx.restore();

  function arrow(ax, bx, ay, color, dir) {
    ctx.beginPath();
    ctx.moveTo(dir > 0 ? ax : bx, ay);
    ctx.lineTo(dir > 0 ? bx : ax, ay);
    ctx.strokeStyle = color; ctx.lineWidth = 1.6;
    ctx.setLineDash([8, 7]); ctx.stroke(); ctx.setLineDash([]);
    var tip = dir > 0 ? bx : ax;
    ctx.beginPath();
    ctx.moveTo(tip - dir * 12, ay - 5);
    ctx.lineTo(tip, ay);
    ctx.lineTo(tip - dir * 12, ay + 5);
    ctx.lineWidth = 1.8; ctx.stroke();
  }
}

function drawLattice() {
  var nt = normT();
  var isIns = carrier() === 'insulator';
  var fill = isIns ? mix([51, 65, 85], [148, 163, 184], nt)
                   : mix([146, 64, 14], [251, 191, 36], nt);
  var plusColor = isIns ? 'rgba(226,232,240,.92)' : 'rgba(48,24,4,.82)';
  var ringColor = isIns ? 'rgba(203,213,225,.45)' : 'rgba(253,230,138,.55)';
  var amp = ionAmp();

  for (var i = 0; i < lattice.length; i++) {
    var at = lattice[i];

    /* 振动残影：振幅越大越明显 */
    if (amp > 3.2) {
      var k = (amp - 3.2) / 7;
      ctx.beginPath();
      ctx.arc(at.bx, at.by, ION_R + amp * 0.55, 0, TAU);
      ctx.fillStyle = isIns ? 'rgba(148,163,184,' + (0.14 * k) + ')'
                            : 'rgba(251,146,60,' + (0.16 * k) + ')';
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(at.x, at.y, ION_R, 0, TAU);
    ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = ringColor; ctx.lineWidth = 1.2; ctx.stroke();

    /* 「+」：用两条线段画，不依赖字体渲染，任何缩放下都清晰 */
    ctx.strokeStyle = plusColor;
    ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(at.x - 4.6, at.y); ctx.lineTo(at.x + 4.6, at.y);
    ctx.moveTo(at.x, at.y - 4.6); ctx.lineTo(at.x, at.y + 4.6);
    ctx.stroke();

    /* 被撞闪一下（只有金属会发生） */
    if (at.flash > 0) {
      var f = at.flash;
      ctx.beginPath();
      ctx.arc(at.x, at.y, ION_R + 8 * f, 0, TAU);
      ctx.strokeStyle = 'rgba(255,247,214,' + (0.9 * f) + ')';
      ctx.lineWidth = 2.6 * f + 0.6;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(at.x, at.y, ION_R, 0, TAU);
      ctx.fillStyle = 'rgba(255,251,235,' + (0.55 * f) + ')';
      ctx.fill();
    }
  }
}

/* 玻璃：被束缚的电子只在原子外圈的轨道上绕，不参与导电 */
function drawBound() {
  var nt = normT();
  var r0 = 22 + 3 * nt;
  var i, b, a, rr, ex, ey;

  ctx.save();
  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = 'rgba(96,165,250,.20)';
  ctx.lineWidth = 1;
  for (i = 0; i < bound.length; i++) {
    b = bound[i]; a = b.atom; rr = r0 + (b.r - 22);
    ctx.beginPath();
    ctx.arc(a.x, a.y, rr, 0, TAU);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  for (i = 0; i < bound.length; i++) {
    b = bound[i]; a = b.atom; rr = r0 + (b.r - 22);
    ex = a.x + Math.cos(b.ang) * rr;
    ey = a.y + Math.sin(b.ang) * rr;
    ctx.beginPath();
    ctx.arc(ex, ey, 3.6, 0, TAU);
    ctx.fillStyle = '#7dd3fc'; ctx.fill();
    ctx.strokeStyle = 'rgba(224,242,254,.65)'; ctx.lineWidth = 1; ctx.stroke();
  }
  ctx.restore();
}

function drawMovers() {
  if (carrier() === 'electrolyte') { drawIons(); return; }

  var s = 26;
  for (var k = 0; k < movers.length; k++) {
    var e = movers[k];

    if (state.trail && e.trail.length >= 6) {
      ctx.beginPath();
      ctx.moveTo(e.trail[0], e.trail[1]);
      for (var i = 2; i < e.trail.length; i += 2) ctx.lineTo(e.trail[i], e.trail[i + 1]);
      ctx.strokeStyle = 'rgba(96,165,250,.34)';
      ctx.lineWidth = 2.4; ctx.lineCap = 'round';
      ctx.stroke();
    }

    if (eSprite) ctx.drawImage(eSprite, e.x - s / 2, e.y - s / 2, s, s);
  }
}

/* 溶液里的正负离子：Na⁺ 暖橙、Cl⁻ 青绿，球里带 + / − */
function drawIons() {
  for (var k = 0; k < movers.length; k++) {
    var m = movers[k];
    var pos = m.kind === 'na';
    var r = m.r;
    var g = ctx.createRadialGradient(m.x - r * 0.35, m.y - r * 0.38, r * 0.12, m.x, m.y, r);
    if (pos) {
      g.addColorStop(0, '#fed7aa');
      g.addColorStop(0.55, '#fb923c');
      g.addColorStop(1, '#c2410c');
    } else {
      g.addColorStop(0, '#cffafe');
      g.addColorStop(0.55, '#22d3ee');
      g.addColorStop(1, '#0e7490');
    }
    ctx.beginPath();
    ctx.arc(m.x, m.y, r, 0, TAU);
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = pos ? 'rgba(255,237,213,.55)' : 'rgba(207,250,254,.5)';
    ctx.lineWidth = 1.2; ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,.92)';
    ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(m.x - r * 0.42, m.y); ctx.lineTo(m.x + r * 0.42, m.y);
    if (pos) { ctx.moveTo(m.x, m.y - r * 0.42); ctx.lineTo(m.x, m.y + r * 0.42); }
    ctx.stroke();
  }
}

function drawSparks() {
  for (var i = 0; i < sparks.length; i++) {
    var sp = sparks[i];
    var k = 1 - sp.t / sp.life;
    var r = 5 + 17 * (1 - k);

    ctx.beginPath();
    ctx.arc(sp.x, sp.y, r, 0, TAU);
    ctx.strokeStyle = 'rgba(255,237,213,' + (0.72 * k) + ')';
    ctx.lineWidth = 2.0 * k + 0.4;
    ctx.stroke();

    /* 火花 */
    for (var a = 0; a < 5; a++) {
      var ang = a * TAU / 5 + sp.x * 0.01;
      ctx.beginPath();
      ctx.moveTo(sp.x + Math.cos(ang) * r * 0.55, sp.y + Math.sin(ang) * r * 0.55);
      ctx.lineTo(sp.x + Math.cos(ang) * (r + 5 * k), sp.y + Math.sin(ang) * (r + 5 * k));
      ctx.strokeStyle = 'rgba(253,224,71,' + (0.7 * k) + ')';
      ctx.lineWidth = 1.5 * k + 0.3;
      ctx.stroke();
    }
  }
}

function drawSlice() {
  ctx.save();
  ctx.setLineDash([7, 7]);
  ctx.strokeStyle = 'rgba(125,211,252,' + (0.32 + 0.55 * sliceFlash) + ')';
  ctx.lineWidth = 1.6 + sliceFlash * 2;
  ctx.beginPath();
  ctx.moveTo(SLICE_X, COND.y + 46);
  ctx.lineTo(SLICE_X, COND.y + COND.h - 20);
  ctx.stroke();
  ctx.setLineDash([]);

  /* 竖排小字，避开离子列 */
  ctx.translate(SLICE_X + 12, COND.y + 58);
  ctx.rotate(Math.PI / 2);
  ctx.fillStyle = 'rgba(125,211,252,.78)';
  ctx.font = '11px Inter, "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('通过截面', 0, 0);
  ctx.restore();
}

/* ============================================================
 * 主渲染
 * ============================================================ */
function render() {
  renderCount++;
  ctx.clearRect(0, 0, W, H);
  drawCircuit();
  drawZoom();
  drawMicro();
}

/* ============================================================
 * UI
 * ============================================================ */
var txtCache = {};
function setText(id, s) {
  if (txtCache[id] === s) return;
  txtCache[id] = s;
  var el = document.getElementById(id);
  if (el) el.textContent = s;
}

var stepDone = { st1: false, st2: false, st3: false, st4: false, st5: false, st6: false };
function markStep(id) {
  if (stepDone[id]) return;
  stepDone[id] = true;
  var el = document.getElementById(id);
  if (el) { el.classList.remove('cur'); el.classList.add('on'); }
}

var SUP = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
function sup(n) {
  return String(n).split('').map(function (d) { return SUP[+d] || d; }).join('');
}
function fmtR(r) {
  if (r >= 1e6) return '10' + sup(Math.round(Math.log10(r))) + ' Ω';
  if (r >= 100) return r.toFixed(1) + ' Ω';
  return r.toFixed(2) + ' Ω';
}
function fmtI(i) {
  if (i < 1e-6) return '≈ 0 A';
  if (i < 0.01) return (i * 1000).toFixed(2) + ' mA';
  if (i < 1) return i.toFixed(3) + ' A';
  return i.toFixed(2) + ' A';
}

function syncUI() {
  var R = resistance(), I = current();
  var m = curMat(), c = m.carrier;

  setText('mR', fmtR(R));
  setText('mI', fmtI(I));
  setText('mHit', c === 'insulator' ? '0 个' :
          (hitRate > 0 ? Math.round(hitRate) + ' 次/s' : '— 次/s'));
  var f = fluxNow();
  setText('mFlux', c === 'insulator' ? '0 个/s' :
          (f > 0.02 ? Math.round(f) + ' 个/s' : '— 个/s'));

  setText('mHitLabel', c === 'metal' ? '电子每秒被撞次数'
                     : c === 'insulator' ? '能自由移动的电荷'
                     : '离子每秒相撞次数');
  setText('mFluxLabel', c === 'metal' ? '每秒通过截面的电子'
                     : c === 'insulator' ? '每秒通过截面'
                     : '每秒通过截面的离子');

  setText('tVal', state.T.toFixed(0) + ' ℃');
  setText('uVal', state.U.toFixed(1) + ' V');

  var note;
  if (c === 'insulator') {
    note = '温度再高，也只是原子晃得更厉害 —— 电子仍然被绑着，跑不掉。';
  } else if (c === 'electrolyte') {
    note = '温度升高，离子热运动更剧烈，导电能力反而变强（和金属相反）。';
  } else if (state.T < 20) note = '低于常温，离子几乎不怎么动。';
  else if (state.T < 100) note = '常温附近，离子只是轻轻抖。';
  else if (state.T < 200) note = '已经很热了，离子晃得明显。';
  else note = '接近灯丝的工作温度，离子振动非常剧烈。';
  setText('tNote', note);
  setText('matNote', m.note);
  setText('specNote', m.spec + '。');

  /* 「想一想」三选一 */
  toggleHidden('noteMetal', c !== 'metal');
  toggleHidden('noteGlass', c !== 'insulator');
  toggleHidden('noteSalt', c !== 'electrolyte');

  var v = document.getElementById('verdict');
  if (v) {
    var cls = 'verdict', txt;
    if (c === 'insulator') {
      cls = 'verdict';
      txt = m.name + '：电阻约 ' + fmtR(R) + '，电流 ' + fmtI(I) +
            ' —— 没有能自由移动的电荷，加多大电压也形不成电流';
    } else if (c === 'electrolyte') {
      cls = state.T > 60 ? 'verdict ok' : 'verdict';
      txt = '温度 ' + state.T.toFixed(0) + ' ℃：' + m.name + '电阻 ' + fmtR(R) +
            '，电流 ' + fmtI(I) + ' —— Na⁺ 向右、Cl⁻ 向左，两者反向';
    } else {
      cls = state.T > 150 ? 'verdict hot' : 'verdict';
      txt = '温度 ' + state.T.toFixed(0) + ' ℃：' + m.name + '电阻 ' + fmtR(R) +
            '，电流 ' + fmtI(I);
      if (state.T > 150) txt += '（温度高，碰撞频繁，电阻比常温大了）';
    }
    if (v.className !== cls) v.className = cls;
    setText('verdict', txt);
  }

  /* 图例 */
  var lg = document.getElementById('legend');
  if (lg) {
    var html = c === 'insulator'
      ? '<span class="dot" style="background:#94a3b8"></span>橙圈 = 原子，绕圈的小球 = 被束缚的电子（跑不掉）'
      : c === 'electrolyte'
      ? '<span class="dot" style="background:#fb923c"></span>橙球 = Na⁺（向负极），青球 = Cl⁻（向正极）'
      : '<span class="dot"></span>红点 = 电流方向，蓝球 = 自由电子，橙圈 = 正离子';
    if (lg.innerHTML !== html) lg.innerHTML = html;
  }

  /* 规律条：文案按载流子换，点亮条件也跟着换 */
  syncLaws(c);
  setOn('l1', true);
  setOn('l2', I > 0.02);
  setOn('l3', c === 'insulator' ? true : hitRate > 0);
  setOn('l4', c === 'electrolyte' ? state.T > 60 : state.T > 100);
}

function toggleHidden(id, hide) {
  var el = document.getElementById(id);
  if (!el) return;
  if (hide && !el.hidden) el.hidden = true;
  if (!hide && el.hidden) el.hidden = false;
}

function setOn(id, on) {
  var el = document.getElementById(id);
  if (!el) return;
  if (on && !el.classList.contains('on')) el.classList.add('on');
  if (!on && el.classList.contains('on')) el.classList.remove('on');
}

/* 底部四条规律按载流子换 —— 说「自由电子」的句子套到盐水 / 玻璃上就是错的 */
var LAW_MARK = ['①', '②', '③', '④'];
var LAWS = {
  metal: [
    '导体里有大量<b>自由电子</b>，平时只是杂乱无章地乱撞，并不形成电流',
    '加上电压，电子在乱撞之上多了一个<b>整体向左的缓慢移动</b>，这才形成电流',
    '电子往前走一路被正离子挡住、撞偏 —— 这种<b>阻碍</b>就是电阻',
    '<b>温度越高</b>，正离子振动越剧烈，电子被撞得越频繁，<b>电阻越大</b>'
  ],
  insulator: [
    '玻璃里的电子被原子<b>牢牢抓住</b>，只能绕着原子转，跑不掉',
    '整段导体里<b>没有能自由移动的电荷</b> —— 这就是绝缘体',
    '加多大电压，电流表都几乎不动：不是电压不够，是<b>没有电荷可推</b>',
    '温度升高只让原子晃得更厉害，<b>电子依然被绑着</b>'
  ],
  electrolyte: [
    '食盐水里能自由移动的是<b>钠离子 Na⁺ 和氯离子 Cl⁻</b>，不是电子',
    '正离子奔向<b>负极</b>、负离子奔向<b>正极</b> —— 两者方向正好相反',
    '两边都在把电荷搬过截面，所以<b>都算电流的一部分</b>',
    '温度升高，离子跑得更快，盐水<b>反而更容易导电</b>（和金属相反）'
  ]
};
var htmlCache = {};
function setHTML(id, html) {
  if (htmlCache[id] === html) return;
  htmlCache[id] = html;
  var el = document.getElementById(id);
  if (el) el.innerHTML = html;
}
function syncLaws(c) {
  var arr = LAWS[c] || LAWS.metal;
  for (var i = 0; i < 4; i++) {
    setHTML('l' + (i + 1), '<i>' + LAW_MARK[i] + '</i><span>' + arr[i] + '</span>');
  }
}

/* ---- 参数控件 ---- */
var tRange = document.getElementById('tRange');
var uRange = document.getElementById('uRange');

tRange.addEventListener('input', function () {
  state.T = parseFloat(tRange.value);
  markStep('st1'); markStep('st4'); markStep('st5');
  syncUI(); render();
});
uRange.addEventListener('input', function () {
  state.U = parseFloat(uRange.value);
  markStep('st2'); markStep('st3');
  syncUI(); render();
});

/* 盐水只能到 95 ℃（再高就沸腾了），金属 / 玻璃给到 300 ℃ —— 换导体时同步改滑块范围 */
function applyTempRange() {
  var r = tempRange();
  tRange.min = r.lo;
  tRange.max = r.hi;
  state.T = clamp(state.T, r.lo, r.hi);
  tRange.value = state.T;
}

document.getElementById('matSeg').addEventListener('click', function (ev) {
  var b = ev.target.closest ? ev.target.closest('button[data-mat]') : null;
  if (!b) return;
  state.mat = b.getAttribute('data-mat');
  Array.prototype.forEach.call(this.querySelectorAll('button[data-mat]'), function (x) {
    x.classList.toggle('on', x === b);
  });
  applyTempRange();
  rebuild();
  markStep('st6');
  syncUI(); render();
});

function bindCheck(id, key) {
  var el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('change', function () { state[key] = el.checked; render(); });
}
bindCheck('cTrail', 'trail');
bindCheck('cSpark', 'spark');
bindCheck('cField', 'field');
bindCheck('cLabel', 'label');

var btnPause = document.getElementById('btnPause');
btnPause.addEventListener('click', function () {
  state.running = !state.running;
  btnPause.textContent = state.running ? '⏸ 暂停' : '▶ 继续';
  btnPause.classList.toggle('active', !state.running);
});

document.getElementById('btnReset').addEventListener('click', function () {
  state.T = 20; state.U = 2.0; state.mat = 'cu';
  state.running = true;
  btnPause.textContent = '⏸ 暂停';
  btnPause.classList.remove('active');
  applyTempRange();
  uRange.value = 2;
  Array.prototype.forEach.call(document.querySelectorAll('#matSeg button[data-mat]'), function (x) {
    x.classList.toggle('on', x.getAttribute('data-mat') === 'cu');
  });
  rebuild();
  syncUI(); render();
});

/* ---- 参数面板折叠 ---- */
var paramsToggle = document.getElementById('paramsToggle');
function setParamsOpen(open) {
  paramsEl.classList.toggle('collapsed', !open);
  paramsToggle.textContent = open ? '▾ 收起' : '▸ 展开';
  paramsToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}
document.getElementById('paramsHead').addEventListener('click', function () {
  setParamsOpen(paramsEl.classList.contains('collapsed'));
});
paramsToggle.addEventListener('click', function (ev) {
  ev.stopPropagation();
  setParamsOpen(paramsEl.classList.contains('collapsed'));
});

/* ============================================================
 * 布局 / 全屏
 * ============================================================ */
function layout() {
  dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (isFull) {
    /* 🔴 全屏时底部控制带浮在画面之上 ⇒ 可用高度要扣掉它，
       否则画布底部（微观区下沿）会被按钮盖住 */
    var availW = stageEl.clientWidth - 8, availH = stageEl.clientHeight - 56;
    var cssH = availH, cssW = cssH * W / H;
    if (cssW > availW) { cssW = availW; cssH = cssW * H / W; }
    canvas.style.width = Math.round(cssW) + 'px';
    canvas.style.height = Math.round(cssH) + 'px';
  } else {
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
  }
}

var fsBtn = document.getElementById('fsBtn');
function fsEl() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
function fsIsStage() { return fsEl() === stageEl; }

fsBtn.addEventListener('click', function () {
  if (fsIsStage()) {
    var ex = document.exitFullscreen || document.webkitExitFullscreen;
    if (ex) ex.call(document);
  } else {
    var rq = stageEl.requestFullscreen || stageEl.webkitRequestFullscreen;
    if (rq) rq.call(stageEl);
  }
});

var fsLayoutCalls = 0;
function onFsChange() {
  isFull = fsIsStage();
  fsBtn.innerHTML = isFull ? '⛶ <span class="lbl">退出全屏</span>' : '⛶ <span class="lbl">全屏</span>';
  fsLayoutCalls++;
  layout(); render();
  setTimeout(function () { layout(); render(); fsLayoutCalls++; }, 60);
}
['fullscreenchange', 'webkitfullscreenchange'].forEach(function (ev) {
  document.addEventListener(ev, onFsChange);
});

/* ============================================================
 * 自检钩子
 * ============================================================ */
window.__MICRO = {
  version: '3.1.0',
  state: state,
  step: step,
  renderNow: render,
  renderCount: function () { return renderCount; },
  resistance: resistance,
  current: current,
  power: power,
  hitRate: function () { return hitRate; },
  fluxRate: fluxNow,
  ionAmp: ionAmp,
  collideR: collideR,
  vDrift: vDrift,
  vThermal: vThermal,
  carrier: carrier,
  tempRange: tempRange,
  sliceX: function () { return SLICE_X; },
  setT: function (v) {
    var r = tempRange();
    state.T = clamp(v, r.lo, r.hi);
    tRange.value = state.T;
    syncUI(); render();
  },
  setU: function (v) { state.U = v; uRange.value = v; syncUI(); render(); },
  setMat: function (m) {
    state.mat = m;
    Array.prototype.forEach.call(document.querySelectorAll('#matSeg button[data-mat]'), function (x) {
      x.classList.toggle('on', x.getAttribute('data-mat') === m);
    });
    applyTempRange();
    rebuild();
    syncUI(); render();
  },
  setPaused: function (b) {
    state.running = !b;
    btnPause.textContent = state.running ? '⏸ 暂停' : '▶ 继续';
  },
  reset: function () { document.getElementById('btnReset').click(); },
  geo: function () {
    return {
      cond: { x: COND.x, y: COND.y, w: COND.w, h: COND.h },
      bar: { x: BAR.x, y: BAR.y, w: BAR.w, h: BAR.h },
      carrier: carrier(),
      ionCount: lattice.length,
      ionR: ION_R,
      eCount: movers.length,
      eR: E_R,
      boundCount: bound.length,
      cols: COLS, rows: ROWS,
      sliceX: SLICE_X,
      amp: ionAmp(),
      maxIonOffset: (function () {
        var mx = 0;
        for (var i = 0; i < lattice.length; i++) {
          var d = Math.abs(lattice[i].x - lattice[i].bx) + Math.abs(lattice[i].y - lattice[i].by);
          if (d > mx) mx = d;
        }
        return mx;
      })(),
      ionsInCond: lattice.every(function (io) {
        return io.x > COND.x && io.x < COND.x + COND.w && io.y > COND.y && io.y < COND.y + COND.h;
      }),
      moversInCond: movers.every(function (e) {
        return e.x >= COND.x - 6 && e.x <= COND.x + COND.w + 6 &&
               e.y >= COND.y && e.y <= COND.y + COND.h;
      })
    };
  },
  /* 玻璃的束缚电子角度和（两次采样不同 ⇒ 真的在绕转） */
  boundSpin: function () {
    var t = 0;
    for (var i = 0; i < bound.length; i++) t += bound[i].ang;
    return t;
  },
  /* 载流子盘点：正离子 / 负离子 / 电子 / 被束缚的电子 */
  counts: function () {
    var na = 0, cl = 0, e = 0;
    for (var i = 0; i < movers.length; i++) {
      if (movers[i].kind === 'na') na++;
      else if (movers[i].kind === 'cl') cl++;
      else e++;
    }
    return { na: na, cl: cl, electron: e, bound: bound.length, lattice: lattice.length,
             freeCharge: na + cl + e };
  },
  /* 某类载流子的平均 x 方向速度（EMA 平滑；正值 = 向右） */
  meanVx: function (kind) { return vxAvg[kind || 'e'] || 0; },
  view: function () {
    return { dpr: dpr, w: canvas.width, h: canvas.height,
             cssW: canvas.clientWidth, cssH: canvas.clientHeight, W: W, H: H };
  },
  probe: function () {
    var k = canvas.width / W;
    return {
      k: k,
      barCenter: { x: (BAR.x + BAR.w / 2) * k, y: BAR.y * k },
      meter: { x: AMM.x * k, y: AMM.y * k },
      sliceX: SLICE_X * k,
      condTop: COND.y * k,
      condLeft: COND.x * k,
      canvasW: canvas.width, canvasH: canvas.height
    };
  },
  stageEl: function () { return stageEl; },
  fullscreen: function () { return fsIsStage(); },
  fsLayoutCalls: function () { return fsLayoutCalls; },
  paramsOpen: setParamsOpen,
  paramsCollapsed: function () { return paramsEl.classList.contains('collapsed'); },
  paramsEl: function () { return paramsEl; },
  paramsBody: function () { return document.getElementById('paramsBody'); },
  readout: function () {
    function tx(id) { var el = document.getElementById(id); return el ? el.textContent : ''; }
    return { R: tx('mR'), I: tx('mI'), hit: tx('mHit'), flux: tx('mFlux'),
             t: tx('tVal'), u: tx('uVal'), verdict: tx('verdict') };
  }
};

/* ============================================================
 * 启动
 * ============================================================ */
buildElectronSprite();
applyTempRange();
rebuild();
syncUI();
layout();
render();

window.addEventListener('resize', function () { layout(); render(); });
if (window.ResizeObserver) {
  try { new ResizeObserver(function () { layout(); render(); }).observe(stageEl); } catch (e) {}
}

var lastTs = 0, rafRan = false;
function tick(ts) {
  rafRan = true;
  var dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0.016;
  lastTs = ts;
  step(dt);
  syncUI();
  render();
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

setTimeout(function () {
  if (!rafRan) { step(0.016); syncUI(); layout(); render(); }
}, 1200);

})();
