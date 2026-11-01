// Browser client for the VIP-only circuit save API.
// No username is sent: the server resolves it from the bearer session token.
(function (global) {
  'use strict';

  function request(action, fields) {
    var token = '';
    try { token = localStorage.getItem('sessionToken') || ''; } catch (_) {}
    if (!token) {
      var authError = new Error('请先登录后使用电路云端存档');
      authError.code = 'auth_required';
      return Promise.reject(authError);
    }

    var payload = Object.assign({ action: action }, fields || {});
    return fetch('/api/circuit-saves', {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify(payload),
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) {
          var error = new Error(data.message || '云端存档请求失败');
          error.code = data.code || 'request_failed';
          error.status = response.status;
          throw error;
        }
        return data;
      });
    }).catch(function (error) {
      if (error && error.code) throw error;
      var networkError = new Error('网络连接失败，云端存档暂不可用');
      networkError.code = 'network_error';
      throw networkError;
    });
  }

  global.CircuitCloudSaves = {
    list: function () { return request('list'); },
    save: function (record) { return request('save', record); },
    rename: function (id, name) { return request('rename', { id: id, name: name }); },
    remove: function (id) { return request('delete', { id: id }); },
  };
})(window);
