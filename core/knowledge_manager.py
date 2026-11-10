# -*- coding: utf-8 -*-
"""
knowledge_manager.py —— 知识库业务逻辑层
================================================================
职责：4 张知识库表（宠物基础信息/分龄喂食/疾病药品/情绪安抚）的增删改查

知识库表对照：
- pet_knowledge         宠物基础信息（品类、品种、描述）
- pet_diet              分龄喂食库（品类、年龄段、食物类型、频次、禁忌食物）
- pet_disease_medicine  疾病药品库（品类、病名、症状、药物、备注）
- pet_emotion_solution  情绪安抚库（品类、情绪、行为解读、安抚方案）
"""
from typing import List, Dict, Tuple

from db.database import get_db, KNOWLEDGE_TABLES, KNOWLEDGE_LABELS


class KnowledgeManager:
    """知识库管理器（单例）"""

    _instance = None

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if getattr(self, "_initialized", False):
            return
        self.db = get_db()
        self._initialized = True

    # 知识库表名列表
    TABLES = list(KNOWLEDGE_TABLES.keys())
    # 表中文标签
    LABELS = dict(KNOWLEDGE_LABELS)
    # 每张表的可写字段
    FIELDS = dict(KNOWLEDGE_TABLES)
    # 宠物类别选项
    PET_CATEGORIES = ["通用", "狗", "猫", "兔子", "仓鼠", "鹦鹉", "乌龟", "金鱼", "蜥蜴", "龙猫"]

    def list(self, table: str, pet_category: str = None,
             keyword: str = None, page: int = 1, page_size: int = 20) -> Tuple[List[Dict], int]:
        return self.db.list_knowledge(table, pet_category, keyword, page, page_size)

    def add(self, table: str, **kwargs) -> Tuple[bool, str]:
        self.db.add_knowledge(table, **kwargs)
        return True, "知识条目添加成功"

    def update(self, table: str, kid: int, **kwargs) -> Tuple[bool, str]:
        if not kid:
            return False, "条目 ID 无效"
        self.db.update_knowledge(table, kid, **kwargs)
        return True, "更新成功"

    def delete(self, table: str, kid: int) -> Tuple[bool, str]:
        self.db.delete_knowledge(table, kid)
        return True, "删除成功"

    def get_by_pet(self, table: str, pet_category: str) -> List[Dict]:
        return self.db.get_knowledge_by_pet(table, pet_category)
