// VIP-only cloud saves for the circuit sandbox.
// The browser sends only its session token; the account name and VIP status
// are always resolved and checked on the server.
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_SCENE_BYTES = 350 * 1024;
const MAX_COMPONENTS = 500;
const MAX_WIRES = 1000;
const LIST_PAGE_SIZE = 1000;
const TABLE = 'circuit_saves';

function reply(res, status, body) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  return res.status(status).json(body);
}

function svcHeaders(extra) {
  const headers = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
  };
  if (extra) Object.keys(extra).forEach((key) => { if (extra[key] != null) headers[key] = extra[key]; });
  return headers;
}

function sbUrl(path) {
  return SUPABASE_URL + '/rest/v1/' + path;
}

async function getRows(path) {
  const response = await fetch(sbUrl(path), { headers: svcHeaders({ Prefer: undefined }) });
  if (!response.ok) throw new Error('Supabase query failed (' + response.status + ')');
  return response.json();
}

async function listAllSaves(username) {
  const params = new URLSearchParams({
    username: 'eq.' + username,
    select: 'id,client_id,name,scene,created_at,updated_at',
    order: 'created_at.asc,id.asc',
  });
  const all = [];
  let offset = 0;
  while (true) {
    const response = await fetch(sbUrl(TABLE + '?' + params.toString()), {
      headers: svcHeaders({
        'Range-Unit': 'items',
        Range: offset + '-' + (offset + LIST_PAGE_SIZE - 1),
        Prefer: undefined,
      }),
    });
    if (response.status === 416) return all;
    if (!response.ok) throw new Error('Supabase list failed (' + response.status + ')');
    const rows = await response.json();
    if (!Array.isArray(rows) || !rows.length) return all;
    all.push.apply(all, rows);
    if (rows.length < LIST_PAGE_SIZE) return all;
    offset += rows.length;
  }
}

function bearerToken(req) {
  const headers = req.headers || {};
  const value = String(headers.authorization || headers.Authorization || '');
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match ? match[1].trim() : '';
}

function isActiveVip(user) {
  if (!user) return false;
  const vip = String(user.vip || '').trim();
  const expire = String(user.expire || '').trim();
  if (!vip || vip === '普通用户') return false;
  if (vip === '终身VIP' || expire === '永久') return true;
  if (!expire) return false;
  const expiry = new Date(expire).getTime();
  return Number.isFinite(expiry) && Date.now() <= expiry;
}

async function resolveSession(token) {
  if (!token || token.length > 256) return { error: 'auth_required' };

  let username = '';
  let sessionLastSeen = '';
  let sessionTableAvailable = false;
  try {
    const params = new URLSearchParams({ token: 'eq.' + token, select: 'username,last_seen', limit: '1' });
    const response = await fetch(sbUrl('user_sessions?' + params.toString()), {
      headers: svcHeaders({ Prefer: undefined }),
    });
    if (response.ok) {
      sessionTableAvailable = true;
      const rows = await response.json();
      if (rows && rows[0]) {
        username = String(rows[0].username || '');
        sessionLastSeen = String(rows[0].last_seen || '');
        const lastSeen = new Date(sessionLastSeen).getTime();
        if (!username || !Number.isFinite(lastSeen) || Date.now() - lastSeen > SESSION_TTL_MS) {
          return { error: 'session_expired' };
        }
      }
    }
  } catch (_) {
    // Fall through to the legacy single-session field below.
  }

  if (!username) {
    // Compatibility path for accounts whose user_sessions table is not yet
    // available, and for an old session token awaiting checkSession migration.
    const params = new URLSearchParams({ session_token: 'eq.' + token, select: 'username,last_seen', limit: '1' });
    const rows = await getRows('users?' + params.toString());
    if (rows && rows[0]) {
      username = String(rows[0].username || '');
      sessionLastSeen = String(rows[0].last_seen || '');
      const lastSeen = sessionLastSeen ? new Date(sessionLastSeen).getTime() : NaN;
      if (Number.isFinite(lastSeen) && Date.now() - lastSeen > SESSION_TTL_MS) {
        return { error: 'session_expired' };
      }
    }
  }

  if (!username) return { error: sessionTableAvailable ? 'session_invalid' : 'auth_required' };
  const userParams = new URLSearchParams({ username: 'eq.' + username, select: 'username,vip,expire', limit: '1' });
  const users = await getRows('users?' + userParams.toString());
  if (!users || !users[0]) return { error: 'session_invalid' };
  return { user: users[0] };
}

function cleanName(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, 24);
}

function validClientId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(value);
}

function validUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validateScene(scene) {
  if (!scene || typeof scene !== 'object' || Array.isArray(scene)) return '电路数据格式不正确';
  if (!Array.isArray(scene.comps) || !Array.isArray(scene.wires)) return '电路数据格式不正确';
  if (scene.comps.length > MAX_COMPONENTS || scene.wires.length > MAX_WIRES) return '电路元件或导线数量超出限制';
  for (let i = 0; i < scene.comps.length; i++) {
    const comp = scene.comps[i];
    if (!comp || typeof comp !== 'object' || Array.isArray(comp) || typeof comp.id !== 'string' ||
        typeof comp.type !== 'string' || !Number.isFinite(comp.x) || !Number.isFinite(comp.y)) {
      return '电路元件数据不完整';
    }
  }
  try {
    if (Buffer.byteLength(JSON.stringify(scene), 'utf8') > MAX_SCENE_BYTES) return '单份电路记录过大';
  } catch (_) {
    return '电路数据无法保存';
  }
  return '';
}

