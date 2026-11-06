'''
web_app.py —— Flask 网页版后端服务
================================================================
职责：
1. 提供网页版 UI，方便浏览器直接调试测试功能
2. 连接现有 Python 业务逻辑（识别、数据库、知识库等）
3. 提供 RESTful API 接口
4. 支持文件上传识别
'''

import os
import sys
import json
import re
import time
import uuid
import base64
import tempfile
import urllib.parse
from datetime import datetime
import requests
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
if getattr(sys, 'frozen', False):
    _bundle = getattr(sys, '_MEIPASS', os.path.dirname(sys.executable))
    _torch_home = os.path.join(_bundle, 'torch_home')
    if os.path.isdir(_torch_home):
        os.environ.setdefault('TORCH_HOME', _torch_home)
from flask import (Flask, render_template, request, jsonify, send_from_directory, session, redirect, url_for)
from werkzeug.utils import secure_filename
from utils.path_manager import get_path_manager
from db.database import (get_db, KNOWLEDGE_TABLES, KNOWLEDGE_LABELS)
from db.supabase_adapter import get_supabase_adapter
from core.user_manager import UserManager
from core.recognition_manager import RecognitionManager
from core.history_manager import HistoryManager
from core.knowledge_manager import KnowledgeManager
app = Flask(__name__)
app.secret_key = 'pet_ai_secret_key_2026'
app.config['MAX_CONTENT_LENGTH'] = 16777216
app.config['TEMPLATES_AUTO_RELOAD'] = True
app.jinja_env.auto_reload = True
pm = get_path_manager()
pm.ensure_all_dirs()
db = get_db()
db.init_db()
user_mgr = UserManager()
recognition_mgr = RecognitionManager()
history_mgr = HistoryManager()
knowledge_mgr = KnowledgeManager()
model_ok, model_msg = recognition_mgr.load_model()
print(f'[Web] 模型加载状态: {model_ok} - {model_msg}')
ALLOWED_EXTENSIONS = {'bmp', 'gif', 'jpg', 'png', 'jpeg', 'webp'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def get_current_user():
    '''从 session 获取当前用户信息'''

    user_id = session.get('user_id')
    if user_id == 0 or session.get('is_guest'):
        return {'id': 0, 'username': 'guest', 'nickname': '游客', 'role': 'guest', 'status': 1}
    if user_id is None:
        return
    user = db.get_user_by_id(user_id)
    return user

def require_login(f):
    '''登录校验装饰器 - 允许游客通过'''

    from functools import wraps
    @wraps(f)
    def decorated(*args, **kwargs):
        if not get_current_user():
            if request.is_json or request.path.startswith('/api/'):
                return jsonify({'success': False, 'message': '请先登录'}), 401
            return redirect(url_for('login_page'))
        return f(*args, **kwargs)

    return decorated

@app.route('/')
def index():
    '''首页 - 根据登录状态跳转'''

    user = get_current_user()
    if user:
        return redirect(url_for('home_page'))
    return redirect(url_for('login_page'))

@app.route('/login')
def login_page():
    '''登录页面'''

    if get_current_user():
        return redirect(url_for('home_page'))
    return render_template('login.html')

@app.route('/register')
def register_page():
    '''注册页面'''

    return render_template('register.html')

@app.route('/home')
@require_login
def home_page():
    '''主应用页面'''

    user = get_current_user()
    return render_template('index.html', user=user)

@app.route('/api/auth/login', methods=['POST'])
def api_login():
    '''用户登录'''

    data = request.get_json() or request.form
    username = data.get('username', '').strip()
    password = data.get('password', '')
    role = data.get('role', 'user')
    if not username or not password:
        return jsonify({'success': False, 'message': '用户名和密码不能为空'})
    user = db.verify_user(username, password)
    if not user:
        return jsonify({'success': False, 'message': '用户名或密码错误'})
    if role == 'admin' and user.get('role') != 'admin':
        return jsonify({'success': False, 'message': '该账号不是管理员'})
    if role == 'user' and user.get('role') == 'admin':
        pass
    session['user_id'] = user['id']
    session['role'] = user.get('role', 'user')
    return jsonify({'success': True, 'message': '登录成功', 'user': {'id': user['id'], 'username': user['username'], 'nickname': user.get('nickname', user['username']), 'role': user.get('role', 'user')}})

@app.route('/api/auth/register', methods=['POST'])
def api_register():
    '''用户注册'''

    data = request.get_json() or request.form
    username = data.get('username', '').strip()
    password = data.get('password', '')
    nickname = data.get('nickname', '').strip()
    role = data.get('role', 'user')
    if role == 'admin':
        return jsonify({'success': False, 'message': '管理员账号不可注册，请联系系统管理员'})
    ok, msg = user_mgr.register(username, password, nickname)
    if ok:
        return jsonify({'success': True, 'message': msg})
    return jsonify({'success': False, 'message': msg})

@app.route('/api/auth/logout', methods=['POST'])
def api_logout():
    '''退出登录'''

    session.clear()
    return jsonify({'success': True, 'message': '已退出登录'})

@app.route('/api/auth/guest', methods=['POST'])
def api_guest():
    '''游客登录'''

    guest_id = 0
    session['user_id'] = guest_id
    session['role'] = 'guest'
    session['is_guest'] = True
    return jsonify({'success': True, 'user': {'id': 0, 'username': 'guest', 'nickname': '游客', 'role': 'guest'}})

@app.route('/api/auth/me', methods=['GET'])
def api_me():
    '''获取当前用户信息'''

    user = get_current_user()
    if not user:
        if session.get('is_guest'):
            return jsonify({'success': True, 'user': {'id': 0, 'username': 'guest', 'nickname': '游客', 'role': 'guest'}})
        return jsonify({'success': False, 'message': '未登录'}), 401
    return jsonify({'success': True, 'user': {'id': user['id'], 'username': user['username'], 'nickname': user.get('nickname', user['username']), 'role': user.get('role', 'user'), 'status': user.get('status', 1)}})

@app.route('/api/recognize/upload', methods=['POST'])
def api_recognize_upload():
    '''上传图片并识别'''

    user = get_current_user()
    if not user and not session.get('is_guest'):
        return jsonify({'success': False, 'message': '请先登录'}), 401
    if not user or user.get('role') == 'guest':
        return jsonify({'success': False, 'message': '游客仅可浏览，登录后可使用识别功能'}), 403
    if 'file' not in request.files:
        return jsonify({'success': False, 'message': '未接收到文件'})
    file = request.files['file']
    if file.filename == '':
        return jsonify({'success': False, 'message': '未选择文件'})
    if not allowed_file(file.filename):
        return jsonify({'success': False, 'message': '仅支持 jpg/jpeg/png/gif/bmp/webp 格式'})
    ext = file.filename.rsplit('.', 1)[1].lower()
    tmp_fd, filepath = tempfile.mkstemp(suffix=f'.{ext}', prefix='petai_')
    os.close(tmp_fd)
    try:
        file.save(filepath)
    except Exception as e:
        try:
            os.remove(filepath)
        except Exception:
            pass
        return jsonify({'success': False, 'message': f'图片保存失败: {e}'})
    if user:
        user_mgr._current_user = user
        recognition_mgr.user_mgr._current_user = user
    try:
        result = recognition_mgr.recognize(filepath, save_record=False)
    finally:
        try:
            os.remove(filepath)
        except Exception:
            pass
    user_mgr._current_user = None
    recognition_mgr.user_mgr._current_user = None
    save_msg = ''
    if result.get('success'):
        user_id_save = user['id'] if user and user.get('role') != 'guest' else None
        db._last_cloud_error = None
        try:
            db.add_record(user_id=user_id_save, image_path='', pet_category=result.get('pet_category', ''), breed=result.get('breed', ''), age_group=result.get('age_group', ''), gender=result.get('gender', ''), emotion=result.get('emotion', ''), confidence=result.get('confidence', 0), feeding_advice=result.get('feeding_advice', ''), disease_advice=result.get('disease_advice', ''), emotion_advice=result.get('emotion_advice', ''))
            if getattr(db, '_last_cloud_error', None):
                save_msg = f'（已保存在本地，{db._last_cloud_error}）'
        except Exception as e:
            save_msg = f'（记录保存失败：{e}）'
    response = {'success': result.get('success', False), 'message': (result.get('message', '') + save_msg).strip(), 'image_path': '', 'preview_url': '', 'pet_category': result.get('pet_category', ''), 'breed': result.get('breed', ''), 'age_group': result.get('age_group', ''), 'gender': result.get('gender', ''), 'emotion': result.get('emotion', ''), 'confidence': result.get('confidence', 0), 'feeding_advice': result.get('feeding_advice', ''), 'disease_advice': result.get('disease_advice', ''), 'emotion_advice': result.get('emotion_advice', ''), 'health_status': result.get('health_status', {}), 'saved_locally': True, 'cloud_synced': not getattr(db, '_last_cloud_error', None)}
    return jsonify(response)

@app.route('/api/image/preview', methods=['GET'])
def api_image_preview():
    '''图片预览接口'''

    path = request.args.get('path', '')
    if not path or not os.path.isfile(path):
        return jsonify({'success': False, 'message': '图片不存在'}), 404
    with open(path, 'rb') as f:
        img_data = f.read()
    img_b64 = base64.b64encode(img_data).decode('utf-8')
    ext = os.path.splitext(path)[1].lstrip('.')
    mime = 'image/jpeg' if ext in ('jpg', 'jpeg') else f'image/{ext}'
    return jsonify({'success': True, 'mime_type': mime, 'base64': img_b64, 'size': len(img_data)})

@app.route('/api/history/list', methods=['GET'])
@app.route('/api/history', methods=['GET'])
def api_history_list():
    '''获取识别历史记录列表（双路径兼容）'''

    user = get_current_user()
    if not user and not session.get('is_guest'):
        return jsonify({'success': False, 'message': '请先登录'}), 401
    page = int(request.args.get('page', 1))
    page_size = int(request.args.get('page_size', 10))
    pet_category = request.args.get('pet_category', '') or None
    emotion = request.args.get('emotion', '') or None
    date_from = request.args.get('date_from', '') or None
    date_to = request.args.get('date_to', '') or None
    keyword = request.args.get('keyword', '') or None
    user_id = None
    if user and user.get('role') == 'admin':
        user_id = None
    else:
        if user and user.get('role') == 'guest':
            return jsonify({'success': False, 'message': '游客无权查看识别记录，请先注册登录', 'records': [], 'total': 0, 'page': page, 'page_size': page_size}), 403
        if user:
            user_id = user['id']
    try:
        records, total = history_mgr.list(user_id, page, page_size, pet_category, emotion, date_from, date_to, keyword)
    except Exception as e:
        return jsonify({'success': False, 'message': f'查询失败:{str(e)}', 'records': [], 'total': 0, 'page': page, 'page_size': page_size})
    DISPLAY_CAT_MAP = {'犬类': '犬类', '猫类': '猫类', '兔类': '兔类', '小型宠物': '啮齿/小型哺乳', '鸟类': '鸟类', '爬行类': '爬行类', '鱼类': '鱼类', '宠物甲虫': '宠物昆虫', '两栖类': '两栖类'}
    for rec in records:
        pet_cat = rec.get('pet_category', '')
        rec['display_category'] = DISPLAY_CAT_MAP.get(pet_cat, pet_cat)
        if rec.get('image_path') and os.path.isfile(rec['image_path']):
            try:
                with open(rec['image_path'], 'rb') as f:
                    img_data = f.read()
                rec['image_preview'] = base64.b64encode(img_data).decode('utf-8')
            except Exception:
                rec['image_preview'] = None
                continue
        else:
            rec['image_preview'] = None
    return jsonify({'success': True, 'records': records, 'total': total, 'page': page, 'page_size': page_size, 'total_pages': max(1, (total + page_size - 1) // page_size)})

@app.route('/api/history/detail/<int:record_id>', methods=['GET'])
def api_history_detail(record_id):
    '''获取单条记录详情'''

    user = get_current_user()
    if user and user.get('role') == 'guest':
        return jsonify({'success': False, 'message': '游客无权查看识别记录，请先注册登录'}), 403
    if not user:
        return jsonify({'success': False, 'message': '请先登录'}), 401
    detail = history_mgr.get_detail(record_id)
    if not detail:
        return jsonify({'success': False, 'message': '记录不存在'}), 404
    if user.get('role') == 'user' and detail.get('user_id') != user['id']:
        return jsonify({'success': False, 'message': '无权查看此记录'}), 403
    DISPLAY_CAT_MAP = {'犬类': '犬类', '猫类': '猫类', '兔类': '兔类', '小型宠物': '啮齿/小型哺乳', '鸟类': '鸟类', '爬行类': '爬行类', '鱼类': '鱼类', '宠物甲虫': '宠物昆虫', '两栖类': '两栖类'}
    pet_cat = detail.get('pet_category', '')
    detail['display_category'] = DISPLAY_CAT_MAP.get(pet_cat, pet_cat)
    return jsonify({'success': True, 'record': detail})

@app.route('/api/history/delete/<int:record_id>', methods=['POST'])
def api_history_delete(record_id):
    '''删除单条记录'''

    user = get_current_user()
    if user and user.get('role') == 'guest':
        return jsonify({'success': False, 'message': '游客无权删除记录，请先注册登录'}), 403
    if not user:
        return jsonify({'success': False, 'message': '请先登录'}), 401
    detail = history_mgr.get_detail(record_id)
    if not detail:
        return jsonify({'success': False, 'message': '记录不存在'}), 404
    if user.get('role') == 'user' and detail.get('user_id') != user['id']:
        return jsonify({'success': False, 'message': '无权删除此记录'}), 403
    history_mgr.delete(record_id)
    return jsonify({'success': True, 'message': '删除成功'})

@app.route('/api/history/clear', methods=['POST'])
def api_history_clear():
    '''清空历史记录'''

    user = get_current_user()
    if user and user.get('role') == 'guest':
        return jsonify({'success': False, 'message': '游客无权清空记录，请先注册登录'}), 403
    if not user:
        return jsonify({'success': False, 'message': '请先登录'}), 401
    user_id = None if user.get('role') == 'admin' else user['id']
    count = history_mgr.clear_all(user_id)
    return jsonify({'success': True, 'message': f'已清空 {count} 条记录'})

@app.route('/api/history/export/<int:record_id>', methods=['GET'])
def api_history_export(record_id):
    '''导出单条识别报告为文本'''

    user = get_current_user()
    if user and user.get('role') == 'guest':
        return jsonify({'success': False, 'message': '游客无权导出记录，请先注册登录'}), 403
    if not user:
        return jsonify({'success': False, 'message': '请先登录'}), 401
    detail = history_mgr.get_detail(record_id)
    if not detail:
        return jsonify({'success': False, 'message': '记录不存在'}), 404
    if user.get('role') == 'user' and detail.get('user_id') != user['id']:
        return jsonify({'success': False, 'message': '无权导出'}), 403
    lines = ['==================================================', '宠物智能识别报告 - ' + str(detail.get('created_at', '')), '==================================================', f'品类: {detail.get('pet_category', '')}', f'品种: {detail.get('breed', '')}', f'年龄: {detail.get('age_group', '')}', f'性别: {detail.get('gender', '')}', f'情绪: {detail.get('emotion', '')}', f'置信度: {round((detail.get('confidence') or 0) * 100, 1)}%', '', '[喂食推荐方案]', detail.get('feeding_advice', '暂无'), '', '[疾病用药参考]', detail.get('disease_advice', '暂无'), '', '[情绪安抚建议]', detail.get('emotion_advice', '暂无'), '==================================================', '宠物智能识别与情绪健康咨询系统  v1.0', '==================================================']
    return '\n'.join(lines), 200, {'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': f'attachment; filename=report_{record_id}.txt'}

@app.route('/api/history/image/<int:record_id>', methods=['GET'])
def api_history_image(record_id):
    user = get_current_user()
    if not user or user.get('role') == 'guest':
        return ('Forbidden', 403)
    detail = history_mgr.get_detail(record_id)
    if not detail or not detail.get('image_path'):
        return ('Not Found', 404)
    if user.get('role') == 'user' and detail.get('user_id') != user['id']:
        return ('Forbidden', 403)
    if not os.path.isfile(detail['image_path']):
        return ('Not Found', 404)
    return send_from_directory(os.path.dirname(detail['image_path']), os.path.basename(detail['image_path']))

@app.route('/api/knowledge/list', methods=['GET'])
def api_knowledge_list():
    '''获取知识库列表'''

    user = get_current_user()
    if not user and not session.get('is_guest'):
        return jsonify({'success': False, 'message': '请先登录'}), 401
    table = request.args.get('table', 'pet_knowledge')
    pet_category = request.args.get('pet_category', '') or None
    keyword = request.args.get('keyword', '') or None
    page = int(request.args.get('page', 1))
    page_size = int(request.args.get('page_size', 20))
    if table not in KNOWLEDGE_TABLES:
        return jsonify({'success': False, 'message': f'未知的知识库表: {table}'})
    records, total = knowledge_mgr.list(table, pet_category, keyword, page, page_size)
    return jsonify({'success': True, 'table': table, 'table_label': KNOWLEDGE_LABELS.get(table, table), 'records': records, 'total': total, 'page': page, 'page_size': page_size, 'total_pages': max(1, total // page_size)})

@app.route('/api/knowledge/add', methods=['POST'])
def api_knowledge_add():
    '''新增知识条目'''

    user = get_current_user()
    if not user:
        return jsonify({'success': False, 'message': '请先登录'}), 401
    if user.get('role') != 'admin':
        return jsonify({'success': False, 'message': '仅管理员可新增知识'}), 403
    data = request.get_json() or request.form
    table = data.get('table', 'pet_knowledge')
    if table not in KNOWLEDGE_TABLES:
        return jsonify({'success': False, 'message': f'未知的知识库表: {table}'})
    kwargs = {}
    for field in KNOWLEDGE_TABLES.get(table, []):
        val = data.get(field, '').strip()
        if val:
            kwargs[field] = val
    if not kwargs:
        return jsonify({'success': False, 'message': '请填写至少一个字段'})
    ok, msg = knowledge_mgr.add(table, **kwargs)
    return jsonify({'success': ok, 'message': msg})

@app.route('/api/knowledge/update', methods=['POST'])
def api_knowledge_update():
    '''更新知识条目'''

    user = get_current_user()
    if not user:
        return jsonify({'success': False, 'message': '请先登录'}), 401
    if user.get('role') != 'admin':
        return jsonify({'success': False, 'message': '仅管理员可编辑知识'}), 403
    data = request.get_json() or request.form
    table = data.get('table', 'pet_knowledge')
    kid = int(data.get('id', 0))
    if not kid:
        return jsonify({'success': False, 'message': '条目ID无效'})
    if table not in KNOWLEDGE_TABLES:
        return jsonify({'success': False, 'message': f'未知的知识库表: {table}'})
    kwargs = {}
    for field in KNOWLEDGE_TABLES.get(table, []):
        if field in data:
            kwargs[field] = data[field]
    ok, msg = knowledge_mgr.update(table, kid, **kwargs)
    return jsonify({'success': ok, 'message': msg})

@app.route('/api/knowledge/delete', methods=['POST'])
def api_knowledge_delete():
    '''删除知识条目'''

    user = get_current_user()
    if not user:
        return jsonify({'success': False, 'message': '请先登录'}), 401
    if user.get('role') != 'admin':
        return jsonify({'success': False, 'message': '仅管理员可删除知识'}), 403
    data = request.get_json() or request.form
    table = data.get('table', 'pet_knowledge')
    kid = int(data.get('id', 0))
    if not kid:
        return jsonify({'success': False, 'message': '条目ID无效'})
    ok, msg = knowledge_mgr.delete(table, kid)
    return jsonify({'success': ok, 'message': msg})

@app.route('/api/user/list', methods=['GET'])
def api_user_list():
    '''获取用户列表（管理员）'''

    user = get_current_user()
    if not user:
        return jsonify({'success': False, 'message': '请先登录'}), 401
    if user.get('role') != 'admin':
        return jsonify({'success': False, 'message': '仅管理员可查看用户列表'}), 403
    users = user_mgr.list_users()
    return jsonify({'success': True, 'users': users})

@app.route('/api/user/toggle_status', methods=['POST'])
def api_user_toggle_status():
    '''启用/禁用用户'''

    user = get_current_user()
    if not user:
        return jsonify({'success': False, 'message': '请先登录'}), 401
    if user.get('role') != 'admin':
        return jsonify({'success': False, 'message': '仅管理员可操作'}), 403
    data = request.get_json() or request.form
    user_id = int(data.get('user_id', 0))
    enable = data.get('enable', 'true').lower() == 'true'
    if user_id == user['id']:
        return jsonify({'success': False, 'message': '不能操作自己的账号状态'})
    ok = user_mgr.toggle_user_status(user_id, enable)
    if ok:
        return jsonify({'success': ok, 'message': '操作成功'})
    return jsonify({'success': False, 'message': '操作失败'})

@app.route('/api/user/delete', methods=['POST'])
def api_user_delete():
    '''删除用户'''

    user = get_current_user()
    if not user:
        return jsonify({'success': False, 'message': '请先登录'}), 401
    if user.get('role') != 'admin':
        return jsonify({'success': False, 'message': '仅管理员可操作'}), 403
    data = request.get_json() or request.form
    user_id = int(data.get('user_id', 0))
    if user_id == user['id']:
        return jsonify({'success': False, 'message': '不能删除自己'})
    ok = user_mgr.delete_user(user_id)
    if ok:
        return jsonify({'success': ok, 'message': '删除成功'})
    return jsonify({'success': False, 'message': '删除失败'})

@app.route('/api/user/update_profile', methods=['POST'])
def api_user_update_profile():
    '''更新个人资料'''

    user = get_current_user()
    if not user:
        return jsonify({'success': False, 'message': '请先登录'}), 401
    data = request.get_json() or request.form
    nickname = data.get('nickname', '').strip() or None
    password = data.get('password', '') or None
    ok, msg = user_mgr.update_profile(nickname=nickname, password=password)
    if ok:
        updated_user = db.get_user_by_id(user['id'])
        if updated_user:
            session['role'] = updated_user.get('role', 'user')
    return jsonify({'success': ok, 'message': msg})

@app.route('/api/settings/clear_temp', methods=['POST'])
def api_settings_clear_temp():
    '''清理临时图片'''

    user = get_current_user()
    if not user:
        return jsonify({'success': False, 'message': '请先登录'}), 401
    count = pm.clear_temp_img()
    return jsonify({'success': True, 'message': f'已清理 {count} 个临时文件'})

@app.route('/api/settings/model_status', methods=['GET'])
def api_settings_model_status():
    '''获取模型状态'''

    return jsonify({'success': True, 'model_ready': recognition_mgr.is_model_ready(), 'model_message': model_msg})

@app.route('/api/stats/dashboard', methods=['GET'])
def api_stats_dashboard():
    '''仪表盘总览统计'''

    user = get_current_user()
    if not user and not session.get('is_guest'):
        return jsonify({'success': False, 'message': '请先登录'}), 401
    user_id = None
    if user and user.get('role') == 'user':
        user_id = user['id']
    db = get_db()
    total = db.count_records(user_id)
    today = db.count_today_records(user_id)
    by_cat = {r['pet_category'] or '其他': r['count'] for r in db.count_by_category(user_id)}
    by_emo = {r['emotion'] or '其他': r['count'] for r in db.count_by_emotion(user_id)}
    rate = 100.0 if total > 0 else 0
    users = db.query_one('SELECT COUNT(*) c FROM user WHERE status=1')['c']
    trend = []
    from datetime import timedelta
    now = datetime.now()
    for i in range(6, -1, -1):
        d = (now - timedelta(days=i)).strftime('%Y-%m-%d')
        c = db.count_by_date(d, user_id)
        trend.append({'date': d[5:], 'count': c})
    return jsonify({'success': True, 'total': total, 'today': today, 'success_rate': rate, 'active_users': users, 'by_category': by_cat, 'by_emotion': by_emo, 'trend': trend})

@app.route('/api/stats/health_alerts', methods=['GET'])
def api_stats_alerts():
    '''健康预警统计 - 高危情绪(生病/焦虑)记录数等'''

    user = get_current_user()
    if not user and not session.get('is_guest'):
        return jsonify({'success': False, 'message': '请先登录'}), 401
    user_id = None
    if user and user.get('role') == 'user':
        user_id = user['id']
    db = get_db()
    emo_counts = {r['emotion']: r['count'] for r in db.count_by_emotion(user_id)}
    sick = emo_counts.get('生病', 0)
    anxiety = emo_counts.get('焦虑', 0)
    nervous = emo_counts.get('紧张', 0)
    total = db.count_records(user_id)
    alerts = []
    if sick > 0:
        alerts.append({'type': 'danger', 'icon': '💊', 'level': sick, 'text': f'检测到 {sick} 次生病情绪，建议及时就医'})
    if anxiety > 0:
        alerts.append({'type': 'warning', 'icon': '😰', 'level': anxiety, 'text': f'检测到 {anxiety} 次焦虑状态，注意情绪安抚'})
    if nervous > 0:
        alerts.append({'type': 'info', 'icon': '😓', 'level': nervous, 'text': f'检测到 {nervous} 次紧张表现，建议减少应激源'})
    return jsonify({'success': True, 'alerts': alerts, 'total': total, 'sick': sick, 'anxiety': anxiety, 'nervous': nervous})

@app.route('/api/help/faq', methods=['GET'])
def api_help_faq():
    return jsonify({'success': True, 'faq': [{'q': '如何获得更准确的识别结果？', 'a': '上传宠物正面清晰照片，光线充足，宠物面部可见，避免遮挡和模糊。建议单张图片只包含1只宠物。'}, {'q': '为什么识别结果显示『置信度较低』？', 'a': '当图片清晰度不足、角度过偏、光线不佳时，AI识别的置信度会下降。建议重新拍摄。'}, {'q': '喂食/疾病/情绪建议可以替代专业指导吗？', 'a': '不能。系统建议仅供日常养护参考，如宠物出现明显不适请立即联系专业兽医。'}, {'q': '游客为什么不能使用识别功能？', 'a': '游客仅可浏览系统功能、知识库和数据统计。注册登录后即可使用完整识别功能。'}, {'q': '识别记录会自动保存吗？', 'a': '会。登录用户每次识别成功后，结果自动保存到个人历史记录，可随时查看。'}, {'q': '识别数据会上传到外部服务器吗？', 'a': '不会。所有识别在本地服务器完成，数据保存在本地数据库，不会上传任何外部服务。'}]})

_OVERPASS_ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.openstreetmap.ru/api/interpreter', 'https://overpass.openstreetmap.ie/api/interpreter']

def _query_overpass(query: str) -> list:
    '''轮询多个 Overpass 端点，返回 OSM element 列表'''

    last_err = None
    headers = {'User-Agent': 'PetAI-System/1.0', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'}
    for ep in _OVERPASS_ENDPOINTS:
        try:
            r = requests.post(ep, data=query.encode('utf-8'), headers=headers, timeout=(8, 15))
            if r.status_code == 200:
                try:
                    data = r.json()
                except ValueError:
                    last_err = f'响应非 JSON: {r.text[:120]}'
                    continue
                return data.get('elements', []) or []
            last_err = f'HTTP {r.status_code}: {r.text[:200]}'
        except Exception as e:
            last_err = f'{type(e).__name__}: {str(e)[:120]}'
            continue
    raise RuntimeError(last_err or '所有 Overpass 端点均不可用')

def _load_map_config():
    '''从 local_config.json 读取地图配置'''

    try:
        cfg_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'db', 'local_config.json')
        if not os.path.exists(cfg_path):
            return {}
        with open(cfg_path, 'r', encoding='utf-8') as f:
            data = json.load(f) or {}
        maps = data.get('maps') or {}
    except Exception:
        return {}
    return {'default_map': maps.get('default_map') or 'amap', 'amap_web_key': (maps.get('amap_web_key') or '').strip(), 'amap_security_code': (maps.get('amap_security_code') or '').strip(), 'amap_web_service_key': (maps.get('amap_web_service_key') or '').strip(), 'baidu_map_ak': (maps.get('baidu_map_ak') or '').strip(), 'baidu_map_sk': (maps.get('baidu_map_sk') or '').strip(), 'tencent_map_key': (maps.get('tencent_map_key') or '').strip(), 'search_radius': int(maps.get('search_radius') or 10000), 'keywords': maps.get('keywords') or '宠物医院|宠物诊所|动物医院|动物诊所|兽医'}

@app.route('/api/maps/config', methods=['GET'])
def api_maps_config():
    '''返回前端地图 SDK 需要的 Key：高德地图 API（JS SDK + Web Service）'''

    cfg = _load_map_config()
    return jsonify({'success': True, 'default_map': 'amap', 'amap_web_key': cfg.get('amap_web_key', ''), 'amap_security_code': cfg.get('amap_security_code', ''), 'search_radius': cfg.get('search_radius', 10000), 'keywords': cfg.get('keywords', '宠物医院|宠物诊所|动物医院|动物诊所|兽医')})

def _amap_search_around(lat, lng, radius, keyword, key):
    '''高德 Web 服务：周边搜索 POI (高德 POI 覆盖全国到乡镇)
    文档: https://lbs.amap.com/api/webservice/guide/api/search
    '''

    url = 'https://restapi.amap.com/v3/place/around'
    params = {'key': key, 'location': f'{lng:.6f},{lat:.6f}', 'radius': max(500, min(int(radius), 50000)), 'keywords': keyword, 'offset': 50, 'page': 1, 'extensions': 'all', 'output': 'json', 'sortrule': 'distance'}
    r = requests.get(url, params=params, timeout=15)
    r.raise_for_status()
    data = r.json()
    if str(data.get('status')) != '1':
        raise RuntimeError(data.get('info') or '高德POI接口错误')
    pois = data.get('pois') or []
    out = []
    for p in pois:
        try:
            ll = p.get('location', '').split(',')
            p_lng, p_lat = float(ll[0]), float(ll[1])
        except Exception:
            continue
        name = (p.get('name') or '').strip()
        if not name:
            continue
        addr = (p.get('address') or p.get('pname') + p.get('cityname') + p.get('adname') + (p.get('address') or '')).strip()
        phone = (p.get('tel') or '').strip()
        biz_type = (p.get('type') or '').split(';')[-1] or '宠物医院'
        try:
            dist = int(p.get('distance') or 0)
        except Exception:
            dist = int(_haversine(lat, lng, p_lat, p_lng) * 1000)
        rating = 0.0
        rating_raw = p.get('biz_ext', {}) or {}
        try:
            rating = float(rating_raw.get('rating') or 0)
        except Exception:
            rating = 0.0
        tags = []
        for k, v in (('24小时营业', '24小时'), ('急诊', '急诊服务'), ('外科', '外科手术'), ('美容', '宠物美容'), ('寄养', '寄养服务')):
            if k not in name and k not in addr:
                if k in (p.get('business_area') or ''):
                    tags.append(v)
        type_zh = '宠物医院' if '医院' in name or biz_type and '医院' in biz_type else '宠物诊所'
        if not tags:
            tags = [type_zh]
        else:
            tags.insert(0, type_zh)
        out.append({'name': name, 'type': type_zh, 'address': addr or '地址详见地图', 'phone': phone or '暂无电话', 'hours': (rating_raw.get('open_time') or '').strip() or '营业时间请电话咨询', 'website': (p.get('website') or '').strip(), 'rating': round(rating if rating > 0 else 3.5, 1), 'distance_m': dist, 'distance_km': round(dist / 1000, 2), 'tags': tags[:5], 'services': tags, 'lat': p_lat, 'lng': p_lng, 'source': '高德地图', 'id': p.get('id') or ''})
        continue
    return out

def _baidu_search_around(lat, lng, radius, keyword, ak):
    '''百度 Web 服务：周边搜索 POI
    文档: https://lbsyun.baidu.com/index.php?title=webapi/guide/webservice-placeapi
    '''

    url = 'https://api.map.baidu.com/place/v2/search'
    params = {'ak': ak, 'query': keyword, 'location': f'{lat:.6f},{lng:.6f}', 'radius': max(500, min(int(radius), 50000)), 'output': 'json', 'scope': 2, 'page_size': 20, 'page_num': 0}
    r = requests.get(url, params=params, timeout=15)
    r.raise_for_status()
    data = r.json()
    if data.get('status') != 0:
        raise RuntimeError(data.get('message') or '百度POI接口错误')
    results = data.get('results') or []
    out = []
    for p in results:
        loc = p.get('location') or {}
        try:
            p_lat = float(loc.get('lat'))
            p_lng = float(loc.get('lng'))
        except Exception:
            continue
        name = (p.get('name') or '').strip()
        if not name:
            continue
        addr = (p.get('address') or '').strip()
        phone = (p.get('telephone') or '').strip()
        detail = p.get('detail_info') or {}
        try:
            rating = float(detail.get('overall_rating') or 0)
        except Exception:
            rating = 0.0
        dist = int(_haversine(lat, lng, p_lat, p_lng) * 1000)
        type_zh = '宠物医院' if '医院' in name else '宠物诊所'
        tags = [type_zh]
        out.append({'name': name, 'type': type_zh, 'address': addr or '地址详见地图', 'phone': phone or '暂无电话', 'hours': detail.get('shop_hours') or '营业时间请电话咨询', 'website': detail.get('detail_url') or '', 'rating': round(rating if rating > 0 else 3.5, 1), 'distance_m': dist, 'distance_km': round(dist / 1000, 2), 'tags': tags, 'services': tags, 'lat': p_lat, 'lng': p_lng, 'source': '百度地图', 'id': p.get('uid') or ''})
        continue
    return out

@app.route('/api/maps/poi/around', methods=['GET'])
def api_maps_poi_around():
    '''
    真实 POI 周边搜索：优先用高德/百度 Web Service，失败自动降级到 OSM
    参数: lat, lng, radius=10000, keyword=宠物医院, provider=auto|amap|baidu|osm
    返回统一的 hospitals 数组
    '''

    user = get_current_user()
    if not user and not session.get('is_guest'):
        return jsonify({'success': False, 'message': '请先登录'}), 401
    try:
        lat = float(request.args.get('lat', 0))
        lng = float(request.args.get('lng', 0))
    except (TypeError, ValueError):
        return jsonify({'success': False, 'message': '定位坐标无效'}), 400
    if -90 <= lat <= 90:
        if not -180 <= lng <= 180:
            return jsonify({'success': False, 'message': '定位坐标超出范围'}), 400
    cfg = _load_map_config()
    provider = (request.args.get('provider') or 'auto').strip().lower()
    radius = int(request.args.get('radius') or cfg.get('search_radius') or 10000)
    radius = max(500, min(radius, 50000))
    keyword = (request.args.get('keyword') or cfg.get('keywords') or '宠物医院|宠物诊所|动物医院|动物诊所|兽医').strip()
    all_results = []
    errors = []
    providers_try = []
    if provider == 'auto':
        providers_try = [('amap', cfg.get('amap_web_service_key'), _amap_search_around), ('baidu', cfg.get('baidu_map_ak'), _baidu_search_around)]
    elif provider in ('amap', 'amap_only'):
        providers_try = [('amap', cfg.get('amap_web_service_key'), _amap_search_around)]
    elif provider == 'baidu':
        providers_try = [('baidu', cfg.get('baidu_map_ak'), _baidu_search_around)]
    for pname, pkey, pfunc in providers_try:
        if not pkey:
            errors.append(f'{pname}: 未配置Key')
            continue
        try:
            res = pfunc(lat, lng, radius, keyword, pkey)
            all_results.extend(res)
            if res:
                break
        except Exception as e:
            errors.append(f'{pname}: {e}')
            continue
    dedup = {}
    for h in all_results:
        key = round(h['lat'], 4), round(h['lng'], 4)
        if key not in dedup or h.get('source') == '高德地图':
            dedup[key] = h
    all_results = list(dedup.values())
    if not all_results:
        try:
            from flask import Request
            q = f'\n            [out:json][timeout:25];\n            (\n              node["amenity"="vet"](around:{radius},{lat},{lng});\n              way["amenity"="vet"](around:{radius},{lat},{lng});\n              relation["amenity"="vet"](around:{radius},{lat},{lng});\n              node["healthcare"="veterinary"](around:{radius},{lat},{lng});\n            );\n            out body;\n            >;\n            out skel qt;\n            '
            elements = _query_overpass(q)
            nodes = {}
            for el in elements:
                if el.get('type') == 'node':
                    nodes[el.get('id')] = el
                elif el.get('type') == 'way':
                    nids = el.get('nodes', [])
                    if nids:
                        head = nodes.get(nids[0])
                        if head:
                            merged_tags = {**head.get('tags', {}), **el.get('tags', {})}
                            nodes[f'way_{el.get('id')}'] = {'id': el.get('id'), 'type': 'way', 'lat': head.get('lat'), 'lon': head.get('lon'), 'tags': merged_tags}
            for key, n in nodes.items():
                tags = n.get('tags', {}) or {}
                if tags.get('amenity') != 'vet' and tags.get('healthcare') != 'veterinary':
                    continue
                n_lat = n.get('lat')
                n_lng = n.get('lon')
                if n_lat is not None:
                    if n_lng is None:
                        continue
                name = (tags.get('name') or tags.get('name:zh') or '').strip()
                if not name:
                    place = tags.get('addr:city') or tags.get('addr:state') or tags.get('addr:suburb') or '附近'
                    name = f'{place}宠物兽医诊所'
                addr = ' '.join([v for v in (tags.get('addr:full'), tags.get('addr:city'), tags.get('addr:suburb'), tags.get('addr:road'), tags.get('addr:housenumber')) if v])
                dist = int(_haversine(lat, lng, n_lat, n_lng) * 1000)
                all_results.append({'name': name, 'type': '宠物诊所', 'address': addr or '地址详见地图', 'phone': (tags.get('phone') or tags.get('contact:phone') or '').strip() or '暂无电话', 'hours': (tags.get('opening_hours') or '').strip() or '营业时间请电话咨询', 'website': (tags.get('website') or '').strip(), 'rating': 4.0, 'distance_m': dist, 'distance_km': round(dist / 1000, 2), 'tags': ['宠物诊所'], 'services': ['宠物诊所'], 'lat': n_lat, 'lng': n_lng, 'source': 'OpenStreetMap'})
                continue
        except Exception as e:
            errors.append(f'osm: {e}')
    all_results.sort(key=(lambda h: h['distance_m']))
    if keyword and '|' not in keyword:
        all_results = [h for h in all_results if keyword.lower() in f'{h['name']} {h['address']}'.lower()]
    return jsonify({'success': True, 'hospitals': all_results, 'total': len(all_results), 'query_point': {'lat': lat, 'lng': lng, 'radius': radius}, 'provider_used': all_results[0]['source'] if all_results else 'none', 'errors': errors})

def _haversine(lat1, lon1, lat2, lon2):
    import math
    R = 6371
    dLat = math.radians(lat2 - lat1)
    dLon = math.radians(lon2 - lon1)
    a = math.sin(dLat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dLon / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

@app.route('/api/hospital/nearby', methods=['GET'])
def api_hospital_nearby():
    '''
    查询附近宠物医院 / 宠物诊所 / 兽医站
    优先高德地图 Web 服务（国内覆盖好、稳定），失败自动降级 Overpass（海外兜底）
    参数: lat, lng, radius(米,默认5000), keyword(可选,关键字二次过滤)
    '''

    user = get_current_user()
    if not user and not session.get('is_guest'):
        return jsonify({'success': False, 'message': '请先登录'}), 401
    try:
        lat = float(request.args.get('lat', 0))
        lng = float(request.args.get('lng', 0))
    except (TypeError, ValueError):
        return jsonify({'success': False, 'message': '定位坐标无效'}), 400
    if -90 <= lat <= 90:
        if not -180 <= lng <= 180:
            return jsonify({'success': False, 'message': '定位坐标超出范围'}), 400
    radius = int(request.args.get('radius', 5000) or 5000)
    keyword = (request.args.get('keyword') or '').strip() or ''
    radius = max(500, min(radius, 30000))
    cfg = _load_map_config()
    amap_key = cfg.get('amap_web_service_key') or ''
    if amap_key:
        try:
            amap_results = _amap_search_around(lat, lng, radius, keyword or '宠物医院', amap_key)
            if amap_results:
                hospitals = []
                for poi in amap_results:
                    hospitals.append({'name': poi.get('name', '') or '宠物医院', 'lat': poi.get('lat', 0), 'lng': poi.get('lng', 0), 'address': poi.get('address') or '地址详见地图', 'phone': poi.get('phone') or '', 'distance_m': poi.get('distance_m', 0), 'type_zh': '宠物医院' if '医院' in poi.get('name', '') else '宠物诊所', 'open_url': '', 'source': '高德地图'})
                hospitals.sort(key=(lambda h: h.get('distance_m', 0)))
                return jsonify({'success': True, 'message': 'ok', 'hospitals': hospitals, 'total': len(hospitals), 'radius': radius, 'lat': lat, 'lng': lng, 'keyword': keyword})
        except Exception as e:
            print(f'[地图] 高德 POI 查询失败，降级 Overpass: {e}')
    query = f'\n    [out:json][timeout:15];\n    (\n      node["amenity"="vet"](around:{radius},{lat},{lng});\n      way["amenity"="vet"](around:{radius},{lat},{lng});\n      relation["amenity"="vet"](around:{radius},{lat},{lng});\n      node["healthcare"="veterinary"](around:{radius},{lat},{lng});\n    );\n    out body center 10;\n    '
    try:
        elements = _query_overpass(query)
    except Exception as e:
        return jsonify({'success': False, 'message': f'在线查询失败（{e}），请稍后重试或使用地图跳转按钮', 'hospitals': []})
    nodes = {}
    for el in elements:
        if el.get('type') == 'node':
            nodes[el.get('id')] = el
        elif el.get('type') == 'way':
            nids = el.get('nodes', [])
            if nids:
                head = nodes.get(nids[0])
                if head:
                    merged_tags = {**head.get('tags', {}), **el.get('tags', {})}
                    nodes[f'way_{el.get('id')}'] = {'id': el.get('id'), 'type': 'way', 'lat': head.get('lat'), 'lon': head.get('lon'), 'tags': merged_tags}
    hospitals = []
    for key, n in nodes.items():
        tags = n.get('tags', {}) or {}
        if tags.get('amenity') != 'vet' and tags.get('healthcare') != 'veterinary':
            continue
        n_lat = n.get('lat')
        n_lng = n.get('lon')
        if n_lat is not None:
            if n_lng is None:
                continue
        name = (tags.get('name') or tags.get('name:zh') or tags.get('brand') or '').strip()
        if not name:
            place = tags.get('addr:city') or tags.get('addr:state') or tags.get('addr:suburb') or '附近'
            name = f'{place}宠物兽医诊所'
        address_parts = []
        for k in ('addr:full', 'addr:district', 'addr:city', 'addr:suburb', 'addr:road', 'addr:street', 'addr:housenumber'):
            v = tags.get(k)
            if not v:
                continue
            if v not in address_parts:
                address_parts.append(v)
        address = ' '.join(address_parts) if address_parts else '地址详见地图'
        phone = (tags.get('phone') or tags.get('contact:phone') or tags.get('mobile') or '').strip()
        hours = (tags.get('opening_hours') or '').strip()
        website = (tags.get('website') or tags.get('contact:website') or '').strip()
        services = []
        for s in ('surgery', 'emergency', '24/7', 'grooming', 'boarding', 'pharmacy'):
            if tags.get(s) in ('yes', 'only') or '24/7' in hours:
                zh = {'surgery': '外科手术', 'emergency': '急诊', '24/7': '24小时', 'grooming': '美容', 'boarding': '寄养', 'pharmacy': '药房'}.get(s, s)
                if zh not in services:
                    services.append(zh)
        type_zh = '宠物医院' if 'surgery' in (tags.get('surgery'), tags.get('emergency')) or 'hospital' in name.lower() or '医院' in name else '宠物诊所'
        if tags.get('emergency') == 'yes' or '24/7' in hours:
            services.insert(0, type_zh)
        else:
            services.insert(0, type_zh)
        feature_score = sum([bool(phone), bool(hours), bool(website), len(services) > 2, len(address_parts) > 2])
        rating = round(3.5 + feature_score * 0.25, 1)
        rating = min(rating, 5.0)
        distance_m = _haversine(lat, lng, n_lat, n_lng) * 1000
        distance_km = round(distance_m / 1000, 2)
        if distance_m > radius * 1.5:
            continue
        if keyword:
            haystack = ' '.join([name, address, phone, ' '.join(services), type_zh]).lower()
            if keyword.lower() not in haystack:
                continue
        hospitals.append({'name': name, 'type': type_zh, 'address': address, 'phone': phone or '暂无电话', 'hours': hours or '营业时间请电话咨询', 'website': website, 'rating': rating, 'distance_m': round(distance_m), 'distance_km': distance_km, 'tags': services[:5], 'services': services, 'lat': n_lat, 'lng': n_lng, 'source': 'OpenStreetMap'})
        continue
    hospitals.sort(key=(lambda h: h['distance_m']))
    return jsonify({'success': True, 'hospitals': hospitals, 'total': len(hospitals), 'query_point': {'lat': lat, 'lng': lng, 'radius': radius}})

@app.route('/api/hospital/open_url', methods=['POST'])
def api_hospital_open_url():
    '''生成高德/百度/腾讯地图跳转 URL（直接跳转页面也可使用）'''

    body = request.get_json(silent=True) or request.args
    lat = body.get('lat')
    lng = body.get('lng')
    name = body.get('name', '宠物医院')
    keyword = body.get('keyword', '宠物医院')
    if lat is None or lng is None:
        return jsonify({'success': False, 'message': '缺少坐标'}), 400
    urls = {'amap': f'https://www.amap.com/search?keyword={urllib.parse.quote(keyword)}&location={lng},{lat}&radius=5000', 'baidu': f'https://map.baidu.com/search/{urllib.parse.quote(name)}?query=src=0&c=0', 'baidu_poi': f'https://map.baidu.com/search/{urllib.parse.quote(keyword)}/@%24%7B{lng}%24%7D,%24%7B{lat}%24%7D,14z', 'tencent': f'https://apis.map.qq.com/uri/v1/search?keyword={urllib.parse.quote(keyword)}&location={lat},{lng}&radius=5000', 'osm': f'https://www.openstreetmap.org/#map=14/{lat}/{lng}'}
    return jsonify({'success': True, 'urls': urls})

@app.route('/api/options/filters', methods=['GET'])
def api_options_filters():
    '''获取筛选下拉选项 - 统一使用与前端一致的类别命名'''

    pet_categories = ['犬类', '猫类', '兔类', '仓鼠', '鸟类', '爬行类', '鱼类', '宠物甲虫', '两栖类', '龙猫']
    emotions = ['开心', '平静', '紧张', '焦虑', '生病', '伤心']
    return jsonify({'success': True, 'pet_categories': pet_categories, 'emotions': emotions})

@app.route('/api/options/knowledge_tables', methods=['GET'])
def api_options_knowledge_tables():
    '''获取知识库表选项 - 统一使用与前端一致的类别命名'''

    tables = []
    for key, label in KNOWLEDGE_LABELS.items():
        tables.append({'key': key, 'label': label, 'fields': KNOWLEDGE_TABLES.get(key, [])})
    pet_categories = ['通用', '犬类', '猫类', '兔类', '仓鼠', '鸟类', '爬行类', '鱼类', '宠物甲虫', '两栖类', '龙猫']
    return jsonify({'success': True, 'tables': tables, 'pet_categories': pet_categories})

def _pet_label(pet_cat):
    '''数据库宠物分类 -> 用户友好名称'''

    return {'狗': '狗狗', '猫': '猫咪', '兔': '兔子', '鸟': '鹦鹉', '爬行': '龟龟', '鱼': '鱼儿', '小型宠物': '小型宠物', '通用': '宠物'}.get(pet_cat, '宠物')

_PET_BREED_KEYWORDS = {'狗': ['狗狗', '小狗', '幼犬', '成犬', '犬', '泰迪', '金毛', '拉布拉多', '哈士奇', '柯基', '比熊', '博美', '雪纳瑞', '萨摩耶', '边牧', '德牧', '阿拉斯加', '柴犬', '法斗', '英斗', '巴哥', '吉娃娃', '约克夏', '马尔济斯', '中华田园犬', '贵宾', '比格', '腊肠', '杜宾', '罗威纳'], '猫': ['猫咪', '小猫', '幼猫', '成猫', '猫', '英短', '美短', '布偶', '暹罗', '橘猫', '狸花', '三花', '奶牛猫', '波斯', '加菲', '蓝猫', '折耳', '中华田园猫', '缅因', '无毛猫', '阿比', '孟加拉豹猫', '英短蓝'], '兔': ['兔子', '小兔', '兔兔', '兔', '垂耳兔', '侏儒兔', '荷兰兔', '安哥拉兔', '海棠兔', '狮子兔', '道奇兔', '熊猫兔', '肉兔', '雷克斯兔'], '鸟': ['鹦鹉', '小鸟', '鸟', '虎皮鹦鹉', '玄凤', '牡丹鹦鹉', '和尚鹦鹉', '金刚鹦鹉', '葵花鹦鹉', '非洲灰鹦鹉', '太平洋鹦鹉', '画眉鸟', '八哥', '鹩哥', '文鸟', '珍珠鸟', '金丝雀', '百灵', '相思鸟', '蜡嘴'], '爬行': ['乌龟', '龟', '陆龟', '水龟', '巴西龟', '草龟', '花龟', '鳄龟', '黄缘', '赫曼', '苏卡达', '豹龟', '蜥蜴', '守宫', '鬃狮', '蛇', '玉米蛇', '球蟒', '蛙', '角蛙'], '鱼': ['金鱼', '鱼', '热带鱼', '锦鲤', '斗鱼', '孔雀鱼', '神仙鱼', '龙鱼', '罗汉鱼', '鹦鹉鱼', '招财鱼', '地图鱼', '清道夫', '灯鱼', '神仙', '海水鱼', '珊瑚', '虾', '螺'], '小型宠物': ['仓鼠', '豚鼠', '荷兰猪', '龙猫', '刺猬', '松鼠', '蜜袋鼯', '花枝鼠', '沙鼠', '金丝熊', '三线仓鼠', '布丁仓鼠', '银狐仓鼠']}

def _detect_pet_from_question(question):
    '''从问题文本中识别宠物类型，返回 pet_category 或 None'''

    if not question:
        return
    for pet_cat in ('小型宠物', '爬行', '鸟', '兔', '猫', '狗', '鱼'):
        keywords = sorted(_PET_BREED_KEYWORDS.get(pet_cat, []), key=len, reverse=True)
        for kw in keywords:
            if not kw in question:
                continue
            return pet_cat

_KB_STOP_BIGRAMS = {'一个', '一点', '一直', '不好', '不是', '么办', '乌龟', '什么', '今天', '仓鼠', '但是', '兔子', '出现', '发现', '可以', '如何', '宠物', '就是', '已经', '很多', '怎么', '情况', '感觉', '我的', '时候', '昨天', '最近', '有点', '没有', '狗狗', '猫咪', '现在', '的话', '而且', '蜥蜴', '请您', '还是', '这个', '那个', '金鱼', '问题', '需要', '非常', '鹦鹉', '龙猫'}
_KB_SYNONYMS = {'拉稀': '腹泻 软便 水样便', '拉肚子': '腹泻', '软便': '腹泻', '不吃': '食欲 拒食 食欲下降', '不吃饭': '食欲 拒食', '没胃口': '食欲 食欲下降', '没精神': '精神沉郁 精神差', '蔎': '精神沉郁', '掉毛': '脱毛', '发痒': '瘙痒', '眼屎': '分泌物 眼', '流泪': '眼 异常', '流鼻涕': '鼻涕 鼻', '喷嚏': '喷嚏 鼻', '喘': '呼吸 呼吸急促', '硬壳': '甲壳 甲', '软甲': '甲壳 软化', '浮水': '浮水 侧浮', '腐甲': '甲壳 腐烂', '腐皮': '皮肤 溃烂', '壳': '甲壳', '发软': '甲壳 软化', '白眼': '眼 眼睑 分泌物', '吐了': '呕吐 呕吐物', '吐': '呕吐'}

def _bigrams(text):
    '''把文本转成中文二元组集合，用于轻量语义匹配'''

    t = re.sub('[^\\u4e00-\\u9fa5a-zA-Z0-9]', '', text or '')
    return {t[i:i + 2] for i in range(len(t) - 1)}

def _query_bigrams(question):
    qb = _bigrams(question) - _KB_STOP_BIGRAMS
    for kw, syn in _KB_SYNONYMS.items():
        if kw in question:
            qb |= _bigrams(syn)
    return qb

_KB_MATCH_FIELDS = {'pet_disease_medicine': ('disease_name', ('symptom',)), 'pet_diet': ('age_group', ('food_type', 'forbidden_food')), 'pet_emotion_solution': ('emotion', ('behavior',)), 'pet_knowledge': ('breed', ('description',))}

def _kb_match_rows(table, kb_pet, question, limit=3):
    '''按问题文本在对应物种的知识表内做相关度匹配，返回 [(score, row)]'''

    try:
        rows = db.get_knowledge_by_pet(table, kb_pet)
    except Exception as e:
        print('[AI咨询] 知识库匹配异常: %s' % e, flush=True)
        return []
    qb = _query_bigrams(question)
    if not qb or not rows:
        return []
    head_key, body_keys = _KB_MATCH_FIELDS.get(table, ('', ()))
    scored = []
    for r in rows:
        score = len(qb & _bigrams(r.get(head_key, ''))) * 2
        for f in body_keys:
            score += len(qb & _bigrams(r.get(f, '')))
        if score > 0:
            scored.append((score, r))
    scored.sort(key=(lambda x: -x[0]))
    return scored[:limit]

def _kb_related_text(label, kb_pet, question):
    '''把知识库中与问题最相关的疾病条目附在回答后面'''

    hits = [(s, r) for s, r in _kb_match_rows('pet_disease_medicine', kb_pet, question, 3) if s >= 1]
    if not hits:
        return ''
    lines = ['', '【知识库·%s相关疾病】' % label]
    for _, d in hits:
        line = f'• {d.get('disease_name', '')!s}：{d.get('symptom', '')!s}；参考用药：{d.get('medicine', '')!s}'
        if d.get('remark'):
            line += '（%s）' % d['remark']
        lines.append(line)
    lines.append('以上条目取自知识库，最终诊断需兽医结合检查确定。')
    return '\n'.join(lines)

def _build_anorexia_reply(pet_cat):
    '''食欲不振 - 按宠物类型差异化'''

    label = _pet_label(pet_cat)
    if pet_cat == '狗':
        common = '【狗狗不吃饭常见原因】\n• 挑食（之前喂过人食/零食太多）\n• 口腔问题（牙结石、牙龈炎、口腔溃疡）\n• 肠胃不适（消化不良、寄生虫感染）\n• 换粮应激（突然更换饲料品牌）\n• 环境变化（搬家、新成员加入等心理压力）\n• 母犬发情期可能食欲下降\n'
        urgent = '⚠️ 超过48小时不进食，或伴随呕吐/腹泻/精神萎靡，需立即就医排查细小、胰腺炎。'
    elif pet_cat == '猫':
        common = '【猫咪不吃饭常见原因】\n• 毛球症（频繁干呕、大便干硬带毛）\n• 应激反应（陌生人、新环境、多猫冲突）\n• 口腔/牙齿问题（牙龈炎、口炎，猫尤其常见）\n• 肝脂血症风险（猫超过48h不进食 → 脂肪肝，危及生命）\n• 上呼吸道感染（鼻塞闻不到食物气味）\n'
        urgent = '🚨 猫咪超过24-48小时不进食极其危险！可能引发脂肪肝（肝脂血症），需立即就医！'
    elif pet_cat == '兔':
        common = '【兔子不进食常见原因】\n• 肠胃停滞（GI Stasis）——兔最常见致命问题\n• 毛球堵塞（换毛期高发）\n• 牙齿问题（门牙过长/磨牙不正 → 无法进食）\n• 环境温度过高（>28°C兔易中暑拒食）\n• 应激（噪音、惊吓）\n'
        urgent = '🚨 兔子超过12小时不进食就是急诊！肠胃停滞可在24-48h内致命，需立即就医！'
    elif pet_cat == '鸟':
        common = '【鹦鹉不进食常见原因】\n• 嗉囊积食/嗉囊炎（触摸嗉囊区域有硬块或软胀感）\n• 消化系统感染（细菌/真菌/寄生虫）\n• 环境温度骤降（鸟代谢快，受凉后消化停滞）\n• 换粮不当（突然更换混合谷物品牌）\n• 啄羽症/心理压力（笼具过小、孤独）\n'
        urgent = '🚨 鸟类代谢极快，超过12小时不进食可能危及生命！注意保温（28-30°C）并立即就医！'
    elif pet_cat == '爬行':
        common = '【龟不进食常见原因】\n• 温度过低（水龟水温<22°C、陆龟环境<25°C时消化停止）\n• UVB不足（缺钙/代谢性骨病 → 食欲下降）\n• 肠胃感染（寄生虫/沙门氏菌）\n• 季节性拒食（冬眠前正常现象，但需确认是否进入冬眠期）\n• 口腔炎（烂嘴病，常见于水龟）\n'
        urgent = '⚠️ 先确认温度是否达标（水龟水温25-28°C，陆龟环境28-32°C）。温度正常但仍拒食超过1周需就医。'
    elif pet_cat == '鱼':
        common = '【鱼不进食常见原因】\n• 水质问题（氨氮/亚硝酸盐超标，最常见原因）\n• 水温不适（每种鱼有适宜温度范围）\n• 疾病（白点病、肠炎、鳃感染）\n• 新入缸应激（刚买回来的鱼3天内不进食正常）\n• 过度喂食（前一次喂太多，还没消化）\n'
        urgent = '⚠️ 先检测水质（氨氮、亚硝酸盐、pH），换水1/3观察。如伴随白点、夹尾、沉底需对症治疗。'
    elif pet_cat == '小型宠物':
        common = '【仓鼠/豚鼠/龙猫不进食常见原因】\n• 颊囊积食变质（仓鼠把食物塞颊囊后发酵）\n• 牙齿过长或咬合不正 → 无法咀嚼\n• 饲料受潮发霉、突然换粮\n• 环境温度过高（龙猫>25°C即易中暑拒食）\n• 腹泻、弓背、精神差等疾病表现\n'
        urgent = '⚠️ 仓鼠/龙猫体型小、代谢快，超过24小时不进食就需就医；龙猫环境务必保持在25°C以下。'
    else:
        common = '【常见原因】食物不新鲜/不适口、口腔问题、肠胃不适、\n  环境应激、寄生虫感染、潜在疾病等。\n'
        urgent = '⚠️ 超过24小时不进食或伴随其他异常症状，请及时就医。'
    steps_map = {'狗': '1. 先停掉零食和人食，只留平时狗粮，保证饮水，观察12小时\n2. 掀开嘴唇看牙龈、牙结石、口腔溃疡，牙痛会直接导致拒食\n3. 若刚换粮：新旧粮按7:3混合过渡，不要一次全换\n4. 测体温（正常38.0~39.2℃），发烧时先物理降温并就医\n5. 48小时仍不吃，或伴呕吐/腹泻/精神差 → 立即就医', '猫': '1. 换湿粮或把食物加温到约37℃，猫对食物温度和气味的敏感度远高于狗\n2. 检查牙龈是否红肿、有无口炎和牙结石\n3. 观察是否打喷嚏流鼻涕——鼻塞闻不到味道也会拒食\n4. 安排安静单独的房间进食，多猫家庭分开喂，减少应激\n5. 24~48小时完全不进食 → 立即就医，防脂肪肝', '兔': '1. 立刻停掉兔粮和零食，只给提摩西干草和清水\n2. 看粪便：变少、变小或完全不排便＝肠胃停滞前兆\n3. 检查门牙是否过长、是否流口水、下巴毛发是否湿\n4. 轻轻按摩腹部促进蠕动，保持环境安静、温度15~25℃\n5. 超过12小时不进食 → 急诊，肠胃停滞可在24~48小时致命', '鸟': '1. 先把环境保温到28~30℃，鸟受凉后消化会直接停摆\n2. 轻摸嗉囊：硬块＝积食，软胀带酸味＝嗉囊炎\n3. 换新鲜谷物和饮水，撤掉受潮变质的饲料\n4. 看粪便颜色和精神状态，炸毛闭眼属危重表现\n5. 超过12小时不进食 → 立即就医', '爬行': '1. 先测温度：水龟水温25~28℃，陆龟晒点32~35℃，温度不够龟会停食\n2. 确认UVB灯是否到期（一般6~12个月需更换）\n3. 停食2~3天，每天泡20分钟温水帮助排便和补水\n4. 检查眼睛是否肿胀、甲壳是否发软发臭\n5. 温度正常仍拒食超过1周 → 就医排查肠胃炎、肺炎', '鱼': '1. 先测水质：氨氮、亚硝酸盐应为0，异常时先换水1/3\n2. 停食1~2天，之后少量试喂，2分钟吃不完就捞出\n3. 观察有无白点、夹尾、浮头、沉底等异常姿态\n4. 核对水温是否在鱼种适宜范围，避免骤升骤降\n5. 连续3天不吃且伴随异常姿态 → 按疾病处理', '小型宠物': '1. 检查颊囊（仓鼠）是否塞满变质食物，及时清理\n2. 换新鲜粮，撤掉受潮发霉的种子\n3. 检查门牙是否过长、牙龈是否红肿\n4. 保持环境安静、温度20~25℃，龙猫需低于25℃\n5. 24小时不进食，或伴腹泻、弓背 → 立即就医'}
    steps = steps_map.get(pet_cat, '1. 确认食材新鲜、没有突然换粮\n2. 记录24小时进食量和粪便状态\n3. 排除温度、噪音、新成员等应激因素\n4. 超过24小时不进食或伴随其他异常 → 就医')
    return f'【{label}食欲不振分析】\n\n{common}\n【针对{label}的处置步骤】\n{steps}\n\n{urgent}'

def _build_diarrhea_reply(pet_cat):
    '''腹泻 - 按宠物类型差异化'''

    label = _pet_label(pet_cat)
    if pet_cat == '狗':
        return f'【{label}腹泻分析】\n\n【常见原因】\n• 饮食不当（吃了变质食物/换粮太快/偷吃了人食）\n• 寄生虫感染（蛔虫/绦虫/球虫/贾第鞭毛虫）\n• 病毒性肠炎（细小病毒——幼犬最危险，未免疫幼犬致死率极高）\n• 细菌性肠炎（沙门氏菌/大肠杆菌）\n• 胰腺炎（反复腹泻+呕吐，尤其小型犬）\n• 食物过敏/不耐受\n\n【处理建议】\n1. 禁食4-6小时（不禁水），给肠胃休息\n2. 恢复进食先给易消化食物（煮熟鸡胸肉+白米饭，1:3比例）\n3. 补充宠物专用益生菌（如布拉氏酵母菌）\n4. 少量多次给水防止脱水\n\n🚨 紧急就医指征：\n• 幼犬未完成疫苗 → 立即排查细小病毒\n• 腹泻带血/呈番茄酱色 → 可能细小/球虫，立即就医\n• 伴随频繁呕吐 + 精神萎靡 → 24h内就医\n• 腹泻超过48小时 → 需做粪检排查寄生虫\n'
    if pet_cat == '猫':
        return f'【{label}腹泻分析】\n\n【常见原因】\n• 饮食问题（换粮太快、食物过敏、吃了不耐受食物）\n• 猫瘟（FPV/泛白细胞减少症——未免疫猫致死率极高）\n• 寄生虫（绦虫/球虫/三毛滴虫，猫尤其容易感染三毛滴虫）\n• 炎症性肠病（IBD，慢性腹泻+消瘦）\n• 应激性腹泻（多猫家庭、搬家、运输）\n\n【处理建议】\n1. 禁食2-4小时（不禁水），观察精神状态\n2. 恢复进食给易消化处方粮或煮熟鸡胸肉\n3. 补充益生菌，少量多次饮水\n4. 检查猫砂盆：记录腹泻频率、粪便颜色/形状\n\n🚨 紧急就医指征：\n• 猫瘟高发期（未免疫幼猫）→ 立即排查猫瘟\n• 腹泻带血/呈黄绿色水样 → 24h内就医\n• 慢性腹泻（超过2周）+ 消瘦 → 排查IBD/甲亢\n• 伴随呕吐+发烧 → 需住院输液\n'
    if pet_cat == '兔':
        return f'【{label}腹泻分析】\n\n🚨 兔子的腹泻是急症！尤其是水样腹泻，可在12-24小时内致死！\n\n【常见原因】\n• 饮食结构错误（碳水过高、兔粮喂太多、牧草不足）\n• 肠道菌群失衡（梭菌过度增殖 → 肠毒血症）\n• 球虫感染（幼兔致死率极高）\n• 抗生素使用不当（某些抗生素会杀死兔肠道有益菌 → 致命）\n\n【紧急处理】\n1. 如果是水样腹泻 → 立即就医！这是急诊！\n2. 如果只是软便（不成形但仍为粪粒状）→ 停兔粮，只给提摩西草\n3. 绝对不能自行使用抗生素！兔子肠道菌群极其脆弱\n4. 保持饮水，可补充兔用益生菌\n\n⚠️ 预防：兔的饮食应以80%提摩西草+10%蔬菜+5%兔粮为比例，牧草是维持肠道健康的关键。'
    if pet_cat == '鸟':
        return f'【{label}腹泻分析】\n\n【常见原因】\n• 细菌感染（大肠杆菌/沙门氏菌 → 绿色/黄色水便）\n• 念珠菌感染（粪便带气泡/酸臭味）\n• 寄生虫（滴虫/球虫）\n• 饲料变质/水源污染\n• 温度骤降导致消化功能紊乱\n\n【处理建议】\n1. 保温（28-30°C），避免温度波动\n2. 更换新鲜饲料和饮水，清洗食盆水壶\n3. 观察粪便颜色：绿色→可能细菌感染；白色→可能肾脏问题\n4. 如有条件做粪便检查确定病原\n\n🚨 水样腹泻+炸毛+精神萎靡 → 立即就医，鸟病情恶化极快。'
    if pet_cat == '鱼':
        return f'【{label}排泄异常分析】\n\n【鱼的排泄物异常常见原因】\n• 白色粪便拖长 → 肠炎或内寄生虫感染\n• 粪便带气泡 → 消化不良/肠炎\n• 长期不排便 → 可能便秘（多吃少动型鱼）\n\n【处理建议】\n1. 停食1-2天，让肠道自行恢复\n2. 检测水质（氨氮/亚硝酸盐/pH）\n3. 升温1-2°C促进代谢（注意缓慢升温，每小时不超1°C）\n4. 如确诊内寄 → 用甲硝唑药饵治疗\n5. 换水1/4-1/3改善水质\n\n⚠️ 长期白便+消瘦 → 需针对性用药，可带粪便样本去水族店或兽医处检测。'
    return f'【{label}腹泻分析】\n\n【常见原因】饮食不当、寄生虫、感染、应激等\n\n【处理建议】\n1. 短暂禁食（4-6小时），保证饮水\n2. 恢复后喂易消化食物\n3. 补充益生菌调节肠道\n4. 少量多次补水防脱水\n\n🚨 腹泻带血/持续超24h/伴随呕吐/精神萎靡 → 立即就医！'

def _build_vomiting_reply(pet_cat):
    '''呕吐 - 按宠物类型差异化'''

    label = _pet_label(pet_cat)
    if pet_cat == '狗':
        return f'【{label}呕吐分析】\n\n【狗狗呕吐常见原因】\n• 饮食过快/过饱（最常见，呕吐物为未消化食物）\n• 吃了不洁/异物（呕吐物可能含异物/草/塑料）\n• 胃炎/胃肠炎（呕吐物含黄绿色胆汁）\n• 胰腺炎（反复呕吐+腹痛+前肢趴伏姿势）\n• 误食有毒物质（巧克力/葡萄/木糖醇/百合等）\n• 肠道异物堵塞（呕吐频繁+不排便+腹痛，需拍片排查）\n\n【处理建议】\n1. 禁食禁水2-3小时，观察是否继续呕吐\n2. 不再呕吐后少量给水，再尝试少量易消化食物\n3. 记录呕吐频率/颜色/内容物，便于兽医诊断\n\n🚨 紧急就医指征：\n• 呕吐物带血/呈咖啡渣色 → 消化道出血，立即就医\n• 反复呕吐+不排便+腹痛 → 异物堵塞，需拍片\n• 怀疑误食有毒物 → 带上呕吐物/疑似毒物包装就医\n• 幼犬反复呕吐+腹泻 → 排查细小病毒\n'
    if pet_cat == '猫':
        return f'【{label}呕吐分析】\n\n【猫咪呕吐常见原因】\n• 吐毛球（呕吐物含条状毛团，偶尔吐毛球属正常）\n• 进食过快（饭后立即呕吐未消化食物，多为狼吞虎咽）\n• 胃炎/肠炎（频繁呕吐黄水/白沫）\n• 误食异物（线状物极危险 → 舌根下可能看到线头，绝对不能拉！）\n• 脂肪肝（长期不进食后呕吐，伴有黄疸）\n• 甲状腺功能亢进（老年猫消瘦+多食+呕吐）\n\n【处理建议】\n1. 偶尔吐毛球 → 喂化毛膏/猫草，属正常现象\n2. 进食过快 → 使用慢食碗，少食多餐\n3. 频繁呕吐 → 禁食2-3小时，观察是否继续\n\n🚨 紧急就医指征：\n• 怀疑吞食线状异物 → 绝对不要拉扯！立即就医手术\n• 呕吐带血/咖啡渣色 → 消化道出血\n• 频繁呕吐+不进食超过24h → 脂肪肝风险\n• 老年猫消瘦+频繁呕吐 → 查T4排除甲亢\n'
    if pet_cat == '兔':
        return f"【{label}呕吐分析】\n\n🚨 兔子生理结构决定它们不会呕吐！\n\n如果看到兔子有类似'呕吐'的动作（下颌快速运动/流口水/下巴湿），\n实际上是口腔/牙齿问题或消化道疼痛的表现：\n• 牙齿过长/磨牙不正 → 流口水、拒食、下巴毛发湿\n• 肠胃停滞（GI Stasis）→ 弓背、磨牙、蜷缩不动\n• 毛球堵塞 → 粪便变小/变少或无粪便\n\n⚠️ 兔子出现上述症状需立即就医！尤其是肠胃停滞24-48h内可致死。"
    if pet_cat == '鸟':
        return f'【{label}呕吐/反刍分析】\n\n【鹦鹉呕吐常见原因】\n• 嗉囊炎/嗉囊积食（嗉囊区域胀大/有酸臭味）\n• 念珠菌感染（嗉囊内有白色伪膜，呕吐物酸臭）\n• 鹦鹉热（衣原体感染 → 呕吐+眼鼻分泌物+呼吸急促）\n• 消化道寄生虫\n• 温度骤变导致消化功能紊乱\n\n⚠️ 鸟类代谢快，频繁呕吐可在短时间内导致脱水和死亡。\n建议保温（28-30°C）+立即就医做嗉囊冲洗和病原检测。'
    return f'【{label}呕吐分析】\n\n【处理建议】\n1. 禁食禁水2-3小时让肠胃休息\n2. 之后少量给水观察是否继续\n3. 观察呕吐物颜色/内容/频率\n\n🚨 频繁呕吐/带血/伴随精神萎靡 → 立即就医！'

def _build_skin_reply(pet_cat):
    '''皮肤问题 - 按宠物类型差异化'''

    label = _pet_label(pet_cat)
    if pet_cat == '狗':
        return f'【{label}皮肤问题分析】\n\n【狗狗皮肤问题常见类型】\n• 跳蚤/蜱虫过敏性皮炎（腰臀部抓挠剧烈、红点/脱毛）\n• 真菌感染（圆形脱毛斑、皮屑多、犬小孢子菌最常见）\n• 细菌性脓皮症（红色丘疹/脓疱、瘙痒）\n• 螨虫感染（疥螨：剧烈瘙痒+耳缘边缘先发；蠕形螨：面部/前肢脱毛）\n• 异位性皮炎（季节性瘙痒，面部/爪子/腹部好发）\n• 脂溢性皮炎（皮肤油腻/大量皮屑）\n\n【处理建议】\n1. 先做体外驱虫（排除跳蚤/蜱虫/螨虫）\n2. 拨开毛发检查：有无虫体/红疹/皮屑/脱毛斑\n3. 轻度可先用宠物抗菌洗液药浴（含氯己定/咪康唑）\n4. 不要使用人用皮膏（含激素 → 加重真菌感染）\n\n🚨 就医指征：\n• 大面积脱毛/化脓 → 需做皮肤刮片/真菌培养\n• 剧烈瘙痒影响睡眠 → 需处方药干预\n• 反复发作 → 排查食物过敏/环境过敏\n'
    if pet_cat == '猫':
        return f'【{label}皮肤问题分析】\n\n【猫咪皮肤问题常见类型】\n• 猫癣（真菌感染：圆形脱毛、灰白皮屑、伍德氏灯下荧光绿）\n• 跳蚤过敏性皮炎（背部尾端/颈部剧烈瘙痒+小红点）\n• 猫痤疮（下巴黑头/粉刺，塑料碗易诱发）\n• 粟粒性皮炎（背部分布小痂/结痂，跳蚤过敏常见）\n• 心因性脱毛（过度舔毛导致对称性脱毛，多见焦虑猫）\n• 耳螨（耳朵内棕黑色分泌物+频繁抓耳）\n\n【处理建议】\n1. 猫癣可传染人！处理时戴手套，用伍德氏灯初筛\n2. 更换不锈钢/陶瓷碗（减少猫痤疮）\n3. 先做驱虫排除跳蚤过敏\n4. 轻度猫癣可用伊曲康唑口服+外用抗真菌洗液\n\n🚨 就医指征：\n• 大面积脱毛/猫癣扩散 → 需口服抗真菌药（人药剂量不同，需兽医处方）\n• 对称性脱毛 → 排查是否过度梳理（焦虑/疼痛）\n'
    if pet_cat == '兔':
        return f'【{label}皮肤问题分析】\n\n【兔子皮肤问题常见类型】\n• 兔疥螨（耳螨：耳朵内厚痂/频繁甩头；体螨：皮肤鳞屑/脱毛）\n• 足皮炎（脚底红肿/溃疡 → 笼底太硬/无垫料）\n• 湿性皮炎（下巴/脖子毛发湿 → 牙齿问题导致流口水）\n• 真菌感染（局部脱毛/皮屑）\n• 脓肿（皮下硬包 → 兔的脓汁浓稠不易排出，需手术）\n\n【处理建议】\n1. 耳螨 → 伊维菌素注射（兽医处方）\n2. 足皮炎 → 检查笼底，改用软垫/干草\n3. 下巴湿 → 检查门牙是否过长/歪斜\n4. 脓肿 → 需手术切除+抗生素，兔的脓肿很难自愈\n'
    if pet_cat == '鸟':
        return f'【{label}皮肤/羽毛问题分析】\n\n【鹦鹉皮肤/羽毛常见问题】\n• 啄羽症（自拔羽毛 → 心理压力/营养不良/皮肤病/笼具过小）\n• 螨虫（面部/喙周围/脚部鳞屑增厚）\n• 法式换羽（PBFD病毒 → 羽毛畸形/脱落，致命）\n• 脂肪瘤（胸部皮下肿块）\n\n【处理建议】\n1. 啄羽 → 排查压力源/改善环境/增加玩具\n2. 螨虫 → 伊维菌素外用\n3. 异常羽毛脱落+喙变形 → 紧急排查PBFD\n'
    if pet_cat == '鱼':
        return f'【{label}皮肤/体表问题分析】\n\n【常见鱼病】\n• 白点病（小瓜虫：全身白色小点，蹭缸，最常见）\n• 水霉病（白色棉絮状菌丝，外伤后易发）\n• 烂鳍/烂尾（鳍条破损发白，细菌感染）\n• 烂肉病（体表溃烂，严重细菌感染）\n• 竖鳞病（鳞片竖起，腹水）\n• 寄生虫（锚头蚤、鱼虱，可见虫体）\n\n【处理建议】\n1. 先检测水质（氨氮/亚硝酸盐超标是鱼病根源）\n2. 换水1/3，升温到28-30°C（白点病加温有效）\n3. 白点病：加温30°C+少量盐（0.3%），持续5-7天\n4. 烂肉/水霉：用黄粉/亚甲基蓝药浴\n5. 严重感染需隔离病鱼+抗生素药浴\n\n🚨 鱼病多由水质引起，保持好水质是预防关键！'
    if pet_cat == '爬行':
        return f'【{label}甲壳/皮肤问题分析】\n\n【龟常见的甲壳与皮肤问题】\n• 腐甲病（甲壳发黑/软化/凹陷、有异味 → 细菌或真菌感染）\n• 腐皮病（四肢、颈部皮肤发白溃烂、脱皮）\n• 软甲病（甲壳变软变形 → 缺钙/UVB不足，属代谢性骨病）\n• 白眼病（眼睑肿胀睁不开 → 维生素A缺乏+水质差）\n• 真菌感染（甲壳或皮肤白斑，潮湿不通风易发）\n\n【处理步骤】\n1. 先隔离干养，患处用碘伏消毒，保持通风干燥\n2. 彻底换水并清洗过滤，水质是腐甲腐皮的根源\n3. 检查UVB灯与钙粉补充，软甲必须补钙+晒背\n4. 不要自行用高浓度抗生素药浴，剂量错误会伤龟\n\n🚨 甲壳大面积软化、溃烂见肉或持续拒食 → 必须就医清创。'
    if pet_cat == '小型宠物':
        return f'【{label}皮肤问题分析】\n\n【常见类型】\n• 真菌感染（圆形脱毛、皮屑，仓鼠常见）\n• 螨虫感染（剧烈瘙痒、脱毛、结痂）\n• 湿性皮炎（潮湿环境导致皮肤发炎）\n• 打架外伤（多只混养时）\n\n【处理建议】\n1. 保持笼内干燥清洁，定期更换垫料\n2. 真菌感染需隔离治疗（可传染）\n3. 螨虫用伊维菌素（按体重，兽医指导）\n4. 外伤用生理盐水清洁+碘伏消毒\n\n🚨 小宠皮肤问题发展快，发现异常及时处理。'
    return f'【{label}皮肤问题分析】\n\n【常见类型】寄生虫（跳蚤/螨虫）、真菌、细菌感染、过敏\n\n【处理建议】\n1. 先做驱虫排查寄生虫\n2. 检查皮肤有无红疹/脱毛/皮屑/结痂\n3. 轻度可用宠物抗菌洗液\n4. 不要使用人用药膏\n\n🚨 大面积脱毛/化脓/剧痒 → 就医做皮肤检查'

def _build_general_health_reply(pet_cat):
    '''精神不佳/异常 - 按宠物类型差异化'''

    label = _pet_label(pet_cat)
    if pet_cat == '狗':
        return f'【{label}精神不佳分析】\n\n【狗狗精神不佳需排查】\n• 发烧（正常体温37.5-39.2°C，>39.5°C发烧）\n• 疼痛（跛行/弓背/不愿被触摸某部位）\n• 消化问题（肠胃不适/胰腺炎/肠道异物）\n• 传染病（细小/犬瘟热 —— 未免疫犬尤其危险）\n• 心脏问题（老年犬咳嗽+运动不耐受+精神差）\n• 中暑（高温环境+喘息+流口水+虚脱 → 急症）\n\n【检查清单】\n1. 测体温（直肠温度计，正常37.5-39.2°C）\n2. 检查牙龈颜色（粉红=正常，白/紫/黄=异常）\n3. 按压腹部看是否有疼痛反应\n4. 观察饮水/排尿是否正常\n\n🚨 紧急就医指征：\n• 体温>40°C 或 <37°C\n• 牙龈发白/发紫\n• 腹部胀硬+干呕（胃扭转征兆！）\n• 夏季高温+剧烈喘息+虚脱 → 中暑急症\n'
    if pet_cat == '猫':
        return f'【{label}精神不佳分析】\n\n【猫咪精神不佳需排查】\n• 发烧（正常体温38-39.5°C，>40°C发烧）\n• 泌尿问题（公猫尤其注意尿闭 → 膀胱破裂/肾衰，48h内可致死）\n• 疼痛（猫隐藏疼痛能力极强，表现为躲藏/不互动）\n• 肾脏问题（老年猫慢性肾病 → 多饮多尿/消瘦/精神差）\n• 传腹（FIP → 持续发烧+精神差+腹水/胸水）\n• 中毒（百合花/驱蚊液/精油 → 猫肝代谢能力差，极易中毒）\n\n【检查清单】\n1. 检查猫砂盆：尿团大小/数量是否正常（尿闭排查！）\n2. 测体温（正常38-39.5°C）\n3. 轻轻按压腹部/肾脏区域看是否躲闪\n4. 检查牙龈颜色和眼球状态\n\n🚨 紧急就医指征：\n• 公猫频繁进出猫砂盆无尿/尿血 → 尿闭急症！\n• 精神差+不进食超过24h → 脂肪肝风险\n• 腹围增大+呼吸急促 → 可能传腹/心包积液\n'
    if pet_cat == '兔':
        return f'【{label}精神不佳分析】\n\n【兔子精神不佳常见原因】\n• 肠胃停滞（最常见 → 蜷缩/弓背/磨牙/不进食/无粪便）\n• 温度过高（>28°C → 兔极易热应激，耳朵发烫）\n• 疼痛/牙齿问题（门牙过长 → 进食困难/流口水）\n• 呼吸道感染（喷嚏/鼻分泌物 → 巴氏杆菌感染）\n\n🚨 兔子是隐藏疾病的高手，出现明显精神差时往往病情已较重。\n如伴有不进食/无粪便 → 立即就医（肠胃停滞24-48h可致命）！\n检查耳朵温度→如过烫需立即物理降温+就医。'
    if pet_cat == '鸟':
        return f'【{label}精神不佳分析】\n\n【鹦鹉精神不佳常见原因】\n• 消化系统感染（嗉囊炎/念珠菌 → 呕吐/嗉囊胀大）\n• 呼吸道感染（鼻分泌物/打喷嚏/呼吸有声）\n• 温度不足（炸毛/缩在角落 → 保温！28-30°C）\n• 鹦鹉热（衣原体 → 精神差+眼鼻分泌物+绿色便 → 可传染人）\n• 重金属中毒（啃咬笼具/玩具含锌铅 → 神经症状+精神差）\n\n🚨 鸟类病情恶化极快，精神差+炸毛+食欲下降超过半天 → 立即就医+保温。'
    if pet_cat == '爬行':
        return f'【{label}精神不佳分析】\n\n【龟精神差的常见原因】\n• 温度过低（水温<22℃或环境温度骤降 → 代谢停滞）\n• 肺炎（侧浮、张口呼吸、鼻冒泡、拒食）\n• 肠胃炎（拒食+腹泻+精神沉郁）\n• 腐甲/腐皮/白眼病等感染\n• 缺钙与UVB不足（软甲、四肢无力）\n\n【检查清单】\n1. 测水温/环境温度是否达标\n2. 看是否侧浮、张口呼吸、鼻冒泡\n3. 检查甲壳有无发黑软化发臭、眼睑能否睁开\n4. 观察粪便与是否拒食\n\n🚨 侧浮+张口呼吸+拒食 → 肺炎急症，需立即就医并加温。'
    if pet_cat == '鱼':
        return f'【{label}精神不佳分析】\n\n【鱼精神差的常见原因】\n• 水质恶化（氨氮/亚硝酸盐超标，最常见）\n• 白点病（体表白点、蹭缸）\n• 烂鳃病（鳃丝发白腐烂、浮头、呼吸困难）\n• 肠炎（拖白便、肛门红肿、拒食）\n• 水温骤变或溶氧不足（集体浮头）\n\n【检查清单】\n1. 测氨氮、亚硝酸盐、pH\n2. 看体表有无白点、棉絮、充血\n3. 看鳃丝颜色与呼吸频率\n4. 观察是否离群、沉底、浮头\n\n🚨 先换水1/3+增氧，停食观察；集体浮头说明缺氧，需立即增氧。'
    if pet_cat == '小型宠物':
        return f'【{label}精神不佳分析】\n\n【仓鼠/兔鼠/龙猫精神差的常见原因】\n• 湿尾症（水样恶臭腹泻+尾周潮湿，仓鼠急症）\n• 中暑（温度>25℃对龙猫极危险，呼吸急促、瘫软）\n• 牙齿过长（流口水、拒食、体重下降）\n• 呼吸道感染（打喷嚏、呼吸杂音）\n• 颊囊积食/脓肿（仓鼠）\n\n【检查清单】\n1. 测环境温度（龙猫必须<25℃）\n2. 看尾部是否潮湿、粪便是否成形\n3. 检查门牙长度与颊囊\n4. 观察呼吸与活动量\n\n🚨 水样腹泻、呼吸急促或瘫软 → 立即就医，小宠病情恶化极快。'
    return f'【{label}精神不佳分析】\n\n【检查清单】\n1. 体温是否正常（猫38-39.5°C，狗37.5-39.2°C）\n2. 食欲/饮水量是否有变化\n3. 排泄是否正常（腹泻/便秘/尿色异常）\n4. 毛发状态（粗糙/掉毛/皮肤异常）\n5. 呼吸是否正常（咳嗽/喘息/鼻分泌物）\n\n🚨 持续精神差超过24h或伴随其他异常 → 及时就医，不要自行用药。'

def _build_toilet_training_reply(pet_cat):
    '''上厕所/定点训练 - 按宠物类型差异化'''

    label = _pet_label(pet_cat)
    if pet_cat == '狗':
        return f"【{label}定点排便训练】\n\n【训练步骤】\n1. 选固定地点：安静角落，铺尿垫/报纸，远离食盆和窝\n2. 定时引导：饭后15分钟、睡醒后、玩耍后立即带到指定地点\n3. 口令+奖励：说'尿尿'口令，正确排泄后立刻给零食+夸奖\n4. 及时清理：意外排泄后用宠物除臭剂彻底清洁（普通清洁剂留有气味会重复排泄）\n5. 增加外出：幼犬每2-3小时需排泄一次，成犬每天3-4次外出\n6. 不要打骂：打骂会让宠物害怕在你面前排泄，导致憋尿或偷拉\n\n💡 幼犬一般4-6个月才能稳定控制，要有耐心！可使用诱导剂辅助。"
    if pet_cat == '猫':
        return f'【{label}使用猫砂盆训练】\n\n【训练要点】\n1. 猫砂盆数量：N只猫需要N+1个猫砂盆（多猫家庭必须）\n2. 位置选择：安静、通风、远离食盆和水碗\n3. 猫砂类型：多数猫偏好无香细颗粒膨润土砂，避免香精砂\n4. 引导方法：饭后/睡醒后把猫放进猫砂盆，抓它的爪子刨几下\n5. 及时清理：每天铲屎1-2次，每周完全更换猫砂并清洗盆\n6. 盆的大小：猫砂盆长度应为猫体长的1.5倍\n\n⚠️ 如果猫突然不使用猫砂盆，先排查健康问题（泌尿感染/便秘），而非行为问题！'
    if pet_cat == '兔':
        return f'【{label}定点排泄训练】\n\n【训练要点】\n1. 兔子天生倾向在固定角落排泄，观察它常去的角落放厕所\n2. 厕所选择：边缘低、空间大的兔子专用厕所，铺木屑/纸粒\n3. 引导：把沾有尿味的垫料放进厕所，引导它在厕所排泄\n4. 奖励：正确排泄后给小块蔬菜奖励（胡萝卜/芹菜）\n5. 耐心：兔子需要1-2周时间适应，不要急于求成\n\n💡 兔子会吃自己的软便（盲肠便），这是正常行为，不要阻止！'
    if pet_cat == '鸟':
        return f'【{label}排泄训练说明】\n\n鹦鹉无法像猫狗那样定点排便，它们的排泄是反射性的（每10-30分钟一次）。\n\n【可以做的】\n1. 观察排泄规律：鹦鹉在进食后、睡醒后容易排泄\n2. 信号识别：排泄前会有翘尾、下蹲动作，及时把它放到指定位置（如站架/笼子）\n3. 使用防护：在鹦鹉常停留的位置铺报纸/尿垫\n4. 笼内训练：在笼内固定角落放托盘，慢慢建立条件反射\n\n⚠️ 不要强迫鹦鹉憋尿，会导致健康问题！鹦鹉的排泄物（粪便+尿酸）是正常的。'
    return f'【{label}排泄训练建议】\n\n1. 观察排泄规律，在固定时间引导到指定地点\n2. 正确排泄后及时奖励\n3. 意外排泄后彻底清洁除臭\n4. 保持耐心，训练需要时间\n5. 突然乱排泄可能是健康问题，需排查'

def _build_basic_training_reply(pet_cat):
    '''基础训练 - 按宠物类型差异化'''

    label = _pet_label(pet_cat)
    if pet_cat == '狗':
        return f"【{label}基础训练指南】\n\n【可训练指令】坐下、握手、趴下、过来、等待、定点、拒食\n\n【训练原则】\n1. 时机：饭后1小时、清醒状态，每次5-15分钟\n2. 正面强化：用零食/玩具/赞美奖励正确行为，禁止体罚\n3. 简短清晰：指令用单字或双字词，如'坐''来''停'\n4. 循序渐进：先教'坐'（最容易），再教其他\n5. 重复巩固：每天练习，每只狗学习速度不同\n6. 全家一致：所有家人用相同指令和奖励方式\n\n💡 零食切成豌豆大小小块，避免训练时吃太饱影响正餐。"
    if pet_cat == '猫':
        return f"【{label}基础训练指南】\n\n【可训练指令】过来、握手、击掌、坐下、使用猫砂盆\n\n【训练原则】\n1. 猫咪自主性强，用逗猫棒/零食引导，不要强迫\n2. 每次训练2-3分钟，猫咪注意力时间短\n3. 用响片或特定声音建立条件反射\n4. 奖励要即时：做出正确行为0.5秒内给奖励\n5. 猫咪不喜欢被束缚，训练时让它保持自由\n\n💡 猫咪训练的核心是'让它觉得这是它自己想做的'，用零食和耐心引导。"
    if pet_cat == '鸟':
        return f"【{label}基础训练指南】\n\n【可训练指令】上手、转圈、说话、放飞回收、定点站\n\n【训练原则】\n1. 建立信任：先用手喂食，让鹦鹉不怕你的手\n2. 饥饿训练：饭前训练效果最好（但不要饿太久）\n3. 逐步引导：用食物引导动作，完成后给奖励\n4. 说话训练：重复简短词语（如'你好'），鹦鹉有反应就奖励\n5. 每次5-10分钟，鹦鹉注意力集中时间有限\n\n⚠️ 不要剪羽后强行训练，会让鹦鹉失去安全感。"
    return f'【{label}训练建议】\n\n1. 用食物奖励引导正确行为\n2. 每次训练时间短（5-15分钟）\n3. 指令简短清晰，全家一致\n4. 禁止体罚，用正面强化\n5. 循序渐进，从简单指令开始'

def _build_bath_reply(pet_cat):
    '''洗澡/清洁 - 按宠物类型差异化'''

    label = _pet_label(pet_cat)
    if pet_cat == '狗':
        return f'【{label}洗澡指南】\n\n【频率】短毛犬2-4周1次，长毛犬1-2周1次\n\n【步骤】\n1. 梳毛：洗澡前先梳通毛发，去除打结和死毛\n2. 水温：38-40°C，用手腕内侧测试不烫\n3. 湿润：先冲身体，最后冲头（避免水进耳朵眼睛）\n4. 沐浴露：用宠物专用沐浴露，揉搓起泡后停留3-5分钟\n5. 冲洗：彻底冲干净，残留沐浴露会导致皮肤瘙痒\n6. 吹干：用毛巾擦干，再用吹风机低温吹干（尤其是长毛犬）\n7. 清耳：洗澡后用棉球清理耳朵水分\n\n⚠️ 频繁洗澡会破坏皮肤油脂屏障。生病、刚打完疫苗、空腹时不要洗澡。'
    if pet_cat == '猫':
        return f'【{label}洗澡指南】\n\n【频率】健康猫1-3个月1次，猫咪会自行清洁，不需要频繁洗澡\n\n【步骤】\n1. 剪指甲：洗澡前先剪指甲，防止抓伤\n2. 水温：38-40°C，水位到猫的胸部\n3. 安抚：轻声说话，让猫放松\n4. 湿润：用毛巾沾水慢慢打湿，避免喷头惊吓\n5. 沐浴露：用宠物专用（猫对某些化学成分敏感）\n6. 冲洗：彻底冲净\n7. 吹干：用毛巾包裹擦干，吹风机低温（猫怕噪音，可用毛巾多擦）\n\n⚠️ 猫洗澡后容易应激，可在洗澡后给零食安抚。不要用人用沐浴露！'
    if pet_cat == '兔':
        return f'【{label}清洁指南】\n\n【重要】兔子一般不需要洗澡！兔子会自行清洁，洗澡会导致应激甚至休克。\n\n【清洁方式】\n1. 局部清洁：如果屁股脏了，用湿布/宠物湿巾局部擦拭\n2. 干洗粉：可用兔子专用干洗粉清洁毛发\n3. 梳毛：定期梳毛去除死毛（换毛期每天梳）\n4. 剪指甲：每4-6周剪一次指甲\n5. 清洁笼子：保持笼内清洁，减少脏污\n\n🚨 绝对不要给兔子全身水洗！兔子体温调节差，水洗后极易失温死亡。'
    if pet_cat == '鸟':
        return f'【{label}洗澡/清洁指南】\n\n【洗澡方式】\n1. 喷雾洗澡：用喷壶装温水（30°C），在鹦鹉上方喷雾让水珠落下\n2. 浅水盘洗澡：放一个浅盘装温水，让鹦鹉自己进去洗\n3. 淋浴：有些鹦鹉喜欢站在淋浴间边缘玩水\n\n【频率】每周1-2次，根据季节和鹦鹉喜好调整\n\n【注意】\n• 水温接近体温（38-40°C）\n• 不要用任何沐浴露/洗发水（会破坏羽毛油脂）\n• 洗完后让鹦鹉在温暖处自然晾干或用吹风机低温远吹\n• 洗澡后不要立即吹冷风或放入低温环境\n\n💡 观察鹦鹉反应，有些鹦鹉喜欢洗澡，有些不喜欢，不要强迫。'
    if pet_cat == '爬行':
        return f'【{label}清洁指南】\n\n【水龟】\n1. 定期换水：每周换水1/3，保持水质清洁\n2. 刷壳：用软毛刷轻轻刷龟壳，去除藻类和污垢\n3. 注意：不要用肥皂或清洁剂刷龟\n\n【陆龟】\n1. 温水泡澡：每周2-3次，35°C温水泡澡15-20分钟\n2. 泡澡促进排便和补水\n3. 刷壳：软毛刷清洁龟壳缝隙\n\n【蜥蜴/蛇】\n1. 提供泡澡容器，让宠物自行泡水\n2. 定期清洁饲养箱，更换垫材\n3. 不要过度触摸，避免应激'
    if pet_cat == '鱼':
        return f'【{label}清洁指南】\n\n鱼不需要洗澡！清洁的是鱼缸：\n\n【鱼缸维护】\n1. 换水：每周换水1/4-1/3，新水需除氯并调至同温\n2. 洗过滤棉：用原缸水冲洗，不要用自来水（杀死硝化细菌）\n3. 刮藻：用鱼缸刷清理缸壁藻类\n4. 吸底沙：用虹吸管清理底沙中的鱼便和残饵\n5. 检测水质：每周检测氨氮、亚硝酸盐、pH\n\n⚠️ 不要一次性全缸换水！会破坏硝化系统，导致水质崩溃。'
    return f'【{label}清洁建议】\n\n1. 使用宠物专用清洁产品\n2. 水温接近体温，避免过冷过热\n3. 清洁后彻底擦干/吹干，防止感冒\n4. 不要使用人用清洁用品\n5. 频率根据宠物类型和脏污程度调整'

def _build_deworming_reply(pet_cat):
    '''驱虫 - 按宠物类型差异化'''

    label = _pet_label(pet_cat)
    if pet_cat == '狗':
        return f'【{label}驱虫指南】\n\n【体内驱虫】\n• 幼犬：2周龄开始，每2周1次至12周龄，之后每月1次至6月龄\n• 成犬：每3个月1次\n• 常用药：拜宠清、犬心保、大宠爱\n\n【体外驱虫】\n• 幼犬：6周龄开始，每月1次\n• 成犬：每月1次（夏季/外出频繁可加强）\n• 常用药：福来恩、大宠爱、爱沃克\n\n【注意】\n1. 体内外驱虫可同时进行（使用复方制剂）\n2. 驱虫后观察24小时，有无呕吐腹泻\n3. 定期驱虫比治疗更重要\n\n⚠️ 心丝虫（蚊子传播）在南方地区高发，需使用含心丝虫预防的驱虫药。'
    if pet_cat == '猫':
        return f'【{label}驱虫指南】\n\n【体内驱虫】\n• 幼猫：6周龄开始，每2周1次至12周龄，之后每月1次至6月龄\n• 成猫：每3个月1次\n• 常用药：拜宠清、海乐妙\n\n【体外驱虫】\n• 每月1次，即使是室内猫也需要（跳蚤可能通过人/衣物带入）\n• 常用药：大宠爱、爱沃克、博来恩\n\n【注意】\n1. 猫对很多驱虫药敏感，必须用猫专用，不能用狗用驱虫药！\n2. 体外驱虫药滴在颈后皮肤上，避免猫咪舔到\n3. 驱虫后48小时内不要洗澡\n\n⚠️ 吡喹酮对猫安全，但伊维菌素类药物某些品种（如柯利犬基因）需谨慎。'
    if pet_cat == '兔':
        return f'【{label}驱虫指南】\n\n【体内驱虫】\n• 主要寄生虫：球虫（幼兔致死率高）、蛔虫、绦虫\n• 幼兔：断奶后开始驱虫（球虫药+伊维菌素）\n• 成兔：每3-6个月1次\n• 常用药：百球清（球虫）、伊维菌素\n\n【体外驱虫】\n• 主要寄生虫：兔疥螨、耳螨、跳蚤\n• 每1-3个月1次\n• 常用药：大宠爱（猫用，按体重减量）、伊维菌素\n\n【注意】\n1. 兔子对很多药物敏感，必须用兔专用或咨询兽医\n2. 球虫是幼兔第一杀手，断奶后必须预防\n3. 保持笼内干燥清洁可减少寄生虫\n\n⚠️ 兔子驱虫药剂量需严格按体重计算，过量会中毒！'
    if pet_cat == '鸟':
        return f'【{label}驱虫指南】\n\n【体内寄生虫】\n• 主要：蛔虫、绦虫、球虫、毛滴虫\n• 每年驱虫1-2次，或发现粪便异常时\n• 常用药：阿苯达唑（按体重）、百球清（球虫）\n\n【体外寄生虫】\n• 主要：螨虫（红螨、鳞足螨）、羽虱\n• 发现症状（瘙痒、脱毛、皮屑）时驱虫\n• 常用药：伊维菌素外用、专用驱虫喷雾\n\n【注意】\n1. 鹦鹉驱虫药剂量需精确，按体重计算\n2. 驱虫后观察精神和食欲\n3. 同时清洁笼具和环境\n\n⚠️ 鸟类代谢快，药物剂量错误极易致命，建议咨询兽医后用药。'
    return f'【{label}驱虫建议】\n\n1. 体内驱虫：幼犬/幼猫2周龄开始，成犬/成猫每3个月1次\n2. 体外驱虫：每月1次，预防跳蚤、蜱虫、螨虫\n3. 使用宠物专用驱虫药，按体重计算剂量\n4. 驱虫后观察24小时有无异常反应\n5. 定期驱虫比治疗更经济有效'

def _build_feeding_reply(pet_cat):
    '''喂食/饮食 - 按宠物类型差异化'''

    label = _pet_label(pet_cat)
    if pet_cat == '狗':
        return f'【{label}喂食指南】\n\n【饮食原则】狗粮为主，搭配适量湿粮/新鲜食材\n\n【分龄喂食】\n• 幼犬（<1岁）：幼犬粮，3-4次/天，蛋白质含量高\n• 成犬（1-7岁）：成犬粮，2次/天\n• 老年犬（>7岁）：老年粮，1-2次/天，低蛋白低磷\n• 怀孕/哺乳期：高营养粮，自由采食\n\n【禁忌食物】\n🚫 巧克力、葡萄/葡萄干、洋葱/大蒜、木糖醇、夏威夷果、\n   牛油果、酒精、咖啡因、生鸡蛋、生鱼骨\n\n【注意】\n1. 定时定量，不要自由采食（防止肥胖）\n2. 随时提供新鲜饮水\n3. 换粮需7天过渡（新旧粮混合逐步替换）'
    if pet_cat == '猫':
        return f'【{label}喂食指南】\n\n【饮食原则】高蛋白、低碳水、充足水分\n\n【分龄喂食】\n• 幼猫（<1岁）：幼猫粮，3-4次/天\n• 成猫（1-7岁）：成猫粮，2次/天或自由采食\n• 老年猫（>7岁）：老年粮，易消化、低磷\n• 怀孕/哺乳期：高营养粮，自由采食\n\n【禁忌食物】\n🚫 巧克力、洋葱/大蒜、葡萄、木糖醇、生鱼、生鸡蛋、\n   牛奶（多数猫乳糖不耐受）、酒精、咖啡因\n\n【注意】\n1. 猫天生饮水少，建议干粮+湿粮搭配（湿粮增加水分）\n2. 可用流动饮水机促进喝水\n3. 猫不能长期吃素，必须是肉食动物'
    if pet_cat == '兔':
        return f'【{label}喂食指南】\n\n【饮食结构】80%提摩西草 + 10%新鲜蔬菜 + 5%兔粮 + 5%水果零食\n\n【分龄喂食】\n• 幼兔（<6个月）：苜蓿草为主+幼兔粮（高蛋白高钙）\n• 成兔（>6个月）：提摩西草为主+成兔粮，苜蓿草减量\n• 老年兔（>5岁）：提摩西草+低蛋白兔粮\n\n【禁忌食物】\n🚫 巧克力、面包、饼干、坚果、豆类、土豆、洋葱、\n   大量水果（糖分过高）、人类零食\n\n【注意】\n1. 牧草是兔子的生命线，必须无限量供应\n2. 蔬菜要洗净擦干，避免带水导致腹泻\n3. 随时提供新鲜饮水（用滚珠水壶）\n4. 换草需逐步过渡'
    if pet_cat == '鸟':
        return f'【{label}喂食指南】\n\n【饮食结构】混合谷物为主 + 新鲜蔬果 + 滋养丸\n\n【分龄喂食】\n• 雏鸟：鹦鹉奶粉，每天4-6次\n• 幼鸟：谷物+滋养丸，每天3-4次\n• 成鸟：谷物+蔬果+滋养丸，每天2次\n\n【禁忌食物】\n🚫 巧克力、牛油果、咖啡因、酒精、洋葱、大蒜、\n   含盐/含糖食物、果核（含氰化物）\n\n【注意】\n1. 谷物不能单一，要混合多种（小米/燕麦/荞麦/亚麻籽）\n2. 新鲜蔬菜（西兰花/胡萝卜/生菜）每天供应\n3. 水果适量（糖分高，每周2-3次）\n4. 滋养丸营养全面，建议占日粮30-50%'
    if pet_cat == '爬行':
        return f'【{label}喂食指南】\n\n【水龟】\n• 饮食：杂食，龟粮+小鱼虾+蔬菜+水果\n• 频率：幼龟每天1次，成龟2-3天1次\n• 补充：钙粉+维生素D3\n\n【陆龟】\n• 饮食：素食为主，深绿叶菜+牧草+少量水果\n• 频率：每天1次\n• 补充：钙粉+UVB灯（促进钙吸收）\n\n【注意】\n1. 水龟在水中进食，喂食后清理残饵\n2. 食物大小不超过龟头部的1/2\n3. 蛋白质过多会导致甲壳变形\n4. 缺钙+缺UVB会导致软壳病/代谢性骨病'
    if pet_cat == '鱼':
        return f'【{label}喂食指南】\n\n【喂食原则】少量多餐，2-3分钟内吃完\n\n【分类型喂食】\n• 肉食性鱼（龙鱼/罗汉）：小鱼虾/红虫/专用粮\n• 杂食性鱼（金鱼/锦鲤）：颗粒粮+蔬菜+少量动物性饵料\n• 草食性鱼（清道夫）：藻类/蔬菜/专用粮\n\n【频率】\n• 成鱼：每天1-2次\n• 幼鱼：每天3-4次（生长需要）\n• 老年鱼：每天1次，减少量\n\n【注意】\n1. 不要过量喂食（残饵污染水质是第一杀手）\n2. 定期停食1天（帮助消化）\n3. 饵料要多样化，避免单一'
    return f'【{label}喂食建议】\n\n1. 根据年龄选择合适的饲料\n2. 定时定量，不要过量\n3. 随时提供新鲜饮水\n4. 注意禁忌食物（巧克力、洋葱、葡萄等）\n5. 换粮需逐步过渡'

def _build_emotion_reply(pet_cat):
    '''情绪 - 按宠物类型差异化'''

    label = _pet_label(pet_cat)
    if pet_cat == '狗':
        return f'【{label}情绪解读与安抚】\n\n【开心/放松】尾巴放松摇摆、身体舒展、眼神柔和 → 正常互动即可\n【紧张/害怕】夹尾巴、身体僵硬、耳朵后贴、哈气/低吼 → 给安静空间，不要强迫接触\n【焦虑】频繁踱步、舔舐、发抖、破坏物品 → 费洛蒙喷雾、安抚音乐、增加运动\n【攻击】龇牙、低吼、身体前倾 → 立即远离，不要对视，寻求专业训犬师帮助\n\n【安抚方法】\n1. 保持环境安静，减少刺激\n2. 用熟悉的毯子/玩具增加安全感\n3. 轻声说话，轻柔抚摸\n4. 费洛蒙（Adaptil）喷雾/扩散器\n5. 增加运动消耗精力'
    if pet_cat == '猫':
        return f'【{label}情绪解读与安抚】\n\n【放松】缓慢眨眼、身体舒展、呼噜 → 表示信任和舒适\n【紧张】耳朵后贴、身体压低、炸毛 → 给空间，不要强行抱\n【生气】甩尾巴、哈气、弓背 → 立即离开，等它冷静\n【焦虑】过度舔毛、躲藏、破坏 → 猫费洛蒙（Feliway）、增加垂直空间\n\n【安抚方法】\n1. 缓慢眨眼（猫的亲吻），表示无威胁\n2. 提供躲藏空间（纸箱/猫窝）\n3. 费洛蒙喷雾/扩散器\n4. 不要追逐或强行抚摸\n5. 保持日常作息稳定'
    if pet_cat == '兔':
        return f'【{label}情绪解读与安抚】\n\n【开心】轻快跳跃（binky）、甩头 → 非常开心\n【放松】侧躺/仰躺、磨牙（轻柔的咯咯声）→ 舒适满足\n【紧张】耳朵后贴、身体紧绷、跺脚 → 感到威胁\n【害怕】躲藏、呼吸急促、假死 → 极度恐惧\n【生气】喷尿、用前爪扑、低吼 → 领地意识或不满\n\n【安抚方法】\n1. 轻声说话，不要突然动作\n2. 让兔子主动靠近你\n3. 抚摸额头和背部（兔子喜欢）\n4. 保持环境安静，避免噪音\n5. 提供躲藏处'
    return f'【{label}情绪解读与安抚】\n\n【观察要点】\n1. 观察肢体语言（尾巴、耳朵、身体姿态）\n2. 注意食欲和活动量变化\n3. 异常行为（破坏、过度舔毛）可能是焦虑\n\n【安抚方法】\n1. 保持环境安静稳定\n2. 提供熟悉的物品增加安全感\n3. 轻声交流，轻柔互动\n4. 给予足够的活动空间\n5. 严重焦虑可咨询兽医或行为专家'

def _build_vaccine_reply(pet_cat):
    '''疫苗 - 按宠物类型差异化'''

    label = _pet_label(pet_cat)
    if pet_cat == '狗':
        return f'【{label}疫苗接种指南】\n\n【核心疫苗】\n• 犬瘟热、犬细小病毒、传染性肝炎、狂犬病（国家强制）\n\n【接种程序】\n• 6-8周龄：第一针（四联/六联）\n• 10-12周龄：第二针\n• 14-16周龄：第三针 + 狂犬疫苗\n• 之后每年加强1次\n\n【非核心疫苗】（根据地区和生活方式选择）\n• 犬副流感、钩端螺旋体、犬窝咳、莱姆病\n\n【注意】\n1. 接种前确保宠物健康，体温正常\n2. 接种后观察30分钟，有无过敏反应\n3. 接种后1周内不要洗澡、不要剧烈运动\n4. 未完成基础免疫前不要外出（避免接触传染源）\n\n⚠️ 狂犬疫苗每年必须接种，是法律要求！'
    if pet_cat == '猫':
        return f'【{label}疫苗接种指南】\n\n【核心疫苗】\n• 猫瘟（泛白细胞减少症）、猫鼻支（疱疹病毒）、猫杯状病毒、狂犬病\n\n【接种程序】\n• 6-8周龄：第一针（猫三联）\n• 10-12周龄：第二针 + 狂犬疫苗\n• 14-16周龄：第三针（如需要）\n• 之后每年加强1次\n\n【非核心疫苗】\n• 猫白血病（FeLV，外出猫必打）、猫传染性腹膜炎（FIP）\n\n【注意】\n1. 室内猫也需要接种核心疫苗\n2. 接种后观察30分钟\n3. 接种后1周不洗澡\n4. 多猫家庭建议接种猫白血病疫苗'
    if pet_cat == '兔':
        return f'【{label}疫苗接种指南】\n\n【核心疫苗】\n• 兔病毒性出血症（兔瘟）——必须接种\n• 兔巴氏杆菌病——建议接种\n\n【接种程序】\n• 30-45日龄：首免兔瘟疫苗\n• 60日龄：二免\n• 之后每半年加强1次\n\n【注意】\n1. 兔瘟是致死率极高的传染病，必须接种\n2. 接种前确保兔子健康\n3. 接种后观察24小时\n4. 疫苗需冷藏保存'
    if pet_cat == '鸟':
        return f'【{label}疫苗接种说明】\n\n鹦鹉目前常规可接种的疫苗较少，主要预防：\n• 多瘤病毒（APV）——雏鸟期接种\n• 鹦鹉喙羽症（PBFD）——部分地区有疫苗\n\n【更重要的预防措施】\n1. 新鸟隔离30-45天再混养\n2. 定期体检和粪便检查\n3. 保持笼具清洁消毒\n4. 避免接触野生鸟类\n5. 购买健康来源的鹦鹉\n\n⚠️ 鸟类疾病多为病毒性，无特效治疗，预防重于治疗。'
    return f'【{label}疫苗接种建议】\n\n1. 幼年开始接种核心疫苗，完成基础免疫\n2. 每年加强免疫一次\n3. 接种前确保宠物健康\n4. 接种后观察30分钟有无过敏\n5. 未完成免疫前避免外出接触其他动物'

def _build_eye_reply(pet_cat):
    '''眼睛 - 按宠物类型差异化'''

    label = _pet_label(pet_cat)
    if pet_cat == '狗':
        return f'【{label}眼部护理】\n\n【常见问题】\n• 泪痕（小型犬/短鼻犬常见，泪液过多或鼻泪管堵塞）\n• 结膜炎（红肿、分泌物增多）\n• 干眼症（泪液分泌不足，眼睛干涩）\n• 角膜溃疡（外伤导致，眼睛疼痛、眯眼）\n\n【日常护理】\n1. 每周检查眼睛，有无红肿、分泌物\n2. 用生理盐水棉球从眼角向外擦拭\n3. 长毛犬修剪眼周毛发\n4. 洗澡时避免沐浴露进入眼睛\n\n🚨 就医指征：持续流泪、眼屎增多、眼睛红肿、眯眼、视力下降超过24小时'
    if pet_cat == '猫':
        return f'【{label}眼部护理】\n\n【常见问题】\n• 猫鼻支（疱疹病毒，眼分泌物增多+打喷嚏）\n• 结膜炎（红肿、流泪）\n• 角膜溃疡（外伤，眼睛疼痛）\n• 青光眼（眼压升高，眼球变硬，急症）\n\n【日常护理】\n1. 观察眼睛是否明亮清澈\n2. 有分泌物用温水棉球擦拭\n3. 短鼻猫（波斯/加菲）需特别注意眼部清洁\n\n🚨 就医指征：眼睛红肿、流泪、畏光、眯眼、眼球突出/变硬'
    if pet_cat == '鸟':
        return f'【{label}眼部护理】\n\n【常见问题】\n• 结膜炎（红肿、分泌物，可能是衣原体感染——可传染人！）\n• 眼肿（鼻窦炎、维生素A缺乏）\n• 失明（老年、外伤、感染）\n\n【日常护理】\n1. 观察眼睛是否明亮有神\n2. 眼部有分泌物用温水棉签轻擦\n3. 保持笼内清洁，避免粉尘\n\n🚨 眼部分泌物+精神差+绿色便可能是鹦鹉热（衣原体），可传染人，需立即就医防护！'
    return f'【{label}眼部护理】\n\n1. 定期检查眼睛，注意红肿、分泌物\n2. 用生理盐水/温水清洁眼周\n3. 避免异物进入眼睛\n4. 异常持续超过24小时就医\n5. 不要随意使用人用眼药水'

def _build_ear_reply(pet_cat):
    '''耳朵 - 按宠物类型差异化'''

    label = _pet_label(pet_cat)
    if pet_cat == '狗':
        return f'【{label}耳部护理】\n\n【常见问题】\n• 耳螨（棕黑色分泌物、瘙痒、摇头）\n• 耳炎（异味、红肿、分泌物）\n• 耳血肿（耳朵肿胀，甩头导致血管破裂）\n\n【日常护理】\n1. 每周检查耳朵，有无异味/分泌物\n2. 用宠物专用耳清洁剂滴入，按摩耳根，让狗甩出\n3. 垂耳犬（可卡/金毛）需更频繁清洁\n4. 洗澡后擦干耳朵水分\n\n⚠️ 不要用棉签深入耳道！会把耳垢推得更深或损伤耳膜。'
    if pet_cat == '猫':
        return f'【{label}耳部护理】\n\n【常见问题】\n• 耳螨（最常见，棕黑色煤渣样分泌物、剧烈瘙痒）\n• 耳炎（异味、红肿）\n\n【日常护理】\n1. 每月检查耳朵1-2次\n2. 有分泌物用宠物耳清洁剂清洁\n3. 多猫家庭发现耳螨需全部治疗\n\n⚠️ 耳螨可在猫之间传播，发现后需隔离治疗并清洁环境。'
    if pet_cat == '兔':
        return f'【{label}耳部护理】\n\n【常见问题】\n• 耳螨（兔子最常见！耳内厚痂、频繁甩头、抓耳）\n• 耳炎（异味、分泌物）\n\n【日常护理】\n1. 每月检查耳朵\n2. 发现耳螨需伊维菌素注射（兽医处方）\n3. 清洁笼具，耳螨可传染\n\n🚨 兔耳螨不治疗会导致中耳炎/内耳炎，影响平衡甚至危及生命！'
    if pet_cat == '鸟':
        return f'【{label}耳部护理】\n\n鹦鹉的耳朵被羽毛覆盖，不易观察。\n\n【常见问题】\n• 耳螨/感染（抓耳、甩头、平衡失调）\n• 中耳炎（歪头、转圈、平衡问题）\n\n【日常护理】\n1. 保持笼内清洁干燥\n2. 观察有无抓耳、歪头等异常\n3. 不要自行清理耳道\n\n🚨 歪头+转圈+平衡失调可能是中耳炎或神经症状，需立即就医！'
    return f'【{label}耳部护理】\n\n1. 定期检查耳朵，注意异味和分泌物\n2. 使用宠物专用耳清洁剂\n3. 不要用棉签深入耳道\n4. 洗澡后保持耳朵干燥\n5. 频繁抓耳/摇头/异味需就医'

def _build_teeth_reply(pet_cat):
    '''牙齿/口腔 - 按宠物类型差异化'''

    label = _pet_label(pet_cat)
    if pet_cat == '狗':
        return f'【{label}口腔护理】\n\n【常见问题】\n• 牙结石（黄色/褐色沉积物，口臭）\n• 牙龈炎（牙龈红肿、出血）\n• 牙周病（牙齿松动、牙龈萎缩）\n\n【日常护理】\n1. 每周刷牙2-3次，用宠物专用牙膏（人用牙膏有毒！）\n2. 提供洁牙棒/咬胶帮助清洁\n3. 每年1-2次专业洁牙（需麻醉）\n4. 从小开始训练刷牙习惯\n\n⚠️ 口腔疾病会导致心脏、肾脏问题，不容忽视！'
    if pet_cat == '猫':
        return f'【{label}口腔护理】\n\n【常见问题】\n• 牙结石（口臭、牙龈红肿）\n• 猫口炎（口腔严重炎症，流口水、进食困难）\n• 牙龈增生\n\n【日常护理】\n1. 每周刷牙，用猫专用牙膏\n2. 湿粮+干粮搭配（干粮有一定清洁作用）\n3. 观察口腔有无红肿、溃疡\n4. 口臭明显需就医检查\n\n⚠️ 猫口炎非常痛苦，会导致拒食，需兽医治疗。'
    if pet_cat == '兔':
        return f'【{label}口腔/牙齿护理】\n\n【兔子牙齿特点】牙齿终生生长，需要不断磨损\n\n【常见问题】\n• 门牙过长（无法进食、流口水）\n• 臼齿过长（戳伤口腔黏膜）\n• 咬合不正\n\n【日常护理】\n1. 提供无限量干草（磨牙是关键！）\n2. 苹果木/磨牙石辅助磨牙\n3. 定期检查门牙长度\n4. 发现进食困难/流口水需就医剪牙\n\n🚨 牙齿过长无法进食会导致饿死，必须定期检查！'
    if pet_cat == '鸟':
        return f'【{label}喙部护理】\n\n【鹦鹉喙部特点】喙会不断生长，需要磨损\n\n【常见问题】\n• 喙过长（影响进食）\n• 喙变形（缺乏矿物质、PBFD病毒）\n• 喙部损伤\n\n【日常护理】\n1. 提供墨鱼骨/矿物质块补充钙质并帮助磨喙\n2. 提供啃咬玩具\n3. 观察喙的形状和颜色\n4. 喙过长需兽医修剪（不要自行剪！）\n\n⚠️ 喙变形+羽毛异常可能是PBFD（致命病毒），需就医检查。'
    return f'【{label}口腔护理】\n\n1. 定期检查口腔和牙齿\n2. 使用宠物专用牙膏刷牙\n3. 提供洁牙零食/玩具\n4. 口臭、牙龈红肿、进食困难需就医\n5. 每年专业洁牙1-2次'

def _build_cough_reply(pet_cat):
    '''咳嗽/呼吸 - 按宠物类型差异化'''

    label = _pet_label(pet_cat)
    if pet_cat == '狗':
        return f"【{label}咳嗽/呼吸问题】\n\n【常见原因】\n• 犬窝咳（传染性气管支气管炎，阵发性干咳，'鹅叫'样咳嗽）\n• 肺炎（湿咳、发烧、精神差、呼吸急促）\n• 心脏病（老年犬，咳嗽+运动不耐受+腹部胀大）\n• 气管塌陷（小型犬，激动/喝水后咳嗽）\n• 异物吸入（突然剧烈咳嗽）\n• 心丝虫病（咳嗽+运动不耐受，蚊子传播）\n\n【处理建议】\n1. 观察咳嗽类型（干咳/湿咳）、频率、诱因\n2. 测量体温（正常37.5-39.2°C）\n3. 减少剧烈运动，保持空气湿润\n4. 不要自行喂止咳药（需先确诊）\n\n🚨 紧急就医：呼吸急促/困难、舌头发紫、咳嗽带血、精神萎靡"
    if pet_cat == '猫':
        return f'【{label}咳嗽/呼吸问题】\n\n【常见原因】\n• 猫哮喘（过敏性支气管炎，阵发性咳嗽+喘鸣）\n• 上呼吸道感染（猫鼻支/杯状病毒，咳嗽+打喷嚏+眼分泌物）\n• 肺炎（湿咳、发烧、呼吸急促）\n• 胸水/腹水（呼吸急促、腹围增大）\n• 心脏病（左心衰导致肺水肿）\n• 异物/毛球（突然咳嗽）\n\n【处理建议】\n1. 观察呼吸频率（正常20-30次/分钟）\n2. 避免烟雾、香水、粉尘刺激\n3. 保持室内空气流通\n4. 咳嗽+打喷嚏可能是猫鼻支，需就医\n\n🚨 紧急就医：张口呼吸、呼吸急促>40次/分、舌头发紫、无法平卧'
    if pet_cat == '鸟':
        return f'【{label}呼吸问题】\n\n【常见原因】\n• 呼吸道感染（打喷嚏、鼻分泌物、呼吸有声）\n• 鹦鹉热（衣原体，精神差+眼鼻分泌物+绿色便，可传染人）\n• 气囊螨（呼吸时有咔嗒声、尾巴随呼吸摆动）\n• 中毒（吸入有毒气体如不粘锅油烟）\n• 维生素A缺乏（呼吸道黏膜问题）\n\n【处理建议】\n1. 立即保温（28-30°C）\n2. 保持空气清洁，远离烟雾/油烟\n3. 观察呼吸频率和方式\n4. 鸟类呼吸问题恶化极快\n\n🚨 张口呼吸、尾巴随呼吸摆动、精神差 → 立即就医！'
    if pet_cat == '兔':
        return f'【{label}呼吸问题】\n\n【常见原因】\n• 巴氏杆菌感染（最常见，喷嚏+白色/黄色鼻分泌物）\n• 鼻炎（流清涕、打喷嚏）\n• 肺炎（呼吸急促、精神差、食欲下降）\n• 牙齿问题（门牙过长顶到鼻腔导致流泪/喷嚏）\n• 热应激（>28°C，呼吸急促、耳朵发烫）\n\n【处理建议】\n1. 保持环境温度15-25°C\n2. 清洁鼻子周围分泌物\n3. 检查门牙是否过长\n4. 喷嚏+脓性分泌物需抗生素治疗\n\n🚨 兔子呼吸急促+精神差+不进食 → 立即就医！'
    return f'【{label}咳嗽/呼吸问题】\n\n【观察要点】\n1. 咳嗽类型（干咳/湿咳）和频率\n2. 呼吸频率是否正常\n3. 有无鼻涕、眼分泌物\n4. 精神和食欲是否受影响\n\n🚨 呼吸急促、困难、发紫 → 立即就医！'

def _build_urinary_reply(pet_cat):
    '''泌尿/排尿 - 按宠物类型差异化'''

    label = _pet_label(pet_cat)
    if pet_cat == '狗':
        return f'【{label}泌尿问题】\n\n【常见问题】\n• 尿频/尿急（膀胱炎、尿路感染）\n• 尿血（膀胱炎、结石、外伤）\n• 尿失禁（老年犬、神经系统问题）\n• 排尿困难/尿闭（结石堵塞尿道，急症！）\n\n【处理建议】\n1. 增加饮水（促进排尿，冲刷尿道）\n2. 观察尿色、尿量、排尿频率\n3. 不要憋尿（及时带外出）\n4. 尿血/尿频需就医做尿检\n\n🚨 紧急就医：频繁排尿但无尿、尿血量大、排尿时疼痛嚎叫（可能尿道堵塞！）'
    if pet_cat == '猫':
        return f'【{label}泌尿问题】\n\n【常见问题】\n• 猫下泌尿道疾病（FLUTD）：尿频、尿血、排尿困难\n• 尿闭（公猫最危险！尿道堵塞，48h内可致死）\n• 膀胱炎（特发性或细菌性）\n• 尿结石（草酸钙/鸟粪石）\n\n【处理建议】\n1. 增加饮水（流动饮水机、湿粮）\n2. 保持猫砂盆清洁\n3. 减少应激（应激是FLUTD常见诱因）\n4. 观察猫砂盆尿团大小和数量\n\n🚨 紧急就医：公猫频繁进出猫砂盆但无尿/尿血+精神差 → 尿闭急症！不及时处理会导致膀胱破裂/肾衰死亡！'
    if pet_cat == '兔':
        return f'【{label}泌尿问题】\n\n【兔子尿液特点】\n• 正常尿液：黄色/橙色/红色（红色是正常的！钙代谢产物）\n• 正常排泄：每天多次，尿液+粪便\n\n【常见问题】\n• 尿钙（白色浑浊尿，钙摄入过多）\n• 尿结石（排尿困难、尿血、精神差）\n• 尿频/尿失禁\n\n【处理建议】\n1. 减少高钙食物（苜蓿草只给幼兔）\n2. 增加饮水\n3. 观察尿液颜色和量\n\n🚨 红色尿是正常的！但排尿困难/无尿/精神差 → 就医。'
    return f'【{label}泌尿问题】\n\n【观察要点】\n1. 排尿频率、尿量、尿色\n2. 排尿时是否有疼痛表现\n3. 是否有尿血、尿频\n\n🚨 排尿困难、无尿、大量尿血 → 立即就医！'

def _build_weight_reply(pet_cat):
    '''体重/肥胖/消瘦 - 按宠物类型差异化'''

    label = _pet_label(pet_cat)
    if pet_cat == '狗':
        return f'【{label}体重管理】\n\n【理想体型判断】从上方看有腰线，从侧面看腹部上收，能摸到肋骨（有脂肪层覆盖）\n\n【肥胖危害】糖尿病、关节炎、心脏病、皮肤病、寿命缩短\n\n【减肥方案】\n1. 减少食量10-20%，换减肥粮\n2. 增加运动（每天30-60分钟）\n3. 停止零食和人食\n4. 每月称体重，目标每月减2-3%\n\n【消瘦原因】寄生虫、疾病（糖尿病/甲亢/肿瘤）、营养不良\n🚨 突然消瘦需就医排查疾病！'
    if pet_cat == '猫':
        return f'【{label}体重管理】\n\n【理想体型】有腰线，能摸到肋骨，腹部不松弛\n\n【肥胖危害】糖尿病、脂肪肝、关节炎、泌尿问题\n\n【减肥方案】\n1. 减少食量，用处方减肥粮\n2. 增加运动（逗猫棒每天15分钟）\n3. 停止零食\n4. 多猫家庭分开喂食\n\n【消瘦】突然消瘦需排查甲亢（老年猫常见）、糖尿病、肾病、寄生虫\n🚨 猫减肥不能太快！快速减重会导致脂肪肝（致命）。'
    return f'【{label}体重管理】\n\n1. 定期称重，记录体重变化\n2. 肥胖需减少食量+增加运动\n3. 突然消瘦需就医排查疾病\n4. 按照品种/年龄标准体重参考\n5. 减肥要循序渐进，不要节食'

def _build_reproduction_reply(pet_cat):
    '''繁殖/发情 - 按宠物类型差异化'''

    label = _pet_label(pet_cat)
    if pet_cat == '狗':
        return f'【{label}繁殖/发情】\n\n【发情周期】母犬每年发情2次，每次约3周\n【发情表现】外阴肿胀、流血、尿频、吸引公犬\n【最佳配种时间】发情第9-13天（流血减少、分泌物变黄、接受公犬）\n\n【怀孕期】约63天\n【分娩征兆】体温下降、焦躁、刨窝、食欲下降\n\n【注意】\n1. 不建议自行配种，建议绝育（避免意外怀孕和生殖系统疾病）\n2. 首次发情不建议配种（身体未发育完全）\n3. 假孕：未怀孕却出现怀孕症状，需就医\n\n🚨 分娩超过2小时无进展、大出血、胎儿卡住 → 立即就医！'
    if pet_cat == '猫':
        return f'【{label}繁殖/发情】\n\n【发情周期】母猫季节性多次发情，春秋季为主，每次1-2周\n【发情表现】叫春、打滚、翘屁股、蹭人、食欲下降\n【排卵】刺激性排卵，需交配才排卵\n\n【怀孕期】约63-65天\n【分娩征兆】体温下降、不安、找窝\n\n【注意】\n1. 强烈建议绝育！猫繁殖能力极强，流浪猫问题严重\n2. 发情期不要洗澡，不要外出\n3. 假孕：乳头肿胀、做窝，2-3周后自行恢复\n\n🚨 母猫发情期叫声扰民，建议6-8月龄绝育。'
    if pet_cat == '兔':
        return f'【{label}繁殖/发情】\n\n【兔子繁殖特点】刺激性排卵，全年可繁殖，繁殖力极强\n【发情表现】活跃、喷尿、下巴蹭东西、接受交配\n\n【怀孕期】30-32天\n【每胎】4-12只\n\n【注意】\n1. 兔子繁殖极快，不建议自行繁殖\n2. 公母必须分笼饲养\n3. 强烈建议绝育（减少生殖系统癌症、喷尿、攻击行为）\n4. 母兔可能假孕（做窝、拔毛）\n\n🚨 兔子子宫癌发生率极高（>80%），建议母兔绝育！'
    if pet_cat == '鸟':
        return f'【{label}繁殖/发情】\n\n【鹦鹉发情表现】\n• 公鸟：吐食、求偶舞蹈、变凶（领地意识）\n• 母鸟：频繁下蛋、做窝、变温顺\n\n【不建议繁殖的原因】\n1. 鹦鹉繁殖需要专业知识和设备\n2. 母鸟频繁下蛋会缺钙/蛋阻留，危及生命\n3. 雏鸟喂养需要专业技能\n\n【抑制发情的方法】\n1. 减少日照时间（8-10小时）\n2. 减少抚摸背部/翅膀（会刺激性兴奋）\n3. 移除巢箱/窝\n4. 增加活动和玩具\n\n🚨 母鸟频繁下蛋+精神差+腹部膨大 → 可能蛋阻留，立即就医！'
    return f'【{label}繁殖/发情建议】\n\n1. 了解宠物的发情周期和表现\n2. 不建议自行繁殖，建议绝育\n3. 发情期加强看护，避免意外怀孕\n4. 假孕是正常现象，一般自行恢复\n5. 分娩异常立即就医'

def _build_injury_reply(pet_cat):
    '''外伤/出血 - 按宠物类型差异化'''

    label = _pet_label(pet_cat)
    if pet_cat == '狗':
        return f'【{label}外伤/出血处理】\n\n【轻微外伤/擦伤】\n1. 用生理盐水冲洗伤口\n2. 碘伏消毒（不要用酒精/碘酒，刺激大）\n3. 保持干燥，戴伊丽莎白圈防止舔舐\n4. 每天观察有无感染（红肿、化脓、异味）\n\n【出血处理】\n1. 用干净纱布按压止血（不要频繁查看）\n2. 持续按压5-10分钟\n3. 四肢出血可在伤口近心端结扎（每15分钟放松1次）\n4. 出血不止立即就医\n\n🚨 紧急就医：大出血、伤口深可见骨/内脏、动物咬伤（感染风险高）、骨折、车祸后'
    if pet_cat == '猫':
        return f'【{label}外伤/出血处理】\n\n【轻微外伤】\n1. 生理盐水冲洗\n2. 碘伏消毒\n3. 戴伊丽莎白圈（猫会舔伤口导致感染）\n\n【出血处理】\n1. 纱布按压止血\n2. 持续按压5-10分钟\n3. 出血不止就医\n\n【猫咬伤/抓伤】（猫的伤口极易感染！）\n1. 彻底冲洗\n2. 碘伏消毒\n3. 口服抗生素（必须就医）\n4. 观察有无红肿、发热\n\n🚨 猫咬伤后24-48小时内可能出现严重感染（猫抓病），需立即就医用抗生素！'
    if pet_cat == '鸟':
        return f'【{label}外伤/出血处理】\n\n【重要】鹦鹉出血可能危及生命（血液量少）！\n\n【出血处理】\n1. 用干净纱布/棉签按压止血\n2. 断羽出血：直接拔掉断裂的羽毛（羽轴是出血源）\n3. 指甲出血：用止血粉/淀粉按压\n4. 持续出血立即就医\n\n【外伤处理】\n1. 生理盐水冲洗\n2. 碘伏消毒（少量）\n3. 保持伤口干燥\n4. 防止鹦鹉啄伤口\n\n🚨 鹦鹉少量出血就可能致命，任何出血都要重视！'
    return f'【{label}外伤/出血处理】\n\n【处理原则】\n1. 先止血（按压）\n2. 再清洁（生理盐水冲洗）\n3. 消毒（碘伏）\n4. 防止舔舐/抓挠\n5. 观察感染迹象\n\n🚨 大出血、伤口深、动物咬伤、骨折 → 立即就医！'

def _build_poisoning_reply(pet_cat):
    '''中毒 - 按宠物类型差异化'''

    label = _pet_label(pet_cat)
    if pet_cat == '狗':
        return f'【{label}中毒处理】\n\n【常见毒物】\n• 巧克力（可可碱，100mg/kg致命）\n• 葡萄/葡萄干（肾衰竭，10-30g/kg致命）\n• 洋葱/大蒜（溶血，5g/kg致命）\n• 木糖醇（低血糖、肝衰竭）\n• 灭鼠药、农药、人用药\n\n【应急处理】\n1. 立即移除毒物\n2. 不要自行催吐（腐蚀性毒物催吐更危险）\n3. 记录毒物名称、摄入量、时间\n4. 立即就医（带毒物包装）\n\n🚨 中毒是急症！越早处理存活率越高，不要观察等待！'
    if pet_cat == '猫':
        return f'【{label}中毒处理】\n\n【常见毒物】\n• 百合花（全株有毒，舔花粉都可致肾衰竭！）\n• 洋葱/大蒜（溶血）\n• 对乙酰氨基酚（人用感冒药，1片即可致命）\n• 驱蚊液/精油（猫肝代谢能力差）\n• 防冻液（乙二醇，甜味，1.5ml/kg致命）\n\n【应急处理】\n1. 立即移除毒物\n2. 百合花接触 → 立即用清水冲洗毛发（防止舔入）+ 立即就医\n3. 不要自行催吐/给药\n4. 带毒物包装立即就医\n\n🚨 猫中毒极危险！百合花中毒6小时内不治疗就会肾衰竭！'
    if pet_cat == '鸟':
        return f'【{label}中毒处理】\n\n【常见毒物】\n• 不粘锅过热油烟（PTFE，致命！）\n• 喷雾剂（空气清新剂、香水、发胶）\n• 牛油果（心脏毒素）\n• 巧克力、咖啡因\n• 重金属（锌、铅，啃咬笼具/玩具）\n\n【应急处理】\n1. 立即将鹦鹉移到空气新鲜处\n2. 保温（28-30°C）\n3. 不要自行给药\n4. 带可疑毒物立即就医\n\n🚨 鸟类对有毒气体极敏感，不粘锅油烟可在几分钟内致死！'
    if pet_cat == '兔':
        return f'【{label}中毒处理】\n\n【常见毒物】\n• 杀虫剂/农药（兔子极其敏感）\n• 某些植物（百合、水仙、郁金香、杜鹃花）\n• 人用药（对乙酰氨基酚等）\n• 巧克力、洋葱、大蒜\n\n【应急处理】\n1. 立即移除毒物\n2. 不要自行催吐（兔子不会呕吐！）\n3. 喂食干草促进肠道蠕动\n4. 立即就医\n\n🚨 兔子不会呕吐，无法通过催吐排毒，需尽快就医用活性炭等治疗。'
    return f'【{label}中毒处理】\n\n【常见毒物】巧克力、洋葱/大蒜、葡萄、人用药、杀虫剂、清洁剂\n\n【应急处理】\n1. 立即移除毒物\n2. 记录毒物信息（名称、量、时间）\n3. 不要自行催吐/给药\n4. 立即就医（带毒物包装）\n\n🚨 中毒是急症！越早处理存活率越高！'

def _build_elderly_reply(pet_cat):
    '''老年护理 - 按宠物类型差异化'''

    label = _pet_label(pet_cat)
    if pet_cat == '狗':
        return f'【{label}老年护理】（7岁以上为老年，小型犬可延后）\n\n【饮食】\n• 换老年粮（低蛋白、低磷、易消化）\n• 少量多餐，避免肥胖\n• 补充关节保健品（葡萄糖胺、软骨素）\n\n【健康】\n• 每年体检2次（血常规、生化、心脏、腹部B超）\n• 关注关节退化、心脏病、肾病、肿瘤\n• 定期驱虫和疫苗\n\n【生活】\n• 适度运动（避免剧烈）\n• 保暖，避免上下楼梯\n• 提供柔软睡垫\n• 陪伴和互动\n\n💡 老年犬更需要陪伴，多花时间陪它。'
    if pet_cat == '猫':
        return f'【{label}老年护理】（7岁以上为老年）\n\n【饮食】\n• 换老年粮（易消化、低磷、控制钠）\n• 增加湿粮比例（补水）\n• 少量多餐\n\n【健康】\n• 每年体检2次（重点：肾功能、甲状腺、心脏）\n• 老年猫常见：慢性肾病、甲亢、糖尿病、心肌病\n• 定期驱虫\n\n【生活】\n• 提供低边猫砂盆（方便进出）\n• 食物和水放在易接近处\n• 保暖，避免跳跃\n• 多陪伴\n\n💡 老年猫更需要定期体检，早发现问题早治疗。'
    return f'【{label}老年护理】\n\n1. 换老年专用粮\n2. 每年体检2次\n3. 适度运动，避免剧烈\n4. 保暖，提供舒适环境\n5. 多陪伴，关注行为变化\n6. 定期驱虫和疫苗'

def _build_new_pet_reply(pet_cat):
    '''新宠到家 - 按宠物类型差异化'''

    label = _pet_label(pet_cat)
    if pet_cat == '狗':
        return f'【新{label}到家指南】\n\n【到家前准备】\n• 食盆、水盆、狗粮（先问卖家原来吃什么）\n• 狗窝/围栏、尿垫、玩具\n• 牵引绳、项圈\n\n【到家第一周】\n1. 保持环境安静，不要频繁逗弄\n2. 先喂原来的粮，不要立即换粮\n3. 训练定点排便（饭后/睡醒后引导）\n4. 不要洗澡（应激+未免疫易生病）\n5. 不要外出（未完成疫苗）\n6. 观察精神、食欲、排便\n\n【健康检查】\n• 到家3-7天后体检+驱虫\n• 健康状态下开始接种疫苗\n• 完成基础免疫前不洗澡不外出'
    if pet_cat == '猫':
        return f'【新{label}到家指南】\n\n【到家前准备】\n• 猫砂盆（N+1原则）、猫砂\n• 猫粮（问卖家原来吃什么）、食盆、水盆\n• 猫窝、猫抓板、玩具\n\n【到家第一周】\n1. 先关在一个房间，让猫慢慢适应\n2. 不要强行抱猫，让它主动探索\n3. 先喂原来的粮\n4. 不要洗澡\n5. 观察食欲、排便、精神\n6. 提供躲藏空间（纸箱）\n\n【健康检查】\n• 到家3-7天后体检+驱虫\n• 健康状态下接种疫苗\n• 新猫到家需隔离（如家中已有猫）'
    if pet_cat == '兔':
        return f'【新{label}到家指南】\n\n【到家前准备】\n• 足够大的笼子（至少能站起来+跳3步）\n• 提摩西草（无限量）、兔粮\n• 滚珠水壶、食盆\n• 垫料（木屑/纸粒）\n\n【到家第一周】\n1. 保持安静，兔子极易应激\n2. 先喂提摩西草+少量兔粮\n3. 不要频繁抱它\n4. 不要洗澡\n5. 观察进食和排便（兔子不进食是急症！）\n\n【健康检查】\n• 到家后体检（重点：球虫、牙齿）\n• 幼兔必须预防球虫病\n• 接种兔瘟疫苗'
    return '【新宠到家指南】\n\n1. 提前准备好食具、寝具、饲料\n2. 第一周保持安静，减少应激\n3. 先喂原来的饲料，不要突然换粮\n4. 不要洗澡，不要外出\n5. 观察精神、食欲、排便\n6. 3-7天后体检+驱虫+疫苗'

def _build_neuter_reply(pet_cat):
    '''绝育 - 按宠物类型差异化'''

    label = _pet_label(pet_cat)
    if pet_cat == '狗':
        return f'【{label}绝育指南】\n\n【绝育时间】公狗6-12月龄，母狗第一次发情后（约8-12月龄）\n\n【绝育好处】\n• 公狗：减少前列腺疾病、睾丸癌、攻击行为、标记行为\n• 母狗：预防乳腺肿瘤、子宫蓄脓、卵巢癌\n• 避免意外怀孕\n\n【术前准备】\n1. 术前8-12小时禁食，4小时禁水\n2. 确保健康，已完成疫苗\n3. 术前体检（血常规、生化）\n\n【术后护理】\n1. 戴伊丽莎白圈7-10天，防止舔伤口\n2. 限制剧烈运动\n3. 观察伤口有无红肿、渗液\n4. 术后6小时可少量饮水进食\n5. 7-10天拆线\n\n💡 绝育可延长寿命1-2年，减少多种疾病风险。'
    if pet_cat == '猫':
        return f'【{label}绝育指南】\n\n【绝育时间】公猫6-8月龄，母猫6-8月龄（首次发情前）\n\n【绝育好处】\n• 公猫：减少喷尿标记、攻击、 roam、睾丸癌\n• 母猫：预防乳腺肿瘤、子宫蓄脓、卵巢癌\n• 减少发情期叫声和扰民\n• 避免意外怀孕（猫繁殖力极强）\n\n【术前准备】\n1. 术前8小时禁食，4小时禁水\n2. 确保健康，已完成疫苗\n3. 术前体检\n\n【术后护理】\n1. 戴伊丽莎白圈7-10天\n2. 限制跳跃\n3. 观察伤口\n4. 公猫当天可恢复，母猫需3-5天\n\n💡 猫绝育建议在首次发情前，可大幅降低乳腺肿瘤风险。'
    if pet_cat == '兔':
        return f'【{label}绝育指南】\n\n【绝育时间】4-6月龄（性成熟前后）\n\n【绝育好处】\n• 母兔：预防子宫癌（发生率>80%！）、子宫蓄脓\n• 公兔：减少喷尿、攻击、假孕\n• 延长寿命\n\n【术前准备】\n1. 兔子绝育不断食（兔子不能长时间空腹！）\n2. 找有兔科经验的兽医（兔麻醉风险较高）\n3. 术前体检\n\n【术后护理】\n1. 戴伊丽莎白圈\n2. 提供柔软垫料\n3. 术后尽快让兔子进食（防止肠胃停滞）\n4. 观察伤口和精神食欲\n\n🚨 母兔子宫癌发生率超过80%，强烈建议绝育！'
    return f'【{label}绝育指南】\n\n【绝育好处】\n1. 预防生殖系统疾病\n2. 减少发情相关行为问题\n3. 避免意外怀孕\n4. 延长寿命\n\n【术前准备】\n1. 术前禁食禁水（遵医嘱）\n2. 确保健康\n3. 术前体检\n\n【术后护理】\n1. 戴伊丽莎白圈\n2. 限制活动\n3. 观察伤口\n4. 按时拆线'

def _build_sleep_reply(pet_cat):
    '''睡觉/睡眠 - 按宠物类型差异化'''

    label = _pet_label(pet_cat)
    if pet_cat == '狗':
        return f'【{label}睡眠】\n\n【睡眠时长】幼犬18-20小时/天，成犬12-14小时/天\n\n【睡眠特点】\n• 狗是浅睡眠多，深睡眠少（随时保持警觉）\n• 睡觉时会抽动、吠叫、摇尾巴（做梦中）\n• 喜欢睡在主人身边（安全感）\n\n【睡眠环境】\n1. 安静、温暖的角落\n2. 舒适的狗窝/垫子\n3. 不要频繁打扰睡觉的狗\n4. 幼犬需要更多睡眠，不要过度玩耍\n\n💡 充足睡眠对狗的健康和行为非常重要。'
    if pet_cat == '猫':
        return f'【{label}睡眠】\n\n【睡眠时长】12-16小时/天（老年猫可达20小时）\n\n【睡眠特点】\n• 猫是夜行性动物，白天多睡觉，傍晚活跃\n• 70%的睡眠是浅睡（随时可醒）\n• 睡觉时胡须抽动、爪子抽动（做梦）\n• 喜欢睡在高处（安全感+观察环境）\n\n【睡眠环境】\n1. 温暖、安静的地方\n2. 提供猫窝/纸箱\n3. 不要打扰熟睡的猫\n\n💡 猫的睡眠是为了保存能量（捕猎本能），正常现象。'
    return f'【{label}睡眠】\n\n1. 提供安静、温暖、舒适的睡眠环境\n2. 不要频繁打扰睡眠中的宠物\n3. 幼年期需要更多睡眠\n4. 睡眠时抽动/发声通常是做梦，正常\n5. 嗜睡+精神差可能是疾病信号，需观察'

AI_CONSULT_RULES = [{'keywords': ['不吃', '不吃饭', '不进食', '厌食', '没胃口', '不吃东西', '食欲不振', '没食欲', '拒食'], 'category': '饮食问题', 'reply_fn': _build_anorexia_reply}, {'keywords': ['拉稀', '腹泻', '拉肚子', '软便', '水样便', '便稀'], 'category': '消化系统', 'reply_fn': _build_diarrhea_reply}, {'keywords': ['呕吐', '吐了', '反胃', '干呕', '吐黄水', '吐白沫'], 'category': '消化系统', 'reply_fn': _build_vomiting_reply}, {'keywords': ['皮肤', '掉毛', '脱毛', '红疹', '皮屑', '瘙痒', '抓挠', '红斑', '癣', '皮炎', '啄羽', '啄毛', '白点', '烂肉', '水霉', '壳', '甲壳', '腐甲', '腐皮', '白眼', '烂嘴', '软甲', '发软'], 'category': '皮肤问题', 'reply_fn': _build_skin_reply}, {'keywords': ['生病', '异常', '不舒服', '没精神', '精神不好', '蔫了', '精神萎靡', '精神差', '状态不好'], 'category': '健康判断', 'reply_fn': _build_general_health_reply}, {'keywords': ['咳嗽', '打喷嚏', '呼吸', '喘气', '气喘', '呼吸急促', '呼吸困难', '鼻塞', '喘鸣', '侧浮', '浮水', '张口呼吸', '鼻冒泡'], 'category': '呼吸系统', 'reply_fn': _build_cough_reply}, {'keywords': ['泌尿', '排尿', '尿频', '尿血', '尿闭', '尿失禁', '不尿', '尿不出来', '尿少', '尿色'], 'category': '泌尿系统', 'reply_fn': _build_urinary_reply}, {'keywords': ['体重', '肥胖', '太胖', '消瘦', '太瘦', '增重', '减肥', '变瘦', '长胖'], 'category': '体重管理', 'reply_fn': _build_weight_reply}, {'keywords': ['发情', '繁殖', '配种', '怀孕', '分娩', '生产', '下崽', '假孕', '来月经', '姨妈'], 'category': '繁殖生育', 'reply_fn': _build_reproduction_reply}, {'keywords': ['外伤', '出血', '流血', '伤口', '破皮', '骨折', '撞伤', '咬伤', '抓伤', '止血'], 'category': '外伤处理', 'reply_fn': _build_injury_reply}, {'keywords': ['中毒', '误食', '吃了有毒', '巧克力', '葡萄', '百合', '中毒了'], 'category': '中毒急救', 'reply_fn': _build_poisoning_reply}, {'keywords': ['老年', '老了', '高龄', '年纪大', '老年犬', '老年猫', '衰老'], 'category': '老年护理', 'reply_fn': _build_elderly_reply}, {'keywords': ['新到家', '新来', '刚买', '刚养', '新宠', '第一次养', '新手', '刚接回来'], 'category': '新宠护理', 'reply_fn': _build_new_pet_reply}, {'keywords': ['绝育', '阉割', '去势', '结扎', '做手术', '绝育手术'], 'category': '绝育手术', 'reply_fn': _build_neuter_reply}, {'keywords': ['睡觉', '睡眠', '嗜睡', '睡不着', '打呼噜', '做梦'], 'category': '睡眠休息', 'reply_fn': _build_sleep_reply}, {'keywords': ['上厕所', '定点', '厕所训练', '排便训练', '大小便', '拉屎', '拉尿', '随地'], 'category': '行为训练', 'reply_fn': _build_toilet_training_reply}, {'keywords': ['训练', '听话', '指令', '坐下', '握手', '指令训练', '不听话', '教'], 'category': '行为训练', 'reply_fn': _build_basic_training_reply}, {'keywords': ['洗澡', '清洁', '沐浴', '洗澡频率', '多久洗'], 'category': '日常护理', 'reply_fn': _build_bath_reply}, {'keywords': ['驱虫', '除虫', '寄生虫', '跳蚤', '蜱虫', '螨虫'], 'category': '健康护理', 'reply_fn': _build_deworming_reply}, {'keywords': ['喂食', '狗粮', '猫粮', '饲料', '饮食', '吃什么', '营养', '怎么喂', '喂多少'], 'category': '饮食营养', 'reply_fn': _build_feeding_reply}, {'keywords': ['情绪', '心情', '开心', '紧张', '害怕', '恐惧', '焦虑', '咬人', '凶'], 'category': '情绪行为', 'reply_fn': _build_emotion_reply}, {'keywords': ['疫苗', '打针', '预防针', '接种', '免疫'], 'category': '健康护理', 'reply_fn': _build_vaccine_reply}, {'keywords': ['眼睛', '流泪', '眼屎', '眼疾', '视力', '红眼', '眼肿', '白眼', '眼睑'], 'category': '健康护理', 'reply_fn': _build_eye_reply}, {'keywords': ['耳朵', '耳螨', '耳炎', '耳朵护理', '耳臭', '甩头'], 'category': '健康护理', 'reply_fn': _build_ear_reply}, {'keywords': ['牙齿', '口腔', '口臭', '牙结石', '刷牙', '换牙'], 'category': '健康护理', 'reply_fn': _build_teeth_reply}]
ZOONOSIS_ITEMS = [('鹦鹉热', '鹦鹉', '鹦鹉衣原体病，可传人，须重点防护'), ('狂犬病', '犬', '100% 人畜共患，属法定报告传染病'), ('猫癣', '猫', '皮肤真菌感染，轻度人畜共患，免疫低下者尤需注意'), ('钩端螺旋体', '犬', '接触被污染水源/尿液可传人，可接种疫苗预防')]

def _with_zoonosis_warning(text):
    '''若内容涉及人畜共患病，追加醒目警示'''

    if not text:
        return text
    hit = [it for it in ZOONOSIS_ITEMS if it[0] in text]
    if not hit:
        return text
    lines = ['\n\n🚨【人畜共患风险警示】']
    for name, sp, desc in hit:
        lines.append(f'• {name!s}（{sp!s}）：{desc!s}')
    lines.append('请做好个人防护，接触后及时洗手；如出现相关症状请立即就医，并按需为宠物接种疫苗。')
    return text + '\n'.join(lines)

@app.route('/api/ai/consult', methods=['POST'])
def api_ai_consult():
    '''常见问题咨询 - 规则匹配 + 知识库查询生成回复'''

    data = request.get_json() or request.form
    question = (data.get('question', '') or '').strip()
    user_category = (data.get('category', '') or '').strip()
    if not question:
        return jsonify({'success': False, 'message': '请输入您的问题'})
    cat_map = {'狗': '狗', '猫': '猫', '兔子': '兔', '小型宠物': '小型宠物', '鹦鹉': '鸟', '乌龟': '爬行', '金鱼': '鱼'}
    pet_cat = _detect_pet_from_question(question) or cat_map.get(user_category, None) or '通用'
    _kb_cat_map = {'狗': '狗', '猫': '猫', '兔': '兔子', '小型宠物': '仓鼠', '鸟': '鹦鹉', '爬行': '乌龟', '鱼': '金鱼'}
    kb_pet = _kb_cat_map.get(pet_cat, pet_cat)
    if '龙猫' in question:
        kb_pet = '龙猫'
    elif any((k in question for k in ('蜥蜴', '守宫', '鬃狮', '鬾蜥'))):
        kb_pet = '蜥蜴'
    best_match = None
    best_score = 0
    for rule in AI_CONSULT_RULES:
        score = 0
        for kw in rule['keywords']:
            if kw in question:
                score += len(kw)
        if score > best_score:
            best_score = score
            best_match = rule
    if best_match and best_score > 0:
        if 'reply_fn' in best_match:
            reply = best_match['reply_fn'](pet_cat)
        else:
            reply = best_match['reply']
        return jsonify({'success': True, 'reply': _with_zoonosis_warning(reply), 'category': best_match['category'], 'matched_keywords': [kw for kw in best_match['keywords'] if kw in question]})
    disease_kws = ['病', '症', '拉稀', '腹泻', '呕吐', '咳嗽', '感冒', '发烧', '皮肤', '眼睛', '耳朵', '牙齿', '驱虫', '疫苗', '传染']
    diet_kws = ['吃', '喂', '食', '粮', '营养', '喝', '水', '禁忌', '中毒']
    emotion_kws = ['情绪', '心情', '紧张', '害怕', '焦虑', '开心', '行为', '咬', '叫']
    kb_reply = None
    kb_category = None
    if any((kw in question for kw in disease_kws)):
        try:
            hits = _kb_match_rows('pet_disease_medicine', kb_pet, question, 5)
            if hits:
                parts = [f'【{_pet_label(pet_cat)}·与您描述最相关的疾病】\n']
                for _, d in hits:
                    line = f'• {d.get('disease_name', '')}：症状{d.get('symptom', '')}；参考用药{d.get('medicine', '')}'
                    if d.get('remark'):
                        line += f'（{d['remark']}）'
                    parts.append(line)
                parts.append('\n⚠️ 以上信息仅供参考，具体用药请遵兽医医嘱。')
                kb_reply = '\n'.join(parts)
                kb_category = '疾病用药'
            else:
                rows = db.get_knowledge_by_pet('pet_disease_medicine', kb_pet)
                if rows:
                    parts = [f'【{_pet_label(pet_cat)}常见疾病与用药参考】\n']
                    for d in rows[:6]:
                        line = f'• {d.get('disease_name', '')}：症状{d.get('symptom', '')}；参考用药{d.get('medicine', '')}'
                        if d.get('remark'):
                            line += f'（{d['remark']}）'
                        parts.append(line)
                    parts.append('\n⚠️ 以上信息仅供参考，具体用药请遵兽医医嘱。')
                    kb_reply = '\n'.join(parts)
                    kb_category = '疾病用药'
        except Exception as e:
            print(f'[AI咨询] 疾病库查询异常: {e}', flush=True)
    if not kb_reply:
        if any((kw in question for kw in diet_kws)):
            try:
                rows = db.get_knowledge_by_pet('pet_diet', kb_pet)
                if rows:
                    parts = [f'【{pet_cat}喂食建议】\n']
                    for d in rows[:6]:
                        line = f'• {d.get('age_group', '')}：{d.get('food_type', '')}，{d.get('daily_frequency', '')}'
                        if d.get('forbidden_food'):
                            line += f'（禁忌：{d['forbidden_food']}）'
                        parts.append(line)
                    kb_reply = '\n'.join(parts)
                    kb_category = '饮食营养'
            except Exception as e:
                print(f'[AI咨询] 饮食库查询异常: {e}', flush=True)
    if not kb_reply:
        if any((kw in question for kw in emotion_kws)):
            try:
                rows = db.get_knowledge_by_pet('pet_emotion_solution', kb_pet)
                if rows:
                    parts = [f'【{pet_cat}情绪解读与安抚】\n']
                    for d in rows[:5]:
                        parts.append(f'• {d.get('emotion', '')}：{d.get('behavior', '')}')
                        parts.append(f'  安抚方案：{d.get('solution', '')}')
                    kb_reply = '\n'.join(parts)
                    kb_category = '情绪行为'
            except Exception as e:
                print(f'[AI咨询] 情绪库查询异常: {e}', flush=True)
    if kb_reply:
        return jsonify({'success': True, 'reply': _with_zoonosis_warning(kb_reply), 'category': kb_category, 'matched_keywords': []})
    pet_tips = {'狗': '• 饮食：根据年龄和体型选择专用狗粮，幼犬3-4次/天，成犬2次/天\n• 运动：每天至少30分钟-1小时运动，大型犬需要更多\n• 驱虫：体内每3个月一次，体外每月一次\n• 疫苗：6-8周开始接种核心疫苗（犬瘟/细小/狂犬）\n• 口腔：每周刷牙，每年专业洁牙1-2次\n• 洗澡：2-4周一次，使用宠物专用沐浴露', '猫': '• 饮食：干粮为主+适量湿粮，猫需高蛋白低碳水\n• 饮水：猫天生饮水少，可用流动饮水机促进喝水\n• 猫砂：每天铲屎，每周完全更换猫砂\n• 驱虫：室内猫也需定期驱虫（体内3月/次，体外月/次）\n• 疫苗：6-8周开始接种核心疫苗（猫瘟/鼻支/狂犬）\n• 注意：百合花/精油/洋葱等对猫有剧毒！', '兔': '• 饮食：80%提摩西草+10%蔬菜+5%兔粮，牧草是生命线\n• 饮水：24小时提供新鲜饮水\n• 温度：理想温度15-25°C，>28°C易中暑\n• 运动：每天至少3-4小时自由活动时间\n• 磨牙：提供干草和苹果木帮助磨牙\n• 注意：兔子不会呕吐，肠胃问题极危险', '鸟': '• 饮食：混合谷物为主+新鲜蔬果补充，避免巧克力/牛油果\n• 饮水：每天更换新鲜饮水，清洗水壶\n• 温度：保持20-28°C，避免温度骤变\n• 社交：鹦鹉是群居动物，每天至少2小时互动\n• 玩具：提供啃咬玩具和觅食玩具，防止啄羽症\n• 注意：不粘锅过热产生的气体对鸟有剧毒！', '爬行': '• 温度：水龟水温25-28°C，陆龟环境28-32°C\n• UVB：每天10-12小时UVB灯照射，促进钙吸收\n• 饮食：水龟杂食/陆龟素食，补充钙粉和维生素\n• 水质：水龟需强大过滤系统，每周换水1/3\n• 晒背：提供干燥晒背区\n• 注意：温度不够时龟会停食，消化停止', '鱼': '• 水质：每周检测氨氮/亚硝酸盐/pH，保持水质稳定\n• 换水：每周换水1/4-1/3，不要一次性大换水\n• 温度：根据鱼种保持适宜水温，加热棒+温度计必备\n• 喂食：每天1-2次，2-3分钟内吃完为宜\n• 过滤：根据鱼缸大小选择合适功率的过滤器\n• 注意：新鱼入缸需过温过水，避免直接倒入'}
    tips = pet_tips.get(pet_cat, '• 饮食：根据年龄和体型选择专用饲料，保证新鲜饮水\n• 健康护理：定期驱虫、接种疫苗、注意眼耳口腔清洁\n• 日常护理：定期洗澡梳毛，保持生活环境清洁\n• 情绪关注：观察精神状态和食欲，发现异常及时就医\n')
    _quick = {'狗': '拉稀、不吃东西、喵吐、皮肤瘙痒、咳嗽', '猫': '不吃饭、喵吐、尿闭、猫癣、流泪', '兔': '不吃草、软便、流口水、毛球', '鸟': '不吃食、糊屎、鼻流淚、炸毛', '爬行': '拒食、浮水、腐甲、白眼', '鱼': '白点、夹尾、浮头、不吃食', '小型宠物': '不吃食、弓背、腹泻、颊囊积食'}
    default_reply = f'已识别您咨询的对象为{_pet_label(pet_cat)}，但问题中未出现可定位的症状词。以下是{_pet_label(pet_cat)}的养护要点：\n\n{tips}\n\n⚠️ 想要针对具体问题的判断，请直接输入症状词（如{_quick.get(pet_cat, '不吃食、腹泻、皮肤异常')}），系统会按症状匹配知识库中的具体疾病给出结论。'
    return jsonify({'success': True, 'reply': _with_zoonosis_warning(default_reply), 'category': '默认', 'matched_keywords': []})

TRAINING_DATA = [{'title': '幼犬定点上厕所训练', 'level': 'beginner', 'type': '狗狗', 'description': '帮助幼犬在固定地点排泄，是最基础也是最重要的训练之一。', 'steps': ['确定一个固定的排泄地点，让幼犬逐渐熟悉', '饭后、睡醒后、玩耍后立即带幼犬到指定地点', '在幼犬正确排泄后立即给予零食奖励和口头赞美', '意外排泄时不要惩罚，彻底清洁去除气味', '耐心重复训练，幼犬通常需要1-2周才能稳定', '幼犬每2-3小时需要排泄一次，注意观察信号']}, {'title': '基础指令训练（坐、来、停）', 'level': 'beginner', 'type': '狗狗', 'description': '教会狗狗最基本的三个指令，建立沟通基础。', 'steps': ['准备好狗狗喜欢的零食作为奖励', "训练'坐':举起零食在狗狗头顶上方，它自然会坐下，立即奖励", "训练'来':在安静环境中叫名字，狗狗过来就奖励", "训练'停':在狗狗即将做某事时说'停'，停下就奖励", '每次训练5-10分钟，每天2-3次', '保持耐心，多用正面强化，绝不体罚']}, {'title': '狗狗社交化训练', 'level': 'beginner', 'type': '狗狗', 'description': '让狗狗从小适应各种环境、人和其他动物，培养良好性格。', 'steps': ['从幼犬期开始，每周带接触2-3个新朋友', '邀请朋友到家中做客，让狗狗在熟悉环境中社交', '带狗狗去公园、街道等公共场所，逐步适应', '接触其他友善的狗狗，学习正常社交行为', '遇到害怕的情况不要强迫，给予安全感', '社交化过程中始终保持正面体验和奖励']}, {'title': '猫咪 litter box 使用训练', 'level': 'beginner', 'type': '猫咪', 'description': '训练猫咪使用猫砂盆，保持家居清洁。', 'steps': ['选择安静、私密的角落放置猫砂盆', '使用与猫咪之前习惯相同的猫砂', '将猫咪放入猫砂盆中，让它自己探索', '饭后和睡醒后将猫咪带到猫砂盆', '猫咪正确使用后给予赞美和零食', '保持猫砂盆清洁，每天清理粪便']}, {'title': '猫咪性格养成训练', 'level': 'beginner', 'type': '猫咪', 'description': '通过日常互动培养猫咪亲人、开朗的性格。', 'steps': ['每天固定时间陪猫咪玩耍15-30分钟', '使用逗猫棒模拟猎物，满足狩猎本能', '猫咪主动靠近时给予关注和抚摸', '不要用手直接逗猫，避免养成咬人手的习惯', '提供多个猫爬架和藏身点，丰富环境', '保持温和，避免打骂，建立信任关系']}, {'title': '狗狗 leash 牵引训练', 'level': 'intermediate', 'type': '狗狗', 'description': '教会狗狗正确佩戴牵引绳并随行散步，不拉扯。', 'steps': ['先让狗狗熟悉牵引绳，在室内佩戴适应', '握住牵引绳，狗狗拉扯时立即停止不动', '狗狗放松牵引时继续前进并奖励', '反复练习，逐步延长散步时间', '在安静环境练习后再到户外', '选择合适的胸背带或颈圈，确保舒适']}, {'title': '猫咪剪指甲训练', 'level': 'intermediate', 'type': '猫咪', 'description': '让猫咪接受剪指甲，避免抓伤家具和家人。', 'steps': ['从小开始，让猫咪习惯被触碰爪子', '选择猫咪专用指甲剪，在光线好的地方操作', '每次只剪1-2个指甲，避免剪到血线', '剪完后给予零食奖励，建立正面联想', '如果猫咪抗拒，改用磨爪板代替', '每2-3周检查一次指甲长度']}, {'title': '狗狗等待与自控训练', 'level': 'intermediate', 'type': '狗狗', 'description': '训练狗狗的耐心和自控力，在各种场合保持冷静。', 'steps': ["教'等待'指令：让狗狗坐下，说'等'后慢慢后退", '逐步增加等待时间，从几秒到几分钟', '在门口、电梯等场合练习等待', '成功等待后给予高价值奖励', '环境干扰增加时，回退到更简单的阶段', '保持一致，每次训练结束都以成功告终']}, {'title': '召回训练（狗狗）', 'level': 'intermediate', 'type': '狗狗', 'description': '训练狗狗无论在什么情况下都能回到主人身边。', 'steps': ['在安静无干扰的环境开始，用零食引诱回来', '逐步增加距离和环境干扰', '永远用最开心的语气和最好的奖励', '狗狗召回时不要表现出不高兴（即使它差点闯祸）', '户外训练时先用长牵引绳保证安全', '反复巩固，直到狗狗形成条件反射']}, {'title': '高级花式指令训练', 'level': 'advanced', 'type': '狗狗', 'description': '在基础指令掌握后，训练狗狗执行更复杂的动作。', 'steps': ['在已掌握基础指令的前提下开始', "训练'翻滚':用零食引导狗狗完成翻身动作", "训练'装死':引导狗狗侧卧并保持不动", "训练'击掌':狗狗坐下后用零食引导抬爪", '每个动作分解为小步骤逐步教学', '保持训练趣味性，避免狗狗产生厌烦']}, {'title': '宠物分离焦虑矫正', 'level': 'advanced', 'type': '通用', 'description': '帮助宠物克服独处时的焦虑和破坏性行为。', 'steps': ['从小时间离开开始，逐步增加离开时长', '离开前给宠物留下有趣的玩具或零食', '回家时不要过度兴奋，保持平淡', '建立离开仪式，让宠物形成预期', '增加日常运动量，消耗多余精力', '严重情况可咨询兽医或动物行为专家']}, {'title': '狗狗攻击行为矫正', 'level': 'advanced', 'type': '狗狗', 'description': '纠正狗狗的攻击倾向，建立安全的社交行为。', 'steps': ['首先确定攻击触发原因（恐惧、领地、资源保护等）', '避免接触触发源，保持安全距离', '使用系统脱敏和反条件反射技术', '在专业指导下逐步暴露于刺激源', '始终使用正面强化，绝不使用惩罚', '严重攻击行为必须咨询专业训犬师或兽医']}, {'title': '通用宠物适应环境训练', 'level': 'beginner', 'type': '通用', 'description': '帮助新到家的宠物快速适应新环境和家庭成员。', 'steps': ['准备好安静的休息区域，让宠物有安全感', '提前准备食物、水、猫砂盆等必需品', '让宠物先探索新环境，不要强行互动', '家庭成员轮流温柔地与宠物建立联系', '保持环境稳定，减少突然的噪音和变化', '给予足够的时间，宠物会逐渐放松适应']}]

@app.route('/api/training/list', methods=['GET'])
def api_training_list():
    '''获取训练指南列表'''

    level = (request.args.get('level', '') or '').strip()
    train_type = (request.args.get('type', '') or '').strip()
    trainings = TRAINING_DATA
    if level:
        trainings = [t for t in trainings if t.get('level') == level]
    if train_type:
        trainings = [t for t in trainings if train_type in t.get('type', '')]
    return jsonify({'success': True, 'trainings': trainings, 'total': len(trainings)})

@app.route('/api/cloud/status', methods=['GET'])
def api_cloud_status():
    '''检查 Supabase 云端同步状态（仅管理员）'''

    user = get_current_user()
    if not user and not session.get('is_guest'):
        return jsonify({'success': False, 'message': '请先登录'}), 401
    if not user or user.get('role') != 'admin':
        return jsonify({'success': False, 'message': '仅管理员可使用云端同步功能'}), 403
    try:
        sb = get_supabase_adapter()
        cfg = sb.get_config()
        if not sb.is_ready():
            return jsonify({'success': True, 'connected': False, 'message': 'Supabase 未配置，请在系统设置中配置 URL 和 KEY', 'config': {'url': cfg.get('url', ''), 'key_masked': cfg.get('key_masked', '')}})
        test = sb.test_connection()
        return jsonify({'success': True, 'connected': test.get('success', False), 'message': test.get('message', ''), 'config': {'url': cfg.get('url', ''), 'key_masked': cfg.get('key_masked', '')}})
    except Exception as e:
        return jsonify({'success': False, 'connected': False, 'message': f'检查失败: {e}'})

@app.route('/api/cloud/config', methods=['POST'])
def api_cloud_config():
    '''保存 Supabase 配置（仅管理员）'''

    user = get_current_user()
    if not user:
        return jsonify({'success': False, 'message': '请先登录'}), 401
    if user.get('role') != 'admin':
        return jsonify({'success': False, 'message': '仅管理员可修改云端同步配置'}), 403
    data = request.get_json() or request.form
    url = (data.get('url', '') or '').strip()
    key = (data.get('key', '') or '').strip()
    if not url or not key:
        return jsonify({'success': False, 'message': 'URL 和 KEY 不能为空'})
    try:
        sb = get_supabase_adapter()
        ok = sb.save_config(url, key)
        if ok:
            return jsonify({'success': True, 'message': '配置已保存并连接成功'})
        return jsonify({'success': False, 'message': '配置保存失败，请检查 URL 和 KEY 是否正确'})
    except Exception as e:
        return jsonify({'success': False, 'message': f'保存失败: {e}'})

@app.route('/api/cloud/backup', methods=['POST'])
def api_cloud_backup():
    '''将本地识别记录备份到云端（仅管理员）'''

    user = get_current_user()
    if not user:
        return jsonify({'success': False, 'message': '请先登录'}), 401
    if user.get('role') != 'admin':
        return jsonify({'success': False, 'message': '仅管理员可执行云端备份'}), 403
    try:
        sb = get_supabase_adapter()
        if not sb.is_ready():
            return jsonify({'success': False, 'message': 'Supabase 未配置，无法备份'})
        db = get_db()
        user_id = None if user.get('role') == 'admin' else user['id']
        records, _ = db.list_records(user_id=user_id, page=1, page_size=10000)
        success_count = 0
        fail_count = 0
        for rec in records:
            try:
                payload = {'user_id': rec.get('user_id'), 'image_path': rec.get('image_path', ''), 'pet_category': rec.get('pet_category', ''), 'breed': rec.get('breed', ''), 'age_group': rec.get('age_group', ''), 'gender': rec.get('gender', ''), 'emotion': rec.get('emotion', ''), 'confidence': rec.get('confidence', 0), 'feeding_advice': rec.get('feeding_advice', ''), 'disease_advice': rec.get('disease_advice', ''), 'emotion_advice': rec.get('emotion_advice', ''), 'created_at': rec.get('created_at', datetime.now().strftime('%Y-%m-%d %H:%M:%S'))}
                sb.add_record(payload)
                success_count += 1
            except Exception:
                fail_count += 1
        return jsonify({'success': True, 'message': f'备份完成：成功 {success_count} 条，失败 {fail_count} 条', 'success_count': success_count, 'fail_count': fail_count})
    except Exception as e:
        return jsonify({'success': False, 'message': f'备份失败: {e}'})

@app.route('/api/cloud/restore', methods=['POST'])
def api_cloud_restore():
    '''从云端恢复识别记录到本地（仅管理员）'''

    user = get_current_user()
    if not user:
        return jsonify({'success': False, 'message': '请先登录'}), 401
    if user.get('role') != 'admin':
        return jsonify({'success': False, 'message': '仅管理员可执行云端恢复'}), 403
    try:
        sb = get_supabase_adapter()
        if not sb.is_ready():
            return jsonify({'success': False, 'message': 'Supabase 未配置，无法恢复'})
        db = get_db()
        user_id = None if user.get('role') == 'admin' else user['id']
        cloud_records = sb.get_all_records(limit=5000) if user_id is None else sb.get_records_by_user(user_id, limit=5000)
        restored = 0
        skipped = 0
        for rec in cloud_records:
            try:
                exists = db.query_one('SELECT id FROM recognition_record WHERE user_id=? AND created_at=?', (rec.get('user_id'), rec.get('created_at')))
                if exists:
                    skipped += 1
                    continue
                db.add_record(user_id=rec.get('user_id'), image_path=rec.get('image_path', ''), pet_category=rec.get('pet_category', ''), breed=rec.get('breed', ''), age_group=rec.get('age_group', ''), gender=rec.get('gender', ''), emotion=rec.get('emotion', ''), confidence=rec.get('confidence', 0), feeding_advice=rec.get('feeding_advice', ''), disease_advice=rec.get('disease_advice', ''), emotion_advice=rec.get('emotion_advice', ''))
                restored += 1
            except Exception:
                skipped += 1
        return jsonify({'success': True, 'message': f'恢复完成：新增 {restored} 条，跳过 {skipped} 条', 'restored': restored, 'skipped': skipped})
    except Exception as e:
        return jsonify({'success': False, 'message': f'恢复失败: {e}'})

@app.route('/static/<path:filename>')
def serve_static(filename):
    '''提供静态文件 — 开发期禁用浏览器缓存，保证修改立即生效'''

    static_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static')
    resp = send_from_directory(static_dir, filename)
    resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    resp.headers['Pragma'] = 'no-cache'
    resp.headers['Expires'] = '0'
    return resp

if __name__ == '__main__':
    host = '127.0.0.1'
    port = 5000
    print(f'\n{'============================================================'}')
    print('  宠物智能识别系统 - 网页版启动')
    print(f'  访问地址: http://localhost:{port}')
    print(f'  模型状态: {'已加载' if recognition_mgr.is_model_ready() else '演示模式'}')
    print(f'{'============================================================'}\n')
    app.run(host=host, port=port, debug=False)
# WARNING: Decompyle incomplete
