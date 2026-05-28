-- ========== 微信登录：为 users 表添加字段 ==========
ALTER TABLE users ADD COLUMN IF NOT EXISTS openid TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS wechat_nickname TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS wechat_avatar TEXT DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_users_openid ON users (openid);
