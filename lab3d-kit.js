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
  // 闸刀开关的浅蓝灰塑料底座（人教版插图那种颜色）
  basePlate: new THREE.MeshStandardMaterial({ color: 0x8499b2, roughness: 0.5, metalness: 0.14 }),
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
  // 取【滚花柱中心】而不是端面：端面在柱子外面，射线打上去是空的
  // （症状 = 第二次点接线柱点不上，导线永远建不出来）。
  const termLocal = {
    A: new THREE.Vector3(-DIM.TERM_X * S, (-3 - DIM.BASE_Y) * S, 26.6 * S),
    B: new THREE.Vector3(DIM.TERM_X * S, (-3 - DIM.BASE_Y) * S, 26.6 * S),
    C: new THREE.Vector3(-(DIM.ROD_L / 2 + 5.2) * S, (DIM.ROD_Y - DIM.BASE_Y) * S, 0),
    D: new THREE.Vector3((DIM.ROD_L / 2 + 5.2) * S, (DIM.ROD_Y - DIM.BASE_Y) * S, 0),
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
    termIdx: { A: 0, B: 1, C: 2, D: 3 },   // 与 circuit-core 的 TYPES.rheostat 一致
    setSlide,
    getSlide: () => curSlide,
    // 沙盒这一阶段还没有导线：R 只按「一上一下（A—C）」预演，页面要如实标注
    previewR: (Rmax) => Rmax * curSlide,
  };
  setSlide(opts.slide == null ? 0.5 : opts.slide);
  return api;
}

// ============================================================
//  单刀闸刀开关（人教版 15.2-1 那副外观）
// ------------------------------------------------------------
// 参考图（2D 教材插图）→ 3D 的对应关系：
//   浅蓝灰圆角底座（≈100×56×10 mm）       → 圆角 Shape 挤出 + 倒角
//   左右两只红色滚花接线柱                  → 复用 knurledGeometry（和变阻器同一套滚花）
//   左侧带黄铆钉的竖直刀座                  → 薄金属板 + 铆钉 + 轴
//   刀片 + 末端浅蓝绝缘手柄                 → 一个可绕轴旋转的 Group
//   右侧刀夹（两片，中间留缝）              → 两片金属板夹住刀片
// 闭合 = 刀片水平落进刀夹；断开 = 刀片抬起约 20°（就是参考图那个姿态）。
// ============================================================
export const SW_DIM = {
  BASE_W: 100, BASE_D: 56, BASE_H: 14,
  POST_X: 40, POST_Z: 18, POST_R: 5.5, POST_H: 16,
  PIVOT_X: -34, BLADE_Y: 36, BLADE_LEN: 62,
  CLIP_X: 28, CLIP_H: 42,
  SCALE: 2.8,
};

function roundRectShape(w, d, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -d / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r);
  s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d);
  s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

export function buildSwitch(opts) {
  opts = opts || {};
  const D = SW_DIM;
  const S = D.SCALE;
  const outer = new THREE.Group();
  const inner = new THREE.Group();
  inner.scale.setScalar(S);
  inner.position.y = (D.BASE_H + 1.2) * S;   // 补上倒角厚度，底面才真的落在桌面
  outer.add(inner);

  // ── 底座：圆角矩形挤出，上表面 y=0 ─────────────────────────
  const baseGeo = new THREE.ExtrudeGeometry(roundRectShape(D.BASE_W, D.BASE_D, 9), {
    depth: D.BASE_H, bevelEnabled: true, bevelThickness: 1.2, bevelSize: 1.2,
    bevelSegments: 2, curveSegments: 12,
  });
  baseGeo.rotateX(-Math.PI / 2);
  baseGeo.translate(0, -D.BASE_H, 0);
  const base = new THREE.Mesh(baseGeo, MAT.basePlate);
  inner.add(base);

  // ── 两只红色滚花接线柱（+ 金属垫圈）────────────────────────
  [-1, 1].forEach((sx) => {
    const x = sx * D.POST_X;
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(D.POST_R + 3.4, D.POST_R + 4, 2.4, 28), MAT.steel);
    pad.position.set(x, 1.2, D.POST_Z);
    inner.add(pad);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(D.POST_R * 0.72, D.POST_R * 0.72, 4, 20), MAT.brass);
    stem.position.set(x, 3.4, D.POST_Z);
    inner.add(stem);
    const cap = new THREE.Mesh(knurledGeometry(D.POST_R, D.POST_H), MAT.red);
    cap.position.set(x, 3.4 + D.POST_H / 2, D.POST_Z);
    cap.userData.termId = sx < 0 ? 'A' : 'B';
    inner.add(cap);
    // 柱顶的凹槽（真实接线柱上用来卡导线）
    const slot = new THREE.Mesh(new THREE.BoxGeometry(D.POST_R * 1.1, 0.7, 0.3), MAT.black);
    slot.position.set(x, 3.4 + D.POST_H - 0.3, D.POST_Z + D.POST_R * 0.55);
    inner.add(slot);
  });

  // ── 左刀座（薄金属板 + 黄铆钉 + 轴）────────────────────────
  // 🔴 刀座是【薄板】：正面看到的是 12 宽 × 38 高的板，厚度 4 在 z 方向。
  //    写成 Box(4, 42, 17)（厚 4、宽 17 在 z）从正面看就是一根细线，不像教材图。
  const post = new THREE.Mesh(new THREE.BoxGeometry(12, D.BLADE_Y + 4, 4), MAT.steel);
  post.position.set(D.PIVOT_X, (D.BLADE_Y + 4) / 2, 0);
  inner.add(post);
  const postFoot = new THREE.Mesh(new THREE.BoxGeometry(15, 4, 14), MAT.steel);
  postFoot.position.set(D.PIVOT_X, 2, 0);
  inner.add(postFoot);
  const rivet = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 1.4, 18), MAT.brass);
  rivet.rotation.x = Math.PI / 2;
  rivet.position.set(D.PIVOT_X, D.BLADE_Y - 7, 2.6);
  inner.add(rivet);
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 21, 20), MAT.steel);
  axle.rotation.x = Math.PI / 2;
  axle.position.set(D.PIVOT_X, D.BLADE_Y, 0);
  inner.add(axle);

  // ── 右刀夹：两片金属板，中间留缝（刀片落进来）──────────────
  [-1, 1].forEach((sz) => {
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(12, D.CLIP_H, 2.2), MAT.steel);
    jaw.position.set(D.CLIP_X, D.CLIP_H / 2, sz * 3.4);
    inner.add(jaw);
  });
  const jawFoot = new THREE.Mesh(new THREE.BoxGeometry(11, 3.5, 12), MAT.steel);
  jawFoot.position.set(D.CLIP_X, 1.75, 0);
  inner.add(jawFoot);

  // ── 刀片（可绕轴旋转）：Group 原点就在轴上，几何向 +x 伸 ────
  const pivot = new THREE.Group();
  pivot.position.set(D.PIVOT_X, D.BLADE_Y, 0);
  inner.add(pivot);

  const blade = new THREE.Mesh(new THREE.BoxGeometry(D.BLADE_LEN, 13, 2.8), MAT.steel);
  blade.position.set(D.BLADE_LEN / 2, 0, 0);
  blade.userData.role = 'blade';
  pivot.add(blade);
  // 刀尖收窄（教材图里前端是一小段梯形，这里用两块薄片叠出那个意思）
  const tip = new THREE.Mesh(new THREE.BoxGeometry(8, 10, 2.4), MAT.steel);
  tip.position.set(D.BLADE_LEN - 2, 0, 0);
  pivot.add(tip);

  // 末端绝缘手柄：浅蓝圆柱 + 方形挡圈（参考图那只）
  const handle = new THREE.Group();
  handle.position.set(D.BLADE_LEN + 1, 0, 0);
  pivot.add(handle);
  const collar = new THREE.Mesh(new THREE.BoxGeometry(7, 14, 14), MAT.plasticSoft);
  collar.position.set(3.5, 0, 0);
  handle.add(collar);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.2, 24, 22), MAT.plasticSoft);
  grip.rotation.z = Math.PI / 2;
  grip.position.set(19, 0, 0);
  handle.add(grip);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(5.2, 18, 12), MAT.plasticSoft);
  knob.position.set(31, 0, 0);
  handle.add(knob);

  // ── 桌面接触阴影 ─────────────────────────────────────────
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(270, 180),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.35;
  shadow.renderOrder = -1;
  outer.add(shadow);

  // ── 开合 ────────────────────────────────────────────────
  // 闭合 0 rad（水平落进刀夹）；断开 +0.34 rad（末端抬起，约 19.5°）
  const OPEN = 0.34;
  let closed = opts.closed == null ? false : !!opts.closed;
  let target = closed ? 0 : OPEN;
  let angle = target;

  // 同样取柱身中部（柱顶再往上就是空气了）
  const termLocal = {
    A: new THREE.Vector3(-D.POST_X * S, (3.4 + D.POST_H * 0.55 + D.BASE_H) * S, D.POST_Z * S),
    B: new THREE.Vector3(D.POST_X * S, (3.4 + D.POST_H * 0.55 + D.BASE_H) * S, D.POST_Z * S),
  };

  const api = {
    group: outer,
    shadow,
    localToWorld: (v) => inner.localToWorld(v.clone()),
    worldToLocal: (v) => inner.worldToLocal(v.clone()),
    type: 'switch',
    label: '开关',
    spec: '单刀单掷',
    bounds: { hw: D.BASE_W / 2 * S + 6, hd: D.BASE_D / 2 * S },
    pivot,
    termLocal,
    termIdx: { A: 0, B: 1 },
    setClosed(on) { closed = !!on; target = closed ? 0 : OPEN; },
    toggle() { api.setClosed(!closed); return closed; },
    isClosed: () => closed,
    getAngle: () => angle,
    // 参数面板 / 读数用
    stateText: () => (closed ? '闭合（通路）' : '断开（断路）'),
    // 每帧缓动：刀片落下 / 抬起都带一点惯性，不是瞬移
    step(dt) {
      const k = 1 - Math.pow(0.001, dt);      // 与帧率无关的指数缓动
      angle += (target - angle) * Math.min(1, k * 1.6);
      pivot.rotation.z = angle;
    },
  };
  api.step(0.016);
  return api;
}

// ============================================================
//  干电池组（人教版 15.2 插图那种「塑料托架 + 两节 1 号电池」）
// ------------------------------------------------------------
// 参考图 → 3D：
//   浅蓝灰塑料托架（底板 + 两端高挡板，中间弧形托）  → 圆角挤出 + 弧形托
//   金色圆柱电池（侧面印红色 ⊕）                    → 圆柱 + CanvasTexture 贴片
//   左端红色滚花接线柱 / 右端银色滚花接线柱          → 复用 knurledGeometry
// 节数可调（1~3 节，1.5 V/节）——【外观】跟着节数变长，【电路】只认总电动势。
// 🔴 电动势与内阻走 cells / emfPerCell / rPerCell 三个老键：core 的 battery 分支
//    只要 P.emf 不为空就【忽略 cells】。写 emf 会让「节数」变成纯装饰。
// ============================================================
export const BAT_DIM = {
  R: 17, L: 61,               // 1 号干电池：φ34 × 61
  BOX_H: 9, WALL_T: 6, WALL_H: 48, BOX_D: 44,
  POST_R: 5.5, POST_LEN: 17,
  SCALE: 2.2,
  MAX_CELLS: 3,
};

