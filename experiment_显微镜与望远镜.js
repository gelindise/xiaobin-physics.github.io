import * as THREE from './assets/optics-three.min.js';

// 显微镜与望远镜 —— 立体模型。
// 世界坐标以【毫米】为单位，光轴 = x 轴（光从左向右传播）。
//   物镜固定在 x = 0，目镜在 x = d（镜筒长度），物体在 x = −u1。
//
// 两台仪器的结构【完全相同】：两片凸透镜一前一后串在镜筒里。
// 区别只在物距落在哪个区间 ——
//   显微镜：f物 < u1 < 2f物 ⇒ 物镜成【放大】倒立实像
//   望远镜：u1 > 2f物      ⇒ 物镜成【缩小】倒立实像（|m1| < 1）
// 而目镜怎么用，只看【物镜成的那个实像落在目镜焦点的哪一侧】：
//   u2 < f目 ⇒ 目镜当放大镜用，成放大虚像（显微镜的用法）
//   u2 = f目 ⇒ 出射平行光，眼睛放松看无穷远（望远镜的用法）
//   u2 > f目 ⇒ 目镜成实像，不能用来观察
//
// 像的位置有【两条互不引用的路径】：
//   ① 闭式：1/f = 1/u + 1/v 逐片串（u_k = 前一片的像距 − 两片间距）
//   ② 数值：从物点发一束光线，在物镜、目镜各偏折一次（s' = s − y/f），出射直线求交
// 两条路径对得上，才说明画面上那个中间像 / 最终像是真的被折出来的。
//
// 🔴 放大倍数有【两个口径】，本页两个都算、都显示，因为它们【只在一种工况下相等】：
//    · 教材口径：M物 × M目（M目 = 250 mm ÷ 目镜焦距，明视距离口径）
//    · 实际视角放大率：tan(用仪器看的张角) ÷ tan(直接看的张角)
//    两者相等的条件是【中间像恰落在目镜焦平面上】（u2 = f目，出射平行光）。
//    u2 < f目 时实际值更大，比值恰好是 f目 / u2。
//    把「总放大倍数」写成「M物 × M目」再去断言它等于「M物 × M目」是自指恒等式，
//    所以本页的显示值一律走【实际视角放大率】，教材口径另列，断言两条路径互相印证。
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const canvas = $('sceneCanvas');
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  /* ================= 规格常量 =================
     都是【规格字面量】：改这里就是改规格，别处一律从这里读。 */
  const D_NEAR = 250.0;      // 明视距离 mm —— 目镜倍数 = 250 / f目 的口径
  const RAY_N = 3;           // 每个物点追迹的光线条数（奇数 ⇒ 有一条沿光轴）
  const FOCUS_TOL = 0.6;     // |u2 − f目| 小于它就认为「恰在目镜焦平面上」mm
  const MID_MIN = 0.05;      // 中间像高度小于它就不画（物距 ≈ 物镜焦距）
  const FOCUS_RATIO_MAX = 1.9;   // 中间像位置条的量程：u2 / f目 ∈ [0, 1.9]

  // 两种仪器的规格。物距不是独立参数，而是【跟着物镜焦距走】：
  //   u1 = uRatio × f物 ⇒ 显微镜恒满足 f < u < 2f，望远镜恒满足 u > 2f。
  //
  // 🔴 镜片口径不是随便定的，它被【主光线】钉死：
  //    物点顶端过物镜光心的那条光线（主光线）在目镜处的偏离量 = h物 · d / u1。
  //    目镜半径必须大于它，否则画出来的光线会【打在镜片外面】—— 一个自洽性缺陷。
  //    ⚠️ 关键：偏离量随【镜筒长度】线性增长，所以口径要按【镜筒量程的上限】定，不是默认值！
  //      显微镜：h物 1.5 · 87.5 / 10  = 13.13 mm；再算上瞄准物镜上边缘那条（14.90）
  //              ⇒ 目镜半径 ≥ 15.2（直径 30）
  //      望远镜：h物 20 · 237 / 360   = 13.17 mm ⇒ 目镜半径 ≥ 17.0（直径 34）
  //    物镜口径则由「追迹用的半口径」决定（光线在物镜上的落点范围）；
  //    再往上还有一道【渐晕】截断，见 raySampleHeight()。
  const MODES = {
    micro: {
      key: 'micro', name: '显微镜',
      fObj: 8, fObjMin: 5, fObjMax: 16, fObjStep: 0.5,
      fEye: 25, fEyeMin: 15, fEyeMax: 45, fEyeStep: 5,
      uRatio: 1.25,                     // u1 = 1.25 f物 ⇒ f < u < 2f
      hObj: 1.5,                        // 物体高度 mm
      lensObj: { dia: 9.0, ap: 1.7 },   // 物镜：直径 / 追迹用的半口径
      // 🔴 目镜口径被【主光线在目镜处的偏离量】h物·d/u1 钉死。
      //    fObj=8 / fEye=25 ⇒ u1 = 10、镜筒最长 d = 87.5 ⇒ 主光线偏离 13.13 mm；
      //    再加上「瞄准物镜上边缘」那条光线（落点 14.90 mm）⇒ 半径至少要 15.2。
      //    上一轮给 10.4 是【只按默认镜筒 d = 65 算的】，镜筒一拉长光线就打在镜片外面。
      lensEye: { dia: 31.0, ap: 15.2 },
      tubeDia: 33.0,
      // 取景：target.x 取「物体 ↔ 眼睛」包络的中点，camR 由【最坏参数 × 四个视角】
      // 扫描出来（探针见 dev-micro-suite 的 H 组）。34 / 138 时最小边距 20 px。
      // 目镜口径从 22 改到 31 之后包络变宽，camR 也跟着从 126 加到 138。
      target: [34, 0, 0], camR: 138,
      u2Ratio: 1.0,                     // 默认工况：中间像恰在目镜焦平面上
      note: '显微镜：物体紧贴物镜，<b>f &lt; u &lt; 2f</b> ⇒ 物镜成<b>放大</b>倒立实像。'
    },
    tele: {
      key: 'tele', name: '望远镜',
      fObj: 120, fObjMin: 80, fObjMax: 220, fObjStep: 10,
      fEye: 30, fEyeMin: 15, fEyeMax: 60, fEyeStep: 5,
      uRatio: 3,                        // u1 = 3 f物 ⇒ u > 2f
      hObj: 20.0,
      lensObj: { dia: 50.0, ap: 16.0 },
      lensEye: { dia: 34.0, ap: 17.0 },
      tubeDia: 52.0,
      target: [-40, 0, 0], camR: 660,
      u2Ratio: 1.0,
      note: '望远镜：物体离得很远，<b>u &gt; 2f</b> ⇒ 物镜成<b>缩小</b>倒立实像。'
    }
  };
  const VIEWS = {
    section:     [-0.02, 0.03, 1],
    perspective: [-0.58, 0.30, 1],
    // 🔴 俯视【不能是正俯视】。原来取 [0, 1.50, 0.03]（仰角 89°）：视线与 y 轴几乎平行，
    //    而标签之间正是靠 y 偏移拉开距离的 —— y 偏移被整个投影成【深度】，屏幕上一点不剩。
    //    结果十个标签全叠在同一条水平线上（实测最严重重叠 90~100%、重叠总面积 1000+ px²，
    //    一个字都读不出来）。给 40° 俯角（仰角 50°）之后，y 偏移有 sin50° ≈ 0.77 投到屏幕上，
    //    标签自然散开：实测默认取景下重叠 0%、且无标签出画。仍是一个明显的高角度俯视图。
    top:         [0, 1.0, 0.84],
    axis:        [1.42, 0.10, 0.02]
  };
  const VIEW_ORDER = ['section', 'perspective', 'top', 'axis'];
  // 每个视角的取景缩放（> 1 拉近、< 1 推远）。
  // 🔴 原来俯视要单独推远（0.72），是因为【正俯视】把场景压成一条水平线、标签只能横向排开；
  //    改成 40° 俯角后标签在竖直方向也散开了。但俯视仍需一点推远：
  //      · 俯视 0.85 —— 眼睛环的文字说明（「实像落在目镜后…」18 个字，宽 108 px）挂在最右端，
  //        显微镜把镜筒拉到最长（d = 87.5）时右边界差 46 px 出画；0.85 ⇒ 10 个工况全部不出画
  //        （最小边距 25 px），再远到 0.78 反而把「微镜 d=52.5」「远镜 d=210」压到 25.5% 重叠。
  //      · 沿光轴 0.90 —— 这个视角里眼睛环离相机最近（depth ≈ refDist − 80 mm），
  //        说明的屏幕偏移被放大 ~2.4 倍；宽视口（1920，纵横比补偿 = 1 ⇒ 相机更近）下
  //        d = 77.5 / 87.5 的说明会被顶出画布上沿（实测 y0 = −34 / −78 px）。0.90 ⇒ 全部不出画。
  //    这张表是「按视角取景」的唯一真源，自检要按视角核对取景。
  const VIEW_ZOOM = { section: 1, perspective: 1, top: 0.85, axis: 0.9 };

  /* ================= 状态 ================= */
  // 两种仪器各自记住自己的三个参数 —— 来回切换时不会把对方调好的数冲掉。
  const state = {
    mode: 'micro',
    params: {
      micro: { fObj: 8, fEye: 25, d: 65 },       // d = v1 + fEye（中间像恰在目镜焦平面上）
      tele:  { fObj: 120, fEye: 30, d: 210 }     // v1 = 1.5 f物 = 180 ⇒ d = 210
    },
    showRays: true,
    showMid: true,
    showFinal: true,
    showTube: true,
    view: 'perspective',
    yaw: 0, pitch: 0, zoom: 1,
    w: 1, h: 1, dpr: 1,
    records: []
  };
  const cur = () => state.params[state.mode];
  const modeOf = () => MODES[state.mode];

  /* ================= 物理内核 ================= */
  // 薄透镜成像：物距 u（> 0 表示实物、在透镜左侧）⇒ 像距 v（> 0 表示实像、在右侧）。
  //   u = f ⇒ 出射平行光（像在无穷远）；u < f ⇒ v < 0（虚像，在左侧）
  function imgDist(u, f) {
    const den = u - f;
    if (Math.abs(den) < 1e-9) return Infinity;
    return u * f / den;
  }
  // 物距：跟着物镜焦距走，保证永远落在该仪器的物距区间里
  function objDistOf(mode, fObj) { return MODES[mode].uRatio * fObj; }

  /* 物镜上取多高的一束光来追迹。
     🔴 只看物镜口径是不够的：光线过目镜时的落点
          y(d) = yL · (1 + d/u1 − d/f物) − h物 · d / u1
        第二项就是【主光线】的偏离量，它随镜筒长度线性增长。镜筒拉长到一定程度，
        这束光就整个跑到目镜口径外面去了。真实的显微镜里那部分光根本进不了眼睛
        （渐晕 / vignetting）—— 所以这里按「过目镜后仍落在目镜口径内」反解取样高度，
        而不是让光线画到镜片旁边的空气里。
     ⚠️ 若连【沿光轴那条】(yL = 0) 都已经落在目镜口径外（极端焦距比 f目/f物 ≳ 3.3），
        截断也无能为力 —— 那是几何必然，不是本函数的缺陷。 */
  function raySampleHeight(fObj, u1, d, hObj, M) {
    const apObjRay = M.lensObj.ap * 0.88;
    const apEyeRay = M.lensEye.ap * 0.96;
    const den = 1 + d / u1 - d / fObj;
    let h = apObjRay;
    for (const yL of [apObjRay, -apObjRay]) {
      const y = yL * den - hObj * d / u1;
      if (Math.abs(y) <= apEyeRay) continue;
      const yLc = (Math.sign(y) * apEyeRay + hObj * d / u1) / den;
      if (Number.isFinite(yLc)) h = Math.min(h, Math.abs(yLc));
    }
    return Math.max(h, apObjRay * 0.04);      // 别退化成 0（否则三条光线重合）
  }

  /* --- 薄透镜光线追迹 ---
     一条光线用 (x, y, s) 表示：位置 (x, y)、斜率 s = dy/dx。
     过一片薄透镜（焦距 f，位于 x = L）：y 不变，斜率变成 s − y/f。
     f = Infinity（无透镜）⇒ 斜率不变。 */
  function traceThin(x0, y0, s0, lenses) {
    let x = x0, y = y0, s = s0;
    const segs = [];
    for (const L of lenses) {
      if (!(L.x > x0 + 1e-9)) continue;
      const yL = y + s * (L.x - x);
      segs.push({ x0: x, y0: y, x1: L.x, y1: yL });
      x = L.x; y = yL;
      if (Number.isFinite(L.f)) s = s - y / L.f;
    }
    return { segs, x, y, s };
  }
  // 两条直线 (x, y, s) 的交点；平行（或退化）返回 null
  function meetLines(a, b) {
    const ds = a.s - b.s;
    if (!Number.isFinite(ds) || Math.abs(ds) < 1e-12) return null;
    const x = (b.y - a.y + a.s * a.x - b.s * b.x) / ds;
    const y = a.y + a.s * (x - a.x);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  }

  /* --- 本页的主计算：给定当前状态，算出全部光学量 --- */
  /* 🔴 倍数与张角的【唯一真源】。
     optics()（真正渲染的那份）与 __microLab.viewMag()（自检扫参数用的纯函数版）都调它 ——
     以前这两处各写了一份同样的公式，于是「改 optics 那份」的变异对断言毫无影响
     （负向对照 M11~M14 全绿：断言读的是 viewMag 那份）。
     参数 m1 / v2 / hFinal 由调用方按自己的路径算好传进来；
     lastSlope 只在「像距不是有限数」时才用得上（追迹那条路给得出，纯函数那条路给 null）。 */
  function magOf(mode, fObj, fEye, u1, d, hObj, m1, v2, hFinal, lastSlope) {
    const u2 = d - imgDist(u1, fObj);
    const Mobj = Math.abs(m1);                    // 物镜把物体放大了几倍
    const Meye = D_NEAR / fEye;                   // 目镜上刻的那个数（明视距离口径）
    // 🔴 教材口径【按仪器分开】：显微镜 M物×M目；望远镜 f物/f目（人教版）。
    const Mprod = mode === 'micro' ? Mobj * Meye : fObj / fEye;
    const corrK = mode === 'micro' ? 1 : u1 / (u1 - fObj);
    // 直接看的张角：显微镜把物体放到明视距离；望远镜就在原处看
    const tanRaw = mode === 'micro' ? hObj / D_NEAR : hObj / u1;
    // 用仪器看的张角：闭式（= |m1|·h物 / u2）与追迹（虚像张角 / 出射光斜率）两条
    const tanViewCF = Math.abs(m1) * hObj / u2;
    const tanViewTR = Number.isFinite(v2)
      ? Math.abs(hFinal) / Math.abs(v2)
      : (lastSlope === null || lastSlope === undefined ? null : Math.abs(lastSlope));
    return {
      u2, Mobj, Meye, Mprod, corrK, tanRaw, tanViewCF, tanViewTR,
      // 实际视角放大率（按图上这套有限物距的几何算）
      Mview: tanViewCF / tanRaw,
      MviewTR: tanViewTR === null ? null : tanViewTR / tanRaw,
      // 两个口径由一条【可被独立验证】的恒等式联系：Mview = Mprod · corrK · f目 / u2
      MviewPred: Mprod * corrK * fEye / u2
    };
  }

  function optics() {
    const M = modeOf();
    const p = cur();
    const fObj = p.fObj, fEye = p.fEye, d = p.d;
    const u1 = objDistOf(state.mode, fObj);
    const hObj = M.hObj;
    const xObjLens = 0, xEyeLens = d, xObj = -u1;

    /* ---- 路径① 闭式：1/f = 1/u + 1/v 逐片串 ---- */
    const v1 = imgDist(u1, fObj);              // 物镜的像距（> 0 ⇒ 实像，在物镜右侧）
    const xMid = xObjLens + v1;
    const m1 = v1 / u1;                        // 物镜线放大率（> 0 表示实像、倒立）
    const hMid = -m1 * hObj;                   // 实像倒立 ⇒ 负
    // 中间像到目镜的距离。> 0 ⇒ 中间像在目镜左侧，是目镜的【实物】。
    const u2 = d - v1;
    const v2 = imgDist(u2, fEye);
    const xFinal = xEyeLens + v2;
    const m2 = v2 / u2;
    const hFinal = -m2 * hMid;                 // 再倒一次 ⇒ 与 hObj 同号（倒立）

    // 中间像相对目镜焦点的位置：< 0 ⇒ 落在焦点【以内】
    const midToFocus = u2 - fEye;
    const midSide = Math.abs(midToFocus) < FOCUS_TOL ? 'on' : (midToFocus < 0 ? 'inner' : 'outer');
    const outSide = !Number.isFinite(v2) ? 'parallel' : (v2 < 0 ? 'virtual' : 'real');

    /* ---- 路径② 数值追迹：从物点顶端发一束光线，与闭式【互不引用】 ---- */
    const lenses = [{ x: xObjLens, f: fObj }, { x: xEyeLens, f: fEye }];
    const hRay = raySampleHeight(fObj, u1, d, hObj, M);
    const rays = [];
    for (let i = 0; i < RAY_N; i++) {
      const yL = RAY_N === 1 ? 0 : hRay * ((i / (RAY_N - 1)) * 2 - 1);
      // 从物点顶端 (xObj, hObj) 射向物镜高度 yL
      rays.push(traceThin(xObj, hObj, (yL - hObj) / u1, lenses));
    }
    // 中间像 = 物镜后两条最外侧光线的交点
    const A1 = rays[0], A2 = rays[rays.length - 1];
    const sA1 = (A1.segs[1].y1 - A1.segs[1].y0) / (A1.segs[1].x1 - A1.segs[1].x0);
    const sA2 = (A2.segs[1].y1 - A2.segs[1].y0) / (A2.segs[1].x1 - A2.segs[1].x0);
    const midP = meetLines({ x: xObjLens, y: A1.segs[1].y0, s: sA1 },
                           { x: xObjLens, y: A2.segs[1].y0, s: sA2 });
    // 最终像 = 出射光线（或其反向延长线）的交点
    const finP = meetLines({ x: xEyeLens, y: A1.y, s: A1.s },
                           { x: xEyeLens, y: A2.y, s: A2.s });

    /* ---- 放大倍数：教材口径 与 实际视角放大率 两个口径 ----
       🔴 两种仪器的【教材口径不是同一个公式】，不能都写成 M物 × M目：
          · 显微镜 M = 物镜倍数 × 目镜倍数（M目 = 250 / f目）
          · 望远镜 M = 物镜焦距 ÷ 目镜焦距   ← 人教版口径。
            它是「物体在无限远、且 d = f物 + f目」时的极限值；本页为了把物体画出来
            只能取 u1 = uRatio · f物（有限），所以【教材口径 ≠ 实际视角放大率】，
            差一个修正因子 corrK = u1 / (u1 − f物)（显微镜 corrK = 1）。
          · 若把望远镜也硬写成 |m1| × 250/f目，u1 = 3f物 时得 0.5 × 8.33 = 4.17，
            和教材公式 f物/f目 = 4 只差 4% 纯属巧合（u1 − f物 = 240 ≈ 250），
            换个 uRatio 就露馅 —— 所以这里必须按仪器分开写。 */
    /* 🔴 倍数与张角全部交给 magOf()（唯一真源）。以前这里与 __microLab.viewMag() 各写了一份
       同样的公式 ⇒ 「改这一份」的变异对断言毫无影响（负向对照 M11~M14 全绿：断言读的是 viewMag）。 */
    const mag = magOf(state.mode, fObj, fEye, u1, d, hObj, m1, v2, hFinal,
      Number.isFinite(v2) ? null : rays[rays.length - 1].s);
    const { Mobj, Meye, Mprod, corrK, tanRaw, tanViewCF, tanViewTR, Mview, MviewTR, MviewPred } = mag;

    return {
      M, p, fObj, fEye, d, u1, hObj, xObj, xObjLens, xEyeLens,
      v1, xMid, m1, hMid, u2, v2, xFinal, m2, hFinal,
      midToFocus, midSide, outSide,
      rays, midP, finP,
      xMidTrace: midP ? midP.x : null,
      hMidTrace: midP ? midP.y : null,
      xFinalTrace: finP ? finP.x : null,
      hFinalTrace: finP ? finP.y : null,
      Mobj, Meye, Mprod, Mview, MviewTR, MviewPred, corrK, tanRaw, tanViewCF, tanViewTR,
      midShown: state.showMid && Math.abs(hMid) > MID_MIN
    };
  }

  /* ================= three.js 场景 ================= */
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, alpha: false, powerPreference: 'high-performance',
      // 自检要能读画布像素（drawImage 取回 GPU 结果）⇒ 保留绘制缓冲
      preserveDrawingBuffer: true
    });
  } catch (e) {
    $('stage').innerHTML = '<div style="padding:24px;color:#fff;line-height:1.7">' +
      '这个实验需要 WebGL 支持，当前浏览器无法创建 3D 场景。<br>请换用较新的 Chrome / Edge / Safari。</div>';
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#08131f');

  // 环境贴图：玻璃质感的镜片需要有东西可折，否则是一团黑。
  // 用一张 canvas 渐变当等距柱状环境图（不引外部 HDR），失败就退回纯半透明材质。
  let envTex = null;
  try {
    const ec = document.createElement('canvas'); ec.width = 256; ec.height = 128;
    const eg = ec.getContext('2d');
    const grd = eg.createLinearGradient(0, 0, 0, 128);
    grd.addColorStop(0, '#cfe8f7'); grd.addColorStop(.42, '#6d90ab');
    grd.addColorStop(.64, '#2b3d4d'); grd.addColorStop(1, '#101922');
    eg.fillStyle = grd; eg.fillRect(0, 0, 256, 128);
    eg.fillStyle = 'rgba(255,255,255,.95)';
    eg.beginPath(); eg.ellipse(64, 26, 38, 16, 0, 0, 7); eg.fill();
    eg.beginPath(); eg.ellipse(190, 42, 26, 11, 0, 0, 7); eg.fill();
    const etex = new THREE.CanvasTexture(ec);
    etex.mapping = THREE.EquirectangularReflectionMapping;
    etex.colorSpace = THREE.SRGBColorSpace;
    const pm = new THREE.PMREMGenerator(renderer);
    envTex = pm.fromEquirectangular(etex).texture;
    pm.dispose(); etex.dispose();
    scene.environment = envTex;
  } catch (err) { envTex = null; scene.environment = null; }

  const camera = new THREE.PerspectiveCamera(37, 1, 0.1, 12000);
  // 初值从唯一真源拷 —— 不在这里重写一遍数字（rebuildAll 每次都会重设，但初值也不许另写一份）
  const target = new THREE.Vector3(MODES.micro.target[0], MODES.micro.target[1], MODES.micro.target[2]);
  // 🔴 竖直视场固定 37°，横向视野 ∝ aspect ⇒ 视口越窄，横向越容易把东西挤出画外。
  //    以设计点纵横比 1.99 为基准，窄了就按比例加大机位半径，宽了不动。
  const ASPECT_REF = 1.99;

  scene.add(new THREE.HemisphereLight('#dff1fb', '#2b3946', 1.5));
  const keyL = new THREE.DirectionalLight('#fff6e8', 2.1); keyL.position.set(-30, 42, 36); scene.add(keyL);
  const fillL = new THREE.DirectionalLight('#bcd9ee', 1.0); fillL.position.set(32, -18, -26); scene.add(fillL);
  const rimL = new THREE.DirectionalLight('#8fd8f0', 1.2); rimL.position.set(24, 12, -30); scene.add(rimL);

  function mesh(geo, m, parent, x = 0, y = 0, z = 0) {
    const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); parent.add(o); return o;
  }

  /* --- 标签（canvas 贴图 Sprite） ---
     🔴 第三个参数是【字高】（世界单位 mm），不是宽度 —— 宽度由文字自己决定。
        画布固定 256 px 时，粗体 36 px 下超过 7 个汉字就装不下，
        而 fillText 是居中绘制 ⇒ 长标签【两侧各被裁掉半个字】。
        所以：画布按 measureText 实测宽度开，scale 再按画布比例算。 */
  const LABEL_FONT = 'bold 36px Inter, "PingFang SC", "Microsoft YaHei", sans-serif';
  const LABEL_PX_H = 64;
  const LABEL_GLYPH = 36;
  // 所有标签 Sprite 的登记表（供 updateLabelScales 每帧按相机距离归一化）。
  let labelSprites = [];
  const labelCtx = document.createElement('canvas').getContext('2d');
  function label(text, color = '#9fd8ea', glyphH = 1.3) {
    labelCtx.font = LABEL_FONT;
    const tw = Math.max(48, Math.ceil(labelCtx.measureText(text).width) + 16);
    const c = document.createElement('canvas'); c.width = tw; c.height = LABEL_PX_H;
    const g = c.getContext('2d');
    g.font = LABEL_FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = color;
    g.fillText(text, tw / 2, LABEL_PX_H / 2 + 1);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
    const H = glyphH * LABEL_PX_H / LABEL_GLYPH;   // sprite 世界高（基准，会被归一化改写）
    const W = H * tw / LABEL_PX_H;
    sp.scale.set(W, H, 1);
    sp.userData.baseW = W;                          // 基准尺寸：render 里按相机距离归一化时用
    sp.userData.baseH = H;
    sp.userData.text = text;                        // 供 labelBoxes() 自检点名
    sp.renderOrder = 20;                            // 标签永远压在最上层
    labelSprites.push(sp);
    return sp;
  }

  /* --- 材质 --- */
  const lensMat = new THREE.MeshPhysicalMaterial({
    color: '#dff2ff', metalness: 0, roughness: .10,
    transmission: envTex ? .82 : 0, thickness: 4.0, ior: 1.52,
    transparent: true, opacity: envTex ? .56 : .34,
    side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.35,
    clearcoat: 1, clearcoatRoughness: .06,
    emissive: new THREE.Color('#155066'), emissiveIntensity: .55
  });
  const tubeMat = new THREE.MeshPhysicalMaterial({
    color: '#8fa6b8', metalness: .55, roughness: .42,
    transparent: true, opacity: .16, side: THREE.DoubleSide,
    depthWrite: false, envMapIntensity: .9
  });
  const rimMat = new THREE.MeshStandardMaterial({
    color: '#9aa6b2', metalness: .7, roughness: .35,
    transparent: true, opacity: .55, depthWrite: false
  });

  /* --- 球面回转体（镜片共用）---
     剖面：x(r) = (apex + R) − R·√(1 − (r/R)²)，绕 x 轴旋转。 */
  function revolve(apex, R, aperture, rings, segs) {
    const verts = [], idx = [];
    for (let j = 0; j <= rings; j++) {
      const r = aperture * j / rings;
      const u = Math.min(.9999, r / Math.abs(R));
      const x = (apex + R) - R * Math.sqrt(1 - u * u);
      for (let i = 0; i <= segs; i++) {
        const a = i * 2 * Math.PI / segs;
        verts.push(x, r * Math.cos(a), r * Math.sin(a));
      }
    }
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < segs; i++) {
        const n = j * (segs + 1) + i, m = n + segs + 1;
        idx.push(n, m, n + 1, m, m + 1, n + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  // 由「半口径 a、矢高 s」反解球面半径：R = (a² + s²) / (2s)
  function sagRadius(a, s) { return (a * a + s * s) / (2 * s); }

  /* --- 场景容器 --- */
  const objGroup = new THREE.Group(); scene.add(objGroup);
  const lensGroup = new THREE.Group(); scene.add(lensGroup);
  const tubeGroup = new THREE.Group(); scene.add(tubeGroup);
  const rayGroup = new THREE.Group(); scene.add(rayGroup);
  const markGroup = new THREE.Group(); scene.add(markGroup);
  const axisGroup = new THREE.Group(); scene.add(axisGroup);

  function clearGroup(g) {
    while (g.children.length) {
      const c = g.children[0];
      g.remove(c);
      // 🔴 重建时必须显式释放：拖一次滑块就 rebuildAll 一次，
      //    标签的 CanvasTexture（一张 300×64）与细管几何不释放就是纯泄漏。
      //    ⚠️ Sprite 的 geometry 是 three.js 里的【全局共享单例】，绝不能 dispose。
      if (c.isSprite) {
        if (c.material) {
          if (c.material.map) c.material.map.dispose();
          c.material.dispose();
        }
      } else if (c.geometry && c.geometry.dispose) {
        c.geometry.dispose();
      }
    }
  }
  function addSeg(group, p1, p2, material) {
    const g = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    const l = new THREE.Line(g, material); group.add(l); return l;
  }

  /* --- 光线材质 ---
     🔴 WebGL 的 LineBasicMaterial.linewidth 在几乎所有平台都被忽略 ⇒ 光线恒为 1 物理像素。
        改用「细管」画：TubeGeometry + LineCurve3，半径给世界单位 ⇒ 任何 DPR 下都够粗。
        ⚠️ 但本页的场景尺度跨 100 倍（显微镜 ~100 mm、望远镜 ~900 mm），
        固定世界半径会让望远镜里的光线细到看不见 ⇒ 管半径按【场景尺度】定（见 rayRadius()）。 */
  const HAS_TUBE = typeof THREE.TubeGeometry === 'function' && typeof THREE.LineCurve3 === 'function';
  const tubeMatA = new THREE.MeshBasicMaterial({ color: '#fbbf24', transparent: true, opacity: .98, depthWrite: false });
  const tubeMatB = new THREE.MeshBasicMaterial({ color: '#22d3ee', transparent: true, opacity: .98, depthWrite: false });
  const tubeMatC = new THREE.MeshBasicMaterial({ color: '#a78bfa', transparent: true, opacity: .90, depthWrite: false });
  const lineMatA = new THREE.LineBasicMaterial({ color: '#fbbf24', transparent: true, opacity: .95 });
  const lineMatB = new THREE.LineBasicMaterial({ color: '#22d3ee', transparent: true, opacity: .95 });
  const lineMatC = new THREE.LineDashedMaterial({ color: '#a78bfa', transparent: true, opacity: .85,
    dashSize: 3.0, gapSize: 2.2, depthWrite: false });

  // 光线管半径与标签字高都按【相机取景半径】定 ⇒ 两种尺度（显微镜 ~100 mm / 望远镜 ~800 mm）
  // 在屏幕上是同一条粗细、同一个字号。实测：camR/420 的管 ≈ 2 CSS px，camR/480 的字高 ≈ 14 px。
  function rayRadius() { return modeOf().camR / 420; }
  function labelK() { return modeOf().camR / 480; }

  /* --- 主光轴（细虚线，贯穿整个场景） --- */
  function buildAxis() {
    clearGroup(axisGroup);
    const M = modeOf();
    const x0 = -M.camR * 0.9, x1 = M.camR * 0.9;
    const pts = [];
    for (let x = x0; x <= x1; x += (x1 - x0) / 120) pts.push(new THREE.Vector3(x, 0, 0));
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const m = new THREE.LineDashedMaterial({ color: '#4f6b80', transparent: true, opacity: .75,
      dashSize: M.camR / 60, gapSize: M.camR / 78, depthWrite: false });
    const l = new THREE.Line(g, m); l.computeLineDistances();
    l.renderOrder = 4;                       // 主光轴穿镜而过，压在镜片上才看得见
    axisGroup.add(l);
  }

  /* --- 建模：物体（一支向上的箭头） ---
     🔴 箭头的粗细必须【与它自己的高度成比例】，不能按场景尺度给固定值 ——
        显微镜的物体只有 1.5 mm、望远镜的有 20 mm，差 13 倍；
        按场景尺度给固定粗细会让显微镜那支细成一根发丝（实测：1.13 mm 宽，屏幕上 9 px）。 */
  function buildObject(o) {
    clearGroup(objGroup);
    const h = o.hObj, x = o.xObj;
    const k = labelK();
    arrow(objGroup, x, 0, h, '#fbbf24', false, 9);
    const lb = label('物体 ' + h.toFixed(1) + ' mm', '#fbbf24', 4.6 * k);
    lb.position.set(x, h + 14 * k, 0); objGroup.add(lb);
    const lbD = label('物距 u = ' + o.u1.toFixed(1) + ' mm', '#fcd34d', 3.8 * k);
    lbD.position.set(x + o.u1 / 2, -h * 0.55 - 11 * k, 0); objGroup.add(lbD);
    // 物距标注线
    const dimMat = new THREE.LineBasicMaterial({ color: '#fcd34d', transparent: true, opacity: .7, depthTest: false });
    const yD = -h * 0.55 - 6 * k;
    addSeg(objGroup, new THREE.Vector3(x, yD, 0), new THREE.Vector3(o.xObjLens, yD, 0), dimMat);
    return { x, h };
  }

  /* --- 建模：两片透镜 + 镜筒 + 眼睛 --- */
  function buildLenses(o) {
    clearGroup(lensGroup);
    clearGroup(tubeGroup);
    const M = modeOf();
    const k = labelK();                     // 标签字高 / 标注线偏移的统一尺度
    // 镜片中央厚度随焦距走：焦距越短、曲得越厉害、越厚
    const thickOf = (f) => clamp(1.5 + 0.018 * f, 1.5, 3.8);
    const makeLens = (x, dia, f, tag, col) => {
      const a = dia / 2;
      const t = thickOf(f);
      const edgeT = 0.28 * t;
      const sag = Math.max(.06, (t - edgeT) / 2);
      const R = sagRadius(a, sag);
      lensGroup.add(mesh(revolve(-t / 2, R, a, 12, 56), lensMat, lensGroup, x, 0, 0));
      lensGroup.add(mesh(revolve(t / 2, -R, a, 12, 56), lensMat, lensGroup, x, 0, 0));
      // 边缘侧壁：不加的话两片曲面在 r = a 处会露出一条缝
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(a, a, edgeT, 56, 1, true), rimMat);
      wall.rotation.z = Math.PI / 2;
      wall.position.set(x, 0, 0);
      wall.renderOrder = 3;
      lensGroup.add(wall);
      const lb = label(tag, col, 5.0 * k);
      lb.position.set(x, a + 12 * k, 0); lensGroup.add(lb);
      const lbF = label('f = ' + f.toFixed(1) + ' mm', col, 3.8 * k);
      lbF.position.set(x, a + 24 * k, 0); lensGroup.add(lbF);
      return { x, dia, t, R, a };
    };
    const obj = makeLens(o.xObjLens, M.lensObj.dia, o.fObj, '物镜', '#7dd3fc');
    const eye = makeLens(o.xEyeLens, M.lensEye.dia, o.fEye, '目镜', '#c4b5fd');

    // 镜筒：把两片透镜连起来的半透明圆柱
    if (state.showTube) {
      const len = Math.max(1e-3, o.d);
      const t = new THREE.Mesh(new THREE.CylinderGeometry(M.tubeDia / 2, M.tubeDia / 2, len, 44, 1, true), tubeMat);
      t.rotation.z = Math.PI / 2;
      t.position.set(o.xObjLens + len / 2, 0, 0);
      t.renderOrder = 2;
      tubeGroup.add(t);
      // 镜筒上刻一条「镜筒长度」的标注线
      const dimMat = new THREE.LineBasicMaterial({ color: '#94a3b8', transparent: true, opacity: .6, depthTest: false });
      const yD = -M.tubeDia / 2 - 8 * k;
      addSeg(tubeGroup, new THREE.Vector3(o.xObjLens, yD, 0), new THREE.Vector3(o.xEyeLens, yD, 0), dimMat);
      const lb = label('镜筒 ' + o.d.toFixed(1) + ' mm', '#cbd5e1', 3.8 * k);
      lb.position.set(o.xObjLens + o.d / 2, yD - 8 * k, 0); tubeGroup.add(lb);
    }

    // 眼睛（纯示意）：目镜后面一个环。
    // 🔴 它的大小必须【跟着目镜口径走】，不能跟着标签尺度走 ——
    //    否则显微镜里这个环（半径 2.7 mm）比目镜（半径 11 mm）还小，看着像个零件。
    // 🔴 眼睛环的【离目镜的距离】要受取景约束：原来取 1.3 个口径，显微镜把镜筒拉到
    //    最长（d = 87.5）时环落到 x = 116 mm，而取景右边界只有 ~105 mm
    //    ⇒ 环和「眼睛」标签被画布裁掉（实测 section 视角右溢出 102 px）。
    const rEye = M.lensEye.dia / 2 * 0.85;
    const xEyePos = o.xEyeLens + M.lensEye.dia * 0.85;
    const ringPts = [];
    for (let i = 0; i <= 48; i++) {
      const a = i / 48 * Math.PI * 2;
      ringPts.push(new THREE.Vector3(xEyePos, rEye * Math.cos(a), rEye * Math.sin(a)));
    }
    const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ringPts),
      new THREE.LineBasicMaterial({ color: '#93c5fd', transparent: true, opacity: .55, depthTest: false }));
    ring.renderOrder = 9; lensGroup.add(ring);
    const lbEye = label('眼睛', '#93c5fd', 4.4 * k);
    lbEye.position.set(xEyePos, rEye + 8 * k, 0); lensGroup.add(lbEye);

    return { obj, eye, xEyePos, rEye };
  }

  /* --- 建模：光路 --- */
  function buildRays(o) {
    clearGroup(rayGroup);
    if (!state.showRays) return [];
    const R = rayRadius();
    const tubeOf = { a: tubeMatA, b: tubeMatB, c: tubeMatC };
    const lineOf = { a: lineMatA, b: lineMatB, c: lineMatC };
    const seg = (p1, p2, kind) => {
      if (HAS_TUBE) {
        const m = new THREE.Mesh(
          new THREE.TubeGeometry(new THREE.LineCurve3(p1, p2), 1, R, 8, false), tubeOf[kind]);
        m.renderOrder = 6; rayGroup.add(m); return m;
      }
      const l = addSeg(rayGroup, p1, p2, lineOf[kind]);
      if (kind === 'c') l.computeLineDistances();
      l.renderOrder = 6; return l;
    };
    // 虚线延长：管没法用 dash，就一段段摆出来
    const segDash = (p1, p2, kind, dash, gap) => {
      const dir = new THREE.Vector3().subVectors(p2, p1);
      const len = dir.length();
      if (len < 1e-6) return;
      if (!HAS_TUBE) { seg(p1, p2, kind); return; }
      dir.normalize();
      let t = 0, guard = 0;
      const D = dash || R * 22, G = gap || R * 18;
      while (t < len && guard++ < 90) {
        const t2 = Math.min(len, t + D);
        seg(new THREE.Vector3().copy(p1).addScaledVector(dir, t),
            new THREE.Vector3().copy(p1).addScaledVector(dir, t2), kind);
        t = t2 + G;
      }
    };

    const out = [];
    const camR = modeOf().camR;
    const xEnd = o.xEyeLens + camR * 0.35;            // 出射光画到画面外一点
    for (const r of o.rays) {
      // 物 → 物镜（金色）；物镜 → 目镜（青色）
      seg(new THREE.Vector3(r.segs[0].x0, r.segs[0].y0, 0),
          new THREE.Vector3(r.segs[0].x1, r.segs[0].y1, 0), 'a');
      seg(new THREE.Vector3(r.segs[1].x0, r.segs[1].y0, 0),
          new THREE.Vector3(r.segs[1].x1, r.segs[1].y1, 0), 'b');
      // 目镜 → 出射（紫色实线）。成实像时只画到交点为止（光线真的在那里聚成一点），
      // 交点之后再画一段虚线表示「继续走下去会散开」。
      if (o.outSide === 'real' && Number.isFinite(o.xFinal) && o.xFinal > r.x) {
        const yF = r.y + r.s * (o.xFinal - r.x);
        seg(new THREE.Vector3(r.x, r.y, 0), new THREE.Vector3(o.xFinal, yF, 0), 'c');
        segDash(new THREE.Vector3(o.xFinal, yF, 0), new THREE.Vector3(xEnd, r.y + r.s * (xEnd - r.x), 0), 'c');
        out.push({ x0: r.x, y0: r.y, x1: o.xFinal, y1: yF, s: r.s, seg0: r.segs[0], seg1: r.segs[1] });
      } else {
        const yEnd = r.y + r.s * (xEnd - r.x);
        seg(new THREE.Vector3(r.x, r.y, 0), new THREE.Vector3(xEnd, yEnd, 0), 'c');
        out.push({ x0: r.x, y0: r.y, x1: xEnd, y1: yEnd, s: r.s, seg0: r.segs[0], seg1: r.segs[1] });
      }
      // 成虚像时：出射光线的【反向延长线】交于虚像，用虚线画出来
      if (o.outSide === 'virtual' && Number.isFinite(o.xFinal) && o.xFinal < r.x) {
        const yV = r.y + r.s * (o.xFinal - r.x);
        segDash(new THREE.Vector3(o.xEyeLens, r.y, 0),
                new THREE.Vector3(o.xFinal, yV, 0), 'c');
      }
    }
    return out;
  }

  /* --- 建模：中间像（物镜成的实像）+ 最终像 --- */
  // 一支「箭头」基元：杆 + 箭头尖。朝上 = 正立，朝下 = 倒立。
  function arrow(group, x, yFrom, yTo, color, dashed, order) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .96,
      depthWrite: false, depthTest: false });
    const len = Math.abs(yTo - yFrom);
    if (len < 1e-6) return;
    const dir = Math.sign(yTo - yFrom);
    // 🔴 粗细【与箭头自己的高度成比例】—— 显微镜的中间像 6 mm、望远镜的物体 20 mm，
    //    按场景尺度给固定粗细会让小箭头细成发丝（实测：1.13 mm 宽 / 屏幕 9 px，看不出是箭头）。
    const headL = 0.30 * len, headR = 0.22 * len, stemR = 0.085 * len;
    const stemLen = Math.max(1e-6, len - headL);
    const stem = mesh(new THREE.CylinderGeometry(stemR, stemR, stemLen, 10), mat,
      group, x, yFrom + dir * stemLen / 2, 0);
    stem.renderOrder = order;
    const head = mesh(new THREE.ConeGeometry(headR, headL, 14), mat, group, x, yTo - dir * headL / 2, 0);
    if (dir < 0) head.rotation.z = Math.PI;         // 箭头尖朝下
    head.renderOrder = order;
  }

  function buildMarks(o) {
    clearGroup(markGroup);
    const k = labelK();
    const M = modeOf();
    const out = { midShown: false, finalShown: false, midH: o.hMid, finalH: o.hFinal, finalInFrame: false };

    // 中间像：物镜成的实像（倒立）
    if (o.midShown) {
      arrow(markGroup, o.xMid, 0, o.hMid, '#fbbf24', false, 12);
      const lb = label('中间像 ' + Math.abs(o.hMid).toFixed(2) + ' mm', '#fbbf24', 4.6 * k);
      lb.position.set(o.xMid, o.hMid - 14 * k, 0); markGroup.add(lb);
      out.midShown = true;
    }

    // 最终像。🔴 虚像可能【远在画面之外】—— 例如「虚像拉到明视距离」时显微镜的虚像
    //    在目镜前 247 mm、高 65 mm，而整个显微镜画面只有 ~130 mm 宽。
    //    这种情况不能硬画（会拖出一根穿出画面的箭头，还会把取景包络算歪），
    //    改成在目镜旁给一条文字说明。判据用【相机取景包络】，不是「有没有值」。
    // 🔴 三条「最终像的文字说明」原来挂在 xEyeLens + camR * 0.30 上 —— 显微镜是 +29 mm 还行，
    //    望远镜是 +198 mm，标签直接被推出画布（实测俯视/剖面都溢出）。改成挂在【眼睛环上方】：
    //    xEyePos 与 rEye 一律从 buildLenses 的返回值取，绝不在这里把 0.85 再写一遍。
    const L = drawn.lenses || { xEyePos: o.xEyeLens + M.lensEye.dia * 0.85, rEye: M.lensEye.dia * 0.425 };
    // 🔴 挂点必须【同时躲开眼睛环和目镜自己的两个标签】：目镜的「f = … mm」标签顶边在
    //    a + 24k + 半个标签高，所以 y 要取「眼睛环上方」与「目镜 f 标签上方」两者的大者。
    //    实测：只写 rEye + 22k 时望远镜的说明正好压在「f = 30.0 mm」上（重叠 223 px² / 75%）。
    // ⚠️ 这个值不能再往上抬了：沿光轴视角里眼睛环离相机最近（depth ≈ refDist − 80），
    //    说明的屏幕偏移被放大 2.4 倍，抬 4 mm 就要多推远 5% 才不出画。
    const noteY = Math.max(L.rEye + 22 * k, M.lensEye.dia / 2 + 34 * k);
    const noteAt = (text, color) => {
      const lb = label(text, color, 4.6 * k);
      lb.position.set(L.xEyePos, noteY, 0);
      markGroup.add(lb);
    };
    if (state.showFinal) {
      const halfW = M.camR * 0.72, halfH = M.camR * 0.42;
      const fits = (x, h) => Number.isFinite(x) && Number.isFinite(h) &&
        Math.abs(x - M.target[0]) < halfW && Math.abs(h) < halfH;
      if (o.outSide === 'virtual' && Number.isFinite(o.xFinal) && Math.abs(o.hFinal) > MID_MIN) {
        if (fits(o.xFinal, o.hFinal)) {
          arrow(markGroup, o.xFinal, 0, o.hFinal, '#c4b5fd', true, 13);
          const lb = label('最终像（虚像）' + Math.abs(o.hFinal).toFixed(2) + ' mm', '#c4b5fd', 4.6 * k);
          lb.position.set(o.xFinal, o.hFinal + 12 * k, 0); markGroup.add(lb);
          out.finalShown = true; out.finalInFrame = true;
        } else {
          noteAt('虚像在目镜前 ' + Math.abs(o.v2).toFixed(0) + ' mm（超出画面）', '#c4b5fd');
          out.finalShown = true;
        }
      } else if (o.outSide === 'real') {
        if (fits(o.xFinal, o.hFinal)) {
          // 🔴 箭头照画（位置信息留给画面），但【文字说明挪到眼睛环上方那一处】。
          //    原来把文字挂在箭头旁边，而实像落在目镜【后面】：望远镜把镜筒拉到最长
          //    （d = 237）时像在 x = 300、眼睛环在 x = 266、目镜在 x = 237 —— 三者横向只差
          //    几十毫米，而这条标签有 13 个字（宽 88 px）⇒ 同时盖住「眼睛」（重叠 90.7%）
          //    和「目镜」（66.7%），三个视角全中，换仰角/推远都治不了。
          //    挪进说明区之后它与另外三条说明【互斥】（同一时刻只会有一条），撞车从根上消失。
          arrow(markGroup, o.xFinal, 0, o.hFinal, '#f472b6', false, 13);
          noteAt('目镜成实像（眼睛看不到）', '#f472b6');
          out.finalShown = true; out.finalInFrame = true;
        } else {
          noteAt('实像落在目镜后 ' + Math.abs(o.v2).toFixed(0) + ' mm（超出画面）', '#f472b6');
          out.finalShown = true;
        }
      } else {
        noteAt('出射平行光 ⇒ 像在无穷远', '#a5f3fc');
        out.finalShown = true;
      }
    }
    return out;
  }

  /* ================= 读数与 UI ================= */
  const MID_TEXT = { inner: '在目镜焦点以内', on: '恰在目镜焦平面上', outer: '落在目镜焦点以外' };
  const FINAL_TEXT = { virtual: '放大虚像', parallel: '像在无穷远（平行光）', real: '实像（看不了）' };

  function updateReadouts(o) {
    const micro = state.mode === 'micro';
    // 读数栏的两列含义按仪器切换：显微镜看「倍数」，望远镜看「焦距」
    $('lbMobj').textContent = micro ? '物镜倍数' : '物镜焦距';
    $('lbMeye').textContent = micro ? '目镜倍数' : '目镜焦距';
    $('roMobj').textContent = micro ? o.Mobj.toFixed(2) + ' ×' : o.fObj.toFixed(1) + ' mm';
    $('roMeye').textContent = micro ? o.Meye.toFixed(2) + ' ×' : o.fEye.toFixed(1) + ' mm';
    $('roMid').textContent = (o.midToFocus >= 0 ? '+' : '') + o.midToFocus.toFixed(1) + ' mm';
    $('roMid').className = o.midSide === 'on' ? 'ok' : (o.midSide === 'inner' ? 'hi' : 'warn');
    // 读数栏的「总放大倍数」给的是【教材口径】（显微镜 M物×M目 / 望远镜 f物÷f目）；
    // 实际视角放大率另有其数，只在一种工况下与它相等 —— 那个差写在视角对比面板里。
    $('lbTotal').textContent = micro ? '总放大倍数（物镜×目镜）' : '总放大倍数（f物 ÷ f目）';
    $('roTotal').textContent = o.Mprod.toFixed(2) + ' ×';
    $('roTotal').className = 'ok';
    $('roNote').textContent = o.midSide === 'inner'
      ? '中间像到目镜焦点为负 ⇒ 落在焦点以内，目镜当放大镜用'
      : (o.midSide === 'on'
        ? '中间像恰在目镜焦平面上 ⇒ 出射平行光，眼睛放松看无穷远'
        : '中间像落在目镜焦点以外 ⇒ 目镜成实像，眼睛看不到');

    $('metricMode').textContent = o.M.name;
    $('metricMid').textContent = MID_TEXT[o.midSide];
    $('metricMid').className = o.midSide === 'inner' ? 'good' : (o.midSide === 'on' ? '' : 'bad');
    $('metricTotal').textContent = o.Mprod.toFixed(1) + ' ×';
    $('metricFinal').textContent = FINAL_TEXT[o.outSide];
    $('metricFinal').className = o.outSide === 'real' ? 'bad' : '';

    $('fObjValue').textContent = o.fObj.toFixed(1) + ' mm';
    $('fEyeValue').textContent = o.fEye.toFixed(1) + ' mm';
    $('tubeValue').textContent = o.d.toFixed(1) + ' mm';
    $('modeNote').innerHTML = o.M.note;

    $('focusHead').textContent = o.midSide === 'inner'
      ? '中间像落在目镜焦点以内 ' + Math.abs(o.midToFocus).toFixed(1) + ' mm ⇒ 目镜成放大虚像'
      : (o.midSide === 'on'
        ? '中间像恰在目镜焦平面上 ⇒ 出射平行光'
        : '中间像落在目镜焦点以外 ' + o.midToFocus.toFixed(1) + ' mm ⇒ 目镜成实像');
  }

  // 中间像位置条：把 u2 / f目 ∈ [0, FOCUS_RATIO_MAX] 映射到整条，焦点恒在正中间
  function layoutFocusBar(o) {
    const track = $('focusTrack');
    const W = track.clientWidth || 1;
    const ratio = clamp(o.u2 / o.fEye, 0, FOCUS_RATIO_MAX);
    const markPct = ratio / FOCUS_RATIO_MAX * 100;
    $('focusMark').style.left = markPct + '%';
    $('focusMark').style.display = '';

    // 三个色区：焦点以内 / 恰在焦平面上（±FOCUS_TOL）/ 焦点以外
    const tol = FOCUS_TOL / o.fEye / FOCUS_RATIO_MAX;
    const lo = (1 / FOCUS_RATIO_MAX - tol) * 100;
    const hi = (1 / FOCUS_RATIO_MAX + tol) * 100;
    $('focusIn').style.left = '0%'; $('focusIn').style.width = lo + '%';
    $('focusOn').style.left = lo + '%'; $('focusOn').style.width = (hi - lo) + '%';
    $('focusOut').style.left = hi + '%'; $('focusOut').style.width = (100 - hi) + '%';
    $('focusIn').style.display = lo > 0.5 ? '' : 'none';
    $('focusOn').style.display = (hi - lo) > 0.5 ? '' : 'none';
    $('focusOut').style.display = (100 - hi) > 0.5 ? '' : 'none';
    $('scaleNear').style.left = '0%';
    $('scaleZero').style.left = (100 / FOCUS_RATIO_MAX) + '%';
    $('scaleFar').style.left = '100%';
    return { W, markPct, lo, hi, ratio };
  }

  // 视角对比：两条楔形 = 直接看的张角 / 用仪器看的张角（同一比例）
  function layoutViewAngle(o) {
    const maxTan = Math.max(o.tanRaw, o.tanViewCF);
    const kRaw = clamp(o.tanRaw / maxTan * 0.9, 0.06, 1);
    const kScope = clamp(o.tanViewCF / maxTan * 0.9, 0.06, 1);
    $('vaWedgeRaw').style.transform = 'scaleY(' + kRaw.toFixed(4) + ')';
    $('vaWedgeScope').style.transform = 'scaleY(' + kScope.toFixed(4) + ')';
    const deg = (t) => (Math.atan(t) * 180 / Math.PI).toFixed(2) + '°';
    $('vaRaw').textContent = deg(o.tanRaw);
    $('vaScope').textContent = deg(o.tanViewCF);
    const micro = state.mode === 'micro';
    const base = micro ? '物体放在明视距离 250 mm 处' : '物体就在 ' + (o.u1 / 10).toFixed(0) + ' cm 处';
    const eq = micro ? 'M物 × M目' : 'f物 ÷ f目';
    // 🔴 两个口径【只在一种工况下相等】，而且是【只对显微镜】成立：
    //    显微镜  Mview / Mprod = f目 / u2                ⇒ u2 = f目 时相等
    //    望远镜  Mview / Mprod = corrK · f目 / u2         ⇒ 还要 corrK = 1，即物体在无限远
    //    望远镜这一条必须说清，否则「实际 6 倍 / 教材 4 倍」看着像算错了。
    let tail;
    if (micro && o.midSide === 'on') {
      tail = ' 此时中间像恰在目镜焦平面上，教材口径 ' + eq + ' = <b>' + o.Mprod.toFixed(1) +
        ' 倍</b>，与实际视角放大率一致。';
    } else if (micro) {
      tail = ' 此时中间像离目镜焦点还有 ' + Math.abs(o.midToFocus).toFixed(1) +
        ' mm，实际视角放大率是教材口径 ' + eq + ' = ' + o.Mprod.toFixed(1) +
        ' 倍 的 <b>f目 / u2 = ' + (o.fEye / o.u2).toFixed(2) + ' 倍</b>。';
    } else if (o.midSide === 'on') {
      tail = ' 教材口径 ' + eq + ' = <b>' + o.Mprod.toFixed(1) + ' 倍</b>。但物体不在无限远（u₁ = ' +
        (o.u1 / o.fObj).toFixed(1) + ' f物），实际视角放大率还要乘 u₁/(u₁−f物) = ' +
        o.corrK.toFixed(2) + ' ⇒ <b>' + o.Mview.toFixed(1) + ' 倍</b>；物体越远两者越接近。';
    } else {
      tail = ' 教材口径 ' + eq + ' = ' + o.Mprod.toFixed(1) + ' 倍；实际视角放大率 = 教材口径 × u₁/(u₁−f物) × f目/u₂ = ' +
        o.Mprod.toFixed(1) + ' × ' + o.corrK.toFixed(2) + ' × ' + (o.fEye / o.u2).toFixed(2) +
        ' = <b>' + o.Mview.toFixed(1) + ' 倍</b>。';
    }
    $('vaNote').innerHTML = '直接看（' + base + '）张角 <b>' + deg(o.tanRaw) + '</b>；' +
      '用仪器看张角 <b>' + deg(o.tanViewCF) + '</b> ⇒ 实际视角放大 <b>' + o.Mview.toFixed(1) + ' 倍</b>。' + tail;
    return { kRaw, kScope, tanRaw: o.tanRaw, tanView: o.tanViewCF, ratio: o.Mview, Mprod: o.Mprod };
  }

  function describe(o) {
    const name = o.M.name;
    let txt = '<b>' + name + '：</b>物距 ' + o.u1.toFixed(1) + ' mm';
    txt += state.mode === 'micro' ? '（f &lt; u &lt; 2f）' : '（u &gt; 2f）';
    txt += ' ⇒ 物镜成' + (Math.abs(o.m1) > 1 ? '<b>放大</b>' : '<b>缩小</b>') +
      '倒立实像，高度 ' + Math.abs(o.hMid).toFixed(2) + ' mm。';
    const eq = state.mode === 'micro' ? 'M物 × M目' : 'f物 ÷ f目';
    if (o.midSide === 'inner') {
      txt += '这个实像落在目镜焦点<b>以内</b>，目镜当放大镜用，成一个 <b>' +
        o.Mprod.toFixed(1) + ' 倍</b>（' + eq + '）的放大虚像。';
    } else if (o.midSide === 'on') {
      txt += '这个实像恰落在目镜<b>焦平面上</b>，目镜射出<b>平行光</b>，眼睛放松看无穷远，放大 ' +
        o.Mprod.toFixed(1) + ' 倍（' + eq + '）。';
    } else {
      txt += '这个实像落在目镜焦点<b>以外</b>，目镜会成一个实像 —— 眼睛贴在目镜后面反而看不到，得把镜筒缩短。';
    }
    return txt;
  }

  /* ================= 渲染 ================= */
  // 相机到 target 的【基准】距离（不含用户缩放 state.zoom）。
  // 🔴 唯一真源：cameraPosition() 与 updateLabelScales() 都从这里取，
  //    否则「标签归一化按哪个距离算」会变成第二份写死的几何。
  function camDistRef() {
    const aspect = Math.max(0.2, camera.aspect);
    return modeOf().camR * Math.max(1, ASPECT_REF / aspect);
  }
  function cameraPosition() {
    const r = camDistRef() / state.zoom;
    camera.position.set(
      target.x + r * Math.sin(state.yaw) * Math.cos(state.pitch),
      target.y + r * Math.sin(state.pitch),
      target.z + r * Math.cos(state.yaw) * Math.cos(state.pitch)
    );
    camera.lookAt(target);
  }
  /* 标签屏幕尺寸归一化。
     🔴 为什么必须做：Sprite 的世界尺寸固定 ⇒ 屏幕高度 ∝ 1/相机到该标签的距离。
        于是「俯视」视角为了把横向排开的十个标签装进画布把相机推远（VIEW_ZOOM.top = 0.72），
        标签就跟着缩到 6.1 px —— 同一张图上「剖面」视角却有 12 px。于是
        「标签看得清（≥ 8 px）」这条判据【在俯视里根本不成立】，而它当时只对
        剖面/透视两个工况查过 ⇒ 覆盖黑洞。
        修法：每帧渲染前把 scale 乘上 d / refDist，使
            屏幕高度 = glyphH × (LABEL_PX_H/LABEL_GLYPH) × (state.h/2) / (tan(fov/2) · refDist)
        与视角、与仪器（camR 在式子两端约掉）、与标签在场景里的位置都无关，
        只由标签自己的字高系数决定。refDist 取基准距离 ⇒ 剖面/透视视角观感不变。
     ⚠️ 剩下的唯一依赖是【画布高度 state.h】：标签是跟着画布尺寸缩放的（设计如此），
        所以在很窄的窗口里会同比变小。H 组的「看得清」判据因此写明是在 1280×900 下量的。 */
  const _lp = new THREE.Vector3();
  function updateLabelScales() {
    if (labelSprites.length > 96) labelSprites = labelSprites.filter((s) => s.parent);
    const refDist = camDistRef();
    if (!(refDist > 1e-6)) return;
    for (const sp of labelSprites) {
      if (!sp.parent) continue;                     // 已被 clearGroup 摘掉的旧标签不再管
      const d = camera.position.distanceTo(sp.getWorldPosition(_lp));
      const f = Math.max(1e-3, d / refDist);
      sp.scale.set(sp.userData.baseW * f, sp.userData.baseH * f, 1);
    }
  }
  function resize() {
    const el = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(el.width)), h = Math.max(1, Math.round(el.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    state.w = w; state.h = h; state.dpr = dpr;
  }
  function render() {
    resize();
    cameraPosition();
    scene.updateMatrixWorld(true);   // 归一化要读标签的世界位置，先让矩阵跟上
    updateLabelScales();
    renderer.render(scene, camera);
  }

  const drawn = { object: null, lenses: null, rays: [], marks: null, optics: null };

  function rebuildAll() {
    const o = optics();
    drawn.optics = o;
    target.set(modeOf().target[0], modeOf().target[1], modeOf().target[2]);
    buildAxis();
    drawn.object = buildObject(o);
    drawn.lenses = buildLenses(o);
    drawn.rays = buildRays(o);
    drawn.marks = buildMarks(o);
    updateReadouts(o);
    layoutFocusBar(o);
    layoutViewAngle(o);
    $('finding').innerHTML = describe(o);
    render();
  }

  /* ================= 像素统计（供自检） ================= */
  // 把世界坐标的一个长方体投到画布像素，取回像素后降采样成 cols×rows 的【块平均】签名。
  // 🔴 判「某物真的画出来了」必须用【差分】（开关前后签名里变化格占比），不要用颜色匹配 ——
  //    本页开着 ACES 色调映射，材质色到了画布上已经不是原色。
  function regionSignature(box, cols) {
    const zs = box.zs || [box.z === undefined ? 0 : box.z];
    const corners = [];
    for (const x of [box.x0, box.x1]) for (const y of [box.y0, box.y1]) for (const z of zs)
      corners.push(new THREE.Vector3(x, y, z));
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const c of corners) {
      const v = c.clone().project(camera);
      const px = (v.x * .5 + .5) * state.w, py = (-v.y * .5 + .5) * state.h;
      x0 = Math.min(x0, px); x1 = Math.max(x1, px);
      y0 = Math.min(y0, py); y1 = Math.max(y1, py);
    }
    const cw = canvas.width, ch = canvas.height;
    const sx = cw / Math.max(1, state.w), sy = ch / Math.max(1, state.h);
    const rx = clamp(Math.round(x0 * sx), 0, cw - 1), ry = clamp(Math.round(y0 * sy), 0, ch - 1);
    const rw = clamp(Math.round((x1 - x0) * sx), 1, cw - rx), rh = clamp(Math.round((y1 - y0) * sy), 1, ch - ry);
    const c2 = document.createElement('canvas');
    // 🔴 取像素必须【在 drawImage 里降采样】：缩到 ≤120 px 宽再 getImageData，
    //    像素数从 ~2 000 000 降到 ~7 000 —— 负向对照要对全量断言重跑几十次，
    //    不降采样的话单次取像素就要 1~2 s，整套跑不动。
    const dsc = Math.min(1, 120 / Math.max(1, rw));
    c2.width = Math.max(1, Math.round(rw * dsc)); c2.height = Math.max(1, Math.round(rh * dsc));
    const g2 = c2.getContext('2d');
    g2.drawImage(canvas, rx, ry, rw, rh, 0, 0, c2.width, c2.height);
    const d = g2.getImageData(0, 0, c2.width, c2.height).data;
    const N = c2.width * c2.height;
    let sum = 0, sum2 = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
      sum += l; sum2 += l * l;
    }
    const mean = sum / N;
    const C = Math.max(2, cols || 10);
    const R = Math.max(2, Math.round(C * c2.height / Math.max(1, c2.width)));
    const blk = new Array(C * R).fill(0), cnt = new Array(C * R).fill(0);
    for (let y = 0; y < c2.height; y++) {
      const by = Math.min(R - 1, Math.floor(y * R / c2.height));
      for (let x = 0; x < c2.width; x++) {
        const bx = Math.min(C - 1, Math.floor(x * C / c2.width));
        const i = (y * c2.width + x) * 4;
        blk[by * C + bx] += (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
        cnt[by * C + bx]++;
      }
    }
    for (let k = 0; k < blk.length; k++) blk[k] = cnt[k] ? blk[k] / cnt[k] : 0;
    return { present: true, rect: { x: rx, y: ry, w: c2.width, h: c2.height },
             n: N, mean, std: Math.sqrt(Math.max(0, sum2 / N - mean * mean)),
             cols: C, rows: R, blocks: blk };
  }

  // 中间像附近的取样盒。🔴 盒子必须【紧贴中间像】——
  //    早先按整个镜筒取盒，中间像只占其中几个百分点 ⇒ 开关前后「变化格占比」被稀释到判红。
  //    盒子按中间像的【特征尺寸 |hMid|】定：宽 = 0.6|h|（箭头尖宽 0.44|h| 刚好装得下），
  //    高 = |h| + 0.36|h|（含箭头根部一点余量）。标签刻意放在盒子【外面】，
  //    这样断言量的是「那支箭头画没画出来」，而不是「那个标签在不在」。
  function midImageBox(scale) {
    const o = optics();
    const k = Math.max(Math.abs(o.hMid), modeOf().camR / 90);
    const s = scale || 1;
    const y0 = Math.min(0, o.hMid), y1 = Math.max(0, o.hMid);
    return { x0: o.xMid - 0.30 * k * s, x1: o.xMid + 0.30 * k * s,
             y0: y0 - 0.18 * k * s, y1: y1 + 0.18 * k * s, z: 0 };
  }

  /* ================= 交互：相机 ================= */
  let dragging = false, prev = null;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true; prev = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    state.yaw += (e.clientX - prev.x) * .006;
    state.pitch = clamp(state.pitch + (e.clientY - prev.y) * .005, -1.35, 1.35);
    prev = { x: e.clientX, y: e.clientY };
    render();
  });
  const endDrag = (e) => {
    dragging = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* 指针已释放 */ }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    state.zoom = clamp(state.zoom * (e.deltaY > 0 ? .93 : 1.075), .45, 3.4);
    render();
  }, { passive: false });
  canvas.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? .22 : .09;
    if (e.key === 'ArrowLeft') state.yaw -= step;
    else if (e.key === 'ArrowRight') state.yaw += step;
    else if (e.key === 'ArrowUp') state.pitch = clamp(state.pitch + step, -1.35, 1.35);
    else if (e.key === 'ArrowDown') state.pitch = clamp(state.pitch - step, -1.35, 1.35);
    else if (e.key === '+' || e.key === '=') state.zoom = clamp(state.zoom * 1.1, .45, 3.4);
    else if (e.key === '-') state.zoom = clamp(state.zoom / 1.1, .45, 3.4);
    else return;
    e.preventDefault(); render();
  });

  function applyView(name) {
    const v = VIEWS[name]; if (!v) return false;
    const n = new THREE.Vector3(v[0], v[1], v[2]).normalize();
    state.yaw = Math.atan2(n.x, n.z);
    state.pitch = Math.asin(clamp(n.y, -1, 1));
    state.zoom = VIEW_ZOOM[name] || 1;
    state.view = name;
    syncViewButtons(name);
    return true;
  }
  function syncViewButtons(name) {
    document.querySelectorAll('.toolbar button[data-view]').forEach((b) =>
      b.classList.toggle('active', b.dataset.view === name));
  }
  document.querySelectorAll('.toolbar button[data-view]').forEach((b) => {
    b.addEventListener('click', () => { applyView(b.dataset.view); render(); });
  });
  $('resetView').addEventListener('click', () => { applyView('perspective'); render(); });

  /* ================= 交互：控件 ================= */
  // 镜筒长度滑块的范围随参数变：u2 / f目 ∈ [0.08, FOCUS_RATIO_MAX] 换算回 d = v1 + u2
  function tubeRange(fObj, fEye) {
    const v1 = imgDist(objDistOf(state.mode, fObj), fObj);
    return { min: v1 + 0.08 * fEye, max: v1 + FOCUS_RATIO_MAX * fEye, v1 };
  }
  function syncRangeInputs() {
    const M = modeOf(), p = cur();
    const fO = $('fObj'), fE = $('fEye'), tL = $('tubeLen');
    fO.min = M.fObjMin; fO.max = M.fObjMax; fO.step = M.fObjStep; fO.value = p.fObj;
    fE.min = M.fEyeMin; fE.max = M.fEyeMax; fE.step = M.fEyeStep; fE.value = p.fEye;
    const R = tubeRange(p.fObj, p.fEye);
    tL.min = R.min.toFixed(2); tL.max = R.max.toFixed(2); tL.step = 0.5; tL.value = p.d;
  }
  // 把镜筒长度设到「中间像恰在目镜焦平面上」（u2 = f目 ⇒ 出射平行光）
  function focusParallel() {
    const p = cur();
    const v1 = imgDist(objDistOf(state.mode, p.fObj), p.fObj);
    p.d = v1 + p.fEye;
    syncRangeInputs(); rebuildAll();
  }
  // 把镜筒长度设到「中间像落在目镜焦点以内」（u2 = 0.5 f目 ⇒ 目镜成放大虚像）
  function focusInside() {
    const p = cur();
    const v1 = imgDist(objDistOf(state.mode, p.fObj), p.fObj);
    p.d = v1 + 0.5 * p.fEye;
    syncRangeInputs(); rebuildAll();
  }
  // 把镜筒长度设到「最终虚像落在明视距离 250 mm 处」（眼睛正常调节）
  function focusNearPoint() {
    const p = cur();
    const v1 = imgDist(objDistOf(state.mode, p.fObj), p.fObj);
    const u2 = D_NEAR * p.fEye / (D_NEAR + p.fEye);   // 由 |v2| = D_NEAR 反解
    p.d = v1 + u2;
    syncRangeInputs(); rebuildAll();
  }
  function syncModeButtons() {
    document.querySelectorAll('#modeSeg button').forEach((b) =>
      b.classList.toggle('active', b.dataset.mode === state.mode));
  }
  function setMode(key) {
    if (!MODES[key]) return false;
    state.mode = key;
    syncModeButtons();
    syncRangeInputs();
    applyView('perspective');
    rebuildAll();
    return true;
  }
  function setFObj(v) {
    const M = modeOf(), p = cur();
    const nv = clamp(v, M.fObjMin, M.fObjMax);
    const R0 = tubeRange(p.fObj, p.fEye);
    const u2 = p.d - R0.v1;                    // 保持「中间像到目镜的距离」不变
    p.fObj = nv;
    const R1 = tubeRange(nv, p.fEye);
    p.d = clamp(R1.v1 + u2, R1.min, R1.max);
    syncRangeInputs(); rebuildAll();
  }
  function setFEye(v) {
    const M = modeOf(), p = cur();
    const nv = clamp(v, M.fEyeMin, M.fEyeMax);
    const R0 = tubeRange(p.fObj, p.fEye);
    const r2 = (p.d - R0.v1) / p.fEye;         // 保持 u2 / f目 不变
    p.fEye = nv;
    const R1 = tubeRange(p.fObj, nv);
    p.d = clamp(R1.v1 + r2 * nv, R1.min, R1.max);
    syncRangeInputs(); rebuildAll();
  }
  function setTube(v) {
    const p = cur(), R = tubeRange(p.fObj, p.fEye);
    p.d = clamp(v, R.min, R.max);
    $('tubeLen').value = p.d;
    rebuildAll();
  }
  function setToggle(id, on) {
    state[id] = !!on;
    const el = $(id); if (el) el.checked = state[id];
    rebuildAll();
  }

  document.querySelectorAll('#modeSeg button').forEach((b) =>
    b.addEventListener('click', () => setMode(b.dataset.mode)));
  $('fObj').addEventListener('input', (e) => setFObj(parseFloat(e.target.value)));
  $('fEye').addEventListener('input', (e) => setFEye(parseFloat(e.target.value)));
  $('tubeLen').addEventListener('input', (e) => setTube(parseFloat(e.target.value)));
  $('focusParallelBtn').addEventListener('click', focusParallel);
  $('focusInsideBtn') && $('focusInsideBtn').addEventListener('click', focusInside);
  $('focusNearBtn').addEventListener('click', focusNearPoint);
  $('stageFocusBtn').addEventListener('click', focusParallel);
  ['showRays', 'showMid', 'showFinal', 'showTube'].forEach((id) => {
    $(id).addEventListener('change', (e) => setToggle(id, e.target.checked));
  });

  /* ================= 记录表 ================= */
  function bandText(u1, fObj) {
    if (u1 > 2 * fObj) return 'u > 2f（远处物体）';
    if (u1 > fObj) return 'f < u < 2f（贴近物体）';
    return 'u < f（不成实像）';
  }
  function pushRecord() {
    const o = optics();
    const row = {
      mode: o.M.name,
      u1: o.u1,
      band: bandText(o.u1, o.fObj),
      midH: Math.abs(o.hMid),
      midBig: Math.abs(o.m1) > 1 ? '放大倒立实像' : '缩小倒立实像',
      toFocus: o.midToFocus,
      midSide: MID_TEXT[o.midSide],
      out: FINAL_TEXT[o.outSide],
      total: o.Mprod,
      view: o.Mview
    };
    state.records.push(row);
    if (state.records.length > 6) state.records.shift();
    renderRecords(row);
  }
  function renderRecords(flashRow) {
    const tb = $('records');
    if (!state.records.length) {
      tb.innerHTML = '<tr><td colspan="8" class="empty">尚无记录，先选一种仪器再点「记录当前数据」</td></tr>';
      $('summary').textContent = '记录两行以上，就能看出「物距区间 → 物镜成什么像 → 目镜怎么用」的对应关系。';
      return;
    }
    tb.innerHTML = state.records.map((r, i) => {
      const cls = (flashRow === r ? 'filled flash' : 'filled');
      const f = (x, d) => (x >= 0 ? '+' : '') + x.toFixed(d);
      return '<tr class="' + cls + '"><td>' + (i + 1) + '</td><td>' + r.mode + '</td><td>' +
        r.u1.toFixed(1) + '</td><td>' + r.band + '</td><td>' + r.midBig + '（' + r.midH.toFixed(2) +
        ' mm）</td><td>' + f(r.toFocus, 1) + '</td><td>' + r.out + '</td><td>' + r.total.toFixed(1) + ' ×</td></tr>';
    }).join('');
    $('summary').textContent = '已记录 ' + state.records.length + ' 组。';
  }
  function recordNow() { pushRecord(); }
  function recordAll() {
    const saved = state.mode;
    for (const k of Object.keys(MODES)) {
      state.mode = k;
      focusParallel();
      pushRecord();
    }
    state.mode = saved;
    syncModeButtons(); syncRangeInputs(); rebuildAll();
  }
  $('recordBtn').addEventListener('click', recordNow);
  $('recordBtn2').addEventListener('click', recordNow);
  $('stageRecordBtn').addEventListener('click', recordNow);
  $('recordAllBtn').addEventListener('click', recordAll);
  $('recordAllBtn2').addEventListener('click', recordAll);
  $('clearRecords').addEventListener('click', () => { state.records = []; renderRecords(); });

  $('resetAll').addEventListener('click', () => {
    state.params.micro = { fObj: MODES.micro.fObj, fEye: MODES.micro.fEye,
                           d: imgDist(objDistOf('micro', MODES.micro.fObj), MODES.micro.fObj) + MODES.micro.fEye };
    state.params.tele = { fObj: MODES.tele.fObj, fEye: MODES.tele.fEye,
                          d: imgDist(objDistOf('tele', MODES.tele.fObj), MODES.tele.fObj) + MODES.tele.fEye };
    state.showRays = true; state.showMid = true; state.showFinal = true; state.showTube = true;
    ['showRays', 'showMid', 'showFinal', 'showTube'].forEach((id) => { $(id).checked = true; });
    state.mode = 'micro';
    syncModeButtons();
    syncRangeInputs();
    applyView('perspective');
    rebuildAll();
  });

  let rt = null;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { if (!dragging) { layoutFocusBar(drawn.optics || optics()); render(); } }, 120);
  });

  /* ================= 自检钩子 =================
     暴露页面【真正用到的】那份几何与判定。会变的量一律写成 get 访问器。 */
  window.__microLab = {
    state, MODES, VIEWS, VIEW_ORDER, VIEW_ZOOM, D_NEAR, RAY_N, FOCUS_TOL, MID_MIN, FOCUS_RATIO_MAX,
    HAS_TUBE,
    rayKind: () => (HAS_TUBE ? 'tube' : 'line'),
    rayRadius: () => rayRadius(),
    get mode() { return state.mode; },
    get params() { return cur(); },
    get optics() { return optics(); },
    get drawn() { return drawn; },
    get records() { return state.records.slice(); },
    get camR() { return modeOf().camR; },
    get target() { return [target.x, target.y, target.z]; },
    objDistOf: (mode, fObj) => objDistOf(mode, fObj),
    imgDist: (u, f) => imgDist(u, f),
    // 物镜上的取样高度（含渐晕截断）：给参数直接算，供「截断到底有没有生效」的断言用
    raySampleHeight: (mode, fObj, u1, d, hObj) => {
      const M = MODES[mode];
      const h = hObj === undefined ? M.hObj : hObj;
      return raySampleHeight(fObj, u1, d, h, M);
    },
    rayApObjMax: (mode) => MODES[mode].lensObj.ap * 0.88,
    tubeRange: (mode, fObj, fEye) => {
      const saved = state.mode; state.mode = mode;
      const R = tubeRange(fObj, fEye); state.mode = saved; return R;
    },
    // 闭式路径：直接给一组参数算，不读 state
    closedForm: (mode, fObj, fEye, u1, d, hObj) => {
      const M = MODES[mode];
      const h = hObj === undefined ? M.hObj : hObj;
      const v1 = imgDist(u1, fObj);
      const m1 = v1 / u1, hMid = -m1 * h;
      const u2 = d - v1, v2 = imgDist(u2, fEye);
      const m2 = Number.isFinite(v2) ? v2 / u2 : Infinity;
      const hFinal = Number.isFinite(m2) ? -m2 * hMid : NaN;
      return { v1, xMid: v1, m1, hMid, u2, v2, xFinal: d + v2, m2, hFinal,
               midToFocus: u2 - fEye };
    },
    // 数值追迹路径：直接给一组参数算
    traceRays: (mode, fObj, fEye, u1, d, hObj, rayN) => {
      const M = MODES[mode];
      const h = hObj === undefined ? M.hObj : hObj;
      const n = rayN || RAY_N;
      const lenses = [{ x: 0, f: fObj }, { x: d, f: fEye }];
      const xObj = -u1;
      // 与 optics() 走【同一个】取样高度函数（含渐晕截断），否则两条路径的光线束不同
      const hRay = raySampleHeight(fObj, u1, d, h, M);
      const rays = [];
      for (let i = 0; i < n; i++) {
        const yL = n === 1 ? 0 : hRay * ((i / (n - 1)) * 2 - 1);
        rays.push(traceThin(xObj, h, (yL - h) / u1, lenses));
      }
      const A = rays[0], B = rays[rays.length - 1];
      const sA = (A.segs[1].y1 - A.segs[1].y0) / (A.segs[1].x1 - A.segs[1].x0);
      const sB = (B.segs[1].y1 - B.segs[1].y0) / (B.segs[1].x1 - B.segs[1].x0);
      const mid = meetLines({ x: 0, y: A.segs[1].y0, s: sA }, { x: 0, y: B.segs[1].y0, s: sB });
      const fin = meetLines({ x: d, y: A.y, s: A.s }, { x: d, y: B.y, s: B.s });
      // 主光线 = 瞄准物镜【光心】的那条（yL = 0）；RAY_N 是奇数 ⇒ 中间那条就是它。
      // 它在目镜处的高度必须等于手写的 h物 · d / u1 —— 两条互不引用的路径。
      const midIdx = (n - 1) / 2;
      return {
        xMid: mid ? mid.x : null, hMid: mid ? mid.y : null,
        xFinal: fin ? fin.x : null, hFinal: fin ? fin.y : null,
        hRay,
        chiefAtEye: n % 2 === 1 ? Math.abs(rays[midIdx].y) : null,
        outSlope: A.s, ends: rays.map((r) => ({ x: r.x, y: r.y, s: r.s }))
      };
    },
    // 实际视角放大率（追迹口径）：给参数直接算，供与闭式口径对照
    // 给参数直接算（自检扫参数空间用）。公式【全部走 magOf】—— 不再自己抄一份，
    // 否则「改渲染那份」的变异抓不住（M11~M14 全绿就是这么来的）。
    viewMag: (mode, fObj, fEye, u1, d, hObj) => {
      const M = MODES[mode];
      const h = hObj === undefined ? M.hObj : hObj;
      const v1 = imgDist(u1, fObj), m1 = v1 / u1;
      const u2 = d - v1, v2 = imgDist(u2, fEye);
      const hFinal = Number.isFinite(v2) ? (v2 / u2) * m1 * h : NaN;
      return magOf(mode, fObj, fEye, u1, d, h, m1, v2, hFinal, null);
    },
    setMode: (k) => setMode(k),
    setFObj: (v) => setFObj(v),
    setFEye: (v) => setFEye(v),
    setTube: (v) => setTube(v),
    focusParallel: () => focusParallel(),
    focusInside: () => focusInside(),
    focusNearPoint: () => focusNearPoint(),
    setToggle: (id, on) => setToggle(id, on),
    setView: (name) => { if (applyView(name)) render(); },
    recordNow, recordAll,
    clearRecords: () => { state.records = []; renderRecords(); },
    render, rebuildAll,
    size: () => ({ w: state.w, h: state.h, dpr: state.dpr }),
    // 取景探针：把内容包络投到 NDC（用途：调 camR / 断言内容不出画）
    frameProbe: (pts) => {
      const list = pts || (() => {
        const M = modeOf(), o = optics();
        const out = [];
        for (const x of [o.xObj - 8, o.xEyeLens + 8]) for (const y of [-M.hObj * 0.8, M.hObj * 0.8])
          for (const z of [-M.tubeDia / 2, M.tubeDia / 2]) out.push([x, y, z]);
        return out;
      })();
      return list.map(([x, y, z]) => {
        const v = new THREE.Vector3(x, y, z).project(camera);
        return { x: +v.x.toFixed(4), y: +v.y.toFixed(4) };
      });
    },
    focusBar: () => {
      const el = (id) => {
        const e = $(id);
        return { left: parseFloat(e.style.left) || 0, width: parseFloat(e.style.width) || 0,
                 display: e.style.display };
      };
      return { inner: el('focusIn'), on: el('focusOn'), outer: el('focusOut'),
               mark: parseFloat($('focusMark').style.left) || 0,
               trackW: $('focusTrack').clientWidth || 0,
               ratioMax: FOCUS_RATIO_MAX, focusTol: FOCUS_TOL };
    },
    viewAngle: () => ({
      kRaw: parseFloat(($('vaWedgeRaw').style.transform.match(/scaleY\(([\d.]+)\)/) || [])[1]) || 0,
      kScope: parseFloat(($('vaWedgeScope').style.transform.match(/scaleY\(([\d.]+)\)/) || [])[1]) || 0,
      rawText: $('vaRaw').textContent, scopeText: $('vaScope').textContent,
      note: $('vaNote').textContent
    }),
    regionSignature: (box, cols) => regionSignature(box, cols),
    midImageBox: (scale) => midImageBox(scale),
    // 「中间像到底有没有画出来」的差分判据：开关中间像前后，它附近取样盒的块平均变化格占比。
    // 🔴 取样盒按中间像的【特征尺寸】定（见 midImageBox），不按镜筒定 —— 否则信号被稀释。
    // 🔴 探针的盒子走【物理量独立算】，绝不读 drawn.marks（否则改小箭头会把盒子一起改小，
    //    断言退化成自指恒等式：量的是「那个小东西变没变」，不是「中间像画没画出来」）。
    midDiff: (cols, boxOverride) => {
      const o = optics();
      const box = boxOverride || midImageBox(1.2);
      const C = cols || 12;
      const was = state.showMid;
      state.showMid = true; rebuildAll(); const on = regionSignature(box, C);
      state.showMid = false; rebuildAll(); const off = regionSignature(box, C);
      state.showMid = was; rebuildAll();
      let changed = 0, maxAbs = 0;
      for (let i = 0; i < on.blocks.length; i++) {
        const dv = Math.abs(on.blocks[i] - off.blocks[i]);
        if (dv > 0.02) changed++;
        if (dv > maxAbs) maxAbs = dv;
      }
      return { n: on.blocks.length, changed, frac: changed / on.blocks.length,
               maxAbs, hMid: o.hMid, xMid: o.xMid, rect: on.rect };
    },
    // 「镜筒内到底有没有画出光线」的差分判据：开关光路前后，镜筒内取样盒的变化格占比。
    tubeRayDiff: (cols) => {
      const o = optics();
      const box = { x0: o.xObjLens + o.d * 0.25, x1: o.xEyeLens - o.d * 0.06,
                    y0: -modeOf().tubeDia * 0.34, y1: modeOf().tubeDia * 0.34, z: 0 };
      const C = cols || 14;
      const was = state.showRays;
      state.showRays = true; rebuildAll(); const on = regionSignature(box, C);
      state.showRays = false; rebuildAll(); const off = regionSignature(box, C);
      state.showRays = was; rebuildAll();
      let changed = 0, maxAbs = 0;
      for (let i = 0; i < on.blocks.length; i++) {
        const dv = Math.abs(on.blocks[i] - off.blocks[i]);
        if (dv > 0.02) changed++;
        if (dv > maxAbs) maxAbs = dv;
      }
      return { n: on.blocks.length, changed, frac: changed / on.blocks.length, maxAbs };
    },
    // 画面上每个 sprite 标签投影到画布的包围盒。
    // 用途：断言「标签完整落在画布内」——「长标签被画布裁掉半个字」就是靠这条守住的。
    labelBoxes: () => {
      const out = [];
      const pxPerUnitAt = (p) => {
        const d = camera.position.distanceTo(p);
        return (state.h / 2) / (Math.tan(camera.fov * Math.PI / 360) * Math.max(1e-6, d));
      };
      scene.traverse((ob) => {
        if (!ob.isSprite || !ob.material || !ob.material.map) return;
        let vis = ob.visible, p = ob.parent;
        while (p) { if (p.visible === false) vis = false; p = p.parent; }
        if (!vis) return;
        const wp = ob.getWorldPosition(new THREE.Vector3());
        const v = wp.clone().project(camera);
        if (v.z > 1) return;
        const k = pxPerUnitAt(wp);
        const cx = (v.x * .5 + .5) * state.w, cy = (-v.y * .5 + .5) * state.h;
        const hw = ob.scale.x / 2 * k, hh = ob.scale.y / 2 * k;
        out.push({
          text: ob.userData.text || '', z: +v.z.toFixed(4),
          x0: +(cx - hw).toFixed(1), x1: +(cx + hw).toFixed(1),
          y0: +(cy - hh).toFixed(1), y1: +(cy + hh).toFixed(1),
          w: +(hw * 2).toFixed(1), h: +(hh * 2).toFixed(1)
        });
      });
      return { w: state.w, h: state.h, boxes: out };
    },
    // 画面上实际画出去的光线端点（读的是基元，不是「意图」）
    rayEnds: () => drawn.rays.slice(),
    debug() {
      const o = optics();
      const f = (x, d) => (Number.isFinite(x) ? x.toFixed(d === undefined ? 3 : d) : null);
      return {
        mode: state.mode, fObj: o.fObj, fEye: o.fEye, d: o.d, u1: o.u1, hObj: o.hObj,
        v1: f(o.v1), xMid: f(o.xMid), hMid: f(o.hMid), m1: f(o.m1),
        u2: f(o.u2), v2: f(o.v2), xFinal: f(o.xFinal), hFinal: f(o.hFinal),
        midToFocus: f(o.midToFocus), midSide: o.midSide, outSide: o.outSide,
        xMidTrace: o.xMidTrace === null ? null : f(o.xMidTrace),
        hMidTrace: o.hMidTrace === null ? null : f(o.hMidTrace),
        xFinalTrace: o.xFinalTrace === null ? null : f(o.xFinalTrace),
        Mobj: f(o.Mobj), Meye: f(o.Meye), Mprod: f(o.Mprod),
        corrK: f(o.corrK), Mview: f(o.Mview), MviewPred: f(o.MviewPred), MviewTR: f(o.MviewTR),
        tanRaw: f(o.tanRaw, 6), tanViewCF: f(o.tanViewCF, 6), tanViewTR: f(o.tanViewTR, 6),
        midShown: drawn.marks ? drawn.marks.midShown : null,
        finalShown: drawn.marks ? drawn.marks.finalShown : null,
        rayCount: drawn.rays.length,
        roMobj: $('roMobj').textContent, roMeye: $('roMeye').textContent,
        roMid: $('roMid').textContent, roTotal: $('roTotal').textContent,
        metricMid: $('metricMid').textContent, metricTotal: $('metricTotal').textContent,
        metricFinal: $('metricFinal').textContent,
        tubeValue: $('tubeValue').textContent,
        records: state.records.length
      };
    }
  };

  syncModeButtons();
  syncRangeInputs();
  applyView('perspective');
  renderRecords();
  rebuildAll();
  requestAnimationFrame(() => { render(); });
})();
