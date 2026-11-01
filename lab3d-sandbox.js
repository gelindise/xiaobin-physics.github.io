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
import { CATALOG, buildRheostat, buildSwitch, buildBattery, buildBulb, buildMeter,
  buildStorageBattery, buildResistor, buildPower,
  buildResistanceBox, buildRheoboard, buildLed, buildJoule, buildCalorimeter,
  buildPotentiometer, RBOARD_WIRES, DIM } from './lab3d-kit.js?build=25';

const $ = (id) => document.getElementById(id);

// ============================================================
//  场景常量
// ============================================================
// 🔴🔴 「无限拓展的实验桌」：桌面不是固定尺寸，而是【随器材增长】的一张长桌。
//    旧版写死 1000×560，摆到第 5、6 件器材就得往桌沿外挤；器材又按 1:1 放大
//    2.2~2.8 倍，于是画面里「桌子小、元件大」，一点实验台的样子都没有。
//    现在的规则：
//      · 桌面最小 1680×1000（真实实验台），装不下就按 DESK_STEP 加宽 / 加深；
//      · 器材统一乘 KIT_SCALE（0.68）—— 变阻器宽 170 mm 占桌面 10%，
//        和真实「20 cm 变阻器摆 1.8 m 实验台」的比例对得上；
//      · 相机按桌面尺寸【自动取景】(fitDistance)，桌面永远铺满画面。
const DESK_MIN = { w: 1400, d: 1000 };
const DESK_STEP = 240;                                // 每次扩展的步长（拼板整齐）
const DESK = { w: DESK_MIN.w, d: DESK_MIN.d };        // 当前桌面（mm，中心在原点）
const DESK_MAX = { w: 3600, d: 2200 };                // 再大就出房间了（地面 5200×4200）
const TABLE_T = 34;                                   // 台面厚度
const TABLE_H = 740;                                  // 桌面离地高度
const FLOOR_Y = -TABLE_H;
const KIT_SCALE = 0.68;                               // 器材整体缩放（相对 1:1 建模）
const EDGE = 14;                                      // 器材外缘离桌沿留的余量

