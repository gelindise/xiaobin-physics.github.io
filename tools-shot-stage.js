// 出图：任意实验页的「参数面板收起 / 展开」两张图（看改造后的样子）
// 跑法：NODE_PATH=<repo> node tools-shot-stage.js "页面.html" 短名 [宽]
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const OUT = path.join(__dirname, 'outputs');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const page = process.argv[2], tag = process.argv[3] || 'shot', W = +(process.argv[4] || 1500);
(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-gpu',
    '--disable-dev-shm-usage', '--disable-frame-rate-limit'] });
  const p = await b.newPage();
  await p.setViewport({ width: W, height: 980, deviceScaleFactor: 1 });
  await p.goto('file://' + path.join(__dirname, page) + '?trial=1', { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 900));
  const el = await p.$('.lab3d');
  await el.screenshot({ path: path.join(OUT, 'tmp-' + tag + '-closed.png') });
  const ok = await p.evaluate(() => {
    const t = document.querySelector('.stage-params .params-toggle');
    if (!t) return false;
    t.click(); return true;
  });
  await new Promise(r => setTimeout(r, 350));
  if (ok) await el.screenshot({ path: path.join(OUT, 'tmp-' + tag + '-open.png') });
  console.log('出图 ' + tag + (ok ? '（收起 + 展开）' : '（没有面板）'));
  await b.close();
})();
