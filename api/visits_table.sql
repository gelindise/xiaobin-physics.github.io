-- 网站访问量追踪表
-- 在 Supabase SQL Editor 中执行以下 SQL 创建表和索引

CREATE TABLE IF NOT EXISTS visits (
  id BIGSERIAL PRIMARY KEY,
  path TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 加速按日期查询
CREATE INDEX IF NOT EXISTS idx_visits_created_at ON visits (created_at);

-- RLS 策略：允许任何人写入（用于前端追踪），允许已认证用户读取
ALTER TABLE visits ENABLE ROW LEVEL SECURITY;

-- 允许所有人插入（anon 也可写入，用于页面访问追踪）
CREATE POLICY "allow_public_insert" ON visits
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

-- 允许所有人读取（用于管理后台查询）
CREATE POLICY "allow_public_select" ON visits
  FOR SELECT TO anon, authenticated
  USING (true);
