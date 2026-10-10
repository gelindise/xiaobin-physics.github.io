/*!
 * circuit-params.js —— 参数面板规格 + 读数显示格式（2D / 3D 沙盒共用）
 *
 * 从「电路实验沙盒.html」原样抽出（内联 → 独立模块），内容与行为一字未改：
 *   PARAM_UI  每类元件能调什么，面板由它生成
 *   TYPE_LABEL 元件类型 → 中文名
 *   POLAR      哪些元件的电流/电压要带符号显示
 *   num1       读数的小数位（一律一位，0.0 但非 0 的小量往下补位）
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
  var PARAM_UI = {
    resistor:  [{k:'R', t:'range', label:'阻值', unit:'Ω', min:1, max:100, step:1}],
    battery:   [{k:'emf', t:'range', label:'电动势', unit:'V', min:1.5, max:7.5, step:1.5},
                {k:'rInt', t:'range', label:'内阻', unit:'Ω', min:0, max:2, step:0.1},
                // 「对调」不是一条能拧的数，是【把元件原地调个头】——所以它和
                // 量程一样走按钮（t:'flip'），走的是 editor.flipComp()，
                // 由它同时翻 params.flip 和交换挂在元件上的导线端点。
                {k:'flip', t:'flip', label:'极性'}],
    switch:    [{k:'closed', t:'check', label:'闭合'}],
    // ── 学生电源 ──────────────────────────────────────────────
    // 一台【输出电压可调】的直流稳压源。键仍叫 emf（内核 describeComponent
    // 读的就是它，学生电源和干电池共用同一条电压源支路），但标签写「输出电压」
    // —— 面板上印的是给人看的字，键是内核语义，两者不必同名。
    //   范围 1.5~15V / 步进 0.5：初中实验真正会用到的那几档都在里面（3V 点小
    //   灯泡、6V 做欧姆定律、9~12V 做电磁铁），0.5V 的步进也够把灯泡从暗调到亮；
    //   再细没有意义（真旋钮也拧不出 0.1V 的重复精度）。
    //   内阻默认 0（稳压源），但这一格留着：把它调大，就能看见「接上负载以后
    //   输出电压掉下去」——「电源有内阻」这个概念的实物入口。
    power:     [{k:'emf', t:'range', label:'输出电压', unit:'V', min:1.5, max:15, step:0.5},
                {k:'rInt', t:'range', label:'内阻', unit:'Ω', min:0, max:2, step:0.1},
                {k:'flip', t:'flip', label:'极性'}],
    // 量程不是拧出来的参数，是「线接在哪个量程柱上」——所以这两个表的量程
    // 走 t:'tap'（点一下把导线挪到那个柱子上），选项和柱号都取自内核的 TYPES，
    // 页面这边不再抄一份量程数值。
    ammeter:   [{k:'range', t:'tap', label:'量程', unit:'A'},
                // 数字示数【默认不显示】：真实的指针表就是靠读刻度盘的，
                // 一上来就把数字印在表上，学生练的就不是「读数」而是「抄数字」。
                // 参数面板里可以打开，开了以后表盘下方多一行数字 —— 用来
                // 对照自己读得对不对，或者做练习模式时把答案显出来。
                {k:'showValue', t:'check', wide:1, label:'在表盘上显示读数'}],
    voltmeter: [{k:'range', t:'tap', label:'量程', unit:'V'},
                {k:'showValue', t:'check', wide:1, label:'在表盘上显示读数'},
                // 「理想电压表不分流」是课本给初中生的简化模型，但它【不是真的】：
                // 真实电压表有一份很大的内阻，接进电路就会偷走一点点电流。
                // 勾上这一项，表就按 3kΩ 的真实内阻参与求解 —— 接它的两根导线上
                // 会真的流过约 1mA，画成淡红空心箭头（见 drawWire 的 opts.weak），
                // 和主回路的实心红箭头一眼分得开。默认不勾 = 课本的理想模型。
                {k:'weakI', t:'check', wide:1, label:'模拟微弱电流（真实表内阻）'}],
    rheostat:  [{k:'Rmax', t:'range', label:'最大阻值', unit:'Ω', min:5, max:50, step:5},
                {k:'slide', t:'range', label:'滑片位置', unit:'', min:0, max:1, step:0.01}],
    // 灯泡多一个【单独的选项】：灯丝电阻随温度升高而增大。
    //   勾上（默认）= 真灯泡，R 随自身功率变，小电压下 R 掉到 1Ω 出头；
    //   取消 = 当定值电阻，R 恒为额定电阻 U额²/P额（课本「不计温度影响」那一步）。
    // 这一行是整句话的标签，比「额定电压」长得多，68px 的标签栏装不下（会挤成
    // 两行把勾选框顶偏），所以走 wide：标签占满剩余宽度，勾选框贴右边。
    bulb:      [{k:'ratedV', t:'range', label:'额定电压', unit:'V', min:1.5, max:6, step:0.5},
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
    led:'发光二极管', motor:'电动机', bell:'电铃', power:'学生电源'};

  // 无极性元件的电流/电压要显示大小，不能显示符号。
  // 内核里 rec.i 记的是「从 0 号端子流向 1 号端子」，而 0 号端子在元件的哪一侧
  // 只是绘制时的朝向——电阻转 180° 接进回路还是同一个电阻。直接把带符号的
  // 数印出来，串联回路里的开关就会显示 −0.1000A，学生只会以为电路接反了。
  // 只有极性本身就承载信息的元件（电表接反要报错、电源充电放电是两回事、
  // 二极管和电动机接反是「不导电」和「反转」两件不同的事）才带符号。
  var POLAR = {ammeter:1, voltmeter:1, battery:1, led:1, motor:1, power:1};

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

  function dispI(c, r){
    var s = POLAR[c.type] ? r.i : Math.abs(r.i);
    var tag = '';
    // 电动机的「反接」要写成「反转」：接反不是接错了线，是转子往反方向转。
    if (r.reversed) tag = '<span class="tag">' + (r.reverseLabel || '反接') + '</span>';
    else if (c.type === 'battery' && r.i < -1e-9) tag = '<span class="tag">充电</span>';
    return num1(s) + tag;
  }
  function dispU(c, r){
    return num1(POLAR[c.type] ? r.v : Math.abs(r.v));
  }
  // 表格里的 R 一列。开关按通断写 0/∞，变阻器写【实际接入】的那一段，
  // 其余按求解出来的等效电阻写；解不出来（断路、被烧掉）写破折号。
  // 侧栏表格和点元件弹出的浮层共用一份 —— 两处各写一套的话，迟早有一处
  // 会把开关的 ∞ 写成 NaN。
  function fmtR(c, r){
    if (c.type === 'switch') return r.closed ? '0' : '∞';
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
    dispI: dispI,
    dispU: dispU,
    fmtR: fmtR,
    pval: pval,
    version: '1.0.0',
  };
});
