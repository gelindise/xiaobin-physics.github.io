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
    // ── 导体板（探究电阻的影响因素）────────────────────────
    // 一块贴在小木板上的金属条，两个接线柱。它把「电阻的大小与材料、长度、
    // 横截面积有关」这句话变成三个能拧的旋钮：材料（换 ρ）、长度 L、
    // 横截面积 S，R = ρ·L/S —— 正是课本那条决定式。
    // 电器上就是一个普通电阻支路（没有温度系数、没有极性）：变的只是
    // 参数而不是拓扑，所以它和 resistor 共用 addR 这条支路。
    // 端子与定值电阻相同（±HALF），3D 里画成「板 + 金属条 + 尺寸标注」。
    plate: {
      label: '导体板', terminals: 2, termNames: ['a', 'b'],
      defaults: { material: 'nichrome', length: 1, section: 0.5 },
    },
    // ── 电阻示教板（探究影响导体电阻大小的因素）────────────────────
    // 用户 2026-10-19：「导体板…上面有几条电阻丝…把那个整体放到器材盒里，
    // 而不是放一根导体板」—— 原来那块 plate 只有一根金属条、靠三个滑条调
    // 材料 / 长度 / 截面，做对照实验要反复拧滑条，太麻烦。教材上这块板是
    // 【四根现成的丝】：换一根只要把两根导线挪到另一对柱子上，「只变一个
    // 因素」就变成一次接线动作，而不是三次拖滑条。
    //
    // 四根丝的规格是【两两对照】设计的（每次只变一个因素）：
    //   ① 镍铬 φ0.30 1.0m → 14.1Ω   ← 基准
    //   ② 镍铬 φ0.30 0.5m →  7.1Ω   ← 与①比【长度】（长度减半、阻值减半）
    //   ③ 镍铬 φ0.50 1.0m →  5.1Ω   ← 与①比【横截面积】（加粗、阻值变小）
    //   ④ 锰铜 φ0.30 1.0m →  6.2Ω   ← 与①比【材料】（锰铜 ρ 小、阻值小）
    // 阻值一律由 ρ·L/S 现算（见 PLATE_WIRES），不在这里写死。
    //
    // 🔴 端子 2i / 2i+1 是第 i 根丝的两端（i = 0..3）—— 这个编号是
    //    describeComponent / 回填 / 绘制 / 接线柱四处共用的唯一约定，
    //    改一处就得四处一起改。
    // 🔴 单独一个类型、不去改造 plate：3D 沙盒的器材盒里还有 plate
    //    （circuit-3d-kit 的 builder 只认两端子），改了它 3D 页当场崩。
    rheoboard: {
      label: '电阻示教板', terminals: 8,
      termNames: ['1a', '1b', '2a', '2b', '3a', '3b', '4a', '4b'],
      // showSpec = 板面上印不印每根丝的规格（材料 / 直径 / 长度）。
      // 关掉只留序号 —— 做「盲测」用：让学生自己按电流大小判断哪根阻值大。
      defaults: { showSpec: true },
    },
    // ── 铅笔芯（课本「用铅笔芯控制小灯泡的亮度」）──────────────
    // 一根自动铅笔芯架在板上：左端一个夹子固定，另一个夹子沿芯移动。
    // 接进电路的是【两个夹子之间】那一段，R = ρ·L/S —— L 就是夹子间距。
    // 所以它和滑动变阻器不是一回事：变阻器改的是滑片在整根电阻丝上的
    // 分压比，铅笔芯改的是【导体本身的长度】，正是课本那句
    // 「导体的电阻跟它的长度有关」的实物入口。
    //   端子 0 = 左端固定夹；端子 1 = 右端接线柱（经软线连到移动夹）。
    // 参数：
    //   len   接入长度（mm，10~120）。全长 120mm = 长款自动铅笔芯（市面有
    //         60 / 90 / 120 三种，这里取最长的一款：夹子行程翻倍，同样的
    //         拖动距离对应双倍的电阻变化，灯从亮到暗更看得出来）；
    //         夹子往左推 ⇒ 接入变短 ⇒ R 变小 ⇒ 灯变亮。
    //   grade 型号（HB / 2B / 6B）。型号 = 石墨与黏土的比例，越软石墨越多、
    //         电阻率越小 —— 这是「电阻还跟材料有关」的入口。
    pencil: {
      label: '铅笔芯', terminals: 2, termNames: ['a', 'b'],
      // 默认 20mm（R ≈ 5.6Ω）：一进来灯【明显是亮的】（约 0.4W）—— 电路通不通
      // 学生第一眼就要看出来。往右还有 100mm 行程，灯能一路暗到几乎不灭；
      // 往左到 10mm 还能再亮一档（0.62W）。取全长中点（60mm）的话灯只有
      // 0.10W，一进来像没接好，所以默认值不放在正中。
      defaults: { len: 20, grade: 'HB' },
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
    // ── 学生电源 ──────────────────────────────────────────────
    // 实验室里那台【输出电压可调】的直流稳压电源（J1202 那一类）：面板上一个
    // 电压旋钮、一只电压指示表、红黑两个接线柱。
    //
    // 和干电池在【电路上】完全一样（都是「电动势串内阻」的电压源，见
    // describeComponent 里并在一起的那两个 case），区别只有两条：
    //   · 可调范围：干电池只有 1.5V 的整数倍（1~5 节），学生电源 1.5~15V
    //     连续可调 —— 这就是用户要的「电源电压是可调的」；
    //   · 稳压程度：学生电源是稳压源，负载变了输出电压几乎不动，所以内阻
    //     默认 0；干电池一节 0.5Ω，接上小电阻就会掉压。
    // 之所以另立一个类型而不是给 battery 加个开关：外观（台仪器 vs 一节干
    // 电池）和默认参数都不同，而【默认参数是按类型查表的】——共用类型就只能
    // 二选一，另一种的默认值会跟着错。
    power: {
      label: '学生电源', terminals: 2, termNames: ['+', '-'],
      // on = 面板上那颗【电源开关】。默认合上（true），关掉就整台机器不输出
      // —— 和断开一个开关完全同构（见 buildBranches 的 battery/power 分支）。
      // 默认值必须是 true 而不是 undefined：参数面板上那个勾选框读的是
      // defaultParams()，给 undefined 的话新放的电源一上来就显示成「关着的」，
      // 而电路其实通着 —— 面板和电路自相矛盾。
      defaults: { emf: 6, rInt: 0, on: true },
    },
    switch: {
      label: '开关', terminals: 2, termNames: ['a', 'b'],
      defaults: { closed: false },
    },
    // ── 单刀双掷开关（人教版「楼梯开关」里的那一只）──────────────
    // 三个接线柱排成一行：左 = 掷 1、中 = 公共（刀片的转轴）、右 = 掷 2。
    // 刀片当下搭在哪一侧，公共端就与哪一侧导通 —— 「单刀双掷」四个字的
    // 全部电气内容就是这一句。
    //
    // 🔴 它和普通开关最要紧的差别：**没有「断开」这一档**。刀片永远搭在
    //    某一侧（真实的单刀双掷开关也是这样：它是个「选择通到哪一头」的
    //    开关，不是「通 / 断」的开关）。所以默认值不是 closed:false，而是
    //    一个掷位 throw；参数面板上也只有「掷 1 / 掷 2」两个按钮。
    //    教材里它成对出现在楼梯开关那道题上：楼上楼下各一只，任何一只
    //    都能点亮 / 熄灭同一盏灯 —— 靠的正是「两边各自选一头」。
    //
    // 端子下标【必须】照实物从左到右排（和表头同一条约定）：左柱是掷 1
    // （端子 0）、中柱是公共（端子 1）、右柱是掷 2（端子 2）。绕线、避让、
    // 命中框全按这个排布算，反了就是「图上是左、电气上通右」。
    spdt: {
      label: '单刀双掷开关', terminals: 3, termNames: ['1', 'C', '2'],
      defaults: { throw: 1 },
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
      // zeroed = 【调零】状态（指针此刻到底调没调）。调零只改指针的画法
      // （见 drawMeter 的 ZERO_OFF）和示数，不改求解出来的读数：读数本身是
      // 电路的事，调零是仪器的事。
      //
      // 🔴🔴 2026-10-17 用户第 3 点：默认改成【已调零】。老师上课要的是
      //   「接上就有对的读数」，而不是每只表都得先点两下调零。
      //   zeroMode 是面板上那一行三选一（on = 已调零 / off = 未调零 /
      //   rand = 随机），它只是【怎么定 zeroed】的入口：
      //     · on  → zeroed 恒 true；
      //     · off → zeroed 恒 false；
      //     · rand → 建这台表的那一刻掷一次硬币，结果写进 zeroed 并【冻住】
      //              （每次渲染都重新掷的话，指针会一帧一个样）。
      //   真正的判据永远只看 zeroed —— 求解器、警告、放大镜全走它，
      //   不认 zeroMode，免得「面板上写已调零、指针却偏着」。
      defaults: { range: 0.6, rInternal: 0, zeroed: true, zeroMode: 'on' },
    },
    voltmeter: {
      label: '电压表', terminals: 3, termNames: ['-', '3', '15'],
      commonTerm: 0, rangeTaps: [1, 2], rangeValues: [3, 15],
      // rInternal = null 表示理想电压表（完全开路、不分流，初中标准模型）
      defaults: { range: 3, rInternal: null, zeroed: true, zeroMode: 'on' },
    },
    // ── 灵敏电流计（J0409 那一类：中心零、可双向偏转）──────────────
    // 和电流表最要紧的差别只有一条：【刻度零点在正中】。所以电流从哪一头流
    // 进来，指针就往哪一边偏 —— 反向偏转是它的正常工作状态，不是「接反」。
    // 这一条决定了三件事，改任何一件都要三处一起看：
    //   · 只有【两个】接线柱（教材图上就是左黑右红），没有量程柱，满偏由参数给；
    //   · 内核【不判 reversed】—— 电流表那套「反接 = 指针顶死在左限位、读不出数」
    //     放在这里就是错的，rec.reversed 恒 false；
    //   · 超量程仍然是「打表」（fault 'over'），左右两侧都算。
    //
    // 满偏默认 ±30mA，不是真表的 ±30μA：这个沙盒的电源是 1.5~36V、负载是几欧到
    // 几百欧，μA 级一接上就满偏烧表，学生只会以为这件器材是坏的。想还原真表
    // 规格，参数面板里切到「30 μA」即可 —— 那时它正好用来讲「灵敏电流计
    // 不能直接接电源」。三档的数字都取得让刻度印出来是整数（30 / 3 / 30）。
    galvanometer: {
      label: '灵敏电流计', terminals: 2, termNames: ['-', '+'],
      // range = 满偏电流的【幅值】：±range 就是整条刻度。
      // rInternal 默认 2Ω：真表几十~上百欧，但那样它一进串联回路就把电流
      // 改掉一大半，学生量的已经不是「原来那个电路」了。2Ω 既能看见「表也
      // 有一点内阻」，又不至于把电路拧走样；要讲内阻就在面板上拧大。
      defaults: { range: 0.03, rInternal: 2, zeroed: true, zeroMode: 'on' },
    },
  };

  // ============================================================
  // 「这个类型是不是【电源】」
  // ------------------------------------------------------------
  // 求解器里有三处必须按电源特判，而且三处【都要一视同仁】：
  //   · shortCircuitInfo  短路检测 —— 漏掉一个就会出现「学生电源被导线
  //                        直接短接、电流爆表，却一条警告都不报」；
  //   · 无源判定（no-source）—— 漏掉一个，整个电路只要有学生电源就会被
  //                        判成「没有电源」；
  //   · terminalFlow       端子电流方向 —— 电源支路的 Ik 是【充电方向】，
  //                        别的元件是放电方向，约定不同（见那里的注释）。
  // 所以别再各处写 `c.type === 'battery'`：加一个电源类型就要改三处，
  // 迟早漏一处，而漏掉的那处不会报错、只会静默算错。
  // ============================================================
  function isSourceType(t) { return t === 'battery' || t === 'power'; }

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

  // ── 「理想电压表」在求解器里的等效内阻 ──────────────────────
  // 初中课本把电压表当成「内阻无穷大、完全不分流」，但它【不是真的】：
  // 两只理想电压表串联接在电源两端时，中间那个节点就没有任何支路连过去，
  // 求解器只能给悬空节点一个幽灵 0V ⇒ 一只表读满电源电压、另一只读 0
  // （用户 2026-10-19 报的就是这个）。真表有内阻，串联时按内阻分压 ——
  // 两只同规格的表各分一半，这正是课本上那道题要的答案。
  //
  // 所以理想表在【求解时】也走一条 R 支路，只是内阻取得极大：1GΩ 下
  // 3V 电源的漏电流只有 3nA，「电压表几乎不分流」这句话照样成立。
  // ⚠️ 对外（rec.i / rec.R / 弱电流可视化）仍按【理想表】报 —— 见
  //    fillVoltmeter 末尾那三行。学生看到的是「表里没有电流」，
  //    求解器内部才用这条 1GΩ 支路把节点电位算对。
  //
  // 为什么是 1e9 而不是 1e7（10MΩ，数字万用表的量级）：
  //   伏安法测电阻那条断言要求 U/I 精确等于 10Ω（容差 1e-6）。10MΩ 并在
  //   10Ω 上，等效电阻 9.99999Ω ⇒ U/I 偏 1e-5，直接踩线；1GΩ 偏 1e-7，
  //   留出一个数量级的余量。实测 1e8 时 1e-6 刚好卡在边上，不能用。
  //   再往上（1e10）矩阵条件数开始变差，收益已经没有了。
  // 不要改成 3kΩ：那是「模拟微弱电流」那一挡，3kΩ 会让电压表真的偷走
  // 1mA，和「理想」两个字自相矛盾。
  var IDEAL_VM_R = 1e9;

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

  // ── 表头烧坏的门槛（量程的几倍）─────────────────────────────
  // 表和人一样有两条命，必须分成两档：
  //   · **打表** —— 指针顶到限位钉上，读数不能信了，但表还能用（fault = 'over'）；
  //   · **烧表** —— 动圈过热烧断，表彻底废了（fault = 'burnt'，内核里是断路）。
  // 学生真会犯的两种错正好落在这两档上：
  //   · 量程选小了 —— 0.6A 挡去量 0.8A 的回路，指针打到头 ⇒ 打表；
  //   · 把电流表直接接在电源两极上 —— 电流是安培级，0.6A 挡上差着一个数量级
  //     ⇒ 烧表。
  // 所以门槛取【量程的 2 倍】：1~2 倍之间只打表，2 倍往上才烧。
  // ⚠️ 这两档【必须分开】。合成一个的话，「量程选小了」和「接成了短路」在
  //    学生眼里就是同一件事 —— 而它们该讲的道理完全不同：前者是选量程，
  //    后者是「电流表内阻几乎为零，绝不能并接在电源上」。
  var METER_BURN_K = 2;

  // ── 直流电动机的铭牌常数 ────────────────────────────────────
  //   rpmPerV  空载转速常数（每伏特每分钟多少转）：3V 下 2400 r/min，
  //            正是 130 型小电机的量级；
  //   noLoadI  空载电流（A）：空载时只需克服自身摩擦矩，电流很小，
  //            而且【基本不随电压变】—— 真实空载电机的电流就是几乎恒定的；
  //   I_RATIO  额定点电流 / 空载电流，用来给粘性摩擦定标（见 motorState）。
  // 这三个数只用来定标，不是面板参数；面板给的是线圈电阻、空载电流、
  // 转速常数 —— 学生调得到的都写在铭牌上，调不到的是电机型号。
  var MOTOR = { rpmPerV: 800, noLoadI: 0.05, I_RATIO: 2, URATED: 3, R_DEF: 5 };

  // ── 导体板材料电阻率（Ω·mm²/m，20℃）──────────────────────
  // 「电阻与材料有关」这句话的数值落点：R = ρ·L/S，ρ 就在这张表里。
  // 单位取 Ω·mm²/m 而不是 Ω·m：L 用 m、S 用 mm² 时 R 直接是欧姆，
  // 不用在面板和求解器之间来回换算（换算错一次就是 10⁶ 倍）。
  // 铜收进来是为了和「铜丝与镍铬合金丝」那节课对照：同样 1m / 0.5mm²，
  // 铜 0.034Ω 对镍铬 2Ω，差约 60 倍 —— 灯泡亮度差着一大截。
  var PLATE_MATERIALS = {
    copper:     { label: '铜',       rho: 0.017 },
    manganin:   { label: '锰铜',     rho: 0.44 },
    constantan: { label: '康铜',     rho: 0.50 },
    nichrome:   { label: '镍铬合金', rho: 1.0 },
  };
  function plateMaterial(P) {
    var m = PLATE_MATERIALS[(P && P.material)] || PLATE_MATERIALS.nichrome;
    return m;
  }
  // 导体板的电阻：R = ρ·L / S。L 单位 m、S 单位 mm²、ρ 单位 Ω·mm²/m。
  function plateR(comp) {
    var P = paramsOf(comp);
    var L = num(P.length, 1), S = num(P.section, 0.5);
    if (!(L > 0)) L = 1;
    if (!(S > 0)) S = 0.5;      // 0 截面 = 没有导体，退回默认而不是除零
    return plateMaterial(P).rho * L / S;
  }

  // ── 电阻示教板的四根丝 ────────────────────────────────────────
  // 规格照实验室里那块 J2359（电阻定律示教板）印的数：
  //   直径 0.3 / 0.5mm 的镍铬丝、0.3mm 的锰铜丝，长度 1.0 / 0.5m。
  // 阻值由 R = ρ·L/S 现算（S = π·(d/2)²，单位 mm²），不写死 ——
  // 写死的话，改了 PLATE_MATERIALS 的 ρ 之后板上的数就和公式对不上了。
  //
  // 🔴 四根丝的【顺序】就是端子编号顺序（2i / 2i+1），也是画面上从上到下
  //    的顺序、板面序号 ①②③④ 的顺序。三处必须是同一个顺序，否则学生照着
  //    「①」去接线，接到的却是另一根丝。
  var PLATE_WIRES = [
    { mat: 'nichrome', d: 0.30, L: 1.0 },     // ① 基准：14.1Ω
    { mat: 'nichrome', d: 0.30, L: 0.5 },     // ② 比长度：7.1Ω
    { mat: 'nichrome', d: 0.50, L: 1.0 },     // ③ 比粗细：5.1Ω
    { mat: 'manganin', d: 0.30, L: 1.0 },     // ④ 比材料：6.2Ω
  ];
  PLATE_WIRES.forEach(function (w) {
    w.S = Math.PI * (w.d / 2) * (w.d / 2);    // mm²
    w.R = plateMaterial({ material: w.mat }).rho * w.L / w.S;
    w.matLabel = plateMaterial({ material: w.mat }).label;
  });

  // ── 铅笔芯（课本「用铅笔芯控制小灯泡的亮度」）──────────────────
  // 尺寸照实验室里真发得出来的自动铅笔芯：0.5mm 直径、120mm 长（长款）。
  // 电阻率单位仍是 Ω·mm²/m（和导体板同一套，见 PLATE_MATERIALS）：
  // 石墨芯的 ρ 在 2e-5 ~ 7e-5 Ω·m 量级，换成 Ω·mm²/m 就是 20~70。
  //
  // 型号 = 石墨 / 黏土的比例：HB 黏土多、硬而阻值大；6B 石墨多、软而阻值小。
  // 🔴 这三个数不是拍出来的：0.5mm 的 HB 芯实测每 60mm 在 10~20Ω，全长
  //    120mm 就是 20~40Ω（这里 33.6Ω），仍和 2.5V/0.75W 的小灯泡（热态
  //    8.3Ω）同一个量级 —— 串联时「夹子一动、灯就明显变暗」才看得见。
  //    取小了（比如 5Ω 全长）铅笔芯就成了导线，灯一直亮着不动；取大了
  //    （比如 100Ω 全长）灯从头到尾都是灭的。
  var PENCIL = {
    LEN_MM: 120, DIA_MM: 0.5,
    LEN_MIN: 10, LEN_MAX: 120,
    // 横截面积（mm²）：π·(d/2)² = 0.196
    section: Math.PI * 0.25 * 0.25,
  };
  var PENCIL_GRADES = {
    HB: { label: 'HB', rho: 55 },
    '2B': { label: '2B', rho: 38 },
    '6B': { label: '6B', rho: 22 },
  };
  function pencilGrade(P) {
    return PENCIL_GRADES[P && P.grade] || PENCIL_GRADES.HB;
  }
  // 接入长度（mm）。夹子拖出界、存档手改成 "abc" 都退回默认值，不抛错。
  function pencilLen(comp) {
    var P = paramsOf(comp);
    var L = num(P.len, 20);
    return Math.max(PENCIL.LEN_MIN, Math.min(PENCIL.LEN_MAX, L));
  }
  // 接入那一段的电阻：R = ρ·L/S（L 从 mm 换成 m）。
  function pencilR(comp) {
    return pencilGrade(paramsOf(comp)).rho * (pencilLen(comp) / 1000) / PENCIL.section;
  }

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

  // 灵敏电流计：满偏电流 → 「表盘上印的单位 + 换算系数」。
  // 刻度数字 = 满偏换算到该单位之后按 1/3、2/3、1 三等分，所以三档满偏
  // （30mA / 3mA / 30μA）印出来都是整数 30 / 3 / 30。
  //
  // 🔴 这个判断【只能有一份】。绘制层（表盘刻度、读数牌）、电路图（铭牌）、
  //    损坏原因文案都要写单位，四处各写一套「多少以下算 μA」的话，只要有一处
  //    写反，同一只表在画布上读 18mA、在电路图上读 18000μA —— 差 1000 倍。
  //    所以真值放在内核（TYPES 也在这儿），绘制层转发过来问。
  function galUnitOf(range) {
    return (range < 0.00095) ? { u: 'μA', k: 1e6 } : { u: 'mA', k: 1e3 };
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

      // 导体板：R = ρ·L/S（见 plateR）。它和定值电阻在电路上完全同构，
      // 分开写只是为了让「三个因素」各有自己的旋钮。
      case 'plate':
        addR(N(0), N(1), plateR(comp));
        break;

      // 电阻示教板：四根丝各一条支路（端子 2i / 2i+1）。
      // 🔴 四根【都】要 push，哪怕学生只接了一根 —— 没接通的那几根落在
      //    无源岛里，求解器会把整个岛归零（见 solveIsland 的接地注释），
      //    不会让矩阵奇异；而少 push 一根，回填时按 plateIdx 找支路就会落空。
      // 支路里带 plateIdx：解出来的 bs 顺序未必等于 push 顺序（被短接的那根
      // 会被 addR 丢掉），只有这个标记能把电流准确归位到某一根丝。
      case 'rheoboard': {
        for (var ri = 0; ri < PLATE_WIRES.length; ri++) {
          var rp = N(ri * 2), rq = N(ri * 2 + 1);
          if (rp === rq) continue;              // 两端被同一根导线短接：这根不起作用
          out.push({ kind: 'R', comp: comp, p: rp, q: rq,
                     R: PLATE_WIRES[ri].R, plateIdx: ri });
        }
        break;
      }

      // 铅笔芯：接入的那一段就是一段电阻，R = ρ·L/S（见 pencilR）。
      // 电路上和定值电阻完全同构 —— 变的只是参数（夹子位置），不是拓扑。
      case 'pencil':
        addR(N(0), N(1), pencilR(comp));
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
          var nBr = out.length;
          addR(N(0), N(1), SHORT_R);
          // 标一下「这条支路是短接线、不是灯丝」——填读数时要靠它绕开
          // fillLamp（否则按 p/P额 算出来的亮度会顶到最大，灯亮得像要炸）；
          // shortCircuitInfo 也靠这个标记把「灯座短路」认成【零阻支路】。
          // ⚠️ 必须用【加之前 / 之后】的长度差：灯两端若已被导线短接（p === q），
          //    addR 会直接 return、一条都不 push —— 此时若按 out.length 取末条，
          //    标到的是【上一个元件】的支路。
          if (out.length > nBr && out[out.length - 1].kind === 'R') {
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
        // 理想电压表（rInternal = null）【也给一条支路】，内阻取 IDEAL_VM_R
        // （10MΩ）—— 见那个常量的注释：不给的话，两只理想电压表串联时中间
        // 节点是悬空的，一只表读满电源电压、另一只读 0（用户 2026-10-19 报的）。
        // 「不分流」这句话仍然成立：10MΩ 的漏电流只有 0.3μA，而且对外
        // rec.i 一律按 0 报（fillVoltmeter 末尾），学生看到的仍是理想表。
        if (tap != null) {
          var rv = (P.rInternal != null && isFinite(P.rInternal)) ? P.rInternal : IDEAL_VM_R;
          if (rv > EPS) addR(N(tap), N(NC()), rv);
        }
        break;

      case 'ammeter':
        if (tap != null) {
          out.push({ kind: 'V', comp: comp, p: N(tap), q: N(NC()), V: 0, Rs: P.rInternal || 0 });
        }
        break;

      // 灵敏电流计：两端元件，一只【带内阻的理想电流表】—— 和电流表走同一条
      // 「0V 电压源 + 串联内阻」支路。区别只在它没有量程柱：端子 0/1 就是
      // 「−」「+」两根柱子，两头都接上就进了电路。
      // 不判「接反」：中心零的表，电流从哪头进就往哪边偏，那是它的功能。
      case 'galvanometer':
        out.push({ kind: 'V', comp: comp, p: N(0), q: N(1), V: 0, Rs: P.rInternal || 0 });
        break;

      case 'switch':
        if (P.closed) out.push({ kind: 'V', comp: comp, p: N(0), q: N(1), V: 0, Rs: 0 });
        break;                                             // 断开 → 无支路，自然消失

      // 单刀双掷开关：刀片搭在哪一侧，公共端（端子 1）就与哪一侧导通。
      // 支路形状和「合上的普通开关」一模一样（0Ω 的理想导线）—— 两个掷位
      // 都是【通】，区别只在通到哪一头。所以这里【不产生】「断开」那种情形：
      // 选不中的那一掷端子悬在电路外面，一条支路都不贡献（和电流表没插的
      // 那个量程柱同一个道理）。
      case 'spdt': {
        var sel = throwOf(P);
        out.push({ kind: 'V', comp: comp, p: N(1), q: N(sel === 2 ? 2 : 0), V: 0, Rs: 0 });
        break;
      }

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

      // 干电池与学生电源【共用这一支】：两者在电路上完全同构，都是
      // 「电动势 V 串内阻 Rs」的一条电压源支路。分两个 case 各写一遍的话，
      // 日后改了内阻的算法只改一处，另一种就静默地算错。
      // cells / emfPerCell / rPerCell 是老键，只有干电池会用（学生电源没有
      // 「节数」这个概念）；学生电源永远走 emf / rInt 这两个键。
      case 'battery':
      case 'power': {
        // 学生电源面板上那颗【电源开关】关掉 = 这台仪器不输出，一条支路都不
        // 产生 —— 和断开一个开关同构（见下面 case 'switch'）。干电池没有这颗
        // 开关（TYPES.battery.defaults 里没有 on），P.on 恒为 undefined
        // ⇒ 不受影响；另外那句 comp.type 判断本来也把它挡在外面。
        // ⚠️ 判据必须写 `P.on === false`，不能写 `!P.on`。注意这里的 P 是
        //    【paramsOf(comp)】—— 已经和 TYPES.power.defaults 合并过，所以
        //    「存档里没有 on 这个键」这一种情形 P.on 恒为 true，两种写法等价，
        //    别拿它当理由（我一开始就是这么写错的）。真正能分辨的是
        //    【键在、值却不是布尔】：JSON 里 "on": null 完全合法，手改过的存档、
        //    导出的旧文件都可能带上它 —— 那时 !P.on 会把一台好好的电源判成
        //    「关着的」，学生只看到「电路通了但不亮」。只有显式 false 才算关。
        if (comp.type === 'power' && P.on === false) break;
        var cells = P.cells != null ? P.cells : 1;
        var emf = P.emf != null ? P.emf : cells * (P.emfPerCell != null ? P.emfPerCell : 1.5);
        var rInt = P.rInt != null ? P.rInt : cells * (P.rPerCell != null ? P.rPerCell : 0.5);
        out.push({ kind: 'V', comp: comp, p: N(0), q: N(1), V: emf, Rs: rInt });
        break;
      }

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
  // 单刀双掷开关【刀片当下搭在哪一侧】：1 = 左掷（端子 0）、2 = 右掷（端子 2）。
  // 非数 / 越界一律退回 1。存档是手改得动的 JSON，读到 "throw": null 或 "3"
  // 的时候不能让它变成「两个掷都不通」——那是个【不存在】的状态（真实的单刀
  // 双掷永远搭在某一侧），画面上刀片也总得指向一边。退回 1 至少是自洽的。
  // 参数面板写进来的可能是字符串（下拉框/按钮都给字符串），所以这里必须 +。
  function throwOf(P) { return (+P.throw === 2) ? 2 : 1; }
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
  //
  // 返回 { compIds, loopIds }：
  //   compIds = 被短接的【电源】（状态栏那句「电源被导线直接短接」说的是它）；
  //   loopIds = 落在这条零阻通路上的【非电源元件】—— 电流无穷大，它们也跑不掉。
  // 🔴🔴 为什么要单独认一遍 loopIds：理想电源（内阻 0）被零阻通路短接时，方程
  //    【解不出来】（矩阵奇异），solve 提前返回、results.components 是一张空表
  //    ⇒ 每个元件都拿不到读数 ⇒ faultsOf 里「读数超量程」那条判据一个元件都
  //    进不去。于是学生把【电流表直接接在电源两极上】，画面上电源烧了、电流表
  //    却毫发无伤 —— 而真实的电流表这么接是当场烧表的（表的内阻几乎为零，
  //    它就是那条零阻通路本身）。这一支必须按【拓扑】认，不能按读数认。
  // ⚠️ 找 loopIds 必须用【支路】而不是【元件端子表】：三柱表头的「两端」是
  //    「−」柱 + 当前那个量程柱，端子号不是 0/1 —— 拿 termNode[id+':0'/':1']
  //    去查，接在 3A 柱上的电流表会被整个漏掉。支路的 p/q 才是它真实的两端。
  // ⚠️ 只有「同一个零阻集合里还有电源的端子」才算短路环。少了这个条件，
  //    任何一根闭合开关（也是零阻支路）都会被算进去。
  // ============================================================
  function shortCircuitInfo(components, branches, termNode) {
    // 「这条支路在拓扑上是不是一根【零阻导线】」。
    // 🔴 「灯座短路」那条支路在 describeComponent 里被等效成【很小的电阻】
    //    （SHORT_R = 0.01Ω，不是 0Ω）—— 当初是为了不让求解矩阵奇异（否则学生
    //    看到的是「接线矛盾，无法求解」而不是「灯不亮、别的都正常」）。
    //    但它在拓扑上就是【一根跨在灯座两端的铜丝】，短路判定必须把它当零阻看：
    //    漏掉它的后果，正是用户报的那条 —— L1、L2 并联时把 L2 灯座短路，
    //    电源明明被短路了，却既不烧电源、L1 还照样亮（sc.compIds 是空的）。
    function isZeroBr(b) {
      if (b.shorted === true) return true;              // 灯座短路的等效支路
      return b.kind === 'V' && Math.abs(b.Rs) <= 1e-9;  // 真正的理想零阻导线
    }
    var dsu = createDSU();
    var seen = {};
    branches.forEach(function (b) {
      if (!isZeroBr(b)) return;
      if (b.comp && isSourceType(b.comp.type)) return;
      if (b.p === b.q) return;
      dsu.add(b.p); dsu.add(b.q); dsu.union(b.p, b.q);
      seen[b.p] = 1; seen[b.q] = 1;
    });
    var ids = [], roots = {};
    components.forEach(function (c) {
      if (!isSourceType(c.type) || isOpenFault(c)) return;
      var n0 = termNode[c.id + ':0'], n1 = termNode[c.id + ':1'];
      if (n0 == null || n1 == null) return;
      if (n0 === n1) { ids.push(c.id); roots[dsu.find(n0)] = 1; return; }
      if (seen[n0] && seen[n1] && dsu.find(n0) === dsu.find(n1)) {
        ids.push(c.id); roots[dsu.find(n0)] = 1;
      }
    });
    var loop = [];
    if (ids.length) {
      branches.forEach(function (b) {
        if (!b.comp || !isZeroBr(b)) return;
        if (isSourceType(b.comp.type) || isOpenFault(b.comp)) return;
        if (!seen[b.p] || !seen[b.q]) return;
        if (!roots[dsu.find(b.p)]) return;
        if (loop.indexOf(b.comp.id) < 0) loop.push(b.comp.id);
      });
    }
    return { compIds: ids, loopIds: loop };
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
    if (components.length === 0) {
      out.status = 'empty';
      // 空画布也把 stats 补全：状态栏照印「0 条支路」，读 undefined 会印出
      // 「undefined 条支路」。nodeCount 此时还是 0（并查集还没建）。
      out.stats = { nodeCount: 0, branchCount: 0, pathCount: 0, matrixSize: 0, solveMs: 0 };
      return out;
    }

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
      out.shortCircuit = shortCircuitInfo(components, usedBranches, topo.termNode);
      warnings.push(shorted
        // 只说【电源】被短接：闭合开关被导线短接不会走到这里（那条支路是
        // 0 = 0，早被丢掉了），会走到这里的闭合开关必定是和电源并在一起
        // 把它摁住的那一条 —— 那本来就是电源短路。
        ? { code: 'SHORT_CIRCUIT', message: '电源被导线直接短接，电流会过大' }
        : { code: 'SINGULAR', message: '电路存在矛盾约束，请检查接线' });
      // 无解也要给 stats：状态栏那一行照印（「4 条支路 / 3ms」），
      // 少了这一句 pages 读 results.stats.branchCount 会拿到 undefined。
      out.stats = {
        nodeCount: topo.nodeCount,
        branchCount: usedBranches.length,
        pathCount: countPaths(usedBranches, {}),
        matrixSize: 0,
        solveMs: +(now() - t0).toFixed(3),
      };
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
        // 电阻示教板：四根丝各一条支路，逐根回填。
        // 学生一次只接一根（教材用法），但也可能接两根 —— 那时两根各有电流，
        // rec.R 取【电流最大的那根】做「当前阻值」，rec.branches 全给出来，
        // 读数框和参数面板据此说清楚「现在用的是哪一根、还接了哪几根」。
        case 'rheoboard': {
          var psegs = [];
          for (var pi = 0; pi < PLATE_WIRES.length; pi++) {
            // 按 plateIdx 找支路，不能按 bs 的下标 —— 被短接的那根不在 bs 里，
            // 下标会整体错位（那样「①」会读到「②」的电流，还不报错）。
            var pb = null;
            for (var bj = 0; bj < bs.length; bj++) {
              if (bs[bj].plateIdx === pi) { pb = bs[bj]; break; }
            }
            var pw = PLATE_WIRES[pi];
            var pv = pb ? (nV(sol, pb.p) - nV(sol, pb.q)) : 0;
            psegs.push({
              idx: pi, R: pw.R, v: pv, i: pb ? (pv / pb.R) : 0,
              // 这根丝的两端是不是都接了外部导线 —— 「接通」的唯一判据。
              // 只看电流不行：合开关之前电流也是 0，那时学生已经接好线了。
              wired: wired.has(c.id + ':' + (pi * 2)) &&
                     wired.has(c.id + ':' + (pi * 2 + 1)),
            });
          }
          rec.branches = psegs;
          var pick = null;
          psegs.forEach(function (s) {
            if (!s.wired || Math.abs(s.i) <= 1e-12) return;
            if (!pick || Math.abs(s.i) > Math.abs(pick.i)) pick = s;
          });
          if (!pick) pick = psegs.filter(function (s) { return s.wired; })[0] || null;
          rec.which = pick ? pick.idx : null;
          rec.R = pick ? pick.R : null;
          // 对外一律用幅值：这块板没有极性，学生不该看到「−0.21A」。
          rec.i = pick ? Math.abs(pick.i) : 0;
          rec.v = pick ? Math.abs(pick.v) : 0;
          rec.p = rec.v * rec.i;
          rec.wiredCount = psegs.filter(function (s) { return s.wired; }).length;
          break;
        }

        // 导体板和定值电阻在回填上完全同构：一条 R 支路，R = ρ·L/S
        // （见 describeComponent 的 plate 分支）。加进来而不是另写一个 case：
        // 两份回填逻辑迟早对不上，而读数表里那一列 R 直接读 rec.R。
        case 'resistor': case 'plate': case 'pencil': case 'bulb': case 'voltmeter': {
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

        case 'spdt': {
          // 和普通开关同构：搭上的那一掷与公共端之间是一条 0Ω 支路。
          // rec.throw 记下刀片此刻搭在哪一侧 —— 绘制层、读数框、侧栏都读它。
          // 🔴 rec.closed 恒为 true：单刀双掷【没有「断开」这一档】。写成
          //    !!P.closed 的话，参数里根本没有 closed 这个键 ⇒ 恒 false ⇒
          //    凡是按 rec.closed 判「通不通」的地方（侧栏 R 列、状态栏、
          //    走线配色）都会把一只好好搭在触点上的开关当成断的。
          rec.throw = throwOf(P);
          rec.closed = true;
          var qT = (rec.throw === 2 ? N(2) : N(0));
          if (bs.length) {
            rec.i = bI(sol, bs[0]);
            rec.v = 0;
          } else {
            rec.v = nV(sol, N(1)) - nV(sol, qT);
            rec.i = 0;
          }
          rec.p = rec.v * rec.i;
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

        // 灵敏电流计：两端元件。一根柱子悬空时支路电流恒 0（拓扑保证），
        // 读数自然是 0 —— 不需要像三柱表那样再按 rec.wired 抹一遍。
        case 'galvanometer': {
          rec.i = bs.length ? bI(sol, bs[0]) : 0;
          rec.R = P.rInternal || 0;
          rec.v = rec.R * rec.i;
          rec.p = rec.v * rec.i;
          rec.range = P.range;
          // 没有量程柱：量程永远是参数给的那个，「接在哪个柱上」这件事不存在。
          // rangeWired / wired 恒 true 是给下游（faultsOf、读数框）看的，
          // 让它们不必为这件器材再写一条特例。
          rec.rangeWired = true;
          rec.wired = true;
          rec.ideal = !P.rInternal;
          // 🔴 读数 = 【−i】。内核的 rec.i 约定是「从 0 号端子流向 1 号端子为正」，
          //    而这只表的 0 号是「−」柱、1 号是「+」柱。真表（和人教版那句
          //    「电流从正接线柱流入，指针向右偏转」）要的是「从 + 柱流进 = 正」，
          //    正好和 rec.i 反号。不翻的话，学生接对了线却读出一个负数。
          //    反号只加在 reading 上：rec.i 仍是内核口径（导线粒子、表格都用它）。
          rec.reading = -rec.i;
          // 🔴 中心零：读数的【符号】就是指针偏向哪一边 —— 不判反接。
          //    rec.reversed 恒 false，页面那套「指针反偏 / 读不出数」的文案
          //    因此不会被这件器材触发（它本来也不该触发）。
          rec.reversed = false;
          rec.centerZero = true;
          rec.overRange = Math.abs(rec.reading) > rec.range + 1e-12;
          if (rec.overRange) {
            warnings.push({ code: 'METER_OVER_RANGE', message: '灵敏电流计超量程', componentIds: [c.id] });
          }
          break;
        }

        case 'battery':
        case 'power': {
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
          // ── 把「被导线短路掉的那半根」补成【零电流占位段】────────────────
          // 变阻器内部是 A —[左半根]— S —[右半根]— B，而 S 又是 C/D 金属杆
          // 那一端。学生若把 B 和 C/D 接到【同一个外部节点】（用户报的那张图
          // 就是 D 和 B 都接在灯泡左端），B 的节点就成了 S ⇒ `addR(S, N(1), …)`
          // 变成自环、被 addR 丢掉 —— 右半根整根被那根导线短路，本来就一点
          // 电流都没有。左半根被短路（A 接到 C/D）时同理。
          //
          // 🔴 段数少了一段，下游每一处「按段号取电流」的地方都会错：
          //    · drawRheostatFlow 开头 `segments.length < 2` 直接早退 ⇒ 变阻器
          //      一个记号都不画（绕线、触臂、金属杆全空）；
          //    · terminalInjection 的 `segs.length < 2` 一律回 0 ⇒ 挂在滑片
          //      节点上的那两根导线注入量全算成 0 ⇒ 那两根线上一颗粒子都没有。
          //    症状正是用户报的「两根线的电流可视化没了，变阻器也没了」。
          // 🔴 更阴的是【段号错位】：A 被短路时剩下的那一段其实是【右半根】，
          //    若照 segs[0] 当左半根读，就是拿右半根的电流去画左半根 —— 方向、
          //    大小全不对，还偏偏画得出来（不报错、不空屏）。所以哪一头补占位
          //    必须按【节点】判断（A 与 S 同节点 ⇒ 左半根没了），不能只看长度。
          // 🔴 补出来的段 i 恒为 0，【不是从解里读的】——它压根不在回路里；
          //    carry 过滤（|i| > 1e-12）因此天然把它排除在 rUsed 之外。
          var nS = N(2);
          function padSeg() {
            // isShort 取 true：这一半被外部导线短路了，与「0Ω 的接法」同语义。
            // bypassed 是给 terminalInjection 看的：它要据此把 A/B 也当成
            // 「挂在滑片节点上的引线」，和 C/D 一起分配注入量。
            return { R: 0, v: 0, i: 0, isShort: true, bypassed: true };
          }
          // bs 的顺序 = describeComponent 里 addR 的先后：左半根在前、右半根在后，
          // 所以存在哪一半，就按顺序 shift 出来占哪一位。
          var segL = (N(0) !== nS) ? (segs.shift() || padSeg()) : padSeg();
          var segR = (N(1) !== nS) ? (segs.shift() || padSeg()) : padSeg();
          segs = [segL, segR];
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

    // ---- 短路（拓扑判据，见 shortCircuitInfo）----
    // 放在这里而不是 status 判定里：status 只回答「电路通不通」，而短路是
    // 「通得太厉害」——两者要分开报。status 的计算逻辑一个字没动，
    // 短路另开一个字段，免得动摇了既有的用例。
    out.shortCircuit = shortCircuitInfo(components, usedBranches, topo.termNode);

    // ---- 状态判定 ----
    // 🔴 「通不通」还要再挡一层：理想电压表在求解器里走的是一条 10MΩ 支路
    //    （见 IDEAL_VM_R，为了把串联分压算对），它的漏电流只有 0.3μA，
    //    但足以让 anyCurrent 变 true。而课本管「电源上只接了一只电压表」
    //    叫【断路】—— 灯一个都不亮、电流表读 0。所以再问一句「这个有源岛里
    //    有没有【真正的负载】」：只有电源和理想电压表的岛不算导通。
    //    有负载（电阻 / 灯 / 电动机 / 真实电压表…）就照旧按 anyCurrent 判。
    var hasRealLoad = islands.some(function (is) {
      if (!is.hasSource) return false;
      return is.branches.some(function (b) {
        if (isSourceType(b.comp.type)) return false;
        // 理想电压表（rInternal 为 null）不算负载；勾了「模拟微弱电流」的
        // （rInternal = 3kΩ）算 —— 那一挡就是让学生看见它真的偷电流。
        if (b.comp.type === 'voltmeter' && !(paramsOf(b.comp).rInternal > 0)) return false;
        return true;
      });
    });
    if (shorted) out.status = 'shorted';
    else if (anyCurrent && hasRealLoad) out.status = 'ok';
    else if (!components.some(function (c) { return isSourceType(c.type); })) out.status = 'no-source';
    else out.status = 'open-circuit';

    out.stats = {
      nodeCount: topo.nodeCount,
      // branchCount = MNA 支路（每个元件一条，含电源/开关/变阻器两段）；
      // pathCount   = 课本口径的支路数（分岔出去的路径）。状态栏印后者 ——
      // 「并联两灯 = 2 条支路」，印前者会印成 4，用户报的就是这个。
      branchCount: usedBranches.length,
      pathCount: countPaths(usedBranches, comp),
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
    // 🔴 理想电压表：求解时它走的是一条 10MΩ 支路（见 IDEAL_VM_R），但
    //    【对外】仍按「不分流」报 —— i = 0、R = null。这一条不能省：
    //      · 侧栏 I 列会印出一个 0.0000003 的电流，学生以为表在偷电；
    //      · R 列会印 10000000Ω，看着像一只坏表；
    //      · 导线上的电流粒子会在这两根线上冒出来（terminalInjection 读 rec.i）；
    //      · anyCurrent 会被这条 μA 级漏电流点亮 ⇒ 电路被判成「导通」，
    //        而实际上只有一只电压表接着，课本管这个叫断路。
    //    内部那条支路只负责把【节点电位】算对（串联分压），不负责对外报数。
    if (rec.ideal) { rec.i = 0; rec.p = 0; rec.R = null; }
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
      if (!segs || segs.length < 2) return 0;  // 理论上到不了（两段恒存在）；真到得了宁可不动
      // 🔴 两段【恒存在】：被导线短路掉的那半根由内核补成零电流占位段
      //    （见 describeComponent 的 rheostat 段）。这里若还按「长度不够就
      //    回 0」兜底，挂在滑片节点上的那两根线上的电流可视化就整段消失
      //    —— 用户报过的那张图（D 与 B 同接灯泡左端）正是这个症状。
      var byL = !!segs[0].bypassed;            // 左半根被导线短路 ⇒ A 就在滑片节点上
      var byR = !!segs[1].bypassed;            // 右半根被导线短路 ⇒ B 就在滑片节点上
      // A / B 各自的半根【还在】时，它们是有向支路，注入量直接读支路电流：
      //   A：电流流进元件，注入节点为负；B：电流从元件流出，注入节点为正。
      // 半根被短路时，A（或 B）与滑片 S 就是【同一个节点】，它和 C/D 一样
      // 只是「挂在滑片节点上的一根引线」，各分多少定不下来，归到下面一起分。
      if (termIdx === 0 && !byL) return -segs[0].i;
      if (termIdx === 1 && !byR) return segs[1].i;
      if (termIdx !== 0 && termIdx !== 1 && termIdx !== 2 && termIdx !== 3) return 0;
      var ends = [2, 3];
      if (byL) ends.push(0);
      if (byR) ends.push(1);
      if (ends.indexOf(termIdx) < 0) return 0;
      // 滑片节点上这一【组】端子的注入之和，由滑片节点的 KCL 给出：
      //   Σ inj = −(segs[1].i − segs[0].i) = segs[0].i − segs[1].i
      // 这个负号是关键。segs[1].i − segs[0].i 由滑片节点 S 的 KCL 推出来，
      // 它等于「从 C 端【流入】元件的电流」；而本函数的契约是「流出元件、
      // 注入节点」，方向正好相反，所以必须取负。
      //
      // 漏掉这个负号的后果很隐蔽：剥叶子时哪个端子先被剥，取决于导线是
      // 从哪端开始写的。接 C 的那根线若写成「E → C」（a 端是 E），先剥 E，
      // 结果是对的；写成「C → E」先剥 C，用上这个注入量，这根线的电流就
      // 整个反号——屏幕上就是【这一段和其它段的粒子反向跑】。
      // 组内各分多少，解里同样定不下来：同一节点上的几根理想引线，谁多谁少
      // 都满足 KCL（等电阻网络的最小二乘解给出的就是「平分」）。实际接线
      // 通常只用一个，所以按「谁真的接了线」分配：只接一个就全给它，
      // 接了多个（少见：把同一根杆 / 同一半根引到两处）才平分。
      var total = segs[0].i - segs[1].i;       // 从滑片节点这一端【流出】元件的电流
      var wiredEnds = ends.filter(function (t) {
        return wired ? wired.has(comp.id + ':' + t) : false;
      });
      if (!wiredEnds.length) return 0;
      return total / wiredEnds.length;
    }
    if (comp.type === 'rheoboard') {
      // 八个端子 = 四根丝的两端，每根丝【各流各的电流】—— 不像两端元件那样
      // 全元件共用 rec.i。落到下面 `(termIdx === 0) ? out : -out` 的兜底上，
      // 8 个端子会被当成同一根支路的两端：① 的电流会画到 ④ 的导线上，
      // 而 ②③④ 的导线一根粒子都没有（用户会报「换了根丝，电流动画没变」）。
      var rIdx = Math.floor(termIdx / 2);
      var rSeg = rec.branches && rec.branches[rIdx];
      if (!rSeg) return 0;
      // 端子 2i 是电流【流进】元件那一头 ⇒ 注入节点为负；2i+1 反过来。
      return (termIdx % 2 === 0) ? -rSeg.i : rSeg.i;
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
    // 电源（干电池 / 学生电源）的记录沿用了「支路电流 Ik = 充电方向」的约定，
    // 放电是 −Ik，别的元件 rec.i 是放电方向。这里统一成「流出元件、注入节点」。
    var out = isSourceType(comp.type) ? rec.i : -rec.i;
    // 单刀双掷开关：电流只从【刀片当下搭着的那个掷】进出，另一个掷悬空
    // ——它在电路外面，注入恒 0。落到下面那个 `(termIdx === 0) ? out : -out`
    // 的兜底上，会把没搭上的那一掷也当成通了（画面上两个掷上都在跑电流粒子，
    // 学生根本看不出刀片到底搭在哪边）。
    // ⚠️ 必须写在 `var out = …` 【之后】：`out` 是 var 声明的，写在前面不报错、
    //    只是读到 undefined，于是「−undefined」算出 NaN —— 那根导线的电流
    //    变成 NaN，粒子直接不画（而且一路静默）。
    if (comp.type === 'spdt') {
      var stSel = throwOf(paramsOf(comp));
      if (termIdx === 1) return out;                 // 公共端（刀片转轴）
      return (termIdx === (stSel === 2 ? 2 : 0)) ? -out : 0;
    }
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
  // 干路 / 支路（并联电路的导线配色）
  // ------------------------------------------------------------
  // 课本上「干路」是【拓扑】定义的：电流从电源出来、到第一个分支点之前的那
  // 一段，以及从最后一个汇合点回到电源的那一段。这里不去做通用的串并联分解
  // （那要枚举两点间的所有路径，还得处理桥式、多电源……），而是用一条
  // 【等价、可量、且会随电路自动重画】的电流判据：
  //   · 干路 = 载有【总电流】的导线（总电流 = 电源输出电流，取 max 兜底）；
  //   · 并联 = 存在载着「明显小于总电流」的导线 ⇒ 电流在某个节点上真的分岔了。
  // 两条都挂在电流上，所以学生拧下一盏灯、剩下那条支路的电流立刻涨到全电流，
  // 「并联」当场消失、配色跟着收回去 —— 不需要另写一套「拓扑变了要重算」。
  //
  // ⚠️ 为什么要有 BRANCH_MIN 这条 5% 的门槛：并联的判据不能是「存在比总电流小
  //    的导线」——【电压表并联在某个元件上】时，它那条支路的分流只有总电流的
  //    千分之几（内阻 3000Ω 对 10Ω 量级的主回路）。那在拓扑上确实是一次并联，
  //    但把它算进来，学生搭一个纯串联电路、随手并一只电压表，主回路就会整条
  //    变色 —— 画面在喊「这是并联电路」，而这道题讲的是串联。取 5% 就把
  //    「真的分走一股电流的支路」和「电压表那点微弱分流」分开了。
  //    这个数也【必须小】：两个灯泡并联时各自的支路都是 50% 上下，差得远。
  //
  // 返回 { parallel, total, main: [bool × 导线数] }。parallel 为 false 时
  // main 全是 false —— 串联 / 单回路一律不配色，那种电路「干路」没有区分意义。
  // ⚠️ 第 4 个参数 wires 是【场景里的导线表】（拿它认冗余线，见 redundantWires）。
  //    不传也能跑（按「没有冗余线」处理），只是那种接法下会多配色 —— 页面必须传。
  // ============================================================
  var BRANCH_MIN = 0.05;
  // 「冗余线」：两根导线【共用一个接线柱】，而且另一端接在【同一个元件】上。
  // 🔴 为什么需要它：变阻器的 B 与 C/D 接到同一个外部节点时（用户报的那张图），
  //    两根线一端都插在灯泡左端、另一端都插在变阻器上，而变阻器这两个端子此刻
  //    是同一个电位（B 被导线并到了滑片节点上）。它们各自只分到一半电流，但那是
  //    【同一段路铺了两根线】，不是「电流在某处分岔走了两条不同的路」——课本上的
  //    并联说的是后者。把它们算进「有没有分岔」里，一台纯串联的变阻器电路会被
  //    整条涂成干路色。
  // ⚠️ 判据必须是【成对】的（共用接线柱 + 远端同元件），不能只看「哪些端子在
  //    同一个节点上」——每根导线的两端本来就在同一个电气节点里（并查集就是这么
  //    建节点的），照那个判会把全部导线都算成冗余。也不能只看「同一元件的两个
  //    端子在同一个节点上」：用导线把开关短接时开关两端也同节点，可挂在它上面的
  //    两根线根本不共用接线柱，是【干路】的两截 —— 短接开关是常见演示，不能因此
  //    不给干路配色。
  // 返回与 wires 等长的 bool 数组。
  function redundantWires(wires) {
    var n = (wires || []).length, out = [], i;
    for (i = 0; i < n; i++) out.push(false);
    function endsOf(wr) {
      if (!wr || !wr.a || !wr.b || wr.a.compId == null || wr.b.compId == null) return null;
      return [wr.a, wr.b];
    }
    for (i = 0; i < n; i++) {
      var A = endsOf(wires[i]);
      if (!A) continue;
      for (var j = i + 1; j < n; j++) {
        var B = endsOf(wires[j]);
        if (!B) continue;
        var share = false, farSame = false;
        for (var x = 0; x < 2; x++) {
          for (var y = 0; y < 2; y++) {
            if (A[x].compId === B[y].compId && A[x].termIdx === B[y].termIdx) {
              share = true;
              if (A[1 - x].compId === B[1 - y].compId) farSame = true;
            }
          }
        }
        if (share && farSame) { out[i] = true; out[j] = true; }
      }
    }
    return out;
  }
  function mainBranchFlags(components, flows, results, wires) {
    var n = (flows && flows.length) || 0;
    var main = [];
    for (var z = 0; z < n; z++) main.push(false);
    var out = { parallel: false, total: 0, main: main };
    if (!n) return out;

    // 总电流：导线上最大的那股 + 电源自己报出来的输出电流，取大的那个。
    // ⚠️ 不能只看导线。干路上如果【一根导线都没有】（两根支路直接接在电源的
    //    两个接线柱上），导线里的最大电流只是其中一条支路的电流，拿它当总电流
    //    就会把那条支路误判成干路。电源的 rec.i 才是真正的总电流。
    var tot = 0;
    for (var i = 0; i < n; i++) tot = Math.max(tot, Math.abs(flows[i] || 0));
    var comps = (results && results.components) || {};
    (components || []).forEach(function (c) {
      if (!c || !isSourceType(c.type)) return;
      var r = comps[c.id];
      if (r) tot = Math.max(tot, Math.abs(r.i || 0));
    });
    out.total = tot;
    if (!(tot > 1e-6)) return out;                 // 没有电流（开关断开 / 断路）：不配色
    var tol = Math.max(1e-9, tot * 1e-6);

    var hasBranch = false;
    var dup = redundantWires(wires);
    for (var k = 0; k < n; k++) {
      if (dup[k]) continue;                        // 冗余线不是「分岔」（见 redundantWires）
      var a = Math.abs(flows[k] || 0);
      if (a >= BRANCH_MIN * tot && a <= tot - tol) { hasBranch = true; break; }
    }
    if (!hasBranch) return out;                    // 串联 / 单回路：不分干路支路
    out.parallel = true;
    for (var m = 0; m < n; m++) {
      // 冗余线两边都不认：它既不是「分岔出去的那条支路」，也不是一段独立的干路
      //（同一段路上并两根，谁都不该被单独涂成干路色）。
      if (dup[m]) continue;
      if (Math.abs(flows[m] || 0) >= tot - tol) main[m] = true;
    }
    return out;
  }

  // ============================================================
  // 支路数（教材口径）—— 状态栏「N 条支路」印的就是它
  // ------------------------------------------------------------
  // 用户报的 bug：「并联两灯明明是 2 条支路，状态栏写着 4 条」。
  // 病因：原先那一格直接印 usedBranches.length —— 那是【矩阵分析 (MNA) 的
  // 支路】，每个元件（含电源、开关、变阻器的两段、电流表）都算一条；
  // 而课本上的「支路」是【分岔出去的路径】：并联两灯 = 2 条，串联回路 = 1 条。
  // 两个口径差着「干路上那些元件」，所以越复杂的电路差得越离谱
  // （伏安法那一台印到 6）。
  //
  // 判据 = 课本那句话的可量版本，两步：
  //   ① 串联链折叠：只接了两条支路的节点（度数为 2）把两侧元件并成
  //      一条复合支路 —— 灯泡和限流电阻串在同一条支路里，仍算 1 条；
  //   ② 数「真的分走一股电流」的复合支路：电流落在总电流的
  //      [5%, 95%] 里算一条支路，取总电流（100%）的是干路，不足 5%
  //      的是电压表那点微弱分流（见 mainBranchFlags 的同一条门槛）。
  // 一条都没有（纯串联 / 单回路）= 1 条支路；台上空着 = 0。
  //
  // ⚠️ 5% 这条门槛和导线配色（mainBranchFlags / BRANCH_MIN）是同一个数：
  //     「什么算一条支路」在画面上和学生眼里必须是同一件事。
  function countPaths(usedBranches, compRec) {
    if (!usedBranches || !usedBranches.length) return 0;
    var n = usedBranches.length, i;
    // — ① 串联链折叠（并查集，key = 支路下标）—
    var byNode = {};                     // 节点 → 接在它上面的支路下标
    for (i = 0; i < n; i++) {
      var b = usedBranches[i];
      (byNode[b.p] = byNode[b.p] || []).push(i);
      if (b.q !== b.p) (byNode[b.q] = byNode[b.q] || []).push(i);   // 自环不算「两侧」
    }
    var parent = [];
    for (i = 0; i < n; i++) parent.push(i);
    function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
    Object.keys(byNode).forEach(function (k) {
      var list = byNode[k];
      if (list.length !== 2) return;     // 度数为 2 才是「一段路上的一个中间点」
      var ra = find(list[0]), rb = find(list[1]);
      if (ra !== rb) parent[ra] = rb;
    });
    // — ② 每条复合支路的电流 = 链上任意一个元件的 rec.i（串联处处相等）—
    var groups = new Map();
    for (i = 0; i < n; i++) {
      var r = find(i);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(usedBranches[i]);
    }
    var tot = 0, vals = [];
    groups.forEach(function (bs) {
      var cur = 0;
      for (var k = 0; k < bs.length; k++) {
        var rec = compRec && compRec[bs[k].comp.id];
        var v = rec ? Math.abs(rec.i || 0) : 0;
        if (v > cur) cur = v;
      }
      vals.push(cur);
      if (cur > tot) tot = cur;
    });
    if (!(tot > 1e-9)) return 1;         // 没有电流（断路 / 开关断开）：整体算一条
    var tol = Math.max(1e-9, tot * 1e-6);
    var paths = 0;
    for (i = 0; i < vals.length; i++) {
      if (vals[i] >= BRANCH_MIN * tot && vals[i] <= tot - tol) paths++;
    }
    return paths || 1;                   // 纯串联回路也报 1 条
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
        var unit = (c.type === 'ammeter' ? 'A' : 'V');
        // ① 读数大到【量程的 METER_BURN_K 倍】⇒ 动圈烧了（比打表更重的一档）。
        //    判据挂在 rangeWired 上（见 fillMeterRange）：量程必须是【导线真的
        //    接在那个量程柱上】的那个，参数里的 range 只是显示值 —— 拿它判，
        //    没接线 / 接错柱的表会凭空烧掉。
        //    理由里带上实际读数与倍数：烧掉之后 rec.reading 已经是 0，那个数
        //    再也读不回来，而它正是「超了多少才烧」这个问题的答案。
        if (r.rangeWired && Math.abs(r.reading) >= METER_BURN_K * r.range) {
          outC.push({ id: c.id, fault: 'burnt',
            why: '读数 ' + Math.abs(r.reading).toFixed(2) + unit + ' 达到量程 ' +
                 r.range + unit + ' 的 ' + METER_BURN_K + ' 倍以上，表头烧坏' });
        } else if (r.overRange) {
          outC.push({ id: c.id, fault: 'over',
            why: '读数超过量程 ' + r.range + unit + '，指针向右打表损坏' });
        } else if (r.reversed) {
          outC.push({ id: c.id, fault: 'rev', why: '正负接线柱接反，指针向左打表损坏' });
        }
      } else if (c.type === 'galvanometer') {
        // 中心零表：【不判反接】。反向偏转是它的正常工作状态（「检验电流方向」
        // 就靠这一条），照电流表那套判会让它一接上就「坏」。
        // 只判两档，门槛与电流表同一个：超过满偏 = 打表（两侧都算）；
        // 超过满偏 METER_BURN_K 倍 = 动圈烧断。
        if (!r.wired) return;
        var guo = galUnitOf(r.range);
        var gk = guo.k, gu = guo.u;
        var gFull = (r.range * gk).toFixed(0);
        if (Math.abs(r.reading) >= METER_BURN_K * r.range) {
          outC.push({ id: c.id, fault: 'burnt',
            why: '读数 ' + (Math.abs(r.reading) * gk).toFixed(1) + gu +
                 ' 达到满偏 ' + gFull + gu + ' 的 ' + METER_BURN_K +
                 ' 倍以上，动圈烧断' });
        } else if (r.overRange) {
          outC.push({ id: c.id, fault: 'over',
            why: '读数超过满偏 ±' + gFull + gu + '，指针打表损坏' });
        }
      }
    });

    // ── 短路环上的电表：方程解不出来，但表照样烧 ────────────────
    // 🔴 这一支【不能并进上面的元件循环】：理想电源被零阻通路短接时方程奇异、
    //    results.components 是空表，上面那个循环一个元件都进不去（`if (!r) return`）。
    //    所以「电流表直接接在电源两极上」这条最该烧表的路，恰恰是读数判据够不着
    //    的地方 —— 必须按拓扑认（见 shortCircuitInfo 的 loopIds）。
    var loopIds = (results.shortCircuit && results.shortCircuit.loopIds) || [];
    if (loopIds.length) {
      var loopSet = {};
      loopIds.forEach(function (id) { loopSet[id] = 1; });
      components.forEach(function (c) {
        if (!loopSet[c.id] || c.fault) return;
        // 灵敏电流计也在这里：它内阻只有几欧，接在电源两极上同样是一根短路线
        // —— 而且它的动圈比电流表更细，这一条路更该烧。
        if (c.type !== 'ammeter' && c.type !== 'voltmeter' && c.type !== 'galvanometer') return;
        if (outC.some(function (x) { return x.id === c.id; })) return;
        outC.push({ id: c.id, fault: 'burnt',
          why: ((TYPES[c.type] && TYPES[c.type].label) || '电表') +
               '直接接在电源两极之间，电流过大烧坏表头' });
      });
    }

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
    // 满偏 → 单位换算（灵敏电流计）。绘制层 / 电路图 / 损坏文案共用这一份。
    galUnitOf: galUnitOf,
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
    // 表头烧坏的门槛（量程的几倍）。导出是给自检用的：断言要拿【同一份】倍数
    // 去对账，而不是在测试里再抄一个 2 —— 抄一份就等于把「实现改了、测试还绿」
    // 这个洞留着。
    METER_BURN_K: METER_BURN_K,
    BATT_MAX_I: BATT_MAX_I,
    // 短路环识别。导出是为了让自检能拿一个【手搓的场景】直接问「这条环上都有
    // 谁」—— 理想电源被短接时方程无解、读数一个都拿不到，只有拓扑判据能验。
    shortCircuitInfo: shortCircuitInfo,
    // 干路 / 支路（并联电路的导线配色）。纯函数，喂 (components, flows, results)
    // 进去看它给哪几根导线打了「干路」标记。
    mainBranchFlags: mainBranchFlags,
    BRANCH_MIN: BRANCH_MIN,
    // 支路数（教材口径）。状态栏「N 条支路」印的是它，不是 branchCount。
    countPaths: countPaths,
    // 导体板：电阻率表 + R=ρL/S。导出给 3D 构建器按材料配色（铜偏红、
    // 镍铬发亮），也给测试拿同一份 ρ 对账。
    PLATE_MATERIALS: PLATE_MATERIALS,
    plateR: plateR,
    // 导体板：材料电阻率表 + R = ρ·L/S。导出给面板与 3D 标签用 ——
    // 「这块板是镍铬 1m 0.5mm²」这句话必须在页面和求解器里是同一份。
    PLATE_MATERIALS: PLATE_MATERIALS,
    plateMaterial: plateMaterial,
    plateR: plateR,
    // 电阻示教板的四根丝：材料 / 直径 / 长度 / 现算出来的阻值。
    // 绘制层按这个顺序画（也就是端子 2i/2i+1 的顺序），面板按它列规格 ——
    // 各抄一份的话，学生照着板上的「①」去接线会接到另一根丝。
    PLATE_WIRES: PLATE_WIRES,
    // 铅笔芯：规格（0.5mm / 120mm）、型号电阻率表、R = ρ·L/S。
    // 绘制层要用 LEN_MM 把「夹子局部 x」换算成「接入多少毫米」，
    // 面板要用型号表列选项 —— 两处都问这里，别各自抄一份。
    PENCIL: PENCIL,
    PENCIL_GRADES: PENCIL_GRADES,
    pencilGrade: pencilGrade,
    pencilLen: pencilLen,
    pencilR: pencilR,
    version: '1.5.0',
  };
});
