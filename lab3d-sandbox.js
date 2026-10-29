/*!
 * lab3d-sandbox.js —— 「电学沙盒 3D」应用层
 * ============================================================
 * 这一层只做三件事：① 搭出实验室（房间 + 实验桌）；② 把器材库里的器材放到桌上、
 * 拖动、选中、删除；③ 把参数面板 / 读数 / 标签 / 全屏接到这些状态上。
 * 器材本身的建模全在 `lab3d-kit.js` —— 以后加新器材不用改这个文件。
 *
 * 坐标：1 世界单位 = 1 mm。桌面【上表面】= y 0；桌子总高 740；地面 y = −740。
 * 器材 group 的局部原点就在底面中心 ⇒ 页面只改 position.x / z，y 恒为 0。
 */
import * as THREE from './assets/optics-three.min.js';
// 🔴 import 必须带版本号：不带的话这个子模块【没有缓存键】，改了 kit 页面看上去没变。
import { CATALOG, buildRheostat, buildSwitch, DIM } from './lab3d-kit.js?build=2';

const $ = (id) => document.getElementById(id);

// ============================================================
//  场景常量
// ============================================================
const TABLE_W = 1000, TABLE_D = 560, TABLE_T = 34;   // 桌面（mm）
const TABLE_H = 740;                                  // 桌面离地高度
const FLOOR_Y = -TABLE_H;
const PLACE = { x: TABLE_W / 2 - 110, z: TABLE_D / 2 - 80 };   // 器材中心可移动范围

// ============================================================
//  渲染器 / 场景 / 相机
// ============================================================
const stageEl = $('stage');
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
// 实验室是「白墙 + 两排灯管」，线性渲染会直接顶到 255（实测画面 99.96% 的像素亮度 >40）。
// 用 ACES 把高光压下来，墙面才有层次。
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1220);
scene.fog = new THREE.Fog(0x0b1220, 3200, 6200);

const camera = new THREE.PerspectiveCamera(40, 1.6, 1, 12000);

// 环境反射：金属件（滑杆 / 滚花柱 / 绕线）没有环境贴图会发黑
(function buildEnv() {
  try {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 128;
    const g = cv.getContext('2d');
    const lg = g.createLinearGradient(0, 0, 0, 128);
    lg.addColorStop(0.00, '#9db2cc');
    lg.addColorStop(0.40, '#33445c');
    lg.addColorStop(0.56, '#121b28');
    lg.addColorStop(1.00, '#070c14');
    g.fillStyle = lg; g.fillRect(0, 0, 256, 128);
    g.fillStyle = 'rgba(255,255,255,.6)';
    g.beginPath(); g.ellipse(64, 28, 40, 15, 0, 0, Math.PI * 2); g.fill();
    const tex = new THREE.CanvasTexture(cv);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    scene.environment = tex;
  } catch (e) { /* 只是观感 */ }
})();

// ============================================================
//  实验室：地面 / 墙 / 柜子 / 窗 / 灯
// ============================================================
function tileTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = '#aeb7c1'; g.fillRect(0, 0, 256, 256);
  // 4×4 块瓷砖 + 缝隙
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const v = 168 + ((i * 7 + j * 13) % 5) * 5;
      g.fillStyle = 'rgb(' + v + ',' + (v + 4) + ',' + (v + 8) + ')';
      g.fillRect(i * 64 + 1.5, j * 64 + 1.5, 61, 61);
    }
  }
  g.strokeStyle = 'rgba(120,132,146,.55)';
  g.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, 256); g.stroke();
    g.beginPath(); g.moveTo(0, i * 64); g.lineTo(256, i * 64); g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10, 8);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const matFloor = new THREE.MeshStandardMaterial({ map: tileTexture(), roughness: 0.55, metalness: 0.08 });
const matWall = new THREE.MeshStandardMaterial({ color: 0xc6d2df, roughness: 0.92, metalness: 0.02 });
const matWallDark = new THREE.MeshStandardMaterial({ color: 0xa8b6c6, roughness: 0.9, metalness: 0.02 });
const matCabinet = new THREE.MeshStandardMaterial({ color: 0xb9c6d3, roughness: 0.72, metalness: 0.12 });
const matCabinetDark = new THREE.MeshStandardMaterial({ color: 0x8b9aa9, roughness: 0.7, metalness: 0.16 });
const matGlass = new THREE.MeshPhysicalMaterial({
  color: 0xd7ecf7, roughness: 0.06, metalness: 0.0, transparent: true, opacity: 0.22,
  side: THREE.DoubleSide, depthWrite: false,
});
const matWood = new THREE.MeshStandardMaterial({ color: 0x9a7452, roughness: 0.62, metalness: 0.06 });
const matTop = new THREE.MeshStandardMaterial({ color: 0x3f4b54, roughness: 0.78, metalness: 0.06 });
const matLeg = new THREE.MeshStandardMaterial({ color: 0x7c8895, roughness: 0.42, metalness: 0.62 });
const matLamp = new THREE.MeshBasicMaterial({ color: 0xfff6e2 });

