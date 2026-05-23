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

    const res = await fetch(url, {
      method: opts.method || 'GET',
      headers: { ...SB.headers, ...opts.extraHeaders },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
    if (opts.method === 'DELETE' || (opts.method === 'PATCH' && !opts.extraHeaders?.Prefer?.includes('return=representation'))) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
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
};