let PLUS_TEX = null;
function plusTexture() {
  if (PLUS_TEX) return PLUS_TEX;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  g.strokeStyle = '#c0392b';
  g.lineWidth = 11;
  g.beginPath(); g.arc(64, 64, 44, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 12;
  g.beginPath(); g.moveTo(64, 30); g.lineTo(64, 98); g.stroke();
  g.beginPath(); g.moveTo(30, 64); g.lineTo(98, 64); g.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  PLUS_TEX = tex;
  return tex;
}

export function buildBattery(opts) {
  opts = opts || {};
  const D = BAT_DIM;
  const S = D.SCALE;
  const outer = new THREE.Group();
  const inner = new THREE.Group();
  inner.scale.setScalar(S);
  inner.position.y = (D.BOX_H + 1) * S;   // 补上倒角厚度，托架底面才真的落在桌面
  outer.add(inner);

  let cells = Math.max(1, Math.min(D.MAX_CELLS, opts.cells || 2));
  const cellParts = [];                // 每次重建要释放的几何

  const matCell = new THREE.MeshStandardMaterial({
    color: 0xd8a93a, roughness: 0.34, metalness: 0.72,
  });
  const matCellCap = new THREE.MeshStandardMaterial({ color: 0xd9d3c4, roughness: 0.42, metalness: 0.55 });
  const matTray = new THREE.MeshStandardMaterial({ color: 0x8499b2, roughness: 0.5, metalness: 0.14 });

  function disposeCells() {
    cellParts.forEach((o) => {
      inner.remove(o);
      if (o.geometry) o.geometry.dispose();
    });
    cellParts.length = 0;
  }

  function add(o) { inner.add(o); cellParts.push(o); return o; }
  // 给每个零件打角色标记：自检与排障都按角色取包围盒（不看顺序、不看几何类型）
  function tag(o, role) { o.userData.role = role; return o; }

  // ── 整组重建（节数变化时调用）────────────────────────────
  // ── 布局表：所有零件的位置都从这一张表算出来，不再各写各的 magic number ──
  // 竖向（局部 mm，y=0 是【托架顶面】，托架本体在 y ∈ [-BOX_H, 0]）：
  //   y = 0            托架顶面  = 电池底面 = 挡板底面
  //   y = R            电池轴线（φ34 ⇒ R=17）
  //   y ∈ [0, WALL_H]  两端挡板
  //   y = postY        接线柱轴线（挡板 2/3 高处）
  // 横向（x 从中心算，±）：
  //   cellEnd  电池串端面
  //   wallIn   挡板内侧面 / wallOut 挡板外侧面 = 托架外缘
  //   ringX    夹环（压在 cellEnd 上，跨过端面）
  //   seatX    弹簧座（从夹环插进挡板）
  //   stemX    柱身（内端插进挡板、外端接柱帽）
  //   capX     柱帽中心
  // 🔴 凡是「挤出的件」都只允许改 x：ExtrudeGeometry 沿 +z 挤出后 rotateX(-90°)，
  //    y 已经就是 [0, depth]，再 translate 一次 depth 就会整块悬空（电池挡板踩过）。
  function layout(n) {
    const GAP = 2;                                    // 相邻两节之间的缝
    const bodyLen = n * D.L + (n - 1) * GAP;           // 电池串总长
    const trayHalf = bodyLen / 2 + D.WALL_T + 4;       // 托架半长（含两端挡板 + 4 余量）
    return {
      GAP, bodyLen, trayHalf,
      trayLen: trayHalf * 2,
      cellEnd: bodyLen / 2,
      wallOut: trayHalf,
      wallIn: trayHalf - D.WALL_T,
      wallX: trayHalf - D.WALL_T / 2,
      ringX: bodyLen / 2 + 1.4,
      seatX: bodyLen / 2 + 5.2,
      stemX: trayHalf + 2,
      capX: trayHalf + D.POST_LEN / 2,
      slotX: trayHalf + D.POST_LEN + 1,
      termX: trayHalf + D.POST_LEN * 0.6,
      postY: 32,
    };
  }

  function rebuild(n) {
    cells = Math.max(1, Math.min(D.MAX_CELLS, n));
    disposeCells();
    const LY = layout(cells);

    // 底板（圆角）
    const baseGeo = new THREE.ExtrudeGeometry(roundRectShape(LY.trayLen, D.BOX_D, 7), {
      depth: D.BOX_H, bevelEnabled: true, bevelThickness: 1, bevelSize: 1,
      bevelSegments: 2, curveSegments: 10,
    });
    baseGeo.rotateX(-Math.PI / 2);
    baseGeo.translate(0, -D.BOX_H, 0);
    add(tag(new THREE.Mesh(baseGeo, matTray), 'tray'));

    // 两端高挡板（外缘略圆）
    [-1, 1].forEach((sx) => {
      const wGeo = new THREE.ExtrudeGeometry(roundRectShape(D.WALL_T, D.BOX_D, 4), {
        depth: D.WALL_H, bevelEnabled: true, bevelThickness: 1.2, bevelSize: 1.2,
        bevelSegments: 2, curveSegments: 8,
      });
      wGeo.rotateX(-Math.PI / 2);
      // 🔴 挤出后 y 已经就是 [0, WALL_H]（rotateX(-90°) 把 +z 的挤出方向变成了 +y），
      //    这里【只挪 x】，再抬一次 WALL_H 会把整块挡板抬到托架上方、连带接线柱一起悬空。
      wGeo.translate(sx * LY.wallX, 0, 0);
      add(tag(new THREE.Mesh(wGeo, matTray), sx < 0 ? 'wallL' : 'wallR'));
    });

    // 中间弧形托：两片低矮的侧挡（前低后高，像参考图那样把电池兜住）
    const railLen = LY.bodyLen + 4;
    [-1, 1].forEach((sz) => {
      const h = sz > 0 ? 15 : 24;       // +z 是朝学生这一侧 ⇒ 前挡矮一些，才看得见电池
      const rail = new THREE.Mesh(new THREE.BoxGeometry(railLen, h, 4), matTray);
      rail.position.set(0, h / 2, sz * (D.BOX_D / 2 - 4));
      add(tag(rail, sz > 0 ? 'railFront' : 'railBack'));
    });

    // 电池夹：两端挡板内侧各一只金属夹盘，把电池端面顶住 ——
    // 没有它电池串两头各留 4 mm 空隙，看着像「电池浮在盒子里」。
    [-1, 1].forEach((sx) => {
      // 🔴 夹盘必须比电池【略粗】：做成 R*0.8 就整只藏在电池端面后面，
      //    侧面看还是「电池两头悬空」——和没做一样。
      // 压在电池端面上的亮银夹环（比电池大 12%，从任何斜角都看得见）
      const ring = new THREE.Mesh(new THREE.TorusGeometry(D.R * 1.06, 2.6, 10, 32), MAT.steel);
      ring.rotation.y = Math.PI / 2;
      ring.position.set(sx * LY.ringX, D.R, 0);
      add(tag(ring, 'clampRing'));
      // 挡板内侧的弹簧座：从夹环一路插进挡板，把「夹住」这件事在几何上接实
      const holder = new THREE.Mesh(
        new THREE.CylinderGeometry(D.R * 0.9, D.R * 1.02, 7, 28), MAT.brass);
      holder.rotation.z = Math.PI / 2;
      holder.position.set(sx * LY.seatX, D.R, 0);
      add(tag(holder, 'clampSeat'));
    });

    // 相邻两节之间的串联连接片（贴着电池端面）
    for (let i = 0; i < cells - 1; i++) {
      const jx = -LY.cellEnd + D.L + i * (D.L + LY.GAP) + 1;
      const link = new THREE.Mesh(new THREE.CylinderGeometry(D.R * 0.96, D.R * 0.96, 3.2, 28), MAT.copper);
      link.rotation.z = Math.PI / 2;
      link.position.set(jx, D.R, 0);
      add(tag(link, 'link'));
    }

    // 电池：一节挨一节，+x 端是正极帽
    for (let i = 0; i < cells; i++) {
      const cx = -LY.cellEnd + D.L / 2 + i * (D.L + LY.GAP);
      const cell = new THREE.Mesh(new THREE.CylinderGeometry(D.R, D.R, D.L, 40, 1, false), matCell);
      cell.rotation.z = Math.PI / 2;
      cell.position.set(cx, D.R, 0);
      add(tag(cell, 'cell'));
      // 正极帽（+x 端）
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(D.R * 0.42, D.R * 0.42, 3.2, 24), matCellCap);
      cap.rotation.z = Math.PI / 2;
      cap.position.set(cx + D.L / 2 + 1.6, D.R, 0);
      add(tag(cap, 'capPlus'));
      // 负极端的浅色封边
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(D.R * 0.99, D.R * 0.99, 2.4, 36), matCellCap);
      ring.rotation.z = Math.PI / 2;
      ring.position.set(cx - D.L / 2 + 1.2, D.R, 0);
      add(tag(ring, 'capMinus'));
      // 侧面的红色 ⊕（贴片，朝学生这一侧）
      const plus = new THREE.Mesh(new THREE.PlaneGeometry(D.R * 1.25, D.R * 1.25),
        new THREE.MeshBasicMaterial({ map: plusTexture(), transparent: true, depthWrite: false }));
      plus.position.set(cx, D.R, D.R + 0.25);
      add(plus);
    }

    // 两端的滚花接线柱：左红、右银（沿 x 轴伸出）
    [-1, 1].forEach((sx) => {
      const px = sx * LY.capX;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, D.POST_LEN * 0.5, 16), MAT.brass);
      stem.rotation.z = Math.PI / 2;
      stem.position.set(sx * LY.stemX, LY.postY, 0);
      add(tag(stem, 'postStem'));
      const cap = new THREE.Mesh(knurledGeometry(D.POST_R, D.POST_LEN), sx < 0 ? MAT.red : MAT.steel);
      cap.rotation.z = Math.PI / 2;
      cap.position.set(px, LY.postY, 0);
      cap.userData.termId = sx < 0 ? '+' : '-';
      add(tag(cap, 'postCap'));
      // 柱顶开槽
      const slot = new THREE.Mesh(new THREE.BoxGeometry(0.4, D.POST_R * 1.1, 0.4), MAT.black);
      slot.position.set(sx * LY.slotX, LY.postY, 0);
      add(slot);
    });

    termLocal['+'].set(-LY.termX * S, (LY.postY + D.BOX_H) * S, 0);
    termLocal['-'].set(LY.termX * S, (LY.postY + D.BOX_H) * S, 0);
    bounds.hw = (LY.trayHalf + D.POST_LEN) * S + 4;
    bounds.hd = (D.BOX_D / 2) * S;
  }

  const termLocal = {
    '+': new THREE.Vector3(),
    '-': new THREE.Vector3(),
  };
  const bounds = { hw: 0, hd: 0 };

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(260, 160),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.35;
  shadow.renderOrder = -1;
  outer.add(shadow);

  const api = {
    group: outer,
    shadow,
    localToWorld: (v) => inner.localToWorld(v.clone()),
    worldToLocal: (v) => inner.worldToLocal(v.clone()),
    type: 'battery',
    label: '干电池组',
    spec: '1.5 V / 节',
    termLocal,
    termIdx: { '+': 0, '-': 1 },
    get bounds() { return bounds; },
    getCells: () => cells,
    setCells(n) {
      rebuild(n);
      // 电池盒变长以后，阴影也跟着放宽
      shadow.geometry.dispose();
      shadow.geometry = new THREE.PlaneGeometry(bounds.hw * 2.3, bounds.hd * 2.6);
      api.spec = cells + ' 节　' + (cells * 1.5).toFixed(1) + ' V';
    },
    // 🔴🔴 必须【显式给 emf】。core 的 paramsOf = defaultParams(type) ∪ comp.params，
    //    而 TYPES.battery.defaults 里就写着 emf:3 —— 只传 cells 的话，emf 会被那个
    //    默认值盖住，节数就成了纯装饰（实测：拨到 3 节，电流仍是按 3 V 算的）。
    //    cells 一并带上，只是为了让读数知道「这是几节」。
    getParams() {
      return { emf: cells * 1.5, rInt: 0, cells: cells, emfPerCell: 1.5, rPerCell: 0 };
    },
    // 面板与读数要用（不用求解也能显示）
    emf: () => cells * 1.5,
  };
  rebuild(cells);
  return api;
}

// ============================================================
//  小灯泡 + 灯座（人教版 15.2 插图那种「螺口小灯泡 + 塑料灯座」）
// ------------------------------------------------------------
// 参考图 → 3D：
//   浅蓝灰圆角底板 + 左右两只红色滚花接线柱  → 同闸刀开关那套
//   中间圆柱凸台（上缘微收）                → CylinderGeometry 锥度
//   凸台上的黑色绝缘圈                      → 薄圆柱
//   深灰金属螺纹灯口                        → 圆柱 + 数圈 torus 当螺纹
//   透明玻璃泡（近球形 + 短颈）              → LatheGeometry 一条轮廓
//   泡内两根竖直支架 + 顶端折线灯丝          → 圆柱 + TubeGeometry
// 亮度与灯丝颜色由 circuit-core 的 rec.brightness / rec.tempC 驱动，
// 这里【不算电学】，只负责把求解结果画成光。
// ============================================================
export const BULB_DIM = {
  BASE_W: 92, BASE_D: 56, BASE_H: 12,
  POST_X: 36, POST_Z: 16, POST_R: 5.5, POST_H: 15,
  PED_R: 15, PED_H: 18,          // 凸台
  RING_R: 12.5, RING_H: 3,       // 黑色绝缘圈
  SOCK_R: 11, SOCK_H: 7,         // 螺纹灯口
  GLASS_R: 14, GLASS_H: 28,      // 玻璃泡（近球形，直径 28）
  GLASS_Y: 24,                   // 玻璃泡颈口底面（局部，y=0 是底座上表面）
  SCALE: 2.8,
};

// ── 黑体辐射配色（1000–40000 K，CIE 1931 → sRGB）──────────────
// 灯丝颜色是「温度」的直接读数：20℃ 时暗红发黑，1000℃ 橙红，2800℃ 暖白。
// 用色度图近似而不是「暗红→黄→白」的硬编码渐变，这样任何温度都自洽。
export function blackbodyRGB(T) {
  const t = Math.min(40000, Math.max(1000, T));
  let x, y;
  if (t <= 4000) x = -0.2661239e9 / t ** 3 - 0.2343589e6 / t ** 2 + 0.8776956e3 / t + 0.179910;
  else x = -3.0258469e9 / t ** 3 + 2.1070379e6 / t ** 2 + 0.2226347e3 / t + 0.240390;
  if (t <= 2222) y = -1.1063814 * x ** 3 - 1.34811020 * x ** 2 + 2.18555832 * x - 0.20219683;
  else if (t <= 4000) y = -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867;
  else y = 3.0817580 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483;
  const z = 1 - x - y;
  const r = 3.2406 * x - 1.5372 * y - 0.4986 * z;
  const g = -0.9689 * x + 1.8758 * y + 0.0415 * z;
  const b = 0.0557 * x - 0.2040 * y + 1.0570 * z;
  const gam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  return new THREE.Color(
    Math.min(1, Math.max(0, gam(r))),
    Math.min(1, Math.max(0, gam(g))),
    Math.min(1, Math.max(0, gam(b)))
  );
}