(function buildRoom() {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(5200, 4200), matFloor);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y;
  scene.add(floor);

  // 后墙 / 左墙（L 形），踢脚线单独一条
  const back = new THREE.Mesh(new THREE.BoxGeometry(5200, 2600, 60), matWall);
  back.position.set(0, FLOOR_Y + 1300, -1600);
  scene.add(back);
  const left = new THREE.Mesh(new THREE.BoxGeometry(60, 2600, 3200), matWall);
  left.position.set(-2600, FLOOR_Y + 1300, 0);
  scene.add(left);
  const skirtB = new THREE.Mesh(new THREE.BoxGeometry(5200, 90, 12), matWallDark);
  skirtB.position.set(0, FLOOR_Y + 45, -1565);
  scene.add(skirtB);
  const skirtL = new THREE.Mesh(new THREE.BoxGeometry(12, 90, 3200), matWallDark);
  skirtL.position.set(-2565, FLOOR_Y + 45, 0);
  scene.add(skirtL);

  // 实验柜（后墙右侧）：柜体 + 两层玻璃门 + 拉手
  const cab = new THREE.Group();
  cab.position.set(1360, FLOOR_Y, -1440);
  const body = new THREE.Mesh(new THREE.BoxGeometry(720, 1500, 400), matCabinet);
  body.position.y = 750;
  cab.add(body);
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(780, 70, 440), matCabinetDark);
  plinth.position.y = 35;
  cab.add(plinth);
  const top = new THREE.Mesh(new THREE.BoxGeometry(750, 38, 430), matCabinetDark);
  top.position.y = 1518;
  cab.add(top);
  // 玻璃门（两扇）
  [-1, 1].forEach((s) => {
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(320, 620), matGlass);
    pane.position.set(s * 172, 1040, 204);
    cab.add(pane);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(330, 640, 16), matCabinetDark);
    frame.position.set(s * 172, 1040, 196);
    cab.add(frame);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 110, 12), matLeg);
    handle.position.set(s * 24, 1040, 216);
    cab.add(handle);
  });
  // 下层抽屉
  const drawer = new THREE.Mesh(new THREE.BoxGeometry(700, 340, 28), matCabinetDark);
  drawer.position.set(0, 560, 200);
  cab.add(drawer);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(14, 16, 12), matLeg);
  knob.position.set(0, 560, 220);
  cab.add(knob);
  scene.add(cab);

  // 窗户（后墙左侧）：窗框 + 发光的「户外」
  const win = new THREE.Group();
  win.position.set(-780, FLOOR_Y, -1566);
  // 户外天光：上蓝下白的一段渐变，比纯色更像「窗外的天」
  const skyCv = document.createElement('canvas');
  skyCv.width = 8; skyCv.height = 128;
  const sg = skyCv.getContext('2d');
  const lg2 = sg.createLinearGradient(0, 0, 0, 128);
  lg2.addColorStop(0, '#8fc4ec');
  lg2.addColorStop(0.55, '#cfe6f6');
  lg2.addColorStop(1, '#eef6fb');
  sg.fillStyle = lg2; sg.fillRect(0, 0, 8, 128);
  const skyTex = new THREE.CanvasTexture(skyCv);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(720, 820),
    new THREE.MeshBasicMaterial({ map: skyTex }));
  glass.position.y = 1180;
  win.add(glass);
  const wf = new THREE.MeshStandardMaterial({ color: 0x7d8b9a, roughness: 0.5, metalness: 0.3 });
  [[0, 780, 740, 26], [0, 1580, 740, 26], [-370, 1180, 26, 820], [370, 1180, 26, 820], [0, 1180, 24, 820]]
    .forEach(([x, y, w, h]) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 22), wf);
      m.position.set(x, y, 6);
      win.add(m);
    });
  const sill = new THREE.Mesh(new THREE.BoxGeometry(800, 30, 90), matWallDark);
  sill.position.set(0, 762, 40);
  win.add(sill);
  scene.add(win);

  // 左墙的「实验守则」牌（一块深框 + 浅面板 + 几条文字线）
  const board = new THREE.Group();
  board.position.set(-2560, 700, 260);
  const bFrame = new THREE.Mesh(new THREE.BoxGeometry(10, 660, 940), matCabinetDark);
  board.add(bFrame);
  const bFace = new THREE.Mesh(new THREE.BoxGeometry(6, 620, 900),
    new THREE.MeshStandardMaterial({ color: 0xeef3f8, roughness: 0.86 }));
  bFace.position.x = 4;
  board.add(bFace);
  const lineMat = new THREE.MeshStandardMaterial({ color: 0x93a3b4, roughness: 0.9 });
  for (let i = 0; i < 5; i++) {
    const ln = new THREE.Mesh(new THREE.BoxGeometry(3, 14, 620 - i * 40), lineMat);
    ln.position.set(8, 200 - i * 90, i % 2 ? 60 : 20);
    board.add(ln);
  }
  scene.add(board);

  // 天花板两排灯管
  const lampMat = matLamp;
  [-300, 300].forEach((z) => {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1500, 34, 90), lampMat);
    bar.position.set(0, FLOOR_Y + 2520, z);
    scene.add(bar);
    const shell = new THREE.Mesh(new THREE.BoxGeometry(1560, 46, 130), matWallDark);
    shell.position.set(0, FLOOR_Y + 2552, z);
    scene.add(shell);
    const pl = new THREE.PointLight(0xfff4e0, 0.32, 2600, 2);
    pl.position.set(0, FLOOR_Y + 2450, z);
    scene.add(pl);
  });
})();

// ============================================================
//  实验桌
// ============================================================
const tableGroup = new THREE.Group();
scene.add(tableGroup);
(function buildTable() {
  const top = new THREE.Mesh(new THREE.BoxGeometry(TABLE_W, TABLE_T, TABLE_D), matTop);
  top.position.y = -TABLE_T / 2;
  tableGroup.add(top);
  // 木色包边（一圈，比台面高一点点）
  const rimY = 2;
  [[0, rimY, -TABLE_D / 2 - 4, TABLE_W + 16, 10, 8], [0, rimY, TABLE_D / 2 + 4, TABLE_W + 16, 10, 8],
   [-TABLE_W / 2 - 4, rimY, 0, 8, 10, TABLE_D + 16], [TABLE_W / 2 + 4, rimY, 0, 8, 10, TABLE_D + 16]]
    .forEach(([x, y, z, w, h, d]) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), matWood);
      m.position.set(x, y, z);
      tableGroup.add(m);
    });

  // 四条方管桌腿 + 横梁
  const legH = TABLE_H - TABLE_T;
  [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(52, legH, 52), matLeg);
    leg.position.set(sx * (TABLE_W / 2 - 70), -TABLE_T - legH / 2, sz * (TABLE_D / 2 - 60));
    tableGroup.add(leg);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(64, 12, 64), matCabinetDark);
    foot.position.set(sx * (TABLE_W / 2 - 70), FLOOR_Y + 6, sz * (TABLE_D / 2 - 60));
    tableGroup.add(foot);
  }));
  [-1, 1].forEach((sz) => {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(TABLE_W - 180, 34, 34), matLeg);
    beam.position.set(0, -TABLE_T - legH + 90, sz * (TABLE_D / 2 - 60));
    tableGroup.add(beam);
  });
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(TABLE_W - 220, 16, TABLE_D - 160), matCabinetDark);
  shelf.position.set(0, -TABLE_T - legH + 110, 0);
  tableGroup.add(shelf);
})();

// 灯光
scene.add(new THREE.HemisphereLight(0xeaf3ff, 0x2b3644, 0.72));
const key = new THREE.DirectionalLight(0xffffff, 1.25);
key.position.set(900, 1700, 1100);
scene.add(key);
const fill = new THREE.DirectionalLight(0xbcd8ff, 0.42);
fill.position.set(-1100, 900, 800);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xdce9ff, 0.5);
rim.position.set(200, 700, -1200);
scene.add(rim);

