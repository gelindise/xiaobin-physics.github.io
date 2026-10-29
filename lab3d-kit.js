/*!
 * lab3d-kit.js —— 电学沙盒 3D 的器材库（可扩展）
 * ============================================================
 * 一份「器材建模」只写在这里，页面（电学沙盒3D.html）只负责场景、摆放与交互。
 * 以后加新器材：在本文件里加一个 buildXxx()，在它的导出表 CATALOG 里加一行，
 * 页面不用改（器材库面板按 CATALOG 自动生成卡片）。
 *
 * 约定（所有器材都遵守，页面才能统一处理拖动 / 选中 / 删除）：
 *   · buildXxx() 返回 { group, type, label, spec, bounds, parts, ...api }
 *   · group 的【局部原点在底面中心】：y=0 就是桌面，页面只改 group.position.x / z
 *   · bounds = { hw, hd }（半宽 / 半深，mm，已含缩放）用于拖动夹取与点选包围盒
 *   · 尺寸单位 mm（1 世界单位 = 1 mm），滑动变阻器按 1:1 建模后整体放大 SCALE 倍
 *     —— 真实变阻器只有 130 mm 长，1:1 放在 1200 mm 的桌面上在屏幕上只剩几十像素，
 *        放大后相当于一只「大号变阻器」，看得清接线柱和绕线。
 *
 * 几何与 `滑动变阻器3D拆解.html` 同源（人教版 16.4-2 插图那副外观）：
 * 瓷筒 φ32×100、绕线 100 匝、细滑杆 φ3.5、蓝灰薄板支架、滚花接线柱、前表面长弹片。
 * 🔴 两边若改尺寸要一起改：那页是「解剖台」，这页是「器材」，零件分组的写法不同，
 *    但外形尺寸必须一致，否则同一个器材在两个页面长得不一样。
 */
import * as THREE from './assets/optics-three.min.js';

// ============================================================
//  尺寸（mm）
// ============================================================
export const DIM = {
  TUBE_R: 16, TUBE_L: 100, TUBE_IN: 11.6,
  WIND_R: 16.42, WIRE_R: 0.36, TURNS: 100,
  WIRE_X0: -40, WIRE_X1: 40,
  ROD_Y: 34, ROD_R: 1.75, ROD_L: 116,
  HOLD_X: 54, TERM_X: 42, BASE_Y: -47,
  CONTACT_Z: 16.42 + 0.36 + 0.8,
  SLIDE_MIN: -38, SLIDE_MAX: 38,
  SCALE: 2.2,
};

// ============================================================
//  材质（共享：同一种材质被所有实例复用，改颜色会一起改，别在交互里改）
// ============================================================
export const MAT = {
  ceramic: new THREE.MeshStandardMaterial({ color: 0xece9e1, roughness: 0.58, metalness: 0.04, side: THREE.DoubleSide }),
  ceramicIn: new THREE.MeshStandardMaterial({ color: 0xb9b4a8, roughness: 0.86, metalness: 0.02, side: THREE.BackSide }),
  wire: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 0.72 }),
  steel: new THREE.MeshStandardMaterial({ color: 0xd7dfe8, roughness: 0.2, metalness: 0.9 }),
  brass: new THREE.MeshStandardMaterial({ color: 0xd7ab52, roughness: 0.28, metalness: 0.82 }),
  frame: new THREE.MeshStandardMaterial({ color: 0x8ea8c3, roughness: 0.36, metalness: 0.56 }),
  frameEdge: new THREE.MeshStandardMaterial({ color: 0x627c99, roughness: 0.42, metalness: 0.62 }),
  endMetal: new THREE.MeshStandardMaterial({ color: 0xdfe6ed, roughness: 0.28, metalness: 0.64 }),
  plastic: new THREE.MeshStandardMaterial({ color: 0x26354a, roughness: 0.58, metalness: 0.18 }),
  plasticSoft: new THREE.MeshStandardMaterial({ color: 0x9db3ca, roughness: 0.38, metalness: 0.28 }),
  base: new THREE.MeshStandardMaterial({ color: 0x7189a3, roughness: 0.48, metalness: 0.48 }),
  red: new THREE.MeshStandardMaterial({ color: 0xc83b32, roughness: 0.42, metalness: 0.08 }),
  black: new THREE.MeshStandardMaterial({ color: 0x151b24, roughness: 0.55, metalness: 0.25 }),
  copper: new THREE.MeshStandardMaterial({ color: 0xb66a2e, roughness: 0.32, metalness: 0.78 }),
};

