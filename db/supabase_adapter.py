# -*- coding: utf-8 -*-
"""
supabase_adapter.py —— Supabase 云端数据库适配器
================================================================
职责：
1. 根据本地配置文件连接 Supabase（PostgreSQL + REST API）；
2. 提供用户认证、识别记录、知识库的云上 CRUD；
3. 当 Supabase 不可用时，自动降级到本地 SQLite；
4. 支持多用户、多主机、不同局域网间的数据同步。

配置来源：
- 环境变量 SUPABASE_URL / SUPABASE_KEY
- 或本地文件 D:/PetAI_PetEmotionSystem/supabase_config.json
"""
import os
import json
from pathlib import Path
from typing import Dict, List, Optional, Any
from datetime import datetime

from utils.path_manager import get_path_manager


class SupabaseAdapter:
    """Supabase 适配器（可选启用）
    支持两种连接方式：
    1. 直连：默认 https://{project_id}.supabase.co
    2. Cloudflare Worker 代理：在配置中设置 cf_worker_endpoint，
       所有请求自动转发到 Worker，Worker 再反代到 supabase.co
       （大陆访问更快、防止暴露 supabase 域名）
    """

    def __init__(self):
        self._client = None
        self._url = ""
        self._key = ""
        self._cf_worker_endpoint = ""   # Cloudflare Worker 代理地址
        self._enabled = False
        self._fallback_local_path = "D:/PetAI_Source/data/petai.db"
        # 探测冷却：连续失败 N 次后，下一次探测至少等 _cooldown 秒
        self._consec_failures = 0
        self._cooldown_until = 0    # epoch seconds，冷却期内 is_ready 视为 False
        # 优先使用本代码库的路径（D:\PetAI_Source），兼容多开发目录
        runtime_root = Path(__file__).resolve().parents[1]
        code_root = str(runtime_root).replace("\\", "/")
        pm_root = str(get_path_manager().get_root()).replace("\\", "/")
        # 取两个路径中，先存在 db/local_config.json 的根；否则取代码库根
        selected_root = code_root
        if not os.path.exists(os.path.join(code_root, "db", "local_config.json")) \
                and os.path.exists(os.path.join(pm_root, "db", "local_config.json")):
            selected_root = pm_root
        root = selected_root
        # 1. 新位置：db/local_config.json
        self._config_file = os.path.join(root, "db", "local_config.json").replace("\\", "/")
        # 2. 兼容旧位置：supabase_config.json
        self._compat_config_file = os.path.join(root, "supabase_config.json").replace("\\", "/")
        # 3. .env.supabase（shell export 前需手动读）
        self._env_file = os.path.join(root, ".env.supabase").replace("\\", "/")
        self._load_env_file()
        self._load_config()

    # ------------------------------------------------------------------
    # .env 文件预加载（因为 os.environ 不会自动读 .env.supabase）
    # ------------------------------------------------------------------
    def _load_env_file(self):
        if not os.path.exists(self._env_file):
            return
        try:
            with open(self._env_file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, v = line.split("=", 1)
                    k = k.strip()
                    v = v.strip().strip('"').strip("'")
                    if k and v and not os.environ.get(k):
                        os.environ[k] = v
        except Exception:
            pass

    # ------------------------------------------------------------------
    # 配置管理
    # ------------------------------------------------------------------
    def _load_config(self):
        """加载 Supabase 配置（多来源，优先级：环境变量 > 旧配置 > 新配置 > 数据库模式）"""
        # 优先级1：环境变量
        self._url = (os.environ.get("SUPABASE_URL", "") or "").strip()
        self._key = (os.environ.get("SUPABASE_KEY", "") or "").strip()
        if not self._key:
            self._key = (os.environ.get("SUPABASE_ANON_KEY", "") or "").strip()
        # service_role key 可绕过 RLS，服务端推荐使用
        self._service_role_key = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "") or "").strip()
        self._cf_worker_endpoint = (os.environ.get("CF_WORKER_ENDPOINT", "") or "").strip()

        config_used = None
        cfg = None
        for path in [self._compat_config_file, self._config_file]:
            if os.path.exists(path):
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        cfg = json.load(f)
                    config_used = path
                    break
                except Exception:
                    continue

        if cfg:
            if not self._url:
                self._url = cfg.get("url", "").strip()
                if not self._url and cfg.get("project_id"):
                    pid = cfg.get("project_id")
                    self._url = f"https://{pid}.supabase.co"
            if not self._key:
                self._key = (cfg.get("key", "") or cfg.get("anon_key", "")).strip()
            if not self._service_role_key:
                self._service_role_key = (cfg.get("service_role_key", "") or "").strip()
            if not self._cf_worker_endpoint:
                proxy = cfg.get("cloudflare_proxy") or {}
                if isinstance(proxy, dict) and proxy.get("enabled"):
                    self._cf_worker_endpoint = (proxy.get("worker_endpoint") or "").strip()
            if cfg.get("fallback_db_path"):
                self._fallback_local_path = cfg["fallback_db_path"]

        # 如果没有 key，但有项目ID：仍然创建"待填 key"状态，UI 可让用户填
        self._enabled = bool(self._url and self._key)
        if self._enabled:
            self._init_client()

    def _build_requests_session_for_cf(self):
        """如果启用 CF Worker，返回一个自定义 Session 自动改 Host/Auth 头"""
        if not self._cf_worker_endpoint:
            return None
        try:
            import requests
            from urllib.parse import urlparse
            session = requests.Session()
            original_send = session.send

            cf_endpoint = self._cf_worker_endpoint.rstrip("/")
            supabase_host = urlparse(self._url).netloc
            original_scheme = urlparse(self._url).scheme

            def patched_send(request, **kwargs):
                # 将 supabase.co 的 URL 改写到 CF Worker，保留 path
                if supabase_host in request.url:
                    p = request.url.split(supabase_host, 1)[1]
                    request.url = cf_endpoint + p
                    # 让 Worker 知道真实 Host 与 Schema（Worker 逻辑需要取这些头）
                    request.headers["X-Forwarded-Host"] = supabase_host
                    request.headers["X-Forwarded-Proto"] = original_scheme
                return original_send(request, **kwargs)

            session.send = patched_send
            return session
        except Exception as e:
            print(f"[Supabase] CF 代理 Session 创建失败: {e}")
            return None

    def _init_client(self):
        """延迟初始化 Supabase 客户端（支持 Cloudflare Worker 代理）"""
        try:
            from supabase import create_client, Client
            # 服务端优先使用 service_role key（绕过 RLS，避免策略阻塞写入）
            effective_key = self._service_role_key or self._key
            options = {}
            cf_session = self._build_requests_session_for_cf()
            if cf_session is not None:
                options["session"] = cf_session
            if options:
                try:
                    self._client: Client = create_client(self._url, effective_key, **options)
                except TypeError:
                    print("[Supabase] 当前 supabase-py 不支持自定义 session，退回直连模式")
                    self._client: Client = create_client(self._url, effective_key)
            else:
                self._client: Client = create_client(self._url, effective_key)
            # 记录使用的 key 类型（方便调试）
            key_type = "service_role" if self._service_role_key else "anon"
            print(f"[Supabase] 客户端已初始化（使用 {key_type} key）")
            self._enabled = True
        except Exception as e:
            print(f"[Supabase] 客户端初始化失败: {e}")
            self._client = None
            self._enabled = False

    def save_config(self, url: str, key: str, cf_worker_endpoint: str = "") -> bool:
        """保存配置并重新初始化（保存到两个兼容位置）"""
        url = url.strip()
        key = key.strip()
        cf_worker_endpoint = (cf_worker_endpoint or "").strip()
        try:
            pm = get_path_manager()
            pm.ensure_root()
            cfg_data = {"url": url, "key": key}
            with open(self._compat_config_file, "w", encoding="utf-8") as f:
                json.dump(cfg_data, f, ensure_ascii=False, indent=2)

            # 合并更新 db/local_config.json（不覆盖其它字段）
            new_local = {"mode": "supabase", "database": "supabase",
                         "url": url, "key": key, "anon_key": key}
            if os.path.exists(self._config_file):
                try:
                    with open(self._config_file, "r", encoding="utf-8") as f:
                        cur = json.load(f)
                    cur.update(new_local)
                    if cf_worker_endpoint and isinstance(cur.get("cloudflare_proxy"), dict):
                        cur["cloudflare_proxy"]["worker_endpoint"] = cf_worker_endpoint
                        cur["cloudflare_proxy"]["enabled"] = True
                    new_local = cur
                except Exception:
                    pass
            with open(self._config_file, "w", encoding="utf-8") as f:
                json.dump(new_local, f, ensure_ascii=False, indent=2)

            self._url = url
            self._key = key
            self._cf_worker_endpoint = cf_worker_endpoint
            self._enabled = bool(url and key)
            if self._enabled:
                self._init_client()
            return self.is_ready()
        except Exception as e:
            print(f"[Supabase] 保存配置失败: {e}")
            return False

    def get_config(self) -> Dict[str, str]:
        """获取当前配置（不返回完整 key）"""
        masked_key = ""
        if self._key:
            masked_key = self._key[:8] + "..." + self._key[-4:]
        return {
            "url": self._url,
            "key_masked": masked_key,
            "enabled": self._enabled,
        }

    def is_ready(self) -> bool:
        return self._enabled and self._client is not None

    def test_connection(self) -> Dict[str, Any]:
        """测试 Supabase 连接（带冷却期，避免被网络层反复重置）"""
        import time as _t
        if not self.is_ready():
            return {"success": False, "message": "Supabase 未配置"}
        if _t.time() < self._cooldown_until:
            remain = int(self._cooldown_until - _t.time())
            return {"success": False, "message": f"冷却中（还剩 {remain}s）"}
        try:
            resp = self._client.table("user").select("id").limit(1).execute()
            self._consec_failures = 0
            return {"success": True, "message": "连接成功", "data": resp.data}
        except Exception as e:
            self._consec_failures += 1
            # 连续失败 3 次 → 冷却 10 分钟；之后每次再冷却 5 分钟
            if self._consec_failures >= 3:
                self._cooldown_until = _t.time() + (600 if self._consec_failures == 3 else 300)
            msg = str(e)[:120]
            return {"success": False, "message": f"连接失败（连续 {self._consec_failures} 次）: {msg}"}

    # ------------------------------------------------------------------
    # 用户相关
    # ------------------------------------------------------------------
    def get_user_by_username(self, username: str) -> Optional[Dict]:
        if not self.is_ready():
            return None
        try:
            resp = self._client.table("user").select("*").eq("username", username).limit(1).execute()
            data = resp.data
            return data[0] if data else None
        except Exception as e:
            print(f"[Supabase] 查询用户失败: {e}")
            return None

    def get_user_by_id(self, user_id: int) -> Optional[Dict]:
        if not self.is_ready():
            return None
        try:
            resp = self._client.table("user").select("*").eq("id", user_id).limit(1).execute()
            data = resp.data
            return data[0] if data else None
        except Exception as e:
            print(f"[Supabase] 查询用户失败: {e}")
            return None

    def create_user(self, username: str, password_hash: str, nickname: str, role: str = "user") -> Optional[int]:
        if not self.is_ready():
            return None
        try:
            now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            resp = self._client.table("user").insert({
                "username": username,
                "password": password_hash,
                "nickname": nickname or username,
                "role": role,
                "status": 1,
                "created_at": now,
                "updated_at": now,
            }).execute()
            data = resp.data
            return data[0]["id"] if data else None
        except Exception as e:
            print(f"[Supabase] 创建用户失败: {e}")
            return None

    def list_users(self) -> List[Dict]:
        if not self.is_ready():
            return []
        try:
            resp = self._client.table("user").select("*").order("id").execute()
            return resp.data or []
        except Exception as e:
            print(f"[Supabase] 列出用户失败: {e}")
            return []

    def update_user_status(self, user_id: int, status: int) -> bool:
        if not self.is_ready():
            return False
        try:
            self._client.table("user").update({"status": status}).eq("id", user_id).execute()
            return True
        except Exception as e:
            print(f"[Supabase] 更新用户状态失败: {e}")
            return False

    def delete_user(self, user_id: int) -> bool:
        if not self.is_ready():
            return False
        try:
            self._client.table("user").delete().eq("id", user_id).execute()
            return True
        except Exception as e:
            print(f"[Supabase] 删除用户失败: {e}")
            return False

    # ------------------------------------------------------------------
    # 识别记录
    # ------------------------------------------------------------------
    def add_record(self, record: Dict) -> Optional[int]:
        if not self.is_ready():
            print("[Supabase] add_record: 客户端未就绪")
            return None
        try:
            now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            payload = {
                "user_id": record.get("user_id"),
                "image_path": record.get("image_path", ""),
                "pet_category": record.get("pet_category", ""),
                "breed": record.get("breed", ""),
                "age_group": record.get("age_group", ""),
                "gender": record.get("gender", ""),
                "emotion": record.get("emotion", ""),
                "confidence": record.get("confidence", 0),
                "feeding_advice": record.get("feeding_advice", ""),
                "disease_advice": record.get("disease_advice", ""),
                "emotion_advice": record.get("emotion_advice", ""),
                # 补传旧记录时保留其原始创建时间，未提供则用当前时间
                "created_at": record.get("created_at") or now,
            }
            print(f"[Supabase] 准备写入 recognition_record: user_id={payload['user_id']}, pet={payload['pet_category']}")
            resp = self._client.table("recognition_record").insert(payload).execute()
            data = resp.data
            status_code = getattr(resp, 'status_code', None)
            if data and len(data) > 0:
                cloud_id = data[0].get("id")
                print(f"[Supabase] 写入成功: cloud_id={cloud_id}")
                return cloud_id
            else:
                print(f"[Supabase] 写入返回空数据: status={status_code}, response={resp}")
                return None
        except Exception as e:
            err_msg = str(e)
            print(f"[Supabase] 保存记录失败: {err_msg}")
            # RLS 错误特征检测
            if 'violates' in err_msg.lower() and 'row-level security' in err_msg.lower():
                print("[Supabase] ❌ 检测到 RLS 策略拦截！请运行 fix_rls.sql 修复 RLS 策略，")
                print("    或在 Supabase Dashboard → SQL Editor 执行:")
                print("    ALTER TABLE public.recognition_record DISABLE ROW LEVEL SECURITY;")
                print("    ALTER TABLE public.user DISABLE ROW LEVEL SECURITY;")
            if 'auth.uid' in err_msg.lower() or 'auth.users' in err_msg.lower():
                print("[Supabase] ❌ RLS 策略引用了 auth.uid() 但未使用 Supabase Auth 登录，导致写入失败。")
            return None

    def get_records_by_user(self, user_id: int, limit: int = 500) -> List[Dict]:
        if not self.is_ready():
            return []
        try:
            resp = self._client.table("recognition_record").select("*").eq("user_id", user_id).order("id", desc=True).limit(limit).execute()
            return resp.data or []
        except Exception as e:
            print(f"[Supabase] 查询用户记录失败: {e}")
            return []

    def get_all_records(self, limit: int = 2000) -> List[Dict]:
        if not self.is_ready():
            return []
        try:
            resp = self._client.table("recognition_record").select("*").order("id", desc=True).limit(limit).execute()
            return resp.data or []
        except Exception as e:
            print(f"[Supabase] 查询全部记录失败: {e}")
            return []

    def delete_record(self, record_id: int) -> bool:
        if not self.is_ready():
            return False
        try:
            self._client.table("recognition_record").delete().eq("id", record_id).execute()
            return True
        except Exception as e:
            print(f"[Supabase] 删除记录失败: {e}")
            return False

    def get_stats(self) -> Dict[str, int]:
        if not self.is_ready():
            return {"total": 0, "today": 0, "users": 0}
        try:
            today = datetime.now().strftime("%Y-%m-%d")
            total_resp = self._client.table("recognition_record").select("id", count="exact").execute()
            total = total_resp.count or 0
            today_resp = self._client.table("recognition_record").select("id", count="exact").like("created_at", f"{today}%").execute()
            today_count = today_resp.count or 0
            users_resp = self._client.table("user").select("id", count="exact").execute()
            users = users_resp.count or 0
            return {"total": total, "today": today_count, "users": users}
        except Exception as e:
            print(f"[Supabase] 统计失败: {e}")
            return {"total": 0, "today": 0, "users": 0}


# 全局单例
_supabase_adapter: Optional[SupabaseAdapter] = None


def get_supabase_adapter() -> SupabaseAdapter:
    global _supabase_adapter
    if _supabase_adapter is None:
        _supabase_adapter = SupabaseAdapter()
    return _supabase_adapter
