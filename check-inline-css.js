#!/usr/bin/env node
/**
 * 内联 CSS 守卫 / 同步工具
 *
 *   node check-inline-css.js         只检查 index.html 的内联样式是否与 style.css 同步
 *   node check-inline-css.js --fix   把 style.css 重新内联进 index.html
 *
 * 背景：本站源站在境外（EdgeOne 新加坡节点），国内用户每次首屏都要跨境。
 * 原先 <head> 里是 <link rel="stylesheet" href="style.css">，是一次【渲染阻塞】
 * 的跨境请求；而 style.css 的 Cache-Control 只有 120s（≈ 等于不缓存），
 * 所以把它内联进 HTML 不损失任何缓存收益，却省掉一个跨境 RTT。
 *
 * 🔴 改过 style.css 之后，务必跑一次 `node check-inline-css.js --fix`，
 *    否则 index.html 会停在旧样式上（其它页面读的仍是 style.css，于是首页
 *    和其它页面样式不一致）。这个脚本就是用来兜住这个坑的。
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const CSS_FILE = path.join(ROOT, 'style.css');
const HTML_FILE = path.join(ROOT, 'index.html');

const START_MARK = '<!-- INLINE-CSS:START';
const END_MARK = '<!-- INLINE-CSS:END -->';
const LINK_LINE = '  <link rel="stylesheet" href="style.css">';

function buildBlock(css) {
  const body = String(css).replace(/\r\n/g, '\n').replace(/\s+$/, '');
  if (body.indexOf('</style') !== -1) {
    console.error('❌ style.css 里出现了 </style，无法安全内联');
    process.exit(1);
  }
  return [
    '  ' + START_MARK + ' · 由 check-inline-css.js --fix 从 style.css 自动生成，勿手改 -->',
    '  <style>',
    body,
    '  </style>',
    '  ' + END_MARK,
  ].join('\n');
}

function currentBlock(html) {
  const i = html.indexOf(START_MARK);
  if (i < 0) return null;
  const j = html.indexOf(END_MARK, i);
  if (j < 0) return null;
  // 🔴 必须把行首缩进一并纳入块范围：buildBlock 生成的块首带 2 个空格缩进，
  //    若这里从 START_MARK 本身开始截，截出来的块会比 want 少 2 个字符，
  //    have !== want 恒成立 —— 于是 --fix 刚跑完 --check 就报「不同步」。
  let s = i;
  while (s > 0 && (html[s - 1] === ' ' || html[s - 1] === '\t')) s--;
  return html.slice(s, j + END_MARK.length);
}

const css = fs.readFileSync(CSS_FILE, 'utf8');
const want = buildBlock(css);
const html = fs.readFileSync(HTML_FILE, 'utf8');
const have = currentBlock(html);
const fix = process.argv.includes('--fix');

if (!fix) {
  const problems = [];
  if (!have) {
    problems.push('index.html 里找不到 INLINE-CSS 标记块');
  } else if (have !== want) {
    problems.push('index.html 的内联 CSS 与 style.css 不同步（style.css 改过但没重新内联？）');
  }
  if (html.indexOf(LINK_LINE) !== -1) {
    problems.push('index.html 仍然引用着 <link rel="stylesheet" href="style.css">，首屏会多一个跨境请求');
  }
  if (problems.length) {
    console.error('❌ 内联 CSS 守卫未通过：');
    problems.forEach(function (p) { console.error('   · ' + p); });
    console.error('\n   修复： node check-inline-css.js --fix');
    process.exit(1);
  }
  console.log('✅ 内联 CSS 与 style.css 同步（' + css.length + ' 字符）');
  process.exit(0);
}

let out;
if (have) {
  // 用函数式替换，避免 want 里的 $ 被当成替换模式
  out = html.replace(have, function () { return want; });
} else if (html.indexOf(LINK_LINE) !== -1) {
  out = html.replace(LINK_LINE, function () { return want; });
} else {
  console.error('❌ 既没有 INLINE-CSS 标记块，也找不到 <link rel="stylesheet" href="style.css">，无法定位插入点');
  process.exit(1);
}

if (out === html) {
  console.log('✅ 已经是最新，无需改动');
} else {
  fs.writeFileSync(HTML_FILE, out);
  console.log('✅ 已把 style.css 内联进 index.html（' + css.length + ' 字符）');
}
