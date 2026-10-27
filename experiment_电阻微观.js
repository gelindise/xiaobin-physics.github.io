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
 * 材料
 * ============================================================ */
var MATS = {
  cu:   { name: '铜丝', R20: 1.2,  alpha: 0.0039,
          note: '铜的电阻小、温度影响明显。' },
  nicr: { name: '镍铬合金丝', R20: 12.0, alpha: 0.0004,
          note: '镍铬合金电阻大，但几乎不随温度变化。' }
};

/* ============================================================
 * 状态
 * ============================================================ */
var state = {
  T: 20, U: 2.0, mat: 'cu', running: true,
  trail: true, spark: true, field: true, label: true,
  t: 0
};

var ions = [], electrons = [], sparks = [];
var hitAcc = 0, hitRate = 0, hitTimer = 0;
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
function normT() { return clamp((state.T + 20) / 320, 0, 1); }
function curMat() { return MATS[state.mat]; }

function resistance() {
  var m = curMat();
  return m.R20 * (1 + m.alpha * (state.T - 20));
}
function current() { return state.U / resistance(); }
function power() { var i = current(); return i * i * resistance(); }

/* 热运动速率（px/s）：温度越高电子也跑得越快，但幅度远小于离子振幅的变化 */
function vThermal() { return 150 + 78 * normT(); }
/* 定向漂移速率（px/s）：只由电流决定 ⇒ 电压↑ 或 电阻↓ 时变快 */
function vDrift() { return 152 * (current() / 2.2); }
/* 离子振动振幅 / 角频率 */
function ionAmp() { return 1.6 + 8.4 * normT(); }
function ionOmega() { return 4.2 + 7.5 * normT(); }
/* 碰撞判定半径：离子晃得越远，越容易被电子撞上 */
function collideR() { return ION_R + E_R + ionAmp() * 0.85; }
/* 每秒通过截面的电子数 = 电子线密度 × 定向移动速率（与电流严格成正比）。
   🔴 不能靠「数穿越次数」：热运动是双向的，往返次数远大于净流量，
      按次数统计会得出「温度越高通过越多」的反向结论。 */
function fluxNow() { return (electrons.length / COND.w) * vDrift(); }

/* ============================================================
 * 粒子
 * ============================================================ */
function initIons() {
  ions.length = 0;
  for (var j = 0; j < ROWS; j++) {
    for (var i = 0; i < COLS; i++) {
      ions.push({
        bx: COND.x + (i + 0.5) * CELL_W,
        by: COND.y + GRID_TOP + (j + 0.5) * CELL_H,
        x: COND.x + (i + 0.5) * CELL_W,
        y: COND.y + GRID_TOP + (j + 0.5) * CELL_H,
        ph: Math.random() * TAU,
        ph2: Math.random() * TAU,
        flash: 0
      });
    }
  }
}

function initElectrons() {
  electrons.length = 0;
  for (var k = 0; k < 64; k++) {
    var th = Math.random() * TAU, v = vThermal() * (0.7 + Math.random() * 0.6);
    electrons.push({
      x: COND.x + 14 + Math.random() * (COND.w - 28),
      y: COND.y + 30 + Math.random() * (COND.h - 46),
      px: 0,
      vx: Math.cos(th) * v,
      vy: Math.sin(th) * v,
      cool: 0,
      trail: []
    });
  }
}

/* ============================================================
 * 步进
 * ============================================================ */
