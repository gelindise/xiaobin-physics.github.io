/*!
 * circuit-schlab.js —— 电路图画布（拖符号画标准电路图 + 当场仿真）
 *
 * 和沙盒主画布的关系：
 *   · 物理内核完全共用（circuit-core.js 的 solve / faultsOf）—— 同一套 MNA、
 *     同一套损坏模型。画布上算出来的电流，和实物画布上摆同样的电路【一个数】。
 *   · 符号也完全共用（circuit-schematic.js 的 itemOf + drawSymbol）—— 学生手画的
 *     这张图，和「由实物图转换」出来的那张长得一模一样，不会出现两套「标准符号」。
 *   · 只有【交互】是新的：这里摆的是符号，位置由学生拖，不走自动布局。
 *
 * 场景数据结构和沙盒一致：{ comps:[{id,type,x,y,rot,params}], wires:[{a,b,via}] }，
 * 端点 {compId, termIdx}。所以内核、参数表（circuit-params）都能直接吃。
 *
 *   const lab = CircuitSchLab.create(hostEl, { onClose: fn });
 *   lab.open();  lab.close();
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CircuitSchLab = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var G = (typeof self !== 'undefined') ? self : this;
  function C() { return G.CircuitCore; }
  function SC() { return G.CircuitSchematic; }
  function D() { return G.CircuitDraw; }
  function P() { return G.CircuitParams; }

  // 画布逻辑尺寸。所有坐标都是这套数，指针换算按 rect 比例缩回去。
  var W = 1180, H = 720, GRID = 20;
  var PIN_HIT = 15;          // 指针离引脚多近算「抓到了」
  var PIN_MAGNET = 30;       // 拉线时离引脚多近就自动吸过去（比 PIN_HIT 宽：松手不要求像素级）
  var WIRE_HIT = 9;          // 松手时离已有导线多近算「接到这根线上」（自动生成三通）
  var UNDO_MAX = 60;

  // 器材栏。只放「电路图上认得出、且内核支持」的八件 —— 元件盒里那些
  // （导体板 / 示教板 / 铅笔芯 / 电铃）在电路图里要么是同一个矩形、要么
  // 课本上不要求，放进来只会让这一屏变成第二个元件盒。
  var PAL = [
    { type: 'battery',  label: '电源',     hint: '一长一短两条线' },
    { type: 'switch',   label: '开关',     hint: '点一下通断' },
    { type: 'bulb',     label: '小灯泡',   hint: '圆圈里一个叉' },
    { type: 'resistor', label: '定值电阻', hint: '空心矩形' },
    { type: 'rheostat', label: '滑动变阻器', hint: '矩形 + 滑片箭头，可拖' },
    { type: 'ammeter',  label: '电流表',   hint: '圆里写 A，串在电路里' },
    { type: 'voltmeter', label: '电压表',  hint: '圆里写 V，并在被测元件两端' },
    { type: 'motor',    label: '电动机',   hint: '圆里写 M' },
  ];
  var TYPE_LABEL = { battery: '电源', switch: '开关', bulb: '小灯泡', resistor: '定值电阻',
                     rheostat: '滑动变阻器', ammeter: '电流表', voltmeter: '电压表',
                     motor: '电动机', junction: '接线点' };
  var ID_PREFIX = { battery: 'U', switch: 'S', bulb: 'L', resistor: 'R',
                    rheostat: 'RH', ammeter: 'A', voltmeter: 'V', motor: 'M',
                    junction: 'J' };

  function snap(v) { return Math.round(v / GRID) * GRID; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function num(v, d) { v = +v; return isFinite(v) ? v : d; }

  // ── 引脚 ────────────────────────────────────────────────────
  // 画布上的「引脚」和内核的「端子号」不是一回事：变阻器在图上只有三个脚
  // （A 左、滑片 C 顶、B 右），内核却有四个（C/D 已并成同一个节点）；
  // 电表图上只有两个脚（左「−」、右量程柱），内核有三个（1/2 是两个量程）。
  // 这张表就是两套编号之间的唯一换算 —— 少一处、多一处都会接错柱子。
  var PINS = {
    battery:  [0, 1], switch: [0, 1], bulb: [0, 1], resistor: [0, 1], motor: [0, 1],
    rheostat: [0, 2, 1],            // 左 A · 顶 滑片 · 右 B
    ammeter:  [0, 2], voltmeter: [0, 2],   // 右脚的 1/2 由 tapSel 决定，见 termOfPin
    // 接线点（三通的实心点）：两个端子在同一个位置上，内核 internalShort 把它们
    // 并成一个节点。画布上不画符号，只画那个点（见 drawJunctions）。
    junction: [0, 1],
  };
  function pinsOf(type) { return PINS[type] || [0, 1]; }
  // 视觉引脚序号 → 内核端子号。电表的右脚要看它现在接的是哪个量程柱。
  function termOfPin(comp, i) {
    var map = pinsOf(comp.type);
    var t = map[i];
    if ((comp.type === 'ammeter' || comp.type === 'voltmeter') && i === 1) {
      return (comp.params && +comp.params.tapSel === 1) ? 1 : 2;
    }
    return t;
  }
  // 引脚序号（给某个端子号）：电表两个量程柱在图上同一个点，所以 1/2 都算右脚。
  function pinOfTerm(comp, term) {
    var map = pinsOf(comp.type);
    if ((comp.type === 'ammeter' || comp.type === 'voltmeter') && (term === 1 || term === 2)) return 1;
    var k = map.indexOf(term);
    return k < 0 ? 0 : k;
  }

  // 元件在画布上的模型（复用电路图模块的单件出口）。
  function itemOf(comp, wires, rec) {
    return SC().itemOf(comp, wires, rec, D(), {});
  }
  // 端子世界坐标。接线点没有符号（也不该有符号框），两个端子都落在它自己那一点上。
  function termWorldOf(comp, term, wires, rec) {
    if (comp.type === 'junction') return { x: comp.x, y: comp.y };
    return SC().termWorld(itemOf(comp, wires, rec), term, D());
  }
  function pinWorld(comp, pinIdx, wires, rec) {
    if (comp.type === 'junction') return { x: comp.x, y: comp.y };
    return termWorldOf(comp, termOfPin(comp, pinIdx), wires, rec);
  }
  function symBox(comp, wires, rec) {
    // 接线点：一个 12×12 的小方框，只够点中它、删掉它，不参与走线避让。
    if (comp.type === 'junction') {
      return { x0: comp.x - 6, y0: comp.y - 6, x1: comp.x + 6, y1: comp.y + 6 };
    }
    var it = itemOf(comp, wires, rec);
    var r = it.rect, c = comp;
    // 符号框（局部）→ 世界（只认 0/180，画布上不转 90°：电路图的符号都是横的）
    var x0 = Math.min(r.x0, r.x1), x1 = Math.max(r.x0, r.x1);
    var y0 = Math.min(r.y0, r.y1), y1 = Math.max(r.y0, r.y1);
    if ((c.rot || 0) % 360 === 180) { var t = x0; x0 = -x1; x1 = -t; }
    return { x0: c.x + x0, y0: c.y + y0, x1: c.x + x1, y1: c.y + y1 };
  }

  function create(host, opts) {
    opts = opts || {};
    if (!host) throw new Error('CircuitSchLab.create 需要一个容器');
    if (!C() || !SC() || !D()) throw new Error('circuit-schlab 需要 core / draw / schematic');

    var scene = { comps: [], wires: [] };
    var results = null, selId = null;
    // 通电状态（用户 2026-10-22 第 1 点）：连好电路【不算通电】，点「▶ 运行」
    // 才真的通电 —— 在那之前电表一个数都不显示，数据表全是「—」。
    // 这既符合实验室的真实流程（先接线、检查、再合闸），也让学生分清
    // 「图画完了」和「电路在工作」两件事。
    var energized = false;
    var undoStack = [], redoStack = [];
    var drag = null;            // 拖元件
    var wireDrag = null;        // 拉线（从某个引脚拖到另一个）
    var slideDrag = null;       // 拖变阻器滑片
    var hoverPin = null;
    var hoverCompId = null;     // 指针悬在哪件器材上（只用来给它淡淡地标出引脚）
    var dpr = 1;

    // ── DOM ──────────────────────────────────────────────────
    host.innerHTML = '';
    // 🔴 只【加】类，不能写 className：页面给这个容器挂的是 .schLabWrap（遮罩 +
    // fixed 定位），一覆盖就成了「一块 960px 高的普通 div」—— 打开以后面板
    // 停在文档流末尾、视口外面，看着像没打开（第一版就是这么翻车的）。
    host.classList.add('schLabWrap');
    var panel = el('div', 'schLab');
    var head = el('div', 'labHead');
    head.appendChild(el('span', 'labTitle', '📐 电路图画布'));
    head.appendChild(el('span', 'labTip',
      '拖符号 → 点两个接线柱就接上（或直接拖）→ 接好点「▶ 运行」通电看读数'));
    var btnX = el('button', 'labX', '✕ 关闭');
    btnX.type = 'button';
    head.appendChild(btnX);

    var body = el('div', 'labBody');
    var pal = el('div', 'labPal');
    var stage = el('div', 'labStage');
    var cv = document.createElement('canvas');
    cv.className = 'labCanvas';
    stage.appendChild(cv);
    var side = el('div', 'labSide');
    var sideParams = el('div', 'labCard');
    var sideData = el('div', 'labCard');
    var sideFaults = el('div', 'labCard');
    side.appendChild(sideParams); side.appendChild(sideData); side.appendChild(sideFaults);

    var bar = el('div', 'labBar');
    var bUndo = el('button', 'labBtn', '↩ 撤销');
    var bRedo = el('button', 'labBtn', '↪ 重做');
    var bDel = el('button', 'labBtn', '🗑 删除');
    var bRot = el('button', 'labBtn', '⟳ 转 180°');
    var bFix = el('button', 'labBtn', '🔧 全部修复');
    var bClear = el('button', 'labBtn', '🧽 清空');
    var bHelp = el('button', 'labBtn', '？ 怎么用');
    [bUndo, bRedo, bDel, bRot, bFix, bClear, bHelp].forEach(function (b) {
      b.type = 'button'; bar.appendChild(b);
    });
    var presetWrap = el('span', 'labPresets');
    [['串联', 0], ['并联', 1], ['伏安法', 2]].forEach(function (p) {
      var b = el('button', 'labBtn preset', '预设·' + p[0]);
      b.type = 'button';
      b.dataset.preset = String(p[1]);
      presetWrap.appendChild(b);
    });
    bar.appendChild(presetWrap);

    body.appendChild(pal); body.appendChild(stage); body.appendChild(side);
    panel.appendChild(head); panel.appendChild(body); panel.appendChild(bar);
    host.appendChild(panel);

    var ctx = cv.getContext('2d');
    var toast = el('div', 'labToast');
    stage.appendChild(toast);
    var toastTimer = 0;
    function say(msg, ms) {
      toast.textContent = msg;
      toast.classList.add('on');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { toast.classList.remove('on'); }, ms || 1800);
    }

    // ── 器材栏 ────────────────────────────────────────────────
    PAL.forEach(function (p) {
      var card = el('div', 'labPalCard');
      card.dataset.type = p.type;
      var ic = document.createElement('canvas');
      ic.className = 'labPalIcon'; ic.width = 84; ic.height = 56;
      card.appendChild(ic);
      card.appendChild(el('b', '', p.label));
      card.appendChild(el('i', '', p.hint));
      pal.appendChild(card);
      // 小图标：用【真符号渲染器】画在卡上 —— 卡片上看到的和画布上摆下去的是
      // 同一个符号，不是另画一套缩略图（那套迟早和真符号长得不一样）。
      var g = ic.getContext('2d');
      g.clearRect(0, 0, 84, 56);
      g.save();
      g.translate(42, 30);
      g.scale(0.4, 0.4);
      try {
        var fake = { id: 'X', type: p.type, x: 0, y: 0, rot: 0,
                     params: C().defaultParams(p.type) };
        SC().drawSymbol(g, itemOf(fake, [], null), D(), false);
      } catch (e) { /* 图标画不出来不该让整块画布挂掉 */ }
      g.restore();
      // 拖 / 点：点一下直接放在画布中央偏下的空位；拖过去放在落点。
      card.addEventListener('pointerdown', function (ev) {
        ev.preventDefault();
        startPaletteDrag(p.type, ev, card);
      });
    });

    // ── 画布尺寸 ─────────────────────────────────────────────
    // 逻辑坐标恒为 W×H；CSS 尺寸按舞台的可用空间等比缩。所有指针换算都走
    // rect 比例，所以「画布在屏幕上多大」不影响任何坐标。
    var lastCss = '';
    function resize() {
      dpr = window.devicePixelRatio || 1;
      var r = stage.getBoundingClientRect();
      var aw = Math.max(240, (r.width || 900) - 20);
      var ah = Math.max(160, (r.height || 600) - 20);
      var k = Math.min(aw / W, ah / H);
      var cw = Math.round(W * k), ch = Math.round(H * k);
      var sig = cw + 'x' + ch + '@' + dpr;
      if (sig === lastCss) return;
      lastCss = sig;
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      cv.style.width = cw + 'px';
      cv.style.height = ch + 'px';
      draw();
    }
    if (window.ResizeObserver) new ResizeObserver(function () { resize(); }).observe(host);
    window.addEventListener('resize', resize);

    // ── 场景操作 ─────────────────────────────────────────────
    function byId(id) {
      for (var i = 0; i < scene.comps.length; i++) if (scene.comps[i].id === id) return scene.comps[i];
      return null;
    }
    function snapshot() { return JSON.stringify({ comps: scene.comps, wires: scene.wires }); }
    function pushUndo() {
      undoStack.push(snapshot());
      if (undoStack.length > UNDO_MAX) undoStack.shift();
      redoStack.length = 0;
      syncBar();
    }
    function restore(json) {
      var o = JSON.parse(json);
      scene.comps = o.comps; scene.wires = o.wires;
      if (selId && !byId(selId)) selId = null;
      solve(); renderAll();
    }
    function undo() {
      if (!undoStack.length) return false;
      redoStack.push(snapshot());
      restore(undoStack.pop());
      return true;
    }
    function redo() {
      if (!redoStack.length) return false;
      undoStack.push(snapshot());
      restore(redoStack.pop());
      return true;
    }

    function nextId(type) {
      var pfx = ID_PREFIX[type] || 'X', n = 1;
      while (byId(pfx + n)) n++;
      return pfx + n;
    }
    function addComp(type, x, y) {
      pushUndo();
      var c = { id: nextId(type), type: type, x: snap(x), y: snap(y), rot: 0,
                params: C().defaultParams(type) };
      scene.comps.push(c);
      selId = c.id;
      solve(); renderAll();
      return c;
    }
    function removeComp(id) {
      pushUndo();
      // 导线一根不删：端点冻在原地（和主画布同一条规矩 —— 「把元件从桌上拿走，
      // 两根线还躺在桌上」）。冻住坐标，不然端点指向一个不存在的元件，重绘会炸。
      scene.wires.forEach(function (w) {
        ['a', 'b'].forEach(function (k) {
          var e = w[k];
          if (!e || e.compId !== id) return;
          var c = byId(id);
          if (c) {
            var p = termWorldOf(c, e.termIdx, scene.wires, recOf(c));
            if (p) { e.x = p.x; e.y = p.y; }
          }
          e.compId = null; e.termIdx = 0;
        });
      });
      scene.comps = scene.comps.filter(function (c) { return c.id !== id; });
      selId = null;
      solve(); renderAll();
    }
    function recOf(c) { return results && results.components ? results.components[c.id] : null; }

    function wireEnds(w) {
      var a = w.a.compId ? byId(w.a.compId) : null;
      var b = w.b.compId ? byId(w.b.compId) : null;
      var pa = a ? termWorldOf(a, w.a.termIdx, scene.wires, recOf(a))
                 : (w.a.x != null ? { x: w.a.x, y: w.a.y } : null);
      var pb = b ? termWorldOf(b, w.b.termIdx, scene.wires, recOf(b))
                 : (w.b.x != null ? { x: w.b.x, y: w.b.y } : null);
      return { a: pa, b: pb };
    }
    function pathOf(w) {
      var e = wireEnds(w);
      if (!e.a || !e.b) return [];
      var pts = [e.a];
      (w.via || []).forEach(function (v) { pts.push({ x: v[0], y: v[1] }); });
      pts.push(e.b);
      return pts;
    }

    // ── 正交走线（带避让）────────────────────────────────────
    // 用户 2026-10-22 第 2 点：「导线都是横平竖直的……智能一些」。
    // 所以这里不只是「中点竖着走」那一种 Z 形，而是把五种正交画法都算出来，
    // 按「穿过几个元件 → 拐几个弯 → 有多长」打分，挑最干净的那条：
    //   直连 / 先横后竖 / 先竖后横 / 竖走中线的 Z / 横走中线的 Z。
    // 打分里「穿元件」权重最高：一根线从电阻方框中间穿过去，学生第一眼就会
    // 把它读成「导线从电阻里过」—— 电路图就白画了。
    function boxesOf(exceptIds) {
      var out = [];
      scene.comps.forEach(function (c) {
        if (c.type === 'junction') return;              // 接线点没有符号，不挡线
        if (exceptIds && exceptIds.indexOf(c.id) >= 0) return;
        var b = symBox(c, scene.wires, recOf(c));
        out.push({ x0: b.x0 - 5, y0: b.y0 - 5, x1: b.x1 + 5, y1: b.y1 + 5 });
      });
      return out;
    }
    // 轴对齐线段 × 矩形（线段是退化的矩形，直接判两个 AABB 相交）
    function segHitsBox(p, q, b) {
      var lx = Math.min(p.x, q.x), hx = Math.max(p.x, q.x);
      var ly = Math.min(p.y, q.y), hy = Math.max(p.y, q.y);
      return !(hx < b.x0 || lx > b.x1 || hy < b.y0 || ly > b.y1);
    }
    function routeScore(pts, boxes) {
      var cross = 0, len = 0;
      for (var i = 0; i < pts.length - 1; i++) {
        var p = pts[i], q = pts[i + 1];
        len += Math.abs(p.x - q.x) + Math.abs(p.y - q.y);
        for (var k = 0; k < boxes.length; k++) if (segHitsBox(p, q, boxes[k])) { cross++; break; }
      }
      return cross * 1000 + (pts.length - 2) * 5 + len * 0.02;
    }
    function routeBetween(p, q, exceptIds) {
      var boxes = boxesOf(exceptIds);
      var cands = [];
      // 同高 / 同列：先试直连，穿不过去再绕
      if (Math.abs(p.y - q.y) < 2 || Math.abs(p.x - q.x) < 2) {
        cands.push([]);
      }
      var mx = snap((p.x + q.x) / 2), my = snap((p.y + q.y) / 2);
      cands.push([[q.x, p.y]]);                       // 先横后竖
      cands.push([[p.x, q.y]]);                       // 先竖后横
      cands.push([[mx, p.y], [mx, q.y]]);             // 竖走中线
      cands.push([[p.x, my], [q.x, my]]);             // 横走中线
      // 绕行档：从每件器材的上/下/左/右外面走一条「门框」。
      // 🔴 没有这一档，「两件器材之间夹着一件」时无解 —— 上面五种画法全都要
      //    从中间那件身上穿过去，算法只能挑一条「穿过去」的（实测就是这么翻的）。
      //    绕行的路长一点，但那是电路图里唯一正确的画法。
      boxes.forEach(function (b) {
        cands.push([[p.x, b.y0 - GRID], [q.x, b.y0 - GRID]]);
        cands.push([[p.x, b.y1 + GRID], [q.x, b.y1 + GRID]]);
        cands.push([[b.x0 - GRID, p.y], [b.x0 - GRID, q.y]]);
        cands.push([[b.x1 + GRID, p.y], [b.x1 + GRID, q.y]]);
      });
      var best = null, bestScore = Infinity;
      cands.forEach(function (via) {
        // 折点里和端点重合的去掉（否则会多出一段零长度的线，评分和画面上都难看）
        var pts = [{ x: p.x, y: p.y }];
        via.forEach(function (v) {
          var q2 = { x: v[0], y: v[1] };
          var last = pts[pts.length - 1];
          if (Math.abs(q2.x - last.x) < 0.5 && Math.abs(q2.y - last.y) < 0.5) return;
          pts.push(q2);
        });
        if (Math.abs(pts[pts.length - 1].x - q.x) > 0.5 ||
            Math.abs(pts[pts.length - 1].y - q.y) > 0.5) pts.push({ x: q.x, y: q.y });
        // 去掉「拐了但没换方向」的共线点
        var clean = [pts[0]];
        for (var i = 1; i < pts.length; i++) {
          var a = clean[clean.length - 1], b = pts[i];
          if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5) continue;
          clean.push(b);
        }
        var sc = routeScore(clean, boxes);
        if (sc < bestScore) { bestScore = sc; best = clean; }
      });
      if (!best || best.length < 2) return [];
      // 返回的 via 不含两个端点
      return best.slice(1, best.length - 1).map(function (pt) { return [pt.x, pt.y]; });
    }
    // 同一条端子已经连过就不重复接（画面上会叠成一条，学生以为没接上）
    function wireExists(aComp, tA, bComp, tB) {
      return scene.wires.some(function (w) {
        return (w.a.compId === aComp.id && w.a.termIdx === tA && w.b.compId === bComp.id && w.b.termIdx === tB) ||
               (w.b.compId === aComp.id && w.b.termIdx === tA && w.a.compId === bComp.id && w.a.termIdx === tB);
      });
    }
    function addWire(aComp, aPin, bComp, bPin, noUndo, via) {
      var tA = termOfPin(aComp, aPin), tB = termOfPin(bComp, bPin);
      if (aComp.id === bComp.id && tA === tB) return false;
      if (wireExists(aComp, tA, bComp, tB)) return false;
      if (!noUndo) pushUndo();
      var pa = pinWorld(aComp, aPin, scene.wires, recOf(aComp));
      var pb = pinWorld(bComp, bPin, scene.wires, recOf(bComp));
      scene.wires.push({ a: { compId: aComp.id, termIdx: tA },
                         b: { compId: bComp.id, termIdx: tB },
                         // via 由调用方给（手画的那根 = 用户拖出来的那条折线，
                         // 松手前后一模一样，不会「啪」地跳一下）；没给就按避让算。
                         via: via || routeBetween(pa, pb, [aComp.id, bComp.id]) });
      solve(); renderAll();
      return true;
    }
    function setParam(id, key, val, noUndo) {
      var c = byId(id); if (!c) return;
      if (!noUndo) pushUndo();
      c.params = c.params || {};
      c.params[key] = val;
      // 变阻器的滑片位置一变，导线不用重算（端子在轴上没动）—— 但电阻变了，
      // 读数要跟着变，所以下面统一 solve。
      // 🔴 这里【只刷数据、不重建参数面板】：重建的话，正在被拖的那根滑块会
      //    从 DOM 上被抽走 —— 拖一下手指就「丢」了（主画布踩过同一个坑，
      //    它那边叫 syncSlidePanel）。
      solve(); refreshData();
    }
    function refreshData() { draw(); renderData(); renderFaults(); }
    // 电表换量程：图上右脚是同一个点，换的是【右脚接哪个量程柱】。
    // 所以要把挂在这个脚上的导线端点一起改过去，否则内核按旧柱子算量程。
    function setMeterRange(c, tap) {
      if (c.type !== 'ammeter' && c.type !== 'voltmeter') return false;
      var old = (c.params && +c.params.tapSel === 1) ? 1 : 2;
      if (+tap === old) return false;
      pushUndo();
      c.params = c.params || {};
      c.params.tapSel = +tap;
      scene.wires.forEach(function (w) {
        ['a', 'b'].forEach(function (k) {
          var e = w[k];
          if (e && e.compId === c.id && (e.termIdx === 1 || e.termIdx === 2)) e.termIdx = +tap;
        });
      });
      solve(); renderAll();
      return true;
    }
    function repairAll() {
      var any = false;
      scene.comps.forEach(function (c) { if (c.fault) { c.fault = null; c.faultWhy = ''; any = true; } });
      scene.wires.forEach(function (w) { if (w.broken) { w.broken = false; w.brokenWhy = ''; any = true; } });
      if (any) { solve(); renderAll(); say('已经全部修好了'); }
      else say('现在没有损坏的器材');
      return any;
    }
    function clearAll() {
      if (!scene.comps.length && !scene.wires.length) return;
      pushUndo();
      scene.comps = []; scene.wires = []; selId = null;
      energized = false;              // 画布清空 = 没有电路可通电
      solve(); renderAll();
    }

    // ── 求解 + 故障 ──────────────────────────────────────────
    var flows = [];
    var shortSeen = null;
    function solve() {
      shortSeen = null;
      // 🔴 没点「运行」= 没通电：不求解、不出示数、也不烧东西。
      // 只闭合开关不算通电 —— 这正是用户第 1 点要的「模拟」：
      // 真实实验里也是先接线、检查、再合闸，合闸（点运行）之后才读表。
      if (!energized) { results = null; flows = []; return; }
      // 损坏要迭代到收敛：烧断一个灯泡会改拓扑，拓扑一变读数又变。
      // 和主画布同一个做法（那边叫 DAMAGE_MAX_PASS），最多三轮。
      for (var pass = 0; pass < 3; pass++) {
        results = C().solve(scene.comps, scene.wires);
        flows = results.flows || [];
        noMeterPolarity();
        // 短路是【一闪就没】的：下一轮 applyFaults 会把电源 / 导线烧掉，
        // 拓扑一变就不再是短路了。所以把第一次看到的短路记下来，故障栏里
        // 那句话才留得住（主画布同一条规矩）。
        if (!shortSeen && results.shortCircuit && (results.shortCircuit.compIds || []).length) {
          shortSeen = results.shortCircuit;
        }
        if (!applyFaults()) break;
      }
      // 导线熔断：主画布把 broken 写进导线，内核会当成断路。
      scene.wires.forEach(function (w) { if (w.broken) w.broken = true; });
    }
    // 🔴 电路图里【不判电表正负】（用户 2026-10-22）：
    //    「连线的时候不存在这个说，在电路图中是体现不出来正负接线柱的；
    //     默认都是正确的，不能说一运行就发现接反了。」
    // 所以：读数取绝对值（指针永远往右偏），reversed 一律抹掉，
    // METER_REVERSED 警告也去掉 —— 后面的 faultsOf 就不会判「接反损坏」。
    // 正负柱的「标注」只是画面上的字（参数里的 polarity），不参与计算。
    function noMeterPolarity() {
      if (!results || !results.components) return;
      scene.comps.forEach(function (c) {
        if (c.type !== 'ammeter' && c.type !== 'voltmeter') return;
        var r = results.components[c.id];
        if (!r) return;
        r.reversed = false;
        if (r.reading != null) r.reading = Math.abs(r.reading);
      });
      if (results.warnings) {
        results.warnings = results.warnings.filter(function (w) { return w.code !== 'METER_REVERSED'; });
      }
    }
    function applyFaults() {
      if (!results || !results.components) return false;
      var f = C().faultsOf(scene.comps, scene.wires, results, flows);
      var wrote = false;
      (f.comps || []).forEach(function (x) {
        var c = byId(x.id);
        if (!c || c.fault) return;
        c.fault = x.fault; c.faultWhy = x.why || '';
        wrote = true;
      });
      (f.wires || []).forEach(function (i) {
        var w = scene.wires[i];
        if (!w || w.broken) return;
        w.broken = true; w.brokenWhy = '短路电流过大，导线熔断';
        wrote = true;
      });
      return wrote;
    }
    function warningsOf() {
      var out = [];
      // 没通电时没有「新的」警告，但【已经烧坏的器材】还要照旧列出来 ——
      // 那是物理损伤，不会因为断电就自己好了。
      if (results) {
        (results.warnings || []).forEach(function (w) { out.push({ code: w.code, msg: w.message }); });
        var sc = shortSeen || results.shortCircuit;
        if (sc && sc.compIds && sc.compIds.length) {
          out.push({ code: 'SHORT', msg: '电源被短路：电流极大，器材会被烧坏' });
        }
      }
      scene.comps.forEach(function (c) {
        if (c.fault) out.push({ code: 'FAULT', msg: TYPE_LABEL[c.type] + ' ' + c.id + '：' + (c.faultWhy || '已损坏') });
      });
      scene.wires.forEach(function (w, i) {
        if (w.broken) out.push({ code: 'WIRE', msg: '导线 ' + (i + 1) + '：' + (w.brokenWhy || '已熔断') });
      });
      return out;
    }

    // ── 绘制 ─────────────────────────────────────────────────
    function draw() {
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      drawPaper(ctx);
      scene.wires.forEach(function (w) { drawWire(ctx, w); });
      if (wireDrag && wireDrag.cur) drawWirePreview(ctx);
      scene.comps.forEach(function (c) { drawComp(ctx, c); });
      drawJunctions(ctx);        // 实心点压在导线之上、符号之下（它属于「线」）
      drawPins(ctx);
      drawSelection(ctx);
    }
    function drawPaper(g) {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, W, H);
      // 方格纸：每 20px 一根浅线、每 100px 一根深线。学生摆符号时靠它对齐，
      // 比「眼睛估」稳得多 —— 电路图的美感一半来自导线横平竖直、间距均匀。
      g.save();
      g.strokeStyle = '#eef2f7'; g.lineWidth = 1;
      for (var x = 0; x <= W; x += GRID) {
        g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); g.stroke();
      }
      for (var y = 0; y <= H; y += GRID) {
        g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); g.stroke();
      }
      g.strokeStyle = '#e2e8f0';
      for (var x2 = 0; x2 <= W; x2 += GRID * 5) {
        g.beginPath(); g.moveTo(x2 + 0.5, 0); g.lineTo(x2 + 0.5, H); g.stroke();
      }
      for (var y2 = 0; y2 <= H; y2 += GRID * 5) {
        g.beginPath(); g.moveTo(0, y2 + 0.5); g.lineTo(W, y2 + 0.5); g.stroke();
      }
      g.restore();
    }
    function drawWire(g, w) {
      var pts = pathOf(w);
      if (pts.length < 2) return;
      g.save();
      g.lineJoin = 'round'; g.lineCap = 'round';
      if (w.broken) {
        g.setLineDash([7, 6]);
        g.strokeStyle = '#dc2626'; g.lineWidth = 2.4;
      } else {
        g.strokeStyle = '#1e293b'; g.lineWidth = 2.4;
      }
      g.beginPath();
      g.moveTo(pts[0].x, pts[0].y);
      for (var i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
      g.stroke();
      g.restore();
    }
    function drawWirePreview(g) {
      var pts = wireDrag.cur.pts;
      if (!pts || pts.length < 2) return;
      g.save();
      g.setLineDash([6, 5]);
      g.strokeStyle = '#ea580c'; g.lineWidth = 2.4;
      g.beginPath();
      g.moveTo(pts[0].x, pts[0].y);
      for (var i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
      g.stroke();
      g.restore();
    }
    function drawComp(g, c) {
      // 接线点没有符号：它就是 drawJunctions 画的那个实心点
      if (c.type === 'junction') return;
      var rec = recOf(c);
      var it = itemOf(c, scene.wires, rec);
      g.save();
      SC().drawSymbol(g, it, D(), true);
      g.restore();
      // 滑片手柄：悬停或正在拖时，在箭头尖上套一个橙色圆环。
      // 箭头只有 10×14px，不给提示学生根本想不到「这根箭头能拖」——
      // 而拖滑片正是这个实验里唯一要动手的操作（用户 2026-10-22 第 3 点）。
      if (c.type === 'rheostat' && (hoverCompId === c.id || (slideDrag && slideDrag.comp === c))) {
        var hflip = ((c.rot || 0) % 360 === 180) ? -1 : 1;
        // 箭头在轴线上方（局部 −20 … −12），圆环套在它身上
        var hx = sliderXOf(c), hy = c.y - 16 * hflip;
        g.save();
        g.beginPath(); g.arc(hx, hy, 9, 0, Math.PI * 2);
        g.fillStyle = 'rgba(234,88,12,0.12)'; g.fill();
        g.lineWidth = 2; g.strokeStyle = 'rgba(234,88,12,0.85)'; g.stroke();
        g.restore();
      }
      // 电表的正负柱标注（默认不标）。纯画面标注：内核那边已经把 reversed 抹掉了，
      // 所以标了也不会因为「接反」判损坏 —— 它只是讲「表棒该怎么接」的板书。
      var pol = (c.params && c.params.polarity) || 'none';
      if (pol !== 'none' && (c.type === 'ammeter' || c.type === 'voltmeter')) {
        var pl = pinWorld(c, 0, scene.wires, rec);
        var pr = pinWorld(c, 1, scene.wires, rec);
        var signs = [[pl, pol === 'lr' ? '+' : '−'], [pr, pol === 'lr' ? '−' : '+']];
        g.save();
        g.font = 'bold 13px -apple-system,"PingFang SC",sans-serif';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.lineJoin = 'round';
        signs.forEach(function (s) {
          if (!s[0]) return;
          var x = s[0].x, y = s[0].y - 11;
          g.lineWidth = 3.5; g.strokeStyle = '#ffffff';
          g.strokeText(s[1], x, y);            // 白描边：压在导线上也看得清
          g.fillStyle = s[1] === '+' ? '#b91c1c' : '#1e293b';
          g.fillText(s[1], x, y);
        });
        g.restore();
      }
      // 故障标记：符号右上角一枚红牌。电路图上没有「烧黑」这种画法，
      // 只能用字说 —— 而学生最需要知道的恰恰是「这件已经坏了」。
      if (c.fault) {
        var b = symBox(c, scene.wires, rec);
        g.save();
        g.font = 'bold 12px -apple-system,"PingFang SC",sans-serif';
        var txt = c.fault === 'burnt' ? '已烧坏' : (c.fault === 'over' ? '打表' : '已损坏');
        var tw = g.measureText(txt).width;
        g.fillStyle = '#dc2626';
        D().roundRect(g, b.x1 - tw - 12, b.y0 - 34, tw + 12, 18, 5); g.fill();
        g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(txt, b.x1 - tw / 2 - 6, b.y0 - 25);
        g.restore();
      }
      // 实时读数：电表印自己的示数（这是「动态变化」最直观的地方）；
      // 其它元件印 I / U，选中时再补一行 R / P。
      drawLive(g, c, rec);
    }
    function drawLive(g, c, rec) {
      if (!rec) return;
      var b = symBox(c, scene.wires, rec);
      var isMeter = (c.type === 'ammeter' || c.type === 'voltmeter');
      var txt = '';
      if (isMeter) {
        if (!rec.wired) txt = '未接好';
        else txt = fmtRead(Math.abs(rec.reading), c.type === 'ammeter') +
                   (c.type === 'ammeter' ? ' A' : ' V');
      } else if (c.type === 'bulb' && rec.fault) {
        txt = '';
      } else if (Math.abs(rec.i || 0) > 1e-9) {
        txt = fmtRead(Math.abs(rec.i), false) + ' A · ' + fmtRead(Math.abs(rec.v || 0), true) + ' V';
      }
      if (!txt) return;
      g.save();
      g.font = 'bold 12px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      var cx = (b.x0 + b.x1) / 2, y = b.y1 + 30;
      var w = g.measureText(txt).width;
      g.fillStyle = 'rgba(234,88,12,0.10)';
      D().roundRect(g, cx - w / 2 - 6, y - 13, w + 12, 18, 5); g.fill();
      g.fillStyle = '#c2410c';
      g.fillText(txt, cx, y);
      g.restore();
    }
    function fmtRead(v, one) {
      v = +v || 0;
      var a = Math.abs(v);
      if (a >= 1) return v.toFixed(2);
      if (a >= 0.1) return v.toFixed(3);
      if (a >= 0.01) return v.toFixed(3);
      return v.toFixed(4);
    }
    // ── 引脚 / 接线点 ─────────────────────────────────────────
    // 用户 2026-10-22 第 1 点：「每一个连接点都有一个黑点，这不应该有，除非导线
    // 交叉相连需要点实心点。」
    // 所以：
    //   · 平时【一个点都不画】—— 符号自己的引线已经把端子画出来了；
    //   · 悬停/选中某件器材时，才给它的引脚一圈极淡的空心圈（告诉学生「这儿能接」）；
    //   · 指针靠近引脚时，画一个橙色圈（这一下就接在这儿）；
    //   · 真正的【实心点】只在「三根以上的线汇在一起」时画 —— 见 drawJunctions。
    function drawPins(g) {
      if (!scene.comps.length) return;
      g.save();
      scene.comps.forEach(function (c) {
        if (c.type === 'junction') return;            // 接线点自己就是那个实心点
        var rec = recOf(c);
        var n = pinsOf(c.type).length;
        var hintAll = (c.id === selId) || (c.id === hoverCompId);
        for (var i = 0; i < n; i++) {
          var p = pinWorld(c, i, scene.wires, rec);
          if (!p) continue;
          var hot = hoverPin && hoverPin.compId === c.id && hoverPin.pin === i;
          if (hot) {
            g.beginPath(); g.arc(p.x, p.y, 8, 0, Math.PI * 2);
            g.fillStyle = 'rgba(234,88,12,0.16)'; g.fill();
            g.lineWidth = 2; g.strokeStyle = '#ea580c'; g.stroke();
          } else if (hintAll) {
            g.beginPath(); g.arc(p.x, p.y, 3, 0, Math.PI * 2);
            g.fillStyle = '#ffffff'; g.fill();
            g.lineWidth = 1.2; g.strokeStyle = '#cbd5e1'; g.stroke();
          }
        }
      });
      g.restore();
    }
    // 实心点：只有「这个节点上挂了 ≥2 根导线」（= 三通 / 四通）才画。
    // 一根导线接一个引脚是【两点一线】，画个点反倒像多接了一根线。
    function drawJunctions(g) {
      var count = {};
      scene.wires.forEach(function (w) {
        ['a', 'b'].forEach(function (k) {
          var e = w[k];
          if (!e || !e.compId) return;
          var key = e.compId + ':' + e.termIdx;
          count[key] = (count[key] || 0) + 1;
        });
      });
      var dots = [];
      scene.comps.forEach(function (c) {
        if (c.type === 'junction') {
          var cnt = (count[c.id + ':0'] || 0) + (count[c.id + ':1'] || 0);
          if (cnt >= 2) dots.push({ x: c.x, y: c.y });
          return;
        }
        var n = pinsOf(c.type).length;
        for (var i = 0; i < n; i++) {
          var t = termOfPin(c, i);
          if ((count[c.id + ':' + t] || 0) < 2) continue;
          var p = pinWorld(c, i, scene.wires, recOf(c));
          if (p) dots.push(p);
        }
      });
      g.save();
      dots.forEach(function (p) {
        // 白边衬底：点压在两条深色导线上，没有这圈白边会糊成一团黑
        g.beginPath(); g.arc(p.x, p.y, 5.6, 0, Math.PI * 2);
        g.fillStyle = '#ffffff'; g.fill();
        g.beginPath(); g.arc(p.x, p.y, 3.8, 0, Math.PI * 2);
        g.fillStyle = '#1e293b'; g.fill();
      });
      g.restore();
    }
    function drawSelection(g) {
      if (!selId) return;
      var c = byId(selId); if (!c) return;
      var b = symBox(c, scene.wires, recOf(c));
      g.save();
      g.setLineDash([7, 5]);
      g.strokeStyle = '#ea580c'; g.lineWidth = 2;
      D().roundRect(g, b.x0 - 8, b.y0 - 8, (b.x1 - b.x0) + 16, (b.y1 - b.y0) + 16, 8);
      g.stroke();
      g.restore();
    }

    // ── 侧栏：参数 / 数据 / 故障 ─────────────────────────────
    function renderSide() {
      renderParams();
      renderData();
      renderFaults();
    }
    function renderParams() {
      var c = selId ? byId(selId) : null;
      if (!c) {
        sideParams.innerHTML = '<h4>参数</h4><div class="labEmpty">在画布上点一个用电器，这里就显示它的参数</div>';
        return;
      }
      // 接线点没有参数可调：它只是「三根线汇在一起」的那个点。
      if (c.type === 'junction') {
        sideParams.innerHTML = '<h4>接线点 <em>' + c.id + '</em></h4>' +
          '<div class="labEmpty">三根以上的导线在这里汇成一个节点。删掉它，导线会断开。</div>' +
          '<div class="labActs"><button type="button" class="labBtn" data-act="del">🗑 删除</button></div>';
        wireParams(c);
        return;
      }
      var specs = (P() && P().PARAM_UI[c.type]) || [];
      var html = '<h4>' + (TYPE_LABEL[c.type] || c.type) + ' <em>' + c.id + '</em></h4>';
      html += '<div class="labRows">' + specs.map(function (sp) { return rowHTML(c, sp); }).join('') + '</div>';
      // 电表的量程是「右脚接哪个柱」，单独一行按钮（不走 PARAM_UI 的 tap，
      // 因为这里的「接柱子」是我们自己管的 tapSel）。
      if (c.type === 'ammeter' || c.type === 'voltmeter') {
        var tapSel = (c.params && +c.params.tapSel === 1) ? 1 : 2;
        var ti = C().TYPES[c.type];
        html += '<div class="labRows"><div class="labRow"><label>量程</label>' +
          ti.rangeTaps.map(function (tap, i) {
            return '<button type="button" class="labPick' + (tap === tapSel ? ' on' : '') +
              '" data-tap="' + tap + '">' + ti.rangeValues[i] + (c.type === 'ammeter' ? 'A' : 'V') + '</button>';
          }).join('') + '</div></div>';
        // 正负接线柱：默认【不标注】（电路图里本来就不分正负，接上就是对的）。
        // 想讲「表棒接反会怎样」时可以打开标注，画面上给两根引线各标一个 + / −。
        // ⚠️ 纯标注，不影响计算：内核那边已经把 reversed 抹掉了（noMeterPolarity）。
        var pol = (c.params && c.params.polarity) || 'none';
        html += '<div class="labRows"><div class="labRow"><label>正负柱</label>' +
          [['none', '不标注'], ['lr', '＋在左'], ['rl', '＋在右']].map(function (o) {
            return '<button type="button" class="labPick' + (pol === o[0] ? ' on' : '') +
              '" data-pol="' + o[0] + '" title="只是标注，不影响读数">' + o[1] + '</button>';
          }).join('') + '</div></div>';
      }
      html += '<div class="labActs"><button type="button" class="labBtn" data-act="rot">⟳ 转 180°</button>' +
              '<button type="button" class="labBtn" data-act="del">🗑 删除</button></div>';
      sideParams.innerHTML = html;
      wireParams(c);
    }
    // 每一行「滑条 + 数字框」。用户 2026-10-22 第 3 点：参数要能【手动输入】——
    // 题目给的 8.5Ω、铭牌上的 2.5V，拿滑条去凑很别扭；反过来只有输入框就没法
    // 「一边拖一边看电流怎么变」。两个控件共用一个 data-k，写的是同一个参数。
    function rowHTML(c, sp) {
      var v = P().pval ? P().pval(c, sp.k) : (c.params || {})[sp.k];
      if (sp.t === 'range') {
        var lo = sp.nmin != null ? sp.nmin : sp.min;
        var hi = sp.nmax != null ? sp.nmax : sp.max;
        var stp = sp.nstep != null ? sp.nstep : sp.step;
        return '<div class="labRow"><label>' + sp.label + '</label>' +
          '<input type="range" data-k="' + sp.k + '" min="' + sp.min + '" max="' + sp.max +
          '" step="' + sp.step + '" value="' + v + '">' +
          '<input type="number" class="labNum" data-k="' + sp.k + '" min="' + lo + '" max="' + hi +
          '" step="' + stp + '" value="' + v + '" title="可以直接输入数字，回车生效">' +
          '<span class="labUnit">' + (sp.unit || '') + '</span></div>';
      }
      if (sp.t === 'check') {
        return '<div class="labRow' + (sp.wide ? ' wide' : '') + '"><label>' + sp.label + '</label>' +
          '<input type="checkbox" class="chk" data-k="' + sp.k + '"' + (v ? ' checked' : '') + '></div>';
      }
      if (sp.t === 'select') {
        return '<div class="labRow"><label>' + sp.label + '</label><select data-k="' + sp.k + '">' +
          sp.options.map(function (o) {
            var txt = (sp.labels && sp.labels[o]) || o;
            return '<option value="' + o + '"' + (o === v ? ' selected' : '') + '>' + txt + '</option>';
          }).join('') + '</select></div>';
      }
      if (sp.t === 'pick') {
        var pv = (v == null && sp.dflt != null) ? sp.dflt : v;
        return '<div class="labRow"><label>' + sp.label + '</label>' +
          sp.options.map(function (o) {
            return '<button type="button" class="labPick' + (String(pv) === String(o.v) ? ' on' : '') +
              '" data-k="' + sp.k + '" data-pick="' + o.v + '">' + o.label + '</button>';
          }).join('') + '</div>';
      }
      if (sp.t === 'flip') {
        return '<div class="labRow"><label>' + sp.label + '</label>' +
          '<button type="button" class="labBtn" data-flip="1">对调 ＋ / －</button></div>';
      }
      if (sp.t === 'preset') {
        return '<div class="labRow"><label>' + sp.label + '</label>' +
          sp.options.map(function (o, i) {
            return '<button type="button" class="labPick" data-preset="' + i + '" title="' +
              (o.title || o.label) + '">' + o.label + '</button>';
          }).join('') + '</div>';
      }
      return '';
    }
    // 同一个参数的两个控件（滑条 + 数字框）互相同步。谁在被操作就不动谁 ——
    // 给正在输入的那个框回写 value 会把光标顶到末尾，学生打「12」会变成「21」。
    function syncPair(k, v) {
      var rng = sideParams.querySelector('input[type=range][data-k="' + k + '"]');
      var num = sideParams.querySelector('input[type=number][data-k="' + k + '"]');
      if (rng && document.activeElement !== rng) rng.value = v;
      if (num && document.activeElement !== num) num.value = v;
    }
    function specOf(c, k) {
      return (P().PARAM_UI[c.type] || []).filter(function (s) { return s.k === k; })[0];
    }
    function applyNum(c, k, raw, noUndo) {
      var sp = specOf(c, k);
      if (!sp || sp.t !== 'range') return null;
      var v = parseFloat(raw);
      // 空框 / 打成非数：当这一下没发生（写进参数会让整条计算链静默变 NaN）
      if (!isFinite(v)) return null;
      var lo = sp.nmin != null ? sp.nmin : sp.min;
      var hi = sp.nmax != null ? sp.nmax : sp.max;
      if (v < lo) v = lo;
      if (v > hi) v = hi;
      setParam(c.id, k, v, noUndo);
      syncPair(k, v);
      renderData();
      return v;
    }
    function wireParams(c) {
      sideParams.querySelectorAll('input[type=range]').forEach(function (el) {
        // 拖动一次只压【一条】撤销记录：input 事件是每像素一个，照 setParam
        // 每次都 pushUndo 的话，拖一下滑条会留下几十条快照，⌘Z 得按到手酸
        // （主画布的参数滑条也是这个毛病，这里的规则和「大小」滑条一致）。
        var opened = false;
        el.addEventListener('pointerdown', function () { opened = false; });
        el.addEventListener('change', function () { opened = false; });
        el.addEventListener('input', function () {
          var k = el.dataset.k, v = parseFloat(el.value);
          if (!isFinite(v)) return;
          setParam(c.id, k, v, opened);
          opened = true;
          syncPair(k, v);
          // 参数一变，侧栏的数据表要跟着刷 —— 但【不能】整块重建参数面板，
          // 否则正在拖的滑块会被从 DOM 上抽走（主画布踩过同一个坑）。
          renderData();
        });
      });
      // 数字框：手动输入。input 时只改数、不压撤销（否则「12」是两条记录），
      // change（失焦 / 回车）时才落一条撤销。
      sideParams.querySelectorAll('input[type=number]').forEach(function (el) {
        var before = null;
        el.addEventListener('focus', function () {
          before = c.params[el.dataset.k];
          // 点进数字框就全选：框里本来有「10」，学生想填 25，不选中的话
          // 打出来是 1025 / 1250（光标在哪儿全看运气）。全选以后一打就替换。
          try { el.select(); } catch (err) {}
        });
        el.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter') { ev.preventDefault(); el.blur(); }
        });
        el.addEventListener('change', function () {
          var k = el.dataset.k;
          var v = parseFloat(el.value);
          if (!isFinite(v)) { el.value = c.params[k]; return; }
          pushUndo();
          applyNum(c, k, v, true);
          if (v !== before) say('已改 ' + (TYPE_LABEL[c.type] || '') + ' ' + c.id + '：' +
            (specOf(c, k).label) + ' = ' + c.params[k] + (specOf(c, k).unit || ''));
        });
      });
      sideParams.querySelectorAll('input[type=checkbox]').forEach(function (el) {
        el.addEventListener('change', function () {
          setParam(c.id, el.dataset.k, el.checked);
        });
      });
      sideParams.querySelectorAll('select').forEach(function (el) {
        el.addEventListener('change', function () { setParam(c.id, el.dataset.k, el.value); });
      });
      sideParams.querySelectorAll('button[data-pick]').forEach(function (b) {
        b.addEventListener('click', function () {
          var k = b.dataset.k, v = b.dataset.pick;
          setParam(c.id, k, isNaN(+v) ? v : +v);
        });
      });
      sideParams.querySelectorAll('button[data-tap]').forEach(function (b) {
        b.addEventListener('click', function () { setMeterRange(c, +b.dataset.tap); });
      });
      // 正负柱标注：只改画面上的字，不动导线、不参与计算
      sideParams.querySelectorAll('button[data-pol]').forEach(function (b) {
        b.addEventListener('click', function () {
          pushUndo();
          c.params = c.params || {};
          c.params.polarity = b.dataset.pol;
          solve(); renderAll();
        });
      });
      sideParams.querySelectorAll('button[data-preset]').forEach(function (b) {
        b.addEventListener('click', function () {
          var sp = (P().PARAM_UI[c.type] || []).filter(function (s) { return s.t === 'preset'; })[0];
          var o = sp && sp.options[+b.dataset.preset];
          if (!o) return;
          pushUndo();
          Object.keys(o.set).forEach(function (k) { c.params[k] = o.set[k]; });
          solve(); renderAll();
        });
      });
      var fb = sideParams.querySelector('button[data-flip]');
      if (fb) fb.addEventListener('click', function () {
        pushUndo();
        c.params.flip = !c.params.flip;
        // 端点要跟着换：只翻参数的话，导线会当场被拽到另一头去（主画布同一条规矩）。
        scene.wires.forEach(function (w) {
          ['a', 'b'].forEach(function (k) {
            var e = w[k];
            if (!e || e.compId !== c.id) return;
            if (e.termIdx === 0) e.termIdx = 1;
            else if (e.termIdx === 1) e.termIdx = 0;
          });
        });
        solve(); renderAll();
      });
      sideParams.querySelectorAll('button[data-act]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (b.dataset.act === 'del') removeComp(c.id);
          else if (b.dataset.act === 'rot') {
            pushUndo(); c.rot = ((c.rot || 0) + 180) % 360;
            solve(); renderAll();
          }
        });
      });
    }
    // 用户 2026-10-22 第 1、3 点：「连好电路之后，点『运行』才会把实时参数显示出来；
    // 不运行、只闭合开关，不显示示数」。
    // 所以 运行 = 合闸通电：点下去才 solve，示数才出现；再点一下变成「停止」，
    // 断电、示数清空。通电之后改参数 / 扳开关 / 拖滑片都实时重算（上一轮要的动态）。
    function runNow() {
      energized = true;
      solve(); renderAll();
      var src = scene.comps.filter(function (c) { return c.type === 'battery' || c.type === 'power'; })[0];
      var r = src ? recOf(src) : null;
      var msg;
      if (results && results.status === 'ok' && r) {
        msg = '已运行：I = ' + fmtRead(Math.abs(r.i)) + ' A，U = ' +
              fmtRead(Math.abs(r.v)) + ' V，P = ' + fmtRead(Math.abs(r.p || 0)) + ' W';
      } else {
        var st = results ? results.status : '—';
        msg = '已运行：' + (st === 'open-circuit' ? '断路（开关没合上？）' :
              st === 'shorted' ? '电源被短路' : st === 'no-source' ? '还没有电源' : st);
      }
      say(msg, 2600);
      flash(sideData);
      return msg;
    }
    function stopNow() {
      if (!energized) return;
      energized = false;
      solve(); renderAll();
      say('已断电：示数清空。改完电路再点「▶ 运行」', 2600);
    }
    function flash(node) {
      if (!node) return;
      node.classList.remove('flash');
      void node.offsetWidth;          // 强制回流，动画才会重播
      node.classList.add('flash');
    }
    function runBtnHTML() {
      return energized
        ? '<button type="button" class="labRun stop" data-run="1" title="断电：示数清空，改完电路再运行">⏹ 停止</button>'
        : '<button type="button" class="labRun" data-run="1" title="合闸通电：按当前参数算一遍">▶ 运行</button>';
    }
    function renderData() {
      // 没通电：表格照列（学生看得见自己摆了哪几件），但每个数都是「—」。
      // 这一条就是用户要的「不运行不显示示数」——而且一眼看得出「是没通电，
      // 不是坏了」。
      var st = results ? results.status : null;
      var stTxt = !results ? '未通电' : (st === 'ok' ? '电路导通' : (st === 'shorted' ? '电源短路' :
                  (st === 'open-circuit' ? '断路' : (st === 'no-source' ? '还没有电源' : st))));
      var html = '<h4>数据 <em class="' + (!results ? '' : (st === 'ok' ? 'ok' : 'bad')) + '">' + stTxt + '</em>' +
                 runBtnHTML() + '</h4>';
      var rows = scene.comps.filter(function (c) { return c.type !== 'junction'; });
      if (!rows.length) html += '<div class="labEmpty">还没有元件</div>';
      else {
        if (!results) html += '<div class="labEmpty">电路还没通电 —— 点右上角「▶ 运行」开始测量</div>';
        html += '<table class="labTable"><thead><tr><th>元件</th><th>I / A</th><th>U / V</th>' +
                '<th>R / Ω</th><th>P / W</th></tr></thead><tbody>';
        rows.forEach(function (c) {
          var r = results ? (recOf(c) || {}) : null;
          var sel = (c.id === selId) ? ' class="on"' : '';
          var R = (!r || r.R == null) ? '—' :
                  (Math.abs(r.R) >= 1000 ? (r.R / 1000).toFixed(1) + 'k' : (+r.R).toFixed(1));
          html += '<tr' + sel + ' data-id="' + c.id + '"><td>' + c.id + '</td>' +
                  '<td>' + (r ? fmtRead(Math.abs(r.i || 0)) : '—') + '</td>' +
                  '<td>' + (r ? fmtRead(Math.abs(r.v || 0)) : '—') + '</td>' +
                  '<td>' + R + '</td>' +
                  '<td>' + (r ? fmtRead(Math.abs(r.p || 0)) : '—') + '</td></tr>';
        });
        html += '</tbody></table>';
      }
      sideData.innerHTML = html;
      var rb = sideData.querySelector('button[data-run]');
      if (rb) rb.addEventListener('click', function () {
        if (energized) stopNow(); else runNow();
      });
      sideData.querySelectorAll('tr[data-id]').forEach(function (tr) {
        tr.addEventListener('click', function () {
          selId = tr.dataset.id; renderAll();
          // 点表格里那一行 = 点画布上那件器材：上面的参数卡要闪一下，
          // 不然学生不知道「参数在哪儿看」（用户 2026-10-22 第 3 点）。
          flash(sideParams);
        });
      });
    }
    function renderFaults() {
      var ws = warningsOf();
      if (!ws.length) { sideFaults.innerHTML = '<h4>故障</h4><div class="labEmpty">没有故障</div>'; return; }
      var html = '<h4>故障 <em class="bad">' + ws.length + ' 条</em></h4><ul class="labWarn">';
      ws.forEach(function (w) { html += '<li>' + w.msg + '</li>'; });
      html += '</ul><button type="button" class="labBtn" data-fix="1">🔧 全部修复</button>';
      sideFaults.innerHTML = html;
      var fb = sideFaults.querySelector('button[data-fix]');
      if (fb) fb.addEventListener('click', repairAll);
    }
    function renderAll() { draw(); renderSide(); syncBar(); }
    function syncBar() {
      bUndo.disabled = !undoStack.length;
      bRedo.disabled = !redoStack.length;
      bDel.disabled = !selId;
      bRot.disabled = !selId;
    }

    // ── 指针交互 ─────────────────────────────────────────────
    function toLocal(ev) {
      var r = cv.getBoundingClientRect();
      return { x: (ev.clientX - r.left) / (r.width || 1) * W,
               y: (ev.clientY - r.top) / (r.height || 1) * H };
    }
    function hitPin(p) {
      for (var i = scene.comps.length - 1; i >= 0; i--) {
        var c = scene.comps[i];
        // 接线点不参与「抓引脚」：点它就是选中它（参数卡里能删）。
        // 它自己那两个端子在同一个点上，抓了也分不出是哪一个。
        if (c.type === 'junction') continue;
        var n = pinsOf(c.type).length;
        for (var k = 0; k < n; k++) {
          var q = pinWorld(c, k, scene.wires, recOf(c));
          if (q && Math.hypot(q.x - p.x, q.y - p.y) <= PIN_HIT) return { comp: c, pin: k, at: q };
        }
      }
      return null;
    }
    function hitComp(p) {
      for (var i = scene.comps.length - 1; i >= 0; i--) {
        var c = scene.comps[i], b = symBox(c, scene.wires, recOf(c));
        if (p.x >= b.x0 - 6 && p.x <= b.x1 + 6 && p.y >= b.y0 - 6 && p.y <= b.y1 + 6) return c;
      }
      return null;
    }
    // 变阻器的滑片：符号顶上那根箭头。抓它 = 改 slide（这就是「移动滑动变阻器」）。
    // 抓取范围比箭头本身宽一点（±16、从轴线上方 10px 到电阻丝下沿）——
    // 箭头只有 14px 高、10px 宽，按「像素级瞄准」的要求去抓，学生会以为它不能动。
    function sliderXOf(c) {
      var it = itemOf(c, scene.wires, recOf(c));
      var sx = it.meta && it.meta.xl != null ? it.meta.xl : 0;
      return c.x + ((c.rot || 0) % 360 === 180 ? -sx : sx);
    }
    function hitSlider(p) {
      for (var i = scene.comps.length - 1; i >= 0; i--) {
        var c = scene.comps[i];
        if (c.type !== 'rheostat') continue;
        var wx = sliderXOf(c);
        var flip = ((c.rot || 0) % 360 === 180) ? -1 : 1;
        var dy = (p.y - c.y) * flip;
        // 滑片杆和箭头在【轴线上方】（局部 −30 … −12），电阻丝方框在 ±12。
        // 抓取区取 −36 … +6：杆、箭头、以及方框上沿一点，都好抓。
        if (Math.abs(p.x - wx) <= 16 && dy >= -36 && dy <= 6) return { comp: c, x: wx };
      }
      return null;
    }

    // ── 接线用的小工具 ────────────────────────────────────────
    // 离得最近的那个引脚（磁吸）。exclude 用来把「起点自己」排除掉 ——
    // 不排除的话，指针一直停在起点附近，预览会一直是一条零长度的线。
    function nearestPin(p, maxR, exclude) {
      var best = null, bd = maxR;
      for (var i = scene.comps.length - 1; i >= 0; i--) {
        var c = scene.comps[i];
        if (c.type === 'junction') continue;
        var n = pinsOf(c.type).length;
        for (var k = 0; k < n; k++) {
          if (exclude && exclude.compId === c.id && exclude.pin === k) continue;
          var q = pinWorld(c, k, scene.wires, recOf(c));
          if (!q) continue;
          var d = Math.hypot(q.x - p.x, q.y - p.y);
          if (d < bd) { bd = d; best = { comp: c, pin: k, at: q }; }
        }
      }
      return best;
    }
    // 拉线时指针的落点：先看有没有引脚（磁吸半径比「点中」宽），没有就吸到网格。
    function wireTarget(p, from) {
      var t = nearestPin(p, PIN_MAGNET, from ? { compId: from.comp.id, pin: from.pin } : null);
      if (t) return t;
      return null;
    }
    // ── 拖线：一个折点，方向【一开始就定死】，线头永远贴着鼠标 ──────
    // 用户 2026-10-22 第三次反馈：「我轨迹是怎样的就是怎样的，不能跳动；
    // 我想走这条直线，结果你跳到其他地方」。
    //
    // 🔴 上一版的病根：折点方向是【每一帧按 |dx| 和 |dy| 的大小重新算】的。
    //    鼠标一斜过来（|dy| > |dx|），折点就从 (鼠标x, 起点y) 翻到 (起点x, 鼠标y)
    //    —— 整条横段突然消失、竖段从起点垂下来，看着就是「跳了」。
    //
    // 现在：**方向只在第一次移动时定一次**（往右走就一直是「先横后竖」），
    // 之后折点永远在 (鼠标x, 起点y)，跟着鼠标平滑滑动，绝不翻边。
    // 线头始终 = 鼠标（`end` 就是 p）。
    // 于是「先往右再往下」画出来就是「横一段 + 竖一段」，和手走的路线一致；
    // 先往下再往右同理（方向在第一步就定成竖的了）。
    function advanceWire(p) {
      var d = wireDrag;
      var a = d.from.at;
      if (!d.dir) {
        var dx0 = p.x - a.x, dy0 = p.y - a.y;
        if (Math.hypot(dx0, dy0) >= 5) d.dir = Math.abs(dx0) >= Math.abs(dy0) ? 'h' : 'v';
        else {
          d.state = { dir: null, end: { x: p.x, y: p.y }, pts: [a, { x: p.x, y: p.y }] };
          return d.state;
        }
      }
      var via = [];
      if (d.dir === 'h') {
        if (Math.abs(p.y - a.y) > 1.5) via.push([p.x, a.y]);
      } else {
        if (Math.abs(p.x - a.x) > 1.5) via.push([a.x, p.y]);
      }
      var pts = [a]
        .concat(via.map(function (v) { return { x: v[0], y: v[1] }; }),
                [{ x: p.x, y: p.y }]);
      d.state = { dir: d.dir, end: { x: p.x, y: p.y }, pts: pts };
      return d.state;
    }
    // 松手/第二下：同样的折法，只是终点换成【真正要接的那个点】（引脚或三通点）。
    // 因为磁吸半径只有 30px，收尾的这段和预览几乎重合，不会「啪」地跳一下。
    function finishVia(targetPt) {
      var d = wireDrag;
      var a = d.from.at;
      var dir = d.dir || 'h';
      var via = [];
      if (Math.abs(targetPt.y - a.y) > 1 && Math.abs(targetPt.x - a.x) > 1) {
        via.push(dir === 'h' ? [targetPt.x, a.y] : [a.x, targetPt.y]);
      }
      return via;
    }
    function distToSeg(p, a, b) {
      if (Math.abs(a.y - b.y) < 0.5) {
        var x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
        if (p.x < x0) return Math.hypot(p.x - x0, p.y - a.y);
        if (p.x > x1) return Math.hypot(p.x - x1, p.y - a.y);
        return Math.abs(p.y - a.y);
      }
      var y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
      if (p.y < y0) return Math.hypot(p.x - a.x, p.y - y0);
      if (p.y > y1) return Math.hypot(p.x - a.x, p.y - y1);
      return Math.abs(p.x - a.x);
    }
    function projectOnSeg(p, a, b) {
      if (Math.abs(a.y - b.y) < 0.5) {
        return { x: clamp(p.x, Math.min(a.x, b.x), Math.max(a.x, b.x)), y: a.y };
      }
      return { x: a.x, y: clamp(p.y, Math.min(a.y, b.y), Math.max(a.y, b.y)) };
    }
    // 松手时指针压在哪根导线上（用来做三通：接到导线中间）。
    // 取【最近】的那一根，不是先碰到的那一根 —— 两根线并排走的时候，
    // 「先碰到」全看数组顺序，学生会接错线。
    function hitWireBody(p) {
      var best = null, bd = WIRE_HIT;
      for (var i = scene.wires.length - 1; i >= 0; i--) {
        var w = scene.wires[i];
        if (w.broken) continue;
        var pts = pathOf(w);
        for (var k = 0; k < pts.length - 1; k++) {
          var d = distToSeg(p, pts[k], pts[k + 1]);
          if (d <= bd) {
            bd = d;
            best = { wire: w, at: projectOnSeg(p, pts[k], pts[k + 1]) };
          }
        }
      }
      return best;
    }
    // 把一根导线从中间拆成两截，中间插一个接线点（内核的 junction：两端内部短接）。
    // 🔴 为什么要插一个【元件】而不是把导线拆成两截了事：求解器认的是【端子】，
    //    两截导线谁也不接到第三根线上，三根线就只是「画在一起」，读数上毫无关系。
    function splitWireAt(w, pt) {
      var pts = pathOf(w);
      if (pts.length < 2) return null;
      var n = pts.length;
      if (Math.hypot(pts[0].x - pt.x, pts[0].y - pt.y) < 14) return null;
      if (Math.hypot(pts[n - 1].x - pt.x, pts[n - 1].y - pt.y) < 14) return null;
      var idx = -1;
      for (var i = 0; i < n - 1; i++) {
        if (distToSeg(pt, pts[i], pts[i + 1]) <= 2) { idx = i; break; }
      }
      if (idx < 0) return null;
      var j = { id: nextId('junction'), type: 'junction', x: pt.x, y: pt.y, rot: 0, params: {} };
      var w1 = { a: w.a, b: { compId: j.id, termIdx: 0 },
                 via: pts.slice(1, idx + 1).map(function (p) { return [p.x, p.y]; }) };
      var w2 = { a: { compId: j.id, termIdx: 1 }, b: w.b,
                 via: pts.slice(idx + 1, n - 1).map(function (p) { return [p.x, p.y]; }) };
      var i0 = scene.wires.indexOf(w);
      if (i0 < 0) return null;
      scene.wires.splice(i0, 1, w1, w2);
      scene.comps.push(j);
      return j;
    }
    // 所有导线按当前端点重算折点（正交 + 避让）。拖元件时每一步都调一次，
    // 保证画面上永远是横平竖直的，不会出现斜线。
    function rerouteAll() {
      scene.wires.forEach(function (w) {
        var e = wireEnds(w);
        if (e.a && e.b) {
          w.via = routeBetween(e.a, e.b, [w.a.compId, w.b.compId].filter(Boolean));
        }
      });
    }
    function finishWire(tgt) {
      var from = wireDrag.from;
      // 落点用【预览时那条折线】收尾：松手前看到的和松手后画出来的一模一样，
      // 只在最后补一个正交折点把线头引到柱子上（磁吸的那一点）。
      // ⚠️ finishVia 要读 wireDrag.dir，必须【先算 via 再把 wireDrag 清空】。
      var pb = tgt ? pinWorld(tgt.comp, tgt.pin, scene.wires, recOf(tgt.comp)) : null;
      var via = pb ? finishVia(pb) : null;
      wireDrag = null; hoverPin = null;
      if (!tgt || (tgt.comp.id === from.comp.id && tgt.pin === from.pin)) { draw(); return; }
      if (!addWire(from.comp, from.pin, tgt.comp, tgt.pin, false, via)) {
        say('这两个接线柱已经连过了');
      }
      draw();
    }
    function finishWireOnWire(hit) {
      var from = wireDrag.from;
      var at = { x: hit.at.x, y: hit.at.y };
      var via = finishVia(at);
      wireDrag = null; hoverPin = null;
      pushUndo();
      var j = splitWireAt(hit.wire, at);
      if (!j) { draw(); return; }
      addWire(from.comp, from.pin, j, 1, true, via);
      say('接到导线中间：这里自动生成一个接线点（实心点）');
    }

    cv.addEventListener('pointerdown', function (ev) {
      ev.preventDefault();
      var p = toLocal(ev);

      // 「点一下起点，再点一下终点」—— 上一次松手没拖，现在是第二下。
      // 这条路比拖拽省力得多：长距离、跨半屏的线不用一路按着鼠标。
      if (wireDrag && wireDrag.sticky) {
        var t2 = wireTarget(p, wireDrag.from);
        if (t2) { finishWire(t2); return; }
        var hw2 = hitWireBody(p);
        if (hw2) { finishWireOnWire(hw2); return; }
        wireDrag = null; hoverPin = null; draw();
        say('接线取消：第二下要点在另一个接线柱上');
        return;
      }

      var hp = hitPin(p);
      // 变阻器的滑片柱（1 号脚）长在箭头杆顶上，和「拖滑片」的抓取区重叠。
      // 柱子只保留【杆顶那一小块】给接线，箭头（y 6~14）让给滑片 ——
      // 不然学生想拖滑片，一点就变成拉线。要给滑片接线时也不用点它：
      // 从别处拖一根线过来，30px 内会自动吸到这个柱子上（nearestPin）。
      if (hp && hp.comp.type === 'rheostat' && hp.pin === 1) {
        if (Math.hypot(hp.at.x - p.x, hp.at.y - p.y) > 6) hp = null;
      }
      if (hp) {
        // 从引脚拉线：起点就是这个引脚
        wireDrag = { from: hp, cur: { pts: [hp.at, hp.at] }, moved: false, sticky: false,
                     via: [], dir: null, state: null };
        try { cv.setPointerCapture(ev.pointerId); } catch (e) {}
        return;
      }
      var hs = hitSlider(p);
      if (hs) {
        slideDrag = { comp: hs.comp };
        pushUndo();
        try { cv.setPointerCapture(ev.pointerId); } catch (e) {}
        return;
      }
      var hc = hitComp(p);
      if (hc) {
        selId = hc.id;
        // 开关：点一下就是通断（电路图上的开关本来就这么用）。拖动才算「挪位置」。
        drag = { comp: hc, dx: p.x - hc.x, dy: p.y - hc.y, moved: false, start: p };
        try { cv.setPointerCapture(ev.pointerId); } catch (e) {}
        renderAll();
        return;
      }
      selId = null;
      renderAll();
    });
    cv.addEventListener('pointermove', function (ev) {
      var p = toLocal(ev);
      if (wireDrag) {
        if (Math.hypot(p.x - wireDrag.from.at.x, p.y - wireDrag.from.at.y) > 5) wireDrag.moved = true;
        // 折线按【鼠标走过的轨迹】一段一段长出来（见 advanceWire 的注释）。
        // 磁吸仍然只在【松手那一刻】生效：拖的时候只把 30px 内最近的接线柱用橙圈
        // 点亮，线头始终在鼠标上，绝不跳过去。
        var tgt = wireTarget(p, wireDrag.from);
        wireDrag.cur.pts = advanceWire(p).pts;
        wireDrag.target = tgt;
        hoverPin = tgt ? { compId: tgt.comp.id, pin: tgt.pin } : null;
        cv.style.cursor = 'crosshair';
        draw();
        return;
      }
      if (slideDrag) {
        var c = slideDrag.comp;
        // 滑片行程：符号里的 ±54（和 drawSymbol 的 sx 同一段）。
        // 元件转 180° 时左右要反过来 —— 不翻的话往右拖滑片反而往左跑。
        var sflip = ((c.rot || 0) % 360 === 180) ? -1 : 1;
        var rel = clamp((p.x - c.x) * sflip / 108 + 0.5, 0, 1);
        c.params.slide = Math.round(rel * 100) / 100;
        solve(); refreshData();
        return;
      }
      if (drag) {
        if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) > 4) drag.moved = true;
        if (drag.moved) {
          drag.comp.x = snap(p.x - drag.dx);
          drag.comp.y = snap(p.y - drag.dy);
          // 🔴 元件一动就【立刻重算所有导线的折点】：只靠端点在动、via 还是老坐标的话，
          // 拖动过程中会看到一根根斜线（用户 2026-10-22：「导线始终都是横平竖直的」）。
          rerouteAll();
          draw();
          renderData();
        }
        return;
      }
      var hp2 = hitPin(p);
      var hc2 = hp2 ? null : hitComp(p);
      var changed = (!!hp2 !== !!hoverPin) ||
        (hp2 && hoverPin && (hp2.comp.id !== hoverPin.compId || hp2.pin !== hoverPin.pin)) ||
        ((hc2 ? hc2.id : null) !== hoverCompId);
      hoverPin = hp2 ? { compId: hp2.comp.id, pin: hp2.pin } : null;
      hoverCompId = hc2 ? hc2.id : null;
      cv.style.cursor = hp2 ? 'crosshair' : (hitSlider(p) ? 'ew-resize' : (hc2 ? 'move' : 'default'));
      if (changed) draw();
    });
    function endPointer(ev) {
      if (wireDrag) {
        var p = toLocal(ev);
        if (wireDrag.moved) {
          var tgt = wireTarget(p, wireDrag.from);
          if (tgt) finishWire(tgt);
          else {
            var hw = hitWireBody(p);
            if (hw) finishWireOnWire(hw);
            else {
              wireDrag = null; hoverPin = null; draw();
              say('线头要落在另一个接线柱上（靠近就自动吸住）');
            }
          }
        } else {
          // 只点了一下：进入「点-点」模式，等第二下。学生不用一直按着鼠标。
          wireDrag.sticky = true;
          say('再点另一个接线柱，线就接上了（Esc 取消）', 2600);
          draw();
        }
        return;
      }
      if (slideDrag) { slideDrag = null; return; }
      if (drag) {
        var d = drag; drag = null;
        if (!d.moved) {
          // 没拖动 = 点了一下：开关就通断（这是电路图里最自然的手势）
          if (d.comp.type === 'switch') {
            pushUndo();
            d.comp.params.closed = !d.comp.params.closed;
            solve(); renderAll();
            say(d.comp.params.closed ? '开关闭合' : '开关断开');
          }
        } else {
          // 拖动过：松手时再统一走一遍（拖动过程中每一步也走过，见 pointermove）
          rerouteAll();
          solve(); renderAll();
        }
      }
    }
    cv.addEventListener('pointerup', endPointer);
    cv.addEventListener('pointercancel', function () { wireDrag = null; slideDrag = null; drag = null; draw(); });

    // ── 从器材栏拖一个符号进来 ────────────────────────────────
    function startPaletteDrag(type, ev, card) {
      var ghost = el('div', 'labGhost');
      ghost.textContent = (TYPE_LABEL[type] || type);
      document.body.appendChild(ghost);
      var moved = false;
      var startX = ev.clientX, startY = ev.clientY;
      function mv(e) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) > 4) moved = true;
        ghost.style.left = (e.clientX + 12) + 'px';
        ghost.style.top = (e.clientY - 16) + 'px';
        var r = cv.getBoundingClientRect();
        var over = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        ghost.classList.toggle('over', over);
      }
      function up(e) {
        document.removeEventListener('pointermove', mv);
        document.removeEventListener('pointerup', up);
        ghost.remove();
        var r = cv.getBoundingClientRect();
        var over = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        if (!moved || over) {
          // 点一下（没拖）也放一个：放在画布中间偏左的空位，别叠在已有元件上
          var x = over ? (e.clientX - r.left) / (r.width || 1) * W : W / 2;
          var y = over ? (e.clientY - r.top) / (r.height || 1) * H : H / 2;
          if (!moved) { var spot = freeSpot(type); x = spot.x; y = spot.y; }
          addComp(type, x, y);
        }
      }
      mv(ev);
      document.addEventListener('pointermove', mv);
      document.addEventListener('pointerup', up);
    }
    function freeSpot(type) {
      // 从中间往外找一个不和已有元件重叠的位置（网格上试）。
      var tries = [[W / 2, H / 2], [W / 2 - 200, H / 2], [W / 2 + 200, H / 2],
                   [W / 2, H / 2 - 160], [W / 2, H / 2 + 160],
                   [W / 2 - 360, H / 2], [W / 2 + 360, H / 2]];
      for (var i = 0; i < tries.length; i++) {
        var x = snap(tries[i][0]), y = snap(tries[i][1]);
        var clash = scene.comps.some(function (c) {
          return Math.abs(c.x - x) < 170 && Math.abs(c.y - y) < 90;
        });
        if (!clash) return { x: x, y: y };
      }
      return { x: snap(W / 2), y: snap(H / 2) };
    }

    // ── 预设电路 ─────────────────────────────────────────────
    function loadPreset(i) {
      pushUndo();
      scene.comps = []; scene.wires = []; selId = null;
      // 载入预设也【不通电】：和手工连的电路同一条规矩 —— 学生点一下「▶ 运行」
    // 才看得见读数。不然「为什么预设一打开就有数、我自己连的没有」会成为一个
    // 说不清的差别。
      energized = false;
      function add(type, x, y, params, rot) {
        var c = { id: nextId(type), type: type, x: x, y: y, rot: rot || 0,
                  params: Object.assign(C().defaultParams(type), params || {}) };
        scene.comps.push(c);
        return c;
      }
      function wire(a, ap, b, bp) {
        scene.wires.push({ a: { compId: a.id, termIdx: termOfPin(a, ap) },
                           b: { compId: b.id, termIdx: termOfPin(b, bp) }, via: [] });
      }
      // 🔴 电表的「−」柱在内核里是 0 号端子、量程柱是 1/2 号。回路里的电流
      //    必须【从量程柱进、从「−」柱出】，否则内核当场判「接反」并打表损坏
      //    （第一版串联预设就是这么一打开就报错的）。图上电流从左往右走，
      //    所以表要 rot=180 —— 转过来以后「−」柱在右边、量程柱在左边，
      //    正好迎着来电流。电压表同理：它的量程柱要接在【高电位】那一端。
      if (i === 0) {
        // 串联：电源 — 开关 — 小灯泡 — 电流表，回线从上方绕回电源。
        var u = add('battery', 300, 620, { emf: 3, rInt: 0 });
        var s = add('switch', 520, 620, { closed: true });
        var l = add('bulb', 740, 620, { ratedV: 2.5, ratedW: 0.75 });
        var a = add('ammeter', 920, 620, { tapSel: 2 }, 180);
        wire(u, 0, s, 0); wire(s, 1, l, 0); wire(l, 1, a, 1);
        scene.wires.push({ a: { compId: a.id, termIdx: termOfPin(a, 0) },
                           b: { compId: u.id, termIdx: 1 }, via: [[990, 200], [230, 200]] });
      } else if (i === 1) {
        // 并联：电源 — 开关 — 两条支路（两盏灯）。
        // 两条支路从【同一个接线点】分开、又在右边汇到同一个接线点 —— 这两个点
        // 就是课本图上的实心点。以前没有 junction 这个元件，两条支路只能各自
        // 从开关的同一个引脚上引出去，画面上是两圈套在一起的方框，不像并联。
        var u2 = add('battery', 260, 620, { emf: 3, rInt: 0 });
        var s2 = add('switch', 460, 620, { closed: true });
        var l1 = add('bulb', 820, 240, { ratedV: 2.5, ratedW: 0.75 });
        var l2 = add('bulb', 820, 440, { ratedV: 2.5, ratedW: 0.75 });
        var j1 = add('junction', 620, 440);
        var j2 = add('junction', 980, 440);
        wire(u2, 0, s2, 0);
        // 干路：开关 → 往上拐到分支点（这一截和下面两条支路共用同一根竖线）
        scene.wires.push({ a: { compId: s2.id, termIdx: termOfPin(s2, 1) },
                           b: { compId: j1.id, termIdx: 0 }, via: [[620, 620]] });
        // 上支路：分支点 → 再往上 → 灯 1
        scene.wires.push({ a: { compId: j1.id, termIdx: 1 },
                           b: { compId: l1.id, termIdx: 0 }, via: [[620, 240]] });
        // 中支路：分支点 → 灯 2（同一行，直连）
        scene.wires.push({ a: { compId: j1.id, termIdx: 1 },
                           b: { compId: l2.id, termIdx: 0 }, via: [] });
        // 灯 1 回来 → 汇合点；灯 2 回来 → 同一个汇合点（同一行）
        scene.wires.push({ a: { compId: l1.id, termIdx: 1 },
                           b: { compId: j2.id, termIdx: 0 }, via: [[980, 240]] });
        scene.wires.push({ a: { compId: l2.id, termIdx: 1 },
                           b: { compId: j2.id, termIdx: 0 }, via: [] });
        // 汇合点 → 从底下绕回电源（不走电池身上过）
        scene.wires.push({ a: { compId: j2.id, termIdx: 1 },
                           b: { compId: u2.id, termIdx: 1 }, via: [[980, 700], [190, 700]] });
      } else {
        // 伏安法测电阻：电源 — 开关 — 滑动变阻器（A 进、滑片出）— 电流表 — 待测电阻，
        // 电压表并在待测电阻两端（图上就是两根竖线直接搭在 R 的两个引脚上）。
        var u3 = add('battery', 240, 620, { emf: 6, rInt: 0 });
        var s3 = add('switch', 400, 620, { closed: true });
        var rh = add('rheostat', 560, 620, { Rmax: 20, slide: 0.4 });
        // 量程用 3A：这套预设里把变阻器拧到最小，电流能到 0.7A 以上 ——
        // 挂 0.6A 挡的话，学生一拖滑片表就「打表损坏」了，第一印象就毁了。
        var a3 = add('ammeter', 720, 620, { tapSel: 2 }, 180);
        var r3 = add('resistor', 880, 620, { R: 10 });
        var v3 = add('voltmeter', 880, 360, { tapSel: 2 }, 180);
        wire(u3, 0, s3, 0); wire(s3, 1, rh, 0); wire(rh, 1, a3, 1); wire(a3, 0, r3, 0);
        scene.wires.push({ a: { compId: r3.id, termIdx: 1 },
                           b: { compId: u3.id, termIdx: 1 }, via: [[1010, 620], [1010, 160], [170, 160]] });
        scene.wires.push({ a: { compId: v3.id, termIdx: 0 }, b: { compId: r3.id, termIdx: 1 }, via: [] });
        scene.wires.push({ a: { compId: v3.id, termIdx: termOfPin(v3, 1) },
                           b: { compId: r3.id, termIdx: 0 }, via: [] });
      }
      solve();
      // 预设里手写的导线端点：补上 via（同高/同列就是直连，否则按避让规则绕）
      scene.wires.forEach(function (w) {
        var e = wireEnds(w);
        if (e.a && e.b && (!w.via || !w.via.length)) {
          w.via = routeBetween(e.a, e.b, [w.a.compId, w.b.compId].filter(Boolean));
        }
      });
      solve(); renderAll();
      say('已载入预设：' + ['串联', '并联', '伏安法测电阻'][i] + '（点「▶ 运行」通电）', 2600);
    }

    // ── 顶栏按钮 ─────────────────────────────────────────────
    bUndo.addEventListener('click', function () { undo(); });
    bRedo.addEventListener('click', function () { redo(); });
    bDel.addEventListener('click', function () { if (selId) removeComp(selId); });
    bRot.addEventListener('click', function () {
      var c = selId ? byId(selId) : null; if (!c) return;
      pushUndo(); c.rot = ((c.rot || 0) + 180) % 360;
      solve(); renderAll();
    });
    bFix.addEventListener('click', repairAll);
    bClear.addEventListener('click', clearAll);
    bHelp.addEventListener('click', function () {
      say('拖符号进来 → 点一个接线柱、再点另一个就接上（也可以直接拖）→ 拖到导线中间自动三通', 5200);
    });
    presetWrap.querySelectorAll('button[data-preset]').forEach(function (b) {
      b.addEventListener('click', function () { loadPreset(+b.dataset.preset); });
    });
    btnX.addEventListener('click', function () { close(); if (opts.onClose) opts.onClose(); });
    window.addEventListener('keydown', function (e) {
      if (!host.classList.contains('on')) return;
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selId) {
        e.preventDefault(); removeComp(selId);
      } else if (e.key === 'Escape') {
        // Esc 先取消「正在接的那根线」，没有线在接才取消选中 ——
        // 反过来的话，接线接一半按 Esc 会先丢掉选中，线还挂在指针上。
        if (wireDrag) { wireDrag = null; hoverPin = null; draw(); say('接线取消'); }
        else { selId = null; renderAll(); }
      }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault(); if (e.shiftKey) redo(); else undo();
      }
    });

    // ── 对外 ─────────────────────────────────────────────────
    function open() {
      host.classList.add('on');
      resize();
      if (!scene.comps.length) loadPreset(0);
      else { solve(); renderAll(); }
    }
    function close() { host.classList.remove('on'); }

    resize();
    solve();
    renderAll();

    return {
      open: open, close: close,
      scene: function () { return scene; },
      results: function () { return results; },
      // 测试用：直接问「画了几件、接了几根、解出来什么、报了什么」
      state: function () {
        return { comps: scene.comps.map(function (c) {
                   return { id: c.id, type: c.type, x: c.x, y: c.y, rot: c.rot,
                            params: JSON.parse(JSON.stringify(c.params || {})), fault: c.fault || null };
                 }),
                 wires: scene.wires.map(function (w) {
                   return { a: { compId: w.a.compId, termIdx: w.a.termIdx },
                            b: { compId: w.b.compId, termIdx: w.b.termIdx },
                            via: (w.via || []).slice() };
                 }),
                 sel: selId,
                 on: energized,
                 status: results ? results.status : null,
                 warns: warningsOf(),
                 readings: (function () {
                   var o = {};
                   scene.comps.forEach(function (c) {
                     var r = recOf(c) || {};
                     o[c.id] = { i: r.i, v: r.v, R: r.R, reading: r.reading, wired: r.wired,
                                 range: r.range, reversed: !!r.reversed,
                                 fault: r.fault || c.fault || null };
                   });
                   return o;
                 })() };
      },
      addComp: addComp, removeComp: removeComp,
      addWireByPin: function (aId, aPin, bId, bPin) {
        var a = byId(aId), b = byId(bId);
        return (a && b) ? addWire(a, aPin, b, bPin) : false;
      },
      setParam: setParam, setMeterRange: setMeterRange,
      loadPreset: loadPreset, undo: undo, redo: redo, clear: clearAll, repair: repairAll,
      pinPos: function (id, pin) {
        var c = byId(id); return c ? pinWorld(c, pin, scene.wires, recOf(c)) : null;
      },
      boxOf: function (id) {
        var c = byId(id); return c ? symBox(c, scene.wires, recOf(c)) : null;
      },
      // 每根导线【实际画出来的折线】（含端子世界坐标与 via）。自检判「有没有斜线」
      // 必须看这个 —— 自己拿 pinPos 拼路径时，电表/变阻器的引脚序号和端子号
      // 不是一回事，拼出来的端点会错位（第一次就错在这儿）。
      wirePaths: function () {
        return scene.wires.map(function (w) {
          return pathOf(w).map(function (p) { return { x: p.x, y: p.y }; });
        });
      },
      // 符号下面那行铭牌（"最大 20 Ω · 接入 8.0 Ω" 这种）。自检要判「拖滑片时
      // 接入阻值真的在变」，而那行字是画在画布上的，DOM 里查不到。
      valueText: function (id) {
        var c = byId(id); if (!c) return '';
        return itemOf(c, scene.wires, recOf(c)).value || '';
      },
      // 自检 / 诊断用：给一个【逻辑坐标】，回答「这儿点到了谁」。
      // 命中判定和真实指针走的是同一组函数（hitPin / hitComp / hitSlider），
      // 所以「点不到」这类问题能在这里直接复现，不用去猜。
      hitAt: function (lx, ly) {
        var p = { x: lx, y: ly };
        var hp = hitPin(p), hs = hitSlider(p), hc = hitComp(p);
        return { pin: hp ? { id: hp.comp.id, pin: hp.pin } : null,
                 slider: hs ? hs.comp.id : null,
                 comp: hc ? hc.id : null };
      },
      toScreen: function (x, y) {
        var r = cv.getBoundingClientRect();
        return { x: r.left + x / W * r.width, y: r.top + y / H * r.height };
      },
      // 像素探针：给【逻辑坐标】，回这一小块里的深色 / 红色 / 不透明像素数。
      // dpr 换算在这里做掉 —— 测试里不该出现「devicePixelRatio 是多少」这种问题。
      pix: function (x, y, w, h) {
        var k = cv.width / W;
        var sx = Math.max(0, Math.round(x * k)), sy = Math.max(0, Math.round(y * k));
        var sw = Math.min(Math.max(1, Math.round((w || 1) * k)), cv.width - sx);
        var sh = Math.min(Math.max(1, Math.round((h || 1) * k)), cv.height - sy);
        var d = ctx.getImageData(sx, sy, sw, sh).data;
        var dark = 0, red = 0, opaque = 0, ink = 0, total = 0;
        for (var i = 0; i < d.length; i += 4) {
          total++;
          if (d[i + 3] > 8) opaque++;
          if (d[i] < 120 && d[i + 1] < 130 && d[i + 2] < 150) dark++;
          if (d[i] > 120 && d[i + 1] < 110 && d[i + 2] < 90) red++;
          // ink = 「不是白纸」的像素（含红色标注、浅灰等）。判「这儿有没有画东西」
          // 用它 —— 只数 dark 的话，红色的「+」会被当成没画。
          if (d[i] < 240 || d[i + 1] < 240 || d[i + 2] < 240) ink++;
        }
        return { dark: dark, red: red, ink: ink, opaque: opaque, total: total };
      },
      // 接线状态：自检要判「点了一下之后是不是在等第二下」
      wireState: function () {
        return { dragging: !!wireDrag, sticky: !!(wireDrag && wireDrag.sticky),
                 moved: !!(wireDrag && wireDrag.moved),
                 from: wireDrag ? { id: wireDrag.from.comp.id, pin: wireDrag.from.pin } : null,
                 target: (wireDrag && wireDrag.target)
                   ? { id: wireDrag.target.comp.id, pin: wireDrag.target.pin } : null,
                 // 预览折线：判「线有没有紧跟鼠标」「折点是不是 L 形」都读它
                 pts: (wireDrag && wireDrag.cur && wireDrag.cur.pts)
                   ? wireDrag.cur.pts.map(function (q) { return { x: q.x, y: q.y }; }) : null };
      },
      cancelWire: function () { wireDrag = null; hoverPin = null; draw(); },
      run: runNow,
      stop: stopNow,
      isOn: function () { return energized; },
      W: W, H: H,
      version: '1.1.0',
    };
  }

  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }

  return { create: create, PAL: PAL, version: '1.0.0' };
});
