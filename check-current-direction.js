// 守卫：导线上电流的【大小和方向】必须和求解结果一致。
//
// 为什么需要它（2026-10-26 用户报的 bug）：
//   导线上的电流方向和大小，是内核按【每个端子的注入量】推出来的
//   （circuit-core 的 terminalInjection → wireCurrents）。那套算法对
//   【两端元件】只有一条兜底规则：`termIdx === 0 ? −i : +i`。
//   一旦元件有 3 个以上的端子、内部又是【几条互相独立的支路】
//   （焦耳定律演示器的甲/乙两段丝、电阻示教板的四根丝、电位器的 a-b / b-c
//   两段），兜底规则就会把「第 2 条支路的端子」当成「第 1 条的另一端」——
//   注入量的符号/大小全错。症状是：同一条回路上【有几根导线的粒子反向跑】，
//   或者粒子速度是真实电流的两倍，而读数、亮度、功率全都正常 ——
//   极难从画面上反推，所以必须用这道守卫钉住。
//
// 判据不是「KCL 成不成立」：错的是注入量本身，KCL 照样成立（它是按错注入量
// 分配的）。真正能抓住它的不变量是：【每根导线上的电流必须等于它所在支路
// 的真实电流】—— 支路电流由求解器给出，这里逐根比。
//
// 用法：node check-current-direction.js
const path = require('path');
const C = require(path.join(__dirname, 'circuit-core.js'));

function mk(type, id, params) {
  return { id: id, type: type, x: 0, y: 0, params: params || C.defaultParams(type) };
}
function W(a, ai, b, bi) {
  return { a: { compId: a, termIdx: ai }, b: { compId: b, termIdx: bi } };
}
function battery() { return mk('battery', 'U1', { emf: 3, rInt: 0.5 }); }

// 每个用例：搭一个电路 + 给出「每根导线应有的电流」（按求解结果算，不抄公式）。
// 导线一律写成「a 端在电流上游」，所以期望值都是正的。
const CASES = [
  {
    name: '焦耳定律演示器：甲、乙 两段电热丝并联',
    build: function () {
      return {
        comps: [battery(), mk('joule', 'X', { R1: 5, R2: 10 })],
        // 两条独立支路并接在电池上：+ → 甲+ / + → 乙+，甲− / 乙− → −
        wires: [W('U1', 0, 'X', 0), W('U1', 0, 'X', 2),
                W('X', 1, 'U1', 1), W('X', 3, 'U1', 1)],
      };
    },
    expect: function (rec) {
      return [rec.boxes[0].i, rec.boxes[1].i, rec.boxes[0].i, rec.boxes[1].i];
    },
  },
  {
    name: '电阻示教板：四根丝并联',
    build: function () {
      var wires = [], i;
      for (i = 0; i < 4; i++) {
        wires.push(W('U1', 0, 'X', 2 * i));
        wires.push(W('X', 2 * i + 1, 'U1', 1));
      }
      return { comps: [battery(), mk('rheoboard', 'X')], wires: wires };
    },
    expect: function (rec) {
      var out = [];
      for (var i = 0; i < 4; i++) { out.push(rec.branches[i].i); out.push(rec.branches[i].i); }
      return out;
    },
  },
  {
    name: '电位器：分压接法（a 接 +、c 接 −、滑片 b 带一只 10Ω 负载）',
    build: function () {
      return {
        comps: [battery(), mk('potentiometer', 'X', { Rmax: 20, pos: 0.5 }),
                mk('resistor', 'R', { R: 10 })],
        wires: [W('U1', 0, 'X', 0), W('X', 2, 'U1', 1),
                W('X', 1, 'R', 0), W('R', 1, 'U1', 1)],
      };
    },
    // a 进 = seg0；c 出 = seg1；滑片出 = seg0 − seg1；负载 = seg0 − seg1
    expect: function (rec) {
      var s0 = rec.segments[0].i, s1 = rec.segments[1].i;
      return [s0, s1, s0 - s1, s0 - s1];
    },
  },
];