// ============================================================
//  相机（轨道）
// ============================================================
const cam = {
  yaw: -0.34, pitch: 0.28, dist: 1360,
  target: new THREE.Vector3(0, 215, 0),
  yawT: -0.34, pitchT: 0.28, distT: 1360,
  targetT: new THREE.Vector3(0, 215, 0),
};
const VIEWS = {
  persp:   { yaw: -0.34, pitch: 0.28, dist: 1360, target: [0, 215, 0] },
  front:   { yaw: 0, pitch: 0.14, dist: 1240, target: [0, 230, 0] },
  top:     { yaw: 0, pitch: 1.02, dist: 1240, target: [0, 60, 0] },
  closeup: { yaw: -0.26, pitch: 0.24, dist: 940, target: [0, 130, 0] },
};
function aspectScale() {
  // 竖屏（手机）水平视野 = 竖直视野 × aspect，aspect≈0.8 时同样的距离只剩 80% 的横向范围
  return camera.aspect < 1.05 ? 0.66 : 1;
}
function applyView(name) {
  const v = VIEWS[name] || VIEWS.persp;
  state.view = name;
  cam.yawT = v.yaw; cam.pitchT = v.pitch; cam.distT = v.dist * aspectScale();
  cam.targetT.set(v.target[0], v.target[1], v.target[2]);
  document.querySelectorAll('.tb-funcs [data-view]').forEach((b) => {
    b.classList.toggle('on', b.dataset.view === name);
  });
}
function updateCamera() {
  cam.yaw += (cam.yawT - cam.yaw) * 0.18;
  cam.pitch += (cam.pitchT - cam.pitch) * 0.18;
  cam.dist += (cam.distT - cam.dist) * 0.16;
  cam.target.lerp(cam.targetT, 0.18);
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  camera.position.set(
    cam.target.x + cam.dist * cp * Math.sin(cam.yaw),
    cam.target.y + cam.dist * sp,
    cam.target.z + cam.dist * cp * Math.cos(cam.yaw)
  );
  camera.lookAt(cam.target);
  camera.updateMatrixWorld(true);
}

// ============================================================
//  器材管理
// ============================================================
const state = {
  view: 'persp',
  labels: true,
  shadow: true,
  selected: null,
};
const items = [];          // { api, type, group, label, el }

const BUILDERS = { rheostat: buildRheostat, switch: buildSwitch };
const META = {};
CATALOG.forEach((c) => { META[c.type] = c; });

function addItem(type, worldPos) {
  const build = BUILDERS[type];
  if (!build) { toast('这件器材还在开发中'); return null; }
  const api = build();
  const g = api.group;
  // 默认落点：桌面中央；已有器材就往后排
  let x = 0, z = 0;
  if (worldPos) { x = worldPos.x; z = worldPos.z; }
  else if (items.length) {
    // 2 列网格：一台宽约 240 mm，桌面 1000 mm，并排三台就首尾相贴了
    const n = items.length;
    x = -190 + (n % 2) * 380;
    z = 70 - Math.floor(n / 2) * 150;
  }
  g.position.set(clamp(x, -PLACE.x, PLACE.x), 0, clamp(z, -PLACE.z, PLACE.z));
  scene.add(g);

  const item = { api, type, group: g, el: null, Rmax: 20 };
  items.push(item);
  buildLabel(item);
  select(item);
  syncUI();
  toast('放上了 ' + META[type].label);
  return item;
}

function removeItem(item) {
  if (!item) return;
  const i = items.indexOf(item);
  if (i === -1) return;
  items.splice(i, 1);
  // 挂在这台器材上的导线一起剪掉（端点没了，导线留着就是断头线）
  wires.filter((w) => w.a.item === item || w.b.item === item)
    .forEach((w) => removeWire(w.id));
  scene.remove(item.group);
  item.group.traverse((o) => {
    // 几何是每实例独立建的（绕线要按 slide 改顶点色），这里一并释放
    if (o.isMesh && o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
  });
  if (item.el && item.el.parentNode) item.el.parentNode.removeChild(item.el);
  if (state.selected === item) state.selected = null;
  syncUI();
}

function clearAll() {
  items.slice().forEach(removeItem);
  wires.slice().forEach((w) => removeWire(w.id));
  cancelPending();
  selectWire(null);
  toast('桌面已清空');
}

function select(item) {
  state.selected = item || null;
  syncUI();
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ============================================================
//  接线柱与导线
// ------------------------------------------------------------
// 这一版导线【只连形状，不通电流】：电源与求解内核还没进场，所以不做任何电气判断。
// 但连线这一层现在就要做对 —— 端点绑在「器材 + 柱号」上，器材一移动导线跟着走，
// 器材一删除导线一起消失。等电源进场时，只要把 wires 交给 circuit-core 求解即可。
// ============================================================
const wires = [];
let wireSeq = 0;
let pending = null;         // { item, term } —— 已选中一个柱、等第二个
let selectedWire = null;
let pendingMark = null;

const wireMat = new THREE.MeshStandardMaterial({ color: 0xb03a2e, roughness: 0.48, metalness: 0.22 });
const wireMatSel = new THREE.MeshStandardMaterial({ color: 0xffa040, roughness: 0.4, metalness: 0.2 });

(function buildPendingMark() {
  const g = new THREE.Group();
  const ball = new THREE.Mesh(new THREE.SphereGeometry(4.2, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0x67e8f9 }));
  g.add(ball);
  const ring = new THREE.Mesh(new THREE.RingGeometry(7.5, 10.5, 26),
    new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  g.add(ring);
  g.visible = false;
  scene.add(g);
  pendingMark = g;
})();

function termWorld(item, term) {
  const v = item.api.termLocal[term].clone();
  item.group.localToWorld(v);
  return v;
}

function wireGeoFor(p1, p2) {
  const mid = p1.clone().add(p2).multiplyScalar(0.5);
  mid.y += 34 + p1.distanceTo(p2) * 0.16;      // 往上拱一点，像真导线那样垂着
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3([p1, mid, p2]), 48, 3.1, 10, false);
}

function addWire(a, b) {
  const mesh = new THREE.Mesh(wireGeoFor(termWorld(a.item, a.term), termWorld(b.item, b.term)), wireMat);
  wireSeq += 1;
  mesh.userData.wireId = wireSeq;
  scene.add(mesh);
  wires.push({ id: wireSeq, a, b, mesh });
  syncUI();
  toast(a.term + ' → ' + b.term + ' 接上了（这一版只连形状，还没有电流）');
}

function removeWire(id) {
  const i = wires.findIndex((w) => w.id === id);
  if (i === -1) return;
  const w = wires[i];
  scene.remove(w.mesh);
  if (w.mesh.geometry) w.mesh.geometry.dispose();
  wires.splice(i, 1);
  if (selectedWire === id) selectedWire = null;
  syncUI();
}

function selectWire(id) {
  selectedWire = id;
  wires.forEach((w) => { w.mesh.material = (w.id === id) ? wireMatSel : wireMat; });
}

// 器材一动，挂在它身上的导线跟着重算
function refreshWiresFor(item) {
  wires.forEach((w) => {
    if (w.a.item === item || w.b.item === item) {
      w.mesh.geometry.dispose();
      w.mesh.geometry = wireGeoFor(termWorld(w.a.item, w.a.term), termWorld(w.b.item, w.b.term));
    }
  });
}

function cancelPending() {
  pending = null;
  if (pendingMark) pendingMark.visible = false;
}

function handleTermClick(hit) {
  if (!pending) {
    pending = { item: hit.item, term: hit.term };
    pendingMark.position.copy(termWorld(hit.item, hit.term)).add(new THREE.Vector3(0, 7, 0));
    pendingMark.visible = true;
    toast('已选中 ' + hit.term + ' 柱 —— 再点另一个接线柱就连上');
    return;
  }
  if (pending.item === hit.item && pending.term === hit.term) {
    cancelPending();
    toast('已取消');
    return;
  }
  addWire(pending, { item: hit.item, term: hit.term });
  cancelPending();
}

// ============================================================
//  标签（DOM 投影）
// ============================================================
const labelLayer = $('labels');
function buildLabel(item) {
  const el = document.createElement('div');
  el.className = 'plabel';
  el.textContent = META[item.type].label;
  labelLayer.appendChild(el);
  item.el = el;
}
function updateLabels() {
  const rect = canvas.getBoundingClientRect();
  const W = rect.width, H = rect.height;
  items.forEach((item) => {
    if (!item.el) return;
    if (!state.labels) { item.el.classList.add('off'); return; }
    const p = new THREE.Vector3(item.group.position.x, 190, item.group.position.z).project(camera);
    if (p.z > 1 || p.z < -1) { item.el.classList.add('off'); return; }
    const x = (p.x * 0.5 + 0.5) * W;
    const y = (-p.y * 0.5 + 0.5) * H;
    if (x < -40 || x > W + 40 || y < -20 || y > H + 20) { item.el.classList.add('off'); return; }
    item.el.classList.remove('off');
    item.el.style.transform = 'translate(-50%,-50%) translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
    item.el.classList.toggle('sel', state.selected === item);
  });
}

// ============================================================
//  拾取
// ============================================================
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const TABLE_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

function setRay(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
}

// 返回 { item, onSlider, term, wireId, point }
function pick(clientX, clientY) {
  setRay(clientX, clientY);
  const targets = items.map((i) => i.group).concat(wires.map((w) => w.mesh));
  const hits = raycaster.intersectObjects(targets, true);
  for (const h of hits) {
    // 导线：直接按 mesh 认
    if (h.object.userData && h.object.userData.wireId) {
      return { item: null, wireId: h.object.userData.wireId, point: h.point };
    }
    let o = h.object;
    let item = null;
    while (o && !item) {
      item = items.find((it) => it.group === o) || null;
      o = o.parent;
    }
    if (!item) continue;
    // 点中的是不是滑片？顺着父链找 api.slider
    let q = h.object, onSlider = false;
    while (q) {
      if (q === item.api.slider) { onSlider = true; break; }
      q = q.parent;
    }
    // 点中的是不是接线柱？kit 里给柱子的 mesh 打了 termId
    let r = h.object, term = null;
    while (r) {
      if (r.userData && r.userData.termId) { term = r.userData.termId; break; }
      r = r.parent;
    }
    return { item, onSlider, term, point: h.point };
  }
  return null;
}

function tablePoint(clientX, clientY) {
  setRay(clientX, clientY);
  const p = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(TABLE_PLANE, p)) return null;
  return p;
}

