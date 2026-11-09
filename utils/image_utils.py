# -*- coding: utf-8 -*-
"""
image_utils.py —— 底层图像处理工具
================================================================
职责：
1. OpenCV/Pillow 图片预处理（缩放、归一化、去噪）；
2. 低清图片自动过滤（分辨率过低拒绝识别）；
3. 图片临时缓存统一写入 D 盘 temp_img；
4. 识别结果可视化叠加。
"""
import os
import time
import uuid
from typing import Tuple, Optional

import cv2
import numpy as np
from PIL import Image

from utils.path_manager import get_path_manager


class ImageUtils:
    """图像处理工具类（静态方法，全局复用）"""

    # 最低允许分辨率（宽/高像素），低于此值视为低清图片
    MIN_RESOLUTION = 64

    @staticmethod
    def read_image(file_path: str) -> Optional[np.ndarray]:
        """
        读取图片为 OpenCV BGR ndarray
        路径不存在或损坏返回 None
        """
        if not os.path.isfile(file_path):
            return None
        # cv2.imread 不支持中文路径，用 numpy 中转
        try:
            stream = np.fromfile(file_path, dtype=np.uint8)
            img = cv2.imdecode(stream, cv2.IMREAD_COLOR)
            return img
        except Exception:
            return None

    @staticmethod
    def is_low_resolution(img: np.ndarray, min_res: int = None) -> bool:
        """判断图片分辨率是否过低"""
        if img is None:
            return True
        min_res = min_res or ImageUtils.MIN_RESOLUTION
        h, w = img.shape[:2]
        return h < min_res or w < min_res

    @staticmethod
    def preprocess_for_inference(img: np.ndarray, size: int = 224) -> np.ndarray:
        """
        识别前预处理：
        1. BGR -> RGB；
        2. Resize 到模型输入尺寸；
        3. 归一化到 [0,1]；
        4. 标准化（ImageNet 均值方差）。
        返回 CHW float32 ndarray
        """
        if img is None:
            return None
        # BGR -> RGB
        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        # Resize
        resized = cv2.resize(rgb, (size, size), interpolation=cv2.INTER_AREA)
        # 归一化
        arr = resized.astype(np.float32) / 255.0
        # 标准化（ImageNet）
        mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
        std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
        arr = (arr - mean) / std
        # HWC -> CHW
        arr = np.transpose(arr, (2, 0, 1))
        return arr

    @staticmethod
    def save_temp_image(img: np.ndarray, prefix: str = "img",
                        ext: str = ".jpg") -> str:
        """
        将图片保存到 D 盘 temp_img 临时目录
        :return: 保存后的绝对路径
        """
        pm = get_path_manager()
        temp_dir = pm.get_path("temp_img")
        filename = f"{prefix}_{int(time.time())}_{uuid.uuid4().hex[:6]}{ext}"
        save_path = os.path.join(temp_dir, filename).replace("\\", "/")
        try:
            if isinstance(img, np.ndarray):
                # OpenCV 保存（支持中文路径用 imencode）
                success, buf = cv2.imencode(ext, img)
                if success:
                    buf.tofile(save_path)
            return save_path
        except Exception:
            return ""

    @staticmethod
    def copy_to_temp(src_path: str, prefix: str = "upload") -> str:
        """复制上传图片到 temp_img 目录，返回新路径"""
        if not os.path.isfile(src_path):
            return ""
        pm = get_path_manager()
        temp_dir = pm.get_path("temp_img")
        ext = os.path.splitext(src_path)[1] or ".jpg"
        filename = f"{prefix}_{int(time.time())}_{uuid.uuid4().hex[:6]}{ext}"
        dst = os.path.join(temp_dir, filename).replace("\\", "/")
        try:
            # 用 PIL 复制，规避中文路径问题
            with Image.open(src_path) as im:
                im.save(dst)
            return dst
        except Exception:
            try:
                import shutil
                shutil.copyfile(src_path, dst)
                return dst
            except Exception:
                return ""

    @staticmethod
    def get_image_size(file_path: str) -> Tuple[int, int]:
        """获取图片宽高"""
        try:
            with Image.open(file_path) as im:
                return im.size
        except Exception:
            return (0, 0)

    @staticmethod
    def numpy_to_pil(img: np.ndarray) -> Image.Image:
        """OpenCV BGR ndarray 转 PIL Image"""
        if img is None:
            return None
        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        return Image.fromarray(rgb)
