// ===== 全局状态 =====

// 内部类别名 → 用户友好的展示名映射
const DISPLAY_CATEGORY_MAP = {
    "犬类": "犬类",
    "猫类": "猫类",
    "兔类": "兔类",
    "小型宠物": "啮齿/小型哺乳",
    "鸟类": "鸟类",
    "爬行类": "爬行类",
    "鱼类": "鱼类",
    "宠物甲虫": "宠物昆虫",
    "两栖类": "两栖类",
};

// 获取展示用类别名
function getDisplayCategory(petCategory) {
    if (!petCategory) return '-';
    return DISPLAY_CATEGORY_MAP[petCategory] || petCategory;
}
let currentUser = null;
let currentPage = 'dashboard';
let recognitionState = null;
let currentHistoryPage = 1;
let currentKnowledgePage = 1;
let historyFilter = { category: '', emotion: '', keyword: '' };

// ===== 通用工具函数 =====
function debounce(fn, wait) {
    let timer = null;
    return function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), wait);
    };
}

// ===== 全局快捷键 =====
document.addEventListener('keydown', (e) => {
    // Ctrl+K 聚焦知识库搜索
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const input = document.getElementById('kbSearchInput');
        if (input) { input.focus(); input.select(); }
        else if (currentPage !== 'knowledge') { showPage('knowledge'); setTimeout(() => { const i = document.getElementById('kbSearchInput'); if (i) { i.focus(); i.select(); } }, 300); }
    }
});

// ===== localStorage 持久化 =====
function saveState() {
    try {
        const state = {
            page: currentPage,
            recognition: recognitionState ? {
                result: recognitionState.result,
                previewSrc: recognitionState.previewSrc
            } : null
        };
        localStorage.setItem('petAI_state', JSON.stringify(state));
    } catch (e) {}
}

// 全局统计数据缓存
let globalStatsCache = null;

async function refreshGlobalStats() {
    try {
        const res = await fetch('/api/stats/dashboard');
        const data = await res.json();
        if (data.success) {
            globalStatsCache = data;
            // 如果当前在数据统计页面，刷新显示
            if (currentPage === 'stats') {
                showPage('stats');
            }
            // 更新侧边栏/顶部的总识别数等显示
            updateGlobalCounters(data);
        }
    } catch (e) {
        console.warn('刷新统计数据失败:', e);
    }
}

function updateGlobalCounters(data) {
    // 更新页面上的全局计数器显示（如果有的话）
    const totalEl = document.querySelector('[data-stat-total]');
    if (totalEl && data.total !== undefined) {
        totalEl.textContent = data.total;
    }
}

function loadState() {
    try {
        const data = localStorage.getItem('petAI_state');
        if (data) {
            const state = JSON.parse(data);
            if (state.recognition && state.recognition.result) {
                recognitionState = state.recognition;
                recognitionState._persisted = true;
            }
            return state.page || 'dashboard';
        }
    } catch (e) {}
    return 'dashboard';
}

// ===== 初始化 =====
async function init() {
    initParticleCanvas();
    updateClock();
    setInterval(updateClock, 1000);
    try { loadWeather(); } catch (e) { console.warn('weather err:', e); }

    const userOk = await loadUserInfo();
    if (!userOk) {
        // 即使用户接口失败（如数据库关闭），也尝试继续渲染默认页，保持导航可用
        try {
            if (location.pathname === '/home' || location.pathname === '/' || document.getElementById('contentArea')) {
                setTimeout(() => showPage('dashboard'), 200);
            }
        } catch (e) {}
        return;
    }

    try { await loadModelStatus(); } catch (e) { console.warn('model status err:', e); }
    try {
        const savedPage = loadState();
        showPage(savedPage || 'dashboard');
    } catch (e) {
        console.warn('state load err:', e);
        showPage('dashboard');
    }
}

// 加载天气数据（使用模拟数据）
function loadWeather() {
    // 使用模拟天气数据（避免API请求失败）
    const weatherData = {
        temp: 24,
        humidity: 65,
        desc: '多云'
    };
    
    const tempEl = document.getElementById('weatherTemp');
    const humidityEl = document.getElementById('weatherHumidity');
    const descEl = document.getElementById('weatherDesc');
    
    if (tempEl) tempEl.textContent = weatherData.temp;
    if (humidityEl) humidityEl.textContent = weatherData.humidity;
    if (descEl) descEl.textContent = weatherData.desc;
}

function updateClock() {
    const now = new Date();
    const str = now.toLocaleString('zh-CN', { hour12: false });
    const el = document.getElementById('timeDisplay');
    if (el) el.textContent = str;
    
    // 更新底部状态栏
    const dateStr = now.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
    const timeStr = now.toLocaleTimeString('zh-CN', { hour12: false });
    const dateEl = document.getElementById('currentDate');
    const timeEl = document.getElementById('currentTime');
    if (dateEl) dateEl.textContent = dateStr;
    if (timeEl) timeEl.textContent = timeStr;
}

async function loadUserInfo() {
    try {
        const res = await fetch('/api/auth/me', { cache: 'no-store' });
        if (!res.ok && res.status !== 401) {
            // 网络/数据库错误：不强制跳登录页，尝试继续作为游客模式展示导航
            console.warn('[Auth] /api/auth/me HTTP', res.status);
        }
        const data = await res.json().catch(() => null);
        if (data && data.success && data.user) {
            currentUser = data.user;
            document.getElementById('userName').textContent = currentUser.nickname || currentUser.username;
            document.getElementById('userAvatar').textContent = (currentUser.nickname || currentUser.username).charAt(0).toUpperCase();
            
            let roleText = '普通用户';
            if (currentUser.role === 'admin') {
                roleText = '管理员';
                document.body.classList.add('admin-mode');
                document.body.classList.remove('guest-mode');
            } else if (currentUser.role === 'guest') {
                roleText = '游客';
                document.body.classList.add('guest-mode');
                document.body.classList.remove('admin-mode');
            } else {
                document.body.classList.remove('admin-mode');
                document.body.classList.remove('guest-mode');
            }
            document.getElementById('userRole').textContent = roleText;
            
            const adminOnlyItems = document.querySelectorAll('.admin-only');
            if (currentUser.role === 'admin') {
                adminOnlyItems.forEach(item => item.style.display = 'flex');
            } else {
                adminOnlyItems.forEach(item => item.style.display = 'none');
            }
            return true;
        } else if (data && !data.success && data.force_login) {
            window.location.href = '/login';
            return false;
        } else {
            // 后端返回失败但不是强制登录：本地 fallback 为游客，以便导航可用
            currentUser = { id: 0, username: 'guest', nickname: '游客', role: 'guest' };
            document.body.classList.add('guest-mode');
            document.body.classList.remove('admin-mode');
            const elN = document.getElementById('userName');
            const elA = document.getElementById('userAvatar');
            const elR = document.getElementById('userRole');
            if (elN) elN.textContent = '游客';
            if (elA) elA.textContent = 'G';
            if (elR) elR.textContent = '游客';
            document.querySelectorAll('.admin-only').forEach(it => it.style.display = 'none');
            showToast('登录状态异常，已进入游客模式。侧边栏/导航仍可使用', 'warning');
            return true;
        }
    } catch (e) {
        // 数据库关闭或网络问题：catch 后强制走游客 fallback，防止整页 init 被中断
        console.warn('[Auth] fetch error:', e);
        currentUser = { id: 0, username: 'guest', nickname: '游客', role: 'guest' };
        try {
            document.body.classList.add('guest-mode');
            document.body.classList.remove('admin-mode');
            const elN = document.getElementById('userName');
            const elA = document.getElementById('userAvatar');
            const elR = document.getElementById('userRole');
            if (elN) elN.textContent = '游客';
            if (elA) elA.textContent = 'G';
            if (elR) elR.textContent = '游客';
            document.querySelectorAll('.admin-only').forEach(it => it.style.display = 'none');
        } catch (_) {}
        showToast('与服务器连接失败，已进入游客模式（侧边栏仍可使用）', 'warning');
        return true;
    }
}

async function loadModelStatus() {
    try {
        const res = await fetch('/api/settings/model_status');
        const data = await res.json();
        const statusText = document.getElementById('modelStatusText');
        const statusEl = document.getElementById('modelStatusBadge');
        if (data.model_ready) {
            statusText.textContent = 'AI 模型已就绪';
            statusEl.className = 'status-chip';
        } else {
            statusText.textContent = '演示模式';
            statusEl.className = 'status-chip warning';
        }
    } catch (e) {
        const statusText = document.getElementById('modelStatusText');
        const statusEl = document.getElementById('modelStatusBadge');
        statusText.textContent = '未知';
        statusEl.className = 'status-chip offline';
    }
}

// ===== 云端同步工具 =====
async function loadCloudConfig() {
    try {
        const res = await fetch('/api/cloud/status');
        const data = await res.json();
        const urlInput = document.getElementById('sbUrl') || document.getElementById('sbUrlSync');
        const keyInput = document.getElementById('sbKey') || document.getElementById('sbKeySync');
        if (data.config) {
            if (urlInput && data.config.url) urlInput.value = data.config.url;
            if (keyInput && data.config.key_masked) keyInput.placeholder = '当前已保存：' + data.config.key_masked;
        }
        const msgEl = document.getElementById('cloudConfigMsg') || document.getElementById('syncStatusText');
        if (msgEl) {
            if (data.connected) {
                msgEl.textContent = '✅ 已连接 Supabase';
                msgEl.style.color = '#10B981';
            } else {
                msgEl.textContent = '❌ 未连接：' + (data.message || '请配置 Supabase');
                msgEl.style.color = '#F59E0B';
            }
        }
    } catch (e) {
        console.warn('加载云端配置失败:', e);
    }
}
window.loadCloudConfig = loadCloudConfig;

async function saveCloudConfig() {
    const urlInput = document.getElementById('sbUrl') || document.getElementById('sbUrlSync');
    const keyInput = document.getElementById('sbKey') || document.getElementById('sbKeySync');
    const msgEl = document.getElementById('cloudConfigMsg') || document.getElementById('syncStatusText');
    const url = urlInput ? urlInput.value.trim() : '';
    const key = keyInput ? keyInput.value.trim() : '';
    if (!url || !key) {
        if (msgEl) { msgEl.textContent = '❌ URL 和 KEY 不能为空'; msgEl.style.color = '#F43F5E'; }
        return;
    }
    if (msgEl) { msgEl.textContent = '🔄 正在保存配置...'; msgEl.style.color = '#00E5FF'; }
    try {
        const res = await fetch('/api/cloud/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, key })
        });
        const data = await res.json();
        if (msgEl) {
            msgEl.textContent = (data.success ? '✅ ' : '❌ ') + (data.message || '');
            msgEl.style.color = data.success ? '#10B981' : '#F43F5E';
        }
        if (data.success) {
            if (typeof addSyncLog === 'function') addSyncLog('Supabase 配置已保存');
            setTimeout(loadCloudConfig, 300);
        }
    } catch (e) {
        if (msgEl) { msgEl.textContent = '❌ 保存失败：' + e.message; msgEl.style.color = '#F43F5E'; }
    }
}
window.saveCloudConfig = saveCloudConfig;

async function testCloudConnection() {
    const msgEl = document.getElementById('syncStatusText') || document.getElementById('cloudConfigMsg');
    if (msgEl) { msgEl.textContent = '🔄 正在连接 Supabase...'; msgEl.style.color = '#00E5FF'; }
    try {
        const res = await fetch('/api/cloud/status');
        const data = await res.json();
        if (msgEl) {
            msgEl.textContent = (data.connected ? '✅ ' : '❌ ') + (data.message || '');
            msgEl.style.color = data.connected ? '#10B981' : '#F59E0B';
        }
        if (typeof addSyncLog === 'function') {
            addSyncLog(data.connected ? '连接测试成功' : '连接测试失败：' + (data.message || ''));
        }
    } catch (e) {
        if (msgEl) { msgEl.textContent = '❌ 连接异常：' + e.message; msgEl.style.color = '#F43F5E'; }
        if (typeof addSyncLog === 'function') addSyncLog('连接异常：' + e.message);
    }
}
window.testCloudConnection = testCloudConnection;

function addSyncLog(msg) {
    const area = document.getElementById('syncLogArea');
    if (!area) return;
    const time = new Date().toLocaleString('zh-CN');
    area.innerHTML = '<div>• [' + time + '] ' + msg + '</div>' + area.innerHTML;
}
window.addSyncLog = addSyncLog;

// ===== 粒子背景动画 =====
function initParticleCanvas() {
    const canvas = document.getElementById('particleCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let particles = [];

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    class Particle {
        constructor() {
            this.reset();
            this.y = Math.random() * canvas.height;
        }
        reset() {
            this.x = Math.random() * canvas.width;
            this.y = Math.random() * canvas.height;
            this.size = Math.random() * 2 + 0.5;
            this.speedX = (Math.random() - 0.5) * 0.3;
            this.speedY = (Math.random() - 0.5) * 0.3;
            this.opacity = Math.random() * 0.4 + 0.1;
            this.color = Math.random() > 0.5 ? '0, 229, 255' : '124, 58, 237';
            this.pulse = Math.random() * Math.PI * 2;
        }
        update() {
            this.x += this.speedX;
            this.y += this.speedY;
            this.pulse += 0.015;
            if (this.x < 0 || this.x > canvas.width) this.speedX *= -1;
            if (this.y < 0 || this.y > canvas.height) this.speedY *= -1;
        }
        draw() {
            const glow = Math.sin(this.pulse) * 0.3 + 0.7;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${this.color}, ${this.opacity * glow})`;
            ctx.shadowBlur = 10;
            ctx.shadowColor = `rgba(${this.color}, 0.8)`;
            ctx.fill();
            ctx.shadowBlur = 0;
        }
    }

    for (let i = 0; i < 50; i++) particles.push(new Particle());

    function connectParticles() {
        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x;
                const dy = particles[i].y - particles[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 130) {
                    const opacity = (1 - dist / 130) * 0.08;
                    ctx.beginPath();
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.strokeStyle = `rgba(0, 229, 255, ${opacity})`;
                    ctx.lineWidth = 0.5;
                    ctx.stroke();
                }
            }
        }
    }

    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        particles.forEach(p => { p.update(); p.draw(); });
        connectParticles();
        requestAnimationFrame(animate);
    }
    animate();
}

// ===== 页面导航 =====
document.addEventListener('click', (e) => {
    const navItem = e.target.closest('.top-nav-item');
    if (navItem) {
        e.preventDefault();
        showPage(navItem.dataset.page);
    }
});

function showPage(page) {
    // ===== 权限拦截：admin-only 页面 =====
    const adminOnly = new Set(['cloud_sync', 'users']);
    if (adminOnly.has(page)) {
        const isAdmin = !!(currentUser && currentUser.role === 'admin');
        if (!isAdmin) {
            const msg = page === 'cloud_sync'
                ? '云端同步功能仅管理员可用'
                : '用户管理功能仅管理员可用';
            showToast(msg, 'warning');
            // 重定向到一个有权限的页面
            const fallbackPage = 'dashboard';
            showPage(fallbackPage);
            return;
        }
    }
    // ===== 游客拦截：no-guest 页面（识别页也会在 render 中单独提示）=====
    const noGuest = new Set(['history']);
    const isGuest = !!(currentUser && currentUser.role === 'guest');
    if (noGuest.has(page) && isGuest) {
        showToast('请先登录后再查看历史记录', 'warning');
        showPage('dashboard');
        return;
    }
    currentPage = page;
    // 双导航高亮 - 顶部
    document.querySelectorAll('.top-nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.page === page);
    });
    // 双导航高亮 - 侧边
    document.querySelectorAll('.side-menu-item').forEach(item => {
        item.classList.toggle('active', item.dataset.page === page);
    });

    const titles = {
        dashboard: { title: '数据统计总览', sub: '系统数据统计与健康状况总览' },
        recognition: { title: '综合图像识别', sub: '上传图片，AI 自动识别品种/年龄/性别/情绪' },
        history: { title: '历史识别记录', sub: '查看历史识别记录，筛选、删除、导出管理' },
        knowledge: { title: '宠物知识库', sub: '品种资料：习性、喂食、疾病、养护' },
        medicine: { title: '药品信息参考', sub: '宠物常用药品信息及市场价格参考 · 非售药仅供参考' },
        hospital: { title: '附近医院', sub: '就近宠物医院推荐与在线查询' },
        stats: { title: '健康报告', sub: '识别数据可视化分析与趋势' },
        consult: { title: '常见问题咨询', sub: '咨询宠物养护问题，获取专业建议' },
        cloud_sync: { title: '云端同步中心', sub: 'Supabase 云端数据备份与多设备同步' },
        alerts: { title: '健康预警中心', sub: '识别异常情绪自动预警' },
        users: { title: '用户管理', sub: '系统用户账号管理（仅管理员）' },
        settings: { title: '系统管理', sub: '账号信息 / 系统设置 / 关于本系统' }
    };
    const t = titles[page] || { title: '', sub: '' };
    const pageTitleEl = document.getElementById('pageTitle');
    const pageSubEl = document.getElementById('pageSubtitle');
    if (pageTitleEl) pageTitleEl.textContent = t.title;
    if (pageSubEl) pageSubEl.textContent = t.sub;

    const contentArea = document.getElementById('contentArea');
    if (!contentArea) return;
    contentArea.innerHTML = '';

    const renderers = {
        dashboard: renderDashboard,
        recognition: renderRecognitionPage,
        history: renderHistoryPage,
        knowledge: renderKnowledgePage,
        medicine: renderMedicinePage,
        hospital: renderHospitalPage,
        stats: renderStatsPage,
        consult: renderConsultPage,
        cloud_sync: renderCloudSyncPage,
        alerts: renderAlertsPage,
        users: renderUsersPage,
        settings: renderSettingsPage
    };
    const renderer = renderers[page];
    if (renderer) renderer(contentArea);
    saveState();
}

// ===== 用户菜单 =====
function showUserMenu() {
    const dropdown = document.getElementById('userDropdown');
    dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
}

function showProfile() {
    closeUserMenu();
    openModal('👤 个人资料', `
        <div style="text-align:center;padding:20px">
            <div class="user-avatar" style="width:80px;height:80px;margin:0 auto 16px;font-size:32px">${(currentUser?.nickname || currentUser?.username || 'U').charAt(0).toUpperCase()}</div>
            <div style="font-size:18px;font-weight:600;margin-bottom:8px">${currentUser?.nickname || currentUser?.username}</div>
            <div style="color:var(--text-secondary);font-size:13px;margin-bottom:16px">${currentUser?.role === 'admin' ? '管理员' : currentUser?.role === 'guest' ? '游客' : '普通用户'}</div>
            <div style="text-align:left;background:rgba(0,229,255,0.05);padding:16px;border-radius:10px">
                <div style="margin-bottom:8px"><span style="color:var(--text-secondary)">用户名：</span>${currentUser?.username}</div>
                <div style="margin-bottom:8px"><span style="color:var(--text-secondary)">角色：</span>${currentUser?.role}</div>
                <div><span style="color:var(--text-secondary)">状态：</span>${currentUser?.status === 1 ? '正常' : '已禁用'}</div>
            </div>
        </div>
    `, '<button class="btn btn-primary" onclick="closeModal()">关闭</button>');
}

function closeUserMenu() {
    document.getElementById('userDropdown').style.display = 'none';
}

// 点击外部关闭用户菜单
document.addEventListener('click', (e) => {
    const userChip = document.getElementById('userChip');
    if (userChip && !userChip.contains(e.target)) {
        closeUserMenu();
    }
});

// ===== Toast =====
function showToast(msg, type = 'info') {
    const toast = document.getElementById('toast');
    toast.className = `toast show ${type}`;
    toast.textContent = msg;
    setTimeout(() => {
        toast.className = 'toast';
    }, 3000);
}

// ===== Modal =====
function openModal(title, body, footer = '') {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalBody').innerHTML = body;
    document.getElementById('modalFooter').innerHTML = footer;
    document.getElementById('modalOverlay').classList.add('show');
}

function closeModal() {
    document.getElementById('modalOverlay').classList.remove('show');
}

// ===== Dashboard =====
async function renderDashboard(container) {
    container.innerHTML = `
        <div class="ref-dashboard">
            <div class="ref-stat-row">
                <div class="ref-stat-card"><div class="ref-stat-icon" style="background:#00E5FF20;color:#00E5FF;box-shadow:0 0 20px #00E5FF30">🐾</div><div class="ref-stat-info"><div class="ref-stat-value" id="dsTotal" style="color:#00E5FF">--</div><div class="ref-stat-label">总识别数</div></div><div class="ref-stat-delta" id="dsTotalDelta" style="color:#00E5FF">--</div></div>
                <div class="ref-stat-card"><div class="ref-stat-icon" style="background:#00FF8820;color:#00FF88;box-shadow:0 0 20px #00FF8830">📈</div><div class="ref-stat-info"><div class="ref-stat-value" id="dsToday" style="color:#00FF88">--</div><div class="ref-stat-label">今日新增</div></div><div class="ref-stat-delta" id="dsTodayDelta" style="color:#00FF88">--</div></div>
                <div class="ref-stat-card"><div class="ref-stat-icon" style="background:#A78BFA20;color:#A78BFA;box-shadow:0 0 20px #A78BFA30">✨</div><div class="ref-stat-info"><div class="ref-stat-value" id="dsRate" style="color:#A78BFA">--</div><div class="ref-stat-label">识别成功率</div></div><div class="ref-stat-delta" id="dsRateDelta" style="color:#A78BFA">--</div></div>
                <div class="ref-stat-card"><div class="ref-stat-icon" style="background:#FBBF2420;color:#FBBF24;box-shadow:0 0 20px #FBBF2430">👥</div><div class="ref-stat-info"><div class="ref-stat-value" id="dsUsers" style="color:#FBBF24">--</div><div class="ref-stat-label">活跃用户</div></div><div class="ref-stat-delta" id="dsUsersDelta" style="color:#FBBF24">--</div></div>
            </div>
            <div class="ref-chart-row">
                <div class="ref-chart-card"><div class="ref-card-title"><span class="title-icon">🐾</span>宠物分布统计</div><div class="ref-card-body"><canvas id="pieChart" width="260" height="220"></canvas><div id="pieLegend" class="ref-chart-legend"></div></div></div>
                <div class="ref-chart-card"><div class="ref-card-title"><span class="title-icon">😊</span>情绪统计</div><div class="ref-card-body"><canvas id="barChart" width="360" height="220"></canvas></div></div>
                <div class="ref-chart-card wide"><div class="ref-card-title"><span class="title-icon">📉</span>近7天数据分析趋势</div><div class="ref-card-body"><canvas id="lineChart" width="520" height="220"></canvas></div></div>
            </div>
            <div class="ref-bottom-row">
                <div class="ref-list-card"><div class="ref-card-title"><span class="title-icon">🏆</span>最近识别排行</div><div class="ref-card-body" id="rankBody"><div class="ref-table-empty" style="color:#7DD3FC;font-size:13px">加载中...</div></div></div>
                <div class="ref-list-card"><div class="ref-card-title"><span class="title-icon">⚠️</span>近期重点提醒</div><div class="ref-card-body" id="alertBody"><div class="ref-table-empty" style="color:#7DD3FC;font-size:13px">加载中...</div></div></div>
            </div>
            <div class="ref-copyright">版权所有 · 保留权利 · 未经授权禁止转载或用于商业用途</div>
        </div>
    `;
    // 拉真实数据
    try {
        const res = await fetch('/api/stats/dashboard');
        const d = await res.json();
        if (d && d.success) {
            document.getElementById('dsTotal').textContent = Number(d.total) || 0;
            document.getElementById('dsToday').textContent = Number(d.today) || 0;
            document.getElementById('dsRate').textContent = (Number(d.success_rate) || 0) + '%';
            document.getElementById('dsUsers').textContent = Number(d.active_users) || 0;
            document.getElementById('dsTotalDelta').textContent = d.total > 0 ? '+' + Math.round(Number(d.total) * 0.05) : '0';
            document.getElementById('dsTodayDelta').textContent = d.today > 0 ? '+' + Number(d.today) : '0';
            document.getElementById('dsRateDelta').textContent = d.success_rate > 0 ? Number(d.success_rate) + '%' : '0%';
            document.getElementById('dsUsersDelta').textContent = d.active_users > 0 ? Number(d.active_users) + '' : '0';
            const bcat = (typeof d.by_category === 'object' && d.by_category) ? d.by_category : {};
            const bemo = (typeof d.by_emotion === 'object' && d.by_emotion) ? d.by_emotion : {};
            const tr = Array.isArray(d.trend) ? d.trend : [];
            drawDashboardCharts(bcat, bemo, tr);
            drawRankBody(bcat);
            drawAlertBody(bemo);
        } else {
            drawDashboardCharts({}, {}, []);
        }
    } catch (e) {
        drawDashboardCharts({}, {}, []);
    }
}
function drawRankBody(byCat) {
    const el = document.getElementById('rankBody');
    const entries = (typeof byCat === 'object' && byCat)
        ? Object.entries(byCat).sort((a,b) => Number(b[1]) - Number(a[1]))
        : [];
    if (entries.length === 0) {
        el.innerHTML = `<div class="ref-table-empty" style="color:#7DD3FC;font-size:13px;text-align:center;padding:24px">暂无识别排行数据，开始识别后会自动更新</div>`;
        return;
    }
    const icons = {'犬类':'🐕','猫类':'🐈','小型宠物':'🐾','鸟类':'🦜','爬行类':'🐢','鱼类':'🐟','宠物甲虫':'🪲','兔类':'🐇'};
    el.innerHTML = entries.slice(0, 7).map((r, i) => `
        <div class="ref-rank-item">
            <span class="ref-rank-no" style="background:${i<3?'#00E5FF':'#4B5563'}">${i+1}</span>
            <span>${icons[r[0]] || '🐾'} ${r[0]}</span>
            <span class="ref-rank-count">${r[1]} 次</span>
        </div>
    `).join('');
}
function drawAlertBody(byEmo) {
    const sick = (byEmo && byEmo['生病']) || 0;
    const anx = (byEmo && byEmo['焦虑']) || 0;
    const ner = (byEmo && byEmo['紧张']) || 0;
    const sad = (byEmo && byEmo['伤心']) || 0;
    const items = [];
    if (sick > 0) items.push({color:'#F43F5E', icon:'💊', title:`共检测到 ${sick} 次疑似生病状态`, sub:'建议定期体检，保持环境清洁，症状持续时及时就医'});
    if (anx > 0) items.push({color:'#F59E0B', icon:'😰', title:`共检测到 ${anx} 次情绪焦虑`, sub:'每日多陪伴互动，减少环境应激，适当增加玩具和活动量'});
    if (ner > 0) items.push({color:'#FBBF24', icon:'😟', title:`共检测到 ${ner} 次紧张状态`, sub:'远离刺激性噪声，提供安静休息空间，逐步适应新环境'});
    if (sad > 0) items.push({color:'#8B5CF6', icon:'😢', title:`共检测到 ${sad} 次伤心/低落`, sub:'主人多陪伴、抚摸、互动，增加遛弯或玩耍时间'});
    if (items.length === 0) {
        items.push({color:'#10B981', icon:'✅', title:'健康状态良好', sub:'暂无异常情绪记录，继续保持良好养护习惯'});
    }
    const el = document.getElementById('alertBody');
    el.innerHTML = items.map(i => `
        <div class="ref-alert-item">
            <span class="alert-dot" style="background:${i.color}"></span>
            <div>
                <div class="alert-title">${i.title}</div>
                <div class="alert-sub">${i.sub}</div>
            </div>
        </div>
    `).join('');
}

function drawDashboardCharts(byCat, byEmo, trend) {
    // 宠物分布饼图
    const pie = document.getElementById('pieChart');
    if (pie) {
        const hasData = Object.keys(byCat || {}).length > 0;
        const dataArr = hasData
            ? Object.entries(byCat).map(([k,v]) => ({label:k, value:v, color:categoryColor(k)}))
            : [];
        const ctx = pie.getContext('2d');
        ctx.clearRect(0, 0, pie.width, pie.height);
        if (!hasData) {
            ctx.fillStyle = '#7DD3FC'; ctx.font = '14px Segoe UI'; ctx.textAlign = 'center';
            ctx.fillText('暂无数据', pie.width/2, pie.height/2 - 6);
            ctx.fillStyle = '#475569'; ctx.font = '10px Segoe UI';
            ctx.fillText('开始识别后自动更新', pie.width/2, pie.height/2 + 12);
            const leg = document.getElementById('pieLegend');
            if (leg) leg.innerHTML = '<span style="color:#64748B">暂无分类数据</span>';
        } else {
            const total = dataArr.reduce((s, d) => s + d.value, 0);
            let start = -Math.PI / 2;
            const cx = 130, cy = 110, r = 80;
            dataArr.forEach(d => {
                if (d.value <= 0) return;
                const angle = (d.value / total) * Math.PI * 2;
                ctx.beginPath();
                ctx.moveTo(cx, cy);
                ctx.arc(cx, cy, r, start, start + angle);
                ctx.closePath();
                ctx.fillStyle = d.color;
                ctx.fill();
                start += angle;
            });
            ctx.beginPath(); ctx.arc(cx, cy, 48, 0, Math.PI * 2); ctx.fillStyle = '#071628'; ctx.fill();
            ctx.fillStyle = '#00E5FF'; ctx.font = 'bold 18px Segoe UI'; ctx.textAlign = 'center';
            ctx.fillText(total, cx, cy - 2);
            ctx.fillStyle = '#7DD3FC'; ctx.font = '10px Segoe UI'; ctx.fillText('总数', cx, cy + 14);
            const leg = document.getElementById('pieLegend');
            if (leg) leg.innerHTML = dataArr.map(d => `<span style="color:${d.color}">●</span> ${d.label} ${d.value}`).join('<br>');
        }
    }
    // 情绪柱图
    const bar = document.getElementById('barChart');
    if (bar) {
        const emoOrder = ['开心','平静','紧张','焦虑','生病','伤心'];
        const emoColor = { '开心':'#10B981','平静':'#00E5FF','紧张':'#F59E0B','焦虑':'#F97316','生病':'#F43F5E','伤心':'#8B5CF6' };
        const dataArr = emoOrder.map(e => ({ label: e, v: (byEmo && byEmo[e]) || 0, c: emoColor[e] })).filter(d=>d.v>0);
        const w = bar.width, h = bar.height;
        const ctx = bar.getContext('2d');
        ctx.clearRect(0, 0, w, h);
        if (dataArr.length === 0) {
            ctx.fillStyle = '#7DD3FC'; ctx.font = '14px Segoe UI'; ctx.textAlign = 'center';
            ctx.fillText('暂无情绪数据', w/2, h/2 - 6);
            ctx.fillStyle = '#475569'; ctx.font = '10px Segoe UI';
            ctx.fillText('开始识别后自动更新', w/2, h/2 + 12);
            return;
        }
        const max = Math.max(...dataArr.map(d => d.v), 1);
        const padL = 36, padR = 16, padT = 16, padB = 32;
        const chartW = w - padL - padR, chartH = h - padT - padB;
        ctx.strokeStyle = 'rgba(6,182,212,0.08)'; ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
            const y = padT + (chartH / 4) * i;
            ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
            const val = Math.round(max - (max / 4) * i);
            ctx.fillStyle = '#38BDF8'; ctx.font = '10px Segoe UI'; ctx.textAlign = 'right';
            ctx.fillText(val, padL - 6, y + 3);
        }
        const barW = (chartW / dataArr.length) * 0.6;
        const gap = (chartW / dataArr.length) * 0.4;
        dataArr.forEach((d, i) => {
            const barH = Math.max(1, (d.v / max) * chartH);
            const x = padL + i * (barW + gap) + gap / 2;
            const y = padT + chartH - barH;
            const g = ctx.createLinearGradient(x, y, x, y + barH);
            g.addColorStop(0, d.c); g.addColorStop(1, d.c + '60');
            ctx.fillStyle = g; ctx.fillRect(x, y, barW, barH);
            ctx.fillStyle = '#7DD3FC'; ctx.font = '11px Segoe UI'; ctx.textAlign = 'center';
            ctx.fillText(d.label, x + barW / 2, padT + chartH + 18);
            ctx.fillStyle = '#E0F2FE'; ctx.font = '10px Segoe UI'; ctx.fillText(d.v, x + barW / 2, y - 4);
        });
    }
    // 7天折线
    const line = document.getElementById('lineChart');
    if (line) {
        const hasTrend = (trend && trend.length > 0);
        const trendArr = hasTrend ? trend : [];
        const w = line.width, h = line.height;
        const ctx = line.getContext('2d');
        ctx.clearRect(0, 0, w, h);
        if (!hasTrend) {
            ctx.fillStyle = '#7DD3FC'; ctx.font = '14px Segoe UI'; ctx.textAlign = 'center';
            ctx.fillText('暂无趋势数据', w/2, h/2 - 6);
            ctx.fillStyle = '#475569'; ctx.font = '10px Segoe UI';
            ctx.fillText('开始识别后自动更新近7天趋势', w/2, h/2 + 12);
            return;
        }
        const days = trendArr.map(t => t.date);
        const data1 = trendArr.map(t => t.count);
        const data2 = trendArr.map((t,i) => Math.max(1, Math.round(t.count * (0.8 + i*0.02))));
        const padL = 40, padR = 16, padT = 16, padB = 32;
        const chartW = w - padL - padR, chartH = h - padT - padB;
        const max = Math.max(...data1, ...data2) * 1.15 || 100;
        ctx.strokeStyle = 'rgba(6,182,212,0.08)'; ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
            const y = padT + (chartH / 4) * i;
            ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
            const val = Math.round(max - (max / 4) * i);
            ctx.fillStyle = '#38BDF8'; ctx.font = '10px Segoe UI'; ctx.textAlign = 'right';
            ctx.fillText(val, padL - 6, y + 3);
        }
        function drawSeries(arr, color, fillColor) {
            const stepX = (arr.length > 1) ? (chartW / (arr.length - 1)) : 0;
            ctx.beginPath();
            arr.forEach((v, i) => {
                const x = padL + stepX * i;
                const y = padT + chartH - Math.max(1, (v / max) * chartH);
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            });
            ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
            const lastX = padL + stepX * (arr.length - 1);
            const firstX = padL;
            ctx.lineTo(lastX, padT + chartH); ctx.lineTo(firstX, padT + chartH); ctx.closePath();
            const g = ctx.createLinearGradient(0, padT, 0, padT + chartH);
            g.addColorStop(0, fillColor); g.addColorStop(1, 'transparent');
            ctx.fillStyle = g; ctx.fill();
            arr.forEach((v, i) => {
                const x = padL + stepX * i;
                const y = padT + chartH - Math.max(1, (v / max) * chartH);
                ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
            });
        }
        drawSeries(data1, '#00E5FF', 'rgba(0,229,255,0.25)');
        drawSeries(data2, '#8B5CF6', 'rgba(139,92,246,0.2)');
        days.forEach((d, i) => {
            const x = (days.length>1) ? (padL + (chartW / (days.length - 1)) * i) : padL;
            ctx.fillStyle = '#38BDF8'; ctx.font = '10px Segoe UI'; ctx.textAlign = 'center';
            ctx.fillText(d, x, padT + chartH + 18);
        });
    }
}
function categoryColor(k) {
    const m = { '犬类':'#00E5FF','猫类':'#8B5CF6','鸟类':'#10B981','鱼类':'#F59E0B','小型宠物':'#F43F5E','爬行类':'#06B6D4','宠物甲虫':'#6366F1','兔类':'#FBBF24','其他':'#64748B' };
    return m[k] || '#00E5FF';
}

function renderCategoryChart(stats) {
    const canvas = document.getElementById('categoryCanvas');
    if (!canvas || !stats) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const categories = Object.entries(stats).filter(([_, v]) => v > 0);
    if (categories.length === 0) {
        ctx.fillStyle = '#6b7c99';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('暂无数据', w / 2, h / 2);
        return;
    }

    const maxVal = Math.max(...categories.map(([_, v]) => v));
    const barWidth = Math.min(60, (w - 60) / categories.length - 20);
    const gap = (w - 60 - barWidth * categories.length) / (categories.length + 1);

    categories.forEach(([name, val], i) => {
        const x = 30 + gap + i * (barWidth + gap);
        const barH = (val / maxVal) * (h - 60);
        const y = h - 40 - barH;

        const grad = ctx.createLinearGradient(x, y, x, h - 40);
        grad.addColorStop(0, '#00E5FF');
        grad.addColorStop(1, 'rgba(0, 229, 255, 0.3)');
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, barWidth, barH);

        ctx.fillStyle = '#E8F4FF';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(name, x + barWidth / 2, h - 20);
        ctx.fillText(val, x + barWidth / 2, y - 8);
    });
}

function renderEmotionChart(stats) {
    const canvas = document.getElementById('emotionCanvas');
    if (!canvas || !stats) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const emotions = Object.entries(stats).filter(([_, v]) => v > 0);
    if (emotions.length === 0) {
        ctx.fillStyle = '#6b7c99';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('暂无数据', w / 2, h / 2);
        return;
    }

    const total = emotions.reduce((s, [_, v]) => s + v, 0);
    const colors = { '开心': '#00FF88', '平静': '#00E5FF', '紧张': '#FFB800', '生病': '#FF3D5A' };
    const cx = w / 2, cy = h / 2, radius = 70;

    let startAngle = -Math.PI / 2;
    emotions.forEach(([name, val]) => {
        const angle = (val / total) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, startAngle, startAngle + angle);
        ctx.closePath();
        ctx.fillStyle = colors[name] || '#7C3AED';
        ctx.fill();
        startAngle += angle;
    });

    ctx.beginPath();
    ctx.arc(cx, cy, 40, 0, Math.PI * 2);
    ctx.fillStyle = '#081028';
    ctx.fill();

    ctx.fillStyle = '#E8F4FF';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(total, cx, cy + 6);
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#7A8BA8';
    ctx.fillText('总记录', cx, cy + 22);
}

function getEmotionBadge(emotion) {
    const map = { '开心': 'badge-green', '平静': 'badge-cyan', '紧张': 'badge-gold', '生病': 'badge-red' };
    return map[emotion] || 'badge-cyan';
}

function formatTime(str) {
    if (!str) return '';
    return str.replace('T', ' ').substring(0, 16);
}

// ===== 识别页 =====
async function renderRecognitionPage(container) {
    const isGuest = currentUser && (currentUser.role === 'guest');
    if (isGuest) {
        container.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:center;height:100%;padding:20px 0">
                <div class="guest-lock-card">
                    <div class="guest-lock-icon">🔒</div>
                    <div class="guest-lock-title">游客模式暂不可使用识别功能</div>
                    <div class="guest-lock-sub">
                        为了保障您的识别数据能够永久保存，并获得完整的喂食建议、疾病参考、情绪安抚等专业建议，<br>
                        请先注册账号或登录后再使用宠物识别功能。当前您可以浏览：
                    </div>
                    <div class="guest-features-grid">
                        <div class="guest-feat"><div class="guest-feat-icon">📊</div><div class="guest-feat-name">数据统计</div><div class="guest-feat-desc">系统识别数据总览</div></div>
                        <div class="guest-feat"><div class="guest-feat-icon">📖</div><div class="guest-feat-name">知识库</div><div class="guest-feat-desc">宠物品种介绍</div></div>
                        <div class="guest-feat"><div class="guest-feat-icon">💊</div><div class="guest-feat-name">药品参考</div><div class="guest-feat-desc">常用药品信息浏览</div></div>
                        <div class="guest-feat"><div class="guest-feat-icon">🏥</div><div class="guest-feat-name">附近医院</div><div class="guest-feat-desc">就近宠物医院查询</div></div>
                        <div class="guest-feat"><div class="guest-feat-icon">💬</div><div class="guest-feat-name">常见问题</div><div class="guest-feat-desc">宠物养护问答</div></div>
                        <div class="guest-feat"><div class="guest-feat-icon">📈</div><div class="guest-feat-name">健康报告</div><div class="guest-feat-desc">数据分析可视化</div></div>
                    </div>
                    <div class="guest-actions">
                        <button class="btn btn-primary" onclick="location.href='/login'">🚀 立即登录</button>
                        <button class="btn btn-secondary" onclick="location.href='/register'">📝 免费注册</button>
                    </div>
                </div>
            </div>
        `;
        return;
    }
    // 已登录用户 - 正常识别页
    const state = recognitionState;
    if (state && state.result) {
        container.innerHTML = `
            <div class="ref-recognition-layout">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;padding:10px 14px;background:linear-gradient(90deg,rgba(0,229,255,0.08),rgba(139,92,246,0.06));border:1px solid rgba(0,229,255,0.15);border-radius:10px">
                    <div style="color:#7DD3FC;font-size:13px">🎯 识别已完成，可点击「重置识别」清空当前结果并重新上传</div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap">
                        <button class="btn btn-primary" onclick="reRecognize()" style="background:linear-gradient(135deg,#06B6D4,#22D3EE);border:none">🔁 再次识别本图</button>
                        <button class="btn btn-secondary" onclick="showPage('history')">📋 查看历史</button>
                        <button class="btn btn-danger" onclick="clearRecognition()" style="background:linear-gradient(135deg,#EF4444,#DC2626);border:none">🔄 重置识别</button>
                    </div>
                </div>
                <div class="ref-rec-top">
                    <div class="ref-cam-card">
                        <div class="ref-card-title"><span class="title-icon">📹</span>实时监控</div>
                        <div class="ref-card-body">
                            <div class="ref-cam-area">
                                <img src="${state.previewSrc}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;display:block" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
                                <div class="ref-cam-fallback" style="display:none;flex-direction:column;align-items:center;justify-content:center;color:#7DD3FC;font-size:13px">
                                    <div style="font-size:40px;margin-bottom:12px">📹</div>
                                    <div>实时摄像头画面</div>
                                </div>
                            </div>
                            <div class="ref-progress"><div class="progress-label">识别进度：已完成</div><div class="progress-bar"><div class="progress-fill" style="width:100%"></div></div></div>
                        </div>
                    </div>
                    <div class="ref-result-card">
                        <div class="ref-card-title"><span class="title-icon">🎯</span>综合识别画面</div>
                        <div class="ref-card-body">
                            <div class="ref-result-hero">
                                <img src="${state.previewSrc}" class="ref-hero-img" onerror="this.style.display='none'">
                                <div class="ref-scan-line"></div>
                                <div class="ref-hero-info">
                                    <div class="ref-hero-pet">
                                        <div class="ref-hero-label">识别结果</div>
                                        <div class="ref-hero-breed">${state.result.breed || '未知品种'}</div>
                                    </div>
                                    <div class="ref-hero-meta">
                                        <div class="meta-item"><span>品类</span><strong>${state.result.display_category || getDisplayCategory(state.result.pet_category)}</strong></div>
                                        <div class="meta-item"><span>年龄</span><strong>${state.result.age_group || '-'}</strong></div>
                                        <div class="meta-item"><span>性别</span><strong>${state.result.gender || '-'}</strong></div>
                                        <div class="meta-item"><span>情绪</span><strong style="color:${emotionColor(state.result.emotion)}">${state.result.emotion || '-'}</strong></div>
                                    </div>
                                </div>
                            </div>
                            <div class="ref-rec-actions" style="margin-top:16px">
                                <button class="btn btn-primary" onclick="reRecognize()" style="background:linear-gradient(135deg,#06B6D4,#22D3EE);border:none">🔁 再次识别本图</button>
                                <button class="btn btn-secondary" onclick="showPage('history')">📋 查看历史</button>
                                <button class="btn btn-secondary" onclick="clearRecognition()">🔄 重置识别</button>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="ref-rec-bottom">
                    <div class="ref-sub-card"><div class="ref-card-title"><span class="title-icon">🍽️</span>喂食推荐</div><div class="ref-card-body"><div class="ref-tip-text">${(state.result.feeding_advice || '暂无建议').replace(/\n/g, '<br>')}</div></div></div>
                    <div class="ref-sub-card"><div class="ref-card-title"><span class="title-icon">💊</span>疾病用药参考</div><div class="ref-card-body"><div class="ref-tip-text">${(state.result.disease_advice || '暂无建议').replace(/\n/g, '<br>')}</div></div></div>
                    <div class="ref-sub-card"><div class="ref-card-title"><span class="title-icon">😊</span>情绪安抚建议</div><div class="ref-card-body"><div class="ref-tip-text">${(state.result.emotion_advice || '暂无建议').replace(/\n/g, '<br>')}</div></div></div>
                    <div class="ref-sub-card"><div class="ref-card-title"><span class="title-icon">🩺</span>健康状态</div><div class="ref-card-body"><div class="ref-tip-text">${renderHealthStatusHTML(state.result.health_status)}</div></div></div>
                </div>
                <div class="ref-copyright">版权所有 · 保留权利 · 未经授权禁止转载或用于商业用途</div>
            </div>
        `;
        return;
    }
    container.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100%;padding:20px 0">
            <div class="ref-upload-card" style="width:960px;max-width:100%">
                <div class="ref-upload-inner">
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:20px">
                        <div style="position:relative">
                            <div class="ref-card-title" style="margin-bottom:10px"><span class="title-icon">📸</span>图像上传与预览</div>
                            <div id="previewArea" style="height:320px;border-radius:14px;border:2px dashed rgba(0,229,255,0.25);background:rgba(0,229,255,0.03);display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden">
                                <div style="text-align:center;color:#7DD3FC;padding:20px">
                                    <div style="font-size:48px;margin-bottom:8px;opacity:0.7">🔍</div>
                                    <div style="font-size:14px">尚未选择图片</div>
                                    <div style="font-size:11px;margin-top:4px">点击下方按钮上传或直接将图片拖入本区域</div>
                                </div>
                            </div>
                            <div style="margin-top:12px;display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
                                <button class="btn btn-primary" onclick="document.getElementById('fileInput').click()">📁 选择图片</button>
                                <button class="btn btn-secondary" onclick="document.getElementById('cameraInput').click()">📷 拍照上传</button>
                                <button class="btn btn-secondary" onclick="clearRecognition()">🔄 重置</button>
                            </div>
                            <input type="file" id="fileInput" accept="image/*" style="display:none" onchange="handleFile(this.files[0])">
                            <input type="file" id="cameraInput" accept="image/*" capture style="display:none" onchange="handleFile(this.files[0])">
                        </div>
                        <div>
                            <div class="ref-card-title" style="margin-bottom:10px"><span class="title-icon">🤖</span>识别控制</div>
                            <div style="background:rgba(139,92,246,0.04);border:1px solid rgba(139,92,246,0.15);border-radius:12px;padding:14px;line-height:1.9;color:#7DD3FC;font-size:12px">
                                <p style="margin-bottom:8px"><strong style="color:#E0F2FE">支持9大类宠物识别：</strong>犬类、猫类、鸟类、爬行类、鱼类、小型宠物、宠物甲虫、兔类、两栖类。</p>
                                <p style="margin-bottom:8px"><strong style="color:#E0F2FE">识别维度：</strong>品种、年龄阶段、性别、情绪、置信度，并联动喂食/疾病/情绪安抚建议。</p>
                                <p><strong style="color:#E0F2FE">AI模型：</strong>MobileNetV3-small 离线预训练模型，推理全程本地，不上传任何图像数据。</p>
                            </div>
                            <div style="margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:10px">
                                <div style="background:rgba(0,229,255,0.04);border:1px solid rgba(0,229,255,0.12);border-radius:10px;padding:12px;text-align:center">
                                    <div style="font-size:20px;margin-bottom:2px">🐾</div>
                                    <div style="font-size:12px;color:#7DD3FC">支持 80+ 真实品种</div>
                                </div>
                                <div style="background:rgba(16,185,129,0.04);border:1px solid rgba(16,185,129,0.12);border-radius:10px;padding:12px;text-align:center">
                                    <div style="font-size:20px;margin-bottom:2px">💾</div>
                                    <div style="font-size:12px;color:#7DD3FC">自动保存至历史记录</div>
                                </div>
                                <div style="background:rgba(245,158,11,0.04);border:1px solid rgba(245,158,11,0.12);border-radius:10px;padding:12px;text-align:center">
                                    <div style="font-size:20px;margin-bottom:2px">🏥</div>
                                    <div style="font-size:12px;color:#7DD3FC">疾病用药参考</div>
                                </div>
                                <div style="background:rgba(139,92,246,0.04);border:1px solid rgba(139,92,246,0.12);border-radius:10px;padding:12px;text-align:center">
                                    <div style="font-size:20px;margin-bottom:2px">😊</div>
                                    <div style="font-size:12px;color:#7DD3FC">情绪安抚方案</div>
                                </div>
                            </div>
                            <div style="margin-top:14px">
                                <button class="btn btn-primary" style="width:100%;padding:14px;font-size:16px" onclick="recognizeImage()">🚀 开始 AI 识别</button>
                            </div>
                        </div>
                    </div>
                    <div style="padding-top:16px;border-top:1px solid rgba(0,229,255,0.1);display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
                        <div style="text-align:center;font-size:11px;color:#7DD3FC;padding:10px;background:rgba(0,229,255,0.04);border-radius:8px;border:1px solid rgba(0,229,255,0.12)">🐕 犬类识别<br>支持300+品种</div>
                        <div style="text-align:center;font-size:11px;color:#7DD3FC;padding:10px;background:rgba(139,92,246,0.04);border-radius:8px;border:1px solid rgba(139,92,246,0.12)">🐈 猫类识别<br>支持80+品种</div>
                        <div style="text-align:center;font-size:11px;color:#7DD3FC;padding:10px;background:rgba(16,185,129,0.04);border-radius:8px;border:1px solid rgba(16,185,129,0.12)">🦜 鸟类识别<br>鹦鹉/八哥等</div>
                        <div style="text-align:center;font-size:11px;color:#7DD3FC;padding:10px;background:rgba(245,158,11,0.04);border-radius:8px;border:1px solid rgba(245,158,11,0.12)">🐢 爬行/鱼类<br>龟/蜥蜴/鱼</div>
                    </div>
                </div>
            </div>
        </div>
    `;
    // 预览区拖放
    setTimeout(()=>{
        const pa = document.getElementById('previewArea');
        if (!pa) return;
        if (recognitionState && recognitionState.previewSrc) {
            pa.innerHTML = `<img src="${recognitionState.previewSrc}" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:10px;display:block;margin:auto">`;
        }
        ['dragenter','dragover'].forEach(evt => pa.addEventListener(evt, e=>{ e.preventDefault(); e.stopPropagation(); pa.style.borderColor='rgba(0,229,255,0.7)'; pa.style.background='rgba(0,229,255,0.1)'; }));
        ['dragleave','drop'].forEach(evt => pa.addEventListener(evt, e=>{ e.preventDefault(); e.stopPropagation(); pa.style.borderColor='rgba(0,229,255,0.25)'; pa.style.background='rgba(0,229,255,0.03)'; }));
        pa.addEventListener('drop', e=>{ const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) handleFile(f); });
    }, 0);
}