// 光晕贴图（径向渐变，只建一次）
let HALO_TEX = null;
function haloTexture() {
  if (HALO_TEX) return HALO_TEX;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const rg = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  rg.addColorStop(0, 'rgba(255,255,255,0.95)');
  rg.addColorStop(0.22, 'rgba(255,240,205,0.55)');
  rg.addColorStop(0.55, 'rgba(255,210,140,0.16)');
  rg.addColorStop(1, 'rgba(255,190,110,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, 128, 128);
  HALO_TEX = new THREE.CanvasTexture(cv);
  HALO_TEX.colorSpace = THREE.SRGBColorSpace;
  return HALO_TEX;
}

// 玻璃高光（参考图左上那道白色月牙）—— 贴图只建一次
let GLINT_TEX = null;
function glintTexture() {
  if (GLINT_TEX) return GLINT_TEX;
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 96;
  const g = cv.getContext('2d');
  const rg = g.createRadialGradient(32, 48, 2, 32, 48, 44);
  rg.addColorStop(0, 'rgba(255,255,255,0.95)');
  rg.addColorStop(0.42, 'rgba(255,255,255,0.42)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.save();
  g.translate(32, 48); g.scale(0.52, 1); g.translate(-32, -48);
  g.fillStyle = rg;
  g.fillRect(0, 0, 64, 96);
  g.restore();
  GLINT_TEX = new THREE.CanvasTexture(cv);
  GLINT_TEX.colorSpace = THREE.SRGBColorSpace;
  return GLINT_TEX;
}

export function buildBulb(opts) {
  opts = opts || {};
  const D = BULB_DIM;
  const S = D.SCALE;
  const outer = new THREE.Group();
  const inner = new THREE.Group();
  inner.scale.setScalar(S);
  // 底座是挤出件 + 1.2 的倒角 ⇒ 底面比「几何底面」还要低 1.2；
  // 只补 BASE_H 会让整台器材陷进桌面 3.4 mm。
  inner.position.y = (D.BASE_H + 1.2) * S;     // 底座下表面正好落在 y=0（桌面）
  outer.add(inner);

  const tag = (o, role) => { o.userData.role = role; return o; };

  // 灯座本体材质（每实例独立：玻璃与灯丝的透明度要各自变）
  const matPed = new THREE.MeshStandardMaterial({ color: 0x93a8c0, roughness: 0.46, metalness: 0.12 });
  const matSock = new THREE.MeshStandardMaterial({ color: 0x8d959f, roughness: 0.34, metalness: 0.86 });
  const matThread = new THREE.MeshStandardMaterial({ color: 0x767d87, roughness: 0.4, metalness: 0.8 });
  const matGlass = new THREE.MeshStandardMaterial({
    color: 0xdff2ff, roughness: 0.04, metalness: 0.0,
    transparent: true, opacity: 0.20, depthWrite: false,
    side: THREE.DoubleSide,
  });
  const matFilament = new THREE.MeshBasicMaterial({ color: 0x2a1a10 });

  // ── 1. 底板（圆角矩形挤出，上表面 y=0）────────────────────
  const baseGeo = new THREE.ExtrudeGeometry(roundRectShape(D.BASE_W, D.BASE_D, 9), {
    depth: D.BASE_H, bevelEnabled: true, bevelThickness: 1.2, bevelSize: 1.2,
    bevelSegments: 2, curveSegments: 12,
  });
  baseGeo.rotateX(-Math.PI / 2);
  baseGeo.translate(0, -D.BASE_H, 0);
  inner.add(tag(new THREE.Mesh(baseGeo, MAT.basePlate), 'base'));

  // ── 2. 两只红色滚花接线柱（与闸刀开关同款）────────────────
  [-1, 1].forEach((sx) => {
    const x = sx * D.POST_X;
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(D.POST_R + 3.4, D.POST_R + 4, 2.4, 28), MAT.steel);
    pad.position.set(x, 1.2, D.POST_Z);
    inner.add(tag(pad, 'postPad'));
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(D.POST_R * 0.72, D.POST_R * 0.72, 4, 20), MAT.brass);
    stem.position.set(x, 3.4, D.POST_Z);
    inner.add(tag(stem, 'postStem'));
    const cap = new THREE.Mesh(knurledGeometry(D.POST_R, D.POST_H), MAT.red);
    cap.position.set(x, 3.4 + D.POST_H / 2, D.POST_Z);
    cap.userData.termId = sx < 0 ? 'a' : 'b';
    inner.add(tag(cap, 'postCap'));
    const slot = new THREE.Mesh(new THREE.BoxGeometry(D.POST_R * 1.1, 0.7, 0.3), MAT.black);
    slot.position.set(x, 3.4 + D.POST_H - 0.3, D.POST_Z + D.POST_R * 0.55);
    inner.add(tag(slot, 'postSlot'));
  });

  // ── 3. 中间凸台（上缘略收，参考图那副锥度）────────────────
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(D.PED_R, D.PED_R * 1.04, D.PED_H, 40), matPed);
  ped.position.set(0, D.PED_H / 2, 0);
  inner.add(tag(ped, 'pedestal'));
  // 凸台顶部倒角圈
  const pedTop = new THREE.Mesh(new THREE.TorusGeometry(D.PED_R * 0.97, 1.1, 8, 40), matPed);
  pedTop.rotation.x = Math.PI / 2;
  pedTop.position.set(0, D.PED_H, 0);
  inner.add(tag(pedTop, 'pedestalTop'));

  // ── 4. 黑色绝缘圈 ─────────────────────────────────────────
  const ringY = D.PED_H + D.RING_H / 2;
  const blackRing = new THREE.Mesh(new THREE.CylinderGeometry(D.RING_R, D.RING_R, D.RING_H, 32), MAT.black);
  blackRing.position.set(0, ringY, 0);
  inner.add(tag(blackRing, 'blackRing'));

  // ── 5. 螺纹灯口（圆柱 + 数圈 torus 当螺纹）────────────────
  const sockY0 = D.PED_H + D.RING_H;
  const socket = new THREE.Mesh(new THREE.CylinderGeometry(D.SOCK_R, D.SOCK_R, D.SOCK_H, 36), matSock);
  socket.position.set(0, sockY0 + D.SOCK_H / 2, 0);
  inner.add(tag(socket, 'socket'));
  for (let i = 0; i < 4; i++) {
    const th = new THREE.Mesh(new THREE.TorusGeometry(D.SOCK_R * 1.02, 0.62, 6, 36), matThread);
    th.rotation.x = Math.PI / 2;
    th.position.set(0, sockY0 + 1.2 + i * 1.5, 0);
    inner.add(tag(th, 'thread'));
  }
  // 灯口上沿的收口圈（玻璃颈从这里出来）
  const sockLip = new THREE.Mesh(new THREE.TorusGeometry(D.SOCK_R * 0.96, 0.8, 8, 36), matSock);
  sockLip.rotation.x = Math.PI / 2;
  sockLip.position.set(0, sockY0 + D.SOCK_H, 0);
  inner.add(tag(sockLip, 'socketLip'));

  // ── 6. 玻璃泡（LatheGeometry：短颈 + 近球形）──────────────
  // 🔴 用一条轮廓旋成一体，不要「球 + 圆柱颈」拼：两段接缝在透明材质下会
  //    露出一道明显的亮线，看着像灯泡裂了。
  const prof = [
    [9.5, 0], [9.5, 3.5], [10.6, 6], [12.4, 9], [13.8, 12.5],
    [14, 16], [13.5, 19.5], [11.8, 22.6], [8.8, 25.2], [4.6, 27.2], [0, 28],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const glassGeo = new THREE.LatheGeometry(prof, 44);
  const glass = new THREE.Mesh(glassGeo, matGlass);
  glass.position.set(0, D.GLASS_Y, 0);
  glass.renderOrder = 2;          // 玻璃最后画，里面的灯丝才透得出来
  inner.add(tag(glass, 'glass'));

  // ── 7. 泡内两根支架 + 顶端折线灯丝 ────────────────────────
  // 🔴 支架与灯丝都要「细」：0.55/0.42 的半径放大 2.8 倍后是 1.5/1.2 mm，
  //    渲染出来是两根粗柱子加一个大写的 M，不像灯丝。
  const leadTop = D.GLASS_Y + 18;          // 支架顶端（玻璃上半部）
  [-1, 1].forEach((sx) => {
    const lead = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, leadTop - (sockY0 - 1), 8), MAT.steel);
    lead.position.set(sx * 2.4, (leadTop + sockY0 - 1) / 2, 0);
    inner.add(tag(lead, 'lead'));
  });
  // 灯丝：一段折线（参考图里画的就是「两个支架顶端之间的一段细丝」）
  const filPts = [
    new THREE.Vector3(-2.4, leadTop, 0),
    new THREE.Vector3(-1.25, leadTop + 3.6, 0),
    new THREE.Vector3(0, leadTop + 1.7, 0),
    new THREE.Vector3(1.25, leadTop + 3.6, 0),
    new THREE.Vector3(2.4, leadTop, 0),
  ];
  const filGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(filPts), 48, 0.26, 8, false);
  const filament = new THREE.Mesh(filGeo, matFilament);
  inner.add(tag(filament, 'filament'));

  // ── 8. 光晕 + 点光源（亮度驱动）──────────────────────────
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: haloTexture(), color: 0xffd9a0, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0,
  }));
  halo.position.set(0, D.GLASS_Y + 16, 0);
  halo.scale.setScalar(30);
  inner.add(tag(halo, 'halo'));

  // 泡内的「整体发光」：一层背面 + 叠加混合的球壳。只靠灯丝和精灵的话，
  // 玻璃泡看着像一只灰气泡 —— 真灯泡是【整个泡都在发光】。
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xffd9a0, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide,
  });
  // 🔴 半径要 ≥ 玻璃：小于玻璃时，泡内会出现一圈明显的「内边界」，
  //    看着像一个黄球塞在玻璃里。
  const glow = new THREE.Mesh(new THREE.SphereGeometry(D.GLASS_R + 0.4, 26, 18), glowMat);
  glow.position.set(0, D.GLASS_Y + 14, 0);
  glow.renderOrder = 3;
  inner.add(tag(glow, 'glow'));

  // 玻璃高光：参考图左上那道白月牙。用 Sprite（永远朝向相机），
  // 所以绕器材转视角时高光不会「转到背面去」。
  const glint = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glintTexture(), color: 0xffffff, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5,
  }));
  glint.position.set(-5.5, D.GLASS_Y + 21, 3);
  glint.scale.set(9, 13, 1);
  glint.renderOrder = 4;
  inner.add(tag(glint, 'glint'));

  const lamp = new THREE.PointLight(0xffd9a0, 0, 1200, 2);
  lamp.position.set(0, D.GLASS_Y + 15, 0);
  inner.add(tag(lamp, 'lampLight'));

  // ── 9. 桌面接触阴影 ───────────────────────────────────────
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(260, 170),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.35;
  shadow.renderOrder = -1;
  outer.add(shadow);

  // ── 10. 端子 ──────────────────────────────────────────────
  const termLocal = {
    a: new THREE.Vector3(-D.POST_X * S, (3.4 + D.POST_H * 0.55 + D.BASE_H) * S, D.POST_Z * S),
    b: new THREE.Vector3(D.POST_X * S, (3.4 + D.POST_H * 0.55 + D.BASE_H) * S, D.POST_Z * S),
  };

  // ── 11. 亮度驱动（数值全部来自 circuit-core，这里只做缓动与配色）──
  let lit = 0;          // 目标亮度 0~1.3
  let shown = 0;        // 当前亮度（缓动，避免读数跳变时灯闪）
  let tempC = 20;
  let over = false;

  // 冷态灯丝的底色：一根暗钨丝，几乎看不见（不是暗红 —— 那是「刚断电还热着」）
  const COL_COLD = new THREE.Color(0x3b3a36);

  function apply() {
    const b = Math.max(0, Math.min(1.3, shown));
    const T = Math.max(1200, tempC + 273.15);          // 灯丝温度（K）
    const col = blackbodyRGB(T);
    const k = Math.min(1, b * 1.35);                   // 0 = 冷态，1 = 满亮
    // 灯丝：从冷态的暗钨丝【混】到黑体色，再乘一个亮度增益 —— 越亮越"超白"
    matFilament.color.copy(COL_COLD).lerp(col, k).multiplyScalar(0.55 + 4.6 * k);
    // 玻璃：亮起来才带一点自身发光（真实灯泡的玻璃壁被灯丝照亮）
    matGlass.opacity = 0.15 + 0.09 * k;
    matGlass.emissive.copy(col).multiplyScalar(0.05 * k);
    // 泡内辉光：整个玻璃泡都在发光（真灯泡就是这样）
    glowMat.color.copy(col);
    glowMat.opacity = 0.34 * k;
    // 外面再罩一层淡光晕（只到「泡周围一圈」的量级，别糊满整张桌子）
    halo.material.color.copy(col);
    halo.material.opacity = Math.min(0.30, b * 0.26);
    halo.scale.setScalar(30 + 34 * k);
    // 越亮，玻璃高光越被灯丝盖住
    glint.material.opacity = 0.5 * (1 - 0.55 * k);
    // 点光源（照亮桌面与邻近器材）—— 场景单位是 mm，强度按经验标定
    lamp.color.copy(col);
    lamp.intensity = 0.9 * k;
    lamp.distance = 700;
  }
  apply();

  const api = {
    group: outer,
    shadow,
    localToWorld: (v) => inner.localToWorld(v.clone()),
    worldToLocal: (v) => inner.worldToLocal(v.clone()),
    type: 'bulb',
    label: '小灯泡',
    spec: '2.5 V　0.75 W',
    bounds: { hw: D.BASE_W / 2 * S + 6, hd: D.BASE_D / 2 * S },
    termLocal,
    termIdx: { a: 0, b: 1 },        // 与 circuit-core 的 TYPES.bulb 一致
    // 🔴 参数键名照 circuit-params.js 的 PARAM_UI.bulb，一个都不能改名：
    //    ratedV / ratedW / tempDependent / showTemp
    getParams() {
      return {
        ratedV: api.ratedV, ratedW: api.ratedW,
        tempDependent: api.tempDependent, showTemp: api.showTemp,
      };
    },
    ratedV: 2.5, ratedW: 0.75, tempDependent: true, showTemp: false,
    // 求解结果回灌（sandbox 在 recompute() 里调）
    setLit(rec) {
      if (!rec) { lit = 0; return; }
      lit = rec.brightness == null ? 0 : rec.brightness;
      tempC = rec.tempC == null ? 20 : rec.tempC;
      over = !!rec.overload;
      api.spec = (api.ratedV).toFixed(1) + ' V　' + api.ratedW.toFixed(2) + ' W';
    },
    // 缓动：求解是一帧一次的，读数突变时不能让灯硬跳
    step(dt) {
      const d = lit - shown;
      if (Math.abs(d) < 0.002) { if (shown !== lit) { shown = lit; apply(); } return; }
      shown += d * Math.min(1, dt * 7);
      apply();
    },
    getBrightness: () => shown,
    // 🔴 自检要判【真的画出来的东西】，不能只看 getBrightness() 这个内部数：
    //    「状态改了但材质没跟着变」的变异在 getBrightness 上照样合格。
    debugLit() {
      return {
        filament: [matFilament.color.r, matFilament.color.g, matFilament.color.b]
          .map((v) => +v.toFixed(3)),
        glassOpacity: +matGlass.opacity.toFixed(3),
        glowOpacity: +glowMat.opacity.toFixed(3),
        haloOpacity: +halo.material.opacity.toFixed(3),
        lightIntensity: +lamp.intensity.toFixed(3),
      };
    },
    getTempC: () => tempC,
    isOverload: () => over,
    setRated(v, w) {
      if (v != null) api.ratedV = v;
      if (w != null) api.ratedW = w;
      api.spec = api.ratedV.toFixed(1) + ' V　' + api.ratedW.toFixed(2) + ' W';
    },
  };
  return api;
}

// ============================================================
//  电流表 / 电压表（人教版 J0407 / J0408 那种三柱双量程指针表）
// ------------------------------------------------------------
// 参考图 → 3D：
//   浅蓝灰梯形表壳（上厚下薄）        → 圆角挤出 + 后倾 12°
//   白色表盘（双排刻度 + 中心 A/V）  → CanvasTexture 画在表盘平面上
//   红色指针（轴在表盘下沿正中）      → 细长盒子绕 z 转
//   表盘下方的镜面梯形 + 调零螺丝    → 贴图 + 小圆柱
//   底座上的绿色接线板 + 三个接线柱   → 贴图 + 滚花柱（黑 / 红 / 红）
// 读数全部来自 circuit-core 的 rec.reading / rec.range / rec.reversed /
// rec.overRange —— 这里只把「读数」画成「指针偏到哪儿」。
// ============================================================
export const METER_DIM = {
  BASE_W: 124, BASE_D: 88, BASE_H: 26,
  PANEL_W: 124, PANEL_H: 88, PANEL_T: 13,
  TILT: 0.20,                 // 表盘后倾（rad）
  PAD_D: 46,                  // 绿色接线板深度
  POST_X: 34, POST_Z: 14, POST_R: 5.5, POST_H: 15,
  SPAN: 1.5708,               // 指针扫过的角度（90°）
  SCALE: 1.9,
};

// ── 表盘贴图 ────────────────────────────────────────────────
// 双排刻度：外圈是大挡位（15 V / 3 A），内圈是小挡位（3 V / 0.6 A），
// 两排共用同一条弧、同一个零点 —— 和真表一样：换挡位不换表盘。
const METER_FACE_CACHE = {};
function meterFaceTexture(kind) {
  const key = 'face_' + kind;
  if (METER_FACE_CACHE[key]) return METER_FACE_CACHE[key];
  const W = 560, H = 420;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#f7f9fb'; g.fillRect(0, 0, W, H);
  // 四角固定螺丝
  [[26, 26], [W - 26, 26], [26, H - 26], [W - 26, H - 26]].forEach(([x, y]) => {
    g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2);
    g.fillStyle = '#c8d2dc'; g.fill();
    g.strokeStyle = '#8fa0b2'; g.lineWidth = 2; g.stroke();
    g.beginPath(); g.moveTo(x - 5, y); g.lineTo(x + 5, y);
    g.strokeStyle = '#6b7c8e'; g.lineWidth = 2.4; g.stroke();
  });

  const cx = 280, cy = 440, R = 350;          // 弧心在表盘下方
  const A0 = -Math.PI / 4, A1 = Math.PI / 4;  // ±45°
  const isA = kind === 'ammeter';
  const big = isA ? 3 : 15;
  const small = isA ? 0.6 : 3;
  const fmt = (v) => (isA ? String(Math.round(v * 10) / 10) : String(Math.round(v)));

  // 弧线
  g.beginPath();
  g.arc(cx, cy, R, -Math.PI / 2 + A0, -Math.PI / 2 + A1);
  g.strokeStyle = '#243447'; g.lineWidth = 3; g.stroke();

  const N = 30;
  for (let i = 0; i <= N; i++) {
    const a = -Math.PI / 2 + A0 + (A1 - A0) * (i / N);
    const major = i % 5 === 0;
    const len = major ? 26 : 13;
    const c = Math.cos(a), sn = Math.sin(a);
    g.beginPath();
    g.moveTo(cx + c * R, cy + sn * R);
    g.lineTo(cx + c * (R - len), cy + sn * (R - len));
    g.strokeStyle = '#243447';
    g.lineWidth = major ? 3.2 : 1.8;
    g.stroke();
  }

  // 两排数字：i = 10 / 20 / 30 三处
  g.textAlign = 'center'; g.textBaseline = 'middle';
  [10, 20, 30].forEach((i) => {
    const a = -Math.PI / 2 + A0 + (A1 - A0) * (i / N);
    const c = Math.cos(a), sn = Math.sin(a);
    // 外圈（大挡位）
    g.fillStyle = '#1e293b';
    g.font = 'bold 40px "Helvetica Neue", Arial, sans-serif';
    // 🔴 外圈数字不能贴太外：R+34 时两端 x 会超出画布（被切掉半个数字）
    g.fillText(fmt(big * i / N), cx + c * (R + 22), cy + sn * (R + 22));
    // 内圈（小挡位）
    g.font = 'bold 30px "Helvetica Neue", Arial, sans-serif';
    g.fillStyle = '#334155';
    g.fillText(fmt(small * i / N), cx + c * (R - 52), cy + sn * (R - 52));
  });

  // 中央的 A / V
  g.fillStyle = '#0f172a';
  g.font = 'bold 74px "Helvetica Neue", Arial, sans-serif';
  g.fillText(isA ? 'A' : 'V', cx, 250);
  // A / V 下面那道横线（参考图里是一个带下划线的字母）
  g.beginPath();
  g.moveTo(cx - 30, 292); g.lineTo(cx + 30, 292);
  g.strokeStyle = '#0f172a'; g.lineWidth = 4; g.stroke();

  // 下方镜面梯形（读数时要让指针和倒影重合的那块）
  g.beginPath();
  g.moveTo(cx - 96, 330); g.lineTo(cx + 96, 330);
  g.lineTo(cx + 62, 392); g.lineTo(cx - 62, 392);
  g.closePath();
  g.fillStyle = '#dde6ef'; g.fill();
  g.strokeStyle = '#9fb0c2'; g.lineWidth = 2; g.stroke();
  g.save();
  g.beginPath();
  g.moveTo(cx - 96, 330); g.lineTo(cx + 96, 330);
  g.lineTo(cx + 62, 392); g.lineTo(cx - 62, 392);
  g.closePath(); g.clip();
  g.strokeStyle = 'rgba(120,140,160,.5)'; g.lineWidth = 1;
  for (let d = -220; d < 220; d += 9) {
    g.beginPath(); g.moveTo(cx + d, 320); g.lineTo(cx + d + 90, 400); g.stroke();
    g.beginPath(); g.moveTo(cx + d, 320); g.lineTo(cx + d - 90, 400); g.stroke();
  }
  g.restore();

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  METER_FACE_CACHE[key] = tex;
  return tex;
}

// ── 接线板贴图（绿底 + 白框 + 三个柱子的标注）──────────────────
const METER_PAD_CACHE = {};
function meterPadTexture(kind) {
  const key = 'pad_' + kind;
  if (METER_PAD_CACHE[key]) return METER_PAD_CACHE[key];
  const W = 512, H = 236;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#2f8f5b'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#eef6f1'; g.lineWidth = 7;
  g.strokeRect(11, 11, W - 22, H - 22);
  const labels = kind === 'ammeter' ? ['−', '0.6', '3'] : ['−', '3', '15'];
  const xs = [0.5 - 34 / 62, 0.5, 0.5 + 34 / 62];   // 与 POST_X 对应（板宽 124）
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  g.font = 'bold 42px "Helvetica Neue", Arial, sans-serif';
  labels.forEach((t, i) => g.fillText(t, xs[i] * W, H * 0.88));
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  METER_PAD_CACHE[key] = tex;
  return tex;
}

