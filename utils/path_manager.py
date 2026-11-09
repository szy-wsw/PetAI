# -*- coding: utf-8 -*-
"""
path_manager.py —— 全局路径统一管理工具类
================================================================
职责：
1. 自动检测D盘是否可用：有D盘优先用D:/PetAI_PetEmotionSystem/，没D盘自动降级到AppData目录
2. 程序启动时自动检测并递归创建所有缺失文件夹；
3. 提供全局唯一访问入口，业务层禁止硬编码任何路径；
4. 支持系统设置页修改子目录路径，并自动迁移已有文件；
5. 路径配置持久化保存，重启自动加载。

适配：Windows多用户、桌面软件exe打包、Web服务多机器访问（管理员可看全部用户）
"""
import os
import json
import shutil
import sys
from typing import Dict, Optional


def _default_root_dir() -> str:
    """
    自动选择最佳根目录：
    - 优先 D:/PetAI_Source（项目源码所在目录，已存在则直接使用）
    - 否则 AppData/Local/PetAI_Source
    """
    d_drive = "D:/PetAI_Source"
    # 项目目录已存在则直接使用，无需写入测试（避免权限问题导致回退到错误路径）
    if os.path.isdir(d_drive):
        return d_drive

    appdata = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA") or os.path.expanduser("~")
    return os.path.join(appdata, "PetAI_Source").replace("\\", "/")


class PathManager:
    """
    路径统一管理器（单例）

    使用方式：
        from utils.path_manager import PathManager
        pm = PathManager()
        pm.ensure_all_dirs()              # 启动时调用
        db_path = pm.get_path("db")       # 获取 db 子目录
        pm.get_file_path("model_weight", "best.pth")
    """

    _instance: Optional["PathManager"] = None

    DEFAULT_SUBDIRS: Dict[str, str] = {
        "model_weight": "model_weight",
        "db": "db",
        "temp_img": "temp_img",
        "build_output": "build_output",
        "user_cache": "user_cache",
    }

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self, force_root: Optional[str] = None):
        if getattr(self, "_initialized", False):
            return
        self.ROOT_DIR = (force_root or _default_root_dir()).replace("\\", "/")
        self._subdirs: Dict[str, str] = {}
        self._config_file = os.path.join(self.ROOT_DIR, "path_config.json").replace("\\", "/")
        self._load_config()
        self._initialized = True

    # ------------------------------------------------------------------
    # 配置
    # ------------------------------------------------------------------
    def _load_config(self):
        for key, sub in self.DEFAULT_SUBDIRS.items():
            self._subdirs[key] = os.path.join(self.ROOT_DIR, sub).replace("\\", "/")
        if os.path.exists(self._config_file):
            try:
                with open(self._config_file, "r", encoding="utf-8") as f:
                    custom = json.load(f)
                for key, path in custom.items():
                    if key in self._subdirs:
                        self._subdirs[key] = os.path.abspath(path).replace("\\", "/")
            except Exception:
                pass

    def _save_config(self):
        self.ensure_root()
        try:
            with open(self._config_file, "w", encoding="utf-8") as f:
                json.dump(self._subdirs, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

    # ------------------------------------------------------------------
    # 目录
    # ------------------------------------------------------------------
    def ensure_root(self):
        try:
            os.makedirs(self.ROOT_DIR, exist_ok=True)
        except Exception:
            pass

    def ensure_all_dirs(self) -> bool:
        self.ensure_root()
        ok = True
        for key, path in self._subdirs.items():
            try:
                os.makedirs(path, exist_ok=True)
            except Exception:
                ok = False
        self._save_config()
        return ok

    def check_dirs(self) -> Dict[str, bool]:
        return {key: os.path.isdir(path) for key, path in self._subdirs.items()}

    def repair_dir(self, key: str) -> bool:
        path = self._subdirs.get(key)
        if not path:
            return False
        try:
            os.makedirs(path, exist_ok=True)
            return True
        except Exception:
            return False

    # ------------------------------------------------------------------
    # 获取
    # ------------------------------------------------------------------
    def get_root(self) -> str:
        return self.ROOT_DIR

    def get_path(self, key: str) -> str:
        path = self._subdirs.get(key)
        if path is None:
            raise KeyError(f"未知子目录标识: {key}，可选: {list(self._subdirs.keys())}")
        if not os.path.isdir(path):
            try:
                os.makedirs(path, exist_ok=True)
            except Exception:
                pass
        return path

    def get_file_path(self, key: str, filename: str) -> str:
        return os.path.join(self.get_path(key), filename).replace("\\", "/")

    def get_all_paths(self) -> Dict[str, str]:
        return dict(self._subdirs)

    # ------------------------------------------------------------------
    # 修改
    # ------------------------------------------------------------------
    def update_path(self, key: str, new_path: str, migrate: bool = True) -> bool:
        if key not in self._subdirs:
            return False
        new_path = os.path.abspath(new_path).replace("\\", "/")
        old_path = self._subdirs[key]
        try:
            os.makedirs(new_path, exist_ok=True)
            if migrate and os.path.isdir(old_path) and old_path != new_path:
                for item in os.listdir(old_path):
                    src = os.path.join(old_path, item)
                    dst = os.path.join(new_path, item)
                    if os.path.isdir(src):
                        if not os.path.exists(dst):
                            shutil.move(src, dst)
                    else:
                        shutil.move(src, dst)
            self._subdirs[key] = new_path
            self._save_config()
            return True
        except Exception:
            return False

    def reset_to_default(self, key: str = None) -> bool:
        try:
            keys = [key] if key else list(self.DEFAULT_SUBDIRS.keys())
            for k in keys:
                default_path = os.path.join(self.ROOT_DIR, self.DEFAULT_SUBDIRS[k]).replace("\\", "/")
                self._subdirs[k] = default_path
                os.makedirs(default_path, exist_ok=True)
            self._save_config()
            return True
        except Exception:
            return False

    # ------------------------------------------------------------------
    # 缓存清理
    # ------------------------------------------------------------------
    def clear_temp_img(self) -> int:
        temp_dir = self.get_path("temp_img")
        count = 0
        try:
            for item in os.listdir(temp_dir):
                item_path = os.path.join(temp_dir, item)
                if os.path.isfile(item_path):
                    try:
                        os.remove(item_path)
                        count += 1
                    except Exception:
                        pass
                elif os.path.isdir(item_path):
                    try:
                        shutil.rmtree(item_path)
                        count += 1
                    except Exception:
                        pass
        except Exception:
            pass
        return count


def get_path_manager() -> PathManager:
    return PathManager()
