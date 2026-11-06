# -*- coding: utf-8 -*-
"""
web_main.py —— 网页版启动入口
============================
用于在浏览器中预览界面效果，确认无误后再打包为桌面软件。
"""
import sys
import os

# 将当前目录添加到 Python 路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import flet as ft


def main(page: ft.Page):
    """网页版主入口"""
    from main import PetAIApp, bootstrap
    
    # 基础配置
    page.title = "PetAI 宠物智能识别系统 - 网页预览"
    page.window_width = 1400
    page.window_height = 900
    
    # 初始化
    pm, db, ok, msg = bootstrap()
    if not ok:
        page.add(ft.Text(f"初始化失败: {msg}", color=ft.Colors.RED))
        return
    
    # 启动应用
    app = PetAIApp(page)
    app.run()


if __name__ == "__main__":
    # 使用 Web 浏览器模式启动
    ft.run(
        main,
        view=ft.AppView.WEB_BROWSER,  # 网页模式
        port=8080,            # 端口号
        assets_dir="assets")