export function buildMeter(opts) {
  opts = opts || {};
  const kind = opts.kind === 'voltmeter' ? 'voltmeter' : 'ammeter';
  const isA = kind === 'ammeter';
  const D = METER_DIM;
  const S = D.SCALE;
  const outer = new THREE.Group();
  const inner = new THREE.Group();
  inner.scale.setScalar(S);
  inner.position.y = (D.BASE_H + 1.2) * S;
  outer.add(inner);
  const tag = (o, role) => { o.userData.role = role; return o; };

  const matCase = new THREE.MeshStandardMaterial({ color: 0x93a8c0, roughness: 0.46, metalness: 0.12 });
  const matCaseDark = new THREE.MeshStandardMaterial({ color: 0x74899f, roughness: 0.5, metalness: 0.14 });
  const matPad = new THREE.MeshStandardMaterial({ map: meterPadTexture(kind), roughness: 0.62, metalness: 0.04 });
  const matFace = new THREE.MeshStandardMaterial({ map: meterFaceTexture(kind), roughness: 0.5, metalness: 0.02 });

  // ── 1. 底座（圆角挤出，上表面 y=0）──────────────────────────
  const baseGeo = new THREE.ExtrudeGeometry(roundRectShape(D.BASE_W, D.BASE_D, 10), {
    depth: D.BASE_H, bevelEnabled: true, bevelThickness: 1.2, bevelSize: 1.2,
    bevelSegments: 2, curveSegments: 12,
  });
  baseGeo.rotateX(-Math.PI / 2);
  baseGeo.translate(0, -D.BASE_H, 0);
  inner.add(tag(new THREE.Mesh(baseGeo, matCase), 'base'));

  // ── 2. 绿色接线板（贴在底座前部上表面）────────────────────
  const padGeo = new THREE.PlaneGeometry(D.BASE_W - 16, D.PAD_D);
  padGeo.rotateX(-Math.PI / 2);
  const pad = new THREE.Mesh(padGeo, matPad);
  // 🔴 底座是挤出 + 倒角件，顶面在 y = +1.2（不是 0）⇒ 贴片必须抬到 1.3 以上，
  //    否则整块绿板被埋进壳里（实测：接线柱下面一片浅蓝，看不见标注）。
  pad.position.set(0, 1.35, 12);
  inner.add(tag(pad, 'pad'));

  // ── 3. 三个接线柱（黑 / 红 / 红）───────────────────────────
  const termNames = isA ? ['-', '0.6', '3'] : ['-', '3', '15'];
  const termLocal = {};
  [-1, 0, 1].forEach((k, i) => {
    const x = k * D.POST_X;
    const matCap = i === 0 ? MAT.black : MAT.red;
    const pad2 = new THREE.Mesh(new THREE.CylinderGeometry(D.POST_R + 3.4, D.POST_R + 4, 2.2, 24), MAT.steel);
    pad2.position.set(x, 1.8, D.POST_Z);
    inner.add(tag(pad2, 'postPad'));
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(D.POST_R * 0.72, D.POST_R * 0.72, 4, 18), MAT.brass);
    stem.position.set(x, 3.8, D.POST_Z);
    inner.add(tag(stem, 'postStem'));
    const cap = new THREE.Mesh(knurledGeometry(D.POST_R, D.POST_H), matCap);
    cap.position.set(x, 3.8 + D.POST_H / 2, D.POST_Z);
    cap.userData.termId = termNames[i];
    inner.add(tag(cap, 'postCap'));
    termLocal[termNames[i]] = new THREE.Vector3(
      x * S, (3.8 + D.POST_H * 0.55 + D.BASE_H) * S, D.POST_Z * S);
  });

  // ── 4. 表盘（后倾 12°，轴在底边）──────────────────────────
  const panelPivot = new THREE.Group();
  panelPivot.position.set(0, 0, -D.BASE_D / 2 + 16);
  panelPivot.rotation.x = -D.TILT;          // 顶部往后倒
  inner.add(panelPivot);

  const panelGeo = new THREE.ExtrudeGeometry(roundRectShape(D.PANEL_W, D.PANEL_T, 5), {
    depth: D.PANEL_H, bevelEnabled: true, bevelThickness: 1, bevelSize: 1,
    bevelSegments: 2, curveSegments: 10,
  });
  // 挤出后是「宽 × 厚」的截面沿 +z 拉高 ⇒ 转成「宽 × 高」的立板
  panelGeo.rotateX(-Math.PI / 2);
  panelGeo.translate(0, 0, D.PANEL_T / 2);
  const panel = new THREE.Mesh(panelGeo, matCase);
  panelPivot.add(tag(panel, 'panel'));

  // 白色表盘面（贴在立板前面）
  // 🔴 面板是挤出 + 倒角件，倒角把正面推到 z = PANEL_T + bevelThickness，
  //    贴在 PANEL_T 就会被埋进壳里（表盘一片空白）。所有贴面统一用 FACE_Z。
  const FACE_Z = D.PANEL_T + 1.6;
  const faceW = D.PANEL_W - 12, faceH = D.PANEL_H - 12;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(faceW, faceH), matFace);
  face.position.set(0, faceH / 2 + 6, FACE_Z);
  panelPivot.add(tag(face, 'face'));

  // ── 5. 指针（轴在表盘下沿正中）─────────────────────────────
  const pivot = new THREE.Group();
  pivot.position.set(0, 8, FACE_Z + 0.8);
  panelPivot.add(tag(pivot, 'needlePivot'));
  const needleLen = faceH * 0.74;
  const needle = new THREE.Mesh(new THREE.BoxGeometry(1.15, needleLen, 0.5),
    new THREE.MeshBasicMaterial({ color: 0xb91c1c }));
  needle.position.set(0, needleLen / 2, 0);
  pivot.add(tag(needle, 'needle'));
  // 轴帽
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 1.6, 20), MAT.black);
  hub.rotation.x = Math.PI / 2;
  hub.position.set(0, 0, 0.7);
  pivot.add(tag(hub, 'hub'));
  // 表盘上的数字示数（参数面板勾「在表盘上显示读数」才出现）
  const valCv = document.createElement('canvas');
  valCv.width = 320; valCv.height = 80;
  const valTex = new THREE.CanvasTexture(valCv);
  valTex.colorSpace = THREE.SRGBColorSpace;
  const valMesh = new THREE.Mesh(new THREE.PlaneGeometry(38, 9.5),
    new THREE.MeshBasicMaterial({ map: valTex, transparent: true, depthWrite: false }));
  valMesh.position.set(0, faceH * 0.26, FACE_Z + 0.5);
  valMesh.visible = false;
  panelPivot.add(tag(valMesh, 'valueTag'));
  function drawValue(text) {
    const g2 = valCv.getContext('2d');
    g2.clearRect(0, 0, 320, 80);
    if (!text) { valTex.needsUpdate = true; return; }
    g2.fillStyle = 'rgba(15,23,42,.92)';
    g2.font = 'bold 46px "Helvetica Neue", Arial, sans-serif';
    g2.textAlign = 'center'; g2.textBaseline = 'middle';
    g2.fillText(text, 160, 42);
    valTex.needsUpdate = true;
  }

  // 调零螺丝（表盘下方那颗）
  const screw = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 2.4, 20), MAT.steel);
  screw.rotation.x = Math.PI / 2;
  screw.position.set(0, -6, FACE_Z - 0.6);
  panelPivot.add(tag(screw, 'zeroScrew'));

  // ── 6. 桌面接触阴影 ───────────────────────────────────────
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(D.BASE_W * S * 1.9, D.BASE_D * S * 1.7),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.35;
  shadow.renderOrder = -1;
  outer.add(shadow);

  // ── 7. 指针驱动（全部来自 circuit-core 的读数）──────────────
  const HALF = D.SPAN / 2;
  let shown = 0;            // 当前指针位置（0 = 零点，1 = 满偏）
  let target = 0;
  let zeroed = opts.zeroed == null ? true : !!opts.zeroed;

  function apply() {
    // 未调零 ⇒ 指针整体偏一点（真表就是这样：零点不在刻度线上）
    const off = zeroed ? 0 : -0.055;
    const f = shown + off;
    pivot.rotation.z = HALF * (1 - 2 * f);
  }
  apply();

  const api = {
    group: outer,
    shadow,
    localToWorld: (v) => inner.localToWorld(v.clone()),
    worldToLocal: (v) => inner.worldToLocal(v.clone()),
    type: kind,
    label: isA ? '电流表' : '电压表',
    spec: isA ? '0.6 A / 3 A' : '3 V / 15 V',
    bounds: { hw: D.BASE_W / 2 * S + 6, hd: D.BASE_D / 2 * S },
    // 名称标签挂在这个高度（世界 mm）：表比其它器材高，写死 190 会压在表盘上
    topY: (D.BASE_H + 1.2 + D.PANEL_H + 4) * S,
    termLocal,
    termIdx: isA ? { '-': 0, '0.6': 1, '3': 2 } : { '-': 0, '3': 1, '15': 2 },
    range: isA ? 0.6 : 3,
    showValue: false,
    zeroed,
    weakI: false,
    getParams() {
      return {
        range: api.range,
        zeroed: api.zeroed,
        zeroMode: api.zeroed ? 'on' : 'off',
        showValue: api.showValue,
        weakI: api.weakI,
      };
    },
    // 求解结果回灌：只算「指针偏到哪」，不算电学
    setReading(rec) {
      if (!rec) { target = 0; return; }
      const rng = rec.rangeWired ? rec.range : api.range;
      if (rec.rangeWired && rec.range) api.range = rec.range;
      let f = 0;
      if (rec.wired && !rec.reversed) {
        f = Math.abs(rec.reading || 0) / (rng || 1);
      } else if (rec.reversed) {
        f = -0.045;                    // 接反 ⇒ 指针顶在左限位
      }
      if (rec.overRange) f = 1.05;     // 超量程 ⇒ 顶到右限位
      target = Math.max(-0.08, Math.min(1.08, f));
      if (rec.zeroed != null) zeroed = !!rec.zeroed;
      if (valMesh.visible) {
        const v = rec.wired ? (rec.reading || 0) : 0;
        drawValue(Math.abs(v) < 5e-4 ? '0' : v.toFixed(rec.range <= 1 ? 2 : 2) +
          (isA ? ' A' : ' V'));
      }
    },
    step(dt) {
      const d = target - shown;
      if (Math.abs(d) < 0.0015) { if (shown !== target) { shown = target; apply(); } return; }
      shown += d * Math.min(1, dt * 9);
      apply();
    },
    // 自检用：真实落笔的那一份
    debugMeter() {
      return {
        needleRot: +pivot.rotation.z.toFixed(4),
        target: +target.toFixed(4),
        shown: +shown.toFixed(4),
        range: api.range,
        zeroed,
      };
    },
    // 表盘上那一行数字（showValue 打开才画）
    setShowValue(on) {
      api.showValue = !!on;
      valMesh.visible = !!on;
      if (on) drawValue('0');
    },
  };
  return api;
}

// ============================================================
//  蓄电池（3 只铅酸电池串成一组，2 V/节 ⇒ 6 V）
// ============================================================
export const STOR_DIM = {
  W: 54, D: 76, H: 118, GAP: 2,
  RIB_W: 7, RIB_D: 2.2,
  POST_R: 5.2, POST_H: 14,
  SCALE: 1.55,
};

export function buildStorageBattery() {
  const D = STOR_DIM;
  const S = D.SCALE;
  const outer = new THREE.Group();
  const inner = new THREE.Group();
  inner.scale.setScalar(S);
  inner.position.y = 0;
  outer.add(inner);
  const tag = (o, role) => { o.userData.role = role; return o; };

  const matBody = new THREE.MeshStandardMaterial({ color: 0xa8b8c8, roughness: 0.52, metalness: 0.16 });
  const matTop = new THREE.MeshStandardMaterial({ color: 0x93a5b6, roughness: 0.5, metalness: 0.2 });
  const matVent = new THREE.MeshStandardMaterial({ color: 0x2b3542, roughness: 0.62, metalness: 0.2 });

  const N = 3;
  const totalW = N * D.W + (N - 1) * D.GAP;
  const bodyLen = N * D.W + (N - 1) * D.GAP;

  for (let i = 0; i < N; i++) {
    const cx = -bodyLen / 2 + D.W / 2 + i * (D.W + D.GAP);
    // 电池壳
    const box = new THREE.Mesh(new THREE.BoxGeometry(D.W, D.H, D.D), matBody);
    box.position.set(cx, D.H / 2, 0);
    inner.add(tag(box, 'cell'));
    // 顶盖
    const top = new THREE.Mesh(new THREE.BoxGeometry(D.W + 1.5, 6, D.D + 1.5), matTop);
    top.position.set(cx, D.H + 3, 0);
    inner.add(tag(top, 'cellTop'));
    // 前脸的竖向筋条（参考图那种）
    for (let k = -2; k <= 2; k++) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(D.RIB_W, D.H * 0.66, D.RIB_D), matTop);
      rib.position.set(cx + k * (D.W / 6.2), D.H * 0.42, D.D / 2 + D.RIB_D / 2);
      inner.add(tag(rib, 'rib'));
    }
    // 顶上的两个小通气塞
    [-1, 1].forEach((sz) => {
      const vent = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 2.4, 16), matVent);
      vent.position.set(cx, D.H + 7, sz * D.D * 0.24);
      inner.add(tag(vent, 'vent'));
    });
    // 每只电池顶上的两个极柱（左 − 右 +）
    [-1, 1].forEach((sx) => {
      const x = cx + sx * D.W * 0.28;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.6, 6, 16), MAT.brass);
      stem.position.set(x, D.H + 8, 0);
      inner.add(tag(stem, 'postStem'));
      const cap = new THREE.Mesh(knurledGeometry(D.POST_R, D.POST_H), sx < 0 ? MAT.black : MAT.red);
      cap.position.set(x, D.H + 11 + D.POST_H / 2, 0);
      inner.add(tag(cap, 'postCap'));
    });
  }

  // 相邻两节之间的连接片（参考图里那两段铜条）
  for (let i = 0; i < N - 1; i++) {
    const x1 = -bodyLen / 2 + D.W / 2 + i * (D.W + D.GAP) + D.W * 0.28;
    const x2 = -bodyLen / 2 + D.W / 2 + (i + 1) * (D.W + D.GAP) - D.W * 0.28;
    const len = Math.abs(x2 - x1);
    const strap = new THREE.Mesh(new THREE.BoxGeometry(len, 2.6, 7), MAT.copper);
    strap.position.set((x1 + x2) / 2, D.H + 15, 0);
    inner.add(tag(strap, 'strap'));
  }

  // 两个对外的接线柱：最左的 −、最右的 +
  const xMinus = -bodyLen / 2 + D.W / 2 - D.W * 0.28;
  const xPlus = bodyLen / 2 - D.W / 2 + D.W * 0.28;
  const termLocal = {
    '-': new THREE.Vector3(xMinus * S, (D.H + 11 + D.POST_H * 0.55) * S, 0),
    '+': new THREE.Vector3(xPlus * S, (D.H + 11 + D.POST_H * 0.55) * S, 0),
  };

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(totalW * S * 1.5, D.D * S * 1.9),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.35;
  shadow.renderOrder = -1;
  outer.add(shadow);

  const api = {
    group: outer,
    shadow,
    localToWorld: (v) => inner.localToWorld(v.clone()),
    worldToLocal: (v) => inner.worldToLocal(v.clone()),
    type: 'battery',
    label: '蓄电池',
    spec: '6 V（3 × 2 V）',
    bounds: { hw: totalW / 2 * S + 6, hd: D.D / 2 * S },
    topY: (D.H + 11 + D.POST_H + 8) * S,
    termLocal,
    termIdx: { '-': 0, '+': 1 },
    getCells: () => 3,
    emf: () => 6,
    // 🔴 必须显式给 emf（core 的 defaults 里有 emf:3，只给 cells 会被它盖住）
    getParams() {
      return { emf: 6, rInt: 0, cells: 3, emfPerCell: 2, rPerCell: 0 };
    },
  };
  return api;
}

// ============================================================
//  定值电阻（线绕电阻：瓷管 + 镍铬丝 + 两端金属帽 + 两个接线柱）
// ============================================================
export const RES_DIM = {
  R: 11, L: 120,          // 瓷管
  WIND_R: 12.4, WIRE_R: 0.55, TURNS: 64,
  CAP_R: 13.5, CAP_L: 11,
  POST_X: 46, POST_R: 4.6, POST_H: 13,
  FOOT_X: 44, SCALE: 2.0,
};