function step(dt) {
  dt = Math.min(dt, 0.05);
  if (!state.running) return;

  state.t += dt;

  var amp = ionAmp(), om = ionOmega();
  var vth = vThermal(), vd = vDrift(), rCol = collideR();
  var r2 = rCol * rCol;

  /* ---- 离子振动 ---- */
  for (var i = 0; i < ions.length; i++) {
    var ion = ions[i];
    ion.x = ion.bx + Math.sin(state.t * om + ion.ph) * amp;
    ion.y = ion.by + Math.cos(state.t * om * 0.82 + ion.ph2) * amp * 0.82;
    if (ion.flash > 0) ion.flash = Math.max(0, ion.flash - dt / 0.30);
  }

  /* ---- 电子 ---- */
  for (var k = 0; k < electrons.length; k++) {
    var e = electrons[k];
    e.px = e.x;
    e.x += (e.vx - vd) * dt;
    e.y += e.vy * dt;

    if (e.y < COND.y + E_R) { e.y = COND.y + E_R; e.vy = Math.abs(e.vy); }
    if (e.y > COND.y + COND.h - E_R) { e.y = COND.y + COND.h - E_R; e.vy = -Math.abs(e.vy); }

    /* 左右环绕（导体是长的）：px 一起平移，避免被误判成「穿过截面」 */
    if (e.x < COND.x - E_R) { e.x += COND.w; e.px += COND.w; }
    if (e.x > COND.x + COND.w + E_R) { e.x -= COND.w; e.px -= COND.w; }

    /* 穿过截面：只让「向左穿过」闪一下（电子定向移动方向）；
       🔴 流量读数不靠数穿越次数 —— 热运动是双向的，往返次数远大于净流量，
          按次数统计会得出「温度越高通过越多」的反向结论。改成按 n·v_d 直接算。 */
    if (e.px > SLICE_X && e.x <= SLICE_X) sliceFlash = 1;

    /* 碰撞 */
    if (e.cool > 0) e.cool -= dt;
    if (e.cool <= 0) {
      for (var m = 0; m < ions.length; m++) {
        var io = ions[m];
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

    /* 拖尾 */
    e.trail.push(e.x, e.y);
    if (e.trail.length > 18) e.trail.splice(0, 2);
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
  var heat = clamp(power() / 8, 0, 1);
  var x = BAR.x, y = BAR.y, w = BAR.w, h = BAR.h;

  /* 外发光（电流越大越热） */
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

  /* 棒里的「电流 I →」 */
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,.92)';
  ctx.font = 'bold 13px Inter, "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('电流 I  →', x + w / 2, y + 1);
  ctx.restore();

  /* 导体标注 */
  if (state.label) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px Inter, "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('导体：' + curMat().name + '（长 1 m，横截面积 0.1 mm²）', x + w / 2, y - h / 2 - 12);
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
  ctx.font = 'bold 12.5px Inter, "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('↓  导体内部的微观视图  ↓', (COND.x + COND.w) / 2, (BAR.y + BAR.h / 2 + COND.y) / 2);
}

/* ============================================================
 * 微观视图
 * ============================================================ */
function drawMicro() {
  /* 背景 */
  roundRect(COND.x, COND.y, COND.w, COND.h, 14);
  var bg = ctx.createLinearGradient(0, COND.y, 0, COND.y + COND.h);
  bg.addColorStop(0, 'rgba(13,28,46,.97)');
  bg.addColorStop(1, 'rgba(5,12,22,.97)');
  ctx.fillStyle = bg; ctx.fill();
  ctx.strokeStyle = 'rgba(56,189,248,.38)'; ctx.lineWidth = 2; ctx.stroke();

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

  if (state.field) drawField();
  drawIons();
  drawElectrons();
  if (state.spark) drawSparks();
  drawSlice();

  ctx.restore();
}

function drawField() {
  var y = COND.y + 28;

  /* 左半：电场方向（向右） */
  ctx.save();
  ctx.setLineDash([9, 8]);
  ctx.strokeStyle = 'rgba(125,211,252,.22)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(COND.x + 24, y);
  ctx.lineTo(COND.x + COND.w * 0.46, y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(COND.x + COND.w * 0.46 - 13, y - 5);
  ctx.lineTo(COND.x + COND.w * 0.46, y);
  ctx.lineTo(COND.x + COND.w * 0.46 - 13, y + 5);
  ctx.strokeStyle = 'rgba(125,211,252,.5)';
  ctx.lineWidth = 1.8; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.fillStyle = 'rgba(125,211,252,.6)';
  ctx.font = '11px Inter, "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  if (state.label) ctx.fillText('电场 E', COND.x + 26, y - 13);

  /* 右半：电子定向移动方向（向左） */
  var x1 = COND.x + COND.w * 0.54, x2 = COND.x + COND.w - 26;
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
  ctx.restore();
}

function drawIons() {
  var nt = normT();
  var fill = mix([146, 64, 14], [251, 191, 36], nt);
  var amp = ionAmp();

  for (var i = 0; i < ions.length; i++) {
    var ion = ions[i];

    /* 振动残影：振幅越大越明显 */
    if (amp > 3.2) {
      var k = (amp - 3.2) / 7;
      ctx.beginPath();
      ctx.arc(ion.bx, ion.by, ION_R + amp * 0.55, 0, TAU);
      ctx.fillStyle = 'rgba(251,146,60,' + (0.16 * k) + ')';
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(ion.x, ion.y, ION_R, 0, TAU);
    ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = 'rgba(253,230,138,.55)'; ctx.lineWidth = 1.2; ctx.stroke();

    /* 「+」：用两条线段画，不依赖字体渲染，任何缩放下都清晰 */
    ctx.strokeStyle = 'rgba(48,24,4,.82)';
    ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(ion.x - 4.6, ion.y); ctx.lineTo(ion.x + 4.6, ion.y);
    ctx.moveTo(ion.x, ion.y - 4.6); ctx.lineTo(ion.x, ion.y + 4.6);
    ctx.stroke();

    /* 被撞闪一下 */
    if (ion.flash > 0) {
      var f = ion.flash;
      ctx.beginPath();
      ctx.arc(ion.x, ion.y, ION_R + 8 * f, 0, TAU);
      ctx.strokeStyle = 'rgba(255,247,214,' + (0.9 * f) + ')';
      ctx.lineWidth = 2.6 * f + 0.6;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(ion.x, ion.y, ION_R, 0, TAU);
      ctx.fillStyle = 'rgba(255,251,235,' + (0.55 * f) + ')';
      ctx.fill();
    }
  }
}

function drawElectrons() {
  var s = 26;
  for (var k = 0; k < electrons.length; k++) {
    var e = electrons[k];

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

function syncUI() {
  var R = resistance(), I = current();
  var m = curMat();

  setText('mR', R.toFixed(2) + ' Ω');
  setText('mI', I.toFixed(2) + ' A');
  setText('mHit', hitRate > 0 ? Math.round(hitRate) + ' 次/s' : '— 次/s');
  var f = fluxNow();
  setText('mFlux', f > 0.02 ? Math.round(f) + ' 个/s' : '— 个/s');

  setText('tVal', state.T.toFixed(0) + ' ℃');
  setText('uVal', state.U.toFixed(1) + ' V');

  var note;
  if (state.T < 20) note = '低于常温，离子几乎不怎么动。';
  else if (state.T < 100) note = '常温附近，离子只是轻轻抖。';
  else if (state.T < 200) note = '已经很热了，离子晃得明显。';
  else note = '接近灯丝的工作温度，离子振动非常剧烈。';
  setText('tNote', note);
  setText('matNote', m.note);

  var v = document.getElementById('verdict');
  if (v) {
    var cls = state.T > 150 ? 'verdict hot' : 'verdict';
    var txt = '温度 ' + state.T.toFixed(0) + ' ℃：' + m.name + '电阻 ' + R.toFixed(2) +
              ' Ω，电流 ' + I.toFixed(2) + ' A';
    if (state.T > 150) txt += '（温度高，碰撞频繁，电阻比常温大了）';
    if (v.className !== cls) v.className = cls;
    setText('verdict', txt);
  }

  /* 规律条：随工况点亮 */
  setOn('l1', true);
  setOn('l2', I > 0.02);
  setOn('l3', hitRate > 0);
  setOn('l4', state.T > 100);
}

function setOn(id, on) {
  var el = document.getElementById(id);
  if (!el) return;
  if (on && !el.classList.contains('on')) el.classList.add('on');
  if (!on && el.classList.contains('on')) el.classList.remove('on');
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

document.getElementById('matSeg').addEventListener('click', function (ev) {
  var b = ev.target.closest ? ev.target.closest('button[data-mat]') : null;
  if (!b) return;
  state.mat = b.getAttribute('data-mat');
  Array.prototype.forEach.call(this.querySelectorAll('button[data-mat]'), function (x) {
    x.classList.toggle('on', x === b);
  });
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
  tRange.value = 20; uRange.value = 2;
  Array.prototype.forEach.call(document.querySelectorAll('#matSeg button[data-mat]'), function (x) {
    x.classList.toggle('on', x.getAttribute('data-mat') === 'cu');
  });
  initElectrons();
  sparks.length = 0;
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
  version: '3.0.0',
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
  sliceX: function () { return SLICE_X; },
  setT: function (v) { state.T = v; tRange.value = v; syncUI(); render(); },
  setU: function (v) { state.U = v; uRange.value = v; syncUI(); render(); },
  setMat: function (m) {
    state.mat = m;
    Array.prototype.forEach.call(document.querySelectorAll('#matSeg button[data-mat]'), function (x) {
      x.classList.toggle('on', x.getAttribute('data-mat') === m);
    });
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
      ionCount: ions.length,
      ionR: ION_R,
      eCount: electrons.length,
      eR: E_R,
      cols: COLS, rows: ROWS,
      sliceX: SLICE_X,
      amp: ionAmp(),
      maxIonOffset: (function () {
        var mx = 0;
        for (var i = 0; i < ions.length; i++) {
          var d = Math.abs(ions[i].x - ions[i].bx) + Math.abs(ions[i].y - ions[i].by);
          if (d > mx) mx = d;
        }
        return mx;
      })(),
      ionsInCond: ions.every(function (io) {
        return io.x > COND.x && io.x < COND.x + COND.w && io.y > COND.y && io.y < COND.y + COND.h;
      }),
      electronsInCond: electrons.every(function (e) {
        return e.x >= COND.x - 6 && e.x <= COND.x + COND.w + 6 &&
               e.y >= COND.y && e.y <= COND.y + COND.h;
      })
    };
  },
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
initIons();
initElectrons();
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