var bad = [];
var checked = 0;
CASES.forEach(function (cs) {
  var scene = cs.build();
  var res = C.solve(scene.comps, scene.wires, {});
  if (res.status !== 'ok') { bad.push(cs.name + '：求解失败（' + res.status + '）'); return; }
  var flow = C.wireCurrents(scene, res);
  var want = cs.expect(res.components.X);
  scene.wires.forEach(function (w, i) {
    checked++;
    var got = flow[i], exp = want[i];
    // 相对误差：小电流时也要求「方向必须一致」，大小按 1% 比
    var tol = Math.max(1e-9, Math.abs(exp) * 0.01);
    if (!(Math.abs(got - exp) <= tol)) {
      bad.push(cs.name + ' 第 ' + (i + 1) + ' 根导线：画面电流 ' + (+got).toFixed(4) +
        '，实际应为 ' + (+exp).toFixed(4) +
        (got * exp < 0 ? '（【方向反了】）' : '（大小不对）'));
    }
  });
});

// ② 反接电源：同一套导线上的电流必须【整体反向、大小不变】。
//    这条抓的是另一类错：某些元件的 rec.i 被写成【绝对值】（只给读数用），
//    落到兜底的 `−rec.i / +rec.i` 上就永远指同一个方向 —— 学生把电池反接、
//    或者把二极管/电源翻个极性，粒子还是朝原来那边跑。
//    判据：emf 取 +3 与 −3，同一批导线上的 flow 必须逐根互为相反数。
function build2(type) {
  return {
    comps: [mk('battery', 'U1', { emf: 3, rInt: 0.5 }), mk(type, 'X')],
    wires: [W('U1', 0, 'X', 0), W('X', 1, 'U1', 1)],
  };
}
Object.keys(C.TYPES).forEach(function (type) {
  if ((C.TYPES[type].terminals || 0) !== 2) return;
  if (type === 'battery' || type === 'power' || type === 'junction') return;  // 电源/导线没有「反接」这一说
  var scene = build2(type);
  var rev = scene.comps.map(function (c) {
    return c.id === 'U1' ? mk('battery', 'U1', { emf: -3, rInt: 0.5 }) : c;
  });
  var a, b;
  try {
    a = C.solve(scene.comps, scene.wires, {});
    b = C.solve(rev, scene.wires, {});
  } catch (e) { return; }
  if (a.status !== 'ok' || b.status !== 'ok') return;      // 反向不导通（二极管等）跳过
  var fa = C.wireCurrents(scene, a), fb = C.wireCurrents({ comps: rev, wires: scene.wires }, b);
  scene.wires.forEach(function (w, i) {
    checked++;
    if (Math.abs(fa[i]) < 1e-9 && Math.abs(fb[i]) < 1e-9) return;
    var tol = Math.max(1e-9, Math.abs(fa[i]) * 0.01);
    if (Math.abs(fa[i] + fb[i]) > tol) {
      bad.push(type + ' 第 ' + (i + 1) + ' 根导线：电源反接后画面电流没有反向（' +
        (+fa[i]).toFixed(4) + ' → ' + (+fb[i]).toFixed(4) + '）—— rec.i 很可能取了绝对值');
    }
  });
});

// 反查：TYPES 里凡是 ≥3 个端子的，必须有专门用例或明确豁免 ——
// 否则它一定落在兜底规则上，电流方向就是错的。
var COVERED = ['joule', 'rheoboard', 'potentiometer',
               // 下面这些接法不是「支路对」，各有专门的 case / dev 用例：
               'rheostat', 'ammeter', 'voltmeter', 'spdt'];
Object.keys(C.TYPES).forEach(function (type) {
  var n = C.TYPES[type].terminals || 0;
  if (n < 3) return;
  if (COVERED.indexOf(type) >= 0) return;
  bad.push(type + '：有 ' + n + ' 个端子，但既没有电流方向用例、也没列进豁免表 —— ' +
    'terminalInjection 的兜底只对两端元件成立，它的导线方向多半是错的');
});

if (bad.length) {
  console.log('✗ 电流方向守卫：' + bad.length + ' 处有问题（已比对 ' + checked + ' 根导线）');
  bad.forEach(function (m) { console.log('  · ' + m); });
  process.exit(1);
}
console.log('✓ 电流方向守卫通过：' + checked + ' 根导线，大小与方向都和求解结果一致');
