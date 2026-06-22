-- Supabase RLS: 禁止 anon key 读取 password / session_token 列
-- 在 Supabase 面板 → Authentication → Policies 中执行

-- 启用 users 表的 RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- 策略 1：允许所有用户读取公开字段（username, vip, expire 等），但排除敏感字段
CREATE POLICY "允许读取公开字段"
  ON users
  FOR SELECT
  USING (true);

-- 注意：上面的策略允许读取所有行，但我们需要通过列级别权限来限制
-- 在 Supabase 中，列级别权限在 Table Editor 中设置：
-- 转到 Authentication → Policies → users 表 → 关闭 password 和 session_token 列的 public 读取权限

-- 或者更严格的方式：只允许通过 service_role（后端 API）读取敏感字段
-- 方案：移除默认的 public SELECT，改为只允许读取特定列
-- 但 Supabase 的 RLS 是行级别的，列级别需要在 API 设置中配置

-- 推荐的 Supabase 设置步骤：
-- 1. 打开 https://supabase.com 进入项目
-- 2. 转到 SQL Editor
-- 3. 运行以下 SQL:

/*
-- 删除默认的公开读取权限
REVOKE SELECT ON users FROM anon;
REVOKE SELECT ON users FROM authenticated;

-- 创建仅返回公开字段的视图（最安全的方案）
CREATE VIEW users_public AS
  SELECT username, vip, expire, email, created_at, last_seen
  FROM users;

-- 授予 anon 角色读取视图权限
GRANT SELECT ON users_public TO anon;
GRANT SELECT ON users_public TO authenticated;
*/

-- 如果不想创建视图，也可以通过 Supabase 的 Column Privileges 来限制：
-- Supabase Dashboard → Authentication → Policies → users 表
-- → 在 "Columns" 中取消勾选 password 和 session_token
