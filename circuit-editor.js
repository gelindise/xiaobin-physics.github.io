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

  // 自动编号前缀。变阻器不能也取 R，否则和定值电阻撞号。
  var ID_PREFIX = {
    resistor: 'R', battery: 'E', switch: 'S',
    ammeter: 'A', voltmeter: 'V', rheostat: 'RH', bulb: 'L',
  };

  // 元件外形半宽 / 半高，用于点选。数值必须和 circuit-draw.js 里实际画的一致，
  // 否则会出现「点得到但看不见」或「看得见却点不到」。
  var BODY = {
    resistor:  [54, 22],
    battery:   [66, 40],
    switch:    [59, 29],
    bulb:      [22, 48],
    ammeter:   [62, 62],
    voltmeter: [62, 62],
    rheostat:  [78, 31],
  };

  function create(opts) {
    var canvas = opts.canvas;
    var W = opts.W, H = opts.H;
    var D = opts.draw || G.CircuitDraw;
    var getScene = opts.getScene;
    var onChange = opts.onChange || function () {};
    var onSelect = opts.onSelect || function () {};

    var selected = null;      // {kind:'comp'|'wire', id} 或 {kind:'wire', index}
    var hover = null;         // {kind:'term', compId, termIdx} | {kind:'comp'|'wire', ...}
    var moving = null;        // 拖元件 {id, dx, dy}
    var wiring = null;        // 拉导线 {from:{compId,termIdx}, cur:{x,y}, to:{...}|null}
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

    function bodyHalf(c) {
      var b = BODY[c.type] || [50, 50];
      return (c.rot === 90 || c.rot === 270) ? [b[1], b[0]] : [b[0], b[1]];
    }
    function hitComp(p, c) {
      var h = bodyHalf(c);
      return Math.abs(p.x - c.x) <= h[0] + 4 && Math.abs(p.y - c.y) <= h[1] + 4;
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
    function pathOf(wr) {
      var a = byId(wr.a.compId), b = byId(wr.b.compId);
      if (!a || !b) return [];
      var p0 = D.terminalWorld(a, wr.a.termIdx), p1 = D.terminalWorld(b, wr.b.termIdx);
      var pts = [{ x: p0.x, y: p0.y }];
      (wr.via || []).forEach(function (v) { pts.push({ x: v[0], y: v[1] }); });
      pts.push({ x: p1.x, y: p1.y });
      return pts;
    }

    // ---------- 手绘走线 ----------
    // 导线按鼠标实际划过的轨迹走，而不是强制横平竖直——真实的实验台就是
    // 随手把导线搭过去。轨迹点直接存下来又太密（一次拖动几百个点），
    // 用 Douglas-Peucker 抽稀：只保留偏离直线超过 tol 的拐点，
    // 手抖产生的小波浪会被抹掉，真正拐弯的地方一个不丢。
    var TRAIL_TOL = 6;      // 抽稀容差（逻辑像素）
    var TRAIL_MIN = 5;      // 采样间距：移动不足这么远就不记点
    var VIA_MAX = 60;       // 单根导线的拐点上限，防止极端拖动撑爆场景数据

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

    // ---------- 改场景 ----------
    function addComp(type, x, y) {
      pushUndo();
      var s = getScene();
      var n = 1;
      while (byId(ID_PREFIX[type] + n)) n++;      // 编号不重复，否则并查集会把两个元件当成一个
      var id = ID_PREFIX[type] + n;
      var c = { id: id, type: type, x: snap(x), y: snap(y),
                params: (G.CircuitCore && G.CircuitCore.defaultParams)
                  ? G.CircuitCore.defaultParams(type) : {} };
      s.comps.push(c);
      select({ kind: 'comp', id: id });
      changed();
      return c;
    }
    function removeSelected() {
      if (!selected) return false;
      pushUndo();
      var s = getScene();
      if (selected.kind === 'comp') {
        s.comps = s.comps.filter(function (c) { return c.id !== selected.id; });
        s.wires = s.wires.filter(function (w) {
          return w.a.compId !== selected.id && w.b.compId !== selected.id;
        });
      } else {
        s.wires.splice(selected.index, 1);
      }
      selected = null;
      changed();
      return true;
    }
    function setParam(id, key, val) {
      var c = byId(id); if (!c) return;
      pushUndo();
      c.params = c.params || {};
      c.params[key] = val;
      // 元件的几何没变但导线可能要走新路，重算一遍 via
      rerouteAll();
      changed();
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
        var a = byId(w.a.compId), b = byId(w.b.compId);
        if (!a || !b) return;
        var p0 = D.terminalWorld(a, w.a.termIdx), p1 = D.terminalWorld(b, w.b.termIdx);
        if (w.auto) { w.via = routeTo(p0, p1, -1).via; return; }
        refitManual(w, p0, p1);          // 手绘导线：按原始形状重新贴合两端
      });
    }
    // 拖动元件的过程中只重贴合它身上的手绘导线。正交导线留到松手时再算，
    // 否则它们在拖动途中会不停跳线，看着像电路自己在抽搐。
    function refitWiresOf(compId) {
      var s = getScene(), c = byId(compId);
      if (!c) return;
      s.wires.forEach(function (w) {
        if (w.auto) return;
        if (w.a.compId !== compId && w.b.compId !== compId) return;
        var a = byId(w.a.compId), b = byId(w.b.compId);
        if (!a || !b) return;
        refitManual(w, D.terminalWorld(a, w.a.termIdx), D.terminalWorld(b, w.b.termIdx));
      });
    }

    // ---------- 导线上的删除按钮 ----------
    // 点到导线只把它选中，真正的删除交给线上长出来的这个圆钮：
    // 导线很细，点中即删容易误伤；多一步确认，也让学生看清删的是哪根。
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
    function hitDeleteButton(p) {
      if (!selected || selected.kind !== 'wire') return false;
      var wr = getScene().wires[selected.index];
      if (!wr) return false;
      var b = delButtonPos(wr);
      return !!b && Math.hypot(p.x - b.x, p.y - b.y) <= DEL_R + 4;
    }
    function undo() {
      if (!undoStack.length) return false;
      var st = undoStack.pop();
      var s = getScene();
      s.comps = st.comps; s.wires = st.wires;
      selected = null;
      changed();
      return true;
    }

    function changed() {
      onChange();
      onSelect(selected ? describeSelection() : null, undoStack.length);
    }
    function describeSelection() {
      if (!selected) return null;
      if (selected.kind === 'comp') return { kind: 'comp', comp: byId(selected.id) };
      return { kind: 'wire', wire: getScene().wires[selected.index] };
    }
    function select(sel) { selected = sel; }

    // ---------- 指针事件 ----------
    function onDown(ev) {
      var p = toLogical(ev);
      lastPointer = p;

      // 删除钮必须排在所有命中判断之前：它就长在导线上，
      // 先判导线的话这一下会被当成「再选一次这根线」，按钮永远点不动。
      if (hitDeleteButton(p)) {
        var delWr = getScene().wires[selected.index];
        if (delWr) {                     // 只删这一根，不碰元件
          pushUndo();
          getScene().wires.splice(selected.index, 1);
          selected = null;
          changed();
        }
        return;
      }

      var t = hitTerminal(p);
      if (t) {                                  // 从端子拉线
        wiring = { from: t, cur: p, to: null, trail: [{ x: p.x, y: p.y }] };
        canvas.setPointerCapture && canvas.setPointerCapture(ev.pointerId);
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
      if (wi >= 0) { select({ kind: 'wire', index: wi }); changed(); return; }
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
        onChange();
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
      var nt = hitTerminal(p), nh = null;
      if (nt) nh = { kind: 'term', compId: nt.compId, termIdx: nt.termIdx };
      else {
        var cs = getScene().comps;
        for (var i = cs.length - 1; i >= 0; i--) {
          if (hitComp(p, cs[i])) { nh = { kind: 'comp', id: cs[i].id }; break; }
        }
      }
      var changedHover = JSON.stringify(nh) !== JSON.stringify(hover);
      hover = nh;
      canvas.style.cursor = hitDeleteButton(p) ? 'pointer'
        : nt ? 'crosshair' : (nh ? 'move' : 'default');
      if (changedHover) onChange();
    }

    function onUp() {
      if (wiring) {
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
            if (!dup) {
              pushUndo();
              var ca = byId(a.compId), cb = byId(b.compId);
              var p0 = D.terminalWorld(ca, a.termIdx), p1 = D.terminalWorld(cb, b.termIdx);
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
                a: { compId: a.compId, termIdx: a.termIdx },
                b: { compId: b.compId, termIdx: b.termIdx },
                via: via, auto: false,
                // 原始形状留一份，元件拖走时按它重新贴合，见 refitManual
                base: { ends: [[p0.x, p0.y], [p1.x, p1.y]], via: via.map(function (v) { return [v[0], v[1]]; }) },
              });
            }
          }
        }
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
        } else discardEdit();       // 单纯点选，不留撤销记录
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

      // 选中框
      if (selected && selected.kind === 'comp') {
        var c = byId(selected.id);
        if (c) {
          var h = bodyHalf(c);
          ctx.save();
          ctx.strokeStyle = '#ea580c'; ctx.lineWidth = 2;
          ctx.setLineDash([7, 5]);
          D.roundRect(ctx, c.x - h[0] - 7, c.y - h[1] - 7, (h[0] + 7) * 2, (h[1] + 7) * 2, 8);
          ctx.stroke();
          ctx.restore();
        }
      } else if (selected && selected.kind === 'wire') {
        var wr = getScene().wires[selected.index];
        if (wr) {
          ctx.save();
          ctx.strokeStyle = '#ea580c'; ctx.lineWidth = 3; ctx.globalAlpha = 0.55;
          D.drawWire(ctx, pathOf(wr), { width: 10, flowing: false });
          ctx.restore();

          // 选中导线后，在线的中点长出一个删除圆钮
          var bp = delButtonPos(wr);
          if (bp) {
            ctx.save();
            ctx.beginPath(); ctx.arc(bp.x, bp.y, DEL_R + 2.5, 0, 6.284);
            ctx.fillStyle = '#fff'; ctx.fill();
            ctx.beginPath(); ctx.arc(bp.x, bp.y, DEL_R, 0, 6.284);
            ctx.fillStyle = '#dc2626'; ctx.fill();
            // 叉用两笔粗线画，不用「×」字形——字形的粗细和居中随字体变，
            // 在小圆钮里会忽大忽小、偏左偏右。
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
            var d = DEL_R * 0.42;
            ctx.beginPath();
            ctx.moveTo(bp.x - d, bp.y - d); ctx.lineTo(bp.x + d, bp.y + d);
            ctx.moveTo(bp.x + d, bp.y - d); ctx.lineTo(bp.x - d, bp.y + d);
            ctx.stroke();
            ctx.restore();
          }
        }
      }

      // 正在拉的导线：虚线预览，走的就是鼠标划过的轨迹
      if (wiring) {
        var ca = byId(wiring.from.compId);
        if (ca) {
          var p0 = D.terminalWorld(ca, wiring.from.termIdx);
          var p1 = wiring.to ? { x: wiring.to.x, y: wiring.to.y } : wiring.cur;
          var trail = wiring.trail.slice(1);
          var endGap = trail.length ? Math.hypot(
            trail[trail.length-1].x - p1.x, trail[trail.length-1].y - p1.y) : 0;
          if (endGap < TRAIL_MIN * 2) trail.pop();
          var prev = simplify(trail, TRAIL_TOL);
          ctx.save();
          ctx.strokeStyle = wiring.to ? '#16a34a' : '#f59e0b';
          ctx.lineWidth = 3; ctx.setLineDash([9, 6]);
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          for (var i = 0; i < prev.length; i++) ctx.lineTo(prev[i].x, prev[i].y);
          ctx.lineTo(p1.x, p1.y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = wiring.to ? '#16a34a' : '#f59e0b';
          ctx.beginPath(); ctx.arc(p1.x, p1.y, 6, 0, 6.284); ctx.fill();
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
      toLogical: toLogical, pathOf: pathOf, bodyHalf: bodyHalf, byId: byId,
      addComp: addComp, setParam: setParam, removeSelected: removeSelected,
      rotateSelected: rotateSelected, undo: undo, rerouteAll: rerouteAll,
      select: function (s) { select(s); changed(); },
      getSelected: function () { return describeSelection(); },
      pushUndo: pushUndo,
      delButtonPos: delButtonPos,
      beginSilent: function () { muted = true; },
      endSilent: function () { muted = false; pushUndo(); },
      drawOverlay: drawOverlay,
      GRID: GRID,
    };
  }

  return { create: create, GRID: GRID, BODY: BODY };
});