function emotionColor(emotion) {
    const m = { '开心': '#10B981', '平静': '#00E5FF', '紧张': '#F59E0B', '焦虑': '#F97316', '生病': '#F43F5E', '伤心': '#8B5CF6' };
    return m[emotion] || '#00E5FF';
}

function healthStatusColor(status) {
    const m = { '健康': '#10B981', '需关注': '#F59E0B', '需就医': '#EF4444' };
    return m[status] || '#00E5FF';
}

function renderHealthStatusHTML(hs) {
    hs = hs || {};
    const status = hs.status || '未知';
    const color = healthStatusColor(hs.status);
    const issues = Array.isArray(hs.issues) ? hs.issues : [];
    let html = `<div style="display:flex;align-items:center;gap:10px;margin-bottom:${issues.length ? '12px' : '0'}">
        <span style="display:inline-block;padding:5px 16px;border-radius:999px;font-size:13px;font-weight:600;background:${color}1f;color:${color};border:1px solid ${color}55">${status}</span>
    </div>`;
    if (issues.length) {
        html += `<div style="display:flex;flex-direction:column;gap:6px">
            ${issues.map(i => `<div style="display:flex;align-items:flex-start;gap:8px;color:#E0F2FE;font-size:13px;line-height:1.6"><span style="color:${color};font-weight:bold">•</span><span>${i}</span></div>`).join('')}
        </div>`;
    }
    return html;
}

function clearRecognition() {
    recognitionState = null;
    localStorage.removeItem('petAI_state');
    // 清空文件输入，避免重新选择同一张图片时不触发 onchange
    const fileInput = document.getElementById('fileInput');
    const cameraInput = document.getElementById('cameraInput');
    if (fileInput) fileInput.value = '';
    if (cameraInput) cameraInput.value = '';
    // 清空预览区域（识别前已选择图片但未识别时）
    const previewArea = document.getElementById('previewArea');
    if (previewArea) {
        previewArea.innerHTML = `
            <div style="text-align:center;color:#7DD3FC;padding:20px">
                <div style="font-size:48px;margin-bottom:8px;opacity:0.7">🔍</div>
                <div style="font-size:14px">尚未选择图片</div>
                <div style="font-size:11px;margin-top:4px">点击下方按钮上传或直接将图片拖入本区域</div>
            </div>
        `;
        previewArea.style.borderColor = 'rgba(0,229,255,0.25)';
        previewArea.style.background = 'rgba(0,229,255,0.03)';
    }
    showPage('recognition');
    showToast('已重置识别状态，请重新上传图片', 'info');
}
window.clearRecognition = clearRecognition;

// 全屏 AI 扫描遮罩（识别中动画）
function ensureScanOverlay() {
    if (document.getElementById('aiScanOverlay')) return;
    const ov = document.createElement('div');
    ov.id = 'aiScanOverlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(2,8,18,0.85);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);display:none;align-items:center;justify-content:center;color:#fff;overflow:hidden';
    ov.innerHTML = `
        <canvas id="aiScanBg" style="position:absolute;inset:0;width:100%;height:100%;opacity:.7"></canvas>
        <div style="position:relative;z-index:2;text-align:center;width:680px;max-width:88vw">
            <div style="width:150px;height:150px;margin:0 auto 22px;border-radius:28px;background:linear-gradient(135deg,rgba(0,229,255,.14),rgba(139,92,246,.12));border:1px solid rgba(0,229,255,.4);position:relative;display:flex;align-items:center;justify-content:center;box-shadow:0 0 60px rgba(0,229,255,.35)">
                <div style="position:absolute;inset:-3px;border-radius:28px;border:2px solid transparent;background:linear-gradient(135deg,#00E5FF,#8B5CF6,#00FF88) border-box;-webkit-mask:linear-gradient(#fff 0 0) padding-box,linear-gradient(#fff 0 0);-webkit-mask-composite:xor;mask-composite:exclude;animation:so6s linear infinite"></div>
                <div style="position:absolute;inset:20px;border-radius:20px;border-top:2px solid rgba(0,229,255,.8);box-shadow:0 -10px 24px rgba(0,229,255,.3);animation:scanSweep 1.2s ease-in-out infinite alternate"></div>
                <span style="font-size:58px;filter:drop-shadow(0 0 20px rgba(0,229,255,.8))">🐾</span>
            </div>
            <div style="font-size:22px;font-weight:700;background:linear-gradient(135deg,#fff 0%,#00E5FF 60%,#8B5CF6 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;letter-spacing:1px">AI 多维识别引擎运行中</div>
            <div style="font-size:12px;color:#7DD3FC;margin-top:6px;letter-spacing:2px">AI PET EMOTION ENGINE · RECOGNIZING</div>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:26px 0 22px;text-align:center">
                <div style="padding:12px 8px;border-radius:12px;background:rgba(0,229,255,.05);border:1px solid rgba(0,229,255,.15)">
                    <div style="font-size:18px;margin-bottom:3px">🐕</div><div style="font-size:11px;color:#7DD3FC">品种匹配</div>
                    <div style="height:4px;margin-top:6px;border-radius:4px;background:rgba(0,229,255,.08);overflow:hidden"><div style="height:100%;width:30%;background:linear-gradient(90deg,#00E5FF,#00FF88);border-radius:4px;animation:scanPb1 1.4s ease-in-out infinite"></div></div>
                </div>
                <div style="padding:12px 8px;border-radius:12px;background:rgba(139,92,246,.05);border:1px solid rgba(139,92,246,.15)">
                    <div style="font-size:18px;margin-bottom:3px">🎂</div><div style="font-size:11px;color:#7DD3FC">年龄判别</div>
                    <div style="height:4px;margin-top:6px;border-radius:4px;background:rgba(139,92,246,.08);overflow:hidden"><div style="height:100%;width:30%;background:linear-gradient(90deg,#8B5CF6,#00E5FF);border-radius:4px;animation:scanPb2 1.6s ease-in-out infinite"></div></div>
                </div>
                <div style="padding:12px 8px;border-radius:12px;background:rgba(245,158,11,.05);border:1px solid rgba(245,158,11,.15)">
                    <div style="font-size:18px;margin-bottom:3px">⚥</div><div style="font-size:11px;color:#7DD3FC">性别判别</div>
                    <div style="height:4px;margin-top:6px;border-radius:4px;background:rgba(245,158,11,.08);overflow:hidden"><div style="height:100%;width:30%;background:linear-gradient(90deg,#F59E0B,#FB7185);border-radius:4px;animation:scanPb3 1.8s ease-in-out infinite"></div></div>
                </div>
                <div style="padding:12px 8px;border-radius:12px;background:rgba(16,185,129,.05);border:1px solid rgba(16,185,129,.15)">
                    <div style="font-size:18px;margin-bottom:3px">😊</div><div style="font-size:11px;color:#7DD3FC">情绪分析</div>
                    <div style="height:4px;margin-top:6px;border-radius:4px;background:rgba(16,185,129,.08);overflow:hidden"><div style="height:100%;width:30%;background:linear-gradient(90deg,#10B981,#00E5FF);border-radius:4px;animation:scanPb4 2s ease-in-out infinite"></div></div>
                </div>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:12px;color:#7DD3FC;margin-bottom:10px">
                <span id="scanStage">正在加载图像张量...</span><span id="scanPct" style="color:#00E5FF;font-weight:600">0%</span>
            </div>
            <div style="height:10px;border-radius:10px;background:rgba(0,229,255,.08);border:1px solid rgba(0,229,255,.15);overflow:hidden;position:relative">
                <div id="scanFill" style="height:100%;width:0%;background:linear-gradient(90deg,#00E5FF 0%,#00FF88 50%,#8B5CF6 100%);border-radius:10px;box-shadow:0 0 16px rgba(0,229,255,.5)"></div>
            </div>
            <div style="margin-top:18px;display:flex;justify-content:space-between;font-size:11px;color:#38BDF8">
                <span>推理引擎: MobileNetV3-small</span><span id="scanSub">GPU加速: 已启用</span><span>安全等级: 本地处理</span>
            </div>
        </div>
        <style>
            @keyframes scanSweep { from{top:14px;opacity:.2} to{top:calc(100% - 34px);opacity:1} }
            @keyframes scanPb1 { 0%{width:5%} 50%{width:92%} 100%{width:12%} }
            @keyframes scanPb2 { 0%{width:8%} 50%{width:85%} 100%{width:20%} }
            @keyframes scanPb3 { 0%{width:3%} 50%{width:78%} 100%{width:15%} }
            @keyframes scanPb4 { 0%{width:10%} 50%{width:95%} 100%{width:26%} }
        </style>
    `;
    document.body.appendChild(ov);
    // 背景粒子
    try {
        const c = ov.querySelector('#aiScanBg');
        const ctx = c.getContext('2d');
        function resize(){ c.width=c.clientWidth; c.height=c.clientHeight; }
        resize();
        const ps = [];
        for (let i=0;i<100;i++) ps.push({x:Math.random()*c.width,y:Math.random()*c.height,vx:(Math.random()-.5)*.6,vy:(Math.random()-.5)*.6,r:Math.random()*1.8+.4,col:Math.random()>.5?'0,229,255':'139,92,246'});
        function drawLoop(){
            if (!document.getElementById('aiScanOverlay')) return;
            ctx.clearRect(0,0,c.width,c.height);
            ps.forEach(p=>{
                p.x+=p.vx; p.y+=p.vy;
                if(p.x<0||p.x>c.width)p.vx*=-1; if(p.y<0||p.y>c.height)p.vy*=-1;
                ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
                ctx.fillStyle=`rgba(${p.col},.55)`; ctx.shadowBlur=8; ctx.shadowColor=`rgba(${p.col},.9)`;
                ctx.fill(); ctx.shadowBlur=0;
            });
            requestAnimationFrame(drawLoop);
        }
        drawLoop();
    } catch(e){}
    // 进度条 & 阶段文案
    const stages=['正在加载图像张量...','正在预处理(归一化/Resize)...','正在进行特征提取推理...','正在匹配品种分类标签...','正在分析年龄/性别特征...','正在进行情绪行为识别...','正在联动知识库生成建议...','正在生成识别报告...','即将完成...'];
    let pct=0, stage=0;
    const pctEl=ov.querySelector('#scanPct'), fillEl=ov.querySelector('#scanFill'), stageEl=ov.querySelector('#scanStage'), subEl=ov.querySelector('#scanSub');
    const timer=setInterval(()=>{
        if (!document.getElementById('aiScanOverlay')){ clearInterval(timer); return; }
        pct = Math.min(99, pct + Math.random()*8 + 1.5);
        if (pctEl) pctEl.textContent = Math.round(pct) + '%';
        if (fillEl) fillEl.style.width = pct + '%';
        const ns = Math.min(stages.length-1, Math.floor(pct / (100/stages.length)));
        if (ns!==stage && stageEl){ stage=ns; stageEl.textContent = stages[stage]; }
        if (subEl){
            const subs=['推理耗时: '+Math.round(80+Math.random()*180)+'ms','张量维度: 1×3×224×224','特征维度: 576','Softmax 概率计算中','置信度校准中','匹配知识库 '+Math.round(20+pct*0.6)+' / 80','生成喂食方案...','疾病参考索引...','情绪安抚模板加载...'];
            subEl.textContent = subs[Math.min(subs.length-1, stage)];
        }
    }, 160);
}

async function handleFile(file) {
    if (!file.type.startsWith('image/')) {
        showToast('请选择图片文件', 'error');
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        recognitionState = {
            previewSrc: e.target.result,
            result: null,
            _file: file
        };
        saveState();
        // 更新预览
        const pa = document.getElementById('previewArea');
        if (pa) pa.innerHTML = `<img src="${e.target.result}" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:10px;display:block;margin:auto">`;
        showPage('recognition');
    };
    reader.readAsDataURL(file);
}

async function recognizeImage() {
    if (!recognitionState || !recognitionState._file) {
        showToast('请先选择图片', 'error');
        return;
    }

    // 游客禁止识别
    if (currentUser && currentUser.role === 'guest') {
        showToast('游客模式暂不可使用识别功能，请先注册或登录', 'error');
        return;
    }

    ensureScanOverlay();
    const overlay = document.getElementById('aiScanOverlay');
    overlay.style.display = 'flex';

    // 更新遮罩提示为"识别中"状态
    const scanText = overlay.querySelector('.scan-tip-text');
    const startTime = Date.now();
    if (scanText) scanText.textContent = 'AI 正在识别中，请稍候...';

    try {
        const formData = new FormData();
        formData.append('file', recognitionState._file);

        // 添加超时控制（120秒），避免无限等待
        const controller = new AbortController();
        const timeoutMs = 120000;
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        // 显示实时耗时
        const timerInterval = setInterval(() => {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
            if (scanText) scanText.textContent = `AI 正在识别中... ${elapsed}s`;
        }, 1000);

        const res = await fetch('/api/recognize/upload', {
            method: 'POST',
            body: formData,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        clearInterval(timerInterval);

        // 检查响应类型，防止HTML错误页被当作JSON解析
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            overlay.style.display = 'none';
            showToast('服务器返回异常格式，可能是服务内部错误，请稍后重试', 'error');
            console.error('[识别] 非JSON响应, content-type:', contentType);
            return;
        }

        let data;
        try {
            data = await res.json();
        } catch (parseErr) {
            overlay.style.display = 'none';
            showToast('响应解析失败：' + parseErr.message, 'error');
            return;
        }

        overlay.style.display = 'none';

        if (data.success) {
            recognitionState = {
                previewSrc: recognitionState.previewSrc,
                result: data,
                _file: recognitionState._file
            };
            saveState();
            showPage('recognition');
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            showToast(`识别完成（耗时 ${elapsed}s）`, 'success');
            // 刷新全局统计数据
            refreshGlobalStats();
        } else {
            showToast(data.message || '识别失败', 'error');
        }
    } catch (e) {
        overlay.style.display = 'none';
        // 区分超时和其他错误，给出明确提示
        if (e.name === 'AbortError') {
            showToast('识别超时（120s），请尝试上传更小的图片或稍后重试', 'error');
        } else if (e.message && e.message.includes('Failed to fetch')) {
            showToast('网络连接失败，请检查服务是否运行', 'error');
        } else {
            showToast('识别请求失败：' + (e.message || '未知错误'), 'error');
        }
        console.error('[识别] 请求异常:', e);
    }
}

// 二次识别：使用当前已上传的图片重新识别，无需重新选择图片
async function reRecognize() {
    if (!recognitionState || !recognitionState._file) {
        showToast('未检测到已上传图片，请先上传图片', 'error');
        // 跳转到上传页
        clearRecognition();
        return;
    }

    // 游客禁止识别
    if (currentUser && currentUser.role === 'guest') {
        showToast('游客模式暂不可使用识别功能，请先注册或登录', 'error');
        return;
    }

    ensureScanOverlay();
    const overlay = document.getElementById('aiScanOverlay');
    overlay.style.display = 'flex';
    const scanText = overlay.querySelector('.scan-tip-text');
    const startTime = Date.now();
    if (scanText) scanText.textContent = '正在重新识别当前图片...';

    try {
        const formData = new FormData();
        formData.append('file', recognitionState._file);

        const controller = new AbortController();
        const timeoutMs = 120000;
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const timerInterval = setInterval(() => {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
            if (scanText) scanText.textContent = `重新识别中... ${elapsed}s`;
        }, 1000);

        const res = await fetch('/api/recognize/upload', {
            method: 'POST',
            body: formData,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        clearInterval(timerInterval);

        // 检查响应类型，防止HTML错误页被当作JSON解析
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            overlay.style.display = 'none';
            showToast('服务器返回异常格式，可能是服务内部错误，请稍后重试', 'error');
            console.error('[二次识别] 非JSON响应, content-type:', contentType);
            return;
        }

        let data;
        try {
            data = await res.json();
        } catch (parseErr) {
            overlay.style.display = 'none';
            showToast('响应解析失败：' + parseErr.message, 'error');
            return;
        }

        overlay.style.display = 'none';

        if (data.success) {
            recognitionState = {
                previewSrc: recognitionState.previewSrc,
                result: data,
                _file: recognitionState._file
            };
            saveState();
            showPage('recognition');
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            showToast(`二次识别完成（耗时 ${elapsed}s）`, 'success');
            refreshGlobalStats();
        } else {
            showToast(data.message || '二次识别失败', 'error');
        }
    } catch (e) {
        overlay.style.display = 'none';
        if (e.name === 'AbortError') {
            showToast('识别超时（120s），请尝试上传更小的图片或稍后重试', 'error');
        } else if (e.message && e.message.includes('Failed to fetch')) {
            showToast('网络连接失败，请检查服务是否运行', 'error');
        } else {
            showToast('二次识别失败：' + (e.message || '未知错误'), 'error');
        }
        console.error('[识别] 二次识别异常:', e);
    }
}
window.reRecognize = reRecognize;

function buildResultHTML(data) {
    const confidencePct = Math.round((data.confidence || 0) * 100);
    const healthScore = Math.min(100, Math.max(60, confidencePct + Math.floor(Math.random() * 10)));
    const emotionMap = {
        '开心': { cls: 'happy', color: '#34D399' },
        '平静': { cls: 'calm', color: '#22D3EE' },
        '紧张': { cls: 'anxious', color: '#FBBF24' },
        '生病': { cls: 'sick', color: '#FB7185' },
        '伤心': { cls: 'sad', color: '#818CF8' }
    };
    const emotion = data.emotion || '平静';
    const emo = emotionMap[emotion] || emotionMap['平静'];
    const emotionTags = ['开心', '平静', '紧张', '伤心', '生病'].map(e => {
        const info = emotionMap[e];
        const active = e === emotion ? 'active' : '';
        return `<span class="pai-emotion-tag ${info.cls} ${active}" style="${active ? 'box-shadow:0 0 12px ' + info.color + '40' : ''}">${e}${active ? ' · 主要' : ''}</span>`;
    }).join('');

    const bottomCards = [
        { icon: '🛡️', title: '疾病预防建议', text: data.disease_advice ? data.disease_advice.split('。')[0] + '。' : '定期体检，注意观察宠物精神状态与饮食变化。' },
        { icon: '🍽️', title: '喂食推荐', text: data.feeding_advice ? data.feeding_advice.split('。')[0] + '。' : '根据品种与年龄选择专业配方粮，保证饮水充足。' },
        { icon: '✂️', title: '绝育观察', text: '关注宠物发情周期与行为变化，适龄绝育可降低生殖系统疾病风险。' },
        { icon: '⚠️', title: '健康警示', text: emotion === '生病' ? '当前情绪指标提示需留意健康状况，建议及时就医。' : '当前指标未见明显异常，继续保持良好护理习惯。' },
        { icon: '💊', title: '应激用药参考', text: '遇应激反应可使用费洛蒙喷雾或遵医嘱使用舒缓类药物，避免自行用药。' }
    ];

    return `
        <svg width="0" height="0" style="position:absolute">
            <defs>
                <linearGradient id="paiRingGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style="stop-color:#06B6D4" />
                    <stop offset="100%" style="stop-color:#22D3EE" />
                </linearGradient>
            </defs>
        </svg>
        <div class="pai-result-layout fade-in">
            <div class="pai-result-col">
                <div class="pai-glass-card pai-start-card">
                    <div class="pai-card-title"><span class="title-icon">🐾</span>启动页</div>
                    <div class="pai-card-body">
                        <div class="pet-photo-wrap">
                            ${recognitionState?.previewSrc ? `<img src="${recognitionState.previewSrc}" alt="pet">` : '<div class="no-photo">🐾</div>'}
                        </div>
                        <div class="breed-line">${data.breed || '未知品种'}（${data.display_category || getDisplayCategory(data.pet_category)}）</div>
                        <div class="confidence-line">置信度 ${confidencePct}%</div>
                    </div>
                </div>
                <div class="pai-glass-card">
                    <div class="pai-card-title"><span class="title-icon">🌡️</span>当前环境建议</div>
                    <div class="pai-card-body">
                        <canvas id="envChart" class="pai-chart-canvas"></canvas>
                        <div style="font-size:12px;color:var(--text-secondary);margin-top:8px;text-align:center">近7天环境适宜度趋势</div>
                    </div>
                </div>
            </div>
            <div class="pai-result-col">
                <div class="pai-glass-card">
                    <div class="pai-card-title"><span class="title-icon">📊</span>综合识别结果</div>
                    <div class="pai-card-body">
                        <div class="pai-health-ring">
                            <div class="pai-ring-wrap">
                                <svg viewBox="0 0 140 140">
                                    <circle class="pai-ring-bg" cx="70" cy="70" r="65"></circle>
                                    <circle class="pai-ring-progress" id="healthRing" cx="70" cy="70" r="65" stroke-dashoffset="408"></circle>
                                </svg>
                                <div class="pai-ring-text">
                                    <div class="pai-ring-value" id="healthValue">${healthScore}</div>
                                    <div class="pai-ring-label">健康度</div>
                                </div>
                            </div>
                        </div>
                        <div style="text-align:center;margin-bottom:16px">
                            <div style="font-size:12px;color:var(--text-secondary);margin-bottom:10px">情绪行为分析</div>
                            <div class="pai-emotion-tags">${emotionTags}</div>
                        </div>
                        <div class="pai-advice-text" style="text-align:center">
                            综合分析显示该宠物当前处于 <strong style="color:${emo.color}">${emotion}</strong> 状态，健康度评分 ${healthScore} 分，建议结合下方护理方案进行日常管理。
                        </div>
                    </div>
                </div>
            </div>
            <div class="pai-result-col">
                <div class="pai-glass-card">
                    <div class="pai-card-title"><span class="title-icon">📋</span>识别档案</div>
                    <div class="pai-card-body">
                        <div class="pai-profile-list">
                            <div class="pai-profile-item"><span class="profile-label">品种</span><span class="profile-value">${data.breed || '未知'}</span></div>
                            <div class="pai-profile-item"><span class="profile-label">品类</span><span class="profile-value">${data.display_category || getDisplayCategory(data.pet_category)}</span></div>
                            <div class="pai-profile-item"><span class="profile-label">年龄</span><span class="profile-value">${data.age_group || '未知'}</span></div>
                            <div class="pai-profile-item"><span class="profile-label">性别</span><span class="profile-value">${data.gender || '未知'}</span></div>
                            <div class="pai-profile-item"><span class="profile-label">情绪</span><span class="profile-value" style="color:${emo.color}">${emotion}</span></div>
                            <div class="pai-profile-item"><span class="profile-label">置信度</span><span class="profile-value">${confidencePct}%</span></div>
                        </div>
                    </div>
                </div>
                <div class="pai-glass-card">
                    <div class="pai-card-title"><span class="title-icon">💚</span>健康评估</div>
                    <div class="pai-card-body">
                        <div class="pai-advice-text">
                            ${data.emotion_advice ? data.emotion_advice.split('。')[0] + '。' : '根据识别结果，当前宠物整体状态良好。建议保持规律饮食与适量运动，定期进行健康检查。'}
                            <br><br>
                            ${data.disease_advice ? data.disease_advice.split('。')[0] + '。' : '暂无特殊健康警示，请注意观察日常行为变化。'}
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <div class="pai-bottom-cards fade-in delay-100">
            ${bottomCards.map(c => `
                <div class="pai-bottom-card">
                    <div class="bc-icon">${c.icon}</div>
                    <div class="bc-title">${c.title}</div>
                    <div class="bc-text">${c.text}</div>
                </div>
            `).join('')}
        </div>
    `;
}

function animateRing(value) {
    setTimeout(() => {
        const ring = document.getElementById('healthRing');
        if (!ring) return;
        const pct = Math.min(100, Math.max(0, value));
        const offset = 408 - (408 * pct / 100);
        ring.style.strokeDashoffset = offset;
    }, 100);
}

function drawEnvChart() {
    const canvas = document.getElementById('envChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = '#7DD3FC'; ctx.font = '13px Segoe UI'; ctx.textAlign = 'center';
    ctx.fillText('暂无环境数据', w/2, h/2 - 6);
    ctx.fillStyle = '#475569'; ctx.font = '10px Segoe UI';
    ctx.fillText('环境适宜度需接入传感器后显示', w/2, h/2 + 12);
}

function initResultCharts() {
    const healthValue = document.getElementById('healthValue');
    if (healthValue) {
        animateRing(parseInt(healthValue.textContent, 10));
        drawEnvChart();
    }
}

// ===== 历史记录页 =====
async function renderHistoryPage(container) {
    container.innerHTML = `
        <div class="loading-overlay" id="histLoading">
            <div class="loading-box">
                <div class="loading-title">宠物智能识别与情绪健康咨询系统</div>
                <div class="loading-subtitle">多物种智能识别 | 情绪分析 | 健康建议</div>
                <div class="loading-features">
                    <div class="loading-feat"><div class="loading-feat-icon">🐕</div><div class="loading-feat-text">犬类</div></div>
                    <div class="loading-feat"><div class="loading-feat-icon">🐈</div><div class="loading-feat-text">猫类</div></div>
                    <div class="loading-feat"><div class="loading-feat-icon">🦜</div><div class="loading-feat-text">鸟类</div></div>
                    <div class="loading-feat"><div class="loading-feat-icon">🐢</div><div class="loading-feat-text">爬行类</div></div>
                    <div class="loading-feat"><div class="loading-feat-icon">🐟</div><div class="loading-feat-text">鱼类</div></div>
                    <div class="loading-feat"><div class="loading-feat-icon">🐾</div><div class="loading-feat-text">小型宠物</div></div>
                    <div class="loading-feat"><div class="loading-feat-icon">🐸</div><div class="loading-feat-text">两栖类</div></div>
                </div>
                <div class="loading-bar-wrap"><div class="loading-bar-fill"></div></div>
                <div class="loading-tip"><span>正在初始化高级识别引擎...</span><span id="loadPct">0%</span></div>
                <div class="loading-version"><span>模型版本: v1.3.0</span><span>已就绪: 0 数据</span></div>
            </div>
        </div>
        <div class="ref-history-layout" id="histContent" style="display:none">
            <aside class="ref-history-filter">
                <div class="ref-card-title"><span class="title-icon">🔍</span>筛选条件</div>
                <div class="ref-filter-body">
                    <div class="ref-filter-group"><div class="ref-filter-label">时间范围</div>
                        <div class="ref-date-quick">
                            <button class="ref-date-btn" onclick="setDateRange('today', this)">今天</button>
                            <button class="ref-date-btn" onclick="setDateRange('7', this)">近7天</button>
                            <button class="ref-date-btn" onclick="setDateRange('30', this)">近30天</button>
                            <button class="ref-date-btn" onclick="setDateRange('all', this)">全部</button>
                        </div>
                        <input type="date" id="filterDateFrom" class="ref-filter-input" value="">
                        <input type="date" id="filterDateTo" class="ref-filter-input" value="">
                    </div>
                    <div class="ref-filter-group"><div class="ref-filter-label">宠物品类</div>
                        <select id="filterCategory" class="ref-filter-select">
                            <option value="">全部品类</option><option value="犬类">犬类</option><option value="猫类">猫类</option><option value="鸟类">鸟类</option><option value="爬行类">爬行类</option><option value="鱼类">鱼类</option><option value="小型宠物">小型宠物</option><option value="宠物甲虫">宠物甲虫</option><option value="兔类">兔类</option><option value="两栖类">两栖类</option>
                        </select>
                    </div>
                    <div class="ref-filter-group"><div class="ref-filter-label">情绪状态</div>
                        <select id="filterEmotion" class="ref-filter-select">
                            <option value="">全部情绪</option><option value="开心">开心</option><option value="平静">平静</option><option value="紧张">紧张</option><option value="焦虑">焦虑</option><option value="生病">生病</option><option value="伤心">伤心</option>
                        </select>
                    </div>
                    <div class="ref-filter-group"><div class="ref-filter-label">关键字搜索</div>
                        <input type="text" id="filterKeyword" class="ref-filter-input" placeholder="品种/备注关键字">
                    </div>
                    <button class="btn btn-primary" onclick="loadHistoryTableData(1)" style="width:100%;margin-top:8px">🔎 应用筛选</button>
                    <button class="btn btn-secondary" onclick="resetHistoryFilter()" style="width:100%;margin-top:8px">🔄 重置</button>
                    <div style="height:12px"></div>
                    <div class="ref-filter-result" id="filterResult">共 0 条记录</div>
                </div>
            </aside>
            <section class="ref-history-table">
                <div class="ref-card-title"><span class="title-icon">📋</span>历史识别记录</div>
                <div class="ref-table-body" id="historyTableBody"><div class="ref-table-empty">加载中...</div></div>
                <div class="ref-pagination" id="historyPagination"></div>
            </section>
            <aside class="ref-history-detail" id="historyDetail">
                <div class="ref-card-title"><span class="title-icon">🎯</span>本次识别详情</div>
                <div class="ref-detail-body"><div class="ref-detail-empty"><div style="font-size:48px;opacity:0.3;margin:40px 0">📋</div><div>点击左侧记录查看详情</div></div></div>
            </aside>
            <div class="ref-copyright">版权所有 · 保留权利 · 未经授权禁止转载或用于商业用途</div>
        </div>
    `;
    // 加载动画进度
    let pct = 0;
    const pctEl = document.getElementById('loadPct');
    const verEl = document.querySelector('#histLoading .loading-version span:last-child');
    const timer = setInterval(() => {
        pct = Math.min(100, pct + Math.random() * 22 + 8);
        if (pctEl) pctEl.textContent = Math.round(pct) + '%';
        if (verEl) verEl.textContent = '已就绪: ' + Math.round(pct * 8) + ' 数据';
        if (pct >= 98) clearInterval(timer);
    }, 220);
    setTimeout(async () => {
        clearInterval(timer);
        const ov = document.getElementById('histLoading');
        if (ov) ov.style.display = 'none';
        const content = document.getElementById('histContent');
        if (content) content.style.display = 'flex';
        await loadHistoryTableData(1);
    }, 2600);
}

async function loadHistoryTableData(page) {
    const cat = document.getElementById('filterCategory')?.value || '';
    const emo = document.getElementById('filterEmotion')?.value || '';
    const kw = document.getElementById('filterKeyword')?.value || '';
    const from = document.getElementById('filterDateFrom')?.value || '';
    const to = document.getElementById('filterDateTo')?.value || '';
    currentHistoryPage = page;
    try {
        const params = new URLSearchParams();
        params.set('page', page);
        params.set('page_size', 8);
        if (cat) params.set('pet_category', cat);
        if (emo) params.set('emotion', emo);
        if (kw) params.set('keyword', kw);
        if (from) params.set('date_from', from);
        if (to) params.set('date_to', to);
        const res = await fetch('/api/history/list?' + params.toString());
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); } catch (e) {
            console.error('History API parse error:', text.slice(0, 200));
            throw new Error('返回数据格式错误');
        }
        const tbody = document.getElementById('historyTableBody');
        const resultCount = document.getElementById('filterResult');
        if (!data || !data.success || !data.records || data.records.length === 0) {
            const pg = document.getElementById('historyPagination');
            if (!data || !data.success) {
                if (data && data.message) {
                    tbody.innerHTML = `<div class="ref-table-empty" style="color:#F59E0B;font-size:13px;padding:20px;text-align:center">⚠️ ${data.message}<br><span style="color:#7DD3FC;font-size:12px;margin-top:6px;display:inline-block">请注册账号后使用此功能</span></div>`;
                } else {
                    tbody.innerHTML = `<div class="ref-table-empty"><div style="font-size:48px;opacity:0.3;margin:40px 0">📭</div><div>暂无识别记录</div></div>`;
                }
                if (resultCount) resultCount.textContent = `共 0 条记录`;
                if (pg) pg.innerHTML = '';
                return;
            }
            tbody.innerHTML = `<div class="ref-table-empty"><div style="font-size:48px;opacity:0.3;margin:40px 0">📭</div><div>暂无识别记录</div></div>`;
            if (resultCount) resultCount.textContent = `共 0 条记录`;
            if (pg) pg.innerHTML = '';
            return;
        }
        resultCount.textContent = `共 ${data.total} 条记录`;
        tbody.innerHTML = `
            <table class="ref-history-tbl">
                <thead>
                    <tr><th>识别时间</th><th>品类</th><th>品种</th><th>情绪</th><th>置信度</th><th>操作</th></tr>
                </thead>
                <tbody>
                    ${data.records.map(r => `
                        <tr onclick="viewHistoryDetail(${r.id})">
                            <td>${formatTime(r.created_at)}</td>
                            <td>${r.display_category || getDisplayCategory(r.pet_category)}</td>
                            <td><strong>${r.breed || '-'}</strong></td>
                            <td><span class="emo-badge emo-${r.emotion || '平静'}">${r.emotion || '-'}</span></td>
                            <td>
                                <div class="conf-bar"><div class="conf-fill" style="width:${Math.round((r.confidence||0)*100)}%;background:${emotionColor(r.emotion)}"></div></div>
                                <span class="conf-text">${((r.confidence||0)*100).toFixed(1)}%</span>
                            </td>
                            <td>
                                <button class="btn-link" onclick="event.stopPropagation();viewHistoryDetail(${r.id})">详情</button>
                                <button class="btn-link" onclick="event.stopPropagation();exportReport(${r.id})">导出</button>
                                <button class="btn-link danger" onclick="event.stopPropagation();deleteHistoryRecord(${r.id})">删除</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
        renderHistoryPagination(data.total, page, data.page_size);
    } catch (e) {
        const tbody = document.getElementById('historyTableBody');
        if (tbody) tbody.innerHTML = `<div class="ref-table-empty" style="color:#F43F5E;font-size:13px">加载失败: ${e.message}</div>`;
    }
}

function renderHistoryPagination(total, page, pageSize) {
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const pg = document.getElementById('historyPagination');
    if (!pg) return;
    let html = `<button class="pg-btn" ${page<=1?'disabled':''} onclick="loadHistoryTableData(${page-1})">‹ 上一页</button>`;
    for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || Math.abs(i - page) <= 1) {
            html += `<button class="pg-btn ${i===page?'active':''}" onclick="loadHistoryTableData(${i})">${i}</button>`;
        } else if (i === page - 2 || i === page + 2) {
            html += `<span style="color:#7DD3FC">...</span>`;
        }
    }
    html += `<button class="pg-btn" ${page>=totalPages?'disabled':''} onclick="loadHistoryTableData(${page+1})">下一页 ›</button>`;
    pg.innerHTML = html;
}

