// ========== 页面保护：防止源代码被轻易复制 ==========
(function() {
  // 防右键菜单
  document.addEventListener('contextmenu', e => e.preventDefault());

  // 防开发者工具快捷键
  document.addEventListener('keydown', e => {
    // F12
    if (e.key === 'F12') {
      e.preventDefault();
      return false;
    }
    // Ctrl+Shift+I / Ctrl+Shift+J / Ctrl+Shift+C
    if (e.ctrlKey && e.shiftKey && ['I','J','C'].includes(e.key.toUpperCase())) {
      e.preventDefault();
      return false;
    }
    // Ctrl+U (查看源代码)
    if (e.ctrlKey && e.key.toUpperCase() === 'U') {
      e.preventDefault();
      return false;
    }
  });

  // 检测开发者工具打开（通过窗口尺寸差异检测）
  let devtoolsOpen = false;
  function checkDevTools() {
    const threshold = 160;
    const widthDiff = window.outerWidth - window.innerWidth;
    const heightDiff = window.outerHeight - window.innerHeight;
    if (widthDiff > threshold || heightDiff > threshold) {
      if (!devtoolsOpen) {
        devtoolsOpen = true;
        document.title = '⚠️ 请关闭开发者工具';
        document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#0f172a;color:#ef4444;font-family:sans-serif;font-size:1.5rem;text-align:center;padding:2rem;">⚠️ 检测到开发者工具<br><span style="font-size:1rem;color:#94a3b8;margin-top:1rem;">请关闭后刷新页面继续使用</span></div>';
      }
    } else {
      devtoolsOpen = false;
    }
  }
  setInterval(checkDevTools, 1000);
})();
