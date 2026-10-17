// 通用验收探针：任意实验页的「参数面板 + 实验画面全屏」
// 跑法：NODE_PATH=<repo> node tools-probe-stage-panel.js "页面.html" [更多页面…]
// 判据全部落在【真实 DOM 几何 + 真实鼠标点击】上（getBoundingClientRect / fullscreenElement），
// 不看 CSS 里写了什么，也不依赖页面自己的调试钩子。
//   🔴 全屏必须用 page.mouse.click 点（真实手势）：evaluate 里的 el.click() 不算用户手势，
//      Chrome 会以 "Permissions check failed" 拒绝 requestFullscreen。
//   🔴 控件只数【实验卡 .lab3d 里、当前可见】的那些：有的页正文下面还留着旧版实验的控件，
//      有的页在舞台里有一条窄屏速调条（.stage-quick，是面板参数的镜像，允许存在）。
const puppeteer = require('puppeteer');
const path = require('path');

const pages = process.argv.slice(2);
if (!pages.length) { console.log('用法: node tools-probe-stage-panel.js "页面.html" …'); process.exit(2); }

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let bad = 0;
  for (const pg of pages) {
    const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-gpu',
      '--disable-dev-shm-usage', '--disable-frame-rate-limit'] });
    const p = await b.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    const F = [];
    let info = '';
    try {
      await p.setViewport({ width: 1500, height: 900, deviceScaleFactor: 1 });
      await p.goto('file://' + path.join(__dirname, pg) + '?trial=1', { waitUntil: 'load', timeout: 30000 });
      await sleep(800);

      const r = await p.evaluate(async () => {
        const wait = ms => new Promise(x => setTimeout(x, ms));
        const root = document.querySelector('.lab3d') || document.body;
        const stage = document.querySelector('.lab3d-stage');
        const cv = stage && stage.querySelector('canvas');
        const out = { hasStage: !!stage, hasCanvas: !!cv };
        if (!stage || !cv) return out;
        const bright = () => {
          const c = cv.getContext('2d');
          if (!c) return -1;
          const d = c.getImageData(0, 0, cv.width, cv.height).data;
          let n = 0;
          for (let k = 0; k < d.length; k += 4 * 61) if (d[k] + d[k + 1] + d[k + 2] > 150) n++;
          return n;
        };
        const panel = stage.querySelector('.stage-params');
        out.hasPanel = !!panel;
        out.brightBefore = bright();
        // 面板收起时它里面的控件 offsetParent 为 null —— 不能因此当成「不在面板里」
        const pBody0 = panel && panel.querySelector('.params-body');
        const vis = e => (pBody0 && pBody0.contains(e)) ||
                         e.offsetParent !== null || e.getClientRects().length > 0;
        const all = [...root.querySelectorAll('input[type="range"], input[type="checkbox"]')].filter(vis);
        const quick = all.filter(e => e.closest('.stage-quick'));
        const main = all.filter(e => !e.closest('.stage-quick'));
        out.quick = quick.length;
        if (panel) {
          const body = panel.querySelector('.params-body');
          const toggle = panel.querySelector('.params-toggle');
          const st = stage.getBoundingClientRect(), pr = panel.getBoundingClientRect();
          out.closed = { collapsed: panel.classList.contains('collapsed'),
                         display: getComputedStyle(body).display,
                         areaPct: +(pr.width * pr.height / (st.width * st.height) * 100).toFixed(2),
                         inside: pr.left >= st.left - 1 && pr.right <= st.right + 1 &&
                                 pr.top >= st.top - 1 && pr.bottom <= st.bottom + 1,
                         inStage: stage.contains(panel) };
          out.controls = { total: main.length, inBody: main.filter(e => body.contains(e)).length,
                           outside: main.filter(e => !body.contains(e))
                                          .map(e => e.id || e.name || '?').slice(0, 6) };
          toggle.click();
          await wait(260);
          const pr2 = panel.getBoundingClientRect(), st2 = stage.getBoundingClientRect();
          out.open = { collapsed: panel.classList.contains('collapsed'),
                       display: getComputedStyle(body).display,
                       aria: toggle.getAttribute('aria-expanded'), text: toggle.textContent.trim(),
                       areaPct: +(pr2.width * pr2.height / (st2.width * st2.height) * 100).toFixed(2),
                       inside: pr2.left >= st2.left - 1 && pr2.right <= st2.right + 1 &&
                               pr2.top >= st2.top - 1 && pr2.bottom <= st2.bottom + 1,
                       scrollH: body.scrollHeight, clientH: body.clientHeight,
                       overflowY: getComputedStyle(body).overflowY };
          body.scrollTop = body.scrollHeight;
          await wait(150);
          const last = main[main.length - 1];
          if (last) {
            const lr = last.getBoundingClientRect(), br = body.getBoundingClientRect();
            out.lastVisible = lr.top >= br.top - 2 && lr.bottom <= br.bottom + 2;
          }
          out.brightOpen = bright();
          body.scrollTop = 0;
          toggle.click(); await wait(220);
          out.brightClosed = bright();
        }
        const fsb = stage.querySelector('.stage-fs-btn');
        out.hasFs = !!fsb;
        if (fsb) {
          const r0 = fsb.getBoundingClientRect();
          const c0 = cv.getBoundingClientRect();
          out.fsBtn = { x: Math.round(r0.left + r0.width / 2), y: Math.round(r0.top + r0.height / 2) };
          out.before = [Math.round(c0.width), Math.round(c0.height)];
        }
        return out;
      });

      if (!r.hasStage || !r.hasCanvas) F.push('没有 .lab3d-stage / canvas');
      if (!r.hasPanel) F.push('没有 .stage-params');
      if (!r.hasFs) F.push('没有 .stage-fs-btn');
      if (r.controls && r.controls.total !== r.controls.inBody)
        F.push('有 ' + (r.controls.total - r.controls.inBody) + ' 个控件不在面板里: ' + r.controls.outside.join(','));
      if (r.closed) {
        if (!r.closed.collapsed || r.closed.display !== 'none') F.push('默认没收起');
        if (r.closed.areaPct > 2) F.push('收起态占舞台 ' + r.closed.areaPct + '% (>2%)');
        if (!r.closed.inside) F.push('收起态越出舞台');
      }
      if (r.open) {
        if (r.open.collapsed || r.open.display === 'none') F.push('点不开');
        if (r.open.aria !== 'true' || !/收起/.test(r.open.text)) F.push('展开态 aria/文案不同步');
        if (!r.open.inside) F.push('展开态越出舞台');
        if (!/auto|scroll/.test(r.open.overflowY)) F.push('面板没有可滚动容器（overflow-y=' + r.open.overflowY + '）');
        if (r.open.scrollH > r.open.clientH + 5 && r.lastVisible === false)
          F.push('内容超出但滚到底最后一个控件不在可视区');
      }
      if (r.brightBefore >= 0 && r.brightBefore < 20) F.push('画布几乎是空的(' + r.brightBefore + ')');
      if (r.brightClosed !== undefined && r.brightClosed < 20) F.push('收起面板后画布空了(' + r.brightClosed + ')');

      if (r.fsBtn) {
        await p.mouse.click(r.fsBtn.x, r.fsBtn.y);
        await sleep(700);
        const on = await p.evaluate(() => {
          const stage = document.querySelector('.lab3d-stage');
          const cv = stage.querySelector('canvas');
          const st = stage.getBoundingClientRect(), c = cv.getBoundingClientRect();
          const panel = stage.querySelector('.stage-params');
          const b = stage.querySelector('.stage-fs-btn');
          const q = b.getBoundingClientRect();
          return { isEl: document.fullscreenElement === stage,
                   stage: [Math.round(st.width), Math.round(st.height)],
                   canvas: [Math.round(c.width), Math.round(c.height)],
                   vw: innerWidth, vh: innerHeight,
                   panelInFs: !!(document.fullscreenElement && panel && document.fullscreenElement.contains(panel)),
                   btn: { x: Math.round(q.left + q.width / 2), y: Math.round(q.top + q.height / 2),
                          label: (b.querySelector('.lbl') || {}).textContent || '' } };
        });
        if (!on.isEl) F.push('全屏没进去');
        if (Math.abs(on.stage[0] - on.vw) > 2 || Math.abs(on.stage[1] - on.vh) > 2)
          F.push('舞台没铺满视口 ' + on.stage.join('×'));
        if (Math.abs(on.canvas[0] - on.stage[0]) > 3) F.push('画布没跟着变宽');
        if (!on.panelInFs) F.push('全屏里没有参数面板');
        await p.mouse.click(on.btn.x, on.btn.y);
        await sleep(800);
        const off = await p.evaluate(() => {
          const cv = document.querySelector('.lab3d-stage canvas').getBoundingClientRect();
          return { isEl: !!document.fullscreenElement, w: Math.round(cv.width) };
        });
        if (off.isEl) F.push('退不出全屏');
        if (Math.abs(off.w - r.before[0]) > 3) F.push('退出后画布没还原（' + off.w + ' vs ' + r.before[0] + '）');
        info = '面板收起 ' + r.closed.areaPct + '% → 展开 ' + r.open.areaPct + '%（' +
               r.open.scrollH + '/' + r.open.clientH + '）· 全屏 ' + on.stage.join('×') +
               ' · 控件 ' + r.controls.inBody + '/' + r.controls.total +
               (r.quick ? '（+速调镜像 ' + r.quick + '）' : '');
      }
      if (errs.length) F.push('页面报错: ' + errs.slice(0, 2).join(' | '));
    } catch (e) {
      F.push('探针异常: ' + String(e).slice(0, 140));
    }
    if (F.length) { bad++; console.log('❌ ' + pg + '\n     ' + F.join('\n     ')); }
    else console.log('✅ ' + pg + '  ' + info);
    try { await p.evaluate(() => { if (document.fullscreenElement) document.exitFullscreen(); }); } catch (e) { }
    try { await p.close(); } catch (e) { }
    try { await b.close(); } catch (e) { }
  }
  console.log(bad ? '\n❌ ' + bad + ' 个页面没过' : '\n✅ 全部通过');
  process.exit(bad ? 1 : 0);
})();