// ============================================================
//  指针交互：转视角 / 挪器材 / 拖滑片 / 点选
// ============================================================
let drag = null;

canvas.addEventListener('pointerdown', (e) => {
  const hit = pick(e.clientX, e.clientY);
  drag = {
    x: e.clientX, y: e.clientY, moved: 0,
    mode: hit ? (hit.onSlider ? 'slide' : 'move') : 'orbit',
    item: hit ? hit.item : null,
    offX: 0, offZ: 0,
  };
  if (hit && drag.mode === 'move') {
    const p = tablePoint(e.clientX, e.clientY);
    if (p) {
      drag.offX = hit.item.group.position.x - p.x;
      drag.offZ = hit.item.group.position.z - p.z;
    }
  }
  if (hit && drag.mode === 'slide') {
    // 先把「滑片行程在屏幕上有多长」量出来：整段 slide 0→1 投影后的像素宽度。
    const it = hit.item;
    const a = new THREE.Vector3(it.api.slideX(0), DIM.ROD_Y, 6);
    const b = new THREE.Vector3(it.api.slideX(1), DIM.ROD_Y, 6);
    it.group.localToWorld(a); it.group.localToWorld(b);
    const rect = canvas.getBoundingClientRect();
    const pa = a.project(camera), pb = b.project(camera);
    const px = Math.abs((pb.x - pa.x) * rect.width / 2);
    drag.slide0 = it.api.getSlide();
    drag.startX = e.clientX;
    drag.pxPer = Math.max(30, px);
  }
  canvas.classList.add('grabbing');
  try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
});

canvas.addEventListener('pointermove', (e) => {
  if (!drag) {
    const hit = pick(e.clientX, e.clientY);
    canvas.classList.toggle('hot', !!hit && !hit.onSlider);
    canvas.classList.toggle('slide', !!hit && hit.onSlider);
    return;
  }
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.moved += Math.abs(dx) + Math.abs(dy);
  drag.x = e.clientX; drag.y = e.clientY;

  if (drag.mode === 'orbit') {
    if (drag.moved > 3) {
      cam.yawT -= dx * 0.007;
      cam.pitchT = clamp(cam.pitchT + dy * 0.005, -0.05, 1.25);
    }
    return;
  }
  if (drag.mode === 'move' && drag.item) {
    const p = tablePoint(e.clientX, e.clientY);
    if (p) {
      drag.item.group.position.x = clamp(p.x + drag.offX, -PLACE.x, PLACE.x);
      drag.item.group.position.z = clamp(p.z + drag.offZ, -PLACE.z, PLACE.z);
      refreshWiresFor(drag.item);
    }
    return;
  }
  if (drag.mode === 'slide' && drag.item) {
    const t = drag.slide0 + (e.clientX - drag.startX) / drag.pxPer;
    drag.item.api.setSlide(clamp(t, 0, 1));
    // 只刷数值，不重建面板：syncUI() 会重建 range 控件，拖拽过程中重建等于把它换掉
    refreshParams();
  }
});

canvas.addEventListener('pointerup', (e) => {
  canvas.classList.remove('grabbing');
  if (drag && drag.moved < 6) {
    const hit = pick(e.clientX, e.clientY);
    if (!hit) {
      select(null); selectWire(null); cancelPending();
    } else if (hit.wireId) {
      select(null); cancelPending(); selectWire(hit.wireId);
      toast('选中一根导线（按 Delete 剪掉）');
    } else if (hit.term) {
      select(hit.item); selectWire(null); handleTermClick(hit);
    } else if (pending) {
      // 正在等第二个接线柱：点到器材别处只是「点偏了」，别把已经选好的那个柱丢掉
      select(hit.item);
      toast('要接在红色接线柱上 —— 再点另一个柱');
    } else if (hit.item.type === 'switch' && !hit.onSlider) {
      // 点刀片 / 手柄 = 合闸或拉闸
      hit.item.api.toggle();
      select(hit.item); selectWire(null);
      toast('开关' + (hit.item.api.isClosed() ? '闭合（通路）' : '断开（断路）'));
    } else {
      select(hit.item); selectWire(null);
    }
  }
  drag = null;
});
canvas.addEventListener('pointercancel', () => { drag = null; canvas.classList.remove('grabbing'); });

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  cam.distT = clamp(cam.distT * (1 + e.deltaY * 0.0011), 420, 3600);
}, { passive: false });

