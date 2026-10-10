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
    });
    ready = true;
    try { window.dispatchEvent(new Event('circuit-skin-ready')); } catch (e) {}
  }

  loadAll([
    { key: 'swFull', src: SW.full },
    { key: 'swChassis', src: SW.chassis },
    { key: 'swBlade', src: SW.blade },
    { key: 'blFull', src: BL.full },
    { key: 'blBase', src: BL.base },
  ], function () {
    // 第二批是【另一张表】，单独加载、单独回调；两边都到齐才 ready。
    if (!G2) { build(); return; }
    loadAll(KEYS2.map(function (key) {
      return { key: key, src: G2[key].full };
    }), build, IMG2);
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
    for (var i = 0; i < rects.length && i < 2; i++) {
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

  // 电池：沙盒的干电池【节数跟着电压走】（1~6 节）。手上只有 1 节和 2 节两张
  // 课本图，所以 ≥2 节一律用 2 节那张 —— 节数照旧由沙盒的读数标签写清楚
  // （「1.5V × N」），只是画面不跟着长。🔴 这是素材的硬限制，不是漏做。
  function batteryKey(comp) {
    var P = (comp && comp.params) || {};
    var per = P.emfPerCell != null ? +P.emfPerCell : 1.5;
    var emf = P.emf != null ? +P.emf : (P.cells != null ? P.cells * per : 3);
    var cells = Math.max(1, Math.min(6, Math.round(emf / per)));
    return cells >= 2 ? 'battery2' : 'battery';
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

  var api = {
    id: 'renjiao',
    label: '人教版',
    note: '课本原图（直接贴图，未重画）',
    equip: {
      switch: drawSwitch,
      bulb: drawBulb,
      battery: drawBattery,
      resistor: drawStatic('resistor'),
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
    },
    // 符号层留空：人教版电路图符号 = 现行实现（沙盒那张电路图本来就是照人教版画的）
    symbol: {},
    // 外形包络（非对称，比原版大一圈）：给验收卡「画出来的像素有没有跑出去」
    envelope: {
      switch: { x0: -122, x1: 86, y0: -73, y1: 42 },
      bulb: { x0: -88, x1: 86, y0: -83, y1: 42 },
    },
    // 元件栏（沙盒 LG_VIEW）的取景框：不换的话图例里手柄会被裁掉两头
    view: {
      switch: { x0: -126, y0: -77, x1: 90, y1: 46 },
      bulb: { x0: -92, y0: -87, x1: 90, y1: 46 },
    },
    bodyBox: {},
    // 给自检用的只读口子
    __isReady: function () { return ready; },
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
