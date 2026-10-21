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
  var PIN_R = 4.6, PIN_HIT = 15;
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
                     motor: '电动机' };
  var ID_PREFIX = { battery: 'U', switch: 'S', bulb: 'L', resistor: 'R',
                    rheostat: 'RH', ammeter: 'A', voltmeter: 'V', motor: 'M' };

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
  function pinWorld(comp, pinIdx, wires, rec) {
    var it = itemOf(comp, wires, rec);
    return SC().termWorld(it, termOfPin(comp, pinIdx), D());
  }
  function symBox(comp, wires, rec) {
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
    var undoStack = [], redoStack = [];
    var drag = null;            // 拖元件
    var wireDrag = null;        // 拉线（从某个引脚拖到另一个）
    var slideDrag = null;       // 拖变阻器滑片
    var hoverPin = null;
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
      '从左边把符号拖到画布上；从一个接线端拖到另一个接线端就接上了'));
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
            var p = SC().termWorld(itemOf(c, scene.wires, recOf(c)), e.termIdx, D());
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
      var pa = a ? SC().termWorld(itemOf(a, scene.wires, recOf(a)), w.a.termIdx, D())
                 : (w.a.x != null ? { x: w.a.x, y: w.a.y } : null);
      var pb = b ? SC().termWorld(itemOf(b, scene.wires, recOf(b)), w.b.termIdx, D())
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
    // 正交走线：同高/同列直连；否则 Z 形（中点竖着走）。
    function routeVia(p, q) {
      if (Math.abs(p.y - q.y) < 2 || Math.abs(p.x - q.x) < 2) return [];
      var mx = snap((p.x + q.x) / 2);
      return [[mx, p.y], [mx, q.y]];
    }
    function addWire(aComp, aPin, bComp, bPin) {
      var tA = termOfPin(aComp, aPin), tB = termOfPin(bComp, bPin);
      if (aComp.id === bComp.id && tA === tB) return false;
      // 同一对端子已经连过就不重复接（画面上会叠成一条，学生以为没接上）
      var dup = scene.wires.some(function (w) {
        return (w.a.compId === aComp.id && w.a.termIdx === tA && w.b.compId === bComp.id && w.b.termIdx === tB) ||
               (w.b.compId === aComp.id && w.b.termIdx === tA && w.a.compId === bComp.id && w.a.termIdx === tB);
      });
      if (dup) return false;
      pushUndo();
      var pa = pinWorld(aComp, aPin, scene.wires, recOf(aComp));
      var pb = pinWorld(bComp, bPin, scene.wires, recOf(bComp));
      scene.wires.push({ a: { compId: aComp.id, termIdx: tA },
                         b: { compId: bComp.id, termIdx: tB },
                         via: routeVia(pa, pb) });
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
      solve(); renderAll();
    }

    // ── 求解 + 故障 ──────────────────────────────────────────
    var flows = [];
    var shortSeen = null;
    function solve() {
      shortSeen = null;
      // 损坏要迭代到收敛：烧断一个灯泡会改拓扑，拓扑一变读数又变。
      // 和主画布同一个做法（那边叫 DAMAGE_MAX_PASS），最多三轮。
      for (var pass = 0; pass < 3; pass++) {
        results = C().solve(scene.comps, scene.wires);
        flows = results.flows || [];
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
      if (!results) return out;
      (results.warnings || []).forEach(function (w) { out.push({ code: w.code, msg: w.message }); });
      var sc = shortSeen || results.shortCircuit;
      if (sc && sc.compIds && sc.compIds.length) {
        out.push({ code: 'SHORT', msg: '电源被短路：电流极大，器材会被烧坏' });
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
      var rec = recOf(c);
      var it = itemOf(c, scene.wires, rec);
      g.save();
      SC().drawSymbol(g, it, D(), true);
      g.restore();
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
    function drawPins(g) {
      if (!scene.comps.length) return;
      g.save();
      scene.comps.forEach(function (c) {
        var rec = recOf(c);
        var n = pinsOf(c.type).length;
        for (var i = 0; i < n; i++) {
          var p = pinWorld(c, i, scene.wires, rec);
          if (!p) continue;
          var hot = hoverPin && hoverPin.compId === c.id && hoverPin.pin === i;
          var used = pinUsed(c, i);
          g.beginPath();
          g.arc(p.x, p.y, hot ? PIN_R + 2.6 : PIN_R, 0, Math.PI * 2);
          g.fillStyle = hot ? '#ea580c' : (used ? '#1e293b' : '#ffffff');
          g.fill();
          g.lineWidth = 2;
          g.strokeStyle = hot ? '#ea580c' : '#1e293b';
          g.stroke();
        }
      });
      g.restore();
    }
    function pinUsed(c, i) {
      var t = termOfPin(c, i);
      return scene.wires.some(function (w) {
        return (w.a.compId === c.id && w.a.termIdx === t) || (w.b.compId === c.id && w.b.termIdx === t);
      });
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
        sideParams.innerHTML = '<h4>参数</h4><div class="labEmpty">先在画布上点一个符号</div>';
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
      }
      html += '<div class="labActs"><button type="button" class="labBtn" data-act="rot">⟳ 转 180°</button>' +
              '<button type="button" class="labBtn" data-act="del">🗑 删除</button></div>';
      sideParams.innerHTML = html;
      wireParams(c);
    }
    function rowHTML(c, sp) {
      var v = P().pval ? P().pval(c, sp.k) : (c.params || {})[sp.k];
      if (sp.t === 'range') {
        return '<div class="labRow"><label>' + sp.label + '</label>' +
          '<input type="range" data-k="' + sp.k + '" min="' + sp.min + '" max="' + sp.max +
          '" step="' + sp.step + '" value="' + v + '">' +
          '<span class="labVal" id="labv_' + sp.k + '">' + v + (sp.unit || '') + '</span></div>';
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
          var lab = document.getElementById('labv_' + k);
          var spec = (P().PARAM_UI[c.type] || []).filter(function (s) { return s.k === k; })[0];
          if (lab) lab.textContent = v + ((spec && spec.unit) || '');
          setParam(c.id, k, v, opened);
          opened = true;
          // 参数一变，侧栏的数据表要跟着刷 —— 但【不能】整块重建参数面板，
          // 否则正在拖的滑块会被从 DOM 上抽走（主画布踩过同一个坑）。
          renderData();
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
    function renderData() {
      if (!results) { sideData.innerHTML = '<h4>数据</h4><div class="labEmpty">—</div>'; return; }
      var st = results.status;
      var stTxt = st === 'ok' ? '电路导通' : (st === 'shorted' ? '电源短路' :
                  (st === 'open-circuit' ? '断路' : (st === 'no-source' ? '还没有电源' : st)));
      var html = '<h4>数据 <em class="' + (st === 'ok' ? 'ok' : 'bad') + '">' + stTxt + '</em></h4>';
      var rows = scene.comps.filter(function (c) { return c.type !== 'junction'; });
      if (!rows.length) html += '<div class="labEmpty">还没有元件</div>';
      else {
        html += '<table class="labTable"><thead><tr><th>元件</th><th>I / A</th><th>U / V</th>' +
                '<th>R / Ω</th></tr></thead><tbody>';
        rows.forEach(function (c) {
          var r = recOf(c) || {};
          var sel = (c.id === selId) ? ' class="on"' : '';
          var R = (r.R == null) ? '—' : (Math.abs(r.R) >= 1000 ? (r.R / 1000).toFixed(1) + 'k' : (+r.R).toFixed(1));
          html += '<tr' + sel + ' data-id="' + c.id + '"><td>' + c.id + '</td>' +
                  '<td>' + fmtRead(Math.abs(r.i || 0)) + '</td>' +
                  '<td>' + fmtRead(Math.abs(r.v || 0)) + '</td>' +
                  '<td>' + R + '</td></tr>';
        });
        html += '</tbody></table>';
      }
      sideData.innerHTML = html;
      sideData.querySelectorAll('tr[data-id]').forEach(function (tr) {
        tr.addEventListener('click', function () { selId = tr.dataset.id; renderAll(); });
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
        var c = scene.comps[i], n = pinsOf(c.type).length;
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
    function hitSlider(p) {
      for (var i = scene.comps.length - 1; i >= 0; i--) {
        var c = scene.comps[i];
        if (c.type !== 'rheostat') continue;
        var it = itemOf(c, scene.wires, recOf(c));
        var sx = it.meta && it.meta.xl != null ? it.meta.xl : 0;
        var wx = c.x + sx;
        if (Math.abs(p.x - wx) <= 14 && p.y >= c.y - 46 && p.y <= c.y + 18) return { comp: c, x: wx };
      }
      return null;
    }

    cv.addEventListener('pointerdown', function (ev) {
      ev.preventDefault();
      var p = toLocal(ev);
      var hp = hitPin(p);
      if (hp) {
        // 从引脚拉线：起点就是这个引脚
        wireDrag = { from: hp, cur: { pts: [hp.at, hp.at] } };
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
        var from = wireDrag.from.at;
        var to = p;
        var hp = hitPin(p);
        if (hp) to = hp.at;
        wireDrag.cur.pts = [from].concat(routeVia(from, to).map(function (v) { return { x: v[0], y: v[1] }; }), [to]);
        hoverPin = hp ? { compId: hp.comp.id, pin: hp.pin } : null;
        draw();
        return;
      }
      if (slideDrag) {
        var c = slideDrag.comp;
        var it = itemOf(c, scene.wires, recOf(c));
        // 滑片行程：符号里的 ±54（和 drawSymbol 的 sx 同一段）
        var rel = clamp((p.x - c.x) / 108 + 0.5, 0, 1);
        c.params.slide = Math.round(rel * 100) / 100;
        solve(); refreshData();
        return;
      }
      if (drag) {
        if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) > 4) drag.moved = true;
        if (drag.moved) {
          drag.comp.x = snap(p.x - drag.dx);
          drag.comp.y = snap(p.y - drag.dy);
          // 元件一动，挂在它身上的导线端点跟着走（端子坐标是现算的，不用改 via）
          draw();
          renderData();
        }
        return;
      }
      var hp2 = hitPin(p);
      var changed = (!!hp2 !== !!hoverPin) ||
        (hp2 && hoverPin && (hp2.comp.id !== hoverPin.compId || hp2.pin !== hoverPin.pin));
      hoverPin = hp2 ? { compId: hp2.comp.id, pin: hp2.pin } : null;
      cv.style.cursor = hp2 ? 'crosshair' : (hitSlider(p) ? 'ew-resize' : (hitComp(p) ? 'move' : 'default'));
      if (changed) draw();
    });
    function endPointer(ev) {
      if (wireDrag) {
        var p = toLocal(ev);
        var hp = hitPin(p);
        if (hp && (hp.comp.id !== wireDrag.from.comp.id || hp.pin !== wireDrag.from.pin)) {
          addWire(wireDrag.from.comp, wireDrag.from.pin, hp.comp, hp.pin);
        }
        wireDrag = null;
        draw();
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
          // 拖动过：位置变了，导线要重新走线（不然还是按老位置绕的）
          scene.wires.forEach(function (w) {
            var e = wireEnds(w);
            if (e.a && e.b) w.via = routeVia(e.a, e.b);
          });
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
        // 并联：电源 — 开关 — 两条支路（两盏灯）。两条支路从同一个节点分开、
        // 又回到同一个节点 —— 画布上没有「接线点」这个元件，所以「同一个节点」
        // 就是【两根导线接在同一个引脚上】（内核的并查集照样把它们并成一个节点）。
        var u2 = add('battery', 260, 620, { emf: 3, rInt: 0 });
        var s2 = add('switch', 460, 620, { closed: true });
        var l1 = add('bulb', 820, 240, { ratedV: 2.5, ratedW: 0.75 });
        var l2 = add('bulb', 820, 440, { ratedV: 2.5, ratedW: 0.75 });
        wire(u2, 0, s2, 0);
        scene.wires.push({ a: { compId: s2.id, termIdx: termOfPin(s2, 1) },
                           b: { compId: l1.id, termIdx: 0 }, via: [[620, 620], [620, 240]] });
        scene.wires.push({ a: { compId: s2.id, termIdx: termOfPin(s2, 1) },
                           b: { compId: l2.id, termIdx: 0 }, via: [[660, 620], [660, 440]] });
        scene.wires.push({ a: { compId: l1.id, termIdx: 1 },
                           b: { compId: u2.id, termIdx: 1 }, via: [[980, 240], [980, 700], [160, 700], [160, 620]] });
        scene.wires.push({ a: { compId: l2.id, termIdx: 1 },
                           b: { compId: u2.id, termIdx: 1 }, via: [[1030, 440], [1030, 700], [160, 700], [160, 620]] });
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
      // 预设里手写的导线端点：补上 via（同高/同列就是直连）
      scene.wires.forEach(function (w) {
        var e = wireEnds(w);
        if (e.a && e.b && (!w.via || !w.via.length)) w.via = routeVia(e.a, e.b);
      });
      solve(); renderAll();
      say('已载入预设：' + ['串联', '并联', '伏安法测电阻'][i]);
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
      say('拖符号进来 → 从一个接线端拖到另一个接线端接线 → 点开关通断、拖变阻器滑片改电阻', 5200);
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
      } else if (e.key === 'Escape') { selId = null; renderAll(); }
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
                 status: results ? results.status : null,
                 warns: warningsOf(),
                 readings: (function () {
                   var o = {};
                   scene.comps.forEach(function (c) {
                     var r = recOf(c) || {};
                     o[c.id] = { i: r.i, v: r.v, R: r.R, reading: r.reading, wired: r.wired,
                                 range: r.range, fault: r.fault || c.fault || null };
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
      W: W, H: H,
      version: '1.0.0',
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