export function buildResistor(opts) {
  opts = opts || {};
  const D = RES_DIM;
  const S = D.SCALE;
  const outer = new THREE.Group();
  const inner = new THREE.Group();
  inner.scale.setScalar(S);
  inner.position.y = 0;
  outer.add(inner);
  const tag = (o, role) => { o.userData.role = role; return o; };

  const Y0 = D.CAP_R + 6;              // 轴心高度（下面还有安装脚）

  // 瓷管
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(D.R, D.R, D.L, 36, 1, true), MAT.ceramic);
  tube.rotation.z = Math.PI / 2;
  tube.position.set(0, Y0, 0);
  inner.add(tag(tube, 'tube'));

  // 绕线（螺旋管，用一条 TubeGeometry）
  const pts = [];
  const half = D.L / 2 - 6;
  for (let i = 0; i <= D.TURNS * 8; i++) {
    const t = i / (D.TURNS * 8);
    const a = t * D.TURNS * Math.PI * 2;
    pts.push(new THREE.Vector3(-half + t * half * 2, Y0 + Math.sin(a) * D.WIND_R, Math.cos(a) * D.WIND_R));
  }
  const windGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), D.TURNS * 8, D.WIRE_R, 6, false);
  inner.add(tag(new THREE.Mesh(windGeo, MAT.copper), 'winding'));

  // 两端金属帽
  [-1, 1].forEach((sx) => {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(D.CAP_R, D.CAP_R, D.CAP_L, 30), MAT.steel);
    cap.rotation.z = Math.PI / 2;
    cap.position.set(sx * (D.L / 2 + D.CAP_L / 2 - 2), Y0, 0);
    inner.add(tag(cap, 'endCap'));
    // 安装脚（L 形支架）
    const leg = new THREE.Mesh(new THREE.BoxGeometry(6, Y0, 22), MAT.steel);
    leg.position.set(sx * D.FOOT_X, Y0 / 2, 0);
    inner.add(tag(leg, 'foot'));
    const foot = new THREE.Mesh(new THREE.BoxGeometry(14, 3, 26), MAT.steel);
    foot.position.set(sx * D.FOOT_X, 1.5, 0);
    inner.add(tag(foot, 'footPad'));
    // 接线柱
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 8, 14), MAT.brass);
    stem.position.set(sx * D.POST_X, Y0 + D.CAP_R + 2, 0);
    inner.add(tag(stem, 'postStem'));
    const cap2 = new THREE.Mesh(knurledGeometry(D.POST_R, D.POST_H), MAT.brass);
    cap2.position.set(sx * D.POST_X, Y0 + D.CAP_R + 6 + D.POST_H / 2, 0);
    inner.add(tag(cap2, 'postCap'));
  });

  const termLocal = {
    a: new THREE.Vector3(-D.POST_X * S, (Y0 + D.CAP_R + 6 + D.POST_H * 0.55) * S, 0),
    b: new THREE.Vector3(D.POST_X * S, (Y0 + D.CAP_R + 6 + D.POST_H * 0.55) * S, 0),
  };

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(D.L * S * 1.5, 90),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.35;
  shadow.renderOrder = -1;
  outer.add(shadow);

  const api = {
    group: outer, shadow,
    localToWorld: (v) => inner.localToWorld(v.clone()),
    worldToLocal: (v) => inner.worldToLocal(v.clone()),
    type: 'resistor',
    label: '定值电阻',
    spec: '10 Ω',
    bounds: { hw: (D.L / 2 + D.CAP_L) * S + 6, hd: 34 * S },
    topY: (Y0 + D.CAP_R + 6 + D.POST_H + 10) * S,
    termLocal,
    termIdx: { a: 0, b: 1 },
    R: opts.R || 10,
    getParams() { return { R: api.R }; },
    setR(v) { api.R = v; api.spec = v + ' Ω'; },
  };
  return api;
}

// ============================================================
//  学生电源（0~9 V 连续可调，面板上有电压旋钮 + 电源开关 + 两个输出柱）
// ============================================================
export const PWR_DIM = {
  W: 190, D: 122, H: 96,
  KNOB_R: 22, KNOB_H: 14, KNOB_X: -52, KNOB_Y: 40,
  POST_X: 46, POST_Z: 40, POST_R: 5, POST_H: 12,
  SCALE: 1.5,
};

let PWR_FACE_TEX = null;
function powerFaceTexture() {
  if (PWR_FACE_TEX) return PWR_FACE_TEX;
  const W = 760, H = 384;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#dfe4ea'; g.fillRect(0, 0, W, H);
  // 「学生电源」字样
  g.fillStyle = '#5b6673';
  g.font = 'bold 46px "PingFang SC", "Microsoft YaHei", sans-serif';
  g.textAlign = 'right'; g.textBaseline = 'middle';
  g.fillText('学生电源', W - 60, 96);
  // 电压刻度弧（0~9 V）
  const cx = 200, cy = 250, R = 118;
  g.strokeStyle = '#4a5563'; g.lineWidth = 3;
  g.beginPath(); g.arc(cx, cy, R, -Math.PI * 0.86, -Math.PI * 0.14); g.stroke();
  const marks = [0, 1.5, 3, 4.5, 6, 7.5, 9];
  g.textAlign = 'center'; g.textBaseline = 'middle';
  marks.forEach((v, i) => {
    const a = -Math.PI * 0.86 + (Math.PI * 0.72) * (i / (marks.length - 1));
    const c = Math.cos(a), sn = Math.sin(a);
    g.beginPath();
    g.moveTo(cx + c * R, cy + sn * R);
    g.lineTo(cx + c * (R - 14), cy + sn * (R - 14));
    g.strokeStyle = '#4a5563'; g.lineWidth = 3; g.stroke();
    g.fillStyle = '#3d4753';
    g.font = 'bold 24px "Helvetica Neue", Arial, sans-serif';
    g.fillText(String(v), cx + c * (R + 22), cy + sn * (R + 22));
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  PWR_FACE_TEX = tex;
  return tex;
}

export function buildPower() {
  const D = PWR_DIM;
  const S = D.SCALE;
  const outer = new THREE.Group();
  const inner = new THREE.Group();
  inner.scale.setScalar(S);
  inner.position.y = 0;
  outer.add(inner);
  const tag = (o, role) => { o.userData.role = role; return o; };

  const matCase = new THREE.MeshStandardMaterial({ color: 0xc3ccd6, roughness: 0.5, metalness: 0.22 });
  const matFace = new THREE.MeshStandardMaterial({ color: 0xdfe4ea, roughness: 0.58, metalness: 0.06 });
  const matFaceTex = new THREE.MeshStandardMaterial({ map: powerFaceTexture(), roughness: 0.58, metalness: 0.06 });

  // 机箱
  const box = new THREE.Mesh(new THREE.BoxGeometry(D.W, D.H, D.D), matCase);
  box.position.set(0, D.H / 2, 0);
  inner.add(tag(box, 'case'));
  // 前面板
  const face = new THREE.Mesh(new THREE.PlaneGeometry(D.W - 8, D.H - 8), matFaceTex);
  face.position.set(0, D.H / 2, D.D / 2 + 0.6);
  inner.add(tag(face, 'face'));

  // 电压旋钮（带指针）
  const knob = new THREE.Group();
  knob.position.set(D.KNOB_X, D.KNOB_Y, D.D / 2 + 1);
  inner.add(tag(knob, 'knob'));
  const kBody = new THREE.Mesh(new THREE.CylinderGeometry(D.KNOB_R, D.KNOB_R * 1.05, D.KNOB_H, 32), MAT.plastic);
  kBody.rotation.x = Math.PI / 2;
  kBody.position.z = D.KNOB_H / 2;
  knob.add(kBody);
  const kCap = new THREE.Mesh(new THREE.CylinderGeometry(D.KNOB_R * 0.62, D.KNOB_R * 0.62, 3, 28), MAT.steel);
  kCap.rotation.x = Math.PI / 2;
  kCap.position.z = D.KNOB_H + 1;
  knob.add(kCap);
  const kMark = new THREE.Mesh(new THREE.BoxGeometry(2.4, D.KNOB_R * 0.9, 1.6),
    new THREE.MeshBasicMaterial({ color: 0xe2e8f0 }));
  kMark.position.set(0, D.KNOB_R * 0.45, D.KNOB_H + 1.2);
  knob.add(kMark);

  // 电源开关（面板左下的小翘板）
  const swBox = new THREE.Mesh(new THREE.BoxGeometry(20, 26, 4), MAT.plastic);
  swBox.position.set(-76, 22, D.D / 2 + 2);
  inner.add(tag(swBox, 'powerSwitch'));
  const swRocker = new THREE.Mesh(new THREE.BoxGeometry(14, 18, 3), MAT.plasticSoft);
  swRocker.position.set(-76, 22, D.D / 2 + 4);
  inner.add(tag(swRocker, 'rocker'));

  // 两个输出柱（+ / −）
  const termLocal = {};
  [[-1, '+'], [1, '-']].forEach(([sx, name]) => {
    const x = sx * D.POST_X;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(D.POST_R + 3, D.POST_R + 3.4, 2.6, 22), MAT.black);
    base.rotation.x = Math.PI / 2;
    base.position.set(x, 26, D.D / 2 + 1.4);
    inner.add(tag(base, 'postPad'));
    const cap = new THREE.Mesh(knurledGeometry(D.POST_R, D.POST_H), name === '+' ? MAT.red : MAT.black);
    cap.rotation.x = Math.PI / 2;
    cap.position.set(x, 26, D.D / 2 + 2.6 + D.POST_H / 2);
    inner.add(tag(cap, 'postCap'));
    termLocal[name] = new THREE.Vector3(x * S, 26 * S, (D.D / 2 + 4 + D.POST_H * 0.5) * S);
  });

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(D.W * S * 1.35, D.D * S * 1.5),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.35;
  shadow.renderOrder = -1;
  outer.add(shadow);

  const api = {
    group: outer, shadow,
    localToWorld: (v) => inner.localToWorld(v.clone()),
    worldToLocal: (v) => inner.worldToLocal(v.clone()),
    type: 'power',
    label: '学生电源',
    spec: '0~9 V 可调',
    bounds: { hw: D.W / 2 * S + 6, hd: D.D / 2 * S + 8 },
    topY: (D.H + 16) * S,
    termLocal,
    termIdx: { '+': 0, '-': 1 },
    emf: 6,
    on: true,
    getParams() { return { emf: api.emf, rInt: 0, on: api.on }; },
    setEmf(v) {
      api.emf = Math.max(0, Math.min(9, v));
      api.spec = api.emf.toFixed(1) + ' V';
      // 旋钮转到对应刻度：0 V 在左（-0.86π），9 V 在右（-0.14π）
      const t = api.emf / 9;
      knob.rotation.z = -(Math.PI * 0.72) * (1 - t) + Math.PI * 0.36;
    },
    setOn(v) { api.on = !!v; },
    knob,
  };
  api.setEmf(6);
  return api;
}

// ============================================================
//  电阻箱（四个转盘 ×1 / ×10 / ×100 / ×1k，0~9999 Ω，步进 1 Ω）
// ============================================================
export const RBOX_DIM = { W: 128, D: 168, H: 52, DIAL_R: 24, DIAL_H: 11, SCALE: 1.75 };

const RBOX_LAYOUT = [
  { k: 'd100', x: -34, z: -44, label: '×100' },
  { k: 'd1000', x: 34, z: -44, label: '×1 k' },
  { k: 'd1', x: -34, z: 44, label: '×1' },
  { k: 'd10', x: 34, z: 44, label: '×10' },
];

let RBOX_TEX = null;
function resistanceBoxTexture() {
  if (RBOX_TEX) return RBOX_TEX;
  const W = 512, H = 672;                       // 128 × 168 mm
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#9fc9dc'; g.fillRect(0, 0, W, H);
  const px = (x) => (x / 128 + 0.5) * W;
  const py = (z) => (z / 168 + 0.5) * H;
  const sx = W / 128;
  // 四个角螺丝
  [[14, 16], [W - 14, 16], [14, H - 16], [W - 14, H - 16]].forEach(([x, y]) => {
    g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2);
    g.fillStyle = '#c8d6de'; g.fill();
    g.strokeStyle = '#7f929d'; g.lineWidth = 2; g.stroke();
  });
  RBOX_LAYOUT.forEach((d) => {
    // 🔴 环半径 36 时，相邻两盘（中心相距 68 mm）的数字会撞在一起 ⇒ 收到 32
    const cx = px(d.x), cy = py(d.z), R = 32 * sx;
    // 数字环（0~9 均布）
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
      g.fillStyle = '#2c3a45';
      g.font = 'bold 22px "Helvetica Neue", Arial, sans-serif';
      g.fillText(String(i), cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    }
    // 红色三角指示
    g.beginPath();
    g.moveTo(cx, cy + R + 26); g.lineTo(cx - 11, cy + R + 46); g.lineTo(cx + 11, cy + R + 46);
    g.closePath(); g.fillStyle = '#c0392b'; g.fill();
    // 倍数标注
    g.fillStyle = '#1f2b34';
    g.font = 'bold 26px "Helvetica Neue", Arial, sans-serif';
    g.fillText(d.label, cx, cy + R + 66);
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  RBOX_TEX = tex;
  return tex;
}

export function buildResistanceBox() {
  const D = RBOX_DIM;
  const S = D.SCALE;
  const outer = new THREE.Group();
  const inner = new THREE.Group();
  inner.scale.setScalar(S);
  inner.position.y = 0;
  outer.add(inner);
  const tag = (o, role) => { o.userData.role = role; return o; };

  const matBox = new THREE.MeshStandardMaterial({ color: 0x8fb8cc, roughness: 0.5, metalness: 0.12 });
  const matTop = new THREE.MeshStandardMaterial({ map: resistanceBoxTexture(), roughness: 0.56, metalness: 0.05 });
  const matDial = new THREE.MeshStandardMaterial({ color: 0x8b949e, roughness: 0.36, metalness: 0.72 });

  const box = new THREE.Mesh(new THREE.BoxGeometry(D.W, D.H, D.D), matBox);
  box.position.set(0, D.H / 2, 0);
  inner.add(tag(box, 'case'));
  const topFace = new THREE.Mesh(new THREE.PlaneGeometry(D.W, D.D), matTop);
  topFace.rotation.x = -Math.PI / 2;
  topFace.position.set(0, D.H + 0.5, 0);
  inner.add(tag(topFace, 'topFace'));

  const dials = {};
  RBOX_LAYOUT.forEach((d) => {
    const grp = new THREE.Group();
    grp.position.set(d.x, D.H + 1, d.z);
    inner.add(tag(grp, 'dial'));
    // 八棱柱旋钮
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(D.DIAL_R, D.DIAL_R * 1.04, D.DIAL_H, 8), matDial);
    knob.position.y = D.DIAL_H / 2;
    grp.add(knob);
    // 中心的凹坑
    const pit = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 2, 12), MAT.black);
    pit.position.y = D.DIAL_H + 0.4;
    grp.add(pit);
    // 旋钮上的白色指针（指到当前档位）
    const ptr = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.6, D.DIAL_R * 0.8),
      new THREE.MeshBasicMaterial({ color: 0xf1f5f9 }));
    ptr.position.set(0, D.DIAL_H + 0.8, -D.DIAL_R * 0.5);
    grp.add(ptr);
    dials[d.k] = { grp, ptr };
  });

  // 两个接线柱（前缘中间）
  const termLocal = {};
  [[-1, 'a'], [1, 'b']].forEach(([sx, name]) => {
    const x = sx * 16;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 7, 2.6, 22), MAT.black);
    base.position.set(x, D.H + 1.3, D.D / 2 - 14);
    inner.add(tag(base, 'postPad'));
    const cap = new THREE.Mesh(knurledGeometry(5, 12), MAT.steel);
    cap.position.set(x, D.H + 2.6 + 6, D.D / 2 - 14);
    inner.add(tag(cap, 'postCap'));
    termLocal[name] = new THREE.Vector3(x * S, (D.H + 2.6 + 6.6) * S, (D.D / 2 - 14) * S);
  });

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(D.W * S * 1.5, D.D * S * 1.35),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.35;
  shadow.renderOrder = -1;
  outer.add(shadow);

  const api = {
    group: outer, shadow,
    localToWorld: (v) => inner.localToWorld(v.clone()),
    worldToLocal: (v) => inner.worldToLocal(v.clone()),
    type: 'resistancebox',
    label: '电阻箱',
    spec: '0~9999 Ω',
    bounds: { hw: D.W / 2 * S + 6, hd: D.D / 2 * S + 6 },
    topY: (D.H + 30) * S,
    termLocal,
    termIdx: { a: 0, b: 1 },
    d1: 0, d10: 0, d100: 0, d1000: 0,
    getParams() {
      return { d1: api.d1, d10: api.d10, d100: api.d100, d1000: api.d1000 };
    },
    getR() { return api.d1 + api.d10 * 10 + api.d100 * 100 + api.d1000 * 1000; },
    setDigit(k, v) {
      api[k] = Math.max(0, Math.min(9, Math.round(v)));
      // 指针指向对应档位（0 在正上方，顺时针每档 36°）
      const d = dials[k];
      if (d) d.grp.rotation.y = -(api[k] / 10) * Math.PI * 2;
      api.spec = api.getR() + ' Ω';
    },
    dials,
  };
  RBOX_LAYOUT.forEach((d) => api.setDigit(d.k, 0));
  return api;
}

