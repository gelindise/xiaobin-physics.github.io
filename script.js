// ========== 核心配置 ==========
// Supabase 在 supabase.js 中配置：SUPABASE_URL / SUPABASE_ANON_KEY / SB 工具对象

// ========== 获取所有用户（对象格式兼容旧代码） ==========
async function getUsersFromTable() {
  try {
    const data = await SB.getUsers();
    let users = {};
    for (const row of data) {
      users[row.username] = {
        pwd: row.password,
        vip: row.vip || "普通用户",
        expire: row.expire || "",
        email: row.email || "",
        authCode: row.authCode || "",
      };
    }
    // 写一份到 localStorage 作为离线缓存
    localStorage.setItem("users", JSON.stringify(users));
    return users;
  } catch (e) {
    console.warn("[系统] Supabase 读取失败:", e.message);
    // 降级到本地缓存
    return JSON.parse(localStorage.getItem("users") || "{}");
  }
}

// ========== 注册功能 ==========
async function userRegister() {
  const user = document.getElementById("regUser").value.trim();
  const pwd = document.getElementById("regPwd").value.trim();
  const email = document.getElementById("regEmail").value.trim();
  const tip = document.getElementById("regTip");

  if (!user || !pwd) {
    if (tip) { tip.className = "auth-tip error"; tip.textContent = "⚠️ 请输入用户名和密码"; }
    return;
  }

  if (user.length < 2) {
    if (tip) { tip.className = "auth-tip error"; tip.textContent = "⚠️ 用户名至少需要2个字符"; }
    return;
  }

  if (pwd.length < 4) {
    if (tip) { tip.className = "auth-tip error"; tip.textContent = "⚠️ 密码至少需要4个字符"; }
    return;
  }

  // 检查用户名是否已存在
  try {
    const existing = await SB.getUser(user);
    if (existing && existing.length > 0) {
      if (tip) { tip.className = "auth-tip error"; tip.textContent = "⚠️ 用户名已存在，请换一个"; }
      return;
    }
  } catch (e) {
    console.warn("[注册] 查询失败，尝试本地兜底:", e.message);
    const cached = JSON.parse(localStorage.getItem("users") || "{}");
    if (cached[user]) {
      if (tip) { tip.className = "auth-tip error"; tip.textContent = "⚠️ 用户名已存在，请换一个"; }
      return;
    }
  }

  // 写入 Supabase
  try {
    await SB.createUser({
      username: user,
      password: pwd,
      email: email || "",
      vip: "普通用户",
      expire: "",
    });
  } catch (e) {
    console.error("[注册] Supabase 写入失败:", e.message);
    // 按 Supabase 唯一约束错误提示
    if (e.message?.includes("duplicate") || e.message?.includes("23505")) {
      if (tip) { tip.className = "auth-tip error"; tip.textContent = "⚠️ 用户名已存在，请换一个"; }
    } else {
      if (tip) { tip.className = "auth-tip error"; tip.textContent = "❌ 注册失败，请稍后重试"; }
    }
    return;
  }

  // 同步到 localStorage 缓存
  const cached = JSON.parse(localStorage.getItem("users") || "{}");
  cached[user] = { pwd, email: email || "", vip: "普通用户", expire: "" };
  localStorage.setItem("users", JSON.stringify(cached));

  if (tip) {
    tip.className = "auth-tip success";
    tip.innerHTML = "✅ 注册成功！账号已激活，<a href='login.html' style='color:var(--secondary);font-weight:600;'>立即登录</a>";
  }

  document.getElementById("regUser").value = "";
  document.getElementById("regPwd").value = "";
}

// ========== 登录功能 ==========
async function userLogin() {
  const user = document.getElementById("loginUser").value.trim();
  const pwd = document.getElementById("loginPwd").value.trim();
  const tip = document.getElementById("loginTip");

  if (!user || !pwd) {
    if (tip) { tip.className = "auth-tip error"; tip.textContent = "⚠️ 请输入用户名和密码"; }
    return;
  }

  // 从 Supabase 查询用户
  let userData = null;
  try {
    const result = await SB.getUser(user);
    if (result && result.length > 0) {
      userData = result[0];
    }
  } catch (e) {
    console.warn("[登录] Supabase 查询失败:", e.message);
    // 降级：尝试本地缓存
    const cached = JSON.parse(localStorage.getItem("users") || "{}");
    if (cached[user]) {
      userData = { username: user, password: cached[user].pwd, vip: cached[user].vip, expire: cached[user].expire };
    }
  }

  if (!userData) {
    if (tip) { tip.className = "auth-tip error"; tip.textContent = "❌ 用户不存在，请检查用户名或先注册"; }
    return;
  }

  if (userData.password !== pwd) {
    if (tip) { tip.className = "auth-tip error"; tip.textContent = "❌ 密码错误，请重试"; }
    return;
  }

  localStorage.setItem("currentUser", user);
  location.href = "experiments.html";
}

