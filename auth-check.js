(function() {
  var VIP_EXPERIMENTS = [
    "声音麦克风波形.html","javalab_测速雷达原理.html","小孔成像2.html",
    "光的反射立体模型.html",
    "光的折射立体模型.html",
    "平面镜成像立体模型.html",
    // 角反射器：三块互相垂直的镜面，出射光严格反向（第四章第2节 光的反射）
    "角反射器立体模型.html",
    // 第五章第1节「透镜」的新创 3D 页：真 Snell 光线追迹 + 球面回转体镜片 + 像方主平面 + 球差。
    // experiments.html 里是 card lock + 「VIP专享」，按维护约定必须登记。
    "透镜对光的作用立体模型.html",
    // ⚠️ 补登记（历史遗漏）：自行车尾灯原理.html 在 experiments.html 里是 card lock
    //    （第2节、第3节各挂了一张），但这份名单一直漏了它 —— 直接输网址就能免费看。
    //    按本文件末尾的维护约定「凡是 card lock 的页面，这里必须有」补上。
    "自行车尾灯原理.html",
    "小孔成像立体模型.html",
    "测量平均速度立体模型.html",
    "刻度尺的使用立体模型.html",
    "真空铃实验立体模型.html",
    "回声测距立体模型.html",
    "声波的形成立体模型.html",
    "声音的特性立体模型.html",
    "托里拆利实验立体模型.html",
    "马德堡半球实验立体模型.html",
    "探究液体压强的特点立体模型.html",
    "连通器与船闸立体模型.html",
    // 第九章第4节「流体压强与流速的关系」的旗舰 3D 页：NACA 2412 翼型 + 流线粒子 + 压强色带
    // + 升力箭头。experiments.html 里是 card lock + 「VIP专享」，按维护约定必须登记。
    "机翼升力与流线立体模型.html",
    "phydemo_光路模拟器.html","光的折射规律.html","光的折射—杯底光点.html","LCD像素显色.html",
    "牛顿第一定律_交互实验.html","飞象_飞机投弹惯性教学动画.html",
    "飞象_牛顿第一定律教学动画.html","飞象_液体压强实验教学动画.html",
    "液体对容器底部的压力与重力.html",
    "飞象_船闸连通器原理分步动画演示.html","飞象_生成马德堡半球实验教学动画.html",
    "飞象_飞机升力.html","飞象_生成浮力产生原因教学动画.html",
    "密度计.html",
    "javalab_浮力比较.html",
    "浮力产生的原因立体模型.html",
    "物体的浮沉条件立体模型.html",
    // 第十章第2节的旗舰 3D 页：溢水杯 + 弹簧测力计 + 电子秤，F浮 与 G排 走三条独立路径。
    "验证阿基米德原理立体模型.html",
    "称重法测浮力.html",
    // ⚠️ 下面三项曾经漏登记：experiments.html 里卡片标着「VIP专享」，但这份名单里没有。
    //    checkVip() 只判 VIP 状态、根本不查名单，真正的拦截全靠本文件，
    //    漏登记 = 直接输网址就能免费看。
    //    维护约定：experiments.html 里凡是 VIP 卡对应的页面，这里必须有。
    "排开液体体积.html",
    "潜水艇沉浮原理.html",
    // 第十章第3节应用层的新创 3D 页：钢为什么能造船（空心法）、吃水线与载重线。
    "轮船与吃水线立体模型.html",

    // 第十章第3节应用层的第三张新创 3D 页：把阿基米德原理从液体推广到气体 ——
    // 氢气球 / 热气球 / 飞艇的升空条件 + 空气密度随高度衰减 ⇒ 升限。
    // experiments.html 里是 card lock + 「VIP专享」，按维护约定必须登记。
    // 漏登记 = checkVip() 只判 VIP 状态、不查名单 ⇒ 直接输网址就能免费看。
    "气球与飞艇立体模型.html",
    "phet_浮力.html",
    "javalab_浮力实验.html","javalab_阿基米德王冠.html",
    "飞象_动滑轮定滑轮原理教学动画.html","javalab_电流表.html",
    "电阻的微观解释.html","javalab_磁场与磁感线.html",
    "javalab_太阳风与极光.html","javalab_洛伦兹力.html","汽油机四冲程.html","javalab_日食和月食.html",
    "分子热运动立体模型.html",

    "比热容立体模型.html",
    "改变内能的方式立体模型.html",
    "能量的转化和守恒立体模型.html",
    "热机的效率立体模型.html",
    // 第十四章第1节「热机」的旗舰 3D 页：experiments.html 里是 card lock + 「VIP专享」，
    // 按本文件末尾的维护约定（凡是 card lock 的页面，这里必须有）登记。漏登记 = 直接输网址免费看。
    "汽油机四冲程立体模型.html",
    "测量小灯泡的电功率.html",
    "st图像_匀速直线运动.html",
    "噪声的危害和控制立体模型.html",
    "探究水沸腾时温度变化的特点.html",
    // 第三章第4节「升华和凝华」的旗舰 3D 页：experiments.html 里是 card lock + 「VIP专享」，
    // 按本文件末尾的维护约定（凡是 card lock 的页面，这里必须有）登记。漏登记 = 直接输网址免费看。
    "升华和凝华立体模型.html",
    // 第三章第3节「汽化和液化」的第二张旗舰 3D 页：五滴水 + 可加热金属板 + 调速台扇
    // + 干湿球温度计。experiments.html 里是 card lock + 「VIP专享」，按维护约定登记。
    // 漏登记 = checkVip() 只判 VIP 状态、不查名单 ⇒ 直接输网址就能免费看。
    "蒸发快慢与蒸发致冷立体模型.html",
    // 第三章第3节「汽化和液化」的第三张旗舰 3D 页：同一支注射器 / 烧杯，降温结露（玻璃片）
    // 与压缩体积液化（活塞筒）两条路对照。experiments.html 里是 card lock + 「VIP专享」。
    // 漏登记 = checkVip() 只判 VIP 状态、不查名单 ⇒ 直接输网址就能免费看。
    "液化的两种方法立体模型.html",
    "托盘天平立体模型.html",
    "测量物质的密度立体模型.html",
    // 第六章第1节「质量」的旗舰 3D 页：同一台托盘天平称四种情形（形状 / 状态 / 位置 / 温度），
    // 在 experiments.html 里是 card lock + 「VIP专享」，按本文件末尾的维护约定必须登记。
    "质量是物体的属性立体模型.html",
    // ⚠️ 补登记（历史遗漏）：水的反常膨胀.html 在第4节里一直是 card lock + 「VIP专享」，
    //    但这份名单从来没有它 —— checkVip() 只判 VIP 状态、不查名单，真正的拦截全靠本文件，
    //    所以漏登记 = 直接输网址就能免费看。按本文件末尾的维护约定补上。
    "水的反常膨胀.html",
    // 第四章第4节的旗舰 3D 页（与 2D 页并存：2D 页带两个 B 站实拍视频，保留）。
    "水的反常膨胀立体模型.html",
    // 第六章第4节「密度与社会生活」的新创 3D 页：空气密度随温度变 → 密度差 → 风。
    "风的形成立体模型.html",
    // 第六章第4节「密度与社会生活」的另一张新创 3D 页：称质量 + 排水法测体积 → 算密度 → 查表鉴别物质。
    // experiments.html 里是 card lock + 「VIP专享」；漏登记 = checkVip() 只判 VIP 状态、不查名单
    // ⇒ 直接输网址就能免费看。按本文件末尾的维护约定登记。
    "密度与物质鉴别立体模型.html",
    "凸面镜与凹面镜立体模型.html",
    "潜望镜立体模型.html",
    "永动机立体模型.html",
    "滚球永动机立体模型.html",
    "温度计的使用立体模型.html",
    "串并联电路中电流的规律立体模型.html",
    "电路的连接与电流表的使用立体模型.html",
    "超声波测速立体模型.html",
    "两种电荷与验电器立体模型.html",

    // ═══ 批量补登记（2026-10-06）═══
    // 下面这些页面在 experiments.html 里都是 class="card lock" + 「VIP专享」，
    // 但一直没进这份名单 —— 直接输网址就能免费看（抽验 6 个，6 个全都没拦）。
    // 其中 14 个连 auth-check.js 都没引（只引了 protect.js，而 protect.js 只挡图片右键，
    // 根本不是闸门），已同时在各自的 </head> 前补上 <script src="auth-check.js">。
    "声音的波形.html",
    "杠杆最小力方向.html",
    "飞象_杠杆动态平衡虚拟实验.html",
    "机械停表.html",
    "错觉实验.html",
    "javalab_地球同步卫星.html",
    "javalab_自由落体.html",
    "javalab_运动图像.html",
    "javalab_频闪摄影.html",
    "phet_绳波.html",
    "phet_声波.html",
    "音叉与声波.html",
    "弹簧疏密波.html",
    "瓶子的音调.html",
    "phet_傅里叶声波.html",
    "javalab_和弦.html",
    "javalab_弦上的驻波.html",
    "javalab_影子的形成.html",
    "光学实验沙盒.html",
    "javalab_液面升降监测.html",
    "phet_几何光学.html",
    "phet_光的折射.html",
    "javalab_光的折射_看鱼.html",
    "javalab_棱镜色散.html",
    "phet_颜色视觉.html",
    "javalab_相机光学.html",
    "javalab_近视远视矫正.html",
    "托盘天平的使用.html",
    "phet_弹簧弹力.html",
    "phet_胡克定律.html",
    "phet_重力轨道.html",
    "phet_重力实验室.html",
    "elevator_惯性.html",
    "阻力对物体运动的影响.html",
    "phet_碰撞实验.html",
    "phet_抛体运动.html",
    "javalab_竖直上抛与斜抛.html",
    "javalab_惯性实验.html",
    "phet_力和运动基础.html",
    "phet_摩擦力.html",
    "phet_流体压强.html",
    "phet_气体性质.html",
    "流体压强与流速的关系.html",
    "javalab_动能影响因素.html",
    "phet_能量滑板.html",
    "机械能守恒与能量转化.html",
    "phet_单摆.html",
    "phet_开普勒定律.html",
    "javalab_机械能转化.html",
    "javalab_卫星机械能.html",
    "javalab_斜面弹簧能量转化.html",
    "javalab_熵.html",
    // 第十一章第3节「动能和势能」的新创 3D 页：沙盘陷坑测重力势能。
    // experiments.html 里是 card lock + 「VIP专享」，按维护约定必须登记在这里。
    "探究重力势能大小的影响因素立体模型.html",
    "杠杆平衡条件.html",
    "杠杆自重平衡.html",
    "phet_杠杆平衡.html",
    "杆秤.html",
    "phet_扩散.html",
    "phet_卢瑟福散射.html",
    "phet_构建原子.html",
    "javalab_原子结构.html",
    "javalab_原子尺度.html",
    "phet_物态变化.html",
    "phet_能量转化.html",
    "phet_静电实验.html",
    "phet_静电气球.html",
    "javalab_莱顿瓶.html",
    "验电器.html",
    "phet_电路搭建.html",
    "phet_直流电路.html",
    "javalab_楼梯灯电路.html",
    "javalab_串并联电路.html",
    "phet_导线电阻.html",
    "javalab_白炽灯.html",
    "javalab_电阻串并联.html",
    "铜丝与镍铬合金丝.html",
    "欧姆定律.html",
    "phet_欧姆定律.html",
    "javalab_输电模拟.html",
    "phet_磁铁与指南针.html",
    "javalab_磁力线.html",
    "javalab_磁化实验.html",
    "javalab_磁化现象.html",
    "javalab_奥斯特实验.html",
    "javalab_通电螺线管磁场.html",
    "javalab_磁铁与电磁铁.html",
    "phet_磁铁与电磁铁.html",
    "直流电动机原理.html",
    "javalab_直流电动机3D.html",
    "phet_法拉第电磁感应.html",
    "phet_发电机.html",
    "javalab_交流发电机.html",
    "phet_法拉第电磁实验室.html",
    "javalab_扬声器与麦克风.html",
    // 第十九章第1节「家庭电路」的旗舰 3D 页：进户线 → 电能表 → 总开关 → 空气开关
    // → 三孔插座 / 墙面开关 → 灯，全屋用 circuit-core.js 的 MNA 真求解。
    // experiments.html 里是 card lock + 「VIP专享」，按维护约定必须登记。
    // 漏登记 = checkVip() 只判 VIP 状态、不查名单 ⇒ 直接输网址就能免费看。
    "家庭电路立体模型.html",
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
