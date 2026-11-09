# -*- coding: utf-8 -*-
"""
file_dialog.py —— 跨平台文件选择对话框（使用 PowerShell 系统原生对话框）
================================================================
避免 Flet 0.86.4 中 FilePicker 控件的 Unknown 渲染问题，
使用 Windows 系统原生 OpenFileDialog 实现文件选择。
"""
import os
import subprocess
import tempfile


def pick_image(title: str = "选择图片") -> str:
    """
    弹出系统原生文件选择对话框，选择图片文件
    :param title: 对话框标题
    :return: 选中文件的完整路径，取消则返回 None
    """
    filter_text = "图片文件 (*.jpg, *.jpeg, *.png, *.bmp)|*.jpg;*.jpeg;*.png;*.bmp|所有文件 (*.*)|*.*"
    return _open_file_dialog(title, filter_text)


def pick_avatar(title: str = "选择头像") -> str:
    """
    弹出系统原生文件选择对话框，选择头像文件
    :param title: 对话框标题
    :return: 选中文件的完整路径，取消则返回 None
    """
    filter_text = "图片文件 (*.jpg, *.jpeg, *.png)|*.jpg;*.jpeg;*.png|所有文件 (*.*)|*.*"
    return _open_file_dialog(title, filter_text)


def _open_file_dialog(title: str, filter_text: str) -> str:
    """
    核心实现：调用 PowerShell 显示 OpenFileDialog
    :param title: 对话框标题
    :param filter_text: 文件过滤器
    :return: 选中文件的完整路径，取消或失败返回 None
    """
    # 生成 PowerShell 脚本文件（避免命令行引号转义问题）
    script_content = f"""
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Filter = "{filter_text}"
$dialog.Title = "{title}"
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {{
    Write-Output $dialog.FileName
}}
"""

    # 写入临时脚本文件
    tmp_dir = tempfile.gettempdir()
    script_path = os.path.join(tmp_dir, "petai_file_dialog.ps1")
    try:
        with open(script_path, "w", encoding="utf-8") as f:
            f.write(script_content)

        # 执行 PowerShell 脚本
        result = subprocess.run(
            ["powershell", "-ExecutionPolicy", "Bypass", "-File", script_path],
            capture_output=True,
            text=True,
            timeout=60,
            creationflags=0x08000000,  # CREATE_NO_WINDOW
        )

        file_path = result.stdout.strip()
        if file_path and os.path.isfile(file_path):
            return file_path
        return None
    except subprocess.TimeoutExpired:
        print("[文件对话框] 超时")
        return None
    except Exception as e:
        print(f"[文件对话框] 错误: {e}")
        return None
    finally:
        # 清理临时脚本
        try:
            if os.path.exists(script_path):
                os.remove(script_path)
        except Exception:
            pass
