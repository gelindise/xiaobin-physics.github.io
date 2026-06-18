// ========== Supabase 配置 ==========
const SUPABASE_URL = 'https://ruledlbrdqhruotuaxwi.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_0eFNMabL5IhHExao6wSE2A_nWbmMEKt';

const SB = {
  headers: {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  },

  async query(table, opts = {}) {
    let url = `${SUPABASE_URL}/rest/v1/${table}`;
    const params = new URLSearchParams();
    if (opts.select) params.set('select', opts.select);
    if (opts.filter) params.set(opts.filter.col, opts.filter.val);
    if (opts.order) params.set('order', opts.order);
    if (opts.limit) params.set('limit', opts.limit);
    const qs = params.toString();
    if (qs) url += '?' + qs;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    try {
      const res = await fetch(url, {
        method: opts.method || 'GET',
        headers: { ...SB.headers, ...opts.extraHeaders },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
      if (opts.method === 'DELETE' || (opts.method === 'PATCH' && !opts.extraHeaders?.Prefer?.includes('return=representation'))) return null;
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    } catch (e) {
      clearTimeout(timeout);
      if (e.name === 'AbortError') throw new Error('请求超时，请检查网络连接后重试');
      throw e;
    }
  },

  getUsers() {
    return SB.query('users', { select: '*' });
  },

  getUser(username) {
    return SB.query('users', { select: '*', filter: { col: 'username', val: `eq.${username}` } });
  },

  createUser(data) {
    return SB.query('users', { method: 'POST', body: data, extraHeaders: { Prefer: 'return=representation' } });
  },

  updateUser(username, data) {
    return SB.query('users', {
      method: 'PATCH',
      filter: { col: 'username', val: `eq.${username}` },
      body: data,
      extraHeaders: { Prefer: 'return=representation' },
    });
  },

  // ========== 激活码 ==========
  getActivationCode(code) {
    return SB.query('activation_codes', { select: '*', filter: { col: 'code', val: `eq.${code}` } });
  },

  getAllActivationCodes(filterStatus) {
    const opts = { select: '*', order: 'created_at.desc' };
    if (filterStatus && filterStatus !== 'all') {
      opts.filter = { col: 'status', val: `eq.${filterStatus}` };
    }
    return SB.query('activation_codes', opts);
  },

  createActivationCodes(codes) {
    return SB.query('activation_codes', { method: 'POST', body: codes });
  },

  updateActivationCode(id, data) {
    return SB.query('activation_codes', {
      method: 'PATCH',
      filter: { col: 'id', val: `eq.${id}` },
      body: data,
    });
  },
};
