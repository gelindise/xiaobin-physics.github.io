/*!
 * circuit-draw.js — 电学元件程序化矢量绘制
 *
 * 纯绘制，零物理计算（读数由 circuit-core.js 传入）。
 * 目标是 NOBOOK 那样的「半写实 2D 器材示意图」，不是抽象电路符号。
 *
 * ── 统一规范（新增元件必须遵守，否则又会变成风格大杂烩）──────────
 *   1. 所有两端元件端子固定在局部坐标 (±HALF, 0)，保证导线落在统一网格上
 *   2. 元件尺寸都用同一套基础单位，不许某个元件比别人大 10 倍
 *   3. 材质只有四种：金属 / 胶木陶瓷 / 塑料 / 玻璃，颜色一律从 PALETTE 取
 *   4. 接线柱一律走 drawBindingPost()，红=正、黑=负
 *   5. 阴影一律走 softShadow()，光源统一在左上方
 *
 * ── 极性铁律 ─────────────────────────────────────────────
 *   端子 0 画在哪一头，由 TERMINALS 拍板，并且全站统一。分两种元件：
 *
 *   (1) 两端极性元件：电源的端子 0 是「+」，画在【右端】。
 *       一个矩形回路里，电源正极的线往右出去，电流绕一圈回来必然从右边进、
 *       左边出地穿过顶排的元件。把「+」画在右边，红柱子才是电流【流进去】
 *       的那一头；画反了红柱子就成了电流流出的一端。
 *
 *   (2) 三柱表头（电流表 / 电压表，人教版实物）：端子 0 是「−」柱，画在
 *       【最左】；1、2 号是两个量程柱，序号越大越靠右、量程越大。三根柱子
 *       一起钉在底座下方的 POST_Y 上（外侧两根仍占 ±HALF 的网格位）。
 *       读数方向仍是「电流从量程柱流进、从「−」柱流出为正」——core 里
 *       rec.i 的含义没变，只是「+」那一头换成了当前接了线的量程柱。
 *
 *   (3) 四柱滑动变阻器（人教版图16.4-2）：编号照【实物位置】——
 *       端子 0/1 = A/B = 【下面】两个柱 = 电阻丝两端；
 *       端子 2/3 = C/D = 【上面】两个柱 = 金属杆两端（内部短接成滑片节点）。
 *       于是「接 A、B」= 整根电阻丝接入（R = Rmax，滑片不起作用）、
 *       「接 C、D」= 只有金属杆（R = 0，等于一根导线），两条经典错接法的结论
 *       正好相反，编号错了就是把两个考点一起教反。它没有极性，红柱只代表
 *       「出厂接在电阻丝上」，语义由字母承担。
 *
 *   两处必须同时对上，任何一处画反画面就自相矛盾：
 *     1. TERMINALS 的坐标
 *     2. posts() 传入的 kinds —— kinds[i] 对应【端子序号】，不是左右顺序：
 *        电源 ['pos','neg']，表头 ['neg','pos','pos']，
 *        变阻器 ['pos','pos','neutral','neutral']
 *
 * ── 对外导出面（别的页面要摆同一批器材时，只许从这里取）────────────
 *   几何：HALF / TERMINALS / terminalWorld / bodyBox / batterySize / PLATE / RHEO
 *   材质：PALETTE（四材质的代表色）/ MAT（同一套渐变 stop，立体件打光用）
 *   表头：MET / MET_SWEEP（指针扫角 —— 页面要【自己算】指针角度就必须用它，
 *         另写一个扫角等于把同一只表画成两个读数）
 *   接线柱：drawBindingPost / POST_GRAD（柱身的横向渐变，3D 柱面着色用同一组色）
 *   绘制：drawComponent（元件外形）/ drawWire
 *   —— 3D 页面把 drawComponent 画进离屏 canvas 当【前脸贴图】，侧面/顶面用 MAT
 *      打光，接线柱用 POST_GRAD 上色：三处同源，两个页面上的电流表才是同一只表。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CircuitDraw = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var HALF = 70;   // 两端元件端子的半间距（全局统一，改这里等于整体缩放）

  var PALETTE = {
    bench: '#eef2f7',
    grid: '#e0e7ef',
    wire: '#8496ab',
    wireDim: '#b3c0cf',
    // 并联电路的【干路】导线色。挑这个蓝的理由是「和画面上已有的三种颜色都
    // 分得开」：支路是灰蓝 #8496ab（彩度低、发灰）、电流箭头是正红 #dc2626、
    // 电子小球是琥珀 #f59e0b。课本里干路也常印成另一种颜色，学生一眼就能顺着
    // 它从电源摸到分支点。别改成红色系 —— 那会和电流箭头糊在一起。
    mainWire: '#2563eb',
    flow: '#f59e0b',         // 自由电子小球（画布上跑的小球，琥珀色）
    current: '#dc2626',      // 电流方向箭头（和电子反向跑，正红）
    metalHi: '#eef3f8',
    metal: '#b9c6d3',
    metalLo: '#8496a8',
    metalDark: '#5b6c7d',
    copperHi: '#e8b183',
    copper: '#bc7833',
    copperLo: '#8c5624',
    bakeliteHi: '#7a6150',
    bakelite: '#57422f',
    bakeliteLo: '#33261b',
    ceramicHi: '#fdfaf2',
    ceramic: '#ece3cc',
    ceramicLo: '#cdc0a2',
    plasticHi: '#68788c',
    plastic: '#465366',
    plasticLo: '#2b3543',
    dial: '#f9fbfd',
    dialLo: '#dee6ed',
    needle: '#dc2626',
    positive: '#dc2626',
    negative: '#1e293b',
    text: '#334155',
    textDim: '#8b9aab',
    accent: '#ea580c',
  };

  var BAND_COLORS = ['#1a1a1a', '#6b4423', '#d02b2b', '#e2691a', '#e8b71a',
    '#1f8a3c', '#2563eb', '#7c3aed', '#9ca3af', '#f8fafc'];
  var MULT_NEG = { '-2': '#c0c0c0', '-1': '#c9a227' };

  // ============================================================
  // 基础工具
  // ============================================================
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function linGrad(ctx, x0, y0, x1, y1, stops) {
    var g = ctx.createLinearGradient(x0, y0, x1, y1);
    for (var i = 0; i < stops.length; i++) {
      // 色标写错（漏了偏移量、把颜色怼到第一位）时，Canvas 只抛
      // 「non-finite double」——看不出是哪个元件哪一行，只能挨个猜。
      // 这里直接把坏掉的那个色标报出来。
      if (stops[i].length !== 2 || !Number.isFinite(stops[i][0]) || typeof stops[i][1] !== 'string') {
        throw new Error('linGrad 色标 #' + i + ' 格式错误（应为 [偏移, 颜色]）: ' + JSON.stringify(stops[i]));
      }
      g.addColorStop(stops[i][0], stops[i][1]);
    }
    return g;
  }

  function softShadow(ctx, x, y, w, h, blur, r) {
    ctx.save();
    ctx.shadowColor = 'rgba(15,23,42,0.20)';
    ctx.shadowBlur = blur == null ? 12 : blur;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = '#fff';
    roundRect(ctx, x, y, w, h, r == null ? 8 : r);
    ctx.fill();
    ctx.restore();
  }

  function glassHighlight(ctx, x, y, w, h) {
    ctx.save();
    var g = linGrad(ctx, x, y, x + w * 0.8, y + h, [
      [0, 'rgba(255,255,255,0.9)'], [0.4, 'rgba(255,255,255,0.2)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - w * 0.15, y + h);
    ctx.lineTo(x + w * 0.42, y - h * 0.15);
    ctx.lineTo(x + w * 0.68, y - h * 0.15);
    ctx.lineTo(x + w * 0.11, y + h);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // ============================================================
  // 材质工具箱
  // ------------------------------------------------------------
  // 「像实物」不是把颜色调深一档，而是让每个面都有【来历】：
  //   · 金属（横向柱面）= 竖向渐变 + 一道窄而亮的高光 + 下沿的环境光遮蔽
  //   · 金属（立板/底板）= 横向渐变 + 棱上的倒角亮边 + 板底的暗边
  //   · 塑料 = 柔和渐变 + 倒角亮边 + 分模线，绝不用金属那种硬高光
  //   · 陶瓷 = 近白 + 釉面高光 + 极淡的斑驳，边缘略暗（釉层在棱上积厚）
  //   · 玻璃 = 边缘聚暗 + 两道斜反光，下半圈让给金属箍
  // 所有元件都从这里取材质，别各自写一套 —— 这是「风格不散」的唯一办法。
  //
  // 高光位置统一在竖向 0.30 处、锐利的一条：全站光源在【左上方】。
  // 同一个元件里出现两条不同朝向的高光，眼睛立刻读成「两块不同的材料」。
  // ============================================================
  var MAT = {
    // 钢材：立板、刀片、底板、支架
    steel: [[0, '#7d8b9b'], [0.14, '#b6c2cf'], [0.30, '#f6f9fc'], [0.48, '#cfd9e3'],
            [0.74, '#98a6b5'], [1, '#6e7d8d']],
    // 镀铬：金属杆、螺口、销轴 —— 对比更狠、高光更窄
    chrome: [[0, '#63748a'], [0.10, '#aab9c9'], [0.26, '#ffffff'], [0.40, '#e8eff6'],
             [0.62, '#b0bdcc'], [0.84, '#7f8fa1'], [1, '#5f7086']],
    // 黄铜：干电池铜帽、开关转轴销、变阻器压接螺钉
    brass: [[0, '#5f4310'], [0.16, '#a8832f'], [0.32, '#e3c473'], [0.46, '#fbf0c0'],
            [0.62, '#d3ac52'], [0.84, '#96702a'], [1, '#5c4010']],
    // 锌：干电池的负极筒身，比钢更哑、偏冷
    zinc: [[0, '#77828f'], [0.20, '#b8c2cd'], [0.38, '#e4eaf0'], [0.58, '#c3ccd6'],
           [0.82, '#939eab'], [1, '#6b7784']],
    // 浅灰注塑件：电池盒、底板、表壳
    plastic: [[0, '#eef2f7'], [0.30, '#dbe2ea'], [0.62, '#c6d0dc'], [0.86, '#aeb9c7'],
              [1, '#98a4b3']],
    // 白色釉瓷：瓷灯座、变阻器瓷管
    porcelain: [[0, '#ded9cc'], [0.10, '#f7f4ea'], [0.26, '#ffffff'], [0.50, '#f4f4ef'],
                [0.74, '#e0e0d8'], [1, '#bcb9ae']],
  };
  // 把一张 stops 表按方向铺到矩形上（'v' 竖向 = 柱面，'h' 横向 = 平面）
  function fillMat(ctx, x, y, w, h, r, stops, dir) {
    var g = (dir === 'h')
      ? linGrad(ctx, x, y, x + w, y, stops)
      : linGrad(ctx, x, y, x, y + h, stops);
    ctx.fillStyle = g;
    if (r == null) { ctx.fillRect(x, y, w, h); return; }
    roundRect(ctx, x, y, w, h, r); ctx.fill();
  }

  // 当前上下文的有效缩放（含 DPR、页面缩放、放大镜倍数）。
  // 1 个像素以下的东西（螺钉槽、滚花、铭牌小字）缩略图上只会糊成一坨脏点，
  // 所以细节按缩放分级：图例那种 0.6 倍的小图标只画粗结构，放大镜里
  // （最高 3.4×DPR）才把细节全抖出来 —— 「高清晰」的正确做法是随缩放加细节，
  // 而不是把小字画上去再让它糊。
  function ctxScale(ctx) {
    try {
      if (ctx.getTransform) {
        var m = ctx.getTransform();
        var s = Math.hypot(m.a, m.b);
        if (isFinite(s) && s > 0.01) return s;
      }
    } catch (e) { /* 某些离屏上下文没有 getTransform，按 1 算 */ }
    return 1;
  }

  // 接触阴影：物体压在台面上的那一片。比投影（softShadow）小、深、贴边，
  // 两者叠起来才有「离开台面一点点」的立体感。alpha 一律压到 0.3 以下：
  // 测试按 alpha > 200 判「不透明像素」，阴影不该被算进物体的轮廓里。
  function contactShadow(ctx, cx, cy, rx, ry, a) {
    var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
    g.addColorStop(0, 'rgba(15,23,42,' + (a == null ? 0.26 : a) + ')');
    g.addColorStop(0.55, 'rgba(15,23,42,' + (a == null ? 0.26 : a) * 0.55 + ')');
    g.addColorStop(1, 'rgba(15,23,42,0)');
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(1, ry / Math.max(rx, ry)); ctx.translate(-cx, -cy);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, Math.max(rx, ry), 0, 6.284); ctx.fill();
    ctx.restore();
  }

  // 滚花：沿 x 排一列细竖线，只在中段画（两端留出倒角），模拟搓花螺母的齿。
  // 只在够大的时候画 —— 1px 宽的齿在缩略图里就是一条灰带，不如不画。
  function knurl(ctx, x, y, w, h, sc, color) {
    if (sc < 0.9) return;
    var step = Math.max(1.8, w / 14);
    ctx.save();
    ctx.strokeStyle = color || 'rgba(40,52,68,0.34)';
    ctx.lineWidth = Math.max(0.5, Math.min(1, sc * 0.5));
    ctx.beginPath();
    for (var q = x + step * 0.6; q < x + w - step * 0.3; q += step) {
      ctx.moveTo(q, y + h * 0.16); ctx.lineTo(q, y + h * 0.84);
    }
    ctx.stroke();
    ctx.restore();
  }

  // 螺钉头。kind：'slot' 一字槽 / 'cross' 十字槽 / 'hex' 内六角。
  // 画法：外圈亮边（倒角）+ 盘面斜渐变 + 槽口暗线 + 槽口对面的受光棱。
  function screwHead(ctx, cx, cy, r, kind, sc) {
    var g = linGrad(ctx, cx - r, cy - r, cx + r * 0.6, cy + r,
      [[0, '#ffffff'], [0.35, '#cdd7e1'], [0.72, '#93a2b2'], [1, '#6e7d8d']]);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.284); ctx.fill();
    ctx.strokeStyle = 'rgba(51,65,85,0.5)'; ctx.lineWidth = Math.max(0.6, r * 0.14);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.284); ctx.stroke();
    // 槽底压暗，槽的另一侧补一条亮线 —— 只有「一暗一亮」才像凹进去的槽
    ctx.strokeStyle = 'rgba(30,41,59,0.62)';
    ctx.lineWidth = Math.max(0.8, r * 0.26);
    ctx.beginPath();
    if (kind === 'cross') {
      ctx.moveTo(cx - r * 0.58, cy); ctx.lineTo(cx + r * 0.58, cy);
      ctx.moveTo(cx, cy - r * 0.58); ctx.lineTo(cx, cy + r * 0.58);
    } else if (kind === 'hex') {
      for (var k = 0; k < 6; k++) {
        var a = -Math.PI / 2 + k * Math.PI / 3;
        ctx.moveTo(cx + Math.cos(a) * r * 0.52, cy + Math.sin(a) * r * 0.52);
        ctx.lineTo(cx + Math.cos(a + 2.094) * r * 0.52, cy + Math.sin(a + 2.094) * r * 0.52);
      }
    } else {
      ctx.moveTo(cx - r * 0.62, cy + r * 0.16); ctx.lineTo(cx + r * 0.62, cy - r * 0.16);
    }
    ctx.stroke();
    if (sc >= 1.2) {                       // 槽口下沿的一道反光
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = Math.max(0.5, r * 0.12);
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.55, cy + r * 0.42); ctx.lineTo(cx + r * 0.55, cy + r * 0.20);
      ctx.stroke();
    }
  }

  // 「对调极性」时元件本体走 ctx.scale(-1, 1) 镜像，丝印文字必须再镜回来，
  // 否则字是反的（电池身上的「1.5V」会印成一串镜像字）。
  //
  // 判据取【当前变换矩阵的行列式】而不是一个全局开关：镜像可能发生在任意
  // 一层 ctx.save() 里（本体一层、烧毁标记又一层），靠标志位传递迟早漏一处。
  // a·d − b·c < 0 就是「含奇数个反射」的充要条件。
  // 反镜像的做法：绕文字自身的锚点 x 再镜一次（两次镜像 = 平移 + 旋转），
  // 于是字正立、位置不变。
  function unmirrorText(ctx, x) {
    try {
      if (!ctx.getTransform) return;
      var m = ctx.getTransform();
      if (m.a * m.d - m.b * m.c >= 0) return;      // 没镜像，什么都不做
      ctx.translate(x, 0); ctx.scale(-1, 1); ctx.translate(-x, 0);
    } catch (e) { /* 某些离屏上下文没有 getTransform，按没镜像处理 */ }
  }

  // 丝印 / 铭牌文字。压在浅色塑料上要深色，压在深色上要浅色 —— 由调用方给。
  // 一律先描一圈反色垫底：不加垫底的细字压在同色系底上会糊掉（电池盒上
  // 那几个「1.5V」以前就是这样，远看是一块脏）。
  function silk(ctx, text, x, y, px, color, halo) {
    ctx.save();
    unmirrorText(ctx, x);
    ctx.font = 'bold ' + px + 'px -apple-system,"PingFang SC","Helvetica Neue",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    if (halo !== false) {
      ctx.lineWidth = Math.max(1.6, px * 0.34);
      ctx.strokeStyle = halo || 'rgba(255,255,255,0.72)';
      ctx.strokeText(text, x, y);
    }
    ctx.fillStyle = color || '#334155';
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  // 密绕线圈：底上一整片金属色（竖向渐变 = 圆柱光照），再压上一圈圈【斜的暗缝】
  // —— 缝就是圈与圈之间的沟。上一版是每圈画一根竖线、逐圈换颜色，那读出来是
  // 「栅栏」：相邻两圈一亮一暗，眼睛看到的是 60 根独立的棒，不是一根绕上去的丝。
  // 正确的读法来自「亮的是丝、暗的是缝」，而且缝要细、要密，远看糊成一片金属，
  // 凑近才看得出圈数 —— 真变阻器就是这个观感。
  // 一圈丝的斜度（局部单位）。coil() 画丝、drawRheostatFlow 铺电流都要它 ——
  // 抽成一份，两处不可能漂移；「斜度 = 螺距的方向感」这个比例也只写一遍。
  function coilSkew(step, yTop, yBot) {
    return Math.min(step * 1.9, (yBot - yTop) * 0.42);
  }
  function coil(ctx, x0, x1, yTop, yBot, turns, stops, sc) {
    if (x1 - x0 < 0.5) return;
    var n = Math.max(2, Math.round(turns));
    var step = (x1 - x0) / n;
    var skew = coilSkew(step, yTop, yBot);                   // 斜度 = 螺距的方向感
    ctx.save();
    ctx.beginPath(); ctx.rect(x0 - 0.5, yTop, (x1 - x0) + 1, yBot - yTop); ctx.clip();
    // ① 丝的底色：整片铺满，竖向渐变给出圆柱的明暗
    ctx.fillStyle = linGrad(ctx, 0, yTop, 0, yBot, stops);
    ctx.fillRect(x0 - 0.5, yTop, (x1 - x0) + 1, yBot - yTop);
    // ② 圈与圈之间的沟：细、斜、压暗
    ctx.lineCap = 'butt';
    ctx.lineWidth = Math.max(0.55, Math.min(step * 0.34, 1.6));
    ctx.strokeStyle = 'rgba(48,28,8,0.50)';
    ctx.beginPath();
    for (var i = 0; i <= n; i++) {
      var x = x0 + i * step;
      ctx.moveTo(x - skew * 0.5, yTop);
      ctx.lineTo(x + skew * 0.5, yBot);
    }
    ctx.stroke();
    // ③ 每一圈丝的受光边（缝的右侧）：有暗缝、有亮边，才是一根根【圆丝】
    if (sc >= 1.15 && step >= 1.5) {
      ctx.lineWidth = Math.max(0.4, Math.min(step * 0.20, 0.9));
      ctx.strokeStyle = 'rgba(255,238,206,0.42)';
      ctx.beginPath();
      for (var j = 0; j <= n; j++) {
        var x2 = x0 + (j + 0.42) * step;
        ctx.moveTo(x2 - skew * 0.5, yTop);
        ctx.lineTo(x2 + skew * 0.5, yBot);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // 玻璃壳：边缘聚暗 + 两道斜反光 + 底部与金属的密封过渡。
  // 只画反光不画边缘聚暗，玻璃会读成一块白色贴纸 —— 真玻璃的「边」是暗的。
  function glassShell(ctx, cx, cy, r, o) {
    o = o || {};
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.284); ctx.clip();
    // 边缘聚暗（径向）
    var rim = ctx.createRadialGradient(cx, cy, r * 0.45, cx, cy, r);
    rim.addColorStop(0, 'rgba(148,163,184,0)');
    rim.addColorStop(0.78, 'rgba(120,138,158,' + (0.10 * (o.rim == null ? 1 : o.rim)) + ')');
    rim.addColorStop(1, 'rgba(86,104,124,' + (0.30 * (o.rim == null ? 1 : o.rim)) + ')');
    ctx.fillStyle = rim;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.284); ctx.fill();
    // 主反光：一条宽的斜带（左上）
    ctx.globalAlpha = o.hi == null ? 0.6 : o.hi;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.74, cy + r * 1.02);
    ctx.lineTo(cx - r * 0.16, cy - r * 1.06);
    ctx.lineTo(cx + r * 0.10, cy - r * 1.06);
    ctx.lineTo(cx - r * 0.44, cy + r * 1.02);
    ctx.closePath(); ctx.fill();
    // 次反光：右下一小片（玻璃的另一侧反射，缺了它玻璃是一层薄片）
    ctx.globalAlpha = (o.hi == null ? 0.6 : o.hi) * 0.42;
    ctx.beginPath();
    ctx.moveTo(cx + r * 0.34, cy + r * 1.02);
    ctx.lineTo(cx + r * 0.70, cy + r * 0.22);
    ctx.lineTo(cx + r * 0.86, cy + r * 0.30);
    ctx.lineTo(cx + r * 0.52, cy + r * 1.02);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ============================================================
  // 表头几何（电流表 / 电压表共用，照人教版学生电表 J0407 的外形）
  // ------------------------------------------------------------
  // 这台仪器是「歪」的：表壳在上、底座在下、接线柱从底座底下探出来，
  // 导线夹在柱子上。所以端子锚点（POST_Y）在仪器重心的下方，而仪器本体
  // 全部落在导线【上方】—— 这样导线永远不会从表壳或底座中间穿过去。
  // 绘制和 bodyBox 都从这里取数，别再各写一份。
  // ============================================================
  // 尺寸是「两排数字 + 中央字母 + 弧形刻度」挤出来的：内圈数字在 ±20°
  // 处离竖直只有 0.34r 的横向偏移，r 不够大时它们会挤到中线上，把「A」
  // 压掉。要对上教材的排布，弧半径得 60 上下，表盘就得 150 宽。
  // 🔴 2026-10-16 用户第 3 点「表盘和刻度再放大一些，现在太小了」：
  //    整台表按【只往上长】的办法放大 —— 表壳上沿 −86 → −104、表盘
  //    152×106 → 180×126、刻度半径 50/62 → 58/74、两排数字半径跟着放。
  //    下沿（CASE_BOT 42 / BASE_TOP 42 / BASE_BOT 60 / POST_Y 72）【一个数都没动】：
  //      ① 三个接线柱钉在 POST_Y 上，导线行高 = 元件 y + 72 这条约定是全站
  //         （预设、拖放、走线避让）共用的，动了它三套预设的竖直排布全要重排；
  //      ② 本体仍然整个落在导线【上方】，导线不会从表壳中间穿过去。
  //    所以「放大」在这台仪器上就等于「往上长」——表壳变得更高、更宽，底座不动。
  var MET = {
    CASE_HW: 106, CASE_TOP: -104, CASE_BOT: 42,     // 表壳（浅色胶木，上沿大圆角）
    // 表盘比上一版又高又宽：大量程的数字要挪到刻度弧【外面】（真表就是这个排布），
    // 弧的半径一动，两排数字就全挤到「A」字上——所以是往上长表壳，不是缩弧。
    DIAL: { x: -90, y: -90, w: 180, h: 126 },       // 白色表盘
    PIVOT: { x: 0, y: 10 },                         // 指针转轴
    RT0: 58, RT1: 74,                               // 刻度线内 / 外半径
    // 刻度的两排数字：大量程在弧线【外】（表盘上方），小量程在弧线【内】。
    // 真表（J0407）就是这么印的：读数先看零刻度在哪一排，两排一上一下不会看串。
    // 上一版两排都塞在弧线里面，大数字只是半径大一点，和「上面 / 下面」不是一回事。
    RN_HI: 88, RN_LO: 45,                           // 弧外（大量程）/ 弧内（小量程）数字半径
    BLOCK: { top: 4, bot: 36, hwT: 26, hwB: 38 },   // 底部网纹块（梯形）
    ZERO: { x: 0, y: 27, r: 7 },                    // 调零螺丝
    BASE_HW: 116, BASE_TOP: 42, BASE_BOT: 60,       // 底座（比表壳宽一圈）
    POST_Y: 72,                                     // 三柱锚点（= TERMINALS 的 y）
    // 未调零时指针偏离零位的量（占整个扫角的比例）。0.045 × 120° ≈ 5.4°，
    // 在刻度弧上是 4~5 个像素 —— 小到不挡读数，大到一眼看得出「针没停在零上」。
    // 方向固定【向右】：向左会落进「反接打表」那一小格（frac −0.085），
    // 学生就分不清「表没调零」和「表接反了」了。
    ZERO_OFF: 0.045,
  };
  // 指针扫角：−150° → −30°，绕正上方左右各 60°（教材表的弧线就这一段）
  var MET_SWEEP = { A0: -Math.PI * 5 / 6, A1: -Math.PI / 6 };

  // ============================================================
  // 表头【大读数牌】的几何（用户第 1 点：读数要显著地显示在整台表正上方）
  // ------------------------------------------------------------
  // 牌子挂在表壳上沿再往上 GAP 处，宽按字宽撑开、最小 MINW，高 H。
  // ⚠️ 它由【页面】在导线之后画（理由见 drawMeter 里那段注释：导线压在元件
  //    之上，留在绘制层画会被从表上方经过的那根线横切）。所以这一份几何必须
  //    绘制层和页面共用 —— 各写一份的话，牌子迟早压到表壳上或者飘到天上去。
  // ============================================================
  var METER_READOUT = {
    GAP: 12, H: 40, MINW: 132, PADX: 30, TOP_MIN: 3,
    FONT: 'bold 26px ui-monospace,Menlo,Consolas,monospace',
    BG: 'rgba(15,23,42,0.94)', BORDER: 'rgba(125,211,252,0.75)', FG: '#7dd3fc',
  };
  // 一块读数牌的落点（元件自身坐标系，不随 rot 转）。返回 {x,y,w,h}，
  // x/y 是左上角。cx 传元件的世界 x，用来把牌子夹在画布内（TOP_MIN）。
  function meterReadoutBox(cx, cy, text, ctx2) {
    var R = METER_READOUT;
    var w = R.MINW, h = R.H;
    if (ctx2 && text) {
      ctx2.save();
      ctx2.font = R.FONT;
      w = Math.max(R.MINW, ctx2.measureText(text).width + R.PADX);
      ctx2.restore();
    }
    var y = MET.CASE_TOP - R.GAP - h;
    if (cy + y < R.TOP_MIN) y = R.TOP_MIN - cy;      // 表贴到画布顶边时别整块飘出去
    return { x: cx - w / 2, y: cy + y, w: w, h: h };
  }

  // ============================================================
  // 端子坐标
  // ============================================================
  var TERMINALS = {
    resistor: [{ x: -HALF, y: 0 }, { x: HALF, y: 0 }],
    // 导体板：两个接线柱钉在板子两端，和定值电阻同一套坐标（±HALF）。
    // 「长度」不挪柱子 —— 柱子是接线的地方，金属条长短是材料/尺寸的事，
    // 两件事各画各的（3D 里板长随 length 变，柱子始终在板沿上）。
    plate: [{ x: -HALF, y: 0 }, { x: HALF, y: 0 }],
    battery: [{ x: HALF, y: 0 }, { x: -HALF, y: 0 }],   // 0 = 正极（右）
    // 学生电源：全站【唯一】一件端子不在 ±70 上的元件 —— 照课本实物，
    // 两个接线柱都长在面板右下角（0 号 = 正极，是左边那个）。
    // 这和干电池的摆法不一样是有意的：两者极性语义相同（电流从正极流出），
    // 但实物长相不同，柱子位置当然也不同。
    // 坐标是【量那幅课本图】量出来的：两个柱子相对面板宽度在 0.66 / 0.85 处、
    // 高度在 0.83 处（面板 212×98、上沿 −54 ⇒ 36 / 78、y = 26）。
    // 两柱间距 42 也是照图给的 —— 第一版只隔 22，两根柱子快粘成一根。
    // 🔴 改这四位数会牵到四处，改之前先把它们一起看一遍：
    //    · circuit-schematic 的 schTermWorld —— 电路图仍按「符号两端」引线
    //    · circuit-3d-kit 的端子表 —— 3D 机箱宽度必须盖得住最右那根柱子
    //    · circuit-editor 的 BODY 命中框（点得到 / 看不见会打架）
    //    · circuit-draw 的 bodyBox（走线避让）与 PSU.POSTS（直接引用这一项）
    power: [{ x: 36, y: 26 }, { x: 78, y: 26 }],
    switch: [{ x: -HALF, y: 0 }, { x: HALF, y: 0 }],
    // 单刀双掷开关：三柱排成一行，和表头同一套排布（外侧两根钉在 ±HALF 上，
    // 中间那根落在 x=0）—— 「左 = 掷 1、中 = 公共、右 = 掷 2」。
    // 🔴 中间那根【必须】在正中：它是刀片的转轴，刀片左右等长才能两边都搭得上。
    //    偏心一根，刀片就得做成两段不一样长，画出来像把跷跷板。
    spdt: [{ x: -HALF, y: 0 }, { x: 0, y: 0 }, { x: HALF, y: 0 }],
    bulb: [{ x: -HALF, y: 0 }, { x: HALF, y: 0 }],
    // 二极管和电动机是【有极性】的，0 号端子一律是「+」（左边那个红柱）。
    // 和电池的「+在右」不一样是有意的：电池的 + 在右是干电池实物上碳棒那
    // 一头的位置，二极管/电动机的 + 在左只是本页的摆法 —— 学生认哪边是正，
    // 靠的是柱子颜色和丝印，不是左右。
    led: [{ x: -HALF, y: 0 }, { x: HALF, y: 0 }],       // 0 = 「+」（阳极）
    motor: [{ x: -HALF, y: 0 }, { x: HALF, y: 0 }],     // 0 = 「+」
    // 电铃两个柱子都是金属色（neutral）—— 它没有极性，这不是省事，
    // 就是「通电就响、与电流方向无关」这件事在实物上的样子。
    bell: [{ x: -HALF, y: 0 }, { x: HALF, y: 0 }],
    // 三柱表头：0 = 「−」柱（黑，最左），1/2 = 两个量程柱（红，往右排）。
    // 外侧两个柱仍钉在 ±HALF，保持全站网格约定，只有 y 落到底座下面。
    ammeter: [{ x: -HALF, y: MET.POST_Y }, { x: 0, y: MET.POST_Y }, { x: HALF, y: MET.POST_Y }],
    voltmeter: [{ x: -HALF, y: MET.POST_Y }, { x: 0, y: MET.POST_Y }, { x: HALF, y: MET.POST_Y }],
    // 灵敏电流计只有【两根】柱子：0 = 「−」（黑，左），1 = 「+」（红，右）。
    // 它没有量程柱 —— 满偏是参数（±30mA / 3mA / 30μA 三档），不是「换根柱子」。
    // y 和其它表一样落在底座下面（POST_Y），导线行高的约定不变。
    galvanometer: [{ x: -HALF, y: MET.POST_Y }, { x: HALF, y: MET.POST_Y }],
    // 接线点：两个端子【在同一个点上】（它就是导线中间的一个结点）。
    // 两根导线各接一个端子、画出来落点完全重合，看上去就是一整根线。
    junction: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
    rheostat: [
      // 编号照人教版图16.4-2 的实物位置：下面两个柱是 A/B（电阻丝两端），
      // 上面两个柱是 C/D（金属杆两端）。改这四个点的【顺序】等于改内核语义，
      // 必须和 circuit-core.js 的 TYPES.rheostat 一起动。
      { x: -78, y: 26 }, { x: 78, y: 26 },     // A 左下 / B 右下（电阻丝）
      { x: -78, y: -26 }, { x: 78, y: -26 },   // C 左上 / D 右上（金属杆）
    ],
  };

  // 「对调极性」标记。电池 / 发光二极管 / 电动机的参数面板上有一个「对调」
  // 按钮，点一下把左右的正负记号换过来 —— 实物上就是【把元件调个头】。
  // 语义落在 params.flip 上（会进存档、进撤销栈），绘制层只读它。
  //
  // ⚠️ 只翻【局部 x】：把端子坐标 x 取负，等于把 0 号端子从这一头搬到那一头。
  //    于是「电流从 0 号端子流进」这句话的含义没变，只是 0 号端子换到了另一边
  //    —— 内核、读数、极性判定（reversed / 充电 / 反转）一个数都不用改。
  //    反过来若去翻转「端子编号」，rec.i 的正负号含义就全乱了。
  //    编辑器在这边配合做一件事：把挂在该元件上的导线端点 termIdx 也交换
  //    （0↔1），线头就留在原地不动 —— 合起来正好是「元件原地转 180°、线没动」。
  function flipOf(comp) {
    return !!(comp && comp.params && comp.params.flip);
  }

  // 元件的【显示名】。默认就是自动编号（c.id：L1 / S2 / E1 …），学生点画布上
  // 那个标签框就能改成任意短名（「L」「灯泡」「小灯」…）。
  //
  // ⚠️ 只改【显示】，绝不改 c.id：
  //   · 导线端点的 compId、内核的 results.components[c.id]、并查集的
  //     `id + ':' + termIdx` 节点名、撤销快照的键 —— 全都认 c.id；
  //   · 改 id 等于给元件换一个身份，上面每一处都要跟着重写，代价远大于收益；
  //   · 而且 id 一变，自动编号的「不重复」判据（`byId(prefix + n)`）就漏了
  //     —— 用户把 L1 改名成 L 之后再放一个灯泡，会又冒出一个 L1。
  // 所以 name 是一个纯附加字段：空 / 全空白 ⇒ 回落到 id（等于「没改过」）。
  // 存档（comps 整体序列化）与撤销栈（整个 scene 快照）都自动带上它。
  function nameOf(comp) {
    if (!comp) return '';
    var n = comp.name;
    return (typeof n === 'string' && n.trim()) ? n.trim() : comp.id;
  }

  function toWorld(comp, lx, ly) {
    var r = (comp.rot || 0) * Math.PI / 180;
    var c = Math.cos(r), s = Math.sin(r);
    return { x: comp.x + lx * c - ly * s, y: comp.y + lx * s + ly * c };
  }
  // toWorld 的逆变换。命中判断（拖滑片）拿鼠标点反推回元件自身坐标系用。
  function toLocal(comp, x, y) {
    var r = -(comp.rot || 0) * Math.PI / 180;
    var c = Math.cos(r), s = Math.sin(r);
    var dx = x - comp.x, dy = y - comp.y;
    return { x: dx * c - dy * s, y: dx * s + dy * c };
  }
  function terminalWorld(comp, i) {
    return terminalWorldIn(comp, TERMINALS[comp.type], i);
  }
  // terminalWorld 的【表驱动】版本：端子表从外面传进来。
  //
  // 存在的理由：皮肤（circuit-skin.js）要能改某几件器材的接线柱位置，
  // 但「局部坐标 → 世界坐标」这一步必须只有一份实现（翻转 flipOf、位姿
  // rotate/translate 全在里面）。皮肤自己再写一遍这套三角函数，迟早在
  // 「翻转过的元件」上漂移成两套真值 —— 导线接在 A 处、命中判定在 B 处。
  //
  // 🔴 传进来的 list 必须是【元件自身坐标系】的柱子表，形状和 TERMINALS 里
  //    那一项一样（[{x,y}, …]）。原版调用走 TERMINALS[type]，一个字节没变。
  function terminalWorldIn(comp, list, i) {
    var t = list && list[i];
    if (!t) return null;
    return toWorld(comp, flipOf(comp) ? -t.x : t.x, t.y);
  }
  // 导线的【一个端点】的世界坐标。e 有两种形态：
  //   {compId, termIdx} —— 正常情况，走元件端子；
  //   {compId: null, x, y} —— 【冻结坐标】：元件被删掉以后，挂在它上面的导线
  //     不会跟着消失，端点就地冻住（见 circuit-editor 的 removeSelected）。
  // 所有解导线端点的地方都必须走这里，别再直接 byId + terminalWorld ——
  // 元件没了以后 byId 返回 null，terminalWorld 会当场抛错。
  function endWorld(comp, e) {
    if (!e) return null;
    if (e.compId && comp) return terminalWorld(comp, e.termIdx);
    if (e.x != null && e.y != null) return { x: e.x, y: e.y };
    return null;
  }

  // 滑动变阻器的几何。绘制和「拨滑片」的命中判断必须共用这一组数字——
  // 各写一份迟早漂移成「看得见却拨不动」，或者拨的是空气。
  var RHEO = {
    BW: 156, BH: 58,
    cylX: -60, cylY: 4, cylW: 120, cylH: 26,   // 绕线瓷管（电阻丝本体）
    knobHalf: 14, knobTop: -38, knobBottom: -12,  // 滑片（骑在金属杆上）
    track: 9,                                    // 滑片行程两端各留的余量
    postX: 78, postY: 26,                        // 下面两个柱（A / B）的局部坐标
    // 绕线的圈距（局部单位）。🔴 drawRheostat 用它画丝、drawRheostatFlow 用它铺
    // 电流记号 —— 两处各写一份 1.9 的话，电流迟早从丝上跑偏（而且只在放大时才
    // 看得出来）。所以它必须住在几何常量里，和 cylX / cylW 一样。
    pitch: 1.9,
    // 电流路径那条【螺旋虚线】的圈距（局部单位）。它比画丝的圈距（pitch=1.9）
    // 粗得多 —— 1.9px 一圈的螺旋在屏幕上就是一整片，看不出是「一圈圈绕上去的」。
    // 🔴🔴 2026-10-17 用户第 4 点：原来是 24（半根绕线绕 2.5 圈），记号沿螺旋
    //    每秒 320px 跑，一圈才 20px 横向 ⇒ 垂直方向来回抖 16 Hz，看着比导线
    //    「快得多」。改成 44（半根 60px 上只绕 1 圈多），抖动的频率降到 1/2、
    //    横向速度也提上来，肉眼才和导线一致。
    //    这一条和记号密度是【两件事】：密度由 drawRheostatFlow 里的 gap（42/64，
    //    和导线同一个数）定，这里只管「绕几圈」。
    flowPitch: 44,
    // 虚线的实线段 / 空档（弧长，局部单位）。
    railOn: 6, railOff: 4,
  };
  // 滑动变阻器那四个端子字母（A/B/C/D）的规格。
  // 🔴 住在常量里、由 drawRheostat 与自检【读同一份】—— 只把 19px 写死在
  //    drawRheostat 里的话，「字够不够大」这件事就只能靠肉眼，谁把它改回 15
  //    都没人知道；而它恰恰是学生「接到 D 和 B」这句话能不能落地的唯一参照系，
  //    且这个实验绝大多数时候是投在大屏上看的。
  // ⚠️ offX / offY 是【字母相对元件中心的局部偏移】，必须比接线柱（±78 / ±26、
  //    柱体半径约 17）更靠外，否则字会压到红柱帽上、白描边把柱子啃掉一块。
  var RHEO_LABEL = {
    font: 19, offX: 107, offY: 47, color: '#1e293b',
    halo: 5, haloColor: 'rgba(255,255,255,0.92)',
    // 四个字母的局部坐标，顺序 = A B C D（A/B 是下面两个柱、C/D 是上面两个）。
    at: { A: [-107, 47], B: [107, 47], C: [-107, -47], D: [107, -47] },
  };
  // 端子字母【这一帧真的画出去了什么】（元件 id → { px, font, w, pts }）。
  // 🔴 断言必须读它、不能读 RHEO_LABEL：读常量等于量「打算画的那一步」——
  //    把 drawRheostat 里那行字体写死回 15px（不再读 RHEO_LABEL）照样全绿，
  //    而「投影到大屏上认不认得出 A/B/C/D」正是这一档唯一要守的东西。
  //    w = 真正按那个字体量出来的字形宽度，是「画得够不够大」的硬证据。
  // 🔴 按 comp.id 存：调色板图标（id='__lg__'）和放大镜也走 drawComponent，
  //    存一个全局单值会被它们覆盖掉。
  var rheoLabelDrawn = {};
  // 滑片位置 slide（0~1）→ 局部横坐标
  function sliderLocalX(slide) {
    return RHEO.cylX + RHEO.track + (RHEO.cylW - RHEO.track * 2) * slide;
  }
  // 局部横坐标 → slide（未截断，调用方负责夹到 0~1）
  function slideFromLocalX(lx) {
    return (lx - RHEO.cylX - RHEO.track) / (RHEO.cylW - RHEO.track * 2);
  }
  // slide 的取值：注意别写成 `params.slide || 0.5`，滑片在最左端时 0 会被吞掉
  function slideOf(comp, rec) {
    if (rec && rec.slide != null) return +rec.slide;
    if (comp && comp.params && comp.params.slide != null) return +comp.params.slide;
    return 0.5;
  }

  // ============================================================
  // 接线柱
  // ------------------------------------------------------------
  // kind: 'pos' 红（正极）/ 'neg' 黑（负极）/ 'neutral' 金属（无极性元件）
  // 无极性元件也用同一个外形，保证全站接线柱是同一个视觉锚点。
  // ============================================================
  // 柱身的【横向】渐变（光源在左上）：左右两个暗面夹住中间一大片本色，再在
  // 偏左上补一条高光。中间那一段必须【留平台】—— 正极红 #dc2626 要是只挂在
  // 一个色标上，纯红就只剩一个像素宽，柱子一缩小就不红了，像素断言也跟着挂
  // （实测 12px 宽的柱帽里只剩 2 个纯红点）。平台给 0.14~0.72，扣掉滚花齿和
  // 环境光遮蔽，还剩足够多像素扛住缩放。
  // 索引约定（下面一律用 DARK / BODY / HI 取色，不要再写 G[n][1]）：
  //   0 = 暗面 · 1/2/4/5 = 本色平台 · 3 = 高光 · 6 = 暗面
  var POST_GRAD = {
    pos: [[0, '#6f1a1a'], [0.14, '#dc2626'], [0.28, '#dc2626'], [0.38, '#f3a8a8'],
          [0.52, '#dc2626'], [0.72, '#dc2626'], [1, '#6f1a1a']],
    neg: [[0, '#0d1424'], [0.14, '#1e293b'], [0.28, '#1e293b'], [0.38, '#7c8b9d'],
          [0.52, '#26344a'], [0.72, '#26344a'], [1, '#0d1424']],
    neutral: [[0, '#55636f'], [0.14, '#8fa0b2'], [0.28, '#a8b6c4'], [0.38, '#f7fafc'],
          [0.52, '#a8b6c4'], [0.72, '#8fa0b2'], [1, '#55636f']],
  };

  // 柱帽球冠的半径 / 高度。抽成模块级常量：drawBindingPost 拿它画顶盖，
  // drawPowerSupply 拿它算「柱尖到锚点多远」—— 学生电源那两根柱子是【斜插在
  // 前表面上】的，锚点取在柱【尖】上，柱子沿轴缩进面板里。
  // 各写一份的话，改了这边、那边的斜柱就会戳出面板或者整根缩进面板里。
  var POST_DOME_R = 4.5, POST_DOME_H = 3.1;
  var POST_TIP_H = 9 + POST_DOME_H;      // 元件自身坐标系里「柱尖」到原点的距离

  // neck = 螺纹杆的高度（默认 0）：闸刀开关、小灯泡的柱子立在板面上，教材实物里
  // 它们明显比电池盒上的高出一截，不抬起来就被底板吃掉、只露个顶。
  // 加高的那一段是【细一圈的螺杆】，上面才是滚花螺母——一整根一样粗的圆柱
  // 画出来像个漏斗，而且柱子锚在端子上（±70），横向一胖就探出底板两头。
  function drawBindingPost(ctx, x, y, kind, scale, neck) {
    if (kind === true) kind = 'pos';
    else if (kind === false) kind = 'neg';
    else if (kind !== 'pos' && kind !== 'neg') kind = 'neutral';
    var s = scale == null ? 1.25 : scale;
    var nk = neck == null ? 0 : neck;
    var G = POST_GRAD[kind];
    var DARK = G[0][1], BODY = G[1][1], HI = G[3][1];
    var sc = ctxScale(ctx) * s;          // 细节分级要看【最终】落屏大小，不是元件坐标
    ctx.save();
    ctx.translate(x, y); ctx.scale(s, s);
    // 压在台面上的接触阴影：比原来的椭圆更贴边、更小，和 softShadow 的投影分工
    contactShadow(ctx, 0, 2, 9.5, 3.6, 0.34);
    if (nk > 0) {
      // 螺杆：从板面顶到螺母底，比螺母细一圈。颜色取同一套渐变两头偏暗的那两个，
      // 看着才是「螺母拧在杆上」，而不是一整根一样粗的圆柱。
      ctx.fillStyle = linGrad(ctx, -3.4, 0, 3.4, 0,
        [[0, DARK], [0.5, HI], [1, DARK]]);
      roundRect(ctx, -3.4, 2 - nk, 6.8, nk, 1.6); ctx.fill();
      // 螺杆左侧的一道细高光：整根一样粗的圆柱没有它就读成一块铁片
      ctx.fillStyle = 'rgba(255,255,255,0.34)';
      roundRect(ctx, -2.5, 2.6 - nk, 1.5, nk - 1.6, 0.75); ctx.fill();
      // 螺纹：两道极细的暗线。缩小的时候不画（1px 的东西只会糊成脏点）
      if (sc >= 1.3 && nk >= 5) {
        ctx.strokeStyle = 'rgba(15,23,42,0.22)'; ctx.lineWidth = 0.7;
        for (var tq = 1; tq <= 2; tq++) {
          var ty = 1 - nk * (tq / 3);
          ctx.beginPath(); ctx.moveTo(-3, ty); ctx.lineTo(3, ty); ctx.stroke();
        }
      }
    }
    // ── 滚花螺母 ──────────────────────────────────────────────
    // 柱身横向渐变（左亮右暗）= 一根立着的圆柱，光源在左上。
    ctx.fillStyle = linGrad(ctx, -5, 0, 5, 0, G);
    roundRect(ctx, -5, -9 - nk, 10, 11, 2); ctx.fill();
    // 滚花齿：真螺母的侧壁是搓花的，光在上面碎成一条条竖纹。
    // 只在够大时画 —— 齿距 1.8 以下在缩略图里就是一层灰。
    ctx.save();
    roundRect(ctx, -5, -9 - nk, 10, 11, 2); ctx.clip();
    knurl(ctx, -5, -9 - nk, 10, 11, sc, 'rgba(15,23,42,0.26)');
    ctx.restore();
    // 底沿的环境光遮蔽：螺母坐在板面上，最下面那 1.5px 必然是暗的。
    // 少了它，柱子看着是浮在板面上方而不是拧在上面。
    ctx.fillStyle = 'rgba(15,23,42,0.26)';
    roundRect(ctx, -5, -1.4 - nk, 10, 2.4, 1.2); ctx.fill();
    // 顶盖：真柱帽的顶是一个【鼓起来的球冠】，不是一圈杯口，也不是一顶帽子。
    // 上一版穹顶半径（5.4）比螺母还宽 0.4，顶盖就在螺母上沿探出一圈帽檐；
    // 而且渐变只取到最亮的那一段，整个顶盖是一片平的浅色 —— 放大镜里读成
    // 「柱子上扣了个盖子」。改成比螺母【窄一圈】的球冠，渐变从顶到底走满
    // 高光 → 本色 → 暗面，它才是一块有体积的金属。
    var dr = POST_DOME_R, dh = POST_DOME_H;   // 穹顶半径 / 高度，都比螺母小一圈
    ctx.fillStyle = linGrad(ctx, 0, -9 - nk - dh, 0, -9 - nk + dh * 0.45,
      [[0, HI], [0.5, BODY], [1, DARK]]);
    ctx.beginPath();
    ctx.ellipse(0, -9 - nk, dr, dh, 0, Math.PI, 0);         // 上半弧 → 穹顶
    ctx.closePath(); ctx.fill();
    // 穹顶和柱身的交界：下半弧当肩线描出来，顶盖才「坐」在柱身上
    ctx.strokeStyle = 'rgba(15,23,42,0.42)'; ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.ellipse(0, -9 - nk, dr, dh, 0, 0, Math.PI);
    ctx.stroke();
    // 穹顶上的一道月牙高光：偏左上，和全站光源一致
    if (sc >= 1.05) {
      ctx.strokeStyle = 'rgba(255,255,255,0.58)'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(-0.6, -9.35 - nk, dr * 0.56, dh * 0.52, 0, Math.PI * 1.06, Math.PI * 1.70);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 两端元件统一收尾：画端子引线 + 接线柱
  //
  // faceAngle = 柱子的【倾斜】，默认 null = 柱子立着（全站都是这样）。
  //   给一个角度 = 柱子【斜插】在这件器材上，这个角度是「柱尖朝外」在【元件自身
  //   坐标系】里的方向角（柱子的局部 +y 是柱尖方向）。学生电源用它：那两根柱子
  //   拧在【竖直的前表面】上，柱轴垂直于前表面 ⇒ 画面上朝观察者（左下）伸出来。
  //   ⚠️ 必须一并存进 __posts：宿主把导线画在元件之上以后会用 drawTerminals()
  //      补画一遍柱子（柱子是交互点，不能被导线压住），补画时只有这一份登记可读。
  //      漏了它，症状是「画的时候是斜的、导线一盖再补画就变回竖的」。
  function posts(ctx, comp, kinds, scale, neck, faceAngle) {
    // 记下这一件器材的柱子规格：宿主把导线画在元件【之上】以后（真实情况就是
    // 导线从表盘上面跨过去），柱子会被导线压住 —— 接线柱是交互点，必须留在
    // 最上层，由 drawTerminals() 在导线之后补画一次。
    // 定义成【非枚举】属性：JSON.stringify / 深拷贝都看不见它，存档往返和
    // 撤销快照不会因为多出这个字段而对不上。
    try {
      Object.defineProperty(comp, '__posts', {
        value: { kinds: kinds, scale: scale, neck: neck, faceAngle: faceAngle },
        writable: true, enumerable: false, configurable: true
      });
    } catch (e) {
      comp.__posts = { kinds: kinds, scale: scale, neck: neck, faceAngle: faceAngle };
    }
    var sc = scale == null ? 1.25 : scale;
    var nk = neck == null ? 0 : neck;
    // 元件自身坐标系里的方向 → 世界坐标里的方向。翻转和旋转都要跟着走。
    // 🔴 别在这里自己写一套三角函数：flipOf 的镜像 + comp.rot 的旋转，
    //    全站只有 toWorld / terminalWorldIn 那一份实现（皮肤也是问它）。
    //    各写一份的结果是「翻转过的元件上，柱子斜向反了」。
    var tilt = null;
    if (faceAngle != null) {
      var ddx = Math.sin(faceAngle), ddy = -Math.cos(faceAngle);
      if (flipOf(comp)) ddx = -ddx;
      var trr = (comp.rot || 0) * Math.PI / 180;
      var tcr = Math.cos(trr), tsr = Math.sin(trr);
      var dwx = ddx * tcr - ddy * tsr, dwy = ddx * tsr + ddy * tcr;
      tilt = Math.atan2(dwx, -dwy);
    }
    for (var i = 0; i < kinds.length; i++) {
      var p = terminalWorld(comp, i);
      if (tilt == null) { drawBindingPost(ctx, p.x, p.y, kinds[i], scale, neck); continue; }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(tilt);
      // 沿柱轴推出去一个柱长：柱【尖】（球冠顶）正好落在锚点上 —— 锚点就是
      // 导线接上来的那一点，柱身从它沿 −FACE 缩进器材里。
      ctx.translate(0, (POST_TIP_H + nk) * sc);
      drawBindingPost(ctx, 0, 0, kinds[i], scale, neck);
      ctx.restore();
    }
  }

  // 补画一件器材的接线柱（导线画完之后调用）。柱子走 terminalWorld()，拿到的
  // 是含 comp.x/y、含旋转的绝对坐标 ⇒ 这个函数必须在外层变换【之外】调用，
  // 和 posts() 的约束完全一样（见 drawSwitch 里那段注释）。
  function drawTerminals(ctx, comp) {
    var s = comp.__posts;
    if (!s) return;
    posts(ctx, comp, s.kinds, s.scale, s.neck, s.faceAngle);
  }

  // ============================================================
  // 导线 + 自由电子小球
  // ============================================================
  function polyLen(pts) {
    var L = 0;
    for (var i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y);
    return L;
  }
  // 沿导线走了 d 像素之后的位置。折返点处可能落在拐角上，返回的 (ux, uy) 是
  // 所在那一段的单位切向——画电流箭头要靠它定朝向，所以一并返回。
  function pointDirAt(pts, d) {
    for (var i = 1; i < pts.length; i++) {
      var dx = pts[i].x - pts[i-1].x, dy = pts[i].y - pts[i-1].y;
      var seg = Math.hypot(dx, dy);
      if (d <= seg || i === pts.length - 1) {
        var t = seg > 0 ? Math.min(d / seg, 1) : 0;
        return { x: pts[i-1].x + dx * t, y: pts[i-1].y + dy * t,
                 ux: seg > 0 ? dx / seg : 1, uy: seg > 0 ? dy / seg : 0 };
      }
      d -= seg;
    }
    return { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y, ux: 1, uy: 0 };
  }
  function pointAt(pts, d) {
    var q = pointDirAt(pts, d);
    return { x: q.x, y: q.y };
  }
  // 折线的【一段子折线】：弧长 d0 到 d1 之间的部分。熔断的导线要靠它把中间
  // 那截【真的去掉】—— 在整根线上盖一个「断开」标记是不行的：那样画面上
  // 导线还是连着的，只是多贴了一张标签。
  function subPath(pts, d0, d1) {
    if (d1 <= d0) return null;
    var out = [], acc = 0;
    for (var i = 0; i < pts.length - 1; i++) {
      var seg = Math.hypot(pts[i+1].x - pts[i].x, pts[i+1].y - pts[i].y);
      var a = acc, b = acc + seg;
      if (b >= d0 && a <= d1) {
        if (a <= d0 && d0 <= b) out.push(pointAt(pts, d0));
        if (a > d0 && a < d1) out.push({ x: pts[i].x, y: pts[i].y });
        if (a < d1 && d1 <= b) out.push(pointAt(pts, d1));
      }
      acc = b;
    }
    return out.length >= 2 ? out : null;
  }

  function strokePath(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  // ── 把折线的直角抹圆 ────────────────────────────────────────
  // 真实导线不会拐出尖角：它是【弯】过去的。原来 strokePath 一路 lineTo，
  // 于是整张图看着像用尺子比着画出来的折线 —— 用户要的「自然弯曲」就是这个。
  //
  // 只动【中间的拐点】，首尾两点一个字节都不动 —— 那两个点是接线柱，挪一下
  // 导线就从柱子上掉下来了（画面上看不出，读数却变了）。
  //
  // 半径 = min(rad, 相邻两条边各自的一半)：边太短时自动缩小，两个圆角不会
  // 互相吃掉对方那一段。
  //
  // ⚠️ 采样点要够密。这条折线【同时】是绘制路径、命中判据（hitWire 逐段量
  // 距离）和电流粒子的跑道 —— 采样太疏等于把圆角又变成一串新折线，白改。
  // 反过来也不能太密：单根导线的点数会被 simplify 的 VIA_MAX 记账。
  var CORNER_SEG = 6;
  function roundPath(pts, rad) {
    if (!pts || pts.length < 2) return (pts || []).map(function (p) { return { x: p.x, y: p.y }; });
    if (pts.length === 2) return [{ x: pts[0].x, y: pts[0].y }, { x: pts[1].x, y: pts[1].y }];
    var R = rad == null ? 30 : rad;
    var out = [{ x: pts[0].x, y: pts[0].y }];
    for (var i = 1; i < pts.length - 1; i++) {
      var p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1];
      var d0 = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      var d1 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      // 共线（中间点其实在直线上）→ 这个「拐点」不是拐点，别给它加采样点
      var cross = (p1.x - p0.x) * (p2.y - p1.y) - (p1.y - p0.y) * (p2.x - p1.x);
      if (d0 < 1e-6 || d1 < 1e-6 || Math.abs(cross) < 1e-6 * d0 * d1) {
        out.push({ x: p1.x, y: p1.y });
        continue;
      }
      var r = Math.min(R, d0 / 2, d1 / 2);
      if (r < 1) { out.push({ x: p1.x, y: p1.y }); continue; }
      var ax = p1.x + (p0.x - p1.x) * r / d0, ay = p1.y + (p0.y - p1.y) * r / d0;
      var bx = p1.x + (p2.x - p1.x) * r / d1, by = p1.y + (p2.y - p1.y) * r / d1;
      for (var k = 0; k <= CORNER_SEG; k++) {
        var t = k / CORNER_SEG, u = 1 - t;
        out.push({
          x: u * u * ax + 2 * u * t * p1.x + t * t * bx,
          y: u * u * ay + 2 * u * t * p1.y + t * t * by,
        });
      }
    }
    out.push({ x: pts[pts.length - 1].x, y: pts[pts.length - 1].y });
    return out;
  }

  // 画布上跑的小球是【自由电子】，返回它沿导线 a→b 的有符号位移（px）。
  //
  // ⚠️ 电子带负电，定向移动方向【和电流方向相反】——金属导体里规定正电荷
  // 定向移动的方向为电流方向，所以电子是从负极往正极跑的。这是初中考点，
  // 画面上跑反了等于给学生刻一个错误印象。这里 flow 给的是【电流】，
  // 所以返回值必须取反。
  //
  // 抽成独立函数是为了能直接测方向。这里出过两个错，都是像素测量很难断的：
  //   1. 方向反了。想用「粒子质心位移」来验证会被坑死——粒子在端点绕回去时
  //      整幅图案平移一个大跳，永远盖过真实位移，得用单颗粒子才测得准。
  //   2. speed 曾经是「每秒走完整根导线的百分之几」，于是同样电流下长导线的
  //      粒子跑得比短导线快好几倍，串联回路里各段快慢不一。
  // 所以：速度按【每秒多少像素】算，与导线长短无关。
  var FLOW_PX_PER_PHASE = 320;
  function electronShift(flow, phase) {
    var I = Math.abs(flow || 0);
    if (I <= 1e-6 || phase == null) return 0;
    // 用 sqrt 而不是线性：线性的话大电流快到糊成一片、小电流几乎不动。
    // 这里要的是「电流越大越快」的定性观感，不是漂移速度的定量还原。
    var spd = Math.min(1, Math.sqrt(I / 0.8)) * FLOW_PX_PER_PHASE;
    return (flow > 0 ? -1 : 1) * phase * spd;      // 负号 = 电子逆着电流走
  }

  // 电流方向动画（红箭头）的有符号位移。就是电子位移取反：
  // 两者必须【严格等速反向】，屏幕上才看得出「同一条导线、两样东西对着走」——
  // 各写一套速度公式迟早会漂开，箭头和球看着像两个不相干的动画。
  // 只取反不重算，也顺便保证了「电流方向与电子定向移动方向相反」这条结论
  // 无论怎么调速度曲线都成立。
  function currentShift(flow, phase) { return -electronShift(flow, phase); }

  // opts: { flow: 有符号电流(A, 正=从首端流向末端), phase: 秒,
  //         current: 是否画电流方向箭头（默认关，向后兼容只传 flow/phase 的调用）,
  //         weak: 这条线里是【微弱电流】（默认关，见下面那一段） }
  //
  // weak = true 的用法只有一个：电压表按【真实内阻】接进电路时，接它的那两根
  // 导线里流过的是 mA 量级的电流（3V / 3kΩ ≈ 1mA），和主回路差两三个数量级。
  // 这时候如果照常画红箭头，学生看到的是「电压表也在耗电」和「电压表不分流」
  // 两条互相打架的印象 —— 而「电压表内阻很大、几乎不分流」正是这个选项要教的。
  // 所以弱电流【必须换一套长相】，不能只是「同样的小球跑得慢一点」：
  //   · 自由电子小球：半径 2.9 → 1.7，透明度 1 → 0.5，间距 42 → 68；
  //   · 电流箭头：实心三角 → 【空心箭头（">" 形）】，颜色从正红变成淡红，
  //     去掉发光，间距 64 → 96，整体缩到 0.6 倍。
  // 空心 vs 实心是最一目了然的区别 —— 缩小和调淡在手机屏上都会糊掉。
  function drawWire(ctx, pts, opts) {
    if (!pts || pts.length < 2) return;
    opts = opts || {};
    var W = opts.width || 6;
    var weak = !!opts.weak;

    // 熔断的导线：中间【真的缺一段】。不是画个「断开」标记压在整根线上 ——
    // 那样画面上导线还是通的，只是多贴了一张标签，和「断了」是两回事。
    var segs = [pts];
    if (opts.broken) {
      var Lb = polyLen(pts);
      if (Lb > 1) {
        var gap = Math.min(28, Lb * 0.4);
        segs = [subPath(pts, 0, Lb / 2 - gap / 2), subPath(pts, Lb / 2 + gap / 2, Lb)]
          .filter(function (s) { return !!s; });
      }
    }

    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    segs.forEach(function (sp) {
      // 外描边（导线外皮）
      ctx.strokeStyle = 'rgba(100,116,139,0.35)';
      ctx.lineWidth = W + 2;
      strokePath(ctx, sp);
      // 主体
      ctx.strokeStyle = opts.color || PALETTE.wire;
      ctx.lineWidth = W;
      strokePath(ctx, sp);
      // 顶部高光
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = W * 0.3;
      strokePath(ctx, sp);
    });
    ctx.restore();

    // 断口：两截铜丝各留一个焦黑的圆头，中间空着。断掉的导线是【事故现场】，
    // 没有它，学生只看到「线短了一截」，不知道那是烧断的。
    if (opts.broken && segs.length === 2) {
      var Lc = polyLen(pts);
      [Lc / 2 - Math.min(28, Lc * 0.4) / 2, Lc / 2 + Math.min(28, Lc * 0.4) / 2].forEach(function (d) {
        var q = pointAt(pts, Math.max(0, Math.min(d, Lc)));
        ctx.beginPath();
        ctx.fillStyle = '#3f3f46';
        ctx.arc(q.x, q.y, W * 0.62, 0, 6.284); ctx.fill();
        ctx.beginPath();
        ctx.fillStyle = 'rgba(120,113,108,0.85)';
        ctx.arc(q.x, q.y, W * 0.34, 0, 6.284); ctx.fill();
      });
    }

    // 自由电子小球：间距按实际长度均分，位置沿【弧长】排布，
    // 所以速度是「每秒多少像素」，串联回路里长导线和短导线一样快。
    // electrons 只在【显式】传 false 时才不画：老调用方只传 flow/phase，
    // 行为必须和以前一模一样（小球照旧出来）。
    var I = Math.abs(opts.flow || 0);
    if (I > 1e-6 && opts.phase != null && opts.electrons !== false) {
      var L = polyLen(pts);
      if (L < 1) return;
      var n = Math.max(1, Math.round(L / (weak ? 68 : 42)));   // 42px 一颗，长导线自动多排几颗
      var step = L / n;
      var shift = electronShift(opts.flow, opts.phase);
      ctx.save();
      ctx.fillStyle = PALETTE.flow;
      if (weak) ctx.globalAlpha = 0.5;                 // 微弱电流的小球压淡
      else { ctx.shadowColor = 'rgba(245,158,11,0.85)'; ctx.shadowBlur = 7; }
      for (var i = 0; i < n; i++) {
        // 对 L 取模：粒子从导线末端出去就从首端进来，两端接得上，看不到跳变
        var d = ((i * step + shift) % L + L) % L;
        var p = pointAt(pts, d);
        ctx.beginPath();
        ctx.arc(p.x, p.y, weak ? 1.7 : 2.9, 0, 6.284);
        ctx.fill();
      }
      ctx.restore();
    }

    // 电流方向箭头（红色三角）。和电子小球可以同时开——这正是要对比的：
    // 同一条导线上两者【反向】走。间距比小球大（64 vs 42）：箭头比小球大一圈，
    // 排一样密会糊成一条红线，看不出是在动。
    if (I > 1e-6 && opts.phase != null && opts.current) {
      var L2 = polyLen(pts);
      if (L2 < 1) return;
      var n2 = Math.max(1, Math.round(L2 / (weak ? 96 : 64)));
      var step2 = L2 / n2;
      var sh2 = currentShift(opts.flow, opts.phase);
      ctx.save();
      if (!weak) {
        ctx.fillStyle = PALETTE.current;
        ctx.shadowColor = 'rgba(220,38,38,0.7)';
        ctx.shadowBlur = 6;
      } else {
        // 弱电流：淡红空心箭头（">"）。不填充、不发光、整体缩到 0.6 倍。
        ctx.strokeStyle = 'rgba(248,113,113,0.85)';
        ctx.lineWidth = 1.7; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      }
      for (var j = 0; j < n2; j++) {
        var d2 = ((j * step2 + sh2) % L2 + L2) % L2;
        var q = pointDirAt(pts, d2);
        ctx.save();
        ctx.translate(q.x, q.y);
        // 尖端必须朝【电流流向】。pointDirAt 给的是「从首端到末端」这条折线的
        // 单位切向（ux,uy），只有电流为正（首端→末端）时它才等于电流方向；
        // 电流为负时箭头是沿着导线【往回】走的（见 currentShift 的符号），
        // 而朝向要是还按 +切向画，尖端就朝着来路 —— 屏幕上就是一支倒着飞的
        // 箭头。这正是用户看到的「有的地方尖端朝后」：同一条回路里，
        // 反向支路上的那几根导线全是这个毛病。
        ctx.rotate(Math.atan2(q.uy, q.ux) + (opts.flow < 0 ? Math.PI : 0));
        if (weak) {
          var ks = 0.6;
          ctx.beginPath();
          ctx.moveTo(-5.2 * ks, -6.2 * ks);
          ctx.lineTo(6.6 * ks, 0);
          ctx.lineTo(-5.2 * ks, 6.2 * ks);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.moveTo(7, 0); ctx.lineTo(-5, -4.8); ctx.lineTo(-5, 4.8);
          ctx.closePath(); ctx.fill();
        }
        ctx.restore();
      }
      ctx.restore();
    }
  }

  // ============================================================
  // 元件图示（元件盒 / 拖拽鬼影用）
  // ------------------------------------------------------------
  // 和 2D 页图例那套 LG_VIEW 是同一组取景框：那里给的是「图例里认器材」，
  // 这里给的是「元件盒里那一小格」。两处数字必须一致 —— 图标框就是学生建立
  // 「这颗按钮 = 台面上那件器材」第一印象的地方，框歪了按钮就和器材对不上。
  // ⚠️ 这里是【纯绘制】层，参数由宿主用 C.defaultParams 填好再传进来，
  //    不许在这里问内核要默认值。
  // ============================================================
  var ICON_VIEW = {
    resistor:  { x0: -74, y0: -26, x1: 74, y1: 26 },
    plate:     { x0: -78, y0: -14, x1: 78, y1: 40 },
    battery:   { x0: -112, y0: -42, x1: 112, y1: 42 },
    power:     { x0: -126, y0: -68, x1: 126, y1: 46 },
    switch:    { x0: -74, y0: -68, x1: 74, y1: 38 },
    // 单刀双掷：和开关同一块底板，本体略矮 —— 没有闸刀那把抬得很高的刀片，
    // 只有一根【单边】刀片绕转轴倒 14°（远端是黑柄）。顶到 −62 就够。
    spdt:      { x0: -104, y0: -62, x1: 104, y1: 38 },
    bulb:      { x0: -74, y0: -80, x1: 74, y1: 40 },
    ammeter:   { x0: -122, y0: -110, x1: 122, y1: 84 },
    voltmeter: { x0: -122, y0: -110, x1: 122, y1: 84 },
    // 灵敏电流计：和两只表同一只壳、同一块底座，取景框当然也一样。
    galvanometer: { x0: -122, y0: -110, x1: 122, y1: 84 },
    rheostat:  { x0: -94, y0: -46, x1: 94, y1: 54 },
    led:       { x0: -78, y0: -52, x1: 78, y1: 36 },
    motor:     { x0: -78, y0: -64, x1: 78, y1: 36 },
    bell:      { x0: -78, y0: -66, x1: 78, y1: 42 },
  };
  var ICON_VIEW_DEF = { x0: -80, y0: -80, x1: 80, y1: 80 };
  // 把一件器材画进 w×h 的小格子里（ rec 传 null = 只画外形，不带读数 ）。
  // 返回时画布坐标系已经还原，宿主可以直接接着画框。背景不填 —— 由宿主决定
  // 这块图标是白底（浅色页）还是深底（3D 页）。
  function drawIcon(ctx, type, params, w, h) {
    var v = ICON_VIEW[type] || ICON_VIEW_DEF;
    // 缺参数时给一个空对象：画出默认外形比抛异常强（抛了整栏图标全没）
    var comp = { id: '__icon__', type: type, x: 0, y: 0, rot: 0, params: params || {} };
    var k = Math.min(w / (v.x1 - v.x0), h / (v.y1 - v.y0));
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(k, k);
    ctx.translate(-(v.x0 + v.x1) / 2, -(v.y0 + v.y1) / 2);
    try { drawComponent(ctx, comp, null); } catch (e) {}
    ctx.restore();
  }

  // ============================================================
  // 定值电阻（色环）
  // ============================================================
  function resistorBands(R) {
    var v = Math.abs(R) || 1, e = 0;
    while (v >= 100) { v /= 10; e++; }
    while (v < 10) { v *= 10; e--; }
    v = Math.round(v);
    var mult = e <= -1 ? MULT_NEG[String(e)] : BAND_COLORS[Math.min(e, 9)];
    return [BAND_COLORS[Math.floor(v / 10)], BAND_COLORS[v % 10], mult, '#c9a227'];
  }

  function drawResistor(ctx, comp, rec) {
    var BW = 108, BH = 40;
    var sc = ctxScale(ctx);
    ctx.save();
    ctx.translate(comp.x, comp.y);
    ctx.rotate((comp.rot || 0) * Math.PI / 180);

    // 引出线：镀锡铜。真电阻的两根脚是从【端帽】上焊出来的，所以线要画到
    // 端帽里面一点点，不能停在壳体边缘——停在边缘看着像线插进漆膜里。
    ctx.strokeStyle = PALETTE.metalLo; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-HALF, 0); ctx.lineTo(-BW / 2 + 8, 0);
    ctx.moveTo(BW / 2 - 8, 0); ctx.lineTo(HALF, 0);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(-HALF + 3, -0.9); ctx.lineTo(-BW / 2 + 9, -0.9);
    ctx.moveTo(BW / 2 - 9, -0.9); ctx.lineTo(HALF - 3, -0.9);
    ctx.stroke();

    // 压在台面上的接触阴影：细长的一条，跟着圆柱的腰线走
    contactShadow(ctx, 0, BH / 2 + 1.5, BW * 0.44, 5.5, 0.30);

    softShadow(ctx, -BW / 2, -BH / 2, BW, BH, 10, BH / 2);
    // 漆膜壳体：竖向渐变 = 圆柱的光照。高光带偏上（0.34），下方留一条暗反射
    // —— 只有「上亮下暗」才立得起来，整根一个色是一张纸片。
    fillMat(ctx, -BW / 2, -BH / 2, BW, BH, BH / 2 - 3, [
      [0, '#8d7a55'], [0.10, '#cbb689'], [0.24, '#f4ead2'], [0.34, '#fbf5e6'],
      [0.52, '#e4d7b8'], [0.74, '#c2b18e'], [0.90, '#a8946f'], [1, '#8a7752'],
    ]);
    ctx.strokeStyle = 'rgba(96,80,52,0.45)'; ctx.lineWidth = 1; ctx.stroke();
    // 壳体两端被端帽箍住，所以这里不再需要「压边」——端帽自己会盖上来。
    // 漆膜上那道锐利反光：一条，贴在 0.30 处。画在色环【之前】，
    // 色环是后印上去的，压在反光上；反过来画，反光会像一道划痕划过每道色环。
    ctx.fillStyle = 'rgba(255,255,255,0.46)';
    roundRect(ctx, -BW / 2 + 14, -BH / 2 + 5.5, BW - 28, 3.2, 1.6); ctx.fill();
    // 下半圈的一道暗反射：把圆柱的下缘压出来
    ctx.fillStyle = 'rgba(90,70,40,0.16)';
    roundRect(ctx, -BW / 2 + 12, BH / 2 - 8, BW - 24, 4.5, 2.2); ctx.fill();

    var R = (rec && rec.R != null) ? rec.R : (comp.params && comp.params.R) || 10;
    var bands = resistorBands(R);
    // 前三环靠左聚拢（读数方向），末环是误差环，单独靠右
    var xs = [-34, -24, -14, 26], ws = [7, 7, 7, 7];
    for (var i = 0; i < 4; i++) {
      ctx.save();
      // 色环随圆柱面弯曲：用竖直渐变模拟
      var bg = linGrad(ctx, 0, -BH / 2, 0, BH / 2,
        [[0, 'rgba(0,0,0,0.32)'], [0.16, 'rgba(0,0,0,0.06)'],
         [0.32, 'rgba(255,255,255,0.16)'], [0.58, 'rgba(0,0,0,0.04)'],
         [1, 'rgba(0,0,0,0.34)']]);
      ctx.fillStyle = bands[i];
      ctx.fillRect(xs[i], -BH / 2, ws[i], BH);
      ctx.fillStyle = bg;
      ctx.fillRect(xs[i], -BH / 2, ws[i], BH);
      ctx.restore();
    }

    // ── 两端金属端帽 ────────────────────────────────────────
    // 真电阻是「漆膜圆柱 + 两头压上去的金属帽」，脚从帽上焊出来。
    // 上一版只画了两块半透明暗片，读出来是「漆膜两头脏了」，不是金属。
    // 帽比壳体略粗（+1.5），外沿带倒角 —— 那圈倒角正是「帽是套上去的」的证据。
    [-1, 1].forEach(function (sg) {
      var cx0 = sg < 0 ? -BW / 2 - 1.5 : BW / 2 - 9.5;
      var cw = 11;
      ctx.save();
      ctx.beginPath();
      roundRect(ctx, cx0, -BH / 2 - 1.5, cw, BH + 3, 5); ctx.clip();
      ctx.fillStyle = linGrad(ctx, 0, -BH / 2 - 1.5, 0, BH / 2 + 1.5, MAT.chrome);
      ctx.fillRect(cx0, -BH / 2 - 2, cw, BH + 4);
      // 帽上的环形滚压纹（真帽是压出来的，有一两道环）
      ctx.strokeStyle = 'rgba(40,52,68,0.30)'; ctx.lineWidth = 1;
      [0.30, 0.70].forEach(function (f) {
        var yy = -BH / 2 - 1.5 + (BH + 3) * f;
        ctx.beginPath(); ctx.moveTo(cx0, yy); ctx.lineTo(cx0 + cw, yy); ctx.stroke();
      });
      ctx.restore();
      roundRect(ctx, cx0, -BH / 2 - 1.5, cw, BH + 3, 5);
      ctx.strokeStyle = 'rgba(51,65,85,0.5)'; ctx.lineWidth = 1; ctx.stroke();
      // 帽与漆膜的交界：一条暗缝，两道材料才分得开
      ctx.strokeStyle = 'rgba(30,41,59,0.5)'; ctx.lineWidth = 1.2;
      var seamX = sg < 0 ? cx0 + cw : cx0;
      ctx.beginPath();
      ctx.moveTo(seamX, -BH / 2 + 2); ctx.lineTo(seamX, BH / 2 - 2); ctx.stroke();
      // 端帽外沿的倒角高光
      if (sc >= 1) {
        ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.2;
        var hlX = sg < 0 ? cx0 + 1.6 : cx0 + cw - 1.6;
        ctx.beginPath();
        ctx.moveTo(hlX, -BH / 2 + 1); ctx.lineTo(hlX, BH / 2 - 1); ctx.stroke();
      }
    });
    ctx.restore();

    posts(ctx, comp, ['neutral', 'neutral']);
  }

  // ============================================================
  // 干电池组
  // ============================================================
  // 电池盒的几何尺寸（局部坐标，未旋转）。
  // 抽出来是因为「盒子有多宽」不只是画图的事：走线算法得知道盒子占哪块地，
  // 否则导线会从盒体中间穿过去。测试也靠它做穿插检查，不能和画图各写一份。
  //
  // 盒子不能比两个接线柱之间的跨度还宽：4 节时 4×44+18 = 194 > 2×HALF = 140，
  // 接线柱就陷进盒体里了，接上去的导线看着像从盒子中间钻出来，盒子上的
  // 加减号也会跑到接线柱内侧。接线柱必须钉在 ±HALF（全站网格规范），
  // 所以这里反过来把电池本身按比例缩小，宽高比保持不变。
  // 端板往里压住电池头的那一段（局部单位）。这是「电池身上的记号能不能露出来」
  // 的总闸门：端板压住多少，记号就得从节端往里让多少，压得越深能印记号的地方
  // 越少。所以它按节长收口（见 drawBattery）：2 节及以下固定 6，3 节 4.5、
  // 4 节 3.4——再大就把整节让给端板了，4 节往上就再也印不下记号。
  // 下限也卡着「端板必须盖住电池的圆角」：圆角深 0.15·CHD，而 CHD = 0.613·CWD，
  // 即圆角 ≈ 0.092·CWD < 0.12·CWD，正好够。
  var OV_MAX = 6, OV_RATE = 0.12;

  // 端板那对极性记号（＋ / −）在【元件自身坐标系】里的位置与大小。
  // 抽成函数是给自检用的：断言要拿【同一份】几何去点它，而不是在测试里按
  // boxW / padx / OV_RATE 再算一遍 —— 重算一遍等于把「几何改了、测试还按老
  // 位置取样」这个洞留着，取样点漂到记号外面就量到端板底色，断言静默失效。
  // 返回 { x, y, mk }：x = 正极（＋）记号中心，负极（−）在 −x，y 两者相同，
  // mk = 半臂长。两端记号都印在端板上、离接线柱最近的地方。
  function batteryMarkLocal(cells) {
    var SZ = batterySize(cells);
    var EW = SZ.padx + Math.min(OV_MAX, SZ.cwd * OV_RATE);
    return { x: SZ.boxW / 2 - EW / 2, y: -SZ.chd * 0.16,
             mk: Math.max(4.5, Math.min(6.5, EW * 0.33)) };
  }

  // 表盘中心（元件自身坐标系）+ 表盘尺寸。和 batteryMarkLocal 同一个理由：断言要
  // 拿【同一份】几何去点它，而不是在测试里按 MET.DIAL 再算一遍 —— 重算一遍等于把
  // 「几何改了、取样点漂到表盘外面」这个洞留着（那时量到的是表壳，断言静默失效）。
  // 「烧坏的表盘熏黑」那条像素腿就点在这个中心上。
  function meterDialCenter() {
    return { x: MET.DIAL.x + MET.DIAL.w / 2, y: MET.DIAL.y + MET.DIAL.h / 2,
             w: MET.DIAL.w, h: MET.DIAL.h };
  }

  function batterySize(cells) {
    // 单节做得【长】一点：电池身上要印得下两头的极性记号（左「−」右「＋」），
    // 一节里挤两个记号需要长度；同时把直径收到 38 让整条电池看起来是「长条」
    // 而不是一截胖墩。
    // 长度有硬上限：盒子半宽必须 < 70（接线柱钉在 ±70，再宽接线柱就陷进盒体，
    // 走线检查会把「导线夹在柱子上」判成「穿过元件」），见下面的 maxTotal。
    var CWD = cells <= 2 ? 62 : 50;      // 单节电池长
    var CHD = 38;                        // 单节电池直径
    // PADX 是电池组到盒沿的留白，端板就立在这段留白上、往里压住电池头 OV。
    // 这段留白【不能小】：端板压住多少，电池身上的记号就得让出多少，
    // 留白小 → 端板压得深 → 记号被吃掉得多。上一版 PADX=4、端板厚 16，
    // 一节 62 长的电池被压掉 12，左端那个「−」只剩右半截，远看是一张白标签。
    var PADX = 10, PADY = 16;
    var maxTotal = 2 * HALF - PADX * 2 - 8;                 // 112：盒宽 ≤ 132
    var k = Math.min(1, maxTotal / (cells * CWD));
    // 整节等比缩小，盒壁的留白也跟着缩，不然 4 节时电池小小的、盒子却空一圈。
    CWD *= k; CHD *= k; PADX *= k; PADY *= k;
    // PADY 兜的是电压标注那条带：bandH = PADY + 2 − 0.075·CHD ≥ 9 才印得下
    // 「1.5V × 4」。4 节（6V）那档正好压在临界上，PADY 从 15 提到 16 就是为了
    // 补上 maxTotal 缩小（124 → 114）带走的这点高度。
    return { cwd: CWD, chd: CHD, k: k, padx: PADX,
             boxW: cells * CWD + PADX * 2, boxH: CHD + PADY * 2 + 4 };
  }

  // 元件实心本体的局部包围盒（半宽 / 半高）。导线走线时用来避让，
  // 只保证「不穿过元件肚子」，接线柱附近的引线不算在内。
  function bodyBox(comp) {
    switch (comp.type) {
      case 'battery': {
        var P = comp.params || {};
        var per = P.emfPerCell != null ? +P.emfPerCell : 1.5;
        var emf = P.emf != null ? +P.emf : (P.cells != null ? P.cells * per : 3);
        var s = batterySize(Math.max(1, Math.min(6, Math.round(emf / per))));
        return { hw: s.boxW / 2, hh: s.boxH / 2 };
      }
      // 学生电源：整台机箱的包围盒（前面板 ±106，右侧面再厚 18 ⇒ 最右 124；
      // 顶面抬高 12 ⇒ 最上 −66；下沿 44）。
      // 🔴 这一件是【例外】：接线柱长在面板【里面】（右下角），所以不能再靠
      //    「hw 小于柱子坐标」把它们挡在盒子外 —— 盒子就是整台机箱，柱子本来
      //    就长在机箱上。走线避让（laneFree）只判竖车道，柱子那截横引线不参与，
      //    所以不会把「导线夹在柱子上」误判成「导线穿过元件」。
      // ⚠️ 改了 PSU 的 HW / DEP / TOP / DTOP / BOT，这两个数要跟着重算。
      case 'power': return { hw: 126, hh: 66 };
      // 开关和灯泡是「板子铺在导线底下、柱子从板面上立起来」的一类，
      // 和两只表正好反过来。盒子取「够用不缩」的那一档，但要卡死 ≤ 73：
      // 接线柱在 ±70，走线检查算的是 |lx| < hw−3，hw 再大柱子就被圈进盒子里，
      // 「导线夹在柱子上」会被误判成「导线穿过元件」。
      case 'switch': return { hw: 70, hh: 62 };          // 底板 ±70，手柄抬起后顶到 −62
      // 单刀双掷：同一块底板（±70），本体长在板面上方 —— 最高的地方是
      // 【翘起来的那一头刀片】（PIV.y − HALF·sin15° − 刀片半厚 ≈ −61.7）。
      // hw 必须卡死 ≤ 70：接线柱钉在 ±70 上，再宽柱子就被圈进盒子里，
      // 「导线夹在柱子上」会被误判成「导线穿过元件」。
      case 'spdt': return { hw: 70, hh: 62 };
      case 'bulb': return { hw: 70, hh: 74 };            // 底板 ±70，玻璃泡顶 y = −71.5
      // 三个新元件都是「示教板」：和开关 / 灯泡同一块底板（±70），本体长在板面上方。
      // 所以 hw 给 70（板宽），hh 只要盖住本体到板面这一截 —— 一超过 70，
      // 钉在 ±70 的接线柱就被圈回盒子里，「导线夹在柱子上」会被误判成
      // 「导线穿过元件」（和表头那条注释是同一个坑）。
      case 'led': return { hw: 70, hh: 46 };             // 底板 ±70，管身顶 y = −45
      case 'motor': return { hw: 70, hh: 60 };           // 底板 ±70，机身/螺旋桨顶 y = −58
      case 'bell': return { hw: 70, hh: 60 };            // 底板 ±70，铃碗顶 y = −36
      // 导体板：底板 ±70，金属条贴在板面正面（y = 6 ~ 27），本体不长到导线上面，
      // 所以 hh 只要盖住板面这一截。同样卡死 ≤ 70 —— 柱子钉在 ±70 上。
      case 'plate': return { hw: 70, hh: 30 };           // 板面下沿 y = 30
      // 接线点：就是一个小圆点，盒子贴着它给 —— 给大了会抢邻居元件的点击，
      // 也会让「导线穿过元件」的检查把它当成障碍。
      case 'junction': return { hw: 9, hh: 9 };
      // 表头：整台仪器的包围盒（表壳 + 底座）。接线柱在 POST_Y，
      // 故意落在盒子【外面】——导线夹在柱子上，不该被当成穿体。
      // 所以 hh 有【上限 70】：表壳为了放下大量程那排数字往上长到了 −104（见 MET），
      // 但盒子不能跟着长——一过 75，接线柱（POST_Y = 72）就被圈回盒子里，
      // 挂着导线的柱子会被判成「导线穿过表体」。盒子比表壳矮一截是有意的。
      case 'ammeter': case 'voltmeter':
        return { hw: MET.BASE_HW + 4, hh: Math.min(-MET.CASE_TOP, 70) };
      // 灵敏电流计：同一只表壳、同一块底座 ⇒ 包围盒和电流表一字不差。
      // （它是两只柱不是三只，但盒子只关心「表体占多大」，柱子本来就在盒外。）
      case 'galvanometer':
        return { hw: MET.BASE_HW + 4, hh: Math.min(-MET.CASE_TOP, 70) };
      case 'rheostat': return { hw: RHEO.BW / 2, hh: RHEO.BH / 2 }; // 含陶瓷管与滑片杆
      default: return { hw: 54, hh: 20 };                // 定值电阻 BW/BH = 108/40
    }
  }

  // ============================================================
  // 学生电源（直流稳压电源）
  // ------------------------------------------------------------
  // 照人教版课本插图那台机器画：浅灰方机箱、四分之三视角（看得见顶面和右侧
  // 面），前面板上
  //     · 左上  圆形指示灯（通电就亮）
  //     · 左中  大旋钮 + 外圈刻度盘（3~36V，12 档）
  //     · 左下  方形电源开关（真的能拨）
  //     · 右上  「学生电源」丝印
  //     · 右下  红黑两个接线柱（+ / −）
  //
  // ⚠️ 全站只有这一件是四分之三视角。这不是风格跑偏 —— 课本上这台机器就是
  //    这么画的（用户要求「1:1 还原」）。厚度压得很浅（18 / 12），远看仍是一台
  //    方机箱，不会显得比别的元件「歪」。
  //
  // ⚠️ 面板做宽到 212×98 —— 【课本上这台机器是只扁箱子】，量那幅图：前面板
  //    约 297×117 px，宽高比 2.54:1；别的元件（小灯泡 / 开关）是 140 宽的一
  //    块板，这台机器横着快是它们的一倍半。第一版只给了 144×84（1.71:1），
  //    症状不是「窄一点」这么轻 —— 12 个刻度数字被挤到直径 88 的那一圈里，
  //    每格只剩 11.2px，而且最左边那个「12」正好压在指示灯上（实测重叠
  //    2.1 × 4.4 px）。宽高比摆对了，这一圈数字才排得开（见 PSU.DIAL 那段）。
  //
  // 🔴 改 HW / TOP / BOT / DEP / DTOP 会牵到五处，改之前一起看一遍：
  //    · 本文件 bodyBox 的 case 'power'（走线避让的包围盒）
  //    · 本文件 TERMINALS.power（两个接线柱就在这块面板上，别跑到箱子外）
  //    · circuit-editor 的 BODY.power 与 PSU_SLACK 那一族命中框
  //    · circuit-3d-kit 的 BUILDERS.power（3D 机箱宽度要跟得上柱子）
  //    · 页面里 LG_VIEW.power（图例取景框，小一圈就把机箱切掉一条）
  //
  // ⚠️ 旋钮能【拖】、开关能【点】。几何全部从下面这个 PSU 导出，命中判定与
  //    画法共用同一份数字 —— 各写一份迟早漂移成「看得见却拧不动」。
  // ============================================================
  var PSU = {
    HW: 106, TOP: -54, BOT: 44,       // 前面板：半宽 / 上沿 / 下沿（212 × 98）
    DEP: 18, DTOP: 12,                // 立体厚度（顶面与右侧面向【右上】偏移）
    // 电压调节旋钮。摆在【面板左侧偏中】—— 课本图上旋钮中心在面板宽度 0.31
    // 处（−106 + 0.31×212 ≈ −40），不是正中间：右边要留给丝印和接线柱。
    //   r  = 法兰（贴面板那一圈环）的【外】径
    //   ri = 法兰的【内】径 = 桶身在面板处的半径
    //   rt = 桶身顶面（捏手）的半径
    // 🔴 这三个半径定的是「旋钮从正面看长什么样」，别随手改（量的是课本那幅图，
    //    折算到面板 212 宽之后）：法兰半径 22、桶身根部 19、顶面 13.5。
    //    · r − ri = 法兰环的宽度，只有 3 —— 课本图上它就是一道【窄环】。
    //      给太宽（比如把整块圆盘都填满）那只旋钮会读成一只球；
    //    · ri − rt = 桶身的【收口】量（19 → 13.5），课本上收得很明显：
    //      顶面只有法兰半径的六成，所以那一圈侧壁才看得出是一圈【齿】；
    //    · KNOB_OUT + rt ≤ r：桶身的可见轮廓要收在法兰外圆【里面】
    //      （22 是相切，所以取 8 + 13.5 = 21.5）。
    KNOB: { x: -38, y: 0, r: 22, ri: 19, rt: 13.5 },
    // 刻度盘：一圈刻度线（r0~r1）+ 一圈数字（rt）。角度是 canvas 约定
    // （0 = 正右、顺时针为正），190° → 350°：从左下经正上方扫到右下。
    //
    // ⚠️ 这三个半径是【挤出来的】，别随手放大：
    //    · r0 = 23 紧贴旋钮法兰的左右两极（法兰 r = 22），刻度线才像是从旋钮
    //      边上长出来的；
    //    · rt = 46 是【能排下 12 个数字】的半径：190°~350° 共 160°，12 个数字
    //      均分就是 14.5°，在 46 上是 11.7px 一格；字号 6.5 的两位数是 7.2px 宽，
    //      留 4.5px 空隙。缩到 38 只剩 9.7px，12 和 15 就粘成一个「1215」了；
    //    · 数字那一圈再往外就顶到面板上沿：中心 y = 0，rt = 46 时最上面那个
    //      数字（18 / 21）的中心在 −45.6、字高 6.5 ⇒ 上边缘 −48.9，面板上沿 −54。
    DIAL: { r0: 23, r1: 38, rt: 46, a0: 190, a1: 350 },
    // 方形电源开关（左下角）与圆形指示灯（左上角）。两者都要【让开刻度盘】：
    // 开关整块落在旋钮左边（右沿 −70，法兰最左 −60，留 10px），指示灯摆在
    // 面板左上角、和刻度盘最左那个「12」（x ≈ −69…−62）横向差 15px 以上。
    // ⚠️ 指示灯【不能】再往右下挪：第一版它在 (−58,−38)，正好被「12」压住
    //    （实测重叠 2.1 × 4.4 px，绿点边上糊了半个「1」）。
    // 🔴 开关是【方形凹槽里一根上下拨的拨杆】，不是左右倒的翘板（用户明确指出的）。
    //    所以槽做成【竖长】的 20×30：拨杆从槽心（支点）指向上端 = 合上、下端 =
    //    断开，行程才够长、远看读得出通断。见 drawPowerSupply 里那一段。
    SW: { x: -80, y: 20, w: 20, h: 30 },
    LAMP: { x: -90, y: -42, r: 5.5 },
    READY: 32,                               // 当前电压那行丝印的 y
    // ── 「拧/插在前表面上」的东西各自的凸出量（屏幕像素）────────────
    // 它们一律沿 FACE（前表面法线，见下面那个 IIFE）凸出去。
    //   · 旋钮：法兰环（外径 KNOB.r / 内径 KNOB.ri）压在面板上不动，桶身的顶面
    //     （半径 KNOB.rt）沿 FACE 偏出 KNOB_OUT ⇒ 露在【右上】那一侧的月牙就是
    //     桶身侧壁；
    //   · 接线柱：柱【尖】就落在锚点（TERMINALS.power，导线接上来的那一点）上，
    //     柱身沿 −FACE 缩进面板 ⇒ 露出来的那一截正对着观察者。
    KNOB_OUT: 8,
    // 接线柱的粗细与螺杆高。别随手放大：柱长 = (POST_TIP_H + POST_NECK) ×
    // POST_SCALE ≈ 18.8，柱根落在锚点沿 −FACE 缩进 18.8 的地方 —— 再长就顶出
    // 面板右沿（锚点 78 + 18.8×0.832 ≈ 93.6，螺母半宽再 +3 ≈ 96.6）。
    POST_SCALE: 1.1, POST_NECK: 5,
    // 两个接线柱【就是】TERMINALS.power（同一份数字，别再抄一遍）。
    POSTS: TERMINALS.power,
    // 接线柱下面那块【垫板】（课本图上两个柱子是拧在一块凸起的小板上的）。
    // 坐标照 POSTS 推：两柱在 36 / 78，板子左右各让出 20 / 20。
    // 🔴 板子必须罩得住【柱子的可见部分】—— 柱子现在是【斜插】的：柱尖在锚点上、
    //    柱根沿 −FACE（右上）缩进 18.8，所以右柱的柱根落在 (93.6, 15.6) 附近，
    //    螺母再往两侧各撑 3px ⇒ 右沿要 98 才够（原来是照「竖直的柱子」量到 94 的，
    //    斜过来以后 94 会把右柱的柱根露在板子外面）。自检有 plateCovers 兜着。
    PLATE: { x0: 16, y0: 9, x1: 98, y1: 36 },
    VMIN: 3, VMAX: 36, TICKS: 12,            // 输出电压 3~36V，12 档
  };

  // 🔴🔴 整个学生电源的绘制都要用这一个方向：「从前表面往外、朝观察者」。
  //
  // 机箱是长方体，我们看到的是【前表面 + 顶面 + 右侧面】。顶面与右侧面是往
  // 【右上】偏 (DEP, −DTOP) 画出纵深的 ⇒ 观察者在左上前方 ⇒ 前表面的法线
  // （也就是「朝观察者」）在屏幕上就是【左下】= (−DEP, +DTOP)。
  //
  // 拧/插在前表面上的东西（旋钮、拨杆、接线柱）一律沿它凸出去。
  // ⚠️ 沿屏幕【竖直】方向凸 = 读成「立在一块水平板上」，也就是用户报的
  //    「好像平放到地面上」——那是把前表面当成了地面。前表面是【竖直】的。
  //
  // 不写死数字：改了 DEP / DTOP 的角度，这里跟着变（自检有一条等式钉住它）。
  (function () {
    var h = Math.hypot(PSU.DEP, PSU.DTOP);
    PSU.NX = -PSU.DEP / h;              // ≈ −0.832（左）
    PSU.NY = PSU.DTOP / h;              // ≈ +0.555（下）
  })();
  // 最近一次画学生电源时【实际画出去】的几何（自检用）。
  // 和页面里的 tagDrawn 一个道理：断言读「画出去的那一份」，不按公式再算一遍 ——
  // 算的那份一旦和画的那份漂移，症状就是「看着是斜的、断言说正的」。
  var psuDrawn = null;

  // 学生电源的柱子【斜插在前表面上】：柱轴垂直于前表面 ⇒ 画面上朝观察者
  // （左下）伸出来。返回值是「柱尖朝外」这个方向在【元件自身坐标系】里的角度
  // （posts() 的 faceAngle 参数就吃它）。
  // 不写死数字：改了 DEP / DTOP，NX / NY 跟着变，这里跟着变。
  function psuFaceAngle() {
    return Math.atan2(PSU.NX, -PSU.NY);
  }

  // 电压 → 刻度盘上的比例（0~1）。画指针和拖拽反解共用这一份。
  function psuFracOf(emf) {
    var f = ((+emf || 0) - PSU.VMIN) / (PSU.VMAX - PSU.VMIN);
    return f < 0 ? 0 : (f > 1 ? 1 : f);
  }
  function psuAngleOf(emf) {
    var D = PSU.DIAL;
    return (D.a0 + (D.a1 - D.a0) * psuFracOf(emf)) * Math.PI / 180;
  }
  // 拖拽用：屏幕上的一个角度 → 电压。按 0.5V 吸附 —— 和参数面板那根滑块的
  // 步进必须一致，不吸附的话面板显示 6.0、画布上其实是 6.0437，两边永远对不上。
  //
  // 🔴 刻度盘只占 190°~350°（上半圈），剩下那 200°（右 → 下 → 左）是【缺口】。
  //    落在缺口里的角度必须按【就近】夹到两端：
  //      · 指针拖到右下（≈0°）→ 36V，拖到左下（≈180°）→ 3V；
  //      · 一律夹到 36 的话，把旋钮往左下方拖会跳到最大值 —— 和学生的手感正好相反。
  //    ⚠️ 更要命的是【缺口边界上的浮点误差】：190° 那一端稍微差一点点（比如
  //    189.9998，真实鼠标坐标来回换算必然带这种误差），原来那句
  //    「deg < a0 就 += 360」会把它一路推到 549.9998，算出 36V ——
  //    也就是「明明拧到了最小档，读数却是最大」。自检里那次「拖到 190° 实得
  //    36V」就是这么来的。所以先把角度规整到 [0,360)，再按就近判断。
  function psuEmfFromAngle(a) {
    var D = PSU.DIAL;
    var deg = a * 180 / Math.PI;
    deg = ((deg % 360) + 360) % 360;             // atan2 给 (−180,180] → [0,360)
    var f;
    if (deg >= D.a0 && deg <= D.a1) {
      f = (deg - D.a0) / (D.a1 - D.a0);
    } else {
      // 缺口里：比到两端的【角距离】（取 360 的补角，免得跨 0° 时算成 350）
      var d0 = Math.abs(deg - D.a0); d0 = Math.min(d0, 360 - d0);
      var d1 = Math.abs(deg - D.a1); d1 = Math.min(d1, 360 - d1);
      f = (d0 <= d1) ? 0 : 1;
    }
    return Math.round((PSU.VMIN + (PSU.VMAX - PSU.VMIN) * f) * 2) / 2;
  }
  // 旋钮在屏幕上的抓取半径（= 法兰那个整圆的半径 K.r）。
  //
  // 🔴 原来这里按【椭圆】取点（竖直半轴 = K.r × 0.60），因为那时候旋钮画成
  //    「竖直轴的椭圆」。现在旋钮是一只【拧在竖直前表面上的圆柱】—— 前表面与
  //    画面平行，前表面上的圆投影下来还是圆（见 drawPowerSupply 里那段）——
  //    所以这里就是常数 K.r，和角度无关。
  //    留着函数不内联：指示线（画在捏手顶面上，长度 = 它 × GRIP）和自检的
  //    dragTo（要落在这只旋钮上）两处都调它，哪天改回椭圆的画法只改这一处，
  //    不会出现「两处各算一份、对不上」。
  function psuKnobRadius(a) {
    return PSU.KNOB.r;
  }

  function drawPowerSupply(ctx, comp, rec) {
    var P = comp.params || {};
    var S = PSU, K = S.KNOB, DL = S.DIAL, SW = S.SW, LP = S.LAMP;
    var emf = P.emf != null ? +P.emf : 6;
    var on = P.on !== false;                  // 面板上那颗电源开关（默认合上）
    var sc = ctxScale(ctx);
    var L = -S.HW, R = S.HW, T = S.TOP, B = S.BOT, dx = S.DEP, dy = S.DTOP;
    // 本轮「视角返工」的落点都记在这里，自检读【画出去的那一份】。
    // 坐标是元件自身坐标系（画之前那一层），和 PSU 里那些常数同一口径。
    psuDrawn = {
      face: { x: S.NX, y: S.NY },
      knob: null, grip: null, lever: null, posts: [],
      plate: { x0: S.PLATE.x0, y0: S.PLATE.y0, x1: S.PLATE.x1, y1: S.PLATE.y1 },
    };

    ctx.save();
    ctx.translate(comp.x, comp.y);
    ctx.rotate((comp.rot || 0) * Math.PI / 180);
    // 「对调极性」= 整台机箱原地左右镜像（和干电池一个规矩，见 drawBattery）。
    // ⚠️ 镜像只加在【本体】这一段里：接线柱的世界坐标来自 terminalWorld()，
    //    那里已经按 flip 把 x 取过负了，在这里再镜像一次会把柱子画到相反的一侧。
    if (flipOf(comp)) ctx.scale(-1, 1);

    // ── 接触阴影 ────────────────────────────────────────────────
    contactShadow(ctx, (L + R + dx) / 2, B + 2, (R - L + dx) * 0.5, 7, 0.26);

    // ── 顶面（平行四边形）：四分之三视角里唯一看得见的水平面 ─────
    ctx.beginPath();
    ctx.moveTo(L, T); ctx.lineTo(R, T);
    ctx.lineTo(R + dx, T - dy); ctx.lineTo(L + dx, T - dy);
    ctx.closePath();
    ctx.fillStyle = linGrad(ctx, 0, T - dy, 0, T, [[0, '#d5dade'], [1, '#bcc3ca']]);
    ctx.fill();
    ctx.strokeStyle = 'rgba(71,85,105,0.42)'; ctx.lineWidth = 1; ctx.stroke();

    // ── 右侧面 ──────────────────────────────────────────────────
    ctx.beginPath();
    ctx.moveTo(R, T); ctx.lineTo(R + dx, T - dy);
    ctx.lineTo(R + dx, B - dy); ctx.lineTo(R, B);
    ctx.closePath();
    ctx.fillStyle = linGrad(ctx, R, 0, R + dx, 0, [[0, '#aeb6bf'], [1, '#8b949e']]);
    ctx.fill();
    ctx.strokeStyle = 'rgba(71,85,105,0.42)'; ctx.lineWidth = 1; ctx.stroke();

    // ── 前面板 ──────────────────────────────────────────────────
    ctx.save();
    ctx.shadowColor = 'rgba(15,23,42,0.26)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 5;
    roundRect(ctx, L, T, R - L, B - T, 4);
    ctx.fillStyle = linGrad(ctx, 0, T, 0, B,
      [[0, '#e6eaee'], [0.42, '#d8dde2'], [1, '#c3cad1']]);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(71,85,105,0.55)'; ctx.lineWidth = 1.3;
    roundRect(ctx, L, T, R - L, B - T, 4); ctx.stroke();

    // 面板内嵌沉台：比箱体亮一档，读出「这是一块面板」
    var pX = L + 5, pY = T + 5, pW = (R - L) - 10, pH = (B - T) - 10;
    ctx.fillStyle = linGrad(ctx, 0, pY, 0, pY + pH, [[0, '#eff2f5'], [1, '#dee3e8']]);
    roundRect(ctx, pX, pY, pW, pH, 3); ctx.fill();
    ctx.strokeStyle = 'rgba(100,116,139,0.28)'; ctx.lineWidth = 0.9;
    roundRect(ctx, pX, pY, pW, pH, 3); ctx.stroke();

    // ── 接线柱垫板（右下）────────────────────────────────────────
    // 课本图上那两个柱子不是直接拧在面板上的，是拧在一块【凸起的小板】上。
    // 画在丝印之前、posts() 之前：柱子由宿主在导线之后补画，那时这块早就铺好。
    var PL = S.PLATE;
    ctx.beginPath();
    roundRect(ctx, PL.x0, PL.y0, PL.x1 - PL.x0, PL.y1 - PL.y0, 3);
    ctx.fillStyle = linGrad(ctx, 0, PL.y0, 0, PL.y1, [[0, '#eef1f5'], [1, '#d5dbe2']]);
    ctx.fill();
    ctx.strokeStyle = 'rgba(100,116,139,0.38)'; ctx.lineWidth = 0.9; ctx.stroke();
    // 板子上沿一道亮边：没有它这块板读成「面板上刷了块浅灰」，看不出凸起。
    ctx.beginPath();
    ctx.moveTo(PL.x0 + 2, PL.y0 + 0.8); ctx.lineTo(PL.x1 - 2, PL.y0 + 0.8);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1; ctx.stroke();

    // ── 刻度盘：一圈刻度线 + 一圈数字（先画，旋钮压在上面）──────
    var i, n = S.TICKS;
    // 一道【细弧线】把 12 根刻度线的外端串起来。课本图上那一圈数字就是印在
    // 这么一道弧上的 —— 只有 12 根孤立的短线时，远看是一把扇子，不像刻度盘。
    ctx.beginPath();
    ctx.arc(K.x, K.y, DL.r1, DL.a0 * Math.PI / 180, DL.a1 * Math.PI / 180);
    ctx.strokeStyle = 'rgba(107,114,128,0.75)'; ctx.lineWidth = 1;
    ctx.stroke();
    for (i = 0; i < n; i++) {
      var t = i / (n - 1);
      var a = (DL.a0 + (DL.a1 - DL.a0) * t) * Math.PI / 180;
      var ca = Math.cos(a), sa = Math.sin(a);
      var big = (i === 0 || i === n - 1);
      ctx.beginPath();
      ctx.moveTo(K.x + ca * DL.r0, K.y + sa * DL.r0);
      ctx.lineTo(K.x + ca * DL.r1, K.y + sa * DL.r1);
      ctx.strokeStyle = big ? '#374151' : '#6b7280';
      ctx.lineWidth = big ? 1.8 : 1.1;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    // 数字：只在够大时画（缩略图上会糊成一坨脏点，见 ctxScale 的注释）
    if (sc >= 0.85) {
      for (i = 0; i < n; i++) {
        var t2 = i / (n - 1);
        var a2 = (DL.a0 + (DL.a1 - DL.a0) * t2) * Math.PI / 180;
        silk(ctx, String(Math.round(S.VMIN + (S.VMAX - S.VMIN) * t2)),
             K.x + Math.cos(a2) * DL.rt, K.y + Math.sin(a2) * DL.rt, 6.5, '#3f4a58');
      }
    }

    // ── 旋钮：拧在【竖直的前表面】上的一只滚花圆柱 ────────────────
    // 🔴🔴 这一段是本轮「视角返工」的核心。第一版画成「竖直轴的椭圆 + 往下的
    //    椭圆柱身」（kry = K.r × 0.60、侧壁在 K.y + kh）—— 那正是一只【平放在
    //    水平桌面上的圆柱】从左上斜看过去的样子，所以读出来是「这只旋钮躺在地
    //    上」（用户原话）。而且刻度盘画的是整圆、旋钮是椭圆，两者根本不在同一个
    //    平面上：一眼就能看出「旋钮和它的刻度盘不是一块东西」。
    //
    // 前表面与画面【平行】⇒ 画在前表面上的圆投影下来还是圆。结构分三层，一层比
    // 一层更靠近观察者（都沿 FACE 叠）：
    //    ① 法兰环：外径 KNOB.r、内径 KNOB.ri，平贴在面板上；
    //    ② 桶身侧壁：外径 KNOB.ri，从面板沿 FACE 伸出 KNOB_OUT，顶面收到 KNOB.rt；
    //    ③ 捏手顶面：半径 KNOB.rt 的【整圆】+ 指示线。
    //    侧壁露在【右上】那一侧 —— 近端面朝观察者（左下）偏出去，远端就从右上露。
    //    ⚠️ 沿屏幕【竖直】方向凸是错的：那等于把前表面当成了地面。
    var KR = K.r, KI = K.ri, KT = K.rt;
    var gx = K.x + S.NX * S.KNOB_OUT, gy = K.y + S.NY * S.KNOB_OUT;
    psuDrawn.knob = { x: K.x, y: K.y, r: KR, ri: KI };
    psuDrawn.grip = { x: gx, y: gy, r: KT };
    // ① 法兰环：外圆 + 内圆【反向】绕 —— nonzero 填充规则下填出来的正好是那个
    //    环（同心圆同向绕会填成一整块实心圆盘，那只旋钮就变成一只球了）。
    ctx.beginPath();
    ctx.arc(K.x, K.y, KR, 0, 6.284);
    ctx.arc(K.x, K.y, KI, 0, 6.284, true);
    ctx.fillStyle = linGrad(ctx, 0, K.y - KR, 0, K.y + KR,
      [[0, '#eaeff4'], [0.5, '#c9d1d9'], [1, '#a3adb7']]);
    ctx.fill();
    ctx.strokeStyle = 'rgba(51,65,85,0.50)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(K.x, K.y, KR, 0, 6.284); ctx.stroke();
    // 桶身与法兰的交界：一道暗环，桶身才像是「从环里长出来的」
    ctx.beginPath(); ctx.arc(K.x, K.y, KI, 0, 6.284);
    ctx.strokeStyle = 'rgba(51,65,85,0.34)'; ctx.lineWidth = 1; ctx.stroke();
    // ② 桶身侧壁：先把整个 KI 圆铺出来，捏手一会儿压在上面 —— 露出来的那一弯
    //    自动就是侧壁，不必去解两个圆的交点（解错了就是一条歪边）。
    ctx.save();
    ctx.beginPath(); ctx.arc(K.x, K.y, KI, 0, 6.284); ctx.clip();
    // 侧壁的横向 = FACE 的垂线（画面上指向左上）。光从左上打来 ⇒ 那一侧亮。
    var kpx2 = -S.NY, kpy2 = S.NX;
    ctx.fillStyle = linGrad(ctx, K.x + kpx2 * KI, K.y + kpy2 * KI,
                                 K.x - kpx2 * KI, K.y - kpy2 * KI,
      [[0, '#e4eaf0'], [0.45, '#aab4be'], [1, '#7c8792']]);
    ctx.beginPath(); ctx.arc(K.x, K.y, KI, 0, 6.284); ctx.fill();
    // 滚花齿：真螺母的搓花是一根根【沿柱轴】的棱。柱轴在画面上就是 FACE ⇒
    // 每根齿是「桶身根部圆周上的 θ」到「顶面圆周上同一个 θ」的一条短线。
    // 🔴 两个数都是量着课本定的，别随手加：
    //    · 只有 12 根 —— 课本那只桶身上一眼能数出 4~5 道【宽齿】（远看像一颗
    //      六角螺母）。24 根细线画出来是一圈「涡轮/风车」，完全不是那个东西；
    //    · 只画【朝右上】那一带的齿 —— 也就是桶身侧壁真正露出来的那一弯。
    //      facing = 这个方位在「右上」方向上的投影。不按方位筛的话，齿会绕满
    //      一整圈（侧壁在反侧根本不露出来，那里不该有齿）。
    if (sc >= 0.85) {
      for (i = 0; i < 12; i++) {
        var kt = i / 12 * Math.PI * 2, kc = Math.cos(kt), ks = Math.sin(kt);
        var facing = -kc * S.NX - ks * S.NY;
        var tal = 0.36 * Math.min(1, Math.max(0, (facing - 0.45) / 0.45));
        if (tal < 0.02) continue;
        ctx.strokeStyle = 'rgba(51,65,85,' + tal.toFixed(3) + ')';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(K.x + kc * KI, K.y + ks * KI);
        ctx.lineTo(gx + kc * KT, gy + ks * KT);
        ctx.stroke();
      }
    }
    ctx.restore();
    // ③ 捏手顶面：整圆。渐变必须用【线性】（左上亮 → 右下暗）—— 径向渐变会把
    //    这块平面画成一只球，那和「旋钮躺在地上」一样是读错了朝向。
    ctx.beginPath(); ctx.arc(gx, gy, KT, 0, 6.284);
    ctx.fillStyle = linGrad(ctx, gx - KT * 0.75, gy - KT * 0.75,
                                 gx + KT * 0.85, gy + KT * 0.85,
      [[0, '#fbfdfe'], [0.5, '#e2e8ee'], [1, '#c2cbd4']]);
    ctx.fill();
    ctx.strokeStyle = 'rgba(51,65,85,0.45)'; ctx.lineWidth = 1; ctx.stroke();
    // 指示线：角度直接取刻度盘那一份（psuAngleOf），画在【捏手的顶面】上 ——
    // 顶面是整圆，所以线的长度按捏手半径 KT 取（按法兰半径会戳出顶面一截）。
    var pa = psuAngleOf(emf);
    ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(gx + Math.cos(pa) * KT * 0.16, gy + Math.sin(pa) * KT * 0.16);
    ctx.lineTo(gx + Math.cos(pa) * KT * 0.86, gy + Math.sin(pa) * KT * 0.86);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(gx, gy, KT * 0.26, 0, 6.284);
    ctx.fillStyle = '#e9edf1'; ctx.fill();
    ctx.strokeStyle = 'rgba(51,65,85,0.35)'; ctx.lineWidth = 0.9; ctx.stroke();

    // ── 方形电源开关（左下）：凹槽里一根【上下拨】的拨杆 ─────────────
    // 🔴🔴 第一版画成「一颗左右倒的翘板」（ctx.rotate(on ? −0.44 : 0.44)），
    //    用户指出：真机是一根【往上拨 / 往下拨】的拨杆。
    // 前表面与画面【平行】⇒ 面板平面内的竖直方向就是【屏幕竖直】，所以「上 /
    // 下」在画面上就是上 / 下，不会因为视角而变成斜的。拨杆本身再沿 FACE 朝
    // 观察者凸出来一点点 —— 那一点正是「它长在竖直面板上」的证据。
    ctx.beginPath();
    roundRect(ctx, SW.x - SW.w / 2, SW.y - SW.h / 2, SW.w, SW.h, 3);
    ctx.fillStyle = linGrad(ctx, 0, SW.y - SW.h / 2, 0, SW.y + SW.h / 2,
      [[0, '#5a6570'], [1, '#39424c']]);
    ctx.fill();
    ctx.strokeStyle = 'rgba(15,23,42,0.60)'; ctx.lineWidth = 1; ctx.stroke();
    // 内凹（拨杆在里面上下走）
    ctx.beginPath();
    roundRect(ctx, SW.x - SW.w / 2 + 3.5, SW.y - SW.h / 2 + 3.5, SW.w - 7, SW.h - 7, 2);
    ctx.fillStyle = 'rgba(15,23,42,0.38)'; ctx.fill();
    // 中间一道【竖直导槽】：远看就告诉学生「这颗开关是上下拨的」，
    // 也给拨杆的行程一个看得见的范围（横向的翘板没有这道槽）。
    // ⚠️ 槽要比内凹【更深】一档才看得见（0.55 vs 0.38）—— 两档一样深的时候
    //    槽和底槽糊成一块，整颗开关就只剩一个黑洞。
    ctx.beginPath();
    roundRect(ctx, SW.x - 4.5, SW.y - SW.h / 2 + 3.5, 9, SW.h - 7, 4.5);
    ctx.fillStyle = 'rgba(15,23,42,0.55)'; ctx.fill();
    // 拨杆：支点在槽心，杆身指向上端（合上）/ 下端（断开），末端再沿 FACE 凸出。
    // 🔴 倾角取 60°（而不是真机的 ±30°）：本机箱的厚度压得浅（DEP:DTOP = 18:12
    //    ⇒ FACE 在画面里只有 33.7° 那么斜），30° 的摆角投影下来「合上」那一边
    //    几乎是【水平朝左】的，读不出「往上拨」。60° 摆角投影后是「上左 55° /
    //    下左 70°」，一上一下一眼分得开 —— 开关的可读性优先于摆角的真实性。
    var kphi = 60 * Math.PI / 180, kL = 9.5;
    var ksn = on ? -1 : 1;
    var tvx = SW.x + kL * S.NX * Math.cos(kphi);
    var tvy = SW.y + kL * (S.NY * Math.cos(kphi) + Math.sin(kphi) * ksn);
    psuDrawn.lever = { x: tvx, y: tvy, on: !!on, px: SW.x, py: SW.y };
    var kdx = tvx - SW.x, kdy = tvy - SW.y, klen = Math.hypot(kdx, kdy) || 1;
    var kpx = -kdy / klen, kpy = kdx / klen;          // 杆的法向（用来定杆的宽度）
    var w0 = 3.8, w1 = 3.0;                           // 杆根 / 杆尖的半宽
    ctx.beginPath();
    ctx.moveTo(SW.x + kpx * w0, SW.y + kpy * w0);
    ctx.lineTo(tvx + kpx * w1, tvy + kpy * w1);
    ctx.lineTo(tvx - kpx * w1, tvy - kpy * w1);
    ctx.lineTo(SW.x - kpx * w0, SW.y - kpy * w0);
    ctx.closePath();
    ctx.fillStyle = linGrad(ctx, SW.x + kpx * w0, SW.y + kpy * w0,
                                  SW.x - kpx * w0, SW.y - kpy * w0,
      [[0, '#f4f7fa'], [0.42, '#ccd4dc'], [1, '#8b959f']]);
    ctx.fill();
    ctx.strokeStyle = 'rgba(15,23,42,0.50)'; ctx.lineWidth = 0.9; ctx.stroke();
    // 杆尖的端面：一小块亮面，读成「一根有粗细的杆」，而不是一条线
    var kg2 = ctx.createRadialGradient(tvx - w1 * 0.35, tvy - w1 * 0.35, w1 * 0.1,
                                       tvx, tvy, w1);
    kg2.addColorStop(0, '#ffffff'); kg2.addColorStop(1, '#b9c2cb');
    ctx.beginPath(); ctx.arc(tvx, tvy, w1, 0, 6.284);
    ctx.fillStyle = kg2; ctx.fill();
    ctx.strokeStyle = 'rgba(15,23,42,0.40)'; ctx.lineWidth = 0.8; ctx.stroke();

    // ── 圆形指示灯（左上）：通电就亮 ─────────────────────────────
    ctx.beginPath(); ctx.arc(LP.x, LP.y, LP.r + 1.8, 0, 6.284);
    ctx.fillStyle = '#4a545e'; ctx.fill();
    ctx.beginPath(); ctx.arc(LP.x, LP.y, LP.r, 0, 6.284);
    if (on) {
      var lg = ctx.createRadialGradient(LP.x - LP.r * 0.3, LP.y - LP.r * 0.3, LP.r * 0.1,
                                        LP.x, LP.y, LP.r);
      lg.addColorStop(0, '#bbf7d0'); lg.addColorStop(0.55, '#22c55e'); lg.addColorStop(1, '#15803d');
      ctx.fillStyle = lg;
    } else {
      ctx.fillStyle = '#2f3944';
    }
    ctx.fill();
    ctx.strokeStyle = 'rgba(15,23,42,0.45)'; ctx.lineWidth = 0.9; ctx.stroke();

    // ── 丝印 ────────────────────────────────────────────────────
    // 机型名摆在右上角（课本就是这么印的：右端离面板右沿约 18px）。
    silk(ctx, '学生电源', 66, -42, 11, '#39424e');
    // 接线柱的极性记号。
    // 🔴 必须摆在柱子的【左上方】，不能摆正上方 —— 柱子是 posts() 在变换【之外】
    //    补画的，画在丝印【之后】；摆在正上方那 9px 字会被柱帽整个盖住。
    //    第一版就摆在 (x, y−13)，那正好落在滚花螺母的范围里（局部 y ∈ [−23, +2.7]），
    //    于是「+ / −」两个记号在画面上【一个都看不见】—— 而极性记号是学生认
    //    正负极的唯一依据，看不见等于这件器材没标极性。
    //    摆到左边 x−14 就整块出了螺母的横向范围（螺母半宽 6.75），压不到了。
    // ⚠️ 本轮柱子改成【斜插】（柱身从锚点沿 −FACE 往右上缩进面板）之后仍然成立：
    //    柱身朝右上走，左上方那一块反而更空了。
    silk(ctx, '+', S.POSTS[0].x - 14, S.POSTS[0].y - 10, 9.5, '#b91c1c');
    silk(ctx, '−', S.POSTS[1].x - 14, S.POSTS[1].y - 10, 9.5, '#1f2937');
    // 当前输出电压：旋钮正下方（拖旋钮时它就是那个「看得见的反馈」）。
    // 左沿约 −52 让开方形开关的右沿 −70，右沿约 −24 离接线柱垫板（左沿 16）还远。
    // ⚠️ 上沿要留出旋钮的【可见近端面】：法兰下沿 y = 22、捏手下沿 y ≈ 19.4，
    //    READY = 32 时字的上沿在 26.75 —— 压不到。
    silk(ctx, emf.toFixed(1) + ' V', K.x, S.READY, 10.5, '#1f2937');

    ctx.restore();

    // ── 接线柱：插在【前表面】上，柱身朝观察者（左下）伸出来 ──────────
    // 🔴🔴 第一版把柱子【竖直】立在面板上（drawBindingPost 的默认朝向），于是它
    //    读成「两个柱子摆在一块水平板上」（用户原话）。真机是【拧在前表面上】的，
    //    柱轴垂直于前表面 ⇒ 画面上朝左下伸出来。
    // 锚点（TERMINALS.power，也是导线接上来的那一点）取在柱【尖】上：柱身从锚点
    // 沿 −FACE 缩进面板里，露出来的那一截正对着观察者。
    var tipLen = (POST_TIP_H + S.POST_NECK) * S.POST_SCALE;
    for (i = 0; i < S.POSTS.length; i++) {
      var pbx = S.POSTS[i].x - S.NX * tipLen, pby = S.POSTS[i].y - S.NY * tipLen;
      // 柱根落在面板上的那一小片接触阴影。前表面与画面平行 ⇒ 这里的阴影是
      // 【正圆】；drawBindingPost 内部那只扁椭圆是给「立在台面上的柱子」用的，
      // 斜过来以后它会被拧成一道斜的暗痕，所以这里自己铺。
      contactShadow(ctx, pbx, pby, 9, 7, 0.30);
      psuDrawn.posts.push({ tip: { x: S.POSTS[i].x, y: S.POSTS[i].y },
                            base: { x: pbx, y: pby },
                            kind: i === 0 ? 'pos' : 'neg' });
    }
    // 柱子由 posts() 画（并把规格登记进 __posts，供宿主在导线之后补画一遍）。
    // 端子 0 = 正极（左）。kinds[i] 对应【端子序号】，不是左右顺序。
    // 最后一个参数 = 柱子斜插的角度：柱尖朝前表面法线（左下）。
    posts(ctx, comp, ['pos', 'neg'], S.POST_SCALE, S.POST_NECK, psuFaceAngle());
  }

  function drawBattery(ctx, comp, rec) {
    // 干电池只有 1.5V 一种规格，所以【节数由电动势反推】，不能反过来信
    // params.cells：两者对不上时（比如 emf=4.5 却写着 2 节），画面就会印出
    // 「两节 2.3V 电池」——现实中不存在这种电池，而电路又是按 4.5V 在解的。
    // 图和数自相矛盾，学生照着图算题会被带偏。
    var P = comp.params || {};
    var emfPerCell = P.emfPerCell != null ? +P.emfPerCell : 1.5;
    var emf = P.emf != null ? +P.emf : (P.cells != null ? P.cells * emfPerCell : 3);
    var cells = Math.max(1, Math.min(6, Math.round(emf / emfPerCell)));
    var perCell = emf / cells;

    ctx.save();
    ctx.translate(comp.x, comp.y);
    ctx.rotate((comp.rot || 0) * Math.PI / 180);
    // 「对调极性」= 把整台电池盒原地左右镜像：干电池的锌筒（负极）换到右边、
    // 黄铜帽（正极）换到左边，端板上的「＋」和「－」也跟着换边。
    // ⚠️ 镜像只加在【本体】这一段里，posts() 是在这段之外调的 —— 接线柱的
    //    世界坐标来自 terminalWorld()，那里已经按 flip 把 x 取过负了，
    //    在本体里再镜像一次就会把柱子画到相反的一侧去。
    if (flipOf(comp)) ctx.scale(-1, 1);

    // 电池盒：照人教版实物——一个开口朝上的浅灰塑料槽，干电池横躺在里面，
    // 靠前面那道【弧形托口】卡住。之所以不做成「竖直圆柱并列」：接线柱在左右
    // 两端，电池轴就该是水平的，竖着画的圆柱和水平引出的导线会互相打架。
    var SZ = batterySize(cells);         // 单节尺寸 + 盒体尺寸，见 batterySize()
    var CWD = SZ.cwd, CHD = SZ.chd, k = SZ.k;
    var totalW = cells * CWD;
    var boxW = SZ.boxW, boxH = SZ.boxH;
    var leadX = boxW / 2;

    // 引出导线：水平引出，不用斜线（斜线会让接线柱看起来像被导线戳穿）
    ctx.strokeStyle = PALETTE.metalLo; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-leadX, 0); ctx.lineTo(-HALF, 0);
    ctx.moveTo(leadX, 0); ctx.lineTo(HALF, 0);
    ctx.stroke();

    // ── 槽体的竖向分区（局部坐标，y 向下为正）──────────────────────
    //   endTop   端板顶：比电池还高，挡住电池两头，接线柱就拧在端板上
    //   backTop  后壁顶：在电池背后露出一条，撑出「槽」的纵深
    //   rimY     前壁托口平段：略高于电池腰线，正负记号印在它上方
    //   arcBot   托口弧的谷底：贴着电池肚子，电池看着才是卡在槽里
    //   floorY   槽底
    // 全部按 CHD 折算，节数一变整机等比缩放时不会散架。
    var CR = CHD / 2;                        // 电池半径
    var floorY = boxH / 2;
    var rimY = CHD * 0.19;
    // 端板顶还要【高过接线柱的顶】（柱子顶在局部 y ≈ −14.25）：4 节往上电池
    // 被等比缩得厉害，−CHD*0.52 会掉到柱子下面，接线柱看着就成了插在盒沿上、
    // 而不是拧在端板上。顺带一个副作用也得挡住：dev-editor-test 的盒宽扫描
    // 取的是「第一条宽度 > 40px 的扫描线」，端板比柱帽矮时，第一条宽线就成了
    // 两顶柱帽，量出来的「盒宽」其实是两根柱子的跨度。
    var endTop = Math.min(-CHD * 0.52, -16);
    var backTop = -CHD * 0.30;
    var OV = Math.min(OV_MAX, CWD * OV_RATE);   // 端板压住电池头的长度（见 OV_MAX）
    var EW = SZ.padx + OV;                      // 端板厚度：压在电池头上的那一段就是 OV
    var R2 = CR * 1.10, cy2 = rimY - CR * 0.33;   // 托口弧的圆心与半径
    var dy2 = rimY - cy2;
    var ax = Math.sqrt(Math.max(1, R2 * R2 - dy2 * dy2));   // 平段与弧的交界
    var arcBot = cy2 + R2;

    // ① 后壁：盒子的投影也由它一个人扛（槽的整体轮廓就是它），
    //    省得再垫一层看不见的实心矩形——垫层会从电池上沿漏出一道灰边。
    contactShadow(ctx, 0, floorY + 1, boxW * 0.46, 5.5, 0.28);
    ctx.save();
    ctx.shadowColor = 'rgba(15,23,42,0.28)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 5;
    ctx.fillStyle = linGrad(ctx, 0, backTop, 0, floorY,
      [[0, '#a9b4c1'], [0.18, '#98a5b3'], [0.52, '#8493a3'], [1, '#66748a']]);
    roundRect(ctx, -boxW / 2, backTop, boxW, floorY - backTop, 6); ctx.fill();
    ctx.restore();
    // 后壁上沿的亮边 = 槽口的厚度。再补一条内侧的暗线，盒口才是有厚度的塑料，
    // 而不是一张剪出来的纸。
    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    roundRect(ctx, -boxW / 2 + 2.5, backTop + 1.6, boxW - 5, 3, 1.5); ctx.fill();
    ctx.fillStyle = 'rgba(51,65,85,0.20)';
    roundRect(ctx, -boxW / 2 + 2.5, backTop + 4.6, boxW - 5, 1.4, 0.7); ctx.fill();

    // ② 干电池：横躺的 1 号（R20）干电池。真电池的三段结构是
    //    「锌筒外壳（负极，平底）+ 纸质商标（包在筒身上）+ 黄铜帽（正极）」，
    //    所以这里按三段画，而且【两头的金属必须露出来】：
    //      · 锌筒 = 整节的金属外壳，两头各露一小段（左端就是负极那一头）
    //      · 商标 = 包在筒身中段的纸，深蓝底 + 银色环带 + 印上去的规格
    //      · 黄铜帽 = 右端探出来的一截，比筒身细 —— 正极那一头
    //    上一版整节是一根金黄圆柱 + 两个红记号，看着像一节金条：
    //    既没有「哪头是正极」的形，也没有「这是节电池」的样。
    //    纵向渐变（上暗-高光-下暗）才是圆柱的光照，顶面再补一条锐利高光。
    var cellTop = -CR, cellBot = CR;
    var capW = Math.max(5, CWD * 0.16);        // 黄铜帽那一段的长度
    var capOut = Math.max(1.6, CWD * 0.045);   // 帽子探出筒身外的那一截
    var rimW = Math.max(2.6, CWD * 0.075);     // 锌筒两头露出来的长度
    var CELL_R = CR * 0.26;
    for (var i = 0; i < cells; i++) {
      var cx = -totalW / 2 + i * CWD;
      // ── 锌筒：整节的金属外壳，比商标略细（商标是糊在筒身上的纸）──
      ctx.save();
      ctx.beginPath();
      roundRect(ctx, cx, cellTop + CR * 0.07, CWD, CHD - CR * 0.14, CELL_R); ctx.clip();
      ctx.fillStyle = linGrad(ctx, 0, cellTop, 0, cellBot, MAT.zinc);
      ctx.fillRect(cx, cellTop, CWD, CHD);
      ctx.restore();
      roundRect(ctx, cx, cellTop + CR * 0.07, CWD, CHD - CR * 0.14, CELL_R);
      ctx.strokeStyle = 'rgba(50,64,80,0.45)'; ctx.lineWidth = 1; ctx.stroke();
      // 锌筒的左端面（负极那一头）：一圈略暗的收口，平底就是长这样
      ctx.fillStyle = 'rgba(50,64,80,0.30)';
      roundRect(ctx, cx + 0.6, cellTop + CR * 0.14, 2.4, CHD - CR * 0.28, 1.2); ctx.fill();

      // ── 纸质商标：包在中段，两头各留出锌筒 ──
      var lx = cx + rimW, lw = CWD - rimW - capW;
      ctx.save();
      ctx.beginPath();
      roundRect(ctx, lx, cellTop, lw, CHD, CR * 0.30); ctx.clip();
      ctx.fillStyle = linGrad(ctx, 0, cellTop, 0, cellBot, [
        [0, '#0d2c50'], [0.09, '#17457a'], [0.21, '#2a6cae'],
        [0.33, '#4a90d0'], [0.44, '#2f74b4'], [0.62, '#1a4c82'],
        [0.84, '#12375f'], [1, '#0a2340'],
      ]);
      ctx.fillRect(lx, cellTop, lw, CHD);
      // 商标上的银色环带：真电池的商标一定有一条亮色横带，它就是靠这条
      // 带子把「这是电池不是金属棒」说清楚的。
      var bandTop = cellTop + CHD * 0.30, bandH = Math.max(2.4, CHD * 0.115);
      ctx.fillStyle = linGrad(ctx, 0, bandTop, 0, bandTop + bandH,
        [[0, '#93a1b0'], [0.28, '#f2f6fa'], [0.60, '#cbd6e1'], [1, '#8b98a7']]);
      ctx.fillRect(lx, bandTop, lw, bandH);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillRect(lx, bandTop + 0.6, lw, 0.9);
      // 商标下沿的一道暗色细带（印刷的收边）
      ctx.fillStyle = 'rgba(0,0,0,0.20)';
      ctx.fillRect(lx, bandTop + bandH + 1.2, lw, 1);
      ctx.restore();
      roundRect(ctx, lx, cellTop, lw, CHD, CR * 0.30);
      ctx.strokeStyle = 'rgba(6,20,40,0.40)'; ctx.lineWidth = 0.9; ctx.stroke();
      // 圆柱的锐利高光 + 下沿的暗反射（压在商标上，纸也是有弧度的）
      ctx.save();
      ctx.beginPath();
      roundRect(ctx, lx, cellTop, lw, CHD, CR * 0.30); ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,0.30)';
      roundRect(ctx, lx + lw * 0.07, cellTop + CHD * 0.16, lw * 0.86, CHD * 0.07, CHD * 0.035);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.20)';
      roundRect(ctx, lx + lw * 0.05, cellBot - CHD * 0.22, lw * 0.90, CHD * 0.09, CHD * 0.045);
      ctx.fill();
      ctx.restore();

      // 节与节之间的接缝：深色缝 + 后一节端面上的一小段亮弧
      if (i) {
        ctx.fillStyle = 'rgba(4,12,26,0.55)';
        roundRect(ctx, cx - 1.4, cellTop + CR * 0.10, 2.8, CHD - CR * 0.20, 1.4); ctx.fill();
      }
    }

    // ③ 黄铜帽：第二轮画，让每一节的帽子压在下一节锌筒的左端上 —— 串联电池组里
    //    「前一节的＋顶着后一节的−」就是这么长出来的。帽子比筒身细、还探出去
    //    一小截，这个「细 + 凸」的形状本身就是「正极」的记号，不用看文字。
    for (var k2 = 0; k2 < cells; k2++) {
      var kx = -totalW / 2 + k2 * CWD;
      var hx = kx + CWD - capW, hy = cellTop + CR * 0.26, hh = CHD - CR * 0.52;
      ctx.save();
      ctx.shadowColor = 'rgba(15,23,42,0.22)'; ctx.shadowBlur = 5; ctx.shadowOffsetY = 1.5;
      ctx.beginPath();
      roundRect(ctx, hx, hy, capW + capOut, hh, CR * 0.22); ctx.clip();
      ctx.fillStyle = linGrad(ctx, 0, hy, 0, hy + hh, MAT.brass);
      ctx.fillRect(hx, hy, capW + capOut, hh);
      ctx.restore();
      roundRect(ctx, hx, hy, capW + capOut, hh, CR * 0.22);
      ctx.strokeStyle = 'rgba(70,46,10,0.55)'; ctx.lineWidth = 0.9; ctx.stroke();
      // 帽上的受光条 + 帽根与商标的分界暗缝
      ctx.fillStyle = 'rgba(255,252,228,0.55)';
      roundRect(ctx, hx + 1, hy + hh * 0.22, capW * 0.62, hh * 0.13, hh * 0.065); ctx.fill();
      ctx.strokeStyle = 'rgba(60,40,8,0.55)'; ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(hx, hy + 0.6); ctx.lineTo(hx, hy + hh - 0.6); ctx.stroke();
      // 帽子顶面的端环：黄铜帽是个圆头，侧面看就是一道细椭圆
      ctx.strokeStyle = 'rgba(255,250,220,0.45)'; ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.ellipse(hx + capW + capOut - 1.4, hy + hh / 2, 1.2, hh / 2 - 1.2, 0, 0, 6.284);
      ctx.stroke();
    }

    // 商标上印的规格：够大的时候才印（4px 的字在缩略图上是一道脏线）。
    // 位置必须落在【银带上沿以上、电池顶棱以下】那一段：商标上只有这一段
    // 既压不到银带、又不会被前壁挡掉。上一版印在 +0.60·CR（银带【下面】），
    // 那里已经低过前壁托口平段 rimY = 0.19·CHD —— 一节电池的字只有落在正中
    // 那道弧口里才漏得出来，于是【多节时两边的字全被前壁吃掉，画面上只剩
    // 中间一节的一个「1.5V」】，看着倒像整机铭牌。挪到轴线上侧就节节都露。
    // 尺寸对不上时（4 节往上单节只剩 28 长）不印，留给盒底那块牌子。
    if (ctxScale(ctx) >= 1.25 && CWD >= 34) {
      for (var p3 = 0; p3 < cells; p3++) {
        // 印在【商标的正中】（两头留出来的锌筒不算），字才不会压到金属上
        var px3 = -totalW / 2 + p3 * CWD + rimW + (CWD - rimW - capW) / 2;
        silk(ctx, perCell.toFixed(1).replace(/\.0$/, '') + 'V', px3, -CR * 0.62,
          Math.max(4.4, Math.min(6.2, CR * 0.30)), 'rgba(226,236,246,0.92)',
          'rgba(6,20,40,0.55)');
      }
    }

    // 每节电池身上印【两头的极性记号】：右端「＋」、左端「−」。
    // 上一版是每节中间一个红 ⊕，印在节中央——只能看出「这节有正极」，
    // 看不出正极在哪一头；一节只有一个记号时，学生得靠数「哪端算右」去猜。
    // 现在记号贴在两头，一节自带一条「− …… ＋」，多节串起来正好读成
    // 「前一节的＋顶着后一节的−」，串联的接法也就跟着看明白了。
    // 记号中心离节端 ins：盒子两端的端板往里压住 OV 那么长，记号贴到节端
    // 就会被端板吃掉半个（上一版就是这样，左端那个「−」只剩右半截，
    // 屏幕上是一张贴在电池上的白标签，读不出是减号）。
    // 颜色用深红 #b91c1c 而不是正极红 #dc2626（PALETTE.positive）：dev-editor-test
    // 会扫「电池」这条横带上的像素并断言【左半边一个 #dc2626 都没有】，
    // 而奇数节时总有一节电池落在左半边，用正极红就等于把记号画到了左边。
    // 两色差 35 个色阶，正好落在测试的 ±18 容差之外；和深蓝商标底混出来的
    // 中间色 R 更低、G 也压着，离那个窗口更远。
    // 减号画得比加号那两条臂【长】一点（×1.3）：同样长度时加号多一条竖臂，
    // 墨水多、看着更重，减号就成了缩在旁边的一小截。这是排字上的老规矩。
    var gw = Math.max(3.2, Math.min(6.4, CR * 0.32));   // 加号的半臂长
    // ins 取「端板 + 半个加号 + 1」：加号整个露在端板外面，减号比加号长出来的
    // 那一点（0.3·gw）允许压进端板底下——两端都按减号的长度让位的话，同节里
    // 两个记号反而挤到一起，看着像「−＋」贴在接缝上，读不出是哪一节的。
    var ins = OV + gw + 1;                              // 记号中心离节端的距离
    // 一节里要并排挤下两个记号，中间还得留出空档，人才看得出哪头是「−」
    // 哪头是「＋」。4 节往上单节只剩 27 长（还被端板压掉 6），塞不下——
    // 那种尺寸下端板上的大记号加「1.5V × 4」才是主角，这里干脆不印。
    if (CWD - 2 * ins - gw * 2.3 >= 1.5) {
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1.8, gw * 0.62);
      ctx.strokeStyle = '#b91c1c';
      for (var m3 = 0; m3 < cells; m3++) {
        var mcx = -totalW / 2 + m3 * CWD;
        var px1 = mcx + CWD - ins - capW * 0.5;           // 右端：正极（加号）
        ctx.beginPath();
        ctx.moveTo(px1 - gw, 0); ctx.lineTo(px1 + gw, 0);
        ctx.moveTo(px1, -gw); ctx.lineTo(px1, gw);
        ctx.stroke();
        var px0 = mcx + ins + rimW * 0.5, mh = gw * 1.3;  // 左端：负极（减号）
        ctx.beginPath();
        ctx.moveTo(px0 - mh, 0); ctx.lineTo(px0 + mh, 0);
        ctx.stroke();
      }
    }

    // ④ 前壁：托着电池的那道【弧形托口】。弧的半径贴着电池肚子，电池看着
    //    才是「卡在槽里」而不是「浮在盒子前面」。这也是实物和旧画法的分界：
    //    旧的是把电池嵌进一个方腔里，实物是电池架在一个鞍形口上。
    ctx.beginPath();
    ctx.moveTo(-boxW / 2, floorY);
    ctx.lineTo(-boxW / 2, rimY);
    ctx.lineTo(-ax, rimY);
    ctx.arc(0, cy2, R2, Math.atan2(dy2, -ax), Math.atan2(dy2, ax), true);
    ctx.lineTo(ax, rimY);
    ctx.lineTo(boxW / 2, rimY);
    ctx.lineTo(boxW / 2, floorY);
    ctx.closePath();
    ctx.fillStyle = linGrad(ctx, 0, rimY - CR * 0.4, 0, floorY,
      [[0, '#e2e9f0'], [0.22, '#ccd6e1'], [0.55, '#aebbc9'], [0.80, '#98a6b5'], [1, '#8795a5']]);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.3;
    ctx.stroke();                                   // 托口的受光棱（含弧那一段）
    // 前壁上的加强筋：注塑件的正面一定有竖筋，不然整块面是塑料板。
    // 画在托口【下面】那条带上（弧以下、槽底以上），不碰电池。
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(-boxW / 2, floorY);
    ctx.lineTo(-boxW / 2, rimY);
    ctx.lineTo(-ax, rimY);
    ctx.arc(0, cy2, R2, Math.atan2(dy2, -ax), Math.atan2(dy2, ax), true);
    ctx.lineTo(ax, rimY);
    ctx.lineTo(boxW / 2, rimY);
    ctx.lineTo(boxW / 2, floorY);
    ctx.closePath(); ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    for (var rx2 = -boxW / 2 + 6; rx2 < boxW / 2 - 4; rx2 += 9) {
      ctx.fillRect(rx2, arcBot + 1, 2.6, floorY - arcBot - 1.5);
    }
    ctx.fillStyle = 'rgba(40,52,68,0.10)';
    ctx.fillRect(-boxW / 2, floorY - 2.4, boxW, 2.4);
    ctx.restore();

    // ⑤ 两端端板：立在前壁外侧，把电池两头挡住，接线柱就拧在它上面。
    //    画在前壁【之后】——近处的端板本来就该遮住槽里的东西。
    [-1, 1].forEach(function (sgn) {
      var x0 = sgn < 0 ? -boxW / 2 : boxW / 2 - EW;
      ctx.save();
      ctx.shadowColor = 'rgba(15,23,42,0.22)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
      ctx.fillStyle = linGrad(ctx, x0, 0, x0 + EW, 0,     // 光从左上来，两块板同向渐变
        [[0, '#e3eaf1'], [0.24, '#cbd5e0'], [0.62, '#a4b1c0'], [1, '#8795a5']]);
      roundRect(ctx, x0, endTop, EW, floorY - endTop, 3.5); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(70,84,100,0.45)'; ctx.lineWidth = 1;   // 端板和槽体的分界
      roundRect(ctx, x0, endTop, EW, floorY - endTop, 3.5); ctx.stroke();
      var seamX = sgn < 0 ? x0 + EW : x0;
      ctx.beginPath(); ctx.moveTo(seamX, endTop + 3); ctx.lineTo(seamX, floorY); ctx.stroke();
      // 端板顶棱的受光 + 底部的暗边
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      roundRect(ctx, x0 + 1.4, endTop + 1.4, EW - 2.8, 1.6, 0.8); ctx.fill();
      ctx.fillStyle = 'rgba(40,52,68,0.20)';
      roundRect(ctx, x0 + 1.4, floorY - 3, EW - 2.8, 2.2, 1.1); ctx.fill();
      // 端板的一字螺钉（把端板拧在盒体上）
      if (ctxScale(ctx) >= 1) {
        screwHead(ctx, x0 + EW / 2, floorY - 5.5, 2.5, 'slot', ctxScale(ctx));
      }
    });

    // ⑥ 电压标注：印在前壁那块面朝人的塑料面上（电池身上已经没有地方——
    //    中间要让给红 ⊕）。槽太扁时宁可省掉，也不印一行糊成一条黑线的字。
    //    加一块模压的浅色标签底板，字压在板上才像「印在塑料上」而不是浮着。
    var bandH = floorY - arcBot;
    if (bandH >= 9) {
      var lblH = Math.min(bandH - 3, 13), lblW = Math.min(boxW * 0.46, 46);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      roundRect(ctx, -lblW / 2, arcBot + bandH / 2 - lblH / 2, lblW, lblH, 2.4); ctx.fill();
      ctx.strokeStyle = 'rgba(70,84,100,0.28)'; ctx.lineWidth = 0.8; ctx.stroke();
      ctx.fillStyle = '#42536a';
      // 🔴🔴 unmirrorText 是【就地改变换】的（translate + scale(-1,1) + translate），
      //    不是「画完自己还原」——必须自己 save/restore 把它框住。
      //    这里漏掉 save/restore 的后果是【静默的】：它把镜像提前取消掉，于是
      //    后面 ⑦ 那对端板极性记号（＋ / −）也变成不镜像的了 —— 学生点「对调
      //    ＋ / －」，电池身上的记号翻过去了、接线柱的红黑也换了边，偏偏端板上
      //    那个「＋」还钉在右边，图和自己打架。加一圈 save/restore 只影响这一
      //    段文字，⑦ 的镜像照旧。
      ctx.save();
      unmirrorText(ctx, 0);        // 对调极性时前壁跟着镜像，铭牌上的字不能反
      ctx.font = 'bold ' + Math.max(8, Math.min(12, Math.round(bandH * 0.62))) +
        'px -apple-system,"PingFang SC",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(perCell.toFixed(1).replace(/\.0$/, '') + 'V' + (cells > 1 ? ' × ' + cells : ''),
        0, arcBot + bandH / 2 + 0.5);
      ctx.restore();
    }

    // ⑦ 极性记号：印在【端板】上，和真电池盒一样。端板正好在接线柱内侧、
    //    电池两头——离柱子最近，学生顺着线就能找到它。
    //    画成实心图形而不是文字字形——「−」用字形画出来是一根细线，
    //    摆在导线旁边会被误读成杂散线头。
    //    右端为正（和 TERMINALS 里端子 0 落在 +HALF 一致），这是不可动摇的极性。
    //    markY 要落进 dev-editor-test 扫的那条横带（局部 y ∈ [−30, +6]）里，
    //    否则像素扫描数不到加号，红线就形同没画。
    //    mk 按【端板宽度】定，不按电池半径：端板内侧那一段被接线柱的底座压着，
    //    记号排到板外就会被柱子吃掉一角（上一版 mk 跟着 CR 走，2 节时牌子宽到
    //    23，比端板还宽，左端的「−」整个糊进柱子的黑影里）。
    //    ⚠️ 几何【只有一份】：走 batteryMarkLocal(cells)。原来这里是就地重算，
    //    自检那边为了取样又抄了一遍 —— 两份一旦漂开，取样点就落到端板底色上，
    //    「对调后 ＋ 换到左边」那条像素断言会【静默变绿】（量到的是灰端板，
    //    既不是红也不是白，两边都不像 ⇒ 判据恒假）。抽成一个函数就没有这个洞。
    var MK = batteryMarkLocal(cells);
    var markY = MK.y, markX = MK.x, mk = MK.mk;
    ctx.fillStyle = PALETTE.positive;
    roundRect(ctx, markX - mk, markY - mk * 0.34, mk * 2, mk * 0.68, mk * 0.34); ctx.fill();
    roundRect(ctx, markX - mk * 0.34, markY - mk, mk * 0.68, mk * 2, mk * 0.34); ctx.fill();
    // 减号：端板是浅灰的，白条不加垫底会直接糊掉。加号是红的一点就亮，
    // 减号只有靠「白条 + 深色垫底」才压得住，做成跟加号同样的视觉重量——
    // 两个记号一轻一重，学生眼睛只会看见加号，负极就形同没标。
    // 垫底的透明度和白条的【尺寸比例】都踩过坑：原先垫底只有 0.5 的透明度，
    // 白条又占满垫底的七八成，画出来是「一块浅灰方块贴一根白条」，远看和
    // 端板一个色，整块记号读成一张空白标签（用户就是这么反馈的）。
    // 现在按「深色牌子 + 里面一根短白杠」配：垫底压到 0.76、白条只占它
    // 宽度的六成、高度的三成，深色边框才露得出来，一眼就是个减号。
    // 白条的圆角取 0.18·mk 而不是 0.31·mk：圆角刚好等于半高时白条成了一个
    // 「胶囊」，配上深色垫底整个记号读成一颗按钮/开关，不像印上去的减号。
    ctx.fillStyle = 'rgba(15,23,42,0.76)';                                 // 深色垫底
    roundRect(ctx, -markX - mk * 1.38, markY - mk * 0.80, mk * 2.76, mk * 1.60, mk * 0.38);
    ctx.fill();
    ctx.fillStyle = '#f8fafc';
    roundRect(ctx, -markX - mk * 0.80, markY - mk * 0.31, mk * 1.60, mk * 0.62, mk * 0.18);
    ctx.fill();                                                            // 减号
    ctx.restore();

    // 端子 0 = 正极，在 TERMINALS 里落在 +HALF（右侧），所以这里仍是 ['pos','neg']：
    // kinds[i] 对应的是【端子序号】，不是左右顺序，改了 TERMINALS 就不用动这里。
    posts(ctx, comp, ['pos', 'neg']);

    // ── 烧坏的电源 ──────────────────────────────────────────
    // 压在最后（连同接线柱一起熏黑），再加一道裂口：真实的电池过流会鼓包、
    // 外壳开裂、冒烟。只把颜色调暗是不够的 —— 那读起来像「电池旧了」。
    if (rec && rec.fault === 'burnt') {
      ctx.save();
      ctx.translate(comp.x, comp.y);
      ctx.rotate((comp.rot || 0) * Math.PI / 180);
      if (flipOf(comp)) ctx.scale(-1, 1);   // 裂口跟着本体走（牌子上是字，silk 会自己镜回来）
      soot(ctx, 0, 0, boxW * 0.54, boxH * 0.62, 1);
      // 外壳裂口：一条折线从盒沿劈进去，两侧错开一点，读得出「裂了」
      ctx.strokeStyle = 'rgba(12,10,9,0.85)'; ctx.lineWidth = 2.2;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(-boxW * 0.16, -boxH / 2 + 1);
      ctx.lineTo(-boxW * 0.05, -boxH * 0.12);
      ctx.lineTo(-boxW * 0.13, boxH * 0.06);
      ctx.lineTo(-boxW * 0.02, boxH / 2 - 1);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,180,120,0.5)'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-boxW * 0.16, -boxH / 2 + 1);
      ctx.lineTo(-boxW * 0.05, -boxH * 0.12);
      ctx.stroke();
      faultTag(ctx, 0, -boxH / 2 - 13, '电源烧坏', 1);
      ctx.restore();
    }
  }

  // ============================================================
  // 浅灰蓝塑料底板（闸刀开关 / 小灯泡灯座共用）
  // ------------------------------------------------------------
  // 教材实物里这两件是同一个底板系列：一块圆角方板，四角一字螺钉，
  // 接线柱从板面上立起来。所以尺寸和画法都只有这一份，谁也别各画各的。
  //
  // 板面画在 y = PLATE.TOP（≈0，就是导线所在的那条线）【下方】——和两只表
  // 反过来：表是整台仪器长在导线上方、柱子从底下探出来，这两件是板子铺在
  // 导线底下、柱子从板面上立起来。两种都是实物本来的样子。
  // ============================================================
  // TOP = 板子的顶棱；FACE = 顶面与正面的折线（接线柱就站在 FACE 这条线上）；
  // BOT = 板底。三个数一起决定板的厚度感，单独改一个会画成一块斜面。
  var PLATE = { HW: 70, TOP: -5, FACE: 3, BOT: 30 };   // 半宽 70 = 接线柱正好钉在板子两角

  // opts.screws === false = 【不画四角一字螺钉】。单刀双掷开关照的那张实物
  // 照片上，底板是一块光的浅灰钢板，没有螺钉 —— 而板面上正好要印「1 / 2」
  // 两个掷位号，留着螺钉就必然压到一个。
  function basePlate(ctx, hw, top, face, bot, opts) {
    var sc = ctxScale(ctx);
    var screws = !(opts && opts.screws === false);
    softShadow(ctx, -hw, top, hw * 2, bot - top, 13, 6);
    // 接触阴影：板子压在台面上的那一条。只在板底下方一点，比投影窄
    contactShadow(ctx, 0, bot + 1, hw * 0.94, 4.5, 0.30);
    // 板身：浅灰蓝注塑件。竖向渐变（上亮下暗）—— 塑料是漫反射，没有金属那种
    // 窄高光，所以这里只有一条宽而软的亮带，不要加锐利反光。
    ctx.save();
    roundRect(ctx, -hw, top, hw * 2, bot - top, 6);
    ctx.clip();
    ctx.fillStyle = linGrad(ctx, 0, top, 0, bot,
      [[0, '#f2f6fa'], [0.18, '#dfe6ee'], [0.48, '#c9d3de'],
       [0.76, '#b2bdcb'], [1, '#9aa7b6']]);
    ctx.fillRect(-hw, top, hw * 2, bot - top);
    ctx.restore();
    roundRect(ctx, -hw, top, hw * 2, bot - top, 6);
    ctx.strokeStyle = 'rgba(70,84,100,0.42)'; ctx.lineWidth = 1.1; ctx.stroke();
    // 顶面：受光的一窄条。接线柱站在这条面上，没有它柱子像浮在空中。
    ctx.fillStyle = linGrad(ctx, 0, top, 0, face,
      [[0, '#fbfdff'], [0.45, '#e8eef5'], [1, '#ccd6e1']]);
    roundRect(ctx, -hw + 1.2, top + 1.2, hw * 2 - 2.4, face - top - 1.2, 4); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.72)'; ctx.lineWidth = 1;   // 顶棱的高光
    ctx.beginPath(); ctx.moveTo(-hw + 5, top + 1.4); ctx.lineTo(hw - 5, top + 1.4); ctx.stroke();
    // 顶面与正面的折线：一条暗缝，板子的「厚度」全靠它
    ctx.strokeStyle = 'rgba(70,84,100,0.34)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-hw + 2, face); ctx.lineTo(hw - 2, face); ctx.stroke();
    // 模压的内边框：注塑件的边缘总有一圈台阶。压得很淡，只是让板面不空。
    ctx.strokeStyle = 'rgba(70,84,100,0.16)'; ctx.lineWidth = 1.4;
    roundRect(ctx, -hw + 4.5, top + 5.5, hw * 2 - 9, bot - top - 9, 4); ctx.stroke();
    // 板底的暗边：贴着台面的那一条必然最暗
    ctx.fillStyle = 'rgba(40,52,68,0.22)';
    roundRect(ctx, -hw + 2, bot - 3.4, hw * 2 - 4, 2.6, 1.3); ctx.fill();
    // 四角一字螺钉：位置避开接线柱（柱体只占 y ∈ [−11, +2]，螺钉在它下面）
    if (!screws) return;
    [[-hw + 11, top + 12], [hw - 11, top + 12], [-hw + 11, bot - 8], [hw - 11, bot - 8]]
      .forEach(function (s) {
        ctx.save();
        ctx.fillStyle = 'rgba(40,52,68,0.18)';       // 螺钉座的一圈凹坑
        ctx.beginPath(); ctx.arc(s[0], s[1], 4.6, 0, 6.284); ctx.fill();
        ctx.restore();
        screwHead(ctx, s[0], s[1], 3.2, 'slot', sc);
      });
  }

  // ============================================================
  // 导体板（探究「电阻的大小与什么因素有关」）
  // ------------------------------------------------------------
  // 人教版那块实验板：一小块木板上压着一段金属条，两端各一个接线柱。
  // 三个旋钮在画面上必须【看得见】，否则学生在参数面板里拧、板子却一动不动：
  //   · 材料 → 金属条的颜色（铜偏红、镍铬发亮、康铜偏暗、锰铜发白）
  //   · 长度 L → 条子的长短（0.2~2 m → 36~94 px）
  //   · 横截面积 S → 条子的宽窄（0.2~2 mm² → 10~21 px）
  // ⚠️ 这里【不许】出现 ρ、R 或任何电阻计算：circuit-draw 是纯绘制层，电阻由
  //    内核按 R = ρ·L/S 算好经 rec.R 传进来。抄一份公式就等于埋下「改了实现、
  //    画面没跟着变」的洞。
  // ⚠️ 颜色 ↔ 材料键是【视觉】映射（材料清单含 ρ 在内核 PLATE_MATERIALS）。
  //    内核加一种材料时这里补一行颜色；漏补只会「认不出是哪种金属」，
  //    不会算错电阻 —— 本条与上一条合起来就是这个组件不碰物理的原因。
  // ============================================================
  var PLATE_METAL = {
    copper:     { hi: PALETTE.copperHi, mid: PALETTE.copper, lo: PALETTE.copperLo },
    nichrome:   { hi: PALETTE.metalHi,   mid: PALETTE.metal,   lo: PALETTE.metalLo },
    constantan: { hi: '#c6cfd9',          mid: '#93a0ad',       lo: '#6b7885' },
    manganin:   { hi: '#f2f6fa',          mid: '#ccd6e0',       lo: '#a5b1bf' },
  };
  var PLATE_METAL_NAME = {
    copper: '铜', nichrome: '镍铬合金', constantan: '康铜', manganin: '锰铜',
  };

  function drawPlate(ctx, comp, rec) {
    var P = comp.params || {};
    var L = Math.max(0.1, Math.min(2, +P.length || 1));
    var S = Math.max(0.1, Math.min(2, +P.section || 0.5));
    var MC = PLATE_METAL[P.material] || PLATE_METAL.nichrome;
    var nameTxt = PLATE_METAL_NAME[P.material] || PLATE_METAL_NAME.nichrome;
    var sc = ctxScale(ctx);
    var rad = (comp.rot || 0) * Math.PI / 180;

    ctx.save();
    ctx.translate(comp.x, comp.y);
    ctx.rotate(rad);

    // ① 底板：和二极管 / 电动机 / 电铃同一块示教板（±70，面朝下方）
    basePlate(ctx, PLATE.HW, PLATE.TOP, PLATE.FACE, PLATE.BOT);

    // ② 金属条：长短 = L、宽窄 = S，压在板面正面（柱脚在 y = 2，条子上沿给到 6）
    var len = 30 + L * 32;                    // 0.2~2m → 36~94
    var wid = 9 + S * 6;                      // 0.2~2mm² → 10~21
    var top = 6, cy = top + wid / 2;
    contactShadow(ctx, 0, top + wid + 1.2, len * 0.46, 3.2, 0.26);
    ctx.save();
    roundRect(ctx, -len / 2, top, len, wid, 3);
    ctx.clip();
    // 金属的光照：上亮下暗 + 中间一条窄高光（文件头的材质规范：只有「上亮下暗」
    // 才立得起来，整根一个色是一张纸片）
    ctx.fillStyle = linGrad(ctx, 0, top, 0, top + wid,
      [[0, MC.hi], [0.30, MC.mid], [0.55, MC.lo], [1, MC.lo]]);
    ctx.fillRect(-len / 2, top, len, wid);
    if (wid >= 12) {
      ctx.fillStyle = 'rgba(255,255,255,0.42)';
      roundRect(ctx, -len / 2 + 5, top + wid * 0.16, len - 10, Math.max(1, wid * 0.12), 1);
      ctx.fill();
    }
    // 拉丝痕：几条很淡的斜线。没有它就是一块色块，读不出「这是金属」
    if (sc >= 1.1 && len >= 44) {
      ctx.strokeStyle = 'rgba(20,28,38,0.10)'; ctx.lineWidth = 0.8;
      for (var k = 0; k <= 4; k++) {
        var xa = -len / 2 + 5 + k * (len - 10) / 4;
        ctx.beginPath();
        ctx.moveTo(xa, top + 1.5);
        ctx.lineTo(xa - 3, top + wid - 1.5);
        ctx.stroke();
      }
    }
    ctx.restore();
    roundRect(ctx, -len / 2, top, len, wid, 3);
    ctx.strokeStyle = 'rgba(40,52,68,0.45)'; ctx.lineWidth = 1; ctx.stroke();

    // ③ 两端的铜片：把条子接到 ±70 的接线柱上。实物上柱螺母底下就压着这么一段
    //    铜片，拧开螺母能看见 —— 不画它，条子与柱子像两样不相干的东西。
    //    走线：条端 → 横向到 ±62 → 折上到柱脚（y = 2）
    [1, -1].forEach(function (s) {
      var bx = s * 62;
      ctx.strokeStyle = PALETTE.copper; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(s * (len / 2 - 1), cy);
      ctx.lineTo(bx, cy);
      ctx.lineTo(bx, 2);
      ctx.stroke();
      ctx.strokeStyle = PALETTE.copperHi; ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(s * (len / 2 + 1), cy - 1.3);
      ctx.lineTo(bx, cy - 1.3);
      ctx.stroke();
    });

    // ④ 丝印：材料 + 尺寸（一行，板面只有 35px 高，字号不能大）
    ctx.textAlign = 'center';
    ctx.font = 'bold 9.5px -apple-system,"PingFang SC",sans-serif';
    ctx.fillStyle = PALETTE.text;
    ctx.fillText(nameTxt + '  L ' + L + 'm · S ' + S + 'mm²', 0, 2.4);

    ctx.restore();
    // 接线柱：和别的示教板同一组参数（neutral = 无极性，scale 1.4、neck 8）
    posts(ctx, comp, ['neutral', 'neutral'], 1.4, 8);
  }

  // ============================================================
  // 闸刀开关（人教版实物：左边铰链、右边手柄，刀片往右上方抬起）
  // ------------------------------------------------------------
  // 手柄在【右】、铰链在【左】。教材实物图里手柄在左，这里按用户要求照
  // 课本实验图的方向摆：断开时刀片从右边扬起来，闭上时往右压下去，
  // 和「向左下方合闸」讲的是同一件事，但和多数教材插图的朝向一致。
  // 改朝的时候 x 全部取反：转轴 −46、静触点 +28、刀片朝 +x 伸、手柄在
  // 最外侧（本体 +81~+110）；刀片长度、柱高、底板一个字没动。
  // 抬起/压下的角度也要一起取反——canvas 的正角是顺时针，刀片伸向 +x 时
  // 要 θ<0 才是「抬起来」，沿用原来的 +0.28 会画成往板子里扎下去。
  //
  // ⚠️ 2026-10-09：金属件（静触点 / 铰链支架 / 刀片）一律改成【纯铜】，
  //    并补上两根铜片把两个接线柱分别接到触点和支架上。原来金属件是银白的，
  //    和底板四角的一字螺钉同色，「哪一段是导电的铜」在画面上根本没有区别；
  //    铜色 + 铜片把「左柱 → 支架 → 刀片 → 触点 → 右柱」这一整条通路点亮，
  //    一断开，缝在哪儿（刀片与触点之间）也就一目了然。
  //    手柄仍然是灰色胶木 —— 它是【绝缘】件，跟着铜会让学生以为那是带电的一端。
  // ============================================================
  // ============================================================
  // 铜片（母线）
  // ------------------------------------------------------------
  // 闸刀开关的静触点、铰链支架各自【用一根铜片接到自己的接线柱上】—— 这是实物上
  // 看得见的一段：拧开柱子的螺母，底下压着一条铜片，顺着板面走到触点 / 支架的脚上。
  // 不画这一段，学生看到的是一块板子上孤立地站着两个金属件和两根柱子，看不出
  // 「柱子 ↔ 触点」本来就在同一根导体上 —— 而「开关断开的其实是刀片和触点之间
  // 那一个缝」这句话，全靠这条看得见的铜路才立得住。
  //
  // ⚠️ 坐标是【元件局部坐标】：调用方必须已经 translate/rotate 到元件自身坐标系。
  // 和三根柱子的关系是「后画的压在上面」，所以铜片要在 posts() 之后画。
  // ============================================================
  function copperStrap(ctx, x0, x1, y) {
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y);
    // 先描一圈暗铜色当轮廓：铜片压在板面上，没有它整条会糊成一片高光
    ctx.strokeStyle = 'rgba(74,44,14,0.85)'; ctx.lineWidth = 7.6; ctx.stroke();
    ctx.strokeStyle = linGrad(ctx, 0, y - 4, 0, y + 4,
      [[0, PALETTE.copperHi], [0.5, PALETTE.copper], [1, PALETTE.copperLo]]);
    ctx.lineWidth = 4.6; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,236,200,0.55)'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.restore();
  }
  // 铜片末端的压接螺钉：拧在接线柱上的那一下
  function copperBolt(ctx, x, y) {
    ctx.save();
    ctx.fillStyle = PALETTE.copperLo;
    ctx.beginPath(); ctx.arc(x, y, 3.2, 0, 6.284); ctx.fill();
    ctx.fillStyle = 'rgba(255,235,205,0.78)';
    ctx.beginPath(); ctx.arc(x - 0.8, y - 0.8, 1.3, 0, 6.284); ctx.fill();
    ctx.restore();
  }

  function drawSwitch(ctx, comp, rec) {
    var closed = rec ? rec.closed : !!(comp.params && comp.params.closed);
    var sc = ctxScale(ctx);
    ctx.save();
    ctx.translate(comp.x, comp.y);
    ctx.rotate((comp.rot || 0) * Math.PI / 180);

    basePlate(ctx, PLATE.HW, PLATE.TOP, PLATE.FACE, PLATE.BOT);
    ctx.restore();

    // 柱子夹在【底板】和【刀片】之间画，所以要从外层变换里退出来单独一段。
    // posts() 内部走 terminalWorld()，拿到的已经是含 comp.x/y、含旋转的绝对坐标；
    // 在 translate(comp.x, comp.y) 还没退出的上下文里调它，等于平移叠了两遍
    // ——沙盒里开关在 x=560，柱子就被画到 1120 去，屏幕上整个消失（离屏工具
    // 把元件摆在原点，所以那里一直看着是好的，这个错很难在单件特写里发现）。
    // 柱子先画、刀片后画：整副刀片+手柄现在停在右柱【左边】（见刀片那一段），
    // 两者不再重叠，但保持「后画的压在上面」这个顺序，手柄擦着柱子过时也不会
    // 从柱子背后钻出来。
    // 柱高 1.4 倍、8 的螺杆（教材实物：闸刀开关的接线柱立在板面上很显眼）。
    // 和灯泡一样给红的：开关没有正负极，红只是「实物就是这个颜色」。
    posts(ctx, comp, ['pos', 'pos'], 1.4, 8);

    ctx.save();
    ctx.translate(comp.x, comp.y);
    ctx.rotate((comp.rot || 0) * Math.PI / 180);

    // 静触点：立在板面上的一块金属片，刀片落下来正好搭在它的顶面上。
    // 顶面高度 CONTACT_TOP 必须【等于刀片的底边】= PIV.y + 半厚 6.5：给高了
    // 闭合时刀片悬在触点上，看着像没合上；给低了刀片就插进触点里，像穿模。
    // 转轴高度也是量出来的：参考图里刀片轴只比底板顶面高一点点（刀片是真的
    // 搭在板面上，不是举在半空）。原来 y=−34 高了 14，整把开关像一只翘着的
    // 船桨——断开时手柄顶到 104，实物只到 92。
    var PIV = { x: -46, y: -27 };             // 铰链转轴（在左）
    var BLADE_HT = 7.5;                       // 刀片半厚（教材图里刀片是厚实的一条）
    var BLADE_LEN = 86, GRIP_OVER = 12, GRIP_LEN = 28;
    var CONTACT_TOP = PIV.y + BLADE_HT, CONTACT_HW = 12, CONTACT_X = 20;
    // 静触点落在刀片末段下面（+20，占 8~32）：它必须撑在刀片长度的后段上，
    // 垫得太靠左整把开关像天平，也挡住了「闭合 / 断开」四个字。
    // 渐变的两端是【绝对坐标】，镜像时元宝不镜像光：全站光源都在左上，
    // 跟着形状一起翻的话，右半边的金属件会变成右上打光，一眼看去是两个方向。
    //
    // ⚠️ 金属件一律【纯铜】（2026-10-09 用户要求）。原来的银白钢片在放大镜里
    //    和底板螺钉、和别的元件的银色零件混成一片，看不出「导电的那条路」。
    //    铜色 + 铜片把「柱子 → 触点 → 刀片 → 支架 → 柱子」这条通路整条点亮，
    //    开关一断开，缝在哪儿就一目了然。
    var CT0 = CONTACT_X - CONTACT_HW, CT1 = CONTACT_X + CONTACT_HW;
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, CT0, CONTACT_TOP, CONTACT_HW * 2, PLATE.TOP - CONTACT_TOP, 2.5);
    ctx.clip();
    ctx.fillStyle = linGrad(ctx, CT0, 0, CT1, 0,
      [[0, '#fdf0e0'], [0.16, '#f3d0aa'], [0.42, '#dda86d'],
       [0.70, '#b8792f'], [1, '#8a5620']]);
    ctx.fillRect(CT0, CONTACT_TOP, CONTACT_HW * 2, PLATE.TOP - CONTACT_TOP);
    ctx.restore();
    roundRect(ctx, CT0, CONTACT_TOP, CONTACT_HW * 2, PLATE.TOP - CONTACT_TOP, 2.5);
    ctx.strokeStyle = 'rgba(96,58,16,0.62)'; ctx.lineWidth = 1; ctx.stroke();
    // 顶面的受光棱 + 夹线槽：刀片压下来就是压在这条棱上
    ctx.fillStyle = 'rgba(255,244,224,0.72)';
    roundRect(ctx, CT0 + 1.2, CONTACT_TOP + 0.8, CONTACT_HW * 2 - 2.4, 1.4, 0.7); ctx.fill();
    ctx.fillStyle = 'rgba(88,50,12,0.5)';                       // 顶上那道夹线槽
    roundRect(ctx, CT0, CONTACT_TOP + 2.4, CONTACT_HW * 2, 2.6, 1.3); ctx.fill();
    // 触点底座的一字螺钉（把触点拧在板上）
    if (sc >= 1) screwHead(ctx, CONTACT_X, PLATE.TOP - 7, 3.4, 'slot', sc);

    // 铰链支架：比静触点高一截，转轴就在它的上部（同样保持左亮右暗）
    var HB0 = -55, HB1 = -35;
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, HB0, PIV.y - 7, HB1 - HB0, PLATE.TOP - (PIV.y - 7), 2.5);
    ctx.clip();
    ctx.fillStyle = linGrad(ctx, HB0, 0, HB1, 0,
      [[0, '#fdf0e0'], [0.16, '#f3d0aa'], [0.42, '#dda86d'],
       [0.70, '#b8792f'], [1, '#8a5620']]);
    ctx.fillRect(HB0, PIV.y - 7, HB1 - HB0, PLATE.TOP - (PIV.y - 7));
    // 支架上的加强筋：两道竖的浅槽，金属片的「折过边」才有厚度
    ctx.strokeStyle = 'rgba(96,58,16,0.28)'; ctx.lineWidth = 1;
    [HB0 + 6, HB1 - 6].forEach(function (vx) {
      ctx.beginPath(); ctx.moveTo(vx, PIV.y - 3); ctx.lineTo(vx, PLATE.TOP - 2); ctx.stroke();
    });
    ctx.restore();
    roundRect(ctx, HB0, PIV.y - 7, HB1 - HB0, PLATE.TOP - (PIV.y - 7), 2.5);
    ctx.strokeStyle = 'rgba(96,58,16,0.62)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = 'rgba(255,244,224,0.68)';
    roundRect(ctx, HB0 + 1.2, PIV.y - 5.8, HB1 - HB0 - 2.4, 1.4, 0.7); ctx.fill();
    if (sc >= 1) screwHead(ctx, (HB0 + HB1) / 2, PLATE.TOP - 7, 3.4, 'slot', sc);

    // ── 两根铜片：把接线柱和「板面上那两个金属件」连成一条导体 ──
    // 左柱（−70）→ 铰链支架（−55~−35）；右柱（+70）→ 静触点（8~32）。
    // 走在板面顶棱上（y = −2.6，板顶面是 −5、柱脚在 0）：铜片的顶边正好顶到
    // 触点和支架的脚，读起来就是「一条铜片从柱子底下铺到触点上」。
    // 画在【金属件之后】：铜片压在触点/支架的脚上，才像用螺钉拧住的。
    var STRAP_Y = -2.6;
    copperStrap(ctx, -70, HB0 + 10, STRAP_Y);
    copperBolt(ctx, -70, STRAP_Y);
    copperStrap(ctx, CONTACT_X + 8, 70, STRAP_Y);
    copperBolt(ctx, 70, STRAP_Y);

    // 刀片：绕左端转轴转。断开抬起约 20°（再高就像旗子，再低看不出断开）。
    // 闭合时压到 +0.02：不能是 0，0 画出来像浮着，微微压下才有「压住触点」的意思。
    // 角度取反的原因见函数头：刀片现在伸向 +x，正角是顺时针，正角才是往下压。
    // 长度：从转轴（-46）伸到局部 +40，静触点移到 +20，正好垫在刀片末段下面。
    // 【刀片和右手柄都要停在右接线柱（+70）左边】——接线柱钉在 ±70 的端子上，
    // 那个位置被全局端子网格锁死（所有导线、拖拽坐标、避让盒都按 ±70 算），
    // 所以不能把柱子往外挪，只能把刀片收短：刀片到 +40、手柄到 +56，
    // 柱子的滚花螺母从 +63 起，两者留 7px 空档，谁也不压谁。
    // （原来刀片伸到 +81、手柄到 +110，直接从柱子上横穿过去，闭合时看着
    //   刀片把柱子切成两半。）
    ctx.save();
    ctx.translate(PIV.x, PIV.y);
    ctx.rotate(closed ? 0.02 : -0.28);
    // 刀片：上沿受光的金属条。改成「上亮下暗」的竖向渐变 + 两端倒角，
    // 原来那种整条一个色的写法在放大镜里是一块铁皮。铜色同触点那一套。
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, 0, -BLADE_HT, BLADE_LEN, BLADE_HT * 2, 3);
    ctx.clip();
    ctx.fillStyle = linGrad(ctx, 0, -BLADE_HT, 0, BLADE_HT,
      [[0, '#fdf0e0'], [0.12, '#f3d0aa'], [0.34, '#dfa76f'],
       [0.62, '#c4863f'], [0.86, '#a86c2c'], [1, '#8a5620']]);
    ctx.fillRect(0, -BLADE_HT, BLADE_LEN, BLADE_HT * 2);
    // 拉丝：沿长度方向的细线。刀片是轧出来的，表面有轧制纹
    if (sc >= 1.3) {
      ctx.strokeStyle = 'rgba(255,236,205,0.34)'; ctx.lineWidth = 0.7;
      for (var bz = -BLADE_HT + 1.6; bz < BLADE_HT; bz += 2.2) {
        ctx.beginPath(); ctx.moveTo(2, bz); ctx.lineTo(BLADE_LEN - 2, bz); ctx.stroke();
      }
    }
    ctx.restore();
    roundRect(ctx, 0, -BLADE_HT, BLADE_LEN, BLADE_HT * 2, 3);
    ctx.strokeStyle = 'rgba(96,58,16,0.6)'; ctx.lineWidth = 0.9; ctx.stroke();
    ctx.fillStyle = 'rgba(255,244,224,0.78)';   // 刀背上的一条锐利高光
    roundRect(ctx, 3, -BLADE_HT + 1.1, BLADE_LEN - 8, 1.3, 0.65); ctx.fill();
    // 铰链端的铆钉孔：刀片是铆在支架上的，没有它刀片像贴在支架上
    if (sc >= 1) {
      ctx.fillStyle = 'rgba(90,52,14,0.38)';
      ctx.beginPath(); ctx.arc(4.5, 0, 2.1, 0, 6.284); ctx.fill();
    }
    // 绝缘手柄：刀片末端的灰色套筒（实物是胶木的，不是红的——红的在参考图里
    // 只有接线柱，手柄跟着红会让学生以为那是带电的一端）。内端套住刀片末段
    // GRIP_OVER，往外再伸 GRIP_LEN。
    var gx = BLADE_LEN - GRIP_OVER;
    ctx.save();
    ctx.beginPath(); roundRect(ctx, gx, -11, GRIP_LEN, 22, 8); ctx.clip();
    ctx.fillStyle = linGrad(ctx, 0, -11, 0, 11,
      [[0, '#f0f4f8'], [0.14, '#dbe2ea'], [0.42, '#b3bfcd'],
       [0.72, '#8d9cad'], [1, '#6d7d8e']]);
    ctx.fillRect(gx, -11, GRIP_LEN, 22);
    // 手柄上的防滑棱：胶木手柄是一圈圈车出来的
    if (sc >= 1.1) {
      ctx.strokeStyle = 'rgba(51,65,85,0.24)'; ctx.lineWidth = 1;
      for (var gz = gx + 7; gz < gx + GRIP_LEN - 3; gz += 3.4) {
        ctx.beginPath(); ctx.moveTo(gz, -10); ctx.lineTo(gz, 10); ctx.stroke();
      }
    }
    ctx.restore();
    roundRect(ctx, gx, -11, GRIP_LEN, 22, 8);
    ctx.strokeStyle = 'rgba(51,65,85,0.55)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    roundRect(ctx, gx + 5, -7, GRIP_LEN - 9, 4.4, 2.2); ctx.fill();
    ctx.restore();

    // 转轴销（黄铜）
    ctx.fillStyle = linGrad(ctx, PIV.x - 6, 0, PIV.x + 6, 0,
      [[0, '#8a5f1c'], [0.35, '#e8c37a'], [0.55, '#fff2c8'], [1, '#8a5f1c']]);
    ctx.beginPath(); ctx.arc(PIV.x, PIV.y, 5.5, 0, 6.284); ctx.fill();
    ctx.strokeStyle = 'rgba(70,46,10,0.55)'; ctx.lineWidth = 1; ctx.stroke();
    if (sc >= 1) {   // 销头上的一道月牙高光
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(PIV.x - 1.2, PIV.y - 1.2, 3.2, 2.4, -0.6, Math.PI * 1.0, Math.PI * 1.7);
      ctx.stroke();
    }

    // 「闭合 / 断开」：考试和教学都靠这两个字认状态，位置压在板面正中
    ctx.fillStyle = closed ? '#15803d' : '#64748b';
    ctx.font = 'bold 12px -apple-system,"PingFang SC",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(closed ? '闭合' : '断开', 0, (PLATE.FACE + PLATE.BOT) / 2 + 1);
    ctx.restore();
  }

  // ============================================================
  // 单刀双掷开关（人教版「楼梯开关」里的那一只）
  // ------------------------------------------------------------
  // 三柱排成一行钉在板面上（±70 与正中，和表头同一套「三柱」布局）：
  //   左柱 = 掷 1、中柱 = 公共（刀片的转轴）、右柱 = 掷 2。
  // 板面上再立起一副机构：
  //   · 正中一根支架把刀片举到 PIV，刀片【绕中点左右倒】；
  //   · 两侧各一块静触点，倒向哪边就搭在哪一块上；
  //   · 左柱 → 左触点、中柱 → 转轴、右柱 → 右触点，三段铜片把「柱子」和
  //     「板面上的金属件」连成一条看得见的导体（和闸刀开关同一条规矩：
  //     金属件一律纯铜，「导电的那条路」要一眼看得出来）。
  // 🔴 它【没有「断开」这一档】：刀片永远搭在某一侧（真实的单刀双掷就是
  //    这样 —— 它是「通到哪一头」的开关，不是「通 / 断」的开关）。
  // 🔴 触点顶面高度【由倾角反算】（见 SPDT.CT.top），不许手写一个数：改了
  //    倾角或刀长之后手写的那个数会让刀片悬在触点上、或者插进触点里。
  // ============================================================
  var SPDT = {
    // 🔴🔴 2026-10-18 用户第二版：① 刀片【加长】，让绝缘柄完全落在夹口外面
    //   （上一版刀片 66 长、柄从 40 开始，而夹口在 56 —— 合上之后是【绝缘皮】
    //   贴在触点上，物理上根本不通电）；② 静触点改成【弹簧夹口】：两条腿 +
    //   中间一道缝，刀片从缝里穿过去 —— 这样"刀片到底有没有夹进触点"一眼看得见，
    //   而不是"一根棍子悬在铁片上"。
    PIV: { x: 0, y: -52 },        // 刀片转轴（举在板面上方）
    HALF: 96, HT: 5,              // 刀片【单边】长度 / 半厚（96 = 夹口 56 + 柄 24 + 余量）
    TILT: 14 * Math.PI / 180,     // 倒向一侧时的倾角
    CT: { x: 56, w: 16, gap: 6 }, // 夹口横坐标 / 总宽 / 两条腿之间的缝宽
    POST: { w: 16 },              // 中央支架宽度（板面顶 → 转轴下方）
    GRIP: 24,                     // 远端黑色绝缘柄的长度
    FACE: 2.2,                    // 顶面（钢板厚度）的透视偏移
  };
  // 夹口顶面 = 刀片在夹口处的【上沿】再高 3px。
  // 为什么按「上沿」而不是「下沿」算：刀片是从上面【插进】缝里的，夹口必须比
  // 刀片高，两条腿才有东西夹住它。上一版按下沿算（CT.top = 刀片下沿），
  // 于是刀片整个浮在夹口上方 —— 看着像"搭"着，其实是"悬"着。
  // 高出的这 6.5px 就是「夹口在刀片上方还露着一截」—— 少了它，刀片顶棱和夹口
  // 顶棱齐平，看着又变成「搭在上面」。
  SPDT.CT.top = SPDT.PIV.y + SPDT.CT.x * Math.tan(SPDT.TILT)
              - SPDT.HT / Math.cos(SPDT.TILT) - 6.5;

  function drawSpdt(ctx, comp, rec) {
    // 刀片当下搭在哪一侧：以求解结果为准（rec.throw），还没解过就看参数。
    // 和内核的 throwOf 同一条规矩：非 2 即 1 —— 不存在「两边都不通」。
    var sel = (rec && rec.throw != null) ? (rec.throw === 2 ? 2 : 1)
            : ((+((comp.params || {}).throw) === 2) ? 2 : 1);
    var sc = ctxScale(ctx);
    var CT = SPDT.CT, PIV = SPDT.PIV;
    // 银白钢件的两套渐变（全站光源在左上）：
    //   SILVER_H 给【立着的】零件（左右亮暗）；SILVER_V 给【躺着的】刀片（上下亮暗）。
    var SILVER_H = [[0, '#f8fafc'], [0.18, '#e8eef5'], [0.45, '#cbd5e1'],
                    [0.72, '#a3aeba'], [1, '#7f8b98']];
    // 夹口【里侧】那条腿：它躲在缝的阴影里，整体压暗一档 —— 两条腿一样亮的话，
    // 缝就看不出来，夹口又变回一块实心铁片。
    var SILVER_D = [[0, '#cbd5e1'], [0.22, '#b3bfcd'], [0.55, '#9aa7b6'],
                    [0.82, '#7f8b98'], [1, '#6b7885']];
    var SILVER_V = [[0, '#ffffff'], [0.18, '#eef3f8'], [0.52, '#ccd6e1'],
                    [0.82, '#a6b2bf'], [1, '#8d99a6']];
    var EDGE = 'rgba(71,85,105,0.58)';

    ctx.save();
    ctx.translate(comp.x, comp.y);
    ctx.rotate((comp.rot || 0) * Math.PI / 180);
    basePlate(ctx, PLATE.HW, PLATE.TOP, PLATE.FACE, PLATE.BOT, { screws: false });
    ctx.restore();

    // 柱子夹在【底板】和【板面上的金属件】之间画，所以要从外层变换里退出来
    // 单独一段 —— posts() 走的是 terminalWorld()，拿到的已经是绝对坐标。
    // 颜色照实物：中间那根（公共端）是红的，两边两个掷位是黑螺母。
    posts(ctx, comp, ['neg', 'pos', 'neg'], 1.4, 8);

    ctx.save();
    ctx.translate(comp.x, comp.y);
    ctx.rotate((comp.rot || 0) * Math.PI / 180);

    // ── 静触点 = 弹簧夹口（两条腿 + 中间一道缝）────────────────
    // 两条腿站在板面上、上端齐平；刀片从缝里【穿过去】。缝在刀片上下都露着
    // 一截暗面 —— 这一截就是"刀片真的插进去了"的唯一证据，别把它盖掉。
    var yB = PLATE.TOP + 1.5;
    var yT = CT.top;
    function topFace(x0, x1, dark) {
      // 钢板厚度：往右上偏移 FACE 的一块平行四边形。少了它，两条腿就是两根
      // 贴纸；有了它，夹口立刻读成"立着的钢片"。
      ctx.beginPath();
      ctx.moveTo(x0, yT); ctx.lineTo(x1, yT);
      ctx.lineTo(x1 + SPDT.FACE, yT - SPDT.FACE); ctx.lineTo(x0 + SPDT.FACE, yT - SPDT.FACE);
      ctx.closePath();
      ctx.fillStyle = dark ? 'rgba(148,163,184,0.95)' : 'rgba(226,232,240,0.98)';
      ctx.fill();
      ctx.strokeStyle = EDGE; ctx.lineWidth = 0.8; ctx.stroke();
    }
    function leg(x0, x1, dark) {
      ctx.save();
      ctx.beginPath(); roundRect(ctx, x0, yT, x1 - x0, yB - yT, 2.2); ctx.clip();
      ctx.fillStyle = linGrad(ctx, x0, 0, x1, 0, dark ? SILVER_D : SILVER_H);
      ctx.fillRect(x0, yT, x1 - x0, yB - yT);
      ctx.restore();
      roundRect(ctx, x0, yT, x1 - x0, yB - yT, 2.2);
      ctx.strokeStyle = EDGE; ctx.lineWidth = 0.9; ctx.stroke();
      // 受光的那一条边（左上光）
      ctx.fillStyle = dark ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.78)';
      roundRect(ctx, x0 + 1, yT + 2.4, 1.3, yB - yT - 5, 0.65); ctx.fill();
    }

    // 两个夹口都要画，而且【里侧腿 → 刀片 → 外侧腿】这三步的顺序对两边都成立：
    // 视线是从左前方来的，所以两个夹口都是「左边那条腿在后、右边那条腿在前」。
    var CLIPS = [-CT.x, CT.x];
    function backX(cx) { return [cx - CT.w / 2, cx - CT.gap / 2]; }   // 里侧的腿（暗）
    function frontX(cx) { return [cx + CT.gap / 2, cx + CT.w / 2]; }  // 外侧的腿（亮）
    // ① 里侧那条腿（先画，刀片要压在它上面）+ 缝里的暗面
    CLIPS.forEach(function (cx) {
      var b = backX(cx);
      leg(b[0], b[1], true);
      topFace(b[0], b[1], true);
      // 缝里的暗面：刀片上下各露一截，这两截就是"插进去了"
      ctx.fillStyle = 'rgba(51,65,85,0.55)';
      ctx.fillRect(cx - CT.gap / 2, yT, CT.gap, yB - yT);
    });

    // ── 中央支架：把转轴举到板面上方 ──────────────────────────
    var PW = SPDT.POST.w;
    var pTop = PIV.y - 7;
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, -PW / 2, pTop, PW, PLATE.TOP - pTop, 3);
    ctx.clip();
    ctx.fillStyle = linGrad(ctx, -PW / 2, 0, PW / 2, 0, SILVER_H);
    ctx.fillRect(-PW / 2, pTop, PW, PLATE.TOP - pTop);
    ctx.restore();
    roundRect(ctx, -PW / 2, pTop, PW, PLATE.TOP - pTop, 3);
    ctx.strokeStyle = EDGE; ctx.lineWidth = 0.9; ctx.stroke();
    // 顶端开叉：刀片夹在叉口里转（实物上就是一道黑缝）
    ctx.fillStyle = 'rgba(51,65,85,0.42)';
    roundRect(ctx, -3.4, pTop + 1.6, 6.8, 9, 1.8); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    roundRect(ctx, -PW / 2 + 1.5, pTop + 3, 1.7, PLATE.TOP - pTop - 5, 0.85); ctx.fill();

    // ── 刀片：一头铰在转轴、一头带黑柄 ────────────────────────
    // 刀片【单边】长 96：夹口在 56，黑柄从 72 开始 —— 金属刀身整段压在夹口上，
    // 绝缘柄完全露在夹口外面。上一版柄从 40 就开始，正好盖住触点（用户指出的
    // 「绝缘皮和触点接触」）。
    ctx.save();
    ctx.translate(PIV.x, PIV.y);
    // 刀片只朝【+x】长。掷 2 = 原样往右倒；掷 1 = 整根【镜像】到左边再倒。
    // 🔴 别用「转 π − TILT」代替镜像：那样刀片的上下也翻过来了，刀背高光
    //    会跑到下沿去（光源在左上，全站只有这一处会逆着光）。
    if (sel === 1) ctx.scale(-1, 1);
    ctx.rotate(SPDT.TILT);
    var L = SPDT.HALF, HT = SPDT.HT;
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, -6, -HT, L + 6, HT * 2, HT);
    ctx.clip();
    ctx.fillStyle = linGrad(ctx, 0, -HT, 0, HT, SILVER_V);
    ctx.fillRect(-6, -HT, L + 6, HT * 2);
    // 拉丝：刀片是轧出来的，表面有轧制纹
    if (sc >= 1.3) {
      ctx.strokeStyle = 'rgba(255,255,255,0.30)'; ctx.lineWidth = 0.7;
      for (var bz = -HT + 1.6; bz < HT; bz += 2.2) {
        ctx.beginPath();
        ctx.moveTo(-4, bz); ctx.lineTo(L - SPDT.GRIP - 6, bz); ctx.stroke();
      }
    }
    ctx.restore();
    roundRect(ctx, -6, -HT, L + 6, HT * 2, HT);
    ctx.strokeStyle = 'rgba(71,85,105,0.62)'; ctx.lineWidth = 0.9; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.88)';       // 刀背上的一条锐利高光
    roundRect(ctx, -4, -HT + 1.1, L + 2, 1.5, 0.75); ctx.fill();
    // 转轴端的一个铆钉孔（照片上就有这么个孔）
    if (sc >= 1) {
      ctx.fillStyle = 'rgba(71,85,105,0.42)';
      ctx.beginPath(); ctx.arc(-1.5, 0, 1.9, 0, 6.284); ctx.fill();
    }
    // 远端的【黑色绝缘柄】：学生捏的就是这一段。柄比刀身厚一圈，
    // 末端是圆的 —— 平头的黑块读起来像贴上去的胶带。
    var gx = L - SPDT.GRIP, gw = SPDT.GRIP + 3, gh = HT + 1.5;
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, gx, -gh, gw, gh * 2, 4);
    ctx.clip();
    ctx.fillStyle = linGrad(ctx, 0, -gh, 0, gh,
      [[0, '#59616b'], [0.20, '#3a4149'], [0.55, '#242a30'], [1, '#14181c']]);
    ctx.fillRect(gx, -gh, gw, gh * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    roundRect(ctx, gx + 2, -gh + 1.6, gw - 6, 2.2, 1.1); ctx.fill();
    ctx.restore();
    roundRect(ctx, gx, -gh, gw, gh * 2, 4);
    ctx.strokeStyle = 'rgba(15,23,42,0.72)'; ctx.lineWidth = 0.8; ctx.stroke();
    ctx.restore();

    // ③ 外侧那条腿（亮，压在刀片上）+ 它的顶面 —— 画在刀片【之后】，
    //    刀片从它后面穿过去，这就是"夹住了"的那一下。
    CLIPS.forEach(function (cx) {
      var f = frontX(cx);
      leg(f[0], f[1], false);
      topFace(f[0], f[1], false);
      // 缝口的一道暗线：贴着里侧腿的右缘（有它才有深度）
      ctx.strokeStyle = 'rgba(15,23,42,0.26)'; ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(cx - CT.gap / 2 + 0.4, yT + 1.5);
      ctx.lineTo(cx - CT.gap / 2 + 0.4, yB - 1);
      ctx.stroke();
    });

    // ── 转轴销：压在刀片上（刀片是铆在它上面转的）────────────
    // 退出刀片的旋转再画 —— 销子是固定在支架上的，不跟着刀片倒。
    ctx.beginPath(); ctx.arc(PIV.x, PIV.y, 6.4, 0, 6.284);
    ctx.fillStyle = linGrad(ctx, PIV.x - 6.4, 0, PIV.x + 6.4, 0,
      [[0, '#475569'], [0.35, '#cbd5e1'], [0.55, '#f8fafc'], [1, '#64748b']]);
    ctx.fill();
    ctx.strokeStyle = 'rgba(15,23,42,0.6)'; ctx.lineWidth = 1; ctx.stroke();
    if (sc >= 1) {
      ctx.strokeStyle = 'rgba(15,23,42,0.45)'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(PIV.x - 3.4, PIV.y + 0.4); ctx.lineTo(PIV.x + 3.4, PIV.y + 0.4);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.ellipse(PIV.x - 1.2, PIV.y - 1.4, 3.4, 2.5, -0.6, Math.PI * 1.0, Math.PI * 1.7);
      ctx.stroke();
    }

    // ── 状态：刀片搭在哪一侧 ────────────────────────────────
    // 两只掷位都是「通」，所以这里不能用闸刀开关那套「闭合=绿 / 断开=灰」——
    // 要认的是【通到哪一头】。号印在【各自夹口正下方】的板面上（底板没有螺钉，
    // 这块是空的），当前那一头点亮。
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    [-1, 1].forEach(function (s) {
      var on = (s < 0 ? 1 : 2) === sel;
      var tx = s * CT.x, ty = PLATE.BOT - 8;
      ctx.font = (on ? 'bold ' : '') + '13px -apple-system,"PingFang SC",sans-serif';
      ctx.fillStyle = on ? '#0f766e' : 'rgba(100,116,139,0.75)';
      ctx.fillText(s < 0 ? '1' : '2', tx, ty);
    });
    ctx.restore();
  }

  // ============================================================
  // 小灯泡（人教版实物：浅灰底板 + 瓷灯座 + 银色螺口 + 玻璃泡）
  // ------------------------------------------------------------
  // rec.brightness 是 core 定的【物理量】P/P额，这里只把它画成
  // 「看得出来在变亮」。旧的一套只有 0.02 / 0.15 两个硬档：一过 0.02
  // 玻璃泡就跳到 0.55 的暖白、过 0.15 灯丝直接切白，于是 0.05 和 1.3
  // 看着几乎一样 —— 灯泡成了开关，不是渐亮。
  // 改成三条连续 ramp（灯丝色温 / 光晕半径与浓度 / 玻璃泡暖色填充），
  // 硬阈值只剩「通没通电」的 0.02，其余全按 P/P额 平滑爬。
  // ============================================================
  // 灯丝色温：暗红 → 橙 → 黄 → 近白，白炽灯真实的升温顺序。
  // b = P/P额（0 = 灭，1 = 额定，1.3 = 内核判过载的那条线）。
  var HEAT_STOPS = [
    [0.00, [138, 106,  58]],   // 冷钨丝（金属本色，没通电的样子）
    [0.10, [150,  44,  18]],   // 暗红
    [0.25, [206,  74,  20]],   // 红橙
    [0.45, [240, 132,  32]],   // 橙
    [0.70, [255, 192,  64]],   // 黄
    [1.00, [255, 238, 168]],   // 暖白（额定点）
    [1.30, [255, 255, 246]],   // 过载近白
  ];
  function heatRgb(b) {
    var s = HEAT_STOPS, i, k, a, c;
    if (b <= s[0][0]) return s[0][1].slice();
    for (i = 1; i < s.length; i++) {
      if (b <= s[i][0]) {
        k = (b - s[i - 1][0]) / (s[i][0] - s[i - 1][0]);
        a = s[i - 1][1]; c = s[i][1];
        return [Math.round(a[0] + (c[0] - a[0]) * k),
                Math.round(a[1] + (c[1] - a[1]) * k),
                Math.round(a[2] + (c[2] - a[2]) * k)];
      }
    }
    return s[s.length - 1][1].slice();
  }
  function rgbaStr(c, a) {
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }
  // 两个颜色按 t 混合（0 = 全 a，1 = 全 b）。LED 的管身颜色全靠它：
  // 同一支红管，通电时是「红往白热偏」，不通电时是「红往暗里压」——
  // 两端各混一次，比写死两套色值不容易漂。
  function mixRgb(a, b, t) {
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    return [Math.round(a[0] + (b[0] - a[0]) * t),
            Math.round(a[1] + (b[1] - a[1]) * t),
            Math.round(a[2] + (b[2] - a[2]) * t)];
  }

  // ============================================================
  // 损坏的公共外观
  // ------------------------------------------------------------
  // 三件东西共用：焦黑（soot）、红底「已损坏」小牌（faultTag）、青烟（drawSmoke）。
  // 抽出来是因为「损坏」这件事必须【一眼可辨】：灯泡断丝、电源烧黑、表打弯，
  // 三种外观要能被同一个记号统一读成「这件器材坏了，要修」。
  // ============================================================

  // 一层焦黑：从中心往外淡出。用叠加而不是直接填色 —— 底下的金属、塑料
  // 纹理还得透出来一点，全盖住就成了一个黑块，读不出「这是被烧过的那台」。
  function soot(ctx, cx, cy, rx, ry, a) {
    var g = ctx.createRadialGradient(cx, cy, 1, cx, cy, Math.max(rx, ry));
    g.addColorStop(0, 'rgba(24,20,18,' + (0.88 * a) + ')');
    g.addColorStop(0.55, 'rgba(45,38,34,' + (0.62 * a) + ')');
    g.addColorStop(1, 'rgba(60,52,46,0)');
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(1, ry / Math.max(rx, ry)); ctx.translate(-cx, -cy);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, Math.max(rx, ry), 0, 6.284); ctx.fill();
    ctx.restore();
  }

  // 「已损坏」小牌。挂在器材本体上（不遮读数面板），红底白字。
  function faultTag(ctx, x, y, text, sc) {
    var k = (sc || 1);
    ctx.save();
    unmirrorText(ctx, x);
    ctx.font = 'bold ' + (10.5 * k) + 'px -apple-system,"PingFang SC",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var w = ctx.measureText(text).width + 13 * k, h = 15.5 * k;
    ctx.fillStyle = '#b91c1c';
    roundRect(ctx, x - w / 2, y - h / 2, w, h, h / 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.fillText(text, x, y + 0.5 * k);
    ctx.restore();
  }

  // 青烟：几团上升并逐渐散开、变淡的圆。t 是秒，调用方每帧传页面自己的
  // 动画时钟（不要用 Date.now —— 那样截图会截到随机相位，出图不可复现）。
  function drawSmoke(ctx, x, y, t, opts) {
    opts = opts || {};
    var n = opts.count || 5, scale = opts.scale || 1;
    var rise = (opts.rise || 34) * scale, spread = (opts.spread || 13) * scale;
    ctx.save();
    for (var i = 0; i < n; i++) {
      // 每一团的相位错开，整体看起来是连续的烟柱而不是一串珠子
      var ph = ((t * (opts.speed || 0.55) + i / n) % 1);
      var cy = y - rise * ph;
      var cx = x + Math.sin((t * 1.7 + i * 2.1)) * spread * (0.35 + ph);
      var r = (3.2 + 6.4 * ph) * scale;
      var a = (1 - ph) * 0.34 * (opts.alpha == null ? 1 : opts.alpha);
      var g = ctx.createRadialGradient(cx, cy, 0.5, cx, cy, r);
      g.addColorStop(0, 'rgba(90,92,96,' + a + ')');
      g.addColorStop(1, 'rgba(140,142,148,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.284); ctx.fill();
    }
    ctx.restore();
  }

  function drawBulb(ctx, comp, rec) {
    // 损坏状态（内核回传）。'removed' = 灯泡被拧下来了，'burned' = 灯丝烧断。
    // 两者在电路上都是断路，但【画面上必须看得出区别】：一个是「这里本来就没
    // 灯泡」，一个是「灯泡还在，但里面断了」—— 学生要靠这个区别判断是缺件
    // 还是烧了。
    var fault = (rec && rec.fault) || null;
    var bright = rec ? Math.max(0, Math.min(rec.brightness || 0, 1.3)) : 0;
    // lit 以下当没通电。bg 是归一化强度，做 1.15 次幂把低亮度压一压，
    // 让 0.1~0.7 这段（学生真正在调的那段）拉得开，而不是一上来就满。
    var lit = bright > 0.02;
    var bg = lit ? Math.pow(Math.min(bright, 1.3) / 1.3, 1.15) : 0;
    var heat = heatRgb(bright);
    // 尺寸照教材实物（ref3）比着底板宽度折算：玻璃泡直径 ≈ 底板宽的 43%，
    // 瓷灯座底宽 ≈ 41%、高 ≈ 25%，螺口箍比灯座顶略窄。旧的一套（R=19）
    // 玻璃泡只有底板宽的 27%，摆在板子上像个顶针，和实物差着一倍。
    // 这组数是拿 dev-profile.js 逐行量出来的（参考图底板宽 314px ÷2.243 = 底板宽 140）：
    //   高 2~42  底板（宽 137~139）
    //   高 50     瓷座 42.4 宽
    //   高 66     箍 29 宽（最细处）
    //   高 82     玻璃泡最宽 39.7 —— 泡比座【窄】一点，不是大出一圈
    //   高 102    泡顶
    // 旧的一套把整个上部放大了 1.55 倍（泡最宽 60.5、总高 126），
    // 对照表上看着还行，和实物叠在一起就明显是个「大头灯」。
    var R = 19.5;                  // 玻璃泡半径（实物：泡径 ≈ 底板宽的 28%）
    var CY = -52;                  // 玻璃泡中心
    var SOCK_TOP = -25, SOCK_HW_B = 21, SOCK_HW_T = 15.5;
    var CAP_TOP = -38, CAP_HW = 14.5;   // 银色螺口箍
    var sc = ctxScale(ctx);
    ctx.save();
    ctx.translate(comp.x, comp.y);
    ctx.rotate((comp.rot || 0) * Math.PI / 180);

    // 灯座底板：和闸刀开关共用一块，两件器材摆在一起才是同一套
    basePlate(ctx, PLATE.HW, PLATE.TOP, PLATE.FACE, PLATE.BOT);

    // 发光光晕（压在灯座底下那一层，不然它会盖住瓷座的轮廓）。
    // 【半径】跟着亮度从 1.6R 长到 3.8R —— 旧的一套半径恒为 3R、只改浓度，
    // 这正是「额定和过载看着差不多」的主因：亮的灯泡该照得更远，不是更黄。
    // 分两层：内层是灯丝那一小团（很浓、很近），外层是被照亮的一片（淡、很远）。
    // 只有一层的写法，要么远处不够亮、要么近处不够烫，两头都不到位。
    if (lit) {
      var haloR = R * (1.6 + 2.2 * bg);
      var glow = ctx.createRadialGradient(0, CY, 2, 0, CY, haloR);
      glow.addColorStop(0, rgbaStr(heat, 0.92 * bg));
      glow.addColorStop(0.35, 'rgba(255,214,90,' + (0.42 * bg) + ')');
      glow.addColorStop(1, 'rgba(255,200,60,0)');
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(0, CY, haloR, 0, 6.284); ctx.fill();
      var coreR = R * (0.55 + 0.5 * bg);
      var core = ctx.createRadialGradient(0, CY + 2, 0.5, 0, CY + 2, coreR);
      core.addColorStop(0, rgbaStr(heat, Math.min(1, 0.55 + 0.45 * bg)));
      core.addColorStop(1, rgbaStr(heat, 0));
      ctx.fillStyle = core;
      ctx.beginPath(); ctx.arc(0, CY + 2, coreR, 0, 6.284); ctx.fill();
    }

    // ── 瓷灯座 ──────────────────────────────────────────────
    // 下粗上细的白色圆台，玻璃泡坐在它顶上。釉瓷的明暗：中间一道宽的釉面
    // 高光（陶瓷是漫反射，没有金属那种窄反光），下沿收一道暗边。
    ctx.beginPath();
    ctx.moveTo(-SOCK_HW_B, PLATE.TOP);
    ctx.lineTo(-SOCK_HW_T, SOCK_TOP);
    ctx.lineTo(SOCK_HW_T, SOCK_TOP);
    ctx.lineTo(SOCK_HW_B, PLATE.TOP);
    ctx.closePath();
    ctx.fillStyle = linGrad(ctx, -SOCK_HW_B, 0, SOCK_HW_B, 0, MAT.porcelain);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,118,106,0.42)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.save();                                    // 釉面高光（压在轮廓里）
    ctx.beginPath();
    ctx.moveTo(-SOCK_HW_B, PLATE.TOP);
    ctx.lineTo(-SOCK_HW_T, SOCK_TOP);
    ctx.lineTo(SOCK_HW_T, SOCK_TOP);
    ctx.lineTo(SOCK_HW_B, PLATE.TOP);
    ctx.closePath(); ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(-SOCK_HW_B + 2.5, SOCK_TOP, 6.5, PLATE.TOP - SOCK_TOP);
    ctx.fillStyle = 'rgba(96,94,84,0.16)';         // 右下的背光面
    ctx.fillRect(SOCK_HW_B - 8, SOCK_TOP, 6.5, PLATE.TOP - SOCK_TOP);
    ctx.restore();
    // 灯座根部的法兰（多出来的一圈台阶）：没有它，瓷座像直接插进板子里
    ctx.fillStyle = linGrad(ctx, 0, PLATE.TOP - 6, 0, PLATE.TOP + 1,
      [[0, '#f4f2ea'], [0.5, '#ddd9cd'], [1, '#b6b2a6']]);
    roundRect(ctx, -SOCK_HW_B - 2, PLATE.TOP - 5.5, (SOCK_HW_B + 2) * 2, 6.5, 2.5);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,118,106,0.4)'; ctx.lineWidth = 0.9; ctx.stroke();

    // ── 灯泡被拧下来了：到此为止 ─────────────────────────────
    // 剩下一个【空灯座】。玻璃泡、灯丝、螺口箍全都不画 —— 这不是「把灯泡
    // 画淡一点」就能表达的：拧下来以后那个位置就是空的，灯座口看得见。
    if (fault === 'removed') {
      // 螺口内圈（灯座里那个金属螺纹孔），空着的时候才看得见
      ctx.fillStyle = linGrad(ctx, -SOCK_HW_T, 0, SOCK_HW_T, 0,
        [[0, '#6b7280'], [0.45, '#cbd5e1'], [1, '#4b5563']]);
      ctx.beginPath();
      ctx.ellipse(0, SOCK_TOP + 0.5, SOCK_HW_T - 1.5, 3.4, 0, 0, 6.284);
      ctx.fill();
      ctx.strokeStyle = 'rgba(51,65,85,0.6)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = 'rgba(30,41,59,0.75)';    // 孔里是暗的
      ctx.beginPath();
      ctx.ellipse(0, SOCK_TOP + 1.6, SOCK_HW_T - 4.2, 2.2, 0, 0, 6.284);
      ctx.fill();
      // ⚠️ 牌子必须在 restore() 【之前】画 —— faultTag 收的是【元件自身的局部坐标】。
      //    挪到 restore 之后就变成世界坐标 (0, CY+…) 那一带，直接飞出画布左上角：
      //    屏幕上什么也看不见（实测扫遍画布，红像素只剩两根接线柱的 560 个，
      //    牌子一个像素都没有）。两只表、电源、二极管都是「牌在 restore 之前」，
      //    只有这里当初写反了。
      faultTag(ctx, 0, CY + R * 0.1, '灯泡已取下', 1);
      ctx.restore();
      posts(ctx, comp, ['pos', 'pos'], 1.4, 8);
      return;
    }

    // ── 玻璃泡 ──────────────────────────────────────────────
    // 先画，螺口箍【后画】压住它下半圈——实物上玻璃就是拧进箍里的，
    // 所以泡的轮廓线到箍口就断了，不是完整的一个圆。
    var gg = ctx.createRadialGradient(-R * 0.35, CY - R * 0.3, 3, 0, CY, R);
    if (lit) {
      // 玻璃泡是【透光的】——它自己不发光，暖色只是灯丝透过来的。所以三档的
      // 下限都压到 0.1 附近：微亮时玻璃基本还是白的，只是灯丝那点暗红透出来。
      gg.addColorStop(0, 'rgba(255,255,238,' + (0.10 + 0.88 * bg) + ')');
      gg.addColorStop(0.55, rgbaStr([heat[0], Math.min(255, heat[1] + 24), Math.round(heat[2] * 0.7)],
                                    (0.10 + 0.80 * bg)));
      gg.addColorStop(1, 'rgba(255,206,96,' + (0.08 + 0.64 * bg) + ')');
    } else {
      gg.addColorStop(0, 'rgba(244,249,253,0.95)');
      gg.addColorStop(0.6, 'rgba(216,230,242,0.85)');
      gg.addColorStop(1, 'rgba(184,204,222,0.9)');
    }
    ctx.fillStyle = gg;
    ctx.beginPath(); ctx.arc(0, CY, R, 0, 6.284); ctx.fill();
    // 玻璃壳的立体感：边缘聚暗 + 两道斜反光。只画反光不画边缘聚暗，
    // 玻璃会读成一块白色贴纸——真玻璃的「边」是暗的。烧得越亮，玻璃边缘
    // 越被光吃进去，所以聚暗和反光都随亮度退让。
    glassShell(ctx, 0, CY, R, { rim: 1 - 0.85 * bg, hi: 0.6 * (1 - 0.7 * bg) });
    // 泡的轮廓线随亮度淡出：烧得越亮，玻璃边缘越被光吃进去，不该还是一圈硬灰线。
    ctx.strokeStyle = 'rgba(148,163,184,' + (0.9 - 0.62 * bg) + ')';
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(0, CY, R, 0, 6.284); ctx.stroke();
    // 泡顶的排气尖：真灯泡的玻璃顶上有一个封口留下的小尖。它不发光、
    // 只是一小截玻璃，但少了它，泡就是一颗完美的球——那是弹珠不是灯泡。
    ctx.beginPath();
    ctx.moveTo(-2.6, CY - R + 1.2);
    ctx.quadraticCurveTo(-1.4, CY - R - 2.4, 0, CY - R - 2.2);
    ctx.quadraticCurveTo(1.4, CY - R - 2.0, 2.6, CY - R + 1.2);
    ctx.closePath();
    ctx.fillStyle = lit ? 'rgba(255,236,180,' + (0.5 + 0.4 * bg) + ')'
                        : 'rgba(226,236,245,0.95)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(148,163,184,' + (0.75 - 0.5 * bg) + ')';
    ctx.lineWidth = 1; ctx.stroke();

    // 熏黑：灯丝烧断的那一瞬间会在泡壁上留一层黑。压在玻璃【之上】——
    // 泡壁被熏黑是表面的事，画在玻璃底下会被那层高光洗掉，看着只是有点脏。
    if (fault === 'burned') {
      soot(ctx, 0, CY + 1, R * 0.96, R * 0.92, 1);
      // 熏黑之后再补一道玻璃的反光，泡才有「黑是黑在里面」的层次
      glassShell(ctx, 0, CY, R, { rim: 0.35, hi: 0.34 });
    }

    // ── 灯丝 ────────────────────────────────────────────────
    // 两根引线从螺口里升上来，顶端折向中间，中间挂一段螺旋丝。
    // 真灯泡的灯丝是【螺旋】的，而且靠两根支架丝撑着；老画法是一条折线，
    // 读出来是「一根歪线」。引线起点埋在箍里，箍一盖就只剩露在玻璃中的那截。
    // 灯丝本身就是那条色温曲线：微亮是暗红的丝，额定是暖白，过载近白。
    // 辉光（shadowBlur）也随亮度连续长，不再靠 0.15 这一刀切白或切灭。
    var leadCol = lit ? rgbaStr(heat, 1) : (fault === 'burned' ? '#4a3b2c' : '#8a6a3a');
    ctx.strokeStyle = leadCol;
    ctx.lineCap = 'round';
    if (lit) { ctx.shadowColor = rgbaStr(heat, 0.9); ctx.shadowBlur = 3 + 13 * bg; }
    // 两根引线（左右各一，从螺口升到灯丝高度）
    ctx.lineWidth = 1.9;
    ctx.beginPath();
    ctx.moveTo(-5.6, CAP_TOP + 2); ctx.lineTo(-5.6, CY + 3.2);
    ctx.moveTo(5.6, CAP_TOP + 2); ctx.lineTo(5.6, CY + 3.2);
    ctx.stroke();
    // 两根支架丝（细一点，从引线顶端斜插到灯丝两端）——真灯泡里就是它撑着灯丝
    ctx.lineWidth = 1.15;
    ctx.beginPath();
    ctx.moveTo(-5.6, CY + 3.2); ctx.lineTo(-4.2, CY - 1.4);
    ctx.moveTo(5.6, CY + 3.2); ctx.lineTo(4.2, CY - 1.4);
    ctx.stroke();
    // 螺旋灯丝：一段真正的螺旋（每一圈画成一小段斜线），圈数固定 6 圈。
    // lineJoin 必须是 round —— 斜接的尖角配上 1.7 的线宽，锯齿就成了三角形的
    // 「锯条」；圆角接头才读得出「这是一根被反复折过的钨丝」。
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    // 烧断的灯丝：整段螺旋从中间断开，两截各留一个熔融的小圆头。
    // 不是「画一根完整的丝再叠一个记号」—— 断就是断，中间那截不画。
    var broken = (fault === 'burned');
    var turns = 6, span = 8.4;
    var BRK = 1.5;                      // 断口半宽（灯丝中点在 CY − 1.4）
    function spiral(x0, x1) {
      var n = Math.max(1, Math.round(turns * Math.abs(x1 - x0) / span));
      ctx.beginPath();
      ctx.moveTo(x0, CY - 1.4);
      for (var k = 1; k <= n; k++) {
        var fx = x0 + (x1 - x0) * (k / n);
        ctx.lineTo(fx, CY - 1.4 + (k % 2 ? 1.5 : -1.5));
      }
      ctx.lineTo(x1, CY - 1.4);
      ctx.stroke();
    }
    if (broken) {
      spiral(-4.2, -BRK);
      spiral(BRK, 4.2);
      ctx.fillStyle = '#4b4038';
      [-BRK, BRK].forEach(function (bx) {
        ctx.beginPath(); ctx.arc(bx, CY - 1.4, 1.35, 0, 6.284); ctx.fill();
      });
    } else {
      spiral(-4.2, 4.2);
    }
    ctx.shadowBlur = 0;

    // ── 螺口（银色金属箍）────────────────────────────────────
    // 玻璃泡就是拧在这上面。真螺口是一圈圈的螺纹，不是两条横线——
    // 两条横线读出来是「印上去的标记」，螺纹才读得出「这是个能拧的东西」。
    ctx.fillStyle = linGrad(ctx, -CAP_HW, 0, CAP_HW, 0, MAT.chrome);
    roundRect(ctx, -CAP_HW, CAP_TOP, CAP_HW * 2, SOCK_TOP - CAP_TOP, 3.5); ctx.fill();
    ctx.save();
    roundRect(ctx, -CAP_HW, CAP_TOP, CAP_HW * 2, SOCK_TOP - CAP_TOP, 3.5); ctx.clip();
    // 螺纹：斜的椭圆弧，一条压一条 —— 圈与圈之间靠明暗分开
    var th = SOCK_TOP - CAP_TOP, nT = 3;
    for (var ti = 0; ti < nT; ti++) {
      var ty = CAP_TOP + th * (ti + 0.5) / nT;
      ctx.strokeStyle = 'rgba(51,65,85,0.42)'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(0, ty, CAP_HW - 0.6, th / (nT * 2.6), 0, 0, Math.PI);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.62)'; ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.ellipse(0, ty + 1.5, CAP_HW - 0.9, th / (nT * 2.6), 0, 0, Math.PI);
      ctx.stroke();
    }
    // 箍身上的竖向高光（左上一道）
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(-CAP_HW + 2.6, CAP_TOP + 1, 2.2, th - 2);
    ctx.fillStyle = 'rgba(30,41,59,0.18)';
    ctx.fillRect(CAP_HW - 5.2, CAP_TOP + 1, 3, th - 2);
    ctx.restore();
    ctx.strokeStyle = 'rgba(70,84,100,0.5)'; ctx.lineWidth = 1;
    roundRect(ctx, -CAP_HW, CAP_TOP, CAP_HW * 2, SOCK_TOP - CAP_TOP, 3.5); ctx.stroke();
    // 箍口：玻璃拧进去的那条缝，必须有一条暗环
    ctx.fillStyle = 'rgba(30,41,59,0.5)';
    roundRect(ctx, -CAP_HW, CAP_TOP - 1.2, CAP_HW * 2, 2.6, 1.3); ctx.fill();
    ctx.fillStyle = 'rgba(50,62,78,0.45)';
    roundRect(ctx, -CAP_HW, SOCK_TOP - 3, CAP_HW * 2, 3, 1.5); ctx.fill();
    if (sc >= 1.1) {   // 箍底沿的一道反光，把金属的圆角交代清楚
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-CAP_HW + 2, SOCK_TOP - 3.8); ctx.lineTo(CAP_HW - 2, SOCK_TOP - 3.8);
      ctx.stroke();
    }
    // 「已损坏」牌挂在瓷灯座上（不是泡中央）：泡中央那截断了的灯丝本身就是
    // 证据，牌子压上去等于把证据盖掉。
    // ⚠️ 同样必须在 restore() 【之前】画：牌子用的是局部坐标，restore 之后上下文
    //    已经回到世界坐标，再传 (0, SOCK_TOP+2) 就等于把牌子画到画布左上角去。
    if (fault === 'burned') faultTag(ctx, 0, SOCK_TOP + 2, '灯丝烧断', 1);

    // ── 灯座短路：两根接线柱之间夹了一根铜丝 ──────────────────
    // 这就是「灯座短路」在实物上的样子：灯泡【没坏】，是有人拿一根导线把灯座
    // 两端直接连起来了 —— 电流全走铜丝，灯丝里一点电流都没有（所以灯不亮），
    // 而电路仍然是通的。画在最后（压住灯座底板）、用亮铜色：它必须是画面上
    // 一眼就能找到的那件「多出来的东西」，否则学生只看得出「灯不亮」，
    // 看不出是为什么 —— 而「为什么」正是这个故障要教的东西。
    if (fault === 'shorted') {
      ctx.save();
      ctx.strokeStyle = linGrad(ctx, -HALF, 0, HALF, 0,
        [[0, '#8c5624'], [0.45, '#e8b183'], [0.6, '#bc7833'], [1, '#8c5624']]);
      ctx.lineWidth = 5.5; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-HALF, 0);
      ctx.quadraticCurveTo(0, 26, HALF, 0);      // 实际最低点 y≈13，落在底板面上
      ctx.stroke();
      // 两端的焊点：铜丝得像是【焊】在柱子上的，不是飘在那儿
      ctx.fillStyle = '#c9ced6';
      ctx.beginPath(); ctx.arc(-HALF, 0, 4.2, 0, 6.284); ctx.fill();
      ctx.beginPath(); ctx.arc(HALF, 0, 4.2, 0, 6.284); ctx.fill();
      ctx.strokeStyle = 'rgba(51,65,85,0.45)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(-HALF, 0, 4.2, 0, 6.284); ctx.stroke();
      ctx.beginPath(); ctx.arc(HALF, 0, 4.2, 0, 6.284); ctx.stroke();
      ctx.restore();
      faultTag(ctx, 0, SOCK_TOP + 2, '灯座短路', 1);
    }
    ctx.restore();

    // 两端柱子照参考图给红的：实物上这两件器材的接线柱都是红的。
    // 它没有极性——红在这里只是「实物就是这个颜色」，正负仍然由电路决定。
    posts(ctx, comp, ['pos', 'pos'], 1.4, 8);
  }

  // ============================================================
  // 表头（电流表 / 电压表）—— 照人教版学生电表画
  // ------------------------------------------------------------
  // 和教材实物对齐的几处：
  //   · 浅色胶木表壳，上沿圆角、下沿收边，面板左右各一颗螺丝
  //   · 白色表盘上【同一条弧线、两排数字】：外圈 0~3、内圈 0~0.6。
  //     两排刻度完全重合，因为 0.6 : 3 = 1 : 5 —— 教材上「读数先看量程」
  //     这句话的由来就是这个，画起来也必须重合，不能各画各的弧。
  //   · 指针从底部深色网纹块里伸出来，块里嵌着调零螺丝
  //   · 比表壳宽的底座 + 绿色面板，面板上三个接线柱：
  //       −（黑，最左）、两个量程柱（红，按量程从小到大往右排）
  // 端子坐标见 TERMINALS：锚点落在柱子顶帽下方，导线夹在柱子上，
  // 整台仪器都在导线【上方】，导线不会从表壳或底座中间穿过去。
  // ============================================================

  // 表盘：白底 + 上沿内阴影（表盘压在沉台里）。指针、刻度、数字画在它之上。
  function meterDialFace(ctx) {
    var M = MET;
    ctx.fillStyle = linGrad(ctx, 0, M.DIAL.y, 0, M.DIAL.y + M.DIAL.h,
      [[0, '#ffffff'], [0.72, '#f8fbfd'], [1, '#eaf0f6']]);
    roundRect(ctx, M.DIAL.x, M.DIAL.y, M.DIAL.w, M.DIAL.h, 14);
    ctx.fill();
    ctx.strokeStyle = 'rgba(100,116,139,0.45)'; ctx.lineWidth = 1; ctx.stroke();
    // 表盘压在沉台里：上沿一圈内阴影。没有它，白盘是浮在壳面上的贴纸。
    ctx.save();
    roundRect(ctx, M.DIAL.x, M.DIAL.y, M.DIAL.w, M.DIAL.h, 14); ctx.clip();
    ctx.fillStyle = 'rgba(51,65,85,0.13)';
    ctx.fillRect(M.DIAL.x, M.DIAL.y, M.DIAL.w, 3.5);
    ctx.fillRect(M.DIAL.x, M.DIAL.y, 3.5, M.DIAL.h);
    ctx.restore();
  }

  // 玻璃面罩：画在指针【之上】才有「隔着玻璃看」的感觉。
  // 一道斜反光 + 一道弧形反光：只有斜带时表盘看着是平的（玻璃只是一层膜）。
  function meterGlass(ctx) {
    var M = MET;
    ctx.save();
    roundRect(ctx, M.DIAL.x, M.DIAL.y, M.DIAL.w, M.DIAL.h, 14);
    ctx.clip();
    glassHighlight(ctx, M.DIAL.x, M.DIAL.y, M.DIAL.w, M.DIAL.h);
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.ellipse(0, M.DIAL.y + M.DIAL.h * 0.30, M.DIAL.w * 0.40, M.DIAL.h * 0.34,
      0, Math.PI * 1.10, Math.PI * 1.62);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(0, M.DIAL.y + M.DIAL.h * 0.32, M.DIAL.w * 0.44, M.DIAL.h * 0.36,
      0, Math.PI * 1.14, Math.PI * 1.58);
    ctx.stroke();
    ctx.restore();
  }

  // 表壳：上沿大圆角、下沿小圆角。全站唯一一处两个圆角不一样的壳子，
  // 所以不走通用的 roundRect。
  function meterCasePath(ctx, hw, top, bot, rt, rb) {
    ctx.beginPath();
    ctx.moveTo(-hw, bot - rb);
    ctx.lineTo(-hw, top + rt);
    ctx.quadraticCurveTo(-hw, top, -hw + rt, top);
    ctx.lineTo(hw - rt, top);
    ctx.quadraticCurveTo(hw, top, hw, top + rt);
    ctx.lineTo(hw, bot - rb);
    ctx.quadraticCurveTo(hw, bot, hw - rb, bot);
    ctx.lineTo(-hw + rb, bot);
    ctx.quadraticCurveTo(-hw, bot, -hw, bot - rb);
    ctx.closePath();
  }

  // 一字槽小螺丝。面板螺丝和调零螺丝共用 —— 调零螺丝必须是「金属螺钉」
  // 的样子：画成深色圆片会和「−」接线柱标记混起来，学生分不清哪个是极性。
  function meterScrew(ctx, x, y, r) {
    var sc = ctxScale(ctx);
    // 螺钉座的一圈凹坑：真表的面板螺丝是沉进塑料里的
    ctx.fillStyle = 'rgba(51,65,85,0.18)';
    ctx.beginPath(); ctx.arc(x, y, r + 1.1, 0, 6.284); ctx.fill();
    screwHead(ctx, x, y, r, 'slot', sc);
  }

  // ── 表壳 / 底座：电流表、电压表、灵敏电流计【共用】的两块壳子 ────────
  // 用户 2026-10-18：「参考电流表的外形，然后参考这幅图片来做一个灵敏电流计」。
  // 「参考外形」落在代码里就是【同一份几何、同一套光影】，只让色板可传：
  //   · 电流表 / 电压表传 null ⇒ 用原来那组米白（一个像素都不许变）；
  //   · 灵敏电流计传一组浅蓝 ⇒ 和用户给的那张课本图同色，摆在一起又能一眼分开。
  // 抽出来的理由和 meterCasePath 一样：两件器材各写一份壳子，改一处漏一处，
  // 最后就是「同一家厂的两只表，圆角半径都不一样」。
  function meterCaseBody(ctx, stops) {
    var M = MET;
    softShadow(ctx, -M.CASE_HW, M.CASE_TOP, M.CASE_HW * 2, M.CASE_BOT - M.CASE_TOP, 18, 16);
    contactShadow(ctx, 0, M.CASE_BOT + 1, M.CASE_HW * 0.92, 6, 0.26);
    ctx.fillStyle = linGrad(ctx, -M.CASE_HW, M.CASE_TOP, M.CASE_HW * 0.5, M.CASE_BOT,
      stops || [[0, '#fdfefe'], [0.40, '#e9eff6'], [1, '#c4d0de']]);
    meterCasePath(ctx, M.CASE_HW, M.CASE_TOP, M.CASE_BOT, 24, 7);
    ctx.fill();
    ctx.strokeStyle = 'rgba(51,65,85,0.55)'; ctx.lineWidth = 1.4; ctx.stroke();
    // 壳面上的两道模压棱：外侧一圈是壳的翻边，里侧一圈是面板的沉台。
    // 只有外圈时表壳是一块平板；加上里圈，它才是一只「盒」。
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.1;
    meterCasePath(ctx, M.CASE_HW - 3.5, M.CASE_TOP + 3.5, M.CASE_BOT - 3.5, 21, 5);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(100,116,139,0.28)'; ctx.lineWidth = 1;
    meterCasePath(ctx, M.CASE_HW - 5.5, M.CASE_TOP + 5.5, M.CASE_BOT - 5.5, 19.5, 4);
    ctx.stroke();
    // 壳顶的一道受光：上沿那一圈是圆的，光在左上
    ctx.save();
    meterCasePath(ctx, M.CASE_HW, M.CASE_TOP, M.CASE_BOT, 24, 7); ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(-M.CASE_HW + 6, M.CASE_TOP + 2, M.CASE_HW * 2 - 12, 3);
    ctx.fillStyle = 'rgba(51,65,85,0.10)';
    ctx.fillRect(-M.CASE_HW + 6, M.CASE_BOT - 7, M.CASE_HW * 2 - 12, 5);
    ctx.restore();
  }

  // 底座：比表壳宽一圈的浅色台座 + 顶上一块绿色面板（接线柱就立在绿板上）。
  // 白色丝印（− / 0.6 / 3 或 − / +）不在这里画 —— 那是每只表自己的字。
  function meterBaseBody(ctx, stops) {
    var M = MET;
    var BT = M.BASE_TOP, BB = M.BASE_BOT;
    softShadow(ctx, -M.BASE_HW, BT - 3, M.BASE_HW * 2, BB - BT + 8, 12, 8);
    contactShadow(ctx, 0, BB + 1, M.BASE_HW * 0.94, 5, 0.28);
    ctx.save();
    roundRect(ctx, -M.BASE_HW, BT, M.BASE_HW * 2, BB - BT, 6); ctx.clip();
    ctx.fillStyle = linGrad(ctx, 0, BT, 0, BB,
      stops || [[0, '#e6edf4'], [0.28, '#ccd7e3'], [0.68, '#b0bdcb'], [1, '#8fa0b2']]);
    ctx.fillRect(-M.BASE_HW, BT, M.BASE_HW * 2, BB - BT);
    ctx.restore();
    roundRect(ctx, -M.BASE_HW, BT, M.BASE_HW * 2, BB - BT, 6);
    ctx.strokeStyle = 'rgba(51,65,85,0.45)'; ctx.lineWidth = 1.2; ctx.stroke();
    // 底座前脸的两道模压棱：上棱受光、下棱背光。底座才不是一块厚板。
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-M.BASE_HW + 4, BT + 0.9); ctx.lineTo(M.BASE_HW - 4, BT + 0.9);
    ctx.stroke();
    ctx.fillStyle = 'rgba(40,52,68,0.20)';
    roundRect(ctx, -M.BASE_HW + 3, BB - 3, M.BASE_HW * 2 - 6, 2.4, 1.2); ctx.fill();
    // 上表面（画成梯形，近大远小），白色字印在上面
    ctx.beginPath();
    ctx.moveTo(-M.BASE_HW + 4, BT + 3);
    ctx.lineTo(M.BASE_HW - 4, BT + 3);
    ctx.lineTo(M.BASE_HW - 13, BT + 15);
    ctx.lineTo(-M.BASE_HW + 13, BT + 15);
    ctx.closePath();
    ctx.fillStyle = linGrad(ctx, 0, BT + 3, 0, BT + 15, [[0, '#2f8f5b'], [1, '#196240']]);
    ctx.fill();
    ctx.strokeStyle = 'rgba(6,78,59,0.75)'; ctx.lineWidth = 1; ctx.stroke();
    // 绿面板上的一道反光：塑料的漫反射，宽而软
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.beginPath();
    ctx.moveTo(-M.BASE_HW + 8, BT + 4.6);
    ctx.lineTo(M.BASE_HW - 8, BT + 4.6);
    ctx.lineTo(M.BASE_HW - 15, BT + 9);
    ctx.lineTo(-M.BASE_HW + 15, BT + 9);
    ctx.closePath(); ctx.fill();
  }

  // 电表的【示数】—— 指针实际指着多少。
  //
  // 未调零时指针整体偏右 ZERO_OFF×量程（模拟真表没调零），读数必须跟着偏：
  // 否则学生看到「针指 0.13、数字写 0.10」，只会以为表坏了，而不是
  // 「没调零，读出来的数据不可信」。调零后指针回到真值，读数一起回来 ——
  // 「调零」这个操作才看得出效果。
  //
  // 反接 / 打表损坏时指针顶在限位钉上（那个位置根本没有刻度），不参与换算，
  // 照原样返回真值：那两档的读数框写的是「读不出数」，不印数字。
  //
  // 🔴 指针角度和表盘数字都走这一个函数 —— 各算各的迟早差一点点，
  //    而那一点点正是「指针和读数对不上」。
  function meterIndicated(comp, rec) {
    var v = (rec && rec.reading) || 0;
    if (!comp || !comp.params || comp.params.zeroed) return v;
    if (v < 0) return v;                       // 反接：指针顶在左边的限位钉上
    if (rec && rec.fault) return v;            // 打表弯针，指针已经回不到零
    var rng = (rec && rec.range) || (comp.params && comp.params.range) || 0;
    if (!(rng > 0)) return v;
    return v + MET.ZERO_OFF * rng;
  }

  // 读数的格式化（表盘上那块数字示数用）。
  // 优先用 circuit-params.js 的 num1 / num2 —— 表盘上的数字和侧栏那张 I/U/R 表
  // 【必须是同一套规则】，否则学生把两处一对照会看到两个不同的数，
  // 而其中一个必然「看着不对」，那比不显示更坏。
  // two = 要两位小数（电流表：0.6A 量程的分度值是 0.02A，一位小数会把 0.13
  // 印成 0.1，和指针指的位置对不上）。电压表仍是一位。
  // 那个模块万一没加载（离屏出图工具、单文件测试），退回下面这份等价实现。
  function fmtRead(v, two) {
    var G = (typeof self !== 'undefined') ? self
          : (typeof global !== 'undefined') ? global : this;
    if (G.CircuitParams) {
      if (two && typeof G.CircuitParams.num2 === 'function') return G.CircuitParams.num2(v);
      if (typeof G.CircuitParams.num1 === 'function') return G.CircuitParams.num1(v);
    }
    var x = +v;
    if (!isFinite(x)) return '—';
    var s = x.toFixed(two ? 2 : 1);
    if (x !== 0 && parseFloat(s) === 0) {
      s = x.toFixed(two ? 3 : 2);
      if (parseFloat(s) === 0) s = x.toFixed(two ? 4 : 3);
    }
    return s;
  }

  function drawMeter(ctx, comp, rec, isVolt) {
    var M = MET, SW = MET_SWEEP;
    var reading = rec ? (rec.reading || 0) : 0;
    // 指针和数字都用【示数】：未调零时它比真实值大 ZERO_OFF×量程。
    var shown = meterIndicated(comp, rec);
    var range = (rec && rec.range) || (comp.params && comp.params.range) || (isVolt ? 3 : 0.6);
    // 反接：接线柱正负接反，电流从「−」柱流进，指针往【左】打。取 rec.reading 的
    // 符号而不是 rec.reversed——离屏工具（dev-crop 之类）手搓的 rec 里没有那个字段。
    var rev = reading < -1e-9;
    var over = !!(rec && rec.overRange);
    var POSTX = [TERMINALS[comp.type][0].x, TERMINALS[comp.type][1].x, TERMINALS[comp.type][2].x];
    // 两排刻度各自的满量程：外圈大、内圈小，比值恒为 5
    var HI_V = isVolt ? 15 : 3, LO_V = isVolt ? 3 : 0.6;
    var HI_TX = isVolt ? ['0', '5', '10', '15'] : ['0', '1', '2', '3'];
    var LO_TX = isVolt ? ['0', '1', '2', '3'] : ['0', '0.2', '0.4', '0.6'];
    var POST_TX = isVolt ? ['3', '15'] : ['0.6', '3'];
    // 当前量程是哪一排：真表上两排数字都印着，看错排就读错数，
    // 所以把【当前有效】的那排画深、另一排画浅，指针读数才对得上号。
    var hiActive = range >= HI_V - 1e-9;

    ctx.save();
    ctx.translate(comp.x, comp.y);
    ctx.rotate((comp.rot || 0) * Math.PI / 180);

    // ── 表壳 ────────────────────────────────────────────────
    var sc = ctxScale(ctx);
    // 壳子本体（阴影 + 填充 + 两道模压棱 + 顶沿受光）在 meterCaseBody 里，
    // 和灵敏电流计共用；这里只留「这只表自己的字」。
    meterCaseBody(ctx, null);
    // 型号丝印：真表（J0407 / J0408）的壳顶就印着型号。两排数字之外多一行
    // 小字，整台仪器立刻从「一张画」变成「一台仪器」。
    if (sc >= 1) {
      silk(ctx, isVolt ? 'J0408' : 'J0407', 0, M.CASE_TOP + 11, 8.5,
        'rgba(100,116,139,0.9)', 'rgba(255,255,255,0.55)');
    }

    // 面板螺丝（左右各一颗，压在表壳圆角内侧、表盘上方）
    meterScrew(ctx, -M.CASE_HW + 14, M.CASE_TOP + 8, 5.5);
    meterScrew(ctx, M.CASE_HW - 14, M.CASE_TOP + 8, 5.5);

    // ── 白色表盘 ────────────────────────────────────────────
    meterDialFace(ctx);

    // ── 刻度弧 ──────────────────────────────────────────────
    // 三档线长，和真表一致：
    //   大格（带数字）3 段 × 每段 10 小格 —— 0.6A 量程一大格 0.2A、小格 0.02A；
    //   3A 量程共用同一条弧，一大格 1A、小格 0.1A（两排数字正好落在同一批长线上）。
    //   大格【中点】的线短一截（9.5/14），其余小格再短（6/14）——
    //   上一版把中点也画成大格那么长，一条弧上就多出三根没有数字的长线，
    //   看着像刻度印漏了，读数时也分不清哪根才是大格。
    var MAJOR = 3, MINOR = 10, total = MAJOR * MINOR, i;
    for (i = 0; i <= total; i++) {
      var a = SW.A0 + (SW.A1 - SW.A0) * (i / total);
      var step = i % MINOR;                       // 0 = 带数字的大格
      var isMajor = (step === 0), isHalf = (step === MINOR / 2);
      var r1 = M.RT1, r0 = M.RT1 - (isMajor ? 14 : (isHalf ? 9.5 : 6));
      ctx.strokeStyle = isMajor ? '#1f2937' : '#94a3b8';
      ctx.lineWidth = isMajor ? 2 : (isHalf ? 1.3 : 1);
      ctx.beginPath();
      ctx.moveTo(M.PIVOT.x + Math.cos(a) * r0, M.PIVOT.y + Math.sin(a) * r0);
      ctx.lineTo(M.PIVOT.x + Math.cos(a) * r1, M.PIVOT.y + Math.sin(a) * r1);
      ctx.stroke();
    }

    // ── 两排数字 ────────────────────────────────────────────
    // 字号跟着刻度一起放大（12 → 14 / 10.5 → 12.5）：用户第 3 点要的就是
    // 「教室里看得清」，弧半径放大了而字号不动，数字反而显得更小。
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    [['hi', M.RN_HI, HI_TX, 14, 3],
     ['lo', M.RN_LO, LO_TX, 12.5, 2]].forEach(function (row) {
      var on = (row[0] === 'hi') ? hiActive : !hiActive;
      ctx.fillStyle = on ? '#1f2937' : '#b9c3cf';
      ctx.font = (on ? 'bold ' : '') + row[3] + 'px -apple-system,"PingFang SC",sans-serif';
      for (var k = 0; k < row[2].length; k++) {
        var ang = SW.A0 + (SW.A1 - SW.A0) * (k / (row[2].length - 1));
        ctx.fillText(row[2][k],
          M.PIVOT.x + Math.cos(ang) * row[1],
          M.PIVOT.y + Math.sin(ang) * row[1]);
      }
    });

    // 表盘正中的大字母
    ctx.fillStyle = '#1f2937';
    ctx.font = 'bold 22px -apple-system,"PingFang SC",sans-serif';
    ctx.fillText(isVolt ? 'V' : 'A', 0, M.PIVOT.y - 17);

    // ── 数字示数（可选，默认【不显示】）────────────────────────
    // 🔴 2026-10-16 用户第 1 点：原来这块小液晶贴在【表盘内部】上方
    //    （−30,−40 那个 60×20 的框）。两个毛病：
    //      ① 玻璃面罩那道白色弧形反光正好横切过它（glassHighlight 的椭圆
    //         圆心就落在表盘上部），字被压掉一截 —— 用户说的「有遮挡」；
    //      ② 60×20 的框里塞 13px 的字，投影到教室大屏上根本读不出来。
    //    现在整块牌子【搬出绘制层】了：它画在【表壳正上方】，而且必须画在
    //    【导线之后】—— 导线是压在元件之上的（见页面 drawFrame），留在这一层
    //    画的话，从表上方经过的那根线会横切过读数牌，又变回「有遮挡」。
    //    所以这一块的实现在页面里（drawMeterReadout，由 drawTags 那一层调），
    //    几何从 D.METER_READOUT 取，绘制层和页面读同一份数字。
    //    这一层只保留【表盘本体】——放大镜（drawZoom）与离屏出图工具看到的
    //    就是一台干净的表，读数在放大镜底下那一行文字里。

    // ── 底部网纹块 + 调零螺丝 ───────────────────────────────
    // 教材上指针的转轴就藏在这块深色网纹里。块先画，指针后画压在上面。
    var B = M.BLOCK;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(-B.hwT, B.top); ctx.lineTo(B.hwT, B.top);
    ctx.lineTo(B.hwB, B.bot); ctx.lineTo(-B.hwB, B.bot);
    ctx.closePath();
    ctx.fillStyle = linGrad(ctx, 0, B.top, 0, B.bot, [[0, '#4b5563'], [1, '#1f2937']]);
    ctx.fill();
    ctx.clip();
    ctx.strokeStyle = 'rgba(226,232,240,0.30)'; ctx.lineWidth = 1;
    for (var hx = -70; hx < 70; hx += 5) {
      ctx.beginPath();
      ctx.moveTo(hx, B.bot + 2);
      ctx.lineTo(hx + (B.bot - B.top) + 4, B.top - 2);
      ctx.stroke();
    }
    ctx.restore();
    meterScrew(ctx, M.ZERO.x, M.ZERO.y, M.ZERO.r);

    // ── 指针 ────────────────────────────────────────────────
    // 偏转量按【当前量程】算：同一个 0.3A，接 0.6 柱指半偏、接 3 柱指 10% 处。
    // 未调零的偏移已经折进 shown（见 meterIndicated）—— 指针和表盘数字共用
    // 这一个示数，不可能各算各的。
    var mag = Math.min(Math.abs(shown) / (range || 1), 1.06);
    // 反接时**不按比例往左画**：真表的指针这时候会一直顶到左边的限位钉上，
    // 电流再大也停在零刻度左边那一点点——那个位置根本没有刻度，所以「读不出数」。
    // 按比例镜像（−0.3A 画成 0.3A 的镜像）会落在弧上、指着 0.3 那条线，
    // 看着像是能读的，正好把这个知识点教反了。
    var frac = rev ? -0.085 : mag;
    var na = SW.A0 + (SW.A1 - SW.A0) * frac;
    var alert = over || rev;                       // 超量程 / 反接都用红针
    // 损坏（内核回传的闩锁状态，与「此刻正超量程」不是一回事）：指针【被打弯了】。
    // 真表过载打表之后就是这样 —— 针顶到限位钉上，力再大一点就把它折弯，
    // 之后无论怎么接都回不到零。所以损坏的表用一根折了的针来画，一眼可辨。
    var bent = !!(rec && (rec.fault === 'over' || rec.fault === 'rev'));
    ctx.save();
    ctx.translate(M.PIVOT.x, M.PIVOT.y);
    ctx.rotate(na);
    // 🔴 2026-10-16 用户第 3 点：指针一律【红色】。
    //    原来正常态是黑针、只有超量程 / 反接才变红（拿颜色当异常信号）。用户
    //    要的是「针本身就要红」，所以红不再表示异常 —— 异常改由【更深的暗红】
    //    来区分，加上原有的「已损坏」牌子、画布上的「指针反偏 / 读不出数」，
    //    信息一条没丢（红色 24 个色阶的差距在投影上是分得开的）。
    var rodCol = alert ? '#7f1d1d' : '#dc2626';
    // 配重尾：真表的指针在转轴【另一边】有一小截配重，指针才不至于被自己的
    // 重量压弯。少了它，指针就是一根插在轴上的针，读不出「会转」这件事。
    ctx.strokeStyle = 'rgba(15,23,42,0.20)'; ctx.lineWidth = 4.6;
    ctx.beginPath(); ctx.moveTo(-17, 1.8); ctx.lineTo(-7, 1.8); ctx.stroke();
    ctx.strokeStyle = rodCol; ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.moveTo(-17, 0); ctx.lineTo(-7, 0); ctx.stroke();
    ctx.lineCap = 'round';
    // 针身：从根部（−9）的 2.8 宽【连续收细】到针尖的一个点。
    // 真表的针就是这样一根刀片 —— 最宽处在转轴附近，一路收到尖，中途
    // 【没有任何一处比根部宽】。上一版是「2.2 宽的直杆 + 一个 5.6 宽的三角尖」，
    // 那个比杆宽出一倍的三角正是用户看到的那支【箭头】，必须去掉。
    // 分两段收：先缓收到刻度弧前（读起来是一根细长的针），最后 9px 再锐收成尖
    // （真针的尖是刀刃形的，不是一整个长三角）。
    // 🔴 2026-10-16 用户第 3 点「指针再长一点」：针尖从 RT0+6（=64）伸到
    //    RT1−3（=71）—— 也就是【顶到刻度弧最外那一圈的内侧】。原来的针尖只落在
    //    刻度带（58~74）偏里的位置，投影到大屏上离外圈数字还差一截，读数时眼睛
    //    要在针尖和数字之间来回找；针尖抵到外沿之后，一眼就能对上是哪一格。
    function blade(dy) {
      ctx.beginPath();
      ctx.moveTo(-9, -2.8 + dy);
      ctx.lineTo(M.RT1 - 12, -1.0 + dy);
      ctx.lineTo(M.RT1 - 3, dy);
      ctx.lineTo(M.RT1 - 12, 1.0 + dy);
      ctx.lineTo(-9, 2.8 + dy);
      ctx.closePath();
    }
    if (bent) {
      // 折弯：杆在中段折一下，针尖歪到弧的内侧去。
      // 几何跟着加长后的针走：原来 kx 取 0.52·(RT1−14)、针尖落在 RT1−15 上，
      // 针一加长（RT1 62 → 74）这段比例不变，折不折弯一眼仍分得开。
      var kx = (M.RT1 - 14) * 0.52, tipX = M.RT1 - 15, tipY = -5.6;
      ctx.strokeStyle = 'rgba(15,23,42,0.16)'; ctx.lineWidth = 3.6;
      ctx.beginPath(); ctx.moveTo(-8, 1.8); ctx.lineTo(kx, 1.8);
      ctx.lineTo(tipX, tipY + 1.4); ctx.stroke();
      ctx.strokeStyle = rodCol; ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.moveTo(-8, 0); ctx.lineTo(kx, 0); ctx.lineTo(tipX, tipY);
      ctx.stroke();
      ctx.save();
      ctx.translate(tipX, tipY);
      ctx.rotate(Math.atan2(tipY, tipX - kx));
      ctx.fillStyle = rodCol;
      ctx.beginPath();
      ctx.moveTo(1.5, 0); ctx.lineTo(-6, -1.9); ctx.lineTo(-6, 1.9);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    } else {
      // 阴影和针身【共用同一个路径】：分开画的话，针尖附近针身只剩半个像素宽、
      // 而阴影还有 3.4 宽，会从针尖边上漏出去一截灰边（看着像两根针）。
      ctx.fillStyle = 'rgba(15,23,42,0.16)'; blade(1.6); ctx.fill();
      ctx.fillStyle = rodCol; blade(0); ctx.fill();
      // 针根那一小截：把针身和转轴轴帽接起来（轴帽半径 4.6，针身从 −9 起画，
      // 少了这截，针看着是浮在轴旁边的）。
      ctx.strokeStyle = rodCol; ctx.lineWidth = 3.4;
      ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(-2, 0); ctx.stroke();
    }
    ctx.restore();
    // 限位钉：零刻度线外侧立着的一根小柱子，指针回到零就顶在它上面。
    // 位置取在刻度左端（A0 = −150°）之外一点 —— 正好落在「反接窗口」的【上方】，
    // 不会把那一格染黑（那一格是正接时必须干净的白表盘）。
    ctx.strokeStyle = 'rgba(51,65,85,0.75)'; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(M.PIVOT.x + Math.cos(SW.A0) * 60, M.PIVOT.y + Math.sin(SW.A0) * 60);
    ctx.lineTo(M.PIVOT.x + Math.cos(SW.A0) * 70, M.PIVOT.y + Math.sin(SW.A0) * 70);
    ctx.stroke();
    // 转轴轴心：一个带一字槽的黄铜轴帽，不是一块银片
    ctx.fillStyle = linGrad(ctx, -5, M.PIVOT.y, 5, M.PIVOT.y,
      [[0, '#5b6c7d'], [0.5, '#eef3f8'], [1, '#5b6c7d']]);
    ctx.beginPath(); ctx.arc(M.PIVOT.x, M.PIVOT.y, 4.6, 0, 6.284); ctx.fill();
    ctx.strokeStyle = 'rgba(15,23,42,0.45)'; ctx.lineWidth = 1; ctx.stroke();
    if (ctxScale(ctx) >= 1.1) {
      ctx.strokeStyle = 'rgba(30,41,59,0.55)'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(M.PIVOT.x - 2.6, M.PIVOT.y + 0.7);
      ctx.lineTo(M.PIVOT.x + 2.6, M.PIVOT.y - 0.7);
      ctx.stroke();
    }

    // ── 玻璃面罩（画在指针之上，才有「隔着玻璃看」的感觉）────
    meterGlass(ctx);

    // ── 底座 + 绿色面板 ─────────────────────────────────────
    // 台座本体在 meterBaseBody 里（和灵敏电流计共用），这里只印自己的丝印。
    var BT = M.BASE_TOP;
    meterBaseBody(ctx, null);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px -apple-system,"PingFang SC",sans-serif';
    ctx.fillText('−', POSTX[0], BT + 9);
    ctx.fillText(POST_TX[0], POSTX[1], BT + 9);
    ctx.fillText(POST_TX[1], POSTX[2], BT + 9);

    // ── 三个接线柱 ──────────────────────────────────────────
    // 必须先把表壳那一套 translate/rotate 还回去：posts() 按【世界坐标】
    // 落柱子，漏掉这个 restore 会把三根柱子整体平移一个元件的位置
    // （画面上就是右下角凭空多出三根柱子，而本体上没有）。
    // 「已损坏」牌挂在表壳上沿（表盘之上）——压在表盘中央会把刻度盖掉，
    // 而学生正需要对照「针打到哪儿了」来判断是超量程还是接反。
    if (bent) faultTag(ctx, 0, M.CASE_TOP + 7, '已损坏', 1);
    // 烧坏（动圈烧断）是比「打表」更重的一档，必须和「已损坏」分开画：
    // 打表还能看清针顶在哪儿（学生要对照刻度判是超量程还是接反），烧了就是
    // 一块废表 —— 表盘熏黑 + 「已烧坏」。内核那边 fault 也是两个不同的码
    // （over / burnt），这里只是把它们画得不一样。
    if (rec && rec.fault === 'burnt') {
      soot(ctx, 0, M.DIAL.y + M.DIAL.h * 0.5, M.CASE_HW * 0.74, M.DIAL.h * 0.64, 1);
      faultTag(ctx, 0, M.CASE_TOP + 7, '已烧坏', 1);
    }
    ctx.restore();
    // kind 按【端子序号】给：0 号是「−」柱（黑），1/2 号是两个量程柱（红）。
    posts(ctx, comp, ['neg', 'pos', 'pos']);
  }

  // ============================================================
  // 灵敏电流计（J0409 那一类：中心零、可双向偏转）
  // ------------------------------------------------------------
  // 用户 2026-10-18 给的那张课本图（「（a）灵敏电流计」）：浅蓝壳、白表盘、
  // 一条上凸的弧，弧顶正中是 0，往左 −10 −20 −30、往右 10 20 30；指针竖直
  // 向上停在 0；表盘正中一个大写 G；底部网纹块里嵌着调零螺丝；底座绿面板上
  // 两根柱子（左黑「−」右红「+」）。
  //
  // 外形【整套照电流表】：同一只表壳、同一块底座、同一批接线柱、同一套玻璃
  // 反光 —— meterCaseBody / meterBaseBody / meterDialFace / meterGlass 就是
  // 为此抽出来的。只换三处：
  //   ① 刻度：零点从弧的左端搬到【正中】⇒ 扫角 −150°…−30°（零位 −90° =
  //      正上方），数字是 ±30 而不是 0…3；
  //   ② 字母：A → G；
  //   ③ 柱子：三根（−/0.6/3）→ 两根（−/+）—— 满偏不是「换根柱子」换出来的。
  // 指针、配重尾、刀片形针身、轴帽、网纹块、调零螺丝全部沿用电流表那几段
  // （连宽度都是同一组数）：两只表摆在一起，学生该看出它们是同一类仪器。
  //
  // 🔴 读数【带符号】。电流表的 reading 是「电流大小」，反接要判错；这只表的
  //    reading 是「指针偏向哪边」—— 负号是信息，不是故障。所以这里既不做
  //    「反偏」判定、也不画「读不出数」，针就往左偏，学生在表盘上照读负值。
  // ============================================================
  var GAL = {
    // 扫角：零位在正上方（−90°），左右各 60° —— 和图片上那条弧的角度一致。
    A0: -Math.PI * 5 / 6, A1: -Math.PI / 6, ZERO: -Math.PI / 2,
    MAJOR: 6, MINOR: 10,          // 6 大格 × 每大格 10 小格
    // 数字半径：在弧的【内侧】、贴着刻度线内端（58 − 字号半高 ≈ 55）。
    // 图片上那几个数字就是紧贴弧线印的 —— 放到 50 会往表盘中心缩一圈，
    // 和中央那个 G 挤成一团（用户那张图上数字和 G 之间是留得出白的）。
    R_NUM: 55,
    NUM_FONT: 11,
    // 浅蓝壳：和用户给的那张图同色系。电流表是米白，两件摆在一起一眼分得开。
    CASE_STOPS: [[0, '#f9fcff'], [0.42, '#e2edf8'], [1, '#b6c8dc']],
    BASE_STOPS: [[0, '#eaf2fa'], [0.28, '#cfdcea'], [0.68, '#b0c2d6'], [1, '#8ea2b8']],
  };

  // 满偏 → 「印在刻度上的单位 + 换算系数」。
  // 🔴 真值在内核（CircuitCore.galUnitOf）：绘制层、电路图铭牌、损坏文案
  //    共用那一份。这里只做转发 —— 各写一套「多少以下算 μA」的话，只要有一处
  //    写反，同一只表就会在画布上读 18mA、在电路图上读 18000μA。
  //    内核没加载时（离屏出图、单文件测试）才退回下面这份等价实现。
  function galUnitOf(range) {
    var G2 = (typeof self !== 'undefined') ? self
           : (typeof global !== 'undefined') ? global : this;
    if (G2 && G2.CircuitCore && typeof G2.CircuitCore.galUnitOf === 'function') {
      return G2.CircuitCore.galUnitOf(range);
    }
    return (range < 0.00095) ? { u: 'μA', k: 1e6 } : { u: 'mA', k: 1e3 };
  }
  function galFullOf(comp, rec) {
    var r = (rec && rec.range) || (comp && comp.params && comp.params.range) || 0.03;
    return r > 0 ? r : 0.03;
  }
  // 刻度数字的写法：整数不带小数点（30 / 20 / 10），否则一位小数；
  // 负号用「−」（U+2212），和电流表两排数字里那个负号同一个字符。
  function galTickText(v) {
    var x = Math.abs(v);
    var s = (Math.abs(x - Math.round(x)) < 1e-6) ? String(Math.round(x)) : x.toFixed(1);
    return (v < -1e-9 ? '−' : '') + s;
  }

  function drawGalvanometer(ctx, comp, rec) {
    var M = MET, G0 = GAL;
    var shown = meterIndicated(comp, rec);        // 未调零时含偏移
    var range = galFullOf(comp, rec);
    var over = !!(rec && rec.overRange);
    var bent = !!(rec && rec.fault === 'over');
    var burnt = !!(rec && rec.fault === 'burnt');
    var POSTX = [TERMINALS.galvanometer[0].x, TERMINALS.galvanometer[1].x];
    var gu = galUnitOf(range), full = range * gu.k;

    ctx.save();
    ctx.translate(comp.x, comp.y);
    ctx.rotate((comp.rot || 0) * Math.PI / 180);
    var sc = ctxScale(ctx);

    // ── 表壳（浅蓝）+ 型号丝印 + 面板螺丝 ────────────────────
    meterCaseBody(ctx, G0.CASE_STOPS);
    if (sc >= 1) {
      silk(ctx, 'J0409', 0, M.CASE_TOP + 11, 8.5,
        'rgba(100,116,139,0.9)', 'rgba(255,255,255,0.55)');
    }
    meterScrew(ctx, -M.CASE_HW + 14, M.CASE_TOP + 8, 5.5);
    meterScrew(ctx, M.CASE_HW - 14, M.CASE_TOP + 8, 5.5);

    // ── 白色表盘 ────────────────────────────────────────────
    meterDialFace(ctx);

    // ── 刻度弧：中心零，左右各 3 大格 ────────────────────────
    // 大格（带数字）6 段、每段 10 小格；大格中点短一截、小格再短 —— 和电流表
    // 同一套线长（14 / 9.5 / 6）。这只表没有第二排数字，所以每一根刻度线
    // 都只有一种含义：从 0 往两边数。
    var i, a, step;
    var total = G0.MAJOR * G0.MINOR;
    for (i = 0; i <= total; i++) {
      a = G0.A0 + (G0.A1 - G0.A0) * (i / total);
      step = i % G0.MINOR;
      var isMajor = (step === 0), isHalf = (step === G0.MINOR / 2);
      var r1 = M.RT1, r0 = M.RT1 - (isMajor ? 14 : (isHalf ? 9.5 : 6));
      ctx.strokeStyle = isMajor ? '#1f2937' : '#94a3b8';
      ctx.lineWidth = isMajor ? 2 : (isHalf ? 1.3 : 1);
      ctx.beginPath();
      ctx.moveTo(M.PIVOT.x + Math.cos(a) * r0, M.PIVOT.y + Math.sin(a) * r0);
      ctx.lineTo(M.PIVOT.x + Math.cos(a) * r1, M.PIVOT.y + Math.sin(a) * r1);
      ctx.stroke();
    }

    // ── 刻度数字：−full … 0 … +full（七个）────────────────────
    // 印在弧的【内侧】（图片就是这么印的）。零那个字正好落在指针的行程上，
    // 指针从它中间穿过去 —— 真表就是这样，不是遮挡。
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#1f2937';
    ctx.font = 'bold ' + G0.NUM_FONT + 'px -apple-system,"PingFang SC",sans-serif';
    for (i = 0; i <= G0.MAJOR; i++) {
      a = G0.A0 + (G0.A1 - G0.A0) * (i / G0.MAJOR);
      ctx.fillText(galTickText(-full + 2 * full * (i / G0.MAJOR)),
        M.PIVOT.x + Math.cos(a) * G0.R_NUM,
        M.PIVOT.y + Math.sin(a) * G0.R_NUM);
    }
    // 单位：真表（J0409）表盘左下角印着 μA / mA。刻度数字是纯数字（−30…30），
    // 没有这行字，学生分不清那 30 是 30mA 还是 30μA —— 而这两档差 1000 倍。
    if (sc >= 0.85) {
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(71,85,105,0.85)';
      ctx.font = 'bold 9px -apple-system,"PingFang SC",sans-serif';
      ctx.fillText(gu.u, M.DIAL.x + 10, M.DIAL.y + M.DIAL.h - 12);
      ctx.textAlign = 'center';
    }

    // ── 表盘正中的大字母 G ──────────────────────────────────
    // 用衬线体（图片上那个 G 就是衬线），字号比 A/V 大一号 —— 它是这只表
    // 唯一的身份标记，投影到大屏上要认得出。位置在转轴上方、数字弧以内：
    // 再往上就顶到「0」那个字了。
    ctx.fillStyle = '#1f2937';
    ctx.font = 'bold 24px Georgia,"Times New Roman",serif';
    ctx.fillText('G', 0, M.PIVOT.y - 24);

    // ── 底部网纹块 + 调零螺丝（和电流表同一块、同一颗）────────
    var B = M.BLOCK;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(-B.hwT, B.top); ctx.lineTo(B.hwT, B.top);
    ctx.lineTo(B.hwB, B.bot); ctx.lineTo(-B.hwB, B.bot);
    ctx.closePath();
    ctx.fillStyle = linGrad(ctx, 0, B.top, 0, B.bot, [[0, '#4b5563'], [1, '#1f2937']]);
    ctx.fill();
    ctx.clip();
    ctx.strokeStyle = 'rgba(226,232,240,0.30)'; ctx.lineWidth = 1;
    for (var hx = -70; hx < 70; hx += 5) {
      ctx.beginPath();
      ctx.moveTo(hx, B.bot + 2);
      ctx.lineTo(hx + (B.bot - B.top) + 4, B.top - 2);
      ctx.stroke();
    }
    ctx.restore();
    meterScrew(ctx, M.ZERO.x, M.ZERO.y, M.ZERO.r);

    // ── 指针：零位竖直向上，向两边都能偏 ────────────────────
    // frac = 示数 / 满偏，clamp 到 ±1.02 —— 超量程时针顶到刻度弧外面一点点，
    // 正好是「打表」那个位置。零位角 −90°，左右各 60°。
    var frac = Math.max(-1.02, Math.min(1.02, shown / range));
    var na = G0.ZERO + (G0.A1 - G0.ZERO) * frac;
    var alert = over || bent;
    var rodCol = alert ? '#7f1d1d' : '#dc2626';
    ctx.save();
    ctx.translate(M.PIVOT.x, M.PIVOT.y);
    ctx.rotate(na);
    // 配重尾（和电流表同一组数）
    ctx.strokeStyle = 'rgba(15,23,42,0.20)'; ctx.lineWidth = 4.6;
    ctx.beginPath(); ctx.moveTo(-17, 1.8); ctx.lineTo(-7, 1.8); ctx.stroke();
    ctx.strokeStyle = rodCol; ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.moveTo(-17, 0); ctx.lineTo(-7, 0); ctx.stroke();
    ctx.lineCap = 'round';
    function blade(dy) {
      ctx.beginPath();
      ctx.moveTo(-9, -2.8 + dy);
      ctx.lineTo(M.RT1 - 12, -1.0 + dy);
      ctx.lineTo(M.RT1 - 3, dy);
      ctx.lineTo(M.RT1 - 12, 1.0 + dy);
      ctx.lineTo(-9, 2.8 + dy);
      ctx.closePath();
    }
    if (bent) {
      // 打表损坏：杆在中段折一下，针尖歪向【超量程那一侧】。
      // 电流表那根折针固定往左歪（它是「反接」打坏的），这只表两边都可能打，
      // 所以方向跟着 frac 的符号走。
      var side = (frac < 0) ? -1 : 1;
      var kx = (M.RT1 - 14) * 0.52, tipX = M.RT1 - 15, tipY = 5.6 * side;
      ctx.strokeStyle = 'rgba(15,23,42,0.16)'; ctx.lineWidth = 3.6;
      ctx.beginPath(); ctx.moveTo(-8, 1.8); ctx.lineTo(kx, 1.8);
      ctx.lineTo(tipX, tipY + 1.4); ctx.stroke();
      ctx.strokeStyle = rodCol; ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.moveTo(-8, 0); ctx.lineTo(kx, 0); ctx.lineTo(tipX, tipY);
      ctx.stroke();
      ctx.save();
      ctx.translate(tipX, tipY);
      ctx.rotate(Math.atan2(tipY, tipX - kx));
      ctx.fillStyle = rodCol;
      ctx.beginPath();
      ctx.moveTo(1.5, 0); ctx.lineTo(-6, -1.9); ctx.lineTo(-6, 1.9);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = 'rgba(15,23,42,0.16)'; blade(1.6); ctx.fill();
      ctx.fillStyle = rodCol; blade(0); ctx.fill();
      ctx.strokeStyle = rodCol; ctx.lineWidth = 3.4;
      ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(-2, 0); ctx.stroke();
    }
    ctx.restore();
    // 转轴轴心：带一字槽的黄铜轴帽（和电流表同一颗）
    ctx.fillStyle = linGrad(ctx, -5, M.PIVOT.y, 5, M.PIVOT.y,
      [[0, '#5b6c7d'], [0.5, '#eef3f8'], [1, '#5b6c7d']]);
    ctx.beginPath(); ctx.arc(M.PIVOT.x, M.PIVOT.y, 4.6, 0, 6.284); ctx.fill();
    ctx.strokeStyle = 'rgba(15,23,42,0.45)'; ctx.lineWidth = 1; ctx.stroke();
    if (sc >= 1.1) {
      ctx.strokeStyle = 'rgba(30,41,59,0.55)'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(M.PIVOT.x - 2.6, M.PIVOT.y + 0.7);
      ctx.lineTo(M.PIVOT.x + 2.6, M.PIVOT.y - 0.7);
      ctx.stroke();
    }

    // ── 玻璃面罩（画在指针之上）────────────────────────────
    meterGlass(ctx);

    // ── 底座 + 绿色面板（两根柱子的丝印：− / +）──────────────
    var BT = M.BASE_TOP;
    meterBaseBody(ctx, G0.BASE_STOPS);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px -apple-system,"PingFang SC",sans-serif';
    ctx.fillText('−', POSTX[0], BT + 9);
    ctx.fillText('+', POSTX[1], BT + 9);

    // 损坏牌（挂在表壳上沿，不盖刻度）—— 和电流表同一个位置、同一套措辞。
    if (bent) faultTag(ctx, 0, M.CASE_TOP + 7, '已损坏', 1);
    if (burnt) {
      soot(ctx, 0, M.DIAL.y + M.DIAL.h * 0.5, M.CASE_HW * 0.74, M.DIAL.h * 0.64, 1);
      faultTag(ctx, 0, M.CASE_TOP + 7, '已烧坏', 1);
    }
    ctx.restore();
    // 0 号是「−」柱（黑），1 号是「+」柱（红）。
    posts(ctx, comp, ['neg', 'pos']);
  }


  // ============================================================
  // 滑动变阻器（人教版图16.4-2）
  // ------------------------------------------------------------
  // 和教材图对齐的几处：
  //   · 两侧是两块灰色 A 形金属立板（不是白瓷柱），上端夹住金属杆、下端带脚
  //   · 白瓷管长度按立板间距给满，电阻丝只绕在【中间那一段】——两头留白的
  //     白瓷上拧着 A / B 两个接线柱，这正是「下面两柱接在电阻丝两头」的样子
  //   · 一根细金属杆横跨两板，鞍形滑片骑在杆上，触臂下探到绕线上
  //   · C / D 是金属杆两端的柱子，A / B 是瓷管两端的柱子 —— 四个【都是红的】
  //     （2026-10-09 起，用户要求接线柱颜色全站一致；红只表示「这是接线柱」，
  //      不表示极性，语义靠 A/B/C/D 四个字母）
  // 几何全部走 RHEO：滑片行程、命中框都靠它，一个数字都不能自作主张。
  // ============================================================
  // ============================================================
  // 滑动变阻器绕线【内部】的电流 / 电子流动（独立一层）
  // ------------------------------------------------------------
  // 为什么单独抽成一层、而不是画在 drawRheostat 里：
  //   ① 绕线上的粒子是靠相位驱动的【动画】，必须每帧重画；而变阻器的本体
  //      （密绕六十多圈的丝、瓷管、两块立板）画一次就够了，每帧重画纯属白费。
  //      所以本体留在静态缓存层，只有这一层每帧画。
  //   ② 导线是画在元件【之上】的（见页面 drawFrame 的注释：真实情况就是导线
  //      从器材上跨过去）。粒子要是跟着本体走，就会被导线盖掉一半 —— 而它
  //      恰恰是这一层要给人看的东西。
  // 用户 2026-10-11 点名要的：「滑动变阻器内部的电子电流的流动是没有显示的」。
  //
  // 三条判据，一条都不能省：
  //   · 【只画有电流的那半根】：判据直接读 rec.segments 的电流，不去推断接法。
  //     A-C/A-D 只画左半、B-C/B-D 只画右半、A-B 两半都画、C-D 两半都不画 ——
  //     接法一改这里自动跟着变，绘制层不必再写一份接法表（写两份迟早对不上）。
  //   · 【方向按段自己的电流符号】：段的 a→b 就是左→右，而 segments[i].i 的
  //     约定正是「沿该段的 a→b 为正」（见内核 rheostat 分支的 addR 顺序），
  //     所以直接把 i 交给 electronShift，不用再换算方向。
  //   · 【电子逆着电流走】：由 electronShift 内部的负号保证，和主回路导线上
  //     那些小球是同一套规矩（金属里自由电子带负电，定向移动方向与规定的
  //     电流方向相反）。
  //
  // ⚠️ 画在绕线【表面】（cylMid 这条轴线上）而不是瓷管里：绕线才是导体，
  //    电子跑在导体里 —— 画到瓷管上等于把「绝缘的瓷」和「导电的丝」搞反了。
  // ⚠️ opts.phase 为 null（粒子开关关着）时【一个粒子都不画】：绕线上的粒子和
  //    导线上的粒子是同一个开关管的，关掉一个却让另一个继续跑，自相矛盾。
  //
  // 返回值 = 【这一帧真的画出去的那几个数】（左右两半各几粒、触臂几粒）。
  // 断言读它，不读 rec.segments —— 读 rec 等于量「算的那一步」，把 runSeg 的
  // 调用条件改坏（比如两半都画）照样全绿。返回它等于把「画了什么」钉死。
  // ============================================================
  function drawRheostatFlow(ctx, comp, rec, opts) {
    // 这一帧真的画出去的记号数（按段统计）。断言读它，不读 rec.segments ——
    // 读 rec 等于量「算的那一步」，「只画通电的那半根」改成「两半都画」照样全绿。
    var stats = { left: 0, right: 0, arm: 0, rod: 0, iL: 0, iR: 0, iArm: 0,
                  phase: null, style: null,
                  // 左 / 右半根绕线的【螺旋路径长度】和这一帧用的位移（px）。
                  // 位移必须等于 CircuitDraw.currentShift(那一段的真实电流, phase)
                  // —— 自检拿它钉「绕线里的记号和导线同源」。
                  pathL: 0, pathR: 0, shiftL: 0, shiftR: 0,
                  shiftArm: 0, shiftRod: 0,
                  // 整条内部通路的总长 / 记号间距 / 记号总数。密度那条判据
                  // （gap 必须等于导线上的 42 / 64）就靠这三个数。
                  total: 0, gap: 0, count: 0 };
    var phase = opts && opts.phase;
    if (phase == null) return stats;                   // 开关关着 → 一个记号都不画
    stats.phase = phase;
    if (!rec || !rec.segments || rec.segments.length < 2) return stats;
    var iL = rec.segments[0].i, iR = rec.segments[1].i;
    stats.iL = iL; stats.iR = iR;

    // 画成什么样式，由【导线上那两个开关】决定 —— 绕线不再自己画一种「只此一处」
    // 的橙色小球。导线上开「➡ 电流方向」就是红色箭头、开「⚡ 电子流动」就是琥珀
    // 小球，两个都开就两个都画；语义与 drawWire 的 opts.electrons / opts.current
    // 完全一致。两个都关着 → 整层不画。
    var wantCur = !!(opts && opts.current);
    var wantEle = !!(opts && opts.electrons !== false);
    if (!wantCur && !wantEle) return stats;
    stats.style = wantCur ? 'current' : 'electrons';

    var cylX = RHEO.cylX, cylW = RHEO.cylW, cylY = RHEO.cylY, cylH = RHEO.cylH;
    var sxNow = sliderLocalX(slideOf(comp, rec));
    var tipY = cylY + cylH * 0.62;                     // 触臂端头（和 drawRheostat 同一处）
    // 绕线的上下沿：和 drawRheostat 调 coil() 时喂的是【同一组数】。
    var yTop = cylY + 0.6, yBot = cylY + cylH - 0.6;
    var sc = ctxScale(ctx);
    var rBall = 2.6 * Math.min(1, Math.max(0.62, sc));
    var HELIX_A = (yBot - yTop) / 2, HELIX_MID = (yTop + yBot) / 2;
    var BACK_ALPHA = 0.5;

    // 触臂上的电流 = 【净流入滑片节点的量】= iL − iR。两个 segment 的方向约定
    // 不同（seg0 是 A→S，seg1 是 S→B），所以是相减而不是相加：
    //   A-C：iL = I、iR = 0  → I（电流从绕线进滑片，再经金属杆流向 C/D）
    //   B-C：iL = 0、iR = −I → I（同一个 I，只是从右半段进来）
    //   A-B：iL = I、iR = I  → 0（电流在滑片处从左边转到右边，不进出外部）
    //   C-D：iL = iR = 0     → 0（电流只走金属杆，压根不碰绕线和触臂）
    // 正值 = 从绕线流向滑片 ⇒ 画面上是【往上走】。
    var iArm = iL - iR;
    stats.iArm = iArm;
    var rodEnd = opts && opts.rodEnd;
    var rodT = (rodEnd === 'C') ? TERMINALS.rheostat[2]
             : (rodEnd === 'D') ? TERMINALS.rheostat[3] : null;

    // 四段的电流位移（px）。全部走 electronShift / currentShift —— 和导线
    // 是同一个函数、同一个 phase，所以「每秒多少像素」天生一样。
    stats.shiftL = currentShift(iL, phase);
    stats.shiftR = currentShift(iR, phase);
    stats.shiftArm = currentShift(iArm, phase);
    stats.shiftRod = currentShift(iArm, phase);

    // ============================================================
    // 把「绕线左半 / 右半 / 触臂 / 金属杆」拼成【一条通路】
    // ------------------------------------------------------------
    // 🔴🔴 以前四段各画各的、各用 `Math.max(1, …)` 凑一个记号，于是：
    //   ① 触臂只有 32px，那颗记号按 320px/s 在 32px 里来回跑 ⇒ 10 Hz 频闪；
    //   ② 绕线里的记号按【水平跨度】折算个数（每 18px 一个），投影到螺旋上
    //      只有 20px 的横向间隔，而导线上的箭头是 64px 一个 ⇒ 绕线里看着
    //      密三倍。两条加起来，学生看到的正是「变阻器里的电流明显更快」。
    // 拼成一条通路之后：记号沿【整条通路】按导线的间距均匀铺、按同一个位移
    // 走 —— 进去几个出来几个，任何一段都不会自己加速，也不会自己变密。
    // ============================================================
    var P = [], total = 0, marks = [], coilDraw = [];
    function push(x, y, d) {
      var last = P[P.length - 1];
      if (last) {
        var dl = Math.hypot(x - last.x, y - last.y);
        if (dl < 1e-9) { if (d != null) last.d = d; return; }
        total += dl;
      }
      P.push({ x: x, y: y, s: total, d: (d == null ? 1 : d) });
    }
    function piece(name, pts) {
      if (!pts || pts.length < 2) return 0;
      var s0 = total;
      for (var i = 0; i < pts.length; i++) push(pts[i].x, pts[i].y, pts[i].d);
      var len = total - s0;
      marks.push({ name: name, s0: s0, s1: total });
      return len;
    }
    // 绕线：从 xa 到 xb 绕 n 圈，按弧长采样成一串折线点。
    // d > 0 = 前半圈（朝向观察者），< 0 = 绕到背面（压淡一档画）。
    function coilPts(xa, xb) {
      var span = xb - xa, ad = Math.abs(span);
      var n = Math.max(1, Math.round(ad / RHEO.flowPitch));
      var steps = n * 16, out = [];
      for (var i = 0; i <= steps; i++) {
        var u = i / steps, th = 2 * Math.PI * n * u * (span < 0 ? -1 : 1);
        out.push({ x: xa + span * u, y: HELIX_MID + HELIX_A * Math.sin(th),
                   d: Math.cos(th) });
      }
      return out;
    }
    // flow > 0 = 从 xa 流向 xb；< 0 就把整段反过来铺（电流方向就是走线方向）
    function coilPiece(name, xa, xb, flow) {
      if (Math.abs(flow) <= 1e-12) return;
      var pts = coilPts(flow >= 0 ? xa : xb, flow >= 0 ? xb : xa);
      var len = piece(name, pts);
      coilDraw.push({ pts: pts, len: len });
      if (name === 'left') stats.pathL = len; else stats.pathR = len;
    }
    // 触臂：从绕线表面到金属杆（穿过滑片）。up = 电流从绕线流向滑片。
    function armPts(up) {
      var y0 = tipY, y1 = TERMINALS.rheostat[2].y;     // −26 = 金属杆的高度
      var a = [], N = 8;
      for (var i = 0; i <= N; i++) {
        var u = i / N;
        a.push({ x: sxNow, y: up ? (y0 + (y1 - y0) * u) : (y1 + (y0 - y1) * u), d: 1 });
      }
      return a;
    }
    function rodPts(fromX, toX) {
      var a = [], N = 8;
      for (var i = 0; i <= N; i++) a.push({ x: fromX + (toX - fromX) * i / N,
                                            y: rodT.y, d: 1 });
      return a;
    }

    var hasL = Math.abs(iL) > 1e-12, hasR = Math.abs(iR) > 1e-12;
    var armActive = rodT && Math.abs(iArm) > 1e-12;
    if (armActive) {
      // 电流：绕线 → 触臂 → 金属杆 → 接线柱（iArm > 0），或者反过来。
      var coilName = hasL ? 'left' : (hasR ? 'right' : null);
      var up = iArm > 0;
      var coilFor = function (name) {
        if (name === 'left') coilPiece('left', cylX, sxNow, iL);
        else if (name === 'right') coilPiece('right', sxNow, cylX + cylW, iR);
      };
      if (up) {
        if (coilName) coilFor(coilName);
        piece('arm', armPts(true));
        piece('rod', rodPts(sxNow, rodT.x));
      } else {
        piece('rod', rodPts(rodT.x, sxNow));
        piece('arm', armPts(false));
        if (coilName) coilFor(coilName);
      }
    } else if (hasL && hasR) {
      // A-B：整根绕线都接入，电流在滑片处从左半根穿到右半根（触臂不参与）。
      if (iL >= 0) { coilPiece('left', cylX, sxNow, iL); coilPiece('right', sxNow, cylX + cylW, iR); }
      else { coilPiece('right', sxNow, cylX + cylW, iR); coilPiece('left', cylX, sxNow, iL); }
    } else if (hasL) {
      coilPiece('left', cylX, sxNow, iL);
    } else if (hasR) {
      coilPiece('right', sxNow, cylX + cylW, iR);
    }
    if (total < 4 || !P.length) return stats;          // 一段都没通电

    // 沿通路的弧长取点（含单位切向与前后判定）
    function pointAt(s) {
      s = ((s % total) + total) % total;
      var lo = 0, hi = P.length - 1;
      while (lo < hi - 1) { var m = (lo + hi) >> 1; if (P[m].s <= s) lo = m; else hi = m; }
      var a = P[lo], b = P[hi], seg = Math.max(1e-6, b.s - a.s);
      var t = Math.max(0, Math.min(1, (s - a.s) / seg));
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
               ux: (b.x - a.x) / seg, uy: (b.y - a.y) / seg,
               d: a.d + (b.d - a.d) * t };
    }

    ctx.save();
    ctx.translate(comp.x, comp.y);
    ctx.rotate((comp.rot || 0) * Math.PI / 180);

    // 两种记号各画各的：小球 = 实心圆（琥珀），箭头 = drawWire 里那支红三角
    // （同一形状、同一朝向规则）—— 学生能把绕线里的箭头和导线上的箭头对上号。
    function dot(x, y, r) {
      ctx.fillStyle = PALETTE.flow;
      ctx.shadowColor = 'rgba(245,158,11,0.85)'; ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.284); ctx.fill();
    }
    function arrow(x, y, ang) {
      ctx.fillStyle = PALETTE.current;
      ctx.shadowColor = 'rgba(220,38,38,0.7)'; ctx.shadowBlur = 6;
      ctx.save();
      ctx.translate(x, y); ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(7, 0); ctx.lineTo(-5, -4.8); ctx.lineTo(-5, 4.8);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    // 绕线那段画成【螺旋虚线】的轨道：电流走的就是这条螺旋，虚线只是轨道，
    // 不跟着电流动（跟着动就分不清哪个是轨道、哪个是车了）。
    // 🔴 线要够粗够亮才压得住底下那片金属绕线；再加一道暗描边把红线和金属分开。
    function rail(pts) {
      var per = RHEO.railOn + RHEO.railOff, acc = 0, on = true, prev = pts[0];
      ctx.save();
      ctx.strokeStyle = wantCur ? PALETTE.current : PALETTE.flow;
      ctx.lineWidth = 2.2; ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(15,23,42,0.45)'; ctx.shadowBlur = 2.5;
      for (var i = 1; i < pts.length; i++) {
        var q = pts[i], dl = Math.hypot(q.x - prev.x, q.y - prev.y);
        acc += dl;
        if (on) {
          ctx.globalAlpha = ((prev.d + q.d) / 2 >= 0 ? 0.9 : 0.9 * BACK_ALPHA);
          ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(q.x, q.y); ctx.stroke();
        }
        if (acc >= (on ? RHEO.railOn : RHEO.railOff)) { acc = 0; on = !on; }
        prev = q;
      }
      ctx.restore();
    }
    coilDraw.forEach(function (c) { rail(c.pts); });

    // 记号：间距取【导线上的那一个】（箭头 64 / 小球 42，见 drawWire），
    // 沿整条通路均匀铺，位移用同一个函数。count 回填给 stats 供断言读。
    function lay(gap, shift, draw) {
      var n = Math.max(1, Math.round(total / gap));
      var step = total / n;
      for (var i = 0; i < n; i++) {
        var s = ((i * step + shift) % total + total) % total;
        var q = pointAt(s);
        ctx.globalAlpha = q.d >= 0 ? 1 : BACK_ALPHA;
        draw(q);
        for (var k = 0; k < marks.length; k++) {
          if (s >= marks[k].s0 && s < marks[k].s1) { stats[marks[k].name]++; break; }
        }
      }
      ctx.globalAlpha = 1;
      return n;
    }
    // 通路本身就是【顺着电流方向】铺的，所以位移取正号的 |I|：
    // currentShift(+|I|) 往前、electronShift(+|I|) 往后（电子逆着电流走）。
    var Ipath = Math.abs(armActive ? iArm : (hasL ? iL : iR));
    stats.total = total;
    if (wantEle) {
      stats.gap = 42; stats.count = lay(42, electronShift(Ipath, phase),
        function (q) { dot(q.x, q.y, rBall); });
    }
    if (wantCur) {
      stats.gap = 64; stats.count = lay(64, currentShift(Ipath, phase),
        function (q) { arrow(q.x, q.y, Math.atan2(q.uy, q.ux)); });
    }
    ctx.restore();
    return stats;
  }

  function drawRheostat(ctx, comp, rec) {
    var slide = slideOf(comp, rec);
    var BW = RHEO.BW, BH = RHEO.BH;
    var sc = ctxScale(ctx);
    ctx.save();
    ctx.translate(comp.x, comp.y);
    ctx.rotate((comp.rot || 0) * Math.PI / 180);

    var cylX = RHEO.cylX, cylW = RHEO.cylW, cylY = RHEO.cylY, cylH = RHEO.cylH;
    var TUBE_HW = BW / 2 - 1;                  // 瓷管半长：正好顶到两块立板
    var cylMid = cylY + cylH / 2;              // 瓷管中心线
    // 「已接入」= 真正有电流的那一段，直接从解里读，不靠推断接法。
    // （A-C/A-D 接入左半，B-C/B-D 接入右半，A-B 整根都接入，C-D 两根都不接入
    //   ——画错会直接教错。）提前算出来是因为下面的引线也要跟着它区分明暗。
    var liveL = true, liveR = true;
    if (rec && rec.segments && rec.segments.length >= 2) {
      liveL = Math.abs(rec.segments[0].i) > 1e-12;   // seg0 = A → 滑片（左半段）
      liveR = Math.abs(rec.segments[1].i) > 1e-12;   // seg1 = 滑片 → B（右半段）
    }
    var BRK_TOP = -26, LEG = 37;

    // 两条腿落在台面上的接触阴影。变阻器是个「架子」，阴影要分成两团，
    // 连成一片就成了一个实心块，架子就没了。
    contactShadow(ctx, -BW / 2, LEG + 3, 24, 5, 0.26);
    contactShadow(ctx, BW / 2, LEG + 3, 24, 5, 0.26);

    // ── ① 两侧 A 形立板 ────────────────────────────────────
    // 立板是【一块薄板】不是一根柱子：图16.4-2 里这两块板上下几乎一样宽，
    // 只在底部往外撇出一小块脚。早先画成上窄下宽的三角形（顶 11 宽、脚 30 宽），
    // 配上白亮的渐变就成了两棵白色圣诞树，把中间那根瓷管压得看不见。
    // 颜色也压深一档（浅蓝灰而不是白），好和白瓷管分开——两者同为「白」的话，
    // 一眼看不出哪一截是瓷管、哪一块是板。
    [-BW / 2, BW / 2].forEach(function (cx) {
      ctx.save();
      ctx.shadowColor = 'rgba(15,23,42,0.24)'; ctx.shadowBlur = 11; ctx.shadowOffsetY = 4;
      // 宽度照实物按瓷管长折算：图16.4-2 里立板只占瓷管的 6% 宽，一窄条。
      // 早先给到 30 宽（19%），两块板把瓷管两头挡掉一大截，「管子」就不成形了。
      ctx.beginPath();
      ctx.moveTo(cx - 7.5, BRK_TOP - 4);
      ctx.quadraticCurveTo(cx, BRK_TOP - 12, cx + 7.5, BRK_TOP - 4);   // 圆顶
      ctx.lineTo(cx + 10, LEG);
      ctx.lineTo(cx - 10, LEG);
      ctx.closePath();
      ctx.fillStyle = linGrad(ctx, cx - 10, 0, cx + 10, 0, MAT.steel);
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(70,84,100,0.55)'; ctx.lineWidth = 1; ctx.stroke();
      // 板面的两道竖棱：钢板冲压出来的加强筋。没有它，立板是一张纸。
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx - 7.5, BRK_TOP - 4);
      ctx.quadraticCurveTo(cx, BRK_TOP - 12, cx + 7.5, BRK_TOP - 4);
      ctx.lineTo(cx + 10, LEG); ctx.lineTo(cx - 10, LEG);
      ctx.closePath(); ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,0.34)';
      ctx.fillRect(cx - 5.6, BRK_TOP - 6, 2.1, LEG - BRK_TOP + 6);
      ctx.fillStyle = 'rgba(40,52,68,0.20)';
      ctx.fillRect(cx + 4.4, BRK_TOP - 6, 2.4, LEG - BRK_TOP + 6);
      ctx.restore();
      // 腿脚：落地的那一小块。没有它，立板看着是插在空气里的
      ctx.save();
      ctx.shadowColor = 'rgba(15,23,42,0.20)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
      ctx.fillStyle = linGrad(ctx, cx - 14, 0, cx + 14, 0,
        [[0, '#78879a'], [0.24, '#c2cfe0'], [0.46, '#e9eff7'],
         [0.72, '#a9b8ca'], [1, '#78879a']]);
      roundRect(ctx, cx - 14, LEG, 28, 7, 3); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(70,84,100,0.5)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      roundRect(ctx, cx - 12, LEG + 1.2, 24, 1.4, 0.7); ctx.fill();
      // 腿上的一字螺钉：把立板拧在底脚上
      if (sc >= 1) screwHead(ctx, cx, LEG + 3.6, 2.6, 'slot', sc);
      // 顶部夹口：金属杆就卡在这个小槽里
      ctx.fillStyle = 'rgba(40,52,68,0.55)';
      roundRect(ctx, cx - 5, BRK_TOP - 2, 10, 4.5, 2.2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      roundRect(ctx, cx - 4.4, BRK_TOP - 1.6, 8.8, 1.2, 0.6); ctx.fill();
    });

    // ── ② 金属杆：细长的一根，横跨两块立板的夹口。高度取 −26 是为了和
    //    C/D 两个柱子（锚在 ±78/−26）对齐——「上面两个柱接的是金属杆」这句话
    //    在图上是靠这条线看出来的。滑片骑在它上面，中间被滑片挡住，两头露出来。
    //    镀铬杆：中间一道窄而亮的高光 + 下沿的暗边，才有「圆杆」的形。
    fillMat(ctx, -BW / 2 + 4, -29, BW - 8, 6, 3, MAT.chrome, 'v');
    ctx.strokeStyle = 'rgba(70,84,100,0.45)'; ctx.lineWidth = 0.9; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    roundRect(ctx, -BW / 2 + 8, -27.9, BW - 16, 1.2, 0.6); ctx.fill();
    // 杆两端的圆头 + 两个挡圈（滑片就是在这两个挡圈之间走）
    [-BW / 2 + 4, BW / 2 - 4].forEach(function (ex) {
      ctx.fillStyle = linGrad(ctx, ex - 2, -29, ex + 2, -23,
        [[0, '#63748a'], [0.4, '#eef3f8'], [1, '#63748a']]);
      ctx.beginPath(); ctx.ellipse(ex, -26, 1.8, 3, 0, 0, 6.284); ctx.fill();
    });

    // ── ③ 白瓷管：整根画满两板之间，两头留白 ────────────────
    // 釉瓷的明暗：宽而软的釉面高光（陶瓷是漫反射，绝不用金属那种窄反光），
    // 加上两端收口的椭圆 —— 少了两端的椭圆，管子是一根平贴的白条。
    ctx.save();
    ctx.shadowColor = 'rgba(15,23,42,0.20)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
    ctx.fillStyle = linGrad(ctx, 0, cylY, 0, cylY + cylH, MAT.porcelain);
    roundRect(ctx, -TUBE_HW, cylY, TUBE_HW * 2, cylH, cylH / 2); ctx.fill();
    ctx.restore();
    // 管端：两个竖椭圆，把圆柱的收口交代出来
    [-TUBE_HW + cylH * 0.30, TUBE_HW - cylH * 0.30].forEach(function (ex, k) {
      ctx.fillStyle = k === 0
        ? linGrad(ctx, ex - 4, 0, ex + 4, 0, [[0, '#b9b6ab'], [0.4, '#e8e5da'], [1, '#f6f4ec']])
        : linGrad(ctx, ex - 4, 0, ex + 4, 0, [[0, '#f6f4ec'], [0.6, '#dcd9ce'], [1, '#aeaba0']]);
      ctx.beginPath(); ctx.ellipse(ex, cylMid, 4.2, cylH / 2 - 0.4, 0, 0, 6.284); ctx.fill();
      ctx.strokeStyle = 'rgba(140,136,124,0.45)'; ctx.lineWidth = 0.9; ctx.stroke();
    });
    ctx.fillStyle = 'rgba(255,255,255,0.72)';          // 白瓷上的那一道高光
    roundRect(ctx, -TUBE_HW + 3, cylY + 2.2, TUBE_HW * 2 - 6, 4.2, 2.1); ctx.fill();
    ctx.strokeStyle = 'rgba(120,134,150,0.45)'; ctx.lineWidth = 1;
    roundRect(ctx, -TUBE_HW, cylY, TUBE_HW * 2, cylH, cylH / 2); ctx.stroke();

    // ── ④ 电阻丝：密绕在中间那一段上，两端各留一截白瓷 ──────
    // 一圈一圈地绕（coil()），不是 60 根等宽竖条 —— 竖条读出来是「栅栏」。
    // 有电流的那半根是亮的铜色，没电流的压成灰：「滑片把电阻丝分成两段，
    // 只有接进回路的那一段起作用」这句话就是靠这一明一暗讲清楚的。
    var sxNow = sliderLocalX(slide);
    // 丝的底色（竖向渐变）：上暗-高光-下暗，就是绕线堆成的那根圆柱的光照。
    // 有电流的那半根用铜色，没电流的压成灰 —— 「滑片把电阻丝分成两段，
    // 只有接进回路的那一段起作用」这句话，就是靠这一明一暗讲清楚的。
    var CU_LIVE = [[0, '#4a2f0d'], [0.14, '#7d4f1c'], [0.30, '#c0813a'],
                   [0.44, '#e8b273'], [0.62, '#b8772f'], [0.84, '#7a4d18'], [1, '#3d260a']];
    var CU_DEAD = [[0, '#57534a'], [0.14, '#7c776c'], [0.30, '#a8a294'],
                   [0.44, '#c2bcae'], [0.62, '#9c968a'], [0.84, '#736e64'], [1, '#4a463f']];
    var PITCH = RHEO.pitch;             // 圈距（局部单位）。真变阻器的绕线就密到这个程度：
                                        // 缩到 1 倍时圈缝糊成一片金属，放大才数得出圈数。
    ctx.save();
    roundRect(ctx, -TUBE_HW, cylY, TUBE_HW * 2, cylH, cylH / 2); ctx.clip();
    coil(ctx, cylX, sxNow, cylY + 0.6, cylY + cylH - 0.6, (sxNow - cylX) / PITCH,
      liveL ? CU_LIVE : CU_DEAD, sc);
    coil(ctx, sxNow, cylX + cylW, cylY + 0.6, cylY + cylH - 0.6,
      (cylX + cylW - sxNow) / PITCH, liveR ? CU_LIVE : CU_DEAD, sc);
    // 绕线整体的一道高光（贴着渐变的高光停点，只补一点点「金属反光」的锐利感）
    ctx.fillStyle = 'rgba(255,242,214,0.20)';
    ctx.fillRect(cylX, cylY + 3.4, cylW, 3.4);
    ctx.restore();
    // 绕线两端的收口：一圈金属卡箍 + 一颗压接螺钉。电阻丝的端头就是压在这
    // 上面的，A/B 两个柱子也拧在这儿 —— 少了这个箍，铜丝是「自己断掉的」。
    [cylX, cylX + cylW].forEach(function (x2) {
      ctx.save();
      ctx.fillStyle = linGrad(ctx, 0, cylY - 1, 0, cylY + cylH + 1,
        [[0, '#63748a'], [0.24, '#c6d2df'], [0.44, '#ffffff'],
         [0.72, '#a7b4c3'], [1, '#63748a']]);
      roundRect(ctx, x2 - 3.4, cylY - 1, 6.8, cylH + 2, 3); ctx.fill();
      ctx.strokeStyle = 'rgba(40,52,68,0.5)'; ctx.lineWidth = 0.9; ctx.stroke();
      ctx.fillStyle = 'rgba(40,52,68,0.30)';
      roundRect(ctx, x2 - 3.4, cylY + cylH - 2.6, 6.8, 2.4, 1.2); ctx.fill();
      ctx.restore();
    });

    // ── ⑤ 滑片：鞍形金属块骑在金属杆上，触臂下探到绕线上 ────
    var sx = sxNow;
    var slidTop = RHEO.knobTop, slidH = RHEO.knobBottom - RHEO.knobTop;
    var tipY = cylY + cylH * 0.62;             // 触臂端头落在绕线中间偏上
    var KH = RHEO.knobHalf;
    // 触臂：上宽下窄的一片，先画（被滑片本体压住上缘）
    ctx.save();
    ctx.shadowColor = 'rgba(15,23,42,0.28)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
    ctx.beginPath();
    ctx.moveTo(sx - KH * 0.62, RHEO.knobBottom - 4);
    ctx.lineTo(sx + KH * 0.62, RHEO.knobBottom - 4);
    ctx.lineTo(sx + 5.5, tipY);
    ctx.lineTo(sx - 5.5, tipY);
    ctx.closePath();
    ctx.fillStyle = linGrad(ctx, sx - 9, 0, sx + 9, 0,
      [[0, '#7d8b99'], [0.28, '#dbe3eb'], [0.48, '#ffffff'],
       [0.74, '#a3b0be'], [1, '#7d8b99']]);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(100,116,139,0.5)'; ctx.lineWidth = 0.9; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    roundRect(ctx, sx - 4.4, RHEO.knobBottom - 3, 1.6, tipY - RHEO.knobBottom + 1, 0.8); ctx.fill();
    ctx.fillStyle = '#6b7c90';                 // 压在绕线上的那一小块端头
    roundRect(ctx, sx - 6, tipY - 3, 12, 5.5, 2.5); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.42)';  // 端头压出来的亮边（接触面）
    roundRect(ctx, sx - 5.2, tipY - 2.4, 10.4, 1.3, 0.65); ctx.fill();

    // 滑片本体：鞍形（顶面微凹）+ 两侧竖槽，照图16.4-2 的 P 字块
    ctx.save();
    ctx.shadowColor = 'rgba(15,23,42,0.30)'; ctx.shadowBlur = 9; ctx.shadowOffsetY = 3;
    ctx.beginPath();
    ctx.moveTo(sx - KH, slidTop + 8);
    ctx.quadraticCurveTo(sx, slidTop + 1, sx + KH, slidTop + 8);
    ctx.lineTo(sx + KH, slidTop + slidH - 6);
    ctx.quadraticCurveTo(sx + KH, slidTop + slidH, sx + KH - 6, slidTop + slidH);
    ctx.lineTo(sx - KH + 6, slidTop + slidH);
    ctx.quadraticCurveTo(sx - KH, slidTop + slidH, sx - KH, slidTop + slidH - 6);
    ctx.closePath();
    ctx.fillStyle = linGrad(ctx, sx - KH, 0, sx + KH, 0,
      [[0, '#7f8d9c'], [0.20, '#c3cedb'], [0.42, '#f6f9fc'],
       [0.68, '#c0cbd8'], [0.86, '#98a6b5'], [1, '#7f8d9c']]);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(70,84,100,0.5)'; ctx.lineWidth = 1; ctx.stroke();
    // 两道竖槽（压铸出来的凹槽，不是划痕：一暗一亮成对出现）
    [-6.5, 6.5].forEach(function (dx) {
      ctx.strokeStyle = 'rgba(40,52,68,0.34)'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(sx + dx, slidTop + 12); ctx.lineTo(sx + dx, slidTop + slidH - 7); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.42)'; ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(sx + dx + 1.3, slidTop + 12); ctx.lineTo(sx + dx + 1.3, slidTop + slidH - 7); ctx.stroke();
    });
    // 顶面的受光棱：鞍形的顶是一条窄亮带
    ctx.strokeStyle = 'rgba(255,255,255,0.72)'; ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(sx - KH + 2.6, slidTop + 6.2);
    ctx.quadraticCurveTo(sx, slidTop + 2.4, sx + KH - 2.6, slidTop + 6.2);
    ctx.stroke();

    // ── 铭牌 ────────────────────────────────────────────────
    // 实物（人教版图16.4-2、各厂 20Ω 2A 的学生变阻器）在滑片顶上铆着一块
    // 小铭牌，印的就是规格参数。这块牌子是整个器材上【唯一】写着数字的地方，
    // 缺了它，学生只能从老师的板书知道这是 20Ω 2A。
    // 字太小的时候（图例那种 0.6 倍）只画牌子不画字：5px 的字在缩略图上
    // 就是一道脏线，比空白更糟。放大镜里（≥1.05 倍）才把字抖出来。
    (function () {
      var Rmax = (rec && rec.Rmax != null) ? +rec.Rmax
               : (comp.params && comp.params.Rmax != null ? +comp.params.Rmax : 20);
      var label = (Rmax % 1 === 0 ? Rmax : Rmax.toFixed(1)) + 'Ω 2A';
      var pw = 25, ph = 9.5, px0 = sx - pw / 2, py0 = slidTop + 10.5;
      ctx.save();
      ctx.fillStyle = 'rgba(15,23,42,0.22)';        // 牌子铆在弧顶上的投影
      roundRect(ctx, px0, py0 + 1.2, pw, ph, 2); ctx.fill();
      ctx.fillStyle = linGrad(ctx, 0, py0, 0, py0 + ph,
        [[0, '#ffffff'], [0.6, '#f2f5f9'], [1, '#dbe3ec']]);
      roundRect(ctx, px0, py0, pw, ph, 2); ctx.fill();
      ctx.strokeStyle = 'rgba(51,65,85,0.55)'; ctx.lineWidth = 0.8; ctx.stroke();
      if (sc >= 1.05) {
        ctx.fillStyle = '#1f2937';
        ctx.font = 'bold ' + Math.min(6.6, 5.6 + (sc - 1.05) * 1.6).toFixed(1) +
          'px -apple-system,"PingFang SC",sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(label, sx, py0 + ph / 2 + 0.4);
      }
      ctx.restore();
    })();
    ctx.restore();

    // 端子字母：滑动变阻器没有极性，只标 A/B/C/D 四位接线柱
    // 🔴 字号与白描边是【按教室大屏投影】定的：这四个字母是学生数接线柱的
    //    唯一参照系（「接到 D 和 B」这句话全靠它落地），投影后认不出来，
    //    整节课的接线指令就没法执行。15px 在 1:1 桌面上够，投影不够。
    //    规格住在 RHEO_LABEL 里，自检读的是同一份 —— 别把数写回这里。
    ctx.save();
    ctx.font = 'bold ' + RHEO_LABEL.font + 'px -apple-system,"PingFang SC",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = RHEO_LABEL.halo; ctx.strokeStyle = RHEO_LABEL.haloColor;
    ctx.lineJoin = 'round';
    // 字母落在接线柱斜外侧（接线柱在 ±78/±26，柱体半径约 17）。
    // 上下不能画反：A/B 是【下面】两个柱（电阻丝两端）、C/D 是【上面】两个柱
    // （金属杆两端）——这是人教版图16.4-2 的编号，也是学生数接线柱的参照系。
    // 记下这一帧【真的画出去】的字号（从 ctx 读回来，不是抄常量）与每个字母的
    // 世界坐标 —— 见 rheoLabelDrawn 的注释。
    var LG = { font: ctx.font, px: null, w: 0, pts: [] };
    var pm = /([\d.]+)px/.exec(ctx.font);
    LG.px = pm ? +pm[1] : null;
    ['A', 'B', 'C', 'D'].forEach(function(ch){
      var L = RHEO_LABEL.at[ch];
      var p = toWorld(comp, L[0], L[1]);
      ctx.strokeText(ch, p.x, p.y);
      ctx.fillStyle = RHEO_LABEL.color;
      ctx.fillText(ch, p.x, p.y);
      LG.w = Math.max(LG.w, ctx.measureText(ch).width);
      LG.pts.push({ ch: ch, x: p.x, y: p.y });
    });
    ctx.restore();
    rheoLabelDrawn[comp.id] = LG;

    // 柱色按图16.4-2：下面两个（A/B，电阻丝两端）是红的，上面两个（C/D，金属杆）
    // 是银的。变阻器本身没有极性，红在这里只表示「出厂就接在电阻丝上」，
    // 真正的语义靠 A/B/C/D 四个字母，不要把红当成正极。
    // C/D 只有这两个，所以单独画，不走 posts()——原因见下面那段。
    // A/B 给 1.4 倍、8 高的螺纹杆（和开关、灯泡同一档）：图16.4-2 里这两个柱子
    // 是【立在白瓷端头上】的，柱顶要高过瓷管，一眼能看见；按默认的矮柱子画，
    // 它整根都埋在那条红铜引线的粗细里，看着只剩一根横着的铜片。
    //
    // ⚠️ C/D 现在【也是红的】（2026-10-09 用户要求「和其他接线柱保持一致」）。
    //    原来它们是银的、A/B 是红的，同一台器材上两种柱色，学生数接线柱时
    //    得先分辨「哪个是红的」才敢认 A/B —— 而红在全站其它元件上一直是
    //    「接线柱」这个身份本身的标记（开关、灯泡、电池盒的柱子全是红的）。
    //    红仍然【不代表正极】：变阻器无极性，A/B/C/D 四个字母才是语义。
    posts(ctx, comp, ['pos', 'pos'], 1.4, 8);

    // C / D：金属杆两端的柱子是【横着朝外伸】的圆柱头（图16.4-2 里就是两个
    // 从立板上探出来的圆柱）。立着画有两个毛病：一是柱子顶在立板上沿，
    // 看着像板子上又长了一颗蘑菇；二是「它接的是那根细杆」这句话在图上没了着落
    // ——横着从杆的端头伸出去，才一眼看出它和杆是一条线。
    // 顺带一个好处：导线本来就是水平走过来的，横柱让线接头看着更顺。
    // 柱色用 POST_GRAD.pos 那一套红（和 A/B 及全站接线柱同一组色标）。
    [2, 3].forEach(function (ti) {
      var p = terminalWorld(comp, ti);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(ti === 2 ? -1 : 1, 1);        // 镜像成「朝外」，左右各一份
      ctx.fillStyle = 'rgba(15,23,42,0.22)';
      ctx.beginPath(); ctx.ellipse(1, 4, 9, 3, 0, 0, 6.284); ctx.fill();
      // 柱身走【竖向】渐变（上亮下暗）才是根圆管，横向渐变会画成一根扁铁片
      ctx.fillStyle = linGrad(ctx, 0, -6, 0, 6,
        [[0, '#6f1a1a'], [0.26, '#b91c1c'], [0.48, '#f3a8a8'],
         [0.72, '#dc2626'], [1, '#6f1a1a']]);
      roundRect(ctx, -9, -6, 18, 12, 3); ctx.fill();
      ctx.strokeStyle = 'rgba(110,20,20,0.55)'; ctx.lineWidth = 0.9; ctx.stroke();
      ctx.fillStyle = 'rgba(255,228,228,0.62)';   // 管身上的一道细高光
      roundRect(ctx, -8, -4.6, 15, 1.4, 0.7); ctx.fill();
      // 外端那圈滚花螺母（比柱身粗一圈，和别的元件的柱帽是同一套长相）
      // 尺寸/圆角都收着来：15 高 + 2.5 圆角配 8 宽，放大镜里是一个方疙瘩；
      // 改成 14 高、2.9 圆角，再补一条内肩线和外端倒角，才是一颗拧在杆上的螺母。
      ctx.fillStyle = linGrad(ctx, 0, -7, 0, 7,
        [[0, '#6f1a1a'], [0.30, '#b91c1c'], [0.52, '#f3a8a8'], [1, '#6f1a1a']]);
      roundRect(ctx, 7, -7, 8, 14, 2.9); ctx.fill();
      ctx.save();
      roundRect(ctx, 7, -7, 8, 14, 2.9); ctx.clip();
      knurl(ctx, 7, -7, 8, 14, sc * 1.2, 'rgba(90,10,10,0.32)');
      // 外端倒角：螺母的端面是倒过角的，一道竖直的亮棱比整块平头有体积
      ctx.fillStyle = 'rgba(255,228,228,0.5)';
      ctx.fillRect(14.2, -5.6, 1.1, 11.2);
      ctx.fillStyle = 'rgba(120,20,20,0.28)';
      ctx.fillRect(13.0, -5.6, 1.1, 11.2);
      ctx.restore();
      ctx.strokeStyle = 'rgba(110,20,20,0.6)'; ctx.lineWidth = 0.9;
      roundRect(ctx, 7, -7, 8, 14, 2.9); ctx.stroke();
      // 内肩：螺母压在柱身端头的那一圈，有它才看得出是「拧上去的」
      ctx.strokeStyle = 'rgba(110,20,20,0.5)'; ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.moveTo(7.6, -5.4); ctx.lineTo(7.6, 5.4); ctx.stroke();
      ctx.restore();
    });

    // 电阻丝两端引线：左端接 A（端子 0），右端接 B（端子 1）——就是下面那两个柱。
    // 这两根铜片不能省——「下面两个柱出厂就接在电阻丝两头，上面两个柱才是滑片线」
    // 正是学生最容易搞混的地方，不画出来等于让他自己猜哪根是滑片线。
    //
    // 画在接线柱【之后】：铜片压在柱面上，读起来就是「铜片用螺钉拧在柱子上」。
    // 早先画在柱体之前，18px 的横段被柱子盖掉只剩 12px，加上和背后瓷柱同为银色，
    // 整根引线基本看不见。所以这里三件事一起做：铜色、加暗色描边、盖在柱子上。
    (function () {
      var my = cylY + cylH / 2, py = RHEO.postY, px = RHEO.postX;
      var capMid = (RHEO.track + 1) / 2;
      // 起点写成绝对局部坐标，不要用 sgn 去乘 cylX 那一项：
      // cylX 是 -60，sgn*(-60+5) 会得到 +55，左引线就从右端环出发了——
      // 两根铜片于是连成一根横贯整机的铜条，正好压在电阻丝上。
      var ENDS = [
        { x0: cylX + capMid,          x1: -px, live: liveL },   // 左端环 → A
        { x0: cylX + cylW - capMid,   x1:  px, live: liveR },   // 右端环 → B
      ];
      // 上面那一大段 save/restore 已经结束了，这里回到了画布坐标系，
      // 而下面的坐标全是元件局部坐标——必须自己把变换重新架上，
      // 否则引线会画到画布左上角去（接线柱走的是 terminalWorld，不受影响）。
      ctx.save();
      ctx.translate(comp.x, comp.y);
      ctx.rotate((comp.rot || 0) * Math.PI / 180);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ENDS.forEach(function (e) {
        ctx.globalAlpha = e.live ? 1 : 0.5;   // 没电流的那半根压暗，和电阻丝上的灰段呼应
        var path = function () {
          ctx.beginPath();
          ctx.moveTo(e.x0, my);              // 从端环螺钉出发
          ctx.lineTo(e.x1, my);
          ctx.lineTo(e.x1, py);              // 落到接线柱中心
        };
        // 先描一圈暗铜色当轮廓。没有它的话，铜片压在柱面上会糊成一片高光。
        ctx.strokeStyle = 'rgba(74,44,14,0.85)'; ctx.lineWidth = 7.6;
        path(); ctx.stroke();
        ctx.strokeStyle = linGrad(ctx, 0, my - 6, 0, py + 6,
          [[0, PALETTE.copperHi], [0.5, PALETTE.copper], [1, PALETTE.copperLo]]);
        ctx.lineWidth = 4.6;
        path(); ctx.stroke();
        // 铜片上的一道高光：压在正中间，宽 1.2 —— 铜条才有「圆边」
        ctx.strokeStyle = 'rgba(255,236,200,0.55)'; ctx.lineWidth = 1.2;
        path(); ctx.stroke();
        // 末端的压接螺钉：拧在接线柱上的那一下
        ctx.fillStyle = PALETTE.copperLo;
        ctx.beginPath(); ctx.arc(e.x1, py, 2.6, 0, 6.284); ctx.fill();
        ctx.fillStyle = 'rgba(255,235,205,0.75)';
        ctx.beginPath(); ctx.arc(e.x1 - 0.7, py - 0.7, 1.1, 0, 6.284); ctx.fill();
      });
      ctx.globalAlpha = 1;
      ctx.restore();
    })();
  }

  // ============================================================
  // 示教底板上的丝印（二极管 / 电动机 / 电铃共用）
  // ------------------------------------------------------------
  // 真实的教学仪器，底座正面一定印着两样东西：极性（或「无极性」）标记，
  // 和这台仪器在电路图上的那个【符号】。学生把实物翻过来看板子，就能对上
  // 电路图里那一笔 —— 「实物 ↔ 符号」这件事必须在同一个画面里看得见。
  // 所以三个新元件都在底板正面印自己的符号，不往机身上贴大字
  //（上一版电动机把「M 直流电动机」印在金属筒上，读出来是一张贴纸）。
  // ============================================================
  var SILK_INK = '#475569';
  // 元件自己的【引脚】：从本体伸出来、折下、沿板面走到接线柱底下。
  // 它是裸金属（镀锡铜），不是带皮的导线 —— 所以不能用导线的粗灰色，
  // 得用细一号的金属色 + 一道高光，否则接线柱附近会糊成一条灰带。
  // ⚠️ pts 是 [x, y] 的数组，不是 {x, y} 的对象 —— 所以这里自己起路径，
  // 不能借 strokePath()（它读 pts[i].x，喂数组进去会拿到 undefined，
  // moveTo(undefined) 是静默 no-op：引脚一根都画不出来，页面上毫无报错）。
  function plateLead(ctx, pts, w) {
    function path() {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();
    }
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(56,68,84,0.6)'; ctx.lineWidth = w + 1.8; path();
    ctx.strokeStyle = '#93a2b3'; ctx.lineWidth = w; path();
    ctx.strokeStyle = 'rgba(246,250,253,0.9)'; ctx.lineWidth = w * 0.30; path();
    ctx.restore();
  }
  // 二极管的小符号：实心三角（尖端指向横线）+ 阴极横线 + 两个发光箭头。
  function plateSymLed(ctx, cx, cy, k) {
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(k, k);
    ctx.fillStyle = SILK_INK; ctx.strokeStyle = SILK_INK;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-8, -6); ctx.lineTo(-8, 6); ctx.lineTo(7, 0);
    ctx.closePath(); ctx.fill();
    ctx.lineWidth = 1.7;
    ctx.beginPath(); ctx.moveTo(7, -7); ctx.lineTo(7, 7); ctx.stroke();
    ctx.lineWidth = 1.2;
    [[-3, -8.5], [4.5, -8.5]].forEach(function (a) {
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]); ctx.lineTo(a[0] + 5.5, a[1] - 5.5); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(a[0] + 5.5, a[1] - 5.5); ctx.lineTo(a[0] + 5.5, a[1] - 1.8);
      ctx.lineTo(a[0] + 1.8, a[1] - 5.5);
      ctx.closePath(); ctx.fill();
    });
    ctx.restore();
  }
  // 电动机的小符号：一个圆里写 M。
  function plateSymMotor(ctx, cx, cy, k) {
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(k, k);
    ctx.strokeStyle = SILK_INK; ctx.lineWidth = 1.7;
    ctx.beginPath(); ctx.arc(0, 0, 9, 0, 6.284); ctx.stroke();
    ctx.fillStyle = SILK_INK;
    unmirrorText(ctx, 0);                 // 对调极性时圆跟着镜像，字母 M 不能反着写
    ctx.font = 'bold 12px Georgia,"Times New Roman",serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('M', 0, 0.5);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }
  // 电铃的小符号：半圆拱（开口向下）+ 底边 + 中央铃舌。
  function plateSymBell(ctx, cx, cy, k) {
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(k, k);
    ctx.strokeStyle = SILK_INK; ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.arc(0, -2, 8, Math.PI, 0);
    ctx.closePath(); ctx.stroke();
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(0, -2); ctx.lineTo(0, 5.5); ctx.stroke();
    ctx.restore();
  }
  // 底板正面的丝印排版：左「＋」、中间一枚符号、右「－」。
  // 极性文字用红/黑（和接线柱同色），符号用深灰 —— 真实板子就是这么印的。
  function plateFace(ctx, sym, posText, negText) {
    var halo = 'rgba(255,255,255,0.72)';
    silk(ctx, posText, -46, 16.5, 13, '#b91c1c', halo);
    silk(ctx, negText, 46, 16.5, 13, '#0f172a', halo);
    sym(ctx, 0, 16, 1);
  }

  // ============================================================
  // 发光二极管（示教板：底座 + 标准红黑接线柱 + 抬起的管身）
  // ------------------------------------------------------------
  // 实物上认正负靠三处，少一处它就只是一颗彩色珠子：
  //   ① 一端是【半球透镜】、另一端是【法兰盘】—— 第一眼特征；
  //   ② 法兰上有一道【平边】（cathode flat），实物上就是拿它认阴极的；
  //   ③ 管子里有一只【小杯 + 芯片 + 一根金线】：芯片坐在杯里（杯连阴极），
  //      金线把它引到阳极 —— 这正是「单向导电」在实物里的样子。
  // 发光只在 rec.on（真的正向导通）时出现。反向截止时管子是全暗的，
  // 连一点余光都不给 —— 这一点必须画对，不然单向导电性在画面上就打了对折。
  //
  // 这一版把裸管改成【示教板】：和闸刀开关 / 小灯泡共用同一块 PLATE 底板，
  // 管身抬到板面之上、由自己的两根引脚撑着，两个接线柱钉在板角（±HALF）。
  // 三个理由：
  //   ① 真实器材就是装在板子上的，裸管浮在导线中间不像实验室里的东西；
  //   ② 引脚折下来沿板面走到柱子上，柱子就【露在导线外面】——上一版端子锚点
  //      与管轴同高、柱子又矮，整根被导线盖住，学生根本点不到；
  //   ③ 底板正面印极性标记和电路图符号，实物与符号在同一个画面里对上。
  // ============================================================
  var LED_GEO = {
    domeCx: -26, r: 16,                 // 半球透镜：球心与半径（左端 = 阳极侧）
    cylX1: 34,                          // 圆柱段右端
    flangeX: 34, flangeW: 8, flangeR: 19,   // 右端法兰盘（阴极侧）
    cupX: 24, cupR: 7,                  // 芯片杯（靠阴极那一头）
    leadX0: -70, leadX1: 70,            // （旧版水平引脚的两端，留档）
    y: -26,                             // 管轴高度：管身最低点 = y+flangeR = −7（贴着板面）
    turnX: 52,                          // 引脚折下处的横坐标（在管身之外）
    leadY: -8,                          // 引脚沿板面走的高度（正好落在柱脚上）
  };
  function drawLed(ctx, comp, rec, opts) {
    var G = LED_GEO;
    var bright = rec ? Math.max(0, Math.min(rec.brightness || 0, 1.3)) : 0;
    var on = !!(rec && rec.on) && bright > 0.001;
    // 颜色：从内核的 LED_COLORS 来（rec.rgb）。rec 为 null 时是图例在画外形，
    // 按红管给色 —— 图例要的是「长什么样」，不是「这一刻亮不亮」。
    var rgb = (rec && rec.rgb) || [255, 62, 62];
    var base = rgbaStr(rgb, 1), dim = rgbaStr(rgb, 0.55);
    var sc = ctxScale(ctx);
    var rad = (comp.rot || 0) * Math.PI / 180;

    // ① 底板 + 板面丝印（＋ / 符号 / －）。底板和开关、灯泡同一块。
    ctx.save();
    ctx.translate(comp.x, comp.y); ctx.rotate(rad);
    // 对调极性：整块板连同管身一起原地左右镜像 —— 板面的「＋」「－」互换、
    // 板上的二极管符号（三角尖朝向）也跟着翻，正是「管子调了个头」的样子。
    // 镜像是【局部 x】，和 terminalWorld 对端子 x 取负是同一件事的两面。
    if (flipOf(comp)) ctx.scale(-1, 1);
    basePlate(ctx, PLATE.HW, PLATE.TOP, PLATE.FACE, PLATE.BOT);
    plateFace(ctx, plateSymLed, '＋', '－');
    // ② 两根引脚：从管身两端水平伸出 → 折下 → 沿板面走到接线柱底下。
    //    这两段就是管子的支撑，板子上没有别的支架 —— 真实的示教板也是这样，
    //    管子是靠自己的腿立在板上的。
    plateLead(ctx, [[G.domeCx - 2, G.y], [-G.turnX, G.y], [-G.turnX, G.leadY], [-HALF, G.leadY]], 3.4);
    plateLead(ctx, [[G.flangeX + G.flangeW + 4, G.y], [G.turnX, G.y], [G.turnX, G.leadY], [HALF, G.leadY]], 3.4);
    ctx.restore();

    // ③ 管身：把坐标系抬到管轴高度 G.y，下面这段沿用管轴 y=0 的局部坐标。
    ctx.save();
    ctx.translate(comp.x, comp.y); ctx.rotate(rad);
    if (flipOf(comp)) ctx.scale(-1, 1);       // 半球透镜换到右边 = 阳极在右
    ctx.translate(0, G.y);

    // 管身的轮廓路径：左半圆（透镜）+ 矩形（管身）。后面反复用到，抽出来。
    function bodyPath() {
      ctx.beginPath();
      ctx.arc(G.domeCx, 0, G.r, Math.PI / 2, -Math.PI / 2);
      ctx.lineTo(G.cylX1, -G.r);
      ctx.lineTo(G.cylX1, G.r);
      ctx.closePath();
    }

    // ④ 发光光晕。压在本体【底下】画：压在管身上就会把管子糊成一片亮斑，
    //    看不出「管子本身是半透明的彩色塑料」这件事。
    if (on) {
      var bg = Math.pow(Math.min(bright, 1.3) / 1.3, 1.15);
      var haloR = G.r * (2.0 + 2.6 * bg);
      var glow = ctx.createRadialGradient(4, 0, 2, 4, 0, haloR);
      glow.addColorStop(0, rgbaStr(rgb, 0.80 * bg));
      glow.addColorStop(0.35, rgbaStr(rgb, 0.34 * bg));
      glow.addColorStop(1, rgbaStr(rgb, 0));
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(4, 0, haloR, 0, 6.284); ctx.fill();
    }

    // ⑤ 管身：半透明彩色塑料。竖向渐变（上亮下暗）= 一根圆柱；
    //    颜色随亮度往「白热」偏（真实 LED 过流时管芯发白）。
    var lit = on ? Math.min(bright, 1.3) / 1.3 : 0;
    var cTop = mixRgb(rgb, [255, 255, 255], 0.42 + 0.40 * lit);
    var cMid = mixRgb(rgb, [255, 255, 255], 0.06 + 0.55 * lit);
    var cBot = mixRgb(rgb, [20, 24, 34], 0.34 - 0.18 * lit);
    bodyPath();
    ctx.save(); ctx.clip();
    ctx.fillStyle = linGrad(ctx, 0, -G.r, 0, G.r,
      [[0, rgbaStr(cTop, 1)], [0.34, rgbaStr(cMid, 1)], [0.72, rgbaStr(rgb, 0.92)], [1, rgbaStr(cBot, 1)]]);
    ctx.fillRect(-44, -G.r - 1, 80, G.r * 2 + 2);
    // 玻璃的两道反光：一条宽斜带（左上）+ 右下一条窄的。
    // 只画渐变不画反光，管子会读成一块实心塑料，不是玻璃封装的管子。
    ctx.fillStyle = 'rgba(255,255,255,' + (0.30 + 0.34 * lit) + ')';
    ctx.beginPath();
    ctx.moveTo(G.domeCx - 12, G.r * 1.05);
    ctx.lineTo(G.domeCx + 6, -G.r * 1.05);
    ctx.lineTo(G.domeCx + 14, -G.r * 1.05);
    ctx.lineTo(G.domeCx - 4, G.r * 1.05);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,' + (0.12 + 0.16 * lit) + ')';
    ctx.beginPath();
    ctx.moveTo(14, G.r * 1.05); ctx.lineTo(24, G.r * 0.15);
    ctx.lineTo(30, G.r * 0.22); ctx.lineTo(20, G.r * 1.05);
    ctx.closePath(); ctx.fill();
    // 边缘聚暗：真玻璃的「边」是暗的，缺了它管子会平得像一张贴纸。
    var rim = ctx.createRadialGradient(0, 0, G.r * 0.5, 0, 0, G.r * 1.5);
    rim.addColorStop(0, 'rgba(86,104,124,0)');
    rim.addColorStop(1, 'rgba(60,76,96,0.34)');
    ctx.fillStyle = rim;
    ctx.fillRect(-44, -G.r - 1, 80, G.r * 2 + 2);
    ctx.restore();
    bodyPath();
    ctx.strokeStyle = 'rgba(70,86,104,0.45)'; ctx.lineWidth = 1; ctx.stroke();

    // ⑥ 管芯：小杯 + 芯片 + 金线。这三件是「二极管」三个字的实物出处，
    //    所以哪怕只有几像素也画出来（缩得很小时金线会省掉，见 sc 判据）。
    ctx.save();
    bodyPath(); ctx.clip();
    // 小杯：阴极引线的顶端做成的凹槽，芯片就坐在里面
    ctx.fillStyle = linGrad(ctx, G.cupX - G.cupR, 0, G.cupX + G.cupR, 0,
      [[0, '#e9eef4'], [0.5, '#9fb0c2'], [1, '#5d6d7e']]);
    ctx.beginPath();
    ctx.moveTo(G.cupX - G.cupR, -G.cupR * 0.9);
    ctx.lineTo(G.cupX + G.cupR, -G.cupR * 0.55);
    ctx.lineTo(G.cupX + G.cupR, G.cupR * 0.95);
    ctx.lineTo(G.cupX - G.cupR, G.cupR * 0.75);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(40,52,68,0.45)'; ctx.lineWidth = 0.8; ctx.stroke();
    // 芯片（die）：不通电时是一小块深色硅片，导通时自己发亮 —— 管子里
    // 最亮的那一点就是它，这跟实物上一模一样。
    var die = on ? mixRgb(rgb, [255, 255, 255], 0.55 + 0.35 * lit) : [70, 60, 66];
    ctx.fillStyle = rgbaStr(die, 1);
    ctx.fillRect(G.cupX - 2.6, -2.6, 5.2, 5.2);
    ctx.strokeStyle = 'rgba(20,26,36,0.5)'; ctx.lineWidth = 0.7;
    ctx.strokeRect(G.cupX - 2.6, -2.6, 5.2, 5.2);
    // 金线：从芯片顶上一路引到阳极那一头。它细得只有 1px，
    // 缩小到 0.9 以下就整根省掉 —— 留一根糊掉的金线不如不留。
    if (sc >= 0.9) {
      ctx.strokeStyle = 'rgba(226,182,90,0.95)';
      ctx.lineWidth = Math.max(0.7, Math.min(1.3, sc * 0.7));
      ctx.beginPath();
      ctx.moveTo(G.cupX - 1, -2.6);
      ctx.quadraticCurveTo(-4, -G.r * 0.72, G.domeCx + 4, -G.r * 0.58);
      ctx.stroke();
    }
    ctx.restore();

    // ⑦ 法兰盘（阴极侧）。实物上它比管身粗一圈，颜色也更实 ——
    //    因为管身是透光的、法兰是不透光的环氧。这道粗细差就是认阴极的第二眼。
    ctx.fillStyle = linGrad(ctx, 0, -G.flangeR, 0, G.flangeR,
      [[0, rgbaStr(mixRgb(rgb, [255, 255, 255], 0.30 + 0.30 * lit), 1)],
       [0.30, rgbaStr(mixRgb(rgb, [255, 255, 255], 0.02 + 0.40 * lit), 1)],
       [0.70, rgbaStr(rgb, 1)],
       [1, rgbaStr(mixRgb(rgb, [20, 24, 34], 0.40), 1)]]);
    roundRect(ctx, G.flangeX, -G.flangeR, G.flangeW, G.flangeR * 2, 3);
    ctx.fill();
    ctx.strokeStyle = 'rgba(60,72,88,0.5)'; ctx.lineWidth = 1; ctx.stroke();
    // 法兰外沿的一道亮棱：没有它，法兰看着和管身一样厚。
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(G.flangeX + G.flangeW + 0.5, -G.flangeR + 3);
    ctx.lineTo(G.flangeX + G.flangeW + 0.5, G.flangeR - 3);
    ctx.stroke();
    // 平边（cathode flat）：法兰下缘被削平的那一小段。这是实物上
    // 【不用看引脚长短】就能认出阴极的那个标记，所以位置固定在右下。
    ctx.strokeStyle = 'rgba(24,32,44,0.85)';
    ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(G.flangeX + G.flangeW - 1, G.flangeR * 0.34);
    ctx.lineTo(G.flangeX + G.flangeW - 1, G.flangeR * 0.94);
    ctx.stroke();

    ctx.restore();

    // ⑧ 接线柱：0 号是「+」（红），1 号是「−」（黑）。
    //    ⚠️ 必须在【已经退出 translate(comp.x, comp.y)】的上下文里调 posts()：
    //    它内部走 terminalWorld()，那里会再加一次 comp.x/comp.y。写在 translate
    //    里面等于平移叠了两遍，柱子被画到两倍坐标处 —— 元件在 x=800 时柱子跑到
    //    1600，屏幕上只剩两根孤零零的柱子飘在画布另一头（元件附近一根都没有），
    //    学生点不到、也看不出导线接在哪儿。开关/灯泡/两只表都是写在 translate
    //    外面的，这三个新元件当初漏了这一步。
    posts(ctx, comp, ['pos', 'neg'], 1.4, 8);

    // ⑨ 烧毁的管子：过流（>25mA）烧掉以后管身熏黑、透镜上留一道裂。
    //    管子在电路上已经是断路了，画面上也必须看得出「这根管子完了」，
    //    否则学生只会以为是自己没接对线，反复拔插。
    if (rec && rec.fault === 'burned') {
      ctx.save();
      ctx.translate(comp.x, comp.y); ctx.rotate(rad);
      if (flipOf(comp)) ctx.scale(-1, 1);     // 熏黑与裂痕跟着管子走
      soot(ctx, (G.domeCx + G.cylX1) / 2, G.y, 40, 24, 1);
      ctx.strokeStyle = 'rgba(12,10,9,0.8)'; ctx.lineWidth = 1.8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(G.domeCx - G.r * 0.5, G.y - G.r * 0.62);
      ctx.lineTo(G.domeCx + 2, G.y + 1);
      ctx.lineTo(G.domeCx - 5, G.y + G.r * 0.5);
      ctx.stroke();
      faultTag(ctx, 0, G.y - G.r - 12, '已烧毁', 1);
      ctx.restore();
    }
  }

  // ============================================================
  // 直流电动机（示教板：底板 + 两个支撑 + 抬起的机身 + 轴端螺旋桨）
  // ------------------------------------------------------------
  // 画面上必须能看出三件事，否则这个元件就白加了：
  //   ① 它【在转】—— 螺旋桨的三片叶子按转子角扫过，正转顺时针、反转逆时针；
  //   ② 它【往哪边转】—— 接线反了叶子就反着扫，这是「电流方向决定转向」
  //      在实物上的样子；
  //   ③ 它【发烫】—— 堵转时线圈电流是空载的好几倍，P = I²R 大十几倍，
  //      外壳就真的往红里偏。学生看见外壳变红，再回头看电流表的数字，
  //      「电机卡住会烧」这件事就不用讲了。
  // 转速在画面上是【慢放】的（真实 2300 r/min 在 60fps 下每帧转 0.64 圈，
  // 直接画出来只会糊成一片乱转的叶子）；真实转速写在读数框里。
  //
  // 这一版把「一根浮在导线上的金属筒、筒身上贴一张 M 直流电动机」改成示教板：
  // 底板 + 两根支撑柱 + 抬起的机身 + 轴端螺旋桨；铭牌不贴机身，改印底板正面。
  // 另外修掉两处：① 引脚几何里 x0/x1/leadX0/leadX1 与实际字段名对不上，
  // 算出 NaN，左引线根本没画出来；② 接线柱写在 translate 里，被画到两倍坐标。
  // ============================================================
  var MOT_GEO = {
    x0: -52, x1: 30, hh: 17,             // 外壳：中心 y = bodyY，半径 hh
    bodyY: -40,                          // 机身轴线高度（机身最低点 = −23）
    capCx: 30, capRx: 8,                 // 右端面（椭圆）
    shaftX0: 34, shaftX1: 58, shaftR: 3.4,
    flyCx: 46, flyRx: 10, flyRy: 20,     // 螺旋桨：近侧视的椭圆（rx 小 = 几乎侧看）
    saddX: [-30, 22], saddHW: 5,         // 两根支撑柱：从板面升到机身下沿
    leadX: -14, leadX2: 8,               // 两根引线从机身底部下来的位置
    leadY: -8,                           // 引线沿板面走的高度（正好落在柱脚上）
  };
  // 画面转速 = 真实转速 × 这个系数（见上面的注释）
  var MOT_SLOW = 0.03;
  function drawMotor(ctx, comp, rec, opts) {
    var G = MOT_GEO;
    var sc = ctxScale(ctx);
    var spin = (opts && opts.spin) || 0;         // 转子角（弧度），由宿主累积
    // 发热归一：空载约 0.05W、堵转约 1.3W，取 1.5W 当满标。
    var heat = rec ? Math.max(0, Math.min((rec.pHeat || 0) / 1.5, 1)) : 0;
    var stalled = !!(rec && rec.stalled && !rec.isolated);
    var rad = (comp.rot || 0) * Math.PI / 180;
    var BY = G.bodyY, R = G.hh, BOT = BY + R;    // 机身轴线 / 半径 / 下沿

    // ① 底板 + 板面丝印（＋ / 符号 M / －）
    ctx.save();
    ctx.translate(comp.x, comp.y); ctx.rotate(rad);
    // 对调极性：底板、支撑、机身、螺旋桨一起原地左右镜像（轴端螺旋桨换到左端）。
    // ⚠️ 螺旋桨的【转角 spin 不加任何处理】。镜像本身就会让叶子看起来反着扫，
    //    而 flip 之后 rec.i 变号、内核给的 omega 也变号 —— 两者刚好各反一次，
    //    合起来正是「对调极性 → 电机反转」这一幕。要是在这里再把 spin 取负，
    //    两个反转互相抵消，学生点了按钮会发现螺旋桨纹丝不动地照原样转。
    if (flipOf(comp)) ctx.scale(-1, 1);
    basePlate(ctx, PLATE.HW, PLATE.TOP, PLATE.FACE, PLATE.BOT);
    plateFace(ctx, plateSymMotor, '＋', '－');
    ctx.restore();

    // ② 支撑柱 + 引线（都画在机身【之前】，机身压上来就是「坐在支架上」）
    ctx.save();
    ctx.translate(comp.x, comp.y); ctx.rotate(rad);
    if (flipOf(comp)) ctx.scale(-1, 1);
    G.saddX.forEach(function (sx) {
      var w = G.saddHW * 2;
      ctx.save();
      ctx.beginPath();
      roundRect(ctx, sx - G.saddHW, BOT, w, PLATE.TOP - BOT + 2, 2.5);
      ctx.clip();
      ctx.fillStyle = linGrad(ctx, sx - G.saddHW, 0, sx + G.saddHW, 0,
        [[0, '#f7fafc'], [0.16, '#dde5ed'], [0.42, '#aebbc9'],
         [0.70, '#8493a3'], [1, '#5f6e7e']]);
      ctx.fillRect(sx - G.saddHW, BOT, w, PLATE.TOP - BOT + 2);
      ctx.restore();
      roundRect(ctx, sx - G.saddHW, BOT, w, PLATE.TOP - BOT + 2, 2.5);
      ctx.strokeStyle = 'rgba(51,65,85,0.55)'; ctx.lineWidth = 1; ctx.stroke();
      // 支撑柱顶面的一道受光棱：柱子才「托住」机身，而不是插进机身里
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      roundRect(ctx, sx - G.saddHW + 1, BOT + 0.6, w - 2, 1.4, 0.7); ctx.fill();
      // 底脚螺钉（把支架拧在板上）
      if (sc >= 1) screwHead(ctx, sx, PLATE.TOP - 6, 3.2, 'slot', sc);
    });
    // 两根引线：从机身【底部】下来，再沿板面走到接线柱底下。
    // 走机身底下而不是两头，是为了不横穿螺旋桨（叶子就扫在那儿）。
    plateLead(ctx, [[G.leadX, BOT], [G.leadX, G.leadY], [-HALF, G.leadY]], 3.6);
    plateLead(ctx, [[G.leadX2, BOT], [G.leadX2, G.leadY], [HALF, G.leadY]], 3.6);
    ctx.restore();

    // ③ 机身：把坐标系抬到轴线高度 BY，下面这段沿用轴线 y=0 的局部坐标。
    ctx.save();
    ctx.translate(comp.x, comp.y); ctx.rotate(rad);
    if (flipOf(comp)) ctx.scale(-1, 1);
    ctx.translate(0, BY);

    // 外壳：横躺的金属圆筒。左端圆、右端留出端面椭圆。
    softShadow(ctx, G.x0, -R, G.x1 - G.x0, R * 2, 14, 12);
    contactShadow(ctx, 0, BOT - BY + 2, (G.x1 - G.x0) * 0.42, 5, 0.28);
    // ⚠️ 最后那个 true（逆时针）不能省：canvas 的 arc 默认【顺时针】扫角，
    //    从 −π/2 到 +π/2 会经过 0°，画出来是【右】半圆 —— 于是圆柱左端整块
    //    没有填色，露出底下的 softShadow 白矩形，机身看着就是「一个白方块上
    //    贴了一张 M 的图」。逆时针才是经过 180° 的左半圆，才是圆柱的端面。
    function shellPath() {
      ctx.beginPath();
      ctx.moveTo(G.x1, -R);
      ctx.lineTo(G.x0 + R, -R);
      ctx.arc(G.x0 + R, 0, R, -Math.PI / 2, Math.PI / 2, true);
      ctx.lineTo(G.x1, R);
      ctx.closePath();
    }
    shellPath();
    ctx.fillStyle = linGrad(ctx, 0, -R, 0, R, MAT.steel);
    ctx.fill();
    // 外壳上的两道环形凹槽：圆柱体上的凹槽投影成两条竖着的暗线 + 亮线，
    // 有它们才读得出「这是一根筒」，不然只是一块金属色的方板。
    ctx.save(); shellPath(); ctx.clip();
    [-38, 2].forEach(function (gx) {
      ctx.strokeStyle = 'rgba(40,52,68,0.34)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(gx, -R); ctx.lineTo(gx, R); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.42)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(gx + 2.4, -R); ctx.lineTo(gx + 2.4, R); ctx.stroke();
    });
    // 发热：外壳整体往红橙偏。压在外壳里，不溢出轮廓。
    if (heat > 0.01) {
      ctx.fillStyle = 'rgba(220,58,16,' + (0.46 * heat) + ')';
      ctx.fillRect(G.x0 - 2, -R - 2, G.x1 - G.x0 + 6, R * 2 + 4);
    }
    // 顶面的一道宽高光：金属筒受光的那一条
    ctx.fillStyle = 'rgba(255,255,255,0.30)';
    roundRect(ctx, G.x0 + 14, -R + 3.5, G.x1 - G.x0 - 22, 7, 3.5); ctx.fill();
    ctx.restore();
    shellPath();
    ctx.strokeStyle = 'rgba(70,84,100,0.5)'; ctx.lineWidth = 1.1; ctx.stroke();

    // 右端面：一个椭圆（3/4 视角下看得见的那一圈端盖）
    ctx.fillStyle = linGrad(ctx, G.capCx - G.capRx, 0, G.capCx + G.capRx, 0,
      [[0, '#8fa0b2'], [0.5, '#6c7d90'], [1, '#4a5a6c']]);
    ctx.beginPath();
    ctx.ellipse(G.capCx, 0, G.capRx, R, 0, 0, 6.284);
    ctx.fill();
    ctx.strokeStyle = 'rgba(40,52,68,0.55)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(G.capCx - 1.5, 0, G.capRx * 0.55, R * 0.9, 0, Math.PI * 0.62, Math.PI * 1.38);
    ctx.stroke();

    // ④ 转轴
    ctx.fillStyle = linGrad(ctx, 0, -G.shaftR, 0, G.shaftR,
      [[0, '#f2f6fa'], [0.35, '#c9d4e0'], [0.72, '#93a2b2'], [1, '#5f7086']]);
    roundRect(ctx, G.shaftX0, -G.shaftR, G.shaftX1 - G.shaftX0, G.shaftR * 2, 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(60,74,90,0.45)'; ctx.lineWidth = 0.9; ctx.stroke();

    // ⑤ 螺旋桨：三片叶子 + 桨毂。叶子按转子角扫过椭圆 —— 这就是
    //    「在转」和「往哪边转」两件事的全部信息来源。
    //    画法：先把椭圆【拉成圆】，在圆里画标准形状的叶片，再拉回来，
    //    省掉椭圆上那一堆切向量换算；叶片在圆里是标准的，投影自然就对。
    //    堵转时叶子停住不动（spin 不推进），旁边顶着一个红挡块。
    ctx.save();
    ctx.translate(G.flyCx, 0);
    ctx.scale(1, G.flyRy / G.flyRx);
    var FR = G.flyRx;
    var blade = ctx.createRadialGradient(0, 0, FR * 0.12, 0, 0, FR);
    blade.addColorStop(0, '#f4f8fc');
    blade.addColorStop(0.5, '#cbd6e2');
    blade.addColorStop(1, '#8d9cad');
    for (var k = 0; k < 3; k++) {
      var a = spin + k * 2 * Math.PI / 3;
      var ca = Math.cos(a), sa = Math.sin(a);
      var px = -sa, py = ca;                       // 切向单位向量
      var r0 = FR * 0.18, r1 = FR * 0.96;          // 叶根 / 叶梢半径
      var w0 = FR * 0.22, w1 = FR * 0.46;          // 叶根 / 叶梢的弦宽（叶片要宽，细了就成辐条）
      ctx.beginPath();
      ctx.moveTo(ca * r0 + px * w0, sa * r0 + py * w0);
      ctx.lineTo(ca * r1 + px * w1, sa * r1 + py * w1);
      ctx.quadraticCurveTo(ca * r1 * 1.16, sa * r1 * 1.16,
                           ca * r1 - px * w1, sa * r1 - py * w1);
      ctx.lineTo(ca * r0 - px * w0, sa * r0 - py * w0);
      ctx.closePath();
      ctx.fillStyle = blade; ctx.fill();
      ctx.strokeStyle = 'rgba(45,58,74,0.5)';
      ctx.lineWidth = 0.9 / (G.flyRy / G.flyRx);
      ctx.stroke();
    }
    ctx.restore();
    // 桨毂：比叶片亮一档的金属小帽，压在三片叶子的交点上
    var hub = ctx.createRadialGradient(G.flyCx - 1.4, -1.4, 0.6, G.flyCx, 0, 6);
    hub.addColorStop(0, '#f7fafc'); hub.addColorStop(0.55, '#b7c4d2'); hub.addColorStop(1, '#68788b');
    ctx.fillStyle = hub;
    ctx.beginPath(); ctx.ellipse(G.flyCx, 0, 3.6, 5.0, 0, 0, 6.284); ctx.fill();
    ctx.strokeStyle = 'rgba(45,58,74,0.6)'; ctx.lineWidth = 0.8; ctx.stroke();

    // 堵转：螺旋桨右下方顶一个红挡块，叶子停住。这是「卡住」这件事在
    // 画面上唯一的证据 —— 只看螺旋桨的话，停住和「电流太小转不动」
    // 长得一模一样，而这两件事的电流差着一个量级。
    // ⚠️ 必须同时要求【有电流】：电路没接通时内核也把 stalled 报成 true
    //    （没有电流当然转不动），但那种情况下顶个「卡住了」的红挡块是错的 ——
    //    学生看到的是「线还没接完」，不是「电机被人捏住了」。
    if (stalled && Math.abs((rec && rec.i) || 0) > 1e-9) {
      ctx.save();
      ctx.fillStyle = '#b91c1c';
      ctx.strokeStyle = 'rgba(90,12,12,0.8)'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(G.flyCx + G.flyRx + 1, G.flyRy * 0.30);
      ctx.lineTo(G.flyCx + G.flyRx + 10, G.flyRy * 0.05);
      ctx.lineTo(G.flyCx + G.flyRx + 10, G.flyRy * 0.72);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    // ⑥ 接线柱：0 号是「+」（红），1 号是「−」（黑）。
    //    必须在【已经退出 translate】的上下文里调 —— 见发光二极管那一节的长注释。
    posts(ctx, comp, ['pos', 'neg'], 1.4, 8);
  }

  // ============================================================
  // 电铃（电磁铁 + 衔铁 + 断续触点 + 铃碗）
  // ------------------------------------------------------------
  // 通电的链条是：线圈通电 → U 形铁芯变成电磁铁 → 吸下衔铁 →
  // 衔铁上的锤敲响铃碗 → 同时把弹簧片上的触点顶开 → 电流断掉 →
  // 弹簧把衔铁拉回、触点重新闭合 → 再吸…… 于是嗡嗡地响。
  // 画面上能看见的就是这条链条的后半段：衔铁上下振、锤敲碗、碗发亮起波纹。
  // ⚠️ 两个接线柱都画成【金属色】，不画正负 —— 这不是偷懒，是
  //    「电铃没有单向导电性」这件事在画面上唯一的表达方式。
  //    电流方向只影响铁芯的 N/S，而软铁衔铁不管 N 极还是 S 极都被吸引。
  // ============================================================
  var BEL_GEO = {
    coreX: [-50, -14], coreTop: -48, coreR: 5,   // U 形铁芯的两根立柱
    yokeY: -12, yokeH: 9, yokeX0: -56, yokeX1: -8,
    coilTop: -44, coilBot: -18, coilHalfW: 10,
    armY: -58, armH: 7, armX0: -58, armX1: -4,   // 衔铁（横杆）
    bowlCx: 30, bowlCy: -4, bowlR: 30,           // 铃碗（开口朝下的半球壳）
    hamX: 2, hamY: -30, hamR: 6.5,               // 锤头
    pullMax: 5,                                  // 衔铁被吸下的最大位移
  };
  // 画面上的敲击频率。真实电铃约 25~40 Hz —— 60fps 下画 30 Hz 只会糊成
  // 一片重影，所以画面按 8 Hz 慢放，真实频率写在读数框里。
  var BEL_HZ = 8;
  function drawBell(ctx, comp, rec, opts) {
    var G = BEL_GEO;
    var sc = ctxScale(ctx);
    var rings = !!(rec && rec.rings);
    var vol = rec ? Math.max(0, Math.min(rec.volume || 0, 1)) : 0;
    var t = (opts && opts.t) || 0;
    // 吸合位移：0（松开）→ pullMax（吸到底）。用 (1−cos)/2 而不是 |sin|：
    // 真实衔铁是被吸过去、被弹簧拉回，一头一尾各停一下，不是正弦摆动。
    var pull = rings ? (0.5 - 0.5 * Math.cos(2 * Math.PI * BEL_HZ * t)) * (0.55 + 0.45 * vol) : 0;
    var dy = G.pullMax * pull;
    ctx.save();
    ctx.translate(comp.x, comp.y);
    ctx.rotate((comp.rot || 0) * Math.PI / 180);

    basePlate(ctx, PLATE.HW, PLATE.TOP, PLATE.FACE, PLATE.BOT);
    // 板面丝印：电铃没有极性（两个柱都是金属色），所以正面不印 ＋/－，
    // 只印【电路图符号】和名字。符号是半圆拱 + 底边 + 中央铃舌 ——
    // 「一个圆里画一只铃」是蜂鸣器那一类发声器件的通用画法，人教版电路图里
    // 的电铃是半圆那一支。实物和符号必须对得上，学生才敢照着图连线。
    plateSymBell(ctx, -30, 16, 1);
    silk(ctx, '电铃', 24, 17, 11, SILK_INK, 'rgba(255,255,255,0.72)');

    // ① U 形铁芯：两根立柱 + 底部横梁，连成一体的软铁。先画铁芯再画线圈，
    //    线圈压在柱子上 —— 实物就是漆包线绕在铁芯外面。
    ctx.fillStyle = linGrad(ctx, 0, G.yokeY, 0, G.yokeY + G.yokeH,
      [[0, '#7a8797'], [0.35, '#5d6a7a'], [1, '#3c4756']]);
    roundRect(ctx, G.yokeX0, G.yokeY, G.yokeX1 - G.yokeX0, G.yokeH, 3);
    ctx.fill();
    ctx.strokeStyle = 'rgba(28,36,48,0.55)'; ctx.lineWidth = 1; ctx.stroke();
    G.coreX.forEach(function (cx) {
      ctx.fillStyle = linGrad(ctx, cx - G.coreR, 0, cx + G.coreR, 0,
        [[0, '#4d5968'], [0.3, '#8b98a8'], [0.5, '#b6c2cf'], [0.75, '#6d7a8a'], [1, '#3f4a58']]);
      roundRect(ctx, cx - G.coreR, G.coreTop, G.coreR * 2, G.yokeY - G.coreTop + 2, 2.5);
      ctx.fill();
      ctx.strokeStyle = 'rgba(28,36,48,0.5)'; ctx.lineWidth = 0.9; ctx.stroke();
    });
    // 铁芯顶端的两极：通电时它们就是电磁铁的 N/S 极，各画一道亮口
    if (rings) {
      ctx.fillStyle = 'rgba(120,170,255,' + (0.30 + 0.45 * pull) + ')';
      G.coreX.forEach(function (cx) {
        roundRect(ctx, cx - G.coreR, G.coreTop - 1.5, G.coreR * 2, 3.5, 1.5); ctx.fill();
      });
    }

    // ② 两组线圈（绕在两根立柱上）
    var coilStops = [[0, '#5f4310'], [0.16, '#a8832f'], [0.34, '#e3c473'],
                     [0.50, '#fbf0c0'], [0.68, '#c9a24a'], [0.88, '#8a6524'], [1, '#4e360c']];
    G.coreX.forEach(function (cx) {
      ctx.save();
      ctx.translate(cx, (G.coilTop + G.coilBot) / 2);
      ctx.rotate(-Math.PI / 2);
      coil(ctx, -(G.coilBot - G.coilTop) / 2, (G.coilBot - G.coilTop) / 2,
           -G.coilHalfW, G.coilHalfW, 14, coilStops, sc);
      ctx.restore();
    });

    // ③ 断续触点：一根从衔铁下来的弹簧片 + 铁芯之间那个固定触点螺钉。
    //    它才是「铃会响而不是吸住不动」的原因，必须画出来。
    ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-30, G.armY + dy);
    ctx.lineTo(-30, -26 + dy * 0.6);
    ctx.stroke();
    ctx.fillStyle = linGrad(ctx, -34, 0, -26, 0,
      [[0, '#5f4310'], [0.4, '#e3c473'], [0.6, '#fbf0c0'], [1, '#8a6524']]);
    roundRect(ctx, -34, -26, 8, 6, 2); ctx.fill();
    ctx.strokeStyle = 'rgba(40,28,8,0.6)'; ctx.lineWidth = 0.9; ctx.stroke();

    // ④ 衔铁（软铁横杆）+ 弹簧片。整根跟着 pull 一起下移 —— 锤也就跟着
    //    敲到碗上，这是「一次吸合 = 一次敲击」在画面上的对应关系。
    ctx.save();
    ctx.translate(0, dy);
    ctx.fillStyle = linGrad(ctx, 0, G.armY, 0, G.armY + G.armH,
      [[0, '#b6c2cf'], [0.28, '#8794a4'], [0.62, '#5d6a7a'], [1, '#39424f']]);
    roundRect(ctx, G.armX0, G.armY, G.armX1 - G.armX0, G.armH, 3);
    ctx.fill();
    ctx.strokeStyle = 'rgba(28,36,48,0.6)'; ctx.lineWidth = 1; ctx.stroke();
    // 弹簧片：从衔铁左端斜下到底板。画成一条细的弯钢片。
    ctx.strokeStyle = '#9fb0c2'; ctx.lineWidth = 3.4; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(G.armX0 + 2, G.armY + G.armH - 1);
    ctx.quadraticCurveTo(G.armX0 - 6, -30, G.armX0 + 4, PLATE.TOP + 1);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(G.armX0 + 1, G.armY + G.armH - 2);
    ctx.quadraticCurveTo(G.armX0 - 7, -30, G.armX0 + 3, PLATE.TOP);
    ctx.stroke();
    // 锤杆 + 锤头
    ctx.strokeStyle = linGrad(ctx, 0, G.armY, 0, G.hamY,
      [[0, '#c3cfdb'], [0.5, '#8794a4'], [1, '#5d6a7a']]);
    ctx.lineWidth = 4.2; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(G.armX1 - 3, G.armY + G.armH * 0.5);
    ctx.lineTo(G.hamX, G.hamY);
    ctx.stroke();
    var hg = ctx.createRadialGradient(G.hamX - 2, G.hamY - 2, 1, G.hamX, G.hamY, G.hamR);
    hg.addColorStop(0, '#eef3f8'); hg.addColorStop(0.5, '#a8b6c4'); hg.addColorStop(1, '#5b6c7d');
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.arc(G.hamX, G.hamY, G.hamR, 0, 6.284); ctx.fill();
    ctx.strokeStyle = 'rgba(40,52,68,0.55)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();

    // ⑤ 铃碗：开口朝下的半球壳，坐在底板上。碗口留一道厚边（真实铃碗
    //    的卷边），没有它这个半圆会读成「一顶帽子」。
    var bowlPath = function () {
      ctx.beginPath();
      ctx.arc(G.bowlCx, G.bowlCy, G.bowlR, Math.PI, 0);
      ctx.lineTo(G.bowlCx + G.bowlR, G.bowlCy + 7);
      ctx.arc(G.bowlCx, G.bowlCy + 7, G.bowlR, 0, Math.PI, true);
      ctx.closePath();
    };
    bowlPath();
    var bg = ctx.createLinearGradient(G.bowlCx - G.bowlR, 0, G.bowlCx + G.bowlR, 0);
    bg.addColorStop(0, '#8fa0b2'); bg.addColorStop(0.28, '#e8eef5');
    bg.addColorStop(0.52, '#c3cfdb'); bg.addColorStop(0.78, '#8794a4');
    bg.addColorStop(1, '#5b6c7d');
    ctx.fillStyle = bg; ctx.fill();
    ctx.strokeStyle = 'rgba(45,58,74,0.6)'; ctx.lineWidth = 1.1; ctx.stroke();
    ctx.save(); bowlPath(); ctx.clip();
    // 碗身上的一道竖向高光（金属球面的受光带）
    ctx.fillStyle = 'rgba(255,255,255,0.34)';
    ctx.beginPath();
    ctx.ellipse(G.bowlCx - G.bowlR * 0.30, G.bowlCy - G.bowlR * 0.30,
                G.bowlR * 0.17, G.bowlR * 0.72, 0.28, 0, 6.284);
    ctx.fill();
    ctx.restore();
    // 敲击的瞬间：碗被照亮 + 碗外两圈扩散的振动弧。
    // 弧的相位用 t 直接推，频率是敲击频率的 3 倍 —— 一次敲击荡出三圈。
    if (rings) {
      var flash = Math.pow(pull, 3);
      if (flash > 0.02) {
        ctx.save(); bowlPath(); ctx.clip();
        ctx.fillStyle = 'rgba(255,255,255,' + (0.55 * flash) + ')';
        ctx.fillRect(G.bowlCx - G.bowlR, G.bowlCy - G.bowlR, G.bowlR * 2, G.bowlR * 2);
        ctx.restore();
      }
      ctx.save();
      ctx.strokeStyle = 'rgba(120,140,165,0.55)';
      for (var q = 0; q < 3; q++) {
        var ph = ((t * BEL_HZ * 3 + q / 3) % 1);
        var rr = G.bowlR + 3 + ph * 20;
        ctx.globalAlpha = (1 - ph) * 0.5 * (0.4 + 0.6 * vol);
        ctx.lineWidth = 2.2 - 1.4 * ph;
        ctx.beginPath();
        ctx.arc(G.bowlCx, G.bowlCy, rr, Math.PI * 1.10, Math.PI * 1.90);
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.restore();

    // ⑥ 接线柱：两个都是金属色（无极性）。见本节的标题注释。
    //    必须在【已经退出 translate(comp.x, comp.y)】的上下文里调 ——
    //    见发光二极管那一节的长注释（写在里面柱子会被画到两倍坐标处）。
    posts(ctx, comp, ['neutral', 'neutral'], 1.4, 8);
  }

  // ============================================================
  // 统一入口
  // ============================================================
  // opts 是【可选】的第 4 个参数，只有会动的元件用得到（电动机的转子角、
  // 电铃的振动相位）。不传就一律按静止画 —— 放大镜、图例、电路图那边
  // 都是三参数调用，它们要的是「这一刻的静态外形」，不该被动画污染。
  // 接线点：一个实心小圆点 + 一圈深色描边 —— 电路图上那个「三岔口」的结点。
  // 它是【自动长出来】的（从接线柱往导线中间连线时），所以画得越不起眼越好：
  // 学生要看的是电路，不是这个点。半径 7 和导线的墨宽（W+2 ≈ 9）刚好相称，
  // 两根导线接在同一个点上、点又盖在它们上面，看上去就是一整根线拐了个岔。
  var JUNC_R = 7;
  function drawJunction(ctx, comp) {
    ctx.save();
    ctx.translate(comp.x, comp.y);
    ctx.rotate((comp.rot || 0) * Math.PI / 180);
    ctx.beginPath();
    ctx.arc(0, 0, JUNC_R, 0, Math.PI * 2);
    ctx.fillStyle = PALETTE.wire;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = PALETTE.metalDark;
    ctx.stroke();
    ctx.restore();
  }

  // ============================================================
  // 练习模式下的电源【黑匣子】
  // ------------------------------------------------------------
  // 做练习题时，电源就是一个不知道电压的黑盒子 —— 盒面写一个「?」；要是电压作为
  // 已知条件给了，就直接写数值（用户要求：「如果电源电压知道，就直接显示多少伏」）。
  // 接线柱照常留在两侧：导线还得连着，不然电路看着就断了。
  // 盒子尺寸【固定】、不随 emf 变 —— emf 未知时压根没有「节数」可算。
  // ============================================================
  function drawSourceBox(ctx, comp, rec) {
    var isPSU = comp.type === 'power';
    // 盒体范围。
    //  · 电池：柱子钉在 ±HALF(±70)，盒子比柱子窄（±62），再从盒壁引两截线到柱子；
    //  · 学生电源：柱子长在面板【右下角】(36, 26) / (78, 26)，盒子必须整个盖住
    //    它们 —— 照电池那套 ±62 画的话，右边那根柱子在盒外，导线接在半空里。
    //    取【上下左右对称】的 ±84 而不是「左 −70 / 右 90」的偏心盒：这件器材
    //    可以「对调极性」（params.flip ⇒ 柱子镜像到 −36 / −78），而 drawSourceBox
    //    这一段没有跟着镜像 —— 偏心盒会在翻转过的电源上把柱子漏到盒外去。
    // 🔴 这两个数要跟着 TERMINALS.power 走（柱子在面板上挪了，盒子就得跟着挪）。
    var hw = isPSU ? 84 : 62;
    var hh = isPSU ? 58 : 24;
    ctx.save();
    ctx.translate(comp.x, comp.y);
    ctx.rotate((comp.rot || 0) * Math.PI / 180);
    // 引出导线：只有电池那一路需要。学生电源的柱子本来就在盒子【里面】，
    // 再画那两截就是往盒面上刷一条横线。
    if (!isPSU) {
      ctx.strokeStyle = PALETTE.metalLo; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-hw, 0); ctx.lineTo(-HALF, 0);
      ctx.moveTo(hw, 0); ctx.lineTo(HALF, 0);
      ctx.stroke();
    }
    // 盒体：深色渐变，一眼看出「这里面是什么，不知道」
    var g = ctx.createLinearGradient(0, -hh, 0, hh);
    g.addColorStop(0, '#475569'); g.addColorStop(0.55, '#334155'); g.addColorStop(1, '#1e293b');
    ctx.fillStyle = g;
    roundRect(ctx, -hw, -hh, hw * 2, hh * 2, 9);
    ctx.fill();
    ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 2; ctx.stroke();
    // 盒面那行字：已知 → 电压数值（琥珀色，一眼是「题目给的」）；未知 → 大问号
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (rec && rec.practiceBoxKnown) {
      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 16px -apple-system,"PingFang SC",sans-serif';
      ctx.fillText(String(rec.practiceBoxText || ''), 0, 0);
    } else {
      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 30px -apple-system,"PingFang SC",sans-serif';
      ctx.fillText('?', 0, 1);
    }
    ctx.restore();
  }

  function drawComponent(ctx, comp, rec, opts) {
    switch (comp.type) {
      case 'resistor': drawResistor(ctx, comp, rec); break;
      case 'battery':
        if (rec && rec.practiceBox) drawSourceBox(ctx, comp, rec);
        else drawBattery(ctx, comp, rec);
        break;
      case 'power':
        if (rec && rec.practiceBox) drawSourceBox(ctx, comp, rec);
        else drawPowerSupply(ctx, comp, rec);
        break;
      case 'switch': drawSwitch(ctx, comp, rec); break;
      case 'spdt': drawSpdt(ctx, comp, rec); break;
      case 'bulb': drawBulb(ctx, comp, rec); break;
      case 'led': drawLed(ctx, comp, rec, opts); break;
      case 'motor': drawMotor(ctx, comp, rec, opts); break;
      case 'bell': drawBell(ctx, comp, rec, opts); break;
      case 'ammeter': drawMeter(ctx, comp, rec, false); break;
      case 'voltmeter': drawMeter(ctx, comp, rec, true); break;
      case 'galvanometer': drawGalvanometer(ctx, comp, rec); break;
      case 'rheostat': drawRheostat(ctx, comp, rec); break;
      case 'plate': drawPlate(ctx, comp, rec); break;
      case 'junction': drawJunction(ctx, comp); break;
      default: throw new Error('未知元件类型: ' + comp.type);
    }
  }
  // 「这个元件会不会自己动」——宿主靠它决定哪些元件必须每帧重画，
  // 不能扔进静态缓存层。开关的刀片、灯泡的亮度都只跟状态走，不算「会动」。
  function isAnimated(type) { return type === 'motor' || type === 'bell'; }

  function drawBackground(ctx, W, H) {
    ctx.fillStyle = PALETTE.bench;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = PALETTE.grid; ctx.lineWidth = 1;
    var G = 40;
    ctx.beginPath();
    for (var x = G; x < W; x += G) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); }
    for (var y = G; y < H; y += G) { ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); }
    ctx.stroke();
  }

  return {
    PALETTE: PALETTE, HALF: HALF, TERMINALS: TERMINALS,
    terminalWorld: terminalWorld, terminalWorldIn: terminalWorldIn,
    toWorld: toWorld, toLocal: toLocal,
    // flipOf —— 「对调极性」的单一真值（读 comp.params.flip）。绘制、命中、
    //          测试都该问它，别各自去翻 params。
    // endWorld —— 解【导线端点】的唯一入口：元件还在就走端子坐标，元件被删了
    //          就读端点里冻住的 x/y（见 circuit-editor 的 removeSelected）。
    //          任何 byId + terminalWorld 的写法在「删元件保留导线」之后都会崩。
    flipOf: flipOf, endWorld: endWorld,
    // nameOf —— 元件的【显示名】单一真值（c.name 空则回落 c.id）。画布标签、
    //           侧栏表、警告行、浮层标题一律问它，别各自去读 c.id 或 c.name。
    nameOf: nameOf,
    RHEO: RHEO, RHEO_LABEL: RHEO_LABEL, PLATE: PLATE, SPDT: SPDT,
    // 端子字母这一帧真的画出去的字号 / 字形宽度 / 落点（见 rheoLabelDrawn 注释）。
    rheoLabels: function () { return rheoLabelDrawn; },
    sliderLocalX: sliderLocalX, slideFromLocalX: slideFromLocalX,
    slideOf: slideOf,
    drawComponent: drawComponent, drawWire: drawWire, electronShift: electronShift,
    // 元件图示（元件盒图标 / 拖拽鬼影）。取景框 ICON_VIEW 一并导出：
    // 自检要能问「这颗按钮的框包没包住整件器材」。
    drawIcon: drawIcon, ICON_VIEW: ICON_VIEW,
    // drawRheostatFlow —— 变阻器绕线内部的粒子层。宿主必须【每帧】调它（本体
    // 留在静态缓存层，只有这一层是动画），而且要在导线之后调，否则粒子会被
    // 压在导线底下。phase 传 null 就不画（粒子开关关着时）。
    drawRheostatFlow: drawRheostatFlow,
    // 表盘上那块数字示数用的格式化。导出是为了让断言能拿【同一份】规则去对账 ——
    // 在测试里再抄一份 num1 等于把「表盘数字和侧栏表是同一套规则」这个洞留着。
    fmtRead: fmtRead,
    // 电表的示数（指针实际指着多少，未调零时含偏移）。侧栏表格、点元件浮层、
    // 放大镜读数、逆推，全都问它 —— 显示层各算各的就会出现「指针和读数不一致」。
    meterIndicated: meterIndicated,
    drawTerminals: drawTerminals,
    currentShift: currentShift,
    roundPath: roundPath, CORNER_SEG: CORNER_SEG,
    isAnimated: isAnimated,
    LED_GEO: LED_GEO, MOT_GEO: MOT_GEO, BEL_GEO: BEL_GEO,
    MOT_SLOW: MOT_SLOW, BEL_HZ: BEL_HZ, mixRgb: mixRgb,
    FLOW_PX_PER_PHASE: FLOW_PX_PER_PHASE, polyLen: polyLen, pointAt: pointAt, pointDirAt: pointDirAt,
    subPath: subPath,
    // 损坏外观的公共基元。drawSmoke 必须由宿主每帧调（它要一个连续推进的
    // 时钟）：冒烟是唯一一件「坏了还在动」的事，塞进静态缓存层就成了一张图。
    soot: soot, faultTag: faultTag, drawSmoke: drawSmoke,
    drawBackground: drawBackground, drawBindingPost: drawBindingPost,
    resistorBands: resistorBands, roundRect: roundRect, softShadow: softShadow,
    batterySize: batterySize, batteryMarkLocal: batteryMarkLocal, bodyBox: bodyBox,
    meterDialCenter: meterDialCenter,
    // 学生电源的面板几何（机箱 / 旋钮 / 刻度盘 / 开关 / 指示灯 / 接线柱）。
    // 导出是给【编辑器】和【自检】用的：
    //   · 编辑器拖旋钮时按 psuEmfFromAngle 反解电压；
    //   · 自检要能拿【同一份】几何去判「拖了旋钮，电压真的跟着变」，
    //     而不是在测试里再抄一遍角度公式 —— 抄一份就等于把「实现改了、
    //     测试还绿」这个洞留着。
    PSU: PSU,
    psuFracOf: psuFracOf, psuAngleOf: psuAngleOf,
    psuEmfFromAngle: psuEmfFromAngle, psuKnobRadius: psuKnobRadius,
    // psuDrawn —— 最近一次画学生电源时【实际画出去】的几何（元件自身坐标系）：
    //   旋钮法兰 / 捏手 / 拨杆尖端 / 两根柱子的柱尖与柱根 / 前表面法线。
    // 自检拿它断「这三件东西都是沿 FACE 凸出去的」—— 按 PSU 常数再算一遍是
    // 算不出「画的时候到底往哪个方向偏」的（那正是本轮要修的那个 bug）。
    psuDrawn: function () { return psuDrawn; },
    psuFaceAngle: psuFaceAngle,
    MAT: MAT, MET: MET, MET_SWEEP: MET_SWEEP, POST_GRAD: POST_GRAD,
    // 灵敏电流计的几何 / 满偏换算。GAL 导出给自检点刻度用；galUnitOf /
    // galFullOf 导出是因为【读数牌、读数框、放大镜】都要写单位（mA / μA），
    // 三处各写一份「range < 0.001 就 μA」迟早有一处写反 —— 差 1000 倍。
    GAL: GAL, galUnitOf: galUnitOf, galFullOf: galFullOf,
    // 表头大读数牌（用户第 1 点）。页面在导线之后按 meterReadoutBox 落笔画，
    // 绘制层只出几何 —— 两边共用同一份，牌子不会和表壳错位。
    METER_READOUT: METER_READOUT, meterReadoutBox: meterReadoutBox,
    BAND_COLORS: BAND_COLORS,
    version: '2.6.0',
  };
});