// 键盘：R 旋转 / Delete 移除
window.addEventListener('keydown', (e) => {
  if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
  if ((e.key === 'r' || e.key === 'R') && state.selected) rotateSelected();
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selectedWire != null) { e.preventDefault(); removeWire(selectedWire); toast('导线已剪掉'); }
    else if (state.selected) { e.preventDefault(); removeItem(state.selected); }
  }
});

function rotateSelected() {
  if (!state.selected) { toast('先点一台器材'); return; }
  state.selected.group.rotation.y += Math.PI / 2;
}

// ============================================================
//  渲染循环
// ============================================================
let lastT = 0, renderCount = 0;
function render() {
  renderer.render(scene, camera);
  renderCount++;
  updateLabels();
}
function loop(t) {
  const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016);
  lastT = t;
  updateCamera();
  items.forEach((it) => { if (it.api.step) it.api.step(dt); });
  render();
  requestAnimationFrame(loop);
}

let layoutCalls = 0;
function layout() {
  const w = Math.max(1, canvas.clientWidth);
  const h = Math.max(1, canvas.clientHeight);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  layoutCalls++;
  render();
}

// ============================================================
//  器材库面板（按 CATALOG 自动生成卡片）
// ============================================================
const ICONS = {
  rheostat: '<svg viewBox="0 0 44 32"><g stroke="#334155" stroke-width="1.6" fill="none">' +
    '<rect x="4" y="19" width="36" height="3" rx="1.2" fill="#cbd5e1"/>' +
    '<rect x="9" y="9" width="26" height="9" rx="4.5" fill="#e2e8f0" stroke="#64748b"/>' +
    '<path d="M6 9h32" stroke="#94a3b8" stroke-width="2"/>' +
    '<rect x="19" y="4" width="7" height="7" rx="1.5" fill="#475569" stroke="#334155"/>' +
    '<path d="M22.5 11v4" stroke="#b45309" stroke-width="2"/>' +
    '<circle cx="9" cy="15" r="2" fill="#dc2626" stroke="none"/><circle cx="35" cy="15" r="2" fill="#dc2626" stroke="none"/>' +
    '</g></svg>',
  battery: '<svg viewBox="0 0 44 32"><g stroke="#334155" stroke-width="1.5" fill="none">' +
    '<rect x="6" y="10" width="32" height="13" rx="2" fill="#e2e8f0"/>' +
    '<path d="M22 10v13" stroke="#94a3b8"/><path d="M13 6v4M31 6v4" stroke="#475569"/>' +
    '<text x="11" y="20" font-size="7" fill="#b91c1c" stroke="none">+</text>' +
    '<text x="28" y="20" font-size="7" fill="#1d4ed8" stroke="none">−</text></g></svg>',
  switch: '<svg viewBox="0 0 44 32"><g stroke="#334155" stroke-width="1.5" fill="none">' +
    '<rect x="4" y="20" width="36" height="3" rx="1.2" fill="#cbd5e1"/>' +
    '<circle cx="12" cy="20" r="2.6" fill="#94a3b8"/><circle cx="32" cy="20" r="2.6" fill="#94a3b8"/>' +
    '<path d="M12 19l17-9" stroke="#475569" stroke-width="2.4" stroke-linecap="round"/></g></svg>',
  bulb: '<svg viewBox="0 0 44 32"><g stroke="#334155" stroke-width="1.5" fill="none">' +
    '<circle cx="22" cy="14" r="8.5" fill="#fef9c3"/>' +
    '<path d="M18 22h8M19 25h6" stroke="#94a3b8"/>' +
    '<path d="M19 15l3-4 3 4-3 3z" stroke="#b45309" fill="none"/></g></svg>',
  meter: '<svg viewBox="0 0 44 32"><g stroke="#334155" stroke-width="1.5" fill="none">' +
    '<rect x="7" y="5" width="30" height="22" rx="3" fill="#f1f5f9"/>' +
    '<path d="M22 22l7-9" stroke="#b91c1c" stroke-width="2" stroke-linecap="round"/>' +
    '<circle cx="22" cy="22" r="2" fill="#334155" stroke="none"/>' +
    '<path d="M13 10q9-5 18 0" stroke="#94a3b8"/></g></svg>',
};

const paletteEl = $('palette');
function buildPalette() {
  CATALOG.forEach((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'kit-card' + (c.ready ? '' : ' soon');
    b.dataset.type = c.type;
    b.innerHTML =
      '<span class="ic">' + (ICONS[c.type] || '') + '</span>' +
      '<span class="tx"><span class="nm">' + c.label + '</span>' +
      '<span class="sp">' + (c.ready ? c.spec : '待加入') + '</span></span>';
    paletteEl.appendChild(b);
  });
}
buildPalette();

// 点击放一台 / 按住拖到桌面松手放
let cardDrag = null;
paletteEl.addEventListener('pointerdown', (e) => {
  const card = e.target.closest('.kit-card');
  if (!card) return;
  const meta = META[card.dataset.type];
  if (!meta || !meta.ready) {
    toast(meta ? meta.label + ' 还在开发中' : '这件器材还没做');
    return;
  }
  cardDrag = { type: card.dataset.type, x: e.clientX, y: e.clientY, moved: 0, ghost: null };
  try { card.setPointerCapture(e.pointerId); } catch (_) {}
});
paletteEl.addEventListener('pointermove', (e) => {
  if (!cardDrag) return;
  const dx = e.clientX - cardDrag.x, dy = e.clientY - cardDrag.y;
  cardDrag.moved += Math.abs(dx) + Math.abs(dy);
  cardDrag.x = e.clientX; cardDrag.y = e.clientY;
  if (cardDrag.moved > 6 && !cardDrag.ghost) {
    const g = document.createElement('div');
    g.className = 'pal-ghost';
    g.innerHTML = '<span class="nm">' + META[cardDrag.type].label + '</span>';
    document.body.appendChild(g);
    cardDrag.ghost = g;
    stageEl.classList.add('dropping');
  }
  if (cardDrag.ghost) {
    cardDrag.ghost.style.left = (e.clientX + 12) + 'px';
    cardDrag.ghost.style.top = (e.clientY - 18) + 'px';
  }
});
paletteEl.addEventListener('pointerup', (e) => {
  if (!cardDrag) return;
  const d = cardDrag;
  cardDrag = null;
  stageEl.classList.remove('dropping');
  if (d.ghost && d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost);
  const rect = stageEl.getBoundingClientRect();
  const inside = e.clientX >= rect.left && e.clientX <= rect.right &&
                 e.clientY >= rect.top && e.clientY <= rect.bottom;
  if (d.moved > 6) {
    if (!inside) return;
    const p = tablePoint(e.clientX, e.clientY);
    addItem(d.type, p ? { x: p.x, z: p.z } : null);
  } else {
    addItem(d.type, null);
  }
});
paletteEl.addEventListener('pointercancel', () => {
  if (cardDrag && cardDrag.ghost && cardDrag.ghost.parentNode) cardDrag.ghost.parentNode.removeChild(cardDrag.ghost);
  cardDrag = null;
  stageEl.classList.remove('dropping');
});

