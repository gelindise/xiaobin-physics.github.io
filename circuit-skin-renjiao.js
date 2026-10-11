/*!
 * circuit-skin-renjiao.js — 人教版皮肤：闸刀开关 + 小灯泡
 *
 * ══ 这一版【直接贴课本原图】，不再重画 ═══════════════════════════════
 * 用户明确要求：「就用原图，不要量取、画，而是在原图上直接用」。
 * 所以画布上画的**就是那两张课本截图本身**（抠掉白底、按端子间距缩放到
 * 逻辑坐标），一笔都没重画 —— 断开态的开关、没通电的灯泡，和课本逐像素一致。
 *
 * 素材在 circuit-skin-renjiao-img-data.js（由 dev-imgskin.py 自动生成）：
 *   · 开关：地盘（原图去掉刀片）+ 刀片刚体（含手柄、挡圈、转轴销）
 *   · 灯泡：地盘（原图去掉玻璃泡与螺口）+ 玻璃泡刚体（含螺口）
 *   · 各两枚接线柱小块
 *
 * ── 状态怎么表达（原图只画了一个状态，这是唯一要动脑筋的地方）──────
 *   · 开关：原图是【断开】态（刀片抬离触点 12.23°）。闭合 = 把【刀片刚体】
 *     绕原图的转轴销转回水平 —— 刀片用的还是原图那几个像素，只是转了个角度。
 *   · 灯泡：原图是【灭】态。点亮 = 在玻璃泡范围内叠一层暖光晕（那是光，
 *     不是材质），亮度直接取内核回传的 rec.brightness，连续渐亮、不切档。
 *   · 三种故障照旧一个不少：取下 = 不画玻璃泡；烧断 = 灯丝上压一道断口；
 *     短路 = 两根柱子之间拉一根铜丝（和原版同一套画法，保持全站一致）。
 *
 * ── 坐标换算（唯一的自由参数）────────────────────────────────────
 *   原图的「接线柱中心间距」是画出来的，沙盒的端子间距是【契约】：
 *   开关原图柱距 109px、灯泡 118.5px，而沙盒端子固定在 ±70（间距 140）。
 *   所以每个元件各有一个缩放：开关 k = 140/109 = 1.2844，灯泡 k = 140/118.5 = 1.1814。
 *   纵向钉在【两柱心的中点】→ 本地 y = 0（导线就是接在这个高度上的）。
 *   于是：  lx = (px − midX) × k        ly = (py − midY) × k
 *
 * 🔴 这套画法比原版【大一圈】（底板半宽 ≈ 86，原版是 70）。这是「一模一样」
 *    的必然结果：原图里接线柱离底板两端还有一段余量，而沙盒把柱子钉死在 ±70。
 *    端子坐标一个没动（仍是 ±70）—— 导线、拖拽、命中、求解全不受影响。
 *
 * ── 素材是异步解码的 ────────────────────────────────────────────
 *   data: URI 也要等 Image.onload。没就绪之前一律回落给原版画法（绝不能画
 *   半张图或者什么都不画），就绪之后广播 'circuit-skin-ready'，宿主重画一次。
 *   实测这段窗口只有几十毫秒，首屏基本看不出来。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./circuit-skin.js'));
  } else {
    var api = factory(root.CircuitSkin);
    root.CircuitSkinRenjiao = api;
    if (root.CircuitSkin && root.CircuitSkin.register) root.CircuitSkin.register(api);
  }
})(typeof self !== 'undefined' ? self : this, function (Skin) {
  'use strict';

  var TAU = Math.PI * 2;
  var HAS_DOM = (typeof document !== 'undefined');
  var G = (typeof window !== 'undefined' && window.__SKIN_IMG_RENJIAO) || null;

  // ── 素材没到位时的兜底 ────────────────────────────────────────
  // 一律回落给原版：宁可是「暂时长得像原版」，也不能是空白或缺半个元件。
  function fallback(D, ctx, comp, rec, opts) {
    if (D && D.drawComponent) D.drawComponent(ctx, comp, rec, opts);
  }

  if (!G || !HAS_DOM) {
    // 没有素材（或不在浏览器里）：登记一张空皮肤 —— 下拉里仍然有它，
    // 选中时全页回落原版，而不是整页报错。
    return {
      id: 'renjiao', label: '人教版', note: '原图素材未加载（回落原版）',
      equip: {}, posts: {}, symbol: {}, bodyBox: {},
      envelope: { switch: { x0: -122, x1: 86, y0: -73, y1: 42 },
                  bulb: { x0: -88, x1: 86, y0: -83, y1: 42 } },
      view: { switch: { x0: -126, y0: -77, x1: 90, y1: 46 },
              bulb: { x0: -92, y0: -87, x1: 90, y1: 46 } },
    };
  }

  var SW = G.sw, BL = G.bl;
  var ready = false;

  function mkCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }
  // 把源图按 k 预缩放到逻辑尺寸，只做一次（每帧再缩一次是白烧 CPU）
  function scaleTo(src, k) {
    var c = mkCanvas(src.width * k, src.height * k);
    var g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }

  var IMG = {}, SWC = {}, BLC = {};

  function loadAll(list, done, store) {
    store = store || IMG;
    var n = list.length, fin = 0;
    if (!n) { done(); return; }
    list.forEach(function (it) {
      var im = new Image();
      im.onload = function () { store[it.key] = im; if (++fin === n) done(); };
      im.onerror = function () { if (++fin === n) done(); };
      im.src = it.src;
    });
  }

  // ── 第二批素材（电池 / 定值电阻 / 电流表 / 电压表 / 滑动变阻器 / 电动机）──
  // 和人教版开关、灯泡同一套口径：底盘用原图一个像素不动，该动的活动件从同一张
  // 原图里抠出来当刚体转/移。
  var G2 = (typeof window !== 'undefined' && window.__SKIN_IMG_RENJIAO2) || null;
  var IMG2 = {}, CV2 = {};
  var KEYS2 = G2 ? Object.keys(G2) : [];

  // ── 皮肤自己的接线柱位置（元件自身坐标系）─────────────────────────
  // 🔴 为什么不直接改 circuit-draw 的 TERMINALS：那是【共享契约】—— 全站 16 个
  //    页面、内核的极性语义、基座那套画法会跟着一起变，等于把原版也改了。
  //    （上一版就是踩了这个坑：为了把变阻器的 C/D 挪到课本位置，改了共享表，
  //      结果原版的 C/D 也一起挪了，用户当场看出来。）
  //    课本插图这三件的柱位和原版不一样：电动机的柱是机身左下角两根引线、
  //    变阻器的 C/D 在两端外侧、表缩小后柱子跟着往里收。
  var TERMS = {};
  ['motor', 'rheostat', 'ammeter', 'voltmeter'].forEach(function (t) {
    var S = G2 && G2[t];
    if (S && S.terms && S.terms.length) TERMS[t] = S.terms;
  });

  // ── 命中框 / 选中框（局部坐标，非对称）───────────────────────────
  // 数值由 dev-imgskin*.py 按【素材实际墨迹】量出来写进数据 —— 不在皮肤里猜：
  // 开关手柄往左伸出去一大截、表是一整台仪器，照原版那张对称表算，症状就是
  // 「点手柄点不着」和「选中虚线框只框住表盘下半截」。
  var BOX = {};
  (function () {
    var G1 = (typeof window !== 'undefined' && window.__SKIN_IMG_RENJIAO) || null;
    if (G1) {
      if (G1.sw && G1.sw.box) BOX.switch = G1.sw.box;
      if (G1.bl && G1.bl.box) BOX.bulb = G1.bl.box;
    }
    KEYS2.forEach(function (k) { if (G2[k].box) BOX[k] = G2[k].box; });
  })();

  function build() {
    if (!IMG.swFull || !IMG.swChassis || !IMG.swBlade || !IMG.blFull || !IMG.blBase) {
      // 有一张没解出来就整体不启用：半套素材比没有更糟（画面会缺件）
      return;
    }
    SWC.full = scaleTo(IMG.swFull, SW.k);
    SWC.chassis = scaleTo(IMG.swChassis, SW.k);
    SWC.blade = scaleTo(IMG.swBlade, SW.k);
    BLC.full = scaleTo(IMG.blFull, BL.k);
    BLC.base = scaleTo(IMG.blBase, BL.k);
    // 第二批：素材已经是【按显示尺寸(×DPR)存好的】，这里不用再缩放，直接收进
    // 离屏 canvas 当纹理用（每帧 drawImage 一张 Image 也行，但 canvas 更快更稳）。
    KEYS2.forEach(function (key) {
      if (!IMG2[key]) return;
      var S = G2[key];
      CV2[key] = mkCanvas(S.w, S.h);
      CV2[key].getContext('2d').drawImage(IMG2[key], 0, 0, S.w, S.h);
      if (S.kind === 'needle' && IMG2[key + '_needle']) {
        CV2[key + '_needle'] = mkCanvas(S.needleW, S.needleH);
        CV2[key + '_needle'].getContext('2d')
          .drawImage(IMG2[key + '_needle'], 0, 0, S.needleW, S.needleH);
      }
      if (S.kind === 'slider' && IMG2[key + '_slider']) {
        CV2[key + '_slider'] = mkCanvas(S.sliderW, S.sliderH);
        CV2[key + '_slider'].getContext('2d')
          .drawImage(IMG2[key + '_slider'], 0, 0, S.sliderW, S.sliderH);
      }
      if (S.kind === 'motor') {
        // 两根引线各是一张 sprite（会各自绕上端转一个角度）
        (S.leads || []).forEach(function (L, i) {
          var im = IMG2[key + '_lead' + i];
          if (!im) return;
          CV2[key + '_lead' + i] = mkCanvas(L.w, L.h);
          CV2[key + '_lead' + i].getContext('2d').drawImage(im, 0, 0, L.w, L.h);
        });
      }
    });
    ready = true;
    try { window.dispatchEvent(new Event('circuit-skin-ready')); } catch (e) {}
  }

  // ── 第三批素材（发光二极管）──────────────────────────────────
  // 和人教版开关、灯泡同一套口径：底盘用课本原图一个像素不动。LED 有两个
  // 【状态】（正向导通 / 反向截止），课本图 15.2-3 上正好各画了一只 ——
  // 于是两个状态各贴一张原图，一笔都没重画。
  var G3 = (typeof window !== 'undefined' && window.__SKIN_IMG_RENJIAO3) || null;
  var IMG3 = {}, CV3 = {}, ready3 = false;
  var KEYS3 = G3 ? Object.keys(G3) : [];

  function build3() {
    KEYS3.forEach(function (key) {
      var S = G3[key];
      if (!IMG3[key]) return;
      CV3[key] = mkCanvas(S.w, S.h);
      CV3[key].getContext('2d').drawImage(IMG3[key], 0, 0, S.w, S.h);
      ['green', 'blue'].forEach(function (c) {
        if (!IMG3[key + '_' + c]) return;
        CV3[key + '_' + c] = mkCanvas(S.w, S.h);
        CV3[key + '_' + c].getContext('2d').drawImage(IMG3[key + '_' + c], 0, 0, S.w, S.h);
      });
    });
    ready3 = true;
    try { window.dispatchEvent(new Event('circuit-skin-ready')); } catch (e) {}
  }

  function loadBatch3() {
    if (!G3 || !KEYS3.length) return;
    var list3 = [];
    KEYS3.forEach(function (key) {
      var S = G3[key];
      list3.push({ key: key, src: S.full });
      ['green', 'blue'].forEach(function (c) {
        if (S[c]) list3.push({ key: key + '_' + c, src: S[c] });
      });
    });
    loadAll(list3, build3, IMG3);
  }

  loadAll([
    { key: 'swFull', src: SW.full },
    { key: 'swChassis', src: SW.chassis },
    { key: 'swBlade', src: SW.blade },
    { key: 'blFull', src: BL.full },
    { key: 'blBase', src: BL.base },
  ], function () {
    // 第二批是【另一张表】，单独加载、单独回调；三批都到齐才全 ready。
    if (!G2) { build(); loadBatch3(); return; }
    var list2 = [];
    KEYS2.forEach(function (key) {
      list2.push({ key: key, src: G2[key].full });
      if (G2[key].kind === 'needle') list2.push({ key: key + '_needle', src: G2[key].needle });
      if (G2[key].kind === 'slider') list2.push({ key: key + '_slider', src: G2[key].slider });
      if (G2[key].kind === 'motor') {
        (G2[key].leads || []).forEach(function (L, i) {
          list2.push({ key: key + '_lead' + i, src: L.img });
        });
      }
    });
    loadAll(list2, function () { build(); loadBatch3(); }, IMG2);
  });

  // ── 图像坐标 → 本地坐标 ──────────────────────────────────────
  function mapper(mid, k) {
    return {
      x: function (px) { return (px - mid[0]) * k; },
      y: function (py) { return (py - mid[1]) * k; },
    };
  }
  var SWM = mapper(SW.mid, SW.k);
  var BLM = mapper(BL.mid, BL.k);

  // 元件自身的位姿（平移 + 旋转 + 镜像）。镜像是【局部 x 取负】—— 和
  // terminalWorld 对端子 x 取负是同一件事的两面（见 circuit-draw.js 的 flipOf）。
  function pose(ctx, comp, D) {
    ctx.translate(comp.x, comp.y);
    ctx.rotate((comp.rot || 0) * Math.PI / 180);
    if (D.flipOf(comp)) ctx.scale(-1, 1);
  }

  // ═════════════════════════════════════════════════════════════
  // 闸刀开关
  // ═════════════════════════════════════════════════════════════
  function drawSwitch(ctx, comp, rec, opts, D) {
    if (!ready) { fallback(D, ctx, comp, rec, opts); return; }
    var closed = rec ? !!rec.closed : !!(comp.params && comp.params.closed);

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    pose(ctx, comp, D);

    // ① 断开：原图【本来就画的是断开】—— 直接贴整张原图。
    //    🔴 这是唯一能保证【逐像素一致】的画法。拆件（地盘 + 刀片）要各自缩放
    //    再拼，两块的亚像素落位和「整张一起缩放」的重采样对不上，轮廓会差 4%
    //    （底盘那一层仍是逐像素一致的，差的只有刀片轮廓那一圈）。
    if (!closed) {
      ctx.drawImage(SWC.full, SWM.x(0), SWM.y(0));
    } else {
      // ② 闭合：原图没画过这个状态，只能拼 —— 地盘（原图去掉刀片）+ 刀片刚体
      //    绕原图的转轴销转回水平。刀片用的还是原图那几个像素，只是转了个角度。
      ctx.drawImage(SWC.chassis, SWM.x(0), SWM.y(0));
      var pvx = SWM.x(SW.pivotImg[0]), pvy = SWM.y(SW.pivotImg[1]);
      var ax = SWM.x(SW.bladeAt[0]), ay = SWM.y(SW.bladeAt[1]);
      ctx.save();
      ctx.translate(pvx, pvy);
      ctx.rotate(-SW.openDeg * Math.PI / 180);
      ctx.drawImage(SWC.blade, ax - pvx, ay - pvy);
      ctx.restore();
    }

    ctx.restore();          // ← 接线柱必须在【位姿之外】画（它走 terminalWorld）

    Skin.setPosts(comp, ['pos', 'pos'], 1.4, 8);
  }

  // ═════════════════════════════════════════════════════════════
  // 小灯泡
  // ═════════════════════════════════════════════════════════════
  function drawBulb(ctx, comp, rec, opts, D) {
    if (!ready) { fallback(D, ctx, comp, rec, opts); return; }
    var fault = (rec && rec.fault) || null;
    var bright = rec ? Math.max(0, Math.min(rec.brightness || 0, 1.3)) : 0;
    var lit = !fault && bright > 0.02;

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    pose(ctx, comp, D);

    // ① 地盘。灯泡只有【取下】这一个状态需要拆件（原图里玻璃泡在），其余状态
    //    玻璃泡都待在原地 —— 所以直接贴整张原图，逐像素一致。
    if (fault === 'removed') ctx.drawImage(BLC.base, BLM.x(0), BLM.y(0));
    else ctx.drawImage(BLC.full, BLM.x(0), BLM.y(0));

    var gcx = BLM.x(BL.glassAt[0] + BL.glassC[0]);
    var gcy = BLM.y(BL.glassAt[1] + BL.glassC[1]);
    var gr = BL.glassR * BL.k;

    // ② 玻璃泡（+螺口）。「灯泡已取下」就是【不画这一层】—— 那才是拧下来的
    //    样子；把泡画淡一点不是「取下」，是「泡还在、只是看不太清」。
    if (fault !== 'removed') {
      // ③ 点亮：泡内叠一层暖光晕。玻璃本身不发光，暖色是灯丝透过来的，
      //    所以用 lighter 叠在【泡的范围】里，亮度跟着 rec.brightness 连续走。
      if (lit) {
        var fx = BLM.x(BL.glassAt[0] + BL.filament[0]);
        var fy = BLM.y(BL.glassAt[1] + BL.filament[1]);
        var k = Math.min(bright, 1);
        ctx.save();
        ctx.beginPath();
        ctx.arc(gcx, gcy, gr * 0.99, 0, TAU);
        ctx.clip();
        // 🔴 用 source-over 而【不是】lighter。第一版用 lighter 叠暖色，在灯丝那一带
        //    直接把三个通道都加到饱和 → 结果是一片纯白，R−B 反而掉到 3（实测），
        //    灯泡「亮了但一点也不暖」。source-over 是往暖色【混】，饱和不了。
        //    色相跟着亮度走：暗红 → 橙 → 暖黄白（和真实灯丝一个路子）。
        // 色相跟着亮度走：暗红 → 橙 → 暖黄白（和真实灯丝一个路子）。
        // 🔴 灯丝那一档【必须够饱和】：太浅的话叠上去只是一片奶油色，
        //    量出来的 R−B 上不去，「亮了但不暖」。
        // R−B 单调递减但【始终强暖】：暗时深橙红、亮时暖黄（真实灯丝就是这样，
        // 越亮越白但仍然是黄白）。四档都卡得比较饱和 —— 叠在【浅蓝的玻璃】上
        // 之后 R−B 会被拉低一大截（玻璃本身是负的），源头不饱和就出不来暖。
        var HUE = [[0, [255, 90, 20]], [0.35, [255, 160, 45]],
                   [0.7, [255, 178, 52]], [1, [255, 220, 130]]];
        function hueAt(b) {
          for (var i = 0; i < HUE.length - 1; i++) {
            var p0 = HUE[i], p1 = HUE[i + 1];
            if (b <= p1[0] || i === HUE.length - 2) {
              var t = (b - p0[0]) / (p1[0] - p0[0]);
              t = Math.max(0, Math.min(1, t));
              return [p0[1][0] + (p1[1][0] - p0[1][0]) * t,
                      p0[1][1] + (p1[1][1] - p0[1][1]) * t,
                      p0[1][2] + (p1[1][2] - p0[1][2]) * t];
            }
          }
          return HUE[HUE.length - 1][1];
        }
        var hue = hueAt(k);
        var a0 = 0.35 + 0.62 * k;          // 灯丝处（热芯）
        var a1 = 0.14 + 0.44 * k;          // 泡中部
        var a2 = 0.05 + 0.20 * k;          // 泡边缘
        var col = function (al) {
          return 'rgba(' + Math.round(hue[0]) + ',' + Math.round(hue[1]) + ',' +
                 Math.round(hue[2]) + ',' + al.toFixed(3) + ')';
        };
        var rg = ctx.createRadialGradient(fx, fy, 0, fx, fy, gr * 1.45);
        rg.addColorStop(0.00, col(a0));
        rg.addColorStop(0.22, col(a1));
        rg.addColorStop(0.58, col(a2));
        rg.addColorStop(1.00, col(0));
        ctx.fillStyle = rg;
        ctx.fillRect(gcx - gr * 1.6, gcy - gr * 1.6, gr * 3.2, gr * 3.2);
        ctx.restore();
      }

      // ④ 灯丝烧断：在灯丝上压一道断口（暖光晕照常，学生看得见「丝断了」）
      if (fault === 'burned') {
        var fx2 = BLM.x(BL.glassAt[0] + BL.filament[0]);
        var fy2 = BLM.y(BL.glassAt[1] + BL.filament[1]);
        ctx.save();
        ctx.strokeStyle = '#3a3226';
        ctx.lineWidth = Math.max(1.2, 1.1 * BL.k);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(fx2 - 4.6 * BL.k, fy2 - 1.2 * BL.k);
        ctx.lineTo(fx2 + 4.6 * BL.k, fy2 + 1.2 * BL.k);
        ctx.stroke();
        ctx.restore();
      }
    }

    // ⑤ 牌子（走元件自身的局部坐标 —— 必须在 restore() 之前画）
    if (fault === 'removed') D.faultTag(ctx, 0, gcy + gr * 0.1, '灯泡已取下', 1);
    if (fault === 'burned') D.faultTag(ctx, 0, gcy + gr * 1.15, '灯丝烧断', 1);

    // ⑥ 灯座短路：两根接线柱之间拉一根铜丝。这是【故障标注】不是元件外观，
    //    所以照全站统一画法（和原版逐字一致）—— 换皮肤不该让故障长得不一样。
    if (fault === 'shorted') {
      ctx.save();
      ctx.strokeStyle = '#c8894a';
      ctx.lineWidth = 5.5; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-70, 0);
      ctx.quadraticCurveTo(0, 26, 70, 0);
      ctx.stroke();
      ctx.fillStyle = '#c9ced6';
      ctx.beginPath(); ctx.arc(-70, 0, 4.2, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(70, 0, 4.2, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(51,65,85,0.45)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(-70, 0, 4.2, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(70, 0, 4.2, 0, TAU); ctx.stroke();
      ctx.restore();
      D.faultTag(ctx, 0, gcy + gr * 1.15, '灯座短路', 1);
    }

    ctx.restore();          // ← 接线柱同样必须在【位姿之外】

    Skin.setPosts(comp, ['pos', 'pos'], 1.4, 8);
  }

  // ═════════════════════════════════════════════════════════════
  // 导线之后补画的接线柱
  // ─────────────────────────────────────────────────────────────
  // 宿主把导线画在元件【之上】，接线柱是交互点，必须补画到最上层。
  // 这里贴的是【地盘图上完全相同的那一块】—— 所以像素逐个一致，唯一的效果
  // 就是把导线盖住。故意用矩形 alpha：不需要抠形状，也不会漏边。
  // dpr 只有【第二批】素材要给（它们按 k×dpr 存，屏幕 dpr=2 时更清楚）：
  // 源矩形在【存储像素】里 = 原图坐标 × k × dpr；目标在【逻辑坐标】里 = × k。
  // 开关/灯泡那两张是按逻辑尺寸存的，dpr 省略（=1）。
  function drawPosts(ctx, comp, D, src, rects, mid, k, dpr) {
    dpr = dpr || 1;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    pose(ctx, comp, D);
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i];
      var sx = (r.x0 + mid[0]) * k * dpr, sy = (r.y0 + mid[1]) * k * dpr;
      var sw = (r.x1 - r.x0) * k * dpr, sh = (r.y1 - r.y0) * k * dpr;
      ctx.drawImage(src, sx, sy, sw, sh,
                    r.x0 * k, r.y0 * k, (r.x1 - r.x0) * k, (r.y1 - r.y0) * k);
    }
    ctx.restore();
  }

  // ═════════════════════════════════════════════════════════════
  // 第二批：通用「静止件」
  // ─────────────────────────────────────────────────────────────
  // 底盘就是整张原图，没有活动件 —— 电池、定值电阻、以及将来任何「不通电就
  // 不变样」的器材都走这里。活动件（表针 / 滑片）另写。
  function drawImg(key, ctx, comp, rec, opts, D) {
    var S = G2 && G2[key], cv = CV2[key];
    if (!ready || !S || !cv) { fallback(D, ctx, comp, rec, opts); return false; }
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    pose(ctx, comp, D);
    ctx.drawImage(cv, -S.mid[0] * S.k, -S.mid[1] * S.k, S.w / S.dpr, S.h / S.dpr);
    ctx.restore();
    return true;
  }
  function drawStatic(key) {
    return function (ctx, comp, rec, opts, D) {
      if (!drawImg(key, ctx, comp, rec, opts, D)) return;
      Skin.setPosts(comp, ['pos', 'pos'], 1.4, 8);
    };
  }
  function postsFor(key) {
    return function (ctx, comp, s, D) {
      var S = G2 && G2[key], cv = CV2[key];
      if (!ready || !S || !cv) { D.drawTerminals(ctx, comp); return; }
      drawPosts(ctx, comp, D, cv, S.posts, S.mid, S.k, S.dpr);
    };
  }

  // ── 表头：底盘贴原图，指针抠出来绕原图转轴转 ─────────────────
  // 🔴 指针角度按【课本自己的】刻度弧两端（S.a0 → S.a1）算。沙盒的扫角是
  //    −150°→−30°，和课本这两张对不上；照抄沙盒常数，针会指到刻度外面去。
  //    原图里指针正好停在 a0（零刻度）⇒ frac=0 时旋转量是 0，画面和原图逐像素一致。
  function drawMeter(key) {
    return function (ctx, comp, rec, opts, D) {
      var S = G2 && G2[key], cv = CV2[key], nd = CV2[key + '_needle'];
      if (!ready || !S || !cv || !nd) { fallback(D, ctx, comp, rec, opts); return; }
      var isVolt = (key === 'voltmeter');
      var reading = rec ? (rec.reading || 0) : 0;
      var range = (rec && rec.range) || (comp.params && comp.params.range) || (isVolt ? 3 : 0.6);
      var rev = reading < -1e-9;
      var mag = Math.min(Math.abs(reading) / (range || 1), 1.06);
      var zeroed = !!(comp.params && comp.params.zeroed);
      var ZOFF = (D.MET && D.MET.ZERO_OFF) || 0;
      var frac = rev ? -0.085 : Math.min(mag + (zeroed ? 0 : ZOFF), 1.06);
      var ang = S.a0 + (S.a1 - S.a0) * frac;

      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      pose(ctx, comp, D);
      ctx.drawImage(cv, -S.mid[0] * S.k, -S.mid[1] * S.k, S.w / S.dpr, S.h / S.dpr);
      // 指针：绕原图的转轴销转
      ctx.save();
      ctx.translate((S.pivotImg[0] - S.mid[0]) * S.k, (S.pivotImg[1] - S.mid[1]) * S.k);
      ctx.rotate((ang - S.a0) * Math.PI / 180);
      ctx.drawImage(nd, -S.pivotInNeedle[0] / S.dpr, -S.pivotInNeedle[1] / S.dpr,
                    S.needleW / S.dpr, S.needleH / S.dpr);
      ctx.restore();
      ctx.restore();

      // ── 数字示数（参数面板勾了「在表盘上显示读数」才画）────────────
      // 🔴 位置和原版不一样，必须换：原版把液晶块放在【刻度弧下方、轴心上方】
      //    那块「针扫不到」的地方 —— 因为原版的针只有一小段弧（半径 50~62）。
      //    课本这张表的针是【从轴心一直伸到针尖】的一整条线，整片上半盘都在
      //    它的扫程里，照原版的位置画会被针划过去。
      //    课本表的扫角全是负角（−138.8°→−26.8°，绕轴心转），所以【轴心下方】
      //    那一块永远扫不到 —— 液晶块放那儿：既空着、又不会被针划到。
      //    数值一律走 D.fmtRead（和原版同一个格式化，不能这边自己拼小数位）。
      if (comp.params && comp.params.showValue && !(rec && rec.practiceHide)) {
        var vtxt = (D.fmtRead ? D.fmtRead(reading) : String(reading)) + (isVolt ? ' V' : ' A');
        // 位置/尺寸按【网纹块右边那块空白】量出来：电流表网纹块占到 x=21、
        // 表盘右沿在 66；电压表网纹块占到 x=11.3、表盘右沿在 48。
        var vw = isVolt ? 34 : 42;
        var va = isVolt ? [30, 2] : [43, 2];
        ctx.save();
        ctx.translate(va[0], va[1]);
        ctx.fillStyle = 'rgba(15,23,42,0.92)';
        D.roundRect(ctx, -vw / 2, -7.5, vw, 15, 3); ctx.fill();
        ctx.strokeStyle = 'rgba(148,163,184,0.55)'; ctx.lineWidth = 1;
        D.roundRect(ctx, -vw / 2, -7.5, vw, 15, 3); ctx.stroke();
        ctx.fillStyle = '#7dd3fc';
        ctx.font = 'bold ' + (isVolt ? 9 : 10.5) + 'px ui-monospace,Menlo,Consolas,monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(vtxt, 0, 0.5);
        ctx.restore();
      }
      Skin.setPosts(comp, ['neg', 'pos', 'pos'], 1.4, 8);
    };
  }

  // ── 滑动变阻器：底盘贴原图，滑片抠出来沿原图行程左右平移 ──────
  // 🔴 原图里滑片停在 slide=0.5 处（实测 x≈460 = sliderX0 + span/2），所以
  //    slide=0.5 时平移量是 0，画面和原图逐像素一致。
  function drawRheostat(key) {
    return function (ctx, comp, rec, opts, D) {
      var S = G2 && G2[key], cv = CV2[key], sl = CV2[key + '_slider'];
      if (!ready || !S || !cv || !sl) { fallback(D, ctx, comp, rec, opts); return; }
      var slide = 0.5;
      if (rec && rec.slide != null) slide = +rec.slide;
      else if (comp.params && comp.params.slide != null) slide = +comp.params.slide;
      slide = Math.max(0, Math.min(1, slide));
      var mid0 = S.sliderX0 + S.sliderSpan * 0.5;
      var dx = (S.sliderX0 + S.sliderSpan * slide - mid0) * S.k;

      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      pose(ctx, comp, D);
      ctx.drawImage(cv, -S.mid[0] * S.k, -S.mid[1] * S.k, S.w / S.dpr, S.h / S.dpr);
      ctx.drawImage(sl, (S.sliderAt[0] - S.mid[0]) * S.k + dx,
                        (S.sliderAt[1] - S.mid[1]) * S.k,
                    S.sliderW / S.dpr, S.sliderH / S.dpr);
      ctx.restore();
      Skin.setPosts(comp, ['pos', 'pos', 'pos', 'pos'], 1.4, 8);
    };
  }

  // ── 电动机：底盘贴原图，两根引线抠出来绕【上端】向外张 ──────────
  // 🔴 课本图上那两根引线间距只有 10px —— 导线接上去两根几乎叠在一起。
  //    所以把引线各自当刚体、绕【上端】（贴到机身那一头）向外转 30°：
  //    引线用的还是原图那几个像素，只是转了个角度，末端间距从 10px 拉到 27px。
  //    端子（皮肤 terminals.motor）落在张开后的末端，导线就接在引线头上。
  function drawMotor(ctx, comp, rec, opts, D) {
    var S = G2 && G2['motor'], cv = CV2['motor'];
    if (!ready || !S || !cv) { fallback(D, ctx, comp, rec, opts); return; }
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    pose(ctx, comp, D);
    ctx.drawImage(cv, -S.mid[0] * S.k, -S.mid[1] * S.k, S.w / S.dpr, S.h / S.dpr);
    (S.leads || []).forEach(function (L, i) {
      var lc = CV2['motor_lead' + i];
      if (!lc) return;
      // 旋转中心在【原图】里的位置 → 本地坐标
      var px = (L.at[0] + L.pivot[0] - S.mid[0]) * S.k;
      var py = (L.at[1] + L.pivot[1] - S.mid[1]) * S.k;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(L.deg * Math.PI / 180);
      ctx.drawImage(lc, -L.pivot[0] * S.k, -L.pivot[1] * S.k, L.w * S.k, L.h * S.k);
      ctx.restore();
    });
    ctx.restore();
    Skin.setPosts(comp, ['pos', 'neg'], 1.4, 8);
  }

  // 电池：沙盒的干电池【节数跟着电压走】（1~6 节）。
  // 用户只给了「1 节」「2 节」两张课本图，而且两张的【比例不一样】——
  // 所以 dev-imgskin2.py 拿 2 节那张当模板【拼装】出 1~6 节（battery1..battery6），
  // 底板横向均匀，拼接处看不出来。这里只负责把电压换成节数。
  function batteryKey(comp) {
    var P = (comp && comp.params) || {};
    var per = P.emfPerCell != null ? +P.emfPerCell : 1.5;
    var emf = P.emf != null ? +P.emf : (P.cells != null ? P.cells * per : 3);
    var cells = Math.max(1, Math.min(6, Math.round(emf / per)));
    return 'battery' + cells;
  }
  function drawBattery(ctx, comp, rec, opts, D) {
    if (!drawImg(batteryKey(comp), ctx, comp, rec, opts, D)) return;
    Skin.setPosts(comp, ['pos', 'neg'], 1.4, 8);
  }
  function postsBattery(ctx, comp, s, D) {
    var key = batteryKey(comp), S = G2 && G2[key], cv = CV2[key];
    if (!ready || !S || !cv) { D.drawTerminals(ctx, comp); return; }
    drawPosts(ctx, comp, D, cv, S.posts, S.mid, S.k, S.dpr);
  }

  // ═════════════════════════════════════════════════════════════
  // 发光二极管（人教版图 15.2-3「发光二极管具有单向导电性」）
  // ─────────────────────────────────────────────────────────────
  // 课本那张图上有【两只】管子：左边正向导通（管身发亮 + 一圈放射状光芒）、
  // 右边反向截止（暗管）。两个状态各用一张原图，一个像素都没重画。
  //
  // 三件事和别的元件不一样，都写在下面：
  //   ① 管子是【竖着】的。课本图就是这么画的 —— 管身抬在原点上方，两根引线
  //      垂下来、再向两侧折平，水平段的末端正好落在沙盒的 ±70 端子上。
  //      **端子契约一个字没改**（TERMINALS.led 仍是 ±70、y=0），所以导线、
  //      拖拽、命中、求解全不受影响；变的只是「身体」从横躺变成立着。
  //   ② 素材在生成时已经【左右镜像】过 —— 课本图正极在右，而沙盒 0 号端子
  //      （「+」）在左。不镜像的话画面上的正极引脚接在「−」柱上。
  //   ③ 颜色：课本图只有粉红一种管子，绿管 / 蓝管是把同一张底图【旋转色相】
  //      派生的（形状、高光、渐变一个像素没动）。见 dev-imgskin3.py。
  //
  // 🔴 接线柱走【原版】画法（登记 __posts、由宿主在导线之后补画），不从素材上裁：
  //    课本图的管子底下只有两根引线，没有接线柱 —— 硬从图上裁一块只会在引线
  //    末端贴两个白块。原版的红黑柱照 TERMINALS 落在 ±70 上，正好是引线水平段
  //    的末端，和另外几件人教版器材的柱子也是同一套画法。
  // ============================================================
  function ledKey(comp, on) {
    var col = (comp && comp.params && comp.params.color) || 'red';
    var k = on ? 'ledOn' : 'ledOff';
    return (col === 'green' || col === 'blue') ? (k + '_' + col) : k;
  }
  function drawLed(ctx, comp, rec, opts, D) {
    var on = !!(rec && rec.on);
    var S = G3 && G3[on ? 'ledOn' : 'ledOff'], cv = CV3[ledKey(comp, on)];
    if (!ready3 || !S || !cv) { fallback(D, ctx, comp, rec, opts); return; }

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    pose(ctx, comp, D);

    // ④ 光晕。课本原图上的「亮」是画死的（一整张图），而内核的 brightness
    //    是【连续】的 —— 电池电压从 0 慢慢升上去时，管子应当是渐亮的。
    //    这层随亮度走的径向光就是那个连续量在画面上的落点；压在本体【底下】画，
    //    压在管身上会把管子糊成一片亮斑，看不出「半透明彩色塑料」这件事。
    if (on) {
      var bright = Math.max(0, Math.min((rec && rec.brightness) || 0, 1.3));
      var bg = Math.min(bright, 1.3) / 1.3;
      var rgb = (rec && rec.rgb) || [255, 62, 62];
      var cx = (99 - S.mid[0]) * S.k, cy = (77 - S.mid[1]) * S.k;
      var gr = 48 * (0.82 + 0.55 * bg);
      var g = ctx.createRadialGradient(cx, cy, 2, cx, cy, gr);
      var cc = function (a) {
        return 'rgba(' + Math.round(rgb[0]) + ',' + Math.round(rgb[1]) + ',' +
               Math.round(rgb[2]) + ',' + a.toFixed(3) + ')';
      };
      g.addColorStop(0, cc(0.34 * bg));
      g.addColorStop(0.55, cc(0.13 * bg));
      g.addColorStop(1, cc(0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, gr, 0, TAU); ctx.fill();
    }

    ctx.drawImage(cv, -S.mid[0] * S.k, -S.mid[1] * S.k, S.w / S.dpr, S.h / S.dpr);
    ctx.restore();

    // ⑨ 接线柱：只【登记】规格，不在这里画。柱子是交互点，宿主会在导线之后
    //    再补画一次（见 circuit-skin.js 的铁律 3）—— 和另外几件人教版器材
    //    完全一致，所以「皮肤版元件在图例里没有柱子」这条既有行为也照样成立。
    Skin.setPosts(comp, ['pos', 'neg'], 1.4, 8);
  }

  var api = {
    id: 'renjiao',
    label: '人教版',
    note: '课本原图（直接贴图，未重画）',
    equip: {
      switch: drawSwitch,
      bulb: drawBulb,
      battery: drawBattery,
      resistor: drawStatic('resistor'),
      ammeter: drawMeter('ammeter'),
      voltmeter: drawMeter('voltmeter'),
      rheostat: drawRheostat('rheostat'),
      motor: drawMotor,
      led: drawLed,
    },
    // 🔴 皮肤自己的接线柱表（局部坐标）。wrap 的 terminalWorld 认它，
    //    没列的类型走原版 —— 原版的 ±70 / ±78 一个字节没动。
    terminals: TERMS,
    // 命中框 / 选中框（局部坐标，可非对称）。没列的类型走编辑器那张 BODY 表。
    hitBox: {
      switch: function () { return BOX.switch || null; },
      bulb: function () { return BOX.bulb || null; },
      resistor: function () { return BOX.resistor || null; },
      rheostat: function () { return BOX.rheostat || null; },
      ammeter: function () { return BOX.ammeter || null; },
      voltmeter: function () { return BOX.voltmeter || null; },
      motor: function () { return BOX.motor || null; },
      // 电池按【节数】换框：1 节和 6 节的宽高差一倍多
      battery: function (comp) { return BOX[batteryKey(comp)] || null; },
    },
    posts: {
      switch: function (ctx, comp, s, D) {
        if (!ready) { D.drawTerminals(ctx, comp); return; }   // 回落给原版
        // 从【整张原图】上裁那一小块：柱子在哪张画上都一样，用整图省一份素材
        drawPosts(ctx, comp, D, SWC.full, SW.posts, SW.mid, SW.k);
      },
      bulb: function (ctx, comp, s, D) {
        if (!ready) { D.drawTerminals(ctx, comp); return; }
        drawPosts(ctx, comp, D, BLC.full, BL.posts, BL.mid, BL.k);
      },
      battery: postsBattery,
      resistor: postsFor('resistor'),
      ammeter: postsFor('ammeter'),
      voltmeter: postsFor('voltmeter'),
      rheostat: postsFor('rheostat'),
      // 🔴 电动机【必须】给一个 posts 实现（哪怕是空的）：wrap 的 drawTerminals
      //    在没有这一项时会回落到【原版】画法，而原版画的是 ±70 那对红黑柱 ——
      //    皮肤的柱在左下角引线上，于是导线接在引线上、柱却画在机身两侧。
      //    电动机的「柱」就是引线本身，没有额外的柱块要补画。
      motor: function () {},
    },
    // 符号层留空：人教版电路图符号 = 现行实现（沙盒那张电路图本来就是照人教版画的）
    symbol: {},
    // 外形包络（非对称，比原版大一圈）：给验收卡「画出来的像素有没有跑出去」
    // LED 是【竖着】的：管身顶在 −180、两根引线折平后落在 ±70 / y≈+5。
    // 表头那一项是【缩小之后】的（METER_SCALE = 0.62）。
    envelope: {
      switch: { x0: -122, x1: 86, y0: -73, y1: 42 },
      bulb: { x0: -88, x1: 86, y0: -83, y1: 42 },
      led: { x0: -78, x1: 80, y0: -184, y1: 10 },
      resistor: { x0: -94, x1: 94, y0: -8, y1: 46 },
      rheostat: { x0: -121, x1: 119, y0: -36, y1: 75 },
      ammeter: { x0: -79, x1: 74, y0: -100, y1: 101 },
      voltmeter: { x0: -75, x1: 73, y0: -95, y1: 100 },
      motor: { x0: -116, x1: 99, y0: -71, y1: 59 },
    },
    // 元件栏（沙盒 LG_VIEW）的取景框：不换的话图例里手柄会被裁掉两头
    view: {
      switch: { x0: -126, y0: -77, x1: 90, y1: 46 },
      bulb: { x0: -92, y0: -87, x1: 90, y1: 46 },
      // 🔴 沙盒默认的 LG_VIEW.led（−78,−52 → 78,36）是给【横躺】的原版管子
      //    定的；人教版的管子立着、高 184，照默认框裁会把管子从中间截断。
      led: { x0: -82, y0: -188, x1: 82, y1: 16 },
      // 这几件的框都按【脚本量出来的实际墨迹】给（见 dev-imgskin2.py 的 alpha_box）。
      // 表头缩小之后，原版那两个框（±102 / −92…82）会留一大圈空白。
      resistor: { x0: -100, y0: -14, x1: 100, y1: 52 },
      battery: { x0: -92, y0: -52, x1: 90, y1: 32 },
      ammeter: { x0: -85, y0: -106, x1: 80, y1: 107 },
      voltmeter: { x0: -81, y0: -101, x1: 79, y1: 106 },
      rheostat: { x0: -126, y0: -42, x1: 125, y1: 81 },
      motor: { x0: -122, y0: -77, x1: 105, y1: 65 },
    },
    bodyBox: {},
    // ── 放大镜 / 表盘命中（都在元件自身坐标系）──────────────────────
    // 调零螺丝的位置。🔴 原版 D.MET.ZERO 是 (0, 26)：课本表缩小到 0.62 之后，
    // 照原版画那个琥珀圈就落在网纹块【下面】的浅蓝底板上（用户报的「偏下」）。
    // 数值由 dev-imgskin2.py 按原图里那个深色小圆实测后写进数据。
    zeroKnobOf: function (comp) {
      var S = (ready && comp && G2) ? G2[comp.type] : null;
      return (S && S.zero) ? S.zero : null;
    },
    // 表盘的命中框（点这儿开放大镜）。原版写死 ±96 / −88…46，是给原版那块
    // 192 宽的表定的；课本表缩到 152 宽之后，照原版会把表外面一大圈也算成表盘。
    dialBoxOf: function (comp) {
      if (!ready || !comp) return null;
      return (comp.type === 'voltmeter')
        ? { x0: -72, y0: -95, x1: 70, y1: 28 }
        : { x0: -76, y0: -100, x1: 72, y1: 28 };
    },
    // 元件名称标签该落在哪儿 —— 覆盖沙盒写死的 DROP。    // 🔴 课本表头那张图往下伸到 y≈167（本地），而沙盒的 DROP.ammeter 是 80 ⇒
    //    标签正好压在量程柱的「0.6 / 3」上。数值由 dev-imgskin2.py 按【素材墨迹的
    //    实际下沿】算出来，不是拍的。
    tagDropOf: function (comp) {
      if (!comp) return null;
      // LED 的引线折平在 y≈+5，标签紧贴着它落（沙盒的 DROP.led=38 是按原版
      // 那块示教底板的底边定的，套到立着的管子上会飘出一大截）。
      if (comp.type === 'led') return ready3 ? 14 : null;
      if (!ready) return null;
      var key = comp.type === 'battery' ? batteryKey(comp) : comp.type;
      var S = G2 && G2[key];
      return (S && S.tagDrop != null) ? S.tagDrop : null;
    },
    // 给自检用的只读口子
    __isReady: function () { return ready; },
    __isReady3: function () { return ready3; },
    __ledGeom: function () {
      return (G3 && G3.ledOff) ? { k: G3.ledOff.k, mid: G3.ledOff.mid,
                                   dpr: G3.ledOff.dpr, w: G3.ledOff.w, h: G3.ledOff.h } : null;
    },
    __geom: function () {
      return {
        sw: { k: SW.k, mid: SW.mid, pivotImg: SW.pivotImg, bladeAt: SW.bladeAt, openDeg: SW.openDeg },
        bl: { k: BL.k, mid: BL.mid, glassAt: BL.glassAt, glassC: BL.glassC, glassR: BL.glassR },
        v2: (function () {
          var o = {};
          KEYS2.forEach(function (key) {
            var S = G2[key];
            o[key] = { k: S.k, mid: S.mid, dpr: S.dpr, w: S.w, h: S.h };
          });
          return o;
        })(),
      };
    },
  };
  return api;
});
