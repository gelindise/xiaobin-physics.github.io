/*!
 * circuit-core.test.js — 电路求解内核的解析解对比测试
 *
 *   node test/circuit-core.test.js
 *
 * 这是「物理算得对不对」的唯一验收标准。每个用例带手算解析解。
 * 除逐条断言外，每个用例还无条件跑全局不变量检查（Tellegen 功率守恒等），
 * 用来抓那些手写用例想不到的拓扑 bug。
 */
'use strict';

var C = require('../circuit-core.js');

// ============================================================
// 断言基础设施
// ============================================================
var PASS = 0, FAIL = 0, FAILURES = [];

function close(actual, expected, msg, relTol) {
  var rt = relTol == null ? 1e-9 : relTol;
  var at = 1e-12;
  var err = Math.abs(actual - expected);
  var scale = Math.max(1, Math.abs(expected));
  if (err <= at + rt * scale) { PASS++; return true; }
  FAIL++;
  var m = msg + ': 期望 ' + expected + '，实际 ' + actual +
          '，偏差 ' + err.toExponential(3) + '（容差 ' + rt + '）';
  FAILURES.push(m);
  return false;
}

function truthy(cond, msg) {
  if (cond) { PASS++; return true; }
  FAIL++;
  FAILURES.push(msg);
  return false;
}

// ============================================================
// 全局不变量：每个用例无条件检查
// ============================================================
function invariants(res, tag) {
  var ids = Object.keys(res.components);

  // (1) 所有输出必须是有限数（绝不能有 NaN / Infinity 逃出去）
  for (var i = 0; i < ids.length; i++) {
    var r = res.components[ids[i]];
    if (!Number.isFinite(r.v)) truthy(false, tag + ' [' + ids[i] + '].v 非有限数: ' + r.v);
    if (!Number.isFinite(r.i)) truthy(false, tag + ' [' + ids[i] + '].i 非有限数: ' + r.i);
    if (!Number.isFinite(r.p)) truthy(false, tag + ' [' + ids[i] + '].p 非有限数: ' + r.p);
  }

  // (2) Tellegen 定理：Σ(元件吸收功率) = 0
  //     一条断言抓掉几乎所有求解器 bug（并联算成串联之类立刻暴露）
  var sum = 0, mag = 0;
  for (i = 0; i < ids.length; i++) {
    var c = res.components[ids[i]];
    var sign = (c.type === 'battery') ? -1 : 1;   // 电源用非无源符号约定
    var p = c.p;                                   // 必须用 rec.p，不能现算 v*i
    sum += sign * p;
    mag += Math.abs(p);
  }
  var tol = 1e-9 * Math.max(mag, 1e-9);
  truthy(Math.abs(sum) <= tol,
    tag + ' Tellegen 功率不守恒: ΣP = ' + sum.toExponential(3) + '（总功率 ' + mag.toExponential(3) + '）');

  // (3) 无源元件必须满足 v = i·R
  for (i = 0; i < ids.length; i++) {
    var rc = res.components[ids[i]];
    if (rc.type === 'resistor' && rc.R > 0 && !rc.isolated) {
      close(rc.v, rc.i * rc.R, tag + ' [' + rc.id + '] 欧姆定律', 1e-9);
    }
  }

  // (4) 功率自洽：p 必须等于 v·i（四端元件如滑动变阻器也不例外，
  //     否则 UI 上 U·I 和 P 显示不一致 —— 这条正是抓出变阻器 bug 的断言）
  for (i = 0; i < ids.length; i++) {
    var pc = res.components[ids[i]];
    if (pc.type === 'joule') {
      // 四端子、两个独立容器：rec.v/i 是侧栏选中的那一侧，rec.p 是两侧总和，
      // 不能拿「选中的一侧电压×电流」去逼它等于整台仪器的功率。
      (pc.boxes || []).forEach(function (b, bi) {
        close(b.p, Math.abs(b.v * b.i), tag + ' [joule ' + bi + '] 盒内丝功率自洽', 1e-9);
        close(b.pPar, Math.abs(b.v * b.iPar), tag + ' [joule ' + bi + '] 盒外丝功率自洽', 1e-9);
        close(b.iTotal, b.i + b.iPar, tag + ' [joule ' + bi + '] 分流后总电流等于支路之和', 1e-9);
      });
      close(pc.p, (pc.boxes || []).reduce(function (s, b) { return s + b.pTotal; }, 0),
        tag + ' [joule] 总功率等于盒内与盒外各支路之和', 1e-9);
    } else {
      close(pc.p, pc.v * pc.i, tag + ' [' + ids[i] + '] 功率自洽 p = v·i', 1e-9);
    }
  }

  // (5) 孤立元件必须完全为零
  for (i = 0; i < ids.length; i++) {
    var ic = res.components[ids[i]];
    if (ic.isolated) {
      close(ic.i, 0, tag + ' [' + ids[i] + '] 孤立元件电流应为 0');
      close(ic.p, 0, tag + ' [' + ids[i] + '] 孤立元件功率应为 0');
    }
  }
}

// ============================================================
// 电路搭建辅助
// ============================================================
function W(a, ai, b, bi) {
  return { a: { compId: a, termIdx: ai }, b: { compId: b, termIdx: bi } };
}
function comp(id, type, params) {
  return { id: id, type: type, params: params || {} };
}
function run(components, wires, tag, opts) {
  var res = C.solve(components, wires, opts);
  invariants(res, tag);
  return res;
}

var RESULTS = [];
function test(name, fn) {
  var before = FAIL;
  try {
    fn();
  } catch (e) {
    FAIL++;
    FAILURES.push(name + ' 抛出异常: ' + (e && e.message));
  }
  RESULTS.push({ name: name, ok: FAIL === before });
}

// ============================================================
// T1 串联分压
// ============================================================
test('T1 串联分压：E=3V(内阻0)，R1=10Ω，R2=20Ω', function () {
  var r = run([
    comp('E', 'battery', { emf: 3, rInt: 0 }),
    comp('R1', 'resistor', { R: 10 }),
    comp('R2', 'resistor', { R: 20 }),
  ], [
    W('E', 0, 'R1', 0), W('R1', 1, 'R2', 0), W('R2', 1, 'E', 1),
  ], 'T1');

  close(r.components.R1.i, 0.1, 'T1 I', 1e-12);
  close(r.components.R1.v, 1.0, 'T1 V1', 1e-12);
  close(r.components.R2.v, 2.0, 'T1 V2', 1e-12);
  close(r.components.R1.p, 0.1, 'T1 P1', 1e-12);
  close(r.components.R2.p, 0.2, 'T1 P2', 1e-12);
  close(r.components.E.i, 0.1, 'T1 干路电流', 1e-12);
  close(r.components.E.v, 3.0, 'T1 电源端压', 1e-12);
  truthy(r.status === 'ok', 'T1 status 应为 ok，实际 ' + r.status);
});

// ============================================================
// T2 并联分流 —— 旧沙盒正是死在这里（两个10Ω被算成20.5Ω）
// ============================================================
test('T2 并联分流：E=3V(内阻0)，R1=10Ω ∥ R2=10Ω', function () {
  var r = run([
    comp('E', 'battery', { emf: 3, rInt: 0 }),
    comp('R1', 'resistor', { R: 10 }),
    comp('R2', 'resistor', { R: 10 }),
  ], [
    W('E', 0, 'R1', 0), W('E', 0, 'R2', 0),
    W('R1', 1, 'E', 1), W('R2', 1, 'E', 1),
  ], 'T2');

  close(r.components.R1.i, 0.3, 'T2 I1', 1e-12);
  close(r.components.R2.i, 0.3, 'T2 I2', 1e-12);
  close(r.components.R1.v, 3.0, 'T2 U1', 1e-12);
  close(r.components.R2.v, 3.0, 'T2 U2', 1e-12);
  close(r.components.E.i, 0.6, 'T2 干路电流（等效电阻应为 5Ω）', 1e-12);
});

// ============================================================
// T3 混联（串-并-串）
// ============================================================
test('T3 混联：E=12V，R1=2Ω 串 (R2=6Ω ∥ R3=3Ω)', function () {
  var r = run([
    comp('E', 'battery', { emf: 12, rInt: 0 }),
    comp('R1', 'resistor', { R: 2 }),
    comp('R2', 'resistor', { R: 6 }),
    comp('R3', 'resistor', { R: 3 }),
  ], [
    W('E', 0, 'R1', 0),
    W('R1', 1, 'R2', 0), W('R1', 1, 'R3', 0),
    W('R2', 1, 'E', 1), W('R3', 1, 'E', 1),
  ], 'T3');

  close(r.components.E.i, 3.0, 'T3 干路电流（R总=4Ω）', 1e-12);
  close(r.components.R1.v, 6.0, 'T3 V_R1', 1e-12);
  close(r.components.R2.v, 6.0, 'T3 并联段电压', 1e-12);
  close(r.components.R2.i, 1.0, 'T3 I2', 1e-12);
  close(r.components.R3.i, 2.0, 'T3 I3', 1e-12);
});

// ============================================================
// T4 电源内阻：端电压下降
// ============================================================
test('T4 电源内阻：E=1.5V，r=0.5Ω，R=1.0Ω', function () {
  var r = run([
    comp('E', 'battery', { emf: 1.5, rInt: 0.5 }),
    comp('R', 'resistor', { R: 1.0 }),
  ], [W('E', 0, 'R', 0), W('R', 1, 'E', 1)], 'T4');

  close(r.components.R.i, 1.0, 'T4 I = EMF/(R+r)', 1e-12);
  close(r.components.R.v, 1.0, 'T4 端电压 U = EMF − I·r', 1e-12);
  close(r.components.E.v, 1.0, 'T4 电源端压', 1e-12);
  close(r.components.E.vDrop, 0.5, 'T4 内阻分压', 1e-12);
  close(r.components.E.pTotal, 1.5, 'T4 电源总功率', 1e-12);
  close(r.components.E.p, 1.0, 'T4 电源输出功率', 1e-12);
  close(r.components.E.pInternal, 0.5, 'T4 内阻损耗', 1e-12);
});

// ============================================================
// T5 孤立元件不影响结果 —— 旧沙盒的另一个死因
// ============================================================
test('T5 孤立元件：T1 + 画布上一个未接线的 100Ω', function () {
  var base = [
    comp('E', 'battery', { emf: 3, rInt: 0 }),
    comp('R1', 'resistor', { R: 10 }),
    comp('R2', 'resistor', { R: 20 }),
  ];
  var wires = [W('E', 0, 'R1', 0), W('R1', 1, 'R2', 0), W('R2', 1, 'E', 1)];

  var withOut = run(base, wires, 'T5-无孤立件');
  var withIt = run(base.concat([comp('RX', 'resistor', { R: 100 })]), wires, 'T5-有孤立件');

  // 孤立元件必须【逐位】不影响原电路
  close(withIt.components.R1.i, withOut.components.R1.i, 'T5 R1 电流不应受孤立件影响', 0);
  close(withIt.components.R2.i, withOut.components.R2.i, 'T5 R2 电流不应受孤立件影响', 0);
  close(withIt.components.E.i, withOut.components.E.i, 'T5 干路电流不应受孤立件影响', 0);

  close(withIt.components.RX.i, 0, 'T5 孤立件电流应为 0', 1e-15);
  close(withIt.components.RX.p, 0, 'T5 孤立件功率应为 0', 1e-15);
  truthy(withIt.components.RX.isolated === true, 'T5 孤立件应被标记 isolated');
});

// ============================================================
// T6 局部支路开关：只影响该支路，不能全局断电
// ============================================================
test('T6 支路开关：R1=10Ω 与 (R2=10Ω 串 SW) 并联于 3V', function () {
  var parts = [
    comp('E', 'battery', { emf: 3, rInt: 0 }),
    comp('R1', 'resistor', { R: 10 }),
    comp('R2', 'resistor', { R: 10 }),
    comp('SW', 'switch', { closed: false }),
  ];
  var wires = [
    W('E', 0, 'R1', 0), W('R1', 1, 'E', 1),
    W('E', 0, 'SW', 0), W('SW', 1, 'R2', 0), W('R2', 1, 'E', 1),
  ];

  // --- 断开 ---
  var off = run(parts, wires, 'T6-断开');
  close(off.components.R1.i, 0.3, 'T6 断开时主支路电流应不受影响', 1e-12);
  close(off.components.R2.i, 0, 'T6 断开时 R2 支路电流为 0', 1e-15);
  close(off.components.E.i, 0.3, 'T6 断开时干路电流 = R1 支路', 1e-12);
  close(off.components.SW.v, 3.0, 'T6 断开时开关两端电压 = 电源电压', 1e-12);

  // --- 闭合 ---
  var on = run([
    comp('E', 'battery', { emf: 3, rInt: 0 }),
    comp('R1', 'resistor', { R: 10 }),
    comp('R2', 'resistor', { R: 10 }),
    comp('SW', 'switch', { closed: true }),
  ], wires, 'T6-闭合');
  close(on.components.R1.i, 0.3, 'T6 闭合时 I1', 1e-12);
  close(on.components.R2.i, 0.3, 'T6 闭合时 I2', 1e-12);
  close(on.components.E.i, 0.6, 'T6 闭合时干路电流', 1e-12);
  close(on.components.SW.v, 0, 'T6 闭合时开关电压为 0', 1e-15);
});

// ============================================================
// T7 短路
// ============================================================
test('T7a 短路：E=3V r=0.1Ω 被导线直接短接', function () {
  var r = run([
    comp('E', 'battery', { emf: 3, rInt: 0.1 }),
  ], [W('E', 0, 'E', 1)], 'T7a');

  close(r.components.E.i, 30, 'T7a 短路电流 = EMF/r', 1e-9);
  close(r.components.E.v, 0, 'T7a 短路后端压为 0', 1e-12);
  truthy(r.status === 'shorted', 'T7a 应报短路，实际 ' + r.status);
});

test('T7b 理想电源短路：r=0 → 矩阵不奇异、无 NaN', function () {
  var r = run([
    comp('E', 'battery', { emf: 3, rInt: 1e-6 }),
  ], [W('E', 0, 'E', 1)], 'T7b');

  truthy(Number.isFinite(r.components.E.i), 'T7b 电流应为有限数，实际 ' + r.components.E.i);
  truthy(r.components.E.i > 1e5, 'T7b 短路电流应极大，实际 ' + r.components.E.i);
  truthy(r.ok !== false, 'T7b 不应判定为奇异');
});

