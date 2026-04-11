// ========== 核心配置（只改这1行！） ==========
// 替换成你的腾讯文档在线表格链接
const TABLE_URL = "https://docs.qq.com/sheet/DR1FhWkxmYmJjd2Zm?tab=BB08J2"; 

// ========== 工具函数：读取在线表格数据 ==========
async function getUsersFromTable() {
  try {
    // 把腾讯文档链接转成JSON接口
    const tableId = TABLE_URL.split("/sheet/")[1].split("?")[0];
    const apiUrl = `https://docs.qq.com/dop-api/v2/docs/${tableId}/sheets/0/rows?max_rows=1000&output_format=json`;
    
    const res = await fetch(apiUrl);
    const data = await res.json();
    
    // 解析表格数据成用户对象
    let users = {};
    const rows = data.data.rows || [];
    
    // 跳过表头行，从第二行开始解析
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const user = row[0]?.text || ""; // 用户名
      const pwd = row[1]?.text || "";  // 密码
      const vip = row[2]?.text || "普通用户"; // VIP类型
      const expire = row[3]?.text || ""; // 有效期
      const email = row[4]?.text || ""; // 邮箱
      
      if (user) {
        users[user] = { pwd, vip, expire, email };
      }
    }
    
    // 本地缓存一份，提升速度
    localStorage.setItem("users", JSON.stringify(users));
    return users;
  } catch (e) {
    // 网络异常时用本地缓存兜底
    console.log("在线表格加载失败，使用本地缓存");
    return JSON.parse(localStorage.getItem("users") || "{}");
  }
}

// ========== 注册功能（注册后手动同步到表格） ==========
async function userRegister() {
  let user = document.getElementById("regUser").value.trim();
  let pwd = document.getElementById("regPwd").value.trim();
  let email = document.getElementById("regEmail").value.trim();
  
  if (!user || !pwd) {
    document.getElementById("regTip").innerText = "⚠️ 用户名和密码不能为空";
    document.getElementById("regTip").style.color = "red";
    return;
  }
  
  let users = await getUsersFromTable();
  
  if (users[user]) {
    document.getElementById("regTip").innerText = "⚠️ 用户名已存在";
    document.getElementById("regTip").style.color = "red";
    return;
  }
  
  // 本地保存注册信息
  users[user] = {
    pwd: pwd,
    email: email || "未填写",
    vip: "普通用户",
    expire: ""
  };
  localStorage.setItem("users", JSON.stringify(users));
  
  // 注册成功提示（关键：告诉你手动更表格）
  document.getElementById("regTip").innerText = `✅ 注册成功！请把【${user} | ${pwd} | 普通用户 | 无 | ${email}】添加到在线表格`;
  document.getElementById("regTip").style.color = "green";
  
  // 清空输入框
  document.getElementById("regUser").value = "";
  document.getElementById("regPwd").value = "";
  document.getElementById("regEmail").value = "";
}

// ========== 登录功能（跨电脑可用） ==========
async function userLogin() {
  let user = document.getElementById("loginUser").value.trim();
  let pwd = document.getElementById("loginPwd").value.trim();
  
  if (!user || !pwd) {
    document.getElementById("loginTip").innerText = "⚠️ 用户名和密码不能为空";
    document.getElementById("loginTip").style.color = "red";
    return;
  }
  
  // 读取在线表格的用户数据
  let users = await getUsersFromTable();
  
  if (!users[user]) {
    document.getElementById("loginTip").innerText = "⚠️ 用户名不存在（请检查在线表格）";
    document.getElementById("loginTip").style.color = "red";
    return;
  }
  if (users[user].pwd !== pwd) {
    document.getElementById("loginTip").innerText = "⚠️ 密码错误";
    document.getElementById("loginTip").style.color = "red";
    return;
  }
  
  // 登录成功
  localStorage.setItem("currentUser", user);
  document.getElementById("loginTip").innerText = "✅ 登录成功！正在跳转";
  document.getElementById("loginTip").style.color = "green";
  
  setTimeout(() => {
    location.href = "/xiaobin-physics.github.io/experiments.html";
  }, 1000);
}

// ========== 获取当前用户 ==========
async function getCurrentUser() {
  let name = localStorage.getItem("currentUser");
  if (!name) return null;
  let users = await getUsersFromTable();
  return users[name] || null;
}

// ========== 检查VIP权限 ==========
async function checkVip(lab) {
  let user = await getCurrentUser();
  if (!user) {
    alert("请先登录！");
    location.href = "/xiaobin-physics.github.io/login.html";
    return;
  }
  if (user.vip === "普通用户") {
    alert("此实验为VIP专享，请开通VIP后联系管理员");
    location.href = "/xiaobin-physics.github.io/vip.html";
    return;
  }
  window.open("/xiaobin-physics.github.io/" + lab, "_blank");
}

// ========== 开通VIP（手动更新表格） ==========
async function setUserVip() {
  let user = document.getElementById("adminUser").value.trim();
  let type = document.getElementById("vipType").value;
  
  if (!user) {
    document.getElementById("adminTip").innerText = "⚠️ 请输入用户名";
    document.getElementById("adminTip").style.color = "red";
    return;
  }
  
  let users = await getUsersFromTable();
  
  if (!users[user]) {
    document.getElementById("adminTip").innerText = "⚠️ 用户不存在";
    document.getElementById("adminTip").style.color = "red";
    return;
  }
  
  // 提示手动更新表格
  const expire = type === "月度VIP" ? "30天" : type === "年度VIP" ? "365天" : "永久";
  document.getElementById("adminTip").innerText = `✅ 请把表格中【${user}】的VIP类型改为【${type}】，有效期改为【${expire}】`;
  document.getElementById("adminTip").style.color = "green";
  
  // 本地更新，立即可用
  users[user].vip = type;
  users[user].expire = expire;
  localStorage.setItem("users", JSON.stringify(users));
  
  document.getElementById("adminUser").value = "";
}

// ========== 辅助功能 ==========
function openLab(lab) {
  window.open("/xiaobin-physics.github.io/" + lab, "_blank");
}

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

function logout() {
  localStorage.removeItem("currentUser");
  alert("已退出登录！");
  location.href = "/xiaobin-physics.github.io/index.html";
}

// ========== 页面加载 ==========
window.onload = async function() {
  let u = localStorage.getItem("currentUser");
  if (u && document.getElementById("userInfo")) {
    document.getElementById("userInfo").innerText = "欢迎，" + u;
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
  // 提前加载用户数据
  await getUsersFromTable();
};