// 接入段高亮色（选中器材时：从 A 端到滑片那一段 = 此刻接进电路的部分）
const COL_ON = new THREE.Color(0xff7a2f);
const COL_OFF = new THREE.Color(0x7b8494);

// ============================================================
//  几何缓存（多实例共享：支架 / 滚花旋钮这类形状只建一次）
// ============================================================
const GEO = {};

function knurledGeometry(radius, length) {
  const key = 'knurl' + radius + '_' + length;
  if (GEO[key]) return GEO[key];
  const geo = new THREE.CylinderGeometry(radius * 0.97, radius, length, 48, 2, false);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const r = Math.hypot(x, z);
    if (r < radius * 0.65) continue;
    const a = Math.atan2(z, x);
    const k = 1 + 0.055 * Math.cos(a * 24);
    p.setXYZ(i, x * k, p.getY(i), z * k);
  }
  geo.computeVertexNormals();
  GEO[key] = geo;
  return geo;
}

function bracketGeometry() {
  if (GEO.bracket) return GEO.bracket;
  // Shape 的横坐标是 z、纵坐标是 y；挤出后转成垂直于瓷筒轴的薄板。
  const s = new THREE.Shape();
  s.moveTo(-5, 43);
  s.quadraticCurveTo(0, 48, 5, 43);
  s.lineTo(8, 30);
  s.quadraticCurveTo(10, 23, 11, 15);
  s.lineTo(12, 7);
  s.quadraticCurveTo(13, -2, 10, -13);
  s.lineTo(8, -26);
  s.lineTo(20, -44);
  s.quadraticCurveTo(22, -47, 18, -47);
  s.lineTo(-19, -47);
  s.quadraticCurveTo(-23, -47, -20, -43);
  s.lineTo(-9, -27);
  s.lineTo(-12, -9);
  s.quadraticCurveTo(-14, 0, -12, 12);
  s.lineTo(-9, 30);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 4.2, bevelEnabled: true, bevelThickness: 0.65,
    bevelSize: 0.65, bevelSegments: 2, curveSegments: 16,
  });
  geo.translate(0, 0, -2.1);
  geo.rotateY(Math.PI / 2);
  GEO.bracket = geo;
  return geo;
}

// 绕线：每实例一份（要按 slide 改顶点色，共享会互相污染）
class Helix extends THREE.Curve {
  constructor() { super(); }
  getPoint(t, target = new THREE.Vector3()) {
    const a = t * DIM.TURNS * Math.PI * 2;
    return target.set(
      DIM.WIRE_X0 + (DIM.WIRE_X1 - DIM.WIRE_X0) * t,
      DIM.WIND_R * Math.cos(a),
      DIM.WIND_R * Math.sin(a)
    );
  }
}
const HELIX = new Helix();
const WIRE_SEG = DIM.TURNS * 12;
const WIRE_RADIAL = 10;

// ============================================================
//  桌面接触阴影（一块径向渐变暗斑，纯观感）
// ============================================================
let SHADOW_TEX = null;
function shadowTexture() {
  if (SHADOW_TEX) return SHADOW_TEX;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  const rg = g.createRadialGradient(128, 128, 8, 128, 128, 126);
  rg.addColorStop(0, 'rgba(0,0,0,.55)');
  rg.addColorStop(0.5, 'rgba(0,0,0,.26)');
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 256, 256);
  SHADOW_TEX = new THREE.CanvasTexture(cv);
  return SHADOW_TEX;
}

