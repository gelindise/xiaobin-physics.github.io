import * as THREE from './assets/optics-three.min.js';

// The apparatus is assembled from dimensioned 3D parts, rather than drawn as a 2D diagram.
// World coordinates are centimetres. The optical axis is (x, AXIS, 0) when the three centres
// are level; each carriage can also slide up and down its own post, so the three centres are
// allowed to part company. Everything optical is therefore written against the *lens centre*
// (lensCy) rather than the constant 12: a thin lens bends light about its own centre, so a
// raised lens simply carries the whole image up with it.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const canvas = $('sceneCanvas');
  const inset = $('screenPreview');
  const insetCtx = inset.getContext('2d');
  // All three carriages ride the same bench rail, so the lens moves too. Positions are
  // stored exactly as printed on the bench scale (0 at the left end cap); u and the
  // screen distance are derived, never stored, so they cannot drift out of step.
  const RULER0 = -65;                 // world x of the printed zero
  const wx = p => p + RULER0;         // printed reading -> world x
  const RAIL = { obj:[1,105], lens:[30,110], screen:[35,147] };
  const MIN_GAP = 6;                  // slides are 6.7 cm long and cannot pass through
  const AUX_GAP = 6;                  // 附加镜固定在主凸透镜前 6 cm，随主镜一起移动
  const LENS_R = 5.65;                // 主镜通光半径，同时用于光路口径和曲面尺寸
  const AXIS = 12;                    // 三心同高时焰心 / 光心 / 屏心的基准高度
  const LIFT_MAX = 4;                 // 每件器材相对基准最多升高 4 cm（立柱的行程）
  const state = {
    f: 10, objP: 35, lensP: 65, scrP: 80,
    extra: 'none', extraF: 12,
    // 三件器材各自沿立柱升降的高度（cm，0 = 三心同高）。分开存而不是存一个绝对值，
    // 是因为「三心差多少」才是要观察的量：像的偏移完全由这三个数决定。
    liftCandle: 0, liftLens: 0, liftScreen: 0,
    // 镜前遮挡板挡住的是【镜片的一部分面积】（0–90%），不是像的一部分：
    // 每个像点都靠整个镜片收集光线，所以像始终完整，只是整体按通过光量变暗。
    occlude: 0,
    sourceY: 12, secondY: 8, second: false, source: 'candle',
    screenRemoved: false, autoScreen: false, observing: false, lastNeedsOff: false,
    // 虚像对照是独立于「透过透镜观察」的教学图层：打开时相机退到侧面，虚像正对镜头，
    // 和实物、量高量距辅助线同屏；关闭时虚像只按物理规律从光屏一侧透过镜片看到。
    compare: false, obsYaw: 0, obsPitch: 0,
    rays: false, virtual: true, labels: false, rayMode: 'all', yaw: -.42, pitch: .21, zoom: 1.06,
    flicker: true,
    step: 0, records: {},
    // Written by updateGhost() each frame: whether the image is currently in the eye's view.
    imageVisible: false, imageOnObjectSide: false, virtualCompare: false,
    get u() { return this.lensP - this.objP; },
    get sd() { return this.scrP - this.lensP; }
  };
  // 三心高度。透镜光心是光学计算的基准：光线绕光心偏折，所以物点、像点、光路口径
  // 全部相对它来量。基准高度 AXIS 只用于"器材默认坐在哪儿"和读数显示。
  const lensCy = () => AXIS + state.liftLens;
  const objCy  = () => AXIS + state.liftCandle;   // 光源组（含发光点标记）的实际高度基准
  const scrCy  = () => AXIS + state.liftScreen;   // 光屏中心的实际高度
  const liftOf = kind => kind === 'candle' ? state.liftCandle : kind === 'lens' ? state.liftLens : state.liftScreen;

  // While a slide is being dragged the framing is frozen: re-framing mid-gesture would move the
  // camera under the pointer, which changes what world x the pointer maps to and makes the slide
  // chase itself. The shot is recomputed once the finger comes up instead.
  let framed = true;
  const CASES = [
    { id: 'far', ratio: 3, name: 'u > 2f', result: '倒立、缩小的实像' },
    { id: 'twice', ratio: 2, name: 'u = 2f', result: '倒立、等大的实像' },
    { id: 'between', ratio: 1.5, name: 'f < u < 2f', result: '倒立、放大的实像' },
    { id: 'focus', ratio: 1, name: 'u = f', result: '无有限距离的像' },
    { id: 'near', ratio: .7, name: 'u < f', result: '正立、放大的虚像' }
  ];
  const descriptions = [
    '<strong>认识器材：</strong>铝合金双槽导轨、带锁紧旋钮的滑座、圆环镜架与半透明膜光屏均是独立的立体部件。关闭光路开关，绕着装置看它们的形状与连接方式 —— 光屏是一片装在金属框里的半透明膜，绕着它转一圈，会发现从背面也能看穿。',
    '<strong>调整三心：</strong>焰心、透镜光心、光屏中心初始同在 12 cm 高度。光具座前沿每小格 0.5 cm，三色指针对应三件器材；左下读数面板同步显示位置，以及物距 u 与像距 v。',
    '<strong>改变物距：</strong>蜡烛、凸透镜、光屏三个滑座都能移动。改变物距后，比较折射光线是汇聚、平行还是发散。',
    '<strong>移动光屏：</strong>u > f 时缓慢移动光屏，从散焦找到清晰实像；还可在主镜前加入凸透镜或凹透镜，先观察原位置变模糊，再根据提示重新调焦。屏是半透明膜，用「背面看光屏」绕到它后面，透过膜照样能看到这个像。',
    '<strong>记录归纳：</strong>记录各物距区域的数据。比较光屏中的像、两个发光点的相对位置，以及焦距与二倍焦距两处分界。'
  ];
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const roundHalf = x => Math.round(x * 2) / 2;
  // 面向学生的措辞：不再把“放大率”用在缩小的像上。
  // m = 像高 / 物高 是中性比值，m<1 表示缩小、m=1 表示等大、m>1 才叫放大。
  function sizeRatio(m){
    const ratio=Math.abs(m);
    if(!Number.isFinite(ratio))return{ratio:NaN,scale:'—',relation:'不成像',phrase:'大小无法比较',record:'—'};
    const equal=Math.abs(ratio-1)<.005;
    const relation=equal?'等大':ratio>1?'放大':'缩小';
    return{
      ratio,scale:ratio.toFixed(2),relation,
      phrase:equal?'与物等大（像高 = 物高）':`像高是物高的 ${ratio.toFixed(2)} 倍（${relation}）`,
      record:`${ratio.toFixed(2)}（${relation}）`
    };
  }
  // 遮挡板从镜片上方压下来，挡住高度 y ≥ 下沿的那一段圆。滑块给的是【被挡住的面积百分比】，
  // 亮度衰减就必须按这块弓形的真实面积算 —— 按高度比例算会在半圆附近差出一大截。
  // 圆半径 R、下沿到圆心距离 h（向下为负）时，上方弓形面积 = R²·arccos(h/R) − h·√(R²−h²)。
  function lensSegmentFraction(h){
    const R=LENS_R,x=clamp(h,-R,R);
    return (R*R*Math.acos(x/R)-x*Math.sqrt(Math.max(0,R*R-x*x)))/(Math.PI*R*R);
  }
  // 反解：给定被挡面积比例，求下沿离圆心的高度差。面积随 h 单调递减，二分即可。
  function occluderCutOffset(){
    const target=clamp(state.occlude,0,90)/100;
    let lo=-LENS_R,hi=LENS_R;
    for(let i=0;i<40;i++){
      const m=(lo+hi)/2;
      if(lensSegmentFraction(m)>target)lo=m;else hi=m;
    }
    return (lo+hi)/2;
  }
  // 下沿的【局部】高度：以透镜组自身坐标为准（透镜组局部 12 就是光心），卡片挂在组里，
  // 所以缩放要用这个值；而判断光线是否被挡住要用世界高度 occluderCutY()。
  const occluderCutLocal = () => AXIS + occluderCutOffset();
  const occluderCutY = () => lensCy() + occluderCutOffset();
  // 通过光量 = 未被挡住的镜片面积比例。像的亮度严格按它缩放。
  const lightThrough = () => 1 - clamp(state.occlude, 0, 90) / 100;
  const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  const hasExtra = () => state.extra !== 'none';
  const extraFocal = () => state.extra === 'concave' ? -state.extraF : state.extraF;
  // 两片薄透镜逐面成像：第一片产生中间像，中间像再作为主凸透镜的物。
  // u2 < 0 表示主镜接收到的是会聚光（虚物），仍严格使用同一高斯公式。
  function optics() {
    const f=state.f,u=state.u;
    if(!hasExtra()){
      const v=near(u,f)?Infinity:f*u/(u-f);
      return {u1:u,v1:null,u2:u,v,m:Number.isFinite(v)?-v/u:NaN,f1:null,d:0};
    }
    const d=AUX_GAP,f1=extraFocal(),u1=u-d;
    // 物在第一片物方焦平面上：两片之间是平行光，主镜在后焦平面成像。
    if(near(u1,f1))return {u1,v1:Infinity,u2:Infinity,v:f,m:-f/f1,f1,d};
    const v1=f1*u1/(u1-f1),u2=d-v1;
    if(near(u2,f))return {u1,v1,u2,v:Infinity,m:NaN,f1,d};
    const v=f*u2/(u2-f),m=v1*v/(u1*u2);
    return {u1,v1,u2,v,m,f1,d};
  }
  function canFocus(info){
    return info.real&&Number.isFinite(info.v)&&info.v>=MIN_GAP-.45
      &&state.lensP+info.v<=RAIL.screen[1]+.45;
  }
  const status = () => {
    const f=state.f,u=state.u,o=optics(),v=o.v;
    const kind = u > 2*f ? 'far' : near(u, 2*f) ? 'twice' : u > f ? 'between' : near(u, f) ? 'focus' : 'near';
    const real=Number.isFinite(v)&&v>0;
    const reachable=real&&v>=MIN_GAP-.45&&state.lensP+v<=RAIL.screen[1]+.45;
    const crisp = reachable && !state.screenRemoved && Math.abs(v-state.sd) <= .45;
    // 像的落点：拿【发光点】的像来量 —— 这是学生眼睛真正盯着的那个点。三心同高、发光点又在
    // 光轴上时正好落在屏心（读数 0）；任一件器材一升降，这个数就变，屏上的像跟着偏。
    // （膜纹理的贴合另有一套算式 artOffY/scrOffY，按 art 画布中心算，两者不混用。）
    const Yc=lensCy();
    const refY=(state.source==='f'?AXIS:state.sourceY)+state.liftCandle;
    const imgY=Number.isFinite(o.m)?Yc+(refY-Yc)*o.m:NaN;
    // A real image can only be received while the screen is on the bench.
    return { ...o, kind, baseKind:kind, real, crisp, inverted:Number.isFinite(o.m)&&o.m<0,
      imgY, offY:Number.isFinite(imgY)?imgY-scrCy():NaN,
      offScreen:Number.isFinite(imgY)&&Math.abs(imgY-scrCy())>9.4,
      needsScreenOff: !real };
  }
  // 接第 4 节「眼睛和眼镜」：镜片的度数 = 100 / f(m)。本页焦距用 cm，所以 度 = 10000 / f。
  // 公式与眼睛页是同一份（那边 f 用 m），cm → m 的换算只在这一处发生。
  const diopterOf = fCm => 100 / (fCm / 100);
  // The letter F is the classic object for showing that a real image is inverted in both
  // directions. Strokes are listed in world (z, y). The lit face points at the lens (+x) and is
  // read from that side: the eye looks along −x, so its screen-right runs along −z, and the
  // upright bar has to sit at z > 0 for the letter to read normally. The screen then receives the
  // pattern rotated 180° (bar at z < 0), so an eye standing behind the source — looking along +x,
  // where right = +z — sees the bar on the left with the long arm at the bottom: both directions
  // reversed, which is what a real image must look like. See FLIP / stampObject below.
  const F_BAR = { z0: 1.78, z1: 2.4,  y0:7.5,  y1:16.5 };  // upright stroke
  const F_TOP = { z0:-2.4,  z1: 2.4,  y0:15.88,y1:16.5 };  // top arm
  const F_MID = { z0:-1.2,  z1: 2.4,  y0:12.6, y1:13.22 }; // middle arm
  const F_STROKES = [F_BAR, F_TOP, F_MID];
  // Three well separated corners used as ray origins and as ghost-image markers. These are
  // absolute world (z, y) on the F itself, not offsets from the axis.
  const F_POINTS = [{ z:2.4, y:16.5 }, { z:-2.4, y:16.5 }, { z:-1.2, y:12.91 }];

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  } catch (_) {
    const notice = document.createElement('div');
    notice.className = 'no-webgl';
    notice.textContent = '当前浏览器无法启动三维渲染。请开启浏览器硬件加速，或使用新版 Chrome / Safari / Edge 后重新打开。';
    $('stage').appendChild(notice);
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // 火焰跳动让画面每帧重画，但火焰不投影 —— 阴影图改成"需要时才重算"（见 render()），
  // 否则每帧都要重画一张 2048² 的阴影图。
  renderer.shadowMap.autoUpdate = false;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#454d53');
  scene.fog = new THREE.Fog('#454d53', 110, 300);
  // A procedural softbox environment supplies believable reflections without remote HDR assets.
  const studio = document.createElement('canvas');studio.width=768;studio.height=384;
  const studioCtx=studio.getContext('2d');
  const envGrad=studioCtx.createLinearGradient(0,0,0,384);
  envGrad.addColorStop(0,'#8d9a9e');envGrad.addColorStop(.42,'#d3d8d4');envGrad.addColorStop(.66,'#7e8d91');envGrad.addColorStop(1,'#373f46');
  studioCtx.fillStyle=envGrad;studioCtx.fillRect(0,0,768,384);
  for(const [x,y,w,h] of [[32,30,145,140],[292,9,92,190],[532,43,161,117]]){
    const g=studioCtx.createLinearGradient(x,0,x+w,0);
    g.addColorStop(0,'#ffffff00');g.addColorStop(.15,'#f7faf3bb');g.addColorStop(.85,'#f7faf3dd');g.addColorStop(1,'#ffffff00');
    studioCtx.fillStyle=g;studioCtx.fillRect(x,y,w,h);
  }
  const envMap=new THREE.CanvasTexture(studio);envMap.mapping=THREE.EquirectangularReflectionMapping;
  envMap.colorSpace=THREE.SRGBColorSpace;scene.environment=envMap;
  scene.environmentIntensity=.80;
  const camera = new THREE.PerspectiveCamera(37, 1, .1, 500);
  const target = V(6, 8, 0);
  const hemi = new THREE.HemisphereLight('#e9f3f7', '#4c5860', 1.35);
  scene.add(hemi);
  const key = new THREE.DirectionalLight('#fff8ed', 2.35);
  key.position.set(-36, 88, 66); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -105; key.shadow.camera.right = 105;
  key.shadow.camera.top = 95; key.shadow.camera.bottom = -95;
  key.shadow.camera.near = 10; key.shadow.camera.far = 245;
  key.shadow.bias = -.00008;
  scene.add(key);
  const edgeLight = new THREE.DirectionalLight('#c9deed', 1.05);
  edgeLight.position.set(35, 50, -65); scene.add(edgeLight);
  const warm = new THREE.PointLight('#fbb979', 9, 26, 1.9);
  warm.position.set(wx(state.objP), 12.5, 2.4); scene.add(warm);

  const material = (color, metalness = 0, roughness = .65, opts = {}) =>
    new THREE.MeshStandardMaterial({ color, metalness, roughness, ...opts });
  const alu = material('#b7bdc0', .54, .33);
  const brightAlu = material('#e0e5e5', .56, .22);
  const chamfer = material('#919ea4', .51, .34);
  const metalDark = material('#36414a', .60, .36);
  const slotBlack = material('#242c31', .32, .68);
  const blackRubber = material('#283036', .05, .9);
  const brass = material('#bd9151', .58, .28);
  const bronze = material('#66543e', .56, .38);
  const cream = material('#e5dbbd', .05, .75);
  const gold = material('#e5a75d', .21, .37, { emissive: '#533019', emissiveIntensity: .38 });
  const blue = material('#64a4ce', .20, .34, { emissive: '#224d66', emissiveIntensity: .38 });
  function mesh(geometry, mat, parent, x = 0, y = 0, z = 0, shadow = true) {
    const m = new THREE.Mesh(geometry, mat);
    m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = true;
    parent.add(m); return m;
  }
  function box(parent, size, position, mat, shadow = true) {
    return mesh(new THREE.BoxGeometry(...size), mat, parent, ...position, shadow);
  }
  function cylinder(parent, radius, height, position, mat, segments = 28) {
    return mesh(new THREE.CylinderGeometry(radius, radius, height, segments), mat, parent, ...position);
  }
  function lineSegment(parent, p1, p2, color, opacity = 1, dashed = false, depthTest = false) {
    const geometry = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    const mat = dashed
      ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 1, gapSize: .75, depthTest })
      : new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest });
    const line = new THREE.Line(geometry, mat);
    if (dashed) line.computeLineDistances();
    line.renderOrder = 8; parent.add(line); return line;
  }
  function labelTexture(text, accent = '#535f69') {
    const c = document.createElement('canvas'); c.width = 320; c.height = 76;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(245,247,243,.96)';g.beginPath();g.roundRect(5,5,310,66,11);g.fill();
    g.strokeStyle = '#bbc7c8';g.lineWidth = 2;g.stroke();
    g.fillStyle = accent; g.font = 'bold 28px sans-serif';g.textAlign = 'center';g.textBaseline = 'middle';
    g.fillText(text, 160, 39, 293);
    const t = new THREE.CanvasTexture(c);t.colorSpace = THREE.SRGBColorSpace;return t;
  }
  function badge(parent, text, pos, accent = '#4f6168', w = 12) {
    const t = labelTexture(text,accent);
    const m = new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, toneMapped: false });
    const s = new THREE.Sprite(m); s.scale.set(w, w*76/320, 1);s.position.set(...pos);s.renderOrder = 20;
    parent.add(s);return s;
  }
  const floor = mesh(new THREE.PlaneGeometry(900, 900), material('#565f64', .03, .94), scene, 5, -5, 0, false);
  floor.rotation.x = -Math.PI/2;
  floor.receiveShadow = true;

  const bench = new THREE.Group(); scene.add(bench);
  const LENGTH = 148, CENTER = 9;
  // Satin extruded rail with two grooves, a front-facing graduated ruler, die-cast end caps and real feet.
  box(bench,[LENGTH,2.1,9.2],[CENTER,.2,0],chamfer);
  box(bench,[LENGTH-.8,.35,9.0],[CENTER,1.42,0],brightAlu);
  box(bench,[LENGTH-.8,.27,8.8],[CENTER,-.94,0],metalDark);
  for (const z of [-2.25, 2.25]) {
    box(bench,[LENGTH-.9,.095,1.25],[CENTER,1.66,z],slotBlack,false);
    box(bench,[LENGTH-.9,.06,.12],[CENTER,1.74,z-.70],brightAlu,false);
    box(bench,[LENGTH-.9,.06,.12],[CENTER,1.74,z+.70],brightAlu,false);
  }
  for (const x of [-65,83]) {
    box(bench,[2.7,3.1,10.5],[x,.15,0],blackRubber);
    box(bench,[.25,2.6,8.4],[x+(x<0?1.5:-1.5),.15,0],brass);
  }
  for (const x of [-57,5,75]) {
    const foot = new THREE.Group(); foot.position.set(x,0,0);bench.add(foot);
    box(foot,[10.2,1.0,16],[0,-2.4,0],metalDark);
    for (const z of [-6.4,6.4]) {
      cylinder(foot,.72,2.0,[0,-3.45,z],blackRubber);
      cylinder(foot,1.5,.45,[0,-4.55,z],blackRubber);
    }
  }
  // A ruler plate is built into the front face of the rail, where the carriages cannot cover it.
  // This follows the real optical-bench convention: a fixed graduated scale on the guide rail,
  // read against an index carried by each sliding carriage.
  const RULER_END = 147, RULER1 = RULER0 + RULER_END, RULER_FACE_Z = 5.45;
  const RULER_PAD = 1.0;                       // 两端留白：0 与 147 才能完整落在板上
  const RULER_W = RULER_END + RULER_PAD * 2;   // 板长
  const RULER_H = 2.05;                        // 板高
  const RULER_CY = .20, RULER_TOP = RULER_CY + RULER_H / 2;
  const rulerCenter = (RULER0 + RULER1) / 2;
  box(bench,[RULER_W+.16,RULER_H+.10,.72],[rulerCenter,RULER_CY,4.97],metalDark,false);
  box(bench,[RULER_W,RULER_H,.12],[rulerCenter,RULER_CY,5.39],cream,false);
  // 整条刻度（底板 + 刻线 + 数字）一次画进一张高分辨率贴图，而不是「1 设备像素的 LineSegments
  // + 十几个 180×80 的数字贴片」：WebGL 的线宽恒为 1 px，斜视时会发灰、闪烁；小贴片一放大就糊。
  // 单张贴图 + mipmap + 各向异性过滤，才能在这种极扁的斜视面上保持锐利，也不会与底板 z-fighting。
  const rulerMaxTex = (renderer.capabilities && renderer.capabilities.maxTextureSize) || 4096;
  const RULER_PPC = Math.max(24, Math.min(64, Math.floor(rulerMaxTex / RULER_W)));
  const rulerTexW = Math.round(RULER_W * RULER_PPC), rulerTexH = Math.round(RULER_H * RULER_PPC);
  const rulerCanvas = document.createElement('canvas');
  rulerCanvas.width = rulerTexW; rulerCanvas.height = rulerTexH;
  const rulerCtx = rulerCanvas.getContext('2d');
  const rulerPX = cm => (cm + RULER_PAD) * RULER_PPC;   // 刻度读数 → 画布 x
  const rulerPY = y => (RULER_TOP - y) * RULER_PPC;     // world y → 画布 y
  // 搪瓷底板：轻微纵向渐变 + 上下压边，读起来是嵌进导轨里的一块刻度板。
  const plateGrad = rulerCtx.createLinearGradient(0, 0, 0, rulerTexH);
  plateGrad.addColorStop(0, '#f7f2e3'); plateGrad.addColorStop(.5, '#eae3ce'); plateGrad.addColorStop(1, '#dcd4bd');
  rulerCtx.fillStyle = plateGrad; rulerCtx.fillRect(0, 0, rulerTexW, rulerTexH);
  const edgePx = Math.max(1, Math.round(RULER_PPC * .06));
  rulerCtx.fillStyle = 'rgba(116,106,82,.22)';
  rulerCtx.fillRect(0, 0, rulerTexW, edgePx);
  rulerCtx.fillRect(0, rulerTexH - edgePx, rulerTexW, edgePx);
  // 每 1 cm 一条刻线，半厘米短刻线对应滑座的 0.5 cm 吸附；5 cm、10 cm 加长加粗。
  const RULER_INK = '#1b2830', TICK_TOP = 1.02;
  for (let half = 0; half <= RULER_END * 2; half++) {
    const cm = half / 2, whole = Number.isInteger(cm);
    const len = whole ? (cm % 10 === 0 ? .70 : cm % 5 === 0 ? .54 : .38) : .22;
    const w = whole ? (cm % 10 === 0 ? .105 : cm % 5 === 0 ? .085 : .065) : .05;
    rulerCtx.fillStyle = whole ? RULER_INK : 'rgba(27,40,48,.74)';
    const wpx = Math.max(1, Math.round(w * RULER_PPC));
    rulerCtx.fillRect(Math.round(rulerPX(cm) - wpx / 2), Math.round(rulerPY(TICK_TOP)), wpx, Math.round(len * RULER_PPC));
  }
  // 数字画在同一张图上：字号按 1.05 cm 的实际高度换算，任何缩放下都由 mipmap 平滑降采样。
  rulerCtx.fillStyle = RULER_INK; rulerCtx.textAlign = 'center'; rulerCtx.textBaseline = 'middle';
  rulerCtx.font = `700 ${Math.round(1.05 * RULER_PPC)}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
  const numberY = rulerPY(-.235);
  rulerCtx.fillText('0', rulerPX(0), numberY);
  for (let cm = 10; cm <= 140; cm += 10) rulerCtx.fillText(String(cm), rulerPX(cm), numberY);
  rulerCtx.fillText(String(RULER_END), rulerPX(RULER_END), numberY);
  const rulerTex = new THREE.CanvasTexture(rulerCanvas);
  rulerTex.colorSpace = THREE.SRGBColorSpace;
  rulerTex.minFilter = THREE.LinearMipmapLinearFilter;
  rulerTex.magFilter = THREE.LinearFilter;
  rulerTex.generateMipmaps = true;
  // 斜视面上没有各向异性过滤，远处会被强行降到最低 mip —— 这正是原来「糊一层」的根源。
  rulerTex.anisotropy = Math.max(1, Math.min(16, renderer.capabilities.getMaxAnisotropy()));
  const rulerFace = mesh(new THREE.PlaneGeometry(RULER_W, RULER_H),
    new THREE.MeshBasicMaterial({ map: rulerTex, toneMapped: false }),
    bench, rulerCenter, RULER_CY, RULER_FACE_Z + .02, false);
  rulerFace.name = 'optical-bench-ruler-face';
  rulerFace.receiveShadow = false;
  rulerFace.renderOrder = 9;
  // Factory scale marker / inlaid metal plaque, independent of ruler labels.
  const makerTex=labelTexture('OPTICAL BENCH  ·  01','#4a555a');
  const maker=mesh(new THREE.PlaneGeometry(15.7,1.60),new THREE.MeshBasicMaterial({map:makerTex,transparent:true,side:THREE.DoubleSide}),bench,-32,.12,-4.67,false);
  maker.rotation.y=Math.PI;
  maker.receiveShadow=false;

  const sliders = {};
  // 每件器材都拆成两层：滑座（卡在导轨上，只沿导轨走）+ 器材本体 rig（能沿立柱升降）。
  // 立柱不是死的：它从滑座里一直伸到器材底部，器材升多高，立柱就跟着长多高 —— 真器材就是
  // 把器材架在立柱上、立柱在滑座的夹紧孔里抽动，所以升降时看到的必须是这种伸缩，而不是
  // 器材悬空或立柱穿出器材。
  const POST = {
    candle:{ bottom:3.18, seat:6.05, sx:0 },
    lens:  { bottom:3.20, seat:6.00, sx:0 },
    screen:{ bottom:2.03, seat:2.30, sx:.70 }
  };
  function makeSlider(kind) {
    const group = new THREE.Group();scene.add(group);
    const runner = new THREE.Group(); group.add(runner);
    box(runner,[6.7,1.1,9.1],[0,2.36,0],alu);
    box(runner,[6.35,.17,8.8],[0,2.99,0],brightAlu);
    for (const z of [-2.25,2.25]) box(runner,[5.8,.1,1.45],[0,1.82,z],slotBlack);
    // The screen's own frame sits in front of its slide, so the post is pushed behind the
    // panel; otherwise the stem would poke through the diffusing face.
    // 光屏是一片半透明膜，背面也要能看穿：它的立柱与托盘必须整个收进滑座里，否则会有一根
    // 竖杆正好立在膜的背面中央，从背面看像时被它挡掉一条。
    const p=POST[kind], sx=p.sx, screenKind=kind==='screen';
    // 立柱：几何高度固定为 1，长度靠 scale.y 拉，顶端始终顶在器材底部（见 update）
    const stem = mesh(new THREE.CylinderGeometry(.38,.38,1,20),brightAlu,group,sx,p.seat,0);
    const col = cylinder(group,.62,.40,[sx,screenKind?2.45:3.31,0],metalDark);
    const lock = cylinder(group,.77,.48,[1.55,2.43,5.0],bronze,24);
    lock.rotation.x=Math.PI/2;
    const dial = cylinder(group,.50,.53,[1.55,2.43,5.3],brass,24);
    dial.rotation.x=Math.PI/2;
    cylinder(group,.20,.40,[1.55,2.43,5.53],metalDark,16).rotation.x=Math.PI/2;
    // A colored index blade extends from the carriage down to the face ruler. Its point marks
    // the carriage center exactly, so the same position can be read in the 3D scene and readout.
    const cursorColor=kind==='candle'?'#c46f3d':kind==='lens'?'#0f7e85':'#376f9f';
    const cursorMat=material(cursorColor,.24,.36,{emissive:cursorColor,emissiveIntensity:.18});
    box(group,[.14,.62,.90],[0,1.53,5.00],cursorMat,false);
    const pointerShape=new THREE.Shape();
    pointerShape.moveTo(-.32,1.24);pointerShape.lineTo(.32,1.24);pointerShape.lineTo(0,.82);pointerShape.closePath();
    const pointerTip=mesh(new THREE.ShapeGeometry(pointerShape),
      new THREE.MeshBasicMaterial({color:cursorColor,side:THREE.DoubleSide,toneMapped:false}),
      group,0,0,RULER_FACE_Z+.08,false);
    pointerTip.name=`ruler-index-${kind}`;
    pointerTip.renderOrder=11;
    // 升降的器材本体都挂在这一个组里：整体改 rig.position.y 就等于把器材沿立柱抬高。
    const rig = new THREE.Group(); group.add(rig);
    group.userData.rig=rig;
    group.userData.post={ stem, bottom:p.bottom, seat:p.seat, sx };
    sliders[kind]=group;return group;
  }
  const candle = makeSlider('candle');
  const lens = makeSlider('lens');
  const screen = makeSlider('screen');
  const candleRig = candle.userData.rig, lensRig = lens.userData.rig, screenRig = screen.userData.rig;

  // Cream wax cylinder with irregular rim, melted-wax drips, dark wick and a layered warm flame.
  const waxTexCanvas = document.createElement('canvas'); waxTexCanvas.width=256;waxTexCanvas.height=256;
  const waxg=waxTexCanvas.getContext('2d');
  const waxGrad=waxg.createLinearGradient(0,0,256,0);
  waxGrad.addColorStop(0,'#8d8a76');waxGrad.addColorStop(.20,'#efe7cf');waxGrad.addColorStop(.56,'#e2dac2');waxGrad.addColorStop(1,'#948f7c');
  waxg.fillStyle=waxGrad;waxg.fillRect(0,0,256,256);
  for(let i=0;i<15;i++){
    waxg.strokeStyle=i%2?'#ffffff17':'#857e6b12';waxg.lineWidth=i%3+1;
    waxg.beginPath();waxg.moveTo(i*19,0);waxg.lineTo(i*19+5,256);waxg.stroke();
  }
  const waxMap=new THREE.CanvasTexture(waxTexCanvas);waxMap.colorSpace=THREE.SRGBColorSpace;
  const wax=material('#f6f0df',.01,.72,{map:waxMap});
  const candleBody = new THREE.Group(); candleRig.add(candleBody);
  cylinder(candleBody,1.35,.42,[0,6.2,0],brass,40);
  cylinder(candleBody,.93,5.35,[0,9.09,0],wax,40);
  cylinder(candleBody,.9,.16,[0,11.84,0],cream,40);
  for(let i=0;i<7;i++){
    const a=i*2*Math.PI/7;
    cylinder(candleBody,.07,.48+(i%3)*.2,[.87*Math.sin(a),11.45-(i%3)*.12,.87*Math.cos(a)],cream,8);
  }
  cylinder(candleBody,.07,.78,[0,12.3,0],blackRubber,10);
  // Layered flame: additive halo, warm envelope, white-hot core. Emissive-only
  // materials keep it bright at any camera angle instead of depending on lighting.
  const flameHalo=mesh(new THREE.SphereGeometry(1,20,16),new THREE.MeshBasicMaterial({color:'#ff9a3c',transparent:true,opacity:.30,depthWrite:false,blending:THREE.AdditiveBlending}),candleBody,0,13.1,0,false);
  flameHalo.scale.set(.80,1.42,.78);
  const flameOuter=mesh(new THREE.SphereGeometry(1,20,16),new THREE.MeshBasicMaterial({color:'#f7a34e',transparent:true,opacity:.85,depthWrite:false}),candleBody,0,13.06,0,false);
  flameOuter.scale.set(.46,1.0,.44);
  const flameMid=mesh(new THREE.SphereGeometry(1,18,14),new THREE.MeshBasicMaterial({color:'#ffdc8e',depthWrite:false}),candleBody,0,12.95,0,false);
  flameMid.scale.set(.28,.66,.27);
  const flameCore=mesh(new THREE.SphereGeometry(1,16,12),new THREE.MeshBasicMaterial({color:'#fffdf2',depthWrite:false}),candleBody,0,12.78,0,false);
  flameCore.scale.set(.15,.36,.15);
  // 火焰的原始尺寸与位置。跳动时只在这个基准上做伸缩/摆动，所以关掉跳动就精确回到原样。
  const flameParts=[flameHalo,flameOuter,flameMid,flameCore].map((m,i)=>({
    m, bx:m.scale.x, by:m.scale.y, bz:m.scale.z, py:m.position.y, op:m.material.opacity
  }));
  const dish=cylinder(candleBody,1.52,.16,[0,6.54,0],material('#a79571',.2,.48),40);
  // 火焰里每一个花瓣（焰形）都要跟着烛芯走：烛芯固定，焰体上下、左右、伸缩都在这里。
  const FLAME_TIP = 13.06;            // 焰心基准高度（局部坐标），画 2D 像时也用这个基准
  let flame={ s:1, sx:1, sz:1, dy:0, dz:0, tilt:0, bright:1 };

  // F-shaped light source: an opaque housing with a bright F aperture, carried by the same
  // slide as the candle so both objects share one optical axis and one object plane.
  const fSource=new THREE.Group();candleRig.add(fSource);fSource.visible=false;
  // The lit face has to point at the lens, so the matte housing sits BEHIND the aperture
  // (x < 0, away from the lens) and the glowing strokes sit in front of it on the lens side,
  // centred on the object plane x = 0. A shiny housing would throw a specular blob straight
  // onto the optical axis and read as if the light source were there.
  box(fSource,[1.0,13.9,11.6],[-.78,12,0],material('#2a3037',.06,.82));
  const fEmit=material('#fff6dd',.02,.42,{emissive:'#ffeda8',emissiveIntensity:1.7});
  // Every stroke is a flat bar lying just in front of the housing face, on the +x side.
  for(const s of F_STROKES)
    box(fSource,[.36,s.y1-s.y0,s.z1-s.z0],[.06,(s.y0+s.y1)/2,(s.z0+s.z1)/2],fEmit,false);
  for(const y of [5.6,18.4])box(fSource,[1.1,.7,1.1],[-.78,y,0],brass);
  const fGlow=new THREE.PointLight('#ffe2a0',15,28,1.6);fGlow.position.set(1.3,12,0);fSource.add(fGlow);

  // 「观察虚像大小与位置」使用真正的三维像，而不是一张追着镜头转的平面贴图。
  // 直接复用器材本体的几何：蜡烛有柱体、底座和球形火焰，F 有外壳厚度及前后错位的发光条。
  // 复制体保持与实物完全相同的空间朝向；相机绕动时，角度、透视和自身遮挡由 Three.js 自然计算。
  // 内层把局部坐标的基准光轴 AXIS 平移到原点，外层再按横向放大率缩放，位置公式见 updateGhost()。
  const ghostSolid=new THREE.Group();scene.add(ghostSolid);ghostSolid.visible=false;
  const ghostSolidMaterials=[];
  function makeVirtualSolid(source){
    const holder=new THREE.Group();
    const copy=source.clone(true);
    copy.visible=true;copy.position.y-=AXIS;
    copy.traverse(o=>{
      if(o.isLight){o.visible=false;return;}   // 虚像不能反过来照亮真实装置
      if(!o.isMesh)return;
      o.castShadow=false;o.receiveShadow=false;o.renderOrder=6;
      const original=o.material,mat=original.clone();
      mat.transparent=true;mat.depthWrite=false;mat.depthTest=true;
      const base=(original.opacity===undefined?1:original.opacity)*.76;
      mat.opacity=base;mat.userData.virtualBaseOpacity=base;
      // 保留原有材质和明暗，只加很轻的青色调，让学生认出这是像而不是第二件实物。
      if(mat.color)mat.color.lerp(new THREE.Color('#b9edf4'),.16);
      if(mat.emissive){
        mat.emissive.lerp(new THREE.Color('#7cc7d8'),.12);
        mat.emissiveIntensity=Math.max(mat.emissiveIntensity||0,.35);
      }
      o.material=mat;ghostSolidMaterials.push(mat);
    });
    holder.add(copy);return holder;
  }
  const ghostCandle=makeVirtualSolid(candleBody),ghostF=makeVirtualSolid(fSource);
  ghostSolid.add(ghostCandle,ghostF);
  ghostCandle.visible=false;ghostF.visible=false;

  const sources = new THREE.Group();candleRig.add(sources);
  const ghostLabels = new THREE.Group();scene.add(ghostLabels);

  // Ring, barrel, edge fasteners and two slightly convex glass faces.
  const ringMat=material('#535d5b',.46,.30);
  const silver=material('#cbd1d0',.65,.20);
  const ring=mesh(new THREE.TorusGeometry(6.02,.46,14,84),ringMat,lensRig,0,12,0);
  ring.rotation.y=Math.PI/2;
  for(const x of [-.52,.52]) {
    const trim=mesh(new THREE.TorusGeometry(5.96,.085,8,84),silver,lensRig,x,12,0);
    trim.rotation.y=Math.PI/2;
  }
  for(let a=0;a<Math.PI*2;a+=Math.PI/2){
    const y=12+6.03*Math.cos(a),z=6.03*Math.sin(a);
    const screw=mesh(new THREE.CylinderGeometry(.18,.18,.21,12),brass,lensRig,-.56,y,z);
    screw.rotation.z=Math.PI/2;
  }
  const glassMat=new THREE.MeshPhysicalMaterial({
    color:'#eef9f4',metalness:0,roughness:.04,transmission:.88,thickness:.8,
    ior:1.45,transparent:true,opacity:.88,side:THREE.DoubleSide,depthWrite:false,envMapIntensity:1.7
  });
  // 焦距决定曲率：f 越短，表面弯得越厉害、镜片中央越厚。这里用球面矢高
  // sag = R − √(R² − r²) 直接从 f 推出曲面深度，而不是只换一个焦距数字。
  function lensSagFor(fCm, aperture=LENS_R, curvatureScale=1.28){
    const R=Math.max(aperture+.3,fCm*curvatureScale);
    return R-Math.sqrt(Math.max(.01,R*R-aperture*aperture));
  }
  function lensCapGeometry(sign,sag,aperture=LENS_R,rings=16,segments=64,profile='convex'){
    const verts=[],indices=[];
    for(let j=0;j<=rings;j++){
      const r=aperture*j/rings,q=(r/aperture)**2;
      for(let i=0;i<=segments;i++){
        const a=i*2*Math.PI/segments;
        const depth=profile==='concave'?sag*q:sag*(1-q);
        verts.push(sign*(.07+depth),12+r*Math.cos(a),r*Math.sin(a));
      }
    }
    for(let j=0;j<rings;j++)for(let i=0;i<segments;i++){
      const n=j*(segments+1)+i,m=n+segments+1;
      indices.push(n,m,n+1,m,m+1,n+1);
    }
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));
    g.setIndex(indices);g.computeVertexNormals();
    return g;
  }
  const mainLensCaps=[];
  let mainLensShapeF=null;
  function refreshMainLensShape(){
    if(mainLensShapeF===state.f)return;
    mainLensShapeF=state.f;
    for(const cap of mainLensCaps){
      lensRig.remove(cap);cap.geometry.dispose();
    }
    mainLensCaps.length=0;
    const sag=lensSagFor(state.f,LENS_R);
    for(const sign of [-1,1])mainLensCaps.push(mesh(lensCapGeometry(sign,sag),glassMat,lensRig,0,0,0,false));
  }
  refreshMainLensShape();
  // 镜前遮挡板：一块从上方压下来的不透明板，挡住镜片的一部分通光面积。它挂在透镜滑座上，
  // 所以移动透镜时一起走；板的下沿由「被挡面积」反解出来（见 occluderCutOffset）。
  // 板面离开主镜前表面一小段距离，短焦距时镜片中央凸出 1.7 cm 也不会穿模。
  const CARD_GAP=2.05, CARD_TOP=12+LENS_R+4.8, CARD_HALF_W=LENS_R+1.25;
  const occluder=new THREE.Group();lensRig.add(occluder);occluder.visible=false;
  const cardGeo=new THREE.BoxGeometry(.16,1,1);
  cardGeo.translate(0,-.5,0);                 // 几何体顶点在 0，向下缩放即从顶边往下长
  const occluderCard=mesh(cardGeo,material('#2d3439',.10,.80),occluder,-CARD_GAP,CARD_TOP,0);
  occluderCard.scale.z=CARD_HALF_W*2;
  box(occluder,[.55,.42,1.5],[-CARD_GAP,CARD_TOP+.21,0],brass);
  // Faint polished-ring glints rotate with the object rather than being pinned to the screen.
  const highlight = mesh(new THREE.TorusGeometry(6.05,.055,8,24,Math.PI*.58),material('#f4f7ee',.1,.12,{transparent:true,opacity:.85}),lensRig,-.12,12,0,false);
  highlight.rotation.y=Math.PI/2;
  highlight.rotation.x=.48;
  const lensLabel=badge(lensRig,'凸透镜 · f 可调',[0,20,0],'#485c63',17);
  let lensLabelKey='';
  function refreshLensLabel(){
    if(lensLabelKey===state.f)return;
    lensLabelKey=state.f;
    if(lensLabel.material.map)lensLabel.material.map.dispose();
    lensLabel.material.map=labelTexture(`凸透镜 f=${state.f.toFixed(1)} cm`,'#485c63');
    lensLabel.material.needsUpdate=true;
  }
  refreshLensLabel();

  // 附加镜片与主镜共用滑座，固定在主镜物方 6 cm。凸镜中间厚、凹镜中间薄，
  // 两种轮廓都由旋转抛物面生成，不用同一个透明圆片冒充两种镜片。
  const extraLens=new THREE.Group();lensRig.add(extraLens);extraLens.position.set(-AUX_GAP,0,0);
  box(extraLens,[AUX_GAP,.32,.48],[AUX_GAP/2,3.25,0],brightAlu);
  cylinder(extraLens,.28,4.2,[0,5.0,0],brightAlu);
  box(extraLens,[2.4,.38,2.2],[0,2.95,0],chamfer);
  const extraConvex=new THREE.Group(),extraConcave=new THREE.Group();
  extraLens.add(extraConvex,extraConcave);
  const extraCaps={convex:[],concave:[]};
  let extraShapeF=null;
  for(const [group,type] of [[extraConvex,'convex'],[extraConcave,'concave']]){
    const ring=mesh(new THREE.TorusGeometry(5.12,.34,12,72),type==='convex'?brass:ringMat,group,0,12,0);
    ring.rotation.y=Math.PI/2;
  }
  // 附加镜同样按焦距改变面形：凸镜缩短焦距→更凸更厚，凹镜缩短焦距→边缘更厚、凹陷更明显。
  function refreshExtraLensShape(){
    if(extraShapeF===state.extraF)return;
    extraShapeF=state.extraF;
    const sag=lensSagFor(state.extraF,4.82,1.34);
    for(const [group,type] of [[extraConvex,'convex'],[extraConcave,'concave']]){
      for(const cap of extraCaps[type]){
        group.remove(cap);cap.geometry.dispose();
      }
      extraCaps[type].length=0;
      for(const sign of [-1,1])
        extraCaps[type].push(mesh(lensCapGeometry(sign,sag,4.82,14,56,type),glassMat,group,0,0,0,false));
    }
  }
  refreshExtraLensShape();
  const extraLensLabel=badge(extraLens,'附加透镜',[0,19.1,0],'#72572f',15);
  let extraLabelKey='';
  function refreshExtraLens(){
    const active=hasExtra();
    refreshExtraLensShape();
    extraLens.visible=active;extraConvex.visible=state.extra==='convex';extraConcave.visible=state.extra==='concave';
    extraLensLabel.visible=active;
    const key=state.extra+'|'+state.extraF;
    if(active&&key!==extraLabelKey){
      extraLabelKey=key;
      const text=state.extra==='convex'?`附加凸透镜 f=${state.extraF}`:`附加凹透镜 f=−${state.extraF}`;
      const accent=state.extra==='convex'?'#80602e':'#365f78';
      if(extraLensLabel.material.map)extraLensLabel.material.map.dispose();
      extraLensLabel.material.map=labelTexture(text,accent);extraLensLabel.material.needsUpdate=true;
    }
  }

  // 半透明膜光屏。纹理网格与 16.8 x 18.8 cm 的膜面严格对应（50 px/cm），所以投上去的像既
  // 不会被拉伸也不会被放大。膜只有一层双面可见的面片，靠纹理自带的 alpha 透光（见 paintPaper），
  // 于是从透镜这一侧（正面）能看到像，绕到另一侧（背面）透过膜照样能看到同一个像。
  // 背面看到的是同一幅画面的左右镜像 —— 这是 WebGL 双面渲染天然给出的结果，也正是真实半透明
  // 屏的观察结果：像在膜上是客观存在的，换一侧看，看到的还是那个倒立的像，只是相对正面那幅
  // 画面翻了过来。所以这里【不能】再挂一块不透明的背板，那会把背面挡死。
  const texCanvas=document.createElement('canvas');texCanvas.width=840;texCanvas.height=940;
  const texCtx=texCanvas.getContext('2d');
  const screenTexture=new THREE.CanvasTexture(texCanvas);
  screenTexture.colorSpace=THREE.SRGBColorSpace;
  screenTexture.anisotropy=Math.min(16,renderer.capabilities.getMaxAnisotropy());
  const screenMat=new THREE.MeshBasicMaterial({map:screenTexture,side:THREE.DoubleSide,transparent:true,toneMapped:false,depthWrite:false});
  const screenFace=mesh(new THREE.PlaneGeometry(16.8,18.8),screenMat,screenRig,0,12,0,false);
  screenFace.rotation.y=-Math.PI/2;
  screenFace.receiveShadow=false;
  screenFace.renderOrder=4;
  // 膜框：四条边把膜严丝合缝地框住（内空正好 16.8 x 18.8），中间完全镂空 —— 背面才没有东西挡着。
  for(const z of [-8.61,8.61])box(screenRig,[.82,20.5,.42],[.2,12,z],metalDark);
  for(const y of [2.39,21.61])box(screenRig,[.82,.42,17.64],[.2,y,0],metalDark);
  for(const z of [-8.61,8.61])for(const y of [2.39,21.61]){
    const bolt=mesh(new THREE.CylinderGeometry(.12,.12,.18,12),brass,screenRig,-.45,y,z);
    bolt.rotation.z=Math.PI/2;
  }
  const screenLabel=badge(screenRig,'半透明膜光屏',[-.2,25,0],'#4c6070',15);
  // Taking the screen off the bench has to leave the stage completely clear: no leftover
  // wireframe, no translucent panel, nothing between the eye and the image. The only thing kept
  // is a fully invisible pick plane in the screen's own place, so clicking that empty spot still
  // brings the screen back where it belongs.
  const screenGhost=new THREE.Group();scene.add(screenGhost);screenGhost.visible=false;
  {
    const hw=8.6,hh=9.9;
    const panel=mesh(new THREE.PlaneGeometry(hw*2,hh*2),
      new THREE.MeshBasicMaterial({transparent:true,opacity:0,colorWrite:false,depthWrite:false,side:THREE.DoubleSide}),
      screenGhost,-.3,12,0,false);
    panel.rotation.y=-Math.PI/2;
  }

  const focusMarks=new THREE.Group();scene.add(focusMarks);
  const labels=new THREE.Group();scene.add(labels);
  const candleLabel=badge(labels,'蜡烛 / 光源',[0,19,0],'#806342',14);
  function clear(group){
    for(const child of [...group.children]){
      group.remove(child);
      if(child.isSprite){if(child.material.map)child.material.map.dispose();child.material.dispose();}
      else if(child.isLine){child.geometry.dispose();child.material.dispose();}
      // Geometry is always unique to its mesh. Materials are shared except for the ray beams
      // (each owns a fog/glow pair) and the deliberately cloned ghost markers.
      else if(child.isMesh){
        child.geometry.dispose();
        if(group===ghostLabels||group===rays)child.material.dispose();
      }
    }
  }
  function refreshMarks(){
    clear(focusMarks);
    if(!state.labels)return;
    // Focus marks are bench positions, so they follow the movable lens carriage.
    for(const m of [-2,-1,1,2]){
      const x=wx(state.lensP)+m*state.f;
      const dot=mesh(new THREE.SphereGeometry(.20,12,8),m%2?brass:bronze,focusMarks,x,2.1,3.7,false);
      dot.castShadow=false;
      badge(focusMarks,Math.abs(m)===2?'2F':'F',[x,4.65,4.3],'#63594b',5.4);
    }
    // Two side rulers double as a distance scale for the current u and screen distance.
    const f=state.f,LP=wx(state.lensP),OP=wx(state.objP),SP=wx(state.scrP);
    for(const [x0,x1,color] of [[OP,LP,'#c08a4e'],[LP,SP,'#4f88ab']]){
      lineSegment(focusMarks,V(x0,3.05,6.4),V(x1,3.05,6.4),color,.9);
    }
    badge(focusMarks,`u = ${state.u.toFixed(1)} cm`,[(OP+LP)/2,3.9,6.6],'#8a6234',10.4);
    badge(focusMarks,`v = ${state.sd.toFixed(1)} cm`,[(LP+SP)/2,3.9,6.6],'#3f6d8b',10.4);
  }
  const glowCanvas=document.createElement('canvas');glowCanvas.width=128;glowCanvas.height=128;
  const gc=glowCanvas.getContext('2d');
  const rg=gc.createRadialGradient(64,64,1,64,64,64);
  rg.addColorStop(0,'#ffffff');rg.addColorStop(.12,'#fff2c4');rg.addColorStop(.45,'#ffd28b66');rg.addColorStop(1,'#e8b06200');
  gc.fillStyle=rg;gc.fillRect(0,0,128,128);
  const glowMap=new THREE.CanvasTexture(glowCanvas);glowMap.colorSpace=THREE.SRGBColorSpace;
  const lightSources=[];
  function sourceMarker(y,color,which){
    const group=new THREE.Group();group.position.set(0,y,0);sources.add(group);
    // Markers sit directly on the object face; no extra hardware is drawn so the
    // candle keeps the plain look of the real apparatus. They are also the grab handles,
    // so the disc is deliberately chunky enough to read and to hit at any camera angle.
    const core=mesh(new THREE.SphereGeometry(.42,20,14),which===0?gold:blue,group,0,0,.98,false);
    core.material.emissiveIntensity=.95;
    const ring=mesh(new THREE.TorusGeometry(.62,.075,8,26),which===0?gold:blue,group,0,0,1.0,false);
    ring.material=ring.material.clone();ring.material.transparent=true;ring.material.opacity=.75;
    const halo=new THREE.Sprite(new THREE.SpriteMaterial({map:glowMap,color,transparent:true,opacity:.58,depthWrite:false,depthTest:false,blending:THREE.AdditiveBlending}));
    halo.position.set(0,0,1.0);halo.scale.set(2.8,2.8,1);halo.renderOrder=17;group.add(halo);
    lightSources.push(group);
  }
  function refreshSources(){
    for(const child of [...sources.children]){
      sources.remove(child);
      child.traverse(m=>{if(m.isMesh)m.geometry.dispose();});
    }
    lightSources.length=0;
    const isCandle=state.source==='candle';
    candleBody.visible=isCandle;
    fSource.visible=!isCandle;
    // The F is a fixed silhouette, so the movable sampling points belong to the candle only.
    if(isCandle){
      sourceMarker(state.sourceY,'#ffd79a',0);
      if(state.second)sourceMarker(state.secondY,'#b4ddf8',1);
    }
    warm.position.set(wx(state.objP),isCandle?state.sourceY+state.liftCandle:AXIS+state.liftCandle,2.4);
    warm.userData.base=isCandle?6:5;
    warm.intensity=warm.userData.base;
  }

  // 像点高度：薄透镜把物点映射到 Yc+(y0−Yc)·m，Yc 是此刻的透镜光心高度。
  function imageY(sourceY,v){const m=optics().m,Yc=lensCy();return Yc+(sourceY-Yc)*m;}
  const rays=new THREE.Group();scene.add(rays);
  // 玻璃镜片的半口径（glassCap 里 R = 5.65）。特殊光线若落在它外面就不画，
  // 否则会画出一条从镜片旁边飘过去的「光线」，看着像穿模。
  const LENS_AP=LENS_R;
  const GLASS_HALF=.07;
  // 镜片表面与 lensCapGeometry 用同一个公式：凸面 depth = sag(1−q)，凹面 depth = sag·q，
  // q=(r/口径)²。光线现在真的从这一层曲面进入、在玻璃里走一段、再从另一面出去，
  // 而不是所有偏折都挤在 x=LX 一张平面上。
  function lensSurfaceConfig(LX,f,aperture,curvatureScale,profile,cy=lensCy()){
    return {LX,f,aperture,profile,cy,sag:lensSagFor(f,aperture,curvatureScale)};
  }
  function surfaceX(cfg,sign,y,z){
    const r=Math.hypot(y-cfg.cy,z),q=Math.min(1,(r/cfg.aperture)**2);
    const depth=cfg.profile==='concave'?cfg.sag*q:cfg.sag*(1-q);
    return cfg.LX+sign*(GLASS_HALF+depth);
  }
  // 在 [p0,p1] 上找与某一面（sign=−1 前表面 / +1 后表面）的交点。p0 在面前、p1 在面后，
  // 用二分而不是解析解，凸面凹面同一套代码。
  function surfaceHit(cfg,p0,p1,sign){
    const at=t=>{
      const x=p0.x+(p1.x-p0.x)*t,y=p0.y+(p1.y-p0.y)*t,z=p0.z+(p1.z-p0.z)*t;
      return {x,y,z,f:x-surfaceX(cfg,sign,y,z)};
    };
    const a=at(0),b=at(1);
    if(!(a.f<=0&&b.f>=0))return null;
    let lo=0,hi=1;
    for(let i=0;i<28;i++){
      const m=(lo+hi)/2,q=at(m);
      if(q.f<=0)lo=m;else hi=m;
    }
    const p=at((lo+hi)/2);
    if(Math.hypot(p.y-cfg.cy,p.z)>cfg.aperture+.03)return null;
    return V(p.x,p.y,p.z);
  }
  const glassTints=new Map();
  function glassTint(color){
    if(!glassTints.has(color)){
      const c=new THREE.Color(color);c.lerp(new THREE.Color('#ffffff'),.5);
      glassTints.set(color,'#'+c.getHexString());
    }
    return glassTints.get(color);
  }
  // 入射/出射段是细线，玻璃内的那一段换成有粗细的发光柱：光线有了“实体”，从侧面看能看出
  // 它先撞上前表面、在玻璃里走一小段、再从后表面钻出去。光线的分段还参与深度测试，所以当
  // 视线穿过镜架或其它实体时会被正常遮住，不再一律浮在画面最上层。
  const rayLine=(p1,p2,color,opacity,dashed=false)=>
    lineSegment(rays,p1,p2,color,opacity,dashed,!dashed);
  function glassBeam(p1,p2,color,opacity){
    const dir=p2.clone().sub(p1),len=dir.length();
    if(len<1e-4)return;
    const quat=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),dir.clone().normalize());
    const mid=p1.clone().add(p2).multiplyScalar(.5);
    const core=new THREE.Mesh(new THREE.CylinderGeometry(.06,.06,len,6,1,true),
      new THREE.MeshBasicMaterial({color,transparent:true,opacity:Math.min(1,opacity),
        depthWrite:false,side:THREE.DoubleSide}));
    core.position.copy(mid);core.quaternion.copy(quat);core.renderOrder=7;rays.add(core);
    const glow=new THREE.Mesh(new THREE.CylinderGeometry(.15,.15,len,8,1,true),
      new THREE.MeshBasicMaterial({color,transparent:true,opacity:Math.min(.22,opacity*.24),
        depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending}));
    glow.position.copy(mid);glow.quaternion.copy(quat);glow.renderOrder=6;rays.add(glow);
  }
  // 一条经薄透镜追迹的光线：入射 → 前表面 → 玻璃内 → 后表面 → 出射。
  // 折射方向仍严格由薄透镜公式给出（出射直线穿过中心面上的理想交点，像点因此一点没变），
  // 只是把交点挪到真实曲面上，让光线看得见地钻进玻璃再从另一面出来。
  function drawLensPath(start,center,end,cfg,color,opacity){
    const entry=surfaceHit(cfg,start,center,-1);
    const exit=surfaceHit(cfg,center,end,1);
    if(entry&&exit){
      rayLine(start,entry,color,opacity);
      glassBeam(entry,exit,glassTint(color),Math.min(1,opacity+.12));
      rayLine(exit,end,color,opacity+.05);
      return {entry,exit,outStart:exit};
    }
    rayLine(start,center,color,opacity);
    rayLine(center,end,color,opacity+.05);
    return {entry:null,exit:null,outStart:center};
  }
  // 遮挡板在镜片前 CARD_GAP 处。一条光线是否被挡住，看它落在挡板平面上的高度：
  // 在下沿以上就停在板上，以下则从板边掠过、继续射向镜片。
  function cardStop(start,center){
    if(state.occlude<=0)return null;
    const den=center.x-start.x;
    if(Math.abs(den)<1e-9)return null;
    const t=(center.x-CARD_GAP-start.x)/den;
    if(!(t>0&&t<1))return null;
    const y=start.y+(center.y-start.y)*t,z=start.z+(center.z-start.z)*t;
    if(y<occluderCutY()-1e-6||Math.abs(z)>CARD_HALF_W)return null;
    return V(start.x+den*t,y,z);
  }
  function traceRay(src,LX,stopX,shiftY,shiftZ,color,opacity){
    const u=state.u,f=state.f,Yc=lensCy();
    const y0=src[0],z0=src[1];
    if(!hasExtra()){
      const YL=Yc+shiftY,ZL=shiftZ;
      if(Math.hypot(YL-Yc,ZL)>LENS_AP)return null;
      // 薄透镜的作用量只与"离光心多高"和入射斜率有关：出射斜率 = 入射斜率 − h/f。
      // 所以把 12 换成 Yc 之后，升降透镜 = 把整幅像搬高，像距一点不变。
      const sy=(YL-y0)/u-(YL-Yc)/f, sz=(ZL-z0)/u-ZL/f;
      const start=V(LX-u,y0,z0),center=V(LX,YL,ZL);
      // 被挡住的不是像，而是射向镜片的那束光：光线在板上断掉，不参与成像。
      const stopped=cardStop(start,center);
      if(stopped){rayLine(start,stopped,color,Math.max(.18,opacity*.5));return null;}
      const end=V(stopX,YL+sy*(stopX-LX),ZL+sz*(stopX-LX));
      const cfg=lensSurfaceConfig(LX,f,LENS_R,1.28,'convex');
      const path=drawLensPath(start,center,end,cfg,color,opacity);
      return {hit:path.outStart,YL,ZL,sy,sz,entry:path.entry,exit:path.exit,
        inGlass:!!(path.entry&&path.exit)};
    }
    const d=AUX_GAP,f1=extraFocal(),u1=u-d,AX=LX-d;
    const Y1=Yc+shiftY,Z1=shiftZ;
    // 追迹到附加镜口径外的光不参与第一片折射，避免画出从镜架旁边穿过的假光线。
    if(Math.hypot(Y1-Yc,Z1)>4.82)return null;
    const sy1=(Y1-y0)/u1-(Y1-Yc)/f1,sz1=(Z1-z0)/u1-Z1/f1;
    const Y2=Y1+sy1*d,Z2=Z1+sz1*d;
    if(Math.hypot(Y2-Yc,Z2)>LENS_AP)return null;
    const start=V(AX-u1,y0,z0),center1=V(AX,Y1,Z1),ideal=V(LX,Y2,Z2);
    const cfgX=lensSurfaceConfig(AX,state.extraF,4.82,1.34,state.extra);
    const entry1=surfaceHit(cfgX,start,center1,-1);
    const exit1=surfaceHit(cfgX,center1,ideal,1);
    if(entry1&&exit1){
      rayLine(start,entry1,color,opacity);
      glassBeam(entry1,exit1,glassTint(color),Math.min(1,opacity+.12));
    }else{
      rayLine(start,center1,color,opacity);
    }
    // 从附加镜后表面沿同一条出射线继续。主镜的入射高度就是这条线在主镜平面上的高度；
    // 薄透镜的作用量只与「在镜平面上的高度」和入射斜率有关，所以像点仍严格不变。
    const out1=(entry1&&exit1)?exit1:center1;
    const span=LX-out1.x;
    const Y2a=out1.y+sy1*span,Z2a=out1.z+sz1*span;
    if(Math.hypot(Y2a-Yc,Z2a)>LENS_AP)return null;
    const center2=V(LX,Y2a,Z2a);
    // 遮挡板夹在附加镜与主镜之间：已经过附加镜的光线，在进主镜前同样可能被板挡住。
    const stopped=cardStop(out1,center2);
    if(stopped){rayLine(out1,stopped,color,Math.max(.18,opacity*.5));return null;}
    const sy=sy1-(Y2a-Yc)/f, sz=sz1-Z2a/f;
    const end=V(stopX,Y2a+sy*(stopX-LX),Z2a+sz*(stopX-LX));
    const cfgM=lensSurfaceConfig(LX,f,LENS_R,1.28,'convex');
    const entry2=surfaceHit(cfgM,out1,center2,-1);
    const exit2=surfaceHit(cfgM,center2,end,1);
    if(entry2&&exit2){
      rayLine(out1,entry2,color,opacity+.02);
      glassBeam(entry2,exit2,glassTint(color),Math.min(1,opacity+.14));
      rayLine(exit2,end,color,opacity+.05);
    }else if(entry2){
      rayLine(out1,entry2,color,opacity+.02);
      rayLine(entry2,center2,color,opacity+.02);
      rayLine(center2,end,color,opacity+.05);
    }else{
      rayLine(out1,center2,color,opacity+.02);
      rayLine(center2,end,color,opacity+.05);
    }
    return {hit:exit2||center2,hit1:exit1||center1,YL:Y2a,ZL:Z2a,sy,sz,sy1,sz1,Y1,Z1,
      entry:entry2,exit:exit2,inGlass:!!(entry2&&exit2)};
  }
  // 光线的两种取法：
  //  · 'all'     —— 一个物点向镜面不同位置发出 13 条光（中心 + 两圈），它们全部汇聚到同一像点；
  //                 立体锥形比原来三条平行采样更能看出「无数条光」的会聚。
  //  · 'special' —— 教材的三条特殊光线作图，每条都用薄透镜定义独立验证（含 z 方向，不再
  //                 把物点投影到 z=0）：
  //      ① 平行主轴入射 ⇒ 打在透镜高度 YL = y0、ZL = z0 ⇒ 出射过像方焦点 F′
  //      ② 过光心入射   ⇒ YL = Yc、ZL = 0 ⇒ 不偏折（Yc 是此刻的透镜光心高度）
  //      ③ 过物方焦点 F ⇒ YL = (Yc·u − f·y0)/(u − f)、ZL = f·z0/(u − f) ⇒ 出射平行主轴
  //    u = f 时第 ③ 条的落点发散（分母 → 0），此时不画它。
  function rayShiftsFor(y0,z0=0){
    if(state.rayMode!=='special'){
      // 附加镜的通光半径只有 4.82 cm，外圈采样必须相应收小，否则整圈光都被第一片挡掉。
      const outer=hasExtra()?4.3:5.0;
      const list=[[0,0]];
      for(const [r,n] of [[2.55,6],[outer,6]])
        for(let i=0;i<n;i++){
          const a=i*2*Math.PI/n+(r>3.4?.26:0);
          list.push([r*Math.cos(a),r*Math.sin(a)]);
        }
      return list;
    }
    const u=hasExtra()?state.u-AUX_GAP:state.u,f=hasExtra()?extraFocal():state.f,Yc=lensCy();
    const list=[[y0-Yc,z0],[0,0]];
    const den=f-u;
    if(Math.abs(den)>1e-6){
      const YL=(Yc*u-f*y0)/(u-f),ZL=f*z0/den;
      if(Math.hypot(YL-Yc,ZL)<=LENS_AP)list.push([YL-Yc,ZL]);
    }
    return list;
  }
  // 自检用：本轮【实际追迹出去】的每条光线（物点、镜面落点、出射斜率）。
  // 导出这个而不是让自检自己重算 sy —— 自己重算等于拿页面自己的公式验自己。
  let lastRayTraces=[];
  function refreshRays(){
    clear(rays);clear(ghostLabels);lastRayTraces=[];
    const info=status();
    const LX=wx(state.lensP),u=state.u,f=state.f;
    const v=info.v;
    const c=imageCase();
    // Seeing the image is the point and the rays are only the proof, so the ghost appears on its
    // own the moment the eye is behind the lens, whether or not the ray fan is switched on.
    const seen=updateGhost();
    if(!state.rays)return;
    const stopX=state.screenRemoved?LX+88:wx(state.scrP);
    // 特殊光线也在真实三维位置上作图（F 的三个角点 z 各不相同），不投影到 z=0。
    // 物点高度一律取【实际世界高度】：蜡烛升起 3 cm，火焰就真的在 12+3 处发光。
    const lift=state.liftCandle;
    const active=state.source==='f'
      ? F_POINTS.map(p=>({y:p.y+lift,z:p.z,c:'#c98c46'}))
      : (state.second?[{y:state.sourceY+lift,z:0,c:'#d99a48'},{y:state.secondY+lift,z:0,c:'#4b8fc4'}]:[{y:state.sourceY+lift,z:0,c:'#d99a48'}]);
    for(const src of active){
      for(const [shiftY,shiftZ] of rayShiftsFor(src.y,src.z)){
        const r=traceRay([src.y,src.z],LX,stopX,shiftY,shiftZ,src.c,.85);
        if(!r)continue;
        lastRayTraces.push({src:{y:src.y,z:src.z},shiftY,shiftZ,YL:r.YL,ZL:r.ZL,sy:r.sy,sz:r.sz,
          entry:r.entry?{x:r.entry.x,y:r.entry.y,z:r.entry.z}:null,
          exit:r.exit?{x:r.exit.x,y:r.exit.y,z:r.exit.z}:null,inGlass:r.inGlass});
        // Behind the lens the extensions meet again where the upright virtual image is. They are
        // a construction aid rather than the observation itself, so they answer to their own
        // switch, and they are only drawn while that image is genuinely in view.
        if(c&&!c.inverted&&seen&&state.virtual)rayLine(r.hit,V(LX+v,r.YL+r.sy*v,r.ZL+r.sz*v),src.c,.6,true);
      }
      const mark=(op)=>{
        const Yc=lensCy();
        const g=mesh(new THREE.SphereGeometry(.34,16,12),src.c==='#4b8fc4'?blue:gold,ghostLabels,LX+v,Yc+(src.y-Yc)*info.m,src.z*info.m,false);
        g.material=g.material.clone();g.material.transparent=true;g.material.opacity=op;g.material.emissiveIntensity=.9;
      };
      // The virtual image is drawn where the dashed extensions meet; a real image without a
      // screen is drawn too, because the eye still sees it hanging in mid air.
      if(c&&seen)mark(c.inverted?.34:.62);
    }
  }
  // Where an image exists at all, and whether it is the upright virtual one or a real one that
  // has lost its screen. Returns null when there is nothing to draw.
  //
  // Looking through the lens is a single act of observation, so the image shows up for both the
  // real and the virtual case the moment the eye is on the screen side. The「显示光线反向延长线」
  // switch is deliberately NOT consulted here: it only governs the dashed construction lines, and
  // making it a precondition for the image itself was what hid the virtual image by default.
  function imageCase(){
    const info=status(),v=info.v;
    if(!Number.isFinite(v))return null;
    const LX=wx(state.lensP),inverted=info.inverted,m=info.m;
    if(v<0)return LX+v>=-62?{v,inverted,m}:null;
    return state.screenRemoved&&info.real&&v<=95?{v,inverted,m}:null;
  }
  // An image is only ever seen by an eye on the far side of the lens. A virtual image forms on
  // the object side, so the only way to see it is to look back through the glass from the
  // screen side - standing on the object side shows nothing at all, exactly as with the real
  // apparatus. A real image that has lost its screen behaves the same way. The thresholds are
  // sticky so that re-framing the camera can never make the image flicker on and off.
  function imageSeenFromCamera(v){
    const LX=wx(state.lensP),C=camera.position,was=state.imageVisible;
    if(C.x<=LX+(was?1.2:2.6))return false;
    if(v>0)return true;                      // a real image hangs beyond the lens
    // The sight line has to pass through the lens aperture to reach the virtual image.
    const Yc=lensCy();
    const t=(LX-C.x)/((LX+v)-C.x);
    if(!(t>0&&t<1))return false;
    const gy=C.y+t*(Yc-C.y),gz=C.z+t*(0-C.z);
    return Math.hypot(gy-Yc,gz)<=(was?7.6:6.3);
  }
  // Recomputed before the camera is framed, because it depends on where the eye is: orbiting
  // round to the object side has to make the image disappear immediately.
  function updateGhost(){
    const c=imageCase();
    const virtual=!!c&&c.v<0;
    // 「观察虚像大小与位置」是独立的教学对照图层：固定朝向的三维虚像和实物同屏。
    // 关掉它以后，虚像只按物理规律出现 —— 眼睛必须在光屏一侧，且视线真的穿过镜片光圈；
    // 片元着色器再把光圈以外的部分裁掉（见 ghostMat）。
    const compare=virtual&&!!state.compare;
    const seen=!!c&&(compare||imageSeenFromCamera(c.v));
    state.virtualCompare=compare;
    // 镜后裸眼观察仍用带光圈裁剪的像面；教学对照则换成固定朝向的三维实体像。
    // 两种表示共用同一个像距、放大率和亮度计算，不会出现两个像同时叠加。
    ghostObject.visible=seen&&!compare;
    ghostSolid.visible=seen&&compare;
    if(c){
      const size=clamp(Math.abs(c.m),.2,8.2);
      // 像面的中心 = art 画布中心（世界 AXIS 那条线）的像。透镜一升降，整幅像跟着搬。
      const Yc=lensCy(),imageX=wx(state.lensP)+c.v;
      ghostObject.position.set(imageX,Yc+(AXIS-Yc)*c.m,0);
      ghostObject.scale.set(c.inverted?-size:size,c.inverted?-size:size,1);
      // 悬在空中的像同样由镜片收集到的光形成：挡住一部分镜片，它只会变暗，不会缺一块。
      ghostObject.material.opacity=(c.inverted?.34:.78)*lightThrough();
      ghostObject.material.color.set(c.v<0?'#e8fdff':'#ffffff');
      if(compare){
        // 三维组的内层已把 AXIS 平移到原点；这里补上实物升降量，使每一个顶点都满足
        // y像 = 光心高 + (y物 − 光心高) × m。x、y、z 同比例缩放，保留器材真实形状。
        ghostSolid.position.set(imageX,Yc+(AXIS+state.liftCandle-Yc)*c.m,0);
        ghostSolid.scale.set(size,size,size);
        ghostCandle.visible=state.source==='candle';
        ghostF.visible=state.source==='f';
        for(const mat of ghostSolidMaterials)
          mat.opacity=mat.userData.virtualBaseOpacity*lightThrough();
      }
    }
    // 透过透镜观察虚像时，实际物体在镜后同侧，无法和虚像分开看见；用一个虚线轮廓
    // 标出它真正所在的位置（也就是 u 的量起点），像本身仍是唯一的亮物体。
    const hideObject=virtual&&state.observing&&!compare;
    candleBody.visible=state.source==='candle'&&!hideObject;
    fSource.visible=state.source==='f'&&!hideObject;
    sources.visible=!hideObject;
    candleLabel.visible=state.labels&&!hideObject;
    if(objectOutline){
      objectOutline.visible=hideObject;
      // 虚线轮廓要罩在实物上：实物整体被抬高了多少，轮廓就跟着高多少。
      objectOutline.position.set(wx(state.lensP)-state.u,objCy(),0);
      objectOutline.rotation.y=Math.PI/2;
    }
    // 裸眼观察（透过透镜）时连像点的采样标记也不画：学生该看到的是唯一的像，
    // 而不是几个悬在空中的光点。对照模式 observing=false，标记仍然保留。
    ghostLabels.visible=seen&&!state.observing;
    refreshVirtualCompareGuides(c);
    // Stored on the state so the self-check reads the very decision the renderer used.
    state.imageVisible=seen;
    state.imageOnObjectSide=virtual;
    return seen;
  }
  const format = y => `${y.toFixed(1)} cm`;
  // The object is authored once on a square-centimetre grid and then re-projected by a
  // single rule: a real image is that grid rotated 180° and scaled by the distance ratio.
  // 50 texture pixels per model centimetre keeps the screen face and the close-up preview
  // at the same sampling density, so nothing is drawn by upscaling a small bitmap.
  const PX_CM = 50, ART_PX_CM = 24;
  // 画布高度从 12 cm 加到 22 cm：器材能在立柱上升高 4 cm，蜡烛顶会跑到 20 cm 以上，
  // 12 cm 的窗口装不下，像就会被切掉一截。宽度仍是 10 cm，光轴（12 cm）仍落在正中，
  // 所以整幅画布的"中线"就是基准光轴 —— 像的落点全靠这条中线对齐。
  const ART_HALF_CM = 11;
  const objCanvas = document.createElement('canvas');
  objCanvas.width = 10 * ART_PX_CM; objCanvas.height = 2 * ART_HALF_CM * ART_PX_CM;
  const objCtx = objCanvas.getContext('2d');
  const artX = z => objCanvas.width / 2 + z * ART_PX_CM;
  const artY = y => objCanvas.height / 2 + (AXIS - y) * ART_PX_CM;
  // 画蜡烛时统一用 oy()：把"器材自己坐标里的高度"换成"抬高之后的实际高度"再做图，
  // 于是升降蜡烛 = 整支蜡烛在画布上一起往上挪，像自然跟着往上（并被 m 放大反向）。
  const oy = y => artY(y + state.liftCandle);
  // The art canvas is authored as the object looks from the lens side, where screen-right runs
  // along -z. The candle is symmetric about z = 0 so artX serves it, but the letter F is not:
  // its strokes are mirrored in z here, which is exactly the orientation the ghost plane wants
  // (that plane's canvas x runs along -z). The screen face and the close-up preview run their
  // canvas x along +z, so they have to undo this mirror — that is what FLIP.front does.
  const artXz = z => objCanvas.width / 2 - z * ART_PX_CM;
  const artStroke = (g, s) => g.fillRect(
    Math.min(artXz(s.z0), artXz(s.z1)), oy(s.y1),
    (s.z1 - s.z0) * ART_PX_CM, (s.y1 - s.y0) * ART_PX_CM);
  // The ghost plane is a 10 x 22 cm window that carries a copy of the object art, so the
  // virtual image (or a real image with no screen to land on) is visible in the 3D scene.
  const ghostCanvas = document.createElement('canvas');
  ghostCanvas.width = objCanvas.width; ghostCanvas.height = objCanvas.height;
  const ghostCtx = ghostCanvas.getContext('2d');
  const ghostTex = new THREE.CanvasTexture(ghostCanvas);
  ghostTex.colorSpace = THREE.SRGBColorSpace;
  // 虚像面片是「只能透过镜片看见」的：片元着色器从相机向该像素连一条视线，若它
  // 在镜片平面上的落点落在通光口径之外，就丢弃这个片元。于是从侧面看过去，像的
  // 溢出部分不会悬在空气里 —— 和真实透镜一样，只有透过玻璃的那一块才看得见。
  // 教学对照模式把 uMask 关掉，虚像才整幅正对镜头显示。
  const ghostMat = new THREE.MeshBasicMaterial({map:ghostTex,transparent:true,opacity:.62,
    depthWrite:false,toneMapped:false,side:THREE.DoubleSide});
  ghostMat.onBeforeCompile=shader=>{
    // 首次编译发生在 renderer.render() 内部，晚于 syncGhostToCamera()。若这里只给 0，
    // 虚像第一次出现的那一帧会完全不裁剪（对照模式则相反，会被裁掉）。所以编译时
    // 就直接按当前状态和相机写入，保证「第一帧」也正确。
    shader.uniforms.uMask={value:state.virtualCompare?0:1};
    shader.uniforms.uLensX={value:wx(state.lensP)};
    shader.uniforms.uLensR={value:LENS_R};
    shader.uniforms.uLensY={value:lensCy()};       // 光心高度可调：光圈裁切随之上下搬
    shader.uniforms.uCam={value:camera.position.clone()};
    shader.vertexShader=shader.vertexShader
      .replace('#include <common>','#include <common>\nvarying vec3 vGhostWorld;')
      .replace('#include <project_vertex>',
        '#include <project_vertex>\nvGhostWorld=(modelMatrix*vec4(transformed,1.0)).xyz;');
    shader.fragmentShader=shader.fragmentShader
      .replace('#include <common>',`#include <common>
        varying vec3 vGhostWorld;
        uniform float uMask; uniform float uLensX; uniform float uLensR; uniform float uLensY; uniform vec3 uCam;`)
      .replace('#include <dithering_fragment>',`
        if(uMask>.5){
          vec3 gd=vGhostWorld-uCam;
          float gt=(uLensX-uCam.x)/gd.x;
          vec3 gh=uCam+gd*gt;
          if(gt<0.0||length(vec2(gh.y-uLensY,gh.z))>uLensR)discard;
        }
        #include <dithering_fragment>`);
    ghostMat.userData.shader=shader;
  };
  const ghostObject = mesh(new THREE.PlaneGeometry(10,2*ART_HALF_CM),ghostMat,scene,0,AXIS,0,false);
  ghostObject.rotation.y = Math.PI/2;
  ghostObject.renderOrder = 6;
  ghostObject.visible = false;
  // 透过透镜观察时，用虚线轮廓标出实物位置。画布坐标和 ghost 贴图完全一致，
  // 所以轮廓和像在同一个方向上，学生能直接看出「像比物大、离镜远」。
  const outlineCanvas=document.createElement('canvas');
  outlineCanvas.width=objCanvas.width;outlineCanvas.height=objCanvas.height;
  const outlineCtx=outlineCanvas.getContext('2d');
  const outlineTex=new THREE.CanvasTexture(outlineCanvas);
  outlineTex.colorSpace=THREE.SRGBColorSpace;
  let objectOutline=mesh(new THREE.PlaneGeometry(10,2*ART_HALF_CM),
    new THREE.MeshBasicMaterial({map:outlineTex,transparent:true,opacity:.8,depthWrite:false,
      depthTest:false,toneMapped:false,side:THREE.DoubleSide}),
    scene,0,AXIS,0,false);
  objectOutline.rotation.y=Math.PI/2;
  objectOutline.renderOrder=9;
  objectOutline.visible=false;
  function drawObjectOutline(){
    const g=outlineCtx;
    g.clearRect(0,0,outlineCanvas.width,outlineCanvas.height);
    g.strokeStyle='#d9f4ff';g.lineWidth=3.2;g.setLineDash([10,8]);
    g.shadowColor='#062130';g.shadowBlur=7;
    if(state.source==='f'){
      for(const s of F_STROKES){
        g.strokeRect(Math.min(artXz(s.z0),artXz(s.z1)),oy(s.y1),
          Math.abs(s.z1-s.z0)*ART_PX_CM,(s.y1-s.y0)*ART_PX_CM);
      }
    }else{
      g.beginPath();
      g.roundRect(artX(-.98),oy(11.86),1.96*ART_PX_CM,5.58*ART_PX_CM,5);
      g.stroke();
      g.beginPath();
      g.ellipse(artX(0),oy(FLAME_TIP),.58*ART_PX_CM,1.26*ART_PX_CM,0,0,Math.PI*2);
      g.stroke();
    }
    outlineTex.needsUpdate=true;
  }
  // 对比视图的量高与量距辅助线：虚线竖线给出物高、像高，横向双线分别给出 u 与 |v|。
  // 它们只属于“观察虚像”的教学对照，不改变任何光学计算。
  const compareGuides = new THREE.Group(); scene.add(compareGuides);
  let compareGuideKey='';
  const drawnObjectSpan = () => state.source === 'f'
    ? { top: 16.5, bottom: 7.5 }
    : { top: 14.2, bottom: 6.3 };
  function refreshVirtualCompareGuides(c){
    const key=state.virtualCompare?[state.objP,state.lensP,state.f,state.extra,state.extraF,state.source,
      state.liftCandle,state.liftLens].join('|'):'off';
    if(key===compareGuideKey)return;
    compareGuideKey=key;
    clear(compareGuides);
    if(!state.virtualCompare||!c)return;
    const span=drawnObjectSpan(),m=Math.abs(c.m),Yc=lensCy(),lift=state.liftCandle;
    const LX=wx(state.lensP),objX=LX-state.u,imgX=LX+c.v;
    // 量的是实物的实际高度（跟着它升降），以及这些高度在像方的位置。
    const objTop=span.top+lift,objBottom=span.bottom+lift;
    const imgTop=Yc+(objTop-Yc)*c.m,imgBottom=Yc+(objBottom-Yc)*c.m;
    // 高度：琥珀色是实物，青色是虚像；虚像明显更高。
    for(const [x,lo,hi,color] of [[objX,objBottom,objTop,'#b07a32'],[imgX,imgBottom,imgTop,'#2b8b9d']]){
      lineSegment(compareGuides,V(x,lo,2.2),V(x,hi,2.2),color,.8,true);
      lineSegment(compareGuides,V(x-.55,lo,2.2),V(x+.55,lo,2.2),color,.8,false);
      lineSegment(compareGuides,V(x-.55,hi,2.2),V(x+.55,hi,2.2),color,.8,false);
    }
    // 距离：先量 u，再量 |v|；两条线长度差就是“像离镜更远”的直接证据。
    lineSegment(compareGuides,V(LX,3.5,3.5),V(objX,3.5,3.5),'#b07a32',.8,false);
    lineSegment(compareGuides,V(objX,3.05,3.5),V(objX,3.95,3.5),'#b07a32',.8,false);
    lineSegment(compareGuides,V(LX,4.9,3.5),V(imgX,4.9,3.5),'#2b8b9d',.9,false);
    lineSegment(compareGuides,V(imgX,4.45,3.5),V(imgX,5.35,3.5),'#2b8b9d',.9,false);
  }
  function drawObjectArt(){
    const g = objCtx; g.clearRect(0, 0, objCanvas.width, objCanvas.height);
    if (state.source === 'f') {
      // The lit strokes glow, so the letter stays legible after the 180° image rotation.
      g.shadowColor = '#ffd98a'; g.shadowBlur = 14; g.fillStyle = '#fffaf0';
      for (const s of F_STROKES) artStroke(g, s);
      g.shadowBlur = 0;
    } else {
      g.fillStyle = '#f0e6cc'; g.shadowColor = '#b99a68'; g.shadowBlur = 6;
      g.beginPath(); g.roundRect(artX(-.95), oy(11.8), 1.9 * ART_PX_CM, 5.5 * ART_PX_CM, 3); g.fill();
      g.fillStyle = '#fdf6e2'; g.fillRect(artX(-.62), oy(11.6), 1.24 * ART_PX_CM, 5.2 * ART_PX_CM);
      g.fillStyle = '#3a3129'; g.fillRect(artX(-.07), oy(12.6), .14 * ART_PX_CM, .9 * ART_PX_CM);
      // 火焰用和 3D 火焰同一组跳动参数（flame）画：屏上的像、预览窗、虚像因此一起跟着抖，
      // 而且抖的方向由 stampObject 的翻转换算，倒立的像自己会朝相反方向抖。
      const fx = artX(flame.dz), fy = oy(FLAME_TIP + flame.dy);
      g.shadowColor = '#ffab3d'; g.shadowBlur = 26 * flame.bright;
      g.fillStyle = '#ffb64f';
      g.beginPath();
      g.ellipse(fx, fy, .5 * ART_PX_CM * flame.sx, 1.15 * ART_PX_CM * flame.s, flame.tilt, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fff2c6';
      g.beginPath();
      g.ellipse(fx, fy + 3 * flame.s, .24 * ART_PX_CM * flame.sx, .62 * ART_PX_CM * flame.s, flame.tilt, 0, Math.PI * 2);
      g.fill();
    }
    // The sampling points belong to the candle; the F already carries its own shape.
    if (state.source === 'f') return;
    for (const [y, color] of [[state.sourceY, '#e79a3c'], ...(state.second ? [[state.secondY, '#4b8fc4']] : [])]) {
      g.shadowColor = color; g.shadowBlur = 20; g.fillStyle = color;
      g.beginPath(); g.arc(artX(0), oy(y), .42 * ART_PX_CM, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(artX(0), oy(y), .16 * ART_PX_CM, 0, Math.PI * 2); g.fill();
    }
  }
  // Vertical extent of the object that actually matters, in world centimetres. The candle
  // stands below the axis while the F is centred on it, so their images are not centred alike.
  // The candle's span must cover the whole legal range of the sampling points, otherwise a
  // point dragged near either end would fall outside the framed image and simply disappear.
  const SRC_MIN = 7, SRC_MAX = 16;
  const objectSpan = () => state.source === 'f'
    ? { top: 16.5, bottom: 7.5 }
    : { top: SRC_MAX + .8, bottom: SRC_MIN - .8 };
  // 贴像的方向。art 画布是按【从光屏背面看】的朝向画的（见 artXz：画布 x 朝 −z），
  // 所以同一个 art 贴到别的朝向上，横向还要不要再翻一次，取决于那块画布的 x 轴朝哪边：
  //   'front'   —— 画布 x 朝 +z：光屏纹理、光屏正面预览。实像在这里上下、左右【都】颠倒。
  //   'through' —— 画布 x 朝 −z：站在像的另一侧透过透镜看，相对 'front' 再左右翻一次。
  //   'upright' —— 正立的虚像（放大镜那种看法），左右不翻。
  // 🔴 实像这一档【只能翻 y】。两个轴都翻（老代码的 flip=true）等于只做了上下颠倒，
  //    屏上的 F 就成了「倒立、但左右没反」—— 这正是成像逻辑出错的地方。
  const FLIP = { front:[1,-1], through:[-1,-1], throughUpright:[-1,1], upright:[1,1] };
  // Stamps the object art onto any canvas. The sampling density must be passed in, because
  // the screen face and the close-up preview are drawn at different pixels per centimetre.
  function stampObject(g, cx, cy, magnification, mode, pxPerCm){
    const k = pxPerCm / ART_PX_CM * magnification;
    const [fx, fy] = FLIP[mode] || FLIP.front;
    g.save(); g.translate(cx, cy); g.scale(fx * k, fy * k);
    g.drawImage(objCanvas, -objCanvas.width / 2, -objCanvas.height / 2);
    g.restore();
  }
  // 像（的参照中心）落在目标画布上的 y。三心同高时它恰好是画布中线；一旦透镜或光屏被
  // 升降，像就相对光屏中心偏移，偏移量由这三个高度直接决定 —— 光屏上的像、预览窗、
  // 虚像面用的都是这一套，所以屏幕上看到的和窗里看到的永远不会打架。
  //   imgRefY: art 画布中心（基准光轴那条线）的像，Yc+(AXIS−Yc)·m —— 透镜升降把整幅像搬高
  //   光屏模式：以光屏中心为参照（真实偏移）；透过透镜的模式：把像本身摆在画面正中
  const imgRefY = m => { const Yc = lensCy(); return Yc + (AXIS - Yc) * m; };
  const scrOffY = info => imgRefY(info.m) - scrCy();          // 像比屏心高多少（cm）
  // Defocus follows the circle of confusion of a real lens of this aperture, which is why
  // the image snaps sharp exactly when the screen reaches the conjugate distance.
  function blurSigma(offsetCm, vCm, pxPerCm = PX_CM){
    const confusion = vCm > 0 ? 2 * 5.6 * offsetCm / vCm : 999;
    return clamp(confusion * pxPerCm / 2.5, 0, 40);
  }
  // 半透明磨砂膜：底色只铺一层带 alpha 的乳白，膜后面的空间会透出来 —— 这正是「绕到背面
  // 也能看到像」的来由。像的笔画是不透明实色（drawObjectArt 画上去的），所以无论从哪一侧
  // 看，像本身都依然清晰；膜则始终是透光的。
  function paintPaper(c, w, h){
    const grad = c.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, 'rgba(214,221,215,.72)');
    grad.addColorStop(.52, 'rgba(236,234,223,.78)');
    grad.addColorStop(1, 'rgba(198,205,199,.70)');
    c.fillStyle = grad; c.fillRect(0, 0, w, h);
    // Seeded deterministic grain, so nothing flickers while the camera is dragged.
    let seed = 87591;
    for (let i = 0; i < 900; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0; const x = seed % w;
      seed = (seed * 1664525 + 1013904223) >>> 0; const y = seed % h;
      c.fillStyle = i % 4 ? 'rgba(74,90,100,.10)' : 'rgba(255,255,255,.17)'; c.fillRect(x, y, 1, 1);
    }
  }
  function redrawScreen(){
    const c=texCtx,w=texCanvas.width,h=texCanvas.height;
    // The object art is the single source for the screen texture, the preview and the ghost.
    drawObjectArt();
    ghostCtx.clearRect(0,0,ghostCanvas.width,ghostCanvas.height);
    ghostCtx.drawImage(objCanvas,0,0);
    ghostTex.needsUpdate=true;
    drawObjectOutline();
    c.setTransform(1,0,0,1,0,0);
    c.filter='none';c.globalAlpha=1;
    c.clearRect(0,0,w,h);
    paintPaper(c,w,h);
    const info=status();
    const m=hasExtra()?Math.abs(info.m*state.sd/info.v):state.sd/state.u;
    if(info.real&&Number.isFinite(info.v)&&info.v<=300&&!state.screenRemoved){
      const offset=Math.abs(state.sd-info.v), sigma=blurSigma(offset,info.v);
      c.save();c.beginPath();c.rect(6,6,w-12,h-12);c.clip();
      // 遮挡板只减少进入镜片的光：整幅像一起按通过光量变暗，轮廓一点不少。
      c.globalAlpha=clamp(1-offset/80,.45,1)*lightThrough();
      c.filter=sigma<.5?'none':`blur(${sigma.toFixed(1)}px)`;
      // 膜的中心就是光屏中心：像点比屏心高多少，画布上就往上挪多少（三心同高时为 0）
      stampObject(c,w/2,h/2-PX_CM*scrOffY(info),m,info.inverted?'front':'upright',PX_CM);
      c.restore();
      // A faint axis line lets the image be judged against the optical axis.
      c.save();c.globalAlpha=.15;c.strokeStyle='#6b7b83';c.lineWidth=1.5;
      c.beginPath();c.moveTo(w/2,10);c.lineTo(w/2,h-10);c.stroke();c.restore();
    }
    c.strokeStyle='#a7a9a154';c.lineWidth=1.5;c.strokeRect(5,5,w-10,h-10);
    screenTexture.needsUpdate=true;
  }
  // The preview is painted at its own resolution instead of cropping the screen texture, so
  // it stays genuinely sharp. It shows what the eye receives: the diffusing screen while it
  // is on the bench, otherwise the image seen through the lens from the screen side.
  function paintInset(info){
    const W=inset.width,H=inset.height,g=insetCtx;
    g.setTransform(1,0,0,1,0,0);g.filter='none';g.globalAlpha=1;
    const m=hasExtra()?Math.abs(info.m*state.sd/info.v):state.sd/state.u;
    const throughLens=state.screenRemoved||!info.real;
    let mode=!Number.isFinite(info.v)?'none':throughLens?(info.real?'air':'virtual'):'screen';
    let mag=throughLens?Math.abs(info.m):Math.abs(m);
    if(!Number.isFinite(mag))mode='none';
    if(mode==='none'){
      g.fillStyle='#0d1820';g.fillRect(0,0,W,H);
      g.textAlign='center';g.textBaseline='middle';
      g.fillStyle='#7fd4f2';g.font='bold 34px sans-serif';g.fillText('无有限距离的像',W/2,H/2-30);
      g.fillStyle='#cfe3ec';g.font='19px sans-serif';
      g.fillText('出射光彼此平行，光屏无法承接',W/2,H/2+16);
      g.fillText('调整光源或附加镜焦距再观察',W/2,H/2+48);
      $('previewText').textContent='当前出射光平行：有限距离内没有清晰的像';
      $('previewTitle').textContent='透过透镜观察';
      return;
    }
    // The preview always frames the image, so its size does not depend on how far the
    // screen happens to sit. When the image is genuinely huge only part of it fits.
    const span=objectSpan(),mid=(span.top+span.bottom)/2;
    const capCm=mode==='screen'?18.8:30;
    const needCm=(span.top-span.bottom)*mag;
    // 光屏模式还要装下「像偏离屏心」的那一段：三心不同高时视野跟着放宽，最多放宽到
    // 整块膜（18.8 cm）—— 像真的偏出膜面时，预览窗里就该看到空膜，而不是硬把像挪回中间。
    const off=mode==='screen'?scrOffY(info):0;
    const needView=mode==='screen'?Math.max(needCm*1.7,(Math.abs(off)+needCm*.5)*2.2):needCm*1.7;
    const viewCm=clamp(needView,4.6,capCm);
    const pxCm=H/viewCm;
    const clipped=needCm>viewCm*.94;
    // 落点。光屏模式按【屏心】量，所以光屏一升降，像在窗里就真的跟着偏；透过透镜的模式
    // 没有屏可参照，把像本身摆在画面正中（这样大幅放大的像也总能看到）。
    const cy=mode==='screen'
      ? H/2-pxCm*clamp(off,-viewCm*.42,viewCm*.42)
      : H/2+pxCm*info.m*((mid+state.liftCandle)-AXIS);
    // 膜是双面的：绕到光屏背面时，眼睛看到的是同一幅画面的左右镜像（像在膜上是客观存在的
    // 图案，换一侧看自然就翻过来）。预览窗跟着翻，学生才不会觉得「屏幕上明明有像，窗里却是反的」。
    const fromBack=mode==='screen'&&camera.position.x>wx(state.scrP);
    g.save();
    if(mode==='screen'){
      g.fillStyle='#cbd0c8';g.fillRect(0,0,W,H);   // 预览窗用实底：这里要的是像的对比度
      paintPaper(g,W,H);
      const offset=Math.abs(state.sd-info.v),sigma=blurSigma(offset,info.v,pxCm);
      g.beginPath();g.rect(4,4,W-8,H-8);g.clip();
      g.filter=sigma<.5?'none':`blur(${sigma.toFixed(1)}px)`;
      g.save();
      if(fromBack){g.translate(W,0);g.scale(-1,1);}
      g.globalAlpha=lightThrough();   // 屏上的像同样按通过光量变暗
      stampObject(g,W/2,cy,mag,info.inverted?'front':'upright',pxCm);
      g.restore();
    }else{
      const bg=g.createRadialGradient(W/2,H/2,10,W/2,H/2,H*.78);
      bg.addColorStop(0,'#20323d');bg.addColorStop(1,'#0b141a');
      g.fillStyle=bg;g.fillRect(0,0,W,H);
      // The eye sees the image hanging in air, so a dashed axis is the only reference.
      g.strokeStyle='#7fd4f255';g.lineWidth=1.5;g.setLineDash([9,8]);
      g.beginPath();g.moveTo(10,cy);g.lineTo(W-10,cy);g.stroke();g.setLineDash([]);
      g.save();g.beginPath();g.rect(4,4,W-8,H-8);g.clip();
      // A real image is inverted in both directions; only the virtual image stays upright.
      g.globalAlpha=lightThrough();   // 透过镜片看到的像同样随通过光量变暗
      stampObject(g,W/2,cy,mag,mode==='air'?(info.inverted?'through':'throughUpright'):(info.inverted?'front':'upright'),pxCm);
      g.restore();
    }
    g.restore();
    g.strokeStyle='#a7a9a155';g.lineWidth=1.5;g.strokeRect(4,4,W-8,H-8);
    const sizeText=sizeRatio(mag).phrase;
    $('previewTitle').textContent=mode==='screen'
      ?(fromBack?'光屏背面 · 透过半透明膜看':'光屏正面 · 放大观察')
      :mode==='air'?'透过透镜 · 空中的实像':`透过透镜 · ${info.inverted?'倒立':'正立'}的虚像`;
    $('previewText').textContent = mode==='screen'
      ? (fromBack?'背面看：像依然倒立，整幅画面相对正面左右翻转 · ':'')
        +(info.crisp?`屏上得到清晰的${info.inverted?'倒立':'正立'}实像 · `+sizeText
        :`离焦 ${Math.abs(info.v-state.sd).toFixed(1)} cm · 移动光屏寻找像`)
      : (mode==='air'?`撤去光屏后，实像仍悬在空中（${info.inverted?'倒立':'正立'}） · `+sizeText
        :`透过透镜看到${info.inverted?'倒立':'正立'}虚像（与物同侧） · `+sizeText)
        +(clipped?' · 像很大，画面只显示局部':'')
        +(mode==='screen'&&Math.abs(off)>.2?` · 像在屏心${off>0?'上':'下'}方 ${Math.abs(off).toFixed(1)} cm`:'' )
        +(state.occlude>0?` · 遮挡板挡住 ${state.occlude}% 的光，像完整但变暗` : '');
  }

  let compareUiKey='';
  // 虚像不再塞进一个压暗的圆窗里，而是和实物一起留在明亮的三维装置中：
  // 透明虚像按真实像距和放大率出现在物后方，露出周围环境；两块浅色标签和左下角小结
  // 把“像比物大多少、离镜比物远多少”直接写出来，能同时看见、也能比较。
  function syncVirtualCompare(){
    const active=!!state.virtualCompare;
    // updateGhost() runs inside render(), after update() has already written the rest of the UI.
    // Toggling this badge there would leave it one frame behind (the test drove exactly that:
    // the ghost was visible in 3D while the badge still said otherwise).
    $('stage').classList.toggle('show-ghost',state.imageVisible);
    $('stage').classList.toggle('virtual-compare',active);
    const through=state.observing&&!active&&state.imageOnObjectSide;
    $('stage').classList.toggle('through-view',through);
    const banner=$('observeBanner');
    if(!active){
      compareUiKey='';
      if(through)
        banner.textContent='透过透镜观察 · 只能看到正立、放大的虚像 · 虚线为实物位置';
      else if(state.imageOnObjectSide&&state.screenRemoved)
        banner.textContent='u < f · 点「透过透镜观察」从光屏侧透过镜片看虚像，或点「观察虚像大小与位置」对照';
      else if(state.observing)
        banner.textContent='撤去光屏 · 从光屏这一侧透过透镜观察悬在空中的像';
      else
        banner.textContent='移动蜡烛或透镜改变物距；勾选「显示光路」可看到光线经透镜折射';
      return;
    }
    const c=imageCase(),info=status();
    if(!c)return;
    const m=Math.abs(info.m),span=drawnObjectSpan(),objH=span.top-span.bottom,imgH=objH*m;
    const gap=Math.abs(c.v)-state.u;
    const key=[m,state.u,c.v,state.source,state.objectHeight||0].join('|');
    if(key!==compareUiKey){
      compareUiKey=key;
      $('vcObjectText').textContent=`高 ${objH.toFixed(1)} cm`;
      $('vcImageText').textContent=`高 ${imgH.toFixed(1)} cm（${m.toFixed(2)}×）`;
      $('vfHead').textContent=`虚像比实物大 ${m.toFixed(2)} 倍，离透镜${gap>=0?'更远':'更近'}`;
      $('vfU').textContent=`${state.u.toFixed(1)} cm`;
      $('vfV').textContent=`${Math.abs(c.v).toFixed(1)} cm`;
      $('vfM').textContent=`${m.toFixed(2)} 倍`;
      $('vfGap').textContent=`像距比物距${gap>=0?'远':'近'} ${Math.abs(gap).toFixed(1)} cm`;
      banner.textContent=`虚像对比 · 像距 ${Math.abs(c.v).toFixed(1)} cm ${gap>=0?'>':'<'} 物距 ${state.u.toFixed(1)} cm`;
    }
    const rect=canvas.getBoundingClientRect();
    if(!rect.width||!rect.height)return;
    const toScreen=(x,y,z=0)=>{
      const q=V(x,y,z).project(camera);
      return {x:(q.x+1)*rect.width/2,y:(1-q.y)*rect.height/2};
    };
    const LX=wx(state.lensP),sy=Math.abs(ghostSolid.scale.y),Yc=lensCy();
    const objTag=toScreen(LX-state.u,span.top+state.liftCandle+1.3);
    const imgTag=toScreen(LX+c.v,Yc+(span.top+state.liftCandle-Yc)*sy+1.3);
    const place=(el,p)=>{
      el.style.left=`${clamp(p.x,58,rect.width-58).toFixed(1)}px`;
      el.style.top=`${clamp(p.y,34,rect.height-72).toFixed(1)}px`;
    };
    place($('vcObjectTag'),objTag);
    place($('vcImageTag'),imgTag);
  }

  function cameraPosition(){
    const radius=190/state.zoom;
    camera.position.set(target.x+radius*Math.sin(state.yaw)*Math.cos(state.pitch),
      target.y+radius*Math.sin(state.pitch),radius*Math.cos(state.yaw)*Math.cos(state.pitch));
    camera.lookAt(target);
  }
  function fitCamera(){
    if(!framed)return;      // a rail drag freezes the shot until the gesture ends
    camera.fov=37;
    const el=canvas.getBoundingClientRect();
    const w=Math.max(1,el.width),h=Math.max(1,el.height);
    // Frame the three slides themselves, never closer than a comfortable working span of the
    // rail, so the camera keeps the whole experiment in view however the slides are moved.
    const edgeLo=[wx(state.objP)-7,wx(state.lensP)-7,wx(state.scrP)-9];
    const edgeHi=[wx(state.objP)+7,wx(state.lensP)+7,wx(state.scrP)+9];
    // A virtual image forms on the object side and can sit far outside the slides, so its
    // whole scaled plane is framed too - otherwise the very size comparison would be cropped.
    // Through-lens mode is the exception: there the image is seen only inside the glass, and
    // framing the whole (possibly enormous) ghost plane would just push the lens off screen.
    // 器材能在立柱上升降，取景的上下沿必须跟着抬起来，否则升高后的镜架会被切掉。
    const liftTop=AXIS+Math.max(state.liftCandle,state.liftLens,state.liftScreen)+9.5;
    let frameLoY=-5,frameHiY=Math.max(25,liftTop);
    const framingGhost=state.virtualCompare?ghostSolid:ghostObject;
    if(framingGhost.visible&&(state.virtualCompare||!state.imageOnObjectSide)){
      const gx=framingGhost.position.x,sx=Math.abs(framingGhost.scale.x),sy=framingGhost.scale.y;
      edgeLo.push(gx-5*sx-2.5);edgeHi.push(gx+5*sx+2.5);
      const span=drawnObjectSpan(),Yc=lensCy();
      const yA=Yc+(span.top+state.liftCandle-Yc)*sy,yB=Yc+(span.bottom+state.liftCandle-Yc)*sy;
      frameLoY=Math.min(frameLoY,Math.min(yA,yB)-1.5);
      frameHiY=Math.max(frameHiY,Math.max(yA,yB)+1.5);
    }
    const left=Math.min(...edgeLo),right=Math.max(...edgeHi),cx=(left+right)/2;
    const half=Math.max((right-left)/2,32);
    target.x=cx;target.y=(frameLoY+frameHiY)/2;
    camera.aspect=w/h;
    camera.updateProjectionMatrix();
    const samples=[];
    for(const x of [cx-half,cx+half])for(const y of [frameLoY,frameHiY])for(const z of [-12,12])samples.push(V(x,y,z));
    let lo=85,hi=500;
    for(let k=0;k<24;k++){
      const r=(lo+hi)/2;
      camera.position.set(target.x+r*Math.sin(state.yaw)*Math.cos(state.pitch),target.y+r*Math.sin(state.pitch),r*Math.cos(state.yaw)*Math.cos(state.pitch));
      camera.lookAt(target);camera.updateMatrixWorld();
      const max=samples.reduce((m,p)=>{
        const q=p.clone().project(camera);
        return Math.max(m,Math.abs(q.x)/.90,Math.abs(q.y)/.78);
      },0);
      if(max>1)lo=r;else hi=r;
    }
    camera.position.set(target.x+hi*Math.sin(state.yaw)*Math.cos(state.pitch),target.y+hi*Math.sin(state.pitch),hi*Math.cos(state.yaw)*Math.cos(state.pitch));
    camera.lookAt(target);
    // Narrow screens deliberately frame the working apparatus closer, leaving some unused
    // rail out of view instead of reducing the lens to a few pixels.
    const base=hi/(state.zoom*(w<500?1.55:1));
    camera.position.sub(target).multiplyScalar(base/hi).add(target);
    camera.updateMatrixWorld();
  }
  // 透过透镜看虚像的机位：眼睛放在光屏一侧、离镜片约 8 cm 的光轴上，视角放宽到 85°，
  // 这样镜片通光口径（半角约 35°）能整圈落进画面，放大后的虚像（半角约 25°）完整地
  // 落在镜片里面。滚轮/双指缩放改变眼睛离镜片的距离；拖动可以把眼睛沿镜面平移几度，
  // 从而看到「视线一偏出光圈，像就被镜框挡住」的真实效果。
  const THROUGH_FOV=85;
  function throughView(){
    const c=imageCase();
    return state.observing&&!!c&&c.v<0&&!state.virtualCompare;
  }
  function throughCamera(){
    const LX=wx(state.lensP);
    const eye=clamp(8/state.zoom,3.4,14);
    const a=clamp(state.obsYaw,-.16,.16),b=clamp(state.obsPitch,-.13,.13);
    camera.position.set(LX+eye*Math.cos(a)*Math.cos(b),12+eye*Math.sin(b),eye*Math.sin(a));
    camera.lookAt(LX,12,0);
    const rect=canvas.getBoundingClientRect();
    camera.aspect=Math.max(1,rect.width)/Math.max(1,rect.height);
    camera.fov=THROUGH_FOV;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }
  function syncGhostToCamera(){
    // 镜后观察的像面始终位于物平面 / 像平面，不做 billboard。
    // 对照模式的三维虚像同样保持固定空间朝向，拖动视角只改变相机，不改变像本身。
    ghostObject.rotation.y=Math.PI/2;
    // 两种表示都使用正常深度测试：三维像尤其需要正确的自身前后遮挡关系。
    ghostMat.depthTest=true;
    // 透过镜片才看得见：把「相机 → 片元」的视线投到镜片平面上，光圈外一律丢弃。
    const sh=ghostMat.userData.shader;
    if(sh){
      sh.uniforms.uMask.value=state.virtualCompare?0:1;
      sh.uniforms.uLensX.value=wx(state.lensP);
      sh.uniforms.uLensR.value=LENS_R*.995;
      sh.uniforms.uLensY.value=lensCy();
      sh.uniforms.uCam.value.copy(camera.position);
    }
  }
  // 预览窗只在相机或器材真的变了时重绘。除了省掉无谓的重画，更要紧的是画面稳定性：
  // 「撤去光屏后舞台必须一个残余像素都没有」这条判据靠的是同一状态两次截图逐字节相同，
  // 而同一状态反复重绘会让 swiftshader 出现幅度几个灰阶的抖动。
  let insetKey = null;
  function render(){
    // Where the eye sits decides whether the image is in view, and a visible image in turn
    // widens the shot, so the framing is settled first and the decision is then taken with that
    // very camera. The second pass only moves the camera by the amount the ghost adds to the
    // envelope, which the sticky thresholds in imageSeenFromCamera absorb without flicker.
    if(throughView()){
      throughCamera();
      updateGhost();
    }else{
      fitCamera();
      updateGhost();
      fitCamera();
    }
    syncGhostToCamera();
    // 「透过透镜观察」是裸眼观察：画面上只保留镜片和像，光路图留给普通视角和虚像对照。
    // （复选框本身不改，退出观察后原来的光路立刻回来。）
    rays.visible=state.rays&&!throughView();
    // 火焰一直在跳，但火焰本身不投影：阴影图只在器材真的动了（update/取景变化）时重算，
    // 否则每帧重画一张 2048² 的阴影图，手机立刻发烫。
    renderer.shadowMap.needsUpdate=true;
    renderer.render(scene,camera);
    syncVirtualCompare();
    // 预览窗跟着眼睛走：绕到光屏背面时，窗里显示的也整体翻过来 —— 屏幕上看到的和窗里
    // 看到的才是同一件事。放在这里（而不是只放在 update() 里），是因为相机可以在器材
    // 一个都不动的情况下被拖走，那时预览窗也必须跟着变。
    const key=[camera.position.x,camera.position.y,camera.position.z,state.f,state.extra,state.extraF,state.u,state.sd,
      state.scrP,state.source,state.sourceY,state.secondY,state.second,state.screenRemoved,state.occlude].join('|');
    if(key!==insetKey){insetKey=key;paintInset(status());}
  }
  function resize(){
    const rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;
    renderer.setSize(rect.width,rect.height,false);
    render();
  }
  function project(p){
    fitCamera();const v=V(p.x,p.y,p.z||0).project(camera),rect=canvas.getBoundingClientRect();
    return {x:(v.x+1)*rect.width/2,y:(1-v.y)*rect.height/2,depth:v.z};
  }
  // The observer's own eye is the camera in "look through the lens" mode, so no floating label is
  // drawn for it: a badge parked right where the image appears only gets in the way, and the
  // banner over the stage already says which viewpoint is active.
  // The three slides cannot pass through each other, so every position is pulled back onto
  // the rail before anything is drawn, and snapped to the slider grid so the browser never
  // has to clamp an out-of-range input behind our back.
  function normalize(){
    state.lensP = clamp(roundHalf(state.lensP), RAIL.lens[0], RAIL.lens[1]);
    state.objP  = clamp(roundHalf(state.objP), RAIL.obj[0], state.lensP - (hasExtra()?AUX_GAP+MIN_GAP:MIN_GAP));
    state.scrP  = clamp(roundHalf(state.scrP), state.lensP + MIN_GAP, RAIL.screen[1]);
  }
  function update(){
    normalize();
    const info=status(),preset=CASES.find(x=>x.id===info.kind);
    // u ≤ f cannot put an image on the screen at all, so the screen steps aside when the
    // situation changes and comes back when a real image exists again. The move is edge
    // triggered, so it never overrules someone who just put the screen back by hand.
    const need=info.needsScreenOff;
    if(need&&!state.lastNeedsOff&&!state.screenRemoved){state.screenRemoved=true;state.autoScreen=true;}
    else if(!need&&state.lastNeedsOff&&state.screenRemoved&&state.autoScreen){state.screenRemoved=false;state.autoScreen=false;}
    state.lastNeedsOff=need;
    // 对照模式只对虚像有意义；换到 u ≥ f（或 u = f）时自动退出，免得留下一个空图层。
    if(state.compare&&(info.real||!Number.isFinite(info.v)))state.compare=false;
    sliders.candle.position.x=wx(state.objP);
    sliders.lens.position.x=wx(state.lensP);
    sliders.screen.position.x=wx(state.scrP);
    // 升降：器材本体挂在各自的 rig 上，立柱从滑座里一直伸到器材底部，所以只改两个数 ——
    // rig 的高度和立柱的长度，剩下的（光轴、像、光路、读数）都由 lensCy 等派生。
    for(const [group,kind] of [[candle,'candle'],[lens,'lens'],[screen,'screen']]){
      const lift=liftOf(kind),rig=group.userData.rig,post=group.userData.post;
      rig.position.y=lift;
      const top=post.seat+lift,len=Math.max(.3,top-post.bottom);
      post.stem.scale.y=len;
      post.stem.position.set(post.sx,(top+post.bottom)/2,0);
    }
    // 遮挡板：顶边固定，下沿按被挡面积下移；0 时整块板收回画面之外。
    // 卡片是透镜组的子物体，所以缩放用【局部】下沿；判光线用世界高度（见 occluderCutY）。
    occluder.visible=state.occlude>0;
    if(occluder.visible)occluderCard.scale.y=Math.max(.4,CARD_TOP-occluderCutLocal());
    screen.visible=!state.screenRemoved;
    screenGhost.visible=state.screenRemoved;
    screenGhost.position.set(wx(state.scrP),state.liftScreen,0);
    labels.position.set(wx(state.objP),state.liftCandle,0);
    lensLabel.visible=screenLabel.visible=state.labels;
    candleLabel.visible=state.labels;
    refreshMainLensShape();refreshLensLabel();refreshExtraLens();refreshMarks();refreshSources();refreshRays();redrawScreen();
    const candleMode=state.source==='candle';
    for(const [id,value] of [['focalLength',state.f],['extraFocal',state.extraF],['sourceHeight',state.sourceY],['secondHeight',state.secondY],
      ['liftCandle',state.liftCandle],['liftLens',state.liftLens],['liftScreen',state.liftScreen]])$(id).value=value;
    $('liftCandleValue').textContent=objCy().toFixed(1)+' cm';
    $('liftLensValue').textContent=lensCy().toFixed(1)+' cm';
    $('liftScreenValue').textContent=scrCy().toFixed(1)+' cm';
    $('focalValue').textContent=format(state.f);
    $('extraFocalValue').textContent=state.extra==='concave'?`−${state.extraF} cm`:`${state.extraF} cm`;
    $('extraFocal').disabled=!hasExtra();
    $('occlude').value=state.occlude;
    $('occludeValue').textContent=state.occlude>0
      ?`遮住 ${state.occlude}% · 通过 ${100-state.occlude}%`:'未遮挡';
    $('occludeHint').textContent=state.occlude>0
      ?`遮挡板挡住镜片约 ${state.occlude}% 的面积：每个像点都少了这部分光线，所以像仍然完整，只是整体亮度降到约 ${100-state.occlude}%。`
      :'把遮挡板降下来挡住一部分镜片。打开「显示光路」可以看到被挡住的光线停在挡板上；其余光线依然会聚成完整的像，只是变暗。';
    $('sourceValue').textContent=format(state.sourceY);
    $('secondValue').textContent=format(state.secondY);
    $('secondSource').checked=state.second;
    $('secondSourceControls').hidden=!state.second;
    // The F is a fixed silhouette, so the sampling-point controls belong to the candle only.
    for(const id of ['sourceHeight','secondSource','secondHeight'])$(id).disabled=!candleMode;
    $('sourcePanel').classList.toggle('muted',!candleMode);
    $('fSourceHint').hidden=candleMode;
    // Read absolute scale positions plus the experimentally measured object/screen separations.
    $('roObj').textContent=format(state.objP);
    $('roLens').textContent=format(state.lensP);
    $('roScr').textContent=state.screenRemoved?'已撤去':format(state.scrP);
    $('roU').textContent=format(state.u);
    $('roV').textContent=state.screenRemoved?'已撤去':format(state.sd);
    $('roV').className=info.crisp?'hi ok':'hi';
    // 像点相对屏心的位置：三心同高时就是「居中」；升降任一件器材，这里立刻读出一个偏移量，
    // 而且偏移量跟屏上看到的位置完全同步 —— 这就是"上下移动器材会怎样"的定量答案。
    if(!Number.isFinite(info.imgY)||state.screenRemoved){
      $('roOff').textContent='—';$('roOff').className='';
    }else{
      const off=info.offY,size=Math.abs(off);
      $('roOff').textContent=size<.25?'居中':(off>0?'↑ ':'↓ ')+size.toFixed(1)+' cm'+(info.offScreen?' · 出膜':'');
      $('roOff').className=info.offScreen?'off':size<.25?'ok':'';
    }
    const f=state.f;
    const lifted=state.liftCandle||state.liftLens||state.liftScreen;
    const heightNote=lifted
      ?` 三心高度 焰心 ${objCy().toFixed(1)} / 光心 ${lensCy().toFixed(1)} / 屏心 ${scrCy().toFixed(1)} cm：`+
       `像落在屏心${info.offY>0?'上':'下'}方 ${Math.abs(info.offY).toFixed(1)} cm。`
      :'';
    $('roNote').textContent=(hasExtra()
      ?`附加镜在主镜前 ${AUX_GAP} cm：u₁=${info.u1.toFixed(1)} cm，v₁=${Number.isFinite(info.v1)?info.v1.toFixed(1)+' cm':'∞'}；最终像距 v=${Number.isFinite(info.v)?info.v.toFixed(1)+' cm':'∞'}。`
      :'u = 透镜刻度 − 光源刻度；v实 = 光屏刻度 − 透镜刻度。'
        +`刻度 0 在左端 · F 在 ${format(state.lensP-f)} / ${format(state.lensP+f)}，`
        +`2F 在 ${format(state.lensP-2*f)} / ${format(state.lensP+2*f)}`)+heightNote;
    $('metricU').textContent=format(state.u);
    $('metricScreen').textContent=state.screenRemoved?'光屏已撤去':format(state.sd);
    $('metricV').textContent=!Number.isFinite(info.v)?'∞（不成像）':(info.v<0?'−':'')+Math.abs(info.v).toFixed(1)+' cm';
    $('metricState').textContent=!Number.isFinite(info.v)?'无有限像':!info.real?`${info.inverted?'倒立':'正立'}虚像`
      :state.screenRemoved?'空中的实像':info.crisp?'清晰实像':'实像未合焦';
    $('metricState').className=info.crisp?'good':!info.real?'warn':'';
    // 第五格：把这个透镜当眼镜镜片用的度数（接第 4 节「眼睛和眼镜」）。焦距越短度数越大。
    $('metricDiopter').textContent=diopterOf(state.f).toFixed(0)+' 度';
    // 光路模式按钮：只在「显示光路」打开时可用 —— 否则点了没反应，会让人以为坏了。
    const special=state.rayMode==='special';
    for(const b of $('rayMode').querySelectorAll('button[data-mode]')){
      b.classList.toggle('active',b.dataset.mode===state.rayMode);
      b.disabled=!state.rays;
    }
    const legend=hasExtra()
      ?'光线先经附加镜偏折，再经主凸透镜折射；最终交点决定清晰像面'
      :special
        ?'三条特殊光线：平行主轴 → 过 F′ ｜ 过光心 → 不偏折 ｜ 过物方焦点 → 出射平行主轴'
        :'每个发光点发出 13 条光线，经镜片后全部会聚（或反向会聚）到同一个像点；玻璃内部那一段画成有粗细的发光柱，能看出光线真的穿过了镜片';
    $('rayLegend').textContent=legend
      +(state.occlude>0?'；挡住的光线停在遮挡板上，其余光线仍会聚成完整的像，只是变暗':'');
    $('autoFocus').disabled=!canFocus(info)||state.screenRemoved;
    $('autoFocus').textContent=hasExtra()?'重新调到清晰像':'移到清晰位置';
    const blocked=info.real&&!state.screenRemoved&&!info.crisp;
    $('recordBtn').disabled=blocked;
    $('recordBtn2').disabled=blocked;
    $('recordBtn3').disabled=blocked;
    $('recordHint').textContent=blocked
      ?'请先移动光屏找到清晰像再记录':'现在可以记录本组观察';
    const toggle=state.screenRemoved?'放回光屏':'撤去光屏';
    $('screenToggle').textContent=toggle;
    $('screenToggle2').textContent=toggle;
    $('observerBtn').classList.toggle('active',state.observing);
    $('observerBtn2').classList.toggle('active',state.observing);
    const observerLabel=state.observing?'退出观察':'透过透镜观察';
    $('observerBtn').textContent=observerLabel;
    $('observerBtn2').textContent=observerLabel;
    // 「观察虚像大小与位置」是另一个按钮：只在 u < f 的虚像区可用。
    for(const id of ['compareBtn','compareBtn2']){
      const b=$(id);if(!b)continue;
      b.disabled=info.real||!Number.isFinite(info.v);
      b.classList.toggle('active',!!state.virtualCompare);
      b.textContent=state.virtualCompare?'退出虚像对照':'观察虚像大小与位置';
    }
    $('stage').classList.toggle('observer-mode',state.screenRemoved);
    $('ghostBadge').textContent=info.real?`实像（${info.inverted?'倒立':'正立'}，悬在空中）`:`虚像（${info.inverted?'倒立':'正立'}、放大 ${Math.abs(info.m).toFixed(2)}×）`;
    $('observeHint').textContent=hasExtra()
      ? (!info.real
        ?'组合镜组成虚像：点「透过透镜观察」把眼睛放到光屏一侧、透过镜片看虚像；点「观察虚像大小与位置」则用三维虚像和实物同屏对照像高与像距，拖动视角可检查它的空间位置。'
        :'附加镜已接入真实组合光路。保持光屏不动可先看到离焦模糊；再根据提示移动光屏，或点「重新调到清晰像」验证理论像距。')
      :info.needsScreenOff
      ?'u ≤ f：光屏接不到像。点「透过透镜观察」，视线必须从光屏一侧穿过镜片光圈才能看到虚像（镜片外什么也没有）；点「观察虚像大小与位置」可把三维虚像和实物同屏比较大小与像距，拖动视角可检查它的空间位置。'
      :'u > f：移动光屏接收实像，直到屏上的像最清晰。光屏是半透明膜：点「背面看光屏」绕到它后面，透过膜同样能看到这个像（左右翻转）；也可以点击 3D 画面里的光屏把它撤去，再看像是否仍悬在空中。';
    const lensName=state.extra==='convex'?'凸透镜':'凹透镜';
    if(hasExtra()){
      if(!Number.isFinite(info.v))$('extraHint').innerHTML='<b>当前无有限像：</b>组合出射光平行，请改变物距或附加镜焦距。';
      else if(!info.real)$('extraHint').innerHTML=`<b>附加${lensName}：</b>最终形成虚像，光屏无法承接；点「透过透镜观察」从光屏一侧看虚像，或点「观察虚像大小与位置」和实物同屏对照。`;
      else if(state.screenRemoved)$('extraHint').innerHTML=`理论清晰像面在主镜后 ${info.v.toFixed(1)} cm。请先放回光屏，再重新调节。`;
      else if(info.crisp)$('extraHint').innerHTML=`<b>已再次清晰：</b>光屏位于 ${state.scrP.toFixed(1)} cm 刻度，最终像距 ${info.v.toFixed(1)} cm。`;
      else{
        const near=info.v<state.sd;
        $('extraHint').innerHTML=`附加${lensName}后，清晰像面在主镜后 ${info.v.toFixed(1)} cm。请把光屏<b>${near?'向主镜靠近':'远离主镜'}</b>，约移动 ${Math.abs(info.v-state.sd).toFixed(1)} cm。`;
      }
    }else $('extraHint').textContent='先在不加镜片时调好清晰像，再加入凸透镜或凹透镜。光屏不会自动移动，观察像变模糊后，按提示重新调节。';
    let text;
    if(hasExtra()){
      if(!Number.isFinite(info.v))text='当前组合使出射光平行，有限距离内不能得到清晰像；请改变物距或附加镜焦距。';
      else if(!info.real)text=`附加${lensName}后，最终得到${info.inverted?'倒立':'正立'}虚像，光屏接不到；点「透过透镜观察」从光屏侧看虚像，或点「观察虚像大小与位置」对照。`;
      else if(!canFocus(info))text=`清晰实像在主镜后 ${info.v.toFixed(1)} cm，超出当前光屏范围；请移动主镜或改变物距。`;
      else if(state.screenRemoved)text=`光屏已撤去，最终实像仍在主镜后 ${info.v.toFixed(1)} cm；放回光屏后可重新调焦。`;
      else if(info.crisp)text=`重新调焦成功：光屏在主镜后 ${state.sd.toFixed(1)} cm，屏上得到清晰的${info.inverted?'倒立':'正立'}实像，${sizeRatio(info.m).phrase}。`;
      else text=`附加${lensName}使像面改变。光屏应${info.v<state.sd?'向主镜靠近':'远离主镜'}，目标刻度为 ${(state.lensP+info.v).toFixed(1)} cm。`;
    }else if(!Number.isFinite(info.v))text='u = f：折射后的光线同向平行射出，在有限位置不能获得清晰像；屏上和眼中都只有一片模糊。';
    else if(!info.real)text=`u = ${state.u.toFixed(1)} cm < f：实际光线在屏侧发散，反向延长后在光源同侧得到正立、放大的虚像（放大 ${Math.abs(info.m).toFixed(2)} 倍）。光屏接不到；要把眼睛放到光屏一侧、透过透镜才看得见它。`;
    else if(!canFocus(info))text=`实像位于透镜右侧 ${info.v.toFixed(1)} cm 处，已超出光屏滑动范围；把光源移远一点再试。`;
    else if(state.screenRemoved)text=`撤去光屏后，${preset.result}仍然悬在透镜右侧 ${info.v.toFixed(1)} cm 处；从光屏一侧透过透镜就能看到它。`;
    else if(info.crisp)text=`${preset.result}；光屏在 ${state.scrP.toFixed(1)} cm 刻度上得到最清晰的像。屏是半透明膜，绕到背面透过膜看到的是同一个像。`;
    else text=`光屏距离清晰像面 ${Math.abs(info.v-state.sd).toFixed(1)} cm。观察屏上模糊的轮廓，缓慢滑动光屏。`;
    if(state.occlude>0)
      text+=` 镜前遮挡板挡住镜片约 ${state.occlude}% 的面积，通过光量只剩约 ${100-state.occlude}%：像的轮廓一点没少，只是整体变暗。`;
    // 三心不同高：这是「调三心」这一步的实验依据，所以单独写清楚"差多少 → 像偏多少"。
    // 三心同高时整段不出现，不干扰原来的叙述。
    let liftText='';
    if(lifted){
      const off=info.offY;
      liftText=`<b>三心不同高</b>（焰心 ${objCy().toFixed(1)} cm、光心 ${lensCy().toFixed(1)} cm、屏心 ${scrCy().toFixed(1)} cm）：`
        +(Number.isFinite(off)&&!state.screenRemoved
          ?`像的中心落在屏心${off>0?'上':'下'}方 ${Math.abs(off).toFixed(1)} cm，`
            +(info.offScreen?'已经整个偏出膜面，屏上只剩一块空膜':'屏上的像整体偏在一边')
            +`。`
          :`像的中心搬到了 ${Number.isFinite(info.imgY)?info.imgY.toFixed(1)+' cm':'—'} 处。`)
        +`把三件器材调回同一高度，像才会回到屏心。`;
    }
    $('finding').innerHTML='<b>当前观察</b><br>'+(liftText?liftText+'<br>':'')+text;
    document.querySelectorAll('#presets button').forEach(b=>b.classList.toggle('active',b.dataset.case===info.kind));
    document.querySelectorAll('#sourceKind button').forEach(b=>b.classList.toggle('active',b.dataset.kind===state.source));
    document.querySelectorAll('#extraLensKind button').forEach(b=>b.classList.toggle('active',b.dataset.extra===state.extra));
    document.querySelectorAll('#steps button').forEach(b=>b.classList.toggle('active',+b.dataset.step===state.step));
    $('stepDetail').innerHTML=descriptions[state.step];
    render();
  }
  for(const [id,key] of [['focalLength','f'],['extraFocal','extraF'],['sourceHeight','sourceY'],['secondHeight','secondY'],['occlude','occlude'],
    ['liftCandle','liftCandle'],['liftLens','liftLens'],['liftScreen','liftScreen']])
    $(id).addEventListener('input',e=>{state[key]=+e.target.value;state.step=Math.max(state.step,1);update();});
  // 「三心调回同高」：就是真实实验里"调节三件器材使焰心、光心、屏心在同一高度"那一步。
  $('levelAll').addEventListener('click',()=>{
    state.liftCandle=state.liftLens=state.liftScreen=0;update();
  });
  $('sourceKind').addEventListener('click',e=>{
    const b=e.target.closest('button[data-kind]');if(!b)return;
    const changed=state.source!==b.dataset.kind;
    state.source=b.dataset.kind;state.step=Math.max(state.step,2);
    // 对照中换成 F 时，纯侧面会把字形看成一条线；给它能同时读到字形与厚度的斜前方。
    if(changed&&state.virtualCompare)state.yaw=state.source==='f'?.68:.18;
    update();
  });
  $('extraLensKind').addEventListener('click',e=>{
    const b=e.target.closest('button[data-extra]');if(!b)return;
    state.extra=b.dataset.extra;state.step=3;update();
  });
  $('secondSource').addEventListener('change',e=>{state.second=e.target.checked;update();});
  for(const [id,key] of [['showRays','rays'],['showVirtual','virtual'],['showLabels','labels']])
    $(id).addEventListener('change',e=>{state[key]=e.target.checked;update();});
  // 光路显示方式：与「显示光路」开关分开，这样开关本身仍然是原来的 checkbox（老行为不变），
  // 只是打开之后多一个「看全部光线 / 只看三条特殊光线」的选择。
  $('rayMode').addEventListener('click',e=>{
    const b=e.target.closest('button[data-mode]');if(!b)return;
    state.rayMode=b.dataset.mode;state.step=Math.max(state.step,2);update();
  });
  $('presets').addEventListener('click',e=>{
    const b=e.target.closest('button[data-case]');if(!b)return;
    const c=CASES.find(x=>x.id===b.dataset.case);
    const need=state.f*c.ratio;
    // Slide the lens right when the requested object distance would otherwise push the
    // source off the left end of the rail, so the preset always lands on its exact ratio.
    state.lensP=clamp(Math.max(state.lensP,need+RAIL.obj[0]+2),RAIL.lens[0],RAIL.lens[1]);
    state.objP=roundHalf(state.lensP-need);
    state.step=2;update();
  });
  // ===== 自动对焦 =====
  // 真实实验里是「慢慢推光屏，看到最清晰就停」；这里把这动作交给光屏自己走完。走过去的过程
  // 必须看得见，否则学生不知道光屏刚才干了什么，所以做成一 段 0.45 s 的匀速+缓动滑动。
  const prefersReduced=()=>!!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  let focusAnim=null;
  function autoFocus(){
    const info=status();
    if(!canFocus(info))return;
    const target=clamp(roundHalf(state.lensP+info.v),state.lensP+MIN_GAP,RAIL.screen[1]);
    state.step=3;
    // 光屏不在台上时先放回去：自动对焦的前提是屏在导轨上。
    if(state.screenRemoved){state.screenRemoved=false;state.autoScreen=false;state.observing=false;state.compare=false;}
    if(prefersReduced()||Math.abs(target-state.scrP)<.26){state.scrP=target;update();return;}
    // t0 不在这里取：requestAnimationFrame 给的时间戳和 performance.now() 在重负载下会差出
    // 好几百毫秒（软件渲染时实测差 400 ms 以上），混用会让动画前 0.4 s 一动不动。
    // 统一在第一帧里用 rAF 自己的时钟记起点。
    focusAnim={from:state.scrP,to:target,t0:null,frame:0};
    framed=false;                       // 滑动期间锁住取景，镜头别跟着一张一缩
    startLoop();
  }
  $('autoFocus').addEventListener('click',autoFocus);
  $('autoFocusTop').addEventListener('click',autoFocus);
  // Putting the screen on or taking it off the bench by hand: the automatic move only
  // happens when the optical situation itself changes, never to overrule the user.
  function setScreen(on){
    state.screenRemoved=!on;state.autoScreen=false;
    if(on){state.observing=false;state.compare=false;}
    update();
  }
  $('screenToggle').addEventListener('click',()=>setScreen(state.screenRemoved));
  $('screenToggle2').addEventListener('click',()=>setScreen(state.screenRemoved));
  // 站在原来光屏的位置，回身透过透镜看：这是看到虚像的唯一方式，也是看到撤屏后
  // 悬空实像最直观的方式。虚像用贴近镜片的光轴机位（见 throughCamera），
  // 实像仍沿用能看见空中像的侧前方机位。
  function toggleObserver(){
    if(state.observing){setScreen(true);return;}
    const info=status();
    state.observing=true;state.compare=false;state.screenRemoved=true;state.autoScreen=false;
    state.obsYaw=0;state.obsPitch=0;
    if(info.real){state.yaw=1.50;state.pitch=.12;state.zoom=1.4;}
    else {state.yaw=.06;state.pitch=.09;state.zoom=1.06;}
    update();
  }
  // 「观察虚像大小与位置」：把固定空间朝向的三维虚像和实物、量高量距辅助线放在同一画面里。
  // 它不改变任何光学量；拖动视角时由相机投影呈现真实的角度、透视和遮挡变化。
  // 关掉它，虚像就回到「只能从光屏一侧透过镜片看见」的物理规则。
  function toggleCompare(){
    if(state.virtualCompare){state.compare=false;update();return;}
    const info=status();
    if(info.real||!Number.isFinite(info.v))return;
    state.compare=true;state.observing=false;state.screenRemoved=true;state.autoScreen=false;
    state.yaw=state.source==='f'?.68:.18;state.pitch=.09;state.zoom=.98;
    update();
  }
  // 工具条上那颗，和参数面板里那颗，是同一件事（全屏时工具条不在舞台里，只能靠面板这颗）
  $('observerBtn').addEventListener('click',toggleObserver);
  $('observerBtn2').addEventListener('click',toggleObserver);
  for(const id of ['compareBtn','compareBtn2']){
    const b=$(id);if(b)b.addEventListener('click',toggleCompare);
  }
  // 记录表导出：拼成可以直接粘进表格软件 / 文档的制表符文本（首行是表头）。
  // 没记录的行照样导出、单元格留空 —— 粘出来仍是一张 5 行的完整表，缺哪几行一眼可见。
  function recordsTable(){
    const head=['物距区域','物距 u / cm','像距 v / cm','像的性质','像高 / 物高','光屏能否承接'];
    const rows=CASES.map(c=>{
      const r=state.records[c.id];
      return [c.name,r?r.u:'',r?r.v:'',r?r.nature:'',r?r.mag:'',r?r.onScreen:''];
    });
    return [head,...rows].map(r=>r.join('\t')).join('\n');
  }
  // One row per object-distance region, always present, so the shape of the finished table is
  // visible before anything has been recorded and the student can see what is still missing.
  function renderRecords(){
    $('records').innerHTML=CASES.map(c=>{
      const r=state.records[c.id];
      const cell=v=>r?`<td>${v}</td>`:'<td class="pending">—</td>';
      return `<tr data-case="${c.id}" class="${r?'filled':''}"><td>${c.name}</td>`
        +cell(r&&r.u)+cell(r&&r.v)+cell(r&&r.nature)+cell(r&&r.mag)+cell(r&&r.onScreen)+'</tr>';
    }).join('');
    const count=Object.keys(state.records).length;
    $('summary').textContent=count===5
      ?'五类物距已全部观察：物体从焦点外移向焦点，实像渐远、变大；进入焦点以内，形成正立、放大的虚像，光屏再也接不到。'
      :`已记录 ${count} / 5 类，还有 ${5-count} 类没有数据。`;
  }
  // Recording writes the same numbers the readout shows, so the table can always be checked
  // against the apparatus on screen.
  function recordMark(){
    const info=status();if(info.real&&!state.screenRemoved&&!info.crisp)return;
    const item=CASES.find(c=>c.id===info.baseKind);
    const real=info.real,size=sizeRatio(info.m);
    state.records[item.id]={
      name:item.name,u:state.u.toFixed(1),
      v:!Number.isFinite(info.v)?'∞':(info.v<0?'−':'')+Math.abs(info.v).toFixed(1),
      nature:!Number.isFinite(info.v)?'不成像'
        :(info.inverted?'倒立、':'正立、')+size.relation+(real?'的实像':'的虚像'),
      mag:!Number.isFinite(info.v)?'—':size.record,
      onScreen:real?'能':'不能'
    };
    renderRecords();
    // The table now sits straight under the stage, so the row that just changed is flashed once:
    // the eye stays on the apparatus and still sees which line the click landed on.
    const row=$('records').querySelector(`tr[data-case="${item.id}"]`);
    if(row){row.classList.add('flash');setTimeout(()=>row.classList.remove('flash'),1200);}
    state.step=4;update();
  }
  $('recordBtn').addEventListener('click',recordMark);
  $('recordBtn2').addEventListener('click',recordMark);
  $('recordBtn3').addEventListener('click',recordMark);
  $('clearRecords').addEventListener('click',()=>{
    state.records={};renderRecords();update();
  });
  // 复制为表格：优先用剪贴板 API；file:// 或没有权限时退回临时 textarea + execCommand。
  $('copyRecords').addEventListener('click',async()=>{
    const text=recordsTable();
    let ok=false;
    try{await navigator.clipboard.writeText(text);ok=true;}
    catch(_){
      const ta=document.createElement('textarea');ta.value=text;
      ta.style.position='fixed';ta.style.left='-9999px';document.body.appendChild(ta);
      ta.select();
      try{ok=document.execCommand('copy');}catch(__){ok=false;}
      ta.remove();
    }
    const n=Object.keys(state.records).length;
    $('recordNote').textContent=ok
      ?`已复制 ${n} / 5 行到剪贴板，可直接粘进表格或文档`
      :`复制被浏览器拦下，请手动选择表格复制（当前 ${n} / 5 行有数据）`;
    setTimeout(()=>{$('recordNote').textContent='共 5 类物距，未记录的行显示为 —';},2600);
  });
  $('resetAll').addEventListener('click',()=>{
    Object.assign(state,{f:10,objP:35,lensP:65,scrP:80,extra:'none',extraF:12,sourceY:12,secondY:8,second:false,
      liftCandle:0,liftLens:0,liftScreen:0,
      source:'candle',screenRemoved:false,autoScreen:false,observing:false,lastNeedsOff:false,compare:false,
      obsYaw:0,obsPitch:0,occlude:0,rays:false,virtual:true,labels:false,rayMode:'all',yaw:-.42,pitch:.21,zoom:1.06,step:0,records:{}});
    focusAnim=null;framed=true;
    for(const [id,checked] of [['showRays',false],['showVirtual',true],['showLabels',false]])$(id).checked=checked;
    renderRecords();
    update();
  });
  $('steps').addEventListener('click',e=>{const b=e.target.closest('[data-step]');if(!b)return;state.step=+b.dataset.step;update();});
  const VIEWS={side:[0,.10],front:[-1.22,.17],back:[1.22,.17],top:[-.54,1.17],reset:[-.42,.21]};
  document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{
    [state.yaw,state.pitch]=VIEWS[b.dataset.view];
    state.zoom=b.dataset.view==='reset'?1.06:1;
    if(b.dataset.view==='reset'){state.observing=false;state.compare=false;}
    update();
  }));
  const pointers=new Map();let pinch=0,dragPoint=null,dragRail=null,railGrab=0,press=null;
  // dragMode 在第一次明显移动后才定：横向 = 沿导轨走，纵向 = 沿立柱升降。
  let dragMode=null,liftGrab=0;
  function hitSource(e){
    if(state.source!=='candle')return null;
    const rect=canvas.getBoundingClientRect();
    const lift=state.liftCandle;
    const active=state.second?[{y:state.sourceY+lift,index:0},{y:state.secondY+lift,index:1}]:[{y:state.sourceY+lift,index:0}];
    for(const s of active){
      const q=project({x:wx(state.objP),y:s.y,z:1.1});
      if(Math.hypot(q.x-(e.clientX-rect.left),q.y-(e.clientY-rect.top))<26)return s.index;
    }
    return null;
  }
  const raycaster=new THREE.Raycaster();
  function castAt(e){
    const rect=canvas.getBoundingClientRect();
    if(!rect.width||!rect.height)return false;
    fitCamera();
    raycaster.setFromCamera(new THREE.Vector2(
      ((e.clientX-rect.left)/rect.width)*2-1, -((e.clientY-rect.top)/rect.height)*2+1), camera);
    return true;
  }
  // The screen itself is clickable, and so is the empty spot it leaves behind once it is off the
  // bench (an invisible pick plane, not a leftover frame), which is what makes "click to take it
  // off / click to put it back" work both ways.
  function hitScreen(e){
    if(!castAt(e))return false;
    return raycaster.intersectObject(state.screenRemoved?screenGhost:screen,true).length>0;
  }
  // The three slides are dragged straight along the rail: the pointer is cast onto the bench
  // top and the slide follows that world x, so the gesture reads the same from any angle.
  const RAIL_PLANE=new THREE.Plane(new THREE.Vector3(0,1,0),-3.2);
  const RAIL_KEY={candle:'objP',lens:'lensP',screen:'scrP'};
  function railXAt(e){
    if(!castAt(e))return null;
    const hit=new THREE.Vector3();
    if(!raycaster.ray.intersectPlane(RAIL_PLANE,hit))return null;
    return Math.abs(hit.x)<400?hit.x:null;
  }
  // 升降器械时的取点：过器材中心、正对镜头的一个竖平面。指针落在这个平面上的高度就是器材
  // 该到的高度 —— 无论从哪个角度拖，"往上拖"都真的往上。
  const V_PLANE=new THREE.Plane(), V_HIT=new THREE.Vector3();
  function liftYAt(e,x){
    if(!castAt(e))return null;
    const n=new THREE.Vector3(camera.position.x-x,0,camera.position.z);
    if(n.lengthSq()<1e-6)return null;
    n.normalize();
    V_PLANE.setFromNormalAndCoplanarPoint(n,new THREE.Vector3(x,0,0));
    if(!raycaster.ray.intersectPlane(V_PLANE,V_HIT))return null;
    return V_HIT.y;
  }
  function hitCarriage(e){
    if(!castAt(e))return null;
    let best=null,bestD=Infinity;
    for(const [kind,group] of [['candle',candle],['lens',lens],['screen',screen]]){
      if(kind==='screen'&&state.screenRemoved)continue;
      const hits=raycaster.intersectObject(group,true);
      if(hits.length&&hits[0].distance<bestD){bestD=hits[0].distance;best=kind;}
    }
    return best;
  }
  canvas.addEventListener('pointerdown',e=>{
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});canvas.setPointerCapture(e.pointerId);
    const single=pointers.size===1;
    dragPoint=single?hitSource(e):null;
    dragRail=(single&&dragPoint===null)?hitCarriage(e):null;
    if(dragRail){
      const x=railXAt(e);
      // Grabbing the slide where it already is stops it jumping under the pointer.
      railGrab=x===null?0:x-wx(state[RAIL_KEY[dragRail]]);
      framed=false;
    }
    press=single?{x:e.clientX,y:e.clientY,screen:hitScreen(e)}:null;
    dragMode=null;liftGrab=0;
    pinch=0;
  });
  canvas.addEventListener('pointermove',e=>{
    if(!pointers.has(e.pointerId)){
      const src=hitSource(e);
      const car=src===null?hitCarriage(e):null;
      canvas.classList.toggle('pick-source',src!==null);
      canvas.classList.toggle('pick-rail',car!==null);
      canvas.classList.toggle('pick-screen',src===null&&car===null&&hitScreen(e));
      return;
    }
    const prev=pointers.get(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pointers.size===1){
      if(dragPoint!==null){
        const key=dragPoint===0?'sourceY':'secondY',y=state[key];
        const p1=project({x:wx(state.objP),y,z:1.1}),p2=project({x:wx(state.objP),y:y+1,z:1.1});
        const px=p1.y-p2.y;
        if(Math.abs(px)>1){const next=clamp(roundHalf(y+(prev.y-e.clientY)/px),SRC_MIN,SRC_MAX);if(next!==y){state[key]=next;update();}}
      }else if(dragRail){
        // 先看这一下是横着拖还是竖着拖：横向沿导轨走，纵向沿立柱升降。定下来就不再改，
        // 免得拖到一半忽然变成升降（手指稍微歪一点就换动作会很难用）。
        const key=RAIL_KEY[dragRail],cx=wx(state[key]);
        if(!dragMode){
          const dx=Math.abs(e.clientX-press.x),dy=Math.abs(e.clientY-press.y);
          if(Math.max(dx,dy)<7)return;
          dragMode=dy>dx*1.2?'lift':'rail';
          if(dragMode==='lift'){
            const y=liftYAt(e,cx);
            liftGrab=y===null?0:y-liftOf(dragRail);
          }
        }
        if(dragMode==='rail'){
          const x=railXAt(e);
          if(x!==null){
            const next=roundHalf(x-railGrab-RULER0);
            if(next!==state[key]){state[key]=next;update();}
          }
        }else{
          const y=liftYAt(e,cx);
          if(y!==null){
            const lk=dragRail==='candle'?'liftCandle':dragRail==='lens'?'liftLens':'liftScreen';
            const next=clamp(roundHalf(y-liftGrab),0,LIFT_MAX);
            if(next!==state[lk]){state[lk]=next;update();}
          }
        }
      }else if(throughView()){
        // 观察模式下拖动 = 眼睛沿镜面轻微平移：画面不动但视线角度改变，
        // 偏出光圈时虚像立刻被镜框裁掉，和真实透镜一致。
        state.obsYaw=clamp(state.obsYaw-(e.clientX-prev.x)*.0022,-.16,.16);
        state.obsPitch=clamp(state.obsPitch+(prev.y-e.clientY)*.0022,-.13,.13);
        render();
      }else{
        state.yaw+=(e.clientX-prev.x)*.006;
        state.pitch=clamp(state.pitch+(prev.y-e.clientY)*.005,-1.0,1.28);
        render();
      }
    }else if(pointers.size===2){
      dragPoint=null;dragRail=null;press=null;
      const [a,b]=[...pointers.values()],d=Math.hypot(a.x-b.x,a.y-b.y);
      if(pinch)state.zoom=clamp(state.zoom*d/pinch,.68,2.35);
      pinch=d;render();
    }
  });
  const release=e=>{
    const was=press,wasRail=dragRail;
    pointers.delete(e.pointerId);dragPoint=null;dragRail=null;pinch=0;press=null;
    dragMode=null;liftGrab=0;
    // A drag that merely starts on the screen must not be read as a click on it.
    if(was&&pointers.size===0&&was.screen&&Math.hypot(e.clientX-was.x,e.clientY-was.y)<5)setScreen(state.screenRemoved);
    if(wasRail&&!framed){framed=true;render();}
  };
  canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',release);
  canvas.addEventListener('wheel',e=>{e.preventDefault();state.zoom=clamp(state.zoom*(e.deltaY>0?.91:1.1),.68,2.35);render();},{passive:false});
  canvas.addEventListener('keydown',e=>{
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-','='].includes(e.key)){
      e.preventDefault();
      if(e.key==='ArrowLeft')state.yaw-=.1;
      if(e.key==='ArrowRight')state.yaw+=.1;
      if(e.key==='ArrowUp')state.pitch=clamp(state.pitch+.1,-1,1.28);
      if(e.key==='ArrowDown')state.pitch=clamp(state.pitch-.1,-1,1.28);
      if(e.key==='+'||e.key==='=')state.zoom=clamp(state.zoom*1.1,.68,2.35);
      if(e.key==='-')state.zoom=clamp(state.zoom*.91,.68,2.35);
      render();
    }
  });
  // ===== 实验画面全屏 =====
  // 全屏目标取【整个舞台】：参数面板、刻度读数、光屏特写都是它的后代，所以全屏里照样能
  // 调参数、读刻度，不用退出来再按一次。
  // 切换后必须重排画布：:fullscreen 的布局在个别浏览器里要下一帧才落地，只排一次会拿到
  // 切换过程中的中间尺寸（画布被拉变形）；headless 里 rAF 还可能一次都不回调，
  // 所以再补一个 setTimeout 兜底（自检会数实际重排了几次，见 fsLayouts）。
  const stageBox=$('stage'),fsBtn=$('stageFs');
  const fsIsOn=()=>document.fullscreenElement===stageBox||document.webkitFullscreenElement===stageBox;
  let fsLayouts=0;
  function fsLayout(){resize();fsLayouts++;}
  fsBtn.addEventListener('click',()=>{
    if(document.fullscreenElement||document.webkitFullscreenElement){
      const exit=document.exitFullscreen||document.webkitExitFullscreen;
      if(exit)exit.call(document);
    }else if(stageBox.requestFullscreen){
      const p=stageBox.requestFullscreen();if(p&&p.catch)p.catch(()=>{});
    }else if(stageBox.webkitRequestFullscreen){
      stageBox.webkitRequestFullscreen();
    }
  });
  function onFsChange(){
    const on=fsIsOn();
    fsBtn.querySelector('.fs-expand').style.display=on?'none':'';
    fsBtn.querySelector('.fs-compress').style.display=on?'':'none';
    fsBtn.querySelector('.lbl').textContent=on?'退出':'全屏';
    fsBtn.title=on?'退出全屏':'全屏显示实验画面';
    fsBtn.setAttribute('aria-label',fsBtn.title);
    fsLayout();
    requestAnimationFrame(()=>requestAnimationFrame(fsLayout));
    setTimeout(fsLayout,90);
  }
  document.addEventListener('fullscreenchange',onFsChange);
  document.addEventListener('webkitfullscreenchange',onFsChange);

  // ===== 参数面板：可折叠，就住在实验画面里 =====
  // 参数多、又要和画面放一起，所以做成【默认收起】的浮层：收起时只剩一颗小药丸（不遮画面），
  // 展开后自己在面板里往下滚。折叠是纯界面状态：不停仿真、不动任何参数。
  const paramsBox=$('stageParams'),paramsHead=$('stageParamsHead'),
        paramsToggle=$('stageParamsToggle'),paramsBody=$('stageParamsBody');
  const paramsIsOpen=()=>!paramsBox.classList.contains('collapsed');
  function setParamsOpen(on){
    paramsBox.classList.toggle('collapsed',!on);
    paramsToggle.setAttribute('aria-expanded',on?'true':'false');
    paramsToggle.textContent=on?'▾ 收起':'▸ 展开';
    paramsToggle.title=on?'收起参数面板':'展开参数面板';
  }
  paramsToggle.addEventListener('click',e=>{e.stopPropagation();setParamsOpen(!paramsIsOpen());});
  // 标题栏整条都能点（比那个小按钮好按），但别让按钮那一下算两次
  paramsHead.addEventListener('click',e=>{
    if(e.target.closest&&e.target.closest('#stageParamsToggle'))return;
    setParamsOpen(!paramsIsOpen());
  });
  // 面板压在画布上方：指针与滚轮事件不能漏到舞台上去（否则会被当成「开始拖场景」）
  paramsBox.addEventListener('pointerdown',e=>e.stopPropagation());
  paramsBox.addEventListener('wheel',e=>e.stopPropagation(),{passive:true});
  setParamsOpen(false);                 // 与 HTML 上的 collapsed 对齐（默认收起）
  // 面板 / 全屏的自检读数：判据读【真的画在哪儿】（getBoundingClientRect），不是 CSS 写了什么。
  function paramsPanelInfo(){
    const r=paramsBox.getBoundingClientRect(),st=stageBox.getBoundingClientRect();
    return {open:paramsIsOpen(),text:paramsToggle.textContent,
      expanded:paramsToggle.getAttribute('aria-expanded'),
      bodyDisplay:getComputedStyle(paramsBody).display,
      // 面板必须是舞台的后代：全屏只渲染全屏元素及其子树，挂外面就进不去
      inStage:stageBox.contains(paramsBox),
      // 宽高先要是个真尺寸：面板被挪出全屏子树时 rect 会退化成 0×0，那种「0 落在框内」是假绿
      insideStage:r.width>40&&r.height>20&&r.left>=st.left-1&&r.right<=st.right+1
        &&r.top>=st.top-1&&r.bottom<=st.bottom+1,
      areaPct:+(r.width*r.height/(st.width*st.height)*100).toFixed(2),
      scrollable:paramsBody.scrollHeight>paramsBody.clientHeight+1,
      height:Math.round(r.height),width:Math.round(r.width)};
  }
  function fsInfo(){
    const st=stageBox.getBoundingClientRect();
    const fsel=document.fullscreenElement||document.webkitFullscreenElement;
    return {on:fsIsOn(),stageH:Math.round(st.height),viewH:window.innerHeight,
      stageFull:st.height>=window.innerHeight-2,
      canvasH:Math.round(canvas.getBoundingClientRect().height),
      rendererH:Math.round(renderer.getSize(new THREE.Vector2()).y),
      // 全屏里只有全屏元素及其子树会被画出来；面板必须在这棵子树里，否则全屏里根本没有它
      panelInFs:!!(fsel&&fsel.contains(paramsBox)),
      layouts:fsLayouts,label:fsBtn.querySelector('.lbl').textContent};
  }
  window.addEventListener('resize',resize);
  if(window.ResizeObserver)new ResizeObserver(resize).observe(canvas);
  // ===== 火焰跳动 =====
  // 真蜡烛的焰体一直在动：伸缩、左右摆、整体升降、亮度起伏。这里用几组【互不整除】的正弦叠加
  // 驱动，周期各不相同，所以看不出循环；再叠一个很慢的"阵风"，幅度一阵大一阵小。
  // 同一组参数既喂 3D 焰体，也喂那张 2D 物体图 —— 光屏上的像、预览窗、虚像都是拿这张图贴出来的，
  // 所以火焰一跳，像就跟着跳。而且像是倒立的：物体往上跳、像就往下跳，这正是真实看到的样子。
  const FLAME_BASE = 12.35;            // 焰体根部（烛芯上端）：伸长时这里固定不动
  function sampleFlame(t){
    const gust = Math.sin(t*.47)*.55 + Math.sin(t*1.13+1.7)*.30 + Math.sin(t*2.71+2.9)*.15;
    const sway = Math.sin(t*1.61+.4)*.55 + Math.sin(t*3.30+2.2)*.30 + Math.sin(t*5.70+1.3)*.15;
    const s  = 1 + gust*.11 + Math.sin(t*9.1)*.015;    // 焰体高度
    const sx = 1 - gust*.07;                            // 粗细（体积大致守恒）
    return { s, sx,
      dy : Math.abs(gust)*.10,       // 整体轻微上浮
      dz : sway*.30,                 // 左右摇摆，方向垂直于光轴 —— 像里才看得见
      tilt: sway*.13,
      bright: clamp(.86+.14*(.5+gust*.5),.70,1) };
  }
  function applyFlame(f){
    flame=f;
    for(const p of flameParts){
      p.m.scale.set(p.bx*f.sx,p.by*f.s,p.bz*f.sx);
      // 以烛芯为支点伸缩：火苗变高是"往上窜"，不是整团放大
      p.m.position.set(0,FLAME_BASE+(p.py-FLAME_BASE)*f.s+f.dy,f.dz);
      p.m.rotation.x=f.tilt;
    }
    // 烛光也跟着起伏：光屏、导轨上能看到一点点亮度呼吸
    if(warm.userData.base)warm.intensity=warm.userData.base*(.90+.10*f.bright);
  }
  applyFlame(flame);                   // 初始状态 = 基准形状（跳动关掉时就是这个样子）
  // ===== 动画循环 =====
  // 页面原来只在"有事件"时渲染；有了跳动就必须常驻渲染。但常驻渲染有个硬代价：只要画布每帧
  // 都变，浏览器就必须每帧把整块画布【提交上屏】。GPU 机器上这一步是几毫秒；可在纯软件渲染
  // （显卡驱动禁用了 WebGL、远程桌面、没有 GPU 的虚拟机）上，提交一帧要几百毫秒，而且开销
  // 和画布像素数成正比 —— 实测 2880×1920 时约 1 s/帧，主线程被整块占住，滚轮、按钮、全屏
  // 全都卡住。所以这里加一道【帧预算看门狗】：连续几帧的提交间隔都远超 30 fps 的预算，就
  // 先降到 10 fps，还撑不住就退回静态火焰并停掉循环（重新勾一次「火焰跳动」会再试一次）。
  // 省电另外几条：只在页面可见时跑；2D 的像约 15 帧/秒重贴（每次要重画 840×940 的膜纹理）。
  const ANIM_GAP = 33;          // 30 fps
  const ANIM_GAP_SLOW = 120;    // 降频档：10 fps
  const ANIM_SLOW_MS = 220;     // 一帧超过这个数就已经不够 4 fps 了
  const ANIM_DEAD_MS = 880;     // 一帧就要近 1 s：别硬撑，直接静态（软件渲染就是这一档）
  let rafId = 0, lastFrame = 0, lastImage = 0, lastPresent = 0;
  let slowRun = 0, animLevel = 2, animFrames = 0;
  function startLoop(){
    // 重新拉起时把时间基准清掉：lastPresent 停在几分钟前会被误判成"一帧花了 3 分钟"
    lastPresent = 0; lastFrame = 0; slowRun = 0;
    if(!rafId) rafId = requestAnimationFrame(tick);
  }
  function stopLoop(){ if(rafId){ cancelAnimationFrame(rafId); rafId = 0; } }
  // 时间 → 焰体 → 屏上的像（+ 预览窗）。抽成函数为的是两件事：循环每帧调它；自检可以按
  // 指定的时间点调它 —— 软件渲染下真实帧率只有 1~2 fps，"等 260 ms 看它变没变"会假红。
  function stepAnim(nowMs, withImage = true){
    applyFlame(sampleFlame(nowMs / 1000));
    renderer.shadowMap.needsUpdate = false;
    renderer.render(scene, camera);
    animFrames++;
    if(withImage){ redrawScreen(); paintInset(status()); }
    return flame;
  }
  function stopFlicker(){
    animLevel = 0;
    applyFlame({s:1,sx:1,dz:0,dy:0,tilt:0,bright:1});   // 停在标准形状，不是"半跳"
    // 自动停掉时勾选框还是勾着的，得让用户知道为什么不动了（不另占一行，挂成 tooltip）
    const box = $('flickerOn'), lab = box && box.closest('label');
    if(lab && state.flicker) lab.title = '这台设备渲染较慢，已自动暂停火焰动画；勾掉再勾上可以再试一次。';
    update();
  }
  // 一帧的真实开销（两次提交之间的间隔）超预算就降档，看门狗只在循环里调
  function animBudget(spent){
    if(!spent) return;                                  // 第一个基线帧，不判
    if(spent > ANIM_DEAD_MS){ stopFlicker(); return; }
    if(spent > ANIM_SLOW_MS){
      if(++slowRun < 3) return;
      slowRun = 0;
      if(animLevel === 2) animLevel = 1; else stopFlicker();
      return;
    }
    slowRun = 0;
  }
  function tick(now){
    rafId = requestAnimationFrame(tick);
    if(document.hidden) return;
    if(focusAnim){
      if(focusAnim.t0===null)focusAnim.t0=now;
      // 进度 = 时间为主 + 帧数为辅。只按时间算，遇到掉到 2 帧/秒的机器（软件渲染就是这样）
      // 光屏会"一站到位"，看不出滑动；掺进帧数就能保证至少走 8 格，帧率高时仍然是 0.5 s 到站。
      const timeK=clamp((now-focusAnim.t0)/520,0,1);
      const frameK=Math.min(1,++focusAnim.frame/8);
      const k=Math.min(1,.55*timeK+.45*frameK);
      const e=k<.5?2*k*k:1-Math.pow(-2*k+2,2)/2;
      state.scrP=roundHalf(focusAnim.from+(focusAnim.to-focusAnim.from)*e);
      if(k>=1){state.scrP=focusAnim.to;focusAnim=null;framed=true;update();}
      else update();
      lastFrame=now;lastImage=now;lastPresent=now;slowRun=0;
      return;
    }
    if(!state.flicker || animLevel===0){ stopLoop(); return; }   // 不跳了就别每秒白醒 60 次
    if(now-lastFrame < (animLevel===1 ? ANIM_GAP_SLOW : ANIM_GAP)) return;
    const spent = lastPresent ? now - lastPresent : 0;
    lastFrame = now; lastPresent = now;
    animBudget(spent);
    if(animLevel === 0) return;                                 // 刚被判停，这一帧不画
    const withImage = now - lastImage > 66;   // 膜上那张 840×940 的重贴不必每帧都做
    stepAnim(now, withImage);
    if(withImage) lastImage = now;
  }
  $('flickerOn').addEventListener('change',e=>{
    state.flicker=e.target.checked;
    // 关掉时把焰体精确还原成标准形状，再把膜上的像重贴一次 —— 否则会停在一个"半跳"的样子。
    if(!e.target.checked){stopFlicker();}
    // 重新勾上等于"再给它一次机会"：把看门狗清零、回到全速档
    else {
      const lab = e.target.closest && e.target.closest('label');
      if(lab) lab.removeAttribute('title');
      animLevel=2; slowRun=0; lastPresent=0; lastImage=0; startLoop();
    }
  });
  if(document.visibilityState==='visible')startLoop();
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)startLoop();});

  window.__lensLab={state,status,optics,canFocus,project,imageY,wx,setScreen,update,render,resize,
    AXIS,LIFT_MAX,lensCy,objCy,scrCy,autoFocus,sampleFlame,applyFlame,stepAnim,startLoop,stopLoop,
    get animLevel(){return animLevel;},
    get animFrames(){return animFrames;},
    // 自检要把档位强制拉回全速（软件渲染下看门狗几帧内就会把它降下来）
    setAnimLevel(n){animLevel=n;slowRun=0;lastPresent=0;lastImage=0;if(n>0)startLoop();},
    get flame(){return flame;},
    get focusAnim(){return focusAnim;},
    get rigs(){return {candle:candleRig,lens:lensRig,screen:screenRig};},
    get posts(){return {candle:candle.userData.post,lens:lens.userData.post,screen:screen.userData.post};},
    rayShiftsFor,diopterOf,recordsTable,renderRecords,LENS_AP,lightThrough,occluderCutY,lensSegmentFraction,
    stageBox,setParamsOpen,paramsIsOpen,paramsPanelInfo,fsInfo,
    get lastRayTraces(){return lastRayTraces;},
    debug:()=>{const i=status(),solidBox=new THREE.Box3().setFromObject(ghostSolid),solidSize=solidBox.getSize(new THREE.Vector3());return {objP:state.objP,lensP:state.lensP,scrP:state.scrP,u:state.u,sd:state.sd,
      liftCandle:state.liftCandle,liftLens:state.liftLens,liftScreen:state.liftScreen,
      lensCy:lensCy(),objCy:objCy(),scrCy:scrCy(),imgY:i.imgY,offY:i.offY,offScreen:i.offScreen,
      flameScale:flame.s,flameDz:flame.dz,flicker:state.flicker,
      animLevel,animFrames,rafOn:!!rafId,
      rigY:{candle:candleRig.position.y,lens:lensRig.position.y,screen:screenRig.position.y},
      extra:state.extra,extraF:state.extraF,u1:i.u1,v1:i.v1,u2:i.u2,m:i.m,auxLensX:wx(state.lensP)-AUX_GAP,
      cameraX:camera.position.x,cameraZ:camera.position.z,screenX:wx(state.scrP),
      kind:i.kind,v:Number.isFinite(i.v)?i.v:null,crisp:i.crisp,real:i.real,screenRemoved:state.screenRemoved,
      source:state.source,candle:candle.position.x,lens:lens.position.x,screen:screen.position.x,
      sources:lightSources.map(g=>g.position.y),rayCount:rays.children.length,
      rayMode:state.rayMode,diopter:diopterOf(state.f),
      ghost:ghostObject.visible,ghostX:ghostObject.position.x,ghostScale:ghostObject.scale.x,
      ghostSolid:ghostSolid.visible,ghostSolidKind:ghostSolid.visible?state.source:null,
      ghostSolidX:ghostSolid.position.x,ghostSolidScale:ghostSolid.scale.x,
      ghostSolidRotY:ghostSolid.rotation.y,ghostSolidSize:[solidSize.x,solidSize.y,solidSize.z],
      imageVisible:state.imageVisible,imageOnObjectSide:state.imageOnObjectSide,
      observing:state.observing,compare:!!state.virtualCompare,through:throughView(),
      cameraFov:camera.fov,outline:objectOutline.visible,candleVisible:candleBody.visible,
      raysVisible:rays.visible,ghostRotY:ghostObject.rotation.y,
      ghostMask:ghostMat.userData.shader?ghostMat.userData.shader.uniforms.uMask.value:null,
      occlude:state.occlude,light:lightThrough(),cardVisible:occluder.visible,
      cardBottom:occluderCutY(),cardTop:CARD_TOP,cardHeight:occluderCard.scale.y,
      cardX:wx(state.lensP)-CARD_GAP,ghostOpacity:ghostObject.material.opacity,
      frameFrozen:!framed,records:Object.keys(state.records),
      textureSize:[texCanvas.width,texCanvas.height],insetSize:[inset.width,inset.height]};}};
  // Pointer plumbing and the two authoring canvases are exposed so the self-check can drive the
  // very same hit tests and read the very same pixels the page uses, instead of re-implementing
  // them and only proving itself consistent.
  window.__lensLab.hitSource=hitSource;
  window.__lensLab.hitCarriage=hitCarriage;
  window.__lensLab.railXAt=railXAt;
  window.__lensLab.art={canvas:objCanvas,artY,artX,artXz,pxCm:ART_PX_CM};
  window.__lensLab.screen={canvas:texCanvas,pxCm:PX_CM};
  // 自检用：从光屏背面（+x 侧）朝膜中心看过去，会不会被别的实体挡住。
  // 「从背面也能看到像」的前提是：膜本身是双面可见的透光面片，而且膜的背面一侧没有
  // 一块不透明的板盖住它。这里直接遍历场景图，把挡住膜中心 (y=12,z=0) 这条视线的
  // 不透明实体列出来 —— 加回一块背板，这个列表立刻就不为空。
  window.__lensLab.screenBackProbe=()=>{
    const local=o=>{const v={x:0,y:0,z:0};for(let n=o;n&&n!==screen;n=n.parent){v.x+=n.position.x;v.y+=n.position.y;v.z+=n.position.z;}return v;};
    const blocking=[];
    screen.traverse(o=>{
      if(!o.isMesh||o===screenFace)return;
      if(o.material.transparent)return;          // 半透明的部件不算「挡死」
      const p=o.geometry.parameters||{};
      const r=p.radiusTop!==undefined?p.radiusTop:(p.radius||0);
      const hx=p.width!==undefined?p.width/2:r, hy=p.height!==undefined?p.height/2:r,
            hz=p.depth!==undefined?p.depth/2:r;
      const v=local(o);
      if(v.x<0.05)return;                        // 只在膜的背面一侧找
      // 包围盒「含」膜中心 (12, 0) 就算挡住，所以两边都取闭区间：一块背板就是 depth=0 的
      // 平面，hz 算出来是 0，用开区间时 v.z-hz<0 在 z=0 处恒不成立 —— 那样一块正对膜中心的
      // 不透明板会被漏掉（负向对照 N13 就是靠这条抓出来的）。
      if(v.y-hy<=12&&v.y+hy>=12&&v.z-hz<=0&&v.z+hz>=0)
        blocking.push({x:+v.x.toFixed(2),y:+v.y.toFixed(2),z:+v.z.toFixed(2)});
    });
    return {faceTransparent:!!screenFace.material.transparent,
      doubleSided:screenFace.material.side===THREE.DoubleSide, blocking};
  };
  window.__lensLab.fSource={group:fSource,strokes:F_STROKES,points:F_POINTS};
  // The scene graph itself is exposed for the round-7 checks: "the stage must be left completely
  // clear" and "no floating label for the eye" are properties of what is actually in the scene,
  // so the self-check reads the graph rather than re-deriving the geometry.
  window.__lensLab.scene=scene;
  // 渲染器 / 相机 / 两张 2D 画布的重绘函数也暴露出来：自检要量「一帧到底花在哪」——
  // 火焰跳动是常驻动画，必须能分别测出 3D 渲染和 2D 贴图重绘各自的代价。
  window.__lensLab.renderer=renderer;
  window.__lensLab.camera=camera;
  window.__lensLab.redrawScreen=redrawScreen;
  window.__lensLab.paintInset=paintInset;
  window.__lensLab.screenGhost=screenGhost;
  window.__lensLab.rays=rays;
  window.__lensLab.ghostObject=ghostObject;
  window.__lensLab.objectOutline=objectOutline;
  $('showRays').checked=state.rays;
  renderRecords();
  update();resize();
})();