// ========== 支付验证逻辑 ==========
async function simulatePaySuccess(user, type, code) {
  console.log(`[激活] 开始验证。用户: ${user}, 套餐: ${type}, 码: ${code}`);

  // 规范化：去空格、转大写、去分隔符（支持带 - 或不带 - 输入）
  const cleanCode = code.toString().trim().toUpperCase().replace(/[\s-]/g, '');

  // 方案一：通过 activation_codes 表验证（推荐）
  let codeRecord = null;
  try {
    const result = await SB.getActivationCode(cleanCode);
    if (result && result.length > 0) codeRecord = result[0];
  } catch (e) {
    console.warn("[激活] activation_codes 表不可用:", e.message);
  }

  if (codeRecord) {
    // 有激活码记录
    if (codeRecord.status !== 'unused') {
      alert('❌ 此激活码已被使用（' + (codeRecord.used_by || '?') + '）');
      return false;
    }
    if (codeRecord.vip_type !== type) {
      alert('❌ 此激活码是"' + codeRecord.vip_type + '"专用，与您选择的"' + type + '"不匹配');
      return false;
    }

    // 计算到期日期
    let expireDate = "";
    const now = new Date();
    if (type === "月度VIP") { now.setDate(now.getDate() + 30); expireDate = now.toISOString().split('T')[0]; }
    else if (type === "年度VIP") { now.setDate(now.getDate() + 365); expireDate = now.toISOString().split('T')[0]; }
    else { expireDate = "永久"; }

    // 先更新用户 VIP
    await SB.updateUser(user, { vip: type, expire: expireDate });
    // 再标记激活码已用
    await SB.updateActivationCode(codeRecord.id, { status: 'used', used_by: user, used_at: new Date().toISOString() });

    // 同步本地缓存
    const cached = JSON.parse(localStorage.getItem("users") || "{}");
    if (cached[user]) { cached[user].vip = type; cached[user].expire = expireDate; localStorage.setItem("users", JSON.stringify(cached)); }
    localStorage.setItem("currentUser", user);

    console.log(`[激活] SUCCESS: ${user} → ${type} (${expireDate}) 码: ${code}`);
    return true;
  }

  // 方案二：回退到旧版 per-user authCode（兼容旧数据）
  console.log("[激活] activation_codes 未匹配，尝试旧版 authCode...");
  let userData = null;
  try {
    const result = await SB.getUser(user);
    if (result && result.length > 0) userData = result[0];
  } catch (e) {
    console.warn("[激活] Supabase 查询失败:", e.message);
  }

  if (!userData) {
    alert('❌ 未找到用户 [' + user + ']，请确认已注册');
    return false;
  }

  const tableCode = (userData.authCode || "").toString().trim();
  const inputCode = cleanCode;

  if (!tableCode || tableCode !== inputCode) {
    alert('❌ 激活失败！您输入的激活码无效。\n\n提示：\n1. 请确认已付款\n2. 请检查激活码是否输入正确（注意大小写）\n3. 联系管理员获取有效激活码');
    return false;
  }

  // 计算到期日期
  let expireDate = "";
  const now = new Date();
  if (type === "月度VIP") { now.setDate(now.getDate() + 30); expireDate = now.toISOString().split('T')[0]; }
  else if (type === "年度VIP") { now.setDate(now.getDate() + 365); expireDate = now.toISOString().split('T')[0]; }
  else { expireDate = "永久"; }

  try {
    await SB.updateUser(user, { vip: type, expire: expireDate });
  } catch (e) {
    console.error("[激活] 更新失败:", e.message);
    alert('❌ 激活更新失败，请重试');
    return false;
  }

  const cached = JSON.parse(localStorage.getItem("users") || "{}");
  if (cached[user]) { cached[user].vip = type; cached[user].expire = expireDate; localStorage.setItem("users", JSON.stringify(cached)); }
  localStorage.setItem("currentUser", user);

  return true;
}