// ============================================================
//  导线电阻演示板（木板上四根现成的电阻丝 a/b/c/d，两两对照）
// ============================================================
export const RBOARD_DIM = { W: 214, D: 118, H: 14, WIRE_Y: 20, POST_R: 4.2, POST_H: 11, SCALE: 1.5 };

// 四根丝的规格与长度（两两对照：只变一个因素）
export const RBOARD_WIRES = [
  { id: 'a', y: -36, len: 168, color: 0x8c4a2f, spec: '镍铬 φ0.30 1.0 m' },
  { id: 'b', y: -12, len: 168, color: 0x8c4a2f, spec: '镍铬 φ0.30 0.5 m' },
  { id: 'c', y: 12, len: 96, color: 0x8c4a2f, spec: '镍铬 φ0.60 1.0 m' },
  { id: 'd', y: 36, len: 96, color: 0x6b7f96, spec: '康铜 φ0.30 1.0 m' },
];

let RBOARD_TEX = null;
function rheoboardTexture() {
  if (RBOARD_TEX) return RBOARD_TEX;
  const W = 856, H = 472;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  // 木纹底
  g.fillStyle = '#d9c9a3'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 90; i++) {
    g.strokeStyle = 'rgba(150,120,70,' + (0.03 + Math.random() * 0.05) + ')';
    g.lineWidth = 1 + Math.random() * 2;
    g.beginPath();
    const y = Math.random() * H;
    g.moveTo(0, y);
    g.bezierCurveTo(W * 0.3, y + (Math.random() - 0.5) * 26, W * 0.7, y + (Math.random() - 0.5) * 26, W, y);
    g.stroke();
  }
  g.fillStyle = '#3b3020';
  g.textAlign = 'left'; g.textBaseline = 'middle';
  g.font = 'bold 40px "Helvetica Neue", Arial, sans-serif';
  RBOARD_WIRES.forEach((w) => {
    const y = (w.y / RBOARD_DIM.D + 0.5) * H;
    g.fillText(w.id, 26, y);
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  RBOARD_TEX = tex;
  return tex;
}

export function buildRheoboard() {
  const D = RBOARD_DIM;
  const S = D.SCALE;
  const outer = new THREE.Group();
  const inner = new THREE.Group();
  inner.scale.setScalar(S);
  inner.position.y = 0;
  outer.add(inner);
  const tag = (o, role) => { o.userData.role = role; return o; };

  const matWood = new THREE.MeshStandardMaterial({ color: 0xcdb98d, roughness: 0.78, metalness: 0.02 });
  const matTop = new THREE.MeshStandardMaterial({ map: rheoboardTexture(), roughness: 0.76, metalness: 0.02 });

  const board = new THREE.Mesh(new THREE.BoxGeometry(D.W, D.H, D.D), matWood);
  board.position.set(0, D.H / 2 + 4, 0);
  inner.add(tag(board, 'board'));
  const topFace = new THREE.Mesh(new THREE.PlaneGeometry(D.W, D.D), matTop);
  topFace.rotation.x = -Math.PI / 2;
  topFace.position.set(0, D.H + 4.4, 0);
  inner.add(tag(topFace, 'boardTop'));

  // 两条小木脚
  [-1, 1].forEach((sx) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(16, 10, 20), matWood);
    leg.position.set(sx * (D.W / 2 - 26), 5, 0);
    inner.add(tag(leg, 'leg'));
  });

  // 四根电阻丝 + 八个接线柱
  const termLocal = {};
  // 🔴 端子名必须是 1a/1b … 4a/4b：原来拼成 w.id + 'a' 得到 aa/ab，
  //    和 termIdx（1a…4b）对不上 ⇒ 接线时 termLocal['1a'] 是 undefined。
  RBOARD_WIRES.forEach((w, wi) => {
    const x0 = -w.len / 2, x1 = w.len / 2;
    const wire = new THREE.Mesh(
      new THREE.CylinderGeometry(1.05, 1.05, w.len, 10),
      new THREE.MeshStandardMaterial({ color: w.color, roughness: 0.36, metalness: 0.7 })
    );
    wire.rotation.z = Math.PI / 2;
    wire.position.set(0, D.H + 4.4 + D.WIRE_Y, w.y);
    inner.add(tag(wire, 'wire'));
    [x0, x1].forEach((x, i) => {
      const name = (wi + 1) + (i === 0 ? 'a' : 'b');
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.4, 7, 14), MAT.brass);
      stem.position.set(x, D.H + 4.4 + D.WIRE_Y + 1, w.y);
      inner.add(tag(stem, 'postStem'));
      const cap = new THREE.Mesh(knurledGeometry(D.POST_R, D.POST_H), MAT.brass);
      cap.position.set(x, D.H + 4.4 + D.WIRE_Y + 5 + D.POST_H / 2, w.y);
      inner.add(tag(cap, 'postCap'));
      termLocal[name] = new THREE.Vector3(x * S, (D.H + 4.4 + D.WIRE_Y + 5 + D.POST_H * 0.55) * S, w.y * S);
    });
  });

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(D.W * S * 1.3, D.D * S * 1.6),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.35;
  shadow.renderOrder = -1;
  outer.add(shadow);

  const api = {
    group: outer, shadow,
    localToWorld: (v) => inner.localToWorld(v.clone()),
    worldToLocal: (v) => inner.worldToLocal(v.clone()),
    type: 'rheoboard',
    label: '电阻示教板',
    spec: '四根丝 a/b/c/d',
    bounds: { hw: D.W / 2 * S + 6, hd: D.D / 2 * S + 6 },
    topY: (D.H + 4.4 + D.WIRE_Y + 30) * S,
    termLocal,
    termIdx: { '1a': 0, '1b': 1, '2a': 2, '2b': 3, '3a': 4, '3b': 5, '4a': 6, '4b': 7 },
    showSpec: true,
    getParams() { return { showSpec: api.showSpec }; },
  };
  return api;
}

// ============================================================
//  发光二极管（φ5 直插 LED：粉色环氧封装 + 两条引脚）
// ============================================================
export const LED_DIM = {
  DOME_R: 4.6, BODY_R: 4.2, BODY_H: 6.4, FLANGE_R: 5.4, FLANGE_H: 1.2,
  LEAD_R: 0.5, LEAD_LEN: 24, SCALE: 3.4,
};

export function buildLed(opts) {
  opts = opts || {};
  const D = LED_DIM;
  const S = D.SCALE;
  const outer = new THREE.Group();
  const inner = new THREE.Group();
  inner.scale.setScalar(S);
  inner.position.y = 0;
  outer.add(inner);
  const tag = (o, role) => { o.userData.role = role; return o; };

  const COLORS = {
    red: { body: 0xd6337a, Vf: 1.8, rgb: 0xff3b6b },
    green: { body: 0x8fd14f, Vf: 2.1, rgb: 0x3ae27a },
    blue: { body: 0x4f7fd1, Vf: 3.1, rgb: 0x4f8cff },
  };
  let color = COLORS[opts.color] ? opts.color : 'red';

  const matBody = new THREE.MeshStandardMaterial({
    color: COLORS[color].body, roughness: 0.12, metalness: 0.05,
    transparent: true, opacity: 0.78,
  });
  const matLead = new THREE.MeshStandardMaterial({ color: 0xcfd6dd, roughness: 0.3, metalness: 0.86 });
  const matDie = new THREE.MeshBasicMaterial({ color: 0x2a1220 });

  // 底座（让 LED 能立在桌面上；真实实验里是插在面包板/灯座上的）
  const base = new THREE.Mesh(new THREE.CylinderGeometry(11, 11.5, 4, 26), MAT.plastic);
  base.position.set(0, 2, 0);
  inner.add(tag(base, 'base'));

  const Y0 = 4;                       // 底座上表面
  // 引脚：两根竖直到封装底部
  [-1, 1].forEach((sx) => {
    const lead = new THREE.Mesh(new THREE.CylinderGeometry(D.LEAD_R, D.LEAD_R, 9, 10), matLead);
    lead.position.set(sx * 1.5, Y0 + 4.5, 0);
    inner.add(tag(lead, 'lead'));
  });
  // 封装主体（下粗上略细）
  const body = new THREE.Mesh(new THREE.CylinderGeometry(D.BODY_R, D.BODY_R * 1.08, D.BODY_H, 26), matBody);
  body.position.set(0, Y0 + 9 + D.BODY_H / 2, 0);
  inner.add(tag(body, 'body'));
  // 法兰盘（底部那圈凸缘）
  const flange = new THREE.Mesh(new THREE.CylinderGeometry(D.FLANGE_R, D.FLANGE_R, D.FLANGE_H, 26), matBody);
  flange.position.set(0, Y0 + 9 + D.FLANGE_H / 2, 0);
  inner.add(tag(flange, 'flange'));
  // 半球顶
  const domeY = Y0 + 9 + D.BODY_H;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(D.DOME_R, 26, 16, 0, Math.PI * 2, 0, Math.PI / 2), matBody);
  dome.position.set(0, domeY, 0);
  inner.add(tag(dome, 'dome'));
  // 里面的芯片（一小块暗色，亮起来时会被照出来）
  const die = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 1.6), matDie);
  die.position.set(0, domeY - 2.4, 0);
  inner.add(tag(die, 'die'));

  // 发光（只在导通时）
  const glowMat = new THREE.MeshBasicMaterial({
    color: COLORS[color].rgb, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const glow = new THREE.Mesh(new THREE.SphereGeometry(D.DOME_R + 1.6, 20, 14), glowMat);
  glow.position.set(0, domeY - 1.6, 0);
  inner.add(tag(glow, 'glow'));
  const lamp = new THREE.PointLight(COLORS[color].rgb, 0, 260, 2);
  lamp.position.set(0, domeY - 1.6, 0);
  inner.add(tag(lamp, 'ledLight'));

  const termLocal = {
    '+': new THREE.Vector3(-1.5 * S, (Y0 + 4) * S, 0),
    '-': new THREE.Vector3(1.5 * S, (Y0 + 4) * S, 0),
  };

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(70, 60),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.3;
  shadow.renderOrder = -1;
  outer.add(shadow);

  let lit = 0, shown = 0, over = false;
  function apply() {
    const b = Math.max(0, Math.min(1, shown));
    glowMat.opacity = 0.75 * b;
    glow.scale.setScalar(1 + 0.5 * b);
    lamp.intensity = 0.5 * b;
    matBody.emissive.set(COLORS[color].rgb);
    matBody.emissiveIntensity = 1.4 * b;
  }
  apply();

  const api = {
    group: outer, shadow,
    localToWorld: (v) => inner.localToWorld(v.clone()),
    worldToLocal: (v) => inner.worldToLocal(v.clone()),
    type: 'led',
    label: '发光二极管',
    spec: '红色 1.8 V',
    bounds: { hw: 22 * S, hd: 22 * S },
    topY: (domeY + 8) * S,
    termLocal,
    termIdx: { '+': 0, '-': 1 },
    color, flip: false,
    getParams() { return { color: api.color, flip: api.flip }; },
    setColor(c) {
      if (!COLORS[c]) return;
      color = c;
      matBody.color.setHex(COLORS[c].body);
      glowMat.color.setHex(COLORS[c].rgb);
      lamp.color.setHex(COLORS[c].rgb);
      api.spec = ({ red: '红色 1.8 V', green: '绿色 2.1 V', blue: '蓝色 3.1 V' })[c];
      apply();
    },
    // 求解结果：导通且电流够 → 亮
    setLit(rec) {
      if (!rec) { lit = 0; return; }
      lit = rec.i && Math.abs(rec.i) > 1e-4 ? Math.min(1, Math.abs(rec.i) / 0.02) : 0;
      over = !!rec.overload;
    },
    step(dt) {
      const d = lit - shown;
      if (Math.abs(d) < 0.004) { if (shown !== lit) { shown = lit; apply(); } return; }
      shown += d * Math.min(1, dt * 10);
      apply();
    },
    debugLed() {
      return { glowOpacity: +glowMat.opacity.toFixed(3), light: +lamp.intensity.toFixed(3), shown: +shown.toFixed(3) };
    },
    getBrightness: () => shown,
  };
  return api;
}

// ============================================================
//  焦耳定律演示器（两只瓶 + 两根 U 形管 + 中间的刻度尺）
// ------------------------------------------------------------
// 端子：0/1 = 甲（左）瓶的两根柱，2/3 = 乙（右）瓶。
// 通电后瓶里的电阻丝放热，U 形管里的液柱被顶高 —— 液柱高度按
// circuit-core 给的产热功率 rec.boxes[i].p 累积（真实验也是这样：
// 看的是「谁升得快」，不是瞬时功率）。
// ============================================================
// ============================================================
//  焦耳定律演示器（人教版 图18.4-2：两只金属容器 + U 形管压力计）
// ------------------------------------------------------------
// 旧版做成了两只【玻璃瓶】各套一根 U 形管，而且两臂液面一起升 —— 那不对：
// 真正的 U 形管压力计一臂接容器内腔、一臂通大气，容器里空气被加热后压强变大，
// 接容器那臂的液面【下降】、通大气那臂【上升】，两臂的高度差才是读数。
// 这一版照实物重做：
//   · 容器 = 拉丝金属圆筒 + 底法兰 + 深色顶盖 + 四颗螺丝；
//   · 盖上插一根 U 形玻璃管（A 臂插进盖子接内腔，B 臂下端悬空开口通大气），
//     两臂顶端用半环连通，液体在连通器里守恒 —— 一边降多少，另一边升多少；
//   · 接线柱在盖子前半部（不挡管子），甲+/甲−、乙+/乙− 四柱。
// 电气仍是【两个互相独立的电阻】（circuit-core 的 joule: 4 端子），
// 学生自己把两只容器串起来（同电流比电阻）或并起来（同电阻比电流）。
// ============================================================
export const JOULE_DIM = {
  BODY_R: 38, BODY_H: 66, LID_R: 42, LID_H: 9,
  X: 92,                        // 两只容器中心距的一半
  TUBE_R: 4.4, TUBE_DX: 14,     // U 形管：两臂半径 / 两臂间距的一半
  TUBE_LEN: 92,                 // 两臂从盖顶向上伸出的长度
  TUBE_GAP: 26,                 // B 臂下端离盖顶的空隙（开口通大气）
  POST_X: 18, POST_Z: 24,
  SCALE: 1.35,
};

export function buildJoule() {
  const D = JOULE_DIM;
  const S = D.SCALE;
  const outer = new THREE.Group();
  const inner = new THREE.Group();
  inner.scale.setScalar(S);
  outer.add(inner);
  const tag = (o, role) => { o.userData.role = role; return o; };

  const matBody = new THREE.MeshStandardMaterial({ color: 0xc2cbd6, roughness: 0.3, metalness: 0.76 });
  const matBodyDark = new THREE.MeshStandardMaterial({ color: 0x78838f, roughness: 0.42, metalness: 0.62 });
  const matLid = new THREE.MeshStandardMaterial({ color: 0x46525f, roughness: 0.52, metalness: 0.4 });
  // 🔴 细玻璃管不能用瓶身那档透明度：0.30 在浅色桌面上几乎看不见，
  //    液柱会像「悬在空中的红点」。管子单独给一档更实的玻璃。
  const matGlass = new THREE.MeshStandardMaterial({
    color: 0xdceffa, roughness: 0.07, metalness: 0,
    transparent: true, opacity: 0.44, depthWrite: false, side: THREE.DoubleSide,
  });
  const matLiquid = new THREE.MeshStandardMaterial({ color: 0xd2314a, roughness: 0.22, metalness: 0.02 });
  const matCoil = new THREE.MeshStandardMaterial({ color: 0x9a5a33, roughness: 0.36, metalness: 0.66 });
  const matRuler = new THREE.MeshStandardMaterial({ color: 0xf3f6f9, roughness: 0.72, metalness: 0.02 });

  const Y0 = 0;                                   // 容器底【就在台面上】（不是悬空 4 mm）
  const lidTop = Y0 + D.BODY_H + D.LID_H;
  const topY = lidTop + D.TUBE_LEN;
  const MID = 36;                                 // 平衡时两臂液柱高度
  const SWING = 26;                               // 满功率时液面移动的幅度

  const liquids = [];      // [[A 柱, B 柱], ...]
  const termLocal = {};

  [0, 1].forEach((si) => {
    const cx = si === 0 ? -D.X : D.X;

    // ── 容器 ───────────────────────────────────────────────
    const body = new THREE.Mesh(new THREE.CylinderGeometry(D.BODY_R, D.BODY_R, D.BODY_H, 40, 1, true), matBody);
    body.position.set(cx, Y0 + D.BODY_H / 2, 0);
    inner.add(tag(body, 'body'));
    const bot = new THREE.Mesh(new THREE.CylinderGeometry(D.BODY_R, D.BODY_R, 3, 40), matBodyDark);
    bot.position.set(cx, Y0 + 1.5, 0);
    inner.add(tag(bot, 'bodyBottom'));
    const flange = new THREE.Mesh(new THREE.CylinderGeometry(D.BODY_R + 5, D.BODY_R + 5, 5, 40), matBodyDark);
    flange.position.set(cx, Y0 + 6.5, 0);
    inner.add(tag(flange, 'flange'));
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(D.LID_R, D.LID_R, D.LID_H, 40), matLid);
    lid.position.set(cx, Y0 + D.BODY_H + D.LID_H / 2, 0);
    inner.add(tag(lid, 'lid'));
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + k * Math.PI / 2;
      const sc = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 2.4, 10), MAT.steel);
      sc.position.set(cx + Math.cos(a) * (D.LID_R - 8), lidTop + 1.2, Math.sin(a) * (D.LID_R - 8));
      inner.add(tag(sc, 'screw'));
    }
    // 容器里的电阻丝（螺旋，透过盖子看不见，但拆解视角/俯视能看到一点）
    const pts = [];
    for (let i = 0; i <= 180; i++) {
      const t = i / 180, a = t * Math.PI * 2 * 6;
      pts.push(new THREE.Vector3(cx + Math.cos(a) * 20, Y0 + 14 + t * 32, Math.sin(a) * 20));
    }
    inner.add(tag(new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 180, 1.4, 6, false), matCoil), 'coil'));

    // ── U 形管压力计 ───────────────────────────────────────
    // A 臂（左）：插进盖子，通容器内腔；B 臂（右）：下端悬空 = 通大气。
    const ax = cx - D.TUBE_DX, bx = cx + D.TUBE_DX;
    const aBottom = lidTop - 4;                    // A 臂插进盖子 4 mm
    const bBottom = lidTop + D.TUBE_GAP;           // B 臂下端开口
    const tubeA = new THREE.Mesh(new THREE.CylinderGeometry(D.TUBE_R, D.TUBE_R, topY - aBottom, 20, 1, true), matGlass);
    tubeA.position.set(ax, (aBottom + topY) / 2, 0);
    tubeA.renderOrder = 2;
    inner.add(tag(tubeA, 'tubeA'));
    const tubeB = new THREE.Mesh(new THREE.CylinderGeometry(D.TUBE_R, D.TUBE_R, topY - bBottom, 20, 1, true), matGlass);
    tubeB.position.set(bx, (bBottom + topY) / 2, 0);
    tubeB.renderOrder = 2;
    inner.add(tag(tubeB, 'tubeB'));
    // B 臂下端的小喇叭口（一看就知道是「敞着的」）
    const flare = new THREE.Mesh(new THREE.CylinderGeometry(D.TUBE_R + 2.2, D.TUBE_R, 5, 18, 1, true), matGlass);
    flare.position.set(bx, bBottom + 2.5, 0);
    flare.renderOrder = 2;
    inner.add(tag(flare, 'tubeFlare'));
    const arc = new THREE.Mesh(new THREE.TorusGeometry(D.TUBE_DX, D.TUBE_R, 10, 26, Math.PI), matGlass);
    arc.position.set(cx, topY, 0);
    arc.renderOrder = 2;
    inner.add(tag(arc, 'tubeArc'));

    // 液柱：两臂等粗 ⇒ 液量守恒（A 降多少，B 升多少）
    const colA = new THREE.Mesh(new THREE.CylinderGeometry(D.TUBE_R * 0.88, D.TUBE_R * 0.88, 1, 16), matLiquid);
    colA.position.set(ax, 0, 0);
    inner.add(tag(colA, 'liquidA'));
    const colB = new THREE.Mesh(new THREE.CylinderGeometry(D.TUBE_R * 0.88, D.TUBE_R * 0.88, 1, 16), matLiquid);
    colB.position.set(bx, 0, 0);
    inner.add(tag(colB, 'liquidB'));
    liquids.push({ colA, colB, aBottom, bBottom });

    // ── 两根接线柱（盖子前半部）────────────────────────────
    [-1, 1].forEach((sx) => {
      const x = cx + sx * D.POST_X, z = D.POST_Z;
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(6, 6.4, 2.4, 20), MAT.black);
      pad.position.set(x, lidTop + 1.2, z);
      inner.add(tag(pad, 'postPad'));
      const cap = new THREE.Mesh(knurledGeometry(4.2, 11), sx < 0 ? MAT.red : MAT.black);
      cap.position.set(x, lidTop + 2.4 + 5.5, z);
      inner.add(tag(cap, 'postCap'));
      const name = (si === 0 ? '甲' : '乙') + (sx < 0 ? '+' : '−');
      termLocal[name] = new THREE.Vector3(x * S, (lidTop + 8.2) * S, z * S);
    });

    // ── 刻度尺（立在两臂之间，读高度差用）──────────────────
    const ruler = new THREE.Mesh(new THREE.BoxGeometry(9, D.TUBE_LEN - 14, 1.6), matRuler);
    ruler.position.set(cx, (lidTop + 8 + topY - 6) / 2, 0);
    inner.add(tag(ruler, 'ruler'));
    for (let i = 0; i <= 8; i++) {
      const y = lidTop + 12 + i * ((D.TUBE_LEN - 30) / 8);
      const tk = new THREE.Mesh(new THREE.BoxGeometry(i % 4 === 0 ? 7 : 4.5, 1, 1.2), MAT.black);
      tk.position.set(cx, y, 1.1);
      inner.add(tag(tk, 'rulerTick'));
    }
  });

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(D.X * 2 * S + 130, D.LID_R * 2 * S * 1.7),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.35;
  shadow.renderOrder = -1;
  outer.add(shadow);

  // ── 液面：heat ∈ [0,1] → A 臂下降、B 臂上升（连通器，总量守恒）──
  const heat = [0, 0];
  let shown = [0, 0];
  function applyLevels() {
    for (let i = 0; i < 2; i++) {
      const L = liquids[i];
      const d = SWING * shown[i];
      const hA = Math.max(6, MID - d);
      const hB = MID + d;
      L.colA.scale.y = hA;
      L.colA.position.y = L.aBottom + hA / 2;
      L.colB.scale.y = hB;
      L.colB.position.y = L.bBottom + hB / 2;
    }
  }
  applyLevels();

  const api = {
    group: outer, shadow,
    localToWorld: (v) => inner.localToWorld(v.clone()),
    worldToLocal: (v) => inner.worldToLocal(v.clone()),
    type: 'joule',
    label: '焦耳定律演示器',
    spec: 'U 形管 甲/乙',
    bounds: { hw: D.X * S + D.LID_R * S + 6, hd: D.LID_R * S + 6 },
    topY: (topY + 8) * S,
    termLocal,
    termIdx: { '甲+': 0, '甲−': 1, '乙+': 2, '乙−': 3 },
    R1: 5, R2: 10, R2b: 0,
    getParams() { return { R1: api.R1, R2: api.R2, R2b: api.R2b }; },
    setBox(si, rec) {
      if (!rec) return;
      api['R' + (si + 1)] = rec.R;
      const target = rec.wired ? Math.min(1, rec.p / 1.2) : 0;
      heat[si] += target * 0.16;              // 每帧一点，慢慢爬
      if (heat[si] > 1) heat[si] = 1;
    },
    resetHeat() { heat[0] = 0; heat[1] = 0; },
    step(dt) {
      for (let i = 0; i < 2; i++) {
        const d = heat[i] - shown[i];
        if (Math.abs(d) < 0.0008) { if (shown[i] !== heat[i]) { shown[i] = heat[i]; applyLevels(); } continue; }
        shown[i] += d * Math.min(1, dt * 3);
        applyLevels();
      }
    },
    debugJoule() {
      // 液面差 = B 臂比 A 臂高多少（mm，1:1 建模坐标），自检要能读到「真的差出来了」
      const i = 0;
      const d = SWING * shown[i];
      return {
        levels: shown.map((v) => +v.toFixed(3)), heat: heat.map((v) => +v.toFixed(3)),
        colA: +(MID - d).toFixed(2), colB: +(MID + d).toFixed(2),
        diff: +(2 * d).toFixed(2),
        aTop: +liquids[i].colA.position.y.toFixed(2),
        bTop: +liquids[i].colB.position.y.toFixed(2),
      };
    },
  };
  return api;
}

