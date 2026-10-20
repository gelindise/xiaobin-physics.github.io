/* ============================================================
 * circuit-editor.js —— 电路画布编辑交互
 * ------------------------------------------------------------
 * 职责：网格吸附、元件拖拽、端子拉线、正交走线、选中与删除。
 * 依赖：circuit-draw.js（要它算端子世界坐标、拿元件外形尺寸）
 * 不含：物理求解（core 的事）、页面外壳与参数面板（各实验页的事）
 *
 * 分层约定：编辑器只改 scene 数据，改完调 opts.onChange()，
 * 由宿主决定怎么重算、怎么重绘。编辑器自己不碰求解器。
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CircuitEditor = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // UMD 的 root 只是外层 IIFE 的形参，工厂函数体内看不见它，得自己取一次全局。
  var G = (typeof self !== 'undefined') ? self
        : (typeof global !== 'undefined') ? global : this;

  var GRID = 20;          // 网格吸附步长
  var TERM_HIT = 17;      // 端子命中半径（像素，逻辑坐标）
  var WIRE_HIT = 9;       // 导线命中距离
  // 拖动导线时【中间那几个拐点】能挪多远（逻辑像素）。两端接线柱是钉死的，
  // 动的只有拐点 —— 所以这根线永远是「从同一个柱子到同一个柱子，只是绕了个弯」，
  // 不会掉下来、也不会改变电路拓扑。
  // 上限 90 是量出来的：沙盒里两个相邻元件之间通常 150~300px，90 够把线从
  // 元件正上方绕到旁边去；再大就会和邻居元件的导线糊在一起，看着像两根线打架。
  var WIRE_DRAG_MAX = 90;

  // 自动编号前缀。变阻器不能也取 R，否则和定值电阻撞号。
  // 二极管取 D、电动机取 M、电铃取 B —— 都是课本上认得出的字母
  // （D = diode，M = motor，B = bell），不会和已有的 E/S/R/V/A/L/RH 撞。
  // 学生电源取 U：它的面板、读数框、电路图铭牌上标的都是「U = 6.0 V」
  // （见 circuit-params 的 PARAM_UI 与 circuit-schematic 的 valueOf），
  // 编号跟着用 U 就一眼对得上。E 已经给干电池了（电动势），不能撞。
  var ID_PREFIX = {
    // 🔴 电源的编号用 U（用户 2026-10-17 第 2 点：「电源的符号用 U 表示，
    // 不要用 E」）。学生电源（power）本来就叫 U —— 两个电源共用同一个前缀
    // 是【对的】：编号靠 while (byId(...)) 顺延，不会撞，画面上就是 U1 / U2。
    resistor: 'R', battery: 'U', switch: 'S',
    ammeter: 'A', voltmeter: 'V', rheostat: 'RH', bulb: 'L',
    // 灵敏电流计取 G（galvanometer）：和 A / V 一样是「表上印的那个字母」，
    // 学生看一眼表盘中央那个 G 就认得出画布上哪只是它。
    galvanometer: 'G',
    led: 'D', motor: 'M', bell: 'B',
    power: 'U',
    // 导体板（探究电阻的影响因素）：一块金属条，两个接线柱。
    plate: 'P',
    // 铅笔芯：取 PC（pencil core）。不能也用 P —— 导体板已经占了，两块板
    // 编号撞在一起时学生光看编号分不出谁是谁（和变阻器避开 R、单刀双掷
    // 避开 S 是同一条理由）。
    pencil: 'PC',
    // 电阻示教板（四根电阻丝）：取 RB（rheoboard）。和变阻器的 RH 分开 ——
    // 两块板长得像、名字也像，编号再撞就分不清谁是谁了。
    rheoboard: 'RB',
    // 单刀双掷开关：取 SP 而不是 S。虽然「编号不重复」那条 while 循环本身
    // 就能挡住撞号（byId 查得到就往后跳），但和普通开关共用 S 的话，
    // 一块板上会数出 S1 / S2 两只【长得完全不一样】的开关，面板和读数表里
    // 光看编号分不出谁是谁 —— 这正是变阻器当初避开 R、另取 RH 的同一条理由。
    spdt: 'SP',
    // 接线点（导线中间自动长出来的结点）。它【不在元件栏里】—— 学生不是
    // 「放一个接线点」，而是从接线柱往导线中间连线时它自己冒出来。
    junction: 'J',
  };

  // 元件外形半宽 / 半高，用于点选。数值必须和 circuit-draw.js 里实际画的一致，
  // 否则会出现「点得到但看不见」或「看得见却点不到」。
  var BODY = {
    resistor:  [54, 22],
    battery:   [66, 40],
    // 开关 / 灯泡：底板铺在导线下方（±70），刀片和玻璃泡长在导线上方。
    // 和 CircuitDraw.bodyBox 取同一组数，否则「点得到但看不见 / 看得见却点不到」。
    // 这里比 bodyBox 的 hh 略小一号：命中框是【上下对称】的，给满就会向上
    // 抢走邻居元件的点击；刀尖和玻璃泡顶那 20px 抓不到无伤大雅。
    switch:    [70, 62],
    // 单刀双掷：和开关同一块底板、同一个命中框（本体高度也相同 —— 翘起
    // 那一头刀片顶到 −62）。数字必须和 CircuitDraw.bodyBox('spdt') 一致，
    // 否则「点得到但看不见 / 看得见却点不到」。
    // 刀片 96 长、远端还有柄 ⇒ 命中框跟着放宽（点刀片那一带也要能选中 / 换掷位）
    spdt:      [104, 64],
    bulb:      [70, 72],
    // 三个新元件和开关 / 灯泡一样是「示教板」：底板铺在导线下方（±70），
    // 本体长在板面上方。命中框取【上下对称】的盒子，所以 hh 要够到本体最高处；
    // 接线柱落在 ±70 上也没关系 —— onDown 里 hitTerminal 排在 hitComp 前面，
    // 「从柱子上拉线」那一下永远先被端子接走。
    led:       [70, 46],
    motor:     [70, 60],
    bell:      [70, 60],
    // 导体板：底板铺在导线下方，金属条贴在板面正面（y = 6 ~ 27，不往上长）。
    // hw 给 90 而不是 70：板子照旧 ±70，但金属条在 2D 里最长到 ±47、
    // 3D 里条长随 length 变（30 + L×38），命中框要连条子一起罩住才点得到。
    // 卡在 70 以内会让「点在条子上」落空 —— 而条子正是学生最想点的那一块。
    // ⚠️ 不能超过 100：接线柱在 ±70，hw 再大柱子就被圈进盒子里，
    //    「导线夹在柱子上」会被误判成「导线穿过元件」（见 bodyBox 的注释）。
    plate:     [90, 34],
    // 电阻示教板：板面 ±84、上下 ±66；命中框的【半宽取 76】= 柱子所在的
    // 那一列，再宽一点八根柱子就被圈进盒子里（见 CircuitDraw.bodyBox 的
    // 注释：柱子被圈进去，导线夹在柱上会被判成「穿过元件」）。
    // 高给 66：整块板从 −66 到 +66，上下对称的命中框正好罩住。
    rheoboard: [76, 66],
    // 铅笔芯：同一块示教板（±146，跟着 216px 长的芯走），芯顶 −25.4、板底 30。
    // 命中框给 34 和 CircuitDraw.bodyBox('pencil') 的 hh=30 基本一致，略放一点。
    // ⚠️ 半宽必须和 bodyBox 的 hw 一致：两边一旦不同，拖动元件的抓取区和
    //    「导线穿过元件」的判定就各说各话。
    pencil:    [146, 34],
    // 两只表的仪器本体全部落在导线【上方】（三个接线柱在底部探出来），
    // 所以高只有表壳+底座这一截，不是上下对称的。
    ammeter:   [100, 70],
    voltmeter: [100, 70],
    // 灵敏电流计：同一只表壳、同一块底座 ⇒ 命中框和电流表一字不差。
    // 两根柱子也钉在 ±70 上（和表头同一个位置），hitTerminal 排在 hitComp
    // 之前，「从柱子上拉线」那一下永远先被端子接走。
    galvanometer: [100, 70],
    rheostat:  [78, 31],
    // 学生电源：整台机箱（前面板 ±106，右侧面再厚 18 ⇒ 最右 124；顶面抬高 12
    // ⇒ 最上 −66；下沿 44）。命中框上下对称，所以 hh 给 61 而不是 66 ——
    // 顶面最上面那几像素抓不到无伤大雅，给满反而会向下抢走邻居元件的点击。
    // 🔴 必须和 CircuitDraw.bodyBox('power') 取同一套口径。
    power:     [124, 61],
    // 接线点：小圆点。命中框贴着它给 —— 给大了会从邻居元件那里抢走点击。
    junction:  [9, 9],
  };

  function create(opts) {
    var canvas = opts.canvas;
    var W = opts.W, H = opts.H;
    var D = opts.draw || G.CircuitDraw;
    var getScene = opts.getScene;
    var onChange = opts.onChange || function () {};
    var onSelect = opts.onSelect || function () {};
    // 「点一下某个元件」——按下到松开之间没有拖动才算（拖元件、拉线、拨滑片都不算），
    // 位置给的是逻辑坐标，宿主自己判断点没点在该点的地方（例如电表的表盘）。
    // 编辑器不知道宿主拿这一下干什么（沙盒用它开表盘放大镜），所以只报事件。
    var onTap = opts.onTap || function () {};

    // 「这一下点在某个元件的【名字标签】上了吗」—— 标签是宿主画的（页面每帧
    // 把实际画出去的那个小圆角框记在 tagDrawn 里），编辑器看不见，所以只能问宿主。
    // 返回 true = 这一下已经被宿主吃掉（它开了改名输入框），编辑器别再拿它去
    // 拉线 / 拖元件 / 选中。onHoverTag 同一条路子，只用来把光标换成输入光标 ——
    // 不换的话学生根本不知道那行字是可以点的。
    var onHitTag = opts.onHitTag || null;
    var onHoverTag = opts.onHoverTag || null;

    // 「发生了一件值得出声的事」——接上线、拔掉线、通断开关、放上/拿走元件、
    // 撤销。和 onTap 同一条路子：编辑器只报事件，不替宿主决定要不要响、响什么。
    // 音效必须挂在【动作真的发生的那一行】上，不能靠每帧比对场景猜：比对分不出
    // 「接了一根线」和「挪了一个元件」，也分不出「撤销回上一状态」和「手动改回去」。
    var onEvent = opts.onEvent || function () {};
    function report(name, data) {
      // 音效是锦上添花，绝不能因为它的回调抛异常就把编辑操作卡死 ——
      // 这里每处调用都排在场景已经改完之后，抛出去会跳过 changed()，
      // 画面就停在旧状态，看着像页面卡住了。
      try { onEvent(name, data); } catch (e) {}
    }

    var selected = null;      // {kind:'comp'|'wire', id} 或 {kind:'wire', index}
    var hover = null;         // {kind:'term', compId, termIdx} | {kind:'comp'|'wire', ...}
    var moving = null;        // 拖元件 {id, dx, dy}
    var slider = null;        // 拨变阻器滑片 {id, moved}
    // 拖铅笔芯的移动夹 {id, dx, moved}。dx = 按下那一刻「夹口 x − 鼠标局部 x」，
    // 每一帧都用它把夹口摆回鼠标下面 —— 抓住夹子的哪一头都不会跳。
    var clipDrag = null;
    var psuKnob = null;       // 拧学生电源的电压旋钮 {id, moved}
    // 拖旋转钮 {id, a0, r0, moved}：a0 = 按下那一刻鼠标相对元件中心的角度，
    // r0 = 按下那一刻的角度。每一帧都从 r0 + 角度差重算，而不是在上一帧的结果上
    // 继续加 —— 后者在快速转圈时会因为丢帧而越积越多（和 wireDrag 同一条规矩）。
    var rotating = null;
    var wiring = null;        // 拉导线 {from:{compId,termIdx}, cur:{x,y}, to:{...}|null}
    // 拖导线 {index, x0, y0, via0, mid0, moved}。两端接线柱钉死，动的是中间拐点。
    // via0 / mid0 记的是【按下那一刻】的形状：每一帧都从它 + 总位移重算，
    // 而不是在上一帧的结果上继续加 —— 后者会让位移越积越大，松手前就冲到天上。
    var wireDrag = null;
    var lastPointer = {x: 0, y: 0};

    // 撤销栈：每一步改动前压一份深拷贝。栈深 40 足够，再多也没人按得回来。
    var undoStack = [], UNDO_MAX = 40;
    var muted = false;

    function clone(o) { return JSON.parse(JSON.stringify(o)); }
    function pushUndo() {
      if (muted) return;
      undoStack.push(clone({ comps: getScene().comps, wires: getScene().wires }));
      if (undoStack.length > UNDO_MAX) undoStack.shift();
    }

    // 按下时先拍一张快照揣着，等【真的改了东西】再入栈。
    // 直接在 pointerdown 里 pushUndo 的话，点一下元件选个中就多一条撤销记录，
    // 点三次再按 ⌘Z 得连按三次才动得了东西。快照要记在按下这一刻（不是松手时），
    // 否则拖动后记录的是移动后的位置，撤销就成了原地踏步。
    var pending = null;
    function beginEdit() {
      if (!pending) pending = clone({ comps: getScene().comps, wires: getScene().wires });
    }
    function commitEdit() {
      if (pending && !muted) {
        undoStack.push(pending);
        if (undoStack.length > UNDO_MAX) undoStack.shift();
      }
      pending = null;
    }
    function discardEdit() { pending = null; }

    // ---------- 几何 ----------
    function toLogical(ev) {
      var rect = canvas.getBoundingClientRect();
      return { x: (ev.clientX - rect.left) * W / rect.width,
               y: (ev.clientY - rect.top) * H / rect.height };
    }
    function snap(v) { return Math.round(v / GRID) * GRID; }

    function byId(id) {
      var cs = getScene().comps;
      for (var i = 0; i < cs.length; i++) if (cs[i].id === id) return cs[i];
      return null;
    }

    // 导线【一个端点】的世界坐标。全部走 D.endWorld：
    // 元件还在 ⇒ 端子坐标；元件被删了 ⇒ 端点里冻住的 x/y（见 removeSelected）。
    // 绝不要再写 D.terminalWorld(byId(e.compId), e.termIdx) —— 元件一没，
    // byId 返回 null，terminalWorld 当场抛错，整条渲染链就断了。
    function endPt(e) {
      if (!e) return null;
      return D.endWorld(byId(e.compId), e);
    }
    // 这个端点是【悬空】的吗（挂着的元件已经不在了）。悬空的线头可以再被
    // 拖到别的接线柱上（见 onDown 里那一段）。
    function isLooseEnd(e) { return !!(e && !e.compId); }

    // 端点对象的规范化拷贝。悬空端（compId 为 null）必须把 x/y 一起带上 ——
    // 元件删掉以后导线还在（见 removeSelected），线头的坐标就只存在端点里，
    // 拷贝时漏掉它，接出来的新线当场算不出形状（endWorld 返回 null）。
    function cpEnd(e) {
      var o = { compId: (e.compId == null) ? null : e.compId, termIdx: e.termIdx || 0 };
      if (o.compId == null) { o.x = e.x; o.y = e.y; }
      return o;
    }

    // 点中一个【悬空的线头】。命中框比接线柱（TERM_HIT=13）再大一点：线头
    // 没有柱子那样的实体，只有一根线尖，小了根本瞄不准。
    // 只认真正悬空的端 —— 挂在元件上的那一头永远由 hitTerminal 负责，
    // 两者同时命中时接线柱优先（见 onDown 的顺序）。
    var LOOSE_HIT = 16;
    function hitLooseEnd(p) {
      var ws = getScene().wires;
      for (var i = ws.length - 1; i >= 0; i--) {
        var w = ws[i];
        for (var k = 0; k < 2; k++) {
          var e = k ? w.b : w.a;
          if (!isLooseEnd(e)) continue;
          if (Math.hypot(e.x - p.x, e.y - p.y) <= LOOSE_HIT) {
            return { index: i, k: k ? 'b' : 'a', x: e.x, y: e.y };
          }
        }
      }
      return null;
    }

    function bodyHalf(c) {
      var b = BODY[c.type] || [50, 50];
      return (c.rot === 90 || c.rot === 270) ? [b[1], b[0]] : [b[0], b[1]];
    }
    // 命中框 / 选中框在【元件自身坐标系】里的矩形。
    //
    // 皮肤可以声明这件器材实际占多大地盘（D.hitBoxOf）—— 课本插图那套外形
    // 和原版差得远（开关的手柄往左伸出去一大截、表头是一整台仪器），照原版
    // 那张对称表算，症状就是「点手柄点不着」和「选中虚线框只框住表盘下半截」。
    // 皮肤没声明就退回 BODY，原版行为一个字节没变。
    function localBox(c) {
      if (D.hitBoxOf) {
        var b = D.hitBoxOf(c);
        if (b) return b;
      }
      var h = BODY[c.type] || [50, 50];
      return { x0: -h[0], y0: -h[1], x1: h[0], y1: h[1] };
    }
    function hitComp(p, c) {
      // 🔴 在【局部坐标】里判：原来的写法是拿世界坐标跟半宽比，只在 rot=0
      //    时对；转过的元件要么点不着要么点得到旁边。toLocal 把位姿一次算清。
      var l = D.toLocal(c, p.x, p.y);
      var b = localBox(c);
      return l.x >= b.x0 - 4 && l.x <= b.x1 + 4 &&
             l.y >= b.y0 - 4 && l.y <= b.y1 + 4;
    }
    // 变阻器滑片能不能一把抓住。几何全部从 D.RHEO 取，和绘制同源；
    // 命中框比滑片本体放大一点（+6），不然 14px 宽的小凸起很难瞄准。
    var KNOB_SLACK = 6;
    function hitSlider(p) {
      var cs = getScene().comps;
      for (var i = cs.length - 1; i >= 0; i--) {
        var c = cs[i];
        if (c.type !== 'rheostat') continue;
        var l = D.toLocal(c, p.x, p.y);
        var sx = D.sliderLocalX(D.slideOf(c));
        if (l.y >= D.RHEO.knobTop - KNOB_SLACK && l.y <= D.RHEO.knobBottom + KNOB_SLACK &&
            Math.abs(l.x - sx) <= D.RHEO.knobHalf + KNOB_SLACK) return c;
      }
      return null;
    }
    // 滑片在元件自身坐标系里占的矩形，覆盖层画高亮时用
    function knobRect(c) {
      var sx = D.sliderLocalX(D.slideOf(c));
      return { x: sx - D.RHEO.knobHalf, y: D.RHEO.knobTop,
               w: D.RHEO.knobHalf * 2, h: D.RHEO.knobBottom - D.RHEO.knobTop };
    }

    // 铅笔芯的移动夹能不能一把抓住。几何全部从 D.PENCIL / D.clipLocalX 取，
    // 和绘制同源。命中框比夹子本体放大一点（+7）：夹子只有 31×22，投影到
    // 大屏上还要再缩，不给余量根本瞄不准。
    // 🔴 命中区是「夹口 → 夹尾」这一整段（不是夹口一个点）：学生想抓的是
    //    那只看得见的夹子，而夹口那一端被芯挡着、最不好点。
    var CLIP_SLACK = 7;
    function clipHitRect(c) {
      var cx = D.clipLocalX(D.pencilLenOf(c));
      // 夹身从夹口（cx）往右伸到 35（含绝缘套），上下 ±10
      return { x0: cx - 4 - CLIP_SLACK, x1: cx + 35 + CLIP_SLACK,
               y0: D.PENCIL.Y - 10 - CLIP_SLACK, y1: D.PENCIL.Y + 10 + CLIP_SLACK };
    }
    function hitClip(p) {
      var cs = getScene().comps;
      for (var i = cs.length - 1; i >= 0; i--) {
        var c = cs[i];
        if (c.type !== 'pencil') continue;
        var l = D.toLocal(c, p.x, p.y);
        var r = clipHitRect(c);
        if (l.x >= r.x0 && l.x <= r.x1 && l.y >= r.y0 && l.y <= r.y1) return c;
      }
      return null;
    }
    // 夹到 0~1，并对齐参数面板 range 的 step=0.01：不对齐的话面板滑块会
    // 和画布上的滑片显示不一致（面板显示 0.42，画布其实在 0.4237）。
    function slideClamp(v) {
      return Math.round(Math.max(0, Math.min(1, v)) * 100) / 100;
    }
    // 学生电源的电压旋钮能不能一把抓住。几何全部从 D.PSU 取，和绘制同源；
    // 命中框比旋钮本体放大一点（+7），不然那只旋钮很难瞄准。
    // ⚠️ 学生电源可以「对调极性」（params.flip ⇒ 绘制层 ctx.scale(-1,1)），
    //    而 D.toLocal 只做旋转+平移、不做镜像，所以这里要自己把 x 翻回来 ——
    //    不翻的话，翻转过的电源上旋钮的命中区会跑到面板左半边去。
    var PSU_SLACK = 7;
    // 元件自身坐标系里的一点，在不在【面板开关】那块命中框里。
    // hitPsuSwitch / hitPsuKnob 共用它，因为这两块框必须【互斥】：
    // 旋钮框是「圆心 KNOB 半径 r + SLACK」的整圆，最左 −67；开关框的右边沿是
    // SW.x + SW.w/2 + SLACK = −63 —— 两者在 x 上叠了 4px，在 y 上也叠着
    // （开关框上沿 5−7 = −2、旋钮框下沿 29）。不排除的话，点在开关右上角
    // 那一片时「按下去抓的是旋钮、松手翻的却是开关」：同一个点，两条路。
    function inPsuSwitchRect(l) {
      var r = psuSwitchRect();
      if (!r) return false;
      return l.x >= r.x - PSU_SLACK && l.x <= r.x + r.w + PSU_SLACK &&
             l.y >= r.y - PSU_SLACK && l.y <= r.y + r.h + PSU_SLACK;
    }
    function hitPsuKnob(p) {
      var cs = getScene().comps, S = D.PSU;
      if (!S) return null;
      for (var i = cs.length - 1; i >= 0; i--) {
        var c = cs[i];
        if (c.type !== 'power') continue;
        var l = D.toLocal(c, p.x, p.y);
        if (D.flipOf(c)) l.x = -l.x;
        if (inPsuSwitchRect(l)) continue;      // 开关那一块归 hitPsuSwitch
        // 旋钮是一只【拧在竖直前表面上的圆柱】：贴面板那一圈（法兰）是整圆，
        // 半径 S.KNOB.r；顶面再沿前表面法线偏出去一点（都在这个整圆里面）。
        // 🔴 原来是按椭圆判的（半轴 r / 0.6r），那是照着「竖直轴的椭圆」那个旧
        //    画法写的。现在旋钮是整圆，再按椭圆判的话下半圈有 8px 抓不住 ——
        //    症状是「看得见却拧不动」，而且只在旋钮的下半圈出现，很难查。
        if (Math.hypot(l.x - S.KNOB.x, l.y - S.KNOB.y) <= S.KNOB.r + PSU_SLACK) return c;
      }
      return null;
    }
    // 面板上那颗方形电源开关占的矩形（元件自身坐标系）。页面点它一下要通断，
    // 所以判据必须和绘制同源 —— 这里直接读 D.PSU.SW，别在页面里再抄一份坐标。
    function psuSwitchRect() {
      var S = D.PSU;
      if (!S || !S.SW) return null;
      return { x: S.SW.x - S.SW.w / 2, y: S.SW.y - S.SW.h / 2, w: S.SW.w, h: S.SW.h };
    }
    // 鼠标这一下是不是落在学生电源【面板那颗方形开关】上。
    // 和 hitPsuKnob 一个规矩：几何读 D.PSU.SW、自己把 flip 的镜像补回来。
    //
    // ⚠️ 判据必须比绘制【宽一点点】：SW 是 20×30 的一块小凹槽，照原样判的话
    //    学生得瞄准到像素级。四周各放 PSU_SLACK。
    // 🔴 放完这两块框是【真的叠着】的：旋钮中心 (−38, 0)、半径 22 ⇒ 命中框是
    //    半径 29 的整圆，x ∈ [−67, −9]、y ∈ [−29, 29]；开关框 x ∈ [−97, −63]、
    //    y ∈ [−2, 42]。交集 x ∈ [−67, −63] × y ∈ [−2, 29]。靠缩小框去躲是躲不掉的
    //    —— 旋钮要抓得住就得往外放，开关也是。所以判据不是「两块框不相交」，
    //    而是「**有效**集合不相交」：hitPsuKnob 里那句 inPsuSwitchRect 排除掉
    //    开关那一块，两个函数返回的元件集合就互斥了。自检要钉的也是这一条
    //    （整块面板逐像素扫：同一个点不许既被 hitPsuKnob 收下又被 hitPsuSwitch 收下）。
    function hitPsuSwitch(p) {
      var cs = getScene().comps;
      if (!psuSwitchRect()) return null;
      for (var i = cs.length - 1; i >= 0; i--) {
        var c = cs[i];
        if (c.type !== 'power') continue;
        var l = D.toLocal(c, p.x, p.y);
        if (D.flipOf(c)) l.x = -l.x;
        if (inPsuSwitchRect(l)) return c;
      }
      return null;
    }
    function hitTerminal(p) {
      var cs = getScene().comps;
      var best = null, bestD = TERM_HIT;
      for (var i = 0; i < cs.length; i++) {
        var n = D.TERMINALS[cs[i].type] ? D.TERMINALS[cs[i].type].length : 0;
        for (var t = 0; t < n; t++) {
          var q = D.terminalWorld(cs[i], t);
          var d = Math.hypot(q.x - p.x, q.y - p.y);
          if (d < bestD) { bestD = d; best = { compId: cs[i].id, termIdx: t, x: q.x, y: q.y }; }
        }
      }
      return best;
    }
    function segDist(p, a, b) {
      var vx = b.x - a.x, vy = b.y - a.y;
      var L2 = vx * vx + vy * vy;
      var t = L2 ? ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2 : 0;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
    }
    function hitWire(p) {
      var ws = getScene().wires;
      for (var i = ws.length - 1; i >= 0; i--) {
        var pts = pathOf(ws[i]);
        for (var j = 1; j < pts.length; j++) {
          if (segDist(p, pts[j - 1], pts[j]) < WIRE_HIT) return i;
        }
      }
      return -1;
    }
    // 导线的【原始折线】：两个接线柱 + 拐点，没有抹圆。
    // 抹圆后的路径（pathOf）只是同一根线的另一种画法 —— 拆分导线要在原始折线上
    // 做，拿抹圆后的点去切 via 数组对不上号（多出来的采样点会变成假拐点）。
    function rawPathOf(wr) {
      var p0 = endPt(wr.a), p1 = endPt(wr.b);
      if (!p0 || !p1) return [];
      var pts = [{ x: p0.x, y: p0.y }];
      (wr.via || []).forEach(function (v) { pts.push({ x: v[0], y: v[1] }); });
      pts.push({ x: p1.x, y: p1.y });
      return pts;
    }
    function pathOf(wr) {
      var pts = rawPathOf(wr);
      if (pts.length < 2) return pts;
      // 和页面那份 pathOf 走【同一个】圆角函数。这里是命中判据（hitWire 逐段
      // 量距离、delButtonPos 取中点），那边是绘制路径 —— 两边形状必须一模一样，
      // 否则「看得见却点不着」。首尾两点 roundPath 原样保留，所以导线不会
      // 从接线柱上掉下来。
      return D.roundPath(pts);
    }

    // 鼠标点离【导线的中间】最近的那一点。返回 { index, seg, q, pts, d }。
    // 判据用 WIRE_HIT（9px），和「点选导线」同一个数：能点中的地方就能接。
    // 落点取【线段上的最近点】而不是鼠标位置 —— 否则导线会从旁边 8px 处擦过去，
    // 看着像没接上。
    function nearestOnWire(p) {
      var ws = getScene().wires, best = null;
      for (var i = 0; i < ws.length; i++) {
        var pts = rawPathOf(ws[i]);
        for (var j = 1; j < pts.length; j++) {
          var a = pts[j - 1], b = pts[j];
          var vx = b.x - a.x, vy = b.y - a.y, L2 = vx * vx + vy * vy;
          if (L2 < 1e-9) continue;
          var t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2;
          t = Math.max(0, Math.min(1, t));
          var q = { x: a.x + vx * t, y: a.y + vy * t };
          var d = Math.hypot(p.x - q.x, p.y - q.y);
          if (d >= WIRE_HIT) continue;
          // 落点离两头接线柱太近就不值当长结点：那等于把线接在柱子边上，
          // 拆出来的一截只有几个像素，画面上是个疙瘩。
          var near = Math.min(Math.hypot(q.x - pts[0].x, q.y - pts[0].y),
                              Math.hypot(q.x - pts[pts.length - 1].x, q.y - pts[pts.length - 1].y));
          if (near < 18) continue;
          if (!best || d < best.d) best = { index: i, seg: j - 1, q: q, pts: pts, d: d };
        }
      }
      return best;
    }

    // ---------- 手绘走线 ----------
    // 导线按鼠标实际划过的轨迹走，而不是强制横平竖直——真实的实验台就是
    // 随手把导线搭过去。轨迹点直接存下来又太密（一次拖动几百个点），
    // 用 Douglas-Peucker 抽稀：只保留偏离直线超过 tol 的拐点，
    // 手抖产生的小波浪会被抹掉，真正拐弯的地方一个不丢。
    var TRAIL_TOL = 6;      // 抽稀容差（逻辑像素）
    var TRAIL_MIN = 5;      // 采样间距：移动不足这么远就不记点
    var VIA_MAX = 60;       // 单根导线的拐点上限，防止极端拖动撑爆场景数据

    // ---------- 停留成线 ----------
    // 用户要的第三起居线方式：从一个接线柱出发，拖到【任意一个点】（不必是接
    // 线柱、也不必压在导线上），在那里停住不动 ≥ DWELL_MS，这根线就直接成形 ——
    // 落点长出一颗接线点，途经的轨迹成为它的拐点。
    // 为什么是「停住」而不是「松手」：学生拉到一半总要停一下看看位置接得顺不
    // 顺，这一停就是两秒；改成松手才成线的话，中间每次停顿都会误接出一根线来。
    // ⚠️ 判据里必须带上 fromWire / to / snap 三个排除项（见 onMove）：
    //    悬空线头是「插回柱子」另一种动作，压着接线柱 / 导线时上面的规则优先。
    var DWELL_MS = 2000;    // 停这么久就自动成线
    var DWELL_SLACK = 8;    // 算「没动」的半径（逻辑像素）。比 TRAIL_MIN 大一点：
                           // 手再稳也会抖，卡太严永远计不满两秒。
    function nowMs() {
      return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    }
    // 定时器：指针停住之后【再也不来移动事件】，只靠 onMove 检查就永远接不上
    // （停在一秒九的学生永远等不到下一次 mousemove）。所以起一个闹钟，到点自己
    // 来查一次。onUp 里那句兜底照样留着 —— 闹钟被浏览器节流掉时它兜底。
    var dwellTimer = null;
    function clearDwellTimer() { if (dwellTimer) { clearTimeout(dwellTimer); dwellTimer = null; } }
    function dwellFire() {
      clearDwellTimer();
      if (!wiring || !wiring.dwellPt || wiring.fromWire || wiring.to || wiring.blocked || wiring.snap) return;
      if (nowMs() - wiring.dwellT < DWELL_MS) return;
      if (connectToPoint(wiring)) { wiring = null; changed(); }
    }
    // 计时期间让宿主重绘几次：进度环是画在画布上的，而画布只在变更时重绘 ——
    // 不补这几笔，环会停在刚开始那一小段不动，看着像卡住了。
    function dwellPulse() {
      clearTimeout(dwellPulse._t);
      if (!wiring || !wiring.dwellPt) return;
      if (nowMs() - wiring.dwellT > DWELL_MS + 300) return;
      dwellPulse._t = setTimeout(function () {
        if (wiring && wiring.dwellPt) { changed(); dwellPulse(); }
      }, 120);
    }

    function simplify(pts, tol) {
      var n = pts.length;
      if (n < 3) return pts.slice();
      var keep = new Array(n);
      keep[0] = keep[n - 1] = true;
      var stack = [[0, n - 1]];
      while (stack.length) {
        var seg = stack.pop(), i0 = seg[0], i1 = seg[1];
        if (i1 - i0 < 2) continue;
        var maxD = -1, idx = -1;
        for (var i = i0 + 1; i < i1; i++) {
          var d = segDist(pts[i], pts[i0], pts[i1]);
          if (d > maxD) { maxD = d; idx = i; }
        }
        if (maxD > tol && idx > 0) { keep[idx] = true; stack.push([i0, idx], [idx, i1]); }
      }
      var out = [];
      for (var k = 0; k < n; k++) if (keep[k]) out.push(pts[k]);
      return out;
    }

    // 手动导线的「原始形状」。元件被拖走以后，导线的拐点要跟着重新分布，
    // 每次都用这份原始形状重算，避免在已经位移过的点上反复叠加而漂移。
    // 混合权重按拐点在导线上的先后位置给：靠近被拖那一端的点跟着走，
    // 靠近另一端的不动——等效于把这根线重新拉顺，而不是整根平移到别处。
    function refitManual(w, p0, p1) {
      if (!w.base) return;
      var e0 = w.base.ends[0], e1 = w.base.ends[1];
      var dax = p0.x - e0[0], day = p0.y - e0[1];
      var dbx = p1.x - e1[0], dby = p1.y - e1[1];
      var src = w.base.via, n = src.length;
      var out = new Array(n);
      for (var i = 0; i < n; i++) {
        var s = (i + 1) / (n + 1);
        out[i] = [src[i][0] + dax * (1 - s) + dbx * s,
                  src[i][1] + day * (1 - s) + dby * s];
      }
      w.via = out;
    }

    // ---------- 正交走线 ----------
    // 两端同 x 或同 y 就直接连；否则走 Z 形：先横到中线，再竖，再横。
    // 中线位置会被「避让」逻辑左右挪，躲开已有的竖导线和元件本体——
    // 两根导线完全重叠时画面上只剩一条线，学生根本看不出是两根。
    // 现在只在「不让用户自己划」的场合用它（比如程序化搭的示例电路）。
    function routeTo(p0, p1, ignoreWireIdx) {
      if (Math.abs(p0.x - p1.x) < 8 || Math.abs(p0.y - p1.y) < 8) {
        return { via: [], pts: [{ x: p0.x, y: p0.y }, { x: p1.x, y: p1.y }] };
      }
      var base = snap((p0.x + p1.x) / 2);
      var y0 = Math.min(p0.y, p1.y), y1 = Math.max(p0.y, p1.y);
      var order = [0, GRID, -GRID, 2 * GRID, -2 * GRID, 3 * GRID, -3 * GRID, 4 * GRID, -4 * GRID];
      for (var k = 0; k < order.length; k++) {
        var mx = base + order[k];
        if (mx <= 4 || mx >= W - 4) continue;
        if (laneFree(mx, y0, y1, ignoreWireIdx)) {
          return { via: [[mx, p0.y], [mx, p1.y]],
                   pts: [{ x: p0.x, y: p0.y }, { x: mx, y: p0.y },
                         { x: mx, y: p1.y }, { x: p1.x, y: p1.y }] };
        }
      }
      // 实在找不到空位就用中线，至少形状是对的
      return { via: [[base, p0.y], [base, p1.y]],
               pts: [{ x: p0.x, y: p0.y }, { x: base, y: p0.y },
                     { x: base, y: p1.y }, { x: p1.x, y: p1.y }] };
    }
    function laneFree(x, y0, y1, ignoreWireIdx) {
      // 会不会压在元件身上
      var cs = getScene().comps;
      for (var i = 0; i < cs.length; i++) {
        var c = cs[i], h = bodyHalf(c);
        if (x > c.x - h[0] - 6 && x < c.x + h[0] + 6 &&
            y1 > c.y - h[1] - 6 && y0 < c.y + h[1] + 6) return false;
      }
      // 会不会和已有的竖导线重合
      var ws = getScene().wires;
      for (var j = 0; j < ws.length; j++) {
        if (j === ignoreWireIdx) continue;
        var pts = pathOf(ws[j]);
        for (var k = 1; k < pts.length; k++) {
          var a = pts[k - 1], b = pts[k];
          if (Math.abs(a.x - b.x) > 1) continue;              // 只看竖段
          if (Math.abs(a.x - x) > 4) continue;
          var lo = Math.min(a.y, b.y), hi = Math.max(a.y, b.y);
          if (hi > y0 - 4 && lo < y1 + 4) return false;
        }
      }
      return true;
    }

    function wiresOf(compId) {
      return getScene().wires.filter(function (w) {
        return w.a.compId === compId || w.b.compId === compId;
      });
    }

    // ---------- 表头的量程柱 ----------
    // 哪几个端子是量程柱只有内核一份定义（circuit-core 的 TYPES）。编辑器和
    // 求解器各写一份的话，迟早会打架：「求解器认为接在 3A 柱上读 3A、编辑器
    // 却不认这个柱子」，而且两边都看不出来。
    function meterTapsOf(type) {
      var T = G.CircuitCore && G.CircuitCore.TYPES && G.CircuitCore.TYPES[type];
      return (T && T.rangeTaps) ? T.rangeTaps : null;
    }
    // 这个接线柱上接着的导线下标，没接返回 -1
    function wireAt(compId, termIdx) {
      var ws = getScene().wires;
      for (var i = 0; i < ws.length; i++) {
        if ((ws[i].a.compId === compId && ws[i].a.termIdx === termIdx) ||
            (ws[i].b.compId === compId && ws[i].b.termIdx === termIdx)) return i;
      }
      return -1;
    }
    // 再连一根线（两端是 e0、e1）会不会让同一个表头的两个量程柱同时接上。
    // 两个量程柱同时接时读数取决于哪根线先接上，学生根本无从判断，所以直接
    // 不让接——这也正是课本上「每次只能用一个量程」那句话。
    function rangeConflict(e0, e1) {
      var ends = [e0, e1];
      for (var i = 0; i < ends.length; i++) {
        var e = ends[i], c = byId(e.compId), T = meterTapsOf(c && c.type);
        if (!T || T.indexOf(e.termIdx) < 0) continue;      // 不是量程柱，跟这条规矩无关
        for (var k = 0; k < T.length; k++) {
          var t = T[k];
          if (t === e.termIdx) continue;
          // 这根线的另一头就接在另一个量程柱上
          if (ends[1 - i].compId === e.compId && ends[1 - i].termIdx === t) return true;
          // 另一个量程柱上已经有一根线了
          if (wireAt(e.compId, t) >= 0) return true;
        }
      }
      return false;
    }
    // 把表头上接在另一个量程柱的那根导线挪到 tapIdx 柱上，参数面板的量程
    // 按钮调的就是它。实物上「选量程」本来就是「换一个柱子插线」，这样画面、
    // 读数、参数三者不可能不一致。
    function plugRange(compId, tapIdx) {
      var c = byId(compId), T = meterTapsOf(c && c.type);
      if (!T || T.indexOf(tapIdx) < 0) return false;       // 不是量程柱，无事可做
      var hit = null;                                      // 接在另一个量程柱上的那根线
      wiresOf(compId).forEach(function (w) {
        if (hit) return;
        ['a', 'b'].forEach(function (k) {
          var e = w[k];
          if (hit || e.compId !== compId) return;
          if (T.indexOf(e.termIdx) >= 0 && e.termIdx !== tapIdx) hit = { w: w, k: k };
        });
      });
      if (!hit) return false;
      pushUndo();
      hit.w[hit.k] = { compId: compId, termIdx: tapIdx };
      // 端点换了柱子，手绘的那个形状不再贴合新位置，改成自动正交走线，
      // 免得挪完以后导线横穿表壳。
      // ⚠️ 另一头可能是【悬空端】（挂在别的元件上的那件被删了），所以坐标一律
      // 走 endPt —— 不能写 terminalWorld(byId(...))，那对悬空端会当场抛错。
      var q0 = endPt(hit.w.a), q1 = endPt(hit.w.b);
      hit.w.auto = true; hit.w.base = null;
      if (q0 && q1) hit.w.via = routeTo(q0, q1, -1).via;
      changed();
      // 实物上「换量程」就是拔下来插到另一个柱子上，一声「咔」是对的。
      report('plug', { compId: compId, tap: tapIdx });
      return true;
    }

    // 参数面板上的「对调」按钮（电池 / 发光二极管 / 电动机）。
    // 实物上就是把元件【原地调个头】：正负记号换边，电流方向跟着反过来。
    // 两件事必须同时做，缺一件画面就自相矛盾：
    //   ① comp.params.flip 取反 —— 绘制层（terminalWorld 的 x 取负、本体
    //      的 ctx.scale(-1,1)）读它，正负记号与极性元件的外形整体翻面；
    //   ② 把挂在这个元件上的导线端点 termIdx 交换（0 ↔ 1）—— 线头【留在原地】。
    // 只做 ① 的话，0 号端子的世界坐标跳到另一头，接在上面的导线会被当场拽
    // 过去、横穿元件本体；只做 ② 的话元件根本没翻。
    // 合起来正好是「元件绕自身中心转 180°，导线一个像素都没动」。
    //
    // 只对【两端极性元件】开放。三柱表头、四柱变阻器的端子号是【功能编号】
    // （− 柱 / 量程柱 / A B C D），换号等于换一件元件，不在这个按钮的职责里。
    function flipComp(compId) {
      var c = byId(compId);
      if (!c) return false;
      var T = D.TERMINALS[c.type];
      if (!T || T.length !== 2) return false;
      pushUndo();
      c.params = c.params || {};
      c.params.flip = !c.params.flip;
      getScene().wires.forEach(function (w) {
        ['a', 'b'].forEach(function (k) {
          var e = w[k];
          if (!e || e.compId !== compId) return;
          e.termIdx = (e.termIdx === 0) ? 1 : 0;
        });
      });
      // 端点的【位置】没变，但元件本体翻了 —— 重走一遍走线，让正交导线按新
      // 的极性记号重新确认落点（手绘导线走 refitManual，位移为 0，形状不动）。
      rerouteAll();
      changed();
      report('flip', { comp: c });
      return true;
    }

    // ---------- 改场景 ----------
    function addComp(type, x, y) {
      pushUndo();
      var s = getScene();
      // 前缀表漏登记一个类型就直接抛。不抛的话下面 `ID_PREFIX[type] + n` 会
      // 得到 "undefined1"：两个同类元件还会撞成同一个 id（并查集把它们当成
      // 一个元件，读数全错），而画面上看不出任何异常 —— 只觉得「怎么算不对」。
      // 加新元件类型时忘了登记这一行，就该当场炸在放元件那一下。
      if (!ID_PREFIX[type]) throw new Error('ID_PREFIX 没有登记元件类型: ' + type);
      var n = 1;
      while (byId(ID_PREFIX[type] + n)) n++;      // 编号不重复，否则并查集会把两个元件当成一个
      var id = ID_PREFIX[type] + n;
      var c = { id: id, type: type, x: snap(x), y: snap(y),
                params: (G.CircuitCore && G.CircuitCore.defaultParams)
                  ? G.CircuitCore.defaultParams(type) : {} };
      s.comps.push(c);
      select({ kind: 'comp', id: id });
      changed();
      report('place', { comp: c });
      return c;
    }
    // 删掉选中的东西。⚠️ 删【元件】时导线一根都不删 —— 这是用户明确要的：
    // 「只删除这个用电器，而导线还是要保留的」。实物上就是「把元件从桌上拿走，
    // 两根线还躺在桌上」。做法是把挂在这个元件上的端点【冻住】：
    //   { compId:'SW1', termIdx:0 }  →  { compId:null, x:·, y:· }
    // 冻结坐标取【删之前】的端子世界坐标，所以线头一个像素都不动。
    // 从此这根线的这一头由 endWorld 读端点里的 x/y（见 circuit-draw 的 endWorld）。
    //
    // 只 filter 掉 comps 不碰 wires 是【不行】的：端点里还写着 SW1，而 SW1 已经
    // 不在场景里了 —— 页面每次重绘都要 byId('SW1') 拿端子坐标，拿到 null 就抛错，
    // 整条渲染链当场断掉（画面全黑，只剩一句报错）。
    function removeSelected() {
      if (!selected) return false;
      pushUndo();
      var s = getScene();
      if (selected.kind === 'comp') {
        var gone = byId(selected.id);
        s.wires.forEach(function (w) {
          ['a', 'b'].forEach(function (k) {
            var e = w[k];
            if (!e || e.compId !== selected.id) return;
            var p = endPt(e);              // 元件还在，先把端子坐标量出来
            if (p) { e.x = p.x; e.y = p.y; }
            e.compId = null;
            e.termIdx = 0;
          });
        });
        s.comps = s.comps.filter(function (c) { return c.id !== selected.id; });
        report('remove', { comp: gone });
      } else {
        var dead = s.wires[selected.index];
        s.wires.splice(selected.index, 1);
        report('unplug', { wire: dead });
      }
      selected = null;
      changed();
      return true;
    }
    // noUndo：批量改参数时用（小灯泡那三个「常用规格」按钮一次要写两个键，
    // 走三次 setParam 就是三条撤销记录，学生按 ⌘Z 得按三下才退回去）。
    // 调用方自己先 pushUndo() 拍一张快照，然后连着写。
    function setParam(id, key, val, noUndo) {
      var c = byId(id); if (!c) return;
      if (!noUndo) pushUndo();
      c.params = c.params || {};
      // 「值真的变了没有」必须在写进去之前问。参数面板上勾选框会连着发
      // input 和 change 两个事件，同一句话调两次 setParam —— 不判这一下，
      // 拨一次开关会响两声。
      var differs = (c.params[key] !== val);
      c.params[key] = val;
      // 元件的几何没变但导线可能要走新路，重算一遍 via
      rerouteAll();
      changed();
      if (differs && key === 'closed') report('switch', { comp: c, closed: !!val });
      // 学生电源面板上那颗方形开关走的是同一个声音：它和闸刀开关做的是同一件
      // 事（通 / 断），只是长在仪器上。键名是 'on' 不是 'closed'，因为它的语义
      // 是「这台仪器有没有开机」，和闸刀的「闸刀合上没有」是两回事 ——
      // 内核里 buildBranches 也只认 P.on === false 才断路。
      else if (differs && key === 'on') report('switch', { comp: c, closed: !!val });
    }

    // 给元件改名（画布上那个标签框里显示的字）。空 / 全空白 ⇒ 恢复自动编号
    // （等于「没改过」），所以「把名字清空」是一条正当操作，不是错误。
    //
    // ⚠️ 改的是【显示名】而不是 id。id 是元件的身份：导线端点的 compId、
    //    内核的 results.components[id]、并查集的 `id + ':' + termIdx` 节点名、
    //    撤销快照的键、存档里的引用 —— 全都认它（见 circuit-draw 的 nameOf）。
    //    换 id 等于换一个元件，上面每一处都要跟着重写，而且自动编号的
    //    「不重复」判据会漏 —— 改名成 L 之后再放一个灯泡又会冒出一个 L1。
    var NAME_MAX = 12;
    function setName(id, name) {
      var c = byId(id); if (!c) return false;
      // 连续空白压成一个空格、首尾去掉：中文输入法下很容易带出全角空格，
      // 而一个只有空白的名字等于「没名字」，与恢复默认是同一个语义。
      var v = (name == null) ? '' : String(name).replace(/\s+/g, ' ').trim();
      if (v.length > NAME_MAX) v = v.slice(0, NAME_MAX);
      var next = v ? v : null;
      if ((c.name || null) === next) return false;   // 值没变：别白入一条撤销记录
      pushUndo();
      if (next === null) delete c.name; else c.name = next;
      changed();
      return true;
    }
    function rotateSelected() {
      if (!selected || selected.kind !== 'comp') return;
      pushUndo();
      var c = byId(selected.id);
      c.rot = ((c.rot || 0) + 90) % 360;
      rerouteAll();
      changed();
    }
    function rerouteAll() {
      var s = getScene();
      s.wires.forEach(function (w) {
        var p0 = endPt(w.a), p1 = endPt(w.b);
        if (!p0 || !p1) return;                  // 悬空端的线：形状照旧，别动它
        if (w.auto) { w.via = routeTo(p0, p1, -1).via; return; }
        refitManual(w, p0, p1);          // 手绘导线：按原始形状重新贴合两端
      });
    }
    // 拖动元件的过程中只重贴合它身上的手绘导线。正交导线留到松手时再算，
    // 否则它们在拖动途中会不停跳线，看着像电路自己在抽搐。
    function refitWiresOf(compId) {
      var s = getScene();
      s.wires.forEach(function (w) {
        if (w.auto) return;
        if (w.a.compId !== compId && w.b.compId !== compId) return;
        var p0 = endPt(w.a), p1 = endPt(w.b);
        if (!p0 || !p1) return;
        refitManual(w, p0, p1);
      });
    }

    // ---------- 拖导线 ----------
    // 两端接线柱钉死，只挪中间拐点 —— 所以这根线永远是「从同一个柱子到同一个
    // 柱子，只是绕了个弯」，不会掉下来，也不会改变电路拓扑（读数一个数都不变）。
    // 原来一根「两点直线」的导线没有拐点可挪，第一次拖的时候给它现长一个
    // （在两端中点）：否则学生拖了半天线纹丝不动，只会以为这个功能是坏的。
    function clampLen(dx, dy, max) {
      var d = Math.hypot(dx, dy);
      if (d <= max || d < 1e-6) return { dx: dx, dy: dy };
      return { dx: dx / d * max, dy: dy / d * max };
    }
    // 拐点搬完以后重记「原始形状」。不重记的话，下一次拖别的元件触发
    // refitManual 时，它会按【拖之前】的形状把线拉回去 —— 学生看到的是
    // 「我刚摆好的线，一碰别的元件就弹回原位」。
    // 只对本来就有 base 的导线做：预设电路里那些正交导线没有 base，
    // 给它们补一个会改变「拖元件时导线怎么跟」的既有行为。
    function refreshWireBase(wr) {
      if (!wr.base) return;
      var p0 = endPt(wr.a), p1 = endPt(wr.b);
      if (!p0 || !p1) return;
      wr.base = { ends: [[p0.x, p0.y], [p1.x, p1.y]],
                  via: (wr.via || []).map(function (z) { return [z[0], z[1]]; }) };
    }
    function wireDragBegin(index, p) {
      var wr = getScene().wires[index];
      if (!wr) return false;
      var pts = rawPathOf(wr);
      if (pts.length < 2) return false;
      wireDrag = {
        index: index, x0: p.x, y0: p.y, moved: false,
        via0: (wr.via || []).map(function (z) { return [z[0], z[1]]; }),
        mid0: { x: (pts[0].x + pts[pts.length - 1].x) / 2,
                y: (pts[0].y + pts[pts.length - 1].y) / 2 },
      };
      beginEdit();          // 快照揣着，真拖动了才入栈（和拖元件同一条规矩）
      return true;
    }
    function wireDragTo(p) {
      var wr = getScene().wires[wireDrag.index];
      if (!wr) return false;
      // 每帧都从【按下那一刻】的形状 + 总位移重算，不在上一帧结果上继续加：
      // 后者会让位移越积越大，手还没松线就冲到画布外面去了。
      var d = clampLen(p.x - wireDrag.x0, p.y - wireDrag.y0, WIRE_DRAG_MAX);
      if (!wireDrag.moved && Math.hypot(d.dx, d.dy) > 4) {
        wireDrag.moved = true;
        commitEdit();
      }
      var via = (wireDrag.via0.length === 0)
        ? [[wireDrag.mid0.x + d.dx, wireDrag.mid0.y + d.dy]]
        : wireDrag.via0.map(function (z) { return [z[0] + d.dx, z[1] + d.dy]; });
      // 夹进画布：拖到画布外面去的话，那一段线在屏幕上根本不存在，而它照样在
      // 电路里 —— 学生看到的会是一根「看不见却读得出电流」的线。
      var M = 24;
      wr.via = via.map(function (z) {
        return [Math.max(M, Math.min(W - M, z[0])), Math.max(M, Math.min(H - M, z[1]))];
      });
      refreshWireBase(wr);
      return true;
    }

    // ---------- 删除按钮（导线 / 元件共用同一颗） ----------
    // 点到导线或元件只把它选中，真正的删除交给选中后长出来的这颗红圆钮：
    // 导线很细、元件和导线又常常挤在一起，点中即删容易误伤；多一步确认，
    // 也让学生看清删的是哪一根 / 哪一件。
    // 导线上的钮长在线的【中点】，元件上的钮长在元件的【左上角】——
    // 位置不同、长相和行为完全一样，所以是同一颗钮（同一个 DEL_R、同一套画法、
    // 同一段命中判据），不是两套。
    var DEL_R = 11;
    function delButtonPos(wr) {
      var pts = pathOf(wr);
      if (pts.length < 2) return null;
      // 取折线弧长的一半处，而不是数组中间那个点——抽稀后点的间距差很多，
      // 按点数取会把按钮甩到某个拐角上。
      var total = 0, i;
      for (i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y);
      if (total < 1) return { x: pts[0].x, y: pts[0].y };
      var half = total / 2, acc = 0;
      for (i = 1; i < pts.length; i++) {
        var seg = Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y);
        if (acc + seg >= half) {
          var t = seg ? (half - acc) / seg : 0;
          return { x: pts[i-1].x + (pts[i].x - pts[i-1].x) * t,
                   y: pts[i-1].y + (pts[i].y - pts[i-1].y) * t };
        }
        acc += seg;
      }
      return { x: pts[pts.length-1].x, y: pts[pts.length-1].y };
    }
    // 元件上那颗删除钮的位置（世界坐标）。取【世界包围盒】的左上角，而不是
    // 元件自身坐标系的框角：元件能转 90° / 180°，跟着转的话删除钮会跑到对角
    // 去，学生反而找不着 —— 「左上角」说的是屏幕意义上的左上角，和元件怎么摆
    // 无关。夹回画布内：元件拖到画布角落时按钮不能跑到画布外面（那就永远点不到
    // 了）；夹回之后它至多压在元件自己身上，仍然是「左上角那一带」。
    var COMP_DEL_PAD = 8;              // 钮心相对包围盒左上角再往外偏的量
    function compDeletePos(c) {
      var b = localBox(c);
      var xs = [], ys = [];
      [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]].forEach(function (q) {
        var w = D.toWorld(c, q[0], q[1]);
        xs.push(w.x); ys.push(w.y);
      });
      var x = Math.min.apply(null, xs) - COMP_DEL_PAD - DEL_R;
      var y = Math.min.apply(null, ys) - COMP_DEL_PAD - DEL_R;
      x = Math.max(DEL_R + 2, Math.min(W - DEL_R - 2, x));
      y = Math.max(DEL_R + 2, Math.min(H - DEL_R - 2, y));
      return { x: x, y: y };
    }
    // 命中判据对两种选中都成立。半径一律 DEL_R + 4 —— 和导线那颗同一个数，
    // 不然两处「看得见却点不着」的余量会不一样。
    function hitDeleteButton(p) {
      if (!selected) return false;
      var b = null;
      if (selected.kind === 'wire') {
        var wr = getScene().wires[selected.index];
        if (!wr) return false;
        b = delButtonPos(wr);
      } else if (selected.kind === 'comp') {
        var c = byId(selected.id);
        if (!c) return false;
        b = compDeletePos(c);
      }
      return !!b && Math.hypot(p.x - b.x, p.y - b.y) <= DEL_R + 4;
    }
    // 画一颗删除圆钮（白圈 + 红底 + 两笔白叉）。导线中点那颗和元件左上角那颗
    // 是【同一颗】—— 两处各写一套的话，迟早会长得不一样、命中半径也会跑偏。
    // 叉用两笔粗线画，不用「×」字形——字形的粗细和居中随字体变，在小圆钮里
    // 会忽大忽小、偏左偏右。
    function drawDelButton(ctx, bp) {
      if (!bp) return;
      ctx.save();
      ctx.beginPath(); ctx.arc(bp.x, bp.y, DEL_R + 2.5, 0, 6.284);
      ctx.fillStyle = '#fff'; ctx.fill();
      ctx.beginPath(); ctx.arc(bp.x, bp.y, DEL_R, 0, 6.284);
      ctx.fillStyle = '#dc2626'; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
      var d = DEL_R * 0.42;
      ctx.beginPath();
      ctx.moveTo(bp.x - d, bp.y - d); ctx.lineTo(bp.x + d, bp.y + d);
      ctx.moveTo(bp.x + d, bp.y - d); ctx.lineTo(bp.x - d, bp.y + d);
      ctx.stroke();
      ctx.restore();
    }

    // ---------- 旋转钮（元件自由旋转） ----------
    // 用户要的：「点击电路元件之后就出来一个旋钮，可以让它 360° 旋转」。
    //
    // 和删除钮一对：删除钮长在世界包围盒【左上角】外，旋转钮长在【右上角】外。
    // 两个角不会打架，学生也不会把它们认混（红叉 = 删、蓝盘 = 转）。
    // 位置一律按【世界包围盒】算，不跟元件自身坐标系走：元件转了之后，跟着转的
    // 按钮会跑到对角去，学生反而找不着 —— 和删除钮那条规矩完全一样。
    var ROT_R = 13;
    var COMP_ROT_PAD = 8;              // 钮心相对包围盒右上角再往外偏的量
    // 自由旋转，但快贴到 90° 的整数倍时轻轻吸一下：0/90/180/270 是最常要的四个
    // 姿态（元件横放、竖放），手拖很难精确停在整数度上，而差 2° 的元件在大屏上
    // 一眼就看出是歪的。其余角度保留一位小数 —— 用户要的是「自由旋转」，不是
    // 「只能转四个方向」，所以吸附窗口只有 ±4°。
    var ROT_SNAP = 4;
    function snapRot(deg) {
      var v = ((deg % 360) + 360) % 360;
      var q = Math.round(v / 90) * 90;
      if (Math.abs(v - q) <= ROT_SNAP) return q % 360;
      return Math.round(v * 10) / 10;
    }
    function compRotPos(c) {
      var b = localBox(c);
      var xs = [], ys = [];
      [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]].forEach(function (q) {
        var w = D.toWorld(c, q[0], q[1]);
        xs.push(w.x); ys.push(w.y);
      });
      // 右上角 = x 最大、y 最小。夹回画布内：元件拖到画布角落时按钮不能跑到
      // 画布外面（那就永远点不到了）；夹回之后它至多压在元件自己身上。
      var x = Math.max.apply(null, xs) + COMP_ROT_PAD + ROT_R;
      var y = Math.min.apply(null, ys) - COMP_ROT_PAD - ROT_R;
      x = Math.max(ROT_R + 2, Math.min(W - ROT_R - 2, x));
      y = Math.max(ROT_R + 2, Math.min(H - ROT_R - 2, y));
      return { x: x, y: y };
    }
    // 命中半径比删除钮（DEL_R + 4）再宽一点：这个钮是【拖】的，按住的瞬间就要
    // 咬住，不像删除钮点一下就完事。
    function hitRotButton(p) {
      if (!selected || selected.kind !== 'comp') return false;
      var c = byId(selected.id);
      if (!c) return false;
      var b = compRotPos(c);
      return !!b && Math.hypot(p.x - b.x, p.y - b.y) <= ROT_R + 5;
    }
    // 画旋转钮：白圈 + 蓝底 + 一根【指向当前角度】的指针 + 一圈刻度。
    // 指针是关键 —— 它让「元件现在朝哪」在这颗钮上看得见，拖的时候指针跟着转，
    // 手感和反馈是同一个东西。四个刻度点标出 0/90/180/270，方便对到正方向。
    function drawRotButton(ctx, bp, rot) {
      if (!bp) return;
      ctx.save();
      ctx.beginPath(); ctx.arc(bp.x, bp.y, ROT_R + 2.5, 0, 6.284);
      ctx.fillStyle = '#fff'; ctx.fill();
      ctx.beginPath(); ctx.arc(bp.x, bp.y, ROT_R, 0, 6.284);
      ctx.fillStyle = '#2563eb'; ctx.fill();
      // 刻度：四个正方向上的小点（画在圆内沿）
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      for (var k = 0; k < 4; k++) {
        var ta = k * Math.PI / 2;
        ctx.beginPath();
        ctx.arc(bp.x + Math.cos(ta) * (ROT_R - 2.6),
                bp.y + Math.sin(ta) * (ROT_R - 2.6), 1.5, 0, 6.284);
        ctx.fill();
      }
      // 指针：从中心指向元件当前的朝向（rot = 0 时元件横放、端子 0 在右边）。
      // 末端带一个小箭头尖 —— 光一根直线在圆里像钟表指针，加了箭头才是「可以转」
      // 的图标；而箭头指的又是【元件当前朝哪】，方向和手势是同一个信息。
      var a = (rot || 0) * Math.PI / 180;
      var tipR = ROT_R - 6.5;
      var tx = bp.x + Math.cos(a) * tipR, ty = bp.y + Math.sin(a) * tipR;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(bp.x, bp.y);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      var aw = 4.4;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(tx + Math.cos(a) * aw * 1.15, ty + Math.sin(a) * aw * 1.15);
      ctx.lineTo(tx + Math.cos(a + 2.4) * aw, ty + Math.sin(a + 2.4) * aw);
      ctx.lineTo(tx + Math.cos(a - 2.4) * aw, ty + Math.sin(a - 2.4) * aw);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath(); ctx.arc(bp.x, bp.y, 2.4, 0, 6.284);
      ctx.fillStyle = '#fff'; ctx.fill();
      ctx.restore();
    }
    function undo() {
      if (!undoStack.length) return false;
      var st = undoStack.pop();
      var s = getScene();
      s.comps = st.comps; s.wires = st.wires;
      selected = null;
      changed();
      report('undo', {});
      return true;
    }
    function changed() {
      onChange();
      onSelect(selected ? describeSelection() : null, undoStack.length);
    }
    function describeSelection() {
      if (!selected) return null;
      // ⚠️ 选中的东西可能已经不在场景里了（撤销、删除元件都会让 selected 指向
      // 一个已经不存在的 id）。这时必须报「什么都没选」，不能返回 {comp:null}：
      // 宿主拿到 comp:null 会去读 s.comp.id，当场抛错、整条渲染链断掉。
      if (selected.kind === 'comp') {
        var c = byId(selected.id);
        return c ? { kind: 'comp', comp: c } : null;
      }
      var w = getScene().wires[selected.index];
      return w ? { kind: 'wire', wire: w } : null;
    }
    function select(sel) { selected = sel; }

    // ---------- 指针事件 ----------
    function onDown(ev) {
      var p = toLogical(ev);
      lastPointer = p;

      // 删除钮必须排在所有命中判断之前：它就长在导线上 / 元件角上，
      // 先判导线的话这一下会被当成「再选一次这根线」、先判元件的话会被当成
      // 「开始拖元件」，按钮永远点不动。
      // 走 removeSelected 这【同一条】删除路径，不在这儿另写一份：导线要
      // report('unplug')、元件要 report('remove') 并且【保留导线】（只把挂在
      // 它上面的端点冻住），两条规矩都写在那里，这里再抄一遍迟早抄漏一条。
      if (hitDeleteButton(p)) { removeSelected(); return; }

      // 旋转钮紧随删除钮：两者都是「选中之后才长出来」的控件，命中判据也只认
      // 当前选中件。必须排在 hitComp 之前 —— 钮就长在元件旁边，让本体先接走
      // 这一下的话，按下去就变成「搬走整个元件」，钮永远拖不动（删除钮同一个理）。
      if (hitRotButton(p)) {
        var rc0 = byId(selected.id);
        if (rc0) {
          beginEdit();
          rotating = { id: rc0.id, a0: Math.atan2(p.y - rc0.y, p.x - rc0.x),
                       r0: rc0.rot || 0, moved: false };
          canvas.setPointerCapture && canvas.setPointerCapture(ev.pointerId);
          changed();
        }
        return;
      }

      // 元件名字标签（画布上那个写着 L1 / R2 的小圆角框）。排在删除钮之后、
      // 接线柱之前：删除钮是选中导线时才出现的显式按钮，必须先接走；标签框长在
      // 元件【下方】几十像素处、通常不和接线柱重叠，但它是一个明确的 UI 区域 ——
      // 点它就是要改名，不该被底下的导线 / 元件抢走。吃掉这一下就直接 return：
      // 改名是宿主的浮层在做，编辑器这边不选中、不拖拽、也不拉线。
      if (onHitTag && onHitTag(p, ev)) return;

      var t = hitTerminal(p);
      if (t) {                                  // 从端子拉线
        clearDwellTimer();                     // 上一根线的闹钟不能留着烧到这一根
        wiring = { from: t, cur: p, to: null, trail: [{ x: p.x, y: p.y }] };
        canvas.setPointerCapture && canvas.setPointerCapture(ev.pointerId);
        return;
      }

      // 悬空的线头（挂在被删元件上的那一头）。排在滑片 / 元件 / 导线之前：
      // 线头本身很细，只要让别的命中先吃掉这一下，它就永远抓不住 —— 而
      // 「把线头插回某个柱子」正是删掉元件以后最自然的下一步动作。
      // 排在 hitTerminal 之后：两者同时命中时，接线柱优先（柱子上能起一根新线，
      // 是更常见、也更不该被挡住的意图）。
      var le = hitLooseEnd(p);
      if (le) {
        clearDwellTimer();
        wiring = { from: { compId: null, termIdx: 0, x: le.x, y: le.y },
                   fromWire: { index: le.index, k: le.k },
                   cur: p, to: null, trail: [{ x: p.x, y: p.y }] };
        canvas.setPointerCapture && canvas.setPointerCapture(ev.pointerId);
        return;
      }

      // 拨滑片要排在「搬走整个变阻器」前面：滑片长在本体上，
      // 先判本体的话这一下永远被当成拖元件，滑片就白画了。
      var sl = hitSlider(p);
      if (sl) {
        beginEdit();
        select({ kind: 'comp', id: sl.id });
        slider = { id: sl.id, moved: false };
        canvas.setPointerCapture && canvas.setPointerCapture(ev.pointerId);
        changed();
        return;
      }

      // 拧学生电源的电压旋钮，同样要排在「搬走整台电源」前面：旋钮长在面板上，
      // 先判本体的话这一下永远被当成拖元件，旋钮就白画了。
      var pk = hitPsuKnob(p);
      if (pk) {
        beginEdit();
        select({ kind: 'comp', id: pk.id });
        psuKnob = { id: pk.id, moved: false };
        canvas.setPointerCapture && canvas.setPointerCapture(ev.pointerId);
        changed();
        return;
      }

      // 拖铅笔芯的移动夹：同样要排在「搬走整块板」前面 —— 夹子长在板子上，
      // 先判本体的话这一下永远被当成拖元件，夹子就白画了。
      var pc = hitClip(p);
      if (pc) {
        beginEdit();
        select({ kind: 'comp', id: pc.id });
        // 记下「夹口 − 鼠标」的偏移：抓夹口还是抓夹尾，拖起来都不跳
        var pl0 = D.toLocal(pc, p.x, p.y).x;
        clipDrag = { id: pc.id,
                     dx: D.clipLocalX(D.pencilLenOf(pc)) - pl0, moved: false };
        canvas.setPointerCapture && canvas.setPointerCapture(ev.pointerId);
        changed();
        return;
      }

      var cs = getScene().comps;
      for (var i = cs.length - 1; i >= 0; i--) {   // 后画的在上层，从后往前找
        if (hitComp(p, cs[i])) {
          beginEdit();                            // 快照揣着，真动了才入栈
          select({ kind: 'comp', id: cs[i].id });
          moving = { id: cs[i].id, dx: p.x - cs[i].x, dy: p.y - cs[i].y,
                     x0: p.x, y0: p.y, moved: false };
          canvas.setPointerCapture && canvas.setPointerCapture(ev.pointerId);
          changed();
          return;
        }
      }
      var wi = hitWire(p);
      if (wi >= 0) {
        select({ kind: 'wire', index: wi });
        // 选中之后还能【接着拖】：两端接线柱钉死，中间拐点最多挪 WIRE_DRAG_MAX。
        // 只是点一下（没移动）就还是「选中」，不留撤销记录 —— 和点元件一个规矩。
        wireDragBegin(wi, p);
        canvas.setPointerCapture && canvas.setPointerCapture(ev.pointerId);
        changed();
        return;
      }
      if (selected) { selected = null; changed(); }
    }

    function onMove(ev) {
      var p = toLogical(ev);
      lastPointer = p;
      if (wiring) {
        wiring.cur = p;
        // 记轨迹：按最小间距采样，不然一次拖动能塞进几百个几乎重合的点
        var tr = wiring.trail, last = tr[tr.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) >= TRAIL_MIN) tr.push({ x: p.x, y: p.y });
        var t = hitTerminal(p);
        wiring.to = (t && !(t.compId === wiring.from.compId && t.termIdx === wiring.from.termIdx)) ? t : null;
        // 落点会让两个量程柱同时接上：预览就别变绿。变绿了再静默失败，
        // 学生会以为是软件坏了。
        wiring.blocked = !!(wiring.to && rangeConflict(wiring.from, wiring.to));
        if (wiring.blocked) wiring.to = null;
        // 没落在接线柱上 → 看看能不能吸附到某根导线的【中间】，并给一个预览点。
        // 预览点取最近点而不是鼠标位置：让「会吸到哪里」看得见，否则学生只能
        // 松手以后才知道接上没有。
        wiring.snap = (!wiring.to && !wiring.blocked) ? nearestOnWire(p) : null;
        // ── 停留成线：停住 ≥ DWELL_MS 就地接线 ──────────────────
        // 只对「从端子起头的新线、且落点不在柱子上、也不在导线上」计时 ——
        // 那三种情况各有各的接线规则（端子优先、导线中段其次），不抢。
        if (!wiring.fromWire && !wiring.to && !wiring.blocked && !wiring.snap) {
          var dp = wiring.dwellPt;
          if (!dp || Math.hypot(p.x - dp.x, p.y - dp.y) > DWELL_SLACK) {
            wiring.dwellPt = { x: p.x, y: p.y };
            wiring.dwellT = nowMs();
          } else if (nowMs() - wiring.dwellT >= DWELL_MS) {
            if (connectToPoint(wiring)) {
              // 成线即收工：把 wiring 清掉，指针还按着也不再续下一根
              // （不然松手时 onUp 看到 wiring 还在，又去接一次）。
              wiring = null;
              changed();
              return;
            }
            // 落点被拒（压在元件身上）。别每帧重试：把锚点推开一点，
            // 等学生再动一下才重新计时。
            wiring.dwellPt = { x: p.x + DWELL_SLACK, y: p.y };
          }
          // 起闹钟 + 起重绘脉冲（停住之后没有新事件，全靠这两条把线接上、
          // 把进度环画完）
          clearDwellTimer();
          dwellTimer = setTimeout(dwellFire, DWELL_MS + 60);
          dwellPulse();
        } else {
          wiring.dwellPt = null; wiring.dwellT = 0;
          clearDwellTimer();
        }
        onChange();
        return;
      }
      if (slider) {
        var kc = byId(slider.id);
        if (kc) {
          var lx = D.toLocal(kc, p.x, p.y).x;
          var nv = slideClamp(D.slideFromLocalX(lx));
          if (nv !== D.slideOf(kc)) {
            if (!slider.moved) { slider.moved = true; commitEdit(); }  // 真拨动了才入栈
            kc.params = kc.params || {};
            kc.params.slide = nv;
          }
          onChange();
          return;
        }
        slider = null;
      }
      if (clipDrag) {
        var cc = byId(clipDrag.id);
        if (cc) {
          var lxc = D.toLocal(cc, p.x, p.y).x + clipDrag.dx;
          // 换算成毫米后取整：参数面板是 step=1 的滑条，画布上却给连续值，
          // 不取整的话面板显示 27、画布其实停在 27.4（和滑片那条规矩一样）。
          var nvl = Math.round(D.clipLenFromLocalX(lxc));
          nvl = Math.max(D.PENCIL.LEN_MIN, Math.min(D.PENCIL.LEN_MAX, nvl));
          if (nvl !== D.pencilLenOf(cc)) {
            if (!clipDrag.moved) { clipDrag.moved = true; commitEdit(); }
            cc.params = cc.params || {};
            cc.params.len = nvl;
          }
          onChange();
          return;
        }
        clipDrag = null;
      }
      if (psuKnob) {
        var pc = byId(psuKnob.id);
        if (pc && D.PSU) {
          var pl = D.toLocal(pc, p.x, p.y);
          if (D.flipOf(pc)) pl.x = -pl.x;      // 镜像过的电源：把 x 翻回面板坐标系
          // 角度 = 从旋钮中心指向鼠标。刻度盘与指针共用 psuEmfFromAngle 这一份
          // 换算（它自带 0.5V 吸附），所以「指针停在哪 = 电压是多少」永远一致。
          var ang = Math.atan2(pl.y - D.PSU.KNOB.y, pl.x - D.PSU.KNOB.x);
          var nv2 = D.psuEmfFromAngle(ang);
          if (nv2 !== (pc.params || {}).emf) {
            if (!psuKnob.moved) { psuKnob.moved = true; commitEdit(); }  // 真拧动了才入栈
            pc.params = pc.params || {};
            pc.params.emf = nv2;
          }
          onChange();
          return;
        }
        psuKnob = null;
      }
      if (rotating) {
        var rc = byId(rotating.id);
        if (rc) {
          // 角度 = 从元件中心指向鼠标。记的是【按下那一刻】的鼠标角度和元件角度，
          // 每一帧都从 r0 + 角度差重算 —— 不在上一帧的结果上继续加，否则快速转圈
          // 丢帧时会越积越多（wireDrag 那条注释里踩过同一个坑）。
          var a = Math.atan2(p.y - rc.y, p.x - rc.x);
          var nv = snapRot(rotating.r0 + (a - rotating.a0) * 180 / Math.PI);
          if (nv !== (rc.rot || 0)) {
            if (!rotating.moved) { rotating.moved = true; commitEdit(); }
            rc.rot = nv;
            // 端子位置跟着转，挂在它上面的导线必须【每帧】重贴。拖元件那条路可以
            // 拖完再重算（正交导线松手才跟），旋转不行：转 90° 时端子会挪到大半个
            // 元件之外，导线当场和接线柱分家，看着像线掉下来了。
            rerouteAll();
          }
          onChange();
        }
        return;
      }
      if (moving) {
        var c = byId(moving.id);
        if (!moving.moved && Math.hypot(p.x - moving.x0, p.y - moving.y0) > 4) {
          moving.moved = true;
          commitEdit();          // 真的开始拖了，才把快照入栈
        }
        c.x = snap(p.x - moving.dx);
        c.y = snap(p.y - moving.dy);
        refitWiresOf(c.id);
        onChange();
        return;
      }
      if (wireDrag) {
        if (wireDragTo(p)) onChange();
        return;
      }
      var nt = hitTerminal(p), nl = nt ? null : hitLooseEnd(p), nh = null;
      if (nt) nh = { kind: 'term', compId: nt.compId, termIdx: nt.termIdx };
      else if (nl) nh = { kind: 'loose', index: nl.index, k: nl.k };
      else {
        var np = hitPsuKnob(p);
        if (np) nh = { kind: 'psuKnob', id: np.id };
        else {
          var ns = hitSlider(p);
          if (ns) nh = { kind: 'slider', id: ns.id };
          else {
            // 铅笔芯的移动夹：和滑片一样是「长在本体上的控件」，排在 hitComp 前
            var ncp = hitClip(p);
            if (ncp) nh = { kind: 'clip', id: ncp.id };
            else {
            var cs = getScene().comps;
            for (var i = cs.length - 1; i >= 0; i--) {
              if (hitComp(p, cs[i])) { nh = { kind: 'comp', id: cs[i].id }; break; }
            }
            // 导线也进 hover：它现在能拖了，不给一个 move 光标的话，学生根本
            // 不知道这线是可拖的 —— 它长得和别的线一模一样。
            if (!nh) { var nw = hitWire(p); if (nw >= 0) nh = { kind: 'wire', index: nw }; }
            }
          }
        }
      }
      var changedHover = JSON.stringify(nh) !== JSON.stringify(hover);
      hover = nh;
      // 名字标签的输入光标排最前：标签长在元件【下方】、和别的命中互不重叠，
      // 先问它只是为了让「这行字可以点」有反馈（不给的话学生根本不会去点它）。
      canvas.style.cursor = (onHoverTag && onHoverTag(p)) ? 'text'
        : hitDeleteButton(p) ? 'pointer'
        : hitRotButton(p) ? (rotating ? 'grabbing' : 'grab')
        : (nt || nl) ? 'crosshair'
        : (nh && nh.kind === 'slider') ? 'ew-resize'
        : (nh && nh.kind === 'clip') ? 'ew-resize'
        : (nh && nh.kind === 'psuKnob') ? 'grab'
        : (nh ? 'move' : 'default');
      if (changedHover) onChange();
    }

    // ---------- 落到导线上：自动长一个接线点 ----------
    // 用户要的：「从接线柱往一根导线的中间连一颗线」，落点上自动吸附出一个节点。
    //
    // ⚠️ 必须真的造一个【元件】（junction），不能只把那根导线拆成两截了事：
    // 求解器认的是【端子】—— 两根导线只有在共用一个端子时才算同一个节点。
    // 拆开的两截谁也不接到第三根线上，三根线就只是「画在一起」，读数上毫无
    // 关系。那比不做更坏：学生看着线接上了，表却不动。
    function connectToWireMid(wiring) {
      if (!wiring.cur) return false;
      var hit = nearestOnWire(wiring.cur);
      if (!hit) return false;
      var s = getScene(), W = s.wires[hit.index], from = wiring.from;
      // 接到「起点自己那根线」上等于没接（同一个节点），还会凭空多一个结点。
      // 起点是【悬空线头】时 compId 为 null，两个 null 会被误判成「同一根」，
      // 所以这一条只对真正挂在元件上的端点生效。
      if (from.compId && (
          (W.a.compId === from.compId && W.a.termIdx === from.termIdx) ||
          (W.b.compId === from.compId && W.b.termIdx === from.termIdx))) return false;
      // 量程冲突：起点在某只表的量程柱上，而目标导线也接着同一只表的量程柱 ——
      // 接上去等于把两个量程柱短接，读数就废了。
      if (rangeConflict(from, W.a) || rangeConflict(from, W.b)) return false;

      pushUndo();
      var pts = hit.pts, q = hit.q;
      // 从落点把原导线切成两截。落点正好压在某个拐点上时，那个拐点就是新结点
      // 本身，不能既当 via 又当端点 —— 判据是「距离 ≈ 0」，不是「下标相等」。
      var viaA = pts.slice(1, hit.seg + 1).map(function (z) { return [z.x, z.y]; });
      var viaB = pts.slice(hit.seg + 1, pts.length - 1).map(function (z) { return [z.x, z.y]; });
      while (viaA.length && Math.hypot(viaA[viaA.length - 1][0] - q.x,
                                       viaA[viaA.length - 1][1] - q.y) < 1) viaA.pop();
      while (viaB.length && Math.hypot(viaB[0][0] - q.x, viaB[0][1] - q.y) < 1) viaB.shift();

      var n = 1;
      while (byId(ID_PREFIX.junction + n)) n++;
      var jc = { id: ID_PREFIX.junction + n, type: 'junction',
                 x: q.x, y: q.y, params: {} };
      s.comps.push(jc);

      // 新导线从起点划到【结点】为止。末端就是结点本身（junction 的端子在
      // (0,0)），所以不用再往 via 尾巴上补一个落点 —— 补了会和端点重合，
      // 变成零长度段（mkWire 会过滤掉，但不如一开始就别写）。
      // 起点可能是【悬空线头】（元件被删、导线还在），所以走 endPt。
      var cp = endPt(from);
      if (!cp) return false;
      var viaNew = simplify(wiring.trail.slice(1), TRAIL_TOL)
        .filter(function (z) { return Math.hypot(z.x - cp.x, z.y - cp.y) > 1; })
        .slice(0, VIA_MAX - 1)
        .map(function (z) { return [z.x, z.y]; });

      var tA = cpEnd(W.a), tB = cpEnd(W.b);
      s.wires.splice(hit.index, 1);
      // mkWire 在端点算不出坐标时返回 null（理论上到不了这里：三条新线的端点
      // 要么是刚检查过的 cp，要么是原导线上已经能解出来的端点）。仍然逐个过滤，
      // 因为把 null 推进 wires 会让后面每一次重绘都在 w.a 上抛错。
      [mkWire(tA, { compId: jc.id, termIdx: 0 }, viaA),
       mkWire({ compId: jc.id, termIdx: 1 }, tB, viaB),
       mkWire(from, { compId: jc.id, termIdx: 0 }, viaNew)].forEach(function (nw) {
        if (nw) s.wires.push(nw);
      });
      report('plug', { a: from, b: { compId: jc.id, termIdx: 0 } });
      return true;
    }

    // ---------- 拖到空白处、停住成线 ----------
    // 用户要的第三起居线方式：从一个接线柱出发，拖到【任意一个空白点】
    // （不必是接线柱、也不必压在导线上），在那里停住不动 → 落点长出一颗
    // 接线点，途经的轨迹成为这根导线的拐点，连线完成。
    //
    // 为什么终点也要造一个 junction：导线必须落在【端子】上才算接入电路
    // （求解器只认端子）。留一个悬空线头的话，这根线画在那儿却不通电，
    // 而学生明明「看见线接上了」—— 那比不接更坏。接线点还顺手给了这根线
    // 一个接着往下连的桩子。
    //
    // 与 connectToWireMid 的关系：落点压在已有导线上时走那条（会把那根线
    // 从落点切成两截，三根线并到一颗点上）；落在元件身上 / 空白处才走这条。
    // 页面侧的顺序是「端子 → 导线中段 → 空白处」，三者互斥。
    function connectToPoint(wiring) {
      if (!wiring || !wiring.cur || !wiring.from) return false;
      var from = wiring.from;
      if (!from.compId) return false;                 // 悬空线头不是这条的输入
      var s = getScene();
      var q = { x: snap(wiring.cur.x), y: snap(wiring.cur.y) };
      // 落在元件身上不接：接线点会嵌在器材里，看着像插上了、其实没有。
      for (var i = 0; i < s.comps.length; i++) {
        var c = s.comps[i];
        var ol = D.toLocal(c, q.x, q.y), b = localBox(c);
        if (ol.x >= b.x0 - 2 && ol.x <= b.x1 + 2 && ol.y >= b.y0 - 2 && ol.y <= b.y1 + 2) return false;
      }
      // 起点与落点是同一个端子 = 自环，没意义
      pushUndo();
      var n = 1;
      while (byId(ID_PREFIX.junction + n)) n++;
      var jc = { id: ID_PREFIX.junction + n, type: 'junction',
                 x: q.x, y: q.y, params: {} };
      s.comps.push(jc);
      var cp = endPt(from);
      if (!cp) return false;
      // 途经点成为导线的拐点（和 connectToWireMid 同一条简化管线）。
      // 尾巴上跟落点重合的点要去掉：接线点自己的端子在 (x,y)，补一个等于零长度段。
      var viaNew = simplify(wiring.trail.slice(1), TRAIL_TOL)
        .filter(function (z) { return Math.hypot(z.x - cp.x, z.y - cp.y) > 1; })
        .slice(0, VIA_MAX - 1)
        .map(function (z) { return [z.x, z.y]; });
      while (viaNew.length && Math.hypot(viaNew[viaNew.length - 1][0] - q.x,
                                         viaNew[viaNew.length - 1][1] - q.y) < 1) viaNew.pop();
      var nw = mkWire(from, { compId: jc.id, termIdx: 0 }, viaNew);
      if (nw) s.wires.push(nw);
      report('plug', { a: from, b: { compId: jc.id, termIdx: 0 } });
      return true;
    }

    // 把一根【悬空】的线头插回某个接线柱上。和「从端子拉一根新线」是两回事：
    // 这里不新增导线，只是改那个端点的归属，所以线的根数一根不变。
    // 判据全在落点上：没落在柱子上就什么都不做，线头留在原地等下一次。
    function replugLooseEnd(wiring) {
      var b = wiring.to;
      if (!b) return false;
      var s = getScene();
      var wr = s.wires[wiring.fromWire.index];
      if (!wr) return false;
      var k = wiring.fromWire.k, ok = (k === 'a') ? 'b' : 'a';
      var other = wr[ok];
      // 插到「自己另一头所在的那个柱子」上 = 自环，等于把这根线短路掉
      if (other && other.compId === b.compId && other.termIdx === b.termIdx) return false;
      if (rangeConflict(other, b)) return false;
      pushUndo();
      wr[k] = { compId: b.compId, termIdx: b.termIdx };
      // 端点换了位置，手绘的形状不再贴合 —— 和 plugRange 同一条规矩：改成
      // 自动正交走线，免得插上以后整根线横穿元件本体。
      wr.auto = true; wr.base = null;
      var q0 = endPt(wr.a), q1 = endPt(wr.b);
      if (q0 && q1) wr.via = routeTo(q0, q1, -1).via;
      report('plug', { a: wr.a, b: wr.b });
      return true;
    }

    // 造一根【手绘】导线，顺便把「原始形状」记下来 —— refitManual 靠 base
    // 在元件被拖走时按比例重新分布拐点。缺了 base 拐点会原地不动，导线就从
    // 元件身上脱开了。
    function mkWire(a, b, via) {
      var p0 = endPt(a), p1 = endPt(b);
      if (!p0 || !p1) return null;
      // 过滤「与两端点重合」和「与前一个拐点重合」的点。它们在 rawPathOf 里
      // 是零长度段 —— 画面上看不见，但电路图布局会把它当成一个多余的拐点，
      // 报「第 N 根导线布局需核对」。接线点的两个端子都落在 (0,0)，最容易踩到。
      var v = [];
      via.forEach(function (z) {
        if (Math.hypot(z[0] - p0.x, z[1] - p0.y) < 1) return;
        if (Math.hypot(z[0] - p1.x, z[1] - p1.y) < 1) return;
        if (v.length) {
          var last = v[v.length - 1];
          if (Math.hypot(z[0] - last[0], z[1] - last[1]) < 1) return;
        }
        v.push([z[0], z[1]]);
      });
      return {
        a: cpEnd(a), b: cpEnd(b),
        via: v, auto: false,
        base: { ends: [[p0.x, p0.y], [p1.x, p1.y]], via: v.map(function (z) { return [z[0], z[1]]; }) },
      };
    }

    // 直接连两个接线柱（外部代码 / 3D 版沙盒用）。语义与「在画布上从一个柱
    // 拖到另一个柱」完全一致：同样的重复 / 量程冲突拦截、同样的自动正交走线、
    // 同样的撤销入栈与音效。返回 true = 真的连上了。
    //   参数 a、b 形如 { compId, termIdx }，两端都必须是【挂在元件上】的端子；
    //   compId 为 null（删元件后留下的悬空线头）不适用本函数 —— 那是
    //   replugLooseEnd 的事（它只改端点归属、不新增导线）。
    function connectTerminals(a, b) {
      if (!a || !b || !a.compId || !b.compId) return false;
      if (a.compId === b.compId && a.termIdx === b.termIdx) return false;
      var s = getScene();
      var dup = s.wires.some(function (w) {
        return (w.a.compId === a.compId && w.a.termIdx === a.termIdx &&
                w.b.compId === b.compId && w.b.termIdx === b.termIdx) ||
               (w.a.compId === b.compId && w.a.termIdx === b.termIdx &&
                w.b.compId === a.compId && w.b.termIdx === a.termIdx);
      });
      if (dup || rangeConflict(a, b)) return false;
      var p0 = endPt(a), p1 = endPt(b);
      if (!p0 || !p1) return false;
      pushUndo();
      s.wires.push({
        a: cpEnd(a), b: cpEnd(b),
        via: routeTo(p0, p1, -1).via, auto: true, base: null,
      });
      report('plug', { a: a, b: b });
      changed();
      return true;
    }

    function onUp() {
      if (slider) {
        // 拨动了就已经入过栈；只按一下没动，就是普通点选，不留撤销记录
        if (!slider.moved) discardEdit();
        slider = null;
        changed();
        return;
      }
      if (clipDrag) {
        // 同上：拖动了才留撤销记录，单纯点一下 = 选中这件器材
        if (!clipDrag.moved) discardEdit();
        clipDrag = null;
        changed();
        return;
      }
      if (psuKnob) {
        // 同上：拧动了才留撤销记录。单纯点一下旋钮 = 选中这台电源
        // （参数面板照常显示），不报 onTap —— 旋钮是控件，不是「点一下看读数」。
        if (!psuKnob.moved) discardEdit();
        psuKnob = null;
        changed();
        return;
      }
      if (rotating) {
        // 转动了就入过栈；只按一下没动就是普通点选（旋钮是选中件的控件，不是
        // 「点一下看读数」），不留撤销记录 —— 和滑片、电源旋钮同一条规矩。
        if (!rotating.moved) discardEdit();
        rotating = null;
        changed();
        return;
      }
      if (wiring) {
        // 拖的是【悬空线头】：这一下不是「画一根新线」，而是「把这根线插回某个
        // 柱子上」—— 只改那个端点的归属，导线的根数不变（见 replugLooseEnd）。
        if (wiring.fromWire) {
          replugLooseEnd(wiring);
          wiring = null;
          changed();
          return;
        }
        if (wiring.to) {
          var a = wiring.from, b = wiring.to;
          if (a.compId !== b.compId || a.termIdx !== b.termIdx) {
            var s = getScene();
            var dup = s.wires.some(function (w) {
              return (w.a.compId === a.compId && w.a.termIdx === a.termIdx &&
                      w.b.compId === b.compId && w.b.termIdx === b.termIdx) ||
                     (w.a.compId === b.compId && w.a.termIdx === b.termIdx &&
                      w.b.compId === a.compId && w.b.termIdx === a.termIdx);
            });
            // 兜底：落点预览已经拦过一次，但「起点就在量程柱上、别处已经
            // 接了一根」这类情况只有到这里才看全，所以再判一次。
            if (!dup && !rangeConflict(a, b)) {
              var p0 = endPt(a), p1 = endPt(b);
              if (!p0 || !p1) { wiring = null; changed(); return; }
              pushUndo();
              // 轨迹的首尾两点落在两个接线柱上，接线柱坐标每次渲染现算，
              // 存下来只会和它们打架，丢掉。
              var raw = wiring.trail.slice(1);
              var endGap = raw.length ? Math.hypot(
                raw[raw.length-1].x - p1.x, raw[raw.length-1].y - p1.y) : 0;
              if (endGap < TRAIL_MIN * 2) raw.pop();
              var via = simplify(raw, TRAIL_TOL)
                .filter(function (q) { return Math.hypot(q.x - p0.x, q.y - p0.y) > 1 &&
                                              Math.hypot(q.x - p1.x, q.y - p1.y) > 1; })
                .slice(0, VIA_MAX)
                .map(function (q) { return [q.x, q.y]; });
              s.wires.push({
                a: cpEnd(a), b: cpEnd(b),
                via: via, auto: false,
                // 原始形状留一份，元件拖走时按它重新贴合，见 refitManual
                base: { ends: [[p0.x, p0.y], [p1.x, p1.y]], via: via.map(function (v) { return [v[0], v[1]]; }) },
              });
              // 真的接上了才报。上面 dup / rangeConflict 那两条拦截路径不报 ——
              // 接不上却「咔」一声，学生只会以为接好了。
              report('plug', { a: a, b: b });
            }
          }
        } else {
          // 落点不在任何接线柱上 —— 先试是不是落在某根导线的【中间】（是的话
          // 在那里长一个接线点，把三根线接到一起），再试「停够两秒」的空白
          // 落点（同样长一颗接线点，途经轨迹成为这根线的拐点）。两者互斥。
          // 第二条同时是兜底：onMove 里的停留计时只在「又来了一次移动事件」时
          // 才检查，学生要是正好停在一秒九、再也不动，就靠松手这一下补上。
          if (!connectToWireMid(wiring)) {
            if (wiring.dwellPt && !wiring.fromWire &&
                nowMs() - wiring.dwellT >= DWELL_MS) connectToPoint(wiring);
          }
        }
        clearDwellTimer();
        wiring = null;
        changed();
        return;
      }
      if (moving) {
        var wasMoved = moving.moved, mc = byId(moving.id);
        moving = null;
        if (wasMoved) rerouteAll();
        // 没拖动 = 单击。开关是「点一下就通断」的元件，这是它最自然的操作方式，
        // 不该逼学生先去右边面板找勾选框。快照在按下时就拍好了，这里入栈即可。
        else if (mc && mc.type === 'switch') {
          commitEdit();
          mc.params = mc.params || {};
          mc.params.closed = !mc.params.closed;
          // 通断是开关唯一的事，必须出声。放在这里而不是 onTap 里：onTap 是
          // 「点了一下」的通用出口，宿主按类型过滤；开关这一下编辑器自己就知道
          // 是什么意思，没必要让宿主再判一次类型。
          report('switch', { comp: mc, closed: !!mc.params.closed });
        } else if (mc && mc.type === 'spdt') {
          // 🔴🔴 单刀双掷：点【左半边】就合到左掷、点【右半边】就合到右掷。
          // 用户 2026-10-18：「不用再点开那个面板，然后再进行调节」—— 点哪儿
          // 就合到哪儿，和闸刀「点一下通断」是同一种手感。
          // 判据用【点击点自身的局部 x】：转过的元件按旋转反算（D.toLocal），
          // 翻过极性的再把 x 翻回来（toLocal 不做镜像，见 hitPsuKnob 那段）。
          var lp = D.toLocal(mc, lastPointer.x, lastPointer.y);
          if (D.flipOf(mc)) lp.x = -lp.x;
          var want = (lp.x >= 0) ? 2 : 1;
          mc.params = mc.params || {};
          // 已经搭在那一侧：什么都不做（不压撤销记录、也不响 —— 画面上没有
          // 任何变化却「咔」一声，学生会以为点错了）。
          if ((+mc.params.throw === 2 ? 2 : 1) === want) discardEdit();
          else {
            commitEdit();
            mc.params.throw = want;
            // 和闸刀同一个音效：它永远在「合上」，所以 closed 恒 true。
            report('switch', { comp: mc, closed: true, throw: want });
          }
        } else discardEdit();       // 单纯点选，不留撤销记录
        // 没拖动 = 单击，报给宿主。开关在上面已经就地翻转了，这里照样报一声：
        // 宿主按类型自己过滤，编辑器不替它决定「哪些元件值得点」。
        if (!wasMoved && mc) onTap(mc, lastPointer);
        changed();
        return;
      }
      if (wireDrag) {
        // 拖动了就已经入过栈；只按一下没动，就是普通点选，不留撤销记录 ——
        // 和拖元件同一条规矩，否则点三根线再按 ⌘Z 得连按三次才动得了东西。
        if (!wireDrag.moved) discardEdit();
        wireDrag = null;
        changed();
      }
    }

    function onKey(ev) {
      var tag = (ev.target && ev.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (ev.key === 'Delete' || ev.key === 'Backspace') {
        if (removeSelected()) ev.preventDefault();
      } else if (ev.key === 'r' || ev.key === 'R') {
        rotateSelected();
      } else if (ev.key === 'Escape') {
        if (wiring) { wiring = null; onChange(); }
        else if (wireDrag) { wireDrag = null; onChange(); }
        else if (selected) { selected = null; changed(); }
      } else if ((ev.metaKey || ev.ctrlKey) && (ev.key === 'z' || ev.key === 'Z')) {
        undo(); ev.preventDefault();
      }
    }

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    window.addEventListener('keydown', onKey);

    // ---------- 覆盖层 ----------
    // 宿主每帧最后调用它。只画交互反馈，不画元件本身。
    function drawOverlay(ctx) {
      var cs = getScene().comps;

      // 悬空的线头：一个小空心圈。元件被删掉以后导线留着（用户明确要求），
      // 线头就悬在半空 —— 不标一下，学生只会以为「这根线画坏了」。
      // 琥珀色和拉线预览里「落点悬空」是同一个颜色语义。
      var ws0 = getScene().wires;
      ctx.save();
      ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 2;
      for (var wi = 0; wi < ws0.length; wi++) {
        for (var wk = 0; wk < 2; wk++) {
          var we = wk ? ws0[wi].b : ws0[wi].a;
          if (!isLooseEnd(we)) continue;
          ctx.beginPath(); ctx.arc(we.x, we.y, 5.5, 0, 6.284); ctx.stroke();
        }
      }
      ctx.restore();

      // 悬停端子：放大高亮，这是「可以接线」的视觉锚点
      if (hover && hover.kind === 'term') {
        var hc = byId(hover.compId);
        if (hc) {
          var q = D.terminalWorld(hc, hover.termIdx);
          ctx.save();
          ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.arc(q.x, q.y, 13, 0, 6.284); ctx.stroke();
          ctx.restore();
        }
      }

      // 悬停悬空线头：同一个圈，颜色跟线头走，表示「这一头能插回去」
      if (hover && hover.kind === 'loose') {
        var hlw = getScene().wires[hover.index];
        var hle = hlw ? (hover.k === 'a' ? hlw.a : hlw.b) : null;
        if (isLooseEnd(hle)) {
          ctx.save();
          ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.arc(hle.x, hle.y, 13, 0, 6.284); ctx.stroke();
          ctx.restore();
        }
      }

      // 悬停滑片：给滑片描一圈，告诉学生这东西可以直接拨。
      // 在元件自身坐标系里画，这样变阻器转了 90° 高亮也跟着转。
      var hk = slider || (hover && hover.kind === 'slider' ? hover : null);
      if (hk) {
        var kc = byId(hk.id);
        if (kc && kc.type === 'rheostat') {
          var kb = knobRect(kc);
          ctx.save();
          ctx.translate(kc.x, kc.y);
          ctx.rotate((kc.rot || 0) * Math.PI / 180);
          ctx.fillStyle = 'rgba(37,99,235,0.16)';
          D.roundRect(ctx, kb.x - 3, kb.y - 3, kb.w + 6, kb.h + 6, 8);
          ctx.fill();
          ctx.strokeStyle = 'rgba(37,99,235,0.9)'; ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
        }
      }

      // 悬停 / 正在拖【铅笔芯的移动夹】：给它描一圈。夹子和铅笔芯都是深灰，
      // 不描一圈学生根本不知道这只夹子能左右拖 —— 而「拖动它」正是这个实验
      // 唯一要学生动手的那一步。
      var hcl = clipDrag || (hover && hover.kind === 'clip' ? hover : null);
      if (hcl) {
        var hcc = byId(hcl.id);
        if (hcc && hcc.type === 'pencil') {
          var cr = clipHitRect(hcc);
          ctx.save();
          ctx.translate(hcc.x, hcc.y);
          ctx.rotate((hcc.rot || 0) * Math.PI / 180);
          ctx.fillStyle = 'rgba(37,99,235,0.16)';
          D.roundRect(ctx, cr.x0, cr.y0, cr.x1 - cr.x0, cr.y1 - cr.y0, 8);
          ctx.fill();
          ctx.strokeStyle = 'rgba(37,99,235,0.9)'; ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
        }
      }

      // 悬停 / 正在拧【学生电源】的电压旋钮：给它描一圈。旋钮画在面板上、
      // 和机箱同色，不描一圈学生根本不知道这东西可以直接拧。
      var hp = psuKnob || (hover && hover.kind === 'psuKnob' ? hover : null);
      if (hp) {
        var hpc = byId(hp.id);
        if (hpc && hpc.type === 'power' && D.PSU) {
          var KS = D.PSU.KNOB;
          ctx.save();
          ctx.translate(hpc.x, hpc.y);
          ctx.rotate((hpc.rot || 0) * Math.PI / 180);
          if (D.flipOf(hpc)) ctx.scale(-1, 1);   // 和绘制本体同一套位姿
          ctx.beginPath();
          ctx.ellipse(KS.x, KS.y, KS.r + 6, KS.r * 0.6 + 6, 0, 0, 6.284);
          ctx.fillStyle = 'rgba(37,99,235,0.16)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(37,99,235,0.9)'; ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
        }
      }

      // 选中框
      if (selected && selected.kind === 'comp') {
        var c = byId(selected.id);
        if (c) {
          var b = localBox(c);
          ctx.save();
          ctx.strokeStyle = '#ea580c'; ctx.lineWidth = 2;
          ctx.setLineDash([7, 5]);
          // 框画在【元件自身坐标系】里：皮肤声明的是非对称框（开关的手柄
          // 往左伸），按中心对称去画的话手柄框不住、右边还多圈一片空气。
          ctx.translate(c.x, c.y);
          ctx.rotate((c.rot || 0) * Math.PI / 180);
          D.roundRect(ctx, b.x0 - 7, b.y0 - 7, (b.x1 - b.x0) + 14, (b.y1 - b.y0) + 14, 8);
          ctx.stroke();
          ctx.restore();

          // 元件左上角那颗删除钮。画在 restore 【之后】：虚线框跟着元件转，
          // 钮不跟 —— 它在世界坐标里，元件转到哪它都在左上角。
          drawDelButton(ctx, compDeletePos(c));
          // 旋转钮长在【右上角】外，和删除钮成对角。同样在世界坐标里、不跟元件转。
          drawRotButton(ctx, compRotPos(c), c.rot || 0);
        }
      } else if (selected && selected.kind === 'wire') {
        var wr = getScene().wires[selected.index];
        if (wr) {
          ctx.save();
          ctx.strokeStyle = '#ea580c'; ctx.lineWidth = 3; ctx.globalAlpha = 0.55;
          D.drawWire(ctx, pathOf(wr), { width: 10, flowing: false });
          ctx.restore();

          // 选中导线后，在线的中点长出一个删除圆钮（和元件那颗同一颗）
          drawDelButton(ctx, delButtonPos(wr));
        }
      }

      // 正在转：把当前角度写出来。旋钮上那根指针说得出「朝哪」，说不出「多少度」——
      // 老师让学生「转到 30°」时，这个数是唯一的依据。
      if (rotating) {
        var rgc = byId(rotating.id);
        if (rgc) {
          var rbp = compRotPos(rgc);
          var txt = Math.round(rgc.rot || 0) + '°';
          ctx.save();
          ctx.font = 'bold 16px -apple-system,"PingFang SC",sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          var tw = ctx.measureText(txt).width;
          var pw = tw + 20, ph = 26;
          var px0 = rbp.x - pw / 2, py0 = rbp.y - ROT_R - 9 - ph;
          // 药丸贴到画布上沿时翻到钮下面，别让数跑出画布
          if (py0 < 2) py0 = rbp.y + ROT_R + 9;
          ctx.fillStyle = 'rgba(37,99,235,0.96)';
          D.roundRect(ctx, px0, py0, pw, ph, 8); ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.fillText(txt, rbp.x, py0 + ph / 2 + 0.5);
          ctx.restore();
        }
      }

      // 正在拉的导线：虚线预览，走的就是鼠标划过的轨迹
      if (wiring) {
        // 起点可能是【悬空线头】（拖回来重插），所以走 endPt 而不是 terminalWorld
        var p0 = endPt(wiring.from);
        if (p0) {
          var p1 = wiring.to ? { x: wiring.to.x, y: wiring.to.y }
                   : (wiring.snap ? wiring.snap.q : wiring.cur);
          var trail = wiring.trail.slice(1);
          var endGap = trail.length ? Math.hypot(
            trail[trail.length-1].x - p1.x, trail[trail.length-1].y - p1.y) : 0;
          if (endGap < TRAIL_MIN * 2) trail.pop();
          var prev = simplify(trail, TRAIL_TOL);
          ctx.save();
          // 绿 = 能接（落在接线柱上，或吸到了某根导线的中间）、橙 = 悬空、
          // 红 = 这个落点不让接（见 rangeConflict）
          var wc = wiring.blocked ? '#dc2626'
                 : (wiring.to || wiring.snap) ? '#16a34a' : '#f59e0b';
          ctx.strokeStyle = wc;
          ctx.lineWidth = 3; ctx.setLineDash([9, 6]);
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          for (var i = 0; i < prev.length; i++) ctx.lineTo(prev[i].x, prev[i].y);
          ctx.lineTo(p1.x, p1.y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = wc;
          ctx.beginPath(); ctx.arc(p1.x, p1.y, 6, 0, 6.284); ctx.fill();
          // 吸到导线上时，把「这里会生出一个接线点」直接画出来
          if (wiring.snap) {
            var sq = wiring.snap.q;
            ctx.strokeStyle = '#16a34a'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(sq.x, sq.y, 11, 0, 6.284); ctx.stroke();
            ctx.beginPath(); ctx.arc(sq.x, sq.y, 4.5, 0, 6.284);
            ctx.fillStyle = '#16a34a'; ctx.fill();
          }
          if (wiring.blocked) {
            // 光变红还不够，得说清为什么，否则学生只会反复试
            ctx.fillStyle = '#dc2626';
            ctx.font = 'bold 13px -apple-system,"PingFang SC",sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('只能用一个量程', p1.x, p1.y - 14);
          }
          ctx.restore();
        }
      }

      // 场景为空时给一句提示，别让人对着空白画布发呆
      if (cs.length === 0) {
        ctx.save();
        ctx.fillStyle = '#94a3b8';
        ctx.font = '15px -apple-system,"PingFang SC",sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('从右上角的元件栏点一个元件放进来，再从接线柱拖出导线', W / 2, H / 2);
        ctx.restore();
      }
    }

    return {
      toLogical: toLogical, pathOf: pathOf, bodyHalf: bodyHalf, localBox: localBox, byId: byId,
      addComp: addComp, setParam: setParam, removeSelected: removeSelected,
      // 参数面板的「量程」按钮走它，而不是 setParam：量程在实物上是「线接在
      // 哪个柱子上」，改参数不改接线的话画面和读数就对不上了。
      plugRange: plugRange,
      // 「对调极性」按钮。和 plugRange 同一条路子：面板上的按钮改的是
      // 【元件/接线的实际状态】，不是一条参数 —— 只 setParam('flip') 的话，
      // 挂在元件上的导线不会跟着换端点，线头会当场被拽到另一头去。
      flipComp: flipComp,
      // 改名。页面点画布上的名字标签时调它。空名 = 恢复自动编号。
      setName: setName,
      rotateSelected: rotateSelected, undo: undo, rerouteAll: rerouteAll,
      select: function (s) { select(s); changed(); },
      getSelected: function () { return describeSelection(); },
      pushUndo: pushUndo,
      delButtonPos: delButtonPos,
      // 元件左上角那颗删除钮的位置（世界坐标）。自检按它点真实鼠标，
      // 走的才是学生走的那条路（onDown → hitDeleteButton → removeSelected）。
      compDeletePos: compDeletePos,
      // 旋转钮（元件自由旋转）的位置、半径和命中判据。自检要按【这个位置】拖真实
      // 鼠标，走的才是学生走的那条路（onDown → hitRotButton → rotating）；
      // 自己按 ROT_R 猜坐标的话，钮挪了位置断言会跟着一起错，反而验不出来。
      compRotPos: compRotPos,
      hitRotButton: hitRotButton,
      ROT_R: ROT_R,
      // 当前旋转拖动状态。「按下去真的进入了旋转拖动」光看元件角度是分不出来的
      //（按下不动角度也没变），得直接问编辑器。
      rotDrag: function () {
        return rotating ? { id: rotating.id, moved: rotating.moved } : null;
      },
      // 「往导线中间连线」那一条路的两半，分开导出：
      //   nearestOnWire   = 吸附判据（纯函数，喂一个逻辑坐标进去看它吸到哪）；
      //   connectToWireMid= 落线动作（会改场景）。
      // 分开是为了能单独验「吸附点算得对不对」和「接上以后拓扑对不对」——
      // 混在一起只能靠截图猜。
      rawPathOf: rawPathOf,
      nearestOnWire: nearestOnWire,
      connectToWireMid: connectToWireMid,
      // 拖到【空白处】停住成线：落点长一颗接线点，途经轨迹成为导线的拐点。
      // 和 connectToWireMid 的落点判据互补（那条压的是已有导线的中段）。
      connectToPoint: connectToPoint,
      // 停留成线的计时进度（宿主拿它画「快接上了」的圆环）。返回
      // { x, y, k }（k = 0~1）或 null（没在计时 / 已经接上）。
      // 判据和 onMove 里那条逐项对齐：少一项就会出现「圆环转满了却没接线」。
      dwellInfo: function () {
        if (!wiring || !wiring.dwellPt || wiring.fromWire || wiring.to ||
            wiring.blocked || wiring.snap) return null;
        var k = (nowMs() - wiring.dwellT) / DWELL_MS;
        if (!(k > 0) || k >= 1) return null;
        return { x: wiring.cur ? wiring.cur.x : wiring.dwellPt.x,
                 y: wiring.cur ? wiring.cur.y : wiring.dwellPt.y, k: k };
      },
      // 端子↔端子直接连线（外部代码 / 3D 版沙盒用）。和 connectToWireMid 一样
      // 是「落线动作」，只是落点也是一个接线柱而不是导线中间。
      connectTerminals: connectTerminals,
      // 删元件保留导线（用户要求）以后，导线上会出现【悬空端】。这两条给测试用：
      // 判「线头还在不在」「点没点中它」，光看场景是分不出来的 ——
      // compId 为 null 和 compId 指向一个已经不存在的元件，外观上一模一样。
      endPt: endPt,
      isLooseEnd: isLooseEnd,
      hitLooseEnd: hitLooseEnd,
      // 滑片中心的逻辑坐标。测试和外部代码都用它，别自己按 RHEO 常数猜。
      knobPos: function (id) {
        var c = byId(id);
        if (!c || c.type !== 'rheostat') return null;
        return D.toWorld(c, D.sliderLocalX(D.slideOf(c)),
                         (D.RHEO.knobTop + D.RHEO.knobBottom) / 2);
      },
      // 学生电源：旋钮中心与面板开关矩形的逻辑坐标。页面「点开关通断」和
      // 自检「拖旋钮」都要用，别自己按 PSU 常数再猜一遍 —— 猜的那份一旦和
      // 绘制漂移，症状就是「看得见却点不着」。
      psuKnobPos: function (id) {
        var c = byId(id);
        if (!c || c.type !== 'power' || !D.PSU) return null;
        var lx = D.PSU.KNOB.x, ly = D.PSU.KNOB.y;
        if (D.flipOf(c)) lx = -lx;
        return D.toWorld(c, lx, ly);
      },
      // 面板开关命中的是【元件自身坐标系】的矩形：调用方自己 toLocal 再判，
      // 这样镜像 / 旋转都跟着走。
      psuSwitchRect: psuSwitchRect,
      // 世界坐标 → 「这一下落在哪台学生电源的面板开关 / 电压旋钮上」。
      // 页面点开关要通断，走它比「psuSwitchRect + 自己 toLocal + 自己补 flip」
      // 少两处能漂的地方；自检还要用它断「两块命中框不许相交」。
      hitPsuSwitch: hitPsuSwitch,
      hitPsuKnob: hitPsuKnob,
      beginSilent: function () { muted = true; },
      endSilent: function () { muted = false; pushUndo(); },
      drawOverlay: drawOverlay,
      GRID: GRID,
      // 拖导线：上限和当前状态都给出去，测试不用自己猜 90 这个数。
      WIRE_DRAG_MAX: WIRE_DRAG_MAX,
      // 撤销栈深度。「点一下不留撤销记录」这条规矩只能靠它验 —— 光看场景
      // 变没变是分不出「没入栈」和「入了栈又恰好长得一样」的。
      undoDepth: function () { return undoStack.length; },
      wireDragInfo: function () {
        if (!wireDrag) return null;
        var wr = getScene().wires[wireDrag.index];
        return { index: wireDrag.index, moved: wireDrag.moved,
                 via0: wireDrag.via0.length,
                 via: wr ? (wr.via || []).map(function (z) { return [z[0], z[1]]; }) : null };
      },
    };
  }

  return { create: create, GRID: GRID, BODY: BODY, ID_PREFIX: ID_PREFIX };
});