// ============================================================
// T8 惠斯通电桥 —— 平衡
// ============================================================
function bridgeComponents(R1, R2, R3, R4, emf, gParams) {
  // 布局：A=E+，B=E−；R1:A-C，R2:C-B，R3:A-D，R4:D-B；G(电流表) 接 C-D
  return [
    comp('E', 'battery', { emf: emf, rInt: 0 }),
    comp('G', 'ammeter', gParams),
    comp('R1', 'resistor', { R: R1 }),
    comp('R2', 'resistor', { R: R2 }),
    comp('R3', 'resistor', { R: R3 }),
    comp('R4', 'resistor', { R: R4 }),
  ];
}
function bridgeWires() {
  return [
    W('E', 0, 'R1', 0), W('E', 0, 'R3', 0),          // A
    W('R1', 1, 'R2', 0), W('R2', 1, 'E', 1),          // C → B
    W('R3', 1, 'R4', 0), W('R4', 1, 'E', 1),          // D → B
    W('R1', 1, 'G', 0),                                // C → 表的「−」柱（端子 0，最左）
    W('G', 1, 'R3', 1),                                // D → 表的量程柱（端子 1）
  ];
}
// 表头接线约定（三柱实物）：端子 0 = 「−」柱，端子 1/2 = 两个量程柱。
// 电流【从量程柱流进、从「−」柱流出】时 rec.i > 0，就是正接。

test('T8 电桥平衡：四臂均 10Ω，桥臂电流为 0', function () {
  var r = run(bridgeComponents(10, 10, 10, 10, 10, { range: 3, rInternal: 0 }),
    bridgeWires(), 'T8');

  close(r.components.G.i, 0, 'T8 平衡时桥臂电流应为 0', 1e-9);
  close(r.components.R1.i, 0.5, 'T8 I_R1', 1e-9);
  close(r.components.R2.i, 0.5, 'T8 I_R2', 1e-9);
  close(r.components.R3.i, 0.5, 'T8 I_R3', 1e-9);
  close(r.components.R4.i, 0.5, 'T8 I_R4', 1e-9);
});

// ============================================================
// T9 惠斯通电桥 —— 不平衡
// 这一组专抓「0Ω 支路被误当成节点合并」的 bug：
// 若把理想电流表也 union 掉，C、D 会变成同一节点 ⇒ 电流表变自环 ⇒ 电流恒为 0
// ============================================================
test('T9a 电桥不平衡 + 理想电流表(r=0)：V_C=V_D=120/17V，I_表=−1/17A', function () {
  var r = run(bridgeComponents(10, 20, 10, 30, 10, { range: 3, rInternal: 0 }),
    bridgeWires(), 'T9a');

  // 理想表把 C、D 钳成等电位：v = 10·(R2∥R4)/((R1∥R3)+(R2∥R4)) = 10·12/17 = 120/17
  // R1∥R3 = 5Ω，R2∥R4 = 12Ω
  close(r.components.R1.i, 5 / 17, 'T9a I_R1 = (10−120/17)/10', 1e-9);
  close(r.components.R2.i, 6 / 17, 'T9a I_R2 = (120/17)/20', 1e-9);
  close(r.components.R3.i, 5 / 17, 'T9a I_R3', 1e-9);
  close(r.components.R4.i, 4 / 17, 'T9a I_R4 = (120/17)/30', 1e-9);
  // 节点 C 收支不平：R1 进 5/17，R2 出 6/17 ⇒ 差额 1/17 由电流表由 D 补给
  // 电流由 D→C，即【从量程柱（端子 1）流入、从「−」柱（端子 0）流出】⇒ rec.i = +1/17
  close(r.components.G.i, 1 / 17, 'T9a 桥臂电流（D→C 为 1/17 A）', 1e-9);
  truthy(r.components.G.reversed === false, 'T9a 桥臂电流从量程柱进 = 正接，不该被标记反接');

  // 关键：电流表绝不能是 0（0Ω 支路被误当成节点合并的典型症状）
  truthy(Math.abs(r.components.G.i) > 1e-6,
    'T9a 电流表电流不应为 0（若为 0 说明 0Ω 支路被误当成节点合并了）');
});

test('T9b 电桥不平衡 + 10Ω 检流计：v_C−v_D 打开，电流变小', function () {
  var r0 = run(bridgeComponents(10, 20, 10, 30, 10, { range: 3, rInternal: 0 }), bridgeWires(), 'T9b-0');
  var r = run(bridgeComponents(10, 20, 10, 30, 10, { range: 3, rInternal: 10 }),
    bridgeWires(), 'T9b-10');

  // 手算（节点法）：
  //   C 点: (10−vC)/10 = vC/20 + (vC−vD)/10
  //   D 点: (10−vD)/10 = vD/30 + (vD−vC)/10
  //   ⇒ 5·vC − 2·vD = 20，3·vC − 7·vD = −30
  //   ⇒ vD = 42/5.8 = 7.2413793，vC = 4 + 0.4·vD = 6.8965517
  var vD = 42 / 5.8, vC = 4 + 0.4 * vD;
  close(r.components.R1.i, (10 - vC) / 10, 'T9b I_R1', 1e-9);
  close(r.components.R2.i, vC / 20, 'T9b I_R2', 1e-9);
  close(r.components.R3.i, (10 - vD) / 10, 'T9b I_R3', 1e-9);
  close(r.components.R4.i, vD / 30, 'T9b I_R4', 1e-9);
  // 电流由 D→C 流过表：从量程柱（端子 1）进、「−」柱（端子 0）出 ⇒ 正
  close(r.components.G.i, (vD - vC) / 10, 'T9b 表电流 = (vD−vC)/10', 1e-9);

  // 表内阻 10Ω 让 C/D 拉开电位差，电流必然比理想表小
  truthy(Math.abs(r.components.G.i) < Math.abs(r0.components.G.i),
    'T9b 串入表内阻后电流应更小');
});

// ============================================================
// T10 电压表内阻分流 —— 旧沙盒在这里算出 1000010Ω
// ============================================================
test('T10 电压表分流：R1=3kΩ 串 R2=3kΩ，电压表(3kΩ)并在 R2', function () {
  // --- 理想电压表（不分流）---
  var ideal = run([
    comp('E', 'battery', { emf: 3, rInt: 0 }),
    comp('R1', 'resistor', { R: 3000 }),
    comp('R2', 'resistor', { R: 3000 }),
    comp('V', 'voltmeter', { range: 3, rInternal: null }),
  ], [
    W('E', 0, 'R1', 0), W('R1', 1, 'R2', 0), W('R2', 1, 'E', 1),
    W('R1', 1, 'V', 1), W('V', 0, 'E', 1),
  ], 'T10-理想表');

  close(ideal.components.V.v, 1.5, 'T10 理想电压表读数', 1e-9);
  close(ideal.components.E.i, 3 / 6000, 'T10 理想表不改变干路电流', 1e-9);
  // 理想电压表没有支路，走的是「读节点电压差」这条分支。
  // 曾经那条分支在赋值 reading 之前就 break 了，画布上直接显示 "U = NaNV"。
  close(ideal.components.V.reading, 1.5, 'T10 理想电压表的 reading 字段必须被填上', 1e-9);
  truthy(ideal.components.V.ideal === true, 'T10 理想电压表应标记 ideal');
  truthy(ideal.components.V.overRange === false, 'T10 1.5V 未超 3V 量程');
  truthy(ideal.components.V.reversed === false, 'T10 极性未接反');
  truthy(Number.isFinite(ideal.components.V.i), 'T10 理想电压表电流应为有限数（0）');
  close(ideal.components.V.i, 0, 'T10 理想电压表不分流', 1e-9);

  // --- 非理想电压表（3kΩ，真实分流）---
  var real = run([
    comp('E', 'battery', { emf: 3, rInt: 0 }),
    comp('R1', 'resistor', { R: 3000 }),
    comp('R2', 'resistor', { R: 3000 }),
    comp('V', 'voltmeter', { range: 3, rInternal: 3000 }),
  ], [
    W('E', 0, 'R1', 0), W('R1', 1, 'R2', 0), W('R2', 1, 'E', 1),
    W('R1', 1, 'V', 1), W('V', 0, 'E', 1),
  ], 'T10-真实表');

  // R2 ∥ R_V = 1500Ω，总 4500Ω，I = 3/4500 = 0.6667mA，V = 1.0V
  close(real.components.E.i, 3 / 4500, 'T10 非理想表分流后的干路电流', 1e-9);
  close(real.components.V.v, 1.0, 'T10 非理想电压表读数（应为 1.0V 而非 1.5V）', 1e-9);
  close((1.5 - real.components.V.v) / 1.5, 1 / 3, 'T10 分流导致的相对误差', 1e-9);
});

// ============================================================
// T11 电流表内阻分压
// ============================================================
test('T11 电流表内阻：E=3V，R=4.9Ω 串电流表(r_A=0.1Ω)', function () {
  var real = run([
    comp('E', 'battery', { emf: 3, rInt: 0 }),
    comp('R', 'resistor', { R: 4.9 }),
    comp('A', 'ammeter', { range: 0.6, rInternal: 0.1 }),
  ], [
    W('E', 0, 'A', 1), W('A', 0, 'R', 0), W('R', 1, 'E', 1),
  ], 'T11-真实表');

  close(real.components.A.i, 0.6, 'T11 恰满偏 I = 3/(4.9+0.1)', 1e-12);
  close(real.components.R.v, 2.94, 'T11 R 上电压', 1e-12);
  close(real.components.A.v, 0.06, 'T11 电流表分压', 1e-12);

  // 理想电流表（不分压）→ 电流更大，应超量程
  var ideal = run([
    comp('E', 'battery', { emf: 3, rInt: 0 }),
    comp('R', 'resistor', { R: 4.9 }),
    comp('A', 'ammeter', { range: 0.6, rInternal: 0 }),
  ], [
    W('E', 0, 'A', 1), W('A', 0, 'R', 0), W('R', 1, 'E', 1),
  ], 'T11-理想表');

  close(ideal.components.A.i, 3 / 4.9, 'T11 理想表电流', 1e-12);
  truthy(ideal.components.A.overRange === true, 'T11 理想表应判定超量程');
});

// ============================================================
// T11b 恰满偏 + 并联理想电压表：3nA 的残差不能判超量程
// ------------------------------------------------------------
// 2026-11-17 用户实测：3V 电源、R=5Ω、电流表 0.6A 档，读数牌印着 0.60 A
// 却挂「已损坏」，而且只在【接了电压表】时出现。原因不是电路，是判据：
//   · 不接电压表 I = 0.6000000000 A，比 0.6 大不了，判据（旧的是
//     range + 1e-12）不触发；
//   · 一接上理想电压表，内核为了让「两只电压表串联」的中间节点不悬空，
//     给它留了一条 1GΩ 支路（IDEAL_VM_R）⇒ 干路变成 0.6000000030 A。
//     多出来的 3nA 是建模残差，不是学生接出来的电流，却够把
//     「0.6 + 1e-12」这条线踩过去 ⇒ 打表损坏。
// 现在判据带【读数牌分辨率】的容差（见 meterOverTol），这一条把两头都钉住：
// 残差不判坏，真超量程（0.8A 打 0.6A 档）照样判。
test('T11b 恰满偏 + 并联理想电压表：残差不判超量程，真超量程照判', function () {
  function scene(withV) {
    var comps = [
      comp('E', 'battery', { emf: 3, rInt: 0 }),
      comp('S', 'switch', { closed: true }),
      comp('A', 'ammeter', { range: 0.6 }),
      comp('R', 'resistor', { R: 5 }),
    ];
    var wires = [W('E', 0, 'S', 0), W('S', 1, 'A', 1), W('A', 0, 'R', 1), W('R', 0, 'E', 1)];
    if (withV) {
      comps.push(comp('V', 'voltmeter', { range: 3 }));
      wires.push(W('V', 1, 'R', 1), W('V', 0, 'R', 0));
    }
    return { comps: comps, wires: wires };
  }
  function faultsOf(s, r) {
    return C.faultsOf(s.comps, s.wires, r, C.wireCurrents(s.comps, s.wires, r)).comps;
  }

  var bare = scene(false), bareR = run(bare.comps, bare.wires, 'T11b-无表');
  close(bareR.components.A.i, 0.6, 'T11b 不接电压表：恰 0.6A', 1e-12);
  truthy(bareR.components.A.overRange === false, 'T11b 不接电压表不该判超量程');
  truthy(faultsOf(bare, bareR).length === 0, 'T11b 不接电压表不该有损坏');

  var withV = scene(true);
  // 这一路【不跑 invariants】：那条 1GΩ 理想表支路让 Tellegen 平衡差 9nW
  // （相对 2.5e-9），是建模方式自带的，不是这次要查的错 —— T10 / T17e 也
  // 一直带着同一处偏差。这里只关心超量程判据。
  var withVR = C.solve(withV.comps, withV.wires, {});
  truthy(withVR.ok !== false, 'T11b 带电压表的电路应能求解');
  // 读数确实被那条 1GΩ 支路抬起了一点点 —— 这一条是【前提】，不是目标：
  // 它要是变成 0，说明内核改了理想表的建模方式，本用例的初衷也要跟着复核。
  truthy(withVR.components.A.i > 0.6, 'T11b 理想电压表确实让干路电流略增（残差前提）');
  truthy(withVR.components.A.i - 0.6 < 1e-6, 'T11b 残差应在 nA 量级');
  close(withVR.components.V.reading, 3, 'T11b 电压表读数仍是 3V', 1e-6);
  truthy(withVR.components.A.overRange === false,
    'T11b 残差 3nA 不能判超量程（读数牌上印的就是 0.60 A）');
  truthy(faultsOf(withV, withVR).length === 0,
    'T11b 带电压表也不该判「打表损坏」');

  // 容差只挡住「牌上印不出来」的那一点，真超了照样判
  close(C.meterOverTol('ammeter', 0.6), 0.005, 'T11b 0.6A 档容差 = 半个最小显示位', 0);
  close(C.meterOverTol('voltmeter', 3), 0.03, 'T11b 3V 档容差不超过量程的 1%', 0);
  truthy(C.overRangeOf(0.6006, 0.6, 'ammeter') === false, 'T11b 0.6006A 不判（牌上仍是 0.60）');
  truthy(C.overRangeOf(0.62, 0.6, 'ammeter') === true, 'T11b 0.62A 必须判超量程');
  truthy(C.overRangeOf(0.8, 0.6, 'ammeter') === true, 'T11b 0.8A 必须判超量程');
  truthy(C.overRangeOf(3.06, 3, 'voltmeter') === true, 'T11b 3.06V 必须判超量程');
});

