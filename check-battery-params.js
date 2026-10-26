#!/usr/bin/env node
/**
 * check-battery-params.js —— 守卫「电源参数被默认值吃掉」这一类静默错误。
 *
 * 背景（2026-10-26，一次踩了三个页面）：
 *   circuit-core.js 的 TYPES.battery.defaults 是 {emf:3, rInt:0}，而 paramsOf() 会把
 *   默认值合进参数。求解器里那句
 *       var emf = P.emf != null ? P.emf : cells * (P.emfPerCell != null ? P.emfPerCell : 1.5);
 *   在合并之后 P.emf 恒有值 ⇒ 老键 cells / emfPerCell / rPerCell **永远读不到**。
 *   于是写着 220 V 的页面悄悄按 3 V 理想电源在算：电流小 70 倍、保险丝不熔、
 *   空气开关不跳、电能表不转 —— 页面上一切「看起来正常」，只有物理是错的。
 *
 * 判据（只认代码，不认注释）：
 *   ① type:'battery' 的 params 里必须有 emf；只有 cells/emfPerCell 的 ⇒ 报错。
 *   ② battery / power 的 params 里出现 emfPerCell / rPerCell ⇒ 报错（老键，读了也没用）。
 *   ③ 其余类型不查：本脚本只盯电源这一处已被证明会静默失效的参数。
 *
 * 用法：
 *   node check-battery-params.js                 # 扫 git 里已入库的 *.html（默认）
 *   node check-battery-params.js --verbose       # 顺带打印每一处电源参数
 *   node check-battery-params.js --files a.html b.html
 *                                                # 只查指定文件（做负向对照用：
 *                                                # 把老键改回去，必须报红）
 * 退出码：0 = 全绿；1 = 有违规（CI/预检可以直接拿它卡）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const LEGACY_KEYS = ['emfPerCell', 'rPerCell'];
const POWER_TYPES = ['battery', 'power'];

// ---------- 取文件清单 ----------
function trackedHtml() {
  // -z + core.quotepath=false：中文文件名不能被 git 转义成 \345\... 那种八进制
  const out = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files', '-z', '*.html'], {
    cwd: __dirname, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  return out.split('\0').filter(Boolean);
}

// ---------- 从源码里抠出 type:'xxx' 后面的 params:{...} ----------
// 手写一个「认字符串、认括号」的小扫描器：params 的值里有函数调用、模板串，
// 用正则 [^}]* 会在第一个 } 处截断（实测漏报），所以按字符走。
function skipString(src, i) {
  const q = src[i];
  i++;
  while (i < src.length) {
    if (src[i] === '\\') { i += 2; continue; }
    if (src[i] === q) return i + 1;
    i++;
  }
  return i;
}

function findParamsObject(src, from) {
  const idx = src.indexOf('params', from);
  if (idx < 0) return null;
  let i = src.indexOf('{', idx);
  if (i < 0) return null;
  const start = i;
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') { i = skipString(src, i); continue; }
    if (c === '/' && src[i + 1] === '/') { const nl = src.indexOf('\n', i); i = nl < 0 ? src.length : nl; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return { text: src.slice(start, i + 1), at: start }; }
    i++;
  }
  return null;
}

function keysOf(objText) {
  // objText 形如 { emf:U_MAINS, rInt:SOURCE_R } / {closed:true} / { R:APPLIANCES[0].R }
  const inner = objText.slice(1, -1);
  const keys = [];
  let depth = 0, cur = '';
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '"' || c === "'" || c === '`') {
      const end = skipString(inner, i);
      cur += inner.slice(i, end);
      i = end - 1;
      continue;
    }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    if (c === ',' && depth === 0) { keys.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) keys.push(cur);
  return keys.map(s => {
    const t = s.trim();
    const m = t.match(/^(['"]?)([A-Za-z_$][\w$]*)\1\s*:/);
    return m ? m[2] : null;
  }).filter(Boolean);
}

// ---------- 扫描一个文件 ----------
function scanFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  const hits = [];
  const re = /type\s*:\s*['"]([A-Za-z]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    const type = m[1];
    if (!POWER_TYPES.includes(type)) continue;
    const p = findParamsObject(src, m.index + m[0].length);
    if (!p) continue;
    // params 必须紧挨着这个元件（中间不能跨过另一个 type:）
    const between = src.slice(m.index + m[0].length, p.at);
    if (/type\s*:/.test(between)) continue;
    const keys = keysOf(p.text);
    const line = src.slice(0, p.at).split('\n').length;
    hits.push({ file, type, keys, line, text: p.text.replace(/\s+/g, ' ') });
  }
  return hits;
}

// ---------- 判据 ----------
function check(hit) {
  const problems = [];
  const legacy = hit.keys.filter(k => LEGACY_KEYS.includes(k));
  if (legacy.length) {
    problems.push(`用了老键 ${legacy.join(' / ')} —— paramsOf 合并默认值后 P.emf 恒有值，求解器永远读不到它们`);
  }
  if (hit.type === 'battery' && !hit.keys.includes('emf')) {
    problems.push('没有 emf —— 会按 TYPES.battery.defaults 的 3 V 理想电源算（写成 emf / rInt）');
  }
  return problems;
}

// ---------- main ----------
const argv = process.argv.slice(2);
const verbose = argv.includes('--verbose');
const fi = argv.indexOf('--files');
let files;
if (fi >= 0) {
  files = argv.slice(fi + 1).filter(a => !a.startsWith('--'));
  if (!files.length) { console.error('--files 后面要给文件路径'); process.exit(2); }
} else {
  files = trackedHtml();
}

let total = 0;
const bad = [];
for (const f of files) {
  const abs = path.isAbsolute(f) ? f : path.join(__dirname, f);
  if (!fs.existsSync(abs)) continue;
  let hits;
  try { hits = scanFile(abs); } catch (e) { console.error(`读不了 ${f}: ${e.message}`); continue; }
  for (const h of hits) {
    total++;
    const probs = check(h);
    if (probs.length) bad.push({ ...h, probs });
    if (verbose) {
      const mark = probs.length ? '❌' : '✓ ';
      console.log(`${mark} ${f}:${h.line}  ${h.type}  {${h.keys.join(', ')}}`);
    }
  }
}

if (bad.length) {
  console.error(`\n❌ ${bad.length} 处电源参数会静默失效（共扫 ${total} 处）：\n`);
  for (const b of bad) {
    console.error(`  ${b.file}:${b.line}  ${b.type}  ${b.text}`);
    for (const p of b.probs) console.error(`      · ${p}`);
  }
  console.error('\n改法：params:{emf:<电动势>, rInt:<内阻>}。');
  console.error('参考提交 89ae356（家庭电路 / 电流过大的原因）、6afd081（电能与电功）。');
  process.exit(1);
}

console.log(`✅ ${files.length} 个页面 / ${total} 处电源参数全部用 emf / rInt（或没有电源参数）`);