// 器材半宽 / 半深（已乘 KIT_SCALE）。api.bounds 是 1:1 建模值，别直接拿来夹位置。
function boundsOf(it) {
  const b = (it && it.api && it.api.bounds) || { hw: 120, hd: 60 };
  const k = (it && it.scale) || KIT_SCALE;
  return { hw: b.hw * k, hd: b.hd * k };
}
function limitOf(it) {
  const b = boundsOf(it);
  return {
    x: Math.max(30, DESK.w / 2 - b.hw - EDGE),
    z: Math.max(30, DESK.d / 2 - b.hd - EDGE),
  };
}
// 台面上真正能摆东西的矩形（前沿 +z、后沿 −z）
function placeArea() {
  return { x: DESK.w / 2 - EDGE - 40, zFront: DESK.d / 2 - EDGE - 46, zBack: -(DESK.d / 2 - EDGE - 46) };
}

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
//  实验桌（可扩展：DESK 一变就重建，见 resizeDesk）
// ------------------------------------------------------------
// 结构 = 台面 + 木色包边 + 拼接缝 + 桌腿（按宽度分段）+ 横梁 + 下层隔板。
// 🔴 拼接缝是「无限拓展」的视觉线索：桌子变长时缝数跟着变多，
//    学生看到的是一条可以一直加长的实验台，而不是一张被拉变形的桌子。
// ============================================================
const tableGroup = new THREE.Group();
scene.add(tableGroup);
function clearGroup(g) {
  g.children.slice().forEach((o) => {
    g.remove(o);
    o.traverse((m) => {
      if (m.isMesh) {
        if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose();
        if (m.material && m.material.map && !m.material.userData.shared) m.material.dispose();
      }
    });
  });
}
function buildTable() {
  clearGroup(tableGroup);
  const W = DESK.w, D = DESK.d;
  const top = new THREE.Mesh(new THREE.BoxGeometry(W, TABLE_T, D), matTop);
  top.position.y = -TABLE_T / 2;
  top.userData.role = 'deskTop';
  tableGroup.add(top);
  // 木色包边（一圈，比台面高一点点）
  const rimY = 2;
  [[0, rimY, -D / 2 - 4, W + 16, 10, 8], [0, rimY, D / 2 + 4, W + 16, 10, 8],
   [-W / 2 - 4, rimY, 0, 8, 10, D + 16], [W / 2 + 4, rimY, 0, 8, 10, D + 16]]
    .forEach(([x, y, z, w, h, d]) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), matWood);
      m.position.set(x, y, z);
      tableGroup.add(m);
    });
  // 拼接缝：每 800 mm 一条
  const seamMat = new THREE.MeshStandardMaterial({ color: 0x2b343d, roughness: 0.85, metalness: 0.04 });
  for (let x = -W / 2 + 800; x < W / 2 - 40; x += 800) {
    const seam = new THREE.Mesh(new THREE.BoxGeometry(3, 0.6, D - 16), seamMat);
    seam.position.set(x, 0.2, 0);
    tableGroup.add(seam);
  }
  // 桌腿：按宽度分段（每 ~840 mm 一档），保证长桌不「中间塌」
  const legH = TABLE_H - TABLE_T;
  const bays = Math.max(2, Math.round(W / 840) + 1);
  for (let i = 0; i < bays; i++) {
    const lx = bays === 1 ? 0 : (-W / 2 + 70) + (W - 140) * (i / (bays - 1));
    [-1, 1].forEach((sz) => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(52, legH, 52), matLeg);
      leg.position.set(lx, -TABLE_T - legH / 2, sz * (D / 2 - 60));
      tableGroup.add(leg);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(64, 12, 64), matCabinetDark);
      foot.position.set(lx, FLOOR_Y + 6, sz * (D / 2 - 60));
      tableGroup.add(foot);
    });
  }
  [-1, 1].forEach((sz) => {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(W - 180, 34, 34), matLeg);
    beam.position.set(0, -TABLE_T - legH + 90, sz * (D / 2 - 60));
    tableGroup.add(beam);
  });
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(W - 220, 16, D - 160), matCabinetDark);
  shelf.position.set(0, -TABLE_T - legH + 110, 0);
  tableGroup.add(shelf);
}
buildTable();
// 桌面尺寸变化 ⇒ 重建 + 重新取景（器材的世界坐标不动，桌子绕中心长大）
function resizeDesk(w, d) {
  const nw = Math.min(DESK_MAX.w, Math.max(DESK_MIN.w, Math.round(w / DESK_STEP) * DESK_STEP));
  const nd = Math.min(DESK_MAX.d, Math.max(DESK_MIN.d, Math.round(d / DESK_STEP) * DESK_STEP));
  if (nw === DESK.w && nd === DESK.d) return false;
  DESK.w = nw; DESK.d = nd;
  buildTable();
  fitToDesk();
  return true;
}

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
  yaw: -0.34, pitch: 0.30, dist: 2200,
  target: new THREE.Vector3(0, 150, 0),
  yawT: -0.34, pitchT: 0.30, distT: 2200,
  targetT: new THREE.Vector3(0, 150, 0),
};
// 视角只描述「从哪看」，距离一律由 fitDistance() 按桌面尺寸现算 ——
// 桌面会随器材增长，写死 dist 的话加几件器材桌子就出画了。
const VIEWS = {
  persp:   { yaw: -0.34, pitch: 0.40, k: 1.00, target: [0, 80, 0] },
  front:   { yaw: 0,     pitch: 0.20, k: 0.98, target: [0, 130, 0] },
  top:     { yaw: 0,     pitch: 1.06, k: 0.98, target: [0, 40, 0] },
  closeup: { yaw: -0.26, pitch: 0.34, k: 0.66, target: [0, 40, 0] },
};
// 取景：把 DESK 完整框进【没被器材箱挡住的那块画幅】里。
// 🔴 器材箱是舞台内的浮层（全屏里也在），它压着画面左侧约 210 px。
//    只按整幅画面取景的话，最左边那件器材永远躲在箱子后面 ——
//    所以可用宽度要扣掉这一段，再把桌子在画面上整体往右推半个被挡宽度。
const KIT_PX = 210;
function kitFrac() {
  const cw = Math.max(620, canvas.clientWidth || 1200);
  return Math.min(0.26, KIT_PX / cw);
}
function fitFrame(pitch, k) {
  const fovV = (camera.fov * Math.PI) / 180;
  const f = kitFrac();
  // 🔴 spanW 必须 ≥ 整张桌面宽度：器材是铺满桌面排的，只框 74% 的话最右那件
  //    一定出画（实测「电流表被裁掉一半」）。这里取 1.04 留一点点呼吸边。
  const spanW = (DESK.w * 1.04) / Math.max(0.5, 1 - f);
  const spanH = Math.max(420, DESK.d * Math.sin(Math.max(0.12, pitch)) + 340);
  const dW = (spanW / 2) / (Math.tan(fovV / 2) * Math.max(0.45, camera.aspect));
  const dH = (spanH / 2) / Math.tan(fovV / 2);
  return {
    dist: Math.max(dW, dH) * 1.02 * (k || 1),
    tx: -DESK.w * f * 0.72,
  };
}
function applyView(name) {
  const v = VIEWS[name] || VIEWS.persp;
  state.view = name;
  const fr = fitFrame(v.pitch, v.k);
  cam.yawT = v.yaw; cam.pitchT = v.pitch;
  cam.distT = fr.dist;
  cam.targetT.set(fr.tx + (v.target[0] || 0), v.target[1], v.target[2]);
  document.querySelectorAll('.tb-funcs [data-view]').forEach((b) => {
    b.classList.toggle('on', b.dataset.view === name);
  });
}
// 桌面长大 / 画幅变化 ⇒ 当前视角重新取一次景（不跳视角，只拉远）
function fitToDesk() {
  const v = VIEWS[state.view] || VIEWS.persp;
  const fr = fitFrame(v.pitch, v.k);
  cam.distT = fr.dist;
  cam.targetT.x = fr.tx + (v.target[0] || 0);
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
const items = [];          // { id, api, type, group, el, Rmax }
let itemSeq = 0;

const BUILDERS = {
  rheostat: buildRheostat, switch: buildSwitch, battery: buildBattery, bulb: buildBulb,
  ammeter: () => buildMeter({ kind: 'ammeter' }),
  voltmeter: () => buildMeter({ kind: 'voltmeter' }),
  storage: buildStorageBattery,
  resistor: () => buildResistor({ R: 10 }),
  power: buildPower,
  resistancebox: buildResistanceBox,
  rheoboard: buildRheoboard,
  led: () => buildLed({ color: 'red' }),
  joule: buildJoule,
  calorimeter: buildCalorimeter,
  potentiometer: buildPotentiometer,
};
// 🔴 卡片键（key）≠ 物理类型（type）：蓄电池、干电池组在 circuit-core 里都是
//    `battery`，但外观完全不同 ⇒ 器材库按 key 建卡片、求解按 type 认元件。
const META = {};
CATALOG.forEach((c) => { META[c.key || c.type] = c; });
const metaOf = (it) => META[it.key || it.type] || META[it.type] || { label: it.type };

// ── 有序排布 ──────────────────────────────────────────────────
// 规则：先按器材总宽定桌面宽度，再分行、每行【居中】摆；桌深不够就加长桌子。
// 🔴 旧版是一个从左往右的游标，器材永远贴着桌子左前沿堆 ⇒ 桌面明明很大，
//    东西却挤在角上。这里每次新增都【整桌重排一遍】，每行按实际总宽居中。
// 🔴 桌面尺寸【跟着内容走】：器材少时是一张普通实验台，器材多了自动变长 ——
//    这才是「无限拓展的实验桌」，而不是一张固定大桌子让器材缩在中间。
// 🔴 用户手动拖过的器材（auto=false）不参与重排，位置归他自己。
const ROW_MAX_W = 2200;      // 一行最多摆这么宽，超了才换行（能一行排开就一行，前后不遮挡）
const ROW_GAP = 58;
function relayoutAuto() {
  const autos = items.filter((it) => it.auto !== false);
  if (!autos.length) return;
  const bs = autos.map((o) => boundsOf(o));
  const totalW = bs.reduce((s, b) => s + b.hw * 2, 0) + ROW_GAP * (autos.length - 1);
  // ① 桌面宽度：装得下就一行摆完，最多 ROW_MAX_W
  const padX = EDGE * 2 + 60;
  resizeDesk(Math.min(ROW_MAX_W, totalW) + padX, DESK.d);
  // ② 分组
  const rows = [];
  let row = [], rowW = 0;
  const usable = placeArea().x * 2;
  autos.forEach((o, i) => {
    const w = bs[i].hw * 2;
    if (row.length && rowW + ROW_GAP + w > usable) {
      rows.push({ items: row, w: rowW, i0: i - row.length, bs: bs.slice(i - row.length, i) });
      row = []; rowW = 0;
    }
    if (row.length) rowW += ROW_GAP;
    row.push(o); rowW += w;
  });
  if (row.length) rows.push({ items: row, w: rowW, i0: autos.length - row.length, bs: bs.slice(autos.length - row.length) });
  // ③ 桌深：行高之和 + 边距
  const need = rows.reduce((s, r) => s + Math.max(...r.bs.map((b) => b.hd)) * 2 + ROW_GAP, 0) + EDGE * 2 + 100;
  resizeDesk(DESK.w, need);
  // ④ 逐行居中摆（居中就好 —— 「避开器材箱」由相机 target 负责，见 fitFrame 的 tx：
  //    器材和桌面同中心，取景按桌面算就一定装得下，不会出现「偏右那件被裁掉」）
  const a = placeArea();
  let z = a.zFront;
  rows.forEach((r) => {
    const maxHd = Math.max(...r.bs.map((b) => b.hd));
    let cx = -r.w / 2;
    r.items.forEach((o, i) => {
      const b = r.bs[i];
      // 夹进桌面：右移让位后，最右那件可能压到桌沿外（自检 onTable 会红）
      const lim = limitOf(o);
      o.group.position.x = Math.max(-lim.x, Math.min(lim.x, cx + b.hw));
      o.group.position.z = z - maxHd;
      cx += b.hw * 2 + ROW_GAP;
      refreshWiresFor(o);
    });
    z -= maxHd * 2 + ROW_GAP;
  });
}

// 器材「变宽」以后可能压到邻居身上（电池 2 节→3 节）：
// 先沿 x 找最近的空位，x 满了再往后一行，都不行就把桌子加大。只挪自己，不动别人。
function nudgeIfOverlap(item) {
  if (!item) return false;
  const b = boundsOf(item);
  const hit = (x, z) => items.some((it) => {
    if (it === item) return false;
    const o = boundsOf(it);
    return Math.abs(x - it.group.position.x) < b.hw + o.hw + 10 &&
           Math.abs(z - it.group.position.z) < b.hd + o.hd + 10;
  });
  const x0 = item.group.position.x, z0 = item.group.position.z;
  if (!hit(x0, z0)) return false;
  let lim = limitOf(item);
  for (let d = 20; d <= lim.x * 2; d += 20) {
    for (const sx of [1, -1]) {
      const x = x0 + sx * d;
      if (Math.abs(x) > lim.x) continue;
      if (!hit(x, z0)) {
        item.group.position.x = x;
        refreshWiresFor(item);
        toast('器材变宽了，给它挪了个位置');
        return true;
      }
    }
  }
  for (let d = 20; d <= DESK.d; d += 20) {
    const z = z0 - d;
    if (z < -lim.z) break;
    if (!hit(x0, z)) {
      item.group.position.z = z;
      refreshWiresFor(item);
      toast('器材变宽了，给它挪了个位置');
      return true;
    }
  }
  // 桌面实在挤不下 ⇒ 加长桌面，再整桌重排一遍
  if (resizeDesk(DESK.w + DESK_STEP * 2, DESK.d + DESK_STEP)) {
    relayoutAuto();
    refreshWiresFor(item);
    toast('桌面加长了，给器材腾出位置');
    return true;
  }
  return false;
}

function addItem(key, worldPos) {
  const meta = META[key] || META[BUILDERS[key] ? key : ''];
  const build = (meta && meta.build) || BUILDERS[key] || (meta && BUILDERS[meta.type]);
  if (!build) { toast('这件器材还在开发中'); return null; }
  const api = build();
  const physType = (meta && meta.type) || key;
  const g = api.group;
  // 器材统一缩放：1:1 建模时变阻器只有 130 mm，放在 1680 mm 的桌上只剩一小截；
  // 放大 2.2 倍又显得「桌子小、元件大」。KIT_SCALE 取中间值，比例才对得上真实实验台。
  g.scale.setScalar(KIT_SCALE);
  scene.add(g);

  itemSeq += 1;
  // 拖放过来的器材位置由用户定（auto=false，不参与自动重排）；点卡片放的由 relayoutAuto 摆。
  const item = { id: 'c' + itemSeq, api, type: physType, key, group: g, el: null, Rmax: 20,
    scale: KIT_SCALE, auto: !worldPos };
  items.push(item);
  if (worldPos) {
    const lim = limitOf(item);
    g.position.set(clamp(worldPos.x, -lim.x, lim.x), 0, clamp(worldPos.z, -lim.z, lim.z));
  } else {
    g.position.set(0, 0, 0);
    relayoutAuto();
  }
  buildLabel(item);
  select(item);
  syncUI();
  recompute();
  toast('放上了 ' + (meta ? meta.label : physType));
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
  if (item.tempEl && item.tempEl.parentNode) item.tempEl.parentNode.removeChild(item.tempEl);
  if (state.selected === item) state.selected = null;
  syncUI();
  recompute();
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

const wireMatPrev = new THREE.MeshStandardMaterial({
  color: 0x22d3ee, roughness: 0.4, metalness: 0.2, transparent: true, opacity: 0.7,
});
let previewWire = null;
function showPreview(p1, p2) {
  if (!previewWire) {
    previewWire = new THREE.Mesh(new THREE.BufferGeometry(), wireMatPrev);
    previewWire.visible = false;
    scene.add(previewWire);
  }
  if (previewWire.geometry) previewWire.geometry.dispose();
  previewWire.geometry = wireGeoFor(p1, p2, 1);
  previewWire.visible = true;
}
function hidePreview() { if (previewWire) previewWire.visible = false; }

function termWorld(item, term) {
  const v = item.api.termLocal[term].clone();
  item.group.localToWorld(v);
  return v;
}

// ── 导线几何 ──────────────────────────────────────────────────
// 🔴🔴 真导线是【软的】：从接线柱顶端出来，往下一沉就贴在桌面上，
//    在桌面上自然绕一道弯，再爬上另一个柱子。旧版把中点往上抬
//    「34 + 距离×0.16」，两根柱之间架起一道拱桥 —— 那是硬铁丝，不是导线。
//    现在的走法（全程不高于柱顶，绝大部分贴着桌面）：
//        柱顶 → 垂直引出 6~14 mm → 落到桌面 3.4 mm → 桌面弧线 → 爬上另一柱
const WIRE_R = 3.0;
const WIRE_G = 5.6;           // 桌面段离台面的高度（≈ 导线半径 ×1.9：
                              // CatmullRom 在两端会下冲一点，抬到 5.6 才不会陷进台面）
function wireGeoFor(p1, p2, side) {
  const d = p1.distanceTo(p2);
  const lift = Math.min(13, 5 + d * 0.035);
  const q1 = p1.clone(); q1.y += lift;
  const q2 = p2.clone(); q2.y += lift;
  const a1 = new THREE.Vector3(p1.x, WIRE_G, p1.z);
  const a2 = new THREE.Vector3(p2.x, WIRE_G, p2.z);
  // 桌面段向【连线的一侧】弯出去：同一件器材的两个柱在前缘，导线就绕过它前面走，
  // 不会从器材身上穿过去。
  const dx = a2.x - a1.x, dz = a2.z - a1.z;
  const len = Math.hypot(dx, dz) || 1;
  const bend = Math.min(84, 12 + len * 0.2) * (side < 0 ? -1 : 1);
  const mid = new THREE.Vector3(
    (a1.x + a2.x) / 2 - (dz / len) * bend,
    WIRE_G + Math.min(9, 2 + len * 0.02),          // 中段微微离桌一点，像有自重
    (a1.z + a2.z) / 2 + (dx / len) * bend
  );
  const curve = new THREE.CatmullRomCurve3([p1, q1, a1, mid, a2, q2, p2], false, 'catmullrom', 0.4);
  return new THREE.TubeGeometry(curve, 72, WIRE_R, 10, false);
}

function addWire(a, b) {
  wireSeq += 1;
  const side = wireSeq % 2 ? 1 : -1;      // 相邻导线往两侧弯，不会叠成一条
  const mesh = new THREE.Mesh(wireGeoFor(termWorld(a.item, a.term), termWorld(b.item, b.term), side), wireMat);
  mesh.userData.wireId = wireSeq;
  scene.add(mesh);
  wires.push({ id: wireSeq, a, b, mesh, side });
  syncUI();
  recompute();
  toast(a.term + ' → ' + b.term + ' 接上了');
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
  recompute();
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
      w.mesh.geometry = wireGeoFor(termWorld(w.a.item, w.a.term), termWorld(w.b.item, w.b.term), w.side);
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
//  电路求解：与「电路实验沙盒」用【同一份内核】
// ------------------------------------------------------------
// 这一页只换了元件外观，物理必须一模一样：元件 id + 类型 + 参数 + 端子下标
// 交给 circuit-core 的 solve()，读数、短路、接法判断全部由它算。
// 元件的位置（x/y/rot）在求解里只用来算端子几何，而拓扑 union 只认
// 「compId:termIdx」，所以这里给 0 不影响结果。
// ============================================================
const CORE = window.CircuitCore || null;
let results = null;

function paramsOf(it) {
  if (it.type === 'rheostat') return { Rmax: it.Rmax, slide: it.api.getSlide() };
  if (it.type === 'switch') return { closed: it.api.isClosed() };
  if (it.type === 'battery') return it.api.getParams();
  if (it.type === 'bulb') return it.api.getParams();
  if (it.type === 'ammeter' || it.type === 'voltmeter') return it.api.getParams();
  if (it.type === 'resistor') return it.api.getParams();
  if (it.type === 'power') return it.api.getParams();
  if (it.type === 'resistancebox' || it.type === 'rheoboard' || it.type === 'led' ||
      it.type === 'joule' || it.type === 'calorimeter' || it.type === 'potentiometer') {
    return it.api.getParams();
  }
  return {};
}
function termIdxOf(it, term) {
  return (it.api.termIdx && it.api.termIdx[term] != null) ? it.api.termIdx[term] : 0;
}

function recompute() {
  if (!CORE) return;
  const comps = items.map((it) => ({
    id: it.id, type: it.type, x: 0, y: 0, rot: 0, params: paramsOf(it),
  }));
  const wd = wires.map((w) => ({
    a: { compId: w.a.item.id, termIdx: termIdxOf(w.a.item, w.a.term) },
    b: { compId: w.b.item.id, termIdx: termIdxOf(w.b.item, w.b.term) },
  }));
  try {
    results = CORE.solve(comps, wd, {});
  } catch (e) {
    results = null;
    console.error('[lab3d] solve failed', e);
  }
  // 把求解结果推给会「发光」的器材。灯泡的亮度、灯丝温度、过载全部来自
  // circuit-core 的 fillLamp（rec.brightness / rec.tempC / rec.overload），
  // 3D 这一层只负责把它画成光，不自己算任何电学量。
  items.forEach((it) => {
    const rec = results && results.components ? results.components[it.id] : null;
    if (it.type === 'bulb' && it.api.setLit) it.api.setLit(rec);
    if ((it.type === 'ammeter' || it.type === 'voltmeter') && it.api.setReading) {
      it.api.setReading(rec);
    }
    if (it.type === 'led' && it.api.setLit) it.api.setLit(rec);
    if (it.type === 'calorimeter' && it.api.setTemp) it.api.setTemp(rec);
    if (it.type === 'joule' && it.api.setBox && rec && rec.boxes) {
      it.api.setBox(0, rec.boxes[0]);
      it.api.setBox(1, rec.boxes[1]);
    }
  });
  syncResultsUI();
}

// 拖动滑片时每帧都会变 —— 用一帧一次的节流，别让求解排队
let recomputeQueued = false;
function scheduleRecompute() {
  if (recomputeQueued) return;
  recomputeQueued = true;
  requestAnimationFrame(() => { recomputeQueued = false; recompute(); });
}

const fmtV = (v) => {
  if (v == null || !isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a < 1e-4) return '0';
  if (a < 0.01) return v.toFixed(4);
  if (a < 1) return v.toFixed(3);
  if (a < 10) return v.toFixed(2);
  return v.toFixed(1);
};

function syncResultsUI() {
  const body = $('recBody');
  const pill = $('circPill');
  const warn = $('warnBox');
  if (!body) return;

  if (!items.length) {
    body.innerHTML = '<tr><td class="empty" colspan="4">桌上还没有器材</td></tr>';
    pill.textContent = '空桌'; pill.className = 'pill';
    warn.innerHTML = '';
    return;
  }

  let maxI = 0;
  const rows = items.map((it) => {
    const r = results && results.components ? results.components[it.id] : null;
    const label = metaOf(it).label;
    const i = r ? Math.abs(r.i || 0) : null;
    if (i != null) maxI = Math.max(maxI, i);
    return '<tr><td>' + label + '</td>' +
      '<td>' + (r ? fmtV(i) : '—') + '</td>' +
      '<td>' + (r ? fmtV(Math.abs(r.v || 0)) : '—') + '</td>' +
      '<td>' + (r ? fmtV(Math.abs(r.p || 0)) : '—') + '</td></tr>';
  });
  body.innerHTML = rows.join('');

  const ws = (results && results.warnings) || [];
  if (ws.length) {
    pill.textContent = ws[0].code === 'SHORT_CIRCUIT' ? '短路！' : '注意';
    pill.className = 'pill bad';
    warn.innerHTML = '<p class="note bad">' + ws.map((w) => w.message).join('；') + '</p>';
  } else if (maxI > 1e-6) {
    pill.textContent = '通路';
    pill.className = 'pill ok';
    warn.innerHTML = '';
  } else {
    pill.textContent = items.some((it) => it.type === 'battery') ? '断路' : '未成回路';
    pill.className = 'pill warn';
    warn.innerHTML = '';
  }

  // 读数卡统一由 syncReadout 负责（它也要读 results，两份逻辑会打架）
  syncReadout();
}

// ============================================================
//  标签（DOM 投影）
// ============================================================
const labelLayer = $('labels');
function buildLabel(item) {
  const el = document.createElement('div');
  el.className = 'plabel';
  el.textContent = metaOf(item).label;
  labelLayer.appendChild(el);
  item.el = el;
  // 灯泡多一块「灯丝温度」浮标：默认不显示，参数面板里勾上才出现。
  // 位置在名称标签【上方】—— 和 2D 沙盒「灯泡上方温度牌」是同一个约定。
  if (item.type === 'bulb') {
    const t = document.createElement('div');
    t.className = 'plabel temp off';
    t.textContent = '20 ℃';
    labelLayer.appendChild(t);
    item.tempEl = t;
  }
}
function updateLabels() {
  const rect = canvas.getBoundingClientRect();
  const W = rect.width, H = rect.height;
  items.forEach((item) => {
    if (!item.el) return;
    if (!state.labels) { item.el.classList.add('off'); return; }
    // 标签高度按器材自己的 topY（表、焦耳演示器比小器材高得多），再乘器材缩放
    const ly = ((item.api && item.api.topY) || 190) * (item.scale || 1);
    const p = new THREE.Vector3(item.group.position.x, ly, item.group.position.z).project(camera);
    if (p.z > 1 || p.z < -1) { item.el.classList.add('off'); return; }
    const x = (p.x * 0.5 + 0.5) * W;
    const y = (-p.y * 0.5 + 0.5) * H;
    if (x < -40 || x > W + 40 || y < -20 || y > H + 20) { item.el.classList.add('off'); return; }
    item.el.classList.remove('off');
    item.el.style.transform = 'translate(-50%,-50%) translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
    item.el.classList.toggle('sel', state.selected === item);

    if (item.tempEl) {
      const show = !!(item.api && item.api.showTemp);
      if (!show) { item.tempEl.classList.add('off'); }
      else {
        item.tempEl.classList.remove('off');
        const tc = item.api.getTempC ? item.api.getTempC() : 20;
        item.tempEl.textContent = Math.round(tc) + ' ℃';
        // 灯丝越热越白，浮标底色跟着走一点，学生能看出「温度」和「亮」是一回事
        const hot = Math.min(1, Math.max(0, (tc - 20) / 2000));
        item.tempEl.style.color = 'rgb(' + Math.round(165 + 90 * hot) + ',' +
          Math.round(243 - 60 * hot) + ',' + Math.round(252 - 40 * hot) + ')';
        item.tempEl.style.transform = 'translate(-50%,-50%) translate(' + x.toFixed(1) + 'px,' +
          (y - 21).toFixed(1) + 'px)';
      }
    }
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
  if (hit && hit.term) {
    // 按在接线柱上 = 直接「拉一根线」出来（松手落在另一个柱上就接上）
    drag.mode = 'wire';
    drag.from = { item: hit.item, term: hit.term };
    drag.hover = null;
    pendingMark.position.copy(termWorld(hit.item, hit.term)).add(new THREE.Vector3(0, 7, 0));
    pendingMark.visible = true;
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

  if (drag.mode === 'wire') {
    const from = termWorld(drag.from.item, drag.from.term);
    const h2 = pick(e.clientX, e.clientY);
    let end = null;
    if (h2 && h2.term && !(h2.item === drag.from.item && h2.term === drag.from.term)) {
      end = termWorld(h2.item, h2.term);
      drag.hover = { item: h2.item, term: h2.term };
    } else {
      drag.hover = null;
      // 没落在柱上就跟着鼠标走：射线打在与起点等高的水平面上
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -from.y);
      setRay(e.clientX, e.clientY);
      const p = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(plane, p)) end = p;
    }
    if (end) showPreview(from, end);
    return;
  }
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
      const lim = limitOf(drag.item);
      drag.item.group.position.x = clamp(p.x + drag.offX, -lim.x, lim.x);
      drag.item.group.position.z = clamp(p.z + drag.offZ, -lim.z, lim.z);
      refreshWiresFor(drag.item);
    }
    return;
  }
  if (drag.mode === 'slide' && drag.item) {
    const t = drag.slide0 + (e.clientX - drag.startX) / drag.pxPer;
    drag.item.api.setSlide(clamp(t, 0, 1));
    // 只刷数值，不重建面板：syncUI() 会重建 range 控件，拖拽过程中重建等于把它换掉
    refreshParams();
    scheduleRecompute();
  }
});

canvas.addEventListener('pointerup', (e) => {
  canvas.classList.remove('grabbing');
  // 用户亲手拖过的器材就归他摆：之后新增器材不再把它重排走
  if (drag && drag.item && drag.moved >= 6) drag.item.auto = false;
  if (drag && drag.mode === 'wire') {
    const from = drag.from;
    const h2 = pick(e.clientX, e.clientY);
    const onOther = h2 && h2.term && !(h2.item === from.item && h2.term === from.term);
    hidePreview();
    if (onOther) {
      addWire(from, { item: h2.item, term: h2.term });
      cancelPending();
    } else if (drag.moved < 6 && h2 && h2.term) {
      // 原地点一下 = 走「点两次」那条老路（先选柱、再点另一个柱）
      select(from.item); selectWire(null);
      handleTermClick(h2);
    } else {
      cancelPending();
      if (drag.moved >= 6) toast('要接在接线柱上 —— 拖到另一个柱再松手');
    }
    drag = null;
    return;
  }
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
      recompute();
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
  // 🔴 dt 上限放到 0.1：软件渲染/低端机上一帧可能 300 ms，clamp 到 0.05 会让
  //    所有缓动（开关刀片）比真实时间慢好几倍 —— 看着像「点了没反应」。
  const dt = Math.min(0.1, (t - lastT) / 1000 || 0.016);
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
  ammeter: '<svg viewBox="0 0 44 32"><g stroke="#334155" stroke-width="1.5" fill="none">' +
    '<rect x="7" y="4" width="30" height="24" rx="3" fill="#f1f5f9"/>' +
    '<path d="M22 23l8-11" stroke="#b91c1c" stroke-width="2" stroke-linecap="round"/>' +
    '<circle cx="22" cy="23" r="1.8" fill="#334155" stroke="none"/>' +
    '<path d="M13 9q9-5 18 0" stroke="#94a3b8"/>' +
    '<text x="22" y="20" font-size="7" font-weight="700" fill="#334155" stroke="none" text-anchor="middle">A</text></g></svg>',
  voltmeter: '<svg viewBox="0 0 44 32"><g stroke="#334155" stroke-width="1.5" fill="none">' +
    '<rect x="7" y="4" width="30" height="24" rx="3" fill="#f1f5f9"/>' +
    '<path d="M22 23l8-11" stroke="#b91c1c" stroke-width="2" stroke-linecap="round"/>' +
    '<circle cx="22" cy="23" r="1.8" fill="#334155" stroke="none"/>' +
    '<path d="M13 9q9-5 18 0" stroke="#94a3b8"/>' +
    '<text x="22" y="20" font-size="7" font-weight="700" fill="#334155" stroke="none" text-anchor="middle">V</text></g></svg>',
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
    b.dataset.key = c.key || c.type;
    b.innerHTML =
      '<span class="ic">' + (ICONS[c.key || c.type] || ICONS[c.type] || '') + '</span>' +
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
  const meta = META[card.dataset.key];
  if (!meta || !meta.ready) {
    toast(meta ? meta.label + ' 还在开发中' : '这件器材还没做');
    return;
  }
  cardDrag = { key: card.dataset.key, x: e.clientX, y: e.clientY, moved: 0, ghost: null };
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
    g.innerHTML = '<span class="nm">' + META[cardDrag.key].label + '</span>';
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
    addItem(d.key, p ? { x: p.x, z: p.z } : null);
  } else {
    addItem(d.key, null);
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

  // ── 电池：节数（外观与电动势一起变）────────────────────────
  if (it.type === 'battery') {
    pSlideEl = pSlideOut = pRmaxEl = pRmaxOut = null;
    const n = it.api.getCells();
    pSel.innerHTML =
      '<div class="lab3d-field">' +
        '<label for="pBatCells">电池节数 <output id="pBatOut">' + n + ' 节 · ' + it.api.emf().toFixed(1) + ' V</output></label>' +
        '<input id="pBatCells" type="range" min="1" max="3" step="1" value="' + n + '">' +
        '<small>每节 <b>1.5 V</b>：一节 1.5 V、两节 3 V、三节 4.5 V。' +
        '电池盒会跟着变长，读数按总电动势重算。</small>' +
      '</div>' +
      '<div class="lab3d-btnrow">' +
        '<button type="button" id="pRotate">⟳ 转 90°</button>' +
        '<button type="button" id="pRemove">🗑 从桌上拿走</button>' +
      '</div>' +
      '<small style="display:block;margin-top:8px;color:#64748b;font-size:10px;line-height:1.55">' +
        '左端<b>红柱是正极</b>、右端银柱是负极 —— 接反了电流方向相反（电表会反偏）。</small>';
    if (!it.api.setCells) {
      // 蓄电池：节数定死 3 节（2 V/节），面板只显示、不给滑条
      $('pBatCells').disabled = true;
      $('pBatCells').style.opacity = 0.45;
    }
    $('pBatCells').addEventListener('input', (e) => {
      if (!it.api.setCells) return;
      it.api.setCells(+e.target.value);
      nudgeIfOverlap(it);
      const o = $('pBatOut');
      if (o) o.textContent = it.api.getCells() + ' 节 · ' + it.api.emf().toFixed(1) + ' V';
      recompute();
      syncReadout();
    });
    $('pRotate').addEventListener('click', rotateSelected);
    $('pRemove').addEventListener('click', () => removeItem(it));
    return;
  }

  // ── 电阻箱：四个转盘 + 总阻值 ──────────────────────────────
  if (it.type === 'resistancebox') {
    pSlideEl = pSlideOut = pRmaxEl = pRmaxOut = null;
    const DIG = [['d1000', '×1 k'], ['d100', '×100'], ['d10', '×10'], ['d1', '×1']];
    pSel.innerHTML =
      '<div class="lab3d-field">' +
        '<label>转盘 <output id="pRBoxOut">' + it.api.getR() + ' Ω</output></label>' +
        DIG.map(([k, lab]) =>
          '<label for="pRBox_' + k + '" style="margin-top:6px">' + lab +
            ' <output id="pRBoxV_' + k + '">' + it.api[k] + '</output></label>' +
          '<input id="pRBox_' + k + '" type="range" min="0" max="9" step="1" value="' + it.api[k] + '">'
        ).join('') +
        '<small>R = 千位×1000 + 百位×100 + 十位×10 + 个位 —— 和真电阻箱一样<b>跳档</b>，' +
        '刻度上直接读得出接入的阻值。</small>' +
      '</div>' +
      '<div class="lab3d-btnrow">' +
        '<button type="button" id="pRotate">⟳ 转 90°</button>' +
        '<button type="button" id="pRemove">🗑 从桌上拿走</button>' +
      '</div>';
    DIG.forEach(([k]) => {
      $('pRBox_' + k).addEventListener('input', (e) => {
        it.api.setDigit(k, +e.target.value);
        $('pRBoxV_' + k).textContent = it.api[k];
        $('pRBoxOut').textContent = it.api.getR() + ' Ω';
        recompute(); syncReadout();
      });
    });
    $('pRotate').addEventListener('click', rotateSelected);
    $('pRemove').addEventListener('click', () => removeItem(it));
    return;
  }

  // ── 导线电阻演示板：四根丝的规格 ────────────────────────────
  if (it.type === 'rheoboard') {
    pSlideEl = pSlideOut = pRmaxEl = pRmaxOut = null;
    pSel.innerHTML =
      '<div class="lab3d-field">' +
        '<label>板上四根电阻丝</label>' +
        '<div style="font-size:11px;line-height:1.9;color:#cbd5e1">' +
          RBOARD_WIRES.map((w, i) =>
            '<div><b>' + w.id + '</b>　' + w.spec +
            '　<button type="button" class="mini" data-wire="' + (i + 1) + 'a">接这根</button></div>'
          ).join('') +
        '</div>' +
        '<small>每根丝两头各一个接线柱（' + '<b>1a/1b</b> … <b>4a/4b</b>）。' +
        '换一根只要把两根导线挪到另一对柱子上 —— 「只变一个因素」就是一次接线动作。</small>' +
      '</div>' +
      '<div class="lab3d-btnrow">' +
        '<button type="button" id="pRotate">⟳ 转 90°</button>' +
        '<button type="button" id="pRemove">🗑 从桌上拿走</button>' +
      '</div>';
    pSel.querySelectorAll('[data-wire]').forEach((b) => {
      b.addEventListener('click', () => {
        toast('把导线接到 ' + b.dataset.wire + ' 柱上就能换成这根丝');
      });
    });
    $('pRotate').addEventListener('click', rotateSelected);
    $('pRemove').addEventListener('click', () => removeItem(it));
    return;
  }

  // ── 发光二极管：颜色 + 极性 ────────────────────────────────
  if (it.type === 'led') {
    pSlideEl = pSlideOut = pRmaxEl = pRmaxOut = null;
    const COLS = [['red', '红色 1.8V'], ['green', '绿色 2.1V'], ['blue', '蓝色 3.1V']];
    pSel.innerHTML =
      '<div class="lab3d-field">' +
        '<label>颜色</label>' +
        '<div class="lab3d-presets" style="grid-template-columns:repeat(3,1fr)">' +
          COLS.map(([c, lab]) =>
            '<button type="button" data-led="' + c + '"' +
            (it.api.color === c ? ' class="on"' : '') + '>' + lab + '</button>').join('') +
        '</div>' +
        '<label class="chk" style="margin-top:8px"><input id="pLedFlip" type="checkbox"' +
          (it.api.flip ? ' checked' : '') + '><span>引脚接反（长脚接 −）</span></label>' +
        '<small>二极管<b>只让电流单向通过</b>：从长脚（+）进才导通、才发光；' +
        '接反了几乎不导电，灯不亮 —— 这正是它和灯泡最要紧的区别。</small>' +
      '</div>' +
      '<div class="lab3d-btnrow">' +
        '<button type="button" id="pRotate">⟳ 转 90°</button>' +
        '<button type="button" id="pRemove">🗑 从桌上拿走</button>' +
      '</div>';
    pSel.querySelectorAll('[data-led]').forEach((b) => {
      b.addEventListener('click', () => {
        it.api.setColor(b.dataset.led);
        buildParams(); recompute(); syncReadout();
      });
    });
    $('pLedFlip').addEventListener('change', (e) => {
      it.api.flip = e.target.checked;
      recompute(); syncReadout();
    });
    $('pRotate').addEventListener('click', rotateSelected);
    $('pRemove').addEventListener('click', () => removeItem(it));
    return;
  }

  // ── 焦耳定律演示器：两只瓶的电阻 + 乙的并联丝 ────────────────
  if (it.type === 'joule') {
    pSlideEl = pSlideOut = pRmaxEl = pRmaxOut = null;
    const SEL = (k, lab, opts, cur) =>
      '<div class="lab3d-field"><label>' + lab + '</label>' +
      '<div class="lab3d-presets" style="grid-template-columns:repeat(' + opts.length + ',1fr)">' +
      opts.map((o) => '<button type="button" data-j="' + k + '" data-v="' + o[0] + '"' +
        (cur === o[0] ? ' class="on"' : '') + '>' + o[1] + '</button>').join('') +
      '</div></div>';
    pSel.innerHTML =
      SEL('R1', '甲 电阻', [[5, '5Ω'], [10, '10Ω'], [20, '20Ω']], it.api.R1) +
      SEL('R2', '乙 电阻', [[5, '5Ω'], [10, '10Ω'], [20, '20Ω']], it.api.R2) +
      SEL('R2b', '乙 并联丝', [[0, '不装'], [5, '5Ω'], [10, '10Ω'], [20, '20Ω']], it.api.R2b) +
      '<div class="lab3d-field"><small>接 <b>甲+/甲−</b>、<b>乙+/乙−</b> 两组柱。' +
      '通电后电阻丝放热，U 形管里的液柱被顶高 —— <b>谁升得快，谁产热多</b>。' +
      '把两只瓶的电阻调成一样、再看液柱，就能反过来验「Q 与 R 无关、只与 I²Rt 有关」。</small></div>' +
      '<div class="lab3d-btnrow">' +
        '<button type="button" id="pJouleReset">↺ 液柱归零</button>' +
        '<button type="button" id="pRemove">🗑 从桌上拿走</button>' +
      '</div>';
    pSel.querySelectorAll('[data-j]').forEach((b) => {
      b.addEventListener('click', () => {
        it.api[b.dataset.j] = +b.dataset.v;
        buildParams(); recompute(); syncReadout();
      });
    });
    $('pJouleReset').addEventListener('click', () => { it.api.resetHeat(); });
    $('pRemove').addEventListener('click', () => removeItem(it));
    return;
  }

  // ── 电热瓶：瓶里那段丝的阻值 ────────────────────────────────
  if (it.type === 'calorimeter') {
    pSlideEl = pSlideOut = pRmaxEl = pRmaxOut = null;
    pSel.innerHTML =
      '<div class="lab3d-field">' +
        '<label for="pCalR">电阻丝 <output id="pCalOut">' + it.api.R + ' Ω</output></label>' +
        '<input id="pCalR" type="range" min="1" max="50" step="1" value="' + it.api.R + '">' +
        '<small>瓶里的液体种类和质量是器材定死的，学生要变的是「换一段不同阻值的丝」。' +
        '通电后温度计升到多少度，就是这段丝放出的热。</small>' +
      '</div>' +
      '<div class="lab3d-btnrow">' +
        '<button type="button" id="pRotate">⟳ 转 90°</button>' +
        '<button type="button" id="pRemove">🗑 从桌上拿走</button>' +
      '</div>';
    $('pCalR').addEventListener('input', (e) => {
      it.api.setR(+e.target.value);
      $('pCalOut').textContent = it.api.R + ' Ω';
      recompute(); syncReadout();
    });
    $('pRotate').addEventListener('click', rotateSelected);
    $('pRemove').addEventListener('click', () => removeItem(it));
    return;
  }

  // ── 电位器：最大阻值 + 滑片位置 ────────────────────────────
  if (it.type === 'potentiometer') {
    pSlideEl = pSlideOut = pRmaxEl = pRmaxOut = null;
    const rab = (it.api.Rmax * it.api.pos).toFixed(1);
    const rbc = (it.api.Rmax * (1 - it.api.pos)).toFixed(1);
    pSel.innerHTML =
      '<div class="lab3d-field">' +
        '<label for="pPotR">最大阻值 <output id="pPotROut">' + it.api.Rmax + ' Ω</output></label>' +
        '<input id="pPotR" type="range" min="5" max="50" step="5" value="' + it.api.Rmax + '">' +
      '</div>' +
      '<div class="lab3d-field">' +
        '<label for="pPotP">滑片位置 <output id="pPotPOut">' + Math.round(it.api.pos * 100) + '%</output></label>' +
        '<input id="pPotP" type="range" min="0" max="1" step="0.01" value="' + it.api.pos + '">' +
        '<small>此刻 <b>a—b = ' + rab + ' Ω</b>、<b>b—c = ' + rbc + ' Ω</b>（两段之和恒等于 R<sub>max</sub>）。' +
        '接 a、b 两柱就是一个可调电阻；三柱全接就是分压器。</small>' +
      '</div>' +
      '<div class="lab3d-btnrow">' +
        '<button type="button" id="pRotate">⟳ 转 90°</button>' +
        '<button type="button" id="pRemove">🗑 从桌上拿走</button>' +
      '</div>';
    $('pPotR').addEventListener('input', (e) => {
      it.api.setRmax(+e.target.value);
      buildParams(); recompute(); syncReadout();
    });
    $('pPotP').addEventListener('input', (e) => {
      it.api.setPos(+e.target.value);
      const p = it.api.pos;
      $('pPotPOut').textContent = Math.round(p * 100) + '%';
      const small = pSel.querySelector('small');
      if (small) small.innerHTML = '此刻 <b>a—b = ' + (it.api.Rmax * p).toFixed(1) +
        ' Ω</b>、<b>b—c = ' + (it.api.Rmax * (1 - p)).toFixed(1) + ' Ω</b>（两段之和恒等于 R<sub>max</sub>）。' +
        '接 a、b 两柱就是一个可调电阻；三柱全接就是分压器。';
      recompute(); syncReadout();
    });
    $('pRotate').addEventListener('click', rotateSelected);
    $('pRemove').addEventListener('click', () => removeItem(it));
    return;
  }

  // ── 定值电阻：常用阻值 + 滑条 ──────────────────────────────
  if (it.type === 'resistor') {
    pSlideEl = pSlideOut = pRmaxEl = pRmaxOut = null;
    const PRES = [5, 10, 15, 20, 25];
    pSel.innerHTML =
      '<div class="lab3d-field">' +
        '<label>常用阻值</label>' +
        '<div class="lab3d-presets" style="grid-template-columns:repeat(5,1fr)">' +
          PRES.map((v) => '<button type="button" data-r="' + v + '">' + v + 'Ω</button>').join('') +
        '</div>' +
      '</div>' +
      '<div class="lab3d-field">' +
        '<label for="pResR">阻值 <output id="pResOut">' + it.api.R.toFixed(1) + ' Ω</output></label>' +
        '<input id="pResR" type="range" min="0.1" max="100" step="0.1" value="' + it.api.R + '">' +
        '<small>接 <b>a、b</b> 两柱。定值电阻的阻值不随温度、电压变 —— 正是「欧姆定律」里那个 R。</small>' +
      '</div>' +
      '<div class="lab3d-btnrow">' +
        '<button type="button" id="pRotate">⟳ 转 90°</button>' +
        '<button type="button" id="pRemove">🗑 从桌上拿走</button>' +
      '</div>';
    pSel.querySelectorAll('[data-r]').forEach((b) => {
      b.addEventListener('click', () => {
        it.api.setR(+b.dataset.r);
        buildParams(); recompute(); syncReadout();
      });
    });
    $('pResR').addEventListener('input', (e) => {
      it.api.setR(+e.target.value);
      $('pResOut').textContent = it.api.R.toFixed(1) + ' Ω';
      recompute(); syncReadout();
    });
    $('pRotate').addEventListener('click', rotateSelected);
    $('pRemove').addEventListener('click', () => removeItem(it));
    return;
  }

  // ── 学生电源：输出电压 0~9 V + 电源开关 ────────────────────
  if (it.type === 'power') {
    pSlideEl = pSlideOut = pRmaxEl = pRmaxOut = null;
    pSel.innerHTML =
      '<div class="lab3d-field">' +
        '<label for="pPwrV">输出电压 <output id="pPwrOut">' + it.api.emf.toFixed(1) + ' V</output></label>' +
        '<input id="pPwrV" type="range" min="0" max="9" step="0.5" value="' + it.api.emf + '">' +
        '<small>旋钮转到哪儿，输出就是多少伏（<b>0~9 V</b>，每格 0.5 V）。' +
        '真实的学生电源还有限流旋钮，这里只留调压。</small>' +
      '</div>' +
      '<div class="lab3d-field">' +
        '<label class="chk"><input id="pPwrOn" type="checkbox"' + (it.api.on ? ' checked' : '') + '>' +
          '<span>电源开关合上（有输出）</span></label>' +
      '</div>' +
      '<div class="lab3d-btnrow">' +
        '<button type="button" id="pRotate">⟳ 转 90°</button>' +
        '<button type="button" id="pRemove">🗑 从桌上拿走</button>' +
      '</div>';
    $('pPwrV').addEventListener('input', (e) => {
      it.api.setEmf(+e.target.value);
      $('pPwrOut').textContent = it.api.emf.toFixed(1) + ' V';
      recompute(); syncReadout();
    });
    $('pPwrOn').addEventListener('change', (e) => {
      it.api.setOn(e.target.checked);
      recompute(); syncReadout();
    });
    $('pRotate').addEventListener('click', rotateSelected);
    $('pRemove').addEventListener('click', () => removeItem(it));
    return;
  }

  // ── 电流表 / 电压表：量程由「接在哪个红柱」决定，这里只显示 + 调零 + 示数
  if (it.type === 'ammeter' || it.type === 'voltmeter') {
    pSlideEl = pSlideOut = pRmaxEl = pRmaxOut = null;
    const isA = it.type === 'ammeter';
    const rec = results && results.components ? results.components[it.id] : null;
    const rng = rec && rec.rangeWired ? rec.range : it.api.range;
    const unit = isA ? 'A' : 'V';
    const reading = rec && rec.wired ? (rec.reading || 0) : 0;
    const taps = isA ? ['0.6', '3'] : ['3', '15'];
    pSel.innerHTML =
      '<div class="lab3d-field">' +
        '<label>当前量程 <output>' + (rec && rec.rangeWired ? rng + ' ' + unit : '未接量程柱') + '</output></label>' +
        '<small>量程由<b>导线接在哪个红柱</b>决定：接 <b>' + taps[0] + '</b> 柱是 0～' + taps[0] +
        ' ' + unit + '，接 <b>' + taps[1] + '</b> 柱是 0～' + taps[1] + ' ' + unit +
        '。黑柱是公共端（' + (isA ? '电流从红柱进、黑柱出' : '并联在被测元件两端') + '）。</small>' +
      '</div>' +
      '<div class="lab3d-field">' +
        '<label class="chk"><input id="pMeterZero" type="checkbox"' + (it.api.zeroed ? ' checked' : '') + '>' +
          '<span>已调零（指针在零刻度线上）</span></label>' +
        '<label class="chk"><input id="pMeterValue" type="checkbox"' + (it.api.showValue ? ' checked' : '') + '>' +
          '<span>在表盘上显示读数</span></label>' +
        '<small>读数 = <b>' + (rec && rec.wired ? (Math.abs(reading) < 5e-4 ? '0' : reading.toFixed(3)) : '—') +
        ' ' + unit + '</b>' +
        (rec && rec.reversed ? ' · <b style="color:#fca5a5">正负接线柱接反，指针顶在左边</b>' : '') +
        (rec && rec.overRange ? ' · <b style="color:#fca5a5">超过量程</b>' : '') +
        '</small>' +
      '</div>' +
      '<div class="lab3d-btnrow">' +
        '<button type="button" id="pRotate">⟳ 转 90°</button>' +
        '<button type="button" id="pRemove">🗑 从桌上拿走</button>' +
      '</div>';
    $('pMeterZero').addEventListener('change', (e) => {
      it.api.zeroed = e.target.checked;
      recompute(); syncReadout();
    });
    $('pMeterValue').addEventListener('change', (e) => {
      it.api.setShowValue(e.target.checked);
    });
    $('pRotate').addEventListener('click', rotateSelected);
    $('pRemove').addEventListener('click', () => removeItem(it));
    return;
  }

  // ── 灯泡：额定电压 / 额定功率 / 灯丝温度两项开关 ────────────
  // 规格与 2D「电路实验沙盒」的 PARAM_UI.bulb 一一对应（含三个常用规格按钮）。
  if (it.type === 'bulb') {
    pSlideEl = pSlideOut = pRmaxEl = pRmaxOut = null;
    const PRESETS = [
      { v: 2.5, w: 0.75, t: '2.5V / 0.75W（0.3A）—— 实验室最常见的那只' },
      { v: 3.8, w: 1.1, t: '3.8V / 1.1W（0.3A）—— 手电筒灯泡' },
      { v: 1.5, w: 0.3, t: '1.5V / 0.3W（0.2A）—— 一节干电池就能点亮的小电珠' },
    ];
    const presetHtml = PRESETS.map((p) =>
      '<button type="button" data-bv="' + p.v + '" data-bw="' + p.w + '" title="' + p.t + '">' +
        p.v.toFixed(1) + 'V<small>' + p.w.toFixed(2) + 'W</small></button>').join('');
    pSel.innerHTML =
      '<div class="lab3d-field">' +
        '<label>常用规格</label>' +
        '<div class="lab3d-presets">' + presetHtml + '</div>' +
      '</div>' +
      '<div class="lab3d-field">' +
        '<label for="pBulbV">额定电压 <output id="pBulbVOut">' + it.api.ratedV.toFixed(1) + ' V</output></label>' +
        '<input id="pBulbV" type="range" min="1.5" max="6" step="0.1" value="' + it.api.ratedV + '">' +
      '</div>' +
      '<div class="lab3d-field">' +
        '<label for="pBulbW">额定功率 <output id="pBulbWOut">' + it.api.ratedW.toFixed(2) + ' W</output></label>' +
        '<input id="pBulbW" type="range" min="0.2" max="3" step="0.1" value="' + it.api.ratedW + '">' +
      '</div>' +
      '<div class="lab3d-field">' +
        '<label class="chk"><input id="pBulbTemp" type="checkbox"' + (it.api.tempDependent ? ' checked' : '') + '>' +
          '<span>灯丝电阻随温度升高而增大</span></label>' +
        '<label class="chk"><input id="pBulbShowT" type="checkbox"' + (it.api.showTemp ? ' checked' : '') + '>' +
          '<span>在灯泡上方显示灯丝温度</span></label>' +
        '<small>额定电阻 = U<sub>额</sub>²/P<sub>额</sub>；勾上第一项后，灯丝越热电阻越大，' +
        '实际功率就达不到「U²/R」算出来的那个值 —— 这正是真灯泡和定值电阻的区别。</small>' +
      '</div>' +
      '<div class="lab3d-btnrow">' +
        '<button type="button" id="pRotate">⟳ 转 90°</button>' +
        '<button type="button" id="pRemove">🗑 从桌上拿走</button>' +
      '</div>';

    const applyPreset = (v, w) => {
      it.api.setRated(v, w);
      buildParams();          // 重画面板（滑条位置要跟着跳）
      recompute();
      syncReadout();
    };
    pSel.querySelectorAll('[data-bv]').forEach((b) => {
      b.addEventListener('click', () => applyPreset(+b.dataset.bv, +b.dataset.bw));
    });
    $('pBulbV').addEventListener('input', (e) => {
      it.api.setRated(+e.target.value, null);
      $('pBulbVOut').textContent = it.api.ratedV.toFixed(1) + ' V';
      recompute(); syncReadout();
    });
    $('pBulbW').addEventListener('input', (e) => {
      it.api.setRated(null, +e.target.value);
      $('pBulbWOut').textContent = it.api.ratedW.toFixed(2) + ' W';
      recompute(); syncReadout();
    });
    $('pBulbTemp').addEventListener('change', (e) => {
      it.api.tempDependent = e.target.checked;
      recompute(); syncReadout();
    });
    $('pBulbShowT').addEventListener('change', (e) => {
      it.api.showTemp = e.target.checked;
      updateLabels(); syncReadout();
    });
    $('pRotate').addEventListener('click', rotateSelected);
    $('pRemove').addEventListener('click', () => removeItem(it));
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
        '接上电池组就是一个真回路，读数在右侧。</small>';
    $('pSwToggle').addEventListener('click', () => {
      it.api.toggle();
      buildParams();
      recompute();
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
    scheduleRecompute();
  });
  pRmaxEl.addEventListener('input', (e) => {
    if (!state.selected) return;
    state.selected.Rmax = +e.target.value;
    refreshParams();
    scheduleRecompute();
  });
  $('pRotate').addEventListener('click', rotateSelected);
  $('pRemove').addEventListener('click', () => removeItem(state.selected));
}

function refreshParams() {
  const it = state.selected;
  if (it && it.type === 'battery') {
    const o = $('pBatOut');
    if (o) o.textContent = it.api.getCells() + ' 节 · ' + it.api.emf().toFixed(1) + ' V';
    syncReadout();
    syncCtl();
    return;
  }
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
  // 🔴 读数卡的三条分支必须【互斥且齐全】：漏一个 type，非变阻器就会掉进
  //    `it.api.previewR` 里 —— 那台器材没有这个方法，整页在 addItem 里就崩了。
  const r = results && results.components ? results.components[it.id] : null;
  const cur = r ? ' · I = ' + fmtV(Math.abs(r.i || 0)) + ' A' : '';
  if (it.type === 'switch') {
    const closed = it.api.isClosed();
    $('roR').innerHTML = closed ? '通<small>路</small>' : '断<small>路</small>';
    $('roSub').innerHTML = '开关' + (closed ? '<b>已合上</b>' : '<b>已抬起</b>') +
      ' · 导线 ' + wires.length + ' 根' + cur;
    return;
  }
  if (it.type === 'battery') {
    $('roR').innerHTML = it.api.emf().toFixed(1) + '<small>V</small>';
    $('roSub').innerHTML = it.api.getCells() + ' 节 × 1.5 V' + cur;
    return;
  }
  if (it.type === 'resistancebox') {
    const r = results && results.components ? results.components[it.id] : null;
    $('roR').innerHTML = it.api.getR() + '<small>Ω</small>';
    $('roSub').innerHTML = '电阻箱' + (r ? ' · I = ' + fmtV(Math.abs(r.i || 0)) + ' A' : '');
    return;
  }
  if (it.type === 'rheoboard') {
    const r = results && results.components ? results.components[it.id] : null;
    $('roR').innerHTML = '4<small>根丝</small>';
    $('roSub').innerHTML = '电阻示教板' + (r ? ' · I = ' + fmtV(Math.abs(r.i || 0)) + ' A' : ' · 选一对柱子接入');
    return;
  }
  if (it.type === 'led') {
    const r = results && results.components ? results.components[it.id] : null;
    const on = it.api.getBrightness() > 0.05;
    $('roR').innerHTML = on ? '导<small>通</small>' : '截<small>止</small>';
    $('roSub').innerHTML = '发光二极管 · ' +
      ({ red: '红 1.8V', green: '绿 2.1V', blue: '蓝 3.1V' })[it.api.color] +
      (r ? ' · I = ' + fmtV(Math.abs(r.i || 0)) + ' A' : '') +
      (r && r.overload ? ' · <b style="color:#fca5a5">电流过大</b>' : '');
    return;
  }
  if (it.type === 'joule') {
    const r = results && results.components ? results.components[it.id] : null;
    const p0 = r && r.boxes ? r.boxes[0].p : 0;
    const p1 = r && r.boxes ? r.boxes[1].p : 0;
    $('roR').innerHTML = fmtV(p0 + p1) + '<small>W</small>';
    $('roSub').innerHTML = '甲 ' + fmtV(p0) + ' W · 乙 ' + fmtV(p1) + ' W';
    return;
  }
  if (it.type === 'calorimeter') {
    const r = results && results.components ? results.components[it.id] : null;
    $('roR').innerHTML = Math.round(it.api.getTemp()) + '<small>℃</small>';
    $('roSub').innerHTML = '电热瓶 · ' + it.api.R + ' Ω' +
      (r ? ' · P = ' + fmtV(Math.abs(r.p || 0)) + ' W' : '');
    return;
  }
  if (it.type === 'potentiometer') {
    const r = results && results.components ? results.components[it.id] : null;
    $('roR').innerHTML = (it.api.Rmax * it.api.pos).toFixed(1) + '<small>Ω</small>';
    $('roSub').innerHTML = 'a—b 段 · b—c = ' + (it.api.Rmax * (1 - it.api.pos)).toFixed(1) + ' Ω' +
      (r ? ' · I = ' + fmtV(Math.abs(r.i || 0)) + ' A' : '');
    return;
  }
  if (it.type === 'resistor') {
    const r = results && results.components ? results.components[it.id] : null;
    $('roR').innerHTML = it.api.R.toFixed(1) + '<small>Ω</small>';
    $('roSub').innerHTML = '定值电阻' + (r ? ' · I = ' + fmtV(Math.abs(r.i || 0)) + ' A' : '');
    return;
  }
  if (it.type === 'power') {
    const r = results && results.components ? results.components[it.id] : null;
    $('roR').innerHTML = it.api.emf.toFixed(1) + '<small>V</small>';
    $('roSub').innerHTML = '学生电源' + (it.api.on ? '' : ' · <b>开关断开</b>') +
      (r ? ' · I = ' + fmtV(Math.abs(r.i || 0)) + ' A' : '');
    return;
  }
  if (it.type === 'ammeter' || it.type === 'voltmeter') {
    const isA = it.type === 'ammeter';
    const unit = isA ? 'A' : 'V';
    const rec = results && results.components ? results.components[it.id] : null;
    const v = rec && rec.wired ? (rec.reading || 0) : 0;
    $('roR').innerHTML = (Math.abs(v) < 5e-4 ? '0' : v.toFixed(2)) + '<small>' + unit + '</small>';
    const bits = [];
    if (rec && rec.rangeWired) bits.push('量程 0～' + rec.range + ' ' + unit);
    else bits.push('未接量程柱');
    if (rec && rec.reversed) bits.push('<b style="color:#fca5a5">接反</b>');
    if (rec && rec.overRange) bits.push('<b style="color:#fca5a5">超量程</b>');
    $('roSub').innerHTML = bits.join(' · ');
    return;
  }
  if (it.type === 'bulb') {
    const br = it.api.getBrightness();
    const tc = it.api.getTempC();
    // 主读数给「实际功率占额定的比例」，因为那才是学生看到的「多亮」；
    // 电流放在副行，和读数表里那一行对得上。
    $('roR').innerHTML = (br * 100).toFixed(0) + '<small>% 亮度</small>';
    $('roSub').innerHTML = '灯丝 <b>' + Math.round(tc) + ' ℃</b>' +
      (r ? ' · I = ' + fmtV(Math.abs(r.i || 0)) + ' A' : '') +
      (it.api.isOverload() ? ' · <b style="color:#fca5a5">超过额定功率</b>' : '');
    return;
  }
  if (it.type === 'rheostat') {
    const rr = it.api.previewR(it.Rmax);
    $('roR').innerHTML = rr.toFixed(1) + '<small>Ω</small>';
    $('roSub').innerHTML = '滑片 <b>' + Math.round(it.api.getSlide() * 100) + '%</b>' +
      (cur || ' · 按 A—C 接法预演');
    return;
  }
  $('roR').innerHTML = '—';
  $('roSub').textContent = metaOf(it).label;
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
  scheduleRecompute();
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

// 器材箱开合（器材箱在舞台内部 ⇒ 全屏里也能开合）
function setKitOpen(on) {
  const box = $('kitbox'), op = $('kitOpen'), btn = $('btnKit');
  if (!box) return;
  box.classList.toggle('hide', !on);
  if (op) op.classList.toggle('show', !on);
  if (btn) btn.classList.toggle('on', on);
  layout();
}
$('btnKit').addEventListener('click', () => setKitOpen($('kitbox').classList.contains('hide')));
$('kitFold').addEventListener('click', () => setKitOpen(false));
$('kitOpen').addEventListener('click', () => setKitOpen(true));
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
  // 🔴 立刻两次：headless / 软件渲染下 rAF 与 setTimeout 都可能被主线程拖到很晚，
  //    只靠「晚一帧 + 兜底」实测只跑到 1 次（全屏判据要求 ≥2）。
  // 全屏 / 退出全屏 ⇒ aspect 变了，按新画幅重新取一次景（否则桌面会出画或缩成一小块）
  fsLayout();
  applyView(state.view);
  fsLayout();
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
window.addEventListener('resize', () => {
  layout();
  // 画幅一变（手机竖屏 ↔ 桌面横屏、拉窗口）就重新取景：桌面必须始终铺满画面
  fitToDesk();
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
  addItem, removeItem, clearAll, select, rotateSelected, recompute, relayoutAuto,
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
  // ── 求解结果（自检用）──────────────────────────────────
  solveInfo() {
    if (!results) return null;
    return {
      status: results.status,
      warnings: (results.warnings || []).map((w) => w.code),
      comps: Object.keys(results.components || {}).map((id) => {
        const r = results.components[id];
        return {
          id, type: (items.find((it) => it.id === id) || {}).type,
          i: +(r.i || 0).toFixed(4), v: +(r.v || 0).toFixed(4), p: +(r.p || 0).toFixed(4),
          emf: r.emf, cells: r.cells, mode: r.mode, rUsed: r.rUsed,
          // 下面这些是「只读给自检」的字段：不补的话，焦耳演示器的两瓶功率、
          // 量热瓶的温度、表头的读数在探针里全是 undefined（断言会静默空转）。
          reading: r.reading, range: r.range, rangeWired: r.rangeWired,
          reversed: r.reversed, overRange: r.overRange, wired: r.wired,
          temp: r.temp, brightness: r.brightness, tempC: r.tempC, overload: r.overload,
          boxes: r.boxes ? r.boxes.map((b2) => ({
            idx: b2.idx, R: b2.R, i: +(b2.i || 0).toFixed(4),
            p: +(b2.p || 0).toFixed(4), wired: b2.wired,
          })) : undefined,
          levels: r.levels,
        };
      }),
    };
  },
  recomputeNow() { recompute(); return true; },
  setCells(i, n) {
    const it = items[i || 0];
    if (!it || !it.api.setCells) return null;
    it.api.setCells(n);
    nudgeIfOverlap(it);
    recompute(); syncUI();
    return it.api.getCells();
  },
  // 器材之间的 AABB 重叠对数（自检判「摆放不穿模」）
  overlaps() {
    const out = [];
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i], c = items[j];
        const ba = boundsOf(a), bc = boundsOf(c);
        const dx = Math.abs(a.group.position.x - c.group.position.x);
        const dz = Math.abs(a.group.position.z - c.group.position.z);
        if (dx < ba.hw + bc.hw && dz < ba.hd + bc.hd) {
          out.push({ a: i, b: j, dx: +dx.toFixed(1), dz: +dz.toFixed(1),
                     needX: +(ba.hw + bc.hw).toFixed(1), needZ: +(ba.hd + bc.hd).toFixed(1) });
        }
      }
    }
    return out;
  },
  // 器材外缘是否都在桌面内（桌面会随器材长大，判据用当前 DESK）
  onTable() {
    return items.map((it) => {
      const b = boundsOf(it);
      return {
        type: it.type,
        overX: +(Math.abs(it.group.position.x) + b.hw - DESK.w / 2).toFixed(1),
        overZ: +(Math.abs(it.group.position.z) + b.hd - DESK.d / 2).toFixed(1),
      };
    });
  },
  get desk() { return { w: DESK.w, d: DESK.d, minW: DESK_MIN.w, minD: DESK_MIN.d }; },
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
  // ── 零件几何（按 kit 里打的 role 取世界包围盒）────────────────
  // 🔴 判「位置对不对」必须量【世界包围盒】，不能看代码里的 translate 参数：
  //    挤出几何的 y 起点是 0 还是 depth 全靠 rotateX 之后才知道，肉眼看代码最容易错一遍。
  partsGeom(i) {
    const it = items[i || 0];
    if (!it) return null;
    it.group.updateWorldMatrix(true, true);
    const out = {};
    it.group.traverse((o) => {
      if (!o.isMesh || !o.userData.role) return;
      const b = new THREE.Box3().setFromObject(o);
      const sz = b.getSize(new THREE.Vector3());
      const rec = {
        min: [+b.min.x.toFixed(1), +b.min.y.toFixed(1), +b.min.z.toFixed(1)],
        max: [+b.max.x.toFixed(1), +b.max.y.toFixed(1), +b.max.z.toFixed(1)],
        size: [+sz.x.toFixed(1), +sz.y.toFixed(1), +sz.z.toFixed(1)],
      };
      const r = o.userData.role;
      // 同名多件（电池、夹环）收成数组
      if (!out[r]) out[r] = rec;
      else if (Array.isArray(out[r])) out[r].push(rec);
      else out[r] = [out[r], rec];
    });
    return out;
  },
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
    const lim = limitOf(it);
    it.group.position.x = clamp(x, -lim.x, lim.x);
    it.group.position.z = clamp(z, -lim.z, lim.z);
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
  // 🔴 只算名称标签：灯泡还多一块「灯丝温度」浮标（.plabel.temp），
  //    混在一起会让「删了器材标签数应回到 0」这类断言莫名其妙多 1。
  tempLabels() {
    return [...labelLayer.querySelectorAll('.plabel.temp')].map((el) => {
      const r = el.getBoundingClientRect();
      return { text: el.textContent, off: el.classList.contains('off'), x: r.x, y: r.y };
    });
  },
  updateLabelsNow() { updateLabels(); return true; },
  labels() {
    return [...labelLayer.querySelectorAll('.plabel:not(.temp)')].map((el) => {
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