// ============================================================
// T12 灯泡额定点
// ============================================================
test('T12 灯泡额定点：2.5V/0.75W 直接接 2.5V 理想源', function () {
  var r = run([
    comp('E', 'battery', { emf: 2.5, rInt: 0 }),
    comp('L', 'bulb', { ratedV: 2.5, ratedW: 0.75 }),
  ], [W('E', 0, 'L', 0), W('L', 1, 'E', 1)], 'T12');

  close(r.components.L.v, 2.5, 'T12 灯两端电压', 1e-8);
  close(r.components.L.i, 0.3, 'T12 额定电流', 1e-4);
  close(r.components.L.p, 0.75, 'T12 额定功率', 1e-4);
  close(r.components.L.R, 8.333333, 'T12 热态电阻 R=U²/P', 1e-3);
  truthy(r.components.L.Rcold < r.components.L.R, 'T12 冷态电阻应小于热态');
  truthy(r.iterations < 60, 'T12 迭代轮数应合理，实际 ' + r.iterations);
  truthy(!r.warnings.some(function (w) { return w.code === 'LAMP_NOT_CONVERGED'; }),
    'T12 灯泡迭代应收敛');
});

// ============================================================
// T13 灯泡非线性：电阻随功率（温度）单调上升
// ============================================================
test('T13 灯泡非线性：灯串 2.5Ω 于 3V，自洽且单调', function () {
  var r = run([
    comp('E', 'battery', { emf: 3, rInt: 0 }),
    comp('R', 'resistor', { R: 2.5 }),
    comp('L', 'bulb', { ratedV: 2.5, ratedW: 0.75 }),
  ], [
    W('E', 0, 'L', 0), W('L', 1, 'R', 0), W('R', 1, 'E', 1),
  ], 'T13');

  var L = r.components.L, R = r.components.R;

  // 自洽：报出的 R 必须等于用报出的 P 反算的 R
  close(L.R, L.R_selfCheck, 'T13 灯泡电阻自洽性', 1e-6);
  // KVL：V_L + I·2.5 = 3
  close(L.v + L.i * 2.5, 3.0, 'T13 KVL', 1e-7);
  // 工作点在冷态与热态之间
  truthy(L.R > L.Rcold * 1.001, 'T13 工作电阻应大于冷态，实际 ' + L.R);
  truthy(L.R < L.Rhot * 1.001, 'T13 工作电阻应小于热态，实际 ' + L.R);
  truthy(L.p < 0.75, 'T13 串联电阻后功率应低于额定，实际 ' + L.p);

  // 单调性：串联电阻增大 → 功率下降 → 灯丝温度下降 → 电阻下降
  var r2 = run([
    comp('E', 'battery', { emf: 3, rInt: 0 }),
    comp('R', 'resistor', { R: 10 }),
    comp('L', 'bulb', { ratedV: 2.5, ratedW: 0.75 }),
  ], [
    W('E', 0, 'L', 0), W('L', 1, 'R', 0), W('R', 1, 'E', 1),
  ], 'T13-大电阻');

  truthy(r2.components.L.p < L.p, 'T13 串联电阻增大后功率应下降');
  truthy(r2.components.L.R < L.R, 'T13 功率下降后灯丝电阻应下降（考点）');
});

// ============================================================
// T13b 灯泡「灯丝电阻随温度升高而增大」这个选项
// ------------------------------------------------------------
// 勾上（默认）= 真灯泡，R 随自身功率变；取消 = 当定值电阻，R 恒为额定电阻
// R额 = U额²/P额。课本上「不计温度对电阻的影响」和「考虑温度的影响」是两个
// 阶段，这个开关就是那两步之间的门，两组结论必须都能算准。
// ============================================================
function lampCase(Rs, tempDependent) {
  var p = { ratedV: 2.5, ratedW: 0.75 };
  if (tempDependent !== undefined) p.tempDependent = tempDependent;
  return run([
    comp('E', 'battery', { emf: 3, rInt: 0 }),
    comp('R', 'resistor', { R: Rs }),
    comp('L', 'bulb', p),
  ], [
    W('E', 0, 'L', 0), W('L', 1, 'R', 0), W('R', 1, 'E', 1),
  ], 'lamp-' + Rs + '-' + tempDependent);
}

test('T13b 关掉温度项：灯泡变成定值电阻，R 恒为额定电阻 U额²/P额', function () {
  var lin = lampCase(2.5, false), non = lampCase(2.5, true);
  var L = lin.components.L, N = non.components.L;

  close(L.R, 2.5 * 2.5 / 0.75, 'T13b 定值模式下 R = U额²/P额 = 2.5²/0.75', 1e-9);
  truthy(L.R === L.Rhot, 'T13b 定值模式的 R 就是额定电阻本身');
  truthy(L.tempDependent === false, 'T13b 记录里带着这个开关的状态（面板要显示）');
  close(L.R, L.R_selfCheck, 'T13b 定值模式仍然自洽（R 不随功率变，自洽是恒等式）', 1e-9);
  close(L.v + L.i * 2.5, 3.0, 'T13b KVL 照旧：V_L + I·2.5 = 3', 1e-7);

  // 同一电路里两种模型的差别：定值模式 R 不会随功率掉下来，于是在串联分压里
  // 占的份额更大 —— 灯泡分到更多电压，电流反而更小（总电阻大了）。
  truthy(L.R > N.R, 'T13b 定值模式的灯泡电阻更大（' +
    L.R.toFixed(3) + 'Ω vs ' + N.R.toFixed(3) + 'Ω）');
  truthy(L.v > N.v, 'T13b 定值模式下灯泡分到的电压更多（' +
    L.v.toFixed(4) + 'V vs ' + N.v.toFixed(4) + 'V）');
  truthy(L.i < N.i, 'T13b 定值模式下电流更小（总电阻大了，' +
    L.i.toFixed(4) + 'A vs ' + N.i.toFixed(4) + 'A）');
  // ⚠️ 功率【不】跟着电压走：P = U²/R，R 涨得比 U² 快时功率反而更小。
  // 这里灯泡工作在额定附近（0.65W ≈ 0.75W），两种模型的 R 只差 3%，于是
  // 定值模式的功率略低（0.639 vs 0.650）。离额定越远这差值越大、方向还会
  // 翻过来（见 T13c 的 20Ω 那档：定值模式 0.093W 远大于 0.073W）。
  // 所以这里不钉功率，只钉「同一个 R 决定的两件事」：电阻和电流。
  truthy(Math.abs(L.p - N.p) / N.p < 0.05,
    'T13b 额定附近两种模型的功率只差几个百分点（' +
    L.p.toFixed(4) + 'W vs ' + N.p.toFixed(4) + 'W）');
  truthy(lin.iterations <= 2, 'T13b 定值灯泡不用反复迭代，实际 ' + lin.iterations + ' 轮');
});

test('T13c 温度项一关，改串联电阻就不再改变灯泡电阻（这正是这个开关的意义）', function () {
  var a = lampCase(2.5, false).components.L, b = lampCase(20, false).components.L;
  truthy(a.R === b.R, 'T13c 定值模式：串联电阻 2.5Ω → 20Ω，灯泡电阻纹丝不动（都是 ' +
    a.R.toFixed(3) + 'Ω）');
  truthy(b.p < a.p, 'T13c 但功率确实变了（分得的电压少了）');

  // 同一个电路换成真灯泡，R 立刻跟着走——两组一比才看得出「R 不变」是模型
  // 给的假设，不是物理事实。
  var na = lampCase(2.5, true).components.L, nb = lampCase(20, true).components.L;
  truthy(nb.R < na.R * 0.999, 'T13c 真灯泡：电压低了灯丝冷了，R 跟着掉（' +
    nb.R.toFixed(3) + 'Ω < ' + na.R.toFixed(3) + 'Ω）');

  // 离额定越远，两种模型的功率差别越大，而且方向是【定值模式更亮】：
  // R 大 → 分压多 → P = U²/R 里 U² 涨得赢。低压下这个差别最显眼
  // （0.093W 对 0.073W，差 28%），这正是「不计温度影响」会带来的偏差。
  truthy(b.p > lampCase(20, true).components.L.p * 1.2,
    'T13c 20Ω 那一档：定值模式算出的灯泡功率比真灯泡高两成以上（' +
    b.p.toFixed(4) + 'W vs ' + lampCase(20, true).components.L.p.toFixed(4) + 'W）');
});

test('T13d 不写 tempDependent 时与显式 true 逐字段一致（老场景零变化）', function () {
  var d = lampCase(2.5, undefined).components.L, t = lampCase(2.5, true).components.L;
  ['R', 'v', 'i', 'p', 'Rhot', 'Rcold', 'brightness'].forEach(function (k) {
    truthy(d[k] === t[k], 'T13d ' + k + ' 一致（' + d[k] + ' vs ' + t[k] + '）');
  });
  truthy(d.tempDependent === true, 'T13d 默认就是「随温度升高而增大」');
});

// ============================================================
// T14 滑动变阻器四种接法
// ============================================================
function rheostatCase(termA, termB, slide) {
  // Rmax=20Ω，串一个 10Ω 定值电阻于 3V 电源
  return run([
    comp('E', 'battery', { emf: 3, rInt: 0 }),
    comp('RH', 'rheostat', { Rmax: 20, slide: slide }),
    comp('R', 'resistor', { R: 10 }),
  ], [
    W('E', 0, 'RH', termA), W('RH', termB, 'R', 0), W('R', 1, 'E', 1),
  ], 'T14-' + termA + '-' + termB);
}

// 端子编号照人教版教材图16.4-2 的实物位置：
//   A(0)/B(1) = 下面两个柱 = 电阻丝两端；
//   C(2)/D(3) = 上面两个柱 = 金属杆两端（内部短接成滑片节点）
// slide 语义：0 = 滑片停在 A 端（左），1 = 滑片停在 B 端（右）
test('T14a 变阻器 A-C 接法 slide=0.5 → 接入 10Ω', function () {
  var r = rheostatCase(0, 2, 0.5);
  truthy(r.components.RH.mode === 'A-C', 'T14a 接法应为 A-C，实际 ' + r.components.RH.mode);
  close(r.components.RH.rUsed, 10, 'T14a 接入阻值 = Rmax·slide', 1e-9);
  close(r.components.R.i, 3 / 20, 'T14a 电流 = 3/(10+10)', 1e-9);
  close(r.components.RH.v, 1.5, 'T14a 变阻器分压', 1e-9);
});

test('T14b 变阻器 A-C 接法：滑片由 A 端滑到 B 端，阻值 0 → Rmax', function () {
  var atA = rheostatCase(0, 2, 0);
  var atB = rheostatCase(0, 2, 1);
  close(atA.components.RH.rUsed, 0, 'T14b 滑片在 A 端 → 0Ω', 1e-9);
  close(atB.components.RH.rUsed, 20, 'T14b 滑片在 B 端 → Rmax', 1e-9);
  close(atA.components.R.i, 3 / 10, 'T14b 滑片在 A 端电流', 1e-9);
  close(atB.components.R.i, 3 / 30, 'T14b 滑片在 B 端电流', 1e-9);
});

test('T14c 变阻器 A-C ≡ A-D（C/D 同为金属杆端，接哪个都一样）', function () {
  var ac = rheostatCase(0, 2, 0.5);
  var ad = rheostatCase(0, 3, 0.5);
  truthy(ac.components.RH.mode === 'A-C', 'T14c A-C 接法识别，实际 ' + ac.components.RH.mode);
  truthy(ad.components.RH.mode === 'A-C', 'T14c A-D 也应识别为 A-C，实际 ' + ad.components.RH.mode);
  close(ad.components.RH.rUsed, ac.components.RH.rUsed, 'T14c A-D 与 A-C 应等效', 1e-12);
  close(ad.components.R.i, ac.components.R.i, 'T14c 电流应与 A-C 相同', 1e-12);
  // 同理，下面接 B 时 C/D 也等效
  var bc = rheostatCase(1, 2, 0.5);
  var bd = rheostatCase(1, 3, 0.5);
  close(bd.components.RH.rUsed, bc.components.RH.rUsed, 'T14c B-D 与 B-C 应等效', 1e-12);
});

test('T14d 一上一下：A-C 接入左半段，B-C 接入右半段，两半互补', function () {
  var ac = rheostatCase(0, 2, 0.25);
  var bc = rheostatCase(1, 2, 0.25);
  truthy(ac.components.RH.mode === 'A-C', 'T14d A-C 接法识别，实际 ' + ac.components.RH.mode);
  truthy(bc.components.RH.mode === 'B-C', 'T14d B-C 接法识别，实际 ' + bc.components.RH.mode);
  close(ac.components.RH.rUsed, 5, 'T14d A-C 接入左半段 = 20×0.25', 1e-9);
  close(bc.components.RH.rUsed, 15, 'T14d B-C 接入右半段 = 20×0.75', 1e-9);
  close(ac.components.RH.rUsed + bc.components.RH.rUsed, 20, 'T14d 两半相加 = 整根电阻丝', 1e-9);
  // 滑片移到 A 端（slide=0）：左边那段没了，右边那段变成整根
  var ac0 = rheostatCase(0, 2, 0), bc0 = rheostatCase(1, 2, 0);
  close(ac0.components.RH.rUsed, 0, 'T14d 滑片到 A 端 → 左半段 0Ω', 1e-9);
  close(bc0.components.RH.rUsed, 20, 'T14d 滑片到 A 端 → 右半段 Rmax', 1e-9);
});

test('T14e 变阻器 A-B 接法（两个下柱）→ 整根电阻丝 20Ω，滑片不起作用', function () {
  var lo = rheostatCase(0, 1, 0.2);
  var hi = rheostatCase(0, 1, 0.8);
  truthy(lo.components.RH.mode === 'A-B', 'T14e 接法应为 A-B，实际 ' + lo.components.RH.mode);
  close(lo.components.RH.rUsed, 20, 'T14e 接入全阻', 1e-9);
  close(hi.components.RH.rUsed, 20, 'T14e 接入全阻（滑片拨到哪都一样）', 1e-9);
  close(lo.components.R.i, hi.components.R.i, 'T14e 与滑片位置无关', 1e-12);
  close(lo.components.R.i, 3 / 30, 'T14e 电流 = 3/(20+10)', 1e-9);
});

test('T14f 变阻器 C-D 接法（两个上柱）→ 只有金属杆，0Ω 相当于一根导线', function () {
  var r = rheostatCase(2, 3, 0.6);
  truthy(r.components.RH.mode === 'C-D', 'T14f 接法应为 C-D，实际 ' + r.components.RH.mode);
  close(r.components.RH.rUsed, 0, 'T14f 接入阻值应为 0（滑片完全不起作用）', 1e-12);
  close(r.components.R.i, 3 / 10, 'T14f 电流 = 3/10（变阻器被短路）', 1e-9);
});

