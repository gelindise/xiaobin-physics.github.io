(function() {
  var VIP_EXPERIMENTS = [
    "声音麦克风波形.html","javalab_测速雷达原理.html","小孔成像2.html",
    "光的反射立体模型.html",
    "光的折射立体模型.html",
    "平面镜成像立体模型.html",
    "小孔成像立体模型.html",
    "测量平均速度立体模型.html",
    "刻度尺的使用立体模型.html",
    "真空铃实验立体模型.html",
    "回声测距立体模型.html",
    "托里拆利实验立体模型.html",
    "马德堡半球实验立体模型.html",
    "phydemo_光路模拟器.html","光的折射规律.html","光的折射—杯底光点.html","LCD像素显色.html",
    "牛顿第一定律_交互实验.html","飞象_飞机投弹惯性教学动画.html",
    "飞象_牛顿第一定律教学动画.html","飞象_液体压强实验教学动画.html",
    "液体对容器底部的压力与重力.html",
    "飞象_船闸连通器原理分步动画演示.html","飞象_生成马德堡半球实验教学动画.html",
    "飞象_飞机升力.html","飞象_生成浮力产生原因教学动画.html",
    "密度计.html",
    "javalab_浮力比较.html",
    "称重法测浮力.html",
    "javalab_浮力实验.html","javalab_阿基米德王冠.html",
    "飞象_动滑轮定滑轮原理教学动画.html","javalab_电流表.html",
    "电阻的微观解释.html","javalab_磁场与磁感线.html",
    "javalab_太阳风与极光.html","javalab_洛伦兹力.html","汽油机四冲程.html","javalab_日食和月食.html",
    "比热容立体模型.html",
    "改变内能的方式立体模型.html",
    "能量的转化和守恒立体模型.html",
    "测量小灯泡的电功率.html",
    "st图像_匀速直线运动.html",
    "噪声的危害和控制立体模型.html",
    "探究水沸腾时温度变化的特点.html",
    "凸面镜与凹面镜立体模型.html"
  ];

  // ⚠️ 必须 decodeURIComponent。浏览器的 location.pathname 对中文文件名给的是【百分号编码】
  //    （/测量小灯泡的电功率.html → /%E6%B5%8B%E9%87%8F...html），直接切出来跟下面名单里的
  //    明文永远对不上，indexOf 恒为 -1 → 整条闸门静默放行。清单一多、全是中文名，这个 bug
  //    就很难被发现：卡片看着是 VIP、点进去也拦，只有【直接输网址】才漏，而漏的时候页面
  //    和正常一模一样，没有任何迹象。顺带这也修好了 redirect 参数（原来等于双重编码）。
  var raw = window.location.pathname.substring(window.location.pathname.lastIndexOf('/') + 1);
  var page;
  try { page = decodeURIComponent(raw) || 'experiments.html'; }
  catch (_) { page = raw || 'experiments.html'; }
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
