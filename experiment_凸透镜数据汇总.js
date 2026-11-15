// 凸透镜成像分组数据汇总：一名学生/一组一行，系统按薄透镜公式推演并汇总。
// 设计原则：所有派生量只走 derive() 一处，录入预览、表格、图表、统计、导出不再各算一套。

const $ = id => document.getElementById(id);
const STORAGE_KEY = 'lens-summary-v1';
const MAX_GROUP = 16;
const EPS = 0.15; // cm，判断“u≈f / u≈2f”的课堂容差
const VIZ = {
  real: '#2a78d6',
  virtual: '#eb6834',
  none: '#64748b',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  ink: '#0b0b0b',
  ink2: '#52514e',
  muted: '#898781',
  surface: '#ffffff',
  band: '#f8fafc'
};

const REGIONS = {
  gt2f: {
    key: 'gt2f', name: '缩小倒立实像', short: '缩小实像', label: 'u > 2f',
    imageType: '实像', orientation: '倒立', zoom: '缩小', app: '照相机', icon: '📷',
    vRange: 'f < v < 2f', law: 'lawGt'
  },
  eq2f: {
    key: 'eq2f', name: '等大倒立实像', short: '等大实像', label: 'u = 2f',
    imageType: '实像', orientation: '倒立', zoom: '等大', app: '测焦距', icon: '📐',
    vRange: 'v = 2f', law: 'lawEq2'
  },
  mid: {
    key: 'mid', name: '放大倒立实像', short: '放大实像', label: 'f < u < 2f',
    imageType: '实像', orientation: '倒立', zoom: '放大', app: '投影仪', icon: '📽️',
    vRange: 'v > 2f', law: 'lawMid'
  },
  eqF: {
    key: 'eqF', name: '不成像', short: '不成像', label: 'u = f',
    imageType: '不成像', orientation: '不成像', zoom: '不成像', app: '不成像', icon: '—',
    vRange: '—', law: 'lawEqF'
  },
  ltF: {
    key: 'ltF', name: '放大正立虚像', short: '放大虚像', label: 'u < f',
    imageType: '虚像', orientation: '正立', zoom: '放大', app: '放大镜', icon: '🔍',
    vRange: '虚像，与物同侧', law: 'lawLt'
  }
};
const REGION_ORDER = ['gt2f', 'eq2f', 'mid', 'eqF', 'ltF'];
const FILTERS = [
  { key: 'all', name: '全部' },
  ...REGION_ORDER.map(k => ({ key: k, name: REGIONS[k].name }))
];

const SAMPLE_ROWS = [
  { group: 1, u: 30, vMeas: 15.2, hMeas: 17.7 },
  { group: 2, u: 20, vMeas: 20.3, hMeas: 35.5 },
  { group: 3, u: 15, vMeas: 30.5, hMeas: 71.2 },
  { group: 4, u: 8, vMeas: -41, hMeas: 179.4 },
  { group: 5, u: 10, vMeas: null, hMeas: null },
  { group: 6, u: 25, vMeas: 17.0, hMeas: 23.8 },
  // 第 7 组的像距与 f=10 cm 的理论值 43.3 cm 差得较多，专门留作“反算焦距”质检的例子。
  { group: 7, u: 13, vMeas: 33.0, hMeas: 88.8 },
  { group: 8, u: 7, vMeas: -22.8, hMeas: 114.0 },
  { group: 9, u: 40, vMeas: 13.5, hMeas: 11.8 },
  { group: 10, u: 18, vMeas: 22.0, hMeas: 42.8 },
  { group: 11, u: 12, vMeas: 58.0, hMeas: 169.2 },
  { group: 12, u: 9, vMeas: -95, hMeas: 369.4 },
  { group: 13, u: 20.1, vMeas: 19.8, hMeas: 34.5 },
  { group: 14, u: 22, vMeas: 18.5, hMeas: 29.4 },
  { group: 15, u: 6, vMeas: -14.6, hMeas: 85.2 },
  { group: 16, u: 14, vMeas: 36.0, hMeas: 90.0 }
];

const state = {
  f: 10,
  h0: 35,
  rows: [],
  activeGroup: 1,
  filter: 'all',
  sort: 'u',
  autoNext: true,
  demo: false
};

let saveTimer = null;
let toastTimer = null;
let chartRaf = 0;
let uChartPoints = [];
let fChartPoints = [];
let lastSaveAt = '';

/* ============================== 基础工具 ============================== */

function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
function numOrNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function fmt(x, digits = 1) {
  if (!Number.isFinite(x)) return '—';
  let s = x.toFixed(digits);
  if (/^-0(?:\.0+)?$/.test(s)) s = s.slice(1);
  return s;
}
function fmtPct(x, digits = 1) {
  if (!Number.isFinite(x)) return '—';
  const sign = x > 1e-9 ? '+' : x < -1e-9 ? '−' : '';
  return sign + Math.abs(x).toFixed(digits) + '%';
}
function pctClass(x, limit = 5) {
  return Number.isFinite(x) && Math.abs(x) > limit ? 'bad' : '';
}
function regionChipStyle(key) {
  const r = REGIONS[key];
  if (!r) return 'region';
  if (r.imageType === '实像') return 'real';
  if (r.imageType === '虚像') return 'virtual';
  return 'none';
}
function dotClass(key) {
  const r = REGIONS[key];
  return r ? regionChipStyle(key) : 'none';
}
function propertyChips(d) {
  if (!d || !d.ok) return '<span class="chip none">—</span>';
  const r = d.region;
  if (r.key === 'eqF') return '<span class="chip none">不成像</span>';
  return `<span class="chip ${regionChipStyle(r.key)}">${r.imageType}</span>` +
    `<span class="chip">${r.orientation}</span><span class="chip">${r.zoom}</span>`;
}
function groupList(groups) {
  return groups.slice().sort((a, b) => a - b).map(g => `第${g}组`).join('、');
}
function toast(msg, isErr = false) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.toggle('err', isErr);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}
function setSaveState(text, kind = '') {
  const el = $('saveState');
  el.textContent = text;
  el.className = 'save-state' + (kind ? ' ' + kind : '');
}

/* ============================== 数据模型 ============================== */