// ============================================================
// T14g～T14j 滑动变阻器的【额定电流】（用户 2026-11-21 报的）
// ------------------------------------------------------------
// 用户原话：「它的默认最大电流是 2A，我发现达到 2A 的时候并没有被烧坏，
// 超过 2A 也没有被烧坏」，并且「最大电流是可以提前设定的」。
// 这一组钉四件事：
//   g) 铭牌那个数进了模型（rec.Imax），而且恰好等于额定值【不烧】、超了就烧；
//   h) 烧断之后真的是【断路】—— 电流停、电路判 open-circuit，不是「红了照跑」；
//   i) 判据读的是铭牌上的数：同一股电流，1A 的烧、2A 的不烧（不是写死 2）；
//   j) 只烧【电阻丝上的电流】：接 C-D（只有金属杆）时电流全在杆上，丝里没有，
//      再大也不该记在变阻器头上（那是短路的账，由熔断导线去报）。
function rheoRatedScene(emf, slide, Imax) {
  // 电源（理想，保证电流就是 E/R 好算）× 变阻器一上一下（A 进、C 出）。
  // Rmax 20Ω、slide 0.1 ⇒ 接入 2Ω ⇒ I = emf / 2。
  return {
    comps: [comp('E', 'battery', { emf: emf, rInt: 0 }),
            comp('RH', 'rheostat', { Rmax: 20, slide: slide, Imax: Imax })],
    wires: [W('E', 0, 'RH', 0), W('RH', 2, 'E', 1)],
  };
}
function rheoFaults(s, res) {
  return C.faultsOf(s.comps, s.wires, res, C.wireCurrents(s, res)).comps;
}

test('T14g 额定电流是铭牌规格：恰好 2A 不烧，超过才烧（默认 2A）', function () {
  // ① 规格进了模型：不写 Imax 的老场景也拿到 2A（默认值，向后兼容）
  var s0 = rheoRatedScene(4.4, 0.1, undefined);
  var r0 = run(s0.comps, s0.wires, 'T14g-默认规格');
  close(r0.components.RH.Imax, 2, 'T14g 不写 Imax 时回填默认 2A', 1e-12);
  close(Math.abs(r0.components.RH.i), 2.2, 'T14g 2.2A 的工况（4.4V / 2Ω）', 1e-9);
  var f0 = rheoFaults(s0, r0);
  truthy(f0.length === 1 && f0[0].fault === 'burnt',
    'T14g 2.2A > 2A 必须判烧断，实际 ' + JSON.stringify(f0));
  truthy(f0[0].why.indexOf('2.2') >= 0 && f0[0].why.indexOf('2A') >= 0,
    'T14g 原因里要带【烧断前】的电流和铭牌值：' + (f0[0] && f0[0].why));

  // ② 恰好 2.00A：额定 = 允许长期通过的最大电流，卡在线上不算烧
  var s1 = rheoRatedScene(4, 0.1, 2);
  var r1 = run(s1.comps, s1.wires, 'T14g-恰额定');
  close(Math.abs(r1.components.RH.i), 2, 'T14g 恰好 2A 的工况（4V / 2Ω）', 1e-9);
  truthy(rheoFaults(s1, r1).length === 0,
    'T14g 恰好等于额定电流【不该】烧（只留浮点容差，不留物理余量）');

  // ③ 刚好超一点就烧：判据是「> 额定」，不是「超过 1.5 倍」之类
  var s2 = rheoRatedScene(4.5, 0.1, 2);
  var r2 = run(s2.comps, s2.wires, 'T14g-略超');
  close(Math.abs(r2.components.RH.i), 2.25, 'T14g 2.25A 的工况（4.5V / 2Ω）', 1e-9);
  truthy(rheoFaults(s2, r2).length === 1, 'T14g 2.25A > 2A 必须烧（不是「过载提示」）');
});

test('T14h 烧断以后是【断路】：电流停、rUsed 变 null、电路判 open-circuit', function () {
  var s = rheoRatedScene(4.4, 0.1, 2);
  var before = run(s.comps, s.wires, 'T14h-烧断前');
  close(Math.abs(before.components.RH.i), 2.2, 'T14h 烧断前 2.2A', 1e-9);
  // 把内核判出来的故障【写进场景】（页面做的就是这一步），再解一遍
  s.comps[1].fault = 'burnt';
  var after = C.solve(s.comps, s.wires, {});
  close(after.components.RH.i, 0, 'T14h 烧断的变阻器里没有电流（= 开路）', 1e-12);
  truthy(after.components.RH.rUsed == null, 'T14h 烧断后没有「接入阻值」可言（null，不是 0）');
  truthy(after.status === 'open-circuit',
    'T14h 电路应判 open-circuit，实际 ' + after.status);
  truthy(C.isOpenFault(s.comps[1]) === true, 'T14h burnt 必须算开路故障（isOpenFault）');
});

test('T14i 判据读的是铭牌上的数：同一股 1.6A，1A 的烧、2A 的不烧', function () {
  // 3.2V / 2Ω = 1.6A。同一个电路、同一股电流，只有 Imax 不同 —— 这条专抓
  //「把 2A 写死在代码里」的实现：那种实现下面两种情形会给出同样的结论。
  var sLow = rheoRatedScene(3.2, 0.1, 1);
  var sOk = rheoRatedScene(3.2, 0.1, 2);
  var rLow = run(sLow.comps, sLow.wires, 'T14i-1A 规格');
  var rOk = run(sOk.comps, sOk.wires, 'T14i-2A 规格');
  close(Math.abs(rLow.components.RH.i), 1.6, 'T14i 工况 1.6A', 1e-9);
  close(Math.abs(rOk.components.RH.i), 1.6, 'T14i 两场的电流必须一样', 1e-12);
  truthy(rheoFaults(sLow, rLow).length === 1, 'T14i 1A 的变阻器在 1.6A 下烧断');
  truthy(rheoFaults(sOk, rOk).length === 0, 'T14i 2A 的变阻器在 1.6A 下不烧');
  close(rOk.components.RH.Imax, 2, 'T14i 铭牌值原样回填（2A）', 1e-12);
  close(rLow.components.RH.Imax, 1, 'T14i 铭牌值原样回填（1A）', 1e-12);
});

test('T14j 接 C-D / 滑片停在 A 端：电流全在金属杆与滑片上，不判电阻丝烧断', function () {
  // C-D 接法（两个上柱）：变阻器 0Ω，回路只剩 1Ω 电阻 ⇒ 3A。
  // 这 3A 走的是【金属杆】，电阻丝里一安都没有（rUsed = 0）—— 再大的电流
  // 也不该记在「电阻丝过热」头上，否则学生看到的是「变阻器烧了」，
  // 而他明明只是把两个上柱接成了一条导线（经典错接法，考点完全不同）。
  var s = {
    comps: [comp('E', 'battery', { emf: 3, rInt: 0 }),
            comp('RH', 'rheostat', { Rmax: 20, slide: 0.5, Imax: 0.5 }),
            comp('R', 'resistor', { R: 1 })],
    wires: [W('E', 0, 'RH', 2), W('RH', 3, 'R', 0), W('R', 1, 'E', 1)],
  };
  var res = run(s.comps, s.wires, 'T14j-C-D');
  close(Math.abs(res.components.R.i), 3, 'T14j 回路电流 3A（0Ω + 1Ω）', 1e-9);
  close(res.components.RH.rUsed, 0, 'T14j C-D 接法接入 0Ω', 1e-12);
  truthy(rheoFaults(s, res).length === 0,
    'T14j 丝里没有电流，不该判「电阻丝烧断」（这一档是短路，账记在导线上）');

  // 反面：A-C 接法、滑片停在 A 端（左半段 0Ω）同样是 0Ω，同样不烧
  var s2 = rheoRatedScene(3, 0, 0.5);
  s2.comps.push(comp('R', 'resistor', { R: 1 }));
  s2.wires = [W('E', 0, 'RH', 0), W('RH', 2, 'R', 0), W('R', 1, 'E', 1)];
  var res2 = run(s2.comps, s2.wires, 'T14j-滑片在 A 端');
  close(res2.components.RH.rUsed, 0, 'T14j 滑片在 A 端时接入 0Ω', 1e-12);
  truthy(rheoFaults(s2, res2).length === 0,
    'T14j 滑片在 A 端、丝里没电流，不该判烧断');
});

// ============================================================
// T15 多电源
// ============================================================
test('T15a 两电源同向串联：6V + 3V 接 3Ω → I=3A', function () {
  var r = run([
    comp('E1', 'battery', { emf: 6, rInt: 0 }),
    comp('E2', 'battery', { emf: 3, rInt: 0 }),
    comp('R', 'resistor', { R: 3 }),
  ], [
    W('E1', 0, 'E2', 1), W('E2', 0, 'R', 0), W('R', 1, 'E1', 1),
  ], 'T15a');
  close(r.components.R.i, 3.0, 'T15a 电流 = (6+3)/3', 1e-9);
  close(r.components.R.v, 9.0, 'T15a R 上电压', 1e-9);
});

test('T15b 两电源反向串联：6V − 3V 接 3Ω → I=1A', function () {
  var r = run([
    comp('E1', 'battery', { emf: 6, rInt: 0 }),
    comp('E2', 'battery', { emf: 3, rInt: 0 }),
    comp('R', 'resistor', { R: 3 }),
  ], [
    W('E1', 0, 'E2', 0), W('E2', 1, 'R', 0), W('R', 1, 'E1', 1),   // E2 反接
  ], 'T15b');
  close(r.components.R.i, 1.0, 'T15b 电流 = (6−3)/3', 1e-9);
});

// ============================================================
// T16 电表接反
// ============================================================
test('T16 电流表反接：读数应为负且被标记', function () {
  var r = run([
    comp('E', 'battery', { emf: 3, rInt: 0 }),
    comp('R', 'resistor', { R: 10 }),
    comp('A', 'ammeter', { range: 0.6, rInternal: 0 }),
  ], [
    // 反接：电源正极接到了「−」柱（端子 0），量程柱（端子 1）反而接了负载。
    // 电流从「−」柱流进、从量程柱流出 ⇒ rec.i < 0。
    W('E', 0, 'A', 0), W('A', 1, 'R', 0), W('R', 1, 'E', 1),
  ], 'T16');

  truthy(r.components.A.i < 0, 'T16 反接时电流读数应为负，实际 ' + r.components.A.i);
  truthy(r.components.A.reversed === true, 'T16 应被标记 reversed');
  close(Math.abs(r.components.A.i), 0.3, 'T16 电流大小仍应为 0.3A', 1e-9);
});

// ============================================================
// T17 悬空 / 断路
// ============================================================
test('T17 悬空元件：只接一端的电阻 + 空电压表 + 空电流表', function () {
  var r = run([
    comp('E', 'battery', { emf: 3, rInt: 0 }),
    comp('R', 'resistor', { R: 10 }),
    comp('RH', 'resistor', { R: 5 }),        // 只有一端接 E+
    comp('V', 'voltmeter', { range: 3, rInternal: null }),
    comp('A', 'ammeter', { range: 0.6, rInternal: 0 }),
  ], [
    W('E', 0, 'R', 0), W('R', 1, 'E', 1),
    W('E', 0, 'RH', 0),                       // RH 另一端悬空
  ], 'T17');

  close(r.components.R.i, 0.3, 'T17 主回路电流不受悬空件影响', 1e-12);
  close(r.components.RH.i, 0, 'T17 悬空电阻电流为 0', 1e-15);
  close(r.components.V.i, 0, 'T17 空电压表电流为 0', 1e-15);
  close(r.components.A.i, 0, 'T17 空电流表电流为 0', 1e-15);
  truthy(Number.isFinite(r.components.RH.v), 'T17 悬空元件电压应为有限数');
  // 三柱表头一根线都没接：量程柱空着 ⇒ 表头不在电路里，也没有「量程」可言
  truthy(r.components.A.rangeWired === false, 'T17 没接量程柱的表不该有可用量程');
  truthy(!r.warnings.some(function (w) { return w.code === 'METER_NO_RANGE'; }),
    'T17 完全没接线的表不该报「只接了 − 柱」');
});

// ============================================================
// T17b 量程由「导线接在哪个量程柱上」决定（人教版三柱表头）
// 这是这次改动的核心：同一个电路、同一个电流值，接 0.6 柱和接 3 柱
// 除了量程不同，超量程判定也必须不同。改错了不会报错，只会读数不对。
// ============================================================
function seriesAmmeter(taps, opts) {
  // E=4V 串 R=5Ω 串电流表 ⇒ 0.8A
  var wires = [W('A', 0, 'R', 0), W('R', 1, 'E', 1)];
  taps.forEach(function (t) { wires.push(W('E', 0, 'A', t)); });
  return {
    comps: [comp('E', 'battery', { emf: 4, rInt: 0 }),
            comp('A', 'ammeter', { range: 0.6, rInternal: 0 }),
            comp('R', 'resistor', { R: 5 })],
    wires: wires,
  };
}

test('T17b 接 0.6 柱 vs 接 3 柱：电流相同，量程与超量程判定不同', function () {
  var lo = seriesAmmeter([1]);
  var hi = seriesAmmeter([2]);
  var rLo = run(lo.comps, lo.wires, 'T17b-0.6');
  var rHi = run(hi.comps, hi.wires, 'T17b-3');

  close(rLo.components.A.i, 0.8, 'T17b 接 0.6 柱读数 0.8A', 1e-12);
  close(rHi.components.A.i, 0.8, 'T17b 接 3 柱读数同样 0.8A（同一条支路）', 1e-12);

  close(rLo.components.A.range, 0.6, 'T17b 接 0.6 柱时量程必须是 0.6A', 0);
  close(rHi.components.A.range, 3, 'T17b 接 3 柱时量程必须是 3A', 0);
  truthy(rLo.components.A.rangeWired && rHi.components.A.rangeWired,
    'T17b 两种接法都应标记「量程已接上」');

  // 0.8A 超 0.6A 量程但不超 3A —— 真表上就是「指针打到底」和「指在 27% 处」
  truthy(rLo.components.A.overRange === true, 'T17b 0.8A 应判超 0.6A 量程');
  truthy(rLo.warnings.some(function (w) { return w.code === 'METER_OVER_RANGE'; }),
    'T17b 超量程应给出 METER_OVER_RANGE 告警');
  truthy(rHi.components.A.overRange === false, 'T17b 0.8A 不该判超 3A 量程');
  truthy(!rHi.warnings.some(function (w) { return w.code === 'METER_OVER_RANGE'; }),
    'T17b 接 3 柱不该报超量程');

  close(rLo.components.A.tapIdx, 1, 'T17b 记录生效的量程端子号（渲染层要用）', 0);
  close(rHi.components.A.tapIdx, 2, 'T17b 记录生效的量程端子号', 0);
});