// ============================================================
//  滑动变阻器
// ============================================================
export function buildRheostat(opts) {
  opts = opts || {};
  const S = DIM.SCALE;
  const outer = new THREE.Group();
  const inner = new THREE.Group();
  inner.scale.setScalar(S);
  inner.position.y = -DIM.BASE_Y * S;     // 底脚落在 y=0（桌面）
  outer.add(inner);

  const slider = new THREE.Group();
  inner.add(slider);

  // ── 两只独立底脚（教材图没有整块公共底座）──────────────────
  [-1, 1].forEach((sx) => {
    const pad = new THREE.Mesh(new THREE.BoxGeometry(10, 3, 54), MAT.base);
    pad.position.set(sx * DIM.HOLD_X, DIM.BASE_Y - 1.5, 0);
    inner.add(pad);
    [-1, 1].forEach((sz) => {
      const sole = new THREE.Mesh(new THREE.BoxGeometry(10.4, 1.6, 12), MAT.black);
      sole.position.set(sx * DIM.HOLD_X, DIM.BASE_Y - 3.6, sz * 19);
      inner.add(sole);
    });
  });

  // ── 左右蓝灰薄板支架（含银色端部与 A / B 红色滚花柱）────────
  [-1, 1].forEach((side) => {
    const x = side * DIM.HOLD_X;
    const plate = new THREE.Mesh(bracketGeometry(), MAT.frame);
    plate.position.x = x;
    inner.add(plate);

    const boss = new THREE.Mesh(new THREE.CylinderGeometry(9.5, 9.5, 6.2, 40), MAT.frameEdge);
    boss.rotation.z = Math.PI / 2;
    boss.position.set(x, 0, 0);
    inner.add(boss);

    const axle = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.6, 12, 28), MAT.steel);
    axle.rotation.z = Math.PI / 2;
    axle.position.set(x, 0, 0);
    inner.add(axle);

    const topBush = new THREE.Mesh(new THREE.CylinderGeometry(3.8, 3.8, 6.5, 28), MAT.frameEdge);
    topBush.rotation.z = Math.PI / 2;
    topBush.position.set(x, DIM.ROD_Y, 0);
    inner.add(topBush);

    // 两端发亮的银色套圈，绕线从套圈内缘开始
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(DIM.TUBE_R + 0.18, DIM.TUBE_R + 0.18, 10, 64, 1, true), MAT.endMetal);
    band.rotation.z = Math.PI / 2;
    band.position.x = side * 45;
    inner.add(band);
    const bandEdge = new THREE.Mesh(new THREE.TorusGeometry(DIM.TUBE_R + 0.2, 0.32, 8, 64), MAT.steel);
    bandEdge.rotation.y = Math.PI / 2;
    bandEdge.position.x = side * 40;
    inner.add(bandEdge);

    // A / B 接线柱：金属焊片 + 铜柱 + 垫圈 + 红色滚花旋钮
    const term = side < 0 ? 'A' : 'B';
    const tx = side * DIM.TERM_X;
    const lug = new THREE.Mesh(new THREE.BoxGeometry(7, 6, 2.2), MAT.steel);
    lug.position.set(tx, -3, 16.5);
    lug.userData.termId = term;
    inner.add(lug);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 8, 24), MAT.brass);
    stem.rotation.x = Math.PI / 2;
    stem.position.set(tx, -3, 19.5);
    inner.add(stem);
    const washer = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 1.5, 32), MAT.steel);
    washer.rotation.x = Math.PI / 2;
    washer.position.set(tx, -3, 22.3);
    inner.add(washer);
    const cap = new THREE.Mesh(knurledGeometry(4.25, 7.2), MAT.red);
    cap.position.set(tx, -3, 26.6);
    cap.rotation.x = Math.PI / 2;
    cap.userData.termId = term;
    inner.add(cap);
    const slot = new THREE.Mesh(new THREE.BoxGeometry(4.9, 0.65, 0.24), MAT.black);
    slot.position.set(tx, -3, 30.3);
    inner.add(slot);
  });

  // ── 瓷筒（中空陶瓷管）────────────────────────────────────
  const tubeOuter = new THREE.Mesh(
    new THREE.CylinderGeometry(DIM.TUBE_R, DIM.TUBE_R, DIM.TUBE_L, 64, 1, true), MAT.ceramic);
  tubeOuter.rotation.z = Math.PI / 2;
  inner.add(tubeOuter);
  const tubeInner = new THREE.Mesh(
    new THREE.CylinderGeometry(DIM.TUBE_IN, DIM.TUBE_IN, DIM.TUBE_L - 0.4, 48, 1, true), MAT.ceramicIn);
  tubeInner.rotation.z = Math.PI / 2;
  inner.add(tubeInner);
  [-1, 1].forEach((s) => {
    const ring = new THREE.Mesh(new THREE.RingGeometry(DIM.TUBE_IN, DIM.TUBE_R, 48, 1), MAT.ceramic);
    ring.rotation.y = s < 0 ? -Math.PI / 2 : Math.PI / 2;
    ring.position.x = s * (DIM.TUBE_L / 2);
    inner.add(ring);
  });

  // ── 电阻丝（100 匝密绕，顶点色标出「接入段」）──────────────
  const wireGeo = new THREE.TubeGeometry(HELIX, WIRE_SEG, DIM.WIRE_R, WIRE_RADIAL, false);
  const n = wireGeo.attributes.position.count;
  wireGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const wireMesh = new THREE.Mesh(wireGeo, MAT.wire);
  inner.add(wireMesh);

  // 丝两端焊到 A / B 的铜引线
  const lead = (points) => {
    const c = new THREE.CatmullRomCurve3(points);
    const m = new THREE.Mesh(new THREE.TubeGeometry(c, 32, DIM.WIRE_R, 8, false), MAT.copper);
    inner.add(m);
  };
  lead([
    new THREE.Vector3(DIM.WIRE_X0, DIM.WIND_R, 0), new THREE.Vector3(-41.5, 15, 6),
    new THREE.Vector3(-DIM.TERM_X, 5, 15.5), new THREE.Vector3(-DIM.TERM_X, -3, 18),
  ]);
  lead([
    new THREE.Vector3(DIM.WIRE_X1, DIM.WIND_R, 0), new THREE.Vector3(41.5, 15, 6),
    new THREE.Vector3(DIM.TERM_X, 5, 15.5), new THREE.Vector3(DIM.TERM_X, -3, 18),
  ]);

  // ── 细金属滑杆（含 C / D 银色滚花柱）──────────────────────
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(DIM.ROD_R, DIM.ROD_R, DIM.ROD_L, 32), MAT.steel);
  rod.rotation.z = Math.PI / 2;
  rod.position.y = DIM.ROD_Y;
  inner.add(rod);
  [-1, 1].forEach((s) => {
    const term = s < 0 ? 'C' : 'D';
    const washer = new THREE.Mesh(new THREE.CylinderGeometry(4.3, 4.3, 2.2, 32), MAT.steel);
    washer.rotation.z = Math.PI / 2;
    washer.position.set(s * (DIM.ROD_L / 2 + 1.1), DIM.ROD_Y, 0);
    washer.userData.termId = term;
    inner.add(washer);
    const cap = new THREE.Mesh(knurledGeometry(4.15, 7.2), MAT.steel);
    cap.position.set(s * (DIM.ROD_L / 2 + 5.2), DIM.ROD_Y, 0);
    cap.rotation.z = Math.PI / 2;
    cap.userData.termId = term;
    inner.add(cap);
  });

  // ── 滑片（拱形手柄 + 套筒 + 压在线圈前表面的长弹片）─────────
  const hs = new THREE.Shape();
  hs.moveTo(-14, -1.5);
  hs.lineTo(-14, 0);
  hs.quadraticCurveTo(-12, 4.5, 0, 5);
  hs.quadraticCurveTo(12, 4.5, 14, 0);
  hs.lineTo(14, -1.5);
  hs.quadraticCurveTo(0, 1, -14, -1.5);
  hs.closePath();
  const handleGeo = new THREE.ExtrudeGeometry(hs, {
    depth: 16, bevelEnabled: true, bevelThickness: 0.8,
    bevelSize: 0.7, bevelSegments: 3, curveSegments: 20,
  });
  handleGeo.translate(0, 0, -8);
  const handle = new THREE.Mesh(handleGeo, MAT.plasticSoft);
  handle.position.y = DIM.ROD_Y + 3;
  slider.add(handle);

  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.8, 14, 28), MAT.frameEdge);
  sleeve.rotation.z = Math.PI / 2;
  sleeve.position.y = DIM.ROD_Y;
  slider.add(sleeve);
  [-1, 1].forEach((sz) => {
    const clip = new THREE.Mesh(new THREE.BoxGeometry(13, 3.5, 2), MAT.plastic);
    clip.position.set(0, DIM.ROD_Y + 0.5, sz * 4.2);
    slider.add(clip);
  });

  const flatBar = (a, b, width, mat) => {
    const dir = b.clone().sub(a);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, dir.length(), 1.8), mat || MAT.steel);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    slider.add(mesh);
  };
  // 前面：与线圈接通的黄铜触头
  flatBar(new THREE.Vector3(0, DIM.ROD_Y, 0), new THREE.Vector3(0, DIM.ROD_Y - 6, 7));
  flatBar(new THREE.Vector3(0, DIM.ROD_Y - 6, 7), new THREE.Vector3(0, 8, DIM.CONTACT_Z));
  flatBar(new THREE.Vector3(0, 8, DIM.CONTACT_Z), new THREE.Vector3(0, 0, DIM.CONTACT_Z), 8.2);
  const shoe = new THREE.Mesh(new THREE.BoxGeometry(9, 3.6, 2.2), MAT.brass);
  shoe.position.set(0, 0, DIM.CONTACT_Z);
  slider.add(shoe);
  // 背面：导向压簧（绝缘），只负责让滑片夹住瓷筒
  flatBar(new THREE.Vector3(0, DIM.ROD_Y, 0), new THREE.Vector3(0, DIM.ROD_Y - 6, -7));
  flatBar(new THREE.Vector3(0, DIM.ROD_Y - 6, -7), new THREE.Vector3(0, 8, -DIM.CONTACT_Z));
  flatBar(new THREE.Vector3(0, 8, -DIM.CONTACT_Z), new THREE.Vector3(0, 0, -DIM.CONTACT_Z), 8.2, MAT.frameEdge);
  const rear = new THREE.Mesh(new THREE.BoxGeometry(9, 3.6, 2.2), MAT.frameEdge);
  rear.position.set(0, 0, -DIM.CONTACT_Z);
  slider.add(rear);

  // 接触点标记（青色小球 + 光环，朝学生这一侧）
  const contact = new THREE.Mesh(new THREE.SphereGeometry(2.35, 18, 12),
    new THREE.MeshBasicMaterial({ color: 0x67e8f9 }));
  contact.position.set(0, 0, DIM.CONTACT_Z + 1.5);
  slider.add(contact);
  const halo = new THREE.Mesh(new THREE.RingGeometry(4.1, 5.8, 28),
    new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
  halo.position.set(0, 0, DIM.CONTACT_Z + 1.8);
  slider.add(halo);

  // ── 桌面接触阴影 ─────────────────────────────────────────
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(240, 150),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.35;
  shadow.renderOrder = -1;
  outer.add(shadow);

  // ── 滑片位置 → 几何 + 绕线高亮 ───────────────────────────
  const slideX = (s) => DIM.SLIDE_MIN + (DIM.SLIDE_MAX - DIM.SLIDE_MIN) * s;
  let curSlide = 0.5;

  function paintWire(s) {
    const col = wireGeo.attributes.color;
    const arr = col.array;
    for (let i = 0; i <= WIRE_SEG; i++) {
      const t = i / WIRE_SEG;
      const c = (t <= s + 1e-6) ? COL_ON : COL_OFF;
      for (let j = 0; j <= WIRE_RADIAL; j++) {
        const k = (i * (WIRE_RADIAL + 1) + j) * 3;
        arr[k] = c.r; arr[k + 1] = c.g; arr[k + 2] = c.b;
      }
    }
    col.needsUpdate = true;
  }

  function setSlide(s) {
    curSlide = Math.max(0, Math.min(1, s));
    slider.position.x = slideX(curSlide);
    paintWire(curSlide);
  }

  // 器材整体包围盒（mm，已含缩放）：拖动夹取 / 点选都用它
  const bounds = { hw: DIM.HOLD_X * S + 6, hd: 30 * S };

  // 四个接线柱的局部坐标（已含缩放与 y 偏移），后面接导线时直接用
  const termLocal = {
    A: new THREE.Vector3(-DIM.TERM_X * S, (-3 - DIM.BASE_Y) * S, 30.4 * S),
    B: new THREE.Vector3(DIM.TERM_X * S, (-3 - DIM.BASE_Y) * S, 30.4 * S),
    C: new THREE.Vector3(-(DIM.ROD_L / 2 + 8.8) * S, (DIM.ROD_Y - DIM.BASE_Y) * S, 0),
    D: new THREE.Vector3((DIM.ROD_L / 2 + 8.8) * S, (DIM.ROD_Y - DIM.BASE_Y) * S, 0),
  };

  const api = {
    group: outer,
    shadow,
    // 🔴 器材内部还有一层 inner（缩放 SCALE + 抬到底面在 y=0），
    //    outer.localToWorld 拿不到这层变换 ⇒ 必须从 inner 走。
    localToWorld: (v) => inner.localToWorld(v.clone()),
    worldToLocal: (v) => inner.worldToLocal(v.clone()),
    type: 'rheostat',
    label: '滑动变阻器',
    spec: '20 Ω　2 A',
    bounds,
    slider,
    slideX,
    termLocal,
    setSlide,
    getSlide: () => curSlide,
    // 沙盒这一阶段还没有导线：R 只按「一上一下（A—C）」预演，页面要如实标注
    previewR: (Rmax) => Rmax * curSlide,
  };
  setSlide(opts.slide == null ? 0.5 : opts.slide);
  return api;
}

// ============================================================
//  器材目录（器材库面板按这张表生成卡片）
// ============================================================
export const CATALOG = [
  {
    type: 'rheostat',
    label: '滑动变阻器',
    spec: '20 Ω　2 A',
    desc: '一上一下接进电路，拖滑片改变接入的那段电阻丝。',
    build: buildRheostat,
    ready: true,
  },
  { type: 'battery', label: '电池组', spec: '3 V / 6 V', desc: '两只干电池串成的电源盒，正负极在两端。', ready: false },
  { type: 'switch', label: '开关', spec: '单刀单掷', desc: '闸刀式开关，合上就通、断开就断。', ready: false },
  { type: 'bulb', label: '小灯泡', spec: '2.5 V　0.3 A', desc: '带灯座的螺口小灯泡，亮度随电流变。', ready: false },
  { type: 'meter', label: '电流表 / 电压表', spec: '三柱双量程', desc: '两个量程柱 + 一个公共柱，接错会反偏。', ready: false },
];
