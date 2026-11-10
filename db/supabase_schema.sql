-- ============================================================
-- AI宠物识别系统 - Supabase 数据库 Schema
-- 版本: 2.0.0
-- 说明: 支持多主机、多用户、多局域网同步
-- ============================================================

-- 启用 UUID 扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -----------------------------------------------------------
-- 用户表
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(200) NOT NULL,
    nickname VARCHAR(100),
    role VARCHAR(20) DEFAULT 'user',
    status INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    last_login TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_username ON public.user(username);
CREATE INDEX IF NOT EXISTS idx_user_role ON public.user(role);

-- -----------------------------------------------------------
-- 识别记录表
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recognition_record (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES public.user(id),
    image_path VARCHAR(500),
    pet_category VARCHAR(50),
    breed VARCHAR(100),
    age_group VARCHAR(20),
    gender VARCHAR(20),
    emotion VARCHAR(50),
    confidence FLOAT DEFAULT 0,
    feeding_advice TEXT,
    disease_advice TEXT,
    emotion_advice TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_record_user_id ON public.recognition_record(user_id);
CREATE INDEX IF NOT EXISTS idx_record_category ON public.recognition_record(pet_category);
CREATE INDEX IF NOT EXISTS idx_record_breed ON public.recognition_record(breed);
CREATE INDEX IF NOT EXISTS idx_record_created_at ON public.recognition_record(created_at);

-- -----------------------------------------------------------
-- 系统配置表（供管理员配置参数）
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sys_config (
    id BIGSERIAL PRIMARY KEY,
    config_key VARCHAR(100) UNIQUE NOT NULL,
    config_value TEXT,
    description VARCHAR(500),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 初始化配置数据
INSERT INTO public.sys_config (config_key, config_value, description)
VALUES 
    ('system_version', '2.0.0', '系统版本号'),
    ('enable_camera', 'true', '是否启用摄像头'),
    ('max_upload_size', '10485760', '最大上传文件大小(字节)'),
    ('confidence_threshold', '0.3', '识别置信度阈值'),
    ('sync_interval', '300', '同步间隔(秒)')
ON CONFLICT (config_key) DO NOTHING;

-- -----------------------------------------------------------
-- 数据同步日志表（用于追踪多主机同步状态）
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sync_log (
    id BIGSERIAL PRIMARY KEY,
    host_id VARCHAR(100),
    sync_type VARCHAR(50),
    record_count INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'success',
    message TEXT,
    synced_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_log_host ON public.sync_log(host_id);
CREATE INDEX IF NOT EXISTS idx_sync_log_time ON public.sync_log(synced_at);

-- -----------------------------------------------------------
-- 访问日志表（用于安全审计）
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.access_log (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES public.user(id),
    action VARCHAR(50),
    detail TEXT,
    ip_address VARCHAR(50),
    user_agent VARCHAR(500),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_access_log_user ON public.access_log(user_id);
CREATE INDEX IF NOT EXISTS idx_access_log_action ON public.access_log(action);
CREATE INDEX IF NOT EXISTS idx_access_log_time ON public.access_log(created_at);

-- -----------------------------------------------------------
-- RLS 策略（行级安全）
-- -----------------------------------------------------------
ALTER TABLE public.user ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recognition_record ENABLE ROW LEVEL SECURITY;

-- 用户只能查看和修改自己的数据
CREATE POLICY "Users can view own data" 
    ON public.user FOR SELECT 
    USING (auth.uid() = id);

CREATE POLICY "Users can update own data" 
    ON public.user FOR UPDATE 
    USING (auth.uid() = id);

-- 识别记录只能由所有者访问
CREATE POLICY "Records are owner-only" 
    ON public.recognition_record FOR ALL 
    USING (user_id IN (SELECT id FROM public.user WHERE auth.uid() = id));