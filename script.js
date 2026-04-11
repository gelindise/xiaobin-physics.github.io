// 替换成你自己的 jsonbin Master Key
const MASTER_KEY = "$2a$10$aoMsUPUiqH2cyOLgVOpWvOuZKxPX1cP9GL/cQ90700po1xfJreQhG"; 
const BIN_ID = "你的Bin ID"; // 下面教你创建Bin ID

// 从云端加载用户数据
async function loadUsers() {
  try {
    const res = await fetch(`https://api.jsonbin.io/v3/b/${BIN_ID}/latest`, {
      headers: { "X-Master-Key": MASTER_KEY }
    });
    const data = await res.json();
    return data.record || {};
  } catch (e) {
    // 云端加载失败，用本地数据兜底
    return JSON.parse(localStorage.getItem("users") || "{}");
  }
}

// 保存用户数据到云端
async function saveUsers(users) {
  localStorage.setItem("users", JSON.stringify(users));
  try {
    await fetch(`https://api.jsonbin.io/v3/b/${BIN_ID}`, {
      method: "PUT",
      headers: {
        "X-Master-Key": MASTER_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(users)
    });
  } catch (e) {
    console.log("云端保存失败，仅保存在本地");
  }
}

// 初始化Bin（首次使用创建）
async function initBin() {
  const users = JSON.parse(localStorage.getItem("users") || "{}");
  await fetch("https://api.jsonbin.io/v3/b", {
    method: "POST",
    headers: {
      "X-Master-Key": MASTER_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(users)
  }).then(res => res.json()).then(data => {
    console.log("Bin创建成功，ID：", data.metadata.id);
    // 把返回的ID填到上面的BIN_ID里
  });
}

// 注册
async function userRegister() {
  let user = document.getElementById("regUser").value;
  let pwd = document.getElementById("regPwd").value;
  let email = document.getElementById("regEmail").value;
  if (!user || !pwd) {
    document.getElementById("regTip").innerText = "用户名和密码不能为空";
    return;
  }
  let users = await loadUsers();
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
  await saveUsers(users);
  document.getElementById("regTip").innerText = "注册成功！请登录";
}

// 登录
async function userLogin() {
  let user = document.getElementById("loginUser").value;
  let pwd = document.getElementById("loginPwd").value;
  let users = await loadUsers();
  if (!users[user] || users[user].pwd !== pwd) {
    document.getElementById("loginTip").innerText = "用户名或密码错误";
    return;
  }
  localStorage.setItem("currentUser", user);
  location.href = "experiments.html";
}

// 获取当前用户
async function getCurrentUser() {
  let name = localStorage.getItem("currentUser");
  if (!name) return null;
  let users = await loadUsers();
  return users[name] || null;
}

// 检查VIP
async function checkVip(lab) {
  let user = await getCurrentUser();
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
  window.open("/xiaobin-physics.github.io/" + lab, "_blank");
}

// 打开免费实验
function openLab(lab) {
  window.open("/xiaobin-physics.github.io/" + lab, "_blank");
}

// 购买VIP
async function buyVip(type) {
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
async function setUserVip() {
  let user = document.getElementById("adminUser").value;
  let type = document.getElementById("vipType").value;
  let users = await loadUsers();
  if (!users[user]) {
    document.getElementById("adminTip").innerText = "用户不存在";
    return;
  }
  users[user].vip = type;
  if (type === "月度VIP") users[user].expire = "30天";
  if (type === "年度VIP") users[user].expire = "365天";
  if (type === "终身VIP") users[user].expire = "永久";
  await saveUsers(users);
  document.getElementById("adminTip").innerText = "VIP开通成功！";
}

// 实验页面显示用户名
window.onload = async function() {
  let u = localStorage.getItem("currentUser");
  if (u && document.getElementById("userInfo")) {
    document.getElementById("userInfo").innerText = "欢迎，" + u;
  }
  // 首次使用请取消下面的注释，执行一次创建Bin
   initBin();
};