// 唯一入口：给定一组原始数据，算出区间、理论像距、像的性质、反算焦距和各项偏差。
function derive(row, f = state.f, h0 = state.h0) {
  const u = Number(row && row.u);
  if (!Number.isFinite(u) || u <= 0) return { ok: false, error: '物距必须是大于 0 的数。' };
  if (!Number.isFinite(f) || f <= 0) return { ok: false, error: '焦距必须是大于 0 的数。' };
  if (!Number.isFinite(h0) || h0 <= 0) return { ok: false, error: '光源高度必须是大于 0 的数。' };

  const vMeas = numOrNull(row.vMeas);
  const hMeas = numOrNull(row.hMeas);
  if (vMeas !== null && vMeas === 0) return { ok: false, error: '像距不能填 0；不成像请把物距设成焦距 f。' };
  if (hMeas !== null && hMeas <= 0) return { ok: false, error: '像高必须是大于 0 的数。' };
  if (vMeas !== null && Math.abs(vMeas) > 2000) return { ok: false, error: '像距超出可处理范围（|v| ≤ 2000 cm）。' };

  const twoF = 2 * f;
  const atF = Math.abs(u - f) <= EPS;
  const at2F = !atF && Math.abs(u - twoF) <= EPS;

  let key;
  if (atF) key = 'eqF';
  else if (u < f) key = 'ltF';
  else if (at2F) key = 'eq2f';
  else if (u < twoF) key = 'mid';
  else key = 'gt2f';

  const region = REGIONS[key];
  const vTheory = atF ? null : (f * u) / (u - f);
  const hasMeasuredV = vMeas !== null && !atF;
  const v = hasMeasuredV ? vMeas : vTheory;
  const m = atF || !Number.isFinite(v) ? null : Math.abs(v) / u;
  const h = atF ? null : (hMeas !== null ? hMeas : (m !== null ? m * h0 : null));

  const fRev = hasMeasuredV && Number.isFinite(vMeas) && Math.abs(u + vMeas) > 1e-9
    ? (u * vMeas) / (u + vMeas) : null;
  const fRevDev = fRev !== null && fRev > 0 ? ((fRev - f) / f) * 100 : null;
  const vDev = hasMeasuredV && vTheory !== null && Math.abs(vTheory) > 1e-9
    ? ((vMeas - vTheory) / Math.abs(vTheory)) * 100 : null;
  const signMismatch = hasMeasuredV && vTheory !== null &&
    ((vMeas > 0) !== (vTheory > 0));
  const hDev = hMeas !== null && h !== null && h > 0 && m !== null
    ? ((hMeas - m * h0) / (m * h0)) * 100 : null;

  const warnings = [];
  if (signMismatch) warnings.push('实测像距的符号与理论相反，请检查测量或记录。');
  if (vDev !== null && Math.abs(vDev) > 5) warnings.push(`实测像距与理论值相差 ${fmtPct(vDev)}。`);
  if (fRevDev !== null && Math.abs(fRevDev) > 5) warnings.push(`反算焦距与标称值相差 ${fmtPct(fRevDev)}。`);
  if (hDev !== null && Math.abs(hDev) > 10) warnings.push(`实测像高与 m·h 相差 ${fmtPct(hDev)}。`);

  return {
    ok: true, group: row.group, u, f, h0, twoF, atF, at2F, key, region,
    vTheory, vMeas, hMeas, hasMeasuredV, v, m, h,
    fRev, fRevDev, vDev, signMismatch, hDev, warnings,
    vSource: atF ? '—' : (hasMeasuredV ? '实测' : '推算'),
    hSource: atF ? '—' : (hMeas !== null ? '实测' : '推算'),
    uComp: atF ? (Math.abs(u - f) < 1e-6 ? 'u = f' : 'u ≈ f')
      : at2F ? (Math.abs(u - twoF) < 1e-6 ? 'u = 2f' : 'u ≈ 2f')
        : (u > twoF ? 'u > 2f' : u > f ? 'f < u < 2f' : 'u < f'),
    vComp: at2F ? 'v ≈ 2f' : vBand(v, f, atF)
  };
}

function vBand(v, f, atF) {
  if (atF || v === null || !Number.isFinite(v)) return '不成像';
  if (v === 0) return '—';
  if (v < 0) {
    const a = Math.abs(v);
    if (a > 2 * f + EPS) return '虚像 |v| > 2f';
    if (Math.abs(a - 2 * f) <= EPS) return '虚像 |v| = 2f';
    if (a > f + EPS) return '虚像 f < |v| < 2f';
    if (Math.abs(a - f) <= EPS) return '虚像 |v| = f';
    return '虚像 |v| < f';
  }
  if (v > 2 * f + EPS) return 'v > 2f';
  if (Math.abs(v - 2 * f) <= EPS) return 'v = 2f';
  if (v > f + EPS) return 'f < v < 2f';
  if (Math.abs(v - f) <= EPS) return 'v = f';
  return 'v < f';
}

function readInputs() {
  return {
    u: numOrNull($('uInput').value),
    vMeas: numOrNull($('vInput').value),
    hMeas: numOrNull($('hInput').value)
  };
}

function analyzeInput() {
  const raw = readInputs();
  if (raw.u === null) return { empty: true, raw };
  const d = derive({ group: state.activeGroup, ...raw });
  return { empty: false, raw, d };
}

function rowOf(group) {
  return state.rows.find(r => r.group === group) || null;
}

function allDerived() {
  return state.rows.map(r => derive(r)).filter(d => d.ok);
}

/* ============================== 持久化 ============================== */

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveStateNow, 250);
}

function saveStateNow() {
  try {
    const payload = {
      v: 1,
      f: state.f,
      h0: state.h0,
      rows: state.rows.map(r => ({ group: r.group, u: r.u, vMeas: r.vMeas, hMeas: r.hMeas })),
      activeGroup: state.activeGroup,
      filter: state.filter,
      sort: state.sort,
      autoNext: state.autoNext,
      demo: state.demo,
      savedAt: Date.now()
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    lastSaveAt = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    setSaveState(`✓ 已自动保存 ${lastSaveAt}`, 'ok');
  } catch (err) {
    setSaveState('浏览器未允许本地保存', 'err');
  }
}

function loadState() {
  let saved = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) saved = JSON.parse(raw);
  } catch (err) { saved = null; }
  if (!saved || saved.v !== 1) return;

  const f = Number(saved.f);
  const h0 = Number(saved.h0);
  if (Number.isFinite(f) && f > 0) state.f = f;
  if (Number.isFinite(h0) && h0 > 0) state.h0 = h0;

  if (Array.isArray(saved.rows)) {
    const seen = new Set();
    state.rows = saved.rows.map(r => {
      const group = Number(r.group);
      const u = Number(r.u);
      if (!Number.isInteger(group) || group < 1 || group > MAX_GROUP || seen.has(group)) return null;
      if (!Number.isFinite(u) || u <= 0) return null;
      seen.add(group);
      return {
        group, u,
        vMeas: savedV(r.vMeas),
        hMeas: savedV(r.hMeas)
      };
    }).filter(Boolean).slice(0, MAX_GROUP);
  }

  const ag = Number(saved.activeGroup);
  if (Number.isInteger(ag) && ag >= 1 && ag <= MAX_GROUP) state.activeGroup = ag;
  if (FILTERS.some(fil => fil.key === saved.filter)) state.filter = saved.filter;
  if (saved.sort === 'u' || saved.sort === 'group') state.sort = saved.sort;
  if (typeof saved.autoNext === 'boolean') state.autoNext = saved.autoNext;
  state.demo = !!saved.demo;

  function savedV(v) {
    const n = Number(v);
    return v === null || v === undefined || v === '' || !Number.isFinite(n) || n === 0 ? null : n;
  }
}

/* ============================== 渲染：组别 / 录入 ============================== */

function renderGroupGrid() {
  const grid = $('groupGrid');
  let html = '';
  for (let g = 1; g <= MAX_GROUP; g++) {
    const row = rowOf(g);
    const d = row ? derive(row) : null;
    const done = !!d && d.ok;
    const cls = ['group-btn'];
    if (done) cls.push('done');
    if (done && d.region.key === 'ltF') cls.push('virtual');
    if (done && d.region.key === 'eqF') cls.push('none');
    if (g === state.activeGroup) cls.push('active');
    const label = done ? d.region.short : '待录';
    const tip = done
      ? `第${g}组：u = ${fmt(d.u)} cm，${d.region.name}`
      : `第${g}组：还没有数据`;
    html += `<button type="button" class="${cls.join(' ')}" data-group="${g}" aria-pressed="${g === state.activeGroup}" title="${tip}">` +
      `<span class="dot"></span><b>第${g}组</b><small>${label}</small></button>`;
  }
  grid.innerHTML = html;
  const doneCount = state.rows.length;
  $('progressLabel').textContent = `${doneCount} / ${MAX_GROUP} 组`;
}

