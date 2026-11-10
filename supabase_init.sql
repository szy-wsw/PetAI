-- ============================================================
-- PetAI 宠物智能识别系统 - Supabase 建表 SQL
-- 项目: zzbuenaawbzxazfvqiti (已修正)
-- 执行方式: Supabase SQL Editor 中粘贴执行
-- ============================================================

-- 1. 用户表
CREATE TABLE IF NOT EXISTS public.user (
    id BIGSERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    nickname TEXT,
    avatar TEXT,
    role TEXT DEFAULT 'user',
    status INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.user IS '用户表';
COMMENT ON COLUMN public.user.role IS 'admin=管理员, user=普通用户';

-- 2. 识别历史记录表
CREATE TABLE IF NOT EXISTS public.recognition_record (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES public.user(id) ON DELETE SET NULL,
    image_path TEXT NOT NULL,
    pet_category TEXT,
    breed TEXT,
    age_group TEXT,
    gender TEXT,
    emotion TEXT,
    confidence REAL,
    feeding_advice TEXT,
    disease_advice TEXT,
    emotion_advice TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recognition_record_user_id ON public.recognition_record(user_id);
CREATE INDEX IF NOT EXISTS idx_recognition_record_category ON public.recognition_record(pet_category);
CREATE INDEX IF NOT EXISTS idx_recognition_record_created ON public.recognition_record(created_at);

-- 3. 宠物基础信息表 (知识库)
CREATE TABLE IF NOT EXISTS public.pet_knowledge (
    id BIGSERIAL PRIMARY KEY,
    pet_category TEXT NOT NULL,
    breed TEXT,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pet_knowledge_category ON public.pet_knowledge(pet_category);
CREATE INDEX IF NOT EXISTS idx_pet_knowledge_breed ON public.pet_knowledge(breed);

-- 4. 分龄喂食库表
CREATE TABLE IF NOT EXISTS public.pet_diet (
    id BIGSERIAL PRIMARY KEY,
    pet_category TEXT NOT NULL,
    age_group TEXT,
    food_type TEXT,
    daily_frequency TEXT,
    forbidden_food TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pet_diet_category ON public.pet_diet(pet_category);

-- 5. 疾病药品库表
CREATE TABLE IF NOT EXISTS public.pet_disease_medicine (
    id BIGSERIAL PRIMARY KEY,
    pet_category TEXT NOT NULL,
    disease_name TEXT,
    symptom TEXT,
    medicine TEXT,
    remark TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pet_disease_category ON public.pet_disease_medicine(pet_category);
CREATE INDEX IF NOT EXISTS idx_pet_disease_name ON public.pet_disease_medicine(disease_name);

-- 6. 情绪安抚库表
CREATE TABLE IF NOT EXISTS public.pet_emotion_solution (
    id BIGSERIAL PRIMARY KEY,
    pet_category TEXT NOT NULL,
    emotion TEXT,
    behavior TEXT,
    solution TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pet_emotion_category ON public.pet_emotion_solution(pet_category);
CREATE INDEX IF NOT EXISTS idx_pet_emotion_emotion ON public.pet_emotion_solution(emotion);

-- ============================================================
-- 初始数据: 管理员账号
-- 密码 'admin123' 的 hash (使用本地 crypto 算法: salt$sha256, 与本地密码验证一致)
-- ============================================================
INSERT INTO public.user (username, password, nickname, role, status)
VALUES (
    'admin',
    '12dd6f073543db1a$f8c7e45332da6dd949195908222b25d0c644dd538b2459715ea63fcb5a00385f',
    '管理员',
    'admin',
    1
)
ON CONFLICT (username) DO NOTHING;

-- ============================================================
-- RLS 权限设置 (必需，否则 anon 用户无法操作表)
-- ============================================================
-- 1. 对所有 6 张表授予 anon 角色 CRUD 权限
GRANT ALL ON SCHEMA public TO anon;

-- user 表
ALTER TABLE IF EXISTS public."user" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."user" TO anon;
DROP POLICY IF EXISTS "user_all_policy" ON public."user";
CREATE POLICY "user_all_policy" ON public."user"
    FOR ALL USING (true) WITH CHECK (true);

-- recognition_record 表
ALTER TABLE IF EXISTS public.recognition_record ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recognition_record TO anon;
GRANT USAGE, SELECT ON SEQUENCE public.recognition_record_id_seq TO anon;
DROP POLICY IF EXISTS "recognition_record_all_policy" ON public.recognition_record;
CREATE POLICY "recognition_record_all_policy" ON public.recognition_record
    FOR ALL USING (true) WITH CHECK (true);

-- pet_knowledge 表
ALTER TABLE IF EXISTS public.pet_knowledge ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pet_knowledge TO anon;
GRANT USAGE, SELECT ON SEQUENCE public.pet_knowledge_id_seq TO anon;
DROP POLICY IF EXISTS "pet_knowledge_all_policy" ON public.pet_knowledge;
CREATE POLICY "pet_knowledge_all_policy" ON public.pet_knowledge
    FOR ALL USING (true) WITH CHECK (true);

-- pet_diet 表
ALTER TABLE IF EXISTS public.pet_diet ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pet_diet TO anon;
GRANT USAGE, SELECT ON SEQUENCE public.pet_diet_id_seq TO anon;
DROP POLICY IF EXISTS "pet_diet_all_policy" ON public.pet_diet;
CREATE POLICY "pet_diet_all_policy" ON public.pet_diet
    FOR ALL USING (true) WITH CHECK (true);

-- pet_disease_medicine 表
ALTER TABLE IF EXISTS public.pet_disease_medicine ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pet_disease_medicine TO anon;
GRANT USAGE, SELECT ON SEQUENCE public.pet_disease_medicine_id_seq TO anon;
DROP POLICY IF EXISTS "pet_disease_medicine_all_policy" ON public.pet_disease_medicine;
CREATE POLICY "pet_disease_medicine_all_policy" ON public.pet_disease_medicine
    FOR ALL USING (true) WITH CHECK (true);

-- pet_emotion_solution 表
ALTER TABLE IF EXISTS public.pet_emotion_solution ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pet_emotion_solution TO anon;
GRANT USAGE, SELECT ON SEQUENCE public.pet_emotion_solution_id_seq TO anon;
DROP POLICY IF EXISTS "pet_emotion_solution_all_policy" ON public.pet_emotion_solution;
CREATE POLICY "pet_emotion_solution_all_policy" ON public.pet_emotion_solution
    FOR ALL USING (true) WITH CHECK (true);

-- 授权 user 表 id 序列 (解决 INSERT 时 id 自增问题)
GRANT USAGE, SELECT ON SEQUENCE public.user_id_seq TO anon;