// ============================================================
//  电热瓶（量热瓶：广口瓶 + 瓶塞 + 温度计 + 瓶内电阻丝）
// ============================================================
// ============================================================
//  电热瓶（量热瓶：广口瓶 + 橡皮塞 + 温度计 + 瓶内电阻丝，人教版 图18.4-1）
// ------------------------------------------------------------
// 旧版的问题：瓶身透明度 0.24 几乎看不见，画面里只剩「一只悬空的瓶塞 + 一根温度计」；
// 温度计也只有一根红柱、没有刻度 —— 学生读不出温度，这件器材就白做了。
// 这一版：
//   · 瓶身内外两层（外壁正面 + 内壁背面）⇒ 有玻璃厚度和反光，不是一团空气；
//   · 瓶里真的有液体（淡蓝半透明），电阻丝浸在液体里；
//   · 温度计背面带【刻度板】0~100 ℃，红色液柱随求解内核给的温度升降，读得出数。
// 电气仍是两端子（a / b），参数只有电阻丝阻值 R —— 与 2D 沙盒完全一致。
// ============================================================
export const CAL_DIM = {
  R: 42, H: 92, NECK_R: 26, NECK_H: 12,
  CORK_R: 25, CORK_H: 16,
  THERMO_R: 2.3, THERMO_H: 104,
  LIQ: 0.64,                    // 液体占瓶高的比例
  SCALE: 1.35,
};

// 温度计刻度板：0~100 ℃，每 10 ℃ 一格、每 20 ℃ 标数字（画一次，所有实例共用）
let _thermoTex = null;
function thermoScaleTexture() {
  if (_thermoTex) return _thermoTex;
  const cv = document.createElement('canvas');
  cv.width = 96; cv.height = 512;
  const g = cv.getContext('2d');
  g.fillStyle = '#f6f8fa'; g.fillRect(0, 0, 96, 512);
  g.strokeStyle = '#c3ccd6'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, 93, 509);
  g.textAlign = 'right'; g.textBaseline = 'middle';
  for (let t = 0; t <= 100; t += 5) {
    const y = 476 - (t / 100) * 440;
    const major = t % 20 === 0;
    const mid = t % 10 === 0;
    g.strokeStyle = major ? '#334155' : (mid ? '#64748b' : '#a8b4c0');
    g.lineWidth = major ? 3.2 : (mid ? 2.2 : 1.4);
    g.beginPath(); g.moveTo(90, y); g.lineTo(major ? 56 : (mid ? 66 : 76), y); g.stroke();
    if (major) {
      g.fillStyle = '#334155';
      g.font = 'bold 22px -apple-system,"PingFang SC",sans-serif';
      g.fillText(String(t), 50, y);
    }
  }
  g.fillStyle = '#0f172a';
  g.font = 'bold 20px -apple-system,"PingFang SC",sans-serif';
  g.textAlign = 'center';
  g.fillText('℃', 48, 24);
  _thermoTex = new THREE.CanvasTexture(cv);
  _thermoTex.colorSpace = THREE.SRGBColorSpace;
  return _thermoTex;
}

export function buildCalorimeter() {
  const D = CAL_DIM;
  const S = D.SCALE;
  const outer = new THREE.Group();
  const inner = new THREE.Group();
  inner.scale.setScalar(S);
  outer.add(inner);
  const tag = (o, role) => { o.userData.role = role; return o; };

  const matGlass = new THREE.MeshPhysicalMaterial({
    color: 0xe6f4fb, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.30,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const matWater = new THREE.MeshStandardMaterial({
    color: 0x5aa9d6, roughness: 0.18, metalness: 0.02, transparent: true, opacity: 0.62,
    depthWrite: false,
  });
  const matCork = new THREE.MeshStandardMaterial({ color: 0x8d6a48, roughness: 0.88, metalness: 0.02 });
  const matCoil = new THREE.MeshStandardMaterial({ color: 0x9a5a33, roughness: 0.36, metalness: 0.66 });
  const matRed = new THREE.MeshStandardMaterial({ color: 0xcf2f43, roughness: 0.34, metalness: 0.05 });

  // 瓶身轮廓（直筒 → 肩 → 短颈），内外两层让玻璃有厚度
  const prof = [
    [D.R * 0.985, 0], [D.R, 6], [D.R, D.H - 20], [D.R * 0.9, D.H - 8],
    [D.NECK_R + 4, D.H], [D.NECK_R, D.H + 4], [D.NECK_R, D.H + D.NECK_H],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const body = new THREE.Mesh(new THREE.LatheGeometry(prof, 44), matGlass);
  body.renderOrder = 3;
  inner.add(tag(body, 'bottle'));
  const innerWall = new THREE.Mesh(new THREE.LatheGeometry(prof.map((p) => new THREE.Vector2(p.x - 1.6, p.y)), 44),
    new THREE.MeshStandardMaterial({ color: 0xcfe6f2, roughness: 0.1, metalness: 0,
      transparent: true, opacity: 0.16, side: THREE.BackSide, depthWrite: false }));
  innerWall.renderOrder = 2;
  inner.add(tag(innerWall, 'bottleInner'));
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(D.R - 1, 36), matGlass);
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.y = 0.6;
  inner.add(tag(bottom, 'bottleBottom'));

  // 瓶里的液体
  const liqH = D.H * D.LIQ;
  const liquid = new THREE.Mesh(new THREE.CylinderGeometry(D.R - 2.4, D.R - 3.2, liqH, 40, 1, false), matWater);
  liquid.position.y = liqH / 2 + 1;
  liquid.renderOrder = 1;
  inner.add(tag(liquid, 'liquid'));

  // 电阻丝（浸在液体里的螺旋）
  const pts = [];
  for (let i = 0; i <= 240; i++) {
    const t = i / 240, a = t * Math.PI * 2 * 7;
    pts.push(new THREE.Vector3(Math.cos(a) * 21, 10 + t * (liqH - 12), Math.sin(a) * 21));
  }
  inner.add(tag(new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 240, 1.7, 6, false), matCoil), 'coil'));

  // 橡皮塞
  const corkY = D.H + D.NECK_H;
  const cork = new THREE.Mesh(new THREE.CylinderGeometry(D.CORK_R, D.CORK_R * 0.9, D.CORK_H, 30), matCork);
  cork.position.set(0, corkY + D.CORK_H / 2 - 4, 0);
  inner.add(tag(cork, 'cork'));

  // ── 温度计（玻璃管 + 红色液柱 + 背面的刻度板）──────────────
  const tY = corkY + D.CORK_H - 6;                 // 温度计下端（插进塞子）
  const thermo = new THREE.Mesh(
    new THREE.CylinderGeometry(D.THERMO_R, D.THERMO_R, D.THERMO_H, 16, 1, true), matGlass);
  thermo.position.set(0, tY + D.THERMO_H / 2, 0);
  thermo.renderOrder = 3;
  inner.add(tag(thermo, 'thermometer'));
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(D.THERMO_R * 1.7, 16, 12), matRed);
  bulb.position.set(0, tY + D.THERMO_R * 1.4, 0);
  inner.add(tag(bulb, 'thermoBulb'));
  const col = new THREE.Mesh(new THREE.CylinderGeometry(D.THERMO_R * 0.52, D.THERMO_R * 0.52, 1, 12), matRed);
  inner.add(tag(col, 'thermoColumn'));
  // 刻度板：贴在温度计【后面】（z 负方向），正面朝外
  const scaleMat = new THREE.MeshStandardMaterial({
    map: thermoScaleTexture(), roughness: 0.72, metalness: 0.02, side: THREE.DoubleSide,
  });
  const scaleBoard = new THREE.Mesh(new THREE.PlaneGeometry(15, D.THERMO_H * 0.94), scaleMat);
  scaleBoard.position.set(0, tY + D.THERMO_H * 0.52, -D.THERMO_R - 0.9);
  inner.add(tag(scaleBoard, 'thermoScale'));

  // 两根接线柱（塞子上，左右各一）
  const termLocal = {};
  [-1, 1].forEach((sx) => {
    const x = sx * 13, z = 6;
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(6, 6.4, 2.4, 20), MAT.black);
    pad.position.set(x, corkY + 2, z);
    inner.add(tag(pad, 'postPad'));
    const cap = new THREE.Mesh(knurledGeometry(4.2, 11), sx < 0 ? MAT.red : MAT.black);
    cap.position.set(x, corkY + 3.2 + 5.5, z);
    inner.add(tag(cap, 'postCap'));
    termLocal[sx < 0 ? 'a' : 'b'] = new THREE.Vector3(x * S, (corkY + 9) * S, z * S);
  });

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(D.R * S * 2.8, D.R * S * 2.8),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.35;
  shadow.renderOrder = -1;
  outer.add(shadow);

  let shownT = 20;
  let targetT = 20;
  const T_MIN = 0, T_MAX = 100;
  function applyTemp() {
    const f = Math.max(0, Math.min(1, (shownT - T_MIN) / (T_MAX - T_MIN)));
    // 液柱从球泡上方 4 mm 起，最高到刻度板顶端下方 8 mm
    const h = 4 + f * (D.THERMO_H * 0.9 - 8);
    col.scale.y = h;
    col.position.set(0, tY + 5 + h / 2, 0);
    // 液体颜色随温度微微偏暖（40 ℃ 以后开始泛橙，直观看出「热了」）
    const warm = Math.max(0, Math.min(1, (shownT - 30) / 60));
    matWater.color.setRGB(0.35 + warm * 0.18, 0.66 - warm * 0.16, 0.84 - warm * 0.3);
  }
  applyTemp();

  const api = {
    group: outer, shadow,
    localToWorld: (v) => inner.localToWorld(v.clone()),
    worldToLocal: (v) => inner.worldToLocal(v.clone()),
    type: 'calorimeter',
    label: '电热瓶',
    spec: '10 Ω',
    bounds: { hw: D.R * S + 6, hd: D.R * S + 6 },
    topY: (tY + D.THERMO_H + 8) * S,
    termLocal,
    termIdx: { a: 0, b: 1 },
    R: 10,
    getParams() { return { R: api.R }; },
    setR(v) { api.R = v; api.spec = v + ' Ω'; },
    setTemp(rec) {
      if (!rec) { targetT = 20; return; }
      api.R = rec.R || api.R;
      targetT = rec.temp == null ? 20 : rec.temp;
    },
    getTemp: () => shownT,
    step(dt) {
      const d = targetT - shownT;
      if (Math.abs(d) < 0.05) { if (shownT !== targetT) { shownT = targetT; applyTemp(); } return; }
      shownT += d * Math.min(1, dt * 1.6);
      applyTemp();
    },
    debugCal() {
      return { temp: +shownT.toFixed(2), target: +targetT.toFixed(2),
        colH: +col.scale.y.toFixed(2), colTop: +col.position.y.toFixed(2),
        liqColor: matWater.color.getHexString() };
    },
  };
  return api;
}

