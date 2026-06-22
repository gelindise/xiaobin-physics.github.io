/**
 * experiment-shell.js — 所有自研实验共享 JS 逻辑
 * 引入方式：<script src="experiment-shell.js"></script>
 * 所有 API 挂在 window.ExpShell 下
 */
(function () {
  'use strict';

  /* ========== 配置（与 supabase.js 保持一致）========== */
  const SUPABASE_URL = 'https://ruledlbrdqhruotuaxwi.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_0eFNMabL5IhHExao6wSE2A_nWbmMEKt';

  /* ========== 工具：Supabase REST ========== */
  async function sbGet(path, params = {}) {
    const url = new URL(path, SUPABASE_URL);
    Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v));
    const res = await fetch(url.toString(), {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}`);
    return res.json();
  }

  /* ========== 用户管理 ========== */
  async function getUsersFromTable() {
    try {
      const data = await sbGet('/rest/v1/users', { select: 'username,pasword,vip,expire,email,authCode' });
      const users = {};
      for (const row of data) {
        users[row.username] = {
          pwd: row.password,
          vip: row.vip || '普通用户',
          expire: row.expire || '',
          email: row.email || '',
          authCode: row.authCode || '',
        };
      }
      localStorage.setItem('users', JSON.stringify(users));
      return users;
    } catch (e) {
      console.warn('[ExpShell] Supabase 读取失败，降级本地缓存', e.message);
      return JSON.parse(localStorage.getItem('users') || '{}');
    }
  }

  async function getCurrentUser() {
    const name = localStorage.getItem('currentUser');
    if (!name) return null;
    const users = await getUsersFromTable();
    return users[name] || null;
  }

  async function checkVip(redirectUrl) {
    const user = await getCurrentUser();
    if (!user) {
      alert('请先登录！');
      location.href = 'login.html';
      return false;
    }
    const now = new Date();
    const isVip = user.vip && user.vip !== '普通用户';
    const isExpired = isVip && user.expire !== '永久' && now > new Date(user.expire);
    if (!isVip || isExpired) {
      alert('⚠️ VIP 权限不足或已过期，请开通');
      location.href = 'vip.html';
      return false;
    }
    if (redirectUrl) location.href = redirectUrl;
    return true;
  }

  /* ========== 答题系统 ========== */
  /**
   * 初始化答题系统
   * @param {Object} config
   *   - questions: Array<{ q, opts:string[], ans:number, explain?:string }>
   *   - levels: number   — 关卡数，默认 3
   *   - perLevel: number — 每关题数，默认 5
   *   - storageKey: string — localStorage 进度 key，默认 'quiz_<页面名>'
   *   - onComplete: Function — 全部通关回调
   */
  function initQuiz(config) {
    const {
      questions = [],
      levels = 3,
      perLevel = 5,
      storageKey = 'quiz_' + (location.pathname.split('/').pop().replace('.html', '') || 'index'),
      onComplete = null,
    } = config;

    if (!questions.length) return;

    /* ---------- 状态 ---------- */
    let currentLevel = 1;
    let currentIndex = 0;
    let score = 0;
    let totalAsked = 0;
    let wrongList = [];
    let asked = [];          // 当前关卡已出题索引
    let levelScore = 0;      // 当前关卡得分

    /* ---------- DOM 引用 ---------- */
    const overlay   = document.getElementById('quizOverlay') || document.getElementById('challengeOverlay');
    const dialog    = overlay?.querySelector('.quiz-dialog') || overlay?.querySelector('.challenge-box');
    const progBar   = document.getElementById('quizProgressFill') || document.getElementById('challengeProgressFill');
    const progText  = document.getElementById('quizProgress') || document.getElementById('challengeProgress');
    const qText     = document.getElementById('quizQuestion') || document.getElementById('challengeQuestion');
    const optBox    = document.getElementById('quizOptions') || document.getElementById('challengeOptions');
    const scoreDisp = document.getElementById('quizScore') || document.getElementById('challengeScore');
    const reviewBox = document.getElementById('quizReview') || document.getElementById('challengeReview');
    const startBtn  = document.getElementById('quizStartBtn') || document.getElementById('challengeStartBtn');

    if (!overlay) {
      console.warn('[ExpShell] 未找到答题弹窗 DOM，答题系统未绑定');
      return;
    }

    /* ---------- 工具 ---------- */
    function saveProgress() {
      const data = { level: currentLevel, score, updated: new Date().toISOString() };
      localStorage.setItem(storageKey, JSON.stringify(data));
      // 同步 Supabase（静默）
      const user = localStorage.getItem('currentUser');
      if (user) {
        fetch(`${SUPABASE_URL}/rest/v1/users?username=eq.${encodeURIComponent(user)}`, {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ quiz_progress: { [storageKey]: data } }),
        }).catch(() => {});
      }
    }

    function loadProgress() {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const d = JSON.parse(raw);
          currentLevel = d.level || 1;
          score = d.score || 0;
        }
      } catch (_) {}
    }

    function pickQuestion() {
      // 当前关卡的题目范围
      const start = (currentLevel - 1) * perLevel;
      const end = Math.min(start + perLevel, questions.length);
      const pool = [];
      for (let i = start; i < end; i++) pool.push(i);
      // 过滤已问
      const avail = pool.filter(i => !asked.includes(i));
      if (!avail.length) return -1; // 本关题目已用完
      return avail[Math.floor(Math.random() * avail.length)];
    }

    function renderQuestion() {
      const qi = pickQuestion();
      if (qi === -1) {
        // 本关结束
        if (levelScore >= perLevel * 0.6) {
          // 及格，进入下一关
          currentLevel = Math.min(currentLevel + 1, levels);
          asked = [];
          levelScore = 0;
          if (currentLevel > levels) {
            finishAll();
            return;
          }
          renderQuestion();
        } else {
          // 不及格，重新开始本关
          asked = [];
          levelScore = 0;
          renderQuestion();
        }
        return;
      }

      asked.push(qi);
      totalAsked++;
      const q = questions[qi];

      if (qText) qText.textContent = `第 ${totalAsked} 题：${q.q}`;
      if (progBar) progBar.style.width = `${(asked.length / perLevel) * 100}%`;
      if (progText) progText.textContent = `第 ${currentLevel} 关 · ${asked.length}/${perLevel}`;

      if (optBox) {
        optBox.innerHTML = '';
        q.opts.forEach((opt, idx) => {
          const btn = document.createElement('button');
          btn.className = 'quiz-option';
          btn.textContent = `${String.fromCharCode(65 + idx)}. ${opt}`;
          btn.onclick = () => handleAnswer(idx, qi, btn);
          optBox.appendChild(btn);
        });
      }

      // 隐藏评分结果区
      const resultBox = document.getElementById('quizResult') || document.getElementById('challengeResult');
      if (resultBox) resultBox.style.display = 'none';
    }

    function handleAnswer(idx, qi, btnEl) {
      const q = questions[qi];
      const correct = idx === q.ans;

      // 禁用所有选项
      const allBtns = optBox.querySelectorAll('.quiz-option');
      allBtns.forEach(b => { b.disabled = true; });
      allBtns[q.ans].classList.add('correct');
      if (!correct) {
        btnEl.classList.add('wrong');
        wrongList.push({ qi, userAns: idx });
      } else {
        score++;
        levelScore++;
      }

      // 显示解释
      if (q.explain) {
        let explainEl = document.getElementById('quizExplain') || document.getElementById('challengeExplain');
        if (!explainEl) {
          explainEl = document.createElement('div');
          explainEl.id = 'quizExplain';
          explainEl.className = 'explain-box';
          optBox.parentNode.insertBefore(explainEl, optBox.nextSibling);
        }
        explainEl.innerHTML = `<div class="et">解析</div><div class="ex">${q.explain}</div>`;
        explainEl.style.display = 'block';
      }

      // 下一题 / 结束按钮
      let nextBtn = document.getElementById('quizNext') || document.getElementById('challengeNext');
      if (!nextBtn) {
        nextBtn = document.createElement('button');
        nextBtn.id = 'quizNext';
        nextBtn.className = 'quiz-primary-btn';
        nextBtn.style.marginTop = '12px';
        optBox.parentNode.appendChild(nextBtn);
      }
      const isLast = asked.length >= perLevel;
      nextBtn.textContent = isLast ? '查看结果' : '下一题';
      nextBtn.style.display = 'inline-block';
      nextBtn.onclick = () => {
        nextBtn.style.display = 'none';
        const explainEl = document.getElementById('quizExplain') || document.getElementById('challengeExplain');
        if (explainEl) explainEl.style.display = 'none';
        if (isLast) finishLevel();
        else renderQuestion();
      };
    }

    function finishLevel() {
      // 显示本关结果
      const pass = levelScore >= perLevel * 0.6;
      let resultEl = document.getElementById('quizResult') || document.getElementById('challengeResult');
      if (!resultEl) {
        resultEl = document.createElement('div');
        resultEl.id = 'quizResult';
        resultEl.style.cssText = 'margin-top:16px;text-align:center;';
        (optBox?.parentNode || dialog).appendChild(resultEl);
      }
      resultEl.innerHTML = `
        <h3 style="color:${pass ? '#22c55e' : '#ef4444'}">${pass ? '🎉 通关成功！' : '😅 未达及格线，再试一次'}</h3>
        <p>本关得分：${levelScore}/${perLevel}</p>
        <button class="quiz-primary-btn" onclick="location.reload()">继续</button>
      `;
      resultEl.style.display = 'block';
      saveProgress();
    }

    function finishAll() {
      overlay.style.display = 'flex';
      if (dialog) dialog.innerHTML = `
        <h2>🏆 全部通关！</h2>
        <p>总得分：<span class="quiz-score great">${score}</span> / ${questions.length}</p>
        <button class="quiz-primary-btn" onclick="location.reload()">再来一次</button>
      `;
      if (onComplete) onComplete(score);
      saveProgress();
    }

    /* ---------- 公开方法 ---------- */
    function open() {
      loadProgress();
      asked = [];
      levelScore = 0;
      totalAsked = 0;
      wrongList = [];
      overlay.style.display = 'flex';
      renderQuestion();
    }

    function close() {
      overlay.style.display = 'none';
    }

    // 绑定开始按钮
    if (startBtn) startBtn.onclick = open;

    // 点击遮罩关闭
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    return { open, close, saveProgress };
  }

  /* ========== Toast 提示 ========== */
  function showToast(msg, type = 'info', duration = 2500) {
    let toast = document.getElementById('expToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'expToast';
      toast.style.cssText = `
        position:fixed; top:20px; left:50%; transform:translateX(-50%);
        padding:10px 24px; border-radius:10px; font-size:0.9rem; font-weight:600;
        z-index:9999; transition:opacity .3s; pointer-events:none;
        box-shadow:0 4px 20px rgba(0,0,0,0.4);
      `;
      document.body.appendChild(toast);
    }
    const colors = {
      info: 'rgba(59,130,246,0.9)',
      success: 'rgba(34,197,94,0.9)',
      error: 'rgba(239,68,68,0.9)',
      warning: 'rgba(245,158,11,0.9)',
    };
    toast.style.background = colors[type] || colors.info;
    toast.textContent = msg;
    toast.style.opacity = '1';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, duration);
  }

  /* ========== 导出公共 API ========== */
  window.ExpShell = {
    getUsersFromTable,
    getCurrentUser,
    checkVip,
    initQuiz,
    showToast,
    /* 常量暴露 */
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
  };

  console.log('[ExpShell] 共享实验框架已加载');

})();