// ============================================================
//  参数面板（选中器材时才出现）
// ============================================================
const paramsBox = $('params'), paramsHead = $('paramsHead'),
      paramsToggle = $('paramsToggle'), paramsBody = $('paramsBody'), pSel = $('pSel');
const paramsIsOpen = () => !!paramsBox && !paramsBox.classList.contains('collapsed');
function setParamsOpen(on) {
  if (!paramsBox) return;
  paramsBox.classList.toggle('collapsed', !on);
  paramsToggle.setAttribute('aria-expanded', on ? 'true' : 'false');
  paramsToggle.textContent = on ? '▾ 收起' : '▸ 展开';
  paramsToggle.title = on ? '收起参数面板' : '展开参数面板';
}
paramsToggle.addEventListener('click', (e) => { e.stopPropagation(); setParamsOpen(!paramsIsOpen()); });
paramsHead.addEventListener('click', (e) => {
  if (e.target.closest && e.target.closest('#paramsToggle')) return;
  setParamsOpen(!paramsIsOpen());
});
paramsBox.addEventListener('pointerdown', (e) => e.stopPropagation());
paramsBox.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });

let pSlideEl = null, pSlideOut = null, pRmaxEl = null, pRmaxOut = null;

function buildParams() {
  const it = state.selected;
  if (!it) {
    pSel.innerHTML = '<div class="params-empty">点桌面上的器材，这里出现它的参数。</div>';
    pSlideEl = pSlideOut = pRmaxEl = pRmaxOut = null;
    return;
  }

  // ── 开关：只有一个「合上 / 抬起」──────────────────────────
  if (it.type === 'switch') {
    pSlideEl = pSlideOut = pRmaxEl = pRmaxOut = null;
    const closed = it.api.isClosed();
    pSel.innerHTML =
      '<div class="lab3d-field">' +
        '<label>刀片状态 <output id="pSwOut">' + it.api.stateText() + '</output></label>' +
        '<small>点画面里的<b>刀片</b>或那只浅蓝手柄，也能直接开合。</small>' +
      '</div>' +
      '<div class="lab3d-btnrow">' +
        '<button type="button" class="primary" id="pSwToggle">' + (closed ? '↥ 抬起（断开）' : '↧ 合上（闭合）') + '</button>' +
        '<button type="button" id="pRotate">⟳ 转 90°</button>' +
      '</div>' +
      '<div class="lab3d-btnrow">' +
        '<button type="button" id="pRemove">🗑 从桌上拿走</button>' +
      '</div>' +
      '<small style="display:block;margin-top:8px;color:#64748b;font-size:10px;line-height:1.55">' +
        'A、B 两个红色滚花柱就是接线柱：<b>先点一个、再点另一个</b>，就接出一根导线。' +
        '这一版导线只连形状，电流要等电源进场。</small>';
    $('pSwToggle').addEventListener('click', () => {
      it.api.toggle();
      buildParams();
      syncReadout();
      toast('开关' + (it.api.isClosed() ? '闭合（通路）' : '断开（断路）'));
    });
    $('pRotate').addEventListener('click', rotateSelected);
    $('pRemove').addEventListener('click', () => removeItem(it));
    return;
  }

  pSel.innerHTML =
    '<div class="lab3d-field">' +
      '<label for="pSlide">滑片位置 <output id="pSlideOut">' + Math.round(it.api.getSlide() * 100) + ' %</output></label>' +
      '<input id="pSlide" type="range" min="0" max="100" step="1" value="' + Math.round(it.api.getSlide() * 100) + '">' +
      '<small>拖它，接入的那段丝（橙色）跟着变长变短。</small>' +
    '</div>' +
    '<div class="lab3d-field">' +
      '<label for="pRmax">最大阻值 R<sub>max</sub> <output id="pRmaxOut">' + it.Rmax + ' Ω</output></label>' +
      '<input id="pRmax" type="range" min="5" max="50" step="5" value="' + it.Rmax + '">' +
      '<small>实验室那只的铭牌通常是 <b>20 Ω 2 A</b>。</small>' +
    '</div>' +
    '<div class="lab3d-btnrow">' +
      '<button type="button" id="pRotate">⟳ 转 90°</button>' +
      '<button type="button" id="pRemove">🗑 从桌上拿走</button>' +
    '</div>';
  pSlideEl = $('pSlide'); pSlideOut = $('pSlideOut');
  pRmaxEl = $('pRmax'); pRmaxOut = $('pRmaxOut');
  pSlideEl.addEventListener('input', (e) => {
    if (!state.selected) return;
    state.selected.api.setSlide(+e.target.value / 100);
    refreshParams();
  });
  pRmaxEl.addEventListener('input', (e) => {
    if (!state.selected) return;
    state.selected.Rmax = +e.target.value;
    refreshParams();
  });
  $('pRotate').addEventListener('click', rotateSelected);
  $('pRemove').addEventListener('click', () => removeItem(state.selected));
}

function refreshParams() {
  const it = state.selected;
  if (it && it.type === 'switch') {
    const o = $('pSwOut');
    if (o) o.textContent = it.api.stateText();
    syncReadout();
    syncCtl();
    return;
  }
  if (it && pSlideEl) {
    const s = Math.round(it.api.getSlide() * 100);
    pSlideEl.value = s;
    pSlideOut.textContent = s + ' %';
    pRmaxOut.textContent = it.Rmax + ' Ω';
  }
  syncReadout();
  syncCtl();
}

function syncReadout() {
  const it = state.selected;
  if (!it) {
    $('roR').innerHTML = '—<small>Ω</small>';
    $('roSub').textContent = items.length ? '点一台器材看它的读数' : '桌上还没有器材';
    return;
  }
  if (it.type === 'switch') {
    const closed = it.api.isClosed();
    $('roR').innerHTML = closed ? '通<small>路</small>' : '断<small>路</small>';
    $('roSub').innerHTML = '开关' + (closed ? '<b>已合上</b>' : '<b>已抬起</b>') + ' · 桌上导线 ' + wires.length + ' 根';
    return;
  }
  const r = it.api.previewR(it.Rmax);
  $('roR').innerHTML = r.toFixed(1) + '<small>Ω</small>';
  $('roSub').innerHTML = '滑片 <b>' + Math.round(it.api.getSlide() * 100) + '%</b> · 按 A—C 接法预演';
}

function syncCtl() {
  const it = state.selected;
  const sl = $('cSlide'), out = $('cSlideV');
  if (it && typeof it.api.setSlide !== 'function') {
    sl.disabled = true;
    out.textContent = '—';
    $('btnRotate').disabled = false;
    $('btnDelete').disabled = false;
    $('cRotate').disabled = false;
    $('cDelete').disabled = false;
    return;
  }
  if (it) {
    sl.disabled = false;
    const s = Math.round(it.api.getSlide() * 100);
    sl.value = s;
    out.textContent = s + '%';
  } else {
    sl.disabled = true;
    out.textContent = '—';
  }
  $('btnRotate').disabled = !it;
  $('btnDelete').disabled = !it;
  $('cRotate').disabled = !it;
  $('cDelete').disabled = !it;
}

