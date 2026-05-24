-- 为 users 表添加 last_seen 字段，用于统计在线人数
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ;
