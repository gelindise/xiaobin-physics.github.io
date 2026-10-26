/*!
 * circuit-params.js —— 参数面板规格 + 读数显示格式（2D / 3D 沙盒共用）
 *
 * 从「电路实验沙盒.html」原样抽出（内联 → 独立模块），内容与行为一字未改：
 *   PARAM_UI  每类元件能调什么，面板由它生成
 *   TYPE_LABEL 元件类型 → 中文名
 *   POLAR      哪些元件的电流/电压要带符号显示
 *   num1 / num2 读数的小数位（num1 一位；num2 两位，给电流表用。
 *               0.0 / 0.00 但非 0 的小量往下补位）
 *   dispI / dispU / fmtR  表格与浮层的 I / U / R 显示
 *   pval       取参数当前值（含电压表「模拟微弱电流」这种派生量的换算）
 *
 * 抽出来的唯一目的：让 3D 沙盒与 2D 沙盒读【同一份】真值 —— 2D 改了面板
 * 规格，3D 自动跟着变，不会两边各写一套、迟早对不上。
 *
 * 依赖：circuit-core.js（pval 要 C.defaultParams）。调用时现取，不要求加载顺序。
 *
 *   Node:    const P = require('./circuit-params.js')
 *   浏览器:  <script src="circuit-params.js"></script>  → window.CircuitParams
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CircuitParams = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var G = (typeof self !== 'undefined') ? self
        : (typeof global !== 'undefined') ? global : this;
  function core() { return G.CircuitCore; }

  // ── 参数面板 ──────────────────────────────────────────────
  // 每类元件能调什么，写在这里；面板由它生成，不写死 HTML。
  // 电表「调零」那一行：两只表共用同一份，改一处两处一起变。
  // dflt = 'on'：老存档里没写 zeroMode 的（或者离屏工具手搓的 comp），
  // 面板上要亮「已调零」—— 判据是 params.zeroed 的真值，不是这个键存不存在。
  var ZERO_ROW = {k:'zeroMode', t:'pick', label:'调零', dflt:'on',
                  options:[{v:'on', label:'已调零'}, {v:'off', label:'未调零'},
                           {v:'rand', label:'随机'}]};
  var PARAM_UI = {
    // 定值电阻：滑条之外再给一个【数字输入框】（num:1）。
    // 用户第 6 点：阻值要能手动输入、而且可以是小数。
    //   · 滑条 min/step 一起收到 0.1 —— 以前是 1Ω 一档，8.5Ω 这种值根本拧不出来；
    //   · 数字框的上下限放宽到 0.1 ~ 9999（滑条只有 0.1~100）：课堂上用得到的
    //     大电阻（几百欧）也填得进去，而滑条够不着时它就停在那一端，不回写
    //     数字框（见页面 wireParamInputs 里那段）。
    resistor:  [{k:'R', t:'range', label:'阻值', unit:'Ω', min:0.1, max:100, step:0.1,
                 num:1, nmin:0.1, nmax:9999, nstep:0.1}],
    // 导体板：三个旋钮正好是课本那三个因素 —— 材料（ρ）、长度 L、横截面积 S，
    // R = ρ·L/S 由求解器现算（读数表 R 列直接读它）。这里只给输入，
    // 不给「阻值」滑条：那个数是算出来的，再给人拧一遍就和公式对不上了。
    plate:     [{k:'material', t:'select', label:'材料',
                 options:['copper','manganin','constantan','nichrome'],
                 labels:{copper:'铜', manganin:'锰铜', constantan:'康铜', nichrome:'镍铬合金'}},
                {k:'length', t:'range', label:'长度', unit:'m', min:0.2, max:2, step:0.1},
                {k:'section', t:'range', label:'横截面积', unit:'mm²', min:0.1, max:2, step:0.05}],
    // ── 电阻示教板（四根现成的丝）────────────────────────────
    // 这块板【没有可调的物理量】：四根丝的规格是固定的，做对照实验靠
    // 「把导线挪到另一对柱子上」，不靠拖滑条。所以面板上只有一行开关 ——
    // 板面上印不印规格。关掉只留序号 ①②③④，可以拿来做盲测
    // （让学生自己按电流大小判断哪根阻值大）。
    rheoboard: [{k:'showSpec', t:'check', wide:1, label:'在板面印出每根丝的规格'}],
    // ── 铅笔芯（课本图 16.4-1「用铅笔芯控制小灯泡的亮度」）───────
    // 两个旋钮正好是这个实验的两个自变量：
    //   len   = 夹子移到哪儿 —— 课本问的「灯泡亮度怎样变化」全靠它；
    //   grade = 换一根芯（材料变了，电阻率跟着变）。
    // 长度和画布上的移动夹【双向联动】：拖夹子改的是同一个 params.len，
    // 拖这根滑条夹子也跟着走（面板每次重绘都从参数取值）。
    // 下限 10mm 不是随手给的：再短就接近把电源短路，灯丝会烧断。
    // 上限 120mm = 长款铅笔芯全长（内核 PENCIL.LEN_MAX 必须跟着改）：
    // 行程翻倍，夹子同样拖一格，电阻变的是原来的 2 倍。
    pencil:    [{k:'len', t:'range', label:'接入长度', unit:'mm', min:10, max:120, step:1},
                {k:'grade', t:'select', label:'铅笔芯型号',
                 options:['HB','2B','6B'],
                 labels:{HB:'HB（硬）', '2B':'2B（中软）', '6B':'6B（软）'}}],
    // 标签写「电源电压」不写「电动势」：画布和电路图上现在都标 U（用户第 2 点），
    // 面板上再写 E 就是两套记号。键仍是 emf —— 内核语义，不动。
    battery:   [{k:'emf', t:'range', label:'电源电压', unit:'V', min:1.5, max:7.5, step:1.5},
                {k:'rInt', t:'range', label:'内阻', unit:'Ω', min:0, max:2, step:0.1},
                // 「对调」不是一条能拧的数，是【把元件原地调个头】——所以它和
                // 量程一样走按钮（t:'flip'），走的是 editor.flipComp()，
                // 由它同时翻 params.flip 和交换挂在元件上的导线端点。
                {k:'flip', t:'flip', label:'极性'}],
    switch:    [{k:'closed', t:'check', label:'闭合'}],
    // ── 单刀双掷开关 ──────────────────────────────────────────
    // 它没有「断开」这一档：刀片永远搭在某一侧，面板上就是「掷 1 / 掷 2」
    // 两个互斥的档位（t:'pick' —— 点一下换档，不动导线）。
    // 和电表量程的 t:'tap' 分开：量程那几个按钮点下去是【把导线挪到另一个
    // 柱子上】，会改接线；这里只改一个参数，线一根都不动。
    spdt:      [{k:'throw', t:'pick', label:'刀片',
                 options:[{v:1, label:'掷 1'}, {v:2, label:'掷 2'}]}],
    // ── 学生电源 ──────────────────────────────────────────────
    // 一台【输出电压可调】的直流稳压源。键仍叫 emf（内核 describeComponent
    // 读的就是它，学生电源和干电池共用同一条电压源支路），但标签写「输出电压」
    // —— 面板上印的是给人看的字，键是内核语义，两者不必同名。
    //   范围 3~36V / 步进 0.5：面板旋钮上印的 12 档（3 / 6 / 9 … 36）都在里面，
    //   0.5V 的步进够把灯泡从暗调到亮；再细没有意义（真旋钮也拧不出 0.1V 的
    //   重复精度）。⚠️ 改这里的 min/max 必须同步改 circuit-draw 的
    //   PSU.VMIN / PSU.VMAX —— 刻度盘上的数字和旋钮能拧到的范围是同一条线。
    //   内阻默认 0（稳压源），但这一格留着：把它调大，就能看见「接上负载以后
    //   输出电压掉下去」——「电源有内阻」这个概念的实物入口。
    power:     [{k:'emf', t:'range', label:'输出电压', unit:'V', min:3, max:36, step:0.5},
                {k:'rInt', t:'range', label:'内阻', unit:'Ω', min:0, max:2, step:0.1},
                // 面板上那颗方形电源开关的第二个入口。勾选态直接读 params.on
                // （默认 true，见 circuit-core 的 TYPES.power.defaults）——
                // 画布上点一下开关和在这里勾一下，改的是同一个键。
                {k:'on', t:'check', wide:1, label:'电源开关（面板上那颗）'},
                {k:'flip', t:'flip', label:'极性'}],
    // 量程不是拧出来的参数，是「线接在哪个量程柱上」——所以这两个表的量程
    // 走 t:'tap'（点一下把导线挪到那个柱子上），选项和柱号都取自内核的 TYPES，
    // 页面这边不再抄一份量程数值。
    ammeter:   [{k:'range', t:'tap', label:'量程', unit:'A'},
                // 调零三选一（用户 2026-10-17 第 3 点）：默认【已调零】，
                // 老师想讲「不调零读数不可信」就切到「未调零」，也可以选
                // 「随机」—— 每台表建出来的时候掷一次硬币（结果冻在
                // params.zeroed 里，不会一帧一个样）。
                // 键是 zeroMode，真正生效的仍是 zeroed（见内核 TYPES 注释）。
                ZERO_ROW,
                // 数字示数【默认不显示】：真实的指针表就是靠读刻度盘的，
                // 一上来就把数字印在表上，学生练的就不是「读数」而是「抄数字」。
                // 参数面板里可以打开，开了以后表盘下方多一行数字 —— 用来
                // 对照自己读得对不对，或者做练习模式时把答案显出来。
                {k:'showValue', t:'check', wide:1, label:'在表盘上显示读数'}],
    voltmeter: [{k:'range', t:'tap', label:'量程', unit:'V'},
                ZERO_ROW,
                {k:'showValue', t:'check', wide:1, label:'在表盘上显示读数'},
                // 「理想电压表不分流」是课本给初中生的简化模型，但它【不是真的】：
                // 真实电压表有一份很大的内阻，接进电路就会偷走一点点电流。
                // 勾上这一项，表就按 3kΩ 的真实内阻参与求解 —— 接它的两根导线上
                // 会真的流过约 1mA，画成淡红空心箭头（见 drawWire 的 opts.weak），
                // 和主回路的实心红箭头一眼分得开。默认不勾 = 课本的理想模型。
                {k:'weakI', t:'check', wide:1, label:'模拟微弱电流（真实表内阻）'}],
    // ── 灵敏电流计 ────────────────────────────────────────────
    // 满偏【不是】「线接在哪根柱子上」—— 它只有两根柱子（− / +），所以这里
    // 走 t:'pick'（只改参数、一根线都不动），不是电流表那种 t:'tap'。
    // 三档都是实验室里印得出来的规格，刻度数字跟着满偏等比走：
    //   30mA → 印 −30…30（默认，这个沙盒的电源/负载正好用得到）
    //   3mA  → 印 −3…3
    //   30μA → 印 −30…30，单位改成 μA（真表 J0409 就是这一档）
    // 单位由绘制层按满偏自动选（见 circuit-draw 的 galUnitOf），面板这里
    // 只负责把三档摆出来 —— 两处各写一份「多少以下算 μA」迟早差 1000 倍。
    galvanometer: [
                {k:'range', t:'pick', label:'满偏', options:[
                  // 标签写成紧凑的「±30mA」而不是「±30 mA」：参数面板那三个
                  // 按钮是 flex:1，中间加空格在窄面板上会把 μA 那一档折成两行。
                  {v:0.03, label:'±30mA'}, {v:0.003, label:'±3mA'},
                  {v:0.00003, label:'±30μA'}]},
                ZERO_ROW,
                // 内阻：真表几十~上百欧。默认 2Ω 是「看得见但拧不走样」的那个数；
                // 要讲「电表本身也有电阻」就往大拧（最大 50Ω，够把回路电流压下去一半）。
                {k:'rInternal', t:'range', label:'内阻', unit:'Ω', min:0, max:50, step:0.5},
                {k:'showValue', t:'check', wide:1, label:'在表盘上显示读数'}],
    rheostat:  [{k:'Rmax', t:'range', label:'最大阻值', unit:'Ω', min:5, max:50, step:5},
                {k:'slide', t:'range', label:'滑片位置', unit:'', min:0, max:1, step:0.01}],
    // ── 电位器 ────────────────────────────────────────────────
    // 两个旋钮和变阻器是同一对（总阻值 + 滑片位置），但「滑片位置」在画布上
    // 是【转角】而不是横向位移 —— 学生也可以直接拖画面上那根滑片臂。
    // 两条路改的是同一个 params.pos（画布拖动走 editor，滑条走这里）。
    // 步进 0.01 和变阻器一致：面板上的数与画布上臂的角度必须对得上，
    // 一边给 0.42、另一边停在 0.4237 就会被当成两个状态（撤销栈也会多一条）。
    potentiometer: [
                {k:'Rmax', t:'range', label:'最大阻值', unit:'Ω', min:5, max:50, step:5},
                {k:'pos', t:'range', label:'滑片位置', unit:'', min:0, max:1, step:0.01}],
    // 灯泡多一个【单独的选项】：灯丝电阻随温度升高而增大。
    //   勾上（默认）= 真灯泡，R 随自身功率变，小电压下 R 掉到 1Ω 出头；
    //   取消 = 当定值电阻，R 恒为额定电阻 U额²/P额（课本「不计温度影响」那一步）。
    // 这一行是整句话的标签，比「额定电压」长得多，68px 的标签栏装不下（会挤成
    // 两行把勾选框顶偏），所以走 wide：标签占满剩余宽度，勾选框贴右边。
    //
    // ★ 2026-10-16 用户第 5 点：滑条「不太方便」—— 所以最上面加一行
    //   【常用规格】按钮（t:'preset'，点一下同时写 ratedV + ratedW），
    //   滑条一根不动地留着（要细调还是它）。
    //   三个规格都是初中实验室里真的发得出来的小灯泡：
    //     2.5V 0.75W（0.3A）—— 最常见的那只，测小灯泡电功率就用它
    //     3.8V 1.1W（0.3A）—— 手电筒灯泡
    //     1.5V 0.3W（0.2A）—— 一节干电池就能点亮的小电珠
    //   ⚠️ 按钮上只印「电压 / 功率」两行，不写电流：面板宽度只够三个按钮
    //      各占 58px，再塞一个数就挤成一团。电流写在 title 里（悬停可见）。
    //   ⚠️ ratedV 的滑条步进从 0.5 收到 0.1：3.8V 不是 0.5 的整数倍，步进
    //      还留 0.5 的话，按下 3.8V 那个按钮之后滑条会停在 4.0，和旁边的
    //      数字自相矛盾。
    bulb:      [{k:'preset', t:'preset', label:'常用规格', options:[
                  {label:'2.5V', sub:'0.75W', title:'2.5V 0.75W（0.3A）—— 实验室最常见的小灯泡',
                   set:{ratedV:2.5, ratedW:0.75}},
                  {label:'3.8V', sub:'1.1W', title:'3.8V 1.1W（0.3A）—— 手电筒灯泡',
                   set:{ratedV:3.8, ratedW:1.1}},
                  {label:'1.5V', sub:'0.3W', title:'1.5V 0.3W（0.2A）—— 一节干电池就能点亮的小电珠',
                   set:{ratedV:1.5, ratedW:0.3}}]},
                {k:'ratedV', t:'range', label:'额定电压', unit:'V', min:1.5, max:6, step:0.1},
                {k:'ratedW', t:'range', label:'额定功率', unit:'W', min:0.2, max:3, step:0.1},
                {k:'tempDependent', t:'check', wide:1, label:'灯丝电阻随温度升高而增大'}],
    // 二极管的「颜色」不是一个装饰参数，它就是规格本身：换一根管子等于换一个
    // 正向压降。所以下拉框里把压降一起写出来（labels），学生换到蓝管时看得见
    // 「3.1V」这个数 —— 再看一眼电源只有 3V，就知道为什么它不亮。
    led:       [{k:'color', t:'select', label:'颜色',
                 options:['red','green','blue'],
                 labels:{red:'红色 1.8V', green:'绿色 2.1V', blue:'蓝色 3.1V'}},
                {k:'flip', t:'flip', label:'极性'}],
    // 电动机的三项都是【铭牌上印得出来的数】：线圈电阻、空载电流、转速常数。
    // 空载电流单独给一格，是因为「转起来电流反而很小」这件事全看它 ——
    // 学生把它调大调小，再对照堵转那一挡，这条规律就自己浮出来了。
    motor:     [{k:'Rcoil', t:'range', label:'线圈电阻', unit:'Ω', min:1, max:12, step:0.5},
                {k:'noLoadI', t:'range', label:'空载电流', unit:'A', min:0.02, max:0.1, step:0.01},
                {k:'rpmPerV', t:'range', label:'转速常数', unit:'转/V', min:300, max:1400, step:100},
                {k:'stall', t:'check', wide:1, label:'卡住转子（堵转）'},
                {k:'flip', t:'flip', label:'极性'}],
    // 电铃只有两个旋钮，但它们正好就是「电磁铁磁性强弱跟什么有关」的两个答案：
    // 电流（由线圈电阻和电压定）与匝数。调小任何一个，磁动势掉到吸合线以下，
    // 衔铁就吸不动、铃不响了。
    bell:      [{k:'Rcoil', t:'range', label:'线圈电阻', unit:'Ω', min:5, max:60, step:5},
                {k:'turns', t:'range', label:'线圈匝数', unit:'匝', min:200, max:1200, step:100}],
  };
  var TYPE_LABEL = {battery:'电源', resistor:'定值电阻', switch:'开关',
    ammeter:'电流表', voltmeter:'电压表', rheostat:'滑动变阻器', bulb:'小灯泡',
    led:'发光二极管', motor:'电动机', bell:'电铃', power:'学生电源',
    // 灵敏电流计：刻度零点在正中、能双向偏转的那只表（J0409）。
    // 名字照教材写全称，不缩成「电流计」——「灵敏」两个字正是它和电流表的
    // 全部区别：满偏只有几十毫安，用来测微弱电流 / 看电流方向。
    galvanometer:'灵敏电流计',
    // 单刀双掷开关：教材上它出现在「楼梯开关」那道题里（楼上楼下各一只，
    // 任何一只都能点亮 / 熄灭同一盏灯）。名字照教材写全称，不缩成「双掷开关」。
    spdt:'单刀双掷开关',
    // 导体板：探究电阻的影响因素那块实验板（R = ρ·L/S）。
    plate:'导体板',
    // 电阻示教板：四根现成的电阻丝，换一根只要挪两根导线（不用拧滑条）。
    rheoboard:'电阻示教板',
    // 电位器：三根引出线 a / b / c，转柄改滑片位置（人教版 16.4 最后一件器材）。
    // 名字就用课本上的叫法，不写成「可变电阻器」—— 课本上这两个名字指两件器材。
    potentiometer:'电位器',
    // 铅笔芯：课本图 16.4-1 那根自动铅笔芯。名字就用课本上的叫法。
    pencil:'铅笔芯'};

  // 无极性元件的电流/电压要显示大小，不能显示符号。
  // 内核里 rec.i 记的是「从 0 号端子流向 1 号端子」，而 0 号端子在元件的哪一侧
  // 只是绘制时的朝向——电阻转 180° 接进回路还是同一个电阻。直接把带符号的
  // 数印出来，串联回路里的开关就会显示 −0.1000A，学生只会以为电路接反了。
  // 只有极性本身就承载信息的元件（电表接反要报错、电源充电放电是两回事、
  // 二极管和电动机接反是「不导电」和「反转」两件不同的事）才带符号。
  var POLAR = {ammeter:1, voltmeter:1, battery:1, led:1, motor:1, power:1,
    // 灵敏电流计必须带符号：中心零的表，正负就是指针偏向哪一边。
    // 取绝对值会把「向左偏 18mA」印成「18mA」——那正是它最该教的反向偏转。
    galvanometer:1};

  // ── 读数的小数位 ────────────────────────────────────────────
  // 一律【一位小数】：读数框、侧栏那张 I/U/R/P 表、点元件弹出的浮层，全走它。
  // 之前是 toFixed(4)，屏幕上印着「0.3000 A」「0.7500 W」—— 多出来的那三位
  // 既读不出来也没有物理意义（真实的学生电表只能估读到分度值的下一位）。
  // 唯一的例外：本该是 0.0 却【不是】0 的小量（0.04A、0.005A）。一位小数会把
  // 它们印成「0.0」，看着就是「没有电流」—— 那不是精度问题，是说了假话。
  // 这种值往下补一位、还不够再补一位；别的值一位不动。
  function num1(v){
    var x = +v;
    if (!isFinite(x)) return '—';
    var s = x.toFixed(1);
    if (x !== 0 && parseFloat(s) === 0) {
      s = x.toFixed(2);
      if (parseFloat(s) === 0) s = x.toFixed(3);
    }
    return s;
  }

  // 电流表的读数：两位小数。0.6A 量程的分度值是 0.02A，一位小数会把 0.13
  // 印成 0.1 —— 和指针指的位置对不上（用户报的就是这个）。
  // 和 num1 同一条原则：本该是 0.00 却【不是】0 的小量往下补一位，不印假话。
  function num2(v){
    var x = +v;
    if (!isFinite(x)) return '—';
    var s = x.toFixed(2);
    if (x !== 0 && parseFloat(s) === 0) s = x.toFixed(3);
    return s;
  }

  // 电表的示数：未调零时指针偏了 ZERO_OFF×量程，读数得跟着偏 —— 唯一真值在
  // circuit-draw 的 meterIndicated。它没加载时（离屏出图、单文件测试）退回真值。
  function meterShow(c, r){
    var D = G.CircuitDraw;
    if (D && typeof D.meterIndicated === 'function') return D.meterIndicated(c, r);
    return null;
  }
  // 灵敏电流计的读数：满偏只有几十毫安，一位小数会把 18mA 印成「0.0」，
  // 两位小数会把 μA 档印成「0.00」。所以按数量级自动给小数位 ——
  // 最少 3 位（0.018）、μA 档 5 位（0.00002）。符号必须留着（见 POLAR）。
  function galNum(v){
    var x = +v;
    if (!isFinite(x)) return '—';
    if (x === 0) return '0';
    var a = Math.abs(x);
    var d = (a >= 0.01) ? 3 : (a >= 0.001 ? 4 : 5);
    return x.toFixed(d);
  }
  function dispI(c, r){
    var raw = r.i;
    // 电流表那一格印的是【它自己的示数】；电压表的 I 列是流过它的电流，与调零无关。
    if (c.type === 'ammeter') { var m = meterShow(c, r); if (m != null) raw = m; }
    // 灵敏电流计同理：读数带符号（偏转方向），小数位按数量级走。
    // 而且【连单位一起给】（29.412 mA / 18.0 μA）—— 满偏是几十毫安，
    // 只写「0.029」的话学生要在脑子里换算一次才看得出偏了多少；
    // 表盘上印的也是 mA，两处对得上号。
    if (c.type === 'galvanometer') {
      var g = meterShow(c, r); if (g == null) g = r.reading;
      var gu = (G.CircuitCore && G.CircuitCore.galUnitOf)
        ? G.CircuitCore.galUnitOf(r.range || 0.03) : { u: 'mA', k: 1e3 };
      return galNum(g * gu.k) + ' ' + gu.u;
    }
    var s = POLAR[c.type] ? raw : Math.abs(raw);
    var tag = '';
    // 电动机的「反接」要写成「反转」：接反不是接错了线，是转子往反方向转。
    if (r.reversed) tag = '<span class="tag">' + (r.reverseLabel || '反接') + '</span>';
    else if (c.type === 'battery' && r.i < -1e-9) tag = '<span class="tag">充电</span>';
    return (c.type === 'ammeter' ? num2(s) : num1(s)) + tag;
  }
  function dispU(c, r){
    var raw = r.v;
    if (c.type === 'voltmeter') { var m = meterShow(c, r); if (m != null) raw = m; }
    // 灵敏电流计：U 是它自己两端的分压，没有「方向」可言 —— 符号只对电流
    // （指针偏向哪边）有意义。照 POLAR 印一个负电压，学生会以为哪里接反了。
    if (c.type === 'galvanometer') return num1(Math.abs(raw));
    return num1(POLAR[c.type] ? raw : Math.abs(raw));
  }
  // 表格里的 R 一列。开关按通断写 0/∞，变阻器写【实际接入】的那一段，
  // 其余按求解出来的等效电阻写；解不出来（断路、被烧掉）写破折号。
  // 侧栏表格和点元件弹出的浮层共用一份 —— 两处各写一套的话，迟早有一处
  // 会把开关的 ∞ 写成 NaN。
  function fmtR(c, r){
    if (c.type === 'switch') return r.closed ? '0' : '∞';
    // 单刀双掷开关：刀片永远搭在某一侧 ⇒ 恒为 0Ω（它没有「断开」这一档，
    // 所以这里不能写成 r.closed ? '0' : '∞' 再复用上一行）。
    if (c.type === 'spdt') return '0';
    if (c.type === 'rheostat') return r.rUsed == null ? '∞' : num1(r.rUsed);
    return r.R == null ? '—' : num1(r.R);
  }

  function pval(c, k){
    if (c.params && c.params[k] != null) return c.params[k];
    // 电压表的「模拟微弱电流」不是一个独立参数，它就是【rInternal 有没有值】。
    // 单独存一份布尔量的话，两者迟早对不上：撤销栈、存档往返、预设电路各自
    // 只恢复其中一个，于是面板上勾着、求解器里还是理想表（或者反过来）——
    // 而画面上「有没有微弱电流」全看 rInternal，勾选框就成了一个说谎的控件。
    if (k === 'weakI') return !!(c.params && c.params.rInternal > 0);
    var d = core().defaultParams(c.type);
    return d[k];
  }

  return {
    PARAM_UI: PARAM_UI,
    TYPE_LABEL: TYPE_LABEL,
    POLAR: POLAR,
    num1: num1,
    num2: num2,
    // galNum —— 灵敏电流计读数的小数位（按数量级自适应，见上面那段）。
    // 页面的大读数牌也用它：表盘上的数字和侧栏表必须是同一套规则。
    galNum: galNum,
    dispI: dispI,
    dispU: dispU,
    fmtR: fmtR,
    pval: pval,
    version: '1.2.0',
  };
});