function syncRoad() {
  const road = $('road');
  const ready = CATALOG.filter((c) => c.ready).length;
  road.innerHTML = CATALOG.map((c) =>
    '<li class="' + (c.ready ? 'done' : '') + '"><span class="dot"></span>' +
    '<span>' + c.label + '</span>' +
    '<span class="tag">' + (c.ready ? '已加入' : '待开发') + '</span></li>'
  ).join('');
  $('roadPill').textContent = ready + ' / ' + CATALOG.length;
  $('kitCount').textContent = ready + ' 件';
}

function syncUI() {
  buildParams();
  refreshParams();
  syncRoad();
}

// ============================================================
//  事件绑定
// ============================================================
$('cSlide').addEventListener('input', (e) => {
  if (!state.selected) return;
  state.selected.api.setSlide(+e.target.value / 100);
  refreshParams();
});
$('cRotate').addEventListener('click', rotateSelected);
$('cDelete').addEventListener('click', () => removeItem(state.selected));
$('btnRotate').addEventListener('click', rotateSelected);
$('btnDelete').addEventListener('click', () => removeItem(state.selected));
$('btnClear').addEventListener('click', clearAll);
$('cView').addEventListener('click', () => {
  const order = ['persp', 'front', 'top', 'closeup'];
  const i = order.indexOf(state.view);
  applyView(order[(i + 1) % order.length]);
});
document.querySelectorAll('.tb-funcs [data-view]').forEach((b) => {
  b.addEventListener('click', () => applyView(b.dataset.view));
});
$('pAddRheo').addEventListener('click', () => addItem('rheostat', null));
$('pResetView').addEventListener('click', () => applyView('persp'));
$('cLabels').addEventListener('change', (e) => { state.labels = e.target.checked; updateLabels(); });
$('cShadow').addEventListener('change', (e) => {
  state.shadow = e.target.checked;
  items.forEach((it) => { if (it.api.shadow) it.api.shadow.visible = state.shadow; });
});

$('btnKit').addEventListener('click', () => {
  const app = $('app');
  app.classList.toggle('nokit');
  $('btnKit').classList.toggle('on', !app.classList.contains('nokit'));
  layout();
});
$('btnSide').addEventListener('click', () => {
  const app = $('app');
  app.classList.toggle('noside');
  $('btnSide').classList.toggle('on', !app.classList.contains('noside'));
  layout();
});
$('btnFold').addEventListener('click', () => {
  const app = $('app');
  app.classList.toggle('folded');
  const folded = app.classList.contains('folded');
  $('btnFold').textContent = folded ? '▾ 展开' : '▴ 收起';
  layout();
});

// ============================================================
//  全屏（目标 = 整个舞台；参数面板与底部控制带都是它的后代）
// ============================================================
const fsBtn = $('fsBtn');
let fsLayouts = 0;
function fsLayout() { layout(); fsLayouts++; }
const fsIsOn = () => document.fullscreenElement === stageEl || document.webkitFullscreenElement === stageEl;
fsBtn.addEventListener('click', () => {
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  } else if (stageEl.requestFullscreen) {
    stageEl.requestFullscreen();
  } else if (stageEl.webkitRequestFullscreen) {
    stageEl.webkitRequestFullscreen();
  }
});
function onFsChange() {
  const on = fsIsOn();
  const ex = fsBtn.querySelector('.fs-expand'), cp = fsBtn.querySelector('.fs-compress'), lb = fsBtn.querySelector('.lbl');
  if (ex) ex.style.display = on ? 'none' : '';
  if (cp) cp.style.display = on ? '' : 'none';
  if (lb) lb.textContent = on ? '退出' : '全屏';
  fsBtn.title = on ? '退出全屏' : '全屏显示实验画面';
  fsBtn.setAttribute('aria-label', fsBtn.title);
  fsLayout();
  const k = aspectScale();
  if (Math.abs(k - lastAspectK) > 0.01) { lastAspectK = k; applyView(state.view); }
  requestAnimationFrame(() => requestAnimationFrame(fsLayout));
  setTimeout(fsLayout, 90);
}
document.addEventListener('fullscreenchange', onFsChange);
document.addEventListener('webkitfullscreenchange', onFsChange);

// ============================================================
//  提示
// ============================================================
let toastTimer = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1700);
}

// ============================================================
//  启动
// ============================================================
layout();
applyView('persp');
let lastAspectK = aspectScale();
window.addEventListener('resize', () => {
  layout();
  // 跨过断点（手机竖屏 ↔ 桌面横屏）时重新取景，否则器材会一直太大/太小
  const k = aspectScale();
  if (Math.abs(k - lastAspectK) > 0.01) { lastAspectK = k; applyView(state.view); }
});
syncRoad();
addItem('rheostat', null);        // 一进来桌上就有一台，不用先找器材库
requestAnimationFrame(loop);
setTimeout(() => { if (renderCount === 0) { layout(); render(); } }, 1200);

