/*!
 * circuit-skin.js — 电学元件的「教材版本皮肤」注册表
 *
 * 干什么：把「元件长什么样」从 circuit-draw.js 里摘出来，做成**可切换的皮肤**。
 *         学生在下拉里选「人教版」，画布上的器材就换成课本插图的画法；
 *         选「原版」，一个像素都不变。
 *
 * ── 铁律（「换皮不换骨」的全部约束，改皮肤前先读这一节）────────────
 *
 *   1. 皮肤【只画外形】，一个物理量都不许算。
 *      开关的 closed、灯泡的 brightness / fault、变阻器的 slide、表头的指针角，
 *      全部从内核回传的 rec 里读。皮肤自己算一遍读数，等于给同一件器材装了两个
 *      真相，迟早对不上。
 *
 *   2. 接线柱必须画在 D.terminalWorld(comp, i) 上。
 *      那是端子几何的**唯一真值**（由 TERMINALS + flipOf + comp 的位姿派生）。
 *      皮肤的柱子往外挪一格，导线就接不到柱子上 —— 而画面上看不出错，只觉得
 *      「这根线怎么悬着」。所以皮肤里绝不许出现裸的 ±70。
 *
 *   3. 皮肤画完接线柱要调 setPosts() 登记 comp.__posts。
 *      宿主把导线画在元件**之上**（真实情况就是导线从表盘上跨过去），接线柱是
 *      交互点，必须留在最上层，所以 drawTerminals() 会在导线之后补画一次。
 *      包装后的 drawTerminals 认这份登记，改画皮肤的柱子。
 *      🔴 不登记的话，最上层会冒出一对【原版渐变柱】压在皮肤的平涂柱上 ——
 *         皮肤的柱子看着被描了一圈奇怪的边，而且只有画了导线才看得出来。
 *
 *   4. 皮肤是【查看偏好】，不进存档、不进撤销栈、不改 comp.id / params。
 *      换皮肤不该让学生的电路变样，也不该产生一条可撤销的操作。
 *
 * ── 没覆盖到的类型一律回落给原版 ────────────────────────────────
 *   皮肤可以一件一件上：先开关 + 灯泡，验收过了再加表头。没上的那几件继续用
 *   现行画法，画面上不会缺件，也不会出现「这个版本少了半个电路」。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CircuitSkin = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ORDER = [];       // 注册顺序 = 下拉里的顺序
  var BY_ID = {};

  // ── 注册 ────────────────────────────────────────────────────
  // skin = {
  //   id:    'renjiao',
  //   label: '人教版',                 // 下拉里显示的名字
  //   note:  '……',                     // 下拉里的一行说明（可省）
  //   equip: { switch: fn, bulb: fn },  // 器材图：fn(ctx, comp, rec, opts, D)
  //   symbol:{ switch: fn, bulb: fn },  // 电路图符号：fn(ctx, it, D, values)
  //   bodyBox: { switch: fn },          // 外形包围盒覆盖（外形和原版一样就不用给）
  // }
  function register(skin) {
    if (!skin || !skin.id) throw new Error('皮肤必须有 id');
    if (ORDER.indexOf(skin.id) < 0) ORDER.push(skin.id);
    BY_ID[skin.id] = skin;
    return skin;
  }

  function list() {
    return ORDER.map(function (id) { return BY_ID[id]; });
  }
  function get(id) { return (id && BY_ID[id]) || null; }
  function has(id) { return !!(id && BY_ID[id]); }

  // 「原版」本身也登记成一张皮肤：这样下拉里天然有它一项，页面不用为它写特例，
  // 而且「选了原版」和「皮肤没装」走的是同一条路径 —— 少一条路径就少一个洞。
  register({
    id: 'base',
    label: '原版',
    note: '现行半写实画法',
    equip: {}, symbol: {}, bodyBox: {},
  });

  // ── 接线柱登记（皮肤共用）────────────────────────────────────
  // 和 circuit-draw.js 的 posts() 写的是同一个字段，定义成【非枚举】属性：
  // JSON.stringify / 深拷贝看不见它，存档往返和撤销快照不会因为多出这个字段而
  // 对不上（撤销栈比的是 scene 的序列化结果，多一个可枚举字段就天天「有变化」）。
  function setPosts(comp, kinds, scale, neck) {
    var v = { kinds: kinds, scale: scale, neck: neck };
    try {
      Object.defineProperty(comp, '__posts', {
        value: v, writable: true, enumerable: false, configurable: true,
      });
    } catch (e) {
      comp.__posts = v;
    }
    return v;
  }

  // ── 包装：把原版 D 换成「先问皮肤、没有就问原版」的代理 ──────────
  // 只覆盖两个入口，其余属性（TERMINALS / terminalWorld / HALF / PALETTE /
  // roundRect / drawWire / …）原样透传 —— 皮肤要用的公共件一个都不缺。
  function wrap(base, skinId) {
    if (!base) throw new Error('circuit-skin: 需要一个原版绘制模块（CircuitDraw）');
    var skin = get(skinId);
    var out = {};
    for (var k in base) {
      if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
    }
    out.__base = base;
    out.__skinId = skin ? skin.id : 'base';
    out.__skin = skin;

    out.drawComponent = function (ctx, comp, rec, opts) {
      var f = skin && skin.equip && skin.equip[comp.type];
      if (f) { f(ctx, comp, rec, opts, base); return; }
      base.drawComponent(ctx, comp, rec, opts);
    };

    // 导线之后补画接线柱。皮肤没登记柱子就原样回落 —— 这样「皮肤没覆盖的类型」
    // 和「皮肤覆盖了但没调 setPosts」是两种不同的表现，查起来分得开。
    out.drawTerminals = function (ctx, comp) {
      var s = comp && comp.__posts;
      var f = skin && skin.posts && skin.posts[comp.type];
      if (f && s) { f(ctx, comp, s, base); return; }
      base.drawTerminals(ctx, comp);
    };

    out.bodyBox = function (comp) {
      var f = skin && skin.bodyBox && skin.bodyBox[comp.type];
      if (f) return f(comp, base);
      return base.bodyBox(comp);
    };

    // ── 接线柱位置：皮肤可以改【某几件】器材的柱子 ──────────────────
    // 形状和 circuit-draw 的 TERMINALS 里那一项一样（元件自身坐标系）：
    //   skin.terminals = { motor: [{x,y},{x,y}], rheostat: [{x,y},…] }
    //
    // 🔴 为什么必须有这条：像电动机那两根引线、变阻器的 C/D 柱，课本图上的
    //    位置和原版不一样。改 circuit-draw 的 TERMINALS 是【共享契约】——
    //    全站 16 个页面、内核的极性语义、基座那套画法会跟着一起变，等于把
    //    原版也改了。所以皮肤自己带一张表，只有「选了这张皮肤」时才生效。
    //
    // 🔴 局部坐标 → 世界坐标只有一份实现（base.terminalWorldIn）：
    //    翻转 flipOf 和位姿 rotate/translate 都在里面。皮肤自己再写一遍
    //    这套三角函数，迟早在「翻转过的元件」上漂移成两套真值。
    function tw(comp, list, i) {
      var t = list && list[i];
      if (!t) return null;
      if (base.terminalWorldIn) return base.terminalWorldIn(comp, list, i);
      // 老版本 circuit-draw（没导出 terminalWorldIn）的兜底：同样的式子，
      // 少一层封装而已。不写这个的话老缓存页面上柱子会全部错位。
      return base.toWorld(comp, base.flipOf(comp) ? -t.x : t.x, t.y);
    }
    out.terminalWorld = function (comp, i) {
      var list = skin && skin.terminals && skin.terminals[comp.type];
      if (list) return tw(comp, list, i);
      return base.terminalWorld(comp, i);
    };
    // endWorld 必须跟着一起覆盖：原版那个函数内部调的是【模块作用域】的
    // terminalWorld，拿不到上面这层覆盖 —— 不重写的话，导线端点会按原版
    // 柱子解算，画出来的线落在 A 处、皮肤画的柱子在 B 处。
    out.endWorld = function (comp, e) {
      if (!e) return null;
      if (e.compId && comp) return out.terminalWorld(comp, e.termIdx);
      if (e.x != null && e.y != null) return { x: e.x, y: e.y };
      return null;
    };

    // ── 命中框 / 选中框：皮肤声明「这件器材实际占多大地盘」──────────
    // 返回【元件自身坐标系】的矩形 {x0,y0,x1,y1}（可以非对称 —— 开关的
    // 手柄往左伸出去一大截，对称框要么框不住手柄、要么往右多圈一片空气）。
    // 返回 null = 让调用方用它自己的默认值（原版那张 BODY 表）。
    out.hitBoxOf = function (comp) {
      var f = skin && skin.hitBox && skin.hitBox[comp.type];
      return f ? f(comp) : null;
    };

    return out;
  }

  // ── 符号钩子 ────────────────────────────────────────────────
  // 给 circuit-schematic 的 opts.symbol 用：返回 true 表示「这件我画了」，
  // 返回 false 让电路图模块走它自己的标准符号。
  // 一张皮肤只要有一件符号没写，那一件就继续用国标画法 —— 电路图不会缺件。
  function symbolDrawer(skinId) {
    var skin = get(skinId);
    if (!skin || !skin.symbol) return null;
    var any = false;
    for (var t in skin.symbol) {
      if (Object.prototype.hasOwnProperty.call(skin.symbol, t)) { any = true; break; }
    }
    if (!any) return null;
    return function (ctx, it, D, values) {
      var f = skin.symbol[it.type];
      if (!f) return false;
      f(ctx, it, D, values);
      return true;
    };
  }

  // ── 单件取用（预览页 / 元件栏图标用）─────────────────────────
  // 返回 null 表示「这张皮肤没画这件」——调用方要自己回落到原版，
  // 不要在这里悄悄替它画一个，那样「没覆盖」就查不出来了。
  function equipDrawer(skinId, type) {
    var skin = get(skinId);
    var f = skin && skin.equip && skin.equip[type];
    return f || null;
  }

  return {
    register: register, list: list, get: get, has: has,
    wrap: wrap, setPosts: setPosts,
    symbolDrawer: symbolDrawer, equipDrawer: equipDrawer,
    version: '1.0.0',
  };
});