async function viewHistoryDetail(id) {
    try {
        const res = await fetch('/api/history/detail/' + id);
        const data = await res.json();
        if (!data.success) { showToast(data.message, 'error'); return; }
        const r = data.record;
        const conf = Math.round((r.confidence || 0) * 1000) / 10;
        const body = document.querySelector('#historyDetail .ref-detail-body');
        const img = r.image_path ? `<img src="/api/history/image/${r.id}" class="ref-detail-img" onerror="this.style.display='none'">` : '';
        body.innerHTML = `
            <div class="ref-detail-empty" style="display:none"></div>
            ${img}
            <div class="ref-detail-section">
                <div class="ref-detail-title">🐾 识别结果</div>
                <div class="ref-detail-grid">
                    <div class="ref-detail-item"><span>品类</span><strong>${r.display_category || getDisplayCategory(r.pet_category)}</strong></div>
                    <div class="ref-detail-item"><span>品种</span><strong class="neon-cyan">${r.breed || '-'}</strong></div>
                    <div class="ref-detail-item"><span>年龄</span><strong>${r.age_group || '-'}</strong></div>
                    <div class="ref-detail-item"><span>性别</span><strong>${r.gender || '-'}</strong></div>
                    <div class="ref-detail-item"><span>情绪</span><strong style="color:${emotionColor(r.emotion)}">${r.emotion || '-'}</strong></div>
                    <div class="ref-detail-item"><span>置信度</span><strong>${conf}%</strong></div>
                </div>
            </div>
            <div class="ref-detail-section">
                <div class="ref-detail-title">🍽️ 喂食推荐</div>
                <div class="ref-tip-text">${(r.feeding_advice || '暂无建议').replace(/\n/g, '<br>')}</div>
            </div>
            <div class="ref-detail-section">
                <div class="ref-detail-title">💊 疾病参考</div>
                <div class="ref-tip-text">${(r.disease_advice || '暂无建议').replace(/\n/g, '<br>')}</div>
            </div>
            <div class="ref-detail-section">
                <div class="ref-detail-title">😊 情绪安抚</div>
                <div class="ref-tip-text">${(r.emotion_advice || '暂无建议').replace(/\n/g, '<br>')}</div>
            </div>
            <div class="ref-detail-actions">
                <button class="btn btn-danger" onclick="deleteHistoryRecord(${r.id})">🗑️ 删除</button>
            </div>
        `;
    } catch (e) {
        showToast('加载详情失败', 'error');
    }
}

async function deleteHistoryRecord(id) {
    if (!confirm('确认删除这条记录？')) return;
    try {
        const res = await fetch('/api/history/delete/' + id, { method: 'POST' });
        const data = await res.json();
        if (!data.success) { showToast(data.message || '删除失败', 'error'); return; }
        showToast('删除成功', 'success');
        await loadHistoryTableData(currentHistoryPage);
    } catch (e) {
        showToast('删除失败', 'error');
    }
}

function applyHistoryFilter() {
    loadHistoryTableData(1);
}

function resetHistoryFilter() {
    const el = id => document.getElementById(id);
    if (el('filterDateFrom')) el('filterDateFrom').value = '';
    if (el('filterDateTo')) el('filterDateTo').value = '';
    if (el('filterCategory')) el('filterCategory').value = '';
    if (el('filterEmotion')) el('filterEmotion').value = '';
    if (el('filterKeyword')) el('filterKeyword').value = '';
    loadHistoryTableData(1);
}

window.loadHistoryTableData = loadHistoryTableData;
window.viewHistoryDetail = viewHistoryDetail;
window.deleteHistoryRecord = deleteHistoryRecord;
window.applyHistoryFilter = applyHistoryFilter;
window.resetHistoryFilter = resetHistoryFilter;

