-- 运行方式: Supabase Dashboard → SQL Editor → 粘贴运行
-- 作用：禁止 anon key 通过 REST API 读取 password / session_token
-- 注意：proxy-user.js 使用 service_role key 不受影响

-- 1. 创建公开视图（只暴露非敏感字段）
CREATE OR REPLACE VIEW users_public AS
  SELECT username, vip, expire, email, created_at, last_seen
  FROM users;

-- 2. 允许 anon 角色查询公开视图
GRANT SELECT ON users_public TO anon;
GRANT SELECT ON users_public TO authenticated;

-- 3. 撤销 anon 对原始 users 表的 SELECT 权限
REVOKE SELECT ON users FROM anon;
REVOKE SELECT ON users FROM authenticated;

-- 4. 启用 RLS（确保行级安全，防止意外访问）
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