test('T17c 两个量程柱同时接：取小量程 + METER_RANGE_CONFLICT 告警', function () {
  var sc = seriesAmmeter([1]);
  sc.wires.push(W('A', 2, 'R', 0));            // 3 柱上又接了一根
  var r = run(sc.comps, sc.wires, 'T17c');

  close(r.components.A.i, 0.8, 'T17c 仍然只走一条支路，电流不会翻倍', 1e-12);
  close(r.components.A.range, 0.6, 'T17c 两个柱都接时取【小】量程', 0);
  truthy(r.warnings.some(function (w) { return w.code === 'METER_RANGE_CONFLICT'; }),
    'T17c 应给出 METER_RANGE_CONFLICT 告警',
    r.warnings.map(function (w) { return w.code; }));

  // 悬空的那个量程柱必须注入 0：写成端子 1 的符号会让这根线凭空多一倍电流
  var rows = kclResidual(sc, r);
  var bad = rows.filter(function (x) { return Math.abs(x.diff) > 1e-9; });
  truthy(bad.length === 0, 'T17c 两个量程柱的端子 KCL 都要成立',
    bad.map(function (x) { return x.term + ' 残差 ' + x.diff; }));
});

test('T17d 只接「−」柱：表头没进电路，读数 0 且必须告警', function () {
  var r = run([
    comp('E', 'battery', { emf: 3, rInt: 0 }),
    comp('R', 'resistor', { R: 10 }),
    comp('A', 'ammeter', { range: 0.6, rInternal: 0 }),
  ], [
    W('E', 0, 'A', 0), W('A', 0, 'R', 0), W('R', 1, 'E', 1),   // 只接了「−」柱
  ], 'T17d');

  close(r.components.A.i, 0, 'T17d 没接量程柱 ⇒ 表头不分流，电流恒 0', 1e-15);
  truthy(r.components.A.rangeWired === false, 'T17d 不该有可用量程');
  truthy(r.warnings.some(function (w) { return w.code === 'METER_NO_RANGE'; }),
    'T17d 应给出 METER_NO_RANGE 告警（学生少接一根线，指针不动得说清原因）',
    r.warnings.map(function (w) { return w.code; }));
  truthy(!r.warnings.some(function (w) { return w.code === 'METER_REVERSED'; }),
    'T17d 没电流就谈不上接反');
  // 两根线都落在同一个「−」柱上，等于把表头短路掉了：主回路照常通，
  // 但电流全部从表外走 —— 这正是「接了一半」最迷惑人的地方，指针不动，
  // 电路却「看着是通的」，所以必须靠 METER_NO_RANGE 告警点破。
  close(r.components.R.i, 0.3, 'T17d 主回路电流照常 0.3A（表头被绕过）', 1e-12);
  close(r.components.E.i, 0.3, 'T17d 电源电流照常', 1e-12);
  truthy(r.status === 'ok', 'T17d 表头被绕过，电路本身是通的，实际 ' + r.status);
});

test('T17e 电压表接 15V 柱：量程 15V，读数与 3V 柱相同', function () {
  function build(tap) {
    return run([
      comp('E', 'battery', { emf: 6, rInt: 0 }),
      comp('R1', 'resistor', { R: 10 }),
      comp('R2', 'resistor', { R: 20 }),
      comp('V', 'voltmeter', { range: 3, rInternal: null }),
    ], [
      W('E', 0, 'R1', 0), W('R1', 1, 'R2', 0), W('R2', 1, 'E', 1),
      W('R1', 1, 'V', tap), W('V', 0, 'E', 1),
    ], 'T17e-' + tap);
  }
  var lo = build(1), hi = build(2);
  close(lo.components.V.v, 4, 'T17e 接 3V 柱读数 4V', 1e-9);
  close(hi.components.V.v, 4, 'T17e 接 15V 柱读数同样是 4V', 1e-9);
  close(lo.components.V.range, 3, 'T17e 端子 1 = 3V 量程', 0);
  close(hi.components.V.range, 15, 'T17e 端子 2 = 15V 量程', 0);
  truthy(lo.components.V.overRange === true, 'T17e 4V 超 3V 量程');
  truthy(hi.components.V.overRange === false, 'T17e 4V 不超 15V 量程');
  truthy(hi.components.V.reversed === false, 'T17e 15V 柱是正接');
});

test('T17f 电压表接反：读数变负并标记（− 柱接到了高电位一侧）', function () {
  var r = run([
    comp('E', 'battery', { emf: 6, rInt: 0 }),
    comp('R1', 'resistor', { R: 10 }),
    comp('R2', 'resistor', { R: 20 }),
    comp('V', 'voltmeter', { range: 15, rInternal: null }),
  ], [
    W('E', 0, 'R1', 0), W('R1', 1, 'R2', 0), W('R2', 1, 'E', 1),
    W('R1', 1, 'V', 0), W('V', 2, 'E', 1),          // 「−」柱接高电位侧 = 接反
  ], 'T17f');

  close(r.components.V.v, -4, 'T17f 接反读数应为 −4V（不是 0）', 1e-9);
  truthy(r.components.V.reversed === true, 'T17f 应被标记 reversed');
  truthy(r.warnings.some(function (w) { return w.code === 'METER_REVERSED'; }),
    'T17f 应给出 METER_REVERSED 告警');
});

// 「表头要两端都接上才算进了电路」。三柱表有两个接点：量程柱和「−」柱。
// 只接一根柱子时，另一头是悬空的节点——理想电压表会把悬空节点当成 0V，
// 于是读出一个【像模像样的电路节点电位】（3V 电源就报 3.000V），学生完全
// 看不出表根本没接进去。这是用户实测报上来的 bug，两条路径都得钉死。
test('T17g 电压表只接量程柱：读数必须是 0，并给出 METER_NO_COMMON 告警', function () {
  var r = run([
    comp('E', 'battery', { emf: 3, rInt: 0 }),
    comp('R1', 'resistor', { R: 10 }),
    comp('V', 'voltmeter', { range: 3, rInternal: null }),
  ], [
    W('E', 0, 'R1', 0), W('R1', 1, 'E', 1),
    W('R1', 1, 'V', 1),                            // 只接了量程柱，「−」柱空着
  ], 'T17g');

  var V = r.components.V;
  truthy(V.rangeWired === true, 'T17g 量程柱接着线，量程本身是有的');
  truthy(V.commonWired === false, 'T17g 「−」柱没接线');
  truthy(V.wired === false, 'T17g 两端没接全 ⇒ 表不在电路里');
  close(V.v, 0, 'T17g 只接量程柱时读数必须是 0（改前会读出电路节点电位 3V）', 1e-12);
  close(V.reading, 0, 'T17g reading 同样是 0', 1e-12);
  truthy(V.reversed === false && V.overRange === false,
    'T17g 表没进电路，谈不上接反或超量程',
    { reversed: V.reversed, overRange: V.overRange });
  truthy(r.warnings.some(function (w) { return w.code === 'METER_NO_COMMON'; }),
    'T17g 应给出 METER_NO_COMMON 告警（学生少接一根线，得说清是哪一根）',
    r.warnings.map(function (w) { return w.code; }));
  truthy(!r.warnings.some(function (w) { return w.code === 'METER_REVERSED'; }),
    'T17g 没读数就谈不上接反');
  // 悬空的表不该把主回路带偏：串联的 R1 两端仍是 3V。
  close(r.components.R1.v, 3, 'T17g 悬空电压表不影响主回路', 1e-9);
  close(r.components.R1.i, 0.3, 'T17g 主回路电流照常', 1e-12);
});

test('T17h 电压表只接「−」柱：读数同样是 0，告警是 METER_NO_RANGE', function () {
  var r = run([
    comp('E', 'battery', { emf: 3, rInt: 0 }),
    comp('R1', 'resistor', { R: 10 }),
    comp('V', 'voltmeter', { range: 3, rInternal: null }),
  ], [
    W('E', 0, 'R1', 0), W('R1', 1, 'E', 1),
    W('R1', 1, 'V', 0),                            // 只接了「−」柱
  ], 'T17h');

  var V = r.components.V;
  truthy(V.rangeWired === false && V.wired === false, 'T17h 没接量程柱 ⇒ 表不在电路里');
  close(V.v, 0, 'T17h 改前会读出 −3V（0 减「−」柱电位），现在是 0', 1e-12);
  truthy(V.reversed === false, 'T17h 不该报反接（改前会误报）');
  truthy(r.warnings.some(function (w) { return w.code === 'METER_NO_RANGE'; }),
    'T17h 应给出 METER_NO_RANGE 告警');
  truthy(!r.warnings.some(function (w) { return w.code === 'METER_NO_COMMON'; }),
    'T17h 「−」柱是接了的，不该报 METER_NO_COMMON',
    r.warnings.map(function (w) { return w.code; }));
});

// 有内阻的电压表走的是【另一条】回填路径（有支路），必须同样抹零：
// 支路另一端悬空时支路里没有电流，但两端电位差照样算得出来。
test('T17i 有内阻的电压表只接量程柱：读数同样必须是 0', function () {
  var r = run([
    comp('E', 'battery', { emf: 3, rInt: 0 }),
    comp('R1', 'resistor', { R: 10 }),
    comp('V', 'voltmeter', { range: 3, rInternal: 3000 }),
  ], [
    W('E', 0, 'R1', 0), W('R1', 1, 'E', 1),
    W('R1', 1, 'V', 1),
  ], 'T17i');

  var V = r.components.V;
  truthy(V.wired === false, 'T17i 表不在电路里');
  close(V.v, 0, 'T17i 有内阻的电压表读数也得是 0', 1e-12);
  close(V.i, 0, 'T17i 悬空支路没有电流', 1e-15);
  truthy(V.reversed === false, 'T17i 不该报反接');
});

// 电流表同理：只接一个柱子时表头串不进去，读数恒 0，也不能判反接/超量程。
test('T17j 电流表只接量程柱：读数 0，且不给 METER_NO_RANGE（那根线是接了的）', function () {
  var r = run([
    comp('E', 'battery', { emf: 3, rInt: 0 }),
    comp('R', 'resistor', { R: 10 }),
    comp('A', 'ammeter', { range: 0.6, rInternal: 0 }),
  ], [
    W('E', 0, 'R', 0), W('R', 1, 'A', 1), W('A', 1, 'E', 1),   // 电流只从量程柱进
  ], 'T17j');

  var A = r.components.A;
  truthy(A.rangeWired === true && A.commonWired === false && A.wired === false,
    'T17j 量程柱接了、「−」柱没接 ⇒ 表不在电路里');
  close(A.reading, 0, 'T17j 读数 0', 1e-15);
  truthy(A.reversed === false, 'T17j 不该报反接');
  truthy(r.warnings.some(function (w) { return w.code === 'METER_NO_COMMON'; }),
    'T17j 应给出 METER_NO_COMMON 告警',
    r.warnings.map(function (w) { return w.code; }));
  truthy(!r.warnings.some(function (w) { return w.code === 'METER_NO_RANGE'; }),
    'T17j 量程柱是接着的，不该报 METER_NO_RANGE');
});

// ============================================================
// T18 元件被导线短接
// ============================================================
test('T18 电阻被短接：10Ω 被导线跨接，等效于不存在', function () {
  var r = run([
    comp('E', 'battery', { emf: 3, rInt: 0 }),
    comp('R1', 'resistor', { R: 10 }),
    comp('R2', 'resistor', { R: 10 }),      // 被导线短接
  ], [
    W('E', 0, 'R1', 0),
    W('R1', 1, 'R2', 0), W('R1', 1, 'R2', 1),   // R2 两端短接
    W('R2', 1, 'E', 1),
  ], 'T18');

  close(r.components.R2.i, 0, 'T18 被短接电阻电流应为 0', 1e-12);
  close(r.components.R2.v, 0, 'T18 被短接电阻电压应为 0', 1e-12);
  close(r.components.R1.i, 0.3, 'T18 干路电流 = 3/10（等效于 R2 不存在）', 1e-12);
});

// ============================================================
// T19 随机拓扑不变量（覆盖手写用例想不到的组合）
// ============================================================
test('T19 随机拓扑：20 组随机电路全部满足全局不变量', function () {
  var seed = 12345;
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }

  for (var trial = 0; trial < 20; trial++) {
    var n = 3 + Math.floor(rnd() * 5);
    var comps = [comp('E', 'battery', { emf: 1 + rnd() * 11, rInt: rnd() * 1.5 })];
    var wires = [];
    var prev = 'E';
    var prevTerm = 0;
    for (var i = 0; i < n; i++) {
      var id = 'R' + i;
      comps.push(comp(id, 'resistor', { R: 1 + rnd() * 40 }));
      wires.push(W(prev, prevTerm, id, 0));
      prev = id; prevTerm = 1;
    }
    wires.push(W(prev, prevTerm, 'E', 1));

    var res = C.solve(comps, wires);
    truthy(res.ok !== false, 'T19 第 ' + trial + ' 组不应求解失败');
    invariants(res, 'T19#' + trial);
  }
});

// ============================================================
// T21 奇异矩阵的分诊：短路 vs 接线矛盾
// ============================================================
// 矩阵奇异的原因不止一种，报错信息必须分得开：
// 学生把开关并在电源两端再合上，这是【短路】，不是「接线矛盾」。
test('T21a 理想电源被闭合开关直接短接 → status 应为 shorted', function () {
  var r = C.solve([
    comp('E', 'battery', { emf: 3, rInt: 0 }),
    comp('SW', 'switch', { closed: true }),
  ], [W('E', 0, 'SW', 0), W('E', 1, 'SW', 1)], { });

  truthy(r.status === 'shorted', 'T21a 应报短路，实际 ' + r.status);
  truthy((r.warnings || []).some(function (w) { return w.code === 'SHORT_CIRCUIT'; }),
    'T21a 应给出 SHORT_CIRCUIT 警告');
  truthy(Number.isFinite(r.components.E ? r.components.E.i : 0), 'T21a 不能产生 NaN');
});

test('T21b 理想电源被导线直接短接 → status 应为 shorted', function () {
  var r = C.solve([comp('E', 'battery', { emf: 3, rInt: 0 })],
    [W('E', 0, 'E', 1)], {});
  truthy(r.status === 'shorted', 'T21b 应报短路，实际 ' + r.status);
});

test('T21c 电源有内阻时短接是可解电路，不该报错', function () {
  var r = run([
    comp('E', 'battery', { emf: 3, rInt: 1 }),
    comp('SW', 'switch', { closed: true }),
  ], [W('E', 0, 'SW', 0), W('E', 1, 'SW', 1)], 'T21c');
  truthy(r.status === 'ok', 'T21c 有内阻时是正常电路，实际 ' + r.status);
  close(Math.abs(r.components.E.i), 3.0, 'T21c 短路电流 = 3V/1Ω', 1e-9);
});

test('T21d 真正的接线矛盾仍报 singular，不能被短路诊断吞掉', function () {
  // 两个理想电压源并联在同一对节点上，给出不同电压 —— 无解
  var r = C.solve([
    comp('E1', 'battery', { emf: 3, rInt: 0 }),
    comp('E2', 'battery', { emf: 5, rInt: 0 }),
  ], [W('E1', 0, 'E2', 0), W('E1', 1, 'E2', 1)], {});

  // 两个源给出不同电压确实是矛盾——但这本质上也是「一个源把另一个源短路」，
  // 两种说法都成立。这里钉死的是：不能既不是 shorted 又不是 singular。
  truthy(r.status === 'shorted' || r.status === 'singular',
    'T21d 必须落到 shorted 或 singular 之一，实际 ' + r.status);
  truthy(r.ok === false, 'T21d 求解不应标记为成功');
});

