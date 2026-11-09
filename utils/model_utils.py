# -*- coding: utf-8 -*-
"""
model_utils.py —— MobileNetV3-small 预训练模型加载与推理工具
================================================================
职责：
1. 定义多任务宠物识别模型结构（类别/品种/年龄/性别/情绪）；
2. 加载本地预训练权重 .pth 文件用于离线推理；
3. 仅支持推理，不包含任何训练逻辑。

说明：
- 基于 torchvision 预训练 MobileNetV3-small，轻量高效，适合 CPU；
- 权重文件存放在 D:/PetAI_PetEmotionSystem/model_weight/；
- torch 未安装时调用方应捕获 ImportError 降级为演示模式。
"""
from typing import Dict, List, Tuple

import torch
import torch.nn as nn
from torchvision import models


# 9 大类宠物类别（基础识别）
PET_CATEGORIES: List[str] = [
    "狗", "猫", "兔子", "仓鼠", "鹦鹉", "乌龟", "金鱼", "蜥蜴", "龙猫"
]

# 四分类任务标签
BREEDS: List[str] = ["纯种", "混种", "未知"]            # 品种
AGE_GROUPS: List[str] = ["幼年", "青年", "成年", "老年"]  # 年龄
GENDERS: List[str] = ["公", "母", "未知"]                # 性别
EMOTIONS: List[str] = ["开心", "平静", "紧张", "生病"]    # 情绪


class PetRecognitionModel(nn.Module):
    """
    多任务宠物识别模型（仅推理）
    - 任务1：9 大类宠物分类（共享骨干）
    - 任务2-5：品种/年龄/性别/情绪四分类（独立头）
    基于 MobileNetV3-small，轻量高效，适合 CPU
    """

    def __init__(self, num_categories: int = 9,
                 num_breeds: int = 3,
                 num_ages: int = 4,
                 num_genders: int = 3,
                 num_emotions: int = 4,
                 pretrained: bool = False,
                 freeze_backbone: bool = False):
        super().__init__()
        # 加载 MobileNetV3-small 骨干（推理时无需预训练权重，由 load_state_dict 覆盖）
        backbone = models.mobilenet_v3_small(weights=None)
        self.backbone = backbone.features
        # 共享池化与特征降维
        self.pool = nn.AdaptiveAvgPool2d(1)
        self.feature_dim = 576  # MobileNetV3-small 输出通道
        self.dropout = nn.Dropout(0.2)
        # 多任务分类头
        self.head_category = nn.Linear(self.feature_dim, num_categories)
        self.head_breed = nn.Linear(self.feature_dim, num_breeds)
        self.head_age = nn.Linear(self.feature_dim, num_ages)
        self.head_gender = nn.Linear(self.feature_dim, num_genders)
        self.head_emotion = nn.Linear(self.feature_dim, num_emotions)

    def forward(self, x: torch.Tensor) -> Dict[str, torch.Tensor]:
        """前向传播，返回各任务 logits 字典"""
        feat = self.backbone(x)
        feat = self.pool(feat).flatten(1)
        feat = self.dropout(feat)
        return {
            "category": self.head_category(feat),
            "breed": self.head_breed(feat),
            "age": self.head_age(feat),
            "gender": self.head_gender(feat),
            "emotion": self.head_emotion(feat),
        }

    def predict(self, x: torch.Tensor) -> Dict[str, Tuple[int, float]]:
        """
        推理：返回各任务预测类别索引与置信度
        :return: {"category": (idx, prob), ...}
        """
        self.eval()
        with torch.no_grad():
            logits = self.forward(x)
            results = {}
            for task, logit in logits.items():
                prob = torch.softmax(logit, dim=1)
                conf, idx = torch.max(prob, dim=1)
                results[task] = (idx.item(), conf.item())
            return results


def load_model(path: str, device: str = "cpu") -> Tuple[PetRecognitionModel, dict]:
    """
    加载预训练模型权重（仅推理用）
    :param path: .pth 权重文件路径
    :param device: 推理设备，默认 cpu
    :return: (模型, 元数据字典)
    """
    state = torch.load(path, map_location=device, weights_only=False)
    model = PetRecognitionModel(
        num_categories=len(state.get("categories", PET_CATEGORIES)),
        num_breeds=len(state.get("breeds", BREEDS)),
        num_ages=len(state.get("ages", AGE_GROUPS)),
        num_genders=len(state.get("genders", GENDERS)),
        num_emotions=len(state.get("emotions", EMOTIONS)),
        pretrained=False,
        freeze_backbone=False)
    model.load_state_dict(state["model_state"])
    model.to(device)
    model.eval()
    return model, state
