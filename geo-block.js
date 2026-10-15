// Geo-block: block access from South Korea only
//
// 2026-10-15 改造（跨境首屏优化）：
//   1. 本脚本原先同步写在 <head> 最前面（还排在 <meta charset> 之前），
//      会阻塞 HTML 解析 —— 浏览器必须先把它下载执行完，才会去发现
//      <link rel="stylesheet" href="style.css">。本站源站在境外（EdgeOne
//      新加坡节点），这一步等于白送一个跨境 RTT，对福建这类国际出口拥塞
//      的地区影响最大。现在改由页面用 defer 引入，解析不再被阻塞，
//      style.css 与它并行下载。
//   2. 去掉 document.write（改用 documentElement.innerHTML 整体替换）。
//   3. sessionStorage 里的拦截标记加 30 分钟 TTL —— 原实现是永久的，
//      一旦某次被误判成韩国，该标签页之后【每一个页面】都会变成
//      「访问受限」，用户看到的现象就是「网站打不开」。
//   4. ipapi.co 超时 3000ms → 1500ms（国内访问它经常直接挂到超时）。
//
// 注：ipapi.co 这个第三方依赖本身没有去掉 —— 它是当前唯一的判断来源。
//     要彻底去掉，需要先把韩国拦截搬到 EdgeOne 的规则引擎（在边缘按
//     客户端国家返回 403），那份配置由站点管理员在腾讯云控制台添加，
//     加完之后本文件连同 10 个页面的 <script> 引用即可一并删除。
(function () {
  var TTL_MS = 30 * 60 * 1000; // 拦截/已检查 标记最多记 30 分钟
  var TIMEOUT_MS = 1500;       // 国内访问 ipapi.co 常超时，别等太久

  var BLOCK_CSS = 'body{margin:0;background:#1a1a2e;display:flex;'
    + 'align-items:center;justify-content:center;height:100vh;'
    + 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}'
    + 'div{text-align:center}h1{color:#e94560;font-size:2rem;margin-bottom:1rem}'
    + 'p{color:#aaa;margin:0.5rem 0}'
    + '.sub{color:#666;font-size:0.85rem;margin-top:1rem}';

  var done = false;

  // 标记带时间戳。兼容历史遗留的裸 '1'（无时间戳时按「刚写入」处理，
  // 于是最多再保留 30 分钟就自动失效）。
  function flagAlive(key) {
    var raw;
    try { raw = sessionStorage.getItem(key); } catch (e) { return false; }
    if (!raw) return false;
    var at = parseInt(raw, 10);
    if (!at || isNaN(at)) at = Date.now();
    if (Date.now() - at > TTL_MS) {
      try { sessionStorage.removeItem(key); } catch (e) {}
      return false;
    }
    return true;
  }

  function flagSet(key) {
    try { sessionStorage.setItem(key, String(Date.now())); } catch (e) {}
  }

  function showBlocked() {
    done = true;
    var html = '<head><meta charset="UTF-8">'
      + '<meta name="viewport" content="width=device-width,initial-scale=1.0">'
      + '<title>访问受限</title><style>' + BLOCK_CSS + '</style></head>'
      + '<body><div><h1>访问受限</h1>'
      + '<p>本站不向韩国地区提供服务</p>'
      + '<p class="sub">Access is not available in South Korea</p>'
      + '</div></body>';
    try {
      // 整体替换 <html> 内容。比 document.write 安全：不需要
      // document.open/close，也不会把后续解析流截断。
      document.documentElement.innerHTML = html;
    } catch (e) {
      // 兜底：只换 body 文字，保证不会白屏
      try {
        document.body.innerHTML = '<div style="text-align:center;padding:4rem 1rem;color:#e94560">'
          + '<h1>访问受限</h1><p style="color:#aaa">本站不向韩国地区提供服务</p></div>';
      } catch (e2) {}
    }
  }

  // 本页已被判定为韩国：直接换掉内容
  if (flagAlive('geo_blocked')) {
    showBlocked();
    return;
  }

  // 本次会话已经确认过不是韩国，不再重复请求
  if (flagAlive('geo_checked')) return;

  // iframe 内不重复检查（父页面已经查过）
  if (window !== window.top) return;

  function check(resp) {
    if (done) return;
    try {
      var data = JSON.parse(resp);
      if (data && data.country_code === 'KR') {
        flagSet('geo_blocked');
        showBlocked();
      } else {
        flagSet('geo_checked');
      }
    } catch (e) {}
  }

  // 异步请求，不参与首屏渲染关键路径（本脚本已由页面 defer 引入）
  var xhr = new XMLHttpRequest();
  xhr.timeout = TIMEOUT_MS;
  xhr.onreadystatechange = function () {
    if (xhr.readyState === 4 && xhr.status === 200) check(xhr.responseText);
  };
  xhr.ontimeout = function () {};
  xhr.onerror = function () {};
  try {
    xhr.open('GET', 'https://ipapi.co/json/', true);
    xhr.send();
  } catch (e) {}
})();
