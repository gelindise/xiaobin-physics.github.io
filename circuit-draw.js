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

  // 丝印 / 铭牌文字。压在浅色塑料上要深色，压在深色上要浅色 —— 由调用方给。
  // 一律先描一圈反色垫底：不加垫底的细字压在同色系底上会糊掉（电池盒上
  // 那几个「1.5V」以前就是这样，远看是一块脏）。
  function silk(ctx, text, x, y, px, color, halo) {
    ctx.save();
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
  function coil(ctx, x0, x1, yTop, yBot, turns, stops, sc) {
    if (x1 - x0 < 0.5) return;
    var n = Math.max(2, Math.round(turns));
    var step = (x1 - x0) / n;
    var skew = Math.min(step * 1.9, (yBot - yTop) * 0.42);   // 斜度 = 螺距的方向感
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
  var MET = {
    CASE_HW: 88, CASE_TOP: -86, CASE_BOT: 42,       // 表壳（浅色胶木，上沿大圆角）
    // 表盘比上一版高了 16：大量程的数字要挪到刻度弧【外面】（真表就是这个排布），
    // 弧的半径一动，两排数字就全挤到「A」字上——所以是往上长表壳，不是缩弧。
    DIAL: { x: -76, y: -72, w: 152, h: 106 },       // 白色表盘
    PIVOT: { x: 0, y: 10 },                         // 指针转轴
    RT0: 50, RT1: 62,                               // 刻度线内 / 外半径
    // 刻度的两排数字：大量程在弧线【外】（表盘上方），小量程在弧线【内】。
    // 真表（J0407）就是这么印的：读数先看零刻度在哪一排，两排一上一下不会看串。
    // 上一版两排都塞在弧线里面，大数字只是半径大一点，和「上面 / 下面」不是一回事。
    RN_HI: 73, RN_LO: 38,                           // 弧外（大量程）/ 弧内（小量程）数字半径
    BLOCK: { top: 4, bot: 34, hwT: 24, hwB: 34 },   // 底部网纹块（梯形）
    ZERO: { x: 0, y: 26, r: 6.5 },                  // 调零螺丝
    BASE_HW: 96, BASE_TOP: 42, BASE_BOT: 60,        // 底座（比表壳宽一圈）
    POST_Y: 72,                                     // 三柱锚点（= TERMINALS 的 y）
  };
  // 指针扫角：−150° → −30°，绕正上方左右各 60°（教材表的弧线就这一段）
  var MET_SWEEP = { A0: -Math.PI * 5 / 6, A1: -Math.PI / 6 };

  // ============================================================
  // 端子坐标
  // ============================================================
  var TERMINALS = {
    resistor: [{ x: -HALF, y: 0 }, { x: HALF, y: 0 }],
    battery: [{ x: HALF, y: 0 }, { x: -HALF, y: 0 }],   // 0 = 正极（右）
    switch: [{ x: -HALF, y: 0 }, { x: HALF, y: 0 }],
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
    rheostat: [
      // 编号照人教版图16.4-2 的实物位置：下面两个柱是 A/B（电阻丝两端），
      // 上面两个柱是 C/D（金属杆两端）。改这四个点的【顺序】等于改内核语义，
      // 必须和 circuit-core.js 的 TYPES.rheostat 一起动。
      { x: -78, y: 26 }, { x: 78, y: 26 },     // A 左下 / B 右下（电阻丝）
      { x: -78, y: -26 }, { x: 78, y: -26 },   // C 左上 / D 右上（金属杆）
    ],
  };

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
    var t = TERMINALS[comp.type][i];
    return toWorld(comp, t.x, t.y);
  }

  // 滑动变阻器的几何。绘制和「拨滑片」的命中判断必须共用这一组数字——
  // 各写一份迟早漂移成「看得见却拨不动」，或者拨的是空气。
  var RHEO = {
    BW: 156, BH: 58,
    cylX: -60, cylY: 4, cylW: 120, cylH: 26,   // 绕线瓷管（电阻丝本体）
    knobHalf: 14, knobTop: -38, knobBottom: -12,  // 滑片（骑在金属杆上）
    track: 9,                                    // 滑片行程两端各留的余量
    postX: 78, postY: 26,                        // 下面两个柱（A / B）的局部坐标
  };
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
    var dr = 4.5, dh = 3.1;                 // 穹顶半径 / 高度，都比螺母小一圈
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
  function posts(ctx, comp, kinds, scale, neck) {
    for (var i = 0; i < kinds.length; i++) {
      var p = terminalWorld(comp, i);
      drawBindingPost(ctx, p.x, p.y, kinds[i], scale, neck);
    }
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

  function strokePath(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
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
  //         current: 是否画电流方向箭头（默认关，向后兼容只传 flow/phase 的调用） }
  function drawWire(ctx, pts, opts) {
    if (!pts || pts.length < 2) return;
    opts = opts || {};
    var W = opts.width || 6;

    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    // 外描边（导线外皮）
    ctx.strokeStyle = 'rgba(100,116,139,0.35)';
    ctx.lineWidth = W + 2;
    strokePath(ctx, pts);
    // 主体
    ctx.strokeStyle = opts.color || PALETTE.wire;
    ctx.lineWidth = W;
    strokePath(ctx, pts);
    // 顶部高光
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = W * 0.3;
    strokePath(ctx, pts);
    ctx.restore();

    // 自由电子小球：间距按实际长度均分，位置沿【弧长】排布，
    // 所以速度是「每秒多少像素」，串联回路里长导线和短导线一样快。
    // electrons 只在【显式】传 false 时才不画：老调用方只传 flow/phase，
    // 行为必须和以前一模一样（小球照旧出来）。
    var I = Math.abs(opts.flow || 0);
    if (I > 1e-6 && opts.phase != null && opts.electrons !== false) {
      var L = polyLen(pts);
      if (L < 1) return;
      var n = Math.max(1, Math.round(L / 42));   // 42px 一颗，长导线自动多排几颗
      var step = L / n;
      var shift = electronShift(opts.flow, opts.phase);
      ctx.save();
      ctx.fillStyle = PALETTE.flow;
      ctx.shadowColor = 'rgba(245,158,11,0.85)';
      ctx.shadowBlur = 7;
      for (var i = 0; i < n; i++) {
        // 对 L 取模：粒子从导线末端出去就从首端进来，两端接得上，看不到跳变
        var d = ((i * step + shift) % L + L) % L;
        var p = pointAt(pts, d);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.9, 0, 6.284);
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
      var n2 = Math.max(1, Math.round(L2 / 64));
      var step2 = L2 / n2;
      var sh2 = currentShift(opts.flow, opts.phase);
      ctx.save();
      ctx.fillStyle = PALETTE.current;
      ctx.shadowColor = 'rgba(220,38,38,0.7)';
      ctx.shadowBlur = 6;
      for (var j = 0; j < n2; j++) {
        var d2 = ((j * step2 + sh2) % L2 + L2) % L2;
        var q = pointDirAt(pts, d2);
        ctx.save();
        ctx.translate(q.x, q.y);
        ctx.rotate(Math.atan2(q.uy, q.ux));     // 箭头朝向 = 该点的切向
        ctx.beginPath();
        ctx.moveTo(7, 0); ctx.lineTo(-5, -4.8); ctx.lineTo(-5, 4.8);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }
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
      // 开关和灯泡是「板子铺在导线底下、柱子从板面上立起来」的一类，
      // 和两只表正好反过来。盒子取「够用不缩」的那一档，但要卡死 ≤ 73：
      // 接线柱在 ±70，走线检查算的是 |lx| < hw−3，hw 再大柱子就被圈进盒子里，
      // 「导线夹在柱子上」会被误判成「导线穿过元件」。
      case 'switch': return { hw: 70, hh: 62 };          // 底板 ±70，手柄抬起后顶到 −62
      case 'bulb': return { hw: 70, hh: 74 };            // 底板 ±70，玻璃泡顶 y = −71.5
      // 三个新元件都是「示教板」：和开关 / 灯泡同一块底板（±70），本体长在板面上方。
      // 所以 hw 给 70（板宽），hh 只要盖住本体到板面这一截 —— 一超过 70，
      // 钉在 ±70 的接线柱就被圈回盒子里，「导线夹在柱子上」会被误判成
      // 「导线穿过元件」（和表头那条注释是同一个坑）。
      case 'led': return { hw: 70, hh: 46 };             // 底板 ±70，管身顶 y = −45
      case 'motor': return { hw: 70, hh: 60 };           // 底板 ±70，机身/螺旋桨顶 y = −58
      case 'bell': return { hw: 70, hh: 60 };            // 底板 ±70，铃碗顶 y = −36
      // 表头：整台仪器的包围盒（表壳 + 底座）。接线柱在 POST_Y，
      // 故意落在盒子【外面】——导线夹在柱子上，不该被当成穿体。
      // 所以 hh 有【上限 70】：表壳为了放下大量程那排数字往上长到了 −86（见 MET），
      // 但盒子不能跟着长——一过 75，接线柱（POST_Y = 72）就被圈回盒子里，
      // 挂着导线的柱子会被判成「导线穿过表体」。盒子比表壳矮一截是有意的。
      case 'ammeter': case 'voltmeter':
        return { hw: MET.BASE_HW + 4, hh: Math.min(-MET.CASE_TOP, 70) };
      case 'rheostat': return { hw: RHEO.BW / 2, hh: RHEO.BH / 2 }; // 含陶瓷管与滑片杆
      default: return { hw: 54, hh: 20 };                // 定值电阻 BW/BH = 108/40
    }
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
      ctx.font = 'bold ' + Math.max(8, Math.min(12, Math.round(bandH * 0.62))) +
        'px -apple-system,"PingFang SC",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(perCell.toFixed(1).replace(/\.0$/, '') + 'V' + (cells > 1 ? ' × ' + cells : ''),
        0, arcBot + bandH / 2 + 0.5);
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
    var markY = -CHD * 0.16, markX = boxW / 2 - EW / 2;
    var mk = Math.max(4.5, Math.min(6.5, EW * 0.33));    // 记号的半臂长
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

  function basePlate(ctx, hw, top, face, bot) {
    var sc = ctxScale(ctx);
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
  // 闸刀开关（人教版实物：左边铰链、右边手柄，刀片往右上方抬起）
  // ------------------------------------------------------------
  // 手柄在【右】、铰链在【左】。教材实物图里手柄在左，这里按用户要求照
  // 课本实验图的方向摆：断开时刀片从右边扬起来，闭上时往右压下去，
  // 和「向左下方合闸」讲的是同一件事，但和多数教材插图的朝向一致。
  // 改朝的时候 x 全部取反：转轴 −46、静触点 +28、刀片朝 +x 伸、手柄在
  // 最外侧（本体 +81~+110）；刀片长度、柱高、底板一个字没动。
  // 抬起/压下的角度也要一起取反——canvas 的正角是顺时针，刀片伸向 +x 时
  // 要 θ<0 才是「抬起来」，沿用原来的 +0.28 会画成往板子里扎下去。
  // ============================================================
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
    var CT0 = CONTACT_X - CONTACT_HW, CT1 = CONTACT_X + CONTACT_HW;
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, CT0, CONTACT_TOP, CONTACT_HW * 2, PLATE.TOP - CONTACT_TOP, 2.5);
    ctx.clip();
    ctx.fillStyle = linGrad(ctx, CT0, 0, CT1, 0,
      [[0, '#f7fafc'], [0.16, '#dde5ed'], [0.42, '#aebbc9'],
       [0.70, '#8493a3'], [1, '#5f6e7e']]);
    ctx.fillRect(CT0, CONTACT_TOP, CONTACT_HW * 2, PLATE.TOP - CONTACT_TOP);
    ctx.restore();
    roundRect(ctx, CT0, CONTACT_TOP, CONTACT_HW * 2, PLATE.TOP - CONTACT_TOP, 2.5);
    ctx.strokeStyle = 'rgba(51,65,85,0.6)'; ctx.lineWidth = 1; ctx.stroke();
    // 顶面的受光棱 + 夹线槽：刀片压下来就是压在这条棱上
    ctx.fillStyle = 'rgba(255,255,255,0.62)';
    roundRect(ctx, CT0 + 1.2, CONTACT_TOP + 0.8, CONTACT_HW * 2 - 2.4, 1.4, 0.7); ctx.fill();
    ctx.fillStyle = 'rgba(40,52,68,0.45)';                      // 顶上那道夹线槽
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
      [[0, '#f7fafc'], [0.16, '#dde5ed'], [0.42, '#aebbc9'],
       [0.70, '#8493a3'], [1, '#5f6e7e']]);
    ctx.fillRect(HB0, PIV.y - 7, HB1 - HB0, PLATE.TOP - (PIV.y - 7));
    // 支架上的加强筋：两道竖的浅槽，金属片的「折过边」才有厚度
    ctx.strokeStyle = 'rgba(51,65,85,0.22)'; ctx.lineWidth = 1;
    [HB0 + 6, HB1 - 6].forEach(function (vx) {
      ctx.beginPath(); ctx.moveTo(vx, PIV.y - 3); ctx.lineTo(vx, PLATE.TOP - 2); ctx.stroke();
    });
    ctx.restore();
    roundRect(ctx, HB0, PIV.y - 7, HB1 - HB0, PLATE.TOP - (PIV.y - 7), 2.5);
    ctx.strokeStyle = 'rgba(51,65,85,0.6)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.58)';
    roundRect(ctx, HB0 + 1.2, PIV.y - 5.8, HB1 - HB0 - 2.4, 1.4, 0.7); ctx.fill();
    if (sc >= 1) screwHead(ctx, (HB0 + HB1) / 2, PLATE.TOP - 7, 3.4, 'slot', sc);

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
    // 原来那种整条一个色的写法在放大镜里是一块铁皮。
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, 0, -BLADE_HT, BLADE_LEN, BLADE_HT * 2, 3);
    ctx.clip();
    ctx.fillStyle = linGrad(ctx, 0, -BLADE_HT, 0, BLADE_HT,
      [[0, '#ffffff'], [0.12, '#f2f6fa'], [0.34, '#d5dee7'],
       [0.62, '#a9b6c4'], [0.86, '#8493a3'], [1, '#67767f']]);
    ctx.fillRect(0, -BLADE_HT, BLADE_LEN, BLADE_HT * 2);
    // 拉丝：沿长度方向的细线。刀片是轧出来的，表面有轧制纹
    if (sc >= 1.3) {
      ctx.strokeStyle = 'rgba(255,255,255,0.30)'; ctx.lineWidth = 0.7;
      for (var bz = -BLADE_HT + 1.6; bz < BLADE_HT; bz += 2.2) {
        ctx.beginPath(); ctx.moveTo(2, bz); ctx.lineTo(BLADE_LEN - 2, bz); ctx.stroke();
      }
    }
    ctx.restore();
    roundRect(ctx, 0, -BLADE_HT, BLADE_LEN, BLADE_HT * 2, 3);
    ctx.strokeStyle = 'rgba(51,65,85,0.55)'; ctx.lineWidth = 0.9; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.72)';   // 刀背上的一条锐利高光
    roundRect(ctx, 3, -BLADE_HT + 1.1, BLADE_LEN - 8, 1.3, 0.65); ctx.fill();
    // 铰链端的铆钉孔：刀片是铆在支架上的，没有它刀片像贴在支架上
    if (sc >= 1) {
      ctx.fillStyle = 'rgba(51,65,85,0.30)';
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
  function drawBulb(ctx, comp, rec) {
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

    // ── 灯丝 ────────────────────────────────────────────────
    // 两根引线从螺口里升上来，顶端折向中间，中间挂一段螺旋丝。
    // 真灯泡的灯丝是【螺旋】的，而且靠两根支架丝撑着；老画法是一条折线，
    // 读出来是「一根歪线」。引线起点埋在箍里，箍一盖就只剩露在玻璃中的那截。
    // 灯丝本身就是那条色温曲线：微亮是暗红的丝，额定是暖白，过载近白。
    // 辉光（shadowBlur）也随亮度连续长，不再靠 0.15 这一刀切白或切灭。
    var leadCol = lit ? rgbaStr(heat, 1) : '#8a6a3a';
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
    ctx.beginPath();
    ctx.moveTo(-4.2, CY - 1.4);
    var turns = 6, span = 8.4;
    for (var fi = 0; fi <= turns; fi++) {
      var fx = -4.2 + span * (fi / turns);
      ctx.lineTo(fx, CY - 1.4 + (fi % 2 ? 1.5 : -1.5));
    }
    ctx.lineTo(4.2, CY - 1.4);
    ctx.stroke();
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

  function drawMeter(ctx, comp, rec, isVolt) {
    var M = MET, SW = MET_SWEEP;
    var reading = rec ? (rec.reading || 0) : 0;
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
    softShadow(ctx, -M.CASE_HW, M.CASE_TOP, M.CASE_HW * 2, M.CASE_BOT - M.CASE_TOP, 18, 16);
    contactShadow(ctx, 0, M.CASE_BOT + 1, M.CASE_HW * 0.92, 6, 0.26);
    ctx.fillStyle = linGrad(ctx, -M.CASE_HW, M.CASE_TOP, M.CASE_HW * 0.5, M.CASE_BOT,
      [[0, '#fdfefe'], [0.40, '#e9eff6'], [1, '#c4d0de']]);
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

    // ── 防视差镜面带 ────────────────────────────────────────
    // 真表（J0407/J0408）在刻度弧【内侧】镀了一圈镜面：读数时让指针和它的
    // 倒影重合，眼睛就不偏了。这里画成一条很淡的灰带 —— 它不是主体，
    // 画重了会和刻度线抢注意力。半径取在刻度内端（RT0=50）里面一点。
    ctx.save();
    ctx.strokeStyle = 'rgba(148,163,184,0.42)';
    ctx.lineWidth = 4.5; ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.arc(M.PIVOT.x, M.PIVOT.y, M.RT0 - 4.5, SW.A0, SW.A1);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';    // 镜面带上沿的一道反光
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(M.PIVOT.x, M.PIVOT.y, M.RT0 - 6.4, SW.A0, SW.A1);
    ctx.stroke();
    ctx.restore();

    // ── 刻度弧 ──────────────────────────────────────────────
    // 三档线长，和真表一致：
    //   大格（带数字）3 段 × 每段 10 小格 —— 0.6A 量程一大格 0.2A、小格 0.02A；
    //   3A 量程共用同一条弧，一大格 1A、小格 0.1A（两排数字正好落在同一批长线上）。
    //   大格【中点】的线短一截（8/12），其余小格再短（5/12）——
    //   上一版把中点也画成大格那么长，一条弧上就多出三根没有数字的长线，
    //   看着像刻度印漏了，读数时也分不清哪根才是大格。
    var MAJOR = 3, MINOR = 10, total = MAJOR * MINOR, i;
    for (i = 0; i <= total; i++) {
      var a = SW.A0 + (SW.A1 - SW.A0) * (i / total);
      var step = i % MINOR;                       // 0 = 带数字的大格
      var isMajor = (step === 0), isHalf = (step === MINOR / 2);
      var r1 = M.RT1, r0 = M.RT1 - (isMajor ? 12 : (isHalf ? 8 : 5));
      ctx.strokeStyle = isMajor ? '#1f2937' : '#94a3b8';
      ctx.lineWidth = isMajor ? 1.8 : (isHalf ? 1.2 : 0.9);
      ctx.beginPath();
      ctx.moveTo(M.PIVOT.x + Math.cos(a) * r0, M.PIVOT.y + Math.sin(a) * r0);
      ctx.lineTo(M.PIVOT.x + Math.cos(a) * r1, M.PIVOT.y + Math.sin(a) * r1);
      ctx.stroke();
    }

    // ── 两排数字 ────────────────────────────────────────────
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    [['hi', M.RN_HI, HI_TX, 12, 3],
     ['lo', M.RN_LO, LO_TX, 10.5, 2]].forEach(function (row) {
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
    ctx.font = 'bold 19px -apple-system,"PingFang SC",sans-serif';
    ctx.fillText(isVolt ? 'V' : 'A', 0, M.PIVOT.y - 16);

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
    var mag = Math.min(Math.abs(reading) / (range || 1), 1.06);
    // 反接时**不按比例往左画**：真表的指针这时候会一直顶到左边的限位钉上，
    // 电流再大也停在零刻度左边那一点点——那个位置根本没有刻度，所以「读不出数」。
    // 按比例镜像（−0.3A 画成 0.3A 的镜像）会落在弧上、指着 0.3 那条线，
    // 看着像是能读的，正好把这个知识点教反了。
    var frac = rev ? -0.085 : mag;
    var na = SW.A0 + (SW.A1 - SW.A0) * frac;
    var alert = over || rev;                       // 超量程 / 反接都用红针
    ctx.save();
    ctx.translate(M.PIVOT.x, M.PIVOT.y);
    ctx.rotate(na);
    // 配重尾：真表的指针在转轴【另一边】有一小截配重，指针才不至于被自己的
    // 重量压弯。少了它，指针就是一根插在轴上的针，读不出「会转」这件事。
    ctx.strokeStyle = 'rgba(15,23,42,0.20)'; ctx.lineWidth = 4.2;
    ctx.beginPath(); ctx.moveTo(-17, 1.6); ctx.lineTo(-7, 1.6); ctx.stroke();
    ctx.strokeStyle = alert ? '#b91c1c' : '#111827'; ctx.lineWidth = 3.0;
    ctx.beginPath(); ctx.moveTo(-17, 0); ctx.lineTo(-7, 0); ctx.stroke();
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(15,23,42,0.18)'; ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.moveTo(-8, 1.6); ctx.lineTo(M.RT1 - 14, 1.6); ctx.stroke();
    // 指针杆保持 2.2 宽【不能变细】：反接时针尖要打进零刻度线左边那一小格，
    // 那里是像素级断言在盯着（细杆在那一格里数不够墨，测试会红）。
    // 真实的锥形指针在这里用「针尖三角」表达，杆保持等宽。
    ctx.strokeStyle = alert ? '#b91c1c' : '#111827'; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(M.RT1 - 14, 0); ctx.stroke();
    // 针尖：细长的三角，不是等腰三角 —— 真指针的尖是刀刃形的
    ctx.fillStyle = alert ? '#b91c1c' : '#111827';
    ctx.beginPath();
    ctx.moveTo(M.RT0 + 3, 0);
    ctx.lineTo(M.RT0 - 6, -2.8);
    ctx.lineTo(M.RT0 - 6, 2.8);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    // 限位钉：零刻度线外侧立着的一根小柱子，指针回到零就顶在它上面。
    // 位置取在刻度左端（A0 = −150°）之外一点 —— 正好落在「反接窗口」的【上方】，
    // 不会把那一格染黑（那一格是正接时必须干净的白表盘）。
    ctx.strokeStyle = 'rgba(51,65,85,0.75)'; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(M.PIVOT.x + Math.cos(SW.A0) * 52, M.PIVOT.y + Math.sin(SW.A0) * 52);
    ctx.lineTo(M.PIVOT.x + Math.cos(SW.A0) * 60, M.PIVOT.y + Math.sin(SW.A0) * 60);
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
    ctx.save();
    roundRect(ctx, M.DIAL.x, M.DIAL.y, M.DIAL.w, M.DIAL.h, 14);
    ctx.clip();
    glassHighlight(ctx, M.DIAL.x, M.DIAL.y, M.DIAL.w, M.DIAL.h);
    // 玻璃上沿的一道弧形反光：玻璃是【鼓】的，反光必然是弯的。
    // 只有那条直的斜带时，表盘看着是平的（玻璃只是一层膜）。
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

    // ── 底座 + 绿色面板 ─────────────────────────────────────
    var BT = M.BASE_TOP, BB = M.BASE_BOT;
    softShadow(ctx, -M.BASE_HW, BT - 3, M.BASE_HW * 2, BB - BT + 8, 12, 8);
    contactShadow(ctx, 0, BB + 1, M.BASE_HW * 0.94, 5, 0.28);
    ctx.save();
    roundRect(ctx, -M.BASE_HW, BT, M.BASE_HW * 2, BB - BT, 6); ctx.clip();
    ctx.fillStyle = linGrad(ctx, 0, BT, 0, BB,
      [[0, '#e6edf4'], [0.28, '#ccd7e3'], [0.68, '#b0bdcb'], [1, '#8fa0b2']]);
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
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px -apple-system,"PingFang SC",sans-serif';
    ctx.fillText('−', POSTX[0], BT + 9);
    ctx.fillText(POST_TX[0], POSTX[1], BT + 9);
    ctx.fillText(POST_TX[1], POSTX[2], BT + 9);

    // ── 三个接线柱 ──────────────────────────────────────────
    // 必须先把表壳那一套 translate/rotate 还回去：posts() 按【世界坐标】
    // 落柱子，漏掉这个 restore 会把三根柱子整体平移一个元件的位置
    // （画面上就是右下角凭空多出三根柱子，而本体上没有）。
    ctx.restore();
    // kind 按【端子序号】给：0 号是「−」柱（黑），1/2 号是两个量程柱（红）。
    posts(ctx, comp, ['neg', 'pos', 'pos']);
  }


  // ============================================================
  // 滑动变阻器（人教版图16.4-2）
  // ------------------------------------------------------------
  // 和教材图对齐的几处：
  //   · 两侧是两块灰色 A 形金属立板（不是白瓷柱），上端夹住金属杆、下端带脚
  //   · 白瓷管长度按立板间距给满，电阻丝只绕在【中间那一段】——两头留白的
  //     白瓷上拧着 A / B 两个接线柱，这正是「下面两柱接在电阻丝两头」的样子
  //   · 一根细金属杆横跨两板，鞍形滑片骑在杆上，触臂下探到绕线上
  //   · C / D 是金属杆两端的柱子（银），A / B 是瓷管两端的柱子（红）
  // 几何全部走 RHEO：滑片行程、命中框都靠它，一个数字都不能自作主张。
  // ============================================================
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
    var PITCH = 1.9;                    // 圈距（局部单位）。真变阻器的绕线就密到这个程度：
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
    ctx.save();
    ctx.font = 'bold 15px -apple-system,"PingFang SC",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.lineJoin = 'round';
    // 字母落在接线柱斜外侧（接线柱在 ±78/±26，柱体半径约 17）。
    // 上下不能画反：A/B 是【下面】两个柱（电阻丝两端）、C/D 是【上面】两个柱
    // （金属杆两端）——这是人教版图16.4-2 的编号，也是学生数接线柱的参照系。
    [['A', -101, 44], ['B', 101, 44], ['C', -101, -44], ['D', 101, -44]].forEach(function(L){
      var p = toWorld(comp, L[1], L[2]);
      ctx.strokeText(L[0], p.x, p.y);
      ctx.fillStyle = '#334155';
      ctx.fillText(L[0], p.x, p.y);
    });
    ctx.restore();

    // 柱色按图16.4-2：下面两个（A/B，电阻丝两端）是红的，上面两个（C/D，金属杆）
    // 是银的。变阻器本身没有极性，红在这里只表示「出厂就接在电阻丝上」，
    // 真正的语义靠 A/B/C/D 四个字母，不要把红当成正极。
    // C/D 只有这两个，所以单独画，不走 posts()——原因见下面那段。
    // A/B 给 1.4 倍、8 高的螺纹杆（和开关、灯泡同一档）：图16.4-2 里这两个柱子
    // 是【立在白瓷端头上】的，柱顶要高过瓷管，一眼能看见；按默认的矮柱子画，
    // 它整根都埋在那条红铜引线的粗细里，看着只剩一根横着的铜片。
    posts(ctx, comp, ['pos', 'pos'], 1.4, 8);

    // C / D：金属杆两端的柱子是【横着朝外伸】的圆柱头（图16.4-2 里就是两个
    // 从立板上探出来的银色圆柱）。立着画有两个毛病：一是柱子顶在立板上沿，
    // 看着像板子上又长了一颗蘑菇；二是「它接的是那根细杆」这句话在图上没了着落
    // ——横着从杆的端头伸出去，才一眼看出它和杆是一条线。
    // 顺带一个好处：导线本来就是水平走过来的，横柱让线接头看着更顺。
    [2, 3].forEach(function (ti) {
      var p = terminalWorld(comp, ti);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(ti === 2 ? -1 : 1, 1);        // 镜像成「朝外」，左右各一份
      ctx.fillStyle = 'rgba(15,23,42,0.22)';
      ctx.beginPath(); ctx.ellipse(1, 4, 9, 3, 0, 0, 6.284); ctx.fill();
      // 柱身走【竖向】渐变（上亮下暗）才是根圆管，横向渐变会画成一根扁铁片
      ctx.fillStyle = linGrad(ctx, 0, -6, 0, 6,
        [[0, '#5b6c7d'], [0.26, '#93a2b2'], [0.48, '#f2f6fa'],
         [0.72, '#9aa8b8'], [1, '#5b6c7d']]);
      roundRect(ctx, -9, -6, 18, 12, 3); ctx.fill();
      ctx.strokeStyle = 'rgba(40,52,68,0.45)'; ctx.lineWidth = 0.9; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';   // 管身上的一道细高光
      roundRect(ctx, -8, -4.6, 15, 1.4, 0.7); ctx.fill();
      // 外端那圈滚花螺母（比柱身粗一圈，和别的元件的柱帽是同一套长相）
      // 尺寸/圆角都收着来：15 高 + 2.5 圆角配 8 宽，放大镜里是一个方疙瘩；
      // 改成 14 高、2.9 圆角，再补一条内肩线和外端倒角，才是一颗拧在杆上的螺母。
      ctx.fillStyle = linGrad(ctx, 0, -7, 0, 7,
        [[0, '#4b5b6c'], [0.30, '#8fa0b2'], [0.52, '#eef3f9'], [1, '#4b5b6c']]);
      roundRect(ctx, 7, -7, 8, 14, 2.9); ctx.fill();
      ctx.save();
      roundRect(ctx, 7, -7, 8, 14, 2.9); ctx.clip();
      knurl(ctx, 7, -7, 8, 14, sc * 1.2, 'rgba(15,23,42,0.30)');
      // 外端倒角：螺母的端面是倒过角的，一道竖直的亮棱比整块平头有体积
      ctx.fillStyle = 'rgba(255,255,255,0.42)';
      ctx.fillRect(14.2, -5.6, 1.1, 11.2);
      ctx.fillStyle = 'rgba(30,41,59,0.22)';
      ctx.fillRect(13.0, -5.6, 1.1, 11.2);
      ctx.restore();
      ctx.strokeStyle = 'rgba(40,52,68,0.5)'; ctx.lineWidth = 0.9;
      roundRect(ctx, 7, -7, 8, 14, 2.9); ctx.stroke();
      // 内肩：螺母压在柱身端头的那一圈，有它才看得出是「拧上去的」
      ctx.strokeStyle = 'rgba(40,52,68,0.42)'; ctx.lineWidth = 0.9;
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
    basePlate(ctx, PLATE.HW, PLATE.TOP, PLATE.FACE, PLATE.BOT);
    plateFace(ctx, plateSymMotor, '＋', '－');
    ctx.restore();

    // ② 支撑柱 + 引线（都画在机身【之前】，机身压上来就是「坐在支架上」）
    ctx.save();
    ctx.translate(comp.x, comp.y); ctx.rotate(rad);
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
  function drawComponent(ctx, comp, rec, opts) {
    switch (comp.type) {
      case 'resistor': drawResistor(ctx, comp, rec); break;
      case 'battery': drawBattery(ctx, comp, rec); break;
      case 'switch': drawSwitch(ctx, comp, rec); break;
      case 'bulb': drawBulb(ctx, comp, rec); break;
      case 'led': drawLed(ctx, comp, rec, opts); break;
      case 'motor': drawMotor(ctx, comp, rec, opts); break;
      case 'bell': drawBell(ctx, comp, rec, opts); break;
      case 'ammeter': drawMeter(ctx, comp, rec, false); break;
      case 'voltmeter': drawMeter(ctx, comp, rec, true); break;
      case 'rheostat': drawRheostat(ctx, comp, rec); break;
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
    terminalWorld: terminalWorld, toWorld: toWorld, toLocal: toLocal,
    RHEO: RHEO, PLATE: PLATE,
    sliderLocalX: sliderLocalX, slideFromLocalX: slideFromLocalX,
    slideOf: slideOf,
    drawComponent: drawComponent, drawWire: drawWire, electronShift: electronShift,
    currentShift: currentShift,
    isAnimated: isAnimated,
    LED_GEO: LED_GEO, MOT_GEO: MOT_GEO, BEL_GEO: BEL_GEO,
    MOT_SLOW: MOT_SLOW, BEL_HZ: BEL_HZ, mixRgb: mixRgb,
    FLOW_PX_PER_PHASE: FLOW_PX_PER_PHASE, polyLen: polyLen, pointAt: pointAt, pointDirAt: pointDirAt,
    drawBackground: drawBackground, drawBindingPost: drawBindingPost,
    resistorBands: resistorBands, roundRect: roundRect, softShadow: softShadow,
    batterySize: batterySize, bodyBox: bodyBox,
    MAT: MAT, MET: MET, MET_SWEEP: MET_SWEEP, POST_GRAD: POST_GRAD,
    BAND_COLORS: BAND_COLORS,
    version: '2.2.0',
  };
});