// ============================================================
//  自检钩子
// ============================================================
window.__lab = {
  THREE, scene, camera, renderer, items, state, cam, DIM, CATALOG,
  addItem, removeItem, clearAll, select, rotateSelected,
  get itemCount() { return items.length; },
  get layoutCalls() { return layoutCalls; },
  get fsLayouts() { return fsLayouts; },
  get renderCount() { return renderCount; },
  itemInfo(i) {
    const it = items[i || 0];
    if (!it) return null;
    return {
      type: it.type,
      pos: { x: it.group.position.x, y: it.group.position.y, z: it.group.position.z },
      rotY: it.group.rotation.y,
      slide: it.api.getSlide ? it.api.getSlide() : null,
      sliderX: it.api.slider ? it.api.slider.position.x : null,
      Rmax: it.Rmax,
      previewR: it.api.previewR ? it.api.previewR(it.Rmax) : null,
      closed: it.api.isClosed ? it.api.isClosed() : null,
      bladeAngle: it.api.getAngle ? it.api.getAngle() : null,
      // 🔴 读【刀片组真实的角度】，不是内部缓动变量：只改状态不转几何的变异
      //    在 bladeAngle 上照样合格（断言会空转）。
      bladeRot: it.api.pivot ? it.api.pivot.rotation.z : null,
      shadowVisible: !!(it.api.shadow && it.api.shadow.visible),
      selected: state.selected === it,
    };
  },
  // ── 接线柱 / 导线（自检与后续接电源都要用）────────────────
  get wireCount() { return wires.length; },
  wireInfo() {
    return wires.map((w) => ({
      id: w.id,
      a: { type: w.a.item.type, term: w.a.term, world: termWorld(w.a.item, w.a.term).toArray().map((n) => Math.round(n)) },
      b: { type: w.b.item.type, term: w.b.term, world: termWorld(w.b.item, w.b.term).toArray().map((n) => Math.round(n)) },
      // 🔴 上面两个 world 是【现算】的（从器材位置推），器材一移它自己就变 ——
      //    拿它判「导线跟没跟」会空转。这里量的是导线 mesh 自己几何的中心。
      meshCenter: (() => {
        if (!w.mesh.geometry.boundingBox) w.mesh.geometry.computeBoundingBox();
        const c = w.mesh.geometry.boundingBox.getCenter(new THREE.Vector3());
        return c.toArray().map((n) => Math.round(n * 10) / 10);
      })(),
      selected: selectedWire === w.id,
    }));
  },
  pendingInfo() {
    return pending ? { term: pending.term, idx: items.indexOf(pending.item) } : null;
  },
  addWireByTerm(iA, tA, iB, tB) {
    addWire({ item: items[iA], term: tA }, { item: items[iB], term: tB });
    return wires.length;
  },
  removeWireById(id) { removeWire(id); return wires.length; },
  // 接线柱在屏幕上的位置（自检用真实鼠标去点它）
  termWorldOf(i, term) {
    const it = items[i || 0];
    if (!it || !it.api.termLocal || !it.api.termLocal[term]) return null;
    return termWorld(it, term).toArray().map((n) => Math.round(n * 10) / 10);
  },
  termScreen(i, term) {
    const it = items[i || 0];
    if (!it || !it.api.termLocal || !it.api.termLocal[term]) return null;
    const rect = canvas.getBoundingClientRect();
    const p = termWorld(it, term).project(camera);
    return {
      x: rect.left + (p.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-p.y * 0.5 + 0.5) * rect.height,
      inFront: p.z > -1 && p.z < 1,
    };
  },
  // 刀片（开关的可点区域）在屏幕上的位置
  bladeScreen(i) {
    const it = items[i || 0];
    if (!it || !it.api.pivot) return null;
    const rect = canvas.getBoundingClientRect();
    const v = new THREE.Vector3(40, 0, 0);
    it.api.pivot.localToWorld(v);
    const p = v.project(camera);
    return {
      x: rect.left + (p.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-p.y * 0.5 + 0.5) * rect.height,
      inFront: p.z > -1 && p.z < 1,
    };
  },
  setSlide(i, s) {
    const it = items[i || 0];
    if (!it) return null;
    it.api.setSlide(s);
    syncUI();
    return it.api.getSlide();
  },
  setRmax(i, v) {
    const it = items[i || 0];
    if (!it) return null;
    it.Rmax = v;
    syncUI();
    return it.Rmax;
  },
  moveItem(i, x, z) {
    const it = items[i || 0];
    if (!it) return null;
    it.group.position.x = clamp(x, -PLACE.x, PLACE.x);
    it.group.position.z = clamp(z, -PLACE.z, PLACE.z);
    refreshWiresFor(it);          // 和真实拖动走同一条路：挪了器材就得重算导线
    return { x: it.group.position.x, z: it.group.position.z };
  },
  // 器材在屏幕上的位置（自检用真实鼠标去点/拖）。
  // 🔴 y 是【器材局部 mm】（0 = 桌面，60 = 机身中部），必须经 inner 的 localToWorld 变换，
  //    直接当世界坐标用会落到桌面下面 —— 于是 pick 什么都点不到，测试还以为是「拖不动」。
  project(i, y) {
    const it = items[i || 0];
    if (!it) return null;
    const rect = canvas.getBoundingClientRect();
    const wp = it.api.localToWorld(new THREE.Vector3(0, y == null ? 0 : y, 0));
    const p = wp.project(camera);
    return {
      x: rect.left + (p.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-p.y * 0.5 + 0.5) * rect.height,
      inFront: p.z > -1 && p.z < 1,
    };
  },
  // 滑片在屏幕上的位置（拖滑片用）
  projectSlider(i) {
    const it = items[i || 0];
    if (!it) return null;
    // 滑片手柄的世界位置：从 slider 自己往上量（它的 matrixWorld 已经含 inner 的缩放与抬升）
    const v = new THREE.Vector3(0, DIM.ROD_Y + 4, 6);
    it.api.slider.localToWorld(v);
    const rect = canvas.getBoundingClientRect();
    const p = v.project(camera);
    return {
      x: rect.left + (p.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-p.y * 0.5 + 0.5) * rect.height,
    };
  },
  pixels() {
    render();
    const gl = renderer.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let sum = 0, warm = 0, bright = 0;
    for (let i = 0; i < buf.length; i += 4) {
      const r = buf[i], g = buf[i + 1], b = buf[i + 2];
      const l = (r + g + b) / 3;
      sum += l;
      if (l > 40) bright++;
      if (r > 130 && r - b > 40 && g > 80 && g < 195 && b < 115) warm++;
    }
    const total = w * h;
    return { w, h, mean: sum / total, brightRatio: bright / total, warmRatio: warm / total };
  },
  pixelSignature() {
    render();
    const gl = renderer.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const out = [];
    for (let y = 0; y < h; y += 12) {
      for (let x = 0; x < w; x += 12) {
        const i = (y * w + x) * 4;
        out.push(Math.round((buf[i] + buf[i + 1] + buf[i + 2]) / 3));
      }
    }
    return out;
  },
  // 🔴 必须查【真实的 DOM 标签】，不能从 items 派生：
  //    派生出来的列表在「删了器材却忘了删标签」时仍然是正确的 —— 断言会空转。
  labels() {
    return [...labelLayer.querySelectorAll('.plabel')].map((el) => {
      const r = el.getBoundingClientRect();
      return { text: el.textContent, off: el.classList.contains('off'), x: r.x, y: r.y };
    });
  },
  paramsInfo() {
    const r = paramsBox.getBoundingClientRect();
    const s = stageEl.getBoundingClientRect();
    return {
      collapsed: paramsBox.classList.contains('collapsed'),
      inStage: stageEl.contains(paramsBox),
      areaRatio: (r.width * r.height) / (s.width * s.height),
      controlsInBody: paramsBody.querySelectorAll('input,select,button').length,
      bodyScrollable: paramsBody.scrollHeight > paramsBody.clientHeight,
    };
  },
  dragInfo() {
    return drag ? {
      mode: drag.mode,
      hasItem: !!drag.item,
      slide0: drag.slide0,
      pxPer: drag.pxPer,
      startX: drag.startX,
      moved: drag.moved,
    } : null;
  },
  // 直接问「这个屏幕点上有什么」（排障用，和真实交互走同一个 pick）
  pickAt(x, y) {
    const r = pick(x, y);
    return r ? { type: r.item.type, onSlider: r.onSlider, idx: items.indexOf(r.item) } : null;
  },
  ctlInfo() {
    const r = $('ctl').getBoundingClientRect();
    const s = stageEl.getBoundingClientRect();
    return { y: r.y, bottom: r.bottom, stageBottom: s.bottom, inView: r.bottom <= window.innerHeight + 1 };
  },
};
