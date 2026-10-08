import * as THREE from './assets/optics-three.min.js';

/* ============================================================================
   温度计的使用 —— 三维写实测温实验台（人教版八上 第三章 第1节 温度）
   ---------------------------------------------------------------------------
   世界坐标单位：厘米（cm），y 轴向上，实验台台面为 y = 0。
   器材：铁架台（铸铁底座 + 镀铬立柱 + 十字夹）、硼硅玻璃烧杯（直接坐在台面上）
         + 水（可放冰块）、两支可换的温度计（实验室温度计 / 体温计）。
   ★ 本页【不加热】—— 没有酒精灯。水就是一杯已经调到某个温度的水，
     实验要练的是「怎么把温度计放对、读对、记对」，不是加热。
   ---------------------------------------------------------------------------
   操作：温度计一开始横放在台面上。鼠标点住它就把它拿起来，拖到烧杯上方松手，
        铁夹会自动合拢把它夹住；松手时玻璃泡落在哪儿，就判成哪种放法。
   ---------------------------------------------------------------------------
   物理：
     ① 示数滞后 —— 玻璃泡与被测液体之间是有限速率的换热，示数按一阶滞后趋近
        「玻璃泡感受到的温度」，所以刚插进去读不准，要等示数稳定。
     ② 玻璃泡位置偏差 —— 玻璃泡测的是【它接触到的物质】的温度。按「接触面积 ×
        换热系数」加权：水 500、空气 18。
        碰杯底：杯底隔着玻璃压在台面上，台面是室温 —— 热水时杯底偏凉、冰水时偏暖。
        碰杯壁：杯壁外侧和空气换热，内表面温度偏向室温 → 方向随水温与室温的关系变号。
        只浸入一半：一半泡面在空气里 → 偏向室温，同样会变号。
        三种错法的偏差【方向都随水温变号】，这是规则要禁它们的根本原因。
     ③ 视线视差 —— 刻度印在玻璃管前表面（半径 r），红色液柱在管中心，两者相隔 r。
        眼睛在距管 D、比液柱高（低）Δy 处，视线与刻度面相交的高度
        y_read = h + (r/D)·Δy，换算成温度 ΔT = (r/D)·Δy ÷ (每 ℃ 的刻度高度)。
        俯视 Δy > 0 → 读数偏大；仰视 Δy < 0 → 读数偏小。这不是写死的数。
        平视时没有视差可看，眼球与视线【都不画】（画出来只会喧宾夺主）。
     ④ 量程与分度值 —— 读数按分度值取整；超出量程时液柱顶到管口并报警。
     ⑤ 缩口 —— 体温计玻璃泡上方有缩口，水银只能往上走，所以能离开人体读数；
        要降下来必须【甩一甩】。
   ========================================================================== */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  /* ------------------------------ 器材尺寸 ------------------------------ */
  /* 台面就是 y = 0。烧杯直接坐在台面上，不再用铁圈 + 石棉网架到半空 ——
     整套器材的重心因此低了一大截，相机取景与铁夹高度都要跟着重算。 */
  const BASE_W = 20, BASE_D = 8, BASE_H = 1.8;       // 铸铁底座
  const BASE_Z = -9;                                 // 底座整体后移，给台面上的烧杯让出位置
  const ROD_R = 0.55, ROD_H = 15, ROD_Z = BASE_Z;    // 镀铬立柱

  // 烧杯：直径 8.4 cm、高 9.5 cm
  const BK_R = 4.2, BK_H = 9.5;
  const BK_Y0 = 0.04;                                // 直接坐在台面上
  const WATER_H = 7.0;
  const WATER_TOP = BK_Y0 + WATER_H;                 // 7.04
  const BK_INNER_R = BK_R - 0.1;                     // 4.1
  const BK_INNER_BOTTOM = BK_Y0 + 0.55;              // 0.59（加厚杯底的顶面）

  /* 温度计：管身比原来短。管越短，「每 ℃ 占多少厘米」越小 —— 同样一个眼睛
     高度差换算出的读数偏差就越大。这是让「视线相平」这条规则在【低矮的台面场景】
     里仍然看得见的关键：泡只能放到 4 cm 上下，眼睛的上下余地本来就小，
     再用原来那根 18.6 cm 的长管，偏差会被摊薄到半个分度值以下，读数上完全看不出来。 */
  const TH_BULB_R = 0.42;
  const TH_TUBE_R = 0.24;
  const TH_TUBE_H = 10.8;
  const LIFT_DY = 6.2;                               // 「提起温度计」抬升量（泡离开水面并高过杯口）

  /* 玻璃泡的四种放法（玻璃泡中心的世界坐标）。 */
  const TH_BULB_Y_BASE = BK_INNER_BOTTOM + 3.6;      // 4.19（泡在水体中下层，上下都留出余量）
  const PLACE_POS = {
    right:  { x: 0,                     y: TH_BULB_Y_BASE },
    bottom: { x: 0,                     y: BK_INNER_BOTTOM + TH_BULB_R },
    wall:   { x: BK_INNER_R - TH_BULB_R, y: TH_BULB_Y_BASE },
    half:   { x: 0,                     y: WATER_TOP }
  };

  /* 松手时按玻璃泡落在哪儿判「这是哪种放法」。阈值全部由几何本身给出，不另设玄学数字：
     横向超出杯口（内半径 + 半个泡）→ 根本没进杯子，退回台面；
     泡心压到「内底面 + 泡半径」附近 → 碰杯底；
     泡心落在水面上下各 0.8 cm 内 → 只浸入一半；
     其余按横向离轴的距离分「碰杯壁 / 全部浸入」。 */
  const DROP = {
    inX:     BK_INNER_R + 0.55,                      // 4.65
    bottomY: BK_INNER_BOTTOM + TH_BULB_R + 0.5,      // 1.51
    halfLo:  WATER_TOP - 0.8,                        // 6.24
    halfHi:  WATER_TOP + 0.8,                        // 7.84
    wallX:   BK_INNER_R - TH_BULB_R - 0.55           // 3.13
  };

  /* 初始状态：温度计横放在台面上，摆在烧杯【左边】，和烧杯在同一条竖直平面里（z 都为 0）。
     放在同一个竖直平面里是拖动交互的前提 —— 鼠标在一张平面内移动，就能把它从台面搬到杯口；
     落点 (x, y) 直接就是玻璃泡在杯里的位置，不用再猜深度。
     泡在左边、管身朝 −x 伸出去：管身朝 +x 的话会一直伸进烧杯里。 */
  const BENCH_X = -7.0;                              // 泡中心 x
  const BENCH_Y = TH_BULB_R + 0.03;                  // 泡搁在台面上（泡比管粗，先碰到台面）
  const BENCH_Z = 0;

  /* 印刷刻度：贴图尺寸与版面。刻度条要正对哪个方位角，由 makeScale() 量出墨迹后反算。 */
  const SCALE_TEX_W = 160, SCALE_TEX_H = 1024;
  const SCALE_FACE_DEG = -25;
  const SCALE_TICK_X = 71;
  const SCALE_NUM_X = 75;
  const SCALE_NUM_FONT = 20;
  const SCALE_Y0 = 0;                                // 刻度下限（贴图最下一行）在管身的局部高度
  /* 刻度只画到管身 8.2 cm 处，上面留出 2.2 cm 的空管给铁夹 ——
     刻度一直画到管口的话，夹口正好压住最高温那一段数字。 */
  const SCALE_Y1 = TH_TUBE_H - 2.6;                  // 8.2

  /* 铁夹夹口的高度：刻度上端再往上 1.1 cm，正好落在「刻度之上、管口之下」那段空管上。 */
  const CLAMP_Y = TH_BULB_Y_BASE + SCALE_Y1 + 1.1;   // 13.49
  /* 横臂停靠位置：还没夹住东西时缩回立柱旁边 */
  const ARM_PARK = BASE_Z + 2.6;                     // -6.4

  /* 温度计横躺在台面上时，还要绕管轴滚一下，让刻度条朝上 ——
     不滚的话印字那一面正好压在台面上，躺着的温度计就是一片空白玻璃，认不出是什么。
     推导：刻度条在管身局部坐标系里的方位是 SCALE_FACE_DEG（从 +z 起算）；
     躺下（绕 z 轴转 90°）之后，这个方位落到世界 (y, z) 平面里的 90° − SCALE_FACE_DEG 处；
     要把它转到正上方，绕世界 x 轴补 (SCALE_FACE_DEG − 90°) 就行。 */
  const LIE_ROLL = (SCALE_FACE_DEG - 90) * Math.PI / 180;

  /* ------------------------------ 物理参数 ------------------------------ */
  const AMB = 20;                                    // 室温 ℃
  const TAU_TH = 9;                                  // 温度计的时间常数 s（示数滞后）
  const TAU_VIS = 1.1;                               // 水温的视觉过渡（只影响颜色 / 白气 / 冰块）

  /* 玻璃泡「感受到」的温度 = 它接触到的各部分的加权平均。
     —— 水的自然对流换热系数约 500 W/(m²·K)，空气（对流 + 辐射）约 18。
     碰杯底：本页【不加热】，杯底不再是「被火焰烤热的那一层」。它隔着玻璃压在
             台面上，而台面就是室温 —— 于是杯底那一层水的温度是「水温向室温靠拢」
             的结果：热水时杯底偏凉（读数偏小），冰水时杯底偏暖（读数偏大）。
             方向同样随水温变号，而且因为台面这个热库比空气大得多，偏差也最大。
     碰杯壁：杯壁内表面由「水侧」和「空气侧」两个串联热阻定温：
             T_wall = Tw − (Tw − Ta)·WALL_K，所以壁温其实很接近水温（WALL_K ≈ 0.035），
             偏差只有 1 ℃ 上下 —— 但方向随水温变号，方向不可控才是规则要禁它的原因。
     只浸入一半：一半泡面在空气里，按 h·A 加权，同样偏向室温、同样会变号。 */
  const H_WATER = 500, H_AIR = 18;
  const WALL_K = H_AIR / (H_WATER + H_AIR);          // ≈ 0.0348
  const BOTTOM_K = 0.10;                             // 杯底向室温靠拢的比例（台面比空气导热好）
  const CONTACT_BOTTOM = 0.85;                       // 压住杯底时贴住杯底的泡面比例
  const CONTACT_WALL = 0.45;                         // 碰杯壁时贴住杯壁的泡面比例
  const HALF_F = 0.5;                                // 「只浸入一半」时在空气中的泡面比例

  /* 视线视差：眼睛到温度计的距离、俯视 / 仰视时眼睛比液柱高（低）多少。
     11 cm 是「把温度计凑到眼前看」的距离；距离越近视差越大 ——
     这也是读数时要正对着看的原因。 */
  const EYE_DIST = 11;                               // cm
  /* 眼睛的高度差不能再取 12 cm：泡只放到台面上方 4 cm 上下，取 12 的话
     仰视时眼睛会落到台面以下（跑到桌子底下去），画面上直接消失。
     3.6 cm 是「泡到台面」这段余地的一半多一点，配合上面缩短的管身，
     换算出的偏差正好还是一个分度值（≈1.1 ℃），看得见。 */
  const EYE_DY = 3.6;                                // cm
  /* 眼球只是「观察者」的符号，不是实验器材。 */
  const EYE_R = 0.75;                                // 眼球半径 cm
  /* 相机离眼球比这更近时干脆不画它：那时相机基本就站在观察者的位置上，
     再画一颗大白球只会糊住温度计。阈值落在「read 视角」与「其余三个视角」
     之间的空档里，两边都不贴边（具体数值由 dev-thermo-smoke.js 量出来核对）。 */
  const EYE_MIN_DIST = 22;                           // cm

  /* ------------------------------ 可选项 ------------------------------ */
  const WATERS = {
    '0':   { T: 0,   name: '冰水混合物', note: '冰正在融化' },
    '25':  { T: 25,  name: '常温水',     note: '室温附近' },
    '37':  { T: 37,  name: '温水',       note: '模拟人体温度' },
    '65':  { T: 65,  name: '热水',       note: '烫手' },
    '95':  { T: 95,  name: '接近沸点的水', note: '冒热气' },
    '100': { T: 100, name: '沸水',       note: '正在沸腾' }
  };
  const PLACES = {
    right:  { name: '全部浸入水中（正确）', short: '全部浸入' },
    bottom: { name: '碰到杯底',             short: '碰杯底' },
    wall:   { name: '碰到杯壁',             short: '碰杯壁' },
    half:   { name: '只浸入一半',           short: '浸一半' }
  };
  const SIGHTS = {
    level: { name: '平视（正确）', short: '平视', dy: 0 },
    down:  { name: '俯视',         short: '俯视', dy: EYE_DY },
    up:    { name: '仰视',         short: '仰视', dy: -EYE_DY }
  };
  /* 两支温度计：量程、分度值、长刻度间隔、数字间隔、缩口、管上刻度是否由物理式给出。
     physScale —— 管身上那套刻度是不是【按本页的物理式画出来的】：
       lab  = true。量程 −20 ~ 110 ℃、内孔 0.30 mm，液柱高由 h = V₀·β·ΔT / A 现算，
              与印在管上的刻度长度自洽（差 0.7%），所以「物理式 ↔ 刻度」可以互相验。
       body = false。量程只有 35 ~ 42 ℃。真实体温计能把这 7 ℃ 铺满整根管，靠的是把内孔
              做到 0.1 mm 量级；本页为了和上方 3D 管身共用同一根管子，是把 35 ~ 42 ℃
              【重新映射】到同一段刻度上 —— 这是画法，不是那套物理式算出来的。
              ★ 标成 false 之后 calInfo().relErr 报 null。不标的话，拿 100 ℃ 去问体温计，
                scaleYOf 会一路外推到 75.30 cm（管身刻度才 8.2 cm），面板上就会印出
                「差 99.4%」这种假误差 —— 顺序 5 上线后实测到的就是这个。
              ★ 同理，摄氏温度的定标（冰水 0 ℃ / 沸水 100 ℃）只在 lab 上成立：
                两个定标点都落在体温计量程之外，标在它身上是误导 ⇒ calibrate / divideCal
                对非 physScale 的量程一律拒绝，UI 也一起禁用。 */
  const KINDS = {
    lab:  { name: '实验室温度计', TMin: -20, TMax: 110, div: 1,   longStep: 5,   numStep: 10, dec: 0, neck: false, physScale: true },
    body: { name: '体温计',       TMin: 35,  TMax: 42,  div: 0.1, longStep: 0.5, numStep: 1,  dec: 1, neck: true,  physScale: false }
  };

  /* ==========================================================================
     三点五、摄氏温度的定标 & 温度计原理剖面
     --------------------------------------------------------------------------
     课本上「摄氏温度」不是天生的，是【规定】出来的，规定的方式就是两个定标点：
       冰水混合物 = 0 ℃，标准大气压下的沸水 = 100 ℃，中间等分 100 份。
     本页把这两个点做成可操作的动作 —— 把温度计放进对应水温、等示数稳定、
     再在管身上打一个记号。学生能亲眼看到「刻度是标出来的」。

     原理剖面要回答的是「为什么管要做得极细」：
       泡里那团液体受热膨胀，多出来的体积 V_BULB·β·ΔT 全部要摊到细管里，
       液柱升高 h = V_BULB·β·ΔT / A。A 越小，同样一点点膨胀就顶得越高。
     ========================================================================== */
  /* 示数与水温差多少才算「稳定」—— 标定必须在稳定之后打记号，否则记号是偏的 */
  const CAL_TOL = 0.05;
  /* 两个定标点。water 指向既有的水温档，不是另写一份温度。 */
  const CAL_POINTS = [
    { T: 0,   water: '0',   name: '冰水混合物',        label: '0 ℃' },
    { T: 100, water: '100', name: '标准大气压下的沸水', label: '100 ℃' }
  ];
  /* 液体【视膨胀系数】β（液体膨胀 − 玻璃膨胀），单位 1/℃。
     红液（酒精 + 红色染料）约 1.0×10⁻³；水银只有约 1.8×10⁻⁴。 */
  const BETA_APP = 1.0e-3;
  /* 玻璃泡里那团液体的半径 —— 取【真正画出来的】那团（mercuryBulb 比玻璃泡小 0.07） */
  const R_LIQ_BULB = TH_BULB_R - 0.07;
  const V_BULB = (4 / 3) * Math.PI * R_LIQ_BULB * R_LIQ_BULB * R_LIQ_BULB;   // cm³
  /* 细管内孔半径（cm）。★ 这是一个【独立的、按真实性选的】常数，不是从刻度长度反推的：
     真实实验室温度计的内孔直径 0.5 ~ 0.8 mm，取 0.60 mm。
     它与本页刻度长度是否自洽，由 `calInfo()` 里的 relErr 现算并断言（误差 < 2%）。 */
  const BORE_R = 0.030;
  const A_BORE = Math.PI * BORE_R * BORE_R;                                  // cm²
  /* 液柱高出泡口的高度（cm）—— 纯物理式：膨胀出的体积除以细管截面积 */
  function columnH(T, key) {
    const k = KINDS[key];
    return V_BULB * BETA_APP * (clamp(T, k.TMin, k.TMax) - k.TMin) / A_BORE;
  }

  /* ------------------------------ 状态 ------------------------------ */
  const state = {
    /* 默认用【热水】而不是常温水：本页不加热，三种错放的偏差都正比于「水温 − 室温」。
       默认取 25 ℃（≈ 室温）的话三种偏差全部归零，一进来点哪个都看不出区别；
       65 ℃ 既看得出示数爬升的滞后，偏差也都还有 1 个分度值以上。 */
    water: '65', place: 'right', sight: 'level', kind: 'lab',
    /* 温度计的握持状态：
         bench   —— 横放在实验台上（初始状态，还没开始测）
         hand    —— 被鼠标拿在手里，跟着指针走
         clamped —— 已经放进烧杯，铁夹合拢夹住 */
    grip: 'bench',
    lifted: false,                    // 已夹住的前提下，铁夹把它提起来（泡离开水面）
    handX: BENCH_X, handY: BENCH_Y,   // 拿在手里时玻璃泡的世界坐标
    thX: BENCH_X, thY: BENCH_Y,       // 平滑之后的玻璃泡位置 —— 真正驱动渲染的是这两个
    tilt: 0,                          // 0 = 横躺，1 = 竖立
    jawOpen: 1,                       // 铁夹张开程度：1 = 完全张开，0 = 夹紧
    armReach: ARM_PARK,               // 铁夹横臂伸到哪个 z（不夹时缩回立柱旁）
    Tw: 65,          // 水的真实温度 ℃（直接切换）
    TwVis: 65,       // 视觉用（颜色 / 白气 / 冰块）的平滑值
    Td: AMB,         // 温度计示数（连续量）
    t: 0,
    records: [],
    step: 0,
    /* 放大镜是否收起。纯界面状态：不参与仿真，reset 也不会把它弹开 */
    magCollapsed: false,
    /* 摄氏温度的定标进度。
       mark0 / mark100 = 打过的记号：{ T 打记号时的示数, y 管身局部高度 cm, settled 当时稳没稳 }，
       null = 还没打。divided = 有没有把两点之间等分 100 份。
       ★ 记号的高度记的是【当时的示数】，不是直接写 0 / 100 ——
       示数没稳定就点，记号就是偏的，这正是这一步要教的东西。 */
    cal: { mark0: null, mark100: null, divided: false, msg: '' },
    /* 画面上【真正画出来】的量（坐标 / 像素间距 …）留给自检读。
       自检若自己重算一遍公式，就是自指 —— 页面画错了它照样绿。 */
    drawn: {}
  };
  const toggles = { sight: true, eye: true, trueLine: true, steam: true };

  /* 玻璃泡在不在液体里：要「已经放进烧杯」而且「没被提起来」才算。
     横在台面上、拿在手里、被铁夹提着，泡都只和室温的空气打交道。 */
  function immersed() { return state.grip === 'clamped' && !state.lifted; }

  /* 松手时按落点判放法。返回 null 表示「没放进杯里」—— 温度计退回台面。
     拖动和「模拟松手」的验收钩子都走这一个函数，两边不可能判得不一样。 */
  function classifyDrop(bx, by) {
    if (Math.abs(bx) > DROP.inX) return null;       // 玻璃泡横向就在杯口外
    if (by > DROP.halfHi) return null;              // 泡还悬在水面以上，等于没放进去
    if (by <= DROP.bottomY) return 'bottom';
    if (by >= DROP.halfLo) return 'half';
    return Math.abs(bx) >= DROP.wallX ? 'wall' : 'right';
  }

  /* 取景：这一版的器材整体只有 0 ~ 17 cm 高，横向却铺开将近 28 cm
     （左边躺着温度计、右边是铁架台底座），所以注视点要往左挪、距离也要比
     「烧杯吊在半空」那一版近得多。下面这四个值不是手调的 —— 由 /tmp/tune-all.js
     把器材的极值点投影到 NDC，按「最长边占满 86%、包围盒居中」迭代反算出来，
     收敛误差都在 0.004 以内。改器材尺寸后重跑那个脚本再粘回来。

     ★ front / angle / top 是【四种放法】的并集（不是只按「全部浸入」调的）：
       只按一种放法调的话，45° 视角在「只浸入一半」时会把管口裁掉 0.024 NDC ——
       一截空白玻璃出画，看着像温度计断了。
     ★ read 带 followRead（相机跟着玻璃泡升降），所以它的相对取景与放法无关，
       按「全部浸入」调一次就够；这样它还能保持 21 cm 的近距离特写。 */
  const VIEWS = {
    front: { yaw: -0.06, pitch: 0.10, dist: 37.37, tx: -5.17, ty: 9.14 },
    angle: { yaw: -0.52, pitch: 0.15, dist: 38.15, tx: -7.91, ty: 8.30 },
    top:   { yaw: -0.50, pitch: 0.76, dist: 44.05, tx: -6.77, ty: 11.75 },
    read:  { yaw: -0.44, pitch: 0.04, dist: 21.12, tx: -1.78, ty: 9.67 }
  };
  /* 上面那四个 dist 是按【画布宽高比 1.364】调出来的（1280×840 下舞台的实际比例）。
     画布一窄，横向视野就跟着窄，器材会被左右裁掉 —— 手机上就是这样。
     所以窄于参考比例时按比例把相机往后退：宁可整体小一点，也不许裁。
     宽于参考比例不用管，横向只会更宽，纵向半展仍是调好的 0.86。 */
  const REF_ASPECT = 1.364;
  const view = { ...VIEWS.angle };
  /* 「读数特写」是【跟着温度计走】的：温度计在哪，它就特写哪儿。
     固定注视点做不到 —— 四种放法里玻璃泡的位置相差 6 cm，而特写视野只有 12 cm 高：
     按「全部浸入」调好，碰杯底时连 0 ℃ 那道刻度都被裁到画外（实测 NDC y = −1.35）；
     改成按最矮的那种调，四种放法就都糊成一团（dist 得从 21 拉到 34，不再是特写）。
     所以 read 视角只记「相对『全部浸入』的偏移」，切换放法时把相机一起平移过去。
     另外三个是全景视角，不跟 —— 它们本来就要把整个实验台框住。 */
  let followRead = false;

  /* ------------------------------ 小工具 ------------------------------ */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mulberry32 = (a) => () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const newCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const roundRect = (g, x, y, w, h, r) => {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  };
  /* 把单位圆柱（半径 1、高 1、沿 +y）摆到 a→b 上，用于画视线 */
  const UP = new THREE.Vector3(0, 1, 0);
  function orientSegment(mesh, a, b) {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length() || 1e-6;
    mesh.position.copy(a).addScaledVector(d, 0.5);
    mesh.quaternion.setFromUnitVectors(UP, d.clone().normalize());
    mesh.scale.set(1, len, 1);
  }

  /* ==========================================================================
     一、程序化贴图
     ========================================================================== */

  /* 铸铁底座：深灰 + 铸造砂眼 */
  function makeCastIronMap() {
    const S = 512, rnd = mulberry32(1010);
    const c = newCanvas(S, S), g = c.getContext('2d');
    g.fillStyle = '#33373d'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 220; i++) {
      const x = rnd() * S, y = rnd() * S, r = 12 + rnd() * 60;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, `hsla(${210 + rnd() * 30},${3 + rnd() * 7}%,${16 + rnd() * 22}%,${0.07 + rnd() * 0.12})`);
      grd.addColorStop(1, 'hsla(0,0%,0%,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    for (let i = 0; i < 4200; i++) {
      const x = rnd() * S, y = rnd() * S, r = 0.5 + rnd() * 1.7;
      const l = rnd() < 0.6 ? 10 + rnd() * 14 : 44 + rnd() * 26;
      g.fillStyle = `hsla(${205 + rnd() * 30},${3 + rnd() * 8}%,${l}%,${0.25 + rnd() * 0.45})`;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3, 2);
    return t;
  }

  /* 实验台面 */
  function makeBenchMap() {
    const S = 512, rnd = mulberry32(99);
    const c = newCanvas(S, S), g = c.getContext('2d');
    g.fillStyle = '#33312e'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 260; i++) {
      const x = rnd() * S, y = rnd() * S, r = 8 + rnd() * 46;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, `hsla(${205 + rnd() * 30},${4 + rnd() * 8}%,${9 + rnd() * 15}%,${0.06 + rnd() * 0.1})`);
      grd.addColorStop(1, 'hsla(0,0%,0%,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    for (let i = 0; i < 5200; i++) {
      const x = rnd() * S, y = rnd() * S, r = 0.4 + rnd() * 1.5;
      const l = rnd() < 0.55 ? 7 + rnd() * 10 : 30 + rnd() * 20;
      g.fillStyle = `hsla(${200 + rnd() * 40},${4 + rnd() * 10}%,${l}%,${0.2 + rnd() * 0.44})`;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(14, 9);
    return t;
  }

  function makeBackdropMap() {
    const W = 512, H = 512;
    const c = newCanvas(W, H), g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#4a5666');
    grad.addColorStop(0.45, '#333e4a');
    grad.addColorStop(1, '#1e252d');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    const r = g.createRadialGradient(W * 0.34, H * 0.30, 10, W * 0.34, H * 0.30, W * 0.72);
    r.addColorStop(0, 'rgba(210,228,244,0.20)');
    r.addColorStop(1, 'rgba(210,228,244,0)');
    g.fillStyle = r; g.fillRect(0, 0, W, H);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /* ==========================================================================
     二、渲染器 / 场景 / 光照
     ========================================================================== */
  const canvas = $('sceneCanvas');
  const stage = $('stage');

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  } catch (_) {
    const n = document.createElement('div');
    n.className = 'no-webgl';
    n.textContent = '当前浏览器无法启动三维渲染。请开启硬件加速，或使用新版 Chrome / Edge / Safari 后重试。';
    stage.appendChild(n);
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.98;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const MAX_ANISO = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#2b333c');
  scene.fog = new THREE.Fog('#2b333c', 190, 430);

  const camera = new THREE.PerspectiveCamera(32, 1, 1, 900);

  function studioEnv() {
    const W = 1024, H = 512;
    const c = newCanvas(W, H), g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.44, '#e6ebf1');
    grad.addColorStop(0.5, '#a8b2bc');
    grad.addColorStop(1, '#2f343b');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    const box = (x, y, w, h, r, fill) => { g.fillStyle = fill; roundRect(g, x, y, w, h, r); g.fill(); };
    box(110, 34, 300, 168, 26, 'rgba(255,255,255,0.98)');
    box(660, 74, 232, 140, 22, 'rgba(214,232,255,0.62)');
    box(360, 300, 400, 96, 30, 'rgba(255,226,182,0.34)');
    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromEquirectangular(tex).texture;
    pmrem.dispose(); tex.dispose();
    return env;
  }
  scene.environment = studioEnv();

  scene.add(new THREE.HemisphereLight('#eaf2fa', '#4a4238', 0.44));
  scene.add(new THREE.AmbientLight('#ffffff', 0.09));

  const key = new THREE.DirectionalLight('#fff2dd', 2.05);
  key.position.set(-42, 66, 44);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  /* 阴影正交视锥按新场景收紧：器材只占 y 0 ~ 17 cm、x −19 ~ 10 cm。
     原来那套（top 60 / bottom −14 / ±46，注视 y = 16）是「烧杯吊在半空」时定的，
     照搬过来会让 2048 的阴影贴图摊到一大片空处，接缝变糊。 */
  key.shadow.camera.left = -38; key.shadow.camera.right = 38;
  key.shadow.camera.top = 42; key.shadow.camera.bottom = -18;
  key.shadow.camera.near = 20; key.shadow.camera.far = 200;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.026;
  scene.add(key);
  scene.add(key.target);
  key.target.position.set(-2, 8, 0);

  const fill = new THREE.DirectionalLight('#dce9f8', 0.58);
  fill.position.set(50, 34, 30);
  scene.add(fill);
  const rim = new THREE.DirectionalLight('#cfe2ff', 0.44);
  rim.position.set(10, 30, -56);
  scene.add(rim);

  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(420, 320),
    new THREE.MeshBasicMaterial({ map: makeBackdropMap(), fog: false })
  );
  backdrop.position.set(0, 138, -95);
  scene.add(backdrop);

  const benchMap = makeBenchMap();
  benchMap.anisotropy = MAX_ANISO;
  const bench = new THREE.Mesh(
    new THREE.BoxGeometry(220, 7, 140),
    new THREE.MeshStandardMaterial({
      map: benchMap, bumpMap: benchMap, bumpScale: 0.04,
      roughness: 0.9, metalness: 0.0, envMapIntensity: 0.5
    })
  );
  bench.position.set(0, -3.5, 0);
  bench.receiveShadow = true;
  scene.add(bench);

  /* ==========================================================================
     三、器材
     ========================================================================== */
  const ironMap = makeCastIronMap();
  ironMap.anisotropy = MAX_ANISO;
  const castIron = new THREE.MeshStandardMaterial({ map: ironMap, bumpMap: ironMap, bumpScale: 0.05, color: '#b9bec6', roughness: 0.7, metalness: 0.3 });
  const chrome = new THREE.MeshStandardMaterial({ color: '#d9dfe5', roughness: 0.16, metalness: 1.0, envMapIntensity: 1.5 });
  const darkSteel = new THREE.MeshStandardMaterial({ color: '#6d737a', roughness: 0.36, metalness: 0.92, envMapIntensity: 1.1 });
  const knobMat = new THREE.MeshStandardMaterial({ color: '#3d434a', roughness: 0.42, metalness: 0.75 });

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: '#eef7ff', transparent: true, opacity: 0.24, roughness: 0.045, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 2.3,
    side: THREE.DoubleSide, depthWrite: false
  });
  const waterMat = new THREE.MeshPhysicalMaterial({
    color: '#bfe6f5', transparent: true, opacity: 0.40, roughness: 0.05, metalness: 0,
    clearcoat: 0.9, envMapIntensity: 1.5, side: THREE.DoubleSide, depthWrite: false
  });

  /* --- 铁架台 --- */
  const stand = new THREE.Group();
  scene.add(stand);
  const base = new THREE.Mesh(new THREE.BoxGeometry(BASE_W, BASE_H, BASE_D), castIron);
  /* 底座要跟着立柱一起后移到 BASE_Z：立柱在 BASE_Z、底座留在 z = 0 的话，
     立柱会插在底座外面的半空中。底座占 z ∈ [BASE_Z − 4, BASE_Z + 4]，
     正好把 z ∈ [−4.2, 4.2] 的烧杯让开。 */
  base.position.set(0, BASE_H / 2, BASE_Z);
  base.castShadow = true; base.receiveShadow = true;
  stand.add(base);
  const baseTop = new THREE.Mesh(new THREE.BoxGeometry(BASE_W - 1.6, 0.5, BASE_D - 1.6), castIron);
  baseTop.position.set(0, BASE_H + 0.2, BASE_Z);
  baseTop.castShadow = true;
  stand.add(baseTop);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(ROD_R, ROD_R, ROD_H, 24), chrome);
  rod.position.set(0, BASE_H + ROD_H / 2, ROD_Z);
  rod.castShadow = true;
  stand.add(rod);

  /* --- 酒精灯、铁圈、石棉网、石棉片：全部取消 ---
     烧杯直接坐在台面上（不再是「铁圈 + 石棉网架到半空、下面点着酒精灯」）。
     本页讲的是【温度计怎么用】，不是加热：既然没有加热，就不该摆一盏酒精灯 ——
     留着它，反而会让「碰杯底读数偏大」这条结论失去依据（见下面物理那一段）。 */
  /* --- 酒精灯、火焰、灯芯：整段删除（本页不加热） --- */

  /* --- 烧杯 --- */
  function makeBeakerMarks() {
    const W = 1024, H = 512;
    const c = newCanvas(W, H), g = c.getContext('2d');
    g.clearRect(0, 0, W, H);
    const x0 = Math.round(W * 0.055), x1 = Math.round(W * 0.30);
    g.strokeStyle = 'rgba(255,255,255,0.94)';
    g.fillStyle = 'rgba(255,255,255,0.96)';
    g.font = 'bold 34px "Helvetica Neue", Arial, sans-serif';
    g.textAlign = 'left'; g.textBaseline = 'middle';
    const area = Math.PI * BK_INNER_R * BK_INNER_R;
    const vOf = (mL) => (mL / area) / BK_H;
    for (const mL of [50, 100, 150, 200]) {
      const y = H - vOf(mL) * H;
      g.lineWidth = 5;
      g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
      g.fillText(String(mL), x1 + 9, y);
      for (let k = 1; k < 5; k++) {
        const yy = H - vOf(mL - 50 + k * 10) * H;
        if (yy > H - 8) continue;
        g.lineWidth = 3;
        g.beginPath(); g.moveTo(x0 + (x1 - x0) * 0.42, yy); g.lineTo(x1, yy); g.stroke();
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const beaker = new THREE.Group();
  scene.add(beaker);
  const bkWall = new THREE.Mesh(new THREE.CylinderGeometry(BK_R, BK_R, BK_H, 48, 1, true), glassMat);
  bkWall.position.set(0, BK_Y0 + BK_H / 2, 0);
  beaker.add(bkWall);
  const bkMarks = new THREE.Mesh(
    new THREE.CylinderGeometry(BK_R + 0.012, BK_R + 0.012, BK_H - 0.5, 48, 1, true),
    new THREE.MeshBasicMaterial({ map: makeBeakerMarks(), transparent: true, depthWrite: false, side: THREE.FrontSide })
  );
  bkMarks.position.set(0, BK_Y0 + BK_H / 2 - 0.1, 0);
  beaker.add(bkMarks);
  const bkFoot = new THREE.Mesh(new THREE.CylinderGeometry(BK_R * 0.985, BK_R * 0.965, 0.55, 48), glassMat);
  bkFoot.position.set(0, BK_Y0 + 0.27, 0);
  beaker.add(bkFoot);
  const bkBottom = new THREE.Mesh(new THREE.CircleGeometry(BK_R, 48), glassMat);
  bkBottom.rotation.x = -Math.PI / 2;
  bkBottom.position.set(0, BK_Y0 + 0.02, 0);
  beaker.add(bkBottom);
  const bkRim = new THREE.Mesh(new THREE.TorusGeometry(BK_R, 0.14, 10, 48), glassMat);
  bkRim.rotation.x = Math.PI / 2;
  bkRim.position.set(0, BK_Y0 + BK_H, 0);
  beaker.add(bkRim);
  const bkSpout = new THREE.Mesh(new THREE.SphereGeometry(0.44, 18, 12), glassMat);
  bkSpout.scale.set(2.0, 0.82, 1.0);
  bkSpout.position.set(BK_R * 0.93, BK_Y0 + BK_H + 0.06, 0);
  beaker.add(bkSpout);

  const water = new THREE.Mesh(new THREE.CylinderGeometry(BK_INNER_R, BK_INNER_R, WATER_H, 48), waterMat);
  water.position.set(0, BK_Y0 + WATER_H / 2, 0);
  beaker.add(water);
  const waterTop = new THREE.Mesh(
    new THREE.CircleGeometry(BK_INNER_R, 48),
    new THREE.MeshPhysicalMaterial({ color: '#bfe6f5', transparent: true, opacity: 0.44, roughness: 0.03, metalness: 0, clearcoat: 1, envMapIntensity: 1.6, side: THREE.DoubleSide, depthWrite: false })
  );
  waterTop.rotation.x = -Math.PI / 2;
  waterTop.position.set(0, WATER_TOP, 0);
  beaker.add(waterTop);

  /* 冰块：只在冰水混合物那一档出现 */
  const ices = new THREE.Group();
  beaker.add(ices);
  {
    const rnd = mulberry32(31337);
    const iceMat = new THREE.MeshPhysicalMaterial({
      color: '#dff3ff', transparent: true, opacity: 0.62, roughness: 0.14, metalness: 0,
      clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 2.0, depthWrite: false
    });
    for (let i = 0; i < 9; i++) {
      const s = 0.62 + rnd() * 0.42;
      const m = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.72, s * 0.9), iceMat);
      const a = rnd() * 6.283, rr = 0.6 + rnd() * (BK_INNER_R - 1.5);
      m.position.set(Math.cos(a) * rr, BK_Y0 + 0.7 + rnd() * (WATER_H - 1.2), Math.sin(a) * rr);
      m.rotation.set(rnd() * 0.6 - 0.3, rnd() * 3.14, rnd() * 0.6 - 0.3);
      m.castShadow = true;
      ices.add(m);
    }
  }

  /* 水面白气：水温高的时候才看得见 */
  const steams = [];
  {
    const rnd = mulberry32(8642);
    const steamMat = new THREE.MeshBasicMaterial({ color: '#eaf6ff', transparent: true, opacity: 0.22, depthWrite: false });
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 9), steamMat.clone());
      m.userData = { a: rnd() * 6.283, rad: rnd() * (BK_INNER_R - 1.0), ph: rnd(), spd: 0.16 + rnd() * 0.14, r0: 0.34 + rnd() * 0.3 };
      m.visible = false;
      steams.push(m);
      scene.add(m);
    }
  }

  /* ==========================================================================
     四、温度计（两支：实验室温度计 / 体温计）
     ========================================================================== */
  const thGlassMat = new THREE.MeshPhysicalMaterial({
    color: '#f2fbff', transparent: true, opacity: 0.30, roughness: 0.04, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 2.6,
    side: THREE.DoubleSide, depthWrite: false
  });
  const thRedMat = new THREE.MeshStandardMaterial({
    color: '#e0212c', emissive: '#a5121d', emissiveIntensity: 1.15, roughness: 0.26, metalness: 0.05
  });

  /* ★ scaleYOf / cmPerDeg 的第二个参数是【量程对象】（要用 k.TMin / k.TMax）。
     曾经有三处把「键名」传了进来（'lab'）—— 'lab'.TMin === undefined ⇒ 整条算式变 NaN：
     记号高度、cmPerDeg、exp0Y / exp100Y、relErr 全成 NaN，而自检那边
     Math.abs(null − null) === 0 又让几条断言「照样绿」（NaN 跨 page.evaluate 会变 null）。
     这里统一收口：传键名或传对象都接受，一处解析 ⇒ 别处不可能再传错。 */
  const kindOf = (k) => (typeof k === 'string' ? KINDS[k] : k);
  /* 刻度 T 画在贴图的哪一行 —— 印刷刻度与液柱映射共用这一个式子，两边不可能再对不上 */
  function scaleCanvasY(T, k) {
    return SCALE_TEX_H - 6 - ((T - k.TMin) / (k.TMax - k.TMin)) * (SCALE_TEX_H - 12);
  }
  /* CanvasTexture 默认 flipY：贴图 v = 1 − y/H。刻度 T 在管身局部坐标系里的高度由这里唯一给出。 */
  function scaleYOf(T, k) {
    const kk = kindOf(k);
    return SCALE_Y0 + (1 - scaleCanvasY(T, kk) / SCALE_TEX_H) * (SCALE_Y1 - SCALE_Y0);
  }
  /* 每 1 ℃ 对应多少 cm —— 视差从「cm」换算成「℃」就靠它 */
  function cmPerDeg(k) { const kk = kindOf(k); return (SCALE_Y1 - SCALE_Y0) / (kk.TMax - kk.TMin); }

  /* 画一支温度计的印刷刻度，并量出刻度条真正占的水平范围（含数字），供旋转角使用 */
  function makeScale(key) {
    const k = KINDS[key];
    const W = SCALE_TEX_W, H = SCALE_TEX_H;
    const c = newCanvas(W, H), g = c.getContext('2d');
    g.clearRect(0, 0, W, H);
    g.strokeStyle = 'rgba(38,50,60,0.95)';
    g.fillStyle = 'rgba(28,40,50,0.98)';
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(SCALE_TICK_X, 6); g.lineTo(SCALE_TICK_X, H - 6); g.stroke();
    g.font = `bold ${SCALE_NUM_FONT}px "Helvetica Neue", Arial, sans-serif`;
    g.textAlign = 'left'; g.textBaseline = 'middle';
    const n = Math.round((k.TMax - k.TMin) / k.div);
    for (let i = 0; i <= n; i++) {
      const T = k.TMin + i * k.div;
      const y = scaleCanvasY(T, k);
      const isNum = Math.abs(T / k.numStep - Math.round(T / k.numStep)) < 1e-6;
      const isLong = Math.abs(T / k.longStep - Math.round(T / k.longStep)) < 1e-6;
      const len = isNum ? 16 : isLong ? 11 : 6;
      g.lineWidth = isNum ? 2.4 : isLong ? 2.0 : 1.4;
      g.beginPath(); g.moveTo(SCALE_TICK_X - len, y); g.lineTo(SCALE_TICK_X, y); g.stroke();
      if (isNum) g.fillText(T.toFixed(k.dec), SCALE_NUM_X, y);
    }
    const d = g.getImageData(0, 0, W, H).data;
    let x0 = W, x1 = -1;
    for (let y = 0; y < H; y++) {
      const row = y * W * 4;
      for (let x = 0; x < W; x++) {
        if (d[row + x * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return { tex, u0: x0 / W, u1: (x1 + 1) / W };
  }
  const scaleTex = { lab: makeScale('lab'), body: makeScale('body') };

  const thermometer = new THREE.Group();
  scene.add(thermometer);

  const thGlass = new THREE.Mesh(new THREE.CylinderGeometry(TH_TUBE_R, TH_TUBE_R, TH_TUBE_H, 20, 1, true), thGlassMat);
  thGlass.position.set(0, TH_TUBE_H / 2 - 0.4, 0);
  thermometer.add(thGlass);
  const thScale = new THREE.Mesh(
    new THREE.CylinderGeometry(TH_TUBE_R + 0.008, TH_TUBE_R + 0.008, SCALE_Y1 - SCALE_Y0, 20, 1, true),
    new THREE.MeshBasicMaterial({ map: scaleTex.lab.tex, transparent: true, depthWrite: false, side: THREE.FrontSide })
  );
  thScale.position.set(0, (SCALE_Y0 + SCALE_Y1) / 2, 0);
  thermometer.add(thScale);
  /* 背面再印一条：拖动视角绕到后面也能读。两条都是 FrontSide，正面不会透出背面的镜像数字。 */
  const thScaleBack = thScale.clone();
  thermometer.add(thScaleBack);
  const thBulb = new THREE.Mesh(new THREE.SphereGeometry(TH_BULB_R, 22, 14), thGlassMat);
  thermometer.add(thBulb);
  const thCap = new THREE.Mesh(new THREE.SphereGeometry(TH_TUBE_R, 16, 10), thGlassMat);
  thCap.position.set(0, TH_TUBE_H - 0.4, 0);
  thermometer.add(thCap);

  /* 缩口：体温计玻璃泡上方那段细颈（也是「离开液体后示数不回落」的原因） */
  const thNeck = new THREE.Mesh(new THREE.SphereGeometry(TH_BULB_R * 0.42, 14, 10), thGlassMat);
  thNeck.position.set(0, TH_BULB_R + 0.34, 0);
  thermometer.add(thNeck);

  const mercury = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 1, 12), thRedMat);
  const mercuryBulb = new THREE.Mesh(new THREE.SphereGeometry(TH_BULB_R - 0.07, 18, 12), thRedMat);
  thermometer.add(mercury);
  thermometer.add(mercuryBulb);

  /* 定标记号：管身上套一圈金色细环。两个记号是两个独立的环，
     位置由 updateThermo() 按 state.cal 里的高度实时摆 —— 打没打记号、打在哪儿
     都从同一个地方来，画面上不会和面板上的数字各说各话。 */
  const calRingMat = new THREE.MeshBasicMaterial({
    color: '#fbbf24', transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false
  });
  const calRings = [0, 1].map(() => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(TH_TUBE_R + 0.035, 0.03, 8, 44), calRingMat);
    m.rotation.x = Math.PI / 2;          // 环面水平（管是竖直的）
    m.visible = false;
    thermometer.add(m);
    return m;
  });

  /* 把刻度条转到正对相机的那半边管壁。
     贴图里刻度条中心在 u = (u0+u1)/2（CylinderGeometry 的 u=0 在 +z，θ = 360°·u），
     绕 y 转 φ 后 θ → θ+φ，所以 φ = 目标方位角 − 360°·u_center。不转的话它贴在背面，等于没画。 */
  function applyScale(key) {
    const s = scaleTex[key];
    thScale.material.map = s.tex;
    thScale.material.needsUpdate = true;
    const rot = (SCALE_FACE_DEG - 360 * (s.u0 + s.u1) / 2) * Math.PI / 180;
    thScale.rotation.y = rot;
    thScaleBack.rotation.y = rot + Math.PI;
  }
  applyScale('lab');

  /* --- 十字夹（铁夹）：把温度计夹住。竖直方向整组随温度计升降；横臂从立柱伸出去。 ---
     立柱在 z = ROD_Z（底座上），温度计在 z = 0（烧杯轴线），所以横臂要伸出去 9 cm。
     没夹东西的时候横臂缩回立柱旁边、夹口张开；温度计一放进烧杯，横臂伸出去、夹口合拢。
     这条「伸出去 + 合拢」的动画就是用户松手之后「铁架台自动固定」的那一下。 */
  const thSupport = new THREE.Group();
  scene.add(thSupport);
  const clampSleeve = new THREE.Mesh(new THREE.CylinderGeometry(ROD_R + 0.5, ROD_R + 0.5, 2.3, 20), darkSteel);
  clampSleeve.position.set(0, CLAMP_Y, ROD_Z);
  clampSleeve.castShadow = true;
  thSupport.add(clampSleeve);
  const clampScrew = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.5, 12), knobMat);
  clampScrew.rotation.z = Math.PI / 2;
  clampScrew.position.set(ROD_R + 1.05, CLAMP_Y, ROD_Z);
  clampScrew.castShadow = true;
  thSupport.add(clampScrew);
  /* 横臂：单位长度立方体（长轴沿 +z），从立柱摆到夹口座 —— 摆位靠 orientBar() */
  const clampBar = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.68, 1), darkSteel);
  clampBar.castShadow = true;
  thSupport.add(clampBar);
  /* 夹口座：横臂末端那一小块，夹口挂在它下面 */
  const clampHead = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.0, 1.2), darkSteel);
  clampHead.castShadow = true;
  thSupport.add(clampHead);
  const jaws = new THREE.Group();
  thSupport.add(jaws);
  /* 夹口的两片颚 + 软垫。每片记下自己的侧向（±z）和「完全张开时的偏移」，
     合拢时统一按 jawOpen 往中间收 —— 张开量只有一个来源，不会两片跑得不一样。 */
  for (const s of [-1, 1]) {
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 0.5), darkSteel);
    jaw.userData = { s, off: TH_TUBE_R + 0.34 };
    jaw.castShadow = true;
    jaws.add(jaw);
    const padm = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.34, 0.22),
      new THREE.MeshStandardMaterial({ color: '#2f3338', roughness: 0.95, metalness: 0.05 }));
    padm.userData = { s, off: TH_TUBE_R + 0.12 };
    jaws.add(padm);
  }
  /* 夹口张开量：jawOpen = 1 完全张开，0 夹紧（软垫刚好贴住管壁） */
  const JAW_GAP = 1.35;
  function applyJaw() {
    for (const m of jaws.children) m.position.set(0, 0, m.userData.s * (m.userData.off + state.jawOpen * JAW_GAP));
  }

  /* 把单位长（长轴沿 +z）的横臂从 a 摆到 b */
  const AXIS_Z = new THREE.Vector3(0, 0, 1);
  function orientBar(mesh, a, b) {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    if (len < 1e-4) return;
    mesh.position.copy(a).addScaledVector(d, 0.5);
    mesh.scale.z = len;
    mesh.quaternion.setFromUnitVectors(AXIS_Z, d.clone().normalize());
  }
  /* 拾取代理：一根包住整支温度计的隐形圆柱。
     玻璃管是 openEnded 的薄壳，直接拿它做拾取目标，点在管壁上才算命中 ——
     太细，点不准。代理给到半径 1.15，点「温度计附近」就能抓住。
     opacity 0 而不是 visible = false：射线拾取不看材质，但 visible = false 在部分
     版本里会让 intersectObject 直接跳过，用全透明最保险。 */
  const pickProxy = new THREE.Mesh(
    new THREE.CylinderGeometry(1.15, 1.15, TH_TUBE_H + 1.2, 8),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  );
  pickProxy.position.y = (TH_TUBE_H - 0.4) / 2;
  thermometer.add(pickProxy);

  /* --- 观察者的眼睛 + 视线 --- */
  const eyeGroup = new THREE.Group();
  scene.add(eyeGroup);
  const eyeWhiteMat = new THREE.MeshStandardMaterial({ color: '#eef2f7', roughness: 0.72, metalness: 0.02 });
  const eyeBall = new THREE.Mesh(new THREE.SphereGeometry(EYE_R, 24, 18), eyeWhiteMat);
  eyeGroup.add(eyeBall);
  /* 虹膜 / 瞳孔的半径与前后位置都按 EYE_R 的比例推 —— 改眼球半径时三者一起缩，
     不会各跑各的（原来 1.5 / 0.86 / 0.40 就是这三个比例）。 */
  const iris = new THREE.Mesh(new THREE.SphereGeometry(EYE_R * 0.573, 20, 16),
    new THREE.MeshStandardMaterial({ color: '#2f6fb5', roughness: 0.42, metalness: 0.05, emissive: '#0d2740', emissiveIntensity: 0.22 }));
  iris.position.set(0, 0, EYE_R * 0.68);
  iris.scale.set(1, 1, 0.62);
  eyeGroup.add(iris);
  const pupil = new THREE.Mesh(new THREE.SphereGeometry(EYE_R * 0.267, 16, 12),
    new THREE.MeshStandardMaterial({ color: '#0b1520', roughness: 0.55, metalness: 0 }));
  pupil.position.set(0, 0, EYE_R * 0.947);
  pupil.scale.set(1, 1, 0.5);
  eyeGroup.add(pupil);
  /* 相机到眼球的距离，每帧在 animateParts 里更新；自检靠它证明「藏眼球」这条真的生效。 */
  let eyeCamDist = Infinity;

  const sightLine = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.055, 1, 8),
    new THREE.MeshBasicMaterial({ color: '#38e0ff', transparent: true, opacity: 0.85, depthWrite: false })
  );
  scene.add(sightLine);
  const sightDot = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 14, 10),
    new THREE.MeshBasicMaterial({ color: '#38e0ff', transparent: true, opacity: 0.95, depthWrite: false })
  );
  scene.add(sightDot);

  /* ==========================================================================
     五、物理
     ========================================================================== */

  /* 玻璃泡「感受到」的温度：按接触面积 × 换热系数加权。
     先判它在不在液体里 —— 横在台面上、拿在手里、被铁夹提起来，都只和室温的空气打交道。 */
  function envTemp() {
    const Tw = state.Tw, Ta = AMB;
    if (!immersed()) return Ta;
    switch (state.place) {
      case 'bottom': {
        /* 本页【不加热】：杯底不是「被火焰烤热的那一层」。它隔着玻璃压在台面上，
           而台面就是室温 —— 杯底那一层水的温度是「水温向室温靠拢」的结果，
           靠拢的比例 BOTTOM_K 由台面这个热库的强弱定。
           热水时杯底偏凉（读数偏小），冰水时杯底偏暖（读数偏大）：方向随水温变号。 */
        const Tbot = Tw - (Tw - Ta) * BOTTOM_K;
        return CONTACT_BOTTOM * Tbot + (1 - CONTACT_BOTTOM) * Tw;
      }
      case 'wall': {
        const Twall = Tw - (Tw - Ta) * WALL_K;         // 串联热阻定出的壁温，其实很接近水温
        return CONTACT_WALL * Twall + (1 - CONTACT_WALL) * Tw;
      }
      case 'half': {
        const f = HALF_F;
        return (f * H_WATER * Tw + (1 - f) * H_AIR * Ta) / (f * H_WATER + (1 - f) * H_AIR);
      }
      default: return Tw;
    }
  }

  /* 视线视差（℃）：眼睛比液柱高 Δy 时，视线与刻度面相交的高度比液柱实际高度多 (r/D)·Δy。
     r 取刻度面的半径 —— 刻度印在玻璃管外表面，比管壁略大一点。 */
  const SCALE_R = TH_TUBE_R + 0.008;
  function sightBias() {
    const s = SIGHTS[state.sight];
    if (!s.dy) return 0;
    return (SCALE_R / EYE_DIST) * s.dy / cmPerDeg(KINDS[state.kind]);
  }

  function inRange() {
    const k = KINDS[state.kind];
    return state.Td > k.TMin + 0.05 && state.Td < k.TMax - 0.05;
  }
  /* 未经分度值取整的读数 —— 误差用它算，才不会被 1 ℃ 的分度值把偏差抹平 */
  function rawReading() {
    const k = KINDS[state.kind];
    return clamp(state.Td + sightBias(), k.TMin, k.TMax);
  }
  /* 读数：示数 + 视差，再按分度值取整 —— 分度值 1 ℃ 的温度计读不出 0.1 ℃ */
  function reading() {
    const k = KINDS[state.kind];
    return Math.round(rawReading() / k.div) * k.div;
  }
  function readingText() {
    const k = KINDS[state.kind];
    if (state.Td >= k.TMax - 0.05) return `> ${k.TMax.toFixed(k.dec)} ℃`;
    if (state.Td <= k.TMin + 0.05) return `< ${k.TMin.toFixed(k.dec)} ℃`;
    return `${reading().toFixed(k.dec)} ℃`;
  }
  /* 这一次读数可不可信：温度计确实放好了、位置对、视线对，而且没超出量程 */
  function trustworthy() {
    return immersed() && state.place === 'right' && state.sight === 'level' && inRange();
  }

  function stepSim(dt) {
    const k = KINDS[state.kind];
    const env = envTemp();
    /* 缩口：水银只能往上走。示数一旦升进量程（水银已经越过细颈），就不会再自己
       退回来 —— 换到更冷的液体里也一样，必须甩一甩才能降下去。
       水银还在缩口以下时它没进入细颈，示数才能随环境自由上下。
       早先的写法是「提起时冻结」，那是把「离开液体」当成了原因；真正的判据是
       「水银有没有越过缩口」。按旧写法，把体温计从 65 ℃ 的水挪到 37 ℃ 的水里，
       示数会跟着掉到 37 —— 与「用前必须甩一甩」直接矛盾。 */
    const past = k.neck && state.Td >= k.TMin - 0.05;
    const relaxed = state.Td + (env - state.Td) * (1 - Math.exp(-dt / TAU_TH));
    state.Td = past ? Math.max(state.Td, relaxed) : relaxed;
    state.Td = clamp(state.Td, k.TMin - 2, k.TMax + 2);
    state.TwVis += (state.Tw - state.TwVis) * (1 - Math.exp(-dt / TAU_VIS));
    state.t += dt;
  }

  /* 甩一甩：把水银甩回玻璃泡，示数落到量程以下，然后重新开始测。
     只有带缩口的体温计才需要（也才有效）—— 实验室温度计的水银本来就会自己
     跟着环境走，甩不甩一个样，所以返回 false 让界面说明原因。 */
  function shake() {
    const k = KINDS[state.kind];
    if (!k.neck) return false;
    state.Td = k.TMin - 1.2;
    resetRun();
    refreshAll();
    return true;
  }

  function resetRun() {                                // 换条件：曲线重新开始画，但示数不跳
    state.t = 0;
    series.length = 0;
    sampleAcc = 0;
    pushSample();
  }
  function resetSim() {
    state.water = '65'; state.place = 'right'; state.sight = 'level'; state.kind = 'lab';
    state.grip = 'bench'; state.lifted = false;
    state.handX = BENCH_X; state.handY = BENCH_Y;
    state.armReach = ARM_PARK; state.jawOpen = 1;
    state.Tw = WATERS[state.water].T; state.TwVis = state.Tw;
    state.Td = AMB;
    applyScale('lab');
    /* 定标记号也一起清掉：重置 = 回到「一个记号都没打」的初始状态。
       记号的高度是按当时那支温度计的刻度算出来的，换了温度计就不作数了。 */
    state.cal.mark0 = null; state.cal.mark100 = null;
    state.cal.divided = false; state.cal.msg = '';
    snapThermo();                                      // 温度计直接回到台面上，不留中间姿态
    resetRun();
    syncViewToPlace();                                 // 放法复位成「全部浸入」，特写也跟着回位
    syncButtons();
  }

  /* ==========================================================================
     六、随状态更新器材
     ========================================================================== */
  /* 温度计的「目标姿态」——位置是玻璃泡中心，tilt 0 = 横躺、1 = 竖立。
     三种握持状态各自对应一个目标，平滑由 animateParts 统一做。 */
  function thermoPoseTarget() {
    if (state.grip === 'clamped') {
      const p = PLACE_POS[state.place];
      return { x: p.x, y: p.y + (state.lifted ? LIFT_DY : 0), tilt: 1 };
    }
    if (state.grip === 'hand') return { x: state.handX, y: state.handY, tilt: 1 };
    return { x: BENCH_X, y: BENCH_Y, tilt: 0 };        // 横躺在台面上
  }
  /* 不走平滑，直接落到目标姿态（初始化 / 重置用） */
  function snapThermo() {
    const t = thermoPoseTarget();
    state.thX = t.x; state.thY = t.y; state.tilt = t.tilt;
    updateThermo();
  }

  function updateThermo() {
    /* 姿态：横躺 = 绕 z 转 90°（管身朝 −x）再绕世界 x 轴滚 LIE_ROLL（刻度朝上）；
       竖立 = 不转。Euler 顺序 XYZ ⇒ 世界变换是 Rx·Ry·Rz，Rz 先作用、Rx 最后作用，
       正好是「先躺下、再绕已经躺平的管轴滚一圈」。 */
    const lie = 1 - state.tilt;
    thermometer.rotation.set(lie * LIE_ROLL, 0, lie * Math.PI / 2);
    thermometer.position.set(state.thX, state.thY, 0);

    /* 铁夹：横臂从立柱摆到夹口座，夹口座随横臂伸出而靠近温度计。
       ext 是「伸出程度」：armReach 停在 ARM_PARK（−6.4，贴着立柱）时 0，
       伸到 0（温度计轴线）时 1。分母是 |0 − ARM_PARK|，写反了会让停靠姿态
       也当成伸到位（曾经就写成 1 − (armReach − ARM_PARK)/2.6，停靠时恒等于 1）。 */
    const ext = clamp((state.armReach - ARM_PARK) / (0 - ARM_PARK), 0, 1);
    const headX = state.thX * ext;
    orientBar(clampBar,
      new THREE.Vector3(0, CLAMP_Y, ROD_Z),
      new THREE.Vector3(headX, CLAMP_Y, state.armReach));
    clampHead.position.set(headX, CLAMP_Y, state.armReach);
    jaws.position.set(headX, CLAMP_Y, state.armReach);
    applyJaw();
    /* 整组随温度计升降：只在夹住的时候跟（横在台面上、拿在手里时铁夹停在原位） */
    thSupport.position.set(0, ext * (state.thY - TH_BULB_Y_BASE), 0);

    /* 缩口只在体温计上出现 */
    thNeck.visible = KINDS[state.kind].neck;

    /* 液柱：顶端按刻度线性映射（TMin → 刻度下限，TMax → 刻度上限），与印刷刻度同源 */
    const k = KINDS[state.kind];
    const bulbLocalY = 0;
    const Tshow = clamp(state.Td, k.TMin, k.TMax);
    const colTop = scaleYOf(Tshow, k);
    const colH = Math.max(0.5, colTop - bulbLocalY);
    mercury.scale.set(1, colH, 1);
    mercury.position.set(0, bulbLocalY + colH / 2, 0);
    mercuryBulb.position.set(0, bulbLocalY, 0);

    /* 定标记号：位置直接取 state.cal 里记下的高度（那边是唯一真源），
       这里只负责把它摆到管身上。没打记号就隐藏。
       ★ 还要求【这个量程上定标成立】：体温计（35 ~ 42 ℃）装不下 0 ℃ 与 100 ℃ 两个
         定标点，把上一支温度计标出来的金环留在它身上，等于给体温计印上「100 ℃」。 */
    const calOn = KINDS[state.kind].physScale;
    const c0 = state.cal.mark0, c1 = state.cal.mark100;
    calRings[0].visible = calOn && !!c0;
    calRings[1].visible = calOn && !!c1;
    if (c0) calRings[0].position.set(0, c0.y, 0);
    if (c1) calRings[1].position.set(0, c1.y, 0);
  }

  /* ==========================================================================
     六点五、摄氏温度的定标（顺序 5 新增）
     ========================================================================== */
  /* 定标点规定的水温对应的液柱高度 —— 与 3D 印刷刻度【同一个】映射函数 */
  function calYOf(T, key) {
    const k = KINDS[key];
    return scaleYOf(clamp(T, k.TMin, k.TMax), k);
  }
  /* 两个定标点之间分多少份 —— 由【温差 ÷ 分度值】给出，不是写死的 100：
     0 ℃ 到 100 ℃ 差 100 ℃，实验室温度计分度值 1 ℃ ⇒ 100 份（101 条线）。
     换成体温计（分度值 0.1 ℃）就是 1000 份 —— 刻度越细，份数越多。 */
  function calNDiv(key) {
    const k = KINDS[key || state.kind];
    return Math.max(1, Math.round((CAL_POINTS[1].T - CAL_POINTS[0].T) / k.div));
  }

  /* 在管身上打一个定标记号。
     ① 先把水换成该定标点规定的那杯水（冰水混合物 / 沸水）——
        不是随便一杯，0 ℃ 和 100 ℃ 各自有严格规定；
     ② 记号打在【当前示数】的高度上。示数还没稳定就点，记号就是偏的 ——
        面板会提示「标早了」，这就是这一步要教的：定标必须等示数稳定。
     ★ 门禁在函数里，不只在按钮上：量程装不下定标点的温度计（体温计 35 ~ 42 ℃）
       一律拒绝。只禁用按钮的话，直接调函数就能绕过去 —— 而且「定标 0 ℃」标在
       一支量程 35 ~ 42 ℃ 的温度计上，本身就是错的，不是「钳一下就没事」。 */
  function calibrate(i) {
    const pt = CAL_POINTS[i];
    const k = KINDS[state.kind];
    /* ★ 门禁在函数里，不只在按钮上：量程装不下定标点的温度计（体温计 35 ~ 42 ℃）
       一律拒绝，返回 null。只禁用按钮的话，直接调函数就能绕过去 —— 而且「标定 0 ℃」
       标在一支量程 35 ~ 42 ℃ 的温度计上本身就是错的，不是「钳一下就没事」。
       提示文案由 syncCalUI() 统一给（那里也是从同一个 physScale 现算的）。 */
    if (!k.physScale) return null;
    state.water = pt.water;
    state.Tw = WATERS[pt.water].T;
    state.TwVis = state.Tw;
    resetRun();
    const settled = immersed() && Math.abs(state.Td - state.Tw) <= CAL_TOL;
    const mark = {
      T: +state.Td.toFixed(4),
      y: +calYOf(state.Td, state.kind).toFixed(4),
      settled
    };
    state.cal[i === 0 ? 'mark0' : 'mark100'] = mark;
    state.cal.divided = false;          /* 记号一动，之前的等分就作废 */
    /* 三种情况分得清清楚楚，各自有各自的补救办法 —— 不要合成一句「再试试」 */
    state.cal.msg = !immersed()
      ? `温度计还不在水里（${state.grip === 'bench' ? '横在台面上' : '被提起来了'}）—— 先把它放进烧杯，等示数稳定再标定。`
      : settled
        ? `已在 ${pt.label}（${pt.name}）处打好记号 —— 此时示数 ${state.Td.toFixed(1)} ℃，稳定。`
        : `标早了！此时示数只有 ${state.Td.toFixed(1)} ℃，还没跟到 ${pt.T} ℃ —— 记号打偏了。等读数不动了再标一次。`;
    refreshAll();
    return mark;
  }

  /* 把 0 ℃ 与 100 ℃ 两个记号之间等分 100 份。
     门禁：① 这个量程得是「按物理式画的」那一支（体温计量程装不下两个定标点）；
          ② 两个记号都得打过、而且都必须在示数稳定时打的 ——
             拿一个标偏的记号去等分，分出来的刻度全是错的。 */
  function divideCal() {
    const c = state.cal;
    if (!KINDS[state.kind].physScale) return false;
    if (!c.mark0 || !c.mark100) return false;
    if (!c.mark0.settled || !c.mark100.settled) return false;
    c.divided = true;
    c.msg = '两个定标点之间等分 100 份，每份就是 1 ℃。';
    refreshAll();
    return true;
  }

  /* 定标与剖面要报给面板 / 自检的全部量。
     ★ relErr 是【两条独立路径】的对账，基准必须是【这个量程自己的一整段】：
         物理式 columnH(TMax) —— 从 TMin 一路升到 TMax，液柱该升多高；
         管上刻度 SCALE_Y1 − SCALE_Y0 —— 印出来的刻度占多长。
       细管内孔半径 BORE_R 是按真实性独立选的（0.60 mm 直径），不是从刻度长度反推的，
       所以这个相对误差是真检查 —— 超过 2% 就说明细管粗细与刻度长度不自洽了。
     ★ 为什么不用 100 ℃ 当基准：那是实验室温度计的定标点，不是「量程的上端」。
       拿它去问体温计（量程 35 ~ 42 ℃），scaleYOf 会把 100 ℃ 外推到 75.30 cm
       —— 管身刻度才 8.2 cm，于是报出 99.4% 的假误差。量程装不下这个温度时，
       正确的做法是【不报这个数】（relErr = null），而不是报一个外推出来的数。 */
  function calInfo() {
    const k = KINDS[state.kind];
    const c = state.cal;
    const spanCm = SCALE_Y1 - SCALE_Y0;
    const colHFull = columnH(k.TMax, state.kind);
    const relErr = k.physScale
      ? +(Math.abs(colHFull - spanCm) / spanCm).toFixed(6)
      : null;
    const span = (c.mark0 && c.mark100) ? +(c.mark100.y - c.mark0.y).toFixed(4) : null;
    const perDiv = span == null ? null : +(span / 100).toFixed(6);
    return {
      kind: state.kind,
      physScale: k.physScale,
      tMin: k.TMin, tMax: k.TMax, div: k.div,
      mark0Y: c.mark0 ? c.mark0.y : null,
      mark100Y: c.mark100 ? c.mark100.y : null,
      mark0T: c.mark0 ? c.mark0.T : null,
      mark100T: c.mark100 ? c.mark100.T : null,
      mark0Settled: c.mark0 ? c.mark0.settled : null,
      mark100Settled: c.mark100 ? c.mark100.settled : null,
      divided: c.divided,
      msg: c.msg,
      span, perDiv,
      cmPerDeg: +cmPerDeg(k).toFixed(6),
      exp0Y: +calYOf(0, state.kind).toFixed(4),
      exp100Y: +calYOf(100, state.kind).toFixed(4),
      colHFull: +colHFull.toFixed(4),
      scaleHSpan: +spanCm.toFixed(4),
      relErr,
      boreR: BORE_R, aBore: +A_BORE.toFixed(6),
      vBulb: +V_BULB.toFixed(6), beta: BETA_APP,
      rLiqBulb: R_LIQ_BULB,
      canDivide: !!(k.physScale && c.mark0 && c.mark100 && c.mark0.settled && c.mark100.settled),
      nDiv: calNDiv(state.kind),
      /* 等分线在剖面里的高度（管身局部坐标 cm），共 nDiv+1 条（含两端） */
      divLines: c.divided && c.mark0 && c.mark100
        ? Array.from({ length: calNDiv(state.kind) + 1 }, (_, i) =>
          +(c.mark0.y + span * i / calNDiv(state.kind)).toFixed(4))
        : []
    };
  }

  /* ==========================================================================
     六点六、温度计原理剖面（顺序 5 新增）
     --------------------------------------------------------------------------
     剖面要讲清一件事：泡里那团液体受热膨胀，多出来的体积挤进细管，液柱才升高。
         h(T) = V_BULB · β · (T − TMin) / A_BORE
     纵轴的 cm → px 是【同一个比例尺】，液柱顶端与 3D 管身上的刻度严格同源（都走 scaleYOf）。
     玻璃泡在图上按真实比例只有 8 px，看不见 ⇒ 放大画，倍数记进 state.drawn.pr 供自检核对；
     液柱高度【不放大】，所以「h 与刻度同源」这件事在图上仍然成立。
     ========================================================================== */
  const prCanvas = $('prCanvas');
  const prText = $('prText');
  const prLegend = $('prLegend');
  const cal0Btn = $('cal0Btn');
  const cal100Btn = $('cal100Btn');
  const calDivBtn = $('calDivBtn');
  const calMsg = $('calMsg');
  function drawPrinciple() {
    if (!prCanvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = prCanvas.clientWidth || 320;
    const H = prCanvas.clientHeight || 236;
    if (prCanvas.width !== Math.round(W * dpr) || prCanvas.height !== Math.round(H * dpr)) {
      prCanvas.width = Math.round(W * dpr);
      prCanvas.height = Math.round(H * dpr);
    }
    const g = prCanvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#0a1a2b'; g.fillRect(0, 0, W, H);

    const k = KINDS[state.kind];
    const padT = 16, padB = 15;
    /* ★ 唯一的纵向比例尺：把管身的 [SCALE_Y0, SCALE_Y1] 铺满可用高度 */
    const pxPerCm = (H - padT - padB) / (SCALE_Y1 - SCALE_Y0);
    const Y = (cm) => H - padB - cm * pxPerCm;
    const cx = Math.round(W * 0.42);
    const borePx = Math.max(9, Math.round(W * 0.030));
    const halfBore = borePx / 2;
    const bulbRTrue = pxPerCm * R_LIQ_BULB;
    const bulbR = Math.max(15, Math.round(bulbRTrue * 2.6));
    const bulbMag = bulbR / bulbRTrue;
    const bulbCy = Y(0) + bulbR + 3;

    const tubeL = cx - halfBore - 5, tubeR = cx + halfBore + 5;
    const tubeTop = Y(SCALE_Y1) - 6, tubeH = Y(0) - tubeTop + 9;
    g.fillStyle = 'rgba(210,236,250,0.13)'; g.fillRect(tubeL, tubeTop, tubeR - tubeL, tubeH);
    g.strokeStyle = 'rgba(190,225,245,0.55)'; g.lineWidth = 1.2;
    g.strokeRect(tubeL, tubeTop, tubeR - tubeL, tubeH);
    g.beginPath(); g.arc(cx, bulbCy, bulbR, 0, 7);
    g.fillStyle = 'rgba(210,236,250,0.16)'; g.fill();
    g.strokeStyle = 'rgba(190,225,245,0.6)'; g.stroke();

    /* 液体：泡里那团 + 管里的液柱。液柱顶端 = scaleYOf(示数) —— 与 3D 同源。 */
    const Tshow = clamp(state.Td, k.TMin, k.TMax);
    const colTopCm = scaleYOf(Tshow, k);
    g.fillStyle = '#e0212c';
    g.beginPath(); g.arc(cx, bulbCy, Math.max(2, bulbR - 2.4), 0, 7); g.fill();
    g.fillRect(cx - halfBore, Y(colTopCm), borePx, Math.max(0, Y(0) - Y(colTopCm)));
    g.fillStyle = 'rgba(255,132,140,0.9)';
    g.fillRect(cx - halfBore, Y(colTopCm), borePx, 2);

    /* 两个定标记号：金环画成横线；「标早了」的记号画成虚线，一眼能看出它不作数。
       ★ 只在【定标真的成立】的量程上画：体温计（35 ~ 42 ℃）装不下 0 ℃ 与 100 ℃，
         标在它身上就是误导 —— 而上一支温度计标出来的记号本来就已经被清掉了，
         这里再拦一道，免得以后又冒出一条「记号跟着仪器走」的路径。 */
    const calOn = k.physScale;
    /* markDrawn 数的是【真正画出去的金环条数】—— 不能写成「calOn ? 2 : 0」，
       那是意图值：把 drawMark 里的 return 条件改坏，账本照样报 2。 */
    let markDrawn = 0;
    const drawMark = (m, txt) => {
      if (!m || !calOn) return;
      const y = Y(m.y);
      g.save();
      g.strokeStyle = m.settled ? '#fbbf24' : '#fb7185';
      g.lineWidth = 2;
      g.setLineDash(m.settled ? [] : [5, 4]);
      g.beginPath(); g.moveTo(tubeL - 26, y); g.lineTo(tubeR + 8, y); g.stroke();
      g.restore();
      g.font = '700 10.5px "Helvetica Neue", Arial, sans-serif';
      g.textAlign = 'right'; g.textBaseline = 'middle';
      g.fillStyle = m.settled ? '#fbbf24' : '#fb7185';
      g.fillText(txt + (m.settled ? '' : ' 标早了'), tubeL - 30, y);
      markDrawn++;
    };
    drawMark(state.cal.mark0, '0 ℃');
    drawMark(state.cal.mark100, '100 ℃');

    /* 等分：101 条细线（每 10 份加粗），画在两个记号之间。
       ★ divDrawn 数的是【真正画出去的行数】—— 不能写成「divided ? 101 : 0」，
       那是意图值：把循环上界改成 50，账本照样报 101，自检全绿。 */
    let divDrawn = 0;
    if (calOn && state.cal.divided && state.cal.mark0 && state.cal.mark100) {
      const y0 = state.cal.mark0.y, y1 = state.cal.mark100.y;
      for (let i = 0; i <= calNDiv(); i++) {
        const yy = Y(y0 + (y1 - y0) * i / calNDiv());
        const major = i % 10 === 0;
        g.strokeStyle = major ? 'rgba(251,191,36,0.88)' : 'rgba(251,191,36,0.32)';
        g.lineWidth = major ? 1.3 : 0.7;
        g.beginPath(); g.moveTo(tubeL, yy); g.lineTo(tubeR, yy); g.stroke();
        divDrawn++;
      }
    }

    /* 液柱高度 h 的标注 */
    if (colTopCm > 0.3) {
      g.strokeStyle = 'rgba(125,211,252,0.9)'; g.lineWidth = 1;
      const xr = tubeR + 15;
      g.beginPath(); g.moveTo(xr, Y(0)); g.lineTo(xr, Y(colTopCm)); g.stroke();
      g.beginPath(); g.moveTo(xr - 5, Y(0)); g.lineTo(xr + 5, Y(0)); g.stroke();
      g.beginPath(); g.moveTo(xr - 5, Y(colTopCm)); g.lineTo(xr + 5, Y(colTopCm)); g.stroke();
      g.font = '700 10.5px "Helvetica Neue", Arial, sans-serif';
      g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillStyle = '#7dd3fc';
      g.fillText('h = ' + colTopCm.toFixed(2) + ' cm', xr + 8, (Y(0) + Y(colTopCm)) / 2);
    }
    g.font = '10px "Helvetica Neue", Arial, sans-serif';
    g.textAlign = 'left'; g.textBaseline = 'bottom';
    g.fillStyle = 'rgba(160,190,215,0.9)';
    g.fillText('玻璃泡放大 ' + bulbMag.toFixed(1) + '× 画 · 液柱不放大', 6, H - 3);

    /* 画出去的几何记账（自检只读这里，不自己重算） */
    state.drawn.pr = {
      pxPerCm: +pxPerCm.toFixed(5),
      colTopCm: +colTopCm.toFixed(4),
      colTopPx: +Y(colTopCm).toFixed(2),
      y0Px: +Y(0).toFixed(2),
      bulbRpx: bulbR,
      bulbMag: +bulbMag.toFixed(3),
      mark0Px: state.cal.mark0 ? +Y(state.cal.mark0.y).toFixed(2) : null,
      mark100Px: state.cal.mark100 ? +Y(state.cal.mark100.y).toFixed(2) : null,
      divLineCount: divDrawn,
      markDrawn,
      Tshow: +Tshow.toFixed(3),
      kind: state.kind
    };

    const ci = calInfo();
    if (prLegend) {
      prLegend.innerHTML = '泡容积 <b>V₀ = ' + ci.vBulb.toFixed(3) + ' cm³</b>'
        + ' · 视膨胀系数 <b>β = 1.0×10⁻³ /℃</b>'
        + ' · 内孔半径 <b>' + (ci.boreR * 10).toFixed(2) + ' mm</b>';
    }
    if (prText) {
      /* ★ 文案必须跟着量程走。写成「比 0 ℃ 高」「100 ℃ 处」的话，换到体温计
         （35 ~ 42 ℃）就全是错的：0 ℃ 与 100 ℃ 都不在量程里，而且 scaleYOf(100)
         会被一路外推到 75 cm，于是印出「差 99.4%」这种假误差（顺序 5 上线后实测到的）。 */
      prText.textContent = '示数 ' + Tshow.toFixed(1) + ' ℃ ⇒ 液柱比 ' + k.TMin + ' ℃ 高 '
        + colTopCm.toFixed(2) + ' cm。'
        + (k.physScale
          ? '升到 ' + k.TMax + ' ℃ 时：物理式 h = ' + ci.colHFull.toFixed(2) + ' cm，管上刻度 '
            + ci.scaleHSpan.toFixed(2) + ' cm，差 ' + (ci.relErr * 100).toFixed(1)
            + '%（内孔粗细是按真实值选的，不是照刻度反推的）。'
          : '体温计的量程只有 ' + k.TMin + ' ~ ' + k.TMax + ' ℃、分度值 ' + k.div + ' ℃ —— '
            + '同一根管子上要容下 ' + (k.TMax - k.TMin) + ' ℃ 的刻度，真实体温计靠的是把内孔'
            + '做到 0.1 mm 量级（比实验室温度计细得多）。本剖面为了与上方 3D 管身共用'
            + '同一比例尺，不在这里报「物理式对刻度」的误差。');
    }
  }

  /* 水色 / 冰块 / 白气：让「水温」在画面上也看得见 */
  const COLD = new THREE.Color('#9fd4ea');
  const HOT = new THREE.Color('#e2eef2');
  const _tmpCol = new THREE.Color();
  function updateWater() {
    const v = clamp((state.TwVis - 10) / 90, 0, 1);
    _tmpCol.copy(COLD).lerp(HOT, v);
    waterMat.color.copy(_tmpCol);
    waterTop.material.color.copy(_tmpCol);
    ices.visible = state.TwVis < 3;
    for (const m of steams) m.visible = toggles.steam && state.TwVis > 68;
  }

  /* ==========================================================================
     七、示数—时间图像
     ========================================================================== */
  const chartCanvas = $('chartCanvas');
  const series = [];
  let sampleAcc = 0;
  function pushSample() {
    series.push([state.t, reading()]);
    if (series.length > 2400) series.splice(0, 800);
  }
  function drawChart() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = chartCanvas.clientWidth || 640;
    const H = chartCanvas.clientHeight || 232;
    if (chartCanvas.width !== Math.round(W * dpr) || chartCanvas.height !== Math.round(H * dpr)) {
      chartCanvas.width = Math.round(W * dpr);
      chartCanvas.height = Math.round(H * dpr);
    }
    const g = chartCanvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    const padL = 44, padR = 16, padT = 14, padB = 26;
    const pw = W - padL - padR, ph = H - padT - padB;
    const tMax = Math.max(45, Math.ceil((state.t + 6) / 15) * 15);
    const k = KINDS[state.kind];
    let lo = Math.min(state.Td, state.Tw, reading()) - 4;
    let hi = Math.max(state.Td, state.Tw, reading()) + 4;
    if (hi - lo < 10) { const c = (lo + hi) / 2; lo = c - 5; hi = c + 5; }
    lo = Math.max(lo, k.TMin - 2); hi = Math.min(hi, k.TMax + 2);
    const X = (t) => padL + (t / tMax) * pw;
    const Y = (T) => padT + (hi - T) / (hi - lo) * ph;

    g.fillStyle = '#0a1a2b'; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(120,150,180,0.16)';
    g.lineWidth = 1;
    g.font = '10px "Helvetica Neue", Arial, sans-serif';
    g.fillStyle = 'rgba(150,180,205,0.85)';
    g.textAlign = 'right'; g.textBaseline = 'middle';
    const stepT = (hi - lo) / 5;
    for (let i = 0; i <= 5; i++) {
      const T = lo + i * stepT, y = Y(T);
      g.beginPath(); g.moveTo(padL, y); g.lineTo(W - padR, y); g.stroke();
      g.fillText(T.toFixed(hi - lo < 12 ? 1 : 0), padL - 6, y);
    }
    g.textAlign = 'center'; g.textBaseline = 'top';
    for (let i = 0; i <= 4; i++) {
      const t = tMax * i / 4;
      g.fillText(t.toFixed(0), X(t), H - padB + 6);
    }
    g.fillText('时间 / s', W - padR - 26, H - padB + 6);

    /* 真实水温参考线 */
    if (toggles.trueLine) {
      g.save();
      g.strokeStyle = 'rgba(134,239,172,0.85)';
      g.lineWidth = 1.6;
      g.setLineDash([6, 5]);
      g.beginPath(); g.moveTo(padL, Y(state.Tw)); g.lineTo(W - padR, Y(state.Tw)); g.stroke();
      g.restore();
    }
    /* 示数曲线 */
    if (series.length > 1) {
      g.strokeStyle = '#7dd3fc';
      g.lineWidth = 2.4;
      g.beginPath();
      series.forEach(([t, T], i) => {
        const x = X(t), y = Y(clamp(T, lo, hi));
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      });
      g.stroke();
      const last = series[series.length - 1];
      g.fillStyle = '#7dd3fc';
      g.beginPath(); g.arc(X(last[0]), Y(clamp(last[1], lo, hi)), 3.4, 0, 7); g.fill();
    }
    g.fillStyle = 'rgba(125,211,252,0.9)';
    g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillText(`${k.name} · 分度值 ${k.div} ℃ · 量程 ${k.TMin} ~ ${k.TMax} ℃`, padL + 4, padT + 2);
  }

  /* ==========================================================================
     八、读数放大镜（把刻度放大成能读数的样子 + 把「视差」画出来）
     ========================================================================== */
  const magCanvas = $('magCanvas');
  const magText = $('magText');
  const magLegend = $('magLegend');
  const magBox = $('magBox');
  const magToggle = $('magToggle');
  const magBody = $('magBody');
  /* 示意图（管径已放大）：右边是眼睛，左边是玻璃管的侧视剖面。
     刻度面在靠近眼睛的一侧，红色液柱在管中心 —— 视线斜着穿过去，
     与刻度面相交的位置就和液柱的真实高度错开了。

     ★ 几何全部按画布尺寸【成比例】算。旧版把 26/52/39/112 写死，只对 218×112
       的小画布成立，画布一放大就全挤到左上角、右边空一大片。
     ★ MAG_T = (刻度面x − 眼x) / (轴心x − 眼x)，就是【视差的放大倍数】。
       画面上「视线与刻度面的交点」相对液柱顶的偏移，必须【等于】真实偏差换算到
       刻度上的距离 —— 否则图上量出来的偏移与文字里说的「偏 1.3 ℃」是同一件事的
       两个数（本仓已有过一次同形教训）。所以先定 MAG_T，再由它【反解】刻度面位置。
     ★ 三级刻线（长 / 中 / 短）不是另画一套，而是与 3D 模型里 makeScale() 印在管身上
       的刻度【同源】：同一组 k.numStep / k.longStep / k.div，同一组长度比 16 : 11 : 6。
       用户说的「有长有短、第 5 格是半个格、数字标 60 和 70」正是这个 ——
       旧版每格画等长线并逐格标数字（61 / 62 / 63…），真实温度计上没有这种刻度。
     ★ 窗口中心【吸到长格上】，于是液柱在窗口里占多少会随示数变（25% ~ 75%），
       而不是永远 50% —— 「液柱所占的比例」才真的看得出来。 */
  const MAG_T = 0.60;
  const TICK_RATIO = { num: 16, long: 11, minor: 6 };   // 抄自 makeScale() 的 16 / 11 / 6
  const TICK_W = { num: 2.2, long: 1.7, minor: 1.1 };
  const TICK_FRAC = 0.80;                                // 长线占管宽的比例
  function drawMag() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = magCanvas.clientWidth || 320;
    const H = magCanvas.clientHeight || 250;
    if (magCanvas.width !== Math.round(W * dpr) || magCanvas.height !== Math.round(H * dpr)) {
      magCanvas.width = Math.round(W * dpr);
      magCanvas.height = Math.round(H * dpr);
    }
    const g = magCanvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#0a1a2b'; g.fillRect(0, 0, W, H);

    const k = KINDS[state.kind];
    /* 一个长格 = 几个小格。实验室温度计 10 ℃ / 1 ℃ = 10，体温计 1 ℃ / 0.1 ℃ = 10 ——
       两种温度计都是 10，所以窗口一律 20 个小格（上下各一个长格）。 */
    const perNum = Math.round(k.numStep / k.div);
    const perLong = Math.round(k.longStep / k.div);
    const padY = Math.max(12, H * 0.05);
    const pxPerDiv = (H - 2 * padY) / (2 * perNum);
    /* 窗口上下沿（= 刻度区的上下沿）。★ 必须定义在 colTopY 之前 ——
       负向对照里有一条要把液柱顶钉在窗口正中（正是旧版的行为），会用到这两个量；
       放在后面会变成 TDZ 报错，那条对照就退化成「页面崩溃」，测不到东西了。 */
    const tubeTop = padY, tubeBot = H - padY;

    /* 窗口中心吸到长格上（round 到 numStep 的整数倍），并且不许跑到量程之外 ——
       否则体温计顶到 42 ℃ 时窗口里会一条刻度都没有。 */
    const numLo = Math.ceil(k.TMin / k.numStep), numHi = Math.floor(k.TMax / k.numStep);
    const rDiv = state.Td / k.div;                        // 示数在第几个小格
    const cNum = Math.min(numHi, Math.max(numLo, Math.round(rDiv / perNum)));
    const cDiv = cNum * perNum;                           // 窗口中心的格号（落在长格上）
    const loDiv = cDiv - perNum, hiDiv = cDiv + perNum;
    const yOfDiv = (i) => padY + (hiDiv - i) * pxPerDiv;
    /* 示数可能被钳在量程外（体温计插进 65 ℃ 的水）—— 画液柱时钳回窗口内，
       免得画到画布外面去；colClamped 记下这件事，自检分开断言。 */
    const rDraw = Math.min(hiDiv, Math.max(loDiv, rDiv));
    const colTopY = yOfDiv(rDraw);
    const colClamped = Math.abs(rDraw - rDiv) > 1e-9;
    const fs = Math.max(9, Math.min(13, pxPerDiv * 1.15));

    /* 眼睛在右，刻度面在玻璃管朝眼睛的那一侧（右边缘）；由 MAG_T 反解它的位置 */
    const eyeX = W - 21;
    const axis = W * 0.52;
    const tubeR = MAG_T * axis + (1 - MAG_T) * eyeX;
    const tubeL = 2 * axis - tubeR;
    const tubeW = tubeR - tubeL;

    /* 玻璃管剖面 */
    g.fillStyle = 'rgba(150,200,225,0.13)';
    g.fillRect(tubeL, tubeTop, tubeW, tubeBot - tubeTop);
    g.strokeStyle = 'rgba(180,220,240,0.5)';
    g.lineWidth = 1;
    g.strokeRect(tubeL + 0.5, tubeTop + 0.5, tubeW - 1, tubeBot - tubeTop - 1);

    /* 刻度：三级，长度比与 3D 模型印在管身上的那一套完全一致。数字【只】标在长线上，
       所以「标了数字的刻度」远少于刻度总数 —— 真实温度计就是每 10 格标一个数，
       中间全是小格（旧版每格都标，那是把放大镜画成了一把尺子）。 */
    const lenOf = {
      num: tubeW * TICK_FRAC,
      long: tubeW * TICK_FRAC * TICK_RATIO.long / TICK_RATIO.num,
      minor: tubeW * TICK_FRAC * TICK_RATIO.minor / TICK_RATIO.num
    };
    const ticks = [], tickVals = [], tickYs = [], tickKinds = [], tickLens = [];
    const labelVals = [], labelYs = [];
    g.font = `600 ${fs.toFixed(1)}px "Helvetica Neue", Arial, sans-serif`;
    g.textAlign = 'right'; g.textBaseline = 'middle';
    for (let i = Math.ceil(loDiv - 1e-9); i <= Math.floor(hiDiv + 1e-9); i++) {
      const T = i * k.div;
      /* 量程之外没有刻度 —— 体温计 42 ℃ 以上就是空白，不该凭空画出来 */
      if (T < k.TMin - 1e-9 || T > k.TMax + 1e-9) continue;
      const y = yOfDiv(i);
      if (y < tubeTop - 0.5 || y > tubeBot + 0.5) continue;
      /* 整除判定用【整数格号】做，不用浮点比值 —— i * div 会攒出 1e-14 级的误差 */
      const isNum = i % perNum === 0;
      const isLong = !isNum && i % perLong === 0;
      const kind = isNum ? 'num' : (isLong ? 'long' : 'minor');
      const isZero = Math.abs(T) < 1e-9;          // 0 ℃ 是摄氏温度的定标点，单独标色
      g.strokeStyle = isZero ? 'rgba(125,211,252,0.95)'
        : (kind === 'num' ? 'rgba(228,241,251,0.94)'
          : (kind === 'long' ? 'rgba(206,228,244,0.76)' : 'rgba(184,210,232,0.52)'));
      g.lineWidth = isZero ? TICK_W.num : TICK_W[kind];
      /* 刻线【从管子左沿往右长】—— 数字就在左沿外侧，三者紧挨着；
         若改成从右沿往左长，短线会孤零零贴在右边、左边空一大片（看着像一把梳子）。
         右沿（tubeR）仍是几何上的「刻度面」，视线在那里与刻度相交。 */
      g.beginPath(); g.moveTo(tubeL, y); g.lineTo(tubeL + lenOf[kind], y); g.stroke();
      if (kind === 'num') {
        g.fillStyle = isZero ? '#7dd3fc' : 'rgba(228,241,251,0.96)';
        g.fillText(T.toFixed(k.dec), tubeL - 8, y);
        labelVals.push(+T.toFixed(4)); labelYs.push(+y.toFixed(2));
      }
      ticks.push({ T: +T.toFixed(4), y: +y.toFixed(2), kind, len: +lenOf[kind].toFixed(2) });
      tickVals.push(+T.toFixed(4)); tickYs.push(+y.toFixed(2));
      tickKinds.push(kind); tickLens.push(+lenOf[kind].toFixed(2));
    }
    /* 刻度面（朝眼睛的那一侧）压在刻度右端上 */
    g.strokeStyle = 'rgba(226,240,250,0.9)';
    g.lineWidth = 2.4;
    g.beginPath(); g.moveTo(tubeR, tubeTop); g.lineTo(tubeR, tubeBot); g.stroke();

    /* 液柱（在管中心，从液柱顶一直填到窗口底）—— 画在刻度之后，盖住穿过它的那些刻度。
       「液柱占了这段刻度的多少」= (窗口底 − 液柱顶) / 窗口高，随示数在 25% ~ 75% 之间变。 */
    const colW = Math.max(6, W * 0.022);
    g.fillStyle = '#e0212c';
    g.fillRect(axis - colW / 2, colTopY, colW, tubeBot - colTopY);
    g.fillStyle = '#ff5a63';
    g.beginPath();
    g.ellipse(axis, colTopY, colW / 2 + 1, Math.max(2, colW * 0.42), 0, 0, Math.PI * 2);
    g.fill();
    const colFrac = (tubeBot - colTopY) / (tubeBot - tubeTop);

    /* 视差：把真实偏差（℃）换算成刻度上的像素距离 */
    const biasPx = sightBias() / k.div * pxPerDiv;
    const crossWant = colTopY - biasPx;
    /* 由「视线必须穿过液柱顶端」反解眼睛该多高 */
    let eyeY = colTopY - biasPx / (1 - MAG_T);
    let eyeClamped = false;
    const eyeLo = 12, eyeHi = H - 12;
    if (eyeY < eyeLo) { eyeY = eyeLo; eyeClamped = true; }
    if (eyeY > eyeHi) { eyeY = eyeHi; eyeClamped = true; }
    /* 眼睛被钳住时以【实际眼位】重新解交点 —— 保证画面自洽（线确实穿过液柱顶）。
       此时图上偏移不再等于 biasPx，eyeClamped 把这件事记下来，自检分开断言。 */
    const crossY = eyeY + MAG_T * (colTopY - eyeY);
    const hasBias = Math.abs(sightBias()) > 1e-9;

    /* 液柱真实高度 */
    g.save();
    g.strokeStyle = 'rgba(255,150,150,0.9)';
    g.setLineDash([4, 3]); g.lineWidth = 1;
    g.beginPath(); g.moveTo(tubeL - 6, colTopY); g.lineTo(tubeR + 9, colTopY); g.stroke();
    g.restore();
    /* 视线：从眼睛穿过液柱顶端，延长到刻度面 */
    g.strokeStyle = 'rgba(56,224,255,0.9)';
    g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(eyeX, eyeY); g.lineTo(tubeR, crossY); g.stroke();
    /* 眼睛以为的高度 */
    if (hasBias) {
      g.strokeStyle = 'rgba(56,224,255,0.95)';
      g.beginPath(); g.moveTo(tubeR, crossY); g.lineTo(tubeR + 9, crossY); g.stroke();
      g.fillStyle = '#38e0ff';
      g.beginPath(); g.arc(tubeR, crossY, 3, 0, 7); g.fill();
    }
    /* 眼睛 */
    const eyeR = Math.max(7, W * 0.027);
    g.fillStyle = '#f4f7fa';
    g.beginPath(); g.arc(eyeX, eyeY, eyeR, 0, 7); g.fill();
    g.fillStyle = '#2f6fb5';
    g.beginPath(); g.arc(eyeX, eyeY, eyeR * 0.55, 0, 7); g.fill();
    g.fillStyle = '#0b1520';
    g.beginPath(); g.arc(eyeX, eyeY, eyeR * 0.25, 0, 7); g.fill();

    /* 标注：每个标签自带一层深色底，压在视线上也读得清 */
    const tag = (txt, x, y, color) => {
      g.font = '700 10px "Helvetica Neue", Arial, sans-serif';
      g.textAlign = 'left'; g.textBaseline = 'middle';
      const w = g.measureText(txt).width;
      g.fillStyle = 'rgba(9,23,41,0.94)';
      g.fillRect(x - 3, y - 7.5, w + 8, 15);
      g.fillStyle = color;
      g.fillText(txt, x, y + 0.5);
    };
    tag('真实高度', tubeR + 12, colTopY, 'rgba(255,170,170,0.98)');
    if (hasBias) {
      /* 两个标签靠太近会叠在一起 —— 把「眼睛以为」推开一点 */
      const ty = Math.abs(crossY - colTopY) < 17 ? crossY + (crossY >= colTopY ? 17 : -17) : crossY;
      tag('眼睛以为', tubeR + 12, ty, 'rgba(56,224,255,0.98)');
    }

    /* 把这次真正画出来的量留给自检 —— 断言要读画面，不能自己重算一遍公式（那是自指） */
    state.drawn.mag = {
      W, H, padY, pxPerDiv, div: k.div, perNum, perLong,
      numStep: k.numStep, longStep: k.longStep, TMin: k.TMin, TMax: k.TMax,
      numLo, numHi, cNum, cDiv, loDiv, hiDiv,
      rDiv: +rDiv.toFixed(4), winLo: +(loDiv * k.div).toFixed(4), winHi: +(hiDiv * k.div).toFixed(4),
      colTopY: +colTopY.toFixed(2), colBotY: +tubeBot.toFixed(2),
      colFrac: +colFrac.toFixed(6), colClamped,
      axis: +axis.toFixed(2), tubeL: +tubeL.toFixed(2), tubeR: +tubeR.toFixed(2),
      tubeTop: +tubeTop.toFixed(2), tubeBot: +tubeBot.toFixed(2), tubeW: +tubeW.toFixed(2),
      eyeX: +eyeX.toFixed(2), eyeY: +eyeY.toFixed(2), eyeR: +eyeR.toFixed(2),
      colW: +colW.toFixed(2),
      biasPx: +biasPx.toFixed(4), crossY: +crossY.toFixed(2), crossWant: +crossWant.toFixed(2),
      eyeClamped, hasBias, eyeOnCanvas: eyeY >= 0 && eyeY <= H,
      ticks, tickVals, tickYs, tickKinds, tickLens, labelVals, labelYs,
      lenOf: { num: +lenOf.num.toFixed(2), long: +lenOf.long.toFixed(2), minor: +lenOf.minor.toFixed(2) },
      fs: +fs.toFixed(2), magT: MAG_T,
      legend: magLegend ? magLegend.textContent : '',
      collapsed: !!state.magCollapsed
    };

    /* 刻度图例：把「长/中/短各是几度」写在图上 —— 这正是用户问的「数字是怎么标的」 */
    if (magLegend) {
      /* ★ 用钳过的 rDraw 算占比：直接用 rDiv 的话，体温计插进 65 ℃ 的水会印出
         「液柱占这段刻度 150%」—— 一个超过 100% 的比例。 */
      const filled = (rDraw - loDiv) / (hiDiv - loDiv);
      magLegend.innerHTML = `长线每 <b>${k.numStep.toFixed(k.dec)}</b> ℃ 一条并标数字　`
        + `中线每 <b>${k.longStep.toFixed(k.dec)}</b> ℃　短线每 <b>${k.div.toFixed(k.dec)}</b> ℃`
        + `<br>液柱占这段刻度 <b>${Math.round(filled * 100)}%</b>`
        + `（${(rDraw - loDiv).toFixed(k.dec)} / ${(hiDiv - loDiv).toFixed(k.dec)} 格）`;
    }

    /* 文案。★ 先判量程：体温计插进 65 ℃ 的水时，说「读到的是液柱的真实高度」是错的 */
    const dT = sightBias();
    if (!inRange()) {
      magText.textContent = '液柱已经顶到量程尽头，读数不可用。';
    } else if (state.sight === 'level') {
      magText.textContent = `视线与液柱上表面相平，读到的是液柱的真实高度（这段刻度里液柱占 ${Math.round(colFrac * 100)}%）。`;
    } else {
      const sgn = dT > 0 ? '偏大' : '偏小';
      magText.textContent = `${SIGHTS[state.sight].short}：视线与刻度面相交的位置比液柱${dT > 0 ? '高' : '低'} `
        + `${Math.abs(dT).toFixed(2)} ℃ 的刻度（图上那两条横线的间距就是这个数），所以读数${sgn}。`;
    }
  }

  /* ---- 折叠 / 展开：放大镜浮在画面右上角，一大就挡场景 ---- */
  function setMagCollapsed(v) {
    state.magCollapsed = !!v;
    if (magBox) magBox.classList.toggle('collapsed', state.magCollapsed);
    if (magBody) magBody.setAttribute('aria-hidden', state.magCollapsed ? 'true' : 'false');
    if (magToggle) {
      magToggle.textContent = state.magCollapsed ? '▸ 展开' : '▾ 折叠';
      magToggle.setAttribute('aria-expanded', state.magCollapsed ? 'false' : 'true');
      magToggle.title = state.magCollapsed ? '展开读数放大镜' : '折叠读数放大镜';
    }
    /* 收起时画布 clientWidth 是 0，展开后必须重画一次才有内容 */
    if (!state.magCollapsed) drawMag();
  }
  if (magToggle) {
    magToggle.addEventListener('click', () => setMagCollapsed(!state.magCollapsed));
    /* 别让这一次按下落到场景画布上（会被当成「开始拖温度计」） */
    ['pointerdown', 'mousedown', 'touchstart'].forEach((ev) =>
      magToggle.addEventListener(ev, (e) => e.stopPropagation()));
  }

  /* ==========================================================================
     九、界面刷新
     ========================================================================== */
  const els = {
    hudRead: $('hudRead'), hudTrue: $('hudTrue'), hudKind: $('hudKind'), hudErr: $('hudErr'),
    metricRead: $('metricRead'), metricTrue: $('metricTrue'), metricErr: $('metricErr'),
    metricPlace: $('metricPlace'), metricRange: $('metricRange'), finding: $('finding')
  };
  function errText() {
    if (!inRange()) return '超出量程';
    const d = rawReading() - state.Tw;
    if (Math.abs(d) < 0.05) return '0.0 ℃';
    return `${d >= 0 ? '+' : ''}${d.toFixed(1)} ℃`;
  }
  /* 玻璃泡此刻算什么状态（读数面板和记录表共用一份说法） */
  function placeText() {
    if (state.grip === 'bench') return '放在台面上';
    if (state.grip === 'hand') return '拿在手里';
    if (state.lifted) return '已提起';
    return PLACES[state.place].short;
  }
  function statusText() {
    if (state.grip === 'bench') return '温度计还在台面上';
    if (state.grip === 'hand') return '正在移动温度计';
    if (!inRange()) {
      return state.Td >= KINDS[state.kind].TMax - 0.05 ? '超出量程' : '低于量程';
    }
    if (state.lifted) return KINDS[state.kind].neck ? '示数被缩口锁住' : '示数正在回落';
    if (state.place !== 'right') return '玻璃泡位置不对';
    if (state.sight !== 'level') return '视线不对';
    return '读数可信';
  }
  function updateReadouts() {
    const k = KINDS[state.kind];
    els.hudRead.textContent = readingText();
    els.hudTrue.textContent = `${state.Tw.toFixed(1)} ℃`;
    els.hudKind.textContent = k.name;
    els.hudErr.textContent = errText();
    els.metricRead.textContent = readingText();
    els.metricTrue.textContent = `${state.Tw.toFixed(1)} ℃`;
    els.metricErr.textContent = errText();
    els.metricPlace.textContent = placeText();
    els.metricRange.textContent = `${k.TMin} ~ ${k.TMax} ℃ / ${k.div} ℃`;

    let hint, warn = false;
    if (state.grip === 'bench') {
      hint = `温度计还<b>横放在实验台上</b>，玻璃泡只和 ${AMB} ℃ 的空气打交道。`
        + `<b>用鼠标点住温度计</b>把它拿起来，移到烧杯口上方再松手 —— 铁架台的铁夹会自动伸过来夹住它。`;
    } else if (state.grip === 'hand') {
      hint = `温度计在你手里。把它移到<b>烧杯口的正上方</b>再松手：落得越靠下，玻璃泡浸得越深；`
        + `贴着杯壁落下去就会碰到杯壁；落点在水面附近就是「只浸入一半」。`
        + `松手的地方要是在杯口之外，温度计会退回实验台。`;
    } else if (state.Td >= k.TMax - 0.05) {
      warn = true;
      hint = `液柱已经顶到管口！${k.name}的量程只有 ${k.TMin} ~ ${k.TMax} ℃，被测温度远高于它的量程 —— `
        + `温度计里的液体膨胀过度，会把玻璃管胀破。测液体温度前<b>先估一估温度、看清量程</b>。`;
    } else if (state.Td <= k.TMin + 0.05) {
      warn = true;
      hint = `液柱已经降到最低端。这个温度低于${k.name}的量程下限 ${k.TMin} ℃，读不出数值 —— 换一支量程合适的温度计。`;
    } else if (state.lifted) {
      hint = k.neck
        ? `体温计的玻璃泡上方有一段很细的<b>缩口</b>：水银通过时被挤过去，离开液体后却退不回来，所以示数<b>冻结</b>在 ${readingText()} —— 这就是体温计能离开人体读数、用前要甩一甩的原因。`
        : `实验室温度计没有缩口，玻璃泡一离开液体，示数立刻向室温回落（现在 ${readingText()}）—— 所以读数时玻璃泡必须<b>留在液体中</b>。`;
    } else if (state.place === 'bottom') {
      warn = true;
      hint = `玻璃泡压在了<b>杯底</b>上。本页的烧杯直接坐在实验台上、<b>没有加热</b>：`
        + `杯底那一层水的温度由「水」和「台面」一起定，而台面就是室温（${AMB} ℃）。`
        + `所以水温比室温高时杯底那层比水体<b>凉</b>，读数偏小 ${errText()}；换成冰水就反过来偏大。`
        + `压住杯底的泡读到的是这一层，不是整杯水的温度。`;
    } else if (state.place === 'wall') {
      warn = true;
      hint = `玻璃泡碰到了<b>杯壁</b>。杯壁内表面的温度由「水侧」和「空气侧」两个热阻一起定：`
        + `水的对流强得多，所以壁温其实很接近水温，偏差只有 ${errText()} 这么小 —— 但它的<b>方向会变</b>：`
        + `水温比室温（${AMB} ℃）高时读数偏低，比室温低时读数偏高。`
        + `偏差小、方向又不可控，这才是规则必须禁它的原因。`;
    } else if (state.place === 'half') {
      warn = true;
      hint = `玻璃泡只浸入一半，另一半露在 ${AMB} ℃ 的空气里。空气的对流换热比水弱得多，`
        + `但露出的那一半仍在往外散热 —— 读数被拉偏 ${errText()}（方向同样随水温与室温的关系变号）。`
        + `规则要求玻璃泡<b>全部浸入</b>，就是为了让它只和被测液体换热。`;
    } else if (state.sight !== 'level') {
      hint = `${SIGHTS[state.sight].name}：刻度印在玻璃管前表面、红色液柱在管中心，两者相隔 ${TH_TUBE_R.toFixed(2)} cm。`
        + `视线斜着穿过时，与刻度相交的位置比液柱的真实高度${sightBias() > 0 ? '高' : '低'} `
        + `${Math.abs(sightBias()).toFixed(2)} ℃ 的刻度 —— 读数${sightBias() > 0 ? '偏<b>大</b>' : '偏<b>小</b>'}。`;
    } else if (state.Td < state.Tw - 0.4) {
      hint = `示数还在往上爬（现在 ${readingText()}，真实水温 ${state.Tw.toFixed(1)} ℃）。玻璃泡和水之间换热需要时间，`
        + `要等示数<b>稳定</b>了再读 —— 刚放进去就读，读到的一定是偏低的数。`;
    } else {
      hint = `玻璃泡全部浸入、不碰杯底杯壁，平视读数，示数已经稳定：读数 ${readingText()}，真实水温 ${state.Tw.toFixed(1)} ℃，`
        + `误差只有 ${errText()}。这就是「会认、会放、会读、会记」四条都做到的样子。`;
    }
    els.finding.className = warn ? 'callout warn' : 'callout';
    els.finding.innerHTML = hint;
  }

  function refreshAll(dt) {
    updateThermo();
    updateWater();
    drawChart();
    drawMag();
    drawPrinciple();
    syncCalUI();
    updateReadouts();
    requestRender();
  }

  /* 定标面板的界面状态：按钮可用性与提示文案。
     一律从 state.cal 与 KINDS[kind].physScale 现算 —— 不另存一份「能不能点」的布尔量，
     否则两边会不同步（只禁用按钮而不在函数里拦，就是「测试能过、直接调能绕」）。
     ★ 体温计（量程 35 ~ 42 ℃）装不下 0 ℃ 与 100 ℃ 两个定标点 ⇒ 三个按钮全禁用，
       并说清「为什么不能标」，而不是留一组点了没反应的按钮。 */
  function syncCalUI() {
    const ci = calInfo();
    const k = KINDS[state.kind];
    if (calMsg) {
      calMsg.textContent = !k.physScale
        ? `${k.name}的量程只有 ${k.TMin} ~ ${k.TMax} ℃，装不下 0 ℃ 与 100 ℃ 两个定标点`
          + `—— 摄氏温度的定标要在实验室温度计上做，先切回去。`
        : (ci.msg || '先点「标定 0 ℃」—— 冰水混合物就是摄氏温度的 0 ℃ 定标点。');
      const bad = (ci.mark0 && !ci.mark0Settled) || (ci.mark100 && !ci.mark100Settled);
      calMsg.className = bad ? 'callout warn' : 'callout';
    }
    if (cal0Btn) cal0Btn.disabled = !k.physScale;
    if (cal100Btn) cal100Btn.disabled = !k.physScale;
    if (calDivBtn) {
      calDivBtn.disabled = !ci.canDivide;
      calDivBtn.textContent = ci.divided
        ? '已等分 100 份（每份 1 ℃）'
        : '把 0 ℃ 与 100 ℃ 之间等分 100 份';
    }
  }

  /* ==========================================================================
     十、动画
     ========================================================================== */
  let dirty = true;
  const requestRender = () => { dirty = true; };
  let clock = 0;

  function animateParts(dt) {
    clock += dt;
    /* 温度计在三种握持状态之间平滑过渡：
         bench → 横躺回台面、hand → 跟着指针、clamped → 竖立插进烧杯。
       位置 (thX, thY)、姿态 tilt、铁夹的 armReach / jawOpen 一起平滑 ——
       「松手之后铁架台自动固定」那一下就是 armReach 收拢 + jawOpen 合拢。 */
    const tg = thermoPoseTarget();
    const ease = (cur, to) => {
      const v = cur + (to - cur) * (1 - Math.exp(-dt * 5.0));
      return Math.abs(to - v) < 0.004 ? to : v;
    };
    state.thX = ease(state.thX, tg.x);
    state.thY = ease(state.thY, tg.y);
    state.tilt = ease(state.tilt, tg.tilt);
    const wantArm = state.grip === 'clamped' ? 0 : ARM_PARK;
    state.armReach = ease(state.armReach, wantArm);
    state.jawOpen = ease(state.jawOpen, state.grip === 'clamped' ? 0 : 1);
    updateThermo();

    /* 白气：从水面往上飘 */
    for (const m of steams) {
      if (!m.visible) continue;
      const u = m.userData;
      u.ph += dt * u.spd;
      const cyc = u.ph % 1;
      m.position.set(Math.cos(u.a) * (u.rad + cyc * 1.5), WATER_TOP + 0.3 + cyc * 6.2, Math.sin(u.a) * (u.rad + cyc * 1.5));
      m.scale.setScalar(u.r0 + cyc * 1.35);
      m.material.opacity = 0.20 * Math.sin(cyc * Math.PI) * (1 - cyc * 0.5);
    }

    /* 眼睛与视线。
       ★ 平视时不画：眼睛与视线存在的意义就是「显示视线歪了」，
         平视时它们只会挡住温度计本身，用户明确要求这种时候不要画。 */
    const k = KINDS[state.kind];
    const readY = state.thY + scaleYOf(clamp(state.Td, k.TMin, k.TMax), k);
    const faceRad = SCALE_FACE_DEG * Math.PI / 180;
    const fx = Math.sin(faceRad), fz = Math.cos(faceRad);
    const tubeX = state.thX, tubeZ = 0;
    const eyeY = readY + SIGHTS[state.sight].dy;
    const eyePos = new THREE.Vector3(tubeX + fx * EYE_DIST, eyeY, tubeZ + fz * EYE_DIST);
    eyeGroup.position.copy(eyePos);
    /* 让虹膜朝着相机，而不是朝着温度计。
       眼球要传达的是「观察者站在哪一侧、比液柱高还是低」，这个信息全在【位置】上；
       朝向则只影响它看起来像不像一只眼睛 —— 朝温度计的话，相机多半从背后看过去，
       只能看到一个没有虹膜的白球，在场景里像一颗莫名其妙浮着的乒乓球。
       视线的方向由那根青色 sightLine 表达，不靠眼球朝向。 */
    eyeGroup.lookAt(camera.position);
    /* 相机离眼球太近就不画（read 视角下相机 ≈ 观察者本人）。
       先量距离再判可见性，自检读的就是这个数。 */
    eyeCamDist = camera.position.distanceTo(eyePos);
    const showObserver = state.sight !== 'level';
    eyeGroup.visible = toggles.eye && showObserver && eyeCamDist > EYE_MIN_DIST;
    sightLine.visible = toggles.sight && showObserver;
    sightDot.visible = toggles.sight && showObserver;
    if (showObserver) {
      /* 视线：眼睛 → 液柱顶端。与刻度面（半径 SCALE_R 的圆柱面）的交点由
         s = 1 − r/D 给出，其高度正好是 readY + (r/D)·Δy —— 与 sightBias() 同源，
         所以画出来的交点位置和算出来的读数偏差不可能对不上。 */
      const merTop = new THREE.Vector3(tubeX, readY, tubeZ);
      const sCross = 1 - SCALE_R / EYE_DIST;
      const cross = eyePos.clone().lerp(merTop, sCross);
      orientSegment(sightLine, eyePos, merTop);
      sightDot.position.copy(cross);
    }
  }

  /* ==========================================================================
     十一、相机与交互
     ========================================================================== */
  function updateCamera() {
    /* 读数特写跟着玻璃泡升降：注视点整体平移，视角 / 距离 / 缩放都不动。
       （平移相机与注视点是同一个变换，所以用户手动环绕出来的姿态不会被这一下丢掉。） */
    const dy = followRead ? PLACE_POS[state.place].y - PLACE_POS.right.y : 0;
    const t = new THREE.Vector3(view.tx || 0, view.ty + dy, 0);
    /* 画布比参考比例窄就往后退，保证横向不裁（见 REF_ASPECT 那段） */
    const dist = view.dist * (camera.aspect < REF_ASPECT ? REF_ASPECT / camera.aspect : 1);
    const cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
    camera.position.set(
      t.x + dist * cp * Math.sin(view.yaw),
      t.y + dist * sp,
      t.z + dist * cp * Math.cos(view.yaw)
    );
    camera.lookAt(t);
    requestRender();
  }
  /* 放法变了：只有读数特写需要跟着挪，其它视角一动不动 */
  function syncViewToPlace() { if (followRead) updateCamera(); }
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    /* 宽高比变了要【重新推一次相机位置】—— 取景距离跟着比例走，
       只改投影矩阵不改位置的话，窄屏上照样裁（而且相机会停在上一次的比例上）。 */
    updateCamera();
  }

  /* --- 鼠标：点中温度计 = 把它拿起来；点空白 = 环绕视角 --- */
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  /* 拖动平面：过烧杯轴线、也过温度计初始位置的竖直平面 z = 0。
     温度计一开始就横躺在这张平面里，拖动时它只在这张平面内移动 ——
     指针落点 (x, y) 直接就是玻璃泡在杯里 / 杯外的位置，判定不需要再猜深度。 */
  const dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const hitPt = new THREE.Vector3();
  let grabLen = 0;                 // 手指抓在管身的哪一段（泡到手心的距离）
  let mode = 'orbit';              // 'orbit' = 环绕视角，'thermo' = 正在搬温度计
  let dragging = false, lastX = 0, lastY = 0;

  function toNDC(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / Math.max(r.width, 1)) * 2 - 1,
            -((e.clientY - r.top) / Math.max(r.height, 1)) * 2 + 1);
    return ndc;
  }
  /* 指针是不是落在温度计上。矩阵要先手动更新：无头环境里 rAF 不跑，
     renderer.render 可能还没把这一帧的相机 / 温度计姿态写进 matrixWorld，
     而 setFromCamera 用的就是 camera.matrixWorld —— 不更新的话射线还停在上一个视角。 */
  function pointerOnThermo(e) {
    camera.updateMatrixWorld(true);
    thermometer.updateMatrixWorld(true);
    raycaster.setFromCamera(toNDC(e), camera);
    return raycaster.intersectObject(pickProxy, false).length > 0;
  }
  function pointerOnPlane(e) {
    camera.updateMatrixWorld(true);
    raycaster.setFromCamera(toNDC(e), camera);
    return raycaster.ray.intersectPlane(dragPlane, hitPt) ? hitPt : null;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    const p = pointerOnThermo(e) ? pointerOnPlane(e) : null;
    if (p) {
      /* 拿起来。记下抓在管身的哪一段 —— 竖起来之后玻璃泡就在手指正下方那么远的地方。
         不记的话，一点下去玻璃泡会平移到光标位置，看起来像温度计被「吸」过去。 */
      grabLen = clamp(Math.hypot(p.x - state.thX, p.y - state.thY), 0, TH_TUBE_H * 0.92);
      state.grip = 'hand';
      state.lifted = false;
      state.handX = clamp(p.x, -30, 30);
      state.handY = clamp(p.y - grabLen, BENCH_Y, 30);
      mode = 'thermo';
      canvas.style.cursor = 'grabbing';
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      syncButtons(); refreshAll();
      return;
    }
    /* 没点中温度计 → 照旧环绕视角 */
    mode = 'orbit';
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    canvas.style.cursor = 'grabbing';
  });

  canvas.addEventListener('pointermove', (e) => {
    if (mode === 'thermo') {
      const p = pointerOnPlane(e);
      if (p) {
        state.handX = clamp(p.x, -30, 30);
        state.handY = clamp(p.y - grabLen, BENCH_Y, 30);
      }
      updateThermo(); updateReadouts(); requestRender();
      return;
    }
    if (dragging) {
      const dx = (e.clientX - lastX) / Math.max(canvas.clientWidth, 1);
      const dy = (e.clientY - lastY) / Math.max(canvas.clientHeight, 1);
      lastX = e.clientX; lastY = e.clientY;
      view.yaw -= dx * 2.9;
      view.pitch = clamp(view.pitch + dy * 2.2, -0.10, 1.36);
      updateCamera();
      return;
    }
    /* 悬停反馈：指着温度计时换个光标，让人知道这东西能拖 */
    canvas.style.cursor = pointerOnThermo(e) ? 'pointer' : 'grab';
  });

  const endDrag = (e) => {
    if (mode === 'thermo') {
      mode = 'orbit';
      /* 松手：玻璃泡落在哪儿就判成哪种放法；落在杯口之外就退回台面。
         判定走 classifyDrop()，和验收钩子的「模拟松手」是同一个函数。 */
      const place = classifyDrop(state.handX, state.handY);
      if (place) {
        state.place = place;
        state.grip = 'clamped';       // 铁架台的铁夹会自动伸过来夹住
        state.lifted = false;
      } else {
        state.grip = 'bench';
        state.handX = BENCH_X; state.handY = BENCH_Y;
      }
      canvas.style.cursor = 'grab';
      resetRun();
      syncViewToPlace();
      syncButtons(); refreshAll();
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      return;
    }
    dragging = false;
    canvas.style.cursor = 'grab';
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    view.dist = clamp(view.dist * (1 + Math.sign(e.deltaY) * 0.08), 20, 200);
    updateCamera();
  }, { passive: false });

  document.querySelectorAll('[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      Object.assign(view, VIEWS[btn.dataset.view]);
      /* 只有「读数特写」跟着温度计走；换成全景视角就交回固定注视点 */
      followRead = btn.dataset.view === 'read';
      document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b === btn));
      updateCamera();
    });
  });

  /* --- 条件按钮 --- */
  function syncButtons() {
    const mark = (sel, attr, val) => {
      document.querySelectorAll(sel).forEach((b) => b.classList.toggle('active', b.dataset[attr] === val));
    };
    mark('[data-water]', 'water', state.water);
    mark('[data-place]', 'place', state.place);
    mark('[data-sight]', 'sight', state.sight);
    mark('[data-kind]', 'kind', state.kind);
    /* 温度计还横在台面上 / 拿在手里的时候，「提起」无从谈起 —— 直接禁用并说明原因 */
    const lb = $('liftBtn');
    const canLift = state.grip === 'clamped';
    lb.disabled = !canLift;
    lb.classList.toggle('active', canLift && state.lifted);
    lb.textContent = state.lifted ? '把温度计放回水中' : '提起温度计';
    lb.title = canLift ? '把玻璃泡提到水面以上' : '温度计还没放进烧杯 —— 先用鼠标把它拖进去';
    /* 甩一甩只对带缩口的体温计有意义：实验室温度计的水银本来就会自己跟着环境走。
       没有缩口时直接禁用（并说明原因），比让它点了没反应好。 */
    const sb = $('shakeBtn');
    if (sb) {
      const need = !!KINDS[state.kind].neck;
      sb.disabled = !need;
      sb.title = need ? '把水银甩回玻璃泡（示数落到 35 ℃ 以下）'
                      : '实验室温度计没有缩口，示数本来就会跟着水温走，不需要甩';
    }
    /* 平视时眼睛和视线【根本不画】，这两个勾选框跟着失效 —— 一起禁用并说明原因，
       否则点了没反应，看起来像坏了。 */
    const lvl = state.sight === 'level';
    const optLabels = { toggleSight: '视线', toggleEye: '观察者的眼睛' };
    for (const id of Object.keys(optLabels)) {
      const el = $(id);
      if (!el) continue;
      el.disabled = lvl;
      const lab = el.closest('label');
      if (!lab) continue;
      lab.classList.toggle('off', lvl);
      lab.title = lvl
        ? `平视时视线与液柱上表面本来就相平，没有偏差要显示 —— 所以不画${optLabels[id]}。换成俯视 / 仰视就会画出来。`
        : '';
    }
  }
  document.querySelectorAll('[data-water]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.water = btn.dataset.water;
      state.Tw = WATERS[state.water].T;
      resetRun();
      syncButtons(); refreshAll();
    });
  });
  document.querySelectorAll('[data-place]').forEach((btn) => {
    btn.addEventListener('click', () => {
      /* 点按钮 = 直接跳到位。用鼠标把温度计拖进烧杯是另一条路，两条路都通到同一个
         place 状态，所以后面的物理、记录表、曲线完全共用。 */
      state.place = btn.dataset.place;
      state.grip = 'clamped';
      state.lifted = false;
      resetRun();
      syncViewToPlace();
      syncButtons(); refreshAll();
    });
  });
  document.querySelectorAll('[data-sight]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.sight = btn.dataset.sight;
      resetRun();
      syncButtons(); refreshAll();
    });
  });
  document.querySelectorAll('[data-kind]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.kind = btn.dataset.kind;
      /* ★ 换温度计 = 换了一支仪器，上一支管身上的定标记号不能跟着走。
         记号记的是「管身局部高度」，那是相对【那支温度计的刻度】量的；
         搬到量程完全不同的另一支上，同一个高度代表的温度完全不同 ——
         顺序 5 上线后实测：切到体温计，实验室温度计标出来的 0 ℃ / 100 ℃
         金环还挂在管上，而体温计的量程只有 35 ~ 42 ℃。 */
      state.cal.mark0 = null; state.cal.mark100 = null;
      state.cal.divided = false; state.cal.msg = '';
      applyScale(state.kind);
      resetRun();
      syncButtons(); refreshAll();
    });
  });
  $('liftBtn').addEventListener('click', () => {
    if (state.grip !== 'clamped') return;      // 还没放进去，没什么可提的
    state.lifted = !state.lifted;
    resetRun();
    syncButtons(); refreshAll();
  });
    $('resetBtn').addEventListener('click', () => {
      resetSim();
      clearRecords();
      refreshAll();
    });
    $('shakeBtn').addEventListener('click', () => {
      shake();
      syncButtons();
    });
    /* 摄氏温度的定标（顺序 5）。两个标定按钮走同一个 calibrate()，
       下标 0 / 1 就是 CAL_POINTS 的两个定标点 —— 不各写一份。 */
    cal0Btn.addEventListener('click', () => { calibrate(0); syncButtons(); });
    cal100Btn.addEventListener('click', () => { calibrate(1); syncButtons(); });
    calDivBtn.addEventListener('click', () => {
      if (!divideCal()) return;                 // 门禁没过就什么都不做
      syncCalUI();
    });

  const toggleMap = {
    toggleSight: 'sight', toggleEye: 'eye', toggleTrue: 'trueLine', toggleSteam: 'steam'
  };
  Object.keys(toggleMap).forEach((id) => {
    const el = $(id);
    el.addEventListener('change', () => { toggles[toggleMap[id]] = el.checked; refreshAll(); });
  });

  /* ==========================================================================
     十二、步骤与记录
     ========================================================================== */
  const STEPS = [
    { name: '01 认识温度计',
      text: '<strong>先看清这支温度计能不能测。</strong>温度计的原理是液体的<b>热胀冷缩</b>。读数前先认三样东西：'
        + '<b>量程</b>（能测的温度范围）、<b>分度值</b>（一个小格代表多少 ℃）、<b>零刻度</b>在哪。'
        + '实验室温度计 −20 ~ 110 ℃、分度值 1 ℃；体温计只有 35 ~ 42 ℃，分度值 0.1 ℃。'
        + '拿一支体温计去测 65 ℃ 的热水，液柱会一直冲到管口 —— 超出量程是会把温度计胀破的。' },
    { name: '02 会放',
      text: '<strong>玻璃泡要全部浸入被测液体中，不碰容器底，不碰容器壁。</strong>'
        + '温度计一开始<b>横放在实验台上</b>：用鼠标点住它拿起来，移到烧杯口上方再松手，'
        + '铁架台的铁夹会自动伸过来把它夹住。松手的位置就是放法 —— 落得越靠下浸得越深，'
        + '贴着杯壁落下去就是「碰杯壁」，落点在水面附近就是「只浸入一半」。'
        + '也可以直接点右边的四个按钮跳到位。'
        + '试试点「碰到杯底」：本页<b>不加热</b>，烧杯就坐在室温的实验台上，'
        + '杯底那一层水被台面拉向室温 —— 热水时它比水体<b>凉</b>，读数偏小；换成冰水就反过来偏大。' },

    { name: '03 会读',
      text: '<strong>玻璃泡留在液体中，等示数稳定后再读，视线与液柱上表面相平。</strong>'
        + '刚把温度计插进去，示数会慢慢往上爬 —— 玻璃泡和水之间换热要时间，这时读到的数一定偏低。'
        + '再看视线：刻度印在玻璃管前表面、红色液柱在管中心，两者相隔一个管半径。'
        + '俯视时视线斜向下，与刻度相交在液柱<b>上方</b>，读数偏大；仰视则相反。'
        + '<b>平视时不画眼睛和视线</b> —— 它们存在的意义就是显示「视线歪了」，平视时画出来只会挡住温度计。'
        + '点「俯视」或「仰视」，右上角的放大镜会把偏差的由来画出来。' },
    { name: '04 会记',
      text: '<strong>记录要写数值 + 单位。</strong>只写「65」是错的，必须写「65 ℃」。'
        + '点右侧「记录数据」，表格会同时记下读数、真实水温和这一次的误差 —— '
        + '把几种错误放法各记一次，你会看到哪些读数是可信的、哪些完全不能用。' },
    { name: '05 体温计',
      text: '<strong>体温计是特殊设计的温度计。</strong>量程只有 35 ~ 42 ℃、分度值 0.1 ℃（比实验室温度计精确得多）；'
        + '玻璃泡上方有一段很细的<b>缩口</b>，水银通过时被挤上去，离开人体后却退不回来，所以可以'
        + '<b>离开人体读数</b>。先把温度计放进烧杯，再点「提起温度计」（泡还横在台面上时这个按钮是灰的），'
        + '你会看到示数<b>冻结不动</b>；换回实验室温度计做同样的动作，示数立刻往室温回落。'
        + '用前要拿着体温计<b>甩一甩</b>，把水银甩回玻璃泡。' },
    { name: '06 摄氏温度的定标',
      text: '<strong>摄氏温度不是天生的，是规定出来的。</strong>规定的方式就是两个定标点：'
        + '把温度计放进<b>冰水混合物</b>，液柱停住的地方记作 <b>0 ℃</b>；'
        + '放进<b>标准大气压下的沸水</b>，液柱停住的地方记作 <b>100 ℃</b>；'
        + '再把这两点之间<b>等分 100 份</b>，每一份就是 1 ℃。'
        + '点右边「标定 0 ℃」和「标定 100 ℃」各打一个记号（管身上会出现一圈金环）。'
        + '<b>必须在示数稳定之后再打</b> —— 示数还在爬的时候打，记号就是偏的，面板会提示「标早了」。'
        + '两点都标好，再点「等分 100 份」。'
        + '剖面图里那个 h 是算出来的：泡里的液体受热膨胀，多出来的体积 V·β·ΔT 全部摊进细管，'
        + '所以 h = V·β·ΔT / A。管的内孔只有 0.6 mm 粗，就是为了让这么小的膨胀量也能把液柱顶高一大截 —— '
        + '正因为 h 与温度<b>成正比</b>，刻度才能均匀地等分。' }
  ];
  const stepButtons = [...document.querySelectorAll('[data-step]')];
  const stepDetail = $('stepDetail');
  function showStep(i) {
    state.step = i;
    stepButtons.forEach((b, j) => b.classList.toggle('active', j === i));
    stepDetail.innerHTML = STEPS[i].text;
  }
  stepButtons.forEach((b, i) => b.addEventListener('click', () => showStep(i)));
  showStep(0);

  const recordBtn = $('recordBtn'), recordBody = $('records'), recordBodySide = $('recordsSide'),
        summary = $('summary'), recSum = $('recSum'), recordHint = $('recordHint');

  const EMPTY_MAIN = '<tr><td colspan="8" class="empty">尚无记录，先调好条件再点“记录数据”</td></tr>';
  const EMPTY_SIDE = '<tr><td colspan="4" class="empty">还没有记录</td></tr>';
  const HINT_READY = '换一种放法或视线，等示数稳定后点一下 —— 表格会替你算出这次读数差了多少。';
  const HINT_DONE = '已记录。继续换条件再记，最后对照哪几次的读数可信；点「重置」会把表格一起清空。';

  function clearRecords() {
    state.records.length = 0;
    renderRecords();
    recordHint.textContent = HINT_READY;
  }
  function renderRecords() {
    if (!state.records.length) {
      recordBody.innerHTML = EMPTY_MAIN;
      recordBodySide.innerHTML = EMPTY_SIDE;
      summary.textContent = '建议记录：先记一次「全部浸入 + 平视」的正确读数，再逐个改坏条件（碰底 / 碰壁 / 浸一半 / 俯视 / 仰视）各记一次，比较误差的方向和大小。';
      recSum.textContent = '点上面的按钮开始记录。';
      return;
    }
    recordBody.innerHTML = state.records.map((r, i) => `
      <tr class="${r.ok ? 'good' : 'bad'}">
        <td>${i + 1}</td><td>${r.readText}</td><td>${r.Tw.toFixed(1)} ℃</td><td>${r.errText}</td>
        <td>${r.place}</td><td>${r.sight}</td><td>${r.kind}</td><td>${r.ok ? '可信' : '不可信'}</td>
      </tr>`).join('');
    recordBodySide.innerHTML = state.records.map((r, i) => `
      <tr class="${r.ok ? 'good' : 'bad'}">
        <td>${i + 1}</td><td>${r.readText}</td>
        <td>${r.Tw.toFixed(1)}</td><td>${r.errText}</td>
      </tr>`).join('');

    const good = state.records.filter((r) => r.ok);
    const bad = state.records.filter((r) => !r.ok);
    let text;
    if (good.length && bad.length) {
      const worst = bad.reduce((a, b) => (Math.abs(b.err) > Math.abs(a.err) ? b : a));
      text = `${good.length} 次读数可信（全部浸入 + 平视，误差 ${good[0].errText}），`
        + `${bad.length} 次不可信 —— 其中偏差最大的一次是「${worst.place} + ${worst.sight}」，误差 ${worst.errText}。`
        + `同一个水温能读出这么多不同的数，说明温度计的读数完全取决于怎么用。`;
    } else if (bad.length) {
      text = `已记 ${bad.length} 次，但还没有一次是「全部浸入 + 平视」的正确读数 —— 先把条件调对，记一次基准值。`;
    } else if (good.length) {
      text = `已记 ${good.length} 次可信读数，误差都在 ${good[0].errText} 附近。再改坏一个条件（碰底 / 碰壁 / 浸一半 / 俯视 / 仰视）记一次，才有对比。`;
    } else {
      text = `已记录 ${state.records.length} 次。`;
    }
    summary.textContent = text;
    recSum.textContent = text;
  }
  recordBtn.addEventListener('click', () => {
    const k = KINDS[state.kind];
    state.records.push({
      t: state.t, Tw: state.Tw,
      read: reading(), readText: readingText(),
      err: inRange() ? rawReading() - state.Tw : NaN,
      errText: errText(),
      place: placeText(),
      sight: SIGHTS[state.sight].short,
      kind: k.name,
      ok: trustworthy()
    });
    if (state.records.length > 24) state.records.shift();
    renderRecords();
    const wrap = recordBodySide.closest('.rec-wrap');
    if (wrap) wrap.scrollTop = wrap.scrollHeight;
    recordBtn.classList.remove('hit');
    void recordBtn.offsetWidth;
    recordBtn.classList.add('hit');
    recordHint.textContent = HINT_DONE;
    requestRender();
  });
  renderRecords();

  /* ==========================================================================
     十三、启动
     ========================================================================== */
  canvas.style.cursor = 'grab';
  syncButtons();
  snapThermo();                    // 一进来温度计就横躺在台面上，不留过渡
  updateWater();
  updateReadouts();
  drawChart();
  drawMag();
  drawPrinciple();
  syncCalUI();
  updateCamera();
  resize();

  /* 单帧推进。真实 rAF 循环与验收用的驱动钩子走【同一段】代码 ——
     无头沙箱里 requestAnimationFrame 一次都不触发（实测 0 帧/秒），
     若验收自己另抄一遍推进逻辑，改坏这里照样全绿。 */
  let uiAcc = 0;
  function frameStep(dt) {
    stepSim(dt);
    animateParts(dt);

    sampleAcc += dt;
    if (sampleAcc >= 0.35) { sampleAcc = 0; pushSample(); }

    uiAcc += dt;
    if (uiAcc >= 0.1) {
      uiAcc = 0;
      updateWater();
      drawChart();
      drawMag();
      drawPrinciple();
      syncCalUI();
      updateReadouts();
      dirty = true;
    }
    if (dirty) {
      renderer.render(scene, camera);
      dirty = false;
    }
  }

  let last = performance.now();
  (function loop(now) {
    requestAnimationFrame(loop);
    const t = now || performance.now();
    let dt = (t - last) / 1000;
    last = t;
    if (!isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, 0.1);
    frameStep(dt);
  })(last);

  const ro = new ResizeObserver(() => { resize(); drawChart(); drawMag(); drawPrinciple(); });
  ro.observe(stage);
  window.addEventListener('resize', () => { resize(); drawChart(); drawMag(); drawPrinciple(); });

  /* --- 供无头验收脚本读取 --- */
  window.__thLab = {
    state, view, VIEWS, WATERS, PLACES, SIGHTS, KINDS, toggles, series,
    camera, renderer, scene,
    thermometer, thSupport, thScale, thScaleBack, mercury, mercuryBulb, thNeck, calRings,
    eyeGroup, sightLine, sightDot, ices, steams, waterTop, beaker, stand,
    jaws, clampBar, clampHead, pickProxy,
    scaleTex, scaleYOf, scaleCanvasY, cmPerDeg, applyScale,
    thBulbYBase: TH_BULB_Y_BASE, placePos: PLACE_POS, tubeR: TH_TUBE_R, scaleR: SCALE_R, bulbR: TH_BULB_R,
    eyeDist: EYE_DIST, eyeDy: EYE_DY, eyeR: EYE_R, eyeMinDist: EYE_MIN_DIST,
    liftDy: LIFT_DY, clampY: CLAMP_Y, armPark: ARM_PARK, lieRoll: LIE_ROLL,
    bench: { x: BENCH_X, y: BENCH_Y, z: BENCH_Z },
    drop: DROP,
    bkY0: BK_Y0, bkR: BK_R, waterH: WATER_H, waterTopY: WATER_TOP, innerBottom: BK_INNER_BOTTOM,
    consts: { AMB, TAU_TH, TAU_VIS, H_WATER, H_AIR, BOTTOM_K, CONTACT_BOTTOM, WALL_K, CONTACT_WALL, HALF_F, SCALE_Y0, SCALE_Y1 },
    mats: { glassMat, waterMat, thGlassMat, thRedMat },
    envTemp, sightBias, rawReading, reading, readingText, inRange, trustworthy, statusText, errText,
    immersed, classifyDrop, placeText, thermoPoseTarget, snapThermo,
    shake,
    resetSim, resetRun, refreshAll, syncButtons, updateThermo, drawMag, drawChart,
    setMagCollapsed, magBox, magToggle, magBody, magLegend,
    /* 摄氏温度的定标 + 原理剖面（顺序 5） */
    CAL_POINTS, CAL_TOL, BETA_APP, BORE_R, A_BORE, V_BULB, R_LIQ_BULB,
    columnH, calYOf, calNDiv, calibrate, divideCal, calInfo, drawPrinciple, syncCalUI,
    prCanvas, prText, prLegend, calMsg, calDivBtn, cal0Btn, cal100Btn,
    updateCamera, resize, syncViewToPlace, viewFollow: () => followRead,
    /* 直接推进仿真（不依赖真实时间）。走的是与真实循环同一个 stepSim。 */
    advance(seconds) {
      let left = seconds;
      while (left > 0) { const d = Math.min(0.2, left); stepSim(d); left -= d; }
      updateThermo(); updateWater(); pushSample(); updateReadouts(); drawChart(); drawMag();
      drawPrinciple(); syncCalUI();
      return { t: state.t, Td: state.Td, Tw: state.Tw, read: reading(), readText: readingText(), err: reading() - state.Tw };
    },
    /* 模拟一次「拿起来 → 放到 (x, y) → 松手」。走的判定与真实鼠标松手完全同一段代码
       （classifyDrop），所以不存在「测试里能过、真拖不行」的偏差。 */
    dropAt(x, y) {
      state.grip = 'hand';
      state.lifted = false;
      state.handX = x; state.handY = y;
      const place = classifyDrop(x, y);
      if (place) {
        state.place = place;
        state.grip = 'clamped';
      } else {
        state.grip = 'bench';
        state.handX = BENCH_X; state.handY = BENCH_Y;
      }
      resetRun(); syncButtons(); syncViewToPlace(); refreshAll();
      return { place, grip: state.grip, lifted: state.lifted, at: state.place, pose: thermoPoseTarget() };
    },
    /* 无头环境没有 rAF：按固定步长喂帧，走的是与真实循环同一个 frameStep。
       指数平滑（温度计过渡、铁夹收拢、示数滞后、白气）靠它才能推进。 */
    driveAnim(seconds, dt = 1 / 60) {
      const n = Math.max(1, Math.round(seconds / dt));
      for (let i = 0; i < n; i++) frameStep(dt);
      renderer.render(scene, camera);
      return {
        frames: n, thX: state.thX, thY: state.thY, tilt: state.tilt,
        posX: thermometer.position.x, posY: thermometer.position.y,
        rotZ: thermometer.rotation.z, rotX: thermometer.rotation.x,
        grip: state.grip, armReach: state.armReach, jawOpen: state.jawOpen,
        jawZ: jaws.children.map((m) => +m.position.z.toFixed(3)),
        supportY: thSupport.position.y,
        Td: state.Td, read: reading(), lifted: state.lifted, immersed: immersed(),
        eyeVisible: eyeGroup.visible, lineVisible: sightLine.visible,
        eyeCamDist: +eyeCamDist.toFixed(3), follow: followRead,
        camX: +camera.position.x.toFixed(3), camY: +camera.position.y.toFixed(3),
        eyeY: eyeGroup.position.y, eyeX: eyeGroup.position.x, eyeZ: eyeGroup.position.z
      };
    },
    /* 视线与液柱顶端在世界坐标里的落点（供像素 / 几何断言使用）。
       cross 就是视线与刻度面的交点，与 sightBias() 用同一份几何算出来。 */
    sightGeom() {
      const k = KINDS[state.kind];
      const readY = state.thY + scaleYOf(clamp(state.Td, k.TMin, k.TMax), k);
      const faceRad = SCALE_FACE_DEG * Math.PI / 180;
      const fx = Math.sin(faceRad), fz = Math.cos(faceRad);
      const eye = { x: state.thX + fx * EYE_DIST, y: readY + SIGHTS[state.sight].dy, z: fz * EYE_DIST };
      const merTop = { x: state.thX, y: readY, z: 0 };
      const sCross = 1 - SCALE_R / EYE_DIST;
      const cross = {
        x: eye.x + (merTop.x - eye.x) * sCross,
        y: eye.y + (merTop.y - eye.y) * sCross,
        z: eye.z + (merTop.z - eye.z) * sCross
      };
      return { readY, tubeX: state.thX, tubeZ: 0, eye, merTop, cross, sCross };
    },
    /* 印刷刻度条的世界法线：横躺时应当【朝上】（刻度露出来），竖立时朝向 SCALE_FACE_DEG。
       忘了 LIE_ROLL 的话，躺着时法线朝下 —— 画面上是一片空白玻璃，肉眼很难一眼看出画错了。

       注意别写成「局部方位取 SCALE_FACE_DEG 再乘 thScale.matrixWorld」：
       thScale 自己的 rotation.y 已经把刻度条从贴图方位转到 SCALE_FACE_DEG 了，
       再按 SCALE_FACE_DEG 取一次就等于转了两次，测出来的方向是错的（实测躺着时
       得到 (0, −0.88, −0.48)，看着像「朝下偏后」，其实是重复旋转的假象）。
       正确做法：局部方位用【贴图里刻度条真正的中心】360°·u_center。 */
    scaleNormal() {
      const s = scaleTex[state.kind];
      const th = (360 * (s.u0 + s.u1) / 2) * Math.PI / 180;
      thermometer.updateMatrixWorld(true);
      const v = new THREE.Vector3(Math.sin(th), 0, Math.cos(th));
      v.transformDirection(thScale.matrixWorld);
      return { x: +v.x.toFixed(4), y: +v.y.toFixed(4), z: +v.z.toFixed(4) };
    },
    /* 场景体检：数一数点光源、量一量烧杯底落在哪儿。
       酒精灯是场景里唯一带点光源的东西，取消它之后点光源数必须是 0；
       烧杯「直接坐在台面上」则要求它的世界包围盒底面贴在 y ≈ 0。 */
    sceneAudit() {
      scene.updateMatrixWorld(true);
      let pointLights = 0, meshes = 0;
      scene.traverse((o) => {
        if (o.isPointLight) pointLights++;
        if (o.isMesh) meshes++;
      });
      const bb = new THREE.Box3().setFromObject(beaker);
      /* 温度计的包围盒要【排除拾取代理】：那根半径 1.15 的隐形圆柱躺下之后
         会伸到台面以下，Box3 又是按「变换后的 AABB 再取 AABB」，会把它算成
         y = −1.08，看着像「温度计插进台面里」。真正要量的是看得见的那些零件。 */
      const tb = new THREE.Box3();
      for (const c of thermometer.children) { if (c !== pickProxy) tb.expandByObject(c); }
      /* ★ 但排除掉代理之后，Box3 仍然量不准「温度计有没有陷进台面」：
         expandByObject 对每个网格取的是【局部 AABB 的八个角】再变换，旋转过的球体
         那八个角会伸到球面之外 —— 实测躺着的温度计报出 y = −0.104，看着像陷进台面
         1 mm 多，其实玻璃泡稳稳停在 y = 0.03。
         真正可能碰到台面的只有玻璃泡，它是个球：球心世界 y 减半径就是最低点，
         与姿态无关、也与 AABB 无关。两个数一起报，差值就是那条假象的大小。 */
      thBulb.updateWorldMatrix(true, false);
      const bulbY = new THREE.Vector3().setFromMatrixPosition(thBulb.matrixWorld).y;
      return {
        pointLights, meshes,
        beakerMinY: +bb.min.y.toFixed(3), beakerMaxY: +bb.max.y.toFixed(3),
        thermoMinY: +tb.min.y.toFixed(3), thermoMaxY: +tb.max.y.toFixed(3),
        thermoLowY: +(bulbY - TH_BULB_R).toFixed(3), bulbY: +bulbY.toFixed(3)
      };
    },
    /* 世界坐标 → 页面坐标。给「真的用鼠标拖一次」的验收用：
       只有走真实的 pointerdown/move/up 才能证明射线拾取真的接通了，
       光调 dropAt() 是证明不了的（那条路绕过了 Raycaster）。 */
    screenOf(x, y, z) {
      camera.updateMatrixWorld(true);
      const v = new THREE.Vector3(x, y, z).project(camera);
      const r = canvas.getBoundingClientRect();
      return {
        x: r.left + (v.x + 1) / 2 * r.width,
        y: r.top + (1 - v.y) / 2 * r.height,
        ndc: { x: +v.x.toFixed(4), y: +v.y.toFixed(4) }
      };
    },
    /* 取景自检：把器材的极值点投影到 NDC，四个视角都要落在 ±0.98 之内。
       器材的横向铺得很开（左边躺着温度计、右边是铁架台底座），
       只调 VIEWS 的 ty / dist 而不量一遍，很容易把某一头裁掉。 */
    framePoints() {
      camera.updateMatrixWorld(true);
      const placed = PLACE_POS[state.place];
      /* 夹口挂在 thSupport 上，而 thSupport 是【跟着温度计升降】的
         （position.y = 泡位 − 泡的基准位）。写成固定的 CLAMP_Y 会漏掉这一截：
         「碰杯底」时夹口其实已经降到 10.3 附近，自检却以为它还在 14.69 —— 于是
         「器材没被裁到画外」这条断言在最低的那两种放法下是照着假点验的。
         用【目标泡位 placed.y】而不是平滑中的 state.thY：自检经常在动画还没跑完时
         就取景，读平滑值会拿到上一个放法的位置，量出来的又是个假点。 */
      const supY = state.grip === 'clamped' ? placed.y - TH_BULB_Y_BASE : 0;
      const pts = [
        ['rodTop',      0, BASE_H + ROD_H, ROD_Z],
        ['baseL',       -BASE_W / 2, 0, BASE_Z - BASE_D / 2],
        ['baseR',       BASE_W / 2, 0, BASE_Z + BASE_D / 2],
        ['bkTop',       BK_R, BK_Y0 + BK_H, 0],
        ['bkBot',       -BK_R, BK_Y0, 0],
        ['benchBulb',   BENCH_X, BENCH_Y, BENCH_Z],
        ['benchTip',    BENCH_X - TH_TUBE_H, BENCH_Y, BENCH_Z],
        ['placedBulb',  placed.x, placed.y, 0],
        ['placedTop',   placed.x, placed.y + TH_TUBE_H, 0],
        ['clampTop',    0, CLAMP_Y + 1.2 + supY, ROD_Z]
      ];
      const out = {};
      for (const [n, x, y, z] of pts) {
        const v = new THREE.Vector3(x, y, z).project(camera);
        out[n] = { x: +v.x.toFixed(4), y: +v.y.toFixed(4) };
      }
      return out;
    }
  };
})();
