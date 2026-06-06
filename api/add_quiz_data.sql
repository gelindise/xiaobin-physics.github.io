-- ============================================
-- 添加 quiz_data 列到 users 表
-- 用于存储用户答题挑战进度（服务端持久化）
-- ============================================
-- 使用方法：在 Supabase SQL Editor 中粘贴并运行此 SQL
-- 1. 打开 https://supabase.com/dashboard/project/ruledlbrdqhruotuaxwi
-- 2. 左侧菜单 → SQL Editor
-- 3. 新建查询 → 粘贴以下 SQL → 点击 Run
-- ============================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS quiz_data JSONB DEFAULT '{}'::jsonb;

-- 验证列已添加
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'users' AND column_name = 'quiz_data';
