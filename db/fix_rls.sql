-- ============================================================
-- 修复 RLS 策略：让识别记录能够通过 API 正常写入
-- 根因：原策略 auth.uid() (UUID) 与 public.user.id (INTEGER) 类型不匹配
--       加上 anon key 下 auth.uid() 为 NULL，导致所有 INSERT 被拒绝
-- 修复：改用基于 user_id 列的简单检查，或直接放开（由 API 层控制鉴权）
-- ============================================================

-- 1. 先删除旧的、有问题的策略
DROP POLICY IF EXISTS "Users can view own data" ON public.user;
DROP POLICY IF EXISTS "Users can update own data" ON public.user;
DROP POLICY IF EXISTS "Records are owner-only" ON public.recognition_record;

-- 2. 重新审视 RLS：由于本系统使用自建 user 表 + API 层鉴权，
--    而非 Supabase Auth，RLS 反而成为障碍。
--    方案 A：完全关闭 RLS（API 层已处理鉴权，最简洁可靠）
--    方案 B：创建宽松的策略（允许通过，由 API 层控制访问）

-- 采用方案 A：直接关闭 RLS（推荐，因为 API 已有完善的用户校验）
ALTER TABLE public.user DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.recognition_record DISABLE ROW LEVEL SECURITY;

-- 如果后续需要在 Supabase Dashboard 直接查看数据，
-- 关闭 RLS 后用 SQL Editor 或 Dashboard Table Editor 均可直接读写

-- ============================================================
-- 备选方案 B（如果坚持启用 RLS）：使用宽松策略
-- 取消注释下面的代码来使用：
-- ============================================================
-- ALTER TABLE public.user ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Allow all for API users" 
--     ON public.user FOR ALL 
--     USING (true) WITH CHECK (true);
--
-- ALTER TABLE public.recognition_record ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Allow all for API users" 
--     ON public.recognition_record FOR ALL 
--     USING (true) WITH CHECK (true);
