// 基础配置（如果不用云端同步，注释下面2行即可）
// const MASTER_KEY = "你的Master Key"; // 不用云端就注释
// const BIN_ID = "你的Bin ID"; // 不用云端就注释

// ========== 本地存储版本（优先用这个，稳定无依赖） ==========
// 加载用户数据（本地存储，百分百稳定）
function loadUsers() {
  return JSON.parse(localStorage.getItem("users") || "{}");
}

// 保存用户数据（本地存储）
function saveUsers(users) {
  localStorage.setItem("users", JSON.stringify(users));
}

// 注册（修复逻辑，确保数据存对）
function userRegister() {
  let user = document.getElementById("regUser").value.trim(); // 去掉空格
  let pwd = document.getElementById("regPwd").value.trim();
  let email = document.getElementById("regEmail").value.trim();
  
  // 校验输入
  if (!user || !pwd) {
    document.getElementById("regTip").innerText = "⚠️ 用户名和密码不能为空";
    document.getElementById("regTip").style.color = "red";
    return;
  }
  
  let users = loadUsers();
  
  // 检查用户名是否重复
  if (users[user]) {
    document.getElementById("regTip").innerText = "⚠️ 用户名已存在";
    document.getElementById("regTip").style.color = "red";
    return;
  }
  
  // 保存用户信息（格式标准化）
  users[user] = {
    pwd: pwd,
    email: email || "未填写",
    vip: "普通用户",
    expire: ""
  };
  
  saveUsers(users);
  
  // 注册成功提示
  document.getElementById("regTip").innerText = "✅ 注册成功！请登录";
  document.getElementById("regTip").style.color = "green";
  
  // 清空输入框
  document.getElementById("regUser").value = "";
  document.getElementById("regPwd").value = "";
  document.getElementById("regEmail").value = "";
}

// 登录（修复逻辑，确保能读到数据）
function userLogin() {
  let user = document.getElementById("loginUser").value.trim();
  let pwd = document.getElementById("loginPwd").value.trim();
  
  // 校验输入
  if (!user || !pwd) {
    document.getElementById("loginTip").innerText = "⚠️ 用户名和密码不能为空";
    document.getElementById("loginTip").style.color = "red";
    return;
  }
  
  let users = loadUsers();
  
  // 检查用户是否存在 + 密码是否正确
  if (!users[user]) {
    document.getElementById("loginTip").innerText = "⚠️ 用户名不存在";
    document.getElementById("loginTip").style.color = "red";
    return;
  }
  if (users[user].pwd !== pwd) {
    document.getElementById("loginTip").innerText = "⚠️ 密码错误";
    document.getElementById("loginTip").style.color = "red";
    return;
  }
  
  // 登录成功：保存当前用户 + 跳转
  localStorage.setItem("currentUser", user);
  document.getElementById("loginTip").innerText = "✅ 登录成功！正在跳转";
  document.getElementById("loginTip").style.color = "green";
  
  // 跳转到实验列表（适配你的网站路径）
  setTimeout(() => {
    location.href = "/xiaobin-physics.github.io/experiments.html";
  }, 1000);
}

// 获取当前用户
function getCurrentUser() {
  let name = localStorage.getItem("currentUser");
  if (!name) return null;
  let users = loadUsers();
  return users[name] || null;
}

// 检查VIP权限（适配路径）
function checkVip(lab) {
  let user = getCurrentUser();
  if (!user) {
    alert("请先登录！");
    location.href = "/xiaobin-physics.github.io/login.html";
    return;
  }
  if (user.vip === "普通用户") {
    alert("此实验为VIP专享，请开通VIP后观看");
    location.href = "/xiaobin-physics.github.io/vip.html";
    return;
  }
  // 跳转实验页面（适配路径）
  window.open("/xiaobin-physics.github.io/" + lab, "_blank");
}

// 打开免费实验（适配路径）
function openLab(lab) {
  window.open("/xiaobin-physics.github.io/" + lab, "_blank");
}

// 购买VIP（适配路径）
function buyVip(type) {
  let user = localStorage.getItem("currentUser");
  if (!user) {
    alert("请先登录");
    location.href = "/xiaobin-physics.github.io/login.html";
    return;
  }
  document.getElementById("orderRemark").innerText = user + " - " + type;
  document.getElementById("payInfo").style.display = "block";
}

// 管理员设置VIP（修复逻辑）
function setUserVip() {
  let user = document.getElementById("adminUser").value.trim();
  let type = document.getElementById("vipType").value;
  
  if (!user) {
    document.getElementById("adminTip").innerText = "⚠️ 请输入要开通的用户名";
    document.getElementById("adminTip").style.color = "red";
    return;
  }
  
  let users = loadUsers();
  
  if (!users[user]) {
    document.getElementById("adminTip").innerText = "⚠️ 用户不存在";
    document.getElementById("adminTip").style.color = "red";
    return;
  }
  
  // 更新VIP信息
  users[user].vip = type;
  if (type === "月度VIP") users[user].expire = "30天";
  if (type === "年度VIP") users[user].expire = "365天";
  if (type === "终身VIP") users[user].expire = "永久";
  
  saveUsers(users);
  
  document.getElementById("adminTip").innerText = "✅ VIP开通成功！";
  document.getElementById("adminTip").style.color = "green";
  
  // 清空输入框
  document.getElementById("adminUser").value = "";
}

// 页面加载时显示用户名
window.onload = function() {
  let u = localStorage.getItem("currentUser");
  if (u && document.getElementById("userInfo")) {
    document.getElementById("userInfo").innerText = "欢迎，" + u;
    // 把登录/注册按钮换成退出
    let nav = document.querySelector(".nav");
    if (nav) {
      nav.innerHTML = `
        <a href="/xiaobin-physics.github.io/index.html">首页</a>
        <a href="/xiaobin-physics.github.io/experiments.html">实验列表</a>
        <a href="/xiaobin-physics.github.io/vip.html">开通VIP</a>
        <a href="javascript:logout()">退出登录</a>
      `;
    }
  }
};

// 新增退出登录功能
function logout() {
  localStorage.removeItem("currentUser");
  alert("已退出登录！");
  location.href = "/xiaobin-physics.github.io/index.html";
}