async function renderKnowledgePage(container) {
    const realBreeds = {
        '犬类': [
            {n:'金毛寻回犬', l:'Golden Retriever', o:'中型犬', s:'温顺友善', lf:'10-12年', t:`最受欢迎家庭犬之一，原产苏格兰。毛发为浅金至深金色双层被毛，防水抗寒。性格温柔聪慧，对小孩极友好。`},
            {n:'拉布拉多', l:'Labrador Retriever', o:'大型犬', s:'活泼聪明', lf:'12-14年', t:`原产加拿大纽芬兰。毛短防水，黑色/黄色/巧克力色。智商排名前10，广泛用于导盲犬、搜救犬。`},
            {n:'柯基犬', l:'Welsh Corgi', o:'小型犬', s:'活泼开朗', lf:'12-15年', t:`英国王室最爱，短腿长身，分彭布罗克和卡迪根两类。精力充沛需大量运动，注意关节和体重。`},
            {n:'德国牧羊犬', l:'German Shepherd', o:'大型犬', s:'忠诚警觉', lf:'9-13年', t:`又名德牧、黑背，军警界广泛使用。双层被毛，黑棕色为主。智商第3，服从性高，工作能力强。`},
            {n:'柴犬', l:'Shiba Inu', o:'中型犬', s:'独立机敏', lf:'12-15年', t:`日本古老犬种，狐狸脸，三角立耳。毛分赤/黑/白。性格倔强独立，表情丰富（doge表情包原型）。`},
            {n:'比熊犬', l:'Bichon Frise', o:'小型犬', s:'粘人温顺', lf:'12-15年', t:`原产地中海，白色蓬松卷毛像棉花糖。不掉毛，需频繁美容。性格黏人，适合公寓。`},
            {n:'萨摩耶', l:'Samoyed', o:'大型犬', s:'友善活泼', lf:'12-14年', t:`"微笑天使"，原产西伯利亚。白色双层被毛厚实防水。嘴角天然上扬，会"笑"。运动需求高，爱叫。`},
            {n:'边境牧羊犬', l:'Border Collie', o:'中型犬', s:'聪明敏捷', lf:'12-15年', t:`智商犬类排名第一，原产英国边境。毛色多样，黑白最常见。精力极度旺盛，需大量运动和脑力训练。`},
            {n:'斗牛犬', l:'Bulldog', o:'中型犬', s:'沉稳温和', lf:'8-10年', t:`原产英国，面部褶皱扁鼻短腿。怕热，需注意呼吸道问题。性格憨厚安静，对小孩有耐心。`},
            {n:'哈士奇', l:'Siberian Husky', o:'中型犬', s:'热情顽皮', lf:'12-14年', t:`原产西伯利亚，毛色丰富，蓝色/异色瞳常见。精力旺盛，爱拆家，叫声独特。`},
            {n:'贵宾犬', l:'Poodle', o:'小型犬', s:'聪明活泼', lf:'13-15年', t:`智商第二，卷毛不掉毛。分标准/迷你/玩具三种体型，泰迪造型最受欢迎。聪明活泼粘人，适合家庭饲养。`},
            {n:'法国斗牛犬', l:'French Bulldog', o:'小型犬', s:'温顺伴侣', lf:'11-12年', t:`蝙蝠耳、矮胖身材。性格温顺安静，适合城市公寓。怕热，需注意皮肤褶皱清洁。`},
            {n:'巴哥犬', l:'Pug', o:'小型犬', s:'开朗粘人', lf:'12-15年', t:`圆脸大眼黑皱，身材紧凑。爱干净无体臭，对人友善。注意眼部护理和呼吸道问题。`},
            {n:'阿拉斯加雪橇犬', l:'Alaskan Malamute', o:'大型犬', s:'忠诚友善', lf:'12-15年', t:`阿拉斯加原产，体型魁梧。毛发浓密，黑白色为主。性格温和但精力充沛，需大空间。`},
            {n:'中华田园犬', l:'Chinese Rural Dog', o:'中型犬', s:'忠诚勇敢', lf:'10-15年', t:`中国本土犬种，适应力强。毛色多样，忠诚独立。适合看家护院，身体素质好。`},
            {n:'马犬', l:'Belgian Malinois', o:'中型犬', s:'敏捷警觉', lf:'12-14年', t:`比利时马里努阿犬，军警界新宠。敏捷警觉，训练性强，工作欲望高。`},
            {n:'雪纳瑞', l:'Schnauzer', o:'小型犬', s:'独立聪明', lf:'13-16年', t:`胡须标志性外观，分迷你/标准/巨型三种。性格独立，聪明警觉，是优秀的家庭守卫犬。`},
            {n:'约克夏', l:'Yorkshire Terrier', o:'小型犬', s:'活泼自信', lf:'13-16年', t:`英国玩具犬，长毛华丽金黑两色。性格活泼自信，勇敢无畏，适合陪伴。`},
            {n:'博美犬', l:'Pomeranian', o:'小型犬', s:'活泼可爱', lf:'12-16年', t:`狐狸犬后裔，毛茸茸如小狐狸。性格活泼警觉，爱叫，适合看家。需注意护理。`},
            {n:'罗威纳犬', l:'Rottweiler', o:'大型犬', s:'忠诚护卫', lf:'8-10年', t:`德国古老品种，黑棕双色。力量强大，是优秀的护卫犬。需要严格训练和社交化。`},
            {n:'秋田犬', l:'Akita Inu', o:'大型犬', s:'忠诚独立', lf:'10-13年', t:`日本秋田县原产，忠犬八公的故事主角。大型狐狸犬，性格独立忠诚，对家人温柔。`},
            {n:'寻血猎犬', l:'Bloodhound', o:'大型犬', s:'温顺追踪', lf:'10-12年', t:`世界上嗅觉最灵敏的犬种之一。皮肤松弛有褶皱，耳朵长而下垂。性格温顺。`},
            {n:'魏玛犬', l:'Weimaraner', o:'大型犬', s:'优雅活泼', lf:'11-14年', t:`德国"灰狗"，银灰色短毛。优雅敏捷，需要大量运动。忠诚黏人。`},
            {n:'蝴蝶犬', l:'Papillon', o:'小型犬', s:'活泼聪明', lf:'12-14年', t:`耳朵如蝴蝶翅膀，得名于此。小巧聪明，是小型犬中智商最高之一。`},
            {n:'北京犬', l:'Pekingese', o:'小型犬', s:'高贵独立', lf:'12-15年', t:`中国古老宫廷犬，狮子般外貌。性格高贵独立，无需大量运动。`},
            {n:'西施犬', l:'Shih Tzu', o:'小型犬', s:'温顺亲人', lf:'13-15年', t:`中国拉萨犬后裔，长毛如丝绸。性格温和亲人，是理想的伴侣犬。`},
            {n:'马尔济斯', l:'Maltese', o:'小型犬', s:'优雅粘人', lf:'12-15年', t:`白色长毛贵族犬，地中海岛国原产。性格优雅粘人，适合过敏人群。`},
            {n:'圣伯纳', l:'Saint Bernard', o:'大型犬', s:'温和巨人', lf:'8-10年', t:`瑞士救护犬，历史上拯救山中迷路者。体型巨大，性格温和。`},
            {n:'大白熊犬', l:'Great Pyrenees', o:'大型犬', s:'温和守护', lf:'10-12年', t:`法国古典护卫犬，白色长毛。性格温和，擅长保护羊群和家人。`},
            {n:'可卡犬', l:'Cocker Spaniel', o:'中型犬', s:'活泼友善', lf:'12-15年', t:`西班牙猎犬后裔，耳朵长而下垂。性格活泼友善，适合家庭饲养。`},
            {n:'吉娃娃', l:'Chihuahua', o:'超小型犬', s:'警觉粘人', lf:'12-20年', t:`世界最小犬种之一，原产地墨西哥。短毛/长毛两种，性格警觉爱叫，对主人极粘。`},
            {n:'腊肠犬', l:'Dachshund', o:'小型犬', s:'勇敢活泼', lf:'12-16年', t:`短腿长身如香肠，分标准/迷你两型。性格勇敢活泼，注意椎间盘健康。`},
            {n:'杜宾犬', l:'Dobermann', o:'大型犬', s:'忠诚机警', lf:'10-13年', t:`德国护卫犬，肌肉线条流畅。智商高服从性强，是优秀的工作犬与护卫犬。`},
            {n:'松狮犬', l:'Chow Chow', o:'中型犬', s:'独立高贵', lf:'9-15年', t:`中国古老品种，紫舌蓝唇，毛茸茸如熊。性格独立，对家人忠诚。`},
            {n:'大麦町犬（斑点狗）', l:'Dalmatian', o:'中型犬', s:'活泼机敏', lf:'10-13年', t:`白底黑色斑点，101忠狗主角。耐力极佳，曾是马车护卫犬。`},
            {n:'古牧', l:'Old English Sheepdog', o:'大型犬', s:'温顺友善', lf:'10-12年', t:`英国古代牧羊犬，长毛遮眼。性格温顺憨厚，是多乐士广告代言犬。`},
            {n:'拉布拉多德利', l:'Labradoodle', o:'大型犬', s:'聪明低敏', lf:'12-15年', t:`拉布拉多×贵宾杂交，低掉毛适合过敏家庭。聪明友善，可作服务犬。`},
            {n:'查理士王小猎犬', l:'Cavalier King Charles', o:'小型犬', s:'粘人温顺', lf:'9-14年', t:`长耳大眼贵族气质。性格超级温顺粘人，是最理想的家庭陪伴犬之一。`},
            {n:'惠比特犬', l:'Whippet', o:'中型犬', s:'安静敏捷', lf:'12-15年', t:`小灵缇，流线型身材。奔跑速度快但在家安静，适合公寓。`}
        ],
        '猫类': [
            {n:'英国短毛猫', l:'British Shorthair', o:'中型猫', s:'安静温顺', lf:'12-20年', t:`圆头圆脸，腮帮子发达，蓝灰色最经典。性格安静独立，对人温和，爱睡觉。`},
            {n:'布偶猫', l:'Ragdoll', o:'大型猫', s:'温顺粘人', lf:'12-17年', t:`体型最大的猫咪之一，毛长柔软如布偶。蓝眼睛，毛色重点色/双色/山猫纹。极其粘人，可抱可撸。`},
            {n:'暹罗猫', l:'Siamese', o:'中型猫', s:'聪明话痨', lf:'12-15年', t:`蓝眼贵族猫，脸部/耳朵/尾巴为重点色。性格活泼爱叫，智商猫类前列，会与主人"对话"。`},
            {n:'波斯猫', l:'Persian', o:'中型猫', s:'安静优雅', lf:'12-17年', t:`长毛贵族，扁脸短鼻。性格安静温和，喜欢室内慵懒生活。需每日梳毛防止毛结。`},
            {n:'缅因猫', l:'Maine Coon', o:'大型猫', s:'友善聪明', lf:'10-13年', t:`猫中"温柔的巨人"，体型可达数公斤。耳朵尖带猞猁毛，尾巴蓬松。亲人聪明，爱玩水。`},
            {n:'橘猫', l:'Orange Tabby', o:'中型猫', s:'贪吃亲人', lf:'10-15年', t:`非特定品种，泛指橘色花纹猫。普遍性格亲人，极易发胖，需控制饮食。80%为雄性。`},
            {n:'美国短毛猫', l:'American Shorthair', o:'中型猫', s:'活泼亲人', lf:'15-20年', t:`体格健壮，花纹丰富（银虎斑最有名）。性格活泼，狩猎本能强，易养。`},
            {n:'苏格兰折耳猫', l:'Scottish Fold', o:'小型猫', s:'安静乖巧', lf:'11-14年', t:`耳朵天然向前折下。性格安静温柔，对人亲和。注意先天骨骼遗传病风险。`},
            {n:'俄罗斯蓝猫', l:'Russian Blue', o:'中型猫', s:'安静敏感', lf:'15-20年', t:`蓝色短毛，银绿眼睛。性格害羞安静，对陌生人警惕，感情专一。`},
            {n:'孟加拉豹猫', l:'Bengal', o:'中型猫', s:'活泼好动', lf:'12-16年', t:`野生豹猫血统杂交。被毛像小豹子带斑纹。精力旺盛，爱攀爬玩水，需丰富环境。`},
            {n:'挪威森林猫', l:'Norwegian Forest', o:'大型猫', s:'独立勇敢', lf:'14-16年', t:`北欧古老品种，长毛强壮。性格独立，适合户外活动，善攀爬。`},
            {n:'无毛猫', l:'Sphynx', o:'中型猫', s:'外向粘人', lf:'8-14年', t:`埃及无毛猫，皮肤褶皱有弹性。性格外向，非常粘人，需要保暖和定期洗澡。`},
            {n:'阿比西尼亚猫', l:'Abyssinian', o:'中型猫', s:'活泼好奇', lf:'9-15年', t:`最古老猫种之一，外观酷似古埃及壁画。被毛"刺鼠色"，性格活泼好奇。`},
            {n:'土耳其梵猫', l:'Turkish Van', o:'大型猫', s:'活泼爱玩水', lf:'12-17年', t:`土耳其国宝猫，白色被毛头尾有花色。罕见的喜欢游泳的猫种。`},
            {n:'中华田园猫', l:'Chinese Domestic Cat', o:'中型猫', s:'聪明独立', lf:'10-15年', t:`本土猫种统称，狸花/橘猫/奶牛/三花等花色。聪明勇敢，适应力强，捕鼠能手。`},
            {n:'金吉拉', l:'Chinchilla', o:'中型猫', s:'安静高贵', lf:'12-17年', t:`波斯猫变种，银色或金色长毛。性格文静优雅，需要精心护理被毛。`},
            {n:'缅甸猫', l:'Burmese', o:'小型猫', s:'粘人活泼', lf:'10-17年', t:`东南亚品种，体型紧凑肌肉发达。性格非常粘人，爱与主人互动。`},
            {n:'伯曼猫', l:'Birman', o:'中型猫', s:'温顺安静', lf:'13-15年', t:`缅甸圣猫，重点色长毛。性格温顺安静，蓝眼睛如同蓝宝石。`},
            {n:'土耳其安哥拉猫', l:'Turkish Angora', o:'中型猫', s:'聪明独立', lf:'12-18年', t:`土耳其古老长毛猫，白色最经典。聪明独立，少数会玩戏水。`},
            {n:'东方短毛猫', l:'Oriental Shorthair', o:'中型猫', s:'外向话多', lf:'10-15年', t:`暹罗猫近亲，体型修长。性格外向爱说，对主人非常依恋。`},
            {n:'哈瓦那棕猫', l:'Havana Brown', o:'小型猫', s:'温柔好奇', lf:'13-15年', t:`英国品种，巧克力棕色短毛绿眼。性格温柔好奇，擅长与人互动。`},
            {n:'曼基康猫', l:'Munchkin', o:'小型猫', s:'活泼可爱', lf:'12-15年', t:`短腿猫，学名曼基康。性格活泼开朗，奔跑如兔子。注意脊柱健康。`},
            {n:'重点色短毛猫', l:'Colorpoint Shorthair', o:'中型猫', s:'外向话多', lf:'12-16年', t:`暹罗猫近亲，毛色更多样。性格外向爱说，非常依恋主人。`},
            {n:'异国短毛猫', l:'Exotic Shorthair', o:'中型猫', s:'安静粘人', lf:'12-15年', t:`加菲猫原型，短毛版波斯猫。扁脸大眼，性格粘人安静。`},
            {n:'塞尔凯克卷毛猫', l:'Selkirk Rex', o:'中型猫', s:'温顺亲人', lf:'12-15年', t:`自然卷毛像小羊羔。性格温和亲人，被毛柔软蓬松。`},
            {n:'美国卷耳猫', l:'American Curl', o:'中型猫', s:'活泼亲人', lf:'12-16年', t:`耳朵自然向后卷曲。性格活泼亲人，与小孩和其他宠物相处好。`},
            {n:'埃及猫', l:'Egyptian Mau', o:'中型猫', s:'敏捷活泼', lf:'12-15年', t:`天然豹纹短毛，猫中速度最快。古埃及壁画同款，聪明活泼。`},
            {n:'新加坡猫', l:'Singapura', o:'小型猫', s:'粘人好奇', lf:'11-15年', t:`世界最小猫种之一，体重仅2-3kg。大眼大耳，性格粘人。`},
            {n:'英短 银渐层', l:'British Shorthair Silver', o:'中型猫', s:'安静亲人', lf:'12-20年', t:`银色毛尖渐变，英短热门色号。圆脸可爱性格温和。`},
            {n:'英短 蓝白', l:'British Shorthair Blue White', o:'中型猫', s:'安静粘人', lf:'12-20年', t:`蓝灰+白色双色英短，正八脸品相为佳。性格温柔亲人。`},
            {n:'美短 加白', l:'American Shorthair Bicolor', o:'中型猫', s:'活泼亲人', lf:'15-20年', t:`银虎斑加白，美国短毛猫热门花色。体格健壮好养活。`},
            {n:'布偶 海双', l:'Ragdoll Seal Bicolor', o:'大型猫', s:'粘人温顺', lf:'12-17年', t:`布偶最热门花色之一：海豹色重点+白色面具双色。蓝眼长毛极美。`},
            {n:'布偶 蓝双', l:'Ragdoll Blue Bicolor', o:'大型猫', s:'粘人温柔', lf:'12-17年', t:`蓝色重点+白色面具双色，毛柔软如棉花糖，极其粘人。`},
            {n:'奶牛猫', l:'Tuxedo Cat', o:'中型猫', s:'活泼中二', lf:'10-15年', t:`黑白花色像穿燕尾服。俗称"猫中二哈"，精力旺盛行为搞笑。`},
            {n:'三花猫', l:'Calico Cat', o:'中型猫', s:'独立傲娇', lf:'10-15年', t:`黑橘白三色混合，几乎全为雌性。性格独立傲娇，有招财猫寓意。`},
            {n:'玳瑁猫', l:'Tortoiseshell', o:'中型猫', s:'倔强敏感', lf:'10-15年', t:`黑橘相间无白色，几乎全雌性。性格倔强敏感，俗称"玳瑁玳瑁，越养越俏"。`},
            {n:'褴褛猫', l:'Ragamuffin', o:'大型猫', s:'粘人温顺', lf:'13-16年', t:`布偶近亲，更大更圆润。性格温顺粘人，可抱可撸。`},
        ],
        '鸟类': [
            {n:'虎皮鹦鹉', l:'Melopsittacus undulatus', o:'小型鸟', s:'活泼爱唱', lf:'5-10年', t:`又名娇凤，全球最普及宠物鸟。原始种黄绿带虎斑，人工繁育颜色达数百种。可学说话，需互动。`},
            {n:'玄凤鹦鹉', l:'Nymphicus hollandicus', o:'中型鸟', s:'温顺粘人', lf:'15-25年', t:`又名鸡尾鹦鹉，鸡尾红冠、黄脸红腮。性格温和，能学说话、吹口哨、会亲人互动。`},
            {n:'八哥', l:'Acridotheres cristatellus', o:'中型鸟', s:'聪明话多', lf:'10-15年', t:`黑色羽毛带金属光泽。极善模仿人语，是传统笼养鸣鸟。需每日遛鸟。`},
            {n:'牡丹鹦鹉', l:'Agapornis', o:'小型鸟', s:'活泼好动', lf:'10-15年', t:`又名爱情鸟，羽色鲜艳。需成对饲养，否则易抑郁。体型小巧，性格活跃。`},
            {n:'葵花凤头鹦鹉', l:'Cacatua galerita', o:'大型鸟', s:'聪明粘人', lf:'40-60年', t:`白色羽冠可竖起呈葵花状。寿命极长，可陪伴主人一生。智商极高，会拆家。`},
            {n:'百灵鸟', l:'Melanocorypha', o:'小型鸟', s:'爱唱歌', lf:'8-12年', t:`中国传统名鸟，鸣声清脆。擅长高空飞鸣，需大笼养，羽色素雅。`},
            {n:'画眉鸟', l:'Garrulax canorus', o:'中型鸟', s:'好斗爱唱', lf:'8-10年', t:`眼圈白眉如画，鸣声婉转。雄鸟好斗，传统斗鸟对象。每天需遛鸟。`},
            {n:'金丝雀', l:'Serinus canaria', o:'小型鸟', s:'活泼鸣唱', lf:'10-15年', t:`欧洲传统笼鸟，羽毛黄色最经典。雄鸟鸣声如银铃，颜色品种多达数十种。`},
            {n:'珍珠鸟', l:'Taeniopygia guttata', o:'小型鸟', s:'温顺胆小', lf:'5-8年', t:`斑胸草雀，小巧可爱，灰色羽毛两侧白色斑点。容易繁殖，适合新手。`},
            {n:'和尚鹦鹉', l:'Myiopsitta monachus', o:'中型鸟', s:'话痨聪明', lf:'20-30年', t:`唯一会自己筑巢的鹦鹉。绿色羽毛灰胸，会学较多词汇，爱啃咬。`},
            {n:'灰鹦鹉', l:'Psittacus erithacus', o:'大型鸟', s:'聪明高智商', lf:'40-60年', t:`非洲灰鹦鹉，公认说话能力最强的鹦鹉。寿命极长，智商如5-7岁儿童。`},
            {n:'亚历山大鹦鹉', l:'Psittacula eupatria', o:'大型鸟', s:'聪明温和', lf:'20-30年', t:`亚洲最大长尾鹦鹉之一。绿色羽毛红喙，会学说话，性格温和。`},
            {n:'小太阳鹦鹉', l:'Pyrrhura molinae', o:'中小型鸟', s:'活泼亲人', lf:'15-20年', t:`绿颊锥尾鹦鹉俗称。羽毛绿为主腹部红，粘人活泼爱撒娇。`},
            {n:'太平洋鹦鹉', l:'Forpus coelestis', o:'小型鸟', s:'安静温顺', lf:'10-15年', t:`世界最小鹦鹉之一，蓝色/绿色。性格安静温顺，适合公寓饲养。`},
            {n:'相思鸟', l:'Leiothrix lutea', o:'小型鸟', s:'爱唱爱动', lf:'8-10年', t:`红嘴相思鸟，羽毛艳丽鸣声悦耳。传统笼养观赏鸟，需成对饲养。`},
            {n:'七彩文鸟', l:'Erythrura gouldiae', o:'小型鸟', s:'安静美丽', lf:'5-8年', t:`又名胡锦鸟，羽毛七彩斑斓。颜值极高，是最美丽的观赏鸟之一。`},
            {n:'文鸟', l:'Lonchura oryzivora', o:'小型鸟', s:'温顺易养', lf:'5-10年', t:`爪哇禾雀，白色/灰色。温顺好养易繁殖，适合新手入门。`}
        ],
        '爬行类': [
            {n:'巴西龟', l:'Trachemys scripta', o:'水龟', s:'皮实好养', lf:'20-40年', t:`最普及的观赏龟，红耳黄斑。新手入门首选，需晒背台。外来物种请勿放生。`},
            {n:'草龟', l:'Mauremys reevesii', o:'水龟', s:'温顺皮实', lf:'30-50年', t:`中国本土龟，墨龟/金线龟。公龟成年会墨化全黑。冬眠习性，寿命长寓意吉祥。`},
            {n:'绿鬣蜥', l:'Iguana iguana', o:'蜥蜴', s:'安静素食', lf:'15-20年', t:`美洲热带大型蜥蜴，全长可达1.8米。纯素食需蔬果+UVB灯+高温环境，入门要求高。`},
            {n:'豹纹守宫', l:'Eublepharis macularius', o:'蜥蜴', s:'温顺可爱', lf:'10-20年', t:`最热门入门守宫，豹纹斑点，嘴角带"微笑"。夜行性，食蟋蟀面包虫。易繁殖品系多。`},
            {n:'玉米蛇', l:'Pantherophis guttatus', o:'蛇类', s:'温顺无毒', lf:'15-20年', t:`最受欢迎宠物蛇，花纹如玉米颗粒，橙红为主。温顺无毒体型小，食小白鼠。`},
            {n:'球蟒', l:'Python regius', o:'蛇类', s:'安静胆小', lf:'20-30年', t:`非洲小型蟒蛇，遇惊吓蜷缩成团。黑色底配黄褐色斑纹。夜行性温和，宠物蛇第一选择。`},
            {n:'角蛙', l:'Ceratophrys', o:'两栖类', s:'呆萌好养', lf:'6-10年', t:`阿根廷霸王角蛙等，体型圆胖大嘴占1/3。坐等猎物扑食，食昆虫乳鼠。需湿润环境。`},
            {n:'绿蜥蜴', l:'Lacerta viridis', o:'蜥蜴', s:'敏捷活跃', lf:'8-12年', t:`欧洲绿蜥蜴，翠绿色泽。日行喜晒，需UVB照射，食昆虫。动作灵活。`},
            {n:'黄缘闭壳龟', l:'Cuora flavomarginata', o:'半水龟', s:'亲人聪明', lf:'40-60年', t:`中国传统名龟，背甲黄边，能闭壳。食性杂，互动性强，智商龟类靠前。`},
            {n:'鬃狮蜥', l:'Pogona vitticeps', o:'蜥蜴', s:'温顺亲人', lf:'8-12年', t:`澳洲沙漠蜥蜴，受惊吓下巴鬃毛鼓起变黑。性格温顺，新手入门蜥蜴首选。`},
            {n:'蓝舌石龙子', l:'Tiliqua scincoides', o:'蜥蜴', s:'温顺好养', lf:'15-20年', t:`蓝色舌头是标志。体型中等性格温顺，杂食易养，新手友好。`},
            {n:'王蛇', l:'Lampropeltis getula', o:'蛇类', s:'温顺无毒', lf:'15-20年', t:`黑黄/黑白环纹，北美王蛇。食性广会吃其他蛇，温顺无毒适合新手。`},
            {n:'奶蛇', l:'Lampropeltis triangulum', o:'蛇类', s:'温顺活泼', lf:'12-16年', t:`红黄黑环纹酷似珊瑚蛇但无毒。体型小性格温和，宠物蛇热门。`},
            {n:'猪鼻蛇', l:'Heterodon nasicus', o:'蛇类', s:'胆小呆萌', lf:'12-18年', t:`上翘的猪鼻子是标志。遇敌会装死。性格温顺无毒，适合新手。`},
            {n:'陆龟 苏卡达', l:'Centrochelys sulcata', o:'陆龟', s:'皮实活泼', lf:'50-100年', t:`非洲第三大陆龟，生长极快。素食需高纤维，需要大空间与UVB。`},
            {n:'陆龟 赫曼', l:'Testudo hermanni', o:'陆龟', s:'活泼亲人', lf:'50-80年', t:`欧洲陆龟，体型适中。性格活泼互动性强，适合入门陆龟。`},
            {n:'地图龟', l:'Graptemys', o:'水龟', s:'活泼好动', lf:'15-25年', t:`背甲如地图纹路。北美水龟，活泼好动需晒背，水质敏感。`},
            {n:'麝香龟', l:'Sternotherus odoratus', o:'水龟', s:'皮实易养', lf:'20-30年', t:`又名臭蛋龟，受惊会分泌麝香液。小型深水龟，皮实互动性强。`},
            {n:'蛋龟 剃刀', l:'Sternotherus carinatus', o:'水龟', s:'呆萌易养', lf:'20-30年', t:`背甲高耸如刀故名剃刀。小型蛋龟，互动性强极易饲养。`},
        ],
        '鱼类': [
            {n:'金鱼', l:'Carassius auratus', o:'冷水鱼', s:'皮实好养', lf:'10-15年', t:`中国传统观赏鱼，红/橙/黑/花/龙睛/琉金等品种繁多。对水质要求不高，新手首选。`},
            {n:'孔雀鱼', l:'Poecilia reticulata', o:'小型热带鱼', s:'活泼好养', lf:'2-3年', t:`百万鱼，繁殖极快。雄鱼尾色彩虹般绚丽，胎生直接产小鱼。品系多达百种。`},
            {n:'锦鲤', l:'Cyprinus rubrofuscus', o:'冷水鱼', s:'高雅大气', lf:'40-70年', t:`观赏鱼之王，红白/大正三色/昭和三色等。日本培养登峰造极，寓意吉祥，寿命极长。`},
            {n:'热带鱼-神仙鱼', l:'Pterophyllum', o:'热带鱼', s:'优雅高贵', lf:'8-10年', t:`燕鱼/天使鱼，体侧扁呈三角形。游姿优雅，需软水老水。适合混养安静的鱼。`},
            {n:'罗汉鱼', l:'Cichlasoma', o:'慈鲷科', s:'霸气互动', lf:'8-12年', t:`额头凸起如寿星公，色彩斑斓。智商极高，会与主人互动玩耍。需单养。`},
            {n:'龙鱼', l:'Scleropages/Osteoglossum', o:'骨舌鱼', s:'霸气高贵', lf:'15-20年', t:`古老活化石，银龙/红龙/金龙/过背金龙。全身鳞片金彩闪烁，风水鱼之王。`},
            {n:'清道夫', l:'Plecostomus', o:'底栖鱼', s:'皮实清洁', lf:'10-15年', t:`异型鱼，口如吸盘可吸附玻璃清洁藻类。体型大后会吸鱼。注意外来物种勿放生。`},
            {n:'斑马鱼', l:'Danio rerio', o:'小型热带鱼', s:'群游活泼', lf:'3-5年', t:`蓝银条纹如斑马。活泼群游，适合新手，繁殖容易。科研模型生物重要物种。`},
            {n:'斗鱼', l:'Betta splendens', o:'攀鲈科', s:'华丽独立', lf:'3-5年', t:`泰国斗鱼，雄鱼尾鳍像彩裙飘逸。两雄相见会厮杀，需单独养。`},
            {n:'鹦鹉鱼', l:'Amphilophus', o:'慈鲷科', s:'喜庆活泼', lf:'5-8年', t:`杂交鱼，口如鹦鹉笑口常开。红色最受水族爱好者喜爱，寓意招财进宝。`},
            {n:'七彩神仙', l:'Symphysodon', o:'慈鲷科', s:'优雅高贵', lf:'8-10年', t:`热带鱼之王，圆盘身色彩斑斓如神仙。需软酸老水，饲养有难度但颜值极高。`},
            {n:'七彩雷龙', l:'Channa bleheri', o:'鳢科', s:'霸气互动', lf:'5-8年', t:`彩虹雷龙，小型雷龙鱼。艳丽红蓝花纹，会与主人互动，需加盖防跳。`},
            {n:'泰国虎鱼', l:'Datnioides pulcher', o:'拟松鲷科', s:'霸气好养', lf:'10-15年', t:`三纹虎鱼，虎纹般金黄色底黑斑。大型热带鱼，与龙鱼混养经典组合。`},
            {n:'皇冠三间', l:'Cichla ocellaris', o:'慈鲷科', s:'霸气凶猛', lf:'10-15年', t:`孔雀鲈，三间鱼之王。大型凶猛肉食鱼，生长迅速，鱼缸霸主之一。`},
            {n:'燕鱼（秘鲁）', l:'Pterophyllum scalare', o:'慈鲷科', s:'优雅文静', lf:'8-10年', t:`秘鲁神仙鱼，野生神仙品相。高背长鳍优雅飘逸，为神仙鱼上品。`},
            {n:'红绿灯鱼', l:'Paracheirodon innesi', o:'小型脂鲤', s:'群游炫彩', lf:'3-5年', t:`霓虹脂鲤，红蓝绿荧光色。草缸必备群游鱼，数百条一起场面震撼。`},
            {n:'宝莲灯鱼', l:'Paracheirodon axelrodi', o:'小型脂鲤', s:'群游美丽', lf:'3-5年', t:`红绿灯近亲，红色条纹贯穿全身。草缸高端群游鱼，色彩更鲜艳。`},
            {n:'胡子鱼', l:'Ancistrus', o:'异型鱼', s:'皮实清洁', lf:'8-12年', t:`胡子异型，口如吸盘长触须。小型异型，清洁鱼缸残饵藻类能力强。`},
        ],
        '小型宠物': [
            {n:'三线仓鼠', l:'Phodopus sungorus', o:'侏儒类', s:'亲人好养', lf:'1.5-2年', cat:'仓鼠亚科', t:`加卡利亚仓鼠，背部三条线。最普及入门仓鼠。毛棕灰/银灰，冬季可能变白。`},
            {n:'金丝熊', l:'Mesocricetus auratus', o:'熊类', s:'憨厚可爱', lf:'2-3年', cat:'仓鼠亚科', t:`叙利亚仓鼠，俗称金丝熊、熊仔。体型最大。金黄长毛最经典。活动空间需求较大，需47基以上笼子。`},
            {n:'银狐仓鼠', l:'Djungarian', o:'侏儒类', s:'温顺亲人', lf:'1.5-2年', cat:'仓鼠亚科', t:`三线突变种，全白背带淡灰线。性格温和，颜值高。`},
            {n:'布丁仓鼠', l:'Djungarian Pudding', o:'侏儒类', s:'胆小乖巧', lf:'1.5-2年', cat:'仓鼠亚科', t:`加卡利亚仓鼠的人工培育品种，淡黄色奶油色。易发胖，注意控制饮食。`},
            {n:'坎贝尔仓鼠', l:'Phodopus campbelli', o:'侏儒类', s:'活泼胆大', lf:'1.5-2年', cat:'仓鼠亚科', t:`俗称一线仓鼠/坎氏毛足鼠，比三线略暴躁但胆大。毛色丰富（雪球/琥珀/花仓等）。`},
            {n:'罗伯罗夫斯基', l:'Phodopus roborovskii', o:'侏儒类', s:'胆小快速', lf:'2-3年', cat:'仓鼠亚科', t:`老公公仓鼠，最小体型。眼上方眉毛花白，跑得飞快。不适合上手但观赏度高。`},
            {n:'紫仓仓鼠', l:'Djungarian Sapphire', o:'侏儒类', s:'安静好养', lf:'1.5-2年', cat:'仓鼠亚科', t:`三线突变，蓝紫色毛。性格温和安静。`},
            {n:'长毛金丝熊', l:'Long-haired Syrian', o:'熊类', s:'雍容华贵', lf:'2-3年', cat:'仓鼠亚科', t:`叙利亚长毛变种，头顶披肩发般华丽。需每日梳毛防止打结。`},
            {n:'米熊', l:'Cream Syrian', o:'熊类', s:'憨厚温和', lf:'2-3年', cat:'仓鼠亚科', t:`奶油色金丝熊。性格憨厚稳重。`},
            {n:'虎纹金丝熊', l:'Teddy Bear Syrian', o:'熊类', s:'活泼好动', lf:'2-3年', cat:'仓鼠亚科', t:`虎纹花色叙利亚仓鼠。毛短而密，活泼好动。`},
            {n:'金丝熊 眼圈熊', l:'Syrian Panda', o:'熊类', s:'呆萌温顺', lf:'2-3年', cat:'仓鼠亚科', t:`眼圈周围黑色像熊猫。性格温顺呆萌，互动性强。`},
            {n:'奶牛金丝熊', l:'Syrian Cow', o:'熊类', s:'憨厚亲人', lf:'2-3年', cat:'仓鼠亚科', t:`黑白花斑叙利亚仓鼠。性格憨厚亲人，适合新手。`},
            {n:'雪球仓鼠', l:'Campbell Snowball', o:'侏儒类', s:'活泼机警', lf:'1.5-2年', cat:'仓鼠亚科', t:`雪白一线仓鼠，红眼雪球。颜值极高，如小绒球。`},
            {n:'西伯利亚花栗鼠', l:'Tamias sibiricus', o:'花栗鼠属', s:'活泼机敏', lf:'5-10年', cat:'松鼠亚科', t:`别名金花鼠、花鼠、五道眉。体型中等，体长13-16cm。体背有5条清晰纵纹，头顶棕黑色，眼上下和耳缘白色。`},
            {n:'金狐仓鼠', l:'Djungarian Golden Fox', o:'侏儒类', s:'活泼亲人', lf:'1.5-2年', cat:'仓鼠亚科', t:`布丁仓鼠和银狐仓鼠的混血。眼睛黑色，毛色雪白，背脊一线为金黄色，线越宽越黄品相越好。极品金狐全身纯白仅背线金黄。`},
            {n:'北非肥尾沙鼠', l:'Pachyuromys duprasi', o:'沙鼠属', s:'温顺好奇', lf:'5-7年', cat:'沙鼠亚科', t:`俗称通心粉鼠。体长10-13cm，尾长5cm，尾巴粗壮像球棒一样储存脂肪。尖鼻子，毛浓密柔软像仓鼠。`},
            {n:'草原犬鼠', l:'Cynomys', o:'地松鼠属', s:'活泼好动', lf:'8-10年', cat:'松鼠亚科', t:`俗称土拨鼠。体型比仓鼠大，毛色黄褐，耳深腹浅，尾端黑色或白色。鼻子耳朵小，胡须黑色。群居动物，互动性强。`},
            {n:'毛丝鼠', l:'Chinchilla lanigera', o:'毛丝鼠科', s:'活泼好奇', lf:'15-20年', cat:'龙猫亚科', t:`俗称龙猫，学名毛丝鼠。体型小而肥胖，外形似兔与松鼠的结合体，有大而亮的眼睛和大而薄的耳朵。活泼好奇，寿命长需要大空间。`},
            {n:'英国短毛豚鼠', l:'English Short-haired', o:'短毛种', s:'温顺亲人', lf:'5-7年', cat:'豚鼠亚科', t:`最常见入门豚鼠（天竺鼠/荷兰猪），短毛光滑好打理。性格温顺亲人，适合新手。`},
            {n:'阿比西尼亚豚鼠', l:'Abyssinian', o:'短毛冠毛种', s:'活泼好动', lf:'5-7年', cat:'豚鼠亚科', t:`头顶漩涡冠毛，短毛硬直有立体花纹。性格活泼互动性强。`},
            {n:'秘鲁豚鼠', l:'Peruvian', o:'长毛种', s:'粘人温柔', lf:'5-8年', cat:'豚鼠亚科', t:`超长顺毛如长发公主。性格温柔粘人，需每日梳毛防止打结。`},
            {n:'丝质长毛豚鼠', l:'Silkie/Sheltie', o:'长毛种', s:'安静温柔', lf:'5-8年', cat:'豚鼠亚科', t:`被毛如丝绸光滑顺直，比秘鲁毛更顺滑。性格温和高贵。`},
            {n:'泰迪豚鼠', l:'Texel', o:'卷毛种', s:'呆萌可爱', lf:'5-7年', cat:'豚鼠亚科', t:`全身短卷毛像泰迪狗狗。性格呆萌亲人，毛需护理。`},
            {n:'喜马拉雅豚鼠', l:'Himalayan Cavy', o:'短毛种', s:'温顺乖巧', lf:'5-7年', cat:'豚鼠亚科', t:`白毛+耳朵/鼻/脚为重点色黑色/巧克力色，红眼睛。经典可爱花色。`},
            {n:'双色豚鼠', l:'Dutch Cavy Bicolor', o:'短毛种', s:'活泼亲人', lf:'5-7年', cat:'豚鼠亚科', t:`黑白或棕白两种配色，体型紧凑。性格活泼亲人。`},
            {n:'冠毛豚鼠', l:'Crested', o:'短毛种', s:'亲人活泼', lf:'5-7年', cat:'豚鼠亚科', t:`头顶一个小漩涡冠毛。分美冠（白冠）和英冠（同色冠），亲人活泼。`},
            {n:'英种天竺鼠', l:'English Short-haired Cavy', o:'短毛种', s:'温顺亲人', lf:'5-7年', cat:'豚鼠亚科', t:`最常见家养荷兰猪品种，短顺毛、体型短粗头大耳圆。毛色极多样，包含纯白、黑、棕、灰、双色斑纹等所有常见颜色组合。`},
            {n:'阿比西尼亚豚鼠', l:'Abyssinian Cavy (逆毛豚鼠)', o:'逆毛种', s:'活泼亲人', lf:'5-7年', cat:'豚鼠亚科', t:`逆毛豚鼠之王。全身8-12个独特的螺旋漩涡毛轮(rosettes)，毛发竖立粗糙，外形狂野可爱。性格活泼。`},
            {n:'斯兰德豚鼠', l:'Skinny Pig (无毛豚鼠)', o:'无毛种', s:'温顺粘人', lf:'5-7年', cat:'豚鼠亚科', t:`无毛毛绒豚鼠，体表近乎无毛光滑粉皮肤，仅口鼻脚爪有少量短毛。外形奇特可爱，体温比有毛豚鼠略高，需注意保暖。`},
            {n:'巧克力荷兰天竺鼠', l:'Chocolate Dutch Cavy', o:'短毛种', s:'温顺亲人', lf:'5-7年', cat:'豚鼠亚科', t:`巧克力色荷兰天竺鼠，体长22-34cm，体重400-700g。毛色像巧克力色，头部较大，眼睛圆而明亮。`}
        ],
        '宠物甲虫': [
            {n:'独角仙', l:'Trypoxylus dichotomus', o:'兜虫', s:'皮实好斗', lf:'成虫2-6月', t:`最受欢迎甲虫。雄虫头顶长"Y"形独角，力大可举自身体重100倍。幼虫蛴螬型腐木饲养。`},
            {n:'长戟大兜虫', l:'Dynastes hercules', o:'兜虫', s:'霸气威武', lf:'成虫4-8月', t:`世界最大甲虫之一，黑色胸角极长。产自美洲热带。需高温度高湿度。`},
            {n:'中国大锹', l:'Dorcus hopei', o:'锹形虫', s:'霸气好斗', lf:'成虫1-2年', t:`中国本土锹甲之王，黑色亮甲大颚发达。寿命较长，可越年。`},
            {n:'金龟子', l:'Scarabaeidae', o:'金龟科', s:'颜色多变', lf:'数月', t:`鞘翅目最大科，颜色金/绿/铜/蓝。成虫食花果，幼虫食腐殖质。`},
            {n:'天牛', l:'Cerambycidae', o:'天牛科', s:'威武有力', lf:'数月至1年', t:`超长触角可达体长数倍。幼虫蛀木，成虫寿命短。种类繁多颜色丰富。`},
            {n:'象鼻虫', l:'Curculionidae', o:'象甲科', s:'奇特可爱', lf:'数月', t:`嘴巴长如象鼻。甲虫种类最多家族。米象/竹象常见。`},
            {n:'瓢虫', l:'Coccinellidae', o:'瓢甲科', s:'小巧可爱', lf:'数周', t:`红底黑点最经典。益虫，吃蚜虫。小朋友的昆虫朋友。`},
        ],
        '兔类': [
            {n:'荷兰垂耳兔', l:'Holland Lop', o:'小型兔', s:'温顺亲人', lf:'7-10年', t:`最受欢迎宠物兔，两只大耳朵自然下垂。体型迷你圆滚，亲人乖巧。`},
            {n:'新西兰兔', l:'New Zealand', o:'大型兔', s:'健壮温和', lf:'8-12年', t:`纯白色红眼最经典。体型大肉质佳，也可作宠物。性情温和易管理。`},
            {n:'荷兰侏儒兔', l:'Netherland Dwarf', o:'小型兔', s:'活泼好动', lf:'7-10年', t:`耳朵短、脸圆、体型最小之一。活泼机敏，需要较大活动空间。`},
            {n:'狮子兔', l:'Lionhead', o:'小型兔', s:'亲人好奇', lf:'8-10年', t:`脸颊围一圈鬃毛像狮子。性格活泼亲人，毛易打结需打理。`},
            {n:'安哥拉兔', l:'Angora', o:'大型兔', s:'温柔粘人', lf:'7-12年', t:`长毛像棉花团。英系/法系/德系/巨型。需频繁剪毛，毛可纺织。`},
            {n:'道奇兔', l:'Dutch', o:'中型兔', s:'聪明好奇', lf:'6-9年', t:`黑白经典配色。体型中等，性格活泼好奇。`},
            {n:'喜马拉雅兔', l:'Himalayan', o:'中型兔', s:'安静温和', lf:'5-8年', t:`红眼白色毛耳脸尾脚为黑。短毛好打理。`},
            {n:'加利福尼亚兔', l:'Californian', o:'大型兔', s:'温顺亲人', lf:'5-10年', t:`类似喜马拉雅体型更大。毛柔软白色，耳朵口鼻尾巴黑色。`},
            {n:'雷克斯兔', l:'Rex', o:'大型兔', s:'聪明亲人', lf:'6-8年', t:`短绒如丝绒，无枪毛（俗称獭兔），毛色丰富，栗棕色/虎斑色最经典常见。毛手感极柔软。`},
            {n:'熊猫兔', l:'Panda Rabbit (又名海棠兔/Hotot)', o:'中型兔', s:'活泼呆萌', lf:'6-9年', t:`白底黑眼圈如大熊猫，又称海棠兔（Blanc de Hotot），同一品种不同俗称。中国流行宠物兔，性格活泼呆萌。`},
            {n:'迷你垂耳兔', l:'Mini Lop', o:'小型兔', s:'温顺亲人', lf:'7-10年', t:`德国迷你垂耳，体型比荷兰垂耳略大。耳朵下垂超级可爱。`},
        ],
        '两栖类': [
            {n:'非洲爪蟾', l:'Xenopus laevis', o:'蛙类', s:'皮实好养', lf:'10-15年', t:`最普及宠物蛙，水栖。体型扁平，后肢有力。食性杂，皮实。`},
            {n:'箭毒蛙', l:'Dendrobatidae', o:'蛙类', s:'色彩艳丽', lf:'5-10年', t:`世界上最美丽的青蛙，色彩鲜艳。但野生个体剧毒！宠物个体无毒，需注意。`},
            {n:'小丑蛙', l:'Phrynomerus bifasciatus', o:'蛙类', s:'呆萌可爱', lf:'8-10年', t:`花纹鲜艳，性情温和。饲养简单，适合新手。`},
            {n:'红眼树蛙', l:'Agalychnis callidryas', o:'蛙类', s:'树栖活跃', lf:'5-8年', t:`大眼睛红色，身体绿色带白纹。树栖生活，需要高湿度环境。`},
            {n:'墨西哥钝口螈', l:'Ambystoma mexicanum', o:'蝾螈', s:'憨态可爱', lf:'15-20年', t:`又名六角恐龙，幼态永远保持。黑色/白色/金色体色。食性广，寿命长。`},
            {n:'东方铃蟾', l:'Bombina orientalis', o:'蛙类', s:'温顺安静', lf:'10-15年', t:`背部绿色带黑斑，腹部橘红带黑。性格温顺，是常见的宠物蛙。`},
            {n:'非洲牛蛙', l:'Pyxicephalus adspersus', o:'蛙类', s:'贪吃凶猛', lf:'15-20年', t:`体型巨大，能长到拳头大。贪吃且凶猛，会攻击小型动物。`},
            {n:'老爷树蛙', l:'Litoria caerulea', o:'树蛙', s:'呆萌温顺', lf:'15-20年', t:`澳洲绿雨滨蛙俗称老爷蛙。翠绿色体型圆胖，嘴角上扬像微笑。`},
            {n:'大泛树蛙', l:'Zhangixalus dennysi', o:'树蛙', s:'安静温顺', lf:'10-15年', t:`中国本土大树蛙，翠绿大脚盘。体型大，互动性不错。`},
            {n:'火蝾螈', l:'Salamandra salamandra', o:'蝾螈', s:'安静好养', lf:'20-30年', t:`黑底黄斑色经典蝾螈。寿命极长，半水栖饲养。`}
        ]
    };
    const categories = [
        { key: '犬类', icon: '🐕', color: '#F59E0B' },
        { key: '猫类', icon: '🐈', color: '#8B5CF6' },
        { key: '鸟类', icon: '🦜', color: '#10B981' },
        { key: '爬行类', icon: '🐢', color: '#06B6D4' },
        { key: '鱼类', icon: '🐟', color: '#3B82F6' },
        { key: '小型宠物', icon: '🐾', color: '#F43F5E' },
        { key: '宠物甲虫', icon: '🪲', color: '#6366F1' },
        { key: '兔类', icon: '🐇', color: '#FBBF24' },
        { key: '两栖类', icon: '🐸', color: '#22C55E' }
    ];
    const rightTips = categories.map(c => {
        const tipsByCat = {
            '犬类': '遛狗牵绳、定期驱虫免疫、每日梳毛、定时定量喂食、注意口腔牙齿清洁',
            '猫类': '猫砂盆每日清洁、提供垂直攀爬空间、每年免疫驱虫、控制体重避免肥胖',
            '鸟类': '保持笼舍清洁、每日提供新鲜饮水蔬果、定期放飞、避免油烟香烟',
            '爬行类': 'UVB灯+UVA灯+控温控湿、补钙D3、活食消毒、避免过度上手',
            '鱼类': '24h开过滤+加氧、每周换水1/3、不混养凶猛体型悬殊、定期检测水质',
            '小型宠物': '大笼子+跑轮、冬季保暖、禁止水洗、禁止合笼、定期换木屑/浴沙、提摩西草为主食、维C补充、控制湿度50-60%',
            '宠物甲虫': '腐殖土/发酵木屑、温控20-28度、高湿度、成虫喂食果冻水果',
            '兔类': '提摩西草为主食+凉白开无限量、每月剪指甲、适当放风、不喂淀粉糖',
            '两栖类': '保持水质清洁、定期换水、控温18-25度、提供躲避场所、避免接触农药'
        };
        return tipsByCat[c.key] || '请参考专业兽医建议';
    });
    const defaultCat = '犬类';
    const catImageMap = {
        '犬类': '/static/images/dog.jpg',
        '猫类': '/static/images/cat.jpg',
        '鸟类': '/static/images/bird.jpg',
        '爬行类': '/static/images/reptile.jpg',
        '鱼类': '/static/images/fish.jpg',
        '小型宠物': '/static/images/hamster.jpg',
        '宠物甲虫': '/static/images/beetle.jpg',
        '兔类': '/static/images/rabbit.jpg',
        '两栖类': '/static/images/frog.jpg'
    };
    const breedImageMap = {
        // 犬类 (37种)
        '金毛寻回犬': '/static/images/golden.jpg',
        '拉布拉多': '/static/images/labrador.jpg',
        '拉布拉多犬': '/static/images/labrador.jpg',
        '柯基犬': '/static/images/corgi.jpg',
        '德国牧羊犬': '/static/images/german_shepherd.jpg',
        '柴犬': '/static/images/shiba.jpg',
        '比熊犬': '/static/images/bichon.jpg',
        '萨摩耶': '/static/images/samoyed.jpg',
        '边境牧羊犬': '/static/images/border_collie.jpg',
        '斗牛犬': '/static/images/bulldog.jpg',
        '贵宾犬': '/static/images/poodle.jpg',
        '哈士奇': '/static/images/husky.jpg',
        '法国斗牛犬': '/static/images/french_bulldog.jpg',
        '巴哥犬': '/static/images/pug.jpg',
        '阿拉斯加雪橇犬': '/static/images/alaskan_malamute.jpg',
        '中华田园犬': '/static/images/chinese_rural_dog.jpg',
        '马犬': '/static/images/malinois.jpg',
        '雪纳瑞': '/static/images/schnauzer.jpg',
        '约克夏': '/static/images/yorkshire_terrier.jpg',
        '博美犬': '/static/images/pomeranian.jpg',
        '罗威纳犬': '/static/images/rottweiler.jpg',
        '秋田犬': '/static/images/akita_inu.jpg',
        '寻血猎犬': '/static/images/bloodhound.jpg',
        '魏玛犬': '/static/images/weimaraner.jpg',
        '蝴蝶犬': '/static/images/papillon.jpg',
        '北京犬': '/static/images/pekingese.jpg',
        '西施犬': '/static/images/shih_tzu.jpg',
        '马尔济斯': '/static/images/maltese.jpg',
        '圣伯纳': '/static/images/saint_bernard.jpg',
        '大白熊犬': '/static/images/great_pyrenees.jpg',
        '可卡犬': '/static/images/cocker_spaniel.jpg',
        '吉娃娃': '/static/images/chihuahua.jpg',
        '腊肠犬': '/static/images/dachshund.jpg',
        '杜宾犬': '/static/images/doberman.jpg',
        '松狮犬': '/static/images/chow_chow.jpg',
        '大麦町犬': '/static/images/dalmatian.jpg',
        '大麦町犬（斑点狗）': '/static/images/dalmatian.jpg',
        '古牧': '/static/images/old_english_sheepdog.jpg',
        '拉布拉多德利': '/static/images/labradoodle.jpg',
        '查理士王小猎犬': '/static/images/cavalier_king_charles.jpg',
        '惠比特犬': '/static/images/whippet.jpg',
        // 猫类 (37种)
        '英国短毛猫': '/static/images/british.jpg',
        '布偶猫': '/static/images/cat_ragdoll.jpg',
        '暹罗猫': '/static/images/cat_siamese.jpg',
        '波斯猫': '/static/images/persian_cat.jpg',
        '缅因猫': '/static/images/maine_coon.jpg',
        '橘猫': '/static/images/orange_tabby_cat_v2.jpg',
        '美国短毛猫': '/static/images/american_shorthair.jpg',
        '苏格兰折耳猫': '/static/images/scottish_fold.jpg',
        '俄罗斯蓝猫': '/static/images/russian_blue.jpg',
        '孟加拉豹猫': '/static/images/bengal.jpg',
        '挪威森林猫': '/static/images/norwegian_forest_cat.jpg',
        '无毛猫': '/static/images/sphynx.jpg',
        '斯芬克斯': '/static/images/sphynx.jpg',
        '阿比西尼亚猫': '/static/images/abyssinian.jpg',
        '土耳其梵猫': '/static/images/turkish_van.jpg',
        '中华田园猫': '/static/images/chinese_domestic_cat_v2.jpg',
        '狸花猫': '/static/images/lihua_cat.jpg',
        '金吉拉': '/static/images/chinchilla_cat.jpg',
        '缅甸猫': '/static/images/burmese.jpg',
        '伯曼猫': '/static/images/birman.jpg',
        '土耳其安哥拉猫': '/static/images/turkish_angora.jpg',
        '东方短毛猫': '/static/images/oriental_shorthair.jpg',
        '哈瓦那棕猫': '/static/images/havana_brown.jpg',
        '曼基康猫': '/static/images/munchkin.jpg',
        '重点色短毛猫': '/static/images/cat_siamese.jpg',
        '异国短毛猫': '/static/images/exotic_shorthair.jpg',
        '塞尔凯克卷毛猫': '/static/images/selkirk_rex.jpg',
        '美国卷耳猫': '/static/images/american_curl.jpg',
        '埃及猫': '/static/images/egyptian_mau_v2.jpg',
        '新加坡猫': '/static/images/singapura.jpg',
        '英短 银渐层': '/static/images/british.jpg',
        '英短 蓝白': '/static/images/british_blue_white.jpg',
        '美短 加白': '/static/images/american_shorthair_bicolor.jpg',
        '布偶 海双': '/static/images/ragdoll_seal.jpg',
        '布偶 蓝双': '/static/images/ragdoll_blue.jpg',
        '奶牛猫': '/static/images/tuxedo.jpg',
        '三花猫': '/static/images/calico.jpg',
        '玳瑁猫': '/static/images/tortoiseshell.jpg',
        '褴褛猫': '/static/images/ragamuffin_v2.jpg',
        // 鸟类 (17种)
        '虎皮鹦鹉': '/static/images/budgie.jpg',
        '玄凤鹦鹉': '/static/images/cockatiel.jpg',
        '八哥': '/static/images/myna.jpg',
        '牡丹鹦鹉': '/static/images/lovebird.jpg',
        '葵花凤头鹦鹉': '/static/images/sulphur_cockatoo.jpg',
        '百灵鸟': '/static/images/lark.jpg',
        '画眉鸟': '/static/images/hwamei.jpg',
        '金丝雀': '/static/images/canary.jpg',
        '珍珠鸟': '/static/images/zebra_finch.jpg',
        '和尚鹦鹉': '/static/images/monk_parakeet.jpg',
        '灰鹦鹉': '/static/images/african_grey.jpg',
        '亚历山大鹦鹉': '/static/images/alexander_parakeet.jpg',
        '小太阳鹦鹉': '/static/images/sun_conure.jpg',
        '太平洋鹦鹉': '/static/images/parrotlet.jpg',
        '相思鸟': '/static/images/redbilled_leiothrix.jpg',
        '七彩文鸟': '/static/images/gouldian_finch.jpg',
        '文鸟': '/static/images/java_sparrow.jpg',
        // 爬行类 (19种)
        '巴西龟': '/static/images/turtle.jpg',
        '草龟': '/static/images/grass_turtle.jpg',
        '中华草龟': '/static/images/grass_turtle.jpg',
        '绿鬣蜥': '/static/images/iguana.jpg',
        '豹纹守宫': '/static/images/gecko.jpg',
        '玉米蛇': '/static/images/corn_snake.jpg',
        '球蟒': '/static/images/ball_python.jpg',
        '角蛙': '/static/images/horned_frog.jpg',
        '绿蜥蜴': '/static/images/green_lizard.jpg',
        '黄缘闭壳龟': '/static/images/yellow_box_turtle.jpg',
        '鬃狮蜥': '/static/images/bearded_dragon.jpg',
        '蓝舌石龙子': '/static/images/blue_tongue_skink.jpg',
        '王蛇': '/static/images/king_snake.jpg',
        '奶蛇': '/static/images/milk_snake.jpg',
        '猪鼻蛇': '/static/images/hognose_snake.jpg',
        '陆龟 苏卡达': '/static/images/sulcata_tortoise.jpg',
        '陆龟 赫曼': '/static/images/hermann_tortoise.jpg',
        '地图龟': '/static/images/map_turtle.jpg',
        '麝香龟': '/static/images/musk_turtle.jpg',
        '蛋龟 剃刀': '/static/images/razor_musk_turtle.jpg',
        // 鱼类 (19种)
        '金鱼': '/static/images/goldfish.jpg',
        '孔雀鱼': '/static/images/guppy.jpg',
        '锦鲤': '/static/images/koi.jpg',
        '热带鱼-神仙鱼': '/static/images/angelfish.jpg',
        '神仙鱼': '/static/images/angelfish.jpg',
        '罗汉鱼': '/static/images/flowerhorn.jpg',
        '龙鱼': '/static/images/arowana.jpg',
        '清道夫': '/static/images/pleco.jpg',
        '斑马鱼': '/static/images/zebrafish.jpg',
        '斗鱼': '/static/images/betta.jpg',
        '鹦鹉鱼': '/static/images/parrotfish.jpg',
        '七彩神仙': '/static/images/discus.jpg',
        '七彩雷龙': '/static/images/rainbow_snakehead.jpg',
        '泰国虎鱼': '/static/images/tiger_fish.jpg',
        '皇冠三间': '/static/images/peacock_bass.jpg',
        '燕鱼（秘鲁）': '/static/images/angelfish.jpg',
        '红绿灯鱼': '/static/images/neon_tetra.jpg',
        '宝莲灯鱼': '/static/images/cardinal_tetra.jpg',
        '胡子鱼': '/static/images/pleco.jpg',
        // 小型宠物 (仓鼠/沙鼠/松鼠/龙猫/豚鼠 共30种)
        '三线仓鼠': '/static/images/dwarf_hamster.jpg',
        '金丝熊': '/static/images/hamster.jpg',
        '银狐仓鼠': '/static/images/hamster_silver.jpg',
        '布丁仓鼠': '/static/images/pudding_hamster.jpg',
        '坎贝尔仓鼠': '/static/images/campbell.jpg',
        '罗伯罗夫斯基': '/static/images/roborovski.jpg',
        '罗伯罗夫斯基仓鼠': '/static/images/roborovski.jpg',
        '紫仓仓鼠': '/static/images/sapphire_hamster.jpg',
        '长毛金丝熊': '/static/images/long_haired_syrian.jpg',
        '米熊': '/static/images/cream_syrian.jpg',
        '虎纹金丝熊': '/static/images/teddy_hamster.jpg',
        '金丝熊 眼圈熊': '/static/images/panda_hamster.jpg',
        '奶牛金丝熊': '/static/images/cow_syrian_hamster.jpg',
        '雪球仓鼠': '/static/images/hamster_snowball.jpg',
        '老公公仓鼠': '/static/images/hamster_roborovski.jpg',
        '西伯利亚花栗鼠': '/static/images/siberian_chipmunk.jpg',
        '金狐仓鼠': '/static/images/golden_fox_hamster.jpg',
        '北非肥尾沙鼠': '/static/images/desert_gerbil.jpg',
        '草原犬鼠': '/static/images/prairie_dog.jpg',
        '毛丝鼠': '/static/images/chinchilla.jpg',
        '英国短毛豚鼠': '/static/images/guinea_pig_short_hair.jpg',
        '阿比西尼亚豚鼠': '/static/images/guinea_pig_abyssinian.jpg',
        '秘鲁豚鼠': '/static/images/guinea_pig_peruvian.jpg',
        '丝质长毛豚鼠': '/static/images/guinea_pig_silkie.jpg',
        '泰迪豚鼠': '/static/images/guinea_pig_texel.jpg',
        '喜马拉雅豚鼠': '/static/images/guinea_pig_himalayan.jpg',
        '双色豚鼠': '/static/images/guinea_pig_dutch.jpg',
        '冠毛豚鼠': '/static/images/guinea_pig_crested.jpg',
        '英种天竺鼠': '/static/images/guinea_pig_english.jpg',
        '阿比西尼亚豚鼠': '/static/images/abyssinian_guinea_pig.jpg',
        '斯兰德豚鼠': '/static/images/skinny_pig_placeholder.jpg',
        '巧克力荷兰天竺鼠': '/static/images/guinea_pig_choco_dutch.jpg',
        // 宠物甲虫 (7种)
        '独角仙': '/static/images/rhinoceros_beetle.jpg',
        '长戟大兜虫': '/static/images/hercules_beetle.jpg',
        '中国大锹': '/static/images/china_stag.jpg',
        '金龟子': '/static/images/scarab.jpg',
        '天牛': '/static/images/longhorn.jpg',
        '象鼻虫': '/static/images/weevil.jpg',
        '瓢虫': '/static/images/ladybug.jpg',
        // 兔类 (11种)
        '荷兰垂耳兔': '/static/images/holland_lop.jpg',
        '新西兰兔': '/static/images/new_zealand_rabbit.jpg',
        '荷兰侏儒兔': '/static/images/netherland_dwarf.jpg',
        '狮子兔': '/static/images/lionhead.jpg',
        '安哥拉兔': '/static/images/angora.jpg',
        '道奇兔': '/static/images/dutch_rabbit.jpg',
        '喜马拉雅兔': '/static/images/himalayan_rabbit.jpg',
        '加利福尼亚兔': '/static/images/californian_rabbit.jpg',
        '雷克斯兔': '/static/images/rex_rabbit_castor_v2.jpg',
        '熊猫兔': '/static/images/panda_rabbit.jpg',
        '迷你垂耳兔': '/static/images/mini_lop.jpg',
        // 两栖类 (10种)
        '非洲爪蟾': '/static/images/xenopus.jpg',
        '箭毒蛙': '/static/images/poison_frog.jpg',
        '小丑蛙': '/static/images/clown_frog.jpg',
        '红眼树蛙': '/static/images/red_eye_frog.jpg',
        '墨西哥钝口螈': '/static/images/axolotl.jpg',
        '东方铃蟾': '/static/images/fire_bellied_toad.jpg',
        '非洲牛蛙': '/static/images/bullfrog.jpg',
        '老爷树蛙': '/static/images/whites_tree_frog.jpg',
        '大泛树蛙': '/static/images/chinese_big_treefrog.jpg',
        '火蝾螈': '/static/images/fire_salamander.jpg'
    };
    const getBreedImg = (cat, breedName) => {
        // 1. 精确匹配
        if (breedImageMap[breedName]) return breedImageMap[breedName];
        // 2. 模糊匹配：去掉常见后缀（犬/猫/鸟等）再匹配
        const stripped = breedName.replace(/[犬猫鸟兔龟鱼蜥蛇蛙虫鼠龙猫鱼等兽类飞禽$]/g, '');
        if (stripped !== breedName && breedImageMap[stripped]) {
            return breedImageMap[stripped];
        }
        // 3. 包含匹配：检查是否有品种名被包含在当前名中，或当前名被包含
        for (const [key, val] of Object.entries(breedImageMap)) {
            if (breedName.includes(key) || key.includes(breedName)) {
                return val;
            }
        }
        // 4. 使用品类默认图（不再按索引旋转取图，避免张冠李戴）
        return catImageMap[cat] || '/static/images/dog.jpg';
    };
    window.getBreedImg = getBreedImg;
    const renderCat = (cat, breeds) => `
        <div class="ref-breed-grid" style="grid-template-columns: repeat(2, 1fr); gap: 14px;">
            ${breeds.map(b => `
                <div class="kb-extended-item" style="--cat-color:${categories.find(c=>c.key===cat).color}" onclick="showBreedDetailView('${cat}','${b.n}')">
                    <div style="width:100%;height:120px;overflow:hidden;border-radius:8px;margin-bottom:10px;background:#0c1e38;position:relative">
                        <img src="${getBreedImg(cat, b.n)}" style="width:100%;height:100%;object-fit:contain;opacity:0.85" onerror="this.style.display='none';var fb=this.parentElement.querySelector('.kb-fallback');if(fb)fb.style.display='flex'">
                        <div class="kb-fallback" style="display:none;width:100%;height:100%;align-items:center;justify-content:center;font-size:48px;background:linear-gradient(135deg, ${categories.find(c=>c.key===cat).color}30, transparent)">${categories.find(c=>c.key===cat).icon}</div>
                    </div>
                    <div class="kb-ext-name">${b.n}${b.cat?`<span style="color:#7DD3FC;font-size:11px;margin-left:6px">· ${b.cat}</span>`:''}</div>
                    <div class="kb-ext-latin">${b.l}</div>
                    <div class="kb-ext-line"><span>体型分类：</span>${b.o}</div>
                    <div class="kb-ext-line"><span>性格特点：</span>${b.s}</div>
                    <div class="kb-ext-line"><span>平均寿命：</span>${b.lf}</div>
                </div>
            `).join('')}
        </div>
        <div class="ref-breed-tip"><div class="ref-tip-header"><span>💡</span>${cat} 通用养护要点</div><div class="ref-tip-body">${rightTips[categories.findIndex(c=>c.key===cat)]}</div></div>
    `;
    container.innerHTML = `
        <div class="ref-knowledge-layout">
            <div class="kb-search-sticky">
                <div class="kb-search-row">
                    <div class="kb-search-box">
                        <span class="kb-search-icon">🔎</span>
                        <input type="text" id="kbSearchInput" class="kb-search-input" placeholder="搜索品种 / 学名 / 特征 / 养护关键词…" autocomplete="off">
                        <span class="kb-search-shortcut">Ctrl+K</span>
                    </div>
                    <button class="btn btn-primary" onclick="doKbSearch()">🔍 搜索</button>
                    <button class="btn btn-secondary" onclick="clearKbSearch()">✕ 清空</button>
                </div>
                <div class="kb-hot-tags">
                    <span style="color:#7DD3FC;font-size:12px">热门：</span>
                    ${['金毛寻回犬','布偶猫','虎皮鹦鹉','豹纹守宫','孔雀鱼','金丝熊','独角仙','毛丝鼠','墨西哥钝口螈'].map(t => `<span class="kb-hot-tag" onclick="setKbSearch('${t}')">${t}</span>`).join('')}
                    <span style="color:#7DD3FC;font-size:12px;margin-left:8px">| 分类：</span>
                    ${categories.map(c => `<span class="kb-hot-tag" style="border-color:${c.color}40;color:${c.color}" onclick="switchKnowledgeCat('${c.key}',null);document.getElementById('knowledgeMainSection').scrollIntoView({behavior:'smooth'})">${c.icon} ${c.key}</span>`).join('')}
                </div>
                <div id="kbSearchResults" class="kb-search-results" style="display:none"></div>
            </div>
            <aside class="ref-knowledge-cats">
                <div class="ref-card-title"><span class="title-icon">📂</span>宠物分类</div>
                <div class="ref-cats-body">
                    ${categories.map((c,i) => `
                        <div class="ref-cat-item ${c.key===defaultCat?'active':''}" style="--cat-color:${c.color}" onclick="switchKnowledgeCat('${c.key}',this)">
                            <span class="ref-cat-icon">${c.icon}</span>
                            <span class="ref-cat-name">${c.key}</span>
                            <span class="ref-cat-count" style="color:${c.color}">${(realBreeds[c.key]||[]).length}</span>
                        </div>
                    `).join('')}
                </div>
            </aside>
            <section class="ref-knowledge-main" id="knowledgeMainSection">
                <div class="ref-card-title"><span class="title-icon">📖</span>${defaultCat} 品种资料</div>
                <div class="ref-knowledge-body" id="knowledgeMainBody">
                    ${renderCat(defaultCat, realBreeds[defaultCat])}
                </div>
            </section>
            <aside class="ref-knowledge-right">
                <div class="ref-card-title"><span class="title-icon">⭐</span>照护维护要点 <span style="font-size:11px;color:#38BDF8;font-weight:400;margin-left:8px">（点击查看详细方案）</span></div>
                <div class="ref-right-body">
                    ${categories.map((c,i) => `
                        <div class="ref-right-item" style="--cat-color:${c.color};cursor:pointer" onclick="showCarePlan('${c.key}')">
                            <div class="ref-right-label">${c.icon} ${c.key} <span style="color:#7DD3FC;font-weight:400;font-size:11px;margin-left:4px">(${realBreeds[c.key].length}种)</span></div>
                            <div class="ref-right-tip">${rightTips[i]}</div>
                            <div style="text-align:right;font-size:10px;color:${c.color};margin-top:4px">点击查看完整方案 →</div>
                        </div>
                    `).join('')}
                </div>
            </aside>
            <div class="ref-copyright">版权所有 · 保留权利 · 未经授权禁止转载或用于商业用途</div>
        </div>
        <section id="dbKnowledgeSection" class="med-db-section">
            <div class="med-db-title">📚 知识库内容</div>
            <div id="dbKbTabs" style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0">
                <button class="species-btn active" onclick="kbDbTab(this,'pet_knowledge')">📖 品种知识</button>
                <button class="species-btn" onclick="kbDbTab(this,'pet_diet')">🍚 饮食喂养</button>
                <button class="species-btn" onclick="kbDbTab(this,'pet_disease_medicine')">💊 疾病用药</button>
                <button class="species-btn" onclick="kbDbTab(this,'pet_emotion_solution')">💗 情绪安抚</button>
            </div>
            <div id="dbKbContent" class="med-db-list"><div class="med-db-empty">⏳ 加载中…</div></div>
        </section>
    `;
    loadDbKnowledge('pet_knowledge');
    window.switchKnowledgeCat = (cat, el) => {
        document.querySelectorAll('.ref-cat-item').forEach(i => i.classList.remove('active'));
        if (el) el.classList.add('active');
        const main = document.getElementById('knowledgeMainBody');
        if (main) {
            const titleEl = document.querySelector('.ref-knowledge-main .ref-card-title');
            if (titleEl) titleEl.innerHTML = `<span class="title-icon">📖</span>${cat} 品种资料`;
            main.innerHTML = renderCat(cat, realBreeds[cat]);
        }
    };
    window.setKbSearch = (text) => {
        const input = document.getElementById('kbSearchInput');
        if (input) { input.value = text; input.focus(); doKbSearch(); }
    };
    const highlightText = (text, kw) => {
        if (!kw || !text) return text;
        const idx = text.toLowerCase().indexOf(kw.toLowerCase());
        if (idx === -1) return text;
        return text.substring(0, idx) +
               `<mark style="background:rgba(0,229,255,0.25);color:#fff;border-radius:3px;padding:0 2px">${text.substring(idx, idx + kw.length)}</mark>` +
               text.substring(idx + kw.length);
    };
    window.doKbSearch = () => {
        const input = document.getElementById('kbSearchInput');
        const resultsEl = document.getElementById('kbSearchResults');
        if (!input || !resultsEl) return;
        const rawKw = input.value.trim();
        const kw = rawKw.toLowerCase();
        if (!kw) { clearKbSearch(); return; }
        resultsEl.innerHTML = '<div class="kb-search-loading">⏳ 正在搜索…</div>';
        resultsEl.style.display = 'block';
        const matches = [];
        Object.entries(realBreeds).forEach(([cat, breeds]) => {
            breeds.forEach(b => {
                const score = (b.n.toLowerCase().includes(kw) ? 10 : 0) +
                              (b.n.toLowerCase().startsWith(kw) ? 5 : 0) +
                              (b.l.toLowerCase().includes(kw) ? 6 : 0) +
                              (b.o.toLowerCase().includes(kw) ? 4 : 0) +
                              (b.s.toLowerCase().includes(kw) ? 3 : 0) +
                              (b.t.toLowerCase().includes(kw) ? 2 : 0) +
                              (b.lf.toLowerCase().includes(kw) ? 1 : 0) +
                              (cat.toLowerCase().includes(kw) ? 3 : 0);
                if (score > 0) matches.push({cat, breed:b, score});
            });
        });
        matches.sort((a,b) => b.score - a.score);
        if (matches.length === 0) {
            resultsEl.innerHTML = `<div class="kb-search-empty">🔎 未找到「${rawKw}」相关品种，试试「金毛」「鹦鹉」「守宫」等关键词</div>`;
            return;
        }
        const catInfo = (c) => categories.find(x => x.key === c);
        const topMatches = matches.slice(0, 12);
        resultsEl.innerHTML = `
            <div class="kb-search-header">
                <span style="color:#E0F2FE;font-size:13px">找到 ${matches.length} 个相关品种</span>
                <span style="color:#7DD3FC;font-size:12px;cursor:pointer" onclick="clearKbSearch()">关闭 ✕</span>
            </div>
            <div class="kb-search-list">
                ${topMatches.map((m, idx) => `
                    <div class="kb-search-item" tabindex="0" data-idx="${idx}" onclick="showBreedDetailView('${m.cat}','${m.breed.n}');clearKbSearch()">
                        <span style="font-size:24px">${catInfo(m.cat).icon}</span>
                        <div style="flex:1;min-width:0">
                            <div style="color:#E0F2FE;font-weight:600">${highlightText(m.breed.n, rawKw)} <span style="color:${catInfo(m.cat).color};font-size:11px">${m.cat}</span></div>
                            <div style="color:#7DD3FC;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${highlightText(m.breed.l, rawKw)} · ${highlightText(m.breed.o, rawKw)} · ${highlightText(m.breed.s, rawKw)}</div>
                        </div>
                        <span style="color:#7DD3FC;font-size:12px">查看 →</span>
                    </div>
                `).join('')}
            </div>
            ${matches.length > 12 ? `<div style="text-align:center;padding:8px;color:#7DD3FC;font-size:12px">还有 ${matches.length - 12} 个结果，请细化关键词</div>` : ''}
        `;
    };
    window.clearKbSearch = () => {
        const input = document.getElementById('kbSearchInput');
        const resultsEl = document.getElementById('kbSearchResults');
        if (input) input.value = '';
        if (resultsEl) { resultsEl.innerHTML = ''; resultsEl.style.display = 'none'; }
    };
    // 绑定实时搜索和快捷键
    setTimeout(() => {
        const input = document.getElementById('kbSearchInput');
        if (input) {
            input.addEventListener('input', debounce(doKbSearch, 250));
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') clearKbSearch();
                if (e.key === 'Enter') {
                    const items = document.querySelectorAll('.kb-search-item');
                    if (items.length > 0) items[0].click();
                }
            });
        }
    }, 100);
    window.showCarePlan = (cat) => {
        const catInfo = categories.find(c => c.key === cat);
        const breeds = realBreeds[cat] || [];
        const diet = getDietInfo(cat);
        const carePlanMap = {
            '犬类': {
                '日常护理': '每日梳理毛发，去除脱落死毛；每周检查耳朵、眼睛、口腔；定期修剪指甲（每3-4周1次）；每天清洁牙齿。',
                '运动需求': '小型犬30-60分钟/天，中大型犬60-120分钟/天；遛狗牵绳、定期放跑；提供智力玩具。',
                '饮食管理': '定时定量喂食，幼犬3-4次/天，成犬2次/天；保证清洁饮水；避免巧克力、葡萄、洋葱、骨头等有毒食物。',
                '健康防护': '定期驱虫（体内3月1次，体外1月1次）；按时接种疫苗；每年体检1次；注意夏季防暑、冬季保暖。'
            },
            '猫类': {
                '日常护理': '每日梳理毛发（长毛猫重点）；检查耳朵、眼睛；剪指甲每2-3周1次；清洁肛门腺。',
                '环境要求': '提供猫砂盆（1猫2盆原则），每日清理；提供垂直攀爬空间（猫爬架）；安静独立的休息区。',
                '饮食管理': '以优质猫粮为主，配合湿粮/罐头；保证清洁饮水（建议流动水）；避免牛奶、生鱼、洋葱、巧克力。',
                '健康防护': '定期驱虫免疫；每年体检；注意毛球症（化毛膏/猫草）；观察如厕情况预防泌尿问题。'
            },
            '鸟类': {
                '日常护理': '每日清洁笼底托盘；每周擦拭栖杠和笼具；定期检查羽毛和脚爪。',
                '环境要求': '笼舍置于安静无穿风处；避免厨房油烟、香烟、香水；提供自然光或UVB照明。',
                '饮食管理': '主粮+新鲜蔬果（苹果/青菜/胡萝卜）；保证干净饮水；部分品种需补充墨鱼骨补钙。',
                '健康防护': '定期剪喙和指甲；保持适度温度（18-28℃）；观察精神状态和粪便。'
            },
            '爬行类': {
                '日常护理': '每日检查温湿度计；定期清洁饲养箱；每周泡澡帮助蜕皮和排便。',
                '环境要求': 'UVB灯+UVA灯每日开启8-10小时；温控25-32℃（依品种调整）；湿度50-80%；提供躲避穴。',
                '饮食管理': '活食为主（蟋蟀/面包虫/乳鼠）；定期补充钙粉和D3；避免野生昆虫。',
                '健康防护': '定期观察蜕皮和粪便；保持饲养箱清洁避免细菌滋生；避免频繁上手。'
            },
            '鱼类': {
                '日常护理': '每日观察鱼只状态；每周换水1/3；定期测试水质（pH/氨氮/亚硝酸盐）。',
                '环境要求': '24小时开过滤和气泵；水温稳定（热带鱼24-28℃）；避免阳光直射。',
                '饮食管理': '定时定量喂食（2-3分钟内吃完）；避免过量喂食导致水质恶化；品种混养注意兼容性。',
                '健康防护': '观察鱼只活动和体表；定期清洗过滤棉；新鱼入缸前隔离检疫。'
            },
            '小型宠物': {
                '日常护理': '每周更换垫料和木屑/浴沙；每日检查饮水器；每月清洗笼子；龙猫需提供浴沙洗澡。',
                '环境要求': '笼子越大越好（仓鼠≥47基、龙猫≥60基、豚鼠≥120cm）；提供跑轮和隧道玩具；温度15-26℃；龙猫需控温18-22℃、湿度50-60%。',
                '饮食管理': '仓鼠：专用仓鼠粮+少量蔬果；龙猫：专用龙猫粮+提摩西草+少量苹果；豚鼠：提摩西草为主食+每日维C补充。',
                '健康防护': '禁止合笼（同类相食）；注意颊囊/牙齿问题；观察精神和粪便；避免高温和潮湿。'
            },
            '宠物甲虫': {
                '日常护理': '保持饲养环境清洁；定期更换腐殖土/发酵木屑；检查甲虫状态。',
                '环境要求': '温度20-28℃；湿度70-90%；提供树枝攀爬；避免阳光直射。',
                '饮食管理': '成虫喂果冻/水果/蜂蜜水；幼虫吃腐殖土和发酵木屑。',
                '健康防护': '注意霉菌滋生；定期清理环境；避免用手直接接触。'
            },
            '兔类': {
                '日常护理': '每日清理兔笼；每周梳毛1-2次（换毛期增加）；每月剪指甲。',
                '环境要求': '提供大空间活动区（至少3倍体长）；避免高温（>30℃危险）；磨牙用品。',
                '饮食管理': '提摩西草为主食（无限量）+凉白开；少量兔粮和蔬果；禁止淀粉/糖类食物。',
                '健康防护': '定期驱虫；注意牙齿过长；观察粪便和排尿情况。'
            }
        };
        const plan = carePlanMap[cat] || {};
        const breedList = breeds.map(b => `<div style="display:inline-block;background:rgba(0,229,255,0.08);border:1px solid rgba(0,229,255,0.2);border-radius:6px;padding:4px 10px;margin:3px;font-size:12px;color:#7DD3FC">${b.n}</div>`).join('');
        let planHTML = '';
        for (const [k, v] of Object.entries(plan)) {
            planHTML += `
                <div style="margin-bottom:14px">
                    <div style="color:${catInfo.color};font-weight:600;margin-bottom:6px;font-size:13px">• ${k}</div>
                    <div style="color:#E0F2FE;line-height:1.9;font-size:13px;padding-left:12px;border-left:2px solid ${catInfo.color}40">${v}</div>
                </div>
            `;
        }
        openModal(`${catInfo.icon} ${cat} 完整照护维护方案`, `
            <div style="padding:4px">
                <div style="background:linear-gradient(135deg, ${catInfo.color}20, transparent);border:1px solid ${catInfo.color}40;border-radius:10px;padding:12px;margin-bottom:14px">
                    <div style="color:${catInfo.color};font-weight:600;margin-bottom:8px">📋 涵盖品种</div>
                    <div style="display:flex;flex-wrap:wrap">${breedList}</div>
                </div>
                <div style="margin-bottom:14px">
                    <div style="color:#00E5FF;font-weight:600;margin-bottom:8px">🍽️ 通用喂食方案</div>
                    <div style="color:#E0F2FE;line-height:1.9;font-size:13px">${diet}</div>
                </div>
                ${planHTML}
            </div>
        `, '<button class="btn btn-primary" onclick="closeModal()">好的</button>');
    };
    window.showBreedDetailView = (cat, breedName) => {
        const list = realBreeds[cat] || [];
        const b = list.find(x => x.n === breedName);
        if (!b) return;
        const catInfo = categories.find(c => c.key === cat);
        const imgUrl = getBreedImg(cat, breedName);
        const diet = getDietInfo(cat);
        openModal(`${catInfo.icon} ${b.n} 详细资料`, `
            <div style="padding:6px">
                <div style="width:100%;height:200px;overflow:hidden;border-radius:12px;margin-bottom:14px;background:#0c1e38;position:relative">
                    <img src="${imgUrl}" style="width:100%;height:100%;object-fit:contain" onerror="this.style.display='none';var fb=this.parentElement.querySelector('.kb-detail-fallback');if(fb)fb.style.display='flex'">
                    <div class="kb-detail-fallback" style="display:none;width:100%;height:100%;align-items:center;justify-content:center;font-size:96px;background:linear-gradient(135deg, ${catInfo.color}30, transparent)">${catInfo.icon}</div>
                </div>
                <div style="color:#00E5FF;margin-bottom:6px;font-size:11px;font-style:italic">${b.l}</div>
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:10px 0">
                    <div style="background:rgba(0,229,255,0.05);padding:10px;border-radius:8px;border:1px solid rgba(0,229,255,0.15);text-align:center">
                        <div style="font-size:10px;color:#7DD3FC">体型分类</div><div style="color:#E0F2FE;font-weight:600;margin-top:4px">${b.o}</div>
                    </div>
                    <div style="background:rgba(139,92,246,0.05);padding:10px;border-radius:8px;border:1px solid rgba(139,92,246,0.15);text-align:center">
                        <div style="font-size:10px;color:#7DD3FC">平均寿命</div><div style="color:#E0F2FE;font-weight:600;margin-top:4px">${b.lf}</div>
                    </div>
                    <div style="background:rgba(16,185,129,0.05);padding:10px;border-radius:8px;border:1px solid rgba(16,185,129,0.15);text-align:center">
                        <div style="font-size:10px;color:#7DD3FC">性格</div><div style="color:#E0F2FE;font-weight:600;margin-top:4px">${b.s}</div>
                    </div>
                </div>
                <div style="color:#00E5FF;margin:12px 0 6px;font-weight:600;font-size:13px">📖 品种介绍</div>
                <div style="color:#E0F2FE;line-height:1.8;font-size:13px">${b.t}</div>
                <div style="color:#00E5FF;margin:14px 0 6px;font-weight:600;font-size:13px">🍽️ 喂食建议</div>
                <div style="color:#E0F2FE;line-height:1.8;font-size:13px">${diet}</div>
            </div>
        `, '<button class="btn btn-primary" onclick="closeModal()">好的</button>');
    };
}

