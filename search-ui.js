/* 知识点搜索 UI：首页 hero 搜索 + 实验列表页顶部下拉
 * 依赖：search-index.js、search-engine.js（window.PhysSearch）
 * 设计：一个查询 → 按知识点相关度排序的结果列表，显示「为什么相关」与相关度条。
 */
(function () {
  'use strict';
  if (!window.PhysSearch) return;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function metaOf(e) {
    return [e.g, e.c, e.s].filter(Boolean).join(' · ');
  }

  function levelClass(pct) {
    return pct >= 80 ? 'lv-strong' : pct >= 45 ? 'lv-mid' : 'lv-weak';
  }

  function openExperiment(url, locked) {
    if (!url) return;
    if (locked && typeof window.checkVip === 'function') { window.checkVip(url); return; }
    if (typeof window.openLab === 'function') { window.openLab(url); return; }
    window.location.href = url;
  }

  // ---------- 首页 ----------
  function initHome() {
    var input = document.getElementById('homeSearch');
    var overlay = document.getElementById('homeSearchOverlay');
    var body = document.getElementById('homeSearchResults');
    var title = document.getElementById('homeSearchTitle');
    var closeBtn = document.getElementById('homeSearchClose');
    if (!input || !overlay || !body) return;

    var timer = null;

    function openPanel() {
      overlay.hidden = false;
      document.body.style.overflow = 'hidden';
    }
    function closePanel() {
      overlay.hidden = true;
      document.body.style.overflow = '';
    }

    function render(q) {
      var r = window.PhysSearch.search(q, { limit: 14 });
      var understood = r.seeds.length ? r.seeds.slice(0, 3).join(' / ') : '';
      if (title) {
        title.innerHTML = r.items.length
          ? '找到 <span style="color:#38bdf8">' + r.items.length + '</span> 个相关实验'
            + '<small>' + (understood ? '理解为：' + esc(understood) : '按知识点相关度排序')
            + (r.fuzzy ? ' · 已按近似词匹配' : '') + '</small>'
          : '搜索结果';
      }
      if (!r.items.length) {
        var chips = window.PhysSearch.hot.slice(0, 6).map(function (h) {
          return '<button class="hs-chip" data-q="' + esc(h) + '">' + esc(h) + '</button>';
        }).join('');
        body.innerHTML = '<div class="hs-empty">'
          + '<div class="hs-empty-title">没有找到直接相关的实验</div>'
          + '<div class="hs-empty-sub">试试换成课本里的说法，或者从下面这些知识点进去看看</div>'
          + '<div class="hs-empty-chips">' + chips + '</div></div>';
        return;
      }
      body.innerHTML = r.items.map(function (x) {
        var e = x.e;
        var why = x.reasonText.map(function (t, i) {
          return '<span class="' + (t.indexOf('相关：') === 0 ? 'is-rel' : '') + '">' + esc(t) + '</span>';
        }).join('');
        return '<a class="sr-item" href="' + esc(e.u) + '" data-url="' + esc(e.u) + '" data-lock="' + (e.v ? 1 : 0) + '">'
          + '<span class="sr-icon">' + esc(e.i || '🔬') + '</span>'
          + '<div class="sr-main">'
          + '<div class="sr-title"><span class="sr-name">' + esc(e.t) + '</span>' + (e.v ? '<span class="sr-vip">VIP</span>' : '') + '</div>'
          + '<div class="sr-meta">' + esc(metaOf(e)) + '</div>'
          + (why ? '<div class="sr-why">' + why + '</div>' : '')
          + '</div>'
          + '<div class="sr-rel ' + levelClass(x.pct) + '">'
          + '<div class="sr-rel-num">' + x.pct + '<span>%</span></div>'
          + '<div class="sr-rel-bar"><i style="width:' + x.pct + '%"></i></div>'
          + '<div class="sr-rel-lv">' + esc(x.level) + '</div>'
          + '</div></a>';
      }).join('');
    }

    function run(open) {
      var q = input.value.trim();
      if (!q) { closePanel(); return; }
      if (open !== false) openPanel();
      render(q);
    }

    input.addEventListener('input', function () {
      clearTimeout(timer);
      var q = input.value.trim();
      if (!q) { closePanel(); return; }
      timer = setTimeout(function () { run(true); }, 180);
    });

    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); clearTimeout(timer); run(true); }
      if (ev.key === 'Escape') closePanel();
    });

    var btn = document.getElementById('homeSearchBtn');
    if (btn) btn.addEventListener('click', function () { run(true); });

    // 热门知识点 / 空结果建议
    document.addEventListener('click', function (ev) {
      var chip = ev.target.closest && ev.target.closest('.hs-chip');
      if (chip && chip.dataset.q) {
        input.value = chip.dataset.q;
        run(true);
      }
    });

    body.addEventListener('click', function (ev) {
      var item = ev.target.closest && ev.target.closest('.sr-item');
      if (!item) return;
      ev.preventDefault();
      closePanel();
      openExperiment(item.dataset.url, item.dataset.lock === '1');
    });

    if (closeBtn) closeBtn.addEventListener('click', closePanel);
    overlay.addEventListener('click', function (ev) {
      if (ev.target === overlay) closePanel();
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && !overlay.hidden) closePanel();
    });

    // 首页热门 chips（banner 里）
    document.querySelectorAll('[data-hs-hot]').forEach(function (el) {
      el.addEventListener('click', function () {
        input.value = el.getAttribute('data-hs-hot');
        run(true);
      });
    });
  }

  // ---------- 实验列表页：接管顶部下拉 ----------
  function initList() {
    var input = document.getElementById('experimentSearch');
    var dropdown = document.getElementById('searchDropdown');
    var resultsEl = document.getElementById('searchResults');
    var countEl = document.getElementById('searchCount');
    if (!input || !dropdown || !resultsEl) return;

    function render(q) {
      var r = window.PhysSearch.search(q, { limit: 8 });
      if (!r.items.length) {
        resultsEl.innerHTML = '<div class="search-results-empty">'
          + '没有找到直接相关的实验，试试「浮力」「欧姆定律」「凸透镜成像」这样的知识点</div>';
        countEl.textContent = '无匹配结果';
        countEl.style.color = '#ef4444';
        dropdown.style.display = 'block';
        return;
      }
      var understood = r.seeds.length ? ' · 理解：' + r.seeds.slice(0, 2).join(' / ') : '';
      countEl.textContent = '按相关度找到 ' + r.items.length + ' 个实验' + understood;
      countEl.style.color = 'var(--secondary)';
      resultsEl.innerHTML = r.items.map(function (x) {
        var e = x.e;
        var why = x.reasonText[0] || '';
        return '<div class="search-result-item" data-url="' + esc(e.u) + '" data-lock="' + (e.v ? 1 : 0) + '">'
          + '<span class="search-result-icon">' + esc(e.i || '🔬') + '</span>'
          + '<div class="search-result-info">'
          + '<div class="search-result-title">' + esc(e.t) + '</div>'
          + '<div class="search-result-meta">' + esc(metaOf(e)) + '</div>'
          + (why ? '<div class="sr-mini-why">' + esc(why) + '</div>' : '')
          + '</div>'
          + '<div class="sr-mini">'
          + '<div class="sr-mini-num">' + x.pct + '%</div>'
          + '<div class="sr-mini-bar"><i style="width:' + x.pct + '%"></i></div>'
          + '</div></div>';
      }).join('');
      dropdown.style.display = 'block';
    }

    resultsEl.addEventListener('click', function (ev) {
      var item = ev.target.closest && ev.target.closest('.search-result-item');
      if (!item) return;
      dropdown.style.display = 'none';
      openExperiment(item.dataset.url, item.dataset.lock === '1');
    });

    // 覆盖 script.js 里的旧 filterExperiments（只做关键词包含，没有排序）
    window.filterExperiments = function (query) {
      var q = String(query || '').trim();
      if (!q) { dropdown.style.display = 'none'; return; }
      render(q);
    };
  }

  function boot() {
    initHome();
    initList();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
