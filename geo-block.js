// Geo-block: block access from South Korea only
(function() {
  // Skip if already checked this session
  if (sessionStorage.getItem('geo_checked') === '1') return;
  if (sessionStorage.getItem('geo_blocked') === '1') {
    document.documentElement.innerHTML = '';
    showBlocked();
    return;
  }

  // Skip inside iframe (parent already checked)
  if (window !== window.top) return;

  var done = false;

  function showBlocked() {
    done = true;
    document.documentElement.innerHTML = '';
    document.write('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>访问受限</title><style>body{margin:0;background:#1a1a2e;display:flex;align-items:center;justify-content:center;height:100vh;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}div{text-align:center}h1{color:#e94560;font-size:2rem;margin-bottom:1rem}p{color:#aaa;margin:0.5rem 0}.sub{color:#666;font-size:0.85rem;margin-top:1rem}</style></head><body><div><h1>访问受限</h1><p>本站不向韩国地区提供服务</p><p class="sub">Access is not available in South Korea</p></div></body></html>');
    document.close();
  }

  function check(resp) {
    if (done) return;
    try {
      var data = JSON.parse(resp);
      if (data.country_code === 'KR') {
        sessionStorage.setItem('geo_blocked', '1');
        showBlocked();
      } else {
        sessionStorage.setItem('geo_checked', '1');
      }
    } catch(e) {}
  }

  var xhr = new XMLHttpRequest();
  xhr.timeout = 3000;
  xhr.onreadystatechange = function() {
    if (xhr.readyState === 4 && xhr.status === 200) check(xhr.responseText);
  };
  xhr.ontimeout = function() {};
  xhr.onerror = function() {};
  xhr.open('GET', 'https://ipapi.co/json/', true);
  xhr.send();
})();