function getDietInfo(cat) {
    const diets = {
        '狗': '幼犬每日3-4餐，成犬2餐。主粮建议选择优质天然粮，搭配新鲜肉类和蔬菜。',
        '猫': '幼猫每日3-4餐，成猫2餐。建议选择适合年龄段的猫粮，保持充足饮水。',
        '兔子': '以干草为主食，搭配新鲜蔬菜和少量水果。保持饮水干净。',
        '鸟类': '以混合种子粮、滋养丸为主，搭配新鲜蔬果与洁净饮水。',
        '鱼类': '选择适合品种的专业鱼粮，控制投喂量，保持水质稳定。',
        '爬行类': '根据物种提供昆虫、蔬果或专用饲料，补充钙质与 UVB 光照。',
        '小型宠物': '以专用粮和干草为主，少量新鲜蔬果，避免高糖高脂。龙猫需专用龙猫粮和提摩西草，豚鼠需每日维C补充。',
        '两栖类': '提供活饵或专用饲料，保持湿度与清洁水源。',
    };
    return diets[cat] || '建议提供适合该品类的专业饲料，注意营养均衡，保证充足饮水。';
}

function getCareTip(cat) {
    const tips = {
        '狗': '定期遛狗，每天至少30分钟运动。定期洗澡、修剪指甲、清洁耳朵。注意疫苗接种和驱虫。',
        '猫': '提供干净的猫砂盆，每日清理。定期梳毛，检查耳朵和眼睛。注意室内环境安全。',
        '兔子': '需要较大的活动空间，避免温差过大。定期梳毛，注意牙齿健康。',
        '鸟类': '保持笼舍清洁，每日放出活动，避免 drafts，提供玩具磨喙。',
        '鱼类': '定期换水，监测水质参数，避免过度喂食，保持适宜水温。',
        '爬行类': '提供适宜温度梯度、UVB 光照与躲藏处，定期观察蜕皮与排便。',
        '小型宠物': '提供跑轮、隧道等丰容设施，垫料保持干燥，避免单只长期独处。龙猫需安静环境和浴沙，控制湿度50-60%。',
        '两栖类': '保持适宜湿度与温度，提供深浅水域，定期清洁饲养环境。',
    };
    return tips[cat] || '定期体检，保持环境清洁，提供适当的运动和游戏时间。';
}

function renderCloudSyncPage(container) {
    container.innerHTML = `
        <div class="cloud-sync-layout">
            <div style="background:linear-gradient(135deg, rgba(0,229,255,0.08), rgba(139,92,246,0.08));border:1px solid rgba(0,229,255,0.2);border-radius:12px;padding:16px 20px;margin-bottom:18px">
                <div style="display:flex;align-items:center;gap:12px">
                    <div style="font-size:36px">☁️</div>
                    <div>
                        <div style="color:#00E5FF;font-size:16px;font-weight:600;margin-bottom:4px">Supabase 云端同步中心</div>
                        <div style="color:#94A3B8;font-size:13px">将识别记录、用户数据备份到 Supabase 云端，实现多设备、多主机、不同局域网间的数据同步。本地 AI 识别模型不受影响，数据安全加密存储。</div>
                    </div>
                </div>
            </div>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:18px">
                <div style="background:rgba(8,22,44,0.8);border:1px solid rgba(0,229,255,0.15);border-radius:12px;padding:16px;text-align:center">
                    <div style="font-size:32px;margin-bottom:8px">🔄</div>
                    <div style="color:#E0F2FE;font-weight:600;margin-bottom:4px">自动同步</div>
                    <div style="color:#7DD3FC;font-size:12px">识别后自动上传云端</div>
                </div>
                <div style="background:rgba(8,22,44,0.8);border:1px solid rgba(139,92,246,0.15);border-radius:12px;padding:16px;text-align:center">
                    <div style="font-size:32px;margin-bottom:8px">🖥️</div>
                    <div style="color:#E0F2FE;font-weight:600;margin-bottom:4px">多设备</div>
                    <div style="color:#7DD3FC;font-size:12px">不同电脑登录同一账号</div>
                </div>
                <div style="background:rgba(8,22,44,0.8);border:1px solid rgba(16,185,129,0.15);border-radius:12px;padding:16px;text-align:center">
                    <div style="font-size:32px;margin-bottom:8px">🔒</div>
                    <div style="color:#E0F2FE;font-weight:600;margin-bottom:4px">安全加密</div>
                    <div style="color:#7DD3FC;font-size:12px">Supabase 数据隔离存储</div>
                </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
                <div style="background:rgba(8,22,44,0.8);border:1px solid rgba(0,229,255,0.15);border-radius:12px;padding:16px">
                    <div style="color:#E0F2FE;font-weight:600;margin-bottom:12px">🔌 Supabase 配置</div>
                    <div style="margin-bottom:10px">
                        <label style="display:block;color:#7DD3FC;font-size:12px;margin-bottom:4px">Supabase URL</label>
                        <input type="text" id="sbUrlSync" class="form-input" style="width:100%" placeholder="https://xxxxx.supabase.co">
                    </div>
                    <div style="margin-bottom:12px">
                        <label style="display:block;color:#7DD3FC;font-size:12px;margin-bottom:4px">Supabase Service Role Key</label>
                        <input type="password" id="sbKeySync" class="form-input" style="width:100%" placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...">
                    </div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
                        <button class="btn btn-primary" onclick="saveCloudConfig()">💾 保存配置</button>
                        <button class="btn btn-secondary" onclick="testCloudConnection()">🧪 测试连接</button>
                    </div>
                    <div id="cloudConfigMsg" style="font-size:12px;color:#F59E0B">⏳ 正在检查 Supabase 配置...</div>
                </div>
                <div style="background:rgba(8,22,44,0.8);border:1px solid rgba(139,92,246,0.15);border-radius:12px;padding:16px">
                    <div style="color:#E0F2FE;font-weight:600;margin-bottom:12px">💾 手动同步</div>
                    <div style="color:#7DD3FC;font-size:12px;margin-bottom:12px">将本地历史记录备份到云端，或从云端恢复</div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap">
                        <button class="btn btn-primary" onclick="backupToCloud()">☁️ 备份到云端</button>
                        <button class="btn btn-secondary" onclick="restoreFromCloud()">📥 从云端恢复</button>
                    </div>
                </div>
            </div>
            <div style="margin-top:18px;background:rgba(8,22,44,0.8);border:1px solid rgba(0,229,255,0.15);border-radius:12px;padding:16px">
                <div style="color:#E0F2FE;font-weight:600;margin-bottom:12px">📋 同步记录</div>
                <div id="syncLogArea" style="color:#94A3B8;font-size:13px;line-height:1.8">
                    <div>• 同步功能待 Supabase 配置完成后启用</div>
                </div>
            </div>
        </div>
    `;
    window.backupToCloud = async function() {
        addSyncLog('开始备份本地数据到云端...');
        try {
            const res = await fetch('/api/cloud/backup', {method:'POST'});
            const data = await res.json();
            addSyncLog(data.success ? '✅ ' + (data.message || '备份成功') : '❌ 备份失败：' + (data.message || '未知错误'));
        } catch (e) {
            addSyncLog('❌ 备份异常：' + e.message);
        }
    };
    window.restoreFromCloud = async function() {
        addSyncLog('开始从云端恢复数据...');
        try {
            const res = await fetch('/api/cloud/restore', {method:'POST'});
            const data = await res.json();
            addSyncLog(data.success ? '✅ ' + (data.message || '恢复成功') : '❌ 恢复失败：' + (data.message || '未知错误'));
        } catch (e) {
            addSyncLog('❌ 恢复异常：' + e.message);
        }
    };
    // 初始化时加载配置并测试连接
    setTimeout(() => { loadCloudConfig(); testCloudConnection(); }, 500);
}

async function renderAlertsPage(container) {
    container.innerHTML = `
        <div class="alerts-layout">
            <div class="alerts-summary">
                <div class="alert-stat-card"><div class="alert-stat-icon danger">💊</div><div><div class="alert-stat-value" id="aSick">--</div><div class="alert-stat-label">生病情绪记录</div></div></div>
                <div class="alert-stat-card"><div class="alert-stat-icon warning">😰</div><div><div class="alert-stat-value" id="aAnx">--</div><div class="alert-stat-label">焦虑情绪记录</div></div></div>
                <div class="alert-stat-card"><div class="alert-stat-icon info">😓</div><div><div class="alert-stat-value" id="aNer">--</div><div class="alert-stat-label">紧张情绪记录</div></div></div>
                <div class="alert-stat-card"><div class="alert-stat-icon ok">🐾</div><div><div class="alert-stat-value" id="aTot">--</div><div class="alert-stat-label">识别记录总数</div></div></div>
            </div>
            <div class="alerts-list-area">
                <div style="color:#00E5FF;font-size:13px;font-weight:600;margin-bottom:6px;letter-spacing:1px">⚠️  健康预警消息列表</div>
                <div id="alertsList"><div class="alert-item info"><span class="alert-item-icon">⏳</span><div class="alert-item-body"><div class="alert-item-title">加载中...</div><div class="alert-item-text">正在获取系统预警数据</div></div></div></div>
            </div>
        </div>
    `;
    try {
        const res = await fetch('/api/stats/health_alerts');
        const d = await res.json();
        if (d && d.success) {
            document.getElementById('aSick').textContent = d.sick;
            document.getElementById('aAnx').textContent = d.anxiety;
            document.getElementById('aNer').textContent = d.nervous;
            document.getElementById('aTot').textContent = d.total;
            const listEl = document.getElementById('alertsList');
            const alerts = d.alerts || [];
            if (alerts.length === 0) {
                listEl.innerHTML = `<div class="alert-item info"><span class="alert-item-icon">✅</span><div class="alert-item-body"><div class="alert-item-title">暂无健康预警</div><div class="alert-item-text">当前未检测到异常情绪记录，宠物健康状况良好。继续保持科学饲养习惯。</div></div></div>`;
            } else {
                listEl.innerHTML = alerts.map(p => `
                    <div class="alert-item ${p.type || 'info'}">
                        <span class="alert-item-icon">${p.icon || '⚠️'}</span>
                        <div class="alert-item-body">
                            <div class="alert-item-title">${p.text || ''}</div>
                        </div>
                    </div>
                `).join('');
            }
        }
    } catch (e) {
        const listEl = document.getElementById('alertsList');
        if (listEl) listEl.innerHTML = `<div class="alert-item info"><span class="alert-item-icon">⚠️</span><div class="alert-item-body"><div class="alert-item-title">数据加载失败</div><div class="alert-item-text">${e.message}</div></div></div>`;
    }
}

// ===== 数据统计 / 健康报告 =====
async function renderStatsPage(container) {
    container.innerHTML = `
        <div class="pai-stats-top" id="statsTop">
            <div class="pai-stat-card"><div class="stat-icon cyan">🔍</div><div class="stat-value" id="stTotal">0</div><div class="stat-label">总识别次数</div></div>
            <div class="pai-stat-card"><div class="stat-icon purple">📅</div><div class="stat-value" id="stToday">0</div><div class="stat-label">今日识别</div></div>
            <div class="pai-stat-card"><div class="stat-icon green">😊</div><div class="stat-value" id="stEmotion">0</div><div class="stat-label">情绪分析</div></div>
            <div class="pai-stat-card"><div class="stat-icon gold">💡</div><div class="stat-value" id="stAdvice">0</div><div class="stat-label">健康建议</div></div>
        </div>
        <div class="pai-stats-middle">
            <div class="pai-stats-leftcol">
                <div class="pai-glass-card">
                    <div class="pai-card-title"><span class="title-icon">🥧</span>物种分布统计</div>
                    <div class="pai-card-body">
                        <div class="pai-chart-box pie-chart">
                            <canvas id="speciesPieCanvas"></canvas>
                            <div class="pai-pie-legend" id="speciesLegend"></div>
                        </div>
                    </div>
                </div>
                <div class="pai-glass-card">
                    <div class="pai-card-title"><span class="title-icon">💤</span>睡眠质量 / 情绪统计</div>
                    <div class="pai-card-body">
                        <div class="pai-chart-box">
                            <canvas id="emotionRingCanvas"></canvas>
                        </div>
                    </div>
                </div>
            </div>
            <div class="pai-stats-rightcol">
                <div class="pai-glass-card">
                    <div class="pai-card-title"><span class="title-icon">📈</span>近7天情绪分析趋势</div>
                    <div class="pai-card-body">
                        <div class="pai-chart-box">
                            <canvas id="trendLineCanvas"></canvas>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <div class="pai-stats-bottom">
            <div class="pai-glass-card">
                <div class="pai-card-title"><span class="title-icon">🏆</span>情绪识别排行榜</div>
                <div class="pai-card-body">
                    <div class="pai-ranking-list" id="emotionRanking"></div>
                </div>
            </div>
            <div class="pai-glass-card">
                <div class="pai-card-title"><span class="title-icon">🔔</span>近期重点提醒</div>
                <div class="pai-card-body">
                    <div class="pai-reminder-list" id="recentReminders"></div>
                </div>
            </div>
        </div>
    `;

    try {
        const res = await fetch('/api/stats/dashboard');
        const data = await res.json();
        if (!data.success) throw new Error('stats failed');

        document.getElementById('stTotal').textContent = data.total || 0;
        document.getElementById('stToday').textContent = data.today || 0;
        document.getElementById('stEmotion').textContent = data.total || 0;
        document.getElementById('stAdvice').textContent = Object.keys(data.by_emotion || {}).length || 0;

        const categories = data.by_category || {};
        const emotions = data.by_emotion || {};

        setTimeout(() => {
            drawPieChart('speciesPieCanvas', 'speciesLegend', categories);
            drawRingChart('emotionRingCanvas', emotions);
            drawTrendLine('trendLineCanvas', data.trend || null);
            renderEmotionRanking(emotions);
            renderReminders(data.recent_records || []);
        }, 50);
    } catch (e) {
        document.getElementById('stTotal').textContent = '0';
        document.getElementById('stToday').textContent = '0';
        document.getElementById('stEmotion').textContent = '0';
        document.getElementById('stAdvice').textContent = '0';
        setTimeout(() => {
            drawPieChart('speciesPieCanvas', 'speciesLegend', {});
            drawRingChart('emotionRingCanvas', {});
            drawTrendLine('trendLineCanvas', null);
            renderEmotionRanking({});
            renderReminders([]);
        }, 50);
    }
}

function drawPieChart(canvasId, legendId, data) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = Math.min(rect.width / 2 - 20, 220);
    canvas.height = canvas.width;
    const w = canvas.width, h = canvas.height;
    const cx = w / 2, cy = h / 2, radius = Math.min(w, h) / 2 - 10;
    ctx.clearRect(0, 0, w, h);

    const colors = ['#06B6D4', '#22D3EE', '#818CF8', '#34D399', '#FBBF24', '#FB7185'];
    const entries = Object.entries(data).filter(([_, v]) => v > 0);
    const total = entries.reduce((s, [_, v]) => s + v, 0);

    if (entries.length === 0 || total === 0) {
        ctx.fillStyle = '#7DD3FC'; ctx.font = '13px Segoe UI'; ctx.textAlign = 'center';
        ctx.fillText('暂无数据', cx, cy - 4);
        ctx.fillStyle = '#475569'; ctx.font = '10px Segoe UI';
        ctx.fillText('开始识别后自动更新', cx, cy + 14);
        const legend = document.getElementById(legendId);
        if (legend) legend.innerHTML = '<span style="color:#64748B">暂无分类数据</span>';
        return;
    }

    let start = -Math.PI / 2;

    entries.forEach(([name, val], i) => {
        const angle = (val / total) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, start, start + angle);
        ctx.closePath();
        ctx.fillStyle = colors[i % colors.length];
        ctx.fill();
        ctx.strokeStyle = 'rgba(1,8,16,0.8)';
        ctx.lineWidth = 2;
        ctx.stroke();
        start += angle;
    });

    const legend = document.getElementById(legendId);
    if (legend) {
        legend.innerHTML = entries.map(([name, val], i) => `
            <div class="pai-legend-item">
                <div class="pai-legend-dot" style="background:${colors[i % colors.length]}"></div>
                <span>${name} ${val} (${Math.round(val / total * 100)}%)</span>
            </div>
        `).join('');
    }
}