// ============================================================
//  电位器（三柱 a/b/c + 环形电阻丝 + 转柄滑片）
// ------------------------------------------------------------
// 语义照 circuit-core：a—b 之间的阻值 = Rmax·pos，b—c 之间 = Rmax·(1−pos)。
// 滑片转动时这两段一起变，正是「分压器」那节课要看的。
// ============================================================
// ============================================================
//  电位器（三柱 a/b/c：旋钮 + 刻度盘 + 指针）
// ------------------------------------------------------------
// 旧版是「一个方板 + 一个金属环 + 一根黄铜臂」，看着像自行车轮 —— 学生认不出
// 这是实验室里那台旋钮电位器。这一版照实物做：
//   · 方形金属外壳 + 四角螺丝；
//   · 顶面一块【刻度盘】0~10（画在 CanvasTexture 上，直接读得出转到哪一档）；
//   · 中央滚花旋钮 + 一条指针，指针扫过 180°：左端 = a 端，右端 = c 端；
//   · 前缘三个接线柱，旁边刻着 a / b / c。
// 语义照 circuit-core：a—b = Rmax·pos，b—c = Rmax·(1−pos)，两段此消彼长。
// 三柱全接就是分压器 —— 这是初中「变阻器」这一节唯一一个三根线全用上的器材。
// ============================================================
export const POT_DIM = {
  W: 108, D: 92, H: 20,
  DIAL_R: 36, DIAL_T: 2,
  KNOB_R: 13, KNOB_H: 15,
  POST_R: 4.2, POST_H: 11, POST_Z: 38,
  SCALE: 1.5,
};

let _potDialTex = null;
function potDialTexture() {
  if (_potDialTex) return _potDialTex;
  const N = 320, C = N / 2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, N, N);
  // 盘面：深色底 + 一圈亮边
  g.beginPath(); g.arc(C, C, C - 2, 0, Math.PI * 2);
  g.fillStyle = '#1c2530'; g.fill();
  g.lineWidth = 5; g.strokeStyle = '#8e9cab'; g.stroke();
  // 刻度：0 在左（180°）→ 10 在右（0°），中间经过下方（正前方）
  for (let t = 0; t <= 100; t += 2) {
    const a = Math.PI + (t / 100) * Math.PI;          // canvas 角度 = 世界方位角
    const major = t % 20 === 0;
    const mid = t % 10 === 0;
    const r0 = C - 8, r1 = C - (major ? 26 : (mid ? 20 : 15));
    g.beginPath();
    g.moveTo(C + Math.cos(a) * r0, C - Math.sin(a) * r0);
    g.lineTo(C + Math.cos(a) * r1, C - Math.sin(a) * r1);
    g.lineWidth = major ? 4 : (mid ? 3 : 1.8);
    g.strokeStyle = major ? '#e6edf5' : (mid ? '#b9c6d3' : '#7d8b9a');
    g.stroke();
    if (major) {
      const rt = C - 42;
      g.fillStyle = '#e6edf5';
      g.font = 'bold 26px -apple-system,"PingFang SC",sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(t / 10), C + Math.cos(a) * rt, C - Math.sin(a) * rt);
    }
  }
  g.fillStyle = '#7d8b9a';
  g.font = 'bold 17px -apple-system,"PingFang SC",sans-serif';
  g.textAlign = 'center';
  g.fillText('Ω', C, C - 6);
  _potDialTex = new THREE.CanvasTexture(cv);
  _potDialTex.colorSpace = THREE.SRGBColorSpace;
  _potDialTex.anisotropy = 4;
  return _potDialTex;
}

// 接线柱旁的小字母牌（a / b / c）
const _letTex = {};
function letterTexture(txt) {
  if (_letTex[txt]) return _letTex[txt];
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 64;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, 64, 64);
  g.fillStyle = '#e8eef5';
  g.font = 'bold 46px -apple-system,"PingFang SC",sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(txt, 32, 34);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  _letTex[txt] = t;
  return t;
}

export function buildPotentiometer() {
  const D = POT_DIM;
  const S = D.SCALE;
  const outer = new THREE.Group();
  const inner = new THREE.Group();
  inner.scale.setScalar(S);
  outer.add(inner);
  const tag = (o, role) => { o.userData.role = role; return o; };

  const matCase = new THREE.MeshStandardMaterial({ color: 0x9fb0c4, roughness: 0.44, metalness: 0.5 });
  const matCaseTop = new THREE.MeshStandardMaterial({ color: 0xb6c4d4, roughness: 0.38, metalness: 0.52 });
  const matKnob = new THREE.MeshStandardMaterial({ color: 0x232c38, roughness: 0.44, metalness: 0.3 });
  const matNeedle = new THREE.MeshStandardMaterial({ color: 0xff8a3d, roughness: 0.35, metalness: 0.1 });

  // 外壳 + 顶面板
  const base = new THREE.Mesh(new THREE.BoxGeometry(D.W, D.H, D.D), matCase);
  base.position.set(0, D.H / 2, 0);
  inner.add(tag(base, 'base'));
  const topPlate = new THREE.Mesh(new THREE.BoxGeometry(D.W - 6, 2.4, D.D - 6), matCaseTop);
  topPlate.position.set(0, D.H + 1.2, 0);
  inner.add(tag(topPlate, 'topPlate'));
  // 四角螺丝
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
    const sc = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 2.2, 12), MAT.steel);
    sc.position.set(sx * (D.W / 2 - 9), D.H + 2.4, sz * (D.D / 2 - 9));
    inner.add(tag(sc, 'screw'));
  });

  // 刻度盘（贴一张 canvas，平放在顶面）
  const dialY = D.H + 2.5;
  const dial = new THREE.Mesh(new THREE.CircleGeometry(D.DIAL_R, 64),
    new THREE.MeshStandardMaterial({ map: potDialTexture(), roughness: 0.62, metalness: 0.12 }));
  dial.rotation.x = -Math.PI / 2;
  dial.position.set(0, dialY, -4);
  inner.add(tag(dial, 'dial'));

  // 旋钮（滚花）+ 指针：指针绕轴水平转，左端 a、右端 c
  const knobY = dialY + 1;
  const knob = new THREE.Mesh(knurledGeometry(D.KNOB_R, D.KNOB_H), matKnob);
  knob.rotation.x = Math.PI / 2;                    // 滚花柱立起来
  knob.position.set(0, knobY + D.KNOB_H / 2, -4);
  inner.add(tag(knob, 'knob'));
  const knobCap = new THREE.Mesh(new THREE.CylinderGeometry(D.KNOB_R * 0.66, D.KNOB_R * 0.66, 1.6, 24), MAT.steel);
  knobCap.position.set(0, knobY + D.KNOB_H + 0.4, -4);
  inner.add(tag(knobCap, 'knobCap'));

  const arm = new THREE.Group();                    // 指针
  arm.position.set(0, knobY + D.KNOB_H + 1.4, -4);
  inner.add(tag(arm, 'arm'));
  const needle = new THREE.Mesh(new THREE.BoxGeometry(D.DIAL_R * 0.82, 1.2, 3.4), matNeedle);
  needle.position.set(D.DIAL_R * 0.41, 0, 0);
  arm.add(needle);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 2, 18), matNeedle);
  arm.add(hub);

  // 三个接线柱（前缘），旁边刻 a / b / c
  const termLocal = {};
  [['a', -D.W / 2 + 20], ['b', 0], ['c', D.W / 2 - 20]].forEach(([name, x]) => {
    const z = D.POST_Z;
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 6, 2.4, 20), MAT.black);
    pad.position.set(x, D.H + 3.4, z);
    inner.add(tag(pad, 'postPad'));
    const cap = new THREE.Mesh(knurledGeometry(D.POST_R, D.POST_H), MAT.brass);
    cap.position.set(x, D.H + 4.6 + D.POST_H / 2, z);
    inner.add(tag(cap, 'postCap'));
    // 字母牌贴在柱前面的外壳侧面上
    const lt = new THREE.Mesh(new THREE.PlaneGeometry(11, 11),
      new THREE.MeshBasicMaterial({ map: letterTexture(name), transparent: true }));
    lt.position.set(x, D.H * 0.55, D.D / 2 + 0.8);
    inner.add(tag(lt, 'termLabel'));
    termLocal[name] = new THREE.Vector3(x * S, (D.H + 4.6 + D.POST_H) * S, z * S);
  });

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(D.W * S * 1.6, D.D * S * 1.6),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.35;
  shadow.renderOrder = -1;
  outer.add(shadow);

  const api = {
    group: outer, shadow,
    localToWorld: (v) => inner.localToWorld(v.clone()),
    worldToLocal: (v) => inner.worldToLocal(v.clone()),
    type: 'potentiometer',
    label: '电位器',
    spec: '20 Ω',
    bounds: { hw: D.W / 2 * S + 6, hd: D.D / 2 * S + 6 },
    topY: (D.H + D.KNOB_H + 10) * S,
    termLocal,
    termIdx: { a: 0, b: 1, c: 2 },
    Rmax: 20,
    pos: 0.5,
    getParams() { return { Rmax: api.Rmax, pos: api.pos }; },
    // pos=0 指针指向 a（左），pos=1 指向 c（右），中间扫过正前方 —— 与刻度盘上
    // 「0 在左、10 在右、5 在正前」是同一套方位角，指针和刻度才对得上。
    setPos(p) {
      api.pos = Math.max(0, Math.min(1, p));
      arm.rotation.y = Math.PI + api.pos * Math.PI;
    },
    setRmax(v) { api.Rmax = v; api.spec = v + ' Ω'; },
    debugPot() {
      return { pos: +api.pos.toFixed(3), armY: +arm.rotation.y.toFixed(3),
        needleWorld: (() => {
          const v = new THREE.Vector3(D.DIAL_R * 0.82, 0, 0);
          arm.localToWorld(v);
          inner.worldToLocal(v);
          return [+v.x.toFixed(1), +v.y.toFixed(1), +v.z.toFixed(1)];
        })() };
    },
    arm,
  };
  api.setPos(0.5);
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
  {
    type: 'battery', label: '干电池组', spec: '1.5 V / 节',
    desc: '1~3 节干电池装在同一只托架上，两端红黑柱是电源两极。',
    build: buildBattery, ready: true,
  },
  {
    type: 'switch', label: '开关', spec: '单刀单掷',
    desc: '闸刀式开关：点刀片合上／抬起。',
    build: buildSwitch, ready: true,
  },
  {
    type: 'bulb', label: '小灯泡', spec: '2.5 V　0.75 W',
    desc: '带灯座的螺口小灯泡：亮度随电流变，灯丝温度越高越白。',
    build: buildBulb, ready: true,
  },
  {
    key: 'storage', type: 'battery', label: '蓄电池', spec: '6 V（3 × 2 V）',
    desc: '三只铅酸电池串成一组：左端黑柱是负极、右端红柱是正极。',
    build: buildStorageBattery, ready: true,
  },
  {
    type: 'resistor', label: '定值电阻', spec: '10 Ω',
    desc: '线绕定值电阻：阻值在参数面板里改，接 a、b 两柱。',
    build: () => buildResistor({ R: 10 }), ready: true,
  },
  {
    type: 'power', label: '学生电源', spec: '0~9 V 可调',
    desc: '旋钮连续调压，面板上还有电源开关和 + / − 输出柱。',
    build: buildPower, ready: true,
  },
  {
    type: 'resistancebox', label: '电阻箱', spec: '0~9999 Ω',
    desc: '四个转盘 ×1/×10/×100/×1k，跳档、刻度直接读得出接入的阻值。',
    build: buildResistanceBox, ready: true,
  },
  {
    type: 'rheoboard', label: '导线电阻演示板', spec: '四根丝 a/b/c/d',
    desc: '木板上四根现成的电阻丝，两两对照材料/长度/粗细，换一根只要挪两根导线。',
    build: buildRheoboard, ready: true,
  },
  {
    type: 'led', label: '发光二极管', spec: '红色 1.8 V',
    desc: '单向导电：电流从长脚（+）进才亮，反接不导通。',
    build: () => buildLed({ color: 'red' }), ready: true,
  },
  {
    type: 'joule', label: '焦耳定律演示器', spec: 'U 形管 甲/乙',
    desc: '两只瓶各一段电阻丝，通电放热把 U 形管的液柱顶高，看谁升得快。',
    build: buildJoule, ready: true,
  },
  {
    type: 'calorimeter', label: '电热瓶', spec: '10 Ω',
    desc: '瓶塞上插着温度计，瓶里泡着电阻丝：通电升温，看温度计升到多少度。',
    build: buildCalorimeter, ready: true,
  },
  {
    type: 'potentiometer', label: '电位器', spec: '20 Ω',
    desc: '三柱 a/b/c：转柄改滑片位置，a—b 与 b—c 两段阻值此消彼长。',
    build: buildPotentiometer, ready: true,
  },
  {
    type: 'ammeter', label: '电流表', spec: '0.6 A / 3 A',
    desc: '三柱双量程：黑柱公共，红柱 0.6 / 3。接反指针顶在左边。',
    build: () => buildMeter({ kind: 'ammeter' }), ready: true,
  },
  {
    type: 'voltmeter', label: '电压表', spec: '3 V / 15 V',
    desc: '三柱双量程：黑柱公共，红柱 3 / 15。并联在被测元件两端。',
    build: () => buildMeter({ kind: 'voltmeter' }), ready: true,
  },
];
