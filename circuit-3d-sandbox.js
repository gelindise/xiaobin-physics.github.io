/*!
 * circuit-3d-sandbox.js —— 「电路实验沙盒 3D」应用层
 * ============================================================
 * 物理内核、端子几何、编辑语义、参数面板规格【全部复用 2D 沙盒那一套】：
 *   window.CircuitCore   solve / wireCurrents / faultsOf / TYPES / defaultParams
 *   window.CircuitDraw   terminalWorld / endWorld / flipOf / RHEO / MET / MET_SWEEP
 *   window.CircuitEditor 放/删/连线/极性/量程/撤销（用隐藏 2D canvas 驱动）
 *   window.CircuitParams PARAM_UI / TYPE_LABEL / dispI / dispU / fmtR
 * 本文件只做「渲染 + 交互 + 面板/读数回填」这三件 3D 特有的事。
 *
 * 场景数据模型与 2D 完全一致（{comps:[],wires:[]}），只是 (x,y) 被解释成
 * 水平工作台面坐标（见 circuit-3d-kit.js 的 to3D）。
 */
import * as THREE from './assets/optics-three.min.js';
import KIT from './circuit-3d-kit.js';

(function () {
  'use strict';

  var C = window.CircuitCore, D = window.CircuitDraw, E = window.CircuitEditor, CP = window.CircuitParams;
  if (!C || !D || !E || !CP) {
    console.error('[sbx3d] 共享模块未加载：需要 circuit-core/draw/editor/params.js');
    return;
  }

  var W = KIT.W, H = KIT.H, S = KIT.S, GRID = KIT.GRID;

  // ============================================================
  //  DOM
  // ============================================================
  var canvas = document.getElementById('gl');
  var stageEl = document.getElementById('stage');
  var toastEl = document.getElementById('toast');

  // ============================================================
  //  场景状态（与 2D 同一套数据模型）
  // ============================================================
  var circuitScene = { comps: [], wires: [] };
  var results = null, flows = [];
  var selectedId = null;
  var phase = 0;

  // ============================================================
  //  three.js 基础
  // ============================================================
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x020617, 1);
  if (THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
  if (THREE.ACESFilmicToneMapping) { renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.06; }

  var gscene = new THREE.Scene();
  gscene.add(new THREE.HemisphereLight(0xdff1fb, 0x1b2a3a, 1.25));
  var keyLight = new THREE.DirectionalLight(0xfff4e4, 1.75); keyLight.position.set(9, 16, 12); gscene.add(keyLight);
  var rimLight = new THREE.DirectionalLight(0x7cc6ff, 0.95); rimLight.position.set(-11, 7, -12); gscene.add(rimLight);
  var topLight = new THREE.DirectionalLight(0xcfe8ff, 0.7); topLight.position.set(0, 20, -4); gscene.add(topLight);

  var camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);

  var benchGroup = new THREE.Group(); gscene.add(benchGroup);
  var compGroup = new THREE.Group(); gscene.add(compGroup);
  var wireGroup = new THREE.Group(); gscene.add(wireGroup);
  var partGroup = new THREE.Group(); gscene.add(partGroup);

  benchGroup.add(KIT.makeBench());

  // ============================================================
  //  相机（自写轨道；站内 three 精简版不含 OrbitControls）
  // ============================================================
  var cam = { yaw: -0.55, pitch: 0.62, dist: 26, zoom: 1 };
  var LOOK = new THREE.Vector3(0, 0.35, 0);
  var VIEWS = {
    angle: { yaw: -0.55, pitch: 0.62 },
    front: { yaw: 0, pitch: 0.18 },
    top: { yaw: 0, pitch: 1.18 },
    side: { yaw: -1.4, pitch: 0.22 },
  };
  function updateCamera() {
    var d = cam.dist / cam.zoom;
    var cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    camera.position.set(LOOK.x + d * cp * Math.sin(cam.yaw), LOOK.y + d * sp, LOOK.z + d * cp * Math.cos(cam.yaw));
    camera.lookAt(LOOK);
  }
  function setView(name) {
    var v = VIEWS[name]; if (!v) return;
    cam.yaw = v.yaw; cam.pitch = v.pitch; cam.zoom = 1;
    state.view = name; updateCamera(); syncViewButtons(); render();
  }

  // ============================================================
  //  编辑器实例（喂一个隐藏 2D canvas；变更方法一律走它，语义与 2D 完全一致）
  // ============================================================
  var hidden = document.createElement('canvas');
  hidden.width = W; hidden.height = H;
  var editor = E.create({
    canvas: hidden, W: W, H: H,
    getScene: function () { return circuitScene; },
    onChange: function () { onSceneChanged(); },
    onSelect: function () {},
    onTap: function () {},
    onEvent: function () {},
  });

  function onSceneChanged() {
    rebuild();
    solve();
  }

  // ============================================================
  //  预设（原样移植自 2D 沙盒，坐标落在同一套 1000×740 网格上）
  // ============================================================
  function w(a, ai, b, bi, via) { return { a: { compId: a, termIdx: ai }, b: { compId: b, termIdx: bi }, via: via || [], auto: false }; }
  var PRESETS = {
    series: function () {
      return {
        comps: [
          { id: 'E1', type: 'battery', x: 280, y: 600, params: { emf: 3, rInt: 0 } },
          { id: 'S1', type: 'switch', x: 720, y: 600, params: { closed: true } },
          { id: 'L1', type: 'bulb', x: 340, y: 160 },
          { id: 'L2', type: 'bulb', x: 660, y: 160 },
        ],
        wires: [
          w('E1', 0, 'S1', 0, []),
          w('S1', 1, 'L2', 1, [[880, 600], [880, 160]]),
          w('L2', 0, 'L1', 1, []),
          w('L1', 0, 'E1', 1, [[120, 160], [120, 600]]),
        ],
      };
    },
    parallel: function () {
      return {
        comps: [
          { id: 'E1', type: 'battery', x: 500, y: 620, params: { emf: 3, rInt: 0 } },
          { id: 'S1', type: 'switch', x: 820, y: 620, params: { closed: true } },
          { id: 'L1', type: 'bulb', x: 500, y: 180 },
          { id: 'L2', type: 'bulb', x: 500, y: 380 },
        ],
        wires: [
          w('L2', 0, 'L1', 0, []),
          w('L2', 1, 'L1', 1, []),
          w('L1', 0, 'E1', 1, [[240, 180], [240, 620]]),
          w('E1', 0, 'S1', 0, []),
          w('S1', 1, 'L1', 1, [[930, 620], [930, 180]]),
        ],
      };
    },
    measure: function () {
      return {
        comps: [
          { id: 'E1', type: 'battery', x: 300, y: 660, params: { emf: 3, rInt: 0 } },
          { id: 'S1', type: 'switch', x: 560, y: 660, params: { closed: true } },
          { id: 'RH1', type: 'rheostat', x: 800, y: 634, params: { Rmax: 20, slide: 0.15 } },
          { id: 'A1', type: 'ammeter', x: 280, y: 228, params: { range: 0.6 } },
          { id: 'L1', type: 'bulb', x: 600, y: 300 },
          { id: 'V1', type: 'voltmeter', x: 790, y: 420, params: { range: 3 } },
        ],
        wires: [
          w('E1', 0, 'S1', 0, []),
          w('S1', 1, 'RH1', 0, []),
          w('RH1', 3, 'L1', 1, [[940, 608], [940, 300]]),
          w('L1', 0, 'A1', 1, [[490, 300], [490, 350], [280, 350]]),
          w('A1', 0, 'E1', 1, [[130, 300], [130, 660]]),
          w('L1', 0, 'V1', 0, [[530, 492]]),
          w('L1', 1, 'V1', 1, [[670, 480], [790, 480]]),
        ],
      };
    },
  };
  function loadPreset(name) {
    var b = PRESETS[name]; if (!b) return false;
    var s = b();
    circuitScene.comps = s.comps;
    circuitScene.wires = s.wires;
    // 预设的走线是手画的：登记成手绘导线（auto=false + base），拖元件时按比例重排。
    circuitScene.wires.forEach(function (x) {
      var p0 = D.endWorld(byId(x.a.compId), x.a), p1 = D.endWorld(byId(x.b.compId), x.b);
      if (!p0 || !p1) return;
      x.auto = false;
      x.base = { ends: [[p0.x, p0.y], [p1.x, p1.y]], via: x.via.map(function (v) { return [v[0], v[1]]; }) };
    });
    selectedId = null;
    rebuild(); solve();
    return true;
  }
  function byId(id) {
    for (var i = 0; i < circuitScene.comps.length; i++) if (circuitScene.comps[i].id === id) return circuitScene.comps[i];
    return null;
  }

  // ============================================================
  //  构建 3D 场景
  // ============================================================
  var pickTerms = [];       // 端子命中球（射线优先）
  var compObjects = {};     // compId → group
  var wireObjects = [];     // {mesh, curve, flow}
  var particles = [];       // {mesh, curve, u0, speed, dir}

  function clearGroup(g) {
    while (g.children.length) {
      var ch = g.children.pop();
      KIT.disposeGroup(ch);
    }
  }

  function rebuild() {
    clearGroup(compGroup);
    clearGroup(wireGroup);
    clearGroup(partGroup);
    pickTerms = []; compObjects = {}; wireObjects = []; particles = [];

    circuitScene.comps.forEach(function (comp) {
      var rec = results && results.components ? results.components[comp.id] : null;
      var g;
      try { g = KIT.buildComponent(comp, rec); }
      catch (e) { console.error('[sbx3d] 构建元件失败', comp.type, e); return; }
      compGroup.add(g);
      compObjects[comp.id] = g;
      g.traverse(function (o) {
        if (o.userData && o.userData.role === 'termHit') pickTerms.push(o);
      });
      // 名字标签
      try {
        var lab = KIT.makeLabel(D.nameOf(comp), { scale: 0.95 });
        lab.position.set(0, 1.9, 0);
        g.add(lab);
        g.userData.label = lab;
      } catch (e) {}
    });

    circuitScene.wires.forEach(function (wire) {
      var m = KIT.buildWire(circuitScene, wire);
      if (m) { wireGroup.add(m); wireObjects.push({ mesh: m, curve: m.userData.curve }); }
    });

    compGroup.updateMatrixWorld(true);
    wireGroup.updateMatrixWorld(true);
    applyVisuals();
    render();
  }

  function buildParticles() {
    clearGroup(partGroup);
    particles = [];
    if (!flows || !flows.length) return;
    for (var i = 0; i < wireObjects.length; i++) {
      var f = flows[i] || 0;
      if (Math.abs(f) < 1e-6) continue;
      var curve = wireObjects[i].curve;
      var len = curve.total || 1;
      var n = Math.max(2, Math.min(7, Math.round(len / 0.9)));
      for (var k = 0; k < n; k++) {
        var m = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6),
          new THREE.MeshBasicMaterial({ color: 0xfbbf24 }));
        m.userData.shared = false;
        partGroup.add(m);
        particles.push({ mesh: m, curve: curve, u0: k / n, speed: 0.12 + Math.min(0.5, Math.abs(f) * 1.2), dir: f >= 0 ? 1 : -1 });
      }
    }
  }

  // ============================================================
  //  求解
  // ============================================================
  function solve() {
    try {
      results = C.solve(circuitScene.comps, circuitScene.wires);
    } catch (e) {
      console.error('[sbx3d] 求解失败', e);
      results = null;
    }
    flows = [];
    try { if (results) flows = C.wireCurrents(circuitScene, results) || []; } catch (e) {}
    // 损坏判定闭环（闩锁）：判出来的 fault / broken 写回场景，再解一次
    try {
      if (results && C.faultsOf) {
        var f = C.faultsOf(circuitScene.comps, circuitScene.wires, results, flows);
        var dirty = false;
        (f.comps || []).forEach(function (it) {
          var c = byId(it.id);
          if (c && c.fault !== it.fault) { c.fault = it.fault; c.faultWhy = it.why; dirty = true; }
        });
        (f.wires || []).forEach(function (idx) {
          var ww = circuitScene.wires[idx];
          if (ww && !ww.broken) { ww.broken = true; dirty = true; }
        });
        if (dirty) { results = C.solve(circuitScene.comps, circuitScene.wires); flows = C.wireCurrents(circuitScene, results) || []; }
      }
    } catch (e) {}
    buildParticles();     // 必须在 flows 定下来之后建（粒子方向/速度都看它）
    applyVisuals();
    updateTable();
    updateStatus();
    render();
  }

  // ============================================================
  //  视觉：发光 / 指针 / 闸刀 / 滑片
  // ============================================================
  function applyVisuals() {
    if (!results || !results.components) return;
    circuitScene.comps.forEach(function (comp) {
      var g = compObjects[comp.id]; if (!g) return;
      var rec = results.components[comp.id] || {};
      // 灯泡 / LED 发光
      var fil = null, light = null, dome = null, glass = null;
      g.traverse(function (o) {
        if (!o.userData) return;
        if (o.userData.role === 'filament') fil = o;
        if (o.userData.role === 'bulbLight') light = o;
        if (o.userData.role === 'bulbGlass') glass = o;
        if (o.userData.role === 'dome') dome = o;
      });
      if (fil) {
        var b = (rec.brightness != null) ? rec.brightness : (rec.on ? 1 : 0);
        b = Math.max(0, Math.min(1, b || 0));
        fil.material.emissiveIntensity = b * 2.6;
        if (light) light.intensity = b * 2.0;
        if (glass && glass.material) glass.material.emissiveIntensity = b * 0.55;
      }
      if (dome) {
        var on = rec.on ? 1 : 0;
        dome.material.emissiveIntensity = on * 1.4;
      }
      // 闸刀（开关）
      if (comp.type === 'switch') {
        var hinge = null;
        g.children.forEach(function (o) { if (o.userData && o.userData.role === 'blade') hinge = o; });
        if (hinge) hinge.rotation.z = rec.closed ? 0 : 0.85;
      }
      // 表针
      if (comp.type === 'ammeter' || comp.type === 'voltmeter') {
        var nd = null;
        g.traverse(function (o) { if (o.userData && o.userData.role === 'needle') nd = o; });
        if (nd) nd.rotation.z = -KIT.meterNeedleAngle(comp, rec);
      }
      // 变阻器滑片
      if (comp.type === 'rheostat') {
        var knob = null;
        g.traverse(function (o) { if (o.userData && o.userData.role === 'knob') knob = o; });
        if (knob) {
          var kx = D.sliderLocalX(D.slideOf(comp, rec));
          var flip = D.flipOf(comp) ? -1 : 1;
          knob.position.x = flip * kx * S;
        }
      }
    });
  }

  // ============================================================
  //  动画（粒子 / 电机 / 电铃）
  // ============================================================
  function updateAnim(dt) {
    phase += dt;
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var u = (p.u0 + phase * p.speed * p.dir) % 1;
      if (u < 0) u += 1;
      var pt = p.curve.getPointAt(u);
      p.mesh.position.copy(pt);
    }
    // 电机转子 / 电铃锤
    if (results && results.components) {
      circuitScene.comps.forEach(function (comp) {
        var g = compObjects[comp.id]; if (!g) return;
        var rec = results.components[comp.id] || {};
        if (comp.type === 'motor') {
          var sp = null;
          g.traverse(function (o) { if (o.userData && o.userData.role === 'prop') sp = o; });
          if (sp) sp.rotation.x += dt * Math.min(30, Math.abs(rec.rpm || 0) * 0.06) * (rec.reversed ? -1 : 1);
        } else if (comp.type === 'bell') {
          var hm = null;
          g.traverse(function (o) { if (o.userData && o.userData.role === 'hammer') hm = o; });
          if (hm) hm.rotation.z = rec.rings ? Math.sin(phase * 26) * 0.22 : 0;
        }
      });
    }
  }

  // ============================================================
  //  渲染
  // ============================================================
  function render() { renderer.render(gscene, camera); }
  function renderNow() { updateAnim(0.05); render(); }

  function resize() {
    var cw = Math.max(280, stageEl.clientWidth);
    var ch = Math.max(240, stageEl.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(cw, ch, false);
    camera.aspect = cw / ch;
    camera.updateProjectionMatrix();
    updateCamera();
    render();
  }
  if (window.ResizeObserver) new ResizeObserver(resize).observe(stageEl);
  window.addEventListener('resize', resize);

  // ============================================================
  //  射线拾取 / 交互
  // ============================================================
  var raycaster = new THREE.Raycaster();
  var ndc = new THREE.Vector2();
  var dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  var dragComp = null, dragOffset = null, dragMoved = false;
  var orbiting = false, lastPtr = null;
  var wiring = null;         // {from:{compId,termIdx}, trail:[{x,y}], cur:{x,y}, to:null}

  function pointerNDC(ev) {
    var rect = canvas.getBoundingClientRect();
    ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    return ndc;
  }
  function planePoint(ev) {
    raycaster.setFromCamera(pointerNDC(ev), camera);
    var p = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(dragPlane, p)) return null;
    return KIT.worldToLogical(p);
  }
  function pickTerminal(ev) {
    raycaster.setFromCamera(pointerNDC(ev), camera);
    var hits = raycaster.intersectObjects(pickTerms, false);
    if (!hits.length) return null;
    var o = hits[0].object;
    var g = o.parent;
    while (g && g.userData.compId === undefined) g = g.parent;
    if (!g || g.userData.compId === undefined) return null;
    return { compId: g.userData.compId, termIdx: o.userData.termIdx };
  }
  function pickComp(ev) {
    raycaster.setFromCamera(pointerNDC(ev), camera);
    var hits = raycaster.intersectObjects(compGroup.children, true);
    for (var i = 0; i < hits.length; i++) {
      var o = hits[i].object;
      while (o && o.userData.compId === undefined) o = o.parent;
      if (o && o.userData.compId !== undefined) return o.userData.compId;
    }
    return null;
  }

  function onDown(ev) {
    if (ev.button === 2 || ev.button === 1) { orbiting = true; lastPtr = { x: ev.clientX, y: ev.clientY }; try { canvas.setPointerCapture(ev.pointerId); } catch (e) {} return; }
    var term = pickTerminal(ev);
    if (term) {
      wiring = { from: term, trail: [], cur: null, to: null };
      canvas.classList.add('wiring');
      try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
      return;
    }
    var cid = pickComp(ev);
    if (cid) {
      selectedId = cid;
      editor.select({ kind: 'comp', id: cid });
      editor.pushUndo();
      dragMoved = false;
      var pp = planePoint(ev);
      var c = byId(cid);
      if (pp && c) dragComp = { id: cid, dx: c.x - pp.x, dy: c.y - pp.y };
      renderParamPanel(); highlightTable();
      try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
      render();
      return;
    }
    // 空白：选中取消 + 转视角
    selectedId = null; editor.select(null); renderParamPanel(); highlightTable();
    orbiting = true; lastPtr = { x: ev.clientX, y: ev.clientY };
    canvas.classList.add('grabbing');
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
  }

  function onMove(ev) {
    if (wiring) {
      var lp = planePoint(ev);
      if (lp) { wiring.cur = lp; wiring.trail.push(lp); wiring.to = pickTerminal(ev); }
      return;
    }
    if (dragComp) {
      var p = planePoint(ev);
      if (p) {
        var c = byId(dragComp.id); if (!c) return;
        var nx = Math.round((p.x + dragComp.dx) / GRID) * GRID;
        var ny = Math.round((p.y + dragComp.dy) / GRID) * GRID;
        nx = Math.max(80, Math.min(W - 80, nx));
        ny = Math.max(70, Math.min(H - 60, ny));
        if (nx !== c.x || ny !== c.y) {
          c.x = nx; c.y = ny; dragMoved = true;
          var g = compObjects[c.id];
          if (g) g.position.copy(KIT.to3D(c.x, c.y, 0));
          rebuildWiresOnly();
          render();
        }
      }
      return;
    }
    if (orbiting && lastPtr) {
      var dx = ev.clientX - lastPtr.x, dy = ev.clientY - lastPtr.y;
      lastPtr = { x: ev.clientX, y: ev.clientY };
      cam.yaw -= dx * 0.006;
      cam.pitch = Math.max(0.05, Math.min(1.45, cam.pitch + dy * 0.005));
      state.view = 'custom'; syncViewButtons();
      updateCamera(); render();
    }
  }

  function rebuildWiresOnly() {
    clearGroup(wireGroup);
    wireObjects = [];
    circuitScene.wires.forEach(function (wire) {
      var m = KIT.buildWire(circuitScene, wire);
      if (m) { wireGroup.add(m); wireObjects.push({ mesh: m, curve: m.userData.curve }); }
    });
    wireGroup.updateMatrixWorld(true);
    buildParticles();
  }

  function onUp(ev) {
    try { canvas.releasePointerCapture(ev.pointerId); } catch (e) {}
    canvas.classList.remove('grabbing');
    if (wiring) {
      canvas.classList.remove('wiring');
      var from = wiring.from;
      if (wiring.to && (wiring.to.compId !== from.compId || wiring.to.termIdx !== from.termIdx)) {
        editor.connectTerminals(from, wiring.to);
      } else if (wiring.cur) {
        // 落在导线中间 → 复用编辑器的「长接线点」逻辑
        try { editor.connectToWireMid({ from: from, cur: wiring.cur, trail: wiring.trail }); } catch (e) {}
      }
      wiring = null;
      onSceneChanged();
      return;
    }
    if (dragComp) {
      if (dragMoved) { editor.rerouteAll(); onSceneChanged(); }
      dragComp = null; dragMoved = false;
      return;
    }
    orbiting = false; lastPtr = null;
  }

  function onWheel(ev) {
    ev.preventDefault();
    cam.zoom = Math.max(0.35, Math.min(3.2, cam.zoom * (ev.deltaY > 0 ? 0.92 : 1.08)));
    updateCamera(); render();
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  window.addEventListener('keydown', function (ev) {
    var t = ev.target, tag = (t && t.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
    if (ev.key === 'Delete' || ev.key === 'Backspace') { if (selectedId) { ev.preventDefault(); doDelete(); } }
    else if (ev.key === 'r' || ev.key === 'R') { if (selectedId) doRotate(); }
    else if (ev.key === 'Escape') { if (selectedId) { selectedId = null; editor.select(null); renderParamPanel(); highlightTable(); render(); } }
    else if ((ev.metaKey || ev.ctrlKey) && (ev.key === 'z' || ev.key === 'Z')) { ev.preventDefault(); doUndo(); }
  });

  // ============================================================
  //  操作
  // ============================================================
  function doUndo() { editor.undo(); selectedId = null; renderParamPanel(); highlightTable(); onSceneChanged(); }
  function doDelete() { editor.removeSelected(); selectedId = null; renderParamPanel(); highlightTable(); onSceneChanged(); }
  function doRotate() { editor.rotateSelected(); onSceneChanged(); }
  function doClear() { circuitScene.comps = []; circuitScene.wires = []; selectedId = null; renderParamPanel(); highlightTable(); rebuild(); solve(); }
  function addAt(type) {
    if (!C.TYPES[type] || !KIT.hasBuilder(type)) return;   // 内核不认识的类型不落台
    // 找一个尽量空的落点
    var x = 500, y = 380;
    var tries = 0;
    while (tries < 60) {
      var occupied = circuitScene.comps.some(function (c) { return Math.abs(c.x - x) < 150 && Math.abs(c.y - y) < 110; });
      if (!occupied) break;
      tries++;
      x = 180 + ((tries * 160) % 640);
      y = 140 + (Math.floor(tries / 4) * 130) % 460;
    }
    var c = editor.addComp(type, x, y);
    if (c) selectedId = c.id;
    renderParamPanel(); highlightTable();
  }

  // ============================================================
  //  元件栏
  // ============================================================
  var PAL = [
    ['battery', '🔋', '电源'], ['power', '⚡', '学生电源'], ['switch', '🔘', '开关'], ['resistor', '🟫', '电阻'],
    ['rheostat', '🎚️', '变阻器'], ['bulb', '💡', '灯泡'], ['ammeter', '🅰️', '电流表'],
    ['voltmeter', '🆅', '电压表'], ['led', '🔴', '二极管'], ['motor', '🌀', '电动机'],
    ['bell', '🔔', '电铃'],
  ];
  function buildPalette() {
    var box = document.getElementById('palette');
    if (!box) return;
    box.innerHTML = '';
    PAL.forEach(function (p) {
      // 只显示【内核类型表里真的有】的元件。这样元件栏自动跟随 CircuitCore.TYPES：
      // 内核新增一个类型（并且本页也写了 3D 构建器）就自动出现；内核还没上线的
      // 类型不会被放出来（放出来会是一个求解器不认识的元件，一放上去就 NaN）。
      if (!C.TYPES[p[0]] || !KIT.hasBuilder(p[0])) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = '<span class="ic">' + p[1] + '</span><span class="nm">' + p[2] + '</span>';
      b.title = (CP.TYPE_LABEL[p[0]] || p[0]);
      b.addEventListener('click', function () { addAt(p[0]); });
      box.appendChild(b);
    });
  }

  // ============================================================
  //  参数面板
  // ============================================================
  function renderParamPanel() {
    var box = document.getElementById('paramPanel');
    var pill = document.getElementById('selpill');
    if (!box) return;
    var c = selectedId ? byId(selectedId) : null;
    if (!c) { box.innerHTML = '<div class="empty-note">点台上的元件，这里出现它的参数。</div>'; if (pill) { pill.textContent = '未选中'; pill.className = 'pill'; } return; }
    if (pill) { pill.textContent = (CP.TYPE_LABEL[c.type] || c.type) + ' ' + D.nameOf(c); pill.className = 'pill ok'; }
    var specs = CP.PARAM_UI[c.type] || [];
    var html = '';
    specs.forEach(function (sp) {
      html += '<div class="prow" data-k="' + sp.k + '">';
      if (sp.t === 'range') {
        var v = CP.pval(c, sp.k);
        html += '<label>' + sp.label + '</label>';
        html += '<input type="range" data-t="range" data-k="' + sp.k + '" min="' + sp.min + '" max="' + sp.max + '" step="' + sp.step + '" value="' + v + '">';
        html += '<span class="val">' + fmtVal(v, sp.unit) + '</span>';
      } else if (sp.t === 'check') {
        var on = !!CP.pval(c, sp.k);
        html += '<label class="' + (sp.wide ? 'wide' : '') + '">' + sp.label + '</label>';
        html += '<input type="checkbox" data-t="check" data-k="' + sp.k + '"' + (on ? ' checked' : '') + '>';
      } else if (sp.t === 'select') {
        var cur = CP.pval(c, sp.k);
        html += '<label>' + sp.label + '</label><select data-t="select" data-k="' + sp.k + '">';
        (sp.options || []).forEach(function (o) {
          html += '<option value="' + o + '"' + (o === cur ? ' selected' : '') + '>' + ((sp.labels && sp.labels[o]) || o) + '</option>';
        });
        html += '</select>';
      } else if (sp.t === 'tap') {
        // 亮着的那一挡 =【线当下真的接在哪个量程柱上】（内核按接线解出来的
        // rec.range），不是 params.range —— 与 2D 页同源。没接到量程柱上就直说。
        var T = C.TYPES[c.type], taps = (T && T.rangeTaps) || [], vals = (T && T.rangeValues) || [];
        var rc = (results && results.components && results.components[c.id]) || {};
        var cur = rc.rangeWired ? rc.range : null;
        html += '<label>' + sp.label + '</label>';
        taps.forEach(function (tp, k) {
          html += '<button type="button" class="tapbtn' + (cur === vals[k] ? ' on' : '') + '" data-t="tap" data-k="' + sp.k + '" data-tap="' + tp + '">' + vals[k] + (sp.unit || '') + '</button>';
        });
        if (cur == null) html += '<span class="val">未接量程柱</span>';
      } else if (sp.t === 'flip') {
        html += '<label>' + sp.label + '</label>';
        html += '<button type="button" class="flipbtn" data-t="flip">⇄ 对调</button>';
      }
      html += '</div>';
    });
    box.innerHTML = html || '<div class="empty-note">这个元件没有可调参数。</div>';
    // 事件
    box.querySelectorAll('input[type=range]').forEach(function (inp) {
      inp.addEventListener('input', function () {
        editor.setParam(c.id, inp.dataset.k, parseFloat(inp.value));
        var valEl = inp.parentElement.querySelector('.val');
        var spec = specs.filter(function (s) { return s.k === inp.dataset.k; })[0];
        if (valEl) valEl.textContent = fmtVal(parseFloat(inp.value), spec ? spec.unit : '');
      });
    });
    box.querySelectorAll('input[type=checkbox]').forEach(function (inp) {
      inp.addEventListener('change', function () { editor.setParam(c.id, inp.dataset.k, inp.checked); });
    });
    box.querySelectorAll('select').forEach(function (sel) {
      sel.addEventListener('change', function () { editor.setParam(c.id, sel.dataset.k, sel.value); });
    });
    box.querySelectorAll('.tapbtn').forEach(function (b) {
      b.addEventListener('click', function () { editor.plugRange(c.id, parseInt(b.dataset.tap, 10)); renderParamPanel(); });
    });
    box.querySelectorAll('.flipbtn').forEach(function (b) {
      b.addEventListener('click', function () { editor.flipComp(c.id); renderParamPanel(); });
    });
  }
  function fmtVal(v, unit) { return CP.num1(v) + (unit || ''); }

  // ============================================================
  //  读数表 + 状态
  // ============================================================
  function updateTable() {
    var body = document.getElementById('recBody');
    if (!body) return;
    if (!results || !results.components) { body.innerHTML = '<tr><td colspan="5" class="empty-note">—</td></tr>'; return; }
    var html = '';
    circuitScene.comps.forEach(function (c) {
      if (c.type === 'junction') return;
      var r = results.components[c.id];
      if (!r) return;
      html += '<tr data-id="' + c.id + '">' +
        '<td>' + (CP.TYPE_LABEL[c.type] || c.type) + ' ' + D.nameOf(c) + '</td>' +
        '<td>' + CP.dispI(c, r) + '</td>' +
        '<td>' + CP.dispU(c, r) + '</td>' +
        '<td>' + CP.fmtR(c, r) + '</td>' +
        '<td>' + (r.p == null ? '—' : CP.num1(r.p)) + '</td></tr>';
    });
    body.innerHTML = html || '<tr><td colspan="5" class="empty-note">台上还没有元件。</td></tr>';
    highlightTable();
  }
  function highlightTable() {
    var body = document.getElementById('recBody');
    if (!body) return;
    body.querySelectorAll('tr').forEach(function (tr) {
      tr.classList.toggle('sel', tr.dataset.id === selectedId);
    });
  }
  function updateStatus() {
    var pill = document.getElementById('statpill');
    var warn = document.getElementById('warnBox');
    if (!results) { if (pill) { pill.textContent = '—'; pill.className = 'pill'; } if (warn) warn.innerHTML = ''; return; }
    var st = results.status || '—';
    var map = { ok: ['通路', 'ok'], empty: ['空', ''], shorted: ['短路', 'bad'], singular: ['接线矛盾', 'bad'], 'no-source': ['无电源', 'warn'], 'open-circuit': ['断路', 'warn'] };
    var m = map[st] || [st, ''];
    if (pill) { pill.textContent = m[0]; pill.className = 'pill ' + (m[1] || ''); }
    var html = '';
    (results.warnings || []).forEach(function (wn) {
      var txt = (C.faultLabel && C.faultLabel(wn)) || (typeof wn === 'string' ? wn : (wn.msg || ''));
      if (txt) html += '<div class="note warn">⚠ ' + txt + '</div>';
    });
    circuitScene.comps.forEach(function (c) {
      if (c.fault) html += '<div class="note bad">' + (CP.TYPE_LABEL[c.type] || c.type) + ' ' + D.nameOf(c) + '：' + (c.faultWhy || (C.faultLabel && C.faultLabel(c.fault)) || c.fault) + '</div>';
    });
    if (warn) warn.innerHTML = html;
  }

  function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { toastEl.classList.remove('show'); }, 1600);
  }

  // ============================================================
  //  按钮接线
  // ============================================================
  var state = { view: 'angle' };
  function syncViewButtons() {
    document.querySelectorAll('#views button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.view === state.view);
    });
  }
  function bindUI() {
    var on = function (id, fn) { var el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
    on('btnUndo', doUndo); on('barUndo', doUndo);
    on('btnDelete', doDelete); on('barDelete', doDelete);
    on('btnRotate', doRotate);
    on('btnClear', function () { if (circuitScene.comps.length) doClear(); });
    on('barView', function () {
      var order = ['angle', 'front', 'top', 'side'];
      var i = order.indexOf(state.view); setView(order[(i + 1) % order.length]);
    });
    on('barAdd', function () { addAt('battery'); showToast('已放上一个电源，可在左边元件栏换别的元件'); });
    document.querySelectorAll('#views button').forEach(function (b) {
      b.addEventListener('click', function () { setView(b.dataset.view); });
    });
    document.querySelectorAll('#presets button').forEach(function (b) {
      b.addEventListener('click', function () { loadPreset(b.dataset.preset); });
    });
  }

  // ============================================================
  //  启动
  // ============================================================
  buildPalette();
  bindUI();
  resize();
  loadPreset('series');
  renderParamPanel();
  syncViewButtons();

  var last = performance.now();
  function tick() {
    var now = performance.now();
    var dt = Math.min(0.05, (now - last) / 1000); last = now;
    updateAnim(dt);
    render();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ============================================================
  //  测试钩子
  // ============================================================
  window.__sbx3d = {
    W: W, H: H, S: S, GRID: GRID,
    kit: KIT, THREE: THREE,
    get scene() { return circuitScene; },
    get results() { return results; },
    get flows() { return flows; },
    get selectedId() { return selectedId; },
    get cam() { return cam; },
    get camera() { return camera; },
    get renderer() { return renderer; },
    get compGroup() { return compGroup; },
    get wireGroup() { return wireGroup; },
    get partGroup() { return partGroup; },
    editor: editor,
    solve: solve,
    rebuild: rebuild,
    render: render,
    renderNow: renderNow,
    resize: resize,
    setView: setView,
    loadPreset: loadPreset,
    addComp: addAt,
    deleteSelected: doDelete,
    rotateSelected: doRotate,
    undo: doUndo,
    clearAll: doClear,
    connectTerminals: function (a, b) { return editor.connectTerminals(a, b); },
    select: function (id) { selectedId = id; editor.select(id ? { kind: 'comp', id: id } : null); renderParamPanel(); highlightTable(); rebuild(); render(); },
    // 自检读数
    compObjectCount: function () { return compGroup.children.length; },
    wireObjectCount: function () { return wireGroup.children.length; },
    anchor3D: function (compId, termIdx) {
      var c = byId(compId); if (!c) return null;
      var v = KIT.terminalAnchor(c, termIdx); if (!v) return null;
      return { x: v.x, y: v.y, z: v.z };
    },
    needleAngle: function (compId) {
      var c = byId(compId); if (!c) return null;
      var r = results && results.components ? results.components[compId] : null;
      return KIT.meterNeedleAngle(c, r);
    },
    hudValues: function () {
      var out = {};
      circuitScene.comps.forEach(function (c) {
        var r = results && results.components ? results.components[c.id] : null;
        if (r) out[c.id] = { i: r.i, v: r.v, R: r.R, p: r.p, type: c.type };
      });
      return out;
    },
    builderTypes: function () { return KIT.builderTypes(); },
    hasBuilder: function (t) { return KIT.hasBuilder(t); },
    // 视觉量（自检：必须与 rec 同源）
    glowOf: function (id) {
      var g = compObjects[id]; if (!g) return null;
      var v = null; g.traverse(function (o) { if (o.userData && o.userData.role === 'filament') v = o.material.emissiveIntensity; });
      return v;
    },
    needleRotOf: function (id) {
      var g = compObjects[id]; if (!g) return null;
      var v = null; g.traverse(function (o) { if (o.userData && o.userData.role === 'needle') v = o.rotation.z; });
      return v;
    },
    bladeRotOf: function (id) {
      var g = compObjects[id]; if (!g) return null;
      var v = null; g.children.forEach(function (o) { if (o.userData && o.userData.role === 'blade') v = o.rotation.z; });
      return v;
    },
    particleCount: function () { return particles.length; },
    // 端子锚点一致性（自检：3D 锚点反解必须等于 2D 的 terminalWorld）
    anchorConsistency: function () {
      var rows = [];
      circuitScene.comps.forEach(function (c) {
        var terms = (D.TERMINALS[c.type] || []);
        for (var i = 0; i < terms.length; i++) {
          var a = KIT.terminalAnchor(c, i);
          var w = D.terminalWorld(c, i);
          if (!a || !w) { rows.push({ id: c.id, i: i, ok: false }); continue; }
          var back = KIT.worldToLogical(a);
          rows.push({ id: c.id, i: i, ok: Math.abs(back.x - w.x) < 1e-6 && Math.abs(back.y - w.y) < 1e-6,
                      back: back, w: w });
        }
      });
      return rows;
    },
    roundTrip: function (x, y) {
      var v = KIT.to3D(x, y, 0); var b = KIT.worldToLogical(v);
      return { x: b.x, y: b.y, ok: Math.abs(b.x - x) < 1e-9 && Math.abs(b.y - y) < 1e-9 };
    },
    // 面板行数 vs PARAM_UI 规格数
    panelRowInfo: function () {
      var c = selectedId ? byId(selectedId) : null;
      if (!c) return null;
      var specs = CP.PARAM_UI[c.type] || [];
      var rows = document.querySelectorAll('#paramPanel .prow').length;
      return { type: c.type, specs: specs.length, rows: rows, controlTypes: specs.map(function (s) { return s.t; }) };
    },
    // 把世界坐标投到【视口像素】（自检用真实鼠标事件时需要）
    project: function (v3) {
      var p = v3.clone().project(camera);
      var rect = canvas.getBoundingClientRect();
      return { x: rect.left + (p.x * 0.5 + 0.5) * rect.width,
               y: rect.top + (-p.y * 0.5 + 0.5) * rect.height };
    },
    screenOfAnchor: function (compId, termIdx) {
      var c = byId(compId); if (!c) return null;
      var v = KIT.terminalAnchor(c, termIdx); if (!v) return null;
      return window.__sbx3d.project(v);
    },
    screenOfComp: function (compId) {
      var c = byId(compId); if (!c) return null;
      return window.__sbx3d.project(KIT.to3D(c.x, c.y, KIT.postHeight(c.type)));
    },
    canvasRect: function () { var r = canvas.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; },
    // 直接改元件位置（拖动测试用；等价于用户拖拽的结果）
    moveComp: function (id, x, y) {
      var c = byId(id); if (!c) return false;
      c.x = x; c.y = y; editor.rerouteAll(); onSceneChanged(); return true;
    },
  };
  console.log('[sbx3d] ready', C.version || '');
})();
