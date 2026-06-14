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
    localStorage.setItem("users", JSON.stringify(users));
    return users;
  } catch (e) {
    console.warn("[系统] Supabase 读取失败:", e.message);
    return JSON.parse(localStorage.getItem("users") || "{}");
  }
}

// ========== 注册功能 ==========
async function userRegister() {
  const user = document.getElementById("regUser").value.trim();
  const pwd = document.getElementById("regPwd").value.trim();
  const email = document.getElementById("regEmail").value.trim();
  const tip = document.getElementById("regTip");
  const pwd2El = document.getElementById("regPwd2");
  const pwd2 = pwd2El ? pwd2El.value.trim() : "";

  if (!user || !pwd || !email) {
    if (tip) { tip.className = "auth-tip error"; tip.textContent = "⚠️ 请填写用户名、密码和邮箱（邮箱用于找回密码）"; }
    return;
  }

  if (pwd !== pwd2) {
    if (tip) { tip.className = "auth-tip error"; tip.textContent = "⚠️ 两次输入的密码不一致"; }
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
    var regParams = new URLSearchParams(window.location.search);
    var regRedirect = regParams.get('redirect');
    var loginUrl = regRedirect ? "login.html?redirect=" + encodeURIComponent(regRedirect) : "login.html";
    tip.innerHTML = "✅ 注册成功！账号已激活，<a href='" + loginUrl + "' style='color:var(--secondary);font-weight:600;'>立即登录</a>";
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
      userData = { password: cached[user].pwd, vip: cached[user].vip, expire: cached[user].expire };
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

  // 生成 session token 并同步到服务端（单设备登录）
  var sessionToken = "sess_" + Date.now() + "_" + Math.random().toString(36).substring(2, 10);
  localStorage.setItem("sessionToken", sessionToken);
  fetch("https://ruledlbrdqhruotuaxwi.supabase.co/rest/v1/users?username=eq." + encodeURIComponent(user), {
    method: "PATCH",
    headers: {
      "apikey": "sb_publishable_0eFNMabL5IhHExao6wSE2A_nWbmMEKt",
      "Authorization": "Bearer sb_publishable_0eFNMabL5IhHExao6wSE2A_nWbmMEKt",
      "Content-Type": "application/json",
      "Prefer": "return=representation"
    },
    body: JSON.stringify({ session_token: sessionToken })
  });

  var params = new URLSearchParams(window.location.search);
  var redirect = params.get('redirect');
  location.href = redirect || "experiments.html";
}

// ========== 支付验证逻辑 ==========
async function simulatePaySuccess(user, type, code) {
  console.log(`[激活] 开始验证。用户: ${user}, 套餐: ${type}, 码: ${code}`);

  // 规范化：去空格、转大写、去分隔符（支持带 - 或不带 - 输入）
  const cleanCode = code.toString().trim().toUpperCase().replace(/[\s-]/g, '');

  // 方案一：通过 activation_codes 表验证（推荐）
  let codeRecord = null;
  try {
    const data = await SB.getActivationCode(cleanCode);
    if (data && data.length > 0) codeRecord = data[0];
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

    await SB.updateUser(user, { vip: type, expire: expireDate });
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

// ========== 搜索功能 ==========
var _searchDebounce = null;

function initSearch() {
  var input = document.getElementById('experimentSearch');
  var clearBtn = document.getElementById('searchClear');
  var dropdown = document.getElementById('searchDropdown');
  if (!input) return;

  input.addEventListener('input', function() {
    var q = this.value.trim();
    clearBtn.style.display = q ? 'flex' : 'none';
    clearTimeout(_searchDebounce);
    _searchDebounce = setTimeout(function() { filterExperiments(q); }, 200);
  });

  input.addEventListener('focus', function() {
    if (this.value.trim()) filterExperiments(this.value.trim());
  });

  clearBtn.addEventListener('click', function() {
    input.value = '';
    clearBtn.style.display = 'none';
    clearTimeout(_searchDebounce);
    hideSearchDropdown();
    input.focus();
  });

  // Click outside to close dropdown
  document.addEventListener('click', function(e) {
    if (dropdown && !dropdown.parentElement.contains(e.target)) {
      hideSearchDropdown();
    }
  });
}

function hideSearchDropdown() {
  var dropdown = document.getElementById('searchDropdown');
  if (dropdown) dropdown.style.display = 'none';
}

function filterExperiments(query) {
  var q = query.toLowerCase();
  var dropdown = document.getElementById('searchDropdown');
  var resultsEl = document.getElementById('searchResults');
  var countEl = document.getElementById('searchCount');
  if (!dropdown || !resultsEl) return;

  if (!q) {
    hideSearchDropdown();
    return;
  }

  // Category keyword mapping
  var catMap = {
    '力学': '力 运动 牛顿 惯性 压强 浮力 机械能 杠杆 滑轮 摩擦 弹力 重力 弹簧 抛体 碰撞 平衡 阿基米德 密度',
    '光学': '光 镜 透镜 折射 反射 色散 颜色 小孔 成像 光学',
    '电学': '电 电路 电流 电压 电阻 欧姆 电荷 静电 焦耳 功率 导线 串联 并联 莱顿',
    '磁学': '磁 电磁 洛伦兹 法拉第 电动机 发电机 螺线管 奥斯特 磁铁',
    '声学': '声 音 波 波形 和弦 驻波 傅里叶 麦克风 扬声器 音调 音叉',
    '热学': '热 内能 物态 扩散 温度 膨胀 分子 物态变化',
    '原子': '原子 卢瑟福 电子 元素 核 粒子',
    '浮力': '浮力 阿基米德 浮沉 排开',
    '电与磁': '磁 电磁 洛伦兹 法拉第 电动机 发电机 螺线管 奥斯特 磁铁 电流 磁场',
    '功和能': '功 能 动能 势能 机械能 能量 守恒 转化',
  };

  var searchWords = [q];
  if (catMap[q]) searchWords = catMap[q].split(' ');

  var results = [];
  var allCards = document.querySelectorAll('.grade-content .card');

  allCards.forEach(function(card) {
    var title = (card.querySelector('h4')?.textContent || '').trim();
    var tag = (card.querySelector('.tag')?.textContent || '').trim();
    var icon = (card.querySelector('.card-icon')?.textContent || '').trim();
    var chapter = (card.closest('.chapter')?.querySelector('.chapter-header')?.textContent || '').replace(/[▼▶▸]/g, '').trim();
    var section = (card.closest('.section-item')?.querySelector('.section-header')?.textContent || '').replace(/[▼▶▸]/g, '').trim();
    var cardText = (title + ' ' + tag + ' ' + chapter + ' ' + section).toLowerCase();

    var matches = searchWords.some(function(w) { return cardText.indexOf(w) !== -1; });
    if (!matches) return;

    var onclick = card.getAttribute('onclick') || '';
    var urlMatch = onclick.match(/['\"]([^'\"]+\.html)['\"]/);
    var url = urlMatch ? urlMatch[1] : '';
    var isLocked = card.classList.contains('lock');
    var isVip = tag.indexOf('VIP') !== -1 || tag.indexOf('vip') !== -1;

    results.push({
      title: title,
      icon: icon,
      chapter: chapter,
      section: section,
      url: url,
      isLocked: isLocked,
      isVip: isVip,
      tag: tag
    });
  });

  // Build dropdown HTML
  var html = '';
  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    var escapedUrl = r.url.replace(/'/g, "\\'");
    var action = r.isLocked ? "checkVip('" + escapedUrl + "')" : "openLab('" + escapedUrl + "')";
    var iconHtml = r.icon ? '<span class="search-result-icon">' + r.icon + '</span>' : '';
    var tagClass = r.isVip ? 'vip' : 'free';
    var tagHtml = r.tag ? '<span class="search-result-tag ' + tagClass + '">' + r.tag + '</span>' : '';
    var meta = [r.chapter, r.section].filter(Boolean).join(' · ');

    html += '<div class="search-result-item" onclick="' + action + '" data-url="' + escapedUrl + '">' +
      iconHtml +
      '<div class="search-result-info">' +
        '<div class="search-result-title">' + r.title + '</div>' +
        (meta ? '<div class="search-result-meta">' + meta + '</div>' : '') +
      '</div>' +
      tagHtml +
    '</div>';
  }

  if (!results.length) {
    html = '<div class="search-results-empty">未找到匹配的实验，试试其他关键词</div>';
  }

  resultsEl.innerHTML = html;
  countEl.textContent = results.length > 0 ? '找到 ' + results.length + ' 个实验' : '无匹配结果';
  countEl.style.color = results.length > 0 ? 'var(--secondary)' : '#ef4444';
  dropdown.style.display = 'block';
}

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
  openInFrame(lab);
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

function openInFrame(url) {
  localStorage.setItem('_tk', Date.now());
  var overlay = document.getElementById('labOverlay');
  var frame = document.getElementById('labFrame');
  if (overlay && frame) {
    overlay.style.display = 'block';
    frame.src = url;
    document.body.style.overflow = 'hidden';
  } else {
    window.open(url, '_blank');
  }
}
function closeLab() {
  var overlay = document.getElementById('labOverlay');
  var frame = document.getElementById('labFrame');
  if (overlay) overlay.style.display = 'none';
  if (frame) frame.src = '';
  document.body.style.overflow = '';
}
function openLab(lab) { openInFrame(lab); }

function buyVip(type) {
  let user = localStorage.getItem("currentUser");
  if (!user) { alert("请先登录"); location.href = "login.html"; return; }
  location.href = 'vip.html';
}

function logout() {
  var user = localStorage.getItem("currentUser");
  localStorage.removeItem("currentUser");
  localStorage.removeItem("sessionToken");
  if (user) {
    fetch("https://ruledlbrdqhruotuaxwi.supabase.co/rest/v1/users?username=eq." + encodeURIComponent(user), {
      method: "PATCH",
      headers: {
        "apikey": "sb_publishable_0eFNMabL5IhHExao6wSE2A_nWbmMEKt",
        "Authorization": "Bearer sb_publishable_0eFNMabL5IhHExao6wSE2A_nWbmMEKt",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ session_token: null })
    });
  }
  location.href = "index.html";
}

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
  initSearch();
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
      nav.innerHTML = `<a href="index.html">首页</a><a href="experiments.html">实验列表</a><a href="free-trial.html" style="color:#fbbf24;font-weight:700;">免费体验</a><a href="vip.html">开通VIP</a><div style="display:inline-flex;align-items:center;margin-left:2rem;padding:0.25rem 1rem 0.25rem 0.25rem;background:rgba(255,255,255,0.05);border-radius:50px;border:1px solid var(--glass-border);cursor:pointer;" onclick="toggleProfile()"><img src="${avatarDataUrl}" style="width:30px;height:30px;border-radius:50%;margin-right:8px;flex-shrink:0;box-shadow:0 0 8px rgba(59,130,246,0.3);">${vipBadge}<div style="display:flex;flex-direction:column;line-height:1.2;"><span style="color:var(--text-main);font-size:0.9rem;font-weight:600;">${uName}</span></div><a href="javascript:logout()" style="color:var(--accent);margin-left:1.2rem;font-size:0.8rem;text-decoration:none;opacity:0.7;" onclick="event.stopPropagation()">[退出]</a></div>`;
      if (isVip && !isExpired) {
        document.querySelectorAll('.card.lock').forEach(card => {
          card.classList.remove('lock');
          const tag = card.querySelector('.tag.vip');
          if (tag) { tag.innerText = "已解锁"; tag.style.background = "rgba(34, 197, 94, 0.2)"; tag.style.color = "#4ade80"; }
        });
      }
      // 更新在线状态（静默，不阻塞页面）
      if (uName) {
        SB.updateUser(uName, { last_seen: new Date().toISOString() }).catch(() => {});
      }
    }

    // 单设备登录：每 30 秒校验 session token
    setInterval(async function() {
      var curUser = localStorage.getItem("currentUser");
      var curToken = localStorage.getItem("sessionToken");
      if (!curUser || !curToken) return;
      try {
        var res = await fetch(SUPABASE_URL + "/rest/v1/users?username=eq." + encodeURIComponent(curUser) + "&select=session_token", {
          headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": "Bearer " + SUPABASE_ANON_KEY }
        });
        var data = await res.json();
        if (data && data[0] && data[0].session_token && data[0].session_token !== curToken) {
          localStorage.removeItem("currentUser");
          localStorage.removeItem("sessionToken");
          alert("您的账号已在其他设备登录，当前设备已下线。");
          location.href = "login.html?reason=kicked";
        }
      } catch(e) {}
    }, 30000);
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
