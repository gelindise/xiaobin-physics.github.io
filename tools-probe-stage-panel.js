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
      '--disable-dev-shm-usage', '--disable-frame-rate-limit',
      // 3D 页（魔罐 / 电子流动）要软件 WebGL，否则画布是空的（亮度腿会误判成「渲染挂了」）
      '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
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
        // 舞台有两种骨架：.lab3d-stage（lab3d 页）/ .stage > .cv（老布局页）
        // 舞台 = 真正进全屏的那个元素：.lab3d-stage / #stage / 画布的最近祖先
        let stage = document.querySelector('.lab3d-stage') || document.getElementById('stage');
        if (!stage) {
          const anyCv = document.querySelector('canvas');
          stage = anyCv && anyCv.closest('.stage, .cv, .stage-wrap');
        }
        const root = document.querySelector('.lab3d') || (stage && stage.closest('.stage')) || stage || document.body;
        const cv = stage && stage.querySelector('canvas');
        const out = { hasStage: !!stage, hasCanvas: !!cv };
        if (!stage || !cv) return out;
        const bright = () => {
          // WebGL 画布拿不到 2d 上下文（也读不出像素）⇒ 返回 -1，跳过亮度腿
          let c = null;
          try { c = cv.getContext('2d'); } catch (e) { c = null; }
          if (!c) return -1;
          const d = c.getImageData(0, 0, cv.width, cv.height).data;
          let n = 0;
          for (let k = 0; k < d.length; k += 4 * 61) if (d[k] + d[k + 1] + d[k + 2] > 90) n++;
          return n;
        };
        const panel = stage.querySelector('.stage-params');
        out.hasPanel = !!panel;
        // WebGL 画布读不出像素（没有 preserveDrawingBuffer）⇒ 亮度腿对这类页不成立，跳过
        let isGL = false;
        try { isGL = !!(cv.getContext('webgl2') || cv.getContext('webgl')); } catch (e) { isGL = false; }
        out.isGL = isGL;
        out.brightBefore = isGL ? -1 : bright();
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
          // 「滚到底能不能看到底」= 面板 body 的最后一个子元素在可视区内
          // （不能拿「最后一个控件」判：有的页控件下面还有数据表/按钮，那才是真正的末尾）
          const lastEl = body.lastElementChild;
          if (lastEl) {
            const lr = lastEl.getBoundingClientRect(), br = body.getBoundingClientRect();
            out.lastVisible = lr.top >= br.top - 4 && lr.bottom <= br.bottom + 4;
          }
          out.brightOpen = out.isGL ? -1 : bright();
          body.scrollTop = 0;
          toggle.click(); await wait(220);
          out.brightClosed = out.isGL ? -1 : bright();
        }
        const fsb = stage.querySelector('.stage-fs-btn, .stage-fs, .fsBtn, .fs-btn');
        out.hasFs = !!fsb;
        if (fsb) {
          // 按钮可能在折叠线以下（老布局页舞台很高）⇒ 先滚进视口，否则 mouse.click 点空
          fsb.scrollIntoView({ block: 'center' });
          await wait(160);
          const r0 = fsb.getBoundingClientRect();
          const c0 = cv.getBoundingClientRect();
          out.fsBtn = { x: Math.round(r0.left + r0.width / 2), y: Math.round(r0.top + r0.height / 2) };
          out.before = [Math.round(c0.width), Math.round(c0.height)];
        }
        return out;
      });

      if (!r.hasStage || !r.hasCanvas) F.push('没有 .lab3d-stage / canvas');
      if (!r.hasPanel) F.push('没有 .stage-params');
      if (!r.hasFs) F.push('没有全屏按钮');
      if (r.controls && r.controls.total !== r.controls.inBody)
        F.push('有 ' + (r.controls.total - r.controls.inBody) + ' 个控件不在面板里: ' + r.controls.outside.join(','));
      if (r.closed) {
        if (!r.closed.collapsed || r.closed.display !== 'none') F.push('默认没收起');
        if (r.closed.areaPct > 2.5) F.push('收起态占舞台 ' + r.closed.areaPct + '% (>2.5%)');
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
      if (r.brightBefore === 0) F.push('画布一个亮点都没有（渲染挂了？）');
      if (r.brightClosed === 0) F.push('收起面板后画布空了');

      if (r.fsBtn) {
        await p.mouse.click(r.fsBtn.x, r.fsBtn.y);
        await sleep(700);
        const on = await p.evaluate(() => {
          const stage = document.querySelector('.lab3d-stage') || document.getElementById('stage') ||
            (() => { const c = document.querySelector('canvas'); return c && c.closest('.stage, .cv, .stage-wrap'); })();
          const cv = stage.querySelector('canvas');
          const st = stage.getBoundingClientRect(), c = cv.getBoundingClientRect();
          const panel = stage.querySelector('.stage-params');
          const b = stage.querySelector('.stage-fs-btn, .stage-fs, .fsBtn, .fs-btn');
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
        // 2D 页按宽高比缩放（全屏里是居中留边），所以只要求「画布确实变大了」或「铺满」
        const grew = on.canvas[0] >= r.before[0] + 20;
        const fills = Math.abs(on.canvas[0] - on.stage[0]) <= 3;
        if (!grew && !fills) F.push('画布没跟着变大（' + on.canvas[0] + ' vs 全屏前 ' + r.before[0] + '）');
        if (!on.panelInFs) F.push('全屏里没有参数面板');
        await p.mouse.click(on.btn.x, on.btn.y);
        await sleep(800);
        const off = await p.evaluate(() => {
          const stage = document.querySelector('.lab3d-stage') || document.getElementById('stage') ||
            (() => { const c = document.querySelector('canvas'); return c && c.closest('.stage, .cv, .stage-wrap'); })();
          const cv = stage.querySelector('canvas').getBoundingClientRect();
          return { isEl: !!document.fullscreenElement, w: Math.round(cv.width) };
        });
        if (off.isEl) F.push('退不出全屏');
        if (off.w > r.before[0] * 1.2 + 20 || off.w >= on.canvas[0])
          F.push('退出后画布没缩回去（' + off.w + ' vs 全屏前 ' + r.before[0] + '）');
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
