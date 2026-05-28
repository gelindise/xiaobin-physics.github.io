// ========== 友好的内容保护 ==========
// 仅在页面嵌入（而非直接访问）时发出温和提醒，不阻止正常使用
(function() {
  document.addEventListener('contextmenu', e => {
    // 仅在图片上阻止保存，但不阻止文本选择
    if (e.target.tagName === 'IMG') {
      e.preventDefault();
      console.log('💡 图片保存已禁用');
    }
  });
  console.log('%c🔬 物理虚拟实验平台', 'font-size:24px;font-weight:bold;color:#3b82f6');
  console.log('💡 如需学习和参考，欢迎在 GitHub 上联系我们');
})();