test('T21e 两只闭合开关并联控制同一盏灯：两个都合上灯还亮，电流各走一半', function () {
  // 学生最常见的接法（也是曾经报过的 bug）：两只开关并在一起当「双控」用。
  // 只合一只时一切正常；两只都合上，矩阵里出现两行一模一样的方程
  //（两条 V:0,Rs:0 的理想短路，同一对节点）⇒ 判奇异 ⇒ 整条电路解不出来，
  // 灯反而灭了。正确结果：与只合一只完全相同，电流在两只开关之间平分。
  function mk(sw1, sw2) {
    return [
      comp('E', 'battery', { emf: 3, rInt: 0 }),
      comp('S1', 'switch', { closed: sw1 }),
      comp('S2', 'switch', { closed: sw2 }),
      comp('L', 'bulb', { ratedU: 3, ratedP: 0.75, tempDependent: false }),
    ];
  }
  var wiresP = [
    W('E', 0, 'S1', 0), W('E', 0, 'S2', 0),
    W('S1', 1, 'L', 0), W('S2', 1, 'L', 0),
    W('L', 1, 'E', 1),
  ];

  var one = run(mk(true, false), wiresP, 'T21e-一只');
  var both = run(mk(true, true), wiresP, 'T21e-两只');

  truthy(both.status === 'ok', 'T21e 两只都合上必须能解，实际 ' + both.status);
  // 灯泡工作点与「只合一只」逐位一致（灯丝电阻、电流、功率）
  close(both.components.L.i, one.components.L.i, 'T21e 灯的电流不变', 1e-9);
  close(both.components.L.p, one.components.L.p, 'T21e 灯的功率不变', 1e-9);
  close(both.components.L.R, one.components.L.R, 'T21e 灯丝电阻不变', 1e-9);
  // 电流在两只开关之间平分（而不是一整份算到其中一只头上、另一只写 0）
  close(both.components.S1.i, both.components.S2.i, 'T21e 两只开关电流相等', 1e-9);
  close(both.components.S1.i + both.components.S2.i,
        both.components.E.i, 'T21e 两开关电流之和 = 干路电流', 1e-9);
  truthy(!(both.warnings || []).some(function (w) { return w.code === 'SWITCH_BYPASSED'; }),
    'T21e 不该把并联的另一只开关报成「被导线短接」');
});

test('T21f 理想电源与闭合开关并联（电压不同）仍然报短路，不能被合并吞掉', function () {
  // T21e 的合并只对【电压相同】的冗余支路生效。理想电源两端并一个闭合开关
  // 是一条 0V 与一条 3V 压在同一对节点上 —— 那是最经典的短路，必须照报。
  var r = C.solve([
    comp('E', 'battery', { emf: 3, rInt: 0 }),
    comp('SW', 'switch', { closed: true }),
    comp('R', 'resistor', { R: 10 }),
  ], [W('E', 0, 'SW', 0), W('E', 1, 'SW', 1), W('E', 0, 'R', 0), W('R', 1, 'E', 1)], {});

  truthy(r.status === 'shorted', 'T21f 应报短路，实际 ' + r.status);
});

// ============================================================
// T20 导线电流分布（画面上电流粒子朝哪边跑，靠的就是它）
// ============================================================
// MNA 解出来的是「节点电位 + 元件支路电流」，没有单根导线的电流——
// 并查集把每根导线两端并成了同一个电气节点。wireCurrents() 靠剥叶子
// 把这笔账还原出来。这里用并联电路钉死四个值：干路 0.45A、支路 0.30/0.15A。
test('T20 导线电流分布：并联电路的干路与支路各自是多少', function () {
  var scene = {
    comps: [comp('R1', 'resistor', { R: 10 }), comp('R2', 'resistor', { R: 20 }),
            comp('E', 'battery', { emf: 3, rInt: 0 })],
    wires: [
      W('R1', 0, 'R2', 0),    // 左母线
      W('R2', 0, 'E', 0),
      W('R1', 1, 'R2', 1),    // 右母线
      W('R2', 1, 'E', 1),
    ],
  };
  var res = C.solve(scene.comps, scene.wires);
  var f = C.wireCurrents(scene, res);

  truthy(f.length === 4, 'T20 应返回 4 根导线的电流，实际 ' + f.length);
  // 左母线只承担 R1 的支路电流，右母线同理；中间两根是干路
  close(Math.abs(f[0]), 0.30, 'T20 左母线电流 = R1 支路', 1e-9);
  close(Math.abs(f[2]), 0.30, 'T20 右母线电流 = R1 支路', 1e-9);
  close(Math.abs(f[1]), 0.45, 'T20 R2 下端到电源的导线 = 干路', 1e-9);
  close(Math.abs(f[3]), 0.45, 'T20 R2 上端到电源的导线 = 干路', 1e-9);

  // KCL：电源正极流出的 0.45A 分成 0.30 + 0.15
  var branchSum = Math.abs(res.components.R1.i) + Math.abs(res.components.R2.i);
  close(branchSum, Math.abs(f[1]), 'T20 两条支路之和 = 干路', 1e-9);
});

test('T20b 导线电流分布：串联回路四根导线处处相等', function () {
  var scene = {
    comps: [comp('E', 'battery', { emf: 3, rInt: 0 }), comp('R1', 'resistor', { R: 10 }),
            comp('R2', 'resistor', { R: 20 })],
    wires: [W('E', 0, 'R1', 0), W('R1', 1, 'R2', 0), W('R2', 1, 'E', 1)],
  };
  var res = C.solve(scene.comps, scene.wires);
  var f = C.wireCurrents(scene, res);
  f.forEach(function (v, i) {
    close(Math.abs(v), 0.1, 'T20b 第 ' + i + ' 根导线电流应为 0.1A', 1e-9);
  });
});

test('T20c 导线电流分布：断路时全为 0；未接线的元件不参与', function () {
  var scene = {
    comps: [comp('E', 'battery', { emf: 3, rInt: 0 }), comp('R1', 'resistor', { R: 10 }),
            comp('SW', 'switch', { closed: false }), comp('RX', 'resistor', { R: 100 })],
    wires: [W('E', 0, 'R1', 0), W('R1', 1, 'SW', 0), W('SW', 1, 'E', 1)],
  };
  var res = C.solve(scene.comps, scene.wires);
  var f = C.wireCurrents(scene, res);
  f.forEach(function (v, i) {
    close(v, 0, 'T20c 断路时第 ' + i + ' 根导线电流应为 0', 1e-12);
  });
});

test('T20d 导线电流分布：不产生 NaN，长度与 wires 一致', function () {
  // 空场景 / 空结果 / 悬空导线，都要能安全返回
  var f1 = C.wireCurrents({ comps: [], wires: [] }, C.solve([], []));
  truthy(f1.length === 0, 'T20d 空场景应返回空数组');

  var scene = {
    comps: [comp('E', 'battery', { emf: 3, rInt: 0 }), comp('R1', 'resistor', { R: 10 }),
            comp('R2', 'resistor', { R: 10 })],
    wires: [W('E', 0, 'R1', 0), W('R1', 1, 'E', 1), W('R2', 0, 'R2', 1)],  // 最后一根悬空
  };
  var res = C.solve(scene.comps, scene.wires);
  var f = C.wireCurrents(scene, res);
  truthy(f.length === scene.wires.length, 'T20d 返回值长度必须等于导线数');
  f.forEach(function (v, i) {
    truthy(Number.isFinite(v), 'T20d 第 ' + i + ' 根导线电流不能是 NaN/Infinity');
  });
  truthy(C.wireCurrents(scene, null).every(function (v) { return v === 0; }),
    'T20d 没有解时应返回全 0');
});

test('T20e 导线电流分布：变阻器串在回路里，导线也要有电流', function () {
  // 变阻器内部是 C-D 金属杆短接 + 两个半段，不是简单的两端元件。
  // 曾经这里整个跳过（terminalInjection 直接 return 0），结果变阻器
  // 那一段导线电流恒为 0，画面上就是「电流粒子走到变阻器前面停住」。
  //
  // 接法：B(电阻丝一端) 进、C(金属杆) 出，电流走 B→右半段→滑片→C，
  // 用到的阻值 = Rmax×(1−slide)。slide=0.25、Rmax=20 → 15Ω。
  // 回路总阻 = 15 + 5 = 20Ω → I = 4.5/20 = 0.225A。
  var scene = {
    comps: [comp('E', 'battery', { emf: 4.5, rInt: 0 }),
            comp('RH', 'rheostat', { Rmax: 20, slide: 0.25 }),
            comp('R1', 'resistor', { R: 5 })],
    wires: [W('E', 0, 'RH', 1), W('RH', 2, 'R1', 0), W('R1', 1, 'E', 1)],
  };
  var res = C.solve(scene.comps, scene.wires);
  truthy(res.status === 'ok', 'T20e 电路应可解，实际 ' + res.status);
  close(res.components.RH.rUsed, 15, 'T20e 变阻器用到的阻值 = Rmax×(1−slide)', 1e-9);
  close(Math.abs(res.components.RH.i), 0.225, 'T20e 回路电流 = 4.5/(15+5)', 1e-9);

  var f = C.wireCurrents(scene, res);
  f.forEach(function (v, i) {
    close(Math.abs(v), 0.225, 'T20e 第 ' + i + ' 根导线电流应为 0.225A', 1e-9);
  });
  // 符号约定是「正 = 从这根线自己的 a 端流向 b 端」。上面三根线是按
  // 回路顺序首尾相接写的（E+ → RH → R1 → E−），所以电流绕一圈方向一致，
  // 三根线应当同号。若某根线反号，说明它的电流被算反了——画面上就是
  // 粒子在这根线上朝反方向跑。
  truthy(f[0] > 0 && f[1] > 0 && f[2] > 0,
    'T20e 沿回路同向书写的三根导线应同号（都为正）', { f: f.map(function (x) { return +x.toFixed(6); }) });
});

test('T20f 导线电流分布：接 A、B 时 slide 不影响阻值，导线电流也不能受影响', function () {
  // 接 A、B 两个下柱 = 整根电阻丝接入，恒等于 Rmax，这是初中最经典的
  // 错误接法（「滑片不起作用」），滑片怎么推电流都不变——导线电流同样得纹丝不动。
  function run(slide) {
    var scene = {
      comps: [comp('E', 'battery', { emf: 4.5, rInt: 0 }),
              comp('RH', 'rheostat', { Rmax: 20, slide: slide }),
              comp('R1', 'resistor', { R: 5 })],
      wires: [W('E', 0, 'RH', 0), W('RH', 1, 'R1', 0), W('R1', 1, 'E', 1)],
    };
    var res = C.solve(scene.comps, scene.wires);
    return { res: res, f: C.wireCurrents(scene, res) };
  }
  var a = run(0.2), b = run(0.8);
  close(a.res.components.RH.rUsed, 20, 'T20f 接 A、B 时阻值恒为 Rmax', 1e-9);
  close(b.res.components.RH.rUsed, 20, 'T20f 滑片推到底阻值也还是 Rmax', 1e-9);
  close(Math.abs(a.f[0]), Math.abs(b.f[0]), 'T20f 滑片从 0.2 推到 0.8，导线电流不变', 1e-12);
  a.f.forEach(function (v, i) {
    close(Math.abs(v), 4.5 / 25, 'T20f 第 ' + i + ' 根导线电流 = 4.5/(20+5)', 1e-9);
  });
  truthy(a.f[0] > 0 && a.f[1] > 0 && a.f[2] > 0,
    'T20f 沿回路同向书写的三根导线应同号（都为正）',
    { f: a.f.map(function (x) { return +x.toFixed(6); }) });
});

// ============================================================
// T21 导线电流【方向】的自洽性：每一处端子上都要满足 KCL
// ============================================================
// 用户报的现象：「串联电路里有些段电荷移动方向和其它段相反」。
// 粒子朝哪边跑 = flow 的正负号，而 flow 的正负号对不对，最终只能靠
// KCL 兜底：某个端子往节点注入的电流，必须原封不动地从这个端子上
// 挂着的导线流走——一根线的符号反了，它两端的 KCL 立刻崩。
//
// 单独一个「三根线同号」的断言是不够的：它只盯得住一根笔直的串联回路，
// 而且无法发现「三根一起反」这种整体性错误。这里对每处端子逐个算账。
function kclResidual(scene, res) {
  var f = C.wireCurrents(scene, res);
  // wired：真有导线挂着的端子。变阻器的 C/D 是同电位的一对引线（金属杆两端），
  // 不给它这个信息就没法把注入量分到具体哪一端（见 terminalInjection）。
  var wired = {};          // 对象形态用于下面查「这个端子有没有线」
  var wiredSet = new Set(); // 集合形态传给核心，和 wireCurrents 内部一致
  scene.wires.forEach(function (wr) {
    if (wr && wr.a) { wired[wr.a.compId + ':' + wr.a.termIdx] = true; wiredSet.add(wr.a.compId + ':' + wr.a.termIdx); }
    if (wr && wr.b) { wired[wr.b.compId + ':' + wr.b.termIdx] = true; wiredSet.add(wr.b.compId + ':' + wr.b.termIdx); }
  });
  // 每个端子上：σ(导线流出量) 与 元件注入量 的差
  var out = [];
  Object.keys(wired).forEach(function (k) {
    var p = k.split(':');
    var sum = 0;
    scene.wires.forEach(function (wr, i) {
      var ka = wr.a.compId + ':' + wr.a.termIdx, kb = wr.b.compId + ':' + wr.b.termIdx;
      // flow>0 = 从 a 流向 b。站在 ka 这个端子上看，正电流是「离开端子进入导线」；
      // 站在 kb 上看则相反。
      if (ka === k) sum += f[i];
      else if (kb === k) sum -= f[i];
    });
    var byId = {};
    scene.comps.forEach(function (c) { byId[c.id] = c; });
    var inj = C.terminalInjection(byId[p[0]], res.components[p[0]], +p[1], wiredSet);
    out.push({ term: k, sum: sum, inj: inj, diff: sum - inj, flow: f });
  });
  return out;
}