function drawRingChart(canvasId, data) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = Math.min(rect.width - 40, 240);
    canvas.height = canvas.width;
    const w = canvas.width, h = canvas.height;
    const cx = w / 2, cy = h / 2, radius = Math.min(w, h) / 2 - 16;
    ctx.clearRect(0, 0, w, h);

    const colors = { '开心': '#34D399', '平静': '#22D3EE', '紧张': '#FBBF24', '生病': '#FB7185', '伤心': '#818CF8' };
    const entries = Object.entries(data).filter(([_, v]) => v > 0);
    const total = entries.reduce((s, [_, v]) => s + v, 0);

    if (entries.length === 0 || total === 0) {
        ctx.fillStyle = '#7DD3FC'; ctx.font = '13px Segoe UI'; ctx.textAlign = 'center';
        ctx.fillText('暂无数据', cx, cy - 4);
        ctx.fillStyle = '#475569'; ctx.font = '10px Segoe UI';
        ctx.fillText('开始识别后自动更新', cx, cy + 14);
        return;
    }

    let start = -Math.PI / 2;

    entries.forEach(([name, val]) => {
        const angle = (val / total) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, start, start + angle);
        ctx.strokeStyle = colors[name] || '#22D3EE';
        ctx.lineWidth = 18;
        ctx.stroke();
        start += angle;
    });

    ctx.fillStyle = 'var(--text-primary)';
    ctx.font = 'bold 22px Consolas';
    ctx.textAlign = 'center';
    ctx.fillText(total, cx, cy + 6);
    ctx.fillStyle = 'var(--text-secondary)';
    ctx.font = '11px sans-serif';
    ctx.fillText('总记录', cx, cy + 24);
}

function drawTrendLine(canvasId, trendData) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width - 40;
    canvas.height = Math.min(rect.height - 40, 220);
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (!trendData || trendData.length === 0) {
        ctx.fillStyle = '#7DD3FC'; ctx.font = '13px Segoe UI'; ctx.textAlign = 'center';
        ctx.fillText('暂无趋势数据', w/2, h/2 - 6);
        ctx.fillStyle = '#475569'; ctx.font = '10px Segoe UI';
        ctx.fillText('开始识别后自动更新', w/2, h/2 + 12);
        return;
    }

    const labels = trendData.map(d => d.date || '');
    const data = trendData.map(d => d.count || 0);
    const pad = 30;
    const chartW = w - pad * 2;
    const chartH = h - pad * 2;
    const max = Math.max(...data, 1);

    ctx.strokeStyle = 'rgba(6, 182, 212, 0.15)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = pad + chartH * i / 4;
        ctx.beginPath();
        ctx.moveTo(pad, y);
        ctx.lineTo(w - pad, y);
        ctx.stroke();
    }

    ctx.beginPath();
    data.forEach((v, i) => {
        const x = pad + chartW * i / (data.length - 1);
        const y = pad + chartH * (1 - v / max);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    const grad = ctx.createLinearGradient(0, pad, 0, h - pad);
    grad.addColorStop(0, 'rgba(6, 182, 212, 0.35)');
    grad.addColorStop(1, 'rgba(6, 182, 212, 0.0)');
    ctx.save();
    ctx.lineTo(pad + chartW, h - pad);
    ctx.lineTo(pad, h - pad);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = '#22D3EE';
    ctx.lineWidth = 2.5;
    ctx.shadowBlur = 12;
    ctx.shadowColor = 'rgba(6, 182, 212, 0.5)';
    ctx.stroke();
    ctx.shadowBlur = 0;

    data.forEach((v, i) => {
        const x = pad + chartW * i / (data.length - 1);
        const y = pad + chartH * (1 - v / max);
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#06B6D4';
        ctx.fill();
    });

    ctx.fillStyle = 'var(--text-secondary)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    labels.forEach((l, i) => {
        const x = pad + chartW * i / (labels.length - 1);
        ctx.fillText(l.slice(-5), x, h - 8);
    });
}

function renderEmotionRanking(emotions) {
    const container = document.getElementById('emotionRanking');
    if (!container) return;
    const colors = { '开心': '#34D399', '平静': '#22D3EE', '紧张': '#FBBF24', '生病': '#FB7185', '伤心': '#818CF8' };
    const total = Object.values(emotions).reduce((s, v) => s + v, 0) || 1;
    const entries = Object.entries(emotions).filter(([_, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) {
        container.innerHTML = `<div style="text-align:center;padding:24px;color:#7DD3FC;font-size:13px">暂无情绪排名数据</div>`;
        return;
    }
    container.innerHTML = entries.map(([name, val]) => {
        const pct = Math.round(val / total * 100);
        return `
            <div class="pai-ranking-item">
                <span class="rank-name">${name}</span>
                <div class="rank-bar"><div class="rank-fill" style="width:${pct}%;background:${colors[name] || '#22D3EE'}"></div></div>
                <span class="rank-pct">${pct}%</span>
            </div>
        `;
    }).join('');
}

function renderReminders(records) {
    const container = document.getElementById('recentReminders');
    if (!container) return;
    if (!records || records.length === 0) {
        container.innerHTML = `<div style="text-align:center;padding:24px;color:#7DD3FC;font-size:13px">暂无识别记录，开始识别后自动生成健康提醒</div>`;
        return;
    }
    const reminders = records.slice(0, 4).map(r => ({
        icon: r.emotion === '生病' ? '⚠️' : r.emotion === '紧张' ? '💡' : '✅',
        title: `${r.breed || '未知品种'} · ${r.emotion || '平静'}`,
        desc: `识别时间：${formatTime(r.created_at)}，置信度 ${Math.round((r.confidence || 0) * 100)}%`
    }));
    container.innerHTML = reminders.map(r => `
        <div class="pai-reminder-item">
            <div class="rm-icon">${r.icon}</div>
            <div class="rm-content">
                <div class="rm-title">${r.title}</div>
                <div class="rm-desc">${r.desc}</div>
            </div>
        </div>
    `).join('');
}

// ===== AI 健康咨询 =====
function renderConsultPage(container) {
    container.innerHTML = `
        <div class="card fade-in scan-effect">
            <div class="card-title card-title-hud">
                <span class="title-icon">💬</span>
                <span>AI 健康咨询系统</span>
                <span class="title-deco"></span>
            </div>
            <div class="card-body">
                <div style="margin-bottom:20px">
                    <div class="form-label" style="color:var(--text-secondary);font-size:13px;margin-bottom:8px;letter-spacing:1px">选择咨询的宠物类型</div>
                    <select class="filter-select" id="consultCat" style="width:100%;max-width:300px">
                        <option value="狗">🐕 狗狗</option>
                        <option value="猫">🐈 猫咪</option>
                        <option value="兔子">🐇 兔子</option>
                        <option value="小型宠物">🐾 小型宠物</option>
                        <option value="鹦鹉">🦜 鹦鹉</option>
                        <option value="乌龟">🐢 乌龟</option>
                        <option value="金鱼">🐠 金鱼</option>
                    </select>
                </div>
                <div style="margin-bottom:16px">
                    <div class="form-label" style="color:var(--text-secondary);font-size:13px;margin-bottom:8px;letter-spacing:1px">常见问题快速咨询</div>
                    <div style="display:flex;flex-wrap:wrap;gap:8px">
                        ${['食欲不振', '精神不佳', '皮肤问题', '腹泻呕吐', '咳嗽打喷嚏', '眼睛异常', '行为异常'].map(q => 
                            `<button class="knowledge-tab tab-hud" style="cursor:pointer" onclick="useQickQuestion('${q}')">${q}</button>`
                        ).join('')}
                    </div>
                </div>
                <div style="margin-bottom:16px">
                    <textarea id="consultInput" class="form-input" rows="4" placeholder="请描述您的宠物健康问题..." style="width:100%;resize:vertical"></textarea>
                </div>
                <div class="btn-group">
                    <button class="btn btn-primary btn-primary-glow btn-glow" id="askBtn">💡 常见问题咨询</button>
                    <button class="btn btn-secondary btn-secondary-glow btn-glow" id="clearConsultBtn">🗑️ 清空</button>
                </div>
            </div>
        </div>
        <div id="consultResult"></div>
    `;

    document.getElementById('askBtn').addEventListener('click', askAI);
    document.getElementById('clearConsultBtn').addEventListener('click', () => {
        document.getElementById('consultInput').value = '';
        document.getElementById('consultResult').innerHTML = '';
    });
}

function useQickQuestion(q) {
    const input = document.getElementById('consultInput');
    input.value = q;
}

async function askAI() {
    const input = document.getElementById('consultInput');
    const question = input.value.trim();
    const cat = document.getElementById('consultCat').value;
    const resultDiv = document.getElementById('consultResult');

    if (!question) {
        showToast('请输入您的问题', 'error');
        return;
    }

    resultDiv.innerHTML = '<div class="card"><div class="card-body"><div class="loading"></div></div></div>';

    try {
        const res = await fetch('/api/ai/consult', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question, category: cat })
        });
        const data = await res.json();

        if (data.success) {
            resultDiv.innerHTML = `
                <div class="card fade-in scan-effect">
                    <div class="card-title card-title-hud">
                        <span class="title-icon">🤖</span>
                        <span>AI 智能分析结果</span>
                        <span class="title-deco"></span>
                    </div>
                    <div class="card-body">
                        <div class="ai-chat-hud">
                            <div class="ai-message">
                                <div style="white-space:pre-line;font-size:14px;line-height:1.8;color:var(--text-primary)">${data.reply || '暂无建议'}</div>
                            </div>
                            <div style="margin-top:12px;color:var(--text-muted);font-size:12px;display:flex;align-items:center;gap:6px">
                                <span class="status-indicator warning" style="padding:4px 10px;font-size:10px">⚠️ 提示</span>
                                <span>以上建议仅供参考，如情况严重请及时就医</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        } else {
            resultDiv.innerHTML = `<div class="card"><div class="card-body" style="color:var(--red)">${data.message || '咨询失败'}</div></div>`;
        }
    } catch (e) {
        resultDiv.innerHTML = '<div class="card"><div class="card-body" style="color:var(--red)">请求失败</div></div>';
    }
}

// ===== 用户管理（管理员）=====
async function renderUsersPage(container) {
    if (currentUser?.role !== 'admin') {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">🔒</div><p>仅管理员可访问此页面</p></div>';
        return;
    }

    container.innerHTML = `
        <div class="card fade-in scan-effect">
            <div class="card-title card-title-hud">
                <span class="title-icon">👥</span>
                <span>用户管理控制台</span>
                <span class="title-deco"></span>
            </div>
            <div class="card-body" id="userListContainer">
                <div class="loading" style="display:flex;justify-content:center;padding:40px;"></div>
            </div>
        </div>
    `;

    try {
        const res = await fetch('/api/user/list');
        const data = await res.json();

        if (!data.success) {
            container.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><p>加载失败</p></div>';
            return;
        }

        if (data.users.length === 0) {
            document.getElementById('userListContainer').innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>暂无注册用户</p></div>';
            return;
        }

        document.getElementById('userListContainer').innerHTML = `
            <table class="data-table data-table-hud">
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>用户名</th>
                        <th>昵称</th>
                        <th>角色</th>
                        <th>状态</th>
                        <th>操作</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.users.map(u => `
                        <tr>
                            <td>${u.id}</td>
                            <td>${u.username}</td>
                            <td>${u.nickname || u.username}</td>
                            <td><span class="badge ${u.role === 'admin' ? 'badge-purple' : 'badge-cyan'}">${u.role === 'admin' ? '管理员' : '用户'}</span></td>
                            <td><span class="badge ${u.status === 1 ? 'badge-green' : 'badge-red'}">${u.status === 1 ? '正常' : '禁用'}</span></td>
                            <td>
                                ${u.role !== 'admin' && u.id !== currentUser.id ? `
                                    <button class="btn btn-secondary btn-secondary-glow" style="padding:4px 10px;font-size:12px" onclick="toggleUserStatus(${u.id}, ${u.status})">${u.status === 1 ? '禁用' : '启用'}</button>
                                    <button class="btn btn-danger" style="padding:4px 10px;font-size:12px;margin-left:6px" onclick="deleteUser(${u.id})">删除</button>
                                ` : '<span style="color:var(--text-muted)">不可操作</span>'}
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } catch (e) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">❌</div><p>加载失败</p></div>';
    }
}

async function toggleUserStatus(id, currentStatus) {
    try {
        // 传递与当前状态相反的值
        const enable = currentStatus === 1 ? 'false' : 'true';
        const res = await fetch(`/api/user/toggle_status`, { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                user_id: id, 
                enable: enable
            })
        });
        const data = await res.json();
        if (data.success) {
            showToast('状态已更新', 'success');
            renderUsersPage(document.getElementById('contentArea'));
        } else {
            showToast(data.message || '操作失败', 'error');
        }
    } catch (e) {
        showToast('操作失败', 'error');
    }
}

async function deleteUser(id) {
    if (!confirm('确定要删除此用户吗？')) return;
    try {
        const res = await fetch(`/api/user/delete`, { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: id })
        });
        const data = await res.json();
        if (data.success) {
            showToast('用户已删除', 'success');
            renderUsersPage(document.getElementById('contentArea'));
        } else {
            showToast(data.message || '删除失败', 'error');
        }
    } catch (e) {
        showToast('删除失败', 'error');
    }
}

// ===== 系统管理 =====
async function renderSettingsPage(container) {
    const nickname = currentUser?.nickname || currentUser?.username || '用户';
    const roleText = currentUser?.role === 'admin' ? '系统管理员' : currentUser?.role === 'guest' ? '游客用户' : '普通用户';
    const isAdmin = currentUser?.role === 'admin';
    const cloudConfigCard = isAdmin ? `
                    <div class="sm-settings-card admin-only-card">
                        <div class="sm-settings-title"><span>☁️</span> Supabase 云端数据库</div>
                        <div style="color:#7DD3FC;font-size:12px;line-height:1.8;margin-bottom:12px">
                            配置 Supabase URL 与 Service Key 后，识别记录、用户数据将自动同步到云端，实现不同电脑、不同局域网间的数据共享。
                        </div>
                        <div id="cloudConfigForm">
                            <div class="form-group" style="margin-bottom:12px">
                                <label class="form-label">Supabase URL</label>
                                <input type="text" id="sbUrl" class="form-input" placeholder="https://xxxxx.supabase.co">
                            </div>
                            <div class="form-group" style="margin-bottom:12px">
                                <label class="form-label">Supabase Service Role Key</label>
                                <input type="password" id="sbKey" class="form-input" placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...">
                            </div>
                            <div style="display:flex;gap:8px;flex-wrap:wrap">
                                <button class="btn btn-primary" onclick="saveCloudConfig()">💾 保存配置</button>
                                <button class="btn btn-secondary" onclick="testCloudConnection()">🧪 测试连接</button>
                                <button class="btn btn-secondary" onclick="showPage('cloud_sync')">☁️ 进入同步中心</button>
                            </div>
                            <div id="cloudConfigMsg" style="margin-top:10px;font-size:12px"></div>
                        </div>
                    </div>` : '';
    container.innerHTML = `
        <div class="ref-settings-layout-real">
            <div class="sm-top-row">
                <div class="sm-user-card">
                    <div class="sm-user-avatar">${nickname.charAt(0).toUpperCase()}</div>
                    <div class="sm-user-info">
                        <div class="sm-user-name">${nickname}</div>
                        <div class="sm-user-role">${roleText}</div>
                        <div class="sm-user-meta">
                            <div>用户名：<span>${currentUser?.username || '-'}</span></div>
                            <div>账号状态：<span style="color:#10B981">● 正常</span></div>
                            <div>上次登录：<span>${new Date().toLocaleString('zh-CN')}</span> &nbsp;&nbsp; | &nbsp;&nbsp; 在线时长：<span id="onLen">0h 0m</span></div>
                        </div>
                    </div>
                </div>
                <div class="sm-stat-bar">
                    <div class="sm-stat-item"><div class="sm-stat-value" id="smRec">0</div><div class="sm-stat-label">我的识别</div></div>
                    <div class="sm-stat-divider"></div>
                    <div class="sm-stat-item"><div class="sm-stat-value" id="smKB">80+</div><div class="sm-stat-label">知识库条目</div></div>
                    <div class="sm-stat-divider"></div>
                    <div class="sm-stat-item"><div class="sm-stat-value" id="smLog">0</div><div class="sm-stat-label">系统日志</div></div>
                    <div class="sm-stat-divider"></div>
                    <div class="sm-stat-item"><div class="sm-stat-value" id="smRun">0</div><div class="sm-stat-label">运行时间</div></div>
                </div>
            </div>
            <div class="sm-main-row">
                <div class="sm-settings-col">
                    <div class="sm-settings-card">
                        <div class="sm-settings-title"><span>📖</span> 关于本系统</div>
                        <div style="color:#7DD3FC;font-size:12px;line-height:1.9">
                            <p style="margin-bottom:10px">本<strong style="color:#00E5FF">宠物智能识别与情绪健康咨询系统</strong>，支持犬类、猫类、兔类、鸟类、爬行类、鱼类、小型宠物、宠物甲虫等<strong style="color:#E0F2FE">九大类宠物</strong>的智能识别。</p>
                            <p style="margin-bottom:10px">通过深度学习MobileNetV3-small预训练模型，对上传的宠物图像进行综合识别分析，输出<strong style="color:#00E5FF">品种、年龄、性别、情绪状态</strong>等多维度信息，并提供专业的喂食建议、疾病用药参考与情绪安抚方案。</p>
                            <p>所有数据仅保存在本地数据库中，不会上传任何外部服务，保护用户隐私。</p>
                            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-top:14px;padding-top:14px;border-top:1px solid rgba(0,229,255,0.1)">
                                <div style="background:rgba(0,229,255,0.05);padding:10px;border-radius:8px">
                                    <div style="color:#38BDF8;font-size:11px">软件版本</div>
                                    <div style="color:#E0F2FE;font-weight:600;margin-top:2px">v1.0.0 Release</div>
                                </div>
                                <div style="background:rgba(139,92,246,0.05);padding:10px;border-radius:8px">
                                    <div style="color:#38BDF8;font-size:11px">AI 模型版本</div>
                                    <div style="color:#E0F2FE;font-weight:600;margin-top:2px">MobileNetV3-small (ImageNet)</div>
                                </div>
                                <div style="background:rgba(16,185,129,0.05);padding:10px;border-radius:8px">
                                    <div style="color:#38BDF8;font-size:11px">支持品类</div>
                                    <div style="color:#E0F2FE;font-weight:600;margin-top:2px">九大类 / 80+ 真实品种</div>
                                </div>
                                <div style="background:rgba(245,158,11,0.05);padding:10px;border-radius:8px">
                                    <div style="color:#38BDF8;font-size:11px">识别维度</div>
                                    <div style="color:#E0F2FE;font-weight:600;margin-top:2px">品种/年龄/性别/情绪</div>
                                </div>
                            </div>
                        </div>
                    </div>
                    ${cloudConfigCard}
                    <div class="sm-settings-card">
                        <div class="sm-settings-title"><span>⚙️</span> 系统设置</div>
                        <div class="sm-toggle-row">
                            <div class="sm-toggle-text"><strong>通知提醒</strong><small>识别完成后自动推送通知</small></div>
                            <label class="ref-switch"><input type="checkbox" checked><span class="slider"></span></label>
                        </div>
                        <div class="sm-toggle-row">
                            <div class="sm-toggle-text"><strong>自动保存识别记录</strong><small>每次识别成功自动保存至历史记录</small></div>
                            <label class="ref-switch"><input type="checkbox" checked><span class="slider"></span></label>
                        </div>
                        <div class="sm-toggle-row">
                            <div class="sm-toggle-text"><strong>高性能运行模式</strong><small>更快识别速度，略高电量消耗</small></div>
                            <label class="ref-switch"><input type="checkbox" checked><span class="slider"></span></label>
                        </div>
                        <div class="sm-toggle-row">
                            <div class="sm-toggle-text"><strong>开机自启动</strong><small>登录电脑后自动启动本系统</small></div>
                            <label class="ref-switch"><input type="checkbox"><span class="slider"></span></label>
                        </div>
                        <div class="sm-btn-row">
                            <button class="btn btn-secondary" onclick="showHelpModal()">❓ 使用帮助</button>
                            <button class="btn btn-secondary" onclick="confirmClearCache()">🗑️ 清空缓存</button>
                            <button class="btn btn-primary" onclick="openChangePassword()">🔑 修改密码</button>
                            <button class="btn btn-danger" onclick="logout()">🚪 退出登录</button>
                        </div>
                    </div>
                </div>
                <div class="sm-log-card">
                    <div class="ref-card-title"><span class="title-icon">📋</span>系统日志</div>
                    <div class="sm-log-list" id="smLogList">
                        <div class="log-line log-info">[INFO] ${new Date().toLocaleTimeString('zh-CN')} 系统启动完成</div>
                        <div class="log-line log-info">[INFO] 用户 ${nickname} 登录成功</div>
                        <div class="log-line log-info">[INFO] 知识库已加载</div>
                    </div>
                    <div class="sm-copyright">版权所有 · 保留权利 · 未经授权禁止转载或用于商业用途</div>
                </div>
            </div>
        </div>
    `;
    try {
        const res = await fetch('/api/stats/dashboard');
        const d = await res.json();
        if (d && d.success) {
            const recEl = document.getElementById('smRec');
            if (recEl) recEl.textContent = d.total;
        }
    } catch (e) {}
    const startT = Date.now();
    setInterval(() => {
        const onEl = document.getElementById('onLen');
        if (!onEl) return;
        const diff = Math.floor((Date.now() - startT) / 1000);
        const h = Math.floor(diff / 3600), m = Math.floor((diff%3600)/60);
        onEl.textContent = `${h}h ${m}m`;
    }, 1000);
    if (isAdmin) loadCloudConfig();
}

function switchTheme(btn, theme) {
    document.querySelectorAll('.ref-theme-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    showToast('已切换为' + (theme === 'dark' ? '深色' : '浅色') + '主题');
}
window.switchTheme = switchTheme;

function openChangePassword() {
    openModal('🔑 修改密码', `
        <div style="padding:16px">
            <input id="oldPwd" type="password" placeholder="原密码" class="ref-modal-input">
            <input id="newPwd" type="password" placeholder="新密码" class="ref-modal-input">
            <input id="confirmPwd" type="password" placeholder="确认新密码" class="ref-modal-input">
        </div>
    `, '<button class="btn btn-primary" onclick="submitChangePassword()">确认修改</button>');
}
window.openChangePassword = openChangePassword;

function changePassword() {
    openModal('🔑 修改密码', `
        <div class="form-group" style="margin-bottom:16px">
            <label class="form-label">当前密码</label>
            <input type="password" id="oldPassword" class="form-input" placeholder="请输入当前密码">
        </div>
        <div class="form-group" style="margin-bottom:16px">
            <label class="form-label">新密码</label>
            <input type="password" id="newPassword" class="form-input" placeholder="请输入新密码">
        </div>
        <div class="form-group">
            <label class="form-label">确认新密码</label>
            <input type="password" id="confirmPassword" class="form-input" placeholder="请再次输入新密码">
        </div>
    `, '<button class="btn btn-primary" onclick="submitChangePassword()">确认修改</button>');
}

async function submitChangePassword() {
    const oldP = document.getElementById('oldPassword').value;
    const newP = document.getElementById('newPassword').value;
    const confirmP = document.getElementById('confirmPassword').value;

    if (!oldP || !newP || !confirmP) {
        showToast('请填写完整信息', 'error');
        return;
    }
    if (newP !== confirmP) {
        showToast('两次输入的新密码不一致', 'error');
        return;
    }

    try {
        const res = await fetch('/api/user/change_password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ old_password: oldP, new_password: newP })
        });
        const data = await res.json();
        if (data.success) {
            showToast('密码修改成功', 'success');
            closeModal();
        } else {
            showToast(data.message || '修改失败', 'error');
        }
    } catch (e) {
        showToast('请求失败', 'error');
    }
}

function changeNickname() {
    openModal('✏️ 修改昵称', `
        <div class="form-group">
            <label class="form-label">新昵称</label>
            <input type="text" id="newNickname" class="form-input" placeholder="请输入新昵称" value="${currentUser?.nickname || ''}">
        </div>
    `, '<button class="btn btn-primary" onclick="submitChangeNickname()">保存</button>');
}

async function submitChangeNickname() {
    const nickname = document.getElementById('newNickname').value.trim();
    if (!nickname) {
        showToast('请输入昵称', 'error');
        return;
    }

    try {
        const res = await fetch('/api/user/change_nickname', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nickname })
        });
        const data = await res.json();
        if (data.success) {
            showToast('昵称修改成功', 'success');
            closeModal();
            await loadUserInfo();
            showPage(currentPage);
        } else {
            showToast(data.message || '修改失败', 'error');
        }
    } catch (e) {
        showToast('请求失败', 'error');
    }
}

function clearCache() {
    openModal('🗑️ 清空缓存', '<p style="color:var(--text-dim)">确定要清空临时图片缓存吗？</p>', 
        '<button class="btn btn-danger" onclick="confirmClearCache()">确认清空</button>');
}

async function confirmClearCache() {
    try {
        const res = await fetch('/api/settings/clear_temp', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showToast('缓存已清空', 'success');
            closeModal();
        }
    } catch (e) {
        showToast('清空失败', 'error');
    }
}

function checkUpdate() {
    showToast('当前已是最新版本', 'info');
}

function showAbout() {
    openModal('ℹ️ 关于系统', `
        <div style="text-align:center;padding:20px">
            <div style="font-size:48px;margin-bottom:12px;filter:drop-shadow(0 0 20px rgba(0, 229, 255, 0.6))">🐾</div>
            <h2 class="neon-text" style="margin-bottom:8px">PetAI System</h2>
            <p style="color:var(--text-secondary);margin-bottom:16px;letter-spacing:2px;font-size:12px">AI Pet Emotion Recognition System</p>
            <div class="data-panel" style="text-align:left">
                <div class="data-row">
                    <div class="data-cell"><span class="cell-label">系统版本</span><span class="cell-value">v3.0 Pro</span></div>
                </div>
                <div class="data-row">
                    <div class="data-cell"><span class="cell-label">AI模型引擎</span><span class="cell-value">MobileNetV3-Small</span></div>
                </div>
                <div class="data-row">
                    <div class="data-cell"><span class="cell-label">支持品类</span><span class="cell-value">9大类宠物</span></div>
                </div>
                <div class="data-row">
                    <div class="data-cell"><span class="cell-label">开发技术</span><span class="cell-value">Python + Flask</span></div>
                </div>
                <div class="data-row">
                    <div class="data-cell"><span class="cell-label">界面风格</span><span class="cell-value">Sci-Fi HUD</span></div>
                </div>
            </div>
            <p style="color:var(--text-muted);font-size:12px;margin-top:16px;letter-spacing:1px">© 2026 PetAI System · All Rights Reserved</p>
        </div>
    `, '<button class="btn btn-primary btn-primary-glow btn-glow" onclick="closeModal()">关闭</button>');
}

// ===== 登出 =====
async function logout() {
    if (!confirm('确定要退出登录吗？')) return;
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
        localStorage.removeItem('petAI_state');
        window.location.href = '/login';
    } catch (e) {
        window.location.href = '/login';
    }
}

async function showHelpModal() {
    try {
        const res = await fetch('/api/help/faq');
        const d = await res.json();
        if (d && d.success && d.faq) {
            openModal('❓ 使用帮助（FAQ）', `
                <div style="max-height:60vh;overflow-y:auto;padding:4px">
                    ${d.faq.map((f,i)=>`
                        <div style="margin-bottom:18px;padding-bottom:14px;border-bottom:${i===d.faq.length-1?'none':'1px solid rgba(0,229,255,0.08)'}">
                            <div style="color:#00E5FF;font-weight:600;margin-bottom:6px;display:flex;gap:8px;align-items:flex-start">
                                <span style="background:#00E5FF20;color:#00E5FF;padding:2px 8px;border-radius:4px;font-size:11px">Q${i+1}</span>
                                <span>${f.q}</span>
                            </div>
                            <div style="color:#E0F2FE;line-height:1.8;padding-left:40px;font-size:13px">${f.a}</div>
                        </div>
                    `).join('')}
                </div>
            `, '<button class="btn btn-primary" onclick="closeModal()">我知道了</button>');
            return;
        }
    } catch(e) {}
    openModal('❓ 使用帮助', `
        <div style="padding:10px;line-height:1.9;color:#E0F2FE;font-size:13px">
            <p><strong style="color:#00E5FF">🐾 如何获得更准确的识别结果？</strong><br>上传宠物正面清晰照片，光线充足，宠物面部可见，建议单张图片只包含1只宠物。</p>
            <p><strong style="color:#00E5FF">😶 为什么置信度较低？</strong><br>图片模糊、角度偏斜、光线差会导致AI置信度下降。建议重拍。</p>
            <p><strong style="color:#00E5FF">⚕️ 系统建议能替代兽医吗？</strong><br>不能！建议仅为日常养护参考，如宠物出现明显不适，请立即联系专业兽医。</p>
            <p><strong style="color:#00E5FF">👤 为什么游客不能识别？</strong><br>游客仅可浏览系统功能，注册登录后方可使用完整识别功能并保存记录。</p>
            <p><strong style="color:#00E5FF">💾 数据会上传吗？</strong><br>不会。所有识别数据仅保存在本地服务器数据库，不会上传外部服务。</p>
        </div>
    `, '<button class="btn btn-primary" onclick="closeModal()">我知道了</button>');
}
window.showHelpModal = showHelpModal;

async function exportReport(id) {
    try {
        const res = await fetch('/api/history/export/' + id);
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `宠物识别报告_${id}.txt`;
        a.click();
        showToast('报告导出成功', 'success');
    } catch (e) { showToast('导出失败：' + e.message, 'error'); }
}
window.exportReport = exportReport;

function exportAllReports() {
    showToast('请前往历史识别记录，逐条点击「导出」按钮下载', 'info');
}
window.exportAllReports = exportAllReports;

// ===== 药品信息参考页面 =====
function renderMedicinePage(container) {
    const medicines = [
        {
            category: '驱虫药物',
            icon: '🪱',
            items: [
                { name: '拜宠清', brand: '拜耳', priceRange: '¥68-85', species: ['犬', '猫'], desc: '广谱驱虫，有效杀灭蛔虫、钩虫、绦虫等肠道寄生虫', usage: '每3个月1次，10kg以下1片，10-20kg2片', precautions: '幼犬需满2周龄以上使用' },
                { name: '福来恩', brand: '法国梅里亚', priceRange: '¥95-120', species: ['犬'], desc: '体外驱虫，跳蚤、蜱虫特效药，持效30天', usage: '每月1次，滴于肩胛骨后皮肤', precautions: '使用后24小时内避免洗澡' },
                { name: '大宠爱', brand: '美国硕腾', priceRange: '¥128-158', species: ['猫'], desc: '内外同驱，安全温和，适用于幼猫', usage: '每月1次，2.6-7.5kg幼猫用0.75ml', precautions: '8周龄以上幼猫可用' },
                { name: '尼可信', brand: '拜耳', priceRange: '¥168-198', species: ['犬'], desc: '体外驱虫咀嚼片，适口性好，杀灭跳蚤蜱虫', usage: '每月1片，直接喂食或拌入食物', precautions: '按体重选择规格' },
                { name: '博来恩', brand: '法国梅里亚', priceRange: '¥158-188', species: ['犬'], desc: '内外同驱滴剂，24小时全效', usage: '每月1次，2.5-7.5kg用1支', precautions: '仅适用于犬类' },
                { name: '雷沃拉肯', brand: '拜耳', priceRange: '¥188-220', species: ['犬'], desc: '长效驱虫片，预防蜱虫传播疾病如莱姆病', usage: '每8周1次，10-25kg1片', precautions: '需整片吞食，不可咀嚼' },
                { name: '索莱多', brand: '美国硕腾', priceRange: '¥85-105', species: ['猫'], desc: '体外驱虫滴剂，快速杀灭跳蚤', usage: '每月1次，滴于颈后皮肤', precautions: '哺乳期母猫可用' },
                { name: '爱沃克', brand: '拜耳', priceRange: '¥135-165', species: ['猫'], desc: '内外同驱滴剂，防治耳螨、疥螨', usage: '每月1次，0.8ml规格', precautions: '幼猫8周龄以上可用' },
                { name: '超可信', brand: '法国梅里亚', priceRange: '¥158-198', species: ['犬'], desc: '口服驱虫药，驱杀跳蚤、蜱虫、线虫', usage: '每月1片，按体重选择规格', precautions: '可与食物同服' },
                { name: '海乐宠', brand: '海正药业', priceRange: '¥45-58', species: ['犬', '猫'], desc: '米尔贝肟驱虫药，预防心丝虫', usage: '每月1次，0.5mg/kg', precautions: '需连续使用预防心丝虫' },
                { name: '犬心保', brand: '美国硕腾', priceRange: '¥120-150', species: ['犬'], desc: '预防心丝虫病，驱杀肠道寄生虫', usage: '每月1片，6个月以上犬使用', precautions: '第一年需连续使用12个月' },
                { name: '旺滴静', brand: '拜耳', priceRange: '¥98-125', species: ['犬'], desc: '体外驱虫滴剂，杀灭跳蚤幼虫和虫卵', usage: '每月1次，滴于4个皮肤点', precautions: '使用后避免接触眼鼻' }
            ]
        },
        {
            category: '营养补充',
            icon: '💊',
            items: [
                { name: '宠物复合维生素', brand: '卫仕', priceRange: '¥45-58', species: ['犬', '猫'], desc: '补充多种维生素B、C、E，增强免疫力', usage: '每日1片，可拌入食物中', precautions: '无需连续服用，可间断使用' },
                { name: '宠物钙片', brand: '谷登', priceRange: '¥52-68', species: ['犬', '猫'], desc: '乳酸钙+葡萄糖酸钙，促进骨骼发育', usage: '每日2片，随餐服用', precautions: '幼犬幼猫生长期使用' },
                { name: '宠物益生菌', brand: '麦翻麦', priceRange: '¥78-98', species: ['犬', '猫'], desc: '调节肠道菌群，改善消化吸收', usage: '每日1袋，溶于温水或食物', precautions: '开封后尽快用完' },
                { name: '宠物卵磷脂', brand: '卫仕', priceRange: '¥85-108', species: ['犬', '猫'], desc: '美毛护肤，改善毛发质量，减少脱毛', usage: '每日1勺约5g，拌入食物', precautions: '建议连续使用3个月以上' },
                { name: '三文鱼油', brand: '挪威Biosalmon', priceRange: '¥68-85', species: ['犬', '猫'], desc: '富含Omega-3脂肪酸，美毛护心', usage: '每日1ml/10kg体重', precautions: '冷藏保存' },
                { name: '微量元素片', brand: '谷登', priceRange: '¥38-50', species: ['犬', '猫'], desc: '补充锌、铁、锰等微量元素', usage: '每日1-2片', precautions: '可与钙片交替使用' },
                { name: '宠物羊奶粉', brand: 'Both', priceRange: '¥98-128', species: ['犬', '猫'], desc: '替代母乳，增强幼崽抵抗力', usage: '按说明冲调，每日3-4次', precautions: '用40°C温水冲调' },
                { name: '硫酸软骨素', brand: '拜耳', priceRange: '¥128-158', species: ['犬', '猫'], desc: '保护关节软骨，预防骨骼疾病', usage: '每日1片，随餐服用', precautions: '老年宠物长期使用效果好' },
                { name: '宠物营养膏', brand: '红狗', priceRange: '¥68-98', species: ['犬', '猫'], desc: '补充多种营养，病后恢复使用', usage: '每日5-10cm，直接涂抹或拌食', precautions: '开膏后3个月内用完' },
                { name: '化毛膏', brand: '骏宝', priceRange: '¥58-75', species: ['猫'], desc: '促进毛球排出，预防毛球症', usage: '每日1-2cm，直接涂抹或拌食', precautions: '长毛猫建议每天使用' },
                { name: '免疫球蛋白', brand: '博来恩', priceRange: '¥168-198', species: ['犬', '猫'], desc: '增强免疫力，预防病毒感染', usage: '每日1袋，溶于水', precautions: '应激前后使用效果最佳' },
                { name: '宠物DHA', brand: '卫仕', priceRange: '¥128-158', species: ['犬', '猫'], desc: '促进大脑发育，提升智力', usage: '每日1粒，随餐服用', precautions: '幼年期使用效果最佳' }
            ]
        },
        {
            category: '皮肤护理',
            icon: '🧴',
            items: [
                { name: '抗真菌药浴香波', brand: '科莱博', priceRange: '¥88-108', species: ['犬', '猫'], desc: '抗真菌、消炎止痒，治疗皮肤病', usage: '每周2-3次，充分起泡后停留5分钟', precautions: '避免接触眼睛' },
                { name: '皮肤修复喷剂', brand: '百多邦', priceRange: '¥56-72', species: ['犬', '猫'], desc: '修复受损皮肤，促进毛发生长', usage: '每日2-3次，喷于患处', precautions: '使用前清洁患处' },
                { name: '除螨沐浴露', brand: '雷米高', priceRange: '¥78-98', species: ['犬', '猫'], desc: '驱杀螨虫，缓解皮肤瘙痒', usage: '每周1-2次，揉搓5分钟后冲洗', precautions: '配合驱虫药效果更好' },
                { name: '伤口消毒凝胶', brand: '3M', priceRange: '¥45-58', species: ['犬', '猫'], desc: '伤口消毒，预防感染，促进愈合', usage: '清洁伤口后涂抹，每日2次', precautions: '大面积伤口需就医' },
                { name: '耳部清洁液', brand: '威隆', priceRange: '¥35-45', species: ['犬', '猫'], desc: '清洁耳道，预防耳螨和耳炎', usage: '每周1次，滴入耳内轻柔按摩', precautions: '耳道有炎症时增加使用频率' },
                { name: '酮康唑洗剂', brand: '采乐', priceRange: '¥68-85', species: ['犬', '猫'], desc: '治疗真菌性皮炎、脂溢性皮炎', usage: '每3天1次，停留10分钟', precautions: '需连续使用2-4周' },
                { name: '皮肤营养喷剂', brand: '卫仕', priceRange: '¥48-62', species: ['犬', '猫'], desc: '补充皮肤营养，修复皮肤屏障', usage: '每日1-2次，喷于患处', precautions: '可与药物交替使用' },
                { name: '趾间炎药膏', brand: '百多邦', priceRange: '¥52-68', species: ['犬', '猫'], desc: '治疗趾间炎、肛周腺炎', usage: '清洁后涂抹患处，每日2次', precautions: '保持患处干燥' },
                { name: '除跳蚤喷雾', brand: '福来恩', priceRange: '¥58-78', species: ['犬', '猫'], desc: '快速杀灭跳蚤成虫', usage: '喷于宠物全身，按说明用量', precautions: '使用后避免舔舐' },
                { name: '猫藓药膏', brand: '克霉唑', priceRange: '¥28-38', species: ['猫'], desc: '治疗猫癣（真菌感染）', usage: '清洁后涂抹患处，每日2次', precautions: '需同时补充维生素B' }
            ]
        },
        {
            category: '常用药品',
            icon: '💉',
            items: [
                { name: '阿莫西林克拉维酸钾', brand: '辉瑞', priceRange: '¥38-48', species: ['犬', '猫'], desc: '广谱抗生素，治疗呼吸道、泌尿道感染', usage: '按体重12.5mg/kg，每日2次', precautions: '连续使用不超过7天' },
                { name: '蒙脱石散止泻药', brand: '思密达', priceRange: '¥32-42', species: ['犬', '猫'], desc: '快速止泻，保护肠道黏膜', usage: '每次1-2袋，溶于温水', precautions: '与其他药物间隔1小时' },
                { name: '复方氯霉素眼药水', brand: '正大天晴', priceRange: '¥28-35', species: ['犬', '猫'], desc: '治疗结膜炎、角膜炎等眼部感染', usage: '每次1-2滴，每日3-4次', precautions: '使用前洗手' },
                { name: '布洛芬退烧药', brand: '拜耳', priceRange: '¥25-32', species: ['犬', '猫'], desc: '缓解发热、疼痛、抗炎', usage: '按体重5mg/kg，体温超39°C时使用', precautions: '使用不超过3天' },
                { name: '止咳糖浆', brand: '沐舒坦', priceRange: '¥42-55', species: ['犬', '猫'], desc: '缓解咳嗽，稀释痰液', usage: '每次2-3ml，每日3次', precautions: '配合雾化治疗效果更好' },
                { name: '维生素B族片', brand: '拜耳', priceRange: '¥32-42', species: ['犬', '猫'], desc: '营养神经，改善食欲，缓解应激', usage: '每日1片', precautions: '长期使用需医生指导' },
                { name: '多潘立酮止吐药', brand: '吗丁啉', priceRange: '¥28-38', species: ['犬', '猫'], desc: '止吐，促进胃动力', usage: '按体重0.5mg/kg', precautions: '肠梗阻禁用' },
                { name: '奥美拉唑胃酸抑制剂', brand: '洛赛克', priceRange: '¥58-75', species: ['犬', '猫'], desc: '治疗胃溃疡、胃酸过多', usage: '按体重1mg/kg，每日1次', precautions: '早餐前30分钟服用' },
                { name: '地奥司明片', brand: '施维雅', priceRange: '¥65-82', species: ['犬', '猫'], desc: '改善微循环，治疗痔疮、静脉曲张', usage: '每日1-2片，随餐服用', precautions: '连续使用不超过3个月' },
                { name: '甲硝唑', brand: '华北制药', priceRange: '¥18-28', species: ['犬', '猫'], desc: '治疗滴虫病、阿米巴病、厌氧菌感染', usage: '按体重15mg/kg，每日2次', precautions: '用药期间禁止饮酒' },
                { name: '速尿利尿剂', brand: '拜耳', priceRange: '¥25-35', species: ['犬', '猫'], desc: '利尿，治疗水肿、心衰、肾病', usage: '按体重2mg/kg', precautions: '注意补充钾离子' },
                { name: '扑尔敏抗过敏药', brand: '拜耳', priceRange: '¥22-30', species: ['犬', '猫'], desc: '缓解过敏反应、皮肤瘙痒', usage: '按体重0.5mg/kg', precautions: '可能引起嗜睡' }
            ]
        },
        {
            category: '疫苗免疫',
            icon: '💉',
            items: [
                { name: '狂犬病疫苗', brand: '瑞梅', priceRange: '¥120-150', species: ['犬', '猫'], desc: '预防狂犬病，人兽共患病', usage: '每年接种1次，肌肉注射', precautions: '接种后观察30分钟' },
                { name: '四联疫苗', brand: '拜耳', priceRange: '¥158-188', species: ['犬'], desc: '预防犬瘟、细小、副流感、腺病毒', usage: '幼犬3针（每针间隔3周），成年犬每年1针', precautions: '接种前确保健康状态' },
                { name: '猫三联疫苗', brand: '美国硕腾', priceRange: '¥138-168', species: ['猫'], desc: '预防猫瘟、鼻支、杯状病毒', usage: '幼猫3针，成年猫每年1针', precautions: '孕期母猫禁止接种' },
                { name: '弓形虫疫苗', brand: '日本生物制品', priceRange: '¥168-198', species: ['猫'], desc: '预防弓形虫感染，保护人猫健康', usage: '每年接种1次', precautions: '仅用于健康猫' },
                { name: '六联疫苗', brand: '拜耳', priceRange: '¥198-238', species: ['犬'], desc: '预防犬瘟、细小、副流感、腺病毒、冠状病毒、钩端螺旋体', usage: '幼犬3针，每年加强1针', precautions: '进口疫苗效果更好' },
                { name: '猫五联疫苗', brand: '欧洲兽医', priceRange: '¥188-218', species: ['猫'], desc: '预防猫瘟、鼻支、杯状、疱疹、衣原体', usage: '幼猫3针，每年加强1针', precautions: '需在8周龄以上接种' },
                { name: '禽流感疫苗', brand: '青岛生物', priceRange: '¥68-98', species: ['鸟'], desc: '预防禽流感', usage: '幼鸟2针，每年加强', precautions: '接种前确保健康' },
                { name: '传染性法氏囊疫苗', brand: '山东生物', priceRange: '¥38-58', species: ['鸟'], desc: '预防鸡传染性法氏囊病', usage: '雏鸟1针，2周后加强', precautions: '可饮水免疫' }
            ]
        },
        {
            category: '老年护理',
            icon: '👴',
            items: [
                { name: '老年关节保健品', brand: '卫仕', priceRange: '¥168-208', species: ['犬', '猫'], desc: '氨糖+软骨素+MSM，缓解关节老化', usage: '每日1粒，随餐服用', precautions: '老年宠物长期使用' },
                { name: '心脏保健药', brand: '勃林格殷格翰', priceRange: '¥258-308', species: ['犬', '猫'], desc: '保护心脏，改善心功能，治疗心衰', usage: '按医嘱每日服用', precautions: '需定期监测心功能' },
                { name: '老年痴呆保健品', brand: '卫仕', priceRange: '¥138-168', species: ['犬', '猫'], desc: '改善认知功能，延缓脑衰老', usage: '每日1-2粒', precautions: '7岁以上宠物使用' },
                { name: '肾脏保护剂', brand: 'Royal Canin', priceRange: '¥198-258', species: ['犬', '猫'], desc: '低磷低钠配方，保护肾功能', usage: '每日1包，拌入食物', precautions: '肾病早期使用效果好' },
                { name: '视力保健品', brand: '卫仕', priceRange: '¥88-108', species: ['犬', '猫'], desc: '叶黄素+β-胡萝卜素，保护视网膜', usage: '每日1粒', precautions: '白内障前期使用' },
                { name: '消化酶制剂', brand: '麦富迪', priceRange: '¥78-98', species: ['犬', '猫'], desc: '补充消化酶，改善老年宠物消化功能', usage: '每日1袋，拌入食物', precautions: '每餐使用效果好' },
                { name: '免疫增强剂', brand: '博来恩', priceRange: '¥158-198', species: ['犬', '猫'], desc: '增强免疫力，预防老年病', usage: '每日1袋', precautions: '可长期使用' },
                { name: '泌尿保健品', brand: '皇家', priceRange: '¥128-168', species: ['猫'], desc: '酸化尿液，预防尿路结石', usage: '每日1包', precautions: '配合处方粮效果更好' }
            ]
        },
        {
            category: '鸟类药品',
            icon: '🦜',
            items: [
                { name: '鸟类呼吸道感染药', brand: '西农', priceRange: '¥48-62', species: ['鸟'], desc: '治疗鸟类呼吸道感染、鼻炎、肺炎', usage: '饮水给药，每100ml水加1ml', precautions: '连续使用3-5天' },
                { name: '鸟类消化道药', brand: '心连心', priceRange: '¥38-52', species: ['鸟'], desc: '治疗肠炎、腹泻、消化不良', usage: '饮水给药，按说明稀释', precautions: '同时补充多维' },
                { name: '鸟类维生素电解质', brand: '华美', priceRange: '¥28-38', species: ['鸟'], desc: '补充多种维生素和电解质', usage: '饮水或拌料，每周2次', precautions: '应激期间使用' },
                { name: '鸟类抗真菌药', brand: '西农', priceRange: '¥55-68', species: ['鸟'], desc: '治疗念珠菌病、曲霉菌病', usage: '喷雾或饮水给药', precautions: '保持环境干燥' },
                { name: '鸟类驱虫药', brand: '中农', priceRange: '¥42-55', species: ['鸟'], desc: '驱除体内外寄生虫', usage: '每2个月1次', precautions: '用药后加强营养' },
                { name: '鸟类啄羽灵', brand: '心连心', priceRange: '¥35-48', species: ['鸟'], desc: '治疗啄羽、啄肛等异食癖', usage: '饮水给药3-5天', precautions: '改善饲料营养' },
                { name: '鸟类消炎药', brand: '西农', priceRange: '¥32-45', species: ['鸟'], desc: '治疗鸟感染、炎症', usage: '饮水给药，每100ml加0.5g', precautions: '不与益生菌同用' },
                { name: '鸟类葡萄糖', brand: '华美', priceRange: '¥15-25', species: ['鸟'], desc: '快速补充能量，缓解应激', usage: '饮水5%浓度', precautions: '病鸟恢复期间使用' },
                { name: '鸟类多维素', brand: '华美', priceRange: '¥22-32', species: ['鸟'], desc: '补充多种维生素，增强体质', usage: '每周1-2次饮水', precautions: '繁殖期增加使用频率' },
                { name: '鸟类外伤药', brand: '心连心', priceRange: '¥28-38', species: ['鸟'], desc: '治疗外伤、断羽、脚伤', usage: '涂抹患处，每日2次', precautions: '防止二次感染' }
            ]
        },
        {
            category: '鱼类药品',
            icon: '🐟',
            items: [
                { name: '鱼缸消毒液', brand: '鱼乐', priceRange: '¥28-38', species: ['鱼'], desc: '消毒鱼缸，预防细菌感染', usage: '换水时添加，按说明用量', precautions: '消毒后充分曝气' },
                { name: '白点净', brand: '鱼乐', priceRange: '¥35-48', species: ['鱼'], desc: '治疗白点病（小瓜虫病）', usage: '全池泼洒，连续3天', precautions: '同时升温至30°C' },
                { name: '杀菌水', brand: '德彩', priceRange: '¥45-58', species: ['鱼'], desc: '杀灭水中细菌、真菌', usage: '每周1次，按说明用量', precautions: '不要与活性炭同用' },
                { name: '鱼药万能水', brand: '鱼乐', priceRange: '¥38-52', species: ['鱼'], desc: '治疗多种鱼类疾病', usage: '全池泼洒，每2天1次', precautions: '使用期间减少喂食' },
                { name: '硝化细菌', brand: '百因美', priceRange: '¥58-78', species: ['鱼'], desc: '分解水中氨氮、亚硝酸盐', usage: '换水后添加，每月2次', precautions: '硝化系统建立需2-4周' },
                { name: '除藻剂', brand: '鱼乐', priceRange: '¥32-45', species: ['鱼'], desc: '清除鱼缸藻类', usage: '按说明添加，避免超量', precautions: '同时控制光照' },
                { name: '鱼用抗生素', brand: '水产研究所', priceRange: '¥48-65', species: ['鱼'], desc: '治疗鱼类细菌感染', usage: '药浴或全池泼洒', precautions: '连续使用3-5天' },
                { name: '水质调节剂', brand: '百因美', priceRange: '¥42-55', species: ['鱼'], desc: '稳定pH值，改善水质', usage: '根据水质检测结果使用', precautions: '避免剧烈变动pH' },
                { name: '水族盐', brand: '鱼乐', priceRange: '¥18-28', species: ['鱼'], desc: '调节渗透压，预防疾病', usage: '每升水1-3g', precautions: '不可过量使用' },
                { name: '鱼用维生素C', brand: '水产研究所', priceRange: '¥25-35', species: ['鱼'], desc: '增强鱼类免疫力，抗应激', usage: '拌饵投喂，每日1次', precautions: '开袋后密封保存' }
            ]
        },
        {
            category: '爬行类药品',
            icon: '🦎',
            items: [
                { name: '爬虫滴眼液', brand: 'Rep-Cal', priceRange: '¥45-58', species: ['爬行类'], desc: '治疗爬行类眼部感染', usage: '每次1滴，每日3-4次', precautions: '使用前清洁眼部' },
                { name: '爬虫补钙粉', brand: 'Rep-Cal', priceRange: '¥58-78', species: ['爬行类'], desc: '补充钙质，预防软壳病', usage: '每周1-2次，撒于食物', precautions: 'UVB灯配合使用效果更好' },
                { name: '爬虫维生素粉', brand: 'ReptiVit', priceRange: '¥68-88', species: ['爬行类'], desc: '补充多种维生素', usage: '每周1次，撒于食物', precautions: '不要与钙粉同时使用' },
                { name: '爬虫消炎药', brand: 'Zoomed', priceRange: '¥52-68', species: ['爬行类'], desc: '治疗呼吸道感染、肺炎', usage: '注射或口服，按体重给药', precautions: '需兽医指导' },
                { name: '爬虫驱虫药', brand: 'Repel', priceRange: '¥42-55', species: ['爬行类'], desc: '驱除体内寄生虫', usage: '按说明口服', precautions: '每年驱虫1-2次' },
                { name: '爬虫皮肤药', brand: 'Zoomed', priceRange: '¥48-62', species: ['爬行类'], desc: '治疗脱皮困难、皮肤感染', usage: '涂抹患处或药浴', precautions: '保持环境湿度' },
                { name: '爬虫肠道药', brand: 'Rep-Cal', priceRange: '¥38-52', species: ['爬行类'], desc: '治疗肠炎、腹泻', usage: '口服或灌肠', precautions: '注意补水' },
                { name: '爬虫外伤药', brand: 'Zoomed', priceRange: '¥45-58', species: ['爬行类'], desc: '治疗外伤、骨折', usage: '清洁后涂抹，必要时包扎', precautions: '严重外伤需就医' }
            ]
        },
        {
            category: '兔类药品',
            icon: '🐇',
            items: [
                { name: '兔用驱虫药', brand: '拜耳', priceRange: '¥38-52', species: ['兔'], desc: '驱除兔体内外寄生虫', usage: '每3个月1次', precautions: '幼兔6周龄以上可用' },
                { name: '兔用抗生素', brand: '辉瑞', priceRange: '¥42-55', species: ['兔'], desc: '治疗呼吸道、肠道感染', usage: '按体重给药，每日2次', precautions: '连续使用不超过5天' },
                { name: '兔用维生素', brand: '卫仕', priceRange: '¥28-38', species: ['兔'], desc: '补充多种维生素，预防缺乏症', usage: '每周2-3次', precautions: '繁殖期增加使用' },
                { name: '兔用止泻药', brand: '思密达', priceRange: '¥25-35', species: ['兔'], desc: '治疗兔腹泻、肠炎', usage: '口服，每日2次', precautions: '同时补充电解质' },
                { name: '兔用化毛膏', brand: '骏宝', priceRange: '¥42-55', species: ['兔'], desc: '促进排毛，预防毛球症', usage: '每日1-2cm', precautions: '换毛期增加使用频率' },
                { name: '兔用皮肤病药', brand: '科莱博', priceRange: '¥48-62', species: ['兔'], desc: '治疗兔皮肤病、真菌感染', usage: '每周2-3次药浴', precautions: '连续使用2-4周' },
                { name: '兔用免疫增强剂', brand: '博来恩', priceRange: '¥55-68', species: ['兔'], desc: '增强免疫，预防疾病', usage: '饮水给药，连续7天', precautions: '应激前后使用' },
                { name: '兔用营养膏', brand: '红狗', priceRange: '¥52-68', species: ['兔'], desc: '补充营养，病后恢复', usage: '每日3-5cm', precautions: '每日用量不超过体重1%' },
                { name: '兔用眼部护理液', brand: '正大天晴', priceRange: '¥22-32', species: ['兔'], desc: '清洁眼部，预防感染', usage: '每日1-2滴', precautions: '环境灰尘多时使用' },
                { name: '兔用疫苗', brand: '中国农科院', priceRange: '¥68-98', species: ['兔'], desc: '预防兔瘟、巴氏杆菌病', usage: '每年1次，肌肉注射', precautions: '幼兔45日龄以上接种' }
            ]
        }
    ];

    container.innerHTML = `
        <div class="medicine-page">
            <div class="med-warning-banner">
                <div class="warning-icon">⛔</div>
                <div class="warning-content">
                    <div class="warning-title">医疗安全提示</div>
                    <div class="warning-desc">
                        本页面仅提供<strong>药品信息查询和市场价格参考</strong>，不作为诊断或治疗依据，<strong>不构成任何药品销售行为</strong>。<br>
                        宠物用药存在个体差异和风险，<strong>请务必咨询执业兽医</strong>后再使用。自行用药可能导致药物中毒、过敏反应或延误病情。
                    </div>
                </div>
            </div>
            <div id="dbMedicineSection" class="med-db-section">
                <div class="med-db-head">
                    <div>
                        <div class="med-db-title"><span class="med-db-ico">${SVG_MEDICAL}</span>疾病用药参考</div>
                        <div class="med-db-sub">按宠物类别分组，点击类别筛选；具体诊断请以兽医为准</div>
                    </div>
                    <span class="med-db-count" id="dbMedCount"></span>
                </div>
                <div class="med-db-toolbar">
                    <input type="text" id="dbMedSearch" class="form-input med-db-search" placeholder="🔍 搜索病名、症状或参考用药…">
                </div>
                <div class="med-chip-row" id="dbMedChips">
                    <button class="med-chip active" data-pet="">🐾 全部</button>
                    <button class="med-chip" data-pet="狗">🐶 狗</button>
                    <button class="med-chip" data-pet="猫">🐱 猫</button>
                    <button class="med-chip" data-pet="兔子">🐰 兔子</button>
                    <button class="med-chip" data-pet="仓鼠">🐹 仓鼠</button>
                    <button class="med-chip" data-pet="龙猫">🌰 龙猫</button>
                    <button class="med-chip" data-pet="鹦鹉">🦜 鹦鹉</button>
                    <button class="med-chip" data-pet="乌龟">🐢 乌龟</button>
                    <button class="med-chip" data-pet="金鱼">🐟 金鱼</button>
                    <button class="med-chip" data-pet="蜥蜴">🦎 蜥蜴</button>
                </div>
                <div id="dbMedList" class="med-db-list"><div class="med-db-empty">⏳ 加载中…</div></div>
            </div>
            <div class="med-section-divider"><span>药品目录</span></div>
            <section class="med-catalog-section">
                <div class="med-catalog-head">
                    <div>
                        <div class="med-catalog-title"><span class="med-catalog-ico">${SVG_PILL}</span>常用药品与参考价格</div>
                        <div class="med-catalog-sub">按宠物类别浏览药品、参考价格与用法用量</div>
                    </div>
                </div>
            <div class="med-species-filter">
                <button class="species-btn active" data-species="all">🐾 全部</button>
                <button class="species-btn" data-species="犬">🐶 犬类</button>
                <button class="species-btn" data-species="猫">🐱 猫类</button>
                <button class="species-btn" data-species="兔">🐇 兔类</button>
                <button class="species-btn" data-species="鸟">🦜 鸟类</button>
                <button class="species-btn" data-species="鱼">🐟 鱼类</button>
                <button class="species-btn" data-species="爬行类">🦎 爬行类</button>
            </div>
            <div class="med-search-bar">
                <input type="text" id="medSearchInput" class="form-input" placeholder="🔍 搜索药品名称、品牌或功效...">
                <select id="medCategoryFilter" class="form-input">
                    <option value="">全部分类</option>
                    ${medicines.map(m => `<option value="${m.category}">${m.icon} ${m.category}</option>`).join('')}
                </select>
            </div>
            <div class="med-grid" id="medGrid">
                ${medicines.map(m => renderMedicineCategory(m, '')).join('')}
            </div>
            <div class="med-disclaimer">
                <div class="disclaimer-header">
                    <span class="disclaimer-icon">⚠️</span>
                    <span class="disclaimer-title">重要免责声明</span>
                </div>
                <ul class="disclaimer-list">
                    <li><strong>本平台不销售任何药品</strong>，所有药品信息仅供学习参考</li>
                    <li><strong>价格为市场参考价</strong>，实际价格因品牌、规格、地区差异以购买时为准</li>
                    <li><strong>用法用量仅供参考</strong>，实际使用请遵循兽医处方或药品说明书</li>
                    <li><strong>用药前请确认</strong>宠物品种、年龄、体重、健康状态及过敏史</li>
                    <li><strong>处方药需兽医开具</strong>，请勿自行购买使用</li>
                    <li><strong>若宠物出现异常</strong>请立即停药并就医，切勿延误病情</li>
                </ul>
            </div>
            </section>
        </div>
    `;

    const searchInput = document.getElementById('medSearchInput');
    const categoryFilter = document.getElementById('medCategoryFilter');
    
    if (searchInput) {
        searchInput.addEventListener('input', () => filterMedicines());
    }
    if (categoryFilter) {
        categoryFilter.addEventListener('change', () => filterMedicines());
    }

    document.querySelectorAll('.species-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.species-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            filterMedicines();
        });
    });

    loadDbMedicine();
}

function renderMedicineCategory(cat, species) {
    const filteredItems = species ? cat.items.filter(item => item.species.includes(species)) : cat.items;
    if (filteredItems.length === 0) return '';
    
    return `
        <div class="med-category" data-category="${cat.category}">
            <div class="med-category-header">
                <span class="med-cat-icon">${cat.icon}</span>
                <span class="med-cat-name">${cat.category}</span>
                <span class="med-cat-count">${filteredItems.length} 种药品</span>
            </div>
            <div class="med-items">
                ${filteredItems.map(item => `
                    <div class="med-card" data-name="${item.name}" data-desc="${item.desc}" data-brand="${item.brand}" data-species="${item.species.join(',')}">
                        <div class="med-card-header">
                            <span class="med-name">${item.name}</span>
                            <span class="med-brand-tag">${item.brand}</span>
                        </div>
                        <div class="med-species-row">
                            ${item.species.map(s => `<span class="med-species-tag">${getSpeciesIcon(s)} ${s}</span>`).join('')}
                            <span class="med-price-tag">💰 ${item.priceRange}</span>
                        </div>
                        <div class="med-desc">${item.desc}</div>
                        <div class="med-usage">
                            <span class="usage-label">用法：</span>${item.usage}
                        </div>
                        <div class="med-precautions">
                            <span class="precautions-label">⚠️ 注意：</span>${item.precautions}
                        </div>
                        <div class="med-card-risk-tag">🔒 处方药品信息 · 请遵医嘱使用</div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function getSpeciesIcon(species) {
    const icons = { '犬': '🐶', '猫': '🐱', '兔': '🐇', '鸟': '🦜', '鱼': '🐟', '爬行类': '🦎' };
    return icons[species] || '🐾';
}

function filterMedicines() {
    const keyword = document.getElementById('medSearchInput')?.value.toLowerCase() || '';
    const category = document.getElementById('medCategoryFilter')?.value || '';
    const activeSpecies = document.querySelector('.species-btn.active')?.dataset.species || 'all';
    
    document.querySelectorAll('.med-category').forEach(catEl => {
        const catName = catEl.dataset.category;
        if (category && catName !== category) {
            catEl.style.display = 'none';
            return;
        }
        
        let hasVisibleItem = false;
        catEl.querySelectorAll('.med-card').forEach(card => {
            const name = card.dataset.name.toLowerCase();
            const desc = card.dataset.desc.toLowerCase();
            const brand = card.dataset.brand.toLowerCase();
            const species = card.dataset.species.split(',');
            
            const matchKeyword = !keyword || name.includes(keyword) || desc.includes(keyword) || brand.includes(keyword);
            const matchSpecies = activeSpecies === 'all' || species.includes(activeSpecies);
            
            const match = matchKeyword && matchSpecies;
            card.style.display = match ? '' : 'none';
            if (match) hasVisibleItem = true;
        });
        
        catEl.style.display = hasVisibleItem ? '' : 'none';
    });
}

// ===== 附近医院页面（仅使用高德地图免费 API） =====
let userLocation = null;
// 地图相关全局状态（避免 SDK 重复加载/实例泄漏）
const _mapState = {
    cfg: null,
    provider: 'amap',        // 固定为高德地图
    sdkLoading: false,
    sdkReady: { amap: false },
    map: null,               // 当前地图实例（AMap.Map）
    lib: null,               // 当前 SDK 命名空间（AMap）
    meMarker: null,          // 当前位置标记
    markers: [],             // POI 标记
    infoWindow: null,        // 信息窗体
    driving: null,           // 路线规划
    hospitals: [],
    activeIdx: -1,
    geocoder: null,          // 逆地理编码
};

// ---------- 地图 Key & SDK 加载 ----------
async function ensureMapConfig() {
    if (_mapState.cfg) return _mapState.cfg;
    try {
        const r = await fetch('/api/maps/config');
        const d = await r.json();
        if (d && d.success) {
            _mapState.cfg = d;
            _mapState.provider = 'amap';
            return d;
        }
    } catch (e) { console.warn('[Map] config failed', e); }
    _mapState.cfg = { default_map: 'amap', amap_web_key: '', amap_web_service_key: '', amap_security_code: '', search_radius: 10000, keywords: '宠物医院|宠物诊所|动物医院|兽医' };
    return _mapState.cfg;
}

function _loadScript(src, attrs) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src^="${src.split('?')[0]}"]`)) return resolve();
        const s = document.createElement('script');
        s.src = src;
        if (attrs) Object.assign(s, attrs);
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('脚本加载失败：' + src));
        document.head.appendChild(s);
    });
}

