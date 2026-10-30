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
  { type: 'meter', label: '电流表 / 电压表', spec: '三柱双量程', desc: '两个量程柱 + 一个公共柱，接错会反偏。', ready: false },
];