function renderEntry() {
  const g = state.activeGroup;
  const row = rowOf(g);
  $('activeGroup').textContent = `第 ${g} 组`;
  $('addBtn').textContent = row ? `更新第 ${g} 组` : `录入第 ${g} 组`;
  if (row) {
    const d = derive(row);
    if (d.ok) {
      $('activeHint').textContent = d.region.key === 'eqF'
        ? '已录入：u = f，不成像'
        : `已录入：u = ${fmt(d.u)} cm，${d.region.name}；像距${d.vSource === '实测' ? '实测' : '按公式推算'}`;
    } else {
      $('activeHint').textContent = '已录入，但数据需要检查';
    }
  } else {
    $('activeHint').textContent = '还没有数据';
  }

  const raw = readInputs();
  const atF = raw.u !== null && Math.abs(raw.u - state.f) <= EPS;
  $('vInput').disabled = atF;
  $('hInput').disabled = atF;
  if (atF) {
    $('entryNote').innerHTML = '<b>u = f 时不成像。</b>折射光平行射出，像距和像高都不用填；这一组只记录物距。';
    $('vInput').placeholder = 'u = f，不用填';
    $('hInput').placeholder = 'u = f，不用填';
  } else {
    $('entryNote').innerHTML = '<b>只填物距也能算。</b>像距留空时，系统按透镜公式推算，并在表里标成「推算」；填了实测像距，就会和理论值比较、并用它反算焦距。';
    $('vInput').placeholder = '可不填';
    $('hInput').placeholder = '可不填';
  }
}

function fillInputsFromRow(row) {
  $('uInput').value = row ? String(row.u) : '';
  $('vInput').value = row && row.vMeas !== null ? String(row.vMeas) : '';
  $('hInput').value = row && row.hMeas !== null ? String(row.hMeas) : '';
}

function selectGroup(g, opts = {}) {
  if (!Number.isInteger(g) || g < 1 || g > MAX_GROUP) return;
  state.activeGroup = g;
  const row = rowOf(g);
  fillInputsFromRow(row);
  hideEntryError();
  renderGroupGrid();
  renderEntry();
  renderProcess();
  renderTable();
  scheduleCharts();
  if (!opts.silent) scheduleSave();
  if (opts.focus) {
    try { $('uInput').focus({ preventScroll: true }); } catch (err) { $('uInput').focus(); }
  }
}

/* ============================== 渲染：处理过程 ============================== */

function renderProcess() {
  const a = analyzeInput();
  const pipes = [1, 2, 3, 4, 5].map(n => document.querySelector(`.pipe[data-step="${n}"]`));
  const marker = $('railMarker');

  if (a.empty) {
    $('processState').textContent = '等待输入物距';
    $('processState').classList.remove('live');
    pipes.forEach(p => p && p.classList.remove('on'));
    $('pipe1').textContent = '输入物距后开始推演。';
    $('pipe2').textContent = '—';
    $('pipe3').textContent = '—';
    $('pipe4').textContent = '—';
    $('pipe5').textContent = '—';
    updateRail(null);
    renderEntry();
    renderLaw();
    return;
  }

  if (!a.d.ok) {
    $('processState').textContent = '输入有误';
    $('processState').classList.remove('live');
    pipes.forEach((p, i) => p && p.classList.toggle('on', i === 0));
    $('pipe1').textContent = a.d.error;
    $('pipe2').textContent = '—';
    $('pipe3').textContent = '—';
    $('pipe4').textContent = '—';
    $('pipe5').textContent = '—';
    updateRail(null);
    renderEntry();
    renderLaw();
    return;
  }

  const d = a.d;
  const r = d.region;
  $('processState').textContent = `第 ${state.activeGroup} 组 · ${r.label}`;
  $('processState').classList.add('live');
  pipes.forEach(p => p && p.classList.add('on'));

  const hText = d.h !== null ? `${fmt(d.h)} mm` : '—';

  $('pipe1').innerHTML = `u = <b>${fmt(d.u)}</b> cm，f = <b>${fmt(d.f)}</b> cm，2f = <b>${fmt(d.twoF)}</b> cm；光源高度 h = ${fmt(d.h0, 0)} mm。`;

  if (r.key === 'eqF') {
    $('pipe2').innerHTML = `<span class="chip none">u ${Math.abs(d.u - d.f) < 1e-6 ? '=' : '≈'} f</span> 物距与焦距只差 ${fmt(Math.abs(d.u - d.f), 2)} cm，按焦点处理。`;
  } else if (r.key === 'eq2f') {
    $('pipe2').innerHTML = `<span class="chip real">u ${Math.abs(d.u - d.twoF) < 1e-6 ? '=' : '≈'} 2f</span> 物距 ${fmt(d.u)} cm 与 2f = ${fmt(d.twoF)} cm 只差 ${fmt(Math.abs(d.u - d.twoF), 2)} cm。`;
  } else if (r.key === 'gt2f') {
    $('pipe2').innerHTML = `<span class="chip real">u &gt; 2f</span> ${fmt(d.u)} cm &gt; ${fmt(d.twoF)} cm，物体在二倍焦距以外。`;
  } else if (r.key === 'mid') {
    $('pipe2').innerHTML = `<span class="chip real">f &lt; u &lt; 2f</span> ${fmt(d.f)} cm &lt; ${fmt(d.u)} cm &lt; ${fmt(d.twoF)} cm，物体在一倍与二倍焦距之间。`;
  } else {
    $('pipe2').innerHTML = `<span class="chip virtual">u &lt; f</span> ${fmt(d.u)} cm &lt; ${fmt(d.f)} cm，物体在焦点以内。`;
  }

  if (r.key === 'eqF') {
    $('pipe3').innerHTML = `u = f 时 <span class="formula-line">1/v = 1/f − 1/u = 0</span> 像距趋于无穷，光屏上得不到像。`;
  } else {
    const vLine = `v理 = f·u/(u−f) = ${fmt(d.f)}×${fmt(d.u)}/(${fmt(d.u)}−${fmt(d.f)}) = ${fmt(d.vTheory)} cm`;
    let extra = '';
    if (d.hasMeasuredV) {
      extra = `<br>实测像距 v = <b>${fmt(d.vMeas)}</b> cm，与理论值相差 ${fmtPct(d.vDev)}。`;
      if (d.signMismatch) extra += ` <span class="chip warn">符号与理论相反</span>`;
    } else {
      extra = `<br>像距留空，采用理论值（表里标「推算」）。`;
    }
    const mLine = d.m !== null ? `<br>m = |v|/u = ${fmt(Math.abs(d.hasMeasuredV ? d.vMeas : d.vTheory))}/${fmt(d.u)} = <b>${fmt(d.m, 2)}</b>` : '';
    $('pipe3').innerHTML = `<span class="formula-line">${vLine}</span>${extra}${mLine}`;
  }

  if (r.key === 'eqF') {
    $('pipe4').innerHTML = `<span class="chip none">不成像</span> 没有像距、放大率和像高，应用一栏也没有对应器材。`;
  } else {
    let hExtra = '';
    if (d.hMeas !== null) hExtra = `<br>你填的像高 h′ = ${fmt(d.hMeas)} mm；按 m·h 算是 ${fmt(d.m * d.h0)} mm。`;
    const hCalc = d.hMeas === null ? '，像高由 m·h 算出' : '';
    $('pipe4').innerHTML = `${propertyChips(d)} 像高 h′ = <b>${hText}</b>${hCalc}。<br>应用：${r.icon} ${r.app}。${hExtra}`;
  }

  if (r.key === 'eqF') {
    $('pipe5').innerHTML = `u = f 时没有有限像距，不能反算焦距；这一组不计入焦距统计。`;
  } else if (d.fRev !== null) {
    const vTxt = d.vMeas < 0 ? `(−${fmt(Math.abs(d.vMeas))})` : fmt(d.vMeas);
    const fLine = `f = u·v/(u+v) = ${fmt(d.u)}×${vTxt}/(${fmt(d.u)}${d.vMeas < 0 ? '−' : '+'}${fmt(Math.abs(d.vMeas))}) = ${fmt(d.fRev, 2)} cm`;
    const badge = Math.abs(d.fRevDev) > 5
      ? `<span class="chip warn">偏差 ${fmtPct(d.fRevDev)}，先检查测量</span>`
      : `<span class="chip good">在 5% 以内</span>`;
    $('pipe5').innerHTML = `<span class="formula-line">${fLine}</span>与标称 ${fmt(d.f)} cm 相差 <b>${fmtPct(d.fRevDev)}</b>。${badge}`;
  } else {
    $('pipe5').innerHTML = `填上实测像距后，这里会用该组数据反算 f = uv/(u+v)，检验它是否接近标称焦距。`;
  }

  updateRail(d);
  renderEntry();
  renderLaw();
}

