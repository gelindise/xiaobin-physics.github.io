(function() {
  var VIP_EXPERIMENTS = [
    "声音麦克风波形.html","javalab_测速雷达原理.html","小孔成像2.html",
    "phydemo_光路模拟器.html","光的折射规律.html","LCD像素显色.html",
    "牛顿第一定律_交互实验.html","飞象_飞机投弹惯性教学动画.html",
    "飞象_牛顿第一定律教学动画.html","飞象_液体压强实验教学动画.html",
    "飞象_船闸连通器原理分步动画演示.html","飞象_生成马德堡半球实验教学动画.html",
    "飞象_飞机升力.html","飞象_生成浮力产生原因教学动画.html",
    "密度计.html",
    "javalab_浮力比较.html",
    "javalab_浮力实验.html","javalab_阿基米德王冠.html",
    "飞象_动滑轮定滑轮原理教学动画.html","javalab_电流表.html",
    "电阻的微观解释.html","javalab_磁场与磁感线.html",
    "javalab_太阳风与极光.html","javalab_洛伦兹力.html","汽油机四冲程.html","javalab_日食和月食.html"
  ];

  var page = window.location.pathname.substring(window.location.pathname.lastIndexOf('/') + 1) || 'experiments.html';
  var isFreeTrial = window.location.search.indexOf('trial=1') !== -1;

  // 非 VIP 实验无需登录，直接放行
  if (isFreeTrial || VIP_EXPERIMENTS.indexOf(page) === -1) return;

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