// ========== 头像生成 ==========
function generateAvatar(name, size = 40) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');

  const colors = [
    ['#3b82f6','#1d4ed8'], ['#8b5cf6','#6d28d9'], ['#06b6d4','#0891b2'],
    ['#22c55e','#16a34a'], ['#f59e0b','#d97706'], ['#ef4444','#dc2626'],
    ['#ec4899','#db2777'], ['#14b8a6','#0d9488'],
  ];

  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const [bg, bgDark] = colors[Math.abs(hash) % colors.length];

  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, bg); grad.addColorStop(1, bgDark);
  ctx.beginPath(); ctx.arc(size/2, size/2, size/2, 0, Math.PI * 2);
  ctx.fillStyle = grad; ctx.fill();

  ctx.fillStyle = 'white';
  ctx.font = `bold ${size * 0.46}px -apple-system,sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(name.charAt(0).toUpperCase(), size/2, size/2 + 1);

  return c.toDataURL();
}

// ========== 辅助功能 ==========
async function getCurrentUser() {
  let name = localStorage.getItem("currentUser");
  if (!name) return null;
  let users = await getUsersFromTable();
  return users[name] || null;
}

async function checkVip(lab) {
  let user = await getCurrentUser();
  if (!user) { alert("请先登录！"); location.href = "login.html"; return; }
  const now = new Date();
  const isVip = user.vip && user.vip !== "普通用户";
  const isExpired = isVip && user.expire !== "永久" && now > new Date(user.expire);
  if (!isVip || isExpired) { alert("⚠️ VIP 权限不足或已过期，请开通"); location.href = "vip.html"; return; }
  window.open(lab, "_blank");
}

function showGrade(btn, gradeId) {
  document.querySelectorAll('.grade-content').forEach(c => c.classList.remove('active'));
  document.getElementById(gradeId).classList.add('active');
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.chapter').forEach(ch => ch.classList.remove('active'));
}

function toggleChapter(header) {
  const chapter = header.parentElement;
  const isActive = chapter.classList.contains('active');
  document.querySelectorAll('.chapter').forEach(ch => ch.classList.remove('active'));
  if (!isActive) chapter.classList.add('active');
}

function toggleSection(header) {
  const section = header.parentElement;
  const isActive = section.classList.contains('active');
  section.parentElement.querySelectorAll('.section-item').forEach(s => s.classList.remove('active'));
  if (!isActive) section.classList.add('active');
}

function openLab(lab) { window.open(lab, "_blank"); }

function buyVip(type) {
  let user = localStorage.getItem("currentUser");
  if (!user) { alert("请先登录"); location.href = "login.html"; return; }
  location.href = `pay.html?type=${encodeURIComponent(type)}&user=${encodeURIComponent(user)}`;
}

function logout() { localStorage.removeItem("currentUser"); location.href = "index.html"; }

async function toggleProfile() {
  const uName = localStorage.getItem("currentUser");
  const users = await getUsersFromTable();
  const user = users[uName];
  if (!user) return;
  let modal = document.getElementById('profileModal');
  if (!modal) {
    modal = document.createElement('div'); modal.id = 'profileModal'; modal.className = 'profile-modal';
    modal.onclick = (e) => { if(e.target === modal) modal.style.display = 'none'; };
    document.body.appendChild(modal);
  }
  const isVip = user.vip && user.vip !== "普通用户";
  const isExpired = isVip && user.expire !== "永久" && new Date() > new Date(user.expire);
  const avatarDataUrl = generateAvatar(uName, 80);
  modal.innerHTML = `<div class="profile-card"><div class="profile-avatar" style="background:none;box-shadow:none;"><img src="${avatarDataUrl}" style="width:80px;height:80px;border-radius:50%;box-shadow:0 0 20px rgba(59,130,246,0.4);"></div><h2>${uName}</h2><p style="color:${isExpired?'#ef4444':(isVip?'#fbbf24':'#94a3b8')};font-weight:bold;">${isExpired?'VIP已到期':(isVip?user.vip:'普通用户')}</p><div class="profile-info-row"><span>账号类型</span><span>${isVip?'VIP会员':'普通会员'}</span></div><div class="profile-info-row"><span>到期时间</span><span>${user.expire||'无'}</span></div><button class="btn" style="margin-top:2.5rem;width:100%;" onclick="document.getElementById('profileModal').style.display='none'">关闭</button></div>`;
  modal.style.display = 'flex';
}

window.onload = async function() {
  initParticles();
  const users = await getUsersFromTable();
  const uName = localStorage.getItem("currentUser");
  const user = uName ? users[uName] : null;
  if (user) {
    let nav = document.querySelector(".nav");
    if (nav) {
      const isVip = user.vip && user.vip !== "普通用户";
      const isExpired = isVip && user.expire !== "永久" && new Date() > new Date(user.expire);
      let vipBadge = isVip ? (isExpired ? `<span style="background:#ef4444;color:white;padding:2px 8px;border-radius:4px;font-size:0.7rem;margin-right:8px;">VIP已到期</span>` : `<span style="background:linear-gradient(135deg,#fbbf24,#d97706);color:white;padding:2px 8px;border-radius:4px;font-size:0.7rem;font-weight:bold;margin-right:8px;box-shadow:0 0 10px rgba(251,191,36,0.5);">💎 VIP</span>`) : `<span style="background:#475569;color:white;padding:2px 8px;border-radius:4px;font-size:0.7rem;margin-right:8px;">普通用户</span>`;
      const avatarDataUrl = generateAvatar(uName);
      nav.innerHTML = `<a href="index.html">首页</a><a href="experiments.html">实验列表</a><a href="vip.html">开通VIP</a><div style="display:inline-flex;align-items:center;margin-left:2rem;padding:0.25rem 1rem 0.25rem 0.25rem;background:rgba(255,255,255,0.05);border-radius:50px;border:1px solid var(--glass-border);cursor:pointer;" onclick="toggleProfile()"><img src="${avatarDataUrl}" style="width:30px;height:30px;border-radius:50%;margin-right:8px;flex-shrink:0;box-shadow:0 0 8px rgba(59,130,246,0.3);">${vipBadge}<div style="display:flex;flex-direction:column;line-height:1.2;"><span style="color:var(--text-main);font-size:0.9rem;font-weight:600;">${uName}</span></div><a href="javascript:logout()" style="color:var(--accent);margin-left:1.2rem;font-size:0.8rem;text-decoration:none;opacity:0.7;" onclick="event.stopPropagation()">[退出]</a></div>`;
      if (isVip && !isExpired) {
        document.querySelectorAll('.card.lock').forEach(card => {
          card.classList.remove('lock');
          const tag = card.querySelector('.tag.vip');
          if (tag) { tag.innerText = "已解锁"; tag.style.background = "rgba(34, 197, 94, 0.2)"; tag.style.color = "#4ade80"; }
        });
      }
    }
  }
};

function initParticles() {
  const canvas = document.createElement('canvas'); canvas.id = 'particle-canvas'; canvas.style.position = 'fixed'; canvas.style.top = '0'; canvas.style.left = '0'; canvas.style.width = '100%'; canvas.style.height = '100%'; canvas.style.zIndex = '-2'; canvas.style.pointerEvents = 'none'; document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d'); let particles = [];
  function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
  window.addEventListener('resize', resize); resize();
  class Particle {
    constructor() { this.reset(); }
    reset() { this.x = Math.random() * canvas.width; this.y = Math.random() * canvas.height; this.vx = (Math.random() - 0.5) * 0.5; this.vy = (Math.random() - 0.5) * 0.5; this.size = Math.random() * 2; this.alpha = Math.random() * 0.5; }
    update() { this.x += this.vx; this.y += this.vy; if (this.x < 0 || this.x > canvas.width || this.y < 0 || this.y > canvas.height) this.reset(); }
    draw() { ctx.fillStyle = `rgba(59, 130, 246, ${this.alpha})`; ctx.beginPath(); ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2); ctx.fill(); }
  }
  for (let i = 0; i < 100; i++) particles.push(new Particle());
  function animate() { ctx.clearRect(0, 0, canvas.width, canvas.height); particles.forEach(p => { p.update(); p.draw(); }); requestAnimationFrame(animate); }
  animate();
}
