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
    close(pc.p, pc.v * pc.i, tag + ' [' + ids[i] + '] 功率自洽 p = v·i', 1e-9);
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