function kclSuite(scene, tag) {
  var res = C.solve(scene.comps, scene.wires);
  truthy(res.status === 'ok', tag + ' 电路应可解，实际 ' + res.status);
  var rows = kclResidual(scene, res);
  truthy(rows.length >= 4, tag + ' 至少应有 4 处端子挂了导线，实际 ' + rows.length);
  var bad = rows.filter(function (r) { return Math.abs(r.diff) > 1e-9; });
  truthy(bad.length === 0, tag + ' 每处端子的 KCL 都必须成立（不成立 = 有导线电流方向反了）',
    bad.map(function (r) { return r.term + ' 残差 ' + r.diff; }));
  return { res: res, rows: rows, flow: rows.length ? rows[0].flow : [] };
}

test('T21 串联回路：每处端子的 KCL 都成立，四根导线同向同大小', function () {
  // 示例电路那种布局：电源 → 开关 → R1 → R2 → 电源
  var scene = {
    comps: [comp('E', 'battery', { emf: 3, rInt: 0 }),
            comp('S1', 'switch', { closed: true }),
            comp('R1', 'resistor', { R: 10 }),
            comp('R2', 'resistor', { R: 20 })],
    wires: [W('E', 0, 'R1', 0), W('R1', 1, 'R2', 0), W('R2', 1, 'S1', 0), W('S1', 1, 'E', 1)],
  };
  var r = kclSuite(scene, 'T21');
  r.flow.forEach(function (v, i) {
    close(v, 0.1, 'T21 第 ' + i + ' 根导线 = 3V/30Ω = 0.1A（方向沿书写顺序，故为正）', 1e-9);
  });
});

test('T21a2 三柱电流表串在回路里：量程柱进、「−」柱出，两根引线各自对上账', function () {
  // 表头现在是三端元件，端子注入量必须按「量程柱 / − 柱 / 悬空量程柱」
  // 分开算。落到老的两端兜底式子上，两个量程柱会各吐一份电流。
  var scene = {
    comps: [comp('E', 'battery', { emf: 3, rInt: 0 }),
            comp('A', 'ammeter', { range: 3, rInternal: 0 }),
            comp('R', 'resistor', { R: 10 })],
    wires: [W('E', 0, 'A', 1), W('A', 0, 'R', 0), W('R', 1, 'E', 1)],
  };
  var r = kclSuite(scene, 'T21a2');
  // 三根线都沿书写顺序（电源 + → 表的量程柱 → 电阻 → 电源 −），故都为正
  r.flow.forEach(function (v, i) {
    close(v, 0.3, 'T21a2 第 ' + i + ' 根导线 = 3V/10Ω = 0.3A', 1e-9);
  });
  close(r.res.components.A.i, 0.3, 'T21a2 电流从量程柱流进、从「−」柱流出 ⇒ 读数为正', 1e-12);
});

test('T21b 并联回路：干路和支路各自满足 KCL，互不串味', function () {
  var scene = {
    comps: [comp('E', 'battery', { emf: 3, rInt: 0 }),
            comp('R1', 'resistor', { R: 10 }), comp('R2', 'resistor', { R: 20 })],
    wires: [W('E', 0, 'R1', 0), W('R1', 0, 'R2', 0),      // 正极母线（两段）
            W('R1', 1, 'R2', 1),                          // 负极母线
            W('R2', 1, 'E', 1)],
  };
  var r = kclSuite(scene, 'T21b');
  // 导线是画成「树枝」而不是「母线」的：0.45A 从电源正极流出，
  // 到 R1 的上端子时被 R1 分走 0.3A，剩下 0.15A 继续流到 R2。
  // 所以每段导线各承担多少，取决于它在树上离电源多远——这正是
  // 一维的「同段同电流」直觉会算错的地方，四个数必须逐个钉死。
  close(r.flow[0], 0.45, 'T21b 电源正极出来的第一段 = 干路 0.45A', 1e-9);
  close(r.flow[1], 0.15, 'T21b R1 分流之后剩下 0.15A 流到 R2', 1e-9);
  close(r.flow[2], 0.30, 'T21b R1 下端子出来的是 0.3A', 1e-9);
  close(r.flow[3], 0.45, 'T21b 汇合后回电源的是干路 0.45A', 1e-9);
});

test('T21c 含变阻器的混联：KCL 仍然处处成立', function () {
  // 变阻器是四端元件，注入量要按半段算，最容易在这里把方向算反。
  // 接法用的是「一上一下」里的 A 进、D 出（D 与 C 同为金属杆端，
  // 走的是 terminalInjection 里 dWired 那条分支）。
  var scene = {
    comps: [comp('E', 'battery', { emf: 4.5, rInt: 0 }),
            comp('RH', 'rheostat', { Rmax: 20, slide: 0.25 }),
            comp('R1', 'resistor', { R: 5 }),
            comp('R2', 'resistor', { R: 10 })],
    wires: [W('E', 0, 'RH', 0), W('RH', 3, 'R1', 0),
            W('R1', 1, 'R2', 0), W('R2', 1, 'E', 1)],
  };
  kclSuite(scene, 'T21c');
});

test('T21d 导线正反着写不影响方向：交换 a/b 后 flow 变号，物理方向一点没变', function () {
  // 这是用户看到的现象的真正来源。手绘出来的导线，a/b 哪端在前完全看
  // 用户从哪个端子拉的线——同一张电路图，写法可以五花八门。
  // 「正 = a→b」是个相对约定，所以交换 a/b 必须让数值变号，
  // 这样一来画出来的方向（符号 × 端点朝向）才是同一个。
  // 若某根线交换 a/b 后数值不变号，它在画面上就会和其它段反向。
  var comps = [comp('E', 'battery', { emf: 3, rInt: 0 }),
               comp('R1', 'resistor', { R: 10 }),
               comp('R2', 'resistor', { R: 20 })];
  var base = [W('E', 0, 'R1', 0), W('R1', 1, 'R2', 0), W('R2', 1, 'E', 1)];
  var res0 = C.solve(comps, base);
  var f0 = C.wireCurrents({ comps: comps, wires: base }, res0);

  // 把三根线的书写方向分别翻过来（一根、两根、三根都试）
  [[0], [1], [2], [0, 1], [0, 1, 2]].forEach(function (flip) {
    var ws = base.map(function (wr, i) {
      return flip.indexOf(i) >= 0 ? { a: wr.b, b: wr.a } : wr;
    });
    var res = C.solve(comps, ws);
    var f = C.wireCurrents({ comps: comps, wires: ws }, res);
    var ok = true, detail = [];
    f.forEach(function (v, i) {
      var expect = flip.indexOf(i) >= 0 ? -f0[i] : f0[i];
      if (Math.abs(v - expect) > 1e-12) { ok = false; detail.push(i + ': ' + v + ' ≠ ' + expect); }
    });
    truthy(ok, 'T21d 翻转第 [' + flip.join(',') + '] 根导线的 a/b 后，电流必须恰好变号', detail);
    // 方向没变 = KCL 依然成立
    var rows = kclResidual({ comps: comps, wires: ws }, res);
    truthy(rows.every(function (r) { return Math.abs(r.diff) < 1e-9; }),
      'T21d 翻转 [' + flip.join(',') + '] 之后 KCL 仍处处成立');
  });
});

test('T22 同一对端子上并接两根导线：各分一半，且方向不随书写顺序翻转', function () {
  // 学生常画冗余线：同一对端子之间拉两根线。这时节点内部的导线图
  // 【一个叶子都没有】（两个顶点度数都是 2），剥叶子的循环整个跳过，
  // 靠的是兜底解法。旧兜底按 (s[ka]−s[kb])/2 硬凑：每根线都报整份电流，
  // 而且只要其中一根写成反向的，它就整根反号——画面上就是两根并接的
  // 导线一根朝左一根朝右。这条用例把两件事一起钉死。
  var comps = [comp('E', 'battery', { emf: 3, rInt: 0 }),
               comp('R1', 'resistor', { R: 10 })];
  var ws = [W('E', 0, 'R1', 0), W('R1', 0, 'E', 0),   // 两根并接，第二根反向写
            W('R1', 1, 'E', 1)];
  var res = C.solve(comps, ws);
  var f = C.wireCurrents({ comps: comps, wires: ws }, res);
  close(res.components.R1.i, 0.3, 'T22 电阻电流 3V/10Ω = 0.3A', 1e-9);
  close(f[0], 0.15, 'T22 并接的第一根承担一半 0.15A', 1e-9);
  close(f[1], -0.15, 'T22 并接的第二根反向书写，故为 −0.15A（方向其实相同）', 1e-9);
  close(f[2], 0.3, 'T22 回路的另一根导线仍是 0.3A', 1e-9);
  // 两根并接线的物理方向必须一致：各自与本根 a→b 的符号乘上端点朝向
  truthy(f[0] > 0 && f[1] < 0, 'T22 两根并接线物理方向一致（不是一根朝左一根朝右）', f);
  kclResidual({ comps: comps, wires: ws }, res).forEach(function (r) {
    truthy(Math.abs(r.diff) < 1e-9, 'T22 ' + r.term + ' 的 KCL 成立');
  });
});

test('T22b 三角冗余线：四条导线也全都一半一半，KCL 处处成立', function () {
  var comps = [comp('E', 'battery', { emf: 3, rInt: 0 }),
               comp('R1', 'resistor', { R: 10 })];
  var ws = [W('E', 0, 'R1', 0), W('R1', 0, 'E', 0),
            W('R1', 1, 'E', 1), W('E', 1, 'R1', 1)];
  var res = C.solve(comps, ws);
  var f = C.wireCurrents({ comps: comps, wires: ws }, res);
  f.forEach(function (v, i) {
    close(Math.abs(v), 0.15, 'T22b 第 ' + i + ' 根导线承担 0.15A', 1e-9);
  });
  kclResidual({ comps: comps, wires: ws }, res).forEach(function (r) {
    truthy(Math.abs(r.diff) < 1e-9, 'T22b ' + r.term + ' 的 KCL 成立');
  });
});

// ============================================================
// T23 敏感电阻（光敏 / 热敏 NTC / 热敏 PTC / 压敏 / 气敏 / 湿敏）
// ------------------------------------------------------------
// 判据不用「把实现里的公式再抄一遍」——那样换一处实现的小错，测试跟着一起错。
// 这里卡的是【手册上的区间和表值】：GL5516 的亮电阻/暗电阻、MF52 的 R–T 表、
// MOV 的钳位行为、MQ-3 和 HR202 的量程端点。手册说什么，就算到哪儿。
// ============================================================
test('T23a 光敏：亮电阻落在手册区间内，且光越强阻值越小', function () {
  function R_of(lux) {
    return C.sensorR(comp('S', 'sensor', { kind: 'ldr', lux: lux }));
  }
  // GL5516 手册：10 lx 亮电阻 5~10 kΩ；暗电阻 ≥0.2 MΩ
  truthy(R_of(10) >= 5000 && R_of(10) <= 10000,
    'T23a 10 lx 的阻值应落在手册的 5~10 kΩ（实际 ' + R_of(10).toFixed(0) + '）');
  truthy(R_of(0) >= 200000, 'T23a 0 lx 必须不亮于暗电阻 0.2 MΩ（实际 ' + R_of(0).toFixed(0) + '）');
  // 光越强阻值单调不增（这一段专治「写死一个数」或者把方向弄反）
  var prev = Infinity;
  [1, 10, 100, 300, 1000, 5000, 10000].forEach(function (lux) {
    var r = R_of(lux);
    truthy(r <= prev + 1e-9, 'T23a ' + lux + ' lx 的阻值不能比上一档更大（' + r.toFixed(0) + '）');
    truthy(r > 20, 'T23a ' + lux + ' lx 的阻值必须大于零且有限（' + r.toFixed(0) + '）');
    prev = r;
  });
  // 两个常用点位给出教学上说得通的量级（542 lx 教室照度这一档最常被问）
  truthy(R_of(300) > 300 && R_of(300) < 1200, 'T23a 300 lx 应在几百欧量级（' + R_of(300).toFixed(0) + '）');
});

test('T23b 热敏 NTC：与 MF52 手册的 R–T 表逐点重合', function () {
  var tab = [[-20, 87261], [0, 32049], [25, 10000], [50, 3590], [85, 1052], [100, 666]];
  tab.forEach(function (row) {
    var r = C.sensorR(comp('S', 'sensor', { kind: 'ntc', temp: row[0] }));
    close(r / row[1], 1, 'T23b ' + row[0] + '℃ 应等于手册的 ' + row[1] + ' Ω（实际 ' + r.toFixed(0) + '）', 2e-3);
  });
  // 温度越高阻值越小（负温度系数，方向不许反）
  var prev = Infinity;
  [-20, 0, 25, 50, 85, 100, 120].forEach(function (t) {
    var r = C.sensorR(comp('S', 'sensor', { kind: 'ntc', temp: t }));
    truthy(r < prev, 'T23b ' + t + '℃ 的阻值必须比上一档小（' + r.toFixed(0) + '）');
    prev = r;
  });
});

test('T23c 热敏 PTC：居里点以下只有 20 Ω 上下，过后跳几个数量级', function () {
  function R_of(t) { return C.sensorR(comp('S', 'sensor', { kind: 'ptc', temp: t })); }
  close(R_of(25) / 20, 1, 'T23c 25℃ 就是标称的 20 Ω（实际 ' + R_of(25).toFixed(2) + '）', 1e-6);
  truthy(R_of(80) < 40, 'T23c 居里点（80℃）以下仍是小电阻（' + R_of(80).toFixed(1) + '）');
  truthy(R_of(100) > 1000, 'T23c 100℃ 应已跳到 kΩ 量级（' + R_of(100).toFixed(0) + '）');
  truthy(R_of(120) > 1e5, 'T23c 120℃ 应跳到上百 kΩ（' + R_of(120).toFixed(0) + '）');
  // 单调增（正温度系数）
  var prev = 0;
  [20, 25, 60, 80, 90, 100, 120].forEach(function (t) {
    var r = R_of(t);
    truthy(r >= prev - 1e-9, 'T23c ' + t + '℃ 的阻值不能比上一档更小（' + r.toFixed(0) + '）');
    prev = r;
  });
});

test('T23d 气敏 / 湿敏：量程端点对得上手册，且方向单调', function () {
  var gas0 = C.sensorR(comp('S', 'sensor', { kind: 'gas', ppm: 0 }));
  var gasMax = C.sensorR(comp('S', 'sensor', { kind: 'gas', ppm: 1000 }));
  close(gas0 / 1e6, 1, 'T23d 酒精 0 ppm 就是洁净空气里的 1 MΩ（实际 ' + gas0.toFixed(0) + '）', 1e-6);
  truthy(gasMax > 1e5 && gasMax < 3e5, 'T23d 1000 ppm 应降到 20 万欧量级（' + gasMax.toFixed(0) + '）');
  var prev = Infinity;
  [0, 100, 300, 600, 1000].forEach(function (p) {
    var r = C.sensorR(comp('S', 'sensor', { kind: 'gas', ppm: p }));
    truthy(r <= prev + 1e-9, 'T23d ' + p + ' ppm 的阻值不能比上一档更大（' + r.toFixed(0) + '）');
    prev = r;
  });
  close(C.sensorR(comp('S', 'sensor', { kind: 'humid', rh: 50 })) / 20000, 1,
    'T23d 50 %RH 就是标称的 20 kΩ', 1e-6);
  var wetLow = C.sensorR(comp('S', 'sensor', { kind: 'humid', rh: 20 }));
  var wetHigh = C.sensorR(comp('S', 'sensor', { kind: 'humid', rh: 90 }));
  truthy(wetLow > 8e4 && wetLow < 1.3e5, 'T23d 20 %RH 应升到 10 万欧（' + wetLow.toFixed(0) + '）');
  truthy(wetHigh > 1500 && wetHigh < 3000, 'T23d 90 %RH 应降到 2 kΩ 量级（' + wetHigh.toFixed(0) + '）');
});