function updateRail(d) {
  const f = state.f;
  const rail = $('rail');
  const marker = $('railMarker');
  const u = d && d.ok ? d.u : null;
  const maxU = Math.max(3 * f, u ? u * 1.08 : 0, 2 * f + 5);

  $('railLt').style.flex = String(f);
  $('railMid').style.flex = String(f);
  $('railGt').style.flex = String(Math.max(0.001, maxU - 2 * f));
  $('railF').style.left = `${(f / maxU) * 100}%`;
  $('rail2F').style.left = `${(2 * f / maxU) * 100}%`;
  $('railF').querySelector('em').textContent = `f = ${fmt(f)}`;
  $('rail2F').querySelector('em').textContent = `2f = ${fmt(2 * f)}`;
  $('railMax').textContent = `${fmt(maxU, 0)} cm`;
  rail.classList.toggle('compact', maxU > 5.5 * f);

  if (u === null) {
    marker.style.opacity = '0';
    marker.style.left = '0%';
    $('railMarkerText').textContent = 'u';
    marker.classList.remove('at-focus');
    return;
  }
  const pct = clamp((u / maxU) * 100, 0, 100);
  marker.style.opacity = '1';
  marker.style.left = `${pct}%`;
  marker.classList.toggle('at-focus', d.key === 'eqF');
  $('railMarkerText').textContent = d.key === 'eqF'
    ? `u = f · 不成像`
    : d.key === 'eq2f'
      ? `u ≈ 2f · 等大`
      : `u = ${fmt(u)} cm · ${d.region.short}`;
  // 靠近轨道两端时改变标签锚点，避免长标签把页面撑出横向滚动。
  $('railMarkerText').style.transform = pct > 82 ? 'translateX(-100%)' : pct < 12 ? 'translateX(0)' : 'translateX(-50%)';
}

/* ============================== 渲染：表格 ============================== */

function filteredSortedDerived() {
  let list = allDerived();
  if (state.filter !== 'all') list = list.filter(d => d.key === state.filter);
  list.sort((a, b) => state.sort === 'group' ? a.group - b.group : (a.u - b.u) || (a.group - b.group));
  return list;
}

