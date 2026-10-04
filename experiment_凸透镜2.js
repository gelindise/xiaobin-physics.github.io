import * as THREE from './assets/optics-three.min.js';

// The apparatus is assembled from dimensioned 3D parts, rather than drawn as a 2D diagram.
// World coordinates are centimetres. The optical axis is (x, 12, 0).
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const canvas = $('sceneCanvas');
  const inset = $('screenPreview');
  const insetCtx = inset.getContext('2d');
  const state = {
    f: 10, u: 30, screen: 15, sourceY: 12, secondY: 8, second: false,
    rays: false, virtual: true, labels: false, yaw: -.54, pitch: .27, zoom: 1.16,
    step: 0, records: {}
  };
  const CASES = [
    { id: 'far', ratio: 3, name: 'u > 2f', result: '倒立、缩小的实像' },
    { id: 'twice', ratio: 2, name: 'u = 2f', result: '倒立、等大的实像' },
    { id: 'between', ratio: 1.5, name: 'f < u < 2f', result: '倒立、放大的实像' },
    { id: 'focus', ratio: 1, name: 'u = f', result: '无有限距离的像' },
    { id: 'near', ratio: .7, name: 'u < f', result: '正立、放大的虚像' }
  ];
  const descriptions = [
    '<strong>认识器材：</strong>铝合金双槽导轨、带锁紧旋钮的滑座、圆环镜架与磨砂白屏均是独立的立体部件。关闭光路开关，绕着装置看它们的形状与连接方式。',
    '<strong>调整三心：</strong>蜡烛焰心（12 cm）、凸透镜光心（12 cm）与光屏中心（12 cm）初始同高。上下移动发光点，可以对照像点朝相反方向移动。',
    '<strong>改变物距：</strong>依次选 u > 2f、u = 2f、f < u < 2f、u = f 与 u < f；打开光路，比较真实折射光线的会聚状态。',
    '<strong>移动光屏：</strong>在 u > f 时缓慢移动光屏，观察散焦到清晰；只有实像才能被光屏接住。也可以添加第二个发光点，同时比较两个像点。',
    '<strong>记录归纳：</strong>记录各物距区域的数据。比较光屏中的像、两个发光点的相对位置，以及焦距与二倍焦距两处分界。'
  ];
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const roundHalf = x => Math.round(x * 2) / 2;
  const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);
  const status = () => {
    const { f, u } = state;
    const kind = u > 2*f ? 'far' : u === 2*f ? 'twice' : u > f ? 'between' : u === f ? 'focus' : 'near';
    const v = u === f ? Infinity : f*u/(u-f);
    return { kind, v, real: u > f, crisp: u > f && v <= 75 && Math.abs(v-state.screen) <= .75 };
  };

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
  renderer.toneMappingExposure = 1.18;
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
  const warm = new THREE.PointLight('#fbb979', 19, 33, 1.5);
  warm.position.set(-state.u, 12.5, 1); scene.add(warm);

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
  const paper = material('#e9e7d9', .03, .88, { side: THREE.DoubleSide });
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
  for(let x=-60;x<=80;x+=10)rulerLabel(String(Math.abs(x)),x);
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
    const stem = cylinder(group,.38,kind==='candle'?3.65:kind==='lens'?4.1:3.45,[0,kind==='candle'?5:kind==='lens'?5.25:4.9,0],brightAlu);
    const col = cylinder(group,.62,.40,[0,3.31,0],metalDark);
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
  waxGrad.addColorStop(0,'#a6a38d');waxGrad.addColorStop(.20,'#faf4df');waxGrad.addColorStop(.56,'#eee8d4');waxGrad.addColorStop(1,'#aba696');
  waxg.fillStyle=waxGrad;waxg.fillRect(0,0,256,256);
  for(let i=0;i<15;i++){
    waxg.strokeStyle=i%2?'#ffffff17':'#857e6b12';waxg.lineWidth=i%3+1;
    waxg.beginPath();waxg.moveTo(i*19,0);waxg.lineTo(i*19+5,256);waxg.stroke();
  }
  const waxMap=new THREE.CanvasTexture(waxTexCanvas);waxMap.colorSpace=THREE.SRGBColorSpace;
  const wax=material('#ffffff',.01,.70,{map:waxMap});
  cylinder(candle,1.35,.42,[0,6.2,0],brass,40);
  cylinder(candle,.93,5.35,[0,9.09,0],wax,40);
  cylinder(candle,.9,.16,[0,11.84,0],cream,40);
  for(let i=0;i<7;i++){
    const a=i*2*Math.PI/7;
    cylinder(candle,.07,.48+(i%3)*.2,[.87*Math.sin(a),11.45-(i%3)*.12,.87*Math.cos(a)],cream,8);
  }
  cylinder(candle,.065,.72,[0,12.25,0],blackRubber,10);
  const flameOuter=mesh(new THREE.SphereGeometry(1,20,16),new THREE.MeshBasicMaterial({color:'#e58645',transparent:true,opacity:.50,depthWrite:false}),candle,0,13.04,0,false);
  flameOuter.scale.set(.37,.82,.36);
  const flameCore=mesh(new THREE.SphereGeometry(1,16,12),new THREE.MeshBasicMaterial({color:'#ffdb87',transparent:true,opacity:.86,depthWrite:false}),candle,0,12.93,0,false);
  flameCore.scale.set(.17,.52,.18);
  const dish=cylinder(candle,1.52,.16,[0,6.54,0],material('#a79571',.2,.48),40);
  // Adjustable optical-point sampling probe, held by the candle carriage; its
  // fine metal guide makes all slider heights physically attached to the model.
  cylinder(candle,.10,12.2,[0,11.0,1.65],brightAlu,14);
  cylinder(candle,.20,.22,[0,17.17,1.65],brass,14);
  for(const y of [6,9,12,15]){
    const tick=box(candle,[.42,.055,.07],[0,y,1.77],metalDark,false);
    tick.castShadow=false;
  }
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
    color:'#e2efeb',metalness:0,roughness:.08,transmission:.84,thickness:1.2,
    ior:1.5,transparent:true,opacity:.8,side:THREE.DoubleSide,depthWrite:false
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

  // Fixed rectangular white diffusing screen. CanvasTexture is renewed when optics change.
  const texCanvas=document.createElement('canvas');texCanvas.width=768;texCanvas.height=640;
  const texCtx=texCanvas.getContext('2d');
  const screenTexture=new THREE.CanvasTexture(texCanvas);
  screenTexture.colorSpace=THREE.SRGBColorSpace;
  screenTexture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
  const screenMat=new THREE.MeshBasicMaterial({map:screenTexture,side:THREE.DoubleSide, toneMapped:false});
  box(screen,[.28,19.9,17.9],[.22,12,0],brightAlu);
  box(screen,[.25,19.0,17.0],[-.02,12,0],paper);
  const screenFace=mesh(new THREE.PlaneGeometry(16.8,18.8),screenMat,screen,-.17,12,0,false);
  screenFace.rotation.y=-Math.PI/2;
  screenFace.receiveShadow=false;
  const screenBack=mesh(new THREE.PlaneGeometry(16.8,18.8),new THREE.MeshStandardMaterial({color:'#d4d8d3',roughness:.82,side:THREE.DoubleSide}),screen,.39,12,0,false);
  screenBack.rotation.y=Math.PI/2;
  for(const z of [-8.85,8.85])box(screen,[.82,20.5,.42],[.2,12,z],metalDark);
  for(const y of [1.95,22.05])box(screen,[.82,.42,18.1],[.2,y,0],metalDark);
  for(const z of [-8.25,8.25])for(const y of [2.5,21.5]){
    const bolt=mesh(new THREE.CylinderGeometry(.12,.12,.18,12),brass,screen,-.66,y,z);
    bolt.rotation.z=Math.PI/2;
  }
  box(screen,[.35,12.0,.40],[.57,12,0],alu);
  const screenLabel=badge(screen,'毛玻璃光屏',[-.2,25,0],'#4c6070',14);

  const focusMarks=new THREE.Group();scene.add(focusMarks);
  const labels=new THREE.Group();scene.add(labels);
  const candleLabel=badge(labels,'蜡烛 / 光源',[0,19,0],'#806342',14);
  function clear(group){
    for(const child of [...group.children]){
      group.remove(child);
      if(child.isSprite && child.material.map){child.material.map.dispose(); child.material.dispose();}
      else if(child.isLine){child.geometry.dispose();child.material.dispose();}
      else if(child.isMesh && group===ghostLabels){child.geometry.dispose();child.material.dispose();}
    }
  }
  function refreshMarks(){
    clear(focusMarks);
    if(!state.labels)return;
    for(const m of [-2,-1,1,2]){
      const x=m*state.f;
      const dot=mesh(new THREE.SphereGeometry(.20,12,8),m%2?brass:bronze,focusMarks,x,2.1,3.7,false);
      dot.castShadow=false;
      badge(focusMarks,Math.abs(m)===2?'2F':'F',[x,4.65,4.3],'#63594b',5.4);
    }
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
    const core=mesh(new THREE.SphereGeometry(.25,18,12),which===0?gold:blue,group,0,0,1.12,false);
    const halo=new THREE.Sprite(new THREE.SpriteMaterial({map:glowMap,color,transparent:true,opacity:.75,depthWrite:false,depthTest:false,blending:THREE.AdditiveBlending}));
    halo.position.set(0,0,1.15);halo.scale.set(3.8,3.8,1);halo.renderOrder=17;group.add(halo);
    // A sprung sampling probe clamped alongside the real candle distinguishes it from the wick.
    const mount=cylinder(group,.19,.30,[0,0,1.65],metalDark,16);
    mount.rotation.x=Math.PI/2;
    lightSources.push(group);
  }
  function refreshSources(){
    for(const child of [...sources.children]){
      sources.remove(child);
      child.traverse(m=>{if(m.isMesh)m.geometry.dispose();});
    }
    lightSources.length=0;
    sourceMarker(state.sourceY,'#ffd79a',0);
    if(state.second)sourceMarker(state.secondY,'#b4ddf8',1);
    warm.position.set(-state.u,state.sourceY,1);
  }

  function imageY(sourceY,v){return 12-(sourceY-12)*v/state.u;}
  const rays=new THREE.Group();scene.add(rays);
  function refreshRays(){
    clear(rays);clear(ghostLabels);
    if(!state.rays)return;
    const info=status();
    const sampleYs=[-3.7,0,3.7];
    const active=state.second?[{y:state.sourceY,c:'#be843e'},{y:state.secondY,c:'#326a97'}]:[{y:state.sourceY,c:'#be843e'}];
    for(const src of active){
      for(const shift of sampleYs){
        const lensY=12+shift, slope=(lensY-src.y)/state.u-shift/state.f;
        const hit=V(0,lensY,0),start=V(-state.u,src.y,0),end=V(state.screen,lensY+slope*state.screen,0);
        lineSegment(rays,start,hit,src.c,.80);
        lineSegment(rays,hit,end,src.c,.87);
        if(info.kind==='near' && state.virtual && info.v>=-63)
          lineSegment(rays,hit,V(info.v,lensY+slope*info.v,0),src.c,.55,true);
      }
      if(info.kind==='near' && state.virtual && info.v>=-63){
        const ghost=mesh(new THREE.SphereGeometry(.30,16,12),src.c==='#326a97'?blue:gold,ghostLabels,info.v,imageY(src.y,info.v),0,false);
        ghost.material = ghost.material.clone();ghost.material.transparent=true;ghost.material.opacity=.55;
      }
    }
  }
  const format = y => `${y.toFixed(1)} cm`;
  // A paper texture with restrained photographic grain; the image and both sample points
  // share the same thin-lens equation, including sign inversion for a real image.
  function redrawScreen(){
    const c=texCtx,w=texCanvas.width,h=texCanvas.height;
    c.clearRect(0,0,w,h);
    const paperGrad=c.createLinearGradient(0,0,w,h);
    paperGrad.addColorStop(0,'#e1e3db');paperGrad.addColorStop(.52,'#fcfaf0');paperGrad.addColorStop(1,'#cbcfc8');
    c.fillStyle=paperGrad;c.fillRect(0,0,w,h);
    // Seeded deterministic paper grain (no motion or flicker while dragging the camera).
    let seed=87591;
    for(let i=0;i<720;i++){
      seed=(seed*1664525+1013904223)>>>0;const x=seed%w;
      seed=(seed*1664525+1013904223)>>>0;const y=seed%h;
      c.fillStyle=i%4?'#60707908':'#ffffff17';c.fillRect(x,y,1,1);
    }
    const info=status();
    const py=y=>h/2-(y-12)*h/18.8;
    if(info.real && info.v<=250){
      const magnification=state.screen/state.u;
      const offset=Math.abs(state.screen-info.v);
      const aperture=5.6;
      const confusion=info.v>0?2*aperture*offset/info.v:999;
      const sigma=clamp(confusion*h/18.8/3,0,38);
      c.save();c.beginPath();c.rect(8,8,w-16,h-16);c.clip();
      c.globalAlpha=clamp(1-offset/90,.35,1);
      c.filter=sigma<.6?'none':`blur(${sigma.toFixed(1)}px)`;
      const x=w/2;
      const waxTop=py(12),waxEnd=py(12-(6.5-12)*magnification);
      const bodyTop=Math.min(waxTop,waxEnd)+7,bodyHeight=Math.max(5,Math.abs(waxTop-waxEnd)-12);
      c.fillStyle='#ad7751';c.shadowColor='#8c5f38';c.shadowBlur=5;
      c.beginPath();c.roundRect(x-clamp(17*magnification,5,30),bodyTop,clamp(34*magnification,10,60),bodyHeight,3);c.fill();
      c.fillStyle='#e9b47a';c.fillRect(x-clamp(12*magnification,3,23),bodyTop+4,clamp(18*magnification,6,40),Math.max(3,bodyHeight-8));
      c.shadowBlur=18;c.shadowColor='#e6ac5a';c.fillStyle='#f6cc8b';
      c.beginPath();c.ellipse(x,py(12),clamp(6*magnification,3,11),clamp(11*magnification,4,17),0,0,Math.PI*2);c.fill();
      function spot(y,color){
        const sy=py(12-(y-12)*magnification);
        c.shadowColor=color;c.shadowBlur=13;c.fillStyle=color;
        c.beginPath();c.arc(x,sy,7.5,0,Math.PI*2);c.fill();
        c.fillStyle='#fff';c.beginPath();c.arc(x,sy,2.5,0,Math.PI*2);c.fill();
      }
      spot(state.sourceY,'#eaa549');
      if(state.second)spot(state.secondY,'#5e98bd');
      c.restore();
    }
    c.strokeStyle='#a7a9a154';c.lineWidth=1.5;c.strokeRect(5,5,w-10,h-10);
    screenTexture.needsUpdate=true;
    insetCtx.clearRect(0,0,inset.width,inset.height);
    insetCtx.fillStyle='#e8e6dc';insetCtx.fillRect(0,0,inset.width,inset.height);
    const cropH=clamp(360*state.screen/state.u,210,555);
    const cropW=cropH*texCanvas.width/texCanvas.height;
    insetCtx.drawImage(texCanvas,(w-cropW)/2,(h-cropH)/2,cropW,cropH,0,0,inset.width,inset.height);
    $('previewText').textContent = !info.real ? '光屏接不到像 · 请从透镜另一侧观察虚像' :
      info.v>75 ? '理论像超出光屏滑动范围' : info.crisp ? '屏上得到清晰的倒立实像' :
      `离焦 ${Math.abs(info.v-state.screen).toFixed(1)} cm · 移动光屏寻找像`;
  }

  function cameraPosition(){
    const radius=190/state.zoom;
    camera.position.set(target.x+radius*Math.sin(state.yaw)*Math.cos(state.pitch),
      target.y+radius*Math.sin(state.pitch),radius*Math.cos(state.yaw)*Math.cos(state.pitch));
    camera.lookAt(target);
  }
  function fitCamera(){
    const el=canvas.getBoundingClientRect();
    const w=Math.max(1,el.width),h=Math.max(1,el.height);
    target.x=w<500?-5:6;
    camera.aspect=w/h;
    camera.updateProjectionMatrix();
    // Fixed apparatus envelope including 22cm high screen and long metal rail.
    const samples=[];
    for(const x of [-67,85])for(const y of [-5,25])for(const z of [-12,12])samples.push(V(x,y,z));
    let lo=85,hi=500;
    for(let k=0;k<24;k++){
      const r=(lo+hi)/2;
      camera.position.set(target.x+r*Math.sin(state.yaw)*Math.cos(state.pitch),target.y+r*Math.sin(state.pitch),r*Math.cos(state.yaw)*Math.cos(state.pitch));
      camera.lookAt(target);camera.updateMatrixWorld();
      const max=samples.reduce((m,p)=>{
        const q=p.clone().project(camera);
        return Math.max(m,Math.abs(q.x)/.90,Math.abs(q.y)/.75);
      },0);
      if(max>1)lo=r;else hi=r;
    }
    camera.position.set(target.x+hi*Math.sin(state.yaw)*Math.cos(state.pitch),target.y+hi*Math.sin(state.pitch),hi*Math.cos(state.yaw)*Math.cos(state.pitch));
    camera.lookAt(target);
    // Narrow screens intentionally frame the working apparatus closer, leaving
    // some unused rail out of view instead of reducing the lens to a few pixels.
    const base=hi/(state.zoom*(w<500?1.77:1));
    camera.position.sub(target).multiplyScalar(base/hi).add(target);
    camera.updateMatrixWorld();
  }
  function render(){
    fitCamera();renderer.render(scene,camera);
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
  function update(){
    const info=status(),preset=CASES.find(x=>x.id===info.kind);
    sliders.candle.position.x=-state.u;sliders.screen.position.x=state.screen;
    warm.position.x=-state.u;
    labels.position.x=-state.u;
    lensLabel.visible=screenLabel.visible=candleLabel.visible=state.labels;
    // Device labels follow their own sliders; focus marks follow the focal length.
    refreshMarks();refreshSources();refreshRays();redrawScreen();
    for(const [id,value] of [['focalLength',state.f],['objectDistance',state.u],['screenDistance',state.screen],['sourceHeight',state.sourceY],['secondHeight',state.secondY]])$(id).value=value;
    $('focalValue').textContent=format(state.f);
    $('objectValue').textContent=format(state.u);
    $('screenValue').textContent=format(state.screen);
    $('sourceValue').textContent=format(state.sourceY);
    $('secondValue').textContent=format(state.secondY);
    $('secondSource').checked=state.second;
    $('secondSourceControls').hidden=!state.second;
    $('metricU').textContent=format(state.u);
    $('metricV').textContent=info.kind==='focus'?'∞（无穷远）':(info.v<0?'−':'')+Math.abs(info.v).toFixed(1)+' cm';
    $('metricScreen').textContent=format(state.screen);
    $('metricState').textContent=info.kind==='focus'?'无有限像':info.kind==='near'?'正立虚像':info.crisp?'清晰实像':'实像未合焦';
    $('metricState').className=info.crisp?'good':info.kind==='near'||info.kind==='focus'?'warn':'';
    $('autoFocus').disabled=!info.real||info.v>75;
    $('recordBtn').disabled=info.real&&!info.crisp;
    $('recordHint').textContent=info.real&&!info.crisp?'请先移动光屏找到清晰像再记录':'现在可以记录本组观察';
    let text;
    if(info.kind==='focus')text='u = f：折射后的光线同向传播；在有限位置不能获得清晰像。';
    else if(info.kind==='near')text='u < f：实际光线在屏侧发散；向后反向延长，在蜡烛同侧形成正立虚像。光屏无法接收。';
    else if(info.v>75)text=`实像位于 ${info.v.toFixed(1)} cm 处，已超出光屏滑动范围；把蜡烛移远再试。`;
    else if(info.crisp)text=`${preset.result}；屏上 ${state.second?'两个发光点分别成像':'发光点成像'}，上下移动蜡烛上的取样点，屏上的像点沿反方向移动。`;
    else text=`光屏距离清晰像面 ${Math.abs(info.v-state.screen).toFixed(1)} cm。观察屏上模糊的轮廓，缓慢滑动光屏。`;
    $('finding').innerHTML='<b>当前观察</b><br>'+text;
    document.querySelectorAll('#presets button').forEach(b=>b.classList.toggle('active',b.dataset.case===info.kind));
    document.querySelectorAll('#steps button').forEach(b=>b.classList.toggle('active',+b.dataset.step===state.step));
    $('stepDetail').innerHTML=descriptions[state.step];
    render();
  }
  for(const [id,key] of [['focalLength','f'],['objectDistance','u'],['screenDistance','screen'],['sourceHeight','sourceY'],['secondHeight','secondY']])
    $(id).addEventListener('input',e=>{state[key]=+e.target.value;update();});
  $('secondSource').addEventListener('change',e=>{state.second=e.target.checked;update();});
  for(const [id,key] of [['showRays','rays'],['showVirtual','virtual'],['showLabels','labels']])
    $(id).addEventListener('change',e=>{state[key]=e.target.checked;update();});
  $('presets').addEventListener('click',e=>{
    const b=e.target.closest('button[data-case]');if(!b)return;
    state.u=roundHalf(state.f*CASES.find(c=>c.id===b.dataset.case).ratio);
    state.step=2;update();
  });
  $('autoFocus').addEventListener('click',()=>{
    const info=status();if(!info.real||info.v>75)return;
    state.screen=roundHalf(info.v);state.step=3;update();
  });
  $('resetAll').addEventListener('click',()=>{
    Object.assign(state,{f:10,u:30,screen:15,sourceY:12,secondY:8,second:false,rays:false,virtual:true,labels:false,yaw:-.54,pitch:.27,zoom:1.16,step:0});
    for(const [id,checked] of [['showRays',false],['showVirtual',true],['showLabels',false]])$(id).checked=checked;
    update();
  });
  $('steps').addEventListener('click',e=>{const b=e.target.closest('[data-step]');if(!b)return;state.step=+b.dataset.step;update();});
  $('recordBtn').addEventListener('click',()=>{
    const info=status();if(info.real&&!info.crisp)return;
    const item=CASES.find(c=>c.id===info.kind);
    state.records[item.id]={name:item.name,u:state.u.toFixed(1),v:item.id==='focus'?'∞':(info.v<0?'−':'')+Math.abs(info.v).toFixed(1),result:item.result};
    $('records').innerHTML=CASES.filter(c=>state.records[c.id]).map(c=>{
      const r=state.records[c.id];return `<tr><td>${r.name}</td><td>${r.u}</td><td>${r.v}</td><td>${r.result}</td></tr>`;
    }).join('');
    const count=Object.keys(state.records).length;
    $('summary').textContent=count===5?'五类物距已全部观察：物体从焦点外移向焦点，实像渐远且变大；进入焦点以内，形成正立虚像。':`已记录 ${count}/5 类，继续更换物距并调焦。`;
    state.step=4;update();
  });
  document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{
    const views={side:[0,.10],front:[-1.22,.17],top:[-.54,1.17],reset:[-.54,.27]};
    [state.yaw,state.pitch]=views[b.dataset.view];state.zoom=b.dataset.view==='reset'?1.16:1;render();
  }));
  const pointers=new Map();let pinch=0,dragPoint=null;
  function hitSource(e){
    const rect=canvas.getBoundingClientRect();
    const active=state.second?[{y:state.sourceY,index:0},{y:state.secondY,index:1}]:[{y:state.sourceY,index:0}];
    for(const s of active){
      const q=project({x:-state.u,y:s.y,z:1.15});
      if(Math.hypot(q.x-(e.clientX-rect.left),q.y-(e.clientY-rect.top))<17)return s.index;
    }
    return null;
  }
  canvas.addEventListener('pointerdown',e=>{
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});canvas.setPointerCapture(e.pointerId);
    dragPoint=pointers.size===1?hitSource(e):null;pinch=0;
  });
  canvas.addEventListener('pointermove',e=>{
    if(!pointers.has(e.pointerId)){
      canvas.classList.toggle('pick-source',hitSource(e)!==null);return;
    }
    const prev=pointers.get(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pointers.size===1){
      if(dragPoint!==null){
        const key=dragPoint===0?'sourceY':'secondY',y=state[key];
        const p1=project({x:-state.u,y,z:1.15}),p2=project({x:-state.u,y:y+1,z:1.15});
        const px=p1.y-p2.y;
        if(Math.abs(px)>1){const next=clamp(roundHalf(y+(prev.y-e.clientY)/px),5,17);if(next!==y){state[key]=next;update();}}
      }else{
        state.yaw+=(e.clientX-prev.x)*.006;
        state.pitch=clamp(state.pitch+(prev.y-e.clientY)*.005,-1.0,1.28);
        render();
      }
    }else if(pointers.size===2){
      dragPoint=null;const [a,b]=[...pointers.values()],d=Math.hypot(a.x-b.x,a.y-b.y);
      if(pinch)state.zoom=clamp(state.zoom*d/pinch,.68,2.35);
      pinch=d;render();
    }
  });
  const release=e=>{pointers.delete(e.pointerId);dragPoint=null;pinch=0;};
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
  window.__lensLab={state,status,project,imageY,update,render,resize,
    debug:()=>({candle:candle.position.x,lens:lens.position.x,screen:screen.position.x,sources:lightSources.map(g=>g.position.y),rayCount:rays.children.length,textureSize:[texCanvas.width,texCanvas.height]})};
  $('showRays').checked=state.rays;
  update();resize();
})();