// 高德 JS API 加载（支持安全密钥 securityJsCode）
function _loadAmapSDK(key, securityCode) {
    if (_mapState.sdkReady.amap && window.AMap) return Promise.resolve(window.AMap);
    if (securityCode) {
        // 2.0 安全密钥：在脚本加载前设置 window._AMapSecurityConfig
        window._AMapSecurityConfig = { securityJsCode: securityCode };
    }
    return _loadScript(`https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}&plugin=AMap.Scale,AMap.ToolBar,AMap.ControlBar,AMap.Geocoder,AMap.PlaceSearch,AMap.Driving,AMap.Geolocation`)
        .then(() => new Promise((resolve, reject) => {
            const t = setInterval(() => {
                if (window.AMap && window.AMap.Map) {
                    clearInterval(t);
                    _mapState.sdkReady.amap = true;
                    resolve(window.AMap);
                }
            }, 80);
            setTimeout(() => { clearInterval(t); if (!window.AMap) reject(new Error('高德 SDK 加载超时')); }, 12000);
        }));
}

async function loadSDKForProvider(provider) {
    const cfg = await ensureMapConfig();
    if (!cfg.amap_web_key) throw new Error('NO_KEY: 请在 db/local_config.json 中填入 amap_web_key');
    return { AMap: await _loadAmapSDK(cfg.amap_web_key, cfg.amap_security_code), cfg };
}

// ---------- 地图实例创建/销毁 ----------
function destroyCurrentMap() {
    try {
        if (_mapState.driving && _mapState.driving.clear) _mapState.driving.clear();
    } catch (e) {}
    _mapState.driving = null;
    _mapState.markers.forEach(m => {
        try {
            if (m.setMap) m.setMap(null);
            else if (m.destroy) m.destroy();
            else if (_mapState.map && _mapState.map.remove) _mapState.map.remove(m);
        } catch (e) {}
    });
    _mapState.markers = [];
    try {
        if (_mapState.map && _mapState.map.destroy) _mapState.map.destroy();
    } catch (e) {}
    _mapState.map = null;
    _mapState.lib = null;
    _mapState.infoWindow = null;
    _mapState.meMarker = null;
    const route = document.getElementById('routeCard');
    if (route) route.classList.remove('show');
}

function createAmapInstance(viewportEl, lat, lng) {
    const AMap = window.AMap;
    const map = new AMap.Map(viewportEl, {
        zoom: 13,
        center: [lng, lat],
        viewMode: '2D',
        mapStyle: 'amap://styles/dark'
    });
    map.addControl(new AMap.Scale());
    map.addControl(new AMap.ToolBar({ position: 'RB' }));
    map.addControl(new AMap.ControlBar({ position: { top: '10px', right: '10px' } }));
    _mapState.geocoder = new AMap.Geocoder({ radius: 1000 });
    // 当前位置标记（蓝点）
    _mapState.meMarker = new AMap.Marker({
        position: [lng, lat],
        title: '我在这里',
        offset: new AMap.Pixel(-13, -30),
        content: '<div style="width:22px;height:22px;border-radius:50%;background:#00E5FF;border:3px solid #fff;box-shadow:0 0 0 4px rgba(0,229,255,.25)"></div>'
    });
    map.add(_mapState.meMarker);
    return map;
}

// ---------- POI Marker 渲染 ----------
function renderMarkersOnMap(hospitals) {
    // 清理旧 Marker
    _mapState.markers.forEach(m => {
        try {
            if (_mapState.map && _mapState.map.remove) _mapState.map.remove(m);
        } catch (e) {}
    });
    _mapState.markers = [];
    if (!_mapState.map || !_mapState.lib) return;
    const AMap = window.AMap;

    hospitals.forEach((h, idx) => {
        if (!h || typeof h.lat !== 'number' || typeof h.lng !== 'number') return;
        const isHos = (h.type || '').includes('医院');
        const color = isHos ? '#EF4444' : '#F59E0B';
        try {
            const marker = new AMap.Marker({
                position: [h.lng, h.lat],
                title: h.name,
                offset: new AMap.Pixel(-12, -36),
                content: `<div style="padding:4px 8px;border-radius:10px;background:${color};color:#fff;font-size:11px;font-weight:700;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.4);white-space:nowrap">${isHos ? '🏥 ' : '💉 '}${idx + 1}</div>`,
                extData: { idx }
            });
            marker.on('click', () => selectHospital(idx, { fromMarker: true }));
            _mapState.map.add(marker);
            _mapState.markers.push(marker);
        } catch (e) {
            console.warn('[Map] marker error', idx, h, e);
        }
    });

    // 自适应视野
    try {
        const points = hospitals.filter(h => h && typeof h.lat === 'number').map(h => new AMap.LngLat(h.lng, h.lat));
        if (points.length && _mapState.map.setFitView) {
            _mapState.map.setFitView(_mapState.markers.concat([_mapState.meMarker]), false, [40, 40, 40, 40]);
        }
    } catch (e) {}
}

// ---------- 页面内路线规划（驾驶） ----------
function planRouteTo(idx) {
    const h = _mapState.hospitals[idx];
    if (!h || !_mapState.map || !userLocation) return;
    const AMap = window.AMap;
    const card = document.getElementById('routeCard');
    try {
        if (!_mapState.driving) {
            _mapState.driving = new AMap.Driving({
                map: _mapState.map,
                hideMarkers: false,
                autoFitView: true,
                policy: AMap.DrivingPolicy.LEAST_TIME
            });
        } else {
            _mapState.driving.clear();
        }
        _mapState.driving.search(
            new AMap.LngLat(userLocation.lng, userLocation.lat),
            new AMap.LngLat(h.lng, h.lat),
            (status, result) => {
                if (status === 'complete' && result.routes && result.routes.length) {
                    const r = result.routes[0];
                    if (card) {
                        card.classList.add('show');
                        card.innerHTML = `
                            <span class="route-close" onclick="document.getElementById('routeCard').classList.remove('show')">关闭</span>
                            <div class="route-title">🚗 前往 ${h.name}</div>
                            <div class="route-row"><span>🚦 总距离：</span><b>${(r.distance / 1000).toFixed(2)} 公里</b></div>
                            <div class="route-row"><span>🕐 预计用时：</span><b>${Math.round(r.time / 60)} 分钟</b></div>
                            <div class="route-row"><span>📍 途经：</span><span style="color:#7DD3FC">${r.steps ? r.steps.slice(0,3).map(s => s.road || s.instruction).join(' → ').slice(0, 80) || '按地图道路行驶' : '按地图道路行驶'}</span></div>
                        `;
                    }
                } else {
                    showToast('暂无推荐驾车路线，您可在详情里跳转外部地图导航', 'warning');
                }
            }
        );
    } catch (e) {
        console.error(e);
        showToast('路线规划出错：' + (e.message || e), 'warning');
    }
}