function renderTable() {
  const tbody = $('tableBody');
  const list = filteredSortedDerived();

  if (!list.length) {
    const hasAny = state.rows.length > 0;
    const label = hasAny ? `${REGIONS[state.filter] ? REGIONS[state.filter].name : '这个类别'}还没有数据` : '还没有数据';
    tbody.innerHTML = `<tr><td colspan="11" class="empty-state"><b>${label}</b>` +
      (hasAny
        ? `<span>换个筛选，或继续录入。</span><br><button type="button" class="btn small" data-act="showAll">看全部数据</button>`
        : `<span>从第 1 组开始录入，或先载入 16 组示例看看完整流程。</span><br><button type="button" class="btn small" data-act="sample">载入 16 组示例</button>`) +
      `</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(d => {
    const r = d.region;
    const vValue = d.vSource === '实测' ? d.vMeas : d.vTheory;
    const hValue = d.hSource === '实测' ? d.hMeas : d.h;
    const vCell = r.key === 'eqF'
      ? `<span style="color:#94a3b8">—</span>`
      : `<input class="cell-input" type="number" step="0.1" min="-2000" max="2000" data-group="${d.group}" data-field="v" value="${fmt(vValue)}" aria-label="第${d.group}组像距">` +
        `<span class="src-tag ${d.vSource === '实测' ? 'measured' : 'calc'}">${d.vSource}</span>` +
        (d.vDev !== null && Math.abs(d.vDev) > 5 ? `<span class="dev-badge ${pctClass(d.vDev)}">${fmtPct(d.vDev)}</span>` : '');
    const hCell = r.key === 'eqF'
      ? `<span style="color:#94a3b8">—</span>`
      : `<input class="cell-input" type="number" step="0.1" min="0.1" max="2000" data-group="${d.group}" data-field="h" value="${fmt(hValue)}" aria-label="第${d.group}组像高">` +
        `<span class="src-tag ${d.hSource === '实测' ? 'measured' : 'calc'}">${d.hSource}</span>`;
    const fRevCell = d.fRev === null
      ? `<span style="color:#94a3b8">—</span>`
      : `<b style="color:${d.fRevDev !== null && Math.abs(d.fRevDev) > 5 ? '#b91c1c' : '#1e293b'}">${fmt(d.fRev, 2)}</b>` +
        `<span class="dev-badge ${pctClass(d.fRevDev)}">${fmtPct(d.fRevDev)}</span>`;
    const rowCls = d.group === state.activeGroup ? ' class="selected"' : '';
    return `<tr data-row-group="${d.group}"${rowCls}>
      <td class="group-cell"><span class="cat-dot ${dotClass(d.key)}"></span>第${d.group}组</td>
      <td><input class="cell-input" type="number" step="0.1" min="0.1" max="500" data-group="${d.group}" data-field="u" value="${fmt(d.u)}" aria-label="第${d.group}组物距"></td>
      <td><span class="chip ${regionChipStyle(d.key)}">${d.uComp}</span></td>
      <td>${vCell}</td>
      <td><span class="chip region">${d.vComp}</span></td>
      <td>${hCell}</td>
      <td style="font-family:'SF Mono',Consolas,monospace;font-weight:700;color:#1e293b">${d.m === null ? '—' : fmt(d.m, 2)}</td>
      <td><div class="prop-chips">${propertyChips(d)}</div></td>
      <td style="white-space:nowrap;color:#475569">${r.icon === '—' ? '—' : r.icon + ' ' + r.app}</td>
      <td>${fRevCell}</td>
      <td style="white-space:nowrap">
        <button type="button" class="row-btn" data-act="edit" data-group="${d.group}">编辑</button>
        <button type="button" class="row-btn del" data-act="del" data-group="${d.group}">删除</button>
      </td>
    </tr>`;
  }).join('');
}

function renderFilterChips() {
  const counts = {};
  REGION_ORDER.forEach(k => { counts[k] = 0; });
  allDerived().forEach(d => { counts[d.key] = (counts[d.key] || 0) + 1; });
  $('filterChips').innerHTML = FILTERS.map(fil => {
    const n = fil.key === 'all' ? state.rows.length : counts[fil.key] || 0;
    const active = state.filter === fil.key ? ' active' : '';
    return `<button type="button" class="filter-chip${active}" data-filter="${fil.key}" aria-pressed="${state.filter === fil.key}">${fil.name}<span class="n">${n}</span></button>`;
  }).join('');
}

/* ============================== 渲染：统计 / 规律 ============================== */

function renderStats() {
  const list = allDerived();
  const n = state.rows.length;
  const doneSub = n === 0 ? '等待第 1 组' : n >= MAX_GROUP ? '16 组已全部录入' : `还差 ${MAX_GROUP - n} 组`;
  $('statDone').innerHTML = `${n} <small>/ ${MAX_GROUP} 组</small>`;
  $('statDoneSub').textContent = doneSub;
  $('statBar').style.width = `${(n / MAX_GROUP) * 100}%`;

  const real = list.filter(d => d.region.imageType === '实像').length;
  const virt = list.filter(d => d.region.imageType === '虚像').length;
  const none = list.filter(d => d.region.imageType === '不成像').length;
  $('statType').innerHTML = n ? `${real} <small>实</small> · ${virt} <small>虚</small>` : '—';
  $('statTypeSub').textContent = n ? `实像 ${real} 组 / 虚像 ${virt} 组 / 不成像 ${none} 组` : '实像 / 虚像 / 不成像';

  const counts = {};
  REGION_ORDER.forEach(k => { counts[k] = 0; });
  list.forEach(d => { counts[d.key] = (counts[d.key] || 0) + 1; });
  const covered = REGION_ORDER.filter(k => counts[k] > 0).length;
  $('statCover').innerHTML = `${covered} <small>/ 5 类</small>`;
  $('statCats').innerHTML = REGION_ORDER.map(k => {
    const r = REGIONS[k];
    return `<span class="chip ${regionChipStyle(k)}" title="${r.name}">${r.short} ${counts[k]}</span>`;
  }).join('');

  const measured = list.filter(d => d.hasMeasuredV && Number.isFinite(d.fRev) && d.fRev > 0);
  const calc = list.filter(d => !d.atF && !d.hasMeasuredV).length;
  $('statSrc').innerHTML = `${measured.length} <small>组实测</small>`;
  $('statSrcSub').textContent = `${calc} 组推算${none ? ` · ${none} 组不成像` : ''}`;

  if (measured.length) {
    const vals = measured.map(d => d.fRev);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const dev = ((mean - state.f) / state.f) * 100;
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    $('statF').innerHTML = `${fmt(mean, 2)} <small>cm</small>`;
    $('statFSub').textContent = vals.length > 1
      ? `标称 ${fmt(state.f)} cm，相差 ${fmtPct(dev)}；范围 ${fmt(min, 2)}–${fmt(max, 2)} cm`
      : `标称 ${fmt(state.f)} cm，相差 ${fmtPct(dev)}；多录几组可看离散范围`;
  } else {
    $('statF').innerHTML = '—';
    $('statFSub').textContent = '填了实测像距后才有';
  }
}

function renderLaw() {
  const list = allDerived();
  const buckets = {};
  REGION_ORDER.forEach(k => { buckets[k] = []; });
  list.forEach(d => { if (buckets[d.key]) buckets[d.key].push(d.group); });

  REGION_ORDER.forEach(k => {
    const tr = $(REGIONS[k].law);
    if (!tr) return;
    const groups = buckets[k];
    const cell = tr.querySelector('.law-count');
    cell.innerHTML = groups.length ? `<b>${groups.length}</b> 组 · ${groupList(groups)}` : '—';
    tr.classList.toggle('has-data', groups.length > 0);
  });

  const a = analyzeInput();
  document.querySelectorAll('.law-table tr').forEach(tr => tr.classList.remove('current'));
  if (!a.empty && a.d && a.d.ok) {
    const tr = $(REGIONS[a.d.key].law);
    if (tr) tr.classList.add('current');
  }

  if (!list.length) {
    $('conclusion').innerHTML = '还没有数据。先在第 1 步录入一组，右侧会一步步展示判断与计算。';
    return;
  }

  const covered = REGION_ORDER.filter(k => buckets[k].length > 0).length;
  const real = list.filter(d => d.region.imageType === '实像').length;
  const virt = list.filter(d => d.region.imageType === '虚像').length;
  const none = list.filter(d => d.region.imageType === '不成像').length;
  const missing = REGION_ORDER.filter(k => buckets[k].length === 0).map(k => REGIONS[k].label);
  const measured = list.filter(d => d.hasMeasuredV && Number.isFinite(d.fRev) && d.fRev > 0);

  let text = `已录入 <b>${list.length}</b> 组，覆盖 <b>${covered} / 5</b> 个物距区间：实像 ${real} 组、虚像 ${virt} 组、不成像 ${none} 组。`;
  text += ' 物距从大往小，像依次从「倒立缩小实像 → 倒立等大实像 → 倒立放大实像 → 不成像 → 正立放大虚像」变化。';
  if (measured.length) {
    const vals = measured.map(d => d.fRev);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const dev = ((mean - state.f) / state.f) * 100;
    const bad = measured.filter(d => d.fRevDev !== null && Math.abs(d.fRevDev) > 5).length;
    text += ` 用 ${measured.length} 组实测像距反算焦距，均值 <b>${fmt(mean, 2)} cm</b>，与标称 ${fmt(state.f)} cm 相差 ${fmtPct(dev)}`;
    text += bad ? `；其中 ${bad} 组偏差超过 5%，建议先复查测量。` : '；全部在 5% 以内。';
  }
  if (missing.length) text += ` 还没覆盖：${missing.join('、')}。`;
  $('conclusion').innerHTML = text;
}

/* ============================== 图表 ============================== */

function fitCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 40 || rect.height < 40) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.round(rect.width);
  const H = Math.round(rect.height);
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  return { ctx, W, H };
}

function emptyChart(ctx, W, H, text) {
  ctx.fillStyle = VIZ.muted;
  ctx.font = '11px -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, W / 2, H / 2);
}

function drawUChart() {
  const canvas = $('uChart');
  const fit = fitCanvas(canvas);
  if (!fit) return;
  const { ctx, W, H } = fit;
  const list = allDerived();
  const f = state.f;
  const pad = { l: 78, r: 14, t: 18, b: 34 };
  const maxU = Math.max(3.15 * f, ...list.map(d => d.u * 1.06), 2 * f + 2);
  const xMax = Math.ceil(maxU * 10) / 10;
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const rowH = plotH / 5;
  const X = u => pad.l + (u / xMax) * plotW;

  ctx.fillStyle = VIZ.band;
  ctx.fillRect(pad.l, pad.t, plotW, plotH);

  const rowOrder = ['gt2f', 'eq2f', 'mid', 'eqF', 'ltF'];
  rowOrder.forEach((key, i) => {
    const y0 = pad.t + rowH * i;
    if (i % 2 === 1) {
      ctx.fillStyle = '#fbfdff';
      ctx.fillRect(pad.l, y0, plotW, rowH);
    }
    ctx.strokeStyle = '#eef2f7';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.l, y0);
    ctx.lineTo(W - pad.r, y0);
    ctx.stroke();

    const r = REGIONS[key];
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = VIZ.ink2;
    ctx.font = '700 10.5px -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(r.label, 8, y0 + rowH / 2 - 6);
    ctx.fillStyle = VIZ.muted;
    ctx.font = '9.5px -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(r.name, 8, y0 + rowH / 2 + 8);
  });

  // 纵向参考线：0、f、2f、右边界
  const ticks = [0, f, 2 * f, xMax];
  const seen = [];
  ticks.forEach(v => {
    if (seen.some(x => Math.abs(x - v) < 1e-6)) return;
    seen.push(v);
    const x = X(v);
    ctx.strokeStyle = VIZ.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, pad.t);
    ctx.lineTo(x, pad.t + plotH);
    ctx.stroke();
    ctx.fillStyle = VIZ.muted;
    ctx.font = '9.5px -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const label = v === f ? `f=${fmt(f)}` : v === 2 * f ? `2f=${fmt(2 * f)}` : fmt(v, 1);
    ctx.fillText(label, x, pad.t + plotH + 8);
  });

  ctx.strokeStyle = VIZ.axis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t + plotH);
  ctx.lineTo(W - pad.r, pad.t + plotH);
  ctx.stroke();

  uChartPoints = [];
  if (!list.length) {
    emptyChart(ctx, W, H, '录入数据后，这里显示每组落在哪个区间');
    return;
  }

  const rowIndex = { gt2f: 0, eq2f: 1, mid: 2, eqF: 3, ltF: 4 };
  list.forEach(d => {
    const idx = rowIndex[d.key];
    const baseY = pad.t + rowH * (idx + 0.5);
    const jitter = (((d.group * 13) % 7) - 3) * Math.min(4.5, rowH * 0.09);
    const x = X(d.u);
    const y = baseY + jitter;
    const color = d.region.imageType === '实像' ? VIZ.real : d.region.imageType === '虚像' ? VIZ.virtual : VIZ.none;
    const selected = d.group === state.activeGroup;

    if (selected) {
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 8.5, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = color;
    ctx.strokeStyle = VIZ.surface;
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (d.key === 'eqF') {
      ctx.rect(x - 4, y - 4, 8, 8);
    } else {
      ctx.arc(x, y, 4.6, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.stroke();

    if (selected) {
      const label = `第${d.group}组`;
      ctx.font = '700 9.5px -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif';
      const tw = ctx.measureText(label).width + 8;
      const ly = y - 14;
      ctx.fillStyle = 'rgba(255,255,255,.94)';
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1;
      roundRect(ctx, x - tw / 2, ly - 7, tw, 14, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#1e293b';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x, ly);
    }

    uChartPoints.push({ x, y, group: d.group, d });
  });

  ctx.fillStyle = VIZ.muted;
  ctx.font = '9px -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText('物距 u / cm', W - pad.r, 3);
}

function drawFChart() {
  const canvas = $('fChart');
  const fit = fitCanvas(canvas);
  if (!fit) return;
  const { ctx, W, H } = fit;
  const list = allDerived().filter(d => d.hasMeasuredV && Number.isFinite(d.fRev) && d.fRev > 0);
  const f = state.f;
  const pad = { l: 52, r: W < 420 ? 86 : 112, t: 24, b: 36 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const plotRight = W - pad.r;

  if (!list.length) {
    emptyChart(ctx, W, H, '填了实测像距后，这里核对每组反算的焦距');
    fChartPoints = [];
    return;
  }

  const vals = list.map(d => d.fRev);
  let lo = Math.min(f, ...vals);
  let hi = Math.max(f, ...vals);
  let span = hi - lo;
  if (span < f * 0.12) span = f * 0.12;
  const padY = span * 0.4;
  const yMin = Math.max(0, lo - padY);
  const yMax = hi + padY;
  const Y = v => pad.t + (1 - (v - yMin) / (yMax - yMin)) * plotH;
  const Xg = g => pad.l + ((g - 1) / 15) * plotW;

  ctx.fillStyle = VIZ.band;
  ctx.fillRect(pad.l, pad.t, plotW, plotH);

  // 横向网格与刻度
  [yMin, (yMin + yMax) / 2, yMax].forEach(v => {
    const y = Y(v);
    ctx.strokeStyle = VIZ.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(plotRight, y);
    ctx.stroke();
    ctx.fillStyle = VIZ.muted;
    ctx.font = '9.5px -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(fmt(v, 1), pad.l - 6, y);
  });

  // 标称焦距
  const yNom = Y(f);
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(pad.l, yNom);
  ctx.lineTo(plotRight, yNom);
  ctx.stroke();
  ctx.fillStyle = VIZ.ink2;
  ctx.font = '700 9.5px -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`标称 ${fmt(f)}`, plotRight + 8, yNom - 3);

  // 均值
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const meanDev = ((mean - f) / f) * 100;
  const yMean = Y(mean);
  ctx.strokeStyle = Math.abs(meanDev) > 5 ? '#d97706' : '#059669';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(pad.l, yMean);
  ctx.lineTo(plotRight, yMean);
  ctx.stroke();
  ctx.fillStyle = Math.abs(meanDev) > 5 ? '#b45309' : '#047857';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = '700 9.5px -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillText(`均值 ${fmt(mean, 2)}`, plotRight + 8, yMean + 4);
  ctx.font = '9px -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillText(`（${fmtPct(meanDev)}）`, plotRight + 8, yMean + 15);

  // x 轴组别
  ctx.strokeStyle = VIZ.axis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t + plotH);
  ctx.lineTo(plotRight, pad.t + plotH);
  ctx.stroke();
  ctx.fillStyle = VIZ.muted;
  ctx.font = '9px -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  [1, 4, 7, 10, 13, 16].forEach(g => {
    ctx.fillText(String(g), Xg(g), pad.t + plotH + 7);
  });
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('f / cm', 8, pad.t - 12);
  ctx.textAlign = 'right';
  ctx.fillText('组别', plotRight, pad.t - 12);

  fChartPoints = [];
  list.forEach(d => {
    const x = Xg(d.group);
    const y = Y(d.fRev);
    const bad = d.fRevDev !== null && Math.abs(d.fRevDev) > 5;
    const selected = d.group === state.activeGroup;
    if (selected) {
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 8.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = bad ? '#dc2626' : VIZ.real;
    ctx.strokeStyle = VIZ.surface;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 4.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (bad) {
      ctx.fillStyle = '#b91c1c';
      ctx.font = '700 9.5px -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('!', x, y - 7);
    }
    fChartPoints.push({ x, y, group: d.group, d });
  });
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function scheduleCharts() {
  if (chartRaf) return;
  chartRaf = requestAnimationFrame(() => {
    chartRaf = 0;
    drawUChart();
    drawFChart();
  });
}

function bindChartHover(canvasId, tipId, pointsGetter) {
  const canvas = $(canvasId);
  const tip = $(tipId);
  const wrap = canvas.parentElement;

  canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let best = null;
    let bestDist = 14;
    pointsGetter().forEach(p => {
      const dist = Math.hypot(p.x - mx, p.y - my);
      if (dist < bestDist) { best = p; bestDist = dist; }
    });
    if (!best) { tip.hidden = true; return; }

    const d = best.d;
    const vText = d.region.key === 'eqF' ? '不成像' : `${d.vSource === '实测' ? '实测' : '推算'} v = ${fmt(d.v)} cm`;
    let extra = '';
    if (d.hasMeasuredV && d.fRev !== null) extra = `<br><span>反算 f = ${fmt(d.fRev, 2)} cm（${fmtPct(d.fRevDev)}）</span>`;
    if (d.key === 'eqF' || d.region.key === 'eqF') extra = '<br><span>u = f，光屏上得不到像</span>';
    tip.innerHTML = `<b>第${d.group}组</b> · ${d.region.name}<br><span>u = ${fmt(d.u)} cm，${vText}，m = ${d.m === null ? '—' : fmt(d.m, 2)}</span>${extra}`;
    tip.hidden = false;

    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let left = best.x + 12;
    if (left + tw > wrap.clientWidth - 4) left = best.x - tw - 12;
    left = Math.max(4, Math.min(wrap.clientWidth - tw - 4, left));
    const top = Math.max(th / 2 + 4, Math.min(wrap.clientHeight - th / 2 - 4, best.y));
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  });

  canvas.addEventListener('mouseleave', () => { tip.hidden = true; });
}

/* ============================== 渲染总控 ============================== */

function renderAll() {
  renderGroupGrid();
  renderEntry();
  renderProcess();
  renderFilterChips();
  renderTable();
  renderStats();
  scheduleCharts();
}

function hideEntryError() {
  $('entryError').hidden = true;
  $('entryError').textContent = '';
}

function showEntryError(msg) {
  $('entryError').textContent = msg;
  $('entryError').hidden = false;
}

/* ============================== 录入 / 编辑 / 删除 ============================== */

function addRow() {
  const a = analyzeInput();
  if (a.empty) {
    showEntryError('请先填写物距 u。');
    toast('请先填写物距', true);
    $('uInput').focus();
    return;
  }
  if (!a.d.ok) {
    showEntryError(a.d.error);
    toast(a.d.error, true);
    return;
  }
  if (Math.abs(a.raw.u - state.f) <= EPS && (a.raw.vMeas !== null || a.raw.hMeas !== null)) {
    // 不成像时不保留像距/像高，避免导出时出现自相矛盾的数据。
  }
  hideEntryError();

  const existing = rowOf(state.activeGroup);
  if (existing && !confirm(`第 ${state.activeGroup} 组已经有数据，要用当前输入覆盖吗？`)) return;

  const row = {
    group: state.activeGroup,
    u: a.raw.u,
    vMeas: a.d.atF ? null : a.raw.vMeas,
    hMeas: a.d.atF ? null : a.raw.hMeas
  };
  const idx = state.rows.findIndex(r => r.group === row.group);
  if (idx >= 0) state.rows[idx] = row;
  else state.rows.push(row);
  state.rows.sort((x, y) => x.group - y.group);
  state.demo = false;

  toast(`第 ${row.group} 组已${existing ? '更新' : '录入'}`);
  scheduleSave();
  renderAll();
  setDemoUI();

  if (!existing && state.autoNext) {
    let next = 0;
    for (let step = 1; step <= MAX_GROUP; step++) {
      const g = ((row.group - 1 + step) % MAX_GROUP) + 1;
      if (!rowOf(g)) { next = g; break; }
    }
    if (next) {
      selectGroup(next, { silent: true, focus: true });
      setTimeout(() => { try { $('uInput').select(); } catch (err) {} }, 0);
    }
  } else {
    const current = rowOf(state.activeGroup);
    fillInputsFromRow(current);
    renderAll();
  }
}

function handleTableChange(e) {
  const input = e.target.closest('.cell-input');
  if (!input) return;
  const group = Number(input.dataset.group);
  const field = input.dataset.field;
  const row = rowOf(group);
  if (!row) return;

  if (field === 'u') {
    const v = numOrNull(input.value);
    if (v === null || v <= 0) {
      toast('物距必须是大于 0 的数', true);
      renderAll();
      return;
    }
    row.u = v;
  } else if (field === 'v') {
    const v = numOrNull(input.value);
    if (v !== null && v === 0) {
      toast('像距不能填 0', true);
      renderAll();
      return;
    }
    row.vMeas = v;
  } else if (field === 'h') {
    const v = numOrNull(input.value);
    if (v !== null && v <= 0) {
      toast('像高必须是大于 0 的数', true);
      renderAll();
      return;
    }
    row.hMeas = v;
  } else {
    return;
  }

  const d = derive(row);
  if (!d.ok) {
    toast(d.error, true);
    renderAll();
    return;
  }
  if (group === state.activeGroup) fillInputsFromRow(row);
  scheduleSave();
  renderAll();
  toast(`第 ${group} 组已更新`);
}

function deleteRow(group) {
  const row = rowOf(group);
  if (!row) return;
  if (!confirm(`确定删除第 ${group} 组的数据吗？`)) return;
  state.rows = state.rows.filter(r => r.group !== group);
  if (state.activeGroup === group) {
    fillInputsFromRow(null);
    hideEntryError();
  }
  scheduleSave();
  renderAll();
  toast(`第 ${group} 组已删除`);
}

/* ============================== 参数 / 示例 / 清空 ============================== */

function applyF(value, quiet = false) {
  const f = Number(value);
  if (!Number.isFinite(f) || f <= 0 || f > 50) {
    toast('焦距需在 1–50 cm 之间', true);
    $('fInput').value = fmt(state.f);
    return;
  }
  const changed = Math.abs(f - state.f) > 1e-9;
  state.f = f;
  $('fInput').value = fmt(f);
  document.querySelectorAll('#fPresets button').forEach(btn => {
    btn.classList.toggle('on', Math.abs(Number(btn.dataset.f) - f) < 1e-9);
  });
  renderAll();
  if (changed) {
    scheduleSave();
    if (!quiet) toast(`焦距改为 ${fmt(f)} cm，已重算全部数据`);
  }
}

function applyH0(value, quiet = false) {
  const h0 = Number(value);
  if (!Number.isFinite(h0) || h0 <= 0 || h0 > 200) {
    toast('光源高度需在 1–200 mm 之间', true);
    $('h0Input').value = fmt(state.h0, 0);
    return;
  }
  const changed = Math.abs(h0 - state.h0) > 1e-9;
  state.h0 = h0;
  renderAll();
  if (changed) {
    scheduleSave();
    if (!quiet && state.rows.length) toast(`光源高度改为 ${fmt(h0, 0)} mm，像高已重算`);
  }
}

function setDemoUI() {
  $('demoBanner').hidden = !state.demo;
  $('sampleBtn').textContent = state.demo ? '重新载入示例' : '载入 16 组示例';
}

function loadSample() {
  if (state.rows.length && !confirm('当前已有数据，载入示例会覆盖现有记录，继续吗？')) return;
  state.rows = SAMPLE_ROWS.map(r => ({ ...r }));
  state.f = 10;
  state.h0 = 35;
  state.activeGroup = 1;
  state.filter = 'all';
  state.demo = true;
  $('fInput').value = '10';
  $('h0Input').value = '35';
  document.querySelectorAll('#fPresets button').forEach(btn => btn.classList.toggle('on', btn.dataset.f === '10'));
  $('sortSelect').value = state.sort;
  fillInputsFromRow(rowOf(1));
  hideEntryError();
  renderAll();
  setDemoUI();
  scheduleSave();
  toast('已载入 16 组示例数据（演示用）');
}

function clearAll() {
  if (!state.rows.length) {
    toast('当前没有数据');
    return;
  }
  if (!confirm('确定清空全部数据吗？焦距和光源高度会保留。此操作不可恢复。')) return;
  state.rows = [];
  state.activeGroup = 1;
  state.filter = 'all';
  state.demo = false;
  fillInputsFromRow(null);
  hideEntryError();
  $('sortSelect').value = state.sort;
  renderAll();
  setDemoUI();
  scheduleSave();
  toast('已清空，可以开始录入本班数据');
}

/* ============================== 导出 / 复制 ============================== */

function csvEscape(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCsv() {
  const rows = [...state.rows].sort((a, b) => a.group - b.group).map(r => derive(r)).filter(d => d.ok);
  const out = [];
  out.push(['凸透镜成像分组实验数据汇总表']);
  out.push(['导出时间', new Date().toLocaleString('zh-CN', { hour12: false })]);
  out.push(['焦距 f (cm)', fmt(state.f)]);
  out.push(['两倍焦距 2f (cm)', fmt(2 * state.f)]);
  out.push(['光源高度 h (mm)', fmt(state.h0, 0)]);
  out.push(['完成组数', `${rows.length} / ${MAX_GROUP}`]);
  out.push([]);
  out.push(['组别', '物距 u (cm)', 'u 与 f、2f', '像距 v (cm)', 'v 与 f、2f', '像高 h′ (mm)', '放大率 m', '缩放情况', '正立/倒立', '成像性质', '反算焦距 f (cm)', '像距偏差', '核对提示', '应用', '成像类别', '像距来源']);
  rows.forEach(d => {
    out.push([
      `第${d.group}组`,
      fmt(d.u),
      d.uComp,
      d.region.key === 'eqF' ? '不成像' : fmt(d.v),
      d.vComp,
      d.region.key === 'eqF' ? '不成像' : fmt(d.h),
      d.m === null ? '/' : fmt(d.m, 2),
      d.region.zoom,
      d.region.orientation,
      d.region.imageType,
      d.fRev === null ? '/' : fmt(d.fRev, 2),
      d.vDev === null ? '/' : fmtPct(d.vDev),
      d.warnings.length ? d.warnings.map(w => w.replace(/[。；;]\s*$/, '')).join('；') : '正常',
      d.region.app,
      d.region.name,
      d.vSource
    ]);
  });
  out.push([]);
  out.push(['数据统计']);
  const real = rows.filter(d => d.region.imageType === '实像').length;
  const virt = rows.filter(d => d.region.imageType === '虚像').length;
  const none = rows.filter(d => d.region.imageType === '不成像').length;
  out.push(['实像数量', `${real} 组`]);
  out.push(['虚像数量', `${virt} 组`]);
  out.push(['不成像数量', `${none} 组`]);
  REGION_ORDER.forEach(k => {
    out.push([REGIONS[k].name, `${rows.filter(d => d.key === k).length} 组`]);
  });
  const measured = rows.filter(d => d.hasMeasuredV && Number.isFinite(d.fRev) && d.fRev > 0);
  if (measured.length) {
    const vals = measured.map(d => d.fRev);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    out.push(['反算焦距均值 (cm)', fmt(mean, 2)]);
    out.push(['与标称焦距相差', fmtPct(((mean - state.f) / state.f) * 100)]);
  }
  return '﻿' + out.map(line => line.map(csvEscape).join(',')).join('\r\n');
}

function downloadCsv() {
  if (!state.rows.length) {
    toast('还没有数据可以导出', true);
    return;
  }
  const csv = buildCsv();
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const name = `凸透镜成像分组数据_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.csv`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
  toast('CSV 已开始下载，Excel 可直接打开');
}

function tableTsv() {
  const head = ['组别', '物距u/cm', 'u与f、2f', '像距v/cm', 'v与f、2f', '像高h′/mm', '放大率m', '缩放', '正倒', '实虚', '反算f/cm', '应用', '类别'];
  const list = filteredSortedDerived();
  const lines = [head.join('\t')];
  list.forEach(d => {
    lines.push([
      `第${d.group}组`, fmt(d.u), d.uComp,
      d.region.key === 'eqF' ? '不成像' : fmt(d.v), d.vComp,
      d.region.key === 'eqF' ? '不成像' : fmt(d.h),
      d.m === null ? '/' : fmt(d.m, 2), d.region.zoom, d.region.orientation,
      d.region.imageType, d.fRev === null ? '/' : fmt(d.fRev, 2),
      d.region.app, d.region.name
    ].join('\t'));
  });
  return lines.join('\n');
}

function copyTable() {
  if (!filteredSortedDerived().length) {
    toast('当前没有可复制的数据', true);
    return;
  }
  const text = tableTsv();
  const done = () => toast('已复制为表格，可直接粘贴到 Word / Excel');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}

function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
  ta.remove();
  if (ok) done();
  else toast('复制失败，请手动选择表格', true);
}

/* ============================== 事件绑定 ============================== */

function bindEvents() {
  $('groupGrid').addEventListener('click', e => {
    const btn = e.target.closest('.group-btn');
    if (!btn) return;
    selectGroup(Number(btn.dataset.group), { focus: false });
  });

  $('addBtn').addEventListener('click', addRow);
  $('clearInputs').addEventListener('click', () => {
    fillInputsFromRow(null);
    hideEntryError();
    renderProcess();
    $('uInput').focus();
  });

  ['uInput', 'vInput', 'hInput'].forEach(id => {
    const el = $(id);
    el.addEventListener('input', () => {
      hideEntryError();
      renderProcess();
    });
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addRow();
      }
    });
  });

  $('fInput').addEventListener('change', () => applyF($('fInput').value));
  $('h0Input').addEventListener('change', () => applyH0($('h0Input').value));
  $('fPresets').addEventListener('click', e => {
    const btn = e.target.closest('button[data-f]');
    if (!btn) return;
    applyF(btn.dataset.f);
  });

  $('autoNext').addEventListener('change', () => {
    state.autoNext = $('autoNext').checked;
    scheduleSave();
    toast(state.autoNext ? '录完会自动跳到下一个未录组' : '录完停留在当前组');
  });

  $('sampleBtn').addEventListener('click', loadSample);
  $('demoClear').addEventListener('click', clearAll);
  $('clearBtn').addEventListener('click', clearAll);

  $('filterChips').addEventListener('click', e => {
    const btn = e.target.closest('.filter-chip');
    if (!btn) return;
    state.filter = btn.dataset.filter;
    scheduleSave();
    renderFilterChips();
    renderTable();
  });

  $('sortSelect').addEventListener('change', () => {
    state.sort = $('sortSelect').value === 'group' ? 'group' : 'u';
    scheduleSave();
    renderTable();
  });

  $('tableBody').addEventListener('change', handleTableChange);
  $('tableBody').addEventListener('click', e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'edit') {
      selectGroup(Number(btn.dataset.group), { focus: false });
      $('entryTitle').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (act === 'del') {
      deleteRow(Number(btn.dataset.group));
    } else if (act === 'sample') {
      loadSample();
    } else if (act === 'showAll') {
      state.filter = 'all';
      renderFilterChips();
      renderTable();
      scheduleSave();
    }
  });

  $('exportBtn').addEventListener('click', downloadCsv);
  $('copyBtn').addEventListener('click', copyTable);

  $('fsBtn').addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', () => {
    $('fsBtn').textContent = document.fullscreenElement ? '⤢ 退出全屏' : '⛶ 全屏';
  });

  bindChartHover('uChart', 'uTip', () => uChartPoints);
  bindChartHover('fChart', 'fTip', () => fChartPoints);

  if (window.ResizeObserver) {
    const ro = new ResizeObserver(scheduleCharts);
    const charts = document.querySelector('.charts');
    if (charts) ro.observe(charts);
    const uWrap = $('uChart').parentElement;
    const fWrap = $('fChart').parentElement;
    if (uWrap) ro.observe(uWrap);
    if (fWrap) ro.observe(fWrap);
  }
  window.addEventListener('resize', scheduleCharts);
  window.addEventListener('scroll', () => {
    $('uTip').hidden = true;
    $('fTip').hidden = true;
  }, { passive: true });
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    const p = document.documentElement.requestFullscreen
      ? document.documentElement.requestFullscreen()
      : Promise.reject(new Error('unsupported'));
    p.catch(() => toast('当前环境不支持全屏', true));
  } else {
    document.exitFullscreen().catch(() => {});
  }
}

/* ============================== 初始化 ============================== */

function init() {
  loadState();
  $('fInput').value = fmt(state.f);
  $('h0Input').value = fmt(state.h0, 0);
  $('sortSelect').value = state.sort;
  $('autoNext').checked = state.autoNext;
  document.querySelectorAll('#fPresets button').forEach(btn => {
    btn.classList.toggle('on', Math.abs(Number(btn.dataset.f) - state.f) < 1e-9);
  });

  bindEvents();

  const row = rowOf(state.activeGroup);
  fillInputsFromRow(row);
  renderAll();
  setDemoUI();
  if (state.rows.length) setSaveState(`✓ 已恢复 ${state.rows.length} 组本机数据`, 'ok');
  else setSaveState('数据只保存在本机浏览器');

  // 给测试 / 调试留一个只读入口，同时方便后续维护时核对每一步的数字。
  window.__lensSummary = {
    state,
    derive,
    analyzeInput,
    addRow,
    selectGroup,
    loadSample,
    clearAll,
    buildCsv,
    tableTsv,
    renderAll,
    get chartPoints() { return { u: uChartPoints, f: fChartPoints }; },
    debug() {
      const d = allDerived();
      return {
        rows: state.rows.length,
        f: state.f,
        h0: state.h0,
        filter: state.filter,
        sort: state.sort,
        activeGroup: state.activeGroup,
        demo: state.demo,
        categories: REGION_ORDER.reduce((o, k) => (o[k] = d.filter(x => x.key === k).length, o), {}),
        chartU: uChartPoints.length,
        chartF: fChartPoints.length,
        storage: (() => { try { return localStorage.getItem(STORAGE_KEY) ? localStorage.getItem(STORAGE_KEY).length : 0; } catch (e) { return -1; } })(),
        saveText: $('saveState').textContent
      };
    }
  };
}

init();