function parsePostgrestRows(text) {
  if (!text) return [];
  try {
    const rows = JSON.parse(text);
    return Array.isArray(rows) ? rows : (rows ? [rows] : []);
  } catch (_) {
    return [];
  }
}

function errorForAuth(error) {
  if (error === 'vip_required') return { status: 403, code: error, message: '电路存档仅对有效 VIP 会员开放' };
  if (error === 'session_expired' || error === 'session_invalid') return { status: 401, code: error, message: '登录状态已失效，请重新登录' };
  return { status: 401, code: 'auth_required', message: '请先登录后使用电路云端存档' };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(204).end();
  }
  if (req.method !== 'POST') return reply(res, 405, { code: 'method_not_allowed', message: '仅支持 POST' });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return reply(res, 503, { code: 'service_unavailable', message: '云端存档服务暂未配置，请稍后再试' });
  }

  try {
    const token = bearerToken(req);
    const session = await resolveSession(token);
    if (session.error) {
      const authError = errorForAuth(session.error);
      return reply(res, authError.status, { code: authError.code, message: authError.message });
    }
    if (!isActiveVip(session.user)) {
      return reply(res, 403, { code: 'vip_required', message: '电路存档仅对有效 VIP 会员开放' });
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const action = String(body.action || '');
    const username = String(session.user.username);

    if (action === 'list') {
      const rows = await listAllSaves(username);
      return reply(res, 200, { success: true, saves: rows || [] });
    }

    if (action === 'save') {
      const clientId = String(body.clientId || '');
      const name = cleanName(body.name);
      const scene = body.scene;
      if (!validClientId(clientId)) return reply(res, 400, { code: 'invalid_client_id', message: '存档标识无效，请刷新页面后重试' });
      if (!name) return reply(res, 400, { code: 'invalid_name', message: '存档名称不能为空' });
      const sceneError = validateScene(scene);
      if (sceneError) return reply(res, 400, { code: 'invalid_scene', message: sceneError });

      const params = new URLSearchParams({ on_conflict: 'username,client_id' });
      const response = await fetch(sbUrl(TABLE + '?' + params.toString()), {
        method: 'POST',
        headers: svcHeaders({ Prefer: 'resolution=merge-duplicates,return=representation' }),
        body: JSON.stringify({
          username: username,
          client_id: clientId,
          name: name,
          scene: scene,
          updated_at: new Date().toISOString(),
        }),
      });
      if (!response.ok) {
        console.error('[circuit-saves] save failed:', response.status, await response.text());
        return reply(res, 502, { code: 'save_failed', message: '云端保存失败，请稍后重试' });
      }
      const rows = parsePostgrestRows(await response.text());
      if (!rows[0]) return reply(res, 502, { code: 'save_failed', message: '云端未返回保存结果，请稍后重试' });
      return reply(res, 200, { success: true, save: rows[0] });
    }

    if (action === 'rename') {
      const id = String(body.id || '');
      const name = cleanName(body.name);
      if (!validUuid(id)) return reply(res, 400, { code: 'invalid_id', message: '存档标识无效' });
      if (!name) return reply(res, 400, { code: 'invalid_name', message: '存档名称不能为空' });
      const params = new URLSearchParams({ id: 'eq.' + id, username: 'eq.' + username });
      const response = await fetch(sbUrl(TABLE + '?' + params.toString()), {
        method: 'PATCH',
        headers: svcHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({ name: name, updated_at: new Date().toISOString() }),
      });
      if (!response.ok) {
        console.error('[circuit-saves] rename failed:', response.status, await response.text());
        return reply(res, 502, { code: 'rename_failed', message: '改名失败，请稍后重试' });
      }
      const rows = parsePostgrestRows(await response.text());
      if (!rows[0]) return reply(res, 404, { code: 'not_found', message: '存档不存在或已被删除' });
      return reply(res, 200, { success: true, save: rows[0] });
    }

    if (action === 'delete') {
      const id = String(body.id || '');
      if (!validUuid(id)) return reply(res, 400, { code: 'invalid_id', message: '存档标识无效' });
      const params = new URLSearchParams({ id: 'eq.' + id, username: 'eq.' + username });
      const response = await fetch(sbUrl(TABLE + '?' + params.toString()), {
        method: 'DELETE',
        headers: svcHeaders({ Prefer: 'return=representation' }),
      });
      if (!response.ok) {
        console.error('[circuit-saves] delete failed:', response.status, await response.text());
        return reply(res, 502, { code: 'delete_failed', message: '删除失败，请稍后重试' });
      }
      const rows = parsePostgrestRows(await response.text());
      if (!rows.length) return reply(res, 404, { code: 'not_found', message: '存档不存在或已被删除' });
      return reply(res, 200, { success: true });
    }

    return reply(res, 400, { code: 'unknown_action', message: '不支持的存档操作' });
  } catch (error) {
    console.error('[circuit-saves] request failed:', error && error.message ? error.message : error);
    return reply(res, 502, { code: 'backend_error', message: '云端存档暂时不可用，请稍后重试' });
  }
};