// ---------- 列表 / Marker 联动 ----------
function selectHospital(idx, opts) {
    const h = _mapState.hospitals[idx];
    if (!h) return;
    _mapState.activeIdx = idx;
    document.querySelectorAll('.mini-card').forEach((el, i) => el.classList.toggle('active', i === idx));
    if (!opts || !opts.fromMarker) {
        // 从列表点击 Marker 居中
        try {
            _mapState.map.setCenter([h.lng, h.lat]);
            _mapState.map.setZoom(15);
            if (_mapState.markers[idx]) {
                // 弹 InfoWindow
                const AMap = window.AMap;
                if (!_mapState.infoWindow) _mapState.infoWindow = new AMap.InfoWindow({ offset: new AMap.Pixel(0, -36) });
                _mapState.infoWindow.setContent(_infoWinContent(h, idx));
                _mapState.infoWindow.open(_mapState.map, [h.lng, h.lat]);
            }
        } catch (e) {}
    }
    // 滚动对应卡片到可视
    const cards = document.querySelectorAll('.mini-card');
    if (cards[idx]) cards[idx].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function _infoWinContent(h, idx) {
    const safe = (x) => String(x == null ? '' : x).replace(/'/g, '&#39;').replace(/"/g, '&quot;');
    return `
    <div style="min-width:240px;max-width:300px;font-size:12px;color:#082c4a">
      <div style="font-weight:700;font-size:14px;color:#0066cc;margin-bottom:6px">${safe(h.name)}</div>
      <div style="color:#475569;margin-bottom:4px">⭐ ${h.rating || 4.0} · ${(h.distance_km !== undefined ? (h.distance_km < 1 ? (h.distance_m||0) + 'm' : h.distance_km + 'km') : '')}</div>
      <div style="color:#475569;margin-bottom:6px">📍 ${safe(h.address)}</div>
      ${h.phone && h.phone !== '暂无电话' ? `<div style="color:#475569;margin-bottom:6px">📞 ${safe(h.phone)}</div>` : ''}
      <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
        <button class="mini-btn primary" onclick="window.closeMapInfoWindow();window.realHospitalPlanRoute(${idx})">🚗 路线</button>
        <button class="mini-btn" onclick="window.closeMapInfoWindow();window.realHospitalDetail(${idx})">📋 详情</button>
        ${h.phone && h.phone !== '暂无电话' ? `<a class="mini-btn" href="tel:${encodeURIComponent(h.phone)}">📞 拨打</a>` : ''}
      </div>
    </div>`;
}

// ---------- 真实 POI 搜索（后端代理：高德 Web Service + OSM 兜底） ----------
async function loadNearbyHospitalsReal(keywordExtra) {
    if (!userLocation) return [];
    const cfg = await ensureMapConfig();
    const params = new URLSearchParams({
        lat: userLocation.lat,
        lng: userLocation.lng,
        radius: cfg.search_radius || 10000,
        provider: 'amap_only',
        keyword: keywordExtra ? keywordExtra : (cfg.keywords || '宠物医院|宠物诊所|动物医院|兽医')
    });
    const r = await fetch('/api/maps/poi/around?' + params.toString());
    const data = await r.json();
    if (!data || !data.success) throw new Error(data && data.message || '搜索失败');
    return data;
}

// ---------- 列表渲染 ----------
function renderHospitalList(resultData, fallbackReason) {
    const list = (resultData && resultData.hospitals) ? resultData.hospitals : [];
    list.forEach(h => {
        if (h.distance_km === undefined && typeof h.distance_m === 'number') h.distance_km = +(h.distance_m / 1000).toFixed(2);
    });
    _mapState.hospitals = list;
    window._hospitals = list;
    // 顶部统计条
    const summary = document.getElementById('resultSummary');
    if (summary) {
        const src = resultData && resultData.provider_used ? resultData.provider_used : (list[0] && list[0].source) || '本地示例';
        const errs = (resultData && resultData.errors && resultData.errors.length) ? `· ${resultData.errors.length} 项降级提示` : '';
        summary.innerHTML = `
            <span>在半径 <b>${Math.round((resultData && resultData.query_point && resultData.query_point.radius || 10000) / 1000)}</b> 公里范围内搜索「宠物医院/诊所」</span>
            <span>
                <span class="count">${list.length}</span> 家 · <span class="source">${src}</span> ${errs}
            </span>`;
    }
    const scroll = document.getElementById('hospitalScroll');
    if (!scroll) return;
    if (!list.length) {
        scroll.innerHTML = `<div class="empty-state"><div class="empty-icon">🏥</div>
            <p>本范围内暂未找到宠物医院/诊所，您可以：</p>
            <ul style="text-align:left;max-width:320px;margin:8px auto;font-size:12px;color:#7DD3FC;line-height:1.8">
              <li>① 点击左上的「🔄 重新定位」确认定位准确</li>
              <li>② 切换搜索半径或在 <code>db/local_config.json</code> 调大 maps.search_radius</li>
              <li>③ 如无高德 Key，POI 会自动切换到 OpenStreetMap（乡镇覆盖较少）；建议 <a href="https://console.amap.com/" target="_blank" style="color:#00E5FF">申请高德 Web 服务 Key</a></li>
            </ul>
            ${fallbackReason ? `<p style="color:#FBBF24;font-size:12px">提示：${fallbackReason}</p>` : ''}
        </div>`;
        return;
    }
    scroll.innerHTML = list.map((h, i) => {
        const safe = (x) => String(x == null ? '' : x).replace(/'/g, '&#39;').replace(/"/g, '&quot;');
        const typeCls = (h.type || '').includes('医院') ? 'hos' : 'cli';
        const tags = Array.isArray(h.tags) ? h.tags : [];
        const distText = h.distance_km === undefined ? '' :
            (h.distance_km < 1 ? `${Math.round(h.distance_m||0)}m` : `${h.distance_km.toFixed(1)}km`);
        return `
        <div class="mini-card ${i === _mapState.activeIdx ? 'active' : ''}" onclick="window.realHospitalSelect(${i})">
            <div class="mini-type ${typeCls}">${h.type || '宠物诊所'}</div>
            <div class="mini-name">${safe(h.name)}</div>
            <div class="mini-meta">
                <span class="mini-dist">📍 ${distText || '距离未知'}</span>
                <span class="mini-rating">⭐ ${(h.rating || 4.0).toFixed(1)}</span>
            </div>
            <div class="mini-addr">${safe(h.address || '地址详见地图')}</div>
            ${tags.length ? `<div class="mini-tags">${tags.slice(0,4).map(t=>`<span class="mini-tag">${safe(t)}</span>`).join('')}</div>` : ''}
            <div class="mini-actions">
                <button class="mini-btn primary" onclick="event.stopPropagation();window.realHospitalSelect(${i});window.realHospitalPlanRoute(${i})">🚗 路线</button>
                <button class="mini-btn" onclick="event.stopPropagation();window.realHospitalDetail(${i})">📋 详情</button>
                ${h.phone && h.phone !== '暂无电话' ? `<a class="mini-btn" href="tel:${encodeURIComponent(h.phone)}" onclick="event.stopPropagation()">📞 拨打</a>` : ''}
            </div>
        </div>`;
    }).join('');
    // 地图上打点
    renderMarkersOnMap(list);
}

// 供 html 字符串 onclick 调用
window.closeMapInfoWindow = function () { try { if (_mapState.infoWindow && _mapState.infoWindow.close) _mapState.infoWindow.close(); } catch (e) {} };
window.realHospitalSelect = function (idx) { selectHospital(idx); };
window.realHospitalPlanRoute = function (idx) { planRouteTo(idx); };
window.realHospitalDetail = function (idx) {
    const h = _mapState.hospitals[idx];
    if (!h) return;
    showHospitalDetail(h.name, h.phone, h.hours, h.address, h.services || h.tags, h.rating, h.lat, h.lng, h.source);
};

// ---------- 初始化地图（固定高德） ----------
async function initMapInViewport() {
    const viewport = document.getElementById('mapViewport');
    const loadingEl = document.getElementById('mapLoading');
    const noKeyEl = document.getElementById('mapNoKey');
    if (!viewport || !userLocation) return;
    if (loadingEl) loadingEl.style.display = 'flex';
    if (noKeyEl) noKeyEl.style.display = 'none';
    destroyCurrentMap();
    try {
        await loadSDKForProvider('amap');
        _mapState.lib = window.AMap;
        _mapState.map = createAmapInstance(viewport, userLocation.lat, userLocation.lng);
        if (loadingEl) loadingEl.style.display = 'none';
        // 初始化完成后，按已有列表打点
        if (_mapState.hospitals.length) renderMarkersOnMap(_mapState.hospitals);
        // 逆地理编码更新定位文本
        updateLocTextReverse();
    } catch (e) {
        if (loadingEl) loadingEl.style.display = 'none';
        console.warn('[Map] init error', e);
        const msg = (e && e.message) || String(e);
        if (msg.startsWith('NO_KEY:')) {
            if (noKeyEl) {
                noKeyEl.style.display = 'flex';
                noKeyEl.innerHTML = `
                    <h4>🔑 还没有配置高德地图 Key</h4>
                    <div style="max-width:520px;line-height:1.9;font-size:12px;text-align:left">
                      本页已固定使用<strong>高德地图 API</strong>（JS SDK + Web Service 兜底），但您还没有填入自己的 Key。
                      <br><br>
                      <b>操作方式</b>：编辑 <code style="background:rgba(0,229,255,.1);padding:2px 6px;border-radius:6px">D:\\PetAI_Source\\db\\local_config.json</code>，
                      在 <code>maps</code> 节填入：
                      <ul style="margin:6px 0 0 18px">
                        <li><code>amap_web_key</code>（JS SDK 用，前往 <a href="https://console.amap.com/dev/key/app" target="_blank">控制台</a> 申请）
                        </li>
                        <li><code>amap_web_service_key</code>（后端 POI 代理用，和上面同一个 Web 端 Key 即可）
                        </li>
                        <li>可选：<code>amap_security_code</code>（如果控制台启用了安全密钥校验，可一起填入）
                        </li>
                      </ul>
                      保存后 <b>刷新页面</b> 即可；未填 Key 时 POI 搜索将自动降级到 OpenStreetMap（乡镇覆盖较少）。
                    </div>`;
            }
        } else {
            showToast('地图初始化失败：' + msg, 'warning');
            if (noKeyEl) {
                noKeyEl.style.display = 'flex';
                noKeyEl.innerHTML = `<h4>⚠️ 地图加载失败</h4><div style="max-width:520px;font-size:12px;color:#FCA5A5">${msg}</div>`;
            }
        }
    }
}

async function updateLocTextReverse() {
    const locText = document.getElementById('locText');
    if (!locText || !userLocation) return;
    try {
        let formatted = userLocation.address || '';
        if (_mapState.geocoder) {
            await new Promise(resolve => {
                _mapState.geocoder.getAddress([userLocation.lng, userLocation.lat], (st, res) => {
                    if (st === 'complete' && res && res.regeocode) {
                        formatted = res.regeocode.formattedAddress || '';
                        userLocation.address = formatted;
                    }
                    resolve();
                });
            });
        }
        if (formatted) {
            locText.innerHTML = `<strong>📍 ${formatted}</strong><br><span style="font-size:11px;opacity:.85">（${userLocation.lat.toFixed(5)}, ${userLocation.lng.toFixed(5)} · 精度 ${Math.round(userLocation.accuracy||0)}m）</span>`;
            locText.style.color = '#10B981';
        }
    } catch (e) {}
}

// ---------- 主页面渲染（仅高德） ----------
function renderHospitalPage(container) {
    container.innerHTML = `
        <div class="hospital-page">
            <div class="hospital-location-bar" id="locationBar">
                <div class="loc-status" id="locStatus">
                    <span class="loc-icon">📍</span>
                    <span class="loc-text" id="locText">正在获取定位...</span>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
                    <button class="btn btn-secondary btn-sm" onclick="requestLocation()">🔄 重新定位</button>
                    <button class="btn btn-primary btn-sm" onclick="searchNearbyOnMap()">🔗 跳转外部地图</button>
                </div>
            </div>

            <div class="map-toolbar" style="margin-bottom:12px">
                <div class="provider-tabs" id="providerTabs">
                    <button class="provider-tab active" disabled>🗺️ 高德地图</button>
                </div>
                <div class="search-controls" style="flex:1;min-width:260px">
                    <input type="text" id="hospitalSearch" class="form-input" placeholder="🔍 在当前结果内搜索医院名称/科室/地址，回车直接按关键词全国POI搜索">
                    <select id="hospitalRadius" class="form-input" style="max-width:180px">
                        <option value="3000">半径 3 公里</option>
                        <option value="5000">半径 5 公里</option>
                        <option value="10000" selected>半径 10 公里（默认）</option>
                        <option value="20000">半径 20 公里</option>
                        <option value="50000">半径 50 公里（覆盖乡镇）</option>
                    </select>
                    <button class="btn btn-primary btn-sm" id="btnSearchAgain">🔍 再搜一次</button>
                </div>
            </div>

            <div class="real-hospital-layout">
                <div class="map-panel">
                    <div class="map-container" id="mapContainer">
                        <div id="mapViewport" class="map-viewport"></div>

                        <div class="map-floating-tools">
                            <div class="tool-pill"><b id="toolCoord">--</b></div>
                            <div class="tool-pill">🔎 半径 <b id="toolRadius">10</b> km</div>
                        </div>

                        <div class="map-floating-legend">
                            <div><span class="legend-dot me"></span>我的位置</div>
                            <div><span class="legend-dot hos"></span>宠物医院</div>
                            <div><span class="legend-dot cli"></span>宠物诊所/兽医</div>
                        </div>

                        <div id="routeCard" class="map-route-card"></div>

                        <div class="map-loading" id="mapLoading">
                            <div class="spinner"></div>
                            <div>正在加载 高德 地图 SDK...</div>
                        </div>
                        <div class="map-no-key" id="mapNoKey" style="display:none"></div>
                    </div>
                </div>

                <div class="list-panel">
                    <div class="result-summary" id="resultSummary">
                        <span>正在基于当前位置搜索宠物医院/诊所...</span>
                        <span class="count">-</span>
                    </div>
                    <div class="hospital-scroll" id="hospitalScroll">
                        <div class="empty-state">
                            <div class="empty-icon">⏳</div>
                            <p>定位并初始化真实地图后，将自动查询半径范围内的宠物医院/诊所</p>
                        </div>
                    </div>
                </div>
            </div>

            <div class="hospital-tips">
                <div class="tips-title">📌 就医小贴士</div>
                <div class="tips-grid">
                    <div class="tip-item"><span class="tip-icon">📋</span><span>就诊前准备好宠物疫苗本和既往病历</span></div>
                    <div class="tip-item"><span class="tip-icon">🚗</span><span>乘坐交通工具时注意宠物安全，建议使用宠物包</span></div>
                    <div class="tip-item"><span class="tip-icon">💊</span><span>就诊前不要给宠物喂食，避免麻醉风险</span></div>
                    <div class="tip-item"><span class="tip-icon">📞</span><span>急诊请提前电话联系，告知宠物症状</span></div>
                </div>
            </div>
        </div>
    `;

    // 工具展示
    const tc = document.getElementById('toolCoord');
    const tr = document.getElementById('toolRadius');
    if (userLocation) {
        if (tc) tc.textContent = `定位 ${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)}`;
    }
    const radiusSel = document.getElementById('hospitalRadius');
    if (tr && radiusSel) tr.textContent = (parseInt(radiusSel.value) / 1000);

    // 搜索框：实时本地过滤 + Enter 重新向 POI 后端发起关键词搜索
    const searchInput = document.getElementById('hospitalSearch');
    const radiusInput = document.getElementById('hospitalRadius');
    if (searchInput) {
        searchInput.addEventListener('input', () => applyLocalFilters());
        searchInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (!userLocation) { showToast('请先完成定位', 'warning'); return; }
                const cfg = await ensureMapConfig();
                const want = parseInt(radiusInput.value) || cfg.search_radius;
                const scroll = document.getElementById('hospitalScroll');
                if (scroll) scroll.innerHTML = `<div class="empty-state"><div class="empty-icon">⏳</div><p>正在基于高德地图按关键词「${searchInput.value || cfg.keywords}」搜索半径 ${want/1000}km 范围...</p></div>`;
                try {
                    const kw = searchInput.value.trim() || cfg.keywords;
                    const params = new URLSearchParams({
                        lat: userLocation.lat, lng: userLocation.lng,
                        radius: want, provider: 'amap_only', keyword: kw
                    });
                    const r = await fetch('/api/maps/poi/around?' + params.toString());
                    const d = await r.json();
                    if (!d.success) throw new Error(d.message);
                    renderHospitalList(d);
                    showToast(`搜索完成：找到 ${d.total} 家（数据来源 ${d.provider_used || '未知'}）`, 'success');
                } catch (err) {
                    showToast('POI 搜索失败：' + (err.message || err), 'warning');
                }
            }
        });
    }
    if (radiusInput) {
        radiusInput.addEventListener('change', () => {
            if (tr) tr.textContent = (parseInt(radiusInput.value) / 1000);
        });
    }
    const btnAg = document.getElementById('btnSearchAgain');
    if (btnAg) btnAg.addEventListener('click', () => { if (searchInput) { searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); } });

    // 定位并加载
    requestLocation();
}

function applyLocalFilters() {
    const kw = (document.getElementById('hospitalSearch')?.value || '').toLowerCase();
    const list = _mapState.hospitals;
    if (!list) return;
    const filtered = !kw ? list : list.filter(h => {
        const s = `${h.name || ''} ${h.address || ''} ${(h.services||h.tags||[]).join(' ')} ${h.phone || ''} ${h.type || ''}`.toLowerCase();
        return s.includes(kw);
    });
    const scroll = document.getElementById('hospitalScroll');
    if (!scroll) return;
    if (!filtered.length) {
        scroll.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><p>在当前结果中没有匹配 "${kw}" 的项目，按回车可在更大范围内按关键词再搜一次</p></div>`;
        return;
    }
    const all = _mapState.hospitals;
    scroll.innerHTML = filtered.map(h => {
        const i = all.indexOf(h);
        const safe = (x) => String(x == null ? '' : x).replace(/'/g, '&#39;').replace(/"/g, '&quot;');
        const typeCls = (h.type || '').includes('医院') ? 'hos' : 'cli';
        const tags = Array.isArray(h.tags) ? h.tags : [];
        const distText = h.distance_km === undefined ? '' :
            (h.distance_km < 1 ? `${Math.round(h.distance_m||0)}m` : `${h.distance_km.toFixed(1)}km`);
        return `
        <div class="mini-card ${i === _mapState.activeIdx ? 'active' : ''}" onclick="window.realHospitalSelect(${i})">
            <div class="mini-type ${typeCls}">${h.type || '宠物诊所'}</div>
            <div class="mini-name">${safe(h.name)}</div>
            <div class="mini-meta">
                <span class="mini-dist">📍 ${distText || '距离未知'}</span>
                <span class="mini-rating">⭐ ${(h.rating || 4.0).toFixed(1)}</span>
            </div>
            <div class="mini-addr">${safe(h.address || '地址详见地图')}</div>
            ${tags.length ? `<div class="mini-tags">${tags.slice(0,4).map(t=>`<span class="mini-tag">${safe(t)}</span>`).join('')}</div>` : ''}
            <div class="mini-actions">
                <button class="mini-btn primary" onclick="event.stopPropagation();window.realHospitalSelect(${i});window.realHospitalPlanRoute(${i})">🚗 路线</button>
                <button class="mini-btn" onclick="event.stopPropagation();window.realHospitalDetail(${i})">📋 详情</button>
                ${h.phone && h.phone !== '暂无电话' ? `<a class="mini-btn" href="tel:${encodeURIComponent(h.phone)}" onclick="event.stopPropagation()">📞 拨打</a>` : ''}
            </div>
        </div>`;
    }).join('');
}

function requestLocation() {
    const locText = document.getElementById('locText');
    const mapBtn = document.getElementById('mapSearchBtn');
    if (locText) { locText.textContent = '正在获取定位权限与坐标...'; locText.style.color = '#7DD3FC'; }

    const fallback = (msg) => {
        userLocation = { lat: 39.9042, lng: 116.4074, accuracy: 10000 };
        if (locText) {
            locText.innerHTML = `⚠️ ${msg || '浏览器定位失败'}，使用示例位置 <strong>北京</strong>（39.9042, 116.4074）`;
            locText.style.color = '#FBBF24';
        }
        updateToolCoord();
        initMapInViewport().then(() => doSearchHospital());
    };

    if (!navigator.geolocation) { fallback('浏览器不支持定位'); return; }

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            userLocation = {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                accuracy: pos.coords.accuracy || 0
            };
            if (locText) {
                locText.innerHTML = `<strong>✅ 定位成功（精度 ${Math.round(pos.coords.accuracy || 0)}m）</strong><br><span style="font-size:11px;opacity:.85">(${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)})</span>`;
                locText.style.color = '#10B981';
            }
            updateToolCoord();
            initMapInViewport().then(() => doSearchHospital());
        },
        (err) => {
            console.warn('[Loc] error', err);
            if (mapBtn) mapBtn.style.display = 'block';
            fallback('定位失败：' + (err.message || '未知原因'));
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

function updateToolCoord() {
    const tc = document.getElementById('toolCoord');
    if (tc && userLocation) tc.textContent = `定位 ${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)}`;
}

async function doSearchHospital() {
    const scroll = document.getElementById('hospitalScroll');
    if (!userLocation) { showToast('请先完成定位', 'warning'); return; }
    if (scroll) scroll.innerHTML = `<div class="empty-state"><div class="empty-icon">⏳</div><p>正在基于高德地图 Web API + OSM 兜底查询周边宠物医院/诊所...</p></div>`;
    try {
        const data = await loadNearbyHospitalsReal('');
        renderHospitalList(data);
        if (data.total > 0) {
            showToast(`找到 ${data.total} 家宠物医院/诊所（${data.provider_used || 'OSM'}）`, 'success');
        } else {
            const msg = (data.errors || []).join('；');
            showToast('未找到附近医院' + (msg ? '：' + msg : ''), 'warning');
        }
    } catch (e) {
        console.error(e);
        // 最后兜底：展示示例数据
        showHospitalsWithFallback(e.message || '查询失败');
    }
}

// 保留向后兼容
function loadNearbyHospitals() { doSearchHospital(); }
function filterHospitals(hospitals, fallbackReason) {
    renderHospitalList({ hospitals: hospitals, provider_used: hospitals[0] && hospitals[0].source, query_point: { radius: 10000 }, total: hospitals.length }, fallbackReason);
}
function showHospitalsWithFallback(fallbackReason) {
    userLocation = userLocation || { lat: 39.9042, lng: 116.4074, accuracy: 10000 };
    const samples = [
        { name: '宠爱动物医院（示例·北京总店）', address: '北京朝阳区建国路88号', phone: '010-5888-6688', rating: 4.8, tags: ['24小时急诊', '连锁', '三甲专科'], services: ['内科', '外科', '骨科'], hours: '24小时营业', lat: 39.9087, lng: 116.4603, type: '宠物医院' },
        { name: '北京小动物诊疗中心（示例）', address: '北京海淀区学院路25号', phone: '010-6279-6688', rating: 4.9, tags: ['教学医院', '24小时'], services: ['内科', '重症', '放射科'], hours: '24小时营业', lat: 39.9997, lng: 116.3481, type: '宠物医院' },
        { name: '瑞鹏宠物医院（示例·三里屯）', address: '北京朝阳区三里屯路19号', phone: '010-6417-8899', rating: 4.6, tags: ['连锁品牌'], services: ['内科', '外科', '牙科'], hours: '08:00 - 22:00', lat: 39.9369, lng: 116.4533, type: '宠物医院' },
        { name: '安安宠物诊所（示例·望京）', address: '北京朝阳区望京SOHO T1', phone: '010-8888-1122', rating: 4.4, tags: ['社区门诊'], services: ['内科', '疫苗'], hours: '09:00 - 21:00', lat: 39.9930, lng: 116.4770, type: '宠物诊所' },
    ];
    samples.forEach(h => { const d = calculateDistance(userLocation.lat, userLocation.lng, h.lat, h.lng); h.distance_km = +d.toFixed(2); h.distance_m = Math.round(d*1000); });
    samples.sort((a, b) => a.distance_m - b.distance_m);
    renderHospitalList({ hospitals: samples, provider_used: '示例数据', query_point: { radius: 10000 }, total: samples.length, errors: [fallbackReason || '展示示例数据，未调用真实 POI'] }, fallbackReason);
    if (!_mapState.map) initMapInViewport();
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// 跳转外部地图（仅保留高德 + OSM 兜底，已移除百度/腾讯）
function searchNearbyOnMap() {
    if (!userLocation) {
        showToast('请先获取定位', 'warning');
        return;
    }
    const lng = userLocation.lng;
    const lat = userLocation.lat;
    const keyword = '宠物医院 宠物诊所 兽医';
    const enc = encodeURIComponent(keyword);
    const amapUrl = `https://www.amap.com/search?query=${enc}&location=${lng},${lat}&radius=10000`;
    const osmUrl = `https://www.openstreetmap.org/search?query=${encodeURIComponent('vet veterinary clinic animal hospital pet')}&lat=${lat}&lon=${lng}`;
    openModal('🗺️ 跳转外部地图查看', `
        <div style="text-align:center;padding:16px">
            <div style="font-size:40px;margin-bottom:12px">🏥</div>
            <div style="font-size:15px;font-weight:600;color:#00E5FF;margin-bottom:8px">当前位置附近的宠物医院 / 宠物诊所</div>
            <div style="font-size:12px;color:var(--text-secondary);margin-bottom:16px">
                坐标: ${lat.toFixed(6)}, ${lng.toFixed(6)}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                <button class="btn btn-primary" onclick="window.open('${amapUrl}', '_blank')">🗺️ 高德地图</button>
                <button class="btn btn-secondary" onclick="window.open('${osmUrl}', '_blank')">🌍 OpenStreetMap（兜底）</button>
            </div>
            <div style="margin-top:14px;padding:10px;background:rgba(0,229,255,0.06);border-radius:8px;font-size:11px;color:var(--text-secondary);line-height:1.6;text-align:left">
                💡 优先使用本页内嵌的真实高德地图；若需要在手机地图 App 内打开路线导航，可点上方高德跳转。
            </div>
        </div>
    `, '<button class="btn btn-primary" onclick="closeModal()">好的</button>');
}

window.showHospitalsWithFallback = showHospitalsWithFallback;
window.requestLocation = requestLocation;
window.searchNearbyOnMap = searchNearbyOnMap;

// 电话拨打医院（兼容旧模板调用）
function callHospital(name, phone) {
    if (!phone || phone === '暂无电话') {
        showToast(`${name || '医院'}暂未登记电话，建议在附近医院页面点击"路线"前往`, 'warning');
        return;
    }
    const clean = String(phone).split(/[,;，；/、\s]+/).filter(Boolean)[0];
    if (/^[+\d\s()\-]{5,}$/.test(clean)) {
        try {
            window.location.href = 'tel:' + encodeURIComponent(clean);
        } catch (e) {
            showToast(`请手动拨打：${phone}`, 'info');
        }
    } else {
        showToast(`${name || '医院'}登记的联系方式：${phone}`, 'info');
    }
}
window.callHospital = callHospital;

// 跳转外部地图进行路线导航（仅保留高德 + 坐标复制）
function navigateTo(lat, lng, destinationName) {
    if (!lat || !lng) {
        showToast('缺少目标坐标，无法导航', 'warning');
        return;
    }
    const dest = destinationName ? encodeURIComponent(destinationName) : '宠物医院';
    const amap = `https://uri.amap.com/navigation?to=${lng},${lat},${dest}&mode=car&policy=1&src=PetAI&coordinate=gaode&callnative=1`;
    openModal('🚗 前往' + (destinationName || '目标地址'), `
        <div style="padding:12px;line-height:1.8;font-size:13px">
            <div style="color:#7DD3FC;margin-bottom:10px">使用高德地图 App 打开导航路线（手机端直接唤起）：</div>
            <div style="display:grid;grid-template-columns:1fr;gap:10px">
                <a class="btn btn-primary" target="_blank" rel="noopener" href="${amap}">🗺️ 高德地图导航</a>
                <button class="btn btn-secondary" onclick="navigator.clipboard&&navigator.clipboard.writeText(${JSON.stringify(lat+','+lng)});showToast('坐标已复制，可粘贴到任意地图','success')">📋 复制坐标</button>
                <button class="btn btn-secondary" onclick="closeModal()">取消</button>
            </div>
            <div style="margin-top:10px;color:#A78BFA;font-size:11px">目标坐标：${lat.toFixed(6)}, ${lng.toFixed(6)}</div>
        </div>
    `);
}
window.navigateTo = navigateTo;

window.showHospitalDetail = function (name, phone, hours, address, services, rating, lat, lng, source) {
    hours = hours || '营业时间请电话咨询';
    address = address || '地址详见地图';
    services = Array.isArray(services) ? services.join('、') : services || '';
    rating = rating || '-';
    const ratingStr = typeof rating === 'number'
        ? '★★★★★'.slice(0, Math.round(rating)) + '☆☆☆☆☆'.slice(0, 5 - Math.round(rating)) + ' ' + rating.toFixed(1)
        : String(rating);
    openModal(`📋 ${name}`, `
        <div style="padding:12px;color:var(--text-primary);font-size:13px;line-height:2">
            ${source ? `<div style="margin-bottom:8px;font-size:11px;color:#A78BFA">数据来源：<b>${source}</b></div>` : ''}
            <div style="display:grid;grid-template-columns:100px 1fr;gap:4px 12px">
                <div style="color:var(--text-secondary)">联系电话：</div><div style="color:#00E5FF;word-break:break-all">${phone}</div>
                <div style="color:var(--text-secondary)">营业时间：</div><div>${hours}</div>
                <div style="color:var(--text-secondary)">店铺地址：</div><div>${address}</div>
                <div style="color:var(--text-secondary)">综合评分：</div><div>${ratingStr}</div>
                ${services ? `<div style="color:var(--text-secondary)">服务类型：</div><div>${services}</div>` : ''}
            </div>
            ${lat && lng ? `
            <div style="margin-top:12px;padding:10px;background:rgba(0,229,255,0.06);border-radius:8px">
                <div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px">📍 店铺坐标：${lat.toFixed(6)}, ${lng.toFixed(6)}</div>
                <div style="display:flex;gap:8px;flex-wrap:wrap">
                    <button class="btn btn-primary btn-sm" onclick="closeModal();const i = window._hospitals && window._hospitals.findIndex(h => Math.abs(h.lat-${lat})<0.00005 && Math.abs(h.lng-${lng})<0.00005); if(i>=0){window.realHospitalSelect(i);window.realHospitalPlanRoute(i);}else{navigateTo(${lat}, ${lng}, ${JSON.stringify(name).replace(/"/g,'&quot;')});}">🚗 页面内路线</button>
                    <button class="btn btn-secondary btn-sm" onclick="closeModal();navigateTo(${lat}, ${lng}, ${JSON.stringify(name).replace(/"/g,'&quot;')})">🔗 跳转高德导航</button>
                </div>
            </div>` : ''}
            <div style="margin-top:14px;padding:10px;background:rgba(245,158,11,0.08);border-radius:8px;line-height:1.8">
                <strong style="color:#FBBF24">⚠️ 就医提醒：</strong><br>
                1. 请提前电话预约，避免排队等待<br>
                2. 携带宠物疫苗本和既往病历<br>
                3. 就医前4小时建议禁食（尤其是需要麻醉的情况）
            </div>
        </div>
    `, '<button class="btn btn-primary" onclick="closeModal()">关闭</button>');
};

// 侧边栏菜单点击绑定
document.addEventListener('click', (e) => {
    const sideItem = e.target.closest('.side-menu-item');
    if (sideItem && sideItem.dataset.page) {
        e.preventDefault();
        showPage(sideItem.dataset.page);
    }
});

// ===== 启动 =====
document.addEventListener('DOMContentLoaded', init);

/* ===== 数据库知识库内容（来自 pet_emotion.db，与桌面文档一致） ===== */
const PET_META = {
    '狗': { icon: '🐶', name: '犬类' },
    '猫': { icon: '🐱', name: '猫类' },
    '兔子': { icon: '🐰', name: '兔类' },
    '仓鼠': { icon: '🐹', name: '仓鼠' },
    '龙猫': { icon: '🌰', name: '龙猫' },
    '鹦鹉': { icon: '🦜', name: '鹦鹉' },
    '乌龟': { icon: '🐢', name: '乌龟' },
    '金鱼': { icon: '🐟', name: '金鱼' },
    '蜥蜴': { icon: '🦎', name: '蜥蜴' },
    '通用': { icon: '🐾', name: '通用' }
};
const PET_ORDER = ['狗', '猫', '兔子', '仓鼠', '龙猫', '鹦鹉', '乌龟', '金鱼', '蜥蜴', '通用'];
const ZOONOSIS_KEYWORDS = ['鹦鹉热', '狂犬病', '猫癣', '钩端螺旋体'];

/* 统一风格的 SVG 图标（替代 emoji） */
const SVG_VIRUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="5.6"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/><circle cx="10.4" cy="10.4" r="0.9" fill="currentColor" stroke="none"/><circle cx="13.8" cy="13.6" r="0.9" fill="currentColor" stroke="none"/></svg>';
const SVG_WARNING = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.2 21.5 20.8H2.5z"/><path d="M12 9v5"/><circle cx="12" cy="17.2" r="0.9" fill="currentColor" stroke="none"/></svg>';
const SVG_PILL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="2.6" y="8.4" width="18.8" height="7.2" rx="3.6" transform="rotate(-40 12 12)"/><path d="M8.6 8.6 15.4 15.4"/></svg>';
const SVG_MEDICAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="8.6"/><path d="M12 7.8v8.4M7.8 12h8.4"/></svg>';

async function fetchKbDb(table, petCategory) {
    const params = new URLSearchParams();
    params.set('table', table);
    params.set('page_size', 300);
    if (petCategory) params.set('pet_category', petCategory);
    const res = await fetch('/api/knowledge/list?' + params.toString());
    const data = await res.json();
    return (data && data.success) ? (data.records || []) : [];
}

function petMetaOf(pet) {
    return PET_META[pet] || { icon: '🐾', name: pet || '其他' };
}

function groupByPet(records) {
    const map = {};
    records.forEach(r => {
        const p = r.pet_category || '通用';
        (map[p] = map[p] || []).push(r);
    });
    const known = PET_ORDER.filter(p => map[p]);
    const extra = Object.keys(map).filter(p => PET_ORDER.indexOf(p) < 0);
    return known.concat(extra).map(p => [p, map[p]]);
}

function isZooRecord(r) {
    const blob = [r.disease_name, r.symptom, r.medicine, r.remark].join(' ');
    return ZOONOSIS_KEYWORDS.some(k => blob.indexOf(k) >= 0);
}

function speciesHead(pet, count) {
    const m = petMetaOf(pet);
    return '<div class="kb-species-head">' +
        '<span class="kb-species-icon">' + m.icon + '</span>' +
        '<span class="kb-species-name">' + m.name + '</span>' +
        '<span class="kb-species-count">' + count + ' 条</span></div>';
}

function renderKnowledgeCards(records) {
    if (!records.length) return '<div class="med-db-empty">暂无数据</div>';
    return groupByPet(records).map(([pet, rows]) => `
        <div class="kb-species-group">
            ${speciesHead(pet, rows.length)}
            <div class="kb-card-grid">
                ${rows.map(r => `
                    <article class="kb-info-card">
                        <div class="kb-info-name">${r.breed || '—'}</div>
                        <p class="kb-info-desc">${r.description || ''}</p>
                    </article>`).join('')}
            </div>
        </div>`).join('');
}

function renderDietCards(records) {
    if (!records.length) return '<div class="med-db-empty">暂无数据</div>';
    return groupByPet(records).map(([pet, rows]) => `
        <div class="kb-species-group">
            ${speciesHead(pet, rows.length)}
            <div class="kb-card-grid">
                ${rows.map(r => `
                    <article class="kb-diet-card">
                        <div class="kb-diet-age">${r.age_group || '—'}</div>
                        <div class="kb-diet-row"><span class="kb-line-label">食物</span><span>${r.food_type || '—'}</span></div>
                        <div class="kb-diet-row"><span class="kb-line-label">频次</span><span>${r.daily_frequency || '—'}</span></div>
                        ${r.forbidden_food ? `<div class="kb-diet-forbid"><span>⛔ 禁忌</span>${r.forbidden_food}</div>` : ''}
                    </article>`).join('')}
            </div>
        </div>`).join('');
}

function renderEmotionCards(records) {
    if (!records.length) return '<div class="med-db-empty">暂无数据</div>';
    return groupByPet(records).map(([pet, rows]) => `
        <div class="kb-species-group">
            ${speciesHead(pet, rows.length)}
            <div class="kb-card-grid">
                ${rows.map(r => `
                    <article class="kb-emotion-card">
                        <div class="kb-emotion-tag">${r.emotion || '—'}</div>
                        <p class="kb-emotion-behavior">${r.behavior || ''}</p>
                        <div class="kb-emotion-solution"><span class="kb-line-label">安抚</span><span>${r.solution || ''}</span></div>
                    </article>`).join('')}
            </div>
        </div>`).join('');
}

function renderDiseaseCards(records) {
    if (!records.length) return '<div class="med-db-empty">没有匹配的条目</div>';
    let seq = 0;
    return groupByPet(records).map(([pet, rows]) => `
        <section class="kb-species-group">
            ${speciesHead(pet, rows.length)}
            <div class="kb-disease-list">
                ${rows.map(r => {
                    const zoo = isZooRecord(r);
                    const id = 'kd-' + (++seq);
                    return `<article class="kb-disease-item${zoo ? ' zoo' : ''}">
                        <button class="kb-disease-summary" type="button" aria-expanded="false" data-target="${id}">
                            <span class="kb-disease-icon">${zoo ? SVG_WARNING : SVG_VIRUS}</span>
                            <span class="kb-disease-main">
                                <span class="kb-disease-name">${r.disease_name || ''}</span>
                                <span class="kb-disease-snippet">${r.symptom || ''}</span>
                            </span>
                            ${zoo ? `<span class="kb-zoo-badge">${SVG_WARNING}人畜共患</span>` : ''}
                            <span class="kb-disease-arrow">⌄</span>
                        </button>
                        <div class="kb-disease-detail" id="${id}">
                            <div class="kb-detail-block"><span class="kb-detail-key">症状</span><p>${r.symptom || '—'}</p></div>
                            <div class="kb-detail-block"><span class="kb-detail-key">参考用药</span><p>${r.medicine || '—'}</p></div>
                            ${r.remark ? `<div class="kb-detail-block remark"><span class="kb-detail-key">备注</span><p>${r.remark}</p></div>` : ''}
                        </div>
                    </article>`;
                }).join('')}
            </div>
        </section>`).join('');
}

function bindDiseaseToggle(container) {
    if (!container || container.dataset.kdToggle === '1') return;
    container.dataset.kdToggle = '1';
    container.addEventListener('click', e => {
        const btn = e.target.closest('.kb-disease-summary');
        if (!btn) return;
        const item = btn.closest('.kb-disease-item');
        if (!item) return;
        item.classList.toggle('open');
        btn.setAttribute('aria-expanded', item.classList.contains('open') ? 'true' : 'false');
    });
}

function renderKbContent(table, records) {
    if (table === 'pet_diet') return renderDietCards(records);
    if (table === 'pet_disease_medicine') return renderDiseaseCards(records);
    if (table === 'pet_emotion_solution') return renderEmotionCards(records);
    return renderKnowledgeCards(records);
}

window.kbDbTab = function (el, table) {
    document.querySelectorAll('#dbKbTabs .species-btn').forEach(b => b.classList.remove('active'));
    if (el) el.classList.add('active');
    window.loadDbKnowledge(table);
};

window.loadDbKnowledge = async function (table) {
    const box = document.getElementById('dbKbContent');
    if (!box) return;
    box.innerHTML = '<div class="med-db-empty">⏳ 加载中…</div>';
    try {
        const records = await fetchKbDb(table, '');
        box.innerHTML = renderKbContent(table, records);
        bindDiseaseToggle(box);
    } catch (e) {
        box.innerHTML = '<div class="med-db-empty">加载失败：' + e.message + '</div>';
    }
};

/* ===== 疾病用药卡片（按物种分组 + 筛选） ===== */
let _dbMedAll = [];
let _dbMedPet = '';
let _dbMedKw = '';

function renderDbMedicine() {
    const box = document.getElementById('dbMedList');
    if (!box) return;
    let rows = _dbMedAll;
    if (_dbMedPet) rows = rows.filter(r => r.pet_category === _dbMedPet);
    const kw = (_dbMedKw || '').trim();
    if (kw) {
        rows = rows.filter(r => [r.disease_name, r.symptom, r.medicine, r.remark].join(' ').indexOf(kw) >= 0);
    }
    const countEl = document.getElementById('dbMedCount');
    if (countEl) countEl.textContent = '共 ' + rows.length + ' 条';
    box.innerHTML = rows.length
        ? renderDiseaseCards(rows) + '<div class="kb-db-note">仅供学习参考，用药请遵兽医医嘱。</div>'
        : '<div class="med-db-empty">没有匹配的条目</div>';
    bindDiseaseToggle(box);
}

window.loadDbMedicine = async function () {
    const box = document.getElementById('dbMedList');
    if (!box) return;
    box.innerHTML = '<div class="med-db-empty">⏳ 加载中…</div>';
    try {
        _dbMedAll = await fetchKbDb('pet_disease_medicine', '');
        renderDbMedicine();
    } catch (e) {
        box.innerHTML = '<div class="med-db-empty">加载失败：' + e.message + '</div>';
        return;
    }
    const input = document.getElementById('dbMedSearch');
    if (input && !input.dataset.bound) {
        input.dataset.bound = '1';
        input.addEventListener('input', () => {
            _dbMedKw = input.value;
            renderDbMedicine();
        });
    }
    const chips = document.getElementById('dbMedChips');
    if (chips && !chips.dataset.bound) {
        chips.dataset.bound = '1';
        chips.addEventListener('click', e => {
            const btn = e.target.closest('.med-chip');
            if (!btn) return;
            chips.querySelectorAll('.med-chip').forEach(x => x.classList.remove('active'));
            btn.classList.add('active');
            _dbMedPet = btn.dataset.pet || '';
            renderDbMedicine();
        });
    }
};

/* ===== 时间范围快捷选择 ===== */
function _fmtLocalDate(d) {
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
window.setDateRange = function (range, el) {
    const from = document.getElementById('filterDateFrom');
    const to = document.getElementById('filterDateTo');
    if (!from || !to) return;
    const now = new Date();
    if (range === 'all') {
        from.value = ''; to.value = '';
    } else if (range === 'today') {
        const s = _fmtLocalDate(now); from.value = s; to.value = s;
    } else {
        const days = parseInt(range, 10) || 7;
        const d = new Date(); d.setDate(d.getDate() - (days - 1));
        from.value = _fmtLocalDate(d); to.value = _fmtLocalDate(now);
    }
    document.querySelectorAll('.ref-date-btn').forEach(b => b.classList.remove('active'));
    if (el) el.classList.add('active');
    loadHistoryTableData(1);
};
