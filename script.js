// 注册
function userRegister() {
  let user = document.getElementById("regUser").value;
  let pwd = document.getElementById("regPwd").value;
  let email = document.getElementById("regEmail").value;
  if (!user || !pwd) {
    document.getElementById("regTip").innerText = "用户名和密码不能为空";
    return;
  }
  let users = JSON.parse(localStorage.getItem("users") || "{}");
  if (users[user]) {
    document.getElementById("regTip").innerText = "用户名已存在";
    return;
  }
  users[user] = {
    pwd: pwd,
    email: email,
    vip: "普通用户",
    expire: ""
  };
  localStorage.setItem("users", JSON.stringify(users));
  document.getElementById("regTip").innerText = "注册成功！请登录";
}

// 登录
function userLogin() {
  let user = document.getElementById("loginUser").value;
  let pwd = document.getElementById("loginPwd").value;
  let users = JSON.parse(localStorage.getItem("users") || "{}");
  if (!users[user] || users[user].pwd !== pwd) {
    document.getElementById("loginTip").innerText = "用户名或密码错误";
    return;
  }
  localStorage.setItem("currentUser", user);
  location.href = "experiments.html";
}

// 获取当前用户
function getCurrentUser() {
  let name = localStorage.getItem("currentUser");
  if (!name) return null;
  let users = JSON.parse(localStorage.getItem("users") || "{}");
  return users[name] || null;
}

// 检查VIP
function checkVip(lab) {
  let user = getCurrentUser();
  if (!user) {
    alert("请先登录！");
    location.href = "login.html";
    return;
  }
  if (user.vip === "普通用户") {
    alert("此实验为VIP专享，请开通VIP后观看");
    location.href = "vip.html";
    return;
  }
  window.open(lab, "_blank");
}

// 打开免费实验
function openLab(lab) {
  window.open(lab, "_blank");
}

// 购买VIP
function buyVip(type) {
  let user = localStorage.getItem("currentUser");
  if (!user) {
    alert("请先登录");
    location.href = "login.html";
    return;
  }
  document.getElementById("orderRemark").innerText = user + " - " + type;
  document.getElementById("payInfo").style.display = "block";
}

// 管理员设置VIP
function setUserVip() {
  let user = document.getElementById("adminUser").value;
  let type = document.getElementById("vipType").value;
  let users = JSON.parse(localStorage.getItem("users") || "{}");
  if (!users[user]) {
    document.getElementById("adminTip").innerText = "用户不存在";
    return;
  }
  users[user].vip = type;
  if (type === "月度VIP") users[user].expire = "30天";
  if (type === "年度VIP") users[user].expire = "365天";
  if (type === "终身VIP") users[user].expire = "永久";
  localStorage.setItem("users", JSON.stringify(users));
  document.getElementById("adminTip").innerText = "VIP开通成功！";
}

// 实验页面显示用户名
window.onload = function() {
  let u = localStorage.getItem("currentUser");
  if (u && document.getElementById("userInfo")) {
    document.getElementById("userInfo").innerText = "欢迎，" + u;
  }
}