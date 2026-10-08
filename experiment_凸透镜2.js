import * as THREE from './assets/optics-three.min.js';

// The apparatus is assembled from dimensioned 3D parts, rather than drawn as a 2D diagram.
// World coordinates are centimetres. The optical axis is (x, 12, 0).
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
  const state = {
    f: 10, objP: 35, lensP: 65, scrP: 80,
    sourceY: 12, secondY: 8, second: false, source: 'candle',
    screenRemoved: false, autoScreen: false, observing: false, lastNeedsOff: false,
    rays: false, virtual: true, labels: false, rayMode: 'all', yaw: -.42, pitch: .21, zoom: 1.06,
    step: 0, records: {},
    // Written by updateGhost() each frame: whether the image is currently in the eye's view.
    imageVisible: false, imageOnObjectSide: false,
    get u() { return this.lensP - this.objP; },
    get sd() { return this.scrP - this.lensP; }
  };
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
    '<strong>认识器材：</strong>铝合金双槽导轨、带锁紧旋钮的滑座、圆环镜架与磨砂白屏均是独立的立体部件。关闭光路开关，绕着装置看它们的形状与连接方式。',
    '<strong>调整三心：</strong>焰心、透镜光心、光屏中心初始同在 12 cm 高度。画面右下角的读数面板会实时给出三个滑座在光具座上的刻度读数，以及物距 u 与像距 v。',
    '<strong>改变物距：</strong>蜡烛、凸透镜、光屏三个滑座都能移动。改变物距后，比较折射光线是汇聚、平行还是发散。',
    '<strong>移动光屏：</strong>u > f 时缓慢移动光屏，从散焦找到清晰实像；只有实像才能被光屏接住。切到 F 光源还能看清像的倒立与左右颠倒。',
    '<strong>记录归纳：</strong>记录各物距区域的数据。比较光屏中的像、两个发光点的相对位置，以及焦距与二倍焦距两处分界。'
  ];
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const roundHalf = x => Math.round(x * 2) / 2;
  const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);
  const status = () => {
    const f = state.f, u = state.u;
    const near = (a, b) => Math.abs(a - b) < 1e-6;
    const kind = u > 2*f ? 'far' : near(u, 2*f) ? 'twice' : u > f ? 'between' : near(u, f) ? 'focus' : 'near';
    const v = near(u, f) ? Infinity : f*u/(u-f);
    const crisp = u > f && !state.screenRemoved && v <= 75 && Math.abs(v-state.sd) <= .45;
    // A real image can only be received while the screen is on the bench.
    return { kind, v, real: u > f, crisp, needsScreenOff: u <= f };
  }
  // 接第 4 节「眼睛和眼镜」：镜片的度数 = 100 / f(m)。本页焦距用 cm，所以 度 = 10000 / f。
  // 公式与眼睛页是同一份（那边 f 用 m），cm → m 的换算只在这一处发生。
  const diopterOf = fCm => 100 / (fCm / 100);
  // The letter F is the classic object for showing that a real image is inverted in both
  // directions. Strokes are listed in world (z, y). The lit face points at the lens (+x), and
  // an eye on that side sees screen-right along -z, so the upright bar has to sit at z > 0 for
  // the letter to read normally from the lens; the screen then receives a 180° copy of it.
  const F_BAR = { z0: 1.78, z1: 2.4,  y0:7.5,  y1:16.5 };  // upright stroke
  const F_TOP = { z0:-2.4,  z1: 2.4,  y0:15.88,y1:16.5 };  // top arm
  const F_MID = { z0:-1.2,  z1: 2.4,  y0:12.6, y1:13.22 }; // middle arm
  const F_STROKES = [F_BAR, F_TOP, F_MID];
  // Three well separated corners used as ray origins and as ghost-image markers. These are
  // absolute world (z, y) on the F itself, not offsets from the axis.
  const F_POINTS = [{ z:2.4, y:16.5 }, { z:-2.4, y:16.5 }, { z:-1.2, y:12.91 }];

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
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
  const paper = material('#c6cbc3', .03, .88, { side: THREE.DoubleSide });
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
  function lineSegment(parent, p1, p2, color, opacity = 1, dashed = false) {
    const geometry = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    const mat = dashed
      ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 1, gapSize: .75, depthTest: false })
      : new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false });
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
  // Satin extruded rail with two grooves, a ruled inlaid strip, die-cast end caps and real feet.
  box(bench,[LENGTH,2.1,9.2],[CENTER,.2,0],chamfer);
  box(bench,[LENGTH-.8,.35,9.0],[CENTER,1.42,0],brightAlu);
  box(bench,[LENGTH-.8,.27,8.8],[CENTER,-.94,0],metalDark);
  for (const z of [-2.25, 2.25]) {
    box(bench,[LENGTH-.9,.095,1.25],[CENTER,1.66,z],slotBlack,false);
    box(bench,[LENGTH-.9,.06,.12],[CENTER,1.74,z-.70],brightAlu,false);
    box(bench,[LENGTH-.9,.06,.12],[CENTER,1.74,z+.70],brightAlu,false);
  }
  box(bench,[LENGTH-1,.15,.85],[CENTER,1.72,4.0],cream,false);
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
  // Dense millimetre-style engraved marks; every unit is one model centimetre.
  const ticks = new THREE.Group(); bench.add(ticks);
  const tickMaterial = new THREE.LineBasicMaterial({ color: '#566067', transparent: true, opacity: .78 });
  const vertices=[];
  for (let x=-62;x<=80;x+=1) {
    const mark = x%10===0 ? .66 : x%5===0 ? .48 : .29;
    vertices.push(x,1.81,4.08-mark/2, x,1.81,4.08+mark/2);
  }
  const tg = new THREE.BufferGeometry();tg.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  ticks.add(new THREE.LineSegments(tg,tickMaterial));
  const tickLabels = new THREE.Group();bench.add(tickLabels);
  function rulerLabel(text,x) {
    const c=document.createElement('canvas');c.width=100;c.height=64;
    const g=c.getContext('2d');g.fillStyle='#38454c';g.textAlign='center';g.font='bold 33px sans-serif';g.fillText(text,50,44);
    const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;
    const plane = mesh(new THREE.PlaneGeometry(2.15,1.36),new THREE.MeshBasicMaterial({map:t,transparent:true,depthWrite:false,side:THREE.DoubleSide}),tickLabels,x,1.82,3.25,false);
    plane.rotation.x=-Math.PI/2;
  }
  for(let x=-65;x<=75;x+=10)rulerLabel(String(x-RULER0),x);
  // Factory scale marker / inlaid metal plaque, independent of ruler labels.
  const makerTex=labelTexture('OPTICAL BENCH  ·  01','#4a555a');
  const maker=mesh(new THREE.PlaneGeometry(15.7,1.60),new THREE.MeshBasicMaterial({map:makerTex,transparent:true,side:THREE.DoubleSide}),bench,-32,.12,4.67,false);
  maker.receiveShadow=false;

  const sliders = {};
  function makeSlider(kind) {
    const group = new THREE.Group();scene.add(group);
    const runner = new THREE.Group(); group.add(runner);
    box(runner,[6.7,1.1,9.1],[0,2.36,0],alu);
    box(runner,[6.35,.17,8.8],[0,2.99,0],brightAlu);
    for (const z of [-2.25,2.25]) box(runner,[5.8,.1,1.45],[0,1.82,z],slotBlack);
    // The screen's own frame sits in front of its slide, so the post is pushed behind the
    // panel; otherwise the stem would poke through the diffusing face.
    const sx=kind==='screen'?.70:0;
    const stem = cylinder(group,.38,kind==='candle'?3.65:kind==='lens'?4.1:3.45,[sx,kind==='candle'?5:kind==='lens'?5.25:4.9,0],brightAlu);
    const col = cylinder(group,.62,.40,[sx,3.31,0],metalDark);
    const lock = cylinder(group,.77,.48,[1.55,2.43,5.0],bronze,24);
    lock.rotation.x=Math.PI/2;
    const dial = cylinder(group,.50,.53,[1.55,2.43,5.3],brass,24);
    dial.rotation.x=Math.PI/2;
    cylinder(group,.20,.40,[1.55,2.43,5.53],metalDark,16).rotation.x=Math.PI/2;
    // Midpoint engraved index on the sliding base.
    box(group,[.15,.05,.8],[0,3.12,4.0],material(kind==='candle'?'#cf8351':kind==='lens'?'#4a7b82':'#708395',.2,.4),false);
    sliders[kind]=group;return group;
  }
  const candle = makeSlider('candle');
  const lens = makeSlider('lens');
  const screen = makeSlider('screen');

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
  const candleBody = new THREE.Group(); candle.add(candleBody);
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
  const dish=cylinder(candleBody,1.52,.16,[0,6.54,0],material('#a79571',.2,.48),40);

  // F-shaped light source: an opaque housing with a bright F aperture, carried by the same
  // slide as the candle so both objects share one optical axis and one object plane.
  const fSource=new THREE.Group();candle.add(fSource);fSource.visible=false;
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

  const sources = new THREE.Group();candle.add(sources);
  const ghostLabels = new THREE.Group();scene.add(ghostLabels);

  // Ring, barrel, edge fasteners and two slightly convex glass faces.
  const ringMat=material('#535d5b',.46,.30);
  const silver=material('#cbd1d0',.65,.20);
  const ring=mesh(new THREE.TorusGeometry(6.02,.46,14,84),ringMat,lens,0,12,0);
  ring.rotation.y=Math.PI/2;
  for(const x of [-.52,.52]) {
    const trim=mesh(new THREE.TorusGeometry(5.96,.085,8,84),silver,lens,x,12,0);
    trim.rotation.y=Math.PI/2;
  }
  for(let a=0;a<Math.PI*2;a+=Math.PI/2){
    const y=12+6.03*Math.cos(a),z=6.03*Math.sin(a);
    const screw=mesh(new THREE.CylinderGeometry(.18,.18,.21,12),brass,lens,-.56,y,z);
    screw.rotation.z=Math.PI/2;
  }
  const glassMat=new THREE.MeshPhysicalMaterial({
    color:'#eef9f4',metalness:0,roughness:.04,transmission:.88,thickness:.8,
    ior:1.45,transparent:true,opacity:.88,side:THREE.DoubleSide,depthWrite:false,envMapIntensity:1.7
  });
  function glassCap(sign){
    const verts=[],indices=[],R=5.65,rings=14,segments=64;
    for(let j=0;j<=rings;j++){
      const r=R*j/rings;
      for(let i=0;i<=segments;i++){
        const a=i*2*Math.PI/segments;
        verts.push(sign*(.12+.83*(1-(r/R)**2)), 12+r*Math.cos(a), r*Math.sin(a));
      }
    }
    for(let j=0;j<rings;j++)for(let i=0;i<segments;i++){
      const n=j*(segments+1)+i,m=n+segments+1;
      indices.push(n,m,n+1,m,m+1,n+1);
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));g.setIndex(indices);g.computeVertexNormals();
    mesh(g,glassMat,lens,0,0,0,false);
  }
  glassCap(-1);glassCap(1);
  // Faint polished-ring glints rotate with the object rather than being pinned to the screen.
  const highlight = mesh(new THREE.TorusGeometry(6.05,.055,8,24,Math.PI*.58),material('#f4f7ee',.1,.12,{transparent:true,opacity:.85}),lens,-.12,12,0,false);
  highlight.rotation.y=Math.PI/2;
  highlight.rotation.x=.48;
  const lensLabel=badge(lens,'凸透镜 · f 可调',[0,20,0],'#485c63',17);

  // Fixed rectangular white diffusing screen. The texture grid matches the 16.8 x 18.8 cm
  // face exactly (50 px per cm), so the projected image is never stretched or upscaled.
  const texCanvas=document.createElement('canvas');texCanvas.width=840;texCanvas.height=940;
  const texCtx=texCanvas.getContext('2d');
  const screenTexture=new THREE.CanvasTexture(texCanvas);
  screenTexture.colorSpace=THREE.SRGBColorSpace;
  screenTexture.anisotropy=Math.min(16,renderer.capabilities.getMaxAnisotropy());
  const screenMat=new THREE.MeshBasicMaterial({map:screenTexture,side:THREE.DoubleSide, toneMapped:false});
  box(screen,[.28,19.9,17.9],[.22,12,0],brightAlu);
  box(screen,[.25,19.0,17.0],[-.02,12,0],paper);
  const screenFace=mesh(new THREE.PlaneGeometry(16.8,18.8),screenMat,screen,-.17,12,0,false);
  screenFace.rotation.y=-Math.PI/2;
  screenFace.receiveShadow=false;
  const screenBack=mesh(new THREE.PlaneGeometry(16.8,18.8),new THREE.MeshStandardMaterial({color:'#c3c8c2',roughness:.82,side:THREE.DoubleSide}),screen,.39,12,0,false);
  screenBack.rotation.y=Math.PI/2;
  for(const z of [-8.85,8.85])box(screen,[.82,20.5,.42],[.2,12,z],metalDark);
  for(const y of [1.95,22.05])box(screen,[.82,.42,18.1],[.2,y,0],metalDark);
  for(const z of [-8.25,8.25])for(const y of [2.5,21.5]){
    const bolt=mesh(new THREE.CylinderGeometry(.12,.12,.18,12),brass,screen,-.66,y,z);
    bolt.rotation.z=Math.PI/2;
  }
  box(screen,[.35,12.0,.40],[.57,12,0],alu);
  const screenLabel=badge(screen,'毛玻璃光屏',[-.2,25,0],'#4c6070',14);
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
      // Geometry is always unique to its mesh; materials are shared except for the
      // deliberately cloned ghost markers, which own theirs.
      else if(child.isMesh){child.geometry.dispose();if(group===ghostLabels)child.material.dispose();}
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
    warm.position.set(wx(state.objP),isCandle?state.sourceY:12,2.4);
    warm.intensity=isCandle?6:5;
  }

  function imageY(sourceY,v){return 12-(sourceY-12)*v/state.u;}
  const rays=new THREE.Group();scene.add(rays);
  // 玻璃镜片的半口径（glassCap 里 R = 5.65）。特殊光线若落在它外面就不画，
  // 否则会画出一条从镜片旁边飘过去的「光线」，看着像穿模。
  const LENS_AP=5.65;
  // A ray leaves an object point, bends once in the lens plane and then travels straight.
  // Both transverse axes obey the same rule, so the fan stays correct for the planar F.
  function traceRay(src,LX,stopX,shiftY,shiftZ,color,opacity){
    const u=state.u,f=state.f;
    const y0=src[0],z0=src[1];
    const YL=12+shiftY,ZL=shiftZ;
    const sy=(YL-y0)/u-(YL-12)/f, sz=(ZL-z0)/u-ZL/f;
    const hit=V(LX,YL,ZL),start=V(LX-u,y0,z0),dx=stopX-LX;
    lineSegment(rays,start,hit,color,opacity);
    lineSegment(rays,hit,V(stopX,YL+sy*dx,ZL+sz*dx),color,opacity+.05);
    return {hit,YL,ZL,sy,sz};
  }
  // 光线的两种取法：
  //  · 'all'     —— 物点发出的一束光里取三条等间距采样（看得出会聚/发散，就是「光路」本身）
  //  · 'special' —— 教材的三条特殊光线作图。每条都能用薄透镜公式独立验证：
  //      ① 平行主轴入射 ⇒ 打在透镜高度 YL = y0 ⇒ 出射斜率 sy = −(y0−12)/f（过像方焦点 F′）
  //      ② 过光心入射   ⇒ YL = 12        ⇒ sy = (12−y0)/u（不偏折）
  //      ③ 过物方焦点 F ⇒ YL = (f·y0 − 12u)/(f − u) ⇒ sy = 0（出射平行主轴）
  //    u = f 时第 ③ 条的落点发散（分母 → 0），此时不画它。
  function rayShiftsFor(y0){
    if(state.rayMode!=='special')return [[-3.7,0],[0,0],[3.7,0]];
    const u=state.u,f=state.f;
    const list=[[y0-12,0],[0,0]];
    const den=f-u;
    if(Math.abs(den)>1e-6){
      const YL=(f*y0-12*u)/den;
      if(Math.abs(YL-12)<=LENS_AP)list.push([YL-12,0]);
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
    // 三条特殊光线是【子午面作图】，所以起点一律投影到 z = 0 的平面上。
    const special=state.rayMode==='special';
    const active=(state.source==='f'
      ? F_POINTS.map(p=>({y:p.y,z:p.z,c:'#c98c46'}))
      : (state.second?[{y:state.sourceY,z:0,c:'#d99a48'},{y:state.secondY,z:0,c:'#4b8fc4'}]:[{y:state.sourceY,z:0,c:'#d99a48'}]))
      .map(s=>special?{y:s.y,z:0,c:s.c}:s);
    for(const src of active){
      for(const [shiftY,shiftZ] of rayShiftsFor(src.y)){
        const r=traceRay([src.y,src.z],LX,stopX,shiftY,shiftZ,src.c,.85);
        lastRayTraces.push({src:{y:src.y,z:src.z},shiftY,shiftZ,YL:r.YL,ZL:r.ZL,sy:r.sy,sz:r.sz});
        // Behind the lens the extensions meet again where the upright virtual image is. They are
        // a construction aid rather than the observation itself, so they answer to their own
        // switch, and they are only drawn while that image is genuinely in view.
        if(c&&!c.inverted&&seen&&state.virtual)lineSegment(rays,r.hit,V(LX+v,r.YL+r.sy*v,r.ZL+r.sz*v),src.c,.6,true);
      }
      const mark=(op)=>{
        const g=mesh(new THREE.SphereGeometry(.34,16,12),src.c==='#4b8fc4'?blue:gold,ghostLabels,LX+v,12-(src.y-12)*v/u,-src.z*v/u,false);
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
    const LX=wx(state.lensP);
    if(v<0)return LX+v>=-62?{v,inverted:false}:null;
    return state.screenRemoved&&info.real&&v<=95?{v,inverted:true}:null;
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
    const t=(LX-C.x)/((LX+v)-C.x);
    if(!(t>0&&t<1))return false;
    const gy=C.y+t*(12-C.y),gz=C.z+t*(0-C.z);
    return Math.hypot(gy-12,gz)<=(was?7.6:6.3);
  }
  // Recomputed before the camera is framed, because it depends on where the eye is: orbiting
  // round to the object side has to make the image disappear immediately.
  function updateGhost(){
    const c=imageCase();
    const show=!!c&&imageSeenFromCamera(c.v);
    ghostObject.visible=show;
    if(show){
      const size=clamp(Math.abs(c.v)/state.u,.2,3.2);
      ghostObject.position.set(wx(state.lensP)+c.v,12,0);
      ghostObject.scale.set(c.inverted?-size:size,c.inverted?-size:size,1);
      ghostObject.material.opacity=c.inverted?.32:.48;
    }
    ghostLabels.visible=show;
    // Stored on the state so the self-check reads the very decision the renderer used.
    state.imageVisible=show;
    state.imageOnObjectSide=!!c&&c.v<0;
    return show;
  }
  const format = y => `${y.toFixed(1)} cm`;
  // The object is authored once on a square-centimetre grid and then re-projected by a
  // single rule: a real image is that grid rotated 180° and scaled by the distance ratio.
  // 50 texture pixels per model centimetre keeps the screen face and the close-up preview
  // at the same sampling density, so nothing is drawn by upscaling a small bitmap.
  const PX_CM = 50, ART_PX_CM = 24;
  const objCanvas = document.createElement('canvas');
  objCanvas.width = 10 * ART_PX_CM; objCanvas.height = 12 * ART_PX_CM;
  const objCtx = objCanvas.getContext('2d');
  const artX = z => objCanvas.width / 2 + z * ART_PX_CM;
  const artY = y => objCanvas.height / 2 + (12 - y) * ART_PX_CM;
  // The art canvas is authored as the object looks from the lens side, where screen-right runs
  // along -z. The candle is symmetric about z = 0 so artX serves it, but the letter F is not:
  // its strokes have to be mirrored in z to be drawn the way the lens actually sees them.
  const artXz = z => objCanvas.width / 2 - z * ART_PX_CM;
  const artStroke = (g, s) => g.fillRect(
    Math.min(artXz(s.z0), artXz(s.z1)), artY(s.y1),
    (s.z1 - s.z0) * ART_PX_CM, (s.y1 - s.y0) * ART_PX_CM);
  // The ghost plane is a 10 x 12 cm window that carries a copy of the object art, so the
  // virtual image (or a real image with no screen to land on) is visible in the 3D scene.
  const ghostCanvas = document.createElement('canvas');
  ghostCanvas.width = objCanvas.width; ghostCanvas.height = objCanvas.height;
  const ghostCtx = ghostCanvas.getContext('2d');
  const ghostTex = new THREE.CanvasTexture(ghostCanvas);
  ghostTex.colorSpace = THREE.SRGBColorSpace;
  const ghostObject = mesh(new THREE.PlaneGeometry(10,12),
    new THREE.MeshBasicMaterial({map:ghostTex,transparent:true,opacity:.48,depthWrite:false,
      toneMapped:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending}),
    scene,0,12,0,false);
  ghostObject.rotation.y = Math.PI/2;
  ghostObject.renderOrder = 6;
  ghostObject.visible = false;
  function drawObjectArt(){
    const g = objCtx; g.clearRect(0, 0, objCanvas.width, objCanvas.height);
    if (state.source === 'f') {
      // The lit strokes glow, so the letter stays legible after the 180° image rotation.
      g.shadowColor = '#ffd98a'; g.shadowBlur = 14; g.fillStyle = '#fffaf0';
      for (const s of F_STROKES) artStroke(g, s);
      g.shadowBlur = 0;
    } else {
      g.fillStyle = '#f0e6cc'; g.shadowColor = '#b99a68'; g.shadowBlur = 6;
      g.beginPath(); g.roundRect(artX(-.95), artY(11.8), 1.9 * ART_PX_CM, 5.5 * ART_PX_CM, 3); g.fill();
      g.fillStyle = '#fdf6e2'; g.fillRect(artX(-.62), artY(11.6), 1.24 * ART_PX_CM, 5.2 * ART_PX_CM);
      g.fillStyle = '#3a3129'; g.fillRect(artX(-.07), artY(12.6), .14 * ART_PX_CM, .9 * ART_PX_CM);
      g.shadowColor = '#ffab3d'; g.shadowBlur = 26;
      const fy = artY(13.05);
      g.fillStyle = '#ffb64f'; g.beginPath(); g.ellipse(artX(0), fy, .5 * ART_PX_CM, 1.15 * ART_PX_CM, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff2c6'; g.beginPath(); g.ellipse(artX(0), fy + 3, .24 * ART_PX_CM, .62 * ART_PX_CM, 0, 0, Math.PI * 2); g.fill();
    }
    // The sampling points belong to the candle; the F already carries its own shape.
    if (state.source === 'f') return;
    for (const [y, color] of [[state.sourceY, '#e79a3c'], ...(state.second ? [[state.secondY, '#4b8fc4']] : [])]) {
      g.shadowColor = color; g.shadowBlur = 20; g.fillStyle = color;
      g.beginPath(); g.arc(artX(0), artY(y), .42 * ART_PX_CM, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(artX(0), artY(y), .16 * ART_PX_CM, 0, Math.PI * 2); g.fill();
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
  // Stamps the object art onto any canvas. The sampling density must be passed in, because
  // the screen face and the close-up preview are drawn at different pixels per centimetre.
  function stampObject(g, cx, cy, magnification, flip, pxPerCm){
    const k = pxPerCm / ART_PX_CM * magnification;
    g.save(); g.translate(cx, cy); g.scale(flip ? -k : k, flip ? -k : k);
    g.drawImage(objCanvas, -objCanvas.width / 2, -objCanvas.height / 2);
    g.restore();
  }
  // Defocus follows the circle of confusion of a real lens of this aperture, which is why
  // the image snaps sharp exactly when the screen reaches the conjugate distance.
  function blurSigma(offsetCm, vCm, pxPerCm = PX_CM){
    const confusion = vCm > 0 ? 2 * 5.6 * offsetCm / vCm : 999;
    return clamp(confusion * pxPerCm / 2.5, 0, 40);
  }
  function paintPaper(c, w, h){
    // A slightly grey diffusing screen: the projected image is light added on top, so the
    // paper must stay darker than the image for the strokes to read at a glance.
    const grad = c.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#a8aea8'); grad.addColorStop(.52, '#c2c0b6'); grad.addColorStop(1, '#959a94');
    c.fillStyle = grad; c.fillRect(0, 0, w, h);
    // Seeded deterministic grain, so nothing flickers while the camera is dragged.
    let seed = 87591;
    for (let i = 0; i < 900; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0; const x = seed % w;
      seed = (seed * 1664525 + 1013904223) >>> 0; const y = seed % h;
      c.fillStyle = i % 4 ? '#4a5a6412' : '#ffffff20'; c.fillRect(x, y, 1, 1);
    }
  }
  function redrawScreen(){
    const c=texCtx,w=texCanvas.width,h=texCanvas.height;
    // The object art is the single source for the screen texture, the preview and the ghost.
    drawObjectArt();
    ghostCtx.clearRect(0,0,ghostCanvas.width,ghostCanvas.height);
    ghostCtx.drawImage(objCanvas,0,0);
    ghostTex.needsUpdate=true;
    c.setTransform(1,0,0,1,0,0);
    c.filter='none';c.globalAlpha=1;
    c.clearRect(0,0,w,h);
    paintPaper(c,w,h);
    const info=status();
    const m=state.sd/state.u;
    if(info.real&&Number.isFinite(info.v)&&info.v<=300&&!state.screenRemoved){
      const offset=Math.abs(state.sd-info.v), sigma=blurSigma(offset,info.v);
      c.save();c.beginPath();c.rect(6,6,w-12,h-12);c.clip();
      c.globalAlpha=clamp(1-offset/80,.45,1);
      c.filter=sigma<.5?'none':`blur(${sigma.toFixed(1)}px)`;
      stampObject(c,w/2,h/2,m,true,PX_CM);
      c.restore();
      // A faint axis line lets the image be judged against the optical axis.
      c.save();c.globalAlpha=.15;c.strokeStyle='#6b7b83';c.lineWidth=1.5;
      c.beginPath();c.moveTo(w/2,10);c.lineTo(w/2,h-10);c.stroke();c.restore();
    }
    c.strokeStyle='#a7a9a154';c.lineWidth=1.5;c.strokeRect(5,5,w-10,h-10);
    screenTexture.needsUpdate=true;
    paintInset(info);
  }
  // The preview is painted at its own resolution instead of cropping the screen texture, so
  // it stays genuinely sharp. It shows what the eye receives: the diffusing screen while it
  // is on the bench, otherwise the image seen through the lens from the screen side.
  function paintInset(info){
    const W=inset.width,H=inset.height,g=insetCtx;
    g.setTransform(1,0,0,1,0,0);g.filter='none';g.globalAlpha=1;
    const m=state.sd/state.u;
    const throughLens=state.screenRemoved||!info.real;
    let mode=throughLens?(info.kind==='focus'?'none':info.real?'air':'virtual'):'screen';
    let mag=throughLens?Math.abs(info.v)/state.u:Math.abs(m);
    if(!Number.isFinite(mag))mode='none';
    if(mode==='none'){
      g.fillStyle='#0d1820';g.fillRect(0,0,W,H);
      g.textAlign='center';g.textBaseline='middle';
      g.fillStyle='#7fd4f2';g.font='bold 34px sans-serif';g.fillText('u = f',W/2,H/2-30);
      g.fillStyle='#cfe3ec';g.font='19px sans-serif';
      g.fillText('折射光平行射出，没有清晰的像',W/2,H/2+16);
      g.fillText('把光源移开焦点再观察',W/2,H/2+48);
      $('previewText').textContent='u = f：折射光平行射出，屏上和眼中都看不到清晰的像';
      $('previewTitle').textContent='透过透镜观察';
      return;
    }
    // The preview always frames the image, so its size does not depend on how far the
    // screen happens to sit. When the image is genuinely huge only part of it fits.
    const span=objectSpan(),mid=(span.top+span.bottom)/2;
    const capCm=mode==='screen'?18.8:30;
    const needCm=(span.top-span.bottom)*mag;
    const viewCm=clamp(needCm*1.7,4.6,capCm);
    const pxCm=H/viewCm;
    const clipped=needCm>viewCm*.94;
    // The frame centres the image itself. stampObject places the art's own centre, which is
    // the optical axis, at (W/2, cy), so cy shifts by however far the image centre moved.
    const cy=H/2+(mode==='virtual'?1:-1)*pxCm*mag*(mid-12);
    g.save();
    if(mode==='screen'){
      paintPaper(g,W,H);
      const offset=Math.abs(state.sd-info.v),sigma=blurSigma(offset,info.v,pxCm);
      g.beginPath();g.rect(4,4,W-8,H-8);g.clip();
      g.filter=sigma<.5?'none':`blur(${sigma.toFixed(1)}px)`;
      stampObject(g,W/2,cy,mag,true,pxCm);
    }else{
      const bg=g.createRadialGradient(W/2,H/2,10,W/2,H/2,H*.78);
      bg.addColorStop(0,'#20323d');bg.addColorStop(1,'#0b141a');
      g.fillStyle=bg;g.fillRect(0,0,W,H);
      // The eye sees the image hanging in air, so a dashed axis is the only reference.
      g.strokeStyle='#7fd4f255';g.lineWidth=1.5;g.setLineDash([9,8]);
      g.beginPath();g.moveTo(10,cy);g.lineTo(W-10,cy);g.stroke();g.setLineDash([]);
      g.save();g.beginPath();g.rect(4,4,W-8,H-8);g.clip();
      // A real image is inverted in both directions; only the virtual image stays upright.
      stampObject(g,W/2,cy,mag,mode==='air',pxCm);
      g.restore();
    }
    g.restore();
    g.strokeStyle='#a7a9a155';g.lineWidth=1.5;g.strokeRect(4,4,W-8,H-8);
    const sizeText=`放大 ${mag.toFixed(2)} 倍`;
    $('previewTitle').textContent=mode==='screen'?'光屏近景 · 放大观察'
      :mode==='air'?'透过透镜 · 空中的实像':'透过透镜 · 正立的虚像';
    $('previewText').textContent = mode==='screen'
      ? (info.crisp?'屏上得到清晰的倒立实像 · '+sizeText
        :`离焦 ${Math.abs(info.v-state.sd).toFixed(1)} cm · 移动光屏寻找像`)
      : (mode==='air'?'撤去光屏后，实像仍悬在空中（倒立） · '+sizeText
        :'透过透镜看到正立、放大的虚像（与物同侧） · '+sizeText)
        +(clipped?' · 像很大，画面只显示局部':'');
  }

  function cameraPosition(){
    const radius=190/state.zoom;
    camera.position.set(target.x+radius*Math.sin(state.yaw)*Math.cos(state.pitch),
      target.y+radius*Math.sin(state.pitch),radius*Math.cos(state.yaw)*Math.cos(state.pitch));
    camera.lookAt(target);
  }
  function fitCamera(){
    if(!framed)return;      // a rail drag freezes the shot until the gesture ends
    const el=canvas.getBoundingClientRect();
    const w=Math.max(1,el.width),h=Math.max(1,el.height);
    // Frame the three slides themselves, never closer than a comfortable working span of the
    // rail, so the camera keeps the whole experiment in view however the slides are moved.
    const edgeLo=[wx(state.objP)-7,wx(state.lensP)-7,wx(state.scrP)-9];
    const edgeHi=[wx(state.objP)+7,wx(state.lensP)+7,wx(state.scrP)+9];
    // A virtual image forms on the object side and can sit far outside the slides, so its
    // centre is framed too - otherwise it would be pushed off the edge of the view.
    if(ghostObject.visible){const gx=ghostObject.position.x;edgeLo.push(gx-8);edgeHi.push(gx+8);}
    const left=Math.min(...edgeLo),right=Math.max(...edgeHi),cx=(left+right)/2;
    const half=Math.max((right-left)/2,32);
    target.x=cx;target.y=11.5;
    camera.aspect=w/h;
    camera.updateProjectionMatrix();
    const samples=[];
    for(const x of [cx-half,cx+half])for(const y of [-5,25])for(const z of [-12,12])samples.push(V(x,y,z));
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
  function render(){
    // Where the eye sits decides whether the image is in view, and a visible image in turn
    // widens the shot, so the framing is settled first and the decision is then taken with that
    // very camera. The second pass only moves the camera by the amount the ghost adds to the
    // envelope, which the sticky thresholds in imageSeenFromCamera absorb without flicker.
    fitCamera();
    updateGhost();
    fitCamera();
    renderer.render(scene,camera);
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
    state.objP  = clamp(roundHalf(state.objP), RAIL.obj[0], state.lensP - MIN_GAP);
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
    sliders.candle.position.x=wx(state.objP);
    sliders.lens.position.x=wx(state.lensP);
    sliders.screen.position.x=wx(state.scrP);
    screen.visible=!state.screenRemoved;
    screenGhost.visible=state.screenRemoved;
    screenGhost.position.x=wx(state.scrP);
    labels.position.x=wx(state.objP);
    lensLabel.visible=screenLabel.visible=candleLabel.visible=state.labels;
    refreshMarks();refreshSources();refreshRays();redrawScreen();
    const candleMode=state.source==='candle';
    for(const [id,value] of [['focalLength',state.f],['sourceHeight',state.sourceY],['secondHeight',state.secondY]])$(id).value=value;
    $('focalValue').textContent=format(state.f);
    $('sourceValue').textContent=format(state.sourceY);
    $('secondValue').textContent=format(state.secondY);
    $('secondSource').checked=state.second;
    $('secondSourceControls').hidden=!state.second;
    // The F is a fixed silhouette, so the sampling-point controls belong to the candle only.
    for(const id of ['sourceHeight','secondSource','secondHeight'])$(id).disabled=!candleMode;
    $('sourcePanel').classList.toggle('muted',!candleMode);
    $('fSourceHint').hidden=candleMode;
    // Bench readout pinned beside the scene: the engraved scale is hard to read at an angle.
    $('roObj').textContent=format(state.objP);
    $('roLens').textContent=format(state.lensP);
    $('roScr').textContent=state.screenRemoved?'已撤去':format(state.scrP);
    $('roU').textContent=format(state.u);
    $('roV').textContent=info.kind==='focus'?'∞（不成像）':(info.v<0?'−':'')+Math.abs(info.v).toFixed(1)+' cm';
    $('roV').className=info.crisp?'hi ok':'hi';
    const f=state.f;
    $('roNote').textContent=`刻度 0 在导轨左端 · 透镜在 ${format(state.lensP)}，`
      +`F 在 ${format(state.lensP-f)} / ${format(state.lensP+f)}，`
      +`2F 在 ${format(state.lensP-2*f)} / ${format(state.lensP+2*f)}`;
    $('metricU').textContent=format(state.u);
    $('metricScreen').textContent=state.screenRemoved?'光屏已撤去':format(state.sd);
    $('metricV').textContent=info.kind==='focus'?'∞（不成像）':(info.v<0?'−':'')+Math.abs(info.v).toFixed(1)+' cm';
    $('metricState').textContent=info.kind==='focus'?'无有限像':info.kind==='near'?'正立虚像'
      :state.screenRemoved?'空中的实像':info.crisp?'清晰实像':'实像未合焦';
    $('metricState').className=info.crisp?'good':info.kind==='near'||info.kind==='focus'?'warn':'';
    // 第五格：把这个透镜当眼镜镜片用的度数（接第 4 节「眼睛和眼镜」）。焦距越短度数越大。
    $('metricDiopter').textContent=diopterOf(state.f).toFixed(0)+' 度';
    // 光路模式按钮：只在「显示光路」打开时可用 —— 否则点了没反应，会让人以为坏了。
    const special=state.rayMode==='special';
    for(const b of $('rayMode').querySelectorAll('button[data-mode]')){
      b.classList.toggle('active',b.dataset.mode===state.rayMode);
      b.disabled=!state.rays;
    }
    $('rayLegend').textContent=special
      ?'三条特殊光线：平行主轴 → 过 F′ ｜ 过光心 → 不偏折 ｜ 过物方焦点 → 出射平行主轴'
      :'金色 / 蓝色：一号 / 二号发光点的光路';
    $('autoFocus').disabled=!info.real||info.v>75;
    const blocked=info.real&&!state.screenRemoved&&!info.crisp;
    $('recordBtn').disabled=blocked;
    $('recordBtn2').disabled=blocked;
    $('recordHint').textContent=blocked
      ?'请先移动光屏找到清晰像再记录':'现在可以记录本组观察';
    const toggle=state.screenRemoved?'放回光屏':'撤去光屏';
    $('screenToggle').textContent=toggle;
    $('screenToggle2').textContent=toggle;
    $('observerBtn').classList.toggle('active',state.observing);
    $('stage').classList.toggle('observer-mode',state.screenRemoved);
    // A virtual image sits on the object side, so it can only be reached by looking back
    // through the lens. Say so rather than leaving an empty stage unexplained.
    $('observeBanner').textContent=state.imageOnObjectSide&&!state.imageVisible
      ?'虚像在透镜左侧，只有从光屏一侧透过透镜才看得到 · 可点「透过透镜观察」'
      : info.real
        ?'撤去光屏 · 从光屏这一侧透过透镜，看到悬在空中的倒立实像'
        :'撤去光屏 · 从光屏这一侧透过透镜，看到正立、放大的虚像';
    $('stage').classList.toggle('show-ghost',state.imageVisible);
    $('ghostBadge').textContent=info.real?'实像（倒立，悬在空中）':'虚像（正立、放大）';
    $('observeHint').textContent=info.needsScreenOff
      ?'u ≤ f：光屏上接不到像，光屏已自动撤去。虚像在透镜左侧，必须绕到光屏一侧透过透镜才看得到 —— 站在物体这一侧什么都看不到，可以转动视角亲自验证。'
      :'u > f：移动光屏接收实像，直到屏上的像最清晰；也可以点击 3D 画面里的光屏把它撤去，再绕到光屏一侧看像是否仍悬在空中。';
    let text;
    if(info.kind==='focus')text='u = f：折射后的光线同向平行射出，在有限位置不能获得清晰像；屏上和眼中都只有一片模糊。';
    else if(info.kind==='near')text=`u = ${state.u.toFixed(1)} cm < f：实际光线在屏侧发散，反向延长后在光源同侧得到正立、放大的虚像（放大 ${(Math.abs(info.v)/state.u).toFixed(2)} 倍）。光屏接不到虚像。`;
    else if(info.v>75)text=`实像位于透镜右侧 ${info.v.toFixed(1)} cm 处，已超出光屏滑动范围；把光源移远一点再试。`;
    else if(state.screenRemoved)text=`撤去光屏后，${preset.result}仍然悬在透镜右侧 ${info.v.toFixed(1)} cm 处；从光屏一侧透过透镜就能看到它。`;
    else if(info.crisp)text=`${preset.result}；光屏在 ${state.scrP.toFixed(1)} cm 刻度上得到最清晰的像。`;
    else text=`光屏距离清晰像面 ${Math.abs(info.v-state.sd).toFixed(1)} cm。观察屏上模糊的轮廓，缓慢滑动光屏。`;
    $('finding').innerHTML='<b>当前观察</b><br>'+text;
    document.querySelectorAll('#presets button').forEach(b=>b.classList.toggle('active',b.dataset.case===info.kind));
    document.querySelectorAll('#sourceKind button').forEach(b=>b.classList.toggle('active',b.dataset.kind===state.source));
    document.querySelectorAll('#steps button').forEach(b=>b.classList.toggle('active',+b.dataset.step===state.step));
    $('stepDetail').innerHTML=descriptions[state.step];
    render();
  }
  for(const [id,key] of [['focalLength','f'],['sourceHeight','sourceY'],['secondHeight','secondY']])
    $(id).addEventListener('input',e=>{state[key]=+e.target.value;update();});
  $('sourceKind').addEventListener('click',e=>{
    const b=e.target.closest('button[data-kind]');if(!b)return;
    state.source=b.dataset.kind;state.step=Math.max(state.step,2);update();
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
  $('autoFocus').addEventListener('click',()=>{
    const info=status();if(!info.real||info.v>75)return;
    state.scrP=roundHalf(state.lensP+info.v);state.step=3;update();
  });
  // Putting the screen on or taking it off the bench by hand: the automatic move only
  // happens when the optical situation itself changes, never to overrule the user.
  function setScreen(on){
    state.screenRemoved=!on;state.autoScreen=false;
    if(on)state.observing=false;
    update();
  }
  $('screenToggle').addEventListener('click',()=>setScreen(state.screenRemoved));
  $('screenToggle2').addEventListener('click',()=>setScreen(state.screenRemoved));
  // Standing behind where the screen was and looking back through the lens: the only way to
  // see a virtual image, and the clearest way to see a real image that no longer has a screen.
  //
  // The azimuth has to be near-axial. A virtual image sits far behind the lens on the object
  // side, so the sight line only clears the lens aperture while the eye is close to the axis:
  // measured, the image is lost for every u < f at yaw 1.06-1.42 and reliably visible from
  // yaw >= 1.48. Parking the camera at 1.06 (an older value) put the student in a spot where
  // pressing「透过透镜观察」showed nothing at all.
  $('observerBtn').addEventListener('click',()=>{
    if(state.observing){setScreen(true);return;}
    state.observing=true;state.screenRemoved=true;state.autoScreen=false;
    state.yaw=1.50;state.pitch=.12;state.zoom=1.4;update();
  });
  // 记录表导出：拼成可以直接粘进表格软件 / 文档的制表符文本（首行是表头）。
  // 没记录的行照样导出、单元格留空 —— 粘出来仍是一张 5 行的完整表，缺哪几行一眼可见。
  function recordsTable(){
    const head=['物距区域','物距 u / cm','像距 v / cm','像的性质','放大率','光屏能否承接'];
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
    const item=CASES.find(c=>c.id===info.kind);
    const real=info.real,mag=Number.isFinite(info.v)?Math.abs(info.v)/state.u:NaN;
    const size=mag>1.01?'放大':mag<.99?'缩小':'等大';
    state.records[item.id]={
      name:item.name,u:state.u.toFixed(1),
      v:item.id==='focus'?'∞':(info.v<0?'−':'')+Math.abs(info.v).toFixed(1),
      nature:item.id==='focus'?'不成像'
        :(real?'倒立、':'正立、')+size+(real?'的实像':'的虚像'),
      mag:item.id==='focus'?'—':mag.toFixed(2)+'×',
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
    Object.assign(state,{f:10,objP:35,lensP:65,scrP:80,sourceY:12,secondY:8,second:false,
      source:'candle',screenRemoved:false,autoScreen:false,observing:false,lastNeedsOff:false,
      rays:false,virtual:true,labels:false,rayMode:'all',yaw:-.42,pitch:.21,zoom:1.06,step:0,records:{}});
    for(const [id,checked] of [['showRays',false],['showVirtual',true],['showLabels',false]])$(id).checked=checked;
    renderRecords();
    update();
  });
  $('steps').addEventListener('click',e=>{const b=e.target.closest('[data-step]');if(!b)return;state.step=+b.dataset.step;update();});
  const VIEWS={side:[0,.10],front:[-1.22,.17],top:[-.54,1.17],reset:[-.42,.21]};
  document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{
    [state.yaw,state.pitch]=VIEWS[b.dataset.view];
    state.zoom=b.dataset.view==='reset'?1.06:1;
    if(b.dataset.view==='reset')state.observing=false;
    update();
  }));
  const pointers=new Map();let pinch=0,dragPoint=null,dragRail=null,railGrab=0,press=null;
  function hitSource(e){
    if(state.source!=='candle')return null;
    const rect=canvas.getBoundingClientRect();
    const active=state.second?[{y:state.sourceY,index:0},{y:state.secondY,index:1}]:[{y:state.sourceY,index:0}];
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
        const x=railXAt(e);
        if(x!==null){
          const key=RAIL_KEY[dragRail],next=roundHalf(x-railGrab-RULER0);
          if(next!==state[key]){state[key]=next;update();}
        }
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
  window.addEventListener('resize',resize);
  if(window.ResizeObserver)new ResizeObserver(resize).observe(canvas);
  window.__lensLab={state,status,project,imageY,wx,setScreen,update,render,resize,
    rayShiftsFor,diopterOf,recordsTable,LENS_AP,
    get lastRayTraces(){return lastRayTraces;},
    debug:()=>{const i=status();return {objP:state.objP,lensP:state.lensP,scrP:state.scrP,u:state.u,sd:state.sd,
      kind:i.kind,v:Number.isFinite(i.v)?i.v:null,crisp:i.crisp,real:i.real,screenRemoved:state.screenRemoved,
      source:state.source,candle:candle.position.x,lens:lens.position.x,screen:screen.position.x,
      sources:lightSources.map(g=>g.position.y),rayCount:rays.children.length,
      rayMode:state.rayMode,diopter:diopterOf(state.f),
      ghost:ghostObject.visible,ghostX:ghostObject.position.x,ghostScale:ghostObject.scale.x,
      imageVisible:state.imageVisible,imageOnObjectSide:state.imageOnObjectSide,
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
  window.__lensLab.fSource={group:fSource,strokes:F_STROKES,points:F_POINTS};
  // The scene graph itself is exposed for the round-7 checks: "the stage must be left completely
  // clear" and "no floating label for the eye" are properties of what is actually in the scene,
  // so the self-check reads the graph rather than re-deriving the geometry.
  window.__lensLab.scene=scene;
  window.__lensLab.screenGhost=screenGhost;
  window.__lensLab.rays=rays;
  $('showRays').checked=state.rays;
  renderRecords();
  update();resize();
})();
