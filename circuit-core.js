/*!
 * circuit-core.js — 电路求解内核（改进节点法 MNA）
 *
 * 纯逻辑，零 DOM / Canvas 依赖。Node 与浏览器双模加载。
 *   Node:    const C = require('./circuit-core.js')
 *   浏览器:  <script src="circuit-core.js"></script>  → window.CircuitCore
 *
 * ── 符号约定（全内核唯一真值处，改动前先读这里）────────────────────
 *   支路电流 Ik 定义为「从端子 p 流入支路」的电流（即流入元件的第一个端子）。
 *   KCL（节点 p 的「流出电流之和 = 0」）：  A[p][k] += 1,  A[q][k] -= 1
 *   支路行：                              A[k][p] += 1,  A[k][q] -= 1
 *                                        A[k][k] -= Rs      ← 负号！
 *                                        z[k]     = V
 *   矩阵对称。Rs = 0 时自动退化为理想电压源。
 *
 *   推论：电池的「充电电流 = Ik」，放电电流 = −Ik（符号翻转只出现在回填处）。
 *         电流表正确接线时 Ik > 0，读数就是 Ik。
 *
 * ── 三条铁律（踩过的坑）──────────────────────────────────────
 *   1. 只有【导线】做并查集合并。电流表、闭合开关、电池都不合并 ——
 *      它们走电压源支路，靠支路行约束等电位。误合并会让电表变自环、
 *      电流恒为 0（惠斯通电桥用例专抓这个 bug）。
 *   2. 自环电压源【不能丢】，它携带内阻信息，正好是「电源被短路」的正确解。
 *   3. 支路行的内阻项是 A[k][k] -= Rs，负号。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CircuitCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var EPS = 1e-12;

  // ============================================================
  // 元件类型表
  // ============================================================
  var TYPES = {
    resistor: {
      label: '定值电阻', terminals: 2, termNames: ['a', 'b'],
      defaults: { R: 10 },
    },
    rheostat: {
      label: '滑动变阻器', terminals: 4, termNames: ['A', 'B', 'C', 'D'],
      // 编号照人教版教材图16.4-2 的实物位置来（这也是初中「一上一下」接法的
      // 参照系，学生是对着教材数接线柱的）：
      //   A(0)/B(1) = 【下面】两个柱，出厂就接在电阻丝两头
      //   C(2)/D(3) = 【上面】两个柱，接在金属杆两头（内部等效同一节点 = 滑片）
      // 接 A、B 两根线 = 整根电阻丝接入，滑片不起作用（R = Rmax）；
      // 接 C、D 两根线 = 只有金属杆，R = 0，等于一根导线。两条都是经典错接法，
      // 结论正好相反，所以编号反了等于把两个考点一起教反。
      defaults: { Rmax: 20, slide: 0.5 },
      internalShort: [2, 3],
    },
    bulb: {
      label: '小灯泡', terminals: 2, termNames: ['a', 'b'],
      // tempDependent：灯丝电阻随温度升高而增大（钨丝的正温度系数）。
      // true（默认）= 真灯泡，R 随自身功率变；false = 当定值电阻，R 恒为
      // 额定电阻 U额²/P额。课本上「不计温度影响」和「考虑温度影响」是
      // 两个阶段，这个开关就是那两步之间的门，别把默认改掉。
      defaults: { ratedV: 2.5, ratedW: 0.75, tempDependent: true },
    },
    // ── 发光二极管：单向导电性 ────────────────────────────────
    // 全站唯一一个「电流方向不对就不导通」的元件，也是初中讲单向导电性时
    // 唯一的实物载体。模型只取两态，不去解肖克利方程的指数段：
    //   正向导通：两端压降几乎恒为 Vf，多出来的电压全落在电路的其它部分上
    //             ⇒ 一条「电压源 Vf 串一个很小的体电阻 Rs」的支路；
    //   反向截止：几乎不导电（真实漏电是 nA 级，初中直接当断路）
    //             ⇒ 不产生任何支路。
    // 两态之间怎么切由 solve() 的迭代判（见 ledConducts）。千万别把它做成
    // 「正向一个小电阻、反向一个大电阻」——那样正向压降会随电流乱跑
    // （3V 电源下红管能算出 2.4V），而且「换一根蓝管子就不亮了」这个
    // 最有教学价值的现象会整个消失。
    led: {
      label: '发光二极管', terminals: 2, termNames: ['+', '-'],
      defaults: { color: 'red' },
    },
    // ── 直流电动机 ────────────────────────────────────────────
    // 真实的永磁小直流电机转动时线圈切割磁感线、产生反电动势 ε，
    // 于是 I = (U − ε)/R线圈 ——【转起来以后电流反而很小】；
    // 把转子卡住（堵转）时 ω = 0、ε = 0，电流就是 U/R线圈，能大好几倍，
    // 线圈发热 I²R 更是大十几倍 —— 现实中「电机卡住会烧」就是这个原因。
    // 所以它【不是】一个定值电阻，学生拿欧姆定律算不出它的电流；
    // 但它把「电能 → 机械能」算得明明白白：输入功率 U·I 分成机械功率 ε·I
    // 和线圈发热 I²R 两份（见回填里的 pMech / pHeat）。
    motor: {
      label: '电动机', terminals: 2, termNames: ['+', '-'],
      defaults: { Rcoil: 5, noLoadI: 0.05, rpmPerV: 800, stall: false },
    },
    // ── 电铃 ─────────────────────────────────────────────────
    // 电磁铁 + 衔铁 + 断续触点：通电吸下衔铁、锤击铃碗，同时把触点顶开、
    // 电流断掉、弹簧把衔铁拉回、触点重新闭合 —— 于是嗡嗡地响。
    // ⚠️ 它对电流方向【不敏感】：软铁衔铁不管是 N 极还是 S 极都被吸引，
    // 所以这里是纯电阻，不是二极管。别把单向导电性安到它头上 ——
    // 那会让学生以为「用电器都分正负」，比不教更坏。
    bell: {
      label: '电铃', terminals: 2, termNames: ['a', 'b'],
      defaults: { Rcoil: 20, turns: 800 },
    },
    battery: {
      label: '电源', terminals: 2, termNames: ['+', '-'],
      // 默认 = 【两节干电池串联的 3V 理想电源】：电动势 3V、内阻 0（初中
      // 「不计电源内阻」的标准模型）。
      // 键取 emf / rInt：参数面板上那两根滑块（电动势、内阻）用的就是它们，
      // 求解器也直接读（见 buildBranches 的 battery 分支）。cells / emfPerCell
      // / rPerCell 是老键，求解器与绘制仍然认，但默认不再写它们 —— 写成
      // 「2 节 × 1.5V」的话面板上会查不到 emf、两根滑块停在未定义值上。
      // 画面上的节数由 drawBattery 从电动势反推（emf / 1.5 = 2 节），
      // 所以「2 节 1.5V 的干电池」这个外观一点没变。
      defaults: { emf: 3, rInt: 0 },
    },
    switch: {
      label: '开关', terminals: 2, termNames: ['a', 'b'],
      defaults: { closed: false },
    },
    // ── 接线点（导线中间自动长出来的结点）─────────────────────
    // 学生从某个接线柱往一根导线的【中间】连线时，那根导线从落点断开成两截，
    // 落点上生出一个接线点，把三根线接到一起 —— 就是电路图上那个实心结点。
    //
    // 电气上它是一根理想导线：两个端子内部短接（internalShort），而且
    // 【不产生任何支路】—— 下面那个分支构建的 switch 里没有 junction 这个
    // case，所以它对基尔霍夫方程一个数都不贡献，正是「零电阻、零压降」。
    //
    // 为什么必须造一个实体、不能只把导线拆成两截了事：求解器认的是【端子】，
    // 两根导线只有在共用一个端子时才算同一个节点。拆开的两截谁也不接到第三根
    // 线上，三根线就只是「画在一起」，读数上毫无关系 —— 那才是真的骗人。
    junction: {
      label: '接线点', terminals: 2, termNames: ['a', 'b'],
      defaults: {},
      internalShort: [0, 1],
    },
    // 表头和人教版实物一样有【三个接线柱】：− 柱 + 两个量程柱。
    // 端子按实物从左到右编号，所以 0 号是「−」柱，量程柱跟着往右排。
    // 量程【由导线接在哪个量程柱上决定】，不是参数——面板上选的量程
    // 只是把导线挪到对应的柱子上（见 circuit-editor 的 plugRange）。
    // 这样画面和读数永远一致：不可能出现「线接在 0.6 柱上、表却按 3A 读」。
    ammeter: {
      label: '电流表', terminals: 3, termNames: ['-', '0.6', '3'],
      commonTerm: 0, rangeTaps: [1, 2], rangeValues: [0.6, 3],
      // zeroed = 【调零】状态。默认 false = 未调零：真实的表拿到手第一件事
      // 就是拧面板上那颗螺丝把指针拨到零刻度，没调零就读数是错的 —— 这是
      // 课本「实验前要检查仪器」那句话的落地点，所以默认必须是【没调】的，
      // 而不是替学生调好。调零只改指针的画法（见 drawMeter 的 ZERO_OFF），
      // 不改求解出来的读数：读数本身是电路的事，调零是仪器的事。
      defaults: { range: 0.6, rInternal: 0, zeroed: false },
    },
    voltmeter: {
      label: '电压表', terminals: 3, termNames: ['-', '3', '15'],
      commonTerm: 0, rangeTaps: [1, 2], rangeValues: [3, 15],
      // rInternal = null 表示理想电压表（完全开路、不分流，初中标准模型）
      defaults: { range: 3, rInternal: null, zeroed: false },
    },
  };

  // ── 发光二极管的颜色 → 正向压降 ──────────────────────────────
  // 真实的 LED 是按【颜色分规格】的，不是按电压卖：红光 1.8~2.0V、
  // 绿光 2.0~2.2V、蓝/白光 3.0~3.2V。这个差别在课堂上极有用：两节干电池
  // （3.0V）点得亮红管、绿管，点不亮蓝管 —— 学生换一根管子就不亮了，
  // 比讲十遍「额定电压」都直观。
  // 蓝管取 3.1V 而不是 3.0V：正好等于电源电动势时，导通判定会在临界上来回
  // 切，画面一闪一闪的 —— 那不是物理，是数值噪声。
  var LED_COLORS = {
    red:   { label: '红色', Vf: 1.8, rgb: [255,  62,  62] },
    green: { label: '绿色', Vf: 2.1, rgb: [ 58, 226, 122] },
    blue:  { label: '蓝色', Vf: 3.1, rgb: [ 92, 152, 255] },
  };
  // 二极管的体电阻（Ω）：真实管子零点几欧到几十欧，取 10 是「20mA 时多出
  // 0.2V 压降」的量级 —— 既不理想化到假，也不会让读数难算。
  var LED_RS = 10;
  var LED_I_RATED = 0.020;    // 指示用 LED 的典型工作电流 20 mA（亮度按它归一化）
  var LED_I_MAX = 0.025;      // 【过载提示】门槛：超过它就报 LED_OVER_CURRENT
  // 【烧毁】门槛，和上面那个过载门槛【必须分开】。合成一个的话，「过载提示」
  // 这条永远看不到 —— 同一帧里既报过载又烧掉，最终解里管子已经断路，警告跟着
  // 没了。而且 LED 从 20mA 的额定到真烧断本来就有个区间（真实管子能短时过载），
  // 取 3 倍 ≈ 75mA：24mA 的绿管 + 100Ω 那种正常接法活得下来，3V 直连红管
  // （120mA）当场烧断 —— 两端都够得着，中间的过载提示也看得见。
  var LED_BURN_I = 0.075;

  // ============================================================
  // 故障（损坏）模型
  // ------------------------------------------------------------
  // 真实实验里「接错线」和「接坏器材」是两件事：前者改接线就好，后者要换器材。
  // 这里把后者建模成元件上的一个【闩锁】字段 comp.fault（导线是 wire.broken）：
  // 一旦发生就一直保持，直到调用方显式清掉（界面上的「修复」按钮）。
  //
  // ⚠️ 判定与执行分开：本内核只负责「读 fault 改电路」+「给一个纯函数判据
  //    faultsOf()」，【什么时候真的写进场景】由宿主决定。这样判定可以单独
  //    测、也可以单独改坏做负向对照，不必拖上界面。
  // ============================================================
  var FAULT_LABEL = {
    burned:  '灯丝烧断',
    removed: '灯泡已取下',
    shorted: '灯座短路',
    burnt:   '烧坏',
    over:    '超量程损坏',
    rev:     '接反打表损坏',
  };  // 「这个故障让元件变成断路吗」——灯泡断丝、灯泡取下、烧毁的管子/电源都是断路；
  // 两只表【不是】：真实的表打表以后电路照样通，只是读数不能信了（指针顶在
  // 端点）。把它们也断掉的话，「反接指针左偏」这一幕就永远看不到了 ——
  // 而那正是用户点名要看的现象。
  // ⚠️ shorted（灯座短路）也【不在】这张表里，而且和「两只表」是两回事：
  //    表是「通着但读数不可信」，灯座短路是「灯被旁路掉了」——电流全从短接
  //    线走，灯丝里一点电流都没有（所以灯不亮），可外电路照常工作。它改的是
  //    这一件的等效电阻（见 describeComponent 的 bulb 分支），不是通断。
  var OPEN_FAULTS = { burned: 1, removed: 1, burnt: 1 };
  function isOpenFault(comp) {
    return !!(comp && comp.fault && OPEN_FAULTS[comp.fault]);
  }
  // 「这个故障叫什么」——给用户看的字。
  // ⚠️ 第二个参数（元件本身）不是可有可无的：小灯泡和发光二极管在内核里【共用】
  //    burned 这个故障码（电路上都是断路），但两者的名字必须分开 —— 二极管里
  //    根本没有灯丝。画布上那块牌子写的是「已烧毁」（见 drawLed），状态栏 /
  //    警告列表 / 浮层这三处也要跟着一致，否则同一件事在两处叫两个名字。
  function faultLabel(f, comp) {
    if (f === 'burned' && comp && comp.type === 'led') return '已烧毁';
    return FAULT_LABEL[f] || '损坏';
  }

  // ── 小灯泡烧断的门槛 ─────────────────────────────────────────
  // 用【实际功率 / 额定功率】的倍数，而不是电压倍数：灯泡的灯丝电阻随功率
  // 上升（见 lampRAt），所以「电压超一点」和「功率超一点」不是同一件事，
  // 而灯丝是被 I²R 烧断的，功率才是那个物理量。
  //
  // 1.5 这个数不是拍的，它把课本上最常见的那组搭配分在了两边：
  //   2.5V/0.75W 的灯泡（R热 8.33Ω）
  //     接两节干电池 3.0V（内阻 1Ω）→ I≈0.32A，P≈0.86W = 1.15 P额 → 不烧；
  //     接三节干电池 4.5V（内阻 1.5Ω）→ I≈0.46A，P≈1.75W = 2.33 P额 → 烧断。
  //   即「两节电池正常发光、再加一节就烧了」—— 正是学生真做过的那件事。
  var BULB_BURN_K = 1.5;

  // ── 灯座短路时的等效电阻 ───────────────────────────────────
  // 不是 0：0Ω 在这个内核里会被当成【理想短路线】（addR 里 `!(R > EPS)` 那
  // 一支），电源被理想短路线短接时矩阵直接奇异，界面报「接线矛盾，无法求解」。
  // 0.01Ω 在 3V 下是 300A 量级，肉眼与读数上和「真的短接」没有区别，却让
  // 求解矩阵保持非奇异 —— 学生看到的才是「灯不亮、别的元件照常工作」。
  var SHORT_R = 0.01;

  // ── 短路时电源能扛住的电流 ───────────────────────────────────
  // 短路电流 I = E/r（外电路被短接，只剩内阻）。所以「电源会不会烧」取决于
  // 内阻：内阻大 = 自己限流 = 只烧导线（导线就是那根保险丝）；内阻小 = 电流
  // 全砸在自己身上 = 电源炸。默认那台电源 3V/1Ω → 3A，够不着 5A，于是
  // 默认场景短路时【断的是导线】，电源保得住 —— 这正好是保险丝的原理，
  // 学生把内阻拧到 0.5Ω 以下才会看到电源烧坏。
  var BATT_MAX_I = 5;

  // ── 直流电动机的铭牌常数 ────────────────────────────────────
  //   rpmPerV  空载转速常数（每伏特每分钟多少转）：3V 下 2400 r/min，
  //            正是 130 型小电机的量级；
  //   noLoadI  空载电流（A）：空载时只需克服自身摩擦矩，电流很小，
  //            而且【基本不随电压变】—— 真实空载电机的电流就是几乎恒定的；
  //   I_RATIO  额定点电流 / 空载电流，用来给粘性摩擦定标（见 motorState）。
  // 这三个数只用来定标，不是面板参数；面板给的是线圈电阻、空载电流、
  // 转速常数 —— 学生调得到的都写在铭牌上，调不到的是电机型号。
  var MOTOR = { rpmPerV: 800, noLoadI: 0.05, I_RATIO: 2, URATED: 3, R_DEF: 5 };

  // ── 电铃的吸合磁动势下限（安匝 = 电流 × 匝数）──────────────
  // 低于它，电磁铁的吸力顶不动弹簧片，铃【不响】—— 这正是「电磁铁磁性强弱
  // 跟电流、匝数有关」那句话的直接后果：电压调低、线圈电阻调大、匝数调少，
  // 铃就不响了。所以这个数不是随手写的阈值，是那条规律的落地点。
  //
  // ⚠️ 这个数【必须落在旋钮够得着的地方】，否则「磁动势不足·不响」这一支
  //    学生一辈子碰不到，等于没做。默认那台（3V、线圈 20Ω、800 匝）是
  //    0.15A × 800 = 120 安匝，门槛取 60 → 2 倍余量，铃响得很干脆；
  //    而只要把【任一个】旋钮拧到弱端就能让它停：
  //      匝数 800 → 300（45 安匝）不响；
  //      线圈电阻 20Ω → 60Ω（0.05A×800 = 40 安匝）不响；
  //      或者串一个 100Ω 限流电阻（0.025A×800 = 20 安匝）也不响。
  //    曾经取 16，结果最低匝数 200 配 3V 还有 30 安匝，照样响 ——
  //    这一支就成了永远不执行的死代码（探针实测）。
  var BELL_MAG_MIN = 60;

  function ledColorOf(P) {
    var c = LED_COLORS[P && P.color];
    return c || LED_COLORS.red;
  }

  function defaultParams(type) {
    var t = TYPES[type];
    if (!t) throw new Error('未知元件类型: ' + type);
    return Object.assign({}, t.defaults);
  }

  function paramsOf(comp) {
    return Object.assign({}, defaultParams(comp.type), comp.params || {});
  }

  // ============================================================
  // 并查集（Map 版，key 为字符串；同时记录加入顺序以保证结果可复现）
  // ============================================================
  function createDSU() {
    var parent = new Map();
    var keys = [];
    function add(x) {
      if (!parent.has(x)) { parent.set(x, x); keys.push(x); }
    }
    function find(x) {
      add(x);
      var r = x;
      while (parent.get(r) !== r) r = parent.get(r);
      while (parent.get(x) !== r) { var nxt = parent.get(x); parent.set(x, r); x = nxt; }
      return r;
    }
    function union(a, b) {
      var ra = find(a), rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    }
    return { add: add, find: find, union: union, keys: keys };
  }

  // ============================================================
  // 第一遍：导线 union → 电气节点
  // ============================================================
  function buildNodes(components, wires) {
    var dsu = createDSU();
    var i, c, t;

    for (i = 0; i < components.length; i++) {
      c = components[i];
      var ti = TYPES[c.type];
      if (!ti) throw new Error('未知元件类型: ' + c.type);
      for (t = 0; t < ti.terminals; t++) dsu.add(c.id + ':' + t);
      if (ti.internalShort) {
        for (t = 1; t < ti.internalShort.length; t++) {
          dsu.union(c.id + ':' + ti.internalShort[0], c.id + ':' + ti.internalShort[t]);
        }
      }
    }
    for (i = 0; i < (wires || []).length; i++) {
      var w = wires[i];
      // 熔断的导线【不做合并】：它的两个端子回到各自的电气节点上，整条支路
      // 就此断开。只在绘制时画个断口是不够的 —— 那样画面上看着断了，
      // 求解器却还当成一根完好的导线，读数会继续骗人。
      if (w && w.broken) continue;
      if (!w || !w.a || !w.b) continue;
      // 悬空端（compId 为 null）：这一头没接在任何元件上，导线到这里就【断】了。
      // 删元件保留导线（见 circuit-editor 的 removeSelected）之后线头就长这样。
      // 不判这一下的话 union('null:0', …) 会凭空造出一个叫 "null:0" 的假节点，
      // 把所有悬空的线头连到一起 —— 剪断的导线会重新「接通」，读数继续骗人。
      // 只悬空一头的线同样整根不参与合并：它本来就没有第二个节点可连。
      if (!w.a.compId || !w.b.compId) continue;
      dsu.union(w.a.compId + ':' + w.a.termIdx, w.b.compId + ':' + w.b.termIdx);
    }

    var rootId = new Map();
    var termNode = {};
    var count = 0;
    for (i = 0; i < dsu.keys.length; i++) {
      var k = dsu.keys[i];
      var r = dsu.find(k);
      if (!rootId.has(r)) rootId.set(r, 'n' + (count++));
      termNode[k] = rootId.get(r);
    }
    return { termNode: termNode, nodeCount: count };
  }

  // ============================================================
  // 灯泡模型：R(P) = Rcold · (1 + K · P^0.25)
  // ------------------------------------------------------------
  // 热辐射为主（斯特藩-玻尔兹曼 P ∝ T⁴）⇒ T−T₀ ∝ P^0.25，
  // 配合 R = R₀(1+α(T−T₀)) 得到上述单参数模型。
  // K 由额定点标定，保证 R(P_rated) === R_hot（自洽）。
  // ============================================================
  // tempDependent = false 时上面这套作废，灯泡就是一个阻值不变的定值电阻，
  // 阻值取【额定电阻】R额 = U额²/P额 —— 正是课本上「不计温度对电阻的影响」
  // 时算出来的那个数（也是「测小灯泡电阻」实验里学生拿铭牌算出来的值）。
  // 两种模式的差别在小电压下最刺眼：灯丝冷透时 R 只有额定电阻的 1/8
  // （coldHotRatio），2.5V/0.75W 的灯泡是 1.04Ω 对 8.33Ω——差 8 倍，
  // 一眼看得出「灯丝电阻变了」。
  function lampParams(comp) {
    var P = paramsOf(comp);
    var Rhot = (P.ratedV * P.ratedV) / P.ratedW;
    var ratio = P.coldHotRatio != null ? P.coldHotRatio : 8;   // 实测钨丝冷/热比约 8~12
    var Rcold = P.Rcold != null ? P.Rcold : Rhot / ratio;
    var K = (Rhot / Rcold - 1) / Math.pow(P.ratedW, 0.25);
    var temp = P.tempDependent !== false;
    return { Rhot: Rhot, Rcold: Rcold, K: K, tempDependent: temp,
             Prated: P.ratedW, ratedV: P.ratedV };
  }
  // 迭代初值。定值模式直接拿额定电阻起步 —— 下一步 lampRAt() 还它同一个数，
  // 于是 maxDelta = 0，一轮就收敛，不会为一只定值电阻空转地反复解矩阵。
  function lampInitR(comp) {
    var pp = lampParams(comp);
    return pp.tempDependent ? pp.Rcold : pp.Rhot;
  }
  function lampRAt(pp, power) {
    if (!pp.tempDependent) return pp.Rhot;              // 不随功率（温度）变
    return pp.Rcold * (1 + pp.K * Math.pow(Math.max(power, 0), 0.25));
  }

  // ============================================================
  // 表头量程识别：量程由「导线接在哪个量程柱上」决定
  // ------------------------------------------------------------
  // 人教版电流表/电压表底部是三个接线柱：− 柱 + 两个量程柱。学生接哪个
  // 量程柱，量程就是哪一个；两个都接是接线错误（真表上两个分流器并起来
  // 读数没有意义），编辑器会当场拒绝，这里再兜一层。
  //   返回 { idx, conflict }：idx = 生效的量程端子号，null = 没接量程柱。
  //   wired：{"compId:termIdx"} 集合，由导线列表推出。
  // ============================================================
  function meterTap(comp, wired) {
    var T = TYPES[comp.type];
    if (!T || !T.rangeTaps) return { idx: null, conflict: false };
    var on = T.rangeTaps.filter(function (t) { return wired.has(comp.id + ':' + t); });
    if (on.length === 0) return { idx: null, conflict: false };
    if (on.length === 1) return { idx: on[0], conflict: false };
    // 两个都接：取小量程（rangeTaps 按从小到大排），并让调用方报警告
    return { idx: T.rangeTaps[0], conflict: true };
  }

  // 量程端子号 → 量程值。没接量程柱（tapIdx == null）返回 null，
  // 调用方拿它区分「真量程」和「只是拿来显示的参数值」。
  function rangeValueOf(type, tapIdx) {
    var T = TYPES[type];
    if (tapIdx == null || !T || !T.rangeValues) return null;
    var k = T.rangeTaps.indexOf(tapIdx);
    return k < 0 ? null : T.rangeValues[k];
  }

  // ============================================================
  // 第二遍：元件 → 支路
  // ------------------------------------------------------------
  // R / LAMP 自环（p===q）→ 丢弃（电流恒 0，与不存在等效）
  // V 自环【不丢】→ 携带内阻信息，正是「电源被短路」的解
  //   ⚠️ 例外：Rs≈0 且 V≈0 的自环是 0 = 0 的废话，由 assemble() 丢掉
  //      （见 degenerateIdealBranch），否则矩阵会因一行全零而判奇异。
  // ============================================================
  function describeComponent(comp, termNode, lampR, tap, st) {
    var out = [];
    var P = paramsOf(comp);
    // 断掉的元件【一条支路都不产生】—— 和「反向截止的二极管」走同一条路：
    // 元件还在台上、还接着线，但电路已经从这里断了。必须在这一层拦，不能
    // 只在绘制层画个断口：那样画面上看着断了、求解器却照旧算通，读数骗人。
    if (isOpenFault(comp)) return out;
    var N = function (i) { return termNode[comp.id + ':' + i]; };
    // 表头的公共端（「−」柱）。两端元件没有这一项，取 1 就退化成老行为。
    var NC = function () {
      var T = TYPES[comp.type];
      return (T && T.commonTerm != null) ? T.commonTerm : 1;
    };

    function addR(p, q, R) {
      if (p === q) return;                                 // 自环电阻：丢弃
      if (!(R > EPS)) {                                    // 0Ω → 理想短路线
        out.push({ kind: 'V', comp: comp, p: p, q: q, V: 0, Rs: 0 });
        return;
      }
      out.push({ kind: 'R', comp: comp, p: p, q: q, R: R });
    }

    switch (comp.type) {
      case 'resistor':
        addR(N(0), N(1), P.R);
        break;

      case 'bulb':
        // 灯座短路（演示故障之一）：灯座上并了一根铜丝，灯泡两端被直接短接。
        // 电流全从短接的那根线走，灯丝里一点电流都没有 ⇒ 灯不亮；而外电路
        // 【仍然是通的】（别的灯照亮、电流表照有读数）—— 这正是它和「拔下 /
        // 灯丝断了」最要紧的区别，那两个是把电路弄断，这个只是把灯废掉。
        // 等效成一个很小的电阻（而不是 0Ω 的理想短路线）：理想短路线会让
        // 求解矩阵在「电源被灯座短接」这种接法下直接奇异，学生看到的会是
        // 「接线矛盾，无法求解」，而不是「灯不亮、别的都正常」。
        if (comp.fault === 'shorted') {
          addR(N(0), N(1), SHORT_R);
          // 标一下「这条支路是短接线、不是灯丝」——填读数时要靠它绕开
          // fillLamp（否则按 p/P额 算出来的亮度会顶到最大，灯亮得像要炸）。
          if (out.length && out[out.length - 1].kind === 'R') {
            out[out.length - 1].shorted = true;
          }
          break;
        }
        var rl = lampR != null ? lampR : lampInitR(comp);
        if (N(0) !== N(1) && rl > EPS) {
          out.push({ kind: 'LAMP', comp: comp, p: N(0), q: N(1), R: rl });
        } else if (N(0) !== N(1)) {
          out.push({ kind: 'V', comp: comp, p: N(0), q: N(1), V: 0, Rs: 0 });
        }
        break;

      // 表头的支路端点由【实际接了线的量程柱】和「−」柱决定。
      // tap 为 null（没接量程柱）时表根本不在电路里，不产生任何支路——
      // 这样量程柱空着的表既不导通也不偷电流，和它没被接上是一致的。
      case 'voltmeter':
        if (tap != null && P.rInternal != null && isFinite(P.rInternal)) {
          addR(N(tap), N(NC()), P.rInternal);
        }
        break;                                             // 理想电压表：不产生支路

      case 'ammeter':
        if (tap != null) {
          out.push({ kind: 'V', comp: comp, p: N(tap), q: N(NC()), V: 0, Rs: P.rInternal || 0 });
        }
        break;

      case 'switch':
        if (P.closed) out.push({ kind: 'V', comp: comp, p: N(0), q: N(1), V: 0, Rs: 0 });
        break;                                             // 断开 → 无支路，自然消失

      // 发光二极管。导通时是「电压源 Vf 串体电阻」的一条支路；截止时
      // 【一条支路都不产生】= 断路 —— 这样反向时整条回路就断了，串在里面的
      // 灯泡也跟着不亮，正是「单向导电性」在实验里最该看到的那一幕。
      // p === q（被导线短路）时照样给支路：方程退化成 0 = Vf + Rs·I ⇒ I < 0，
      // 迭代下一步就判它截止，不用在这里特判。
      case 'led': {
        var lc = ledColorOf(P);
        if (st && st.ledOn && st.ledOn.get(comp.id)) {
          out.push({ kind: 'V', comp: comp, p: N(0), q: N(1),
                     V: lc.Vf, Rs: LED_RS, passive: true });
        }
        break;
      }

      // 直流电动机：反电动势 ε 串线圈电阻。ε 由 solve() 的迭代定（初值 0
      // = 刚通电、转子还没转起来的瞬间，那一刻的电流就是启动电流，最大）。
      case 'motor': {
        var Rc = num(P.Rcoil, MOTOR.R_DEF);
        if (Rc <= EPS) Rc = EPS;              // 线圈电阻为 0 就退化成理想电压源，不物理
        var eps = (st && st.motorEps && st.motorEps.get(comp.id)) || 0;
        out.push({ kind: 'V', comp: comp, p: N(0), q: N(1),
                   V: eps, Rs: Rc, passive: true });
        break;
      }

      // 电铃：线圈就是一个电阻。通电就响，与电流方向无关（见 TYPES.bell）。
      case 'bell':
        addR(N(0), N(1), num(P.Rcoil, 20));
        break;

      case 'battery':
        var cells = P.cells != null ? P.cells : 1;
        var emf = P.emf != null ? P.emf : cells * (P.emfPerCell != null ? P.emfPerCell : 1.5);
        var rInt = P.rInt != null ? P.rInt : cells * (P.rPerCell != null ? P.rPerCell : 0.5);
        out.push({ kind: 'V', comp: comp, p: N(0), q: N(1), V: emf, Rs: rInt });
        break;

      case 'rheostat':
        // C(2)/D(3) 已在 buildNodes 中合并 → 同一节点 = 滑片 S
        var S = N(2);
        addR(N(0), S, P.Rmax * clamp01(P.slide));          // A → 滑片（左半段）
        addR(S, N(1), P.Rmax * (1 - clamp01(P.slide)));    // 滑片 → B（右半段）
        break;

      // 接线点：一根理想导线，【一条支路都不产生】。
      // 它的两个端子在 buildNodes 里已经被 internalShort 并成同一个节点，
      // 所以对基尔霍夫方程一个数都不贡献 —— 正是「零电阻、零压降」。
      // 这条 case 是空的，但不能删：少了它就会掉进下面的 default 抛错，
      // 场景里只要有一个接线点，整个求解直接崩。
      case 'junction':
        break;

      default:
        throw new Error('未知元件类型: ' + comp.type);
    }
    return out;
  }

  function clamp01(x) { x = +x; if (!isFinite(x)) return 0; return x < 0 ? 0 : (x > 1 ? 1 : x); }
  // 参数取值：非数就退回默认值。参数面板是滑出来的数，但存档是手改得动的
  // JSON —— 一个字符串参数流进来，下面整条计算链会静默变成 NaN。
  function num(v, d) { v = +v; return isFinite(v) ? v : d; }

  // ============================================================
  // 发光二极管：此刻是正向导通还是反向截止
  // ------------------------------------------------------------
  // 判据分两种情形，因为「导通」这件事本身会改变电路拓扑 ——
  // 导通时有支路、截止时没有，所以不能只看一个量：
  //   · 当前假设【导通】（支路在）→ 看这条支路的电流。电流为负 = 电流想从
  //     「−」往「+」流，可二极管不让它过 ⇒ 截止。
  //   · 当前假设【截止】（支路不在）→ 看两端开路电压。只有超过正向压降 Vf
  //     才谈得上导通。低于 Vf 时即使正偏也几乎不导电（真实管子就是这样），
  //     所以判据不是「正偏就导通」。
  // 不做「部分导通」的中间态：真实的 LED 要么正向导通（压降几乎恒为 Vf）、
  // 要么反向截止（漏电 nA 级，初中当断路），中间那段只在击穿区附近才出现。
  function ledConducts(P, branch, sol, comp, termNode) {
    var lc = ledColorOf(P);
    if (branch) return bI(sol, branch) > -1e-9;
    var U = nV(sol, termNode[comp.id + ':0']) - nV(sol, termNode[comp.id + ':1']);
    return U > lc.Vf + 1e-9;
  }

  // ============================================================
  // 直流电动机的稳态工作点
  // ------------------------------------------------------------
  // 两条方程联立（稳态，转子不再加速）：
  //   机械：kT·I = T0 + b·ω        库仑摩擦 T0 加粘性摩擦 b·ω
  //   电气：U = kE·ω + I·R线圈
  // 三个常数（kE、kT、b）用铭牌上的三个数定标，这样面板上调的每一个数
  // 都是真实电机铭牌上印得出来的量：
  //   ω额 = rpmPerV·U额            额定电压下的空载转速
  //   T0  = kT·I0                  空载时电磁力矩只需克服库仑摩擦 ⇒ 空载电流 I0
  //   额定点电流 = I_RATIO·I0      于是 U额 = kE·ω额 + I_RATIO·I0·R线圈
  // 解出来：
  //   ω = (|U| − I0·R) / (kE + (I_RATIO−1)·I0·R/ω额)
  //   ε = kE·ω（符号跟 U 走）
  // 两个极限都对得上现实：U = U额 时 ω = ω额、I = I_RATIO·I0；
  // 堵转（ω = 0）时 ε = 0、I = U/R线圈 —— 比空载大一个量级。
  // 返回 { eps, omega, stalled }：omega 单位 rad/s，符号就是转向。
  function motorState(P, U) {
    var M = MOTOR;
    var R  = Math.max(1e-6, num(P.Rcoil, M.R_DEF));
    var I0 = Math.max(1e-9, num(P.noLoadI, M.noLoadI));
    var rpv = Math.max(1, num(P.rpmPerV, M.rpmPerV));
    var stopped = { eps: 0, omega: 0, stalled: true };
    if (P.stall) return stopped;                    // 转子被卡住：ω = 0 ⇒ 没有反电动势
    // 铭牌自相矛盾（额定电流 × 线圈电阻 已经超过额定电压）时，这种规格的电机
    // 在额定电压下根本转不起来。参数面板的范围已经把它挡在外面，这里再兜一层：
    // 当成停转，而不是让 kE 变成负数、转速反着算出来。
    var k1num = M.URATED - M.I_RATIO * I0 * R;
    if (k1num <= 1e-6) return stopped;
    if (Math.abs(U) <= I0 * R) return stopped;      // 电压低到连自身摩擦都推不动
    var wRated = rpv * M.URATED * 2 * Math.PI / 60; // 额定电压下的空载角速度
    var k1 = k1num / wRated;                        // kE（V·s/rad）
    var k2 = (M.I_RATIO - 1) * I0 * R / wRated;     // 粘性摩擦项折算到 ω 上
    var w = (Math.abs(U) - I0 * R) / (k1 + k2);
    var s = U < 0 ? -1 : 1;
    return { eps: s * k1 * w, omega: s * w, stalled: false };
  }

  // 电动机在给定端电压下的稳态电流（幅值）。和 motorState 同一套方程，
  // 只是这里要的是电流：I = (U − ε)/R线圈，由解出来的支路电流给出。
  // 转速从 ω 换成面板和读数框用的 r/min。
  function rpmOf(omega) { return omega * 60 / (2 * Math.PI); }

  // 电铃的磁动势（安匝）与「响不响」。安匝 = 电流 × 匝数，这是电磁铁磁性强弱
  // 的标准量法；低于吸合下限就顶不动弹簧片，铃不响。方向不参与 —— 软铁衔铁
  // 不管铁芯是 N 极还是 S 极都被吸引（这正是「电铃没有单向导电性」的原因）。
  function bellState(P, I) {
    var turns = Math.max(1, num(P.turns, 800));
    var mag = Math.abs(fin(I, 0)) * turns;
    return {
      turns: turns,
      mag: mag,
      rings: mag >= BELL_MAG_MIN,
      // 响度（0~1）：刚过吸合线时是轻响，磁动势越大锤得越狠。
      // 用 1 − min/实际 的比值而不是线性归一，是为了让「刚好响」和「很响」
      // 在画面上分得开 —— 线性归一的话 16 到 120 安匝全挤在最右端一小段里。
      volume: Math.max(0, Math.min(1, 1 - BELL_MAG_MIN / Math.max(mag, BELL_MAG_MIN))),
    };
  }

  // 矩阵奇异时用来分辨「短路」还是「接错线」。
  // 只看理想电压源支路（Rs≈0：理想电源、闭合开关、理想电流表）：
  //   · 两端落到同一个电气节点【且电压不为 0】→ 方程组自相矛盾（0 = V），
  //     物理上就是「一个理想电源被零阻通路强行摁住」= 真短路；
  //   · 两条这样的支路压在同一对节点上却给出不同电压 → 同样的矛盾，
  //     典型是「理想电源两端并一个闭合开关」。
  //
  // ⚠️ p === q 本身【不是】短路的证据。零阻零压的理想支路（闭合开关、
  //    理想电流表、0Ω 电阻）两端同节点时，它写的方程是 0 = 0 —— 一条
  //    什么也没说的冗余约束。学生把一根导线并在开关两个接线柱上就是这种
  //    情形：导线已经把两个端子并成了同一个节点，开关那条支路成了废话。
  //    它【不会】让回路里的电流变大（串联的电源和负载一个没变），只是让
  //    开关失去控制作用。旧版在这里 `if (b.p === b.q) return true;`，
  //    于是「短接了开关」被报成「电源短路、电流过大」——物理上是错的。
  //    这类支路已经在 assemble() 里被丢掉了（见 degenerateIdealBranch），
  //    所以正常路径下根本走不到这里；留着这一句是给「手工构造的支路表」
  //    （测试直接调它）兜底。
  function isShortedByIdealLoop(branches) {
    var byPair = new Map();
    for (var i = 0; i < branches.length; i++) {
      var b = branches[i];
      if (b.kind !== 'V' || !(Math.abs(b.Rs) <= 1e-9)) continue;
      if (b.p === b.q) {
        if (Math.abs(b.V) > EPS) return true;   // 0 = V ≠ 0：矛盾，真短路
        continue;                               // 0 = 0：什么都没说，跳过
      }
      var key = b.p <= b.q ? (b.p + '|' + b.q) : (b.q + '|' + b.p);
      var prev = byPair.get(key);
      if (prev === undefined) { byPair.set(key, b); continue; }
      if (Math.abs(prev.V - b.V) > 1e-9) return true;
    }
    return false;
  }

  // 退化的理想电压源支路：Rs≈0、V≈0、且两端已经落在同一个电气节点上。
  // 它写的方程是 `0 = 0`（见 solveIsland 的 stamp：p === q 时两侧 KCL 抵消，
  // 只剩 −Rs·Ik = V），在矩阵里就是【一整行零】—— 高斯消元当场判奇异，
  // 于是整条电路报「无法求解」。可它明明什么信息都没携带，删掉它电路照样解。
  //
  // 谁会踩到：把一根导线并在闭合开关的两个接线柱上（导线把两端并成同一
  // 节点，开关那条支路就成了自环）、理想电流表被短接、0Ω 电阻被短接。
  // 删掉之后这些元件的 rec.i 自然为 0（bs 为空），正好是物理事实：电流
  // 全从并接的那条零阻通路走了，开关自己身上一点电流都没有。
  //
  // ⚠️ 只丢 V≈0 的。Rs≈0 而 V≠0 的自环【必须留下】—— 那是「理想电源被
  //    导线直接短接」，方程 0 = V 无解，正是最严重的短路，得让它去报错。
  function degenerateIdealBranch(b) {
    return b.kind === 'V' && Math.abs(b.Rs) <= 1e-9 &&
           Math.abs(b.V) <= EPS && b.p === b.q;
  }

  // 元件的【显示名】。页面允许学生点画布上的标签给元件改名（见 circuit-draw
  // 的 nameOf），内核只在【文案】上跟着走 —— 节点名（`id + ':' + termIdx`）、
  // `componentIds`、`results.components[c.id]` 这些【索引】一律仍用 c.id，
  // 换了名字不能让求解器认不出元件。
  function nameOf(c) {
    if (!c) return '';
    var n = c.name;
    return (typeof n === 'string' && n.trim()) ? n.trim() : c.id;
  }

  // ============================================================
  // 第三遍：连通分量（电气孤岛）
  // ------------------------------------------------------------
  // 无源岛整岛【精确归零】—— 这一步同时消灭「孤立元件偷走电流」
  // 和「悬空节点产生 NaN」两类 bug，且结果是严格 0 而非 1e-12 噪声。
  // ============================================================
  function buildIslands(branches) {
    var dsu = createDSU();
    var i;
    for (i = 0; i < branches.length; i++) dsu.union(branches[i].p, branches[i].q);

    var byRoot = new Map();
    var islandOfBranch = new Map();
    for (i = 0; i < branches.length; i++) {
      var r = dsu.find(branches[i].p);
      if (!byRoot.has(r)) byRoot.set(r, []);
      byRoot.get(r).push(branches[i]);
      islandOfBranch.set(branches[i], byRoot.get(r));
    }
    var islands = [];
    byRoot.forEach(function (bs) {
      // ⚠️ 「有源」只认【真电源】。发光二极管的正向压降和电动机的反电动势
      // 都是电压源支路，但它们是无源元件内部的等效源，不是给电路供电的电源：
      // 把它们算成有源岛，一个孤零零摆在台上的二极管会被判成「已接入电路」，
      // 状态行也会从「还没有接电源」变成「电路导通」—— 全错。
      var hasSource = bs.some(function (b) {
        return b.kind === 'V' && Math.abs(b.V) > EPS && !b.passive;
      });
      islands.push({ branches: bs, hasSource: hasSource });
    });
    return { islands: islands, islandOfBranch: islandOfBranch };
  }

  // ============================================================
  // 高斯消元：列主元 + 行缩放
  // ------------------------------------------------------------
  // 行缩放对 MNA 很关键：KCL 行量纲是西门子、电压源行量纲是伏特，
  // 不缩放时主元选取会被量纲而非数值大小主导。
  // ============================================================
  function solveLinear(A, z, n) {
    var i, j, k;
    var scale = new Array(n);
    var maxAbsA = 0;
    for (i = 0; i < n; i++) {
      var m = 0;
      for (j = 0; j < n; j++) { var v = Math.abs(A[i][j]); if (v > m) m = v; }
      scale[i] = m > 0 ? m : 1;
      if (m > maxAbsA) maxAbsA = m;
      for (j = 0; j < n; j++) A[i][j] /= scale[i];
      z[i] /= scale[i];
    }
    var tol = Math.max(1e-12, 1e-12 * maxAbsA);

    for (k = 0; k < n; k++) {
      var piv = k, best = Math.abs(A[k][k]);
      for (i = k + 1; i < n; i++) {
        var av = Math.abs(A[i][k]);
        if (av > best) { best = av; piv = i; }
      }
      if (best < tol) return null;                         // 奇异
      if (piv !== k) {
        var t = A[k]; A[k] = A[piv]; A[piv] = t;
        var s = z[k]; z[k] = z[piv]; z[piv] = s;
        var sc = scale[k]; scale[k] = scale[piv]; scale[piv] = sc;
      }
      var akk = A[k][k];
      for (i = k + 1; i < n; i++) {
        var f = A[i][k] / akk;
        if (f === 0) continue;
        A[i][k] = 0;
        for (j = k + 1; j < n; j++) A[i][j] -= f * A[k][j];
        z[i] -= f * z[k];
      }
    }
    var x = new Array(n).fill(0);
    for (i = n - 1; i >= 0; i--) {
      var sum = z[i];
      for (j = i + 1; j < n; j++) sum -= A[i][j] * x[j];
      var d = A[i][i];
      if (Math.abs(d) < tol) return null;
      x[i] = sum / d;
    }
    // 注意：行缩放是对「方程」的等价变换 —— A' = D·A, z' = D·z ⇒ 解 x 完全不变。
    // 所以回代得到的 x 就是最终解，绝不能再除以 scale（曾经在这里错了 10~1500 倍）。
    return x;
  }

  // ============================================================
  // 单个岛的 MNA 装配与求解
  // ============================================================
  function solveIsland(island) {
    var Vb = island.branches.filter(function (b) { return b.kind === 'V'; });

    // 接地：优先取幅值最大【真电源】的负极，使多数节点电压为正、读数符合直觉。
    // 只在真电源里挑（passive 的等效源不算），否则一个 2.5V 反电动势的电动机
    // 可能把 3V 的电池挤掉，接地点落到电动机的端子上 —— 读数就全反了。
    // 一个真电源都没有（理论上进不来：无源岛在上面就被整岛归零了）时退回老办法。
    var realVb = Vb.filter(function (b) { return !b.passive; });
    var main = (realVb.length ? realVb : Vb)
      .filter(function (b) { return Math.abs(b.V) > EPS; })
      .sort(function (a, b) { return Math.abs(b.V) - Math.abs(a.V); })[0];
    var ground = main ? main.q : island.branches[0].p;

    var nodes = [];
    island.branches.forEach(function (b) {
      if (nodes.indexOf(b.p) < 0) nodes.push(b.p);
      if (nodes.indexOf(b.q) < 0) nodes.push(b.q);
    });

    var idx = new Map();
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i] !== ground) idx.set(nodes[i], idx.size);
    }
    var N = idx.size, M = Vb.length, n = N + M;
    var at = function (nd) { return nd === ground ? -1 : idx.get(nd); };

    var nodeV = new Map();
    var bI = new Map();
    nodes.forEach(function (nd) { nodeV.set(nd, 0); });
    island.branches.forEach(function (b) { bI.set(b, 0); });

    if (n === 0) return { ok: true, nodeV: nodeV, bI: bI, N: N, M: M };

    var A = [], z = new Array(n).fill(0);
    for (i = 0; i < n; i++) A.push(new Array(n).fill(0));

    var rowOf = new Map();
    Vb.forEach(function (b, k) { rowOf.set(b, N + k); });

    for (i = 0; i < island.branches.length; i++) {
      var b = island.branches[i];
      var ip = at(b.p), iq = at(b.q);

      if (b.kind === 'R' || b.kind === 'LAMP') {
        var G = 1 / b.R;
        if (ip >= 0) A[ip][ip] += G;
        if (iq >= 0) A[iq][iq] += G;
        if (ip >= 0 && iq >= 0) { A[ip][iq] -= G; A[iq][ip] -= G; }
      } else {
        var row = rowOf.get(b);
        if (ip >= 0) { A[ip][row] += 1; A[row][ip] += 1; }
        if (iq >= 0) { A[iq][row] -= 1; A[row][iq] -= 1; }
        A[row][row] -= (b.Rs || 0);                        // 负号！见文件头
        z[row] = b.V;
        // p === q 时两侧 KCL stamp 自动抵消，只剩 −Rs·Ik = V
        // ⇒ Ik = −V/Rs ⇒ 放电电流 V/Rs —— 电源被短路的正解，零特判
      }
    }

    var x = solveLinear(A, z, n);
    if (!x) return { ok: false, singular: true, nodeV: nodeV, bI: bI, N: N, M: M };

    nodes.forEach(function (nd) {
      var r = at(nd);
      nodeV.set(nd, r < 0 ? 0 : x[r]);
    });
    island.branches.forEach(function (b) {
      var r = rowOf.get(b);
      bI.set(b, r == null ? 0 : x[r]);
    });
    return { ok: true, nodeV: nodeV, bI: bI, N: N, M: M };
  }

  function solveAllIslands(islands) {
    var nodeV = new Map(), bI = new Map(), matrixSize = 0;
    for (var i = 0; i < islands.length; i++) {
      var is = islands[i];
      if (!is.hasSource) {
        // 无源岛（孤立元件、未接线备件、断开的支路）：整岛精确归零
        is.branches.forEach(function (b) {
          nodeV.set(b.p, 0); nodeV.set(b.q, 0); bI.set(b, 0);
        });
        continue;
      }
      var r = solveIsland(is);
      if (!r.ok) return { ok: false, singular: true };
      r.nodeV.forEach(function (v, k) { nodeV.set(k, v); });
      r.bI.forEach(function (v, b) { bI.set(b, v); });
      matrixSize = Math.max(matrixSize, r.N + r.M);
    }
    return { ok: true, nodeV: nodeV, bI: bI, matrixSize: matrixSize };
  }

  // ============================================================
  // 短路（拓扑判据）
  // ------------------------------------------------------------
  // 不用「电流超过某个数」来判短路，那个阈值永远拍不准：默认那台电源
  // （3V / 内阻 1Ω）被一根导线短接时电流只有 3A，按 10A 的阈值判它「正常导通」，
  // 而学生看到的明明是一次短路事故。
  //
  // 本质判据是【拓扑】的：电源两极之间存在一条「零阻通路」。
  // 零阻通路 = 导线（并查集已把两端并成同一个电气节点）+ 闭合开关 +
  // 理想电流表 + 0Ω 电阻/变阻器 C-D 接法。把后者这些支路单独并一次查集，
  // 再看电源两极的节点在不在同一个集合里。
  //
  // ⚠️ 电源自己的支路【不能算进这条通路】：Rs=0 的理想电源也是 kind:'V'，
  //    把它算进去就成了「电源自己把自己短路」，任何一台理想电源都恒短路。
  // ============================================================
  function shortedBatteryIds(components, branches, termNode) {
    var dsu = createDSU();
    var seen = {};                                       // createDSU 没有 has()，自己记一份
    branches.forEach(function (b) {
      if (b.kind !== 'V' || Math.abs(b.Rs) > 1e-9) return;
      if (b.comp && b.comp.type === 'battery') return;   // 见上面那条警告
      if (b.p === b.q) return;
      dsu.add(b.p); dsu.add(b.q); dsu.union(b.p, b.q);
      seen[b.p] = 1; seen[b.q] = 1;
    });
    var ids = [];
    components.forEach(function (c) {
      if (c.type !== 'battery' || isOpenFault(c)) return;
      var n0 = termNode[c.id + ':0'], n1 = termNode[c.id + ':1'];
      if (n0 == null || n1 == null) return;
      // 两极同节点 = 被导线直接短接；否则看零阻元件有没有把它们连通。
      if (n0 === n1) { ids.push(c.id); return; }
      if (seen[n0] && seen[n1] && dsu.find(n0) === dsu.find(n1)) ids.push(c.id);
    });
    return ids;
  }

  // ============================================================
  // 主求解入口
  // ============================================================
  function solve(components, wires, options) {
    options = options || {};
    var opts = {
      lampMaxIter: options.lampMaxIter || 200,
      lampTolR: options.lampTolR || 1e-9,
      lampOmega: options.lampOmega || 0.7,
      shortCurrent: options.shortCurrent || 10,
    };
    components = components || [];
    wires = wires || [];

    var warnings = [];
    var out = {
      ok: true, status: 'ok', degraded: false, iterations: 0,
      warnings: warnings, nodeV: {}, terminalNode: {}, components: {},
      islands: [], stats: {},
    };
    if (components.length === 0) { out.status = 'empty'; return out; }

    var t0 = now();
    var topo = buildNodes(components, wires);
    out.terminalNode = topo.termNode;

    // 哪些端子上真的挂了导线（"compId:termIdx" 集合）。表头的量程柱、
    // 「−」柱接没接上，只能从这里看——参数面板选了什么不算数。
    // 悬空端（compId 为 null）跳过：它会造出 "null:0" 这个不存在的端子名。
    var wired = new Set();
    wires.forEach(function (w) {
      if (w && w.a && w.a.compId != null) wired.add(w.a.compId + ':' + w.a.termIdx);
      if (w && w.b && w.b.compId != null) wired.add(w.b.compId + ':' + w.b.termIdx);
    });
    // 每个表头生效的量程柱。导线接法在求解过程中不变，识别一次就固定，
    // 灯泡迭代里反复 assemble() 拿的是同一份。
    var meterTaps = {};
    components.forEach(function (c) {
      if (TYPES[c.type] && TYPES[c.type].rangeTaps) meterTaps[c.id] = meterTap(c, wired);
    });

    var lamps = components.filter(function (c) { return c.type === 'bulb'; });
    var lampR = new Map();
    lamps.forEach(function (c) { lampR.set(c.id, lampInitR(c)); });

    // 发光二极管先一律按【正向导通】起步。选这个初值不是随便挑的：
    // 导通时那条支路把 LED 两端的节点连了起来，解出来的电位都是有依托的；
    // 反过来先按截止起步，LED 那两点就是悬空的，拿「悬空节点的幽灵 0V」
    // 去判它正偏还是反偏，结果会随电路形状乱变。
    var leds = components.filter(function (c) { return c.type === 'led'; });
    var ledOn = new Map();
    leds.forEach(function (c) { ledOn.set(c.id, true); });

    // 电动机的反电动势初值取 0 = 刚通电、转子还没转起来的那一瞬间，
    // 此刻的电流就是启动电流（也是全过程中最大的那一个）。
    var motors = components.filter(function (c) { return c.type === 'motor'; });
    var motorEps = new Map();
    motors.forEach(function (c) { motorEps.set(c.id, 0); });

    var st = { ledOn: ledOn, motorEps: motorEps };

    function assemble() {
      var branches = [];
      components.forEach(function (c) {
        var tap = meterTaps[c.id];                       // {idx, conflict} 或 undefined
        describeComponent(c, topo.termNode, lampR.get(c.id), tap ? tap.idx : null, st)
          .forEach(function (b) {
            // 0 = 0 的冗余约束在这里就丢掉，别让它进矩阵把整条电路判成奇异
            // （见 degenerateIdealBranch：闭合开关被导线短接、理想电流表被
            //  短接、0Ω 电阻被短接，都会生成这种自环支路）。
            if (degenerateIdealBranch(b)) return;
            branches.push(b);
          });
      });
      return branches;
    }

    var branches = assemble();
    var ig = buildIslands(branches);
    var islands = ig.islands;
    var islandOfBranch = ig.islandOfBranch;
    var sol = solveAllIslands(islands);
    var usedBranches = branches;

    // ---- 统一阻尼不动点迭代（灯泡 / 电动机 / 发光二极管）------------
    // 三类元件的非线性程度完全不同，但都是「先用上一轮的解反推元件自己的
    // 等效参数、再重解一遍」：
    //   灯泡    连续量（灯丝电阻随功率变），走阻尼迭代；
    //   电动机  连续量（反电动势随转速变），同一套阻尼；
    //   二极管  开关量（导通 / 截止），一变就得把整条支路装上或拆掉重解。
    // 合成一个循环而不是三段串起来，是因为它们在同一个回路里会互相牵制：
    // 二极管一截止，电动机的端电压就变了，反电动势得跟着重算。
    // ⚠️ 只有灯泡时，下面这段的执行路径和旧版【逐字一致】（二极管、电动机
    // 的数组都是空的，maxDelta 与 omega 的更新一模一样）—— 这是回归的底线。
    var ledFlips = 0, LED_FLIP_MAX = 4;
    if (sol.ok && (lamps.length + leds.length + motors.length) > 0) {
      var omega = opts.lampOmega;
      var prevMax = Infinity;
      var converged = false;
      var iter = 0;
      for (; iter < opts.lampMaxIter; iter++) {
        var maxDelta = 0;
        var targets = new Map();
        for (var li = 0; li < lamps.length; li++) {
          var lc = lamps[li];
          var lb = branches.filter(function (b) { return b.comp === lc; })[0];
          var v = lb ? (nV(sol, lb.p) - nV(sol, lb.q)) : 0;
          var R = lampR.get(lc.id);
          var P = Math.max(v * v / R, 0);
          var Rnew = lampRAt(lampParams(lc), P);
          targets.set(lc.id, Rnew);
          maxDelta = Math.max(maxDelta, Math.abs(Rnew - R) / R);
        }

        // 电动机：拿当前端电压算稳态反电动势，作为这一轮的目标值。
        // 收敛判据要归一化 —— 反电动势是几伏的量级，跟灯丝电阻的「相对变化」
        // 不能直接比大小，否则要么永远不收敛、要么一步就「收敛」。
        var mTargets = new Map();
        for (var mi = 0; mi < motors.length; mi++) {
          var mc = motors[mi];
          var mb = branches.filter(function (b) { return b.comp === mc; })[0];
          var mu = mb ? (nV(sol, mb.p) - nV(sol, mb.q)) : 0;
          var mnew = motorState(paramsOf(mc), mu).eps;
          mTargets.set(mc.id, mnew);
          var mold = motorEps.get(mc.id);
          maxDelta = Math.max(maxDelta, Math.abs(mnew - mold) / Math.max(0.5, Math.abs(mu)));
        }

        // 发光二极管：导通 / 截止是一个开关量，切了就整支路重装。
        // 翻转次数封顶：两个二极管互相牵制时可能出现「我切你就切回来」的
        // 极限环，封顶保证一定停得下来（停下来的状态仍然自洽，只是未必是
        // 全局最合理的那个 —— 这种接法本来就没有唯一解，报不收敛更诚实）。
        var flipped = false;
        for (var di = 0; di < leds.length; di++) {
          var dc = leds[di];
          if (ledFlips >= LED_FLIP_MAX * leds.length) break;
          var db = branches.filter(function (b) { return b.comp === dc; })[0];
          var want = ledConducts(paramsOf(dc), db, sol, dc, topo.termNode);
          if (want !== ledOn.get(dc.id)) { ledOn.set(dc.id, want); flipped = true; ledFlips++; }
        }

        if (maxDelta < opts.lampTolR && !flipped) { converged = true; usedBranches = branches; break; }

        if (flipped) omega = Math.min(omega * 1.4, 1.0);   // 结构性变化，别拖泥带水
        else if (maxDelta > prevMax * 1.05) omega = Math.max(omega * 0.5, 0.05);
        else omega = Math.min(omega * 1.1, 1.0);
        prevMax = maxDelta;

        lamps.forEach(function (lc) {
          lampR.set(lc.id, lampR.get(lc.id) + omega * (targets.get(lc.id) - lampR.get(lc.id)));
        });
        motors.forEach(function (mc) {
          motorEps.set(mc.id, motorEps.get(mc.id) +
            omega * (mTargets.get(mc.id) - motorEps.get(mc.id)));
        });

        branches = assemble();
        ig = buildIslands(branches);
        islands = ig.islands;
        islandOfBranch = ig.islandOfBranch;
        sol = solveAllIslands(islands);
        if (!sol.ok) break;
      }
      out.iterations = iter + 1;
      if (!converged && sol.ok) {
        warnings.push({ code: 'LAMP_NOT_CONVERGED', message: '元件工作点未收敛，结果可能不准' });
      }

      // ---- 零电流二极管的收尾（只能放在收敛【之后】）------------------
      // 收敛后会出现这样一种状态：二极管按「导通」建了支路，可整条回路因为
      // 别处断开（开关拉开、线只接了一半）根本没有电流。支路把管子两端硬撑在
      // Vf 上，于是读数框会印出「U = 1.80V」，而管子一点电流都没有 ——
      // 学生拿电压表去量这只管子，量到的是「开关上那 3V 之外剩下的那点」，
      // 近似 0，不是 1.80V。这条读数错得还很像对的（数字干净、正好等于 Vf）。
      //
      // 判据：把这条支路【真拆掉再解一次】，看管子两端会被抬到多高 ——
      //   抬不过 Vf → 它就是不该导通，接受这次解（管子两端近似 0V）；
      //   抬过 Vf   → 它确实卡在门槛上（例如两只红管串在 3V 上），还原回去。
      // 每个零电流二极管最多多解两次，与电路规模无关。
      // ⚠️ 判据不能简化成「电流为 0 就当截止」：那样「两只红管串在 3V 上」
      //    会变成「拆掉→抬过 Vf→装回→电流又是 0→再拆掉」的极限环，
      //    最后报不收敛，而那个电路本来是好好的、只是不亮。
      if (sol.ok) {
        leds.forEach(function (dc) {
          if (!ledOn.get(dc.id)) return;
          var db = branches.filter(function (b) { return b.comp === dc; })[0];
          if (!db || Math.abs(bI(sol, db)) > 1e-9) return;    // 有电流就不是这回事
          var saved = { branches: branches, islands: islands,
                        islandOfBranch: islandOfBranch, sol: sol };
          ledOn.set(dc.id, false);
          branches = assemble();
          ig = buildIslands(branches);
          islands = ig.islands; islandOfBranch = ig.islandOfBranch;
          sol = solveAllIslands(islands);
          var Uopen = sol.ok
            ? (nV(sol, topo.termNode[dc.id + ':0']) - nV(sol, topo.termNode[dc.id + ':1']))
            : Infinity;
          if (sol.ok && Uopen <= ledColorOf(paramsOf(dc)).Vf + 1e-9) {
            usedBranches = branches;                          // 接受：管子判为截止
          } else {
            ledOn.set(dc.id, true);                           // 还原：真的卡在门槛上
            branches = saved.branches; islands = saved.islands;
            islandOfBranch = saved.islandOfBranch; sol = saved.sol;
            usedBranches = branches;
          }
        });
      }
    }

    if (!sol.ok) {
      out.ok = false;
      // 矩阵奇异有两种成因，对学生的含义完全不同，必须分开报：
      //   短路 —— 理想电源被零阻通路短接，是真实会烧电源的操作；
      //   矛盾 —— 其它接线错误。混在一起报「接线矛盾」会让学生
      //   以为自己接错了线，其实是短路了。
      var shorted = isShortedByIdealLoop(branches);
      out.status = shorted ? 'shorted' : 'singular';
      // 无解这一支也要给短路信息：理想电源（内阻 0）被零阻通路短接时电流是
      // 无穷大，方程根本解不出来 —— 这恰恰是【最严重】的短路，不给的话
      // 后面「熔断导线 / 烧电源」的判定会把最该处理的这一种漏掉。
      out.shortCircuit = { compIds: shortedBatteryIds(components, usedBranches, topo.termNode) };
      warnings.push(shorted
        // 只说【电源】被短接：闭合开关被导线短接不会走到这里（那条支路是
        // 0 = 0，早被丢掉了），会走到这里的闭合开关必定是和电源并在一起
        // 把它摁住的那一条 —— 那本来就是电源短路。
        ? { code: 'SHORT_CIRCUIT', message: '电源被导线直接短接，电流会过大' }
        : { code: 'SINGULAR', message: '电路存在矛盾约束，请检查接线' });
      return out;
    }

    // ---- 回填每个元件 ----
    var comp = {};
    var anyCurrent = false;
    var shorted = false;

    // 「属于有源岛」的节点集合 —— 判断元件是否真的接进了电路。
    // 不能用「端子是否与其它元件共节点」：被自己短路的电池没有任何别的元件，
    // 但它显然在工作（这正是 T7 用例抓到的）。
    var poweredNode = new Set();
    islands.forEach(function (is) {
      if (!is.hasSource) return;
      is.branches.forEach(function (b) { poweredNode.add(b.p); poweredNode.add(b.q); });
    });

    components.forEach(function (c) {
      var P = paramsOf(c);
      var N = function (i) { return topo.termNode[c.id + ':' + i]; };
      var TI = TYPES[c.type];
      // 「−」柱（公共端）的端子号。两端元件没有这一项，取 1 退化成老行为。
      var NCi = (TI.commonTerm != null) ? TI.commonTerm : 1;
      var tp = meterTaps[c.id];                          // {idx, conflict} 或 undefined
      var tapIdx = tp ? tp.idx : null;
      var bs = usedBranches.filter(function (b) { return b.comp === c; });
      var rec = { type: c.type, v: 0, i: 0, p: 0, R: null, isolated: false };
      // 损坏原样回传：绘制层（画灯丝断口、指针打表、电源冒烟）和读数框
      // 都靠它，页面不必再去场景里翻 comp.fault —— 一份真值，两条路都用它。
      rec.fault = c.fault || null;
      rec.faultLabel = c.fault ? faultLabel(c.fault, c) : '';
      // 表头的「−」柱（公共端）接没接线。两端元件没有这一项，恒 true。
      // 必须在这里、算读数之前定下来：读数要靠它决定「表到底在不在电路里」。
      rec.commonWired = (TI.commonTerm == null) ? true : wired.has(c.id + ':' + TI.commonTerm);

      // 「未接入电路」= 该元件没有任何端子落在有源岛内。
      // 对理想电压表这类「无支路」元件同样正确（它的节点不在任何岛里）。
      rec.isolated = true;
      for (var t = 0; t < TI.terminals; t++) {
        if (poweredNode.has(N(t))) { rec.isolated = false; break; }
      }

      switch (c.type) {
        case 'resistor': case 'bulb': case 'voltmeter': {
          if (bs.length === 0) {
            // 理想电压表（无支路）：读数是两端节点电压差，电流为 0。
            // 注意不能在这里 break 成 v=0 —— 否则理想电压表永远读 0。
            // 三柱电压表的「两端」= 当前量程柱 与 「−」柱；没接量程柱时
            // N(null) 是 undefined，两边都取 0，读数自然是 0。
            // ⚠️ 这个式子【只在两端都接了线时】才有物理意义：只接一根柱子时
            // 另一端是悬空的，nV 会给悬空节点一个幽灵 0V，读出来的其实是电路
            // 节点对地的电位。所以下面 fillVoltmeter() 里还会按 rec.wired 抹一遍 0。
            rec.v = (c.type === 'voltmeter')
              ? (nV(sol, N(tapIdx)) - nV(sol, N(NCi)))
              : (nV(sol, N(0)) - nV(sol, N(1)));
            rec.i = 0;
            rec.p = 0;
            rec.R = null;
            if (c.type === 'voltmeter') {
              fillVoltmeter(rec, c, P, tapIdx, warnings);
              warnMeterWiring(warnings, rec, c, tp, wired, '电压表');
            }
            break;
          }
          var br = bs[0];
          if (br.kind === 'V') {
            rec.R = 0; rec.v = 0; rec.i = bI(sol, br);
          } else {
            rec.R = br.R;
            rec.v = nV(sol, br.p) - nV(sol, br.q);
            rec.i = rec.v / br.R;
          }
          rec.p = rec.v * rec.i;
          if (c.type === 'bulb') {
            // 灯座短路：这条支路是一根 0.01Ω 的短接线，不是灯丝。绝不能走
            // fillLamp —— 它按 p/P额 算亮度，而短接线上的功率是 I²·0.01，
            // 3V 下几百瓦，算出来的亮度会顶到 1.3，灯【亮得像要炸】，
            // 正好把「灯座短路 ⇒ 灯不亮」这件事讲反了。
            if (br.shorted) { rec.brightness = 0; rec.overload = false; }
            else fillLamp(rec, c, P);
          }
          if (c.type === 'voltmeter') {
            // 有内阻的电压表走的是这条支路：支路另一端（「−」柱）没接线时
            // 支路里没有电流，但两端电位差照样算得出来——同样得按 rec.wired 抹掉。
            fillVoltmeter(rec, c, P, tapIdx, warnings);
            warnMeterWiring(warnings, rec, c, tp, wired, '电压表');
          }
          break;
        }

        case 'switch': {
          rec.closed = !!P.closed;
          if (P.closed && bs.length) {
            rec.i = bI(sol, bs[0]);
            rec.v = 0;
          } else {
            rec.v = nV(sol, N(0)) - nV(sol, N(1));
            rec.i = 0;
          }
          rec.p = rec.v * rec.i;
          // 「闭合着，可一条支路都没有」只有一种来路：它的两个接线柱落在
          // 同一个电气节点上（有导线把两端并起来了），那条 0 = 0 的支路被
          // degenerateIdealBranch 丢掉了。这就是「用一根导线把开关短接」。
          // 必须说出来，而且必须说【准】—— 它只是让开关失去控制作用，
          // 回路里的电流一点没变（串联的电源和负载一个没少）。旧版把这种
          // 接法报成「电源短路、电流过大」，学生照着改线会越改越糊涂。
          rec.bypassed = P.closed && !bs.length && !isOpenFault(c);
          if (rec.bypassed) {
            warnings.push({ code: 'SWITCH_BYPASSED',
              message: '开关 ' + nameOf(c) + ' 的两个接线柱被导线直接连通，' +
                       '它已经控制不了电路了（电流不经过开关，大小不变）',
              componentIds: [c.id] });
          }
          break;
        }

        // 发光二极管。on 是「此刻真的在导通」，跟「假设它导通」是两件事：
        // 假设导通、但电流为负时，迭代已经把它翻成截止了，所以正常情况下
        // on === (支路存在)。留 on 这个字段是给绘制和读数用的单一真值。
        case 'led': {
          var lc2 = ledColorOf(P);
          rec.color = P.color || 'red';
          rec.colorLabel = lc2.label;
          rec.rgb = lc2.rgb;
          rec.Vf = lc2.Vf;
          rec.Rs = LED_RS;
          rec.IRated = LED_I_RATED;
          rec.IMax = LED_I_MAX;
          if (bs.length) {
            var lbr = bs[0];
            rec.i = bI(sol, lbr);                        // 从「+」流入为正
            rec.v = nV(sol, lbr.p) - nV(sol, lbr.q);
            rec.on = rec.i > 1e-6;
            // 只有【真的在导通】才报体电阻。摆在台上没接线、或者接着但正偏
            // 电压不够（蓝管接 3V）时，两端是一条断路的管子，写「R = 10Ω」
            // 会让学生以为它是个 10Ω 的电阻 —— 那正好是单向导电性最不该
            // 被误解成的东西。
            rec.R = rec.on ? LED_RS : null;
          } else {
            // 反向截止：没有支路。电压照样算得出来（两端节点的电位差），
            // 而且必须算 —— 读数框要写「反向 3.0V 截止」，那 3.0V 就是这个数。
            rec.i = 0;
            rec.v = nV(sol, N(0)) - nV(sol, N(1));
            rec.R = null;                                // 反向电阻无穷大
            rec.on = false;
          }
          rec.p = rec.v * rec.i;
          // 亮度按额定电流 20mA 归一：真实 LED 的亮度大致正比于电流，
          // 所以调到额定电流才「满亮」，过流会亮到发白（然后烧）。
          rec.brightness = Math.max(0, Math.min(rec.i / LED_I_RATED, 1.3));
          rec.overload = rec.i > LED_I_MAX;
          if (rec.overload) {
            warnings.push({ code: 'LED_OVER_CURRENT',
              message: '发光二极管电流超过 ' + (LED_I_MAX * 1000).toFixed(0) +
                       'mA，实际会烧掉 —— 串联一只限流电阻', componentIds: [c.id] });
          }
          break;
        }

        // 直流电动机。三个功率必须同时给出，因为「电能 → 机械能」这件事
        // 全靠它们的分配说清楚：输入 U·I = 机械 ε·I + 线圈发热 I²R。
        case 'motor': {
          var mbr = bs[0];
          var mp = paramsOf(c);
          rec.R = num(mp.Rcoil, MOTOR.R_DEF);
          rec.i = mbr ? bI(sol, mbr) : 0;               // 从「+」流入为正
          rec.v = mbr ? (nV(sol, mbr.p) - nV(sol, mbr.q)) : 0;
          var ms = motorState(mp, rec.v);
          rec.eps = mbr ? mbr.V : 0;                    // 迭代收敛后的反电动势
          rec.omega = ms.omega;                         // rad/s，符号 = 转向
          rec.rpm = rpmOf(ms.omega);
          rec.stalled = ms.stalled;
          rec.spinning = !ms.stalled && Math.abs(rec.i) > 1e-9;
          // 堵转开关是人为指定的，和「电压太低自己停转」要分开说：
          // 前者是「转子被卡住」，后者是「推不动」，读数框里写的字不一样。
          rec.stallSwitch = !!mp.stall;
          rec.p = rec.v * rec.i;                        // 输入电功率
          rec.pMech = rec.eps * rec.i;                  // 转成机械能的功率（≥0）
          rec.pHeat = rec.i * rec.i * rec.R;            // 线圈发热
          // 反接 = 反转。用「反转」而不是电表那套「反接」：电动机接反不是
          // 接错了线，是转子往反方向转 —— 这正是「通电导线在磁场中受力方向
          // 跟电流方向有关」那句话在实物上的样子。
          rec.reversed = rec.i < -1e-9;
          rec.reverseLabel = '反转';
          break;
        }

        // 电铃：纯电阻。方向不进任何一处 —— 这正是「电铃没有单向导电性」。
        case 'bell': {
          var bbr = bs[0];
          rec.R = num(P.Rcoil, 20);
          // ⚠️ 电阻支路的电流【必须用 v/R 算】，不能读 bI()：MNA 里 bI 只有
          // 电压源支路才有值，电阻支路一律回填 0（它们的电流是靠节点电位差
          // 隐含的）。照 bI 读的话，电铃的电流永远是 0、磁动势永远是 0、
          // 铃永远不响 —— 而且画面上电压读数还是对的，很难看出哪里错了。
          rec.v = bbr ? (nV(sol, bbr.p) - nV(sol, bbr.q)) : 0;
          rec.i = bbr ? rec.v / bbr.R : 0;
          rec.p = rec.v * rec.i;
          var bst = bellState(P, rec.i);
          rec.turns = bst.turns;
          rec.mag = bst.mag;                            // 磁动势（安匝）
          rec.rings = bst.rings;
          rec.volume = bst.volume;
          if (!bst.rings && Math.abs(rec.i) > 1e-9) {
            warnings.push({ code: 'BELL_TOO_WEAK',
              message: '电铃磁动势不足（' + bst.mag.toFixed(0) + ' 安匝 < ' +
                       BELL_MAG_MIN + '），衔铁吸不动、铃不响', componentIds: [c.id] });
          }
          break;
        }

        case 'ammeter': {
          // 没接量程柱 → 表头不在电路里（describeComponent 没产生支路），
          // 读数是 0，但 rec.range 仍要给个值供面板显示，所以退回参数值。
          rec.i = bs.length ? bI(sol, bs[0]) : 0;
          rec.R = P.rInternal || 0;
          rec.v = rec.R * rec.i;
          rec.p = rec.v * rec.i;
          rec.tapIdx = tapIdx;
          fillMeterRange(rec, c, tapIdx, P);
          // 两端没接全（缺量程柱或缺「−」柱）＝ 表头没进电路：读数一律抹 0。
          // 支路本身这时也是断的（悬空那一端没有别的元件，电流恒 0），抹一遍
          // 是把「解出来的 0」和「根本没接」两件事说成同一句话，免得将来
          // 支路拓扑一变就在这里漏出一个假读数。
          if (!rec.wired) { rec.i = 0; rec.v = 0; rec.p = 0; }
          rec.ideal = !P.rInternal;
          rec.reading = rec.i;
          rec.overRange = rec.rangeWired && Math.abs(rec.reading) > rec.range + 1e-12;
          rec.reversed = rec.i < -1e-9;
          if (rec.overRange) warnings.push({ code: 'METER_OVER_RANGE', message: '电流表超量程', componentIds: [c.id] });
          if (rec.reversed) warnings.push({ code: 'METER_REVERSED', message: '电流表正负接线柱接反', componentIds: [c.id] });
          warnMeterWiring(warnings, rec, c, tp, wired, '电流表');
          break;
        }

        case 'battery': {
          var bb = bs[0];
          // 烧坏的电源没有支路（describeComponent 提前返回了），bs 是空的。
          // 不判空的话这里会读 undefined.p 把整个求解器带崩 —— 而且崩在
          // 【修好之前】的每一帧上，页面直接白屏，看不出是电源坏了。
          if (!bb) {
            var P0 = paramsOf(c);
            rec.i = 0; rec.v = 0; rec.p = 0; rec.R = null;
            rec.emf = P0.emf != null ? P0.emf : 0;
            rec.rInternal = P0.rInt != null ? P0.rInt : 0;
            rec.cells = P0.cells;
            rec.iInternal = 0; rec.pTotal = 0; rec.pInternal = 0; rec.vDrop = 0;
            rec.reading = 0; rec.reversed = false;
            break;
          }
          rec.i = -bI(sol, bb);                            // Ik 是充电方向；放电 = −Ik
          rec.v = nV(sol, bb.p) - nV(sol, bb.q);
          rec.emf = bb.V;
          rec.rInternal = bb.Rs;
          rec.R = bb.Rs;
          rec.cells = P.cells;
          rec.iInternal = rec.i;
          rec.p = rec.v * rec.i;                           // 输出功率
          rec.pTotal = bb.V * rec.i;                       // 总功率（含内阻损耗）
          rec.pInternal = rec.i * rec.i * bb.Rs;
          rec.vDrop = rec.i * bb.Rs;                       // 内阻分压
          rec.reading = rec.v;
          rec.reversed = rec.i < -1e-9;
          if (Math.abs(rec.i) > opts.shortCurrent) {
            shorted = true;
            warnings.push({ code: 'SHORT_CIRCUIT', message: '电路短路！电流过大', componentIds: [c.id] });
          }
          break;
        }

        case 'rheostat': {
          var slide = clamp01(P.slide);
          rec.slide = slide; rec.Rmax = P.Rmax;
          // 接法识别（教学关键量）：看哪些端子真正接了外部导线
          rec.mode = detectRheostatMode(c, topo, usedBranches, components);
          var segs = [];
          bs.forEach(function (b) {
            if (b.kind === 'V') {
              segs.push({ R: 0, v: 0, i: bI(sol, b), isShort: true });
              return;
            }
            var vv = nV(sol, b.p) - nV(sol, b.q);
            segs.push({ R: b.R, v: vv, i: vv / b.R, isShort: false });
          });
          rec.segments = segs;
          var carry = segs.filter(function (s) { return Math.abs(s.i) > 1e-12; });
          if (carry.length) {
            rec.rUsed = carry.reduce(function (a, s) { return a + s.R; }, 0);
          } else {
            // 无电流段：C-D 接法 = 电流只走金属杆，电阻丝整根空着 ⇒ 接入 0Ω
            //（初中经典错误接法，必须给出 0 而不是 null）
            rec.rUsed = (rec.mode === 'C-D') ? 0 : null;
          }
          // 对外一律用「接入部分」这一等效电阻的幅值表述，保证 v = i·R_used、p = v·i
          // 三者自洽（四端元件的段间正负号对教学毫无意义，只会让 UI 显示错）。
          rec.i = segs.reduce(function (a, s) { return Math.max(a, Math.abs(s.i)); }, 0);
          rec.v = (rec.rUsed == null) ? 0 : rec.i * rec.rUsed;
          rec.p = rec.v * rec.i;
          break;
        }
      }

      rec.v = fin(rec.v, 0); rec.i = fin(rec.i, 0); rec.p = fin(rec.p, 0);
      if (Math.abs(rec.i) > 1e-12) anyCurrent = true;
      comp[c.id] = rec;
    });

    // ---- 节点电压 ----
    var nodeVObj = {};
    sol.nodeV.forEach(function (v, k) {
      if (!Number.isFinite(v)) { out.degraded = true; v = 0; }
      nodeVObj[k] = v;
    });
    out.nodeV = nodeVObj;
    out.components = comp;

    out.islands = islands.map(function (is) {
      var nodes = [], ids = [];
      is.branches.forEach(function (b) {
        if (nodes.indexOf(b.p) < 0) nodes.push(b.p);
        if (nodes.indexOf(b.q) < 0) nodes.push(b.q);
        if (ids.indexOf(b.comp.id) < 0) ids.push(b.comp.id);
      });
      return { hasSource: is.hasSource, nodeIds: nodes, componentIds: ids };
    });

    // ---- 短路（拓扑判据，见 shortedBatteryIds）----
    // 放在这里而不是 status 判定里：status 只回答「电路通不通」，而短路是
    // 「通得太厉害」——两者要分开报。status 的计算逻辑一个字没动，
    // 短路另开一个字段，免得动摇了既有的用例。
    out.shortCircuit = { compIds: shortedBatteryIds(components, usedBranches, topo.termNode) };

    // ---- 状态判定 ----
    if (shorted) out.status = 'shorted';
    else if (anyCurrent) out.status = 'ok';
    else if (!components.some(function (c) { return c.type === 'battery'; })) out.status = 'no-source';
    else out.status = 'open-circuit';

    out.stats = {
      nodeCount: topo.nodeCount,
      branchCount: usedBranches.length,
      matrixSize: sol.matrixSize || 0,
      solveMs: +(now() - t0).toFixed(3),
    };
    return out;
  }

  // 滑动变阻器接法识别：看哪几个接线柱真的接到了别的元件上。
  // 返回的字符串直接就是教材上的叫法（一个上柱 + 一个下柱 = 一上一下）：
  //   A-C / A-D → 接入滑片左边那段（R = Rmax·slide）
  //   B-C / B-D → 接入滑片右边那段（R = Rmax·(1−slide)）
  //   A-B       → 两个下柱：整根电阻丝接入，滑片不起作用（R = Rmax，与滑片无关）
  //   C-D       → 两个上柱：只有金属杆，R = 0
  function detectRheostatMode(comp, topo, branches, components) {
    var S = topo.termNode[comp.id + ':2'];   // C/D 同为金属杆端，合并成滑片节点
    var A = topo.termNode[comp.id + ':0'];   // 电阻丝左端
    var B = topo.termNode[comp.id + ':1'];   // 电阻丝右端
    var aWired = false, bWired = false, sWired = false;
    for (var i = 0; i < components.length; i++) {
      if (components[i] === comp) continue;
      var ot = TYPES[components[i].type].terminals;
      for (var t = 0; t < ot; t++) {
        var nd = topo.termNode[components[i].id + ':' + t];
        if (nd === A) aWired = true;
        if (nd === B) bWired = true;
        if (nd === S) sWired = true;
      }
    }
    if (sWired && aWired && !bWired) return 'A-C';
    if (sWired && bWired && !aWired) return 'B-C';
    if (sWired && aWired && bWired) return 'A-B+C';
    if (!sWired && aWired && bWired) return 'A-B';
    if (sWired && !aWired && !bWired) return 'C-D';
    return 'open';
  }

  function fillLamp(rec, c, P) {
    var pp = lampParams(c);
    rec.Rcold = pp.Rcold; rec.Rhot = pp.Rhot;
    rec.ratedV = pp.ratedV; rec.ratedW = pp.Prated;
    rec.tempDependent = pp.tempDependent;    // 面板要靠它显示那个勾选框的状态
    rec.brightness = Math.max(0, Math.min(rec.p / pp.Prated, 1.3));
    rec.overload = rec.p > 1.3 * pp.Prated;
    rec.R_selfCheck = lampRAt(pp, rec.p);
  }

  // 表头量程字段：量程由【导线接在哪个量程柱上】决定，参数里的 range
  // 只在没接量程柱时充当显示值。rangeWired 是「这个量程真的能用」的标记，
  // 超量程判定必须挂在它上面——没接线的表读数是 0，不能拿参数值去判。
  function fillMeterRange(rec, c, tapIdx, P) {
    var rng = rangeValueOf(c.type, tapIdx);
    rec.tapIdx = tapIdx;
    rec.rangeWired = rng != null;
    rec.range = rng != null ? rng : P.range;
    // wired = 「表头真的串进电路了」。三柱表要【两个柱都接上】才算：
    // 只接量程柱时表读的是悬空节点对地的电位，只接「−」柱时读数恒 0，
    // 两种都不是一次测量。读数、反接、超量程判定统统挂在它上面。
    rec.wired = rec.rangeWired && rec.commonWired !== false;
  }

  // 表头接线的三种「不报错、但学生一定做错了」的情况：
  //   · 两个量程柱同时接 —— 编辑器当场拒绝并提示，这里是手写场景的兜底；
  //   · 只接了「−」柱 —— 表头根本没进电路，读数恒 0；
  //   · 只接了量程柱 —— 更坏：另一头悬空，理想电压表会把悬空节点当成 0V，
  //     读出一个像模像样的电路节点电位，学生完全看不出表没接进去。
  // 三种都必须说出来，否则学生只看到「指针一动不动」或「读数怪怪的」，
  // 却不知道是自己少接了一根线。
  function warnMeterWiring(warnings, rec, c, tp, wired, name) {
    if (tp && tp.conflict) {
      warnings.push({
        code: 'METER_RANGE_CONFLICT',
        message: name + '两个量程接线柱同时接入，只能用一个量程',
        componentIds: [c.id],
      });
    }
    var hasCommon = wired.has(c.id + ':' + TYPES[c.type].commonTerm);
    if (rec.rangeWired && !hasCommon) {
      warnings.push({
        code: 'METER_NO_COMMON',
        message: name + '只接了量程柱，「−」柱上还得接一根线',
        componentIds: [c.id],
      });
    }
    if (!rec.rangeWired && hasCommon) {
      warnings.push({
        code: 'METER_NO_RANGE',
        message: name + '只接了「−」柱，量程柱上还得接一根线',
        componentIds: [c.id],
      });
    }
  }

  // 电压表的读数/量程字段。理想电压表（无支路）和有内阻的电压表都要走这里，
  // 否则「理想电压表读数为 undefined」这种 bug 会从画布上冒出来。
  // warnings 必须由调用方传进来：这是模块级函数，够不到 solve() 里的局部
  // 数组。原先这里直接写 warnings.push(...)，只要出现一次「电压表超量程或
  // 接反」就抛 ReferenceError 把整个求解器带崩——测试里一直没触发，纯属
  // 那几个用例的电压表恰好都没超量程。
  function fillVoltmeter(rec, c, P, tapIdx, warnings) {
    fillMeterRange(rec, c, tapIdx, P);
    // ⚠️ 表头【两端都接上】才真的在电路里。缺一根柱子时另一端悬空，上面算出的
    // rec.v 是拿幽灵 0V 当参考读出来的（用户实测：电压表只连一个量程柱就有
    // 示数）。抹成 0，而且不判反接/超量程——那都是「表在电路里」才有的现象。
    if (!rec.wired) { rec.v = 0; rec.i = 0; rec.p = 0; }
    rec.reading = rec.v;
    rec.ideal = !(P.rInternal > 0);
    rec.overRange = rec.rangeWired && Math.abs(rec.reading) > rec.range + 1e-12;
    rec.reversed = rec.v < -1e-9;
    if (rec.overRange) warnings.push({ code: 'METER_OVER_RANGE', message: '电压表超量程', componentIds: [c.id] });
    if (rec.reversed) warnings.push({ code: 'METER_REVERSED', message: '电压表正负接线柱接反', componentIds: [c.id] });
  }

  function bI(sol, branch) { var v = sol.bI.get(branch); return v == null ? 0 : v; }
  function nV(sol, node) { var v = sol.nodeV.get(node); return v == null ? 0 : v; }
  function fin(v, d) { return Number.isFinite(v) ? v : (d || 0); }
  function now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  // ============================================================
  // 导线电流分布
  // ============================================================
  // 因为并查集把每根导线的两端并成了同一个电气节点，MNA 解出来的是
  // 「节点电位 + 元件支路电流」，**没有单根导线的电流**——每根导线都是
  // 节点内部的一条边。可画面上要显示电流粒子往哪边跑，就得把它算出来。
  //
  // 办法：在一个节点内部，各元件端子注入节点的电流是已知的（解里直接有）。
  // 导线构成一张图，反复剥掉度为 1 的顶点：它只有一条边，注入多少就得
  // 全部从这条边流走，KCL 直接给出这根导线的电流；把这份电流「推」给对面
  // 顶点后，对面度数减一，可能又变成叶子，继续剥。剩下的环（罕见）按边均分。
  //
  // 返回：与 wires 等长的数组，元素是这根导线的电流（正 = 从 a 端流向 b 端）。
  // wired：有导线挂在上面的端子集合（"compId:termIdx"）。只有变阻器用得到。
  function terminalInjection(comp, rec, termIdx, wired) {
    if (!rec || !Number.isFinite(rec.i) || !comp) return 0;
    if (comp.type === 'rheostat') {
      // 变阻器不是「两端元件」，它内部是 C-D 金属杆短接成滑片节点 S，
      // 外加 A→S、S→B 两个半段电阻。整体 rec.i 在这里没有意义，
      // 必须按半段算：segs[0] 的电流从 A 流向 S，segs[1] 从 S 流向 B。
      var segs = rec.segments;
      if (!segs || segs.length < 2) return 0;
      if (termIdx === 0) return -segs[0].i;   // A：电流流进元件，注入节点为负
      if (termIdx === 1) return segs[1].i;    // B：电流从元件流出，注入节点为正
      // C(2)/D(3) 挂在同一个滑片节点上，KCL 给出两者注入之和：
      //   inj_C + inj_D = −(segs[1].i − segs[0].i)
      // 这个负号是关键。segs[1].i − segs[0].i 由滑片节点 S 的 KCL 推出来，
      // 它等于「从 C 端【流入】元件的电流」；而本函数的契约是「流出元件、
      // 注入节点」，方向正好相反，所以必须取负。
      //
      // 漏掉这个负号的后果很隐蔽：剥叶子时哪个端子先被剥，取决于导线是
      // 从哪端开始写的。接 C 的那根线若写成「E → C」（a 端是 E），先剥 E，
      // 结果是对的；写成「C → E」先剥 C，用上这个注入量，这根线的电流就
      // 整个反号——屏幕上就是【这一段和其它段的粒子反向跑】。
      // 两者各分多少，解里是定不下来的（同一节点的两根引线）。
      // 实际接线只用一个，所以按「谁真的接了线」分配：只接一个就全给它，
      // 两个都接（少见，等于把同一根杆引到两处）才平分。
      if (termIdx !== 2 && termIdx !== 3) return 0;
      var total = segs[0].i - segs[1].i;      // 从 C 端【流出】元件的电流
      var cWired = wired ? wired.has(comp.id + ':2') : false;
      var dWired = wired ? wired.has(comp.id + ':3') : false;
      if (cWired && !dWired) return (termIdx === 2) ? total : 0;
      if (dWired && !cWired) return (termIdx === 3) ? total : 0;
      return total / 2;
    }
    // 三柱表头（电流表/电压表）：电流只从【实际接了线的那个量程柱】流进，
    // 从「−」柱流出，另一个量程柱悬空——它在电路外面，注入恒 0。
    // 不能落到下面那个 `(termIdx === 0) ? out : -out` 的兜底上：那个式子
    // 把端子 2 当成端子 1，会让两个量程柱同时往外吐电流（凭空多一倍）。
    var MT = TYPES[comp.type];
    if (MT && MT.rangeTaps) {
      var mw = wired || new Set();
      var on = MT.rangeTaps.filter(function (t) { return mw.has(comp.id + ':' + t); });
      if (on.length === 0) return 0;                 // 没接量程柱 = 表头不在电路里
      if (termIdx === on[0]) return -rec.i;          // 量程柱：电流流进表头
      if (termIdx === MT.commonTerm) return rec.i;   // 「−」柱：电流流出表头
      return 0;
    }
    // 电池的记录沿用了「支路电流 Ik = 充电方向」的约定，放电是 −Ik，
    // 别的元件 rec.i 是放电方向。这里统一成「流出元件、注入节点」。
    var out = (comp.type === 'battery') ? rec.i : -rec.i;
    return (termIdx === 0) ? out : -out;
  }

  // 剥叶子剥不动了：节点内部的导线绕成了环（一个度为 1 的顶点都没有）。
  // 这时每根线各承担多少在物理上【本来就不定】——理想导线 0Ω，任何分配
  // 都同样满足 KCL。所以取最小二乘解，等价于把这组导线当成等电阻网络
  // 求各顶点电位、再取电位差（相位差为零的那部分电流不显示，符合直觉）。
  //
  // 原先这里按 (s[ka] − s[kb]) / 2 硬凑，两个毛病都会让画面出错：
  //   · 两根线并接在同一对端子上（学生常画的冗余线）时，每根都报整份电流，
  //     加起来是实际的两倍；
  //   · 那个值随导线是从哪端开始写的而变号——同一对端子上就会出现
  //     「一根朝左、一根朝右」，正是「某一段方向和其它段相反」。
  // edges: [{ u, v, wi }]，u 恒为这根导线的 a 端。s 是各顶点注入量。
  function ringFlow(verts, edges, s) {
    var out = new Array(edges.length).fill(0);
    var i;
    // 按连通分量分别解：几组互不相连的环放在一个矩阵里会奇异
    var dsu = createDSU();
    edges.forEach(function (e) { dsu.union(e.u, e.v); });
    var groups = new Map();
    edges.forEach(function (e, k) {
      var r = dsu.find(e.u);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(k);
    });
    groups.forEach(function (ks) {
      var vs = [];
      ks.forEach(function (k) {
        [edges[k].u, edges[k].v].forEach(function (v) { if (vs.indexOf(v) < 0) vs.push(v); });
      });
      var n = vs.length;
      if (n < 2) return;                     // 自环线：两端同一个端子，电流恒 0
      var m = n - 1;                          // 末位顶点接地，消掉拉普拉斯矩阵的零空间
      var li = {};
      vs.forEach(function (v, j) { li[v] = j; });
      var A = [], z = new Array(m);
      for (i = 0; i < m; i++) { A.push(new Array(m).fill(0)); z[i] = s[vs[i]]; }
      var ok = true;
      ks.forEach(function (k) {
        var a = li[edges[k].u], b = li[edges[k].v];
        if (a === b) { ok = false; return; }  // 自环
        if (a < m) { A[a][a] += 1; if (b < m) { A[a][b] -= 1; } }
        if (b < m) { A[b][b] += 1; if (a < m) { A[b][a] -= 1; } }
      });
      if (!ok) return;
      var phi = solveLinear(A, z, m);
      if (!phi) return;                       // 解不出来就留 0（宁可不动，也别反向）
      var val = {};
      vs.forEach(function (v, j) { val[v] = j < m ? phi[j] : 0; });
      ks.forEach(function (k) {
        // 沿 u→v 方向流出的电流 = 两端电位差。u 就是 a 端，
        // 所以这个值直接就是「正 = 从 a 流向 b」。
        out[k] = val[edges[k].u] - val[edges[k].v];
      });
    });
    return out;
  }

  function wireCurrents(scene, res) {
    var wires = (scene && scene.wires) || [];
    var flow = new Array(wires.length);
    for (var z = 0; z < wires.length; z++) flow[z] = 0;
    if (!res || !res.terminalNode || !res.components) return flow;

    var compById = {};
    (scene.comps || []).forEach(function (c) { compById[c.id] = c; });

    // 哪些端子上真的挂了导线。变阻器的 C/D 是同电位的一对引线，
    // 不区分「接的是哪一个」就无法把注入量分对（见 terminalInjection）。
    // 悬空端（compId 为 null）跳过 —— 它会造出 "null:0" 这个不存在的端子名。
    var wired = new Set();
    wires.forEach(function (wr) {
      if (wr && wr.a && wr.a.compId != null) wired.add(wr.a.compId + ':' + wr.a.termIdx);
      if (wr && wr.b && wr.b.compId != null) wired.add(wr.b.compId + ':' + wr.b.termIdx);
    });

    // 按电气节点分组，每组内只放「两端确实同节点」的导线
    var groups = new Map();
    wires.forEach(function (wr, i) {
      // 悬空端：这一头没接在任何元件上，导线在那里断了 —— 它不参与分流，
      // 电流恒为 0（flow[i] 保持初值）。判在拼接字符串之前，别让 "null:0"
      // 混进 res.terminalNode 的查表里。
      if (!wr || !wr.a || !wr.b || !wr.a.compId || !wr.b.compId) return;
      var ka = wr.a.compId + ':' + wr.a.termIdx, kb = wr.b.compId + ':' + wr.b.termIdx;
      var na = res.terminalNode[ka], nb = res.terminalNode[kb];
      if (na == null || nb == null || na !== nb) return;   // 不是节点内导线（跨节点或未接线）
      if (!groups.has(na)) groups.set(na, { s: {}, deg: {}, adj: {}, live: {} });
      var g = groups.get(na);
      [ka, kb].forEach(function (k) {
        if (!(k in g.s)) { g.s[k] = 0; g.deg[k] = 0; g.adj[k] = []; }
      });
      g.adj[ka].push({ wi: i, other: kb, isKa: true });
      g.adj[kb].push({ wi: i, other: ka, isKa: false });
      g.deg[ka]++; g.deg[kb]++; g.live[i] = true;
    });

    groups.forEach(function (g) {
      Object.keys(g.s).forEach(function (k) {
        var p = k.split(':');
        g.s[k] = terminalInjection(compById[p[0]], res.components[p[0]], +p[1], wired);
      });
    });

    groups.forEach(function (g) {
      var queue = Object.keys(g.s).filter(function (k) { return g.deg[k] === 1; });
      while (queue.length) {
        var v = queue.shift();
        if (g.deg[v] !== 1) continue;
        var e = null;
        for (var j = 0; j < g.adj[v].length; j++) {
          if (g.live[g.adj[v][j].wi]) { e = g.adj[v][j]; break; }
        }
        if (!e) { g.deg[v] = 0; continue; }
        flow[e.wi] = e.isKa ? g.s[v] : -g.s[v];
        g.live[e.wi] = false;
        g.deg[v] = 0; g.deg[e.other]--;
        g.s[e.other] += g.s[v];
        if (g.deg[e.other] === 1) queue.push(e.other);
      }
      // 剩下的成环：交给最小二乘解法
      var rest = Object.keys(g.live).filter(function (i) { return g.live[i]; }).map(Number);
      if (!rest.length) return;
      var ringEdges = rest.map(function (i) {
        var wr2 = wires[i];
        return {
          u: wr2.a.compId + ':' + wr2.a.termIdx,
          v: wr2.b.compId + ':' + wr2.b.termIdx,
          wi: i,
        };
      });
      var ringOut = ringFlow(
        Object.keys(g.deg).filter(function (k) { return g.deg[k] > 0; }),
        ringEdges, g.s);
      rest.forEach(function (i, k) { flow[i] = ringOut[k]; });
    });

    return flow;
  }

  // ============================================================
  // 损坏判定（纯函数）
  // ------------------------------------------------------------
  // 输入【当前这一帧的解】，输出【本帧应当新发生的损坏】。不写场景、不碰界面，
  // 所以可以单独测、也可以单独改坏 —— 这是把「什么时候坏」和「坏了怎么显示」
  // 分成两件事：绘制层只管照着 comp.fault 画，判据全在这里。
  //
  // 返回 { comps: [{id, fault, why}], wires: [导线下标] }。
  // ⚠️ 调用方拿到结果【写进场景后必须重新求解】：灯丝一断、导线一熔，电路
  //    拓扑就变了，下一轮的判定要基于新的解。所以这一步要迭代着做
  //    （见页面 checkDamage），而且要有迭代上限 —— 否则可能自己咬自己。
  // ============================================================
  function faultsOf(components, wires, results, flows) {
    var outC = [], outW = [];
    if (!results || !results.components) return { comps: outC, wires: outW };
    components = components || []; wires = wires || [];

    components.forEach(function (c) {
      if (c.fault) return;                       // 已经坏了，不重复报
      var r = results.components[c.id];
      if (!r) return;
      if (c.type === 'bulb') {
        // 灯丝是被 I²R 烧断的，所以判据用【实际功率 / 额定功率】的倍数，
        // 而不是电压倍数（灯丝电阻随功率涨，两个倍数不是一回事）。
        // ⚠️ 不能用 r.overload：内核里那个门槛是 1.3 倍，只是提示「过载」，
        //    比烧断低 —— 拿它当烧断判据，灯泡会在该亮的时候提前断。
        if (r.ratedW > 0 && r.p > BULB_BURN_K * r.ratedW) {
          outC.push({ id: c.id, fault: 'burned',
            why: '实际功率 ' + r.p.toFixed(2) + 'W 超过额定 ' + r.ratedW +
                 'W 的 ' + BULB_BURN_K + ' 倍，灯丝烧断' });
        }
      } else if (c.type === 'led') {
        // 用【烧毁门槛】而不是 r.overload：那是 25mA 的过载提示门槛，比烧断低，
        // 拿它当烧断判据的话，正常接法（绿管 + 100Ω 在 6V 上 35mA）也会烧。
        // 原因里带上烧毁前的那个电流 —— 烧掉之后 rec.i 已经是 0，那个数再也
        // 读不回来了，而它正是「过流多少才烧」这个问题的答案。
        if (Math.abs(r.i) > LED_BURN_I) {
          outC.push({ id: c.id, fault: 'burned',
            why: '电流 ' + (Math.abs(r.i) * 1000).toFixed(1) + 'mA 超过烧毁门槛 ' +
                 (LED_BURN_I * 1000).toFixed(0) + 'mA（额定 ' +
                 (LED_I_MAX * 1000).toFixed(0) + 'mA 的三倍），管子烧毁' });
        }
      } else if (c.type === 'ammeter' || c.type === 'voltmeter') {
        // 只对【真的接进电路】的表判：没接线的表读数恒 0，谈不上超量程或反接。
        if (!r.wired) return;
        if (r.overRange) {
          outC.push({ id: c.id, fault: 'over',
            why: '读数超过量程 ' + r.range + (c.type === 'ammeter' ? 'A' : 'V') +
                 '，指针向右打表损坏' });
        } else if (r.reversed) {
          outC.push({ id: c.id, fault: 'rev', why: '正负接线柱接反，指针向左打表损坏' });
        }
      }
    });

    // ── 短路：熔断导线 + 烧坏电源 ─────────────────────────────
    // 真实的短路保护就靠这个顺序：导线（保险丝）先断，电源保住；导线粗到
    // 扛住了，电流就全砸在电源上。所以这里不是「二选一」，而是两条各自成立
    // 的判据 —— 默认那台电源（3V/1Ω → 3A）够不着 5A，于是断的只是导线。
    var sc = results.shortCircuit;
    if (sc && sc.compIds && sc.compIds.length) {
      var best = -1, bestI = 0;
      for (var i = 0; i < wires.length; i++) {
        if (wires[i].broken) continue;
        var a = Math.abs((flows && flows[i]) || 0);
        if (a > bestI) { bestI = a; best = i; }
      }
      // 熔断【电流最大的那一根】。真实电路里先断的就是它（保险丝、最细那段），
      // 而且这么选有唯一答案 —— 可断言，不是「随便挑一根」。
      if (best >= 0) outW.push(best);
      // 电流大到电源自己扛不住 → 烧电源。!results.ok 是【理想电源被短接】：
      // 电流无穷大，方程解不出来，那是最严重的一种，同样要烧。
      if (!results.ok || bestI > BATT_MAX_I) {
        sc.compIds.forEach(function (id) {
          if (outC.some(function (x) { return x.id === id; })) return;
          outC.push({ id: id, fault: 'burnt', why: '被短路，电流过大烧坏' });
        });
      }
    }
    return { comps: outC, wires: outW };
  }

  return {
    TYPES: TYPES,
    defaultParams: defaultParams,
    lampParams: lampParams,
    lampRAt: lampRAt,
    solve: solve,
    wireCurrents: wireCurrents,
    // 「这个端子往节点里注入多少电流」。导出是为了让测试能独立验 KCL，
    // 从而钉死每根导线的电流方向（画面上电流粒子往哪边跑全靠它）。
    terminalInjection: terminalInjection,
    // 三个新元件的物理常量与状态函数。导出是给测试用的：断言要能拿【同一份】
    // 正向压降、吸合磁动势去对账，而不是在测试里再抄一遍数字 —— 抄一份就等于
    // 把「实现改了、测试还绿」这个洞留着。
    LED_COLORS: LED_COLORS,
    LED_RS: LED_RS,
    LED_I_RATED: LED_I_RATED,
    LED_I_MAX: LED_I_MAX,
    LED_BURN_I: LED_BURN_I,
    ledColorOf: ledColorOf,
    ledConducts: ledConducts,
    MOTOR: MOTOR,
    motorState: motorState,
    rpmOf: rpmOf,
    BELL_MAG_MIN: BELL_MAG_MIN,
    bellState: bellState,
    // 损坏模型：常量 + 判定。页面只写场景、不写判据 —— 判据留在这里才能
    // 单独测（也可以在负向对照里单独改坏）。
    faultsOf: faultsOf,
    FAULT_LABEL: FAULT_LABEL,
    faultLabel: faultLabel,
    isOpenFault: isOpenFault,
    BULB_BURN_K: BULB_BURN_K,
    BATT_MAX_I: BATT_MAX_I,
    version: '1.2.0',
  };
});
