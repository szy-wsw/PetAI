# -*- coding: utf-8 -*-
"""
crypto.py —— 轻量级本地加密工具
================================================================
职责：用户密码本地加密存储（hashlib + 盐值）
说明：纯标准库实现，无外部依赖，适配离线桌面软件
"""
import hashlib
import secrets


def hash_password(password: str, salt: str = None) -> str:
    """
    加密密码：sha256(盐 + 密码)
    :param password: 明文密码
    :param salt: 盐值，None 则自动生成
    :return: "盐$哈希值" 格式字符串
    """
    if salt is None:
        salt = secrets.token_hex(8)
    hashed = hashlib.sha256((salt + password).encode("utf-8")).hexdigest()
    return f"{salt}${hashed}"


def verify_password(password: str, stored: str) -> bool:
    """
    校验密码
    :param password: 待校验明文
    :param stored: hash_password 返回的字符串
    """
    try:
        salt, hashed = stored.split("$", 1)
        test = hashlib.sha256((salt + password).encode("utf-8")).hexdigest()
        return secrets.compare_digest(test, hashed)
    except Exception:
        return False