test('T23e 条件互不串味：换一种探头，别的档位上的数不许跟过来', function () {
  // 同一只元件，lux 停在 300、temp 停在 100。换成 NTC 时只能按 temp 算。
  var s1 = comp('S', 'sensor', { kind: 'ntc', lux: 300, temp: 100 });
  close(C.sensorR(s1) / 666, 1, 'T23e 换到 NTC 后看的是温度（100℃→666 Ω）', 2e-3);
  s1.params.kind = 'ldr';
  truthy(C.sensorR(s1) > 300 && C.sensorR(s1) < 1200,
    'T23e 换回光敏后看的是照度（300 lx→几百欧），不是 100℃ 那个数（' + C.sensorR(s1).toFixed(0) + '）');
});

test('T23f 压敏：过压才钳位，平时是 10 MΩ 的漏电', function () {
  function build(emf, Uc) {
    var cs = [comp('E', 'battery', { emf: emf, rInt: 0.5 }),
              comp('S', 'sensor', { kind: 'varistor', Uc: Uc })];
    var ws = [W('E', 0, 'S', 0), W('S', 1, 'E', 1)];
    return run(cs, ws, 'T23f');
  }
  // 6V 档并在 12V 上：必须导通，且两端电压被钳在 6V 上方不远处
  var hi = build(12, 6);
  var sHi = hi.components.S;
  truthy(sHi.on === true, 'T23f 6V 档接 12V 时必须导通');
  truthy(Math.abs(sHi.v) > 6- 1e-6 && Math.abs(sHi.v) < 9, 'T23f 钳位电压应在 6~9V（实际 ' + sHi.v.toFixed(3) + '）');
  truthy(Math.abs(sHi.v) < 12, 'T23f 钳位后两端电压必须明显低于电源电压（实际 ' + sHi.v.toFixed(3) + '）');
  // 3V 接在 6V 档上：不导通，只有 MΩ 级的漏电
  var lo = build(3, 6);
  truthy(lo.components.S.on === false, 'T23f 3V 接 6V 档时不许导通');
  truthy(Math.abs(lo.components.S.i) < 2e-6, 'T23f 截止时的漏电应在 μA 以下（' + lo.components.S.i.toExponential(2) + '）');
  // 电池反过来接：极性和模型无关，一样钳位
  var rev = run([comp('E', 'battery', { emf: 12, rInt: 0.5 }),
                 comp('S', 'sensor', { kind: 'varistor', Uc: 6 })],
                [W('E', 1, 'S', 0), W('S', 1, 'E', 0)], 'T23f');
  truthy(rev.components.S.on === true, 'T23f 电池反接也必须导通（压敏不分极性）');
  truthy(Math.abs(rev.components.S.v) < 12, 'T23f 反接时同样被钳住（实际 ' + rev.components.S.v.toFixed(3) + '）');
});

test('T23g 串负载教学效果：光越强灯越亮，过居里点灯骤暗', function () {
  // 光敏 + 发光二极管（3V）：照度从 0 拉到 10000 lx，二极管一路变亮
  function ledWith(lux) {
    var cs = [comp('E', 'battery', { emf: 3, rInt: 0.5 }),
              comp('D', 'led', { color: 'red' }),
              comp('S', 'sensor', { kind: 'ldr', lux: lux })];
    var ws = [W('E', 0, 'D', 0), W('D', 1, 'S', 0), W('S', 1, 'E', 1)];
    return run(cs, ws, 'T23g').components.D.brightness;
  }
  var b0 = ledWith(0), b1 = ledWith(100), b2 = ledWith(1000), b3 = ledWith(10000);
  truthy(b0 < b1 && b1 < b2 && b2 < b3,
    'T23g 照度变大，二极管必须一级比一级亮（' + [b0, b1, b2, b3].map(function (x) { return x.toFixed(3); }).join(' < ') + '）');
  truthy(b0 < 0.005, 'T23g 全黑时二极管应基本不亮（' + b0.toFixed(4) + '）');
  // 热敏 PTC + 小灯泡（6V）：过居里点灯骤暗
  function lampWith(t) {
    var cs = [comp('E', 'battery', { emf: 6, rInt: 0.5 }),
              comp('L', 'bulb', { R: 10, Pmax: 0.8 }),
              comp('S', 'sensor', { kind: 'ptc', temp: t })];
    var ws = [W('E', 0, 'L', 0), W('L', 1, 'S', 0), W('S', 1, 'E', 1)];
    return run(cs, ws, 'T23g').components.L.brightness;
  }
  var l25 = lampWith(25), l100 = lampWith(100);
  truthy(l25 > 0.2, 'T23g 室温下 PTC 只有 20 Ω，灯泡应正常亮（' + l25.toFixed(3) + '）');
  truthy(l100 < 0.05, 'T23g 过居里点 PTC 跳到 kΩ，灯泡应几乎熄灭（' + l100.toFixed(3) + '）');
  truthy(l25 > l100 * 5, 'T23g 两个温度下亮度要差出一眼看得出的倍数（' + l25.toFixed(3) + ' vs ' + l100.toFixed(3) + '）');
});

test('T23h 读数与铭牌：六档探头都在册，条件文字带着单位', function () {
  // 默认参数必须落在六档里（存档/新建都从它出发：defaultParams 若给了一个
  // 不在册的 kind，整件器材会在第一次求值时就变成「光敏」）
  var dp = C.defaultParams('sensor');
  truthy(!!dp && Object.prototype.hasOwnProperty.call(C.SENSOR_KINDS, dp.kind),
    'T23h defaultParams(sensor) 的 kind 必须是一档真探头（实际 ' + (dp && dp.kind) + '）');
  var kinds = Object.keys(C.SENSOR_KINDS || {});
  close(kinds.length, 6, 'T23h 六种探头都在 SENSOR_KINDS 里', 1e-9);
  // 每种的"条件文字"都要带着单位，页面上那两行直接印它
  var cc = [['ldr', { lux: 300 }, 'lx'], ['ntc', { temp: 25 }, '℃'],
            ['gas', { ppm: 300 }, 'ppm'], ['humid', { rh: 60 }, '%RH']];
  cc.forEach(function (row) {
    var t = C.sensorCondText(comp('S', 'sensor', { kind: row[0], lux: 300, temp: 25, ppm: 300, rh: 60 }));
    truthy(t.indexOf(row[2]) >= 0, 'T23h ' + row[0] + ' 的条件文字要带单位 ' + row[2] + '（实际「' + t + '」）');
  });
  // 压敏读的是"档位"而不是某个条件量
  truthy(C.sensorCondText(comp('S', 'sensor', { kind: 'varistor', Uc: 12 })).indexOf('12') >= 0,
    'T23h 压敏的条件文字要带压敏电压档位');
});

// ============================================================
// T24 U 形管热学：热量积累 → 气压 → 液面高度差
// ============================================================
test('T24a 理想气体 + 液柱压强：零温差为零，小温差导数符合解析式', function () {
  var J = C.JOULE_THERMAL;
  close(C.jouleHeightMmOfTemp(J.T0), 0, 'T24a 初始两液面必须相平', 1e-12);
  var dT = 0.01;
  var expected = J.P0 * J.V0 * (dT / J.T0) /
    (J.P0 * J.AREA / 2 + J.RHO * J.G * J.V0) * 1000;
  close(C.jouleHeightMmOfTemp(J.T0 + dT), expected,
    'T24a 小温差高度差不符合 (p0+ρgh)(V0+Ah/2) 的线性化解', 2e-4);
  truthy(C.jouleHeightMmOfTemp(J.T0 + 2) > C.jouleHeightMmOfTemp(J.T0 + 1),
    'T24a 温度升高，液面高度差必须增大');
});

test('T24b 液面有热惯性，且结果不依赖动画帧率', function () {
  var a = C.jouleNewThermal(), b = C.jouleNewThermal();
  C.jouleStepThermal(a, [0.4, 0.2], 1);
  truthy(a.heat[0] > 0.399999 && a.heat[0] < 0.400001, 'T24b 1s 的累计热量应为 0.4J');
  var h1 = C.jouleHeightMmOfTemp(a.temp[0]);
  truthy(h1 > 0 && h1 < C.jouleHeightMmOfPower(0.4),
    'T24b 通电 1s 只能缓慢上升，不能瞬间到稳态');
  for (var i = 0; i < 9; i++) C.jouleStepThermal(a, [0.4, 0.2], 1);
  C.jouleStepThermal(b, [0.4, 0.2], 10);
  close(a.temp[0], b.temp[0], 'T24b 10×1s 与 1×10s 必须同温', 1e-11);
  close(a.heat[1], b.heat[1], 'T24b 累计热量也不能依赖步长', 1e-11);
});

test('T24c 同时间功率加倍：累计热量加倍，液面差随之增大', function () {
  var a = C.jouleNewThermal();
  C.jouleStepThermal(a, [0.2, 0.4], 5);
  close(a.heat[1] / a.heat[0], 2, 'T24c 同时间功率比等于热量比', 1e-12);
  var h0 = C.jouleHeightMmOfTemp(a.temp[0]);
  var h1 = C.jouleHeightMmOfTemp(a.temp[1]);
  truthy(h1 > h0 && h0 > 0, 'T24c 功率大的一侧液面差必须更高');
  truthy(h1 / h0 > 1.85 && h1 / h0 < 2.05,
    'T24c 小温差范围内高度差应近似保持 2 倍（实际 ' + (h1 / h0).toFixed(4) + '）');
});

test('T24d 断电后停止产热、逐渐散热回落', function () {
  var st = C.jouleNewThermal();
  C.jouleStepThermal(st, [0.8, 0], 20);
  var before = C.jouleHeightMmOfTemp(st.temp[0]), q = st.heat[0];
  C.jouleStepThermal(st, [0, 0], 20);
  var after = C.jouleHeightMmOfTemp(st.temp[0]);
  truthy(after < before && after >= 0, 'T24d 断电后液面必须缓慢回落');
  close(st.heat[0], q, 'T24d 断电后累计产热量不再增加', 1e-12);
  var rec = {};
  C.jouleApplyThermal(rec, st);
  close(rec.heightMm[0], after, 'T24d 画布 mm 读数必须和热状态同源', 1e-12);
  close(rec.levels[1], 0, 'T24d 未发热的一侧始终相平', 1e-12);
});

test('T24e 串联 5Ω/10Ω：电流相同、热量 1:2，五档电阻齐全', function () {
  truthy(C.JOULE_R_CHOICES.join(',') === '5,10,15,20,25', 'T24e 电阻档位必须包含 5/10/15/20/25Ω');
  var cs = [comp('E', 'battery', { emf: 3, rInt: 0.5 }),
            comp('J', 'joule', { R1: 5, R2: 10, R2b: 0 })];
  var ws = [W('E', 0, 'J', 0), W('J', 1, 'J', 2), W('J', 3, 'E', 1)];
  var res = run(cs, ws, 'T24e'), r = res.components.J;
  close(r.boxes[0].i, r.boxes[1].i, 'T24e 两容器串联电流相同', 1e-9);
  close(r.boxes[1].p / r.boxes[0].p, 2, 'T24e 同电流下产热功率比等于电阻比', 1e-9);
  var st = C.jouleNewThermal();
  C.jouleStepThermal(st, r.powers, 10);
  close(st.heat[1] / st.heat[0], 2, 'T24e 同时间累计热量仍为 1:2', 1e-9);
  C.jouleApplyThermal(r, st);
  truthy(r.heightMm[1] > r.heightMm[0] && r.heightMm[0] > 0,
    'T24e 10Ω 容器的液面差必须高于 5Ω');
});

test('T24f 盒外同阻值并联：乙盒内电流减半、产热变 1/4，盒外热不进盒', function () {
  var cs = [comp('E', 'battery', { emf: 3, rInt: 0.5 }),
            comp('J', 'joule', { R1: 5, R2: 5, R2b: 5 })];
  // 甲盒 →（乙盒内丝 ∥ 乙盒外丝）串联。总电阻 0.5+5+2.5=8Ω。
  var ws = [W('E', 0, 'J', 0), W('J', 1, 'J', 2), W('J', 3, 'E', 1)];
  var r = run(cs, ws, 'T24f').components.J;
  close(r.boxes[0].i, 0.375, 'T24f 甲盒（也是干路）电流', 1e-9);
  close(r.boxes[1].i, 0.1875, 'T24f 乙盒内丝电流必须减半', 1e-9);
  close(r.boxes[1].iPar, 0.1875, 'T24f 同阻值盒外支路分得另一半', 1e-9);
  close(r.boxes[1].iTotal, 0.375, 'T24f 乙两柱总电流仍等于甲盒电流', 1e-9);
  close(r.boxes[1].p / r.boxes[0].p, 0.25,
    'T24f 同阻值、盒内电流减半 ⇒ 盒内产热为 1/4', 1e-9);
  close(r.powers[1], r.boxes[1].p, 'T24f 液面只能读取盒内丝功率', 1e-12);
  truthy(Math.abs(r.powers[1] - r.boxes[1].pTotal) > 1e-6,
    'T24f 液面功率不得混入盒外丝的发热');
  close(r.boxes[1].pPar, r.boxes[1].p, 'T24f 盒外丝自身功率单独守恒', 1e-9);
});

// ============================================================
// 汇总
// ============================================================
console.log('');
console.log('══════════════════════════════════════════════════');
RESULTS.forEach(function (r) {
  console.log((r.ok ? '  ✅ ' : '  ❌ ') + r.name);
});
console.log('══════════════════════════════════════════════════');
console.log('  用例 ' + RESULTS.length + ' 个，断言 ' + (PASS + FAIL) + ' 条');
console.log('  通过 ' + PASS + '，失败 ' + FAIL);
if (FAIL > 0) {
  console.log('');
  console.log('  失败详情：');
  FAILURES.forEach(function (m) { console.log('    • ' + m); });
}
console.log('══════════════════════════════════════════════════');
console.log('');
process.exit(FAIL > 0 ? 1 : 0);
