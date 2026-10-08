(function() {
  // 免费体验白名单：只有列在这里的实验页免登录；除此之外【所有】实验页默认按 VIP 处理。
  // 这是「白名单」模型，与旧的 VIP 黑名单相反 ——
  //   黑名单：列进去的才拦。漏登记 = 直接输网址就能免费看（历史上出过很多次，且症状是
  //          【页面和正常一模一样】，没有任何迹象，极难发现）。
  //   白名单：列进去的才放。漏登记 = 该免费的页面却要登录（症状明显、且不会白送内容）。
  // 维护约定：experiments.html / free-trial.html 里凡是 openLab（免费）的页面，这里必须有；
  //          反过来，凡是这里有的，列表里也应该是 openLab。
  var FREE_EXPERIMENTS = [
    "回声测距立体模型.html",     // 声学
    "弦上的驻波立体模型.html",   // 声学（3D 吉他实验台）
    "平面镜成像立体模型.html",   // 光学
    "托里拆利实验立体模型.html", // 力学
    "汽油机四冲程立体模型.html", // 热学
    "电路实验沙盒.html",         // 电学
  ];

  // 站点自带页面（非实验内容）：必须免登录直接放行，
  // 否则一进实验列表 / 404 页就会被弹到登录页。这三个文件都引了本脚本。
  var SITE_PAGES = ["experiments.html", "404.html", "experiment_template.html"];

  // ⚠️ 必须 decodeURIComponent。浏览器的 location.pathname 对中文文件名给的是【百分号编码】
  //    （/平面镜成像立体模型.html → /%E5%B9%B3%E9%9D%A2...html），直接切出来跟名单里的
  //    明文永远对不上，indexOf 恒为 -1。白名单模型下这个 bug 方向相反：会把该免费的页面
  //    判成 VIP、直接跳登录页。顺带这也保证了 redirect 参数不是双重编码。
  var raw = window.location.pathname.substring(window.location.pathname.lastIndexOf('/') + 1);
  var page;
  try { page = decodeURIComponent(raw) || 'experiments.html'; }
  catch (_) { page = raw || 'experiments.html'; }

  // 🔴 安全整改：trial=1 只在本机生效（localhost / 127.0.0.1 / file://）。
  //    它本来是本地验收用的开关，但写在【公开源码】里 ⇒ 公网上任意 VIP 页
  //    只要在地址后面加 ?trial=1 就能绕过登录直接进。
  var isLocalHost = window.location.protocol === 'file:' ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === '::1' ||
    window.location.hostname === '';
  var isFreeTrial = isLocalHost && window.location.search.indexOf('trial=1') !== -1;

  // 站点页 / 免费白名单 / 本机试用 —— 一律放行，无需登录
  if (isFreeTrial || SITE_PAGES.indexOf(page) !== -1 || FREE_EXPERIMENTS.indexOf(page) !== -1) return;

  // === 以下仅对 VIP 实验生效 ===

  var user = localStorage.getItem("currentUser");
  var token = localStorage.getItem("sessionToken");

  if (!user || !token) {
    window.location.href = "login.html?redirect=" + encodeURIComponent(page);
    return;
  }

  // VIP 信息获取（session 校验由 script.js 中的定时器统一处理）
  // 先获取用户的 VIP 状态

  // VIP 状态校验
  var users = JSON.parse(localStorage.getItem("users") || "{}");
  var userData = users[user];

  if (userData) {
    checkVipAccess(userData.vip, userData.expire);
  } else {
    fetch('/api/proxy-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getUserPublic', username: user })
    })
    .then(function(r) { return r.json(); })
    .then(function(result) {
      if (result.success && result.user) {
        checkVipAccess(result.user.vip, result.user.expire);
      }
    })
    .catch(function() {});
  }

  function checkVipAccess(vip, expire) {
    var isVip = vip && vip !== "普通用户";
    var isExpired = isVip && expire !== "永久" && new Date() > new Date(expire);
    if (!isVip || isExpired) {
      window.location.href = "vip.html";
    }
  }
})();
